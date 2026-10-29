// 접수 API 계약 검사 (브라우저·네트워크 없음) — node tools/intake_contract_test.mjs
//   · 같은 요청 재시도 = 같은 식별자·같은 스냅샷, 내용 변경 = 새 식별자
//   · 응답 분류: 201/200+intakeNo 만 ok, 2xx 무번호·식별자 불일치는 실패, 409/422/429(Retry-After)/5xx/시간초과/네트워크 구분
//   · 안정 직렬화·해시 결정성 (서버는 자체 해시로 비교한다 — 여기서는 클라이언트 쪽 규칙만 검사)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { canonical, contentHash, prepareSubmission, sendIntake, sendWeb3Forms, send, newRequestId, USER_FIELDS, INTAKE_NO_RE } from '../assets/js/contact/transport.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { checkInquiry } = createRequire(import.meta.url)('./intake_rules.cjs');
const FIX = path.join(__dirname, 'fixtures', 'intake');
const fx = n => JSON.parse(fs.readFileSync(path.join(FIX, n), 'utf8'));

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL', m); } else console.log('  ok  ', m); };
const mockFetch = (status, body, headers = {}) => async (url, init) => {
  if (init && init.signal && init.signal.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
  return new Response(body == null ? '' : (typeof body === 'string' ? body : JSON.stringify(body)), { status, headers: { 'content-type': 'application/json', ...headers } });
};

console.log('1) 요청 식별자·스냅샷');
{
  const a = { contact: { name: '테스트', phone: '010-0000-0000' }, message: '안녕' }, b = { contact: { name: '테스트', phone: '010-0000-0000' }, message: '안녕!' };
  const ha = await contentHash(a), ha2 = await contentHash({ message: '안녕', contact: { phone: '010-0000-0000', name: '테스트' } }), hb = await contentHash(b);
  ok(ha === ha2 && ha !== hb && /^(sha256|fnv):/.test(ha), '해시: 키 순서 무관·내용 변경 시 다름');
  const s1 = prepareSubmission(null, ha); s1.payload = { provider: 'intake', body: { requestId: s1.requestId, submittedAt: 'T1' } };
  const s2 = prepareSubmission(s1, ha);
  ok(s2.reused && s2.requestId === s1.requestId && s2.payload === s1.payload, '같은 내용 재시도 → 같은 식별자 + 최초 본문 스냅샷 재사용');
  const s3 = prepareSubmission(s2, hb);
  ok(!s3.reused && s3.requestId !== s1.requestId && s3.payload === null, '내용 변경 → 새 식별자, 스냅샷 비움');
  ok(/^[0-9a-f]{32}$/.test(newRequestId()) && newRequestId() !== newRequestId(), '식별자 32자리 hex · 무작위');
  ok(canonical({ z: 1, a: { d: [1, null], c: '한' } }) === '{"a":{"c":"한","d":[1,null]},"z":1}', '안정 직렬화');
}

console.log('2) 접수 API 응답 분류');
{
  const inq = { schema: 'sr-intake/1', requestId: 'a'.repeat(32) };
  const run = async (status, body, headers) => { globalThis.fetch = mockFetch(status, body, headers); return sendIntake('https://api.test/inquiries', inq, new AbortController().signal); };
  let o = await run(201, { ok: true, intakeNo: 'IN-2026-000001', requestId: inq.requestId });
  ok(o.kind === 'ok' && o.intakeNo === 'IN-2026-000001' && o.replay === false, '201 + intakeNo → ok');
  o = await run(200, { ok: true, intakeNo: 'IN-2026-000001', replay: true });
  ok(o.kind === 'ok' && o.replay === true, '200 + replay → ok(이미 접수)');
  o = await run(200, { ok: true });
  ok(o.kind === 'server_error', '2xx 인데 intakeNo 없음 → 저장 확인 안 됨(server_error)');
  o = await run(201, { ok: true, intakeNo: 'IN-1', requestId: 'b'.repeat(32) });
  ok(o.kind === 'server_error', '응답 requestId 불일치 → 성공 아님');
  o = await run(201, { ok: true, intakeNo: '<script>' });
  ok(o.kind === 'server_error', '접수번호 형식 밖 → 성공 아님');
  o = await run(409, { ok: false, message: 'different content' });
  ok(o.kind === 'conflict', '409 → conflict');
  o = await run(400, { ok: false, error: 'bad_request', fields: ['requestId'] });
  ok(o.kind === 'rejected' && o.error === 'bad_request' && o.fields[0] === 'requestId', '400 bad_request → rejected(입력 문제 아님, 같은 본문 재시도 무의미)');
  o = await run(413, { ok: false, error: 'too_large' });
  ok(o.kind === 'rejected' && o.error === 'too_large', '413 too_large → rejected');
  o = await run(403, { ok: false, error: 'origin' });
  ok(o.kind === 'rejected' && o.error === 'origin', '403 origin → rejected');
  o = await run(429, { ok: false }, { 'Retry-After': '99999' });
  ok(o.kind === 'rate_limited' && o.retryAfter === 3600, 'Retry-After 상한 3600초');
  o = await run(429, { ok: false }, { 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' });
  ok(o.kind === 'rate_limited' && o.retryAfter === null, 'Retry-After 날짜 형식은 무시(null)');
  o = await run(422, { ok: false, fields: ['contact.phone', 42, 'x'.repeat(5)] });
  ok(o.kind === 'invalid' && o.fields.length === 2 && o.fields[0] === 'contact.phone', '422 → invalid + 문자열 fields 만');
  o = await run(429, { ok: false }, { 'Retry-After': '45' });
  ok(o.kind === 'rate_limited' && o.retryAfter === 45, '429 + Retry-After 45 → rate_limited(45초) (교차 origin 은 Expose-Headers 필요)');
  o = await run(429, { ok: false });
  ok(o.kind === 'rate_limited' && o.retryAfter === null, '429 헤더 없음 → retryAfter null');
  o = await run(503, '');
  ok(o.kind === 'server_error' && o.status === 503, '5xx → server_error');
  o = await run(403, { ok: false });
  ok(o.kind === 'rejected', '그 외 4xx → rejected');
  globalThis.fetch = async (u, init) => new Promise((res, rej) => { init.signal.addEventListener('abort', () => { const e = new Error('x'); e.name = 'AbortError'; rej(e); }); });
  o = await send({ provider: 'intake', url: 'https://api.test/x' }, inq, { timeoutMs: 30 });
  ok(o.kind === 'timeout', '시간초과 → timeout (예외 없음)');
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  o = await send({ provider: 'intake', url: 'https://api.test/x' }, inq, { timeoutMs: 30 });
  ok(o.kind === 'network', '네트워크 오류 → network');
}

console.log('3) Web3Forms 응답 분류');
{
  const run = async (status, body) => { globalThis.fetch = mockFetch(status, body); return sendWeb3Forms('https://w3.test/submit', { a: 1 }, new AbortController().signal); };
  ok((await run(200, { success: true })).kind === 'ok', 'success:true → ok');
  ok((await run(200, { success: false })).kind === 'rejected', '200 인데 success:false → rejected');
  ok((await run(429, { success: false })).kind === 'rate_limited', '429 → rate_limited');
  ok((await run(500, '')).kind === 'server_error', '5xx → server_error');
}

console.log('4) 서버 확정 fixture (tools/fixtures/intake — 백엔드 fixture 와 같은 구조, 합성 값)');
{
  const req = fx('request_ok.json');
  const run = async (status, body, headers) => { globalThis.fetch = mockFetch(status, body, headers); return sendIntake('https://api.test/api/public/inquiries', req, new AbortController().signal); };
  ok(checkInquiry(req).length === 0, 'request_ok.json 은 서버 규칙(intake_rules.cjs) 통과');
  const bad = checkInquiry(fx('request_invalid.json'));
  ok(['requestId', 'topic.key', 'contact.name', 'contact.phone', 'site.address', 'consent'].every(k => bad.includes(k)), `request_invalid.json → 오류 항목 ${bad.join(',')} (fixture response_422 와 같은 키)`);
  let o = await run(201, fx('response_201.json'));
  ok(o.kind === 'ok' && o.intakeNo === 'IQ-000001' && o.replay === false && o.receivedAt === '2026-10-30T09:12:33+09:00', 'response_201 → ok · IQ-000001 · receivedAt');
  ok(INTAKE_NO_RE.test('IQ-000001') && INTAKE_NO_RE.test('IQ-1234567'), '접수번호 형식 IQ-NNNNNN(6자리 이상) 수용');
  o = await run(200, fx('response_200_replay.json'));
  ok(o.kind === 'ok' && o.replay === true && o.intakeNo === 'IQ-000001', 'response_200_replay → ok(이미 접수)');
  o = await run(409, fx('response_409.json'));
  ok(o.kind === 'conflict' && o.error === 'conflict' && o.message.includes('새로 고친'), 'response_409 → conflict + 서버 안내문');
  o = await run(422, fx('response_422.json'));
  ok(o.kind === 'invalid' && o.fields.length === 6 && o.fields.includes('topic.key') && o.fields.includes('requestId'), 'response_422 → invalid + fields 6개(계약 키 전부 수용)');
  ok(USER_FIELDS.includes('topic.key') && !USER_FIELDS.includes('requestId') && !USER_FIELDS.includes('calc'), '사용자 수정 가능 항목 구분(topic.key 포함, requestId·calc 제외)');
  o = await run(400, fx('response_400.json'));
  ok(o.kind === 'rejected' && o.error === 'bad_request' && o.fields[0] === 'requestId', 'response_400 → rejected');
  o = await run(413, fx('response_413.json'));
  ok(o.kind === 'rejected' && o.error === 'too_large', 'response_413 → rejected');
  o = await run(429, fx('response_429.json'), { 'Retry-After': '60' });
  ok(o.kind === 'rate_limited' && o.retryAfter === 60, 'response_429 + Retry-After 60 → rate_limited 60초(계약 INQ_RETRY_AFTER)');
  o = await run(503, fx('response_503.json'));
  ok(o.kind === 'server_error' && o.error === 'server_error' && o.status === 503, 'response_503 → server_error(DB 장애)');
  o = await run(403, fx('response_403_origin.json'));
  ok(o.kind === 'rejected' && o.error === 'origin', 'response_403_origin → rejected(origin)');
  // 서버 정규화와 클라이언트 해시의 관계: 클라이언트는 바이트 동일 재시도만 보장하고, 서버는 자체 해시로 비교한다 (둘 다 submittedAt·consent.at·clientRef 를 제외)
  const a = { ...req, submittedAt: '2026-10-30T00:12:31.000Z' };
  ok(checkInquiry(a).length === 0, 'submittedAt 만 다른 재시도도 서버 규칙 통과(서버 해시는 제외 항목)');
}

console.log(fails ? `\n실패 ${fails}건` : '\n전부 통과');
process.exit(fails ? 1 : 0);
