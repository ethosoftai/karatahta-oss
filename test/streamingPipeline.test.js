import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPlannedSpeech,
  resolveStreamingSegmentCount
} from '../services/streamingPipeline.js';

test('kısa videolarda kullanıcının istediği segment sayısını korur', () => {
  assert.equal(resolveStreamingSegmentCount({
    targetMinutes: 2,
    requestedSegmentCount: 2
  }), 2);
});

test('sekiz-on dakikalık dersleri sekiz ana segmentte tutar', () => {
  assert.equal(resolveStreamingSegmentCount({
    targetMinutes: 10,
    requestedSegmentCount: 15
  }), 8);
  assert.equal(resolveStreamingSegmentCount({
    targetMinutes: 8,
    requestedSegmentCount: 4
  }), 8);
});

test('plan anlatımından kısa TTS metni ve eşit dağılmış senkron ipuçları üretir', () => {
  const speech = buildPlannedSpeech({
    id: 's1',
    duration_seconds: 18,
    narration: 'Bir aracın hız göstergesini düşün. Gösterge bize yolculuğun ortalamasını değil tam o andaki değişimi söyler.',
    animation: {
      sequence: ['Arabayı göster', 'Hız göstergesini büyüt', 'Anlık değişimi vurgula']
    }
  }, { maxDurationSeconds: 22 });

  assert.equal(speech.source, 'plan');
  assert.equal(speech.cue_plan.length, 3);
  assert.deepEqual(speech.cue_plan.map((cue) => cue.at_percent), [17, 50, 83]);
  assert.ok(speech.estimated_seconds <= 22);
});

test('çok uzun plan anlatımını yayın süresi kelime bütçesine indirir', () => {
  const narration = Array.from({ length: 100 }, (_, index) => `kelime${index}`).join(' ');
  const speech = buildPlannedSpeech({
    id: 's1',
    duration_seconds: 60,
    narration,
    animation: { description: 'Ana fikri göster' }
  }, { maxDurationSeconds: 20 });

  assert.ok(speech.speech_text.split(/\s+/).length <= 47);
  assert.equal(speech.estimated_seconds, 20);
});

test('uzun ana segmentlerde anlatımı doksan saniyeye kadar korur', () => {
  const narration = Array.from({ length: 180 }, (_, index) => `kelime${index}`).join(' ');
  const speech = buildPlannedSpeech({
    id: 's1',
    duration_seconds: 75,
    narration,
    animation: { sequence: ['Giriş', 'Model', 'Örnek', 'Sonuç'] }
  }, { maxDurationSeconds: 85 });

  assert.ok(speech.speech_text.split(/\s+/).length > 100);
  assert.ok(speech.estimated_seconds >= 75);
  assert.ok(speech.estimated_seconds <= 85);
});
