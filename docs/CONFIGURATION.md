# Yapılandırma

Tüm ortam değişkenleri, Supabase şeması ve medya depolama kurulumu. Hızlı başlangıç için [README](../README.md#hızlı-başlangıç) yeterlidir.

Gerçek secret'ları `.env`, GitHub veya frontend Vite değişkenlerine
commit etmeyin. Production değerleri Railway > service > Variables
ekranında tutulur.

Production için secret içermeyen, doğrudan Railway Variables ekranına
aktarılabilecek tam şablon [railway.env.example](../railway.env.example)
dosyasındadır. Gerçek `.env` dosyası bilerek `.gitignore` içindedir ve
GitHub'a zorla eklenmemelidir.

## Sunucu ve güvenlik

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

Örnek CORS:

```env
CORS_ORIGIN=https://frontend.example.com,http://localhost:3001,http://127.0.0.1:3001
```

`AUTH_REDIRECT_URL` Google OAuth/şifre sıfırlama/e-posta onayı dönüşlerinin
gideceği frontend adresidir. Bu tek bir sabit URL olduğundan aynı anda yalnız bir frontend OAuth
dönüşünü doğru alabilir; iki frontend'in aynı anda OAuth'u desteklemesi
gerekirse `authCallbackUrl` (`server.js`) isteğin `Origin` header'ını
`CORS_ORIGIN` allowlist'ine karşı doğrulayıp dinamik seçecek şekilde
değiştirilmelidir (bu henüz yapılmadı).

Supabase projesinin **Authentication → URL Configuration → Redirect URLs**
allowlist'inde de aynı frontend URL'si bulunmalıdır; yoksa Supabase
`redirectTo` parametresini yok sayıp kendi Site URL varsayılanına döner —
backend'deki `AUTH_REDIRECT_URL` doğru olsa bile.

## LLM

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

## TTS, Manim ve pipeline

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
| `SEGMENT_END_TRIM_SECONDS=2` | Her segmentin (mux sonrası) sonundan mekanik olarak kırpılan süre; `0` ile kapatılır |
| `MCP_ACCESS_TOKEN` | `POST /mcp` endpoint'ine erişim için zorunlu Bearer token; tanımsızsa endpoint tüm istekleri reddeder |
| `MCP_USER_ID` | MCP tool çağrılarının hangi profile atfedileceği; boşsa `SCHEDULER_USER_ID` kullanılır |
| `MCP_LESSON_WAIT_MS=240000` | `generate_lesson_video` tool'unun sonucu beklerken en fazla bloklanacağı süre; aşılırsa `jobId` ile erken döner |
| `MCP_CARDS_WAIT_MS=120000` | `generate_cards` tool'u için aynısı; aşılırsa o ana kadar tamamlanan kartları `status:"partial"` ile döner (kartlar job'a bağlı değil, `jobId` yok) |
| `SPEECH_VOLUME` | Final mux içindeki konuşma sesi seviyesi |
| `BACKGROUND_MUSIC_VOLUME` | Arka plan müziği seviyesi |
| `BACKGROUND_MUSIC_FADE_SECONDS` | Müzik giriş/çıkış fade süresi |
| `SPEECH_CONCURRENCY` | Speech hazırlama iş limiti |
| `TTS_CONCURRENCY` | Paralel TTS limiti |
| `CODE_CONCURRENCY` | Paralel Manim kod üretim limiti |
| `RENDER_CONCURRENCY=1` | Paralel Manim render limiti; trial ortamı için güvenli varsayılan |

## Supabase: Auth ve Postgres

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
15. `migrations/015_tiktok_publish.sql`
16. `migrations/016_video_orientation.sql`
17. `migrations/017_card_sessions_catalog.sql`
18. `migrations/018_generic_publish_jobs.sql`

çalıştırılmalıdır. Alternatif: `SUPABASE_DB_URL` tanımlayıp
`npm run supabase:schema`.

Migration'lar RLS'yi açar ve uygulama tablolarını doğrudan anon/authenticated
erişime kapalı tutar. Uygulama verisine backend secret key ile ulaşır.

## Railway Bucket: binary medya

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
