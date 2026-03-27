import { useEffect, useRef } from 'react';

import { rc } from '@/lib/rougechain';
import { useNotificationStore } from '@/stores/notifications';
import { useWalletStore } from '@/stores/wallet';

/**
 * On app launch (or wallet change), fetch unread chat + mail counts from the
 * server so the tab badges are accurate from the start, not just after a
 * real-time event arrives.
 */
export function useInitialUnreadCounts() {
  const wallet = useWalletStore((s) => s.wallet);
  const setChats = useNotificationStore((s) => s.setUnreadChats);
  const setMail = useNotificationStore((s) => s.setUnreadMail);
  const fetched = useRef<string | null>(null);

  useEffect(() => {
    if (!wallet) return;
    if (fetched.current === wallet.publicKey) return;
    fetched.current = wallet.publicKey;

    (async () => {
      try {
        const convos = await rc.messenger.getConversations(wallet);
        const arr = Array.isArray(convos) ? convos : [];
        let chatCount = 0;
        for (const c of arr) {
          const raw = c as Record<string, unknown>;
          chatCount += Number(raw.unread_count ?? raw.unreadCount ?? 0);
        }
        if (chatCount > 0) setChats(chatCount);
      } catch { /* ignore */ }

      try {
        const inbox = await rc.mail.getInbox(wallet);
        const arr = Array.isArray(inbox) ? inbox : [];
        let mailCount = 0;
        for (const raw of arr as Record<string, unknown>[]) {
          const label = (raw.label ?? {}) as Record<string, unknown>;
          const isRead = label.is_read ?? label.isRead ?? true;
          if (!isRead) mailCount++;
        }
        if (mailCount > 0) setMail(mailCount);
      } catch { /* ignore */ }
    })();
  }, [wallet?.publicKey]);
}
