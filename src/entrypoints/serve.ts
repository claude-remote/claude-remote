import { DEFAULT_PORT } from '@/shared/constants';

import { Hub } from '@/hub/Hub';
import { createServerApp } from '@/server';

export async function serve(): Promise<void> {
  const hub = new Hub();

  // TODO(T26): patch interactive env first, start Hono server, and support --tunnel/--log-level.
  await hub.start();
  createServerApp(hub);
  console.log(`claude-remote serve stub listening on :${DEFAULT_PORT}`);
}

if (import.meta.main) {
  void serve();
}
