import type { SessionMeta } from '@/shared/types';

import {
  DEFAULT_BOOTSTRAP_TOKEN_TTL_MS,
  DEFAULT_SESSION_TOKEN_TTL_MS,
  DEFAULT_TOKEN_PATH,
  DEFAULT_WS_TICKET_TTL_MS,
} from '@/shared/constants';

export interface TokenBundle {
  masterToken: string;
  sessionToken: string;
  expiresAt: number;
}

export class TokenService {
  readonly tokenPath = DEFAULT_TOKEN_PATH;

  loadOrCreateMasterToken(): string {
    // TODO(T04): persist the master token to ~/.claude-remote/hub.token.
    return 'dev-master-token';
  }

  issueSessionToken(_subject: Pick<SessionMeta, 'id'> | { id: string }): TokenBundle {
    // TODO(T04): mint JWT session cookies with sliding renewal support.
    return {
      masterToken: this.loadOrCreateMasterToken(),
      sessionToken: 'dev-session-token',
      expiresAt: Date.now() + DEFAULT_SESSION_TOKEN_TTL_MS,
    };
  }

  issueBootstrapToken(): { token: string; expiresAt: number } {
    // TODO(T04): create one-time bootstrap tokens for mobile onboarding.
    return {
      token: 'dev-bootstrap-token',
      expiresAt: Date.now() + DEFAULT_BOOTSTRAP_TOKEN_TTL_MS,
    };
  }

  issueWsTicket(): { ticket: string; expiresAt: number } {
    // TODO(T04): create one-time WS tickets bound to authenticated sessions.
    return {
      ticket: 'dev-ws-ticket',
      expiresAt: Date.now() + DEFAULT_WS_TICKET_TTL_MS,
    };
  }
}
