import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildKaraTools,
  extractKaraToolResponse,
  runKaraTools
} from '../services/karaTools.js';

const frame = {
  mimeType: 'image/jpeg',
  data: Buffer.from('frame').toString('base64')
};

test('Kara normal function calling içinde web_search ve generate_manim araçlarını bildirir', () => {
  const tools = buildKaraTools();
  assert.deepEqual(
    tools[0].functionDeclarations.map((tool) => tool.name),
    ['web_search', 'generate_manim']
  );
});

test('web_search kararı normal function calling ile alınır ve arama ayrı istekte çalışır', async () => {
  const requests = [];
  const result = await runKaraTools({
    apiKey: 'test-key',
    models: ['gemini-3.5-flash-lite'],
    prompt: 'Bugünkü gelişmeyi araştır.',
    frame,
    executeWebSearch: async (query) => ({
      query,
      provider: 'test_search',
      results: [{ title: 'Haber', url: 'https://example.com/news', snippet: 'Arama özeti' }]
    }),
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      if (requests.length === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { id: 'search-1', name: 'web_search', args: { query: 'güncel gelişme' } } }] } }] })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ candidates: [{ content: { parts: [{ text: 'Kaynağa göre güncel cevap.' }] } }] })
      };
    }
  });
  assert.equal(result.answer, 'Kaynağa göre güncel cevap.');
  assert.deepEqual(result.toolsUsed, ['web_search']);
  assert.equal(result.sources[0].url, 'https://example.com/news');
  assert.deepEqual(requests[0].tools[0].functionDeclarations.map((tool) => tool.name), ['web_search', 'generate_manim']);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].contents[2].parts[0].functionResponse.response.provider, 'test_search');
});

test('Kara grounded web kaynaklarını güvenli link listesine dönüştürür', () => {
  const parsed = extractKaraToolResponse({
    candidates: [{
      content: { parts: [{ text: 'Güncel cevap.' }] },
      groundingMetadata: {
        webSearchQueries: ['güncel konu'],
        groundingChunks: [{ web: { uri: 'https://example.com/a', title: 'Kaynak A' } }]
      }
    }]
  });
  assert.equal(parsed.webSearchUsed, true);
  assert.deepEqual(parsed.sources, [{ url: 'https://example.com/a', title: 'Kaynak A' }]);
});

test('generate_manim çağrısını çalıştırır, görseli ikinci turda modele verir ve artifact döndürür', async () => {
  const requests = [];
  const result = await runKaraTools({
    apiKey: 'test-key',
    models: ['gemini-3.5-flash-lite'],
    prompt: 'Bir üçgen çiz.',
    frame,
    executeGenerateManim: async (args) => ({
      mimeType: 'image/png',
      data: Buffer.from('png').toString('base64'),
      url: 'https://cdn.example.com/manim.png',
      title: args.title
    }),
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      if (requests.length === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{
              content: {
                role: 'model',
                parts: [{
                  functionCall: {
                    id: 'call-1',
                    name: 'generate_manim',
                    args: { title: 'Üçgen', visual_description: 'Bir üçgen', teaching_point: 'Üç kenar' }
                  },
                  thoughtSignature: 'signed'
                }]
              }
            }]
          })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ candidates: [{ content: { parts: [{ text: 'Üçgenin üç kenarı görselde vurgulandı.' }] } }] })
      };
    }
  });
  assert.equal(result.answer, 'Üçgenin üç kenarı görselde vurgulandı.');
  assert.deepEqual(result.toolsUsed, ['generate_manim']);
  assert.equal(result.artifacts[0].url, 'https://cdn.example.com/manim.png');
  assert.equal(requests[1].contents[2].parts[0].functionResponse.id, 'call-1');
  assert.equal(requests[1].contents[2].parts[1].inlineData.mimeType, 'image/png');
});

test('ilk tool modeli kota verirse sıradaki Gemini 3 modeline geçer', async () => {
  const calls = [];
  const result = await runKaraTools({
    apiKey: 'test-key',
    models: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'],
    prompt: 'Açıkla',
    frame,
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.includes('gemini-3.5-flash-lite')) {
        return {
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          json: async () => ({ error: { status: 'RESOURCE_EXHAUSTED', message: 'model rate limit' } })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ candidates: [{ content: { parts: [{ text: 'İkinci model cevapladı.' }] } }] })
      };
    }
  });
  assert.equal(result.model, 'gemini-3.1-flash-lite');
  assert.equal(calls.length, 2);
});
