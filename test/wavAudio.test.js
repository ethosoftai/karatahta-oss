import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSilentWav } from '../services/wavAudio.js';

test('sekiz saniyelik mono PCM açılış sesi üretir', () => {
  const wav = buildSilentWav({ durationSeconds: 8 });

  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt32LE(24), 48000);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(40), 8 * 48000 * 2);
  assert.equal(wav.length, 44 + (8 * 48000 * 2));
});
