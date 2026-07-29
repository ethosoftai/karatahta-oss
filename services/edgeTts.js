import { spawn } from 'node:child_process';

export function buildEdgeTtsArgs({ text, outputPath, voice = 'tr-TR-AhmetNeural', rate = '+0%' }) {
  return ['--voice', voice, '--rate', rate, '--text', text, '--write-media', outputPath];
}

export async function synthesizeWithEdgeTts({
  text,
  outputPath,
  voice = process.env.EDGE_TTS_VOICE || 'tr-TR-AhmetNeural',
  rate = process.env.EDGE_TTS_RATE || '+0%',
  command = process.env.EDGE_TTS_COMMAND || 'edge-tts'
}) {
  const cleanText = String(text || '').trim();
  if (!cleanText) throw new Error('TTS metni bos olamaz.');
  if (!outputPath) throw new Error('Edge TTS cikti yolu gerekli.');

  const args = buildEdgeTtsArgs({ text: cleanText, outputPath, voice, rate });
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => reject(new Error(`Edge TTS baslatilamadi: ${error.message}`)));
    child.once('close', (code) => code === 0
      ? resolve()
      : reject(new Error(`Edge TTS basarisiz (${code}): ${stderr.trim()}`)));
  });

  return { outputPath, voice };
}
