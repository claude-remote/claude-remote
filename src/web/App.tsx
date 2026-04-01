import { DEFAULT_PORT } from '@/shared/constants';

import { Chat } from '@/web/pages/Chat';
import { Files } from '@/web/pages/Files';
import { Login } from '@/web/pages/Login';
import { Sessions } from '@/web/pages/Sessions';

export function App() {
  // TODO(T11): replace manual path switching with the final SPA router and auth guards.
  const pathname = globalThis.location?.pathname ?? '/login';

  if (pathname.startsWith('/chat/')) {
    return <Chat />;
  }

  if (pathname.startsWith('/files/')) {
    return <Files />;
  }

  if (pathname.startsWith('/sessions')) {
    return <Sessions />;
  }

  return <Login defaultPort={DEFAULT_PORT} />;
}
