import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFallbackLiveBoardCommands,
  createLiveBoardNdjsonParser,
  normalizeLiveBoardCommand
} from '../services/liveBoard.js';

test('live board komutlarini guvenli koordinat ve alanlara normalize eder', () => {
  assert.deepEqual(
    normalizeLiveBoardCommand({
      id: 'formula',
      type: 'equation',
      at_percent: 140,
      duration_ms: 50,
      text: 'a² + b² = c²',
      x: -12,
      y: 43,
      color: 'url(javascript:alert(1))'
    }),
    {
      id: 'formula',
      type: 'equation',
      at_percent: 100,
      duration_ms: 250,
      color: '#fde68a',
      text: 'a² + b² = c²',
      x: 0,
      y: 43,
      x2: 88,
      y2: 82,
      width: 24,
      height: 18,
      radius: 9,
      font_size: 4.4,
      stroke_width: 0.7
    }
  );
});

test('NDJSON parser parcali Gemini tokenlarindan yalnizca tamamlanmis komutlari yayar', () => {
  const commands = [];
  const parser = createLiveBoardNdjsonParser((command) => commands.push(command));
  parser.push('```jsonl\n{"id":"a","type":"title","at_per');
  parser.push('cent":0,"text":"Limit"}\naciklama yazma\n');
  parser.push('{"id":"b","type":"line","at_percent":25,"x":10,"y":20,"x2":80,"y2":70}');
  parser.finish();

  assert.equal(commands.length, 2);
  assert.equal(commands[0].text, 'Limit');
  assert.equal(commands[1].type, 'line');
});

test('fallback komutlari her zaman baslikla baslar', () => {
  const commands = buildFallbackLiveBoardCommands({
    id: 's1',
    title: 'Turev',
    animation: { sequence: ['Tegeti ciz', 'Egimi goster'] }
  });
  assert.ok(commands.length >= 3);
  assert.equal(commands[0].type, 'title');
  assert.equal(commands[0].at_percent, 0);
});
