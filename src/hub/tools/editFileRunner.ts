import { readFileSync, writeFileSync } from 'node:fs';
import type { ToolRunner } from '@/hub/ToolEngine';
import { validatePath } from '@/server/files/pathValidator';

export function createEditFileRunner(allowedRoots: string[]): ToolRunner {
  return async (input: Record<string, unknown>): Promise<string> => {
    const path = input.path;
    if (typeof path !== 'string' || !path.trim()) {
      throw new Error('edit_file requires a non-empty "path" string');
    }

    const oldString = input.old_string;
    if (typeof oldString !== 'string') {
      throw new Error('edit_file requires an "old_string" string');
    }

    const newString = input.new_string;
    if (typeof newString !== 'string') {
      throw new Error('edit_file requires a "new_string" string');
    }

    const safePath = validatePath(path, allowedRoots);
    const content = readFileSync(safePath, 'utf8');

    const index = content.indexOf(oldString);
    if (index === -1) {
      throw new Error('old_string not found in file');
    }

    // Check for ambiguity — old_string should appear exactly once
    const secondIndex = content.indexOf(oldString, index + 1);
    if (secondIndex !== -1) {
      throw new Error('old_string is ambiguous: found multiple occurrences');
    }

    const updated = content.slice(0, index) + newString + content.slice(index + oldString.length);
    writeFileSync(safePath, updated, 'utf8');
    return `edited ${safePath}`;
  };
}
