import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { createElement, useEffect, useRef, useState, type ComponentProps } from 'react';
import { Animated, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, Platform } from 'react-native';
import Svg, { Circle, Defs, Ellipse, LinearGradient as SvgGradient, Stop } from 'react-native-svg';

import { colors, radius, spacing } from '@/constants/theme';
import { LandingI18nProvider, useT, type Lang } from './i18n';

const ACCENT = colors.accent;
const ACCENT_DIM = colors.accentDim;
const PURPLE = colors.purple;

// Typeface system (web landing only): Space Grotesk for display headings and
// IBM Plex Mono for the small uppercase eyebrow labels — the modern
// post-quantum look. Native falls back to the system font.
const DISPLAY_FONT = Platform.OS === 'web' ? 'Space Grotesk' : undefined;
const MONO_FONT = Platform.OS === 'web' ? 'IBM Plex Mono' : undefined;

// Qwalla's brand gradient (teal → purple), used clipped-to-text on display
// headings — the rougechain.io "gradient headline" move, in Qwalla colors.
const BRAND_GRADIENT = `linear-gradient(110deg, ${colors.accent}, ${colors.purple})`;

/**
 * Display headline with the brand gradient clipped to the text on web (the
 * signature look); plain accent-less text on native. `style` is the RN text
 * style to mirror (font/size/spacing).
 */
function GradientText({ children, style }: { children: string; style: ComponentProps<typeof Text>['style'] }) {
  if (Platform.OS === 'web') {
    const flat = StyleSheet.flatten(style) as Record<string, unknown>;
    return createElement(
      'span',
      {
        style: {
          fontFamily: DISPLAY_FONT,
          fontWeight: String(flat.fontWeight ?? '600'),
          fontSize: flat.fontSize,
          lineHeight: typeof flat.lineHeight === 'number' ? `${flat.lineHeight}px` : flat.lineHeight,
          letterSpacing: typeof flat.letterSpacing === 'number' ? `${flat.letterSpacing}px` : flat.letterSpacing,
          backgroundImage: BRAND_GRADIENT,
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          color: 'transparent',
          display: 'block',
          margin: 0,
          marginBottom: 16,
        },
      } as any,
      children,
    );
  }
  return <Text style={style}>{children}</Text>;
}

/**
 * The hero "lattice" — concentric gradient ellipses orbiting a dark core, with
 * the Qwalla mark centered on top. Mirrors rougechain.io's signature hero art,
 * in Qwalla's teal→purple gradient.
 */
function HeroLattice({ scrollY }: { scrollY?: Animated.Value }) {
  const ellipses = Array.from({ length: 13 }, (_, i) => i);
  // Rotate + gently scale the lattice as the page scrolls (reference behavior).
  const rotate = scrollY
    ? scrollY.interpolate({ inputRange: [0, 600], outputRange: ['0deg', '100deg'], extrapolate: 'clamp' })
    : '0deg';
  const scale = scrollY
    ? scrollY.interpolate({ inputRange: [0, 600], outputRange: [1, 1.08], extrapolate: 'clamp' })
    : 1;
  return (
    <View style={styles.latticeWrap}>
      <Animated.View style={[styles.latticeSvg, { transform: [{ rotate }, { scale }] }]}>
      <Svg viewBox="0 0 600 600" width="100%" height="100%">
        <Defs>
          <SvgGradient id="orbit" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={colors.accent} />
            <Stop offset="0.55" stopColor="#45A9D6" />
            <Stop offset="1" stopColor={colors.purple} />
          </SvgGradient>
        </Defs>
        {ellipses.map((i) => (
          <Ellipse
            key={i}
            cx={300}
            cy={300}
            rx={110 + i * 10}
            ry={245}
            stroke="url(#orbit)"
            strokeWidth={0.8}
            fill="none"
            opacity={0.16 + i * 0.025}
            transform={`rotate(${i * 15} 300 300)`}
          />
        ))}
        <Circle cx={300} cy={300} r={91} fill={colors.bg} stroke="#2c2636" strokeWidth={1} />
      </Svg>
      </Animated.View>
      <Image source={require('@/assets/images/koala-mascot.png')} style={styles.latticeMark} />
      <Text style={styles.latticeCoord}>ML-DSA-65 · ML-KEM-768</Text>
    </View>
  );
}

/** Numbered mono eyebrow with a leading accent dash — "01 / Label". */
function Eyebrow({ num, children }: { num: string; children: string }) {
  return (
    <View style={styles.eyebrowRow}>
      <View style={styles.eyebrowDash} />
      <Text style={styles.eyebrowText}>
        {num} / {children}
      </Text>
    </View>
  );
}

/** Inject the Google Fonts stylesheet once, on web. */
function useLandingFonts() {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const id = 'qwalla-landing-fonts';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href =
      'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Mono:wght@500;600&family=Inter:wght@400;500;600;700&display=swap';
    document.head.appendChild(link);

    // Force the Qwalla koala favicon. Expo's generated favicon.ico ignores our
    // web.favicon source, so override it with an explicit PNG icon link (remove
    // any existing icon links first so the browser picks ours).
    try {
      document.querySelectorAll("link[rel~='icon']").forEach((el) => el.parentNode?.removeChild(el));
      const fav = document.createElement('link');
      fav.rel = 'icon';
      fav.type = 'image/png';
      fav.href = '/favicon.png?v=2';
      document.head.appendChild(fav);
    } catch {
      /* non-fatal */
    }
  }, []);
}

/**
 * Distribution links — update these as new builds ship.
 *   iOS:     App Store listing URL
 *   Android: direct .apk download from the EAS build (expo.dev artifact URL)
 *   Desktop: Electron installer attached to a GitHub release (built locally via
 *            `npx expo export --platform web` + `npm run dist:win` in desktop/).
 * Leave a value as '' to show that platform's button as "Coming soon".
 */
const IOS_APPSTORE_URL = 'https://apps.apple.com/us/app/qwalla/id6794071016';
const ANDROID_PLAY_URL =
  'https://play.google.com/store/apps/details?id=io.qwalla.app';
/** Windows desktop installer (unsigned — SmartScreen warns on first run). */
const DESKTOP_WIN_URL =
  'https://github.com/cyberdreadx/Qwalla/releases/download/desktop-v1.2.0/Qwalla.Setup.1.2.0.exe';
/** Qwalla Browser — standalone Chromium/Electron web3 browser (Windows, unsigned). */
const BROWSER_WIN_URL =
  'https://github.com/cyberdreadx/Qwalla/releases/download/browser-v1.2.0/Qwalla.Browser.Setup.1.2.0.exe';
/** macOS desktop app (universal, Developer ID–signed + notarized). */
const DESKTOP_MAC_URL =
  'https://github.com/cyberdreadx/Qwalla/releases/download/desktop-v1.2.0/Qwalla-macOS-1.2.0.dmg';
/** Qwalla Browser for macOS (universal, signed + notarized). */
const BROWSER_MAC_URL =
  'https://github.com/cyberdreadx/Qwalla/releases/download/browser-v1.2.0/Qwalla-Browser-macOS-1.2.0.dmg';

function LangToggle() {
  const { lang, setLang } = useT();
  const langs: Lang[] = ['en', 'es'];
  return (
    <View style={styles.langToggle}>
      {langs.map((l) => (
        <Pressable
          key={l}
          onPress={() => setLang(l)}
          style={({ pressed }) => [
            styles.langOption,
            lang === l && styles.langOptionActive,
            pressed && { opacity: 0.7 },
          ]}>
          <Text style={[styles.langText, lang === l && styles.langTextActive]}>
            {l.toUpperCase()}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function NavBar({ onScrollTo }: { onScrollTo: (section: string) => void }) {
  const { width } = useWindowDimensions();
  const { t } = useT();
  const showLinks = width > 600;
  return (
    <View style={styles.nav}>
      <View style={styles.navInner}>
        <View style={styles.navBrand}>
          <Image source={require('@/assets/images/koala-mascot.png')} style={styles.navLogo} />
          <Text style={styles.navName}>QWALLA</Text>
        </View>
        <View style={styles.navLinks}>
          {showLinks && (
            <>
              <Pressable onPress={() => onScrollTo('features')}>
                <Text style={styles.navLink}>{t('nav_features')}</Text>
              </Pressable>
              <Pressable onPress={() => onScrollTo('security')}>
                <Text style={styles.navLink}>{t('nav_security')}</Text>
              </Pressable>
              <Pressable onPress={() => onScrollTo('download')}>
                <Text style={styles.navLink}>{t('nav_download')}</Text>
              </Pressable>
              <Pressable onPress={() => Linking.openURL('https://docs.rougechain.io')}>
                <Text style={styles.navLink}>{t('nav_docs')}</Text>
              </Pressable>
            </>
          )}
          <LangToggle />
          <Pressable onPress={() => router.push('/(auth)/welcome')}>
            <Text style={styles.navCta}>{t('nav_launch')}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function HeroSection({ scrollY }: { scrollY?: Animated.Value }) {
  const { width } = useWindowDimensions();
  const { t } = useT();
  const isWide = width > 768;
  return (
    <View style={[styles.hero, isWide && styles.heroWide]}>
      <LinearGradient
        colors={['rgba(31,224,197,0.06)', 'transparent']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      />
      <View style={[styles.heroContent, isWide && styles.heroContentWide]}>
        <View style={styles.heroKicker}>
          <View style={styles.statusPill}>
            <View style={styles.statusDot} />
            <Text style={styles.statusPillText}>{t('hero_badge')}</Text>
          </View>
          <View style={styles.kickerSep} />
          <Text style={styles.kickerLabel}>{t('hero_kicker')}</Text>
        </View>
        <Text style={[styles.heroTitle, isWide && styles.heroTitleWide, { marginBottom: 0 }]}>
          {t('hero_title')}
        </Text>
        <GradientText style={[styles.heroTitle, isWide && styles.heroTitleWide]}>
          {t('hero_title2')}
        </GradientText>
        <Text style={styles.heroSub}>{t('hero_sub')}</Text>
        <View style={styles.heroCtas}>
          <Pressable
            style={({ pressed }) => [styles.ctaPrimary, pressed && { opacity: 0.85 }]}
            onPress={() => router.push('/(auth)/welcome')}>
            <Text style={styles.ctaPrimaryText}>{t('hero_cta_start')}</Text>
            <Ionicons name="arrow-forward" size={16} color={colors.bg} />
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.ctaSecondary, pressed && { opacity: 0.85 }]}
            onPress={() => router.push('/(auth)/import-wallet')}>
            <Text style={styles.ctaSecondaryText}>{t('hero_cta_import')}</Text>
          </Pressable>
        </View>
      </View>
      <View style={[styles.heroVisual, isWide && styles.heroVisualWide]}>
        <HeroLattice scrollY={scrollY} />
      </View>
    </View>
  );
}

// Proof bar: mono LABEL / big VALUE / sublabel, in bordered cells.
const STATS: { labelKey: string; value: string; sub: string }[] = [
  { labelKey: 'stat_signatures', value: 'ML-DSA-65', sub: 'FIPS 204' },
  { labelKey: 'stat_kex', value: 'ML-KEM-768', sub: 'FIPS 203' },
  { labelKey: 'stat_recovery', value: 'BIP-39', sub: '24-word phrase' },
  { labelKey: 'stat_opensource', value: 'MIT', sub: 'Open source' },
];

function StatsBar() {
  const { width } = useWindowDimensions();
  const { t } = useT();
  const isWide = width > 768;
  return (
    <View style={styles.proofBand}>
      <View style={styles.proofGrid}>
        {STATS.map((s, i) => (
          <View
            key={i}
            style={[
              styles.proofCell,
              isWide && i < STATS.length - 1 && styles.proofCellBorder,
              !isWide && styles.proofCellMobile,
            ]}>
            <Text style={styles.proofLabel}>{t(s.labelKey)}</Text>
            <Text style={styles.proofValue}>{s.value}</Text>
            <Text style={styles.proofSub}>{s.sub}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// Cropped app screenshots (caption removed) + per-slide copy for the 2-col
// layout. Titles/blurbs mirror the original App Store captions.
const SHOTS = [
  { n: '01', tab: 'Wallet', title: 'Your quantum-safe wallet', blurb: 'XRGE, secured with ML-DSA-65 signatures.' },
  { n: '02', tab: 'Security', title: 'Keys never leave your device', blurb: 'ML-KEM-768 + AES-256-GCM, Face ID unlock.' },
  { n: '03', tab: 'Send', title: 'Send in seconds', blurb: 'Every transfer signed post-quantum.' },
  { n: '04', tab: 'Messages', title: 'Messages that self-destruct', blurb: 'End-to-end encrypted with ML-KEM-768.' },
  { n: '05', tab: 'Mail', title: 'Encrypted on-chain mail', blurb: 'Private mail, sealed with ML-KEM.' },
  { n: '06', tab: 'Browser', title: 'dApps, built in', blurb: 'Connect to RougeChain apps from your wallet.' },
  { n: '07', tab: 'Self-custody', title: 'True self-custody', blurb: 'Biometric lock and your recovery phrase.' },
  { n: '08', tab: 'Chats', title: 'Private messaging', blurb: 'Post-quantum encrypted chats, built in.' },
  { n: '09', tab: 'Inbox', title: 'Your encrypted inbox', blurb: 'On-chain mail only you can read.' },
  { n: '10', tab: 'Network', title: 'Own your network', blurb: 'Switch between Mainnet and Testnet.' },
];
const SHOT_GAP = 18;

/**
 * Product carousel, rougechain.io-style: named tabs + arrows + counter above a
 * horizontal scroll-snap track of large bordered glow slide cards (with a peek
 * of the next), each centering one framed screenshot.
 */
function ScreenshotCarousel() {
  const { t } = useT();
  const { width } = useWindowDimensions();
  const isWide = width > 768;
  const scrollRef = useRef<ScrollView>(null);
  const tabsRef = useRef<ScrollView>(null);
  const [idx, setIdx] = useState(0);
  const [cardW, setCardW] = useState(0);

  const step = cardW + SHOT_GAP;
  const goTo = (i: number) => {
    const next = Math.max(0, Math.min(i, SHOTS.length - 1));
    if (step > 0) scrollRef.current?.scrollTo({ x: next * step, animated: true });
    setIdx(next);
  };

  return (
    <View style={styles.section}>
      <View style={[styles.sectionHead, isWide && styles.sectionHeadWide]}>
        <View style={styles.sectionHeadMain}>
          <Eyebrow num="01">{t('shots_label')}</Eyebrow>
          <Text style={styles.sectionTitle}>{t('shots_title')}</Text>
        </View>
        <View style={styles.shotArrows}>
          <Text style={styles.shotCounter}>
            {String(idx + 1).padStart(2, '0')} / {String(SHOTS.length).padStart(2, '0')}
          </Text>
          <Pressable onPress={() => goTo(idx - 1)} style={styles.shotArrowBtn}>
            <Ionicons name="arrow-back" size={18} color={colors.text} />
          </Pressable>
          <Pressable onPress={() => goTo(idx + 1)} style={styles.shotArrowBtn}>
            <Ionicons name="arrow-forward" size={18} color={colors.text} />
          </Pressable>
        </View>
      </View>

      {/* Tabs */}
      <ScrollView
        ref={tabsRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.shotTabs}>
        {SHOTS.map((s, i) => {
          const on = i === idx;
          return (
            <Pressable key={s.n} onPress={() => goTo(i)} style={[styles.shotTab, on && styles.shotTabOn]}>
              <Text style={[styles.shotTabNum, on && styles.shotTabNumOn]}>{s.n}</Text>
              <Text style={[styles.shotTabLabel, on && styles.shotTabLabelOn]}>{s.tab}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Track */}
      <View
        style={{ marginTop: spacing.lg }}
        onLayout={(e) => {
          // Card is the full width on mobile; leaves a peek of the next on wide.
          const w = e.nativeEvent.layout.width;
          setCardW(Math.round(w - (w > 768 ? 72 : 0)));
        }}>
        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          decelerationRate="fast"
          snapToOffsets={step > 0 ? SHOTS.map((_, i) => i * step) : undefined}
          snapToAlignment="start"
          disableIntervalMomentum
          scrollEventThrottle={16}
          onScroll={(e) => {
            // Keep the active tab/counter in sync as you free-scroll.
            if (step > 0) setIdx(Math.max(0, Math.min(SHOTS.length - 1, Math.round(e.nativeEvent.contentOffset.x / step))));
          }}
          onMomentumScrollEnd={(e) => {
            if (step > 0) setIdx(Math.round(e.nativeEvent.contentOffset.x / step));
          }}
          // Web: CSS scroll-snap is what actually locks slides into place
          // (RN's snapToInterval isn't applied by react-native-web).
          style={Platform.OS === 'web' ? ({ scrollSnapType: 'x mandatory' } as any) : undefined}
          contentContainerStyle={{ gap: SHOT_GAP }}>
          {SHOTS.map((s) => (
            <View
              key={s.n}
              style={[
                styles.shotSlide,
                isWide && styles.shotSlideWide,
                { width: cardW || '100%' },
                Platform.OS === 'web' ? ({ scrollSnapAlign: 'start' } as any) : null,
              ]}>
              <LinearGradient
                colors={['rgba(31,224,197,0.10)', 'rgba(108,92,231,0.08)', 'transparent']}
                style={StyleSheet.absoluteFill}
                start={{ x: 0.2, y: 0 }}
                end={{ x: 0.9, y: 1 }}
              />
              {isWide && (
                <View style={styles.shotCopy}>
                  <Text style={styles.shotSlideEyebrow}>
                    {s.n} / {s.tab}
                  </Text>
                  <Text style={styles.shotSlideTitle}>{s.title}</Text>
                  <Text style={styles.shotSlideBlurb}>{s.blurb}</Text>
                  <Pressable
                    style={({ pressed }) => [styles.shotCta, pressed && { opacity: 0.85 }]}
                    onPress={() => router.push('/(auth)/welcome')}>
                    <Text style={styles.shotCtaText}>Get Qwalla</Text>
                    <Ionicons name="arrow-forward" size={15} color={ACCENT} />
                  </Pressable>
                </View>
              )}
              <View style={styles.shotPhoneWrap}>
                <Image source={{ uri: `/screens/${s.n}.png` }} style={styles.shotSlideImg} resizeMode="contain" />
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

// The qday trailer, restored as its own bordered section band (web only).
function VideoSection() {
  const { t } = useT();
  if (Platform.OS !== 'web') return null;
  return (
    <View style={styles.videoBand}>
      <View style={styles.videoInner}>
        <Eyebrow num="02">{t('video_label')}</Eyebrow>
        <Text style={styles.sectionTitle}>{t('video_title')}</Text>
        <View style={styles.videoFrame}>
          {createElement('video', {
            src: '/qday-trailer.mp4',
            autoPlay: true,
            muted: true,
            loop: true,
            playsInline: true,
            controls: true,
            style: {
              width: '100%',
              height: 'auto',
              borderRadius: 14,
              border: `1px solid ${colors.border}`,
              background: '#000',
              display: 'block',
            },
          } as any)}
        </View>
      </View>
    </View>
  );
}

function BetaButton({
  url,
  icon,
  sub,
  label,
}: {
  url: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  sub: string;
  label: string;
}) {
  const { t } = useT();
  const enabled = url.length > 0;
  return (
    <Pressable
      disabled={!enabled}
      onPress={() => Linking.openURL(url)}
      style={({ pressed }) => [
        styles.betaCard,
        !enabled && styles.betaCardDisabled,
        pressed && enabled && { opacity: 0.85 },
      ]}>
      <Ionicons name={icon} size={30} color={enabled ? colors.bg : colors.textSecondary} />
      <View>
        <Text style={[styles.betaSub, !enabled && styles.betaTextDim]}>
          {enabled ? sub : t('dl_coming')}
        </Text>
        <Text style={[styles.betaLabel, !enabled && styles.betaTextDim]}>{label}</Text>
      </View>
    </Pressable>
  );
}

function BetaSection() {
  const { width } = useWindowDimensions();
  const { t } = useT();
  const isWide = width > 768;
  return (
    <View style={styles.betaSection}>
      <LinearGradient
        colors={['rgba(31,224,197,0.10)', 'rgba(108,92,231,0.06)', 'transparent']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />
      <View style={styles.betaInner}>
        <Text style={styles.betaBadge}>{t('beta_badge')}</Text>
        <Text style={styles.betaTitle}>{t('beta_title')}</Text>
        <Text style={styles.betaBlurb}>{t('beta_blurb')}</Text>
        <View style={[styles.betaGrid, isWide && styles.betaGridWide]}>
          <BetaButton url={IOS_APPSTORE_URL} icon="logo-apple" sub={t('beta_dl_on')} label={t('label_ios')} />
          <BetaButton
            url={ANDROID_PLAY_URL}
            icon="logo-android"
            sub={t('beta_dl_the')}
            label={t('label_android')}
          />
          <BetaButton
            url={DESKTOP_WIN_URL}
            icon="logo-windows"
            sub={t('beta_dl_for')}
            label={t('label_windows')}
          />
        </View>
      </View>
    </View>
  );
}

const FEATURES = [
  { icon: 'wallet-outline' as const, key: 'feat_wallet', color: ACCENT },
  { icon: 'chatbubbles-outline' as const, key: 'feat_msg', color: PURPLE },
  { icon: 'mail-outline' as const, key: 'feat_mail', color: '#FDCB6E' },
  { icon: 'compass-outline' as const, key: 'feat_dapp', color: '#60A5FA' },
];

function FeaturesSection() {
  const { width } = useWindowDimensions();
  const { t } = useT();
  const isWide = width > 900;
  return (
    <View style={styles.section}>
      <View style={[styles.sectionHead, isWide && styles.sectionHeadWide]}>
        <View style={styles.sectionHeadMain}>
          <Eyebrow num="03">{t('feat_label')}</Eyebrow>
          <Text style={styles.sectionTitle}>{t('feat_title')}</Text>
        </View>
      </View>
      <View style={[styles.featureGrid, isWide && styles.featureGridWide]}>
        {FEATURES.map((f, i) => (
          <View key={i} style={[styles.featureCard, isWide && styles.featureCardWide]}>
            <View style={styles.featureIcon}>
              <Ionicons name={f.icon} size={26} color={f.color} />
            </View>
            <Text style={styles.featureTitle}>{t(`${f.key}_title`)}</Text>
            <Text style={styles.featureDesc}>{t(`${f.key}_desc`)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const SECURITY_POINTS = [
  { icon: 'lock-closed' as const, key: 'sec_nist' },
  { icon: 'key' as const, key: 'sec_noncustodial' },
  { icon: 'shield-checkmark' as const, key: 'sec_e2e' },
  { icon: 'globe' as const, key: 'sec_decentralized' },
];

function SecuritySection() {
  const { width } = useWindowDimensions();
  const { t } = useT();
  const isWide = width > 768;
  return (
    <View style={styles.section}>
      <View style={[styles.sectionHead, isWide && styles.sectionHeadWide]}>
        <View style={styles.sectionHeadMain}>
          <Eyebrow num="04">{t('sec_label')}</Eyebrow>
          <Text style={styles.sectionTitle}>{t('sec_title')}</Text>
        </View>
        <Text style={[styles.sectionSub, isWide && styles.sectionSubSide]}>{t('sec_sub')}</Text>
      </View>
      <View style={[styles.secGrid, isWide && styles.secGridWide]}>
        {SECURITY_POINTS.map((s, i) => (
          <View key={i} style={[styles.secItem, isWide && styles.secItemWide]}>
            <View style={styles.secIcon}>
              <Ionicons name={s.icon} size={18} color={ACCENT} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.secTitle}>{t(`${s.key}_title`)}</Text>
              <Text style={styles.secDesc}>{t(`${s.key}_desc`)}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function FooterCta() {
  const { t } = useT();
  return (
    <View style={styles.footerCta}>
      <LinearGradient
        colors={['rgba(31,224,197,0.08)', 'rgba(108,92,231,0.06)', 'transparent']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />
      <Text style={styles.footerTitle}>{t('footercta_title')}</Text>
      <Text style={styles.footerSub}>{t('footercta_sub')}</Text>
      <Pressable
        style={({ pressed }) => [styles.ctaPrimary, { alignSelf: 'center' }, pressed && { opacity: 0.85 }]}
        onPress={() => router.push('/(auth)/welcome')}>
        <Text style={styles.ctaPrimaryText}>{t('footercta_cta')}</Text>
        <Ionicons name="arrow-forward" size={16} color={colors.bg} />
      </Pressable>
    </View>
  );
}

function DownloadSection() {
  const { width } = useWindowDimensions();
  const { t } = useT();
  const isWide = width > 768;
  return (
    <View style={styles.downloadSection}>
      <LinearGradient
        colors={['rgba(108,92,231,0.06)', 'rgba(31,224,197,0.04)', 'transparent']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />
      <Eyebrow num="05">{t('dl_label')}</Eyebrow>
      <Text style={styles.sectionTitle}>{t('dl_title')}</Text>
      <Text style={styles.sectionSub}>{t('dl_sub')}</Text>
      <View style={[styles.downloadGrid, isWide && styles.downloadGridWide]}>
        <Pressable
          disabled={!IOS_APPSTORE_URL}
          style={({ pressed }) => [
            styles.downloadCard,
            !IOS_APPSTORE_URL && styles.downloadCardDisabled,
            pressed && IOS_APPSTORE_URL && { opacity: 0.85 },
          ]}
          onPress={() => Linking.openURL(IOS_APPSTORE_URL)}>
          <Ionicons name="logo-apple" size={32} color={colors.text} />
          <View>
            <Text style={styles.downloadSub}>{IOS_APPSTORE_URL ? t('dl_ios_sub') : t('dl_coming')}</Text>
            <Text style={styles.downloadLabel}>{t('label_ios')}</Text>
          </View>
        </Pressable>
        <Pressable
          disabled={!ANDROID_PLAY_URL}
          style={({ pressed }) => [
            styles.downloadCard,
            !ANDROID_PLAY_URL && styles.downloadCardDisabled,
            pressed && ANDROID_PLAY_URL && { opacity: 0.85 },
          ]}
          onPress={() => Linking.openURL(ANDROID_PLAY_URL)}>
          <Ionicons name="logo-google-playstore" size={28} color={colors.text} />
          <View>
            <Text style={styles.downloadSub}>{ANDROID_PLAY_URL ? t('dl_android_sub') : t('dl_coming')}</Text>
            <Text style={styles.downloadLabel}>{t('label_android')}</Text>
          </View>
        </Pressable>
        <Pressable
          disabled={!DESKTOP_WIN_URL}
          style={({ pressed }) => [
            styles.downloadCard,
            !DESKTOP_WIN_URL && styles.downloadCardDisabled,
            pressed && DESKTOP_WIN_URL && { opacity: 0.85 },
          ]}
          onPress={() => Linking.openURL(DESKTOP_WIN_URL)}>
          <Ionicons name="desktop-outline" size={28} color={colors.text} />
          <View>
            <Text style={styles.downloadSub}>
              {DESKTOP_WIN_URL ? t('dl_desktop_sub') : t('dl_coming')}
            </Text>
            <Text style={styles.downloadLabel}>{t('label_windows_desktop')}</Text>
          </View>
        </Pressable>
        <Pressable
          disabled={!BROWSER_WIN_URL}
          style={({ pressed }) => [
            styles.downloadCard,
            !BROWSER_WIN_URL && styles.downloadCardDisabled,
            pressed && BROWSER_WIN_URL && { opacity: 0.85 },
          ]}
          onPress={() => Linking.openURL(BROWSER_WIN_URL)}>
          <Ionicons name="compass-outline" size={28} color={colors.accent} />
          <View>
            <Text style={styles.downloadSub}>
              {BROWSER_WIN_URL ? t('dl_browser_sub') : t('dl_coming')}
            </Text>
            <Text style={styles.downloadLabel}>{t('label_browser')}</Text>
          </View>
        </Pressable>
        <Pressable
          disabled={!DESKTOP_MAC_URL}
          style={({ pressed }) => [
            styles.downloadCard,
            !DESKTOP_MAC_URL && styles.downloadCardDisabled,
            pressed && DESKTOP_MAC_URL && { opacity: 0.85 },
          ]}
          onPress={() => Linking.openURL(DESKTOP_MAC_URL)}>
          <Ionicons name="logo-apple" size={30} color={colors.text} />
          <View>
            <Text style={styles.downloadSub}>
              {DESKTOP_MAC_URL ? t('dl_mac_desktop_sub') : t('dl_coming')}
            </Text>
            <Text style={styles.downloadLabel}>{t('label_mac_desktop')}</Text>
          </View>
        </Pressable>
        <Pressable
          disabled={!BROWSER_MAC_URL}
          style={({ pressed }) => [
            styles.downloadCard,
            !BROWSER_MAC_URL && styles.downloadCardDisabled,
            pressed && BROWSER_MAC_URL && { opacity: 0.85 },
          ]}
          onPress={() => Linking.openURL(BROWSER_MAC_URL)}>
          <Ionicons name="compass-outline" size={28} color={colors.accent} />
          <View>
            <Text style={styles.downloadSub}>
              {BROWSER_MAC_URL ? t('dl_mac_browser_sub') : t('dl_coming')}
            </Text>
            <Text style={styles.downloadLabel}>{t('label_mac_browser')}</Text>
          </View>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.downloadCard, pressed && { opacity: 0.85 }]}
          onPress={() => Linking.openURL('https://github.com/cyberdreadx/Qwalla/releases')}>
          <Ionicons name="download-outline" size={28} color={colors.text} />
          <View>
            <Text style={styles.downloadSub}>{t('dl_direct_sub')}</Text>
            <Text style={styles.downloadLabel}>{t('dl_direct_label')}</Text>
          </View>
        </Pressable>
      </View>
      <Pressable
        onPress={() => Linking.openURL('https://auroraoss.com/')}
        style={({ pressed }) => [styles.downloadNote, pressed && { opacity: 0.7 }]}>
        <Ionicons name="information-circle-outline" size={15} color={colors.textSecondary} />
        <Text style={styles.downloadNoteText}>{t('dl_graphene_note')}</Text>
      </Pressable>
    </View>
  );
}

// Twitter/X and Discord /rougechain were dead (404); GitHub moved to the live
// account. Re-add Twitter/Discord here once real accounts exist.
const SOCIAL_LINKS = [
  { icon: 'logo-github' as const, label: 'GitHub', url: 'https://github.com/cyberdreadx' },
];

function Footer() {
  const { t } = useT();
  return (
    <View style={styles.footer}>
      <View style={styles.footerInner}>
        <View style={styles.footerBrand}>
          <Image source={require('@/assets/images/koala-mascot.png')} style={styles.footerLogo} />
          <Text style={styles.footerName}>QWALLA</Text>
        </View>
        <View style={styles.footerSocials}>
          {SOCIAL_LINKS.map((link) => (
            <Pressable
              key={link.label}
              onPress={() => Linking.openURL(link.url)}
              style={({ pressed }) => [styles.socialBtn, pressed && { opacity: 0.7 }]}>
              <Ionicons name={link.icon} size={18} color={colors.textSecondary} />
            </Pressable>
          ))}
        </View>
        <View style={styles.footerLegal}>
          <Pressable onPress={() => router.push('/privacy')}
            style={({ pressed }) => [pressed && { opacity: 0.7 }]}>
            <Text style={styles.footerLegalLink}>{t('footer_privacy')}</Text>
          </Pressable>
          <Text style={styles.footerCopy}>·</Text>
          <Pressable onPress={() => router.push('/terms')}
            style={({ pressed }) => [pressed && { opacity: 0.7 }]}>
            <Text style={styles.footerLegalLink}>{t('footer_terms')}</Text>
          </Pressable>
          <Text style={styles.footerCopy}>{t('footer_built')}</Text>
        </View>
      </View>
    </View>
  );
}

export default function LandingPage() {
  useLandingFonts();
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(new Animated.Value(0)).current;
  const sectionPositions = useRef<Record<string, number>>({});

  const handleScrollTo = (section: string) => {
    const y = sectionPositions.current[section];
    if (y !== undefined && scrollRef.current) {
      scrollRef.current.scrollTo({ y, animated: true });
    }
  };

  return (
    <LandingI18nProvider>
      <ScrollView
        ref={scrollRef}
        style={styles.root}
        contentContainerStyle={styles.rootContent}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: false })}>
        <NavBar onScrollTo={handleScrollTo} />
        <HeroSection scrollY={scrollY} />
        <StatsBar />
        <View style={styles.bandDivider} />
        <ScreenshotCarousel />
        <View style={styles.bandDivider} />
        <VideoSection />
        <BetaSection />
        <View style={styles.bandDivider} />
        <View onLayout={(e) => { sectionPositions.current.features = e.nativeEvent.layout.y; }}>
          <FeaturesSection />
        </View>
        <View style={styles.bandDivider} />
        <View onLayout={(e) => { sectionPositions.current.security = e.nativeEvent.layout.y; }}>
          <SecuritySection />
        </View>
        <View style={styles.bandDivider} />
        <View onLayout={(e) => { sectionPositions.current.download = e.nativeEvent.layout.y; }}>
          <DownloadSection />
        </View>
        <FooterCta />
        <Footer />
      </ScrollView>
    </LandingI18nProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  rootContent: { minHeight: '100%' },

  /* Nav */
  nav: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  navInner: {
    maxWidth: 1100,
    alignSelf: 'center',
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  navBrand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  navLogo: { width: 28, height: 28, borderRadius: 14 },
  navName: { color: colors.text, fontFamily: DISPLAY_FONT, fontSize: 18, fontWeight: '700', letterSpacing: 0.5 },
  navLinks: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  navLink: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  navCta: {
    color: colors.bg,
    fontWeight: '700',
    fontSize: 13,
    backgroundColor: ACCENT,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  langToggle: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  langOption: { paddingHorizontal: 10, paddingVertical: 5 },
  langOptionActive: { backgroundColor: colors.surface },
  langText: { color: colors.textTertiary, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  langTextActive: { color: colors.text },

  /* Hero */
  hero: {
    paddingHorizontal: spacing.lg,
    paddingTop: 64,
    paddingBottom: 48,
    maxWidth: 1100,
    alignSelf: 'center',
    width: '100%',
  },
  heroWide: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 80,
    paddingBottom: 80,
  },
  heroContent: { flex: 1 },
  heroContentWide: { flex: 3, paddingRight: 48 },
  badge: {
    color: ACCENT,
    fontFamily: MONO_FONT,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: spacing.md,
  },
  heroTitle: {
    color: colors.text,
    fontFamily: DISPLAY_FONT,
    fontSize: 44,
    fontWeight: '600',
    lineHeight: 48,
    letterSpacing: -2,
    marginBottom: spacing.md,
  },
  heroTitleWide: { fontSize: 72, lineHeight: 74, letterSpacing: -3.5 },
  heroKicker: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 28 },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.full,
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: ACCENT },
  statusPillText: {
    color: colors.text,
    fontFamily: MONO_FONT,
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  kickerSep: { width: 1, height: 12, backgroundColor: colors.border },
  kickerLabel: {
    color: colors.textTertiary,
    fontFamily: MONO_FONT,
    fontSize: 10,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 1.3,
  },
  /* Hero lattice art */
  latticeWrap: { width: '100%', aspectRatio: 1, maxWidth: 480, alignItems: 'center', justifyContent: 'center' },
  latticeSvg: { position: 'absolute', width: '112%', height: '112%' },
  latticeMark: { width: 120, height: 120, borderRadius: 60, zIndex: 1 },
  latticeCoord: {
    position: 'absolute',
    top: 6,
    right: 6,
    color: colors.textTertiary,
    fontFamily: MONO_FONT,
    fontSize: 9,
    letterSpacing: 1,
  },
  heroSub: {
    color: colors.textSecondary,
    fontSize: 16,
    lineHeight: 26,
    marginBottom: spacing.xl,
    maxWidth: 520,
  },
  heroCtas: { flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap' },
  ctaPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: ACCENT,
    paddingHorizontal: 22,
    paddingVertical: 13,
    borderRadius: 8,
  },
  ctaPrimaryText: { color: colors.bg, fontWeight: '700', fontSize: 15 },
  ctaSecondary: {
    paddingHorizontal: 22,
    paddingVertical: 13,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  ctaSecondaryText: { color: colors.text, fontWeight: '600', fontSize: 15 },
  heroVisual: { width: '100%', alignItems: 'center', justifyContent: 'center', marginTop: spacing.xl },
  heroVisualWide: { flex: 2, marginTop: 0 },
  heroCard: {
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroMascot: { width: 140, height: 140, borderRadius: 70 },
  heroCardGlow: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: 'rgba(31,224,197,0.04)',
  },

  /* Proof bar */
  proofBand: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: 'rgba(255,255,255,0.015)',
  },
  proofGrid: {
    maxWidth: 1200,
    alignSelf: 'center',
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  proofCell: {
    flexGrow: 1,
    flexBasis: '25%',
    paddingVertical: 28,
    paddingHorizontal: 24,
  },
  proofCellBorder: { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border },
  proofCellMobile: {
    flexBasis: '50%',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  proofLabel: {
    color: colors.textTertiary,
    fontFamily: MONO_FONT,
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1.3,
    marginBottom: 10,
  },
  proofValue: { color: colors.text, fontSize: 22, fontWeight: '600', fontFamily: DISPLAY_FONT, letterSpacing: -0.5 },
  proofSub: { color: colors.textSecondary, fontSize: 12, marginTop: 6 },

  /* Beta */
  betaSection: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: 48,
    overflow: 'hidden',
  },
  betaInner: {
    maxWidth: 1100,
    alignSelf: 'center',
    width: '100%',
    alignItems: 'center',
  },
  betaBadge: {
    color: ACCENT,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: spacing.sm,
  },
  betaTitle: {
    color: colors.text,
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.6,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  betaBlurb: {
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 24,
    textAlign: 'center',
    maxWidth: 520,
    marginBottom: spacing.xl,
  },
  betaGrid: { gap: spacing.md, width: '100%', maxWidth: 860, alignSelf: 'center' },
  betaGridWide: { flexDirection: 'row', justifyContent: 'center' },
  betaCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    backgroundColor: ACCENT,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  betaCardDisabled: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  betaSub: { color: colors.bg, fontSize: 11, fontWeight: '600' },
  betaLabel: { color: colors.bg, fontSize: 16, fontWeight: '800' },
  betaTextDim: { color: colors.textSecondary },

  /* Features */
  section: {
    maxWidth: 1200,
    alignSelf: 'center',
    width: '100%',
    paddingHorizontal: spacing.lg,
    paddingVertical: 88,
  },
  sectionLabel: {
    color: ACCENT,
    fontFamily: MONO_FONT,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginBottom: spacing.sm,
  },
  // Numbered mono eyebrow with a leading accent dash ("01 / Label").
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: spacing.sm },
  eyebrowDash: { width: 22, height: 2, backgroundColor: ACCENT },
  eyebrowText: {
    color: colors.textSecondary,
    fontFamily: MONO_FONT,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  // Section heading: big title left, constrained description right (wide only).
  sectionHead: { marginBottom: 56 },
  sectionHeadWide: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  sectionHeadMain: { flexShrink: 1 },
  sectionSubSide: { maxWidth: 410, marginBottom: 0, textAlign: 'right' as const },
  // Full-bleed hairline divider between sections (the "stacked bands" look).
  bandDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, width: '100%' },
  /* Product screenshot carousel */
  shotArrows: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  shotCounter: { color: colors.textTertiary, fontFamily: MONO_FONT, fontSize: 12, letterSpacing: 1 },
  shotArrowBtn: {
    width: 38,
    height: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shotTabs: { gap: 6, paddingVertical: 4, marginTop: spacing.md },
  shotTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  shotTabOn: { borderBottomColor: ACCENT },
  shotTabNum: { color: colors.textTertiary, fontFamily: MONO_FONT, fontSize: 11 },
  shotTabNumOn: { color: ACCENT },
  shotTabLabel: { color: colors.textTertiary, fontSize: 13, fontWeight: '600' },
  shotTabLabelOn: { color: colors.text },
  shotSlide: {
    minHeight: 560,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(255,255,255,0.015)',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
  },
  shotSlideWide: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 48, gap: 40 },
  shotCopy: { flex: 1, maxWidth: 420 },
  shotSlideEyebrow: {
    color: colors.textSecondary,
    fontFamily: MONO_FONT,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: spacing.md,
  },
  shotSlideTitle: {
    color: colors.text,
    fontFamily: DISPLAY_FONT,
    fontSize: 34,
    fontWeight: '600',
    letterSpacing: -1.2,
    lineHeight: 38,
    marginBottom: spacing.sm,
  },
  shotSlideBlurb: { color: colors.textSecondary, fontSize: 16, lineHeight: 26, marginBottom: spacing.lg },
  shotCta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  shotCtaText: { color: ACCENT, fontSize: 15, fontWeight: '700' },
  shotPhoneWrap: { alignItems: 'center', justifyContent: 'center' },
  shotSlideImg: { width: 250, height: 500 },
  /* Video band */
  videoBand: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, width: '100%' },
  videoInner: {
    maxWidth: 1000,
    alignSelf: 'center',
    width: '100%',
    paddingHorizontal: spacing.lg,
    paddingVertical: 88,
  },
  videoFrame: {
    marginTop: spacing.lg,
    borderRadius: 16,
    overflow: 'hidden',
  },
  sectionTitle: {
    color: colors.text,
    fontFamily: DISPLAY_FONT,
    fontSize: 38,
    fontWeight: '600',
    letterSpacing: -1.4,
    lineHeight: 42,
    marginBottom: spacing.sm,
  },
  sectionSub: {
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 24,
    marginBottom: spacing.xl,
    maxWidth: 600,
  },
  featureGrid: { gap: 40 },
  featureGridWide: { flexDirection: 'row', gap: 48 },
  // "Ruled column" cards: a top hairline + generous padding, no box/fill —
  // the dominant rougechain.io card pattern.
  featureCard: {
    flex: 1,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.lg,
  },
  featureCardWide: {},
  featureIcon: {
    width: 40,
    height: 40,
    alignItems: 'flex-start',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  featureTitle: {
    color: colors.text,
    fontFamily: DISPLAY_FONT,
    fontSize: 20,
    fontWeight: '600',
    letterSpacing: -0.4,
    marginBottom: 8,
  },
  featureDesc: { color: colors.textSecondary, fontSize: 14, lineHeight: 23 },

  /* Security */
  // Crypto-list: full-width hairline rows (name + desc), reference pattern.
  secGrid: { gap: 0 },
  secGridWide: { gap: 0 },
  secItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 24,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  secItemWide: { width: '100%', borderBottomWidth: StyleSheet.hairlineWidth },
  secIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: ACCENT_DIM,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secTitle: { color: colors.text, fontSize: 17, fontWeight: '600', fontFamily: DISPLAY_FONT, letterSpacing: -0.3, marginBottom: 4 },
  secDesc: { color: colors.textSecondary, fontSize: 13, lineHeight: 20 },

  /* Footer CTA */
  footerCta: {
    alignItems: 'center',
    paddingVertical: 64,
    paddingHorizontal: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  footerTitle: {
    color: colors.text,
    fontFamily: DISPLAY_FONT,
    fontSize: 44,
    fontWeight: '600',
    letterSpacing: -1.8,
    lineHeight: 48,
    textAlign: 'center',
    marginBottom: spacing.md,
    maxWidth: 680,
  },
  footerSub: {
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 24,
    textAlign: 'center',
    marginBottom: spacing.xl,
    maxWidth: 460,
  },

  /* Download */
  downloadSection: {
    maxWidth: 1200,
    alignSelf: 'center',
    width: '100%',
    paddingHorizontal: spacing.lg,
    paddingVertical: 88,
  },
  downloadGrid: {
    gap: spacing.md,
  },
  downloadGridWide: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  downloadCard: {
    // Grow to fill the row but keep a minimum width so labels never truncate;
    // cards wrap onto multiple rows instead of cramming into one.
    flexGrow: 1,
    flexBasis: 224,
    minWidth: 210,
    maxWidth: 360,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  downloadCardDisabled: {
    opacity: 0.5,
  },
  downloadSub: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '500',
  },
  downloadLabel: {
    color: colors.text,
    fontFamily: DISPLAY_FONT,
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  downloadNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  downloadNoteText: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    maxWidth: 620,
  },

  /* Footer */
  footer: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  footerInner: {
    maxWidth: 1100,
    alignSelf: 'center',
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  footerBrand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  footerLogo: { width: 20, height: 20, borderRadius: 10 },
  footerName: { color: colors.text, fontSize: 14, fontWeight: '700' },
  footerSocials: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  socialBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerCopy: { color: colors.textTertiary, fontSize: 12 },
  footerLegal: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  footerLegalLink: { color: colors.textSecondary, fontSize: 12, textDecorationLine: 'underline' },
});
