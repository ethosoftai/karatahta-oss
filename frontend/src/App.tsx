import { useEffect } from 'react';
import { AuthGate } from './components/AuthGate';
import { WelcomeTour } from './components/WelcomeTour';
import { Workspace } from './components/Workspace';

function loadMathJax() {
  if (document.querySelector('script[data-kara-mathjax]')) {
    return;
  }
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js';
  script.defer = true;
  script.dataset.karaMathjax = 'true';
  document.head.append(script);
}

export function App() {
  useEffect(() => {
    const mathJaxTimer = window.setTimeout(loadMathJax, 2500);
    if (!window.__KARA_LEGACY_LOADED__) {
      window.__KARA_LEGACY_LOADED__ = true;
      void import('./legacy/app.js');
    }
    return () => window.clearTimeout(mathJaxTimer);
  }, []);

  return (
    <>
      <AuthGate />
      <Workspace />
      <WelcomeTour />
    </>
  );
}
