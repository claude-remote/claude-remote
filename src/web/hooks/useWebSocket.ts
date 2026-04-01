import { useCallback, useEffect, useRef, useState } from 'react';

import type { ClientCommand, HubEvent, HubResponse } from '@/shared/protocol';
import type { SessionSnapshot } from '@/shared/types';

export interface UseWebSocketOptions {
  ticket: string | null;
  onEvent?: (event: HubEvent) => void;
  onSnapshot?: (snapshot: SessionSnapshot) => void;
}

export interface UseWebSocketReturn {
  connected: boolean;
  connecting: boolean;
  snapshot: SessionSnapshot | null;
  send: (command: ClientCommand) => void;
  reconnect: () => void;
  onEvent: (handler: (event: HubEvent) => void) => () => void;
}

const MIN_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;

export function useWebSocket({ ticket, onEvent, onSnapshot }: UseWebSocketOptions): UseWebSocketReturn {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef(MIN_RECONNECT_DELAY);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSeqRef = useRef<number>(-1);
  const eventHandlersRef = useRef<Set<(event: HubEvent) => void>>(new Set());
  const onEventRef = useRef(onEvent);
  const onSnapshotRef = useRef(onSnapshot);

  // Keep refs up to date
  onEventRef.current = onEvent;
  onSnapshotRef.current = onSnapshot;

  const cleanup = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onclose = null;
      wsRef.current.onmessage = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (!ticket) return;

    cleanup();
    setConnecting(true);

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${location.host}/ws?ticket=${encodeURIComponent(ticket)}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setConnecting(false);
      reconnectDelayRef.current = MIN_RECONNECT_DELAY;
    };

    ws.onmessage = (ev) => {
      let msg: HubResponse;
      try {
        msg = JSON.parse(ev.data as string) as HubResponse;
      } catch {
        return;
      }

      switch (msg.type) {
        case 'snapshot': {
          setSnapshot(msg.snapshot);
          lastSeqRef.current = msg.snapshot.lastSeq;
          onSnapshotRef.current?.(msg.snapshot);
          break;
        }
        case 'event': {
          const event = msg.event;

          // Seq gap detection - force reconnect if we missed events
          if ('seq' in event && typeof event.seq === 'number') {
            if (lastSeqRef.current >= 0 && event.seq > lastSeqRef.current + 1) {
              // Gap detected, reconnect to get fresh snapshot
              scheduleReconnect();
              return;
            }
            lastSeqRef.current = event.seq;
          }

          // Notify all registered handlers
          onEventRef.current?.(event);
          for (const handler of eventHandlersRef.current) {
            handler(event);
          }
          break;
        }
        case 'hello':
        case 'reply':
        case 'error':
          // These are handled by command-level callbacks in the future
          break;
      }
    };

    ws.onclose = () => {
      setConnected(false);
      setConnecting(false);
      wsRef.current = null;
      scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose will fire after onerror, so reconnect is handled there
    };
  }, [ticket, cleanup]);

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimerRef.current) return;

    const delay = reconnectDelayRef.current;
    reconnectDelayRef.current = Math.min(delay * 2, MAX_RECONNECT_DELAY);

    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      connect();
    }, delay);
  }, [connect]);

  const send = useCallback((command: ClientCommand) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(command));
    }
  }, []);

  const reconnect = useCallback(() => {
    reconnectDelayRef.current = MIN_RECONNECT_DELAY;
    connect();
  }, [connect]);

  const registerEventHandler = useCallback((handler: (event: HubEvent) => void) => {
    eventHandlersRef.current.add(handler);
    return () => {
      eventHandlersRef.current.delete(handler);
    };
  }, []);

  // Connect on mount / ticket change
  useEffect(() => {
    connect();
    return cleanup;
  }, [connect, cleanup]);

  return {
    connected,
    connecting,
    snapshot,
    send,
    reconnect,
    onEvent: registerEventHandler,
  };
}
