---
name: manim-skill
description: Create mathematical animations with Manim Community Edition (manimce). Generates distinctive, production-grade animations that avoid generic "AI slop" aesthetics. Use when user wants to animate concepts, equations, illustrate proofs, visualize algorithms, create math explainers, or produce 3Blue1Brown-style videos.
---

## Kara Tahta Uygulama Notu

**Current local override:** This app runs generated code directly inside the Kara Tahta backend as one Python file and one Scene/MovingCameraScene class per segment. Do not create folders, `plan.md`, `script.py`, `concat.txt`, viewer commands, or multiple Scene classes.

**Current render environment:** LaTeX/dvisvgm is available through MiKTeX. Use `MathTex(r"...")` for mathematical formulas and symbols, and use `Text(..., font="Georgia")` for natural-language labels and explanations.

Bu repo içinde bu belge Manim kodu yazan modele kalite rehberi olarak verilir. Kara Tahta uygulaması ayrı proje klasörü, `plan.md`, `script.py`, `concat.txt` veya viewer komutu istemez; backend her segment için tek Python dosyası oluşturur ve tek Scene/MovingCameraScene sınıfı çalıştırır.

Bu nedenle bu belge kullanılırken aşağıdaki kurallar daha önceliklidir:
- Çıktı yalnızca çalışabilir Python kodu olmalı; markdown fence, açıklama veya shell komutu yazılmaz.
- Tek Scene veya MovingCameraScene sınıfı üretilir.
- `from manim import *` kullanılır ve Manim Community v0.20.1 uyumluluğu korunur.
- **Matematik sembolleri için her zaman `MathTex` kullanılır** (aşağıya bkz.).
- Konuşma metni ekrana paragraf olarak basılmaz; kısa adımlar, anahtar kelimeler, diyagramlar ve sezgisel görsel akışlara dönüştürülür.
- Segment sonunda gereksiz uzun bekleme bırakılmaz; animasyon süresi ses süresine yakın tutulur.
- **Sahne taşmalarını önlemek için tüm kurallar zorunludur** — `rules/layout-safety.md` oku.

---

## Kod Yazmadan Önce Referans Dosyalarını Oku

| İhtiyaç | Dosya |
|---|---|
| Matematiksel semboller (kök, limit, integral, ok…) | `rules/math-rendering.md` ← **Her zaman oku** |
| Sahne taşma önleme, frame sınırları | `rules/layout-safety.md` ← **Her zaman oku** |
| Sahne yapısı, geçişler, kamera | `rules/scenes.md` |
| Animasyon desenleri, zamanlama | `rules/animations.md` |

---

## Metin Render Kuralı (KRİTİK)

### Matematik → Daima `MathTex`

```python
# ✗ YANLIŞ — Georgia fontu matematiksel sembolleri bozar
title = Text("√x + lim_{x→0}", font="Georgia")   # kök üstü taşar, ok garip görünür

# ✓ DOĞRU — LaTeX render her zaman doğru sonuç verir
formula = MathTex(r"\sqrt{x} + \lim_{x \to 0} f(x)")
```

**Kural:** Formül, sembol veya matematiksel ifade içeren her şey `MathTex` veya `Tex`'tir. `Text` yalnızca saf Türkçe/İngilizce açıklama cümleleri için kullanılır.

### `MathTex` Renklendirme Şablonu

```python
# Parçaları izole et ve renklendir
formula = MathTex(
    r"\frac{d}{dx}", r"\Big[", r"f(g(x))", r"\Big]",
    r"=", r"f'(g(x))", r"\cdot", r"g'(x)"
)
formula[2].set_color(BLUE)   # f(g(x)) mavi
formula[5].set_color(YELLOW) # f'(g(x)) sarı
formula[7].set_color(GREEN)  # g'(x) yeşil
```

### `MathTex` Yazı Boyutu

```python
# font_size Manim v0.18+ ile çalışır; eskide scale() kullan
big   = MathTex(r"\sqrt{x}", font_size=72)
small = MathTex(r"\sqrt{x}").scale(0.6)
```

### `GrowArrow` Kullanma (KRİTİK — v0.20.1'de kırık)

```python
# ✗ YANLIŞ — GrowArrow, kurulu manim==0.20.1 surumunde
# VMobject.scale() icin scale_tips kwarg hatasi verip render'i kilitler
self.play(GrowArrow(arrow))

# ✓ DOĞRU — ayni gorsel etkiyi verir, kirilmaz
self.play(Create(arrow))
```

**Kural:** Ok (Arrow/Vector) buyume animasyonu icin `GrowArrow` yerine daima `Create` veya `GrowFromPoint(arrow, arrow.get_start())` kullan.

---

## Project Structure

```
<project-name>/
├── plan.md
├── script.py
├── concat.txt
├── final.mp4
└── media/
    └── videos/script/480p15/
```

```bash
mkdir -p <project-name> && cd <project-name>
```

---

## Workflow Overview

```
Plan → Code → Render → Iterate
```

### Phase 1: Plan

`plan.md` dosyasına yaz:

```markdown
# [Video Title]

## Overview
- **Topic**: [Core concept]
- **Hook**: [Opening question/mystery]
- **Target Audience**: [Prerequisites]
- **Estimated Length**: [X minutes]
- **Key Insight**: [The "aha moment"]
- **Resolution**: [480p(default), 1080p]
- **Aspect Ratio**: [16:9(default) / 9:16 / 1:1]

## Narrative Arc
[2-3 sentences describing the journey from confusion to understanding]

---

## Scene N: [Scene Name]
**Duration**: ~X seconds
**Purpose**: [What this scene accomplishes]

### Visual Elements
- [List of mobjects needed]
- [Animations to use]

### Content
[Detailed description]

### Voiceover
- **Text**: "[Exact script or key points]"
- **Sync Points**: "[phrase]" → syncs with [animation]

### Technical Notes
- [Specific Manim classes/methods to use]
```

---

### Phase 2: Code

**Kodu yazmadan önce `rules/math-rendering.md` ve `rules/layout-safety.md` dosyalarını oku.**

`script.py` dosyasına yaz:

```python
from manim import *

class Scene1_Introduction(MovingCameraScene):
    def construct(self):
        self.add_subcaption("Konuyu tanıyalım", duration=2)

        title = Text("Türev", font_size=52, color=BLUE)
        # Formüller için MathTex kullan:
        formula = MathTex(r"f'(x) = \lim_{h \to 0} \frac{f(x+h)-f(x)}{h}",
                          font_size=40)
        formula.next_to(title, DOWN, buff=0.5)

        # Taşma kontrolü — her zaman yap
        group = VGroup(title, formula)
        if group.width > config.frame_width * 0.85:
            group.scale_to_fit_width(config.frame_width * 0.85)

        self.play(Write(title))
        self.play(Write(formula), subcaption="Limit tanımı", subcaption_duration=2)
        self.wait(1)
        self.play(FadeOut(group))
```

---

### Phase 3: Render

```bash
manim -ql [--media_dir <output_dir>] <script.py> Scene1 Scene2 ...
```

**Kalite bayrakları:**
- `-ql` — 480p15 (varsayılan, test için)
- `-qh` — 1080p60 (kullanıcı açıkça isterse)

**Hata alınırsa:** Hatayı oku, kodu düzelt, sadece hatalı sahneleri yeniden render et.

**Sahneleri birleştir:**

```bash
cat > concat.txt << 'EOF'
file 'media/videos/script/480p15/Scene1_Intro.mp4'
file 'media/videos/script/480p15/Scene2_Main.mp4'
EOF

ffmpeg -y -f concat -safe 0 -i concat.txt -c copy final.mp4
```

---

### Phase 4: Iterate

```bash
python3 ../tools/video_viewer.py final.mp4 --order concat.txt [--script script.py]
```

Geri bildirim alındığında: değişen sahneleri düzelt → sadece onları render et → yeniden birleştir.
