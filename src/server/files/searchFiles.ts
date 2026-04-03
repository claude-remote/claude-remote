import { execSync } from 'node:child_process';
import { validatePath } from './pathValidator.js';

export interface SearchMatch {
  file: string;
  line: number;
  content: string;
}

export interface SearchResult {
  matches: SearchMatch[];
  truncated: boolean;
}

const DEFAULT_MAX_RESULTS = 50;

export function searchFiles(
  pattern: string,
  searchPath: string,
  allowedRoots: string[],
  maxResults: number = DEFAULT_MAX_RESULTS,
): SearchResult {
  const safePath = validatePath(searchPath, allowedRoots);

  let output: string;
  try {
    // Use grep -rn with limited output. -I skips binary files.
    output = execSync(
      `grep -rn -I --include='*' -m ${maxResults + 1} -- ${escapeShellArg(pattern)} ${escapeShellArg(safePath)}`,
      {
        encoding: 'utf8',
        timeout: 10_000,
        maxBuffer: 5 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
  } catch (err: any) {
    // grep exits with code 1 when no matches found
    if (err.status === 1) {
      return { matches: [], truncated: false };
    }
    // Timeout or other error
    if (err.killed) {
      throw new Error('search timed out');
    }
    return { matches: [], truncated: false };
  }

  const lines = output.split('\n').filter(Boolean);
  const truncated = lines.length > maxResults;
  const matches: SearchMatch[] = lines.slice(0, maxResults).map((line) => {
    // Format: file:line:content
    const firstColon = line.indexOf(':');
    const secondColon = line.indexOf(':', firstColon + 1);
    if (firstColon === -1 || secondColon === -1) {
      return { file: line, line: 0, content: '' };
    }
    return {
      file: line.slice(0, firstColon),
      line: parseInt(line.slice(firstColon + 1, secondColon), 10) || 0,
      content: line.slice(secondColon + 1).trim(),
    };
  });

  return { matches, truncated };
}

function escapeShellArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}
