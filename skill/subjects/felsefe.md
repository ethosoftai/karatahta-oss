---
name: subject-felsefe
description: Felsefe derslerinde kullanılacak Manim animasyon örüntüleri (kavram haritası, tez-antitez, alıntı kartı).
---

# Branş: Felsefe

## Kullanılacak Yapılar

- **Kavram haritası:** Merkezde ana kavram (`Circle`/`RoundedRectangle` + `Text`), etrafında bağlı alt kavramlar; `Line`/`Arrow` ile ilişkilendir (`VGroup(...).arrange_in_grid` veya açısal `shift` ile yerleştir).
- **Tez - Antitez - Sentez:** Ekranı üç bölgeye ayır (`arrange(RIGHT)` ile üç kutu), aralarına `Arrow`; sentez kutusunu diğer ikisinin altında/ortasında birleştir.
- **Alıntı kartı:** Ortada büyük `Text`/`MarkupText` ile alıntı, altında küçük punto filozof adı; sade arka plan, gereksiz süsleme yok.
- **Filozof zaman çizelgesi:** Tarih dosyasındaki yatay `Line` + `Dot` desenini kullan, isim + akım adı etiketle.
- **Argüman akışı (öncül → öncül → sonuç):** Kutuları dikey `arrange(DOWN)` ile diz, aralarına aşağı yönlü `Arrow`, son kutuyu `sonuç` olarak farklı renkte vurgula.

## Örnek: Tez - Antitez - Sentez

```python
from manim import *

class Seg_1(Scene):
    def construct(self):
        title = Text("Diyalektik Yontem", font_size=34, color=BLUE).to_edge(UP)

        thesis = RoundedRectangle(width=2.4, height=1.2, color=TEAL)
        thesis_text = Text("Tez", font_size=24).move_to(thesis)

        antithesis = RoundedRectangle(width=2.4, height=1.2, color=YELLOW)
        antithesis_text = Text("Antitez", font_size=24).move_to(antithesis)

        row = VGroup(VGroup(thesis, thesis_text), VGroup(antithesis, antithesis_text))
        row.arrange(RIGHT, buff=1.5).shift(UP * 0.5)

        synthesis = RoundedRectangle(width=2.6, height=1.2, color=BLUE).next_to(row, DOWN, buff=1)
        synthesis_text = Text("Sentez", font_size=24).move_to(synthesis)

        arrow1 = Arrow(row[0].get_bottom(), synthesis.get_top(), buff=0.1)
        arrow2 = Arrow(row[1].get_bottom(), synthesis.get_top(), buff=0.1)

        self.play(Write(title))
        self.play(FadeIn(row[0]))
        self.play(FadeIn(row[1]))
        self.play(Create(arrow1), Create(arrow2))
        self.play(FadeIn(synthesis), Write(synthesis_text))
        self.wait(1)
```

## Örnek: Alıntı Kartı

```python
from manim import *

class Seg_2(Scene):
    def construct(self):
        quote = Text('"Dusunuyorum, oyleyse varim."', font_size=34, color=WHITE, slant=ITALIC)
        author = Text("- Rene Descartes", font_size=22, color=TEAL).next_to(quote, DOWN, buff=0.6)

        self.play(Write(quote))
        self.play(FadeIn(author, shift=UP * 0.2))
        self.wait(1.5)
```

## Kaçınılması Gerekenler

- Soyut kavramları gereksiz karmaşık grafiklerle somutlaştırmaya çalışma; sade kutu/ok diyagramları yeterli.
- Uzun alıntı paragrafı ekrana basma; kısa, çarpıcı tek cümlelik alıntı tercih et.
