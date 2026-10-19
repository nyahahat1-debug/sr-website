// ─────────────────────────────────────────────────────────────
// 경제성 계산 모델 (순수 함수 — DOM·3D 와 무관)
//
// 지시서 7항 준수:
//  · 검증되지 않은 요금·SMP·REC·지원금은 "가정값"으로만 두고, 전부 화면에 노출·수정 가능 (source: 'demo')
//  · 실제 기준값이 확정되면 ASSUMPTIONS 의 value 와 source 를 'admin' 으로 바꾸면 된다
//  · 계산식은 아래에 전부 적혀 있고 model.test.mjs 로 검증한다
// ─────────────────────────────────────────────────────────────

import { tariffById, tariffSavings, CHARGES } from './tariff.js';

/** 가정값 정의. value 는 데모값이며 UI 에서 사용자가 바꿀 수 있다. */
export const ASSUMPTIONS = [
  // 발전
  { key: 'yieldKwhPerKw',   group: '발전',  label: '연간 발전량 원단위',   unit: 'kWh/kW·년', value: 1300,    min: 800,  max: 1800, step: 10,   source: 'demo', note: '국내 지붕형 일반 범위 1,200~1,400. 현장 일사량·방위·음영으로 확정' },
  { key: 'degradationRate', group: '발전',  label: '연간 출력 감소율',     unit: '%/년',      value: 0.5,     min: 0,    max: 2,    step: 0.1,  source: 'demo', note: '모듈 제조사 보증서 기준값으로 교체' },
  { key: 'kwPerM2',         group: '발전',  label: '면적당 설치 용량',     unit: 'kW/㎡',     value: 0.12,    min: 0.05, max: 0.2,  step: 0.01, source: 'demo', note: '약 8.3 ㎡/kW. 지붕 형상·이격에 따라 다름' },
  // 자가소비
  { key: 'selfUseRatio',    group: '요금',  label: '자가소비 비율',        unit: '%',         value: 85,      min: 0,    max: 100,  step: 1,    source: 'demo', note: '낮 시간 부하 패턴 분석으로 확정. 나머지는 계통 송전' },
  { key: 'priceKrwPerKwh',  group: '요금',  label: '회피 전력 단가 (요금제 미선택 시)', unit: '원/kWh', value: 150, min: 50, max: 400, step: 1, source: 'demo', note: '요금제를 선택하면 이 값 대신 요금표 단가로 계산' },
  { key: 'climateKrwPerKwh', group: '요금', label: '기후환경요금 단가',    unit: '원/kWh',    value: 9,       min: 0,    max: 30,   step: 0.1,  source: 'demo', note: '명세서의 기후환경요금 ÷ 사용량으로 확인 (2025-12 명세서: 9원)' },
  { key: 'fuelAdjKrwPerKwh', group: '요금', label: '연료비조정단가',       unit: '원/kWh',    value: 5,       min: -5,   max: 5,    step: 0.1,  source: 'demo', note: '상·하한 ±5원. 명세서의 연료비조정액 ÷ 사용량 (2025-12: +5원)' },
  { key: 'priceEscalation', group: '요금',  label: '전기요금 연간 상승률', unit: '%/년',      value: 3,       min: 0,    max: 10,   step: 0.5,  source: 'demo', note: '보수적으로 낮게 잡는 것을 권장' },
  // 판매
  { key: 'smpKrwPerKwh',    group: '판매',  label: 'SMP (계통한계가격)',   unit: '원/kWh',    value: 120,     min: 50,   max: 300,  step: 1,    source: 'demo', note: '전력거래소 월별 공시값으로 교체' },
  { key: 'recKrwPerKwh',    group: '판매',  label: 'REC 단가',             unit: '원/kWh',    value: 70,      min: 0,    max: 200,  step: 1,    source: 'demo', note: 'REC 현물·계약 시장 가격으로 교체' },
  { key: 'recWeight',       group: '판매',  label: 'REC 가중치',           unit: '배',        value: 1.5,     min: 0.5,  max: 2,    step: 0.1,  source: 'demo', note: '설치 유형(건축물·일반 등)별 고시 가중치 확인' },
  // 투자·운영
  { key: 'capexKrwPerKw',   group: '투자',  label: '투자비 원단위',        unit: '원/kW',     value: 1300000, min: 500000, max: 3000000, step: 10000, source: 'demo', note: '현장 견적으로 확정. 구조물·계통연계 조건에 따라 큰 차이' },
  { key: 'opexRate',        group: '투자',  label: '연간 운영비 (투자비 대비)', unit: '%/년',  value: 1.0,     min: 0,    max: 5,    step: 0.1,  source: 'demo', note: 'O&M·보험·모니터링 포함' },
  { key: 'lifetimeYears',   group: '투자',  label: '분석 기간',            unit: '년',        value: 20,      min: 5,    max: 30,   step: 1,    source: 'demo', note: '모듈 출력 보증 기간 기준' },
  { key: 'discountRate',    group: '투자',  label: '할인율 (NPV)',         unit: '%',         value: 5,       min: 0,    max: 15,   step: 0.5,  source: 'demo', note: '자본비용·기대수익률' },
  // 금융
  { key: 'loanRatio',       group: '금융',  label: '대출 비율',            unit: '%',         value: 0,       min: 0,    max: 90,   step: 5,    source: 'demo', note: '0 이면 전액 자기자본' },
  { key: 'loanInterest',    group: '금융',  label: '대출 금리',            unit: '%/년',      value: 5,       min: 0,    max: 15,   step: 0.1,  source: 'demo', note: '' },
  { key: 'loanYears',       group: '금융',  label: '대출 기간',            unit: '년',        value: 10,      min: 1,    max: 25,   step: 1,    source: 'demo', note: '원리금 균등 상환 가정' },
];

/** 기본 가정값 객체 */
export function defaults() {
  const o = {}; for (const a of ASSUMPTIONS) o[a.key] = a.value; return o;
}

/** 입력·가정 검증. 문제가 있으면 메시지 배열, 없으면 빈 배열 */
export function validate(input, a) {
  const err = [];
  const num = v => typeof v === 'number' && Number.isFinite(v);
  if (!['self', 'sell'].includes(input.mode)) err.push('방식은 자가소비(self) 또는 발전판매(sell) 중 하나여야 합니다.');
  const cap = capacityOf(input, a);
  if (!num(cap) || cap <= 0) err.push('설치 용량(kW) 또는 면적(㎡)을 입력해 주세요.');
  else if (cap > 100000) err.push('설치 용량이 비정상적으로 큽니다 (100,000 kW 초과).');
  for (const d of ASSUMPTIONS) {
    const v = a[d.key];
    if (!num(v)) err.push(`${d.label} 값이 숫자가 아닙니다.`);
    else if (v < d.min || v > d.max) err.push(`${d.label}: ${d.min}~${d.max} ${d.unit} 범위여야 합니다.`);
  }
  return err;
}

/** 용량: kW 직접 입력이 우선, 없으면 면적 × 원단위 */
export function capacityOf(input, a) {
  if (Number.isFinite(input.capacityKw) && input.capacityKw > 0) return input.capacityKw;
  if (Number.isFinite(input.areaM2) && input.areaM2 > 0) return input.areaM2 * a.kwPerM2;
  return NaN;
}

/** 원리금 균등 연 상환액 */
export function annuity(principal, rate, years) {
  if (principal <= 0 || years <= 0) return 0;
  if (rate === 0) return principal / years;
  const q = Math.pow(1 + rate, years);
  return principal * rate * q / (q - 1);
}

/** 현금흐름 NPV. flows[0] 은 0년차(투자) */
export function npv(rate, flows) {
  return flows.reduce((s, f, t) => s + f / Math.pow(1 + rate, t), 0);
}

/** IRR (이분법). 해가 없으면 null */
export function irr(flows, lo = -0.99, hi = 1.0) {
  let fLo = npv(lo, flows), fHi = npv(hi, flows);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi) || fLo * fHi > 0) return null;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2, fm = npv(mid, flows);
    if (Math.abs(fm) < 1e-6) return mid;
    if (fLo * fm < 0) { hi = mid; fHi = fm; } else { lo = mid; fLo = fm; }
  }
  return (lo + hi) / 2;
}

/**
 * 경제성 계산.
 * @param input { mode:'self'|'sell', capacityKw?, areaM2? }
 * @param a     가정값 객체 (defaults() 기반, 사용자가 일부 수정 가능)
 */
export function compute(input, a = defaults()) {
  const errors = validate(input, a);
  if (errors.length) return { ok: false, errors };

  const cap = capacityOf(input, a);
  const N = Math.round(a.lifetimeYears);
  const selfRatio = input.mode === 'sell' ? 0 : a.selfUseRatio / 100;
  const deg = a.degradationRate / 100, esc = a.priceEscalation / 100;
  const capex = cap * a.capexKrwPerKw;
  const loan = capex * a.loanRatio / 100, equity = capex - loan;
  const debtYear = annuity(loan, a.loanInterest / 100, a.loanYears);
  const opex = capex * a.opexRate / 100;
  const saleUnit = a.smpKrwPerKwh + a.recKrwPerKwh * a.recWeight;   // 원/kWh (판매)
  // 요금제가 선택되면: 1년차 자가소비 전력량을 계절·시간대별로 나눠 요금표 단가 + 기후환경·연료비 + 부가세·기금까지 반영한 "유효 회피단가"를 쓴다
  const tariff = input.mode === 'self' && input.tariffId ? tariffById(input.tariffId) : null;
  const charges = { ...CHARGES, climateKrwPerKwh: a.climateKrwPerKwh, fuelAdjKrwPerKwh: a.fuelAdjKrwPerKwh };
  const selfKwh1 = cap * a.yieldKwhPerKw * selfRatio;
  const tariffY1 = tariff ? tariffSavings(tariff, selfKwh1, charges) : null;
  const unitPrice = tariffY1 ? tariffY1.effectiveRate : a.priceKrwPerKwh;

  const years = [];
  let cum = -equity, cumProject = -capex;
  const projectFlows = [-capex], equityFlows = [-equity];
  let payback = null, paybackProject = null;
  for (let y = 1; y <= N; y++) {
    const gen = cap * a.yieldKwhPerKw * Math.pow(1 - deg, y - 1);
    const self = gen * selfRatio, exp = gen - self;
    const price = unitPrice * Math.pow(1 + esc, y - 1);
    const saving = self * price, sale = exp * saleUnit;
    const income = saving + sale;
    const debt = y <= a.loanYears ? debtYear : 0;
    const netProject = income - opex;
    const net = netProject - debt;
    const prevCum = cum, prevCumP = cumProject;
    cum += net; cumProject += netProject;
    projectFlows.push(netProject); equityFlows.push(net);
    if (payback === null && cum >= 0) payback = net > 0 ? (y - 1) + (-prevCum) / net : y;
    if (paybackProject === null && cumProject >= 0) paybackProject = netProject > 0 ? (y - 1) + (-prevCumP) / netProject : y;
    years.push({ y, gen, self, export: exp, price, saving, sale, income, opex, debt, net, netProject, cum, cumProject });
  }
  const r = a.discountRate / 100;
  const genPV = years.reduce((s, yr) => s + yr.gen / Math.pow(1 + r, yr.y), 0);
  const costPV = capex + years.reduce((s, yr) => s + opex / Math.pow(1 + r, yr.y), 0);
  const y1 = years[0];
  return {
    ok: true, errors: [],
    mode: input.mode, capacityKw: cap, capex, equity, loan, debtYear, opex, saleUnit, unitPrice,
    tariff: tariff ? { id: tariff.id, name: tariff.name, basic: tariff.basic, tou: tariff.tou, year1: tariffY1 } : null,
    year1: { gen: y1.gen, self: y1.self, export: y1.export, saving: y1.saving, sale: y1.sale, income: y1.income, net: y1.net },
    totals: {
      gen: years.reduce((s, x) => s + x.gen, 0),
      income: years.reduce((s, x) => s + x.income, 0),
      netProject: years.reduce((s, x) => s + x.netProject, 0),
      net: years.reduce((s, x) => s + x.net, 0),
      cumProject: cumProject, cum,
    },
    paybackYears: paybackProject, paybackEquityYears: payback,
    npv: npv(r, projectFlows), irr: irr(projectFlows), irrEquity: loan > 0 ? irr(equityFlows) : null,
    lcoe: genPV > 0 ? costPV / genPV : null,
    years,
  };
}

/** 가정값 중 데모값(수정 안 됨)인 키 목록 */
export function demoKeys(a) {
  return ASSUMPTIONS.filter(d => d.source === 'demo' && a[d.key] === d.value).map(d => d.key);
}

/** 표기용 포맷 */
export const fmt = {
  int: n => Math.round(n).toLocaleString('ko-KR'),
  dec: (n, d = 1) => n.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d }),
  /** 원 → "1억 2,345만 원" / "2,345만 원" / "-3,200만 원" */
  krw(n) {
    const neg = n < 0; const man = Math.round(Math.abs(n) / 10000);
    const s = man >= 10000 ? `${Math.floor(man / 10000)}억 ${(man % 10000).toLocaleString('ko-KR')}만 원` : `${man.toLocaleString('ko-KR')}만 원`;
    return (neg ? '-' : '') + s;
  },
  mwh: kwh => `${(kwh / 1000).toLocaleString('ko-KR', { maximumFractionDigits: 0 })} MWh`,
  pct: (x, d = 1) => x == null ? '—' : `${(x * 100).toFixed(d)}%`,
  years: y => y == null ? '분석 기간 내 회수 안 됨' : `${y.toFixed(1)}년`,
};
