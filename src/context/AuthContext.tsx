import React, { createContext, useCallback, useContext, useState } from 'react';
import { signInWithPopup, signOut as firebaseSignOut } from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase.ts';
import { apiRequest, setAuthToken } from '../services/api.ts';
import type { UserProfile } from '../../shared/types.ts';

interface AuthContextValue {
  user: UserProfile | null;
  loading: boolean;
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
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(false);

  const loginWithEmail = useCallback(async (email: string, password: string) => {
    setLoading(true);
    try {
      const res = await apiRequest<{ token: string; profile: UserProfile }>('/auth/login', {
        method: 'POST',
        body: { email, password },
      });
      setAuthToken(res.token);
      setUser(res.profile);
      return res.profile;
    } finally {
      setLoading(false);
    }
  }, []);

  const loginWithGoogle = useCallback(async () => {
    setLoading(true);
    try {
      const cred = await signInWithPopup(auth, googleAuthProvider);
      const idToken = await cred.user.getIdToken();
      const res = await apiRequest<{ token: string; profile: UserProfile }>('/auth/google', {
        method: 'POST',
        body: { idToken },
      });
      setAuthToken(res.token);
      setUser(res.profile);
      return res.profile;
    } finally {
      setLoading(false);
    }
  }, []);

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
        setAuthToken(res.token);
        setUser(res.profile);
        return res.profile;
      } finally {
        setLoading(false);
      }
    },
    []
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
        setAuthToken(res.token);
        setUser(res.profile);
        return res.profile;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const refreshProfile = useCallback(async () => {
    try {
      const res = await apiRequest<{ profile: UserProfile }>('/me');
      setUser(res.profile);
    } catch {
      setAuthToken(null);
      setUser(null);
    }
  }, []);

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
    setAuthToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
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
