export { createBashRunner } from './bashRunner.js';
export { createReadFileRunner } from './readFileRunner.js';
export { createWriteFileRunner } from './writeFileRunner.js';
export { createEditFileRunner } from './editFileRunner.js';
export { createListFilesRunner } from './listFilesRunner.js';

import type { ToolEngine } from '@/hub/ToolEngine';
import { createBashRunner } from './bashRunner.js';
import { createReadFileRunner } from './readFileRunner.js';
import { createWriteFileRunner } from './writeFileRunner.js';
import { createEditFileRunner } from './editFileRunner.js';
import { createListFilesRunner } from './listFilesRunner.js';

/**
 * Register all core tool runners on the given ToolEngine.
 * @param engine - The ToolEngine to register runners on
 * @param sessionCwd - The session working directory (used as allowed root and bash cwd)
 */
export function registerCoreRunners(engine: ToolEngine, sessionCwd: string): void {
  const allowedRoots = [sessionCwd];

  engine.registerRunner('bash', createBashRunner(sessionCwd));
  engine.registerRunner('read_file', createReadFileRunner(allowedRoots));
  engine.registerRunner('write_file', createWriteFileRunner(allowedRoots));
  engine.registerRunner('edit_file', createEditFileRunner(allowedRoots));
  engine.registerRunner('list_files', createListFilesRunner(allowedRoots));
}
