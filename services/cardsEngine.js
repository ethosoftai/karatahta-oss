// "Kart" pipeline: prompt/question -> a short sequence of Manim-rendered PNG
// cards, each with its own explanation, generated and rendered one at a time
// (card N's explanation can reference that card N was "just drawn"). Once the
// cards are done, the student can keep asking follow-up questions about them
// in a normal chat flow (answerCardsQuestion), the same shape as ask-kara but
// without lesson/video/frame context since cards have none of that.
import { askDeepSeek } from './deepseekClient.js';
import { renderCardImage } from './cardRenderer.js';
import { generateKaraVisionAnswerWithFallback, parseKaraVisionModels } from './karaVision.js';
import { buildQuestionImageTranscriptionPrompt } from './lessonPreprocessor.js';

const MAX_CARDS = 4;

// Standalone Gemini vision setup for the cards "soru fotografi" upload path
// -- deliberately not imported from server.js (see deepseekClient.js's note
// on why these newer feature modules read env vars directly instead).
const cardsVisionApiKey = String(process.env.GEMINI_API_KEY || '').trim();
const cardsVisionModels = parseKaraVisionModels(
  process.env.KARA_VISION_MODELS || process.env.KARA_VISION_MODEL || 'gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-2.5-flash-lite'
);
const cardsVisionTimeoutMs = Math.max(1000, Number(process.env.GEMINI_REQUEST_TIMEOUT_MS) || 45000);
const cardsVisionEnabled = Boolean(cardsVisionApiKey && cardsVisionModels.length);

const CARD_SYSTEM_INSTRUCTION = `Sen Kara Tahta'nın Kart Öğretmenisin. Bir soruyu veya konuyu, art arda gelen
basit görsel kartlarla anlatıyorsun. Her kart tek bir fikri gösterir.

Yanıtın YALNIZCA şu şemaya uyan geçerli JSON olmalı:
{
  "title": "Kartın kısa başlığı",
  "explanation": "Bu kartta ne gösterildiğini anlatan, öğretmen gibi konuşan 3-5 cümlelik doğal ve DETAYLI Türkçe anlatım.",
  "scene": { "steps": [ { "type": "text", "x": 0.5, "y": 0.3, "text": "...", "size": 28, "color": "#f8fafc", "align": "center" } ] },
  "is_last": false
}

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
- "is_last": bu konunun anlatımı için yeterli kart üretildiyse true, değilse false
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

  const priorCards = [];
  for (let index = 0; index < MAX_CARDS; index += 1) {
    const historyText = priorCards
      .map((card, i) => `Kart ${i + 1}: ${card.title} — ${card.explanation}`)
      .join('\n');
    const userText = historyText
      ? `${subject}\n\nŞimdiye kadarki kartlar:\n${historyText}\n\nBir sonraki kartı üret (kart ${index + 1}).`
      : `${subject}\n\nİlk kartı üret.`;

    let parsed;
    try {
      parsed = await askDeepSeek({ systemInstruction: CARD_SYSTEM_INSTRUCTION, userText, json: true, temperature: 0.5 });
    } catch (error) {
      parsed = { title: `Kart ${index + 1}`, explanation: 'Bu kart için içerik üretilemedi.', scene: null, is_last: true };
    }

    const title = typeof parsed.title === 'string' ? parsed.title.slice(0, 60) : `Kart ${index + 1}`;
    const explanation = typeof parsed.explanation === 'string' ? parsed.explanation : '';
    let imageDataUrl;
    try {
      imageDataUrl = await renderCardImage({ title, scene: parsed.scene ? sanitizeScene(parsed.scene) : fallbackScene(title), cardKey: `c${index + 1}` });
    } catch {
      // Guaranteed-valid fallback scene so the demo never hard-fails on a bad LLM scene.
      imageDataUrl = await renderCardImage({ title, scene: fallbackScene(title), cardKey: `c${index + 1}-fallback` });
    }

    const card = { index: index + 1, title, explanation, imageDataUrl };
    priorCards.push({ title, explanation });
    yield card;

    if (parsed.is_last) break;
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
