import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installTypeAhead, typeSink } from './ui/typeAhead';
// The board's figure face (src/svgboard/style.ts FONT_FIGURE) and the landing headline, bundled: no font CDN.
import '@fontsource-variable/source-serif-4/opsz.css';

// Before any key handler the app adds: typing without the bar focused goes to the bar (ui/typeAhead.ts).
installTypeAhead(window, typeSink);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
