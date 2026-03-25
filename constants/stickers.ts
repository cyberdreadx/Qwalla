export type Sticker = {
  id: string;
  label: string;
  emoji: string;
};

export const STICKER_PACKS: { name: string; stickers: Sticker[] }[] = [
  {
    name: 'Qwalla Koala',
    stickers: [
      { id: 'koala-hi', label: 'Hi!', emoji: '🐨👋' },
      { id: 'koala-love', label: 'Love', emoji: '🐨❤️' },
      { id: 'koala-laugh', label: 'LOL', emoji: '🐨😂' },
      { id: 'koala-cry', label: 'Sad', emoji: '🐨😢' },
      { id: 'koala-cool', label: 'Cool', emoji: '🐨😎' },
      { id: 'koala-think', label: 'Hmm', emoji: '🐨🤔' },
      { id: 'koala-fire', label: 'Fire', emoji: '🐨🔥' },
      { id: 'koala-rocket', label: 'Moon', emoji: '🐨🚀' },
      { id: 'koala-sleep', label: 'ZZZ', emoji: '🐨😴' },
      { id: 'koala-party', label: 'Party', emoji: '🐨🎉' },
      { id: 'koala-diamond', label: 'HODL', emoji: '🐨💎' },
      { id: 'koala-quantum', label: 'Quantum', emoji: '🐨⚛️' },
    ],
  },
  {
    name: 'Crypto',
    stickers: [
      { id: 'crypto-moon', label: 'To the moon', emoji: '🌙🚀' },
      { id: 'crypto-diamond', label: 'Diamond hands', emoji: '💎🙌' },
      { id: 'crypto-chart', label: 'Pump', emoji: '📈🟢' },
      { id: 'crypto-dump', label: 'Dump', emoji: '📉🔴' },
      { id: 'crypto-whale', label: 'Whale', emoji: '🐋💰' },
      { id: 'crypto-ngmi', label: 'NGMI', emoji: '🤡📉' },
      { id: 'crypto-gm', label: 'GM', emoji: '☀️👋' },
      { id: 'crypto-gn', label: 'GN', emoji: '🌙💤' },
      { id: 'crypto-wagmi', label: 'WAGMI', emoji: '💪🏆' },
      { id: 'crypto-wen', label: 'Wen?', emoji: '⏰❓' },
      { id: 'crypto-rug', label: 'Rug pull', emoji: '🧶😱' },
      { id: 'crypto-degen', label: 'Degen', emoji: '🎰🤑' },
    ],
  },
];
