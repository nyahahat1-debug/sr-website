// ─────────────────────────────────────────────────────────────
// 3D 시제품 — 설비 설명 텍스트 + 데모 수치
//
// ⚠ 이 파일의 숫자는 전부 "데모 가정값"입니다. 화면에는 반드시 '데모'로 표기합니다.
//   실제 경제성 계산 모듈은 Phase 5 에서 별도 폴더(assets/js/economics/)로 구현하며,
//   3D 코드와 분리합니다. (지시서 7항)
// ─────────────────────────────────────────────────────────────

import { compute, defaults, ASSUMPTIONS } from '../economics/model.js';
import { DEFAULT_SITE } from '../economics/presets.js';
export const SITE = DEFAULT_SITE;   // 메인 장면 5 패널: 실제 현장(효성 전주공장) 공개 수치

export const DEMO = {
  moduleW: 635,          // W/장  — 635W급 모듈 기준 (데모)
  yieldKwhPerKw: 1300,   // kWh/kW·년 — 국내 지붕형 일반 범위(1,200~1,400)의 중간값 (데모 가정)
  priceKrwPerKwh: 150,   // 원/kWh — 산업용 단가는 계약종별·시간대별로 다름 (데모 가정)
  selfUseRatio: 1.0,     // 자가소비 비율 — 100% 로 가정 (실제는 부하 패턴 분석 후 산출)
};

/** 모듈 수로부터 데모 경제성 값을 만든다. 3D 모델과 항상 일치하도록 계산식만 둔다. */
export function demoEconomics(moduleCount) {
  const kw = (moduleCount * DEMO.moduleW) / 1000;
  const a = defaults();                                    // 계산기(analysis.html)와 같은 데모 가정값
  const r = compute({ mode: 'self', capacityKw: kw, tariffId: 'ie-ha1' }, a);   // 산업용(을) 고압A 선택Ⅰ (현장 명세서와 동일)
  const lbl = k => ASSUMPTIONS.find(d => d.key === k);
  return {
    moduleCount, kw,
    mwh: r.ok ? r.year1.gen / 1000 : 0,
    savingKrw: r.ok ? r.year1.saving : 0,                  // 자가소비 절감
    saleKrw: r.ok ? r.year1.sale : 0,                      // 잉여 판매
    paybackYears: r.ok ? r.paybackYears : null,
    assumptions: [
      ['모듈 출력', `${DEMO.moduleW} W/장 × ${moduleCount.toLocaleString('ko-KR')}장`],
      ['연간 발전량 원단위', `${a.yieldKwhPerKw.toLocaleString('ko-KR')} ${lbl('yieldKwhPerKw').unit}`],
      ['요금제', r.ok && r.tariff ? r.tariff.name + ' (요금표 단가)' : '평균 단가'],
      ['자가소비 비율', `${a.selfUseRatio}%`],
    ],
  };
}

/** 설비 선택 패널에 쓰는 설명. 과장 없이 '무엇을 하는 설비인지'만 적는다. */
export const moduleSpec = n => `${DEMO.moduleW}W급 × ${n.toLocaleString('ko-KR')}장 = ${((n * DEMO.moduleW) / 1000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })} kW`;

export const EQUIPMENT = {
  modules: {
    name: '태양광 모듈',
    desc: '지붕 구조물 위에 올라가는 발전 단위입니다. 방위·경사·음영과 지붕 하중 조건에 따라 배치와 수량이 달라집니다.',
    specs: [
      ['구성', '{SPEC}'],
      ['경사각', '4° (도면 기준)'],
      ['구조물', '알루미늄·포스맥 등 현장별 선정'],
    ],
  },
  inverter: {
    name: '인버터',
    desc: '모듈이 만든 직류(DC)를 공장에서 쓰는 교류(AC)로 바꿉니다. 발전량 모니터링의 기준점이 되는 장비입니다.',
    specs: [
      ['구성', '지붕 스트링 인버터 2열 × 16대 (도면 기준)'],
      ['설치 위치', '지붕 위, 모듈 스트립 사이'],
    ],
  },
  transformer: {
    name: '수전설비 — 변압기',
    desc: '한전에서 받은 전기를 공장 전압으로 바꾸는 설비입니다. 수전합리화(고압→저압 전환)는 이 설비의 계약 방식을 바꾸는 작업입니다.',
    specs: [
      ['검토 항목', '계약전력·요금적용전력·실제 피크'],
      ['관련 서비스', '수전합리화 컨설팅'],
    ],
  },
  switchgear: {
    name: '수전설비 — 수배전반',
    desc: '전력을 분배하고 보호(차단)하는 설비입니다. 태양광을 공장 계통에 연결하는 계통연계 보호장치가 여기에 들어갑니다.',
    specs: [
      ['역할', '분배·차단·계통연계 보호'],
      ['인허가', '한전 계통연계 협의 대상'],
    ],
  },
  load: {
    name: '공장 부하 (자가소비)',
    desc: '낮 시간에 가동하는 생산 설비입니다. 태양광 전력을 직접 소비해 한전에서 사는 전기를 줄입니다. 이 비중이 클수록 자가소비 방식이 유리합니다.',
    specs: [
      ['핵심 변수', '낮 시간 전력 사용 비중'],
      ['분석 자료', '최근 12개월 전기요금 명세'],
    ],
  },
  ess: {
    name: 'ESS (선택 설비)',
    desc: '남는 전력을 저장했다가 필요할 때 쓰는 설비입니다. 모든 현장에 필요한 것은 아니며, 부하 패턴과 요금제에 따라 도입 여부를 검토합니다.',
    specs: [
      ['도입 여부', '현장 분석 후 결정'],
      ['표기', '시제품에서는 선택 설비로 표시'],
    ],
  },
  grid: {
    name: '한전 계통',
    desc: '자가소비 후 남는 전력을 내보내거나(발전판매·상계), 부족한 전력을 받아오는 연결점입니다.',
    specs: [
      ['연계 방식', '자가용 또는 발전사업용'],
      ['절차', '계통연계 신청·협의 대행'],
    ],
  },
};
