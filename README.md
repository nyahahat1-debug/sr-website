# 주식회사 에스알 홈페이지

태양광 EPC · 전기공사 · 수전합리화 회사 홈페이지. 서버 없는 정적 사이트(HTML/CSS/JS)입니다.

- 공개 주소: https://nyahahat1-debug.github.io/sr-website/ (GitHub Pages, `main` 브랜치 루트)
- 로컬 미리보기: `python -m http.server 8931` 후 http://localhost:8931

## 구성
- `index.html` 메인(시작 화면 → 타이포 인트로 → 3D 스크롤 스토리), `business.html` 사업영역, `analysis.html` 경제성 분석(시세 차트·계산기), `cases.html`·`case-*.html` 프로젝트, `about.html`, `contact.html`
- `assets/js/scene3d/` 3D 스토리(Three.js, 모델은 `assets/models/`), `assets/js/economics/` 경제성 계산기(요금제·시세), `assets/js/market/` 시세 차트
- `tools/market_collect.py` 전력거래소 SMP·REC 수집기 → `assets/data/market.json` (`.github/workflows/market.yml` 이 매일 06:30·18:30 KST 실행, 저장소 비밀값 `DATA_GO_KR_KEY` 필요)
- `docs/` 설계·작업 기록 (`docs/PHASE2_시제품_보고.md`, `docs/DESIGN_V2.md`)

## 주의
- 효성첨단소재 사례의 투자비·회수기간은 게시하지 않습니다. 미확정 실적 수치는 `<template data-v2>` 로 숨겨 두었습니다.
- 공공데이터포털 인증키는 코드에 넣지 말고 환경변수/저장소 비밀값으로만 씁니다.
