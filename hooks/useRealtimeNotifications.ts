import { useEffect, useRef } from 'react';

import { rougeWs, type WsEvent } from '@/lib/ws';
import { useNotificationStore, type NotificationType } from '@/stores/notifications';
import { useWalletStore } from '@/stores/wallet';
import { showToast } from '@/components/ui/Toast';

export function useRealtimeNotifications() {
  const wallet = useWalletStore((s) => s.wallet);
  const push = useNotificationStore((s) => s.push);
  const incChats = useNotificationStore((s) => s.incUnreadChats);
  const incMail = useNotificationStore((s) => s.incUnreadMail);
  const pubkey = wallet?.publicKey ?? null;
  const pubkeyRef = useRef(pubkey);
  pubkeyRef.current = pubkey;

  useEffect(() => {
    if (!pubkey) return;

    rougeWs.connect();

    const unsub = rougeWs.subscribe((event: WsEvent) => {
      const pk = pubkeyRef.current;
      if (!pk) return;

      // Realtime messenger nudge: notify members (not the sender) of a new
      // encrypted message. Membership is checked against the broadcast
      // participant list so non-members are never notified.
      if (event.type === 'new_message') {
        const participants = event.participant_ids ?? [];
        const sender = event.sender_wallet_id ?? '';
        if (sender !== pk && participants.includes(pk)) {
          const n = { type: 'message' as NotificationType, title: 'New message', body: 'You received an encrypted message.' };
          push(n);
          showToast({ id: `ws-${Date.now()}`, ...n });
          incChats();
        }
        return;
      }

      const tx = event.tx;
      if (!tx) return;

      const isRecipient = tx.to === pk;
      const isSender = tx.from === pk;
      if (!isRecipient && !isSender) return;

      const txType = tx.tx_type ?? event.type ?? '';
      const amount = tx.amount ?? 0;
      const token = tx.token ?? 'XRGE';

      if (txType === 'message' || txType === 'messenger') {
        if (isRecipient) {
          const n = { type: 'message' as NotificationType, title: 'New message', body: 'You received an encrypted message.' };
          push(n);
          showToast({ id: `ws-${Date.now()}`, ...n });
          incChats();
        }
        return;
      }

      if (txType === 'mail') {
        if (isRecipient) {
          const n = { type: 'mail' as NotificationType, title: 'New mail', body: 'You received encrypted mail.' };
          push(n);
          showToast({ id: `ws-${Date.now()}`, ...n });
          incMail();
        }
        return;
      }

      if (isRecipient) {
        const n = { type: 'transfer_in' as NotificationType, title: 'Transfer received', body: `+${amount} ${token}` };
        push(n);
        showToast({ id: `ws-${Date.now()}`, ...n });
      } else if (isSender) {
        const n = { type: 'transfer_out' as NotificationType, title: 'Transfer sent', body: `-${amount} ${token}` };
        push(n);
        showToast({ id: `ws-${Date.now()}`, ...n });
      }
    });

    return () => {
      unsub();
      rougeWs.disconnect();
    };
  }, [pubkey]);
}
