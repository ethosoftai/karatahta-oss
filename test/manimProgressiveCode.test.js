import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildProgressiveRecoveryScene,
  optimizeManimForProgressiveRender
} from '../services/manimProgressiveCode.js';

test('uzun play suresini kuculturken toplam sureyi wait parcalariyla korur', () => {
  const code = `class Demo(Scene):
    def construct(self):
        self.play(
            Transform(circle, square),
            run_time=17
        )
        self.play(FadeOut(square), run_time=2)`;
  const optimized = optimizeManimForProgressiveRender(code);
  assert.match(optimized, /run_time=5/);
  assert.match(optimized, /self\.wait\(3\)\n        self\.wait\(3\)\n        self\.wait\(3\)\n        self\.wait\(3\)/);
  assert.match(optimized, /run_time=2/);
});

test('uzun wait cagrisini ayni toplam surede parcalara ayirir', () => {
  const optimized = optimizeManimForProgressiveRender('        self.wait(8)');
  assert.equal(optimized, '        self.wait(3)\n        self.wait(3)\n        self.wait(2)');
});

test('yorumlari ve kisa cagirilari degistirmez', () => {
  const code = `        # self.wait(30)
        self.play(Write(Text("(test)")), run_time=4)
        self.wait(2)`;
  assert.equal(optimizeManimForProgressiveRender(code), code);
});

test('yarida kalan render icin kisa parcalara ayrilmis devam sahnesi kurar', () => {
  const code = buildProgressiveRecoveryScene({
    segmentId: 's-2',
    speechText: 'Türev bir fonksiyonun anlık değişim hızını açıklar ve teğet eğimiyle görselleştirilir.',
    durationSeconds: 8.5,
    font: 'Noto Sans'
  });
  assert.match(code, /class Seg_s_2_Recovery\(Scene\)/);
  assert.match(code, /font="Noto Sans"/);
  assert.match(code, /run_time=1\.5/);
  assert.match(code, /self\.wait\(3\)\n        self\.wait\(3\)\n        self\.wait\(1\)/);
});
