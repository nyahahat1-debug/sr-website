// 경제성 계산 모델 회귀 검사 — node tools/model_test.mjs (브라우저 불필요)
//   단위(원/kW·kWh·MWh), 자가소비/판매 모드, 0·빈 값·음수·극단값, 회수 불가, 단순 회수기간, 문의 요약문 일치
import { compute, defaults, fmt, summaryLine, capacityOf, MODEL_VERSION } from '../assets/js/economics/model.js';
import { calcRecord, encodeCalc, decodeCalc, validateCalc, verifyCalc, CALC_SCHEMA } from '../assets/js/economics/calc-transfer.js';
import { publishedMonthTotal, fundRateAt, monthlySelfUse } from '../assets/js/economics/selfuse.js';
import { SITE_PRESETS } from '../assets/js/economics/presets.js';
import { canonical } from '../assets/js/contact/transport.js';

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

console.log('6) 구조화된 계산 조건 (calcd) — 생성·인코딩·검증·재계산 일치');
{
  const a = defaults(); a.smpKrwPerKwh = 125.3; a.recKrwPerKwh = 71.5;
  const input = { mode: 'self', capacityKw: 500, tariffId: 'ie-ha1' };
  const r = compute(input, a);
  const rec = calcRecord({ r, a, input, market: { basis: 'avg365', updated: '2026-10-23T19:04:28+09:00', applied: ['smpKrwPerKwh', 'recKrwPerKwh'] }, edited: 0, now: new Date('2026-10-29T01:02:03Z') });
  ok(rec.schema === CALC_SCHEMA && rec.model === MODEL_VERSION && rec.computedAt === '2026-10-29T01:02:03.000Z', '스키마·모델 버전·계산 시점');
  ok(rec.mode === 'self' && rec.capacityKw === 500 && rec.tariffId === 'ie-ha1', '모드·용량·요금제');
  ok(rec.assumptions.capexKrwPerKw === 1300000 && rec.assumptions.smpKrwPerKwh === 125.3 && Object.keys(rec.assumptions).length === 18, '가정값 18개 전부 포함(시세 반영값 포함)');
  ok(rec.market.basis === 'avg365' && rec.market.updated === '2026-10-23', '가격 데이터 기준(기준 기간·갱신일)');
  ok(rec.result.year1SavingKrw === r.year1.saving && rec.result.paybackYears === r.paybackYears && rec.result.capexKrw === r.capex, '결과 = 계산기 결과');
  ok(rec.assumptionSource.demo === true && /확정 견적|보장 수익/.test(rec.disclaimer), '데모 가정 표시 + 확정 견적·보장 수익 아님 고지');
  ok(!JSON.stringify(rec).match(/담당자|연락처|주소|@/), '개인정보 없음');
  const enc = encodeCalc(rec);
  ok(/^[A-Za-z0-9_-]+$/.test(enc) && enc.length <= 2000, `base64url 인코딩 (${enc.length}자)`);
  const dec = decodeCalc(enc);
  ok(dec && JSON.stringify(dec) === JSON.stringify(rec), '디코드 왕복 일치');
  ok(validateCalc(dec).length === 0 && verifyCalc(dec).ok, '검증 + 같은 모델 재계산 일치');
  const s = summaryLine(r, a, 0);
  ok(s.includes(fmt.krw(dec.result.year1SavingKrw)) && s.includes(fmt.years(dec.result.paybackYears)) && s.includes(fmt.krw(dec.result.capexKrw)), '구조화 값 = 요약문 값');
  // 변조·불량 입력
  const tam = JSON.parse(JSON.stringify(rec)); tam.result.year1SavingKrw *= 2;
  ok(!verifyCalc(tam).ok, '결과 변조 → 재계산 불일치로 거부');
  const oor = JSON.parse(JSON.stringify(rec)); oor.assumptions.capexKrwPerKw = 99999999;
  ok(validateCalc(oor).length > 0 && decodeCalc(encodeCalc(oor)) === null, '가정값 범위 밖 → 거부');
  ok(decodeCalc('!!!') === null && decodeCalc('') === null && decodeCalc('x'.repeat(3000)) === null && decodeCalc(encodeCalc({ schema: 'other' })) === null, '깨진 문자열·빈 값·길이 초과·다른 스키마 → null');
  const sell = compute({ mode: 'sell', capacityKw: 1000 }, defaults());
  const recS = calcRecord({ r: sell, a: defaults(), input: { mode: 'sell', capacityKw: 1000 }, market: null, edited: 2 });
  ok(recS.tariffId === null && recS.market === null && recS.assumptionSource.edited === 2 && recS.assumptionSource.demo === false && verifyCalc(recS).ok, '판매 모드·시세 미반영·가정 수정 표시');
}

console.log('7) 요청 식별자용 안정 직렬화');
{
  ok(canonical({ b: 1, a: [2, { d: 1, c: null }] }) === '{"a":[2,{"c":null,"d":1}],"b":1}', '키 정렬·중첩·null');
  ok(canonical({ a: '한글', b: undefined }) === '{"a":"한글","b":null}', '한글·undefined');
}

console.log('8) 효성 사례 월 절감 — 기금 요율·배분 방식에 따른 차이 추적');
{
  const pub = SITE_PRESETS.hyosung.published;
  const o = publishedMonthTotal(pub, pub.fundRateApplied), n = publishedMonthTotal(pub, fundRateAt('2026-04'));
  ok(Math.round(o.total / 1e4) === 3709, `공개 배분 × 기금 3.7% = ${Math.round(o.total).toLocaleString()}원 → 분석 보고서 값 3,709만 원 재현`);
  ok(fundRateAt('2026-04') === 0.027 && fundRateAt('2025-06') === 0.032 && fundRateAt('2024-06') === 0.037, '기금 요율 단계: 3.7% → 3.2%(2024-07) → 2.7%(2025-07)');
  ok(Math.round(n.total / 1e4) === 3676, `같은 배분 × 현행 2.7% = ${Math.round(n.total).toLocaleString()}원 (3,676만 원)`);
  const tbl = monthlySelfUse({ kwh: pub.monthGenKwh, ym: '2026-04' });
  ok(Math.round(tbl.total / 1e4) === 3658 && tbl.fundRate === 0.027, `월별 표 방식(추정 시간대 배분 × 2.7%) = ${Math.round(tbl.total).toLocaleString()}원 (3,658만 원)`);
  ok(Math.round((o.total - n.total)) === Math.round(o.subtotal * 0.01), '3,709 → 3,676 차이 = 소계 × 1.0%p (요율 차이만)');
}

console.log(fails ? `\n실패 ${fails}건` : '\n전부 통과');
process.exit(fails ? 1 : 0);
