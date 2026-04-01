import type { ExportResult } from '@/shared/types';

interface ExportDialogProps {
  result?: ExportResult;
}

export function ExportDialog({ result }: ExportDialogProps) {
  // TODO(T22): offer markdown/json export and copy/download actions.
  return (
    <div className="rounded border border-stone-800 p-3 text-sm text-stone-300">
      {result ? result.filename : '导出对话功能待实现'}
    </div>
  );
}
