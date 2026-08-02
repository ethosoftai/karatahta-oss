const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const DEFAULT_MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const DEFAULT_MODEL_COOLDOWN_MS = 60 * 1000;
const karaModelCooldowns = new Map();

export function parseKaraVisionModels(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(values
    .map((model) => String(model || '').trim().replace(/^models\//, ''))
    .filter((model) => /^[a-z0-9][a-z0-9._-]+$/i.test(model)))];
}

export function normalizeKaraFrame(frame, { maxBytes = DEFAULT_MAX_IMAGE_BYTES } = {}) {
  const mimeType = String(frame?.mimeType || frame?.mime_type || '').trim().toLowerCase();
  const rawData = String(frame?.data || '').trim();
  const data = rawData.includes(',') ? rawData.slice(rawData.indexOf(',') + 1) : rawData;

  if (!SUPPORTED_IMAGE_TYPES.has(mimeType) || !data) {
    const error = new Error('Kara icin gecerli bir video karesi bekleniyor (JPEG, PNG veya WebP).');
    error.statusCode = 400;
    throw error;
  }

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    const error = new Error('Video karesi gecerli base64 verisi degil.');
    error.statusCode = 400;
    throw error;
  }

  const byteLength = Buffer.byteLength(data, 'base64');
  if (!byteLength || byteLength > maxBytes) {
    const error = new Error(`Video karesi en fazla ${Math.round(maxBytes / 1024 / 1024)} MB olabilir.`);
    error.statusCode = 413;
    throw error;
  }

  return { mimeType, data, byteLength };
}

export function buildKaraPrompt({
  question,
  timestampSeconds = 0,
  timestampLabel = '0:00',
  lessonTitle = '',
  lessonPlan = null,
  chatHistory = [],
  frameAvailable = true
}) {
  return `Sen Kara Tahta icindeki "Kara" adli egitim asistanisin.

Ogrenci video izlerken bir soru sordu. ${frameAvailable
    ? 'Bu istekte, ogrencinin soruyu sordugu anda videoda gorunen gercek kare de bulunuyor.'
    : 'Bu istekte video karesi teknik olarak incelenemedi; yalnizca timestamp, ders plani ve sohbet baglami bulunuyor.'}

ZORUNLU CEVAP KURALLARI:
- Turkce cevap ver.
- ${frameAvailable
    ? 'Once video karesini dikkatle incele; ekrandaki baslik, formuller, sekiller, etiketler, vurgular ve mevcut animasyon durumunu soruyla birlikte yorumla.'
    : 'Gormedigin bir ekran ayrintisini gordugunu iddia etme; gerekiyorsa karenin incelenemedigini tek cumleyle belirt.'}
- Kare tek bir andir. Kareden once veya sonra ne oldugunu kesin biliyormus gibi davranma; zaman akisina dair bilgiyi ders plani ve sohbetten ayir.
- Gorselde gercekten gorulen bilgiyle ders planindan cikardigin bilgiyi birbirine karistirma.
- Ilk once soruyu kisa cevapla, sonra gerekiyorsa adim adim acikla.
- Matematiksel ifadeleri LaTeX ile yaz: satir ici icin \\(...\\), ayri denklem icin \\[...\\].
- Gereksiz uzun cevap verme; ogrencinin takildigi yeri ac.
- Onceki konusmalar varsa baglami koru, ama eski cevabi aynen tekrar etme.
- Baglam yeterli degilse bunu nazikce soyle ve yine de eldeki bilgiyle yardim et.

Ders basligi: ${lessonTitle || 'Bilinmiyor'}
Timestamp: ${timestampLabel} (${Number(timestampSeconds || 0).toFixed(1)} saniye)

Cikarilan ders plani:
${lessonPlan ? JSON.stringify(lessonPlan, null, 2) : 'Yok'}

Onceki konusmalar:
${chatHistory.length ? JSON.stringify(chatHistory, null, 2) : 'Yok'}

Ogrencinin yeni sorusu:
${String(question || '').trim()}`;
}

export function buildGeminiVisionRequest({ prompt, frame, model = 'gemini-2.5-flash', maxOutputTokens = 1200 }) {
  const isGemini25 = String(model).startsWith('gemini-2.5-');
  return {
    contents: [{
      role: 'user',
      parts: [
        { inline_data: { mime_type: frame.mimeType, data: frame.data } },
        { text: prompt }
      ]
    }],
    generationConfig: {
      maxOutputTokens,
      ...(isGemini25 ? {
        temperature: 0.35,
        thinkingConfig: { thinkingBudget: 0 }
      } : {})
    }
  };
}

export function extractGeminiText(payload) {
  const text = (payload?.candidates?.[0]?.content?.parts || [])
    .map((part) => String(part?.text || ''))
    .join('')
    .trim();
  if (text) return text;

  const reason = payload?.promptFeedback?.blockReason
    || payload?.candidates?.[0]?.finishReason
    || payload?.error?.message
    || 'bos yanit';
  throw new Error(`Gemini Kara yaniti alinamadi: ${reason}`);
}

export async function generateKaraVisionAnswer({
  apiKey,
  model = 'gemini-2.5-flash',
  prompt,
  frame,
  timeoutMs = 45000,
  fetchImpl = fetch
}) {
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY tanimli degil.');
  }

  const response = await fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify(buildGeminiVisionRequest({ prompt, frame, model })),
      signal: AbortSignal.timeout(timeoutMs)
    }
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`Gemini Kara istegi basarisiz (${response.status}): ${payload?.error?.message || response.statusText}`);
    error.statusCode = response.status === 429 ? 503 : 502;
    error.geminiStatus = response.status;
    error.geminiCode = payload?.error?.status || null;
    throw error;
  }

  return extractGeminiText(payload);
}

export function classifyKaraVisionError(error) {
  const status = Number(error?.geminiStatus || 0);
  const message = String(error?.message || '').toLowerCase();
  const projectWide = status === 401
    || /api key not valid|api_key_invalid|prepayment credits|credits? (?:are )?depleted|billing account|billing.*(?:disabled|required)/i.test(message);
  const modelUnavailable = status === 400 || status === 403 || status === 404;
  const quotaOrCredit = status === 429 || /resource_exhausted|quota|rate limit|credit/i.test(message);
  const transient = !status
    || status === 408
    || status === 499
    || status >= 500
    || /timeout|timed out|fetch failed|econnreset|etimedout|unavailable/i.test(message);

  return {
    projectWide,
    failover: projectWide || modelUnavailable || quotaOrCredit || transient,
    cooldownMs: projectWide
      ? 5 * 60 * 1000
      : modelUnavailable
        ? 60 * 60 * 1000
        : quotaOrCredit
          ? DEFAULT_MODEL_COOLDOWN_MS
          : transient
            ? 15 * 1000
            : 0,
    reason: projectWide
      ? 'project_access_or_credit'
      : quotaOrCredit
        ? 'quota_or_rate_limit'
        : modelUnavailable
          ? 'model_unavailable'
          : transient
            ? 'temporary_failure'
            : 'request_failure'
  };
}

export async function generateKaraVisionAnswerWithFallback({
  apiKey,
  models,
  prompt,
  frame,
  timeoutMs = 45000,
  fetchImpl = fetch,
  cooldowns = karaModelCooldowns,
  now = () => Date.now()
}) {
  const modelPool = parseKaraVisionModels(models);
  if (!modelPool.length) {
    throw new Error('Kara icin en az bir Gemini vision modeli tanimlanmali.');
  }

  const attemptedModels = [];
  const skippedModels = [];
  let lastError;

  for (const model of modelPool) {
    const cooldownUntil = Number(cooldowns.get(model) || 0);
    if (cooldownUntil > now()) {
      skippedModels.push({ model, reason: 'cooldown', retryAfterMs: cooldownUntil - now() });
      continue;
    }

    try {
      const answer = await generateKaraVisionAnswer({
        apiKey,
        model,
        prompt,
        frame,
        timeoutMs,
        fetchImpl
      });
      cooldowns.delete(model);
      return { answer, model, attemptedModels: [...attemptedModels, model], skippedModels };
    } catch (error) {
      lastError = error;
      const classification = classifyKaraVisionError(error);
      attemptedModels.push(model);
      if (classification.cooldownMs) {
        cooldowns.set(model, now() + classification.cooldownMs);
      }
      if (classification.projectWide || !classification.failover) {
        error.karaVisionAttempts = attemptedModels;
        error.karaVisionSkipped = skippedModels;
        error.karaVisionReason = classification.reason;
        throw error;
      }
    }
  }

  const error = lastError || new Error('Tum Kara vision modelleri gecici olarak beklemede.');
  error.karaVisionAttempts = attemptedModels;
  error.karaVisionSkipped = skippedModels;
  error.karaVisionReason = lastError ? classifyKaraVisionError(lastError).reason : 'all_models_cooling_down';
  throw error;
}
