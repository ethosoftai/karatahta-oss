import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildConcatArgs,
  buildFilterConcatArgs,
  buildMuxArgs,
  buildProgressiveAudioArgs,
  buildProgressivePartialArgs,
  buildSegmentEndTrimArgs,
  buildTimedSubtitleSrt,
  calculateVideoStretchFactor
} from '../services/videoPostprocess.js';

test('video süresini ses süresine eşitleyen katsayıyı hesaplar', () => {
  assert.equal(calculateVideoStretchFactor(72.966667, 91.536), 91.536 / 72.966667);
});

test('kisa Manim videosunu sesi kesmeden son kareyle tamamlar', () => {
  const args = buildMuxArgs({
    videoPath: '/tmp/video.mp4',
    audioPath: '/tmp/audio.mp3',
    outputPath: '/tmp/output.mp4',
    videoDuration: 14.6,
    audioDuration: 28.2
  });
  const filter = args[args.indexOf('-filter_complex') + 1];
  assert.match(filter, /tpad=stop_mode=clone:stop_duration=13\.600/);
  assert.match(filter, /trim=duration=28\.200/);
  assert.equal(args[args.indexOf('-t') + 1], '28.200');
  assert.ok(!args.includes('-shortest'));
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

test('segment sonu mekanik kirpma suresi 2 saniye dusurur', () => {
  const args = buildSegmentEndTrimArgs({
    inputPath: '/tmp/segment.mp4',
    outputPath: '/tmp/segment.trimmed.mp4',
    videoDuration: 62.4,
    trimSeconds: 2
  });
  assert.equal(args[args.indexOf('-t') + 1], '60.400');
});

test('segment sonu kirpma kisa segmentlerde sureyi sifira/negatife dusurmez', () => {
  const args = buildSegmentEndTrimArgs({
    inputPath: '/tmp/segment.mp4',
    outputPath: '/tmp/segment.trimmed.mp4',
    videoDuration: 2.5,
    trimSeconds: 2
  });
  assert.equal(args[args.indexOf('-t') + 1], '1.000');
});

test('final MP4 birleştirmesinde hızlı başlatma metadata bayrağını kullanır', () => {
  const args = buildConcatArgs({
    listPath: '/tmp/concat.txt',
    outputPath: '/tmp/final.mp4'
  });
  assert.deepEqual(args.slice(-3), ['-movflags', '+faststart', '/tmp/final.mp4']);
  assert.equal(args[args.indexOf('-c:v') + 1], 'libx264');
  assert.equal(args[args.indexOf('-c:a') + 1], 'aac');
  assert.ok(!args.includes('copy'));
});

test('sessiz Manim mikro parcalarini birlestirirken hayali ses streami istemez', () => {
  const args = buildConcatArgs({
    listPath: '/tmp/partials.txt',
    outputPath: '/tmp/partials.mp4',
    hasAudio: false
  });
  assert.ok(args.includes('-an'));
  assert.ok(!args.includes('-af'));
});

test('final ders segmentlerinin ses ve video zamanlarini sifirlayarak filter concat yapar', () => {
  const args = buildFilterConcatArgs({
    inputPaths: ['/tmp/a.mp4', '/tmp/b.mp4'],
    outputPath: '/tmp/final.mp4'
  });
  const filter = args[args.indexOf('-filter_complex') + 1];
  assert.match(filter, /setpts=PTS-STARTPTS\[v0\]/);
  assert.match(filter, /asetpts=PTS-STARTPTS\[a1\]/);
  assert.match(filter, /concat=n=2:v=1:a=1/);
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
