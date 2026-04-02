import { create } from 'zustand';

import type { Message, PermissionRequest } from '@/shared/types';

interface ChatStoreState {
  messages: Message[];
  streaming: boolean;
  pendingPermissions: PermissionRequest[];

  addMessage: (message: Message) => void;
  setMessages: (messages: Message[] | ((prev: Message[]) => Message[])) => void;
  setStreaming: (streaming: boolean) => void;
  addPermission: (request: PermissionRequest) => void;
  resolvePermission: (id: string) => void;
  setPendingPermissions: (requests: PermissionRequest[]) => void;
  clearMessages: () => void;
}

export const useChatStore = create<ChatStoreState>((set) => ({
  messages: [],
  streaming: false,
  pendingPermissions: [],

  addMessage(message: Message) {
    set((state) => {
      // Replace message if it already exists (streaming update), otherwise append
      const idx = state.messages.findIndex((m) => m.id === message.id);
      if (idx >= 0) {
        const updated = [...state.messages];
        updated[idx] = message;
        return { messages: updated };
      }
      return { messages: [...state.messages, message] };
    });
  },

  setMessages(messages: Message[] | ((prev: Message[]) => Message[])) {
    set((state) => ({
      messages: typeof messages === 'function' ? messages(state.messages) : messages,
    }));
  },

  setStreaming(streaming: boolean) {
    set({ streaming });
  },

  addPermission(request: PermissionRequest) {
    set((state) => ({
      pendingPermissions: [...state.pendingPermissions, request],
    }));
  },

  resolvePermission(id: string) {
    set((state) => ({
      pendingPermissions: state.pendingPermissions.filter((p) => p.id !== id),
    }));
  },

  setPendingPermissions(requests: PermissionRequest[]) {
    set({ pendingPermissions: requests });
  },

  clearMessages() {
    set({ messages: [], streaming: false, pendingPermissions: [] });
  },
}));
