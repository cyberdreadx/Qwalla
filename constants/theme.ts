/**
 * Qwalla design tokens — aligned with quantum-vault's dark chrome palette.
 * Base: hsl(220 20% 4%) from the extension's index.css
 * Accent: hsl(175 85% 50%) — the quantum teal
 */
export const colors = {
  /** hsl(220 20% 4%) */
  bg: '#0A0C10',
  /** Slightly elevated surface for cards/sheets */
  surface: '#111318',
  /** Tab bar, modals */
  chrome: '#14161C',
  /** Input fields, recessed areas */
  input: '#181B22',
  /** hsl(175 85% 50%) — primary accent */
  accent: '#1FE0C5',
  accentDim: 'rgba(31, 224, 197, 0.10)',
  accentMid: 'rgba(31, 224, 197, 0.25)',
  /** Purple for secondary actions */
  purple: '#6C5CE7',
  purpleDim: 'rgba(108, 92, 231, 0.15)',
  /** Foreground */
  text: '#E8F0EE',
  textSecondary: '#8B95A8',
  textTertiary: '#5A6478',
  /** Borders — very subtle */
  border: 'rgba(255, 255, 255, 0.07)',
  borderLight: 'rgba(255, 255, 255, 0.12)',
  /** Status */
  success: '#2EE6A8',
  warning: '#FDCB6E',
  error: '#FF6B6B',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  full: 9999,
};

export const fontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 18,
  xl: 24,
  hero: 32,
};
