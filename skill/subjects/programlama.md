---
name: subject-programlama
description: Programlama / Bilgisayar Bilimi derslerinde kullanılacak Manim animasyon örüntüleri (algoritma, kod, veri yapısı).
---

# Branş: Programlama / Bilgisayar Bilimi

## Kullanılacak Yapılar

- **Kod bloğu:** `Code` sınıfı yerine (font/tema bağımlılığı riskli) satırları `Text(..., font="Georgia")` ile monospace hissi vermeden sade yaz; anahtar kelimeyi/satırı `SurroundingRectangle` ile vurgula. Alternatif: kısa kod satırlarını `Text(font_size=24)` ile `VGroup(...).arrange(DOWN, buff=0.25, aligned_edge=LEFT)`.
- **Değişken/durum takibi:** Değişken adını ve değerini `Rectangle` + `Text` kutusunda göster, her adımda `Transform` ile değeri güncelle (yeni kutu yaratıp eskisini silme, aynı kutuyu dönüştür).
- **Dizi/liste görselleştirme:** Yan yana `Square` hücreleri (`VGroup(...).arrange(RIGHT, buff=0)`), her hücrede değer `Text`, altında indeks `Text(font_size=16)`. Erişilen/değişen hücreyi renkle vurgula.
- **Akış şeması (flowchart):** Başlangıç/bitiş için `Ellipse`, işlem için `Rectangle`, karar için `Polygon` (eşkenar dörtgen benzeri döndürülmüş kare), oklarla bağla.
- **Algoritma adım vurgusu:** Kod satırını okurken ilgili satırı `Indicate` veya arka planında hareket eden `SurroundingRectangle` ile takip et.

## Örnek: Dizi Üzerinde Doğrusal Arama

```python
from manim import *

class Seg_1(Scene):
    def construct(self):
        title = Text("Dogrusal Arama: 7 sayisini bul", font_size=32, color=BLUE).to_edge(UP)
        values = [3, 8, 7, 1, 9]
        cells = VGroup(*[
            VGroup(
                Square(side_length=1, color=WHITE),
                Text(str(v), font_size=28)
            ) for v in values
        ])
        for cell in cells:
            cell[1].move_to(cell[0])
        cells.arrange(RIGHT, buff=0)

        self.play(Write(title))
        self.play(Create(cells))

        for i, cell in enumerate(cells):
            box = SurroundingRectangle(cell, color=YELLOW)
            self.play(Create(box), run_time=0.4)
            if values[i] == 7:
                self.play(cell[0].animate.set_fill(TEAL, opacity=0.6))
                self.wait(0.5)
                break
            self.play(FadeOut(box), run_time=0.3)
        self.wait(1)
```

## Örnek: Değişken Durumu (Sayaç Döngüsü)

```python
from manim import *

class Seg_2(Scene):
    def construct(self):
        title = Text("for i in range(3): toplam += i", font_size=26, color=BLUE).to_edge(UP)
        box = Rectangle(width=2.4, height=1, color=TEAL)
        label = Text("toplam = 0", font_size=26).move_to(box)
        group = VGroup(box, label)

        self.play(Write(title))
        self.play(Create(box), Write(label))

        for step_value in [1, 3]:
            new_label = Text(f"toplam = {step_value}", font_size=26).move_to(box)
            self.play(Transform(label, new_label))
            self.wait(0.4)
        self.wait(1)
```

## Kaçınılması Gerekenler

- Gerçek bir kod editörü/terminal taklidi yapmaya çalışma (renkli syntax highlighting için font bağımlılığı riskli); sade metin + vurgu kutusu yeterli.
- Uzun kod bloklarını (10+ satır) olduğu gibi ekrana basma; en fazla 3-5 satırlık kritik kısmı göster.
