import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getHubRootDir } from './paths';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  [key: string]: unknown;
}

export interface Logger {
  debug(msg: string, extra?: Record<string, unknown>): void;
  info(msg: string, extra?: Record<string, unknown>): void;
  warn(msg: string, extra?: Record<string, unknown>): void;
  error(msg: string, extra?: Record<string, unknown>): void;
}

export type LogComponent = 'hub' | 'server' | 'ws' | 'auth' | 'store' | 'tool' | 'tunnel';

// ---------------------------------------------------------------------------
// Level helpers
// ---------------------------------------------------------------------------

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function parseLevel(raw: string | undefined): LogLevel {
  if (raw && raw in LEVEL_ORDER) return raw as LogLevel;
  return 'info';
}

// ---------------------------------------------------------------------------
// File rotation
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_ROTATED_FILES = 5;

function getLogDir(): string {
  return join(getHubRootDir(), 'logs');
}

function getLogFilePath(): string {
  return join(getLogDir(), 'hub.log');
}

/** Ensure the log directory exists. */
function ensureLogDir(): void {
  const dir = getLogDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Rotate the log file if it exceeds MAX_FILE_SIZE.
 * hub.log -> hub.log.1, hub.log.1 -> hub.log.2, etc.
 * Files beyond MAX_ROTATED_FILES are dropped.
 */
function rotateIfNeeded(logPath: string): void {
  if (!existsSync(logPath)) return;

  let size: number;
  try {
    size = statSync(logPath).size;
  } catch {
    return;
  }

  if (size < MAX_FILE_SIZE) return;

  // Shift existing rotated files
  for (let i = MAX_ROTATED_FILES - 1; i >= 1; i--) {
    const from = `${logPath}.${i}`;
    const to = `${logPath}.${i + 1}`;
    if (existsSync(from)) {
      try {
        renameSync(from, to);
      } catch {
        // best-effort
      }
    }
  }

  // Rotate current file to .1
  try {
    renameSync(logPath, `${logPath}.1`);
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// Sinks – where log lines are written
// ---------------------------------------------------------------------------

export type LogSink = (line: string) => void;

/** Console sink – writes to stderr (as is conventional for logs). */
export function consoleSink(line: string): void {
  process.stderr.write(`${line}\n`);
}

/** File sink – appends JSON line to the hub log file with rotation. */
export function fileSink(line: string): void {
  ensureLogDir();
  const logPath = getLogFilePath();
  rotateIfNeeded(logPath);
  appendFileSync(logPath, `${line}\n`);
}

// ---------------------------------------------------------------------------
// Global configuration
// ---------------------------------------------------------------------------

let globalLevel: LogLevel = parseLevel(process.env.CLAUDE_REMOTE_LOG_LEVEL);
let globalSinks: LogSink[] = [consoleSink, fileSink];

/** Override the global log level at runtime. */
export function setLogLevel(level: LogLevel): void {
  globalLevel = level;
}

export function getLogLevel(): LogLevel {
  return globalLevel;
}

/** Replace the default sinks (useful for testing). */
export function setSinks(sinks: LogSink[]): void {
  globalSinks = sinks;
}

// ---------------------------------------------------------------------------
// Logger factory
// ---------------------------------------------------------------------------

export function createLogger(component: string): Logger {
  function log(level: LogLevel, msg: string, extra?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[globalLevel]) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      component,
      message: msg,
      ...extra,
    };

    const line = JSON.stringify(entry);
    for (const sink of globalSinks) {
      try {
        sink(line);
      } catch {
        // never let a sink failure crash the process
      }
    }
  }

  return {
    debug: (msg, extra) => log('debug', msg, extra),
    info: (msg, extra) => log('info', msg, extra),
    warn: (msg, extra) => log('warn', msg, extra),
    error: (msg, extra) => log('error', msg, extra),
  };
}

// ---------------------------------------------------------------------------
// Metrics helper
// ---------------------------------------------------------------------------

export interface MetricsSnapshot {
  uptimeSeconds: number;
  sessionCount: number;
  connectionCount: number;
  apiCalls: number;
}

const metrics = {
  startTime: Date.now(),
  sessionCount: 0,
  connectionCount: 0,
  apiCalls: 0,
};

export function incrementMetric(
  key: 'sessionCount' | 'connectionCount' | 'apiCalls',
  delta = 1,
): void {
  metrics[key] += delta;
}

export function decrementMetric(
  key: 'sessionCount' | 'connectionCount' | 'apiCalls',
  delta = 1,
): void {
  metrics[key] = Math.max(0, metrics[key] - delta);
}

export function getMetrics(): MetricsSnapshot {
  return {
    uptimeSeconds: Math.floor((Date.now() - metrics.startTime) / 1000),
    sessionCount: metrics.sessionCount,
    connectionCount: metrics.connectionCount,
    apiCalls: metrics.apiCalls,
  };
}

/** Reset metrics start time and counters. Mainly useful for testing. */
export function resetMetrics(): void {
  metrics.startTime = Date.now();
  metrics.sessionCount = 0;
  metrics.connectionCount = 0;
  metrics.apiCalls = 0;
}

const metricsLogger = createLogger('hub');

/**
 * Log current metrics at info level.
 * Designed to be called periodically (e.g., every 60s via setInterval).
 */
export function logMetrics(): void {
  const snap = getMetrics();
  metricsLogger.info('metrics', {
    uptimeSeconds: snap.uptimeSeconds,
    sessionCount: snap.sessionCount,
    connectionCount: snap.connectionCount,
    apiCalls: snap.apiCalls,
  });
}
