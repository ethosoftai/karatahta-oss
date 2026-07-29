import { jsonrepair } from 'jsonrepair';

export function extractFirstJsonObject(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

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
      if (depth === 0) return text.slice(start, index + 1);
    }
  }

  return null;
}

function stripJsonFence(text) {
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : text;
}

export function safeJsonParse(text, { onRepair } = {}) {
  const trimmed = stripJsonFence(String(text || '').trim());
  const extracted = extractFirstJsonObject(trimmed);
  const candidates = [...new Set([trimmed, extracted].filter(Boolean))];
  let lastError = null;

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      lastError = error;
    }
  }

  for (const candidate of [...candidates].reverse()) {
    try {
      const repairedText = jsonrepair(candidate);
      const value = JSON.parse(repairedText);
      onRepair?.({
        originalLength: candidate.length,
        repairedLength: repairedText.length,
        parseError: lastError?.message || null
      });
      return value;
    } catch (error) {
      lastError = error;
    }
  }

  const error = new Error('LLM yaniti gecerli JSON olarak okunamadi.');
  error.statusCode = 502;
  error.cause = lastError;
  throw error;
}
