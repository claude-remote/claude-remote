import type { PermissionRequest } from '@/shared/types';

/* ------------------------------------------------------------------ */
/*  Public types                                                       */
/* ------------------------------------------------------------------ */

export interface ToolExecutionInput {
  sessionId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export type ToolExecutionStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'crashed';

export interface ToolExecutionResult {
  executionId: string;
  toolName: string;
  status: ToolExecutionStatus;
  output?: string;
  error?: string;
}

/* ------------------------------------------------------------------ */
/*  Dependency interfaces (duck-typed for easy mocking)                */
/* ------------------------------------------------------------------ */

export interface ToolEngineStore {
  createToolExecution(exec: {
    id: string;
    sessionId: string;
    toolName: string;
    params?: Record<string, unknown>;
    status?: string;
  }): void;
  updateToolExecution(
    execId: string,
    updates: Partial<{
      status: string;
      result: string | null;
      finishedAt: number;
    }>,
  ): void;
}

export interface ToolEngineEventBus {
  publish(
    sessionId: string,
    event: Record<string, unknown>,
    opts?: { persist?: boolean },
  ): Promise<void>;
}

export interface ToolEngineDeps {
  store: ToolEngineStore;
  eventBus: ToolEngineEventBus;
}

/* ------------------------------------------------------------------ */
/*  Internal tracking                                                  */
/* ------------------------------------------------------------------ */

interface RunningEntry {
  sessionId: string;
  abortController: AbortController;
}

/* ------------------------------------------------------------------ */
/*  ToolEngine                                                         */
/* ------------------------------------------------------------------ */

export class ToolEngine {
  private runningTools = new Map<string, RunningEntry>();
  /** Per-session promise chain – ensures serial execution within a session. */
  private sessionQueues = new Map<string, Promise<unknown>>();
  /** Global concurrency tracking. */
  private globalRunning = 0;
  private readonly MAX_CONCURRENT: number;
  private readonly QUEUE_TIMEOUT_MS: number;
  /** Resolvers waiting for a global slot to open. */
  private waiters: Array<() => void> = [];

  constructor(
    private deps: ToolEngineDeps,
    opts?: { maxConcurrent?: number; queueTimeoutMs?: number },
  ) {
    this.MAX_CONCURRENT = opts?.maxConcurrent ?? 5;
    this.QUEUE_TIMEOUT_MS = opts?.queueTimeoutMs ?? 30_000;
  }

  /* ======================== Public API ======================== */

  /**
   * Execute a tool within a session.
   *
   * - Same session: serial (queued behind previous execution)
   * - Cross session: parallel up to MAX_CONCURRENT
   */
  async execute(
    input: ToolExecutionInput,
    /** The actual work to run. Receives an AbortSignal for cancellation. */
    runner?: (signal: AbortSignal) => Promise<string>,
  ): Promise<ToolExecutionResult> {
    const { sessionId, toolName } = input;
    const executionId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Record queued state in store
    this.deps.store.createToolExecution({
      id: executionId,
      sessionId,
      toolName,
      params: input.input,
      status: 'running',
    });

    // Chain onto the session queue so same-session executions are serial
    const prev = this.sessionQueues.get(sessionId) ?? Promise.resolve();
    const resultPromise = prev.then(() => this.runOne(executionId, input, runner));

    // Update the queue head (ignore rejections so subsequent tools still run)
    this.sessionQueues.set(
      sessionId,
      resultPromise.catch(() => {}),
    );

    return resultPromise;
  }

  /** Cancel a running tool execution. */
  async cancel(executionId: string): Promise<void> {
    const entry = this.runningTools.get(executionId);
    if (!entry) return;

    entry.abortController.abort();

    this.deps.store.updateToolExecution(executionId, {
      status: 'interrupted',
      finishedAt: Math.floor(Date.now() / 1000),
    });

    this.runningTools.delete(executionId);
  }

  /** Get execution IDs of running tools for a session. */
  getRunning(sessionId: string): string[] {
    const ids: string[] = [];
    for (const [execId, entry] of this.runningTools) {
      if (entry.sessionId === sessionId) {
        ids.push(execId);
      }
    }
    return ids;
  }

  /** Mark all currently-running executions as crashed (crash recovery on startup). */
  async markAllCrashed(): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    for (const [execId] of this.runningTools) {
      this.deps.store.updateToolExecution(execId, {
        status: 'crashed',
        finishedAt: now,
      });
    }
    this.runningTools.clear();
    this.globalRunning = 0;
    this.sessionQueues.clear();
  }

  /** Graceful shutdown: cancel all running tools, wait up to 5 s, force-kill remaining. */
  async shutdown(): Promise<void> {
    const ids = [...this.runningTools.keys()];
    for (const id of ids) {
      await this.cancel(id);
    }

    // Give a brief window for runners to observe the abort
    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    // Force-clear anything that's still lingering
    if (this.runningTools.size > 0) {
      const now = Math.floor(Date.now() / 1000);
      for (const [execId] of this.runningTools) {
        this.deps.store.updateToolExecution(execId, {
          status: 'interrupted',
          finishedAt: now,
        });
      }
      this.runningTools.clear();
    }
    this.globalRunning = 0;
    this.sessionQueues.clear();
    this.waiters = [];
  }

  /** Build a permission request for a tool call (SDK can_use_tool bridging). */
  buildPermissionRequest(input: ToolExecutionInput): PermissionRequest {
    return {
      id: `perm-${input.sessionId}-${input.toolName}`,
      sessionId: input.sessionId,
      toolName: input.toolName,
      toolInput: input.input,
      createdAt: Date.now(),
    };
  }

  /* ======================== Internals ======================== */

  /**
   * Acquire a global concurrency slot. If none available, wait up to
   * QUEUE_TIMEOUT_MS for one to free up.
   */
  private async acquireSlot(signal: AbortSignal): Promise<void> {
    if (this.globalRunning < this.MAX_CONCURRENT) {
      this.globalRunning++;
      return;
    }

    // Wait for a slot
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        // Remove ourselves from waiters
        const idx = this.waiters.indexOf(onSlot);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(new Error('Tool execution timed out waiting for a concurrency slot'));
      }, this.QUEUE_TIMEOUT_MS);

      const onAbort = () => {
        clearTimeout(timer);
        const idx = this.waiters.indexOf(onSlot);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(new Error('Cancelled while waiting for slot'));
      };

      signal.addEventListener('abort', onAbort, { once: true });

      const onSlot = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        this.globalRunning++;
        resolve();
      };

      this.waiters.push(onSlot);
    });
  }

  /** Release a global concurrency slot and wake the next waiter. */
  private releaseSlot(): void {
    this.globalRunning--;
    if (this.waiters.length > 0) {
      const next = this.waiters.shift()!;
      next();
    }
  }

  /** Run a single tool execution (called within the session's serial chain). */
  private async runOne(
    executionId: string,
    input: ToolExecutionInput,
    runner?: (signal: AbortSignal) => Promise<string>,
  ): Promise<ToolExecutionResult> {
    const abortController = new AbortController();

    this.runningTools.set(executionId, {
      sessionId: input.sessionId,
      abortController,
    });

    try {
      // Wait for a global slot
      await this.acquireSlot(abortController.signal);
    } catch (err) {
      this.runningTools.delete(executionId);
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.deps.store.updateToolExecution(executionId, {
        status: 'failed',
        result: errorMsg,
        finishedAt: Math.floor(Date.now() / 1000),
      });
      return {
        executionId,
        toolName: input.toolName,
        status: 'failed',
        error: errorMsg,
      };
    }

    try {
      const output = runner
        ? await runner(abortController.signal)
        : `Tool ${input.toolName} not implemented`;

      this.deps.store.updateToolExecution(executionId, {
        status: 'completed',
        result: output,
        finishedAt: Math.floor(Date.now() / 1000),
      });

      await this.deps.eventBus.publish(input.sessionId, {
        type: 'hub:session:statusChanged',
        sessionId: input.sessionId,
        status: 'active',
      });

      return {
        executionId,
        toolName: input.toolName,
        status: 'completed',
        output,
      };
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError';
      const status: ToolExecutionStatus = isAbort ? 'interrupted' : 'failed';
      const errorMsg = err instanceof Error ? err.message : String(err);

      this.deps.store.updateToolExecution(executionId, {
        status,
        result: errorMsg,
        finishedAt: Math.floor(Date.now() / 1000),
      });

      return {
        executionId,
        toolName: input.toolName,
        status,
        error: errorMsg,
      };
    } finally {
      this.runningTools.delete(executionId);
      this.releaseSlot();
    }
  }
}
