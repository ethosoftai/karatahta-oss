function readBoxSize(bytes, offset) {
  if (offset + 8 > bytes.byteLength) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset);
  const size32 = view.getUint32(0);
  if (size32 === 0) return bytes.byteLength - offset;
  if (size32 !== 1) return size32;
  if (offset + 16 > bytes.byteLength) return null;
  const high = view.getUint32(8);
  const low = view.getUint32(12);
  const size = (high * 2 ** 32) + low;
  return Number.isSafeInteger(size) ? size : null;
}

function boxType(bytes, offset) {
  return String.fromCharCode(
    bytes[offset + 4],
    bytes[offset + 5],
    bytes[offset + 6],
    bytes[offset + 7]
  );
}

function concatBytes(parts) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

export function splitFragmentedMp4(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const init = [];
  const media = [];
  let foundMedia = false;
  let offset = 0;
  while (offset + 8 <= bytes.byteLength) {
    const size = readBoxSize(bytes, offset);
    if (!size || size < 8 || offset + size > bytes.byteLength) {
      throw new Error('Eksik veya gecersiz fMP4 kutusu alindi.');
    }
    const box = bytes.slice(offset, offset + size);
    if (boxType(bytes, offset) === 'moof') foundMedia = true;
    (foundMedia ? media : init).push(box);
    offset += size;
  }
  if (offset !== bytes.byteLength || !init.length || !media.length) {
    throw new Error('fMP4 init veya media fragmenti bulunamadi.');
  }
  return {
    init: concatBytes(init),
    media: concatBytes(media)
  };
}

export function orderedNewPartials(partials, appendedSequences, nextSequence) {
  const unique = new Map();
  for (const partial of Array.isArray(partials) ? partials : []) {
    if (!Number.isInteger(partial?.sequence) || appendedSequences.has(partial.sequence)) continue;
    unique.set(partial.sequence, partial);
  }
  const ordered = [...unique.values()].sort((left, right) => left.sequence - right.sequence);
  const contiguous = [];
  let expected = nextSequence;
  for (const partial of ordered) {
    if (partial.sequence < expected) continue;
    if (partial.sequence > expected) break;
    contiguous.push(partial);
    expected += 1;
  }
  return contiguous;
}

export function manifestBelongsTo(manifest, jobId, lessonId) {
  return (
    String(manifest?.jobId || '') === String(jobId || '')
    && String(manifest?.lessonId || '') === String(lessonId || '')
  );
}

export function hasPlaybackBuffer(bufferedSeconds, targetSeconds) {
  const availableSeconds = Number(bufferedSeconds || 0);
  return availableSeconds > 0 && availableSeconds >= Math.max(0, Number(targetSeconds || 0));
}

export function partialTimeline(partial) {
  const startSeconds = Math.max(0, Number(partial?.startSeconds || 0));
  const durationSeconds = Math.max(0, Number(partial?.durationSeconds || 0));
  return {
    startSeconds,
    endSeconds: startSeconds + durationSeconds
  };
}

export function applyAppendWindow(sourceBuffer, appendWindow) {
  // The new start can equal the previous end. Grow the end first because
  // browsers reject appendWindowStart >= the currently configured end.
  sourceBuffer.appendWindowEnd = appendWindow.endSeconds;
  sourceBuffer.appendWindowStart = appendWindow.startSeconds;
}

export function contiguousBufferedAhead(buffered, currentTime = 0, toleranceSeconds = 0.12) {
  if (!buffered?.length) return 0;
  const cursor = Math.max(0, Number(currentTime || 0));
  const tolerance = Math.max(0, Number(toleranceSeconds || 0));
  let contiguousEnd = null;

  for (let index = 0; index < buffered.length; index += 1) {
    const start = Number(buffered.start(index));
    const end = Number(buffered.end(index));
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (contiguousEnd === null) {
      if (cursor < start - tolerance || cursor > end + tolerance) continue;
      contiguousEnd = end;
      continue;
    }
    if (start > contiguousEnd + tolerance) break;
    contiguousEnd = Math.max(contiguousEnd, end);
  }

  return contiguousEnd === null ? 0 : Math.max(0, contiguousEnd - cursor);
}

export class ProgressiveManimPlayer {
  constructor(video, {
    getHeaders = () => ({}),
    fetcher = fetch,
    onConnected,
    onPlaybackReady,
    onPartial,
    onBuffering,
    onEnded,
    onError
  } = {}) {
    this.video = video;
    this.getHeaders = getHeaders;
    this.fetcher = fetcher;
    this.onConnected = onConnected;
    this.onPlaybackReady = onPlaybackReady;
    this.onPartial = onPartial;
    this.onBuffering = onBuffering;
    this.onEnded = onEnded;
    this.onError = onError;
    this.generation = 0;
    this.resetState();
  }

  resetState() {
    this.jobId = null;
    this.lessonId = null;
    this.mediaSource = null;
    this.sourceBuffer = null;
    this.objectUrl = null;
    this.abortController = null;
    this.appendedSequences = new Set();
    this.queuedSequences = new Set();
    this.nextSequence = 0;
    this.initAppended = false;
    this.playbackStarted = false;
    this.bufferTargetSeconds = 0;
    this.pending = Promise.resolve();
    this.complete = false;
  }

  start({ jobId, lessonId, bufferTargetSeconds = 0 }) {
    this.stop();
    this.generation += 1;
    this.jobId = String(jobId);
    this.lessonId = String(lessonId);
    this.bufferTargetSeconds = Math.max(0, Number(bufferTargetSeconds || 0));
    this.abortController = new AbortController();
    this.onConnected?.();
  }

  async sync(manifest) {
    const generation = this.generation;
    if (!manifestBelongsTo(manifest, this.jobId, this.lessonId)) return;
    const partials = orderedNewPartials(
      manifest.partials,
      this.appendedSequences,
      this.nextSequence
    );
    this.complete = Boolean(manifest.complete);
    for (const partial of partials) {
      if (this.queuedSequences.has(partial.sequence)) continue;
      this.queuedSequences.add(partial.sequence);
      this.pending = this.pending.then(() => this.appendPartial(partial, generation));
    }
    try {
      await this.pending;
      this.maybeFinish(generation);
    } catch (error) {
      if (generation === this.generation && error?.name !== 'AbortError') {
        this.onError?.(error);
      }
    }
  }

  async ensureMediaSource(mimeType, generation) {
    if (this.mediaSource) return;
    if (!('MediaSource' in window)) {
      throw new Error('Tarayici MediaSource progressive video destegi sunmuyor.');
    }
    if (!window.MediaSource.isTypeSupported(mimeType)) {
      throw new Error(`Tarayici codec destegi sunmuyor: ${mimeType}`);
    }
    this.mediaSource = new window.MediaSource();
    this.objectUrl = URL.createObjectURL(this.mediaSource);
    this.video.src = this.objectUrl;
    this.video.load();
    await new Promise((resolve, reject) => {
      const opened = () => resolve();
      const failed = () => reject(new Error('MediaSource acilamadi.'));
      this.mediaSource.addEventListener('sourceopen', opened, { once: true });
      this.mediaSource.addEventListener('error', failed, { once: true });
    });
    if (generation !== this.generation) return;
    this.sourceBuffer = this.mediaSource.addSourceBuffer(mimeType);
    // Backend normalizes every fragment to zero-based, B-frame-free timestamps.
    // Explicit segment offsets and append windows prevent AAC tail samples from
    // extending a chunk and creating a tiny freeze at every boundary.
    this.sourceBuffer.mode = 'segments';
  }

  async appendBuffer(data, timestampOffset, generation, retry = true, appendWindow = null) {
    if (generation !== this.generation) return;
    await new Promise((resolve, reject) => {
      const done = () => {
        cleanup();
        resolve();
      };
      const failed = () => {
        cleanup();
        reject(new Error('Progressive video parcasi SourceBuffer alanina eklenemedi.'));
      };
      const cleanup = () => {
        this.sourceBuffer.removeEventListener('updateend', done);
        this.sourceBuffer.removeEventListener('error', failed);
      };
      this.sourceBuffer.addEventListener('updateend', done, { once: true });
      this.sourceBuffer.addEventListener('error', failed, { once: true });
      try {
        if (appendWindow) {
          applyAppendWindow(this.sourceBuffer, appendWindow);
        }
        if (Number.isFinite(timestampOffset)) this.sourceBuffer.timestampOffset = timestampOffset;
        this.sourceBuffer.appendBuffer(data);
      } catch (error) {
        cleanup();
        reject(error);
      }
    }).catch(async (error) => {
      if (
        retry
        && error?.name === 'QuotaExceededError'
        && this.sourceBuffer?.buffered?.length
      ) {
        const removeUntil = Math.max(0, Number(this.video.currentTime || 0) - 30);
        if (removeUntil > this.sourceBuffer.buffered.start(0)) {
          await new Promise((resolve) => {
            this.sourceBuffer.addEventListener('updateend', resolve, { once: true });
            this.sourceBuffer.remove(0, removeUntil);
          });
          return this.appendBuffer(data, timestampOffset, generation, false, appendWindow);
        }
      }
      throw error;
    });
  }

  async appendPartial(partial, generation) {
    if (generation !== this.generation || this.appendedSequences.has(partial.sequence)) return;
    if (partial.sequence !== this.nextSequence) return;
    const response = await this.fetcher(partial.url, {
      cache: 'no-store',
      headers: this.getHeaders(),
      signal: this.abortController.signal
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `Video parcasi alinamadi (${response.status}).`);
    }
    const { init, media } = splitFragmentedMp4(await response.arrayBuffer());
    await this.ensureMediaSource(partial.mimeType, generation);
    if (generation !== this.generation) return;
    if (!this.initAppended) {
      await this.appendBuffer(init, Number.NaN, generation);
      this.initAppended = true;
    }
    const timeline = partialTimeline(partial);
    await this.appendBuffer(media, timeline.startSeconds, generation, true, timeline);
    this.appendedSequences.add(partial.sequence);
    this.queuedSequences.delete(partial.sequence);
    this.nextSequence += 1;
    this.onPartial?.(partial, this.bufferedAhead());
    if (!this.playbackStarted && hasPlaybackBuffer(this.bufferedAhead(), this.bufferTargetSeconds)) {
      this.playbackStarted = true;
      this.onPlaybackReady?.();
      this.video.play().catch(() => {});
    }
  }

  totalBuffered() {
    if (!this.video.buffered?.length) return 0;
    return this.video.buffered.end(this.video.buffered.length - 1);
  }

  bufferedAhead() {
    return contiguousBufferedAhead(this.video.buffered, Number(this.video.currentTime || 0));
  }

  markBuffering() {
    if (this.playbackStarted) this.onBuffering?.(this.bufferedAhead());
  }

  maybeFinish(generation) {
    if (
      generation !== this.generation
      || !this.complete
      || !this.mediaSource
      || this.mediaSource.readyState !== 'open'
      || this.sourceBuffer?.updating
    ) return;
    try {
      this.mediaSource.endOfStream();
      this.onEnded?.();
    } catch {
      // Navigation can detach the MediaSource while a final event is in flight.
    }
  }

  stop() {
    this.generation += 1;
    this.abortController?.abort();
    if (this.sourceBuffer?.updating) {
      try {
        this.sourceBuffer.abort();
      } catch {
        // SourceBuffer may already be detached.
      }
    }
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.resetState();
  }
}
