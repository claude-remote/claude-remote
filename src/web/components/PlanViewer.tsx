import { useCallback, useMemo, useState } from 'react';

import type { Message, Task } from '@/shared/types';

/** Props for the PlanViewer component. */
interface PlanViewerProps {
  /** Active tasks from the session snapshot. */
  tasks: Task[];
  /** Recent messages, used to extract plan content from assistant responses. */
  messages: Message[];
  /** Callback to send a command to exit plan mode. */
  onExitPlanMode: () => void;
}

/** A single step parsed from plan markdown content. */
interface PlanStep {
  text: string;
  completed: boolean;
  indent: number;
}

/**
 * PlanViewer displays a banner and read-only plan content when the session
 * is in "plan mode". Plan mode is detected by checking if any active task
 * has `activeForm === 'plan'`.
 *
 * Plan content is extracted from assistant messages that contain plan-like
 * markdown (numbered lists, checkboxes, headings).
 */
export function PlanViewer({ tasks, messages, onExitPlanMode }: PlanViewerProps) {
  const [collapsed, setCollapsed] = useState(false);

  const planTask = useMemo(
    () => tasks.find((t) => t.activeForm === 'plan'),
    [tasks],
  );

  const planContent = useMemo(() => extractPlanContent(messages), [messages]);
  const planSteps = useMemo(() => parsePlanSteps(planContent), [planContent]);

  const completedCount = useMemo(
    () => planSteps.filter((s) => s.completed).length,
    [planSteps],
  );

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => !prev);
  }, []);

  // Only render when plan mode is active
  if (!planTask) {
    return null;
  }

  return (
    <aside
      className="animate-slide-in-top border-l-2 border-indigo-500 bg-indigo-950/20 backdrop-blur-sm"
      role="region"
      aria-label="Plan mode"
    >
      {/* Banner header */}
      <div className="flex items-center justify-between px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-500/20">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 16 16"
              fill="currentColor"
              className="h-3 w-3 text-indigo-400"
            >
              <path d="M8 1a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 8 1ZM10.5 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM12.95 4.11a.75.75 0 1 0-1.06-1.06l-1.062 1.06a.75.75 0 0 0 1.061 1.06l1.06-1.06ZM15 8a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 15 8ZM11.828 11.828a.75.75 0 1 0-1.06-1.06l-1.06 1.06a.75.75 0 1 0 1.06 1.06l1.06-1.06ZM8 13.5a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 8 13.5ZM4.11 12.95a.75.75 0 1 0 1.06-1.06l-1.06-1.06a.75.75 0 1 0-1.06 1.06l1.06 1.06ZM2.75 8a.75.75 0 0 1-.75.75H.5a.75.75 0 0 1 0-1.5H2a.75.75 0 0 1 .75.75ZM4.172 4.172a.75.75 0 1 0-1.06-1.06L2.05 4.172a.75.75 0 0 0 1.06 1.06l1.062-1.06Z" />
            </svg>
          </span>
          <span className="text-sm font-medium text-indigo-300">Plan Mode</span>
          {planSteps.length > 0 && (
            <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 text-xs text-indigo-400">
              {completedCount}/{planSteps.length} steps
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {planContent && (
            <button
              type="button"
              onClick={toggleCollapsed}
              className="rounded px-2 py-1 text-xs text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200"
              aria-label={collapsed ? 'Expand plan' : 'Collapse plan'}
            >
              {collapsed ? 'Expand' : 'Collapse'}
            </button>
          )}
          <button
            type="button"
            onClick={onExitPlanMode}
            className="rounded-md border border-indigo-500/40 bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-300 transition-colors hover:border-indigo-400 hover:bg-indigo-500/20 hover:text-indigo-200"
          >
            Exit Plan Mode
          </button>
        </div>
      </div>

      {/* Plan content */}
      {!collapsed && planContent && (
        <div className="border-t border-indigo-500/10 px-4 py-3">
          {planSteps.length > 0 ? (
            <ul className="space-y-1.5">
              {planSteps.map((step, idx) => (
                <li
                  key={idx}
                  className="flex items-start gap-2"
                  style={{ paddingLeft: `${step.indent * 16}px` }}
                >
                  <span
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      step.completed
                        ? 'border-green-500/50 bg-green-500/20 text-green-400'
                        : 'border-gray-600 bg-gray-800/50 text-transparent'
                    }`}
                  >
                    {step.completed && (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 16 16"
                        fill="currentColor"
                        className="h-3 w-3"
                      >
                        <path
                          fillRule="evenodd"
                          d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                  </span>
                  <span
                    className={`text-sm leading-5 ${
                      step.completed ? 'text-gray-500 line-through' : 'text-gray-300'
                    }`}
                  >
                    {step.text}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm leading-relaxed text-gray-400 whitespace-pre-wrap">
              {planContent}
            </p>
          )}
        </div>
      )}

      {/* Empty state when no plan content yet */}
      {!collapsed && !planContent && (
        <div className="border-t border-indigo-500/10 px-4 py-3">
          <p className="text-sm text-gray-500 italic">
            Claude is exploring the codebase and designing an implementation approach...
          </p>
        </div>
      )}
    </aside>
  );
}

/**
 * Extract plan content from the most recent assistant messages.
 * Looks for messages that contain plan-like structure (numbered lists,
 * headings, checkbox items).
 */
function extractPlanContent(messages: Message[]): string | null {
  // Walk backwards through messages to find the latest plan content
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || msg.role !== 'assistant') continue;

    for (const block of msg.content) {
      if (block.type !== 'text') continue;
      const text = block.text;

      // Detect plan-like content: has numbered steps, checkboxes, or plan headings
      const hasPlanIndicators =
        /^#{1,3}\s+.*(?:plan|approach|strategy|steps|implementation)/im.test(text) ||
        /^\s*(?:\d+\.|[-*]\s*\[[ x]\])\s+/m.test(text);

      if (hasPlanIndicators && text.length > 50) {
        return text;
      }
    }
  }

  return null;
}

/**
 * Parse plan steps from markdown content.
 * Supports:
 * - Numbered lists: "1. Step text"
 * - Checkboxes: "- [x] Completed step" / "- [ ] Pending step"
 * - Nested items via indentation
 */
function parsePlanSteps(content: string | null): PlanStep[] {
  if (!content) return [];

  const steps: PlanStep[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    // Match checkbox items: "- [x] text" or "- [ ] text" or "* [x] text"
    const checkboxMatch = line.match(/^(\s*)[-*]\s+\[([ xX])\]\s+(.+)/);
    if (checkboxMatch) {
      const indent = Math.floor((checkboxMatch[1]?.length ?? 0) / 2);
      steps.push({
        text: checkboxMatch[3]!.trim(),
        completed: checkboxMatch[2] !== ' ',
        indent,
      });
      continue;
    }

    // Match numbered list items: "1. Step text"
    const numberedMatch = line.match(/^(\s*)\d+\.\s+(.+)/);
    if (numberedMatch) {
      const indent = Math.floor((numberedMatch[1]?.length ?? 0) / 2);
      steps.push({
        text: numberedMatch[2]!.trim(),
        completed: false,
        indent,
      });
      continue;
    }
  }

  return steps;
}
