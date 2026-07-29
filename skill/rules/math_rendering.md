# Matematik Render Kuralları

## Temel Kural

**Her matematiksel sembol için `MathTex` kullan. `Text()` asla matematik render etmez.**

Sebep: `Text(font="Georgia")` Unicode karakterleri kullanır ama:
- `√` karakterinin üstündeki yatay çizgi (vinculum) uzamaz → `√x+1` yanlış görünür
- `→` oku bazı fontlarda `2 1` veya `9 2` gibi bozuk karakter dizisi olarak çıkar
- Alt/üst simgeler (`x²`) küçük ve yanlış hizalanır
- Kesirler, integraller, limit gösterimleri düzgün oluşturulmaz

---

## Sorunlu Semboller ve Doğru Yazımları

### Kök İfadeleri

```python
# ✗ YANLIŞ — vinculum uzamaz, içerik dışarı taşar
Text("√(x+1)", font="Georgia")

# ✓ DOĞRU
MathTex(r"\sqrt{x+1}")                    # basit kök
MathTex(r"\sqrt{x^2 + y^2}")             # karealtında ifade
MathTex(r"\sqrt[3]{x}")                  # küpkök
MathTex(r"\sqrt[n]{x}")                  # n. kök
MathTex(r"\sqrt{\frac{a}{b}}")           # kesir altında kök
```

### Limit İfadeleri

```python
# ✗ YANLIŞ — ok "2 1" veya "9 2" gibi bozuk karakter olarak çıkar
Text("lim_{x→0} f(x)", font="Georgia")
Text("lim x→∞", font="Georgia")

# ✓ DOĞRU
MathTex(r"\lim_{x \to 0} f(x)")          # x sıfıra giderken
MathTex(r"\lim_{x \to \infty} f(x)")    # sonsuz limit
MathTex(r"\lim_{x \to 0^+} f(x)")       # sağdan limit
MathTex(r"\lim_{x \to 0^-} f(x)")       # soldan limit
MathTex(r"\lim_{h \to 0} \frac{f(x+h)-f(x)}{h}")  # türev tanımı

# displaystyle: limiti daha büyük/okunaklı göstermek için
MathTex(r"\displaystyle\lim_{x \to 0} f(x)")
```

### Ok İşaretleri

```python
# ✗ YANLIŞ — → Unicode fontta bozulur
Text("x → 0")
Text("A → B")

# ✓ DOĞRU — LaTeX komutları
MathTex(r"x \to 0")           # basit gidiş oku (→)
MathTex(r"A \rightarrow B")   # sağ ok
MathTex(r"A \leftarrow B")    # sol ok
MathTex(r"A \Rightarrow B")   # çift çizgi sağ ok (⇒)
MathTex(r"A \Leftrightarrow B")  # çift yönlü (⟺)
MathTex(r"A \implies B")      # mantıksal sonuç
MathTex(r"\uparrow")          # yukarı ok
MathTex(r"\downarrow")        # aşağı ok
```

### Kesirler

```python
# ✗ YANLIŞ
Text("(x+1)/(x-1)")

# ✓ DOĞRU
MathTex(r"\frac{x+1}{x-1}")
MathTex(r"\frac{d}{dx}\left[f(x)\right]")   # türev notasyonu
MathTex(r"\frac{\partial f}{\partial x}")   # kısmi türev
MathTex(r"\dfrac{a}{b}")    # displaystyle kesir (satır içinde büyük gösterir)
MathTex(r"\tfrac{a}{b}")    # textstyle kesir (daha küçük)
```

### İntegraller

```python
MathTex(r"\int f(x)\,dx")
MathTex(r"\int_a^b f(x)\,dx")                    # belirli integral
MathTex(r"\int_{-\infty}^{\infty} f(x)\,dx")    # sonsuz sınırlı
MathTex(r"\iint f(x,y)\,dx\,dy")                 # çift integral
MathTex(r"\oint C \cdot dr")                     # kapalı eğri integrali
```

### Üs, Alt Simge ve Özel Karakterler

```python
MathTex(r"x^2")              # kare
MathTex(r"x^{n+1}")          # çok karakterli üs
MathTex(r"x_i")              # alt simge
MathTex(r"x_{i,j}")          # çok karakterli alt simge
MathTex(r"x_i^2")            # alt+üst aynı anda
MathTex(r"e^{i\pi} + 1 = 0") # Euler kimliği

# Özel karakterler
MathTex(r"\infty")            # ∞
MathTex(r"\pi")               # π
MathTex(r"\alpha, \beta, \gamma")  # Yunan harfleri
MathTex(r"\Delta x")          # büyük delta
MathTex(r"\nabla f")          # gradyan
MathTex(r"\partial")          # kısmi türev sembolü
MathTex(r"\pm")               # ±
MathTex(r"\cdot")             # çarpma noktası
MathTex(r"\times")            # çarpma X
MathTex(r"\leq, \geq, \neq") # ≤ ≥ ≠
MathTex(r"\approx")           # ≈
MathTex(r"\in, \notin")       # ∈ ∉
MathTex(r"\subset, \cup, \cap") # ⊂ ∪ ∩
MathTex(r"\forall, \exists")  # ∀ ∃
```

### Parantezler — Boyuta Uyum Sağlayan

```python
# ✗ YANLIŞ — sabit boyut, büyük ifadelerde küçük kalır
MathTex(r"(\frac{a}{b})")

# ✓ DOĞRU — \left \right boyutu otomatik ayarlar
MathTex(r"\left(\frac{a}{b}\right)")
MathTex(r"\left[\frac{a}{b}\right]")
MathTex(r"\left\{\frac{a}{b}\right\}")
MathTex(r"\left|\frac{a}{b}\right|")          # mutlak değer
MathTex(r"\left\|\vec{v}\right\|")            # norm
MathTex(r"\left.\frac{df}{dx}\right|_{x=0}") # değer noktası
```

### Matris ve Vektörler

```python
MathTex(r"\vec{v}")           # ok üzeri (vektör)
MathTex(r"\hat{n}")           # şapka (birim vektör)
MathTex(r"\mathbf{A}")        # kalın (matris)

# Tam matris (Tex kullan, çünkü \begin tablosu gerekir)
matrix_tex = MathTex(
    r"\begin{pmatrix} a & b \\ c & d \end{pmatrix}"
)
# Alternatif: Manim'in Matrix sınıfı
m = Matrix([[r"a", r"b"], [r"c", r"d"]])
```

### Toplam ve Çarpım

```python
MathTex(r"\sum_{i=1}^{n} x_i")
MathTex(r"\prod_{i=1}^{n} x_i")
MathTex(r"\sum_{i=0}^{\infty} \frac{x^i}{i!}")  # Taylor serisi
```

---

## Metin ile Formül Karışık Kullanımı

```python
# Aynı satırda metin + formül için Tex kullan
Tex(r"Türev: $f'(x) = \lim_{h \to 0}\frac{f(x+h)-f(x)}{h}$")

# Veya ayrı mobject'ler yan yana diz
label = Text("Türev:", font_size=32)
formula = MathTex(r"f'(x)", font_size=32)
group = VGroup(label, formula).arrange(RIGHT, buff=0.3)

# Çok satırlı hizalı denklem sistemi
aligned = MathTex(
    r"f(x) &= x^2 + 2x + 1 \\",
    r"&= (x+1)^2"
)
```

---

## LaTeX Kurulumu Yoksa Fallback

Eğer ortamda LaTeX kurulu değilse ve `MathTex` hata verirse:

```python
# config.py içinde başa ekle
config.tex_template = TexTemplate()
# veya daha hafif şablon:
myTemplate = TexTemplate()
myTemplate.add_to_preamble(r"\usepackage{amsmath, amssymb}")
MathTex(r"\sqrt{x}", tex_template=myTemplate)
```

Ortam kontrolü:
```bash
# LaTeX kurulu mu?
latex --version
# Manim kendi LaTeX ortamını kullanıyor mu?
python3 -c "from manim import *; print(config.tex_dir)"
```

---

## `MathTex` Parça İndeksleme Rehberi

Renklendirmek için doğru indeksi bul:

```python
formula = MathTex(r"\sqrt{x^2+1}", r"=", r"y")
# İndeks 0: √(x²+1)  İndeks 1: =  İndeks 2: y
formula[0].set_color(BLUE)
formula[2].set_color(YELLOW)

# Belirsizse debug et:
formula = MathTex(r"a+b=c")
for i, part in enumerate(formula):
    print(i, part)   # hangi indeks hangi parça
```