import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendPartialMetadata,
  createJobEventChannel,
  createProgressiveState,
  waitForClosedMp4
} from '../services/progressiveManim.js';

test('progressive partiallar sirali eklenir ve tekrarlar atlanir', () => {
  const state = createProgressiveState({ enabled: true, bufferTargetSeconds: 6 });
  assert.equal(appendPartialMetadata(state, {
    id: 'p0',
    sequence: 0,
    durationSeconds: 3
  }), true);
  assert.equal(appendPartialMetadata(state, {
    id: 'p0',
    sequence: 0,
    durationSeconds: 3
  }), false);
  assert.equal(state.readyCount, 1);
  assert.throws(() => appendPartialMetadata(state, {
    id: 'p2',
    sequence: 2,
    durationSeconds: 3
  }), /sirasi bozuk/);
  assert.equal(appendPartialMetadata(state, {
    id: 'p1',
    sequence: 1,
    durationSeconds: 3.2
  }), true);
  assert.equal(state.status, 'ready');
  assert.ok(state.playbackReadyAt);
});

test('feature flag kapaliyken partial legacy statei degistirmez', () => {
  const state = createProgressiveState({ enabled: false });
  assert.equal(appendPartialMetadata(state, {
    id: 'p0',
    sequence: 0,
    durationSeconds: 3
  }), false);
  assert.deepEqual(state.partials, []);
  assert.equal(state.status, 'disabled');
});

test('SSE event kanali reconnect sirasinda kacirilan olaylari tekrarlar', () => {
  const channel = createJobEventChannel();
  channel.emit('job', { status: 'running' });
  channel.emit('partial', { sequence: 0 });
  const received = [];
  const unsubscribe = channel.subscribe((event) => received.push(event), 1);
  channel.emit('partial', { sequence: 1 });
  unsubscribe();
  assert.deepEqual(received.map((event) => event.id), [2, 3]);
});

test('yarim veya ffprobe tarafindan reddedilen MP4 yayinlanmaz', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kara-partial-'));
  const filePath = path.join(tempDir, 'partial.mp4');
  await fs.writeFile(filePath, 'not-an-mp4');
  await assert.rejects(
    waitForClosedMp4(filePath, {
      validate: async () => false,
      checks: 1,
      intervalMs: 1,
      maxAttempts: 3
    }),
    /gecersiz/
  );
  await fs.rm(tempDir, { recursive: true, force: true });
});

