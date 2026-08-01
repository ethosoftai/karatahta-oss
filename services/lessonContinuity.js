export const LESSON_VISUAL_STYLE = Object.freeze({
  background: 'BLACK',
  primary: 'BLUE',
  secondary: 'TEAL',
  accent: 'YELLOW',
  text: 'WHITE',
  font: 'Georgia',
  layout: 'Baslik ust bantta; ana model merkezde; kisa aciklama ve denklemler alt bantta.'
});

function clean(value) {
  return String(value || '').trim();
}

function narrationTail(narration, maxLength = 220) {
  const text = clean(narration);
  if (!text) return '';
  const sentences = text.match(/[^.!?]+[.!?]+/g);
  const tail = clean(sentences?.at(-1) || text);
  return tail.length <= maxLength ? tail : tail.slice(-maxLength);
}

export function normalizeLessonSegmentContinuity(segment, index, previousSegment = null, total = 1) {
  const source = segment && typeof segment === 'object' ? segment : {};
  const previousContinuity = previousSegment?.continuity || {};
  const supplied = source.continuity && typeof source.continuity === 'object'
    ? source.continuity
    : {};
  const role = index === 0 ? 'opening' : (index >= total - 1 ? 'closing' : 'continuation');
  const previousEndState = clean(
    previousContinuity.visual_end_state
      || previousSegment?.animation?.visual_end_state
      || previousSegment?.animation?.description
  );

  return {
    ...source,
    continuity: {
      role,
      previous_segment_id: index > 0 ? clean(previousSegment?.id || `s${index}`) : null,
      previous_narration_tail: index > 0 ? narrationTail(previousSegment?.narration) : '',
      narrative_bridge: clean(supplied.narrative_bridge),
      visual_start_state: clean(supplied.visual_start_state || previousEndState),
      visual_end_state: clean(
        supplied.visual_end_state
          || source.animation?.visual_end_state
          || source.animation?.highlight_moment
          || source.animation?.description
      ),
      transition: clean(supplied.transition || (index === 0 ? 'opening' : 'match_continuation')),
      visual_style: {
        ...LESSON_VISUAL_STYLE,
        ...(supplied.visual_style || {})
      },
      forbid_intro_reset: index > 0,
      forbid_full_clear: index < total - 1
    }
  };
}

export function normalizeLessonContinuity(plan) {
  if (!plan || !Array.isArray(plan.segments)) return plan;
  const segments = [];
  for (let index = 0; index < plan.segments.length; index += 1) {
    segments.push(normalizeLessonSegmentContinuity(
      plan.segments[index],
      index,
      segments[index - 1] || null,
      plan.segments.length
    ));
  }
  return { ...plan, segments };
}

export function buildSegmentGenerationContext({ plan, segment, index, total }) {
  const previous = index > 0 ? plan?.segments?.[index - 1] : null;
  return {
    lesson_topic: clean(plan?.topic),
    segment_position: index + 1,
    total_segments: total,
    previous_segment: previous
      ? {
          id: previous.id,
          title: previous.title,
          learning_objective: previous.learning_objective,
          narration_tail: narrationTail(previous.narration),
          visual_end_state: previous.continuity?.visual_end_state || ''
        }
      : null,
    current_segment: {
      id: segment?.id,
      title: segment?.title,
      continuity: segment?.continuity || null
    }
  };
}
