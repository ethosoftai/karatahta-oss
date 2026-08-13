-- BullMQ owns delivery/leases; this table is the API-visible audit record.
create table if not exists render_worker_jobs (
  id uuid primary key default gen_random_uuid(),
  generation_job_id uuid not null references generation_jobs(id) on delete cascade,
  lesson_id uuid not null references lessons(id) on delete cascade,
  segment_id uuid references lesson_segments(id) on delete set null,
  segment_index int not null check (segment_index >= 0),
  queue_job_id text unique,
  status text not null default 'queued' check (status in ('queued', 'leased', 'running', 'done', 'failed')),
  worker_id text,
  attempt int not null default 0,
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (generation_job_id, segment_index)
);

create index if not exists render_worker_jobs_status_created_idx
  on render_worker_jobs(status, created_at);

alter table render_worker_jobs enable row level security;
