import { useCallback, useState } from 'react';
import { Routes, Route, Navigate, useParams, useNavigate } from 'react-router-dom';
import { Login } from './pages/Login';
import { Sessions } from './pages/Sessions';
import { Chat } from './pages/Chat';
import { Files } from './pages/Files';
import { MobileNav } from './components/MobileNav';
import { useSwipeGesture } from './hooks/useSwipeGesture';

function AuthGuard({ children }: { children: React.ReactNode }) {
  // Check if authenticated (cookie exists check via /api/health or local state)
  // For now, simple check - redirect to /login if not authed
  return <>{children}</>;
}

/** Wrapper that extracts session id and renders sidebar + mobile nav. */
function AppShell({ children }: { children: React.ReactNode }) {
  const params = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleSwipeRight = useCallback(() => setSidebarOpen(true), []);
  const handleSwipeLeft = useCallback(() => setSidebarOpen(false), []);

  useSwipeGesture({
    onSwipeRight: handleSwipeRight,
    onSwipeLeft: handleSwipeLeft,
  });

  return (
    <div className="relative flex h-[100dvh] w-full overflow-hidden">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50 md:hidden"
            onClick={() => setSidebarOpen(false)}
            onKeyDown={(e) => { if (e.key === 'Escape') setSidebarOpen(false); }}
            role="button"
            tabIndex={-1}
            aria-label="Close sidebar"
          />
          <aside className="fixed inset-y-0 left-0 z-50 w-64 border-r border-gray-800 bg-gray-950 p-4 md:hidden">
            <h2 className="mb-4 text-sm font-semibold text-gray-400 uppercase tracking-wider">Navigation</h2>
            <nav className="flex flex-col gap-2">
              <SidebarLink label="Sessions" onClick={() => { navigate('/sessions'); setSidebarOpen(false); }} />
              {params.id && (
                <>
                  <SidebarLink label="Chat" onClick={() => { navigate(`/chat/${params.id}`); setSidebarOpen(false); }} />
                  <SidebarLink label="Files" onClick={() => { navigate(`/files/${params.id}`); setSidebarOpen(false); }} />
                </>
              )}
            </nav>
          </aside>
        </>
      )}

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden pb-14 md:pb-0">
        {children}
      </div>

      {/* Bottom nav on mobile */}
      <MobileNav sessionId={params.id} />
    </div>
  );
}

function SidebarLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg px-3 py-2 text-left text-sm text-gray-300 transition-colors hover:bg-gray-800 hover:text-gray-100 active:bg-gray-700"
    >
      {label}
    </button>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/sessions"
        element={
          <AuthGuard>
            <AppShell><Sessions /></AppShell>
          </AuthGuard>
        }
      />
      <Route
        path="/chat/:id"
        element={
          <AuthGuard>
            <AppShell><Chat /></AppShell>
          </AuthGuard>
        }
      />
      <Route
        path="/files/:id"
        element={
          <AuthGuard>
            <AppShell><Files /></AppShell>
          </AuthGuard>
        }
      />
      <Route path="*" element={<Navigate to="/sessions" replace />} />
    </Routes>
  );
}
