import { GoogleGenAI, Modality } from '@google/genai';
import { buildKaraLiveTools } from './karaLiveTools.js';

export const DEFAULT_KARA_LIVE_MODEL = 'gemini-live-2.5-flash-preview-native-audio-09-2025';

export function buildKaraLiveSystemInstruction({ lessonTitle = '', lessonPlan = null } = {}) {
  return `Sen Kara Tahta icindeki "Kara" adli sesli egitim asistanisin. Ogrenciyle canli, sesli olarak konusuyorsun; video izlerken sorularini cevapliyorsun.

KURALLAR:
- Turkce konus, dogal ve kisa cumlelerle; bu sesli bir sohbet, uzun paragraf okuma.
- Ogrenci ekranda belirli bir andan bahsediyorsa veya "su an ne oluyor" gibi bir soru soruyorsa get_frame aracini kullanarak o zamandaki gercek video karesini incele, sonra cevapla.
- get_frame sonucunu almadan ekranda ne oldugunu biliyormus gibi konusma.
- Guncel veya dogrulama gerektiren bilgi icin web_search kullan.
- Ogrenci bir seyi gorsellestirmeni isterse generate_manim kullan; sonucu bekleyip aciklamadan "olusturdum" deme.
- Ayni araci gereksiz yere art arda cagirma.

Ders basligi: ${lessonTitle || 'Bilinmiyor'}
Ders plani ozeti: ${lessonPlan ? JSON.stringify(lessonPlan).slice(0, 4000) : 'Yok'}`;
}

function normalizeServerMessage(message) {
  const content = message?.serverContent;
  if (!content) return { type: 'unknown', raw: message };

  const audioChunks = (content.modelTurn?.parts || [])
    .filter((part) => String(part?.inlineData?.mimeType || '').startsWith('audio/'))
    .map((part) => part.inlineData.data);

  return {
    type: 'server_content',
    audioChunks,
    inputTranscript: content.inputTranscription?.text || null,
    outputTranscript: content.outputTranscription?.text || null,
    turnComplete: Boolean(content.turnComplete),
    interrupted: Boolean(content.interrupted)
  };
}

export async function createKaraLiveSession({
  apiKey,
  model = DEFAULT_KARA_LIVE_MODEL,
  systemInstruction,
  executors,
  onServerMessage = () => {},
  onError = () => {},
  genaiClient
}) {
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY tanimli degil.');
  }
  if (typeof executors?.get_frame !== 'function') {
    throw new Error('get_frame calistiricisi tanimli degil.');
  }

  const client = genaiClient || new GoogleGenAI({ apiKey });
  let session;

  async function handleToolCall(toolCall) {
    const calls = Array.isArray(toolCall?.functionCalls) ? toolCall.functionCalls : [];
    const functionResponses = await Promise.all(calls.map(async (call) => {
      const executor = executors[call.name];
      if (typeof executor !== 'function') {
        return { id: call.id, name: call.name, response: { ok: false, error: `Bilinmeyen arac: ${call.name}` } };
      }
      try {
        const result = await executor(call.args || {});
        return {
          id: call.id,
          name: call.name,
          response: result?.response || { ok: true },
          ...(result?.parts ? { parts: result.parts } : {})
        };
      } catch (error) {
        return { id: call.id, name: call.name, response: { ok: false, error: error.message } };
      }
    }));
    session.sendToolResponse({ functionResponses });
    onServerMessage({ type: 'tools_executed', names: calls.map((call) => call.name) });
  }

  session = await client.live.connect({
    model,
    config: {
      responseModalities: [Modality.AUDIO],
      ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
      tools: buildKaraLiveTools(),
      inputAudioTranscription: {},
      outputAudioTranscription: {}
    },
    callbacks: {
      onopen: () => onServerMessage({ type: 'ready' }),
      onmessage: (message) => {
        if (message?.toolCall) {
          return handleToolCall(message.toolCall).catch((error) => onError(error));
        }
        onServerMessage(normalizeServerMessage(message));
      },
      onerror: (event) => onError(new Error(event?.message || 'Kara live baglanti hatasi.')),
      onclose: (event) => onServerMessage({ type: 'closed', reason: event?.reason || null })
    }
  });

  return {
    sendAudioChunk(base64Pcm) {
      session.sendRealtimeInput({ audio: { data: base64Pcm, mimeType: 'audio/pcm;rate=16000' } });
    },
    sendAudioStreamEnd() {
      session.sendRealtimeInput({ audioStreamEnd: true });
    },
    sendText(text) {
      session.sendRealtimeInput({ text: String(text || '') });
    },
    close() {
      session.close();
    }
  };
}
