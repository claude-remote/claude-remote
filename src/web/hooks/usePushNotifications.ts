import { useCallback, useEffect, useRef } from 'react';

import type { HubEvent, HubResponse } from '@/shared/protocol';
import type { ContextUsage } from '@/shared/types';
import { useNotificationPermission } from './useNotificationPermission';

export interface UsePushNotificationsOptions {
  /** Current session ID for building click-through URLs */
  sessionId: string;
  /** Subscribe to hub events. Returns an unsubscribe function. */
  onEvent: (handler: (event: HubEvent) => void) => () => void;
}

/**
 * Monitors WebSocket events and triggers browser notifications
 * when the page is in the background (document.hidden).
 *
 * Notifications are triggered for:
 * - Permission requests: "Tool X needs approval"
 * - Task completion: "Claude finished the task"
 * - Context warning: "Context is 85%+ full"
 */
export function usePushNotifications({ sessionId, onEvent }: UsePushNotificationsOptions): void {
  const { isGranted, showNotification } = useNotificationPermission();
  const isGrantedRef = useRef(isGranted);
  const showNotificationRef = useRef(showNotification);

  // Keep refs current to avoid stale closures in the event handler
  isGrantedRef.current = isGranted;
  showNotificationRef.current = showNotification;

  const chatUrl = `/chat/${sessionId}`;

  const handleEvent = useCallback(
    (event: HubEvent) => {
      // Only notify when the page is hidden (background tab / minimized)
      if (!document.hidden) return;
      if (!isGrantedRef.current) return;

      const notify = showNotificationRef.current;

      switch (event.type) {
        // Permission request: tool needs approval
        case 'sdk:control': {
          const toolName = extractToolName(event.payload.request);
          notify('Approval needed', `Tool "${toolName}" needs your permission`, chatUrl);
          break;
        }

        // Session status changed to idle → task likely completed
        case 'hub:session:statusChanged': {
          if (event.sessionId === sessionId && event.status === 'idle') {
            notify('Task completed', 'Claude finished the task', chatUrl);
          }
          break;
        }

        // Context usage warning
        case 'hub:context:updated': {
          if (event.sessionId === sessionId) {
            notifyContextWarning(event.usage, notify, chatUrl);
          }
          break;
        }

        // Rate limited
        case 'hub:rateLimited': {
          if (event.sessionId === sessionId) {
            const seconds = Math.ceil(event.retryAfterMs / 1000);
            notify('Rate limited', `Retry in ${seconds}s (${event.scope})`, chatUrl);
          }
          break;
        }

        default:
          break;
      }
    },
    [sessionId, chatUrl],
  );

  useEffect(() => {
    return onEvent(handleEvent);
  }, [onEvent, handleEvent]);
}

/** Track which context thresholds we have already notified about. */
const notifiedThresholds = new Set<number>();

const CONTEXT_WARNING_THRESHOLDS = [85, 95];

function notifyContextWarning(
  usage: ContextUsage,
  notify: (title: string, body: string, url?: string) => void,
  url: string,
): void {
  for (const threshold of CONTEXT_WARNING_THRESHOLDS) {
    if (usage.percentage >= threshold && !notifiedThresholds.has(threshold)) {
      notifiedThresholds.add(threshold);
      notify('Context warning', `Context is ${Math.round(usage.percentage)}% full`, url);
      break; // Only one notification per event
    }
  }

  // Reset thresholds when context drops (e.g. after compact)
  if (usage.percentage < 80) {
    notifiedThresholds.clear();
  }
}

function extractToolName(request: Record<string, unknown>): string {
  if (typeof request.toolName === 'string') return request.toolName;
  if (typeof request.tool === 'string') return request.tool;
  if (typeof request.name === 'string') return request.name;
  return 'Unknown tool';
}

/**
 * Alternative hook that watches HubResponse messages directly.
 * Use this when you have access to `lastMessage` from useWebSocket
 * rather than the `onEvent` subscription.
 */
export interface UsePushNotificationFromMessagesOptions {
  sessionId: string;
  lastMessage: HubResponse | null;
}

export function usePushNotificationFromMessages({
  sessionId,
  lastMessage,
}: UsePushNotificationFromMessagesOptions): void {
  const { isGranted, showNotification } = useNotificationPermission();
  const isGrantedRef = useRef(isGranted);
  const showNotificationRef = useRef(showNotification);

  isGrantedRef.current = isGranted;
  showNotificationRef.current = showNotification;

  const chatUrl = `/chat/${sessionId}`;

  useEffect(() => {
    if (!lastMessage) return;
    if (!document.hidden) return;
    if (!isGrantedRef.current) return;

    if (lastMessage.type !== 'event') return;

    const event = lastMessage.event as HubEvent;
    const notify = showNotificationRef.current;

    switch (event.type) {
      case 'sdk:control': {
        const toolName = extractToolName(event.payload.request);
        notify('Approval needed', `Tool "${toolName}" needs your permission`, chatUrl);
        break;
      }
      case 'hub:session:statusChanged': {
        if (event.sessionId === sessionId && event.status === 'idle') {
          notify('Task completed', 'Claude finished the task', chatUrl);
        }
        break;
      }
      case 'hub:context:updated': {
        if (event.sessionId === sessionId) {
          notifyContextWarning(event.usage, notify, chatUrl);
        }
        break;
      }
      case 'hub:rateLimited': {
        if (event.sessionId === sessionId) {
          const seconds = Math.ceil(event.retryAfterMs / 1000);
          notify('Rate limited', `Retry in ${seconds}s (${event.scope})`, chatUrl);
        }
        break;
      }
      default:
        break;
    }
  }, [lastMessage, sessionId, chatUrl]);
}
