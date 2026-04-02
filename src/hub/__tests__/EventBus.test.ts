import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '@/hub/EventBus';
import type { HubEvent } from '@/shared/protocol';

type SeqHubEvent = HubEvent & { seq: number };

function makeEvent(
  overrides: Partial<HubEvent> = {},
): Omit<HubEvent, 'seq'> {
  return {
    type: 'hub:session:statusChanged',
    sessionId: 'sess-1',
    status: 'active',
    ...overrides,
  } as Omit<HubEvent, 'seq'>;
}

describe('EventBus', () => {
  it('subscribe and receive events', async () => {
    const bus = new EventBus();
    const received: HubEvent[] = [];
    bus.subscribe('sess-1', (e) => { received.push(e); });

    await bus.publish('sess-1', makeEvent());

    expect(received).toHaveLength(1);
    expect(received[0]!.type).toBe('hub:session:statusChanged');
  });

  it('unsubscribe stops delivery', async () => {
    const bus = new EventBus();
    const received: HubEvent[] = [];
    const unsub = bus.subscribe('sess-1', (e) => { received.push(e); });

    await bus.publish('sess-1', makeEvent());
    expect(received).toHaveLength(1);

    unsub();
    await bus.publish('sess-1', makeEvent());
    expect(received).toHaveLength(1); // no new events
  });

  it('seq is monotonically incrementing per session', async () => {
    const bus = new EventBus();
    const seqs: number[] = [];
    bus.subscribe('sess-1', (e) => { seqs.push((e as SeqHubEvent).seq); });

    for (let i = 0; i < 10; i++) {
      await bus.publish('sess-1', makeEvent());
    }

    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('multi-listener broadcast: all listeners receive same event', async () => {
    const bus = new EventBus();
    const r1: HubEvent[] = [];
    const r2: HubEvent[] = [];
    const r3: HubEvent[] = [];

    bus.subscribe('sess-1', (e) => { r1.push(e); });
    bus.subscribe('sess-1', (e) => { r2.push(e); });
    bus.subscribe('sess-1', (e) => { r3.push(e); });

    await bus.publish('sess-1', makeEvent());

    expect(r1).toHaveLength(1);
    expect(r2).toHaveLength(1);
    expect(r3).toHaveLength(1);
    // All received the same seq
    expect((r1[0] as SeqHubEvent).seq).toBe(1);
    expect((r2[0] as SeqHubEvent).seq).toBe(1);
    expect((r3[0] as SeqHubEvent).seq).toBe(1);
  });

  it('session isolation: events on session A do not reach session B listeners', async () => {
    const bus = new EventBus();
    const receivedA: HubEvent[] = [];
    const receivedB: HubEvent[] = [];

    bus.subscribe('sess-a', (e) => { receivedA.push(e); });
    bus.subscribe('sess-b', (e) => { receivedB.push(e); });

    await bus.publish('sess-a', makeEvent({ sessionId: 'sess-a' } as Partial<HubEvent>));

    expect(receivedA).toHaveLength(1);
    expect(receivedB).toHaveLength(0);
  });

  it('global events reach all global listeners', async () => {
    const bus = new EventBus();
    const received: HubEvent[] = [];
    bus.subscribeGlobal((e) => { received.push(e); });

    await bus.publishGlobal({ type: 'hub:shutdown' } as Omit<HubEvent, 'seq'>);

    expect(received).toHaveLength(1);
    expect(received[0]!.type).toBe('hub:shutdown');
  });

  it('global listeners also receive session-scoped publish events', async () => {
    const bus = new EventBus();
    const globalReceived: HubEvent[] = [];
    const sessionReceived: HubEvent[] = [];

    bus.subscribeGlobal((e) => { globalReceived.push(e); });
    bus.subscribe('sess-1', (e) => { sessionReceived.push(e); });

    await bus.publish('sess-1', makeEvent());

    expect(sessionReceived).toHaveLength(1);
    expect(globalReceived).toHaveLength(1);
  });

  it('publishGlobal reaches session listeners too', async () => {
    const bus = new EventBus();
    const sessionReceived: HubEvent[] = [];
    bus.subscribe('sess-1', (e) => { sessionReceived.push(e); });

    await bus.publishGlobal({ type: 'hub:shutdown' } as Omit<HubEvent, 'seq'>);

    expect(sessionReceived).toHaveLength(1);
    expect(sessionReceived[0]!.type).toBe('hub:shutdown');
  });

  it('backpressure: onBackpressure called when queue exceeds 1000', async () => {
    const bus = new EventBus();
    const backpressured: EventListener[] = [];
    type EventListener = (event: HubEvent) => void | Promise<void>;

    // Create a slow listener that blocks, causing queue depth to grow
    let resolvers: Array<() => void> = [];
    const slowListener = (_e: HubEvent) => {
      return new Promise<void>((resolve) => {
        resolvers.push(resolve);
      });
    };

    bus.subscribe('sess-1', slowListener);
    bus.onBackpressure = (listener) => {
      backpressured.push(listener);
    };

    // Fire 1001 publishes concurrently without awaiting (to build up queue depth)
    const promises: Promise<void>[] = [];
    for (let i = 0; i < 1001; i++) {
      promises.push(bus.publish('sess-1', makeEvent()));
    }

    // The queue depth builds as promises are created but listeners haven't resolved
    // Resolve all pending listeners
    for (const resolve of resolvers) {
      resolve();
    }
    await Promise.all(promises);

    // onBackpressure should have been called for the slow listener
    expect(backpressured.length).toBeGreaterThan(0);
    expect(backpressured[0]).toBe(slowListener);
  });

  it('persist callback is called before broadcast', async () => {
    const callOrder: string[] = [];

    const persistCallback = async (_sessionId: string, _event: HubEvent) => {
      callOrder.push('persist');
    };

    const bus = new EventBus({ persistCallback });
    bus.subscribe('sess-1', (_e) => {
      callOrder.push('broadcast');
    });

    await bus.publish('sess-1', makeEvent(), { persist: true });

    expect(callOrder).toEqual(['persist', 'broadcast']);
  });

  it('persist callback is not called when persist option is false or absent', async () => {
    const persistFn = vi.fn();
    const bus = new EventBus({ persistCallback: persistFn });
    bus.subscribe('sess-1', () => {});

    await bus.publish('sess-1', makeEvent());
    await bus.publish('sess-1', makeEvent(), { persist: false });

    expect(persistFn).not.toHaveBeenCalled();
  });

  it('getSeq returns current seq, resetSeq resets it', async () => {
    const bus = new EventBus();
    bus.subscribe('sess-1', () => {});

    expect(bus.getSeq('sess-1')).toBe(0);

    await bus.publish('sess-1', makeEvent());
    await bus.publish('sess-1', makeEvent());
    expect(bus.getSeq('sess-1')).toBe(2);

    bus.resetSeq('sess-1');
    expect(bus.getSeq('sess-1')).toBe(0);

    await bus.publish('sess-1', makeEvent());
    expect(bus.getSeq('sess-1')).toBe(1);
  });

  it('removeAllListeners clears session listeners', async () => {
    const bus = new EventBus();
    const received: HubEvent[] = [];

    bus.subscribe('sess-1', (e) => { received.push(e); });
    bus.subscribe('sess-1', (e) => { received.push(e); });

    await bus.publish('sess-1', makeEvent());
    expect(received).toHaveLength(2);

    bus.removeAllListeners('sess-1');

    await bus.publish('sess-1', makeEvent());
    // No new events after removal
    expect(received).toHaveLength(2);
  });

  it('destroy clears everything', async () => {
    const bus = new EventBus();
    const sessionReceived: HubEvent[] = [];
    const globalReceived: HubEvent[] = [];

    bus.subscribe('sess-1', (e) => { sessionReceived.push(e); });
    bus.subscribeGlobal((e) => { globalReceived.push(e); });

    await bus.publish('sess-1', makeEvent());
    expect(sessionReceived).toHaveLength(1);
    expect(globalReceived).toHaveLength(1);

    bus.destroy();

    await bus.publish('sess-1', makeEvent());
    await bus.publishGlobal({ type: 'hub:shutdown' } as Omit<HubEvent, 'seq'>);

    expect(sessionReceived).toHaveLength(1); // unchanged
    expect(globalReceived).toHaveLength(1);  // unchanged
    expect(bus.getSeq('sess-1')).toBe(0);    // counters cleared
  });

  it('seq counters are independent per session', async () => {
    const bus = new EventBus();
    const seqsA: number[] = [];
    const seqsB: number[] = [];

    bus.subscribe('sess-a', (e) => { seqsA.push((e as SeqHubEvent).seq); });
    bus.subscribe('sess-b', (e) => { seqsB.push((e as SeqHubEvent).seq); });

    await bus.publish('sess-a', makeEvent({ sessionId: 'sess-a' } as Partial<HubEvent>));
    await bus.publish('sess-a', makeEvent({ sessionId: 'sess-a' } as Partial<HubEvent>));
    await bus.publish('sess-b', makeEvent({ sessionId: 'sess-b' } as Partial<HubEvent>));

    expect(seqsA).toEqual([1, 2]);
    expect(seqsB).toEqual([1]);
  });
});
