/**
 * Platform-safe number formatting (Hermes may not support toLocaleString options).
 * Always shows exact values — no K/M/B abbreviation.
 */
export function formatNumber(value: number, maxDecimals = 2): string {
  if (isNaN(value) || !isFinite(value)) return '0';

  const fixed = maxDecimals > 0 ? value.toFixed(maxDecimals) : Math.floor(value).toString();
  // Remove trailing zeros after decimal
  const trimmed = fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
  // Add thousand separators to integer part
  const [int, dec] = trimmed.split('.');
  const withCommas = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return dec ? `${withCommas}.${dec}` : withCommas;
}

export function formatXrge(value: number): string {
  return formatNumber(value, 4);
}

export function formatUsd(value: number): string {
  if (value < 0.01 && value > 0) return `$${value.toFixed(6)}`;
  return `$${formatNumber(value, 2)}`;
}

/**
 * Decimals for RougeChain L1 bridge tokens. There is no decimals field on-chain (balances are
 * raw integers), so each client must know the convention: qBTC = 8 (1 unit = 1 satoshi),
 * qUSDC/qETH = 6, XRGE + user tokens = raw.
 */
export function l1TokenDecimals(symbol: string): number {
  switch ((symbol || '').toUpperCase()) {
    case 'QBTC':
      return 8;
    case 'QUSDC':
    case 'QETH':
      return 6;
    default:
      return 0;
  }
}

/** Convert a raw on-chain L1 token amount to a human amount using its decimals. */
export function l1ToHuman(symbol: string, raw: number): number {
  const d = l1TokenDecimals(symbol);
  return d > 0 ? raw / 10 ** d : raw;
}

/** Format an already-divided (human) L1 amount with sensible precision per token. */
export function formatL1Human(symbol: string, human: number): string {
  const s = (symbol || '').toUpperCase();
  if (s === 'QBTC') return formatNumber(human, 8);
  if (s === 'QUSDC') return formatNumber(human, 2);
  if (s === 'QETH') return formatNumber(human, 6);
  return formatXrge(human);
}
