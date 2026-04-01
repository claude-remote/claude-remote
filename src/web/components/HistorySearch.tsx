import type { HistorySearchResult } from '@/shared/types';

interface HistorySearchProps {
  results: HistorySearchResult[];
}

export function HistorySearch({ results }: HistorySearchProps) {
  // TODO(T24): implement scope switching, query input, and deep linking to message anchors.
  return (
    <section className="rounded border border-stone-800 p-3">
      <h2 className="font-medium">历史搜索</h2>
      <ul className="mt-2 space-y-2 text-sm">
        {results.map((result) => (
          <li key={`${result.sessionId}-${result.messageId}`}>{result.snippet}</li>
        ))}
      </ul>
    </section>
  );
}
