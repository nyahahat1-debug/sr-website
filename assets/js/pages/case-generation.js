import { renderGenerationSite } from '../generation/panel.js';
const box = document.getElementById('genSite');
const page = location.pathname.split('/').pop() || 'index.html';
fetch('assets/data/generation.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(d => {
  if (!box) return;
  const shown = d && renderGenerationSite(box, d, { page });
  box.closest('.gen-case').hidden = !shown;
}).catch(() => { const w = box && box.closest('.gen-case'); if (w) w.hidden = true; });
