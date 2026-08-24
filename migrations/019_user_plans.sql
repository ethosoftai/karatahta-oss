-- Subscription plan + generation quota per user. Only "free_trial" is a
-- functional plan for now (no tax certificate yet to accept payment); paid
-- plan ids are reserved here so the schema doesn't need to change when
-- billing is turned on.
create table if not exists user_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references profiles(id) on delete cascade,
  plan_id text not null default 'free_trial',
  video_quota integer not null default 2,
  card_quota integer not null default 2,
  videos_used integer not null default 0,
  cards_used integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table user_plans enable row level security;

-- Atomically ensures a plan row exists, then checks + consumes one unit of
-- the requested quota kind ('video' or 'card') under a row lock so
-- concurrent requests from the same user can't both slip past the limit.
create or replace function consume_user_plan_quota(p_user_id uuid, p_kind text)
returns table (
  allowed boolean,
  plan_id text,
  videos_used integer,
  video_quota integer,
  cards_used integer,
  card_quota integer
)
language plpgsql
as $$
declare row user_plans;
begin
  insert into user_plans (user_id) values (p_user_id)
    on conflict (user_id) do nothing;

  select t.* into row from user_plans t where t.user_id = p_user_id for update;

  if p_kind = 'video' then
    if row.videos_used < row.video_quota then
      update user_plans t set videos_used = t.videos_used + 1, updated_at = now()
        where t.user_id = p_user_id returning t.* into row;
      return query select true, row.plan_id, row.videos_used, row.video_quota, row.cards_used, row.card_quota;
    end if;
    return query select false, row.plan_id, row.videos_used, row.video_quota, row.cards_used, row.card_quota;
  elsif p_kind = 'card' then
    if row.cards_used < row.card_quota then
      update user_plans t set cards_used = t.cards_used + 1, updated_at = now()
        where t.user_id = p_user_id returning t.* into row;
      return query select true, row.plan_id, row.videos_used, row.video_quota, row.cards_used, row.card_quota;
    end if;
    return query select false, row.plan_id, row.videos_used, row.video_quota, row.cards_used, row.card_quota;
  else
    raise exception 'Unknown quota kind: %', p_kind;
  end if;
end;
$$;
