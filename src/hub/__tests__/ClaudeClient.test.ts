import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { ClaudeClient } from '@/hub/ClaudeClient';
import type { ClaudeClientDeps } from '@/hub/ClaudeClient';
import { EventBus } from '@/hub/EventBus';
import type { HubEvent } from '@/shared/protocol';
import type { Message, SessionConfig } from '@/shared/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<SessionConfig>): SessionConfig {
  return {
    model: 'claude-sonnet-4-20250514',
    effortLevel: 'medium',
    permissionMode: 'ask',
    ...overrides,
  };
}

function makeMessage(role: 'user' | 'assistant', text: string, id?: string): Message {
  return {
    id: id ?? `msg-${Date.now()}`,
    role,
    content: [{ type: 'text', text }],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Build a fake SSE response body from an array of SSE events.
 * Each event is { event, data } where data is a JSON-serialisable object.
 */
function buildSSEStream(
  events: Array<{ event: string; data: Record<string, unknown> }>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const chunks = events.map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`);
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

function buildFetchResponse(
  events: Array<{ event: string; data: Record<string, unknown> }>,
  status = 200,
): Response {
  return new Response(buildSSEStream(events), {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

// A minimal set of SSE events for a simple text response (no tool use).
function simpleTextSSE(text = 'Hello, world!') {
  return [
    {
      event: 'message_start',
      data: {
        type: 'message_start',
        message: { id: 'msg-1', role: 'assistant', usage: { input_tokens: 10 } },
      },
    },
    {
      event: 'content_block_start',
      data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    },
    {
      event: 'content_block_delta',
      data: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text },
      },
    },
    {
      event: 'content_block_stop',
      data: { type: 'content_block_stop', index: 0 },
    },
    {
      event: 'message_delta',
      data: {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: 5 },
      },
    },
    {
      event: 'message_stop',
      data: { type: 'message_stop' },
    },
  ];
}

// SSE events that include a tool_use block.
function toolUseSSE(toolId = 'tool-1', toolName = 'bash', inputJson = '{"cmd":"ls"}') {
  return [
    {
      event: 'message_start',
      data: {
        type: 'message_start',
        message: { id: 'msg-2', role: 'assistant', usage: { input_tokens: 20 } },
      },
    },
    {
      event: 'content_block_start',
      data: {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: toolId, name: toolName },
      },
    },
    {
      event: 'content_block_delta',
      data: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: inputJson },
      },
    },
    {
      event: 'content_block_stop',
      data: { type: 'content_block_stop', index: 0 },
    },
    {
      event: 'message_delta',
      data: {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use' },
        usage: { output_tokens: 15 },
      },
    },
    {
      event: 'message_stop',
      data: { type: 'message_stop' },
    },
  ];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ClaudeClient', () => {
  let eventBus: EventBus;
  let toolExecuteMock: ReturnType<typeof mock>;
  let deps: ClaudeClientDeps;
  let client: ClaudeClient;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    eventBus = new EventBus();
    toolExecuteMock = mock(() =>
      Promise.resolve({ toolName: 'bash', status: 'completed' as const, output: 'result' }),
    );
    deps = {
      eventBus,
      toolEngine: {
        execute: toolExecuteMock as any,
        buildPermissionRequest: mock() as any,
      } as any,
      apiKey: 'test-key',
      baseUrl: 'https://test.api.anthropic.com',
    };
    client = new ClaudeClient(deps);
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    client.shutdown();
    eventBus.destroy();
  });

  // -----------------------------------------------------------------------
  // Basic streaming
  // -----------------------------------------------------------------------

  it('sends a request and streams sdk:message events', async () => {
    const collected: HubEvent[] = [];
    eventBus.subscribe('sess-1', (e) => {
      collected.push(e);
    });

    globalThis.fetch = mock(() => Promise.resolve(buildFetchResponse(simpleTextSSE()))) as any;

    const handle = await client.sendMessage({
      sessionId: 'sess-1',
      messages: [makeMessage('user', 'Hi')],
      config: makeConfig(),
    });

    // Wait for streaming to complete
    await new Promise((r) => setTimeout(r, 50));

    // Should have published multiple sdk:message events (one per SSE event)
    const sdkMessages = collected.filter((e) => e.type === 'sdk:message');
    expect(sdkMessages.length).toBeGreaterThanOrEqual(4);

    // Should also have context:updated and cost:updated
    const contextEvents = collected.filter((e) => e.type === 'hub:context:updated');
    const costEvents = collected.filter((e) => e.type === 'hub:cost:updated');
    expect(contextEvents.length).toBe(1);
    expect(costEvents.length).toBe(1);

    expect(handle.cancel).toBeInstanceOf(Function);
  });

  // -----------------------------------------------------------------------
  // Abort
  // -----------------------------------------------------------------------

  it('abort cancels in-flight request', async () => {
    // Use a stream that never closes
    const neverEndingStream = new ReadableStream<Uint8Array>({
      start() {
        // intentionally never close
      },
    });

    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(neverEndingStream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    ) as any;

    const handle = await client.sendMessage({
      sessionId: 'sess-abort',
      messages: [makeMessage('user', 'Hi')],
      config: makeConfig(),
    });

    // Abort immediately
    await handle.cancel();

    // The controller should be removed
    // Verify by calling abort again — it should not throw
    await client.abort('sess-abort');
  });

  // -----------------------------------------------------------------------
  // Token tracking
  // -----------------------------------------------------------------------

  it('tracks token usage after response', async () => {
    globalThis.fetch = mock(() => Promise.resolve(buildFetchResponse(simpleTextSSE()))) as any;

    await client.sendMessage({
      sessionId: 'sess-usage',
      messages: [makeMessage('user', 'Hi')],
      config: makeConfig(),
    });

    await new Promise((r) => setTimeout(r, 50));

    const usage = client.getUsage('sess-usage');
    // The message_delta event has output_tokens: 5
    expect(usage.outputTokens).toBe(5);
    expect(usage.totalTokens).toBeGreaterThan(0);
  });

  it('returns zero usage for unknown session', () => {
    const usage = client.getUsage('nonexistent');
    expect(usage).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  });

  // -----------------------------------------------------------------------
  // Cost estimation
  // -----------------------------------------------------------------------

  it('estimates cost for known models', () => {
    // Sonnet: $3/M input, $15/M output
    const cost = client.estimateCost('claude-sonnet-4-20250514', 1_000_000, 1_000_000);
    expect(cost).toBe(18); // 3 + 15
  });

  it('estimates cost for Opus model', () => {
    // Opus: $15/M input, $75/M output
    const cost = client.estimateCost('claude-opus-4-20250514', 1_000_000, 500_000);
    expect(cost).toBe(15 + 37.5);
  });

  it('falls back to default pricing for unknown models', () => {
    const cost = client.estimateCost('claude-unknown-9000', 1_000_000, 1_000_000);
    // Default: $3/M input, $15/M output
    expect(cost).toBe(18);
  });

  // -----------------------------------------------------------------------
  // summarizeCost
  // -----------------------------------------------------------------------

  it('summarizeCost returns formatted cost for session', async () => {
    globalThis.fetch = mock(() => Promise.resolve(buildFetchResponse(simpleTextSSE()))) as any;

    await client.sendMessage({
      sessionId: 'sess-cost',
      messages: [makeMessage('user', 'Hi')],
      config: makeConfig(),
    });

    await new Promise((r) => setTimeout(r, 50));

    const summary = client.summarizeCost('sess-cost');
    expect(summary.apiCalls).toBe(1);
    expect(summary.outputTokens).toBe(5);
    expect(summary.formattedCost).toMatch(/^\$/);
    expect(summary.sessionDuration).toBeGreaterThanOrEqual(0);
  });

  it('summarizeCost returns zero for unknown session', () => {
    const summary = client.summarizeCost('unknown');
    expect(summary.sessionCost).toBe(0);
    expect(summary.formattedCost).toBe('$0.00');
  });

  // -----------------------------------------------------------------------
  // Tool use triggers ToolEngine
  // -----------------------------------------------------------------------

  it('tool_use blocks trigger ToolEngine execution', async () => {
    let fetchCallCount = 0;
    globalThis.fetch = mock(() => {
      fetchCallCount++;
      if (fetchCallCount === 1) {
        // First call: tool use
        return Promise.resolve(buildFetchResponse(toolUseSSE()));
      }
      // Second call (after tool result): simple text end
      return Promise.resolve(buildFetchResponse(simpleTextSSE()));
    }) as any;

    await client.sendMessage({
      sessionId: 'sess-tool',
      messages: [makeMessage('user', 'Run ls')],
      config: makeConfig(),
    });

    await new Promise((r) => setTimeout(r, 100));

    // ToolEngine.execute should have been called
    expect(toolExecuteMock).toHaveBeenCalledTimes(1);
    const call = (toolExecuteMock as any).mock.calls[0][0];
    expect(call.sessionId).toBe('sess-tool');
    expect(call.toolName).toBe('bash');
    expect(call.input).toEqual({ cmd: 'ls' });

    // Two API calls: first with tool_use, second with tool result
    expect(fetchCallCount).toBe(2);
  });

  // -----------------------------------------------------------------------
  // toSdkMessage mapping
  // -----------------------------------------------------------------------

  it('toSdkMessage maps content_block_delta correctly', () => {
    const msg = client.toSdkMessage({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'hi' },
    });
    expect(msg.type).toBe('assistant');
    expect(msg.subtype).toBe('delta');
  });

  it('toSdkMessage maps message_start correctly', () => {
    const msg = client.toSdkMessage({ type: 'message_start' });
    expect(msg.type).toBe('assistant');
    expect(msg.subtype).toBe('message_start');
  });

  it('toSdkMessage handles unknown type', () => {
    const msg = client.toSdkMessage({ type: 'ping' });
    expect(msg.type).toBe('assistant');
  });

  // -----------------------------------------------------------------------
  // Concurrent sessions
  // -----------------------------------------------------------------------

  it('supports concurrent chats in different sessions', async () => {
    globalThis.fetch = mock(() => Promise.resolve(buildFetchResponse(simpleTextSSE()))) as any;

    const events1: HubEvent[] = [];
    const events2: HubEvent[] = [];
    eventBus.subscribe('sess-a', (e) => {
      events1.push(e);
    });
    eventBus.subscribe('sess-b', (e) => {
      events2.push(e);
    });

    await Promise.all([
      client.sendMessage({
        sessionId: 'sess-a',
        messages: [makeMessage('user', 'Hi from A')],
        config: makeConfig(),
      }),
      client.sendMessage({
        sessionId: 'sess-b',
        messages: [makeMessage('user', 'Hi from B')],
        config: makeConfig(),
      }),
    ]);

    await new Promise((r) => setTimeout(r, 100));

    // Both sessions should have received events
    expect(events1.length).toBeGreaterThan(0);
    expect(events2.length).toBeGreaterThan(0);

    // Usage should be tracked independently
    const usageA = client.getUsage('sess-a');
    const usageB = client.getUsage('sess-b');
    expect(usageA.outputTokens).toBe(5);
    expect(usageB.outputTokens).toBe(5);
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  it('publishes error event on API failure', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response('Internal Server Error', { status: 500 })),
    ) as any;

    const collected: HubEvent[] = [];
    eventBus.subscribe('sess-err', (e) => {
      collected.push(e);
    });

    await client.sendMessage({
      sessionId: 'sess-err',
      messages: [makeMessage('user', 'Hi')],
      config: makeConfig(),
    });

    await new Promise((r) => setTimeout(r, 50));

    const errorEvents = collected.filter(
      (e) => e.type === 'sdk:message' && (e.payload as Record<string, unknown>).type === 'error',
    );
    expect(errorEvents.length).toBe(1);
  });

  // -----------------------------------------------------------------------
  // Shutdown
  // -----------------------------------------------------------------------

  it('shutdown aborts all active requests', async () => {
    const neverEndingStream = new ReadableStream<Uint8Array>({
      start() {
        /* never close */
      },
    });

    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(neverEndingStream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    ) as any;

    await client.sendMessage({
      sessionId: 'sess-s1',
      messages: [makeMessage('user', 'Hi')],
      config: makeConfig(),
    });
    await client.sendMessage({
      sessionId: 'sess-s2',
      messages: [makeMessage('user', 'Hi')],
      config: makeConfig(),
    });

    // Should not throw
    client.shutdown();

    // Subsequent abort calls should be no-ops
    await client.abort('sess-s1');
    await client.abort('sess-s2');
  });
});
