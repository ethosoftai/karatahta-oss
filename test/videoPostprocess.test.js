import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBurnSubtitleArgs,
  buildConcatArgs,
  buildMuxArgs,
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

test('canlı yayın post-process adımı hızlı encoder ayarını kullanabilir', () => {
  const muxArgs = buildMuxArgs({
    videoPath: '/tmp/video.mp4',
    audioPath: '/tmp/audio.mp3',
    outputPath: '/tmp/mux.mp4',
    videoDuration: 10,
    audioDuration: 12,
    preset: 'veryfast',
    crf: 24
  });
  const subtitleArgs = buildBurnSubtitleArgs({
    inputPath: '/tmp/mux.mp4',
    subtitlePath: '/tmp/subtitle.srt',
    outputPath: '/tmp/final.mp4',
    preset: 'veryfast',
    crf: 24
  });

  assert.equal(muxArgs[muxArgs.indexOf('-preset') + 1], 'veryfast');
  assert.equal(muxArgs[muxArgs.indexOf('-crf') + 1], '24');
  assert.equal(subtitleArgs[subtitleArgs.indexOf('-preset') + 1], 'veryfast');
});
