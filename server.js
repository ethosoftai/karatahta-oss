import 'dotenv/config';

import { GoogleGenAI } from '@google/genai';
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
  buildAvailableGeminiModelRoute,
  DEFAULT_GEMINI_FALLBACK_MODELS,
  isGeminiFailoverError,
  markGeminiModelFailure,
  markGeminiModelSuccess,
  runGeminiModelRoute
} from './services/geminiRouter.js';
import { compactChatHistory, compactLessonPlanContext } from './services/karaContext.js';
import {
  buildFallbackLiveBoardCommands,
  buildLiveBoardPrompt,
  createLiveBoardNdjsonParser
} from './services/liveBoard.js';
import { LiveManimPool } from './services/liveManimStream.js';
import { safeJsonParse } from './services/llmJson.js';
import { sanitizeManimForLocalRender as sanitizeManimCompatibility } from './services/manimSanitizer.js';
import {
  buildPlannedSpeech,
  resolveStreamingSegmentCount,
  resolveStreamingSegmentDurations
} from './services/streamingPipeline.js';
import {
  buildBurnSubtitleArgs,
  buildCanonicalRemuxArgs,
  buildConcatArgs,
  buildMuxArgs,
  buildTimedSubtitleSrt
} from './services/videoPostprocess.js';
import {
  appendGenerationEvent,
  createOAuthSignInUrl,
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
const googleOAuthEnabled = String(process.env.GOOGLE_OAUTH_ENABLED || 'false').toLowerCase() === 'true';
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
const streamManimQuality = process.env.STREAM_MANIM_QUALITY || '-qm';
const streamSegmentSeconds = Math.max(20, Math.min(60, Number(process.env.STREAM_SEGMENT_SECONDS || 30)));
const segmentProductionBudgetSeconds = Math.max(
  5,
  Math.min(60, Number(process.env.SEGMENT_PRODUCTION_BUDGET_SECONDS || 15))
);
const firstSegmentTargetSeconds = Math.max(
  12,
  Math.min(24, Number(process.env.FIRST_SEGMENT_TARGET_SECONDS || 20))
);
const liveBoardEnabled = String(process.env.LIVE_BOARD_ENABLED || 'true').toLowerCase() !== 'false';
const defaultLiveBoardModel = [
  geminiCodeModel,
  ...geminiFallbackModels
].find((model) => model && !model.includes('flash-lite')) || geminiCodeModel;
const liveBoardModel = resolveGeminiModel(process.env.LIVE_BOARD_MODEL || defaultLiveBoardModel);
const liveManimEnabled = String(process.env.LIVE_MANIM_ENABLED || 'true').toLowerCase() !== 'false';
const liveManimWidth = 1280;
const liveManimHeight = 720;
const liveManimFps = 60;
const liveManimCrf = 20;
const liveManimPreset = ['veryfast', 'faster', 'fast', 'medium'].includes(process.env.LIVE_MANIM_PRESET)
  ? process.env.LIVE_MANIM_PRESET
  : 'veryfast';
const liveManimFragmentSeconds = Math.max(
  1,
  Math.min(4, Number(process.env.LIVE_MANIM_FRAGMENT_SECONDS || 1))
);
const manimRenderFps = 60;
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
const hasGoogleTtsCredentials = Boolean(
  googleCredentialsPath || googleCredentialsJson || googleTtsApiKey
);
let googleTtsClientPromise = null;

const publicDir = path.resolve(__dirname, '../frontend/public');
const rendersDir = path.join(__dirname, 'renders');
const downloadsDir = path.join(__dirname, 'downloads');
const musicExtensions = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.mp4']);
const fullVideoJobs = new Map();
const liveManimPool = new LiveManimPool();
const speechConcurrency = Number(process.env.SPEECH_CONCURRENCY || 3);
const ttsConcurrency = Number(process.env.TTS_CONCURRENCY || 4);
const codeConcurrency = Number(process.env.CODE_CONCURRENCY || 2);
const renderConcurrency = Number(process.env.RENDER_CONCURRENCY || 1);
const planDetailConcurrency = Number(process.env.PLAN_DETAIL_CONCURRENCY || 2);

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

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  promise.catch(() => {});
  return { promise, resolve, reject };
}

const limitSpeech = createLimiter(speechConcurrency);
const limitTts = createLimiter(ttsConcurrency);
const limitCode = createLimiter(codeConcurrency);
const limitRender = createLimiter(renderConcurrency);
const limitPlanDetail = createLimiter(planDetailConcurrency);

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
  maxCompletionTokens = null,
  withMetadata = false
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
    return withMetadata ? { text, model } : text;
  }

  const { response, model: usedModel } = await generateGeminiContent({
    label: label || 'Gemini',
    model,
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    config: {
      ...(systemInstruction ? { systemInstruction } : {}),
      ...(json ? { responseMimeType: 'application/json' } : {}),
      ...(maxCompletionTokens ? { maxOutputTokens: maxCompletionTokens } : {}),
      temperature
    }
  });

  const text = response.text || '';
  logInfo(`${label || 'Gemini'}: yanit geldi`, { model: usedModel, ms: Date.now() - started, chars: text.length });
  return withMetadata ? { text, model: usedModel } : text;
}

async function streamLiveBoardCommands(segment, onCommand, preferredModel = null) {
  const gemini = requireGemini();
  const candidateModels = buildAvailableGeminiModelRoute(
    preferredModel || liveBoardModel,
    [liveBoardModel, ...geminiFallbackModels]
  );
  let lastError = null;

  for (const candidateModel of candidateModels) {
    let emitted = 0;
    const commandTypes = {};
    const parser = createLiveBoardNdjsonParser((command) => {
      emitted += 1;
      commandTypes[command.type] = (commandTypes[command.type] || 0) + 1;
      onCommand(command);
    });

    try {
      logInfo(`${segment.id}: canli tahta Gemini akisi basladi`, { model: candidateModel });
      const responseStream = await withRetry('Gemini canli tahta', () => (
        gemini.models.generateContentStream({
          model: candidateModel,
          contents: [{ role: 'user', parts: [{ text: buildLiveBoardPrompt(segment) }] }],
          config: {
            temperature: 0.45,
            maxOutputTokens: 3200
          }
        })
      ));
      for await (const chunk of responseStream) {
        parser.push(chunk.text || '');
      }
      parser.finish();
      if (!emitted) {
        throw new Error('Gemini canli tahta icin gecerli NDJSON komutu dondurmedi.');
      }
      logInfo(`${segment.id}: canli tahta Gemini akisi tamamlandi`, {
        model: candidateModel,
        commands: emitted,
        commandTypes
      });
      markGeminiModelSuccess(candidateModel);
      return { model: candidateModel, commands: emitted, commandTypes };
    } catch (error) {
      lastError = error;
      if (isGeminiFailoverError(error)) {
        markGeminiModelFailure(candidateModel, error);
      }
      logInfo(`${segment.id}: canli tahta model fallback`, {
        failedModel: candidateModel,
        emitted,
        error: String(error?.message || error).slice(0, 240)
      });
      if (emitted) return { model: candidateModel, commands: emitted, partial: true };
    }
  }

  throw lastError || new Error('Canli tahta komutlari uretilemedi.');
}

async function requireTts() {
  if (!hasGoogleTtsCredentials) {
    const error = new Error('.env icinde GOOGLE_TTS_API_KEY, GOOGLE_APPLICATION_CREDENTIALS veya GOOGLE_APPLICATION_CREDENTIALS_JSON eksik.');
    error.statusCode = 400;
    throw error;
  }

  if (!googleTtsClientPromise) {
    googleTtsClientPromise = import('@google-cloud/text-to-speech')
      .then(({ default: textToSpeech }) => (
        googleCredentialsPath
          ? new textToSpeech.TextToSpeechClient({ keyFilename: googleCredentialsPath })
          : googleCredentialsJson
            ? new textToSpeech.TextToSpeechClient({
                credentials: JSON.parse(googleCredentialsJson)
              })
            : new textToSpeech.TextToSpeechClient({ apiKey: googleTtsApiKey })
      ))
      .catch((error) => {
        googleTtsClientPromise = null;
        throw error;
      });
  }
  return googleTtsClientPromise;
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

function parseLlmJson(text, label) {
  return safeJsonParse(text, {
    onRepair: (details) => {
      logInfo(`${label}: bozuk JSON otomatik onarildi`, details);
    }
  });
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

  const plan = parseLlmJson(response.text || '', 'Soru fotografi plani');
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

async function muxAudio(
  videoPath,
  audioPath,
  outputPath,
  speechText = '',
  { preset = 'medium', crf = 20 } = {}
) {
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
      { timeoutMs: 600000 }
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
      audioDuration: speechDuration,
      preset,
      crf
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
      buildBurnSubtitleArgs({ inputPath: muxedPath, subtitlePath, outputPath, preset, crf }),
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

async function canonicalizeLiveManimVideo(job, liveResult) {
  const inputPath = liveResult?.outputPath;
  if (!inputPath) {
    throw new Error('Canli Manim final dosyasi bulunamadi.');
  }

  const workDir = path.join(
    rendersDir,
    `${Date.now()}-${randomUUID().slice(0, 8)}-live-final`
  );
  const outputPath = path.join(workDir, 'full-video.mp4');
  await fs.mkdir(workDir, { recursive: true });

  const startedAt = Date.now();
  const remux = await runCommand(
    'ffmpeg',
    buildCanonicalRemuxArgs({ inputPath, outputPath }),
    { timeoutMs: 120000 }
  );
  if (remux.code !== 0) {
    const error = new Error('Canli Manim videosu final MP4 dosyasina donusturulemedi.');
    error.stdout = remux.stdout;
    error.stderr = remux.stderr;
    throw error;
  }

  const relativePath = path.relative(rendersDir, outputPath).replaceAll(path.sep, '/');
  const durationSeconds = await getMediaDurationSeconds(outputPath).catch(
    () => liveResult.durationSeconds || null
  );
  const payload = {
    videoUrl: `/renders/${relativePath}`,
    videoRelativePath: relativePath,
    durationSeconds,
    source: 'live_manim',
    remuxMs: Date.now() - startedAt,
    stdout: remux.stdout,
    stderr: remux.stderr
  };
  logInfo(`Job ${job.id}: canlı yayın kanonik final videoya dönüştürüldü`, {
    durationSeconds,
    remuxMs: payload.remuxMs,
    videoUrl: payload.videoUrl
  });
  return payload;
}

async function persistFinalLessonVideo(job, finalVideo, segmentRenderIds = []) {
  const uploadedFinalVideo = await persist('final-video/upload', () => (
    job.lessonId
      ? uploadRenderRelative({
          bucket: 'videos',
          userId: job.userId,
          lessonId: job.lessonId,
          kind: 'final',
          relativePath: finalVideo.videoRelativePath,
          contentType: 'video/mp4'
        })
      : null
  ));
  await persist('final-video/db', async () => {
    if (!job.lessonId) return null;
    const durationSeconds = finalVideo.durationSeconds
      || (finalVideo.videoRelativePath
        ? await getMediaDurationSeconds(
            resolveRenderRelative(finalVideo.videoRelativePath)
          ).catch(() => null)
        : null);
    await updateLesson(job.lessonId, { status: 'done' });
    return saveLessonVideo({
      lessonId: job.lessonId,
      videoStoragePath: uploadedFinalVideo?.storagePath || null,
      localVideoPath: finalVideo.videoRelativePath,
      durationSeconds,
      segmentRenderIds
    });
  });
  return uploadedFinalVideo;
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

  const speech = parseLlmJson(responseText || '', `${segment.id}: speech`);
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
  const client = await requireTts();
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
  const streamingSceneRules = input.duration_seconds <= 30
    ? 'Bu sahne canli yayin icin kisa ve hizli render edilmelidir. En fazla 6 ana Mobject, en fazla 4 play adimi ve sade geometriler kullan. Gereksiz parcacik, 3B sahne, cok sayida kopya obje veya pahali updater kullanma.'
    : 'Bu sahne uzun egitim videosunun bir bolumu. Segment boyunca fikri tasiyan, adim adim gelisen bir gorsel anlatim kur.';

  const responseText = await generateLlmText({
    label: llmProvider === 'groq' ? 'Groq' : 'Gemini',
    model: codeModel,
    systemInstruction: buildManimSystemInstruction(coder, manimGuide),
    userText: `${JSON.stringify(input, null, 2)}\n\nYalnizca calisabilir Python/Manim kodu dondur. Markdown aciklamasi yazma.\n\n${streamingSceneRules} Eger segment ornek cozumu ise problem, verilenler, adimlar ve sonuc ekranda sirayla belirsin. Eger kavram anlatimi ise sezgisel modelden teknik gosterime dogru ilerle.\n\nEger speech varsa animasyonun toplam suresi speech.duration_seconds degerine yakin olsun ve speech.cue_plan icindeki gorsel aksiyonlar konusma akisiyla sirali eslessin. Son sahnede gereksiz uzun bekleme koyma; toplam sure ses suresinden en fazla 1 saniye uzun olsun. Konusma metnini ekrana tam metin olarak basma; yalnizca gerekli kisa anahtar kelimeleri, denklemleri ve adimlari goster.\n\nKamera zoom veya self.camera.frame kullanacaksan class Seg_x(MovingCameraScene) yaz; normal Scene icinde self.camera.frame kullanma. Manim v0.20.1 uyumlulugu icin expo_out kullanma; bunun yerine rate_functions.ease_out_expo kullan.\n\n${mathTexAvailable ? `LaTeX hazir. Matematiksel formul, kok, limit, integral, kesir, us/alt simge ve semboller icin MathTex(r"...") kullan; aciklama metinleri icin Text(..., font=${JSON.stringify(manimFont)}) kullan.` : `Yerel sistemde LaTeX kurulu degil. MathTex, Tex ve DecimalNumber gerektiren include_numbers=True kullanma. Formul, eksen etiketi ve sayilar icin Text(..., font=${JSON.stringify(manimFont)}) kullan.`} Axes ve NumberLine icinde include_numbers=False ayarla.`,
    temperature: 0.35
  });

  const code = sanitizeManimForLocalRender(stripCodeFence(responseText || ''));
  getSceneClassName(code);
  logInfo(`${segmentId}: Manim kodu hazir`, { chars: code.length });
  return code;
}

async function renderManimVideo({
  code,
  segmentId,
  audioRelativePath,
  speechText = '',
  quality = manimQuality,
  postprocessPreset = 'medium',
  postprocessCrf = 20
}) {
  logInfo(`${segmentId}: Manim render hazirlaniyor`, { quality });
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
      [
        '-m',
        'manim',
        quality,
        filePath,
        className,
        '--media_dir',
        mediaDir,
        '--resolution',
        '1280,720',
        '--fps',
        String(manimRenderFps)
      ],
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
  muxResult = await muxAudio(finalVideoPath, audioPath, withAudioPath, speechText, {
    preset: postprocessPreset,
    crf: postprocessCrf
  });
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
  const plannedSegments = (job.plan?.segments || []).filter(Boolean);
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
    liveManim: job.liveManim,
    liveManimEnabled: job.liveManimEnabled,
    planningStatus: job.planningStatus || 'done',
    plannedSegments: plannedSegments.length,
    plan: job.plan ? { ...job.plan, segments: plannedSegments } : null,
    segments: job.segments
  };
}

function emitJobUpdate(job) {
  if (!job.listeners?.size) return;
  const snapshot = publicJob(job);
  for (const listener of job.listeners) {
    try {
      listener(snapshot);
    } catch {
      job.listeners.delete(listener);
    }
  }
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
  emitJobUpdate(job);
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

function setJobSegment(job, index, segment, { emit = true } = {}) {
  if (!segment || index < 0 || index >= job.total || job._segmentReady[index]) return false;
  const normalized = {
    ...segment,
    id: String(segment.id || `segment-${index + 1}`)
  };
  job.plan.segments[index] = normalized;
  job.segments[index] = {
    ...job.segments[index],
    id: normalized.id,
    title: normalized.title || `Bölüm ${index + 1}`,
    status: 'queued'
  };
  job._segmentReady[index] = true;
  job._segmentDeferred[index].resolve(normalized);
  if (emit) {
    updateJob(job, {
      current: `${normalized.id}: planlandı ve üretim hattına verildi.`,
      message: `${job._segmentReady.filter(Boolean).length}/${job.total} segment planlandı.`
    });
  }
  return true;
}

function rejectPendingSegments(job, error) {
  for (let index = 0; index < job.total; index += 1) {
    if (!job._segmentReady[index]) job._segmentDeferred[index].reject(error);
  }
}

async function createVideoJob({
  plan,
  lessonId,
  userId,
  total,
  initialSegments = [],
  promptReceivedAt = null
}) {
  const segmentTotal = Math.max(1, Number(total || initialSegments.length || plan?.segments?.length || 1));
  const jobPlan = {
    ...(plan || {}),
    _lesson_id: lessonId || plan?._lesson_id || null,
    segments: new Array(segmentTotal)
  };
  const job = {
    id: `${Date.now()}-${randomUUID().slice(0, 8)}`,
    lessonId,
    userId,
    dbJobId: null,
    status: 'queued',
    planningStatus: initialSegments.length >= segmentTotal ? 'done' : 'planning',
    progress: 0,
    total: segmentTotal,
    current: initialSegments.length ? 'Siraya alindi.' : 'İlk segment planlanıyor.',
    message: initialSegments.length
      ? 'Tam ders uretimi bekliyor.'
      : `0/${segmentTotal} segment planlandı.`,
    plan: jobPlan,
    liveManimEnabled: liveBoardEnabled && liveManimEnabled,
    liveManim: {
      status: liveBoardEnabled && liveManimEnabled ? 'queued' : 'disabled',
      streamUrl: liveBoardEnabled && liveManimEnabled
        ? `/api/jobs/__JOB_ID__/live-manim.mp4?token=${randomUUID()}`
        : null,
      generatedActions: 0,
      renderedActions: 0,
      failedActions: 0,
      startedAt: null,
      firstContentReadyAt: null,
      firstContentSeconds: null,
      promptToFirstContentMs: null,
      firstContentTargetMs: 10000,
      firstContentDeadlineMet: null,
      completedAt: null,
      durationSeconds: null,
      renderWallMs: null,
      productionRealtimeFactor: null,
      bytes: 0,
      videoUrl: null,
      error: null
    },
    segments: Array.from({ length: segmentTotal }, (_, index) => ({
      id: `segment-${index + 1}`,
      title: `Bölüm ${index + 1} planlanıyor`,
      status: 'planning'
    })),
    result: null,
    error: null,
    startedAt: promptReceivedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    listeners: new Set(),
    _segmentDeferred: Array.from({ length: segmentTotal }, () => createDeferred()),
    _segmentReady: new Array(segmentTotal).fill(false),
    _audioDeferred: Array.from({ length: segmentTotal }, () => createDeferred()),
    _liveManimSession: null,
    _livePreviewReady: createDeferred(),
    _livePreviewReadyResolved: false,
    _livePreviewFinished: createDeferred(),
    _livePreviewFinishedResolved: false
  };
  if (!job.liveManimEnabled) {
    job._livePreviewReadyResolved = true;
    job._livePreviewReady.resolve({ reason: 'disabled' });
    job._livePreviewFinishedResolved = true;
    job._livePreviewFinished.resolve({ reason: 'disabled' });
  }
  if (job.liveManim.streamUrl) {
    job.liveManim.streamUrl = job.liveManim.streamUrl.replace('__JOB_ID__', job.id);
  }
  initialSegments.slice(0, segmentTotal).forEach((segment, index) => {
    setJobSegment(job, index, segment, { emit: false });
  });

  const dbJob = await persist('generation-job/create', () => createGenerationJob({
    appJobId: job.id,
    lessonId,
    total: segmentTotal,
    current: job.current,
    message: job.message
  }));
  job.dbJobId = dbJob?.id || null;
  await persist('lesson/status-running', () => (
    lessonId ? updateLesson(lessonId, { status: 'generating' }) : null
  ));
  fullVideoJobs.set(job.id, job);
  return job;
}

function normalizeOutline(rawOutline, input, segmentCount) {
  const outlineSegments = Array.isArray(rawOutline?.segments) ? rawOutline.segments : [];
  if (outlineSegments.length < segmentCount) {
    const error = new Error(`Plan modeli ${segmentCount} yerine ${outlineSegments.length} bölüm taslağı döndürdü.`);
    error.statusCode = 502;
    throw error;
  }
  return {
    topic: String(rawOutline.topic || input.topic),
    estimated_duration_minutes: Number(input.target_video_minutes),
    core_insight: String(rawOutline.core_insight || ''),
    hook: rawOutline.hook || { question: `${input.topic} neden önemlidir?` },
    analogy: rawOutline.analogy || null,
    learning_objectives: Array.isArray(rawOutline.learning_objectives)
      ? rawOutline.learning_objectives
      : [],
    common_misconceptions: Array.isArray(rawOutline.common_misconceptions)
      ? rawOutline.common_misconceptions
      : [],
    first_segment: rawOutline.first_segment || null,
    segments: outlineSegments.slice(0, segmentCount).map((segment, index) => ({
      index,
      title: String(segment.title || `Bölüm ${index + 1}`),
      learning_objective: String(segment.learning_objective || segment.objective || ''),
      role: String(segment.role || '')
    }))
  };
}

function normalizeDetailedSegment(rawValue, outlineSegment, index, durationSeconds) {
  const value = rawValue?.segment && typeof rawValue.segment === 'object'
    ? rawValue.segment
    : rawValue;
  const narration = String(value?.narration || '').trim();
  if (!narration) {
    const error = new Error(`segment-${index + 1}: plan modeli narration döndürmedi.`);
    error.statusCode = 502;
    throw error;
  }
  const animation = value?.animation && typeof value.animation === 'object'
    ? value.animation
    : {};
  const sequence = Array.isArray(animation.sequence)
    ? animation.sequence.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 8)
    : [];
  return {
    id: `segment-${index + 1}`,
    title: String(value?.title || outlineSegment.title || `Bölüm ${index + 1}`),
    duration_seconds: Number(durationSeconds),
    learning_objective: String(
      value?.learning_objective || outlineSegment.learning_objective || ''
    ),
    narration,
    animation: {
      description: String(
        animation.description || value?.visual_direction || outlineSegment.role || ''
      ),
      sequence: sequence.length
        ? sequence
        : [
            `${outlineSegment.title} başlığını göster`,
            'Ana fikri görsel modelle açıkla',
            'Örneği adım adım canlandır',
            'Sonucu vurgula'
          ]
    }
  };
}

async function generateProgressiveLessonPlan(job, input, plannerPrompt) {
  const segmentCount = job.total;
  const targetMinutes = Number(input.target_video_minutes);
  const segmentDurations = resolveStreamingSegmentDurations({
    targetMinutes,
    segmentCount,
    firstSegmentSeconds: firstSegmentTargetSeconds
  });
  try {
    updateJob(job, {
      current: `${segmentCount} bölümlük ders taslağı ve ilk gerçek segment hazırlanıyor.`,
      message: `0/${segmentCount} segment planlandı.`
    });
    const outlineSystemInstruction = `${plannerPrompt}

Bu aşamada kısa ders iskeletini ve ilk oynatılacak segmentin eksiksiz ayrıntısını birlikte üret.
Tam olarak ${segmentCount} bölüm başlığı ve her bölümün tek cümlelik öğrenme hedefini üret.
first_segment alanında ilk bölümün yaklaşık ${segmentDurations[0]} saniyelik doğal Türkçe narration metnini ve 4-6 sade görsel aksiyonunu eksiksiz ver.
İlk narration doğrudan konuya girsin; selamlama, hazırlık veya "dersimize başlıyoruz" cümlesi kullanma.
Yalnızca geçerli JSON döndür. JSON string alanlarındaki satır sonlarını \\n olarak escape et.`;
    const outlineUserText = JSON.stringify({
      ...input,
      target_segment_count: segmentCount,
      output_schema: {
        topic: 'string',
        core_insight: 'string',
        hook: { question: 'string' },
        analogy: { everyday_scenario: 'string', mapping: 'string' },
        learning_objectives: ['string'],
        common_misconceptions: ['string'],
        first_segment: {
          id: 'segment-1',
          title: 'string',
          duration_seconds: segmentDurations[0],
          learning_objective: 'string',
          narration: `${segmentDurations[0]} saniyeye sığan yaklaşık ${Math.round(segmentDurations[0] * 2.2)} kelimelik doğal Türkçe anlatım`,
          animation: {
            description: 'string',
            sequence: ['4-6 kısa ve render edilmesi kolay gerçek ders görseli']
          }
        },
        segments: Array.from({ length: segmentCount }, (_, index) => ({
          index,
          title: 'string',
          learning_objective: 'string',
          role: 'Bu bölümün ders akışındaki görevi',
          duration_seconds: segmentDurations[index]
        }))
      }
    }, null, 2);
    let outlineResult = await generateLlmText({
      label: 'Gemini plan taslağı',
      model: planModel,
      systemInstruction: outlineSystemInstruction,
      userText: outlineUserText,
      json: true,
      temperature: 0.35,
      maxCompletionTokens: 4800,
      withMetadata: true
    });
    let parsedOutline;
    try {
      parsedOutline = parseLlmJson(outlineResult.text, 'Ders taslağı');
    } catch (parseError) {
      logInfo('Gemini plan taslağı: geçersiz JSON, tek sefer yeniden deneniyor', {
        model: outlineResult.model,
        chars: outlineResult.text.length,
        cause: parseError.cause?.message || parseError.message,
        responseTail: outlineResult.text.slice(-500)
      });
      outlineResult = await generateLlmText({
        label: 'Gemini plan taslağı JSON retry',
        model: outlineResult.model,
        systemInstruction: `${outlineSystemInstruction}

ÖNCEKİ CEVAP JSON doğrulamasından geçemedi. Bu tekrar denemesinde hiçbir alanı yarım bırakma; kapanış parantezlerini eksiksiz yaz.`,
        userText: outlineUserText,
        json: true,
        temperature: 0.15,
        maxCompletionTokens: 4800,
        withMetadata: true
      });
      parsedOutline = parseLlmJson(outlineResult.text, 'Ders taslağı JSON retry');
    }
    const outline = normalizeOutline(
      parsedOutline,
      input,
      segmentCount
    );
    Object.assign(job.plan, {
      topic: outline.topic,
      estimated_duration_minutes: outline.estimated_duration_minutes,
      core_insight: outline.core_insight,
      hook: outline.hook,
      analogy: outline.analogy,
      learning_objectives: outline.learning_objectives,
      common_misconceptions: outline.common_misconceptions
    });
    updateJob(job, {
      current: 'Ders taslağı ve ilk gerçek segment hazır.'
    });

    const createDetail = async (outlineSegment, index) => {
      const durationSeconds = segmentDurations[index];
      if (job.status === 'failed') {
        throw new Error('Video üretim hattı durduğu için planlama iptal edildi.');
      }
      const result = await generateLlmText({
        label: `Gemini segment ${index + 1} planı`,
        model: outlineResult.model,
        systemInstruction: `Sen Kara Tahta'nın eğitim videosu planlayıcısısın.
Yalnızca verilen tek segmenti ayrıntılandır ve yalnızca geçerli JSON döndür.
Narration doğal Türkçe, doğrudan TTS'e uygun ve yaklaşık ${durationSeconds} saniyelik dolu anlatım olsun.
Narration en fazla ${Math.round(durationSeconds * 2.2)} kelime olsun.
Konuyu gerçekten öğret; tanım, sezgi ve gerekiyorsa adım adım örnek kullan.
animation.sequence 4-8 sade, öğretici ve Manim ile uygulanabilir görsel aksiyon içersin.
Başka segment, markdown veya açıklama ekleme.`,
        userText: JSON.stringify({
          lesson: {
            topic: outline.topic,
            core_insight: outline.core_insight,
            student_level: input.student_level,
            target_minutes: targetMinutes,
            all_segment_titles: outline.segments.map((item) => item.title)
          },
          segment_index: index,
          segment_outline: outlineSegment,
          duration_seconds: durationSeconds,
          output_schema: {
            id: `segment-${index + 1}`,
            title: 'string',
            duration_seconds: durationSeconds,
            learning_objective: 'string',
            narration: 'string',
            animation: {
              description: 'string',
              sequence: ['string']
            }
          }
        }, null, 2),
        json: true,
        temperature: 0.55,
        maxCompletionTokens: 3600,
        withMetadata: true
      });
      if (job.status === 'failed') {
        throw new Error('Video üretim hattı durduğu için planlama iptal edildi.');
      }
      const segment = normalizeDetailedSegment(
        parseLlmJson(result.text, `Segment ${index + 1} planı`),
        outlineSegment,
        index,
        durationSeconds
      );
      await persist(`${segment.id}/progressive-plan`, () => saveSegments({
        lessonId: job.lessonId,
        segments: [segment],
        startIndex: index
      }));
      setJobSegment(job, index, segment);
      return segment;
    };

    const detailedSegments = new Array(segmentCount);
    if (outline.first_segment?.narration) {
      detailedSegments[0] = normalizeDetailedSegment(
        outline.first_segment,
        outline.segments[0],
        0,
        segmentDurations[0]
      );
      await persist(`${detailedSegments[0].id}/progressive-plan`, () => saveSegments({
        lessonId: job.lessonId,
        segments: [detailedSegments[0]],
        startIndex: 0
      }));
      setJobSegment(job, 0, detailedSegments[0]);
    } else {
      detailedSegments[0] = await createDetail(outline.segments[0], 0);
    }
    const remaining = outline.segments.slice(1).map((segment, offset) => (
      limitPlanDetail(async () => {
        const index = offset + 1;
        detailedSegments[index] = await createDetail(segment, index);
      })
    ));
    await Promise.all(remaining);

    job.planningStatus = 'done';
    await persist('lesson/progressive-plan', () => savePlan({
      lessonId: job.lessonId,
      provider: llmProvider,
      model: outlineResult.model,
      prompt: 'progressive-eight-segment-plan',
      plan: { ...job.plan, segments: detailedSegments },
      rawResponse: JSON.stringify(outline)
    }));
    updateJob(job, {
      current: 'Tüm segment planları üretim hattına aktarıldı.',
      message: `${segmentCount}/${segmentCount} segment planlandı.`
    });
  } catch (error) {
    job.planningStatus = 'failed';
    rejectPendingSegments(job, error);
    if (job.status !== 'failed') {
      updateJob(job, {
        current: 'Ders planlama başarısız oldu.',
        message: error.message
      });
    }
    throw error;
  }
}

function markLivePreviewReady(job, details = {}) {
  if (job._livePreviewReadyResolved) return;
  job._livePreviewReadyResolved = true;
  const readyAt = new Date();
  const elapsedMs = Math.max(
    0,
    readyAt.getTime() - new Date(job.startedAt).getTime()
  );
  const reason = details.reason || 'first_real_fragment';
  const hasRealContent = !['disabled', 'live_stream_failed'].includes(reason);
  if (hasRealContent) {
    job.liveManim.firstContentReadyAt = readyAt.toISOString();
    job.liveManim.firstContentSeconds = Number(details.timelineSeconds || 0) || null;
    job.liveManim.promptToFirstContentMs = elapsedMs;
    job.liveManim.firstContentDeadlineMet = elapsedMs <= job.liveManim.firstContentTargetMs;
  }
  job._livePreviewReady.resolve({
    reason,
    promptToFirstContentMs: hasRealContent ? elapsedMs : null
  });
  logInfo(`Job ${job.id}: canlı başlangıç kapısı açıldı`, {
    promptToFirstContentMs: hasRealContent ? elapsedMs : null,
    deadlineMet: job.liveManim.firstContentDeadlineMet,
    timelineSeconds: job.liveManim.firstContentSeconds,
    reason
  });
}

function markLivePreviewFinished(job, details = {}) {
  if (job._livePreviewFinishedResolved) return;
  job._livePreviewFinishedResolved = true;
  job._livePreviewFinished.resolve({
    reason: details.reason || 'live_stream_completed',
    durationSeconds: Number(details.durationSeconds || 0) || null
  });
}

async function runLiveManimPreview(job) {
  if (!liveBoardEnabled || !liveManimEnabled || !job.total) {
    markLivePreviewReady(job, { reason: 'disabled' });
    markLivePreviewFinished(job, { reason: 'disabled' });
    return { ok: false, reason: 'disabled' };
  }

  const outputDir = path.join(rendersDir, 'live-manim');
  const outputPath = path.join(outputDir, `${sanitizeSegmentId(job.id)}.mp4`);
  job.liveManim.status = 'waiting_worker';
  updateJob(job, { current: 'Canli Manim motoru hazirlaniyor...' });

  try {
    await fs.mkdir(outputDir, { recursive: true });
    const session = await liveManimPool.acquire({ jobId: job.id, outputPath });
    job._liveManimSession = session;
    let mp4ProbeTail = Buffer.alloc(0);
    session.on('video', (chunk) => {
      if (job._livePreviewReadyResolved) return;
      const probe = Buffer.concat([mp4ProbeTail, Buffer.from(chunk)]);
      if (probe.indexOf(Buffer.from('moof')) !== -1) {
        markLivePreviewReady(job, {
          timelineSeconds: liveManimFragmentSeconds,
          reason: 'first_real_mp4_fragment'
        });
        updateJob(job, {
          current: 'İlk gerçek ders segmenti oynatılıyor.'
        });
      }
      mp4ProbeTail = probe.subarray(Math.max(0, probe.length - 7));
    });
    session.on('event', (event) => {
      if (event.event === 'stream_started') {
        job.liveManim.status = 'streaming';
        job.liveManim.startedAt = new Date().toISOString();
        updateJob(job, { current: 'Canli Manim yayini basladi.' });
      } else if (event.event === 'action_completed') {
        job.liveManim.renderedActions += 1;
      } else if (event.event === 'action_error') {
        job.liveManim.failedActions += 1;
        logInfo(`Job ${job.id}: Live Manim aksiyonu atlandi`, {
          actionId: event.action_id,
          actionType: event.action_type,
          error: event.message
        });
      } else if (event.event === 'input_error') {
        logInfo(`Job ${job.id}: Live Manim bozuk girdi satırını atladı`, {
          error: event.message,
          rawLine: String(event.raw_line || '').slice(0, 300)
        });
      }
    });
    session.on('log', (message) => {
      const line = String(message || '').trim();
      if (line) logInfo(`Job ${job.id}: Live Manim`, { line: line.slice(-500) });
    });
    session.start({
      width: liveManimWidth,
      height: liveManimHeight,
      fps: liveManimFps,
      crf: liveManimCrf,
      preset: liveManimPreset,
      fragmentSeconds: liveManimFragmentSeconds
    });
    const liveRenderStartedAt = Date.now();
    updateJob(job, {
      current: 'İlk gerçek ders anlatımı ve çizimleri hazırlanıyor.'
    });

    let preferredModel = null;
    for (let index = 0; index < job.total; index += 1) {
      const segment = await job._segmentDeferred[index].promise;
      const segmentState = job.segments[index];
      segmentState.liveManim = {
        status: 'preparing',
        model: preferredModel || liveBoardModel,
        commandCount: 0,
        error: null
      };
      const bufferedCommands = [];
      let commandSink = null;
      const commandResultPromise = streamLiveBoardCommands(
        segment,
        (command) => {
          if (commandSink) commandSink(command);
          else bufferedCommands.push(command);
        },
        preferredModel
      ).then(
        (result) => ({ result, error: null }),
        (error) => ({ result: null, error })
      );
      updateJob(job, {
        current: `${segment.id}: ses ve gerçek ders görselleri paralel hazırlanıyor...`
      });

      const tts = await job._audioDeferred[index].promise;
      session.beginSegment({
        segmentId: segment.id,
        audioPath: resolveRenderRelative(tts.audioRelativePath),
        durationSeconds: tts.durationSeconds
      });
      segmentState.liveManim.status = 'streaming';

      const seenIds = new Set();
      const appendCommand = (command) => {
        const uniqueKey = `${command.id}:${command.type}:${command.at_percent}`;
        if (seenIds.has(uniqueKey)) return;
        seenIds.add(uniqueKey);
        session.action(command);
        segmentState.liveManim.commandCount += 1;
        job.liveManim.generatedActions += 1;
        if (
          segmentState.liveManim.commandCount === 1
          || segmentState.liveManim.commandCount % 4 === 0
        ) {
          updateJob(job, {
            current: `${segment.id}: ${segmentState.liveManim.commandCount} Manim aksiyonu yayina girdi.`
          });
        }
      };
      commandSink = appendCommand;
      if (index > 0) {
        appendCommand({
          id: `${segment.id}-transition`,
          type: 'clear',
          at_percent: 0,
          duration_ms: 350,
          color: '#f8fafc',
          text: '',
          x: 50,
          y: 50,
          x2: 50,
          y2: 50,
          width: 1,
          height: 1,
          radius: 1,
          font_size: 4,
          stroke_width: 0.7
        });
      }
      for (const command of bufferedCommands) appendCommand(command);
      bufferedCommands.length = 0;

      const commandOutcome = await commandResultPromise;
      if (commandOutcome.result) {
        const result = commandOutcome.result;
        preferredModel = result.model;
        segmentState.liveManim.status = 'queued';
        segmentState.liveManim.model = result.model;
      } else {
        const error = commandOutcome.error;
        logInfo(`${segment.id}: Live Manim fallback aksiyonlari kullaniliyor`, { error: error.message });
        if (segmentState.liveManim.commandCount === 0) {
          for (const command of buildFallbackLiveBoardCommands(segment)) appendCommand(command);
        }
        segmentState.liveManim.status = 'fallback';
        segmentState.liveManim.error = error.message;
      }
      updateJob(job, {
        current: `${segment.id}: ${segmentState.liveManim.commandCount} canlı aksiyon hazır.`
      });
    }

    job.liveManim.status = 'finishing';
    updateJob(job, { current: 'Canli Manim kaydi tamamlaniyor...' });
    session.finish();
    const result = await session.completion;
    const relativePath = path.relative(rendersDir, result.outputPath).replaceAll(path.sep, '/');
    const actualDuration = await getMediaDurationSeconds(result.outputPath).catch(() => result.duration_seconds);
    job.liveManim.status = 'done';
    job.liveManim.completedAt = new Date().toISOString();
    job.liveManim.durationSeconds = actualDuration;
    job.liveManim.renderWallMs = Date.now() - liveRenderStartedAt;
    job.liveManim.productionRealtimeFactor = actualDuration > 0
      ? Number((actualDuration / (job.liveManim.renderWallMs / 1000)).toFixed(3))
      : null;
    job.liveManim.bytes = result.bytes;
    job.liveManim.videoUrl = `/renders/${relativePath}`;
    session.releaseCachedChunks();
    markLivePreviewReady(job, {
      timelineSeconds: actualDuration,
      reason: 'live_stream_completed'
    });
    markLivePreviewFinished(job, {
      reason: 'live_stream_completed',
      durationSeconds: actualDuration
    });
    updateJob(job, { current: 'Canli Manim dersi tamamlandi.' });
    return {
      ok: true,
      reason: 'live_stream_completed',
      outputPath: result.outputPath,
      durationSeconds: actualDuration,
      bytes: result.bytes,
      renderWallMs: job.liveManim.renderWallMs,
      productionRealtimeFactor: job.liveManim.productionRealtimeFactor
    };
  } catch (error) {
    job._liveManimSession?.abort(error);
    job.liveManim.status = 'failed';
    job.liveManim.error = error.message || 'Canli Manim yayini basarisiz oldu.';
    logInfo(`Job ${job.id}: canli Manim hata verdi`, {
      error: job.liveManim.error,
      traceback: String(error.details || '').slice(-2000) || null
    });
    markLivePreviewReady(job, { reason: 'live_stream_failed' });
    markLivePreviewFinished(job, { reason: 'live_stream_failed' });
    updateJob(job, { current: 'Canli Manim kullanilamadi; parca video akisi devam ediyor.' });
    return {
      ok: false,
      reason: 'live_stream_failed',
      error
    };
  }
}

async function runFullVideoJob(job) {
  try {
    logInfo(`Job ${job.id}: tam ders uretimi basladi`, {
      topic: job.plan.topic,
      segments: job.total,
      provider: llmProvider,
      planModel,
      codeModel
    });
    updateJob(job, {
      status: 'running',
      message: 'Segment pipeline basladi.'
    });
    const livePreviewPromise = runLiveManimPreview(job);
    let firstParallelStartedResolve = null;
    const firstParallelStarted = new Promise((resolve) => {
      firstParallelStartedResolve = resolve;
    });
    const prepareSegment = (index) => (async () => {
      const segmentState = job.segments[index];
      let segment = { id: segmentState.id || `segment-${index + 1}` };

      try {
        segment = await job._segmentDeferred[index].promise;
        const dbSegment = await persist(`${segment.id}/segment lookup`, () => getSegment({
          lessonId: job.lessonId,
          segmentKey: segment.id
        }));
        segmentState.status = 'speech';
        updateJob(job, { current: `${segment.id}: plan anlatimi yayina hazirlaniyor...` });
        const targetSegmentDuration = Math.max(
          12,
          Number(segment.duration_seconds) || Math.ceil(
            (Number(job.plan.estimated_duration_minutes || targetVideoMinutes) * 60) / job.total
          )
        );
        const speech = segment.narration
          ? buildPlannedSpeech(segment, { maxDurationSeconds: targetSegmentDuration + 2 })
          : await limitSpeech(() => createSpeechScript(segment));
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

        segmentState.status = 'tts';
        updateJob(job, {
          current: index === 0
            ? `${segment.id}: ses ve canlı ders görselleri paralel üretiliyor...`
            : `${segment.id}: ses canlı yayın için hazırlanıyor...`
        });
        const ttsPromise = limitTts(() => synthesizeSpeech(speech.speech_text, segment.id))
          .then((tts) => {
            segmentState.tts = {
              audioUrl: tts.audioUrl,
              durationSeconds: tts.durationSeconds,
              voiceName: tts.voiceName
            };
            job._audioDeferred[index].resolve(tts);
            updateJob(job, { current: `${segment.id}: canli anlatim sesi hazir.` });
            return tts;
          });
        if (index === 0) {
          logInfo(`Job ${job.id}: ilk segment TTS kuyruğa girdi`);
          firstParallelStartedResolve();
        }

        const tts = await ttsPromise;
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
        segmentState.status = 'ready_for_live';
        updateJob(job, { current: `${segment.id}: canlı yayın için hazır.` });
        return {
          ok: true,
          segment,
          dbSegment,
          speech,
          estimatedDuration,
          tts,
          uploadedAudio
        };
      } catch (error) {
        job._audioDeferred[index].reject(error);
        if (index === 0) {
          firstParallelStartedResolve();
        }
        logInfo(`${segment.id}: segment hazirlanamadi`, { error: error.message });
        segmentState.status = 'failed';
        segmentState.error = error.message || 'Segment hazirlanamadi.';
        return { ok: false, segment, error };
      }
    })();

    const preparationTasks = new Array(job.total);
    if (job.total) {
      logInfo(`Job ${job.id}: ilk segment oncelikli hazirlaniyor`);
      preparationTasks[0] = prepareSegment(0);
      await firstParallelStarted;
    }

    for (let index = 1; index < job.total; index += 1) {
      preparationTasks[index] = prepareSegment(index);
    }

    const preparedSegments = await Promise.all(preparationTasks);
    const failedPreparation = preparedSegments.find((prepared) => !prepared.ok);
    if (failedPreparation) {
      throw failedPreparation.error;
    }

    let liveResult = await livePreviewPromise;
    if (liveResult.ok) {
      updateJob(job, {
        status: 'finalizing',
        current: 'Canlı yayın indirme ve geçmiş için hazırlanıyor...',
        message: 'Gösterilen video final dosyaya dönüştürülüyor.'
      });
      try {
        const canonicalVideo = await canonicalizeLiveManimVideo(job, liveResult);
        const uploadedFinalVideo = await persistFinalLessonVideo(job, canonicalVideo);
        await Promise.all(preparedSegments.map((prepared) => (
          persist(`${prepared.segment.id}/canonical-status`, () => (
            prepared.dbSegment?.id
              ? updateSegment(prepared.dbSegment.id, { status: 'done' })
              : null
          ))
        )));
        for (const segmentState of job.segments) {
          segmentState.status = 'done';
        }
        preparedSegments.forEach((prepared, index) => {
          job.segments[index].durationSeconds = prepared.tts.durationSeconds;
        });
        job.progress = job.total;
        updateJob(job, {
          status: 'done',
          current: 'Tamamlandi.',
          message: 'Canlı gösterilen ders final video olarak kaydedildi.',
          completedAt: new Date().toISOString(),
          result: {
            ...canonicalVideo,
            videoStoragePath: uploadedFinalVideo?.storagePath || null
          }
        });
        logInfo(`Job ${job.id}: canlı ders ikinci render olmadan tamamlandı`, {
          videoUrl: canonicalVideo.videoUrl,
          remuxMs: canonicalVideo.remuxMs,
          renderWallMs: liveResult.renderWallMs,
          productionRealtimeFactor: liveResult.productionRealtimeFactor
        });
        return;
      } catch (error) {
        liveResult = {
          ok: false,
          reason: 'canonicalization_failed',
          error
        };
        logInfo(`Job ${job.id}: canlı final dönüşümü başarısız; arşiv fallback başlıyor`, {
          error: error.message
        });
      }
    }

    updateJob(job, {
      status: 'running',
      current: 'Canlı yayın kullanılamadı; arşiv renderı hazırlanıyor...',
      message: 'Yedek segment üretimi başladı.'
    });

    const codeTasks = preparedSegments.map(async (prepared, index) => {
      const segmentState = job.segments[index];
      segmentState.status = 'code';
      updateJob(job, { current: `${prepared.segment.id}: yedek Manim kodu uretiliyor...` });
      const code = await limitCode(() => createManimCode({
        animation: prepared.segment.animation,
        durationSeconds: prepared.estimatedDuration,
        speech: {
          speech_text: prepared.speech.speech_text,
          duration_seconds: prepared.estimatedDuration,
          cue_plan: prepared.speech.cue_plan || []
        },
        segmentId: prepared.segment.id
      }));
      const manimCode = await persist(`${prepared.segment.id}/manim-code`, () => (
        prepared.dbSegment?.id
          ? saveManimCode({
              segmentId: prepared.dbSegment.id,
              provider: llmProvider,
              model: codeModel,
              code
            })
          : null
      ));
      return { ...prepared, code, manimCode };
    }).map((task) => task.then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error })
    ));

    const videoPaths = new Array(job.total);
    for (let index = 0; index < codeTasks.length; index += 1) {
      const codeOutcome = await codeTasks[index];
      if (!codeOutcome.ok) throw codeOutcome.error;
      const prepared = codeOutcome.value;
      const segmentState = job.segments[index];
      segmentState.status = 'render';
      updateJob(job, {
        current: `${prepared.segment.id}: yedek video render ediliyor...`,
        message: `Yedek render sirasi: ${index + 1}/${job.total}`
      });
      const render = await limitRender(() => renderManimVideo({
        code: prepared.code,
        segmentId: prepared.segment.id,
        audioRelativePath: prepared.tts.audioRelativePath,
        speechText: prepared.speech.speech_text,
        quality: streamManimQuality,
        postprocessPreset: 'veryfast',
        postprocessCrf: 20
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
          quality: streamManimQuality,
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
        message: `${job.progress}/${job.total} yedek segment tamamlandi.`,
        current: `${prepared.segment.id}: yedek video tamamlandi.`
      });
    }

    updateJob(job, {
      status: 'concat',
      current: 'Yedek segment videolari birlestiriliyor...',
      message: 'Yedek final video hazirlaniyor.'
    });
    const concat = await concatVideos(videoPaths);
    const uploadedFinalVideo = await persistFinalLessonVideo(
      job,
      concat,
      job.segments.map((segment) => segment.dbRenderId).filter(Boolean)
    );
    updateJob(job, {
      status: 'done',
      current: 'Tamamlandi.',
      message: 'Yedek tam ders videosu hazir.',
      completedAt: new Date().toISOString(),
      result: {
        ...concat,
        source: 'archive_fallback',
        fallbackReason: liveResult.reason,
        videoStoragePath: uploadedFinalVideo?.storagePath || null
      }
    });
    logInfo(`Job ${job.id}: yedek tam ders uretimi bitti`, {
      videoUrl: concat.videoUrl,
      fallbackReason: liveResult.reason
    });
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
      hasTtsCredentials: ttsProvider === 'edge' || hasGoogleTtsCredentials,
      ttsProvider: ttsProvider === 'edge' ? 'Edge TTS' : 'Google Cloud',
      ttsVoice: ttsProvider === 'edge' ? edgeTtsVoice : googleTtsVoice,
      ttsVoiceId: null,
      manimFont,
      manimQuality,
      streamManimQuality,
      streamSegmentSeconds,
      liveBoardEnabled,
      liveBoardModel,
      liveManimEnabled,
      liveManimWidth,
      liveManimHeight,
      liveManimFps,
      liveManimCrf,
      liveManimPreset,
      liveManimFragmentSeconds,
      canonicalLiveFinal: true,
      mathTexAvailable,
      miktexBin,
      speechVolume,
      backgroundMusicVolume: musicVolume,
      backgroundMusicFadeSeconds: musicFadeSeconds,
      targetVideoMinutes,
      targetSegmentCount: resolveStreamingSegmentCount({
        targetMinutes: targetVideoMinutes,
        estimatedProductionSeconds: segmentProductionBudgetSeconds
      }),
      segmentProductionBudgetSeconds,
      firstSegmentTargetSeconds,
      hasSupabase: supabaseConfigured,
      mediaStorageProvider,
      hasRailwayBucket: railwayMediaConfigured,
      authRequired,
      authRedirectConfigured: Boolean(authRedirectUrl),
      googleOAuthEnabled
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

app.get('/api/auth/oauth/google', async (_req, res, next) => {
  try {
    if (!googleOAuthEnabled) {
      return res.status(503).json({ error: 'Google ile giris henuz etkin degil.' });
    }
    const url = await createOAuthSignInUrl({
      provider: 'google',
      redirectTo: authCallbackUrl('oauth')
    });
    res.json({ url });
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

    const requestedSegmentCount = Number(req.body.target_segment_count || targetSegmentCount);
    const input = {
      topic,
      student_level: req.body.student_level || 'beginner',
      target_video_minutes: Number(req.body.target_video_minutes || targetVideoMinutes),
      target_segment_count: requestedSegmentCount,
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
    const segmentCount = resolveStreamingSegmentCount({
      targetMinutes,
      requestedSegmentCount,
      estimatedProductionSeconds: segmentProductionBudgetSeconds
    });
    const segmentDurations = resolveStreamingSegmentDurations({
      targetMinutes,
      segmentCount,
      firstSegmentSeconds: firstSegmentTargetSeconds
    });
    const targetDurationPerSegment = Math.round((targetMinutes * 60) / segmentCount);
    input.target_segment_count = segmentCount;
    logInfo('Plan uretimi basladi', {
      topic,
      targetMinutes,
      requestedSegmentCount,
      segmentCount,
      provider: llmProvider,
      model: planModel
    });
    const fullLessonPlanner = `${planner}

## CANLI YAYIN VIDEO MODU
Bu uygulamada yaklasik ${targetMinutes} dakikalik egitim videosu, kullanici izlerken arkadan uretilen kisa parcalar halinde yayinlanir.

ZORUNLU:
- estimated_duration_minutes degeri ${targetMinutes} civarinda olsun.
- segments dizisi tam olarak ${segmentCount} segment icersin.
- Her segment yaklaşık ${targetDurationPerSegment} saniye olsun; toplam süre ${targetMinutes} dakikaya yaklaşsın.
- İlk segment ${segmentDurations[0]} saniye, sonraki segmentler yaklaşık ${segmentDurations[1] || segmentDurations[0]} saniye olsun.
- Her narration alani TTS'e dogrudan gidecek kadar temiz, dogal Turkce ve kendi duration_seconds suresine sigacak uzunlukta olsun.
- Ilk segment merak uyandiran tek bir fikirle hemen baslasin; uzun selamlama veya ders ozeti yapmasin.
- Her animation.sequence en fazla 4 kisa ve render edilmesi kolay gorsel aksiyon icersin.
- Sadece tanitim yapma. Konuyu gercekten ogret: sezgi, tanim, gorsel model, adim adim ornek, ikinci ornek, tipik hata, mini alistirma ve toparlama bolumleri olsun.
- Matematik konularinda en az 2 cozumlu ornek segmenti uret. Fen konularinda en az 2 somut senaryo/deney/uygulama segmenti uret.
- Segment basliklari ders akisi gibi olsun: Giris, Sezgi, Model, Yontem, Ornek 1, Ornek 2, Yanlis Anlama, Pratik, Ozet gibi.
- animation.description ve sequence alanlari kisa segmentin tek fikrini net gostersin.
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

    const plan = parseLlmJson(responseText || '', 'Ders plani');
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

app.post('/api/generate-lesson', async (req, res, next) => {
  const promptReceivedAt = new Date().toISOString();
  try {
    const userContext = await resolveRequestUser(req);
    const topic = String(req.body.topic || '').trim();
    if (!topic) {
      return res.status(400).json({ error: 'Konu bos olamaz.' });
    }
    const targetMinutes = Math.max(1, Math.min(30, Number(
      req.body.target_video_minutes || targetVideoMinutes
    )));
    const requestedSegmentCount = Number(
      req.body.target_segment_count || targetSegmentCount
    );
    const segmentCount = resolveStreamingSegmentCount({
      targetMinutes,
      requestedSegmentCount,
      estimatedProductionSeconds: segmentProductionBudgetSeconds
    });
    const input = {
      topic,
      student_level: req.body.student_level || 'beginner',
      target_video_minutes: targetMinutes,
      target_segment_count: segmentCount,
      lesson_style: 'progressive_full_explainer',
      prior_knowledge: Array.isArray(req.body.prior_knowledge)
        ? req.body.prior_knowledge
        : String(req.body.prior_knowledge || '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
      session_history: [],
      interrupt_question: req.body.interrupt_question || null
    };
    const { planner } = await loadPrompts();
    const lesson = await persist('lesson/progressive-create', () => createLesson({
      userId: userContext.profileId,
      title: topic,
      topic,
      studentLevel: input.student_level,
      targetMinutes,
      targetSegmentCount: segmentCount,
      sourceType: 'topic'
    }));
    const plan = {
      topic,
      estimated_duration_minutes: targetMinutes,
      _lesson_id: lesson?.id || null,
      segments: []
    };
    const job = await createVideoJob({
      plan,
      lessonId: lesson?.id || null,
      userId: userContext.profileId,
      total: segmentCount,
      promptReceivedAt
    });
    logInfo(`Job ${job.id}: kademeli plan ve video üretimi başlatıldı`, {
      topic,
      targetMinutes,
      segmentCount
    });
    void runFullVideoJob(job);
    void generateProgressiveLessonPlan(job, input, planner).catch((error) => {
      logInfo(`Job ${job.id}: kademeli planlama hata verdi`, { error: error.message });
    });
    res.status(202).json({
      ...publicJob(job),
      lessonId: lesson?.id || null
    });
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

    const job = await createVideoJob({
      plan,
      lessonId,
      userId: userContext.profileId,
      total: plan.segments.length,
      initialSegments: plan.segments
    });
    void runFullVideoJob(job);
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

app.get('/api/jobs/:id/live-manim.mp4', async (req, res, next) => {
  try {
    const job = fullVideoJobs.get(req.params.id);
    if (!job?.liveManimEnabled || !job.liveManim?.streamUrl) {
      return res.status(404).json({ error: 'Canli Manim yayini bulunamadi.' });
    }
    const expectedToken = new URL(job.liveManim.streamUrl, 'http://localhost').searchParams.get('token');
    if (!expectedToken || String(req.query.token || '') !== expectedToken) {
      return res.status(403).json({ error: 'Canli yayin anahtari gecersiz.' });
    }
    if (job.liveManim.status === 'done' && job.liveManim.videoUrl) {
      const relativePath = job.liveManim.videoUrl.replace(/^\/renders\//, '');
      return res.sendFile(resolveRenderRelative(relativePath));
    }
    if (job.liveManim.status === 'failed') {
      return res.status(503).json({ error: job.liveManim.error || 'Canli Manim yayini basarisiz oldu.' });
    }
    if (!job._liveManimSession) {
      return res.status(425).json({ error: 'Canli Manim worker henuz hazir degil.' });
    }

    res.status(200);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Accept-Ranges', 'none');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    job._liveManimSession.pipeTo(res);
    return undefined;
  } catch (error) {
    next(error);
  }
});

app.get('/api/jobs/:id/events', async (req, res, next) => {
  try {
    const userContext = await resolveRequestUser(req);
    const job = fullVideoJobs.get(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'Job bulunamadi.' });
    }
    if (job.userId && job.userId !== userContext.profileId) {
      return res.status(403).json({ error: 'Bu job bu kullaniciya ait degil.' });
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      job.listeners.delete(send);
    };
    const send = (snapshot) => {
      if (closed || res.writableEnded) return;
      res.write(`event: job\ndata: ${JSON.stringify(snapshot)}\n\n`);
      if (snapshot.status === 'done' || snapshot.status === 'failed') {
        cleanup();
        res.end();
      }
    };
    const heartbeat = setInterval(() => {
      if (!closed && !res.writableEnded) res.write(': keep-alive\n\n');
    }, 15000);

    job.listeners.add(send);
    req.on('close', cleanup);
    send(publicJob(job));
    return undefined;
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

const httpServer = app.listen(port, () => {
  if (liveManimEnabled) {
    liveManimPool.prewarm();
  }
  logInfo(`Kara Tahta calisiyor: http://localhost:${port}`, {
    provider: llmProvider,
    planModel,
    codeModel,
    geminiFallbackModels,
    quality: manimQuality
  });
});

function shutdownServer() {
  liveManimPool.shutdown();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.once('SIGTERM', shutdownServer);
process.once('SIGINT', shutdownServer);
