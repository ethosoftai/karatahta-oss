// Ders planinin hangi branşa ait olduğunu tespit eder, böylece Manim kod
// üretimi o branşa özel skill dosyasını (skill/subjects/<subject>.md) da
// sistem promptuna dahil edebilir. LLM'e ayrı bir sınıflandırma çağrısı
// yaptırmak yerine plan zaten Türkçe ürediği için ucuz ve deterministik bir
// anahtar kelime eşleştirmesi kullanılıyor.

export const LESSON_SUBJECTS = [
  'matematik',
  'fizik',
  'kimya',
  'biyoloji',
  'cografya',
  'tarih',
  'edebiyat',
  'ingilizce',
  'felsefe',
  'programlama'
];

const SUBJECT_KEYWORDS = {
  matematik: [
    'matemat', 'turev', 'integral', 'limit', 'fonksiyon', 'denklem', 'esitsizlik',
    'geometri', 'trigonometri', 'sinus', 'cosin', 'tanjant', 'olasilik', 'istatistik',
    'polinom', 'logaritma', 'vektor', 'matris', 'kume ', 'kumeler', 'permutasyon',
    'kombinasyon', 'faktoriyel', 'sayilar teorisi', 'analitik geometri', 'parabol',
    'hiperbol', 'elips', 'seri toplam', 'diferansiyel'
  ],
  fizik: [
    'fizik', 'newton', 'kuvvet', 'hareket', 'hiz ', 'ivme', 'enerji', 'is-enerji',
    'momentum', 'elektrik akim', 'manyetik', 'devre', 'direnc', 'gerilim',
    'dalga', 'optik', 'isik kirilma', 'termodinamik', 'isi ve sicaklik', 'basinc',
    'kutle cekim', 'atom fizigi', 'kuantum', 'relativite', 'elektromanyetik'
  ],
  kimya: [
    'kimya', 'molekul', 'atom', 'periyodik tablo', 'element ', 'bilesik',
    'kimyasal tepkime', 'asit', 'baz ', 'ph ', 'mol ', 'kimyasal bag', 'iyon',
    'elektron dizilim', 'organik kimya', 'polimer', 'redoks', 'cozelti', 'katalizor',
    'kimyasal denklem', 'stokiyometri'
  ],
  biyoloji: [
    'biyoloji', 'hucre', 'dna', 'rna', 'protein sentez', 'genetik', 'kalitim',
    'fotosentez', 'solunum', 'ekosistem', 'organizma', 'evrim', 'mitoz', 'mayoz',
    'sinir sistemi', 'dolasim sistemi', 'sindirim sistemi', 'bakteri', 'virus',
    'enzim', 'kromozom', 'canli siniflandirma'
  ],
  cografya: [
    'cografya', 'iklim', 'harita', 'kita ', 'okyanus', 'nufus', 'yer kabugu',
    'volkan', 'deprem', 'plaka tektonigi', 'erozyon', 'akarsu', 'meridyen',
    'paralel', 'ekvator', 'kutup', 'yeraltı kaynaklari', 'yerlesim', 'goc '
  ],
  tarih: [
    'tarih', 'savas', 'imparatorluk', 'medeniyet', 'devrim', 'antlasma',
    'osmanli', 'cumhuriyet', 'ittihat', 'kurtulus savasi', 'ataturk', 'yuzyil',
    'donem ', 'uygarlik', 'sultan', 'kral ', 'isyan', 'goc dönemi', 'tarihi olay'
  ],
  edebiyat: [
    'edebiyat', 'siir', 'roman', 'hikaye', 'yazar ', 'sair', 'anlatim bicimi',
    'edebi sanat', 'divan edebiyati', 'tanzimat', 'servet-i funun', 'noktalama',
    'cumle ogeleri', 'paragraf', 'dil bilgisi', 'yazim kurali', 'metin turleri',
    'kompozisyon'
  ],
  ingilizce: [
    'ingilizce', 'english', 'grammar', 'tense', 'vocabulary', 'present simple',
    'past simple', 'future tense', 'preposition', 'sentence structure',
    'reading comprehension', 'speaking practice', 'listening practice'
  ],
  felsefe: [
    'felsefe', 'filozof', 'epistemoloji', 'ontoloji', 'etik', 'ahlak felsefesi',
    'varlik felsefesi', 'bilgi felsefesi', 'mantik', 'diyalektik', 'metafizik',
    'felsefi akim', 'varolusculuk', 'idealizm', 'materyalizm'
  ],
  programlama: [
    'programlama', 'algoritma', 'kod ', 'yazilim', 'degisken', 'dongu',
    'fonksiyon tanimla', 'veri yapisi', 'dizi ', 'liste ', 'python', 'javascript',
    'java ', 'c++', 'veritabani', 'sql', 'nesne yonelim', 'api ', 'web gelistirme'
  ]
};

function normalizeForMatch(text) {
  return String(text || '')
    .toLocaleLowerCase('tr-TR')
    .replaceAll('ı', 'i')
    .replaceAll('İ', 'i')
    .replaceAll('ğ', 'g')
    .replaceAll('ş', 's')
    .replaceAll('ö', 'o')
    .replaceAll('ü', 'u')
    .replaceAll('ç', 'c');
}

// plan içindeki konuyu en iyi anlatan metinleri birleştirip aday branşları
// puanlar; en yüksek puanlı branş döner, hiçbiri eşleşmezse null döner ve
// çağıran taraf jenerik (branşsız) skill setiyle devam eder.
export function detectLessonSubject(source) {
  const topic = source?.topic || source?.plan?.topic || '';
  const title = source?.title || '';
  const coreInsight = source?.core_insight || '';
  const segmentTitles = Array.isArray(source?.segments)
    ? source.segments.map((segment) => `${segment?.title || ''} ${segment?.learning_objective || ''}`).join(' ')
    : '';
  const haystack = normalizeForMatch([topic, title, coreInsight, segmentTitles].join(' '));
  if (!haystack.trim()) return null;

  let bestSubject = null;
  let bestScore = 0;
  for (const subject of LESSON_SUBJECTS) {
    const keywords = SUBJECT_KEYWORDS[subject] || [];
    let score = 0;
    for (const keyword of keywords) {
      if (haystack.includes(normalizeForMatch(keyword))) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestSubject = subject;
    }
  }
  return bestSubject;
}
