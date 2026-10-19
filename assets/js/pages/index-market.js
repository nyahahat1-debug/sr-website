import { renderMarketChart, renderMarketSummary } from '../market/chart.js';
const mkSec = document.getElementById('market');
fetch('assets/data/market.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(d => {
  if (!d) { if (mkSec) mkSec.hidden = true; return; }
  renderMarketSummary(document.getElementById('mkHomeSum'), d, { theme: 'dark' });
  renderMarketChart(document.getElementById('mkHome'), d, { theme: 'dark', initial: 'smpDaily' });
}).catch(() => { if (mkSec) mkSec.hidden = true; });
