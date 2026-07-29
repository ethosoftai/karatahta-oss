import test from 'node:test';
import assert from 'node:assert/strict';

import { buildLiveManimStartMessage } from '../services/liveManimStream.js';

test('ağ fragmentini kullanıcı segmentinden bağımsız olarak bir saniye tutar', () => {
  const message = buildLiveManimStartMessage();

  assert.equal(message.type, 'start');
  assert.equal(message.fragment_seconds, 1);
  assert.equal(message.fps, 60);
  assert.equal(message.crf, 20);
  assert.equal(message.preset, 'veryfast');
});

test('canlı Manim fragment süresini worker mesajına aktarır', () => {
  const message = buildLiveManimStartMessage({
    fragmentSeconds: 3,
    fps: 24
  });

  assert.equal(message.fragment_seconds, 3);
  assert.equal(message.fps, 24);
});
