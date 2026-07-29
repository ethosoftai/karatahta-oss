# Supabase Kurulumu

Supabase entegrasyonu opsiyoneldir. Değişkenler boş bırakılırsa backend
local/in-memory geliştirme modunda çalışabilir.

## Gerekli değişkenler

```env
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
SUPABASE_DB_URL=
SUPABASE_STORAGE_PUBLIC=false
```

Yeni Supabase projelerinde `sb_publishable_...` ve `sb_secret_...` anahtarlarını
kullanın. Eski projelerde `SUPABASE_ANON_KEY` ve
`SUPABASE_SERVICE_ROLE_KEY` isimleri de desteklenir.

`SUPABASE_SECRET_KEY`, legacy `service_role` anahtarı ve database parolası
yalnız backend/Railway ortamında tutulmalıdır; frontend'e veya GitHub'a
gönderilmemelidir.

## Migration sırası

Supabase Dashboard içindeki SQL Editor'da aşağıdaki dosyaları sırasıyla
çalıştırın:

1. `migrations/001_kara_memory.sql`
2. `migrations/002_auth_profiles.sql`
3. `migrations/003_security_and_storage.sql`

Üçüncü migration:

- bütün uygulama tablolarında RLS'yi etkinleştirir,
- doğrudan anon/authenticated tablo erişimini kapalı bırakır,
- `videos`, `audio` ve `attachments` private bucket'larını oluşturur.

Uygulama veritabanına yalnız backend secret key ile erişir. Frontend'e
Supabase secret key verilmez.

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
DEV_USER_ID=00000000-0000-4000-8000-000000000001
```

`DEV_USER_ID` yalnız `AUTH_REQUIRED=false` modunda gereklidir. Production'da
`AUTH_REQUIRED=true` kullanırken boş bırakılmalıdır.

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
