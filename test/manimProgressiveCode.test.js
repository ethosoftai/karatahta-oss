import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fitManimTimingToDuration,
  optimizeManimForProgressiveRender
} from '../services/manimProgressiveCode.js';

test('LLM Manim zamanlamasini gercek ses suresine orantilar', () => {
  const code = `        self.play(Write(title))
        self.play(Transform(a, b), run_time=2)
        self.wait(1)`;
  const fitted = fitManimTimingToDuration(code, 8);
  assert.match(fitted, /self\.play\(Write\(title\), run_time=2\)/);
  assert.match(fitted, /run_time=4/);
  assert.match(fitted, /self\.wait\(2\)/);
});

test('sahneler arasi wait cagrisini olcek faktoruyle sisirmez, fazla sureyi play a aktarir', () => {
  const code = `        self.play(FadeIn(title))
        self.wait(2)
        self.play(FadeOut(title))
        self.wait(8)
        self.play(FadeIn(clock))`;
  const fitted = fitManimTimingToDuration(code, 75);
  const waitMatches = [...fitted.matchAll(/self\.wait\((\d+(?:\.\d+)?)\)/g)].map((m) => Number(m[1]));
  // Neither wait grew past its own original length -- the 8s pause stays an
  // 8s pause instead of ballooning into a multi-minute blank hold.
  assert.ok(waitMatches.every((seconds) => seconds <= 8));
  const playMatches = [...fitted.matchAll(/run_time=(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  // The time the waits didn't get was redistributed into the play() calls
  // instead, so segments stay visually active rather than sitting idle.
  assert.ok(playMatches.every((seconds) => seconds > 4));
});

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
