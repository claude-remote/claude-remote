import type { HistorySearchResult, SessionMeta } from '@/shared/types';

import { HistorySearch } from '@/web/components/HistorySearch';
import { SessionSwitcher } from '@/web/components/SessionSwitcher';

export function Sessions() {
  const sessions: SessionMeta[] = [];
  const results: HistorySearchResult[] = [];

  // TODO(T13,T24): render create/archive/recover actions and cross-session search.
  return (
    <main className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Sessions</h1>
      </header>
      <HistorySearch results={results} />
      <SessionSwitcher sessions={sessions} />
    </main>
  );
}
