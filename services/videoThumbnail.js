import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { extractFrameToFile } from './frameExtractor.js';
import { uploadLocalFile, uploadDataUrl, storagePathFor } from './mediaStore.js';

const POSTER_TIMESTAMP_SECONDS = 1;

export async function generateAndUploadPoster({ localVideoPath, userId, lessonId }) {
  if (!localVideoPath) return null;
  const tempPath = path.join(os.tmpdir(), `catalog-poster-${randomUUID()}.jpg`);
  try {
    await extractFrameToFile({
      videoUrl: localVideoPath,
      timestampSeconds: POSTER_TIMESTAMP_SECONDS,
      outputPath: tempPath
    });
    const storagePath = storagePathFor({
      userId,
      lessonId,
      kind: 'poster',
      fileName: 'poster.jpg'
    });
    const uploaded = await uploadLocalFile({
      bucket: 'videos',
      localPath: tempPath,
      storagePath,
      contentType: 'image/jpeg'
    });
    return uploaded.storagePath;
  } catch (error) {
    console.warn(`Poster uretilemedi (lesson ${lessonId}): ${error.message}`);
    return null;
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => {});
  }
}

export async function fetchAndUploadExternalImage({ url, userId, lessonId }) {
  if (!url) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await response.arrayBuffer());
    const extension = contentType.includes('png') ? 'poster.png' : 'poster.jpg';
    const storagePath = storagePathFor({ userId, lessonId, kind: 'poster', fileName: extension });
    const uploaded = await uploadDataUrl({
      bucket: 'videos',
      storagePath,
      dataUrl: `data:${contentType};base64,${buffer.toString('base64')}`,
      contentType
    });
    return uploaded.storagePath;
  } catch (error) {
    console.warn(`Poster indirilemedi (lesson ${lessonId}): ${error.message}`);
    return null;
  }
}
