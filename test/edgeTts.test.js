import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

test('Edge TTS takilirsa timeout sonunda processi sonlandirir', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kara-edge-timeout-'));
  const commandPath = path.join(tempDir, 'hang.sh');
  await fs.writeFile(commandPath, '#!/bin/sh\ntrap "" TERM\nwhile :; do :; done\n', { mode: 0o755 });
  await assert.rejects(
    synthesizeWithEdgeTts({
      text: 'Merhaba',
      outputPath: path.join(tempDir, 'out.mp3'),
      command: commandPath,
      timeoutMs: 10,
      killGraceMs: 10
    }),
    /basarisiz/
  );
  await fs.rm(tempDir, { recursive: true, force: true });
});
