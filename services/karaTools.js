import { classifyKaraVisionError, parseKaraVisionModels } from './karaVision.js';

export const generateManimTool = {
  name: 'generate_manim',
  description: 'Manim ile ders sorusunu aciklayan tek karelik egitici bir gorsel uretir. Ogrenci bir seyi gorsellestirmeyi, cizmeni, gostermeni veya sekil/diagram/formul sahnesi olusturmani istediginde kullan.',
  parameters: {
    type: 'OBJECT',
    properties: {
      title: {
        type: 'STRING',
        description: 'Gorselin kisa Turkce basligi.'
      },
      visual_description: {
        type: 'STRING',
        description: 'Manim sahnesinde bulunacak sekiller, denklemler, etiketler, renkler ve mekansal iliskilerin ayrintili tarifi.'
      },
      teaching_point: {
        type: 'STRING',
        description: 'Gorselin ogrenciye gostermesi gereken tek ana fikir.'
      }
    },
    required: ['visual_description', 'teaching_point']
  }
};

export const webSearchTool = {
  name: 'web_search',
  description: 'Guncel, zamanla degisebilen veya kaynak dogrulamasi gerektiren bir bilgi icin web aramasi yapar. Yalniz mevcut ders/video baglamiyla cevaplanamayan guncel sorularda kullan.',
  parameters: {
    type: 'OBJECT',
    properties: {
      query: {
        type: 'STRING',
        description: 'Webde aranacak acik ve kisa sorgu.'
      }
    },
    required: ['query']
  }
};

export function buildKaraTools() {
  return [{ functionDeclarations: [webSearchTool, generateManimTool] }];
}

export function extractKaraToolResponse(payload) {
  const candidate = payload?.candidates?.[0];
  const content = candidate?.content || null;
  const parts = Array.isArray(content?.parts) ? content.parts : [];
  const answer = parts.map((part) => String(part?.text || '')).join('').trim();
  const functionCalls = parts.map((part) => part?.functionCall).filter(Boolean);
  const grounding = candidate?.groundingMetadata || {};
  const sources = (grounding.groundingChunks || [])
    .map((chunk) => chunk?.web)
    .filter((web) => web?.uri)
    .map((web) => ({ url: web.uri, title: String(web.title || web.uri).slice(0, 240) }));
  const webSearchUsed = Boolean(
    sources.length
    || grounding.webSearchQueries?.length
    || parts.some((part) => /GOOGLE_SEARCH/i.test(String(part?.toolCall?.toolType || '')))
  );

  return {
    answer,
    content,
    functionCalls,
    sources: [...new Map(sources.map((source) => [source.url, source])).values()],
    webSearchUsed
  };
}

async function callGeminiTools({ apiKey, model, body, timeoutMs, fetchImpl }) {
  const response = await fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    }
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`Gemini Kara tool istegi basarisiz (${response.status}): ${payload?.error?.message || response.statusText}`);
    error.statusCode = response.status === 429 ? 503 : 502;
    error.geminiStatus = response.status;
    error.geminiCode = payload?.error?.status || payload?.error?.code || null;
    throw error;
  }
  return payload;
}

function initialContents(prompt, frame) {
  return [{
    role: 'user',
    parts: [
      { inlineData: { mimeType: frame.mimeType, data: frame.data } },
      { text: prompt }
    ]
  }];
}

function toolRequest(contents) {
  return {
    contents,
    tools: buildKaraTools(),
    toolConfig: {
      functionCallingConfig: { mode: 'VALIDATED' }
    },
    generationConfig: { maxOutputTokens: 1600 }
  };
}

export async function runKaraTools({
  apiKey,
  models,
  prompt,
  frame,
  executeGenerateManim,
  executeWebSearch,
  timeoutMs = 45000,
  fetchImpl = fetch
}) {
  const modelPool = parseKaraVisionModels(models).filter((model) => /^gemini-3(?:\.|-)/.test(model));
  if (!modelPool.length) {
    throw new Error('Kara tool calling icin Gemini 3 modeli bulunamadi.');
  }

  const attemptedModels = [];
  let firstPayload;
  let firstResponse;
  let selectedModel;
  let lastError;
  const contents = initialContents(prompt, frame);

  for (const model of modelPool) {
    attemptedModels.push(model);
    try {
      firstPayload = await callGeminiTools({
        apiKey,
        model,
        body: toolRequest(contents),
        timeoutMs,
        fetchImpl
      });
      firstResponse = extractKaraToolResponse(firstPayload);
      selectedModel = model;
      break;
    } catch (error) {
      lastError = error;
      if (classifyKaraVisionError(error).projectWide) break;
    }
  }

  if (!selectedModel) {
    const error = lastError || new Error('Kara tool modelleri yanit vermedi.');
    error.karaToolAttempts = attemptedModels;
    throw error;
  }

  const toolsUsed = firstResponse.webSearchUsed ? ['web_search'] : [];
  const artifacts = [];
  let answer = firstResponse.answer;
  let sources = firstResponse.sources;
  const manimCall = firstResponse.functionCalls.find((call) => call?.name === 'generate_manim');
  const webSearchCall = firstResponse.functionCalls.find((call) => call?.name === 'web_search');

  if (manimCall) {
    if (typeof executeGenerateManim !== 'function') {
      throw new Error('generate_manim calistiricisi tanimli degil.');
    }
    toolsUsed.push('generate_manim');
    const artifact = await executeGenerateManim(manimCall.args || {});
    artifacts.push({
      type: 'image',
      mimeType: artifact.mimeType,
      url: artifact.url,
      title: artifact.title || manimCall.args?.title || 'Kara Manim görseli'
    });

    const secondContents = [
      ...contents,
      firstResponse.content,
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: 'generate_manim',
              id: manimCall.id,
              response: {
                ok: true,
                title: artifact.title || null,
                message: 'Manim gorseli basariyla render edildi. Gorseli inceleyip ogrenciye acikla.'
              }
            }
          },
          { inlineData: { mimeType: artifact.mimeType, data: artifact.data } },
          { text: 'Olusturulan Manim gorselini incele. Soruyu kisa cevapla, ardindan gorseldeki ogeleri ve bunlarin ana fikri nasil gosterdigini Turkce acikla. generate_manim aracini tekrar cagirma.' }
        ]
      }
    ];
    const finalPayload = await callGeminiTools({
      apiKey,
      model: selectedModel,
      body: toolRequest(secondContents),
      timeoutMs,
      fetchImpl
    });
    const finalResponse = extractKaraToolResponse(finalPayload);
    answer = finalResponse.answer || answer || 'Manim görselini oluşturdum; ana fikir görselde adım adım gösteriliyor.';
    sources = [...new Map([...sources, ...finalResponse.sources].map((source) => [source.url, source])).values()];
  } else if (webSearchCall) {
    toolsUsed.push('web_search');
    const query = String(webSearchCall.args?.query || '').trim().slice(0, 500);
    let functionResponse;
    try {
      if (typeof executeWebSearch !== 'function') {
        throw new Error('web_search calistiricisi tanimli degil.');
      }
      const searchResponse = await executeWebSearch(query);
      const searchSources = (searchResponse?.results || []).map((result) => ({
        url: result.url,
        title: result.title
      }));
      sources = [...new Map([...sources, ...searchSources].map((source) => [source.url, source])).values()];
      functionResponse = {
        ok: true,
        query,
        provider: searchResponse.provider,
        results: searchResponse.results
      };
    } catch (error) {
      functionResponse = {
        ok: false,
        query,
        error: 'Web araması kotası veya servisi şu anda kullanılamıyor. Güncel bilgi doğrulanamadı.'
      };
    }

    const finalPayload = await callGeminiTools({
      apiKey,
      model: selectedModel,
      body: toolRequest([
        ...contents,
        firstResponse.content,
        {
          role: 'user',
          parts: [{
            functionResponse: {
              name: 'web_search',
              id: webSearchCall.id,
              response: functionResponse
            }
          }]
        }
      ]),
      timeoutMs,
      fetchImpl
    });
    const finalResponse = extractKaraToolResponse(finalPayload);
    answer = finalResponse.answer || 'Web araması şu anda kullanılamıyor; güncel bilgiyi doğrulayamıyorum.';
    sources = [...new Map([...sources, ...finalResponse.sources].map((source) => [source.url, source])).values()];
  }

  if (!answer) {
    throw new Error('Kara tool modeli metin yaniti dondurmedi.');
  }

  return {
    answer,
    model: selectedModel,
    attemptedModels,
    toolsUsed,
    artifacts,
    sources
  };
}
