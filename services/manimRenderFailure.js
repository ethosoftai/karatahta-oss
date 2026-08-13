export function classifyManimRenderFailure(result = {}) {
  const code = result.code;
  const signal = result.signal || null;

  if (result.timedOut) {
    return {
      kind: 'timeout',
      oneLine: 'Manim process render timeout sonrasinda durduruldu.',
      shouldRepair: false
    };
  }
  if (signal) {
    return {
      kind: 'signal_terminated',
      oneLine: `Manim process ${signal} sinyaliyle sonlandi.`,
      shouldRepair: false
    };
  }
  if (code === null || code === undefined) {
    return {
      kind: 'missing_exit_code',
      oneLine: 'Manim process exit code uretmeden sonlandi.',
      shouldRepair: false
    };
  }
  return {
    kind: 'render_error',
    oneLine: `Manim ${code} exit code ile sonlandi.`,
    shouldRepair: true
  };
}
