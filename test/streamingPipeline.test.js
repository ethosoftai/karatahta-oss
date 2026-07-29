import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPlannedSpeech,
  resolveStreamingSegmentCount,
  resolveStreamingSegmentDurations
} from '../services/streamingPipeline.js';

test('iki dakikalık dersi yaklaşık otuz saniyelik dört mantıksal segmente böler', () => {
  assert.equal(resolveStreamingSegmentCount({
    targetMinutes: 2,
    requestedSegmentCount: 2
  }), 4);
});

test('segment sayısını video süresi ve üretim bütçesinden otomatik hesaplar', () => {
  assert.equal(resolveStreamingSegmentCount({
    targetMinutes: 10,
    requestedSegmentCount: 8
  }), 20);
  assert.equal(resolveStreamingSegmentCount({
    targetMinutes: 2,
    estimatedProductionSeconds: 25
  }), 3);
});

test('ilk segmenti hızlı başlangıç için kısa, kalanları yaklaşık otuz saniye tutar', () => {
  const durations = resolveStreamingSegmentDurations({
    targetMinutes: 2,
    segmentCount: 4
  });
  assert.deepEqual(durations, [20, 33.3, 33.3, 33.4]);
  assert.equal(Number(durations.reduce((sum, value) => sum + value, 0).toFixed(1)), 120);
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
