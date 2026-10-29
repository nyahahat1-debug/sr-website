// 문의 전송 경로 설정 — UI(contact-main.js)와 전송 공급자 구현(transport.js)을 분리한다.
//   provider: 'web3forms' (현재 운영) | 'intake' (자체 접수 API — 주소가 확정되기 전에는 켜지 않는다)
//   운영 전환 절차: intakeApiUrl 에 실제 주소를 넣고 provider 를 'intake' 로 바꾼 뒤, tools/security_meta.py 의 contact.html
//   connect-src 에 같은 origin 을 등록하고 `python tools/security_meta.py --write` 로 CSP 를 갱신한다 (연결 전에는 CSP 가 막는다).
//   개발·시험: 로컬(localhost·127.0.0.1)에서 ?intake=dev 를 붙이면 같은 origin 의 /__dev__/intake/inquiries 로 보낸다.
//   공개 사이트에서는 이 플래그가 무시되므로 시험용 응답이 운영 화면에 쓰일 수 없다.
export const INTAKE_CONFIG = Object.freeze({
  provider: 'web3forms',
  intakeApiUrl: '',                 // 예: 'https://intake.example.com/api/inquiries' — 백엔드 계약 확정 후 기입
  intakeSchema: 'sr-intake/1',      // 요청 본문 스키마 (docs/handoff/INTAKE_API_CONTRACT.md)
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
