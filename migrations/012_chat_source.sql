-- Karatahta ders sohbetlerini ("lesson") Katalog'da "Open in chat" ile
-- acilan sohbetlerden ("catalog") ayirt etmek icin. Katalog sidebar gecmisi
-- yalniz source='catalog' olanlari listeler; Karatahta bolumu chats.source'a
-- hic bakmiyor (kendi ders listesini dogrudan lessons tablosundan cekiyor).
alter table chats
  add column if not exists source text not null default 'lesson';

alter table chats
  drop constraint if exists chats_source_check;

alter table chats
  add constraint chats_source_check check (source in ('lesson', 'catalog'));
