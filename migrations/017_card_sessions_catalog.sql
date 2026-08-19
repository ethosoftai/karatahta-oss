-- Kart oturumlarini (Manim yerine KaTeX/HTML render'a gecisten sonra) ayri
-- bir "Kartlar" katalogunda herkese acik gosterebilmek icin.
alter table card_sessions
  add column if not exists is_public boolean not null default false;

create index if not exists card_sessions_public_catalog_idx
  on card_sessions(is_public, updated_at desc)
  where is_public = true;
