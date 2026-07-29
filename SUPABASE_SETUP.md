# Supabase Kurulumu

Supabase entegrasyonu opsiyoneldir. Değişkenler boş bırakılırsa backend
local/in-memory geliştirme modunda çalışabilir.

## Gerekli değişkenler

```env
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_DB_URL=
SUPABASE_STORAGE_PUBLIC=false
DEV_USER_ID=
```

`SUPABASE_SERVICE_ROLE_KEY` ve database parolası yalnız backend ortamında
tutulmalıdır; frontend'e veya GitHub'a gönderilmemelidir.

## Migration sırası

Supabase Dashboard içindeki SQL Editor'da aşağıdaki dosyaları sırasıyla
çalıştırın:

1. `migrations/001_kara_memory.sql`
2. `migrations/002_auth_profiles.sql`

Alternatif olarak database connection string'i `.env` içindeki
`SUPABASE_DB_URL` değerine ekleyip şu komutu çalıştırın:

```bash
npm run supabase:schema
```

## Authentication

Production'da gerçek kullanıcı oturumu kullanılacaksa:

```env
AUTH_REQUIRED=true
```

Local geliştirmede authentication'ı atlamak için:

```env
AUTH_REQUIRED=false
DEV_USER_ID=
```

## Kontrol

Backend başladıktan sonra:

```bash
curl http://localhost:8080/api/config
```

Supabase doğru yapılandırılmışsa yanıtta şu alan görünür:

```json
{
  "hasSupabase": true
}
```
