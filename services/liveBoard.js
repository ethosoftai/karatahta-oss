const LIVE_BOARD_TYPES = new Set([
  'title',
  'write',
  'equation',
  'line',
  'arrow',
  'circle',
  'rectangle',
  'dot',
  'polyline',
  'polygon',
  'axes',
  'plot',
  'bar_chart',
  'diagram',
  'comparison',
  'timeline',
  'highlight',
  'remove',
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
  dot: '#fde68a',
  polyline: '#93c5fd',
  polygon: '#86efac',
  axes: '#cbd5e1',
  plot: '#fde68a',
  bar_chart: '#60a5fa',
  diagram: '#93c5fd',
  comparison: '#c4b5fd',
  timeline: '#93c5fd',
  highlight: '#fde68a',
  remove: '#f8fafc',
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

function safeStringArray(value, maxItems = 8, maxLength = 72) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => safeText(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function safeNumberArray(value, maxItems = 8) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => Number(item))
    .filter(Number.isFinite)
    .slice(0, maxItems)
    .map((item) => clamp(item, -1_000_000, 1_000_000));
}

function safePoints(value, maxItems = 32) {
  if (!Array.isArray(value)) return [];
  return value
    .map((point) => {
      if (Array.isArray(point) && point.length >= 2) {
        return [clamp(point[0], 0, 100), clamp(point[1], 0, 100)];
      }
      if (point && typeof point === 'object') {
        return [clamp(point.x, 0, 100), clamp(point.y, 0, 100)];
      }
      return null;
    })
    .filter(Boolean)
    .slice(0, maxItems);
}

function safeDiagramNodes(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((node) => node && typeof node === 'object' && !Array.isArray(node))
    .slice(0, 7)
    .map((node, index) => ({
      id: safeText(node.id, 40) || `node-${index + 1}`,
      text: safeText(node.text || node.label, 64) || `Adim ${index + 1}`,
      x: clamp(node.x ?? (18 + (index * 13)), 7, 93),
      y: clamp(node.y ?? 52, 10, 90),
      color: safeColor(node.color, '#93c5fd'),
      shape: ['circle', 'box'].includes(safeText(node.shape, 12).toLowerCase())
        ? safeText(node.shape, 12).toLowerCase()
        : 'box'
    }));
}

function safeDiagramEdges(value, nodeIds) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((edge) => edge && typeof edge === 'object' && !Array.isArray(edge))
    .map((edge) => ({
      from: safeText(edge.from, 40),
      to: safeText(edge.to, 40),
      label: safeText(edge.label, 42),
      color: safeColor(edge.color, '#94a3b8')
    }))
    .filter((edge) => edge.from !== edge.to && nodeIds.has(edge.from) && nodeIds.has(edge.to))
    .slice(0, 10);
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
  const targetId = safeText(value.target_id, 80);
  if (targetId) command.target_id = targetId;
  const points = safePoints(value.points);
  if (points.length) command.points = points;
  const labels = safeStringArray(value.labels);
  if (labels.length) command.labels = labels;
  const values = safeNumberArray(value.values);
  if (values.length) command.values = values;
  const items = safeStringArray(value.items, 8, 90);
  if (items.length) command.items = items;
  const leftItems = safeStringArray(value.left_items, 6, 72);
  if (leftItems.length) command.left_items = leftItems;
  const rightItems = safeStringArray(value.right_items, 6, 72);
  if (rightItems.length) command.right_items = rightItems;
  for (const field of ['x_label', 'y_label', 'left_title', 'right_title']) {
    const text = safeText(value[field], 52);
    if (text) command[field] = text;
  }
  if (['polygon', 'bar_chart', 'diagram', 'comparison'].includes(type)) {
    command.fill_opacity = clamp(value.fill_opacity ?? 0.16, 0, 0.85);
  }
  if (type === 'plot') {
    command.smooth = Boolean(value.smooth);
    command.show_axes = value.show_axes !== false;
  }
  if (type === 'bar_chart') command.show_values = value.show_values !== false;

  const nodes = safeDiagramNodes(value.nodes);
  if (nodes.length) {
    command.nodes = nodes;
    const edges = safeDiagramEdges(value.edges, new Set(nodes.map((node) => node.id)));
    if (edges.length) command.edges = edges;
  }

  if (['title', 'write', 'equation'].includes(type) && !command.text) return null;
  if (['polyline', 'plot'].includes(type) && points.length < 2) return null;
  if (type === 'polygon' && points.length < 3) return null;
  if (type === 'bar_chart' && (!labels.length || !values.length)) return null;
  if (type === 'diagram' && nodes.length < 2) return null;
  if (type === 'comparison' && (!leftItems.length || !rightItems.length)) return null;
  if (type === 'timeline' && items.length < 2) return null;
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
- Segment suresine gore 5-10 komut uret. Ilk komut at_percent=0 olan bir title, clear veya write komutu olsun.
- at_percent 0-96 arasinda artan sirada olsun ve konusmadaki ilgili ana denk gelsin.
- Koordinatlar 0-100 arasi yuzdeliktir. Kenarlarda en az 7 birim guvenli alan birak.
- Ekrani dolduran uzun cumleler yazma; anahtar kelime, kisa etiket ve denklem kullan.
- Denklemleri unicode/duz metinle yaz; MathJax veya LaTeX komutu kullanma.
- Dersi metin slaytina cevirme. Her segmentte anlatimi aciklayan en az bir ZENGIN GORSEL kullan:
  diagram, plot, bar_chart, comparison, timeline, polygon veya polyline.
- Mumkunse 2-4 anlamsal zengin komut kullan; onlarca ilkel line/rectangle ile ayni seyi kurma.
- type yalnizca:
  title, write, equation, line, arrow, circle, rectangle, dot, polyline, polygon,
  axes, plot, bar_chart, diagram, comparison, timeline, highlight, remove, clear, wait
- Ortak alanlar:
  id, type, at_percent, duration_ms, text, target_id, x, y, x2, y2, width, height,
  radius, color, font_size, stroke_width, fill_opacity
- polyline/polygon/plot: points=[[x,y],...] (plot icin smooth=true ve show_axes=true kullanabilirsin)
- axes: x_label, y_label, x, y, width, height
- bar_chart: labels=["A","B"], values=[3,7], x, y, width, height, show_values
- timeline: items=["Once","Sonra","Sonuc"], x, y, width
- comparison: left_title, right_title, left_items=[...], right_items=[...], x, y, width, height
- diagram:
  nodes=[{"id":"n1","text":"Girdi","x":22,"y":52,"color":"#93c5fd","shape":"box"},...]
  edges=[{"from":"n1","to":"n2","label":"donusur"},...]
- Bir zengin gorselde en fazla 7 node, 8 item veya 8 bar kullan.
- Her kalici asset icin benzersiz ve anlamli id kullan. Asset, remove/clear gelene kadar Manim sahnesinde kalir.
- Var olan asset'i vurgulamak icin highlight ve target_id kullan. Kaldirmak icin remove ve target_id kullan.
- duration_ms 500-4000 arasi olsun.

Ornekler:
{"id":"intro","type":"title","at_percent":0,"duration_ms":900,"text":"Sinir Agi Nasil Ogrenir?","x":50,"y":12,"color":"#f8fafc","font_size":7}
{"id":"network","type":"diagram","at_percent":12,"duration_ms":1800,"nodes":[{"id":"input","text":"Girdi","x":18,"y":52,"color":"#93c5fd"},{"id":"hidden","text":"Gizli Katman","x":50,"y":52,"color":"#c4b5fd"},{"id":"output","text":"Tahmin","x":82,"y":52,"color":"#86efac"}],"edges":[{"from":"input","to":"hidden","label":"agirliklar"},{"from":"hidden","to":"output","label":"aktivasyon"}]}
{"id":"loss","type":"plot","at_percent":54,"duration_ms":1600,"text":"Hata azalir","points":[[14,30],[26,43],[40,57],[58,67],[82,73]],"smooth":true,"show_axes":true,"x_label":"Adim","y_label":"Hata","color":"#fde68a"}
{"id":"compare","type":"comparison","at_percent":76,"duration_ms":1600,"left_title":"Ilk tahmin","right_title":"Ogrenme sonrasi","left_items":["Yuksek hata","Rastgele agirlik"],"right_items":["Dusuk hata","Ayarlanmis agirlik"],"x":50,"y":55,"width":78,"height":58}

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
    normalizeLiveBoardCommand({
      id: `${segment?.id || 'segment'}-fallback-timeline`,
      type: 'timeline',
      at_percent: 16,
      duration_ms: 1800,
      items: actions.map((action) => safeText(action, 70)),
      x: 50,
      y: 53,
      width: 78,
      color: '#93c5fd'
    }, 1)
  ].filter(Boolean);
}
