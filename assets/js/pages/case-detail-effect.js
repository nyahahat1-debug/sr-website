// 효성 전주공장 — 실측 발전량 기준 월별 경제효과 (전기요금 절감 + 온실가스 감축 + 배출권 가치)
import { summarize } from '../economics/selfuse.js';
import { TARIFF_SOURCE } from '../economics/tariff.js';

const root = document.getElementById('hyEffect');
const h = (tag, cls, ...kids) => { const el = document.createElement(tag); if (cls) el.className = cls; for (const k of kids) el.append(k); return el; };
const won = v => Math.round(v).toLocaleString('ko-KR') + '원';
const man = v => { const m = v / 1e4; return m >= 10000 ? (m / 1e4).toLocaleString('ko-KR', { maximumFractionDigits: 2 }) + '억 원' : Math.round(m).toLocaleString('ko-KR') + '만 원'; };
const kwh = v => Math.round(v).toLocaleString('ko-KR') + ' kWh';
const t2 = v => v.toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' t';
const ymText = ym => `${ym.slice(0, 4)}.${ym.slice(5, 7)}`;

Promise.all([
  fetch('assets/data/hyosung-generation.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null),
  fetch('assets/data/carbon.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null),
]).then(([gen, carbon]) => {
  if (!root || !gen || !Array.isArray(gen.months) || !gen.months.length) return;
  const price = carbon && carbon.latest && carbon.latest.price ? carbon.latest.price : null;
  const months = gen.months.filter(x => /^\d{4}-\d{2}$/.test(x.m) && x.kwh > 0).sort((a, b) => a.m.localeCompare(b.m)).map(x => ({ kwh: x.kwh, ym: x.m, tariffId: gen.tariffId, partial: !!x.partial }));
  const S = summarize(months, price || 0);
  S.rows.forEach((r, i) => { r.partial = months[i].partial; });
  const last = S.rows[S.rows.length - 1];
  root.innerHTML = '';

  // 머리: 기준 시세·요금제 (+ 실시간 값이 있으면)
  const L = gen.live || null;
  root.append(h('div', 'hy-basis',
    h('span', '', `요금제 ${last.tariff}`),
    h('span', '', price ? `배출권 ${carbon.latest.name} ${price.toLocaleString('ko-KR')}원/t (${carbon.latest.date})` : '배출권 시세 없음 — 가치 미산정'),
    h('span', '', `배출계수 0.4567 tCO₂/MWh · 기금 ${(last.fundRate * 100).toFixed(1)}%`),
    ...(L && L.todayKwh != null ? [h('span', '', `실시간: 오늘 ${kwh(L.todayKwh)} · 이달 ${kwh(L.monthKwh || 0)} · 올해 ${kwh(L.yearKwh || 0)}`)] : [])));

  // 표
  const table = h('table', 'hy-table');
  table.append(h('thead', '', h('tr', '', ...['월', '실측 발전량', '전기요금 절감', '온실가스 감축', '배출권 가치', '경제효과 합계'].map(x => h('th', '', x)))));
  const tb = h('tbody');
  for (const r of S.rows) {
    tb.append(h('tr', '', h('td', '', ymText(r.ym) + (r.partial ? ' (집계 중)' : '')), h('td', 'num', kwh(r.kwh)), h('td', 'num', man(r.total)), h('td', 'num', t2(r.co2T)), h('td', 'num', price ? man(r.carbonKrw) : '—'), h('td', 'num hi', man(r.benefit))));
  }
  table.append(tb);
  const tf = h('tfoot', '', h('tr', '', h('td', '', `누적 ${S.months}개월`), h('td', 'num', kwh(S.kwh)), h('td', 'num', man(S.total)), h('td', 'num', t2(S.co2T)), h('td', 'num', price ? man(S.carbonKrw) : '—'), h('td', 'num hi', man(S.benefit))));
  table.append(tf);
  root.append(h('div', 'hy-scroll', table));

  // 최근 달 내역
  const d = h('div', 'hy-detail');
  d.append(h('div', 'hy-dt', `${ymText(last.ym)} 산정 내역`));
  const rows = [
    [`경부하 × ${last.rates.light}원`, `${kwh(last.bands.light.kwh)} · ${won(last.bands.light.krw)}`],
    [`중간부하 × ${last.rates.mid}원`, `${kwh(last.bands.mid.kwh)} · ${won(last.bands.mid.krw)}`],
    [`최대부하 × ${last.rates.peak}원`, `${kwh(last.bands.peak.kwh)} · ${won(last.bands.peak.krw)}`],
    ['기후환경요금 + 연료비조정액', won(last.climate + last.fuel)],
    [`부가세 10% + 기금 ${(last.fundRate * 100).toFixed(1)}%`, won(last.vat + last.fund)],
    ['전기요금 절감 소계', won(last.total) + ` (kWh당 ${last.effectiveRate.toFixed(1)}원)`],
    ['온실가스 감축 × 배출권 시세', price ? `${t2(last.co2T)} × ${price.toLocaleString('ko-KR')}원 = ${won(last.carbonKrw)}` : t2(last.co2T)],
  ];
  for (const [k, v] of rows) d.append(h('div', 'hy-row', h('span', 'k', k), h('span', 'v', v)));
  root.append(d);
  root.append(h('p', 'hy-note', `* 발전량은 월별 실측치이고, 시간대 배분은 해당 월의 태양광 발전 시간 분포로 추정한 값입니다. 요금 단가는 ${TARIFF_SOURCE} 기준이며, 기후환경요금 9원·연료비조정액 5원/kWh 는 가정값입니다. 배출권 가치는 감축량에 시세를 곱한 환산액으로 실제 판매 수익이 아닙니다. 출처: 한국거래소 배출권시장.`));
  const wrap = root.closest('.hy-effect'); if (wrap) wrap.hidden = false;
}).catch(() => {});
