import 'dotenv/config';

import { createRenderWorker, renderQueueConfigured } from '../services/renderQueue.js';

const workerId = process.env.RAILWAY_REPLICA_ID || process.env.RENDER_WORKER_ID || process.pid;
const shadowMode = String(process.env.RENDER_WORKER_SHADOW_MODE || 'true').toLowerCase() !== 'false';

function log(message, meta = null) {
  console.log(`[render-worker:${workerId}] ${message}${meta ? ` ${JSON.stringify(meta)}` : ''}`);
}

if (!renderQueueConfigured()) {
  throw new Error('Render worker baslatilamadi: RENDER_QUEUE_ENABLED=true ve REDIS_URL gerekli.');
}

// Shadow mode proves Redis delivery and the durable payload contract before
// moving Manim/FFmpeg out of server.js. It is intentionally not production
// execution yet; the API fallback remains authoritative until the cutover.
const worker = createRenderWorker(async (task) => {
  if (!shadowMode) {
    throw new Error('Render worker executor henuz etkinlestirilmedi; API fallback korunuyor.');
  }
  log('Shadow render task dogrulandi', {
    appJobId: task.appJobId,
    lessonId: task.lessonId,
    segmentId: task.segmentId,
    segmentIndex: task.segmentIndex,
    hasAudioStoragePath: Boolean(task.audioStoragePath),
    hasManimCodeStoragePath: Boolean(task.manimCodeStoragePath)
  });
  return { mode: 'shadow', workerId, receivedAt: new Date().toISOString() };
}, { concurrency: 1 });

worker.on('completed', (job) => log('Task tamamlandi', { queueJobId: job.id, name: job.name }));
worker.on('failed', (job, error) => log('Task hata verdi', { queueJobId: job?.id, error: error.message }));
worker.on('error', (error) => log('Queue baglanti hatasi', { error: error.message }));

log('Worker basladi', { queue: 'kara-render-segments', shadowMode, concurrency: 1 });
