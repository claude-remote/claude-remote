import type { Hono } from 'hono';

import type { Hub } from '@/hub/Hub';
import type { HistorySearchResult } from '@/shared/types';

function extractMessageText(message: { content: Array<{ type: string; text?: string; content?: unknown }> }): string {
  return message.content
    .map((block) => {
      if (block.type === 'text') {
        return block.text ?? '';
      }
      if (block.type === 'tool_result' && typeof block.content === 'string') {
        return block.content;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function buildSnippet(text: string, query: string): string {
  const normalizedText = text.toLowerCase();
  const normalizedQuery = query.toLowerCase();
  const matchIndex = normalizedText.indexOf(normalizedQuery);
  if (matchIndex === -1) {
    return text.slice(0, 160);
  }

  const start = Math.max(0, matchIndex - 40);
  const end = Math.min(text.length, matchIndex + query.length + 80);
  return text.slice(start, end);
}

export function registerHistoryRoutes(app: Hono, hub: Hub): Hono {
  // GET /api/history/search?q=xxx&scope=session|all&sessionId=xxx&limit=20
  app.get('/api/history/search', (context) => {
    const query = context.req.query('q') ?? context.req.query('query') ?? '';
    const scope = context.req.query('scope') ?? 'session';
    const sessionId = context.req.query('sessionId');
    const limit = Number.parseInt(context.req.query('limit') ?? '20', 10);

    if (!query.trim()) {
      return context.json({ error: 'Search query required (q parameter)' }, 400);
    }

    const normalizedQuery = query.trim().toLowerCase();
    const sessions =
      scope === 'session' && sessionId
        ? hub.listSessions().filter((session) => session.id === sessionId)
        : hub.listSessions();
    const results: HistorySearchResult[] = sessions
      .flatMap((session) =>
        session.messages
          .map((message) => {
            const text = extractMessageText(message);
            if (!text || !text.toLowerCase().includes(normalizedQuery)) {
              return null;
            }

            return {
              sessionId: session.id,
              sessionName: session.name,
              messageId: message.id,
              role: message.role === 'assistant' ? 'assistant' : 'user',
              snippet: buildSnippet(text, query.trim()),
              timestamp: message.createdAt,
            } satisfies HistorySearchResult;
          })
          .filter((result): result is HistorySearchResult => result !== null),
      )
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);

    return context.json({ query, scope, sessionId: sessionId ?? null, limit, results });
  });

  return app;
}
