import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '@/constants/theme';

export default function TermsOfService() {
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Pressable onPress={() => router.canGoBack() ? router.back() : router.replace('/')}
          style={({ pressed }) => [styles.back, pressed && { opacity: 0.7 }]}>
          <Ionicons name="arrow-back" size={16} color={colors.accent} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
      </View>

      <Text style={styles.h1}>Terms of Service</Text>
      <Text style={styles.meta}>Qwalla · Last updated: March 30, 2026</Text>

      <Section title="1. Acceptance of Terms">
        By downloading, installing, or using the Qwalla application ("App"), you agree to be bound by these Terms of Service. If you do not agree, do not use the App.
      </Section>

      <Section title="2. What Qwalla Is">
        Qwalla is a self-custodial wallet and encrypted communication application that interacts with the RougeChain public blockchain. The App allows you to:{'\n'}
        • Generate and manage post-quantum cryptographic key pairs{'\n'}
        • Send and receive XRGE, qETH, qUSDC, and other RougeChain-based tokens{'\n'}
        • Send and receive end-to-end encrypted messages and mail{'\n'}
        • Mint, view, and transfer NFTs{'\n'}
        • Connect to decentralized applications (dApps) via the in-app browser{'\n\n'}
        Qwalla is a non-custodial application. We do not hold your funds, control your keys, or have access to your wallet at any time.
      </Section>

      <Section title="3. Self-Custody and Key Responsibility">
        <Bold>You are solely responsible for your private key and seed phrase.{'\n\n'}</Bold>
        • Your seed phrase is the master key to your wallet. Anyone who obtains it can access your funds permanently.{'\n'}
        • Qwalla does not store, transmit, or have any copy of your private key or seed phrase. They exist only on your device.{'\n'}
        • If you lose your seed phrase and lose access to your device, your funds are permanently unrecoverable. We cannot reset, restore, or recover your wallet under any circumstances.{'\n'}
        • You are responsible for backing up your seed phrase and encrypted backup in a secure location.
      </Section>

      <Section title="4. Blockchain Transactions Are Irreversible">
        All transactions broadcast to the RougeChain network are final and irreversible. Once confirmed on-chain:{'\n'}
        • We cannot reverse, cancel, or modify any transaction{'\n'}
        • Sending funds to the wrong address results in permanent loss{'\n'}
        • Transaction fees (approximately 0.1 XRGE) are non-refundable{'\n\n'}
        Always verify recipient addresses carefully before sending.
      </Section>

      <Section title="5. No Financial Advice">
        Nothing in the App or any associated content constitutes financial, investment, legal, or tax advice. Cryptocurrency and digital assets carry significant risk, including the risk of total loss. You should consult a qualified professional before making any financial decisions.
      </Section>

      <Section title="6. Eligibility">
        You must be at least 13 years old to use Qwalla. By using the App you represent that you meet this age requirement. You also represent that you are not located in a jurisdiction where use of cryptocurrency applications is prohibited, and that your use of the App does not violate any laws applicable to you.
      </Section>

      <Section title="7. Prohibited Uses">
        You agree not to use Qwalla to:{'\n'}
        • Violate any applicable law or regulation, including sanctions laws{'\n'}
        • Launder money, finance terrorism, or engage in other financial crimes{'\n'}
        • Transmit malware, spam, or harmful content via messaging or mail{'\n'}
        • Attempt to circumvent the cryptographic security of the network{'\n'}
        • Impersonate another person or entity{'\n'}
        • Harass, threaten, or harm other users
      </Section>

      <Section title="8. Encrypted Messaging and Mail">
        Qwalla's messaging and mail features use end-to-end encryption. We cannot read your messages. You are solely responsible for the content you send and receive.{'\n\n'}
        On-chain registered mail names are permanent and publicly visible.
      </Section>

      <Section title="9. dApp Browser and Third-Party Applications">
        The App includes an in-app browser for connecting to decentralized applications. These third-party dApps are not operated by Qwalla. We do not endorse, control, or take responsibility for any dApp's content, smart contracts, or security. Interacting with dApps is at your own risk.
      </Section>

      <Section title="10. NFTs">
        NFTs minted, purchased, or received through the App are stored on the RougeChain blockchain. We do not guarantee the value, authenticity, or availability of any NFT or its associated media.
      </Section>

      <Section title="11. Network Availability">
        Qwalla relies on the RougeChain network, Expo push notification infrastructure, and other third-party services. We do not guarantee uninterrupted access to the App or the network. The network may experience downtime, congestion, forks, or other disruptions beyond our control.
      </Section>

      <Section title="12. Testnet and Mainnet">
        During development or beta periods, the App may be connected to a test network (testnet). Testnet tokens have no monetary value and may be reset at any time. Always check which network the App is connected to before transacting.
      </Section>

      <Section title="13. Disclaimers">
        THE APP IS PROVIDED "AS IS" WITHOUT WARRANTY OF ANY KIND. TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE DISCLAIM ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
      </Section>

      <Section title="14. Limitation of Liability">
        TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL QWALLA, ITS DEVELOPERS, OR AFFILIATES BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING LOSS OF FUNDS, DATA, OR PROFITS, ARISING OUT OF OR IN CONNECTION WITH YOUR USE OF THE APP.{'\n\n'}
        Our total liability to you for any claim shall not exceed the greater of (a) the amount of fees you paid to use the App in the twelve months prior to the claim, or (b) $100 USD.
      </Section>

      <Section title="15. Indemnification">
        You agree to indemnify and hold harmless Qwalla and its developers from any claims, damages, losses, or expenses (including reasonable legal fees) arising out of your use of the App, your violation of these Terms, or your violation of any third-party rights.
      </Section>

      <Section title="16. Changes to These Terms">
        We may update these Terms at any time. We will update the "Last updated" date at the top of this page. Continued use of the App after any changes constitutes your acceptance of the new Terms.
      </Section>

      <Section title="17. Governing Law">
        These Terms are governed by the laws of the State of Florida, without regard to conflict of law principles. Any disputes shall be resolved in the courts of the State of Florida.
      </Section>

      <Section title="18. Contact">
        Questions about these Terms?{'\n\n'}
        <Pressable onPress={() => Linking.openURL('mailto:admin@qwalla.io')}>
          <Text style={styles.link}>admin@qwalla.io</Text>
        </Pressable>
      </Section>

      <View style={styles.footer}>
        <Pressable onPress={() => router.replace('/')}
          style={({ pressed }) => [pressed && { opacity: 0.7 }]}>
          <Text style={styles.footerLink}>qwalla.io</Text>
        </Pressable>
        <Text style={styles.footerSep}>·</Text>
        <Pressable onPress={() => router.replace('/privacy')}
          style={({ pressed }) => [pressed && { opacity: 0.7 }]}>
          <Text style={styles.footerLink}>Privacy Policy</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.h2}>{title}</Text>
      <Text style={styles.body}>{children}</Text>
    </View>
  );
}

function Bold({ children }: { children: React.ReactNode }) {
  return <Text style={styles.bold}>{children}</Text>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { maxWidth: 740, alignSelf: 'center', width: '100%', padding: spacing.lg, paddingBottom: 64 },
  header: { marginBottom: spacing.lg },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  backText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  h1: { color: colors.text, fontSize: 32, fontWeight: '800', letterSpacing: -0.5, marginBottom: 8 },
  meta: { color: colors.textTertiary, fontSize: 13, marginBottom: spacing.xl },
  section: { marginBottom: spacing.xl },
  h2: { color: colors.text, fontSize: 17, fontWeight: '700', marginBottom: spacing.sm },
  body: { color: colors.textSecondary, fontSize: 15, lineHeight: 26 },
  bold: { color: colors.text, fontWeight: '700' },
  link: { color: colors.accent, fontSize: 15, textDecorationLine: 'underline' },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.xl, paddingTop: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  footerLink: { color: colors.textSecondary, fontSize: 13, textDecorationLine: 'underline' },
  footerSep: { color: colors.textTertiary, fontSize: 13 },
});
