import type { SDKMessage } from '@/shared/protocol';
import type { CostSummary, Message, SessionConfig } from '@/shared/types';

export interface ClaudeChatRequest {
  sessionId: string;
  messages: Message[];
  config: SessionConfig;
}

export interface ClaudeStreamHandle {
  cancel(): Promise<void>;
}

export class ClaudeClient {
  async sendMessage(_request: ClaudeChatRequest): Promise<ClaudeStreamHandle> {
    // TODO(T10): bind Claude requests to sessions, stream SDK events, and support abort.
    return {
      async cancel() {
        return undefined;
      },
    };
  }

  toSdkMessage(payload: Record<string, unknown>): SDKMessage {
    // TODO(T10): adapt official client stream payloads to SDK passthrough events.
    return {
      type: 'assistant',
      payload,
    };
  }

  summarizeCost(): CostSummary {
    // TODO(T10): accumulate per-session token/cost accounting.
    return {
      sessionCost: 0,
      formattedCost: '$0.00',
      inputTokens: 0,
      outputTokens: 0,
      apiCalls: 0,
      sessionDuration: 0,
    };
  }
}
