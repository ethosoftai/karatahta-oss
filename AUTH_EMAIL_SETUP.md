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

- Site URL: `https://karatahta.ethosoft.org`
- Redirect URLs:
  - `https://karatahta.ethosoft.org/**`
  - `http://localhost:3001/**`
  - `http://127.0.0.1:3001/**`

Railway production değişkeni:

```env
AUTH_REDIRECT_URL=https://karatahta.ethosoft.org/
```

Google giriş butonu backend'deki `/api/auth/oauth/google` endpointinden
Supabase'in güvenli yönlendirme adresini alır. OAuth dönüşündeki kullanıcı,
mevcut profil ve ders geçmişi sistemiyle aynı kullanıcı akışına girer.

## 2. Supabase Custom SMTP

Supabase Dashboard'da **Authentication → Emails → SMTP Settings** bölümünde
mevcut hosting SMTP ayarları kullanılabilir:

- Sender name: `Kara Tahta`
- Sender email: `no-reply@karatahta.ethosoft.org`
- Host: `mail.karatahta.ethosoft.org`
- Port: `587`
- Username: `no-reply@karatahta.ethosoft.org`
- Password: cPanel'deki posta hesabının parolası

E-posta gönderilemezse hosting/cPanel **Email Deliverability** ekranından SPF,
DKIM ve DMARC durumlarını kontrol edin. SMTP parolasını `.env`, frontend veya
GitHub'a yazmayın.

E-posta ile kayıt ve şifre yenileme ekranları, mesajın gelen kutusunda
görünmemesi halinde spam veya gereksiz klasörünün kontrol edilmesini kullanıcıya
hatırlatır.
