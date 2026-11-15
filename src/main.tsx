import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

// Google Maps Platform Case A Two-Tier Quota Defense (Tier 1)
(window as unknown as { gm_authFailure?: () => void }).gm_authFailure = () => {
  window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
};

const isExtensionNoise = (text: string) =>
  text.includes('chrome-extension://') ||
  text.includes('moz-extension://') ||
  text.includes('safari-extension://') ||
  text.includes('Failed to connect to MetaMask');

const origConsoleError = console.error;
console.error = (...args: unknown[]) => {
  const msg = args
    .map((a) => (a instanceof Error ? `${a.message} ${a.stack ?? ''}` : String(a)))
    .join(' ');
  if (isExtensionNoise(msg)) {
    return;
  }
  origConsoleError.apply(console, args);
  if (msg.includes('OverQuotaMapError') || msg.includes('QuotaExceededError')) {
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
  }
};

registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
