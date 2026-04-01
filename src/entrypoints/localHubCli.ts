export type LocalHubCommand = 'serve' | 'status'

export function resolveLocalHubCommand(
  args: string[],
): LocalHubCommand | null {
  const command = args[0]
  if (command === 'serve' || command === 'status') {
    return command
  }

  return null
}

export async function runLocalHubCommand(
  command: LocalHubCommand,
): Promise<void> {
  const handlers = await import('../cli/handlers/hub.js')

  if (command === 'serve') {
    await handlers.serveHubHandler()
    return
  }

  await handlers.statusHubHandler()
}
