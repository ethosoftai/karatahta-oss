// Lightweight, standalone DeepSeek client for the newer feature modules
// (live teacher, cards). Deliberately does not import from server.js to
// avoid coupling these new files to the monolith's internals -- it just
// reads the same env vars server.js already uses.
import OpenAI from 'openai';
import { jsonrepair } from 'jsonrepair';

const apiKey = process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API || '';
const baseURL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const model = process.env.DEEPSEEK_CODE_MODEL || process.env.DEEPSEEK_PLAN_MODEL || 'deepseek-v4-flash';

const client = apiKey ? new OpenAI({ apiKey, baseURL }) : null;

export function requireDeepSeek() {
  if (!client) {
    const error = new Error('.env icindeki DEEPSEEK_API_KEY bos. Once API anahtarini girin.');
    error.statusCode = 400;
    throw error;
  }
  return client;
}

/**
 * Minimal chat helper: sends a system+user prompt, returns raw text.
 * `json: true` asks the model for JSON output and repairs mildly broken JSON.
 */
export async function askDeepSeek({ systemInstruction, userText, json = false, temperature = 0.4 }) {
  const deepseek = requireDeepSeek();
  const response = await deepseek.chat.completions.create({
    model,
    temperature,
    messages: [
      ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []),
      { role: 'user', content: userText }
    ],
    ...(json ? { response_format: { type: 'json_object' } } : {})
  });
  const text = response.choices?.[0]?.message?.content?.trim() || '';
  if (!json) return text;
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(jsonrepair(text));
  }
}
