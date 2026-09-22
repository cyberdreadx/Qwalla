/**
 * App-wide i18n (English + Spanish).
 *
 * A tiny zustand store holds the active language; it defaults to the device
 * locale (Spanish if the device is es-*, else English) and is overridden by the
 * user's saved choice (Settings → Language). `useT()` returns a `t(key)` that
 * re-renders on language change. No i18n library — dictionaries live below.
 *
 * Scope so far: onboarding / auth flow. Extend the STRINGS map screen-by-screen
 * as more of the app is localized.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback } from 'react';
import { create } from 'zustand';

export type Lang = 'en' | 'es';

const STORAGE_KEY = 'qwalla_lang';

function detectDeviceLang(): Lang {
  try {
    let loc = '';
    if (typeof navigator !== 'undefined' && (navigator as { language?: string }).language) {
      loc = (navigator as { language?: string }).language ?? '';
    } else if (typeof Intl !== 'undefined') {
      loc = Intl.DateTimeFormat().resolvedOptions().locale ?? '';
    }
    return loc.toLowerCase().startsWith('es') ? 'es' : 'en';
  } catch {
    return 'en';
  }
}

type LangState = {
  lang: Lang;
  hydrated: boolean;
  setLang: (l: Lang) => void;
  hydrate: () => Promise<void>;
};

export const useLangStore = create<LangState>((set) => ({
  lang: detectDeviceLang(),
  hydrated: false,
  setLang: (l) => {
    set({ lang: l });
    AsyncStorage.setItem(STORAGE_KEY, l).catch(() => {});
  },
  hydrate: async () => {
    try {
      const saved = await AsyncStorage.getItem(STORAGE_KEY);
      if (saved === 'en' || saved === 'es') set({ lang: saved });
    } catch {
      /* ignore */
    }
    set({ hydrated: true });
  },
}));

const STRINGS: Record<Lang, Record<string, string>> = {
  en: {
    // Settings
    set_language: 'Language',
    lang_english: 'English',
    lang_spanish: 'Español',
    // Auth · Welcome / onboarding carousel
    aw_slide_welcome_title: 'Welcome to Qwalla',
    aw_slide_welcome_sub:
      'Your quantum-safe companion for RougeChain — wallet, messaging, and mail in one app.',
    aw_slide_wallet_title: 'Quantum-Safe Wallet',
    aw_slide_wallet_sub:
      'Send & receive XRGE with ML-DSA-65 signatures. Your keys never leave your device.',
    aw_slide_chat_title: 'Encrypted Messaging',
    aw_slide_chat_sub:
      'End-to-end encrypted chats powered by ML-KEM-768. Self-destructing messages included.',
    aw_slide_mail_title: 'Quantum-Safe Mail',
    aw_slide_mail_sub:
      'Send encrypted mail to @qwalla.mail addresses. Register your name on-chain.',
    aw_cta_title: 'Ready to go!',
    aw_cta_sub_web:
      'For your security, wallets live only on your device. Download the Qwalla app for iOS or Android to create or import a wallet.',
    aw_cta_sub: 'Create a new quantum-safe wallet or import an existing one.',
    aw_btn_appstore: 'Download on the App Store',
    aw_btn_back_site: 'Back to qwalla.io',
    aw_btn_create: 'Create wallet',
    aw_btn_have: 'I have a wallet',
    aw_skip: 'Skip',
    aw_secure_note: 'NIST-approved post-quantum cryptography (FIPS 203 & 204)',
    // Auth · Avatar
    av_title: "Add a profile photo",
    av_subtitle: "Help people recognize you across chats and mail. You can change or add this anytime in Settings.",
    av_uploading: "Uploading…",
    av_change_photo: "Change photo",
    av_upload_photo: "Upload photo",
    av_continue: "Continue",
    av_skip: "Skip for now",
    // Auth · Mail name
    mn_title: "Claim your mail name",
    mn_sub: "Get a memorable on-chain address for encrypted mail, so people can reach you by name instead of a long key. You can always do this later in Settings.",
    mn_is_yours: "is yours!",
    mn_continue: "Continue",
    mn_field_label: "Choose a name",
    mn_field_placeholder: "yourname",
    mn_claim_button: "Claim name",
    mn_skip: "Skip for now",
    mn_error_taken: "That name is taken or invalid — try another.",
    mn_error_register: "Could not register the name.",
    // Auth · Create wallet
    cw_default_name: "Qwalla user",
    cw_err_create_title: "Could not create wallet",
    cw_err_unknown: "Unknown error",
    cw_err_pw_short: "Password must be at least 8 characters",
    cw_err_pw_mismatch: "Passwords don't match",
    cw_err_set_pw: "Failed to set password",
    cw_backup_prompt: "Save an encrypted backup file of your wallet, protected by your password? You can also do this anytime from Settings.",
    cw_backup_title: "Save an encrypted backup?",
    cw_backup_not_now: "Not now",
    cw_backup_save: "Save backup",
    cw_set_pw_title: "Set a Password",
    cw_set_pw_hint: "Create a password to lock and protect your wallet. Your wallet will auto-lock when the app goes to the background.",
    cw_pw_placeholder: "Create password (min 8 characters)",
    cw_pw_confirm_placeholder: "Confirm password",
    cw_pw_btn_setting: "Setting up...",
    cw_pw_btn_set: "Set Password",
    cw_crypto_note: "Your password is stretched with PBKDF2 (200k rounds) over a random salt and stored securely on your device. It never leaves your device.",
    cw_loading_title: "Forging your quantum-safe wallet",
    cw_loading_sub: "Encrypting your keys with post-quantum cryptography — ML-DSA-65 signatures and a 200,000-round PBKDF2 key. This can take a moment on some devices; please keep the app open.",
    cw_recovery_title: "Recovery phrase",
    cw_recovery_sub: "Keep these words safe!",
    cw_recovery_hint_1: "Write these ",
    cw_recovery_hint_2: " words down and store them somewhere safe. This is the only way to recover your wallet. Never share them with anyone.",
    cw_copied: "Copied!",
    cw_copy: "Copy to clipboard",
    cw_warning: "If you lose this phrase, your wallet cannot be recovered. Qwalla does not store it on any server.",
    cw_saved_btn: "I've saved my recovery phrase",
    cw_title: "Create Wallet",
    cw_intro: "We generate a quantum-safe ML-DSA-65 keypair from a BIP-39 mnemonic, stored in your device's secure vault. You'll get a 24-word recovery phrase to back up.",
    cw_name_label: "Display name (for messenger)",
    cw_name_placeholder: "e.g. Koala Queen",
    cw_create_btn: "Create wallet",
    // Auth · Import wallet
    iw_err_read_file: "Could not read file",
    iw_err_select_backup: "Select a .pqcbackup file first",
    iw_err_enter_backup_pwd: "Enter the backup password",
    iw_default_restored: "Restored",
    iw_toast_restored: "Wallet restored from backup!",
    iw_default_recovered: "Recovered",
    iw_default_imported: "Imported",
    iw_err_unknown: "Unknown error",
    iw_import_failed: "Import failed",
    iw_err_pwd_short: "Password must be at least 8 characters",
    iw_err_pwd_mismatch: "Passwords don't match",
    iw_err_set_pwd: "Failed to set password",
    iw_backup_prompt: "Save an encrypted backup file of your wallet, protected by your password? You can also do this anytime from Settings.",
    iw_backup_title: "Save an encrypted backup?",
    iw_not_now: "Not now",
    iw_save_backup: "Save backup",
    iw_set_pwd_title: "Set a Password",
    iw_set_pwd_hint: "Create a password to lock and protect your wallet. Your wallet will auto-lock when the app goes to the background.",
    iw_create_pwd_placeholder: "Create password (min 8 characters)",
    iw_confirm_pwd_placeholder: "Confirm password",
    iw_setting_up: "Setting up...",
    iw_set_pwd_btn: "Set Password",
    iw_crypto_note: "Your keys are encrypted with AES-256-GCM using a key derived from your password (PBKDF2, 200k rounds). The password never leaves your device.",
    iw_title: "Import Wallet",
    iw_tab_phrase: "Phrase",
    iw_tab_keys: "Keys",
    iw_tab_backup: "Backup",
    iw_mnemonic_hint: "Enter your recovery phrase to restore your wallet. Tip: paste the whole phrase into box 1 and it fills the rest.",
    iw_keys_hint: "Paste your hex-encoded public and private keys from a RougeChain backup.",
    iw_public_key_label: "Public key (hex)",
    iw_private_key_label: "Private key (hex)",
    iw_backup_hint: "Import a .pqcbackup file exported from Qwalla or the RougeChain browser extension. Enter the password you used when creating the backup.",
    iw_select_backup_file: "Select .pqcbackup file",
    iw_tap_to_change: "Tap to change",
    iw_backup_pwd_label: "Backup password",
    iw_backup_pwd_placeholder: "Enter decryption password",
    iw_display_name_label: "Display name",
    iw_optional: "Optional",
    iw_restoring: "Restoring…",
    iw_decrypt_restore: "Decrypt & Restore",
    iw_restore_wallet: "Restore wallet",
  },
  es: {
    // Settings
    set_language: 'Idioma',
    lang_english: 'English',
    lang_spanish: 'Español',
    // Auth · Welcome / onboarding carousel
    aw_slide_welcome_title: 'Bienvenido a Qwalla',
    aw_slide_welcome_sub:
      'Tu compañero a prueba de cuántica para RougeChain — billetera, mensajería y correo en una sola app.',
    aw_slide_wallet_title: 'Billetera a prueba de cuántica',
    aw_slide_wallet_sub:
      'Envía y recibe XRGE con firmas ML-DSA-65. Tus claves nunca salen de tu dispositivo.',
    aw_slide_chat_title: 'Mensajería cifrada',
    aw_slide_chat_sub:
      'Chats cifrados de extremo a extremo con ML-KEM-768. Mensajes autodestructivos incluidos.',
    aw_slide_mail_title: 'Correo a prueba de cuántica',
    aw_slide_mail_sub:
      'Envía correo cifrado a direcciones @qwalla.mail. Registra tu nombre en la cadena.',
    aw_cta_title: '¡Todo listo!',
    aw_cta_sub_web:
      'Por tu seguridad, las billeteras viven solo en tu dispositivo. Descarga la app de Qwalla para iOS o Android para crear o importar una billetera.',
    aw_cta_sub: 'Crea una nueva billetera a prueba de cuántica o importa una existente.',
    aw_btn_appstore: 'Descárgala en el App Store',
    aw_btn_back_site: 'Volver a qwalla.io',
    aw_btn_create: 'Crear billetera',
    aw_btn_have: 'Ya tengo una billetera',
    aw_skip: 'Omitir',
    aw_secure_note: 'Criptografía poscuántica aprobada por el NIST (FIPS 203 y 204)',
    // Auth · Avatar
    av_title: "Agrega una foto de perfil",
    av_subtitle: "Ayuda a que te reconozcan en los chats y el correo. Puedes cambiarla o agregarla cuando quieras en Ajustes.",
    av_uploading: "Subiendo…",
    av_change_photo: "Cambiar foto",
    av_upload_photo: "Subir foto",
    av_continue: "Continuar",
    av_skip: "Omitir por ahora",
    // Auth · Mail name
    mn_title: "Reclama tu nombre de correo",
    mn_sub: "Consigue una dirección on-chain fácil de recordar para el correo cifrado, para que la gente pueda contactarte por tu nombre en lugar de una clave larga. Siempre puedes hacerlo más tarde en Ajustes.",
    mn_is_yours: "ya es tuyo!",
    mn_continue: "Continuar",
    mn_field_label: "Elige un nombre",
    mn_field_placeholder: "tunombre",
    mn_claim_button: "Reclamar nombre",
    mn_skip: "Omitir por ahora",
    mn_error_taken: "Ese nombre no está disponible o no es válido — prueba con otro.",
    mn_error_register: "No se pudo registrar el nombre.",
    // Auth · Create wallet
    cw_default_name: "Usuario de Qwalla",
    cw_err_create_title: "No se pudo crear la billetera",
    cw_err_unknown: "Error desconocido",
    cw_err_pw_short: "La contraseña debe tener al menos 8 caracteres",
    cw_err_pw_mismatch: "Las contraseñas no coinciden",
    cw_err_set_pw: "No se pudo establecer la contraseña",
    cw_backup_prompt: "¿Quieres guardar un archivo de copia de seguridad cifrado de tu billetera, protegido por tu contraseña? También puedes hacerlo en cualquier momento desde Ajustes.",
    cw_backup_title: "¿Guardar una copia de seguridad cifrada?",
    cw_backup_not_now: "Ahora no",
    cw_backup_save: "Guardar copia",
    cw_set_pw_title: "Crea una contraseña",
    cw_set_pw_hint: "Crea una contraseña para bloquear y proteger tu billetera. Tu billetera se bloqueará automáticamente cuando la app pase a segundo plano.",
    cw_pw_placeholder: "Crea una contraseña (mín. 8 caracteres)",
    cw_pw_confirm_placeholder: "Confirma la contraseña",
    cw_pw_btn_setting: "Configurando...",
    cw_pw_btn_set: "Crear contraseña",
    cw_crypto_note: "Tu contraseña se refuerza con PBKDF2 (200k rondas) sobre una sal aleatoria y se guarda de forma segura en tu dispositivo. Nunca sale de tu dispositivo.",
    cw_loading_title: "Forjando tu billetera resistente a la computación cuántica",
    cw_loading_sub: "Cifrando tus claves con criptografía post-cuántica — firmas ML-DSA-65 y una clave PBKDF2 de 200,000 rondas. Esto puede tardar un momento en algunos dispositivos; por favor, mantén la app abierta.",
    cw_recovery_title: "Frase de recuperación",
    cw_recovery_sub: "¡Guarda estas palabras en un lugar seguro!",
    cw_recovery_hint_1: "Escribe estas ",
    cw_recovery_hint_2: " palabras y guárdalas en un lugar seguro. Esta es la única forma de recuperar tu billetera. Nunca las compartas con nadie.",
    cw_copied: "¡Copiado!",
    cw_copy: "Copiar al portapapeles",
    cw_warning: "Si pierdes esta frase, tu billetera no se podrá recuperar. Qwalla no la guarda en ningún servidor.",
    cw_saved_btn: "Ya guardé mi frase de recuperación",
    cw_title: "Crear billetera",
    cw_intro: "Generamos un par de claves ML-DSA-65 resistente a la computación cuántica a partir de una frase mnemónica BIP-39, guardado en el almacén seguro de tu dispositivo. Recibirás una frase de recuperación de 24 palabras para respaldarla.",
    cw_name_label: "Nombre para mostrar (en el messenger)",
    cw_name_placeholder: "p. ej. Koala Queen",
    cw_create_btn: "Crear billetera",
    // Auth · Import wallet
    iw_err_read_file: "No se pudo leer el archivo",
    iw_err_select_backup: "Primero selecciona un archivo .pqcbackup",
    iw_err_enter_backup_pwd: "Ingresa la contraseña de la copia de seguridad",
    iw_default_restored: "Restaurada",
    iw_toast_restored: "¡Billetera restaurada desde la copia de seguridad!",
    iw_default_recovered: "Recuperada",
    iw_default_imported: "Importada",
    iw_err_unknown: "Error desconocido",
    iw_import_failed: "Error al importar",
    iw_err_pwd_short: "La contraseña debe tener al menos 8 caracteres",
    iw_err_pwd_mismatch: "Las contraseñas no coinciden",
    iw_err_set_pwd: "No se pudo establecer la contraseña",
    iw_backup_prompt: "¿Quieres guardar un archivo de copia de seguridad cifrado de tu billetera, protegido con tu contraseña? También puedes hacerlo en cualquier momento desde Ajustes.",
    iw_backup_title: "¿Guardar una copia de seguridad cifrada?",
    iw_not_now: "Ahora no",
    iw_save_backup: "Guardar copia",
    iw_set_pwd_title: "Establece una contraseña",
    iw_set_pwd_hint: "Crea una contraseña para bloquear y proteger tu billetera. Tu billetera se bloqueará automáticamente cuando la app pase a segundo plano.",
    iw_create_pwd_placeholder: "Crea una contraseña (mín. 8 caracteres)",
    iw_confirm_pwd_placeholder: "Confirma la contraseña",
    iw_setting_up: "Configurando...",
    iw_set_pwd_btn: "Establecer contraseña",
    iw_crypto_note: "Tus claves se cifran con AES-256-GCM usando una clave derivada de tu contraseña (PBKDF2, 200k rondas). La contraseña nunca sale de tu dispositivo.",
    iw_title: "Importar billetera",
    iw_tab_phrase: "Frase",
    iw_tab_keys: "Claves",
    iw_tab_backup: "Copia",
    iw_mnemonic_hint: "Ingresa tu frase de recuperación para restaurar tu billetera. Consejo: pega la frase completa en la casilla 1 y el resto se llenará solo.",
    iw_keys_hint: "Pega tus claves pública y privada en formato hexadecimal desde una copia de seguridad de RougeChain.",
    iw_public_key_label: "Clave pública (hex)",
    iw_private_key_label: "Clave privada (hex)",
    iw_backup_hint: "Importa un archivo .pqcbackup exportado desde Qwalla o desde la extensión de navegador de RougeChain. Ingresa la contraseña que usaste al crear la copia de seguridad.",
    iw_select_backup_file: "Selecciona un archivo .pqcbackup",
    iw_tap_to_change: "Toca para cambiar",
    iw_backup_pwd_label: "Contraseña de la copia",
    iw_backup_pwd_placeholder: "Ingresa la contraseña de descifrado",
    iw_display_name_label: "Nombre visible",
    iw_optional: "Opcional",
    iw_restoring: "Restaurando…",
    iw_decrypt_restore: "Descifrar y restaurar",
    iw_restore_wallet: "Restaurar billetera",
  },
};

export function translate(lang: Lang, key: string): string {
  return STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? key;
}

/** Hook returning a language-reactive `t(key)` plus current lang + setter. */
export function useT() {
  const lang = useLangStore((s) => s.lang);
  const setLang = useLangStore((s) => s.setLang);
  const t = useCallback((key: string) => translate(lang, key), [lang]);
  return { t, lang, setLang };
}
