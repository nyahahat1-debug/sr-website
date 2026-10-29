// 서버 확정 계약(sr-intake/1, 2026-10-29) 의 요청 검증 규칙을 홈페이지 검사용으로 옮긴 것 — monitor/srmon/inquiry.py normalize() 와 같은 규칙.
//   checkInquiry(body) → 오류 항목 키 목록(비어 있으면 서버가 422 를 내지 않을 본문). 검사(tools/intake_contract_test.mjs · ui_tests_phase2.js)에서만 쓴다.
//   서버가 규칙을 바꾸면 여기도 바꾼다(계약 2절 표가 기준).
const TOPICS = ['self', 'sell', 'rational', 'monitoring', 'maintenance', 'electrical', 'unsure', 'other'];
const REQUEST_ID_RE = /^[0-9a-f]{32}$/, CLIENT_REF_RE = /^SR-\d{6}-[A-HJ-NP-Z2-9]{4}$/, PHONE_RE = /^[0-9+\-() ]{5,30}$/;
const LIMITS = { 'contact.name': 50, 'site.address': 200, 'site.type': 40, 'site.monthlyBillBand': 40, message: 2000, 'topic.label': 60, 'consent.policyVersion': 20, 'source.page': 40, 'source.site': 100, calcSummary: 500 };
const MAX_BODY = 32 * 1024, MAX_CALC = 8 * 1024;
const norm = v => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : null);

function checkInquiry(body) {
  const errs = [];
  if (!body || typeof body !== 'object') return ['body'];
  if (body.schema !== 'sr-intake/1') errs.push('schema');
  if (typeof body.requestId !== 'string' || !REQUEST_ID_RE.test(body.requestId)) errs.push('requestId');
  if (body.clientRef != null && body.clientRef !== '' && (typeof body.clientRef !== 'string' || !CLIENT_REF_RE.test(body.clientRef))) errs.push('clientRef');
  const topic = body.topic && typeof body.topic === 'object' ? body.topic : {};
  const key = (topic.key == null || topic.key === '') ? 'other' : topic.key;
  if (!TOPICS.includes(key)) errs.push('topic.key');
  const contact = body.contact && typeof body.contact === 'object' ? body.contact : {};
  const name = norm(contact.name);
  if (!name || name.length > LIMITS['contact.name']) errs.push('contact.name');
  const phone = norm(contact.phone);
  if (!phone || !PHONE_RE.test(phone)) errs.push('contact.phone');
  const site = body.site && typeof body.site === 'object' ? body.site : {};
  const addr = norm(site.address);
  if (!addr || addr.length > LIMITS['site.address']) errs.push('site.address');
  if (body.message != null && typeof body.message !== 'string') errs.push('message');
  else if (typeof body.message === 'string' && norm(body.message).length > LIMITS.message) errs.push('message');
  const consent = body.consent && typeof body.consent === 'object' ? body.consent : {};
  if (consent.privacy !== true || !norm(consent.policyVersion)) errs.push('consent');
  if (body.calc != null) {
    if (typeof body.calc !== 'object' || body.calc.schema !== 'sr-calc/1') errs.push('calc');
    else if (Buffer.byteLength(JSON.stringify(body.calc), 'utf8') > MAX_CALC) errs.push('calc');
  }
  if (Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_BODY) errs.push('body');
  return errs;
}
module.exports = { checkInquiry, TOPICS, REQUEST_ID_RE, CLIENT_REF_RE, PHONE_RE, LIMITS, MAX_BODY, MAX_CALC };
