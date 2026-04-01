import type { SessionMeta } from '@/shared/types';

import {
  DEFAULT_BOOTSTRAP_TOKEN_TTL_MS,
  DEFAULT_AUTH_BLOCK_WINDOW_MS,
  DEFAULT_AUTH_RATE_LIMIT_MAX_FAILURES,
  DEFAULT_AUTH_TOKEN_BYTES,
  DEFAULT_SESSION_TOKEN_RENEW_THRESHOLD_MS,
  DEFAULT_SESSION_TOKEN_TTL_MS,
  DEFAULT_TOKEN_PATH,
  DEFAULT_WS_TICKET_TTL_MS,
} from '@/shared/constants';
import { access, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { constants as FsConstants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface TokenBundle {
  masterToken: string;
  sessionToken: string;
  expiresAt: number;
}

export interface JwtPayload {
  userId: string;
  iat: number;
  exp: number;
}

interface OneTimeTokenState {
  expiresAt: number;
  userId?: string;
}

interface FailureState {
  failures: number;
  bannedUntilMs?: number;
}

const HUB_CONFIG_DIR_NAME = '.claude-remote';
const masterTokenCache = new Map<string, string>();
const bootstrapTokenStore = new Map<string, OneTimeTokenState>();
const wsTicketStore = new Map<string, OneTimeTokenState>();
const authFailureStore = new Map<string, FailureState>();

function getHubConfigDir(configDirOverride?: string): string {
  if (configDirOverride?.trim()) {
    return configDirOverride.trim();
  }

  const overridden = process.env.CLAUDE_REMOTE_CONFIG_DIR;
  if (overridden?.trim()) {
    return overridden.trim();
  }

  return path.join(os.homedir(), HUB_CONFIG_DIR_NAME);
}

export function getMasterTokenPath(configDirOverride?: string): string {
  return path.join(getHubConfigDir(configDirOverride), path.basename(DEFAULT_TOKEN_PATH));
}

function createMasterToken(): string {
  return randomBytes(DEFAULT_AUTH_TOKEN_BYTES).toString('hex');
}

function toBase64Url(value: Uint8Array | string): string {
  const buffer = typeof value === 'string' ? Buffer.from(value) : Buffer.from(value);
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = padded.length % 4;
  const normalized = padLength === 0 ? padded : `${padded}${'='.repeat(4 - padLength)}`;
  return Buffer.from(normalized, 'base64').toString('utf8');
}

function sha256Equals(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function createJwtSignature(headerPayload: string, secret: string): string {
  return toBase64Url(createHmac('sha256', secret).update(headerPayload).digest());
}

function buildJwt(payload: JwtPayload, secret: string): string {
  const headerSegment = toBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payloadSegment = toBase64Url(JSON.stringify(payload));
  const headerPayload = `${headerSegment}.${payloadSegment}`;
  const signature = createJwtSignature(headerPayload, secret);
  return `${headerPayload}.${signature}`;
}

function parseJwt(token: string):
  | {
      headerPayload: string;
      payloadSegment: string;
      signature: string;
    }
  | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  return {
    headerPayload: `${parts[0]}.${parts[1]}`,
    payloadSegment: parts[1],
    signature: parts[2],
  };
}

function normalizeNow(now = Date.now()): number {
  return Number.isFinite(now) ? now : Date.now();
}

export async function loadMasterToken(configDir?: string): Promise<string | null> {
  const filePath = getMasterTokenPath(configDir);
  const cached = masterTokenCache.get(filePath);
  if (cached) {
    return cached;
  }

  try {
    await access(filePath, FsConstants.R_OK);
    const token = (await readFile(filePath, 'utf8')).trim();
    if (!token) {
      await unlink(filePath).catch(() => undefined);
      return null;
    }

    masterTokenCache.set(filePath, token);
    return token;
  } catch {
    return null;
  }
}

export async function rotateMasterToken(configDir?: string): Promise<string> {
  const filePath = getMasterTokenPath(configDir);
  const token = createMasterToken();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, token, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'w',
  });
  masterTokenCache.set(filePath, token);
  return token;
}

export async function ensureMasterToken(configDir?: string): Promise<string> {
  return (await loadMasterToken(configDir)) ?? rotateMasterToken(configDir);
}

export async function signSessionToken(
  userId: string,
  options?: {
    now?: number;
    ttlMs?: number;
    configDir?: string;
  },
): Promise<string> {
  const nowMs = normalizeNow(options?.now);
  const now = Math.floor(nowMs / 1000);
  const ttlMs = options?.ttlMs ?? DEFAULT_SESSION_TOKEN_TTL_MS;
  const secret = await ensureMasterToken(options?.configDir);

  return buildJwt(
    {
      userId,
      iat: now,
      exp: now + Math.floor(ttlMs / 1000),
    },
    secret,
  );
}

export async function verifySessionToken(
  token: string,
  options?: {
    now?: number;
    configDir?: string;
  },
): Promise<(JwtPayload & { needsRenewal: boolean }) | null> {
  const parsed = parseJwt(token);
  if (!parsed) {
    return null;
  }

  const secret = await loadMasterToken(options?.configDir);
  if (!secret) {
    return null;
  }

  const expectedSignature = createJwtSignature(parsed.headerPayload, secret);
  if (!sha256Equals(parsed.signature, expectedSignature)) {
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(fromBase64Url(parsed.payloadSegment));
  } catch {
    return null;
  }

  if (
    typeof payload !== 'object' ||
    payload === null ||
    typeof (payload as Record<string, unknown>).userId !== 'string' ||
    typeof (payload as Record<string, unknown>).iat !== 'number' ||
    typeof (payload as Record<string, unknown>).exp !== 'number'
  ) {
    return null;
  }

  const jwtPayload = payload as JwtPayload;
  const nowMs = normalizeNow(options?.now);
  const now = Math.floor(nowMs / 1000);
  if (!Number.isFinite(jwtPayload.iat) || !Number.isFinite(jwtPayload.exp) || jwtPayload.exp <= now) {
    return null;
  }

  const remainingMs = jwtPayload.exp * 1000 - nowMs;
  if (remainingMs <= 0) {
    return null;
  }

  return {
    ...jwtPayload,
    needsRenewal: remainingMs < DEFAULT_SESSION_TOKEN_RENEW_THRESHOLD_MS,
  };
}

export function createBootstrapToken(options?: {
  now?: number;
  userId?: string;
  ttlMs?: number;
}): string {
  const raw = randomBytes(24).toString('hex');
  bootstrapTokenStore.set(raw, {
    userId: options?.userId,
    expiresAt: normalizeNow(options?.now) + (options?.ttlMs ?? DEFAULT_BOOTSTRAP_TOKEN_TTL_MS),
  });
  return raw;
}

export function consumeBootstrapToken(
  token: string,
  options?: { now?: number },
): { userId?: string } | null {
  const entry = bootstrapTokenStore.get(token);
  if (!entry) {
    return null;
  }

  bootstrapTokenStore.delete(token);
  if (entry.expiresAt <= normalizeNow(options?.now)) {
    return null;
  }

  return { userId: entry.userId };
}

export function createWsTicket(
  userId: string,
  options?: {
    now?: number;
    ttlMs?: number;
  },
): string {
  const raw = randomBytes(24).toString('hex');
  wsTicketStore.set(raw, {
    userId,
    expiresAt: normalizeNow(options?.now) + (options?.ttlMs ?? DEFAULT_WS_TICKET_TTL_MS),
  });
  return raw;
}

export function consumeWsTicket(
  ticket: string,
  options?: { now?: number },
): { userId?: string } | null {
  const entry = wsTicketStore.get(ticket);
  if (!entry) {
    return null;
  }

  wsTicketStore.delete(ticket);
  if (entry.expiresAt <= normalizeNow(options?.now)) {
    return null;
  }

  return { userId: entry.userId };
}

export function clearBootstrapTokenStore(): void {
  bootstrapTokenStore.clear();
}

export function clearWsTicketStore(): void {
  wsTicketStore.clear();
}

export function isIpBanned(ip: string, options?: { now?: number }): boolean {
  const state = authFailureStore.get(ip);
  const now = normalizeNow(options?.now);
  if (!state?.bannedUntilMs) {
    return false;
  }

  if (state.bannedUntilMs <= now) {
    authFailureStore.delete(ip);
    return false;
  }

  return true;
}

export function recordAuthFailure(ip: string, options?: { now?: number }): void {
  const now = normalizeNow(options?.now);
  const state = authFailureStore.get(ip);

  if (state?.bannedUntilMs && state.bannedUntilMs > now) {
    return;
  }

  const failures = (state?.failures ?? 0) + 1;
  if (failures >= DEFAULT_AUTH_RATE_LIMIT_MAX_FAILURES) {
    authFailureStore.set(ip, {
      failures: 0,
      bannedUntilMs: now + DEFAULT_AUTH_BLOCK_WINDOW_MS,
    });
    return;
  }

  authFailureStore.set(ip, {
    failures,
    bannedUntilMs: state?.bannedUntilMs,
  });
}

export function clearAuthFailures(ip?: string): void {
  if (ip) {
    authFailureStore.delete(ip);
    return;
  }

  authFailureStore.clear();
}

export function recordAuthSuccess(ip: string): void {
  authFailureStore.delete(ip);
}

export function clearMasterTokenCache(configDir?: string): void {
  masterTokenCache.delete(getMasterTokenPath(configDir));
}

export async function getConfigTokenHash(configDir?: string): Promise<string> {
  const token = await ensureMasterToken(configDir);
  return createHash('sha256').update(token).digest('hex');
}

export function isValidSha256(value: string, hash: string): boolean {
  return createHash('sha256').update(value).digest('hex') === hash;
}

export class TokenService {
  readonly tokenPath = DEFAULT_TOKEN_PATH;

  loadOrCreateMasterToken(): Promise<string> {
    return ensureMasterToken();
  }

  async issueSessionToken(subject: Pick<SessionMeta, 'id'> | { id: string }): Promise<TokenBundle> {
    const expiresAt = Date.now() + DEFAULT_SESSION_TOKEN_TTL_MS;
    return {
      masterToken: await ensureMasterToken(),
      sessionToken: await signSessionToken(subject.id),
      expiresAt,
    };
  }

  issueBootstrapToken(subject: Pick<SessionMeta, 'id'> | { id: string } = { id: 'web-client' }): {
    token: string;
    expiresAt: number;
  } {
    const expiresAt = Date.now() + DEFAULT_BOOTSTRAP_TOKEN_TTL_MS;
    return { token: createBootstrapToken({ userId: subject.id }), expiresAt };
  }

  async exchangeBootstrapToken(token: string): Promise<TokenBundle | null> {
    const consumed = consumeBootstrapToken(token);
    if (!consumed) {
      return null;
    }

    return this.issueSessionToken({ id: consumed.userId ?? 'web-client' });
  }

  issueWsTicket(subject: Pick<SessionMeta, 'id'> | { id: string } = { id: 'web-client' }): {
    ticket: string;
    expiresAt: number;
  } {
    return {
      ticket: createWsTicket(subject.id),
      expiresAt: Date.now() + DEFAULT_WS_TICKET_TTL_MS,
    };
  }
}
