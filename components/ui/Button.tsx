import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';

type Props = PressableProps & {
  title: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  loading?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
};

export function Button({
  title,
  variant = 'primary',
  loading,
  disabled,
  style,
  textStyle,
  ...rest
}: Props) {
  const isPrimary = variant === 'primary';
  const isGhost = variant === 'ghost';
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        isPrimary && styles.primary,
        variant === 'secondary' && styles.secondary,
        isGhost && styles.ghost,
        (disabled || loading) && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}
      {...rest}>
      {loading ? (
        <ActivityIndicator color={isPrimary ? colors.bg : colors.accent} size="small" />
      ) : (
        <Text
          style={[
            styles.label,
            isPrimary && styles.labelPrimary,
            variant === 'secondary' && styles.labelSecondary,
            isGhost && styles.labelGhost,
            textStyle,
          ]}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  primary: {
    backgroundColor: colors.accent,
  },
  secondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.85 },
  label: { fontSize: 15, fontWeight: '700' },
  labelPrimary: { color: colors.bg },
  labelSecondary: { color: colors.text },
  labelGhost: { color: colors.textSecondary },
});
