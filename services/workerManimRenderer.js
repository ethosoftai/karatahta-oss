import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { sanitizeManimForLocalRender } from './manimSanitizer.js';
import {
  VIDEO_FPS,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
  assertStandardVideoProbe,
  resolveManimQuality
} from './renderQuality.js';

function run(command, args, { cwd, timeoutMs = 180000 } = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000).unref?.();
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      clearTimeout(timeout);
      resolve({ code: -1, signal: null, timedOut, stdout, stderr: `${stderr}\n${error.message}`, durationMs: Date.now() - startedAt });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal: signal || null, timedOut, stdout, stderr, durationMs: Date.now() - startedAt });
    });
  });
}

function sceneClassName(code) {
  const match = String(code || '').match(/class\s+([A-Za-z_]\w*)\s*\(\s*(?:Scene|MovingCameraScene)\s*\)\s*:/);
  if (!match) throw new Error('Worker Manim kodunda tek Scene sinifi bulunamadi.');
  return match[1];
}

async function newestMp4(rootDir) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const nestedFiles = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      const nested = await newestMp4(fullPath).catch(() => null);
      return nested ? [{ fullPath: nested, mtimeMs: (await fs.stat(nested)).mtimeMs }] : [];
    }
    if (!entry.isFile() || !entry.name.endsWith('.mp4')) return [];
    return [{ fullPath, mtimeMs: (await fs.stat(fullPath)).mtimeMs }];
  }));
  const files = nestedFiles.flat().filter((file) => file && Number.isFinite(file.mtimeMs));
  return files.sort((left, right) => right.mtimeMs - left.mtimeMs)[0]?.fullPath || null;
}

async function durationSeconds(filePath) {
  const result = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath], { timeoutMs: 30000 });
  const duration = Number(result.stdout.trim());
  return result.code === 0 && Number.isFinite(duration) ? duration : null;
}

async function probeVideo(filePath) {
  const result = await run('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,avg_frame_rate,codec_name,profile,level:format=duration',
    '-of', 'json',
    filePath
  ], { timeoutMs: 30000 });
  if (result.code !== 0) {
    throw new Error(`Worker video okunamadi: ${result.stderr || result.stdout}`);
  }
  const payload = JSON.parse(result.stdout || '{}');
  const stream = payload.streams?.[0];
  const duration = Number(payload.format?.duration);
  if (!stream || !Number.isFinite(duration) || duration <= 0) {
    throw new Error('Worker video streami veya suresi gecersiz.');
  }
  const [fpsNumerator, fpsDenominator] = String(stream.avg_frame_rate || '0/1').split('/').map(Number);
  return {
    width: Number(stream.width),
    height: Number(stream.height),
    fps: fpsDenominator ? fpsNumerator / fpsDenominator : 0,
    codec: stream.codec_name,
    profile: stream.profile,
    level: Number(stream.level),
    durationSeconds: duration
  };
}

export async function renderWorkerManimVideo({ code, audioUrl, quality = resolveManimQuality(), onLog = () => {} }) {
  const renderId = `kara-render-worker-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `${renderId}-`));
  try {
    const manimQuality = resolveManimQuality(quality);
    const source = sanitizeManimForLocalRender(String(code || ''));
    const className = sceneClassName(source);
    const sourcePath = path.join(workDir, `${className}.py`);
    const mediaDir = path.join(workDir, 'media');
    const audioPath = path.join(workDir, 'speech.mp3');
    const outputPath = path.join(workDir, `${className}-with-audio.mp4`);
    await fs.writeFile(sourcePath, source, 'utf8');
    await fs.mkdir(mediaDir, { recursive: true });
    const audioResponse = await fetch(audioUrl);
    if (!audioResponse.ok) throw new Error(`Worker ses indirilemedi: HTTP ${audioResponse.status}`);
    await fs.writeFile(audioPath, Buffer.from(await audioResponse.arrayBuffer()));
    onLog('Manim basladi', { className });
    const manim = await run('python', ['-m', 'manim', manimQuality, '--resolution', `${VIDEO_WIDTH},${VIDEO_HEIGHT}`, '--fps', String(VIDEO_FPS), sourcePath, className, '--media_dir', mediaDir], { cwd: workDir });
    if (manim.code !== 0) {
      const error = new Error(manim.signal ? `Manim ${manim.signal} ile sonlandi.` : 'Manim render basarisiz oldu.');
      Object.assign(error, { manim });
      throw error;
    }
    const rawVideoPath = await newestMp4(mediaDir);
    if (!rawVideoPath) throw new Error('Worker Manim render tamamlandi ancak MP4 bulunamadi.');
    // Clone the last frame where needed so final video is never shorter than narration.
    const mux = await run('ffmpeg', ['-y', '-i', rawVideoPath, '-i', audioPath, '-filter_complex', '[0:v]tpad=stop_mode=clone:stop_duration=30[v]', '-map', '[v]', '-map', '1:a:0', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', outputPath], { cwd: workDir });
    if (mux.code !== 0) {
      const error = new Error('Worker FFmpeg ses/video birlestirmesi basarisiz oldu.');
      Object.assign(error, { mux });
      throw error;
    }
    const probe = assertStandardVideoProbe(await probeVideo(outputPath), 'worker final video');
    return { workDir, outputPath, durationSeconds: await durationSeconds(outputPath), probe, manim, mux };
  } catch (error) {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}
