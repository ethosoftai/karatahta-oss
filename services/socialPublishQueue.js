import { supabase, supabaseConfigured } from './supabaseStore.js';

function requireQueue() {
  if (!supabaseConfigured || !supabase) {
    throw new Error('Sosyal medya kuyrugu icin Supabase ayarlari eksik.');
  }
  return supabase;
}

function platformsForTarget(targetPlatform) {
  if (targetPlatform === 'both') return ['instagram', 'youtube'];
  if (['instagram', 'youtube', 'tiktok'].includes(targetPlatform)) return [targetPlatform];
  throw new Error('Gecerli bir yayin platformu gerekli.');
}

function withLegacyFields(job) {
  if (!job) return job;
  const payload = job.payload || {};
  const results = job.results || {};
  return {
    ...job,
    target_platform: payload.platforms?.length === 1 ? payload.platforms[0] : 'both',
    caption: payload.caption || null,
    title: payload.title || null,
    description: payload.description || null,
    privacy_status: payload.privacyStatus || 'private',
    instagram_result: results.instagram || null,
    youtube_result: results.youtube || null,
    tiktok_result: results.tiktok || null
  };
}

export async function createSocialPublishJob({
  userId, targetPlatform, videoUrl, imageUrls, caption, title, description,
  privacyStatus, action = 'video.publish'
}) {
  const client = requireQueue();
  const isInstagramCarousel = action === 'instagram.carousel';
  if (!['video.publish', 'instagram.carousel'].includes(action)) {
    throw new Error('Desteklenmeyen sosyal yayin isi.');
  }
  if (isInstagramCarousel && targetPlatform !== 'instagram') {
    throw new Error('Instagram carousel yalnizca Instagram platformunda yayinlanabilir.');
  }
  const { data, error } = await client
    .from('publish_jobs')
    .insert({
      owner_ref: String(userId),
      payload: {
        action,
        ...(isInstagramCarousel ? { imageUrls: Array.isArray(imageUrls) ? imageUrls : [] } : { videoUrl }),
        title: title || '',
        description: description || '',
        caption: caption || '',
        platforms: isInstagramCarousel ? ['instagram'] : platformsForTarget(targetPlatform),
        privacyStatus: privacyStatus || 'private'
      }
    })
    .select('*')
    .single();
  if (error) throw error;
  return withLegacyFields(data);
}

export async function getSocialPublishJobForUser({ jobId, userId }) {
  const client = requireQueue();
  const { data, error } = await client
    .from('publish_jobs')
    .select('*')
    .eq('id', jobId)
    .eq('owner_ref', String(userId))
    .maybeSingle();
  if (error) throw error;
  return withLegacyFields(data);
}
