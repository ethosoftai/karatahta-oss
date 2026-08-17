function numberText(value) {
  return Number(value.toFixed(3)).toString();
}

function chunksFor(total, maximum) {
  const chunks = [];
  let remaining = Math.max(0, Number(total) || 0);
  while (remaining > 0.001) {
    const chunk = Math.min(maximum, remaining);
    chunks.push(chunk);
    remaining -= chunk;
  }
  return chunks;
}

function findCallEnd(source, openParenIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = openParenIndex; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote) {
      if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(') depth += 1;
    if (char === ')') {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}

export function fitManimTimingToDuration(code, targetDurationSeconds, {
  defaultPlaySeconds = 1,
  defaultWaitSeconds = 1,
  minimumFactor = 0.5,
  maximumFactor = 4,
  maxWaitSeconds = 3
} = {}) {
  const source = String(code || '');
  const target = Number(targetDurationSeconds);
  if (!(target > 0)) return source;
  const calls = [];
  const callPattern = /\bself\.(play|wait)\s*\(/g;
  let match;
  while ((match = callPattern.exec(source))) {
    const lineStart = source.lastIndexOf('\n', match.index - 1) + 1;
    if (source.slice(lineStart, match.index).trimStart().startsWith('#')) continue;
    const openParenIndex = source.indexOf('(', match.index);
    const callEnd = findCallEnd(source, openParenIndex);
    if (callEnd === -1) continue;
    const call = source.slice(match.index, callEnd);
    const explicit = match[1] === 'play'
      ? /\brun_time\s*=\s*(\d+(?:\.\d+)?)/.exec(call)
      : /^self\.wait\(\s*(\d+(?:\.\d+)?)?\s*\)$/s.exec(call);
    const duration = Number(explicit?.[1] || (
      match[1] === 'play' ? defaultPlaySeconds : defaultWaitSeconds
    ));
    if (!(duration > 0)) continue;
    calls.push({
      type: match[1],
      start: match.index,
      openParenIndex,
      end: callEnd,
      call,
      explicit,
      duration
    });
    callPattern.lastIndex = callEnd;
  }
  const estimatedDuration = calls.reduce((sum, call) => sum + call.duration, 0);
  if (!(estimatedDuration > 0)) return source;
  const factor = Math.max(minimumFactor, Math.min(maximumFactor, target / estimatedDuration));
  if (Math.abs(factor - 1) < 0.03) return source;

  // Scaling every self.wait() by the same factor as self.play() turns short
  // pauses into long dead-air stretches -- nothing on screen while the
  // narration keeps playing over a static/blank frame. Cap how much any
  // single wait can grow (never below its own original length) and push the
  // time it would have gained into play() calls instead, so extra duration
  // buys more motion, not more silence.
  let scaledDurations = calls.map((call) => call.duration * factor);
  if (factor > 1) {
    let leftover = 0;
    const playIndexes = [];
    scaledDurations = calls.map((call, index) => {
      const scaled = call.duration * factor;
      if (call.type === 'wait') {
        const cap = Math.max(maxWaitSeconds, call.duration);
        const capped = Math.min(scaled, cap);
        leftover += scaled - capped;
        return capped;
      }
      playIndexes.push(index);
      return scaled;
    });
    if (leftover > 0 && playIndexes.length) {
      const playTotal = playIndexes.reduce((sum, index) => sum + scaledDurations[index], 0);
      for (const index of playIndexes) {
        const share = playTotal > 0 ? scaledDurations[index] / playTotal : 1 / playIndexes.length;
        scaledDurations[index] += leftover * share;
      }
    }
  }

  const edits = [];
  calls.forEach((call, index) => {
    const scaled = numberText(scaledDurations[index]);
    if (call.explicit?.[1]) {
      const relativeStart = call.explicit.index
        + call.explicit[0].lastIndexOf(call.explicit[1]);
      edits.push({
        start: call.start + relativeStart,
        end: call.start + relativeStart + call.explicit[1].length,
        replacement: scaled
      });
    } else if (call.type === 'play') {
      const body = source.slice(call.openParenIndex + 1, call.end - 1).trimEnd();
      edits.push({
        start: call.end - 1,
        end: call.end - 1,
        replacement: `${body.endsWith(',') ? ' ' : ', '}run_time=${scaled}`
      });
    } else {
      edits.push({
        start: call.openParenIndex + 1,
        end: call.end - 1,
        replacement: scaled
      });
    }
  });
  return edits
    .sort((left, right) => right.start - left.start || right.end - left.end)
    .reduce((output, edit) => (
      `${output.slice(0, edit.start)}${edit.replacement}${output.slice(edit.end)}`
    ), source);
}

export function optimizeManimForProgressiveRender(code, {
  maxPlaySeconds = 5,
  maxWaitSeconds = 3
} = {}) {
  const source = String(code || '');
  const edits = [];
  const callPattern = /\bself\.(play|wait)\s*\(/g;
  let match;

  while ((match = callPattern.exec(source))) {
    const lineStart = source.lastIndexOf('\n', match.index - 1) + 1;
    const linePrefix = source.slice(lineStart, match.index);
    if (linePrefix.trimStart().startsWith('#')) continue;
    const openParenIndex = source.indexOf('(', match.index);
    const callEnd = findCallEnd(source, openParenIndex);
    if (callEnd === -1) continue;
    const lineEnd = source.indexOf('\n', callEnd);
    const suffix = source.slice(callEnd, lineEnd === -1 ? source.length : lineEnd);
    if (suffix.trim() && !suffix.trimStart().startsWith('#')) continue;
    const indentation = linePrefix.match(/^\s*/)?.[0] || '';
    const call = source.slice(match.index, callEnd);

    if (match[1] === 'wait') {
      const waitMatch = call.match(/^self\.wait\(\s*(\d+(?:\.\d+)?)\s*\)$/s);
      const duration = Number(waitMatch?.[1]);
      if (!Number.isFinite(duration) || duration <= maxWaitSeconds) continue;
      const replacement = chunksFor(duration, maxWaitSeconds)
        .map((chunk, index) => `${index ? indentation : ''}self.wait(${numberText(chunk)})`)
        .join('\n');
      edits.push({ start: match.index, end: callEnd, replacement });
      continue;
    }

    const runtimeMatch = /\brun_time\s*=\s*(\d+(?:\.\d+)?)/.exec(call);
    const duration = Number(runtimeMatch?.[1]);
    if (!Number.isFinite(duration) || duration <= maxPlaySeconds) continue;
    const runtimeStart = match.index + runtimeMatch.index + runtimeMatch[0].lastIndexOf(runtimeMatch[1]);
    const waits = chunksFor(duration - maxPlaySeconds, maxWaitSeconds)
      .map((chunk) => `${indentation}self.wait(${numberText(chunk)})`)
      .join('\n');
    edits.push({
      start: runtimeStart,
      end: runtimeStart + runtimeMatch[1].length,
      replacement: numberText(maxPlaySeconds)
    });
    edits.push({ start: callEnd, end: callEnd, replacement: `\n${waits}` });
  }

  return edits
    .sort((left, right) => right.start - left.start || right.end - left.end)
    .reduce((output, edit) => (
      `${output.slice(0, edit.start)}${edit.replacement}${output.slice(edit.end)}`
    ), source);
}
