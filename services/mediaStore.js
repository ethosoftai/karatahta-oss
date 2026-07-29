import {
  GetObjectCommand,
  GetBucketCorsCommand,
  HeadObjectCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createReadStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import {
  createStorageSignedUrl as createSupabaseStorageSignedUrl,
  storagePathFor,
  uploadDataUrl as uploadSupabaseDataUrl,
  uploadLocalFile as uploadSupabaseLocalFile
} from './supabaseStore.js';

const configuredProvider = String(process.env.MEDIA_STORAGE_PROVIDER || 'supabase')
  .trim()
  .toLowerCase();
const railwayEndpoint = process.env.MEDIA_S3_ENDPOINT;
const railwayBucket = process.env.MEDIA_S3_BUCKET;
const railwayRegion = process.env.MEDIA_S3_REGION || 'auto';
const railwayAccessKeyId = process.env.MEDIA_S3_ACCESS_KEY_ID;
const railwaySecretAccessKey = process.env.MEDIA_S3_SECRET_ACCESS_KEY;
const railwayUrlStyle = String(process.env.MEDIA_S3_URL_STYLE || 'virtual-host').toLowerCase();

export const railwayMediaConfigured = Boolean(
  railwayEndpoint
  && railwayBucket
  && railwayAccessKeyId
  && railwaySecretAccessKey
);
export const mediaStorageProvider = configuredProvider === 'railway' ? 'railway' : 'supabase';

let s3Client;

function requireRailwayMedia() {
  if (!railwayMediaConfigured) {
    throw new Error('Railway Bucket ayarlari eksik.');
  }
  if (!s3Client) {
    s3Client = new S3Client({
      endpoint: railwayEndpoint,
      region: railwayRegion,
      forcePathStyle: railwayUrlStyle === 'path',
      credentials: {
        accessKeyId: railwayAccessKeyId,
        secretAccessKey: railwaySecretAccessKey
      }
    });
  }
  return s3Client;
}

function dataUrlToBuffer(dataUrl) {
  const raw = String(dataUrl || '');
  const base64 = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw;
  return Buffer.from(base64, 'base64');
}

function cleanObjectPath(value) {
  const clean = String(value || '')
    .replace(/^\/+/, '')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');
  if (!clean) {
    throw new Error('Railway Bucket icin gecerli bir nesne yolu gerekli.');
  }
  return clean;
}

export function isRailwayStoragePath(storagePath) {
  return String(storagePath || '').startsWith('railway://');
}

export function railwayObjectKeyFor(bucket, storagePath) {
  if (isRailwayStoragePath(storagePath)) {
    return cleanObjectPath(String(storagePath).slice('railway://'.length));
  }
  return `${cleanObjectPath(bucket)}/${cleanObjectPath(storagePath)}`;
}

export function railwayStoragePathFor(objectKey) {
  return `railway://${cleanObjectPath(objectKey)}`;
}

export function normalizeSignedUrlTtlSeconds(value, fallback = 3600) {
  const parsed = Number(value);
  const seconds = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
  return Math.min(86400, Math.max(60, seconds));
}

export async function uploadBufferToRailway({
  bucket,
  storagePath,
  buffer,
  contentType
}) {
  const client = requireRailwayMedia();
  const objectKey = railwayObjectKeyFor(bucket, storagePath);
  const body = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  await client.send(new PutObjectCommand({
    Bucket: railwayBucket,
    Key: objectKey,
    Body: body,
    ContentLength: body.length,
    ContentType: contentType
  }));
  const head = await client.send(new HeadObjectCommand({
    Bucket: railwayBucket,
    Key: objectKey
  }));
  if (Number(head.ContentLength) !== body.length) {
    throw new Error(`Railway Bucket yukleme dogrulamasi basarisiz: ${objectKey}`);
  }
  return {
    bucket: railwayBucket,
    storagePath: railwayStoragePathFor(objectKey),
    publicUrl: null
  };
}

async function uploadLocalFileToRailway({ bucket, localPath, storagePath, contentType }) {
  const client = requireRailwayMedia();
  const objectKey = railwayObjectKeyFor(bucket, storagePath);
  const stat = await fs.stat(localPath);
  await client.send(new PutObjectCommand({
    Bucket: railwayBucket,
    Key: objectKey,
    Body: createReadStream(localPath),
    ContentLength: stat.size,
    ContentType: contentType
  }));
  const head = await client.send(new HeadObjectCommand({
    Bucket: railwayBucket,
    Key: objectKey
  }));
  if (Number(head.ContentLength) !== stat.size) {
    throw new Error(`Railway Bucket yukleme dogrulamasi basarisiz: ${objectKey}`);
  }
  return {
    bucket: railwayBucket,
    storagePath: railwayStoragePathFor(objectKey),
    publicUrl: null
  };
}

export async function uploadLocalFile(options) {
  if (mediaStorageProvider === 'railway') {
    return uploadLocalFileToRailway(options);
  }
  return uploadSupabaseLocalFile(options);
}

export async function uploadDataUrl(options) {
  if (mediaStorageProvider === 'railway') {
    return uploadBufferToRailway({
      bucket: options.bucket,
      storagePath: options.storagePath,
      buffer: dataUrlToBuffer(options.dataUrl),
      contentType: options.contentType
    });
  }
  return uploadSupabaseDataUrl(options);
}

export async function createStorageSignedUrl({
  bucket,
  storagePath,
  expiresInSeconds = 3600
}) {
  if (!isRailwayStoragePath(storagePath)) {
    return createSupabaseStorageSignedUrl({ bucket, storagePath, expiresInSeconds });
  }
  const client = requireRailwayMedia();
  const ttlSeconds = normalizeSignedUrlTtlSeconds(expiresInSeconds);
  const signedUrl = await getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: railwayBucket,
      Key: railwayObjectKeyFor(bucket, storagePath)
    }),
    { expiresIn: ttlSeconds }
  );
  return {
    signedUrl,
    expiresInSeconds: ttlSeconds,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString()
  };
}

export async function configureRailwayBucketCors(allowedOrigins) {
  const client = requireRailwayMedia();
  const origins = [...new Set((allowedOrigins || []).map((origin) => String(origin).trim()).filter(Boolean))];
  if (!origins.length) {
    throw new Error('Railway Bucket CORS icin en az bir origin gerekli.');
  }
  await client.send(new PutBucketCorsCommand({
    Bucket: railwayBucket,
    CORSConfiguration: {
      CORSRules: [{
        AllowedOrigins: origins,
        AllowedMethods: ['GET', 'HEAD', 'PUT'],
        AllowedHeaders: ['*'],
        ExposeHeaders: ['ETag', 'Content-Length', 'Content-Range', 'Accept-Ranges'],
        MaxAgeSeconds: 3600
      }]
    }
  }));
  const current = await client.send(new GetBucketCorsCommand({
    Bucket: railwayBucket
  }));
  return current.CORSRules || [];
}

export { storagePathFor };
