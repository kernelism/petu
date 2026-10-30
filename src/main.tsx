import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
// The board's figure face (src/svgboard/style.ts FONT_FIGURE) and the landing headline, bundled: no font CDN.
import '@fontsource-variable/source-serif-4/opsz.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
