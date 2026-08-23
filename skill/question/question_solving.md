# Soru Çözümü Rehberi

Bu dosya yalnızca öğrencinin çözemediği bir soruyu (foto veya metin) çözdüğümüz
videolarda yüklenir — genel konu anlatımı derslerinde devrede değildir. Amaç
"konuyu anlatmak" değil, **verilen soruyu uçtan uca, adım adım, görsel
kanıtla çözmektir**.

## İki Zorunlu Unsur

Her soru çözüm segmentinde ikisi de eksiksiz olmalı:

1. **Görselleştirme** — sorunun nesnesini (üçgen, grafik, devre, molekül,
   metin parçası, ne ise) ekranda gerçekten çiz/kur. Sadece formül yazıp
   "cevap şu" demek yasak.
2. **Yazılı adımlar** — her hesaplama/çıkarım adımı ekranda ayrı bir satır
   olarak görünür kalmalı (nasıl yazılacağı için bkz. `latex_writing.md`).
   Öğrenci videoyu durdurup adımı okuyabilmeli.

Bu iki unsur **aynı anda, birbirini besleyerek** ilerler: görsel değişince
karşılığındaki adım yazılır, adım yazılınca görsel onu yansıtır. Önce tüm
görseli bitirip sonra tüm adımları alt alta yazmak (ya da tersi) yasak.

## Zorunlu Ekran Sözleşmesi: Verilenler → Adımlar → Sonuç

Ana pipeline'ın kuralı ("Ekranda soru metninin tamamını basma; gerekli
verilenleri, işlem adımlarını ve sonucu göster") burada somut bir yerleşime
dönüşür. `layout_safety.md`'deki `TITLE_ZONE_H` / `CONTENT_ZONE_H` /
`FOOTER_ZONE_H` bölünmesinin üstüne, `CONTENT_ZONE_H` içini üçe ayır:

```text
TITLE_ZONE   (üst ~%18)   — soru başlığı / segment başlığı (küçük, sabit)
CONTENT_ZONE (orta ~%65)  — üç alt bölge, GIVEN_ZONE'un tamamı sabit kalır:
  GIVEN_ZONE   (üst ~%25'i)  — verilenler, sabit, segment boyunca ekranda kalır
  STEPS_ZONE   (orta ~%55'i) — o an işlenen adım(lar), sıralı güncellenir
  RESULT_ZONE  (alt ~%20'si) — yalnız son adımda, vurgulu kutuda belirir
FOOTER_ZONE  (alt ~%17)   — boş bırak veya kaynak/dipnot
```

Kesin koordinatlar ve kod için `latex_writing.md`'deki `GIVEN_ZONE_*` /
`STEPS_ZONE_*` / `RESULT_ZONE_*` sabitlerini kullan — burada anlatılan yalnız
kavramsal bölünme.

**Neden GIVEN_ZONE sabit kalır:** öğrenci "verilenleri" tekrar tekrar
aramamalı. Bir kere yazılır, segment boyunca (veya sorunun tamamı boyunca)
ekranda durur; yalnız STEPS_ZONE ve RESULT_ZONE güncellenir.

**En sık hata — üst üste bindirme:** STEPS_ZONE'da yeni bir adım yazılırken
önceki adım kaldırılmadan/taşınmadan üstüne yazılırsa metinler karışır. Bu,
projede zaten en sık görülen render hatasıdır (`layout_safety.md`'nin "Sık
Yapılan Hatalar" tablosuna bkz.). Soru çözümünde STEPS_ZONE sürekli
güncellendiği için bu risk normal ders anlatımından daha yüksektir — adım
geçişlerinde kesinlikle `latex_writing.md`'deki `advance_step()` deseninden
sap.

## Branşa Göre "Ne Çizilir"

Aşağıdaki tablo her branş için **görselleştirme nesnesi**ni belirler. Soru
hangi branşa aitse (bkz. `skill/subjects/<branş>.md`, o dosya branşın genel
Manim kurallarını, bu dosya spesifik olarak *soru çözerken* ne çizileceğini
anlatır) bu satırı uygula:

| Branş | Görselleştirme nesnesi | Somut örnek |
|---|---|---|
| Matematik (geometri) | Şeklin kendisi, verilen ölçülerle etiketli | Üçgen sorusu → gerçek üçgeni çiz, kenar/açı değerlerini üstüne yaz, istenen kenarı/açıyı sonda vurgula |
| Matematik (cebir/analiz) | Denklem/fonksiyonun kendisi, gerekiyorsa grafiği | Türev sorusu → fonksiyonu ve (varsa) grafiğini çiz, teğet doğruyu STEPS_ZONE'daki işlemle eşzamanlı göster |
| Matematik (olasılık/istatistik) | Örnek uzayı / ağaç diyagramı / tablo | Zar sorusu → olası durumları ağaç veya tablo olarak kur, istenen durumları vurgula |
| Fizik | Serbest cisim / hareket / devre diyagramı | Kuvvet sorusu → cismi ve üzerindeki kuvvet vektörlerini çiz, F=ma'yı STEPS_ZONE'da uygula |
| Kimya | Molekül/tepkime denklemi, gerekiyorsa yapı | Denkleştirme sorusu → dengesiz denklemi göster, katsayıları adım adım STEPS_ZONE'da düzelt, dengeli hali RESULT_ZONE'da vurgula |
| Biyoloji | Süreç/yapı diyagramı | Mitoz sorusu → evreleri sırayla diyagramla göster, sayım/oran istenen kısmı STEPS_ZONE'da hesapla |
| Coğrafya | Harita/kesit/grafik şeması | İklim sorusu → basitleştirilmiş enlem/harita şeması, sonucu etkileyen unsurları sırayla işaretle |
| Tarih | Zaman çizelgesi / neden-sonuç şeması | Kronoloji sorusu → olayları zaman çizgisinde sırala, istenen ilişkiyi STEPS_ZONE'daki mantık zinciriyle kur |
| Edebiyat | Metin/dize üzerinde işaretleme + kavram şeması | Söz sanatı sorusu → dizeyi ekrana al, sanatı gösteren kelimeleri vurgula, tanımı STEPS_ZONE'da eşleştir |
| İngilizce | Cümle yapısı şeması / zaman çizelgesi | Tense sorusu → cümleyi parçalarına ayırıp renklendir, kuralı STEPS_ZONE'da uygula |
| Felsefe | Argüman/kavram şeması (öncül → sonuç oku) | Argüman sorusu → öncülleri kutulara yaz, sonuca giden oku STEPS_ZONE'da adım adım kur |
| Programlama | Kod/algoritma akışı, değişken durum tablosu | Algoritma sorusu → kodu veya akış şemasını göster, değişkenlerin STEPS_ZONE'da her iterasyondaki değerini güncelle |

Branş `skill/subjects/` altında yoksa (ör. çok disiplinli soru) en yakın
satırı örnek al; kural sabit: **soyut anlatma, somut nesneyi göster.**

## Segment Planlama Kuralı

`createQuestionSolutionPlan` genelde 1-3 segmentlik kısa bir plan üretir.
Segment sayısı ne olursa olsun her segment bu üç fazdan en az birini
ilerletmeli (fazlar segmentler arası bölünebilir, tek segmentte de hepsi
olabilir):

1. **Anla** — soru ne istiyor, verilenler nedir (GIVEN_ZONE kurulur).
2. **Çöz** — verilenlerden sonuca giden işlem zinciri (STEPS_ZONE dolar).
3. **Doğrula/Vurgula** — sonucu RESULT_ZONE'da vurgula, gerekiyorsa "neden bu
   cevap doğru" diye bir cümlelik pekiştirme.

`continuity` alanı (mevcut pipeline sözleşmesi) burada özellikle önemli:
segment 2, segment 1'in GIVEN_ZONE'unu ve STEPS_ZONE'daki son durumunu
**yeniden çizmeden**, `continuityContext`'teki önceki koddan devralmalı —
bkz. ana sistem talimatındaki continuity kuralları.

## Yasaklar

- Soru metninin tamamını ekrana basma (zaten ana kural) — GIVEN_ZONE yalnız
  *sayısal/sembolik verilenleri* içerir, soru cümlesini değil.
- Cevabı önce söyleyip sonra işlemi göstermek yasak; öğrenci süreci görmeli.
- Birden fazla çözüm yolu varsa ikisini aynı anda ekrana sıkıştırma; en
  öğretici olanı seç, videoyu tek bir tutarlı akışta bitir.
- STEPS_ZONE'da 4'ten fazla satırlık adım aynı anda ekranda tutma (okunmaz
  hale gelir) — `latex_writing.md`'deki `MAX_VISIBLE_STEPS` kuralına bak.
