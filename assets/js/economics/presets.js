// ─────────────────────────────────────────────────────────────
// 실제 현장 프리셋 — 공개된 분석·실측 수치 (case-detail.html 과 동일 출처)
// ⚠ 투자비·회수기간은 비공개 항목이라 여기에도 두지 않는다.
// ─────────────────────────────────────────────────────────────
export const SITE_PRESETS = {
  hyosung: {
    id: 'hyosung',
    name: '효성첨단소재 전주공장',
    short: '효성 전주공장',
    capacityKw: 1530,
    tariffId: 'ie-ha2',          // 산업용(을) 고압A 선택Ⅱ
    selfUseRatio: 100,           // 공장 상시 부하 > 발전량 → 전량 자가소비
    completed: '2025',
    link: 'case-detail.html#savings',
    published: {
      basis: '2026.04 실측 발전량 × 현행 요금 (기후환경·연료비·부가세·기금 포함)',
      monthGenKwh: 216359.1,     // 2026.04 실측
      monthSavingKrw: 37090000,  // 월 전기료 절감 (추정)
      annualGenKwh: 1979732,     // 연간 예상 발전량 (분석 기준)
      annualSavingKrw: 383220000,// 연간 전기요금 절감효과
      annualTotalKrw: 395880000, // 총 경제적 효과 (온실가스 저감가치 포함)
      co2Tons: 904.17, co2ValueKrw: 12660000,
      tou: { month: '2026.04', season: 'springFall', light: { kwh: 4873, rate: 116.0, krw: 570000 }, mid: { kwh: 165059, rate: 133.4, krw: 22020000 }, peak: { kwh: 46427, rate: 150.9, krw: 7010000 } },
      note: '분석 당시 기금 요율 3.7% 적용. 기본요금·역률요금 변동 미포함.',
    },
  },
};
export const DEFAULT_SITE = SITE_PRESETS.hyosung;
