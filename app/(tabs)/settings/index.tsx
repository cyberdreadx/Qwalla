import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, FlatList, Image, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import QRScanner from '@/components/dapp/QRScanner';
import { MAIL_DOMAIN } from '@/constants/config';
import { colors, radius, spacing } from '@/constants/theme';
import { getConnectedSites, removeConnectedSite, type ConnectedSite } from '@/lib/connected-sites';
import { getSessions, removeSession, parsePairingUri, startPairingSession, type DappSession } from '@/lib/dapp-session';
import { registerName } from '@/lib/names';
import { rc } from '@/lib/rougechain';
import { NETWORK_IDS, NETWORKS } from '@/constants/networks';
import { useNetworkStore } from '@/stores/network';
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

  const [profileName, setProfileName] = useState('');
  const [registryName, setRegistryName] = useState('');
  const [busy, setBusy] = useState(false);
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

  async function saveProfile() {
    const n = profileName.trim();
    if (!n) return;
    try {
      await setDisplayName(n);
      setProfileName('');
      showToast('Display name updated');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to save', 'error');
    }
  }

  async function registerMailName() {
    if (!wallet || !encPub) return;
    const local = registryName.trim().toLowerCase().replace(/@.*/, '');
    if (!local) {
      showToast('Enter a name (letters/numbers)', 'error');
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
        showToast(r.error ?? 'Could not register', 'error');
        return;
      }
      setRegistryName('');
      showToast(`${local}@${MAIL_DOMAIN} registered on-chain!`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Registration failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleSetPassword() {
    if (newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordError('Passwords don\'t match');
      return;
    }
    setPasswordError('');
    setSavingPassword(true);
    try {
      await setPasswordStore(newPassword);
      setNewPassword('');
      setConfirmNewPassword('');
      setShowSetPassword(false);
      showToast('Password set! Your wallet will auto-lock when backgrounded.');
    } catch (e) {
      setPasswordError(e instanceof Error ? e.message : 'Failed to set password');
    }
    setSavingPassword(false);
  }

  async function handleLock() {
    if (Platform.OS === 'web') {
      if (window.confirm('Lock your wallet? You\'ll need your password to unlock.')) {
        await lockWallet();
      }
    } else {
      Alert.alert('Lock wallet?', 'You\'ll need your password to unlock.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Lock', onPress: () => void lockWallet() },
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
            { opacity: toastOpacity },
          ]}>
          <Ionicons
            name={toast.type === 'error' ? 'close-circle' : 'checkmark-circle'}
            size={18}
            color="#fff"
          />
          <Text style={styles.toastText}>{toast.message}</Text>
        </Animated.View>
      )}
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Header */}
        <View style={styles.brandRow}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.headerAvatar} />
          ) : (
            <Image source={require('@/assets/images/koala-mascot.png')} style={styles.mascot} />
          )}
          <View>
            <Text style={styles.screenTitle}>QWALLA</Text>
            <Text style={styles.screenSub}>{displayName || 'Settings'}</Text>
          </View>
        </View>

        {/* Profile card */}
        <Card style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardIcon}>
              <Ionicons name="person" size={16} color={colors.accent} />
            </View>
            <Text style={styles.cardTitle}>Profile</Text>
          </View>
          {displayName ? (
            <Text style={styles.currentName}>Current: {displayName}</Text>
          ) : null}
          <Field
            label="Display name"
            value={profileName}
            onChangeText={setProfileName}
            placeholder="Update nickname"
          />
          <Button title="Save" variant="secondary" onPress={saveProfile} />
        </Card>

        {/* Network card */}
        <Card style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardIcon}>
              <Ionicons name="globe" size={16} color={colors.accent} />
            </View>
            <Text style={styles.cardTitle}>Network</Text>
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
                    showToast(`Switched to ${net.label}`),
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
            <Text style={styles.networkWarn}>
              Devnet talks to a local node on this device (127.0.0.1:5100). Nothing will load
              unless a node is running.
            </Text>
          ) : null}
        </Card>

        {/* Avatar card */}
        <Card style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardIcon}>
              <Ionicons name="image" size={16} color={colors.accent} />
            </View>
            <Text style={styles.cardTitle}>Profile picture</Text>
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
                {avatarUrl ? 'Using NFT as avatar' : 'Pick an NFT you own as your avatar'}
              </Text>
              <View style={styles.avatarBtnRow}>
                <Button
                  title={showNftPicker ? 'Close' : 'Choose NFT'}
                  variant="secondary"
                  onPress={() => setShowNftPicker(!showNftPicker)}
                />
                {avatarUrl && (
                  <Pressable
                    onPress={() => void setAvatar(null)}
                    style={({ pressed }) => [styles.removeAvatarBtn, pressed && { opacity: 0.7 }]}>
                    <Ionicons name="close-circle" size={16} color={colors.error} />
                    <Text style={styles.removeAvatarText}>Remove</Text>
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
                  No NFTs found. Mint or receive an NFT to use it as your avatar.
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
            <Text style={styles.cardTitle}>Mail name</Text>
          </View>
          <Text style={styles.hint}>
            Register a name for encrypted mail lookup ({MAIL_DOMAIN}).
          </Text>
          <Field
            label="Local name (before @)"
            value={registryName}
            onChangeText={setRegistryName}
            placeholder="yourname"
            autoCapitalize="none"
          />
          <Button title="Register on-chain" loading={busy} onPress={registerMailName} />
        </Card>

        {/* Wallet Lock card */}
        <Card style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardIcon}>
              <Ionicons name="lock-closed" size={16} color={colors.accent} />
            </View>
            <Text style={styles.cardTitle}>Wallet lock</Text>
          </View>

          {hasPassword ? (
            <>
              <Text style={styles.hint}>
                Your wallet is password-protected. It will auto-lock when the app goes to the background.
              </Text>
              <Pressable
                onPress={handleLock}
                style={({ pressed }) => [styles.lockBtn, pressed && { opacity: 0.85 }]}>
                <Ionicons name="lock-closed" size={16} color={colors.accent} />
                <Text style={styles.lockBtnText}>Lock wallet now</Text>
              </Pressable>
              <Pressable
                onPress={() => setShowSetPassword(!showSetPassword)}
                style={({ pressed }) => [{ marginTop: spacing.sm }, pressed && { opacity: 0.7 }]}>
                <Text style={styles.changePwText}>Change password</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.hint}>
                Set a password to lock your wallet. When locked, you{"'"}ll need your password to access
                funds, messages, and mail.
              </Text>
              {!showSetPassword && (
                <Button
                  title="Set lock password"
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
                placeholder="New password (min 6 characters)"
                placeholderTextColor={colors.textTertiary}
                secureTextEntry
                value={newPassword}
                onChangeText={(t) => { setNewPassword(t); setPasswordError(''); }}
              />
              <TextInput
                style={styles.passwordInput}
                placeholder="Confirm password"
                placeholderTextColor={colors.textTertiary}
                secureTextEntry
                value={confirmNewPassword}
                onChangeText={(t) => { setConfirmNewPassword(t); setPasswordError(''); }}
                onSubmitEditing={handleSetPassword}
              />
              {passwordError ? (
                <Text style={styles.passwordError}>{passwordError}</Text>
              ) : null}
              {confirmNewPassword.length > 0 && newPassword === confirmNewPassword && newPassword.length >= 6 && (
                <Text style={styles.passwordMatch}>Passwords match</Text>
              )}
              <View style={styles.passwordBtnRow}>
                <Button
                  title={savingPassword ? 'Saving…' : 'Set password'}
                  onPress={handleSetPassword}
                  disabled={savingPassword || newPassword.length < 6 || newPassword !== confirmNewPassword}
                />
                <Pressable
                  onPress={() => { setShowSetPassword(false); setNewPassword(''); setConfirmNewPassword(''); setPasswordError(''); }}
                  style={{ paddingVertical: 8 }}>
                  <Text style={styles.changePwText}>Cancel</Text>
                </Pressable>
              </View>
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
              <Text style={styles.cardTitle}>Recovery phrase</Text>
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
                      {phraseCopied ? 'Copied' : 'Copy'}
                    </Text>
                  </Pressable>
                  <Pressable onPress={() => setShowPhrase(false)}>
                    <Text style={styles.phraseHideLabel}>Hide</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.hint}>
                  View your 12-word recovery phrase. Keep it secret — anyone with this phrase can
                  access your wallet.
                </Text>
                <Button
                  title="Reveal recovery phrase"
                  variant="secondary"
                  onPress={() => {
                    if (Platform.OS === 'web') {
                      if (window.confirm('Make sure no one is looking at your screen. Reveal recovery phrase?')) setShowPhrase(true);
                    } else {
                      Alert.alert('Are you sure?', 'Make sure no one is looking at your screen.', [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Show', onPress: () => setShowPhrase(true) },
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
              <Text style={styles.cardTitle}>Encrypted backup</Text>
            </View>
            <Text style={styles.hint}>
              Export an AES-256-GCM encrypted backup file protected by a passphrase. You{"'"}ll need this passphrase to restore.
            </Text>
            <Field
              label="Backup passphrase"
              value={backupPass}
              onChangeText={setBackupPass}
              placeholder="Minimum 8 characters"
              secureTextEntry
            />
            <Field
              label="Confirm passphrase"
              value={backupConfirm}
              onChangeText={setBackupConfirm}
              placeholder="Re-enter passphrase"
              secureTextEntry
            />
            {backupConfirm.length > 0 && backupPass !== backupConfirm && (
              <Text style={{ color: colors.error, fontSize: 12, marginBottom: spacing.sm }}>Passphrases don{"'"}t match</Text>
            )}
            {backupConfirm.length > 0 && backupPass === backupConfirm && backupPass.length >= 8 && (
              <Text style={{ color: colors.success, fontSize: 12, marginBottom: spacing.sm }}>Passphrases match</Text>
            )}
            <Button
              title={backupBusy ? 'Encrypting…' : 'Export encrypted backup'}
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
                  showToast('Encrypted backup exported!');
                  setBackupPass('');
                  setBackupConfirm('');
                } catch (e) {
                  showToast(e instanceof Error ? e.message : 'Export failed', 'error');
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
            <Text style={styles.cardTitle}>Connected Sites</Text>
          </View>
          {connectedSites.length === 0 ? (
            <Text style={styles.hint}>No dApps connected yet. Use the Browser tab to connect to dApps.</Text>
          ) : (
            connectedSites.map((site) => (
              <View key={site.origin} style={styles.siteRow}>
                <View style={styles.siteIcon}>
                  <Ionicons name="link" size={14} color={colors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.siteOrigin} numberOfLines={1}>{site.origin}</Text>
                  <Text style={styles.siteDate}>
                    Connected {new Date(site.connectedAt).toLocaleDateString()}
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
            <Text style={styles.cardTitle}>Active Sessions</Text>
            <Pressable
              onPress={() => setShowQRScanner(true)}
              style={({ pressed }) => [styles.scanBtn, pressed && { opacity: 0.7 }]}>
              <Ionicons name="qr-code" size={16} color={colors.accent} />
              <Text style={styles.scanBtnText}>Scan</Text>
            </Pressable>
          </View>
          {dappSessions.length === 0 ? (
            <Text style={styles.hint}>No active pairing sessions. Scan a QR code from a dApp to pair.</Text>
          ) : (
            dappSessions.map((session) => (
              <View key={session.topic} style={styles.siteRow}>
                <View style={styles.siteIcon}>
                  <Ionicons name="radio-outline" size={14} color={colors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.siteOrigin} numberOfLines={1}>
                    {session.peerName || `Session ${session.topic.slice(0, 8)}`}
                  </Text>
                  <Text style={styles.siteDate}>
                    Paired {new Date(session.connectedAt).toLocaleDateString()}
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
              showToast('Invalid pairing QR code', 'error');
              return;
            }
            const ok = await startPairingSession(params, (req) => setPairingApproval(req));
            if (ok) {
              showToast('Paired successfully!');
              void refreshDappData();
            } else {
              showToast('Pairing failed', 'error');
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
            <Text style={styles.cardTitle}>Legal</Text>
          </View>
          <Pressable
            onPress={() => void Linking.openURL('https://qwalla.io/privacy')}
            style={({ pressed }) => [styles.legalRow, pressed && { opacity: 0.7 }]}>
            <Text style={styles.legalText}>Privacy Policy</Text>
            <Ionicons name="open-outline" size={14} color={colors.textTertiary} />
          </Pressable>
          <Pressable
            onPress={() => void Linking.openURL('https://qwalla.io/terms')}
            style={({ pressed }) => [styles.legalRow, pressed && { opacity: 0.7 }]}>
            <Text style={styles.legalText}>Terms of Service</Text>
            <Ionicons name="open-outline" size={14} color={colors.textTertiary} />
          </Pressable>
        </Card>

        {/* Lock + Disconnect */}
        {hasPassword && (
          <Pressable
            onPress={handleLock}
            style={({ pressed }) => [styles.lockWalletBtn, pressed && { opacity: 0.8 }]}>
            <Ionicons name="lock-closed" size={18} color={colors.accent} />
            <Text style={styles.lockWalletText}>Lock wallet</Text>
          </Pressable>
        )}

        <Pressable
          onPress={onLogout}
          style={({ pressed }) => [styles.logoutBtn, pressed && { opacity: 0.8 }]}>
          <Ionicons name="log-out-outline" size={18} color={colors.error} />
          <Text style={styles.logoutText}>Disconnect wallet</Text>
        </Pressable>

        {/* Version */}
        <Text style={styles.version}>
          Qwalla · v{Constants.expoConfig?.version ?? '1.0.0'}
        </Text>
      </ScrollView>
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
  passwordSection: {
    marginTop: spacing.md,
    gap: spacing.sm,
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
});
