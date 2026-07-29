import test from 'node:test';
import assert from 'node:assert/strict';

import { compactChatHistory, compactLessonPlanContext } from '../services/karaContext.js';

test('Kara sohbet geçmişini son altı kısa mesaja indirger', () => {
  const history = Array.from({ length: 8 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    timestamp: `0:0${index}`,
    content: `${index}-${'x'.repeat(1500)}`
  }));
  const compact = compactChatHistory(history);
  assert.equal(compact.length, 6);
  assert.match(compact[0].content, /^2-/);
  assert.equal(compact[0].content.length, 1200);
});

test('Kara ders planından yalnızca gerekli kısa bağlamı üretir', () => {
  const compact = compactLessonPlanContext({
    topic: 'Türev',
    core_insight: 'Değişim oranı',
    segments: Array.from({ length: 12 }, (_, index) => ({
      id: `s${index}`,
      title: `Segment ${index}`,
      learning_objective: 'Amaç',
      narration: 'n'.repeat(500)
    }))
  });
  assert.equal(compact.segments.length, 10);
  assert.equal(compact.segments[0].narration.length, 320);
});
