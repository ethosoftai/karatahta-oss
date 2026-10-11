import { useEffect, useRef, useState } from 'react';

type SceneStep = {
  type: 'text' | 'circle' | 'rect' | 'arrow' | 'line';
  x: number; y: number; x1: number; y1: number; x2: number; y2: number;
  w: number; h: number; r: number;
  text: string; size: number; color: string; fill: boolean; align: 'left' | 'center' | 'right';
};

type ChatTurn = { role: 'user' | 'assistant'; text: string };

const STEP_DELAY_MS = 550;

function drawStep(ctx: CanvasRenderingContext2D, step: SceneStep, width: number, height: number) {
  ctx.strokeStyle = step.color;
  ctx.fillStyle = step.color;
  ctx.lineWidth = 3;
  switch (step.type) {
    case 'text':
      ctx.font = `600 ${step.size}px Inter, sans-serif`;
      ctx.textAlign = step.align;
      ctx.fillText(step.text, step.x * width, step.y * height);
      break;
    case 'circle':
      ctx.beginPath();
      ctx.arc(step.x * width, step.y * height, step.r * Math.min(width, height), 0, Math.PI * 2);
      step.fill ? ctx.fill() : ctx.stroke();
      break;
    case 'rect':
      step.fill
        ? ctx.fillRect(step.x * width, step.y * height, step.w * width, step.h * height)
        : ctx.strokeRect(step.x * width, step.y * height, step.w * width, step.h * height);
      break;
    case 'line':
      ctx.beginPath();
      ctx.moveTo(step.x1 * width, step.y1 * height);
      ctx.lineTo(step.x2 * width, step.y2 * height);
      ctx.stroke();
      break;
    case 'arrow': {
      const x1 = step.x1 * width; const y1 = step.y1 * height;
      const x2 = step.x2 * width; const y2 = step.y2 * height;
      const angle = Math.atan2(y2 - y1, x2 - x1);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      const headLen = 12;
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
      break;
    }
    default:
      break;
  }
}

export function LiveTeacherView() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [prompt, setPrompt] = useState('');
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function playScene(steps: SceneStep[]) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = width * devicePixelRatio;
    canvas.height = height * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.clearRect(0, 0, width, height);
    for (const step of steps) {
      drawStep(ctx, step, width, height);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => { setTimeout(resolve, STEP_DELAY_MS); });
    }
  }

  async function send() {
    const text = prompt.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    setPrompt('');
    const nextHistory = [...history, { role: 'user' as const, text }];
    setHistory(nextHistory);
    try {
      const base = (window as { KARA_API_BASE_URL?: string }).KARA_API_BASE_URL || '';
      const response = await fetch(`${base}/api/live-teacher/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text, history: nextHistory })
      });
      if (!response.ok) throw new Error(`Sunucu hatasi (${response.status})`);
      const data: { reply: string; scene: { steps: SceneStep[] } } = await response.json();
      setHistory((prev) => [...prev, { role: 'assistant', text: data.reply }]);
      void playScene(data.scene?.steps || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bilinmeyen hata');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && !event.shiftKey && document.activeElement?.id === 'liveTeacherInput') {
        event.preventDefault();
        void send();
      }
    };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  });

  return (
    <section className="placeholderView hidden" id="liveTeacherView" style={{ alignItems: 'stretch', padding: 0, minHeight: '100vh' }}>
      <div style={{ display: 'flex', width: '100%', height: '100%', gap: 16, padding: 16, boxSizing: 'border-box' }}>
        <div style={{
          flex: '1 1 60%', background: '#000', borderRadius: 14, border: '1px solid var(--border)',
          position: 'relative', minHeight: 320
        }}
        >
          <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block', borderRadius: 14 }} />
        </div>

        <div style={{
          flex: '1 1 40%', display: 'flex', flexDirection: 'column', minWidth: 280,
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden'
        }}
        >
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontWeight: 600 }}>
            Canlı öğretmen
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {history.length === 0 && (
              <p style={{ color: 'var(--muted)', fontSize: 14 }}>
                Bir soru sor, örn. &quot;fotosentez nasıl çalışır?&quot; — tahtaya canlı çizerek anlatayım.
              </p>
            )}
            {history.map((turn, i) => (
              <div
                key={i}
                style={{
                  alignSelf: turn.role === 'user' ? 'flex-end' : 'flex-start',
                  background: turn.role === 'user' ? 'var(--primary)' : 'var(--surface-2)',
                  color: turn.role === 'user' ? 'var(--primary-text)' : 'var(--text)',
                  padding: '8px 12px', borderRadius: 10, maxWidth: '90%', fontSize: 14, lineHeight: 1.4
                }}
              >
                {turn.text}
              </div>
            ))}
            {busy && <div style={{ color: 'var(--muted)', fontSize: 13 }}>Düşünüyor ve çiziyor…</div>}
            {error && <div style={{ color: '#f87171', fontSize: 13 }}>{error}</div>}
          </div>
          <div style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid var(--border)' }}>
            <input
              id="liveTeacherInput"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Bir şey sor…"
              style={{
                flex: 1, background: 'var(--surface-3)', border: '1px solid var(--border)',
                borderRadius: 8, padding: '8px 10px', color: 'var(--text)'
              }}
            />
            <button type="button" onClick={() => void send()} disabled={busy} className="primaryAction">
              Gönder
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
