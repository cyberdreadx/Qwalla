import { useEffect, useRef } from 'react';

import { rougeWs, type WsEvent } from '@/lib/ws';
import { useNotificationStore, type NotificationType } from '@/stores/notifications';
import { useSettingsStore } from '@/stores/settings';
import { useMutedConversations } from '@/stores/muted-conversations';
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

      // In-app alerts (feed entry + toast) respect the notifications preference;
      // unread badge counts always update so the UI stays accurate when off.
      const alertsOn = useSettingsStore.getState().notificationsEnabled;
      const alert = (n: { type: NotificationType; title: string; body: string }) => {
        if (!alertsOn) return;
        push(n);
        showToast({ id: `ws-${Date.now()}`, ...n });
      };

      // Realtime messenger nudge: notify members (not the sender) of a new
      // encrypted message. Membership is checked against the broadcast
      // participant list so non-members are never notified.
      if (event.type === 'new_message') {
        const participants = event.participant_ids ?? [];
        const sender = event.sender_wallet_id ?? '';
        if (sender !== pk && participants.includes(pk)) {
          // Muted conversations still bump the unread badge but raise no alert.
          const muted = useMutedConversations.getState().isMuted(String(event.conversation_id ?? ''));
          if (!muted) {
            alert({ type: 'message', title: 'New message', body: 'You received an encrypted message.' });
          }
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
          alert({ type: 'message', title: 'New message', body: 'You received an encrypted message.' });
          incChats();
        }
        return;
      }

      if (txType === 'mail') {
        if (isRecipient) {
          alert({ type: 'mail', title: 'New mail', body: 'You received encrypted mail.' });
          incMail();
        }
        return;
      }

      if (isRecipient) {
        alert({ type: 'transfer_in', title: 'Transfer received', body: `+${amount} ${token}` });
      } else if (isSender) {
        alert({ type: 'transfer_out', title: 'Transfer sent', body: `-${amount} ${token}` });
      }
    });

    return () => {
      unsub();
      rougeWs.disconnect();
    };
  }, [pubkey]);
}
