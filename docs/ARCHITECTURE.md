# Mimari

Kara Tahta backend'inin bileşenleri, ders üretim pipeline'ı ve çalışma zamanı davranışı.

## Bileşenler

| Parça | Teknoloji |
| --- | --- |
| API | Node.js + Express (`server.js`) |
| Render kuyruğu | Redis + BullMQ, ayrı `render-worker` süreçleri |
| Frontend | Vite tabanlı ayrı bir uygulama (bu repoda değil) |
| Auth ve ilişkisel veri | Supabase |
| Kalıcı binary medya | S3 uyumlu private bucket (ör. Railway Bucket) |

## Üst seviye mimari

```text
Vite frontend
  │
  └─ HTTPS + Bearer token
       ↓
Railway / Express (server.js)
  ├─ Supabase Auth
  ├─ Supabase Postgres
  │    ├─ profiles / lessons / plans / segments
  │    ├─ speech / TTS / Manim / render metadata
  │    └─ chats / messages / jobs / events
  ├─ DeepSeek V4 Flash
  │    └─ OpenAI uyumlu Chat Completions API
  ├─ TTS
  │    ├─ Edge TTS
  │    └─ opsiyonel Google Cloud TTS
  ├─ Redis + BullMQ
  │    └─ kalıcı render iş kuyruğu
  ├─ Render worker (ayrı Railway service)
  │    ├─ Manim 0.20.1 + FFmpeg
  │    └─ Bucket'a 720p/30 FPS segment MP4
  ├─ API finalizer
  │    └─ worker segmentlerini Bucket'tan indirip final MP4'e birleştirir
  ├─ Social publish worker (ayrı Railway service)
  │    └─ YouTube/Instagram yayın işleri
  └─ Railway Bucket
       ├─ final video
       ├─ segment video/ses
       └─ chat/soru ekleri
```

Supabase Storage production mimarisinin parçası değildir. Supabase yalnız
Auth ve Postgres için; video, ses ve ek gibi binary dosyalar Railway Bucket
içindir.

## Güncel ders üretim pipeline'ı

1. Frontend `POST /api/generate-lesson` gönderir.
2. Backend kullanıcıyı doğrular ve Supabase'de ders kaydını oluşturur.
3. `STREAMING_PLAN_FIRST_SEGMENT=true` ise DeepSeek JSON akışından tamamlanan
   her segment anında çıkarılıp job'a verilir; pipeline tam planın bitmesini
   beklemeden sonraki segmentlerin hazırlığına başlar.
4. Streaming segment narration'ı uygunsa speech script yeniden LLM çağrısı
   yapılmadan hazırlanır. TTS, Manim kod üretimi ve uygun işler concurrency
   limitlerine göre yürür.
5. API her hazırlanmış segment için Supabase'de `render_worker_jobs` audit
   kaydı oluşturur ve Redis/BullMQ kuyruğuna kalıcı kimliklerle iş bırakır.
6. Ayrı `render-worker` service Manim + FFmpeg'i çalıştırır, segment MP4'ünü
   Railway Bucket'a yükler ve audit kaydını `done`/`failed` olarak günceller.
7. API worker sonucunu bekler, Bucket'tan segmenti indirir ve final birleştirme
   için geçici olarak tutar; ağır Manim işlemi API process'inde çalışmaz.
8. Shadow modda veya legacy render'da `PROGRESSIVE_MANIM_PARTIALS=true` ise collector yalnız kapanmış ve
   `ffprobe` doğrulamasından geçmiş MP4 parçalarını sıralı fMP4 partial olarak
   job manifestine ekler.
9. Job güncellemeleri SSE ile `/api/jobs/:id/events` üzerinden gönderilir.
   Frontend manifesti ve authenticated partial endpointlerini kullanarak
   tampon hedefi dolduğunda oynatmayı başlatır.
10. Segmentler tamamlanınca API bütün
   segmentler final MP4'e birleştirilir ve faststart uygulanır.
11. Segment/final medya Railway Bucket'a yüklenir. Supabase'e yalnız metadata
   ve `railway://...` storage path yazılır.
12. Geçmişten erişimde backend sahipliği kontrol eder ve kısa ömürlü signed S3
    URL üretir.

Progressive parçalar kullanıcı geçmişinin kalıcı videosu değildir. Bunlar
Railway instance diskinde geçicidir ve `PROGRESSIVE_ARTIFACT_TTL_MS` sonunda
temizlenir. Kalıcı sonuç Railway Bucket'taki final videodur.

## Dağıtık render worker

Mimari API →
Redis/BullMQ → 1..N private `render-worker` service → Railway Bucket +
Supabase'dir. Her worker `PROCESS_ROLE=render-worker` ve
`RENDER_CONCURRENCY=1` ile yalnız bir ağır render çalıştırmalıdır.

`migrations/009_render_worker_jobs.sql` uygulanmıştır. Execute modda
`RENDER_QUEUE_ENABLED=true` ve `RENDER_WORKER_SHADOW_MODE=false` olmalıdır:
API lokal render yapmaz; worker sonucu Bucket'a yazar, API final birleştirmeyi
yapar. Shadow mod (`true`) yalnız queue teslimatını kontrol eder ve aynı
segmenti API ile worker'da iki kez render edebilir; production execute modunda
kullanılmamalıdır.

Worker'lar aynı instance'ta child process olarak değil, Railway canvas'ta aynı
repo kaynaklı **ayrı service/container** olarak oluşturulmalıdır. Böylece her
worker kendi CPU/RAM limitine sahip olur; API'nin HTTP/SSE süreci Manim'in
resource spike'larından ayrılır.

### Railway değişkenleri ve rollout

API ve render worker'da ortak olarak şunlar tanımlı olmalıdır:

```dotenv
RENDER_QUEUE_ENABLED=true
REDIS_URL=${{Redis.REDIS_URL}}
RENDER_WORKER_SHADOW_MODE=false
RENDER_CONCURRENCY=1
PROCESS_ROLE=render-worker # yalnız render worker service'te
```

Render worker ayrıca API'nin `SUPABASE_URL`, `SUPABASE_SECRET_KEY` ve Railway
Bucket `MEDIA_S3_*` değişkenlerine referans vermelidir. Railway ücretsiz planı
bu projede tek render worker service'i ile sınırlı kaldı; plan yükseltilirse
ayrı service eklemek yerine aynı `render-worker` service'ini 2--4 replica'ya
ölçeklemek tercih edilir.

### Örnek ölçüm

Pisagor Teoremi için hedefi 1.5 dakika olan bir video tek worker ile yaklaşık
1 dakika 40 saniyede üretildi (iki segment ~23 sn ve ~26 sn, final birleştirme
~24 sn). Worker sayısı arttıkça render bölümü paralelleşir. Worker audit
kayıtları `render_worker_jobs` tablosundan takip edilir.

## Önemli runtime sınırlamaları

- Aktif job nesneleri ve SSE event geçmişi `fullVideoJobs` içinde bellekte
  tutulur; tamamlanan kayıtlar TTL sonunda temizlenir.
- Progressive partial dosyalar instance'ın geçici diskindedir.
- Railway restart/deploy sırasında canlı partial tamponu kaybolur. Frontend
  polling'e düştüğünde backend Supabase'deki lesson planını bulur ve yarım
  job'ı aynı uygulama job kimliğiyle güvenli biçimde baştan kuyruğa alır.
- API/SSE job state'i hâlâ `fullVideoJobs` belleğinde olduğundan API için
  `numReplicas: 1` korunmalıdır. Render worker ise Redis üzerinden yatay
  ölçeklenebilir; her replica yalnız `RENDER_CONCURRENCY=1` çalıştırmalıdır.
- `RENDER_CONCURRENCY` aynı process içindeki paralel Manim sayısını belirler;
  Railway replica sayısı değildir. **CPU/RAM ölçmeden yükseltilmemelidir** —
  Railway servisi `"plan": "trial"` üzerinde (`railway status --json` içindeki
  deployment meta'sında görülür), yani vCPU/RAM kısıtlı ve paylaşımlıdır.
  `RENDER_CONCURRENCY=3` denendiğinde eşzamanlı Manim process'lerinden biri
  `exit code: null` ile öldürüldü (muhtemel OOM kill) ve o sırada mux eden
  başka bir segmentin ffmpeg'i kaynak açlığından hata verdi. Değer şu an
  `2`'de; production smoke testinde birden fazla render sırasında Manim
  süreçleri Python traceback üretmeden `exit code: null` ile sonlandı. Bu
  nedenle güvenli varsayılan `1`'dir; CPU/RAM ölçümü olmadan yükseltmeyin.
  Worker renderer `SIGKILL`/timeout/exit-code'suz kapanmayı kod hatası değil altyapı
  hatası sayar ve LLM kod onarımı denemez.
- Segmentler artık **paralel render edilir** (sıra sırayla değil): bir
  segmentin render'ı yalnız bir önceki segmentin *kodu*na bağlıdır (continuity
  için, `codeDeferreds`), render'ına değil. `PROGRESSIVE_MANIM_PARTIALS=true`
  iken bu, canlı akışın sırasını bozmaz — `server.js` içindeki
  `drainProgressiveGate`/`enqueueGatedPartial`/`markSegmentProgressiveDone`
  segmentlerin normalize ettiği partial'ları gerçek sırayla (job'a bağlı
  `_progressiveGate`) yayınlar, render bitiş sırasından bağımsız olarak. Bu
  gate mekanizmasını bozmadan render loop'una dokunmayın; aksi halde partial
  sequence/startSeconds/id/url yanlış hesaplanır veya `"Progressive partial
  sirasi bozuk"` hatası atılır.
- Railway filesystem kalıcı depolama olarak kullanılmaz. Yalnız geçici
  render/work dosyaları burada kalabilir; final sonuç bucket'a yazılmalıdır.

## Katalog (Netflix tarzı) bölümü

`lessons.is_public` ve `lesson_videos.poster_storage_path` (bkz.
`migrations/010_catalog.sql`) katalog için eklendi. Final video pipeline'ı
artık her tamamlanmış derste otomatik olarak videonun 1. saniyesinden bir
poster JPEG'i çıkarıp (`services/videoThumbnail.js`, `services/frameExtractor.js`
üzerinden ffmpeg) Bucket'a yükler; `saveLessonVideo` bu yolu
`poster_storage_path` olarak kaydeder. Poster üretimi hata verirse final
video teslimatını bloklamaz (best-effort).

`GET /api/catalog` `is_public=true` işaretli dersleri (auth gerekmez),
`GET /api/catalog/mine` giriş yapan kullanıcının kendi tamamlanmış derslerini
döner; ikisi de yalnız `lesson_videos.status='done'` olan dersleri listeler.
Video oynatma her zaman ayrı, kısa ömürlü signed URL veren bir endpoint'ten
gelir (`/api/catalog/:id/video-url` veya kullanıcı sahipse `/api/lessons/:id/video-url`) —
Bucket private kalmaya devam eder.

Hazır (elde bulunan) videoları kataloğa eklemek için:

```bash
node scripts/import_catalog_video.js --file ./ders.mp4 --title "Pisagor Teoremi" \
  --topic "Matematik" --user-id <profileId> --public
```

`--public` verilmezse ders yalnız o kullanıcının özel katalog sekmesinde
görünür.

## Kart bölümü ve Instagram carousel

`routes/cards.js` + `services/cardsEngine.js`: bir prompt/soru/soru fotoğrafından
(Gemini vision ile transkript) sırayla 2-4 kart (DeepSeek metin + Manim still PNG)
üretir, `card_sessions` tablosuna kalıcı olarak kaydeder (`migrations/011_card_sessions.sql`).
Kartlar üretildikten sonra `POST /api/cards/ask` ile ask-kara tarzı normal bir
takip sohbeti sürer.

`POST /api/cards/sessions/:id/publish-instagram` bir oturumun kart görsellerini
(2-10 adet) Instagram carousel olarak yayınlar. Instagram'ın Content Publishing
API'si `image_url` için yalnız JPEG kabul eder; kart still'leri PNG olduğundan
her görsel önce indirilip `services/imageConvert.js` (ffmpeg) ile JPEG'e
çevrilir, ayrı bir storage path'e yeniden yüklenir, imzalı URL üretilir, sonra
`services/instagramPublish.js:publishCarouselToInstagram` ile yayınlanır.

## Zamanlanmış içerik üretimi (scheduler)

`services/scheduler.js` Kara Tahta'ya özel opsiyonel bir otomasyondur,
`karatahta-social-publisher` worker'ı (`workers/socialPublisher.js`) içinde
ayrı bir döngü olarak çalışır -- worker hem genel `publish_jobs` kuyruğunu
tüketir hem de bu döngüyü başlatır. (Ayrı bir `karatahta-scheduler` servisi
değerlendirildi ama Railway trial planının servis sağlama limiti 5. servise
izin vermedi; social-publisher hiçbir zaman birden fazla replikaya
çıkarılmadığı sürece embedded kalması güvenlidir -- ölçeklenirse
`setInterval` tick'i her replikada ayrı çalışıp aynı işi birden fazla kez
tetikleyebilir.) Etkinleştirildiğinde, kendi aralığında
(`interval_minutes`) `scheduler_jobs` tablosundaki (`migrations/013_content_scheduler.sql`,
`migrations/014_combo_scheduler.sql`) iş türlerinden hangisi zamanı gelmişse
tetikler:

- `cards_carousel`: `POST /api/cards/generate` ile kart üretir, ardından
  `POST /api/cards/sessions/:id/publish-instagram` ile carousel yayınlar.
- `lesson_video`: `POST /api/generate-lesson` ile tam ders videosu başlatır,
  `GET /api/jobs/:id` ile bitene kadar polling yapar, sonra
  `POST /api/social-publish` ile YouTube + Instagram'a (`privacy_status: public`)
  yayınlar. Varsayılan 8 segment/10 dakikalık "konu anlat" uzunluğu tek
  trial-plan render-worker replikasını fazlasıyla zorlayıp gerçekten
  başarısız olduğu için (canlıda doğrulandı: segment'ler 5-6 kat yavaşladı,
  final concat OOM-kill'le sessizce öldü), zamanlanmış çalıştırmalar
  `SCHEDULER_VIDEO_SEGMENT_COUNT`/`SCHEDULER_VIDEO_MINUTES` (varsayılan 3
  segment / 3.5 dakika) ile kasıtlı olarak kısa tutulur.
- `combo`: aynı fikirle önce `lesson_video` adımını çalıştırır, `SCHEDULER_COMBO_GAP_MS`
  (varsayılan 10 dakika) bekler, sonra aynı fikirle `cards_carousel` adımını
  çalıştırır — yani aynı konu için önce video (YouTube + Instagram Reel),
  birkaç dakika sonra da kart carousel'i (Instagram) ayrı bir post olarak gider.
  Önerilen tekil kullanım şekli budur; `cards_carousel`/`lesson_video` ayrı
  ayrı da açılabilir ama bağımsız cursor/interval'leriyle farklı konulara denk gelebilirler.

Fikirler Railway Bucket'ta `system/content_pool.txt` dosyasından (satır başına
bir konu/soru) sırayla, iş türü başına ayrı bir cursor (`scheduler_jobs.content_pool_cursor`)
ile çekilir ve liste bitince başa sarılır (`combo` kendi cursor'unu kullanır,
adımları aynı fikri paylaşır). Dosyayı `GET`/`PUT /api/scheduler/content-pool`
ile okuyup değiştirebilirsiniz (`PUT` body: `{ "text": "konu 1\nkonu 2\n..." }`).

Worker, kendi API'sine sıradan bir istemci gibi HTTP ile istek atar
(`BACKEND_INTERNAL_URL`), gerçek bir kullanıcı oturumu olmadığı için
`X-Scheduler-Token: $SCHEDULER_INTERNAL_TOKEN` header'ıyla kimlik kanıtlar;
backend bu token'ı doğrularsa isteği `SCHEDULER_USER_ID` profiline ait sayar
(`services/requestAuth.js`). Bu üç değişken (`BACKEND_INTERNAL_URL`,
`SCHEDULER_INTERNAL_TOKEN`, `SCHEDULER_USER_ID`) hem `karatahta-backend` hem
`karatahta-social-publisher` servisinde aynı olmalıdır; biri eksikse scheduler
döngüsü hiç başlamaz (log: "BACKEND_INTERNAL_URL veya SCHEDULER_INTERNAL_TOKEN
tanimli degil").

Varsayılan olarak iki iş de kapalıdır (`enabled=false`). Açmak/kapatmak ve
sıklığı değiştirmek için:

```bash
curl -X POST $API_URL/api/scheduler/start \
  -H 'Authorization: Bearer <token>' -H 'Content-Type: application/json' \
  -d '{"job_type":"cards_carousel","interval_minutes":1440}'

curl -X POST $API_URL/api/scheduler/stop \
  -H 'Authorization: Bearer <token>' -H 'Content-Type: application/json' \
  -d '{"job_type":"lesson_video"}'
```

`GET /api/scheduler/status` her iki işin `enabled`, `interval_minutes`,
`next_run_at`, `last_run_at`, `last_status`, `last_error` ve `last_result`
alanlarını döner.

## DeepSeek istemcisi

Backend, OpenAI SDK ile `https://api.deepseek.com` Chat Completions endpoint'ini
kullanır. Plan ve kod çağrıları `deepseek-v4-flash`, thinking modu ve `high`
reasoning effort ile yapılır. LLM JSON hataları `llmJson.js` tarafından
temizlenip onarılmaya çalışılır.

## Repo haritası

```text
server.js                         Express endpointleri ve pipeline orkestrasyonu
services/
├── streamingPlan.js              stream içinden ilk segmenti çıkarma
├── llmJson.js                    JSON temizleme/repair
├── edgeTts.js                    Edge TTS işlemleri
├── manimSanitizer.js             üretilen Manim kodu güvenlik/uyumluluk
├── progressiveManim.js           partial collector, job event kanalı
├── videoPostprocess.js           video normalizasyon/faststart
├── renderQueue.js                Redis/BullMQ render queue sözleşmesi
├── workerManimRenderer.js        worker Manim + FFmpeg render işlemi
├── mediaStore.js                 Railway S3 veya legacy Supabase Storage
├── supabaseStore.js              Auth, Postgres ve persistence
├── videoThumbnail.js             final videodan katalog posteri üretme
├── frameExtractor.js             ffmpeg ile video karesi çıkarma
├── cardsEngine.js                Kart pipeline (DeepSeek + Manim still)
├── instagramPublish.js           Reels + carousel (Content Publishing API)
├── imageConvert.js               kart PNG'lerini Instagram için JPEG'e çevirir
├── contentPool.js                Railway Bucket'taki content_pool.txt okuma/yazma
├── scheduler.js                  zamanlanmış kart/ders üretim+yayın döngüsü
├── requestAuth.js                resolveRequestUser + scheduler internal token
└── karaContext.js                chat bağlamı
routes/
├── cards.js                      Kart section endpointleri
└── scheduler.js                  scheduler start/stop/status + content pool
scripts/
├── apply_supabase_schema.js
├── configure_railway_bucket_cors.js
├── import_catalog_video.js       hazır videoyu Katalog'a (lesson + poster) ekler
└── migrate_supabase_media_to_railway.js
migrations/                       Supabase SQL şeması
workers/renderWorker.js           ayrı render worker giriş noktası
workers/socialPublisher.js        Genel publish_jobs tüketicisi (YouTube/Instagram/TikTok) + scheduler döngüsü
test/                             Node testleri
Dockerfile                        Node + Python + Manim + FFmpeg image
railway.json                      Amsterdam ve replica ayarı
```

Ek belgeler:

- [DEPLOYMENT.md](../DEPLOYMENT.md): Railway deployment ve CLI fallback
- [SUPABASE_SETUP.md](../SUPABASE_SETUP.md): Supabase migration/Auth kurulumu
- [AUTH_EMAIL_SETUP.md](../AUTH_EMAIL_SETUP.md): e-posta/SMTP ve template'ler
- [sistem.md](../sistem.md): planlayıcı ve kod üretici sistem promptları
