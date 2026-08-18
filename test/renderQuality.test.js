import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertStandardVideoProbe,
  DEFAULT_MANIM_FONT,
  DEFAULT_MANIM_QUALITY,
  resolveManimFont,
  resolveManimQuality,
  resolveVideoDimensions,
  resolveVideoOrientation
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

test('gecersiz orientation yataya duser', () => {
  assert.equal(resolveVideoOrientation('vertical'), 'vertical');
  assert.equal(resolveVideoOrientation('horizontal'), 'horizontal');
  assert.equal(resolveVideoOrientation('wat'), 'horizontal');
  assert.equal(resolveVideoOrientation(undefined), 'horizontal');
});

test('dikey boyutlar 9:16, yatay boyutlar 16:9 olur', () => {
  assert.deepEqual(resolveVideoDimensions('vertical'), { width: 720, height: 1280 });
  assert.deepEqual(resolveVideoDimensions('horizontal'), { width: 1280, height: 720 });
});

test('video probu ozel beklenen boyuta gore dogrulanabilir (dikey Shorts)', () => {
  assert.doesNotThrow(() => assertStandardVideoProbe({
    width: 720,
    height: 1280,
    fps: 30,
    codec: 'h264'
  }, 'shorts test video', { width: 720, height: 1280 }));
  assert.throws(() => assertStandardVideoProbe({
    width: 1280,
    height: 720,
    fps: 30,
    codec: 'h264'
  }, 'shorts test video', { width: 720, height: 1280 }));
});
