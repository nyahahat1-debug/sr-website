// ─────────────────────────────────────────────────────────────
// 한전 요금제 (일반용·산업용) + 시간대별 자가소비 절감 계산
//
// 출처: 한국전력 전기요금표(종합) 2026-06-01 시행 (산업용(을)은 2026-04-16 시행)
//   · 요금 단가는 원문 PDF 에서 옮겨 적음. 개정 시 RATES 만 교체한다. (source: 'kepco-2026-06')
//   · 기후환경요금·연료비조정단가는 요금표 본문에 숫자가 없어 "가정값"으로 둔다 (명세서로 확인 가능)
// 시간대(제주 제외): 경부하 22~08 / 여름·봄가을 중간 08~15,21~22 · 최대 15~21 / 겨울 중간 08~09,12~16,19~22 · 최대 09~12,16~19
// 토요일: 최대부하 → 중간부하로 계량, 공휴일: 전부 경부하. 산업용(을) 봄·가을 주말 11~14시 전력량요금 50% 할인.
// ─────────────────────────────────────────────────────────────

export const SEASONS = ['summer', 'springFall', 'winter'];
export const SEASON_LABEL = { summer: '여름철 (6~8월)', springFall: '봄·가을철 (3~5, 9~10월)', winter: '겨울철 (11~2월)' };
export const BAND_LABEL = { light: '경부하', mid: '중간부하', peak: '최대부하' };
export const seasonOfMonth = m => (m >= 6 && m <= 8) ? 'summer' : ((m >= 3 && m <= 5) || m === 9 || m === 10) ? 'springFall' : 'winter';

// 요금제 정의. tou: 시간대별 3단가 [경부하, 중간부하, 최대부하] / flat: 계절별 단일 단가
const T = (id, group, kind, voltage, option, basic, s, f, w) => ({
  id, group, kind, voltage, option, basic,
  name: `${group}${kind ? ' ' + kind : ''} ${voltage}${option ? ' ' + option : ''}`,
  tou: Array.isArray(s),
  rates: { summer: s, springFall: f, winter: w },
});
export const TARIFFS = [
  // 일반용전력(갑)Ⅰ — 계약전력 300kW 미만, 계절별 단일 단가
  T('g1-lv',   '일반용', '(갑)Ⅰ', '저압',  '',    6160, 132.4, 91.9, 119.0),
  T('g1-ha1',  '일반용', '(갑)Ⅰ', '고압A', '선택Ⅰ', 7170, 142.6, 98.6, 130.3),
  T('g1-ha2',  '일반용', '(갑)Ⅰ', '고압A', '선택Ⅱ', 8230, 138.6, 94.3, 125.0),
  T('g1-hb1',  '일반용', '(갑)Ⅰ', '고압B', '선택Ⅰ', 7170, 140.5, 97.5, 127.3),
  T('g1-hb2',  '일반용', '(갑)Ⅰ', '고압B', '선택Ⅱ', 8230, 135.2, 92.2, 122.0),
  // 일반용전력(갑)Ⅱ — 300kW 미만 시간대별 계량
  T('g2-ha1',  '일반용', '(갑)Ⅱ', '고압A', '선택Ⅰ', 7170, [89.4, 140.6, 163.1], [89.4, 96.8, 108.1], [98.1, 128.5, 143.3]),
  T('g2-ha2',  '일반용', '(갑)Ⅱ', '고압A', '선택Ⅱ', 8230, [84.1, 135.3, 157.8], [84.1, 91.5, 102.8], [92.8, 123.2, 138.0]),
  T('g2-hb1',  '일반용', '(갑)Ⅱ', '고압B', '선택Ⅰ', 7170, [88.8, 137.4, 153.8], [88.8, 94.7, 100.1], [97.8, 125.1, 139.3]),
  T('g2-hb2',  '일반용', '(갑)Ⅱ', '고압B', '선택Ⅱ', 8230, [83.5, 132.1, 148.5], [83.5, 89.4, 94.8], [92.5, 119.8, 134.0]),
  // 일반용전력(을) — 300kW 이상
  T('ge-ha1',  '일반용', '(을)', '고압A', '선택Ⅰ', 7220, [92.8, 145.7, 227.8], [92.8, 115.3, 146.0], [99.8, 145.9, 203.4]),
  T('ge-ha2',  '일반용', '(을)', '고압A', '선택Ⅱ', 8320, [87.3, 140.2, 222.3], [87.3, 109.8, 140.5], [94.3, 140.4, 197.9]),
  T('ge-ha3',  '일반용', '(을)', '고압A', '선택Ⅲ', 9810, [86.4, 139.6, 209.9], [86.4, 108.5, 132.2], [93.7, 139.8, 186.7]),
  T('ge-hb1',  '일반용', '(을)', '고압B', '선택Ⅰ', 6630, [95.9, 148.2, 229.4], [95.9, 118.2, 148.5], [102.9, 148.2, 204.4]),
  T('ge-hb2',  '일반용', '(을)', '고압B', '선택Ⅱ', 7380, [92.1, 144.4, 225.6], [92.1, 114.4, 144.7], [99.1, 144.4, 200.6]),
  T('ge-hb3',  '일반용', '(을)', '고압B', '선택Ⅲ', 8190, [90.4, 142.7, 224.0], [90.4, 112.8, 143.1], [97.5, 142.7, 198.9]),
  // 산업용전력(갑)Ⅰ — 300kW 미만
  T('i1-lv',   '산업용', '(갑)Ⅰ', '저압',  '',    5550, 116.2, 94.4, 114.5),
  T('i1-ha1',  '산업용', '(갑)Ⅰ', '고압A', '선택Ⅰ', 6490, 124.8, 101.1, 124.7),
  T('i1-ha2',  '산업용', '(갑)Ⅰ', '고압A', '선택Ⅱ', 7470, 120.0, 96.5, 118.2),
  T('i1-hb1',  '산업용', '(갑)Ⅰ', '고압B', '선택Ⅰ', 6000, 123.6, 100.0, 123.2),
  T('i1-hb2',  '산업용', '(갑)Ⅰ', '고압B', '선택Ⅱ', 6900, 118.9, 95.4, 117.1),
  // 산업용전력(갑)Ⅱ — 300kW 미만 시간대별 계량
  T('i2-ha1',  '산업용', '(갑)Ⅱ', '고압A', '선택Ⅰ', 6490, [95.7, 121.5, 155.0], [95.7, 100.5, 119.7], [103.1, 120.0, 149.4]),
  T('i2-ha2',  '산업용', '(갑)Ⅱ', '고압A', '선택Ⅱ', 7470, [90.8, 116.6, 150.1], [90.8, 95.6, 114.8], [98.2, 115.1, 144.5]),
  T('i2-hb1',  '산업용', '(갑)Ⅱ', '고압B', '선택Ⅰ', 6000, [92.5, 120.1, 153.9], [92.5, 99.1, 117.9], [99.7, 117.7, 146.4]),
  T('i2-hb2',  '산업용', '(갑)Ⅱ', '고압B', '선택Ⅱ', 6900, [88.0, 115.6, 149.4], [88.0, 94.6, 113.4], [95.2, 113.2, 141.9]),
  // 산업용전력(을) — 300kW 이상 (2026-04-16 시행)
  T('ie-ha1',  '산업용', '(을)', '고압A', '선택Ⅰ', 7220, [121.5, 169.3, 234.5], [121.5, 138.9, 156.4], [128.5, 169.5, 210.1]),
  T('ie-ha2',  '산업용', '(을)', '고압A', '선택Ⅱ', 8320, [116.0, 163.8, 229.0], [116.0, 133.4, 150.9], [123.0, 164.0, 204.6]),
  T('ie-ha3',  '산업용', '(을)', '고압A', '선택Ⅲ', 9810, [115.1, 163.2, 216.6], [115.1, 132.1, 142.6], [122.4, 163.4, 193.4]),
  T('ie-hb1',  '산업용', '(을)', '고압B', '선택Ⅰ', 6630, [131.4, 178.6, 242.9], [131.4, 148.6, 165.7], [138.4, 178.6, 217.9]),
  T('ie-hb2',  '산업용', '(을)', '고압B', '선택Ⅱ', 7380, [127.6, 174.8, 239.1], [127.6, 144.8, 161.9], [134.6, 174.8, 214.1]),
  T('ie-hb3',  '산업용', '(을)', '고압B', '선택Ⅲ', 8190, [125.9, 173.1, 237.5], [125.9, 143.2, 160.3], [133.0, 173.1, 212.4]),
  T('ie-hc1',  '산업용', '(을)', '고압C', '선택Ⅰ', 6590, [130.9, 178.7, 242.7], [130.9, 148.7, 165.9], [137.8, 178.3, 218.0]),
  T('ie-hc2',  '산업용', '(을)', '고압C', '선택Ⅱ', 7520, [126.2, 174.0, 238.0], [126.2, 144.0, 161.2], [133.1, 173.6, 213.3]),
  T('ie-hc3',  '산업용', '(을)', '고압C', '선택Ⅲ', 8090, [125.1, 172.9, 236.9], [125.1, 142.9, 160.1], [132.0, 172.5, 212.2]),
];
export const TARIFF_SOURCE = '한국전력 전기요금표(종합) 2026-06-01 시행 (산업용(을) 2026-04-16)';
export const tariffById = id => TARIFFS.find(t => t.id === id) || null;
export const KINDS = [
  { kind: '(갑)Ⅰ', desc: '계약전력 300kW 미만, 계절별 단일 단가' },
  { kind: '(갑)Ⅱ', desc: '300kW 미만, 시간대별 계량 (경·중간·최대부하)' },
  { kind: '(을)',   desc: '계약전력 300kW 이상, 시간대별' },
];

/** 부가 항목 — 요금표에 숫자가 없어 가정값. 명세서의 '기후환경요금'·'연료비조정액' ÷ 사용량으로 확인 가능 */
export const CHARGES = {
  climateKrwPerKwh: 9,     // 기후환경요금 단가
  fuelAdjKrwPerKwh: 5,     // 연료비조정단가 (상·하한 ±5)
  vatRate: 0.10,           // 부가가치세
  fundRate: 0.027,         // 전력산업기반기금 ('25.7.1~ 2.7%)
};

/** 명세서 방식 그대로: 전기요금 → 부가세(원미만 반올림) + 기금(10원 미만 절사) */
export function billAddOns(energyCharge, c = CHARGES) {
  const vat = Math.round(energyCharge * c.vatRate);
  const fund = Math.floor(energyCharge * c.fundRate / 10) * 10;
  return { vat, fund, total: energyCharge + vat + fund };
}

// ── 시간대 구분 (평일)
export function bandOf(season, h) {
  if (h < 8 || h >= 22) return 'light';
  if (season === 'winter') return (h >= 9 && h < 12) || (h >= 16 && h < 19) ? 'peak' : 'mid';
  return (h >= 15 && h < 21) ? 'peak' : 'mid';
}
export const TOU_TEXT = {
  summer: '경부하 22~08시 · 중간 08~15, 21~22시 · 최대 15~21시',
  springFall: '경부하 22~08시 · 중간 08~15, 21~22시 · 최대 15~21시',
  winter: '경부하 22~08시 · 중간 08~09, 12~16, 19~22시 · 최대 09~12, 16~19시',
};

// ── 태양광 발전 시간 분포 (전형적 프로파일, 가정) — 월별 발전 비중 + 일출·일몰 기반 종형 곡선
export const PV_PROFILE = {
  monthShare: [6.3, 7.3, 9.3, 10.1, 10.4, 8.9, 7.6, 8.7, 8.6, 8.9, 7.1, 6.8],   // % (합 100)
  sunrise:    [7.6, 7.3, 6.7, 6.0, 5.4, 5.2, 5.4, 5.8, 6.2, 6.6, 7.1, 7.5],
  sunset:     [17.7, 18.2, 18.6, 19.0, 19.4, 19.7, 19.6, 19.2, 18.5, 17.9, 17.4, 17.3],
  dayType: { weekday: 246 / 365, saturday: 52 / 365, holiday: 67 / 365 },        // 일요일+공휴일 ≈ 67일
};

/** 월별 시간대 가중치 (0~23시, 합 1) */
export function hourWeights(m) {
  const r = PV_PROFILE.sunrise[m - 1], s = PV_PROFILE.sunset[m - 1];
  const w = []; let sum = 0;
  for (let h = 0; h < 24; h++) { const t = h + 0.5; const v = (t > r && t < s) ? Math.pow(Math.sin(Math.PI * (t - r) / (s - r)), 1.5) : 0; w.push(v); sum += v; }
  return w.map(v => v / sum);
}

/**
 * 연간 자가소비 전력량(kWh)을 계절·시간대별로 나누고 요금제 단가를 곱한다.
 * @returns { bands: {season:{band:{kwh,krw}}}, energy, climate, fuel, subtotal, vat, fund, total, effectiveRate, kwh }
 */
export function tariffSavings(tariff, selfKwh, c = CHARGES, profile = PV_PROFILE) {
  const bands = {}; for (const s of SEASONS) bands[s] = { light: { kwh: 0, krw: 0 }, mid: { kwh: 0, krw: 0 }, peak: { kwh: 0, krw: 0 } };
  const rate = (season, band) => tariff.tou ? tariff.rates[season][{ light: 0, mid: 1, peak: 2 }[band]] : tariff.rates[season];
  const indEul = tariff.group === '산업용' && tariff.kind === '(을)';
  for (let m = 1; m <= 12; m++) {
    const season = seasonOfMonth(m), mk = selfKwh * profile.monthShare[m - 1] / 100, w = hourWeights(m);
    for (let h = 0; h < 24; h++) {
      const kwh = mk * w[h]; if (!kwh) continue;
      const wd = bandOf(season, h), sat = wd === 'peak' ? 'mid' : wd;
      const parts = [['weekday', wd, 1], ['saturday', sat, indEul && season === 'springFall' && h >= 11 && h < 14 ? 0.5 : 1], ['holiday', 'light', indEul && season === 'springFall' && h >= 11 && h < 14 ? 0.5 : 1]];
      for (const [dt, band, disc] of parts) {
        const k = kwh * profile.dayType[dt]; const b = tariff.tou ? band : 'mid';
        bands[season][b].kwh += k; bands[season][b].krw += k * rate(season, band) * disc;
      }
    }
  }
  const energy = SEASONS.reduce((s, se) => s + ['light', 'mid', 'peak'].reduce((t, b) => t + bands[se][b].krw, 0), 0);
  const climate = selfKwh * c.climateKrwPerKwh, fuel = selfKwh * c.fuelAdjKrwPerKwh;
  const subtotal = energy + climate + fuel;
  const vat = subtotal * c.vatRate, fund = subtotal * c.fundRate;
  const total = subtotal + vat + fund;
  return { bands, energy, climate, fuel, subtotal, vat, fund, total, effectiveRate: selfKwh > 0 ? total / selfKwh : 0, kwh: selfKwh };
}
