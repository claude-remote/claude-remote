import { basename } from 'node:path';
import { cwd } from 'node:process';
import { HubClient } from '../../hub/client/HubClient.js';
import { HUB_CHAT_NOT_IMPLEMENTED_NOTICE } from '../../hub/client/HubReplAdapter.js';
import { getHubSocketPath } from '../../hub/paths.js';

export function ensureHubSessionName(sessionCwd: string): {
  cwd: string;
  name: string;
} {
  return {
    cwd: sessionCwd,
    name: basename(sessionCwd) || 'session',
  };
}

export async function attachHubHandler(): Promise<void> {
  const client = new HubClient({
    socketPath: getHubSocketPath(),
  });

  await client.connect();

  const sessionInfo = ensureHubSessionName(cwd());
  const sessions = await client.listSessions();
  const session = sessions[0] ?? (await client.createSession(sessionInfo));
  const snapshot = await client.attachSession(session.id);

  process.stdout.write(
    `${[
      `Attached to ${snapshot.session.name}`,
      `Session: ${snapshot.session.id}`,
      `CWD: ${snapshot.session.cwd}`,
      HUB_CHAT_NOT_IMPLEMENTED_NOTICE,
    ].join('\n')}\n`,
  );

  await client.disconnect();
}
