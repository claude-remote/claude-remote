import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  ToolEngine,
  type ToolEngineDeps,
  type ToolExecutionInput,
} from '@/hub/ToolEngine';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function makeDeps(): ToolEngineDeps & {
  store: { calls: Array<{ method: string; args: unknown[] }> };
  eventBus: { events: Array<{ sessionId: string; event: Record<string, unknown> }> };
} {
  const storeCalls: Array<{ method: string; args: unknown[] }> = [];
  const busEvents: Array<{ sessionId: string; event: Record<string, unknown> }> = [];

  return {
    store: {
      calls: storeCalls,
      createToolExecution(...args: unknown[]) {
        storeCalls.push({ method: 'createToolExecution', args });
      },
      updateToolExecution(...args: unknown[]) {
        storeCalls.push({ method: 'updateToolExecution', args });
      },
    },
    eventBus: {
      events: busEvents,
      async publish(sessionId: string, event: Record<string, unknown>) {
        busEvents.push({ sessionId, event });
      },
    },
  };
}

function makeInput(overrides: Partial<ToolExecutionInput> = {}): ToolExecutionInput {
  return {
    sessionId: 'sess-1',
    toolName: 'TestTool',
    input: { key: 'value' },
    ...overrides,
  };
}

/** Create a deferred promise for controlling async flow in tests. */
function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (err: Error) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('ToolEngine', () => {
  let deps: ReturnType<typeof makeDeps>;
  let engine: ToolEngine;

  beforeEach(() => {
    deps = makeDeps();
    engine = new ToolEngine(deps);
  });

  /* ---------- Serial execution within a session ---------- */

  it('executes tools serially within the same session', async () => {
    const order: number[] = [];
    const gate1 = deferred();

    const p1 = engine.execute(makeInput(), async () => {
      order.push(1);
      await gate1.promise;
      order.push(2);
      return 'result-1';
    });

    const p2 = engine.execute(makeInput(), async () => {
      order.push(3);
      return 'result-2';
    });

    // Tool 2 should not start until tool 1 finishes
    await new Promise((r) => setTimeout(r, 20));
    expect(order).toEqual([1]); // only tool 1 started

    gate1.resolve();
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(order).toEqual([1, 2, 3]);
    expect(r1.status).toBe('completed');
    expect(r1.output).toBe('result-1');
    expect(r2.status).toBe('completed');
    expect(r2.output).toBe('result-2');
  });

  /* ---------- Parallel execution across sessions ---------- */

  it('executes tools in parallel across different sessions', async () => {
    const started: string[] = [];
    const gate1 = deferred();
    const gate2 = deferred();

    const p1 = engine.execute(makeInput({ sessionId: 'sess-a' }), async () => {
      started.push('a');
      await gate1.promise;
      return 'a-done';
    });

    const p2 = engine.execute(makeInput({ sessionId: 'sess-b' }), async () => {
      started.push('b');
      await gate2.promise;
      return 'b-done';
    });

    // Give both a chance to start
    await new Promise((r) => setTimeout(r, 20));
    expect(started).toContain('a');
    expect(started).toContain('b');

    gate1.resolve();
    gate2.resolve();

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.status).toBe('completed');
    expect(r2.status).toBe('completed');
  });

  /* ---------- Global concurrency limit ---------- */

  it('blocks when global concurrency limit is reached', async () => {
    const smallEngine = new ToolEngine(deps, { maxConcurrent: 2 });
    const gates = [deferred(), deferred(), deferred()];
    const started: number[] = [];

    const p1 = smallEngine.execute(makeInput({ sessionId: 's1' }), async () => {
      started.push(1);
      await gates[0]!.promise;
      return '1';
    });
    const p2 = smallEngine.execute(makeInput({ sessionId: 's2' }), async () => {
      started.push(2);
      await gates[1]!.promise;
      return '2';
    });
    const p3 = smallEngine.execute(makeInput({ sessionId: 's3' }), async () => {
      started.push(3);
      await gates[2]!.promise;
      return '3';
    });

    // Wait for the first two to start
    await new Promise((r) => setTimeout(r, 20));
    expect(started).toHaveLength(2); // third is blocked

    // Release first slot
    gates[0]!.resolve();
    await p1;

    // Third should now start
    await new Promise((r) => setTimeout(r, 20));
    expect(started).toHaveLength(3);

    gates[1]!.resolve();
    gates[2]!.resolve();
    await Promise.all([p2, p3]);
  });

  /* ---------- Cancel ---------- */

  it('cancel interrupts a running tool', async () => {
    const gate = deferred();
    let execId = '';

    const p = engine.execute(makeInput(), async (signal) => {
      await new Promise<void>((resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
        gate.promise.then(() => resolve());
      });
      return 'done';
    });

    // Wait for it to start
    await new Promise((r) => setTimeout(r, 20));

    const running = engine.getRunning('sess-1');
    expect(running).toHaveLength(1);
    execId = running[0]!;

    await engine.cancel(execId);
    gate.resolve(); // unblock in case

    const result = await p;
    expect(result.status).toBe('interrupted');
  });

  /* ---------- Status tracking: completed ---------- */

  it('tracks status running → completed', async () => {
    const result = await engine.execute(makeInput(), async () => 'output');

    expect(result.status).toBe('completed');
    expect(result.output).toBe('output');

    // Store should have createToolExecution and updateToolExecution calls
    const creates = deps.store.calls.filter((c) => c.method === 'createToolExecution');
    const updates = deps.store.calls.filter((c) => c.method === 'updateToolExecution');
    expect(creates).toHaveLength(1);
    expect(updates.length).toBeGreaterThanOrEqual(1);

    const lastUpdate = updates[updates.length - 1]!;
    expect((lastUpdate.args[1] as Record<string, unknown>).status).toBe('completed');
  });

  /* ---------- Status tracking: failed ---------- */

  it('tracks status running → failed on error', async () => {
    const result = await engine.execute(makeInput(), async () => {
      throw new Error('tool broke');
    });

    expect(result.status).toBe('failed');
    expect(result.error).toBe('tool broke');

    const updates = deps.store.calls.filter((c) => c.method === 'updateToolExecution');
    const lastUpdate = updates[updates.length - 1]!;
    expect((lastUpdate.args[1] as Record<string, unknown>).status).toBe('failed');
  });

  /* ---------- markAllCrashed ---------- */

  it('markAllCrashed marks running tools as crashed', async () => {
    const gate = deferred();

    // Start a tool that blocks
    const p = engine.execute(makeInput(), async (signal) => {
      await new Promise<void>((resolve, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('abort'), { name: 'AbortError' })));
        gate.promise.then(() => resolve());
      });
      return 'done';
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(engine.getRunning('sess-1')).toHaveLength(1);

    await engine.markAllCrashed();

    expect(engine.getRunning('sess-1')).toHaveLength(0);

    const crashUpdates = deps.store.calls.filter(
      (c) =>
        c.method === 'updateToolExecution' &&
        (c.args[1] as Record<string, unknown>).status === 'crashed',
    );
    expect(crashUpdates).toHaveLength(1);

    // Clean up the blocked promise
    gate.resolve();
    await p.catch(() => {}); // may reject with interrupted
  });

  /* ---------- shutdown cancels all ---------- */

  it('shutdown cancels all running tools', async () => {
    const gate = deferred();

    const p = engine.execute(makeInput(), async (signal) => {
      await new Promise<void>((resolve, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('abort'), { name: 'AbortError' })));
        gate.promise.then(() => resolve());
      });
      return 'done';
    });

    await new Promise((r) => setTimeout(r, 20));

    await engine.shutdown();

    gate.resolve();
    const result = await p.catch(() => ({ status: 'interrupted' as const }));
    expect(result.status).toBe('interrupted');
    expect(engine.getRunning('sess-1')).toHaveLength(0);
  });

  /* ---------- Event bus notification ---------- */

  it('emits event on successful completion', async () => {
    await engine.execute(makeInput(), async () => 'ok');

    expect(deps.eventBus.events).toHaveLength(1);
    expect(deps.eventBus.events[0]!.sessionId).toBe('sess-1');
    expect(deps.eventBus.events[0]!.event.type).toBe('hub:session:statusChanged');
  });

  /* ---------- buildPermissionRequest ---------- */

  it('builds a permission request for a tool input', () => {
    const input = makeInput({ toolName: 'BashTool', input: { command: 'ls' } });
    const perm = engine.buildPermissionRequest(input);

    expect(perm.sessionId).toBe('sess-1');
    expect(perm.toolName).toBe('BashTool');
    expect(perm.toolInput).toEqual({ command: 'ls' });
    expect(perm.id).toMatch(/^perm-/);
  });

  /* ---------- Serial queue continues after failure ---------- */

  it('continues processing queue after a tool fails', async () => {
    const r1 = engine.execute(makeInput(), async () => {
      throw new Error('fail-1');
    });

    const r2 = engine.execute(makeInput(), async () => 'success-2');

    const [result1, result2] = await Promise.all([r1, r2]);
    expect(result1.status).toBe('failed');
    expect(result2.status).toBe('completed');
    expect(result2.output).toBe('success-2');
  });
});
