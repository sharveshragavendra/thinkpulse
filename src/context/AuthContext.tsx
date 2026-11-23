import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User as FirebaseUser,
} from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase.ts';
import {
  apiRequest,
  getAuthToken,
  setAuthToken,
  setTokenRefresher,
} from '../services/api.ts';
import type { UserProfile } from '../../shared/types.ts';

const PROFILE_STORAGE_KEY = 'tp_auth_profile';

function readStoredProfile(): UserProfile | null {
  try {
    const raw = window.localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as UserProfile;
  } catch {
    return null;
  }
}

function writeStoredProfile(profile: UserProfile | null) {
  try {
    if (profile) {
      window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
    } else {
      window.localStorage.removeItem(PROFILE_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

interface AuthContextValue {
  user: UserProfile | null;
  loading: boolean;
  initializing: boolean;
  loginWithEmail: (email: string, password: string) => Promise<UserProfile>;
  loginWithGoogle: () => Promise<UserProfile>;
  bootstrapAdmin: (payload: {
    institutionName: string;
    displayName: string;
    email: string;
    password: string;
  }) => Promise<UserProfile>;
  registerStudent: (payload: {
    displayName: string;
    email: string;
    password: string;
    classSection?: string;
    studentCode?: string;
  }) => Promise<UserProfile>;
  refreshProfile: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(() => {
    const token = getAuthToken();
    return token ? readStoredProfile() : null;
  });
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);

  const persistSession = useCallback((token: string, profile: UserProfile) => {
    setAuthToken(token);
    writeStoredProfile(profile);
    setUser(profile);
  }, []);

  const clearSession = useCallback(() => {
    setAuthToken(null);
    writeStoredProfile(null);
    setUser(null);
  }, []);

  const exchangeFirebaseUser = useCallback(
    async (fbUser: FirebaseUser, forceRefresh = false): Promise<{ token: string; profile: UserProfile }> => {
      const idToken = await fbUser.getIdToken(forceRefresh);
      const res = await apiRequest<{ token: string; profile: UserProfile }>('/auth/google', {
        method: 'POST',
        body: { idToken },
      });
      persistSession(res.token, res.profile);
      return res;
    },
    [persistSession]
  );

  // Register transparent 401 token refresher so tab switches or serverless cold starts never expire the session
  useEffect(() => {
    setTokenRefresher(async () => {
      const fbUser = auth.currentUser;
      if (!fbUser) return null;
      try {
        const res = await exchangeFirebaseUser(fbUser, true);
        return res.token;
      } catch {
        return null;
      }
    });
    return () => setTokenRefresher(null);
  }, [exchangeFirebaseUser]);

  // Restore session automatically whenever the user visits or returns to the tab
  useEffect(() => {
    let active = true;

    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      if (!active) return;

      try {
        if (fbUser) {
          const existingToken = getAuthToken();
          if (existingToken) {
            try {
              const res = await apiRequest<{ profile: UserProfile }>('/me');
              if (active) {
                writeStoredProfile(res.profile);
                setUser(res.profile);
              }
            } catch {
              // Silently re-issue backend token from persistent Firebase session
              await exchangeFirebaseUser(fbUser, true);
            }
          } else {
            await exchangeFirebaseUser(fbUser, false);
          }
        } else {
          const existingToken = getAuthToken();
          if (existingToken) {
            try {
              const res = await apiRequest<{ profile: UserProfile }>('/me');
              if (active) {
                writeStoredProfile(res.profile);
                setUser(res.profile);
              }
            } catch {
              if (active) clearSession();
            }
          } else if (active) {
            setUser(null);
          }
        }
      } catch {
        // Keep cached session if offline/transient error so switching tabs doesn't kick the user out
      } finally {
        if (active) setInitializing(false);
      }
    });

    // Silently refresh token when returning to the tab so sessions stay alive seamlessly
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && auth.currentUser) {
        void exchangeFirebaseUser(auth.currentUser, false).catch(() => {
          // ignore transient network errors on tab resume
        });
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      active = false;
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [clearSession, exchangeFirebaseUser]);

  const loginWithEmail = useCallback(
    async (email: string, password: string) => {
      setLoading(true);
      try {
        const res = await apiRequest<{ token: string; profile: UserProfile }>('/auth/login', {
          method: 'POST',
          body: { email, password },
        });
        persistSession(res.token, res.profile);
        return res.profile;
      } finally {
        setLoading(false);
      }
    },
    [persistSession]
  );

  const loginWithGoogle = useCallback(async () => {
    setLoading(true);
    try {
      await setPersistence(auth, browserLocalPersistence).catch(() => {
        // ignore persistence errors in restricted modes
      });
      const cred = await signInWithPopup(auth, googleAuthProvider);
      const res = await exchangeFirebaseUser(cred.user, false);
      return res.profile;
    } finally {
      setLoading(false);
    }
  }, [exchangeFirebaseUser]);

  const bootstrapAdmin = useCallback(
    async (payload: {
      institutionName: string;
      displayName: string;
      email: string;
      password: string;
    }) => {
      setLoading(true);
      try {
        const res = await apiRequest<{ token: string; profile: UserProfile }>('/auth/bootstrap-admin', {
          method: 'POST',
          body: payload,
        });
        persistSession(res.token, res.profile);
        return res.profile;
      } finally {
        setLoading(false);
      }
    },
    [persistSession]
  );

  const registerStudent = useCallback(
    async (payload: {
      displayName: string;
      email: string;
      password: string;
      classSection?: string;
      studentCode?: string;
    }) => {
      setLoading(true);
      try {
        const res = await apiRequest<{ token: string; profile: UserProfile }>('/auth/register-student', {
          method: 'POST',
          body: payload,
        });
        persistSession(res.token, res.profile);
        return res.profile;
      } finally {
        setLoading(false);
      }
    },
    [persistSession]
  );

  const refreshProfile = useCallback(async () => {
    try {
      const res = await apiRequest<{ profile: UserProfile }>('/me');
      writeStoredProfile(res.profile);
      setUser(res.profile);
    } catch {
      if (auth.currentUser) {
        try {
          await exchangeFirebaseUser(auth.currentUser, true);
          return;
        } catch {
          // ignore transient failure
        }
      }
    }
  }, [exchangeFirebaseUser]);

  const logout = useCallback(async () => {
    try {
      await apiRequest('/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    try {
      await firebaseSignOut(auth);
    } catch {
      // ignore
    }
    clearSession();
  }, [clearSession]);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        initializing,
        loginWithEmail,
        loginWithGoogle,
        bootstrapAdmin,
        registerStudent,
        refreshProfile,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
