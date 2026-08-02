import test from 'node:test';
import assert from 'node:assert/strict';
import { extractManimErrorSummary } from '../services/manimErrorSummary.js';

// Real render failures captured in production this session -- not
// hand-crafted samples -- so the parser is proven against what Manim/Rich
// actually prints, box-drawing characters and all.

const GROW_ARROW_OUTPUT = `                    │
│ ❱ 125 │   │   │   │   │   scene.render()                                     │
│   126 │   │   │   except Exception:                                          │
│   127 │   │   │   │   error_console.print_exception()                        │
│   128 │   │   │   │   sys.exit(1)                                            │
│                                                                              │
│ /opt/venv/lib/python3.11/site-packages/manim/scene/scene.py:259 in render    │
│                                                                              │
│    256 │   │   """                                                           │
│    257 │   │   self.setup()                                                  │
│    258 │   │   try:                                                          │
│ ❱  259 │   │   │   self.construct()                                          │
│    260 │   │   except EndSceneEarlyException:                                │
│    261 │   │   │   pass                                                      │
│    262 │   │   except RerunSceneException:                                   │
│                                                                              │
│ /app/renders/1785636639532-f09c3ac1-s1/Seg_s1.py:43 in construct             │
│                                                                              │
│    40 │   │   fit_to_safe_area(axes_group)                                   │
│    41 │   │   self.add(axes_group)                                           │
│    42 │   │                                                                  │
│ ❱  43 │   │   area = axes.get_area(                                          │
│    44 │   │   │   lambda x: (x**2 - 4*x + 3) * np.exp(-x),                   │
│    45 │   │   │   x_range=[0, 2],                                            │
│    46 │   │   │   color=BLUE,                                                │
│                                                                              │
╰──────────────────────────────────────────────────────────────────────────────╯
TypeError: VMobject.scale() got an unexpected keyword argument 'scale_tips'

Render zaman asimina ugradi.`;

const GET_AREA_OUTPUT = `│ /app/renders/1785687092334-348a3609-s4/Seg_s4.py:43 in construct             │
│                                                                              │
│    40 │   │   fit_to_safe_area(axes_group)                                   │
│    41 │   │   self.add(axes_group)                                           │
│    42 │   │                                                                  │
│ ❱  43 │   │   area = axes.get_area(                                          │
│    44 │   │   │   lambda x: (x**2 - 4*x + 3) * np.exp(-x),                   │
│    45 │   │   │   x_range=[0, 2],                                            │
│    46 │   │   │   color=BLUE,                                                │
│                                                                              │
│ /opt/venv/lib/python3.11/site-packages/manim/mobject/graphing/coordinate_sys │
│ tems.py:1425 in get_area                                                     │
│                                                                              │
│   1422 │   │                                                                 │
│   1423 │   │   if bounded_graph is None:                                     │
│   1424 │   │   │   points = (                                                │
│ ❱ 1425 │   │   │   │   [self.c2p(a), graph.function(a)]                      │
│   1426 │   │   │   │   + [p for p in graph.points if a <= self.p2c(p)[0] <=  │
│   1427 │   │   │   │   + [graph.function(b), self.c2p(b)]                    │
│   1428 │   │   │   )                                                         │
╰──────────────────────────────────────────────────────────────────────────────╯
AttributeError: 'function' object has no attribute 'function'
`;

test('GrowArrow hatasini gercek Rich traceback ciktisindan ozetler', () => {
  const summary = extractManimErrorSummary(GROW_ARROW_OUTPUT);
  assert.equal(summary.exceptionType, 'TypeError');
  assert.equal(summary.exceptionMessage, "VMobject.scale() got an unexpected keyword argument 'scale_tips'");
  assert.equal(summary.sourceFile, 'Seg_s1.py');
  assert.equal(summary.sourceLine, 43);
  assert.equal(
    summary.oneLine,
    "TypeError: VMobject.scale() got an unexpected keyword argument 'scale_tips' (Seg_s1.py:43)"
  );
});

test('get_area hatasini gercek Rich traceback ciktisindan ozetler', () => {
  const summary = extractManimErrorSummary(GET_AREA_OUTPUT);
  assert.equal(summary.exceptionType, 'AttributeError');
  assert.equal(summary.exceptionMessage, "'function' object has no attribute 'function'");
  assert.equal(summary.sourceFile, 'Seg_s4.py');
  assert.equal(summary.sourceLine, 43);
});

test('taninabilir bir exception yoksa null doner', () => {
  assert.equal(extractManimErrorSummary('random noise without a traceback'), null);
  assert.equal(extractManimErrorSummary(''), null);
  assert.equal(extractManimErrorSummary(null), null);
});
