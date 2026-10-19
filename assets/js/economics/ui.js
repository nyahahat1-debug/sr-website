// ─────────────────────────────────────────────────────────────
// 경제성 계산기 UI — model.js(순수 계산) + tariff.js(요금제) 를 DOM 에 연결
// mountCalculator(container, { prefill })
// ─────────────────────────────────────────────────────────────
import { ASSUMPTIONS, defaults, compute, demoKeys, fmt } from './model.js';
import { TARIFFS, KINDS, SEASONS, SEASON_LABEL, BAND_LABEL, TOU_TEXT, TARIFF_SOURCE } from './tariff.js';
import { SITE_PRESETS } from './presets.js';

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v; else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
};
const DEFAULT_TARIFF = 'ie-ha1';   // 산업용(을) 고압A 선택Ⅰ — 명세서 예시와 동일

export function mountCalculator(root, { prefill = {} } = {}) {
  const a = defaults();
  const input = { mode: prefill.mode || 'self', capacityKw: prefill.capacityKw ?? 500, areaM2: null, tariffId: prefill.tariffId || DEFAULT_TARIFF };
  const state = { useArea: false, showTable: false, showBreakdown: true, sel: { group: '산업용', kind: '(을)' }, preset: null };
  function applyPreset(id) {
    const p = SITE_PRESETS[id]; if (!p) return;
    state.preset = p; input.mode = 'self'; input.capacityKw = p.capacityKw; input.areaM2 = null; state.useArea = false; input.tariffId = p.tariffId;
    a.selfUseRatio = p.selfUseRatio; if (assumpInputs.selfUseRatio) assumpInputs.selfUseRatio.value = p.selfUseRatio;
    capInput.value = p.capacityKw; const t = TARIFFS.find(x => x.id === p.tariffId); if (t) state.sel = { group: t.group, kind: t.kind };
  }
  const t0 = TARIFFS.find(t => t.id === input.tariffId); if (t0) state.sel = { group: t0.group, kind: t0.kind };

  // ── 1. 조건 입력
  const modeBtns = ['self', 'sell'].map(m => h('button', { type: 'button', class: 'ec-pill', 'data-mode': m, 'aria-pressed': String(input.mode === m), onclick: () => { input.mode = m; render(); } },
    m === 'self' ? '자가소비 (요금 절감)' : '발전판매 (SMP+REC)'));
  const capInput = h('input', { type: 'number', class: 'ec-num', inputmode: 'decimal', min: 1, step: 1, value: input.capacityKw, 'aria-label': '설치 용량 kW', oninput: e => { input.capacityKw = +e.target.value; render(); } });
  const areaInput = h('input', { type: 'number', class: 'ec-num', inputmode: 'decimal', min: 10, step: 10, placeholder: '예: 4,000', 'aria-label': '설치 가능 면적 ㎡', oninput: e => { input.areaM2 = +e.target.value; input.capacityKw = NaN; render(); } });
  const unitToggle = h('button', { type: 'button', class: 'ec-link', onclick: () => { state.useArea = !state.useArea; if (!state.useArea) { input.capacityKw = (+capInput.value) || 500; input.areaM2 = null; } else { input.capacityKw = NaN; } render(); } });
  const capRow = h('div', { class: 'ec-row' }, h('label', {}, '설치 용량'), h('div', { class: 'ec-unitwrap' }, capInput, h('span', { class: 'ec-unit' }, 'kW')));
  const areaRow = h('div', { class: 'ec-row' }, h('label', {}, '설치 가능 면적'), h('div', { class: 'ec-unitwrap' }, areaInput, h('span', { class: 'ec-unit' }, '㎡')));

  // ── 요금제 선택 (자가소비 전용) — 명세서의 '계약종별' 칸을 보고 고른다
  const groupBtns = ['일반용', '산업용'].map(g => h('button', { type: 'button', class: 'ec-pill ec-pill-s', 'data-g': g, onclick: () => { state.sel.group = g; pickFirst(); render(); } }, g));
  const kindSel = h('select', { class: 'ec-select', 'aria-label': '계약종별 구분', onchange: e => { state.sel.kind = e.target.value; pickFirst(); render(); } });
  const tariffSel = h('select', { class: 'ec-select', 'aria-label': '전압·선택요금', onchange: e => { input.tariffId = e.target.value; render(); } });
  const useManual = h('button', { type: 'button', class: 'ec-link', onclick: () => { input.tariffId = input.tariffId ? null : (tariffSel.value || DEFAULT_TARIFF); render(); } });
  const presetBtn = h('button', { type: 'button', class: 'ec-link', onclick: () => { applyPreset('hyosung'); render(); } }, '실제 현장 조건 불러오기 — 효성 전주공장 (1,530 kW · 산업용(을) 고압A 선택Ⅱ)');
  const compare = h('div', { class: 'ec-compare' });
  // ── 시세 (assets/data/market.json, 전력거래소 공개 데이터 자동 수집) — 발전판매 SMP·REC 기본값
  const market = { data: null, basis: 'avg365' };   // avg365 | avg30 | today | manual
  const BASIS = [['avg365', '최근 12개월 평균'], ['avg30', '최근 30일 평균'], ['today', '최근 시세'], ['manual', '직접 입력']];
  const basisBtns = BASIS.map(([k, l]) => h('button', { type: 'button', class: 'ec-pill ec-pill-s', 'data-b': k, onclick: () => { market.basis = k; applyMarket(); render(); } }, l));
  const marketBox = h('div', { class: 'ec-tariff ec-market', hidden: '' },
    h('div', { class: 'ec-row' }, h('label', {}, '판매 단가 기준 ', h('span', { class: 'ec-sum-note' }, '— 전력거래소 시세 자동 반영')), h('div', { class: 'ec-modes ec-modes-s' }, basisBtns)),
    h('div', { class: 'ec-tariff-note ec-market-note' }));
  function applyMarket() {
    const d = market.data; if (!d || market.basis === 'manual') return;
    const pick = { avg365: [d.avg.smp365, d.avg.rec365], avg30: [d.avg.smp30, d.avg.rec30], today: [d.latest.smp && d.latest.smp.v, d.latest.rec && d.latest.rec.v] }[market.basis];
    if (!pick) return; const [smp, rec] = pick;
    if (smp) { a.smpKrwPerKwh = Math.round(smp * 10) / 10; if (assumpInputs.smpKrwPerKwh) assumpInputs.smpKrwPerKwh.value = a.smpKrwPerKwh; }
    if (rec) { a.recKrwPerKwh = Math.round(rec / 1000 * 10) / 10; if (assumpInputs.recKrwPerKwh) assumpInputs.recKrwPerKwh.value = a.recKrwPerKwh; }   // 1 REC = 1,000 kWh
  }
  fetch(new URL('../../data/market.json', import.meta.url), { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(d => { if (d && !d.sample && d.latest && d.latest.smp) { market.data = d; applyMarket(); render(); } }).catch(() => {});
  const tariffBox = h('div', { class: 'ec-tariff' },
    h('div', { class: 'ec-row' }, h('label', {}, '현재 요금제 ', h('span', { class: 'ec-sum-note' }, '— 전기요금 명세서의 "계약종별" 칸')), h('div', { class: 'ec-modes ec-modes-s' }, groupBtns)),
    h('div', { class: 'ec-row2' }, h('div', { class: 'ec-row' }, h('label', {}, '구분'), kindSel), h('div', { class: 'ec-row' }, h('label', {}, '전압 · 선택요금'), tariffSel)),
    h('div', { class: 'ec-tariff-note' }), useManual,
  );
  function fillKinds() {
    kindSel.innerHTML = '';
    for (const k of KINDS) kindSel.append(h('option', { value: k.kind }, `${state.sel.group}${k.kind} — ${k.desc}`));
    kindSel.value = state.sel.kind;
  }
  function fillTariffs() {
    tariffSel.innerHTML = '';
    for (const t of TARIFFS.filter(t => t.group === state.sel.group && t.kind === state.sel.kind)) tariffSel.append(h('option', { value: t.id }, `${t.voltage}${t.option ? ' ' + t.option : ''} (기본요금 ${t.basic.toLocaleString('ko-KR')}원/kW)`));
    if ([...tariffSel.options].some(o => o.value === input.tariffId)) tariffSel.value = input.tariffId;
  }
  function pickFirst() { const f = TARIFFS.find(t => t.group === state.sel.group && t.kind === state.sel.kind); input.tariffId = f ? f.id : null; }

  // ── 2. 가정값 (수정 가능)
  const assumpInputs = {};
  const groups = [...new Set(ASSUMPTIONS.map(d => d.group))];
  const assumpBody = h('div', { class: 'ec-assump' }, groups.map(g => h('div', { class: 'ec-ag' },
    h('div', { class: 'ec-ag-t' }, g),
    ASSUMPTIONS.filter(d => d.group === g).map(d => {
      const inp = h('input', { type: 'number', class: 'ec-num ec-num-s', inputmode: 'decimal', min: d.min, max: d.max, step: d.step, value: d.value, 'aria-label': d.label, oninput: e => { a[d.key] = +e.target.value; if (d.key === 'smpKrwPerKwh' || d.key === 'recKrwPerKwh') market.basis = 'manual'; render(); } });
      assumpInputs[d.key] = inp;
      return h('div', { class: 'ec-arow', 'data-key': d.key, title: d.note }, h('span', { class: 'ec-alabel' }, d.label, h('span', { class: 'ec-badge', 'data-key': d.key })), h('div', { class: 'ec-unitwrap' }, inp, h('span', { class: 'ec-unit' }, d.unit)));
    }))));
  const resetBtn = h('button', { type: 'button', class: 'ec-link', onclick: () => { Object.assign(a, defaults()); for (const d of ASSUMPTIONS) assumpInputs[d.key].value = d.value; market.basis = 'manual'; render(); } }, '데모 가정값으로 되돌리기');

  // ── 3. 결과
  const badge = h('div', { class: 'ec-rbadge' });
  const tiles = h('div', { class: 'ec-tiles' });
  const breakdown = h('div', { class: 'ec-break' });
  const chart = h('div', { class: 'ec-chart', role: 'img' });
  const tableWrap = h('div', { class: 'ec-table', hidden: '' });
  const tableBtn = h('button', { type: 'button', class: 'ec-link', onclick: () => { state.showTable = !state.showTable; render(); } });
  const errors = h('div', { class: 'ec-errors', role: 'alert', hidden: '' });
  const detail = h('div', { class: 'ec-detail' });
  const ctaLink = h('a', { class: 'btn btn-sky', href: 'contact.html' }, '이 조건으로 무료 정밀 분석 신청 →');

  root.innerHTML = '';
  root.append(
    h('div', { class: 'ec-grid' },
      h('div', { class: 'ec-left' },
        h('div', { class: 'ec-sec-t' }, '1. 조건 입력'),
        h('div', { class: 'ec-modes' }, modeBtns),
        capRow, areaRow, unitToggle, presetBtn,
        tariffBox, marketBox,
        h('details', { class: 'ec-details' }, h('summary', {}, '2. 계산 가정값 보기·수정 ', h('span', { class: 'ec-sum-note' }, '(전부 바꿀 수 있습니다)')), assumpBody, resetBtn),
      ),
      h('div', { class: 'ec-right' },
        h('div', { class: 'ec-sec-t' }, '3. 결과 ', badge),
        errors, tiles, compare, breakdown, chart, detail,
        h('div', { class: 'ec-actions' }, tableBtn, ctaLink),
        tableWrap,
        h('p', { class: 'ec-foot' }, `* 참고용 추정치입니다. 요금 단가 출처: ${TARIFF_SOURCE}. 기본요금(계약전력 기준)은 태양광으로 줄지 않으므로 절감에 넣지 않았습니다. 발전 시간 분포는 전형적 프로파일 가정이며, 실제 사업성은 현장 조사와 최근 12개월 명세로 확정합니다.`),
      ),
    ),
  );

  function render() {
    modeBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === input.mode)));
    capRow.hidden = state.useArea; areaRow.hidden = !state.useArea;
    unitToggle.textContent = state.useArea ? '용량(kW)으로 입력하기' : '용량을 모르면 면적(㎡)으로 입력하기';
    // 요금제 UI
    tariffBox.hidden = input.mode !== 'self';
    groupBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.g === state.sel.group)));
    fillKinds(); fillTariffs();
    const manual = !input.tariffId;
    kindSel.disabled = tariffSel.disabled = manual;
    useManual.textContent = manual ? '요금제를 선택해서 계산하기' : '요금제 대신 평균 단가를 직접 입력하기';
    const tNote = tariffBox.querySelector('.ec-tariff-note');
    const t = TARIFFS.find(x => x.id === input.tariffId);
    tNote.textContent = manual ? `가정값의 '회피 전력 단가'(${a.priceKrwPerKwh}원/kWh)로 계산합니다.` : (t.tou ? `시간대 — 여름·봄가을: ${TOU_TEXT.summer} / 겨울: ${TOU_TEXT.winter}` : '계절별 단일 단가 요금제입니다 (시간대 구분 없음).');
    // 시세 UI (발전판매일 때만)
    const mk = market.data && market.basis !== 'manual' ? ['smpKrwPerKwh', 'recKrwPerKwh'] : [];
    marketBox.hidden = input.mode !== 'sell' || !market.data;
    basisBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.b === market.basis)));
    if (market.data) {
      const d = market.data, note = marketBox.querySelector('.ec-market-note');
      note.textContent = market.basis === 'manual' ? '가정값의 SMP·REC 단가를 그대로 씁니다.' : `SMP ${a.smpKrwPerKwh} 원/kWh · REC ${a.recKrwPerKwh} 원/kWh (${Math.round(a.recKrwPerKwh * 1000).toLocaleString('ko-KR')} 원/REC) — 시세 기준일 SMP ${d.latest.smp.d}${d.latest.rec ? ' · REC ' + d.latest.rec.d : ''}. 20년 수익은 하루 시세에 크게 흔들리므로 기본은 12개월 평균입니다.`;
    }
    // 가정값 배지
    const dk = new Set(demoKeys(a));
    for (const d of ASSUMPTIONS) {
      const b = assumpBody.querySelector(`.ec-badge[data-key="${d.key}"]`);
      const isMk = mk.includes(d.key);
      b.textContent = isMk ? '시세' : dk.has(d.key) ? '데모' : '수정됨'; b.classList.toggle('on', isMk || !dk.has(d.key));
      const row = assumpBody.querySelector(`.ec-arow[data-key="${d.key}"]`);
      row.classList.toggle('off', d.key === 'priceKrwPerKwh' && input.mode === 'self' && !manual);
    }
    const edited = ASSUMPTIONS.length - dk.size - mk.filter(k => !dk.has(k)).length;
    badge.textContent = (mk.length && input.mode === 'sell' ? 'SMP·REC 시세 기준 · ' : '') + (edited ? `가정 ${edited}개 수정 · 나머지 데모값` : '나머지 데모 가정값');

    const r = compute(input, a);
    if (!r.ok) {
      errors.hidden = false; errors.innerHTML = r.errors.map(e => `<div>· ${e}</div>`).join('');
      tiles.innerHTML = ''; breakdown.innerHTML = ''; chart.innerHTML = ''; detail.innerHTML = ''; tableWrap.hidden = true; return;
    }
    errors.hidden = true;
    const sell = r.mode === 'sell';
    const N = r.years.length;
    const savingLabel = sell ? '연간 판매 수익 (1년차)' : '연간 전기요금 절감 (1년차)';
    const savingSub = sell ? `${fmt.int(r.saleUnit)} 원/kWh` : (r.tariff ? `${r.tariff.name} · 유효 단가 ${fmt.dec(r.unitPrice, 1)} 원/kWh (부가세·기금 포함)` : `자가소비 ${fmt.int(r.year1.self / r.year1.gen * 100)}% · 잉여 판매 ${fmt.krw(r.year1.sale)}`);
    tiles.innerHTML = [
      ['연간 예상 발전량 (1년차)', fmt.mwh(r.year1.gen), `${fmt.int(r.capacityKw)} kW 기준 · 자가소비 ${sell ? 0 : a.selfUseRatio}%`],
      [savingLabel, fmt.krw(sell ? r.year1.sale : r.year1.saving), savingSub],
      ['단순 회수기간', fmt.years(r.paybackYears), `투자비 ${fmt.krw(r.capex)} (원단위 ${fmt.int(a.capexKrwPerKw / 10000)}만 원/kW)`],
      [`${N}년 누적 순수익`, fmt.krw(r.totals.cumProject), `운영비 차감 · IRR ${fmt.pct(r.irr)} · NPV ${fmt.krw(r.npv)}`],
    ].map(([k, v, s], i) => `<div class="ec-tile${i === 2 || i === 3 ? ' hi' : ''}"><div class="ec-tk">${k}</div><div class="ec-tv">${v}</div><div class="ec-ts">${s}</div></div>`).join('');

    // 실제 현장 대조 (프리셋 조건과 같을 때만)
    const P = state.preset && !sell && Math.round(r.capacityKw) === state.preset.capacityKw && input.tariffId === state.preset.tariffId ? state.preset : null;
    if (P) {
      const pub = P.published, est = r.year1.saving, diff = (est - pub.annualSavingKrw) / pub.annualSavingKrw;
      compare.innerHTML = `<div class="ec-ct">실제 현장 대조 — ${P.name} (${P.completed} 준공)</div>
        <div class="ec-cmp-grid">
          <div><div class="ec-tk">현장 분석·실측치 (공개)</div><div class="ec-tv">${fmt.krw(pub.annualSavingKrw)}<span class="ec-unit">/년</span></div><div class="ec-ts">${pub.basis}</div></div>
          <div><div class="ec-tk">이 계산기 추정</div><div class="ec-tv">${fmt.krw(est)}<span class="ec-unit">/년</span></div><div class="ec-ts">전형적 발전 시간 분포 가정 · 차이 ${(diff * 100).toFixed(1)}%</div></div>
        </div>
        <div class="ec-ts">실측 시간대 배분(${pub.tou.month}): 경부하 ${fmt.int(pub.tou.light.kwh)} · 중간 ${fmt.int(pub.tou.mid.kwh)} · 최대 ${fmt.int(pub.tou.peak.kwh)} kWh → 월 ${fmt.krw(pub.monthSavingKrw)}. <a href="${P.link}">현장 절감 내역 보기 →</a></div>`;
    } else compare.innerHTML = '';
    // 실제 현장 프리셋에서는 투자비·회수기간(현장 견적 기준, 비공개)을 표시하지 않는다
    const hideInvest = !!P;
    tiles.querySelectorAll('.ec-tile').forEach((t, i) => { t.hidden = hideInvest && i >= 2; });
    chart.hidden = detail.hidden = tableBtn.hidden = hideInvest;
    if (hideInvest) { tableWrap.hidden = true; }
    if (hideInvest && !tiles.querySelector('.ec-hide-note')) tiles.insertAdjacentHTML('beforeend', '<div class="ec-ts ec-hide-note" style="grid-column:1/-1">* 투자비·회수기간은 현장 견적 기준이라 실제 현장 대조에서는 표시하지 않습니다. 내 현장 조건(용량·요금제)으로 바꾸면 다시 계산됩니다.</div>');

    // 시간대별 절감 내역 (요금제 선택 시)
    if (r.tariff && r.tariff.year1) {
      const b = r.tariff.year1;
      const bands = ['light', 'mid', 'peak'];
      const tot = { light: { kwh: 0, krw: 0 }, mid: { kwh: 0, krw: 0 }, peak: { kwh: 0, krw: 0 } };
      SEASONS.forEach(se => bands.forEach(bd => { tot[bd].kwh += b.bands[se][bd].kwh; tot[bd].krw += b.bands[se][bd].krw; }));
      const cell = x => `<td>${fmt.mwh(x.kwh)}</td><td>${fmt.krw(x.krw)}</td>`;
      breakdown.innerHTML = `
        <div class="ec-ct">1년차 절감 내역 — ${r.tariff.name} <span class="ec-sum-note">(자가소비 ${fmt.mwh(b.kwh)})</span></div>
        <div class="ec-table ec-table-in"><table><thead><tr><th>계절</th>${bands.map(bd => `<th colspan="2">${BAND_LABEL[bd]}</th>`).join('')}<th>전력량요금 절감</th></tr></thead><tbody>
          ${SEASONS.map(se => `<tr><td class="l">${SEASON_LABEL[se]}</td>${bands.map(bd => cell(b.bands[se][bd])).join('')}<td><b>${fmt.krw(bands.reduce((s, bd) => s + b.bands[se][bd].krw, 0))}</b></td></tr>`).join('')}
          <tr class="sum"><td class="l">연간 합계</td>${bands.map(bd => cell(tot[bd])).join('')}<td><b>${fmt.krw(b.energy)}</b></td></tr>
        </tbody></table></div>
        <div class="ec-break-rows">
          <div class="ec-drow"><span>① 전력량요금 절감 (시간대별 합계)</span><b>${fmt.krw(b.energy)}</b></div>
          <div class="ec-drow"><span>② 기후환경요금 절감 (${a.climateKrwPerKwh}원/kWh)</span><b>${fmt.krw(b.climate)}</b></div>
          <div class="ec-drow"><span>③ 연료비조정액 절감 (${a.fuelAdjKrwPerKwh}원/kWh)</span><b>${fmt.krw(b.fuel)}</b></div>
          <div class="ec-drow sub"><span>전기요금 절감 소계 (①+②+③)</span><b>${fmt.krw(b.subtotal)}</b></div>
          <div class="ec-drow"><span>④ 부가가치세 절감 (소계 × 10%)</span><b>${fmt.krw(b.vat)}</b></div>
          <div class="ec-drow"><span>⑤ 전력산업기반기금 절감 (소계 × 2.7%)</span><b>${fmt.krw(b.fund)}</b></div>
          <div class="ec-drow tot"><span>1년차 총 절감 (청구금액 기준)</span><b>${fmt.krw(b.total)}</b></div>
          ${r.year1.sale > 0 ? `<div class="ec-drow"><span>+ 잉여 전력 판매 (자가소비 외 ${100 - a.selfUseRatio}%)</span><b>${fmt.krw(r.year1.sale)}</b></div>` : ''}
        </div>
        <div class="ec-ts">※ 기본요금(${r.tariff.basic.toLocaleString('ko-KR')}원/kW × 요금적용전력)은 태양광으로 줄지 않아 제외. 역률요금·할증은 반영하지 않음. 토요일 최대부하→중간부하, 공휴일→경부하 계량 규칙 반영${r.tariff.name.includes('산업용 (을)') ? ', 봄·가을 주말 11~14시 50% 할인 반영' : ''}.</div>`;
    } else breakdown.innerHTML = '';

    // 누적 현금흐름 차트 (SVG)
    const W = 640, H = 220, pl = 48, pr = 12, pt = 14, pb = 28;
    const vals = r.years.map(y => y.cumProject);
    const lo = Math.min(-r.capex, ...vals), hi = Math.max(0, ...vals);
    const sy = v => pt + (hi - v) / (hi - lo || 1) * (H - pt - pb);
    const bw = (W - pl - pr) / N, zero = sy(0);
    const bars = r.years.map((y, i) => { const v = y.cumProject; const x = pl + i * bw; const top = Math.min(sy(v), zero), hgt = Math.abs(sy(v) - zero);
      return `<rect x="${x + 1}" y="${top}" width="${Math.max(bw - 2, 1)}" height="${Math.max(hgt, 1)}" rx="2" class="${v < 0 ? 'neg' : 'pos'}"><title>${y.y}년차 누적 ${fmt.krw(v)}</title></rect>`; }).join('');
    const ticks = []; for (let y = 5; y <= N; y += 5) ticks.push(`<text x="${pl + (y - 0.5) * bw}" y="${H - 8}" text-anchor="middle">${y}년</text>`);
    const yl = [lo, 0, hi].map(v => `<text x="${pl - 6}" y="${sy(v) + 4}" text-anchor="end">${fmt.krw(v).replace(' 원', '')}</text>`).join('');
    const pbLine = r.paybackYears != null ? `<line x1="${pl + r.paybackYears * bw}" y1="${pt}" x2="${pl + r.paybackYears * bw}" y2="${H - pb}" class="pb"/><text x="${pl + r.paybackYears * bw + 4}" y="${pt + 12}" class="pbt">회수 ${r.paybackYears.toFixed(1)}년</text>` : '';
    chart.innerHTML = `<div class="ec-ct">누적 현금흐름 (투자비 차감, 운영비 반영)</div><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="연차별 누적 현금흐름">${bars}<line x1="${pl}" y1="${zero}" x2="${W - pr}" y2="${zero}" class="zero"/>${yl}${ticks.join('')}${pbLine}</svg>`;
    chart.setAttribute('aria-label', `누적 현금흐름: ${N}년 후 ${fmt.krw(r.totals.cumProject)}, 회수기간 ${fmt.years(r.paybackYears)}`);

    detail.innerHTML = `
      <div class="ec-drow"><span>투자비</span><b>${fmt.krw(r.capex)}</b></div>
      ${r.loan > 0 ? `<div class="ec-drow"><span>대출 ${fmt.int(a.loanRatio)}% · 연 상환액</span><b>${fmt.krw(r.loan)} · ${fmt.krw(r.debtYear)}/년</b></div><div class="ec-drow"><span>자기자본 회수기간 · 자기자본 IRR</span><b>${fmt.years(r.paybackEquityYears)} · ${fmt.pct(r.irrEquity)}</b></div>` : ''}
      <div class="ec-drow"><span>연간 운영비</span><b>${fmt.krw(r.opex)}</b></div>
      <div class="ec-drow"><span>균등화 발전원가 (LCOE)</span><b>${r.lcoe != null ? fmt.dec(r.lcoe, 0) + ' 원/kWh' : '—'}</b></div>
      <div class="ec-drow"><span>${N}년 총 발전량 · 총 수익</span><b>${fmt.mwh(r.totals.gen)} · ${fmt.krw(r.totals.income)}</b></div>`;

    tableBtn.textContent = state.showTable ? '연차별 표 닫기' : '연차별 표 보기';
    tableWrap.hidden = !state.showTable;
    if (state.showTable) {
      tableWrap.innerHTML = `<table><thead><tr><th>연차</th><th>발전량</th><th>${sell ? '판매' : '절감'}</th>${sell ? '' : '<th>잉여판매</th>'}<th>운영비</th>${r.loan > 0 ? '<th>상환</th>' : ''}<th>순수익</th><th>누적</th></tr></thead><tbody>${r.years.map(y =>
        `<tr><td>${y.y}</td><td>${fmt.mwh(y.gen)}</td><td>${fmt.krw(sell ? y.sale : y.saving)}</td>${sell ? '' : `<td>${fmt.krw(y.sale)}</td>`}<td>${fmt.krw(y.opex)}</td>${r.loan > 0 ? `<td>${fmt.krw(y.debt)}</td>` : ''}<td>${fmt.krw(y.net)}</td><td class="${y.cum < 0 ? 'neg' : ''}">${fmt.krw(y.cum)}</td></tr>`).join('')}</tbody></table>`;
    }
    const summary = `[경제성 계산기 결과] ${sell ? '발전판매' : '자가소비'}${r.tariff ? ' · ' + r.tariff.name : ''} · ${fmt.int(r.capacityKw)} kW · 연 ${fmt.mwh(r.year1.gen)} · ${sell ? '판매' : '절감'} ${fmt.krw(sell ? r.year1.sale : r.year1.saving)}/년 · 회수 ${fmt.years(r.paybackYears)} (가정: ${edited ? edited + '개 수정' : '데모값'})`;
    ctaLink.href = 'contact.html?calc=' + encodeURIComponent(summary) + '#form';
  }
  if (prefill.preset) applyPreset(prefill.preset);
  render();
  return { get state() { return { input: { ...input }, assumptions: { ...a } }; }, render };
}
