import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseBingRssResults,
  parseDuckDuckGoResults,
  searchWeb
} from '../services/webSearch.js';

test('DuckDuckGo HTML sonucunu başlık, gerçek URL ve özete dönüştürür', () => {
  const html = `<div class="result">
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fders">Örnek &amp; Ders</a>
    <a class="result__snippet">Kısa <b>arama</b> özeti.</a>
  </div>`;
  assert.deepEqual(parseDuckDuckGoResults(html), [{
    title: 'Örnek & Ders',
    url: 'https://example.com/ders',
    snippet: 'Kısa arama özeti.'
  }]);
});

test('Bing RSS sonucunu ayrıştırır', () => {
  const xml = `<rss><channel><item><title>Kaynak</title><link>https://example.org/a</link><description>Güncel özet</description></item></channel></rss>`;
  assert.deepEqual(parseBingRssResults(xml), [{
    title: 'Kaynak',
    url: 'https://example.org/a',
    snippet: 'Güncel özet'
  }]);
});

test('ilk arama sağlayıcısı hata verirse Bing RSS fallback çalışır', async () => {
  const calls = [];
  const result = await searchWeb('test sorgusu', {
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.includes('duckduckgo')) {
        return { ok: false, status: 503, text: async () => '' };
      }
      return {
        ok: true,
        status: 200,
        text: async () => '<item><title>Fallback</title><link>https://example.net/</link><description>Sonuç</description></item>'
      };
    }
  });
  assert.equal(result.provider, 'bing_rss');
  assert.equal(result.results[0].title, 'Fallback');
  assert.equal(calls.length, 2);
});
