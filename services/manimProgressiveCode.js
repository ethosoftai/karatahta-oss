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
