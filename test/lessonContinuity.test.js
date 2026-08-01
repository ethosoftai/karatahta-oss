import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSegmentGenerationContext,
  normalizeLessonContinuity
} from '../services/lessonContinuity.js';

test('segmentleri acilis devam ve kapanis rolleriyle birbirine baglar', () => {
  const plan = normalizeLessonContinuity({
    topic: 'Turev',
    segments: [
      {
        id: 's1',
        title: 'Hiz',
        narration: 'Arabanin anlik hizina bakalim. Gostergedeki deger tam bu ani anlatir.',
        animation: { visual_end_state: 'Hiz gostergesi ve hareketli nokta ekranda.' }
      },
      {
        id: 's2',
        title: 'Eğim',
        narration: 'Bu ani grafigin uzerinde bir noktaya tasiyalim.',
        animation: { visual_end_state: 'Noktada teget cizgisi ekranda.' }
      },
      { id: 's3', title: 'Sonuc', narration: 'Boylece turevi yorumlayabiliriz.', animation: {} }
    ]
  });

  assert.equal(plan.segments[0].continuity.role, 'opening');
  assert.equal(plan.segments[1].continuity.role, 'continuation');
  assert.equal(plan.segments[1].continuity.previous_segment_id, 's1');
  assert.equal(plan.segments[1].continuity.visual_start_state, 'Hiz gostergesi ve hareketli nokta ekranda.');
  assert.match(plan.segments[1].continuity.previous_narration_tail, /tam bu ani/);
  assert.equal(plan.segments[2].continuity.role, 'closing');
  assert.equal(plan.segments[2].continuity.forbid_full_clear, false);
});

test('Manim uretimine onceki sahnenin bitis durumunu aktarir', () => {
  const plan = normalizeLessonContinuity({
    topic: 'Kuvvet',
    segments: [
      { id: 's1', title: 'Itme', narration: 'Kutuyu itiyoruz.', animation: { visual_end_state: 'Kutu sagda.' } },
      { id: 's2', title: 'Ivme', narration: 'Hareket hizlaniyor.', animation: {} }
    ]
  });
  const context = buildSegmentGenerationContext({
    plan,
    segment: plan.segments[1],
    index: 1,
    total: 2,
    previousManimCode: 'class Seg_s1(Scene):\n    pass'
  });
  assert.equal(context.lesson_topic, 'Kuvvet');
  assert.equal(context.previous_segment.visual_end_state, 'Kutu sagda.');
  assert.equal(context.current_segment.continuity.forbid_intro_reset, true);
  assert.match(context.previous_manim_code, /Seg_s1/);
});
