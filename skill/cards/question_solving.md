# Kart Bölümünde Soru Çözümü Rehberi

Bu dosya yalnızca öğrenci bir **soru** verdiğinde (typed veya fotoğraf →
transkript) yüklenir — `topic` ile genel bir konu anlatımı istendiğinde
devrede değildir. Video pipeline'ındaki `skill/question/question_solving.md`
ile aynı iki zorunlu unsuru taşır ama **kart formatına** uyarlanmıştır:

1. **Görselleştirme** — sorunun nesnesini (üçgen, sayı doğrusu, molekül,
   diyagram, ne ise) `circle`/`rect`/`line`/`arrow` adımlarıyla gerçekten
   çiz. Yalnızca `text`/`math` ile "cevap şu" demek yasak.
2. **Yazılı adımlar** — her hesaplama/çıkarım adımı ayrı bir `math`/`text`
   step olarak görünmeli (nasıl çakışmadan diziliceği için bkz.
   `latex_writing.md`).

## Kart = Video Segmenti Değil, Tek Kare

Video pipeline'ında bir segment saniyelerce sürer ve adımlar sırayla
animasyonla belirir. Kart tek bir **statik görsel**; hareket yok. Bu yüzden
"adım adım" ilerleme zaman içinde değil, **kart kart** ilerler:

```text
Kart 1 (VERILEN)   — sorunun nesnesi + verilenler, tek görselde
Kart 2 (ADIM)      — ilk işlem/ilişki, önceki karttan devam eden görsel
Kart 3 (ADIM)      — sonraki işlem (gerekiyorsa; MAX_CARDS=4 sınırı var)
Kart 4 (SONUÇ)     — is_last:true, cevap vurgulanmış, kısa "neden" cümlesi
```

Zor olmayan sorularda 2-3 kart yeterli olabilir (`is_last` erken `true`
olur) — kural sabit sayı değil, **her kart tam olarak bir fikri taşımalı**.
Sığdırmak için bir kartta iki farklı hesap adımını sıkıştırma; bunun yerine
`is_last:false` bırakıp bir kart daha üret.

## Kartlar Arası Süreklilik

Video pipeline'ının `continuity` mekanizması burada yok — her kart LLM'e
`priorCards` özeti (önceki kartların title+explanation'ı, `cardsEngine.js`)
olarak metin şeklinde verilir, görsel devralınmaz. Bu yüzden:

- Kart 2'nin görseli Kart 1'in verilerini **görsel olarak tekrar çizmeli**
  (öğrenci kartları yan yana/sırayla görür, hafızasından hatırlaması
  beklenmez), ama Kart 1'de zaten söylenmiş her ayrıntıyı `explanation`'da
  tekrar etme — `explanation` yalnızca O kartta yeni olanı anlatsın.
- Görsel tutarlılık (renkler, aynı nesnenin aynı konumda durması) elle
  korunmalı: Kart 1'de üçgenin A köşesi sol-üstteyse, Kart 2'de de aynı
  x/y'de olmalı.

## Branşa Göre "Ne Çizilir" (kart step tipleriyle)

| Branş | Görselleştirme nesnesi | Kart step karşılığı |
|---|---|---|
| Matematik (geometri) | Şeklin kendisi, ölçülerle etiketli | `line`/`circle`/`rect` ile şekli çiz, köşe/kenar değerlerini `text` ile şeklin hemen yanına yerleştir (üstüne değil — bkz. `latex_writing.md`) |
| Matematik (cebir/analiz) | Denklem/fonksiyon, mümkünse basit eksen çizimi | İki `line` ile x/y ekseni, fonksiyonu `math` ile üstte göster |
| Fizik | Cisim + kuvvet/hareket oku | Cismi `rect`/`circle`, kuvvetleri `arrow` ile göster, büyüklüğü yanına `math` |
| Kimya | Molekül/tepkime denklemi | Denklemi `math`, gerekiyorsa basit bağ şeması için `circle`+`line` |
| Biyoloji | Süreç/yapı şeması | Sıralı `circle`/`rect` kutular + aralarında `arrow`, her kutunun altına kısa `text` |
| Diğer branşlar (coğrafya/tarih/edebiyat/felsefe/ingilizce/programlama) | Kavram/zaman çizelgesi | `line` ile zaman çizgisi/akış oku, üzerine `text` etiketleri; soyut kalırsa en azından bir `rect`/`arrow` ile ilişkiyi göster — düz `text` yığını yasak |

## Yasaklar

- Soru metninin tamamını bir karta basma; yalnızca sayısal/sembolik
  verilenleri göster.
- Cevabı ilk kartta verme; `is_last:true` olan son kart dışında sonuç
  vurgusu yapma.
- Bir kartta 4'ten fazla `text`/`math` step'i aynı anda göstermeye çalışma
  — `latex_writing.md`'deki `MAX_VISIBLE_STEPS_PER_CARD` kuralına bak, sığmazsa
  yeni kart aç.
