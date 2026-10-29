// 문의 전송 공급자 구현 — Web3Forms(현행) / 자체 접수 API(준비). UI 는 outcome 만 보고 화면을 그린다.
//   outcome.kind: ok | invalid | conflict | rate_limited | server_error | rejected | timeout | network   (서버 확정 계약 2026-10-29: docs/handoff/INTAKE_API_CONTRACT.md 3절)
//   · ok 는 공급자가 "저장(접수)" 을 확인한 경우만. intake 는 서버 접수번호(intakeNo)가 있어야 ok.
//   · 409(충돌)·429(제한)·5xx·시간초과는 성공이 아니다. 시간초과는 서버에 저장됐을 수 있으므로 같은 요청 식별자로 재시도한다.
//   · 한 번의 제출은 공급자 하나로만 보낸다. 실패해도 다른 공급자로 자동 우회하지 않는다.
//   · 개인정보는 URL·콘솔·저장소에 남기지 않는다 (fetch 본문으로만 전송).

/** 무작위 요청 식별자 (128bit → 32자리 hex) */
export function newRequestId() {
  const b = new Uint8Array(16);
  try { crypto.getRandomValues(b); } catch (e) { for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256); }
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

/** 키를 정렬한 안정적인 JSON (내용 해시용) */
export function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}

/** 내용 해시 — SHA-256(가능하면) 또는 FNV-1a 대체. 같은 내용 재시도 = 같은 해시 → 같은 요청 식별자 */
export async function contentHash(obj) {
  const s = canonical(obj);
  try {
    if (crypto && crypto.subtle && crypto.subtle.digest) {
      const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
      return 'sha256:' + Array.from(new Uint8Array(d), x => x.toString(16).padStart(2, '0')).join('');
    }
  } catch (e) { /* 비보안 컨텍스트 등 → 대체 해시 */ }
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0; h2 = Math.imul(h2 ^ c, 0x811c9dc5) >>> 0; }
  return 'fnv:' + h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/**
 * 제출 준비: 내용 해시가 이전과 같으면 같은 요청 식별자·같은 본문 스냅샷을 다시 쓴다(submittedAt·consent.at 포함 그대로).
 * 내용이 바뀌면 새 식별자를 발급하고 스냅샷을 비운다. 식별자·스냅샷은 메모리(페이지 수명)에만 있다 — 새로고침·탭 종료 후에는 새 식별자.
 * prev: { hash, requestId, payload } | null
 */
export function prepareSubmission(prev, hash) {
  if (prev && prev.hash === hash && prev.requestId) return { hash, requestId: prev.requestId, payload: prev.payload || null, reused: true };
  return { hash, requestId: newRequestId(), payload: null, reused: false };
}

async function postJson(url, body, headers, signal) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers }, body: JSON.stringify(body), signal, credentials: 'omit' });
  let data = null; try { data = await res.json(); } catch (e) { data = null; }
  return { res, data };
}

const str = (v, max = 80) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Web3Forms: 평면 필드 JSON. 응답 success:true 일 때만 ok (이메일 도달·담당자 확인은 알 수 없다) */
export async function sendWeb3Forms(url, fields, signal) {
  const { res, data } = await postJson(url, fields, {}, signal);
  if (res.ok && data && data.success === true) return { kind: 'ok', provider: 'web3forms', intakeNo: null };
  if (res.status === 429) return { kind: 'rate_limited', provider: 'web3forms' };
  if (res.status >= 500) return { kind: 'server_error', provider: 'web3forms', status: res.status };
  return { kind: 'rejected', provider: 'web3forms', status: res.status, message: data ? str(data.message) : '' };
}

/** 접수번호 형식(서버 확정: IQ-000123 — 계약 3절). 일반 형식 [A-Za-z0-9-]{4,40} 안에서만 받는다 */
export const INTAKE_NO_RE = /^[A-Za-z0-9-]{4,40}$/;
/** 서버가 돌려주는 오류 코드 (계약 3절) */
export const INTAKE_ERRORS = Object.freeze(['invalid', 'conflict', 'rate_limited', 'server_error', 'bad_request', 'too_large', 'origin']);
/** 사용자가 고칠 수 있는 항목 키 (422 fields). 그 밖의 키(requestId·clientRef·calc·schema·body)는 입력 문제가 아니라 전송 형식 문제다 */
export const USER_FIELDS = Object.freeze(['contact.name', 'contact.phone', 'site.address', 'message', 'consent', 'topic.key']);
const retryAfterOf = res => { const n = Number(res.headers.get('Retry-After')); return (Number.isFinite(n) && n > 0) ? Math.min(Math.round(n), 3600) : null; };   // 초 단위만(날짜 형식·음수는 무시), 최대 1시간

/** 자체 접수 API(서버 확정 계약 sr-intake/1): 구조화 본문 + Idempotency-Key(요청 식별자) + X-SR-Schema.
 *  201(신규)·200(replay: 같은 식별자·같은 내용 재전송) + ok:true + intakeNo 일 때만 ok — 그 밖의 2xx 는 저장 확인이 아니다.
 *  400 bad_request(헤더·본문 형식)·413 too_large·403 origin → rejected(입력 문제 아님, 재시도해도 같음) / 422 invalid → fields / 409 conflict / 429 rate_limited(+Retry-After) / 5xx server_error */
export async function sendIntake(url, inquiry, signal) {
  const { res, data } = await postJson(url, inquiry, { 'Idempotency-Key': inquiry.requestId, 'X-SR-Schema': inquiry.schema }, signal);
  const d = (data && typeof data === 'object') ? data : {};
  const error = str(d.error, 40) || null, message = str(d.message, 160);
  const fields = Array.isArray(d.fields) ? d.fields.filter(x => typeof x === 'string' && x.length <= 40).slice(0, 10) : [];
  if ((res.status === 201 || res.status === 200) && d.ok === true && typeof d.intakeNo === 'string' && INTAKE_NO_RE.test(d.intakeNo)) {
    if (d.requestId && d.requestId !== inquiry.requestId) return { kind: 'server_error', provider: 'intake', status: res.status, error: 'request_id_mismatch', message: '응답의 요청 식별자 불일치' };
    return { kind: 'ok', provider: 'intake', intakeNo: d.intakeNo, replay: d.replay === true, receivedAt: str(d.receivedAt, 40) };
  }
  if (res.ok) return { kind: 'server_error', provider: 'intake', status: res.status, error: 'no_intake_no', message: '저장 확인(접수번호) 없는 응답' };   // 2xx 라도 접수번호가 없으면 저장을 확인한 것이 아니다
  if (res.status === 422) return { kind: 'invalid', provider: 'intake', status: 422, error: error || 'invalid', fields, message };
  if (res.status === 409) return { kind: 'conflict', provider: 'intake', status: 409, error: error || 'conflict', message };
  if (res.status === 429) return { kind: 'rate_limited', provider: 'intake', status: 429, error: error || 'rate_limited', retryAfter: retryAfterOf(res) };   // 교차 origin 에서는 서버가 Access-Control-Expose-Headers: Retry-After 를 낸다(계약 확인)
  if (res.status >= 500) return { kind: 'server_error', provider: 'intake', status: res.status, error: error || 'server_error', message };
  if (res.status === 400) return { kind: 'rejected', provider: 'intake', status: 400, error: error || 'bad_request', fields, message };   // 헤더·스키마·JSON 문제 — 같은 본문 재시도는 의미 없다
  if (res.status === 413) return { kind: 'rejected', provider: 'intake', status: 413, error: error || 'too_large', fields: ['message'], message };
  return { kind: 'rejected', provider: 'intake', status: res.status, error, fields, message };   // 403 origin 등
}

/** 공급자 하나로 보낸다. 시간초과·네트워크 오류는 kind 로 돌려준다 (예외를 던지지 않는다) */
export async function send(route, payload, { timeoutMs = 20000 } = {}) {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    if (route.provider === 'intake') return await sendIntake(route.url, payload, ctrl.signal);
    return await sendWeb3Forms(route.url, payload, ctrl.signal);
  } catch (err) {
    return { kind: (err && err.name === 'AbortError') ? 'timeout' : 'network', provider: route.provider };
  } finally { clearTimeout(timer); }
}
