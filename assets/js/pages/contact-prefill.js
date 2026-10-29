// 문의 폼 사전 선택 — URL 의 ?topic= (허용 목록), ?calc= (계산기 조건 요약), ?calcd= (구조화된 계산 조건) 을 폼에 채운다.
//   · topic 값은 허용 목록의 키만 받고, 해당 <option> 이 있을 때만 선택한다. 사용자가 바꿀 수 있다.
//   · calc 는 문자열 길이·형식만 검사해 textarea 의 value 로 넣는다 (HTML 로 삽입하지 않음). 이미 적힌 내용이 있으면 덮어쓰지 않는다.
//   · calcd 는 스키마·타입·범위를 검사하고 같은 모델로 재계산해 결과가 일치할 때만 숨은 필드(계산 조건(JSON))에 넣는다.
//     검증에 실패하면 버리고 요약만 쓴다. 요약 문자열에서 숫자를 역추출하지 않는다.
//   · 이름·연락처·주소 같은 개인정보는 URL 로 받지 않는다.
import { decodeCalc, verifyCalc } from '../economics/calc-transfer.js';

const TOPICS = { self: '자가소비 태양광', sell: '태양광 발전(판매)', rational: '수전합리화',
  monitoring: '발전소 모니터링·운영관리 상담', maintenance: '발전 저하·인버터·유지보수 상담', electrical: '전기설비·안전관리 문의', unsure: '잘 모름 (비교 원함)' };
const CALC_MAX = 600;
let q = null; try { q = new URLSearchParams(location.search); } catch (e) { q = null; }
if (q) {
  const topic = q.get('topic'), calc = q.get('calc'), calcd = q.get('calcd');
  let touched = false;
  if (topic && Object.prototype.hasOwnProperty.call(TOPICS, topic)) {
    const sel = document.getElementById('fld-5');
    if (sel) {
      const label = TOPICS[topic]; let has = false;
      for (let i = 0; i < sel.options.length; i++) { if (sel.options[i].value === label || sel.options[i].text === label) { sel.value = sel.options[i].value; has = true; break; } }
      if (has) { touched = true; if (window.__srUpdateTopicHint) window.__srUpdateTopicHint(); }
    }
  }
  if (typeof calc === 'string' && calc.length > 0 && calc.length <= CALC_MAX && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(calc)) {
    const t = document.querySelector('textarea[name="추가 내용"]');
    if (t && !t.value) { t.value = calc.replace(/\s+$/, ''); touched = true; }
  }
  const calcInput = document.getElementById('fldCalc');
  if (calcInput) {
    calcInput.value = '';
    const rec = decodeCalc(calcd);
    if (rec) {
      const v = verifyCalc(rec);
      if (v.ok) { calcInput.value = JSON.stringify(rec); calcInput.dataset.state = 'verified'; }
      else calcInput.dataset.state = 'rejected';          // 재계산 불일치·범위 밖 → 요약만 전달
    } else calcInput.dataset.state = calcd ? 'rejected' : 'none';
  }
  if (touched) {
    const f = document.getElementById('analysisForm');
    if (f) setTimeout(() => { f.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion:reduce)').matches ? 'auto' : 'smooth', block: 'start' }); }, 300);
  }
}
