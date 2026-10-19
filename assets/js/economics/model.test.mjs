// node --test assets/js/economics/model.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASSUMPTIONS, defaults, compute, validate, annuity, npv, irr, capacityOf, demoKeys, fmt } from './model.js';

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);

test('기본 가정값은 전부 정의된 범위 안', () => {
  const a = defaults();
  for (const d of ASSUMPTIONS) assert.ok(a[d.key] >= d.min && a[d.key] <= d.max, d.key);
  assert.equal(validate({ mode: 'self', capacityKw: 100 }, a).length, 0);
});

test('1년차 수치 손계산 일치 (자가소비 100kW)', () => {
  const a = { ...defaults(), yieldKwhPerKw: 1000, selfUseRatio: 100, priceKrwPerKwh: 100, priceEscalation: 0, degradationRate: 0, capexKrwPerKw: 1000000, opexRate: 1, loanRatio: 0 };
  const r = compute({ mode: 'self', capacityKw: 100 }, a);
  assert.ok(r.ok);
  near(r.year1.gen, 100000);          // 100 kW × 1,000
  near(r.year1.saving, 10000000);     // 100,000 kWh × 100 원
  near(r.year1.sale, 0);
  near(r.capex, 100000000);
  near(r.opex, 1000000);
  near(r.year1.net, 9000000);
  near(r.paybackYears, 100000000 / 9000000); // 11.11년
});

test('발전판매 모드는 자가소비 0, 판매단가 = SMP + REC×가중치', () => {
  const a = { ...defaults(), smpKrwPerKwh: 100, recKrwPerKwh: 50, recWeight: 1.5, yieldKwhPerKw: 1000, degradationRate: 0 };
  const r = compute({ mode: 'sell', capacityKw: 10 }, a);
  near(r.year1.self, 0);
  near(r.year1.export, 10000);
  near(r.saleUnit, 175);
  near(r.year1.sale, 1750000);
});

test('출력 감소율·요금 상승률이 연차에 반영', () => {
  const a = { ...defaults(), degradationRate: 1, priceEscalation: 10, selfUseRatio: 100, lifetimeYears: 5 };
  const r = compute({ mode: 'self', capacityKw: 1 }, a);
  near(r.years[1].gen, r.years[0].gen * 0.99);
  near(r.years[2].gen, r.years[0].gen * 0.99 * 0.99);
  near(r.years[1].price, r.years[0].price * 1.1);
});

test('면적 입력 → 용량 환산', () => {
  const a = { ...defaults(), kwPerM2: 0.1 };
  near(capacityOf({ areaM2: 2000 }, a), 200);
  assert.ok(Number.isNaN(capacityOf({}, a)));
  near(capacityOf({ capacityKw: 50, areaM2: 2000 }, a), 50); // kW 우선
});

test('검증: 잘못된 입력은 오류 메시지, compute 는 ok:false', () => {
  const a = defaults();
  assert.ok(validate({ mode: 'self' }, a).some(m => m.includes('용량')));
  assert.ok(validate({ mode: 'x', capacityKw: 1 }, a).length > 0);
  assert.ok(validate({ mode: 'self', capacityKw: 1 }, { ...a, yieldKwhPerKw: 99999 }).some(m => m.includes('연간 발전량')));
  assert.ok(validate({ mode: 'self', capacityKw: 1 }, { ...a, smpKrwPerKwh: NaN }).some(m => m.includes('숫자')));
  const r = compute({ mode: 'self', capacityKw: 0 }, a);
  assert.equal(r.ok, false); assert.ok(r.errors.length);
});

test('원리금 균등 상환액', () => {
  near(annuity(1000, 0, 10), 100);
  near(annuity(100000000, 0.05, 10), 12950457.5, 1e-6);  // 1억, 5%, 10년
  near(annuity(0, 0.05, 10), 0);
});

test('대출이 있으면 연 상환액이 대출 기간에만 차감되고 자기자본 회수기간이 바뀐다', () => {
  const a = { ...defaults(), loanRatio: 50, loanInterest: 5, loanYears: 5, lifetimeYears: 10, degradationRate: 0, priceEscalation: 0 };
  const r = compute({ mode: 'self', capacityKw: 100 }, a);
  near(r.loan, r.capex * 0.5); near(r.equity, r.capex * 0.5);
  assert.ok(r.years[0].debt > 0 && r.years[5].debt === 0);
  near(r.years[0].net, r.years[0].netProject - r.debtYear);
  assert.ok(r.irrEquity !== null);
});

test('NPV / IRR 정합: IRR 에서 NPV ≈ 0, 할인율 0 이면 NPV = 누적 현금흐름', () => {
  const flows = [-1000, 300, 300, 300, 300, 300];
  const r = irr(flows); assert.ok(r > 0.15 && r < 0.16);
  near(npv(r, flows), 0, 1e-3);
  near(npv(0, flows), 500);
  assert.ok(irr([-100, 1, 1, 1]) < 0);          // 투자 회수 불가 → 음(-)의 IRR
  const res = compute({ mode: 'self', capacityKw: 100 }, { ...defaults(), discountRate: 0 });
  near(res.npv, res.totals.cumProject, 1e-6);   // 합산 순서 차이만큼의 부동소수 오차 허용
});

test('회수기간 보간: 누적이 0 을 넘는 해에 선형 보간', () => {
  const a = { ...defaults(), yieldKwhPerKw: 1000, selfUseRatio: 100, priceKrwPerKwh: 400, priceEscalation: 0, degradationRate: 0, capexKrwPerKw: 1000000, opexRate: 0, lifetimeYears: 5 };
  // 연 순수익 400,000원/kW, 투자 1,000,000원/kW → 2.5년
  near(compute({ mode: 'self', capacityKw: 1 }, a).paybackYears, 2.5);
  const never = compute({ mode: 'self', capacityKw: 1 }, { ...a, capexKrwPerKw: 3000000 });
  assert.equal(never.paybackYears, null);
});

test('LCOE 는 비용 현가 / 발전량 현가', () => {
  const a = { ...defaults(), yieldKwhPerKw: 1000, degradationRate: 0, capexKrwPerKw: 1000000, opexRate: 0, discountRate: 0, lifetimeYears: 20 };
  near(compute({ mode: 'self', capacityKw: 1 }, a).lcoe, 1000000 / 20000);   // 50 원/kWh
});

test('결과에 NaN/Infinity 없음 (가정 범위 극단값)', () => {
  for (const d of ASSUMPTIONS) for (const v of [d.min, d.max]) {
    const r = compute({ mode: 'self', capacityKw: 500 }, { ...defaults(), [d.key]: v });
    assert.ok(r.ok, d.key);
    const walk = o => Object.values(o).forEach(x => { if (typeof x === 'number') assert.ok(Number.isFinite(x), `${d.key}=${v}`); else if (x && typeof x === 'object') walk(x); });
    walk({ ...r, years: r.years.slice(0, 2), irr: r.irr ?? 0, irrEquity: r.irrEquity ?? 0, lcoe: r.lcoe ?? 0, paybackYears: r.paybackYears ?? 0, paybackEquityYears: r.paybackEquityYears ?? 0 });
  }
});

test('demoKeys: 수정한 가정은 데모 목록에서 빠진다', () => {
  const a = defaults(); a.priceKrwPerKwh = 160;
  const k = demoKeys(a);
  assert.ok(!k.includes('priceKrwPerKwh') && k.includes('smpKrwPerKwh'));
});

test('포맷', () => {
  assert.equal(fmt.krw(123456789), '1억 2,346만 원');
  assert.equal(fmt.krw(-32000000), '-3,200만 원');
  assert.equal(fmt.years(null), '분석 기간 내 회수 안 됨');
  assert.equal(fmt.pct(0.1234), '12.3%');
});

test('요금제 선택 시: 유효 단가가 요금표+부가항목으로 계산되고, 결과에 시간대별 내역이 붙는다', () => {
  const a = defaults();
  const manual = compute({ mode: 'self', capacityKw: 500 }, a);
  const withT = compute({ mode: 'self', capacityKw: 500, tariffId: 'ie-ha1' }, a);
  assert.ok(withT.ok && withT.tariff && withT.tariff.year1);
  assert.equal(withT.tariff.name, '산업용 (을) 고압A 선택Ⅰ');
  near(withT.unitPrice, withT.tariff.year1.effectiveRate);
  near(withT.year1.saving, withT.tariff.year1.total);          // 1년차 절감 = 전력량+기후환경+연료비+부가세+기금
  assert.ok(withT.unitPrice > manual.unitPrice);                 // 산업용(을) 유효단가(부가세 포함) > 데모 150원
  const sell = compute({ mode: 'sell', capacityKw: 500, tariffId: 'ie-ha1' }, a);
  assert.equal(sell.tariff, null);                               // 판매 모드는 요금제 무관
});
