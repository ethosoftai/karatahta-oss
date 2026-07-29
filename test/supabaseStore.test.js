import test from 'node:test';
import assert from 'node:assert/strict';

import { authUserFromClaims, normalizeSignedUrlTtlSeconds } from '../services/supabaseStore.js';

test('signed URL süresini varsayılan, alt ve üst sınırlarda normalize eder', () => {
  assert.equal(normalizeSignedUrlTtlSeconds(undefined), 3600);
  assert.equal(normalizeSignedUrlTtlSeconds('30'), 60);
  assert.equal(normalizeSignedUrlTtlSeconds('7200'), 7200);
  assert.equal(normalizeSignedUrlTtlSeconds('999999'), 86400);
});

test('doğrulanmış JWT claimlerini profil kullanıcısına dönüştürür', () => {
  assert.deepEqual(authUserFromClaims({
    sub: 'user-1',
    email: 'user@example.com',
    user_metadata: { display_name: 'Kara' }
  }), {
    id: 'user-1',
    email: 'user@example.com',
    user_metadata: { display_name: 'Kara' }
  });
  assert.equal(authUserFromClaims({ email: 'missing-sub@example.com' }), null);
});
