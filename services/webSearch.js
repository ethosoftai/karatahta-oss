const SEARCH_USER_AGENT = 'Mozilla/5.0 (compatible; KaraTahtaSearch/1.0; +https://karatahta.ethosoft.org)';

function decodeHtml(value) {
  return String(value || '')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function stripHtml(value) {
  return decodeHtml(String(value || '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function safeResultUrl(value, baseUrl) {
  try {
    const url = new URL(decodeHtml(value), baseUrl);
    if (url.hostname.endsWith('duckduckgo.com') && url.searchParams.get('uddg')) {
      return safeResultUrl(url.searchParams.get('uddg'));
    }
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.href;
  } catch {
    return '';
  }
}

export function parseDuckDuckGoResults(html, limit = 6) {
  const links = [...String(html || '').matchAll(
    /<a[^>]*class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  )];
  const snippets = [...String(html || '').matchAll(
    /<(?:a|div)[^>]*class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div)>/gi
  )].map((match) => stripHtml(match[1]));
  return links
    .map((match, index) => ({
      title: stripHtml(match[2]).slice(0, 240),
      url: safeResultUrl(match[1], 'https://html.duckduckgo.com'),
      snippet: String(snippets[index] || '').slice(0, 600)
    }))
    .filter((result) => result.title && result.url)
    .slice(0, limit);
}

export function parseBingRssResults(xml, limit = 6) {
  return [...String(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/gi)]
    .map((match) => {
      const item = match[1];
      const title = item.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '';
      const link = item.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || '';
      const description = item.match(/<description>([\s\S]*?)<\/description>/i)?.[1] || '';
      return {
        title: stripHtml(title).slice(0, 240),
        url: safeResultUrl(stripHtml(link)),
        snippet: stripHtml(description).slice(0, 600)
      };
    })
    .filter((result) => result.title && result.url)
    .slice(0, limit);
}

async function fetchSearchPage(url, { timeoutMs, fetchImpl }) {
  const response = await fetchImpl(url, {
    headers: {
      'user-agent': SEARCH_USER_AGENT,
      accept: 'text/html,application/rss+xml;q=0.9,*/*;q=0.8'
    },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) {
    throw new Error(`Arama saglayicisi HTTP ${response.status} dondurdu.`);
  }
  return response.text();
}

export async function searchWeb(query, {
  limit = 6,
  timeoutMs = 8000,
  fetchImpl = fetch
} = {}) {
  const cleanQuery = String(query || '').trim().replace(/\s+/g, ' ').slice(0, 300);
  if (!cleanQuery) {
    const error = new Error('Web aramasi icin sorgu gerekli.');
    error.statusCode = 400;
    throw error;
  }

  const providers = [
    {
      name: 'duckduckgo',
      url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(cleanQuery)}`,
      parse: parseDuckDuckGoResults
    },
    {
      name: 'bing_rss',
      url: `https://www.bing.com/search?format=rss&q=${encodeURIComponent(cleanQuery)}`,
      parse: parseBingRssResults
    }
  ];
  const errors = [];
  for (const provider of providers) {
    try {
      const body = await fetchSearchPage(provider.url, { timeoutMs, fetchImpl });
      const results = provider.parse(body, limit);
      if (results.length) {
        return { query: cleanQuery, provider: provider.name, results };
      }
      errors.push(`${provider.name}: sonuc yok`);
    } catch (error) {
      errors.push(`${provider.name}: ${error.message}`);
    }
  }
  const error = new Error(`Web aramasi tamamlanamadi. ${errors.join('; ')}`);
  error.statusCode = 502;
  throw error;
}
