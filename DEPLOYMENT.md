# Railway Deployment

## Mevcut production

```text
Project: <railway-project>
Environment: production
Service: karatahta-backend
Domain: https://api.example.com
Port: 8080
Source: Ahmet2001/karatahta-backend (main)
```

GitHub `main` branch'ine yapılan push'lar normalde otomatik deployment
başlatır.

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

TTS_PROVIDER=edge
EDGE_TTS_VOICE=tr-TR-AhmetNeural
EDGE_TTS_RATE=+0%

MANIM_QUALITY=-qm
MANIM_FONT=Georgia
TARGET_VIDEO_MINUTES=10
TARGET_SEGMENT_COUNT=8
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
