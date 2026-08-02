import test from 'node:test';
import assert from 'node:assert/strict';

import { assertSafeKaraManimCode } from '../services/karaManimSafety.js';

test('yalnız Manim kullanan tek sahne kodunu kabul eder', () => {
  const code = `from manim import *
class SafeScene(Scene):
    def construct(self):
        self.add(Circle())`;
  assert.equal(assertSafeKaraManimCode(code), code);
});

test('dosya, shell, ağ ve dinamik kod çalıştırma girişimlerini reddeder', () => {
  const unsafe = [
    'from manim import *\nimport os\nos.system("id")',
    'from manim import *\nopen("/etc/passwd").read()',
    'from manim import *\nexec("print(1)")',
    'from manim import *\nimport requests\nrequests.get("https://example.com")',
    'from manim import *\nCircle().__class__'
  ];
  unsafe.forEach((code) => assert.throws(() => assertSafeKaraManimCode(code), /guvenli olmayan/));
});

test('Manim dışında import kabul etmez', () => {
  assert.throws(
    () => assertSafeKaraManimCode('import numpy as np\nfrom manim import *'),
    /guvenli olmayan/
  );
});
