import type { SkillInfo } from '@/shared/types';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface SkillPaletteProps {
  visible: boolean;
  query: string;
  skills: SkillInfo[];
  onSelect: (skill: SkillInfo) => void;
  onClose: () => void;
}

/** Simple fuzzy scoring: earlier and contiguous matches score higher. */
function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (!q) return 1; // empty query matches everything
  const idx = t.indexOf(q);
  if (idx === -1) return 0;
  // Prefer matches at the start and in the name itself
  return 1 + (idx === 0 ? 2 : 0) + q.length / t.length;
}

function filterSkills(skills: SkillInfo[], query: string): SkillInfo[] {
  const q = query.toLowerCase();
  if (!q) return skills.filter((s) => s.userInvocable);

  return skills
    .filter((s) => s.userInvocable)
    .map((skill) => {
      const nameScore = fuzzyScore(q, skill.name);
      const descScore = fuzzyScore(q, skill.description) * 0.5;
      const aliasScore = (skill.aliases ?? []).reduce(
        (best, a) => Math.max(best, fuzzyScore(q, a)),
        0,
      );
      const score = Math.max(nameScore, descScore, aliasScore);
      return { skill, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ skill }) => skill);
}

const MAX_VISIBLE = 8;

export function SkillPalette({ visible, query, skills, onSelect, onClose }: SkillPaletteProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = filterSkills(skills, query);

  // Reset selection when query or visibility changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query, visible]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const item = listRef.current.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!visible) return;

      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => (prev <= 0 ? filtered.length - 1 : prev - 1));
          break;
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => (prev >= filtered.length - 1 ? 0 : prev + 1));
          break;
        case 'Enter':
          e.preventDefault();
          if (filtered[selectedIndex]) {
            onSelect(filtered[selectedIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
        case 'Tab':
          e.preventDefault();
          if (filtered[selectedIndex]) {
            onSelect(filtered[selectedIndex]);
          }
          break;
      }
    },
    [visible, filtered, selectedIndex, onSelect, onClose],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (!visible || filtered.length === 0) return null;

  return (
    <div
      className="animate-skill-palette-in absolute right-0 bottom-full left-0 z-50 mb-2 overflow-hidden rounded-lg border border-gray-700 bg-gray-900 shadow-xl"
      role="listbox"
      aria-label="Skill palette"
    >
      <div
        ref={listRef}
        className="overflow-y-auto py-1"
        style={{ maxHeight: `${MAX_VISIBLE * 44}px` }}
      >
        {filtered.map((skill, i) => (
          <button
            key={skill.name}
            type="button"
            role="option"
            aria-selected={i === selectedIndex}
            className={`flex w-full items-start gap-3 px-3 py-2 text-left transition-colors ${
              i === selectedIndex
                ? 'bg-indigo-600/30 text-white'
                : 'text-gray-300 hover:bg-gray-800'
            }`}
            onMouseEnter={() => setSelectedIndex(i)}
            onClick={() => onSelect(skill)}
          >
            <span className="shrink-0 font-mono text-sm font-semibold text-indigo-400">
              /{skill.name}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-gray-400">
              {skill.description}
            </span>
            {skill.arguments && skill.arguments.length > 0 && (
              <span className="shrink-0 rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-500">
                {skill.arguments.map((a) => `<${a}>`).join(' ')}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
