import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEarlySpeechScript,
  extractArrayObjects,
  extractFirstArrayObject,
  isUsableLessonSegment,
  mergeFirstSegment
} from '../services/streamingPlan.js';

test('stream edilen plandan ilk tamamlanmis segmenti ayiklar', () => {
  const partial = `{
    "segments": [
      {
        "id": "s1",
        "title": "Sezgi",
        "narration": "Parantez { ve tirnak \\" icerebilir.",
        "animation": {
          "type": "diagram",
          "sequence": ["ilk adim", "ikinci adim"]
        }
      },`;
  const segment = extractFirstArrayObject(partial);
  assert.equal(segment.id, 's1');
  assert.equal(segment.animation.type, 'diagram');
  assert.equal(isUsableLessonSegment(segment), true);
});

test('ilk segment kapanmadan erken sonuc dondurmez', () => {
  const partial = '{"segments":[{"id":"s1","title":"Eksik","animation":{';
  assert.equal(extractFirstArrayObject(partial), null);
});

test('stream tamamlanmadan kapanan tum segmentleri sirayla ayiklar', () => {
  const partial = `{"segments":[
    {"id":"s1","title":"Bir","animation":{"type":"diagram"}},
    {"id":"s2","title":"Iki","narration":"Metinde } karakteri olabilir.","animation":{"type":"graph"}},
    {"id":"s3","title":"Eksik","animation":{
  `;
  const segments = extractArrayObjects(partial);
  assert.deepEqual(segments.map((segment) => segment.id), ['s1', 's2']);
});

test('segments anahtari henuz gelmediyse sonuc dondurmez', () => {
  assert.equal(extractFirstArrayObject('{"topic":"Fizik","hook":{}}'), null);
});

test('erken uretilen ilk segmenti final planin basinda korur', () => {
  const first = {
    id: 's1',
    title: 'Erken segment',
    animation: { type: 'diagram' }
  };
  const merged = mergeFirstSegment({
    topic: 'Fizik',
    segments: [
      { id: 's1', title: 'Gec segment', animation: { type: 'text_reveal' } },
      { id: 's2', title: 'Devam', animation: { type: 'graph_plot' } }
    ]
  }, first);
  assert.equal(merged.segments[0], first);
  assert.equal(merged.segments[1].id, 's2');
});

test('ilk segment narration alanini ikinci LLM istegi olmadan speech scriptine cevirir', () => {
  const narration = 'Fotosentez, bitkilerin gunes enerjisini kullanarak su ve karbondioksitten besin urettigi surectir. Bu surecte klorofil isigi yakalar ve enerji donusumu baslar.';
  const speech = buildEarlySpeechScript({
    duration_seconds: 65,
    narration,
    animation: {
      sequence: ['gunes isigini goster', 'yapraga yakinlas', 'glikozu vurgula']
    }
  });
  assert.equal(speech.speech_text, narration);
  assert.equal(speech.estimated_seconds, 65);
  assert.equal(speech.cue_plan.length, 3);
  assert.deepEqual(speech.cue_plan.map((cue) => cue.at_percent), [17, 50, 83]);
});
