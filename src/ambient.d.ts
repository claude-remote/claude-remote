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
  export default sdk;
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
  const assistant: any;
  export default assistant;
}

declare module '*proactive/index.js' {
  const proactive: any;
  export default proactive;
}

declare module '*postCommitAttribution.js' {
  const postCommitAttribution: any;
  export default postCommitAttribution;
}

declare module '*Transport.js' {
  export type Transport = any;
  const transport: any;
  export default transport;
}
