import test from 'node:test';
import assert from 'node:assert/strict';

import {
  authUserFromClaims,
  createOAuthSignInUrl,
  normalizeSignedUrlTtlSeconds
} from '../services/supabaseStore.js';

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

test('Google OAuth için sabit sağlayıcı ve güvenli dönüş adresi kullanır', async () => {
  let request;
  const url = await createOAuthSignInUrl({
    provider: 'google',
    redirectTo: 'https://karatahta.ethosoft.org/?auth=oauth',
    authClient: {
      auth: {
        signInWithOAuth: async (options) => {
          request = options;
          return {
            data: { url: 'https://project.supabase.co/auth/v1/authorize?provider=google' },
            error: null
          };
        }
      }
    }
  });

  assert.equal(url, 'https://project.supabase.co/auth/v1/authorize?provider=google');
  assert.deepEqual(request, {
    provider: 'google',
    options: {
      skipBrowserRedirect: true,
      redirectTo: 'https://karatahta.ethosoft.org/?auth=oauth'
    }
  });
});

test('Drive baglantisi icin scope ve offline access parametrelerini iletir', async () => {
  let request;
  await createOAuthSignInUrl({
    provider: 'google',
    redirectTo: 'https://karatahta.ethosoft.org/?auth=drive',
    scopes: 'https://www.googleapis.com/auth/drive.file',
    queryParams: { access_type: 'offline', prompt: 'consent' },
    authClient: {
      auth: {
        signInWithOAuth: async (options) => {
          request = options;
          return { data: { url: 'https://project.supabase.co/auth/v1/authorize?provider=google' }, error: null };
        }
      }
    }
  });

  assert.deepEqual(request.options, {
    skipBrowserRedirect: true,
    redirectTo: 'https://karatahta.ethosoft.org/?auth=drive',
    scopes: 'https://www.googleapis.com/auth/drive.file',
    queryParams: { access_type: 'offline', prompt: 'consent' }
  });
});

test('desteklenmeyen OAuth sağlayıcısını reddeder', async () => {
  await assert.rejects(
    createOAuthSignInUrl({
      provider: 'github',
      authClient: { auth: {} }
    }),
    (error) => error.statusCode === 400
  );
});
