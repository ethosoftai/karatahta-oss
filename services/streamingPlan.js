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

export function extractArrayObjects(text, propertyName = 'segments') {
  const source = String(text || '');
  const arrayStart = findArrayStart(source, propertyName);
  if (arrayStart === -1) return [];

  const objects = [];
  let objectStart = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let cursor = arrayStart + 1; cursor < source.length; cursor += 1) {
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
      if (depth === 0) objectStart = cursor;
      depth += 1;
    } else if (char === '}') {
      if (depth === 0) return objects;
      depth -= 1;
      if (depth === 0) {
        const parsed = safeJsonParse(source.slice(objectStart, cursor + 1));
        if (parsed) objects.push(parsed);
        objectStart = -1;
      }
    } else if (char === ']' && depth === 0) {
      return objects;
    } else if (depth === 0 && !/\s|,/.test(char)) {
      return objects;
    }
  }

  return objects;
}

export function extractFirstArrayObject(text, propertyName = 'segments') {
  return extractArrayObjects(text, propertyName)[0] || null;
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

export function buildIncrementalLessonRoute(segmentCount) {
  const count = Math.max(1, Math.round(Number(segmentCount || 1)));
  if (count === 1) return ['complete_explanation'];
  const middleRoles = [
    'concrete_intuition',
    'core_model_or_definition',
    'method_or_causal_mechanism',
    'worked_example_or_application',
    'second_example_or_comparison',
    'misconception_and_correction',
    'guided_practice'
  ];
  return Array.from({ length: count }, (_, index) => {
    if (index === 0) return 'opening_hook_and_intuition';
    if (index === count - 1) return 'synthesis_and_understanding_check';
    const roleIndex = Math.min(
      middleRoles.length - 1,
      Math.floor(((index - 1) / Math.max(1, count - 2)) * middleRoles.length)
    );
    return middleRoles[roleIndex];
  });
}

export function compactPreviousSegmentContext(segments, limit = 2) {
  return (Array.isArray(segments) ? segments : [])
    .filter(Boolean)
    .slice(-Math.max(1, Number(limit || 2)))
    .map((segment) => ({
      id: segment.id,
      title: segment.title,
      learning_objective: segment.learning_objective,
      narration_tail: String(segment.narration || '').trim().slice(-320),
      visual_end_state: segment.continuity?.visual_end_state
        || segment.animation?.visual_end_state
        || '',
      animation_highlight: segment.animation?.highlight_moment || ''
    }));
}
