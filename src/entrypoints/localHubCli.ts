export type LocalHubCommand = 'attach' | 'serve' | 'status';

export function resolveLocalHubCommand(args: string[]): LocalHubCommand | null {
  const command = args[0];
  if (command === 'attach' || command === 'serve' || command === 'status') {
    return command;
  }

  return null;
}

export async function runLocalHubCommand(command: LocalHubCommand): Promise<void> {
  if (command === 'serve') {
    const handlers = await import('../cli/handlers/hub.js');
    await handlers.serveHubHandler();
    return;
  }

  if (command === 'attach') {
    const attachHandlers = await import('../cli/handlers/hubAttach.js');
    await attachHandlers.attachHubHandler();
    return;
  }

  const handlers = await import('../cli/handlers/hub.js');
  await handlers.statusHubHandler();
}
