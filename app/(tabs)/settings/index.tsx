import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, FlatList, Image, Linking, Platform, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import QRScanner from '@/components/dapp/QRScanner';
import { MAIL_DOMAIN } from '@/constants/config';
import { colors, radius, spacing } from '@/constants/theme';
import { getBiometricLabel, isBiometricAvailable } from '@/lib/biometric';
import { base64Bytes, compressImageToLimit } from '@/lib/image-compress';
import { clearMessageCache } from '@/lib/message-cache';
import { NATIVE_PBKDF2_AVAILABLE } from '@/lib/pbkdf2';
import { getConnectedSites, removeConnectedSite, type ConnectedSite } from '@qwalla/core/provider-bridge';
import { getSessions, removeSession, parsePairingUri, startPairingSession, type DappSession } from '@/lib/dapp-session';
import { registerName } from '@/lib/names';
import { registerPushNotifications, unregisterPushNotifications } from '@/lib/push';
import { rc } from '@/lib/rougechain';
import { NETWORK_IDS, NETWORKS } from '@/constants/networks';
import { useNetworkStore } from '@/stores/network';
import { useT } from '@/lib/i18n';
import { AUTO_LOCK_OPTIONS, TAB_SLEEP_OPTIONS, useSettingsStore } from '@/stores/settings';
import { useWalletStore } from '@/stores/wallet';
import type { ApprovalRequest } from '@/lib/dapp-provider';

type NftItem = {
  collectionId?: string;
  collection_id?: string;
  tokenId?: string | number;
  token_id?: string | number;
  name?: string;
  metadataUri?: string;
  metadata_uri?: string;
  image?: string;
};

export default function SettingsScreen() {
  const wallet = useWalletStore((s) => s.wallet);
  const networkId = useNetworkStore((s) => s.networkId);
  const switchNetwork = useNetworkStore((s) => s.switchNetwork);
  const encPub = useWalletStore((s) => s.encPublicKey);
  const displayName = useWalletStore((s) => s.displayName);
  const mnemonic = useWalletStore((s) => s.mnemonic);
  const avatarUrl = useWalletStore((s) => s.avatarUrl);
  const hasPassword = useWalletStore((s) => s.hasPassword);
  const setDisplayName = useWalletStore((s) => s.setDisplayName);
  const setAvatar = useWalletStore((s) => s.setAvatar);
  const setPasswordStore = useWalletStore((s) => s.setPassword);
  const lockWallet = useWalletStore((s) => s.lock);
  const logout = useWalletStore((s) => s.logout);
  const biometricEnabled = useWalletStore((s) => s.biometricEnabled);
  const enableBiometricsStore = useWalletStore((s) => s.enableBiometrics);
  const disableBiometricsStore = useWalletStore((s) => s.disableBiometrics);
  const { t, lang, setLang } = useT();
  const autoLockMs = useSettingsStore((s) => s.autoLockMs);
  const setAutoLockMs = useSettingsStore((s) => s.setAutoLockMs);
  const notificationsEnabled = useSettingsStore((s) => s.notificationsEnabled);
  const setNotificationsEnabled = useSettingsStore((s) => s.setNotificationsEnabled);
  const browserTabSleepMs = useSettingsStore((s) => s.browserTabSleepMs);
  const setBrowserTabSleepMs = useSettingsStore((s) => s.setBrowserTabSleepMs);

  const [profileName, setProfileName] = useState('');
  const [registryName, setRegistryName] = useState('');
  const [busy, setBusy] = useState(false);
  const [notifBusy, setNotifBusy] = useState(false);
  const [showPhrase, setShowPhrase] = useState(false);
  const [phraseCopied, setPhraseCopied] = useState(false);
  const [backupPass, setBackupPass] = useState('');
  const [backupConfirm, setBackupConfirm] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);

  // Password setup
  const [showSetPassword, setShowSetPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  // Biometric unlock
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioLabel, setBioLabel] = useState(t('s_biometrics'));
  const [showBioPassword, setShowBioPassword] = useState(false);
  const [bioPassword, setBioPassword] = useState('');
  const [bioError, setBioError] = useState('');
  const [bioBusy, setBioBusy] = useState(false);

  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(message: string, type: 'success' | 'error' = 'success') {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    Animated.timing(toastOpacity, { toValue: 1, duration: 250, useNativeDriver: true }).start();
    toastTimer.current = setTimeout(() => {
      Animated.timing(toastOpacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => setToast(null));
    }, 3500);
  }

  const [showNftPicker, setShowNftPicker] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [nfts, setNfts] = useState<NftItem[]>([]);
  const [nftLoading, setNftLoading] = useState(false);

  const [connectedSites, setConnectedSites] = useState<ConnectedSite[]>([]);
  const [dappSessions, setDappSessions] = useState<DappSession[]>([]);
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [pairingApproval, setPairingApproval] = useState<ApprovalRequest | null>(null);

  const refreshDappData = useCallback(async () => {
    const [sites, sessions] = await Promise.all([getConnectedSites(), getSessions()]);
    setConnectedSites(sites);
    setDappSessions(sessions);
  }, []);

  useEffect(() => {
    void refreshDappData();
  }, [refreshDappData]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const available = await isBiometricAvailable();
      if (cancelled) return;
      setBioAvailable(available);
      if (available) setBioLabel(await getBiometricLabel());
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleEnableBiometrics() {
    if (!bioPassword) return;
    setBioBusy(true);
    setBioError('');
    try {
      const ok = await enableBiometricsStore(bioPassword);
      if (ok) {
        setShowBioPassword(false);
        setBioPassword('');
        showToast(t('s_bio_unlock_enabled').replace('{x}', bioLabel));
      } else {
        setBioError(t('s_wrong_password'));
      }
    } catch (e) {
      setBioError(e instanceof Error ? e.message : t('s_could_not_enable'));
    } finally {
      setBioBusy(false);
    }
  }

  async function handleDisableBiometrics() {
    await disableBiometricsStore();
    setShowBioPassword(false);
    setBioPassword('');
    setBioError('');
    showToast(t('s_bio_unlock_disabled').replace('{x}', bioLabel));
  }

  const loadNfts = useCallback(async () => {
    if (!wallet) return;
    setNftLoading(true);
    try {
      const owned = await rc.nft.getByOwner(wallet.publicKey);
      setNfts(Array.isArray(owned) ? (owned as NftItem[]) : []);
    } catch {
      setNfts([]);
    } finally {
      setNftLoading(false);
    }
  }, [wallet]);

  useEffect(() => {
    if (showNftPicker) void loadNfts();
  }, [showNftPicker, loadNfts]);

  const [nftImages, setNftImages] = useState<Record<string, string>>({});

  function nftImage(n: NftItem): string {
    if (n.image) return n.image;
    const key = `${n.collectionId ?? n.collection_id}-${n.tokenId ?? n.token_id}`;
    if (nftImages[key]) return nftImages[key];
    return '';
  }

  useEffect(() => {
    if (!showNftPicker || nfts.length === 0) return;
    let cancelled = false;
    (async () => {
      const resolved: Record<string, string> = {};
      await Promise.all(
        nfts.map(async (n) => {
          if (n.image) return;
          const rawUri = n.metadataUri ?? n.metadata_uri;
          if (!rawUri) return;
          const uri = rawUri.startsWith('ipfs://') ? rawUri.replace('ipfs://', 'https://ipfs.io/ipfs/') : rawUri;
          const key = `${n.collectionId ?? n.collection_id}-${n.tokenId ?? n.token_id}`;
          try {
            const res = await fetch(uri);
            const json = await res.json();
            let img = json.image as string | undefined;
            if (img?.startsWith('ipfs://')) img = img.replace('ipfs://', 'https://ipfs.io/ipfs/');
            if (img) resolved[key] = img;
          } catch { /* skip */ }
        })
      );
      if (!cancelled && Object.keys(resolved).length > 0) {
        setNftImages((prev) => ({ ...prev, ...resolved }));
      }
    })();
    return () => { cancelled = true; };
  }, [showNftPicker, nfts]);

  async function pickAvatarPhoto() {
    if (avatarBusy) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      showToast(t('s_allow_photo_access'), 'error');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      base64: true,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];

    setAvatarBusy(true);
    try {
      // Avatars are stored inline in the (persisted) wallet bundle, so keep them
      // small. Compress to a square-ish JPEG under ~256 KB before saving.
      const LIMIT = 256 * 1024;
      let dataUri: string | null = null;
      const fitted = await compressImageToLimit(asset.uri, LIMIT, asset.width);
      if (fitted) {
        dataUri = `data:${fitted.mimeType};base64,${fitted.base64}`;
      } else if (asset.base64 && base64Bytes(asset.base64) <= LIMIT) {
        dataUri = `data:${asset.mimeType ?? 'image/jpeg'};base64,${asset.base64}`;
      }
      if (!dataUri) {
        showToast(t('s_image_too_large'), 'error');
        return;
      }
      await setAvatar(dataUri);
      setShowNftPicker(false);
      showToast(t('s_avatar_updated'));
    } catch (e) {
      showToast(e instanceof Error ? e.message : t('s_could_not_set_avatar'), 'error');
    } finally {
      setAvatarBusy(false);
    }
  }

  async function saveProfile() {
    const n = profileName.trim();
    if (!n) return;
    try {
      await setDisplayName(n);
      setProfileName('');
      showToast(t('s_display_name_updated'));
    } catch (e) {
      showToast(e instanceof Error ? e.message : t('s_failed_to_save'), 'error');
    }
  }

  async function registerMailName() {
    if (!wallet || !encPub) return;
    const local = registryName.trim().toLowerCase().replace(/@.*/, '');
    if (!local) {
      showToast(t('s_enter_name'), 'error');
      return;
    }
    setBusy(true);
    try {
      const r = await registerName(wallet, {
        name: local,
        publicKey: wallet.publicKey,
        encPublicKey: encPub,
      });
      if (!r.success) {
        showToast(r.error ?? t('s_could_not_register'), 'error');
        return;
      }
      setRegistryName('');
      showToast(t('s_registered_onchain').replace('{x}', local).replace('{y}', MAIL_DOMAIN));
    } catch (e) {
      showToast(e instanceof Error ? e.message : t('s_registration_failed'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleSetPassword() {
    if (newPassword.length < 8) {
      setPasswordError(t('s_password_min8'));
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordError(t('s_passwords_dont_match'));
      return;
    }
    setPasswordError('');
    setSavingPassword(true);
    try {
      await setPasswordStore(newPassword);
      setNewPassword('');
      setConfirmNewPassword('');
      setShowSetPassword(false);
      showToast(t('s_password_set'));
    } catch (e) {
      setPasswordError(e instanceof Error ? e.message : t('s_failed_set_password'));
    }
    setSavingPassword(false);
  }

  async function handleToggleNotifications(next: boolean) {
    if (notifBusy) return;
    setNotifBusy(true);
    try {
      if (next) {
        // Flip the preference first so registerPushNotifications (which now
        // respects it) doesn't short-circuit, then request permission + token.
        await setNotificationsEnabled(true);
        const ok = wallet ? await registerPushNotifications(wallet) : false;
        if (!ok) {
          await setNotificationsEnabled(false);
          showToast(t('s_allow_notifications'), 'error');
          return;
        }
        showToast(t('s_notifications_enabled'));
      } else {
        await setNotificationsEnabled(false);
        if (wallet) await unregisterPushNotifications(wallet);
        showToast(t('s_notifications_disabled'));
      }
    } finally {
      setNotifBusy(false);
    }
  }

  const [clearingCache, setClearingCache] = useState(false);

  async function handleClearMessageCache() {
    if (clearingCache) return;
    // Safe + non-destructive: only the on-device message/chat-list cache is
    // removed. The wallet, keys, and your messages on the network are untouched
    // — conversations simply re-download on next open.
    const message = t('s_clear_cache_message');
    const proceed =
      Platform.OS === 'web'
        ? window.confirm(message)
        : await new Promise<boolean>((resolve) =>
            Alert.alert(t('s_clear_cache_title'), message, [
              { text: t('s_cancel'), style: 'cancel', onPress: () => resolve(false) },
              { text: t('s_clear'), style: 'destructive', onPress: () => resolve(true) },
            ]),
          );
    if (!proceed) return;
    setClearingCache(true);
    try {
      await clearMessageCache();
      showToast(t('s_message_cache_cleared'));
    } catch {
      showToast(t('s_could_not_clear_cache'), 'error');
    } finally {
      setClearingCache(false);
    }
  }

  async function handleLock() {
    if (Platform.OS === 'web') {
      if (window.confirm(t('s_lock_confirm_web'))) {
        await lockWallet();
      }
    } else {
      Alert.alert(t('s_lock_wallet_q'), t('s_lock_need_password'), [
        { text: t('s_cancel'), style: 'cancel' },
        { text: t('s_lock'), onPress: () => void lockWallet() },
      ]);
    }
  }

  async function onLogout() {
    await logout();
    router.replace('/(auth)/welcome');
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {toast && (
        <Animated.View
          style={[
            styles.toast,
            toast.type === 'error' ? styles.toastError : styles.toastSuccess,
            { opacity: toastOpacity, top: insets.top + 8 },
          ]}>
          <Ionicons
            name={toast.type === 'error' ? 'close-circle' : 'checkmark-circle'}
            size={18}
            color="#fff"
          />
          <Text style={styles.toastText}>{toast.message}</Text>
        </Animated.View>
      )}
      <KeyboardAwareScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        bottomOffset={spacing.lg}>
        {/* Header */}
        <View style={styles.brandRow}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.headerAvatar} />
          ) : (
            <Image source={require('@/assets/images/koala-mascot.png')} style={styles.mascot} />
          )}
          <View>
            <Text style={styles.screenTitle}>QWALLA</Text>
            <Text style={styles.screenSub}>{displayName || t('s_settings')}</Text>
          </View>
        </View>

        {/* Profile card */}
        <Card style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardIcon}>
              <Ionicons name="person" size={16} color={colors.accent} />
            </View>
            <Text style={styles.cardTitle}>{t('s_profile')}</Text>
          </View>
          {displayName ? (
            <Text style={styles.currentName}>{t('s_current').replace('{x}', displayName)}</Text>
          ) : null}
          <Field
            label={t('s_display_name')}
            value={profileName}
            onChangeText={setProfileName}
            placeholder={t('s_update_nickname')}
          />
          <Button title={t('s_save')} variant="secondary" onPress={saveProfile} />
        </Card>

        {/* Network card */}
        <Card style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardIcon}>
              <Ionicons name="globe" size={16} color={colors.accent} />
            </View>
            <Text style={styles.cardTitle}>{t('s_network')}</Text>
          </View>
          {NETWORK_IDS.map((id) => {
            const net = NETWORKS[id];
            const active = networkId === id;
            return (
              <Pressable
                key={id}
                onPress={() => {
                  if (active) return;
                  void switchNetwork(id).then(() =>
                    showToast(t('s_switched_to').replace('{x}', net.label)),
                  );
                }}
                style={({ pressed }) => [
                  styles.networkRow,
                  active && styles.networkRowActive,
                  pressed && { opacity: 0.8 },
                ]}>
                <View style={[styles.networkDot, { backgroundColor: net.color }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.networkName}>{net.label}</Text>
                  <Text style={styles.networkDesc}>{net.description}</Text>
                </View>
                {active ? (
                  <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
                ) : (
                  <View style={styles.networkRadio} />
                )}
              </Pressable>
            );
          })}
          {networkId === 'devnet' ? (
            <Text style={styles.networkWarn}>{t('s_devnet_warn')}</Text>
          ) : null}
        </Card>

        {/* Avatar card */}
        <Card style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardIcon}>
              <Ionicons name="image" size={16} color={colors.accent} />
            </View>
            <Text style={styles.cardTitle}>{t('s_profile_picture')}</Text>
          </View>

          <View style={styles.avatarPreviewRow}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatarPreview} />
            ) : (
              <View style={[styles.avatarPreview, styles.avatarPlaceholder]}>
                <Ionicons name="person" size={28} color={colors.textTertiary} />
              </View>
            )}
            <View style={styles.avatarActions}>
              <Text style={styles.hint}>
                {avatarUrl ? t('s_custom_avatar_set') : t('s_upload_or_nft')}
              </Text>
              <View style={styles.avatarBtnRow}>
                <Button
                  title={avatarBusy ? t('s_uploading') : t('s_upload_photo')}
                  variant="secondary"
                  onPress={pickAvatarPhoto}
                  disabled={avatarBusy}
                />
                <Button
                  title={showNftPicker ? t('s_close') : t('s_choose_nft')}
                  variant="secondary"
                  onPress={() => setShowNftPicker(!showNftPicker)}
                />
                {avatarUrl && (
                  <Pressable
                    onPress={() => void setAvatar(null)}
                    style={({ pressed }) => [styles.removeAvatarBtn, pressed && { opacity: 0.7 }]}>
                    <Ionicons name="close-circle" size={16} color={colors.error} />
                    <Text style={styles.removeAvatarText}>{t('s_remove')}</Text>
                  </Pressable>
                )}
              </View>
            </View>
          </View>

          {showNftPicker && (
            <View style={styles.nftPickerContainer}>
              {nftLoading ? (
                <ActivityIndicator color={colors.accent} style={{ padding: 20 }} />
              ) : nfts.length === 0 ? (
                <Text style={[styles.hint, { textAlign: 'center', paddingVertical: 16 }]}>
                  {t('s_no_nfts')}
                </Text>
              ) : (
                <FlatList
                  data={nfts}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyExtractor={(n, i) => `${n.collectionId ?? n.collection_id}-${n.tokenId ?? n.token_id ?? i}`}
                  contentContainerStyle={styles.nftList}
                  renderItem={({ item }) => {
                    const img = nftImage(item);
                    const selected = img === avatarUrl;
                    return (
                      <Pressable
                        onPress={() => {
                          if (img) {
                            void setAvatar(img);
                            setShowNftPicker(false);
                          }
                        }}
                        style={({ pressed }) => [
                          styles.nftCard,
                          selected && styles.nftCardSelected,
                          pressed && { opacity: 0.8 },
                        ]}>
                        {img ? (
                          <Image source={{ uri: img }} style={styles.nftImage} />
                        ) : (
                          <View style={[styles.nftImage, styles.nftNoImage]}>
                            <Ionicons name="image-outline" size={20} color={colors.textTertiary} />
                          </View>
                        )}
                        <Text style={styles.nftName} numberOfLines={1}>
                          {item.name ?? `#${item.tokenId ?? item.token_id ?? '?'}`}
                        </Text>
                        {selected && (
                          <View style={styles.nftCheck}>
                            <Ionicons name="checkmark-circle" size={18} color={colors.accent} />
                          </View>
                        )}
                      </Pressable>
                    );
                  }}
                />
              )}
            </View>
          )}
        </Card>

        {/* Mail name card */}
        <Card style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardIcon}>
              <Ionicons name="at" size={16} color={colors.accent} />
            </View>
            <Text style={styles.cardTitle}>{t('s_mail_name')}</Text>
          </View>
          <Text style={styles.hint}>
            {t('s_register_mail_lookup').replace('{x}', MAIL_DOMAIN)}
          </Text>
          <Field
            label={t('s_local_name_label')}
            value={registryName}
            onChangeText={setRegistryName}
            placeholder={t('s_yourname')}
            autoCapitalize="none"
          />
          <Button title={t('s_register_onchain_btn')} loading={busy} onPress={registerMailName} />
        </Card>

        {/* Notifications card (native only — web doesn't receive push) */}
        {Platform.OS !== 'web' && (
          <Card style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardIcon}>
                <Ionicons name="notifications" size={16} color={colors.accent} />
              </View>
              <Text style={styles.cardTitle}>{t('s_notifications')}</Text>
            </View>
            <View style={styles.notifRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.notifTitle}>{t('s_push_notifications')}</Text>
                <Text style={styles.notifSub}>
                  {t('s_push_sub')}
                </Text>
              </View>
              <Switch
                value={notificationsEnabled}
                onValueChange={handleToggleNotifications}
                disabled={notifBusy}
                trackColor={{ false: colors.border, true: colors.accentMid }}
                thumbColor={notificationsEnabled ? colors.accent : colors.textTertiary}
                ios_backgroundColor={colors.border}
              />
            </View>
            <Text style={[styles.hint, { marginTop: spacing.md, marginBottom: 0 }]}>
              {t('s_push_hint')}
            </Text>
          </Card>
        )}

        {/* Browser card — auto-sleep inactive tabs to save memory */}
        <Card style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardIcon}>
              <Ionicons name="compass" size={16} color={colors.accent} />
            </View>
            <Text style={styles.cardTitle}>{t('s_browser')}</Text>
          </View>
          <Text style={styles.autoLockLabel}>{t('s_tab_sleep')}</Text>
          <View style={styles.autoLockRow}>
            {TAB_SLEEP_OPTIONS.map((opt) => {
              const active = browserTabSleepMs === opt.ms;
              return (
                <Pressable
                  key={opt.ms}
                  onPress={() => {
                    if (active) return;
                    void setBrowserTabSleepMs(opt.ms);
                  }}
                  style={({ pressed }) => [
                    styles.autoLockChip,
                    active && styles.autoLockChipActive,
                    pressed && { opacity: 0.8 },
                  ]}>
                  <Text style={[styles.autoLockChipText, active && styles.autoLockChipTextActive]}>
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={[styles.hint, { marginTop: spacing.md, marginBottom: 0 }]}>
            {t('s_tab_sleep_hint')}
          </Text>
        </Card>

        {/* Wallet Lock card */}
        <Card style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardIcon}>
              <Ionicons name="language" size={16} color={colors.accent} />
            </View>
            <Text style={styles.cardTitle}>{t('set_language')}</Text>
          </View>
          <View style={styles.autoLockRow}>
            {(['en', 'es'] as const).map((l) => {
              const active = lang === l;
              return (
                <Pressable
                  key={l}
                  onPress={() => { if (!active) setLang(l); }}
                  style={({ pressed }) => [
                    styles.autoLockChip,
                    active && styles.autoLockChipActive,
                    pressed && { opacity: 0.8 },
                  ]}>
                  <Text style={[styles.autoLockChipText, active && styles.autoLockChipTextActive]}>
                    {l === 'en' ? t('lang_english') : t('lang_spanish')}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Card>

        <Card style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardIcon}>
              <Ionicons name="lock-closed" size={16} color={colors.accent} />
            </View>
            <Text style={styles.cardTitle}>{t('s_wallet_lock')}</Text>
          </View>

          {hasPassword ? (
            <>
              <Text style={styles.hint}>
                {t('s_wallet_lock_hint')}
              </Text>

              <Text style={styles.autoLockLabel}>{t('s_auto_lock')}</Text>
              <View style={styles.autoLockRow}>
                {AUTO_LOCK_OPTIONS.map((opt) => {
                  const active = autoLockMs === opt.ms;
                  return (
                    <Pressable
                      key={opt.ms}
                      onPress={() => {
                        if (active) return;
                        void setAutoLockMs(opt.ms);
                        showToast(t('s_autolock_toast').replace('{x}', opt.label.toLowerCase()));
                      }}
                      style={({ pressed }) => [
                        styles.autoLockChip,
                        active && styles.autoLockChipActive,
                        pressed && { opacity: 0.8 },
                      ]}>
                      <Text style={[styles.autoLockChipText, active && styles.autoLockChipTextActive]}>
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Pressable
                onPress={handleLock}
                style={({ pressed }) => [styles.lockBtn, { marginTop: spacing.md }, pressed && { opacity: 0.85 }]}>
                <Ionicons name="lock-closed" size={16} color={colors.accent} />
                <Text style={styles.lockBtnText}>{t('s_lock_wallet_now')}</Text>
              </Pressable>
              <Pressable
                onPress={() => setShowSetPassword(!showSetPassword)}
                style={({ pressed }) => [{ marginTop: spacing.sm }, pressed && { opacity: 0.7 }]}>
                <Text style={styles.changePwText}>{t('s_change_password')}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.hint}>
                {t('s_set_password_hint')}
              </Text>
              {!showSetPassword && (
                <Button
                  title={t('s_set_lock_password')}
                  variant="secondary"
                  onPress={() => setShowSetPassword(true)}
                />
              )}
            </>
          )}

          {showSetPassword && (
            <View style={styles.passwordSection}>
              <TextInput
                style={styles.passwordInput}
                placeholder={t('s_new_password_ph')}
                placeholderTextColor={colors.textTertiary}
                secureTextEntry
                value={newPassword}
                onChangeText={(v) => { setNewPassword(v); setPasswordError(''); }}
              />
              <TextInput
                style={styles.passwordInput}
                placeholder={t('s_confirm_password_ph')}
                placeholderTextColor={colors.textTertiary}
                secureTextEntry
                value={confirmNewPassword}
                onChangeText={(v) => { setConfirmNewPassword(v); setPasswordError(''); }}
                onSubmitEditing={handleSetPassword}
              />
              {passwordError ? (
                <Text style={styles.passwordError}>{passwordError}</Text>
              ) : null}
              {confirmNewPassword.length > 0 && newPassword === confirmNewPassword && newPassword.length >= 6 && (
                <Text style={styles.passwordMatch}>{t('s_passwords_match')}</Text>
              )}
              <View style={styles.passwordBtnRow}>
                <Button
                  title={savingPassword ? t('s_saving') : t('s_set_password')}
                  onPress={handleSetPassword}
                  disabled={savingPassword || newPassword.length < 8 || newPassword !== confirmNewPassword}
                />
                <Pressable
                  onPress={() => { setShowSetPassword(false); setNewPassword(''); setConfirmNewPassword(''); setPasswordError(''); }}
                  style={{ paddingVertical: 8 }}>
                  <Text style={styles.changePwText}>{t('s_cancel')}</Text>
                </Pressable>
              </View>
            </View>
          )}

          {hasPassword && bioAvailable && (
            <View style={styles.bioSection}>
              <View style={styles.bioRow}>
                <Ionicons
                  name={bioLabel.includes('Face') ? 'scan-outline' : 'finger-print'}
                  size={18}
                  color={colors.accent}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.bioTitle}>{t('s_bio_unlock').replace('{x}', bioLabel)}</Text>
                  <Text style={styles.bioSub}>
                    {biometricEnabled
                      ? t('s_bio_use_instead').replace('{x}', bioLabel)
                      : t('s_bio_unlock_instead').replace('{x}', bioLabel)}
                  </Text>
                </View>
                {biometricEnabled ? (
                  <Pressable
                    onPress={handleDisableBiometrics}
                    style={({ pressed }) => [styles.bioToggleOff, pressed && { opacity: 0.7 }]}>
                    <Text style={styles.bioToggleOffText}>{t('s_turn_off')}</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={() => { setShowBioPassword((v) => !v); setBioError(''); }}
                    style={({ pressed }) => [styles.bioToggleOn, pressed && { opacity: 0.85 }]}>
                    <Text style={styles.bioToggleOnText}>{showBioPassword ? t('s_cancel') : t('s_enable')}</Text>
                  </Pressable>
                )}
              </View>

              {!biometricEnabled && showBioPassword && (
                <View style={styles.passwordSection}>
                  <TextInput
                    style={styles.passwordInput}
                    placeholder={t('s_confirm_wallet_password_ph')}
                    placeholderTextColor={colors.textTertiary}
                    secureTextEntry
                    value={bioPassword}
                    onChangeText={(v) => { setBioPassword(v); setBioError(''); }}
                    onSubmitEditing={handleEnableBiometrics}
                  />
                  {bioError ? <Text style={styles.passwordError}>{bioError}</Text> : null}
                  <Button
                    title={bioBusy ? t('s_enabling') : t('s_enable_bio').replace('{x}', bioLabel)}
                    onPress={handleEnableBiometrics}
                    disabled={bioBusy || !bioPassword}
                  />
                </View>
              )}
            </View>
          )}
        </Card>

        {/* Recovery phrase card */}
        {mnemonic && (
          <Card style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardIcon}>
                <Ionicons name="shield-checkmark" size={16} color={colors.accent} />
              </View>
              <Text style={styles.cardTitle}>{t('s_recovery_phrase')}</Text>
            </View>
            {showPhrase ? (
              <>
                <View style={styles.phraseGrid}>
                  {mnemonic.split(' ').map((word, i) => (
                    <View key={i} style={styles.phraseWord}>
                      <Text style={styles.phraseNum}>{i + 1}</Text>
                      <Text style={styles.phraseText}>{word}</Text>
                    </View>
                  ))}
                </View>
                <View style={styles.phraseActions}>
                  <Pressable
                    onPress={async () => {
                      await Clipboard.setStringAsync(mnemonic);
                      setPhraseCopied(true);
                      setTimeout(() => setPhraseCopied(false), 2000);
                    }}
                    style={({ pressed }) => [styles.phraseCopyBtn, pressed && { opacity: 0.7 }]}>
                    <Ionicons
                      name={phraseCopied ? 'checkmark-circle' : 'copy-outline'}
                      size={16}
                      color={phraseCopied ? colors.success : colors.accent}
                    />
                    <Text style={[styles.phraseCopyLabel, phraseCopied && { color: colors.success }]}>
                      {phraseCopied ? t('s_copied') : t('s_copy')}
                    </Text>
                  </Pressable>
                  <Pressable onPress={() => setShowPhrase(false)}>
                    <Text style={styles.phraseHideLabel}>{t('s_hide')}</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.hint}>
                  {t('s_recovery_hint')}
                </Text>
                <Button
                  title={t('s_reveal_recovery')}
                  variant="secondary"
                  onPress={() => {
                    if (Platform.OS === 'web') {
                      if (window.confirm(t('s_reveal_confirm_web'))) setShowPhrase(true);
                    } else {
                      Alert.alert(t('s_are_you_sure'), t('s_no_one_looking'), [
                        { text: t('s_cancel'), style: 'cancel' },
                        { text: t('s_show'), onPress: () => setShowPhrase(true) },
                      ]);
                    }
                  }}
                />
              </>
            )}
          </Card>
        )}

        {/* Encrypted backup card */}
        {wallet && (
          <Card style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardIcon}>
                <Ionicons name="download-outline" size={16} color={colors.accent} />
              </View>
              <Text style={styles.cardTitle}>{t('s_encrypted_backup')}</Text>
            </View>
            <Text style={styles.hint}>
              {t('s_backup_hint')}
            </Text>
            <Field
              label={t('s_backup_passphrase')}
              value={backupPass}
              onChangeText={setBackupPass}
              placeholder={t('s_min8')}
              secureTextEntry
            />
            <Field
              label={t('s_confirm_passphrase')}
              value={backupConfirm}
              onChangeText={setBackupConfirm}
              placeholder={t('s_reenter_passphrase')}
              secureTextEntry
            />
            {backupConfirm.length > 0 && backupPass !== backupConfirm && (
              <Text style={{ color: colors.error, fontSize: 12, marginBottom: spacing.sm }}>{t('s_passphrases_dont_match')}</Text>
            )}
            {backupConfirm.length > 0 && backupPass === backupConfirm && backupPass.length >= 8 && (
              <Text style={{ color: colors.success, fontSize: 12, marginBottom: spacing.sm }}>{t('s_passphrases_match')}</Text>
            )}
            <Button
              title={backupBusy ? t('s_encrypting') : t('s_export_encrypted_backup')}
              disabled={backupBusy || backupPass.length < 8 || backupPass !== backupConfirm}
              onPress={async () => {
                setBackupBusy(true);
                try {
                  const { exportEncryptedBackup } = await import('@/lib/encrypted-backup');
                  await exportEncryptedBackup(
                    {
                      publicKey: wallet.publicKey,
                      privateKey: wallet.privateKey,
                      encPublicKey: encPub ?? undefined,
                      encPrivateKey: useWalletStore.getState().encPrivateKey ?? undefined,
                      mnemonic: mnemonic ?? undefined,
                      displayName: displayName || undefined,
                    },
                    backupPass,
                  );
                  showToast(t('s_backup_exported'));
                  setBackupPass('');
                  setBackupConfirm('');
                } catch (e) {
                  showToast(e instanceof Error ? e.message : t('s_export_failed'), 'error');
                } finally {
                  setBackupBusy(false);
                }
              }}
            />
          </Card>
        )}

        {/* Connected Sites */}
        <Card style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardIcon}>
              <Ionicons name="globe" size={16} color={colors.accent} />
            </View>
            <Text style={styles.cardTitle}>{t('s_connected_sites')}</Text>
          </View>
          {connectedSites.length === 0 ? (
            <Text style={styles.hint}>{t('s_no_dapps')}</Text>
          ) : (
            connectedSites.map((site) => (
              <View key={site.origin} style={styles.siteRow}>
                <View style={styles.siteIcon}>
                  <Ionicons name="link" size={14} color={colors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.siteOrigin} numberOfLines={1}>{site.origin}</Text>
                  <Text style={styles.siteDate}>
                    {t('s_connected_date').replace('{x}', new Date(site.connectedAt).toLocaleDateString())}
                  </Text>
                </View>
                <Pressable
                  onPress={async () => {
                    await removeConnectedSite(site.origin);
                    void refreshDappData();
                  }}
                  style={({ pressed }) => [styles.siteRemove, pressed && { opacity: 0.7 }]}>
                  <Ionicons name="close-circle" size={18} color={colors.error} />
                </Pressable>
              </View>
            ))
          )}
        </Card>

        {/* Active Sessions */}
        <Card style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardIcon}>
              <Ionicons name="radio" size={16} color={colors.accent} />
            </View>
            <Text style={styles.cardTitle}>{t('s_active_sessions')}</Text>
            <Pressable
              onPress={() => setShowQRScanner(true)}
              style={({ pressed }) => [styles.scanBtn, pressed && { opacity: 0.7 }]}>
              <Ionicons name="qr-code" size={16} color={colors.accent} />
              <Text style={styles.scanBtnText}>{t('s_scan')}</Text>
            </Pressable>
          </View>
          {dappSessions.length === 0 ? (
            <Text style={styles.hint}>{t('s_no_sessions')}</Text>
          ) : (
            dappSessions.map((session) => (
              <View key={session.topic} style={styles.siteRow}>
                <View style={styles.siteIcon}>
                  <Ionicons name="radio-outline" size={14} color={colors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.siteOrigin} numberOfLines={1}>
                    {session.peerName || t('s_session').replace('{x}', session.topic.slice(0, 8))}
                  </Text>
                  <Text style={styles.siteDate}>
                    {t('s_paired_date').replace('{x}', new Date(session.connectedAt).toLocaleDateString())}
                  </Text>
                </View>
                <Pressable
                  onPress={async () => {
                    await removeSession(session.topic);
                    void refreshDappData();
                  }}
                  style={({ pressed }) => [styles.siteRemove, pressed && { opacity: 0.7 }]}>
                  <Ionicons name="close-circle" size={18} color={colors.error} />
                </Pressable>
              </View>
            ))
          )}
        </Card>

        <QRScanner
          visible={showQRScanner}
          onClose={() => setShowQRScanner(false)}
          onScanned={async (data) => {
            const params = parsePairingUri(data);
            if (!params) {
              showToast(t('s_invalid_qr'), 'error');
              return;
            }
            const ok = await startPairingSession(params, (req) => setPairingApproval(req));
            if (ok) {
              showToast(t('s_paired_success'));
              void refreshDappData();
            } else {
              showToast(t('s_pairing_failed'), 'error');
            }
          }}
        />

        {pairingApproval && (() => {
          const ApprovalModal = require('@/components/dapp/ApprovalModal').default;
          return (
            <ApprovalModal
              request={pairingApproval}
              onClose={() => setPairingApproval(null)}
            />
          );
        })()}

        {/* Legal */}
        <Card style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardIcon}>
              <Ionicons name="document-text" size={16} color={colors.accent} />
            </View>
            <Text style={styles.cardTitle}>{t('s_legal')}</Text>
          </View>
          <Pressable
            onPress={() => void Linking.openURL('https://qwalla.io/privacy')}
            style={({ pressed }) => [styles.legalRow, pressed && { opacity: 0.7 }]}>
            <Text style={styles.legalText}>{t('s_privacy_policy')}</Text>
            <Ionicons name="open-outline" size={14} color={colors.textTertiary} />
          </Pressable>
          <Pressable
            onPress={() => void Linking.openURL('https://qwalla.io/terms')}
            style={({ pressed }) => [styles.legalRow, pressed && { opacity: 0.7 }]}>
            <Text style={styles.legalText}>{t('s_terms')}</Text>
            <Ionicons name="open-outline" size={14} color={colors.textTertiary} />
          </Pressable>
        </Card>

        {/* Lock + Disconnect */}
        {hasPassword && (
          <Pressable
            onPress={handleLock}
            style={({ pressed }) => [styles.lockWalletBtn, pressed && { opacity: 0.8 }]}>
            <Ionicons name="lock-closed" size={18} color={colors.accent} />
            <Text style={styles.lockWalletText}>{t('s_lock_wallet')}</Text>
          </Pressable>
        )}

        <Pressable
          onPress={onLogout}
          style={({ pressed }) => [styles.logoutBtn, pressed && { opacity: 0.8 }]}>
          <Ionicons name="log-out-outline" size={18} color={colors.error} />
          <Text style={styles.logoutText}>{t('s_disconnect_wallet')}</Text>
        </Pressable>

        {/* Diagnostics */}
        <Card style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardIcon}>
              <Ionicons name="pulse" size={16} color={colors.accent} />
            </View>
            <Text style={styles.cardTitle}>{t('s_diagnostics')}</Text>
          </View>

          <View style={styles.diagRow}>
            <Text style={styles.diagLabel}>{t('s_crypto_engine')}</Text>
            <View style={styles.diagBadgeWrap}>
              <View
                style={[
                  styles.diagDot,
                  { backgroundColor: NATIVE_PBKDF2_AVAILABLE ? colors.success : colors.error },
                ]}
              />
              <Text
                style={[
                  styles.diagValue,
                  { color: NATIVE_PBKDF2_AVAILABLE ? colors.success : colors.error },
                ]}>
                {NATIVE_PBKDF2_AVAILABLE ? t('s_native_fast') : t('s_js_fallback')}
              </Text>
            </View>
          </View>

          {!NATIVE_PBKDF2_AVAILABLE && Platform.OS !== 'web' && (
            <Text style={styles.diagWarn}>
              {t('s_diag_warn')}
            </Text>
          )}

          <View style={styles.diagRow}>
            <Text style={styles.diagLabel}>{t('s_app_version')}</Text>
            <Text style={styles.diagValueMono}>{Constants.expoConfig?.version ?? '1.0.0'}</Text>
          </View>
          <View style={styles.diagRow}>
            <Text style={styles.diagLabel}>{t('s_native_build')}</Text>
            <Text style={styles.diagValueMono}>{Constants.nativeBuildVersion ?? '—'}</Text>
          </View>
          <View style={styles.diagRow}>
            <Text style={styles.diagLabel}>{t('s_platform')}</Text>
            <Text style={styles.diagValueMono}>
              {Platform.OS} {String(Platform.Version)}
            </Text>
          </View>

          <Pressable
            onPress={async () => {
              const report =
                `Qwalla diagnostics\n` +
                `crypto: ${NATIVE_PBKDF2_AVAILABLE ? 'native' : 'js-fallback'}\n` +
                `appVersion: ${Constants.expoConfig?.version ?? '1.0.0'}\n` +
                `nativeBuild: ${Constants.nativeBuildVersion ?? '-'}\n` +
                `platform: ${Platform.OS} ${String(Platform.Version)}`;
              await Clipboard.setStringAsync(report);
              showToast(t('s_diagnostics_copied'));
            }}
            style={({ pressed }) => [styles.diagCopyBtn, pressed && { opacity: 0.7 }]}>
            <Ionicons name="copy-outline" size={14} color={colors.accent} />
            <Text style={styles.diagCopyText}>{t('s_copy_diagnostics')}</Text>
          </Pressable>

          <Pressable
            onPress={handleClearMessageCache}
            disabled={clearingCache}
            style={({ pressed }) => [styles.diagCopyBtn, pressed && { opacity: 0.7 }]}>
            <Ionicons name="trash-outline" size={14} color={colors.accent} />
            <Text style={styles.diagCopyText}>
              {clearingCache ? t('s_clearing') : t('s_clear_cached_data')}
            </Text>
          </Pressable>
          <Text style={styles.diagCacheHint}>
            {t('s_diag_cache_hint')}
          </Text>
        </Card>

        {/* Version */}
        <Text style={styles.version}>
          Qwalla · v{Constants.expoConfig?.version ?? '1.0.0'}
        </Text>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg, position: 'relative' },
  toast: {
    position: 'absolute',
    top: 8,
    left: spacing.lg,
    right: spacing.lg,
    zIndex: 100,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: radius.md,
  },
  toastSuccess: { backgroundColor: colors.success },
  toastError: { backgroundColor: colors.error },
  toastText: { color: '#fff', fontWeight: '600', fontSize: 14, flex: 1 },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: spacing.lg },
  mascot: { width: 32, height: 32, borderRadius: 16 },
  headerAvatar: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: colors.border },
  screenTitle: { color: colors.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.4 },
  screenSub: { color: colors.textSecondary, fontSize: 12, marginTop: 1 },
  card: { marginBottom: spacing.md },
  networkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
    marginBottom: 6,
  },
  networkRowActive: {
    backgroundColor: colors.accentDim,
    borderColor: colors.accentMid,
  },
  networkDot: { width: 8, height: 8, borderRadius: 4 },
  networkName: { color: colors.text, fontWeight: '700', fontSize: 14 },
  networkDesc: { color: colors.textTertiary, fontSize: 11, marginTop: 2 },
  networkRadio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: colors.borderLight,
  },
  networkWarn: {
    color: colors.warning,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: spacing.md },
  cardIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: colors.accentDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { color: colors.text, fontWeight: '700', fontSize: 15 },
  currentName: { color: colors.textSecondary, fontSize: 13, marginBottom: spacing.md },
  hint: { color: colors.textSecondary, fontSize: 13, marginBottom: spacing.md, lineHeight: 18 },
  phraseGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  phraseWord: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.input,
    borderRadius: 6,
    paddingVertical: 7,
    paddingHorizontal: 10,
    width: '30%',
    flexGrow: 1,
  },
  phraseNum: { color: colors.textTertiary, fontSize: 10, fontWeight: '700', width: 18 },
  phraseText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  phraseActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  phraseCopyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  phraseCopyLabel: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  phraseHideLabel: { color: colors.textTertiary, fontSize: 13, fontWeight: '600' },
  exportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  exportLabel: {
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    width: 72,
  },
  exportValue: {
    flex: 1,
    color: colors.text,
    fontSize: 11,
    fontFamily: 'SpaceMono',
    opacity: 0.85,
  },
  avatarPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  avatarPreview: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  avatarPlaceholder: {
    backgroundColor: colors.input,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarActions: { flex: 1 },
  avatarBtnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  removeAvatarBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  removeAvatarText: { color: colors.error, fontSize: 13, fontWeight: '600' },
  nftPickerContainer: {
    marginTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  nftList: { gap: spacing.sm, paddingVertical: spacing.xs },
  nftCard: {
    width: 88,
    borderRadius: radius.md,
    backgroundColor: colors.input,
    padding: 4,
    alignItems: 'center',
  },
  nftCardSelected: {
    borderWidth: 2,
    borderColor: colors.accent,
  },
  nftImage: {
    width: 80,
    height: 80,
    borderRadius: radius.sm,
  },
  nftNoImage: {
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nftName: {
    color: colors.text,
    fontSize: 10,
    fontWeight: '600',
    marginTop: 4,
    textAlign: 'center',
    width: '100%',
  },
  nftCheck: {
    position: 'absolute',
    top: 4,
    right: 4,
  },
  siteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  siteIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: colors.accentDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  siteOrigin: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '500',
  },
  siteDate: {
    color: colors.textTertiary,
    fontSize: 11,
    marginTop: 1,
  },
  siteRemove: {
    padding: 4,
  },
  scanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 'auto',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.accentDim,
    borderRadius: radius.sm,
  },
  scanBtnText: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '600',
  },
  // Wallet lock
  lockBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: colors.accentDim,
    borderWidth: 1,
    borderColor: 'rgba(31,224,197,0.2)',
  },
  lockBtnText: {
    color: colors.accent,
    fontWeight: '600',
    fontSize: 14,
  },
  changePwText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  autoLockLabel: {
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: spacing.sm,
  },
  autoLockRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  autoLockChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  autoLockChipActive: {
    backgroundColor: colors.accentDim,
    borderColor: colors.accentMid,
  },
  autoLockChipText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  autoLockChipTextActive: {
    color: colors.accent,
  },
  notifRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  notifTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  notifSub: {
    color: colors.textTertiary,
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },
  passwordSection: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  bioSection: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  bioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  bioTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  bioSub: {
    color: colors.textTertiary,
    fontSize: 12,
    marginTop: 2,
  },
  bioToggleOn: {
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  bioToggleOnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  bioToggleOff: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  bioToggleOffText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
  },
  passwordInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'web' ? 12 : 10,
    color: colors.text,
    fontSize: 14,
  },
  passwordError: {
    color: colors.error,
    fontSize: 12,
  },
  passwordMatch: {
    color: colors.success,
    fontSize: 12,
  },
  passwordBtnRow: {
    gap: spacing.sm,
    alignItems: 'center',
  },
  legalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  legalText: {
    color: colors.text,
    fontSize: 14,
  },
  // Bottom action buttons
  lockWalletBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: radius.md,
    backgroundColor: colors.accentDim,
    borderWidth: 1,
    borderColor: 'rgba(31,224,197,0.2)',
    marginTop: spacing.md,
  },
  lockWalletText: { color: colors.accent, fontWeight: '600', fontSize: 14 },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255, 107, 107, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 107, 107, 0.2)',
    marginTop: spacing.sm,
  },
  logoutText: { color: colors.error, fontWeight: '600', fontSize: 14 },
  version: { color: colors.textTertiary, fontSize: 12, textAlign: 'center', marginTop: spacing.xl },
  // Diagnostics
  diagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  diagLabel: { color: colors.textTertiary, fontSize: 13 },
  diagValueMono: { color: colors.text, fontSize: 12, fontFamily: 'SpaceMono' },
  diagBadgeWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  diagDot: { width: 8, height: 8, borderRadius: 4 },
  diagValue: { fontSize: 13, fontWeight: '700' },
  diagWarn: {
    color: colors.warning,
    fontSize: 12,
    lineHeight: 17,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  diagCopyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginTop: spacing.md,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    backgroundColor: colors.accentDim,
  },
  diagCopyText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  diagCacheHint: { color: colors.textTertiary, fontSize: 11, marginTop: spacing.sm, lineHeight: 15 },
});
