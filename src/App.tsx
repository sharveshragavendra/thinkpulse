import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { ThemeProvider } from './context/ThemeContext.tsx';
import { LoginPage } from './components/auth/LoginPage.tsx';
import { StudentPortal } from './components/student/StudentPortal.tsx';
import { AnonymousQrRunner } from './components/student/AnonymousQrRunner.tsx';
import { HostLayout } from './components/host/HostLayout.tsx';

function readInitialQrJoinParams(): { sid: string; token: string } | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get('sid')?.trim() || '';
    const token = params.get('t')?.trim() || '';
    if (sid && token) {
      return { sid, token };
    }
  } catch {
    // ignore URL parse issues
  }
  return null;
}

function ThinkPulseRouter() {
  const { user, initializing } = useAuth();
  const [qrJoin, setQrJoin] = useState<{ sid: string; token: string } | null>(
    readInitialQrJoinParams
  );

  const handleExitQrJoin = () => {
    setQrJoin(null);
    try {
      window.history.replaceState({}, '', '/');
    } catch {
      // ignore history errors
    }
  };

  // Direct QR entry without Google Sign-In (server enforces Anonymous-mode sessions ONLY)
  if (!user && qrJoin) {
    return (
      <AnonymousQrRunner
        sid={qrJoin.sid}
        token={qrJoin.token}
        onGoToLogin={handleExitQrJoin}
      />
    );
  }

  // Wait for persistent Firebase session check before flashing the login screen
  if (initializing && !user) {
    return (
      <div className="min-h-screen tp-ambient-bg flex items-center justify-center">
        <Loader2 className="w-7 h-7 animate-spin text-[#7C3AED] dark:text-[#C4B5FD]" />
      </div>
    );
  }

  // Initial route is ThinkPulse login when signed out
  if (!user) {
    return <LoginPage />;
  }

  if (user.role === 'student') {
    return <StudentPortal />;
  }

  // Host or Platform Administrator routes to Host Command Centre
  return <HostLayout />;
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ThinkPulseRouter />
      </AuthProvider>
    </ThemeProvider>
  );
}
