---
name: subject-matematik
description: Matematik derslerinde kullanılacak Manim animasyon örüntüleri (fonksiyon, denklem, geometri, olasılık).
---

# Branş: Matematik

Bu segment matematik konusunu anlatıyor. `skill/skill.md` ve `rules/math_rendering.md` zaten zorunlu; burada matematiğe özgü sahne kalıpları var.

## Kullanılacak Yapılar

- **Fonksiyon/grafik:** `Axes` + `axes.plot(...)`, `axes.get_area(...)`, `axes.get_vertical_line_to_graph(...)`. Eksen etiketleri `include_numbers=False`, gerekiyorsa `Text`/`MathTex` ile elle etiketle.
- **Denklem adım adım çözüm:** Aynı `MathTex` nesnesini `TransformMatchingTex` ile bir sonraki adıma dönüştür; her adımda yeni `MathTex` yaratıp `FadeOut` ile eskisini silme.
- **Geometri:** `Polygon`, `Line`, `Angle`, `RightAngle`, `Dot` ile şekli kur; açı/kenar etiketlerini `MathTex` ile `next_to` konumlandır.
- **Sayı doğrusu / kümeler:** `NumberLine`, aralık gösterimi için `Brace` veya renkli `Line` segmenti.
- **Olasılık/istatistik:** `BarChart` yerine (v0.20.1'de kısıtlı) elle `Rectangle` + `VGroup(...).arrange(RIGHT, buff=...)` ile çubuk grafik kur.

## Örnek: Adım Adım Denklem Çözümü

```python
from manim import *

class Seg_1(Scene):
    def construct(self):
        title = Text("Birinci Dereceden Denklem", font_size=40, color=BLUE).to_edge(UP)
        self.play(Write(title))

        step1 = MathTex(r"2x", "+", "4", "=", "10")
        step1.next_to(title, DOWN, buff=0.8)
        self.play(Write(step1))
        self.wait(0.5)

        step2 = MathTex(r"2x", "=", "6").move_to(step1)
        self.play(TransformMatchingTex(step1, step2))
        self.wait(0.5)

        step3 = MathTex(r"x", "=", "3").move_to(step2)
        step3[0].set_color(YELLOW)
        self.play(TransformMatchingTex(step2, step3))
        self.wait(1)
```

## Örnek: Fonksiyon Grafiği

```python
from manim import *

class Seg_2(Scene):
    def construct(self):
        axes = Axes(
            x_range=[-3, 3, 1], y_range=[-2, 8, 2],
            x_length=8, y_length=5,
            axis_config={"include_numbers": False}
        ).add_coordinates()
        graph = axes.plot(lambda x: x**2 - 1, color=TEAL, x_range=[-2.5, 2.5])
        label = MathTex(r"f(x) = x^2 - 1", color=BLUE).next_to(axes, UP)

        self.play(Create(axes))
        self.play(Write(label))
        self.play(Create(graph), run_time=2)
        self.wait(1)
```

## Kaçınılması Gerekenler

- `include_numbers=True` kullanma (LaTeX yoksa render kırılır); eksen sayılarını `Text`/`MathTex` ile elle koy.
- Tek karede birden fazla büyük grafik/denklem grubu üst üste bindirme; `SAFE_W`/`SAFE_H` sınırına göre ölçekle.
