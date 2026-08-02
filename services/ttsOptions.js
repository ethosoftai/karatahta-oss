// Parses/validates the optional per-request TTS overrides a client can send
// (voice choice, speech volume, background music volume) so a user's
// Settings-panel choices can flow into the render pipeline instead of only
// ever using the fixed env-driven defaults.

export const EDGE_TTS_VOICE_OPTIONS = ['tr-TR-AhmetNeural', 'tr-TR-EmelNeural'];

function clamp(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : null;
}

export function parseTtsOptions(body = {}) {
  return {
    voice: EDGE_TTS_VOICE_OPTIONS.includes(body.tts_voice) ? body.tts_voice : null,
    speechVolume: clamp(body.speech_volume, 0.5, 2),
    musicVolume: clamp(body.background_music_volume, 0, 1)
  };
}
