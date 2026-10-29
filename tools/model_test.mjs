// 경제성 계산 모델 회귀 검사 — node tools/model_test.mjs (브라우저 불필요)
//   단위(원/kW·kWh·MWh), 자가소비/판매 모드, 0·빈 값·음수·극단값, 회수 불가, 단순 회수기간, 문의 요약문 일치
import { compute, defaults, fmt, summaryLine, capacityOf } from '../assets/js/economics/model.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('  FAIL', msg); } else console.log('  ok  ', msg); };
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

console.log('1) 자가소비 500kW · 산업용(을) 고압A 선택Ⅰ · 데모 가정값');
{
  const a = defaults(); const r = compute({ mode: 'self', capacityKw: 500, tariffId: 'ie-ha1' }, a);
  ok(r.ok, '계산 성공');
  ok(near(r.capex, 500 * 1300000), `투자비 = 용량 × 원단위 (${fmt.krw(r.capex)})`);
  ok(near(r.year1.gen, 500 * 1300), `1년차 발전량 = 용량 × 원단위 kWh/kW (${fmt.mwh(r.year1.gen)})`);
  ok(near(r.year1.self, r.year1.gen * 0.85), '자가소비 85%');
  ok(r.year1.saving > 0 && r.year1.saving === r.year1.self * r.unitPrice, '절감 = 자가소비 kWh × 유효 단가');
  ok(r.tariff && r.tariff.year1 && near(r.tariff.year1.total, r.year1.saving, 1e-9), '요금제 절감 합계(부가세·기금 포함) = 1년차 절감');
  ok(r.simplePaybackYears != null && near(r.simplePaybackYears, r.capex / (r.year1.income - r.opex)), `단순 회수 = 투자비 ÷ 1년차 순수익 (${fmt.years(r.simplePaybackYears)})`);
  ok(r.paybackYears != null && r.paybackYears < r.simplePaybackYears, `누적 현금흐름 회수(${fmt.years(r.paybackYears)})는 요금 상승 반영으로 단순 회수보다 짧다`);
  const s = summaryLine(r, a, 0);
  ok(s.includes(fmt.krw(r.year1.saving)) && s.includes(fmt.years(r.paybackYears)) && s.includes(fmt.krw(r.capex)), '문의 요약문에 화면과 같은 절감·회수·투자비 표기');
  ok(s.includes('청구금액 기준') && s.includes('누적 현금흐름 기준'), '요약문에 기준 명시');
}

console.log('2) 발전판매 1,000kW · SMP 120 · REC 70원/kWh × 1.5');
{
  const a = defaults(); const r = compute({ mode: 'sell', capacityKw: 1000 }, a);
  ok(r.ok && r.year1.self === 0 && r.year1.saving === 0, '판매 모드는 자가소비 0');
  ok(near(r.saleUnit, 120 + 70 * 1.5), `판매 단가 = SMP + REC×가중치 = ${r.saleUnit} 원/kWh`);
  ok(near(r.year1.sale, 1000 * 1300 * r.saleUnit), '1년차 판매 = 발전량 × 단가 (부가세 별도)');
  ok(summaryLine(r, a, 0).includes('판매(부가세 별도)'), '요약문에 부가세 별도 표기');
}

console.log('3) 0·빈 값·음수·극단값');
{
  const a = defaults();
  ok(!compute({ mode: 'self', capacityKw: 0 }, a).ok, '용량 0 → 오류');
  ok(!compute({ mode: 'self', capacityKw: -5 }, a).ok, '용량 음수 → 오류');
  ok(!compute({ mode: 'self', capacityKw: NaN, areaM2: null }, a).ok, '빈 값 → 오류');
  ok(!compute({ mode: 'self', capacityKw: 200000 }, a).ok, '100,000kW 초과 → 오류');
  ok(!compute({ mode: 'x', capacityKw: 100 }, a).ok, '모드 오류');
  ok(near(capacityOf({ areaM2: 1000 }, a), 120), '면적 1,000㎡ × 0.12 = 120kW');
  const bad = { ...a, yieldKwhPerKw: 5000 }; ok(!compute({ mode: 'self', capacityKw: 100 }, bad).ok, '가정값 범위 밖 → 오류');
}

console.log('4) 회수 불가 상황');
{
  const a = { ...defaults(), yieldKwhPerKw: 800, capexKrwPerKw: 3000000, priceEscalation: 0, selfUseRatio: 10, opexRate: 5 };
  const r = compute({ mode: 'self', capacityKw: 100, tariffId: null }, a);
  ok(r.ok, '계산은 성공');
  ok(r.paybackYears == null, '누적 현금흐름 회수기간 null (20년 안에 회수 안 됨)');
  ok(r.simplePaybackYears == null || r.simplePaybackYears > a.lifetimeYears, `단순 회수기간은 null 이거나 분석 기간 초과 (${fmt.years(r.simplePaybackYears)})`);
  ok(fmt.years(r.paybackYears) === '분석 기간 내 회수 안 됨', '표기: 분석 기간 내 회수 안 됨');
  ok(summaryLine(r, a, 3).includes('회수 안 됨'), '요약문도 회수 안 됨');
}

console.log('5) 표기 단위');
{
  ok(fmt.krw(10246e4) === '1억 246만 원', 'krw 억·만 표기');
  ok(fmt.krw(-32000000) === '-3,200만 원', '음수 표기');
  ok(fmt.mwh(650000) === '650 MWh', 'kWh → MWh');
}

console.log(fails ? `\n실패 ${fails}건` : '\n전부 통과');
process.exit(fails ? 1 : 0);
