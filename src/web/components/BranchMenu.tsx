import type { SessionMeta } from '@/shared/types';

interface BranchMenuProps {
  session: SessionMeta;
}

export function BranchMenu({ session }: BranchMenuProps) {
  // TODO(T22): support long-press branch creation from a specific message.
  return <div className="text-sm text-stone-400">当前会话: {session.name}</div>;
}
