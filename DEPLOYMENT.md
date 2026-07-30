# Railway Deployment

## Mevcut production

```text
Project: <railway-project>
Environment: production
Service: karatahta-backend
Domain: https://api.example.com
Port: 8080
Source: Ahmet2001/karatahta-backend (railway)
```

GitHub `railway` branch'ine yapılan push'lar normalde otomatik deployment
başlatır.

## Progressive Manim rollout

Progressive oynatma feature flag arkasındadır. Önce staging/preview ortamında:

```env
MANIM_QUALITY=-qm
PROGRESSIVE_MANIM_PARTIALS=true
PROGRESSIVE_BUFFER_SECONDS=12
PROGRESSIVE_ARTIFACT_TTL_MS=1800000
GEMINI_REQUEST_TIMEOUT_MS=20000
```

Flag açıkken Manim ayrıca `1280x720 @ 30 FPS` ile zorlanır. Backend yalnız
tamamlanmış ve `ffprobe` doğrulamasından geçen `partial_movie_files` çıktılarını
authenticated fMP4 manifestine ekler. Flag kapatıldığında traditional segment
render + final concat akışı değişmeden çalışır.

## Gerekli Railway değişkenleri

```env
PORT=8080
CORS_ORIGIN=https://karatahta.ethosoft.org
AUTH_REQUIRED=false

LLM_PROVIDER=gemini
GEMINI_API_KEY=
GEMINI_PLAN_MODEL=gemini-3-flash-preview
GEMINI_CODE_MODEL=gemini-3-flash-preview
GEMINI_FALLBACK_MODELS=gemini-3.6-flash,gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3-flash-preview
GEMINI_REQUEST_TIMEOUT_MS=20000

TTS_PROVIDER=edge
EDGE_TTS_VOICE=tr-TR-AhmetNeural
EDGE_TTS_RATE=+0%

MANIM_QUALITY=-qm
MANIM_FONT=Georgia
PROGRESSIVE_MANIM_PARTIALS=true
PROGRESSIVE_BUFFER_SECONDS=12
PROGRESSIVE_ARTIFACT_TTL_MS=1800000
TARGET_VIDEO_MINUTES=10
TARGET_SEGMENT_COUNT=8

MEDIA_STORAGE_PROVIDER=railway
MEDIA_S3_ENDPOINT=
MEDIA_S3_BUCKET=
MEDIA_S3_REGION=auto
MEDIA_S3_URL_STYLE=virtual-host
MEDIA_S3_ACCESS_KEY_ID=
MEDIA_S3_SECRET_ACCESS_KEY=
```

Railway Variables ekranına değerleri girin; `.env` dosyasını image içine
kopyalamayın.

## GitHub kuyruğu takılırsa CLI deployment

Railway CLI bir kez kurulur ve giriş yapılır:

```bash
npm install --global @railway/cli
railway login
```

Backend klasörünü doğru project/service'e bağlayın:

```bash
railway link
```

Ardından GitHub kaynak indirme kuyruğunu kullanmadan doğrudan deploy edin:

```bash
railway up . --path-as-root
```

Deployment listesini ve logları kontrol edin:

```bash
railway deployment list
railway logs --lines 100
```

CLI deployment GitHub bağlantısını kaldırmaz. Daha sonra `main` branch'ine
yeni bir commit pushlanırsa GitHub auto-deploy yeniden çalışır. Bu nedenle
production'a gönderilen kod önce GitHub'a pushlanmalı, CLI aynı commit için
yalnız yedek deploy yöntemi olarak kullanılmalıdır.

## Doğrulama

```bash
curl https://api.example.com/api/config
```

CORS kontrolü:

```bash
curl -i -X OPTIONS \
  https://api.example.com/api/config \
  -H 'Origin: https://karatahta.ethosoft.org' \
  -H 'Access-Control-Request-Method: GET'
```

Yanıtta şu başlık bulunmalıdır:

```text
Access-Control-Allow-Origin: https://karatahta.ethosoft.org
```
