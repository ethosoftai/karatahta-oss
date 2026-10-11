import { useEffect, useRef, useState, type ChangeEvent } from 'react';

type Card = { index: number; title: string; explanation: string; imageDataUrl: string };
type ChatTurn = { role: 'user' | 'assistant'; content: string };
type FeedItem =
  | { kind: 'user'; text: string }
  | { kind: 'card'; card: Card }
  | { kind: 'assistant'; text: string };

const SUGGESTIONS = [
  'İkinci dereceden denklemi çöz: x²-5x+6=0',
  'Türev kurallarını örnekle anlat',
  'Pisagor teoremini kanıtla',
  'Kesirlerde toplama nasıl yapılır?'
];

async function* readNdjson(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.trim()) yield JSON.parse(line);
    }
  }
  if (buffer.trim()) yield JSON.parse(buffer);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Fotoğraf okunamadı.'));
    reader.readAsDataURL(file);
  });
}

function exportFeed(feed: FeedItem[]) {
  const body = feed.map((item) => {
    if (item.kind === 'user') {
      return `<p><strong>Soru:</strong> ${item.text}</p>`;
    }
    if (item.kind === 'assistant') {
      return `<p><strong>Öğretmen:</strong> ${item.text}</p>`;
    }
    return `<div style="margin:16px 0"><h3>${item.card.title}</h3>
      <img src="${item.card.imageDataUrl}" style="max-width:480px;display:block;border-radius:8px" />
      <p>${item.card.explanation}</p></div>`;
  }).join('\n');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Kara Tahta - Kartlar</title></head>
    <body style="font-family:sans-serif;background:#0f1011;color:#f7f8f8;padding:24px">${body}</body></html>`;
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'karatahta-kartlar.html';
  a.click();
  URL.revokeObjectURL(url);
}

export function CardsView() {
  const [prompt, setPrompt] = useState('');
  const [questionImage, setQuestionImage] = useState<File | null>(null);
  const [questionImagePreview, setQuestionImagePreview] = useState<string | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [chatHistory, setChatHistory] = useState<ChatTurn[]>([]);
  const [cardsReady, setCardsReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isPublic, setIsPublic] = useState(false);
  const [publishBusy, setPublishBusy] = useState(false);
  const feedRef = useRef<HTMLDivElement | null>(null);

  function apiBase() {
    return (window as { KARA_API_BASE_URL?: string }).KARA_API_BASE_URL || '';
  }

  function authHeaders(): Record<string, string> {
    const token = window.KARA_AUTH?.getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [feed, busy]);

  useEffect(() => {
    if (!questionImage) {
      setQuestionImagePreview(null);
      return;
    }
    const url = URL.createObjectURL(questionImage);
    setQuestionImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [questionImage]);

  // First message: generates the card sequence. Accepts a typed topic/
  // question and/or a question photo (transcribed to text on the backend).
  async function generate(text: string, imageFile: File | null) {
    setFeed((prev) => [...prev, { kind: 'user', text: text || '(fotoğraftan soru)' }]);
    try {
      const body: Record<string, unknown> = {};
      if (text) body.prompt = text;
      if (imageFile) {
        body.question_image = { mimeType: imageFile.type, data: await readFileAsDataUrl(imageFile) };
      }
      const response = await fetch(`${apiBase()}/api/cards/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body)
      });
      if (!response.ok) throw new Error(`Sunucu hatasi (${response.status})`);
      const batch: Card[] = [];
      for await (const event of readNdjson(response)) {
        if (event.type === 'card') {
          const card = event.card as Card;
          batch.push(card);
          setFeed((prev) => [...prev, { kind: 'card', card }]);
        } else if (event.type === 'session') {
          setSessionId(event.id as string);
        } else if (event.type === 'error') {
          setError(event.message);
        }
      }
      if (batch.length) {
        setCards((prev) => [...prev, ...batch]);
        setCardsReady(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bilinmeyen hata');
    }
  }

  // Kataloğa ekle/kaldır: kart oturumu kaydedildikten (sessionId varken)
  // sonra kullanılabilir. Herkese açık "Kartlar" katalog listesinde
  // gösterilip gösterilmeyeceğini belirler.
  async function togglePublish() {
    if (!sessionId || publishBusy) return;
    const nextValue = !isPublic;
    setPublishBusy(true);
    try {
      const response = await fetch(`${apiBase()}/api/cards/sessions/${encodeURIComponent(sessionId)}/${nextValue ? 'publish' : 'unpublish'}`, {
        method: 'POST',
        headers: authHeaders()
      });
      if (!response.ok) throw new Error(`İşlem başarısız (${response.status})`);
      setIsPublic(nextValue);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bilinmeyen hata');
    } finally {
      setPublishBusy(false);
    }
  }

  // Follow-up messages once cards are on screen: a normal chat turn about
  // the cards just shown, same shape as ask-kara (question + history in,
  // answer text out) -- no new cards are generated here.
  async function askFollowUp(text: string) {
    setFeed((prev) => [...prev, { kind: 'user', text }]);
    const nextHistory = [...chatHistory, { role: 'user' as const, content: text }];
    setChatHistory(nextHistory);
    try {
      const response = await fetch(`${apiBase()}/api/cards/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ question: text, cards, history: nextHistory, session_id: sessionId })
      });
      if (!response.ok) throw new Error(`Sunucu hatasi (${response.status})`);
      const data: { answer: string } = await response.json();
      setFeed((prev) => [...prev, { kind: 'assistant', text: data.answer }]);
      setChatHistory((prev) => [...prev, { role: 'assistant', content: data.answer }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bilinmeyen hata');
    }
  }

  // Sol sidebar (legacy app.js) GET /api/cards/sessions'tan gerçek kart
  // geçmişini listeler; bir öğeye tıklanınca bu event üzerinden React
  // tarafına köprüleniyor.
  useEffect(() => {
    async function openSession(id: string) {
      setError(null);
      try {
        const response = await fetch(`${apiBase()}/api/cards/sessions/${encodeURIComponent(id)}`, { headers: authHeaders() });
        if (!response.ok) throw new Error(`Oturum acilamadi (${response.status})`);
        const data: { id: string; title: string; cards: (Card & { imageUrl: string | null })[]; messages: { role: 'user' | 'assistant'; content: string }[]; isPublic?: boolean } = await response.json();
        const loadedCards: Card[] = data.cards.map((card, index) => ({
          index,
          title: card.title,
          explanation: card.explanation,
          imageDataUrl: card.imageUrl || ''
        }));
        const loadedFeed: FeedItem[] = [
          ...loadedCards.map((card): FeedItem => ({ kind: 'card', card })),
          ...data.messages.map((message): FeedItem => (
            message.role === 'user' ? { kind: 'user', text: message.content } : { kind: 'assistant', text: message.content }
          ))
        ];
        setSessionId(data.id);
        setCards(loadedCards);
        setFeed(loadedFeed);
        setChatHistory(data.messages.map((message) => ({ role: message.role, content: message.content })));
        setCardsReady(true);
        setIsPublic(Boolean(data.isPublic));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Bilinmeyen hata');
      }
    }
    function handler(event: Event) {
      const detail = (event as CustomEvent<{ sessionId?: string }>).detail;
      if (detail?.sessionId) void openSession(detail.sessionId);
    }
    window.addEventListener('kara:open-card-session', handler);
    return () => window.removeEventListener('kara:open-card-session', handler);
  }, []);

  // Sidebar'daki "Yeni sohbet" ogesi: mevcut kart oturumunu birakip
  // bos bir oturumla basa dön.
  useEffect(() => {
    function handler() {
      setSessionId(null);
      setCards([]);
      setFeed([]);
      setChatHistory([]);
      setCardsReady(false);
      setError(null);
      setPrompt('');
      setQuestionImage(null);
      setIsPublic(false);
    }
    window.addEventListener('kara:card-new-session', handler);
    return () => window.removeEventListener('kara:card-new-session', handler);
  }, []);

  async function send() {
    const text = prompt.trim();
    if ((!text && !questionImage) || busy) return;
    setBusy(true);
    setError(null);
    setPrompt('');
    const imageFile = questionImage;
    setQuestionImage(null);
    if (cardsReady) {
      if (text) await askFollowUp(text);
    } else {
      await generate(text, imageFile);
    }
    setBusy(false);
  }

  function onPickImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    if (file && !file.type.startsWith('image/')) {
      setError('Lütfen bir fotoğraf dosyası seçin.');
      return;
    }
    setQuestionImage(file);
  }

  const totalCards = cards.length;

  return (
    <section className="placeholderView cardsView hidden" id="cardView">
      <div className="cardsViewInner">
        <div className="cardsViewHeader">
          <div className="cardsViewHeaderTitle">
            <strong>Kart</strong>
            <span>
              {cardsReady
                ? `${totalCards} kart · ${isPublic ? 'Katalogda yayında' : 'Taslak'}`
                : 'Soru ya da konu ile yeni bir kart dizisi başlat'}
            </span>
          </div>
          <div className="cardsViewHeaderActions">
            {sessionId && (
              <button
                type="button"
                className={`iconTextButton cardsPublishBtn${isPublic ? ' isPublic' : ''}`}
                disabled={publishBusy}
                onClick={() => void togglePublish()}
              >
                {publishBusy ? '…' : isPublic ? 'Kataloğu kaldır' : 'Kataloğa ekle'}
              </button>
            )}
            <button type="button" className="iconTextButton" disabled={feed.length === 0} onClick={() => exportFeed(feed)}>
              Dışa aktar
            </button>
          </div>
        </div>

        <div className="cardsFeed" ref={feedRef}>
          {feed.length === 0 && (
            <div className="cardsEmpty">
              <div className="cardsEmptyIcon">
                <svg viewBox="0 0 24 24">
                  <rect x="3" y="4" width="18" height="13" rx="3" />
                  <path d="M7 21h10M12 17v4" />
                </svg>
              </div>
              <h3>Bir soru sor, kartlarla öğren</h3>
              <p>
                Bir soru ya da konu yaz — örn. &quot;ikinci dereceden denklemi çöz: x²-5x+6=0&quot; — kartlar
                sırayla üretilsin. İstersen soru metni yerine bir soru fotoğrafı da ekleyebilirsin.
              </p>
              <div className="cardsSuggestions">
                {SUGGESTIONS.map((suggestion) => (
                  <button key={suggestion} type="button" onClick={() => setPrompt(suggestion)}>
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}
          {feed.map((item, i) => {
            if (item.kind === 'user') {
              return (
                <div key={i} className="cardsBubbleRow user">
                  <div className="cardsBubble user">{item.text}</div>
                </div>
              );
            }
            if (item.kind === 'assistant') {
              return (
                <div key={i} className="cardsBubbleRow assistant">
                  <div className="cardsBubble assistant">{item.text}</div>
                </div>
              );
            }
            return (
              <div key={i} className="cardsCard">
                <div className="cardsCardMedia">
                  {item.card.imageDataUrl ? (
                    <img src={item.card.imageDataUrl} alt={item.card.title} />
                  ) : (
                    <div className="cardsCardMediaFallback">Görsel yok</div>
                  )}
                  <span className="cardsCardBadge">Kart {item.card.index + 1}</span>
                </div>
                <div className="cardsCardBody">
                  <div className="cardsCardTitle">{item.card.title}</div>
                  <div className="cardsCardExplanation">{item.card.explanation}</div>
                </div>
              </div>
            );
          })}
          {busy && (
            <div className="cardsStatusRow">
              <span className="typingDots"><i /><i /><i /></span>
              {cardsReady ? 'Cevap yazılıyor…' : 'Kart üretiliyor…'}
            </div>
          )}
          {error && <div className="cardsErrorBanner">{error}</div>}
        </div>

        {!cardsReady && questionImage && (
          <div className="cardsAttachmentPreview">
            {questionImagePreview && <img src={questionImagePreview} alt="" />}
            <span>{questionImage.name}</span>
            <button type="button" className="cardsAttachmentRemove" onClick={() => setQuestionImage(null)} aria-label="Fotoğrafı kaldır">
              ×
            </button>
          </div>
        )}

        <div className="cardsComposer">
          {!cardsReady && (
            <label className="cardsAttachBtn" title="Soru fotoğrafı ekle">
              <svg viewBox="0 0 24 24">
                <path d="M21 15v3a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-3M17 8l-5-5-5 5M12 3v13" />
              </svg>
              <input type="file" accept="image/*" onChange={onPickImage} style={{ display: 'none' }} />
            </label>
          )}
          <input
            className="cardsComposerInput"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void send(); }}
            placeholder={cardsReady ? 'Kartlarla ilgili takip sorusu sor…' : 'Soru veya konu yaz…'}
          />
          <button type="button" onClick={() => void send()} disabled={busy || (!prompt.trim() && !questionImage)} className="cardsSendBtn" aria-label="Gönder">
            <svg viewBox="0 0 24 24">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      </div>
    </section>
  );
}
