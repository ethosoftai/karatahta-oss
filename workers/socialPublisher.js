import 'dotenv/config';

import { createStorageSignedUrl } from '../services/mediaStore.js';
import { publishReelToInstagram } from '../services/instagramPublish.js';
import { publishVideoToYoutube } from '../services/youtubePublish.js';
import {
  claimNextSocialPublishJob,
  failSocialPublishJob,
  finishSocialPublishJob
} from '../services/socialPublishQueue.js';
import { getLessonVideoByIdForUser } from '../services/supabaseStore.js';

const pollMs = Math.max(1000, Number(process.env.SOCIAL_PUBLISH_POLL_MS || 5000));
let running = false;

function log(message, meta = null) {
  console.log(`[social-publisher] ${message}${meta ? ` ${JSON.stringify(meta)}` : ''}`);
}

async function processOne() {
  const job = await claimNextSocialPublishJob();
  if (!job) return false;
  log('Yayin isi alindi', { jobId: job.id, videoId: job.video_id });
  let instagramResult = null;
  let youtubeResult = null;
  try {
    const target = await getLessonVideoByIdForUser({ videoId: job.video_id, userId: job.user_id });
    if (!target?.video?.video_storage_path) {
      throw new Error('Railway Bucket videosu bulunamadi.');
    }
    const access = await createStorageSignedUrl({
      bucket: 'videos',
      storagePath: target.video.video_storage_path,
      expiresInSeconds: 3600
    });
    const videoUrl = access.signedUrl;
    const defaultTitle = String(target.lesson?.title || target.lesson?.topic || 'Kara Tahta dersi').slice(0, 100);
    const [instagram, youtube] = await Promise.allSettled([
      publishReelToInstagram({ videoUrl, caption: job.caption || `Kara Tahta | ${defaultTitle}` }),
      publishVideoToYoutube({
        videoUrl,
        title: job.title || defaultTitle,
        description: job.description || '',
        privacyStatus: job.privacy_status || 'private'
      })
    ]);
    instagramResult = instagram.status === 'fulfilled'
      ? { status: 'published', ...instagram.value }
      : { status: 'failed', error: instagram.reason?.message || 'Instagram yayinlanamadi.' };
    youtubeResult = youtube.status === 'fulfilled'
      ? { status: 'published', ...youtube.value }
      : { status: 'failed', error: youtube.reason?.message || 'YouTube yayinlanamadi.' };
    const failures = [instagramResult, youtubeResult].filter((result) => result.status === 'failed');
    if (failures.length) {
      await failSocialPublishJob({
        jobId: job.id,
        instagramResult,
        youtubeResult,
        error: failures.map((result) => result.error).join(' | ')
      });
      log('Yayin isi hata ile bitti', { jobId: job.id, instagramResult, youtubeResult });
    } else {
      await finishSocialPublishJob({ jobId: job.id, instagramResult, youtubeResult });
      log('Yayin isi tamamlandi', { jobId: job.id, instagramResult, youtubeResult });
    }
  } catch (error) {
    await failSocialPublishJob({ jobId: job.id, instagramResult, youtubeResult, error: error.message });
    log('Yayin isi islenemedi', { jobId: job.id, error: error.message });
  }
  return true;
}

async function tick() {
  if (running) return;
  running = true;
  try {
    while (await processOne()) {
      // Drain queued work serially: avoids duplicate requests and rate-limit bursts.
    }
  } catch (error) {
    log('Kuyruk kontrol hatasi', { error: error.message });
  } finally {
    running = false;
  }
}

log('Worker basladi', { pollMs });
await tick();
setInterval(() => { void tick(); }, pollMs);
