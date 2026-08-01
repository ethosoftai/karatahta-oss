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
| Production branch | `railway` |
| Railway project | `<railway-project>` |
| Railway service | `karatahta-backend` |
| Railway region | `europe-west4-drams3a` (Amsterdam), 1 replica |
| Frontend | `https://karatahta.ethosoft.org` |
| Frontend repo | `https://github.com/ethosoftai/karatahta-frontend` (`main`) |
| Auth ve ilişkisel veri | Supabase |
| Kalıcı binary medya | Private Railway Bucket, S3-compatible API |

Railway servisi GitHub'daki `railway` branch'ini deploy etmelidir. `main` veya
başka bir branch'e push etmek production backend'i güncellemez.

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
  ├─ Manim 0.20.1 + FFmpeg
  │    ├─ geçici progressive fMP4 parçaları
  │    └─ final 720p/30 FPS MP4
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
3. `STREAMING_PLAN_FIRST_SEGMENT=true` ise DeepSeek JSON akışından ilk tamamlanmış
   segment çıkarılır. İlk segment bekletilmeden job'a verilir; kalan plan
   aynı sırada arka planda tamamlanır.
4. Segment narration'ı uygunsa ilk speech script yeniden LLM çağrısı
   yapılmadan hazırlanır. TTS, Manim kod üretimi ve uygun işler concurrency
   limitlerine göre yürür.
5. Manim normal `self.play()` / `self.wait()` sınırlarında
   `partial_movie_files` üretir.
6. `PROGRESSIVE_MANIM_PARTIALS=true` ise collector yalnız kapanmış ve
   `ffprobe` doğrulamasından geçmiş MP4 parçalarını sıralı fMP4 partial olarak
   job manifestine ekler.
7. Job güncellemeleri SSE ile `/api/jobs/:id/events` üzerinden gönderilir.
   Frontend manifesti ve authenticated partial endpointlerini kullanarak
   tampon hedefi dolduğunda oynatmayı başlatır.
8. Segmentler tamamlanınca FFmpeg ses/video işlemlerini yapar; bütün
   segmentler final MP4'e birleştirilir ve faststart uygulanır.
9. Segment/final medya Railway Bucket'a yüklenir. Supabase'e yalnız metadata
   ve `railway://...` storage path yazılır.
10. Geçmişten erişimde backend sahipliği kontrol eder ve kısa ömürlü signed S3
    URL üretir.

Progressive parçalar kullanıcı geçmişinin kalıcı videosu değildir. Bunlar
Railway instance diskinde geçicidir ve `PROGRESSIVE_ARTIFACT_TTL_MS` sonunda
temizlenir. Kalıcı sonuç Railway Bucket'taki final videodur.

## Önemli runtime sınırlamaları

- Aktif job nesneleri ve SSE event geçmişi `fullVideoJobs` içinde bellekte
  tutulur.
- Progressive partial dosyalar instance'ın geçici diskindedir.
- Railway restart/deploy sırasında aktif job ve canlı partial akışı
  kaybolabilir. Supabase job metadata'sı bunu tek başına devam ettirmez.
- Mevcut mimaride birden fazla replica güvenli değildir: sonraki HTTP/SSE
  isteği job'ın bulunmadığı başka replica'ya düşebilir. Redis/durable queue,
  ortak object storage partial'ları ve worker ayrımı yapılana kadar
  `numReplicas: 1` korunmalıdır.
- `RENDER_CONCURRENCY` aynı process içindeki paralel Manim sayısını belirler;
  Railway replica sayısı değildir. CPU/RAM ölçmeden yükseltilmemelidir.
- Railway filesystem kalıcı depolama olarak kullanılmaz. Yalnız geçici
  render/work dosyaları burada kalabilir; final sonuç bucket'a yazılmalıdır.

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
├── mediaStore.js                 Railway S3 veya legacy Supabase Storage
├── supabaseStore.js              Auth, Postgres ve persistence
└── karaContext.js                chat bağlamı
scripts/
├── apply_supabase_schema.js
├── configure_railway_bucket_cors.js
└── migrate_supabase_media_to_railway.js
migrations/                       Supabase SQL şeması
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
| `AUTH_PROFILE_CACHE_TTL_MS` | Auth profil cache süresi |
| `DEV_USER_ID` | Yalnız `AUTH_REQUIRED=false` local/demo modu |

Önerilen CORS:

```env
CORS_ORIGIN=https://karatahta.ethosoft.org,http://localhost:3001,http://127.0.0.1:3001
```

### LLM

| Değişken | Açıklama |
| --- | --- |
| `LLM_PROVIDER` | Sabit değer: `deepseek` |
| `DEEPSEEK_API_KEY` | DeepSeek API anahtarı (`DEEPSEEK_API` da desteklenir) |
| `DEEPSEEK_BASE_URL` | Varsayılan: `https://api.deepseek.com` |
| `DEEPSEEK_PLAN_MODEL` | Plan modeli; varsayılan `deepseek-v4-flash` |
| `DEEPSEEK_CODE_MODEL` | Manim kod modeli; varsayılan `deepseek-v4-flash` |
| `DEEPSEEK_REASONING_EFFORT` | `high` veya `max` |
| `DEEPSEEK_REQUEST_TIMEOUT_MS` | İstek timeout'u; varsayılan `120000` |

DeepSeek çağrıları thinking modu açık ve `high` reasoning effort ile çalışır.
Model metin tabanlıdır; soru fotoğrafı çözümü için soru metni `Ek not` alanında
verilmelidir. Video içi Kara soruları timestamp ve ders planı bağlamını kullanır,
ancak video karesini görmez.

### TTS, Manim ve pipeline

| Değişken | Açıklama |
| --- | --- |
| `TTS_PROVIDER` | `edge` veya Google TTS |
| `EDGE_TTS_COMMAND`, `EDGE_TTS_VOICE`, `EDGE_TTS_RATE` | Edge ayarları |
| `GOOGLE_*` | Opsiyonel Google Cloud TTS credential/voice |
| `MANIM_QUALITY=-qm` | 720p/30 FPS medium kalite |
| `MANIM_FONT` | Üretilen sahnelerin varsayılan fontu |
| `MANIM_ENABLE_MATHTEX` | LaTeX kullanım kontrolü |
| `STREAMING_PLAN_FIRST_SEGMENT=true` | Tam planı beklemeden ilk segmenti başlatır |
| `PROGRESSIVE_MANIM_PARTIALS=true` | Gerçek Manim partial canlı akışı |
| `PROGRESSIVE_BUFFER_SECONDS=12` | Oynatma öncesi hedef tampon |
| `PROGRESSIVE_ARTIFACT_TTL_MS` | Geçici partial saklama süresi |
| `TARGET_VIDEO_MINUTES` | Varsayılan hedef ders süresi |
| `TARGET_SEGMENT_COUNT` | Varsayılan plan segment sayısı |
| `SPEECH_VOLUME` | Final mux içindeki konuşma sesi seviyesi |
| `BACKGROUND_MUSIC_VOLUME` | Arka plan müziği seviyesi |
| `BACKGROUND_MUSIC_FADE_SECONDS` | Müzik giriş/çıkış fade süresi |
| `SPEECH_CONCURRENCY` | Speech hazırlama iş limiti |
| `TTS_CONCURRENCY` | Paralel TTS limiti |
| `CODE_CONCURRENCY` | Paralel Manim kod üretim limiti |
| `RENDER_CONCURRENCY` | Paralel Manim render limiti |

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
| `GET /api/jobs/:id` | Job snapshot/polling fallback |
| `GET /api/jobs/:id/events` | Authenticated SSE job akışı |
| `GET /api/jobs/:id/stream-manifest` | Sıralı progressive partial metadata |
| `GET /api/jobs/:id/partials/:sequence` | Authenticated fMP4 partial |
| `POST /api/ask-kara` | Timestamp, ders planı ve chat bağlamıyla soru-cevap |

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

CORS preflight:

```bash
curl -i -X OPTIONS \
  https://api.example.com/api/config \
  -H 'Origin: https://karatahta.ethosoft.org' \
  -H 'Access-Control-Request-Method: GET'
```

Yanıtta `Access-Control-Allow-Origin:
https://karatahta.ethosoft.org` bulunmalıdır.

## Railway deployment

Normal production akışı:

```bash
git switch railway
git pull --ff-only origin railway
npm test
git add <degisen-dosyalar>
git commit -m "..."
git push origin railway
```

Railway service ayarlarında source repo `ethosoftai/karatahta-backend`, branch
`railway` olmalıdır. Deploy sonrasında Railway'in gösterdiği source commit SHA
ile `git rev-parse origin/railway` aynı olmalıdır. Loglarda server'ın `PORT`
üzerinde başladığını ve `/api/config` yanıtını kontrol edin.

GitHub source kuyruğu takılırsa:

```bash
railway login
railway link
railway up . --path-as-root
railway deployment list
railway logs --lines 100
```

CLI deploy yalnız yedek yöntemdir. Önce aynı kodu GitHub `railway` branch'ine
commit/push edin; aksi halde production ile repo source of truth ayrışır.

## Frontend/cPanel birlikte deployment

Backend deploy edilince hosting frontend otomatik olarak yeniden build
olmaz. API sözleşmesini etkileyen değişikliklerde frontend de ayrı repo içinde
güncellenmelidir:

1. `ethosoftai/karatahta-frontend` `main` branch'inde değişikliği yap.
2. `npm test` ve `npm run build` çalıştır.
3. Kaynak dosyalarla **birlikte `dist/`yi aynı committe** pushla.
4. hosting cPanel > Git Version Control içinde **Update from Remote** yap.
5. cPanel'deki `HEAD == origin/main` olduğunu kontrol et.
6. Ardından **Deploy HEAD Commit** yap.

Frontend `.cpanel.yml` build almaz; yalnız commitlenmiş `dist/` klasörünü
yayın dizinine kopyalar. Bu nedenle remote güncelleme, HEAD eşitliği ve deploy
adımlarının üçü de gereklidir.

## Sonraki geliştirici/LLM için teslim kontrol listesi

- Başlamadan `git status -sb`, `git remote -v`, `git branch -vv` ve son
  commitleri kontrol et.
- Production backend değişikliği `railway` branch'ine gitmelidir.
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
