export function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="brandBlock">
        <button id="logoHomeBtn" className="logoHomeBtn" type="button" aria-label="Yeni ders">
          <img className="sidebarLogo" src="/logo.png" width="180" height="46" alt="Kara Tahta" />
        </button>
        <p id="configText" className="hidden">Gemini + Manim</p>
      </div>

      <nav className="sidebarQuickNav" aria-label="Bölümler">
        <button id="karatahtaNavBtn" className="historyItem active" type="button">
          <span className="historyText">
            <strong>Karatahta</strong>
          </span>
        </button>
        <button id="cardNavBtn" className="historyItem" type="button">
          <span className="historyText">
            <strong>Kart</strong>
          </span>
        </button>
        <button id="katalogNavBtn" className="historyItem" type="button">
          <span className="historyText">
            <strong>Katalog</strong>
          </span>
        </button>
        <button id="settingsNavBtn" className="historyItem" type="button">
          <span className="historyText">
            <strong>Ayarlar</strong>
          </span>
        </button>
      </nav>

      <div className="sidebarLabel" id="sidebarSectionLabel">ÇALIŞMA ALANI</div>
      <nav className="historyList" aria-label="Bölüm geçmişi">
        <button className="historyItem active" type="button">
          <span className="historyText">
            <strong>Yeni ders</strong>
            <small>Bir konu seç ve üret</small>
          </span>
        </button>
      </nav>

      <details id="developerPortal" className="backendPortal hidden">
        <summary>
          <span>Developer portal</span>
          <strong id="backendActiveBadge">Railway</strong>
        </summary>
        <div className="backendPortalBody">
          <p>Backend altyapısı</p>
          <div className="backendModeOptions" role="radiogroup" aria-label="Backend altyapısı">
            <label>
              <input type="radio" name="backendMode" value="railway" />
              <span><strong>Railway</strong><small>Yalnız Railway</small></span>
            </label>
            <label>
              <input type="radio" name="backendMode" value="vps" />
              <span><strong>VPS</strong><small>Yalnız VPS</small></span>
            </label>
            <label>
              <input type="radio" name="backendMode" value="hybrid" />
              <span><strong>Hibrit</strong><small>VPS + Railway yedek</small></span>
            </label>
          </div>
          <div className="backendHealthRows" aria-live="polite">
            <span><i id="vpsHealthDot" /><small>VPS</small><strong id="vpsHealthText">Kontrol edilmedi</strong></span>
            <span><i id="railwayHealthDot" /><small>Railway</small><strong id="railwayHealthText">Kontrol edilmedi</strong></span>
          </div>
          <button id="backendHealthBtn" type="button">Bağlantıları test et</button>
          <small id="backendModeHint" className="backendModeHint">Seçim bu tarayıcıda saklanır.</small>
        </div>
      </details>

      <div className="sidebarFooter">
        <div className="status" id="statusText">Hazır</div>
      </div>
    </aside>
  );
}
