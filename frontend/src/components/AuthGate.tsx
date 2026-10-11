export function AuthGate() {
  return (
    <section id="authGate" className="authGate">
      <div className="authLayout">
        <aside className="authShowcase" aria-label="Kara Tahta özellikleri">
          <div className="authShowcaseBadge">
            <span />
            Yapay zekâ video stüdyosu
          </div>
          <h1>Bir konudan, anlatan bir derse.</h1>
          <p>
            Kara Tahta konunu planlar, seslendirir ve animasyonlu bir video derse dönüştürür.
          </p>
          <div className="authFeatureGrid">
            <article>
              <strong>01</strong>
              <span>Kişisel anlatım</span>
            </article>
            <article>
              <strong>02</strong>
              <span>Animasyonlu çözüm</span>
            </article>
            <article>
              <strong>03</strong>
              <span>Kalıcı ders geçmişi</span>
            </article>
          </div>
        </aside>

        <form id="authForm" className="authCard">
          <div className="authBadge"><span /> Güvenli hesap</div>
          <img className="authLogo" src="/logo.png" width="230" height="58" alt="Kara Tahta" />
          <div className="authIntro">
            <h2 id="authTitle">Tekrar hoş geldin</h2>
            <p id="authSubtitle">Video derslerine devam etmek için giriş yap.</p>
          </div>

          <div id="authOAuth" className="authOAuth hidden">
            <button id="googleAuthBtn" className="googleAuthButton" type="button">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.06H12v3.9h5.38a4.6 4.6 0 0 1-2 3.01v2.53h3.24c1.9-1.75 2.98-4.33 2.98-7.38Z" />
                <path fill="#34A853" d="M12 22c2.7 0 4.98-.9 6.63-2.39l-3.24-2.53c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.61A10 10 0 0 0 12 22Z" />
                <path fill="#FBBC05" d="M6.39 13.91A6.01 6.01 0 0 1 6.08 12c0-.66.11-1.3.31-1.91V7.48H3.04A10 10 0 0 0 2 12c0 1.61.38 3.13 1.04 4.52l3.35-2.61Z" />
                <path fill="#EA4335" d="M12 5.96c1.47 0 2.79.51 3.83 1.5l2.87-2.88A9.63 9.63 0 0 0 12 2a10 10 0 0 0-8.96 5.48l3.35 2.61C7.18 7.72 9.39 5.96 12 5.96Z" />
              </svg>
              Google ile devam et
            </button>
            <div className="authDivider"><span>veya e-posta ile</span></div>
          </div>

          <label id="authNameField" className="authField hidden">
            <span>Adın</span>
            <input id="authNameInput" type="text" autoComplete="name" placeholder="Ad Soyad" />
          </label>
          <label id="authEmailField" className="authField">
            <span>E-posta</span>
            <input id="authEmailInput" type="email" autoComplete="email" placeholder="ornek@eposta.com" required />
          </label>
          <label id="authPasswordField" className="authField">
            <span id="authPasswordLabel">Şifre</span>
            <input id="authPasswordInput" type="password" autoComplete="current-password" placeholder="Şifren" required />
          </label>

          <button id="forgotPasswordBtn" className="authLink" type="button">Şifremi unuttum</button>
          <button id="authSubmitBtn" className="primaryAction" type="submit">Giriş yap</button>
          <button id="authModeBtn" className="secondaryAction" type="button">Hesabın yok mu? Hesap oluştur</button>
          <div id="authMessage" className="authMessage" role="status" aria-live="polite" />
          <p id="authSpamHint" className="authSpamHint hidden">
            E-posta birkaç dakika içinde görünmezse spam veya gereksiz klasörünü kontrol et.
          </p>
          <p className="authLegal">Hesabın Supabase Auth ile güvenli şekilde korunur.</p>
        </form>
      </div>
    </section>
  );
}
