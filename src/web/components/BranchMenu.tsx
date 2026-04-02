import { useCallback, useEffect, useRef, useState } from 'react';

import type { Message } from '@/shared/types';

interface Position {
  x: number;
  y: number;
}

interface BranchMenuProps {
  messageId: string;
  message: Message;
  position: Position;
  onBranch: (messageId: string) => void;
  onClose: () => void;
}

export function BranchMenu({ messageId, message, position, onBranch, onClose }: BranchMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  // Clamp position so menu stays on screen
  const style: React.CSSProperties = {
    position: 'fixed',
    top: Math.min(position.y, window.innerHeight - 180),
    left: Math.min(position.x, window.innerWidth - 200),
    zIndex: 50,
  };

  const getPlainText = useCallback((): string => {
    return message.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('\n');
  }, [message]);

  const getMarkdownText = useCallback((): string => {
    const role =
      message.role === 'assistant' ? 'Assistant' : message.role === 'user' ? 'User' : 'System';
    const text = getPlainText();
    return `**${role}:**\n\n${text}`;
  }, [message, getPlainText]);

  const handleCopyText = useCallback(async () => {
    const text = getPlainText();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
        onClose();
      }, 800);
    } catch {
      // Fallback: do nothing
    }
  }, [getPlainText, onClose]);

  const handleCopyMarkdown = useCallback(async () => {
    const md = getMarkdownText();
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
        onClose();
      }, 800);
    } catch {
      // Fallback: do nothing
    }
  }, [getMarkdownText, onClose]);

  const handleBranch = useCallback(() => {
    onBranch(messageId);
    onClose();
  }, [messageId, onBranch, onClose]);

  return (
    <div
      ref={menuRef}
      style={style}
      className="min-w-[180px] rounded-lg border border-gray-700 bg-gray-900 py-1 shadow-xl"
    >
      <button
        type="button"
        onClick={handleBranch}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-800"
      >
        <span className="text-gray-400">&#9095;</span>
        Branch from here
      </button>
      <div className="mx-2 border-t border-gray-800" />
      <button
        type="button"
        onClick={handleCopyText}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-800"
      >
        <span className="text-gray-400">&#128203;</span>
        {copied ? 'Copied!' : 'Copy text'}
      </button>
      <button
        type="button"
        onClick={handleCopyMarkdown}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-800"
      >
        <span className="text-gray-400">&#9998;</span>
        Copy as markdown
      </button>
    </div>
  );
}

/**
 * Hook to manage the branch menu state.
 * Returns handlers to attach to message elements and the active menu state.
 */
export function useBranchMenu() {
  const [menuState, setMenuState] = useState<{
    messageId: string;
    message: Message;
    position: Position;
  } | null>(null);

  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openMenu = useCallback((messageId: string, message: Message, position: Position) => {
    setMenuState({ messageId, message, position });
  }, []);

  const closeMenu = useCallback(() => {
    setMenuState(null);
  }, []);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, messageId: string, message: Message) => {
      e.preventDefault();
      openMenu(messageId, message, { x: e.clientX, y: e.clientY });
    },
    [openMenu],
  );

  const handleTouchStart = useCallback(
    (e: React.TouchEvent, messageId: string, message: Message) => {
      const touch = e.touches[0];
      if (!touch) return;
      const pos = { x: touch.clientX, y: touch.clientY };
      longPressTimerRef.current = setTimeout(() => {
        openMenu(messageId, message, pos);
      }, 500);
    },
    [openMenu],
  );

  const handleTouchEnd = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  return {
    menuState,
    closeMenu,
    handleContextMenu,
    handleTouchStart,
    handleTouchEnd,
  };
}
