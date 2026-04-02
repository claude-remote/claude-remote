import { useCallback, useMemo, useState } from 'react';
import type { HistorySearchResult } from '@/shared/types';

interface FileViewerProps {
  path: string;
  content: string;
  totalLines?: number;
  fileSize?: string;
  lastModified?: string;
  relatedResults?: HistorySearchResult[];
  onLoadMore?: (offset: number) => void;
  loading?: boolean;
}

const LINES_PER_PAGE = 500;

/** Map file extension to a language key for syntax class names. */
function detectLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rs: 'rust', go: 'go', rb: 'ruby', java: 'java',
    c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
    sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell',
    json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
    md: 'markdown', css: 'css', html: 'html', xml: 'xml', sql: 'sql',
    lua: 'lua', zig: 'zig', swift: 'swift', kt: 'kotlin',
  };
  return map[ext] || 'plaintext';
}

/** Very basic keyword/string/comment highlighting via regex. */
function highlightLine(line: string, lang: string): (string | JSX.Element)[] {
  if (lang === 'plaintext' || lang === 'markdown') {
    return [line];
  }

  const fragments: (string | JSX.Element)[] = [];
  // Pattern: single-line comments, strings, keywords
  const commentPatterns: Record<string, string> = {
    python: '#',
    shell: '#',
    ruby: '#',
    yaml: '#',
    toml: '#',
  };
  const commentPrefix = commentPatterns[lang] || '//';

  const keywords = new Set([
    'import', 'export', 'from', 'const', 'let', 'var', 'function', 'return',
    'if', 'else', 'for', 'while', 'class', 'interface', 'type', 'enum',
    'async', 'await', 'try', 'catch', 'throw', 'new', 'this', 'super',
    'def', 'fn', 'pub', 'mod', 'use', 'struct', 'impl', 'trait',
    'func', 'package', 'defer', 'go', 'select', 'case', 'switch',
    'true', 'false', 'null', 'undefined', 'None', 'nil', 'self',
  ]);

  // Check for full-line comment
  const trimmed = line.trimStart();
  if (trimmed.startsWith(commentPrefix) || (lang === 'html' && trimmed.startsWith('<!--'))) {
    return [<span key="c" className="text-gray-500 italic">{line}</span>];
  }

  // Tokenize: strings, then words
  const regex = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\w+\b)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyIdx = 0;

  while ((match = regex.exec(line)) !== null) {
    // Push text between matches
    if (match.index > lastIndex) {
      fragments.push(line.slice(lastIndex, match.index));
    }

    const token = match[0];
    if (token.startsWith('"') || token.startsWith("'") || token.startsWith('`')) {
      fragments.push(
        <span key={`s${keyIdx++}`} className="text-amber-400">{token}</span>
      );
    } else if (keywords.has(token)) {
      fragments.push(
        <span key={`k${keyIdx++}`} className="text-purple-400 font-semibold">{token}</span>
      );
    } else if (/^\d+(\.\d+)?$/.test(token)) {
      fragments.push(
        <span key={`n${keyIdx++}`} className="text-cyan-400">{token}</span>
      );
    } else {
      fragments.push(token);
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < line.length) {
    fragments.push(line.slice(lastIndex));
  }

  return fragments.length > 0 ? fragments : [line];
}

export function FileViewer({
  path,
  content,
  totalLines,
  fileSize,
  lastModified,
  onLoadMore,
  loading,
}: FileViewerProps) {
  const [copied, setCopied] = useState(false);
  const lang = useMemo(() => detectLanguage(path), [path]);
  const lines = useMemo(() => content.split('\n'), [content]);
  const displayedCount = lines.length;
  const total = totalLines ?? displayedCount;
  const hasMore = total > displayedCount;

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may not be available
    }
  }, [content]);

  const handleLoadMore = useCallback(() => {
    onLoadMore?.(displayedCount);
  }, [onLoadMore, displayedCount]);

  const fileName = path.split('/').pop() || path;

  return (
    <section className="flex flex-col rounded border border-gray-800 bg-gray-900 overflow-hidden">
      {/* File info header */}
      <div className="flex items-center justify-between border-b border-gray-800 px-3 py-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-medium text-gray-100" title={path}>
            {fileName}
          </h2>
          <div className="mt-0.5 flex gap-3 text-xs text-gray-500">
            <span>{lang}</span>
            {fileSize && <span>{fileSize}</span>}
            {lastModified && <span>{lastModified}</span>}
            <span>{total} lines</span>
          </div>
        </div>
        <button
          onClick={handleCopy}
          className="ml-2 shrink-0 rounded border border-gray-700 px-2 py-1 text-xs text-gray-400 hover:border-gray-600 hover:text-gray-200 transition-colors"
          title="Copy file content"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      {/* Code content with line numbers */}
      <div className="overflow-auto">
        <pre className="text-sm leading-relaxed">
          <code>
            {lines.map((line, i) => (
              <div key={i} className="flex hover:bg-gray-800/50">
                <span className="inline-block w-12 shrink-0 select-none pr-3 text-right text-xs leading-relaxed text-gray-600">
                  {i + 1}
                </span>
                <span className="flex-1 whitespace-pre-wrap break-all pr-3">
                  {highlightLine(line, lang) as React.ReactNode}
                </span>
              </div>
            ))}
          </code>
        </pre>
      </div>

      {/* Load more / pagination */}
      {hasMore && (
        <div className="border-t border-gray-800 px-3 py-2 text-center">
          <button
            onClick={handleLoadMore}
            disabled={loading}
            className="rounded border border-gray-700 px-3 py-1 text-xs text-gray-400 hover:border-gray-600 hover:text-gray-200 disabled:opacity-50 transition-colors"
          >
            {loading
              ? 'Loading...'
              : `Load more (showing ${displayedCount} of ${total} lines)`}
          </button>
        </div>
      )}

      {/* Loading overlay */}
      {loading && displayedCount === 0 && (
        <div className="flex items-center justify-center py-12 text-sm text-gray-500">
          Loading file...
        </div>
      )}
    </section>
  );
}
