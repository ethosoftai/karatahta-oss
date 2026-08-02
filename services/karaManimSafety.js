const FORBIDDEN_KARA_MANIM_PATTERNS = [
  /^\s*(?:import\s+(?!manim\b)|from\s+(?!manim\b))/m,
  /\b(?:open|exec|eval|compile|__import__|globals|locals|input)\s*\(/,
  /\b(?:os|sys|subprocess|socket|shutil|pathlib|requests|urllib|http|ftplib|pickle)\b/,
  /__[A-Za-z0-9_]+__/
];

export function assertSafeKaraManimCode(code, { validateScene } = {}) {
  const source = String(code || '');
  if (!source || source.length > 40000) {
    throw new Error('Kara Manim kodu bos veya izin verilen boyuttan buyuk.');
  }
  if (!/^\s*from\s+manim\s+import\s+\*/m.test(source)) {
    throw new Error('Kara Manim kodu yalnizca Manim importu ile baslamali.');
  }
  if (FORBIDDEN_KARA_MANIM_PATTERNS.some((pattern) => pattern.test(source))) {
    const error = new Error('Kara Manim kodu guvenli olmayan Python islemi iceriyor.');
    error.statusCode = 422;
    throw error;
  }
  validateScene?.(source);
  return source;
}
