import test from 'node:test';
import assert from 'node:assert/strict';
import { safeJsonParse } from '../services/llmJson.js';

test('gecerli JSON yanitini degistirmeden okur', () => {
  assert.deepEqual(safeJsonParse('{"topic":"Turev","segments":[]}'), {
    topic: 'Turev',
    segments: []
  });
});

test('markdown fence icindeki JSON yanitini okur', () => {
  assert.deepEqual(safeJsonParse('```json\n{"topic":"Integral"}\n```'), {
    topic: 'Integral'
  });
});

test('LLM tarafindan uretilen tirnaksiz property ve trailing comma hatalarini onarir', () => {
  let repairEvent = null;
  const result = safeJsonParse(`{
    "topic": "Sinir aglari",
    segments: [
      {"id": "segment-1", "title": "Giris",},
    ],
  }`, {
    onRepair: (event) => {
      repairEvent = event;
    }
  });

  assert.equal(result.topic, 'Sinir aglari');
  assert.equal(result.segments[0].title, 'Giris');
  assert.match(repairEvent.parseError, /double-quoted property name|property name/i);
});

test('JSON etrafindaki aciklama metninden ilk objeyi ayiklar', () => {
  assert.deepEqual(
    safeJsonParse('Plan asagidadir:\n{"topic":"Fizik","segments":[]}\nBitti.'),
    { topic: 'Fizik', segments: [] }
  );
});
