-- Generic social publisher queue. The payload belongs to the application:
-- it contains an HTTPS videoUrl plus title/caption/platforms, so the worker
-- never needs Kara Tahta lesson or storage tables.
create table if not exists publish_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_ref text,
  status text not null default 'queued' check (status in ('queued', 'processing', 'done', 'failed')),
  payload jsonb not null,
  results jsonb not null default '{}'::jsonb,
  error text,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists publish_jobs_status_created_idx on publish_jobs(status, created_at);
create index if not exists publish_jobs_owner_created_idx on publish_jobs(owner_ref, created_at desc);
alter table publish_jobs enable row level security;

-- `FOR UPDATE SKIP LOCKED` makes this safe when the publisher has multiple replicas.
create or replace function claim_publish_job()
returns publish_jobs
language plpgsql
as $$
declare claimed publish_jobs;
begin
  with candidate as (
    select id from publish_jobs where status = 'queued'
    order by created_at asc for update skip locked limit 1
  )
  update publish_jobs job set
    status = 'processing', attempts = job.attempts + 1,
    started_at = now(), updated_at = now(), error = null
  from candidate where job.id = candidate.id
  returning job.* into claimed;
  return claimed;
end;
$$;
