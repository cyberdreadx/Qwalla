import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, spacing, radius, fontSize } from '@/constants/theme';

interface Props {
  visible: boolean;
  onClose: () => void;
  onScanned: (data: string) => void;
  /** Footer hint shown under the frame. Defaults to the dApp-pairing copy. */
  hint?: string;
}

/**
 * Native camera scanner. Isolated into its own component so the camera +
 * permission hooks only ever run on native (expo-camera has no module on web)
 * and only while the scanner is open — the parent renders this just for
 * `Platform.OS !== 'web'` and only when `visible`.
 */
function NativeScanner({
  onScanned,
  onClose,
  hint,
}: {
  onScanned: (data: string) => void;
  onClose: () => void;
  hint?: string;
}) {
  const [scanned, setScanned] = useState(false);
  // On native this dependency is always present; requiring it here keeps the
  // hooks below unconditional (rules of hooks).
  const camera = require('expo-camera');
  const CameraView = camera.CameraView;
  const [permission, requestPermission] = camera.useCameraPermissions();

  // Ask for camera access the first time the scanner opens.
  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permission?.granted, permission?.canAskAgain]);

  const handleBarCodeScanned = ({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);
    onScanned(data);
    onClose();
    setTimeout(() => setScanned(false), 2000);
  };

  const granted = !!permission?.granted;

  return (
    <View style={styles.container}>
      {granted ? (
        <CameraView
          style={StyleSheet.absoluteFill}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
        />
      ) : (
        <View style={styles.noCam}>
          <Ionicons name="camera-outline" size={48} color={colors.textTertiary} />
          <Text style={styles.noCamText}>
            {permission && !permission.canAskAgain
              ? 'Camera access is off. Enable it for Qwalla in Settings.'
              : 'Camera permission needed to scan.'}
          </Text>
          {permission && permission.canAskAgain && (
            <TouchableOpacity style={styles.grantBtn} onPress={() => requestPermission()}>
              <Text style={styles.grantBtnText}>Allow camera</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Overlay frame */}
      <View style={styles.frame} pointerEvents="none">
        <View style={styles.frameInner} />
      </View>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.backBtn}>
          <Ionicons name="close" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Scan QR Code</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Footer hint */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>{hint || 'Point at a dApp pairing QR code to connect'}</Text>
      </View>
    </View>
  );
}

export default function QRScanner({ visible, onClose, onScanned, hint }: Props) {
  if (Platform.OS === 'web') {
    return (
      <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
        <View style={styles.overlay}>
          <View style={styles.webSheet}>
            <Text style={styles.webText}>QR scanning is only available on mobile.</Text>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <Text style={styles.closeBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      {visible ? <NativeScanner onScanned={onScanned} onClose={onClose} hint={hint} /> : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  webSheet: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
  },
  webText: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
  },
  closeBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.accentDim,
    borderRadius: radius.sm,
  },
  closeBtnText: {
    color: colors.accent,
    fontWeight: '600',
    fontSize: fontSize.sm,
  },
  noCam: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  noCamText: {
    color: colors.textTertiary,
    fontSize: fontSize.md,
    textAlign: 'center',
  },
  grantBtn: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
  },
  grantBtnText: {
    color: colors.bg,
    fontWeight: '700',
    fontSize: fontSize.sm,
  },
  frame: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frameInner: {
    width: 240,
    height: 240,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.accent,
    backgroundColor: 'transparent',
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 54,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '600',
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: 60,
    alignItems: 'center',
  },
  footerText: {
    color: colors.text,
    fontSize: fontSize.sm,
    textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
});
