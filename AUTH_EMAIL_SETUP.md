# Kara Tahta kimlik doğrulama kurulumu

Kara Tahta, Supabase Auth üzerinden iki giriş yöntemi kullanır:

- Google OAuth
- E-posta ve şifre

E-posta doğrulaması ile şifre yenileme mesajları mevcut Supabase Custom SMTP
ayarları üzerinden gönderilmeye devam eder. Resend veya Send Email Hook
kullanılmaz.

## 1. Google OAuth

Google Cloud Console'da bir **Web application** OAuth istemcisi oluşturun.

Authorized redirect URI:

```text
https://<PROJECT_REF>.supabase.co/auth/v1/callback
```

Oluşan Client ID ve Client Secret değerlerini Supabase Dashboard'da
**Authentication → Sign In / Providers → Google** bölümüne girip Google
sağlayıcısını etkinleştirin.

Supabase **Authentication → URL Configuration**:

- Site URL: `https://<FRONTEND_DOMAIN>`
- Redirect URLs:
  - `https://<FRONTEND_DOMAIN>/**`
  - `http://localhost:3001/**`
  - `http://127.0.0.1:3001/**`

Railway production değişkeni:

```env
AUTH_REDIRECT_URL=https://<FRONTEND_DOMAIN>/
GOOGLE_OAUTH_ENABLED=true
```

Google giriş butonu backend'deki `/api/auth/oauth/google` endpointinden
Supabase'in güvenli yönlendirme adresini alır. OAuth dönüşündeki kullanıcı,
mevcut profil ve ders geçmişi sistemiyle aynı kullanıcı akışına girer.
`GOOGLE_OAUTH_ENABLED` değerini yalnızca Google provider Supabase'de
etkinleştirildikten sonra `true` yapın.

## 2. Supabase Custom SMTP

Supabase Dashboard'da **Authentication → Emails → SMTP Settings** bölümünde
kendi SMTP sağlayıcınızın bilgilerini girin:

- Sender name: `Kara Tahta`
- Sender email: `no-reply@<DOMAIN>`
- Host: `<SMTP_HOST>`
- Port: `587`
- Username: `no-reply@<DOMAIN>`
- Password: posta hesabının parolası

E-posta gönderilemezse alan adınızın SPF,
DKIM ve DMARC durumlarını kontrol edin. SMTP parolasını `.env`, frontend veya
GitHub'a yazmayın.

E-posta ile kayıt ve şifre yenileme ekranları, mesajın gelen kutusunda
görünmemesi halinde spam veya gereksiz klasörünün kontrol edilmesini kullanıcıya
hatırlatır.
