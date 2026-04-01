import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { HUB_CHAT_NOT_IMPLEMENTED_NOTICE } from '@/hub/client/HubReplAdapter';

const repoRoot = resolve(import.meta.dir, '../..');
const cliEntry = join(repoRoot, 'src/entrypoints/cli.tsx');

type RunningServe = {
  homeDir: string;
  subprocess: Bun.Subprocess<'ignore', 'pipe', 'pipe'>;
};

const runningServeProcesses = new Set<RunningServe>();

async function runCliCommand(
  homeDir: string,
  ...args: string[]
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const command = Bun.spawn({
    cmd: [process.execPath, '--env-file=.env', cliEntry, ...args],
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: homeDir,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(command.stdout).text(),
    new Response(command.stderr).text(),
    command.exited,
  ]);

  return { exitCode, stdout, stderr };
}

async function startServe(homeDir: string): Promise<RunningServe> {
  const subprocess = Bun.spawn({
    cmd: [process.execPath, '--env-file=.env', cliEntry, 'serve'],
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: homeDir,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const running = { homeDir, subprocess };
  runningServeProcesses.add(running);
  return running;
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }

    await Bun.sleep(100);
  }

  throw new Error(`condition not met within ${timeoutMs}ms`);
}

async function stopServe(running: RunningServe): Promise<void> {
  running.subprocess.kill('SIGTERM');
  await running.subprocess.exited;
  runningServeProcesses.delete(running);
}

afterEach(async () => {
  await Promise.all(
    [...runningServeProcesses].map(async (running) => {
      try {
        await stopServe(running);
      } catch {
        // best-effort child cleanup for failed tests
      }

      await rm(running.homeDir, { recursive: true, force: true });
    }),
  );
});

describe('local hub cli e2e smoke test', () => {
  test('runs status, serve, status, and attach against a real hub process', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'claude-remote-e2e-'));
    const hubRoot = join(homeDir, '.claude-remote');
    const statusPath = join(hubRoot, 'hub-status.json');

    const before = await runCliCommand(homeDir, 'status');
    expect(before.exitCode).toBe(0);
    expect(before.stderr).toBe('');
    expect(before.stdout).toContain('Hub is not running');

    const running = await startServe(homeDir);

    await waitFor(async () => {
      const status = await runCliCommand(homeDir, 'status');
      return status.exitCode === 0 && status.stdout.includes('Hub is running');
    });

    const statusRaw = await readFile(statusPath, 'utf8');
    expect(JSON.parse(statusRaw)).toEqual(
      expect.objectContaining({
        running: true,
        socketPath: join(hubRoot, 'hub.sock'),
      }),
    );

    const attached = await runCliCommand(homeDir, 'attach');
    expect(attached.exitCode).toBe(0);
    expect(attached.stderr).toBe('');
    expect(attached.stdout).toContain('Attached to claude-code-haha');
    expect(attached.stdout).toContain(HUB_CHAT_NOT_IMPLEMENTED_NOTICE);

    await stopServe(running);

    await waitFor(async () => !existsSync(statusPath));

    const after = await runCliCommand(homeDir, 'status');
    expect(after.exitCode).toBe(0);
    expect(after.stdout).toContain('Hub is not running');

    await rm(homeDir, { recursive: true, force: true });
  }, 20_000);
});
