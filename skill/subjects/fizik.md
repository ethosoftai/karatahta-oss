---
name: subject-fizik
description: Fizik derslerinde kullanılacak Manim animasyon örüntüleri (hareket, kuvvet, elektrik, dalga).
---

# Branş: Fizik

## Kullanılacak Yapılar

- **Hareket/kinematik:** Bir `Dot` veya küçük `Circle`'ı `MoveAlongPath` veya `always_redraw` ile hareket ettir; hız/ivme vektörünü `Arrow` ile cismin üzerine iğnele (`arrow.add_updater(...)` yerine sabit adımlarda yeniden çiz).
- **Kuvvet diyagramı (serbest cisim):** Cismi `Square`/`Circle` ile çiz, her kuvveti farklı renkli `Arrow` ile merkezden dışa çıkar, yanına `MathTex` etiketi koy (`\vec{F}_g`, `\vec{N}` gibi).
- **Elektrik devresi:** Dirençleri `Rectangle`, pili iki paralel `Line` (uzun+kısa), teli `Line`/`Elbow` benzeri dik açılı `VMobject` yollarıyla kur; akım yönünü küçük `Arrow` ile göster.
- **Dalga/salınım:** `axes.plot(lambda x: A*np.sin(k*x - w*t), ...)` fonksiyonunu bir `ValueTracker` ile `always_redraw` içinde güncelle (kısa segmentte 2-3 periyot yeterli, aşırı updater kullanma).
- **Grafik eksenleri:** Fiziksel büyüklük birimini eksen etiketine ekle (`Text("t (s)")`, `Text("v (m/s)")`).

## Örnek: Serbest Cisim Diyagramı

```python
from manim import *

class Seg_1(Scene):
    def construct(self):
        title = Text("Serbest Cisim Diyagrami", font_size=36, color=BLUE).to_edge(UP)
        box = Square(side_length=1.4, color=WHITE).shift(DOWN * 0.5)

        weight = Arrow(box.get_bottom(), box.get_bottom() + DOWN * 1.5, color=YELLOW, buff=0)
        weight_label = MathTex(r"\vec{F}_g").next_to(weight, RIGHT)

        normal = Arrow(box.get_top(), box.get_top() + UP * 1.5, color=TEAL, buff=0)
        normal_label = MathTex(r"\vec{N}").next_to(normal, LEFT)

        self.play(Write(title))
        self.play(Create(box))
        self.play(GrowFromCenter(weight), Write(weight_label))
        self.play(GrowFromCenter(normal), Write(normal_label))
        self.wait(1)
```

## Örnek: Basit Harmonik Salınım Grafiği

```python
from manim import *

class Seg_2(Scene):
    def construct(self):
        axes = Axes(x_range=[0, 4, 1], y_range=[-2, 2, 1], x_length=8, y_length=4)
        t = ValueTracker(0)

        curve = always_redraw(lambda: axes.plot(
            lambda x: np.sin(2 * PI * x) if x <= t.get_value() else np.nan,
            x_range=[0, max(t.get_value(), 0.001)], color=TEAL
        ))
        label = MathTex(r"y(t) = A\sin(\omega t)", color=BLUE).to_edge(UP)

        self.play(Write(label), Create(axes))
        self.add(curve)
        self.play(t.animate.set_value(4), run_time=3, rate_func=linear)
        self.wait(0.5)
```

## Kaçınılması Gerekenler

- `GrowArrow` kullanma (bu ortamda kırık); `Create` veya `GrowFromCenter` kullan.
- Devre şemalarında serbest el çizim yerine `Line`/`Rectangle` ile ızgaraya hizalanmış temiz geometriler kur.
