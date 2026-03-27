import type { Wallet } from '@rougechain/sdk';

import { rc } from '@/lib/rougechain';

export async function fetchMailInbox(wallet: Wallet) {
  return (await rc.mail.getInbox(wallet)) as Record<string, unknown>[];
}

export async function fetchMailSent(wallet: Wallet) {
  return (await rc.mail.getSent(wallet)) as Record<string, unknown>[];
}

export async function fetchMailTrash(wallet: Wallet) {
  return (await rc.mail.getTrash(wallet)) as Record<string, unknown>[];
}

export async function fetchMailMessage(wallet: Wallet, id: string) {
  return (await rc.mail.getMessage(wallet, id)) as Record<string, unknown>;
}
