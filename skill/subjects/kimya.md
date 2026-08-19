---
name: subject-kimya
description: Kimya derslerinde kullanılacak Manim animasyon örüntüleri (molekül, atom, tepkime, periyodik tablo).
---

# Branş: Kimya

## Kullanılacak Yapılar

- **Atom modeli:** Çekirdek için içi dolu `Circle`, elektron yörüngesi için `Circle(stroke_opacity=0.4)`, elektron için küçük `Dot`; `Rotate` ile yörünge animasyonu.
- **Molekül/bağ:** Atomları renkli `Circle` (H beyaz, O kırmızı, C gri, N mavi gibi tutarlı bir palet kullan ama app renk şemasına da uy: vurgu YELLOW, ana renk BLUE), bağları `Line` ile birleştir; çift/üçlü bağ için paralel iki/üç `Line`.
- **Kimyasal tepkime denklemi:** Reaktif ve ürünleri `VGroup` halinde solda/sağda topla, aralarına `Arrow` koy; katsayıları `MathTex` ile göster.
- **Periyodik tablo hücresi:** `Square` içine element simgesini `Text`, atom numarasını küçük `Text` olarak sol üst köşeye yerleştir.
- **pH / asit-baz ölçeği:** Yatay `Line` üzerine 0-14 aralığını `Tick`/küçük `Line`'larla işaretle, renk geçişini `Rectangle` dizisiyle (kırmızıdan maviye) simüle et.

## Örnek: Basit Molekül (H2O)

```python
from manim import *

class Seg_1(Scene):
    def construct(self):
        title = Text("Su Molekulu (H2O)", font_size=36, color=BLUE).to_edge(UP)

        oxygen = Circle(radius=0.5, fill_color=RED, fill_opacity=1).shift(UP * 0.3)
        h1 = Circle(radius=0.3, fill_color=WHITE, fill_opacity=1).shift(DOWN * 0.6 + LEFT * 0.9)
        h2 = Circle(radius=0.3, fill_color=WHITE, fill_opacity=1).shift(DOWN * 0.6 + RIGHT * 0.9)

        bond1 = Line(oxygen.get_center(), h1.get_center(), color=GRAY)
        bond2 = Line(oxygen.get_center(), h2.get_center(), color=GRAY)

        o_label = Text("O", font_size=28, color=BLACK).move_to(oxygen)
        h1_label = Text("H", font_size=22, color=BLACK).move_to(h1)
        h2_label = Text("H", font_size=22, color=BLACK).move_to(h2)

        self.play(Write(title))
        self.play(Create(bond1), Create(bond2))
        self.play(FadeIn(oxygen), FadeIn(h1), FadeIn(h2))
        self.play(Write(o_label), Write(h1_label), Write(h2_label))
        self.wait(1)
```

## Örnek: Tepkime Denklemi

```python
from manim import *

class Seg_2(Scene):
    def construct(self):
        reactants = MathTex(r"2H_2", "+", "O_2")
        arrow = MathTex(r"\rightarrow").next_to(reactants, RIGHT, buff=0.4)
        products = MathTex(r"2H_2O").next_to(arrow, RIGHT, buff=0.4)
        group = VGroup(reactants, arrow, products).move_to(ORIGIN)

        self.play(Write(reactants))
        self.play(Write(arrow))
        self.play(Write(products))
        self.play(Indicate(products, color=YELLOW))
        self.wait(1)
```

## Kaçınılması Gerekenler

- Gerçekçi 3D molekül render etmeye çalışma; 2D basitleştirilmiş top-çubuk model yeterli ve daha okunaklı.
- Element simgelerini `MathTex` yerine `Text` ile yaz (kimyasal formüller `MathTex`'te `H_2O` gibi alt simge gerekiyorsa `MathTex` kullanılabilir, ama atom etiketleri için sade `Text` tercih edilir).
