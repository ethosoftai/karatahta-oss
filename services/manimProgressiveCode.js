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

// A self.wait()/self.play() written inside a for/while loop runs once per
// iteration at runtime but only appears once in the source text -- there's
// no way to know its real total duration from static text, so scaling it
// risks compounding an already-repeated call into something far longer
// than intended. Detected by walking backwards from the call through
// shrinking indentation levels until a loop header (or the enclosing
// def/class) is found.
function isInsideLoop(source, matchIndex) {
  const currentLineStart = source.lastIndexOf('\n', matchIndex - 1) + 1;
  const currentLineEnd = source.indexOf('\n', matchIndex);
  const currentLine = source.slice(
    currentLineStart,
    currentLineEnd === -1 ? source.length : currentLineEnd
  );
  let boundaryIndent = (currentLine.match(/^\s*/)?.[0] || '').length;
  const precedingLines = source.slice(0, currentLineStart).split('\n');
  for (let i = precedingLines.length - 1; i >= 0 && boundaryIndent > 0; i -= 1) {
    const candidate = precedingLines[i];
    const trimmed = candidate.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const indent = (candidate.match(/^\s*/)?.[0] || '').length;
    if (indent < boundaryIndent) {
      if (/^(for|while)\b/.test(trimmed)) return true;
      boundaryIndent = indent;
    }
  }
  return false;
}

export function fitManimTimingToDuration(code, targetDurationSeconds, {
  defaultPlaySeconds = 1,
  defaultWaitSeconds = 1,
  minimumFactor = 0.5,
  maximumFactor = 4,
  maxWaitSeconds = 3,
  maxPlaySeconds = 6
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
    if (isInsideLoop(source, match.index)) {
      callPattern.lastIndex = callEnd;
      continue;
    }
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

  // Scaling every call by the same raw factor can turn a short wait, or an
  // already-finished play() (e.g. a FadeOut with nothing after it), into a
  // long stretch where nothing meaningful happens on screen while the
  // narration keeps playing. Cap how much any single call can grow --
  // never below its own original length -- instead of applying the factor
  // unbounded. This trades a possibly-shorter final video (the leftover
  // gets absorbed later by holding the last real frame, not a black one)
  // for the guarantee that no individual call balloons into dead air.
  const scaledDurations = calls.map((call) => {
    const scaled = call.duration * factor;
    if (factor <= 1) return scaled;
    const cap = Math.max(call.type === 'wait' ? maxWaitSeconds : maxPlaySeconds, call.duration);
    return Math.min(scaled, cap);
  });

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
