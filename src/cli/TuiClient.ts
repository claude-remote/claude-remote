import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import type {
  ClientCommand,
  HubEvent,
  HubResponse,
  SDKControlRequest,
  SDKMessage,
} from '@/shared/protocol';
import type { PermissionRequest, SessionSnapshot } from '@/shared/types';
import { DEFAULT_PORT } from '@/shared/constants';
import { TuiRenderer } from '@/cli/TuiRenderer';

// ── Types ────────────────────────────────────────────────────────────

type EventHandler = (event: HubEvent) => void;

export interface TuiClientOptions {
  hubUrl: string;
  sessionId?: string;
}

// ── TuiClient ────────────────────────────────────────────────────────

/**
 * TUI WebSocket client that connects to the Hub,
 * maintains a local state mirror from snapshot + incremental events,
 * and provides an interactive terminal interface for chat, permissions,
 * and tool execution monitoring.
 *
 * Connection flow:
 *   1. POST /api/auth/ws-ticket  -> obtain a one-time WS ticket
 *   2. ws://host/ws?ticket=xxx&session=yyy  -> upgrade to WebSocket
 *   3. Receive hello -> store version info
 *   4. Receive snapshot -> store session state
 *   5. Subscribe to events -> update local state
 */
export class TuiClient {
  private ws: WebSocket | null = null;
  private snapshot: SessionSnapshot | null = null;
  private seq = 0;
  private nextCmdId = 0;
  private readonly eventHandlers: EventHandler[] = [];
  private readonly renderer = new TuiRenderer();
  private rl: ReadlineInterface | null = null;
  private hubUrl: string;
  private sessionId: string | undefined;
  private disconnecting = false;

  constructor(options: TuiClientOptions) {
    this.hubUrl = options.hubUrl.replace(/\/+$/, '');
    this.sessionId = options.sessionId;
  }

  // ── Connection lifecycle ──────────────────────────────────────────

  async connect(): Promise<void> {
    // 1. Obtain a WS ticket from the Hub HTTP API
    const ticket = await this.obtainTicket();

    // 2. Build WebSocket URL
    const wsBase = this.hubUrl.replace(/^http/, 'ws');
    const params = new URLSearchParams({ ticket });
    if (this.sessionId) {
      params.set('session', this.sessionId);
    }
    const wsUrl = `${wsBase}/ws?${params.toString()}`;

    // 3. Connect
    this.renderer.info(`Connecting to ${this.hubUrl}...`);

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      ws.addEventListener('open', () => {
        resolve();
      });

      ws.addEventListener('error', (ev) => {
        const msg = 'message' in ev ? String((ev as ErrorEvent).message) : 'WebSocket error';
        reject(new Error(msg));
      });

      ws.addEventListener('message', (ev) => {
        this.handleRawMessage(String(ev.data));
      });

      ws.addEventListener('close', () => {
        if (!this.disconnecting) {
          this.renderer.warn('Connection closed by hub.');
          this.teardownReadline();
        }
      });
    });
  }

  disconnect(): void {
    this.disconnecting = true;
    this.teardownReadline();
    if (this.ws && this.ws.readyState <= 1 /* CONNECTING or OPEN */) {
      this.ws.close(1000, 'client disconnect');
    }
    this.ws = null;
  }

  // ── Send commands ─────────────────────────────────────────────────

  send(cmd: Record<string, unknown>): void {
    const cmdId = `tui-${++this.nextCmdId}`;
    const payload = { ...cmd, cmdId };
    this.ws?.send(JSON.stringify(payload));
  }

  sendChat(text: string): void {
    this.send({ cmd: 'chat', text });
  }

  // ── Event subscription ────────────────────────────────────────────

  onEvent(handler: EventHandler): void {
    this.eventHandlers.push(handler);
  }

  // ── Permission prompt ─────────────────────────────────────────────

  async promptPermission(req: PermissionRequest): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.renderer.renderPermissionPrompt(req);

      const rl = createInterface({ input: process.stdin, output: process.stdout });
      rl.question('', (answer) => {
        rl.close();
        const accepted = answer.trim().toLowerCase().startsWith('a');
        resolve(accepted);
      });
    });
  }

  // ── Interactive REPL ──────────────────────────────────────────────

  /**
   * Start the interactive read-eval loop.
   * Reads lines from stdin and sends them as chat commands.
   * Returns a promise that resolves when the user exits (Ctrl-C or /quit).
   */
  async startRepl(): Promise<void> {
    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '\nyou> ',
    });

    this.rl.prompt();

    return new Promise<void>((resolve) => {
      this.rl!.on('line', (line: string) => {
        const trimmed = line.trim();

        if (!trimmed) {
          this.rl?.prompt();
          return;
        }

        if (trimmed === '/quit' || trimmed === '/exit') {
          this.disconnect();
          resolve();
          return;
        }

        if (trimmed === '/status') {
          if (this.snapshot) {
            this.renderer.renderSnapshot(this.snapshot);
          } else {
            this.renderer.warn('No snapshot available.');
          }
          this.rl?.prompt();
          return;
        }

        // Send as chat message
        this.sendChat(trimmed);
        this.rl?.prompt();
      });

      this.rl!.on('close', () => {
        this.disconnect();
        resolve();
      });
    });
  }

  // ── Internal: WS ticket ───────────────────────────────────────────

  private async obtainTicket(): Promise<string> {
    const url = `${this.hubUrl}/api/auth/ws-ticket`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch {
      throw new Error(
        `Could not reach hub at ${this.hubUrl}. Is it running?\n` +
          'Start it with: claude-remote serve',
      );
    }

    if (!res.ok) {
      throw new Error(`Failed to obtain WS ticket: HTTP ${res.status}`);
    }

    const body = (await res.json()) as Record<string, unknown>;
    const ticket = body.ticket;
    if (typeof ticket !== 'string') {
      throw new Error('Invalid ticket response from hub');
    }
    return ticket;
  }

  // ── Internal: message handling ────────────────────────────────────

  private handleRawMessage(raw: string): void {
    let response: HubResponse;
    try {
      response = JSON.parse(raw) as HubResponse;
    } catch {
      return;
    }

    switch (response.type) {
      case 'hello':
        this.renderer.info(`Connected to hub v${response.hubVersion} (protocol ${response.version})`);
        break;

      case 'snapshot':
        this.snapshot = response.snapshot;
        this.seq = response.snapshot.lastSeq;
        this.sessionId = response.snapshot.meta.id;
        this.renderer.renderSnapshot(response.snapshot);
        break;

      case 'event':
        this.handleEvent(response.event);
        break;

      case 'reply':
        // Command replies are currently logged only for errors
        break;

      case 'error':
        this.renderer.error(response.error);
        break;
    }
  }

  private handleEvent(event: HubEvent): void {
    // Update sequence number
    if ('seq' in event && typeof event.seq === 'number') {
      this.seq = Math.max(this.seq, event.seq);
    }

    // Dispatch to registered handlers
    for (const handler of this.eventHandlers) {
      handler(event);
    }

    // Update local state mirror and render
    switch (event.type) {
      case 'sdk:message':
        this.handleSdkMessage(event.payload);
        break;

      case 'sdk:control':
        this.handleSdkControl(event.payload);
        break;

      case 'hub:session:statusChanged':
        if (this.snapshot) {
          this.snapshot.meta.status = event.status;
        }
        this.renderer.info(`Session status: ${event.status}`);
        break;

      case 'hub:session:cwdChanged':
        if (this.snapshot) {
          this.snapshot.meta.cwd = event.cwd;
        }
        this.renderer.info(`Working directory: ${event.cwd}`);
        break;

      case 'hub:client:joined':
        if (this.snapshot) {
          this.snapshot.clients.push(event.client);
        }
        break;

      case 'hub:client:left':
        if (this.snapshot) {
          this.snapshot.clients = this.snapshot.clients.filter(
            (c) => c.id !== event.clientId,
          );
        }
        break;

      case 'hub:writer:changed':
        this.renderer.info(
          event.newWriterId
            ? `Writer changed to ${event.newWriterId.slice(0, 8)}`
            : 'No active writer',
        );
        break;

      case 'hub:context:updated':
        if (this.snapshot) {
          this.snapshot.contextUsage = event.usage;
        }
        break;

      case 'hub:cost:updated':
        if (this.snapshot) {
          this.snapshot.costSummary = event.cost;
        }
        break;

      case 'hub:config:changed':
        if (this.snapshot) {
          this.snapshot.config = event.config;
        }
        break;

      case 'hub:chat:cleared':
        if (this.snapshot) {
          this.snapshot.recentMessages = [];
        }
        this.renderer.info('Chat cleared.');
        break;

      case 'hub:shutdown':
        this.renderer.warn('Hub is shutting down.');
        this.disconnect();
        break;

      case 'hub:auth:revoked':
        this.renderer.error('Authentication revoked. Disconnecting.');
        this.disconnect();
        break;

      case 'hub:rateLimited':
        this.renderer.warn(
          `Rate limited (${event.scope}). Retry in ${Math.ceil(event.retryAfterMs / 1000)}s.`,
        );
        break;

      default:
        // Other events logged at debug level only
        break;
    }
  }

  private handleSdkMessage(payload: SDKMessage): void {
    // Handle streaming deltas
    if (payload.type === 'content_block_delta') {
      const delta = payload.delta as Record<string, unknown> | undefined;
      if (delta && typeof delta.text === 'string') {
        this.renderer.appendStreamDelta(delta.text);
      }
      return;
    }

    // End of message
    if (payload.type === 'message_stop' || payload.type === 'content_block_stop') {
      this.renderer.endStream();
      return;
    }

    // Tool use start
    if (payload.type === 'content_block_start') {
      const contentBlock = payload.content_block as Record<string, unknown> | undefined;
      if (contentBlock?.type === 'tool_use' && typeof contentBlock.name === 'string') {
        this.renderer.endStream();
        this.renderer.renderToolStatus(contentBlock.name, 'running');
      }
    }
  }

  private handleSdkControl(payload: SDKControlRequest): void {
    // Permission requests come through control messages
    const request = payload.request;
    if (request?.type === 'permission') {
      const permReq: PermissionRequest = {
        id: payload.requestId,
        sessionId: this.sessionId ?? '',
        toolName: (request.toolName as string) ?? 'unknown',
        toolInput: (request.toolInput as Record<string, unknown>) ?? {},
        createdAt: Date.now(),
      };

      // Add to snapshot
      if (this.snapshot) {
        this.snapshot.pendingPermissions.push(permReq);
      }

      // Prompt user
      this.promptPermission(permReq).then((allowed) => {
        // Remove from pending
        if (this.snapshot) {
          this.snapshot.pendingPermissions = this.snapshot.pendingPermissions.filter(
            (p) => p.id !== permReq.id,
          );
        }

        // Send response back
        this.send({
          cmd: 'control:respond',
          requestId: payload.requestId,
          response: {
            type: 'control_response',
            requestId: payload.requestId,
            response: { allowed },
          },
        });
      });
    }
  }

  // ── Internal: readline cleanup ────────────────────────────────────

  private teardownReadline(): void {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }
}

// ── Factory ─────────────────────────────────────────────────────────

/**
 * Create a TuiClient from CLI arguments.
 * Resolves the hub URL from --port flag or defaults.
 */
export function createTuiClient(options: {
  port?: number;
  hubUrl?: string;
  sessionId?: string;
}): TuiClient {
  const hubUrl =
    options.hubUrl ?? `http://localhost:${options.port ?? DEFAULT_PORT}`;
  return new TuiClient({ hubUrl, sessionId: options.sessionId });
}
