import { ProgressiveManimPlayer } from './progressiveManimPlayer.js';
import { BackendRouter } from './backendRouter.js';
import { KaraLiveClient } from './karaLiveClient.js';

// Existing production workflow, loaded after the React shell mounts.
const backendTargets = window.KARA_BACKEND_URLS || {
  railway: String(window.KARA_API_BASE_URL || '').replace(/\/$/, ''),
  vps: String(window.KARA_API_BASE_URL || '').replace(/\/$/, '')
};
let handleBackendRouterChange = () => {};
const backendRouter = new BackendRouter({
  targets: backendTargets,
  storage: window.localStorage,
  onChange: (snapshot, reason) => handleBackendRouterChange(snapshot, reason)
});

function apiUrl(path) {
  return backendRouter.resolve(path);
}

// Backend-mode selector / health checks / log console are internal
// debugging tools, not something a normal student needs to see. Gated by
// email allowlist rather than removed outright so the team can still reach
// them on their own accounts in production. UI-only: the underlying health
// endpoints aren't access-controlled, so this hides clutter, it isn't a
// security boundary.
const ADMIN_EMAILS = String(import.meta.env.VITE_ADMIN_EMAILS || '')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

function isAdminEmail(email) {
  return ADMIN_EMAILS.includes(String(email || '').trim().toLowerCase());
}

function cacheBustUrl(url) {
  if (!url) return url;
  const separator = String(url).includes('?') ? '&' : '?';
  return `${url}${separator}t=${Date.now()}`;
}

const SETTINGS_STORAGE_KEY = 'karaSettings';
const DEFAULT_SETTINGS = {
  level: 'beginner',
  targetMinutes: null,
  targetSegments: null,
  priorKnowledge: '',
  ttsVoice: 'tr-TR-AhmetNeural',
  speechVolume: 1.25,
  musicVolume: 0.1
};

function loadSettings() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(SETTINGS_STORAGE_KEY) || 'null');
    return { ...DEFAULT_SETTINGS, ...(stored || {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

const state = {
  settings: loadSettings(),
  auth: {
    session: null,
    profile: null,
    mode: 'login',
    googleOAuthEnabled: false
  },
  activeSection: 'karatahta',
  cardChat: [],
  cardSessions: [],
  katalogChats: [],
  lessons: [],
  lessonSearch: '',
  plan: null,
  lessonId: null,
  lastFullPlanReadyAt: null,
  selectedSegment: null,
  speechBySegment: new Map(),
  playback: {
    active: false,
    currentIndex: -1,
    playable: [],
    finalVideoUrl: null,
    waitingForNext: false,
    userPaused: false
  },
  liveManim: {
    active: false,
    enabled: false,
    failed: false,
    browserFailed: false,
    jobId: null,
    streamUrl: null,
    manifestLoading: false,
    manifestPromise: null,
    manifestDirty: false,
    introDurationSeconds: 0,
    handoffSeconds: 0,
    lastPlaybackSeconds: 0
  },
  developer: {
    lastJob: null,
    lastManifest: null,
    bufferedAhead: 0,
    events: [],
    lastEventKey: null
  },
  karaChat: [],
  googleDriveEnabled: false,
  karaLiveEnabled: false,
  karaLive: {
    client: null,
    active: false,
    liveUserMessage: null,
    liveAssistantMessage: null
  }
};

window.KARA_AUTH = {
  getAccessToken: () => state.auth.session?.access_token || null
};

let controlsHideTimer = null;
let preparingTimer = null;
let preparingProgress = 0;
let lessonLoadVersion = 0;
let authRefreshPromise = null;

const preparingMessages = [
  'Ders akışı kuruluyor...',
  'Anlatım bölümlere ayrılıyor...',
  'Ses metni hazırlanıyor...',
  'Görsel sahneler tasarlanıyor...',
  'Animasyon kodu düzenleniyor...',
  'İlk video bölümü hazırlanıyor...',
  'Ses ve görüntü eşleştiriliyor...',
  'Tahta düzeni son kez kontrol ediliyor...'
];

const els = {
  appShell: document.querySelector('#appShell'),
  workspaceLoading: document.querySelector('#workspaceLoading'),
  workspaceLoadingTitle: document.querySelector('#workspaceLoadingTitle'),
  workspaceLoadingMessage: document.querySelector('#workspaceLoadingMessage'),
  authGate: document.querySelector('#authGate'),
  authForm: document.querySelector('#authForm'),
  authTitle: document.querySelector('#authTitle'),
  authSubtitle: document.querySelector('#authSubtitle'),
  authNameField: document.querySelector('#authNameField'),
  authNameInput: document.querySelector('#authNameInput'),
  authEmailField: document.querySelector('#authEmailField'),
  authEmailInput: document.querySelector('#authEmailInput'),
  authPasswordField: document.querySelector('#authPasswordField'),
  authPasswordLabel: document.querySelector('#authPasswordLabel'),
  authPasswordInput: document.querySelector('#authPasswordInput'),
  authOAuth: document.querySelector('#authOAuth'),
  googleAuthBtn: document.querySelector('#googleAuthBtn'),
  forgotPasswordBtn: document.querySelector('#forgotPasswordBtn'),
  authSubmitBtn: document.querySelector('#authSubmitBtn'),
  authModeBtn: document.querySelector('#authModeBtn'),
  authMessage: document.querySelector('#authMessage'),
  authSpamHint: document.querySelector('#authSpamHint'),
  userEmailText: document.querySelector('#userEmailText'),
  developerPortal: document.querySelector('#developerPortal'),
  logoutBtn: document.querySelector('#logoutBtn'),
  planCurrentName: document.querySelector('#planCurrentName'),
  planVideoUsage: document.querySelector('#planVideoUsage'),
  planCardUsage: document.querySelector('#planCardUsage'),
  logoHomeBtn: document.querySelector('#logoHomeBtn'),
  cardNavBtn: document.querySelector('#cardNavBtn'),
  katalogNavBtn: document.querySelector('#katalogNavBtn'),
  karatahtaNavBtn: document.querySelector('#karatahtaNavBtn'),
  settingsNavBtn: document.querySelector('#settingsNavBtn'),
  sidebarSectionLabel: document.querySelector('#sidebarSectionLabel'),
  historyList: document.querySelector('.historyList'),
  homeView: document.querySelector('#homeView'),
  studioView: document.querySelector('#studioView'),
  cardView: document.querySelector('#cardView'),
  katalogView: document.querySelector('#katalogView'),
  settingsView: document.querySelector('#settingsView'),
  configText: document.querySelector('#configText'),
  statusText: document.querySelector('#statusText'),
  topicInput: document.querySelector('#topicInput'),
  levelInput: document.querySelector('#levelInput'),
  targetMinutesInput: document.querySelector('#targetMinutesInput'),
  targetSegmentsInput: document.querySelector('#targetSegmentsInput'),
  priorInput: document.querySelector('#priorInput'),
  interruptInput: document.querySelector('#interruptInput'),
  questionImageInput: document.querySelector('#questionImageInput'),
  questionImageName: document.querySelector('#questionImageName'),
  clearQuestionImageBtn: document.querySelector('#clearQuestionImageBtn'),
  generatePlanBtn: document.querySelector('#generatePlanBtn'),
  backHomeBtn: document.querySelector('#backHomeBtn'),
  downloadVideoBtn: document.querySelector('#downloadVideoBtn'),
  saveToDriveBtn: document.querySelector('#saveToDriveBtn'),
  lessonTitle: document.querySelector('#lessonTitle'),
  planMeta: document.querySelector('#planMeta'),
  planOutput: document.querySelector('#planOutput'),
  segmentList: document.querySelector('#segmentList'),
  segmentDetail: document.querySelector('#segmentDetail'),
  generateCodeBtn: document.querySelector('#generateCodeBtn'),
  generateFullBtn: document.querySelector('#generateFullBtn'),
  speechMeta: document.querySelector('#speechMeta'),
  speechOutput: document.querySelector('#speechOutput'),
  audioOutput: document.querySelector('#audioOutput'),
  renderBtn: document.querySelector('#renderBtn'),
  codeOutput: document.querySelector('#codeOutput'),
  videoOutput: document.querySelector('#videoOutput'),
  preloadVideo: document.querySelector('#preloadVideo'),
  liveStreamBadge: document.querySelector('#liveStreamBadge'),
  liveStreamText: document.querySelector('#liveStreamText'),
  preparingPanel: document.querySelector('#preparingPanel'),
  preparingTitle: document.querySelector('#preparingTitle'),
  preparingMessage: document.querySelector('#preparingMessage'),
  preparingBar: document.querySelector('#preparingBar'),
  stagePlan: document.querySelector('#stagePlan'),
  stageMedia: document.querySelector('#stageMedia'),
  stagePlayback: document.querySelector('#stagePlayback'),
  videoLoadingPanel: document.querySelector('#videoLoadingPanel'),
  videoLoadingText: document.querySelector('#videoLoadingText'),
  liveManimVideo: document.querySelector('#liveManimVideo'),
  playerControls: document.querySelector('#playerControls'),
  playPauseBtn: document.querySelector('#playPauseBtn'),
  fullscreenBtn: document.querySelector('#fullscreenBtn'),
  seekBar: document.querySelector('#seekBar'),
  timelineSegments: document.querySelector('#timelineSegments'),
  currentTimeText: document.querySelector('#currentTimeText'),
  durationText: document.querySelector('#durationText'),
  videoOverlay: document.querySelector('#videoOverlay'),
  karaAskForm: document.querySelector('#karaAskForm'),
  karaQuestionInput: document.querySelector('#karaQuestionInput'),
  karaTimestamp: document.querySelector('#karaTimestamp'),
  karaSendBtn: document.querySelector('#karaSendBtn'),
  karaLiveBtn: document.querySelector('#karaLiveBtn'),
  karaChat: document.querySelector('#karaChat'),
  logOutput: document.querySelector('#logOutput'),
  developerConsole: document.querySelector('#developerConsole'),
  developerConsoleStatus: document.querySelector('#developerConsoleStatus'),
  developerJobMetric: document.querySelector('#developerJobMetric'),
  developerStateMetric: document.querySelector('#developerStateMetric'),
  developerProgressMetric: document.querySelector('#developerProgressMetric'),
  developerBufferMetric: document.querySelector('#developerBufferMetric'),
  backendActiveBadge: document.querySelector('#backendActiveBadge'),
  backendModeInputs: [...document.querySelectorAll('input[name="backendMode"]')],
  backendHealthBtn: document.querySelector('#backendHealthBtn'),
  backendModeHint: document.querySelector('#backendModeHint'),
  vpsHealthDot: document.querySelector('#vpsHealthDot'),
  vpsHealthText: document.querySelector('#vpsHealthText'),
  railwayHealthDot: document.querySelector('#railwayHealthDot'),
  railwayHealthText: document.querySelector('#railwayHealthText'),
  renderMeta: document.querySelector('#renderMeta'),
  settingsDefaultLevel: document.querySelector('#settingsDefaultLevel'),
  settingsDefaultMinutes: document.querySelector('#settingsDefaultMinutes'),
  settingsDefaultSegments: document.querySelector('#settingsDefaultSegments'),
  settingsDefaultPrior: document.querySelector('#settingsDefaultPrior'),
  settingsTtsVoice: document.querySelector('#settingsTtsVoice'),
  settingsSpeechVolume: document.querySelector('#settingsSpeechVolume'),
  settingsMusicVolume: document.querySelector('#settingsMusicVolume'),
  settingsResetBtn: document.querySelector('#settingsResetBtn')
};

function backendLabel(key) {
  return key === 'vps' ? 'VPS' : 'Railway';
}

function backendHealthText(health) {
  if (!health) return 'Kontrol edilmedi';
  if (!health.online) return health.error === 'timeout' ? 'Zaman aşımı' : 'Erişilemiyor';
  return `Çevrimiçi · ${health.latencyMs} ms`;
}

function renderBackendPortal(snapshot = backendRouter.snapshot()) {
  els.backendActiveBadge.textContent = snapshot.mode === 'hybrid'
    ? `Hibrit · ${backendLabel(snapshot.activeKey)}`
    : backendLabel(snapshot.activeKey);
  els.backendActiveBadge.dataset.backend = snapshot.activeKey;
  for (const input of els.backendModeInputs) {
    input.checked = input.value === snapshot.mode;
    input.disabled = snapshot.locked;
  }
  const healthElements = {
    vps: [els.vpsHealthDot, els.vpsHealthText],
    railway: [els.railwayHealthDot, els.railwayHealthText]
  };
  for (const [key, [dot, text]] of Object.entries(healthElements)) {
    const health = snapshot.health[key];
    dot.classList.toggle('online', Boolean(health?.online));
    dot.classList.toggle('offline', health?.online === false);
    text.textContent = backendHealthText(health);
  }
  els.backendModeHint.textContent = snapshot.locked
    ? `Bu ders ${backendLabel(snapshot.activeKey)} üzerinde çalışıyor. Değiştirmek için Yeni ders'e geç.`
    : (snapshot.mode === 'hybrid'
      ? 'VPS önceliklidir; ulaşılamazsa Railway devralır.'
      : 'Seçim bu tarayıcıda saklanır.');
}

handleBackendRouterChange = (snapshot, reason) => {
  renderBackendPortal(snapshot);
  if (reason === 'failover') {
    appendDeveloperEvent('network', `Hibrit sistem ${backendLabel(snapshot.activeKey)} backend'ine geçti.`, {
      backend: snapshot.activeBaseUrl
    });
  }
};
renderBackendPortal();

function failLiveManimPlayback(error) {
  if (!state.liveManim.active && state.liveManim.browserFailed) return;
  const introDuration = Number(state.liveManim.introDurationSeconds ?? 0);
  const lastPlaybackSeconds = Math.max(
    Number(state.liveManim.lastPlaybackSeconds || 0),
    Number(els.liveManimVideo.currentTime || 0)
  );
  state.liveManim.handoffSeconds = Math.max(
    0,
    lastPlaybackSeconds - introDuration
  );
  state.liveManim.active = false;
  state.liveManim.enabled = false;
  state.liveManim.failed = true;
  state.liveManim.browserFailed = true;
  setVideoLoading(false);
  setVideoOverlay(
    `Son kare korunuyor; hazır video aynı noktadan devam edecek.${error?.message ? ` ${error.message}` : ''}`
  );
  appendDeveloperEvent('error', 'Canlı oynatma arşiv segmentlerine devredildi.', {
    message: error?.message || String(error || 'Bilinmeyen hata'),
    handoffSeconds: state.liveManim.handoffSeconds
  });
  maybeStartOrContinuePlayback();
}

const progressiveManimPlayer = new ProgressiveManimPlayer(els.liveManimVideo, {
  fetcher: authorizedFetch,
  getHeaders: authHeaders,
  onConnected: () => {
    setVideoLoading(true, 'İlk segment alındı; gerçek Manim parçaları hazırlanıyor...');
    appendDeveloperEvent('stream', 'MediaSource bağlantısı açıldı.');
  },
  onPlaybackReady: () => {
    setGenerationStage(els.stagePlan, 'done');
    setGenerationStage(els.stageMedia, 'done');
    setGenerationStage(els.stagePlayback, 'done');
    stopPreparingProgress({ complete: true });
    els.liveManimVideo.classList.add('visible');
    els.liveStreamBadge.classList.add('hidden');
    setVideoLoading(false);
    setVideoOverlay('', false);
    appendDeveloperEvent('playback', 'Canlı oynatma için yeterli tampon hazır.');
    updatePlayerControls();
  },
  onPartial: (partial, bufferedAhead) => {
    state.developer.bufferedAhead = Number(bufferedAhead || 0);
    els.liveStreamText.textContent = `720P30 · ${Math.max(1, Math.floor(bufferedAhead))} saniye tamponda`;
    appendDeveloperEvent(
      'partial',
      `Parça ${Number(partial?.sequence || 0) + 1} oynatma tamponuna eklendi.`,
      { durationSeconds: partial?.durationSeconds, bufferedAhead }
    );
    updatePlayerControls();
  },
  onBuffering: (bufferedAhead) => {
    state.developer.bufferedAhead = Number(bufferedAhead || 0);
    setVideoLoading(true, 'Sıradaki render hazırlanıyor; oynatma aynı karede kısa süre bekliyor...');
    appendDeveloperEvent('buffering', 'Oynatma sıradaki render parçasını bekliyor.', { bufferedAhead });
  },
  onEnded: () => {
    setVideoLoading(false);
    appendDeveloperEvent('stream', 'Canlı video akışı tamamlandı.');
  },
  onError: failLiveManimPlayback
});

function setStatus(message, isError = false) {
  els.statusText.textContent = message;
  els.statusText.classList.toggle('error', isError);
}

function setWorkspaceLoading(loading, title = 'Ders yükleniyor', message = 'Video ve sohbet geçmişi hazırlanıyor...') {
  els.workspaceLoadingTitle.textContent = title;
  els.workspaceLoadingMessage.textContent = message;
  els.workspaceLoading.classList.toggle('hidden', !loading);
  els.workspaceLoading.setAttribute('aria-hidden', String(!loading));
}

function hasVisibleVideo() {
  return (
    els.liveManimVideo.classList.contains('visible')
    || els.videoOutput.classList.contains('visible')
  );
}

function setVideoLoading(loading, message = 'Video yükleniyor...') {
  if (loading && hasVisibleVideo()) {
    els.videoLoadingPanel.classList.add('hidden');
    els.videoLoadingPanel.setAttribute('aria-hidden', 'true');
    return;
  }
  els.videoLoadingText.textContent = message;
  els.videoLoadingPanel.classList.toggle('hidden', !loading);
  els.videoLoadingPanel.setAttribute('aria-hidden', String(!loading));
}

function startPreparingProgress(title) {
  clearTimeout(preparingTimer);
  preparingProgress = 4 + Math.random() * 3;
  els.preparingTitle.textContent = title || els.lessonTitle.textContent || 'Ders hazırlanıyor';
  els.preparingMessage.textContent = preparingMessages[0];
  els.preparingBar.style.width = `${preparingProgress}%`;
  setGenerationStage(els.stagePlan, 'active');
  setGenerationStage(els.stageMedia, 'waiting');
  setGenerationStage(els.stagePlayback, 'waiting');
  els.preparingPanel.classList.remove('hidden');
  setVideoOverlay('', false);

  const tick = () => {
    const messageIndex = Math.min(
      preparingMessages.length - 1,
      Math.floor((preparingProgress / 100) * preparingMessages.length)
    );
    const remaining = 96 - preparingProgress;
    const randomStep = Math.max(0.4, Math.min(4.8, remaining * (0.018 + Math.random() * 0.028)));
    preparingProgress = Math.min(96, preparingProgress + randomStep);
    els.preparingMessage.textContent = preparingMessages[messageIndex];
    els.preparingBar.style.width = `${preparingProgress}%`;

    const nextDelay = 900 + Math.random() * 1900;
    preparingTimer = setTimeout(tick, nextDelay);
  };

  preparingTimer = setTimeout(tick, 900 + Math.random() * 900);
}

function stopPreparingProgress({ complete = false, error = null } = {}) {
  clearTimeout(preparingTimer);
  if (error) {
    els.preparingMessage.textContent = error;
    els.preparingBar.style.width = `${Math.max(preparingProgress, 12)}%`;
    els.preparingPanel.classList.remove('hidden');
    return;
  }
  if (complete) {
    preparingProgress = 100;
    els.preparingBar.style.width = '100%';
  }
  els.preparingPanel.classList.add('hidden');
}

function setGenerationStage(element, status) {
  if (!element) return;
  element.classList.toggle('active', status === 'active');
  element.classList.toggle('done', status === 'done');
}

function streamingPreparationMessage(job) {
  const planCount = job.plan?.segments?.length || 0;
  const total = Math.max(planCount, Number(job.total || 0));
  const remainingPlan = Math.max(0, total - planCount);
  const firstStatus = job.segments?.[0]?.status || 'queued';
  const readyCount = Number(job.progressive?.readyCount || 0);
  const readySeconds = Math.floor(Number(job.progressive?.readyDurationSeconds || 0));

  if (!planCount) return 'İlk segment canlı olarak planlanıyor...';
  if (readyCount > 0) {
    return `${readyCount} gerçek video parçası hazır (${readySeconds} sn tampon).${remainingPlan ? ` Kalan ${remainingPlan} segment arkada planlanıyor.` : ''}`;
  }
  if (firstStatus === 'render') {
    return `İlk segment 720p30 render ediliyor.${remainingPlan ? ` Kalan ${remainingPlan} segment arkada planlanıyor.` : ''}`;
  }
  if (['tts_code', 'code', 'ready_to_render'].includes(firstStatus)) {
    return `İlk segment hazır; ses ve Manim kodu paralel üretiliyor.${remainingPlan ? ` Kalan ${remainingPlan} segment arkada planlanıyor.` : ''}`;
  }
  if (firstStatus === 'speech') {
    return `İlk segment hazır; anlatım ve görsel akış hazırlanıyor.${remainingPlan ? ` Kalan ${remainingPlan} segment arkada planlanıyor.` : ''}`;
  }
  return `İlk segment alındı ve üretim sırasına girdi.${remainingPlan ? ` Kalan ${remainingPlan} segment arkada planlanıyor.` : ''}`;
}

function updateStreamingPreparation(job) {
  if (!job) return;
  clearTimeout(preparingTimer);

  const planCount = job.plan?.segments?.length || 0;
  const total = Math.max(planCount, Number(job.total || 0), 1);
  const readyCount = Number(job.progressive?.readyCount || 0);
  const readySeconds = Number(job.progressive?.readyDurationSeconds || 0);
  const bufferTarget = Math.max(0.001, Number(job.progressive?.bufferTargetSeconds ?? 0));
  const playbackReady = Boolean(job.progressive?.playbackReadyAt)
    || job.progressive?.status === 'ready'
    || job.progressive?.status === 'done';
  const firstStatus = job.segments?.[0]?.status || 'queued';
  const mediaStarted = !['queued', 'speech'].includes(firstStatus);

  setGenerationStage(els.stagePlan, planCount > 0 ? 'done' : 'active');
  setGenerationStage(
    els.stageMedia,
    readyCount > 0 ? 'done' : (planCount > 0 ? 'active' : 'waiting')
  );
  setGenerationStage(
    els.stagePlayback,
    playbackReady ? 'done' : (readyCount > 0 ? 'active' : 'waiting')
  );

  let actualProgress = planCount > 0 ? 24 : 8;
  if (mediaStarted) actualProgress = 46;
  if (firstStatus === 'render') actualProgress = 64;
  if (readyCount > 0) {
    actualProgress = 68 + Math.min(24, (readySeconds / bufferTarget) * 24);
  }
  if (playbackReady) actualProgress = 100;
  preparingProgress = Math.max(preparingProgress, actualProgress);
  els.preparingTitle.textContent = job.plan?.topic || els.lessonTitle.textContent || 'Ders hazırlanıyor';
  els.preparingMessage.textContent = streamingPreparationMessage(job);
  els.preparingBar.style.width = `${Math.min(100, preparingProgress)}%`;

  // Job updates continue while the remaining segments render. Once either
  // player is visible, never let those background updates cover playback.
  if (hasVisibleVideo()) {
    els.preparingPanel.classList.add('hidden');
    return;
  }

  if (!playbackReady && job.status !== 'failed' && job.status !== 'done') {
    els.preparingPanel.classList.remove('hidden');
  }
}

function liveProductionText(job) {
  const planCount = job.plan?.segments?.length || 0;
  const total = Math.max(planCount, Number(job.total || 0));
  const readyCount = Number(job.progressive?.readyCount || 0);
  const readySeconds = Math.floor(Number(job.progressive?.readyDurationSeconds || 0));
  const planSuffix = planCount < total ? ` · plan ${planCount}/${total}` : '';

  if (readyCount > 0) {
    return `720P30 MANIM · ${readyCount} gerçek parça · ${readySeconds} sn hazır${planSuffix}`;
  }
  if (planCount > 0) {
    return `İlk segment üretimde${planSuffix}`;
  }
  return `İlk segment planlanıyor · plan 0/${total || '?'}`;
}

function hideAllMainViews() {
  els.homeView.classList.add('hidden');
  els.studioView.classList.add('hidden');
  els.cardView.classList.add('hidden');
  els.katalogView.classList.add('hidden');
  els.settingsView.classList.add('hidden');
}

function showStudio() {
  hideAllMainViews();
  els.studioView.classList.remove('hidden');
}

function showHome() {
  hideAllMainViews();
  els.homeView.classList.remove('hidden');
}

function showCard() {
  hideAllMainViews();
  els.cardView.classList.remove('hidden');
}

function showKatalog() {
  hideAllMainViews();
  els.katalogView.classList.remove('hidden');
}

function showSettings() {
  hideAllMainViews();
  els.settingsView.classList.remove('hidden');
}

function setActiveChip(groupSelector, activeButton) {
  document.querySelectorAll(groupSelector).forEach((button) => {
    button.classList.toggle('active', button === activeButton);
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function authHeaders() {
  const token = state.auth.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function refreshAccessToken() {
  if (authRefreshPromise) return authRefreshPromise;
  const refreshToken = state.auth.session?.refresh_token;
  if (!refreshToken) throw new Error('Oturum yenileme anahtari bulunamadi.');
  authRefreshPromise = authApi('/api/auth/refresh', { refresh_token: refreshToken })
    .then((refreshed) => {
      if (!refreshed.session?.access_token) {
        throw new Error('Sunucu yenilenmis oturum dondurmedi.');
      }
      saveAuthSession(refreshed.session, refreshed.profile || state.auth.profile);
      return refreshed.session;
    })
    .catch((error) => {
      saveAuthSession(null);
      showAuth('Oturum suresi doldu. Lutfen tekrar giris yap.', true);
      throw error;
    })
    .finally(() => {
      authRefreshPromise = null;
    });
  return authRefreshPromise;
}

async function authorizedFetch(url, options = {}, retry = true) {
  const expiresAt = Number(state.auth.session?.expires_at || 0);
  if (
    state.auth.session?.refresh_token
    && expiresAt
    && expiresAt <= Math.floor(Date.now() / 1000) + 45
  ) {
    await refreshAccessToken();
  }
  const response = await backendRouter.request(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...authHeaders()
    }
  });
  if (response.status === 401 && retry && state.auth.session?.refresh_token) {
    await refreshAccessToken();
    return authorizedFetch(url, options, false);
  }
  return response;
}

function saveAuthSession(session, profile = null) {
  state.auth.session = session || null;
  state.auth.profile = profile || null;
  if (session) {
    localStorage.setItem('karaAuthSession', JSON.stringify({ session, profile }));
  } else {
    localStorage.removeItem('karaAuthSession');
  }
}

function loadStoredAuthSession() {
  try {
    const stored = JSON.parse(localStorage.getItem('karaAuthSession') || 'null');
    if (stored?.session?.access_token) {
      state.auth.session = stored.session;
      state.auth.profile = stored.profile || null;
    }
  } catch {
    saveAuthSession(null);
  }
}

function showAuth(message = '', isError = false) {
  els.authGate.classList.remove('hidden');
  els.appShell.classList.add('hidden');
  els.authMessage.textContent = message;
  els.authMessage.classList.toggle('error', isError);
}

function showApp() {
  els.authGate.classList.add('hidden');
  els.appShell.classList.remove('hidden');
  const email = state.auth.profile?.email || state.auth.session?.user?.email || '';
  els.userEmailText.textContent = email;
  els.developerPortal.classList.toggle('hidden', !isAdminEmail(email));
  els.developerConsole.classList.toggle('hidden', !isAdminEmail(email));
  refreshLessonHistory().catch(() => {});
  refreshPlanStatus().catch(() => {});
  window.dispatchEvent(new CustomEvent('kara:show-welcome'));
}

async function refreshPlanStatus() {
  const data = await apiGet('/api/plans/me');
  if (els.planCurrentName) els.planCurrentName.textContent = data.planName || 'Ücretsiz Deneme';
  if (els.planVideoUsage) els.planVideoUsage.textContent = `${data.video?.used ?? 0}/${data.video?.quota ?? 2}`;
  if (els.planCardUsage) els.planCardUsage.textContent = `${data.card?.used ?? 0}/${data.card?.quota ?? 2}`;
}

function setAuthMode(mode) {
  state.auth.mode = mode;
  const isSignup = mode === 'signup';
  const isReset = mode === 'reset';
  const isUpdate = mode === 'update-password';
  const modeCopy = {
    login: {
      title: 'Tekrar hoş geldin',
      subtitle: 'Video derslerine devam etmek için giriş yap.',
      submit: 'Giriş yap',
      switch: 'Hesabın yok mu? Hesap oluştur'
    },
    signup: {
      title: 'Öğrenmeye başla',
      subtitle: 'İlk yapay zekâ destekli video dersini oluştur.',
      submit: 'Hesap oluştur',
      switch: 'Zaten hesabın var mı? Giriş yap'
    },
    reset: {
      title: 'Şifreni yenile',
      subtitle: 'Sıfırlama bağlantısını göndereceğimiz e-postayı yaz.',
      submit: 'Bağlantı gönder',
      switch: 'Giriş ekranına dön'
    },
    'update-password': {
      title: 'Yeni şifreni belirle',
      subtitle: 'Hesabın için en az 8 karakterlik yeni bir şifre oluştur.',
      submit: 'Şifreyi güncelle',
      switch: 'Giriş ekranına dön'
    }
  }[mode] || {};

  els.authTitle.textContent = modeCopy.title || '';
  els.authSubtitle.textContent = modeCopy.subtitle || '';
  els.authSubmitBtn.textContent = modeCopy.submit || '';
  els.authModeBtn.textContent = modeCopy.switch || '';
  els.authNameField.classList.toggle('hidden', !isSignup);
  els.authEmailField.classList.toggle('hidden', isUpdate);
  els.authPasswordField.classList.toggle('hidden', isReset);
  els.forgotPasswordBtn.classList.toggle('hidden', mode !== 'login');
  els.authOAuth.classList.toggle('hidden', isReset || isUpdate || !state.auth.googleOAuthEnabled);
  els.authSpamHint.classList.toggle('hidden', !isSignup && !isReset);
  els.authEmailInput.required = !isUpdate;
  els.authPasswordInput.required = !isReset;
  els.authPasswordInput.autocomplete = isSignup || isUpdate ? 'new-password' : 'current-password';
  els.authPasswordInput.minLength = isSignup || isUpdate ? 8 : 0;
  els.authPasswordInput.placeholder = isSignup || isUpdate ? 'En az 8 karakter' : 'Şifren';
  els.authPasswordLabel.textContent = isUpdate ? 'Yeni şifre' : 'Şifre';
  els.authPasswordInput.value = '';
  els.authMessage.textContent = '';
  els.authMessage.classList.remove('error', 'success');
}

function consumeAuthRedirect() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(window.location.search);
  const accessToken = hash.get('access_token');
  const refreshToken = hash.get('refresh_token');
  const expiresIn = Number(hash.get('expires_in') || 3600);
  const flow = hash.get('type') || query.get('auth');
  const error = hash.get('error_description') || query.get('error_description');
  const providerRefreshToken = hash.get('provider_refresh_token');

  if (accessToken) {
    saveAuthSession({
      access_token: accessToken,
      refresh_token: refreshToken || null,
      token_type: hash.get('token_type') || 'bearer',
      expires_in: expiresIn,
      expires_at: Math.floor(Date.now() / 1000) + expiresIn
    });
  }

  if (window.location.hash || query.has('auth') || query.has('error_description')) {
    query.delete('auth');
    query.delete('error');
    query.delete('error_code');
    query.delete('error_description');
    const cleanUrl = `${window.location.pathname}${query.toString() ? `?${query}` : ''}`;
    window.history.replaceState({}, document.title, cleanUrl);
  }

  return {
    error,
    isRecovery: flow === 'recovery' && Boolean(accessToken),
    isConfirmed: flow === 'confirmed' || flow === 'signup',
    isDriveConnect: flow === 'drive' && Boolean(accessToken),
    providerRefreshToken: providerRefreshToken || null
  };
}

function shortDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function beginNewLesson() {
  lessonLoadVersion += 1;
  state.plan = null;
  state.lessonId = null;
  state.lastFullPlanReadyAt = null;
  state.selectedSegment = null;
  state.speechBySegment = new Map();
  resetProgressivePlayback();
  backendRouter.setLocked(false);
  stopKaraLive();
  resetKaraChat();
  setWorkspaceLoading(false);
  setVideoLoading(false);
  renderLessonHistory();
  showHome();
  setStatus('Hazir');
}

function renderLessonHistory() {
  if (state.activeSection !== 'karatahta') return;
  const lessons = state.lessons || [];
  const query = state.lessonSearch.trim().toLowerCase();
  const visibleLessons = query
    ? lessons.filter((lesson) => String(lesson.title || lesson.topic || 'Ders').toLowerCase().includes(query))
    : lessons;
  els.historyList.innerHTML = `
    <button class="historyItem ${state.lessonId ? '' : 'active'}" type="button" data-new-lesson="true">
      <span class="historyText">
        <strong>Yeni ders</strong>
        <small>Bir konu sec ve uret</small>
      </span>
    </button>
    <label class="historySearch">
      <input id="lessonSearchInput" type="search" value="${escapeHtml(state.lessonSearch)}" placeholder="Derslerde ara">
    </label>
    ${visibleLessons.map((lesson) => `
      <div class="historyItem ${lesson.id === state.lessonId ? 'active' : ''}">
        <button class="historyRowBtn" type="button" data-lesson-id="${escapeHtml(lesson.id)}">
          <span class="historyText">
            <strong>${escapeHtml(lesson.title || lesson.topic || 'Ders')}</strong>
          </span>
        </button>
        <button class="historyDeleteBtn" type="button" data-delete-lesson-id="${escapeHtml(lesson.id)}" aria-label="Dersi sil" title="Dersi sil">✕</button>
      </div>
    `).join('')}
  `;
}

const SECTION_META = {
  karatahta: { label: 'ÇALIŞMA ALANI', emptyText: null },
  card: { label: 'KART GEÇMİŞİ', emptyText: 'Henüz geçmiş yok.' },
  katalog: { label: 'KATALOG', emptyText: 'Henüz geçmiş yok.' },
  settings: { label: 'AYARLAR', emptyText: null }
};

function updateSectionNav() {
  els.karatahtaNavBtn.classList.toggle('active', state.activeSection === 'karatahta');
  els.cardNavBtn.classList.toggle('active', state.activeSection === 'card');
  els.katalogNavBtn.classList.toggle('active', state.activeSection === 'katalog');
  els.settingsNavBtn.classList.toggle('active', state.activeSection === 'settings');
}

function renderCardHistory() {
  if (state.activeSection !== 'card') return;
  const sessions = state.cardSessions || [];
  const newItem = `
    <button class="historyItem" type="button" data-card-new="true">
      <span class="historyText">
        <strong>Yeni sohbet</strong>
        <small>Yeni bir kart oturumu baslat</small>
      </span>
    </button>
  `;
  if (!sessions.length) {
    els.historyList.innerHTML = newItem + `<p class="historyEmpty">${escapeHtml(SECTION_META.card.emptyText)}</p>`;
    return;
  }
  els.historyList.innerHTML = newItem + sessions.map((session) => `
    <div class="historyItem">
      <button class="historyRowBtn" type="button" data-card-session-id="${escapeHtml(session.id)}">
        <span class="historyText">
          <strong>${escapeHtml(session.title || 'Kart oturumu')}</strong>
        </span>
      </button>
    </div>
  `).join('');
}

async function refreshCardHistory() {
  try {
    const data = await apiGet('/api/cards/sessions');
    state.cardSessions = data.sessions || [];
  } catch {
    state.cardSessions = [];
  }
  renderCardHistory();
}

function renderKatalogHistory() {
  if (state.activeSection !== 'katalog') return;
  const chats = state.katalogChats || [];
  const exploreItem = `
    <button class="historyItem" type="button" data-katalog-explore="true">
      <span class="historyText">
        <strong>Kataloğu Keşfet</strong>
        <small>Videolarda gezin</small>
      </span>
    </button>
  `;
  if (!chats.length) {
    els.historyList.innerHTML = exploreItem + `<p class="historyEmpty">${escapeHtml(SECTION_META.katalog.emptyText)}</p>`;
    return;
  }
  els.historyList.innerHTML = exploreItem + chats.map((chat) => `
    <div class="historyItem">
      <button class="historyRowBtn" type="button" data-katalog-lesson-id="${escapeHtml(chat.lessonId)}">
        <span class="historyText">
          <strong>${escapeHtml(chat.title || chat.topic || 'Ders')}</strong>
        </span>
      </button>
    </div>
  `).join('');
}

async function refreshKatalogHistory() {
  try {
    const data = await apiGet('/api/catalog/chats');
    state.katalogChats = data.chats || [];
  } catch {
    state.katalogChats = [];
  }
  renderKatalogHistory();
}

function renderSectionHistory() {
  const meta = SECTION_META[state.activeSection] || SECTION_META.karatahta;
  els.sidebarSectionLabel.textContent = meta.label;
  if (state.activeSection === 'karatahta') {
    renderLessonHistory();
    return;
  }
  if (state.activeSection === 'card') {
    renderCardHistory();
    void refreshCardHistory();
    return;
  }
  if (state.activeSection === 'katalog') {
    renderKatalogHistory();
    void refreshKatalogHistory();
    return;
  }
  els.historyList.innerHTML = `<p class="historyEmpty">${escapeHtml(meta.emptyText || '')}</p>`;
}

function setActiveSection(section) {
  if (state.activeSection === section) return;
  state.activeSection = section;
  updateSectionNav();
  renderSectionHistory();
  if (section === 'card') {
    showCard();
  } else if (section === 'katalog') {
    showKatalog();
  } else if (section === 'settings') {
    showSettings();
  } else {
    state.lessonId ? showStudio() : showHome();
  }
}

async function refreshLessonHistory() {
  const data = await apiGet('/api/lessons');
  state.lessons = data.lessons || [];
  renderLessonHistory();
}

async function handleDeleteLesson(lessonId) {
  if (!lessonId) return;
  const lesson = (state.lessons || []).find((item) => item.id === lessonId);
  const label = lesson?.title || lesson?.topic || 'Bu ders';
  if (!window.confirm(`"${label}" silinsin mi? Bu islem geri alinamaz.`)) return;
  try {
    await apiDelete(`/api/lessons/${encodeURIComponent(lessonId)}`);
    state.lessons = (state.lessons || []).filter((item) => item.id !== lessonId);
    if (state.lessonId === lessonId) {
      beginNewLesson();
    } else {
      renderLessonHistory();
    }
    setStatus('Ders silindi.');
  } catch (error) {
    setStatus(error.message, true);
  }
}

function localVideoUrl(relativePath) {
  void relativePath;
  return null;
}

async function lessonVideoUrl(lessonId, video, signedVideoUrl = null) {
  if (signedVideoUrl) {
    return signedVideoUrl;
  }
  if (video?.video_storage_path) {
    try {
      const data = await apiGet(`/api/lessons/${encodeURIComponent(lessonId)}/video-url`);
      if (data.videoUrl) {
        return data.videoUrl;
      }
    } catch (error) {
      console.warn('Kalici video URL alinamadi, Railway kopyasi deneniyor.', error);
    }
  }
  return localVideoUrl(video?.local_video_path);
}

async function loadLessonFromHistory(lessonId) {
  if (!lessonId) return;
  const requestedLessonId = String(lessonId);
  const loadVersion = ++lessonLoadVersion;

  state.lessonId = requestedLessonId;
  resetProgressivePlayback();
  setVideoLoading(true, 'Ders videosu hazırlanıyor...');
  setWorkspaceLoading(true);
  renderLessonHistory();
  setStatus('Ders gecmisten yukleniyor...');
  try {
    const data = await apiGet(`/api/lessons/${encodeURIComponent(requestedLessonId)}`);
    backendRouter.setLocked(true);
    if (loadVersion !== lessonLoadVersion) return;
    if (String(data.lesson?.id || '') !== requestedLessonId) {
      throw new Error('Sunucu farklı bir ders kaydı döndürdü.');
    }

    const plan = data.plan || {
      topic: data.lesson?.topic || data.lesson?.title || 'Ders',
      estimated_duration_minutes: data.lesson?.target_minutes || null,
      segments: (data.segments || []).map((segment) => ({
        id: segment.segment_key,
        title: segment.title,
        duration_seconds: segment.duration_seconds,
        learning_objective: segment.learning_objective,
        narration: segment.narration,
        animation: segment.animation_json
      }))
    };
    plan._lesson_id = data.lesson.id;

    state.plan = plan;
    state.lessonId = data.lesson.id;
    state.selectedSegment = plan.segments?.[0] || null;
    state.speechBySegment = new Map();
    state.karaChat = (data.messages || []).map((message) => ({
      role: message.role,
      timestamp: message.timestamp_label || '',
      content: message.content
    }));

    els.lessonTitle.textContent = data.lesson.title || plan.topic || 'Ders';
    renderPlan(plan);
    renderSegments();
    renderSegmentDetail();
    renderSpeech();
    renderKaraChat();
    showStudio();

    const videoUrl = await lessonVideoUrl(data.lesson.id, data.video, data.videoUrl);
    if (loadVersion !== lessonLoadVersion || state.lessonId !== requestedLessonId) return;

    if (videoUrl) {
      setVideoLoading(true, 'Ders videosu yükleniyor...');
      els.videoOutput.dataset.lessonId = requestedLessonId;
      els.videoOutput.addEventListener('loadeddata', () => {
        if (
          loadVersion !== lessonLoadVersion
          || els.videoOutput.dataset.lessonId !== requestedLessonId
        ) {
          return;
        }
        els.videoOutput.classList.add('visible');
        setVideoLoading(false);
        updateKaraAskVisibility();
      }, { once: true });
      els.videoOutput.src = videoUrl;
      els.videoOutput.load();
      state.playback.active = false;
      state.playback.finalVideoUrl = videoUrl;
      setDownloadVideo(videoUrl);
      updatePlayerControls();
      setStatus('Ders gecmisten yuklendi.');
    } else {
      setVideoLoading(false);
      setDownloadVideo(null);
      setVideoOverlay('Bu ders icin video kaydi bulunamadi.', true);
      updateKaraAskVisibility();
      setStatus('Ders gecmisten yuklendi, video bulunamadi.');
    }
    renderLessonHistory();
  } catch (error) {
    if (loadVersion === lessonLoadVersion) {
      setVideoLoading(false);
      setStatus(error.message, true);
    }
  } finally {
    if (loadVersion === lessonLoadVersion) {
      setWorkspaceLoading(false);
    }
  }
}

async function authApi(path, payload = null, options = {}) {
  const response = await backendRouter.request(apiUrl(path), {
    method: options.method || 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders()
    },
    body: payload ? JSON.stringify(payload) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Kimlik islemi basarisiz oldu.');
  }
  return data;
}

async function apiGet(path) {
  const response = await authorizedFetch(apiUrl(path));
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      saveAuthSession(null);
      showAuth('Oturum suresi doldu. Lutfen tekrar giris yap.', true);
    }
    throw new Error(data.error || 'Istek basarisiz oldu.');
  }
  return data;
}

async function apiDelete(path) {
  const response = await authorizedFetch(apiUrl(path), { method: 'DELETE' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      saveAuthSession(null);
      showAuth('Oturum suresi doldu. Lutfen tekrar giris yap.', true);
    }
    throw new Error(data.error || 'Istek basarisiz oldu.');
  }
  return data;
}

async function api(path, payload) {
  const response = await authorizedFetch(apiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      saveAuthSession(null);
      showAuth('Oturum suresi doldu. Lutfen tekrar giris yap.', true);
    }
    const error = new Error(data.error || 'Istek basarisiz oldu.');
    error.details = data;
    throw error;
  }
  return data;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Fotoğraf okunamadı.'));
    reader.readAsDataURL(file);
  });
}

async function selectedQuestionImagePayload() {
  const file = els.questionImageInput.files?.[0];
  if (!file) {
    return null;
  }
  if (!file.type.startsWith('image/')) {
    throw new Error('Lütfen bir fotoğraf dosyası seçin.');
  }
  return {
    mimeType: file.type,
    data: await readFileAsDataUrl(file)
  };
}

function clearQuestionImage() {
  els.questionImageInput.value = '';
  els.questionImageName.textContent = 'Fotoğraf eklenmedi';
  els.clearQuestionImageBtn.classList.add('hidden');
}

function renderPlan(plan) {
  const misconceptions = Array.isArray(plan.common_misconceptions)
    ? plan.common_misconceptions
    : [];

  els.planMeta.textContent = `${plan.estimated_duration_minutes || '?'} dk | ${(plan.segments || []).length} segment`;
  els.planOutput.classList.remove('empty');
  els.planOutput.innerHTML = `
    <div class="row">
      <strong>Cekirdek fikir</strong>
      <div>${escapeHtml(plan.core_insight)}</div>
    </div>
    <div class="row">
      <strong>Acilis</strong>
      <div>${escapeHtml(plan.hook?.question)}</div>
    </div>
    <div class="row">
      <strong>Analoji</strong>
      <div>${escapeHtml(plan.analogy?.everyday_scenario)}</div>
    </div>
    <div class="row">
      <strong>Yanlis anlamalar</strong>
      <div>
        ${misconceptions.map((item) => `
          <span class="pill">${escapeHtml(item.misconception)}</span>
        `).join('') || '<span class="pill">Yok</span>'}
      </div>
    </div>
  `;
}

function renderSegments() {
  const segments = state.plan?.segments || [];
  els.segmentList.innerHTML = '';

  segments.forEach((segment) => {
    const button = document.createElement('button');
    button.className = 'segmentTab';
    button.textContent = segment.id || 'segment';
    button.classList.toggle('active', segment === state.selectedSegment);
    button.addEventListener('click', () => {
      state.selectedSegment = segment;
      renderSegments();
      renderSegmentDetail();
    });
    els.segmentList.append(button);
  });

  els.generateCodeBtn.disabled = !state.selectedSegment;
  els.generateFullBtn.disabled = !segments.length;
}

function renderSegmentDetail() {
  const segment = state.selectedSegment;
  if (!segment) {
    els.segmentDetail.classList.add('empty');
    els.segmentDetail.textContent = 'Bir segment sec.';
    return;
  }

  els.segmentDetail.classList.remove('empty');
  els.segmentDetail.innerHTML = `
    <div class="row">
      <strong>${escapeHtml(segment.title || segment.id)}</strong>
      <div>${escapeHtml(segment.learning_objective)}</div>
    </div>
    <div class="row">
      <strong>Anlatim</strong>
      <div>${escapeHtml(segment.narration)}</div>
    </div>
    <div class="row">
      <strong>Animasyon</strong>
      <div>${escapeHtml(segment.animation?.description)}</div>
      <span class="pill">${escapeHtml(segment.animation?.type)}</span>
      <span class="pill">${escapeHtml(segment.duration_seconds)} sn</span>
    </div>
  `;
  renderSpeech();
}

function renderSpeech() {
  const segmentId = state.selectedSegment?.id;
  const speechState = segmentId ? state.speechBySegment.get(segmentId) : null;

  if (!speechState) {
    els.speechMeta.textContent = '';
    els.speechOutput.classList.add('empty');
    els.speechOutput.textContent = 'Henuz speech yok.';
    els.audioOutput.classList.remove('visible');
    els.audioOutput.removeAttribute('src');
    return;
  }

  els.speechMeta.textContent = `${speechState.voiceName || 'Ses'} | ${speechState.durationSeconds.toFixed(1)} sn`;
  els.speechOutput.classList.remove('empty');
  els.speechOutput.innerHTML = `
    <div class="row">
      <strong>Ses metni</strong>
      <div>${escapeHtml(speechState.speech.speech_text)}</div>
    </div>
    <div class="row">
      <strong>Senkron ipuclari</strong>
      <div>
        ${(speechState.speech.cue_plan || []).map((cue) => `
          <span class="pill">%${escapeHtml(cue.at_percent)} ${escapeHtml(cue.visual_action)}</span>
        `).join('') || '<span class="pill">Yok</span>'}
      </div>
    </div>
  `;
  els.audioOutput.src = cacheBustUrl(speechState.audioUrl);
  els.audioOutput.classList.add('visible');
}

async function monitorFullLessonJob(job) {
  setBusy(els.generateFullBtn, true, 'Ders Uretiliyor');
  els.liveStreamBadge.classList.remove('hidden');
  updateStreamingPreparation(job);
  els.liveStreamText.textContent = liveProductionText(job);

  try {
    const finalJob = await waitForFullVideoJob(job.id);
    const canonicalLive = finalJob.result?.source === 'progressive_partials';
    els.renderMeta.textContent = canonicalLive ? 'Gerçek Manim Akışı · Aynı Final' : 'Tam Ders';
    appendDeveloperEvent('done', 'Tam video kaydedildi.', {
      videoUrl: finalJob.result.videoUrl,
      source: finalJob.result?.source
    });
    state.playback.finalVideoUrl = finalJob.result.videoUrl;
    setDownloadVideo(finalJob.result.videoUrl);
    maybeStartOrContinuePlayback();
    if (
      finalJob.result.videoUrl
      && !hasVisibleVideo()
      && !state.playback.playable.length
    ) {
      els.videoOutput.src = absoluteVideoUrl(finalJob.result.videoUrl);
      els.videoOutput.classList.add('visible');
      els.videoOutput.load();
      els.videoOutput.play().catch(() => {});
      setVideoOverlay('', false);
    }
    refreshLessonHistory().catch(() => {});
    setStatus(canonicalLive
      ? 'İzlediğin canlı ders aynı görüntüyle kaydedildi.'
      : 'Tam ders videosu hazir. Izleme akisi devam ediyor.');
  } catch (error) {
    appendDeveloperEvent('error', 'Tam ders üretimi başarısız oldu.', {
      message: error.message,
      stdout: error.details?.stdout,
      stderr: error.details?.stderr
    });
    progressiveManimPlayer.stop();
    state.liveManim.active = false;
    state.liveManim.enabled = false;
    state.liveManim.failed = true;
    els.liveManimVideo.classList.remove('visible');
    els.liveStreamBadge.classList.add('hidden');
    setVideoLoading(false);
    if (!hasVisibleVideo()) {
      setVideoOverlay(`Üretim durdu: ${error.message}`, true);
    }
    stopPreparingProgress({ error: error.message });
    setStatus(error.message, true);
  } finally {
    setBusy(els.generateFullBtn, false);
    renderSegments();
  }
}

async function startFullLessonGeneration() {
  const segments = state.plan?.segments || [];
  if (!segments.length) return;

  els.generateCodeBtn.disabled = true;
  els.renderBtn.disabled = true;
  els.logOutput.textContent = '';
  els.videoOutput.classList.remove('visible');
  els.renderMeta.textContent = '';
  setDownloadVideo(null);
  resetProgressivePlayback();
  startPreparingProgress(els.lessonTitle.textContent);
  setVideoOverlay('Ilk bolum hazirlaniyor...');

  try {
    setStatus('Tam ders uretiliyor...');
    const job = await api('/api/full-video', {
      plan: state.plan,
      lesson_id: state.lessonId,
      ...ttsOptionsPayload()
    });
    backendRouter.setLocked(true);
    await monitorFullLessonJob(job);
  } catch (error) {
    stopPreparingProgress({ error: error.message });
    setStatus(error.message, true);
  }
}

function setBusy(button, busy, text) {
  if (!button.dataset.defaultText) {
    button.dataset.defaultText = button.textContent;
  }
  button.disabled = busy;
  button.textContent = busy ? text : button.dataset.defaultText;
}

function setVideoOverlay(message, visible = true) {
  if (visible && hasVisibleVideo()) {
    els.videoOverlay.classList.remove('visible');
    return;
  }
  els.videoOverlay.textContent = message;
  els.videoOverlay.classList.toggle('visible', visible);
}

function formatTime(seconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const rest = safeSeconds % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function resetDeveloperConsole() {
  state.developer = {
    lastJob: null,
    lastManifest: null,
    bufferedAhead: 0,
    events: [],
    lastEventKey: null
  };
  renderDeveloperConsole();
}

function appendDeveloperEvent(type, message, details = null) {
  const eventKey = `${type}:${message}:${JSON.stringify(details || null)}`;
  if (state.developer.lastEventKey === eventKey) {
    renderDeveloperConsole();
    return;
  }
  state.developer.lastEventKey = eventKey;
  state.developer.events.push({
    at: new Date().toISOString(),
    type,
    message,
    details
  });
  if (state.developer.events.length > 80) {
    state.developer.events.splice(0, state.developer.events.length - 80);
  }
  renderDeveloperConsole();
}

function renderDeveloperConsole() {
  const job = state.developer.lastJob;
  const manifest = state.developer.lastManifest;
  const readySeconds = Number(
    manifest?.readyDurationSeconds
    ?? job?.progressive?.readyDurationSeconds
    ?? 0
  );
  const bufferSeconds = Math.max(0, Number(state.developer.bufferedAhead || 0));

  els.developerJobMetric.textContent = job?.id || '—';
  els.developerStateMetric.textContent = job?.status || (state.liveManim.active ? 'playing' : 'idle');
  els.developerProgressMetric.textContent = `${Number(job?.progress || 0)} / ${Number(job?.total || 0)}`;
  els.developerBufferMetric.textContent = `${bufferSeconds.toFixed(1)} sn`;
  els.developerConsoleStatus.textContent = job
    ? `${job.current || job.message || job.status} · ${new Date().toLocaleTimeString('tr-TR')}`
    : 'Canlı olay bekleniyor';

  const eventLines = state.developer.events.slice().reverse().map((event) => {
    const timestamp = new Date(event.at).toLocaleTimeString('tr-TR', { hour12: false });
    const details = event.details ? ` ${JSON.stringify(event.details)}` : '';
    return `[${timestamp}] ${event.type.toUpperCase()}  ${event.message}${details}`;
  });
  const snapshot = job ? {
    job: {
      id: job.id,
      status: job.status,
      progress: job.progress,
      total: job.total,
      current: job.current,
      message: job.message,
      error: job.error,
      updatedAt: job.updatedAt
    },
    generated: {
      plan: job.plan || state.plan,
      segments: job.segments || []
    },
    progressive: {
      ...(job.progressive || {}),
      bufferedAheadSeconds: bufferSeconds,
      manifestPartials: manifest?.partials?.map((partial) => ({
        sequence: partial.sequence,
        startSeconds: partial.startSeconds,
        durationSeconds: partial.durationSeconds
      })) || []
    },
    playback: {
      mode: state.liveManim.active ? 'progressive' : (state.playback.active ? 'segments' : 'idle'),
      currentSegmentIndex: state.playback.currentIndex,
      playableSegments: state.playback.playable.length,
      waitingForNext: state.playback.waitingForNext,
      currentSeconds: state.liveManim.active
        ? Number(els.liveManimVideo.currentTime || 0)
        : currentGlobalTime(),
      readySeconds
    },
    timings: job.timings || null
  } : null;

  els.logOutput.textContent = [
    'LIVE EVENTS',
    eventLines.join('\n') || 'Henüz üretim olayı yok.',
    ...(snapshot ? ['', 'CURRENT SNAPSHOT', JSON.stringify(snapshot, null, 2)] : [])
  ].join('\n');
}

function renderMathMarkdown(value) {
  const escaped = escapeHtml(value);
  return escaped
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function safeChatUrl(value) {
  try {
    const url = new URL(apiUrl(String(value || '')), window.location.href);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function renderKaraMessageExtras(message) {
  const tools = Array.isArray(message.toolsUsed) ? message.toolsUsed : [];
  const artifacts = (Array.isArray(message.artifacts) ? message.artifacts : [])
    .map((artifact) => ({ ...artifact, safeUrl: safeChatUrl(artifact?.url) }))
    .filter((artifact) => artifact.type === 'image' && artifact.safeUrl);
  const sources = (Array.isArray(message.sources) ? message.sources : [])
    .map((source) => ({ ...source, safeUrl: safeChatUrl(source?.url) }))
    .filter((source) => source.safeUrl);

  return `
    ${tools.length ? `<div class="karaToolBadges">${tools.map((tool) => (
      `<span>${escapeHtml(tool === 'web_search' ? 'Web araması' : tool === 'generate_manim' ? 'Manim görseli' : tool)}</span>`
    )).join('')}</div>` : ''}
    ${artifacts.map((artifact) => `
      <figure class="karaArtifact">
        <img src="${escapeHtml(artifact.safeUrl)}" alt="${escapeHtml(artifact.title || 'Kara tarafından oluşturulan Manim görseli')}" loading="lazy">
        <figcaption>${escapeHtml(artifact.title || 'Kara Manim görseli')}</figcaption>
      </figure>
    `).join('')}
    ${sources.length ? `
      <div class="karaSources">
        <strong>Kaynaklar</strong>
        ${sources.map((source) => `<a href="${escapeHtml(source.safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title || source.safeUrl)}</a>`).join('')}
      </div>
    ` : ''}
  `;
}

function typesetKaraChat() {
  if (!window.MathJax?.typesetPromise) {
    return;
  }
  window.MathJax.typesetPromise([els.karaChat]).catch(() => {});
}

function renderKaraChat() {
  if (!state.karaChat.length) {
    els.karaChat.classList.add('hidden');
    els.karaChat.innerHTML = '';
    return;
  }

  els.karaChat.classList.remove('hidden');
  els.karaChat.innerHTML = state.karaChat.map((message) => `
    <article class="chatMessage ${message.role === 'assistant' ? 'assistant' : 'user'} ${message.pending ? 'pending' : ''}" ${message.pending ? 'aria-busy="true"' : ''}>
      <div class="chatMeta">${message.role === 'assistant'
        ? `Kara${message.pending ? ' · kare inceleniyor' : message.visionUsed === true ? ' · kareyi gördü' : message.visionUsed === false ? ' · yalnızca metin bağlamı' : ''}`
        : `Sen · ${escapeHtml(message.timestamp || '')}`}</div>
      <div class="chatContent">
        ${message.pending ? `
          <div class="chatThinking">
            <span>Kara düşünüyor</span>
            <span class="typingDots" aria-hidden="true"><i></i><i></i><i></i></span>
          </div>
        ` : `${renderMathMarkdown(message.content)}${renderKaraMessageExtras(message)}`}
      </div>
    </article>
  `).join('');
  typesetKaraChat();
}

function resetKaraChat() {
  state.karaChat = [];
  els.karaQuestionInput.value = '';
  els.karaTimestamp.textContent = '';
  renderKaraChat();
}

function activeLessonVideo() {
  if (state.liveManim.active && els.liveManimVideo.classList.contains('visible')) {
    return els.liveManimVideo;
  }
  return els.videoOutput;
}

function updateKaraAskVisibility() {
  const visible = activeLessonVideo().classList.contains('visible');
  els.karaAskForm.classList.toggle('hidden', !visible);
  if (!visible) {
    els.karaTimestamp.textContent = '';
  }
}

function updateKaraTimestamp() {
  const hasQuestion = Boolean(els.karaQuestionInput.value.trim());
  els.karaTimestamp.textContent = hasQuestion ? formatTime(currentQuestionTimestamp()) : '';
}

function currentQuestionTimestamp() {
  if (state.liveManim.active) {
    return els.liveManimVideo.currentTime || 0;
  }
  if (state.playback.active) {
    return currentGlobalTime();
  }
  return els.videoOutput.currentTime || 0;
}

function captureVideoFrame() {
  const sourceVideo = activeLessonVideo();
  if (!sourceVideo.classList.contains('visible') || sourceVideo.readyState < 2) {
    throw new Error('Soru sormak icin video karesi hazir degil.');
  }

  const canvas = document.createElement('canvas');
  const sourceWidth = sourceVideo.videoWidth || 1280;
  const sourceHeight = sourceVideo.videoHeight || 720;
  const scale = Math.min(1, 640 / sourceWidth, 360 / sourceHeight);
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Video karesi hazirlanamadi.');
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(sourceVideo, 0, 0, canvas.width, canvas.height);
  return {
    mimeType: 'image/jpeg',
    data: canvas.toDataURL('image/jpeg', 0.68)
  };
}

function compactLessonPlanForKara(plan) {
  if (!plan || typeof plan !== 'object') {
    return null;
  }
  return {
    topic: String(plan.topic || '').slice(0, 240),
    core_insight: String(plan.core_insight || '').slice(0, 600),
    segments: Array.isArray(plan.segments)
      ? plan.segments.slice(0, 10).map((segment) => ({
          id: segment?.id || null,
          title: String(segment?.title || '').slice(0, 160),
          learning_objective: String(segment?.learning_objective || '').slice(0, 240),
          narration: String(segment?.narration || '').slice(0, 320)
        }))
      : []
  };
}

async function submitKaraQuestion(event) {
  event.preventDefault();
  const question = els.karaQuestionInput.value.trim();
  if (!question) {
    els.karaQuestionInput.focus();
    return;
  }

  let frame;
  let timestampSeconds;
  let timestampLabel;
  try {
    timestampSeconds = currentQuestionTimestamp();
    timestampLabel = formatTime(timestampSeconds);
    frame = captureVideoFrame();
  } catch (error) {
    setStatus(error.message, true);
    return;
  }

  const chatHistory = state.karaChat
    .filter((message) => !message.pending)
    .slice(-6)
    .map((message) => ({
      role: message.role,
      timestamp: message.timestamp,
      content: String(message.content || '').slice(0, 1200)
    }));

  els.karaQuestionInput.value = '';
  updateKaraTimestamp();
  state.karaChat.push({ role: 'user', timestamp: timestampLabel, content: question });
  const pendingAnswer = { role: 'assistant', timestamp: timestampLabel, content: 'Dusunuyorum...', pending: true };
  state.karaChat.push(pendingAnswer);
  renderKaraChat();

  els.karaQuestionInput.disabled = true;
  els.karaSendBtn.disabled = true;
  setStatus('Kara soruyu inceliyor...');

  try {
    const data = await api('/api/ask-kara', {
      question,
      frame,
      timestamp_seconds: timestampSeconds,
      timestamp_label: timestampLabel,
      lesson_title: els.lessonTitle.textContent,
      lesson_id: state.lessonId,
      lesson_plan: compactLessonPlanForKara(state.plan),
      chat_history: chatHistory
    });
    pendingAnswer.content = data.answer || 'Bu soruya cevap uretilemedi.';
    pendingAnswer.visionUsed = data.visionUsed === true;
    pendingAnswer.toolsUsed = Array.isArray(data.toolsUsed) ? data.toolsUsed : [];
    pendingAnswer.artifacts = Array.isArray(data.artifacts) ? data.artifacts : [];
    pendingAnswer.sources = Array.isArray(data.sources) ? data.sources : [];
    pendingAnswer.pending = false;
    renderKaraChat();
    const usedTools = pendingAnswer.toolsUsed.length
      ? ` (${pendingAnswer.toolsUsed.join(', ')})`
      : '';
    setStatus(data.visionUsed === true
      ? `Kara video karesini inceleyerek cevap verdi${usedTools}.`
      : 'Kara görsel modele ulaşamadı; metin bağlamıyla cevap verdi.', data.visionUsed !== true);
  } catch (error) {
    pendingAnswer.content = `Cevap alinamadi: ${error.message}`;
    pendingAnswer.pending = false;
    renderKaraChat();
    setStatus(error.message, true);
  } finally {
    els.karaQuestionInput.disabled = false;
    els.karaSendBtn.disabled = false;
    els.karaQuestionInput.focus();
  }
}

function buildKaraLiveWsUrl() {
  const baseUrl = backendRouter.activeBaseUrl || window.location.origin;
  return `${baseUrl.replace(/^http/, 'ws')}/api/kara-live`;
}

function setKaraLiveActive(active) {
  state.karaLive.active = active;
  els.karaLiveBtn.classList.toggle('active', active);
  els.karaLiveBtn.setAttribute('aria-pressed', String(active));
  els.karaLiveBtn.setAttribute('aria-label', active ? 'Sesli konuşmayı bitir' : 'Sesli konuş');
  els.karaQuestionInput.disabled = active;
  els.karaSendBtn.disabled = active;
}

function finalizeLiveMessage(key) {
  const pending = state.karaLive[key];
  state.karaLive[key] = null;
  if (!pending) return;
  if (!(pending.content || '').trim()) {
    state.karaChat = state.karaChat.filter((message) => message !== pending);
  }
}

function finalizeLiveTurn() {
  finalizeLiveMessage('liveUserMessage');
  finalizeLiveMessage('liveAssistantMessage');
  renderKaraChat();
}

function ensureLiveMessage(key, role) {
  if (!state.karaLive[key]) {
    const message = { role, timestamp: formatTime(currentQuestionTimestamp()), content: '', live: true };
    state.karaLive[key] = message;
    state.karaChat.push(message);
  }
  return state.karaLive[key];
}

function handleKaraLiveEvent(event) {
  switch (event.type) {
    case 'ready':
      setStatus('Kara ile sesli baglanti kuruldu; konusabilirsin.');
      break;
    case 'server_content': {
      if (event.inputTranscript) {
        const message = ensureLiveMessage('liveUserMessage', 'user');
        message.content = `${message.content}${event.inputTranscript}`;
        renderKaraChat();
      }
      if (event.outputTranscript) {
        const message = ensureLiveMessage('liveAssistantMessage', 'assistant');
        message.content = `${message.content}${event.outputTranscript}`;
        renderKaraChat();
      }
      if (event.turnComplete) {
        finalizeLiveTurn();
      }
      break;
    }
    case 'tools_executed':
      setStatus(`Kara ${event.names.join(', ')} aracini kullaniyor...`);
      break;
    case 'error':
      setStatus(event.message, true);
      break;
    case 'closed':
      setStatus('Sesli baglanti kapandi.');
      stopKaraLive();
      break;
    default:
      break;
  }
}

async function toggleKaraLive() {
  if (state.karaLive.active) {
    stopKaraLive();
    return;
  }
  if (!state.auth.session?.access_token) {
    setStatus('Sesli konusmak icin giris yapmalisin.', true);
    return;
  }
  if (!state.lessonId) {
    setStatus('Sesli konusmak icin bir ders acik olmali.', true);
    return;
  }

  try {
    const client = new KaraLiveClient({
      wsUrl: buildKaraLiveWsUrl(),
      token: state.auth.session.access_token,
      lessonId: state.lessonId,
      onEvent: handleKaraLiveEvent,
      onError: (error) => setStatus(error.message, true)
    });
    await client.start();
    state.karaLive.client = client;
    setKaraLiveActive(true);
    setStatus('Mikrofon acik; Kara seni dinliyor.');
  } catch (error) {
    setStatus(`Mikrofona erisilemedi: ${error.message}`, true);
    setKaraLiveActive(false);
  }
}

function stopKaraLive() {
  state.karaLive.client?.stop();
  state.karaLive.client = null;
  finalizeLiveTurn();
  setKaraLiveActive(false);
}

function segmentDuration(segment, index) {
  if (Number.isFinite(segment?.durationSeconds)) {
    return segment.durationSeconds;
  }
  if (Number.isFinite(segment?.tts?.durationSeconds)) {
    return segment.tts.durationSeconds;
  }
  if (index === state.playback.currentIndex && Number.isFinite(els.videoOutput.duration)) {
    return els.videoOutput.duration;
  }
  return 0;
}

function elapsedBeforeSegment(index) {
  return state.playback.playable
    .slice(0, Math.max(0, index))
    .reduce((total, segment, segmentIndex) => total + segmentDuration(segment, segmentIndex), 0);
}

function availableDuration() {
  return state.playback.playable
    .reduce((total, segment, index) => total + segmentDuration(segment, index), 0);
}

function currentGlobalTime() {
  if (!state.playback.active || state.playback.currentIndex < 0) {
    return 0;
  }
  return elapsedBeforeSegment(state.playback.currentIndex) + (els.videoOutput.currentTime || 0);
}

function liveTimelineDuration() {
  const manifestDuration = Number(state.developer.lastManifest?.readyDurationSeconds || 0);
  const jobDuration = Number(state.developer.lastJob?.progressive?.readyDurationSeconds || 0);
  const mediaDuration = Number.isFinite(els.liveManimVideo.duration)
    ? Number(els.liveManimVideo.duration)
    : 0;
  return Math.max(manifestDuration, jobDuration, mediaDuration);
}

function renderTimelineSegments(duration, liveVideoActive) {
  if (!duration) {
    els.timelineSegments.replaceChildren();
    return;
  }
  const boundaries = [];
  if (liveVideoActive) {
    let cursor = 0;
    for (const partial of state.developer.lastManifest?.partials || []) {
      cursor += Number(partial.durationSeconds || 0);
      if (cursor > 0 && cursor < duration) boundaries.push(cursor);
    }
  } else if (state.playback.active) {
    let cursor = 0;
    state.playback.playable.slice(0, -1).forEach((segment, index) => {
      cursor += segmentDuration(segment, index);
      if (cursor > 0 && cursor < duration) boundaries.push(cursor);
    });
  }
  els.timelineSegments.replaceChildren(...boundaries.map((boundary) => {
    const marker = document.createElement('span');
    marker.className = 'timelineSegmentMarker';
    marker.style.left = `${Math.min(100, (boundary / duration) * 100)}%`;
    return marker;
  }));
}

function updatePlayerControls() {
  const liveVideoActive = state.liveManim.active && els.liveManimVideo.classList.contains('visible');
  const standaloneVideo = !state.playback.active && els.videoOutput.classList.contains('visible');
  const duration = liveVideoActive
    ? liveTimelineDuration()
    : (standaloneVideo && Number.isFinite(els.videoOutput.duration)
      ? els.videoOutput.duration
      : availableDuration());
  const current = liveVideoActive
    ? Math.min(Number(els.liveManimVideo.currentTime || 0), duration)
    : (standaloneVideo
      ? (els.videoOutput.currentTime || 0)
      : Math.min(currentGlobalTime(), duration));
  const activeVideo = liveVideoActive ? els.liveManimVideo : els.videoOutput;
  els.playerControls.classList.toggle(
    'hidden',
    !liveVideoActive && !state.playback.active && !els.videoOutput.classList.contains('visible')
  );
  els.seekBar.max = String(Math.max(0, duration));
  els.seekBar.value = String(Math.max(0, current));
  els.currentTimeText.textContent = formatTime(current);
  els.durationText.textContent = formatTime(duration);
  els.playPauseBtn.textContent = activeVideo.paused ? 'Oynat' : 'II';
  els.playPauseBtn.setAttribute('aria-label', activeVideo.paused ? 'Oynat' : 'Duraklat');
  renderTimelineSegments(duration, liveVideoActive);
  updateKaraAskVisibility();
  updateKaraTimestamp();
}

function shouldShowPlayerControls() {
  return (
    (state.liveManim.active && els.liveManimVideo.classList.contains('visible'))
    || state.playback.active
    || els.videoOutput.classList.contains('visible')
  );
}

function showPlayerControlsTemporarily() {
  if (!shouldShowPlayerControls()) {
    return;
  }

  els.playerControls.classList.remove('hidden', 'autoHidden');
  clearTimeout(controlsHideTimer);
  controlsHideTimer = setTimeout(() => {
    if (!els.videoOutput.paused && shouldShowPlayerControls()) {
      els.playerControls.classList.add('autoHidden');
    }
  }, 4000);
}

function keepPlayerControlsVisible() {
  clearTimeout(controlsHideTimer);
  if (shouldShowPlayerControls()) {
    els.playerControls.classList.remove('hidden', 'autoHidden');
  }
}

function hidePlayerControlsSoon() {
  clearTimeout(controlsHideTimer);
  controlsHideTimer = setTimeout(() => {
    if (!els.videoOutput.paused && shouldShowPlayerControls()) {
      els.playerControls.classList.add('autoHidden');
    }
  }, 4000);
}

function togglePlayback() {
  if (state.liveManim.active && els.liveManimVideo.classList.contains('visible')) {
    if (els.liveManimVideo.paused) {
      els.liveManimVideo.play().catch(() => {});
    } else {
      els.liveManimVideo.pause();
    }
    updatePlayerControls();
    return;
  }
  if (!state.playback.active && state.playback.playable.length) {
    state.playback.userPaused = false;
    playSegmentAt(0);
    return;
  }

  if (!els.videoOutput.classList.contains('visible')) {
    return;
  }

  if (els.videoOutput.paused) {
    state.playback.userPaused = false;
    els.videoOutput.play().catch(() => {});
  } else {
    state.playback.userPaused = true;
    els.videoOutput.pause();
  }
  updatePlayerControls();
  showPlayerControlsTemporarily();
}

function skipPlayback(seconds) {
  if (!els.videoOutput.classList.contains('visible')) {
    return;
  }
  const base = state.playback.active ? currentGlobalTime() : (els.videoOutput.currentTime || 0);
  seekToGlobalTime(base + seconds);
  showPlayerControlsTemporarily();
}

async function toggleFullscreen() {
  const target = document.querySelector('.videoShell');
  if (!document.fullscreenElement) {
    await target.requestFullscreen?.();
    return;
  }
  await document.exitFullscreen?.();
}

function setDownloadVideo(videoUrl) {
  if (!videoUrl) {
    els.downloadVideoBtn.classList.add('hidden');
    els.downloadVideoBtn.removeAttribute('href');
    els.saveToDriveBtn.classList.add('hidden');
    return;
  }
  els.downloadVideoBtn.href = videoUrl;
  els.downloadVideoBtn.classList.remove('hidden');
  els.saveToDriveBtn.classList.toggle('hidden', !state.googleDriveEnabled);
}

const DRIVE_PENDING_SAVE_KEY = 'karaPendingDriveSaveLessonId';

async function saveLessonToDrive(lessonId) {
  if (!lessonId) return;
  els.saveToDriveBtn.disabled = true;
  const originalText = els.saveToDriveBtn.textContent;
  els.saveToDriveBtn.textContent = 'Yükleniyor...';
  try {
    const data = await api(`/api/lessons/${encodeURIComponent(lessonId)}/save-to-drive`, {});
    setStatus("Video Drive'a kaydedildi.");
    if (data.webViewLink) {
      window.open(data.webViewLink, '_blank', 'noopener');
    }
  } catch (error) {
    if (error.details?.code === 'drive_not_connected') {
      localStorage.setItem(DRIVE_PENDING_SAVE_KEY, lessonId);
      setStatus('Google Drive bağlanıyor...');
      try {
        const connect = await apiGet('/api/auth/oauth/google-drive');
        if (connect.url) {
          window.location.assign(connect.url);
          return;
        }
      } catch (connectError) {
        localStorage.removeItem(DRIVE_PENDING_SAVE_KEY);
        setStatus(connectError.message, true);
      }
    } else {
      setStatus(error.message, true);
    }
  } finally {
    els.saveToDriveBtn.disabled = false;
    els.saveToDriveBtn.textContent = originalText;
  }
}

async function completeDriveConnectIfNeeded(redirect) {
  if (!redirect.isDriveConnect || !redirect.providerRefreshToken) return;
  try {
    await api('/api/auth/google-drive-token', { refresh_token: redirect.providerRefreshToken });
    const pendingLessonId = localStorage.getItem(DRIVE_PENDING_SAVE_KEY);
    localStorage.removeItem(DRIVE_PENDING_SAVE_KEY);
    if (pendingLessonId) {
      await saveLessonToDrive(pendingLessonId);
    } else {
      setStatus('Google Drive bağlandı.');
    }
  } catch (error) {
    setStatus(`Google Drive bağlanamadı: ${error.message}`, true);
  }
}

function resetLiveManimStream() {
  progressiveManimPlayer.stop();
  state.liveManim = {
    active: false,
    enabled: false,
    failed: false,
    browserFailed: false,
    jobId: null,
    streamUrl: null,
    manifestLoading: false,
    manifestPromise: null,
    manifestDirty: false,
    introDurationSeconds: 0,
    handoffSeconds: 0,
    lastPlaybackSeconds: 0
  };
  els.liveManimVideo.classList.remove('visible');
}

function seekToGlobalTime(seconds) {
  if (state.liveManim.active && els.liveManimVideo.classList.contains('visible')) {
    els.liveManimVideo.currentTime = Math.max(0, Math.min(Number(seconds) || 0, liveTimelineDuration()));
    updatePlayerControls();
    return;
  }
  if (!state.playback.active && els.videoOutput.classList.contains('visible')) {
    els.videoOutput.currentTime = Math.max(0, Math.min(Number(seconds) || 0, els.videoOutput.duration || 0));
    updatePlayerControls();
    return;
  }

  const target = Math.max(0, Math.min(Number(seconds) || 0, availableDuration()));
  let cursor = 0;

  for (let index = 0; index < state.playback.playable.length; index += 1) {
    const duration = segmentDuration(state.playback.playable[index], index);
    if (target <= cursor + duration || index === state.playback.playable.length - 1) {
      playSegmentAt(index, Math.max(0, target - cursor), !els.videoOutput.paused);
      return;
    }
    cursor += duration;
  }
}

function resetProgressivePlayback() {
  state.playback = {
    active: false,
    currentIndex: -1,
    playable: [],
    finalVideoUrl: null,
    waitingForNext: false,
    userPaused: false
  };
  els.videoOutput.pause();
  els.videoOutput.removeAttribute('src');
  els.videoOutput.removeAttribute('data-lesson-id');
  els.videoOutput.load();
  els.videoOutput.classList.remove('visible');
  resetLiveManimStream();
  els.preloadVideo.removeAttribute('src');
  els.preloadVideo.load();
  els.liveStreamBadge.classList.add('hidden');
  els.liveStreamText.textContent = 'İlk bölüm hazırlanıyor';
  stopPreparingProgress();
  clearTimeout(controlsHideTimer);
  els.playerControls.classList.add('hidden');
  els.playerControls.classList.remove('autoHidden');
  els.seekBar.value = '0';
  els.seekBar.max = '0';
  els.currentTimeText.textContent = '0:00';
  els.durationText.textContent = '0:00';
  els.timelineSegments.replaceChildren();
  setDownloadVideo(null);
  setVideoOverlay('', false);
  updateKaraAskVisibility();
  resetDeveloperConsole();
}

function absoluteVideoUrl(videoUrl) {
  return apiUrl(videoUrl);
}

function updatePlayableSegments(job) {
  state.playback.playable = (job.segments || [])
    .map((segment, index) => ({ ...segment, index }))
    .filter((segment) => segment.videoUrl);
  if (job.result?.videoUrl) {
    state.playback.finalVideoUrl = job.result.videoUrl;
  }
  updatePlayerControls();
}

function playSegmentAt(index, startTime = 0, shouldPlay = true) {
  const segment = state.playback.playable[index];
  if (!segment) {
    state.playback.waitingForNext = true;
    setVideoOverlay('Sonraki bolum hazirlaniyor...');
    return;
  }

  const targetUrl = absoluteVideoUrl(segment.videoUrl);
  const sourceChanged = els.videoOutput.getAttribute('src') !== targetUrl;
  state.playback.active = true;
  state.playback.waitingForNext = false;
  state.playback.currentIndex = index;
  stopPreparingProgress({ complete: true });
  showPlayerControlsTemporarily();
  const applyStartTime = () => {
    if (Number.isFinite(startTime) && startTime > 0) {
      els.videoOutput.currentTime = Math.min(startTime, els.videoOutput.duration || startTime);
    }
    updatePlayerControls();
    if (shouldPlay && !state.playback.userPaused) {
      els.videoOutput.play().catch(() => {
        setVideoOverlay('Video hazir. Oynatmak icin play tusuna basin.');
      });
    }
  };
  const activateTarget = () => {
    if (els.liveManimVideo.classList.contains('visible')) {
      resetLiveManimStream();
    }
    els.videoOutput.classList.add('visible');
    setVideoOverlay('', false);
    applyStartTime();
  };

  if (sourceChanged) {
    setVideoLoading(true, 'Hazır bölüm arka planda yükleniyor...');
    els.videoOutput.addEventListener('canplay', activateTarget, { once: true });
    els.videoOutput.src = targetUrl;
    els.videoOutput.load();
  } else {
    activateTarget();
  }
  preloadNextSegment();
  updatePlayerControls();
}

function preloadNextSegment() {
  const next = state.playback.playable[state.playback.currentIndex + 1];
  if (!next) {
    els.preloadVideo.removeAttribute('src');
    els.preloadVideo.load();
    return;
  }
  els.preloadVideo.src = absoluteVideoUrl(next.videoUrl);
  els.preloadVideo.load();
}

function maybeStartOrContinuePlayback() {
  if (
    state.liveManim.active
    || (
      state.liveManim.enabled
      && !state.liveManim.failed
      && !state.liveManim.browserFailed
    )
  ) {
    return;
  }
  if (!state.playback.active && state.playback.playable.length) {
    const handoffSeconds = Math.max(0, Number(state.liveManim.handoffSeconds || 0));
    if (handoffSeconds > 0) {
      let cursor = 0;
      for (let index = 0; index < state.playback.playable.length; index += 1) {
        const duration = segmentDuration(state.playback.playable[index], index);
        if (handoffSeconds <= cursor + duration) {
          playSegmentAt(
            index,
            Math.min(
              Math.max(0, handoffSeconds - cursor),
              Math.max(0, duration - 0.25)
            )
          );
          return;
        }
        cursor += duration;
      }
      // The archive has not caught up with the live playback position yet.
      // Preserve the last live frame instead of replaying the newest segment.
      setVideoLoading(false);
      setVideoOverlay('Hazır video aynı noktaya yetişiyor; son kare korunuyor.');
      return;
    }
    playSegmentAt(0, 0);
    return;
  }

  if (state.playback.waitingForNext) {
    const nextIndex = state.playback.currentIndex + 1;
    if (state.playback.playable[nextIndex]) {
      playSegmentAt(nextIndex);
      return;
    }
  }

  preloadNextSegment();
}

function renderSettingsPanel() {
  els.settingsDefaultLevel.value = state.settings.level;
  els.settingsDefaultMinutes.value = state.settings.targetMinutes ?? '';
  els.settingsDefaultSegments.value = state.settings.targetSegments ?? '';
  els.settingsDefaultPrior.value = state.settings.priorKnowledge;
  els.settingsTtsVoice.value = state.settings.ttsVoice;
  els.settingsSpeechVolume.value = state.settings.speechVolume;
  els.settingsMusicVolume.value = state.settings.musicVolume;
}

function applyLessonDefaultsToForm() {
  if (state.settings.level) {
    els.levelInput.value = state.settings.level;
  }
  if (state.settings.targetMinutes && !els.targetMinutesInput.dataset.touched) {
    els.targetMinutesInput.value = state.settings.targetMinutes;
  }
  if (state.settings.targetSegments && !els.targetSegmentsInput.dataset.touched) {
    els.targetSegmentsInput.value = state.settings.targetSegments;
  }
  if (state.settings.priorKnowledge) {
    els.priorInput.value = state.settings.priorKnowledge;
  }
}

function ttsOptionsPayload() {
  return {
    tts_voice: state.settings.ttsVoice,
    speech_volume: state.settings.speechVolume,
    background_music_volume: state.settings.musicVolume
  };
}

function readSettingsFromPanel() {
  return {
    level: els.settingsDefaultLevel.value,
    targetMinutes: els.settingsDefaultMinutes.value ? Number(els.settingsDefaultMinutes.value) : null,
    targetSegments: els.settingsDefaultSegments.value ? Number(els.settingsDefaultSegments.value) : null,
    priorKnowledge: els.settingsDefaultPrior.value,
    ttsVoice: els.settingsTtsVoice.value,
    speechVolume: Number(els.settingsSpeechVolume.value),
    musicVolume: Number(els.settingsMusicVolume.value)
  };
}

[
  els.settingsDefaultLevel,
  els.settingsDefaultMinutes,
  els.settingsDefaultSegments,
  els.settingsDefaultPrior,
  els.settingsTtsVoice,
  els.settingsSpeechVolume,
  els.settingsMusicVolume
].forEach((input) => {
  input.addEventListener('change', () => {
    state.settings = readSettingsFromPanel();
    saveSettings(state.settings);
    applyLessonDefaultsToForm();
  });
});

els.settingsResetBtn.addEventListener('click', () => {
  state.settings = { ...DEFAULT_SETTINGS };
  saveSettings(state.settings);
  renderSettingsPanel();
  applyLessonDefaultsToForm();
  setStatus('Ayarlar varsayilana dondu.');
});

renderSettingsPanel();
applyLessonDefaultsToForm();

async function loadConfig() {
  const response = await backendRouter.request(apiUrl('/api/config'), { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Backend ayarlari alinamadi (${response.status}).`);
  }
  const config = await response.json();
  state.auth.googleOAuthEnabled = Boolean(config.googleOAuthEnabled);
  state.googleDriveEnabled = Boolean(config.googleDriveEnabled);
  state.karaLiveEnabled = Boolean(config.karaLiveEnabled);
  els.karaLiveBtn.classList.toggle('hidden', !state.karaLiveEnabled);
  els.configText.textContent = `${(config.llmProvider || 'LLM').toUpperCase()} | Plan ${config.planModel} | Kod ${config.codeModel} | ${config.targetVideoMinutes || 10} dk/${config.targetSegmentCount || 8} segment | TTS ${config.ttsProvider || 'TTS'} ${config.ttsVoice || 'yok'} | Manim ${config.manimQuality} | Font ${config.manimFont || 'varsayilan'}`;
  if (config.targetVideoMinutes && !els.targetMinutesInput.dataset.touched) {
    els.targetMinutesInput.value = config.targetVideoMinutes;
  }
  if (config.targetSegmentCount && !els.targetSegmentsInput.dataset.touched) {
    els.targetSegmentsInput.value = config.targetSegmentCount;
  }
  if (!config.hasApiKey) {
    const keyName = config.llmProvider === 'groq' ? 'GROQ_API_KEY' : 'GEMINI_API_KEY';
    setStatus(`.env icinde ${keyName} bekleniyor`, true);
  } else if (!config.hasTtsCredentials) {
    setStatus(`${config.ttsProvider || 'TTS'} kimlik bilgileri eksik`, true);
  }
  return config;
}

async function initAuth(config = {}) {
  loadStoredAuthSession();
  const redirect = consumeAuthRedirect();
  setAuthMode(redirect.isRecovery ? 'update-password' : 'login');

  if (!config.authRequired) {
    saveAuthSession(null);
    showApp();
    return;
  }

  if (redirect.error) {
    saveAuthSession(null);
    showAuth(`Bağlantı geçersiz veya süresi dolmuş: ${redirect.error}`, true);
    return;
  }

  if (redirect.isRecovery) {
    showAuth('Yeni şifreni belirleyebilirsin.');
    return;
  }

  if (!state.auth.session?.access_token) {
    showAuth(redirect.isConfirmed ? 'E-posta adresin doğrulandı. Şimdi giriş yapabilirsin.' : '');
    return;
  }

  try {
    const data = await authApi('/api/auth/me', null, { method: 'GET' });
    state.auth.profile = data.profile || state.auth.profile;
    saveAuthSession(state.auth.session, state.auth.profile);
    showApp();
    void completeDriveConnectIfNeeded(redirect);
  } catch {
    if (state.auth.session?.refresh_token) {
      try {
        const refreshed = await authApi('/api/auth/refresh', {
          refresh_token: state.auth.session.refresh_token
        });
        if (refreshed.session) {
          saveAuthSession(refreshed.session, refreshed.profile);
          showApp();
          return;
        }
      } catch {
        // Fall through to login.
      }
    }
    saveAuthSession(null);
    showAuth('Lutfen giris yap.', false);
  }
}

els.generatePlanBtn.addEventListener('click', async () => {
  const topic = els.topicInput.value.trim();
  let questionImage = null;
  try {
    questionImage = await selectedQuestionImagePayload();
  } catch (error) {
    setStatus(error.message, true);
    return;
  }

  if (!topic && !questionImage) {
    setStatus('Konu girin.', true);
    els.topicInput.focus();
    return;
  }

  setBusy(els.generatePlanBtn, true, 'Olusturuluyor');
  setStatus(questionImage ? 'Gemini soru fotografini cozumluyor...' : 'Gemini plan uretiyor...');
  const initialTitle = questionImage ? 'Soru çözümü hazırlanıyor' : topic;
  els.lessonTitle.textContent = initialTitle;
  showStudio();
  els.logOutput.textContent = '';
  els.videoOutput.classList.remove('visible');
  els.renderMeta.textContent = '';
  state.lessonId = null;
  resetProgressivePlayback();
  resetKaraChat();
  startPreparingProgress(initialTitle);

  try {
    if (!questionImage) {
      const job = await api('/api/generate-lesson', {
        topic,
        student_level: els.levelInput.value,
        target_video_minutes: Number(els.targetMinutesInput.value || 10),
        target_segment_count: Number(els.targetSegmentsInput.value || 8),
        duration_touched: Boolean(els.targetMinutesInput.dataset.touched || els.targetSegmentsInput.dataset.touched),
        prior_knowledge: els.priorInput.value,
        interrupt_question: els.interruptInput.value.trim() || null,
        ...ttsOptionsPayload()
      });
      backendRouter.setLocked(true);
      state.plan = job.plan || {
        topic,
        estimated_duration_minutes: Number(els.targetMinutesInput.value || 10),
        segments: []
      };
      state.lessonId = job.lessonId || job.plan?._lesson_id || null;
      state.selectedSegment = state.plan.segments?.[0] || null;
      state.speechBySegment = new Map();
      els.lessonTitle.textContent = state.plan.topic || initialTitle;
      renderPlan(state.plan);
      renderSegments();
      renderSegmentDetail();
      els.codeOutput.value = '';
      els.renderBtn.disabled = true;
      els.generateCodeBtn.disabled = true;
      els.liveStreamBadge.classList.remove('hidden');
      applyFullVideoJobUpdate(job);
      setStatus('İlk segment alındı; video üretimi başladı, kalan plan arkada tamamlanıyor.');
      refreshLessonHistory().catch(() => {});
      void monitorFullLessonJob(job);
      return;
    }

    const data = await api('/api/question-plan', {
      image: questionImage,
      student_level: els.levelInput.value,
      note: topic
    });
    backendRouter.setLocked(true);
    state.plan = data.plan;
    state.lessonId = data.lessonId || data.plan?._lesson_id || null;
    refreshLessonHistory().catch(() => {});
    state.selectedSegment = data.plan?.segments?.[0] || null;
    state.speechBySegment = new Map();
    els.lessonTitle.textContent = data.plan?.topic || initialTitle;
    renderPlan(state.plan);
    renderSegments();
    renderSegmentDetail();
    renderSpeech();
    els.codeOutput.value = '';
    els.renderBtn.disabled = true;
    setStatus('Plan hazir. Tam ders otomatik baslatiliyor...');
    startFullLessonGeneration();
  } catch (error) {
    stopPreparingProgress({ error: error.message });
    setStatus(error.message, true);
  } finally {
    setBusy(els.generatePlanBtn, false);
  }
});

async function buildSegmentAssets(segment) {
  setStatus(`${segment.id}: Gemini speech metni uretiyor...`);
  const speechData = await api('/api/speech-script', { segment });

    setStatus(`${segment.id}: Google Cloud TTS ses uretiyor...`);
  const ttsData = await api('/api/tts', {
    text: speechData.speech.speech_text,
    segment_id: segment.id
  });

  const speechState = {
    speech: speechData.speech,
    audioUrl: ttsData.audioUrl,
    audioRelativePath: ttsData.audioRelativePath,
    durationSeconds: ttsData.durationSeconds,
    voiceName: ttsData.usedFallback ? `${ttsData.voiceName} (fallback)` : ttsData.voiceName,
    voiceId: ttsData.voiceId
  };
  state.speechBySegment.set(segment.id, speechState);
  renderSpeech();

  setStatus(`${segment.id}: Manim kodu konusma suresine gore uretiliyor...`);
  const codeData = await api('/api/manim-code', {
    animation: segment.animation,
    duration_seconds: Math.max(6, Math.round(ttsData.durationSeconds)),
    speech: {
      speech_text: speechData.speech.speech_text,
      duration_seconds: ttsData.durationSeconds,
      cue_plan: speechData.speech.cue_plan || []
    },
    segment_id: segment.id
  });

  return {
    code: codeData.code,
    speechState
  };
}

els.generateCodeBtn.addEventListener('click', async () => {
  const segment = state.selectedSegment;
  if (!segment) return;

  setBusy(els.generateCodeBtn, true, 'Uretiliyor');
  els.codeOutput.value = '';
  els.renderBtn.disabled = true;

  try {
    const { code } = await buildSegmentAssets(segment);
    els.codeOutput.value = code;
    els.renderBtn.disabled = false;
    setStatus('Manim kodu hazir.');
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(els.generateCodeBtn, false);
    els.generateCodeBtn.disabled = !state.selectedSegment;
  }
});

els.generateFullBtn.addEventListener('click', startFullLessonGeneration);

async function pollFullVideoJob(jobId) {
  while (true) {
    const response = await authorizedFetch(apiUrl(`/api/jobs/${jobId}`));
    const job = await response.json();
    if (!response.ok) {
      throw new Error(job.error || 'Job durumu okunamadi.');
    }

    applyFullVideoJobUpdate(job);

    if (job.status === 'done') {
      setDownloadVideo(job.result?.videoUrl);
      return job;
    }

    if (job.status === 'failed') {
      throw new Error(job.error || 'Tam ders uretimi basarisiz oldu.');
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

function applyFullVideoJobUpdate(job) {
  const incomingPlanCount = job.plan?.segments?.length || 0;
  const currentPlanCount = state.plan?.segments?.length || 0;
  // Segments stream in one at a time (count strictly increases) until the
  // backend's fullPlanReadyTask swaps job.plan for the fully re-normalized
  // plan (server.js's runFullVideoJob, job.plan = fullPlan) -- at that swap
  // the segment count is usually unchanged (every segment was already
  // streamed individually), so the count-only check below would otherwise
  // silently skip picking up that corrected, final plan.
  const fullPlanReadyAt = job.timings?.fullPlanReadyAt || null;
  const fullPlanJustReady = Boolean(fullPlanReadyAt) && fullPlanReadyAt !== state.lastFullPlanReadyAt;
  if (incomingPlanCount > currentPlanCount || fullPlanJustReady) {
    state.lastFullPlanReadyAt = fullPlanReadyAt || state.lastFullPlanReadyAt;
    const selectedId = state.selectedSegment?.id;
    state.plan = job.plan;
    state.lessonId = job.plan?._lesson_id || state.lessonId;
    state.selectedSegment = job.plan.segments.find((segment) => segment.id === selectedId)
      || job.plan.segments[0]
      || null;
    els.lessonTitle.textContent = job.plan.topic || els.lessonTitle.textContent;
    renderPlan(state.plan);
    renderSegments();
    renderSegmentDetail();
  }
  updateStreamingPreparation(job);
  updateLiveManimFromJob(job);
  updatePlayableSegments(job);
  maybeStartOrContinuePlayback();
  const liveManimRunning = state.liveManim.active && !els.liveManimVideo.ended;
  els.liveStreamBadge.classList.toggle(
    'hidden',
    hasVisibleVideo()
      || job.status === 'failed'
      || (job.status === 'done' && !liveManimRunning)
  );
  els.liveStreamText.textContent = job.progressive?.enabled
    ? liveProductionText(job)
    : `${job.progress}/${job.total} bölüm hazır${job.current ? ` · ${job.current}` : ''}`;
  state.developer.lastJob = job;
  appendDeveloperEvent('job', job.current || job.message || job.status, {
    status: job.status,
    progress: job.progress,
    total: job.total,
    progressiveStatus: job.progressive?.status || 'disabled',
    readyCount: Number(job.progressive?.readyCount || 0)
  });
  setStatus(job.progressive?.readyCount
    ? `${Math.floor(job.progressive.readyDurationSeconds || 0)} saniye hazır | ${job.current || job.status}`
    : streamingPreparationMessage(job));
}

function updateLiveManimFromJob(job) {
  const progressive = job.progressive;
  state.liveManim.enabled = Boolean(progressive?.enabled);
  state.liveManim.failed = progressive?.status === 'failed';
  if (state.liveManim.browserFailed) return;
  if (!state.liveManim.enabled) {
    if (!state.liveManim.active) maybeStartOrContinuePlayback();
    return;
  }
  if (state.liveManim.failed) {
    // Do not reset the MediaSource here: doing so zeroes currentTime before
    // the stream reader/ended event can capture the handoff position.
    if (state.liveManim.active && Number(progressive?.readyCount || 0) > 0) {
      // The failed manifest is marked complete by the backend. Sync it once so
      // MediaSource.endOfStream() fires instead of leaving the last frame frozen.
      void syncProgressiveManifest(job);
    }
    if (Number(progressive?.readyCount || 0) === 0) {
      state.liveManim.active = false;
      els.liveManimVideo.classList.remove('visible');
    }
    if (!state.liveManim.active) maybeStartOrContinuePlayback();
    return;
  }

  const sourceChanged = state.liveManim.jobId !== job.id;
  if (sourceChanged) {
    state.liveManim.jobId = job.id;
    state.liveManim.streamUrl = `/api/jobs/${encodeURIComponent(job.id)}/stream-manifest`;
    progressiveManimPlayer.start({
      jobId: job.id,
      lessonId: job.lessonId || state.lessonId,
      bufferTargetSeconds: Math.max(0, Number(progressive.bufferTargetSeconds || 0))
    });
  }
  state.liveManim.active = true;
  els.videoOutput.pause();
  els.videoOutput.classList.remove('visible');
  setVideoOverlay(
    progressive.status === 'ready' ? '' : streamingPreparationMessage(job),
    progressive.status !== 'ready'
  );
  void syncProgressiveManifest(job);
}

function syncProgressiveManifest(job) {
  if (
    state.liveManim.jobId !== job.id
    || !state.liveManim.streamUrl
  ) return Promise.resolve();
  if (state.liveManim.manifestPromise) {
    state.liveManim.manifestDirty = true;
    return state.liveManim.manifestPromise;
  }
  state.liveManim.manifestDirty = false;
  state.liveManim.manifestLoading = true;
  const manifestPromise = (async () => {
    const response = await authorizedFetch(apiUrl(state.liveManim.streamUrl), {
      cache: 'no-store',
    });
    const manifest = await response.json();
    if (!response.ok) {
      throw new Error(manifest.error || 'Progressive video manifesti alınamadı.');
    }
    if (state.liveManim.jobId !== job.id || state.lessonId !== manifest.lessonId) return;
    manifest.partials = (manifest.partials || []).map((partial) => ({
      ...partial,
      url: apiUrl(partial.url)
    }));
    const previousPartialCount = state.developer.lastManifest?.partials?.length || 0;
    state.developer.lastManifest = manifest;
    if (manifest.partials.length !== previousPartialCount) {
      appendDeveloperEvent('manifest', 'Canlı manifest güncellendi.', {
        partials: manifest.partials.length,
        readyDurationSeconds: manifest.readyDurationSeconds,
        complete: manifest.complete
      });
    } else {
      renderDeveloperConsole();
    }
    updatePlayerControls();
    await progressiveManimPlayer.sync(manifest);
  })().catch((error) => {
    failLiveManimPlayback(error);
  }).finally(() => {
    state.liveManim.manifestLoading = false;
    if (state.liveManim.manifestPromise === manifestPromise) {
      state.liveManim.manifestPromise = null;
      if (state.liveManim.manifestDirty && state.liveManim.jobId === job.id) {
        state.liveManim.manifestDirty = false;
        queueMicrotask(() => void syncProgressiveManifest(job));
      }
    }
  });
  state.liveManim.manifestPromise = manifestPromise;
  return manifestPromise;
}

async function streamFullVideoJob(jobId, { afterEventId = 0, reconnectAttempt = 0 } = {}) {
  const response = await authorizedFetch(apiUrl(`/api/jobs/${jobId}/events`), {
    headers: {
      Accept: 'text/event-stream',
      ...(afterEventId ? { 'Last-Event-ID': String(afterEventId) } : {})
    }
  });
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Canlı üretim bağlantısı kurulamadı.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let lastEventId = Number(afterEventId || 0);

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    let boundary = buffer.indexOf('\n\n');

    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const eventIdLine = block.split('\n').find((line) => line.startsWith('id:'));
      if (eventIdLine) {
        lastEventId = Number(eventIdLine.slice(3).trim()) || lastEventId;
      }
      const dataText = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (dataText) {
        const job = JSON.parse(dataText);
        applyFullVideoJobUpdate(job);
        if (job.status === 'done') {
          await syncProgressiveManifest(job);
          await syncProgressiveManifest(job);
          await reader.cancel().catch(() => {});
          setDownloadVideo(job.result?.videoUrl);
          return job;
        }
        if (job.status === 'failed') {
          const error = new Error(job.error || 'Tam ders üretimi başarısız oldu.');
          error.jobFailed = true;
          throw error;
        }
      }
      boundary = buffer.indexOf('\n\n');
    }

    if (done) {
      if (reconnectAttempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 500 * (reconnectAttempt + 1)));
        return streamFullVideoJob(jobId, {
          afterEventId: lastEventId,
          reconnectAttempt: reconnectAttempt + 1
        });
      }
      throw new Error('Canlı üretim bağlantısı tamamlanmadan kapandı.');
    }
  }
}

async function waitForFullVideoJob(jobId) {
  try {
    return await streamFullVideoJob(jobId);
  } catch (error) {
    if (error.jobFailed) throw error;
    appendDeveloperEvent('network', 'Canlı bağlantı kesildi; durum sorgulamasına geçildi.', {
      message: error.message
    });
    return pollFullVideoJob(jobId);
  }
}

els.renderBtn.addEventListener('click', async () => {
  const code = els.codeOutput.value.trim();
  if (!code) {
    setStatus('Manim kodu bos.', true);
    return;
  }

  setBusy(els.renderBtn, true, 'Render');
  setStatus('Manim render ve ses birlestirme calisiyor...');
  els.logOutput.textContent = '';
  els.videoOutput.classList.remove('visible');
  els.renderMeta.textContent = '';
  resetProgressivePlayback();
  startPreparingProgress(els.lessonTitle.textContent);

  try {
    const speechState = state.selectedSegment?.id
      ? state.speechBySegment.get(state.selectedSegment.id)
      : null;
    const data = await api('/api/render', {
      code,
      segment_id: state.selectedSegment?.id || 's1',
      audioRelativePath: speechState?.audioRelativePath || null
    });
    stopPreparingProgress({ complete: true });
    els.videoOutput.src = cacheBustUrl(data.videoUrl);
    els.videoOutput.classList.add('visible');
    showPlayerControlsTemporarily();
    state.playback.active = false;
    els.logOutput.textContent = [data.stdout, data.stderr].filter(Boolean).join('\n');
    els.renderMeta.textContent = data.hasMusic
      ? (data.hasAudio ? 'Sesli + Muzik' : 'Muzikli')
      : (data.hasAudio ? 'Sesli' : 'Sessiz');
    setStatus(data.hasMusic
      ? `Video hazir. Muzik: ${data.backgroundMusic}`
      : (data.hasAudio ? 'Sesli video hazir.' : 'Video hazir.'));
    updatePlayerControls();
  } catch (error) {
    stopPreparingProgress({ error: error.message });
    els.logOutput.textContent = [error.message, error.details?.stdout, error.details?.stderr]
      .filter(Boolean)
      .join('\n\n');
    setStatus(error.message, true);
  } finally {
    setBusy(els.renderBtn, false);
    els.renderBtn.disabled = !els.codeOutput.value.trim();
  }
});

els.codeOutput.addEventListener('input', () => {
  els.renderBtn.disabled = !els.codeOutput.value.trim();
});

els.videoOutput.addEventListener('ended', () => {
  if (!state.playback.active) {
    return;
  }
  const nextIndex = state.playback.currentIndex + 1;
  if (state.playback.playable[nextIndex]) {
    playSegmentAt(nextIndex, 0, !state.playback.userPaused);
    return;
  }
  if (state.playback.finalVideoUrl && nextIndex >= state.playback.playable.length) {
    setVideoOverlay('Ders tamamlandi. Tam video hazir.', false);
    updatePlayerControls();
    return;
  }
  state.playback.waitingForNext = true;
  setVideoOverlay('Sonraki bolum hazirlaniyor...');
  updatePlayerControls();
});

els.videoOutput.addEventListener('timeupdate', updatePlayerControls);
els.videoOutput.addEventListener('loadedmetadata', updatePlayerControls);
els.videoOutput.addEventListener('durationchange', updatePlayerControls);
els.videoOutput.addEventListener('loadstart', () => {
  if (els.videoOutput.classList.contains('visible')) {
    setVideoLoading(true);
  }
});
els.videoOutput.addEventListener('waiting', () => {
  setVideoLoading(true, 'Video devam etmek için hazırlanıyor...');
});
els.videoOutput.addEventListener('stalled', () => {
  setVideoLoading(true, 'Bağlantı bekleniyor...');
});
els.videoOutput.addEventListener('loadeddata', () => setVideoLoading(false));
els.videoOutput.addEventListener('canplay', () => setVideoLoading(false));
els.videoOutput.addEventListener('playing', () => setVideoLoading(false));
els.videoOutput.addEventListener('error', () => setVideoLoading(false));
els.videoOutput.addEventListener('play', () => {
  state.playback.userPaused = false;
  stopPreparingProgress({ complete: true });
  els.liveStreamBadge.classList.add('hidden');
  setVideoOverlay('', false);
  updatePlayerControls();
  showPlayerControlsTemporarily();
});
els.videoOutput.addEventListener('pause', () => {
  updatePlayerControls();
  keepPlayerControlsVisible();
});

els.videoOutput.addEventListener('click', () => {
  togglePlayback();
});

els.liveManimVideo.addEventListener('loadstart', () => {
  setVideoLoading(true, 'Gerçek 720p30 Manim parçaları bağlanıyor...');
});
els.liveManimVideo.addEventListener('waiting', () => {
  progressiveManimPlayer.markBuffering();
});
els.liveManimVideo.addEventListener('canplay', () => setVideoLoading(false));
els.liveManimVideo.addEventListener('playing', () => {
  stopPreparingProgress({ complete: true });
  els.liveStreamBadge.classList.add('hidden');
  setVideoLoading(false);
  setVideoOverlay('', false);
  updateKaraAskVisibility();
});
els.liveManimVideo.addEventListener('timeupdate', () => {
  const currentTime = Number(els.liveManimVideo.currentTime || 0);
  if (Number.isFinite(currentTime) && currentTime > state.liveManim.lastPlaybackSeconds) {
    state.liveManim.lastPlaybackSeconds = currentTime;
  }
  updatePlayerControls();
});
els.liveManimVideo.addEventListener('ended', () => {
  if (state.liveManim.failed || state.liveManim.browserFailed) {
    failLiveManimPlayback(new Error('Canlı akışın kullanılabilir kısmı tamamlandı.'));
    return;
  }
  // Keep the completed MediaSource video as the active player so the frame
  // never disappears and the user can replay it without switching elements.
  state.liveManim.active = true;
  els.liveStreamBadge.classList.add('hidden');
  setVideoOverlay(
    'Canlı ders tamamlandı ve gördüğün görüntü final video olarak kaydedildi. Tekrar oynatmak için videoya dokun.',
    false
  );
  updateKaraAskVisibility();
  updatePlayerControls();
});
els.liveManimVideo.addEventListener('error', () => {
  if (!els.liveManimVideo.getAttribute('src')) return;
  failLiveManimPlayback(els.liveManimVideo.error);
});
els.liveManimVideo.addEventListener('click', () => {
  if (els.liveManimVideo.paused) {
    els.liveManimVideo.play().catch(() => {});
  } else {
    els.liveManimVideo.pause();
  }
  updatePlayerControls();
});
els.liveManimVideo.addEventListener('play', updatePlayerControls);
els.liveManimVideo.addEventListener('pause', updatePlayerControls);
els.liveManimVideo.addEventListener('durationchange', updatePlayerControls);

document.querySelector('.videoShell').addEventListener('mousemove', showPlayerControlsTemporarily);
document.querySelector('.videoShell').addEventListener('mouseleave', hidePlayerControlsSoon);
els.playerControls.addEventListener('mouseenter', keepPlayerControlsVisible);
els.playerControls.addEventListener('mouseleave', hidePlayerControlsSoon);

els.playPauseBtn.addEventListener('click', () => {
  togglePlayback();
});

els.seekBar.addEventListener('input', () => {
  keepPlayerControlsVisible();
  seekToGlobalTime(els.seekBar.value);
});

els.fullscreenBtn.addEventListener('click', () => {
  showPlayerControlsTemporarily();
  toggleFullscreen().catch(() => {});
});

els.authModeBtn.addEventListener('click', () => {
  setAuthMode(state.auth.mode === 'login' ? 'signup' : 'login');
});

els.forgotPasswordBtn.addEventListener('click', () => {
  setAuthMode('reset');
});

els.googleAuthBtn.addEventListener('click', async () => {
  els.googleAuthBtn.disabled = true;
  els.authSubmitBtn.disabled = true;
  els.authModeBtn.disabled = true;
  els.forgotPasswordBtn.disabled = true;
  els.authMessage.classList.remove('error', 'success');
  els.authMessage.textContent = 'Google güvenli giriş sayfasına yönlendiriliyorsun...';

  try {
    const data = await authApi('/api/auth/oauth/google', null, { method: 'GET' });
    if (!data.url) {
      throw new Error('Google giriş adresi alınamadı.');
    }
    window.location.assign(data.url);
  } catch (error) {
    els.authMessage.textContent = error.message;
    els.authMessage.classList.add('error');
    els.googleAuthBtn.disabled = false;
    els.authSubmitBtn.disabled = false;
    els.authModeBtn.disabled = false;
    els.forgotPasswordBtn.disabled = false;
  }
});

els.historyList.addEventListener('click', (event) => {
  const deleteButton = event.target.closest('button[data-delete-lesson-id]');
  if (deleteButton) {
    void handleDeleteLesson(deleteButton.dataset.deleteLessonId);
    return;
  }
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.newLesson) {
    beginNewLesson();
    return;
  }
  if (button.dataset.lessonId) {
    void loadLessonFromHistory(button.dataset.lessonId);
    return;
  }
  if (button.dataset.cardNew) {
    window.dispatchEvent(new CustomEvent('kara:card-new-session'));
    return;
  }
  if (button.dataset.cardSessionId) {
    window.dispatchEvent(new CustomEvent('kara:open-card-session', { detail: { sessionId: button.dataset.cardSessionId } }));
    return;
  }
  if (button.dataset.katalogExplore) {
    window.dispatchEvent(new CustomEvent('kara:katalog-explore'));
    return;
  }
  if (button.dataset.katalogLessonId) {
    const chat = (state.katalogChats || []).find((item) => item.lessonId === button.dataset.katalogLessonId);
    window.dispatchEvent(new CustomEvent('kara:open-catalog-chat', {
      detail: {
        lessonId: button.dataset.katalogLessonId,
        title: chat?.title || chat?.topic || 'Ders',
        posterUrl: chat?.posterUrl || null
      }
    }));
  }
});

els.logoHomeBtn.addEventListener('click', () => {
  if (state.activeSection !== 'karatahta') {
    state.activeSection = 'karatahta';
    updateSectionNav();
    renderSectionHistory();
  }
  beginNewLesson();
});
els.karatahtaNavBtn.addEventListener('click', () => {
  if (state.activeSection !== 'karatahta') {
    state.activeSection = 'karatahta';
    updateSectionNav();
    renderSectionHistory();
    state.lessonId ? showStudio() : showHome();
  }
});
els.cardNavBtn.addEventListener('click', () => setActiveSection('card'));
els.katalogNavBtn.addEventListener('click', () => setActiveSection('katalog'));
els.settingsNavBtn.addEventListener('click', () => setActiveSection('settings'));

els.historyList.addEventListener('input', (event) => {
  if (event.target?.id !== 'lessonSearchInput') {
    return;
  }
  state.lessonSearch = event.target.value;
  renderLessonHistory();
  const searchInput = document.querySelector('#lessonSearchInput');
  searchInput?.focus();
  searchInput?.setSelectionRange(state.lessonSearch.length, state.lessonSearch.length);
});

els.authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = els.authEmailInput.value.trim();
  const password = els.authPasswordInput.value;
  const displayName = els.authNameInput.value.trim();
  const mode = state.auth.mode;
  const isSignup = mode === 'signup';
  els.authSubmitBtn.disabled = true;
  els.googleAuthBtn.disabled = true;
  els.authModeBtn.disabled = true;
  els.forgotPasswordBtn.disabled = true;
  els.authMessage.classList.remove('error', 'success');

  try {
    if (mode === 'reset') {
      els.authMessage.textContent = 'Bağlantı gönderiliyor...';
      const data = await authApi('/api/auth/password-reset', { email });
      els.authMessage.textContent = `${data.message || 'Sıfırlama bağlantısı e-postana gönderildi.'} Gelen kutunda yoksa spam veya gereksiz klasörünü kontrol et.`;
      els.authMessage.classList.add('success');
      return;
    }

    if (mode === 'update-password') {
      els.authMessage.textContent = 'Şifren güncelleniyor...';
      await authApi('/api/auth/password-update', { password });
      els.authMessage.textContent = 'Şifren güncellendi. Hesabın açılıyor...';
      els.authMessage.classList.add('success');
      const data = await authApi('/api/auth/me', null, { method: 'GET' });
      state.auth.profile = data.profile || state.auth.profile;
      saveAuthSession(state.auth.session, state.auth.profile);
      showApp();
      setStatus('Hazır');
      return;
    }

    els.authMessage.textContent = isSignup ? 'Hesabın oluşturuluyor...' : 'Giriş yapılıyor...';
    const data = await authApi(isSignup ? '/api/auth/signup' : '/api/auth/login', {
      email,
      password,
      display_name: displayName
    });
    if (!data.session?.access_token) {
      setAuthMode('login');
      showAuth('Hesabın oluşturuldu. E-postandaki doğrulama bağlantısına tıkla. Gelen kutunda yoksa spam veya gereksiz klasörünü kontrol et.', false);
      els.authMessage.classList.add('success');
      return;
    }
    saveAuthSession(data.session, data.profile);
    showApp();
    setStatus('Hazir');
  } catch (error) {
    els.authMessage.textContent = error.message;
    els.authMessage.classList.add('error');
  } finally {
    els.authSubmitBtn.disabled = false;
    els.googleAuthBtn.disabled = false;
    els.authModeBtn.disabled = false;
    els.forgotPasswordBtn.disabled = false;
  }
});

els.logoutBtn.addEventListener('click', () => {
  saveAuthSession(null);
  state.lessons = [];
  resetProgressivePlayback();
  backendRouter.setLocked(false);
  stopKaraLive();
  resetKaraChat();
  showHome();
  showAuth('Cikis yapildi.', false);
});

els.karaLiveBtn.addEventListener('click', toggleKaraLive);
els.saveToDriveBtn.addEventListener('click', () => saveLessonToDrive(state.lessonId));
els.karaQuestionInput.addEventListener('input', updateKaraTimestamp);
els.karaAskForm.addEventListener('submit', submitKaraQuestion);

for (const input of els.backendModeInputs) {
  input.addEventListener('change', async () => {
    if (!input.checked) return;
    try {
      backendRouter.setMode(input.value);
      setStatus(`${backendLabel(backendRouter.activeKey)} backend'i seçildi.`);
      const config = await loadConfig();
      state.auth.googleOAuthEnabled = Boolean(config.googleOAuthEnabled);
      if (state.auth.session?.access_token) {
        await refreshLessonHistory();
      }
      if (backendRouter.mode === 'hybrid') {
        await backendRouter.checkHealth();
      }
    } catch (error) {
      renderBackendPortal();
      setStatus(error.message, true);
    }
  });
}

els.backendHealthBtn.addEventListener('click', async () => {
  els.backendHealthBtn.disabled = true;
  els.backendHealthBtn.textContent = 'Test ediliyor...';
  try {
    await backendRouter.checkHealth();
    const snapshot = backendRouter.snapshot();
    const onlineCount = Object.values(snapshot.health).filter((health) => health?.online).length;
    setStatus(`${onlineCount}/2 backend erişilebilir. Aktif: ${backendLabel(snapshot.activeKey)}.`);
  } finally {
    els.backendHealthBtn.disabled = false;
    els.backendHealthBtn.textContent = 'Bağlantıları test et';
  }
});

els.topicInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.shiftKey) {
    return;
  }
  event.preventDefault();
  if (!els.generatePlanBtn.disabled) {
    els.generatePlanBtn.click();
  }
});

document.addEventListener('keydown', (event) => {
  const tagName = event.target?.tagName?.toLowerCase();
  const isTyping = ['input', 'textarea', 'select', 'button', 'a'].includes(tagName) || event.target?.isContentEditable;
  if (isTyping) {
    return;
  }

  if (event.code === 'Space') {
    event.preventDefault();
    togglePlayback();
    showPlayerControlsTemporarily();
    return;
  }

  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    skipPlayback(-5);
    return;
  }

  if (event.key === 'ArrowRight') {
    event.preventDefault();
    skipPlayback(5);
  }
});

[els.targetMinutesInput, els.targetSegmentsInput].forEach((input) => {
  input.addEventListener('input', () => {
    input.dataset.touched = 'true';
  });
});

document.querySelectorAll('[data-level]').forEach((button) => {
  button.addEventListener('click', () => {
    els.levelInput.value = button.dataset.level;
    setActiveChip('[data-level]', button);
  });
});

document.querySelectorAll('[data-minutes]').forEach((button) => {
  button.addEventListener('click', () => {
    els.targetMinutesInput.value = button.dataset.minutes;
    els.targetSegmentsInput.value = button.dataset.segments;
    els.targetMinutesInput.dataset.touched = 'true';
    els.targetSegmentsInput.dataset.touched = 'true';
    setActiveChip('[data-minutes]', button);
  });
});

document.querySelectorAll('[data-topic]').forEach((button) => {
  button.addEventListener('click', () => {
    els.topicInput.value = button.dataset.topic;
    els.topicInput.focus();
  });
});

els.questionImageInput.addEventListener('change', () => {
  const file = els.questionImageInput.files?.[0];
  if (!file) {
    clearQuestionImage();
    return;
  }
  els.questionImageName.textContent = file.name;
  els.clearQuestionImageBtn.classList.remove('hidden');
  setStatus('Soru fotoğrafı eklendi.');
});

els.clearQuestionImageBtn.addEventListener('click', clearQuestionImage);

els.backHomeBtn.addEventListener('click', () => {
  resetProgressivePlayback();
  showHome();
  setStatus('Hazır');
});

loadConfig()
  .then((config) => initAuth(config))
  .catch((error) => {
    showAuth(error.message, true);
    setStatus(error.message, true);
  });

void backendRouter.checkHealth();
window.setInterval(() => {
  if (backendRouter.mode === 'hybrid' && !backendRouter.locked) {
    void backendRouter.checkHealth();
  }
}, 30000);

export {};
