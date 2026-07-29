const LIVE_BOARD_TYPES = new Set([
  'title',
  'write',
  'equation',
  'line',
  'arrow',
  'circle',
  'rectangle',
  'clear',
  'wait'
]);

const DEFAULT_COLORS = {
  title: '#f8fafc',
  write: '#e2e8f0',
  equation: '#fde68a',
  line: '#93c5fd',
  arrow: '#93c5fd',
  circle: '#86efac',
  rectangle: '#c4b5fd',
  clear: '#f8fafc',
  wait: '#f8fafc'
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function safeText(value, maxLength = 360) {
  return String(value || '').trim().slice(0, maxLength);
}

function safeColor(value, fallback) {
  const color = String(value || '').trim();
  return /^(#[0-9a-f]{3,8}|[a-z]{3,20})$/i.test(color) ? color : fallback;
}

export function normalizeLiveBoardCommand(value, index = 0) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const type = safeText(value.type, 24).toLowerCase();
  if (!LIVE_BOARD_TYPES.has(type)) return null;

  const command = {
    id: safeText(value.id, 80) || `live-${index + 1}`,
    type,
    at_percent: clamp(value.at_percent, 0, 100),
    duration_ms: clamp(value.duration_ms || 1400, 250, 12000),
    color: safeColor(value.color, DEFAULT_COLORS[type]),
    text: safeText(value.text),
    x: clamp(value.x ?? 12, 0, 100),
    y: clamp(value.y ?? 18, 0, 100),
    x2: clamp(value.x2 ?? 88, 0, 100),
    y2: clamp(value.y2 ?? 82, 0, 100),
    width: clamp(value.width ?? 24, 1, 100),
    height: clamp(value.height ?? 18, 1, 100),
    radius: clamp(value.radius ?? 9, 1, 50),
    font_size: clamp(value.font_size || (type === 'title' ? 7 : 4.4), 2, 12),
    stroke_width: clamp(value.stroke_width || 0.7, 0.2, 4)
  };

  if (['title', 'write', 'equation'].includes(type) && !command.text) return null;
  return command;
}

function parseLine(line, index) {
  const trimmed = String(line || '')
    .trim()
    .replace(/^```(?:json|jsonl|ndjson)?\s*/i, '')
    .replace(/\s*```$/, '');
  if (!trimmed || !trimmed.startsWith('{')) return null;
  try {
    return normalizeLiveBoardCommand(JSON.parse(trimmed), index);
  } catch {
    return null;
  }
}

export function createLiveBoardNdjsonParser(onCommand) {
  let buffer = '';
  let commandIndex = 0;

  const consume = (flush = false) => {
    const lines = buffer.split(/\r?\n/);
    buffer = flush ? '' : (lines.pop() || '');
    for (const line of lines) {
      const command = parseLine(line, commandIndex);
      if (!command) continue;
      commandIndex += 1;
      onCommand(command);
    }
    if (flush && buffer.trim()) {
      const command = parseLine(buffer, commandIndex);
      if (command) {
        commandIndex += 1;
        onCommand(command);
      }
      buffer = '';
    }
  };

  return {
    push(chunk) {
      buffer += String(chunk || '');
      consume(false);
    },
    finish() {
      // Add a newline so the final complete JSON object is consumed.
      buffer += '\n';
      consume(true);
    }
  };
}

export function buildLiveBoardPrompt(segment) {
  const compactSegment = {
    id: segment?.id,
    title: segment?.title,
    learning_objective: segment?.learning_objective,
    narration: segment?.narration,
    animation: segment?.animation,
    duration_seconds: segment?.duration_seconds
  };

  return `Sen Kara Tahta'nin canli gorsel yonetmenisin.
Asagidaki ders segmentini, ses devam ederken tarayicidaki 16:9 siyah tahtada oynatilacak atomik komutlara cevir.

KESIN CIKTI KURALLARI:
- Yalnizca NDJSON yaz: her satir tek, tamamlanmis ve gecerli bir JSON nesnesi olsun.
- Markdown kod blogu, aciklama, dizi veya virgulle ayrilmis coklu nesne yazma.
- 5-10 komut uret. Ilk komut at_percent=0 olan bir title veya write komutu olsun.
- at_percent 0-96 arasinda artan sirada olsun ve konusmadaki ilgili ana denk gelsin.
- Koordinatlar 0-100 arasi yuzdeliktir. Kenarlarda en az 7 birim guvenli alan birak.
- Ekrani dolduran uzun cumleler yazma; anahtar kelime, kisa etiket ve denklem kullan.
- Denklemleri unicode/duz metinle yaz; MathJax veya LaTeX komutu kullanma.
- Her komutta su alanlar bulunabilir:
  id, type, at_percent, duration_ms, text, x, y, x2, y2, width, height, radius, color, font_size, stroke_width
- type yalnizca: title, write, equation, line, arrow, circle, rectangle, clear, wait
- duration_ms 500-4000 arasi olsun.

Ornek:
{"id":"intro","type":"title","at_percent":0,"duration_ms":1500,"text":"Pisagor Teoremi","x":50,"y":14,"color":"#f8fafc","font_size":7}
{"id":"triangle-a","type":"line","at_percent":18,"duration_ms":1000,"x":24,"y":72,"x2":62,"y2":72,"color":"#93c5fd"}
{"id":"formula","type":"equation","at_percent":62,"duration_ms":1600,"text":"a² + b² = c²","x":68,"y":34,"color":"#fde68a","font_size":6}

SEGMENT:
${JSON.stringify(compactSegment, null, 2)}`;
}

export function buildFallbackLiveBoardCommands(segment) {
  const sequence = Array.isArray(segment?.animation?.sequence)
    ? segment.animation.sequence.filter(Boolean).slice(0, 5)
    : [];
  const title = safeText(segment?.title || segment?.learning_objective || 'Canli ders', 80);
  const actions = sequence.length
    ? sequence
    : [segment?.animation?.description || segment?.learning_objective || 'Ana fikir'];

  return [
    normalizeLiveBoardCommand({
      id: `${segment?.id || 'segment'}-title`,
      type: 'title',
      at_percent: 0,
      duration_ms: 1200,
      text: title,
      x: 50,
      y: 14,
      font_size: 7
    }, 0),
    ...actions.map((action, index) => normalizeLiveBoardCommand({
      id: `${segment?.id || 'segment'}-fallback-${index + 1}`,
      type: index % 2 === 0 ? 'write' : 'equation',
      at_percent: Math.round(18 + (index * (72 / Math.max(1, actions.length - 1)))),
      duration_ms: 1400,
      text: safeText(action, 90),
      x: index % 2 === 0 ? 12 : 52,
      y: 32 + ((index % 3) * 18),
      font_size: 4.3
    }, index + 1))
  ].filter(Boolean);
}
