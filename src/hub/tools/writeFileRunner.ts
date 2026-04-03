import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ToolRunner } from '@/hub/ToolEngine';
import { validatePath } from '@/server/files/pathValidator';

const MAX_WRITE_SIZE = 10 * 1024 * 1024; // 10 MB

export function createWriteFileRunner(allowedRoots: string[]): ToolRunner {
  return async (input: Record<string, unknown>): Promise<string> => {
    const path = input.path;
    if (typeof path !== 'string' || !path.trim()) {
      throw new Error('write_file requires a non-empty "path" string');
    }

    const content = input.content;
    if (typeof content !== 'string') {
      throw new Error('write_file requires a "content" string');
    }

    if (content.length > MAX_WRITE_SIZE) {
      throw new Error(`content exceeds maximum size of ${MAX_WRITE_SIZE} bytes`);
    }

    const safePath = validatePath(path, allowedRoots);
    mkdirSync(dirname(safePath), { recursive: true });
    writeFileSync(safePath, content, 'utf8');
    return `wrote ${content.length} bytes to ${safePath}`;
  };
}
