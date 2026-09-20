/**
 * Free, no-key crypto news + market data for the browser home feed.
 *
 * News = a handful of public RSS feeds parsed in-app (React Native's fetch has
 * no CORS restriction, so this Just Works). Markets = CoinGecko's free
 * /coins/markets endpoint (price, 24h %, 7-day sparkline). No API keys.
 */

export interface NewsItem {
  id: string;
  title: string;
  source: string;
  url: string;
  imageUrl?: string;
  publishedAt: number;
}

export interface CoinMarket {
  id: string;
  symbol: string;
  name: string;
  image: string;
  price: number;
  change24h: number;
  sparkline: number[];
}

const FEEDS: { source: string; url: string }[] = [
  { source: 'Cointelegraph', url: 'https://cointelegraph.com/rss' },
  { source: 'Decrypt', url: 'https://decrypt.co/feed' },
  { source: 'CryptoSlate', url: 'https://cryptoslate.com/feed/' },
  { source: 'Bitcoinist', url: 'https://bitcoinist.com/feed/' },
];

// These feeds sit behind Cloudflare, which 403s the default Android okhttp
// User-Agent (`okhttp/4.x`) — that's why the feed loaded on iOS (CFNetwork UA)
// but came back empty on Android. Send a normal desktop-browser UA so both
// platforms get the same response.
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** Strip CDATA + HTML tags and decode the common entities RSS uses. */
function clean(s: string): string {
  return s
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#8217;|&#x2019;/g, '’')
    .replace(/&#8216;/g, '‘')
    .replace(/&#8211;/g, '–')
    .replace(/&#8230;/g, '…')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function firstMatch(block: string, patterns: RegExp[]): string | undefined {
  for (const re of patterns) {
    const m = block.match(re);
    if (m?.[1]) return m[1];
  }
  return undefined;
}

function parseRss(xml: string, source: string): NewsItem[] {
  const out: NewsItem[] = [];
  const blocks = xml.split(/<item[\s>]/i).slice(1);
  for (const raw of blocks) {
    const block = raw.split(/<\/item>/i)[0];
    const title = firstMatch(block, [/<title>([\s\S]*?)<\/title>/i]);
    const link = firstMatch(block, [
      /<link>([\s\S]*?)<\/link>/i,
      /<link[^>]*href="([^"]+)"/i,
    ]);
    const pub = firstMatch(block, [
      /<pubDate>([\s\S]*?)<\/pubDate>/i,
      /<dc:date>([\s\S]*?)<\/dc:date>/i,
    ]);
    const img = firstMatch(block, [
      /<media:content[^>]*url="([^"]+)"/i,
      /<media:thumbnail[^>]*url="([^"]+)"/i,
      /<enclosure[^>]*url="([^"]+)"/i,
      /<img[^>]*src="([^"]+)"/i,
    ]);
    if (!title || !link) continue;
    const at = pub ? Date.parse(pub) : 0;
    out.push({
      id: clean(link),
      title: clean(title),
      source,
      url: clean(link),
      imageUrl: img,
      publishedAt: Number.isNaN(at) ? 0 : at,
    });
  }
  return out;
}

export async function fetchCryptoNews(): Promise<NewsItem[]> {
  const results = await Promise.all(
    FEEDS.map(async (f) => {
      try {
        const res = await fetch(f.url, {
          headers: {
            Accept: 'application/rss+xml, application/xml, text/xml',
            'User-Agent': BROWSER_UA,
          },
        });
        if (!res.ok) return [] as NewsItem[];
        return parseRss(await res.text(), f.source);
      } catch {
        return [] as NewsItem[];
      }
    }),
  );
  const merged = results.flat().sort((a, b) => b.publishedAt - a.publishedAt);
  const seen = new Set<string>();
  const deduped: NewsItem[] = [];
  for (const n of merged) {
    const key = n.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(n);
  }
  return deduped.slice(0, 25);
}

export async function fetchMarkets(): Promise<CoinMarket[]> {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=12&page=1&sparkline=true&price_change_percentage=24h',
      { headers: { Accept: 'application/json', 'User-Agent': BROWSER_UA } },
    );
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map((c: any): CoinMarket => ({
      id: String(c.id),
      symbol: String(c.symbol ?? '').toUpperCase(),
      name: String(c.name ?? ''),
      image: String(c.image ?? ''),
      price: Number(c.current_price ?? 0),
      change24h: Number(c.price_change_percentage_24h ?? 0),
      sparkline: Array.isArray(c.sparkline_in_7d?.price) ? c.sparkline_in_7d.price : [],
    }));
  } catch {
    return [];
  }
}

export function timeAgo(ts: number): string {
  if (!ts) return '';
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function formatPrice(p: number): string {
  if (p >= 1000) return `$${p.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if (p >= 1) return `$${p.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  return `$${p.toLocaleString('en-US', { maximumFractionDigits: 6 })}`;
}
