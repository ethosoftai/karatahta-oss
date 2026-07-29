# Kara Tahta Auth e-posta kurulumu

Production auth e-postaları Supabase SMTP tarafından değil, Railway backend'deki
imzalı Send Email Hook üzerinden Resend API ile gönderilir.

```text
Supabase Auth
  → Standard Webhooks imzalı POST
  → /api/auth/hooks/send-email
  → Resend API
  → kullanıcı
```

## 1. Resend domain ve API anahtarı

1. Resend'de `karatahta.ethosoft.org` gönderen domainini ekleyin.
2. Resend'in verdiği SPF ve DKIM DNS kayıtlarını Zone Editor'a ekleyin.
3. Domain doğrulandıktan sonra yalnızca gönderim yetkili bir API anahtarı oluşturun.
4. API anahtarını GitHub'a veya frontend'e yazmayın.

## 2. Railway değişkenleri

`karatahta-backend` production servisinde:

```env
RESEND_API_KEY=re_...
AUTH_EMAIL_FROM=Kara Tahta <no-reply@karatahta.ethosoft.org>
AUTH_EMAIL_REPLY_TO=no-reply@karatahta.ethosoft.org
SEND_EMAIL_HOOK_SECRET=v1,whsec_...
AUTH_REDIRECT_URL=https://karatahta.ethosoft.org/
```

`SEND_EMAIL_HOOK_SECRET`, Supabase hook oluşturulurken üretilen değerle birebir
aynı olmalıdır.

## 3. Supabase Send Email Hook

Supabase Dashboard'da **Authentication → Hooks → Send Email**:

- Hook type: `HTTPS`
- URL:
  `https://api.example.com/api/auth/hooks/send-email`
- Secret: **Generate Secret**

Üretilen secret'ı önce Railway'e `SEND_EMAIL_HOOK_SECRET` olarak kaydedin.
Railway deployment başarıyla tamamlandıktan sonra hook'u etkinleştirin.

Hook etkin olduğunda Supabase Custom SMTP kullanılmaz. Email provider ayarı açık
kalmalıdır; aksi halde e-posta ile kayıt özelliği de kapanır.

## 4. URL ayarları

Supabase Dashboard'da **Authentication → URL Configuration**:

- Site URL: `https://karatahta.ethosoft.org`
- Redirect URLs:
  - `https://karatahta.ethosoft.org/**`
  - `http://localhost:3001/**`
  - `http://127.0.0.1:3001/**`

## 5. Güvenlik ve teslimat

- Hook gövdesi, Supabase Standard Webhooks imzası doğrulanmadan işlenmez.
- Resend tekrar denemelerinde aynı mailin iki kez gönderilmesini önlemek için
  webhook kimliği idempotency anahtarı olarak kullanılır.
- E-posta adresi, OTP ve token değerleri uygulama loglarına yazılmaz.
- Signup, recovery, magic link, invite, secure email change ve reauthentication
  akışları için ayrı Türkçe HTML ve düz metin şablonları kullanılır.
