import { spawn } from 'node:child_process';
import { extractFrameAtTime } from './frameExtractor.js';

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']);
export const YOUTUBE_STORAGE_PREFIX = 'youtube://';

export function parseYoutubeVideoId(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl || '').trim());
  } catch {
    return null;
  }
  if (!YOUTUBE_HOSTS.has(url.hostname)) {
    return null;
  }
  if (url.hostname === 'youtu.be') {
    const id = url.pathname.replace(/^\//, '').split('/')[0];
    return /^[\w-]{11}$/.test(id) ? id : null;
  }
  if (url.pathname === '/watch') {
    const id = url.searchParams.get('v');
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  }
  const shortsMatch = url.pathname.match(/^\/shorts\/([\w-]{11})/);
  if (shortsMatch) return shortsMatch[1];
  const embedMatch = url.pathname.match(/^\/embed\/([\w-]{11})/);
  if (embedMatch) return embedMatch[1];
  return null;
}

export function isYoutubeStoragePath(storagePath) {
  return String(storagePath || '').startsWith(YOUTUBE_STORAGE_PREFIX);
}

export function youtubeVideoIdFromStoragePath(storagePath) {
  return isYoutubeStoragePath(storagePath) ? storagePath.slice(YOUTUBE_STORAGE_PREFIX.length) : null;
}

export function youtubeWatchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

function runYtDlp(args, { timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('yt-dlp', args, { shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let forceKillTimer = null;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(forceKillTimer);
      if (error) reject(error);
      else resolve(stdout);
    };

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      forceKillTimer = setTimeout(() => child.kill('SIGKILL'), 5000);
    }, timeoutMs);

    child.once('error', (error) => finish(new Error(`yt-dlp baslatilamadi: ${error.message}`)));
    child.once('close', (code) => (
      code === 0
        ? finish()
        : finish(new Error(`yt-dlp basarisiz (${code}): ${stderr.trim().slice(-2000)}`))
    ));
  });
}

export async function fetchYoutubeMetadata(url, { timeoutMs = 30000 } = {}) {
  const stdout = await runYtDlp(['--dump-json', '--no-warnings', '--skip-download', url], { timeoutMs });
  const data = JSON.parse(stdout);
  return {
    id: data.id,
    title: String(data.title || 'YouTube dersi').slice(0, 240),
    duration: Number.isFinite(data.duration) ? data.duration : null,
    thumbnail: data.thumbnail || null
  };
}

export async function resolveYoutubeStreamUrl(url, { timeoutMs = 20000 } = {}) {
  // Video-only DASH mp4 (no audio) -- the combined "progressive" itag 18
  // stream YouTube still advertises comes back 403 when fetched outside
  // yt-dlp's own request context; video-only formats do not have that
  // restriction and are all we need for a single still frame anyway.
  const stdout = await runYtDlp([
    '-f', 'bestvideo[height<=480][ext=mp4]/bestvideo[ext=mp4]/bestvideo',
    '-g',
    '--no-warnings',
    url
  ], { timeoutMs });
  const streamUrl = stdout.trim().split('\n')[0];
  if (!streamUrl) {
    throw new Error('yt-dlp video stream URL dondurmedi.');
  }
  return streamUrl;
}

// googlevideo.com direct URLs occasionally 403 even when freshly resolved
// (YouTube-side signature/anti-bot heuristics, not something we control) --
// a fresh re-resolve + retry clears this most of the time.
export async function captureYoutubeFrame({ videoId, timestampSeconds, attempts = 3 }) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const streamUrl = await resolveYoutubeStreamUrl(youtubeWatchUrl(videoId));
      return await extractFrameAtTime({ videoUrl: streamUrl, timestampSeconds });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
