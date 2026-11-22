import React from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { LoginPage } from './components/auth/LoginPage.tsx';
import { StudentPortal } from './components/student/StudentPortal.tsx';
import { HostLayout } from './components/host/HostLayout.tsx';

function ThinkPulseRouter() {
  const { user } = useAuth();

  // Initial route is always ThinkPulse split-screen login (no marketing page before auth)
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
    <AuthProvider>
      <ThinkPulseRouter />
    </AuthProvider>
  );
}
