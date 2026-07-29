import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAvailableGeminiModelRoute,
  buildGeminiModelRoute,
  isGeminiFailoverError,
  markGeminiModelFailure,
  resetGeminiModelCooldowns,
  runGeminiModelRoute
} from '../services/geminiRouter.js';

test('model rotasi birincil modeli basa alir ve tekrarları temizler', () => {
  assert.deepEqual(
    buildGeminiModelRoute('gemini-a', ['gemini-b', 'gemini-a', 'gemini-c']),
    ['gemini-a', 'gemini-b', 'gemini-c']
  );
});

test('429 kota hatasinda siradaki modele gecer', async () => {
  resetGeminiModelCooldowns();
  const attempts = [];
  const result = await runGeminiModelRoute({
    primaryModel: 'gemini-a',
    fallbackModels: ['gemini-b'],
    generate: async (model) => {
      attempts.push(model);
      if (model === 'gemini-a') {
        const error = new Error('RESOURCE_EXHAUSTED: quota exceeded');
        error.status = 429;
        throw error;
      }
      return { text: 'ok' };
    }
  });

  assert.deepEqual(attempts, ['gemini-a', 'gemini-b']);
  assert.equal(result.model, 'gemini-b');
  assert.equal(result.response.text, 'ok');
});

test('kota hatası alan modeli sonraki isteklerde cooldown süresince atlar', () => {
  resetGeminiModelCooldowns();
  const error = new Error('RESOURCE_EXHAUSTED: quota exceeded');
  error.status = 429;
  markGeminiModelFailure('gemini-a', error, 1000);

  assert.deepEqual(
    buildAvailableGeminiModelRoute('gemini-a', ['gemini-b'], 2000),
    ['gemini-b']
  );
  assert.deepEqual(
    buildAvailableGeminiModelRoute('gemini-a', ['gemini-b'], 700000),
    ['gemini-a', 'gemini-b']
  );
  resetGeminiModelCooldowns();
});

test('404 ve 503 model erisilebilirlik hatalari fallback icin uygundur', () => {
  assert.equal(isGeminiFailoverError({ status: 404 }), true);
  assert.equal(isGeminiFailoverError({ code: 503 }), true);
  assert.equal(isGeminiFailoverError(new Error('model is no longer available')), true);
});

test('gecersiz istek hatasinda baska modele gecmez', async () => {
  resetGeminiModelCooldowns();
  const attempts = [];
  await assert.rejects(
    runGeminiModelRoute({
      primaryModel: 'gemini-a',
      fallbackModels: ['gemini-b'],
      generate: async (model) => {
        attempts.push(model);
        const error = new Error('Invalid request payload');
        error.status = 400;
        throw error;
      }
    }),
    /Invalid request payload/
  );
  assert.deepEqual(attempts, ['gemini-a']);
});
