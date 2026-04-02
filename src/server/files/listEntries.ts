import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink';
  size?: number;
  modifiedAt?: number;
}

export function listEntries(dirPath: string): FileEntry[] {
  return readdirSync(dirPath, { withFileTypes: true })
    .map((entry) => {
      const path = join(dirPath, entry.name);
      const stats = statSync(path);

      return {
        name: entry.name,
        path,
        type: entry.isDirectory() ? 'directory' : entry.isSymbolicLink() ? 'symlink' : 'file',
        size: entry.isDirectory() ? undefined : stats.size,
        modifiedAt: stats.mtimeMs,
      } satisfies FileEntry;
    })
    .sort((a, b) => {
      if (a.type === b.type) {
        return a.name.localeCompare(b.name);
      }

      return a.type === 'directory' ? -1 : 1;
    });
}
