export const MANIM_QUALITIES = new Set(['-ql', '-qm', '-qh']);
export const DEFAULT_MANIM_QUALITY = '-qm';
export const DEFAULT_MANIM_FONT = 'DejaVu Serif';
export const VIDEO_WIDTH = 1280;
export const VIDEO_HEIGHT = 720;
export const VIDEO_FPS = 30;

function normalizeString(value) {
  return String(value || '').trim();
}

export function resolveManimQuality(value = process.env.MANIM_QUALITY) {
  const quality = normalizeString(value);
  return MANIM_QUALITIES.has(quality) ? quality : DEFAULT_MANIM_QUALITY;
}

export function resolveManimFont(value = process.env.MANIM_FONT) {
  const font = normalizeString(value);
  return font || DEFAULT_MANIM_FONT;
}

export function assertStandardVideoProbe(probe, context = 'video') {
  if (!probe || !Number.isFinite(probe.width) || !Number.isFinite(probe.height)) {
    throw new Error(`${context} icin video boyutu okunamadi.`);
  }
  if (probe.width !== VIDEO_WIDTH || probe.height !== VIDEO_HEIGHT) {
    throw new Error(`${context} beklenen cözünürlükte degil: ${probe.width}x${probe.height}.`);
  }
  if (probe.codec && probe.codec !== 'h264') {
    throw new Error(`${context} beklenen video codec'i degil: ${probe.codec}.`);
  }
  if (!Number.isFinite(probe.fps) || Math.abs(probe.fps - VIDEO_FPS) > 0.2) {
    throw new Error(`${context} beklenen fps'de degil: ${probe.fps}.`);
  }
  return probe;
}
