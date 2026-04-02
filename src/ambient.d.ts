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

declare namespace React {
  namespace JSX {
    interface IntrinsicElements {
      'ink-box': any
      'ink-text': any
      'ink-link': any
      'ink-raw-ansi': any
    }
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

declare module 'bidi-js' {
  const mod: any
  export = mod
}

declare module 'code-excerpt' {
  export type CodeExcerpt = {
    line: number
    value: string
  }
  const codeExcerpt: any
  export default codeExcerpt
}

declare module 'signal-exit' {
  export const onExit: any
}

declare module 'lru-cache' {
  export class LRUCache<K = any, V = any> {
    size: number
    max: number
    maxSize: number
    calculatedSize: number
    constructor(...args: any[])
    get(...args: any[]): V | undefined
    set(...args: any[]): this
    has(...args: any[]): boolean
    delete(...args: any[]): boolean
    clear(...args: any[]): void
    keys(...args: any[]): Generator<K, any, any>
    entries(...args: any[]): Generator<[K, V], any, any>
    dump(...args: any[]): any[]
    load(...args: any[]): void
    peek(...args: any[]): V | undefined
  }
  const mod: any
  export default mod
}

declare module 'https-proxy-agent' {
  export type HttpsProxyAgentOptions<T = any> = any
  export type HttpsProxyAgent<T = any> = any
  export const HttpsProxyAgent: any
}

declare module 'react-router-dom' {
  export const BrowserRouter: any
  export const Navigate: any
  export const Route: any
  export const Routes: any
  export const useLocation: any
  export const useNavigate: any
  export const useParams: any
  const mod: any
  export default mod
}

declare module 'vite' {
  export const defineConfig: any
}

declare module '@vitejs/plugin-react' {
  const mod: any
  export default mod
}

declare module '@anthropic-ai/sandbox-runtime' {
  export type FsReadRestrictionConfig = any
  export type FsWriteRestrictionConfig = any
  export type IgnoreViolationsConfig = any
  export type NetworkHostPattern = any
  export type NetworkRestrictionConfig = any
  export type SandboxAskCallback = any
  export type SandboxDependencyCheck = any
  export type SandboxRuntimeConfig = any
  export type SandboxViolationEvent = any
  export type SandboxViolationStore = any
  export const SandboxManager: any
  export const SandboxRuntimeConfigSchema: any
  export const SandboxViolationStore: any
}

declare module 'ajv' {
  export const Ajv: any
  const Ajv: any
  export default Ajv
}

declare module '@growthbook/growthbook' {
  export type GrowthBook = any
  export const GrowthBook: any
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

declare module '@modelcontextprotocol/sdk/types.js' {
  export const CallToolRequestSchema: any;
  export const CallToolResultSchema: any;
  export const ElicitRequestSchema: any;
  export const ElicitationCompleteNotificationSchema: any;
  export const JSONRPCMessageSchema: any;
  export const ListToolsRequestSchema: any;
  export const ListToolsResultSchema: any;
  export const ListPromptsResultSchema: any;
  export const ListResourcesResultSchema: any;
  export const ListRootsRequestSchema: any;
  export const PromptListChangedNotificationSchema: any;
  export const ResourceListChangedNotificationSchema: any;
  export const ToolListChangedNotificationSchema: any;
  export type CallToolResult = any;
  export type ElicitRequestParams = any;
  export type ElicitRequestFormParams = any;
  export type ElicitRequestURLParams = any;
  export type ElicitResult = any;
  export type EnumSchema = any;
  export const ErrorCode: any;
  export type JSONRPCMessage = any;
  export type ListToolsResult = any;
  export type ListPromptsResult = any;
  export type MultiSelectEnumSchema = any;
  export const McpError: any;
  export type PromptMessage = any;
  export type PrimitiveSchemaDefinition = any;
  export const ReadResourceResultSchema: any;
  export type ReadResourceResult = any;
  export type Resource = any;
  export type ResourceLink = any;
  export type ServerCapabilities = any;
  export type StringSchema = any;
  export type Tool = any;
  export type ToolAnnotations = any;
}

declare module '@modelcontextprotocol/sdk/server/index.js' {
  export const Server: any;
}

declare module '@modelcontextprotocol/sdk/server/stdio.js' {
  export const StdioServerTransport: any;
}

declare module '@modelcontextprotocol/sdk/client/index.js' {
  export type Client = any;
  export const Client: any;
}

declare module '@modelcontextprotocol/sdk/client/sse.js' {
  export type SSEClientTransportOptions = any;
  export const SSEClientTransport: any;
}

declare module '@modelcontextprotocol/sdk/client/stdio.js' {
  export const StdioClientTransport: any;
}

declare module '@modelcontextprotocol/sdk/client/streamableHttp.js' {
  export type StreamableHTTPClientTransportOptions = any;
  export const StreamableHTTPClientTransport: any;
}

declare module '@modelcontextprotocol/sdk/client/auth.js' {
  export const auth: any;
  export const discoverAuthorizationServerMetadata: any;
  export const discoverOAuthProtectedResourceMetadata: any;
  export const discoverOAuthServerInfo: any;
  export const exchangeAuthorization: any;
  export const refreshAuthorization: any;
  export const startAuthorization: any;
  export const UnauthorizedError: any;
  export type OAuthClientProvider = any;
  export type OAuthDiscoveryState = any;
}

declare module '@modelcontextprotocol/sdk/server/auth/errors.js' {
  export const InvalidGrantError: any;
  export const OAuthError: any;
  export const ServerError: any;
  export const TemporarilyUnavailableError: any;
  export const TooManyRequestsError: any;
}

declare module '@modelcontextprotocol/sdk/shared/auth.js' {
  export const OAuthErrorResponseSchema: any;
  export const OAuthMetadataSchema: any;
  export const OAuthTokensSchema: any;
  export const OpenIdProviderDiscoveryMetadataSchema: any;
  export type AuthorizationServerMetadata = any;
  export type OAuthClientInformation = any;
  export type OAuthClientInformationFull = any;
  export type OAuthClientMetadata = any;
  export type OpenIdProviderDiscoveryMetadata = any;
  export type OAuthTokens = any;
}

declare module '@modelcontextprotocol/sdk/shared/transport.js' {
  export const createFetchWithInit: any;
  export type FetchLike = any;
  export type Transport = any;
}

declare module 'hono' {
  export class Hono {
    use(...args: any[]): any
    get(...args: any[]): any
    patch(...args: any[]): any
    post(...args: any[]): any
    request(...args: any[]): Promise<Response>
    fetch(...args: any[]): any
  }
  export type MiddlewareHandler = any;
}

declare module 'hono/cors' {
  export const cors: any
}

declare module 'hono/logger' {
  export const logger: any
}

declare module 'usehooks-ts' {
  export function useInterval(...args: any[]): any
  export function useDebounceCallback(...args: any[]): any
  export function useEventCallback(...args: any[]): any
}

declare module 'fuse.js' {
  export type Fuse<T = any> = any;
  const Fuse: any;
  export default Fuse;
}

declare module '@aws-sdk/client-bedrock' {
  const bedrock: any;
  export = bedrock;
}

declare module '@anthropic-ai/mcpb' {
  export type McpbManifest = any;
  export type McpbUserConfigurationOption = any;
  const mcpb: any;
  export = mcpb;
}

declare module '@ant/computer-use-mcp' {
  export type ComputerExecutor = any;
  export type DisplayGeometry = any;
  export type FrontmostApp = any;
  export type InstalledApp = any;
  export type ResolvePrepareCaptureResult = any;
  export type RunningApp = any;
  export type ScreenshotResult = any;
  export type ComputerUseSessionContext = any;
  export type CuCallToolResult = any;
  export type CuPermissionRequest = any;
  export type CuPermissionResponse = any;
  export type ScreenshotDims = any;
  export const API_RESIZE_PARAMS: any;
  export const DEFAULT_GRANT_FLAGS: any;
  export const bindSessionContext: any;
  export const buildComputerUseTools: any;
  export const createComputerUseMcpServer: any;
  export const targetImageSize: any;
  const mod: any;
  export = mod;
}

declare module '@ant/computer-use-mcp/sentinelApps' {
  export const getSentinelCategory: any;
  const mod: any;
  export = mod;
}

declare module '@ant/computer-use-mcp/types' {
  export type ComputerUseHostAdapter = any;
  export type CoordinateMode = any;
  export type CuPermissionRequest = any;
  export type CuPermissionResponse = any;
  export type CuSubGates = any;
  export const DEFAULT_GRANT_FLAGS: any;
  export type Logger = any;
  const mod: any;
  export = mod;
}

declare module '@ant/computer-use-input' {
  export type ComputerUseInput = any;
  export type ComputerUseInputAPI = any;
  const mod: any;
  export = mod;
}

declare module '@ant/computer-use-swift' {
  export type ComputerUseAPI = any;
  const mod: any;
  export = mod;
}

declare module '@anthropic-ai/bedrock-sdk' {
  const mod: any;
  export = mod;
}

declare module '@anthropic-ai/foundry-sdk' {
  const mod: any;
  export = mod;
}

declare module '@anthropic-ai/vertex-sdk' {
  const mod: any;
  export = mod;
}

declare module '@aws-sdk/client-sts' {
  const mod: any;
  export = mod;
}

declare module '@aws-sdk/credential-providers' {
  const mod: any;
  export = mod;
}

declare module 'vitest' {
  export const afterAll: any;
  export const afterEach: any;
  export const beforeAll: any;
  export const beforeEach: any;
  export const describe: any;
  export const expect: any;
  export const it: any;
  export const test: any;
  export const vi: any;
}

declare module 'vscode-languageserver-protocol' {
  export type InitializeParams = any;
  export type InitializeResult = any;
  export type PublishDiagnosticsParams = any;
  export type ServerCapabilities = any;
  const mod: any;
  export = mod;
}

declare module 'highlight.js' {
  export const getLanguage: any
  export const highlight: any
  const mod: any
  export default mod
}

declare module 'plist' {
  const mod: any;
  export = mod;
}

declare module 'sharp' {
  const mod: any;
  export = mod;
}

declare module 'turndown' {
  const mod: any;
  export = mod;
}

declare module 'cacache' {
  const mod: any;
  export = mod;
}

declare module 'cli-highlight' {
  export const highlight: any;
  export const listLanguages: any;
  const mod: any;
  export default mod;
}

declare module 'audio-capture-napi' {
  const mod: any;
  export = mod;
}

declare module 'image-processor-napi' {
  const mod: any;
  export = mod;
}

declare module 'url-handler-napi' {
  const mod: any;
  export = mod;
}

declare module '@azure/identity' {
  const mod: any;
  export = mod;
}

declare module '*.md' {
  const content: string;
  export default content;
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

declare module '*ReviewArtifactTool/ReviewArtifactTool.js' {
  const mod: any;
  export = mod;
}

declare module '*ReviewArtifactPermissionRequest/ReviewArtifactPermissionRequest.js' {
  const mod: any;
  export = mod;
}

declare module '*WorkflowTool/WorkflowTool.js' {
  const mod: any;
  export = mod;
}

declare module '*WorkflowTool/WorkflowPermissionRequest.js' {
  const mod: any;
  export = mod;
}

declare module '*MonitorTool/MonitorTool.js' {
  const mod: any;
  export = mod;
}

declare module '*MonitorPermissionRequest/MonitorPermissionRequest.js' {
  const mod: any;
  export = mod;
}

declare module '*LocalWorkflowTask/LocalWorkflowTask.js' {
  const mod: any;
  export = mod;
}

declare module '*MonitorMcpTask/MonitorMcpTask.js' {
  const mod: any;
  export = mod;
}

declare module '*WorkflowDetailDialog.js' {
  const mod: any;
  export = mod;
}

declare module '*MonitorMcpDetailDialog.js' {
  const mod: any;
  export = mod;
}

declare module '*types/message.js' {
  export type AssistantMessage = any;
  export type AttachmentMessage<T = any> = any;
  export type CollapsedReadSearchGroup = any;
  export type CollapsibleMessage = any;
  export type CompactMetadata = any;
  export type MessageOrigin = any;
  export type RequestStartEvent = any;
  export type StopHookInfo = any;
  export type StreamEvent = any;
  export type SystemAgentsKilledMessage = any;
  export type SystemAwaySummaryMessage = any;
  export type SystemLocalCommandMessage = any;
  export type SystemPermissionRetryMessage = any;
  export type SystemScheduledTaskFireMessage = any;
  export type TombstoneMessage = any;
  export type ToolUseSummaryMessage = any;
  export type GroupedToolUseMessage = any;
  export type HookProgressMessage = any;
  export type HookResultMessage = any;
  export type Message = any;
  export type NormalizedAssistantMessage<T = any> = any;
  export type NormalizedMessage = any;
  export type NormalizedUserMessage = any;
  export type PartialCompactDirection = any;
  export type ProgressMessage<T = any> = any;
  export type RenderableMessage = any;
  export type SystemAPIErrorMessage = any;
  export type SystemApiMetricsMessage = any;
  export type SystemBridgeStatusMessage = any;
  export type SystemCompactBoundaryMessage = any;
  export type SystemFileSnapshotMessage = any;
  export type SystemInformationalMessage = any;
  export type SystemMemorySavedMessage = any;
  export type SystemMessage = any;
  export type SystemMessageLevel = any;
  export type SystemMicrocompactBoundaryMessage = any;
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
  export type BillingType = any;
  export type OAuthTokens = any;
  export type OAuthTokenExchangeResponse = any;
  export type OAuthProfileResponse = any;
  export type RateLimitTier = any;
  export type ReferralCampaign = any;
  export type ReferralEligibilityResponse = any;
  export type ReferralRedemptionsResponse = any;
  export type ReferrerRewardInfo = any;
  export type SubscriptionType = any;
  export type UserRolesResponse = any;
}

declare module '*types/messageQueueTypes.js' {
  export type QueueOperation = any;
  export type QueueOperationMessage = any;
}

declare module '*types/notebook.js' {
  export type NotebookCell = any;
  export type NotebookCellOutput = any;
  export type NotebookCellSource = any;
  export type NotebookCellSourceOutput = any;
  export type NotebookContent = any;
  export type NotebookOutputImage = any;
}

declare module '*services/lsp/types.js' {
  export type LspServerConfig = any;
  export type ScopedLspServerConfig = any;
  export type LspServerState = any;
}

declare module '*tools/SendUserFileTool/prompt.js' {
  export const SEND_USER_FILE_TOOL_NAME: string;
}

declare module '*tools/DiscoverSkillsTool/prompt.js' {
  export const DISCOVER_SKILLS_TOOL_NAME: string;
}

declare module '*tools/SnipTool/prompt.js' {
  export const SNIP_TOOL_NAME: string;
}

declare module '*assistant/*.js' {
  const mod: any;
  export = mod;
}

declare module '*bridge/*.js' {
  const mod: any;
  export = mod;
}

declare module '*cli/bg.js' {
  const mod: any;
  export = mod;
}

declare module '*cli/handlers/ant.js' {
  const mod: any;
  export = mod;
}

declare module '*cli/handlers/templateJobs.js' {
  const mod: any;
  export = mod;
}

declare module '*daemon/*.js' {
  const mod: any;
  export = mod;
}

declare module '*environment-runner/*.js' {
  const mod: any;
  export = mod;
}

declare module '*self-hosted-runner/*.js' {
  const mod: any;
  export = mod;
}

declare module '*jobs/*.js' {
  const mod: any;
  export = mod;
}

declare module '*query/transitions.js' {
  export const Continue: any;
  export const Terminal: any;
  const mod: any;
  export = mod;
}

declare module '*server/*.js' {
  const mod: any;
  export = mod;
}

declare module '*server/*/*.js' {
  const mod: any;
  export = mod;
}

declare module '*services/compact/cachedMCConfig.js' {
  const mod: any;
  export = mod;
}

declare module '*services/compact/cachedMicrocompact.js' {
  const mod: any;
  export = mod;
}

declare module '*compact/cachedMicrocompact.js' {
  const mod: any;
  export = mod;
}

declare module '*services/sessionTranscript/sessionTranscript.js' {
  const mod: any;
  export = mod;
}

declare module '*sessionTranscript/sessionTranscript.js' {
  const mod: any;
  export = mod;
}

declare module '*services/skillSearch/*.js' {
  const mod: any;
  export = mod;
}

declare module '*skillSearch/*.js' {
  const mod: any;
  export = mod;
}

declare module '*skills/mcpSkills.js' {
  const mod: any;
  export = mod;
}

declare module '*ssh/*.js' {
  const mod: any;
  export = mod;
}

declare module '*tasks/LocalWorkflowTask/*.js' {
  const mod: any;
  export = mod;
}

declare module '*tasks/MonitorMcpTask/*.js' {
  const mod: any;
  export = mod;
}

declare module '*tools/MonitorTool/*.js' {
  const mod: any;
  export = mod;
}

declare module '*tools/ReviewArtifactTool/*.js' {
  const mod: any;
  export = mod;
}

declare module '*tools/WorkflowTool/*.js' {
  const mod: any;
  export = mod;
}

declare module '*tools/WebBrowserTool/WebBrowserPanel.js' {
  const mod: any;
  export = mod;
}

declare module '*ui/option.js' {
  export const Option: any;
  const mod: any;
  export = mod;
}

declare module '*utils/ccshareResume.js' {
  const mod: any;
  export = mod;
}

declare module '*utils/eventLoopStallDetector.js' {
  const mod: any;
  export = mod;
}

declare module '*utils/sdkHeapDumpMonitor.js' {
  const mod: any;
  export = mod;
}

declare module '*utils/sessionDataUploader.js' {
  const mod: any;
  export = mod;
}

declare module '*utils/taskSummary.js' {
  const mod: any;
  export = mod;
}

declare module '*utils/udsClient.js' {
  const mod: any;
  export = mod;
}

declare module '*utils/udsMessaging.js' {
  const mod: any;
  export = mod;
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

declare module '*assistant/index.js' {
  export const initializeAssistantTeam: any;
  export const markAssistantForced: any;
  export const isAssistantForced: any;
  export const getAssistantSystemPromptAddendum: any;
  export const getAssistantActivationPath: any;
}

declare module '*assistant/gate.js' {
  export const isKairosEnabled: any;
}

declare module '*assistant/sessionDiscovery.js' {
  const mod: any;
  export = mod;
}

declare module '*ssh/createSSHSession.js' {
  export type SSHSession = any;
  export const createSSHSession: any;
}

declare module '*server/parseConnectUrl.js' {
  const mod: any;
  export = mod;
}

declare module '*server/server.js' {
  const mod: any;
  export = mod;
}

declare module '*server/sessionManager.js' {
  const mod: any;
  export = mod;
}

declare module '*server/backends/dangerousBackend.js' {
  const mod: any;
  export = mod;
}

declare module '*server/serverBanner.js' {
  const mod: any;
  export = mod;
}

declare module '*server/serverLog.js' {
  const mod: any;
  export = mod;
}

declare module '*server/lockfile.js' {
  const mod: any;
  export = mod;
}

declare module '*server/connectHeadless.js' {
  const mod: any;
  export = mod;
}

declare module '*components/agents/SnapshotUpdateDialog.js' {
  const mod: any;
  export = mod;
}

declare module '*components/FeedbackSurvey/useFrustrationDetection.js' {
  export const useFrustrationDetection: any;
}

declare module '*hooks/notifs/useAntOrgWarningNotification.js' {
  export const useAntOrgWarningNotification: any;
}

declare module 'src/cli/up.js' {
  const mod: any;
  export = mod;
}

declare module 'src/cli/rollback.js' {
  const mod: any;
  export = mod;
}

declare module '*services/skillSearch/prefetch.js' {
  const mod: any;
  export = mod;
}

declare module '*jobs/classifier.js' {
  const mod: any;
  export = mod;
}

declare module '*query/transitions.js' {
  export type Continue = any;
  export type Terminal = any;
  export const Continue: any;
  export const Terminal: any;
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
  export type NotebookCellType = any;
  export type NotebookCellOutput = any;
  export type NotebookCell = any;
  export type NotebookContent = any;
}

declare module '*daemon/*.js' {
  const mod: any;
  export = mod;
}

declare module '*services/skillSearch/signals.js' {
  const mod: any;
  export = mod;
}

declare module '*services/skillSearch/featureCheck.js' {
  const mod: any;
  export = mod;
}

declare module '*assistant/AssistantSessionChooser.js' {
  const mod: any;
  export = mod;
}

declare module '*assistant/sessionDiscovery.js' {
  export type AssistantSession = any;
}

declare module '*commands/assistant/assistant.js' {
  const mod: any;
  export = mod;
}

declare module '*bridge/webhookSanitizer.js' {
  const mod: any;
  export = mod;
}

declare module '*ssh/SSHSessionManager.js' {
  export type SSHSessionManager = any
  const mod: any;
  export = mod;
}

declare module '*ink/events/paste-event.js' {
  const mod: any;
  export = mod;
}

declare module '*ink/events/resize-event.js' {
  const mod: any;
  export = mod;
}

declare module '*ink/cursor.js' {
  const mod: any;
  export = mod;
}

declare module '*ink/devtools.js' {
  const mod: any;
  export = mod;
}

declare module '*services/tips/types.js' {
  const mod: any;
  export = mod;
}

declare module '*LocalWorkflowTask/LocalWorkflowTask.js' {
  export type LocalWorkflowTaskState = any
}

declare module '*MonitorMcpTask/MonitorMcpTask.js' {
  export type MonitorMcpTaskState = any
}

declare module '*types/tools.js' {
  export type REPLToolProgress = any
  export type ToolProgressData = any
}

declare module '*coordinator/workerAgent.js' {
  const mod: any;
  export = mod;
}

declare module '*bridge/peerSessions.js' {
  const mod: any;
  export = mod;
}

declare module '*types/message.js' {
  const mod: any;
  export = mod;
}

declare module '*utils/attributionTrailer.js' {
  const mod: any;
  export = mod;
}

declare module '*utils/udsClient.js' {
  const mod: any;
  export = mod;
}

declare module '*utils/protectedNamespace.js' {
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

declare module '*services/compact/cachedMicrocompact.js' {
  export type CacheEditsBlock = any;
  export type PinnedCacheEdits = any;
  export type CachedMCState = {
    pinnedEdits: PinnedCacheEdits[];
  };
  export function createCachedMCState(): CachedMCState;
  export function markToolsSentToAPI(state: CachedMCState): void;
  export function resetCachedMCState(state: CachedMCState): void;
}
