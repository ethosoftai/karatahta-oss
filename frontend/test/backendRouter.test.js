import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BackendRouter,
  initialBackendKey,
  normalizeBackendMode,
  shouldFailoverResponse
} from '../src/legacy/backendRouter.js';

const targets = {
  railway: 'https://railway.example',
  vps: 'https://vps.example/'
};

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value)
  };
}

test('uc modu dogrular ve hibritte VPS ile baslar', () => {
  assert.equal(normalizeBackendMode('railway'), 'railway');
  assert.equal(normalizeBackendMode('vps'), 'vps');
  assert.equal(normalizeBackendMode('hybrid'), 'hybrid');
  assert.equal(normalizeBackendMode('bilinmeyen'), 'railway');
  assert.equal(initialBackendKey('hybrid'), 'vps');
});

test('secimi kalici saklar ve URLleri secili backend ile cozer', () => {
  const storage = memoryStorage();
  const router = new BackendRouter({ targets, storage, fetcher: async () => null });
  router.setMode('vps');
  assert.equal(storage.getItem('karaBackendMode'), 'vps');
  assert.equal(router.resolve('/api/config'), 'https://vps.example/api/config');
});

test('hibrit GET istegini VPS 503 olunca Railway uzerinden tekrarlar', async () => {
  const calls = [];
  const router = new BackendRouter({
    targets,
    storage: memoryStorage({ karaBackendMode: 'hybrid' }),
    fetcher: async (url) => {
      calls.push(url);
      return { ok: url.startsWith('https://railway.example'), status: url.startsWith('https://railway.example') ? 200 : 503 };
    }
  });
  const response = await router.request('/api/config');
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [
    'https://vps.example/api/config',
    'https://railway.example/api/config'
  ]);
  assert.equal(router.activeKey, 'railway');
});

test('POST isteklerini cift uretim riski nedeniyle otomatik tekrarlamaz', async () => {
  let calls = 0;
  const router = new BackendRouter({
    targets,
    storage: memoryStorage({ karaBackendMode: 'hybrid' }),
    fetcher: async () => {
      calls += 1;
      return { ok: false, status: 503 };
    }
  });
  const response = await router.request('/api/generate-lesson', { method: 'POST' });
  assert.equal(response.status, 503);
  assert.equal(calls, 1);
  assert.equal(shouldFailoverResponse(response, 'POST'), false);
});

test('aktif ders kilidi mod degisikligini ve failoveri engeller', async () => {
  let calls = 0;
  const router = new BackendRouter({
    targets,
    storage: memoryStorage({ karaBackendMode: 'hybrid' }),
    fetcher: async () => {
      calls += 1;
      return { ok: false, status: 503 };
    }
  });
  router.setLocked(true);
  assert.throws(() => router.setMode('railway'), /Aktif ders/);
  const response = await router.request('/api/jobs/123');
  assert.equal(response.status, 503);
  assert.equal(calls, 1);
});

test('harici imzali medya URLlerini backend failoverina sokmaz', async () => {
  const calls = [];
  const router = new BackendRouter({
    targets,
    storage: memoryStorage({ karaBackendMode: 'hybrid' }),
    fetcher: async (url) => {
      calls.push(url);
      return { ok: false, status: 503 };
    }
  });
  await router.request('https://storage.example/video.mp4');
  assert.deepEqual(calls, ['https://storage.example/video.mp4']);
});
