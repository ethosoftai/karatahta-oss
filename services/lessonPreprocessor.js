// Small, fast preprocessing pass ("json-deepseek" in product-speak -- it's
// still plain DeepSeek, just called in JSON mode for this one lightweight
// job) that runs before the real planner. It decides three things: a title
// for the lesson/chat, a cleaned-up copy of what the user actually asked
// for, and (mode-dependent) a target video length. For the question-image
// flow it also transcribes the photo first, since deepseek-v4-flash cannot
// read images itself -- this is also the fix for that flow never actually
// reading the uploaded photo.
//
// Kept as pure, network-free functions here (prompt building, response
// parsing, fallback construction) so they're unit-testable without mocking
// Gemini/DeepSeek; server.js wires the actual HTTP calls using its existing
// generateLlmText/generateKaraVisionAnswerWithFallback plumbing.

const MODE_BOUNDS = {
  question: {
    minMinutes: 0.5,
    maxMinutes: 3,
    minSegments: 1,
    maxSegments: 3,
    defaultMinutes: 1,
    defaultSegments: 1
  },
  topic: {
    minMinutes: 2,
    maxMinutes: 20,
    minSegments: 2,
    maxSegments: 12,
    defaultMinutes: 10,
    defaultSegments: 8
  }
};

function boundsFor(mode) {
  return MODE_BOUNDS[mode] || MODE_BOUNDS.topic;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function truncate(value, maxLength) {
  const text = String(value || '').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trim()}…`;
}

export function buildQuestionImageTranscriptionPrompt() {
  return `Bu bir ogrencinin cozemedigi soruya ait fotograf. Gorevin SADECE bu
fotografin icerigini metne dokmek; soruyu cozme veya yorumlama.

- Sorunun tam metnini, varsa sekil/tablo/grafik aciklamasini ve secenekleri
  (coktan secmeliyse) eksiksiz Turkce metne dok.
- Elle yazi zor okunuyorsa en makul okumani yaz, emin degilsen belirt.
- Sadece transkript metnini yaz; giris cumlesi, yorum veya cozum ekleme.`;
}

export function buildLessonAnalysisPrompt({
  rawText = '',
  mode = 'topic',
  studentLevel = 'beginner',
  imageTranscript = ''
} = {}) {
  const bounds = boundsFor(mode);
  const modeGuidance = mode === 'question'
    ? `Bu bir "soru coz" istegi. Video kisa ve odakli olsun: ${bounds.minMinutes}-${bounds.maxMinutes} dakika, ${bounds.minSegments}-${bounds.maxSegments} segment. Sorunun zorlugu ve adim sayisina gore sureyi sen belirle.`
    : `Bu bir "konu anlat" istegi. Video, konunun kapsamina gore ${bounds.minMinutes}-${bounds.maxMinutes} dakika, ${bounds.minSegments}-${bounds.maxSegments} segment arasinda olsun.`;

  const sourceParts = [];
  if (rawText.trim()) sourceParts.push(`Kullanicinin yazdigi metin:\n${rawText.trim()}`);
  if (imageTranscript.trim()) sourceParts.push(`Soru fotografindan cikarilan metin:\n${imageTranscript.trim()}`);
  const source = sourceParts.join('\n\n') || '(bos)';

  return {
    systemInstruction: `Sen Kara Tahta video ders sistemi icin hizli bir on-isleme adimisin.
Gorevin SADECE asagidaki JSON'u uretmek; ders plani veya Manim kodu YAZMA.

${modeGuidance}

ZORUNLU KURALLAR:
- Sadece gecerli JSON dondur. Markdown, aciklama, kod bloğu yazma.
- title: en fazla 60 karakter, ders gecmisinde gorunecek kisa Turkce baslik.
- clean_prompt: kullanicinin ne istedigini acik, tek anlamli, planlayici modelin
  dogrudan kullanabilecegi Turkce bir cumleye/paragrafa donustur; kullanicinin
  yazim hatalarini duzelt, dagınık ifadeyi topla, ama YENI bir konu/kapsam ekleme.
- target_duration_minutes: sayi, ${bounds.minMinutes}-${bounds.maxMinutes} araliginda.
- target_segment_count: tam sayi, ${bounds.minSegments}-${bounds.maxSegments} araliginda.

JSON sekli:
{
  "title": "...",
  "clean_prompt": "...",
  "target_duration_minutes": ${bounds.defaultMinutes},
  "target_segment_count": ${bounds.defaultSegments}
}

Ogrenci seviyesi: ${studentLevel}`,
    userText: source
  };
}

export function parseLessonAnalysis(responseText, { mode = 'topic', rawText = '', imageTranscript = '' } = {}) {
  const bounds = boundsFor(mode);
  let parsed;
  try {
    parsed = JSON.parse(String(responseText || ''));
  } catch {
    parsed = null;
  }

  const fallbackSource = rawText.trim() || imageTranscript.trim();
  const title = truncate(parsed?.title, 60) || truncate(fallbackSource, 60) || 'Yeni ders';
  const cleanPrompt = truncate(parsed?.clean_prompt, 2000) || fallbackSource;

  return {
    title,
    clean_prompt: cleanPrompt,
    target_duration_minutes: clampNumber(
      parsed?.target_duration_minutes,
      bounds.minMinutes,
      bounds.maxMinutes,
      bounds.defaultMinutes
    ),
    target_segment_count: Math.round(clampNumber(
      parsed?.target_segment_count,
      bounds.minSegments,
      bounds.maxSegments,
      bounds.defaultSegments
    )),
    usedFallback: !parsed
  };
}

export function fallbackLessonAnalysis({ rawText = '', imageTranscript = '', mode = 'topic' } = {}) {
  const bounds = boundsFor(mode);
  const fallbackSource = rawText.trim() || imageTranscript.trim();
  return {
    title: truncate(fallbackSource, 60) || 'Yeni ders',
    clean_prompt: fallbackSource,
    target_duration_minutes: bounds.defaultMinutes,
    target_segment_count: bounds.defaultSegments,
    usedFallback: true
  };
}
