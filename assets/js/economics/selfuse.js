// ─────────────────────────────────────────────────────────────
// 자가소비 현장의 "실측 발전량 → 경제효과" 계산
//   · 전기요금 절감: 월 발전량을 그 달의 태양광 시간 분포(tariff.js PV_PROFILE)로 경부하·중간·최대부하에 나누고
//     요금제 단가 + 기후환경요금 + 연료비조정액을 더한 뒤 부가세·전력산업기반기금을 얹는다 (명세서 구조와 동일).
//     사례 페이지의 공개 분석(2026.04, 산업용(을) 고압A 선택Ⅱ)과 같은 방법. 주말·공휴일 요금 구분은 반영하지 않는다.
//   · 온실가스: 발전량 × 전력 배출계수(0.4567 tCO₂/MWh, 사례 분석과 동일)
//   · 배출권 가치: 감축량 × 배출권(KAU) 시세 — 실제 거래가 아닌 '가치 환산'이다
// ─────────────────────────────────────────────────────────────
import { tariffById, CHARGES, seasonOfMonth, bandOf, hourWeights } from './tariff.js';

export const CO2_T_PER_MWH = 0.4567;          // 환경부 고시 전력 배출계수 (사례: 904.17t / 1,979,732kWh)
export const DEFAULT_TARIFF = 'ie-ha2';       // 산업용(을) 고압A 선택Ⅱ

/** 전력산업기반기금 요율: '24.7.1 3.2%, '25.7.1 2.7% (그 전 3.7%) */
export function fundRateAt(ym) { return ym >= '2025-07' ? 0.027 : ym >= '2024-07' ? 0.032 : 0.037; }

/**
 * 한 달치 자가소비 발전량의 절감액·감축량
 * @param {{kwh:number, ym:string, tariffId?:string, charges?:object}} p  ym = 'YYYY-MM'
 */
export function monthlySelfUse({ kwh, ym, tariffId = DEFAULT_TARIFF, charges }) {
  const tariff = tariffById(tariffId); if (!tariff) throw new Error('요금제 없음: ' + tariffId);
  const m = Number(ym.slice(5, 7)), season = seasonOfMonth(m);
  const c = { ...CHARGES, ...(charges || {}) }; if (!(charges && charges.fundRate != null)) c.fundRate = fundRateAt(ym);
  const idx = { light: 0, mid: 1, peak: 2 };
  const rate = band => (tariff.tou ? tariff.rates[season][idx[band]] : tariff.rates[season]);
  const bands = { light: { kwh: 0, krw: 0 }, mid: { kwh: 0, krw: 0 }, peak: { kwh: 0, krw: 0 } };
  const w = hourWeights(m);
  for (let h = 0; h < 24; h++) {
    const k = kwh * w[h]; if (!k) continue;
    const b = tariff.tou ? bandOf(season, h) : 'mid';
    bands[b].kwh += k; bands[b].krw += k * rate(b);
  }
  const energy = bands.light.krw + bands.mid.krw + bands.peak.krw;
  const climate = kwh * c.climateKrwPerKwh, fuel = kwh * c.fuelAdjKrwPerKwh;
  const subtotal = energy + climate + fuel;
  const vat = subtotal * c.vatRate, fund = subtotal * c.fundRate, total = subtotal + vat + fund;
  const co2T = kwh / 1000 * CO2_T_PER_MWH;
  return {
    ym, season, kwh, tariff: tariff.name, bands, rates: { light: rate('light'), mid: rate('mid'), peak: rate('peak') },
    energy, climate, fuel, subtotal, vat, fund, fundRate: c.fundRate, total, effectiveRate: kwh > 0 ? total / kwh : 0, co2T,
  };
}

/** 여러 달 합산 + 배출권 가치 */
export function summarize(months, carbonPrice) {
  const rows = months.map(x => { const r = monthlySelfUse(x); r.carbonKrw = r.co2T * (carbonPrice || 0); r.benefit = r.total + r.carbonKrw; return r; });
  const sum = k => rows.reduce((s, r) => s + (r[k] || 0), 0);
  return { rows, kwh: sum('kwh'), total: sum('total'), co2T: sum('co2T'), carbonKrw: sum('carbonKrw'), benefit: sum('benefit'), months: rows.length };
}
