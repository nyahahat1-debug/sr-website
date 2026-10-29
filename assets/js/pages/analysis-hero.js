// 경제성 분석 페이지 도입부 "분석 결과 예시" 카드 — 손으로 적은 숫자 대신 계산기(model.js)와 같은 식·데모 가정값으로 채운다.
//   2026-10-29: 기존 정적 수치(498kW·618MWh·연 1,100만 원·6.2억·5.6년)는 서로 맞지 않아(6.2억 ÷ 1,100만 ≈ 56년) 출처 확인 전까지 쓰지 않는다.
//   계산기와 똑같이 전력거래소 시세(12개월 평균)를 잉여 판매 단가에 반영한다 — 시세 파일이 없으면 데모 가정값.
import { compute, defaults, fmt, applyMarket } from '../economics/model.js';

const EXAMPLE = { mode: 'self', capacityKw: 500, tariffId: 'ie-ha1' };   // 500kW · 산업용(을) 고압A 선택Ⅰ · 데모 가정값
const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
function fill(a, marketNote) {
  const r = compute(EXAMPLE, a);
  if (!r.ok) return;
  set('exCap', fmt.int(r.capacityKw));
  set('exGen', fmt.int(r.year1.gen / 1000));
  set('exSave', fmt.krw(r.year1.saving).replace(' 원', ''));
  set('exCapex', fmt.krw(r.capex).replace(' 원', ''));
  set('exPayback', r.paybackYears == null ? '분석 기간 내 회수 안 됨' : fmt.dec(r.paybackYears, 1));
  const d = defaults();
  set('exNote', `* 아래 계산기와 같은 식·데모 가정값(연 ${fmt.int(d.yieldKwhPerKw)} kWh/kW, 자가소비 ${d.selfUseRatio}%, 투자비 ${fmt.int(d.capexKrwPerKw / 10000)}만 원/kW, 운영비 ${d.opexRate}%/년${marketNote})으로 계산한 예시입니다. 절감액은 청구금액 기준(부가세·전력산업기반기금 포함)이고, 회수기간은 운영비·출력 감소·요금 상승을 반영한 누적 현금흐름 기준입니다. 현장별 조건(일사량·지붕 상태·요금제·계통 여건)에 따라 수치는 달라지며, 정확한 분석은 현장 확인 후 제공해 드립니다.`);
}
try {
  fill(defaults(), '');
  fetch(new URL('../../data/market.json', import.meta.url), { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(m => {
    const a = defaults(); const applied = applyMarket(a, m, 'avg365');
    if (applied.length) fill(a, `, 잉여 판매 단가는 전력거래소 12개월 평균 SMP ${a.smpKrwPerKwh}·REC ${a.recKrwPerKwh} 원/kWh`);
  }).catch(() => {});
} catch (e) { /* 모듈 오류 시 카드는 '—' 상태로 남는다 */ }
