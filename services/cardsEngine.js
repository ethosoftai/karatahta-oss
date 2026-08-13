// "Kart" pipeline: prompt/question -> a short sequence of Manim-rendered PNG
// cards, each with its own explanation, generated and rendered one at a time
// (card N's explanation can reference that card N was "just drawn").
import { askDeepSeek } from './deepseekClient.js';
import { renderCardStill } from './manimStillRenderer.js';
import { resolveManimFont } from './renderQuality.js';

const MAX_CARDS = 4;

const CARD_SYSTEM_INSTRUCTION = `Sen Kara Tahta'nın Kart Öğretmenisin. Bir soruyu veya konuyu, art arda gelen
basit görsel kartlarla anlatıyorsun. Her kart tek bir fikri gösterir.

Yanıtın YALNIZCA şu şemaya uyan geçerli JSON olmalı:
{
  "title": "Kartın kısa başlığı",
  "explanation": "Bu kartta ne gösterildiğini anlatan 2-4 cümlelik doğal Türkçe anlatım.",
  "manim_code": "from manim import *\\nclass Card(Scene):\\n    def construct(self):\\n        ...",
  "is_last": false
}

MANIM KURALLARI:
- Tek sınıf: class Card(Scene):
- İlk satır: self.camera.background_color = BLACK
- Koordinatlar x in [-6.5,6.5], y in [-3.5,3.5]
- Sade renkler: BLUE, GREEN, RED, YELLOW, WHITE, GOLD_A, TEAL, ORANGE
- Text("...", font="${resolveManimFont()}") kullan, en fazla 6 kelime/satır
- Basit şekil/diyagram/ok/eksen içersin, yalnız yazı olmasın
- Kod render edilip DURACAK bir still görüntü olacağı için self.wait(0.3) ile bitir, uzun animasyon yapma
- "is_last": bu konunun anlatımı için yeterli kart üretildiyse true, değilse false
- Sadece geçerli JSON döndür, başka hiçbir şey yazma.`;

function fallbackCardCode(title) {
  const safeTitle = String(title || 'Kart').slice(0, 30).replace(/["\\]/g, '');
  return `from manim import *\nclass Card(Scene):\n    def construct(self):\n        self.camera.background_color = BLACK\n        t = Text("${safeTitle}", font="${resolveManimFont()}", font_size=36, color=WHITE)\n        self.play(Write(t))\n        self.wait(0.3)\n`;
}

export async function* generateCardsStream({ prompt }) {
  if (!prompt || !String(prompt).trim()) {
    const error = new Error('prompt bos olamaz.');
    error.statusCode = 400;
    throw error;
  }

  const priorCards = [];
  for (let index = 0; index < MAX_CARDS; index += 1) {
    const historyText = priorCards
      .map((card, i) => `Kart ${i + 1}: ${card.title} — ${card.explanation}`)
      .join('\n');
    const userText = historyText
      ? `Konu/soru: ${prompt}\n\nŞimdiye kadarki kartlar:\n${historyText}\n\nBir sonraki kartı üret (kart ${index + 1}).`
      : `Konu/soru: ${prompt}\n\nİlk kartı üret.`;

    let parsed;
    try {
      parsed = await askDeepSeek({ systemInstruction: CARD_SYSTEM_INSTRUCTION, userText, json: true, temperature: 0.5 });
    } catch (error) {
      parsed = { title: `Kart ${index + 1}`, explanation: 'Bu kart için içerik üretilemedi.', manim_code: null, is_last: true };
    }

    const title = typeof parsed.title === 'string' ? parsed.title.slice(0, 60) : `Kart ${index + 1}`;
    const explanation = typeof parsed.explanation === 'string' ? parsed.explanation : '';
    let imageDataUrl;
    try {
      imageDataUrl = await renderCardStill({ code: parsed.manim_code, cardKey: `c${index + 1}` });
    } catch {
      // Guaranteed-valid fallback scene so the demo never hard-fails on a bad LLM code gen.
      imageDataUrl = await renderCardStill({ code: fallbackCardCode(title), cardKey: `c${index + 1}-fallback` });
    }

    const card = { index: index + 1, title, explanation, imageDataUrl };
    priorCards.push({ title, explanation });
    yield card;

    if (parsed.is_last) break;
  }
}
