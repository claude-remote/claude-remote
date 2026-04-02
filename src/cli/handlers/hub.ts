import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { Hub } from '../../hub/Hub.js';
import { getHubRootDir, getHubSocketPath, getHubStatusPath } from '../../hub/paths.js';

type HubStatusShape = {
  running: boolean;
  sessionCount: number;
  connectionCount: number;
  socketPath: string;
  pid?: number;
};

export function formatHubStatus(status: HubStatusShape): string {
  const state = status.running ? 'running' : 'not running';
  return [
    `Hub is ${state}`,
    `Socket: ${status.socketPath}`,
    `Sessions: ${status.sessionCount}`,
    `Connections: ${status.connectionCount}`,
    ...(status.pid ? [`PID: ${status.pid}`] : []),
  ].join('\n');
}

async function writeHubStatus(status: HubStatusShape): Promise<void> {
  await mkdir(getHubRootDir(), { recursive: true });
  await writeFile(getHubStatusPath(), JSON.stringify(status, null, 2));
}

async function clearHubStatus(): Promise<void> {
  if (existsSync(getHubStatusPath())) {
    await rm(getHubStatusPath(), { force: true });
  }
}

export async function serveHubHandler(): Promise<void> {
  await mkdir(getHubRootDir(), { recursive: true });

  const hub = new Hub({ socketPath: getHubSocketPath() });
  await hub.start();
  await writeHubStatus({
    ...hub.getStatus(),
    pid: process.pid,
  });

  const shutdown = async () => {
    await hub.stop();
    await clearHubStatus();
    process.exit(0);
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  process.stdout.write(`${formatHubStatus({ ...hub.getStatus(), pid: process.pid })}\n`);
  await new Promise<void>(() => {});
}

export async function statusHubHandler(): Promise<void> {
  if (!existsSync(getHubStatusPath())) {
    process.stdout.write(
      `${formatHubStatus({
        running: false,
        sessionCount: 0,
        connectionCount: 0,
        socketPath: getHubSocketPath(),
      })}\n`,
    );
    return;
  }

  const raw = await readFile(getHubStatusPath(), 'utf8');
  const status = JSON.parse(raw) as HubStatusShape;
  process.stdout.write(`${formatHubStatus(status)}\n`);
}
