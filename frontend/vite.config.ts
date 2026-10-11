import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Backend the dev server proxies /api and /renders to. Read from .env or
  // the shell; never baked into the production bundle.
  const backendUrl = loadEnv(mode, '.', '').KARA_BACKEND_URL || 'http://localhost:8080';

  return {
    plugins: [react()],
    build: {
      target: 'es2022',
      cssCodeSplit: true,
      sourcemap: false
    },
    server: {
      host: '0.0.0.0',
      port: 3001,
      proxy: {
        '/api': {
          target: backendUrl,
          changeOrigin: true
        },
        '/renders': {
          target: backendUrl,
          changeOrigin: true
        }
      }
    },
    preview: {
      host: '0.0.0.0',
      port: 3001
    }
  };
});
