// Runs in the AudioWorkletGlobalScope (no access to window/app modules).
// Batches 128-sample render quanta into ~4096-sample chunks before posting
// them to the main thread, so we're not doing hundreds of postMessage calls
// per second.
class KaraLiveCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 4096;
    this.buffer = new Float32Array(this.bufferSize);
    this.offset = 0;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (input && input.length) {
      for (let i = 0; i < input.length; i += 1) {
        this.buffer[this.offset] = input[i];
        this.offset += 1;
        if (this.offset >= this.bufferSize) {
          this.port.postMessage(this.buffer.slice(0, this.offset));
          this.offset = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('kara-live-capture', KaraLiveCaptureProcessor);
