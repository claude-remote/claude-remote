import type { HubEvent } from '@/shared/protocol';

type EventListener = (event: HubEvent) => void | Promise<void>;

export class EventBus {
  readonly listeners = new Map<string, Set<EventListener>>();
  readonly seqBySession = new Map<string, number>();

  subscribe(sessionId: string, listener: EventListener): () => void {
    // TODO(T02): enforce queue/backpressure handling per client connection.
    const set = this.listeners.get(sessionId) ?? new Set<EventListener>();
    set.add(listener);
    this.listeners.set(sessionId, set);

    return () => {
      set.delete(listener);
      if (set.size === 0) {
        this.listeners.delete(sessionId);
      }
    };
  }

  nextSeq(sessionId: string): number {
    // TODO(T02): persist seq allocation alongside durable events.
    const next = (this.seqBySession.get(sessionId) ?? 0) + 1;
    this.seqBySession.set(sessionId, next);
    return next;
  }

  async publish(sessionId: string, event: HubEvent): Promise<void> {
    // TODO(T02): write durable events before broadcast and coalesce latest-value events.
    const listeners = this.listeners.get(sessionId);
    if (!listeners) {
      return;
    }

    await Promise.all([...listeners].map(async (listener) => listener(event)));
  }
}
