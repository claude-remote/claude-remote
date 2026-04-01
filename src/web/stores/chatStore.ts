import { create } from 'zustand';

import type { Message, PermissionRequest } from '@/shared/types';

interface ChatStoreState {
  messages: Message[];
  pendingPermissions: PermissionRequest[];
  setMessages(messages: Message[]): void;
  setPendingPermissions(requests: PermissionRequest[]): void;
}

export const useChatStore = create<ChatStoreState>((set) => ({
  messages: [],
  pendingPermissions: [],
  setMessages(messages) {
    // TODO(T14,T15): support streaming append/replace semantics and branch resets.
    set({ messages });
  },
  setPendingPermissions(requests) {
    // TODO(T16): coordinate active-writer approval state and downgrade broadcasts.
    set({ pendingPermissions: requests });
  },
}));
