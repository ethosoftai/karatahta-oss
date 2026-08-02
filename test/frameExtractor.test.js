import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFrameExtractArgs } from '../services/frameExtractor.js';

test('ffmpeg kare cikarma argumanlari zaman damgasini -i den once seeker olarak kullanir', () => {
  const args = buildFrameExtractArgs({
    videoUrl: 'https://example.com/lesson.mp4',
    timestampSeconds: 42.5,
    outputPath: '/tmp/out.jpg'
  });
  assert.deepEqual(args, [
    '-y',
    '-ss', '42.500',
    '-i', 'https://example.com/lesson.mp4',
    '-frames:v', '1',
    '-q:v', '3',
    '/tmp/out.jpg'
  ]);
});

test('negatif veya gecersiz zaman damgasini sifira sabitler', () => {
  const args = buildFrameExtractArgs({
    videoUrl: 'video.mp4',
    timestampSeconds: -5,
    outputPath: 'out.jpg'
  });
  assert.equal(args[2], '0.000');
});
