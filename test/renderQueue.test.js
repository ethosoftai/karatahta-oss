import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRenderTask, renderQueueConfigured } from '../services/renderQueue.js';

test('render task yalniz kalici kimlik ve storage referanslariyla normalize edilir', () => {
  const task = normalizeRenderTask({
    appJobId: 'job-1', lessonId: 'lesson-1', segmentId: 's1', segmentIndex: 0,
    audioStoragePath: 'railway://audio/u/l/s1.mp3'
  });
  assert.equal(task.segmentIndex, 0);
  assert.equal(task.audioStoragePath, 'railway://audio/u/l/s1.mp3');
});

test('eksik render task kimliklerini reddeder', () => {
  assert.throws(() => normalizeRenderTask({ appJobId: 'job-1' }), /segmentId/);
});

test('queue feature flag ve Redis URL birlikte ister', () => {
  assert.equal(renderQueueConfigured({ RENDER_QUEUE_ENABLED: 'true' }), false);
  assert.equal(renderQueueConfigured({ RENDER_QUEUE_ENABLED: 'true', REDIS_URL: 'redis://localhost:6379' }), true);
});
