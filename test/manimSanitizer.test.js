import test from 'node:test';
import assert from 'node:assert/strict';
import {
  replaceGrowArrowWithCreate,
  replaceNaturalLanguageMathTex,
  sanitizeManimForLocalRender
} from '../services/manimSanitizer.js';

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

test('GrowArrow, Manim 0.20.1 scale_tips hatasindan kacinmak icin Create ile degistirilir', () => {
  const code = 'self.play(GrowArrow(arrows[0]))\nself.play(GrowArrow(arrows[1], point_color=RED))';
  assert.equal(
    replaceGrowArrowWithCreate(code),
    'self.play(Create(arrows[0]))\nself.play(Create(arrows[1]))'
  );
});

test('GrowArrow icinde nested Arrow() cagrisini da dogru donusturur', () => {
  const code = 'self.play(GrowArrow(Arrow(LEFT, RIGHT)))';
  assert.equal(
    replaceGrowArrowWithCreate(code),
    'self.play(Create(Arrow(LEFT, RIGHT)))'
  );
});

test('Türkçe doğal dil etiketini MathTex yerine Text ile render eder', () => {
  const code = 'label = MathTex(r"\\text{anlık hız}", color=YELLOW, font_size=28)';
  assert.equal(
    replaceNaturalLanguageMathTex(code, { font: 'Georgia' }),
    'label = Text("anlık hız", font="Georgia", color=YELLOW, font_size=28)'
  );
});
