import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/constants/theme';
import { formatDuration, voiceDataUriToFile } from '@/lib/voice';

/**
 * Renders a received/sent voice note. The message body is a base64 audio
 * data-URI; the native player needs a file, so we materialize it to the cache
 * dir first, then mount the real player.
 */
export function VoiceMessage({ dataUri, mine }: { dataUri: string; mine: boolean }) {
  const [fileUri, setFileUri] = useState<string | null>(null);

  useEffect(() => {
    let ok = true;
    // On web the player accepts the data-URI directly (no cache file / FS).
    if (Platform.OS === 'web') {
      setFileUri(dataUri);
      return;
    }
    void voiceDataUriToFile(dataUri).then((u) => {
      if (ok) setFileUri(u);
    });
    return () => {
      ok = false;
    };
  }, [dataUri]);

  if (!fileUri) return <VoiceShell mine={mine} label="•••" progress={0} playing={false} />;
  return <VoicePlayer uri={fileUri} mine={mine} />;
}

function VoicePlayer({ uri, mine }: { uri: string; mine: boolean }) {
  const player = useAudioPlayer({ uri });
  const status = useAudioPlayerStatus(player);

  const playing = status?.playing ?? false;
  const duration = status?.duration ?? 0;
  const currentTime = status?.currentTime ?? 0;
  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;

  // Reset to the start when playback finishes so the button plays again.
  useEffect(() => {
    if (status?.didJustFinish) {
      player.seekTo(0);
      player.pause();
    }
  }, [status?.didJustFinish, player]);

  const toggle = () => {
    if (playing) {
      player.pause();
    } else {
      if (duration > 0 && currentTime >= duration - 0.05) player.seekTo(0);
      player.play();
    }
  };

  // While playing show elapsed; otherwise show the total length.
  const shownSecs = playing || currentTime > 0 ? currentTime : duration;
  const label = duration > 0 ? formatDuration(shownSecs) : '•••';

  return (
    <Pressable onPress={toggle}>
      <VoiceShell mine={mine} label={label} progress={progress} playing={playing} />
    </Pressable>
  );
}

function VoiceShell({
  mine,
  label,
  progress,
  playing,
}: {
  mine: boolean;
  label: string;
  progress: number;
  playing: boolean;
}) {
  const tint = mine ? colors.bg : colors.accent;
  const track = mine ? 'rgba(0,0,0,0.18)' : colors.surface;
  return (
    <View style={styles.row}>
      <Ionicons name={playing ? 'pause' : 'play'} size={18} color={tint} />
      <View style={[styles.track, { backgroundColor: track }]}>
        <View style={[styles.fill, { width: `${Math.round(progress * 100)}%`, backgroundColor: tint }]} />
      </View>
      <Text style={[styles.time, { color: tint }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 160, paddingVertical: 2 },
  track: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },
  time: { fontSize: 12, fontWeight: '600', minWidth: 34, textAlign: 'right' },
});
