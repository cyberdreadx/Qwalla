import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewToken,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { colors, radius, spacing } from '@/constants/theme';

const { width: SCREEN_W } = Dimensions.get('window');

type Slide = {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  accent: string;
};

const slides: Slide[] = [
  {
    id: 'welcome',
    icon: 'shield-checkmark',
    title: 'Welcome to Qwalla',
    subtitle:
      'Your quantum-safe companion for RougeChain — wallet, messaging, and mail in one app.',
    accent: colors.accent,
  },
  {
    id: 'wallet',
    icon: 'wallet',
    title: 'Quantum-Safe Wallet',
    subtitle:
      'Send & receive XRGE with ML-DSA-65 signatures. Your keys never leave your device.',
    accent: '#6C5CE7',
  },
  {
    id: 'chat',
    icon: 'chatbubble',
    title: 'Encrypted Messaging',
    subtitle:
      'End-to-end encrypted chats powered by ML-KEM-768. Self-destructing messages included.',
    accent: '#2EE6A8',
  },
  {
    id: 'mail',
    icon: 'mail',
    title: 'Quantum-Safe Mail',
    subtitle:
      'Send encrypted mail to @qwalla.mail addresses. Register your name on-chain.',
    accent: '#FDCB6E',
  },
];

const TOTAL = slides.length + 1;

export default function WelcomeScreen() {
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
                  <Text style={styles.ctaTitle}>Ready to go!</Text>
                  <Text style={styles.ctaSub}>
                    Create a new quantum-safe wallet or import an existing one.
                  </Text>
                  <View style={styles.ctaButtons}>
                    <Link href="/(auth)/create-wallet" asChild>
                      <Button title="Create wallet" style={styles.ctaBtn} />
                    </Link>
                    <Link href="/(auth)/import-wallet" asChild>
                      <Button
                        title="I have a wallet"
                        variant="secondary"
                        style={styles.ctaBtn}
                      />
                    </Link>
                  </View>
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
                <Text style={styles.slideTitle}>{slide.title}</Text>
                <Text style={styles.slideSub}>{slide.subtitle}</Text>
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
              <Text style={styles.skipText}>Skip</Text>
            </Pressable>
            <Pressable
              onPress={goNext}
              style={({ pressed }) => [styles.nextBtn, pressed && { opacity: 0.85 }]}>
              <Ionicons name="arrow-forward" size={20} color={colors.bg} />
            </Pressable>
          </View>
        ) : (
          <View style={styles.navRow}>
            <Text style={styles.secureNote}>
              NIST-approved post-quantum cryptography (FIPS 203 & 204)
            </Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
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
