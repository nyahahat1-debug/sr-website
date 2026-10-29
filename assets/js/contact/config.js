// 문의 전송 경로 설정 — UI(contact-main.js)와 전송 공급자 구현(transport.js)을 분리한다.
//   provider: 'web3forms' (현재 운영) | 'intake' (자체 접수 API — 주소가 확정되기 전에는 켜지 않는다)
//   운영 전환 절차(docs/handoff/INTAKE_API_CONTRACT.md 12장): ① intakeApiUrl 에 확정 공개 주소(https, 경로 /api/public/inquiries) 기입 → `python tools/security_meta.py --write`
//   (contact.html 의 CSP connect-src 에 그 origin 이 자동 추가) → `python tools/security_check.py --ci` ② 시험 통과 뒤 provider 를 'intake' 로.
//   2026-10-29 현재 서버의 공개 진입점(도메인·TLS·역프록시)이 미정이라 주소를 비워 둔다 — 임의 주소를 넣지 않는다.
//   개발·시험: 로컬(localhost·127.0.0.1)에서 ?intake=dev 를 붙이면 같은 origin 의 /__dev__/intake/inquiries 로 보낸다.
//   공개 사이트에서는 이 플래그가 무시되므로 시험용 응답이 운영 화면에 쓰일 수 없다.
export const INTAKE_CONFIG = Object.freeze({
  provider: 'web3forms',
  intakeApiUrl: '',                 // 공개 진입점 확정 후 기입 (형식: https://<공개 호스트>/api/public/inquiries). 비어 있으면 접수 API 를 켜지 않는다
  intakeSchema: 'sr-intake/1',      // 요청 본문 스키마 (서버 확정 계약 docs/handoff/INTAKE_API_CONTRACT.md)
  intakeHealthSuffix: '/health',    // 연결 점검 GET {intakeApiUrl}/health → {ok:true, schema:'sr-intake/1'} (운영자 확인용, 페이지는 호출하지 않는다)
  web3formsUrl: 'https://api.web3forms.com/submit',
  timeoutMs: 20000,
  devFlag: 'intake', devValue: 'dev', devPath: '/__dev__/intake/inquiries',
});
const DEV_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** 이번 제출에 쓸 공급자 하나를 고른다 (동시에 둘을 쓰지 않는다) */
export function resolveProvider(loc = location) {
  if (INTAKE_CONFIG.provider === 'intake' && INTAKE_CONFIG.intakeApiUrl) return { provider: 'intake', url: INTAKE_CONFIG.intakeApiUrl, dev: false };
  let q = null; try { q = new URLSearchParams(loc.search); } catch (e) { q = null; }
  if (q && q.get(INTAKE_CONFIG.devFlag) === INTAKE_CONFIG.devValue && DEV_HOSTS.has(loc.hostname)) return { provider: 'intake', url: INTAKE_CONFIG.devPath, dev: true };
  return { provider: 'web3forms', url: INTAKE_CONFIG.web3formsUrl, dev: false };
}
