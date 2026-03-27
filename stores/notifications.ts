import { create } from 'zustand';

export type NotificationType = 'transfer_in' | 'transfer_out' | 'message' | 'mail' | 'block' | 'info';

export type AppNotification = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  timestamp: number;
  read: boolean;
};

type NotificationState = {
  items: AppNotification[];
  unreadChats: number;
  unreadMail: number;

  push: (n: Omit<AppNotification, 'id' | 'timestamp' | 'read'>) => void;
  markAllRead: () => void;
  incUnreadChats: (n?: number) => void;
  incUnreadMail: (n?: number) => void;
  setUnreadChats: (n: number) => void;
  setUnreadMail: (n: number) => void;
  clearUnreadChats: () => void;
  clearUnreadMail: () => void;
  clear: () => void;
};

let seq = 0;

export const useNotificationStore = create<NotificationState>((set) => ({
  items: [],
  unreadChats: 0,
  unreadMail: 0,

  push: (n) =>
    set((s) => ({
      items: [
        { ...n, id: `n-${Date.now()}-${seq++}`, timestamp: Date.now(), read: false },
        ...s.items,
      ].slice(0, 100),
    })),

  markAllRead: () =>
    set((s) => ({
      items: s.items.map((i) => ({ ...i, read: true })),
    })),

  incUnreadChats: (n = 1) => set((s) => ({ unreadChats: s.unreadChats + n })),
  incUnreadMail: (n = 1) => set((s) => ({ unreadMail: s.unreadMail + n })),
  setUnreadChats: (n) => set({ unreadChats: n }),
  setUnreadMail: (n) => set({ unreadMail: n }),
  clearUnreadChats: () => set({ unreadChats: 0 }),
  clearUnreadMail: () => set({ unreadMail: 0 }),
  clear: () => set({ items: [], unreadChats: 0, unreadMail: 0 }),
}));
