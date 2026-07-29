-- Kara Tahta verileri yalnız backend üzerinden erişilir.
-- Backend, Supabase secret/service-role anahtarıyla RLS'yi güvenli biçimde aşar.
-- Anon ve authenticated istemciler için doğrudan tablo politikası tanımlanmaz.

alter table profiles enable row level security;
alter table lessons enable row level security;
alter table lesson_plans enable row level security;
alter table lesson_segments enable row level security;
alter table speech_scripts enable row level security;
alter table tts_outputs enable row level security;
alter table manim_codes enable row level security;
alter table video_renders enable row level security;
alter table lesson_videos enable row level security;
alter table attachments enable row level security;
alter table chats enable row level security;
alter table chat_messages enable row level security;
alter table generation_jobs enable row level security;
alter table generation_events enable row level security;

-- Mevcut pipeline'ın kullandığı bucket'lar private oluşturulur.
insert into storage.buckets (id, name, public, allowed_mime_types)
values
  ('videos', 'videos', false, array['video/mp4']),
  ('audio', 'audio', false, array['audio/mpeg', 'audio/mp3']),
  ('attachments', 'attachments', false, array['image/*'])
on conflict (id) do update
set
  public = excluded.public,
  allowed_mime_types = excluded.allowed_mime_types;
