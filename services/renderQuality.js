export const MANIM_QUALITIES = new Set(['-ql', '-qm', '-qh']);
export const DEFAULT_MANIM_QUALITY = '-qm';
export const DEFAULT_MANIM_FONT = 'DejaVu Serif';
// horizontal (16:9) is the long-form lesson video shape. vertical (9:16) is
// for YouTube Shorts / TikTok / Instagram Reels -- there's no separate
// "post as Short" API call, YouTube classifies an upload as a Short purely
// from the file itself being vertical/square and under its duration cap.
export const VIDEO_ORIENTATIONS = new Set(['horizontal', 'vertical']);
export const DEFAULT_VIDEO_ORIENTATION = 'horizontal';
export const VIDEO_DIMENSIONS = {
  horizontal: { width: 1280, height: 720 },
  vertical: { width: 720, height: 1280 }
};
// Kept for existing callers that assumed a single fixed resolution.
export const VIDEO_WIDTH = VIDEO_DIMENSIONS.horizontal.width;
export const VIDEO_HEIGHT = VIDEO_DIMENSIONS.horizontal.height;
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

export function resolveVideoOrientation(value) {
  const orientation = normalizeString(value).toLowerCase();
  return VIDEO_ORIENTATIONS.has(orientation) ? orientation : DEFAULT_VIDEO_ORIENTATION;
}

export function resolveVideoDimensions(orientation) {
  return VIDEO_DIMENSIONS[resolveVideoOrientation(orientation)];
}

export function assertStandardVideoProbe(probe, context = 'video', { width = VIDEO_WIDTH, height = VIDEO_HEIGHT } = {}) {
  if (!probe || !Number.isFinite(probe.width) || !Number.isFinite(probe.height)) {
    throw new Error(`${context} icin video boyutu okunamadi.`);
  }
  if (probe.width !== width || probe.height !== height) {
    throw new Error(`${context} beklenen cözünürlükte degil: ${probe.width}x${probe.height} (beklenen ${width}x${height}).`);
  }
  if (probe.codec && probe.codec !== 'h264') {
    throw new Error(`${context} beklenen video codec'i degil: ${probe.codec}.`);
  }
  if (!Number.isFinite(probe.fps) || Math.abs(probe.fps - VIDEO_FPS) > 0.2) {
    throw new Error(`${context} beklenen fps'de degil: ${probe.fps}.`);
  }
  return probe;
}
