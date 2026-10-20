import { renderGenerationSite, loadAllSites } from '../generation/panel.js';
const box = document.getElementById('genSite');
const page = location.pathname.split('/').pop() || 'index.html';
loadAllSites('assets/data/').then(data => {
  if (!box) return;
  const shown = data && renderGenerationSite(box, data, { page });
  const w = box.closest('.gen-case'); if (w) w.hidden = !shown;
}).catch(() => { const w = box && box.closest('.gen-case'); if (w) w.hidden = true; });
