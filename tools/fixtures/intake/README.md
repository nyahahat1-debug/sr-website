# 접수 API fixture (서버 확정 계약 sr-intake/1, 2026-10-29)

백엔드(`monitor/docs/handoff/intake_fixtures/`)의 fixture 와 **같은 구조**를 홈페이지 쪽 검사(`tools/intake_contract_test.mjs`, `tools/ui_tests_phase2.js`)가 읽는다.
이름·연락처·주소는 합성 값(실제 인물·회사 아님). 백엔드 fixture 의 이름 예시는 이 저장소에 복사하지 않고 중립 값으로 바꿨다.
`response_400/413/429/503/403_origin` 은 계약 3절·api.py 의 응답을 그대로 옮긴 것(백엔드 fixture 폴더에는 없음).
