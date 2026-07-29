import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeManimForLocalRender } from '../services/manimSanitizer.js';

test('Manim expo_out fonksiyonunu v0.20.1 uyumlu fonksiyona dönüştürür', () => {
  const code = 'self.play(FadeOut(obj), rate_func=expo_out)';
  assert.equal(
    sanitizeManimForLocalRender(code, { font: 'Noto Sans', mathTexAvailable: true }),
    'self.play(FadeOut(obj), rate_func=rate_functions.ease_out_expo)'
  );
});

test('Yalnızca bağımsız expo_out sembolünü değiştirir', () => {
  const code = 'label = "expo_out"\nrate_func=my_expo_out';
  assert.equal(sanitizeManimForLocalRender(code), code);
});
