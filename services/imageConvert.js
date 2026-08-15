import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

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
        : finish(new Error(`ffmpeg donusum basarisiz (${code}): ${stderr.trim().slice(-2000)}`))
    ));
  });
}

// Instagram's Content Publishing API only accepts JPEG for image_url (single
// or carousel posts); card stills are rendered as PNG by Manim
// (manimStillRenderer.js), so carousel publishing needs this conversion
// step first.
export async function convertPngBufferToJpeg(pngBuffer) {
  const dir = os.tmpdir();
  const inputPath = path.join(dir, `card-${randomUUID()}.png`);
  const outputPath = path.join(dir, `card-${randomUUID()}.jpg`);
  await fs.writeFile(inputPath, pngBuffer);
  try {
    await runFfmpeg(['-y', '-i', inputPath, '-q:v', '2', outputPath]);
    return await fs.readFile(outputPath);
  } finally {
    await fs.rm(inputPath, { force: true }).catch(() => {});
    await fs.rm(outputPath, { force: true }).catch(() => {});
  }
}
