# Layout Safety — Sahne Taşma Önleme

## Neden Taşma Olur?

1. Birden fazla büyük mobject aynı anda ekranda
2. Formüller ölçeklenmeden yerleştirilir
3. `buff` değerleri çok küçük veya yoktur
4. Kamera hareketi sırasında yanlış frame hesabı
5. `to_edge()` sonrası başka mobject eklenir ve üst üste biner

---

## Güvenli Boyutlar

```python
# Frame boyutları (Manim default 16:9)
FRAME_W = config.frame_width    # ≈ 14.22 birim
FRAME_H = config.frame_height   # ≈ 8.0 birim

# Güvenli çalışma alanı (kenarlarda 0.4 birim boşluk bırak)
SAFE_W = FRAME_W * 0.90   # ≈ 12.8 birim
SAFE_H = FRAME_H * 0.85   # ≈ 6.8 birim

# Başlık için ayırılan alan (üst)
TITLE_ZONE_H   = FRAME_H * 0.18   # üst ~1.4 birim
CONTENT_ZONE_H = FRAME_H * 0.65   # orta ~5.2 birim
FOOTER_ZONE_H  = FRAME_H * 0.17   # alt ~1.4 birim
```

---

## Zorunlu Taşma Kontrol Şablonu

Her sahnede, `self.play()` çağrısından **önce** bu kontrolü yap:

```python
def fit_to_safe_area(mob, max_w_ratio=0.88, max_h_ratio=0.80):
    """
    Mobject ekran sınırlarını aşıyorsa küçült.
    max_w_ratio / max_h_ratio: frame boyutunun hangi oranına kadar izin var.
    """
    max_w = config.frame_width * max_w_ratio
    max_h = config.frame_height * max_h_ratio
    if mob.width > max_w:
        mob.scale_to_fit_width(max_w)
    if mob.height > max_h:
        mob.scale_to_fit_height(max_h)
    return mob

# Kullanım — her kritik mobject için çağır
formula = MathTex(r"\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}")
fit_to_safe_area(formula)
formula.move_to(ORIGIN)
```

---

## Başlık + İçerik Düzeni

Başlık ve içerik aynı anda ekranda olduğunda **üst üste binme** yaşanır.
Her zaman bu iki yöntemden birini seç:

### Yöntem A — Başlığı Küçük Tut

```python
class SafeLayoutScene(Scene):
    def construct(self):
        # Başlık: üstte küçük
        title = Text("Türev", font_size=36, color=BLUE)
        title.to_edge(UP, buff=0.35)

        # İçerik: kalan alanda ortalı
        formula = MathTex(r"f'(x) = \lim_{h \to 0}\frac{f(x+h)-f(x)}{h}",
                          font_size=42)
        # İçerik max genişlik kontrolü
        if formula.width > config.frame_width * 0.85:
            formula.scale_to_fit_width(config.frame_width * 0.85)

        # Başlığın altında ortalı konumlandır
        content_center = DOWN * 0.3   # biraz aşağı kaydır
        formula.move_to(content_center)

        # Çakışma kontrolü
        if formula.get_top()[1] > title.get_bottom()[1] - 0.3:
            formula.next_to(title, DOWN, buff=0.5)

        self.play(Write(title))
        self.play(Write(formula))
```

### Yöntem B — Başlığı Fade Out Yap

```python
class FadeOutTitleScene(Scene):
    def construct(self):
        title = Text("İntegral Alma", font_size=48, color=BLUE)
        title.to_edge(UP, buff=0.4)
        self.play(Write(title))
        self.wait(0.8)

        # Başlığı kaldır, içeriğe geç
        self.play(
            title.animate.scale(0.5).to_corner(UL, buff=0.2).set_opacity(0.4),
            run_time=0.6
        )
        # Şimdi tüm ekran içerik için serbest
        formula = MathTex(r"\int_a^b f(x)\,dx", font_size=64)
        formula.move_to(ORIGIN)
        self.play(Write(formula))
```

---

## VGroup Düzeni — Taşmasız

```python
# ✗ YANLIŞ — elle konumlandırma çakışmaya yol açar
title.move_to(UP * 3)
formula.move_to(ORIGIN)
explanation.move_to(DOWN * 3)  # ekrandan çıkabilir!

# ✓ DOĞRU — VGroup ile otomatik yerleştir
content = VGroup(
    Text("Kök İfadesi", font_size=36, color=BLUE),
    MathTex(r"\sqrt[n]{a^m} = a^{m/n}", font_size=48),
    Text("Özel durum: n=2 için kare kök", font_size=28, color=GRAY),
)
content.arrange(DOWN, buff=0.5, center=True)

# Toplam yükseklik kontrolü
if content.height > config.frame_height * 0.80:
    content.scale_to_fit_height(config.frame_height * 0.80)

content.move_to(ORIGIN)
```

---

## Adım Adım Ekranda Birden Fazla Formül

```python
class MultiStepSafeScene(Scene):
    def construct(self):
        title = Text("İspat", font_size=34, color=BLUE).to_edge(UP, buff=0.3)
        self.play(Write(title))

        steps = [
            MathTex(r"(a+b)^2"),
            MathTex(r"= (a+b)(a+b)"),
            MathTex(r"= a^2 + ab + ba + b^2"),
            MathTex(r"= a^2 + 2ab + b^2"),
        ]

        # Adımları diz — başlığın altından başla
        steps_group = VGroup(*steps)
        steps_group.arrange(DOWN, buff=0.4, aligned_edge=LEFT)
        steps_group.next_to(title, DOWN, buff=0.5)
        steps_group.to_edge(LEFT, buff=0.7)

        # Tüm grup sığıyor mu kontrol et
        if steps_group.get_bottom()[1] < -config.frame_height / 2 + 0.3:
            steps_group.scale_to_fit_height(
                config.frame_height - title.height - 1.2
            )
            steps_group.next_to(title, DOWN, buff=0.4)
            steps_group.to_edge(LEFT, buff=0.7)

        # Birer birer göster
        for step in steps:
            self.play(Write(step), run_time=0.7)
            self.wait(0.8)

        self.wait(1.5)
```

---

## Kamera Hareketi ile Büyütme/Küçültme

```python
class SafeZoomScene(MovingCameraScene):
    def construct(self):
        formula = MathTex(r"\sqrt{\frac{a^2+b^2}{c}}", font_size=48)
        formula.move_to(ORIGIN)

        self.play(Write(formula))

        # Belirli kısmı büyüt — kamerayı formula'ya sabitle
        target_part = formula[0]  # kök sembolü
        self.play(
            self.camera.frame.animate
                .move_to(target_part.get_center())
                .set(width=target_part.width * 3),
            run_time=1.5
        )
        self.wait(1)

        # Geri çek
        self.play(
            self.camera.frame.animate
                .move_to(ORIGIN)
                .set(width=config.frame_width),
            run_time=1.0
        )
```

---

## Isi Biten Mobject'i Ekranda Bırakma

Bir mobject görevini tamamladıktan sonra sahnede kalırsa, sonraki adımda eklenen
yeni ve ilgisiz içerikle **çakışır** — bu, aynı anda iki büyük mobject'in
üst üste binmesinden farklı bir hata: burada sorun *zamanlama*, konumlandırma
değil. `forbid_full_clear` aktifken bile bunun anlamı sahneyi asla temizleme
değildir; yalnızca continuity anchor'ını (bir sonraki segmentin devam edeceği
görsel durumu) tam ekran `clear()` ile silme demektir. İşi biten tekil
mobject'leri `FadeOut` veya `self.remove()` ile kaldırmak serbesttir ve
zorunludur.

```python
# ✗ YANLIŞ — adim1 hâlâ ekrandayken adim2 ekleniyor, ikisi çakışıyor
self.play(Write(adim1))
self.wait(1)
self.play(Write(adim2))   # adim1 kaldırılmadı, ikisi üst üste biner

# ✓ DOĞRU — işi biten mobject kaldırılır, sonra yenisi eklenir
self.play(Write(adim1))
self.wait(1)
self.play(FadeOut(adim1))
self.play(Write(adim2))

# ✓ DOĞRU — devam eden continuity anchor'ı koru, yalnız yardımcı mobject'i temizle
self.play(Write(explanation_label))
self.wait(1)
self.play(FadeOut(explanation_label))   # anchor_graph ekranda kalmaya devam eder
self.play(Create(next_step_arrow))
```

**Kural:** Bir mobject bir daha referans alınmayacaksa veya sahnenin geri
kalanında görsel olarak anlamsızsa, tanıtıldığı adımdan hemen sonra
`FadeOut`/`self.remove()` ile kaldır. Yalnızca `continuity.visual_start_state`
içindeki anchor mobject sahnenin sonuna kadar ekranda kalabilir.

---

## Sık Yapılan Hatalar ve Düzeltmeleri

| Hata | Sebep | Düzeltme |
|---|---|---|
| Formül ekrandan taşıyor | `font_size` çok büyük | `scale_to_fit_width()` çağır |
| Başlık ile içerik üst üste | `move_to(ORIGIN)` her ikisi için de | Başlık `to_edge(UP)`, içerik `next_to(title, DOWN)` |
| `VGroup.arrange()` sonrası taşma | `buff` değeri formül genişliğini hesaba katmıyor | Arrange sonrası `fit_to_safe_area()` çağır |
| Adım adım formüller ekranın altına iniyor | Önceden yükseklik hesaplanmıyor | Tüm grubu oluştur, sığıp sığmadığını kontrol et, sonra animasyonu başlat |
| `to_corner()` sonrası üst üste | Köşedeki mobject yeni eklenenle çakışıyor | Köşedeki mobject'i `FadeOut` yap veya konumları manuel kontrol et |
| Yazı çok büyük | `Text(font_size=72)` varsayılan | Başlık için max 48, gövde için max 34 kullan |
| Eski adım yeni adımla çakışıyor | İşi biten mobject `FadeOut`/`remove()` ile kaldırılmadan yenisi eklendi | Her mobject'i görevi bitince kaldır; yalnızca continuity anchor'ı sahnede tut |

---

## Güvenli Font Size Limitleri

```python
# Başlık (1-2 kelime)
title = Text("Türev",  font_size=48)  # max: 56

# Alt başlık / bölüm
subtitle = Text("Limit Tanımı", font_size=34)  # max: 40

# Gövde metni
body = Text("Kural: ...", font_size=28)  # max: 32

# Dipnot / kaynak
footnote = Text("*Leibniz notasyonu", font_size=20)  # max: 24

# Ana formül (tek başına ekranda)
big_formula = MathTex(r"\sqrt{x}", font_size=72)  # max: 96 (tek başına)

# Adım adım formüller (birden fazla aynı anda)
step_formula = MathTex(r"\frac{d}{dx}[x^n]", font_size=44)  # max: 52
```