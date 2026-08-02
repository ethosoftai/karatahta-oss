-- Stores provider OAuth refresh tokens (e.g. Google Drive access) separately
-- from `profiles` so a `select('*')` on profiles (used by GET /api/auth/me,
-- which returns the profile to the client) can never accidentally leak a
-- refresh token to the frontend.
create table if not exists oauth_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  provider text not null,
  refresh_token text not null,
  scope text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

alter table oauth_connections enable row level security;

create index if not exists oauth_connections_user_provider_idx on oauth_connections(user_id, provider);
