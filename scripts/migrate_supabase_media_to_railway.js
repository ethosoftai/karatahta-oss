import 'dotenv/config';

import { createClient } from '@supabase/supabase-js';
import {
  isRailwayStoragePath,
  railwayMediaConfigured,
  uploadBufferToRailway
} from '../services/mediaStore.js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const deleteSource = process.argv.includes('--delete-source');
const deleteBuckets = process.argv.includes('--delete-buckets');

if (!supabaseUrl || !supabaseSecretKey) {
  throw new Error('SUPABASE_URL ve SUPABASE_SECRET_KEY gerekli.');
}
if (!railwayMediaConfigured) {
  throw new Error('Railway Bucket ortam degiskenleri eksik.');
}
if (deleteBuckets && !deleteSource) {
  throw new Error('--delete-buckets yalniz --delete-source ile birlikte kullanilabilir.');
}

const supabase = createClient(supabaseUrl, supabaseSecretKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

const locations = [
  { table: 'tts_outputs', column: 'storage_path', bucket: 'audio' },
  { table: 'video_renders', column: 'video_storage_path', bucket: 'videos' },
  { table: 'video_renders', column: 'audio_storage_path', bucket: 'audio' },
  { table: 'lesson_videos', column: 'video_storage_path', bucket: 'videos' },
  { table: 'attachments', column: 'storage_path', bucket: 'attachments' }
];
const mediaBucketNames = ['videos', 'audio', 'attachments'];

const copiedSources = new Map();
let migratedReferences = 0;
let skippedReferences = 0;
const { data: currentBuckets, error: listBucketsError } = await supabase.storage.listBuckets();
if (listBucketsError) throw listBucketsError;
const existingMediaBuckets = mediaBucketNames.filter((name) => (
  (currentBuckets || []).some((bucket) => bucket.name === name)
));

async function listAllObjects(bucket, prefix = '') {
  const objects = [];
  const limit = 100;
  for (let offset = 0; ; offset += limit) {
    const { data: entries, error } = await supabase.storage
      .from(bucket)
      .list(prefix, {
        limit,
        offset,
        sortBy: { column: 'name', order: 'asc' }
      });
    if (error) throw error;
    for (const entry of entries || []) {
      const objectPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id) {
        objects.push(objectPath);
      } else {
        objects.push(...await listAllObjects(bucket, objectPath));
      }
    }
    if ((entries || []).length < limit) break;
  }
  return objects;
}

async function copySourceObject(bucket, sourcePath) {
  const sourceKey = `${bucket}:${sourcePath}`;
  let uploaded = copiedSources.get(sourceKey);
  if (uploaded) return uploaded;

  const { data: blob, error: downloadError } = await supabase.storage
    .from(bucket)
    .download(sourcePath);
  if (downloadError) throw downloadError;
  const buffer = Buffer.from(await blob.arrayBuffer());
  uploaded = await uploadBufferToRailway({
    bucket,
    storagePath: sourcePath,
    buffer,
    contentType: blob.type || undefined
  });
  copiedSources.set(sourceKey, {
    ...uploaded,
    bucket,
    sourcePath,
    size: buffer.length
  });
  return uploaded;
}

for (const bucket of existingMediaBuckets) {
  const objectPaths = await listAllObjects(bucket);
  for (const objectPath of objectPaths) {
    await copySourceObject(bucket, objectPath);
  }
}

async function migrateLocation({ table, column, bucket }) {
  const { data: rows, error } = await supabase
    .from(table)
    .select(`id,${column}`)
    .not(column, 'is', null);
  if (error) throw error;

  for (const row of rows || []) {
    const sourcePath = row[column];
    if (!sourcePath || isRailwayStoragePath(sourcePath)) {
      skippedReferences += 1;
      continue;
    }

    const sourceKey = `${bucket}:${sourcePath}`;
    let uploaded = copiedSources.get(sourceKey);
    if (!uploaded) {
      uploaded = await copySourceObject(bucket, sourcePath);
    }

    const patch = { [column]: uploaded.storagePath };
    if (table === 'tts_outputs' && column === 'storage_path') {
      patch.public_url = null;
    }
    const { error: updateError } = await supabase
      .from(table)
      .update(patch)
      .eq('id', row.id);
    if (updateError) throw updateError;
    migratedReferences += 1;
  }
}

for (const location of locations) {
  await migrateLocation(location);
}

for (const location of locations) {
  const { data: rows, error } = await supabase
    .from(location.table)
    .select(`id,${location.column}`)
    .not(location.column, 'is', null);
  if (error) throw error;
  const legacy = (rows || []).filter((row) => !isRailwayStoragePath(row[location.column]));
  if (legacy.length) {
    throw new Error(`${location.table}.${location.column} icin ${legacy.length} eski kayit kaldi.`);
  }
}

let deletedSources = 0;
let deletedBuckets = 0;
if (deleteSource) {
  for (const bucket of existingMediaBuckets) {
    const { error } = await supabase.storage.emptyBucket(bucket);
    if (error) throw error;
  }
  deletedSources = copiedSources.size;
}

async function deleteBucketWithRetry(bucket) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const { error } = await supabase.storage.deleteBucket(bucket);
    if (!error) return;
    const isStillEmptying = String(error.statusCode || error.status) === '409';
    if (!isStillEmptying || attempt === 5) throw error;
    await new Promise((resolve) => setTimeout(resolve, attempt * 500));
  }
}

if (deleteBuckets) {
  for (const bucket of existingMediaBuckets) {
    await deleteBucketWithRetry(bucket);
    deletedBuckets += 1;
  }
}

console.log(JSON.stringify({
  migratedReferences,
  uniqueObjectsCopied: copiedSources.size,
  skippedReferences,
  deletedSources,
  deletedBuckets,
  sourceDeletionRequested: deleteSource,
  bucketDeletionRequested: deleteBuckets
}, null, 2));
