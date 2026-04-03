import { spawn } from 'node:child_process';
import type { ToolRunner } from '@/hub/ToolEngine';

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 1024 * 1024; // 1 MB

export function createBashRunner(sessionCwd: string): ToolRunner {
  return async (input: Record<string, unknown>, signal: AbortSignal): Promise<string> => {
    const command = input.command;
    if (typeof command !== 'string' || !command.trim()) {
      throw new Error('bash runner requires a non-empty "command" string');
    }

    const timeoutMs =
      typeof input.timeout === 'number' && input.timeout > 0
        ? Math.min(input.timeout, DEFAULT_TIMEOUT_MS)
        : DEFAULT_TIMEOUT_MS;

    return new Promise<string>((resolve, reject) => {
      const child = spawn('sh', ['-c', command], {
        cwd: sessionCwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      let stdout = '';
      let stderr = '';
      let totalBytes = 0;
      let killed = false;

      const timer = setTimeout(() => {
        killed = true;
        child.kill('SIGKILL');
        reject(new Error(`command timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const onAbort = () => {
        killed = true;
        child.kill('SIGKILL');
        clearTimeout(timer);
        const err = new Error('command aborted');
        err.name = 'AbortError';
        reject(err);
      };

      signal.addEventListener('abort', onAbort, { once: true });

      child.stdout?.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes <= MAX_OUTPUT_BYTES) {
          stdout += chunk.toString('utf8');
        }
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes <= MAX_OUTPUT_BYTES) {
          stderr += chunk.toString('utf8');
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        if (!killed) reject(err);
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        if (killed) return;

        const truncated = totalBytes > MAX_OUTPUT_BYTES ? '\n[output truncated]' : '';
        const output = stdout + (stderr ? `\n--- stderr ---\n${stderr}` : '') + truncated;

        if (code !== 0) {
          resolve(`[exit code ${code}]\n${output}`);
        } else {
          resolve(output);
        }
      });
    });
  };
}
