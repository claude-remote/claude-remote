import type { SessionMeta } from '@/shared/types';

interface NotificationItem {
  id: string;
  title: string;
  session?: Pick<SessionMeta, 'id' | 'name'>;
}

interface NotificationCenterProps {
  notifications: NotificationItem[];
}

export function NotificationCenter({ notifications }: NotificationCenterProps) {
  // TODO(T23): add unread counts, grouping, and notification source routing.
  return (
    <section className="rounded border border-stone-800 p-3">
      <p className="text-sm text-stone-400">通知 {notifications.length}</p>
    </section>
  );
}
