import { readFileSync, statSync } from 'node:fs';

export interface FileContent extends Record<string, unknown> {
  path: string;
  content: string;
  totalLines: number;
  offset: number;
  limit: number;
  size: number;
  modified: string;
}

export const MAX_FILE_SIZE = 10 * 1024 * 1024;

export function readFileContent(filePath: string, offset = 0, limit = 200): FileContent {
  const stats = statSync(filePath);
  if (stats.size > MAX_FILE_SIZE) {
    throw new Error(`File exceeds maximum size of 10MB: ${filePath}`);
  }

  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const pagedLines = lines.slice(offset, offset + limit);

  return {
    path: filePath,
    content: pagedLines.join('\n'),
    totalLines: lines.length,
    offset,
    limit,
    size: stats.size,
    modified: stats.mtime.toISOString(),
  };
}
