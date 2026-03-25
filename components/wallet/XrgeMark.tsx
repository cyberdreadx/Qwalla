import { Image, StyleSheet, View } from 'react-native';

import { colors } from '@/constants/theme';

const xrgeLogo = require('@/assets/images/xrge-logo.png');

export function XrgeMark({ size = 48 }: { size?: number }) {
  return (
    <View style={[styles.ring, { width: size, height: size, borderRadius: size / 2 }]}>
      <Image
        source={xrgeLogo}
        style={{ width: size - 2, height: size - 2, borderRadius: (size - 2) / 2 }}
        resizeMode="cover"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  ring: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
