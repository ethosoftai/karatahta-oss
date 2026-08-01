import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendPartialMetadata,
  createJobEventChannel,
  createProgressiveState,
  ManimPartialCollector,
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

test('tampon kapaliyken ilk gercek partial oynatmaya hazirdir', () => {
  const state = createProgressiveState({ enabled: true, bufferTargetSeconds: 0 });
  assert.equal(state.status, 'waiting');
  appendPartialMetadata(state, {
    id: 'p0',
    sequence: 0,
    durationSeconds: 0.5
  });
  assert.equal(state.status, 'ready');
  assert.ok(state.playbackReadyAt);
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

test('mikro Manim parcalari hedef sureli yayin bloklarinda gruplanir', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kara-partial-batch-'));
  const partialDir = path.join(tempDir, 'videos', 'partial_movie_files', 'Scene');
  await fs.mkdir(partialDir, { recursive: true });
  const durations = new Map([
    ['a.mp4', 3],
    ['b.mp4', 3.2],
    ['c.mp4', 1.5]
  ]);
  for (const name of durations.keys()) {
    await fs.writeFile(path.join(partialDir, name), name);
  }
  const published = [];
  const collector = new ManimPartialCollector({
    mediaDir: tempDir,
    validate: async () => true,
    measureDuration: async (filePath) => durations.get(path.basename(filePath)),
    batchTargetSeconds: 6,
    normalize: async (filePaths, sequence) => ({
      sequence,
      files: filePaths.map((filePath) => path.basename(filePath))
    }),
    onPartial: async (partial) => published.push(partial),
    pollIntervalMs: 10
  });
  collector.start();
  await collector.finish();
  assert.deepEqual(published, [
    { sequence: 0, files: ['a.mp4', 'b.mp4'] },
    { sequence: 1, files: ['c.mp4'] }
  ]);
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('collector tarama hatasini unhandled rejection yerine finish uzerinden bildirir', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kara-partial-error-'));
  const filePath = path.join(tempDir, 'not-a-directory');
  await fs.writeFile(filePath, 'x');
  const collector = new ManimPartialCollector({
    mediaDir: filePath,
    validate: async () => true,
    normalize: async () => ({}),
    onPartial: async () => {},
    pollIntervalMs: 1
  });
  collector.start();
  await assert.rejects(collector.finish(), /ENOTDIR/);
  await fs.rm(tempDir, { recursive: true, force: true });
});
