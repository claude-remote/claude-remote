import type { MiddlewareHandler } from 'hono';
import type { SessionMeta } from '@/shared/types';

export interface AuthenticatedVariables {
  session?: Pick<SessionMeta, 'id'>;
}

export const requireAuth: MiddlewareHandler = async (context, next) => {
  // TODO(T04): validate bearer/cookie credentials and attach auth context.
  context.set('auth' as never, { session: { id: 'anonymous' } } as never);
  await next();
};

export const requireJsonCsrf: MiddlewareHandler = async (_context, next) => {
  // TODO(T04): enforce JSON-only state-changing requests and optional requested-with checks.
  await next();
};
