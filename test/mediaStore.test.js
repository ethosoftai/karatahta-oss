import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isRailwayStoragePath,
  normalizeSignedUrlTtlSeconds,
  railwayObjectKeyFor,
  railwayStoragePathFor
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
