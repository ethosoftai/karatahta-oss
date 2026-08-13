import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertStandardVideoProbe,
  DEFAULT_MANIM_FONT,
  DEFAULT_MANIM_QUALITY,
  resolveManimFont,
  resolveManimQuality
} from '../services/renderQuality.js';

test('gecersiz manim kalitesi varsayilan kaliteye duser', () => {
  assert.equal(resolveManimQuality('wat'), DEFAULT_MANIM_QUALITY);
  assert.equal(resolveManimQuality('-qh'), '-qh');
});

test('bos font varsayilan fontu dondurur', () => {
  assert.equal(resolveManimFont('   '), DEFAULT_MANIM_FONT);
  assert.equal(resolveManimFont('DejaVu Sans'), 'DejaVu Sans');
});

test("standart video probu beklenen cozunurlugu ve fps'i ister", () => {
  assert.doesNotThrow(() => assertStandardVideoProbe({
    width: 1280,
    height: 720,
    fps: 30,
    codec: 'h264'
  }, 'test video'));
  assert.throws(() => assertStandardVideoProbe({
    width: 1920,
    height: 1080,
    fps: 30,
    codec: 'h264'
  }, 'test video'));
});
