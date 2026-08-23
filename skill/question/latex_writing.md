# Soru Çözümünde LaTeX / Hesaplama Adımı Yazımı

Bu dosya `question_solving.md` ile birlikte, yalnız soru çözüm videolarında
yüklenir. `math_rendering.md` genel MathTex sözdizimini anlatır — burası
özel olarak **hesaplama adımlarını art arda, çakışmadan, ekranın neresinde
olduğu belli olacak şekilde yazmayı** anlatır. En sık render hatası (üst
üste bindirme) tam da STEPS_ZONE'da, adım adım MathTex eklerken olur; bu
yüzden burada kesin koordinat ve kod deseni veriliyor — tahmin etmeyin.

## Zon Koordinatları (16:9, `config.frame_height = 8`)

`layout_safety.md`'deki `TITLE_ZONE_H` / `CONTENT_ZONE_H` / `FOOTER_ZONE_H`
sabitlerinin üstüne, `question_solving.md`'nin GIVEN/STEPS/RESULT
bölünmesini **somut y-koordinatlarına** çevir:

```python
# Dikey video icin frame_height yine 8 ama frame_width dusuk olur
# (bkz. layout_safety.md orientation notu) -- y-koordinatlari ayni kalir.
FRAME_H = config.frame_height          # 8.0
HALF_H = FRAME_H / 2                   # 4.0

TITLE_ZONE_TOP_Y    = HALF_H                       #  4.00
CONTENT_TOP_Y        = HALF_H - FRAME_H * 0.18      #  2.56  (title zone biter)
CONTENT_BOTTOM_Y      = -HALF_H + FRAME_H * 0.17    # -2.64  (footer zone baslar)
CONTENT_H              = CONTENT_TOP_Y - CONTENT_BOTTOM_Y  # ~5.20

GIVEN_ZONE_TOP_Y    = CONTENT_TOP_Y                 #  2.56
GIVEN_ZONE_BOTTOM_Y = CONTENT_TOP_Y - CONTENT_H * 0.25   #  1.26
GIVEN_ZONE_CENTER_Y = (GIVEN_ZONE_TOP_Y + GIVEN_ZONE_BOTTOM_Y) / 2   # ~1.91

STEPS_ZONE_TOP_Y    = GIVEN_ZONE_BOTTOM_Y           #  1.26
STEPS_ZONE_BOTTOM_Y = STEPS_ZONE_TOP_Y - CONTENT_H * 0.55   # -1.60
STEPS_ZONE_CENTER_Y = (STEPS_ZONE_TOP_Y + STEPS_ZONE_BOTTOM_Y) / 2   # ~-0.17

RESULT_ZONE_TOP_Y    = STEPS_ZONE_BOTTOM_Y          # -1.60
RESULT_ZONE_BOTTOM_Y = CONTENT_BOTTOM_Y             # -2.64
RESULT_ZONE_CENTER_Y = (RESULT_ZONE_TOP_Y + RESULT_ZONE_BOTTOM_Y) / 2  # ~-2.12

ZONE_MAX_W = config.frame_width * 0.85   # her zonun max genisligi
```

Bu sayıları elle hesaplama; yukarıdaki bloğu olduğu gibi `construct()`
başına kopyala, sonra her mobject'i `move_to([0, <ZONE>_CENTER_Y, 0])` ile
kendi zonuna yerleştir. **Bir mobject'i asla iki zonun sınırını aşacak
şekilde bırakma** — `fit_to_safe_area` (layout_safety.md) çağrısını her zon
genişliği/yüksekliği için ayrı ayrı uygula.

## GIVEN_ZONE — Verilenler (sabit)

```python
givens = VGroup(
    MathTex(r"a = 7"),
    MathTex(r"b = 5"),
    MathTex(r"\angle C = 60^\circ"),
).arrange(RIGHT, buff=0.8)
if givens.width > ZONE_MAX_W:
    givens.scale_to_fit_width(ZONE_MAX_W)
givens.move_to([0, GIVEN_ZONE_CENTER_Y, 0])
self.play(Write(givens), run_time=1.0)
# givens artik segment/soru boyunca ekranda kalir -- bir daha move_to/create etme
```

Şekil/diyagram gereken sorularda (geometri, fizik, kimya) diyagramı da bu
zona koy; metin verilenlerle yan yana veya diyagram üstte + değerler altta
`VGroup(...).arrange(DOWN, buff=0.3)` ile birleştir, sonra tek grup olarak
`GIVEN_ZONE_CENTER_Y`'ye yerleştir. Diyagram tek başına zonu dolduracak kadar
büyükse (ör. detaylı üçgen), `question_solving.md`'deki gibi diyagramı
`GIVEN_ZONE` yerine ekranın soluna, verilenleri sağına da bölebilirsin —
o zaman `ZONE_MAX_W` yerine `config.frame_width * 0.45` kullan ve STEPS/RESULT
zonlarını da aynı sağ yarıya sıkıştır (`move_to([config.frame_width*0.22, Y, 0])`).

## STEPS_ZONE — Adım Adım Hesaplama (güncellenir)

**Kural: aynı anda en fazla `MAX_VISIBLE_STEPS` satır ekranda kalsın.**
Yenisi eklenirken en eski adım `FadeOut` ile kaldırılır ve kalanlar yukarı
kayar — hiçbir zaman iki adım aynı satıra/konuma yazılmaz.

```python
MAX_VISIBLE_STEPS = 3   # STEPS_ZONE yuksekligine gore; 4+ okunmaz hale gelir

class StepTracker:
    """STEPS_ZONE'daki adimlari coklayip cakismadan diziyor."""
    def __init__(self, scene, zone_center_y, zone_max_w, max_visible=MAX_VISIBLE_STEPS):
        self.scene = scene
        self.zone_center_y = zone_center_y
        self.zone_max_w = zone_max_w
        self.max_visible = max_visible
        self.visible = []  # ekrandaki VMobject'ler, eskiden yeniye

    def advance_step(self, mobject, run_time=0.8):
        # Zon disina tasan tekil adimi kucult
        if mobject.width > self.zone_max_w:
            mobject.scale_to_fit_width(self.zone_max_w)

        if len(self.visible) >= self.max_visible:
            oldest = self.visible.pop(0)
            self.scene.play(FadeOut(oldest), run_time=0.3)

        self.visible.append(mobject)
        group = VGroup(*self.visible).arrange(DOWN, buff=0.35, aligned_edge=LEFT)
        group.move_to([0, self.zone_center_y, 0])

        # mobject henuz sahnede degilse Write, eskiden beri orada olan
        # komsu adimlar arrange() ile YENIDEN konumlanmis olabilir --
        # onlari da .animate ile yeni yerlerine tasi.
        others = self.visible[:-1]
        anims = [Write(mobject)]
        for other in others:
            anims.append(other.animate.move_to(other.get_center()))
        self.scene.play(*anims, run_time=run_time)

# Kullanim -- STEPS_ZONE'un tamamini bu tracker yonetsin
tracker = StepTracker(self, STEPS_ZONE_CENTER_Y, ZONE_MAX_W)
tracker.advance_step(MathTex(r"\cos C = \frac{a^2+b^2-c^2}{2ab}"))
tracker.advance_step(MathTex(r"c^2 = a^2+b^2-2ab\cos C"))
tracker.advance_step(MathTex(r"c^2 = 49+25-2(7)(5)\cos 60^\circ"))
tracker.advance_step(MathTex(r"c^2 = 74 - 35 = 39"))  # 4. adim -- en eski (1.) simdi FadeOut olur
```

**Çok adımlı, tek denklem içinde ilerleyen** hesaplamalarda (ör. aynı
ifadenin sadeleşmesi) `StepTracker` yerine hizalı çok satırlı `MathTex` ile
tek seferde `&=` kullan — bu durumda "adım" ayrı mobject değil aynı
formülün satırlarıdır ve çakışma riski yoktur:

```python
simplification = MathTex(
    r"c^2 &= 49 + 25 - 2(7)(5)(0.5) \\",
    r"&= 74 - 35 \\",
    r"&= 39"
)
if simplification.width > ZONE_MAX_W:
    simplification.scale_to_fit_width(ZONE_MAX_W)
simplification.move_to([0, STEPS_ZONE_CENTER_Y, 0])
self.play(Write(simplification), run_time=1.2)
```

**Ne zaman `StepTracker`, ne zaman hizalı çok satır?** Adımlar arasında
öğrencinin anlaması gereken kavramsal bir sıçrama varsa (formül seç →
formülü uygula → sonucu yorumla) `StepTracker` kullan, her adım kendi
`Write` animasyonunu ve varsa açıklamasını alsın. Adımlar aynı ifadenin
düz cebirsel sadeleşmesiyse (yalnızca sayı işlemi) hizalı çok satırlı
`MathTex` yeterli ve daha sade.

## RESULT_ZONE — Sonuç (yalnız son adımda)

```python
result = MathTex(r"c \approx 6.24")
result.scale_to_fit_width(min(result.width, ZONE_MAX_W * 0.6))
box = SurroundingRectangle(result, color=YELLOW, buff=0.3)
result_group = VGroup(result, box).move_to([0, RESULT_ZONE_CENTER_Y, 0])
self.play(Write(result), Create(box), run_time=1.0)
```

RESULT_ZONE, STEPS_ZONE tamamen bitmeden (son `advance_step` çağrısından
önce) **asla** doldurulmaz — cevabı erken göstermek `question_solving.md`
kuralını ihlal eder.

## Sık Yapılan Ek Hatalar (soru çözümüne özel)

| Hata | Neden | Düzeltme |
|---|---|---|
| GIVEN_ZONE her segment başında yeniden çiziliyor | `continuity.previous_manim_code`'daki givens `self.add`/`Write` ile yeniden kuruluyor ama eski givens kaldırılmadı | Continuity kuralına uy: önceki kodun son durumunu `self.add` ile *animasyonsuz* kur, yeniden `Write` etme |
| STEPS_ZONE'da adım sayısı `MAX_VISIBLE_STEPS`'i aşıyor | Tüm adımlar tek seferde plana yazılmış, sahnede biriktirilmiş | `StepTracker` kullan; plandaki `animation.sequence` adımlarını `advance_step` çağrılarına birebir eşle |
| Diyagram (üçgen/grafik/devre) ile STEPS_ZONE metni çakışıyor | Diyagram GIVEN_ZONE genişliğini aşıp STEPS_ZONE'a taşmış | Diyagramı `fit_to_safe_area` ile GIVEN_ZONE yüksekliğine (`GIVEN_ZONE_TOP_Y - GIVEN_ZONE_BOTTOM_Y`) sığdır, taşarsa sol/sağ bölünmüş yerleşime geç (yukarı bkz.) |
| RESULT_ZONE ile STEPS_ZONE'un son adımı üst üste | `RESULT_ZONE_CENTER_Y` hesaplanmadan `move_to(DOWN*2)` gibi sabit değer kullanılmış | Her zaman bu dosyadaki `*_ZONE_CENTER_Y` sabitlerini kullan, elle koordinat uydurma |
