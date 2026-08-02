// Manim (via Rich) prints failures as a large boxed traceback -- readable
// for one failure, but unusable for scanning many generations' worth of
// logs for a recurring pattern. This pulls out the two lines that actually
// matter: the Python exception itself, and which line of the *generated*
// scene file triggered it (not manim's own internals).

const EXCEPTION_LINE_RE = /^([A-Za-z_][\w.]*(?:Error|Exception)):\s*(.+)$/;
const GENERATED_FILE_LINE_RE = /(Seg_\w+\.py):(\d+)/;

export function extractManimErrorSummary(output) {
  const text = String(output || '');
  const lines = text.split('\n').map((line) => line.trim());

  let exceptionType = null;
  let exceptionMessage = null;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const match = lines[i].match(EXCEPTION_LINE_RE);
    if (match) {
      exceptionType = match[1];
      exceptionMessage = match[2].trim();
      break;
    }
  }

  let sourceFile = null;
  let sourceLine = null;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const match = lines[i].match(GENERATED_FILE_LINE_RE);
    if (match) {
      sourceFile = match[1];
      sourceLine = Number(match[2]);
      break;
    }
  }

  if (!exceptionType) {
    return null;
  }

  return {
    exceptionType,
    exceptionMessage,
    sourceFile,
    sourceLine,
    oneLine: `${exceptionType}: ${exceptionMessage}${sourceFile ? ` (${sourceFile}:${sourceLine})` : ''}`
  };
}
