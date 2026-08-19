---
name: subject-cografya
description: Coğrafya derslerinde kullanılacak Manim animasyon örüntüleri (harita, iklim, yer katmanları).
---

# Branş: Coğrafya

## Kullanılacak Yapılar

- **Basitleştirilmiş harita/bölge:** Gerçek ülke sınırı çizmeye çalışma; `Polygon`/`Rectangle` ile stilize bölge blokları kur, üzerine `Text` ile yer adı yaz.
- **Yer katmanları (kesit):** İç içe `Annulus`/`Arc` veya yatay `Rectangle` katmanları (çekirdek, manto, kabuk) üst üste, her katmana `Text` etiketi ve ok ile bağlantı.
- **İklim grafiği:** `Axes` üzerinde sıcaklık için çizgi (`axes.plot`), yağış için ay bazlı `Rectangle` çubuklar (`BarChart` yerine elle kur, matematik dosyasındaki bar chart deseniyle aynı).
- **Yön/akım okları (rüzgar, akıntı):** Bölge üzerine `Arrow` dizisi, renk kodlamasıyla (sıcak=YELLOW/kırmızı, soğuk=TEAL/mavi).
- **Zaman içindeki değişim (nüfus, göç):** `ValueTracker` + büyüyen/küçülen `Circle` ya da yükselen çubuk.

## Örnek: Yer Katmanları Kesiti

```python
from manim import *

class Seg_1(Scene):
    def construct(self):
        title = Text("Yer Kabugu Katmanlari", font_size=36, color=BLUE).to_edge(UP)

        crust = Annulus(inner_radius=2.3, outer_radius=2.5, color=TEAL, fill_opacity=1)
        mantle = Annulus(inner_radius=1.2, outer_radius=2.3, color=YELLOW, fill_opacity=1)
        core = Circle(radius=1.2, color=RED, fill_opacity=1)

        crust_label = Text("Yer Kabugu", font_size=20).next_to(crust, RIGHT, buff=0.3).shift(UP * 1.5)
        mantle_label = Text("Manto", font_size=20).next_to(mantle, RIGHT, buff=0.3)
        core_label = Text("Cekirdek", font_size=20).move_to(core)

        self.play(Write(title))
        self.play(Create(crust))
        self.play(Create(mantle))
        self.play(Create(core))
        self.play(Write(crust_label), Write(mantle_label), Write(core_label))
        self.wait(1)
```

## Örnek: Aylık Sıcaklık-Yağış Grafiği

```python
from manim import *

class Seg_2(Scene):
    def construct(self):
        months = ["Oca", "Sub", "Mar", "Nis", "May"]
        values = [4, 6, 10, 15, 20]
        bars = VGroup()
        for i, v in enumerate(values):
            bar = Rectangle(width=0.6, height=v * 0.15, fill_color=TEAL, fill_opacity=1)
            bar.next_to(ORIGIN, UP, buff=0).shift(RIGHT * i * 0.9)
            label = Text(months[i], font_size=16).next_to(bar, DOWN, buff=0.1)
            bars.add(VGroup(bar, label))
        bars.move_to(ORIGIN).to_edge(DOWN, buff=1)

        title = Text("Aylik Ortalama Sicaklik (C)", font_size=32, color=BLUE).to_edge(UP)
        self.play(Write(title))
        self.play(LaggedStart(*[GrowFromEdge(b[0], DOWN) for b in bars], lag_ratio=0.2))
        self.play(*[Write(b[1]) for b in bars])
        self.wait(1)
```

## Kaçınılması Gerekenler

- Detaylı/gerçekçi harita çizmeye çalışma (Manim bunun için uygun değil); şematik blok/bölge temsili kullan.
- Bar grafikte etiketsiz/renk açıklamasız çubuk bırakma; her çubuğun ne anlattığı net olsun.
