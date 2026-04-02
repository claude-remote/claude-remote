import { resolve, sep } from 'node:path';

function isWithinRoot(resolvedPath: string, allowedRoot: string): boolean {
  return resolvedPath === allowedRoot || resolvedPath.startsWith(`${allowedRoot}${sep}`);
}

export function validatePath(requestedPath: string, allowedRoots: string[]): string {
  if (requestedPath.includes('\0')) {
    throw new Error('path not allowed: null byte');
  }

  const resolvedPath = resolve(requestedPath);
  const resolvedRoots = allowedRoots.map((root) => resolve(root));

  if (!resolvedRoots.some((root) => isWithinRoot(resolvedPath, root))) {
    throw new Error('path not allowed: outside allowed roots');
  }

  return resolvedPath;
}
