// ─────────────────────────────────────────────────────────────
// 발전 현황 패널 — assets/data/generation.json (HI SMART 수집) + hyosung-generation.json (Q.HUB 수집) 을 읽어 표시
//   renderGenerationOverview(el, data)           : 합계 + 현장 카드 (현재 메인에서는 쓰지 않음)
//   renderGenerationSite(el, data, { page })     : 현장 상세 페이지 — 해당 현장 한 곳
// 표시 원칙(2026-10-29):
//   · 수집 시각(updated)은 "수집 MM.DD HH:MM" 으로 그대로 보여 준다. 포털의 관측 시각은 자료에 없으므로 만들어 쓰지 않는다.
//   · 매시 수집(06~20시)이므로 초 단위 실시간처럼 표현하지 않는다.
//   · 오래된 자료(수집 창 안에서 3시간 넘게 갱신 없음, 또는 26시간 이상)는 '자료 지연' 으로 구분한다. 밤에는 수집이 없어 지연으로 보지 않는다.
//   · 출력 0 은 실제 값으로 보여 주되, 야간·통신 이상(포털 표시 comm='Error')·자료 지연과 함께 읽히게 상태 문구를 붙인다.
//   · 숫자가 아니면 '—' 로 표시한다. 파일이 없거나 JSON 이 깨지면 호출 쪽(loadAllSites)이 null 을 돌려 위젯을 숨긴다.
// 자료 계약 v2 (2026-10-29, docs/handoff/GENERATION_DATA_CONTRACT.md) — 옛 자료(v1: updated 만 있음)와 호환:
//   · collectedAt(수집 시각) 이 없으면 updated 를 쓴다. observedAt(포털 관측 시각) 은 자료에 있을 때만 "관측 MM.DD HH:MM" 으로 보여 준다 — 없다고 만들어 쓰지 않는다.
//   · quality.status: ok | stale | comm_error | partial | unknown — 수집기가 판정한 값이 있으면 지연·통신 이상 판정에 우선 반영한다.
//   · publish.status === 'granted' && allowed === true 인 현장만 표시한다. 동의 플래그가 없는 옛 자료(v1)·pending·withheld 는 표시하지 않는다 (공개 통제는 수집 단계가 1차, 여기는 2차 방어).
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
.gn-cs{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--gn-muted);margin-top:2px;flex-wrap:wrap}
.gn-dot{width:7px;height:7px;border-radius:50%;background:#2E9E5B;flex:none}
.gn-dot.off{background:#B0BEC5}
.gn-dot.warn{background:var(--gn-sun)}
.gn-badge{display:inline-block;padding:1px 7px;border-radius:999px;border:1px solid var(--gn-sun);color:#8A5A00;background:#FFF7E6;font-size:11px;font-weight:600;line-height:1.5}
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
const num = v => (typeof v === 'number' && Number.isFinite(v)) ? v : null;
const fmt0 = v => (num(v) == null ? '—' : Math.round(v).toLocaleString('ko-KR'));
const fmtCap = v => (num(v) == null ? '—' : Number.isInteger(v) ? fmt0(v) : Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 2 }));
const fmt1 = v => (num(v) == null ? '—' : Number(v).toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const kwh = v => (num(v) == null ? '—' : v >= 10000 ? (v / 1000).toLocaleString('ko-KR', { maximumFractionDigits: 1 }) + ' MWh' : fmt0(v) + ' kWh');
const pad = n => String(n).padStart(2, '0');

const stamp = t => `${t.getMonth() + 1}.${t.getDate()} ${pad(t.getHours())}:${pad(t.getMinutes())}`;
/** 수집 시각 해석. 자료에 없으면 valid:false. observedAt(관측 시각)·quality(수집기 판정)가 있으면 함께 반영 */
export function freshness(updated, now = new Date(), extra = {}) {
  const t = new Date(updated);
  const q = extra.quality && typeof extra.quality === 'object' ? extra.quality : null;
  const qs = q && typeof q.status === 'string' ? q.status : null;
  const ot = extra.observedAt ? new Date(extra.observedAt) : null;
  const obsText = ot && !isNaN(ot) ? ` · 관측 ${stamp(ot)}` : '';
  if (!updated || isNaN(t)) return { valid: false, text: '수집 시각 정보 없음' + obsText, stale: qs === 'stale', ageMin: null, quality: qs, observed: !!obsText };
  const ageMin = Math.round((now - t) / 60000);
  const hour = now.getHours();                                       // 표시 기기 시각 기준(현장과 같은 KST 가정)
  const inWindow = hour >= 7 && hour < 21;                           // 06~20시 매시 수집 → 07시 이후부터 지연 판단
  const stale = qs === 'stale' || ageMin > 26 * 60 || (inWindow && ageMin > 180);
  const text = `수집 ${stamp(t)}` + obsText;
  return { valid: true, text, stale, ageMin, hour, quality: qs, observed: !!obsText };
}

/** 현장 상태 문구: 발전 중 / 야간 대기 / 대기(주간 출력 0) / 포털 통신 이상 / 자료 지연 */
export function siteState(s, fr, now = new Date()) {
  const now_kw = num(s.nowKw);
  const commErr = s.comm === 'Error' || fr.quality === 'comm_error';
  const night = now.getHours() < 6 || now.getHours() >= 20;
  if (fr.stale) return { key: 'stale', text: '자료 지연 · 마지막 수집값 표시', dot: 'warn' };
  if (commErr) return { key: 'comm', text: '포털 통신 이상 표시 · 값은 마지막 수집값', dot: 'warn' };
  if (fr.quality === 'partial' || fr.quality === 'unknown') return { key: 'quality', text: fr.quality === 'partial' ? '일부 자료 누락 · 값은 수집된 범위' : '자료 품질 미확인', dot: 'warn' };
  if (now_kw == null) return { key: 'nodata', text: '현재 출력 자료 없음', dot: 'off' };
  if (now_kw > 0 && s.status === 'Run') return { key: 'run', text: '발전 중', dot: '' };
  if (night) return { key: 'night', text: '야간 대기 (출력 0)', dot: 'off' };
  return { key: 'idle', text: '대기 (출력 0 · 수집 시점 기준)', dot: 'off' };
}

/** 오늘 20분 단위 출력(kW) 곡선 — 05:00~21:40 */
function sparkline(site, W = 320, H = 88) {
  const kwRaw = (site.daySeries && Array.isArray(site.daySeries.kw)) ? site.daySeries.kw : [], ts = (site.daySeries && Array.isArray(site.daySeries.t)) ? site.daySeries.t : [];
  const kw = kwRaw.map(v => num(v) == null ? 0 : v);
  const L = 6, R = 6, T = 10, B = 16;
  const svg = svgEl('svg', { class: 'gn-svg', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${site.name} 오늘 출력 곡선` });
  if (kw.length < 2) { svg.append(Object.assign(svgEl('text', { class: 'gn-ax', x: L, y: H / 2 }), { textContent: '오늘 계측값 없음' })); return svg; }
  const max = Math.max(Math.max(...kw) * 1.15, (num(site.capacityKw) || 0) * 0.1) || 1;
  const px = i => L + (W - L - R) * i / (kw.length - 1), py = v => T + (H - T - B) * (1 - v / max);
  let d = `M${px(0).toFixed(1)},${py(kw[0]).toFixed(1)}`;
  for (let i = 1; i < kw.length; i++) d += ` L${px(i).toFixed(1)},${py(kw[i]).toFixed(1)}`;
  svg.append(svgEl('path', { class: 'gn-area', d: d + ` L${px(kw.length - 1).toFixed(1)},${H - B} L${L},${H - B} Z` }));
  const path = svgEl('path', { class: 'gn-path', d }); svg.append(path);
  for (const i of [0, Math.floor((kw.length - 1) / 2), kw.length - 1]) {
    const tx = svgEl('text', { class: 'gn-ax', x: px(i).toFixed(1), y: H - 4, 'text-anchor': i === 0 ? 'start' : i === kw.length - 1 ? 'end' : 'middle' }); tx.textContent = typeof ts[i] === 'string' ? ts[i] : ''; svg.append(tx);
  }
  requestAnimationFrame(() => { try { path.style.setProperty('--len', path.getTotalLength().toFixed(0)); } catch (e) { path.style.setProperty('--len', '1200'); } });
  try { path.style.setProperty('--len', path.getTotalLength().toFixed(0)); } catch (e) { path.style.setProperty('--len', '1200'); }
  return svg;
}

function tile(k, v, unit) { return h('div', { class: 'gn-t' }, h('div', { class: 'gn-k' }, k), h('div', { class: 'gn-v' }, v, h('i', {}, unit))); }

/** generation.json(HI SMART 현장들) + hyosung-generation.json(Q.HUB, 자가소비)을 한 목록으로 합친다. 둘 다 없거나 깨졌으면 null */
export async function loadAllSites(base = 'assets/data/') {
  const get = u => fetch(base + u, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(j => (j && typeof j === 'object') ? j : null).catch(() => null);
  const [g, hy] = await Promise.all([get('generation.json'), get('hyosung-generation.json')]);
  const allowed = (s, root) => { const p = (s && s.publish) || (root && root.publish); return !!(p && typeof p === 'object' && p.status === 'granted' && p.allowed === true); };   // granted 만 표시 — 동의 플래그 없는 옛 자료(v1)·pending·withheld 는 표시하지 않는다 (1차 통제는 수집기)
  const sites = (g && !g.sample && Array.isArray(g.sites)) ? g.sites.filter(s => s && typeof s === 'object' && allowed(s, g)).map(s => ({ ...s, updated: s.collectedAt || s.updated || g.collectedAt || g.updated, observedAt: typeof s.observedAt === 'string' ? s.observedAt : null, quality: s.quality && typeof s.quality === 'object' ? s.quality : null })) : [];
  const L = hy && hy.live && typeof hy.live === 'object' ? hy.live : null;
  if (L && (num(L.todayKwh) != null || num(L.nowKw) != null) && allowed(hy, null)) {
    const months = Array.isArray(hy.months) ? hy.months : [];
    const cur = months.find(m => m && m.partial) || null, prevM = months.filter(m => m && !m.partial).slice(-1)[0] || null;
    const feeds = Array.isArray(L.feeds) ? L.feeds : [];
    sites.unshift({
      id: 'HYOSUNG', ids: feeds.map(f => f.id), name: hy.site || '효성첨단소재 전주공장', portalName: feeds.map(f => f.name).join(' + '),
      page: 'case-detail.html', label: '자가소비 · 제조공장 지붕 · 전북 전주', sido: '전북', sigu: '전주시',
      capacityKw: hy.capacityKw || hy.portalCapacityKw, portalCapacityKw: hy.portalCapacityKw, nowKw: num(L.nowKw), todayKwh: num(L.todayKwh), todayHours: L.todayHours,
      yesterdayKwh: null, monthKwh: num(L.monthKwh) != null ? L.monthKwh : (cur && num(cur.kwh)), monthHours: L.monthHours, prevMonthKwh: prevM && num(prevM.kwh), totalKwh: num(L.yearKwh),
      inverters: feeds.length, running: feeds.filter(f => (num(f.nowKw) || 0) > 0 || f.status === 'Normal').length,
      status: (num(L.nowKw) || 0) > 0 ? 'Run' : 'Standby', comm: hy.quality && hy.quality.status === 'comm_error' ? 'Error' : 'None', daySeries: L.daySeries || { t: [], kw: [] }, selfUse: true,
      updated: hy.collectedAt || hy.updated, observedAt: typeof L.observedAt === 'string' ? L.observedAt : (typeof hy.observedAt === 'string' ? hy.observedAt : null), quality: hy.quality && typeof hy.quality === 'object' ? hy.quality : null, source: hy.source,
    });
  }
  for (const s of sites) if (!s.source && g && g.source) s.source = g.source;
  if (!sites.length) return null;
  const sum = k => { const v = sites.map(s => num(s[k])).filter(x => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) * 10) / 10 : null; };
  const updated = [g && (g.collectedAt || g.updated), hy && (hy.collectedAt || hy.updated)].filter(Boolean).sort().slice(-1)[0];
  return { sample: false, updated, source: [g && g.source, hy && hy.source].filter(Boolean).join(' · '), sites,
    totals: { capacityKw: sum('capacityKw'), nowKw: sum('nowKw'), todayKwh: sum('todayKwh'), monthKwh: sum('monthKwh'), totalKwh: sum('totalKwh'), sites: sites.length } };
}

function stateLine(s, fr) {
  const st = siteState(s, fr);
  const parts = [h('span', { class: 'gn-dot ' + st.dot }), st.text];
  if (fr.stale) parts.push(h('span', { class: 'gn-badge' }, '자료 지연'));
  else if (st.key === 'quality') parts.push(h('span', { class: 'gn-badge' }, fr.quality === 'partial' ? '일부 누락' : '품질 미확인'));
  return { st, el: h('div', { class: 'gn-cs' }, ...parts) };
}

export function renderGenerationOverview(root, data) {
  injectCSS(); root.innerHTML = '';
  if (!data || data.sample || !Array.isArray(data.sites) || !data.sites.length) return false;
  const t = data.totals || {};
  const box = h('div', { class: 'gn' });
  box.append(h('div', { class: 'gn-tot' },
    tile('지금 출력', fmt1(t.nowKw), 'kW'), tile('오늘 발전량', fmt0(t.todayKwh), 'kWh'),
    tile('이달 누적', kwh(t.monthKwh).replace(/ (MWh|kWh)$/, ''), (num(t.monthKwh) || 0) >= 10000 ? 'MWh' : 'kWh'),
    tile('설비 용량', fmtCap(t.capacityKw), `kW · ${t.sites || data.sites.length}개 현장`)));
  const grid = h('div', { class: 'gn-grid' });
  for (const s of data.sites) {
    const fr = freshness(s.updated || data.updated, new Date(), s);
    const { el } = stateLine(s, fr);
    el.append(` · 지금 ${fmt1(s.nowKw)} kW · 용량 ${fmtCap(s.capacityKw)} kW`);
    const card = h(s.page ? 'a' : 'div', s.page ? { class: 'gn-c', href: s.page } : { class: 'gn-c' },
      h('div', { class: 'gn-cl' }, s.label || [s.sido, s.sigu].filter(Boolean).join(' ')),
      h('div', { class: 'gn-cn' }, s.name || ''),
      el, sparkline(s),
      h('div', { class: 'gn-row' }, h('span', {}, '오늘'), h('b', {}, fmt0(s.todayKwh) + ' kWh')),
      s.selfUse ? h('div', { class: 'gn-row' }, h('span', {}, '올해 누적'), h('b', {}, kwh(s.totalKwh))) : h('div', { class: 'gn-row' }, h('span', {}, '어제'), h('b', {}, fmt0(s.yesterdayKwh) + ' kWh')),
      h('div', { class: 'gn-row' }, h('span', {}, '이달 누적'), h('b', {}, kwh(s.monthKwh))));
    grid.append(card);
  }
  const fr = freshness(data.updated);
  box.append(grid, h('div', { class: 'gn-foot' }, h('span', {}, `${fr.text} · 06~20시 매시 수집`)));
  root.append(box); return true;
}

export function renderGenerationSite(root, data, opts = {}) {
  injectCSS(); root.innerHTML = '';
  if (!data || data.sample || !Array.isArray(data.sites)) return false;
  const s = data.sites.find(x => x && ((opts.page && x.page === opts.page) || (opts.id && x.id === opts.id)));
  if (!s) return false;
  const fr = freshness(s.updated || data.updated, new Date(), s);
  const { el } = stateLine(s, fr);
  el.append(` · ${s.selfUse ? '피드' : '인버터'} ${fmt0(s.running)}/${fmt0(s.inverters)} 운전`);
  const box = h('div', { class: 'gn gn-site' });
  box.append(h('div', { class: 'gn-site-h' }, h('h3', {}, '지금 이 현장은'), el));
  box.append(h('div', { class: 'gn-tot' }, tile('출력 (수집 시점)', fmt1(s.nowKw), `kW / ${fmtCap(s.capacityKw)}`), tile('오늘 발전량', fmt0(s.todayKwh), 'kWh'), tile('어제', fmt0(s.yesterdayKwh), 'kWh'), tile('이달 누적', kwh(s.monthKwh).replace(/ (MWh|kWh)$/, ''), (num(s.monthKwh) || 0) >= 10000 ? 'MWh' : 'kWh')));
  box.append(sparkline(s, 640, 110));
  box.append(h('div', { class: 'gn-foot' }, h('span', {}, s.selfUse ? `올해 누적 ${kwh(s.totalKwh)} · 지난달 ${kwh(s.prevMonthKwh)} · 전량 자가소비` : `준공 후 총 누적 ${kwh(s.totalKwh)} · 지난달 ${kwh(s.prevMonthKwh)}`), h('span', {}, `${fr.text} · 06~20시 매시 수집`)));
  root.append(box); return true;
}
