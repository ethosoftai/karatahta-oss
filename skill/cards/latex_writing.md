# Kart Bölümünde LaTeX / Adım Yazımı

`question_solving.md` ile birlikte, yalnız soru çözüm kartlarında yüklenir.
Kartın en sık bozulma sebebi — video pipeline'ındaki gibi — **üst üste
binme**: iki `text`/`math` step'i birbirine çok yakın `y` alırsa veya bir
etiket bir şeklin tam merkezine denk gelirse okunmaz hale gelir. Burada
kesin koordinat kuralları var — `y` değerini tahmin etmeyin.

## Kanvas ve Zon Referansı

Kart 1080×1350 px (dikey, 4:5). Koordinatlar 0-1 normalize, `(0,0)` sol-üst.
`title` alanı otomatik olarak üstte `top: 6%` konumuna sistem tarafından
yazılır — bu yüzden **hiçbir step `y < 0.16` almasın**, başlıkla çakışır.

```text
y = 0.00 - 0.16   BASLIK ZONU (dokunma; title alani otomatik burada)
y = 0.16 - 1.00   ICERIK ZONU (tum steps burada)
```

`question_solving.md`'nin kart-kart Verilen/Adım/Sonuç akışı burada **kartlar
arası** bölünür (video'daki gibi tek kart içinde üç yatay bant değil) — bu
dosya yalnız **tek bir kartın içindeki** step'lerin çakışmadan dizilmesini
anlatır.

## Dikey İstifleme Formülü

Bir kartta `N` adet `text`/`math` step'i alt alta dizilecekse:

```text
CONTENT_TOP = 0.16
CONTENT_BOTTOM = 0.95
# N=1 ise ortala, N>1 ise esit araliklarla dagit:
y_i = N == 1
    ? (CONTENT_TOP + CONTENT_BOTTOM) / 2
    : CONTENT_TOP + (CONTENT_BOTTOM - CONTENT_TOP) * i / (N - 1)   # i = 0..N-1
```

**Minimum güvenli aralık** (`y_i` ile `y_{i+1}` arası) step tipine göre
değişir çünkü `math` step'leri `text`'ten ~1.4× büyük render edilir
(`cardRenderer.js`) ve KaTeX display-mode kesir/üs içeren ifadelerde daha da
yükselir:

| Ardışık ikili | Minimum `y` farkı |
|---|---|
| text → text | 0.12 |
| text → math | 0.15 |
| math → math | 0.18 |
| math (kesir/üs/kök içeriyorsa) → herhangi | 0.20 |

`MAX_VISIBLE_STEPS_PER_CARD = 4` — bir kartta 4'ten fazla `text`/`math`
step'i varsa `CONTENT_TOP..CONTENT_BOTTOM` aralığına sığmaz, okunmaz olur.
Sığmıyorsa içeriği ikiye bölüp yeni bir kart aç (`is_last:false` bırak).

## Şekil + Etiket Çakışması

Bir `circle`/`rect` step'inin **tam merkezine** aynı `x,y` ile bir `text`
koyma — ikisi de kendi merkezine göre ortalanır (`translate(-50%,-50%)`),
üst üste biner. Etiketi şeklin **dışına**, yarıçapı/yarı-yüksekliği kadar
kaydırarak yerleştir:

```json
{ "type": "circle", "x": 0.5, "y": 0.35, "r": 0.12, "color": "#60a5fa" },
{ "type": "text", "x": 0.5, "y": 0.35 - 0.12 - 0.06, "text": "r = 5 cm", "size": 24, "color": "#f8fafc" }
```

```json
{ "type": "rect", "x": 0.3, "y": 0.5, "w": 0.2, "h": 0.15, "color": "#4ade80" },
{ "type": "text", "x": 0.3, "y": 0.5 + 0.15/2 + 0.06, "text": "Kutle: 4 kg", "size": 22, "color": "#f8fafc" }
```

`line`/`arrow` step'lerinin etiketi de aynı kural: `(x1,y1)`-`(x2,y2)`
orta noktasından `y` ekseninde en az `0.08` uzağa koy.

## Tam Örnek — Verilen/Adım/Sonuç Kartları

Üç köşesi verilen bir üçgende çevre hesabı (3 kartlık akış):

**Kart 1 — Verilenler** (`is_last: false`):
```json
{
  "title": "Üçgenin Çevresi",
  "explanation": "Kenar uzunlukları verilen bir üçgenin çevresini bulacağız. Önce üçgeni ve verilen kenarları çizelim.",
  "scene": {
    "steps": [
      { "type": "line", "x1": 0.2, "y1": 0.75, "x2": 0.8, "y2": 0.75, "color": "#60a5fa" },
      { "type": "line", "x1": 0.2, "y1": 0.75, "x2": 0.5, "y2": 0.30, "color": "#60a5fa" },
      { "type": "line", "x1": 0.8, "y1": 0.75, "x2": 0.5, "y2": 0.30, "color": "#60a5fa" },
      { "type": "text", "x": 0.5, "y": 0.85, "text": "a = 7 cm", "size": 24, "color": "#f8fafc" },
      { "type": "text", "x": 0.28, "y": 0.50, "text": "b = 5 cm", "size": 24, "color": "#f8fafc" },
      { "type": "text", "x": 0.72, "y": 0.50, "text": "c = 6 cm", "size": 24, "color": "#f8fafc" }
    ]
  },
  "is_last": false
}
```
(Üç kenar etiketi de üçgenin kenarlarına `0.08`+ uzaklıkta, birbirinden en
az `0.12` `y` farkıyla — çakışma yok.)

**Kart 2 — Adım** (`is_last: false`):
```json
{
  "title": "Çevre Formülü",
  "explanation": "Çevre, üç kenarın toplamıdır. Değerleri yerine koyup toplayalım.",
  "scene": {
    "steps": [
      { "type": "math", "x": 0.5, "y": 0.35, "latex": "C = a + b + c", "size": 26, "color": "#f8fafc" },
      { "type": "math", "x": 0.5, "y": 0.55, "latex": "C = 7 + 5 + 6", "size": 26, "color": "#facc15" }
    ]
  },
  "is_last": false
}
```
(İki `math` step'i arası `0.20` — kurala göre minimum `0.18`'i karşılıyor.)

**Kart 3 — Sonuç** (`is_last: true`):
```json
{
  "title": "Sonuç",
  "explanation": "Üç kenarı topladığımızda üçgenin çevresi 18 santimetre çıkar.",
  "scene": {
    "steps": [
      { "type": "math", "x": 0.5, "y": 0.45, "latex": "C = 18\\ \\text{cm}", "size": 34, "color": "#4ade80" },
      { "type": "rect", "x": 0.5, "y": 0.45, "w": 0.45, "h": 0.14, "color": "#4ade80", "fill": false }
    ]
  },
  "is_last": true
}
```
(Vurgu kutusu `rect` sonuç `math`'ının etrafını sarar, aynı `x,y` merkezli
olması burada istisna — kutu etiket değil, çerçeve.)

## Sık Yapılan Ek Hatalar (kart bölümüne özel)

| Hata | Sebep | Düzeltme |
|---|---|---|
| Etiket şeklin tam üstünde | Aynı `x,y` hem şekle hem `text`'e verilmiş | Etiketi şeklin `r`/`w`/`h` payı kadar dışına kaydır |
| Kartta 5+ step okunmuyor | `MAX_VISIBLE_STEPS_PER_CARD` aşılmış | İçeriği ikiye bölüp yeni kart aç |
| İki `math` step'i çakışıyor | `y` farkı `0.12` (text kuralı) kullanılmış | `math`→`math` için `0.18`, kesirli/üslü ifadede `0.20` kullan |
| Sonuç ilk kartta veriliyor | `is_last:true` erken işaretlenmiş | Sonucu yalnızca gerçekten son karta koy |
