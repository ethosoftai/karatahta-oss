function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function resolveStreamingSegmentCount({
  targetMinutes,
  requestedSegmentCount
}) {
  const minutes = clamp(Number(targetMinutes) || 1, 1, 30);
  const requested = clamp(Math.round(Number(requestedSegmentCount) || 1), 1, 40);
  if (minutes >= 8 && minutes <= 10) return 8;
  return requested;
}

function narrationWithinWordBudget(text, maxWords) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(' ');

  const limited = words.slice(0, maxWords);
  for (let index = limited.length - 1; index >= Math.floor(maxWords * 0.65); index -= 1) {
    if (/[.!?]$/.test(limited[index])) {
      return limited.slice(0, index + 1).join(' ');
    }
  }
  return `${limited.join(' ').replace(/[,:;]?$/, '')}.`;
}

function spokenAnchor(words, percent) {
  if (!words.length) return '';
  const start = clamp(Math.floor((percent / 100) * words.length) - 2, 0, Math.max(0, words.length - 1));
  return words.slice(start, start + 5).join(' ');
}

export function buildPlannedSpeech(segment, { maxDurationSeconds = 25 } = {}) {
  const rawNarration = String(segment?.narration || '').trim();
  if (!rawNarration) {
    const error = new Error(`${segment?.id || 'segment'}: plan narration alani bos.`);
    error.statusCode = 400;
    throw error;
  }

  const durationCap = clamp(Number(maxDurationSeconds) || 25, 8, 120);
  const requestedDuration = clamp(Number(segment.duration_seconds) || durationCap, 6, durationCap);
  const narration = narrationWithinWordBudget(rawNarration, Math.max(18, Math.round(durationCap * 2.35)));
  const words = narration.split(/\s+/).filter(Boolean);
  const estimatedSeconds = clamp(
    Math.max(requestedDuration, words.length / 2.35),
    6,
    durationCap
  );
  const sequence = Array.isArray(segment?.animation?.sequence)
    ? segment.animation.sequence.filter(Boolean).slice(0, 6)
    : [];
  const cuePlan = (sequence.length ? sequence : [segment?.animation?.description || 'Ana fikri göster'])
    .map((visualAction, index, actions) => {
      const atPercent = Math.round(((index + 0.5) / actions.length) * 100);
      return {
        at_percent: atPercent,
        spoken_anchor: spokenAnchor(words, atPercent),
        visual_action: String(visualAction)
      };
    });

  return {
    speech_text: narration,
    estimated_seconds: Number(estimatedSeconds.toFixed(1)),
    cue_plan: cuePlan,
    source: 'plan'
  };
}
