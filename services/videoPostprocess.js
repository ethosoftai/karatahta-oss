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

function ffmpegNumber(value) {
  return Math.max(0, Number(value) || 0).toFixed(3);
}

export function buildProgressiveAudioArgs({ inputPath, outputPath, volume = 1, durationSeconds }) {
  return [
    '-y', '-i', inputPath,
    '-af', `volume=${Number(volume) || 1},apad=pad_dur=30`,
    '-t', ffmpegNumber(durationSeconds),
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000',
    outputPath
  ];
}

export function buildProgressivePartialArgs({
  sourcePath,
  audioPath,
  outputPath,
  audioStartSeconds,
  durationSeconds
}) {
  const duration = ffmpegNumber(durationSeconds);
  return [
    '-y', '-i', sourcePath,
    '-ss', ffmpegNumber(audioStartSeconds), '-i', audioPath,
    '-filter_complex', `[0:v]trim=duration=${duration},setpts=PTS-STARTPTS[v]`,
    '-map', '[v]', '-map', '1:a:0', '-t', duration,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-bf', '0', '-g', '30', '-keyint_min', '30', '-sc_threshold', '0',
    '-fps_mode', 'cfr', '-r', '30',
    '-c:a', 'copy',
    '-movflags', '+empty_moov+default_base_moof+frag_keyframe+omit_tfhd_offset',
    '-frag_duration', '1000000', '-video_track_timescale', '90000',
    outputPath
  ];
}

export function buildMuxArgs({ videoPath, audioPath, outputPath, videoDuration, audioDuration }) {
  const factor = calculateVideoStretchFactor(videoDuration, audioDuration);
  return ['-y', '-i', videoPath, '-i', audioPath, '-filter_complex', `[0:v]setpts=${factor}*PTS[v]`, '-map', '[v]', '-map', '1:a:0', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', outputPath];
}

export function buildBurnSubtitleArgs({ inputPath, subtitlePath, outputPath }) {
  const style = 'FontName=Noto Sans,FontSize=19,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=1,Alignment=2,MarginV=28';
  return ['-y', '-i', inputPath, '-vf', `subtitles='${escapeSubtitlePath(subtitlePath)}':force_style='${style}'`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-c:a', 'copy', '-movflags', '+faststart', outputPath];
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
