import 'dotenv/config';

import WebSocket from 'ws';

const wsUrl = process.env.KARA_LIVE_TEST_WS_URL || 'ws://localhost:8080/api/kara-live';
const lessonId = process.env.KARA_LIVE_TEST_LESSON_ID || '';
const authToken = process.env.KARA_LIVE_TEST_TOKEN || '';
const message = process.env.KARA_LIVE_TEST_TEXT || 'Merhaba Kara, sesli olarak beni duyuyor musun? Kisa bir cumleyle cevap ver.';
const durationMs = Number(process.env.KARA_LIVE_TEST_DURATION_MS || 30000);

if (!lessonId) {
  throw new Error('KARA_LIVE_TEST_LESSON_ID gerekli (var olan, sahibi sen olan bir ders id\'si).');
}

console.log(`[test] Baglaniliyor: ${wsUrl}`);
const socket = new WebSocket(wsUrl);
let audioBytesReceived = 0;

socket.on('open', () => {
  console.log('[test] Baglanti acildi, auth gonderiliyor...');
  socket.send(JSON.stringify({ type: 'auth', token: authToken, lessonId }));
});

socket.on('message', (raw) => {
  let event;
  try {
    event = JSON.parse(raw.toString());
  } catch {
    console.log('[test] Cozumlenemeyen mesaj:', raw.toString().slice(0, 200));
    return;
  }

  switch (event.type) {
    case 'ready':
      console.log('[test] Oturum hazir; test metni gonderiliyor:', message);
      socket.send(JSON.stringify({ type: 'text', text: message }));
      break;
    case 'server_content':
      if (event.audioChunks?.length) {
        const bytes = event.audioChunks.reduce((sum, chunk) => sum + Buffer.byteLength(chunk, 'base64'), 0);
        audioBytesReceived += bytes;
        console.log(`[test] Ses parcasi alindi: ${bytes} byte (toplam ${audioBytesReceived})`);
      }
      if (event.outputTranscript) {
        console.log('[test] Model transkript:', event.outputTranscript);
      }
      if (event.inputTranscript) {
        console.log('[test] Kullanici transkript:', event.inputTranscript);
      }
      if (event.turnComplete) {
        console.log('[test] Tur tamamlandi.');
      }
      break;
    case 'tools_executed':
      console.log('[test] Arac(lar) calistirildi:', event.names);
      break;
    case 'error':
      console.error('[test] HATA:', event.message);
      break;
    case 'closed':
      console.log('[test] Sunucu oturumu kapatti:', event.reason);
      break;
    default:
      console.log('[test] Bilinmeyen olay:', event);
  }
});

socket.on('error', (error) => {
  console.error('[test] Soket hatasi:', error.message);
});

socket.on('close', () => {
  console.log(`[test] Baglanti kapandi. Toplam alinan ses: ${audioBytesReceived} byte.`);
  process.exit(0);
});

setTimeout(() => {
  console.log('[test] Sure doldu, kapatiliyor.');
  socket.close();
}, durationMs);
