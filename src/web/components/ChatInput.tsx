import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SkillInfo } from '@/shared/types';
import { SkillPalette } from './SkillPalette';

interface ChatInputProps {
  onSend: (text: string) => void;
  onAbort: () => void;
  isStreaming: boolean;
  disabled: boolean;
  skills?: SkillInfo[];
  onSkillInvoke?: (skill: SkillInfo, args?: string) => void;
  /** Custom placeholder text (e.g. for plan mode). */
  placeholder?: string;
}

export function ChatInput({
  onSend,
  onAbort,
  isStreaming,
  disabled,
  skills = [],
  onSkillInvoke,
  placeholder,
}: ChatInputProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Skill palette state
  const paletteVisible = useMemo(() => text.startsWith('/') && !text.includes(' '), [text]);
  const paletteQuery = useMemo(() => (paletteVisible ? text.slice(1) : ''), [paletteVisible, text]);

  const handleSkillSelect = useCallback(
    (skill: SkillInfo) => {
      if (skill.arguments && skill.arguments.length > 0) {
        // Skill needs args — fill into input so user can type args
        setText(`/${skill.name} `);
        textareaRef.current?.focus();
      } else if (onSkillInvoke) {
        // No args needed — invoke directly
        onSkillInvoke(skill);
        setText('');
      } else {
        // Fallback: send as text
        onSend(`/${skill.name}`);
        setText('');
      }
    },
    [onSend, onSkillInvoke],
  );

  const handlePaletteClose = useCallback(() => {
    // Clear the slash to dismiss palette
    if (text === '/') {
      setText('');
    }
    textareaRef.current?.focus();
  }, [text]);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  useEffect(() => {
    autoResize();
  }, [text, autoResize]);

  // Handle virtual keyboard resize on mobile
  useEffect(() => {
    const vv = globalThis.visualViewport;
    if (!vv) return;

    const onResize = () => {
      const el = document.getElementById('chat-input-bar');
      if (el) {
        const offsetBottom = window.innerHeight - vv.height - vv.offsetTop;
        el.style.bottom = `${Math.max(0, offsetBottom)}px`;
      }
    };

    vv.addEventListener('resize', onResize);
    vv.addEventListener('scroll', onResize);
    return () => {
      vv.removeEventListener('resize', onResize);
      vv.removeEventListener('scroll', onResize);
    };
  }, []);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;

    // Emit event for skill palette if "/" prefix
    if (trimmed.startsWith('/')) {
      window.dispatchEvent(new CustomEvent('skill:trigger', { detail: trimmed }));
    }

    onSend(trimmed);
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [text, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // When palette is visible, let it handle navigation keys
      if (paletteVisible && ['ArrowUp', 'ArrowDown', 'Tab', 'Escape'].includes(e.key)) {
        // These are handled by SkillPalette's global keydown listener
        return;
      }
      if (paletteVisible && e.key === 'Enter' && !e.shiftKey) {
        // Let the palette handle Enter for selection
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend, paletteVisible],
  );

  return (
    <div
      id="chat-input-bar"
      className="fixed right-0 bottom-0 left-0 border-t border-gray-800 bg-gray-950 p-3"
    >
      <div className="relative mx-auto flex max-w-3xl items-end gap-2">
        <SkillPalette
          visible={paletteVisible}
          query={paletteQuery}
          skills={skills}
          onSelect={handleSkillSelect}
          onClose={handlePaletteClose}
        />
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? 'Not connected...' : (placeholder ?? 'Send a message...')}
          disabled={disabled}
          rows={1}
          className="min-h-[40px] flex-1 resize-none rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 outline-none transition-colors focus:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        />
        {isStreaming ? (
          <button
            type="button"
            onClick={onAbort}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-600 text-white transition-colors hover:bg-red-500"
            aria-label="Stop generating"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-4 w-4"
            >
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSend}
            disabled={disabled || !text.trim()}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Send message"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-4 w-4"
            >
              <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
