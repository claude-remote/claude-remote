import { useState } from 'react';

import { CLAUDE_REMOTE_VERSION } from '@/shared/constants';

interface LoginProps {
  defaultPort: number;
}

export function Login({ defaultPort }: LoginProps) {
  const [token, setToken] = useState('');

  // TODO(T12): implement bootstrap-token exchange, cookie auth, and replaceState cleanup.
  return (
    <main className="flex min-h-screen flex-col justify-center gap-4 p-6">
      <p className="text-sm text-stone-400">Claude Remote v{CLAUDE_REMOTE_VERSION}</p>
      <h1 className="text-3xl font-semibold">登录 Hub</h1>
      <p className="text-sm text-stone-300">默认端口 {defaultPort}</p>
      <input
        className="rounded border border-stone-700 bg-stone-900 px-3 py-2"
        value={token}
        onChange={(event) => setToken(event.target.value)}
        placeholder="输入主 Token"
      />
      <button className="rounded bg-orange-500 px-4 py-2 font-medium text-black">
        连接
      </button>
    </main>
  );
}
