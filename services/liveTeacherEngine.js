// "Canlı öğretmen" — turns a student prompt into a short narration plus a
// declarative canvas scene (shapes/text/arrows with normalized 0..1
// coordinates) that the frontend animates live with plain Canvas2D. Using a
// declarative step list instead of generated code means there is no
// compile/render step and nothing can throw at draw time ("zero errors").
import { askDeepSeek } from './deepseekClient.js';

const SYSTEM_INSTRUCTION = `Sen Kara Tahta'nın Canlı Öğretmenisin. Öğrenciye kısa, sohbet diliyle bir konuyu
anlatıyorsun ve aynı anda yanındaki tahtaya basit bir çizim yapıyorsun.

Yanıtın YALNIZCA şu şemaya uyan geçerli JSON olmalı:
{
  "reply": "Öğrenciye söylenecek 2-5 cümlelik doğal, sıcak anlatım (Türkçe).",
  "scene": {
    "steps": [
      { "type": "text", "x": 0.5, "y": 0.12, "text": "Kısa başlık", "size": 30, "color": "#f8fafc", "align": "center" },
      { "type": "circle", "x": 0.3, "y": 0.5, "r": 0.08, "color": "#4ade80", "fill": false },
      { "type": "rect", "x": 0.55, "y": 0.4, "w": 0.2, "h": 0.15, "color": "#60a5fa", "fill": false },
      { "type": "arrow", "x1": 0.38, "y1": 0.5, "x2": 0.55, "y2": 0.47, "color": "#fbbf24" },
      { "type": "line", "x1": 0.1, "y1": 0.8, "x2": 0.9, "y2": 0.8, "color": "#94a3b8" }
    ]
  }
}

KURALLAR:
- x/y/w/h/r hepsi 0 ile 1 arasında normalize koordinat (tahta genişliği/yüksekliği oranı).
- İzin verilen "type": text, circle, rect, arrow, line. Başka tip uydurma.
- En az 3, en fazla 9 step üret. Her step tek bir görsel öğe olsun.
- "reply" alanı adım adım neyi çizdiğini ve neden çizdiğini öğrenciye anlatsın
  (ör. "Şimdi güneş ışığını temsil eden bu oku çiziyorum...").
- Konuşma geçmişini dikkate al, tekrar selamlama yapma (ilk mesaj hariç).
- Sadece geçerli JSON döndür, başka hiçbir şey yazma.`;

function clampNumber(value, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(1, Math.max(0, num));
}

const ALLOWED_STEP_TYPES = new Set(['text', 'circle', 'rect', 'arrow', 'line']);

function sanitizeScene(scene) {
  const steps = Array.isArray(scene?.steps) ? scene.steps : [];
  return {
    steps: steps
      .filter((step) => step && ALLOWED_STEP_TYPES.has(step.type))
      .slice(0, 12)
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
        text: typeof step.text === 'string' ? step.text.slice(0, 60) : '',
        size: Number.isFinite(Number(step.size)) ? Math.min(48, Math.max(12, Number(step.size))) : 24,
        color: typeof step.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(step.color) ? step.color : '#f8fafc',
        fill: Boolean(step.fill),
        align: step.align === 'left' || step.align === 'right' ? step.align : 'center'
      }))
  };
}

export async function generateLiveTeacherTurn({ prompt, history = [] }) {
  if (!prompt || !String(prompt).trim()) {
    const error = new Error('prompt bos olamaz.');
    error.statusCode = 400;
    throw error;
  }
  const historyText = history
    .slice(-6)
    .map((turn) => `${turn.role === 'assistant' ? 'Öğretmen' : 'Öğrenci'}: ${turn.text}`)
    .join('\n');
  const userText = historyText
    ? `Önceki konuşma:\n${historyText}\n\nYeni öğrenci mesajı: ${prompt}`
    : `Öğrenci mesajı: ${prompt}`;

  const parsed = await askDeepSeek({ systemInstruction: SYSTEM_INSTRUCTION, userText, json: true, temperature: 0.5 });
  return {
    reply: typeof parsed.reply === 'string' ? parsed.reply : 'Anladım, tahtaya bakalım.',
    scene: sanitizeScene(parsed.scene)
  };
}
