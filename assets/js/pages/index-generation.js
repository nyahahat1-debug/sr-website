import { renderGenerationOverview } from '../generation/panel.js';
const sec = document.getElementById('generation');
fetch('assets/data/generation.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(d => {
  if (!sec) return;
  const shown = d && renderGenerationOverview(document.getElementById('genHome'), d);
  sec.hidden = !shown;
  document.querySelectorAll('#generation .reveal').forEach(e => e.classList.add('in'));
}).catch(() => { if (sec) sec.hidden = true; });
