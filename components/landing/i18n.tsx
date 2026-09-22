/**
 * Lightweight i18n for the marketing landing page (qwalla.io).
 *
 * English + Spanish, switchable. Default locale is detected from the browser
 * (`navigator.language`) and the manual choice is persisted to localStorage on
 * web; on native it just defaults to English. Kept self-contained (no deps) —
 * if the app itself is localized later this can graduate into a shared lib.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

export type Lang = 'en' | 'es';

const STORAGE_KEY = 'qwalla_lang';

const STRINGS: Record<Lang, Record<string, string>> = {
  en: {
    // Nav
    nav_features: 'Features',
    nav_security: 'Security',
    nav_download: 'Download',
    nav_docs: 'Docs',
    nav_launch: 'Launch App',
    // Hero
    hero_badge: 'Post-Quantum Encrypted',
    hero_title: 'The quantum-safe wallet for RougeChain.',
    hero_sub:
      'Send, chat, and mail — all end-to-end encrypted with NIST post-quantum cryptography. Your keys, your data, zero trust required.',
    hero_cta_start: 'Get Started',
    hero_cta_import: 'Import Wallet',
    // Stats
    stat_signatures: 'Signatures',
    stat_kex: 'Key Exchange',
    stat_recovery: 'Recovery',
    stat_free_value: 'Free',
    stat_opensource: 'Open Source',
    // Beta / top download band
    beta_badge: '● Available Now',
    beta_title: 'Get Qwalla.',
    beta_blurb:
      'On iOS, Android, and desktop — the quantum-safe wallet, end-to-end encrypted. No account, no KYC — just install and go.',
    beta_dl_on: 'Download on',
    beta_dl_the: 'Download the',
    beta_dl_for: 'Download for',
    label_ios: 'iOS · App Store',
    label_android: 'Android APK',
    label_windows: 'Windows Desktop',
    // Features
    feat_label: 'Built Different',
    feat_title: 'One app. Everything encrypted.',
    feat_wallet_title: 'Quantum-Safe Wallet',
    feat_wallet_desc:
      'Send and receive RougeChain tokens with ML-DSA-65 signatures. Full balance tracking, QR codes, and BIP-39 mnemonic recovery.',
    feat_msg_title: 'Encrypted Messenger',
    feat_msg_desc:
      'End-to-end encrypted chat with ML-KEM-768 key exchange and XChaCha20-Poly1305. Group chats, emojis, GIFs, and stickers built in.',
    feat_mail_title: 'On-Chain Mail',
    feat_mail_desc:
      'Send encrypted mail to any registered address. Decentralized inbox with compose, read, and name registry — no central server.',
    feat_dapp_title: 'dApp Browser',
    feat_dapp_desc:
      'Connect to RougeChain dApps directly from Qwalla. Built-in browser with injected provider, approval dialogs, and WalletConnect-style pairing.',
    // Security
    sec_label: 'Security First',
    sec_title: 'Quantum-resistant from the ground up.',
    sec_sub:
      "Today's encryption will be broken by tomorrow's quantum computers. Qwalla is built with NIST post-quantum cryptography so your assets and conversations stay safe — now and in the future.",
    sec_nist_title: 'NIST Post-Quantum Standards',
    sec_nist_desc:
      'Qwalla uses ML-DSA-65 for signatures and ML-KEM-768 for key encapsulation — both NIST-approved, quantum-resistant algorithms.',
    sec_noncustodial_title: 'Non-Custodial by Design',
    sec_noncustodial_desc:
      'Your keys never leave your device. No servers, no third parties, no backdoors. Export or recover anytime with your 12-word phrase.',
    sec_e2e_title: 'End-to-End Encryption',
    sec_e2e_desc:
      'Every message and mail is encrypted client-side with XChaCha20-Poly1305 before it ever touches the network.',
    sec_decentralized_title: 'Decentralized Network',
    sec_decentralized_desc:
      'Built on RougeChain — a post-quantum L1 blockchain with on-chain messaging, mail, and name registry.',
    // Footer CTA
    footercta_title: 'Ready to go quantum-safe?',
    footercta_sub:
      'Create a wallet in seconds. No email, no phone number, no KYC. Just you and your keys.',
    footercta_cta: 'Launch Qwalla',
    // Download section
    dl_label: 'Get Qwalla',
    dl_title: 'Download for your platform.',
    dl_sub:
      'Available on iOS, Android, desktop, and as a progressive web app. One wallet, every device.',
    dl_ios_sub: 'App Store',
    dl_android_sub: 'Beta on',
    dl_desktop_sub: 'Download for',
    dl_coming: 'Coming soon',
    dl_direct_sub: 'Direct download',
    dl_direct_label: 'All releases',
    label_windows_desktop: 'Windows · Desktop',
    dl_browser_sub: 'Web3 browser',
    label_browser: 'Qwalla Browser',
    // Footer
    footer_privacy: 'Privacy Policy',
    footer_terms: 'Terms of Service',
    footer_built: '· Built on RougeChain · rougechain.io',
  },
  es: {
    // Nav
    nav_features: 'Funciones',
    nav_security: 'Seguridad',
    nav_download: 'Descargar',
    nav_docs: 'Docs',
    nav_launch: 'Abrir app',
    // Hero
    hero_badge: 'Cifrado poscuántico',
    hero_title: 'La billetera a prueba de cuántica para RougeChain.',
    hero_sub:
      'Envía, chatea y envía correos — todo cifrado de extremo a extremo con criptografía poscuántica del NIST. Tus claves, tus datos, sin necesidad de confiar en nadie.',
    hero_cta_start: 'Comenzar',
    hero_cta_import: 'Importar billetera',
    // Stats
    stat_signatures: 'Firmas',
    stat_kex: 'Intercambio de claves',
    stat_recovery: 'Recuperación',
    stat_free_value: 'Gratis',
    stat_opensource: 'Código abierto',
    // Beta / top download band
    beta_badge: '● Disponible ahora',
    beta_title: 'Obtén Qwalla.',
    beta_blurb:
      'En iOS, Android y escritorio — la billetera a prueba de cuántica, cifrada de extremo a extremo. Sin cuenta, sin KYC — solo instala y listo.',
    beta_dl_on: 'Descarga en',
    beta_dl_the: 'Descarga el',
    beta_dl_for: 'Descarga para',
    label_ios: 'iOS · App Store',
    label_android: 'Android APK',
    label_windows: 'Windows Escritorio',
    // Features
    feat_label: 'Diferente por diseño',
    feat_title: 'Una app. Todo cifrado.',
    feat_wallet_title: 'Billetera a prueba de cuántica',
    feat_wallet_desc:
      'Envía y recibe tokens de RougeChain con firmas ML-DSA-65. Seguimiento completo de saldo, códigos QR y recuperación mnemónica BIP-39.',
    feat_msg_title: 'Mensajería cifrada',
    feat_msg_desc:
      'Chat cifrado de extremo a extremo con intercambio de claves ML-KEM-768 y XChaCha20-Poly1305. Chats grupales, emojis, GIFs y stickers integrados.',
    feat_mail_title: 'Correo en cadena',
    feat_mail_desc:
      'Envía correo cifrado a cualquier dirección registrada. Bandeja de entrada descentralizada con redacción, lectura y registro de nombres — sin servidor central.',
    feat_dapp_title: 'Navegador dApp',
    feat_dapp_desc:
      'Conéctate a dApps de RougeChain directamente desde Qwalla. Navegador integrado con proveedor inyectado, diálogos de aprobación y emparejamiento estilo WalletConnect.',
    // Security
    sec_label: 'La seguridad primero',
    sec_title: 'Resistente a la cuántica desde su base.',
    sec_sub:
      'El cifrado de hoy será vulnerado por los ordenadores cuánticos del mañana. Qwalla está construida con criptografía poscuántica del NIST para que tus activos y conversaciones sigan seguros — hoy y en el futuro.',
    sec_nist_title: 'Estándares poscuánticos del NIST',
    sec_nist_desc:
      'Qwalla usa ML-DSA-65 para firmas y ML-KEM-768 para encapsulación de claves — ambos algoritmos resistentes a la cuántica y aprobados por el NIST.',
    sec_noncustodial_title: 'No custodial por diseño',
    sec_noncustodial_desc:
      'Tus claves nunca salen de tu dispositivo. Sin servidores, sin terceros, sin puertas traseras. Exporta o recupera cuando quieras con tu frase de 12 palabras.',
    sec_e2e_title: 'Cifrado de extremo a extremo',
    sec_e2e_desc:
      'Cada mensaje y correo se cifra en el cliente con XChaCha20-Poly1305 antes de tocar la red.',
    sec_decentralized_title: 'Red descentralizada',
    sec_decentralized_desc:
      'Construida sobre RougeChain — una blockchain L1 poscuántica con mensajería, correo y registro de nombres en cadena.',
    // Footer CTA
    footercta_title: '¿Listo para volverte a prueba de cuántica?',
    footercta_sub:
      'Crea una billetera en segundos. Sin correo, sin número de teléfono, sin KYC. Solo tú y tus claves.',
    footercta_cta: 'Abrir Qwalla',
    // Download section
    dl_label: 'Obtén Qwalla',
    dl_title: 'Descarga para tu plataforma.',
    dl_sub:
      'Disponible en iOS, Android, escritorio y como aplicación web progresiva. Una billetera, todos los dispositivos.',
    dl_ios_sub: 'App Store',
    dl_android_sub: 'Beta en',
    dl_desktop_sub: 'Descarga para',
    dl_coming: 'Próximamente',
    dl_direct_sub: 'Descarga directa',
    dl_direct_label: 'Todas las versiones',
    label_windows_desktop: 'Windows · Escritorio',
    dl_browser_sub: 'Navegador web3',
    label_browser: 'Qwalla Browser',
    // Footer
    footer_privacy: 'Política de privacidad',
    footer_terms: 'Términos del servicio',
    footer_built: '· Construido sobre RougeChain · rougechain.io',
  },
};

function detectLang(): Lang {
  try {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const saved = window.localStorage?.getItem(STORAGE_KEY);
      if (saved === 'en' || saved === 'es') return saved;
      const nav = typeof navigator !== 'undefined' ? navigator.language : '';
      if (nav && nav.toLowerCase().startsWith('es')) return 'es';
    }
  } catch {
    /* ignore */
  }
  return 'en';
}

type I18nValue = { lang: Lang; setLang: (l: Lang) => void; t: (key: string) => string };

const I18nContext = createContext<I18nValue>({
  lang: 'en',
  setLang: () => {},
  t: (k) => STRINGS.en[k] ?? k,
});

export function LandingI18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.localStorage?.setItem(STORAGE_KEY, l);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<I18nValue>(
    () => ({ lang, setLang, t: (key: string) => STRINGS[lang][key] ?? STRINGS.en[key] ?? key }),
    [lang, setLang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT() {
  return useContext(I18nContext);
}
