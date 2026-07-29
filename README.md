# Kara Tahta Backend

Kara Tahta'nın Express API, Gemini/Groq üretim, Edge TTS, Manim render ve
FFmpeg video birleştirme servisidir.

Production API:

```text
https://api.example.com
```

## Gereksinimler

- Node.js 22+
- Python 3
- FFmpeg
- Manim Community 0.20.1
- Edge TTS 7.2.8

Dockerfile bütün sistem bağımlılıklarını içerdiği için en tutarlı geliştirme
ve production yöntemi Docker'dır.

## Hızlı başlangıç

```bash
git clone https://github.com/Ahmet2001/karatahta-backend.git
cd karatahta-backend
cp .env.example .env
```

`.env` içindeki `GEMINI_API_KEY` değerini doldurduktan sonra:

```bash
docker build -t karatahta-backend .
docker run --env-file .env -p 8080:8080 karatahta-backend
```

Kontrol:

```bash
curl http://localhost:8080/api/config
```

## Native geliştirme

```bash
npm ci
python -m venv .venv
source .venv/bin/activate
pip install manim==0.20.1 edge-tts==7.2.8
npm run dev
```

Local frontend varsayılan olarak `http://localhost:3001`, backend ise
`http://localhost:8080` adresinde çalışır.

## Gemini model router

Birincil model `GEMINI_PLAN_MODEL` ve `GEMINI_CODE_MODEL` ile seçilir.
Model kota, kaldırılma veya geçici kapasite hatası verirse backend otomatik
olarak aşağıdaki modellere geçer:

```text
gemini-3.6-flash
gemini-3.5-flash
gemini-3.5-flash-lite
gemini-3.1-flash-lite
gemini-3-flash-preview
```

Sıra `GEMINI_FALLBACK_MODELS` ile değiştirilebilir. Router yalnızca `429`,
model bulunamadı `404` ve geçici kapasite `503` türü hatalarda fallback yapar.

## Komutlar

```bash
npm start             # Production sunucusu
npm run dev           # Watch modunda local sunucu
npm test              # Node testleri
npm run supabase:schema
npm run storage:cors:railway
npm run storage:migrate:railway
```

## Kalici medya depolama

Production'da Supabase yalnız Auth ve Postgres için kullanılır. Video, ses ve
sohbet eki gibi binary dosyalar private Railway Bucket'ta tutulur. Backend
istemciye süreli S3 URL'si üretir; bucket anahtarları frontend'e gönderilmez.

Yeni dosyaları Railway Bucket'a yazmak için `MEDIA_STORAGE_PROVIDER=railway`
ve `.env.example` içindeki `MEDIA_S3_*` değişkenlerini tanımlayın. Eski
Supabase Storage dosyalarını kesintisiz taşımak için önce bu sürümü deploy
edin. Browser video erişimi için `npm run storage:cors:railway` komutuyla
`CORS_ORIGIN` ve local geliştirme origin'lerini bucket'a uygulayın, ardından:

```bash
npm run storage:migrate:railway
node scripts/migrate_supabase_media_to_railway.js --delete-source --delete-buckets
```

İlk komut dosyaları kopyalar, veritabanı yollarını günceller ve kaynakları
korur. İkinci komut, yalnız kopyalama ve doğrulama başarılı olduktan sonra
Supabase Storage kaynaklarını ve boş bucket'ları siler.

## Repo yapısı

```text
Dockerfile
server.js
services/
scripts/
migrations/
skill/
test/
sistem.md
```

Deployment ayrıntıları için [DEPLOYMENT.md](./DEPLOYMENT.md), Supabase için
[SUPABASE_SETUP.md](./SUPABASE_SETUP.md) dosyasına bakın.

Supabase doğrulama/şifre yenileme e-postaları ve hosting SMTP kurulumu için
[AUTH_EMAIL_SETUP.md](./AUTH_EMAIL_SETUP.md) dosyasına bakın.

## Güvenlik

- `.env`, API anahtarları ve credential JSON dosyaları GitHub'a gönderilmez.
- `SUPABASE_SERVICE_ROLE_KEY` yalnız backend ortamında tutulur.
- Production CORS listesine yalnız güvenilen frontend origin'leri eklenir.
