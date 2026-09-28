import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  FlatList,
  Image,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewToken,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import * as Clipboard from 'expo-clipboard';
import { Button } from '@/components/ui/Button';
import { LangSwitch } from '@/components/LangSwitch';
import { colors, radius, spacing } from '@/constants/theme';
import { useT } from '@/lib/i18n';
import { WALLET_SUPPORTED, debugWalletStorage, getStoredFormat } from '@/lib/secure-store';
import { recoveryDebug } from '@/lib/recovery-debug';
import { useWalletStore } from '@/stores/wallet';

/**
 * Recovery guard: the boot-time hydrate can wrongly land here when secure storage
 * wasn't ready yet, but reads are reliable by the time THIS screen renders
 * (confirmed on-device: getStoredFormat returns 'encrypted' here). So if a wallet
 * record actually exists, re-hydrate — which flips the UI to the lock screen —
 * instead of leaving the user stranded on create/import.
 */
function useWalletRecovery() {
  useEffect(() => {
    let cancelled = false;
    recoveryDebug.mounts += 1;
    recoveryDebug.cancelled = false;
    (async () => {
      // Poll for as long as we're on this screen. Secure storage can be unready
      // for many seconds after a cold start on some devices; keep checking until
      // it responds (then re-hydrate → lock screen). If there's genuinely no
      // wallet, getStoredFormat stays 'none' and this idles harmlessly until the
      // user creates/imports (which unmounts this screen).
      while (!cancelled) {
        const s = useWalletStore.getState();
        if (s.wallet || s.isLocked || s.accounts.length > 0) return; // recovered / has wallet
        let fmt: 'none' | 'encrypted' | 'legacy' = 'none';
        try {
          fmt = await getStoredFormat();
        } catch {
          /* retry */
        }
        recoveryDebug.polls += 1;
        recoveryDebug.lastFmt = fmt;
        if (cancelled) return;
        if (fmt !== 'none') {
          // Pass the format so hydrate commits to the lock screen without a
          // racy re-read.
          recoveryDebug.hydrateCalled = true;
          await useWalletStore.getState().hydrate(fmt);
          return;
        }
        await new Promise((r) => setTimeout(r, 1200));
      }
    })();
    return () => {
      cancelled = true;
      recoveryDebug.cancelled = true;
    };
  }, []);
}

/**
 * Temporary storage diagnostic while chasing "wallet gone on restart". Shows what
 * each storage slot holds so we can tell an actual wipe from a read miss. Remove
 * once resolved.
 */
function StorageDebug() {
  const [info, setInfo] = useState('reading…');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    debugWalletStorage().then(setInfo).catch((e) => setInfo(`err: ${String(e)}`));
  }, []);
  return (
    <View style={dbgStyles.wrap}>
      <Text style={dbgStyles.title}>storage diagnostic</Text>
      <Text style={dbgStyles.mono} selectable>{info}</Text>
      <Text
        style={dbgStyles.copy}
        onPress={async () => {
          await Clipboard.setStringAsync(info);
          setCopied(true);
        }}>
        {copied ? 'copied ✓' : 'tap to copy'}
      </Text>
    </View>
  );
}

const dbgStyles = StyleSheet.create({
  wrap: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  title: { color: colors.textTertiary, fontSize: 10, fontWeight: '700', marginBottom: 4, letterSpacing: 0.5 },
  mono: { color: colors.textSecondary, fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  copy: { color: colors.accent, fontSize: 11, fontWeight: '700', marginTop: 6 },
});

const { width: SCREEN_W } = Dimensions.get('window');

type Slide = {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  titleKey: string;
  subKey: string;
  accent: string;
};

const slides: Slide[] = [
  {
    id: 'welcome',
    icon: 'shield-checkmark',
    titleKey: 'aw_slide_welcome_title',
    subKey: 'aw_slide_welcome_sub',
    accent: colors.accent,
  },
  {
    id: 'wallet',
    icon: 'wallet',
    titleKey: 'aw_slide_wallet_title',
    subKey: 'aw_slide_wallet_sub',
    accent: '#6C5CE7',
  },
  {
    id: 'chat',
    icon: 'chatbubble',
    titleKey: 'aw_slide_chat_title',
    subKey: 'aw_slide_chat_sub',
    accent: '#2EE6A8',
  },
  {
    id: 'mail',
    icon: 'mail',
    titleKey: 'aw_slide_mail_title',
    subKey: 'aw_slide_mail_sub',
    accent: '#FDCB6E',
  },
];

const TOTAL = slides.length + 1;

export default function WelcomeScreen() {
  const { t } = useT();
  useWalletRecovery();
  const [activeIndex, setActiveIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const scrollX = useRef(new Animated.Value(0)).current;

  const onViewableChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length > 0 && viewableItems[0].index != null) {
        setActiveIndex(viewableItems[0].index);
      }
    }
  ).current;

  const viewConfig = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;

  function goNext() {
    if (activeIndex < TOTAL - 1) {
      flatListRef.current?.scrollToIndex({ index: activeIndex + 1 });
    }
  }

  const isLast = activeIndex === TOTAL - 1;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.topBar}>
        <LangSwitch />
      </View>
      <Animated.FlatList
        ref={flatListRef}
        data={[...slides, { id: 'cta' }] as (Slide | { id: 'cta' })[]}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: scrollX } } }],
          { useNativeDriver: false }
        )}
        onViewableItemsChanged={onViewableChanged}
        viewabilityConfig={viewConfig}
        renderItem={({ item, index }) => {
          if (item.id === 'cta') {
            return (
              <View style={styles.slide}>
                <View style={styles.slideContent}>
                  <Image
                    source={require('@/assets/images/koala-mascot.png')}
                    style={styles.mascot}
                  />
                  <Text style={styles.ctaTitle}>{t('aw_cta_title')}</Text>
                  <Text style={styles.ctaSub}>
                    {!WALLET_SUPPORTED ? t('aw_cta_sub_web') : t('aw_cta_sub')}
                  </Text>
                  {!WALLET_SUPPORTED ? (
                    <View style={styles.ctaButtons}>
                      <Button
                        title={t('aw_btn_appstore')}
                        style={styles.ctaBtn}
                        onPress={() =>
                          Linking.openURL('https://apps.apple.com/us/app/qwalla/id6794071016')
                        }
                      />
                      <Link href="/" asChild>
                        <Button title={t('aw_btn_back_site')} variant="secondary" style={styles.ctaBtn} />
                      </Link>
                    </View>
                  ) : (
                    <View style={styles.ctaButtons}>
                      <Link href="/(auth)/create-wallet" asChild>
                        <Button title={t('aw_btn_create')} style={styles.ctaBtn} />
                      </Link>
                      <Link href="/(auth)/import-wallet" asChild>
                        <Button
                          title={t('aw_btn_have')}
                          variant="secondary"
                          style={styles.ctaBtn}
                        />
                      </Link>
                    </View>
                  )}
                  {WALLET_SUPPORTED ? <StorageDebug /> : null}
                </View>
              </View>
            );
          }

          const slide = item as Slide;
          return (
            <View style={styles.slide}>
              <View style={styles.slideContent}>
                <Image
                  source={require('@/assets/images/koala-mascot.png')}
                  style={styles.mascot}
                />
                <View style={[styles.iconBadge, { backgroundColor: slide.accent + '20' }]}>
                  <Ionicons name={slide.icon} size={28} color={slide.accent} />
                </View>
                <Text style={styles.slideTitle}>{t(slide.titleKey)}</Text>
                <Text style={styles.slideSub}>{t(slide.subKey)}</Text>
              </View>
            </View>
          );
        }}
      />

      {/* Bottom area: dots + next/skip */}
      <View style={styles.bottom}>
        {/* Dots */}
        <View style={styles.dots}>
          {Array.from({ length: TOTAL }).map((_, i) => {
            const inputRange = [(i - 1) * SCREEN_W, i * SCREEN_W, (i + 1) * SCREEN_W];
            const dotWidth = scrollX.interpolate({
              inputRange,
              outputRange: [8, 24, 8],
              extrapolate: 'clamp',
            });
            const dotOpacity = scrollX.interpolate({
              inputRange,
              outputRange: [0.3, 1, 0.3],
              extrapolate: 'clamp',
            });
            return (
              <Animated.View
                key={i}
                style={[
                  styles.dot,
                  { width: dotWidth, opacity: dotOpacity },
                  i === TOTAL - 1 && { backgroundColor: colors.accent },
                ]}
              />
            );
          })}
        </View>

        {/* Navigation */}
        {!isLast ? (
          <View style={styles.navRow}>
            <Pressable
              onPress={() => flatListRef.current?.scrollToIndex({ index: TOTAL - 1 })}
              style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
              <Text style={styles.skipText}>{t('aw_skip')}</Text>
            </Pressable>
            <Pressable
              onPress={goNext}
              style={({ pressed }) => [styles.nextBtn, pressed && { opacity: 0.85 }]}>
              <Ionicons name="arrow-forward" size={20} color={colors.bg} />
            </Pressable>
          </View>
        ) : (
          <View style={styles.navRow}>
            <Text style={styles.secureNote}>{t('aw_secure_note')}</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
  },
  slide: {
    width: SCREEN_W,
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  slideContent: {
    alignItems: 'center',
    maxWidth: 320,
  },

  iconBadge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  slideTitle: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: -0.3,
    marginBottom: spacing.md,
  },
  slideSub: {
    color: colors.textSecondary,
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
  },

  mascot: { width: 120, height: 120, borderRadius: 60, marginBottom: spacing.lg },
  ctaTitle: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: -0.3,
    marginBottom: spacing.sm,
  },
  ctaSub: {
    color: colors.textSecondary,
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  ctaButtons: { width: '100%' },
  ctaBtn: { marginBottom: spacing.sm, width: '100%' },

  bottom: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
    gap: 6,
  },
  dot: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.text,
  },

  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  skipText: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '600',
  },
  nextBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secureNote: {
    color: colors.textTertiary,
    fontSize: 11,
    textAlign: 'center',
    flex: 1,
    lineHeight: 16,
  },
});
