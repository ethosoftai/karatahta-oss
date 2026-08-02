import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGeminiVisionRequest,
  buildKaraPrompt,
  extractGeminiText,
  generateKaraVisionAnswer,
  generateKaraVisionAnswerWithFallback,
  classifyKaraVisionError,
  parseKaraVisionModels,
  normalizeKaraFrame
} from '../services/karaVision.js';

const frame = {
  mimeType: 'image/jpeg',
  data: Buffer.from('fake jpeg bytes').toString('base64')
};

test('Kara video karesini data URL veya yalın base64 olarak normalize eder', () => {
  const normalized = normalizeKaraFrame({
    mimeType: frame.mimeType,
    data: `data:image/jpeg;base64,${frame.data}`
  });
  assert.equal(normalized.mimeType, 'image/jpeg');
  assert.equal(normalized.data, frame.data);
  assert.equal(normalized.byteLength, 15);
});

test('Kara yalnızca desteklenen ve boyutu güvenli kareleri kabul eder', () => {
  assert.throws(
    () => normalizeKaraFrame({ mimeType: 'image/svg+xml', data: frame.data }),
    /JPEG, PNG veya WebP/
  );
  assert.throws(
    () => normalizeKaraFrame(frame, { maxBytes: 2 }),
    /en fazla/
  );
});

test('Gemini isteği gerçek kareyi ve metin bağlamını birlikte taşır', () => {
  const normalized = normalizeKaraFrame(frame);
  const prompt = buildKaraPrompt({
    question: 'Bu ok neden sağa gidiyor?',
    timestampSeconds: 12.4,
    timestampLabel: '0:12',
    lessonTitle: 'Vektörler',
    frameAvailable: true
  });
  const body = buildGeminiVisionRequest({ prompt, frame: normalized });
  assert.equal(body.contents[0].parts[0].inline_data.data, frame.data);
  assert.match(body.contents[0].parts[1].text, /gercek kare/);
  assert.match(body.contents[0].parts[1].text, /Bu ok neden/);
  assert.match(body.contents[0].parts[1].text, /0:12/);
  assert.equal(body.generationConfig.thinkingConfig.thinkingBudget, 0);
});

test('Gemini 3 modellerine kaldırılan 2.5 sampling ve thinking ayarlarını göndermez', () => {
  const body = buildGeminiVisionRequest({
    prompt: 'Kareyi açıkla',
    frame: normalizeKaraFrame(frame),
    model: 'gemini-3.5-flash-lite'
  });
  assert.equal(body.generationConfig.temperature, undefined);
  assert.equal(body.generationConfig.thinkingConfig, undefined);
});

test('Gemini yanıtındaki metin parçalarını birleştirir', () => {
  assert.equal(extractGeminiText({
    candidates: [{ content: { parts: [{ text: 'Birinci ' }, { text: 'ikinci.' }] } }]
  }), 'Birinci ikinci.');
});

test('Gemini istemcisi görsel modeli ve API anahtarını doğru endpoint ile çağırır', async () => {
  let request;
  const answer = await generateKaraVisionAnswer({
    apiKey: 'test-key',
    model: 'gemini-2.5-flash',
    prompt: 'Kareyi açıkla',
    frame: normalizeKaraFrame(frame),
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        json: async () => ({ candidates: [{ content: { parts: [{ text: 'Karede bir üçgen var.' }] } }] })
      };
    }
  });
  assert.equal(answer, 'Karede bir üçgen var.');
  assert.match(request.url, /gemini-2\.5-flash:generateContent$/);
  assert.equal(request.options.headers['x-goog-api-key'], 'test-key');
  assert.equal(JSON.parse(request.options.body).contents[0].parts[0].inline_data.mime_type, 'image/jpeg');
});

test('Kara model listesini temizler, models/ önekini kaldırır ve tekrarları eler', () => {
  assert.deepEqual(
    parseKaraVisionModels('models/gemini-3.5-flash-lite, gemini-2.5-flash,gemini-2.5-flash'),
    ['gemini-3.5-flash-lite', 'gemini-2.5-flash']
  );
});

test('Model kotası dolunca sıradaki vision modeline geçer', async () => {
  const calls = [];
  const result = await generateKaraVisionAnswerWithFallback({
    apiKey: 'test-key',
    models: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'],
    prompt: 'Kareyi açıkla',
    frame: normalizeKaraFrame(frame),
    cooldowns: new Map(),
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.includes('gemini-3.5-flash-lite')) {
        return {
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          json: async () => ({ error: { status: 'RESOURCE_EXHAUSTED', message: 'model quota exceeded' } })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ candidates: [{ content: { parts: [{ text: 'İkinci model gördü.' }] } }] })
      };
    }
  });
  assert.equal(result.model, 'gemini-3.1-flash-lite');
  assert.deepEqual(result.attemptedModels, ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);
  assert.equal(calls.length, 2);
});

test('Proje kredisi bittiyse aynı anahtarla diğer Gemini modellerini boşuna denemez', async () => {
  let calls = 0;
  await assert.rejects(
    generateKaraVisionAnswerWithFallback({
      apiKey: 'test-key',
      models: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'],
      prompt: 'Kareyi açıkla',
      frame: normalizeKaraFrame(frame),
      cooldowns: new Map(),
      fetchImpl: async () => {
        calls += 1;
        return {
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          json: async () => ({ error: { status: 'RESOURCE_EXHAUSTED', message: 'Your prepayment credits are depleted.' } })
        };
      }
    }),
    (error) => error.karaVisionReason === 'project_access_or_credit'
  );
  assert.equal(calls, 1);
});

test('Gemini hata sınıflandırması geçici servis ve model erişim sorunlarını fallback yapar', () => {
  assert.equal(classifyKaraVisionError({ geminiStatus: 503, message: 'unavailable' }).failover, true);
  assert.equal(classifyKaraVisionError({ geminiStatus: 404, message: 'model not found' }).reason, 'model_unavailable');
});
