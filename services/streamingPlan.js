import { safeJsonParse } from './llmJson.js';

function findArrayStart(text, propertyName) {
  const key = JSON.stringify(String(propertyName || 'segments'));
  let searchFrom = 0;

  while (searchFrom < text.length) {
    const keyIndex = text.indexOf(key, searchFrom);
    if (keyIndex === -1) return -1;

    let cursor = keyIndex + key.length;
    while (/\s/.test(text[cursor] || '')) cursor += 1;
    if (text[cursor] !== ':') {
      searchFrom = keyIndex + key.length;
      continue;
    }
    cursor += 1;
    while (/\s/.test(text[cursor] || '')) cursor += 1;
    if (text[cursor] === '[') return cursor;
    searchFrom = keyIndex + key.length;
  }

  return -1;
}

export function extractFirstArrayObject(text, propertyName = 'segments') {
  const source = String(text || '');
  const arrayStart = findArrayStart(source, propertyName);
  if (arrayStart === -1) return null;

  let objectStart = -1;
  for (let cursor = arrayStart + 1; cursor < source.length; cursor += 1) {
    const char = source[cursor];
    if (/\s|,/.test(char)) continue;
    if (char !== '{') return null;
    objectStart = cursor;
    break;
  }
  if (objectStart === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let cursor = objectStart; cursor < source.length; cursor += 1) {
    const char = source[cursor];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return safeJsonParse(source.slice(objectStart, cursor + 1));
      }
    }
  }

  return null;
}

export function isUsableLessonSegment(segment) {
  return Boolean(
    segment
    && typeof segment === 'object'
    && String(segment.id || '').trim()
    && String(segment.title || '').trim()
    && segment.animation
  );
}

export function mergeFirstSegment(plan, firstSegment) {
  const segments = Array.isArray(plan?.segments) ? [...plan.segments] : [];
  if (!isUsableLessonSegment(firstSegment)) return { ...plan, segments };
  if (segments.length) {
    segments[0] = firstSegment;
  } else {
    segments.push(firstSegment);
  }
  return { ...plan, segments };
}

export function buildEarlySpeechScript(segment) {
  const speechText = String(segment?.narration || '').trim();
  if (speechText.length < 80) return null;

  const sequence = Array.isArray(segment?.animation?.sequence)
    ? segment.animation.sequence.filter(Boolean)
    : [];
  const estimatedSeconds = Math.max(
    6,
    Number(segment.duration_seconds) || Math.round(speechText.split(/\s+/).length / 2.2)
  );
  const cuePlan = sequence.map((visualAction, index) => ({
    at_percent: Math.round(((index + 0.5) / sequence.length) * 100),
    spoken_anchor: '',
    visual_action: String(visualAction)
  }));

  return {
    speech_text: speechText,
    estimated_seconds: estimatedSeconds,
    cue_plan: cuePlan
  };
}
