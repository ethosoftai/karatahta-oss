// Standalone "render one Manim scene as a single PNG" helper for the Kart
// pipeline. Deliberately independent from server.js's video pipeline
// (renderKaraManimStill) so this new feature can't destabilize the existing
// lesson-video render path; the tradeoff is a little duplication of the
// `python -m manim -s --format png` invocation.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rendersDir = path.join(__dirname, '..', 'renders', 'cards');
const manimQuality = process.env.MANIM_QUALITY === '-qh' ? '-qh' : '-ql';

function stripCodeFence(code) {
  return String(code || '')
    .replace(/^```(?:python)?\n?/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

function getSceneClassName(code) {
  const match = code.match(/class\s+([A-Za-z_]\w*)\s*\(\s*Scene\s*\)\s*:/);
  return match ? match[1] : 'CardScene';
}

async function findPng(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true, recursive: true }).catch(() => []);
  const pngs = entries.filter((entry) => entry.isFile?.() && entry.name.toLowerCase().endsWith('.png'));
  return pngs[0] ? path.join(pngs[0].path || dir, pngs[0].name) : null;
}

function runPython(args, timeoutMs = 90000) {
  return new Promise((resolve) => {
    const child = spawn('python', args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: String(error) });
    });
  });
}

/**
 * Renders one Manim Scene as a still PNG and returns it base64-encoded.
 * Cleans up its work directory afterward regardless of outcome.
 */
export async function renderCardStill({ code, cardKey }) {
  const cleanCode = stripCodeFence(code);
  const className = getSceneClassName(cleanCode);
  const workDir = path.join(rendersDir, `${Date.now()}-${randomUUID().slice(0, 8)}-${cardKey || 'card'}`);
  const mediaDir = path.join(workDir, 'media');
  await fs.mkdir(workDir, { recursive: true });
  try {
    const filePath = path.join(workDir, `${className}.py`);
    await fs.writeFile(filePath, cleanCode, 'utf8');
    const result = await runPython([
      '-m', 'manim', manimQuality, '-s', '--format', 'png',
      filePath, className, '--media_dir', mediaDir
    ]);
    if (result.code !== 0) {
      const error = new Error('Kart gorseli render edilemedi.');
      error.statusCode = 500;
      error.stderr = result.stderr;
      throw error;
    }
    const pngPath = await findPng(mediaDir);
    if (!pngPath) {
      throw new Error('Render tamamlandi ancak PNG bulunamadi.');
    }
    const buffer = await fs.readFile(pngPath);
    return `data:image/png;base64,${buffer.toString('base64')}`;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
