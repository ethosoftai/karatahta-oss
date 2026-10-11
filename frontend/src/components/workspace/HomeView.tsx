const suggestions = [
  ['Kuantum mekaniğini sezgisel olarak açıkla', 'Kuantum mekaniği'],
  ['Türev nedir, örneklerle anlat', 'Türev ve değişim'],
  ['Mitoz ve mayoz bölünme farkları', 'Mitoz ve mayoz'],
  ["Birinci Dünya Savaşı'nın nedenleri", 'I. Dünya Savaşı']
] as const;

export function HomeView() {
  return (
    <section className="homeView" id="homeView">
      <div className="heroBadge"><span /> AI VIDEO DERS STÜDYOSU</div>
      <div className="heroCopy">
        <h1>Bugün neyi gerçekten<br /><span>anlamak</span> istersin?</h1>
        <p>Konunu veya soru fotoğrafını paylaş. Planlama, anlatım, ses ve animasyon tek akışta hazırlansın.</p>
      </div>

      <section className="promptComposer">
        <label className="composerLabel" htmlFor="topicInput">Ders konun</label>
        <textarea id="topicInput" rows={3} placeholder="Örneğin: Türevi grafikler üzerinden sezgisel anlat..." />

        <div className="composerBar">
          <div className="segmented" aria-label="Seviye">
            <button className="chip active" type="button" data-level="beginner">Başlangıç</button>
            <button className="chip" type="button" data-level="intermediate">Orta</button>
            <button className="chip" type="button" data-level="advanced">İleri</button>
          </div>

          <div className="segmented" aria-label="Süre">
            <button className="chip" type="button" data-minutes="2" data-segments="4">1-2 dk</button>
            <button className="chip active" type="button" data-minutes="10" data-segments="20">8-10 dk</button>
            <button className="chip" type="button" data-minutes="18" data-segments="36">15-20 dk</button>
          </div>

          <button id="generatePlanBtn" className="primaryAction generateAction" type="button">
            Dersi oluştur
            <span aria-hidden="true">↗</span>
          </button>
        </div>

        <div className="uploadBar">
          <label className="uploadButton" htmlFor="questionImageInput">
            <span aria-hidden="true">＋</span>
            Soru fotoğrafı ekle
          </label>
          <input id="questionImageInput" className="fileInput" type="file" accept="image/*" />
          <span id="questionImageName" className="uploadName">PNG, JPG veya WebP</span>
          <button id="clearQuestionImageBtn" className="iconTextButton hidden" type="button">Kaldır</button>
        </div>
      </section>

      <div className="suggestionBlock">
        <span>Hızlı başlangıç</span>
        <div className="suggestions">
          {suggestions.map(([topic, label]) => (
            <button key={topic} type="button" data-topic={topic}>
              {label}
              <span aria-hidden="true">→</span>
            </button>
          ))}
        </div>
      </div>

      <div className="hiddenControls" aria-hidden="false">
        <select id="levelInput" defaultValue="beginner">
          <option value="beginner">Başlangıç</option>
          <option value="intermediate">Orta</option>
          <option value="advanced">İleri</option>
        </select>
        <input id="targetMinutesInput" type="number" min="1" max="30" step="1" defaultValue="10" />
        <input id="targetSegmentsInput" type="number" min="2" max="40" step="1" defaultValue="20" />
        <input id="priorInput" type="text" defaultValue="" />
        <textarea id="interruptInput" defaultValue="" />
      </div>
    </section>
  );
}
