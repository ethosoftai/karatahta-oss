import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyManimRenderFailure } from '../services/manimRenderFailure.js';

test('SIGKILL ile sonlanan Manim sureci kod onarimina gonderilmez', () => {
  const failure = classifyManimRenderFailure({ code: null, signal: 'SIGKILL' });
  assert.equal(failure.kind, 'signal_terminated');
  assert.equal(failure.shouldRepair, false);
});

test('exit code olmadan kapanan Manim sureci altyapi hatasi olarak ayrilir', () => {
  const failure = classifyManimRenderFailure({ code: null, signal: null });
  assert.equal(failure.kind, 'missing_exit_code');
  assert.equal(failure.shouldRepair, false);
});

test('normal Python render hatasi LLM kod onarimina uygundur', () => {
  const failure = classifyManimRenderFailure({ code: 1 });
  assert.equal(failure.kind, 'render_error');
  assert.equal(failure.shouldRepair, true);
});
