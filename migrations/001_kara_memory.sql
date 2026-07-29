create extension if not exists pgcrypto;

create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  display_name text not null default 'Dev User',
  created_at timestamptz not null default now()
);

create table if not exists lessons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  topic text,
  student_level text,
  target_minutes int,
  target_segment_count int,
  status text not null default 'created',
  source_type text not null default 'topic',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists lesson_plans (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references lessons(id) on delete cascade,
  provider text,
  model text,
  prompt text,
  plan_json jsonb not null,
  raw_response text,
  created_at timestamptz not null default now()
);

create table if not exists lesson_segments (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references lessons(id) on delete cascade,
  segment_key text not null,
  title text,
  duration_seconds numeric,
  learning_objective text,
  narration text,
  animation_json jsonb,
  order_index int not null,
  status text not null default 'planned',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lesson_id, segment_key)
);

create table if not exists speech_scripts (
  id uuid primary key default gen_random_uuid(),
  segment_id uuid not null references lesson_segments(id) on delete cascade,
  provider text,
  model text,
  speech_json jsonb not null,
  speech_text text,
  cue_plan jsonb,
  duration_seconds numeric,
  created_at timestamptz not null default now()
);

create table if not exists tts_outputs (
  id uuid primary key default gen_random_uuid(),
  segment_id uuid not null references lesson_segments(id) on delete cascade,
  provider text not null default 'google_cloud',
  voice_name text,
  speaking_rate numeric,
  duration_seconds numeric,
  storage_path text,
  public_url text,
  created_at timestamptz not null default now()
);

create table if not exists manim_codes (
  id uuid primary key default gen_random_uuid(),
  segment_id uuid references lesson_segments(id) on delete set null,
  provider text,
  model text,
  code text not null,
  attempt int not null default 1,
  is_repair boolean not null default false,
  repair_reason text,
  render_error text,
  created_at timestamptz not null default now()
);

create table if not exists video_renders (
  id uuid primary key default gen_random_uuid(),
  segment_id uuid references lesson_segments(id) on delete set null,
  manim_code_id uuid references manim_codes(id) on delete set null,
  quality text,
  status text not null default 'done',
  video_storage_path text,
  local_video_path text,
  audio_storage_path text,
  background_music_path text,
  duration_seconds numeric,
  stdout text,
  stderr text,
  created_at timestamptz not null default now()
);

create table if not exists lesson_videos (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references lessons(id) on delete cascade,
  status text not null default 'done',
  video_storage_path text,
  local_video_path text,
  duration_seconds numeric,
  segment_render_ids uuid[],
  created_at timestamptz not null default now()
);

create table if not exists attachments (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid references lessons(id) on delete cascade,
  chat_message_id uuid,
  user_id uuid not null references profiles(id) on delete cascade,
  type text not null,
  mime_type text,
  storage_path text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create table if not exists chats (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references lessons(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (lesson_id, user_id)
);

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references chats(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  timestamp_seconds numeric,
  timestamp_label text,
  frame_attachment_id uuid references attachments(id) on delete set null,
  model text,
  provider text,
  context_json jsonb,
  created_at timestamptz not null default now()
);

alter table attachments
  drop constraint if exists attachments_chat_message_id_fkey;

alter table attachments
  add constraint attachments_chat_message_id_fkey
  foreign key (chat_message_id) references chat_messages(id) on delete set null;

create table if not exists generation_jobs (
  id uuid primary key default gen_random_uuid(),
  app_job_id text unique,
  lesson_id uuid references lessons(id) on delete cascade,
  status text not null default 'queued',
  progress int not null default 0,
  total int not null default 0,
  current text,
  message text,
  error text,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists generation_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references generation_jobs(id) on delete cascade,
  lesson_id uuid references lessons(id) on delete cascade,
  segment_id uuid references lesson_segments(id) on delete set null,
  level text not null default 'info',
  message text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists lessons_user_id_created_at_idx on lessons(user_id, created_at desc);
create index if not exists lesson_segments_lesson_order_idx on lesson_segments(lesson_id, order_index);
create index if not exists chat_messages_chat_created_idx on chat_messages(chat_id, created_at);
create index if not exists generation_events_lesson_created_idx on generation_events(lesson_id, created_at desc);
