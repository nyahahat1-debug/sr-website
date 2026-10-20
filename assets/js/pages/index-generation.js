import { renderGenerationOverview, loadAllSites } from '../generation/panel.js';
const sec = document.getElementById('generation');
loadAllSites('assets/data/').then(data => {
  if (!sec) return;
  const shown = data && renderGenerationOverview(document.getElementById('genHome'), data);
  sec.hidden = !shown;
  document.querySelectorAll('#generation .reveal').forEach(e => e.classList.add('in'));
}).catch(() => { if (sec) sec.hidden = true; });
