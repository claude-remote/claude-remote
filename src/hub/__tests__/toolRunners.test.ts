import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ToolEngine, type ToolEngineDeps, type ToolExecutionInput } from '@/hub/ToolEngine';
import { createBashRunner } from '@/hub/tools/bashRunner';
import { createReadFileRunner } from '@/hub/tools/readFileRunner';
import { createWriteFileRunner } from '@/hub/tools/writeFileRunner';
import { createEditFileRunner } from '@/hub/tools/editFileRunner';
import { createListFilesRunner } from '@/hub/tools/listFilesRunner';
import { registerCoreRunners } from '@/hub/tools/index';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function makeDeps(): ToolEngineDeps {
  return {
    store: {
      createToolExecution() {},
      updateToolExecution() {},
    },
    eventBus: {
      async publish() {},
    },
  };
}

function makeInput(overrides: Partial<ToolExecutionInput> = {}): ToolExecutionInput {
  return {
    sessionId: 'sess-1',
    toolName: 'test',
    input: {},
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('ToolEngine runner registration', () => {
  let engine: ToolEngine;

  beforeEach(() => {
    engine = new ToolEngine(makeDeps());
  });

  it('registerRunner makes execute call the registered runner', async () => {
    engine.registerRunner('echo', async (input) => {
      return `echoed: ${input.message}`;
    });

    const result = await engine.execute(
      makeInput({ toolName: 'echo', input: { message: 'hello' } }),
    );
    expect(result.status).toBe('completed');
    expect(result.output).toBe('echoed: hello');
  });

  it('returns error for unregistered tool when no explicit runner given', async () => {
    const result = await engine.execute(
      makeInput({ toolName: 'nonexistent', input: {} }),
    );
    expect(result.status).toBe('failed');
    expect(result.error).toContain('not implemented');
  });

  it('explicit runner takes precedence over registered runner', async () => {
    engine.registerRunner('tool', async () => 'registered');

    const result = await engine.execute(
      makeInput({ toolName: 'tool', input: {} }),
      async () => 'explicit',
    );
    expect(result.status).toBe('completed');
    expect(result.output).toBe('explicit');
  });
});

describe('bash runner', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bash-runner-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('executes echo hello and returns output', async () => {
    const runner = createBashRunner(tmpDir);
    const output = await runner({ command: 'echo hello' }, AbortSignal.timeout(5000));
    expect(output.trim()).toBe('hello');
  });

  it('returns non-zero exit code in output', async () => {
    const runner = createBashRunner(tmpDir);
    const output = await runner({ command: 'exit 42' }, AbortSignal.timeout(5000));
    expect(output).toContain('[exit code 42]');
  });

  it('rejects empty command', async () => {
    const runner = createBashRunner(tmpDir);
    await expect(runner({ command: '' }, AbortSignal.timeout(5000))).rejects.toThrow(
      'non-empty "command"',
    );
  });

  it('times out long-running commands', async () => {
    const runner = createBashRunner(tmpDir);
    await expect(
      runner({ command: 'sleep 60', timeout: 100 }, AbortSignal.timeout(5000)),
    ).rejects.toThrow('timed out');
  }, 10000);

  it('respects abort signal', async () => {
    const runner = createBashRunner(tmpDir);
    const controller = new AbortController();
    const promise = runner({ command: 'sleep 60' }, controller.signal);
    setTimeout(() => controller.abort(), 50);
    await expect(promise).rejects.toThrow('aborted');
  }, 10000);
});

describe('read_file runner', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'read-runner-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reads file content successfully', async () => {
    const filePath = join(tmpDir, 'test.txt');
    writeFileSync(filePath, 'line1\nline2\nline3');

    const runner = createReadFileRunner([tmpDir]);
    const output = await runner({ path: filePath }, AbortSignal.timeout(5000));
    expect(output).toBe('line1\nline2\nline3');
  });

  it('rejects path outside allowed roots', async () => {
    const runner = createReadFileRunner([tmpDir]);
    await expect(
      runner({ path: '/etc/passwd' }, AbortSignal.timeout(5000)),
    ).rejects.toThrow('path not allowed');
  });

  it('rejects empty path', async () => {
    const runner = createReadFileRunner([tmpDir]);
    await expect(runner({ path: '' }, AbortSignal.timeout(5000))).rejects.toThrow(
      'non-empty "path"',
    );
  });
});

describe('write_file runner', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'write-runner-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes file content successfully', async () => {
    const filePath = join(tmpDir, 'output.txt');
    const runner = createWriteFileRunner([tmpDir]);
    const output = await runner(
      { path: filePath, content: 'hello world' },
      AbortSignal.timeout(5000),
    );
    expect(output).toContain('wrote');
    expect(readFileSync(filePath, 'utf8')).toBe('hello world');
  });

  it('creates intermediate directories', async () => {
    const filePath = join(tmpDir, 'sub', 'dir', 'file.txt');
    const runner = createWriteFileRunner([tmpDir]);
    await runner({ path: filePath, content: 'deep write' }, AbortSignal.timeout(5000));
    expect(readFileSync(filePath, 'utf8')).toBe('deep write');
  });

  it('rejects path outside allowed roots', async () => {
    const runner = createWriteFileRunner([tmpDir]);
    await expect(
      runner({ path: '/tmp/outside.txt', content: 'bad' }, AbortSignal.timeout(5000)),
    ).rejects.toThrow('path not allowed');
  });
});

describe('edit_file runner', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'edit-runner-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('replaces old_string with new_string', async () => {
    const filePath = join(tmpDir, 'edit.txt');
    writeFileSync(filePath, 'hello world');

    const runner = createEditFileRunner([tmpDir]);
    await runner(
      { path: filePath, old_string: 'world', new_string: 'earth' },
      AbortSignal.timeout(5000),
    );
    expect(readFileSync(filePath, 'utf8')).toBe('hello earth');
  });

  it('throws when old_string is not found', async () => {
    const filePath = join(tmpDir, 'edit.txt');
    writeFileSync(filePath, 'hello world');

    const runner = createEditFileRunner([tmpDir]);
    await expect(
      runner(
        { path: filePath, old_string: 'missing', new_string: 'x' },
        AbortSignal.timeout(5000),
      ),
    ).rejects.toThrow('not found');
  });

  it('throws when old_string is ambiguous', async () => {
    const filePath = join(tmpDir, 'edit.txt');
    writeFileSync(filePath, 'aaa bbb aaa');

    const runner = createEditFileRunner([tmpDir]);
    await expect(
      runner(
        { path: filePath, old_string: 'aaa', new_string: 'ccc' },
        AbortSignal.timeout(5000),
      ),
    ).rejects.toThrow('ambiguous');
  });
});

describe('list_files runner', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'list-runner-'));
    mkdirSync(join(tmpDir, 'subdir'));
    writeFileSync(join(tmpDir, 'file1.txt'), 'content');
    writeFileSync(join(tmpDir, 'file2.txt'), 'more content');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('lists directory contents', async () => {
    const runner = createListFilesRunner([tmpDir]);
    const output = await runner({ path: tmpDir }, AbortSignal.timeout(5000));
    expect(output).toContain('subdir/');
    expect(output).toContain('file1.txt');
    expect(output).toContain('file2.txt');
  });

  it('rejects path outside allowed roots', async () => {
    const runner = createListFilesRunner([tmpDir]);
    await expect(
      runner({ path: '/etc' }, AbortSignal.timeout(5000)),
    ).rejects.toThrow('path not allowed');
  });
});

describe('registerCoreRunners', () => {
  it('registers all 5 core runners', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'core-runners-'));
    const engine = new ToolEngine(makeDeps());
    registerCoreRunners(engine, tmpDir);

    // Write a file, then read it back via registered runners
    const filePath = join(tmpDir, 'test.txt');
    const writeResult = await engine.execute(
      makeInput({ toolName: 'write_file', input: { path: filePath, content: 'test content' } }),
    );
    expect(writeResult.status).toBe('completed');

    const readResult = await engine.execute(
      makeInput({ toolName: 'read_file', input: { path: filePath } }),
    );
    expect(readResult.status).toBe('completed');
    expect(readResult.output).toBe('test content');

    // List files
    const listResult = await engine.execute(
      makeInput({ toolName: 'list_files', input: { path: tmpDir } }),
    );
    expect(listResult.status).toBe('completed');
    expect(listResult.output).toContain('test.txt');

    // Edit file
    const editResult = await engine.execute(
      makeInput({
        toolName: 'edit_file',
        input: { path: filePath, old_string: 'test content', new_string: 'edited content' },
      }),
    );
    expect(editResult.status).toBe('completed');

    // Bash
    const bashResult = await engine.execute(
      makeInput({ toolName: 'bash', input: { command: 'echo works' } }),
    );
    expect(bashResult.status).toBe('completed');
    expect(bashResult.output?.trim()).toBe('works');

    rmSync(tmpDir, { recursive: true, force: true });
  });
});
