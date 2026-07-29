import 'dotenv/config';

import { GoogleGenAI } from '@google/genai';
import textToSpeech from '@google-cloud/text-to-speech';
import express from 'express';
import { Agent, setGlobalDispatcher } from 'undici';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { synthesizeWithEdgeTts } from './services/edgeTts.js';
import {
  DEFAULT_GEMINI_FALLBACK_MODELS,
  runGeminiModelRoute
} from './services/geminiRouter.js';
import { compactChatHistory, compactLessonPlanContext } from './services/karaContext.js';
import { sanitizeManimForLocalRender as sanitizeManimCompatibility } from './services/manimSanitizer.js';
import {
  buildBurnSubtitleArgs,
  buildConcatArgs,
  buildMuxArgs,
  buildTimedSubtitleSrt
} from './services/videoPostprocess.js';
import {
  appendGenerationEvent,
  createGenerationJob,
  createLesson,
  extensionFromContentType,
  fileNameFromLocalPath,
  getProfileForAccessToken,
  getOrCreateChat,
  getLessonForUser,
  getLessonDetailForUser,
  getLessonVideoForUser,
  refreshAuthSession,
  requestPasswordReset,
  getSegment,
  saveAttachment,
  saveChatMessage,
  saveLessonVideo,
  saveManimCode,
  savePlan,
  saveSegments,
  saveSpeechScript,
  saveTtsOutput,
  saveVideoRender,
  listLessonsForUser,
  signInWithPassword,
  signUpWithPassword,
  supabaseConfigured,
  updatePasswordWithAccessToken,
  updateGenerationJob,
  updateLesson,
  updateSegment
} from './services/supabaseStore.js';
import {
  createStorageSignedUrl,
  mediaStorageProvider,
  railwayMediaConfigured,
  storagePathFor,
  uploadDataUrl,
  uploadLocalFile
} from './services/mediaStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const miktexBinCandidates = [
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'MiKTeX', 'miktex', 'bin', 'x64'),
  'C:\\Program Files\\MiKTeX\\miktex\\bin\\x64'
].filter(Boolean);
const miktexBin = miktexBinCandidates.find((candidate) => (
  existsSync(path.join(candidate, 'latex.exe')) && existsSync(path.join(candidate, 'dvisvgm.exe'))
));

if (miktexBin) {
  process.env.Path = `${miktexBin};${process.env.Path || ''}`;
  process.env.PATH = `${miktexBin};${process.env.PATH || ''}`;
}

setGlobalDispatcher(new Agent({
  connect: {
    timeout: 60000
  },
  headersTimeout: 180000,
  bodyTimeout: 300000
}));

const app = express();
const port = Number(process.env.PORT || 3000);
const authRequired = String(process.env.AUTH_REQUIRED || 'true').toLowerCase() !== 'false';
const authRedirectUrl = String(process.env.AUTH_REDIRECT_URL || '').trim();
const signedVideoUrlTtlSeconds = process.env.SUPABASE_SIGNED_URL_TTL_SECONDS || 3600;
const corsOrigins = String(process.env.CORS_ORIGIN || process.env.CORS_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

function authCallbackUrl(flow) {
  if (!authRedirectUrl) {
    return undefined;
  }
  const url = new URL(authRedirectUrl);
  url.searchParams.set('auth', flow);
  return url.toString();
}
const llmProvider = String(process.env.LLM_PROVIDER || (process.env.GROQ_API_KEY ? 'groq' : 'gemini')).toLowerCase();
const defaultGeminiModel = 'gemini-3-flash-preview';
const legacyGeminiModels = new Set(['gemini-2.5-flash', 'gemini-2.5-pro']);
const resolveGeminiModel = (model) => {
  const requestedModel = String(model || defaultGeminiModel).trim();
  return legacyGeminiModels.has(requestedModel) ? defaultGeminiModel : requestedModel;
};
const geminiPlanModel = resolveGeminiModel(process.env.GEMINI_PLAN_MODEL || process.env.GEMINI_MODEL);
const geminiCodeModel = resolveGeminiModel(process.env.GEMINI_CODE_MODEL || process.env.GEMINI_MODEL);
const geminiFallbackModels = String(
  process.env.GEMINI_FALLBACK_MODELS || DEFAULT_GEMINI_FALLBACK_MODELS.join(',')
)
  .split(',')
  .map(resolveGeminiModel)
  .filter(Boolean);
const groqPlanModel = process.env.GROQ_PLAN_MODEL || 'openai/gpt-oss-120b';
const groqCodeModel = process.env.GROQ_CODE_MODEL || 'qwen/qwen3-32b';
const planModel = llmProvider === 'groq' ? groqPlanModel : geminiPlanModel;
const codeModel = llmProvider === 'groq' ? groqCodeModel : geminiCodeModel;
const groqBaseUrl = process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1';
const manimQuality = process.env.MANIM_QUALITY || '-qm';
const manimFont = process.env.MANIM_FONT || 'Georgia';
const mathTexMode = String(process.env.MANIM_ENABLE_MATHTEX || 'auto').toLowerCase();
const mathTexAvailable = mathTexMode === '1' || mathTexMode === 'true' || (mathTexMode === 'auto' && Boolean(miktexBin));
const musicVolume = Number(process.env.BACKGROUND_MUSIC_VOLUME || 0.1);
const musicFadeSeconds = Number(process.env.BACKGROUND_MUSIC_FADE_SECONDS || 1);
const speechVolume = Number(process.env.SPEECH_VOLUME || 1.25);
const targetVideoMinutes = Number(process.env.TARGET_VIDEO_MINUTES || 10);
const targetSegmentCount = Number(process.env.TARGET_SEGMENT_COUNT || 8);
const geminiApiKey = process.env.GEMINI_API_KEY;
const groqApiKey = process.env.GROQ_API_KEY;
const apiKey = llmProvider === 'groq' ? groqApiKey : geminiApiKey;
const ai = geminiApiKey ? new GoogleGenAI({ apiKey: geminiApiKey }) : null;
const googleCredentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  ? path.resolve(__dirname, process.env.GOOGLE_APPLICATION_CREDENTIALS)
  : null;
const googleCredentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const googleTtsApiKey = process.env.GOOGLE_TTS_API_KEY;
const googleTtsVoice = process.env.GOOGLE_TTS_VOICE || 'tr-TR-Wavenet-E';
const googleTtsSpeakingRate = Number(process.env.GOOGLE_TTS_SPEAKING_RATE || 0.96);
const ttsProvider = String(process.env.TTS_PROVIDER || 'edge').toLowerCase();
const edgeTtsVoice = process.env.EDGE_TTS_VOICE || 'tr-TR-AhmetNeural';
const edgeTtsRate = process.env.EDGE_TTS_RATE || '+0%';
const ttsClient = googleCredentialsPath
  ? new textToSpeech.TextToSpeechClient({ keyFilename: googleCredentialsPath })
  : googleCredentialsJson
    ? new textToSpeech.TextToSpeechClient({ credentials: JSON.parse(googleCredentialsJson) })
    : googleTtsApiKey
      ? new textToSpeech.TextToSpeechClient({ apiKey: googleTtsApiKey })
      : null;

const publicDir = path.resolve(__dirname, '../frontend/public');
const rendersDir = path.join(__dirname, 'renders');
const downloadsDir = path.join(__dirname, 'downloads');
const musicExtensions = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.mp4']);
const fullVideoJobs = new Map();
const speechConcurrency = Number(process.env.SPEECH_CONCURRENCY || 3);
const ttsConcurrency = Number(process.env.TTS_CONCURRENCY || 4);
const codeConcurrency = Number(process.env.CODE_CONCURRENCY || 2);
const renderConcurrency = Number(process.env.RENDER_CONCURRENCY || 1);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (corsOrigins.includes('*') || corsOrigins.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.json({ limit: '20mb' }));
app.use(express.static(publicDir));
app.use('/renders', express.static(rendersDir));

function createLimiter(maxConcurrent) {
  let active = 0;
  const queue = [];

  const runNext = () => {
    if (active >= maxConcurrent || !queue.length) {
      return;
    }

    active += 1;
    const { task, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(task)
      .then(resolve, reject)
      .finally(() => {
        active -= 1;
        runNext();
      });
  };

  return (task) => new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    runNext();
  });
}

const limitSpeech = createLimiter(speechConcurrency);
const limitTts = createLimiter(ttsConcurrency);
const limitCode = createLimiter(codeConcurrency);
const limitRender = createLimiter(renderConcurrency);

function logInfo(message, meta = null) {
  const stamp = new Date().toLocaleTimeString('tr-TR', { hour12: false });
  const suffix = meta ? ` ${JSON.stringify(meta)}` : '';
  console.log(`[${stamp}] ${message}${suffix}`);
}

async function persist(label, fn) {
  if (!supabaseConfigured) {
    return null;
  }
  try {
    return await fn();
  } catch (error) {
    logInfo(`Supabase kaydi atlandi: ${label}`, { error: error.message });
    return null;
  }
}

function bearerTokenFromRequest(req) {
  const header = String(req.headers.authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

async function resolveRequestUser(req) {
  if (req.userContext) {
    return req.userContext;
  }

  const token = bearerTokenFromRequest(req);
  if (token) {
    const profile = await getProfileForAccessToken(token);
    req.userContext = {
      profileId: profile.id,
      profile,
      mode: 'auth'
    };
    return req.userContext;
  }

  if (authRequired) {
    const error = new Error('Giris yapman gerekiyor.');
    error.statusCode = 401;
    throw error;
  }

  req.userContext = {
    profileId: process.env.DEV_USER_ID,
    profile: null,
    mode: 'dev'
  };
  return req.userContext;
}

async function requireOwnedLesson(lessonId, userContext) {
  if (!lessonId || !supabaseConfigured) {
    return null;
  }
  const lesson = await getLessonForUser({ lessonId, userId: userContext.profileId });
  if (!lesson) {
    const error = new Error('Ders bulunamadi veya bu kullaniciya ait degil.');
    error.statusCode = 403;
    throw error;
  }
  return lesson;
}

async function createVideoAccessPayload(video) {
  const storagePath = video?.video_storage_path;
  if (!storagePath) {
    return {
      videoUrl: null,
      videoUrlExpiresInSeconds: null,
      videoUrlExpiresAt: null
    };
  }
  const signed = await createStorageSignedUrl({
    bucket: 'videos',
    storagePath,
    expiresInSeconds: signedVideoUrlTtlSeconds
  });
  return {
    videoUrl: signed.signedUrl,
    videoUrlExpiresInSeconds: signed.expiresInSeconds,
    videoUrlExpiresAt: signed.expiresAt
  };
}

app.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    if (req.path.startsWith('/renders') || req.path === '/styles.css' || req.path === '/app.js') {
      return;
    }
    logInfo(`${req.method} ${req.path} -> ${res.statusCode} (${Date.now() - started} ms)`);
  });
  next();
});

function getPromptSections(markdown) {
  const plannerStart = markdown.indexOf('## 1.');
  const coderStart = markdown.indexOf('## 2.');

  if (plannerStart === -1 || coderStart === -1) {
    throw new Error('sistem.md icinde "## 1." ve "## 2." basliklari bulunamadi.');
  }

  return {
    planner: markdown.slice(plannerStart, coderStart).trim(),
    coder: markdown.slice(coderStart).trim()
  };
}

async function loadPrompts() {
  const markdown = await fs.readFile(path.join(__dirname, 'sistem.md'), 'utf8');
  return getPromptSections(markdown);
}

function normalizeManimGuide(markdown) {
  return String(markdown || '')
    .replace(/^---[\s\S]*?---\s*/, '')
    .trim()
    .slice(0, 30000);
}

async function readOptionalMarkdown(relativePath) {
  try {
    const markdown = await fs.readFile(path.join(__dirname, relativePath), 'utf8');
    return normalizeManimGuide(markdown);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      logInfo(`${relativePath} okunamadi; atlandi`, { error: error.message });
    }
    return '';
  }
}

async function loadManimGuide() {
  const sections = [];
  const rootGuide = await readOptionalMarkdown('manim.md');
  if (rootGuide) {
    sections.push(`## Kaynak: manim.md\n\n${rootGuide}`);
  }

  const skillGuide = await readOptionalMarkdown(path.join('skill', 'skill.md'));
  if (skillGuide) {
    sections.push(`## Kaynak: skill/skill.md\n\n${skillGuide}`);
  }

  try {
    const rulesDir = path.join(__dirname, 'skill', 'rules');
    const entries = await fs.readdir(rulesDir, { withFileTypes: true });
    const ruleFiles = entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
      .map((entry) => entry.name)
      .sort();

    for (const fileName of ruleFiles) {
      const relativePath = path.join('skill', 'rules', fileName);
      const ruleGuide = await readOptionalMarkdown(relativePath);
      if (ruleGuide) {
        sections.push(`## Kaynak: ${relativePath.replaceAll(path.sep, '/')}\n\n${ruleGuide}`);
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      logInfo('skill/rules klasoru okunamadi; rule dosyalari atlandi', { error: error.message });
    }
  }

  if (!sections.length) {
    return '';
  }

  logInfo('Manim yerel rehberleri yuklendi', { sections: sections.length });
  return sections.join('\n\n---\n\n').slice(0, 45000);
}

function buildManimSystemInstruction(coderPrompt, manimGuide) {
  const mathRule = mathTexAvailable
    ? '- LaTeX/dvisvgm bu makinede hazir. Matematiksel ifade, kok, limit, kesir, integral, us/alt simge ve semboller icin MathTex kullan; aciklama cumleleri icin Text(..., font=' + JSON.stringify(manimFont) + ') kullan. MathTex ifadelerini raw string olarak yaz: MathTex(r"...").'
    : '- Bu makinede LaTeX/dvisvgm bulunmuyor. MathTex/Tex kullanma. Formul, sayi ve etiketleri Text(..., font=' + JSON.stringify(manimFont) + ') ile kur; matematiksel ifadeleri kisa ve okunabilir metin parcalarina ayir.';
  const appRules = `
## Kara Tahta Manim Uygulama Kurallari
Bu uygulama Manim kodunu otomatik bir segment pipeline'inda calistirir. Bu yuzden asagidaki yerel kurallar, varsa manim.md veya skill klasoru icindeki genel talimatlardan daha onceliklidir:
- Sadece tek Python dosyasi icin kod dondur; markdown, aciklama, plan.md, concat.txt veya proje klasoru talimati yazma.
- Tek Scene veya MovingCameraScene sinifi kullan. Birden fazla scene/class uretme.
- Kod from manim import * ile baslasin ve Manim Community v0.20.1 ile calissin.
${mathRule}
- self.camera.frame kullanacaksan sinif MovingCameraScene olmali.
- Ekranda konusma metnini tam paragraf halinde basma; kisa basliklar, adimlar, anahtar kelimeler ve gorsel ispat akisi kullan.
- Segment suresi ses suresine yakin olmali; finalde gereksiz uzun bekleme birakma.
- manim.md veya skill klasoru icindeki planlama, viewer calistirma, klasor olusturma veya harici skill cagirma talimatlarini bu uygulamada uygulama.
`;

  if (!manimGuide) {
    return `${coderPrompt}\n\n${appRules}`;
  }

  const mathGuideNote = mathTexAvailable
    ? 'MathTex/Tex onerilerini matematiksel ifadelerde uygula; yine de layout guvenligi icin boyutlari kontrol et.'
    : 'MathTex/Tex onerilerini LaTeX kurulu olmadigi icin uygulama; ayni gorsel amaci Text, VGroup, Line, Arrow, SurroundingRectangle ve basit geometrilerle kur.';

  return `${coderPrompt}\n\n${appRules}\n\n## Yerel Manim Rehberleri\nAsagidaki rehberleri yalnizca yukaridaki uygulama kurallariyla uyumlu olan gorsel kalite, animasyon tasarimi, layout guvenligi, sahne akisi ve hata onleme onerileri icin kullan. ${mathGuideNote}\n\n${manimGuide}`;
}

function requireGemini() {
  if (!ai) {
    const error = new Error('.env icindeki GEMINI_API_KEY bos. Once API anahtarini girin.');
    error.statusCode = 400;
    throw error;
  }

  return ai;
}

function requireGroq() {
  if (!groqApiKey) {
    const error = new Error('.env icindeki GROQ_API_KEY bos. Once API anahtarini girin.');
    error.statusCode = 400;
    throw error;
  }

  return groqApiKey;
}

async function generateGeminiContent({ label = 'Gemini', model, contents, config }) {
  const gemini = requireGemini();
  return runGeminiModelRoute({
    primaryModel: model,
    fallbackModels: geminiFallbackModels,
    generate: (candidateModel) => withRetry(label, () => gemini.models.generateContent({
      model: candidateModel,
      contents,
      config
    })),
    onModelFailure: ({ model: failedModel, nextModel, error }) => {
      logInfo(`${label}: model fallback`, {
        failedModel,
        nextModel,
        reason: String(error?.message || error?.status || 'unknown').slice(0, 240)
      });
    }
  });
}

async function generateLlmText({
  label,
  model,
  systemInstruction,
  userText,
  json = false,
  temperature = 0.4,
  maxCompletionTokens = null
}) {
  const started = Date.now();
  logInfo(`${label || llmProvider}: istek basladi`, { provider: llmProvider, model });
  if (llmProvider === 'groq') {
    requireGroq();
    const body = {
      model,
      messages: [
        ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []),
        { role: 'user', content: userText }
      ],
      temperature
    };

    // Groq JSON mode can reject long schema-like prompts; prompts already demand JSON,
    // and safeJsonParse extracts the first valid object from normal chat output.
    if (maxCompletionTokens) {
      body.max_completion_tokens = maxCompletionTokens;
    }
    if (model.includes('gpt-oss')) {
      body.reasoning_effort = process.env.GROQ_REASONING_EFFORT || 'medium';
    }
    if (model.includes('qwen')) {
      body.reasoning_effort = process.env.GROQ_QWEN_REASONING_EFFORT || 'none';
    }

    const response = await withRetry(label || 'Groq', async () => {
      const groqResponse = await fetch(`${groqBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${groqApiKey}`
        },
        body: JSON.stringify(body)
      });

      const data = await groqResponse.json().catch(() => ({}));
      if (!groqResponse.ok) {
        const message = data.error?.message || data.message || `Groq istegi basarisiz oldu (${groqResponse.status}).`;
        const error = new Error(message);
        error.statusCode = groqResponse.status;
        error.details = data;
        throw error;
      }
      return data;
    });

    const text = response.choices?.[0]?.message?.content || '';
    logInfo(`${label || 'Groq'}: yanit geldi`, { model, ms: Date.now() - started, chars: text.length });
    return text;
  }

  const { response, model: usedModel } = await generateGeminiContent({
    label: label || 'Gemini',
    model,
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    config: {
      ...(systemInstruction ? { systemInstruction } : {}),
      ...(json ? { responseMimeType: 'application/json' } : {}),
      temperature
    }
  });

  const text = response.text || '';
  logInfo(`${label || 'Gemini'}: yanit geldi`, { model: usedModel, ms: Date.now() - started, chars: text.length });
  return text;
}

function requireTts() {
  if (!ttsClient || (!googleCredentialsPath && !googleCredentialsJson && !googleTtsApiKey)) {
    const error = new Error('.env icinde GOOGLE_TTS_API_KEY, GOOGLE_APPLICATION_CREDENTIALS veya GOOGLE_APPLICATION_CREDENTIALS_JSON eksik.');
    error.statusCode = 400;
    throw error;
  }

  return ttsClient;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeNetworkError(error, serviceName) {
  if (String(error?.message || '').toLowerCase() === 'fetch failed') {
    const cause = error.cause?.code || error.cause?.message || 'ag baglantisi kurulamadi';
    const wrapped = new Error(`${serviceName} baglantisi basarisiz: ${cause}. Bu bazen servis endpoint'i yavas cevap verdiginde olur; istek otomatik tekrar denendi, yine olmazsa biraz sonra tekrar deneyin.`);
    wrapped.statusCode = 502;
    wrapped.cause = error;
    return wrapped;
  }
  return error;
}

async function withRetry(label, task, retries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = normalizeNetworkError(error, label);
      const message = String(error?.message || '');
      const retryable = message.toLowerCase() === 'fetch failed'
        || /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT/i.test(String(error?.cause?.code || error?.cause?.message || ''));
      if (!retryable || attempt === retries) {
        throw lastError;
      }
      await sleep(750 * (attempt + 1));
    }
  }
  throw lastError;
}

function safeJsonParse(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const jsonText = extractFirstJsonObject(trimmed);
    if (jsonText) {
      return JSON.parse(jsonText);
    }
    throw new Error('LLM yaniti gecerli JSON olarak okunamadi.');
  }
}

function extractFirstJsonObject(text) {
  const start = text.indexOf('{');
  if (start === -1) {
    return null;
  }

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

    if (inString) {
      continue;
    }

    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}

function stripCodeFence(text) {
  let code = text.trim();
  const fenceMatch = code.match(/^```(?:python|py)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch) {
    code = fenceMatch[1].trim();
  }
  return code;
}

function normalizeImagePayload(image) {
  const rawData = String(image?.data || '');
  const mimeType = String(image?.mimeType || image?.mime_type || '').trim();
  const data = rawData.includes(',')
    ? rawData.slice(rawData.indexOf(',') + 1)
    : rawData;

  if (!data || !mimeType.startsWith('image/')) {
    const error = new Error('Gecerli bir soru fotografi bekleniyor.');
    error.statusCode = 400;
    throw error;
  }

  return { mimeType, data };
}

async function createQuestionSolutionPlan({ image, studentLevel = 'beginner', note = '' }) {
  const normalizedImage = normalizeImagePayload(image);
  const prompt = `Bu gorselde bir ogrencinin test kitabindan cozemedigi soru var.

Gorev: Soruyu oku, cozumunu yap ve mevcut Manim video pipeline'ina uygun 1 dakikalik Turkce cozum videosu plani uret.

ZORUNLU KURALLAR:
- Sadece gecerli JSON dondur. Markdown yazma.
- Video yaklasik 1 dakika olsun.
- segments dizisi tam olarak 1 segment icersin.
- Segment id degeri "s1" olsun.
- Anlatim ogrenciye dogrudan yardim eden, adim adim cozum diliyle olsun.
- Eger soru tam okunamiyorsa bunu belirtip gorunen kisimdan makul cozum stratejisi anlat.
- Cevabi sadece soyleme; hangi ipucunun neden kullanildigini acikla.
- Manim icin animation.description ve sequence alanlari ayrintili olsun.
- Ekranda soru metninin tamamini basma; gerekli verilenleri, islem adimlarini ve sonucu goster.

JSON sekli:
{
  "topic": "Sorunun kisa adi",
  "estimated_duration_minutes": 1,
  "core_insight": "cozumun ana fikri",
  "hook": { "question": "Bu soruda ne isteniyor?" },
  "analogy": { "everyday_scenario": "kisa sezgisel benzetme" },
  "common_misconceptions": [
    { "misconception": "olasi hata", "correction": "duzeltme" }
  ],
  "segments": [
    {
      "id": "s1",
      "title": "Adim adim cozum",
      "duration_seconds": 60,
      "learning_objective": "Bu soruyu cozerken kullanilacak ana fikir",
      "narration": "60 saniyelik dogal Turkce cozum anlatimi",
      "animation": {
        "type": "worked_example",
        "description": "Tahtada gosterilecek cozum akisi",
        "sequence": ["verilenleri yaz", "ana iliskiyi kur", "islemleri yap", "sonucu vurgula"]
      }
    }
  ]
}

Ogrenci seviyesi: ${studentLevel}
Ek not: ${note || 'Yok'}`;

  logInfo('Soru fotografi icin Gemini cozum plani basladi', { model: geminiPlanModel });
  const started = Date.now();
  const { response, model: usedModel } = await generateGeminiContent({
    model: geminiPlanModel,
    contents: [{
      role: 'user',
      parts: [
        { text: prompt },
        { inlineData: normalizedImage }
      ]
    }],
    config: {
      responseMimeType: 'application/json',
      temperature: 0.35
    }
  });

  const plan = safeJsonParse(response.text || '');
  logInfo('Soru fotografi cozum plani tamamlandi', {
    ms: Date.now() - started,
    model: usedModel,
    topic: plan.topic,
    segments: Array.isArray(plan.segments) ? plan.segments.length : 0
  });
  return plan;
}

async function answerKaraQuestion({
  question,
  frame,
  timestampSeconds = 0,
  timestampLabel = '0:00',
  lessonTitle = '',
  lessonPlan = null,
  chatHistory = []
}) {
  const normalizedFrame = normalizeImagePayload(frame);
  const safeHistory = compactChatHistory(chatHistory);
  const compactLessonPlan = compactLessonPlanContext(lessonPlan);

  const prompt = `Sen Kara Tahta icindeki "Kara" adli egitim asistanisin.

Ogrenci video izlerken bir soru sordu. Sana videonun o anki karesi, timestamp'i ve onceki soru-cevap gecmisi veriliyor.

ZORUNLU CEVAP KURALLARI:
- Turkce cevap ver.
- O anki goruntuyu ve timestamp'i dikkate al.
- Ilk once soruyu kisa cevapla, sonra gerekiyorsa adim adim acikla.
- Matematiksel ifadeleri LaTeX ile yaz: satir ici icin \\(...\\), ayri denklem icin \\[...\\].
- Gereksiz uzun cevap verme; ogrencinin takildigi yeri ac.
- Onceki konusmalar varsa baglami koru, ama eski cevabi aynen tekrar etme.
- Goruntu yeterli degilse bunu nazikce soyle ve yine de eldeki bilgiyle yardim et.

Ders basligi: ${lessonTitle || 'Bilinmiyor'}
Timestamp: ${timestampLabel} (${Number(timestampSeconds || 0).toFixed(1)} saniye)

Cikarilan ders plani:
${compactLessonPlan ? JSON.stringify(compactLessonPlan, null, 2) : 'Yok'}

Onceki konusmalar:
${safeHistory.length ? JSON.stringify(safeHistory, null, 2) : 'Yok'}

Ogrencinin yeni sorusu:
${String(question || '').trim()}`;

  logInfo('Kara soru-cevap Gemini istegi basladi', {
    model: geminiPlanModel,
    timestamp: timestampLabel,
    history: safeHistory.length
  });

  const started = Date.now();
  const { response, model: usedModel } = await generateGeminiContent({
    model: geminiPlanModel,
    contents: [{
      role: 'user',
      parts: [
        { text: prompt },
        { inlineData: normalizedFrame }
      ]
    }],
    config: {
      temperature: 0.35
    }
  });

  const answer = String(response.text || '').trim();
  logInfo('Kara soru-cevap Gemini yaniti geldi', {
    ms: Date.now() - started,
    model: usedModel,
    chars: answer.length
  });

  return { answer, model: usedModel };
}

function toPlainTextFromTex(value) {
  return value
    .replace(/\\\\/g, '\\')
    .replace(/\\cdot/g, '*')
    .replace(/\\times/g, '*')
    .replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, '($1)/($2)')
    .replace(/\\sqrt\s*\{([^{}]+)\}/g, 'sqrt($1)')
    .replace(/\\[a-zA-Z]+/g, '')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeManimForLocalRender(code) {
  let sanitized = sanitizeManimCompatibility(code);

  // DecimalNumber axis labels are fragile in generated code; keep labels explicit.
  sanitized = sanitized.replace(/(["']?include_numbers["']?\s*:\s*)True/g, '$1False');
  sanitized = sanitized.replace(/include_numbers\s*=\s*True/g, 'include_numbers=False');
  sanitized = sanitized.replace(/font\s*=\s*["']DejaVu Sans["']/g, `font=${JSON.stringify(manimFont)}`);
  sanitized = sanitized.replace(/\[(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\]/g, '[$1, $2, 0]');
  sanitized = sanitized.replace(
    /(x_range|y_range)\s*=\s*\[(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*0\]/g,
    '$1=[$2, $3]'
  );

  if (/self\.camera\.frame/.test(sanitized)) {
    sanitized = sanitized.replace(
      /class\s+([A-Za-z_]\w*)\s*\(\s*Scene\s*\)\s*:/,
      'class $1(MovingCameraScene):'
    );
  }

  if (!mathTexAvailable) {
    sanitized = sanitized.replace(
      /MathTex\(\s*r?["']([^"']*)["']\s*(,\s*(?:color|font_size)\s*=\s*[^,)]+)?\s*\)/g,
      (_match, tex, options = '') => {
        const allowedOptions = [];
        const color = options.match(/color\s*=\s*([A-Z_]+)/);
        const fontSize = options.match(/font_size\s*=\s*([0-9]+)/);
        if (color) allowedOptions.push(`color=${color[1]}`);
        if (fontSize) allowedOptions.push(`font_size=${fontSize[1]}`);
        return `Text(${JSON.stringify(toPlainTextFromTex(tex))}, font=${JSON.stringify(manimFont)}${allowedOptions.length ? `, ${allowedOptions.join(', ')}` : ''})`;
      }
    );
  }

  return sanitized;
}

function sanitizeSegmentId(segmentId) {
  return String(segmentId || 's1').replace(/[^\w]/g, '_').slice(0, 40) || 's1';
}

function resolveRenderRelative(relativePath) {
  const cleanRelativePath = String(relativePath || '').replace(/^\/?renders\//, '');
  const fullPath = path.resolve(rendersDir, cleanRelativePath);
  if (!fullPath.startsWith(path.resolve(rendersDir))) {
    throw new Error('Gecersiz render dosya yolu.');
  }
  return fullPath;
}

async function uploadRenderRelative({ bucket, userId, lessonId, segmentKey, kind, relativePath, contentType }) {
  if (!lessonId || !relativePath) {
    return null;
  }
  const localPath = resolveRenderRelative(relativePath);
  const storagePath = storagePathFor({
    userId,
    lessonId,
    segmentKey,
    kind,
    fileName: fileNameFromLocalPath(localPath)
  });
  return uploadLocalFile({ bucket, localPath, storagePath, contentType });
}

function getSceneClassName(code) {
  const match = code.match(/class\s+([A-Za-z_]\w*)\s*\(\s*(?:Scene|MovingCameraScene)\s*\)\s*:/);
  if (!match) {
    throw new Error('Manim kodunda "class ... (Scene):" veya "class ... (MovingCameraScene):" biciminde bir Scene sinifi bulunamadi.');
  }
  return match[1];
}

async function repairManimCodeWithLlm(code, renderOutput, segmentId) {
  const manimGuide = await loadManimGuide();
  const prompt = {
    task: 'Manim Community v0.20.1 kodunu hata mesajina gore duzelt.',
    segment_id: segmentId,
    rules: [
      'Sadece calisabilir Python kodu dondur. Markdown fence veya aciklama yazma.',
      'Dosya from manim import * ile baslamali.',
      'Tek Scene veya MovingCameraScene sinifi olmali.',
      'Kod Manim Community v0.20.1 ile calismali.',
      'expo_out kullanma; üstel yavaşlama gerekiyorsa rate_functions.ease_out_expo kullan.',
      mathTexAvailable
        ? 'LaTeX hazir: matematiksel ifadelerde MathTex(r"...") kullan; aciklama metinlerinde Text(..., font="Georgia") kullan.'
        : 'LaTeX kullanma: MathTex/Tex kullanma; Text(..., font="Georgia") kullan.',
      'Polygon, Line, Dot, move_to gibi noktalarda 3 boyutlu koordinat kullan: [x, y, 0].',
      'include_numbers=True kullanma.',
      'self.camera.frame kullaniliyorsa sinif MovingCameraScene olmali.',
      'Animasyonun pedagojik niyetini koru, yalnizca hatalari duzelt.',
      'manim.md rehberini yalnizca bu uygulamanin tek dosya/tek Scene kurallariyla uyumlu gorsel kalite ve hata onleme onerileri icin kullan.'
    ],
    manim_guide: manimGuide || null,
    render_error: renderOutput.slice(-8000),
    broken_code: code
  };

  const responseText = await generateLlmText({
    label: llmProvider === 'groq' ? 'Groq' : 'Gemini',
    model: codeModel,
    systemInstruction: buildManimSystemInstruction('', manimGuide),
    userText: JSON.stringify(prompt, null, 2),
    temperature: 0.15
  });

  const fixedCode = sanitizeManimForLocalRender(stripCodeFence(responseText || ''));
  getSceneClassName(fixedCode);
  return fixedCode;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd || __dirname,
      shell: false,
      windowsHide: true
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      stderr += '\nRender zaman asimina ugradi.';
    }, options.timeoutMs || 180000);

    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });
}

async function getMediaDurationSeconds(filePath) {
  const result = await runCommand(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
    { timeoutMs: 30000 }
  );

  if (result.code !== 0) {
    throw new Error(`ffprobe sure okuyamadi: ${result.stderr || result.stdout}`);
  }

  return Number.parseFloat(result.stdout.trim());
}

async function listMusicFiles(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return listMusicFiles(fullPath);
      }
      if (entry.isFile() && musicExtensions.has(path.extname(entry.name).toLowerCase())) {
        return [fullPath];
      }
      return [];
    }));
    return nested.flat();
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function pickBackgroundMusic() {
  const files = await listMusicFiles(downloadsDir);
  if (!files.length) {
    return null;
  }

  const index = Math.floor(Math.random() * files.length);
  return files[index];
}

function ffmpegSeconds(value) {
  return Math.max(0, Number(value) || 0).toFixed(3);
}

async function muxAudio(videoPath, audioPath, outputPath, speechText = '') {
  const videoDuration = await getMediaDurationSeconds(videoPath);
  const speechDuration = audioPath ? await getMediaDurationSeconds(audioPath) : null;
  const targetDuration = speechDuration || videoDuration;
  const backgroundMusicPath = await pickBackgroundMusic();

  if (backgroundMusicPath) {
    const fadeDuration = Math.min(musicFadeSeconds, Math.max(0, targetDuration / 2));
    const fadeOutStart = Math.max(0, targetDuration - fadeDuration);
    const args = [
      '-y',
      '-i', videoPath
    ];

    if (audioPath) {
      args.push('-i', audioPath);
    }

    args.push('-stream_loop', '-1', '-i', backgroundMusicPath);

    const musicInputIndex = audioPath ? 2 : 1;
    const filters = [
      `[${musicInputIndex}:a]volume=${musicVolume},atrim=0:${ffmpegSeconds(targetDuration)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${ffmpegSeconds(fadeDuration)},afade=t=out:st=${ffmpegSeconds(fadeOutStart)}:d=${ffmpegSeconds(fadeDuration)}[bg]`
    ];

    if (audioPath) {
      filters.push(`[1:a]volume=${speechVolume},atrim=0:${ffmpegSeconds(targetDuration)},asetpts=PTS-STARTPTS[speech]`);
      filters.push('[speech][bg]amix=inputs=2:duration=first:dropout_transition=0[aout]');
    } else {
      filters.push('[bg]anull[aout]');
    }

    const result = await runCommand(
      'ffmpeg',
      [
        ...args,
        '-filter_complex', filters.join(';'),
        '-map', '0:v:0',
        '-map', '[aout]',
        '-t', ffmpegSeconds(targetDuration),
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-movflags', '+faststart',
        outputPath
      ],
      { timeoutMs: 180000 }
    );

    if (result.code !== 0) {
      const error = new Error('ffmpeg video, ses ve muzik birlestiremedi.');
      error.stdout = result.stdout;
      error.stderr = result.stderr;
      throw error;
    }

    return {
      ...result,
      backgroundMusic: path.relative(__dirname, backgroundMusicPath).replaceAll(path.sep, '/')
    };
  }

  if (!audioPath) {
    return null;
  }

  const muxedPath = speechText ? `${outputPath}.mux.mp4` : outputPath;
  const result = await runCommand(
    'ffmpeg',
    buildMuxArgs({
      videoPath,
      audioPath,
      outputPath: muxedPath,
      videoDuration,
      audioDuration: speechDuration
    }),
    { timeoutMs: 180000 }
  );

  if (result.code !== 0) {
    const error = new Error('ffmpeg video ve sesi surelerini esitleyerek birlestiremedi.');
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    throw error;
  }

  let subtitlePath = null;
  let subtitleResult = null;
  if (speechText) {
    subtitlePath = `${outputPath}.srt`;
    await fs.writeFile(subtitlePath, buildTimedSubtitleSrt(speechText, speechDuration), 'utf8');
    subtitleResult = await runCommand(
      'ffmpeg',
      buildBurnSubtitleArgs({ inputPath: muxedPath, subtitlePath, outputPath }),
      { timeoutMs: 180000 }
    );
    if (subtitleResult.code !== 0) {
      const error = new Error('ffmpeg altyaziyi videoya gomemedi.');
      error.stdout = subtitleResult.stdout;
      error.stderr = subtitleResult.stderr;
      throw error;
    }
    await fs.rm(muxedPath, { force: true });
  }

  return {
    ...result,
    stdout: [result.stdout, subtitleResult?.stdout].filter(Boolean).join('\n'),
    stderr: [result.stderr, subtitleResult?.stderr].filter(Boolean).join('\n'),
    backgroundMusic: null,
    subtitlePath
  };
}

async function concatVideos(videoRelativePaths) {
  logInfo('Final video birlestirme basladi', { count: videoRelativePaths.length });
  const inputPaths = videoRelativePaths.map(resolveRenderRelative);
  if (!inputPaths.length) {
    const error = new Error('Birlestirilecek video yok.');
    error.statusCode = 400;
    throw error;
  }

  const concatId = `${Date.now()}-${randomUUID().slice(0, 8)}-full-video`;
  const workDir = path.join(rendersDir, concatId);
  const listPath = path.join(workDir, 'concat.txt');
  const outputPath = path.join(workDir, 'full-video.mp4');
  await fs.mkdir(workDir, { recursive: true });
  const listContent = inputPaths
    .map((filePath) => `file '${filePath.replaceAll("'", "'\\''")}'`)
    .join('\n');
  await fs.writeFile(listPath, listContent, 'utf8');

  const result = await runCommand(
    'ffmpeg',
    buildConcatArgs({ listPath, outputPath }),
    { timeoutMs: 180000 }
  );

  if (result.code !== 0) {
    const error = new Error('ffmpeg segment videolarini birlestiremedi.');
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    throw error;
  }

  const payload = {
    videoUrl: `/renders/${path.relative(rendersDir, outputPath).replaceAll(path.sep, '/')}`,
    videoRelativePath: path.relative(rendersDir, outputPath).replaceAll(path.sep, '/'),
    stdout: result.stdout,
    stderr: result.stderr
  };
  logInfo('Final video birlestirme tamamlandi', { videoUrl: payload.videoUrl });
  return payload;
}

async function createSpeechScript(segment) {
  logInfo(`${segment?.id || 'segment'}: speech metni hazirlaniyor`);
  if (!segment) {
    const error = new Error('Segment bilgisi eksik.');
    error.statusCode = 400;
    throw error;
  }

  const prompt = {
    task: 'Segment icin TTS konusma metni ve animasyon senkron ipuclari uret.',
    language: 'tr-TR',
    hard_rules: [
      'Sadece gecerli JSON dondur.',
      'speech_text yalnizca seslendirilecek dogal Turkce metin olsun.',
      'speech_text icinde sahne tarifi, markdown, parantez ici yonerge veya zaman kodu olmasin.',
      'Formulleri konusma diline cevir.',
      'cue_plan animasyoncu icindir; speech_text icine karismasin.',
      'Konusma segmentin tek fikrine odaklansin.',
      'Bu uzun ders videosunun bir parcasi; speech_text 60-90 saniyelik dolu bir anlatim olsun.',
      'Eger segment ornek cozumu ise adimlari atlama; problemi kur, cozumu adim adim anlat, sonucu yorumla.',
      'Eger segment kavram anlatimi ise sezgi, somut benzetme ve net tanimi birlikte ver.'
    ],
    output_schema: {
      speech_text: 'string',
      estimated_seconds: 'number',
      cue_plan: [
        {
          at_percent: 'number 0-100',
          spoken_anchor: 'speech_text icinden kisa ifade',
          visual_action: 'Bu soz soylenirken ekranda olmasi gereken net aksiyon'
        }
      ]
    },
    segment
  };

  const responseText = await generateLlmText({
    label: llmProvider === 'groq' ? 'Groq' : 'Gemini',
    model: planModel,
    userText: JSON.stringify(prompt, null, 2),
    json: true,
    temperature: 0.45
  });

  const speech = safeJsonParse(responseText || '');
  if (!speech || typeof speech.speech_text !== 'string' || !speech.speech_text.trim()) {
    const error = new Error(`${segment.id}: Gemini gecerli bir speech_text dondurmedi.`);
    error.statusCode = 502;
    throw error;
  }
  logInfo(`${segment.id}: speech metni hazir`, { chars: String(speech.speech_text || '').length });
  return speech;
}

async function synthesizeSpeech(text, segmentId) {
  const cleanText = String(text || '').trim();
  if (!cleanText) {
    const error = new Error('TTS metni bos olamaz.');
    error.statusCode = 400;
    throw error;
  }

  const audioDir = path.join(rendersDir, 'audio');
  const fileName = `${Date.now()}-${randomUUID().slice(0, 8)}-${sanitizeSegmentId(segmentId)}.mp3`;
  const filePath = path.join(audioDir, fileName);
  await fs.mkdir(audioDir, { recursive: true });

  if (ttsProvider === 'edge') {
    logInfo(`${segmentId}: Edge TTS basladi`, { voice: edgeTtsVoice });
    await withRetry('Edge TTS', () => synthesizeWithEdgeTts({
      text: cleanText,
      outputPath: filePath,
      voice: edgeTtsVoice,
      rate: edgeTtsRate
    }));
    const durationSeconds = await getMediaDurationSeconds(filePath);
    const relativeAudio = path.relative(rendersDir, filePath).replaceAll(path.sep, '/');
    logInfo(`${segmentId}: Edge TTS hazir`, { seconds: Number(durationSeconds || 0).toFixed(1) });
    return {
      audioUrl: `/renders/${relativeAudio}`,
      audioRelativePath: relativeAudio,
      durationSeconds,
      voiceName: edgeTtsVoice,
      voiceId: null,
      usedFallback: false
    };
  }

  logInfo(`${segmentId}: Google TTS basladi`);
  const client = requireTts();
  if (googleCredentialsPath) {
    try {
      await fs.access(googleCredentialsPath);
    } catch {
      const error = new Error(`Google Cloud credential dosyasi bulunamadi: ${googleCredentialsPath}`);
      error.statusCode = 400;
      throw error;
    }
  }

  const [response] = await withRetry('Google Cloud TTS', () => client.synthesizeSpeech({
      input: { text: cleanText },
      voice: {
        languageCode: 'tr-TR',
        name: googleTtsVoice
      },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: googleTtsSpeakingRate
      }
    })
  );

  await fs.writeFile(filePath, Buffer.from(response.audioContent));

  const durationSeconds = await getMediaDurationSeconds(filePath);
  const relativeAudio = path.relative(rendersDir, filePath).replaceAll(path.sep, '/');

  const result = {
    audioUrl: `/renders/${relativeAudio}`,
    audioRelativePath: relativeAudio,
    durationSeconds,
    voiceName: googleTtsVoice,
    voiceId: null,
    usedFallback: false
  };
  logInfo(`${segmentId}: Google TTS hazir`, { seconds: Number(durationSeconds || 0).toFixed(1) });
  return result;
}

async function createManimCode({ animation, durationSeconds, speech, segmentId }) {
  logInfo(`${segmentId}: Manim kodu LLM ile uretiliyor`, { seconds: durationSeconds });
  const { coder } = await loadPrompts();
  const manimGuide = await loadManimGuide();
  const input = {
    animation,
    duration_seconds: Number(durationSeconds || 45),
    speech: speech || null,
    segment_id: sanitizeSegmentId(segmentId)
  };

  if (!input.animation) {
    const error = new Error('Animasyon bilgisi eksik.');
    error.statusCode = 400;
    throw error;
  }

  const responseText = await generateLlmText({
    label: llmProvider === 'groq' ? 'Groq' : 'Gemini',
    model: codeModel,
    systemInstruction: buildManimSystemInstruction(coder, manimGuide),
    userText: `${JSON.stringify(input, null, 2)}\n\nYalnizca calisabilir Python/Manim kodu dondur. Markdown aciklamasi yazma.\n\nBu sahne uzun egitim videosunun bir bolumu. Basit bir giris animasyonu degil; segment boyunca fikri tasiyan, adim adim gelisen bir gorsel anlatim kur. Eger segment ornek cozumu ise problem, verilenler, adimlar ve sonuc ekranda sirayla belirsin. Eger kavram anlatimi ise sezgisel modelden teknik gosterime dogru ilerle.\n\nEger speech varsa animasyonun toplam suresi speech.duration_seconds degerine yakin olsun ve speech.cue_plan icindeki gorsel aksiyonlar konusma akisiyla sirali eslessin. Son sahnede gereksiz uzun bekleme koyma; toplam sure ses suresinden en fazla 1 saniye uzun olsun. Konusma metnini ekrana tam metin olarak basma; yalnizca gerekli kisa anahtar kelimeleri, denklemleri ve adimlari goster.\n\nKamera zoom veya self.camera.frame kullanacaksan class Seg_x(MovingCameraScene) yaz; normal Scene icinde self.camera.frame kullanma. Manim v0.20.1 uyumlulugu icin expo_out kullanma; bunun yerine rate_functions.ease_out_expo kullan.\n\n${mathTexAvailable ? `LaTeX hazir. Matematiksel formul, kok, limit, integral, kesir, us/alt simge ve semboller icin MathTex(r"...") kullan; aciklama metinleri icin Text(..., font=${JSON.stringify(manimFont)}) kullan.` : `Yerel sistemde LaTeX kurulu degil. MathTex, Tex ve DecimalNumber gerektiren include_numbers=True kullanma. Formul, eksen etiketi ve sayilar icin Text(..., font=${JSON.stringify(manimFont)}) kullan.`} Axes ve NumberLine icinde include_numbers=False ayarla.`,
    temperature: 0.35
  });

  const code = sanitizeManimForLocalRender(stripCodeFence(responseText || ''));
  getSceneClassName(code);
  logInfo(`${segmentId}: Manim kodu hazir`, { chars: code.length });
  return code;
}

async function renderManimVideo({ code, segmentId, audioRelativePath, speechText = '' }) {
  logInfo(`${segmentId}: Manim render hazirlaniyor`, { quality: manimQuality });
  let currentCode = sanitizeManimForLocalRender(stripCodeFence(String(code || '')));
  if (!currentCode) {
    const error = new Error('Calistirilacak Manim kodu bos.');
    error.statusCode = 400;
    throw error;
  }

  let className = getSceneClassName(currentCode);
  const safeSegmentId = sanitizeSegmentId(segmentId);
  const renderId = `${Date.now()}-${randomUUID().slice(0, 8)}-${safeSegmentId}`;
  const workDir = path.join(rendersDir, renderId);
  const mediaDir = path.join(workDir, 'media');
  let filePath = path.join(workDir, `${className}.py`);
  let result = null;
  const repairLogs = [];

  await fs.mkdir(workDir, { recursive: true });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    className = getSceneClassName(currentCode);
    filePath = path.join(workDir, `${className}.py`);
    await fs.writeFile(filePath, currentCode, 'utf8');

    logInfo(`${safeSegmentId}: Manim render basladi`, { attempt: attempt + 1, className });
    result = await runCommand(
      'python',
      ['-m', 'manim', manimQuality, filePath, className, '--media_dir', mediaDir],
      { timeoutMs: 180000 }
    );

    if (result.code === 0) {
      logInfo(`${safeSegmentId}: Manim render tamamlandi`, { attempt: attempt + 1 });
      break;
    }

    const renderOutput = [result.stdout, result.stderr].filter(Boolean).join('\n');
    logInfo(`${safeSegmentId}: Manim render hata verdi, duzeltme denenecek`, { attempt: attempt + 1 });
    if (attempt >= 2) {
      break;
    }

    repairLogs.push(`Manim render attempt ${attempt + 1} failed. Gemini repair started.`);
    try {
      currentCode = await repairManimCodeWithLlm(currentCode, renderOutput, safeSegmentId);
      await fs.writeFile(path.join(workDir, `${className}.fixed-${attempt + 1}.py`), currentCode, 'utf8');
    } catch (repairError) {
      repairLogs.push(`Gemini repair failed: ${repairError.message}`);
      break;
    }
  }

  if (result.code !== 0) {
    const error = new Error('Manim render basarisiz oldu.');
    error.stdout = [result.stdout, ...repairLogs].filter(Boolean).join('\n');
    error.stderr = result.stderr;
    error.statusCode = 500;
    throw error;
  }

  const videos = await findNewestMp4(mediaDir);
  if (!videos.length) {
    const error = new Error('Render tamamlandi ama mp4 dosyasi bulunamadi.');
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    error.statusCode = 500;
    throw error;
  }

  let finalVideoPath = videos[0].fullPath;
  let muxResult = null;
  const audioPath = audioRelativePath ? resolveRenderRelative(audioRelativePath) : null;
  const withAudioPath = path.join(workDir, `${className}-with-audio.mp4`);
  logInfo(`${safeSegmentId}: ses ve muzik birlestiriliyor`);
  muxResult = await muxAudio(finalVideoPath, audioPath, withAudioPath, speechText);
  if (muxResult) {
    finalVideoPath = withAudioPath;
  }

  const relativeVideo = path.relative(rendersDir, finalVideoPath).replaceAll(path.sep, '/');
  const durationSeconds = await getMediaDurationSeconds(finalVideoPath).catch(() => null);

  const resultPayload = {
    videoUrl: `/renders/${relativeVideo}`,
    videoRelativePath: relativeVideo,
    durationSeconds,
    stdout: [result.stdout, muxResult?.stdout, ...repairLogs].filter(Boolean).join('\n'),
    stderr: [result.stderr, muxResult?.stderr].filter(Boolean).join('\n'),
    hasAudio: Boolean(audioRelativePath),
    hasMusic: Boolean(muxResult?.backgroundMusic),
    backgroundMusic: muxResult?.backgroundMusic || null
  };
  logInfo(`${safeSegmentId}: video hazir`, {
    seconds: durationSeconds ? Number(durationSeconds).toFixed(1) : null,
    music: Boolean(muxResult?.backgroundMusic)
  });
  return resultPayload;
}

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    total: job.total,
    current: job.current,
    message: job.message,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    error: job.error,
    result: job.result,
    segments: job.segments
  };
}

function updateJob(job, patch) {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  const message = patch.current || patch.message || patch.status || patch.error;
  if (message) {
    logInfo(`Job ${job.id}: ${message}`, {
      status: job.status,
      progress: `${job.progress}/${job.total}`
    });
  }
  persist('generation-job/update', () => updateGenerationJob(job.id, {
    status: job.status,
    progress: job.progress,
    total: job.total,
    current: job.current,
    message: job.message,
    error: job.error,
    completedAt: job.completedAt
  }));
  persist('generation-event', () => appendGenerationEvent({
    jobId: job.dbJobId || null,
    lessonId: job.lessonId || null,
    message: String(message),
    payload: {
      status: job.status,
      progress: job.progress,
      total: job.total
    }
  }));
}

async function runFullVideoJob(job) {
  try {
    logInfo(`Job ${job.id}: tam ders uretimi basladi`, {
      topic: job.plan.topic,
      segments: job.plan.segments.length,
      provider: llmProvider,
      planModel,
      codeModel
    });
    updateJob(job, {
      status: 'running',
      message: 'Segment pipeline basladi.'
    });

    const videoPaths = new Array(job.plan.segments.length);
    let firstParallelStartedResolve = null;
    const firstParallelStarted = new Promise((resolve) => {
      firstParallelStartedResolve = resolve;
    });
    let firstReadyToRenderResolve = null;
    const firstReadyToRender = new Promise((resolve) => {
      firstReadyToRenderResolve = resolve;
    });
    const prepareSegment = (segment, index) => (async () => {
      const segmentState = job.segments[index];
      const dbSegment = await persist(`${segment.id}/segment lookup`, () => getSegment({
        lessonId: job.lessonId,
        segmentKey: segment.id
      }));

      try {
        segmentState.status = 'speech';
        updateJob(job, { current: `${segment.id}: speech uretiliyor...` });
        const speech = await limitSpeech(() => createSpeechScript(segment));
        segmentState.speech = speech;
        await persist(`${segment.id}/speech`, async () => {
          if (!dbSegment?.id) return null;
          await updateSegment(dbSegment.id, { status: 'speech_done' });
          return saveSpeechScript({
            segmentId: dbSegment.id,
            provider: llmProvider,
            model: codeModel,
            speech
          });
        });

        const estimatedDuration = Math.max(
          6,
          Math.round(Number(speech.estimated_seconds || segment.duration_seconds || 70))
        );

        segmentState.status = index === 0 ? 'tts_code' : 'tts';
        updateJob(job, {
          current: index === 0
            ? `${segment.id}: ses ve Manim kodu paralel uretiliyor...`
            : `${segment.id}: ses uretiliyor; Manim kodu ilk segmentten sonra baslayacak...`
        });
        const ttsPromise = limitTts(() => synthesizeSpeech(speech.speech_text, segment.id));
        const codePromise = (async () => {
          if (index > 0) {
            await firstReadyToRender;
            segmentState.status = 'code';
            updateJob(job, { current: `${segment.id}: Manim kodu uretiliyor...` });
          }
          return limitCode(() => createManimCode({
            animation: segment.animation,
            durationSeconds: estimatedDuration,
            speech: {
              speech_text: speech.speech_text,
              duration_seconds: estimatedDuration,
              cue_plan: speech.cue_plan || []
            },
            segmentId: segment.id
          }));
        })();
        if (index === 0) {
          logInfo(`Job ${job.id}: ilk segment TTS ve Manim kodu kuyruğa girdi`);
          firstParallelStartedResolve();
        }

        const [tts, code] = await Promise.all([ttsPromise, codePromise]);
        const manimCode = await persist(`${segment.id}/manim-code`, () => (
          dbSegment?.id
            ? saveManimCode({
                segmentId: dbSegment.id,
                provider: llmProvider,
                model: codeModel,
                code
              })
            : null
        ));
        const uploadedAudio = await persist(`${segment.id}/audio-upload`, () => (
          job.lessonId
            ? uploadRenderRelative({
                bucket: 'audio',
                userId: job.userId,
                lessonId: job.lessonId,
                segmentKey: segment.id,
                kind: 'audio',
                relativePath: tts.audioRelativePath,
                contentType: 'audio/mpeg'
              })
            : null
        ));
        await persist(`${segment.id}/tts`, () => (
          dbSegment?.id
            ? saveTtsOutput({
                segmentId: dbSegment.id,
                voiceName: tts.voiceName,
                speakingRate: googleTtsSpeakingRate,
                durationSeconds: tts.durationSeconds,
                storagePath: uploadedAudio?.storagePath || null,
                publicUrl: uploadedAudio?.publicUrl || null
              })
            : null
        ));
        segmentState.tts = {
          audioUrl: tts.audioUrl,
          durationSeconds: tts.durationSeconds,
          voiceName: tts.voiceName
        };

        segmentState.status = 'ready_to_render';
        updateJob(job, { current: `${segment.id}: render sirasini bekliyor...` });
        if (index === 0) {
          logInfo(`Job ${job.id}: ilk segment render icin hazir; diger Manim kodlari baslayabilir`);
          firstReadyToRenderResolve();
        }
        return { ok: true, segment, dbSegment, speech, manimCode, code, tts, uploadedAudio };
      } catch (error) {
        if (index === 0) {
          firstParallelStartedResolve();
          firstReadyToRenderResolve();
        }
        logInfo(`${segment.id}: segment hazirlanamadi`, { error: error.message });
        segmentState.status = 'failed';
        segmentState.error = error.message || 'Segment hazirlanamadi.';
        return { ok: false, segment, error };
      }
    })();

    const preparationTasks = new Array(job.plan.segments.length);
    if (job.plan.segments.length) {
      logInfo(`Job ${job.id}: ilk segment oncelikli hazirlaniyor`);
      preparationTasks[0] = prepareSegment(job.plan.segments[0], 0);
      await firstParallelStarted;
    }

    for (let index = 1; index < job.plan.segments.length; index += 1) {
      preparationTasks[index] = prepareSegment(job.plan.segments[index], index);
    }

    for (let index = 0; index < preparationTasks.length; index += 1) {
      const prepared = await preparationTasks[index];
      const segmentState = job.segments[index];

      if (!prepared.ok) {
        throw prepared.error;
      }

      segmentState.status = 'render';
      updateJob(job, {
        current: `${prepared.segment.id}: sirali render ediliyor...`,
        message: `Render sirasi: ${index + 1}/${job.total}`
      });

      const render = await limitRender(() => renderManimVideo({
        code: prepared.code,
        segmentId: prepared.segment.id,
        audioRelativePath: prepared.tts.audioRelativePath,
        speechText: prepared.speech.speech_text
      }));
      const uploadedVideo = await persist(`${prepared.segment.id}/video-upload`, () => (
        job.lessonId
          ? uploadRenderRelative({
              bucket: 'videos',
              userId: job.userId,
              lessonId: job.lessonId,
              segmentKey: prepared.segment.id,
              kind: 'video',
              relativePath: render.videoRelativePath,
              contentType: 'video/mp4'
            })
          : null
      ));
      const dbRender = await persist(`${prepared.segment.id}/video-render`, async () => {
        if (!prepared.dbSegment?.id) return null;
        await updateSegment(prepared.dbSegment.id, { status: 'render_done' });
        return saveVideoRender({
          segmentId: prepared.dbSegment.id,
          manimCodeId: prepared.manimCode?.id || null,
          quality: manimQuality,
          videoStoragePath: uploadedVideo?.storagePath || null,
          localVideoPath: render.videoRelativePath,
          audioStoragePath: prepared.uploadedAudio?.storagePath || null,
          backgroundMusicPath: render.backgroundMusic,
          durationSeconds: render.durationSeconds,
          stdout: render.stdout,
          stderr: render.stderr
        });
      });

      segmentState.status = 'done';
      segmentState.videoUrl = render.videoUrl;
      segmentState.videoRelativePath = render.videoRelativePath;
      segmentState.durationSeconds = render.durationSeconds;
      segmentState.hasMusic = render.hasMusic;
      segmentState.backgroundMusic = render.backgroundMusic;
      segmentState.dbRenderId = dbRender?.id || null;
      videoPaths[index] = render.videoRelativePath;
      job.progress += 1;
      updateJob(job, {
        message: `${job.progress}/${job.total} segment tamamlandi.`,
        current: `${prepared.segment.id}: tamamlandi.`
      });
    }

    updateJob(job, {
      status: 'concat',
      current: 'Segment videolari birlestiriliyor...',
      message: 'Final video hazirlaniyor.'
    });

    const concat = await concatVideos(videoPaths);
    const uploadedFinalVideo = await persist('final-video/upload', () => (
      job.lessonId
        ? uploadRenderRelative({
            bucket: 'videos',
            userId: job.userId,
            lessonId: job.lessonId,
            kind: 'final',
            relativePath: concat.videoRelativePath,
            contentType: 'video/mp4'
          })
        : null
    ));
    await persist('final-video/db', async () => {
      if (!job.lessonId) return null;
      const durationSeconds = concat.videoRelativePath
        ? await getMediaDurationSeconds(resolveRenderRelative(concat.videoRelativePath)).catch(() => null)
        : null;
      await updateLesson(job.lessonId, { status: 'done' });
      return saveLessonVideo({
        lessonId: job.lessonId,
        videoStoragePath: uploadedFinalVideo?.storagePath || null,
        localVideoPath: concat.videoRelativePath,
        durationSeconds,
        segmentRenderIds: job.segments.map((segment) => segment.dbRenderId).filter(Boolean)
      });
    });
    updateJob(job, {
      status: 'done',
      current: 'Tamamlandi.',
      message: 'Tam ders videosu hazir.',
      completedAt: new Date().toISOString(),
      result: concat
    });
    logInfo(`Job ${job.id}: tam ders uretimi bitti`, { videoUrl: concat.videoUrl });
  } catch (error) {
    logInfo(`Job ${job.id}: tam ders uretimi hata verdi`, { error: error.message });
    await persist('lesson/status-failed', () => (
      job.lessonId ? updateLesson(job.lessonId, { status: 'failed' }) : null
    ));
    updateJob(job, {
      status: 'failed',
      error: error.message || 'Tam ders uretimi basarisiz oldu.',
      completedAt: new Date().toISOString()
    });
  }
}

async function findNewestMp4(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return findNewestMp4(fullPath);
    }
    if (!entry.isFile() || !entry.name.endsWith('.mp4')) {
      return [];
    }
    const stat = await fs.stat(fullPath);
    return [{ fullPath, mtimeMs: stat.mtimeMs }];
  }));

  return files
    .flat()
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

app.get('/api/config', async (_req, res, next) => {
  try {
    res.json({
      llmProvider,
      planModel,
      codeModel,
      geminiFallbackModels,
      hasApiKey: Boolean(apiKey),
      hasGeminiApiKey: Boolean(geminiApiKey),
      hasGroqApiKey: Boolean(groqApiKey),
      hasTtsCredentials: Boolean(googleCredentialsPath),
      ttsProvider: 'Google Cloud',
      ttsVoice: googleTtsVoice,
      ttsVoiceId: null,
      manimFont,
      manimQuality,
      mathTexAvailable,
      miktexBin,
      speechVolume,
      backgroundMusicVolume: musicVolume,
      backgroundMusicFadeSeconds: musicFadeSeconds,
      targetVideoMinutes,
      targetSegmentCount,
      hasSupabase: supabaseConfigured,
      mediaStorageProvider,
      hasRailwayBucket: railwayMediaConfigured,
      authRequired,
      authRedirectConfigured: Boolean(authRedirectUrl)
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/signup', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const displayName = String(req.body.display_name || '').trim();
    if (!email || !password) {
      return res.status(400).json({ error: 'E-posta ve sifre gerekli.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Sifre en az 8 karakter olmali.' });
    }
    const result = await signUpWithPassword({
      email,
      password,
      displayName,
      emailRedirectTo: authCallbackUrl('confirmed')
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!email || !password) {
      return res.status(400).json({ error: 'E-posta ve sifre gerekli.' });
    }
    const result = await signInWithPassword({ email, password });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/refresh', async (req, res, next) => {
  try {
    const refreshToken = String(req.body.refresh_token || '').trim();
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token gerekli.' });
    }
    const result = await refreshAuthSession(refreshToken);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/password-reset', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ error: 'E-posta gerekli.' });
    }
    await requestPasswordReset({
      email,
      redirectTo: authCallbackUrl('recovery')
    });
    res.json({
      ok: true,
      message: 'Hesap bulunuyorsa sifre yenileme baglantisi e-postaya gonderildi.'
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/password-update', async (req, res, next) => {
  try {
    const accessToken = bearerTokenFromRequest(req);
    const password = String(req.body.password || '');
    if (!accessToken) {
      return res.status(401).json({ error: 'Sifre yenileme oturumu gecersiz.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Yeni sifre en az 8 karakter olmali.' });
    }
    const result = await updatePasswordWithAccessToken({ accessToken, password });
    res.json({ ok: true, user: result.user });
  } catch (error) {
    next(error);
  }
});

app.get('/api/auth/me', async (req, res, next) => {
  try {
    const userContext = await resolveRequestUser(req);
    res.json({
      profile: userContext.profile,
      mode: userContext.mode
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/lessons', async (req, res, next) => {
  try {
    const userContext = await resolveRequestUser(req);
    const lessons = await listLessonsForUser({ userId: userContext.profileId });
    res.json({ lessons });
  } catch (error) {
    next(error);
  }
});

app.get('/api/lessons/:id', async (req, res, next) => {
  try {
    const userContext = await resolveRequestUser(req);
    const detail = await getLessonDetailForUser({
      lessonId: req.params.id,
      userId: userContext.profileId
    });
    if (!detail) {
      return res.status(404).json({ error: 'Ders bulunamadi.' });
    }
    const videoAccess = await createVideoAccessPayload(detail.video);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      ...detail,
      ...videoAccess
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/lessons/:id/video-url', async (req, res, next) => {
  try {
    const userContext = await resolveRequestUser(req);
    const result = await getLessonVideoForUser({
      lessonId: req.params.id,
      userId: userContext.profileId
    });
    if (!result) {
      return res.status(404).json({ error: 'Ders bulunamadi.' });
    }
    if (!result.video?.video_storage_path) {
      return res.status(404).json({ error: 'Bu ders icin kalici video kaydi bulunamadi.' });
    }
    const videoAccess = await createVideoAccessPayload(result.video);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      videoUrl: videoAccess.videoUrl,
      expiresInSeconds: videoAccess.videoUrlExpiresInSeconds,
      expiresAt: videoAccess.videoUrlExpiresAt
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/plan', async (req, res, next) => {
  try {
    const userContext = await resolveRequestUser(req);
    const { planner } = await loadPrompts();
    const topic = String(req.body.topic || '').trim();
    if (!topic) {
      return res.status(400).json({ error: 'Konu bos olamaz.' });
    }

    const input = {
      topic,
      student_level: req.body.student_level || 'beginner',
      target_video_minutes: Number(req.body.target_video_minutes || targetVideoMinutes),
      target_segment_count: Number(req.body.target_segment_count || targetSegmentCount),
      lesson_style: 'full_explainer_with_examples',
      prior_knowledge: Array.isArray(req.body.prior_knowledge)
        ? req.body.prior_knowledge
        : String(req.body.prior_knowledge || '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
      session_history: [],
      interrupt_question: req.body.interrupt_question || null
    };

    const targetMinutes = input.target_video_minutes;
    const segmentCount = input.target_segment_count;
    logInfo('Plan uretimi basladi', {
      topic,
      targetMinutes,
      segmentCount,
      provider: llmProvider,
      model: planModel
    });
    const fullLessonPlanner = `${planner}

## UZUN VIDEO MODU
Bu uygulamada hedef kisa giris degil, yaklasik ${targetMinutes} dakikalik tam bir egitim videosudur.

ZORUNLU:
- estimated_duration_minutes degeri ${targetMinutes} civarinda olsun.
- segments dizisi tam olarak ${segmentCount} segment icersin.
- Her segment 55-95 saniye araliginda olsun; toplam sure ${targetMinutes} dakikaya yaklassin.
- Sadece tanitim yapma. Konuyu gercekten ogret: sezgi, tanim, gorsel model, adim adim ornek, ikinci ornek, tipik hata, mini alistirma ve toparlama bolumleri olsun.
- Matematik konularinda en az 2 cozumlu ornek segmenti uret. Fen konularinda en az 2 somut senaryo/deney/uygulama segmenti uret.
- Segment basliklari ders akisi gibi olsun: Giris, Sezgi, Model, Yontem, Ornek 1, Ornek 2, Yanlis Anlama, Pratik, Ozet gibi.
- narration alanlari TTS icin dolu, dogal ve aciklayici olsun. Tek cumlelik kisa metin yazma.
- animation.description ve sequence alanlari uzun video sahnesini tasiyacak kadar ayrintili olsun.
- Her segment tek ana fikre odaklansin ama o fikri yeterince anlatsin.
- JSON disinda hicbir sey yazma.`;

    const responseText = await generateLlmText({
      label: llmProvider === 'groq' ? 'Groq' : 'Gemini',
      model: planModel,
      systemInstruction: fullLessonPlanner,
      userText: JSON.stringify(input, null, 2),
      json: true,
      temperature: 0.7
    });

    const plan = safeJsonParse(responseText || '');
    logInfo('Plan uretimi tamamlandi', {
      topic: plan.topic || topic,
      segments: Array.isArray(plan.segments) ? plan.segments.length : 0
    });
    const lesson = await persist('lesson/plan', async () => {
      const createdLesson = await createLesson({
        userId: userContext.profileId,
        title: plan.topic || topic,
        topic,
        studentLevel: input.student_level,
        targetMinutes,
        targetSegmentCount: segmentCount,
        sourceType: 'topic'
      });
      await savePlan({
        lessonId: createdLesson.id,
        provider: llmProvider,
        model: planModel,
        prompt: fullLessonPlanner,
        plan,
        rawResponse: responseText
      });
      await saveSegments({ lessonId: createdLesson.id, segments: plan.segments || [] });
      return createdLesson;
    });
    if (lesson?.id) {
      plan._lesson_id = lesson.id;
    }
    res.json({ plan, lessonId: lesson?.id || null });
  } catch (error) {
    next(error);
  }
});

app.post('/api/question-plan', async (req, res, next) => {
  try {
    const userContext = await resolveRequestUser(req);
    const plan = await createQuestionSolutionPlan({
      image: req.body.image,
      studentLevel: req.body.student_level || 'beginner',
      note: req.body.note || ''
    });
    const lesson = await persist('lesson/question-plan', async () => {
      const createdLesson = await createLesson({
        userId: userContext.profileId,
        title: plan.topic || 'Soru cozum videosu',
        topic: req.body.note || plan.topic || 'Soru cozum videosu',
        studentLevel: req.body.student_level || 'beginner',
        targetMinutes: 1,
        targetSegmentCount: 1,
        sourceType: 'question_image'
      });
      await savePlan({
        lessonId: createdLesson.id,
        provider: 'gemini',
        model: geminiPlanModel,
        prompt: 'question-image-solution-plan',
        plan,
        rawResponse: null
      });
      await saveSegments({ lessonId: createdLesson.id, segments: plan.segments || [] });
      if (req.body.image?.data) {
        const mimeType = req.body.image.mimeType || req.body.image.mime_type || 'image/jpeg';
        const storagePath = storagePathFor({
          userId: userContext.profileId,
          lessonId: createdLesson.id,
          kind: 'attachments',
          fileName: `question-image${extensionFromContentType(mimeType) || '.jpg'}`
        });
        const upload = await uploadDataUrl({
          bucket: 'attachments',
          dataUrl: req.body.image.data,
          storagePath,
          contentType: mimeType
        });
        await saveAttachment({
          userId: userContext.profileId,
          lessonId: createdLesson.id,
          type: 'question_image',
          mimeType,
          storagePath: upload.storagePath,
          metadata: { note: req.body.note || null }
        });
      }
      return createdLesson;
    });
    if (lesson?.id) {
      plan._lesson_id = lesson.id;
    }
    res.json({ plan, lessonId: lesson?.id || null });
  } catch (error) {
    next(error);
  }
});

app.post('/api/ask-kara', async (req, res, next) => {
  try {
    const userContext = await resolveRequestUser(req);
    const question = String(req.body.question || '').trim();
    if (!question) {
      return res.status(400).json({ error: 'Soru bos olamaz.' });
    }
    const lessonId = req.body.lesson_id || req.body.lesson_plan?._lesson_id || null;
    await requireOwnedLesson(lessonId, userContext);

    const answerPromise = answerKaraQuestion({
      question,
      frame: req.body.frame,
      timestampSeconds: req.body.timestamp_seconds,
      timestampLabel: req.body.timestamp_label,
      lessonTitle: req.body.lesson_title,
      lessonPlan: req.body.lesson_plan,
      chatHistory: req.body.chat_history
    });
    const chatPromise = persist('kara-chat/get-or-create', () => (
      lessonId ? getOrCreateChat({ userId: userContext.profileId, lessonId }) : null
    ));
    const frameAttachmentPromise = persist('kara-chat/frame', async () => {
      if (!lessonId || !req.body.frame?.data) return null;
      const mimeType = req.body.frame.mimeType || req.body.frame.mime_type || 'image/jpeg';
      const storagePath = storagePathFor({
        userId: userContext.profileId,
        lessonId,
        kind: 'frame-captures',
        fileName: `frame-${Date.now()}${extensionFromContentType(mimeType) || '.jpg'}`
      });
      const upload = await uploadDataUrl({
        bucket: 'attachments',
        dataUrl: req.body.frame.data,
        storagePath,
        contentType: mimeType
      });
      return saveAttachment({
        userId: userContext.profileId,
        lessonId,
        type: 'frame_capture',
        mimeType,
        storagePath: upload.storagePath,
        metadata: {
          timestamp_seconds: req.body.timestamp_seconds,
          timestamp_label: req.body.timestamp_label,
          question
        }
      });
    });

    const persistenceContextPromise = Promise.all([chatPromise, frameAttachmentPromise]);
    const userMessagePromise = persistenceContextPromise.then(([chat, frameAttachment]) => (
      persist('kara-chat/user-message', () => (
        chat?.id
          ? saveChatMessage({
              chatId: chat.id,
              role: 'user',
              content: question,
              timestampSeconds: req.body.timestamp_seconds,
              timestampLabel: req.body.timestamp_label,
              frameAttachmentId: frameAttachment?.id || null,
              provider: null,
              model: null,
              context: { lesson_id: lessonId }
            })
          : null
      ))
    ));

    const result = await answerPromise;
    void userMessagePromise
      .then(async () => {
        const [chat, frameAttachment] = await persistenceContextPromise;
        return persist('kara-chat/assistant-message', () => (
          chat?.id
            ? saveChatMessage({
                chatId: chat.id,
                role: 'assistant',
                content: result.answer,
                timestampSeconds: req.body.timestamp_seconds,
                timestampLabel: req.body.timestamp_label,
                frameAttachmentId: frameAttachment?.id || null,
                provider: 'gemini',
                model: result.model || geminiPlanModel,
                context: {
                  lesson_id: lessonId,
                  history_count: Array.isArray(req.body.chat_history) ? req.body.chat_history.length : 0
                }
              })
            : null
        ));
      })
      .catch((error) => {
        logInfo('Kara sohbet kaydi arka planda tamamlanamadi', { error: error.message });
      });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/speech-script', async (req, res, next) => {
  try {
    await resolveRequestUser(req);
    const speech = await createSpeechScript(req.body.segment);
    res.json({ speech });
  } catch (error) {
    next(error);
  }
});

app.post('/api/tts', async (req, res, next) => {
  try {
    await resolveRequestUser(req);
    const tts = await synthesizeSpeech(req.body.text, req.body.segment_id);
    res.json(tts);
  } catch (error) {
    next(error);
  }
});

app.post('/api/manim-code', async (req, res, next) => {
  try {
    await resolveRequestUser(req);
    const code = await createManimCode({
      animation: req.body.animation,
      durationSeconds: req.body.duration_seconds,
      speech: req.body.speech,
      segmentId: req.body.segment_id
    });
    res.json({ code });
  } catch (error) {
    next(error);
  }
});

app.post('/api/render', async (req, res, next) => {
  try {
    await resolveRequestUser(req);
    const render = await renderManimVideo({
      code: req.body.code,
      segmentId: req.body.segment_id,
      audioRelativePath: req.body.audioRelativePath || null
    });
    res.json(render);
  } catch (error) {
    next(error);
  }
});

app.post('/api/concat', async (req, res, next) => {
  try {
    await resolveRequestUser(req);
    const videos = Array.isArray(req.body.videos) ? req.body.videos : [];
    const result = await concatVideos(videos);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/full-video', async (req, res, next) => {
  try {
    const userContext = await resolveRequestUser(req);
    const plan = req.body.plan;
    if (!plan || !Array.isArray(plan.segments) || !plan.segments.length) {
      return res.status(400).json({ error: 'Tam ders icin gecerli plan.segments gerekli.' });
    }
    const lessonId = req.body.lesson_id || plan._lesson_id || null;
    await requireOwnedLesson(lessonId, userContext);

    const job = {
      id: `${Date.now()}-${randomUUID().slice(0, 8)}`,
      lessonId,
      userId: userContext.profileId,
      dbJobId: null,
      status: 'queued',
      progress: 0,
      total: plan.segments.length,
      current: 'Siraya alindi.',
      message: 'Tam ders uretimi bekliyor.',
      plan,
      segments: plan.segments.map((segment) => ({
        id: segment.id,
        title: segment.title,
        status: 'queued'
      })),
      result: null,
      error: null,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null
    };

    const dbJob = await persist('generation-job/create', () => createGenerationJob({
      appJobId: job.id,
      lessonId,
      total: plan.segments.length,
      current: job.current,
      message: job.message
    }));
    job.dbJobId = dbJob?.id || null;
    await persist('lesson/status-running', () => (
      lessonId ? updateLesson(lessonId, { status: 'generating' }) : null
    ));

    fullVideoJobs.set(job.id, job);
    runFullVideoJob(job);
    res.status(202).json(publicJob(job));
  } catch (error) {
    next(error);
  }
});

app.get('/api/jobs/:id', async (req, res, next) => {
  try {
    const userContext = await resolveRequestUser(req);
    const job = fullVideoJobs.get(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'Job bulunamadi.' });
    }
    if (job.userId && job.userId !== userContext.profileId) {
      return res.status(403).json({ error: 'Bu job bu kullaniciya ait degil.' });
    }
    res.json(publicJob(job));
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  const statusCode = error.statusCode || 500;
  res.status(statusCode).json({
    error: error.message || 'Beklenmeyen hata olustu.',
    stdout: error.stdout,
    stderr: error.stderr
  });
});

app.listen(port, () => {
  logInfo(`Kara Tahta calisiyor: http://localhost:${port}`, {
    provider: llmProvider,
    planModel,
    codeModel,
    geminiFallbackModels,
    quality: manimQuality
  });
});
