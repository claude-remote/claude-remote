import { readFileSync } from 'node:fs';
import { resolve as pathResolve } from 'node:path';
import { createTuiClient } from '@/cli/TuiClient';
import {
  type ParsedArgs,
  parseArgs,
  printHelp,
  printVersion,
  resolveLogsOptions,
  resolveServeOptions,
} from '@/cli/commands';
import { Hub } from '@/hub/Hub';
import { createServerApp, startServer } from '@/server';
import { DEFAULT_LOG_DIR, DEFAULT_PORT, DEFAULT_SOCKET_PATH } from '@/shared/constants';
import { CloudflaredManager } from '@/tunnel/cloudflared';

/* ------------------------------------------------------------------ */
/*  Command handlers                                                   */
/* ------------------------------------------------------------------ */

function expandHome(p: string): string {
  if (p.startsWith('~')) return p.replace('~', process.env.HOME ?? '');
  return p;
}

async function handleServe(parsed: ParsedArgs): Promise<void> {
  const opts = resolveServeOptions(parsed);
  const socketPath = expandHome(DEFAULT_SOCKET_PATH);

  const hub = new Hub({ socketPath });
  await hub.start();

  const app = createServerApp(hub);
  startServer(app, opts.port);

  console.log(`Hub running on http://localhost:${opts.port}`);

  if (opts.tunnel) {
    console.log('Starting cloudflared tunnel...');
    const cfManager = new CloudflaredManager();
    try {
      const tunnel = await cfManager.startQuickTunnel();
      console.log(`Tunnel URL: ${tunnel.url}`);
      // Print a simple ASCII QR-style placeholder (actual QR generation
      // can be added later without pulling in a dependency).
      console.log(`\nShare this URL to connect remotely:\n  ${tunnel.url}\n`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Failed to start tunnel: ${message}`);
    }
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\nShutting down...');
    await hub.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function handleStatus(_parsed: ParsedArgs): Promise<void> {
  const port =
    typeof _parsed.flags.port === 'string' ? Number.parseInt(_parsed.flags.port, 10) : DEFAULT_PORT;

  try {
    const res = await fetch(`http://localhost:${port}/api/health`);
    if (!res.ok) {
      console.error(`Hub returned status ${res.status}`);
      process.exit(1);
    }

    const data = (await res.json()) as Record<string, unknown>;
    console.log('Hub Status');
    console.log('----------');
    console.log(`  Status:      ${data.status}`);
    console.log(`  Version:     ${data.version}`);
    console.log(`  Uptime:      ${data.uptime}s`);
    console.log(`  Sessions:    ${(data.sessions as Record<string, number>)?.total ?? 0}`);
    console.log(`  Connections: ${data.connections}`);
  } catch {
    console.error(`Could not reach hub on port ${port}. Is it running?`);
    process.exit(1);
  }
}

async function handleStop(_parsed: ParsedArgs): Promise<void> {
  const port =
    typeof _parsed.flags.port === 'string' ? Number.parseInt(_parsed.flags.port, 10) : DEFAULT_PORT;

  try {
    const res = await fetch(`http://localhost:${port}/api/shutdown`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    if (res.ok) {
      console.log('Hub is shutting down.');
    } else {
      // Fallback: /api/shutdown may not be implemented yet — inform user.
      console.log(
        'Shutdown request sent. If the hub does not stop, send SIGTERM to the hub process.',
      );
    }
  } catch {
    console.error(`Could not reach hub on port ${port}. Is it running?`);
    process.exit(1);
  }
}

async function handleAttach(parsed: ParsedArgs): Promise<void> {
  const sessionId = parsed.subcommand ?? parsed.positional[0] ?? undefined;
  const port =
    typeof parsed.flags.port === 'string' ? Number.parseInt(parsed.flags.port, 10) : DEFAULT_PORT;
  const hubUrl = typeof parsed.flags.url === 'string' ? parsed.flags.url : undefined;

  const client = createTuiClient({ port, hubUrl, sessionId });

  try {
    await client.connect();
    await client.startRepl();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exit(1);
  }
}

async function handleTokenRotate(parsed: ParsedArgs): Promise<void> {
  const port =
    typeof parsed.flags.port === 'string' ? Number.parseInt(parsed.flags.port, 10) : DEFAULT_PORT;

  try {
    const res = await fetch(`http://localhost:${port}/api/auth/rotate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!res.ok) {
      console.error(`Token rotation failed with status ${res.status}`);
      process.exit(1);
    }

    const data = (await res.json()) as Record<string, unknown>;
    console.log(data.message ?? 'Token rotated successfully.');
  } catch {
    console.error(`Could not reach hub on port ${port}. Is it running?`);
    process.exit(1);
  }
}

function handleLogs(parsed: ParsedArgs): void {
  const opts = resolveLogsOptions(parsed);
  const logDir = expandHome(DEFAULT_LOG_DIR);
  const logFile = pathResolve(logDir, 'hub.log');

  try {
    const content = readFileSync(logFile, 'utf8');
    const lines = content.trimEnd().split('\n');
    const tail = lines.slice(-opts.lines);
    for (const line of tail) {
      console.log(line);
    }

    if (opts.follow) {
      // Simple follow using fs.watch — streams new lines as they appear
      const { watchFile } = require('node:fs') as typeof import('node:fs');
      let lastSize = require('node:fs').statSync(logFile).size as number;
      console.log('-- following (Ctrl+C to stop) --');

      watchFile(logFile, { interval: 500 }, () => {
        const { openSync, readSync, closeSync, statSync } = require('node:fs') as typeof import('node:fs');
        const newSize = statSync(logFile).size;
        if (newSize <= lastSize) {
          lastSize = newSize;
          return;
        }
        const fd = openSync(logFile, 'r');
        const buf = Buffer.alloc(newSize - lastSize);
        readSync(fd, buf, 0, buf.length, lastSize);
        closeSync(fd);
        process.stdout.write(buf.toString('utf8'));
        lastSize = newSize;
      });
    }
  } catch {
    console.error(`No log file found at ${logFile}. Is the hub running?`);
    process.exit(1);
  }
}

/* ------------------------------------------------------------------ */
/*  Main router                                                        */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);

  // Global flags
  if (parsed.flags.help === true || parsed.flags.h === true) {
    printHelp();
    return;
  }
  if (parsed.flags.version === true || parsed.flags.v === true) {
    printVersion();
    return;
  }

  switch (parsed.command) {
    case 'serve':
      await handleServe(parsed);
      break;
    case 'status':
      await handleStatus(parsed);
      break;
    case 'stop':
      await handleStop(parsed);
      break;
    case 'attach':
      await handleAttach(parsed);
      break;
    case 'token':
      if (parsed.subcommand === 'rotate') {
        await handleTokenRotate(parsed);
      } else {
        console.error('Usage: claude-remote token rotate');
        process.exit(1);
      }
      break;
    case 'logs':
      handleLogs(parsed);
      break;
    default:
      console.error(`Unknown command: ${parsed.command}\n`);
      printHelp();
      process.exit(1);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { handleServe, main };
