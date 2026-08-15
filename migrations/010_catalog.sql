-- Netflix tarzi "Katalog" bolumu: herkese acik/ozel ders listeleme ve poster.
alter table lessons
  add column if not exists is_public boolean not null default false;

alter table lesson_videos
  add column if not exists poster_storage_path text;

create index if not exists lessons_public_catalog_idx
  on lessons(is_public, updated_at desc)
  where is_public = true;
