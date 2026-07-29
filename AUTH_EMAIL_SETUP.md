# Kara Tahta Auth e-posta kurulumu

## 1. hosting/cPanel üzerinde posta hesabı

1. cPanel'de **Email Accounts** bölümünü açın.
2. `no-reply@ethosoft.org` hesabını oluşturup güçlü ve benzersiz bir parola belirleyin.
3. Hesabın yanındaki **Connect Devices / Set Up Mail Client** sayfasını açın.
4. Burada gösterilen kesin **Outgoing Server (SMTP)**, port ve güvenlik tipini not edin.
   Genellikle tam kullanıcı adı `no-reply@ethosoft.org`, port `465` (SSL/TLS) veya
   `587` (STARTTLS) olur. Sunucu adını tahmin etmeyin; cPanel'de yazanı kullanın.
5. **Email Deliverability** ekranında SPF ve DKIM kayıtlarının geçerli olduğunu
   doğrulayın. Eksikse cPanel'in **Repair** seçeneğini kullanın. DMARC kaydını da
   DNS/Zone Editor üzerinden ekleyin.
6. hosting desteğine hesabın saatlik/günlük gönderim sınırını sorun.

SMTP parolasını `.env`, frontend veya GitHub'a yazmayın.

## 2. Supabase Custom SMTP

Supabase Dashboard'da **Authentication → Emails → SMTP Settings** bölümünü açın
ve Custom SMTP'yi etkinleştirin:

- Sender name: `Kara Tahta`
- Sender email: `no-reply@ethosoft.org`
- Host: cPanel **Outgoing Server** değeri
- Port: cPanel'de verilen `465` veya `587`
- Username: `no-reply@ethosoft.org`
- Password: cPanel'de oluşturduğunuz posta parolası

Ayarı kaydedip test e-postası gönderin. `465` seçildiyse SSL/TLS, `587`
seçildiyse STARTTLS kullanın.

## 3. URL ayarları

Supabase Dashboard'da **Authentication → URL Configuration**:

- Site URL: `https://karatahta.ethosoft.org`
- Redirect URLs:
  - `https://karatahta.ethosoft.org/**`
  - `http://localhost:3001/**`
  - `http://127.0.0.1:3001/**`

Railway backend ortam değişkeni:

```env
AUTH_REDIRECT_URL=https://karatahta.ethosoft.org/
```

## 4. Markalı şablonlar

Supabase Dashboard'da **Authentication → Emails → Email Templates** bölümünde:

- Confirm signup subject: `Kara Tahta hesabını doğrula`
- Confirm signup body: `supabase/email-templates/confirmation.html`
- Reset password subject: `Kara Tahta şifreni yenile`
- Reset password body: `supabase/email-templates/recovery.html`

HTML içindeki `{{ .ConfirmationURL }}` Supabase tarafından tek kullanımlık güvenli
bağlantıyla değiştirilir. Bu ifadeyi kaldırmayın veya değiştirmeyin.
