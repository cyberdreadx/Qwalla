import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, spacing, radius, fontSize } from '@/constants/theme';
import type { ApprovalRequest } from '@/lib/dapp-provider';

interface Props {
  request: ApprovalRequest | null;
  onClose: () => void;
}

export default function ApprovalModal({ request, onClose }: Props) {
  if (!request) return null;

  const domain = (() => {
    try {
      return new URL(request.origin).hostname;
    } catch {
      return request.origin;
    }
  })();

  const handleApprove = () => {
    request.resolve(true);
    onClose();
  };

  const handleDeny = () => {
    request.reject('User denied request');
    onClose();
  };

  const typeConfig = {
    connect: {
      icon: 'link' as const,
      label: 'Connection Request',
      iconBg: 'rgba(59,130,246,0.15)',
      iconColor: '#60A5FA',
      buttonBg: '#3B82F6',
      buttonLabel: 'Connect',
    },
    sign: {
      icon: 'create' as const,
      label: 'Signature Request',
      iconBg: 'rgba(245,158,11,0.15)',
      iconColor: '#FBBF24',
      buttonBg: '#F59E0B',
      buttonLabel: 'Sign',
    },
    send: {
      icon: 'send' as const,
      label: 'Transaction Request',
      iconBg: 'rgba(239,68,68,0.15)',
      iconColor: '#F87171',
      buttonBg: '#EF4444',
      buttonLabel: 'Approve & Send',
    },
  };

  const cfg = typeConfig[request.type];

  return (
    <Modal transparent animationType="slide" visible onRequestClose={handleDeny}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <View style={[styles.iconCircle, { backgroundColor: cfg.iconBg }]}>
              <Ionicons name={cfg.icon} size={28} color={cfg.iconColor} />
            </View>
            <Text style={styles.title}>{cfg.label}</Text>
          </View>

          {/* Origin */}
          <View style={styles.originRow}>
            <View style={styles.originAvatar}>
              <Text style={styles.originLetter}>{domain.charAt(0).toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.originDomain}>{domain}</Text>
              <Text style={styles.originFull} numberOfLines={1}>
                {request.origin}
              </Text>
            </View>
          </View>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            {request.type === 'connect' && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>THIS WILL ALLOW THE SITE TO:</Text>
                <View style={styles.permRow}>
                  <Ionicons name="shield-checkmark" size={16} color={colors.success} />
                  <Text style={styles.permText}>View your public key</Text>
                </View>
                <View style={styles.permRow}>
                  <Ionicons name="shield-checkmark" size={16} color={colors.success} />
                  <Text style={styles.permText}>Check your balance</Text>
                </View>
              </View>
            )}

            {request.type === 'sign' && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>DATA TO SIGN</Text>
                <View style={styles.codeBox}>
                  <Text style={styles.codeText}>
                    {request.payload
                      ? JSON.stringify(request.payload, null, 2)
                      : 'No data'}
                  </Text>
                </View>
              </View>
            )}

            {request.type === 'send' && request.payload && (
              <View style={styles.section}>
                <View style={styles.warningRow}>
                  <Ionicons name="warning" size={16} color={colors.warning} />
                  <Text style={styles.warningText}>
                    This will submit a transaction to RougeChain
                  </Text>
                </View>
                <View style={styles.txCard}>
                  {request.payload.to && (
                    <View style={styles.txRow}>
                      <Text style={styles.txLabel}>To</Text>
                      <Text style={styles.txValue} numberOfLines={1}>
                        {String(request.payload.to).slice(0, 20)}...
                      </Text>
                    </View>
                  )}
                  {request.payload.amount !== undefined && (
                    <View style={styles.txRow}>
                      <Text style={styles.txLabel}>Amount</Text>
                      <Text style={[styles.txValue, { fontWeight: '700' }]}>
                        {String(request.payload.amount)}{' '}
                        {String(request.payload.token || 'XRGE')}
                      </Text>
                    </View>
                  )}
                </View>
                <View style={styles.codeBox}>
                  <Text style={styles.codeText}>
                    {JSON.stringify(request.payload, null, 2)}
                  </Text>
                </View>
              </View>
            )}
          </ScrollView>

          {/* Buttons */}
          <View style={styles.buttons}>
            <TouchableOpacity style={styles.denyBtn} onPress={handleDeny}>
              <Text style={styles.denyText}>Deny</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.approveBtn, { backgroundColor: cfg.buttonBg }]}
              onPress={handleApprove}>
              <Text style={styles.approveText}>{cfg.buttonLabel}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: '80%',
    paddingBottom: spacing.lg,
  },
  header: {
    alignItems: 'center',
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '600',
  },
  originRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.chrome,
  },
  originAvatar: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.input,
    alignItems: 'center',
    justifyContent: 'center',
  },
  originLetter: {
    color: colors.textSecondary,
    fontWeight: '700',
    fontSize: fontSize.sm,
  },
  originDomain: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  originFull: {
    color: colors.textTertiary,
    fontSize: fontSize.xs,
  },
  body: {
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  section: {
    gap: spacing.sm,
  },
  sectionLabel: {
    color: colors.textTertiary,
    fontSize: fontSize.xs,
    fontWeight: '600',
    letterSpacing: 1,
  },
  permRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  permText: {
    color: colors.text,
    fontSize: fontSize.sm,
  },
  codeBox: {
    backgroundColor: colors.chrome,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    maxHeight: 160,
  },
  codeText: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontFamily: 'SpaceMono',
  },
  warningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  warningText: {
    color: colors.warning,
    fontSize: fontSize.sm,
  },
  txCard: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.chrome,
    padding: spacing.md,
    gap: spacing.sm,
  },
  txRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  txLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
  },
  txValue: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontFamily: 'SpaceMono',
    maxWidth: 180,
  },
  buttons: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  denyBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.chrome,
    alignItems: 'center',
  },
  denyText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  approveBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  approveText: {
    color: '#FFFFFF',
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
});
