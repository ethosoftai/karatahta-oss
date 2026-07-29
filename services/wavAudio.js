function clamp(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

export function buildSilentWav({
  durationSeconds = 8,
  sampleRate = 48000,
  channels = 1
} = {}) {
  const safeDuration = clamp(durationSeconds, 0.1, 30, 8);
  const safeSampleRate = Math.round(clamp(sampleRate, 8000, 96000, 48000));
  const safeChannels = Math.round(clamp(channels, 1, 2, 1));
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const sampleCount = Math.round(safeDuration * safeSampleRate);
  const dataSize = sampleCount * safeChannels * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0, 4, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 4, 'ascii');
  buffer.write('fmt ', 12, 4, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(safeChannels, 22);
  buffer.writeUInt32LE(safeSampleRate, 24);
  buffer.writeUInt32LE(safeSampleRate * safeChannels * bytesPerSample, 28);
  buffer.writeUInt16LE(safeChannels * bytesPerSample, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36, 4, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);

  return buffer;
}
