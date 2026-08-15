-- "Kart" bolumu icin kalici sohbet gecmisi (sidebar'da listelenebilsin diye).
create table if not exists card_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  cards jsonb not null default '[]'::jsonb,
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists card_sessions_user_id_updated_at_idx
  on card_sessions(user_id, updated_at desc);

alter table card_sessions enable row level security;
