import type { HubEvent } from '@/shared/protocol';

type EventListener = (event: HubEvent) => void | Promise<void>;

export class EventBus {
  private destroyed = false;
  // Per-session listeners: Map<sessionId, Set<listener>>
  private sessionListeners = new Map<string, Set<EventListener>>();
  // Global listeners (for hub-wide events like mcp:statusChanged, auth:revoked, shutdown)
  private globalListeners = new Set<EventListener>();
  // Per-session monotonic seq counter
  private seqCounters = new Map<string, number>();
  // Per-listener queue depth tracking for backpressure
  private queueDepths = new Map<EventListener, number>();

  // Optional: persistence callback for events that should be stored
  private persistCallback?: (sessionId: string, event: HubEvent) => Promise<void>;

  // Backpressure callback — called when a listener's queue exceeds the limit
  onBackpressure?: (listener: EventListener) => void;

  constructor(opts?: {
    persistCallback?: (sessionId: string, event: HubEvent) => Promise<void>;
  }) {
    this.persistCallback = opts?.persistCallback;
  }

  /** Subscribe to a specific session's events. Returns an unsubscribe function. */
  subscribe(sessionId: string, listener: EventListener): () => void {
    const set = this.sessionListeners.get(sessionId) ?? new Set<EventListener>();
    set.add(listener);
    this.sessionListeners.set(sessionId, set);
    this.queueDepths.set(listener, 0);

    return () => {
      set.delete(listener);
      if (set.size === 0) {
        this.sessionListeners.delete(sessionId);
      }
      this.queueDepths.delete(listener);
    };
  }

  /** Subscribe to global events (hub-wide, not session-scoped). Returns an unsubscribe function. */
  subscribeGlobal(listener: EventListener): () => void {
    this.globalListeners.add(listener);
    this.queueDepths.set(listener, 0);

    return () => {
      this.globalListeners.delete(listener);
      this.queueDepths.delete(listener);
    };
  }

  /**
   * Publish an event to a session.
   * 1. Assign next seq number
   * 2. If persist requested, write to store first (write-ahead)
   * 3. Broadcast to all session listeners + global listeners
   * 4. Check backpressure: if listener queue > 1000, call onBackpressure
   */
  async publish(
    sessionId: string,
    event: Omit<HubEvent, 'seq'>,
    opts?: { persist?: boolean },
  ): Promise<void> {
    if (this.destroyed) return;
    const seq = this.nextSeq(sessionId);
    const fullEvent = { ...event, seq } as HubEvent;

    // Write-ahead: persist before broadcast
    if (opts?.persist && this.persistCallback) {
      await this.persistCallback(sessionId, fullEvent);
    }

    // Broadcast to session listeners
    const sessionSet = this.sessionListeners.get(sessionId);
    const listeners = sessionSet ? [...sessionSet] : [];

    // Also broadcast to global listeners
    const allListeners = [...listeners, ...this.globalListeners];

    await Promise.all(
      allListeners.map(async (listener) => {
        const depth = (this.queueDepths.get(listener) ?? 0) + 1;
        this.queueDepths.set(listener, depth);

        try {
          await listener(fullEvent);
        } finally {
          const current = this.queueDepths.get(listener) ?? 1;
          this.queueDepths.set(listener, current - 1);
        }

        // Check backpressure after delivery attempt
        if (depth > 1000 && this.onBackpressure) {
          this.onBackpressure(listener);
        }
      }),
    );
  }

  /**
   * Publish a global event (no session scope).
   * Global events like hub:auth:revoked and hub:shutdown may not carry seq.
   * For events that carry seq (e.g. hub:mcp:statusChanged), we use a reserved
   * global session key.
   */
  async publishGlobal(event: Omit<HubEvent, 'seq'>): Promise<void> {
    if (this.destroyed) return;
    const fullEvent = { ...event } as HubEvent;

    // Broadcast to all global listeners
    await Promise.all(
      [...this.globalListeners].map(async (listener) => listener(fullEvent)),
    );

    // Also broadcast to all session listeners across all sessions
    for (const [, set] of this.sessionListeners) {
      await Promise.all(
        [...set].map(async (listener) => listener(fullEvent)),
      );
    }
  }

  /** Get current seq for a session (0 if none published yet). */
  getSeq(sessionId: string): number {
    return this.seqCounters.get(sessionId) ?? 0;
  }

  /** Reset seq counter for a session (typically on session create). */
  resetSeq(sessionId: string): void {
    this.seqCounters.set(sessionId, 0);
  }

  /** Remove all session-scoped listeners for a given session. */
  removeAllListeners(sessionId: string): void {
    const set = this.sessionListeners.get(sessionId);
    if (set) {
      for (const listener of set) {
        this.queueDepths.delete(listener);
      }
      set.clear();
      this.sessionListeners.delete(sessionId);
    }
  }

  /** Tear down the entire EventBus, clearing all listeners and counters. */
  destroy(): void {
    for (const [, set] of this.sessionListeners) {
      set.clear();
    }
    this.sessionListeners.clear();
    this.globalListeners.clear();
    this.seqCounters.clear();
    this.queueDepths.clear();
    this.persistCallback = undefined;
    this.onBackpressure = undefined;
    this.destroyed = true;
  }

  /** Internal: allocate next monotonic seq for a session. */
  private nextSeq(sessionId: string): number {
    const next = (this.seqCounters.get(sessionId) ?? 0) + 1;
    this.seqCounters.set(sessionId, next);
    return next;
  }
}
