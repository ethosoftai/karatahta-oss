import test from 'node:test';
import assert from 'node:assert/strict';

import {
  scheduleRemainingSegmentPreparations,
  segmentDurationBudget,
  speechDurationBudget
} from '../services/segmentPipeline.js';

test('segment duration follows requested total lesson length', () => {
  assert.deepEqual(segmentDurationBudget(2, 4), {
    averageSeconds: 30,
    minSeconds: 23,
    maxSeconds: 38
  });
  assert.deepEqual(segmentDurationBudget(10, 20), {
    averageSeconds: 30,
    minSeconds: 23,
    maxSeconds: 38
  });
});

test('speech duration stays close to its segment budget', () => {
  assert.deepEqual(speechDurationBudget(30), {
    targetSeconds: 30,
    minSeconds: 24,
    maxSeconds: 36
  });
});

test('remaining segment preparations are queued together', () => {
  const scheduled = [];
  const tasks = scheduleRemainingSegmentPreparations(5, (index) => {
    scheduled.push(index);
    return `task-${index}`;
  });
  assert.deepEqual(scheduled, [1, 2, 3, 4]);
  assert.deepEqual(tasks, ['task-1', 'task-2', 'task-3', 'task-4']);
});
