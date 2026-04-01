import { useEffect, useMemo, useState } from 'react';

interface StreamingTextProps {
  text: string;
  isStreaming?: boolean;
}

/** Simple markdown-to-HTML renderer for basic formatting. */
function renderMarkdown(source: string): string {
  let html = source
    // Escape HTML entities
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks (``` ... ```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
    return `<pre class="my-2 overflow-x-auto rounded bg-gray-900 p-3 text-xs"><code>${code.trim()}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="rounded bg-gray-800 px-1 py-0.5 text-xs">$1</code>');

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Links
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-indigo-400 underline">$1</a>',
  );

  // Line breaks
  html = html.replace(/\n/g, '<br />');

  return html;
}

export function StreamingText({ text, isStreaming = false }: StreamingTextProps) {
  const [displayLength, setDisplayLength] = useState(isStreaming ? 0 : text.length);

  useEffect(() => {
    if (!isStreaming) {
      setDisplayLength(text.length);
      return;
    }

    // Stream characters in when new text arrives beyond current display
    if (displayLength >= text.length) return;

    const timer = setTimeout(() => {
      setDisplayLength((prev) => Math.min(prev + 3, text.length));
    }, 8);

    return () => clearTimeout(timer);
  }, [text, displayLength, isStreaming]);

  // Reset display when text changes significantly (new message)
  useEffect(() => {
    if (!isStreaming) {
      setDisplayLength(text.length);
    }
  }, [text, isStreaming]);

  const displayText = isStreaming ? text.slice(0, displayLength) : text;
  const rendered = useMemo(() => renderMarkdown(displayText), [displayText]);

  return (
    <div className="streaming-text text-sm leading-relaxed text-gray-100">
      <span
        // biome-ignore lint/security/noDangerouslySetInnerHtml: markdown rendering with entity-escaped input
        dangerouslySetInnerHTML={{ __html: rendered }}
      />
      {isStreaming && displayLength < text.length && (
        <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-indigo-400" />
      )}
    </div>
  );
}
