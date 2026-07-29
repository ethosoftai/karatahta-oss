import { EventEmitter } from 'node:events';
import { createWriteStream, existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultWorkerScript = path.resolve(__dirname, '../workers/live_manim_worker.py');
const localPython = path.resolve(__dirname, '../../.venv/bin/python');

export function resolveLiveManimPython() {
  if (process.env.LIVE_MANIM_PYTHON) return process.env.LIVE_MANIM_PYTHON;
  return existsSync(localPython) ? localPython : 'python';
}

function parseJsonLines(onMessage) {
  let buffer = '';
  return (chunk, flush = false) => {
    buffer += String(chunk || '');
    const lines = buffer.split(/\r?\n/);
    buffer = flush ? '' : (lines.pop() || '');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        onMessage(JSON.parse(line));
      } catch {
        onMessage({ event: 'worker_log', message: line });
      }
    }
  };
}

export function buildLiveManimStartMessage(settings = {}) {
  return {
    type: 'start',
    width: settings.width || 1280,
    height: settings.height || 720,
    fps: settings.fps || 60,
    crf: settings.crf || 20,
    preset: settings.preset || 'veryfast',
    fragment_seconds: settings.fragmentSeconds || 1,
    background: settings.background || '#071512'
  };
}

class LiveManimSession extends EventEmitter {
  constructor({ worker, jobId, outputPath }) {
    super();
    this.worker = worker;
    this.jobId = jobId;
    this.outputPath = outputPath;
    this.streamToken = null;
    this.chunks = [];
    this.cachedBytes = 0;
    this.hasClientConnected = false;
    this.clients = new Set();
    this.bytes = 0;
    this.done = false;
    this.failed = false;
    this.error = null;
    this.videoEnded = false;
    this.finishedPayload = null;
    this.fileStream = createWriteStream(outputPath);
    this.completion = new Promise((resolve, reject) => {
      this.resolveCompletion = resolve;
      this.rejectCompletion = reject;
    });
    this.completion.catch(() => {});
  }

  send(message) {
    if (this.done || this.failed || !this.worker.process.stdin.writable) {
      throw this.error || new Error('Live Manim worker artik komut kabul etmiyor.');
    }
    this.worker.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  start(settings = {}) {
    this.send(buildLiveManimStartMessage(settings));
  }

  beginSegment({ segmentId, audioPath, durationSeconds }) {
    this.send({
      type: 'segment',
      segment_id: segmentId,
      audio_path: audioPath,
      duration_seconds: durationSeconds
    });
  }

  action(command) {
    this.send({ type: 'action', command });
  }

  finish() {
    this.send({ type: 'finish' });
  }

  handleVideoChunk(chunk) {
    const payload = Buffer.from(chunk);
    if (!this.hasClientConnected && this.cachedBytes < 32 * 1024 * 1024) {
      this.chunks.push(payload);
      this.cachedBytes += payload.length;
    }
    this.bytes += payload.length;
    this.fileStream.write(payload);
    for (const client of this.clients) {
      if (!client.writableEnded) client.write(payload);
    }
    this.emit('video', payload);
  }

  handleEvent(message) {
    this.emit('event', message);
    if (message.event === 'finished') {
      this.finishedPayload = message;
      this.maybeComplete();
    } else if (message.event === 'error') {
      const error = new Error(message.message || 'Live Manim worker hata verdi.');
      error.details = message.traceback;
      this.fail(error);
    }
  }

  markVideoEnded() {
    this.videoEnded = true;
    this.maybeComplete();
  }

  maybeComplete() {
    if (this.videoEnded && this.finishedPayload) {
      void this.complete(this.finishedPayload);
    }
  }

  async complete(payload = {}) {
    if (this.done || this.failed) return;
    this.done = true;
    await new Promise((resolve) => this.fileStream.end(resolve));
    for (const client of this.clients) {
      if (!client.writableEnded) client.end();
    }
    this.clients.clear();
    this.resolveCompletion({
      ...payload,
      outputPath: this.outputPath,
      bytes: this.bytes
    });
  }

  fail(error) {
    if (this.done || this.failed) return;
    this.failed = true;
    this.error = error;
    this.fileStream.destroy();
    for (const client of this.clients) {
      if (!client.writableEnded) client.destroy(error);
    }
    this.clients.clear();
    this.rejectCompletion(error);
  }

  pipeTo(response) {
    for (const chunk of this.chunks) response.write(chunk);
    this.hasClientConnected = true;
    this.chunks = [];
    this.cachedBytes = 0;
    if (this.done) {
      response.end();
      return () => {};
    }
    if (this.failed) {
      response.destroy(this.error);
      return () => {};
    }
    this.clients.add(response);
    const cleanup = () => this.clients.delete(response);
    response.once('close', cleanup);
    return cleanup;
  }

  releaseCachedChunks() {
    this.chunks = [];
    this.cachedBytes = 0;
  }
}

class WarmLiveManimWorker {
  constructor(pool, index) {
    this.pool = pool;
    this.index = index;
    this.busy = false;
    this.session = null;
    this.ready = false;
    this.stderr = '';
    this.spawn();
  }

  spawn() {
    this.process = spawn(
      this.pool.pythonCommand,
      [this.pool.workerScript],
      { stdio: ['pipe', 'pipe', 'pipe', 'pipe'] }
    );
    const consumeLines = parseJsonLines((message) => {
      if (message.event === 'ready') {
        this.ready = true;
        this.pool.dispatch();
      } else if (this.session) {
        this.session.handleEvent(message);
      }
    });
    this.process.stdout.on('data', (chunk) => consumeLines(chunk));
    this.process.stdout.on('end', () => consumeLines('', true));
    this.process.stdin.on('error', (error) => {
      if (error.code !== 'EPIPE') {
        this.session?.fail(new Error(`Live Manim stdin hatasi: ${error.message}`));
      }
    });
    this.process.stderr.on('data', (chunk) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-12000);
      this.session?.emit('log', String(chunk));
    });
    this.process.stdio[3].on('data', (chunk) => this.session?.handleVideoChunk(chunk));
    this.process.stdio[3].on('end', () => this.session?.markVideoEnded());
    this.process.once('error', (error) => {
      this.session?.fail(new Error(`Live Manim worker baslatilamadi: ${error.message}`));
    });
    this.process.once('exit', (code, signal) => {
      const session = this.session;
      if (session && !session.done && !session.failed) {
        session.fail(new Error(
          `Live Manim worker beklenmeden kapandi (${code ?? signal ?? 'unknown'}): ${this.stderr.slice(-1600)}`
        ));
      }
      this.ready = false;
      this.busy = false;
      this.session = null;
      this.pool.replace(this);
    });
  }

  assign(request) {
    this.busy = true;
    this.session = new LiveManimSession({
      worker: this,
      jobId: request.jobId,
      outputPath: request.outputPath
    });
    request.resolve(this.session);
  }

  shutdown() {
    if (this.process.exitCode === null && !this.process.stdin.destroyed) {
      this.process.stdin.end('{"type":"shutdown"}\n');
    }
  }
}

export class LiveManimPool {
  constructor({
    size = Number(process.env.LIVE_MANIM_WORKERS || 1),
    pythonCommand = resolveLiveManimPython(),
    workerScript = process.env.LIVE_MANIM_WORKER_SCRIPT || defaultWorkerScript
  } = {}) {
    this.size = Math.max(1, Math.min(4, Number(size) || 1));
    this.pythonCommand = pythonCommand;
    this.workerScript = workerScript;
    this.workers = [];
    this.queue = [];
    this.closing = false;
  }

  prewarm() {
    while (this.workers.length < this.size) {
      this.workers.push(new WarmLiveManimWorker(this, this.workers.length));
    }
  }

  async acquire({ jobId, outputPath }) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    this.prewarm();
    return new Promise((resolve, reject) => {
      this.queue.push({ jobId, outputPath, resolve, reject });
      this.dispatch();
    });
  }

  dispatch() {
    if (!this.queue.length) return;
    const worker = this.workers.find((candidate) => candidate.ready && !candidate.busy);
    if (!worker) return;
    const request = this.queue.shift();
    worker.assign(request);
    this.dispatch();
  }

  replace(worker) {
    const index = this.workers.indexOf(worker);
    if (index === -1) return;
    if (this.closing) {
      this.workers.splice(index, 1);
      return;
    }
    const replacement = new WarmLiveManimWorker(this, worker.index);
    this.workers.splice(index, 1, replacement);
  }

  shutdown() {
    this.closing = true;
    for (const worker of this.workers) worker.shutdown();
  }
}
