import { basename } from 'path'
import { cwd } from 'process'
import { HubClient } from '../../hub/client/HubClient.js'
import { getHubSocketPath } from '../../hub/paths.js'

export function ensureHubSessionName(sessionCwd: string): {
  cwd: string
  name: string
} {
  return {
    cwd: sessionCwd,
    name: basename(sessionCwd) || 'session',
  }
}

export async function attachHubHandler(): Promise<void> {
  const client = new HubClient({
    socketPath: getHubSocketPath(),
  })

  await client.connect()

  const sessionInfo = ensureHubSessionName(cwd())
  const sessions = await client.listSessions()
  const session = sessions[0] ?? (await client.createSession(sessionInfo))
  const snapshot = await client.attachSession(session.id)

  process.stdout.write(
    [
      `Attached to ${snapshot.session.name}`,
      `Session: ${snapshot.session.id}`,
      `CWD: ${snapshot.session.cwd}`,
    ].join('\n') + '\n',
  )

  await client.disconnect()
}
