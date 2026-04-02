import type { EventBus } from '@/hub/EventBus';
import type { ToolEngine, ToolExecutionResult } from '@/hub/ToolEngine';
import type { HubEvent, SDKMessage } from '@/shared/protocol';
import type {
  ContextUsage,
  CostSummary,
  Message,
  SessionConfig,
  ToolUseBlock,
} from '@/shared/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClaudeChatRequest {
  sessionId: string;
  messages: Message[];
  config: SessionConfig;
}

export interface ClaudeStreamHandle {
  cancel(): Promise<void>;
}

export interface ClaudeClientDeps {
  eventBus: EventBus;
  toolEngine: ToolEngine;
  apiKey?: string;
  baseUrl?: string;
}

/** Per-session token accounting. */
interface SessionUsage {
  inputTokens: number;
  outputTokens: number;
  apiCalls: number;
  startedAt: number;
}

/** A single SSE event parsed from the Claude API stream. */
interface SSEEvent {
  event: string;
  data: string;
}

// ---------------------------------------------------------------------------
// Model pricing (per 1M tokens)
// ---------------------------------------------------------------------------

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-20250514': { input: 3, output: 15 },
  'claude-opus-4-20250514': { input: 15, output: 75 },
  'claude-haiku-3-20250307': { input: 0.25, output: 1.25 },
};

const DEFAULT_PRICING = { input: 3, output: 15 };

// ---------------------------------------------------------------------------
// ClaudeClient
// ---------------------------------------------------------------------------

export class ClaudeClient {
  private activeRequests = new Map<string, AbortController>();
  private sessionUsage = new Map<string, SessionUsage>();
  private deps: ClaudeClientDeps;

  constructor(deps: ClaudeClientDeps) {
    this.deps = deps;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Send a chat message and stream the response.
   * Returns a handle that can cancel the in-flight request.
   */
  async sendMessage(request: ClaudeChatRequest): Promise<ClaudeStreamHandle> {
    const { sessionId, messages, config } = request;

    // Abort any previous in-flight request for this session
    this.abort(sessionId);

    const controller = new AbortController();
    this.activeRequests.set(sessionId, controller);

    // Ensure usage tracking for this session
    if (!this.sessionUsage.has(sessionId)) {
      this.sessionUsage.set(sessionId, {
        inputTokens: 0,
        outputTokens: 0,
        apiCalls: 0,
        startedAt: Date.now(),
      });
    }

    // Run streaming in background — caller gets handle immediately
    this.streamChat(sessionId, messages, config, controller).catch(async (err) => {
      if ((err as Error).name !== 'AbortError') {
        await this.deps.eventBus.publish(sessionId, {
          type: 'sdk:message',
          sessionId,
          payload: {
            type: 'error',
            error: (err as Error).message ?? String(err),
          },
        } as Omit<HubEvent, 'seq'>);
      }
    });

    return {
      cancel: () => this.abort(sessionId),
    };
  }

  /** Abort current chat in a session. */
  async abort(sessionId: string): Promise<void> {
    const controller = this.activeRequests.get(sessionId);
    if (controller) {
      controller.abort();
      this.activeRequests.delete(sessionId);
    }
  }

  /** Convert a raw API payload to an SDKMessage suitable for the EventBus. */
  toSdkMessage(payload: Record<string, unknown>): SDKMessage {
    const apiType = typeof payload.type === 'string' ? payload.type : 'unknown';
    const { type: _ignoredType, ...rest } = payload;

    // Map Claude API event types to our SDK message types
    if (apiType === 'content_block_delta' || apiType === 'message_delta') {
      return { type: 'assistant', subtype: 'delta', apiType, ...rest };
    }
    if (apiType === 'content_block_start') {
      return { type: 'assistant', subtype: 'content_block_start', apiType, ...rest };
    }
    if (apiType === 'content_block_stop') {
      return { type: 'assistant', subtype: 'content_block_stop', apiType, ...rest };
    }
    if (apiType === 'message_start') {
      return { type: 'assistant', subtype: 'message_start', apiType, ...rest };
    }
    if (apiType === 'message_stop') {
      return { type: 'assistant', subtype: 'message_stop', apiType, ...rest };
    }

    return { type: 'assistant', apiType, ...rest };
  }

  /** Get accumulated cost summary for a session. */
  summarizeCost(sessionId?: string): CostSummary {
    if (!sessionId) {
      // Aggregate across all sessions
      let inputTokens = 0;
      let outputTokens = 0;
      let apiCalls = 0;
      let earliest = Date.now();
      for (const usage of this.sessionUsage.values()) {
        inputTokens += usage.inputTokens;
        outputTokens += usage.outputTokens;
        apiCalls += usage.apiCalls;
        earliest = Math.min(earliest, usage.startedAt);
      }
      const cost = this.estimateCost('claude-sonnet-4-20250514', inputTokens, outputTokens);
      return {
        sessionCost: cost,
        formattedCost: `$${cost.toFixed(4)}`,
        inputTokens,
        outputTokens,
        apiCalls,
        sessionDuration: Date.now() - earliest,
      };
    }

    const usage = this.sessionUsage.get(sessionId);
    if (!usage) {
      return {
        sessionCost: 0,
        formattedCost: '$0.00',
        inputTokens: 0,
        outputTokens: 0,
        apiCalls: 0,
        sessionDuration: 0,
      };
    }

    const cost = this.estimateCost(
      'claude-sonnet-4-20250514',
      usage.inputTokens,
      usage.outputTokens,
    );
    return {
      sessionCost: cost,
      formattedCost: `$${cost.toFixed(4)}`,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      apiCalls: usage.apiCalls,
      sessionDuration: Date.now() - usage.startedAt,
    };
  }

  /** Get raw token usage for a session. */
  getUsage(sessionId: string): {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  } {
    const usage = this.sessionUsage.get(sessionId);
    if (!usage) return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    return {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.inputTokens + usage.outputTokens,
    };
  }

  /** Estimate cost in USD based on model pricing. */
  estimateCost(model: string, inputTokens: number, outputTokens: number): number {
    const pricing = MODEL_PRICING[model] ?? DEFAULT_PRICING;
    return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
  }

  /**
   * Compact context by summarising a conversation via the API.
   * Returns a shortened message array.
   */
  async compact(sessionId: string, messages: Message[], config: SessionConfig): Promise<Message[]> {
    const apiKey = this.deps.apiKey ?? process.env.ANTHROPIC_API_KEY ?? '';
    const baseUrl =
      this.deps.baseUrl ?? process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com';

    const summaryRequest = {
      model: config.model,
      max_tokens: 1024,
      system:
        'You are a summariser. Condense the following conversation into a single concise summary message that preserves all critical context, decisions, and open tasks. Output only the summary text, no preamble.',
      messages: messages.map((m) => ({
        role: m.role === 'system' ? ('user' as const) : m.role,
        content:
          m.content.length === 1 && m.content[0]?.type === 'text'
            ? m.content[0]?.text
            : JSON.stringify(m.content),
      })),
    };

    const resp = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(summaryRequest),
    });

    if (!resp.ok) {
      throw new Error(`compact failed: ${resp.status} ${resp.statusText}`);
    }

    const body = (await resp.json()) as {
      content: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    // Track usage
    this.trackUsage(sessionId, body.usage);

    const summaryText =
      body.content
        ?.filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n') ?? '';

    const now = Date.now();
    return [
      {
        id: `compact-${now}`,
        role: 'user',
        content: [{ type: 'text', text: `[Context Summary]\n${summaryText}` }],
        createdAt: now,
        updatedAt: now,
      },
    ];
  }

  /** Shut down all active requests. */
  shutdown(): void {
    for (const controller of this.activeRequests.values()) {
      controller.abort();
    }
    this.activeRequests.clear();
  }

  // -----------------------------------------------------------------------
  // Internal: streaming
  // -----------------------------------------------------------------------

  /** Core streaming loop with agentic tool-use continuation. */
  private async streamChat(
    sessionId: string,
    messages: Message[],
    config: SessionConfig,
    controller: AbortController,
  ): Promise<void> {
    // Build a mutable conversation for the agentic loop
    const conversation = this.buildApiMessages(messages);
    const maxToolRounds = 25; // safety limit

    for (let round = 0; round < maxToolRounds; round++) {
      const result = await this.callApi(sessionId, conversation, config, controller);

      // If there are no tool_use blocks, we're done
      const toolBlocks: ToolUseBlock[] = result.toolUseBlocks;
      if (toolBlocks.length === 0) break;

      // Execute each tool and collect results
      const toolResults = await this.executeTools(sessionId, toolBlocks);

      // Append assistant message + tool results to conversation for next round
      conversation.push({
        role: 'assistant' as const,
        content: result.rawContentBlocks,
      });
      conversation.push({
        role: 'user' as const,
        content: toolResults.map((tr) => ({
          type: 'tool_result' as const,
          tool_use_id: tr.toolUseId,
          content: tr.output ?? '',
          is_error: tr.isError,
        })),
      });
    }

    // Clean up active request tracker
    this.activeRequests.delete(sessionId);
  }

  /** Make a single streaming API call and publish events to the EventBus. */
  private async callApi(
    sessionId: string,
    conversation: Array<{ role: string; content: unknown }>,
    config: SessionConfig,
    controller: AbortController,
  ): Promise<{
    toolUseBlocks: ToolUseBlock[];
    rawContentBlocks: unknown[];
  }> {
    const apiKey = this.deps.apiKey ?? process.env.ANTHROPIC_API_KEY ?? '';
    const baseUrl =
      this.deps.baseUrl ?? process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com';

    const body: Record<string, unknown> = {
      model: config.model,
      max_tokens: config.maxThinkingTokens ?? 8192,
      stream: true,
      messages: conversation,
    };

    const resp = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const errorText = await resp.text().catch(() => '');
      throw new Error(`Claude API error: ${resp.status} ${resp.statusText} – ${errorText}`);
    }

    const toolUseBlocks: ToolUseBlock[] = [];
    const rawContentBlocks: unknown[] = [];
    let currentToolBlock: Partial<ToolUseBlock> | null = null;
    let toolInputJson = '';

    // Parse SSE stream
    for await (const sseEvent of this.parseSSE(resp, controller.signal)) {
      if (controller.signal.aborted) break;

      const data = JSON.parse(sseEvent.data) as Record<string, unknown>;

      // Publish every event as an sdk:message
      await this.deps.eventBus.publish(sessionId, {
        type: 'sdk:message',
        sessionId,
        payload: this.toSdkMessage(data),
      } as Omit<HubEvent, 'seq'>);

      const eventType = sseEvent.event;

      if (eventType === 'content_block_start') {
        const block = (data as { content_block?: { type?: string; id?: string; name?: string } })
          .content_block;
        if (block?.type === 'tool_use') {
          currentToolBlock = { id: block.id, name: block.name };
          toolInputJson = '';
        } else {
          currentToolBlock = null;
        }
      } else if (eventType === 'content_block_delta') {
        const delta = (data as { delta?: { type?: string; partial_json?: string } }).delta;
        if (currentToolBlock && delta?.type === 'input_json_delta') {
          toolInputJson += delta.partial_json ?? '';
        }
      } else if (eventType === 'content_block_stop') {
        if (currentToolBlock?.id && currentToolBlock.name) {
          let parsedInput: Record<string, unknown> = {};
          try {
            parsedInput = JSON.parse(toolInputJson || '{}') as Record<string, unknown>;
          } catch {
            /* invalid JSON — keep empty */
          }
          const block: ToolUseBlock = {
            id: currentToolBlock.id,
            name: currentToolBlock.name,
            input: parsedInput,
          };
          toolUseBlocks.push(block);
          rawContentBlocks.push({ type: 'tool_use', ...block });
        } else if (!currentToolBlock) {
          // Text block ended — we already streamed deltas
        }
        currentToolBlock = null;
        toolInputJson = '';
      } else if (eventType === 'message_start') {
        // nothing extra — already published
      } else if (eventType === 'message_delta') {
        const usage = (data as { usage?: { output_tokens?: number } }).usage;
        if (usage) {
          this.trackUsage(sessionId, { output_tokens: usage.output_tokens });
        }
      } else if (eventType === 'message_stop') {
        const usage = (
          data as {
            message?: { usage?: { input_tokens?: number; output_tokens?: number } };
          }
        ).message?.usage;
        if (usage) {
          this.trackUsage(sessionId, usage);
        }
      }
    }

    // Increment API call count
    const su = this.sessionUsage.get(sessionId);
    if (su) su.apiCalls++;

    // Publish updated cost + context events
    await this.publishUsageEvents(sessionId, config.model);

    return { toolUseBlocks, rawContentBlocks };
  }

  // -----------------------------------------------------------------------
  // Internal: tool execution
  // -----------------------------------------------------------------------

  private async executeTools(
    sessionId: string,
    toolBlocks: ToolUseBlock[],
  ): Promise<Array<{ toolUseId: string; output: string; isError: boolean }>> {
    const results: Array<{ toolUseId: string; output: string; isError: boolean }> = [];

    for (const block of toolBlocks) {
      let execResult: ToolExecutionResult;
      try {
        execResult = await this.deps.toolEngine.execute({
          sessionId,
          toolName: block.name,
          input: block.input,
        });
      } catch (err) {
        results.push({
          toolUseId: block.id,
          output: `Tool execution error: ${(err as Error).message}`,
          isError: true,
        });
        continue;
      }

      results.push({
        toolUseId: block.id,
        output: execResult.output ?? '',
        isError: execResult.status === 'failed',
      });
    }

    return results;
  }

  // -----------------------------------------------------------------------
  // Internal: SSE parsing
  // -----------------------------------------------------------------------

  /** Parse an SSE stream from a fetch Response. */
  private async *parseSSE(response: Response, signal: AbortSignal): AsyncGenerator<SSEEvent> {
    const reader = response.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = '';
    let currentData = '';

    try {
      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // Keep the last partial line in the buffer
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            currentData += line.slice(6);
          } else if (line === '') {
            // Empty line = end of SSE event
            if (currentEvent && currentData) {
              yield { event: currentEvent, data: currentData };
            }
            currentEvent = '';
            currentData = '';
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // -----------------------------------------------------------------------
  // Internal: helpers
  // -----------------------------------------------------------------------

  /** Convert our Message[] to the Claude API messages format. */
  private buildApiMessages(
    messages: Message[],
  ): Array<{ role: 'user' | 'assistant'; content: unknown }> {
    return messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'system' ? ('user' as const) : m.role,
        content:
          m.content.length === 1 && m.content[0]?.type === 'text'
            ? m.content[0]?.text
            : m.content.map((block) => {
                if (block.type === 'text') return { type: 'text', text: block.text };
                if (block.type === 'tool_result') {
                  return {
                    type: 'tool_result',
                    tool_use_id: block.toolUseId,
                    content:
                      typeof block.content === 'string'
                        ? block.content
                        : JSON.stringify(block.content),
                    is_error: block.isError,
                  };
                }
                if (block.type === 'image') {
                  return {
                    type: 'image',
                    source: block.source,
                  };
                }
                // tool_use blocks in content
                return block;
              }),
      }));
  }

  /** Track token usage from API response. */
  private trackUsage(
    sessionId: string,
    usage?: { input_tokens?: number; output_tokens?: number },
  ): void {
    if (!usage) return;
    const su = this.sessionUsage.get(sessionId);
    if (!su) return;
    if (usage.input_tokens) su.inputTokens += usage.input_tokens;
    if (usage.output_tokens) su.outputTokens += usage.output_tokens;
  }

  /** Publish context and cost events after an API call. */
  private async publishUsageEvents(sessionId: string, model: string): Promise<void> {
    const usage = this.sessionUsage.get(sessionId);
    if (!usage) return;

    const totalTokens = usage.inputTokens + usage.outputTokens;
    const maxTokens = 200_000; // context window

    const contextUsage: ContextUsage = {
      usedTokens: totalTokens,
      maxTokens,
      percentage: Math.round((totalTokens / maxTokens) * 100),
      breakdown: [
        { label: 'input', tokens: usage.inputTokens },
        { label: 'output', tokens: usage.outputTokens },
      ],
    };

    const cost = this.estimateCost(model, usage.inputTokens, usage.outputTokens);

    await this.deps.eventBus.publish(sessionId, {
      type: 'hub:context:updated',
      sessionId,
      usage: contextUsage,
    } as Omit<HubEvent, 'seq'>);

    await this.deps.eventBus.publish(sessionId, {
      type: 'hub:cost:updated',
      sessionId,
      cost: {
        sessionCost: cost,
        formattedCost: `$${cost.toFixed(4)}`,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        apiCalls: usage.apiCalls,
        sessionDuration: Date.now() - usage.startedAt,
      },
    } as Omit<HubEvent, 'seq'>);
  }
}
