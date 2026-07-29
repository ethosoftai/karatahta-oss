import 'dotenv/config';

import {
  configureRailwayBucketCors,
  railwayMediaConfigured
} from '../services/mediaStore.js';

if (!railwayMediaConfigured) {
  throw new Error('Railway Bucket ortam degiskenleri eksik.');
}

const productionOrigins = String(process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = [
  ...productionOrigins,
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://0.0.0.0:3000',
  'http://0.0.0.0:3001'
];
const rules = await configureRailwayBucketCors(allowedOrigins);

console.log(JSON.stringify({
  configured: true,
  allowedOrigins: rules[0]?.AllowedOrigins || [],
  allowedMethods: rules[0]?.AllowedMethods || []
}, null, 2));
