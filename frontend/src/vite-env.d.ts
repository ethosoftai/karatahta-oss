/// <reference types="vite/client" />

declare global {
  interface Window {
    KARA_API_BASE_URL?: string;
    KARA_BACKEND_URLS?: {
      railway: string;
      vps: string;
    };
    MathJax?: {
      tex?: Record<string, unknown>;
      options?: Record<string, unknown>;
      typesetPromise?: (elements?: Element[]) => Promise<void>;
    };
    __KARA_LEGACY_LOADED__?: boolean;
    KARA_AUTH?: {
      getAccessToken: () => string | null;
    };
  }
}

export {};
