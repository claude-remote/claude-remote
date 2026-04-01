import { useCallback, useEffect, useRef } from 'react';

import type { PermissionRequest, WriterStatus } from '@/shared/types';

import { PermissionCard } from '@/web/components/PermissionCard';

interface PermissionBannerProps {
  requests: PermissionRequest[];
  writerStatus: WriterStatus;
  onRespond: (requestId: string, approved: boolean) => void;
}

export function PermissionBanner({ requests, writerStatus, onRespond }: PermissionBannerProps) {
  const prevCountRef = useRef(requests.length);
  const isWriter = writerStatus === 'active';

  // Vibrate on mobile when a new permission arrives
  useEffect(() => {
    if (requests.length > prevCountRef.current && typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(200);
    }
    prevCountRef.current = requests.length;
  }, [requests.length]);

  const handleRespond = useCallback(
    (requestId: string, approved: boolean) => {
      onRespond(requestId, approved);
    },
    [onRespond],
  );

  if (requests.length === 0) {
    return null;
  }

  return (
    <aside
      className="animate-slide-in-top sticky top-0 z-20 space-y-2 rounded-b-lg border border-amber-500/50 bg-amber-950/30 p-3 backdrop-blur-sm"
      role="alert"
      aria-live="polite"
    >
      <p className="text-xs font-medium uppercase tracking-wider text-amber-400">
        {requests.length} pending permission{requests.length !== 1 ? 's' : ''}
      </p>
      {requests.map((req) => (
        <PermissionCard
          key={req.id}
          request={req}
          isWriter={isWriter}
          onRespond={handleRespond}
        />
      ))}
    </aside>
  );
}
