import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimedSubtitleSrt, calculateVideoStretchFactor } from '../services/videoPostprocess.js';

test('video süresini ses süresine eşitleyen katsayıyı hesaplar', () => {
  assert.equal(calculateVideoStretchFactor(72.966667, 91.536), 91.536 / 72.966667);
});

test('konuşma metnini tüm ses süresine yayılan SRT bloklarına dönüştürür', () => {
  const srt = buildTimedSubtitleSrt('Kara delikler oluşur. Işık bile kaçamaz.', 10, 4);
  assert.match(srt, /00:00:00,000 -->/);
  assert.match(srt, /--> 00:00:10,000/);
  assert.match(srt, /Kara delikler/);
  assert.match(srt, /Işık bile/);
});

test('geçersiz süreleri reddeder', () => {
  assert.throws(() => calculateVideoStretchFactor(0, 10), /pozitif/);
});
