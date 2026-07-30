import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const sleep = (milliseconds) => new Promise((resolve) => {
  setTimeout(resolve, milliseconds);
});

export function createJobEventChannel({ historyLimit = 200 } = {}) {
  const emitter = new EventEmitter();
  const history = [];
  let sequence = 0;

  return {
    emit(type, payload) {
      const event = {
        id: ++sequence,
        type,
        payload,
        createdAt: new Date().toISOString()
      };
      history.push(event);
      if (history.length > historyLimit) history.shift();
      emitter.emit('event', event);
      return event;
    },
    subscribe(listener, afterId = 0) {
      for (const event of history) {
        if (event.id > Number(afterId || 0)) listener(event);
      }
      emitter.on('event', listener);
      return () => emitter.off('event', listener);
    },
    snapshot() {
      return history.slice();
    },
    latestId() {
      return sequence;
    }
  };
}

export function createProgressiveState({ enabled, bufferTargetSeconds = 6 } = {}) {
  return {
    enabled: Boolean(enabled),
    status: enabled ? 'waiting' : 'disabled',
    bufferTargetSeconds,
    readyDurationSeconds: 0,
    readyCount: 0,
    playbackReadyAt: null,
    partials: [],
    error: null
  };
}

export function appendPartialMetadata(state, partial) {
  if (!state.enabled) return false;
  if (state.partials.some((item) => item.sequence === partial.sequence || item.id === partial.id)) {
    return false;
  }

  const expectedSequence = state.partials.length;
  if (partial.sequence !== expectedSequence) {
    throw new Error(`Progressive partial sirasi bozuk: ${partial.sequence}, beklenen ${expectedSequence}.`);
  }

  state.partials.push(Object.freeze({ ...partial }));
  state.readyCount = state.partials.length;
  state.readyDurationSeconds = state.partials.reduce(
    (sum, item) => sum + Number(item.durationSeconds || 0),
    0
  );
  state.status = state.readyDurationSeconds >= state.bufferTargetSeconds ? 'ready' : 'buffering';
  if (state.status === 'ready' && !state.playbackReadyAt) {
    state.playbackReadyAt = new Date().toISOString();
  }
  return true;
}

export function publicProgressiveState(state) {
  if (!state) return null;
  return {
    enabled: state.enabled,
    status: state.status,
    bufferTargetSeconds: state.bufferTargetSeconds,
    readyDurationSeconds: state.readyDurationSeconds,
    readyCount: state.readyCount,
    playbackReadyAt: state.playbackReadyAt,
    error: state.error
  };
}

async function walkPartialMovieFiles(rootDir) {
  let entries;
  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkPartialMovieFiles(fullPath));
    } else if (
      entry.isFile()
      && entry.name.toLowerCase().endsWith('.mp4')
      && fullPath.split(path.sep).includes('partial_movie_files')
    ) {
      const stat = await fs.stat(fullPath);
      files.push({
        path: fullPath,
        birthtimeMs: stat.birthtimeMs,
        mtimeMs: stat.mtimeMs
      });
    }
  }
  return files.sort((left, right) => (
    left.birthtimeMs - right.birthtimeMs
    || left.mtimeMs - right.mtimeMs
    || left.path.localeCompare(right.path)
  ));
}

export async function waitForClosedMp4(filePath, {
  validate,
  checks = 2,
  intervalMs = 120,
  maxAttempts = 30
} = {}) {
  let stableChecks = 0;
  let previousSize = -1;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch {
      await sleep(intervalMs);
      continue;
    }
    if (stat.size > 0 && stat.size === previousSize) {
      stableChecks += 1;
    } else {
      stableChecks = 0;
      previousSize = stat.size;
    }

    if (stableChecks >= checks) {
      const valid = validate ? await validate(filePath).catch(() => false) : true;
      if (valid) return stat;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Manim partial tamamlanmadi veya gecersiz: ${path.basename(filePath)}`);
}

export class ManimPartialCollector {
  constructor({
    mediaDir,
    validate,
    normalize,
    onPartial,
    pollIntervalMs = 150
  }) {
    this.mediaDir = mediaDir;
    this.validate = validate;
    this.normalize = normalize;
    this.onPartial = onPartial;
    this.pollIntervalMs = pollIntervalMs;
    this.seen = new Set();
    this.queuedCount = 0;
    this.running = false;
    this.processing = Promise.resolve();
    this.timer = null;
    this.error = null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => {
      void this.scan();
    }, this.pollIntervalMs);
    void this.scan();
  }

  async scan() {
    if (!this.running || this.error) return;
    const files = await walkPartialMovieFiles(this.mediaDir);
    for (const file of files) {
      if (this.seen.has(file.path)) continue;
      this.seen.add(file.path);
      const sequence = this.queuedCount++;
      this.processing = this.processing.then(async () => {
        await waitForClosedMp4(file.path, { validate: this.validate });
        const partial = await this.normalize(file.path, sequence);
        await this.onPartial(partial);
      }).catch((error) => {
        this.error = error;
      });
    }
  }

  async finish() {
    if (!this.running) return;
    await this.scan();
    clearInterval(this.timer);
    this.timer = null;
    this.running = false;
    await this.processing;
    if (this.error) throw this.error;
  }

  async abort() {
    clearInterval(this.timer);
    this.timer = null;
    this.running = false;
    await this.processing.catch(() => {});
  }
}
