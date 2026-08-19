---
name: subject-ingilizce
description: İngilizce derslerinde kullanılacak Manim animasyon örüntüleri (dilbilgisi, zaman, kelime kartı).
---

# Branş: İngilizce

## Kullanılacak Yapılar

- **Zaman (tense) çizgisi:** Yatay `Line` üzerinde past/present/future bölgeleri, ilgili cümle örneğini o bölgenin üstüne `Text` ile yerleştir.
- **Cümle yapısı (Subject-Verb-Object):** Kutulanmış öbekler (`RoundedRectangle` + `Text`) `arrange(RIGHT)`, altlarına rol etiketi (`Subject`, `Verb`, `Object`).
- **Kelime kartı (vocabulary):** Ortada büyük İngilizce kelime, altında Türkçe karşılığı, örnek cümle küçük punto — `VGroup(...).arrange(DOWN, buff=0.4)`.
- **Doğru/yanlış örnek karşılaştırma:** Yanlış cümleyi üstte `RED` çarpı ile, doğru cümleyi altta `GREEN` tik ile göster; farklı kelimeyi `SurroundingRectangle` ile vurgula.
- **Edat/bağlaç görselleştirme:** Basit sahne (kutu üstünde/içinde/yanında nesne) ile `in/on/under` gibi edatları somutlaştır.

## Örnek: Present Simple vs Past Simple Zaman Çizgisi

```python
from manim import *

class Seg_1(Scene):
    def construct(self):
        title = Text("Present Simple vs Past Simple", font_size=32, color=BLUE).to_edge(UP)
        line = Line(LEFT * 5, RIGHT * 5, color=WHITE)
        now_dot = Dot(ORIGIN, color=YELLOW)
        now_label = Text("Now", font_size=20).next_to(now_dot, DOWN)

        past_sentence = Text('"I played football."', font_size=24, color=TEAL).next_to(line, UP, buff=0.5).shift(LEFT * 3)
        present_sentence = Text('"I play football."', font_size=24, color=BLUE).next_to(line, UP, buff=0.5).shift(RIGHT * 1)

        self.play(Write(title))
        self.play(Create(line))
        self.play(FadeIn(now_dot), Write(now_label))
        self.play(Write(past_sentence))
        self.play(Write(present_sentence))
        self.wait(1)
```

## Örnek: Cümle Yapısı (SVO)

```python
from manim import *

class Seg_2(Scene):
    def construct(self):
        s = RoundedRectangle(width=2, height=1, color=TEAL)
        s_word = Text("She", font_size=26).move_to(s)
        s_tag = Text("Subject", font_size=16, color=TEAL).next_to(s, DOWN, buff=0.2)

        v = RoundedRectangle(width=2, height=1, color=YELLOW)
        v_word = Text("reads", font_size=26).move_to(v)
        v_tag = Text("Verb", font_size=16, color=YELLOW).next_to(v, DOWN, buff=0.2)

        o = RoundedRectangle(width=2, height=1, color=BLUE)
        o_word = Text("books", font_size=26).move_to(o)
        o_tag = Text("Object", font_size=16, color=BLUE).next_to(o, DOWN, buff=0.2)

        row = VGroup(VGroup(s, s_word), VGroup(v, v_word), VGroup(o, o_word)).arrange(RIGHT, buff=0.8)
        tags = VGroup(s_tag, v_tag, o_tag)

        self.play(FadeIn(row[0]), Write(s_tag))
        self.play(FadeIn(row[1]), Write(v_tag))
        self.play(FadeIn(row[2]), Write(o_tag))
        self.wait(1)
```

## Kaçınılması Gerekenler

- Türkçe ve İngilizce metni aynı `Text` bloğunda karıştırma; ayrı satır/ayrı obje kullan.
- Uzun diyalog/paragraf ekrana basma; tek örnek cümle ile göster.
