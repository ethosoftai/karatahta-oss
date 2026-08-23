// "Kart" pipeline: prompt/question -> a short sequence of Manim-rendered PNG
// cards, each with its own explanation, generated and rendered one at a time
// (card N's explanation can reference that card N was "just drawn"). Once the
// cards are done, the student can keep asking follow-up questions about them
// in a normal chat flow (answerCardsQuestion), the same shape as ask-kara but
// without lesson/video/frame context since cards have none of that.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { askDeepSeek } from './deepseekClient.js';
import { renderCardImage } from './cardRenderer.js';
import { generateKaraVisionAnswerWithFallback, parseKaraVisionModels } from './karaVision.js';
import { buildQuestionImageTranscriptionPrompt } from './lessonPreprocessor.js';

const MAX_CARDS = 4;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Only loaded when the student supplied a question (not a bare topic) --
// mirrors the video pipeline's skill/question/*.md split (server.js's
// loadManimGuide), adapted to the cards' declarative step schema instead of
// Manim/Python. See skill/cards/question_solving.md and latex_writing.md.
async function loadCardsQuestionGuide() {
  const relativePaths = [
    path.join('skill', 'cards', 'question_solving.md'),
    path.join('skill', 'cards', 'latex_writing.md')
  ];
  const sections = [];
  for (const relativePath of relativePaths) {
    try {
      const content = (await readFile(path.join(projectRoot, relativePath), 'utf8')).trim();
      if (content) {
        sections.push(`## KART SORU COZUMU ZORUNLU KAYNAK: ${relativePath.replaceAll(path.sep, '/')}\n\n${content}`);
      }
    } catch {
      // Optional -- a missing file just means this guidance is skipped.
    }
  }
  return sections.join('\n\n---\n\n');
}

// Standalone Gemini vision setup for the cards "soru fotografi" upload path
// -- deliberately not imported from server.js (see deepseekClient.js's note
// on why these newer feature modules read env vars directly instead).
const cardsVisionApiKey = String(process.env.GEMINI_API_KEY || '').trim();
const cardsVisionModels = parseKaraVisionModels(
  process.env.KARA_VISION_MODELS || process.env.KARA_VISION_MODEL || 'gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-2.5-flash-lite'
);
const cardsVisionTimeoutMs = Math.max(1000, Number(process.env.GEMINI_REQUEST_TIMEOUT_MS) || 45000);
const cardsVisionEnabled = Boolean(cardsVisionApiKey && cardsVisionModels.length);

// Card count/roles are decided upfront by planCardSequence() -- this
// instruction renders ONE already-planned card at a time. It's told that
// card's role/goal and (from card 2 on) the previous card's real scene JSON
// in the user message each call; see generateCardsStream.
const CARD_SYSTEM_INSTRUCTION = `Sen Kara Tahta'nın Kart Öğretmenisin. Bir soruyu veya konuyu, art arda gelen
basit görsel kartlarla anlatıyorsun. Her kart tek bir fikri gösterir. Kaç kart
olacağı ve her kartın rolü ÖNCEDEN planlandı -- sana her istekte o anki kartın
"role"/"goal" bilgisini ve (varsa) önceki kartın gerçek "scene" JSON'unu
veriyorum. Planı sen değiştirmiyorsun, yalnızca o tek kartı üretiyorsun.

Yanıtın YALNIZCA şu şemaya uyan geçerli JSON olmalı:
{
  "title": "Kartın kısa başlığı",
  "explanation": "Bu kartta ne gösterildiğini anlatan, öğretmen gibi konuşan 3-5 cümlelik doğal ve DETAYLI Türkçe anlatım.",
  "scene": { "steps": [ { "type": "text", "x": 0.5, "y": 0.3, "text": "...", "size": 28, "color": "#f8fafc", "align": "center" } ] }
}

ROL "result" İSE ZORUNLU KURAL: Bu, planın SON kartı ve ertelenecek bir sonraki
kart yok. Hem "explanation"da hem "scene"de somut, hesaplanmış nihai cevap
AÇIKÇA yer almalı (örn "x = 4", "c = 5 cm"). "Bir sonraki adımda göreceğiz"
gibi cevabı erteleyen bir ifadeyle bitirme -- cevabı burada hesapla ve göster.

SÜREKLİLİK: Sana önceki kartın "scene" JSON'u verilirse, aynı nesnenin (şekil,
eksen, vb.) aynı x/y konumunu koru -- öğrenci kartları sırayla gördüğünde aynı
çizimin devam ettiğini hissetmeli; sıfırdan farklı bir kompozisyon kurma.

BU ÜÇ ALAN EKRANDA FARKLI YERLERDE GÖRÜNÜR -- HANGİSİ NEREYE GİDİYOR KARIŞTIRMA:
- "title" -> Kartın GÖRSELİNİN en üstüne otomatik olarak, sistem tarafından yazılır. Bunu ayrıca
  "scene.steps" içine bir "text" adımı olarak TEKRAR EKLEME; ekrarsan başlık iki kez görünür.
- "explanation" -> Görselin İÇİNDE HİÇ GÖRÜNMEZ. Öğrenciye sohbet ekranında, kartın görselinin
  HEMEN ALTINDA ayrı bir metin kutusu olarak gösterilir; sesli anlatan bir öğretmen gibi düşün.
  Burası uzun ve açıklayıcı olabilir/olmalı (konuyu gerçekten öğretecek kadar detaylı yaz, tek
  cümlelik yüzeysel özet yazma).
- "scene.steps" -> Görselin İÇİNDE, verdiğin x/y koordinatına göre çizilen her şey; öğrenci bunu
  resmin üzerinde bir etiket/denklem/şekil olarak görür. Burası paragraf yazmak için DEĞİL, kısa
  etiketler ve denklemler için (uzunluk kuralı aşağıda).

SCENE/STEPS KURALLARI:
- "steps" dizisi en fazla 8 öğe içerir, sırayla üstten çizilir.
- "x" ve "y" 0 ile 1 arasında normalize koordinat (0,0 sol-üst, 1,1 sağ-alt).
- type "text": görsel üzerindeki etiket veya kısa cümle, en fazla 12-14 kelime (~90 karakter);
  gerekirse otomatik iki satıra sarar, o yüzden tek satıra sığdırmaya çalışıp kısaltma. Alanlar:
  x, y, text, size (12-48), color (hex, örn "#f8fafc"), align ("left"|"center"|"right").
- type "math": LaTeX matematik ifadesi. Alanlar: x, y, latex (örn "x^2 + y^2 = r^2"), size, color. Yalnızca gerçekten matematik/formül olan yerlerde kullan, düz yazı için "text" kullan.
- type "circle": Alanlar: x, y (merkez), r (0-1 arası yarıçap), color, fill (true/false).
- type "rect": Alanlar: x, y (merkez), w, h (0-1 arası), color, fill.
- type "line" / "arrow": Alanlar: x1, y1, x2, y2 (0-1 arası uç noktalar), color. "arrow" ucu ok işaretiyle biter.
- Aynı kartta birden fazla "text"/"math" adımı varsa üst üste binmesinler diye aralarında en az
  0.12 birim "y" farkı bırak (uzun metin iki satıra sarınca daha da fazla yer kaplar, ona göre pay bırak).
- Sade renkler kullan: "#60a5fa" (mavi), "#4ade80" (yeşil), "#f87171" (kırmızı), "#facc15" (sarı), "#f8fafc" (beyaz), "#fb923c" (turuncu).
- En az bir şekil/diyagram/ok adımı içersin, yalnız yazı/matematik olmasın.
- Sadece geçerli JSON döndür, başka hiçbir şey yazma.`;

// Runs once, before any card is rendered, to decide how many cards this
// subject needs and what each one's job is -- fixes the failure mode where
// per-card generation (no shared plan) let the model declare a question
// "done" before it had actually computed/shown the answer. See
// planCardSequence().
const CARD_PLAN_SYSTEM_INSTRUCTION = `Sen Kara Tahta'nın Kart Öğretmenisin. Kartları üretmeye başlamadan ÖNCE tüm
diziyi planlıyorsun -- kaç karta ihtiyaç var ve her biri ne işe yarayacak.

Yanıtın YALNIZCA şu şemaya uyan geçerli JSON olmalı:
{
  "cards": [
    { "role": "given" | "step" | "result" | "concept", "goal": "Bu kartta tam olarak ne gösterilecek (1-2 cümle)" }
  ]
}

KURALLAR:
- En az 1, en fazla ${MAX_CARDS} kart planla -- sığdırmak için iki fikri bir karta sıkıştırma, gerekirse daha fazla kart kullan.
- Öğrencinin SORUSU varsa (soru çözümü): ilk kart(lar) "given" (soru nesnesi + verilenler), ortadaki(ler) "step" (hesaplama/çıkarım), plan MUTLAKA "result" rolünde bir kartla bitsin ve o kartın "goal"ında somut sayısal/nihai cevap açıkça yazsın. "result" ilk kart olamaz.
- Yalnızca genel bir KONU varsa (soru yok): kartlar "concept" rolünde, konuyu farklı açılardan/adımlarla anlatan bağımsız fikirler olsun; "result" zorunlu değil.
- Sadece geçerli JSON döndür, başka hiçbir şey yazma.`;

const CARDS_CHAT_SYSTEM_INSTRUCTION = `Sen Kara Tahta'nın Kart Öğretmenisin. Öğrenciye az önce bir dizi kart ile bir
konuyu/soruyu anlattın; kartlar artık ekranda duruyor. Şimdi öğrenci sana bu
kartlarla ilgili ya da devamıyla ilgili bir takip sorusu soruyor.

- Yeni kart ÜRETMİYORSUN, yalnızca normal, sıcak bir sohbet diliyle Türkçe
  cevap veriyorsun.
- Gösterilen kartlara ve önceki sohbete gönderme yapabilirsin.
- Cevabın kısa ve net olsun (en fazla 5-6 cümle).
- Sadece düz metin döndür; JSON, markdown başlığı veya kod bloğu kullanma.`;

function clampNumber(value, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(1, Math.max(0, num));
}

const ALLOWED_STEP_TYPES = new Set(['text', 'math', 'circle', 'rect', 'arrow', 'line']);

function sanitizeScene(scene) {
  const steps = Array.isArray(scene?.steps) ? scene.steps : [];
  return {
    steps: steps
      .filter((step) => step && ALLOWED_STEP_TYPES.has(step.type))
      .slice(0, 8)
      .map((step) => ({
        type: step.type,
        x: clampNumber(step.x, 0.5),
        y: clampNumber(step.y, 0.5),
        x1: clampNumber(step.x1, 0.2),
        y1: clampNumber(step.y1, 0.5),
        x2: clampNumber(step.x2, 0.8),
        y2: clampNumber(step.y2, 0.5),
        w: clampNumber(step.w, 0.15),
        h: clampNumber(step.h, 0.15),
        r: clampNumber(step.r, 0.08),
        text: typeof step.text === 'string' ? step.text.slice(0, 140) : '',
        latex: typeof step.latex === 'string' ? step.latex.slice(0, 120) : '',
        size: Number.isFinite(Number(step.size)) ? Math.min(48, Math.max(12, Number(step.size))) : 24,
        color: typeof step.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(step.color) ? step.color : '#f8fafc',
        fill: Boolean(step.fill),
        align: step.align === 'left' || step.align === 'right' ? step.align : 'center'
      }))
  };
}

function fallbackScene(title) {
  const safeTitle = String(title || 'Kart').slice(0, 30);
  return { steps: [{ type: 'text', x: 0.5, y: 0.5, text: safeTitle, size: 36, color: '#f8fafc', align: 'center' }] };
}

const CARD_ROLES = new Set(['given', 'step', 'result', 'concept']);

// Decides card count/roles up front (one call), instead of letting each
// per-card call decide in isolation whether to stop -- that per-card
// approach let the model mark is_last:true before it had actually computed
// the answer (observed live: a Pythagorean-theorem question stopped right
// after substituting values, never showing c=5cm). The `isQuestion &&
// last role !== 'result'` guard below is a hard, non-LLM backstop: even if
// the model's plan doesn't end on a result card, we force it to.
async function planCardSequence({ planSystemInstruction, subject, isQuestion }) {
  const userText = `${subject}\n\nBu konu/soru icin kart planini uret.`;
  let parsed;
  try {
    parsed = await askDeepSeek({ systemInstruction: planSystemInstruction, userText, json: true, temperature: 0.4 });
  } catch {
    parsed = null;
  }
  let cards = (Array.isArray(parsed?.cards) ? parsed.cards : [])
    .filter((card) => card && typeof card === 'object')
    .slice(0, MAX_CARDS)
    .map((card) => ({
      role: CARD_ROLES.has(card.role) ? card.role : (isQuestion ? 'step' : 'concept'),
      goal: typeof card.goal === 'string' && card.goal.trim() ? card.goal.slice(0, 300) : 'Konuyu anlat.'
    }));
  if (!cards.length) {
    cards = [{ role: isQuestion ? 'result' : 'concept', goal: subject.slice(0, 300) || 'Konuyu anlat.' }];
  }
  if (isQuestion && cards[cards.length - 1].role !== 'result') {
    const resultCard = { role: 'result', goal: 'Sorunun nihai/sayisal sonucunu acikca goster.' };
    if (cards.length >= MAX_CARDS) {
      cards[cards.length - 1] = resultCard;
    } else {
      cards.push(resultCard);
    }
  }
  return cards;
}

// One repair attempt when a card's scene fails to render (bad/missing
// shape) -- mirrors server.js's repairManimCodeWithLlm for the video
// pipeline. Only the scene is touched; title/explanation are kept as-is.
async function repairCardScene({ systemInstruction, title, explanation, brokenScene, errorMessage }) {
  const prompt = {
    task: 'Bu kartin "scene" JSON\'u render edilemedi. Hatayi dikkate alarak SADECE scene JSON\'unu duzelt.',
    title,
    explanation,
    broken_scene: brokenScene,
    render_error: String(errorMessage || '').slice(0, 2000),
    rules: [
      'Yanit YALNIZCA {"steps": [...]} seklinde gecerli JSON olsun.',
      'title/explanation degistirme, yalniz steps dizisini duzelt.',
      'steps en fazla 8 oge, her birinin type alani text/math/circle/rect/line/arrow olmali.'
    ]
  };
  const parsed = await askDeepSeek({
    systemInstruction,
    userText: JSON.stringify(prompt),
    json: true,
    temperature: 0.2
  });
  return sanitizeScene(Array.isArray(parsed?.steps) ? parsed : parsed?.scene);
}

// `topic` is the general subject ("Pisagor teoremi"); `question` is the
// student's exact wording of what they asked (typed or transcribed from a
// question photo upstream). Either one alone is enough to start.
function buildSubjectText({ topic, question }) {
  const parts = [];
  if (topic) parts.push(`Konu: ${topic}`);
  if (question) parts.push(`Öğrencinin sorusu: ${question}`);
  return parts.join('\n');
}

function normalizeQuestionImage(image) {
  const rawData = String(image?.data || '');
  const mimeType = String(image?.mimeType || image?.mime_type || '').trim();
  const data = rawData.includes(',') ? rawData.slice(rawData.indexOf(',') + 1) : rawData;
  if (!data || !mimeType.startsWith('image/')) {
    const error = new Error('Gecerli bir soru fotografi bekleniyor.');
    error.statusCode = 400;
    throw error;
  }
  return { mimeType, data };
}

// Lets a student attach a photo of a question instead of (or alongside)
// typing it; the photo is transcribed to plain text and fed into
// generateCardsStream's `question` field like any typed question.
export async function transcribeCardsQuestionImage(image) {
  if (!cardsVisionEnabled) {
    const error = new Error('Soru fotografi okumak icin GEMINI_API_KEY tanimli degil. Soruyu metin olarak yazin.');
    error.statusCode = 422;
    throw error;
  }
  const frame = normalizeQuestionImage(image);
  const result = await generateKaraVisionAnswerWithFallback({
    apiKey: cardsVisionApiKey,
    models: cardsVisionModels,
    prompt: buildQuestionImageTranscriptionPrompt(),
    frame,
    timeoutMs: cardsVisionTimeoutMs
  });
  return String(result.answer || '').trim();
}

export async function* generateCardsStream({ prompt, topic, question }) {
  const resolvedTopic = String(topic || prompt || '').trim();
  const resolvedQuestion = String(question || '').trim();
  if (!resolvedTopic && !resolvedQuestion) {
    const error = new Error('prompt bos olamaz.');
    error.statusCode = 400;
    throw error;
  }
  const subject = buildSubjectText({ topic: resolvedTopic, question: resolvedQuestion });
  const questionGuide = resolvedQuestion ? await loadCardsQuestionGuide() : '';
  const planSystemInstruction = questionGuide
    ? `${CARD_PLAN_SYSTEM_INSTRUCTION}\n\n${questionGuide}`
    : CARD_PLAN_SYSTEM_INSTRUCTION;
  const cardSystemInstruction = questionGuide
    ? `${CARD_SYSTEM_INSTRUCTION}\n\n${questionGuide}`
    : CARD_SYSTEM_INSTRUCTION;

  const plannedCards = await planCardSequence({
    planSystemInstruction,
    subject,
    isQuestion: Boolean(resolvedQuestion)
  });

  const priorCards = [];
  let previousScene = null;
  for (let index = 0; index < plannedCards.length; index += 1) {
    const planned = plannedCards[index];
    const historyText = priorCards
      .map((card, i) => `Kart ${i + 1}: ${card.title} — ${card.explanation}`)
      .join('\n');
    const userText = [
      subject,
      historyText ? `Şimdiye kadarki kartlar:\n${historyText}` : '',
      `Bu kart ${index + 1}/${plannedCards.length}. Rolü: ${planned.role}. Amacı: ${planned.goal}`,
      previousScene ? `Önceki kartın gerçek scene JSON'u (aynı nesneleri aynı konumda koru):\n${JSON.stringify(previousScene)}` : '',
      'Bu kartı üret.'
    ].filter(Boolean).join('\n\n');

    let parsed;
    try {
      parsed = await askDeepSeek({ systemInstruction: cardSystemInstruction, userText, json: true, temperature: 0.5 });
    } catch {
      parsed = { title: planned.goal.slice(0, 60) || `Kart ${index + 1}`, explanation: 'Bu kart için içerik üretilemedi.', scene: null };
    }

    const title = typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.slice(0, 60) : `Kart ${index + 1}`;
    const explanation = typeof parsed.explanation === 'string' ? parsed.explanation : '';
    let scene = parsed.scene ? sanitizeScene(parsed.scene) : null;
    let imageDataUrl;
    try {
      if (!scene || !scene.steps.length) throw new Error('Scene bos veya gecersiz.');
      imageDataUrl = await renderCardImage({ title, scene, cardKey: `c${index + 1}` });
    } catch (renderError) {
      try {
        scene = await repairCardScene({
          systemInstruction: cardSystemInstruction,
          title,
          explanation,
          brokenScene: parsed.scene || null,
          errorMessage: renderError.message
        });
        if (!scene.steps.length) throw new Error('Onarim da bos scene dondurdu.');
        imageDataUrl = await renderCardImage({ title, scene, cardKey: `c${index + 1}-repaired` });
      } catch {
        // Guaranteed-valid fallback scene so the demo never hard-fails.
        scene = fallbackScene(title);
        imageDataUrl = await renderCardImage({ title, scene, cardKey: `c${index + 1}-fallback` });
      }
    }

    const card = { index: index + 1, title, explanation, imageDataUrl };
    priorCards.push({ title, explanation });
    previousScene = scene;
    yield card;
  }
}

// Follow-up chat once the card sequence is done -- same shape as ask-kara
// (question + history in, answer text out) but scoped to the cards just
// shown, with no lesson/video/frame context to carry.
export async function answerCardsQuestion({ question, cards = [], history = [] }) {
  const trimmedQuestion = String(question || '').trim();
  if (!trimmedQuestion) {
    const error = new Error('Soru bos olamaz.');
    error.statusCode = 400;
    throw error;
  }

  const cardsContext = (Array.isArray(cards) ? cards : [])
    .slice(0, MAX_CARDS)
    .map((card, i) => `Kart ${i + 1}: ${card.title || ''} — ${card.explanation || ''}`)
    .join('\n');
  const historyText = (Array.isArray(history) ? history : [])
    .slice(-10)
    .map((turn) => `${turn.role === 'assistant' ? 'Öğretmen' : 'Öğrenci'}: ${turn.content ?? turn.text ?? ''}`)
    .join('\n');

  const userText = [
    cardsContext ? `Gösterilen kartlar:\n${cardsContext}` : '',
    historyText ? `Önceki sohbet:\n${historyText}` : '',
    `Yeni öğrenci sorusu: ${trimmedQuestion}`
  ].filter(Boolean).join('\n\n');

  const answer = await askDeepSeek({
    systemInstruction: CARDS_CHAT_SYSTEM_INSTRUCTION,
    userText,
    json: false,
    temperature: 0.5
  });

  return { answer: String(answer || '').trim() || 'Bu soruya şu an cevap üretemedim, tekrar dener misin?' };
}
