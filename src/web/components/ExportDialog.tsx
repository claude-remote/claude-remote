import { useCallback, useEffect, useRef, useState } from 'react';

import type { ExportResult } from '@/shared/types';

interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
  onExport: (format: 'markdown' | 'json') => void;
  result?: ExportResult | null;
  loading?: boolean;
}

export function ExportDialog({ open, onClose, onExport, result, loading }: ExportDialogProps) {
  const [format, setFormat] = useState<'markdown' | 'json'>('markdown');
  const [copied, setCopied] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  // Close on backdrop click
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  const handleExport = useCallback(() => {
    onExport(format);
  }, [format, onExport]);

  const handleDownload = useCallback(() => {
    if (!result) return;
    const blob = new Blob([result.content], {
      type: result.format === 'json' ? 'application/json' : 'text/markdown',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = result.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [result]);

  const handleCopy = useCallback(async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback: do nothing
    }
  }, [result]);

  if (!open) return null;

  const previewLines = result ? result.content.split('\n').slice(0, 8).join('\n') : '';
  const hasMoreLines = result ? result.content.split('\n').length > 8 : false;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60"
      onClick={handleBackdropClick}
    >
      <div
        ref={dialogRef}
        className="mx-4 w-full max-w-lg rounded-xl border border-gray-700 bg-gray-900 shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-800 px-5 py-3">
          <h2 className="text-base font-semibold text-gray-100">Export conversation</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-gray-200"
          >
            &#10005;
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 px-5 py-4">
          {/* Format selector */}
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-400">Format:</span>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="radio"
                name="export-format"
                value="markdown"
                checked={format === 'markdown'}
                onChange={() => setFormat('markdown')}
                className="accent-indigo-500"
              />
              <span className="text-sm text-gray-200">Markdown</span>
            </label>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="radio"
                name="export-format"
                value="json"
                checked={format === 'json'}
                onChange={() => setFormat('json')}
                className="accent-indigo-500"
              />
              <span className="text-sm text-gray-200">JSON</span>
            </label>
          </div>

          {/* Generate button */}
          {!result && (
            <button
              type="button"
              onClick={handleExport}
              disabled={loading}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {loading ? 'Generating...' : 'Generate export'}
            </button>
          )}

          {/* Preview */}
          {result && (
            <div className="space-y-2">
              <span className="text-xs text-gray-500">
                Preview ({result.filename})
              </span>
              <pre className="max-h-48 overflow-auto rounded-lg border border-gray-800 bg-gray-950 p-3 text-xs text-gray-300">
                {previewLines}
                {hasMoreLines && '\n...'}
              </pre>
            </div>
          )}
        </div>

        {/* Footer */}
        {result && (
          <div className="flex items-center justify-end gap-2 border-t border-gray-800 px-5 py-3">
            <button
              type="button"
              onClick={handleCopy}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-200 hover:bg-gray-800"
            >
              {copied ? 'Copied!' : 'Copy to clipboard'}
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
            >
              Download
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
