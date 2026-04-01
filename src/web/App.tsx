import { Routes, Route, Navigate } from 'react-router-dom';
import { Login } from './pages/Login';
import { Sessions } from './pages/Sessions';
import { Chat } from './pages/Chat';
import { Files } from './pages/Files';

function AuthGuard({ children }: { children: React.ReactNode }) {
  // Check if authenticated (cookie exists check via /api/health or local state)
  // For now, simple check - redirect to /login if not authed
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/sessions" element={<AuthGuard><Sessions /></AuthGuard>} />
      <Route path="/chat/:id" element={<AuthGuard><Chat /></AuthGuard>} />
      <Route path="/files/:id" element={<AuthGuard><Files /></AuthGuard>} />
      <Route path="*" element={<Navigate to="/sessions" replace />} />
    </Routes>
  );
}
