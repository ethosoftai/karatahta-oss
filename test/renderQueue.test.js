import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueueRenderTask, normalizeRenderTask, renderQueueConfigured } from '../services/renderQueue.js';

test('render task yalniz kalici kimlik ve storage referanslariyla normalize edilir', () => {
  const task = normalizeRenderTask({
    appJobId: 'job-1', lessonId: 'lesson-1', segmentId: 's1', segmentIndex: 0,
    workerJobId: 'worker-job-1',
    audioStoragePath: 'railway://audio/u/l/s1.mp3'
  });
  assert.equal(task.segmentIndex, 0);
  assert.equal(task.audioStoragePath, 'railway://audio/u/l/s1.mp3');
  assert.equal(task.workerJobId, 'worker-job-1');
});

test('eksik render task kimliklerini reddeder', () => {
  assert.throws(() => normalizeRenderTask({ appJobId: 'job-1' }), /segmentId/);
});

test('queue feature flag ve Redis URL birlikte ister', () => {
  assert.equal(renderQueueConfigured({ RENDER_QUEUE_ENABLED: 'true' }), false);
  assert.equal(renderQueueConfigured({ RENDER_QUEUE_ENABLED: 'true', REDIS_URL: 'redis://localhost:6379' }), true);
});

test('BullMQ uyumlu custom job ID iki nokta icermez', async () => {
  const calls = [];
  const queue = { add: async (...args) => { calls.push(args); return { id: args[2].jobId }; } };
  const result = await enqueueRenderTask({
    appJobId: 'job:1', lessonId: 'lesson-1', segmentId: 's1', segmentIndex: 2
  }, { queue });
  assert.equal(calls[0][2].jobId, 'am9iOjE--segment-2');
  assert.equal(result.id, 'am9iOjE--segment-2');
});
