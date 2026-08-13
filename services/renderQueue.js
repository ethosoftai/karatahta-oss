import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

export const RENDER_QUEUE_NAME = 'kara-render-segments';
let sharedConnection = null;
let sharedQueue = null;

function configuredRedisUrl(env = process.env) {
  return String(env.REDIS_URL || env.RENDER_QUEUE_REDIS_URL || '').trim();
}

export function renderQueueConfigured(env = process.env) {
  return String(env.RENDER_QUEUE_ENABLED || 'false').toLowerCase() === 'true'
    && Boolean(configuredRedisUrl(env));
}

export function createRenderQueueConnection({ redisUrl = configuredRedisUrl() } = {}) {
  if (!redisUrl) throw new Error('Render kuyrugu icin REDIS_URL gerekli.');
  return new IORedis(redisUrl, { maxRetriesPerRequest: null });
}

export function createRenderQueue({ connection } = {}) {
  const resolvedConnection = connection || (sharedConnection ||= createRenderQueueConnection());
  if (!connection && sharedQueue) return sharedQueue;
  const queue = new Queue(RENDER_QUEUE_NAME, { connection: resolvedConnection });
  if (!connection) sharedQueue = queue;
  return queue;
}

export function normalizeRenderTask(task = {}) {
  const appJobId = String(task.appJobId || '').trim();
  const lessonId = String(task.lessonId || '').trim();
  const segmentId = String(task.segmentId || '').trim();
  const segmentIndex = Number(task.segmentIndex);
  if (!appJobId || !lessonId || !segmentId || !Number.isInteger(segmentIndex) || segmentIndex < 0) {
    throw new Error('Render task appJobId, lessonId, segmentId ve segmentIndex gerektirir.');
  }
  return {
    appJobId,
    lessonId,
    segmentId,
    segmentIndex,
    requestedAt: task.requestedAt || new Date().toISOString(),
    // Worker payloads may only refer to durable Bucket data, never /renders.
    manimCodeStoragePath: task.manimCodeStoragePath || null,
    audioStoragePath: task.audioStoragePath || null,
    metadata: task.metadata || null
  };
}

export async function enqueueRenderTask(task, { queue = null } = {}) {
  const payload = normalizeRenderTask(task);
  return (queue || createRenderQueue()).add('render-segment', payload, {
    jobId: `${payload.appJobId}:${payload.segmentIndex}`,
    attempts: 1,
    removeOnComplete: { age: 24 * 60 * 60 },
    removeOnFail: { age: 7 * 24 * 60 * 60 }
  });
}

export function createRenderWorker(processor, { connection = createRenderQueueConnection(), concurrency = 1 } = {}) {
  if (typeof processor !== 'function') throw new Error('Render worker processor gerekli.');
  return new Worker(RENDER_QUEUE_NAME, async (job) => processor(normalizeRenderTask(job.data), job), {
    connection,
    concurrency: Math.max(1, Math.floor(Number(concurrency) || 1))
  });
}
