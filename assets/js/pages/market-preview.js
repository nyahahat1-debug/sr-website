import { renderMarketChart } from '../market/chart.js';
const data = await fetch('assets/data/market.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null) || await fetch('assets/data/market.sample.json', { cache: 'no-cache' }).then(r => r.json());
renderMarketChart(document.getElementById('mkDark'), data, { theme: 'dark', initial: 'smpDaily' });
renderMarketChart(document.getElementById('mkLight'), data, { theme: 'light', initial: 'rec' });
