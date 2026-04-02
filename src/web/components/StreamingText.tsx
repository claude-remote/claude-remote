import { useEffect, useMemo, useRef, useState } from 'react';

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
  html = html.replace(
    /`([^`]+)`/g,
    '<code class="rounded bg-gray-800 px-1 py-0.5 text-xs">$1</code>',
  );

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

/** Characters to advance per animation frame during streaming */
const CHARS_PER_FRAME = 5;

export function StreamingText({ text, isStreaming = false }: StreamingTextProps) {
  const [displayLength, setDisplayLength] = useState(isStreaming ? 0 : text.length);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!isStreaming) {
      setDisplayLength(text.length);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      return;
    }

    // Use requestAnimationFrame for smooth streaming instead of setTimeout
    function tick() {
      setDisplayLength((prev) => {
        const next = Math.min(prev + CHARS_PER_FRAME, text.length);
        // If we haven't caught up, schedule another frame
        if (next < text.length) {
          rafRef.current = requestAnimationFrame(tick);
        } else {
          rafRef.current = 0;
        }
        return next;
      });
    }

    // Only start animation if we need to catch up
    if (displayLength < text.length && !rafRef.current) {
      rafRef.current = requestAnimationFrame(tick);
    }

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    };
  }, [text, isStreaming]);

  // Reset display when text changes significantly (new message)
  useEffect(() => {
    if (!isStreaming) {
      setDisplayLength(text.length);
    }
  }, [text, isStreaming]);

  const displayText = isStreaming ? text.slice(0, displayLength) : text;

  // Lazy markdown: only parse when the text is actually visible / settled
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
