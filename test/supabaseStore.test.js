import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeSignedUrlTtlSeconds } from '../services/supabaseStore.js';

test('signed URL süresini varsayılan, alt ve üst sınırlarda normalize eder', () => {
  assert.equal(normalizeSignedUrlTtlSeconds(undefined), 3600);
  assert.equal(normalizeSignedUrlTtlSeconds('30'), 60);
  assert.equal(normalizeSignedUrlTtlSeconds('7200'), 7200);
  assert.equal(normalizeSignedUrlTtlSeconds('999999'), 86400);
});
