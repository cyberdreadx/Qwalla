import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';

const ACCENT = colors.accent;
const ACCENT_DIM = colors.accentDim;
const PURPLE = colors.purple;

function NavBar() {
  return (
    <View style={styles.nav}>
      <View style={styles.navInner}>
        <View style={styles.navBrand}>
          <Image source={require('@/assets/images/koala-mascot.png')} style={styles.navLogo} />
          <Text style={styles.navName}>QWALLA</Text>
        </View>
        <View style={styles.navLinks}>
          <Pressable onPress={() => router.push('/(auth)/welcome')}>
            <Text style={styles.navCta}>Launch App</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function HeroSection() {
  const { width } = useWindowDimensions();
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
        <Text style={styles.badge}>Post-Quantum Encrypted</Text>
        <Text style={[styles.heroTitle, isWide && styles.heroTitleWide]}>
          The quantum-safe wallet for RougeChain.
        </Text>
        <Text style={styles.heroSub}>
          Send, chat, and mail — all end-to-end encrypted with NIST post-quantum cryptography.
          Your keys, your data, zero trust required.
        </Text>
        <View style={styles.heroCtas}>
          <Pressable
            style={({ pressed }) => [styles.ctaPrimary, pressed && { opacity: 0.85 }]}
            onPress={() => router.push('/(auth)/welcome')}>
            <Text style={styles.ctaPrimaryText}>Get Started</Text>
            <Ionicons name="arrow-forward" size={16} color={colors.bg} />
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.ctaSecondary, pressed && { opacity: 0.85 }]}
            onPress={() => router.push('/(auth)/import-wallet')}>
            <Text style={styles.ctaSecondaryText}>Import Wallet</Text>
          </Pressable>
        </View>
      </View>
      {isWide && (
        <View style={styles.heroVisual}>
          <View style={styles.heroCard}>
            <Image source={require('@/assets/images/koala-mascot.png')} style={styles.heroMascot} />
            <View style={styles.heroCardGlow} />
          </View>
        </View>
      )}
    </View>
  );
}

const STATS = [
  { value: 'ML-DSA-65', label: 'Signatures' },
  { value: 'ML-KEM-768', label: 'Key Exchange' },
  { value: 'BIP-39', label: 'Recovery' },
  { value: 'Free', label: 'Open Source' },
];

function StatsBar() {
  const { width } = useWindowDimensions();
  const isWide = width > 768;
  return (
    <View style={styles.statsOuter}>
      <View style={[styles.statsRow, !isWide && styles.statsRowMobile]}>
        {STATS.map((s, i) => (
          <View key={i} style={[styles.statItem, !isWide && styles.statItemMobile]}>
            <Text style={styles.statValue}>{s.value}</Text>
            <Text style={styles.statLabel}>{s.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const FEATURES = [
  {
    icon: 'wallet-outline' as const,
    title: 'Quantum-Safe Wallet',
    desc: 'Send and receive RougeChain tokens with ML-DSA-65 signatures. Full balance tracking, QR codes, and BIP-39 mnemonic recovery.',
    color: ACCENT,
  },
  {
    icon: 'chatbubbles-outline' as const,
    title: 'Encrypted Messenger',
    desc: 'End-to-end encrypted chat with ML-KEM-768 key exchange and XChaCha20-Poly1305. Group chats, emojis, GIFs, and stickers built in.',
    color: PURPLE,
  },
  {
    icon: 'mail-outline' as const,
    title: 'On-Chain Mail',
    desc: 'Send encrypted mail to any registered address. Decentralized inbox with compose, read, and name registry — no central server.',
    color: '#FDCB6E',
  },
];

function FeaturesSection() {
  const { width } = useWindowDimensions();
  const isWide = width > 900;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>Built Different</Text>
      <Text style={styles.sectionTitle}>One app. Everything encrypted.</Text>
      <View style={[styles.featureGrid, isWide && styles.featureGridWide]}>
        {FEATURES.map((f, i) => (
          <View key={i} style={[styles.featureCard, isWide && styles.featureCardWide]}>
            <View style={[styles.featureIcon, { backgroundColor: `${f.color}15` }]}>
              <Ionicons name={f.icon} size={24} color={f.color} />
            </View>
            <Text style={styles.featureTitle}>{f.title}</Text>
            <Text style={styles.featureDesc}>{f.desc}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const SECURITY_POINTS = [
  {
    icon: 'lock-closed' as const,
    title: 'NIST Post-Quantum Standards',
    desc: 'Qwalla uses ML-DSA-65 for signatures and ML-KEM-768 for key encapsulation — both NIST-approved, quantum-resistant algorithms.',
  },
  {
    icon: 'key' as const,
    title: 'Non-Custodial by Design',
    desc: 'Your keys never leave your device. No servers, no third parties, no backdoors. Export or recover anytime with your 12-word phrase.',
  },
  {
    icon: 'shield-checkmark' as const,
    title: 'End-to-End Encryption',
    desc: 'Every message and mail is encrypted client-side with XChaCha20-Poly1305 before it ever touches the network.',
  },
  {
    icon: 'globe' as const,
    title: 'Decentralized Network',
    desc: 'Built on RougeChain — a post-quantum L1 blockchain with on-chain messaging, mail, and name registry.',
  },
];

function SecuritySection() {
  const { width } = useWindowDimensions();
  const isWide = width > 768;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>Security First</Text>
      <Text style={styles.sectionTitle}>Quantum-resistant from the ground up.</Text>
      <Text style={styles.sectionSub}>
        Today&apos;s encryption will be broken by tomorrow&apos;s quantum computers. Qwalla is
        built with NIST post-quantum cryptography so your assets and conversations stay safe — now
        and in the future.
      </Text>
      <View style={[styles.secGrid, isWide && styles.secGridWide]}>
        {SECURITY_POINTS.map((s, i) => (
          <View key={i} style={[styles.secItem, isWide && styles.secItemWide]}>
            <View style={styles.secIcon}>
              <Ionicons name={s.icon} size={18} color={ACCENT} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.secTitle}>{s.title}</Text>
              <Text style={styles.secDesc}>{s.desc}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function FooterCta() {
  return (
    <View style={styles.footerCta}>
      <LinearGradient
        colors={['rgba(31,224,197,0.08)', 'rgba(108,92,231,0.06)', 'transparent']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />
      <Text style={styles.footerTitle}>Ready to go quantum-safe?</Text>
      <Text style={styles.footerSub}>
        Create a wallet in seconds. No email, no phone number, no KYC. Just you and your keys.
      </Text>
      <Pressable
        style={({ pressed }) => [styles.ctaPrimary, { alignSelf: 'center' }, pressed && { opacity: 0.85 }]}
        onPress={() => router.push('/(auth)/welcome')}>
        <Text style={styles.ctaPrimaryText}>Launch Qwalla</Text>
        <Ionicons name="arrow-forward" size={16} color={colors.bg} />
      </Pressable>
    </View>
  );
}

function Footer() {
  return (
    <View style={styles.footer}>
      <View style={styles.footerInner}>
        <View style={styles.footerBrand}>
          <Image source={require('@/assets/images/koala-mascot.png')} style={styles.footerLogo} />
          <Text style={styles.footerName}>QWALLA</Text>
        </View>
        <Text style={styles.footerCopy}>
          Built on RougeChain · rougechain.io
        </Text>
      </View>
    </View>
  );
}

export default function LandingPage() {
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.rootContent}>
      <NavBar />
      <HeroSection />
      <StatsBar />
      <FeaturesSection />
      <SecuritySection />
      <FooterCta />
      <Footer />
    </ScrollView>
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
  navName: { color: colors.text, fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  navLinks: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
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
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: spacing.md,
  },
  heroTitle: {
    color: colors.text,
    fontSize: 36,
    fontWeight: '800',
    lineHeight: 42,
    letterSpacing: -0.8,
    marginBottom: spacing.md,
  },
  heroTitleWide: { fontSize: 48, lineHeight: 56 },
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
    gap: 6,
    backgroundColor: ACCENT,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: radius.full,
  },
  ctaPrimaryText: { color: colors.bg, fontWeight: '700', fontSize: 15 },
  ctaSecondary: {
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  ctaSecondaryText: { color: colors.text, fontWeight: '600', fontSize: 15 },
  heroVisual: { flex: 2, alignItems: 'center', justifyContent: 'center' },
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

  /* Stats */
  statsOuter: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  statsRow: {
    maxWidth: 1100,
    alignSelf: 'center',
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  statsRowMobile: { flexWrap: 'wrap', justifyContent: 'center', gap: spacing.lg },
  statItem: { alignItems: 'center', minWidth: 120 },
  statItemMobile: { width: '45%', marginBottom: spacing.sm },
  statValue: { color: ACCENT, fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  statLabel: { color: colors.textSecondary, fontSize: 12, marginTop: 4, fontWeight: '500' },

  /* Features */
  section: {
    maxWidth: 1100,
    alignSelf: 'center',
    width: '100%',
    paddingHorizontal: spacing.lg,
    paddingVertical: 56,
  },
  sectionLabel: {
    color: ACCENT,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginBottom: spacing.sm,
  },
  sectionSub: {
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 24,
    marginBottom: spacing.xl,
    maxWidth: 600,
  },
  featureGrid: { gap: spacing.md },
  featureGridWide: { flexDirection: 'row', gap: spacing.lg },
  featureCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  featureCardWide: {},
  featureIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  featureTitle: { color: colors.text, fontSize: 17, fontWeight: '700', marginBottom: 8 },
  featureDesc: { color: colors.textSecondary, fontSize: 14, lineHeight: 22 },

  /* Security */
  secGrid: { gap: spacing.md },
  secGridWide: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
  },
  secItem: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  secItemWide: { width: '47%', borderBottomWidth: 0 },
  secIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: ACCENT_DIM,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secTitle: { color: colors.text, fontSize: 15, fontWeight: '700', marginBottom: 4 },
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
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  footerSub: {
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 24,
    textAlign: 'center',
    marginBottom: spacing.xl,
    maxWidth: 460,
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
  },
  footerBrand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  footerLogo: { width: 20, height: 20, borderRadius: 10 },
  footerName: { color: colors.text, fontSize: 14, fontWeight: '700' },
  footerCopy: { color: colors.textTertiary, fontSize: 12 },
});
