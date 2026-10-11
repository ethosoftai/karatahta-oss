// Mic -> /api/kara-live WebSocket -> speaker relay for live voice chat with Kara.
// Input is downsampled to 16kHz PCM16 (what Gemini Live expects); output arrives
// as 24kHz PCM16 chunks and is scheduled back-to-back for gapless playback.

// `?url` (not `new URL(..., import.meta.url)`) matters here: Vite's dev server
// wraps normally-served modules with HMR runtime code that AudioWorkletGlobalScope
// can't execute ("Unable to load a worklet's module"). The `?url` suffix serves
// the file as a raw, untransformed asset URL instead, in both dev and build.
import karaLiveWorkletUrl from './karaLiveWorkletProcessor.js?url';

const OUTPUT_SAMPLE_RATE = 24000;
const TARGET_INPUT_SAMPLE_RATE = 16000;

function downsampleTo16k(float32Samples, inputSampleRate) {
  if (inputSampleRate === TARGET_INPUT_SAMPLE_RATE) {
    return float32Samples;
  }
  const ratio = inputSampleRate / TARGET_INPUT_SAMPLE_RATE;
  const outputLength = Math.floor(float32Samples.length / ratio);
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i += 1) {
    const sourceIndex = i * ratio;
    const lower = Math.floor(sourceIndex);
    const upper = Math.min(lower + 1, float32Samples.length - 1);
    const weight = sourceIndex - lower;
    output[i] = float32Samples[lower] * (1 - weight) + float32Samples[upper] * weight;
  }
  return output;
}

function floatTo16BitPcmBase64(float32Samples) {
  const int16 = new Int16Array(float32Samples.length);
  for (let i = 0; i < float32Samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, float32Samples[i]));
    int16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64PcmToFloat32(base64, playbackSampleRate) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i += 1) {
    float32[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7fff);
  }
  return float32;
}

export class KaraLiveClient {
  constructor({ wsUrl, token, lessonId, onEvent, onError }) {
    this.wsUrl = wsUrl;
    this.token = token;
    this.lessonId = lessonId;
    this.onEvent = onEvent || (() => {});
    this.onError = onError || (() => {});

    this.socket = null;
    this.captureContext = null;
    this.captureStream = null;
    this.captureNode = null;
    this.playbackContext = null;
    this.nextPlaybackTime = 0;
    this.active = false;
  }

  async start() {
    if (this.active) return;
    this.active = true;

    this.captureStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
    });

    this.socket = new WebSocket(this.wsUrl);
    this.socket.addEventListener('open', () => {
      this.socket.send(JSON.stringify({ type: 'auth', token: this.token, lessonId: this.lessonId }));
    });
    this.socket.addEventListener('message', (event) => this._handleServerMessage(event));
    this.socket.addEventListener('close', () => {
      if (this.active) this.onEvent({ type: 'closed' });
      this.stop();
    });
    this.socket.addEventListener('error', () => {
      this.onError(new Error('Kara live baglanti hatasi.'));
    });

    this.captureContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = this.captureContext.createMediaStreamSource(this.captureStream);
    await this.captureContext.audioWorklet.addModule(karaLiveWorkletUrl);
    this.captureNode = new AudioWorkletNode(this.captureContext, 'kara-live-capture');
    this.captureNode.port.onmessage = (workletEvent) => {
      if (!this.active || this.socket?.readyState !== WebSocket.OPEN) return;
      const downsampled = downsampleTo16k(workletEvent.data, this.captureContext.sampleRate);
      this.socket.send(JSON.stringify({ type: 'audio', data: floatTo16BitPcmBase64(downsampled) }));
    };
    source.connect(this.captureNode);
    // AudioWorkletNode must stay connected into the graph to keep processing;
    // route it through a silent gain so nothing is audibly looped back.
    this.captureSilencer = this.captureContext.createGain();
    this.captureSilencer.gain.value = 0;
    this.captureNode.connect(this.captureSilencer);
    this.captureSilencer.connect(this.captureContext.destination);

    this.playbackContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: OUTPUT_SAMPLE_RATE });
    this.nextPlaybackTime = 0;
  }

  _handleServerMessage(event) {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    if (message.type === 'server_content') {
      if (message.interrupted) {
        this._clearPlaybackQueue();
      }
      for (const chunk of message.audioChunks || []) {
        this._enqueuePlayback(chunk);
      }
    }

    this.onEvent(message);
  }

  _enqueuePlayback(base64Chunk) {
    const float32 = base64PcmToFloat32(base64Chunk, OUTPUT_SAMPLE_RATE);
    if (!float32.length) return;
    const buffer = this.playbackContext.createBuffer(1, float32.length, OUTPUT_SAMPLE_RATE);
    buffer.copyToChannel(float32, 0);
    const source = this.playbackContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.playbackContext.destination);
    const startAt = Math.max(this.playbackContext.currentTime, this.nextPlaybackTime);
    source.start(startAt);
    this.nextPlaybackTime = startAt + buffer.duration;
  }

  _clearPlaybackQueue() {
    this.nextPlaybackTime = this.playbackContext?.currentTime || 0;
  }

  sendText(text) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'text', text }));
    }
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    try { this.socket?.send(JSON.stringify({ type: 'close' })); } catch { /* noop */ }
    this.socket?.close();
    this.socket = null;
    this.captureNode?.disconnect();
    this.captureNode = null;
    this.captureSilencer?.disconnect();
    this.captureSilencer = null;
    this.captureStream?.getTracks().forEach((track) => track.stop());
    this.captureStream = null;
    this.captureContext?.close().catch(() => {});
    this.captureContext = null;
    this.playbackContext?.close().catch(() => {});
    this.playbackContext = null;
  }
}
