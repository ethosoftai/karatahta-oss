import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPlannedSpeech,
  resolveStreamingSegmentCount
} from '../services/streamingPipeline.js';

test('iki dakikalık planı yaklaşık yirmi saniyelik yayın segmentlerine böler', () => {
  assert.equal(resolveStreamingSegmentCount({
    targetMinutes: 2,
    requestedSegmentCount: 2,
    targetSegmentSeconds: 20
  }), 6);
});

test('uzun derslerde segment sayısını istenen sayının üç katıyla sınırlar', () => {
  assert.equal(resolveStreamingSegmentCount({
    targetMinutes: 10,
    requestedSegmentCount: 8,
    targetSegmentSeconds: 20
  }), 24);
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
