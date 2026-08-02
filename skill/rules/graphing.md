# Axes Grafik Metodları — Once Plot, Sonra Kullan

## Sorun

`Axes.get_area()`, `Axes.get_riemann_rectangles()` gibi metodlar bir
**ciziği** (`axes.plot(...)`'un dondurdugu mobject) bekler; ham bir Python
fonksiyonu/lambda degil. Ham fonksiyon verilirse Manim bunu bir grafik
mobject'i sanip `graph.function(...)` cagirmaya calisir ve su hatayla
kirilir: `AttributeError: 'function' object has no attribute 'function'`.

```python
# ✗ YANLIŞ — get_area'ya dogrudan lambda veriliyor, mobject degil
area = axes.get_area(
    lambda x: (x**2 - 4 * x + 3) * np.exp(-x),
    x_range=[0, 2],
    color=BLUE
)

# ✓ DOĞRU — once axes.plot() ile grafik mobject'i olustur, sonra kullan
graph = axes.plot(
    lambda x: (x**2 - 4 * x + 3) * np.exp(-x),
    x_range=[0, 2],
    color=BLUE
)
area = axes.get_area(graph, x_range=[0, 2], color=BLUE, opacity=0.5)
```

**Kural:** `axes.plot(fonksiyon, x_range=..., color=...)` her zaman ONCE
cagrilir ve sonucu bir degiskene atanir (orn. `graph`). `get_area`,
`get_riemann_rectangles` gibi turetilmis gorseller isteyen her Axes metodu
bu `graph` degiskenini alir; ham fonksiyonu degil.

```python
# ✓ DOĞRU — Riemann dikdortgenleri de ayni sekilde onceden cizilmis grafigi ister
rectangles = axes.get_riemann_rectangles(graph, x_range=[0, 2], dx=0.2)
```
