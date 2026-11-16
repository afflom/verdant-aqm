import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(<App />);

if (
  import.meta.env.PROD &&
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  window.self === window.top
) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', {scope: './'}).catch(() => {
      // Ignore registration failures on non-HTTPS local file previews.
    });
  });
}
