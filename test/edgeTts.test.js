import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEdgeTtsArgs, synthesizeWithEdgeTts } from '../services/edgeTts.js';

test('buildEdgeTtsArgs Türkçe ses ve çıktı yolunu güvenli argümanlar olarak üretir', () => {
  assert.deepEqual(
    buildEdgeTtsArgs({ text: 'Merhaba dünya', outputPath: '/tmp/ses.mp3', voice: 'tr-TR-AhmetNeural', rate: '+5%' }),
    ['--voice', 'tr-TR-AhmetNeural', '--rate', '+5%', '--text', 'Merhaba dünya', '--write-media', '/tmp/ses.mp3']
  );
});

test('synthesizeWithEdgeTts boş metni reddeder', async () => {
  await assert.rejects(
    synthesizeWithEdgeTts({ text: '  ', outputPath: '/tmp/ses.mp3' }),
    /TTS metni bos olamaz/
  );
});
