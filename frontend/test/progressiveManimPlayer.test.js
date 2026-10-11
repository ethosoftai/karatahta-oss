import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAppendWindow,
  contiguousBufferedAhead,
  hasPlaybackBuffer,
  manifestBelongsTo,
  orderedNewPartials,
  partialTimeline,
  splitFragmentedMp4
} from '../src/legacy/progressiveManimPlayer.js';

function mp4Box(type, payload = []) {
  const bytes = new Uint8Array(8 + payload.length);
  new DataView(bytes.buffer).setUint32(0, bytes.byteLength);
  for (let index = 0; index < 4; index += 1) {
    bytes[4 + index] = type.charCodeAt(index);
  }
  bytes.set(payload, 8);
  return bytes;
}

test('manifest partiallarini siralar, tekrarları atlar ve boslugu gecmez', () => {
  const result = orderedNewPartials([
    { sequence: 2 },
    { sequence: 1 },
    { sequence: 1 },
    { sequence: 4 }
  ], new Set([0]), 1);
  assert.deepEqual(result.map((partial) => partial.sequence), [1, 2]);
});

test('eski sohbet veya job manifestini reddeder', () => {
  assert.equal(manifestBelongsTo({
    jobId: 'job-a',
    lessonId: 'lesson-a'
  }, 'job-a', 'lesson-a'), true);
  assert.equal(manifestBelongsTo({
    jobId: 'job-a',
    lessonId: 'lesson-a'
  }, 'job-b', 'lesson-a'), false);
  assert.equal(manifestBelongsTo({
    jobId: 'job-a',
    lessonId: 'lesson-a'
  }, 'job-a', 'lesson-b'), false);
});

test('fMP4 init ve media kutularini append kuyrugu icin ayirir', () => {
  const input = new Uint8Array([
    ...mp4Box('ftyp'),
    ...mp4Box('moov'),
    ...mp4Box('moof'),
    ...mp4Box('mdat', [1, 2, 3])
  ]);
  const result = splitFragmentedMp4(input);
  assert.equal(result.init.byteLength, 16);
  assert.equal(result.media.byteLength, 19);
  assert.throws(() => splitFragmentedMp4(input.slice(0, -1)), /Eksik|gecersiz/);
});

test('tampon kapaliyken ilk gercek medya verisi oynatmayi baslatir', () => {
  assert.equal(hasPlaybackBuffer(0, 0), false);
  assert.equal(hasPlaybackBuffer(0.01, 0), true);
  assert.equal(hasPlaybackBuffer(5.99, 6), false);
  assert.equal(hasPlaybackBuffer(6, 6), true);
});

test('tampon hesabi zaman cizelgesindeki boslugu gecmez', () => {
  const ranges = {
    length: 2,
    start: (index) => [0, 20][index],
    end: (index) => [8, 40][index]
  };
  assert.equal(contiguousBufferedAhead(ranges, 3), 5);
  assert.equal(contiguousBufferedAhead(ranges, 10), 0);
  assert.equal(contiguousBufferedAhead(ranges, 22), 18);
});

test('partial MSE zaman penceresi backend zaman cizelgesini aynen kullanir', () => {
  assert.deepEqual(partialTimeline({ startSeconds: 6.4, durationSeconds: 6.9 }), {
    startSeconds: 6.4,
    endSeconds: 13.3
  });
});

test('yeni MSE penceresinde once bitis buyutulur sonra baslangic ilerletilir', () => {
  const calls = [];
  const sourceBuffer = {
    set appendWindowEnd(value) { calls.push(['end', value]); },
    set appendWindowStart(value) { calls.push(['start', value]); }
  };
  applyAppendWindow(sourceBuffer, { startSeconds: 8, endSeconds: 15 });
  assert.deepEqual(calls, [['end', 15], ['start', 8]]);
});

test('kucuk kare yuvarlama bosluklarini tek kesintisiz tampon sayar', () => {
  const ranges = {
    length: 2,
    start: (index) => [0, 6.05][index],
    end: (index) => [6, 12][index]
  };
  assert.equal(contiguousBufferedAhead(ranges, 1), 11);
});
