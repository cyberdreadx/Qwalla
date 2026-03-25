import { useEffect } from 'react';
import { Platform } from 'react-native';
import { router } from 'expo-router';

import {
  addNotificationReceivedListener,
  addNotificationResponseListener,
} from '@/lib/push';
import { showToast } from '@/components/ui/Toast';
import { useNotificationStore, type NotificationType } from '@/stores/notifications';

function classifyPush(data: Record<string, unknown>): NotificationType {
  const t = (data.type ?? data.tx_type ?? '') as string;
  if (t === 'message' || t === 'messenger') return 'message';
  if (t === 'mail') return 'mail';
  if (t === 'transfer_in' || t === 'received') return 'transfer_in';
  if (t === 'transfer_out' || t === 'sent') return 'transfer_out';
  return 'info';
}

export function usePushNotifications() {
  const push = useNotificationStore((s) => s.push);
  const incChats = useNotificationStore((s) => s.incUnreadChats);
  const incMail = useNotificationStore((s) => s.incUnreadMail);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    let receivedSub: { remove(): void } | null = null;
    let responseSub: { remove(): void } | null = null;

    void (async () => {
      receivedSub = await addNotificationReceivedListener((notification) => {
        const { title, body } = notification.request.content;
        const data = (notification.request.content.data ?? {}) as Record<string, unknown>;
        const type = classifyPush(data);

        push({ type, title: title ?? 'Notification', body: body ?? '' });
        showToast({
          id: `push-${Date.now()}`,
          type,
          title: title ?? 'Notification',
          body: body ?? '',
        });

        if (type === 'message') incChats();
        if (type === 'mail') incMail();
      });

      responseSub = await addNotificationResponseListener((response) => {
        const data = (response.notification.request.content.data ?? {}) as Record<string, unknown>;
        const type = classifyPush(data);

        if (type === 'message') {
          const conversationId = data.conversationId ?? data.conversation_id;
          if (conversationId) {
            router.push({
              pathname: '/(tabs)/messenger/[id]',
              params: { id: String(conversationId) },
            });
          } else {
            router.push('/(tabs)/messenger');
          }
        } else if (type === 'mail') {
          const mailId = data.mailId ?? data.mail_id ?? data.id;
          if (mailId) {
            router.push({
              pathname: '/(tabs)/mail/[id]',
              params: { id: String(mailId), folder: 'inbox' },
            });
          } else {
            router.push('/(tabs)/mail');
          }
        } else {
          router.push('/(tabs)/wallet');
        }
      });
    })();

    return () => {
      receivedSub?.remove();
      responseSub?.remove();
    };
  }, []);
}
