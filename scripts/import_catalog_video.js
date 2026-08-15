import 'dotenv/config';

import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import {
  createLesson,
  updateLesson,
  saveLessonVideo,
  storagePathFor
} from '../services/supabaseStore.js';
import { uploadLocalFile } from '../services/mediaStore.js';
import { extractFrameToFile } from '../services/frameExtractor.js';

function parseArgs(argv) {
  const args = { public: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--public') {
      args.public = true;
      continue;
    }
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const value = argv[i + 1];
      args[key] = value;
      i += 1;
    }
  }
  return args;
}

function runCommand(command, commandArgs, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('close', (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });
}

async function getMediaDurationSeconds(filePath) {
  const result = await runCommand('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath
  ]);
  const duration = Number.parseFloat(result.stdout.trim());
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    throw new Error('--file <video-path> gerekli.');
  }
  const userId = args['user-id'] || process.env.DEV_USER_ID;
  if (!userId) {
    throw new Error('--user-id verilmeli veya DEV_USER_ID ortam degiskeni tanimli olmali.');
  }
  const localVideoPath = path.resolve(args.file);
  await fs.access(localVideoPath);

  const title = args.title || path.basename(localVideoPath, path.extname(localVideoPath));
  const topic = args.topic || title;

  console.log(`Ders olusturuluyor: ${title}`);
  const lesson = await createLesson({
    userId,
    title,
    topic,
    sourceType: 'catalog_import'
  });
  await updateLesson(lesson.id, {
    status: 'done',
    is_public: args.public
  });

  console.log('Video Bucket a yukleniyor...');
  const videoStoragePath = storagePathFor({
    userId,
    lessonId: lesson.id,
    kind: 'final',
    fileName: path.basename(localVideoPath)
  });
  const uploadedVideo = await uploadLocalFile({
    bucket: 'videos',
    localPath: localVideoPath,
    storagePath: videoStoragePath,
    contentType: 'video/mp4'
  });

  console.log('Poster (ilk kare) cikariliyor...');
  const posterTempPath = path.join(os.tmpdir(), `catalog-import-poster-${randomUUID()}.jpg`);
  let posterStoragePath = null;
  try {
    await extractFrameToFile({
      videoUrl: localVideoPath,
      timestampSeconds: 1,
      outputPath: posterTempPath
    });
    const posterPath = storagePathFor({
      userId,
      lessonId: lesson.id,
      kind: 'poster',
      fileName: 'poster.jpg'
    });
    const uploadedPoster = await uploadLocalFile({
      bucket: 'videos',
      localPath: posterTempPath,
      storagePath: posterPath,
      contentType: 'image/jpeg'
    });
    posterStoragePath = uploadedPoster.storagePath;
  } catch (error) {
    console.warn(`Poster uretilemedi, videosuz devam ediliyor: ${error.message}`);
  } finally {
    await fs.rm(posterTempPath, { force: true }).catch(() => {});
  }

  const durationSeconds = await getMediaDurationSeconds(localVideoPath).catch(() => null);

  await saveLessonVideo({
    lessonId: lesson.id,
    videoStoragePath: uploadedVideo.storagePath,
    durationSeconds,
    posterStoragePath
  });

  console.log(`Tamamlandi. lessonId=${lesson.id} public=${args.public}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
