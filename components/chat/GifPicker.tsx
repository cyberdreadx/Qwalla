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

const GIPHY_KEY = 'jzWGk9fn3u9fcckMiyqYNekZOBHQCDYg';
const GIPHY_SEARCH = 'https://api.giphy.com/v1/gifs/search';
const GIPHY_TRENDING = 'https://api.giphy.com/v1/gifs/trending';

type GifItem = {
  id: string;
  preview: string;
  full: string;
};

type Props = { onSelect: (url: string) => void };

export function GifPicker({ onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [gifs, setGifs] = useState<GifItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    try {
      const base = q.trim() ? GIPHY_SEARCH : GIPHY_TRENDING;
      const params = new URLSearchParams({
        api_key: GIPHY_KEY,
        limit: '20',
        rating: 'pg-13',
      });
      if (q.trim()) params.set('q', q.trim());
      const res = await fetch(`${base}?${params}`);
      if (!res.ok) {
        setGifs([]);
        setError('GIF service temporarily unavailable');
        return;
      }
      const data = await res.json();
      const items: GifItem[] = ((data.data ?? []) as any[]).map((g: any) => ({
        id: g.id,
        preview: g.images?.fixed_width_small?.url || g.images?.fixed_width?.url || '',
        full: g.images?.original?.url || '',
      }));
      setGifs(items);
      if (items.length === 0 && q.trim()) setError('No GIFs found');
    } catch {
      setGifs([]);
      setError('Could not load GIFs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => search(query), query ? 400 : 0);
    return () => clearTimeout(t);
  }, [query, search]);

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
      ) : error && gifs.length === 0 ? (
        <Text style={styles.empty}>{error}</Text>
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
              onPress={() => onSelect(item.full || item.preview)}>
              <Image source={{ uri: item.preview }} style={styles.gifImage} resizeMode="cover" />
            </Pressable>
          )}
        />
      )}
      <Text style={styles.powered}>Powered by GIPHY</Text>
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
