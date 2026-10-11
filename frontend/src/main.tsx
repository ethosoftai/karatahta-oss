import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/base.css';
import './styles/theme.css';

// Empty means same-origin: the Vite dev proxy (or a reverse proxy in front of
// the production build) forwards /api and /renders to the backend.
const railwayApiBaseUrl = (
  import.meta.env.VITE_API_BASE_URL
  || window.KARA_API_BASE_URL
  || ''
).replace(/\/$/, '');

window.KARA_API_BASE_URL = railwayApiBaseUrl;
window.KARA_BACKEND_URLS = {
  railway: railwayApiBaseUrl,
  // Optional second backend for the developer portal's VPS/hybrid modes.
  // Falls back to the primary backend so every mode works with one server.
  vps: (import.meta.env.VITE_VPS_API_BASE_URL || railwayApiBaseUrl).replace(/\/$/, '')
};

window.MathJax = {
  tex: {
    inlineMath: [['\\(', '\\)'], ['$', '$']],
    displayMath: [['\\[', '\\]'], ['$$', '$$']]
  },
  options: {
    skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code']
  }
};

const root = document.querySelector<HTMLDivElement>('#root');

if (!root) {
  throw new Error('Kara Tahta root elementi bulunamadı.');
}

createRoot(root).render(<App />);
