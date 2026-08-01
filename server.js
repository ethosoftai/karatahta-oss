import 'dotenv/config';

import textToSpeech from '@google-cloud/text-to-speech';
import express from 'express';
import OpenAI from 'openai';
import { Agent, setGlobalDispatcher } from 'undici';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { synthesizeWithEdgeTts } from './services/edgeTts.js';
import { compactChatHistory, compactLessonPlanContext } from './services/karaContext.js';
import {
  buildSegmentGenerationContext,
  normalizeLessonContinuity,
  normalizeLessonSegmentContinuity
} from './services/lessonContinuity.js';
import { safeJsonParse } from './services/llmJson.js';
import { buildMandatoryManimContract } from './services/manimPromptContract.js';
import { sanitizeManimForLocalRender as sanitizeManimCompatibility } from './services/manimSanitizer.js';
import {
  buildBurnSubtitleArgs,
  buildConcatArgs,
  buildMuxArgs,
  buildProgressiveAudioArgs,
  buildProgressivePartialArgs,
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
import {
  ManimPartialCollector,
  appendPartialMetadata,
  createJobEventChannel,
  createProgressiveState,
  publicProgressiveState
} from './services/progressiveManim.js';
import {
  scheduleRemainingSegmentPreparations,
  segmentDurationBudget,
  speechDurationBudget
} from './services/segmentPipeline.js';
import {
  optimizeManimForProgressiveRender
} from './services/manimProgressiveCode.js';
import {
  buildIncrementalLessonRoute,
  buildEarlySpeechScript,
  compactPreviousSegmentContext,
  isUsableLessonSegment
} from './services/streamingPlan.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const miktexBinCandidates = [
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'MiKTeX', 'miktex', 'bin', 'x64'),
  'C:\\Program Files\\MiKTeX\\miktex\\bin\\x64'
].filter(Boolean);
const miktexBin = miktexBinCandidates.find((candidate) => (
  existsSync(path.join(candidate, 'latex.exe')) && existsSync(path.join(candidate, 'dvisvgm.exe'))
));
const systemLatexAvailable = (
  existsSync('/usr/bin/latex')
  && existsSync('/usr/bin/dvisvgm')
);

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
const llmProvider = 'deepseek';
const defaultDeepSeekModel = 'deepseek-v4-flash';
const planModel = String(process.env.DEEPSEEK_PLAN_MODEL || process.env.DEEPSEEK_MODEL || defaultDeepSeekModel).trim();
const codeModel = String(process.env.DEEPSEEK_CODE_MODEL || process.env.DEEPSEEK_MODEL || defaultDeepSeekModel).trim();
const deepseekBaseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const deepseekReasoningEffort = process.env.DEEPSEEK_REASONING_EFFORT === 'max' ? 'max' : 'high';
const deepseekPipelineThinkingEnabled = String(
  process.env.DEEPSEEK_PIPELINE_THINKING || 'false'
).toLowerCase() === 'true';
const manimQuality = process.env.MANIM_QUALITY || '-qm';
const manimFont = process.env.MANIM_FONT || 'Georgia';
const mathTexMode = String(process.env.MANIM_ENABLE_MATHTEX || 'auto').toLowerCase();
const mathTexAvailable = (
  mathTexMode === '1'
  || mathTexMode === 'true'
  || (mathTexMode === 'auto' && (Boolean(miktexBin) || systemLatexAvailable))
);
const musicVolume = Number(process.env.BACKGROUND_MUSIC_VOLUME || 0.1);
const musicFadeSeconds = Number(process.env.BACKGROUND_MUSIC_FADE_SECONDS || 1);
const speechVolume = Number(process.env.SPEECH_VOLUME || 1.25);
const targetVideoMinutes = Number(process.env.TARGET_VIDEO_MINUTES || 10);
const targetSegmentCount = Number(process.env.TARGET_SEGMENT_COUNT || 8);
const deepseekApiKey = process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API;
const deepseekRequestTimeoutMs = Math.max(
  5000,
  Number(process.env.DEEPSEEK_REQUEST_TIMEOUT_MS || 120000)
);
const apiKey = deepseekApiKey;
const deepseek = deepseekApiKey
  ? new OpenAI({
      apiKey: deepseekApiKey,
      baseURL: deepseekBaseUrl,
      timeout: deepseekRequestTimeoutMs,
      maxRetries: 2
    })
  : null;
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
const streamingPlanFirstSegmentEnabled = String(
  process.env.STREAMING_PLAN_FIRST_SEGMENT || 'false'
).toLowerCase() === 'true';
const progressiveManimEnabled = String(process.env.PROGRESSIVE_MANIM_PARTIALS || 'false').toLowerCase() === 'true';
const progressiveBufferSeconds = Math.max(0, Number(process.env.PROGRESSIVE_BUFFER_SECONDS || 0));
const progressiveChunkSeconds = Math.max(3, Number(process.env.PROGRESSIVE_CHUNK_SECONDS || 6));
const progressiveArtifactTtlMs = Math.max(
  10 * 60 * 1000,
  Number(process.env.PROGRESSIVE_ARTIFACT_TTL_MS || 30 * 60 * 1000)
);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (corsOrigins.includes('*') || corsOrigins.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Last-Event-ID');
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
  const loadedPaths = [];
  const mandatoryPaths = [
    path.join('skill', 'skill.md'),
    path.join('skill', 'rules', 'math_rendering.md'),
    path.join('skill', 'rules', 'layout_safety.md')
  ];

  for (const relativePath of mandatoryPaths) {
    const guide = await readOptionalMarkdown(relativePath);
    if (!guide) {
      throw new Error(`Zorunlu Manim skill dosyasi bulunamadi: ${relativePath.replaceAll(path.sep, '/')}`);
    }
    loadedPaths.push(relativePath.replaceAll(path.sep, '/'));
    sections.push(`## ZORUNLU KAYNAK: ${relativePath.replaceAll(path.sep, '/')}\n\n${guide}`);
  }

  const rootGuide = await readOptionalMarkdown('manim.md');
  if (rootGuide) {
    loadedPaths.push('manim.md');
    sections.push(`## EK KAYNAK: manim.md\n\n${rootGuide}`);
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
      if (mandatoryPaths.includes(relativePath)) continue;
      const ruleGuide = await readOptionalMarkdown(relativePath);
      if (ruleGuide) {
        loadedPaths.push(relativePath.replaceAll(path.sep, '/'));
        sections.push(`## EK KAYNAK: ${relativePath.replaceAll(path.sep, '/')}\n\n${ruleGuide}`);
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

  const guide = sections.join('\n\n---\n\n').slice(0, 60000);
  logInfo('Manim skill rehberleri modele yuklendi', {
    sections: sections.length,
    chars: guide.length,
    sources: loadedPaths
  });
  return guide;
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
  const mandatoryContract = buildMandatoryManimContract({
    mathTexAvailable,
    font: manimFont
  });

  if (!manimGuide) {
    return `${coderPrompt}\n\n${appRules}\n\n${mandatoryContract}`;
  }

  const mathGuideNote = mathTexAvailable
    ? 'MathTex/Tex onerilerini matematiksel ifadelerde uygula; yine de layout guvenligi icin boyutlari kontrol et.'
    : 'MathTex/Tex onerilerini LaTeX kurulu olmadigi icin uygulama; ayni gorsel amaci Text, VGroup, Line, Arrow, SurroundingRectangle ve basit geometrilerle kur.';

  return `${coderPrompt}\n\n${appRules}\n\n${mandatoryContract}\n\n## MODELE VERILEN TAM MANIM SKILL REHBERLERI\nAsagidaki rehberlerin matematik render ve layout safety maddelerini zorunlu uygula. Uygulamanin tek dosya/tek Scene kuraliyla catisan klasor, viewer ve shell talimatlarini uygulama. ${mathGuideNote}\n\n${manimGuide}`;
}

function requireDeepSeek() {
  if (!deepseek) {
    const error = new Error('.env icindeki DEEPSEEK_API_KEY veya DEEPSEEK_API bos. Once API anahtarini girin.');
    error.statusCode = 400;
    throw error;
  }

  return deepseek;
}

async function generateLlmText({
  label,
  model,
  systemInstruction,
  userText,
  json = false,
  temperature = 0.4,
  maxCompletionTokens = null,
  thinkingEnabled = true
}) {
  void temperature;
  const started = Date.now();
  logInfo(`${label || llmProvider}: istek basladi`, { provider: llmProvider, model });
  const client = requireDeepSeek();
  const body = {
    model,
    messages: [
      ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []),
      { role: 'user', content: userText }
    ],
    ...(thinkingEnabled ? { reasoning_effort: deepseekReasoningEffort } : {}),
    thinking: { type: thinkingEnabled ? 'enabled' : 'disabled' },
    stream: false,
    ...(json ? { response_format: { type: 'json_object' } } : {}),
    ...(maxCompletionTokens ? { max_tokens: maxCompletionTokens } : {})
  };
  const response = await withRetry(label || 'DeepSeek', () => client.chat.completions.create(body));
  const text = String(response.choices?.[0]?.message?.content || '');
  logInfo(`${label || 'DeepSeek'}: yanit geldi`, { model, ms: Date.now() - started, chars: text.length });
  return text;
}

async function generateDeepSeekTextStream({
  label = 'DeepSeek stream',
  model,
  systemInstruction,
  userText,
  json = false,
  temperature = 0.4,
  timeoutMs = deepseekRequestTimeoutMs,
  onText,
  thinkingEnabled = true
}) {
  void temperature;
  const client = requireDeepSeek();
  const started = Date.now();
  logInfo(`${label}: istek basladi`, { provider: llmProvider, model, streaming: true });
  const stream = await withRetry(label, () => client.chat.completions.create({
    model,
    messages: [
      ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []),
      { role: 'user', content: userText }
    ],
    ...(thinkingEnabled ? { reasoning_effort: deepseekReasoningEffort } : {}),
    thinking: { type: thinkingEnabled ? 'enabled' : 'disabled' },
    stream: true,
    ...(json ? { response_format: { type: 'json_object' } } : {})
  }, { timeout: timeoutMs }));
  let text = '';
  for await (const chunk of stream) {
    const delta = String(chunk.choices?.[0]?.delta?.content || '');
    if (!delta) continue;
    text += delta;
    await onText?.({ text, delta, model });
  }

  logInfo(`${label}: yanit geldi`, {
    model,
    ms: Date.now() - started,
    chars: text.length,
    streaming: true
  });
  return { text, model };
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
  normalizeImagePayload(image);
  const questionText = String(note || '').trim();
  if (!questionText) {
    const error = new Error('deepseek-v4-flash gorsel girdiyi desteklemiyor. Soruyu Ek not alanina metin olarak yazin.');
    error.statusCode = 422;
    throw error;
  }
  const prompt = `Bir ogrencinin cozemedigi soru asagida metin olarak veriliyor.

Gorev: Soru metnini cozumle ve mevcut Manim video pipeline'ina uygun 1 dakikalik Turkce cozum videosu plani uret.

ZORUNLU KURALLAR:
- Sadece gecerli JSON dondur. Markdown yazma.
- Video yaklasik 1 dakika olsun.
- segments dizisi tam olarak 1 segment icersin.
- Segment id degeri "s1" olsun.
- Anlatim ogrenciye dogrudan yardim eden, adim adim cozum diliyle olsun.
- Soru metni eksikse bunu belirtip verilen kisimdan makul cozum stratejisi anlat.
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
Soru metni: ${questionText}`;

  logInfo('Soru metni icin DeepSeek cozum plani basladi', { model: planModel });
  const started = Date.now();
  const responseText = await generateLlmText({
    label: 'DeepSeek soru cozumu',
    model: planModel,
    userText: prompt,
    json: true
  });

  const plan = parseLlmJson(responseText, 'Soru metni plani');
  logInfo('Soru metni cozum plani tamamlandi', {
    ms: Date.now() - started,
    model: planModel,
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
  normalizeImagePayload(frame);
  const safeHistory = compactChatHistory(chatHistory);
  const compactLessonPlan = compactLessonPlanContext(lessonPlan);

  const prompt = `Sen Kara Tahta icindeki "Kara" adli egitim asistanisin.

Ogrenci video izlerken bir soru sordu. DeepSeek gorsel girdiyi desteklemedigi icin video karesi modele aktarilmiyor; timestamp, ders plani ve onceki soru-cevap gecmisi veriliyor.

ZORUNLU CEVAP KURALLARI:
- Turkce cevap ver.
- Timestamp ve ders plani baglamini dikkate al; karede gormedigin bir ayrintiyi gordugunu iddia etme.
- Ilk once soruyu kisa cevapla, sonra gerekiyorsa adim adim acikla.
- Matematiksel ifadeleri LaTeX ile yaz: satir ici icin \\(...\\), ayri denklem icin \\[...\\].
- Gereksiz uzun cevap verme; ogrencinin takildigi yeri ac.
- Onceki konusmalar varsa baglami koru, ama eski cevabi aynen tekrar etme.
- Baglam yeterli degilse bunu nazikce soyle ve yine de eldeki bilgiyle yardim et.

Ders basligi: ${lessonTitle || 'Bilinmiyor'}
Timestamp: ${timestampLabel} (${Number(timestampSeconds || 0).toFixed(1)} saniye)

Cikarilan ders plani:
${compactLessonPlan ? JSON.stringify(compactLessonPlan, null, 2) : 'Yok'}

Onceki konusmalar:
${safeHistory.length ? JSON.stringify(safeHistory, null, 2) : 'Yok'}

Ogrencinin yeni sorusu:
${String(question || '').trim()}`;

  logInfo('Kara soru-cevap DeepSeek istegi basladi', {
    model: planModel,
    timestamp: timestampLabel,
    history: safeHistory.length
  });

  const started = Date.now();
  const answer = String(await generateLlmText({
    label: 'DeepSeek Kara soru-cevap',
    model: planModel,
    userText: prompt
  })).trim();
  logInfo('Kara soru-cevap DeepSeek yaniti geldi', {
    ms: Date.now() - started,
    model: planModel,
    chars: answer.length
  });

  return { answer, model: planModel };
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
      'Hata durumunda anlatim metnini veya uzun paragraflari Text, Paragraph ya da MarkupText ile ekrana basan fallback sahnesi yazma.',
      'Bozuk gorseli metin-only sahneye cevirme; mevcut sekilleri, diyagramlari, donusumleri ve pedagojik animasyonlari koru.',
      'skill/skill.md, math_rendering.md ve layout_safety.md kurallarini; uygulamanin tek dosya/tek Scene sozlesmesiyle birlikte zorunlu uygula.'
    ],
    mandatory_skill_contract: buildMandatoryManimContract({
      mathTexAvailable,
      font: manimFont
    }),
    manim_guide: manimGuide || null,
    render_error: renderOutput.slice(-8000),
    broken_code: code
  };

  const responseText = await generateLlmText({
    label: 'DeepSeek',
    model: codeModel,
    systemInstruction: buildManimSystemInstruction('', manimGuide),
    userText: JSON.stringify(prompt, null, 2),
    temperature: 0.15,
    thinkingEnabled: deepseekPipelineThinkingEnabled
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

async function probeVideo(filePath) {
  const result = await runCommand(
    'ffprobe',
    [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,avg_frame_rate,codec_name,profile,level:format=duration',
      '-of', 'json',
      filePath
    ],
    { timeoutMs: 30000 }
  );
  if (result.code !== 0) {
    throw new Error(`ffprobe video okuyamadi: ${result.stderr || result.stdout}`);
  }
  const payload = JSON.parse(result.stdout || '{}');
  const stream = payload.streams?.[0];
  const durationSeconds = Number(payload.format?.duration);
  if (!stream || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error('MP4 video streami veya suresi gecersiz.');
  }
  const [fpsNumerator, fpsDenominator] = String(stream.avg_frame_rate || '0/1')
    .split('/')
    .map(Number);
  return {
    width: Number(stream.width),
    height: Number(stream.height),
    fps: fpsDenominator ? fpsNumerator / fpsDenominator : 0,
    codec: stream.codec_name,
    profile: stream.profile,
    level: Number(stream.level),
    durationSeconds
  };
}

function avcCodecString(probe) {
  const profileHex = /high/i.test(probe.profile || '')
    ? '64'
    : /main/i.test(probe.profile || '')
      ? '4D'
      : '42';
  const levelHex = Math.max(0, Math.min(255, Number(probe.level || 31)))
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
  return `avc1.${profileHex}00${levelHex}`;
}

async function sha256File(filePath) {
  const data = await fs.readFile(filePath);
  return createHash('sha256').update(data).digest('hex');
}

async function normalizeProgressivePartial({
  sourcePath,
  outputPath,
  audioPath,
  audioStartSeconds,
  durationSeconds
}) {
  const args = buildProgressivePartialArgs({
    sourcePath,
    audioPath,
    outputPath,
    audioStartSeconds,
    durationSeconds
  });
  const result = await runCommand('ffmpeg', args, { timeoutMs: 60000 });
  if (result.code !== 0) {
    const error = new Error('Manim partial fMP4 olarak hazirlanamadi.');
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    throw error;
  }
  return probeVideo(outputPath);
}

async function prepareProgressiveAudio({ inputPath, outputPath }) {
  if (existsSync(outputPath)) return;
  const inputDuration = await getMediaDurationSeconds(inputPath);
  const args = buildProgressiveAudioArgs({
    inputPath,
    outputPath,
    volume: speechVolume,
    durationSeconds: inputDuration + 30
  });
  const result = await runCommand('ffmpeg', args, { timeoutMs: 60000 });
  if (result.code !== 0) {
    const error = new Error('Progressive ses tek parca AAC olarak hazirlanamadi.');
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    throw error;
  }
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

  const speechBudget = speechDurationBudget(segment.duration_seconds);
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
      'Bu segment bagimsiz bir bolum degil, tek ve kesintisiz ders anlatiminin teknik parcasidir.',
      'continuity.role continuation ise selamlama, yeniden giris, bolum basligi, onceki kismi ozetleme veya konu degisikligi anonsu yapma; continuity.previous_narration_tail cumlesindeki dusunceyi dogal olarak ilerlet.',
      'continuity.role closing degilse sonuc/kapanis yapma; sonraki fikre dogal bir anlamsal kopru birak.',
      'Segmentin konusu dersin ana konusundan kopmasin; benzetme ve ornek yalniz mevcut fikri ilerletsin.',
      `Bu dersin kisa, oynatilabilir bir parcasi; speech_text ${speechBudget.minSeconds}-${speechBudget.maxSeconds} saniye olsun ve ${speechBudget.targetSeconds} saniyeyi hedeflesin.`,
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
    label: 'DeepSeek',
    model: planModel,
    userText: JSON.stringify(prompt, null, 2),
    json: true,
    temperature: 0.45,
    thinkingEnabled: deepseekPipelineThinkingEnabled
  });

  const speech = parseLlmJson(responseText || '', `${segment.id}: speech`);
  if (!speech || typeof speech.speech_text !== 'string' || !speech.speech_text.trim()) {
    const error = new Error(`${segment.id}: DeepSeek gecerli bir speech_text dondurmedi.`);
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

async function createManimCode({ animation, durationSeconds, speech, segmentId, continuityContext = null }) {
  logInfo(`${segmentId}: Manim kodu LLM ile uretiliyor`, {
    seconds: durationSeconds,
    previousCodeChars: String(continuityContext?.previous_manim_code || '').length
  });
  const { coder } = await loadPrompts();
  const manimGuide = await loadManimGuide();
  const input = {
    animation,
    duration_seconds: Number(durationSeconds || 45),
    speech: speech || null,
    segment_id: sanitizeSegmentId(segmentId),
    continuity: continuityContext
  };

  if (!input.animation) {
    const error = new Error('Animasyon bilgisi eksik.');
    error.statusCode = 400;
    throw error;
  }

  const responseText = await generateLlmText({
    label: 'DeepSeek',
    model: codeModel,
    systemInstruction: buildManimSystemInstruction(coder, manimGuide),
    userText: `${JSON.stringify(input, null, 2)}\n\nYalnizca calisabilir Python/Manim kodu dondur. Markdown aciklamasi yazma.\n\nBu sahne uzun egitim videosunun teknik render parcasidir; bagimsiz bir mini video veya yeni bolum degildir. continuity alanindaki onceki sahne durumunu ilk self.play() cagrisindan ONCE, animasyonsuz olarak yeniden kur. Boylece ilk kare onceki segmentin son karesiyle ayni kompozisyonu tasir. Segment basligi, giris karti, logo veya yeniden tanitim gosterme. Onceki nesneleri uygun Transform/ReplacementTransform ile gelistir; ekrani sifirlayip baska bir kompozisyona atlama. continuity.forbid_full_clear true ise tum nesneleri FadeOut ile temizleme ve siyah bos kareyle bitirme. Yalniz continuity.role closing ise dogal bir final kapanisi yapabilirsin. Tum segmentlerde continuity.visual_style renklerini, fontunu ve yerlesimini aynen koru.\n\ncontinuity.previous_manim_code bos degilse bu kod onceki segmentin GERCEK Manim kaynak kodudur. Onun son gorunen sahnesindeki mobject constructorlarini, degisken adlarini, renkleri, scale degerlerini ve koordinatlari incele. Yeni construct basinda bu son durumu ayni kodla yeniden kur ve self.add(...) ile animasyonsuz yerlestir. Ilk self.play, bu tasinan nesneleri yeni fikre Transform/ReplacementTransform ile donustursun. Onceki animasyonlari tekrar oynatma, yeni bir baslik karti olusturma ve farkli koordinatlarla benzerini tahmin etme.\n\nSegment boyunca fikri tasiyan, adim adim gelisen bir gorsel anlatim kur. Eger segment ornek cozumu ise problem, verilenler, adimlar ve sonuc ekranda sirayla belirsin. Eger kavram anlatimi ise sezgisel modelden teknik gosterime dogru ilerle.\n\nPROGRESSIVE RENDER KURALLARI: Ilk self.play() 2-3 saniyeyi gecmesin. Sonraki gorsel akis anlamli 2-5 saniyelik self.play()/self.wait() bloklarindan olussun. Tek bir run_time=10/15 gibi dev animasyon kullanma. Ilk blokta binlerce obje, agir 3D veya gereksiz always_redraw kullanma; sonraki bloklarda gorsel zenginligi ve pedagojik kaliteyi koru. Kod satir satir calistirilmayacak; partial sinirlari yalnizca normal self.play()/self.wait() cagrilaridir.\n\nEger speech varsa animasyonun toplam suresi speech.duration_seconds degerine yakin olsun ve speech.cue_plan icindeki gorsel aksiyonlar konusma akisiyla sirali eslessin. Son sahnede gereksiz uzun bekleme koyma; toplam sure ses suresinden en fazla 1 saniye uzun olsun. Konusma metnini ekrana tam metin olarak basma; yalnizca gerekli kisa anahtar kelimeleri, denklemleri ve adimlari goster.\n\nKamera zoom veya self.camera.frame kullanacaksan class Seg_x(MovingCameraScene) yaz; normal Scene icinde self.camera.frame kullanma. Manim v0.20.1 uyumlulugu icin expo_out kullanma; bunun yerine rate_functions.ease_out_expo kullan.\n\n${mathTexAvailable ? `LaTeX hazir. Matematiksel formul, kok, limit, integral, kesir, us/alt simge ve semboller icin MathTex(r"...") kullan; aciklama metinleri icin Text(..., font=${JSON.stringify(manimFont)}) kullan.` : `Yerel sistemde LaTeX kurulu degil. MathTex, Tex ve DecimalNumber gerektiren include_numbers=True kullanma. Formul, eksen etiketi ve sayilar icin Text(..., font=${JSON.stringify(manimFont)}) kullan.`} Axes ve NumberLine icinde include_numbers=False ayarla.`,
    temperature: 0.35,
    maxCompletionTokens: 6000,
    thinkingEnabled: deepseekPipelineThinkingEnabled
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
  progressiveContext = null
}) {
  logInfo(`${segmentId}: Manim render hazirlaniyor`, { quality: manimQuality });
  let currentCode = sanitizeManimForLocalRender(stripCodeFence(String(code || '')));
  if (progressiveContext?.job?.progressive?.enabled) {
    currentCode = optimizeManimForProgressiveRender(currentCode);
  }
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
  const progressiveStartSequence = progressiveContext?.job?.progressive?.partials?.length || 0;

  await fs.mkdir(workDir, { recursive: true });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    className = getSceneClassName(currentCode);
    filePath = path.join(workDir, `${className}.py`);
    await fs.writeFile(filePath, currentCode, 'utf8');

    let partialCollector = null;
    if (
      progressiveContext?.job?.progressive?.enabled
      && progressiveContext.job.progressive.status !== 'failed'
      && audioRelativePath
    ) {
      const progressiveDir = path.join(workDir, 'progressive');
      const audioPath = resolveRenderRelative(audioRelativePath);
      const progressiveAudioPath = path.join(progressiveDir, 'speech-continuous.m4a');
      let localAudioCursor = (progressiveContext.job.progressive.partials || [])
        .filter((partial) => partial.segmentIndex === progressiveContext.segmentIndex)
        .reduce((sum, partial) => sum + Number(partial.durationSeconds || 0), 0);
      await fs.mkdir(progressiveDir, { recursive: true });
      await prepareProgressiveAudio({
        inputPath: audioPath,
        outputPath: progressiveAudioPath
      });
      partialCollector = new ManimPartialCollector({
        mediaDir,
        validate: async (partialPath) => {
          const probe = await probeVideo(partialPath);
          return (
            probe.codec === 'h264'
            && probe.width === 1280
            && probe.height === 720
            && Math.abs(probe.fps - 30) < 0.1
          );
        },
        measureDuration: async (partialPath) => (await probeVideo(partialPath)).durationSeconds,
        batchTargetSeconds: progressiveChunkSeconds,
        normalize: async (partialPaths, segmentSequence) => {
          const sequence = progressiveContext.job.progressive.partials.length;
          const sourcePaths = Array.isArray(partialPaths) ? partialPaths : [partialPaths];
          let partialPath = sourcePaths[0];
          if (sourcePaths.length > 1) {
            const listPath = path.join(progressiveDir, `source-batch-${String(sequence).padStart(5, '0')}.txt`);
            const groupedPath = path.join(progressiveDir, `source-batch-${String(sequence).padStart(5, '0')}.mp4`);
            const listContent = sourcePaths
              .map((sourcePath) => `file '${sourcePath.replaceAll("'", "'\\''")}'`)
              .join('\n');
            await fs.writeFile(listPath, listContent, 'utf8');
            const concatResult = await runCommand(
              'ffmpeg',
              buildConcatArgs({ listPath, outputPath: groupedPath }),
              { timeoutMs: 60000 }
            );
            if (concatResult.code !== 0) {
              const error = new Error('Manim mikro parcalari kesintisiz blokta birlestirilemedi.');
              error.stdout = concatResult.stdout;
              error.stderr = concatResult.stderr;
              throw error;
            }
            partialPath = groupedPath;
          }
          const probe = await probeVideo(partialPath);
          const outputPath = path.join(progressiveDir, `partial-${String(sequence).padStart(5, '0')}.mp4`);
          const normalizedProbe = await normalizeProgressivePartial({
            sourcePath: partialPath,
            outputPath,
            audioPath: progressiveAudioPath,
            audioStartSeconds: localAudioCursor,
            durationSeconds: probe.durationSeconds
          });
          const startSeconds = progressiveContext.job.progressive.readyDurationSeconds;
          const checksum = await sha256File(outputPath);
          const codec = `${avcCodecString(normalizedProbe)}, mp4a.40.2`;
          localAudioCursor += probe.durationSeconds;
          return {
            id: `${progressiveContext.job.id}-${sequence}-${checksum.slice(0, 12)}`,
            jobId: progressiveContext.job.id,
            lessonId: progressiveContext.job.lessonId,
            segmentId: safeSegmentId,
            segmentIndex: progressiveContext.segmentIndex,
            segmentSequence,
            sequence,
            startSeconds,
            durationSeconds: probe.durationSeconds,
            width: probe.width,
            height: probe.height,
            fps: probe.fps,
            codec,
            mimeType: `video/mp4; codecs="${codec}"`,
            url: `/api/jobs/${encodeURIComponent(progressiveContext.job.id)}/partials/${sequence}`,
            checksum,
            readyAt: new Date().toISOString(),
            _filePath: outputPath
          };
        },
        onPartial: async (partial) => {
          const job = progressiveContext.job;
          if (!appendPartialMetadata(job.progressive, partial)) return;
          job.timings.firstPartialReadyAt ||= partial.readyAt;
          if (job.progressive.playbackReadyAt) {
            job.timings.playbackReadyAt ||= job.progressive.playbackReadyAt;
          }
          job.progressive.status = job.progressive.playbackReadyAt ? 'ready' : 'buffering';
          job.updatedAt = new Date().toISOString();
          job.eventChannel.emit('job', publicJob(job));
          logInfo(`Job ${job.id}: progressive partial hazir`, {
            sequence: partial.sequence,
            segmentId: partial.segmentId,
            seconds: Number(partial.durationSeconds).toFixed(2),
            buffered: Number(job.progressive.readyDurationSeconds).toFixed(2)
          });
        }
      });
      partialCollector.start();
    }

    logInfo(`${safeSegmentId}: Manim render basladi`, { attempt: attempt + 1, className });
    if (progressiveContext?.job && attempt === 0) {
      progressiveContext.job.timings.manimStartedAt ||= new Date().toISOString();
    }
    const manimArgs = ['-m', 'manim', manimQuality];
    if (progressiveContext?.job?.progressive?.enabled) {
      manimArgs.push('--resolution', '1280,720', '--fps', '30');
    }
    manimArgs.push(filePath, className, '--media_dir', mediaDir);
    result = await runCommand('python', manimArgs, { timeoutMs: 180000 });
    if (partialCollector) {
      try {
        await partialCollector.finish();
      } catch (partialError) {
        progressiveContext.job.progressive.status = 'failed';
        progressiveContext.job.progressive.error = partialError.message;
        progressiveContext.job.eventChannel.emit('job', publicJob(progressiveContext.job));
        logInfo(`${safeSegmentId}: progressive partial akisi durdu`, {
          error: partialError.message
        });
      }
    }

    if (result.code === 0) {
      logInfo(`${safeSegmentId}: Manim render tamamlandi`, { attempt: attempt + 1 });
      break;
    }

    const renderOutput = [result.stdout, result.stderr].filter(Boolean).join('\n');
    logInfo(`${safeSegmentId}: Manim render hata verdi, duzeltme denenecek`, { attempt: attempt + 1 });
    if (attempt >= 2) {
      break;
    }

    if (progressiveContext?.job?.progressive?.readyCount) {
      progressiveContext.job.progressive.status = 'failed';
      progressiveContext.job.progressive.error = 'Manim render onarima gecti; yari kalan canli akis durduruldu.';
      progressiveContext.job.eventChannel.emit('job', publicJob(progressiveContext.job));
    }

    repairLogs.push(`Manim render attempt ${attempt + 1} failed. DeepSeek repair started.`);
    try {
      currentCode = await repairManimCodeWithLlm(currentCode, renderOutput, safeSegmentId);
      if (progressiveContext?.job?.progressive?.enabled) {
        currentCode = optimizeManimForProgressiveRender(currentCode);
      }
      await fs.writeFile(path.join(workDir, `${className}.fixed-${attempt + 1}.py`), currentCode, 'utf8');
    } catch (repairError) {
      repairLogs.push(`DeepSeek repair failed: ${repairError.message}`);
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
  const progressivePartials = progressiveContext?.job?.progressive?.status !== 'failed'
    ? (progressiveContext?.job?.progressive?.partials || [])
        .filter((partial) => (
          partial.sequence >= progressiveStartSequence
          && partial.segmentIndex === progressiveContext.segmentIndex
        ))
    : [];
  if (progressivePartials.length) {
    const listPath = path.join(workDir, 'progressive-partials.txt');
    const listContent = progressivePartials
      .sort((left, right) => left.sequence - right.sequence)
      .map((partial) => `file '${partial._filePath.replaceAll("'", "'\\''")}'`)
      .join('\n');
    await fs.writeFile(listPath, listContent, 'utf8');
    const concatResult = await runCommand(
      'ffmpeg',
      buildConcatArgs({ listPath, outputPath: withAudioPath }),
      { timeoutMs: 180000 }
    );
    if (concatResult.code !== 0) {
      progressiveContext.job.progressive.status = 'failed';
      progressiveContext.job.progressive.error = 'Progressive parcalar final segmente birlestirilemedi.';
      progressiveContext.job.eventChannel.emit('job', publicJob(progressiveContext.job));
      repairLogs.push(progressiveContext.job.progressive.error);
    } else {
      finalVideoPath = withAudioPath;
      muxResult = {
        ...concatResult,
        backgroundMusic: null,
        source: 'progressive_partials'
      };
    }
  }
  if (!muxResult) {
    logInfo(`${safeSegmentId}: ses ve muzik birlestiriliyor`);
    muxResult = await muxAudio(finalVideoPath, audioPath, withAudioPath, speechText);
    if (muxResult) {
      finalVideoPath = withAudioPath;
    }
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
    backgroundMusic: muxResult?.backgroundMusic || null,
    source: muxResult?.source || 'traditional'
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
    plan: job.plan,
    segments: job.segments,
    lessonId: job.lessonId,
    progressive: publicProgressiveState(job.progressive),
    timings: job.timings || null
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
  job.eventChannel?.emit('job', publicJob(job));
}

async function runFullVideoJob(job) {
  try {
    logInfo(`Job ${job.id}: tam ders uretimi basladi`, {
      topic: job.plan.topic,
      initialSegments: job.plan.segments.length,
      expectedSegments: job.total,
      provider: llmProvider,
      planModel,
      codeModel
    });
    updateJob(job, {
      status: 'running',
      message: 'Segment pipeline basladi.'
    });

    const videoPaths = new Array(job.total);
    const fullPlanReadyTask = (async () => {
      if (!job._fullPlanPromise) return job.plan;
      const fullPlan = normalizeLessonContinuity(await job._fullPlanPromise);
      if (!fullPlan || !Array.isArray(fullPlan.segments) || !fullPlan.segments.length) {
        throw new Error('Streaming tam ders plani gecersiz.');
      }

      const previousStates = new Map(
        job.segments.filter(Boolean).map((segment) => [segment.id, segment])
      );
      job.plan = fullPlan;
      job.total = fullPlan.segments.length;
      job.segments = fullPlan.segments.map((segment) => (
        previousStates.get(segment.id) || {
          id: segment.id,
          title: segment.title,
          status: 'queued'
        }
      ));
      videoPaths.length = job.total;
      job.timings.fullPlanReadyAt = new Date().toISOString();
      updateJob(job, {
        message: `Tam plan hazir: ${job.total} segment.`
      });
      logInfo(`Job ${job.id}: streaming tam plan pipeline'a eklendi`, {
        segments: job.total
      });
      return fullPlan;
    })();
    void fullPlanReadyTask.catch(() => {});
    const getPipelineSegment = async (index) => {
      if (job.plan.segments[index]) {
        return job.plan.segments[index];
      }
      if (job._segmentPromises?.[index]) {
        const segment = await job._segmentPromises[index];
        if (!job.plan.segments[index]) {
          job.plan.segments[index] = segment;
          job.segments[index] ||= {
            id: segment.id,
            title: segment.title,
            status: 'queued'
          };
          updateJob(job, {
            message: `Plan segmenti hazır: ${index + 1}/${job.total}`
          });
        }
        return segment;
      }
      const fullPlan = await fullPlanReadyTask;
      const segment = fullPlan.segments[index];
      if (!segment) {
        throw new Error(`Pipeline segmenti bulunamadi: ${index + 1}/${job.total}`);
      }
      return segment;
    };
    const codeDeferreds = Array.from({ length: job.total }, () => createDeferredPromise());
    codeDeferreds.forEach((deferred) => void deferred.promise.catch(() => {}));
    const prepareSegment = (segment, index) => (async () => {
      const segmentState = job.segments[index];
      const dbSegment = await persist(`${segment.id}/segment lookup`, () => getSegment({
        lessonId: job.lessonId,
        segmentKey: segment.id
      }));

      try {
        segmentState.status = 'speech';
        updateJob(job, { current: `${segment.id}: speech uretiliyor...` });
        const earlySpeech = job._segmentPromises
          ? buildEarlySpeechScript(segment)
          : null;
        const speech = earlySpeech || await limitSpeech(() => createSpeechScript(segment));
        if (earlySpeech) {
          logInfo(`${segment.id}: streaming plandaki narration doğrudan kullanıldı`, {
            chars: earlySpeech.speech_text.length
          });
        }
        segmentState.speech = speech;
        if (index === 0) {
          job.timings.firstSpeechReadyAt ||= new Date().toISOString();
        }
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

        segmentState.status = 'tts_code';
        updateJob(job, {
          current: `${segment.id}: ses ve Manim kodu paralel uretiliyor...`
        });
        const ttsPromise = limitTts(() => synthesizeSpeech(speech.speech_text, segment.id))
          .then((value) => {
            if (index === 0) job.timings.firstTtsReadyAt ||= new Date().toISOString();
            return value;
          });
        const codePromise = (async () => {
          try {
            const previousManimCode = index > 0
              ? await codeDeferreds[index - 1].promise
              : '';
            const queuedCode = limitCode(() => createManimCode({
              animation: segment.animation,
              durationSeconds: estimatedDuration,
              speech: {
                speech_text: speech.speech_text,
                duration_seconds: estimatedDuration,
                cue_plan: speech.cue_plan || []
              },
              segmentId: segment.id,
              continuityContext: buildSegmentGenerationContext({
                plan: job.plan,
                segment,
                index,
                total: job.total,
                previousManimCode
              })
            }));
            const value = await queuedCode;
            codeDeferreds[index].resolve(value);
            if (index === 0) job.timings.firstCodeReadyAt ||= new Date().toISOString();
            return value;
          } catch (error) {
            codeDeferreds[index].reject(error);
            throw error;
          }
        })();
        if (index === 0) {
          logInfo(`Job ${job.id}: ilk segment TTS ve Manim kodu kuyruğa girdi`);
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
        }
        return { ok: true, segment, dbSegment, speech, manimCode, code, tts, uploadedAudio };
      } catch (error) {
        codeDeferreds[index].reject(error);
        logInfo(`${segment.id}: segment hazirlanamadi`, { error: error.message });
        segmentState.status = 'failed';
        segmentState.error = error.message || 'Segment hazirlanamadi.';
        return { ok: false, segment, error };
      }
    })();

    const preparationTasks = new Array(job.total);
    const schedulePreparation = (index) => {
      if (preparationTasks[index]) {
        return preparationTasks[index];
      }

      const task = (async () => {
        const segment = await getPipelineSegment(index);
        return prepareSegment(segment, index);
      })();
      preparationTasks[index] = task;
      void task.catch(() => {});
      return task;
    };
    if (job.plan.segments.length) {
      logInfo(`Job ${job.id}: ilk segment oncelikli hazirlaniyor`);
      schedulePreparation(0);
    }
    const scheduleRemaining = () => {
      const tasks = scheduleRemainingSegmentPreparations(job.total, schedulePreparation);
      if (tasks.length) {
        logInfo(`Job ${job.id}: kalan segment hazirliklari paralel kuyruga alindi`, {
          count: tasks.length,
          codeConcurrency,
          ttsConcurrency
        });
      }
    };
    if (job._segmentPromises) {
      scheduleRemaining();
    } else if (job._fullPlanPromise) {
      void fullPlanReadyTask.then(scheduleRemaining).catch(() => {});
    } else {
      scheduleRemaining();
    }

    for (let index = 0; index < job.total; index += 1) {
      const prepared = await schedulePreparation(index);
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
        speechText: prepared.speech.speech_text,
        progressiveContext: job.progressive.enabled && job.progressive.status !== 'failed'
          ? { job, segmentIndex: index }
          : null
      }));
      if (index === 0) {
        job.timings.firstSegmentCompletedAt ||= new Date().toISOString();
      }
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
    concat.source = job.progressive.enabled && job.progressive.status !== 'failed'
      ? 'progressive_partials'
      : 'traditional';
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
    job.timings.finalVideoReadyAt = new Date().toISOString();
    if (job.progressive.enabled && job.progressive.status !== 'failed') {
      job.progressive.status = 'done';
    }
    updateJob(job, {
      status: 'done',
      current: 'Tamamlandi.',
      message: 'Tam ders videosu hazir.',
      completedAt: new Date().toISOString(),
      result: concat
    });
    scheduleProgressiveCleanup(job);
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
    scheduleProgressiveCleanup(job);
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
      hasApiKey: Boolean(apiKey),
      hasDeepSeekApiKey: Boolean(deepseekApiKey),
      deepseekReasoningEffort,
      deepseekPipelineThinkingEnabled,
      supportsVision: false,
      hasTtsCredentials: Boolean(googleCredentialsPath),
      ttsProvider: 'Google Cloud',
      ttsVoice: googleTtsVoice,
      ttsVoiceId: null,
      manimFont,
      manimQuality,
      streamingPlanFirstSegmentEnabled,
      progressiveManimEnabled,
      progressiveBufferSeconds,
      progressiveChunkSeconds,
      progressiveVideo: {
        width: 1280,
        height: 720,
        fps: 30
      },
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

async function buildTraditionalPlannerRequest(body) {
  const { planner } = await loadPrompts();
  const topic = String(body.topic || '').trim();
  if (!topic) {
    const error = new Error('Konu bos olamaz.');
    error.statusCode = 400;
    throw error;
  }

  const input = {
    topic,
    student_level: body.student_level || 'beginner',
    target_video_minutes: Number(body.target_video_minutes || targetVideoMinutes),
    target_segment_count: Number(body.target_segment_count || targetSegmentCount),
    lesson_style: 'full_explainer_with_examples',
    prior_knowledge: Array.isArray(body.prior_knowledge)
      ? body.prior_knowledge
      : String(body.prior_knowledge || '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
    session_history: [],
    interrupt_question: body.interrupt_question || null
  };

  const targetMinutes = input.target_video_minutes;
  const segmentCount = input.target_segment_count;
  const durationBudget = segmentDurationBudget(targetMinutes, segmentCount);
  const narrationWordTarget = Math.max(20, Math.round(durationBudget.averageSeconds * 1.55));
  const narrationWordMaximum = Math.max(narrationWordTarget + 5, Math.round(durationBudget.maxSeconds * 1.65));
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
- Her segment ${durationBudget.minSeconds}-${durationBudget.maxSeconds} saniye araliginda olsun ve ortalama ${durationBudget.averageSeconds} saniyeyi hedeflesin; toplam sure ${targetMinutes} dakikaya yaklassin.
- Sadece tanitim yapma. Konuyu gercekten ogret: sezgi, tanim, gorsel model, adim adim ornek, ikinci ornek, tipik hata, mini alistirma ve toparlama bolumleri olsun.
- Matematik konularinda en az 2 cozumlu ornek segmenti uret. Fen konularinda en az 2 somut senaryo/deney/uygulama segmenti uret.
- Segment basliklari ders akisi gibi olsun: Giris, Sezgi, Model, Yontem, Ornek 1, Ornek 2, Yanlis Anlama, Pratik, Ozet gibi.
- narration alanlari TTS icin dolu, dogal ve aciklayici olsun. Tek cumlelik kisa metin yazma.
- Her narration yaklaşık ${narrationWordTarget} kelimeyi hedeflesin ve ${narrationWordMaximum} kelimeyi kesinlikle geçmesin; böylece ses, segment süresini aşmasın.
- animation.description ve sequence alanlari uzun video sahnesini tasiyacak kadar ayrintili olsun.
- Her segment tek ana fikre odaklansin ama o fikri yeterince anlatsin.
- Segmentler bagimsiz mini dersler degil, TEK bir kesintisiz videonun teknik render bloklaridir. Tum narration metinleri arka arkaya okundugunda tek bir dogal monolog olustursun.
- Yalniz s1 merak uyandiran bir acilis yapabilir. s2 ve sonrasinda selamlama, konuyu yeniden tanitma, onceki kismi ozetleme veya "simdi yeni bolume geciyoruz" deme. Onceki dusuncenin son cumlesini dogal bicimde ilerlet.
- Son segment disindaki narration metinleri kapanis yapmasin; bir sonraki fikre acik ve dogal bir kopruyle bitsin. Yalniz son segment genel sonucu baglasin.
- Konu kapsamini koru: ornek ve benzetmeler ana fikri ilerletsin; yeni ve ilgisiz bir konu acmasin.
- Her segmentte continuity objesi zorunludur. Alanlari: role (opening|continuation|closing), narrative_bridge, visual_start_state, visual_end_state, transition ve visual_style.
- s2 ve sonrasinin visual_start_state degeri onceki segmentin visual_end_state degeriyle ayni sahneyi, ayni nesne adlarini, renkleri ve konumlari tarif etsin.
- Tum segmentlerde ayni visual_style kullan: BLACK arka plan, BLUE ana renk, TEAL ikincil renk, YELLOW vurgu, WHITE metin, Georgia font; baslik ustte, ana model merkezde, kisa bilgi altta.
- Son segment disinda ekrani tamamen temizleme veya siyah bos kareyle bitirme. animation.visual_end_state alaninda sonraki sahneye kalacak nesneleri ve kesin konumlarini belirt.
- JSON disinda hicbir sey yazma.`;

  return {
    topic,
    input,
    targetMinutes,
    segmentCount,
    fullLessonPlanner
  };
}

async function createTraditionalLessonPlan(body, userContext) {
  const {
    topic,
    input,
    targetMinutes,
    segmentCount,
    fullLessonPlanner
  } = await buildTraditionalPlannerRequest(body);

  const responseText = await generateLlmText({
    label: 'DeepSeek',
    model: planModel,
    systemInstruction: fullLessonPlanner,
    userText: JSON.stringify(input, null, 2),
    json: true,
    temperature: 0.7,
    thinkingEnabled: deepseekPipelineThinkingEnabled
  });

  const plan = normalizeLessonContinuity(parseLlmJson(responseText || '', 'Ders plani'));
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
  return { plan, lessonId: lesson?.id || null };
}

function createDeferredPromise() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function createIncrementalLessonSegment({
  topic,
  input,
  index,
  segmentCount,
  route,
  previousSegments,
  durationBudget,
  narrationWordTarget,
  narrationWordMaximum
}) {
  const segmentId = `s${index + 1}`;
  const role = index === 0 ? 'opening' : (index === segmentCount - 1 ? 'closing' : 'continuation');
  const request = {
    lesson_topic: topic,
    student_level: input.student_level,
    prior_knowledge: input.prior_knowledge,
    target_video_minutes: input.target_video_minutes,
    route: route.map((pedagogicalRole, routeIndex) => ({
      segment_id: `s${routeIndex + 1}`,
      pedagogical_role: pedagogicalRole
    })),
    current_segment: {
      id: segmentId,
      position: index + 1,
      total: segmentCount,
      pedagogical_role: route[index],
      continuity_role: role,
      duration_seconds: durationBudget.averageSeconds,
      narration_target_words: narrationWordTarget,
      narration_max_words: narrationWordMaximum
    },
    completed_segment_titles: previousSegments.map((segment) => segment.title).filter(Boolean),
    previous_context: compactPreviousSegmentContext(previousSegments, 2)
  };
  const prompt = `Sen Kara Tahta'nin ardışık segment planlayicisisin. Yalniz current_segment icin tek bir segment objesi uret.

Bu segment bagimsiz bir video degil, lesson_topic hakkindaki tek kesintisiz anlatimin teknik render blogudur. route dersin degismeyen pedagojik rotasidir; current_segment yalniz kendisine verilen rolu ilerletsin ve diger rollerin konusunu erken anlatmasin.

ZORUNLU:
- Sadece gecerli JSON dondur; root nesne doğrudan segment olsun.
- id tam olarak ${segmentId} olsun.
- narration dogal Turkce konuşma metni olsun, yaklaşık ${narrationWordTarget} kelimeyi hedeflesin ve ${narrationWordMaximum} kelimeyi gecmesin.
- İlk segment merak uyandiran sezgisel bir acilis yapsin. Devam segmentleri selamlama, yeniden tanitim, ozet veya bolum anonsu yapmadan previous_context icindeki son dusunceyi ilerletsin.
- Yalniz son segment kapanis yapsin. Digerleri bir sonraki role acik anlamsal kopruyle bitsin.
- Onceki segmentlerde anlatilanlari tekrarlama ve lesson_topic disinda yeni konu acma.
- continuity alanlari: role, narrative_bridge, visual_start_state, visual_end_state, transition, visual_style.
- Devam segmentinde visual_start_state onceki visual_end_state ile ayni nesneleri, renkleri ve konumlari korusun.
- visual_style her zaman BLACK arka plan, BLUE ana, TEAL ikincil, YELLOW vurgu, WHITE metin ve Georgia font kullansin.
- animation alanlari: type, description, objects, sequence, highlight_moment, visual_end_state. Son segment disinda ekrani temizleme.
- Matematikte uygun rolde adim adim cozumlu ornek; fende uygun rolde somut deney/uygulama kullan.

Beklenen sekil:
{"id":"${segmentId}","title":"...","duration_seconds":${durationBudget.averageSeconds},"learning_objective":"...","narration":"...","continuity":{"role":"${role}","narrative_bridge":"...","visual_start_state":"...","visual_end_state":"...","transition":"...","visual_style":{}},"animation":{"type":"...","description":"...","objects":[],"sequence":[],"highlight_moment":"...","visual_end_state":"..."},"pause_for_student":false}`;

  const started = Date.now();
  logInfo('Baglamli segment planlama basladi', {
    segmentId,
    index,
    role: route[index],
    previousCount: previousSegments.length
  });
  const responseText = await generateLlmText({
    label: `DeepSeek segment plan ${segmentId}`,
    model: planModel,
    systemInstruction: prompt,
    userText: JSON.stringify(request, null, 2),
    json: true,
    temperature: 0.55,
    maxCompletionTokens: 3500,
    thinkingEnabled: false
  });
  const parsed = parseLlmJson(responseText || '', `${segmentId}: baglamli plan`);
  const candidate = parsed?.segment || parsed?.segments?.[0] || parsed;
  const segment = { ...candidate, id: segmentId };
  if (!isUsableLessonSegment(segment) || !String(segment.narration || '').trim()) {
    throw new Error(`${segmentId}: baglamli planlayici kullanilabilir segment dondurmedi.`);
  }
  logInfo('Baglamli segment planlama tamamlandi', {
    segmentId,
    ms: Date.now() - started,
    chars: responseText.length
  });
  return { segment, rawResponse: responseText };
}

async function startStreamingTraditionalLessonPlan(body, userContext) {
  const {
    topic,
    input,
    targetMinutes,
    segmentCount
  } = await buildTraditionalPlannerRequest(body);
  const durationBudget = segmentDurationBudget(targetMinutes, segmentCount);
  const narrationWordTarget = Math.max(20, Math.round(durationBudget.averageSeconds * 1.55));
  const narrationWordMaximum = Math.max(
    narrationWordTarget + 5,
    Math.round(durationBudget.maxSeconds * 1.65)
  );
  const route = buildIncrementalLessonRoute(segmentCount);
  const lesson = await persist('lesson/streaming-plan-create', () => createLesson({
    userId: userContext.profileId,
    title: topic,
    topic,
    studentLevel: input.student_level,
    targetMinutes,
    targetSegmentCount: segmentCount,
    sourceType: 'topic'
  }));
  const lessonId = lesson?.id || null;
  const segmentDeferreds = Array.from({ length: segmentCount }, () => createDeferredPromise());
  const streamedSegments = new Array(segmentCount);
  const segmentPublishPromises = new Array(segmentCount);
  segmentDeferreds.forEach((deferred) => void deferred.promise.catch(() => {}));

  const publishSegment = (candidate, index) => {
    if (
      index < 0
      || index >= segmentCount
      || segmentPublishPromises[index]
      || !isUsableLessonSegment(candidate)
    ) {
      return segmentPublishPromises[index];
    }
    const segment = normalizeLessonSegmentContinuity({
      ...candidate,
      id: candidate.id || `s${index + 1}`
    }, index, streamedSegments[index - 1] || null, segmentCount);
    streamedSegments[index] = segment;
    segmentPublishPromises[index] = (async () => {
      await persist(`lesson/streaming-segment-${index + 1}`, () => (
        lessonId
          ? saveSegments({ lessonId, segments: [segment], startIndex: index })
          : null
      ));
      const readyAt = new Date().toISOString();
      logInfo('Streaming plan: segment hazir', {
        segmentIndex: index,
        segmentId: segment.id,
        title: segment.title || null
      });
      segmentDeferreds[index].resolve({ segment, readyAt });
      return segment;
    })().catch((error) => {
      segmentDeferreds[index].reject(error);
      throw error;
    });
    return segmentPublishPromises[index];
  };

  const fullPlanPromise = (async () => {
    const rawResponses = [];
    try {
      for (let index = 0; index < segmentCount; index += 1) {
        const result = await createIncrementalLessonSegment({
          topic,
          input,
          index,
          segmentCount,
          route,
          previousSegments: streamedSegments.slice(0, index),
          durationBudget,
          narrationWordTarget,
          narrationWordMaximum
        });
        rawResponses.push(result.rawResponse);
        await publishSegment(result.segment, index);
      }
      const plan = normalizeLessonContinuity({
        topic,
        student_level: input.student_level,
        estimated_duration_minutes: targetMinutes,
        planning_mode: 'incremental_contextual',
        route,
        segments: streamedSegments.slice()
      });
      if (lessonId) {
        plan._lesson_id = lessonId;
      }

      await persist('lesson/streaming-plan-complete', async () => {
        if (!lessonId) return null;
        await updateLesson(lessonId, { title: plan.topic || topic });
        await savePlan({
          lessonId,
          provider: llmProvider,
          model: planModel,
          prompt: 'incremental-contextual-segment-planner',
          plan,
          rawResponse: JSON.stringify(rawResponses)
        });
        return lesson;
      });
      logInfo('Streaming plan: tam plan hazir', {
        topic: plan.topic || topic,
        segments: plan.segments.length
      });
      return plan;
    } catch (error) {
      segmentDeferreds.forEach((deferred, index) => {
        if (!segmentPublishPromises[index]) deferred.reject(error);
      });
      await persist('lesson/streaming-plan-failed', () => (
        lessonId ? updateLesson(lessonId, { status: 'failed' }) : null
      ));
      throw error;
    }
  })();
  void fullPlanPromise.catch(() => {});

  const firstReady = await segmentDeferreds[0].promise;
  const initialPlan = {
    topic,
    estimated_duration_minutes: targetMinutes,
    segments: [firstReady.segment],
    ...(lessonId ? { _lesson_id: lessonId } : {})
  };
  return {
    initialPlan,
    fullPlanPromise,
    segmentPromises: segmentDeferreds.map((deferred) => (
      deferred.promise.then(({ segment }) => segment)
    )),
    lessonId,
    expectedSegmentCount: segmentCount,
    firstSegmentReadyAt: firstReady.readyAt
  };
}

app.post('/api/plan', async (req, res, next) => {
  try {
    const userContext = await resolveRequestUser(req);
    res.json(await createTraditionalLessonPlan(req.body, userContext));
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
        provider: llmProvider,
        model: planModel,
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
                provider: llmProvider,
                model: result.model || planModel,
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

async function queueTraditionalVideoJob({
  plan,
  lessonId,
  userContext,
  requestTimings = {},
  fullPlanPromise = null,
  segmentPromises = null,
  expectedSegmentCount = null
}) {
  if (!plan || !Array.isArray(plan.segments) || !plan.segments.length) {
    const error = new Error('Tam ders icin gecerli plan.segments gerekli.');
    error.statusCode = 400;
    throw error;
  }
  plan = normalizeLessonContinuity(plan);
  await requireOwnedLesson(lessonId, userContext);

  const expectedTotal = Math.max(
    plan.segments.length,
    Number(expectedSegmentCount || plan.segments.length)
  );
  const job = {
    id: `${Date.now()}-${randomUUID().slice(0, 8)}`,
    lessonId,
    userId: userContext.profileId,
    dbJobId: null,
    status: 'queued',
    progress: 0,
    total: expectedTotal,
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
    completedAt: null,
    progressive: createProgressiveState({
      enabled: progressiveManimEnabled,
      bufferTargetSeconds: progressiveBufferSeconds
    }),
    eventChannel: createJobEventChannel(),
    timings: {
      promptReceivedAt: requestTimings.promptReceivedAt || new Date().toISOString(),
      planReadyAt: requestTimings.planReadyAt || new Date().toISOString(),
      fullPlanReadyAt: fullPlanPromise ? null : (requestTimings.planReadyAt || new Date().toISOString()),
      firstSpeechReadyAt: null,
      firstTtsReadyAt: null,
      firstCodeReadyAt: null,
      manimStartedAt: null,
      firstPartialReadyAt: null,
      playbackReadyAt: null,
      firstSegmentCompletedAt: null,
      finalVideoReadyAt: null
    },
    _fullPlanPromise: fullPlanPromise,
    _segmentPromises: segmentPromises
  };

  const dbJob = await persist('generation-job/create', () => createGenerationJob({
    appJobId: job.id,
    lessonId,
    total: job.total,
    current: job.current,
    message: job.message
  }));
  job.dbJobId = dbJob?.id || null;
  await persist('lesson/status-running', () => (
    lessonId ? updateLesson(lessonId, { status: 'generating' }) : null
  ));

  fullVideoJobs.set(job.id, job);
  void runFullVideoJob(job);
  return job;
}

app.post('/api/generate-lesson', async (req, res, next) => {
  try {
    const promptReceivedAt = new Date().toISOString();
    const userContext = await resolveRequestUser(req);
    if (streamingPlanFirstSegmentEnabled) {
      const streamingPlan = await startStreamingTraditionalLessonPlan(req.body, userContext);
      const job = await queueTraditionalVideoJob({
        plan: streamingPlan.initialPlan,
        lessonId: streamingPlan.lessonId,
        userContext,
        fullPlanPromise: streamingPlan.fullPlanPromise,
        segmentPromises: streamingPlan.segmentPromises,
        expectedSegmentCount: streamingPlan.expectedSegmentCount,
        requestTimings: {
          promptReceivedAt,
          planReadyAt: streamingPlan.firstSegmentReadyAt
        }
      });
      return res.status(202).json({
        ...publicJob(job),
        lessonId: streamingPlan.lessonId
      });
    }

    const { plan, lessonId } = await createTraditionalLessonPlan(req.body, userContext);
    const planReadyAt = new Date().toISOString();
    const job = await queueTraditionalVideoJob({
      plan,
      lessonId,
      userContext,
      requestTimings: { promptReceivedAt, planReadyAt }
    });
    res.status(202).json({
      ...publicJob(job),
      plan,
      lessonId
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/full-video', async (req, res, next) => {
  try {
    const userContext = await resolveRequestUser(req);
    const plan = req.body.plan;
    const lessonId = req.body.lesson_id || plan?._lesson_id || null;
    const job = await queueTraditionalVideoJob({
      plan,
      lessonId,
      userContext
    });
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

function requireOwnedJob(jobId, userContext) {
  const job = fullVideoJobs.get(jobId);
  if (!job) {
    const error = new Error('Job bulunamadi.');
    error.statusCode = 404;
    throw error;
  }
  if (job.userId && job.userId !== userContext.profileId) {
    const error = new Error('Bu job bu kullaniciya ait degil.');
    error.statusCode = 403;
    throw error;
  }
  return job;
}

function publicPartial(partial) {
  if (!partial) return null;
  const { _filePath, ...payload } = partial;
  return payload;
}

function scheduleProgressiveCleanup(job) {
  if (!job?.progressive?.partials?.length || job.progressive.cleanupScheduled) return;
  job.progressive.cleanupScheduled = true;
  const directories = new Set(
    job.progressive.partials
      .map((partial) => partial._filePath ? path.dirname(partial._filePath) : null)
      .filter(Boolean)
  );
  const timer = setTimeout(() => {
    void Promise.all([...directories].map((directory) => (
      fs.rm(directory, { recursive: true, force: true })
    ))).then(() => {
      logInfo(`Job ${job.id}: progressive gecici dosyalari temizlendi`, {
        directories: directories.size
      });
    }).catch((error) => {
      logInfo(`Job ${job.id}: progressive dosya temizligi basarisiz`, {
        error: error.message
      });
    });
  }, progressiveArtifactTtlMs);
  timer.unref?.();
}

function writeSse(res, event) {
  res.write(`id: ${event.id}\n`);
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event.payload)}\n\n`);
}

app.get('/api/jobs/:id/events', async (req, res, next) => {
  try {
    const userContext = await resolveRequestUser(req);
    const job = requireOwnedJob(req.params.id, userContext);
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'private, no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const lastEventId = Number(req.headers['last-event-id'] || req.query.after || 0);
    if (!lastEventId) {
      writeSse(res, {
        id: 0,
        type: 'job',
        payload: publicJob(job)
      });
    }
    const afterId = lastEventId || job.eventChannel.latestId();
    const unsubscribe = job.eventChannel.subscribe((event) => writeSse(res, event), afterId);
    const heartbeat = setInterval(() => {
      res.write(`: keepalive ${Date.now()}\n\n`);
    }, 15000);
    const close = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    req.once('close', close);
    res.once('close', close);
  } catch (error) {
    next(error);
  }
});

app.get('/api/jobs/:id/stream-manifest', async (req, res, next) => {
  try {
    const userContext = await resolveRequestUser(req);
    const job = requireOwnedJob(req.params.id, userContext);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      jobId: job.id,
      lessonId: job.lessonId,
      status: job.progressive.status,
      bufferTargetSeconds: job.progressive.bufferTargetSeconds,
      readyDurationSeconds: job.progressive.readyDurationSeconds,
      complete: ['done', 'failed'].includes(job.progressive.status),
      partials: job.progressive.partials.map(publicPartial)
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/jobs/:id/partials/:sequence', async (req, res, next) => {
  try {
    const userContext = await resolveRequestUser(req);
    const job = requireOwnedJob(req.params.id, userContext);
    const sequence = Number(req.params.sequence);
    const partial = job.progressive.partials.find((item) => item.sequence === sequence);
    if (!partial?._filePath) {
      return res.status(404).json({ error: 'Progressive video parcasi hazir degil.' });
    }
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(path.resolve(partial._filePath));
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
    reasoningEffort: deepseekReasoningEffort,
    quality: manimQuality
  });
});
