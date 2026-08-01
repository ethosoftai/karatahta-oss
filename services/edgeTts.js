import { spawn } from 'node:child_process';

export function buildEdgeTtsArgs({ text, outputPath, voice = 'tr-TR-AhmetNeural', rate = '+0%' }) {
  return ['--voice', voice, '--rate', rate, '--text', text, '--write-media', outputPath];
}

export async function synthesizeWithEdgeTts({
  text,
  outputPath,
  voice = process.env.EDGE_TTS_VOICE || 'tr-TR-AhmetNeural',
  rate = process.env.EDGE_TTS_RATE || '+0%',
  command = process.env.EDGE_TTS_COMMAND || 'edge-tts',
  timeoutMs = Number(process.env.EDGE_TTS_TIMEOUT_MS || 120000),
  killGraceMs = 5000
}) {
  const cleanText = String(text || '').trim();
  if (!cleanText) throw new Error('TTS metni bos olamaz.');
  if (!outputPath) throw new Error('Edge TTS cikti yolu gerekli.');

  const args = buildEdgeTtsArgs({ text: cleanText, outputPath, voice, rate });
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let settled = false;
    let forceKillTimer = null;
    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(forceKillTimer);
      if (error) reject(error);
      else resolve();
    };
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      forceKillTimer = setTimeout(
        () => child.kill('SIGKILL'),
        Number.isFinite(killGraceMs) && killGraceMs >= 0 ? killGraceMs : 5000
      );
    }, Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 120000);
    child.stdout.resume();
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => finish(new Error(`Edge TTS baslatilamadi: ${error.message}`)));
    child.once('close', (code) => code === 0
      ? finish()
      : finish(new Error(`Edge TTS basarisiz (${code}): ${stderr.trim()}`)));
  });

  return { outputPath, voice };
}
