import 'dotenv/config';

import { createRenderWorker, renderQueueConfigured } from '../services/renderQueue.js';
import { createStorageSignedUrl, uploadLocalFile } from '../services/mediaStore.js';
import { storagePathFor } from '../services/supabaseStore.js';
import {
  getRenderWorkerInput,
  saveVideoRender,
  updateRenderWorkerJob
} from '../services/supabaseStore.js';
import { renderWorkerManimVideo } from '../services/workerManimRenderer.js';

const workerId = process.env.RAILWAY_REPLICA_ID || process.env.RENDER_WORKER_ID || process.pid;
const shadowMode = String(process.env.RENDER_WORKER_SHADOW_MODE || 'true').toLowerCase() !== 'false';

function log(message, meta = null) {
  console.log(`[render-worker:${workerId}] ${message}${meta ? ` ${JSON.stringify(meta)}` : ''}`);
}

if (!renderQueueConfigured()) {
  throw new Error('Render worker baslatilamadi: RENDER_QUEUE_ENABLED=true ve REDIS_URL gerekli.');
}

// The API continues to render authoritatively until the later finalizer/SSE
// cutover. Set shadow mode false only for isolated worker verification; that
// intentionally produces a second, Bucket-backed render for comparison.
const worker = createRenderWorker(async (task, queueJob) => {
  if (shadowMode) {
    if (task.workerJobId) {
      await updateRenderWorkerJob({
        id: task.workerJobId,
        status: 'done',
        workerId,
        attempt: Number(queueJob.attemptsStarted || 0),
        queueJobId: String(queueJob.id),
        output: { mode: 'shadow', receivedAt: new Date().toISOString() }
      });
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
  }
  if (!task.workerJobId) {
    throw new Error('Render worker task kalici workerJobId icermiyor.');
  }
  await updateRenderWorkerJob({
    id: task.workerJobId,
    status: 'running',
    workerId,
    attempt: Number(queueJob.attemptsStarted || 0),
    queueJobId: String(queueJob.id)
  });
  let rendered = null;
  try {
    const input = await getRenderWorkerInput({ lessonId: task.lessonId, segmentId: task.segmentId });
    if (!input?.code?.code || !input?.tts?.storage_path || !input.segment.user_id) {
      throw new Error('Worker render icin kalici Manim kodu, TTS veya kullanici bilgisi bulunamadi.');
    }
    const audio = await createStorageSignedUrl({
      bucket: 'audio', storagePath: input.tts.storage_path, expiresInSeconds: 3600
    });
    rendered = await renderWorkerManimVideo({
      code: input.code.code,
      audioUrl: audio.signedUrl,
      onLog: (message, meta) => log(message, { ...meta, segmentId: task.segmentId })
    });
    const storagePath = storagePathFor({
      userId: input.segment.user_id,
      lessonId: task.lessonId,
      segmentKey: task.segmentId,
      kind: 'worker-video',
      fileName: 'render-worker.mp4'
    });
    const upload = await uploadLocalFile({
      bucket: 'videos', localPath: rendered.outputPath, storagePath, contentType: 'video/mp4'
    });
    const savedRender = await saveVideoRender({
      segmentId: input.segment.id,
      manimCodeId: input.code.id,
      quality: '-qm',
      videoStoragePath: upload.storagePath,
      localVideoPath: null,
      audioStoragePath: input.tts.storage_path,
      backgroundMusicPath: null,
      durationSeconds: rendered.durationSeconds,
      stdout: rendered.manim.stdout,
      stderr: rendered.manim.stderr
    });
    const output = { videoStoragePath: upload.storagePath, videoRenderId: savedRender?.id || null, durationSeconds: rendered.durationSeconds };
    await updateRenderWorkerJob({ id: task.workerJobId, status: 'done', workerId, queueJobId: String(queueJob.id), output });
    return output;
  } catch (error) {
    await updateRenderWorkerJob({
      id: task.workerJobId, status: 'failed', workerId, queueJobId: String(queueJob.id),
      error: error.message || 'Worker render basarisiz oldu.'
    }).catch((updateError) => log('Worker hata kaydi yazilamadi', { error: updateError.message }));
    throw error;
  } finally {
    if (rendered?.workDir) {
      const { rm } = await import('node:fs/promises');
      await rm(rendered.workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}, { concurrency: 1 });

worker.on('completed', (job) => log('Task tamamlandi', { queueJobId: job.id, name: job.name }));
worker.on('failed', (job, error) => log('Task hata verdi', { queueJobId: job?.id, error: error.message }));
worker.on('error', (error) => log('Queue baglanti hatasi', { error: error.message }));

log('Worker basladi', { queue: 'kara-render-segments', shadowMode, concurrency: 1 });
