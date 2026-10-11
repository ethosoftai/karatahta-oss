export function StudioView() {
  return (
    <section className="studioView hidden" id="studioView">
      <div className="studioHeader">
        <div>
          <p className="eyebrow">VİDEO DERS</p>
          <h2 id="lessonTitle">Ders hazırlanıyor</h2>
        </div>
        <div className="studioActions">
          <a id="downloadVideoBtn" className="secondaryAction hidden" href="#" download>Videoyu indir</a>
          <button id="saveToDriveBtn" className="secondaryAction hidden" type="button">Drive'a kaydet</button>
          <button id="generateFullBtn" className="primaryAction hidden" type="button" disabled>Tüm dersi üret</button>
          <button id="backHomeBtn" className="secondaryAction hidden" type="button">Yeni konu</button>
        </div>
      </div>

      <section className="watchPanel">
        <div className="videoShell">
          <div id="liveStreamBadge" className="liveStreamBadge hidden" aria-live="polite">
            <span aria-hidden="true" />
            <strong>CANLI ÜRETİM</strong>
            <span id="liveStreamText">İlk bölüm hazırlanıyor</span>
          </div>
          <div id="preparingPanel" className="preparingPanel hidden">
            <div className="preparingContent">
              <h3 id="preparingTitle">Ders hazırlanıyor</h3>
              <p id="preparingMessage">Plan kuruluyor...</p>
              <div id="generationStages" className="generationStages" aria-label="Üretim aşamaları">
                <span id="stagePlan" className="generationStage active">İlk segment</span>
                <span id="stageMedia" className="generationStage">Ses + Manim</span>
                <span id="stagePlayback" className="generationStage">Canlı oynatma</span>
              </div>
              <div className="preparingTrack" aria-hidden="true">
                <div id="preparingBar" className="preparingBar" />
              </div>
            </div>
          </div>
          <div id="videoLoadingPanel" className="videoLoadingPanel hidden" role="status" aria-live="polite">
            <span className="loadingSpinner" aria-hidden="true" />
            <p id="videoLoadingText">Video yükleniyor...</p>
          </div>
          <video id="liveManimVideo" className="liveManimVideo" playsInline autoPlay crossOrigin="anonymous" />
          <video id="videoOutput" playsInline crossOrigin="anonymous" />
          <video id="preloadVideo" preload="auto" muted crossOrigin="anonymous" />
          <div id="playerControls" className="playerControls hidden">
            <button id="playPauseBtn" className="playerButton" type="button" aria-label="Oynat">Oynat</button>
            <span id="currentTimeText" className="timeText">0:00</span>
            <div className="timelineTrack">
              <input id="seekBar" className="seekBar" type="range" min="0" max="0" step="0.1" defaultValue="0" aria-label="Video ilerleme" />
              <div id="timelineSegments" className="timelineSegments" aria-hidden="true" />
            </div>
            <span id="durationText" className="timeText">0:00</span>
            <button id="fullscreenBtn" className="playerIconButton" type="button" aria-label="Tam ekran">⛶</button>
          </div>
          <div id="videoOverlay" className="videoOverlay">Video hazırlanıyor...</div>
        </div>
        <section id="karaChat" className="karaChat hidden" aria-live="polite" />
        <form id="karaAskForm" className="karaAskForm hidden">
          <span id="karaTimestamp" className="karaTimestamp" />
          <input id="karaQuestionInput" type="text" autoComplete="off" placeholder="Kara'ya sor" />
          <button id="karaLiveBtn" className="karaLiveBtn hidden" type="button" aria-label="Sesli konuş" aria-pressed="false">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Z" />
              <path d="M6 11a6 6 0 0 0 12 0" />
              <path d="M12 17v4" />
              <path d="M9 21h6" />
            </svg>
          </button>
          <button id="karaSendBtn" className="karaSendBtn" type="submit" aria-label="Soruyu gönder">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 12 20 4l-5 16-3-7-8-1Z" />
              <path d="m12 13 8-9" />
            </svg>
          </button>
        </form>
        <div className="watchMeta hidden">
          <span id="renderMeta">Hazırlanıyor</span>
          <span id="planMeta" />
        </div>
        <details id="developerConsole" className="developerConsole hidden" open>
          <summary>
            <span className="developerConsoleTitle"><span className="developerLiveDot" aria-hidden="true" />Geliştirici konsolu</span>
            <span id="developerConsoleStatus" className="developerConsoleStatus">Hazır</span>
          </summary>
          <div className="developerMetrics" aria-live="polite">
            <span><small>JOB</small><strong id="developerJobMetric">—</strong></span>
            <span><small>DURUM</small><strong id="developerStateMetric">idle</strong></span>
            <span><small>ÜRETİLEN</small><strong id="developerProgressMetric">0 / 0</strong></span>
            <span><small>TAMPON</small><strong id="developerBufferMetric">0 sn</strong></span>
          </div>
          <pre id="logOutput">Canlı üretim olayları burada görünecek.</pre>
        </details>
      </section>

      <section className="lessonGrid hidden">
        <article className="panel plan">
          <div className="sectionHead"><h3>Ders planı</h3></div>
          <div id="planOutput" className="empty">Henüz plan yok.</div>
        </article>
        <article className="panel segments">
          <div className="sectionHead">
            <h3>Bölümler</h3>
            <button id="generateCodeBtn" type="button" disabled>Seçili bölümü hazırla</button>
          </div>
          <div id="segmentList" className="segmentList" />
          <div id="segmentDetail" className="segmentDetail empty">Bir bölüm seç.</div>
        </article>
      </section>

      <details className="developerDetails hidden">
        <summary>Geliştirici detayları</summary>
        <section className="devGrid">
          <article className="panel speech">
            <div className="sectionHead">
              <h3>Speech</h3>
              <span id="speechMeta" />
            </div>
            <div id="speechOutput" className="empty">Henüz speech yok.</div>
            <audio id="audioOutput" controls />
          </article>
          <article className="panel code">
            <div className="sectionHead">
              <h3>Manim</h3>
              <button id="renderBtn" type="button" disabled>Seçili bölümü render et</button>
            </div>
            <textarea id="codeOutput" spellCheck="false" placeholder="Gemini'dan gelen Manim kodu burada görünür." />
          </article>
        </section>
      </details>
    </section>
  );
}
