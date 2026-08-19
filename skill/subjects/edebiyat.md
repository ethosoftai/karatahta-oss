---
name: subject-edebiyat
description: Edebiyat / Türkçe derslerinde kullanılacak Manim animasyon örüntüleri (metin analizi, dil bilgisi, akım karşılaştırma).
---

# Branş: Edebiyat / Türkçe

## Kullanılacak Yapılar

- **Metin vurgulama:** Cümleyi `Text` (veya kelime kelime `VGroup(Text(...), Text(...), ...).arrange(RIGHT, buff=0.15)`) olarak yaz, incelenen kelimeyi/öbeği `SurroundingRectangle` veya `Indicate` ile vurgula.
- **Cümle ögeleri ağacı:** Cümleyi üstte yaz, altına ögeleri (özne, yüklem, nesne) kutulayıp `Line` ile bağla — basit ağaç/diyagram yapısı.
- **Söz sanatı/edebi sanat örneği:** İki paralel `Text` bloğu (gerçek anlam vs mecaz anlam), aralarında `Arrow` veya `Transform`.
- **Akım/dönem karşılaştırma (Tanzimat, Servet-i Fünun...):** Zaman çizelgesi (tarih dosyasındaki desenle aynı) veya iki sütunlu karşılaştırma tablosu (`VGroup` sütun + `Line` ayraç).
- **Yazım/noktalama kuralı örneği:** Yanlış/doğru örnek çiftini üst üste göster, yanlış olanı `RED` çarpı ile, doğruyu `GREEN` tik ile işaretle.

## Örnek: Cümle Ögeleri

```python
from manim import *

class Seg_1(Scene):
    def construct(self):
        title = Text("Cumle Ogeleri", font_size=36, color=BLUE).to_edge(UP)
        sentence = Text("Ali okula erken gitti.", font_size=32).shift(UP * 1.2)

        ozne = SurroundingRectangle(sentence[0:3], color=TEAL)
        ozne_label = Text("Ozne", font_size=20, color=TEAL).next_to(ozne, DOWN, buff=0.3)

        yuklem = SurroundingRectangle(sentence[-6:], color=YELLOW)
        yuklem_label = Text("Yuklem", font_size=20, color=YELLOW).next_to(yuklem, DOWN, buff=0.6)

        self.play(Write(title))
        self.play(Write(sentence))
        self.play(Create(ozne), Write(ozne_label))
        self.play(Create(yuklem), Write(yuklem_label))
        self.wait(1)
```

## Örnek: Gerçek Anlam - Mecaz Anlam Karşılaştırması

```python
from manim import *

class Seg_2(Scene):
    def construct(self):
        left = Text('"Tas kalpli adam"', font_size=30).shift(LEFT * 3)
        left_label = Text("Mecaz Anlam", font_size=20, color=YELLOW).next_to(left, DOWN, buff=0.4)

        right = Text('"Duygusuz, katı adam"', font_size=30).shift(RIGHT * 3)
        right_label = Text("Gercek Anlami", font_size=20, color=TEAL).next_to(right, DOWN, buff=0.4)

        arrow = Arrow(left.get_right(), right.get_left(), buff=0.3)

        self.play(Write(left), Write(left_label))
        self.play(Create(arrow))
        self.play(Write(right), Write(right_label))
        self.wait(1)
```

## Kaçınılması Gerekenler

- Uzun metin/paragrafı olduğu gibi ekrana basma; tek cümle veya kısa alıntı ile sınırla.
- `MathTex` kullanma (edebiyatta matematiksel ifade yok); tüm metin `Text` ile.
