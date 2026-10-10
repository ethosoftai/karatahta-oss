# Railway Deployment

## Genel bakış

Railway servisini bu repoya ve bir branch'e bağladığınızda, o branch'e yapılan
push'lar otomatik deployment başlatır. Express `PORT=8080` üzerinde dinler.

## Progressive Manim rollout

Progressive oynatma feature flag arkasındadır. Önce staging/preview ortamında:

```env
MANIM_QUALITY=-qm
PROGRESSIVE_MANIM_PARTIALS=true
PROGRESSIVE_BUFFER_SECONDS=12
PROGRESSIVE_ARTIFACT_TTL_MS=1800000
DEEPSEEK_REQUEST_TIMEOUT_MS=120000
STREAMING_PLAN_FIRST_SEGMENT=true
```

Flag açıkken Manim ayrıca `1280x720 @ 30 FPS` ile zorlanır. Backend yalnız
tamamlanmış ve `ffprobe` doğrulamasından geçen `partial_movie_files` çıktılarını
authenticated fMP4 manifestine ekler. Flag kapatıldığında traditional segment
render + final concat akışı değişmeden çalışır.

`STREAMING_PLAN_FIRST_SEGMENT=true` olduğunda DeepSeek plan JSON'unu akış halinde
döndürür. İlk tamamlanmış segment TTS + Manim hazırlığına hemen girerken kalan
plan arka planda tamamlanır. Sorun halinde bu değişken `false` yapılarak tam-plan
bekleyen eski akışa kod değişikliği olmadan dönülebilir.

## Gerekli Railway değişkenleri

```env
PORT=8080
CORS_ORIGIN=https://frontend.example.com
AUTH_REQUIRED=false

LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_PLAN_MODEL=deepseek-v4-flash
DEEPSEEK_CODE_MODEL=deepseek-v4-flash
DEEPSEEK_REASONING_EFFORT=high
DEEPSEEK_REQUEST_TIMEOUT_MS=120000
STREAMING_PLAN_FIRST_SEGMENT=true

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

CLI deployment GitHub bağlantısını kaldırmaz. Daha sonra izlenen branch'e
yeni bir commit pushlanırsa GitHub auto-deploy yeniden çalışır. Bu nedenle
production'a gönderilen kod önce GitHub'a pushlanmalı, CLI aynı commit için
yalnız yedek deploy yöntemi olarak kullanılmalıdır.

## Doğrulama

```bash
curl $API_URL/api/config
```

CORS kontrolü:

```bash
curl -i -X OPTIONS \
  $API_URL/api/config \
  -H 'Origin: https://frontend.example.com' \
  -H 'Access-Control-Request-Method: GET'
```

Yanıtta şu başlık bulunmalıdır:

```text
Access-Control-Allow-Origin: https://frontend.example.com
```

## Railway CLI ile günlük işlemler

Railway CLI ile (`railway login` + `railway link`) projeyi bağladıktan sonra,
Railway'in GitHub entegrasyonu push edilen branch'i otomatik build/deploy eder.
Önce Railway'in hangi branch'i izlediğini doğrulayın:

```bash
railway status --json | grep -A5 '"branch"'
```

Takip:

```bash
railway status                       # Building -> Online
railway logs -d --lines 200          # canli log
```

Environment değişkeni değiştirmek için (otomatik redeploy tetikler):

```bash
railway variables --service <service> --environment production --set "KEY=value"
```

GitHub kaynağı kullanılamıyorsa CLI'dan doğrudan deploy edilebilir:

```bash
railway up . --path-as-root
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
(`VPS_HOST`, `VPS_SSH_KEY`) hazir olmasi gerekir.

## Frontend ile birlikte deployment

Backend deploy edilince frontend otomatik olarak yeniden build olmaz. API
sözleşmesini etkileyen değişikliklerde frontend de güncellenmelidir. Frontend'in
origin'i `CORS_ORIGIN` listesinde, OAuth dönüş adresi `AUTH_REDIRECT_URL`
değişkeninde yer almalıdır.
