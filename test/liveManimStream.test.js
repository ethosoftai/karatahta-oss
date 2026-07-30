import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  buildLiveManimStartMessage,
  createSerializedJsonLineWriter
} from '../services/liveManimStream.js';

test('ağ fragmentini kullanıcı segmentinden bağımsız olarak bir saniye tutar', () => {
  const message = buildLiveManimStartMessage();

  assert.equal(message.type, 'start');
  assert.equal(message.fragment_seconds, 1);
  assert.equal(message.fps, 60);
  assert.equal(message.crf, 20);
  assert.equal(message.preset, 'veryfast');
});

test('canlı Manim fragment süresini worker mesajına aktarır', () => {
  const message = buildLiveManimStartMessage({
    fragmentSeconds: 3,
    fps: 24
  });

  assert.equal(message.fragment_seconds, 3);
  assert.equal(message.fps, 24);
});

test('Manim komutlarini backpressure altinda bile tam JSON satirlari halinde siralar', () => {
  class BackpressuredStream extends EventEmitter {
    constructor() {
      super();
      this.writable = true;
      this.payloads = [];
      this.calls = 0;
    }

    write(payload) {
      this.payloads.push(Buffer.from(payload));
      this.calls += 1;
      return this.calls !== 1;
    }
  }

  const stream = new BackpressuredStream();
  const writer = createSerializedJsonLineWriter(stream);
  writer.write({ type: 'action', command: { id: 'a', type: 'diagram' } });
  writer.write({ type: 'action', command: { id: 'b', type: 'plot' } });
  writer.write({ type: 'finish' });

  assert.equal(stream.payloads.length, 1);
  assert.equal(writer.queued, 2);
  stream.emit('drain');

  const lines = Buffer.concat(stream.payloads).toString('utf8').trim().split('\n');
  assert.equal(lines.length, 3);
  assert.deepEqual(lines.map((line) => JSON.parse(line).type), ['action', 'action', 'finish']);
  assert.equal(writer.queued, 0);
});
