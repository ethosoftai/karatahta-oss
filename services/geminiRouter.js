export const DEFAULT_GEMINI_FALLBACK_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3-flash-preview'
];

const modelCooldownUntil = new Map();

export function buildGeminiModelRoute(primaryModel, fallbackModels = DEFAULT_GEMINI_FALLBACK_MODELS) {
  return [...new Set([primaryModel, ...fallbackModels]
    .map((model) => String(model || '').trim())
    .filter(Boolean))];
}

function cooldownMsForError(error) {
  const numericCode = Number(error?.statusCode || error?.code || error?.status);
  if (numericCode === 404) return 6 * 60 * 60 * 1000;
  if (numericCode === 429) return 10 * 60 * 1000;
  if (numericCode === 503) return 30 * 1000;
  const message = String(error?.message || error?.error?.message || '');
  if (/NOT_FOUND|no longer available/i.test(message)) return 6 * 60 * 60 * 1000;
  if (/RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(message)) return 10 * 60 * 1000;
  return 30 * 1000;
}

export function markGeminiModelFailure(model, error, now = Date.now()) {
  if (!model || !isGeminiFailoverError(error)) return;
  modelCooldownUntil.set(model, now + cooldownMsForError(error));
}

export function markGeminiModelSuccess(model) {
  if (model) modelCooldownUntil.delete(model);
}

export function resetGeminiModelCooldowns() {
  modelCooldownUntil.clear();
}

export function buildAvailableGeminiModelRoute(
  primaryModel,
  fallbackModels = DEFAULT_GEMINI_FALLBACK_MODELS,
  now = Date.now()
) {
  const route = buildGeminiModelRoute(primaryModel, fallbackModels);
  const available = route.filter((model) => Number(modelCooldownUntil.get(model) || 0) <= now);
  return available.length ? available : route;
}

export function isGeminiFailoverError(error) {
  const numericCode = Number(error?.statusCode || error?.code || error?.status);
  if ([404, 429, 503].includes(numericCode)) {
    return true;
  }

  const message = [
    error?.status,
    error?.message,
    error?.error?.status,
    error?.error?.message
  ].filter(Boolean).join(' ');

  return /RESOURCE_EXHAUSTED|NOT_FOUND|UNAVAILABLE|quota|rate.?limit|no longer available|high demand/i.test(message);
}

export async function runGeminiModelRoute({
  primaryModel,
  fallbackModels = DEFAULT_GEMINI_FALLBACK_MODELS,
  generate,
  onModelFailure = null
}) {
  const route = buildAvailableGeminiModelRoute(primaryModel, fallbackModels);
  let lastError = null;

  for (let index = 0; index < route.length; index += 1) {
    const model = route[index];
    try {
      const response = await generate(model);
      markGeminiModelSuccess(model);
      return { response, model };
    } catch (error) {
      lastError = error;
      const failover = isGeminiFailoverError(error);
      if (failover) markGeminiModelFailure(model, error);
      const nextModel = route[index + 1] || null;
      if (!nextModel || !failover) {
        throw error;
      }
      onModelFailure?.({ model, nextModel, error });
    }
  }

  throw lastError;
}
