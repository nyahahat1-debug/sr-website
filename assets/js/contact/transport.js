// 문의 전송 공급자 구현 — Web3Forms(현행) / 자체 접수 API(준비). UI 는 outcome 만 보고 화면을 그린다.
//   outcome.kind: ok | invalid | conflict | rate_limited | server_error | rejected | timeout | network
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

/** 자체 접수 API: 구조화 본문 + Idempotency-Key(요청 식별자). 서버가 저장을 확인하고 접수번호를 준 경우만 ok */
export async function sendIntake(url, inquiry, signal) {
  const { res, data } = await postJson(url, inquiry, { 'Idempotency-Key': inquiry.requestId, 'X-SR-Schema': inquiry.schema }, signal);
  const d = (data && typeof data === 'object') ? data : {};
  if ((res.status === 201 || res.status === 200) && d.ok === true && typeof d.intakeNo === 'string' && /^[A-Za-z0-9-]{4,40}$/.test(d.intakeNo)) {
    if (d.requestId && d.requestId !== inquiry.requestId) return { kind: 'server_error', provider: 'intake', status: res.status, message: '응답의 요청 식별자 불일치' };
    return { kind: 'ok', provider: 'intake', intakeNo: d.intakeNo, replay: d.replay === true, receivedAt: str(d.receivedAt, 40) };
  }
  if (res.ok) return { kind: 'server_error', provider: 'intake', status: res.status, message: '저장 확인(접수번호) 없는 응답' };   // 2xx 라도 접수번호가 없으면 저장을 확인한 것이 아니다
  if (res.status === 400 || res.status === 422) return { kind: 'invalid', provider: 'intake', status: res.status, fields: Array.isArray(d.fields) ? d.fields.filter(x => typeof x === 'string').slice(0, 10) : [], message: str(d.message) };
  if (res.status === 409) return { kind: 'conflict', provider: 'intake', status: 409, message: str(d.message) };
  if (res.status === 429) return { kind: 'rate_limited', provider: 'intake', status: 429, retryAfter: Number(res.headers.get('Retry-After')) || null };
  if (res.status >= 500) return { kind: 'server_error', provider: 'intake', status: res.status };
  return { kind: 'rejected', provider: 'intake', status: res.status, message: str(d.message) };
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
