import 'dotenv/config';

import pg from 'pg';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { Client } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function getProjectRef() {
  const url = new URL(process.env.SUPABASE_URL);
  return url.hostname.split('.')[0];
}

function getConnectionString() {
  if (process.env.SUPABASE_DB_URL) {
    return process.env.SUPABASE_DB_URL;
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_PASSWORD) {
    throw new Error('SUPABASE_DB_URL veya SUPABASE_URL + SUPABASE_PASSWORD gerekli.');
  }

  const projectRef = getProjectRef();
  const password = encodeURIComponent(process.env.SUPABASE_PASSWORD);
  return `postgresql://postgres:${password}@db.${projectRef}.supabase.co:5432/postgres`;
}

async function main() {
  const migrationFiles = [
    '001_kara_memory.sql',
    '002_auth_profiles.sql',
    '003_security_and_storage.sql',
    '004_lesson_detail_indexes.sql',
    '005_oauth_connections.sql',
    '006_oauth_drive_folder.sql',
    '007_social_publish_jobs.sql',
    '008_social_publish_platform.sql',
    '009_render_worker_jobs.sql',
    '010_catalog.sql'
  ];
  const client = new Client({
    connectionString: getConnectionString(),
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000
  });

  await client.connect();
  try {
    for (const fileName of migrationFiles) {
      const sql = await fs.readFile(path.join(rootDir, 'migrations', fileName), 'utf8');
      await client.query(sql);
      console.log(`Applied ${fileName}`);
    }
    if (process.env.DEV_USER_ID) {
      await client.query(
        `insert into profiles (id, display_name)
         values ($1, 'Dev User')
         on conflict (id) do update set display_name = excluded.display_name`,
        [process.env.DEV_USER_ID]
      );
    }
    console.log('Supabase schema applied.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
