# Geometrik İlişki Doğruluğu — Türetilmiş Mobject'ler

## Sorun

Bir mobject başka bir mobject'in geometrisine göre var olduğunda (iki doğru
arasındaki açı, bir noktadaki teğet, dikey mesafe göstergesi, orta nokta
etiketi...), bu mobject **elle tahmin edilen koordinat veya sabit sayılarla**
değil, kaynağın gerçek geometrisinden **hesaplanarak** kurulmalıdır. Elle
tahmin edilen `Arc(radius=2, start_angle=..., ...)` veya `move_to([x, y, 0])`
gibi sabit değerler, doğrular farklı uzunluk/açıda olduğunda ya çok büyük bir
yay çizer ya da yayı doğruların kesişim noktasından uzağa yerleştirir.

```python
# ✗ YANLIŞ — açı yayı tahmini sabitlerle çiziliyor
line1 = Line(ORIGIN, RIGHT * 3)
line2 = Line(ORIGIN, UP * 2)
angle_arc = Arc(radius=1.5, start_angle=0, angle=PI / 3)  # dogrularin gercek acisiyla ilgisi yok
angle_arc.move_to(ORIGIN + RIGHT * 0.3 + UP * 0.3)         # kesisim noktasindan tahmini kaydirma

# ✓ DOĞRU — Angle, iki Line objesinden kesisim noktasini ve gercek acisini kendisi hesaplar
line1 = Line(ORIGIN, RIGHT * 3)
line2 = Line(ORIGIN, UP * 2)
angle_arc = Angle(line1, line2, radius=min(line1.get_length(), line2.get_length()) * 0.25)
angle_label = MathTex(r"\theta", font_size=32).move_to(
    angle_arc.point_from_proportion(0.5) * 1.4  # yayin orta noktasindan disari dogru
)
```

**Kural:** İki doğru arasındaki açı için her zaman `Angle(line1, line2, radius=...)`
kullan; dik açı için `RightAngle(line1, line2, length=...)` kullan. Kendi
`Arc`/`Sector` ile açı taklit etme.

## Açı Yayı Boyutu

Yay yarıçapını **ilişkili olduğu doğruların uzunluğuna göre** ölçekle, sabit
bir sayı yazma:

```python
# ✗ YANLIŞ — sabit yarıçap, kısa doğrularda ekranı kaplar, uzun doğrularda görünmez kalır
angle_arc = Angle(line1, line2, radius=1.5)

# ✓ DOĞRU — en kısa doğrunun ~%20-30'u kadar, makul bir üst sınırla
safe_radius = min(line1.get_length(), line2.get_length()) * 0.25
safe_radius = min(safe_radius, 0.8)
angle_arc = Angle(line1, line2, radius=safe_radius)
```

## Diğer Türetilmiş İlişkiler

Aynı ilke başka ilişkili mobject türlerine de uygulanır — pozisyon/boyutu
elle tahmin etme, kaynak mobject'in gerçek geometrisinden hesapla:

```python
# İki nokta arası mesafe göstergesi
brace = Brace(Line(point_a, point_b), direction=UP)
distance_label = MathTex(f"{distance:.1f}").next_to(brace, UP, buff=0.15)

# Bir doğrunun orta noktası
midpoint_dot = Dot(line.get_center())

# Bir doğrunun eğimiyle hizalı etiket
slope_label = MathTex("m").next_to(line, line.copy().rotate(PI / 2).get_unit_vector(), buff=0.2)

# Kaynak mobject animasyon sırasında hareket ediyorsa, türetilmiş mobject'i de senkron tut
angle_arc = always_redraw(lambda: Angle(line1, line2, radius=safe_radius))
```

**Kural:** `next_to`, `move_to` veya `Arc`/`Line` ile manuel kurulan her
ilişkisel mobject için, konum/boyut hesaplaması kaynak mobject'in
`get_start()`, `get_end()`, `get_center()`, `get_length()`, `get_angle()`
gibi gerçek değerlerinden türetilmelidir. Kaynak mobject `self.play()` ile
hareket ediyorsa, ilişkili mobject `always_redraw(lambda: ...)` içine alınır.
