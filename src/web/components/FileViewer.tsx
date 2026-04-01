import type { HistorySearchResult } from '@/shared/types';

interface FileViewerProps {
  path: string;
  content: string;
  relatedResults?: HistorySearchResult[];
}

export function FileViewer({ path, content }: FileViewerProps) {
  // TODO(T17): add syntax highlighting, large-file pagination, and diff mode.
  return (
    <section className="rounded border border-stone-800 p-3">
      <h2 className="font-medium">{path}</h2>
      <pre className="mt-3 overflow-auto whitespace-pre-wrap text-sm">{content}</pre>
    </section>
  );
}
