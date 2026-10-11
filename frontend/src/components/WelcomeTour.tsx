import { useEffect, useState } from 'react';

const STORAGE_KEY = 'karaWelcomeSeen';

const STEPS = [
  {
    title: 'Bir konu anlat',
    desc: 'Ana ekrana bir konu yaz -- Kara Tahta senin için tam bir video ders hazırlasın, izlerken Kara\'ya soru sor.',
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M10 8v8l6-4-6-4Z" />
        <rect x="3" y="4" width="18" height="16" rx="2.5" />
      </svg>
    )
  },
  {
    title: 'Soru çöz',
    desc: 'Kart bölümünde bir soru yaz ya da fotoğrafını yükle, adım adım kartlarla çözümü gör.',
    icon: (
      <svg viewBox="0 0 24 24">
        <rect x="3" y="4" width="18" height="13" rx="3" />
        <path d="M7 21h10M12 17v4" />
      </svg>
    )
  },
  {
    title: 'Kataloğu keşfet',
    desc: 'Herkese açık dersleri ve kart oturumlarını izle, istersen bir YouTube videosunu da içe aktar.',
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M10 8v8l6-4-6-4Z" />
        <circle cx="12" cy="12" r="9" />
      </svg>
    )
  },
  {
    title: 'Ayarlarını düzenle',
    desc: 'Anlatım sesini, ses düzeylerini ve planını Ayarlar bölümünden istediğin zaman değiştir.',
    icon: (
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    )
  }
];

export function WelcomeTour() {
  const [visible, setVisible] = useState(false);

  // legacy/app.js dispatches this right after a successful login (showApp())
  // -- kept as a DOM event instead of React state since auth lives entirely
  // in the legacy module, same pattern CardsView/KatalogView already use for
  // sidebar-driven actions (kara:open-card-session, kara:katalog-explore, ...).
  useEffect(() => {
    function handler() {
      let alreadySeen = false;
      try {
        alreadySeen = Boolean(window.localStorage.getItem(STORAGE_KEY));
      } catch {
        alreadySeen = false;
      }
      if (!alreadySeen) setVisible(true);
    }
    window.addEventListener('kara:show-welcome', handler);
    return () => window.removeEventListener('kara:show-welcome', handler);
  }, []);

  function dismiss() {
    try {
      window.localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // Private browsing / storage disabled -- just close for this visit.
    }
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="welcomeOverlay" onClick={dismiss}>
      <div className="welcomeCard" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Kara Tahta'ya hoş geldin">
        <div className="welcomeHeader">
          <img className="welcomeLogo" src="/logo.png" alt="Kara Tahta" />
          <h2>Kara Tahta'ya hoş geldin!</h2>
          <p>Burada neler yapabileceğine hızlıca bakalım:</p>
        </div>
        <div className="welcomeSteps">
          {STEPS.map((step) => (
            <div className="welcomeStep" key={step.title}>
              <span className="welcomeStepIcon" aria-hidden="true">{step.icon}</span>
              <div>
                <strong>{step.title}</strong>
                <span>{step.desc}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="welcomeQuota">
          Ücretsiz denemende <strong>2 video</strong> ve <strong>2 kart</strong> oluşturma hakkın var.
        </div>
        <button type="button" className="primaryAction welcomeStartBtn" onClick={dismiss}>
          Hadi başlayalım
        </button>
      </div>
    </div>
  );
}
