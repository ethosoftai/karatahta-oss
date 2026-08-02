import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKaraLiveTools, getFrameTool } from '../services/karaLiveTools.js';

test('get_frame araci zaman parametresini sayisal ve zorunlu tanimlar', () => {
  assert.equal(getFrameTool.name, 'get_frame');
  assert.equal(getFrameTool.parameters.properties.time.type, 'NUMBER');
  assert.deepEqual(getFrameTool.parameters.required, ['time']);
});

test('canli araclar get_frame, web_search ve generate_manim icerir', () => {
  const [{ functionDeclarations }] = buildKaraLiveTools();
  const names = functionDeclarations.map((tool) => tool.name);
  assert.deepEqual(names, ['get_frame', 'web_search', 'generate_manim']);
});
