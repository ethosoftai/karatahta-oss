# Geliştirme

Test, doğrulama ve katkı verirken dikkat edilecekler.

## Test ve doğrulama

```bash
npm ci
npm test
git diff --check
docker build -t karatahta-backend .
```

Smoke test (`API_URL` local veya deploy edilmiş adres):

```bash
curl $API_URL/api/config
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
  $API_URL/api/config \
  -H 'Origin: https://frontend.example.com' \
  -H 'Access-Control-Request-Method: GET'
```

Yanıtta `Access-Control-Allow-Origin:
https://frontend.example.com` bulunmalıdır.

## Geliştirici notları

- `.env` veya credential JSON dosyalarını loglarda/gitte ifşa etme.
- Supabase'i binary depolama olarak kullanma; Auth + Postgres olarak tut.
- Kalıcı video/ses/ekleri bucket'a yaz; local `/renders` yalnız geçici
  fallback'tir.
- In-memory job/SSE/partial tasarımını dikkate almadan replica artırma.
- Pipeline değişikliğinde final-video fallback ve lesson ownership
  kontrollerini koru.
- Yeni env değişkeni eklenirse `.env.example`, `railway.env.example` ve README
  birlikte güncellenmelidir.
- Göndermeden önce testleri, Docker build'i (mümkünse), `/api/config` ve CORS'u
  doğrula.
