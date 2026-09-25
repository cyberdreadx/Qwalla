import { useEffect, useRef } from 'react';
import { signRequest } from '@rougechain/sdk';

import { rougeWs, type WsEvent } from '@/lib/ws';
import { useNotificationStore, type NotificationType } from '@/stores/notifications';
import { useSettingsStore } from '@/stores/settings';
import { useMutedConversations } from '@/stores/muted-conversations';
import { useWalletStore } from '@/stores/wallet';
import { showToast } from '@/components/ui/Toast';
import { formatL1Human, l1ToHuman } from '@/lib/format';
import { nativePubkeyToAddress } from '@qwalla/core/wallet';

export function useRealtimeNotifications() {
  const wallet = useWalletStore((s) => s.wallet);
  const push = useNotificationStore((s) => s.push);
  const incChats = useNotificationStore((s) => s.incUnreadChats);
  const incMail = useNotificationStore((s) => s.incUnreadMail);
  const pubkey = wallet?.publicKey ?? null;
  const pubkeyRef = useRef(pubkey);
  pubkeyRef.current = pubkey;
  // A transfer records the counterparty as the rouge1 address, not the pubkey,
  // so match both forms — matching only the pubkey meant incoming-crypto alerts
  // never fired (same bug the wallet's Recent Activity had).
  const addrRef = useRef<string | null>(null);
  useEffect(() => {
    try {
      addrRef.current = pubkey ? nativePubkeyToAddress(pubkey).toLowerCase() : null;
    } catch {
      addrRef.current = null;
    }
  }, [pubkey]);

  useEffect(() => {
    if (!pubkey) return;

    rougeWs.connect();
    // Authenticate this socket as our messenger identity so the node delivers our
    // private new_message events (sender + participants included, never content).
    if (wallet) {
      rougeWs.setAuthSigner(() => signRequest(wallet, { action: 'messenger_ws_subscribe' }));
    }

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

      const addr = addrRef.current;
      const pkl = pk.toLowerCase();
      const to = String(tx.to ?? '').toLowerCase();
      const from = String(tx.from ?? '').toLowerCase();
      const isRecipient = to === pkl || (addr !== null && to === addr);
      const isSender = from === pkl || (addr !== null && from === addr);
      if (!isRecipient && !isSender) return;

      const txType = tx.tx_type ?? event.type ?? '';
      const amount = tx.amount ?? 0;
      const token = tx.token ?? 'XRGE';
      const humanAmount = formatL1Human(token, l1ToHuman(token, Number(amount)));

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
        alert({ type: 'transfer_in', title: 'Crypto received', body: `+${humanAmount} ${token}` });
      } else if (isSender) {
        alert({ type: 'transfer_out', title: 'Crypto sent', body: `-${humanAmount} ${token}` });
      }
    });

    return () => {
      unsub();
      rougeWs.setAuthSigner(null);
      rougeWs.disconnect();
    };
  }, [pubkey]); // eslint-disable-line react-hooks/exhaustive-deps
}
