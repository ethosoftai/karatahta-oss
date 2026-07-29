import test from 'node:test';
import assert from 'node:assert/strict';

import { buildLiveManimStartMessage } from '../services/liveManimStream.js';

test('canlı Manim varsayılan olarak beş saniyelik MP4 fragmentleri ister', () => {
  const message = buildLiveManimStartMessage();

  assert.equal(message.type, 'start');
  assert.equal(message.fragment_seconds, 5);
  assert.equal(message.fps, 20);
});

test('canlı Manim fragment süresini worker mesajına aktarır', () => {
  const message = buildLiveManimStartMessage({
    fragmentSeconds: 7,
    fps: 24
  });

  assert.equal(message.fragment_seconds, 7);
  assert.equal(message.fps, 24);
});
