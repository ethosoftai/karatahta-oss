import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMandatoryManimContract } from '../services/manimPromptContract.js';

test('LaTeX ortaminda MathTex ve layout skill kurallarini zorunlu tutar', () => {
  const contract = buildMandatoryManimContract({ mathTexAvailable: true, font: 'Georgia' });
  assert.match(contract, /MathTex/);
  assert.match(contract, /fit_to_safe_area/);
  assert.match(contract, /0\.88/);
  assert.match(contract, /continuity\.visual_start_state/);
});

test('LaTeX kapaliysa calisabilir geometrik fallback ister', () => {
  const contract = buildMandatoryManimContract({ mathTexAvailable: false, font: 'Georgia' });
  assert.match(contract, /MathTex\/Tex kullanma/);
  assert.match(contract, /Line, VGroup ve Arrow/);
});
