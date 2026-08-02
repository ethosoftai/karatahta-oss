import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTtsOptions } from '../services/ttsOptions.js';

test('gecerli ses ve seviye degerlerini oldugu gibi kabul eder', () => {
  const result = parseTtsOptions({
    tts_voice: 'tr-TR-EmelNeural',
    speech_volume: 1.5,
    background_music_volume: 0.2
  });
  assert.equal(result.voice, 'tr-TR-EmelNeural');
  assert.equal(result.speechVolume, 1.5);
  assert.equal(result.musicVolume, 0.2);
});

test('taninmayan ses adini reddeder', () => {
  const result = parseTtsOptions({ tts_voice: 'en-US-GuyNeural' });
  assert.equal(result.voice, null);
});

test('gonderilmeyen degerler icin null doner', () => {
  const result = parseTtsOptions({});
  assert.equal(result.voice, null);
  assert.equal(result.speechVolume, null);
  assert.equal(result.musicVolume, null);
});

test('ses seviyelerini izin verilen araliga kirpiyor', () => {
  const result = parseTtsOptions({ speech_volume: 99, background_music_volume: -5 });
  assert.equal(result.speechVolume, 2);
  assert.equal(result.musicVolume, 0);
});

test('sayisal olmayan seviye degerleri icin null doner', () => {
  const result = parseTtsOptions({ speech_volume: 'yuksek' });
  assert.equal(result.speechVolume, null);
});
