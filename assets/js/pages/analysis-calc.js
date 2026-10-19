import { mountCalculator } from '../economics/ui.js';
const q = new URLSearchParams(location.search);
mountCalculator(document.getElementById('ecCalc'), { prefill: { capacityKw: +q.get('kw') || 500, mode: q.get('mode') === 'sell' ? 'sell' : 'self', tariffId: q.get('tariff') || undefined, preset: q.get('preset') || undefined } });
