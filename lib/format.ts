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
