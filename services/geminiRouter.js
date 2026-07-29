export const DEFAULT_GEMINI_FALLBACK_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3-flash-preview'
];

export function buildGeminiModelRoute(primaryModel, fallbackModels = DEFAULT_GEMINI_FALLBACK_MODELS) {
  return [...new Set([primaryModel, ...fallbackModels]
    .map((model) => String(model || '').trim())
    .filter(Boolean))];
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
  const route = buildGeminiModelRoute(primaryModel, fallbackModels);
  let lastError = null;

  for (let index = 0; index < route.length; index += 1) {
    const model = route[index];
    try {
      const response = await generate(model);
      return { response, model };
    } catch (error) {
      lastError = error;
      const nextModel = route[index + 1] || null;
      if (!nextModel || !isGeminiFailoverError(error)) {
        throw error;
      }
      onModelFailure?.({ model, nextModel, error });
    }
  }

  throw lastError;
}
