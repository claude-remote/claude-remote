import type { SessionMeta } from '@/shared/types';

export interface CliCommandDefinition {
  name: 'serve' | 'attach' | 'stop' | 'status' | 'token rotate' | 'logs';
  description: string;
}

export const COMMANDS: CliCommandDefinition[] = [
  { name: 'serve', description: 'Start the Claude Remote hub service.' },
  { name: 'attach', description: 'Attach a TUI client to a running hub.' },
  { name: 'stop', description: 'Gracefully stop the hub.' },
  { name: 'status', description: 'Show current hub health and active sessions.' },
  { name: 'token rotate', description: 'Rotate the master token and revoke sessions.' },
  { name: 'logs', description: 'Tail structured hub logs.' },
];

export function formatSessionSummary(session: Pick<SessionMeta, 'id' | 'name'>): string {
  // TODO(T26): mirror the final CLI UX for serve/attach/status outputs.
  return `${session.name} (${session.id})`;
}
