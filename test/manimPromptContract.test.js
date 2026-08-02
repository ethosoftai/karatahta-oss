import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildMandatoryManimContract } from '../services/manimPromptContract.js';

test('LaTeX ortaminda MathTex ve layout skill kurallarini zorunlu tutar', () => {
  const contract = buildMandatoryManimContract({ mathTexAvailable: true, font: 'Georgia' });
  assert.match(contract, /MathTex/);
  assert.match(contract, /fit_to_safe_area/);
  assert.match(contract, /0\.88/);
  assert.match(contract, /continuity\.visual_start_state/);
  assert.match(contract, /Metin-only sahne yasaktir/);
  assert.match(contract, /en fazla 42 karakter ve 6 kelime/);
  assert.match(contract, /include_numbers=False/);
  assert.match(contract, /kullanilan her degisken ve helper daha once tanimli/);
  assert.match(contract, /FadeOut\/self\.remove\(\)/);
  assert.match(contract, /Angle\(line1, line2, radius=\.\.\.\)/);
  assert.match(contract, /RightAngle\(line1, line2, length=\.\.\.\)/);
});

test('LaTeX kapaliysa calisabilir geometrik fallback ister', () => {
  const contract = buildMandatoryManimContract({ mathTexAvailable: false, font: 'Georgia' });
  assert.match(contract, /MathTex\/Tex kullanma/);
  assert.match(contract, /Line, VGroup ve Arrow/);
});

test('Manim coder promptu guvenli ve gorsel uretim ornekleri verir', () => {
  const prompt = readFileSync(new URL('../sistem.md', import.meta.url), 'utf8');
  assert.match(prompt, /ÇIKTI ÖNCESİ ZORUNLU PREFLIGHT/);
  assert.match(prompt, /Text-only sahne yasak/);
  assert.match(prompt, /concept_map/);
  assert.doesNotMatch(prompt, /DejaVu Sans/);
  assert.doesNotMatch(prompt, /### text_reveal/);
  assert.doesNotMatch(prompt, /include_numbers(?:"\s*:|=)\s*True(?=[,)])/);
});
