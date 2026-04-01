declare const MACRO: {
  VERSION: string;
  BUILD_TIME?: string;
  PACKAGE_URL?: string;
  FEEDBACK_CHANNEL?: string;
  VERSION_CHANGELOG?: string;
  ISSUES_EXPLAINER?: string;
  [key: string]: string | undefined;
};

type PromiseWithResolvers<T> = {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
};

declare function resolveAntModel(...args: any[]): any;
declare function getAntModels(...args: any[]): any;
declare function getAntModelOverrideConfig(...args: any[]): any;

declare namespace JSX {
  interface Element {}
  interface IntrinsicElements {
    [elemName: string]: any;
  }
}

declare module 'react/compiler-runtime' {
  export const c: any;
}

declare module 'qrcode' {
  export const toString: any;
  const qrcode: any;
  export default qrcode;
}

declare module 'ws' {
  const WebSocket: any;
  export default WebSocket;
}

declare module '@anthropic-ai/claude-agent-sdk' {
  const sdk: any;
  export type PermissionMode = any;
  export default sdk;
}

declare module '@aws-sdk/client-bedrock' {
  const bedrock: any;
  export = bedrock;
}

declare module '@anthropic-ai/mcpb' {
  const mcpb: any;
  export = mcpb;
}

declare module 'fflate' {
  const fflate: any;
  export = fflate;
}

declare module '@opentelemetry/exporter-metrics-otlp-grpc' {
  export const OTLPMetricExporter: any;
}

declare module '@opentelemetry/exporter-metrics-otlp-http' {
  export const OTLPMetricExporter: any;
}

declare module '@opentelemetry/exporter-metrics-otlp-proto' {
  export const OTLPMetricExporter: any;
}

declare module '@opentelemetry/exporter-prometheus' {
  export const PrometheusExporter: any;
}

declare module '@opentelemetry/exporter-logs-otlp-grpc' {
  export const OTLPLogExporter: any;
}

declare module '@opentelemetry/exporter-logs-otlp-http' {
  export const OTLPLogExporter: any;
}

declare module '@opentelemetry/exporter-logs-otlp-proto' {
  export const OTLPLogExporter: any;
}

declare module '@opentelemetry/exporter-trace-otlp-grpc' {
  export const OTLPTraceExporter: any;
}

declare module '@opentelemetry/exporter-trace-otlp-http' {
  export const OTLPTraceExporter: any;
}

declare module '@opentelemetry/exporter-trace-otlp-proto' {
  export const OTLPTraceExporter: any;
}

declare module '*types/message.js' {
  export type AssistantMessage = any;
  export type AttachmentMessage = any;
  export type CollapsedReadSearchGroup = any;
  export type GroupedToolUseMessage = any;
  export type HookProgressMessage = any;
  export type HookResultMessage = any;
  export type Message = any;
  export type NormalizedAssistantMessage = any;
  export type NormalizedMessage = any;
  export type NormalizedUserMessage = any;
  export type PartialCompactDirection = any;
  export type ProgressMessage = any;
  export type RenderableMessage = any;
  export type SystemAPIErrorMessage = any;
  export type SystemBridgeStatusMessage = any;
  export type SystemCompactBoundaryMessage = any;
  export type SystemFileSnapshotMessage = any;
  export type SystemInformationalMessage = any;
  export type SystemMemorySavedMessage = any;
  export type SystemMessage = any;
  export type SystemStopHookSummaryMessage = any;
  export type SystemThinkingMessage = any;
  export type SystemTurnDurationMessage = any;
  export type ToolUseBlock = any;
  export type UserMessage = any;
}

declare module '*types/tools.js' {
  export type AgentProgress = any;
  export type AgentToolProgress = any;
  export type BashProgress = any;
  export type HookProgress = any;
  export type MCPProgress = any;
  export type PowerShellProgress = any;
  export type RemoteSessionProgress = any;
  export type SdkWorkflowProgress = any;
  export type ShellProgress = any;
  export type SkillToolProgress = any;
  export type TaskOutputProgress = any;
  export type ToolCallProgress = any;
  export type ToolProgress = any;
  export type WebSearchProgress = any;
}

declare module '*constants/querySource.js' {
  export type QuerySource = any;
}

declare module '*assistant/index.js' {
  export const isAssistantMode: any;
  const assistant: any;
  export default assistant;
}

declare module '*proactive/index.js' {
  export const activateProactive: any;
  export const deactivateProactive: any;
  export const isProactiveActive: any;
  export const isProactivePaused: any;
  const proactive: any;
  export default proactive;
}

declare module '*postCommitAttribution.js' {
  export const installPrepareCommitMsgHook: any;
  const postCommitAttribution: any;
  export default postCommitAttribution;
}

declare module '*Transport.js' {
  export type Transport = any;
  const transport: any;
  export default transport;
}

declare module '*services/oauth/types.js' {
  export type OAuthTokens = any;
}

declare module '*commands/install-github-app/types.js' {
  const types: any;
  export = types;
}

declare module '*commands/plugin/types.js' {
  const types: any;
  export = types;
}

declare module '*commands/plugin/unifiedTypes.js' {
  const types: any;
  export = types;
}

declare module '*wizard/types.js' {
  export type WizardContextValue = any;
  export type WizardProviderProps<T = any> = any;
  export type WizardStepComponent<T = any> = any;
}

declare module '*components/agents/new-agent-creation/types.js' {
  const types: any;
  export = types;
}

declare module '*components/mcp/types.js' {
  export type AgentMcpServerInfo = any;
  export type MCPViewState = any;
  export type ServerInfo = any;
  export type ClaudeAIServerInfo = any;
  export type HTTPServerInfo = any;
  export type SSEServerInfo = any;
  export type StdioServerInfo = any;
}

declare module '*utils/secureStorage/types.js' {
  const types: any;
  export = types;
}

declare module '*services/contextCollapse/index.js' {
  const mod: any;
  export = mod;
}

declare module '*services/contextCollapse/operations.js' {
  const mod: any;
  export = mod;
}

declare module '*services/contextCollapse/persist.js' {
  const mod: any;
  export = mod;
}

declare module '*services/skillSearch/localSearch.js' {
  const mod: any;
  export = mod;
}

declare module '*commands/workflows/index.js' {
  const mod: any;
  export = mod;
}

declare module '*commands/peers/index.js' {
  const mod: any;
  export = mod;
}

declare module '*commands/fork/index.js' {
  const mod: any;
  export = mod;
}

declare module '*commands/buddy/index.js' {
  const mod: any;
  export = mod;
}

declare module '*tools/WorkflowTool/createWorkflowCommand.js' {
  const mod: any;
  export = mod;
}

declare module '*utils/attributionHooks.js' {
  const mod: any;
  export = mod;
}

declare module '*services/lsp/types.js' {
  const mod: any;
  export = mod;
}

declare module '*memdir/memoryShapeTelemetry.js' {
  const mod: any;
  export = mod;
}

declare module '*types/messageQueueTypes.js' {
  const mod: any;
  export = mod;
}

declare module '*types/notebook.js' {
  const mod: any;
  export = mod;
}

declare module '*tools/TerminalCaptureTool/prompt.js' {
  const mod: any;
  export = mod;
}

declare module '*tools/OverflowTestTool/OverflowTestTool.js' {
  const mod: any;
  export = mod;
}

declare module '*tools/VerifyPlanExecutionTool/constants.js' {
  const mod: any;
  export = mod;
}
