import { useEffect, useState } from 'react';

import { CLAUDE_REMOTE_VERSION, DEFAULT_PORT } from '@/shared/constants';

export function Login() {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Bootstrap token auto-auth from URL query param
  useEffect(() => {
    const params = new URLSearchParams(globalThis.location?.search ?? '');
    const bootstrapToken = params.get('token');
    if (bootstrapToken) {
      handleBootstrapAuth(bootstrapToken);
    }
  }, []);

  async function handleBootstrapAuth(bootstrapToken: string) {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: bootstrapToken }),
        credentials: 'include',
      });
      if (res.ok) {
        // Clear sensitive token from URL before navigating
        history.replaceState({}, '', '/sessions');
        globalThis.location.href = '/sessions';
      } else {
        setError('Bootstrap token is invalid or expired');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
        credentials: 'include',
      });
      if (res.ok) {
        globalThis.location.href = '/sessions';
      } else if (res.status === 429) {
        setError('Too many requests, please try again later');
      } else {
        setError('Invalid token');
      }
    } catch {
      setError('Network error, please check your connection');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-950 p-4 font-mono">
      <div className="w-full max-w-md rounded-lg border border-gray-800 bg-gray-900 p-8">
        <p className="mb-1 text-xs text-gray-500">Claude Remote v{CLAUDE_REMOTE_VERSION}</p>
        <h1 className="mb-1 text-2xl font-semibold text-gray-100">Login to Hub</h1>
        <p className="mb-6 text-sm text-gray-400">Default port {DEFAULT_PORT}</p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            type="password"
            className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 outline-none transition focus:border-gray-500"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Enter Hub Token"
            disabled={loading}
          />

          <button
            type="submit"
            disabled={loading || !token.trim()}
            className="flex items-center justify-center rounded bg-gray-100 px-4 py-2 text-sm font-medium text-gray-900 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? (
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
            ) : (
              'Connect'
            )}
          </button>
        </form>

        {error && <p className="mt-4 text-center text-sm text-red-400">{error}</p>}
      </div>
    </main>
  );
}
