---
name: subject-biyoloji
description: Biyoloji derslerinde kullanılacak Manim animasyon örüntüleri (hücre, DNA, sistemler, döngüler).
---

# Branş: Biyoloji

## Kullanılacak Yapılar

- **Hücre diyagramı:** Dış zar için büyük `Ellipse`/`Circle`, organeller için küçük `Circle`/`Ellipse` (çekirdek ortada büyükçe, mitokondri uzun oval), her organeli `Text(font_size=18)` ile etiketle ve `Arrow`/`Line` ile bağla.
- **DNA çift sarmalı:** İki `ParametricFunction` (sinüs faz kaymalı) ile omurgaları çiz, aralarına düzenli aralıklarla kısa `Line` (baz çiftleri) yerleştir; tam 3D sarmal yerine 2D stilize gösterim yeterli.
- **Sistem şeması (dolaşım, sindirim vb.):** Organları basit geometrik şekillerle (`Ellipse`, `RoundedRectangle`) temsil et, aralarında akışı gösteren yönlü `Arrow`larla bağla; `VGroup(...).arrange(DOWN veya RIGHT)` ile düzenli yerleştir.
- **Döngü (mitoz, karbon döngüsü, besin zinciri):** Elemanları bir daire üzerinde `VGroup` + `Circle` yörüngesinde konumlandır (`np.cos`/`np.sin` ile açısal yerleşim), oklarla döngü yönünü göster.
- **Kalıtım (Punnett karesi):** `Square` ızgarası + her hücrede genotip `Text`.

## Örnek: Basitleştirilmiş Hayvan Hücresi

```python
from manim import *

class Seg_1(Scene):
    def construct(self):
        title = Text("Hayvan Hucresi", font_size=36, color=BLUE).to_edge(UP)
        membrane = Ellipse(width=7, height=4.5, color=WHITE)
        nucleus = Circle(radius=0.9, fill_color=TEAL, fill_opacity=0.6).shift(LEFT * 0.5)
        nucleus_label = Text("Cekirdek", font_size=20).move_to(nucleus)
        mito = Ellipse(width=1.2, height=0.6, fill_color=YELLOW, fill_opacity=0.6).shift(RIGHT * 1.8 + UP * 0.8)
        mito_label = Text("Mitokondri", font_size=16).next_to(mito, DOWN, buff=0.1)

        self.play(Write(title))
        self.play(Create(membrane))
        self.play(FadeIn(nucleus), Write(nucleus_label))
        self.play(FadeIn(mito), Write(mito_label))
        self.wait(1)
```

## Örnek: DNA Çift Sarmalı (Stilize)

```python
from manim import *
import numpy as np

class Seg_2(Scene):
    def construct(self):
        strand1 = ParametricFunction(
            lambda t: np.array([t, np.sin(t * 2), 0]), t_range=[-3, 3], color=BLUE
        )
        strand2 = ParametricFunction(
            lambda t: np.array([t, np.sin(t * 2 + PI), 0]), t_range=[-3, 3], color=TEAL
        )
        rungs = VGroup(*[
            Line(
                [x, np.sin(x * 2), 0], [x, np.sin(x * 2 + PI), 0], color=WHITE, stroke_width=2
            ) for x in np.arange(-3, 3, 0.5)
        ])

        self.play(Create(strand1), Create(strand2), run_time=2)
        self.play(Create(rungs), run_time=1.5)
        self.wait(1)
```

## Kaçınılması Gerekenler

- Aşırı anatomik detay/gerçekçilik hedefleme; şematik, net etiketli basitleştirme tercih et.
- Tek sahnede çok fazla organel/organ sıkıştırma; `SAFE_W`/`SAFE_H` sınırına göre en fazla 4-5 ana eleman göster.
