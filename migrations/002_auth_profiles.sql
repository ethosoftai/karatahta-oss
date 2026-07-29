alter table profiles
  add column if not exists email text,
  add column if not exists avatar_url text,
  add column if not exists last_seen_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists profiles_auth_user_id_idx on profiles(auth_user_id);
create index if not exists profiles_email_idx on profiles(email);
