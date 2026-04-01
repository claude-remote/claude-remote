import { CLAUDE_REMOTE_VERSION, DEFAULT_PORT } from '@/shared/constants';
import type { SessionMeta } from '@/shared/types';

export interface CliCommandDefinition {
  name: string;
  usage: string;
  description: string;
}

export const COMMANDS: CliCommandDefinition[] = [
  {
    name: 'serve',
    usage: 'serve [--port 7680] [--tunnel] [--config path]',
    description: 'Start the Claude Remote hub service.',
  },
  { name: 'status', usage: 'status', description: 'Show current hub health and active sessions.' },
  { name: 'stop', usage: 'stop', description: 'Gracefully stop the hub.' },
  {
    name: 'attach',
    usage: 'attach [session-id]',
    description: 'Attach a TUI client to a running hub session.',
  },
  {
    name: 'token',
    usage: 'token rotate',
    description: 'Rotate the master token and revoke sessions.',
  },
  { name: 'logs', usage: 'logs [--follow] [--lines 50]', description: 'Tail structured hub logs.' },
];

export interface ParsedArgs {
  command: string;
  subcommand?: string;
  flags: Record<string, string | boolean>;
  positional: string[];
}

/**
 * Minimal CLI arg parser — no heavy dependencies.
 * Supports: --flag, --flag value, --flag=value, -h, positional args.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  // Skip bun/node binary and script path
  const args = argv.slice(2);
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const eqIndex = arg.indexOf('=');
      if (eqIndex !== -1) {
        flags[arg.slice(2, eqIndex)] = arg.slice(eqIndex + 1);
      } else {
        const next = args[i + 1];
        if (next && !next.startsWith('-')) {
          flags[arg.slice(2)] = next;
          i++;
        } else {
          flags[arg.slice(2)] = true;
        }
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      flags[arg.slice(1)] = true;
    } else {
      positional.push(arg);
    }
    i++;
  }

  const command = positional[0] ?? 'serve';
  const subcommand = positional[1];

  return { command, subcommand, flags, positional: positional.slice(2) };
}

export function printHelp(): void {
  console.log(`claude-remote v${CLAUDE_REMOTE_VERSION}\n`);
  console.log('Usage: claude-remote <command> [options]\n');
  console.log('Commands:');
  for (const cmd of COMMANDS) {
    console.log(`  ${cmd.usage.padEnd(44)} ${cmd.description}`);
  }
  console.log('\nGlobal flags:');
  console.log('  --help, -h          Show this help message');
  console.log('  --version, -v       Print version');
}

export function printVersion(): void {
  console.log(`claude-remote v${CLAUDE_REMOTE_VERSION}`);
}

export function formatSessionSummary(session: Pick<SessionMeta, 'id' | 'name'>): string {
  return `${session.name} (${session.id})`;
}

export interface ServeOptions {
  port: number;
  tunnel: boolean;
  configPath?: string;
}

export function resolveServeOptions(parsed: ParsedArgs): ServeOptions {
  const port =
    typeof parsed.flags.port === 'string' ? Number.parseInt(parsed.flags.port, 10) : DEFAULT_PORT;
  if (Number.isNaN(port) || port < 1 || port > 65535) {
    console.error(`Error: invalid port "${parsed.flags.port}"`);
    process.exit(1);
  }
  return {
    port,
    tunnel: parsed.flags.tunnel === true,
    configPath: typeof parsed.flags.config === 'string' ? parsed.flags.config : undefined,
  };
}

export interface LogsOptions {
  follow: boolean;
  lines: number;
}

export function resolveLogsOptions(parsed: ParsedArgs): LogsOptions {
  const lines =
    typeof parsed.flags.lines === 'string' ? Number.parseInt(parsed.flags.lines, 10) : 50;
  return {
    follow: parsed.flags.follow === true || parsed.flags.f === true,
    lines: Number.isNaN(lines) ? 50 : lines,
  };
}
