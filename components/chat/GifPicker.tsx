import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';

const TENOR_KEY = 'AIzaSyA3Bti2TFjlBn2jqsUNtzCrpvl3CkrVpXs';
const TENOR_SEARCH = 'https://tenor.googleapis.com/v2/search';
const TENOR_FEATURED = 'https://tenor.googleapis.com/v2/featured';

type TenorGif = {
  id: string;
  media_formats: {
    tinygif?: { url: string; dims: [number, number] };
    gif?: { url: string };
  };
};

type Props = { onSelect: (url: string) => void };

export function GifPicker({ onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [gifs, setGifs] = useState<TenorGif[]>([]);
  const [loading, setLoading] = useState(false);

  const search = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const base = q.trim() ? TENOR_SEARCH : TENOR_FEATURED;
      const params = new URLSearchParams({
        key: TENOR_KEY,
        client_key: 'qwalla',
        limit: '20',
        media_filter: 'tinygif,gif',
      });
      if (q.trim()) params.set('q', q.trim());
      const res = await fetch(`${base}?${params}`);
      const data = await res.json();
      setGifs((data.results ?? []) as TenorGif[]);
    } catch {
      setGifs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => search(query), query ? 400 : 0);
    return () => clearTimeout(t);
  }, [query, search]);

  function gifUrl(g: TenorGif): string {
    return g.media_formats.tinygif?.url ?? g.media_formats.gif?.url ?? '';
  }

  return (
    <View style={styles.container}>
      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={colors.textTertiary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search GIFs…"
          placeholderTextColor={colors.textTertiary}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
        />
      </View>
      {loading ? (
        <ActivityIndicator color={colors.accent} style={styles.loader} />
      ) : gifs.length === 0 ? (
        <Text style={styles.empty}>No GIFs found</Text>
      ) : (
        <FlatList
          data={gifs}
          numColumns={2}
          keyExtractor={(g) => g.id}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={styles.gridRow}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.gifCell, pressed && { opacity: 0.7 }]}
              onPress={() => onSelect(gifUrl(item))}>
              <Image source={{ uri: gifUrl(item) }} style={styles.gifImage} resizeMode="cover" />
            </Pressable>
          )}
        />
      )}
      <Text style={styles.powered}>Powered by Tenor</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { height: 280, backgroundColor: colors.chrome },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: spacing.sm,
    marginTop: spacing.sm,
    backgroundColor: colors.input,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    height: 36,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 14 },
  loader: { marginTop: spacing.xl },
  empty: { color: colors.textTertiary, textAlign: 'center', marginTop: spacing.xl, fontSize: 13 },
  grid: { padding: spacing.xs },
  gridRow: { gap: spacing.xs },
  gifCell: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  gifImage: { width: '100%', height: '100%' },
  powered: {
    color: colors.textTertiary,
    fontSize: 10,
    textAlign: 'center',
    paddingVertical: 4,
  },
});
