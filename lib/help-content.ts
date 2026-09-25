import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';

export type HelpSection = {
  id: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  /** i18n key for the section title. */
  titleKey: string;
  /** i18n key for the section body (may contain \n\n paragraphs). */
  bodyKey: string;
};

/**
 * Single source of truth for the onboarding tour AND the Settings "How Qwalla
 * works" guide — the tour pages through these, the guide lists them. The
 * `backup` section is deliberately last and emphasized: losing it is how users
 * lose their chat history.
 */
export const HELP_SECTIONS: HelpSection[] = [
  { id: 'welcome', icon: 'sparkles-outline', titleKey: 'help_welcome_title', bodyKey: 'help_welcome_body' },
  { id: 'chats', icon: 'chatbubbles-outline', titleKey: 'help_chats_title', bodyKey: 'help_chats_body' },
  { id: 'wallet', icon: 'wallet-outline', titleKey: 'help_wallet_title', bodyKey: 'help_wallet_body' },
  { id: 'mail', icon: 'mail-outline', titleKey: 'help_mail_title', bodyKey: 'help_mail_body' },
  { id: 'browser', icon: 'compass-outline', titleKey: 'help_browser_title', bodyKey: 'help_browser_body' },
  { id: 'security', icon: 'lock-closed-outline', titleKey: 'help_security_title', bodyKey: 'help_security_body' },
  { id: 'backup', icon: 'shield-checkmark-outline', titleKey: 'help_backup_title', bodyKey: 'help_backup_body' },
];
