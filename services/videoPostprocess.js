function srtTimestamp(seconds) {
  const totalMs = Math.round(Math.max(0, seconds) * 1000);
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

export function calculateVideoStretchFactor(videoDuration, audioDuration) {
  if (!(videoDuration > 0) || !(audioDuration > 0)) throw new Error('Video ve ses süreleri pozitif olmalı.');
  return audioDuration / videoDuration;
}

export function buildTimedSubtitleSrt(text, durationSeconds, maxWords = 9) {
  if (!(durationSeconds > 0)) throw new Error('Altyazı süresi pozitif olmalı.');
  const sentences = String(text || '').trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  const chunks = [];
  for (const sentence of sentences) {
    let words = sentence.split(/\s+/).filter(Boolean);
    while (words.length > maxWords) {
      let cut = Math.min(maxWords, words.length);
      for (let i = cut; i >= Math.max(4, cut - 4); i -= 1) {
        if (/[,;:]$/.test(words[i - 1])) { cut = i; break; }
      }
      chunks.push(words.slice(0, cut).join(' '));
      words = words.slice(cut);
    }
    if (words.length) chunks.push(words.join(' '));
  }
  if (!chunks.length) return '';
  const weights = chunks.map((chunk) => Math.max(1, chunk.split(/\s+/).length));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  let elapsedWeight = 0;
  return chunks.map((chunk, index) => {
    const start = durationSeconds * elapsedWeight / totalWeight;
    elapsedWeight += weights[index];
    const end = durationSeconds * elapsedWeight / totalWeight;
    return `${index + 1}\n${srtTimestamp(start)} --> ${srtTimestamp(end)}\n${chunk}\n`;
  }).join('\n');
}

function escapeSubtitlePath(filePath) {
  return filePath.replaceAll('\\', '/').replaceAll(':', '\\:').replaceAll("'", "\\'");
}

export function buildMuxArgs({
  videoPath,
  audioPath,
  outputPath,
  videoDuration,
  audioDuration,
  preset = 'medium',
  crf = 20
}) {
  const factor = calculateVideoStretchFactor(videoDuration, audioDuration);
  return ['-y', '-i', videoPath, '-i', audioPath, '-filter_complex', `[0:v]setpts=${factor}*PTS[v]`, '-map', '[v]', '-map', '1:a:0', '-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', outputPath];
}

export function buildBurnSubtitleArgs({
  inputPath,
  subtitlePath,
  outputPath,
  preset = 'medium',
  crf = 20
}) {
  const style = 'FontName=Noto Sans,FontSize=19,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=1,Alignment=2,MarginV=28';
  return ['-y', '-i', inputPath, '-vf', `subtitles='${escapeSubtitlePath(subtitlePath)}':force_style='${style}'`, '-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-c:a', 'copy', '-movflags', '+faststart', outputPath];
}

export function buildConcatArgs({ listPath, outputPath }) {
  return [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', listPath,
    '-c', 'copy',
    '-movflags', '+faststart',
    outputPath
  ];
}

export function buildCanonicalRemuxArgs({ inputPath, outputPath }) {
  return [
    '-y',
    '-i', inputPath,
    '-map', '0:v:0',
    '-map', '0:a:0?',
    '-c', 'copy',
    '-movflags', '+faststart',
    outputPath
  ];
}
