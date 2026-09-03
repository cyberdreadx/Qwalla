import { Platform } from 'react-native';
import Constants from 'expo-constants';

import type { Wallet } from '@rougechain/sdk';

import { rc } from '@/lib/rougechain';

async function setupNotificationHandler() {
  if (Platform.OS === 'web') return;
  const Notifications = await import('expo-notifications');
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

void setupNotificationHandler();

async function getExpoPushToken(): Promise<string | null> {
  if (Platform.OS === 'web') return null;

  const [Notifications, Device] = await Promise.all([
    import('expo-notifications'),
    import('expo-device'),
  ]);

  if (!Device.isDevice) return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Qwalla',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#1FE0C5',
      sound: 'default',
    });
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') return null;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  const tokenData = await Notifications.getExpoPushTokenAsync({
    projectId: projectId ?? undefined,
  });

  return tokenData.data;
}

export async function registerPushNotifications(wallet: Wallet): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const token = await getExpoPushToken();
    if (!token) return false;

    await rc.registerPushToken(wallet, token);
    return true;
  } catch (e) {
    console.warn('Push registration failed:', e);
    return false;
  }
}

export async function unregisterPushNotifications(wallet: Wallet): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await rc.unregisterPushToken(wallet);
  } catch {
    /* best-effort cleanup */
  }
}

export async function addNotificationReceivedListener(
  handler: (notification: { request: { content: { title?: string | null; body?: string | null; data?: Record<string, unknown> | null } } }) => void
) {
  if (Platform.OS === 'web') return { remove: () => {} };
  const Notifications = await import('expo-notifications');
  return Notifications.addNotificationReceivedListener(handler as Parameters<typeof Notifications.addNotificationReceivedListener>[0]);
}

export async function addNotificationResponseListener(
  handler: (response: { notification: { request: { content: { data?: Record<string, unknown> | null } } } }) => void
) {
  if (Platform.OS === 'web') return { remove: () => {} };
  const Notifications = await import('expo-notifications');
  return Notifications.addNotificationResponseReceivedListener(handler as Parameters<typeof Notifications.addNotificationResponseReceivedListener>[0]);
}
