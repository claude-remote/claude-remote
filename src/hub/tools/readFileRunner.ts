import type { ToolRunner } from '@/hub/ToolEngine';
import { readFileContent } from '@/server/files/readFileContent';
import { validatePath } from '@/server/files/pathValidator';

export function createReadFileRunner(allowedRoots: string[]): ToolRunner {
  return async (input: Record<string, unknown>): Promise<string> => {
    const path = input.path;
    if (typeof path !== 'string' || !path.trim()) {
      throw new Error('read_file requires a non-empty "path" string');
    }

    const safePath = validatePath(path, allowedRoots);
    const offset = typeof input.offset === 'number' ? input.offset : 0;
    const limit = typeof input.limit === 'number' ? input.limit : 2000;

    const result = readFileContent(safePath, offset, limit);
    return result.content;
  };
}
