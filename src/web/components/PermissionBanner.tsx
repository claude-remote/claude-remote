import type { PermissionRequest } from '@/shared/types';

interface PermissionBannerProps {
  requests: PermissionRequest[];
}

export function PermissionBanner({ requests }: PermissionBannerProps) {
  // TODO(T16): add active-writer actions, standby notifications, and degraded approval routing.
  if (requests.length === 0) {
    return null;
  }

  return (
    <aside className="rounded border border-amber-500/50 bg-amber-500/10 p-3">
      <p className="text-sm">有 {requests.length} 条待审批权限请求。</p>
    </aside>
  );
}
