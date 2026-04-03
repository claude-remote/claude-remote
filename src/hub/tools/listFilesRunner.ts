import type { ToolRunner } from '@/hub/ToolEngine';
import { listEntries } from '@/server/files/listEntries';
import { validatePath } from '@/server/files/pathValidator';

export function createListFilesRunner(allowedRoots: string[]): ToolRunner {
  return async (input: Record<string, unknown>): Promise<string> => {
    const path = input.path;
    if (typeof path !== 'string' || !path.trim()) {
      throw new Error('list_files requires a non-empty "path" string');
    }

    const safePath = validatePath(path, allowedRoots);
    const entries = listEntries(safePath);

    return entries
      .map((e) => {
        const suffix = e.type === 'directory' ? '/' : '';
        const size = e.size != null ? ` (${e.size} bytes)` : '';
        return `${e.name}${suffix}${size}`;
      })
      .join('\n');
  };
}
