# Kara Tahta — Geliştirme Yol Haritası ve Mimari Öneriler

> Bu doküman, **Kara Tahta** ile benzer açık kaynak AI + Manim eğitim projelerinin karşılaştırılması sonucunda oluşturulmuş geliştirme yol haritasıdır.
>
> Amaç: Kara Tahta'nın mevcut **progressive Manim streaming** avantajını koruyarak; render güvenilirliği, video kalitesi, hata düzeltme, TTS senkronizasyonu, ölçeklenebilirlik ve eğitim ürün özelliklerini ciddi biçimde geliştirmek.

---

## İçindekiler

- [1. Kara Tahta'nın Mevcut En Büyük Avantajı](#1-kara-tahtanın-mevcut-en-büyük-avantajı)
- [2. Referans Alınan Projeler](#2-referans-alınan-projeler)
- [3. Hedef Mimari](#3-hedef-mimari)
- [4. P0 — İlk Önce Yapılması Gerekenler](#4-p0--ilk-önce-yapılması-gerekenler)
- [5. P1 — İkinci Aşama Geliştirmeler](#5-p1--ikinci-aşama-geliştirmeler)
- [6. P2 — Ürün Genişletme Özellikleri](#6-p2--ürün-genişletme-özellikleri)
- [7. Tüm 20 Önerinin Kısa Listesi](#7-tüm-20-önerinin-kısa-listesi)
- [8. Önerilen Backend Klasör Yapısı](#8-önerilen-backend-klasör-yapısı)
- [9. Önerilen Pipeline State Yapısı](#9-önerilen-pipeline-state-yapısı)
- [10. Scene / Segment Veri Modeli](#10-scene--segment-veri-modeli)
- [11. Progressive Streaming Stratejisi](#11-progressive-streaming-stratejisi)
- [12. Render Hata Düzeltme Stratejisi](#12-render-hata-düzeltme-stratejisi)
- [13. TTS ve Video Senkronizasyonu](#13-tts-ve-video-senkronizasyonu)
- [14. Model Routing Stratejisi](#14-model-routing-stratejisi)
- [15. Visual QA Sistemi](#15-visual-qa-sistemi)
- [16. Manim Component Library](#16-manim-component-library)
- [17. Job Queue ve Ölçeklenme](#17-job-queue-ve-ölçeklenme)
- [18. Önerilen Sprint Planı](#18-önerilen-sprint-planı)
- [19. Başarı Metrikleri](#19-başarı-metrikleri)
- [20. Lisans Notları](#20-lisans-notları)

---

# 1. Kara Tahta'nın Mevcut En Büyük Avantajı

Kara Tahta'nın korunması gereken en önemli özelliği:

## Progressive Manim Streaming

Klasik yaklaşım:

```text
Prompt
  ↓
Video üret
  ↓
Tüm render bitsin
  ↓
MP4 hazır olsun
  ↓
Kullanıcı videoyu izlemeye başlasın
```

Kara Tahta yaklaşımı:

```text
Prompt
  ↓
Lesson plan
  ↓
Segment 0 render
  ↓
fMP4 fragment
  ↓
Browser'a gönder
  ↓
KULLANICI İZLEMEYE BAŞLAR
  ↓
Segment 1 render edilir
  ↓
Segment 2 render edilir
  ↓
...
  ↓
Final MP4 oluşturulur
```

Kara Tahta içindeki `progressiveManimPlayer` yapısı:

- fragmented MP4 parçalarını ayrıştırıyor,
- `MediaSource` API kullanıyor,
- parçaları sequence sırasına göre buffer'a ekliyor,
- timestamp offsetlerini yönetiyor,
- yeterli buffer oluşunca oynatmayı otomatik başlatıyor,
- eski buffer'ı gerektiğinde temizleyebiliyor,
- tamamlanmamış bir ders videosunu üretim devam ederken oynatabiliyor.

## Karar

**Bu sistem kaldırılmamalı.**

Aksine yeni backend mimarisi tamamen progressive streaming etrafında tasarlanmalıdır.

---

# 2. Referans Alınan Projeler

## AetherLearn.ai

Repo:

https://github.com/Joshua-Ranish-T/AetherLearn.ai

Öne çıkan fikirler:

- LangGraph workflow
- supervisor agent
- OCR agent
- content generation agent
- narration agent
- Manim generation agent
- render execution service
- repair agent
- duration correction
- synchronization service
- Firebase checkpoint sistemi
- SSE progress events
- background worker desteği

---

## Leap

Repo:

https://github.com/sid-thephysicskid/leap

Öne çıkan fikirler:

- input validation
- scene planning
- code generation
- code validation
- execution
- error correction
- LangGraph
- maksimum retry döngüsü
- workflow tracing

---

## Topic2Manim

Repo:

https://github.com/mateolafalce/topic2manim

Öne çıkan fikirler:

- scene bazlı video üretimi
- TTS önce üretme
- gerçek ses süresini `ffprobe` ile ölçme
- ses süresini Manim prompt'una verme
- scene-level REPL / fix loop
- OpenAI / Claude fallback
- video concatenation

---

## Learnable

Repo:

https://github.com/Jsze30/Learnable

Öne çıkan fikirler:

- PDF / course material input
- lesson planning
- narration
- ManimGL
- voice tutor
- LiveKit tabanlı gerçek zamanlı sesli öğretmen
- subject / course context

---

## makefinks/manim-generator

Repo:

https://github.com/makefinks/manim-generator

Öne çıkan fikirler:

- code writer
- code reviewer
- execution feedback loop
- frame extraction
- vision review
- farklı modelleri benchmark etme

---

# 3. Hedef Mimari

Kara Tahta için önerilen uzun vadeli pipeline:

```text
                         USER
                           │
                           ▼
                  Input Normalizer
                           │
                           ▼
                    Lesson Planner
                           │
                ┌──────────┴──────────┐
                │                     │
                ▼                     ▼
            Narration             Scene Plan
                │                     │
                ▼                     │
               TTS                    │
                │                     │
                ▼                     │
        Exact Audio Durations         │
                └──────────┬──────────┘
                           ▼
                    Manim Generator
                           │
                           ▼
                  Static Validator
                           │
                           ▼
                   Segment Renderer
                           │
                 ┌─────────┴─────────┐
                 │                   │
              ERROR                SUCCESS
                 │                   │
                 ▼                   ▼
             Repair Agent         Frame QA
                 │                   │
                 └───────┐      BAD  │
                         └────────────┘
                               │
                               ▼
                      Duration Correct
                               │
                               ▼
                        fMP4 Fragment
                               │
                               ▼
                    STREAM TO BROWSER
                               │
                     while next segment
                       is rendering...
                               │
                               ▼
                         Finalize MP4
                               │
                               ▼
                           Storage
```

---

# 4. P0 — İlk Önce Yapılması Gerekenler

Bunlar doğrudan **güvenilirlik, hız ve maliyet** problemlerini çözer.

---

## 4.1 State Machine Pipeline

Backend'deki üretim süreci açık state'lere ayrılmalı.

Örnek:

```text
INPUT_VALIDATION
↓
PLANNING
↓
NARRATION
↓
TTS
↓
MANIM_GENERATION
↓
CODE_VALIDATION
↓
RENDERING
↓
VISUAL_QA
↓
SYNC
↓
STREAMING
↓
FINALIZING
↓
COMPLETED
```

Her state:

- input almalı,
- output üretmeli,
- hata döndürebilmeli,
- tekrar çalıştırılabilmeli,
- checkpoint edilebilmeli.

### Neden?

Şu problemlerin önüne geçer:

- devasa tek fonksiyonlar,
- hangi aşamanın hata verdiğinin bilinmemesi,
- server restart sonrası her şeyi yeniden üretme,
- belirli scene'i tekrar üretmenin zor olması.

---

## 4.2 Surgical Manim Repair Agent

Render hata verdiğinde tüm script yeniden üretilmemeli.

Repair agent şu bilgileri almalı:

```text
broken_code
error_message
traceback
scene_id
previous_errors
repair_attempt
```

Kurallar:

1. Scripti komple yeniden yazma.
2. Sadece gereken satırları değiştir.
3. Önceki hataları dikkate al.
4. Maksimum 3 retry.
5. Aynı hatayı tekrar üretme.
6. Temperature düşük tutulmalı.

Önerilen:

```text
MAX_REPAIR_ATTEMPTS = 3
temperature ≈ 0.1
```

---

## 4.3 Pre-render Static Validation

LLM kod ürettikten sonra direkt Manim render başlatılmamalı.

Önce validator çalışmalı:

```text
Python AST parse
↓
Import kontrolü
↓
Forbidden code kontrolü
↓
Scene class var mı?
↓
construct() var mı?
↓
Basic LaTeX kontrolü
↓
Dosya/path doğrulama
↓
Render
```

Bu sayede basit hatalarda gereksiz CPU/GPU render süresi harcanmaz.

---

## 4.4 Audio-first Generation

Önerilen akış:

```text
Lesson Plan
↓
Narration
↓
TTS
↓
Audio Duration
↓
Manim Generation
```

Örnek:

```text
Narration: 8.37 saniye
↓
Manim prompt:
"Bu sahnenin toplam animasyon süresi yaklaşık 8.37 saniye olmalıdır."
```

Bu yaklaşım video ve ses uyumunu çok artırır.

---

## 4.5 FFmpeg Duration Correction

LLM tam süreli animasyon üretmeyebilir.

Örnek:

```text
Audio: 8.37s
Video: 7.90s
```

Çözüm:

```text
Son frame 0.47s freeze
```

Tersi:

```text
Audio: 8.37s
Video: 9.10s
```

Çözüm:

```text
Video trim → 8.37s
```

Araçlar:

- `ffprobe`
- `ffmpeg`
- `tpad`
- trim

Önerilen tolerans:

```text
±0.10 saniye
```

---

## 4.6 Persistent Checkpoints

Her scene / aşama tamamlandığında state kaydedilmeli.

Örnek:

```json
{
  "lesson_id": "lesson_123",
  "current_stage": "rendering",
  "completed_scenes": [0, 1, 2],
  "current_scene": 3,
  "repair_attempts": {
    "3": 1
  }
}
```

Server kapanırsa:

```text
Scene 0 ✅
Scene 1 ✅
Scene 2 ✅
Scene 3 ❌
```

yeniden 0'dan başlamamalı.

Scene 3'ten devam etmeli.

---

## 4.7 Scene-level Isolated Rendering

Her scene ayrı çalışma klasöründe tutulmalı.

Örnek:

```text
lessons/
└── lesson_123/
    ├── scene_000/
    │   ├── plan.json
    │   ├── narration.txt
    │   ├── audio.mp3
    │   ├── code.py
    │   ├── raw.mp4
    │   ├── synced.mp4
    │   └── metadata.json
    │
    ├── scene_001/
    │   └── ...
    │
    └── final/
        └── lesson.mp4
```

Bir scene hata verirse diğerleri etkilenmemeli.

---

## 4.8 Input Normalization Agent

Kullanıcı girdisi direkt lesson planner'a verilmemeli.

Örnek kullanıcı prompt'u:

```text
türev
```

Normalizer bunu şuna çevirebilir:

```text
"Lise seviyesinde türevin geometrik anlamını,
teğet eğimi ve değişim oranı üzerinden,
görsel örneklerle açıkla."
```

Normalize edilen prompt:

- konu,
- öğrenci seviyesi,
- hedef,
- anlatım tarzı,
- gerekli görseller,
- tahmini video uzunluğu

gibi alanlara ayrılabilir.

---

## 4.9 Structured Job Events

Frontend'e sadece yüzde progress göndermek yerine semantic event gönderilmeli.

Örnek:

```json
{
  "type": "stage_started",
  "stage": "tts",
  "message": "Seslendirme hazırlanıyor",
  "progress": 30
}
```

Event tipleri:

```text
job_created
stage_started
stage_completed
scene_started
scene_rendered
scene_repairing
scene_ready
fragment_ready
playback_ready
finalizing
completed
failed
```

Frontend:

```text
✓ Soruyu analiz ettim
✓ Ders planını oluşturdum
✓ Seslendirme hazır
◉ 3. animasyonu çiziyorum
○ Son videoyu hazırlayacağım
```

şeklinde gösterebilir.

---

## 4.10 Duplicate Job Protection

Aynı lesson için aynı anda iki üretim başlamamalı.

Örnek:

```http
409 Conflict
```

Ancak kullanıcı açıkça:

```text
force_regenerate=true
```

verirse yeni job başlatılabilir.

---

# 5. P1 — İkinci Aşama Geliştirmeler

---

## 5.1 Worker Queue

Render işleri API process'inde çalışmamalı.

Önerilen:

```text
Frontend
   ↓
API
   ↓
Job Queue
   ↓
┌───────────────┐
│ Render Worker │
│ Render Worker │
│ Render Worker │
└───────────────┘
```

Teknoloji seçenekleri:

- Redis + RQ
- Redis + Celery
- Dramatiq
- arq
- custom PostgreSQL queue

---

## 5.2 Regenerate From Stage

Kullanıcı tüm dersi baştan üretmek zorunda olmamalı.

UI seçenekleri:

```text
Regenerate explanation
Regenerate narration
Regenerate animation
Regenerate this scene
Regenerate voice
```

Örnek:

```text
Scene 4 kötü
↓
Sadece Scene 4 yeniden üret
↓
Fragment 4 değiştir
↓
Final video tekrar assemble
```

---

## 5.3 Model Routing

Tüm pipeline için tek pahalı model kullanılmamalı.

Örnek:

```text
Input normalization
→ hızlı/ucuz model

Lesson planning
→ orta seviye reasoning model

Manim generation
→ güçlü coding model

Repair
→ hızlı ve düşük temperature model

Visual QA
→ multimodal model

OCR
→ vision model
```

Bu hem maliyeti hem latency'yi azaltır.

---

## 5.4 Provider Fallback

Bir provider bozulursa pipeline tamamen çökmemeli.

Örnek:

```text
Primary:
Model A

↓ API failure

Fallback:
Model B
```

Provider abstraction:

```python
generate_text(task, provider=None)
generate_vision(task, provider=None)
generate_tts(text, provider=None)
```

şeklinde tasarlanabilir.

---

## 5.5 Frame-based Visual QA

Render başarılı olması animasyonun iyi olduğu anlamına gelmez.

Kontrol edilmesi gerekenler:

- text ekran dışında mı?
- objeler çakışıyor mu?
- font çok küçük mü?
- denklem okunuyor mu?
- grafik merkezde mi?
- boş ekran var mı?
- animasyon beklenmedik şekilde bitmiş mi?

Pipeline:

```text
Render
↓
Frame extraction
↓
Vision model
↓
Visual score
↓
Score düşük?
  ├─ Evet → repair
  └─ Hayır → publish
```

---

## 5.6 Manim Component Library

LLM'in tamamen özgür Manim kodu yazması yerine reusable component sistemi oluşturulmalı.

Örnek:

```text
components/
├── EquationReveal
├── EquationTransform
├── NumberLine
├── NumberLineHop
├── FunctionGraph
├── CoordinatePlane
├── Triangle
├── GeometryProof
├── FractionVisualizer
├── ProbabilityTree
├── MatrixTransform
├── VectorDiagram
├── BarChart
└── Timeline
```

LLM:

```python
show_equation(...)
plot_function(...)
show_number_line(...)
```

gibi güvenli helper'lar çağırmalı.

Avantajlar:

- daha az token,
- daha az hallucination,
- daha az Manim hatası,
- daha tutarlı tasarım,
- daha kolay theme değişimi,
- daha hızlı video üretimi.

---

## 5.7 PDF Input

Kullanıcı:

- ders notu,
- textbook,
- worksheet,
- PDF soru bankası

yükleyebilmeli.

Pipeline:

```text
PDF
↓
Text extraction / OCR
↓
Chunking
↓
Relevant context
↓
Lesson planner
```

---

## 5.8 Image / Question Upload

Özellikle Türkiye için güçlü kullanım:

```text
TYT / AYT soru fotoğrafı
↓
Vision / OCR
↓
Question understanding
↓
Solution
↓
Animated explanation
```

---

## 5.9 Course / Subject Context

Kara Tahta tek prompt uygulaması olmaktan çıkarılıp eğitim workspace'ine dönüşebilir.

Örnek:

```text
11. Sınıf Matematik
├── Trigonometri
├── Analitik Geometri
├── Fonksiyonlar
├── Limit
└── Türev
```

Her subject:

- PDF,
- not,
- lesson,
- generated videos,
- chat geçmişi,
- quiz

saklayabilir.

---

## 5.10 Pipeline Tracing / Analytics

Her generation için:

```text
LLM latency
TTS latency
Render latency
Repair count
Token usage
Cost
Scene success rate
First-frame time
Total generation time
```

tutulmalı.

Örnek:

```json
{
  "lesson_id": "123",
  "planning_ms": 1200,
  "tts_ms": 3100,
  "render_ms": 22200,
  "first_playback_ms": 6800,
  "repair_count": 1,
  "token_cost_usd": 0.08
}
```

---

# 6. P2 — Ürün Genişletme Özellikleri

---

## 6.1 Real-time Voice Tutor

Video izlerken kullanıcı:

> Burayı anlamadım.

diyebilmeli.

Voice tutor:

```text
Microphone
↓
STT
↓
Current lesson context
↓
LLM
↓
TTS
↓
Realtime response
```

Renderer process'inden ayrı servis olması önerilir.

---

## 6.2 Context-aware Tutor

Tutor şunları bilmeli:

- mevcut lesson,
- mevcut scene,
- videoda kaçıncı saniye,
- lesson plan,
- öğrencinin önceki soruları.

Örnek:

> 02:14'te söylediğin adımı tekrar açıkla.

---

## 6.3 Quiz Generation

Lesson tamamlandıktan sonra:

```text
Video
↓
Lesson summary
↓
3–5 soru
↓
Quiz
```

Ek olarak yanlış cevaba özel animasyon üretilebilir.

---

## 6.4 Learning History

Kullanıcının:

- izlediği dersler,
- tamamladığı konular,
- zorlandığı alanlar,
- quiz performansı

saklanabilir.

---

# 7. Tüm 20 Önerinin Kısa Listesi

## P0

- [ ] 1. State machine pipeline
- [ ] 2. Scene-level surgical repair
- [ ] 3. Pre-render static validation
- [ ] 4. Audio-first TTS timing
- [ ] 5. FFmpeg duration correction
- [ ] 6. Persistent checkpoints
- [ ] 7. Scene-level isolated renders
- [ ] 8. Input normalization agent
- [ ] 9. Structured job events
- [ ] 10. Duplicate-job protection

## P1

- [ ] 11. Worker queue
- [ ] 12. Regenerate single scene / stage
- [ ] 13. Model routing + fallback
- [ ] 14. Vision / frame QA
- [ ] 15. Reusable Manim component library
- [ ] 16. PDF upload
- [ ] 17. Image / question upload
- [ ] 18. Course / subject context
- [ ] 19. Pipeline tracing / analytics

## P2

- [ ] 20. Real-time voice tutor

---

# 8. Önerilen Backend Klasör Yapısı

```text
backend/
├── app/
│   ├── main.py
│   │
│   ├── api/
│   │   ├── lessons.py
│   │   ├── jobs.py
│   │   ├── scenes.py
│   │   ├── streaming.py
│   │   └── files.py
│   │
│   ├── pipeline/
│   │   ├── graph.py
│   │   ├── state.py
│   │   ├── edges.py
│   │   └── checkpoints.py
│   │
│   ├── agents/
│   │   ├── input_normalizer.py
│   │   ├── lesson_planner.py
│   │   ├── narration_agent.py
│   │   ├── manim_generator.py
│   │   ├── repair_agent.py
│   │   └── visual_qa_agent.py
│   │
│   ├── validators/
│   │   ├── python_validator.py
│   │   ├── manim_validator.py
│   │   ├── latex_validator.py
│   │   └── security_validator.py
│   │
│   ├── renderers/
│   │   ├── manim_renderer.py
│   │   ├── duration_corrector.py
│   │   ├── fragmenter.py
│   │   └── video_assembler.py
│   │
│   ├── audio/
│   │   ├── tts.py
│   │   ├── duration.py
│   │   └── normalize.py
│   │
│   ├── streaming/
│   │   ├── manifest.py
│   │   ├── fragment_store.py
│   │   └── events.py
│   │
│   ├── components/
│   │   ├── equations.py
│   │   ├── graphs.py
│   │   ├── geometry.py
│   │   ├── number_line.py
│   │   └── probability.py
│   │
│   ├── jobs/
│   │   ├── queue.py
│   │   ├── worker.py
│   │   └── repository.py
│   │
│   ├── storage/
│   │   ├── object_storage.py
│   │   └── local_storage.py
│   │
│   ├── models/
│   │   ├── router.py
│   │   ├── llm.py
│   │   ├── vision.py
│   │   └── providers/
│   │
│   └── observability/
│       ├── logging.py
│       ├── metrics.py
│       └── tracing.py
│
├── tests/
│   ├── pipeline/
│   ├── validators/
│   ├── renderers/
│   └── streaming/
│
└── Dockerfile
```

---

# 9. Önerilen Pipeline State Yapısı

Örnek:

```python
class LessonGenerationState:
    job_id: str
    lesson_id: str

    user_input: str
    normalized_input: str

    lesson_plan: dict | None

    current_scene: int
    scenes: list

    narration: list
    audio_files: list
    audio_durations: list

    manim_scripts: list
    render_results: list

    repair_attempts: dict
    previous_errors: dict

    fragments: list

    current_stage: str
    progress: float

    error: str | None
```

---

# 10. Scene / Segment Veri Modeli

Her scene bağımsız bir entity olmalı.

```json
{
  "scene_id": "scene_003",
  "index": 3,

  "title": "Türevin Geometrik Anlamı",

  "narration": "...",

  "audio": {
    "path": "...",
    "duration": 8.37
  },

  "manim": {
    "script_path": "...",
    "version": 2
  },

  "render": {
    "status": "completed",
    "raw_path": "...",
    "synced_path": "...",
    "duration": 8.37
  },

  "quality": {
    "visual_score": 0.91
  },

  "repair": {
    "attempts": 1
  },

  "stream": {
    "sequence": 3,
    "fragment_url": "...",
    "start_seconds": 22.41
  }
}
```

---

# 11. Progressive Streaming Stratejisi

Streaming pipeline korunmalı ve güçlendirilmeli.

Önerilen manifest:

```json
{
  "jobId": "job_123",
  "lessonId": "lesson_123",

  "complete": false,

  "partials": [
    {
      "sequence": 0,
      "url": "/stream/lesson_123/0.mp4",
      "mimeType": "video/mp4; codecs=\"avc1.64001f, mp4a.40.2\"",
      "startSeconds": 0,
      "durationSeconds": 8.2
    }
  ]
}
```

Backend her scene hazır olduğunda manifest'e yeni partial eklemeli.

Frontend:

```text
manifest update
↓
new partial
↓
fetch fragment
↓
MediaSource
↓
SourceBuffer
↓
playback continues
```

---

# 12. Render Hata Düzeltme Stratejisi

Hatalar sınıflandırılmalı.

```text
Render Error
│
├── Python syntax
│    └── deterministic / LLM repair
│
├── Manim API
│    └── LLM repair
│
├── LaTeX
│    └── sanitize / fallback
│
├── Missing asset
│    └── asset resolver
│
├── Timeout
│    └── simplify scene
│
└── Unknown
     └── general repair agent
```

Repair geçmişi tutulmalı.

```json
{
  "scene": 2,
  "attempts": [
    {
      "error": "TexError...",
      "fix": "..."
    },
    {
      "error": "...",
      "fix": "..."
    }
  ]
}
```

---

# 13. TTS ve Video Senkronizasyonu

Önerilen yöntem:

```text
Narration
↓
TTS
↓
ffprobe
↓
8.37 sec
↓
Manim generation target = 8.37 sec
↓
Render
↓
Measure video
↓
Duration correction
↓
Mux audio + video
```

Bu iki katmanlı kontrol sağlar:

### Katman 1

LLM animasyonu hedef süreye göre üretir.

### Katman 2

FFmpeg kesin süre eşlemesi yapar.

---

# 14. Model Routing Stratejisi

Örnek görev → model matrisi:

| Görev | Model Tipi |
|---|---|
| Input normalization | hızlı / ucuz |
| Lesson planning | reasoning |
| Narration | hızlı kaliteli text |
| Manim coding | güçlü coding |
| Repair | düşük temperature coding |
| Visual QA | vision |
| OCR | vision/OCR |
| Tutor | düşük latency conversational |

Model router:

```python
model = router.get_model(task="manim_generation")
```

şeklinde kullanılmalı.

---

# 15. Visual QA Sistemi

Scene render edildikten sonra birkaç frame alınmalı.

Örnek:

```text
0%
25%
50%
75%
100%
```

Vision model'e:

```text
Bu educational animation frame'lerinde:

1. Text okunuyor mu?
2. Objeler çakışıyor mu?
3. Denklem ekran dışında mı?
4. Ana içerik merkezde mi?
5. Görsel anlatım lesson plan ile uyumlu mu?

0–1 arasında score üret.
```

Öneri:

```text
visual_score >= 0.80 → PASS
visual_score < 0.80 → REPAIR
```

---

# 16. Manim Component Library

İlk component seti:

```text
Math
├ EquationReveal
├ EquationTransform
├ Fraction
├ NumberLine
├ CoordinatePlane
├ FunctionPlot
└ AreaUnderCurve

Geometry
├ Triangle
├ Circle
├ Angle
├ Vector
├ Polygon
└ ProofStep

Statistics
├ BarChart
├ PieChart
├ Histogram
└ ProbabilityTree

Education
├ TitleCard
├ StepLabel
├ HighlightBox
├ DefinitionCard
└ SummaryCard
```

Component API'leri mümkün olduğunca basit tutulmalı.

Örnek:

```python
show_equation(
    scene,
    r"x^2 - 5x + 6 = 0",
    position="center"
)
```

---

# 17. Job Queue ve Ölçeklenme

Uzun vadede:

```text
API Servers
    │
    ▼
 PostgreSQL
    │
    ▼
 Redis Queue
    │
    ├── Render Worker 1
    ├── Render Worker 2
    ├── Render Worker 3
    └── Render Worker N
```

Worker özellikleri:

- scene lock,
- heartbeat,
- retry,
- timeout,
- max concurrency,
- graceful shutdown.

Render job'ları idempotent olmalı.

---

# 18. Önerilen Sprint Planı

## Sprint 1 — Pipeline Reliability

- [ ] State model
- [ ] Scene entity
- [ ] Static code validator
- [ ] Scene renderer isolation
- [ ] Repair loop
- [ ] Structured logs

Hedef:

```text
Bir Manim hatasının tüm lesson'ı öldürmemesi.
```

---

## Sprint 2 — Audio Sync

- [ ] Narration ayrı stage
- [ ] TTS scene bazlı
- [ ] ffprobe duration
- [ ] audio duration → Manim prompt
- [ ] FFmpeg pad / trim
- [ ] scene audio/video mux

Hedef:

```text
Ses-video senkron problemlerini minimuma indirmek.
```

---

## Sprint 3 — Resume + Jobs

- [ ] checkpoint
- [ ] scene status
- [ ] duplicate job protection
- [ ] retry from scene
- [ ] regenerate scene
- [ ] queue abstraction

Hedef:

```text
Crash sonrası kaldığı yerden devam.
```

---

## Sprint 4 — Quality

- [ ] frame extractor
- [ ] visual QA
- [ ] automatic visual repair
- [ ] component library v1
- [ ] Manim style guide

Hedef:

```text
Sadece render olan değil, iyi görünen video.
```

---

## Sprint 5 — Product Expansion

- [ ] PDF
- [ ] image question
- [ ] subject workspace
- [ ] lesson history
- [ ] context-aware tutor

---

## Sprint 6 — Realtime Tutor

- [ ] microphone
- [ ] STT
- [ ] lesson context
- [ ] streaming LLM
- [ ] TTS
- [ ] realtime transport

---

# 19. Başarı Metrikleri

Sistemde özellikle aşağıdaki metrikler takip edilmeli.

## Reliability

```text
scene_render_success_rate
lesson_success_rate
repair_success_rate
average_repair_attempts
```

## Speed

```text
time_to_first_fragment
time_to_first_playback
total_generation_time
average_scene_render_time
```

En önemli UX metriği:

## Time To First Playback

Kullanıcı prompt verdikten sonra kaç saniyede ilk animasyonu izlemeye başlayabiliyor?

Kara Tahta'nın rakiplere göre ana avantajı bu olabilir.

---

## Quality

```text
visual_qa_score
audio_video_sync_error
scene_regeneration_rate
user_replay_rate
```

---

## Cost

```text
tokens_per_lesson
tts_cost_per_lesson
render_compute_seconds
total_cost_per_lesson
```

---

# 20. Lisans Notları

Referans repoların kodlarını kullanırken lisans kontrolü yapılmalıdır.

## Leap

Apache License 2.0

Repo:

https://github.com/sid-thephysicskid/leap

Apache-2.0 şartlarına uyularak kod reuse yapılabilir.

---

## Topic2Manim

MIT License

Repo:

https://github.com/mateolafalce/topic2manim

MIT şartlarına uyularak kod reuse yapılabilir.

---

## makefinks/manim-generator

MIT License

Repo:

https://github.com/makefinks/manim-generator

---

## AetherLearn.ai

İnceleme sırasında açık bir repository lisansı görünmüyordu.

Bu nedenle:

**Kod kopyalamak yerine mimari yaklaşımı yeniden implement etmek daha güvenlidir.**

Repo:

https://github.com/Joshua-Ranish-T/AetherLearn.ai

---

## Learnable

İnceleme sırasında açık bir repository lisansı görünmüyordu.

Bu nedenle doğrudan kod reuse yerine fikir / mimari referans olarak kullanılmalıdır.

Repo:

https://github.com/Jsze30/Learnable

---

# Sonuç

Kara Tahta'nın hedefi sadece:

```text
Prompt → Manim → MP4
```

olmamalı.

Hedef:

```text
Prompt
↓
Anlama
↓
Ders planlama
↓
Seslendirme
↓
Görsel plan
↓
Manim
↓
Otomatik validation
↓
Otomatik repair
↓
Visual QA
↓
Progressive streaming
↓
Kullanıcı video bitmeden öğrenmeye başlar
```

olmalıdır.

Rakip açık kaynak projelerden alınabilecek en değerli parçalar:

```text
AetherLearn
→ state machine + repair + checkpoint

Leap
→ validation + correction workflow

Topic2Manim
→ audio-first + scene-level REPL

makefinks/manim-generator
→ visual reviewer

Learnable
→ PDF/course/voice tutor
```

Kara Tahta'nın kendi güçlü tarafı:

```text
Progressive fMP4 + MediaSource Streaming
```

Bu avantaj korunup yukarıdaki sistemlerle birleştirilirse Kara Tahta, sıradan bir "AI Manim generator" yerine gerçek zamanlı çalışan bir **AI visual tutor / AI education engine** haline gelebilir.

---

## Önerilen İlk 10 Uygulama Sırası

```text
1. State machine
2. Scene isolation
3. Static validation
4. Surgical repair
5. Audio-first TTS
6. FFmpeg duration correction
7. Persistent checkpoints
8. Structured SSE events
9. Duplicate job protection
10. Regenerate scene
```

Bunlardan sonra:

```text
11. Worker queue
12. Model routing
13. Visual QA
14. Component library
15. PDF
16. Image question
17. Course workspace
18. Analytics
19. Tutor context
20. Voice tutor
```

---

---

# 21. Mevcut Kod Taban ile Karşılaştırma Sonrası Güncel Durum ve Öncelikler

_Bu bölüm, yukarıdaki önerilerin mevcut Node.js/Express kod tabanı (`server.js`, `services/`, `workers/`) ile karşılaştırılması sonucu eklenmiştir (17 Ağustos 2026)._

## 21.1 Zaten Tamamlanmış Sayılan Maddeler (roadmap'ten çıkarılmalı / "Done" olarak işaretlenmeli)

Aşağıdaki maddeler dokümanın üst kısmında "yapılacak" gibi listelenmiş ama kod tabanında zaten mevcut:

- **Madde 4 — Audio-first generation**: Pipeline zaten TTS'i önce üretip gerçek süreyi Manim'e prompt olarak veriyor (`server.js` segment akışı, `fitManimTimingToDuration`).
- **Madde 5 — FFmpeg duration correction**: `fitManimTimingToDuration` (services/manimProgressiveCode.js) + ffmpeg `atrim`/`afade` zaten var.
- **Madde 7 (P0.7) — Scene-level isolated rendering**: Her render kendi `renderId`/`workDir`'ında izole çalışıyor.
- **Madde 9 (P0.9) — Structured job events / SSE**: `/api/jobs/:id/events` zaten olgun (Last-Event-ID reconnect, heartbeat, event history).
- **Madde 11 (P1.11) — Worker queue**: BullMQ + Redis altyapısı (`services/renderQueue.js`, `workers/renderWorker.js`) zaten kurulmuş, sadece **shadow mode**'da.

## 21.2 Gerçek Boşluklar — Güncellenmiş Öncelik Sırası

Kod taramasıyla doğrulanmış, gerçekten eksik olan maddeler, önerilen uygulama sırasıyla:

### 1. Pre-render static validation'ı ana pipeline'a bağlamak
`services/karaManimSafety.js:assertSafeKaraManimCode` zaten yazılmış ve çalışıyor ama sadece canlı "Kara" chat aracında çağrılıyor. Ana ders üretim akışındaki `renderManimVideo` (server.js) bu kontrolü hiç çağırmıyor, sadece syntaktik `sanitizeManimForLocalRender` kullanıyor.
**Yapılacak**: `renderManimVideo` render öncesi `assertSafeKaraManimCode`'u (veya eşdeğerini) çağırsın; böylece basit/tehlikeli hatalarda gereksiz render süresi harcanmaz.

### 2. Checkpoint / Resume-on-restart
Şu an `GET /api/jobs/:id` restart sonrası planı **sıfırdan yeniden kuyruğa alıyor** (log: "baştan güvenli biçimde yeniden kuyruklandı"). Tamamlanmış segmentler bile tekrar üretiliyor.
**Yapılacak**: Mevcut `generation_events`/segment `status` alanları üzerine kurulu bir resume mantığı — `completed` segmentleri atla, `failed`/`pending` olandan devam et. Büyük mimari değişiklik gerekmiyor, var olan veri modeli yeterli.

### 3. Render worker'ı shadow mode'dan çıkarmak
Altyapı (BullMQ+Redis, `workers/renderWorker.js`) hazır; `RENDER_WORKER_SHADOW_MODE=true` olduğu için worker gerçek render yapmıyor. Bu "yeni özellik" değil, "bitirilmesi gereken iş" olarak ele alınmalı — risk azaltıcı en yüksek öncelikli adım.

### 4. Visual QA (otomatik kalite kontrolü)
Şu an üretilen videonun otomatik görsel/kalite denetimi yok — sadece kullanıcı sohbetinde frame çıkarma var. Özellikle content-pool tabanlı **gözetimsiz otomatik yayın** (scheduler) aktifleştikçe, kötü render'ın kimse fark etmeden Instagram/YouTube'a gitme riski artıyor.
**Yapılacak**: Madde 15'teki (Frame-based Visual QA) pipeline'ı en azından scheduler tetiklemeli işler için zorunlu hale getirmek — `visual_score < 0.80` ise otomatik yayını durdurup insan onayına düşürmek.

### 5. Manim Component Library
En yüksek efor/en yüksek uzun vadeli getiri maddesi. LLM her seferinde sıfırdan Python/Manim kodu yazıyor, sadece metinsel kural dosyası (`skill/`) var, reusable helper/component modülü yok. Token tasarrufu, hata oranı düşüşü ve tutarlı görsel tasarım için değerli ama diğer 4 madde tamamlandıktan sonra ele alınmalı.

## 21.3 Bilinçli Olarak Eklenmeyen Madde

**Duplicate job protection** (aynı lessonId için eşzamanlı iki job'u engelleme) tespit edilen gerçek bir boşluk olmasına rağmen, ekip kararıyla bu roadmap'e dahil edilmemiştir.

## 21.4 Video İçerik Kalitesi Düşüşü — Kök Neden ve Kalıcı Çözüm

**Semptom**: Content-pool/scheduler ile otomatik üretilen videolar 2026-08-17 tarihli commit `e21a4e4` ile 10 dk/8 segment yerine 3.5 dk/3 segment üretilmeye başlandı (`services/scheduler.js:90-107`). Bu, otomatik yayınlanan içeriklerin gözle görülür şekilde sığlaşmasına yol açtı.

**Yüzeysel neden**: Commit mesajına göre, tek render-worker replikası 8 segment/10 dk yükünde final ffmpeg concat adımında OOM (bellek yetersizliği) ile sessizce çöküyordu. Video süresi kısaltılarak bu geçici olarak susturuldu.

**Gerçek kök neden (kod incelemesiyle doğrulandı)**: Final video birleştirme (`concatVideos()`, server.js:1691) `buildFilterConcatArgs` kullanıyor ([services/videoPostprocess.js:137-168](services/videoPostprocess.js#L137-L168)) — bu fonksiyon **tüm segment videolarını tek ffmpeg çağrısında eşzamanlı girdi olarak açıp**, her biri için ayrı `scale/pad/fps` filtre zinciri (`filter_complex`) kuruyor. Eşzamanlı açık decoder+filtre sayısı segment sayısıyla doğru orantılı büyüyor; bu yüzden 8 segmentte OOM, 3 segmentte OOM yok.

Oysa segmentler render aşamasında zaten `assertStandardVideoProbe` ile 1280x720@30fps olacak şekilde doğrulanıyor (`services/renderQuality.js:26-32`) — yani final concat'taki scale/pad/fps normalizasyonu **gereksiz tekrar**. Kod tabanında zaten bellek-dostu bir alternatif mevcut ve başka yerlerde kullanılıyor: `buildConcatArgs` (concat demuxer, `-f concat -safe 0`), server.js:2303 ve server.js:2523'te partial gruplama / ses mux için kullanılıyor.

**Kalıcı çözüm**: `concatVideos()`'u `buildFilterConcatArgs` yerine `buildConcatArgs` (concat demuxer) kullanacak şekilde değiştirmek. Bu, bellek kullanımını segment sayısından bağımsız hale getirir ve OOM'u kökten çözer — video süresini/segment sayısını kısaltmaya gerek kalmaz. Bu düzeltme yapıldıktan sonra `services/scheduler.js:90-107`'deki 3.5dk/3-segment kısıtlaması geri alınıp normal 10dk/8-segment hedefine dönülmelidir.

**Uygulama durumu (17 Ağustos 2026 itibarıyla)**:
1. ✅ `concatVideos()` concat demuxer'a geçirildi (server.js:1691, `buildConcatArgs` kullanıyor artık — `buildFilterConcatArgs` importu kaldırıldı, fonksiyon kendisi `services/videoPostprocess.js`'de test kapsamı için hâlâ duruyor ama server.js'de kullanılmıyor).
2. ✅ `services/scheduler.js:90-97`'deki kısaltılmış hedefler (3.5dk/3 segment) geri alındı, varsayılan 10dk/8 segment'e dönüldü.
3. ⚠️ **Doğrulanmadı**: Bu ortamda gerçek bir 8 segmentlik Manim render + final concat üretim yükü altında test edilmedi (Manim/render-worker altyapısı bu geliştirme ortamında koşmuyor). `npm test` (`test/videoPostprocess.test.js`) geçti ve `server.js` importu/sözdizimi sorunsuz, ama bu sadece birim/statik doğrulama. **Production'a almadan önce en az bir gerçek 8-segmentlik lesson video üretimi ile bellek kullanımının artık segment sayısıyla patlamadığını canlıda veya staging'de doğrulamak gerekiyor.**

---

**Kara Tahta Development Roadmap**

_Last updated: 17 August 2026_
