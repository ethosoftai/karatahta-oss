# API

HTTP, WebSocket ve MCP uç noktaları.

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
| `POST /mcp` | MCP (Model Context Protocol) sunucusu — `generate_lesson_video`, `check_lesson_status`, `generate_cards` tool'ları; `Authorization: Bearer <MCP_ACCESS_TOKEN>` gerekir, stateless Streamable HTTP |
| `GET /api/auth/oauth/google-drive` | drive.file scope + offline access isteyen ek Google OAuth turu başlatır |
| `POST /api/auth/google-drive-token` | Dönen provider refresh token'ı kaydeder |
| `POST /api/lessons/:id/save-to-drive` | Ders videosunu kullanıcının Google Drive'ına yükler |

Auth açıkken kullanıcıya ait endpointler Bearer token ister. Job ve lesson
sahiplik kontrollerini kaldırmayın.

## Asset pool (pazarlama agent'ı için)

Kara Tahta, [marketing-agent-assets](https://github.com/Ahmet2001/MarketingPool/tree/main/marketing-agent-assets)
projesindeki **asset-pool sözleşmesini** uygular. Bir pazarlama agent'ı (Ethgent), uygulamanın
**onayladığı** ders videolarını ve kapak görsellerini bu uç noktalardan okur. Agent, uygulamanın
veritabanı anahtarını veya medya depolama sırlarını görmez; sadece bu sözleşmeyi ve bir token'ı bilir.

| Endpoint | İşlev |
| --- | --- |
| `GET /api/assets?kind=&tag=&limit=` | Onaylı varlık listesi: `{ "assets": [...] }`. `kind`: `video` veya `image`. `limit` varsayılan 20, en çok 100 |
| `GET /api/assets/:id` | Tek varlık. Yok **veya onaylı değilse** `404` |
| `POST /api/assets/:id/prepare` | Varlığı bir yayın hedefi için yeniden imzalar (`{ "target": { "platform", "action" }, "ttlSeconds" }`) |
| `/api/video-requests` | İsteğe bağlı: agent'ın ders üretimi istemesi. Sadece `SCHEDULER_INTERNAL_TOKEN` ve `SCHEDULER_USER_ID` tanımlıysa açılır |

**Kimlik doğrulama.** Kullanıcı oturumu değil, paylaşılan bir token: `Authorization: Bearer $ASSET_POOL_TOKEN`.
Aynı değeri agent'ın `APP_INTERNAL_TOKEN` değişkenine koyun. `ASSET_POOL_TOKEN` boşsa tüm istekler
`500` ile reddedilir; havuz yanlışlıkla açık kalmaz.

**Neyin "onaylı" sayıldığı.** `lessons.is_public = true` olan ve bitmiş (`status = done`) bir videosu bulunan
dersler. YouTube'dan içe aktarılan, hâlâ render edilen ve özel dersler hiçbir zaman listelenmez ve id ile
istenirse `404` döner. Kimlikler `video:<lessonId>` ve `poster:<lessonId>` biçimindedir.

**Medya URL'leri.** Her varlık imzalı bir `https://` URL'si taşır; ömrü `SOCIAL_PUBLISH_VIDEO_URL_TTL_SECONDS`
(varsayılan 86400, en çok 24 saat). Sözleşme `http://` URL'lerini kabul etmez: böyle bir varlık sessizce elenir
ve sayısı `X-Asset-Pool-Dropped` yanıt başlığında bildirilir. Yerelde `MEDIA_STORAGE_PROVIDER=local` ile
deniyorsanız `MEDIA_PUBLIC_BASE_URL` değerinin `https://` olması gerekir (listeniz boş geliyorsa ilk bakılacak yer burası).

**Doğrulama.** Sözleşme uyumunu marketing-agent-assets deposundaki denetleyici ile sınayın:

```bash
node asset-pool/bin/check.js http://127.0.0.1:3000 --token "$ASSET_POOL_TOKEN" --prepare
```

Bu depodaki kodla temiz bir ortamda çalıştırıldığında 19 kontrolün 19'u geçti (video üretimi kapalıyken
isteğe bağlı bölüm atlanır). Uygulama kodu `routes/assetPool.js` ve `services/assetPool/` altındadır.

