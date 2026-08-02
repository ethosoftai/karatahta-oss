import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function buildFrameExtractArgs({ videoUrl, timestampSeconds, outputPath }) {
  const seconds = Math.max(0, Number(timestampSeconds) || 0);
  return [
    '-y',
    '-ss', seconds.toFixed(3),
    '-i', String(videoUrl),
    '-frames:v', '1',
    '-q:v', '3',
    outputPath
  ];
}

function runFfmpeg(args, { timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { shell: false, windowsHide: true });
    let stderr = '';
    let settled = false;
    let forceKillTimer = null;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(forceKillTimer);
      if (error) reject(error);
      else resolve();
    };

    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      forceKillTimer = setTimeout(() => child.kill('SIGKILL'), 5000);
    }, timeoutMs);

    child.once('error', (error) => finish(new Error(`ffmpeg baslatilamadi: ${error.message}`)));
    child.once('close', (code) => (
      code === 0
        ? finish()
        : finish(new Error(`ffmpeg kare cikarma basarisiz (${code}): ${stderr.trim().slice(-2000)}`))
    ));
  });
}

export async function extractFrameAtTime({ videoUrl, timestampSeconds, timeoutMs = 20000 }) {
  if (!videoUrl) {
    throw new Error('get_frame icin video kaynagi bulunamadi.');
  }
  const outputPath = path.join(os.tmpdir(), `kara-live-frame-${randomUUID()}.jpg`);
  const args = buildFrameExtractArgs({ videoUrl, timestampSeconds, outputPath });

  try {
    await runFfmpeg(args, { timeoutMs });
    const buffer = await fs.readFile(outputPath);
    if (!buffer.length) {
      throw new Error('ffmpeg bos kare dosyasi uretti.');
    }
    return { mimeType: 'image/jpeg', data: buffer.toString('base64') };
  } finally {
    await fs.rm(outputPath, { force: true }).catch(() => {});
  }
}
