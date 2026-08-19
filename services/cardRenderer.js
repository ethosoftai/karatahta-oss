// "Kart" pipeline'inin gorsel render motoru. Manim'in yerini alir: LLM'den
// gelen yapilandirilmis bir `scene` (metin/matematik/basit sekil adimlari,
// bkz cardsEngine.js#sanitizeScene) sabit boyutlu bir HTML sayfasina
// donusturulur ve tek, reuse edilen bir headless Chromium sekmesiyle PNG'ye
// cekilir. KaTeX matematik ifadeleri sunucu tarafinda (katex.renderToString)
// statik HTML/MathML'e cevrilir; Chromium tarafinda hicbir JS calismaz,
// sadece hazir HTML+CSS screenshot'i alinir -- bu yuzden Manim'e kiyasla
// (Python + LaTeX toolchain baslatma) siparis basina onlarca kat daha hizli.
import { chromium } from 'playwright';
import katex from 'katex';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveManimFont } from './renderQuality.js';

const CARD_WIDTH = 1080;
const CARD_HEIGHT = 1350;

const FONT_MIME_TYPES = { woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf' };

function loadInlineKatexCss() {
  const cssPath = fileURLToPath(import.meta.resolve('katex/dist/katex.min.css'));
  const katexDistDir = path.dirname(cssPath);
  const css = fs.readFileSync(cssPath, 'utf8');
  return css.replace(/url\(fonts\/([^)]+)\)/g, (match, fontFile) => {
    const ext = path.extname(fontFile).slice(1).toLowerCase();
    const mime = FONT_MIME_TYPES[ext];
    if (!mime) return match;
    const fontPath = path.join(katexDistDir, 'fonts', fontFile);
    const base64 = fs.readFileSync(fontPath).toString('base64');
    return `url(data:${mime};base64,${base64})`;
  });
}

// Computed once at module load (font-embedding is the expensive part), then
// reused for every card render.
const INLINE_KATEX_CSS = loadInlineKatexCss();

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderMathHtml(latex) {
  try {
    return katex.renderToString(String(latex || ''), { throwOnError: false, displayMode: true });
  } catch {
    return escapeHtml(latex);
  }
}

function renderStep(step, fontFamily) {
  const left = `${(Number(step.x) || 0) * 100}%`;
  const top = `${(Number(step.y) || 0) * 100}%`;
  const color = step.color || '#f8fafc';

  if (step.type === 'text') {
    return `<div class="step step-text" style="left:${left};top:${top};color:${color};font-family:'${fontFamily}',sans-serif;font-size:${step.size || 24}px;text-align:${step.align || 'center'};">${escapeHtml(step.text)}</div>`;
  }
  if (step.type === 'math') {
    return `<div class="step step-math" style="left:${left};top:${top};color:${color};font-size:${((step.size || 24) * 1.4).toFixed(1)}px;">${renderMathHtml(step.latex)}</div>`;
  }

  const x1 = `${(Number(step.x1) || 0) * 100}%`;
  const y1 = `${(Number(step.y1) || 0) * 100}%`;
  const x2 = `${(Number(step.x2) || 0) * 100}%`;
  const y2 = `${(Number(step.y2) || 0) * 100}%`;
  if (step.type === 'circle') {
    const r = `${(Number(step.r) || 0.08) * 100}%`;
    return `<circle cx="${left}" cy="${top}" r="${r}" stroke="${color}" stroke-width="4" fill="${step.fill ? color : 'none'}" />`;
  }
  if (step.type === 'rect') {
    const w = `${(Number(step.w) || 0.15) * 100}%`;
    const h = `${(Number(step.h) || 0.15) * 100}%`;
    return `<rect x="calc(${left} - ${w} / 2)" y="calc(${top} - ${h} / 2)" width="${w}" height="${h}" stroke="${color}" stroke-width="4" fill="${step.fill ? color : 'none'}" />`;
  }
  if (step.type === 'line' || step.type === 'arrow') {
    const marker = step.type === 'arrow' ? ' marker-end="url(#arrowhead)"' : '';
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="4"${marker} />`;
  }
  return '';
}

function buildCardHtml({ title, scene }) {
  const steps = Array.isArray(scene?.steps) ? scene.steps : [];
  const fontFamily = resolveManimFont();
  const htmlSteps = steps.filter((s) => s.type === 'text' || s.type === 'math').map((s) => renderStep(s, fontFamily)).join('\n');
  const svgSteps = steps.filter((s) => s.type === 'circle' || s.type === 'rect' || s.type === 'line' || s.type === 'arrow').map((s) => renderStep(s, fontFamily)).join('\n');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
${INLINE_KATEX_CSS}
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: ${CARD_WIDTH}px; height: ${CARD_HEIGHT}px; background: #000; overflow: hidden; }
#canvas { position: relative; width: 100%; height: 100%; }
.step { position: absolute; transform: translate(-50%, -50%); white-space: pre-wrap; max-width: 90%; }
.step-math .katex { color: inherit; }
svg.overlay { position: absolute; inset: 0; width: 100%; height: 100%; }
.title { position: absolute; top: 6%; left: 50%; transform: translateX(-50%); color: #f8fafc; font-family: '${fontFamily}', sans-serif; font-size: 34px; font-weight: 600; text-align: center; max-width: 90%; }
</style>
</head>
<body>
<div id="canvas">
  ${title ? `<div class="title">${escapeHtml(title)}</div>` : ''}
  <svg class="overlay">
    <defs>
      <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
        <path d="M0,0 L8,4 L0,8 Z" fill="context-stroke" />
      </marker>
    </defs>
    ${svgSteps}
  </svg>
  ${htmlSteps}
</div>
</body>
</html>`;
}

let browserPromise = null;
async function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  }
  return browserPromise;
}

async function closeBrowser() {
  if (!browserPromise) return;
  const browser = await browserPromise.catch(() => null);
  browserPromise = null;
  await browser?.close().catch(() => {});
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => { closeBrowser(); });
}
process.once('exit', () => { closeBrowser(); });

/**
 * Renders one card `scene` to a still PNG and returns it as a data URL.
 * Mirrors the old renderCardStill({ code, cardKey }) return contract so
 * cardsEngine.js's calling code barely changes.
 */
export async function renderCardImage({ title, scene, cardKey }) {
  const browser = await getBrowser();
  const page = await browser.newPage({ viewport: { width: CARD_WIDTH, height: CARD_HEIGHT } });
  try {
    const html = buildCardHtml({ title, scene });
    await page.setContent(html, { waitUntil: 'load' });
    const buffer = await page.screenshot({ type: 'png' });
    return `data:image/png;base64,${buffer.toString('base64')}`;
  } catch (error) {
    const wrapped = new Error(`Kart gorseli render edilemedi (${cardKey || 'card'}): ${error.message}`);
    wrapped.statusCode = 500;
    throw wrapped;
  } finally {
    await page.close().catch(() => {});
  }
}
