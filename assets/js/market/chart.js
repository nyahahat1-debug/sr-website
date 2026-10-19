// ─────────────────────────────────────────────────────────────
// 전력 시세 차트 (SMP·REC) — SVG + CSS 애니메이션만 사용 (JS 프레임 루프 없음 → iOS 웹뷰에서도 동작)
// 사용: renderMarketChart(el, data, { theme: 'dark' | 'light' })
//   data = { updated, sample, sources, smpDaily:[{d,v}], smpMonthly:[{m,v}], rec:[{d,v,vol}] }
// 선이 왼쪽에서 오른쪽으로 그려지고, 아래에 그라데이션이 깔리고, 끝점에 현재값 라벨이 붙는다.
// ─────────────────────────────────────────────────────────────
const SERIES = [
  { key: 'smpDaily',   tab: 'SMP 일별',     unit: '원/kWh', title: 'SMP (육지 일 가중평균)', x: r => r.d, fmt: v => v.toFixed(1), diffLabel: '전일 대비', xfmt: s => s.slice(5).replace('-', '.'), ticks: 5 },
  { key: 'smpMonthly', tab: 'SMP 월별',     unit: '원/kWh', title: 'SMP (육지 월 가중평균)', x: r => r.m, fmt: v => v.toFixed(1), diffLabel: '전월 대비', xfmt: s => s.replace('-', '.'), ticks: 6 },
  { key: 'rec',        tab: 'REC 거래일별', unit: '원/REC', title: 'REC 현물시장 (육지 평균가)', x: r => r.d, fmt: v => v.toLocaleString('ko-KR'), diffLabel: '전 거래일 대비', xfmt: s => s.slice(5).replace('-', '.'), ticks: 5 },
];

const CSS = `
.mk{--mk-ink:#0D1B2A;--mk-line:#0077B6;--mk-line2:#00B4D8;--mk-grid:rgba(13,27,42,.1);--mk-text:#0D1B2A;--mk-muted:#546E7A;--mk-bg:#F7FAFC;--mk-border:#C8D8E8;--mk-fill:rgba(0,119,182,.22);--mk-pill:#0D1B2A;--mk-pillfg:#F7FAFC;--mk-tab:#EDF2F7;
  background:var(--mk-bg);border:1px solid var(--mk-border);border-radius:6px;color:var(--mk-text);padding:18px 18px 12px;font-family:'Pretendard Variable','Pretendard',system-ui,sans-serif;position:relative}
.mk.dark{--mk-line:#00B4D8;--mk-line2:#90E0EF;--mk-grid:rgba(255,255,255,.08);--mk-text:#F7FAFC;--mk-muted:#9FB6C8;--mk-bg:#13273A;--mk-border:rgba(255,255,255,.12);--mk-fill:rgba(0,180,216,.28);--mk-pill:#F7FAFC;--mk-pillfg:#0D1B2A;--mk-tab:rgba(255,255,255,.07)}
.mk-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}
.mk-t{font-size:13px;color:var(--mk-muted);font-weight:500}
.mk-now{display:flex;align-items:baseline;gap:8px;margin-top:4px;flex-wrap:wrap}
.mk-v{font-family:'IBM Plex Mono',monospace;font-size:28px;font-weight:600;letter-spacing:-.02em;line-height:1;font-variant-numeric:tabular-nums}
.mk-u{font-size:12.5px;color:var(--mk-muted)}
.mk-d{font-size:12.5px;font-weight:600;font-variant-numeric:tabular-nums}
.mk-d.up{color:#D64545}.mk-d.down{color:#1E7BC7}.mk.dark .mk-d.down{color:#7FD3F0}.mk.dark .mk-d.up{color:#FF8A80}
.mk-tabs{display:flex;gap:4px;background:var(--mk-tab);padding:3px;border-radius:999px}
.mk-tab{appearance:none;border:none;background:transparent;color:var(--mk-muted);font:inherit;font-size:12.5px;font-weight:600;padding:6px 12px;border-radius:999px;cursor:pointer;white-space:nowrap;transition:background-color .15s ease,color .15s ease}
.mk-tab[aria-selected="true"]{background:var(--mk-pill);color:var(--mk-pillfg)}
.mk-tab:focus-visible{outline:2px solid var(--mk-line);outline-offset:1px}
.mk-svg{display:block;width:100%;height:auto;margin-top:10px;overflow:visible}
.mk-grid{stroke:var(--mk-grid);stroke-width:1}
.mk-ax{fill:var(--mk-muted);font-size:10.5px;font-family:'IBM Plex Mono',monospace}
.mk-area{fill:url(#mkFill);opacity:0;animation:mkFade .9s ease 1.05s forwards}
.mk-line{fill:none;stroke:var(--mk-line);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:var(--len);stroke-dashoffset:var(--len);animation:mkDraw 1.7s cubic-bezier(.23,1,.32,1) .15s forwards}
.mk-dot{fill:var(--mk-line);stroke:var(--mk-bg);stroke-width:2;transform-box:fill-box;transform-origin:center;transform:scale(0);animation:mkPop .5s cubic-bezier(.23,1,.32,1) 1.55s forwards}
.mk-ring{fill:none;stroke:var(--mk-line2);stroke-width:1.5;transform-box:fill-box;transform-origin:center;opacity:0;animation:mkRing 2.4s ease-out 2s infinite}
.mk-lab{opacity:0;animation:mkFade .5s ease 1.75s forwards}
.mk-lab rect{fill:var(--mk-pill)}
.mk-lab text{fill:var(--mk-pillfg);font-size:11.5px;font-weight:600;font-family:'IBM Plex Mono',monospace}
.mk-foot{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:8px;font-size:11.5px;color:var(--mk-muted);line-height:1.5}
.mk-foot a{color:inherit;text-decoration:underline;text-underline-offset:3px}
.mk-sample{display:inline-block;font-size:11px;font-weight:600;color:#9A3412;background:#FFEDD5;border:1px solid #FDBA74;border-radius:4px;padding:1px 7px;margin-left:6px;vertical-align:1px}
@keyframes mkDraw{to{stroke-dashoffset:0}}
@keyframes mkFade{to{opacity:1}}
@keyframes mkPop{to{transform:scale(1)}}
@keyframes mkRing{0%{opacity:.9;transform:scale(.6)}100%{opacity:0;transform:scale(2.6)}}
@media(max-width:600px){.mk{padding:14px 12px 10px}.mk-v{font-size:24px}.mk-tabs{width:100%;justify-content:space-between}.mk-tab{flex:1;padding:6px 6px;font-size:12px}}
@media(prefers-reduced-motion:reduce){.mk-line,.mk-area,.mk-dot,.mk-lab{animation:none;stroke-dashoffset:0;opacity:1;transform:none}.mk-ring{display:none}}
`;

function injectCSS() {
  if (document.getElementById('mk-css')) return;
  const s = document.createElement('style'); s.id = 'mk-css'; s.textContent = CSS; document.head.appendChild(s);
}
const h = (tag, attrs = {}, ...kids) => {
  const el = tag.includes(':') ? document.createElementNS('http://www.w3.org/2000/svg', tag.split(':')[1]) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'class') el.setAttribute('class', v); else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v); }
  for (const k of kids) el.append(k);
  return el;
};
const svgEl = (t, a = {}) => h('svg:' + t, a);

/** Catmull-Rom → cubic bezier 로 부드러운 선 */
function smoothPath(pts) {
  if (pts.length < 2) return '';
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0]},${p2[1]}`;
  }
  return d;
}
function niceTicks(min, max, n) {
  const span = max - min || 1, raw = span / (n - 1), p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= raw) || raw;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step; const out = [];
  for (let v = lo; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}

export function renderMarketChart(root, data, opts = {}) {
  injectCSS();
  root.innerHTML = '';
  const box = h('div', { class: 'mk' + (opts.theme === 'dark' ? ' dark' : '') });
  const title = h('div', { class: 'mk-t' });
  const now = h('div', { class: 'mk-now' });
  const tabs = h('div', { class: 'mk-tabs', role: 'tablist', 'aria-label': '시세 종류' });
  const svgWrap = h('div');
  const foot = h('div', { class: 'mk-foot' });
  box.append(h('div', { class: 'mk-head' }, h('div', {}, title, now), tabs), svgWrap, foot);
  root.append(box);

  const avail = SERIES.filter(s => Array.isArray(data[s.key]) && data[s.key].length > 1);
  let cur = avail.find(s => s.key === opts.initial) || avail[0];
  for (const s of avail) tabs.append(h('button', { class: 'mk-tab', type: 'button', role: 'tab', 'aria-selected': 'false', onclick: () => { cur = s; draw(); } }, s.tab));

  function draw() {
    for (const b of tabs.children) b.setAttribute('aria-selected', b.textContent === cur.tab ? 'true' : 'false');
    const rows = data[cur.key]; const vals = rows.map(r => r.v);
    const last = rows[rows.length - 1], prev = rows[rows.length - 2];
    const diff = last.v - prev.v;
    title.textContent = cur.title;
    now.innerHTML = '';
    now.append(h('span', { class: 'mk-v' }, cur.fmt(last.v)), h('span', { class: 'mk-u' }, cur.unit),
      h('span', { class: 'mk-d ' + (diff > 0 ? 'up' : diff < 0 ? 'down' : '') }, (diff > 0 ? '▲ ' : diff < 0 ? '▼ ' : '— ') + cur.fmt(Math.abs(diff)) + ' ' + cur.diffLabel));

    // ── SVG
    const W = 640, H = 240, L = 44, R = 70, T = 14, B = 26;
    const ticks = niceTicks(Math.min(...vals), Math.max(...vals), cur.ticks);
    const yMin = ticks[0], yMax = ticks[ticks.length - 1];
    const px = i => L + (W - L - R) * (rows.length === 1 ? 0 : i / (rows.length - 1));
    const py = v => T + (H - T - B) * (1 - (v - yMin) / (yMax - yMin || 1));
    const pts = rows.map((r, i) => [+px(i).toFixed(1), +py(r.v).toFixed(1)]);
    const line = smoothPath(pts);
    const area = line + ` L${pts[pts.length - 1][0]},${H - B} L${pts[0][0]},${H - B} Z`;
    const svg = svgEl('svg', { class: 'mk-svg', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${cur.title} 추이, 최근 ${rows.length}개` });
    const defs = svgEl('defs'); const grad = svgEl('linearGradient', { id: 'mkFill', x1: '0', y1: '0', x2: '0', y2: '1' });
    grad.append(svgEl('stop', { offset: '0', 'stop-color': 'var(--mk-fill)' }), svgEl('stop', { offset: '1', 'stop-color': 'var(--mk-fill)', 'stop-opacity': '0' }));
    defs.append(grad); svg.append(defs);
    for (const t of ticks) { const y = py(t).toFixed(1); svg.append(svgEl('line', { class: 'mk-grid', x1: L, x2: W - R, y1: y, y2: y })); const tx = svgEl('text', { class: 'mk-ax', x: L - 8, y: +y + 3.5, 'text-anchor': 'end' }); tx.textContent = cur.key === 'rec' ? (t / 1000).toFixed(0) + 'k' : t; svg.append(tx); }
    const xi = [0, Math.round((rows.length - 1) / 2), rows.length - 1];
    for (const i of new Set(xi)) { const tx = svgEl('text', { class: 'mk-ax', x: px(i).toFixed(1), y: H - 8, 'text-anchor': i === 0 ? 'start' : i === rows.length - 1 ? 'end' : 'middle' }); tx.textContent = cur.xfmt(cur.x(rows[i])); svg.append(tx); }
    svg.append(svgEl('path', { class: 'mk-area', d: area }));
    const path = svgEl('path', { class: 'mk-line', d: line }); svg.append(path);
    const [ex, ey] = pts[pts.length - 1];
    svg.append(svgEl('circle', { class: 'mk-ring', cx: ex, cy: ey, r: 7 }));
    svg.append(svgEl('circle', { class: 'mk-dot', cx: ex, cy: ey, r: 4.5 }));
    const labTxt = cur.fmt(last.v); const lw = labTxt.length * 7.2 + 16;
    const lab = svgEl('g', { class: 'mk-lab' });
    const ly = Math.max(T + 2, ey - 26);
    lab.append(svgEl('rect', { x: ex - lw / 2, y: ly - 11, width: lw, height: 20, rx: 10 }));
    const lt = svgEl('text', { x: ex, y: ly + 3.5, 'text-anchor': 'middle' }); lt.textContent = labTxt; lab.append(lt);
    svg.append(lab);
    svgWrap.innerHTML = ''; svgWrap.append(svg);
    // 선 길이 → 그리기 애니메이션
    requestAnimationFrame(() => { try { const len = path.getTotalLength(); path.style.setProperty('--len', len.toFixed(0)); } catch (e) { path.style.setProperty('--len', '2000'); } });
    try { const len = path.getTotalLength(); path.style.setProperty('--len', len.toFixed(0)); } catch (e) { path.style.setProperty('--len', '2000'); }

    const src = data.sources && data.sources[cur.key === 'rec' ? 'rec' : 'smp'];
    foot.innerHTML = '';
    foot.append(h('span', {}, `기준 ${cur.key === 'smpMonthly' ? cur.x(last) : cur.x(last)} · ${rows.length}${cur.key === 'rec' ? '거래일' : cur.key === 'smpMonthly' ? '개월' : '일'}`, data.sample ? h('span', { class: 'mk-sample' }, '샘플 데이터') : ''),
      h('span', {}, src ? '출처: ' + src : ''));
  }
  draw();
  return { redraw: draw };
}
