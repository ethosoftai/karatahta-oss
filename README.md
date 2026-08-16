# Kara Tahta Backend

Kara Tahta'nın Express API, kullanıcı/veri katmanı ve yapay zekâ video üretim
servisidir. DeepSeek ile plan ve Manim kodu üretir, Edge/Google TTS ile
seslendirir, Manim + FFmpeg ile videoyu oluşturur ve kalıcı medyayı private
Railway Bucket'a yazar.

## Canlı sistem ve repolar

| Parça | Adres / repo |
| --- | --- |
| Production API | `https://api.example.com` |
| Backend repo | `https://github.com/ethosoftai/karatahta-backend` |
| Production branch | `feature/redis-render-workers` (13 Ağustos 2026 itibarıyla) |
| Railway project | `<railway-project>` |
| Railway services | `karatahta-backend`, `karatahta-render-worker-2`, `karatahta-social-publisher`, `Redis` |
| Railway region | `europe-west4-drams3a` (Amsterdam), 1 replica |
| Frontend | `https://frontend.example.com` (Cloudflare Workers) |
| Frontend repo | `https://github.com/ethosoftai/karatahta-frontend` (`checkpoint-9`) |
| Frontend (legacy) | `https://karatahta.ethosoft.org` (hosting/cPanel; Google OAuth artık bu domaine dönmüyor, bkz. `AUTH_REDIRECT_URL`) |
| Auth ve ilişkisel veri | Supabase |
| Kalıcı binary medya | Private Railway Bucket, S3-compatible API |

**Railway servisinin deploy ettiği branch sabit değildir** — Railway proje
geçmişinde birden fazla `checkpoint-N` branch'i var (bazıları bu reponun farklı
soylarına ait, ör. HTML/Remotion render motoru denemeleri) ve hangisinin
deploy edildiği zamanla değişti (`checkpoint-4` → `checkpoint-5` →
`checkpoint-9` bu session içinde). **Varsayım yapmadan önce her zaman**
`railway deployment list --service <service> --json` ile Railway'in şu an gerçekten hangi
branch'i deploy ettiğini doğrulayın; bu README'deki tablo değeri elle
güncellenir ve eskiyebilir. Branch'i değiştirmek için:

```bash
railway service source connect --repo ethosoftai/karatahta-backend --branch <branch> --service karatahta-backend
```

Değişiklikleri push etmeden önce hedef branch'in gerçekten Railway'in şu an
deploy ettiği branch'in atası olduğunu (`git merge-base` ile) doğrulayın;
aksi halde push edilen kod hiç deploy olmaz veya farklı bir kod ailesine
karışır.

## Üst seviye mimari

```text
hosting/cPanel Vite frontend
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

`services/scheduler.js`, `karatahta-social-publisher` worker'ı (`workers/socialPublisher.js`)
içinde ayrı bir döngü olarak çalışır. Etkinleştirildiğinde, kendi aralığında
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
curl -X POST https://api.example.com/api/scheduler/start \
  -H 'Authorization: Bearer <token>' -H 'Content-Type: application/json' \
  -d '{"job_type":"cards_carousel","interval_minutes":1440}'

curl -X POST https://api.example.com/api/scheduler/stop \
  -H 'Authorization: Bearer <token>' -H 'Content-Type: application/json' \
  -d '{"job_type":"lesson_video"}'
```

`GET /api/scheduler/status` her iki işin `enabled`, `interval_minutes`,
`next_run_at`, `last_run_at`, `last_status`, `last_error` ve `last_result`
alanlarını döner.

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

## Dağıtık render worker (canlı)

`feature/redis-render-workers` branch'i production'da aktiftir. Mimari API →
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

### Doğrulanmış production ölçümü

13 Ağustos 2026 smoke testinde Pisagor Teoremi için hedefi 1.5 dakika olan
video 91.9 saniye çıktı ve yaklaşık 1 dakika 40 saniyede üretildi. İki worker
segmenti tek worker üzerinde sırayla 23.3 sn ve 26.1 sn sürdü; final
birleştirme/Bucket aşaması yaklaşık 24 sn sürdü. Aynı iş iki worker replica ile
render bölümü paralelleşir. Worker audit kayıtları `render_worker_jobs`
tablosundan takip edilir.

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
workers/socialPublisher.js        YouTube/Instagram publish worker + scheduler döngüsü
test/                             Node testleri
Dockerfile                        Node + Python + Manim + FFmpeg image
railway.json                      Amsterdam ve replica ayarı
```

Ek belgeler:

- [DEPLOYMENT.md](./DEPLOYMENT.md): Railway deployment ve CLI fallback
- [SUPABASE_SETUP.md](./SUPABASE_SETUP.md): Supabase migration/Auth kurulumu
- [AUTH_EMAIL_SETUP.md](./AUTH_EMAIL_SETUP.md): e-posta/SMTP ve template'ler
- [sistem.md](./sistem.md): eski/genel sistem notları

## Gereksinimler ve local başlangıç

En tutarlı yöntem Docker'dır; image gerekli Node, Python, Manim, LaTeX,
Edge TTS ve FFmpeg bağımlılıklarını içerir.

```bash
git clone --branch railway https://github.com/ethosoftai/karatahta-backend.git
cd karatahta-backend
cp .env.example .env
# En az LLM ve local auth/depolama değerlerini doldur.
docker build -t karatahta-backend .
docker run --env-file .env -p 8080:8080 karatahta-backend
```

Kontrol:

```bash
curl http://localhost:8080/api/config
```

Native geliştirme:

```bash
npm ci
python -m venv .venv
source .venv/bin/activate
pip install manim==0.20.1 edge-tts==7.2.8
npm run dev
```

Backend `http://localhost:8080`, frontend varsayılan olarak
`http://localhost:3001` üzerinde çalışır.

## Ortam değişkenleri

Gerçek secret'ları `.env`, GitHub veya frontend Vite değişkenlerine
commit etmeyin. Production değerleri Railway > service > Variables
ekranında tutulur.

Production için secret içermeyen, doğrudan Railway Variables ekranına
aktarılabilecek tam şablon [railway.env.example](./railway.env.example)
dosyasındadır. Gerçek `.env` dosyası bilerek `.gitignore` içindedir ve
GitHub'a zorla eklenmemelidir.

### Sunucu ve güvenlik

| Değişken | Açıklama |
| --- | --- |
| `PORT=8080` | Railway'in yönlendireceği Express portu |
| `CORS_ORIGIN` | Virgülle ayrılmış güvenilen frontend origin'leri |
| `AUTH_REQUIRED=true` | Production kullanıcı doğrulaması |
| `AUTH_REDIRECT_URL` | Supabase confirmation/OAuth/recovery dönüş URL'si |
| `GOOGLE_OAUTH_ENABLED` | Supabase Google provider hazırsa `true` |
| `GOOGLE_OAUTH_CLIENT_ID` | Google Drive'a kaydet için Google Cloud OAuth client ID (Supabase'deki ile aynı) |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Aynı OAuth client'ın secret'ı; backend bunu yalnız refresh token'ı Google ile değiştirmek için kullanır |
| `AUTH_PROFILE_CACHE_TTL_MS` | Auth profil cache süresi |
| `DEV_USER_ID` | Yalnız `AUTH_REQUIRED=false` local/demo modu |

`GOOGLE_OAUTH_CLIENT_ID` ve `GOOGLE_OAUTH_CLIENT_SECRET` ikisi de tanımlıysa
(ve `GOOGLE_OAUTH_ENABLED=true` ise) "Drive'a kaydet" özelliği açılır.
Kullanıcı `GET /api/auth/oauth/google-drive` ile ek `drive.file` scope'u ve
offline access isteyen ayrı bir Google OAuth turu başlatır; dönen
`provider_refresh_token` `POST /api/auth/google-drive-token` ile
`oauth_connections` tablosuna kaydedilir (bu tablo `profiles`'tan ayrı tutulur,
`GET /api/auth/me` gibi profil dönen endpoint'ler asla refresh token
içermez). `POST /api/lessons/:id/save-to-drive` bu refresh token'ı Google'ın
token endpoint'iyle değiştirip dersin final videosunu kullanıcının Drive'ına
yükler.

Önerilen CORS (production'da güncel değer -- `railway variables` ile
doğrulayın):

```env
CORS_ORIGIN=https://karatahta.ethosoft.org,http://localhost:3001,http://127.0.0.1:3001,https://frontend.example.com
```

`AUTH_REDIRECT_URL` şu an yalnız yeni frontend'i işaret eder
(`https://frontend.example.com/`) — Google OAuth/
şifre sıfırlama/e-posta onayı dönüşleri artık `karatahta.ethosoft.org`'a
gitmez. Bu tek bir sabit URL olduğundan aynı anda yalnız bir frontend OAuth
dönüşünü doğru alabilir; iki frontend'in aynı anda OAuth'u desteklemesi
gerekirse `authCallbackUrl` (`server.js`) isteğin `Origin` header'ını
`CORS_ORIGIN` allowlist'ine karşı doğrulayıp dinamik seçecek şekilde
değiştirilmelidir (bu henüz yapılmadı).

Supabase projesinin **Authentication → URL Configuration → Redirect URLs**
allowlist'inde de aynı frontend URL'si bulunmalıdır; yoksa Supabase
`redirectTo` parametresini yok sayıp kendi Site URL varsayılanına döner —
backend'deki `AUTH_REDIRECT_URL` doğru olsa bile.

### LLM

| Değişken | Açıklama |
| --- | --- |
| `LLM_PROVIDER` | Sabit değer: `deepseek` |
| `DEEPSEEK_API_KEY` | DeepSeek API anahtarı (`DEEPSEEK_API` da desteklenir) |
| `DEEPSEEK_BASE_URL` | Varsayılan: `https://api.deepseek.com` |
| `DEEPSEEK_PLAN_MODEL` | Plan modeli; varsayılan `deepseek-v4-flash`. Her zaman DeepSeek üzerinden çalışır |
| `DEEPSEEK_CODE_MODEL` | Manim/HTML segment kod modeli; varsayılan `deepseek-v4-flash`. Değer `gemini` ile başlıyorsa (ör. `gemini-2.5-pro`) istek DeepSeek yerine Gemini'nin OpenAI-uyumlu endpoint'ine (`GEMINI_OPENAI_BASE_URL`, `GEMINI_API_KEY`) yönlendirilir — bkz. `resolveLlmClient` (`server.js`) |
| `GEMINI_OPENAI_BASE_URL` | Gemini OpenAI-uyumlu endpoint override'ı; varsayılan `https://generativelanguage.googleapis.com/v1beta/openai/` |
| `DEEPSEEK_REASONING_EFFORT` | `high` veya `max` (yalnız DeepSeek çağrılarında; Gemini'ye yönlendirilen kod çağrılarında bu ve `thinking` alanı gönderilmez) |
| `DEEPSEEK_PIPELINE_THINKING` | Plan/speech/Manim kodu için thinking modu; düşük gecikme için `false` |
| `DEEPSEEK_REQUEST_TIMEOUT_MS` | İstek timeout'u; varsayılan `120000` |
| `GEMINI_API_KEY` | Kara'nın o anki video karesini incelemesi için Gemini API anahtarı |
| `KARA_VISION_MODELS` | Virgülle sıralı Kara görsel fallback havuzu; varsayılan `gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-2.5-flash-lite` (`KARA_VISION_MODEL` geriye uyumlu) |
| `GEMINI_REQUEST_TIMEOUT_MS` | Kara görsel istek timeout'u; varsayılan `45000` |
| `KARA_LIVE_MODEL` | Kara canlı sesli sohbet modeli; varsayılan `gemini-live-2.5-flash-preview-native-audio-09-2025` (`GEMINI_API_KEY` gerekir) |
| `KARA_LIVE_ENABLED` | `/api/kara-live`'ı acar; varsayilan `false` (maliyet nedeniyle kapali, `GEMINI_API_KEY` diger Kara ozelliklerinde kullanilmaya devam eder) |
| `LESSON_PREPROCESSOR_TIMEOUT_MS` | Ders on-isleme (soru foto transkripti + baslik/sure/temiz-prompt analizi, "json-deepseek") icin sert zaman siniri; varsayilan `5000`. Asilirsa yerel ozete (fallback) dusulur |

`GEMINI_API_KEY` tanımlıysa `/api/kara-live` WebSocket endpoint'i açılır: tarayıcı
mikrofon sesini canlı olarak Gemini Live API'ye aktarır, model sesli yanıt üretir.
Bu oturumda model `get_frame` (verilen saniyedeki gerçek video karesini ffmpeg ile
çıkarır), `web_search` ve `generate_manim` araçlarını çağırabilir. Video henüz
üretilmemişse `get_frame` "video hazır değil" yanıtı döner. Bağlantı, ilk mesaj
olarak `{"type":"auth","token":"...","lessonId":"..."}` gönderilmesini bekler;
ardından `{"type":"audio","data":"<base64 pcm16 16kHz>"}` ile ses akışı yapılır.

Kara soru-cevap gibi genel DeepSeek çağrıları thinking modu açık ve `high`
reasoning effort ile çalışır. Video üretim pipeline'ı düşük ilk-kare
gecikmesi için varsayılan olarak non-thinking modunda çalışır;
`DEEPSEEK_PIPELINE_THINKING=true` eski davranışı geri getirir.
Ana video üretim modeli metin tabanlıdır; soru fotoğrafı çözümü için soru metni
`Ek not` alanında verilmelidir. Video içi Kara soruları ise `GEMINI_API_KEY`
tanımlıysa sorunun sorulduğu gerçek video karesini Gemini'ye timestamp, ders
planı ve sohbet geçmişiyle birlikte gönderir. Görsel servis kullanılamazsa Kara
DeepSeek metin bağlamına düşer ve API yanıtında `visionUsed: false` döner.
Gemini 3 modellerinde Kara iki araç kullanabilir: güncel ve doğrulanabilir bilgi
için backend'in kendi çok sağlayıcılı `web_search` katmanı, öğrencinin istediği kavramı tek karelik Manim görseline
dönüştürmek için `generate_manim`. Manim çıktısı güvenli Python kontrolünden
geçer, attachments deposuna yüklenir ve Kara cevabında `artifacts` alanıyla
birlikte döner. Web kaynakları `sources`, kullanılan araçlar `toolsUsed` alanında
yer alır.

### TTS, Manim ve pipeline

| Değişken | Açıklama |
| --- | --- |
| `TTS_PROVIDER` | `edge` veya Google TTS |
| `EDGE_TTS_COMMAND`, `EDGE_TTS_VOICE`, `EDGE_TTS_RATE` | Edge ayarları |
| `EDGE_TTS_TIMEOUT_MS` | Takılan Edge TTS process'i için üst süre |
| `GOOGLE_*` | Opsiyonel Google Cloud TTS credential/voice |
| `MANIM_QUALITY=-qm` | 720p/30 FPS medium kalite |
| `MANIM_FONT` | Üretilen sahnelerin varsayılan fontu (Docker image'da bulunan güvenli varsayılan: `DejaVu Serif`) |
| `MANIM_ENABLE_MATHTEX` | LaTeX kullanım kontrolü |
| `STREAMING_PLAN_FIRST_SEGMENT=true` | Tam planı beklemeden ilk segmenti başlatır |
| `PROGRESSIVE_MANIM_PARTIALS=true` | Gerçek Manim partial canlı akışı |
| `PROGRESSIVE_BUFFER_SECONDS=18` | Oynatma öncesi hedef tampon; segment geçişleri için güvenli pay |
| `PROGRESSIVE_ARTIFACT_TTL_MS` | Geçici partial saklama süresi |
| `COMPLETED_JOB_TTL_MS` | Tamamlanmış job'ın bellekten silinme süresi |
| `LOCAL_MEDIA_SIGNING_SECRET` | Geçici lokal medya URL imza anahtarı |
| `TARGET_VIDEO_MINUTES` | Varsayılan hedef ders süresi |
| `TARGET_SEGMENT_COUNT` | Varsayılan plan segment sayısı |
| `SPEECH_VOLUME` | Final mux içindeki konuşma sesi seviyesi |
| `BACKGROUND_MUSIC_VOLUME` | Arka plan müziği seviyesi |
| `BACKGROUND_MUSIC_FADE_SECONDS` | Müzik giriş/çıkış fade süresi |
| `SPEECH_CONCURRENCY` | Speech hazırlama iş limiti |
| `TTS_CONCURRENCY` | Paralel TTS limiti |
| `CODE_CONCURRENCY` | Paralel Manim kod üretim limiti |
| `RENDER_CONCURRENCY=1` | Paralel Manim render limiti; trial ortamı için güvenli varsayılan |

### Supabase: Auth ve Postgres

| Değişken | Açıklama |
| --- | --- |
| `SUPABASE_URL` | Proje URL'si |
| `SUPABASE_PUBLISHABLE_KEY` | Auth için publishable key |
| `SUPABASE_SECRET_KEY` | Yalnız backend'de kullanılan secret key |
| `SUPABASE_DB_URL` | CLI migration için opsiyonel Postgres URL |
| `SUPABASE_SIGNED_URL_TTL_SECONDS` | Signed medya URL süresi |

Legacy projeler `SUPABASE_ANON_KEY` ve `SUPABASE_SERVICE_ROLE_KEY` alias'larını
destekler. `SUPABASE_PASSWORD` schema scriptinin bağlantı kurması gereken eski
kurulumlar içindir; `SUPABASE_STORAGE_PUBLIC` ise yalnız legacy Supabase
Storage yolunu etkiler. Railway Bucket production modunda public yapılmaz.
Secret/service-role key hiçbir zaman frontend'e verilmez.

Yeni Supabase projesinde SQL Editor'da sırayla:

1. `migrations/001_kara_memory.sql`
2. `migrations/002_auth_profiles.sql`
3. `migrations/003_security_and_storage.sql`
4. `migrations/004_lesson_detail_indexes.sql`
5. `migrations/005_oauth_connections.sql`
6. `migrations/006_oauth_drive_folder.sql`
7. `migrations/007_social_publish_jobs.sql`
8. `migrations/008_social_publish_platform.sql`
9. `migrations/009_render_worker_jobs.sql`
10. `migrations/010_catalog.sql`
11. `migrations/011_card_sessions.sql`
12. `migrations/012_chat_source.sql`
13. `migrations/013_content_scheduler.sql`
14. `migrations/014_combo_scheduler.sql`

çalıştırılmalıdır. Alternatif: `SUPABASE_DB_URL` tanımlayıp
`npm run supabase:schema`.

Migration'lar RLS'yi açar ve uygulama tablolarını doğrudan anon/authenticated
erişime kapalı tutar. Uygulama verisine backend secret key ile ulaşır.

### Railway Bucket: binary medya

```env
MEDIA_STORAGE_PROVIDER=railway
MEDIA_S3_ENDPOINT=
MEDIA_S3_BUCKET=
MEDIA_S3_REGION=auto
MEDIA_S3_URL_STYLE=virtual-host
MEDIA_S3_ACCESS_KEY_ID=
MEDIA_S3_SECRET_ACCESS_KEY=
```

Railway projesine bir Bucket ekleyin. Bucket credential panelindeki endpoint,
bucket adı, access key ve secret key değerlerini yukarıdaki uygulama
değişkenlerine bağlayın. Sağlayıcının verdiği değerleri tahmin etmeyin veya
repo içine yazmayın.

Bucket private kalmalıdır. Browser doğrudan credential kullanmaz; backend
signed GET URL üretir. Browser video/range istekleri için CORS'u uygulayın:

```bash
npm run storage:cors:railway
```

Komut `CORS_ORIGIN` içindeki production ve local origin'leri kullanır. Kontrol
edilmesi gereken izinler `GET`, `HEAD`, `PUT`; görünür başlıklar arasında
`Content-Length`, `Content-Range`, `Accept-Ranges` ve `ETag` bulunur.

Eski Supabase Storage medyası varsa önce kaynakları silmeden taşıyın:

```bash
npm run storage:migrate:railway
```

Kopyalama, boyut doğrulama ve DB path güncellemesi başarıyla bittikten sonra,
geri dönüş ihtiyacı kalmadığında:

```bash
node scripts/migrate_supabase_media_to_railway.js --delete-source --delete-buckets
```

İkinci komut yıkıcıdır; doğrulama ve yedek olmadan çalıştırılmamalıdır.

## Temel API sözleşmesi

| Endpoint | İşlev |
| --- | --- |
| `GET /api/config` | Aktif provider, feature flag ve entegrasyon durumu |
| `POST /api/auth/*` | signup/login/refresh/reset/update |
| `GET /api/auth/oauth/google` | Supabase Google OAuth URL'si |
| `GET /api/lessons` | Kullanıcının ders geçmişi |
| `GET /api/lessons/:id` | Ders, segment, chat ve video detayı |
| `GET /api/lessons/:id/video-url` | Private final video için signed URL |
| `POST /api/generate-lesson` | Planı başlatır ve `202` job döndürür |
| `POST /api/publish-youtube` | Tamamlanmış dersi social worker ile YouTube'a yollar (`privacy_status`: `private`/`unlisted`/`public`) |
| `POST /api/publish-instagram` | Tamamlanmış dersi Instagram worker'a yollar |
| `GET /api/social-publish/:id` | Yayın işinin durumunu ve platform sonucunu döndürür |
| `POST /api/cards/generate` | Prompt/soru/soru fotoğrafından NDJSON kart akışı üretir, oturumu kaydeder |
| `POST /api/cards/ask` | Kartlar üretildikten sonra ask-kara tarzı takip sohbeti |
| `GET /api/cards/sessions` / `GET /api/cards/sessions/:id` | Kullanıcının kart geçmişi ve tek bir oturumun detayı |
| `POST /api/cards/sessions/:id/publish-instagram` | Oturumun kart görsellerini (PNG→JPEG) Instagram carousel olarak yayınlar |
| `GET /api/scheduler/status` | İki zamanlanmış işin (`cards_carousel`, `lesson_video`) durumu |
| `POST /api/scheduler/start` / `POST /api/scheduler/stop` | `{ job_type, interval_minutes? }` ile zamanlanmış içerik üretimini açar/kapatır |
| `GET/PUT /api/scheduler/content-pool` | Railway Bucket'taki `content_pool.txt`'i (satır başına bir fikir) okur/değiştirir |
| `GET /api/catalog` | Herkese acik (Netflix tarzi) katalog listesi; auth gerektirmez |
| `GET /api/catalog/mine` | Giris yapan kullanicinin tamamlanmis dersleri (katalog "ozel" sekmesi) |
| `GET /api/catalog/:id/video-url` | Herkese acik (`is_public=true`) bir katalog dersi icin signed video URL |
| `GET /api/jobs/:id` | Job snapshot/polling fallback |
| `GET /api/jobs/:id/events` | Authenticated SSE job akışı |
| `GET /api/jobs/:id/stream-manifest` | Sıralı progressive partial metadata |
| `GET /api/jobs/:id/partials/:sequence` | Authenticated fMP4 partial |
| `POST /api/ask-kara` | Timestamp, ders planı ve chat bağlamıyla soru-cevap |
| `WS /api/kara-live` | Gemini Live API ile canlı sesli sohbet; get_frame/web_search/generate_manim araçları |
| `GET /api/auth/oauth/google-drive` | drive.file scope + offline access isteyen ek Google OAuth turu başlatır |
| `POST /api/auth/google-drive-token` | Dönen provider refresh token'ı kaydeder |
| `POST /api/lessons/:id/save-to-drive` | Ders videosunu kullanıcının Google Drive'ına yükler |

Auth açıkken kullanıcıya ait endpointler Bearer token ister. Job ve lesson
sahiplik kontrollerini kaldırmayın.

## DeepSeek istemcisi

Backend, OpenAI SDK ile `https://api.deepseek.com` Chat Completions endpoint'ini
kullanır. Plan ve kod çağrıları `deepseek-v4-flash`, thinking modu ve `high`
reasoning effort ile yapılır. LLM JSON hataları `llmJson.js` tarafından
temizlenip onarılmaya çalışılır.

## Test ve doğrulama

```bash
npm ci
npm test
git diff --check
docker build -t karatahta-backend .
```

Local veya production smoke test:

```bash
curl https://api.example.com/api/config
```

Birkac ders uretiminden sonra tekrarlayan Manim hatalarini taramak icin
(yeni bir sanitizer/prompt kurali eklemeye deger mi diye) loglarda
`MANIM_HATA` ile grep'le -- her render hatasinda tek satirlik, boyali Rich
traceback'siz bir ozet basar (`ExceptionType: mesaj (Seg_sX.py:satir)`):

```bash
railway logs --lines 500 | grep MANIM_HATA
```

CORS preflight:

```bash
curl -i -X OPTIONS \
  https://api.example.com/api/config \
  -H 'Origin: https://frontend.example.com' \
  -H 'Access-Control-Request-Method: GET'
```

Yanıtta `Access-Control-Allow-Origin:
https://frontend.example.com` bulunmalıdır.

## Railway deployment

Bu proje için Railway CLI birincil operasyon aracıdır (`railway login` +
`railway link` bir kere yapılır; bu repoda zaten linklidir).

**Önce hangi branch'in deploy edildiğini doğrulayın** — README'deki tablo
değeri elle güncellenir ve eskiyebilir:

```bash
railway status --json | grep -A5 '"branch"'
```

Normal production akışı (doğrulanan branch üzerinde):

```bash
git switch <dogrulanan-branch>       # ör. checkpoint-9
git pull --ff-only origin <branch>
npm test
git add <degisen-dosyalar>
git commit -m "..."
git push origin <branch>
```

Push, Railway'in GitHub entegrasyonu üzerinden otomatik build/deploy tetikler.
Takip edin:

```bash
railway status                       # Building -> Online, deployment ID degisir
railway logs -d --lines 200          # canli log
```

`railway status --json` çıktısındaki `meta.branch` ve `meta.commitHash`
değerlerinin push ettiğiniz branch/commit ile eştiğini doğrulayın — Railway
farklı bir branch'e bağlıysa push hiç deploy tetiklemez ve fark edilmeden
eski kod çalışmaya devam eder (bu session'da tam olarak bu yaşandı:
`checkpoint-5`'e yapılan push'lar aslında deploy edilen `checkpoint-4`'ü hiç
etkilemedi, ta ki `railway status --json` ile fark edilene kadar).

Environment değişkeni değiştirmek için (otomatik redeploy tetikler):

```bash
railway variables --service karatahta-backend --environment production --set "KEY=value"
```

Deploy edilen branch'i değiştirmek için:

```bash
railway service source connect --repo ethosoftai/karatahta-backend --branch <branch> --service karatahta-backend
```

GitHub source kuyruğu takılırsa CLI'dan doğrudan deploy edin (yalnız yedek
yöntem — önce aynı kodu GitHub'daki deploy edilen branch'e commit/push edin,
aksi halde production ile repo source of truth ayrışır):

```bash
railway up . --path-as-root
railway deployment list
```

## VPS deployment (hibrit backend)

Hibrit backend altyapısının VPS tarafı `scripts/deploy_vps.sh` ile deploy
edilir (kod testleri, Docker build, smoke test, üretime geçiş, rollback
imajı):

```bash
bash scripts/deploy_vps.sh
```

VPS ve Railway aynı kod tabanini calistirir ama `/etc/karatahta-backend.env`
ayri bir dosyadir ve otomatik senkronize olmaz. Railway'e yeni bir feature
flag, timeout veya Google/Media credential eklendiginde VPS'in de ayni
degerleri almasi icin:

```bash
npm run vps:sync-env
```

Bu script `railway variables --json` ile Railway'in guncel degerlerini okur,
yalnizca iki backend arasinda ayni olmasi gereken ayarlari (feature flag'ler,
paylasilan timeout'lar, Railway Bucket okuma bilgileri, Google OAuth/Drive/
Live) VPS `.env` dosyasina uygular, VPS'e ozgu ayarlari (MEDIA_STORAGE_PROVIDER=local,
CORS_ORIGIN, kendi DEEPSEEK_API_KEY'i, concurrency degerleri) degistirmeden
birakir ve container'i yeniden olusturur. Idempotent'tir, guvenle tekrar
calistirilabilir. `railway` CLI'nin login/link olmasi ve VPS SSH erisiminin
(`VPS_SSH_KEY`, varsayilan yol) hazir olmasi gerekir.

## Frontend ile birlikte deployment

Backend deploy edilince frontend(ler) otomatik olarak yeniden build olmaz.
API sözleşmesini etkileyen değişikliklerde `ethosoftai/karatahta-frontend`
reposu da güncellenmelidir (bkz. o repodaki README) — çalışma branch'i şu an
`checkpoint-9`.

İki ayrı frontend deployment'ı var:

- **Cloudflare Workers** (`frontend.example.com`,
  güncel/birincil): build/deploy mekanizması bu repo içinde değil, ayrı bir
  Cloudflare hesabından yönetiliyor (repoda `wrangler.toml` yok). Hangi
  branch'i izlediği veya nasıl tetiklendiği bu README'de doğrulanmadı — o
  Cloudflare projesine erişimi olan kişiye sorun.
- **hosting/cPanel** (`karatahta.ethosoft.org`, legacy): `main` branch'inden
  commitlenmiş `dist/` klasörünü manuel "Update from Remote" + "Deploy HEAD
  Commit" adımlarıyla yayınlar. Google OAuth artık bu domaine dönmüyor (bkz.
  yukarıdaki `AUTH_REDIRECT_URL` notu), ama statik arayüz hâlâ buradan
  erişilebilir olabilir.

## Sonraki geliştirici/LLM için teslim kontrol listesi

- Başlamadan `git status -sb`, `git remote -v`, `git branch -vv` ve son
  commitleri kontrol et.
- **Varsayım yapma**: `railway status --json | grep branch` ile Railway'in şu
  an gerçekten hangi branch/commit'i deploy ettiğini doğrula. Bu repoda birden
  fazla `checkpoint-N` branch'i var ve bazıları birbirinin devamı değil, farklı
  soylardan (ör. HTML/Remotion render motoru denemeleri) — README'deki tablo
  değeri güncel olmayabilir.
- Production backend değişikliği, doğrulanmış deploy branch'ine gitmelidir.
- `.env` veya credential JSON dosyalarını okuma çıktısında/gitte ifşa etme.
- Supabase'i binary depolama olarak geri ekleme; Auth + Postgres olarak tut.
- Kalıcı video/ses/ekleri Railway Bucket'a yaz; local `/renders` yalnız geçici
  fallback'tir.
- In-memory job/SSE/partial tasarımını dikkate almadan replica artırma.
- Pipeline değişikliğinde final-video fallback ve lesson ownership
  kontrollerini koru.
- Yeni env değişkeni eklenirse `.env.example`, README ve Railway Variables
  birlikte güncellenmelidir.
- Endpoint sözleşmesi değişirse frontend kaynak + `dist` commitini ve cPanel
  remote/HEAD deploy akışını da tamamla.
- Teslimden önce test, Docker build (mümkünse), `/api/config`, CORS ve Railway
  deployment source SHA'sını doğrula.
