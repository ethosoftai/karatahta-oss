import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createLocalMediaSignature,
  isLocalStoragePath,
  isRailwayStoragePath,
  localObjectKeyFor,
  localStoragePathFor,
  normalizeSignedUrlTtlSeconds,
  railwayObjectKeyFor,
  railwayStoragePathFor,
  verifyLocalMediaSignature
} from '../services/mediaStore.js';

test('Railway nesne yolunu provider bilgisiyle saklar ve geri acar', () => {
  const objectKey = railwayObjectKeyFor('videos', 'users/u1/lessons/l1/final/video.mp4');
  assert.equal(objectKey, 'videos/users/u1/lessons/l1/final/video.mp4');
  const storagePath = railwayStoragePathFor(objectKey);
  assert.equal(storagePath, 'railway://videos/users/u1/lessons/l1/final/video.mp4');
  assert.equal(isRailwayStoragePath(storagePath), true);
  assert.equal(railwayObjectKeyFor('ignored', storagePath), objectKey);
});

test('Railway imzali URL suresini guvenli sinirlarda tutar', () => {
  assert.equal(normalizeSignedUrlTtlSeconds(undefined), 3600);
  assert.equal(normalizeSignedUrlTtlSeconds('30'), 60);
  assert.equal(normalizeSignedUrlTtlSeconds('7200'), 7200);
  assert.equal(normalizeSignedUrlTtlSeconds('999999'), 86400);
});

test('VPS yerel medya nesne yolunu provider bilgisiyle saklar', () => {
  const objectKey = localObjectKeyFor('videos', 'users/u1/lessons/l1/final/video.mp4');
  assert.equal(objectKey, 'videos/users/u1/lessons/l1/final/video.mp4');
  const storagePath = localStoragePathFor(objectKey);
  assert.equal(storagePath, 'local://videos/users/u1/lessons/l1/final/video.mp4');
  assert.equal(isLocalStoragePath(storagePath), true);
  assert.equal(localObjectKeyFor('ignored', storagePath), objectKey);
});

test('VPS yerel medya imzasi dosya ve sureye baglidir', () => {
  const objectKey = 'videos/users/u1/lessons/l1/final/video.mp4';
  const secret = 'test-secret';
  const expiresAtUnix = 2_000_000_000;
  const signature = createLocalMediaSignature(objectKey, expiresAtUnix, secret);
  assert.equal(verifyLocalMediaSignature({
    objectKey,
    expiresAtUnix,
    signature,
    secret,
    nowUnix: expiresAtUnix - 1
  }), true);
  assert.equal(verifyLocalMediaSignature({
    objectKey: `${objectKey}.changed`,
    expiresAtUnix,
    signature,
    secret,
    nowUnix: expiresAtUnix - 1
  }), false);
  assert.equal(verifyLocalMediaSignature({
    objectKey,
    expiresAtUnix,
    signature,
    secret,
    nowUnix: expiresAtUnix + 1
  }), false);
});
