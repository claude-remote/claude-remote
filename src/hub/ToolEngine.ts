import type { PermissionRequest } from '@/shared/types';

export interface ToolExecutionInput {
  sessionId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface ToolExecutionResult {
  toolName: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  output?: string;
}

export class ToolEngine {
  async execute(_input: ToolExecutionInput): Promise<ToolExecutionResult> {
    // TODO(T09): wrap the existing tool system with cwd/AppState isolation and queueing.
    return {
      toolName: _input.toolName,
      status: 'queued',
    };
  }

  buildPermissionRequest(input: ToolExecutionInput): PermissionRequest {
    // TODO(T09): map tool calls to SDK can_use_tool approval requests.
    return {
      id: `perm-${input.sessionId}-${input.toolName}`,
      sessionId: input.sessionId,
      toolName: input.toolName,
      toolInput: input.input,
      createdAt: Date.now(),
    };
  }
}
