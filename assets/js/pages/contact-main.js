// 문의 폼 UI — 입력 검증 · 전송 상태 · 결과 구분 · 재시도 · 문의 참조번호 · 요청 식별자
//   전송 공급자(Web3Forms / 자체 접수 API)는 assets/js/contact/transport.js 에 있고, 어느 쪽을 쓸지는 contact/config.js 가 정한다.
//   · 한 번의 제출은 공급자 하나로만 보낸다. 실패·시간초과 시 다른 공급자로 자동 우회하지 않는다.
//   · 문의 참조번호 SR-YYMMDD-XXXX: 브라우저가 만든 고객 안내용 번호(폼 세션당 1개, 서버 접수번호 아님).
//   · 요청 식별자: 32자리 무작위 값. 같은 내용을 재시도하면 같은 값 + 최초 전송 본문 스냅샷 그대로(submittedAt·consent.at 포함), 내용이 바뀌면 새 값 (서버 멱등 처리용).
//     식별자·스냅샷은 페이지 수명 동안 메모리에만 있다. 중복 방지(서버 replay)는 **같은 화면에서 같은 요청 식별자로 재시도할 때**만 해당하며,
//     새로고침·탭 종료 후의 재전송은 새 식별자 = 새 문의로 접수될 수 있다(안내문도 그 범위로만 말한다 — 서버 확정 계약 10절).
//   · 성공 표시는 공급자가 저장(접수)을 확인한 응답을 받은 뒤에만. 서버 접수번호는 접수 API 응답에 있을 때만 보여 준다.
//   · 실패 시 입력값은 그대로 둔다. 개인정보는 URL·콘솔·localStorage 에 남기지 않는다.
import { INTAKE_CONFIG, resolveProvider } from '../contact/config.js';
import { send, contentHash, prepareSubmission, USER_FIELDS } from '../contact/transport.js';

const reduce = window.matchMedia('(prefers-reduced-motion:reduce)').matches;

// scroll progress bar (v2 에서 숨김 — 요소가 있을 때만)
const prog = document.getElementById('progress');
if (prog && !reduce) {
  const onScroll = () => { const h = document.documentElement; const sc = h.scrollTop / (h.scrollHeight - h.clientHeight); prog.style.width = (sc * 100) + '%'; };
  document.addEventListener('scroll', onScroll, { passive: true }); onScroll();
}

// 숫자 즉시 표시 (v2: 카운트업 없음)
function countUp(el) {
  const to = parseFloat(el.dataset.to), dec = parseInt(el.dataset.dec || '0'), suf = el.dataset.suffix || '';
  el.textContent = to.toLocaleString('ko-KR', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + suf;
}
const io = new IntersectionObserver(e => e.forEach(x => { if (x.isIntersecting) { const el = x.target; el.classList.add('in'); el.querySelectorAll('.cu').forEach(countUp); io.unobserve(el); } }), { threshold: .12 });
document.querySelectorAll('.reveal').forEach(el => io.observe(el));
document.querySelectorAll('.cu').forEach(countUp);

// ── 관심 분야별 안내문 (상담 후 제공 범위를 확인하는 흐름 — 수행·계약 가능으로 표현하지 않는다)
const TOPIC_HINT = {
  '발전소 모니터링·운영관리 상담': '운영 중인 발전소의 모니터링·운영관리 범위는 현장 설비와 계약 조건에 따라 다릅니다. 상담 후 제공 가능한 범위와 조건을 확인해 안내드립니다.',
  '발전 저하·인버터·유지보수 상담': '발전량 저하·인버터 이상·유지보수는 현장 상태와 설비 제조사 보증 조건을 확인한 뒤 가능한 조치 범위를 안내드립니다. 긴급 상황은 전화로 연락 주세요.',
  '전기설비·안전관리 문의': '전기설비·안전관리 관련 업무는 자격·인력 요건이 따르는 항목이 있어, 상담 후 직접 제공 가능한 범위와 협력사 연계가 필요한 범위를 구분해 안내드립니다.',
};
const topicSel = document.getElementById('fld-5'), topicHint = document.getElementById('topicHint');
function updateTopicHint() { if (!topicSel || !topicHint) return; const t = TOPIC_HINT[topicSel.value]; topicHint.textContent = t || ''; topicHint.hidden = !t; }
if (topicSel) { topicSel.addEventListener('change', updateTopicHint); updateTopicHint(); }
window.__srUpdateTopicHint = updateTopicHint;   // contact-prefill.js 가 ?topic= 적용 후 호출

// ── 문의 참조번호: SR-YYMMDD-XXXX (브라우저 생성, 폼 세션당 1개 — 재시도에도 동일)
function makeRef() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 혼동 글자(I,O,0,1) 제외
  let s = ''; const buf = new Uint8Array(4);
  try { crypto.getRandomValues(buf); } catch (e) { for (let i = 0; i < 4; i++) buf[i] = Math.floor(Math.random() * 256); }
  for (const b of buf) s += alphabet[b % alphabet.length];
  return `SR-${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}-${s}`;
}

// 폼 필드 → 구조화 접수 본문 (접수 API 용). 필드명은 contact.html 의 name 속성과 같다.
const TOPIC_KEY = { '자가소비 태양광': 'self', '태양광 발전(판매)': 'sell', '수전합리화': 'rational', '발전소 모니터링·운영관리 상담': 'monitoring', '발전 저하·인버터·유지보수 상담': 'maintenance', '전기설비·안전관리 문의': 'electrical', '잘 모름 (비교 원함)': 'unsure' };
function parseCalc(s) { if (!s) return null; try { const o = JSON.parse(s); return (o && typeof o === 'object' && o.schema === 'sr-calc/1') ? o : null; } catch (e) { return null; } }
function buildInquiry(f, ref, requestId, route) {
  const topic = f['관심 분야'] || '';
  return {
    schema: INTAKE_CONFIG.intakeSchema, requestId, clientRef: ref, submittedAt: new Date().toISOString(),
    source: { page: 'contact.html', site: location.hostname, dev: !!route.dev },
    topic: { key: TOPIC_KEY[topic] || 'other', label: topic || null },   // 계약 2절: key 는 필수, 선택 안 함·목록 밖은 'other' (label 로 구분)
    contact: { name: f['담당자'] || '', phone: f['연락처'] || '' },
    site: { address: f['사업장 주소'] || '', type: f['사업장 유형'] || null, monthlyBillBand: f['월 전기요금'] || null },
    message: f['추가 내용'] || '',
    consent: { privacy: f['개인정보 수집·이용 동의'] === '동의함', policyVersion: 'v1.0', at: new Date().toISOString() },
    calc: parseCalc(f['계산 조건(JSON)']),
    calcSummary: (f['추가 내용'] || '').startsWith('[경제성 계산기 결과]') ? f['추가 내용'].slice(0, 500) : null,   // 계약 한도 500자(전문은 message 에 있다)
  };
}

const af = document.getElementById('analysisForm');
if (af) {
  const btn = af.querySelector('.form-submit');
  const status = document.getElementById('formStatus');
  const refInput = document.getElementById('fldRef'), reqInput = document.getElementById('fldReq');
  const okBox = document.getElementById('formOk'), okRef = document.getElementById('formOkRef'), okTitle = document.getElementById('formOkTitle'), okBody = document.getElementById('formOkBody'), okIntake = document.getElementById('formOkIntake');
  const TEL = '063-544-8142';
  let ref = null, inFlight = false, snap = null;   // snap: { hash, requestId, payload } — 같은 내용 재시도용 스냅샷
  const LABEL = { '담당자': '담당자 성함', '연락처': '연락처', '사업장 주소': '사업장 주소', '개인정보 수집·이용 동의': '개인정보 수집·이용 동의' };

  function setStatus(kind, html) { if (!status) return; status.className = 'form-status' + (kind ? ' ' + kind : ''); status.innerHTML = html; status.hidden = !html; }
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const refLine = () => `문의 참조번호 <b>${esc(ref)}</b> (브라우저에서 만든 번호입니다. 전화 문의 시 알려 주시면 확인이 빠릅니다)`;
  const telLink = `<a href="tel:${TEL.replace(/-/g, '')}">${TEL}</a>`;

  // 입력 검증: 첫 번째 문제 항목에 포커스, 항목별 메시지
  function validate() {
    af.querySelectorAll('.form-row.invalid, .form-consent.invalid').forEach(r => r.classList.remove('invalid'));
    const fields = [...af.querySelectorAll('input:not([type=hidden]):not(.hp),select,textarea')];
    for (const f of fields) {
      if (f.checkValidity()) continue;
      const row = f.closest('.form-row') || f.closest('.form-consent');
      if (row) row.classList.add('invalid');
      const name = LABEL[f.name] || f.name;
      let msg;
      if (f.type === 'checkbox') msg = '개인정보 수집·이용에 동의해 주셔야 접수할 수 있습니다.';
      else if (f.validity.valueMissing) msg = `${name}을(를) 입력해 주세요.`;
      else if (f.name === '연락처' && (f.validity.patternMismatch || f.validity.tooShort)) msg = '연락처는 숫자·+·-·괄호·공백만 사용해 5~30자로 입력해 주세요.';
      else if (f.validity.tooLong) msg = `${name}이(가) 너무 깁니다(최대 ${f.maxLength}자).`;
      else msg = `${name} 입력값을 확인해 주세요.`;
      setStatus('err', esc(msg));
      try { f.focus({ preventScroll: false }); } catch (e) { }
      return false;
    }
    return true;
  }
  af.addEventListener('input', e => { const row = e.target.closest('.form-row,.form-consent'); if (row && row.classList.contains('invalid') && e.target.checkValidity()) row.classList.remove('invalid'); });

  // 서버가 항목 오류를 돌려준 경우 해당 항목 표시
  const FIELD_EL = { name: '#fld-1', 'contact.name': '#fld-1', phone: '#fld-2', 'contact.phone': '#fld-2', address: '#fld-3', 'site.address': '#fld-3', message: '#fld-7', consent: 'input[name="개인정보 수집·이용 동의"]', 'topic.key': '#fld-5' };
  function markServerFields(fields) {
    let first = null;
    for (const k of fields || []) { const el = af.querySelector(FIELD_EL[k] || '__none'); if (!el) continue; const row = el.closest('.form-row,.form-consent'); if (row) row.classList.add('invalid'); if (!first) first = el; }
    if (first) { try { first.focus({ preventScroll: false }); } catch (e) { } }
    return !!first;
  }

  function fmtReceived(iso) {   // 서버 접수 시각(ISO, +09:00) → '접수 10.30 09:12' (파싱 실패 시 표시하지 않음)
    if (!iso) return ''; const d = new Date(iso); if (Number.isNaN(d.getTime())) return '';
    try { const q = {}; for (const x of new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d)) q[x.type] = x.value; return ` · 접수 ${q.month}.${q.day} ${q.hour}:${q.minute}`; } catch (e) { return ''; }
  }
  function showSuccess(outcome) {
    setStatus('', ''); af.hidden = true;
    if (outcome.provider === 'intake') {
      if (okTitle) okTitle.textContent = '문의가 접수되었습니다';
      if (okBody) okBody.innerHTML = `접수 시스템에 저장이 확인되었습니다. 영업일 기준 2일 이내에 담당자가 연락드립니다.<br>연락이 없거나 급하신 경우 아래 번호와 함께 ${telLink}로 전화 주세요.`;
      if (okIntake) { okIntake.innerHTML = `접수번호 <b>${esc(outcome.intakeNo)}</b> (서버가 발급한 번호)${fmtReceived(outcome.receivedAt)}${outcome.replay ? ' · 이전 전송이 이미 접수되어 있었습니다' : ''}`; okIntake.hidden = false; }
    } else {
      if (okTitle) okTitle.textContent = '신청이 전송되었습니다';
      if (okBody) okBody.innerHTML = `전송 서비스(Web3Forms)가 접수를 확인했습니다. 영업일 기준 2일 이내에 담당자가 연락드립니다.<br>연락이 없거나 급하신 경우 아래 참조번호와 함께 ${telLink}로 전화 주세요.`;
      if (okIntake) { okIntake.hidden = true; okIntake.textContent = ''; }
    }
    if (okRef) okRef.innerHTML = refLine();
    if (okBox) { okBox.hidden = false; okBox.setAttribute('tabindex', '-1'); okBox.focus({ preventScroll: true }); okBox.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' }); }
  }

  function failureMessage(o) {
    // 중복 방지(서버 replay)는 이 화면에서 같은 요청 식별자로 다시 보낼 때만 해당한다. 새로고침 뒤 재전송은 새 문의가 될 수 있다 — 그 이상을 약속하지 않는다.
    const retry = `이 화면에서 <b>다시 전송</b>을 눌러 주세요. 같은 요청 식별자로 다시 보내므로 같은 내용이면 이 화면에서는 중복 접수되지 않습니다. 페이지를 새로 고치면 새 요청으로 접수될 수 있습니다.`;
    const srvMsg = o.message ? ` 접수 시스템 안내: ${esc(o.message)}` : '';
    const nonUser = (o.fields || []).filter(k => !USER_FIELDS.includes(k));
    switch (o.kind) {
      case 'timeout': return `응답이 ${Math.round(INTAKE_CONFIG.timeoutMs / 1000)}초 안에 오지 않았습니다. 전송됐는지 확인할 수 없으니 ${retry} 급하시면 ${telLink}로 전화 주세요. ${refLine()}`;
      case 'network': return `네트워크 오류로 전송하지 못했습니다. 연결을 확인한 뒤 ${retry} 급하시면 ${telLink}로 전화 주세요. ${refLine()}`;
      case 'invalid':
        if (o.fields && o.fields.length && nonUser.length === o.fields.length) return `접수 시스템이 전송 형식 문제(항목: ${esc(nonUser.join(', '))})로 저장하지 않았습니다. 페이지를 새로 고친 뒤 다시 입력해 보내거나 ${telLink}로 전화 주세요. ${refLine()}`;
        return `접수 시스템이 입력 내용을 확인해 달라고 응답했습니다${o.fields && o.fields.length ? ' (표시된 항목)' : ''}. 내용을 고친 뒤 다시 전송해 주세요.${srvMsg} ${refLine()}`;
      case 'conflict': return `같은 요청 식별자로 다른 내용이 이미 접수되어 있어 저장하지 못했습니다(기존 접수는 그대로입니다). 새 문의라면 페이지를 새로 고친 뒤 다시 보내 주시고, 확인이 필요하면 ${telLink}로 전화 주세요. ${refLine()}`;
      case 'rate_limited': return `짧은 시간에 요청이 많아 접수가 잠시 제한되었습니다. ${o.retryAfter ? `약 ${o.retryAfter}초 뒤 ` : '잠시 후 '}이 화면에서 다시 전송해 주세요. 급하시면 ${telLink}로 전화 주세요. ${refLine()}`;
      case 'server_error': return `접수 시스템 오류로 저장이 확인되지 않았습니다. 잠시 후 ${retry} 급하시면 ${telLink}로 전화 주세요. ${refLine()}`;
      default: {
        const why = o.error === 'too_large' ? ' 전송 내용이 너무 큽니다 — 추가 내용을 줄여 주세요.' : o.error === 'origin' ? ' 이 주소에서의 전송이 허용되어 있지 않습니다.' : (o.error === 'bad_request' ? ` 전송 형식 문제입니다${o.fields && o.fields.length ? ` (항목: ${esc(o.fields.join(', '))})` : ''} — 페이지를 새로 고친 뒤 다시 시도해 주세요.` : '');
        return `${o.provider === 'intake' ? '접수 시스템이' : '전송 서비스가'} 접수를 거부했습니다.${why}${srvMsg} 계속 실패하면 ${telLink}로 전화 주세요. ${refLine()}`;
      }
    }
  }

  let holdTimer = null;
  function holdButton(sec) {   // Retry-After 동안 전송 버튼을 잠근다(남은 초 표시). 입력은 그대로 둔다
    clearInterval(holdTimer); let left = sec; btn.disabled = true; btn.textContent = `${left}초 후 다시 전송`;
    holdTimer = setInterval(() => { left -= 1; if (left <= 0) { clearInterval(holdTimer); holdTimer = null; btn.disabled = false; btn.textContent = '다시 전송'; } else btn.textContent = `${left}초 후 다시 전송`; }, 1000);
  }

  af.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (inFlight) return;                       // 중복 클릭 방지 (프런트엔드 한정 — 서버 측 중복 제거는 요청 식별자로)
    if (af.querySelector('input[name="botcheck"]')?.checked) return;   // honeypot
    if (!validate()) return;
    if (!ref) ref = makeRef();
    if (refInput) refInput.value = ref;
    const route = resolveProvider();            // 이번 제출의 공급자 하나

    // 내용 해시 → 요청 식별자 (같은 내용 재시도 = 같은 식별자, 내용 변경 = 새 식별자)
    const fd = new FormData(af); fd.delete('botcheck');
    const fields = Object.fromEntries(fd);
    const content = { ...fields }; for (const k of ['access_key', 'subject', 'from_name', '문의 참조번호', '요청 식별자']) delete content[k];
    const hash = await contentHash(content);
    snap = prepareSubmission(snap, hash);           // 같은 내용 → 같은 식별자·같은 본문, 바뀐 내용 → 새 식별자
    const requestId = snap.requestId;
    if (reqInput) reqInput.value = requestId;
    fields['요청 식별자'] = requestId;

    // 관심 분야에 따라 메일 제목 구분 (담당자 분류용)
    const subj = af.querySelector('input[name="subject"]');
    const topic = topicSel && topicSel.value ? topicSel.value : '무료 사업성 진단 신청';
    if (subj) subj.value = `[에스알 홈페이지] ${topic} · ${ref}`;
    fields.subject = subj ? subj.value : fields.subject;

    inFlight = true; btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    const orig = btn.dataset.label || (btn.dataset.label = btn.textContent);
    btn.textContent = '전송 중…';
    setStatus('busy', `전송 중입니다. 잠시만 기다려 주세요. ${refLine()}`);

    if (!snap.payload || snap.payload.provider !== route.provider) snap.payload = { provider: route.provider, body: route.provider === 'intake' ? buildInquiry(fields, ref, requestId, route) : fields };
    const payload = snap.payload.body;              // 재시도는 최초 전송 본문 스냅샷을 그대로 보낸다
    const outcome = await send(route, payload, { timeoutMs: INTAKE_CONFIG.timeoutMs });

    if (outcome.kind === 'ok') { showSuccess(outcome); inFlight = false; return; }
    // 실패·시간초과·네트워크·충돌·제한·서버 오류: 입력값 유지, 재시도 안내 (다른 공급자로 보내지 않는다)
    setStatus('err', failureMessage(outcome));
    if (outcome.kind === 'invalid') markServerFields(outcome.fields);
    btn.disabled = false; btn.removeAttribute('aria-busy');
    btn.textContent = ['timeout', 'server_error', 'rate_limited', 'network'].includes(outcome.kind) ? '다시 전송' : orig;
    inFlight = false;
    if (outcome.kind === 'rate_limited' && outcome.retryAfter) holdButton(Math.min(outcome.retryAfter, 120));
    status && status.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'nearest' });
  });
}
