import { readRailwayObjectText, writeRailwayObjectText, railwayMediaConfigured } from './mediaStore.js';

const POOL_BUCKET = 'system';
const POOL_PATH = 'content_pool.txt';

// Lines are marked done in-place with this prefix once their content has
// actually been generated and published (by any job_type) -- they stay in
// the file for visibility/history but are never picked again. This lives in
// the pool text itself (not a per-job_type DB cursor) specifically so that
// stopping/starting a scheduler job, or running a different job_type,
// can never replay an idea that was already produced.
const DONE_PREFIX = '✓ ';

function isDoneLine(line) {
  return line.startsWith(DONE_PREFIX);
}

function requireRailway() {
  if (!railwayMediaConfigured) {
    const error = new Error('Content pool Railway Bucket gerektirir (MEDIA_STORAGE_PROVIDER=railway).');
    error.statusCode = 400;
    throw error;
  }
}

// Raw lines as stored (done markers included) -- this is what the pool
// editor (GET/PUT /api/scheduler/content-pool) reads and writes so a human
// can see what's already been published.
export async function readContentPool() {
  requireRailway();
  let text;
  try {
    text = await readRailwayObjectText({ bucket: POOL_BUCKET, storagePath: POOL_PATH });
  } catch (error) {
    if (error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404) {
      return [];
    }
    throw error;
  }
  return text.split('\n').map((line) => line.trim()).filter(Boolean);
}

export async function writeContentPool(text) {
  requireRailway();
  await writeRailwayObjectText({ bucket: POOL_BUCKET, storagePath: POOL_PATH, text: String(text || '') });
}

// First not-yet-done line, shared across every job_type: once an idea has
// been generated+published as a video, a carousel, or a combo, none of the
// other job_types should pick it again either.
export async function pickNextContentPoolItem() {
  const lines = await readContentPool();
  const pendingIndex = lines.findIndex((line) => !isDoneLine(line));
  if (pendingIndex === -1) {
    const error = new Error(
      lines.length
        ? 'content_pool.txt icindeki tum fikirler zaten yayinlanmis.'
        : 'content_pool.txt bos veya bulunamadi.'
    );
    error.statusCode = 422;
    throw error;
  }
  return { idea: lines[pendingIndex], lineIndex: pendingIndex, poolSize: lines.length };
}

// Marks one line done by its position in the raw line list (as returned by
// pickNextContentPoolItem) -- re-reads and rewrites the whole file so a
// concurrent edit through the pool editor isn't blindly clobbered.
export async function markContentPoolItemDone(lineIndex) {
  const lines = await readContentPool();
  if (lineIndex < 0 || lineIndex >= lines.length) return;
  if (isDoneLine(lines[lineIndex])) return;
  lines[lineIndex] = DONE_PREFIX + lines[lineIndex];
  await writeContentPool(lines.join('\n'));
}
