export function buildMandatoryManimContract({ mathTexAvailable, font = 'Georgia' } = {}) {
  const mathContract = mathTexAvailable
    ? `Matematiksel sembol ve ifadeleri yalniz MathTex(r"...") ile render et. Text yalniz dogal dil icindir ve font=${JSON.stringify(font)} kullanir.`
    : `LaTeX bu runtime'da kapaliysa MathTex/Tex kullanma. Dogal dil ve sade ASCII matematik icin Text(..., font=${JSON.stringify(font)}) kullan; kok, kesir ve ok gibi yapilari Line, VGroup ve Arrow ile geometrik kur.`;

  return `## ZORUNLU MANIM SKILL SOZLESMESI
Asagida tam metni verilen skill/skill.md, math_rendering.md ve layout_safety.md tavsiye degil, kod uretim sozlesmesidir. Cikti vermeden once asagidaki kontrol listesini icinden eksiksiz dogrula:
1. Yalniz Python kodu, from manim import * ve tam bir Scene/MovingCameraScene sinifi var.
2. ${mathContract}
3. fit_to_safe_area(mob, max_w_ratio=0.88, max_h_ratio=0.80) yardimcisini gercekten tanimla; tanimsiz helper cagirma. Formulleri ve VGroup'lari ilk self.play oncesinde bu kontrolden gecir.
4. Baslik font_size en fazla 48, govde en fazla 32; icerik genisligi frame'in 0.88'ini, yuksekligi 0.80'ini gecmez.
5. Baslik ust bolgede, ana icerik merkezde, kisa bilgi altta kalir; get_top/get_bottom veya next_to ile cakisma kontrol edilir.
6. Elle daginik move_to yerine VGroup.arrange kullan; arrange sonrasinda yeniden safe-area kontrolu yap.
7. self.camera.frame kullaniliyorsa MovingCameraScene sec; kamera finalde guvenli ana kadraja doner.
8. speech.speech_text veya narration metnini Text/Paragraph/MarkupText icine kopyalama. Her Text en fazla 42 karakter ve 6 kelime olsun; yalniz kisa etiket veya baslik olarak kullanilsin.
9. continuity.visual_start_state ilk animasyondan once kurulur; forbid_full_clear true ise sahne siyaha temizlenmez.
10. Tum self.play/self.wait bloklari progressive render icin kisa ve animasyon toplam suresi ses suresine yakindir.
11. Metin-only sahne yasaktir. Her segmentte en az bir gercek gorsel model bulunur: sekil, ok, zaman cizelgesi, diyagram, grafik, eksen, sayi dogrusu, geometrik donusum veya MathTex formulu.
12. Axes ve NumberLine icin include_numbers=False kullan; gerekiyorsa az sayida etiketi MathTex ile elle ekle. DecimalNumber tabanli otomatik etiketleme kullanma.
13. Scene icinde self.camera.frame kullanma; kamera frame animasyonu gerekiyorsa sinifi MovingCameraScene yap. expo_out yerine rate_functions.ease_out_expo kullan.
14. Ciktidan once isimleri zihinsel olarak kontrol et: kullanilan her degisken ve helper daha once tanimli, her Transform hedefi bir Mobject, her indeks mevcut ve kodda tek Scene sinifi var.
15. Isi biten her mobject, yeni ve iliskisiz icerik eklenmeden once FadeOut/self.remove() ile ekrandan kaldirilir; hicbir mobject amacindan sonra sahnede gereksiz yere kalip sonraki adimla cakismaz. Bu, forbid_full_clear ile celismez: tek tek kaldirma serbesttir, yalniz continuity.visual_start_state'i tasiyan ana anchor tam ekran clear ile silinmez.
16. Baska bir mobject'in geometrisine bagli her mobject (iki dogru arasindaki aci, dik aci, mesafe gostergesi, orta nokta, teget) tahmini koordinat veya sabit sayiyla degil, kaynagin gercek geometrisinden turetilir: aci icin Angle(line1, line2, radius=...) / dik aci icin RightAngle(line1, line2, length=...) kullan; radius'u min(line1.get_length(), line2.get_length()) * 0.25 gibi kaynak uzunluguna orantila ve makul bir ust sinirla (orn. 0.8) sinirla. Kendi Arc/Sector ile aci taklit etme, get_start/get_end/get_center/get_length/get_angle disinda tahmini konum yazma.
17. axes.get_area(...) ve axes.get_riemann_rectangles(...) gibi metodlara asla ham fonksiyon/lambda verme; once graph = axes.plot(fonksiyon, x_range=..., color=...) ile ciz, sonucu (graph) bu metodlara ver. Ham fonksiyon vermek 'function' object has no attribute 'function' hatasiyla render'i kirar.
Bu maddelerden biri saglanmiyorsa kodu cikti vermeden once duzelt.`;
}
