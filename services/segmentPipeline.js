function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function segmentDurationBudget(targetMinutes, segmentCount) {
  const minutes = positiveNumber(targetMinutes, 10);
  const count = Math.max(1, Math.round(positiveNumber(segmentCount, 8)));
  const averageSeconds = Math.max(12, Math.round((minutes * 60) / count));
  const minSeconds = Math.max(10, Math.round(averageSeconds * 0.75));
  const maxSeconds = Math.max(minSeconds + 2, Math.round(averageSeconds * 1.25));
  return { averageSeconds, minSeconds, maxSeconds };
}

export function speechDurationBudget(segmentDurationSeconds) {
  const targetSeconds = Math.max(12, Math.round(positiveNumber(segmentDurationSeconds, 30)));
  const minSeconds = Math.max(10, Math.round(targetSeconds * 0.85));
  const maxSeconds = Math.max(minSeconds + 2, Math.round(targetSeconds * 1.15));
  return { targetSeconds, minSeconds, maxSeconds };
}

export function scheduleRemainingSegmentPreparations(total, schedulePreparation, startIndex = 1) {
  const tasks = [];
  for (let index = Math.max(0, startIndex); index < Math.max(0, Number(total) || 0); index += 1) {
    tasks.push(schedulePreparation(index));
  }
  return tasks;
}
