# 주식회사 에스알 홈페이지

태양광 EPC · 전기공사 · 수전합리화 회사 홈페이지. 서버 없는 정적 사이트(HTML/CSS/JS)입니다.

- 공개 주소: https://nyahahat1-debug.github.io/sr-website/ (GitHub Pages, `main` 브랜치 루트)
- 로컬 미리보기: `python -m http.server 8931` 후 http://localhost:8931

## 구성
- `index.html` 메인(시작 화면 → 타이포 인트로 → 3D 스크롤 스토리 → 오늘의 전력 시세), `business.html` 사업영역, `analysis.html` 경제성 분석(시세 차트·계산기), `cases.html`·`case-*.html` 프로젝트, `about.html`, `contact.html`(문의 폼·지도), `privacy.html` 개인정보처리방침
- `assets/js/pages/` 페이지별 스크립트, `assets/js/site.js` 공통 보안 스크립트, `assets/js/scene3d/` 3D 스토리(Three.js, 모델은 `assets/models/`), `assets/js/economics/` 경제성 계산기, `assets/js/market/` 시세 차트
- `map-embed.html` 카카오맵 전용 sandbox iframe 페이지
- `tools/market_collect.py` 전력거래소 SMP·REC 수집기 → `assets/data/market.json` (`.github/workflows/market.yml` 이 매일 06:30·18:30 KST 실행, 저장소 비밀값 `DATA_GO_KR_KEY` 필요)
- `tools/carbon_collect.py` 배출권(KAU) 종가 수집기(한국거래소 공개 조회, 키 없음) → `assets/data/carbon.json` (시세 워크플로에서 함께 실행). 효성 사례 페이지의 월별 경제효과는 `assets/data/hyosung-generation.json` 의 월 발전량 × 요금제(`assets/js/economics/selfuse.js`) + 배출권 시세로 계산
- `tools/generation_collect.py` 현장 발전 현황 수집기(HI SMART 모니터링) → `assets/data/generation.json` (`.github/workflows/generation.yml` 이 06~20시 KST 매시 실행, 비밀값 `HS3_USER_ID`·`HS3_PASSWORD` 필요, 대상 현장은 `tools/generation_sites.json`). 파일이 없으면 메인·현장 페이지의 발전 현황은 표시되지 않습니다.
- `tools/security_meta.py`, `tools/security_check.py` 보안 메타 생성·점검 (`.github/workflows/security-check.yml` 이 푸시마다 실행)
- `_config.yml` GitHub Pages 게시 제외 목록

## 보안 규칙
- 모든 페이지에 Content-Security-Policy 메타가 걸려 있어 인라인 `<script>` 와 `onclick` 같은 인라인 속성은 동작하지 않습니다. 스크립트는 `assets/js/` 아래 파일로 두고 `<script src>` 로 불러오세요.
- 새 외부 도메인(폰트·API·iframe)이 필요하면 `tools/security_meta.py` 의 `EXTRA` 에 추가한 뒤 `python tools/security_meta.py --write` 를 실행합니다.
- 커밋 전 `python tools/security_check.py` 로 점검합니다. 같은 검사가 GitHub Actions(보안 점검)에서 다시 돌아갑니다.
- 인증키·토큰은 코드와 문서에 쓰지 않고 환경변수/저장소 비밀값으로만 씁니다. 내부 문서(`docs/`, `_private/`)와 개인 도구 설정(`.claude/`)은 공개 저장소에 올리지 않습니다.
- 취약점 신고: [SECURITY.md](SECURITY.md)
