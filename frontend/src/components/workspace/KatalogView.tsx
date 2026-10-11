import { useEffect, useMemo, useRef, useState } from 'react';

type CatalogEntry = {
  id: string;
  title: string;
  topic: string | null;
  createdAt: string;
  updatedAt: string;
  durationSeconds: number | null;
  posterUrl: string | null;
};

type CatalogTab = 'public' | 'private';
type ContentType = 'lessons' | 'cards';

type CardCatalogEntry = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  cardCount: number;
  posterUrl: string | null;
};

type CardCatalogCard = { title: string; explanation: string; imageUrl: string | null };
type CardSessionDetail = { id: string; title: string; cards: CardCatalogCard[] };

type ChatMessage = {
  role: 'user' | 'assistant';
  timestamp: string;
  content: string;
  pending?: boolean;
  visionUsed?: boolean;
  toolsUsed?: string[];
  artifacts?: { type: string; url: string; title?: string }[];
  sources?: { url: string; title?: string }[];
};

type PlaybackState = {
  id: string;
  title: string;
  url: string | null;
  posterUrl: string | null;
  tab: CatalogTab;
  isYoutube: boolean;
  youtubeVideoId: string | null;
};

// Minimal surface of the YouTube IFrame Player API we actually use.
type YoutubePlayer = {
  getCurrentTime: () => number;
  destroy: () => void;
};

declare global {
  interface Window {
    YT?: {
      Player: new (element: HTMLElement, options: {
        videoId: string;
        playerVars?: Record<string, number>;
        events?: { onReady?: () => void };
      }) => YoutubePlayer;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

function apiBase() {
  return (window as { KARA_API_BASE_URL?: string }).KARA_API_BASE_URL || '';
}

function formatTime(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const rest = safeSeconds % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function formatDuration(seconds: number | null) {
  if (!seconds || !Number.isFinite(seconds)) return null;
  return formatTime(seconds);
}

function groupByTopic(entries: CatalogEntry[]) {
  const rows: { key: string; label: string; items: CatalogEntry[] }[] = [];
  if (entries.length) {
    rows.push({ key: '__recent', label: 'Yeni Eklenenler', items: entries.slice(0, 12) });
  }
  const byTopic = new Map<string, CatalogEntry[]>();
  for (const entry of entries) {
    const topic = (entry.topic || '').trim() || 'Diğer';
    if (!byTopic.has(topic)) byTopic.set(topic, []);
    byTopic.get(topic)!.push(entry);
  }
  for (const [topic, items] of byTopic) {
    rows.push({ key: topic, label: topic, items });
  }
  return rows;
}

let youtubeApiPromise: Promise<void> | null = null;
function loadYoutubeIframeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (youtubeApiPromise) return youtubeApiPromise;
  youtubeApiPromise = new Promise((resolve) => {
    const previousCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousCallback?.();
      resolve();
    };
    if (!document.getElementById('youtube-iframe-api')) {
      const script = document.createElement('script');
      script.id = 'youtube-iframe-api';
      script.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(script);
    }
  });
  return youtubeApiPromise;
}

// Escapes then re-applies a small, controlled markdown subset — mirrors the
// legacy renderMathMarkdown() so Kara answers read the same everywhere.
function renderMathMarkdown(value: string) {
  const escaped = value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const withBold = escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const html = withBold
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, '<br>')}</p>`)
    .join('');
  return { __html: html };
}

function safeUrl(value: string | undefined) {
  if (!value) return '';
  try {
    const url = new URL(value, window.location.href);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

export function KatalogView() {
  const [contentType, setContentType] = useState<ContentType>('lessons');
  const [tab, setTab] = useState<CatalogTab>('public');
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [cardEntries, setCardEntries] = useState<CardCatalogEntry[]>([]);
  const [cardPlayback, setCardPlayback] = useState<CardSessionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playback, setPlayback] = useState<PlaybackState | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const youtubeContainerRef = useRef<HTMLDivElement>(null);
  const youtubePlayerRef = useRef<YoutubePlayer | null>(null);

  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessagesByLesson, setChatMessagesByLesson] = useState<Record<string, ChatMessage[]>>({});
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);

  const [importUrl, setImportUrl] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importPanelOpen, setImportPanelOpen] = useState(false);

  useEffect(() => {
    if (contentType !== 'lessons') return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const base = apiBase();
        const path = tab === 'public' ? '/api/catalog' : '/api/catalog/mine';
        const headers: Record<string, string> = {};
        if (tab === 'private') {
          const token = window.KARA_AUTH?.getAccessToken();
          if (!token) throw new Error('Özel dersleri görmek için giriş yapmalısın.');
          headers.Authorization = `Bearer ${token}`;
        }
        const response = await fetch(`${base}${path}`, { headers });
        if (!response.ok) throw new Error(`Katalog yüklenemedi (${response.status})`);
        const data = await response.json();
        if (!cancelled) setEntries(data.lessons || []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Bilinmeyen hata');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [tab, contentType]);

  useEffect(() => {
    if (contentType !== 'cards') return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const base = apiBase();
        const path = tab === 'public' ? '/api/catalog/cards' : '/api/catalog/cards/mine';
        const headers: Record<string, string> = {};
        if (tab === 'private') {
          const token = window.KARA_AUTH?.getAccessToken();
          if (!token) throw new Error('Kendi kartlarını görmek için giriş yapmalısın.');
          headers.Authorization = `Bearer ${token}`;
        }
        const response = await fetch(`${base}${path}`, { headers });
        if (!response.ok) throw new Error(`Kart kataloğu yüklenemedi (${response.status})`);
        const data = await response.json();
        if (!cancelled) setCardEntries(data.sessions || []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Bilinmeyen hata');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [tab, contentType]);

  async function openCardSession(entry: CardCatalogEntry) {
    try {
      const base = apiBase();
      const headers: Record<string, string> = {};
      const path = tab === 'public'
        ? `/api/catalog/cards/${encodeURIComponent(entry.id)}`
        : `/api/cards/sessions/${encodeURIComponent(entry.id)}`;
      if (tab === 'private') {
        const token = window.KARA_AUTH?.getAccessToken();
        if (token) headers.Authorization = `Bearer ${token}`;
      }
      const response = await fetch(`${base}${path}`, { headers });
      if (!response.ok) throw new Error(`Kartlar açılamadı (${response.status})`);
      const data: { id: string; title: string; cards: (CardCatalogCard & { imageStoragePath?: string })[] } = await response.json();
      setCardPlayback({ id: data.id, title: data.title, cards: data.cards });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bilinmeyen hata');
    }
  }

  // Mount/replace the YouTube player whenever a YouTube lesson is opened.
  useEffect(() => {
    youtubePlayerRef.current?.destroy();
    youtubePlayerRef.current = null;
    if (!playback?.isYoutube || !playback.youtubeVideoId || !youtubeContainerRef.current) {
      return;
    }
    let cancelled = false;
    const videoId = playback.youtubeVideoId;
    const container = youtubeContainerRef.current;
    void loadYoutubeIframeApi().then(() => {
      if (cancelled || !window.YT) return;
      youtubePlayerRef.current = new window.YT.Player(container, {
        videoId,
        playerVars: { playsinline: 1 }
      });
    });
    return () => { cancelled = true; };
  }, [playback?.id, playback?.isYoutube, playback?.youtubeVideoId, chatOpen]);

  const rows = useMemo(() => groupByTopic(entries), [entries]);
  const hero = entries[0] || null;
  const activeMessages = playback ? chatMessagesByLesson[playback.id] || [] : [];

  async function fetchVideoUrl(lessonId: string, sourceTab: CatalogTab) {
    const base = apiBase();
    const headers: Record<string, string> = {};
    const path = sourceTab === 'public'
      ? `/api/catalog/${encodeURIComponent(lessonId)}/video-url`
      : `/api/lessons/${encodeURIComponent(lessonId)}/video-url`;
    if (sourceTab === 'private') {
      const token = window.KARA_AUTH?.getAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    const response = await fetch(`${base}${path}`, { headers });
    if (!response.ok) throw new Error(`Video açılamadı (${response.status})`);
    const data = await response.json();
    if (!data.videoUrl && !data.isYoutube) throw new Error('Bu ders için video bulunamadı.');
    return {
      url: data.videoUrl as string | null,
      isYoutube: Boolean(data.isYoutube),
      youtubeVideoId: (data.youtubeVideoId as string | null) || null
    };
  }

  async function openLesson(entry: CatalogEntry) {
    try {
      const access = await fetchVideoUrl(entry.id, tab);
      setPlayback({ id: entry.id, title: entry.title, posterUrl: entry.posterUrl, tab, ...access });
      setChatOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bilinmeyen hata');
    }
  }

  function openChat() {
    if (!playback) return;
    setChatMessagesByLesson((prev) => (prev[playback.id] ? prev : { ...prev, [playback.id]: [] }));
    setChatOpen(true);
  }

  // Sidebar geçmişindeki bir sohbet kullanıcının KENDİ dersi olabilir
  // (owned, /api/lessons/:id/video-url) ya da başka birinin herkese açık
  // dersi hakkında sorduğu bir soru olabilir (/api/catalog/:id/video-url,
  // sahiplik aranmaz) -- video her zaman sohbetle birlikte açılsın diye
  // önce owned dener, olmazsa public'e düşer.
  async function openLessonChatById(lessonId: string, title: string, posterUrl: string | null) {
    let access;
    try {
      access = await fetchVideoUrl(lessonId, 'private');
    } catch {
      try {
        access = await fetchVideoUrl(lessonId, 'public');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Bilinmeyen hata');
        return;
      }
    }
    setPlayback({ id: lessonId, title, posterUrl, tab: 'private', ...access });
    setChatMessagesByLesson((prev) => (prev[lessonId] ? prev : { ...prev, [lessonId]: [] }));
    setChatOpen(true);
  }

  // Sol sidebar (legacy app.js) gerçek katalog sohbet geçmişini
  // GET /api/catalog/chats'ten çekip listeler; bir öğeye tıklanınca bu event
  // üzerinden React tarafına köprüleniyor (window.KARA_AUTH ile aynı üslup).
  useEffect(() => {
    function handler(event: Event) {
      const detail = (event as CustomEvent<{ lessonId?: string; title?: string; posterUrl?: string | null }>).detail;
      if (detail?.lessonId) void openLessonChatById(detail.lessonId, detail.title || 'Ders', detail.posterUrl || null);
    }
    window.addEventListener('kara:open-catalog-chat', handler);
    return () => window.removeEventListener('kara:open-catalog-chat', handler);
  }, []);

  // Sidebar'daki "Kataloğu Keşfet" öğesi: açık bir sohbet varsa kapatıp
  // gezinme (grid) görünümüne dön.
  useEffect(() => {
    function handler() {
      setPlayback(null);
      setChatOpen(false);
    }
    window.addEventListener('kara:katalog-explore', handler);
    return () => window.removeEventListener('kara:katalog-explore', handler);
  }, []);

  function captureVideoFrame(): { mimeType: string; data: string } | null {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return null;
    try {
      const canvas = document.createElement('canvas');
      const sourceWidth = video.videoWidth || 1280;
      const sourceHeight = video.videoHeight || 720;
      const scale = Math.min(1, 640 / sourceWidth, 360 / sourceHeight);
      canvas.width = Math.max(1, Math.round(sourceWidth * scale));
      canvas.height = Math.max(1, Math.round(sourceHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) return null;
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      return { mimeType: 'image/jpeg', data: canvas.toDataURL('image/jpeg', 0.68) };
    } catch {
      return null;
    }
  }

  function currentPlaybackSeconds(): number {
    if (playback?.isYoutube) return youtubePlayerRef.current?.getCurrentTime() || 0;
    return videoRef.current?.currentTime || 0;
  }

  async function sendChatMessage() {
    const question = chatInput.trim();
    if (!question || chatBusy || !playback) return;
    const token = window.KARA_AUTH?.getAccessToken();
    if (!token) {
      const lessonId = playback.id;
      setChatMessagesByLesson((prev) => ({
        ...prev,
        [lessonId]: [...(prev[lessonId] || []), {
          role: 'assistant',
          timestamp: formatTime(currentPlaybackSeconds()),
          content: 'Cevap alinamadi: Sohbet için giriş yapmalısın.'
        }]
      }));
      return;
    }

    const lessonId = playback.id;
    const timestampSeconds = currentPlaybackSeconds();
    const timestampLabel = formatTime(timestampSeconds);
    // YouTube dersleri icin kare backend'de yt-dlp ile yakalaniyor (iframe
    // cross-origin oldugundan canvas ile kare alinamaz).
    const frame = playback.isYoutube ? null : captureVideoFrame();

    const priorHistory = (chatMessagesByLesson[lessonId] || []).filter((message) => !message.pending);
    const chatHistoryPayload = priorHistory.slice(-6).map((message) => ({
      role: message.role,
      timestamp: message.timestamp,
      content: message.content.slice(0, 1200)
    }));

    setChatInput('');
    setChatBusy(true);
    const userMessage: ChatMessage = { role: 'user', timestamp: timestampLabel, content: question };
    const pendingMessage: ChatMessage = { role: 'assistant', timestamp: timestampLabel, content: 'Düşünüyorum...', pending: true };
    setChatMessagesByLesson((prev) => ({ ...prev, [lessonId]: [...(prev[lessonId] || []), userMessage, pendingMessage] }));

    try {
      const base = apiBase();
      const response = await fetch(`${base}/api/ask-kara`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          question,
          frame,
          timestamp_seconds: timestampSeconds,
          timestamp_label: timestampLabel,
          lesson_title: playback.title,
          lesson_id: lessonId,
          chat_history: chatHistoryPayload,
          source: 'catalog'
        })
      });
      if (!response.ok) throw new Error(`Kara yanıt veremedi (${response.status})`);
      const data = await response.json();
      setChatMessagesByLesson((prev) => {
        const list = [...(prev[lessonId] || [])];
        const idx = list.lastIndexOf(pendingMessage);
        const resolved: ChatMessage = {
          role: 'assistant',
          timestamp: timestampLabel,
          content: data.answer || 'Bu soruya cevap üretilemedi.',
          visionUsed: data.visionUsed === true,
          toolsUsed: Array.isArray(data.toolsUsed) ? data.toolsUsed : [],
          artifacts: Array.isArray(data.artifacts) ? data.artifacts : [],
          sources: Array.isArray(data.sources) ? data.sources : []
        };
        if (idx >= 0) list[idx] = resolved; else list.push(resolved);
        return { ...prev, [lessonId]: list };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bilinmeyen hata';
      setChatMessagesByLesson((prev) => {
        const list = [...(prev[lessonId] || [])];
        const idx = list.lastIndexOf(pendingMessage);
        const resolved: ChatMessage = { role: 'assistant', timestamp: timestampLabel, content: `Cevap alinamadi: ${message}` };
        if (idx >= 0) list[idx] = resolved; else list.push(resolved);
        return { ...prev, [lessonId]: list };
      });
    } finally {
      setChatBusy(false);
    }
  }

  async function submitYoutubeImport() {
    const url = importUrl.trim();
    if (!url || importBusy) return;
    const token = window.KARA_AUTH?.getAccessToken();
    if (!token) {
      setImportError('İçe aktarmak için giriş yapmalısın.');
      return;
    }
    setImportBusy(true);
    setImportError(null);
    try {
      const base = apiBase();
      const response = await fetch(`${base}/api/catalog/import-youtube`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ url })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `İçe aktarılamadı (${response.status})`);
      setEntries((prev) => [{
        id: body.id,
        title: body.title,
        topic: body.topic,
        createdAt: body.createdAt,
        updatedAt: body.updatedAt,
        durationSeconds: body.durationSeconds,
        posterUrl: body.posterUrl
      }, ...prev]);
      setImportUrl('');
      setImportPanelOpen(false);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Bilinmeyen hata');
    } finally {
      setImportBusy(false);
    }
  }

  function closePlayback() {
    setPlayback(null);
    setChatOpen(false);
  }

  // Tam ekran sohbetten "geri" katalog gezinme (grid) ekranina degil,
  // bir onceki adim olan video onizlemesine doner -- gride donmek icin
  // artik sidebar'daki "Katalogu Kesfet" ogesi kullaniliyor.
  function backToPreview() {
    setChatOpen(false);
  }

  return (
    <section className="placeholderView katalogView hidden" id="katalogView" style={{ alignItems: 'stretch', padding: 0, minHeight: '100vh' }}>
      {!playback && !cardPlayback && (
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
        <div className="katalogHeaderBar">
          <div className="katalogHeaderTitle">
            <strong>Katalog</strong>
            <span>
              {contentType === 'lessons' ? `${entries.length} ders` : `${cardEntries.length} kart seti`}
              {' · '}
              {tab === 'public' ? 'Herkese açık' : 'Kendi içeriğim'}
            </span>
          </div>
          <div className="katalogHeaderControls">
            <div className="segmented">
              <button
                type="button"
                className={`chip${contentType === 'lessons' ? ' active' : ''}`}
                onClick={() => setContentType('lessons')}
              >
                Dersler
              </button>
              <button
                type="button"
                className={`chip${contentType === 'cards' ? ' active' : ''}`}
                onClick={() => setContentType('cards')}
              >
                Kartlar
              </button>
            </div>
            <div className="segmented">
              <button
                type="button"
                className={`chip${tab === 'public' ? ' active' : ''}`}
                onClick={() => setTab('public')}
              >
                Herkese Açık
              </button>
              <button
                type="button"
                className={`chip${tab === 'private' ? ' active' : ''}`}
                onClick={() => setTab('private')}
              >
                {contentType === 'lessons' ? 'Derslerim' : 'Kartlarım'}
              </button>
            </div>
          </div>
        </div>

        {error && <div className="katalogStatus katalogError">{error}</div>}

        {loading && (
          <div className="katalogSkeletonTrack">
            {Array.from({ length: 5 }).map((_, i) => (
              <div className="katalogSkeletonCard" key={i}>
                <div className="katalogSkeletonPoster" />
                <div className="katalogSkeletonLine" />
              </div>
            ))}
          </div>
        )}

        {contentType === 'lessons' && (
        <>
        {!loading && !error && entries.length === 0 && (
          <div className="katalogEmpty">
            <div className="katalogEmptyIcon">
              <svg viewBox="0 0 24 24">
                <rect x="3" y="5" width="18" height="13" rx="2.5" />
                <path d="M10 9.5v4l3.5-2z" />
              </svg>
            </div>
            <h3>{tab === 'public' ? 'Henüz herkese açık ders yok' : 'Henüz kendi dersin yok'}</h3>
            <p>
              {tab === 'public'
                ? 'Herkese açık dersler burada listelenecek. Bir kart oturumunu ya da dersi yayınladığında burada görünür.'
                : 'YouTube’dan bir video içe aktararak ya da bir kart oturumunu kaydederek ilk dersini oluşturabilirsin.'}
            </p>
            {tab === 'private' && (
              <button type="button" className="katalogEmptyAction" onClick={() => setImportPanelOpen(true)}>
                YouTube’dan Ekle
              </button>
            )}
          </div>
        )}

        {!loading && hero && (
          <div
            className="katalogHero"
            style={hero.posterUrl ? { backgroundImage: `url(${hero.posterUrl})` } : undefined}
          >
            <div className="katalogHeroOverlay">
              <div className="katalogHeroTopic">{hero.topic || 'Ders'}</div>
              <h1 className="katalogHeroTitle">{hero.title}</h1>
              <button type="button" className="katalogPlayBtn" onClick={() => void openLesson(hero)}>
                ▶ İzle
              </button>
            </div>
          </div>
        )}

        {!loading && (
        <div className="katalogRows">
          {rows.map((row) => (
            <div key={row.key} className="katalogRow">
              <div className="katalogRowLabel">{row.label}</div>
              <div className="katalogRowTrack">
                {row.items.map((entry) => (
                  <button
                    type="button"
                    key={`${row.key}-${entry.id}`}
                    className="katalogCard"
                    onClick={() => void openLesson(entry)}
                  >
                    <div
                      className="katalogCardPoster"
                      style={entry.posterUrl ? { backgroundImage: `url(${entry.posterUrl})` } : undefined}
                    >
                      {!entry.posterUrl && <span className="katalogCardPosterFallback">{entry.title.slice(0, 1)}</span>}
                      {formatDuration(entry.durationSeconds) && (
                        <span className="katalogCardDuration">{formatDuration(entry.durationSeconds)}</span>
                      )}
                    </div>
                    <div className="katalogCardTitle">{entry.title}</div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        )}
        </>
        )}

        {contentType === 'cards' && (
        <>
        {!loading && !error && cardEntries.length === 0 && (
          <div className="katalogEmpty">
            <div className="katalogEmptyIcon">
              <svg viewBox="0 0 24 24">
                <rect x="3" y="4" width="18" height="13" rx="3" />
                <path d="M7 21h10M12 17v4" />
              </svg>
            </div>
            <h3>{tab === 'public' ? 'Henüz herkese açık kart yok' : 'Henüz kendi kartın yok'}</h3>
            <p>
              {tab === 'public'
                ? 'Herkese açık kart oturumları burada listelenecek.'
                : 'Kart bölümünde bir soru ya da konu üzerine kart oturumu oluşturup kataloğa ekleyebilirsin.'}
            </p>
          </div>
        )}
        {!loading && (
        <div className="katalogRows">
          <div className="katalogRow">
            <div className="katalogRowLabel">{tab === 'public' ? 'Herkese Açık Kartlar' : 'Kartlarım'}</div>
            <div className="katalogRowTrack">
              {cardEntries.map((entry) => (
                <button
                  type="button"
                  key={entry.id}
                  className="katalogCard"
                  onClick={() => void openCardSession(entry)}
                >
                  <div
                    className="katalogCardPoster"
                    style={entry.posterUrl ? { backgroundImage: `url(${entry.posterUrl})` } : undefined}
                  >
                    {!entry.posterUrl && <span className="katalogCardPosterFallback">{entry.title.slice(0, 1)}</span>}
                    <span className="katalogCardDuration">{entry.cardCount} kart</span>
                  </div>
                  <div className="katalogCardTitle">{entry.title}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
        )}
        </>
        )}
      </div>
      )}

      {!playback && !cardPlayback && contentType === 'lessons' && tab === 'private' && (
        <>
          {importPanelOpen && (
            <div className="katalogYoutubeFab-backdrop" onClick={() => setImportPanelOpen(false)}>
              <div className="katalogYoutubeFab-panel" onClick={(event) => event.stopPropagation()}>
                <div className="katalogYoutubeFab-panelHeader">
                  <strong>YouTube'dan Ekle</strong>
                  <button type="button" className="katalogPlayerClose" onClick={() => setImportPanelOpen(false)} aria-label="Kapat">✕</button>
                </div>
                <input
                  value={importUrl}
                  onChange={(event) => setImportUrl(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') void submitYoutubeImport(); }}
                  placeholder="YouTube video linki…"
                  className="katalogImportInput"
                  disabled={importBusy}
                  autoFocus
                />
                <button type="button" className="katalogOpenChatBtn" onClick={() => void submitYoutubeImport()} disabled={importBusy}>
                  {importBusy ? 'Ekleniyor…' : 'Ekle'}
                </button>
                {importError && <span className="katalogError" style={{ fontSize: 13 }}>{importError}</span>}
              </div>
            </div>
          )}
          <button
            type="button"
            className="katalogYoutubeFab"
            onClick={() => setImportPanelOpen((open) => !open)}
            aria-label="YouTube'dan ekle"
            title="YouTube'dan ekle"
          >
            <svg viewBox="0 0 28 20" width="26" height="19" aria-hidden="true" className="katalogYoutubeFabIcon">
              <path fill="#fff" d="M27.4 3.1c-.3-1.2-1.3-2.1-2.5-2.4C22.7.1 14 .1 14 .1s-8.7 0-10.9.6C1.9 1 1 1.9.6 3.1 0 5.3 0 10 0 10s0 4.7.6 6.9c.3 1.2 1.3 2.1 2.5 2.4C5.3 19.9 14 19.9 14 19.9s8.7 0 10.9-.6c1.2-.3 2.1-1.3 2.5-2.4.6-2.2.6-6.9.6-6.9s0-4.7-.6-6.9z" />
              <path fill="#e53935" d="M11.2 14.3 18.5 10l-7.3-4.3z" />
            </svg>
            <span>YouTube'dan Ekle</span>
          </button>
        </>
      )}

      {playback && !chatOpen && (
        <div className="katalogPreviewOverlay" onClick={closePlayback}>
          <div className="katalogPreviewCard" onClick={(event) => event.stopPropagation()}>
            <div className="katalogPlayerHeader">
              <strong>{playback.title}</strong>
              <button type="button" className="katalogPlayerClose" onClick={closePlayback} aria-label="Kapat">✕</button>
            </div>

            {playback.isYoutube ? (
              <div className="katalogYoutubeFrame">
                <div ref={youtubeContainerRef} style={{ width: '100%', height: '100%' }} />
              </div>
            ) : (
              <video ref={videoRef} src={playback.url || undefined} controls autoPlay playsInline crossOrigin="anonymous" style={{ width: '100%', display: 'block' }} />
            )}

            <div className="katalogChatBox">
              <button type="button" className="katalogOpenChatBtn" onClick={openChat}>
                Open in chat
              </button>
            </div>
          </div>
        </div>
      )}

      {playback && chatOpen && (
        <div className="katalogPlayerPage">
          <div className="katalogPlayerPageHeader">
            <button type="button" className="katalogPlayerClose" onClick={backToPreview} aria-label="Geri">←</button>
            <h2>{playback.title}</h2>
          </div>
          <div className="katalogPlayerCard">
            <div className="katalogPlayerMain">
              {playback.isYoutube ? (
                <div className="katalogYoutubeFrame">
                  <div ref={youtubeContainerRef} style={{ width: '100%', height: '100%' }} />
                </div>
              ) : (
                <video ref={videoRef} src={playback.url || undefined} controls autoPlay playsInline crossOrigin="anonymous" style={{ width: '100%', display: 'block' }} />
              )}

              {chatOpen && (
                <div className="katalogChatThread">
                  <div className="katalogChatMessages">
                    {activeMessages.length === 0 && (
                      <p className="katalogStatus">Bu ders hakkında Kara'ya bir soru sor.</p>
                    )}
                    {activeMessages.map((message, index) => (
                      <article
                        key={index}
                        className={`chatMessage ${message.role === 'assistant' ? 'assistant' : 'user'}${message.pending ? ' pending' : ''}`}
                        aria-busy={message.pending || undefined}
                      >
                        <div className="chatMeta">
                          {message.role === 'assistant'
                            ? `Kara${message.pending ? ' · kare inceleniyor' : message.visionUsed === true ? ' · kareyi gördü' : message.visionUsed === false ? ' · yalnızca metin bağlamı' : ''}`
                            : `Sen · ${message.timestamp}`}
                        </div>
                        <div className="chatContent">
                          {message.pending ? (
                            <div className="chatThinking">
                              <span>Kara düşünüyor</span>
                              <span className="typingDots" aria-hidden="true"><i /><i /><i /></span>
                            </div>
                          ) : (
                            <>
                              <div dangerouslySetInnerHTML={renderMathMarkdown(message.content)} />
                              {!!message.toolsUsed?.length && (
                                <div className="karaToolBadges">
                                  {message.toolsUsed.map((tool, i) => (
                                    <span key={i}>{tool === 'web_search' ? 'Web araması' : tool === 'generate_manim' ? 'Manim görseli' : tool}</span>
                                  ))}
                                </div>
                              )}
                              {message.artifacts?.filter((a) => a.type === 'image' && safeUrl(a.url)).map((artifact, i) => (
                                <figure className="karaArtifact" key={i}>
                                  <img src={safeUrl(artifact.url)} alt={artifact.title || 'Kara tarafından oluşturulan Manim görseli'} loading="lazy" />
                                  <figcaption>{artifact.title || 'Kara Manim görseli'}</figcaption>
                                </figure>
                              ))}
                              {!!message.sources?.filter((s) => safeUrl(s.url)).length && (
                                <div className="karaSources">
                                  <strong>Kaynaklar</strong>
                                  {message.sources.filter((s) => safeUrl(s.url)).map((source, i) => (
                                    <a key={i} href={safeUrl(source.url)} target="_blank" rel="noopener noreferrer">{source.title || source.url}</a>
                                  ))}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                  <div className="katalogChatInputRow">
                    <input
                      value={chatInput}
                      onChange={(event) => setChatInput(event.target.value)}
                      onKeyDown={(event) => { if (event.key === 'Enter') void sendChatMessage(); }}
                      placeholder="Bu ders hakkında bir şey sor…"
                      className="katalogChatInput"
                      disabled={chatBusy}
                    />
                    <button type="button" className="cardsSendBtn" onClick={() => void sendChatMessage()} disabled={chatBusy} aria-label="Gönder">
                      <svg viewBox="0 0 24 24">
                        <path d="M5 12h14M13 6l6 6-6 6" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {cardPlayback && (
        <div className="katalogPreviewOverlay" onClick={() => setCardPlayback(null)}>
          <div className="katalogPreviewCard" onClick={(event) => event.stopPropagation()}>
            <div className="katalogPlayerHeader">
              <strong>{cardPlayback.title}</strong>
              <button type="button" className="katalogPlayerClose" onClick={() => setCardPlayback(null)} aria-label="Kapat">✕</button>
            </div>
            <div className="katalogCardPlaybackList">
              {cardPlayback.cards.map((card, index) => (
                <div key={index} className="cardsCard">
                  {card.imageUrl && (
                    <div className="cardsCardMedia">
                      <img src={card.imageUrl} alt={card.title} />
                      <span className="cardsCardBadge">Kart {index + 1}</span>
                    </div>
                  )}
                  <div className="cardsCardBody">
                    <div className="cardsCardTitle">{card.title}</div>
                    <div className="cardsCardExplanation">{card.explanation}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
