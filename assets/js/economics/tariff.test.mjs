// node --test assets/js/economics/tariff.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TARIFFS, tariffById, bandOf, seasonOfMonth, hourWeights, tariffSavings, billAddOns, CHARGES, SEASONS } from './tariff.js';

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);

test('요금제 테이블 무결성: id 고유, 단가 양수, TOU 는 3단가·경<중<최대', () => {
  const ids = new Set(TARIFFS.map(t => t.id)); assert.equal(ids.size, TARIFFS.length);
  for (const t of TARIFFS) for (const s of SEASONS) {
    const r = t.rates[s];
    if (t.tou) { assert.equal(r.length, 3); assert.ok(r[0] < r[1] && r[1] <= r[2], `${t.id} ${s}`); }
    else assert.ok(r > 0);
    assert.ok(t.basic > 0);
  }
  assert.equal(TARIFFS.filter(t => t.group === '일반용').length, 15);
  assert.equal(TARIFFS.filter(t => t.group === '산업용').length, 18);
});

test('명세서 대조: 산업용(을) 고압A 선택Ⅰ 기본요금 7,220원/kW × 500kW = 3,610,000', () => {
  const t = tariffById('ie-ha1');
  assert.equal(t.basic * 500, 3610000);
  assert.deepEqual(t.rates.winter, [128.5, 169.5, 210.1]);
});

test('명세서 대조: 부가 항목 (2025-12 명세서, 전기요금 14,743,202원 / 57,557kWh)', () => {
  const kwh = 57557;
  near(kwh * CHARGES.climateKrwPerKwh, 518013);   // 기후환경요금
  near(kwh * CHARGES.fuelAdjKrwPerKwh, 287785);   // 연료비조정액
  const { vat, fund, total } = billAddOns(14743202);
  assert.equal(vat, 1474320);                       // 부가세 10%
  assert.equal(fund, 398060);                       // 기금 2.7%, 10원 미만 절사
  assert.equal(total, 16615582);                    // 명세서 당월요금계 16,615,580 (원단위 절사 -2)
});

test('계절·시간대 구분', () => {
  assert.equal(seasonOfMonth(7), 'summer'); assert.equal(seasonOfMonth(4), 'springFall'); assert.equal(seasonOfMonth(10), 'springFall'); assert.equal(seasonOfMonth(12), 'winter'); assert.equal(seasonOfMonth(2), 'winter');
  assert.equal(bandOf('summer', 3), 'light'); assert.equal(bandOf('summer', 10), 'mid'); assert.equal(bandOf('summer', 16), 'peak'); assert.equal(bandOf('summer', 21), 'mid'); assert.equal(bandOf('summer', 22), 'light');
  assert.equal(bandOf('winter', 10), 'peak'); assert.equal(bandOf('winter', 13), 'mid'); assert.equal(bandOf('winter', 17), 'peak'); assert.equal(bandOf('winter', 20), 'mid');
});

test('발전 시간 분포: 합 1, 야간 0, 정오 부근 최대', () => {
  for (let m = 1; m <= 12; m++) {
    const w = hourWeights(m); near(w.reduce((a, b) => a + b, 0), 1);
    assert.equal(w[1], 0); assert.equal(w[23], 0);
    const peakH = w.indexOf(Math.max(...w)); assert.ok(peakH >= 11 && peakH <= 13, `m${m} peak ${peakH}`);
  }
});

test('절감 계산: kWh 합 = 입력, 발전은 주로 중간·최대부하, 부가 항목 비율', () => {
  const t = tariffById('ie-ha1');
  const r = tariffSavings(t, 100000);
  const kwhSum = SEASONS.reduce((s, se) => s + r.bands[se].light.kwh + r.bands[se].mid.kwh + r.bands[se].peak.kwh, 0);
  near(kwhSum, 100000);
  const light = SEASONS.reduce((s, se) => s + r.bands[se].light.kwh, 0);
  assert.ok(light / 100000 < 0.25, '경부하(야간+공휴일) 비중은 작아야');   // 공휴일 전량 경부하 포함
  near(r.climate, 900000); near(r.fuel, 500000);
  near(r.vat, r.subtotal * 0.10); near(r.fund, r.subtotal * 0.027);
  near(r.total, r.subtotal * 1.127);
  assert.ok(r.effectiveRate > 140 && r.effectiveRate < 220, `유효단가 ${r.effectiveRate}`);
});

test('단일 단가 요금제(갑Ⅰ)는 계절 단가만 적용, 주말 할인 없음', () => {
  const t = tariffById('i1-ha1');
  const r = tariffSavings(t, 10000);
  for (const se of SEASONS) { assert.equal(r.bands[se].light.kwh, 0); assert.equal(r.bands[se].peak.kwh, 0); }
  const kwh = SEASONS.reduce((s, se) => s + r.bands[se].mid.kwh, 0); near(kwh, 10000);
  assert.ok(r.energy / 10000 > 100 && r.energy / 10000 < 125);
});

test('산업용(을) 봄·가을 주말 11~14시 50% 할인이 반영되어 같은 단가의 일반용(을)보다 조금 낮다', () => {
  const a = tariffSavings({ ...tariffById('ie-ha1'), group: '일반용' }, 10000).energy;
  const b = tariffSavings(tariffById('ie-ha1'), 10000).energy;
  assert.ok(b < a && b > a * 0.95);
});
