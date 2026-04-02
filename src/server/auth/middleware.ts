import type { MiddlewareHandler } from 'hono';
import type { SessionMeta } from '@/shared/types';
import { SESSION_COOKIE_NAME, DEFAULT_SESSION_TOKEN_TTL_MS } from '@/shared/constants';
import {
  isIpBanned,
  recordAuthFailure,
  recordAuthSuccess,
  signSessionToken,
  verifySessionToken,
} from '@/server/auth/token';

export interface AuthenticatedVariables {
  session?: Pick<SessionMeta, 'id'>;
}

type AuthContext = {
  req: {
    header: (name: string) => string | undefined;
    url: string;
  };
  header: (name: string, value: string) => void;
  json: (body: unknown, status?: number) => Response;
  set: (key: string, value: unknown) => void;
};

const AUTH_SCHEME = /^bearer\s+(.+)$/i;

function extractBearer(headerValue?: string): string | undefined {
  if (!headerValue) {
    return undefined;
  }

  return AUTH_SCHEME.exec(headerValue)?.[1];
}

function extractCookie(cookieHeader?: string): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }

  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${SESSION_COOKIE_NAME}=`)) {
      return trimmed.slice(SESSION_COOKIE_NAME.length + 1);
    }
  }

  return undefined;
}

function normalizeIp(context: AuthContext): string {
  return (
    context.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    context.req.header('x-real-ip') ||
    context.req.header('x-client-ip') ||
    context.req.header('cf-connecting-ip') ||
    'unknown'
  );
}

function getExpectedHost(context: AuthContext): string | undefined {
  const explicitHost = context.req.header('x-forwarded-host') || context.req.header('host');
  if (explicitHost) {
    return explicitHost;
  }

  try {
    return new URL(context.req.url).host;
  } catch {
    return undefined;
  }
}

function isOriginAllowed(context: AuthContext): boolean {
  const origin = context.req.header('origin');
  const expectedHost = getExpectedHost(context);
  if (!origin || !expectedHost) {
    return false;
  }

  try {
    return new URL(origin).host === expectedHost;
  } catch {
    return false;
  }
}

function setSessionCookie(context: AuthContext, token: string): void {
  const maxAge = Math.floor(DEFAULT_SESSION_TOKEN_TTL_MS / 1000);
  const expires = new Date(Date.now() + DEFAULT_SESSION_TOKEN_TTL_MS).toUTCString();
  context.header(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}; Expires=${expires}`,
  );
}

function unauthorized(context: AuthContext, ip: string): Response {
  recordAuthFailure(ip);
  return context.json({ error: 'Unauthorized' }, 401);
}

export const requireAuth: MiddlewareHandler = async (
  context: AuthContext,
  next: () => Promise<void>,
) => {
  const ip = normalizeIp(context);
  if (isIpBanned(ip)) {
    return context.json({ error: 'Too many failed attempts' }, 401);
  }

  const bearerToken = extractBearer(context.req.header('authorization'));
  const cookieToken = extractCookie(context.req.header('cookie'));

  let token: string | undefined;
  let shouldRenewCookie = false;

  if (bearerToken) {
    token = bearerToken;
  } else if (cookieToken) {
    if (!isOriginAllowed(context)) {
      return unauthorized(context, ip);
    }
    token = cookieToken;
    shouldRenewCookie = true;
  }

  if (!token) {
    return unauthorized(context, ip);
  }

  const payload = await verifySessionToken(token);
  if (!payload) {
    return unauthorized(context, ip);
  }

  recordAuthSuccess(ip);
  context.set('auth' as never, { session: { id: payload.userId } } as never);

  if (shouldRenewCookie && payload.needsRenewal) {
    setSessionCookie(context, await signSessionToken(payload.userId));
  }

  await next();
};

export const requireJsonCsrf: MiddlewareHandler = async (_context, next) => {
  // TODO(T04): enforce JSON-only state-changing requests and optional requested-with checks.
  await next();
};

export const authMiddleware = requireAuth;

export function createAuthMiddleware(): MiddlewareHandler {
  return requireAuth;
}
