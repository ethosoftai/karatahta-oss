---
name: subject-tarih
description: Tarih derslerinde kullanılacak Manim animasyon örüntüleri (zaman çizelgesi, olay akışı, karşılaştırma).
---

# Branş: Tarih

## Kullanılacak Yapılar

- **Zaman çizelgesi (timeline):** Yatay uzun `Line`, üzerinde eşit veya kronolojik aralıklı `Dot`'lar; her nokta için yukarı/aşağı çıkan küçük `Line` + `Text` (tarih + olay adı). Kamera `MovingCameraScene` ile soldan sağa kaydırılabilir.
- **Olaylar arası neden-sonuç akışı:** Kutuları (`RoundedRectangle` + `Text`) `VGroup(...).arrange(RIGHT, buff=1)` ile sırala, aralarına `Arrow` koy.
- **Karşılaştırma (iki taraf/dönem):** Ekranı ortadan `DashedLine` ile ikiye ayır, sol/sağ `VGroup` içinde iki farklı dönemin/tarafın unsurlarını listele.
- **Harita üzerinde toprak değişimi:** Basit `Polygon` bölge, `Transform` ile sınırların büyümesi/küçülmesi (gerçekçi harita değil, şematik blok).
- **Kişi/hanedan ağacı:** Kutuları `VGroup` hiyerarşik olarak diz (`arrange_in_grid` veya elle `shift`), bağlantıları `Line`.

## Örnek: Zaman Çizelgesi

```python
from manim import *

class Seg_1(MovingCameraScene):
    def construct(self):
        title = Text("Onemli Olaylar", font_size=36, color=BLUE).to_edge(UP)
        line = Line(LEFT * 5, RIGHT * 5, color=WHITE)

        events = [("1299", "Kurulus"), ("1453", "Istanbul'un Fethi"), ("1923", "Cumhuriyet")]
        dots = VGroup()
        for i, (year, name) in enumerate(events):
            x = -4 + i * 4
            dot = Dot(point=[x, 0, 0], color=YELLOW)
            year_label = Text(year, font_size=22).next_to(dot, UP, buff=0.3)
            name_label = Text(name, font_size=18).next_to(dot, DOWN, buff=0.3)
            dots.add(VGroup(dot, year_label, name_label))

        self.play(Write(title))
        self.play(Create(line))
        for group in dots:
            self.play(FadeIn(group[0], scale=1.5), Write(group[1]), Write(group[2]))
            self.wait(0.3)
        self.wait(1)
```

## Örnek: Neden-Sonuç Akışı

```python
from manim import *

class Seg_2(Scene):
    def construct(self):
        b1 = RoundedRectangle(width=2.6, height=1, corner_radius=0.15, color=TEAL)
        b1_text = Text("Neden", font_size=22).move_to(b1)
        b2 = RoundedRectangle(width=2.6, height=1, corner_radius=0.15, color=YELLOW)
        b2_text = Text("Gelisme", font_size=22).move_to(b2)
        b3 = RoundedRectangle(width=2.6, height=1, corner_radius=0.15, color=BLUE)
        b3_text = Text("Sonuc", font_size=22).move_to(b3)

        row = VGroup(VGroup(b1, b1_text), VGroup(b2, b2_text), VGroup(b3, b3_text))
        row.arrange(RIGHT, buff=1.2)

        arrow1 = Arrow(b1.get_right(), b2.get_left(), buff=0.1)
        arrow2 = Arrow(b2.get_right(), b3.get_left(), buff=0.1)

        self.play(FadeIn(row[0]))
        self.play(Create(arrow1), FadeIn(row[1]))
        self.play(Create(arrow2), FadeIn(row[2]))
        self.wait(1)
```

## Kaçınılması Gerekenler

- Uzun paragraf halinde tarih metni ekrana basma; anahtar tarih + kısa olay adı yeterli.
- Tek sahnede 5'ten fazla olay noktası sıkıştırma; `MovingCameraScene` ile kaydırarak böl.
