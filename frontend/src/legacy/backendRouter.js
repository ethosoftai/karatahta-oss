export const BACKEND_MODES = Object.freeze({
  RAILWAY: 'railway',
  VPS: 'vps',
  HYBRID: 'hybrid'
});

const VALID_MODES = new Set(Object.values(BACKEND_MODES));
const RETRYABLE_STATUS_CODES = new Set([502, 503, 504]);

export function normalizeBackendMode(value) {
  return VALID_MODES.has(value) ? value : BACKEND_MODES.RAILWAY;
}

export function normalizeBackendTargets(targets) {
  return {
    railway: String(targets?.railway || '').replace(/\/$/, ''),
    vps: String(targets?.vps || '').replace(/\/$/, '')
  };
}

export function initialBackendKey(mode) {
  return mode === BACKEND_MODES.RAILWAY ? 'railway' : 'vps';
}

export function alternateBackendKey(key) {
  return key === 'vps' ? 'railway' : 'vps';
}

export function isSafeFailoverRequest(method = 'GET') {
  return ['GET', 'HEAD', 'OPTIONS'].includes(String(method || 'GET').toUpperCase());
}

export function shouldFailoverResponse(response, method = 'GET') {
  return isSafeFailoverRequest(method) && RETRYABLE_STATUS_CODES.has(Number(response?.status));
}

export class BackendRouter {
  constructor({
    targets,
    storage = null,
    storageKey = 'karaBackendMode',
    fetcher = (...args) => fetch(...args),
    onChange = () => {}
  }) {
    this.targets = normalizeBackendTargets(targets);
    this.storage = storage;
    this.storageKey = storageKey;
    this.fetcher = fetcher;
    this.onChange = onChange;
    this.mode = normalizeBackendMode(this.storage?.getItem?.(this.storageKey));
    this.activeKey = initialBackendKey(this.mode);
    this.locked = false;
    this.health = { railway: null, vps: null };
  }

  get activeBaseUrl() {
    return this.targets[this.activeKey];
  }

  setMode(mode) {
    const normalized = normalizeBackendMode(mode);
    if (this.locked && normalized !== this.mode) {
      throw new Error('Aktif ders bitmeden altyapi modu degistirilemez. Once Yeni ders secin.');
    }
    this.mode = normalized;
    this.activeKey = initialBackendKey(normalized);
    this.storage?.setItem?.(this.storageKey, normalized);
    this.emitChange('mode');
    return this.snapshot();
  }

  setLocked(locked) {
    this.locked = Boolean(locked);
    this.emitChange('lock');
  }

  resolve(path, key = this.activeKey) {
    if (!path || /^https?:\/\//i.test(String(path))) return path;
    const suffix = String(path).startsWith('/') ? path : `/${path}`;
    return `${this.targets[key]}${suffix}`;
  }

  keyForUrl(url) {
    const value = String(url || '');
    return Object.entries(this.targets).find(([, baseUrl]) => (
      value === baseUrl || value.startsWith(`${baseUrl}/`)
    ))?.[0] || null;
  }

  switchTo(key, reason = 'failover') {
    if (!this.targets[key] || this.activeKey === key) return;
    this.activeKey = key;
    this.emitChange(reason);
  }

  async request(input, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const matchedKey = this.keyForUrl(input);
    const externallyHosted = /^https?:\/\//i.test(String(input || '')) && !matchedKey;
    const originalKey = matchedKey || this.activeKey;
    const relativePath = matchedKey
      ? String(input).slice(this.targets[originalKey].length)
      : input;
    const firstUrl = this.resolve(relativePath, originalKey);

    try {
      const response = await this.fetcher(firstUrl, options);
      if (
        !externallyHosted
        && this.mode === BACKEND_MODES.HYBRID
        && !this.locked
        && shouldFailoverResponse(response, method)
      ) {
        const fallbackKey = alternateBackendKey(originalKey);
        const fallbackResponse = await this.fetcher(this.resolve(relativePath, fallbackKey), options);
        if (fallbackResponse.ok || !RETRYABLE_STATUS_CODES.has(fallbackResponse.status)) {
          this.switchTo(fallbackKey, 'failover');
        }
        return fallbackResponse;
      }
      return response;
    } catch (error) {
      if (
        externallyHosted
        || this.mode !== BACKEND_MODES.HYBRID
        || this.locked
        || !isSafeFailoverRequest(method)
      ) {
        throw error;
      }
      const fallbackKey = alternateBackendKey(originalKey);
      const response = await this.fetcher(this.resolve(relativePath, fallbackKey), options);
      this.switchTo(fallbackKey, 'failover');
      return response;
    }
  }

  async checkHealth({ timeoutMs = 5000 } = {}) {
    const checks = await Promise.all(Object.entries(this.targets).map(async ([key, baseUrl]) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const startedAt = Date.now();
      try {
        const response = await this.fetcher(`${baseUrl}/api/config?health=${Date.now()}`, {
          cache: 'no-store',
          signal: controller.signal
        });
        return [key, {
          online: response.ok,
          status: response.status,
          latencyMs: Date.now() - startedAt
        }];
      } catch (error) {
        return [key, {
          online: false,
          status: null,
          latencyMs: Date.now() - startedAt,
          error: error?.name === 'AbortError' ? 'timeout' : String(error?.message || error)
        }];
      } finally {
        clearTimeout(timer);
      }
    }));
    this.health = Object.fromEntries(checks);

    if (this.mode === BACKEND_MODES.HYBRID && !this.locked) {
      if (this.health.vps?.online) {
        this.switchTo('vps', 'health');
      } else if (this.health.railway?.online) {
        this.switchTo('railway', 'health');
      }
    }
    this.emitChange('health');
    return this.health;
  }

  snapshot() {
    return {
      mode: this.mode,
      activeKey: this.activeKey,
      activeBaseUrl: this.activeBaseUrl,
      locked: this.locked,
      health: { ...this.health }
    };
  }

  emitChange(reason) {
    this.onChange(this.snapshot(), reason);
  }
}
