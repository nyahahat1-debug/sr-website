// ─────────────────────────────────────────────────────────────
// 발전 현황 패널 — assets/data/generation.json (HI SMART 수집) 을 읽어 표시
//   renderGenerationOverview(el, data)           : 메인 — 합계 + 현장 카드
//   renderGenerationSite(el, data, { page })     : 현장 상세 페이지 — 해당 현장 한 곳
// 숫자는 카운트업 없이 바로 표시, 하루 출력 곡선은 SVG (CSS 애니메이션만 사용)
// ─────────────────────────────────────────────────────────────
const CSS = `
.gn{--gn-ink:#0D1B2A;--gn-muted:#546E7A;--gn-line:#C8D8E8;--gn-sky:#0077B6;--gn-sun:#E8A317;--gn-bg:#F7FAFC;font-family:'Pretendard Variable','Pretendard',system-ui,sans-serif;color:var(--gn-ink)}
.gn-tot{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:1px solid var(--gn-line);border-radius:6px;background:var(--gn-bg);overflow:hidden}
.gn-t{padding:16px 18px 14px;min-width:0}
.gn-t+.gn-t{border-left:1px solid var(--gn-line)}
.gn-k{font-size:12.5px;font-weight:600;color:var(--gn-muted)}
.gn-v{font-family:'IBM Plex Mono',monospace;font-size:clamp(24px,2.6vw,32px);font-weight:600;letter-spacing:-.02em;line-height:1.1;margin-top:8px;font-variant-numeric:tabular-nums;white-space:nowrap}
.gn-v i{font-style:normal;font-family:inherit;font-size:12.5px;font-weight:500;color:var(--gn-muted);margin-left:4px}
.gn-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-top:14px}
.gn-c{border:1px solid var(--gn-line);border-radius:6px;background:var(--gn-bg);padding:16px 18px 14px;display:flex;flex-direction:column;gap:6px;min-width:0;text-decoration:none;color:inherit}
a.gn-c:hover{border-color:var(--gn-sky)}
.gn-cl{font-size:12px;color:var(--gn-muted)}
.gn-cn{font-size:16px;font-weight:800;letter-spacing:-.01em;line-height:1.3}
.gn-cs{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--gn-muted);margin-top:2px}
.gn-dot{width:7px;height:7px;border-radius:50%;background:#2E9E5B;flex:none}
.gn-dot.off{background:#B0BEC5}
.gn-row{display:flex;justify-content:space-between;gap:10px;font-size:13px;color:var(--gn-muted);border-top:1px solid var(--gn-line);padding-top:8px;margin-top:4px}
.gn-row b{font-family:'IBM Plex Mono',monospace;font-weight:600;color:var(--gn-ink);font-variant-numeric:tabular-nums}
.gn-svg{display:block;width:100%;height:auto;margin-top:6px}
.gn-area{fill:rgba(0,119,182,.14)}
.gn-path{fill:none;stroke:var(--gn-sky);stroke-width:1.8;stroke-linejoin:round;stroke-linecap:round;stroke-dasharray:var(--len);stroke-dashoffset:var(--len);animation:gnDraw 1.4s cubic-bezier(.23,1,.32,1) .2s forwards}
.gn-ax{fill:var(--gn-muted);font-size:9.5px;font-family:'IBM Plex Mono',monospace}
.gn-foot{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:10px;font-size:11.5px;color:var(--gn-muted);line-height:1.5}
.gn-site{border:1px solid var(--gn-line);border-radius:6px;background:var(--gn-bg);padding:18px 20px 14px}
.gn-site .gn-tot{border:0;border-radius:0;background:transparent;grid-template-columns:repeat(4,minmax(0,1fr))}
.gn-site .gn-t{padding:4px 14px 4px 0}
.gn-site .gn-t+.gn-t{padding-left:14px}
.gn-site .gn-v{font-size:clamp(20px,2.2vw,26px)}
.gn-site-h{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:12px}
.gn-site-h h3{font-size:15px;font-weight:800;letter-spacing:-.01em}
@keyframes gnDraw{to{stroke-dashoffset:0}}
@media(max-width:860px){.gn-grid{grid-template-columns:1fr}.gn-tot,.gn-site .gn-tot{grid-template-columns:repeat(2,minmax(0,1fr))}.gn-t:nth-child(3){border-left:0!important;border-top:1px solid var(--gn-line)}.gn-t:nth-child(4){border-top:1px solid var(--gn-line)}}
@media(prefers-reduced-motion:reduce){.gn-path{animation:none;stroke-dashoffset:0}}
`;
function injectCSS() { if (document.getElementById('gn-css')) return; const s = document.createElement('style'); s.id = 'gn-css'; s.textContent = CSS; document.head.appendChild(s); }
const h = (tag, attrs = {}, ...kids) => { const el = tag.includes(':') ? document.createElementNS('http://www.w3.org/2000/svg', tag.split(':')[1]) : document.createElement(tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); for (const k of kids) el.append(k); return el; };
const svgEl = (t, a = {}) => h('svg:' + t, a);
const fmt0 = v => (v == null ? '—' : Math.round(v).toLocaleString('ko-KR'));
const fmtCap = v => (v == null ? '—' : Number.isInteger(v) ? fmt0(v) : Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 2 }));
const fmt1 = v => (v == null ? '—' : Number(v).toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const kwh = v => (v == null ? '—' : v >= 10000 ? (v / 1000).toLocaleString('ko-KR', { maximumFractionDigits: 1 }) + ' MWh' : fmt0(v) + ' kWh');
const whenText = d => { const t = new Date(d.updated); return isNaN(t) ? '' : `${t.getMonth() + 1}.${t.getDate()} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')} 기준`; };

/** 오늘 20분 단위 출력(kW) 곡선 — 05:00~21:40 */
function sparkline(site, W = 320, H = 88) {
  const kw = (site.daySeries && site.daySeries.kw) || [], ts = (site.daySeries && site.daySeries.t) || [];
  const L = 6, R = 6, T = 10, B = 16;
  const svg = svgEl('svg', { class: 'gn-svg', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${site.name} 오늘 출력 곡선` });
  if (kw.length < 2) { svg.append(Object.assign(svgEl('text', { class: 'gn-ax', x: L, y: H / 2 }), { textContent: '오늘 계측값 없음' })); return svg; }
  // 세로축: 오늘 최고 출력의 1.15배 (최소 용량의 10%) — 아침에도 곡선 모양이 보이도록
  const max = Math.max(Math.max(...kw) * 1.15, (site.capacityKw || 0) * 0.1) || 1;
  const px = i => L + (W - L - R) * i / (kw.length - 1), py = v => T + (H - T - B) * (1 - v / max);
  let d = `M${px(0).toFixed(1)},${py(kw[0]).toFixed(1)}`;
  for (let i = 1; i < kw.length; i++) d += ` L${px(i).toFixed(1)},${py(kw[i]).toFixed(1)}`;
  svg.append(svgEl('path', { class: 'gn-area', d: d + ` L${px(kw.length - 1).toFixed(1)},${H - B} L${L},${H - B} Z` }));
  const path = svgEl('path', { class: 'gn-path', d }); svg.append(path);
  for (const i of [0, Math.floor((kw.length - 1) / 2), kw.length - 1]) {
    const tx = svgEl('text', { class: 'gn-ax', x: px(i).toFixed(1), y: H - 4, 'text-anchor': i === 0 ? 'start' : i === kw.length - 1 ? 'end' : 'middle' }); tx.textContent = ts[i] || ''; svg.append(tx);
  }
  requestAnimationFrame(() => { try { path.style.setProperty('--len', path.getTotalLength().toFixed(0)); } catch (e) { path.style.setProperty('--len', '1200'); } });
  try { path.style.setProperty('--len', path.getTotalLength().toFixed(0)); } catch (e) { path.style.setProperty('--len', '1200'); }
  return svg;
}

function tile(k, v, unit) { return h('div', { class: 'gn-t' }, h('div', { class: 'gn-k' }, k), h('div', { class: 'gn-v' }, v, h('i', {}, unit))); }

/** generation.json(HI SMART 현장들) + hyosung-generation.json(Q.HUB, 자가소비)을 한 목록으로 합친다. 둘 다 없으면 null */
export async function loadAllSites(base = 'assets/data/') {
  const get = u => fetch(base + u, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null);
  const [g, hy] = await Promise.all([get('generation.json'), get('hyosung-generation.json')]);
  const sites = (g && !g.sample && Array.isArray(g.sites)) ? g.sites.slice() : [];
  const L = hy && hy.live;
  if (L && (L.todayKwh != null || L.nowKw != null)) {
    const cur = (hy.months || []).find(m => m.partial) || null, prevM = (hy.months || []).filter(m => !m.partial).slice(-1)[0] || null;
    sites.unshift({
      id: 'HYOSUNG', ids: (L.feeds || []).map(f => f.id), name: hy.site || '효성첨단소재 전주공장', portalName: (L.feeds || []).map(f => f.name).join(' + '),
      page: 'case-detail.html', label: '자가소비 · 제조공장 지붕 · 전북 전주', sido: '전북', sigu: '전주시',
      capacityKw: hy.capacityKw || hy.portalCapacityKw, portalCapacityKw: hy.portalCapacityKw, nowKw: L.nowKw, todayKwh: L.todayKwh, todayHours: L.todayHours,
      yesterdayKwh: null, monthKwh: L.monthKwh != null ? L.monthKwh : (cur && cur.kwh), monthHours: L.monthHours, prevMonthKwh: prevM && prevM.kwh, totalKwh: L.yearKwh,
      inverters: (L.feeds || []).length, running: (L.feeds || []).filter(f => (f.nowKw || 0) > 0 || f.status === 'Normal').length,
      status: (L.nowKw || 0) > 0 ? 'Run' : 'Standby', comm: 'None', daySeries: L.daySeries || { t: [], kw: [] }, selfUse: true, updated: hy.updated, source: hy.source,
    });
  }
  for (const s of sites) if (!s.source && g && g.source) s.source = g.source;
  if (!sites.length) return null;
  const sum = k => { const v = sites.map(s => s[k]).filter(x => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) * 10) / 10 : null; };
  const updated = [g && g.updated, hy && hy.updated].filter(Boolean).sort().slice(-1)[0];
  return { sample: false, updated, source: [g && g.source, hy && hy.source].filter(Boolean).join(' · '), sites,
    totals: { capacityKw: sum('capacityKw'), nowKw: sum('nowKw'), todayKwh: sum('todayKwh'), monthKwh: sum('monthKwh'), totalKwh: sum('totalKwh'), sites: sites.length } };
}

export function renderGenerationOverview(root, data) {
  injectCSS(); root.innerHTML = '';
  if (!data || data.sample || !Array.isArray(data.sites) || !data.sites.length) return false;
  const t = data.totals || {};
  const box = h('div', { class: 'gn' });
  box.append(h('div', { class: 'gn-tot' },
    tile('지금 출력', fmt1(t.nowKw), 'kW'), tile('오늘 발전량', fmt0(t.todayKwh), 'kWh'),
    tile('이달 누적', kwh(t.monthKwh).replace(/ (MWh|kWh)$/, ''), (t.monthKwh || 0) >= 10000 ? 'MWh' : 'kWh'),
    tile('설비 용량', fmtCap(t.capacityKw), `kW · ${t.sites || data.sites.length}개 현장`)));
  const grid = h('div', { class: 'gn-grid' });
  for (const s of data.sites) {
    const on = (s.nowKw || 0) > 0 && s.status === 'Run';
    const card = h(s.page ? 'a' : 'div', s.page ? { class: 'gn-c', href: s.page } : { class: 'gn-c' },
      h('div', { class: 'gn-cl' }, s.label || [s.sido, s.sigu].filter(Boolean).join(' ')),
      h('div', { class: 'gn-cn' }, s.name),
      h('div', { class: 'gn-cs' }, h('span', { class: 'gn-dot' + (on ? '' : ' off') }), `${on ? '발전 중' : '대기'} · 지금 ${fmt1(s.nowKw)} kW · 용량 ${fmtCap(s.capacityKw)} kW`),
      sparkline(s),
      h('div', { class: 'gn-row' }, h('span', {}, '오늘'), h('b', {}, fmt0(s.todayKwh) + ' kWh')),
      s.selfUse ? h('div', { class: 'gn-row' }, h('span', {}, '올해 누적'), h('b', {}, kwh(s.totalKwh))) : h('div', { class: 'gn-row' }, h('span', {}, '어제'), h('b', {}, fmt0(s.yesterdayKwh) + ' kWh')),
      h('div', { class: 'gn-row' }, h('span', {}, '이달 누적'), h('b', {}, kwh(s.monthKwh))));
    grid.append(card);
  }
  box.append(grid, h('div', { class: 'gn-foot' }, h('span', {}, whenText(data) + ' · 매시 갱신 · 20분 단위 계측값'), h('span', {}, '출처: ' + (data.source || '현장 모니터링'))));
  root.append(box); return true;
}

export function renderGenerationSite(root, data, opts = {}) {
  injectCSS(); root.innerHTML = '';
  if (!data || data.sample || !Array.isArray(data.sites)) return false;
  const s = data.sites.find(x => (opts.page && x.page === opts.page) || (opts.id && x.id === opts.id));
  if (!s) return false;
  const on = (s.nowKw || 0) > 0 && s.status === 'Run';
  const box = h('div', { class: 'gn gn-site' });
  box.append(h('div', { class: 'gn-site-h' }, h('h3', {}, '지금 이 현장은'), h('div', { class: 'gn-cs' }, h('span', { class: 'gn-dot' + (on ? '' : ' off') }), `${on ? '발전 중' : '대기'} · ${s.selfUse ? '피드' : '인버터'} ${s.running || 0}/${s.inverters || 0} 운전 · ${whenText({ updated: s.updated || data.updated })}`)));
  box.append(h('div', { class: 'gn-tot' }, tile('지금 출력', fmt1(s.nowKw), `kW / ${fmtCap(s.capacityKw)}`), tile('오늘 발전량', fmt0(s.todayKwh), 'kWh'), tile('어제', fmt0(s.yesterdayKwh), 'kWh'), tile('이달 누적', kwh(s.monthKwh).replace(/ (MWh|kWh)$/, ''), (s.monthKwh || 0) >= 10000 ? 'MWh' : 'kWh')));
  box.append(sparkline(s, 640, 110));
  box.append(h('div', { class: 'gn-foot' }, h('span', {}, s.selfUse ? `올해 누적 ${kwh(s.totalKwh)} · 지난달 ${kwh(s.prevMonthKwh)} · 전량 자가소비` : `준공 후 총 누적 ${kwh(s.totalKwh)} · 지난달 ${kwh(s.prevMonthKwh)}`), h('span', {}, '출처: ' + (s.source || data.source || '현장 모니터링'))));
  root.append(box); return true;
}
