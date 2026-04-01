import type {
  Message,
  MessageContentBlock,
  PermissionRequest,
  SessionSnapshot,
  Task,
} from '@/shared/types';

// ── ANSI helpers ────────────────────────────────────────────────────

const ESC = '\x1b[';
const RESET = `${ESC}0m`;
const BOLD = `${ESC}1m`;
const DIM = `${ESC}2m`;
const CYAN = `${ESC}36m`;
const GREEN = `${ESC}32m`;
const YELLOW = `${ESC}33m`;
const RED = `${ESC}31m`;
const MAGENTA = `${ESC}35m`;
const BLUE = `${ESC}34m`;

function bold(s: string): string {
  return `${BOLD}${s}${RESET}`;
}
function dim(s: string): string {
  return `${DIM}${s}${RESET}`;
}
function cyan(s: string): string {
  return `${CYAN}${s}${RESET}`;
}
function green(s: string): string {
  return `${GREEN}${s}${RESET}`;
}
function yellow(s: string): string {
  return `${YELLOW}${s}${RESET}`;
}
function red(s: string): string {
  return `${RED}${s}${RESET}`;
}
function magenta(s: string): string {
  return `${MAGENTA}${s}${RESET}`;
}
function blue(s: string): string {
  return `${BLUE}${s}${RESET}`;
}

// ── Renderer ────────────────────────────────────────────────────────

/**
 * Simple terminal renderer for the TUI client.
 * Outputs role-colored prefixes, streaming deltas, tool cards,
 * and permission prompts -- no Ink dependency required.
 */
export class TuiRenderer {
  private currentStreamLine = '';
  private isStreaming = false;

  // ── Snapshot banner ───────────────────────────────────────────────

  renderSnapshot(snapshot: SessionSnapshot): void {
    const { meta, contextUsage, costSummary, clients } = snapshot;
    const writerStatus = snapshot.myWriterStatus === 'active' ? green('writer') : yellow('standby');

    this.writeLn('');
    this.writeLn(bold(`Session: ${meta.name}`) + dim(` (${meta.id.slice(0, 8)})`));
    this.writeLn(`  cwd:     ${meta.cwd}`);
    this.writeLn(`  status:  ${meta.status}  role: ${writerStatus}`);
    this.writeLn(
      `  context: ${contextUsage.percentage}%  cost: ${costSummary.formattedCost}  clients: ${clients.length}`,
    );
    this.writeLn(dim('─'.repeat(60)));

    // Replay recent messages
    for (const msg of snapshot.recentMessages) {
      this.renderMessage(msg);
    }

    // Show pending permissions
    for (const perm of snapshot.pendingPermissions) {
      this.renderPermissionBanner(perm);
    }

    this.writeLn('');
  }

  // ── Messages ──────────────────────────────────────────────────────

  renderMessage(msg: Message): void {
    const prefix = this.rolePrefix(msg.role);

    for (const block of msg.content) {
      this.renderContentBlock(prefix, block);
    }
  }

  private renderContentBlock(prefix: string, block: MessageContentBlock): void {
    switch (block.type) {
      case 'text':
        for (const line of block.text.split('\n')) {
          this.writeLn(`${prefix} ${line}`);
        }
        break;

      case 'tool_use':
        this.writeLn(`${prefix} ${this.formatToolCard(block.name, 'running', block.input)}`);
        break;

      case 'tool_result': {
        const content =
          typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
        const status = block.isError ? 'error' : 'done';
        const truncated = content.length > 200 ? `${content.slice(0, 200)}...` : content;
        this.writeLn(`${prefix} ${this.formatToolResult(status, truncated)}`);
        break;
      }

      case 'image':
        this.writeLn(`${prefix} ${dim('[image]')}`);
        break;
    }
  }

  // ── Streaming deltas ──────────────────────────────────────────────

  appendStreamDelta(text: string): void {
    this.isStreaming = true;
    this.currentStreamLine += text;

    // Handle newlines in the delta
    const lines = this.currentStreamLine.split('\n');
    if (lines.length > 1) {
      // Print all complete lines
      for (let i = 0; i < lines.length - 1; i++) {
        if (i === 0) {
          // First chunk: overwrite current line
          process.stdout.write(`\r${this.rolePrefix('assistant')} ${lines[i]}\n`);
        } else {
          process.stdout.write(`${this.rolePrefix('assistant')} ${lines[i]}\n`);
        }
      }
      this.currentStreamLine = lines[lines.length - 1]!;
    }

    // Overwrite the current incomplete line
    if (this.currentStreamLine) {
      process.stdout.write(
        `\r${this.rolePrefix('assistant')} ${this.currentStreamLine}`,
      );
    }
  }

  endStream(): void {
    if (this.isStreaming) {
      if (this.currentStreamLine) {
        process.stdout.write('\n');
      }
      this.currentStreamLine = '';
      this.isStreaming = false;
    }
  }

  // ── Tool cards ────────────────────────────────────────────────────

  renderToolStatus(
    toolName: string,
    status: 'running' | 'done' | 'error',
    detail?: string,
  ): void {
    this.writeLn(`  ${this.formatToolCard(toolName, status, detail ? { detail } : undefined)}`);
  }

  private formatToolCard(
    name: string,
    status: 'running' | 'done' | 'error',
    input?: Record<string, unknown>,
  ): string {
    const statusIcon =
      status === 'running' ? yellow('*') : status === 'done' ? green('+') : red('!');
    const inputSummary = input
      ? dim(` ${JSON.stringify(input).slice(0, 80)}`)
      : '';
    return `[${statusIcon} ${bold(name)}]${inputSummary}`;
  }

  private formatToolResult(status: 'done' | 'error', content: string): string {
    const icon = status === 'done' ? green('+') : red('!');
    return dim(`  ${icon} ${content}`);
  }

  // ── Permission prompt ─────────────────────────────────────────────

  renderPermissionBanner(req: PermissionRequest): void {
    this.writeLn('');
    this.writeLn(yellow(bold('  Permission Request')));
    this.writeLn(yellow(`  Tool: ${req.toolName}`));
    const inputStr = JSON.stringify(req.toolInput, null, 2);
    for (const line of inputStr.split('\n').slice(0, 10)) {
      this.writeLn(yellow(`    ${line}`));
    }
  }

  renderPermissionPrompt(req: PermissionRequest): void {
    this.renderPermissionBanner(req);
    process.stdout.write(yellow(bold('\n  [A]llow / [D]eny: ')));
  }

  // ── Task status ───────────────────────────────────────────────────

  renderTaskUpdate(task: Task): void {
    const icon =
      task.status === 'completed'
        ? green('+')
        : task.status === 'failed'
          ? red('!')
          : task.status === 'in_progress'
            ? yellow('*')
            : dim('o');
    this.writeLn(`  ${icon} ${bold(task.subject)} ${dim(task.status)}`);
  }

  // ── Info / Error ──────────────────────────────────────────────────

  info(msg: string): void {
    this.writeLn(blue(msg));
  }

  error(msg: string): void {
    this.writeLn(red(`error: ${msg}`));
  }

  warn(msg: string): void {
    this.writeLn(yellow(`warning: ${msg}`));
  }

  // ── Helpers ───────────────────────────────────────────────────────

  private rolePrefix(role: string): string {
    switch (role) {
      case 'user':
        return cyan(bold('you>'));
      case 'assistant':
        return magenta(bold('ai>'));
      case 'system':
        return dim('sys>');
      default:
        return dim(`${role}>`);
    }
  }

  private writeLn(line: string): void {
    process.stdout.write(`${line}\n`);
  }
}
