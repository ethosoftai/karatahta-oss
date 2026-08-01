import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildConcatArgs,
  buildProgressiveAudioArgs,
  buildProgressivePartialArgs,
  buildTimedSubtitleSrt,
  calculateVideoStretchFactor
} from '../services/videoPostprocess.js';

test('video süresini ses süresine eşitleyen katsayıyı hesaplar', () => {
  assert.equal(calculateVideoStretchFactor(72.966667, 91.536), 91.536 / 72.966667);
});

test('konuşma metnini tüm ses süresine yayılan SRT bloklarına dönüştürür', () => {
  const srt = buildTimedSubtitleSrt('Kara delikler oluşur. Işık bile kaçamaz.', 10, 4);
  assert.match(srt, /00:00:00,000 -->/);
  assert.match(srt, /--> 00:00:10,000/);
  assert.match(srt, /Kara delikler/);
  assert.match(srt, /Işık bile/);
});

test('geçersiz süreleri reddeder', () => {
  assert.throws(() => calculateVideoStretchFactor(0, 10), /pozitif/);
});

test('final MP4 birleştirmesinde hızlı başlatma metadata bayrağını kullanır', () => {
  const args = buildConcatArgs({
    listPath: '/tmp/concat.txt',
    outputPath: '/tmp/final.mp4'
  });
  assert.deepEqual(args.slice(-3), ['-movflags', '+faststart', '/tmp/final.mp4']);
});

test('progressive ses segment basina yalniz bir kez AAC kodlanir', () => {
  const args = buildProgressiveAudioArgs({
    inputPath: 'speech.mp3',
    outputPath: 'speech.m4a',
    volume: 1.25,
    durationSeconds: 40
  });
  assert.deepEqual(args.slice(-7), ['-c:a', 'aac', '-b:a', '128k', '-ar', '48000', 'speech.m4a']);
  assert.match(args[args.indexOf('-af') + 1], /volume=1\.25/);
});

test('progressive parca kesintisiz AAC akisindan kopyalanir ve B-framesiz video kullanir', () => {
  const args = buildProgressivePartialArgs({
    sourcePath: 'partial.mp4',
    audioPath: 'speech.m4a',
    outputPath: 'normalized.mp4',
    audioStartSeconds: 6.4,
    durationSeconds: 6.9
  });
  assert.equal(args[args.indexOf('-c:a') + 1], 'copy');
  assert.equal(args[args.indexOf('-bf') + 1], '0');
  assert.equal(args[args.indexOf('-ss') + 1], '6.400');
  assert.match(args[args.indexOf('-filter_complex') + 1], /setpts=PTS-STARTPTS/);
  assert.doesNotMatch(args.join(' '), /-c:a aac/);
});
