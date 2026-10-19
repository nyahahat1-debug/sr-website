# 보안 정책 / Security Policy

주식회사 에스알 홈페이지(https://nyahahat1-debug.github.io/sr-website/)의 보안 문제를 발견하셨다면 알려 주세요.

## 신고 방법
- 이메일: hbok1234@naver.com (제목에 `[보안]` 을 붙여 주세요)
- 전화: 063-544-8142 (영업일)
- 공개 이슈에는 취약점 내용을 올리지 말아 주세요. 영업일 기준 3일 이내에 회신합니다.

## 범위
- 이 저장소의 HTML/CSS/JS, `tools/` 의 수집 스크립트, GitHub Actions 워크플로
- 문의 폼으로 전송되는 개인정보의 보호

## 범위 밖
- 외부 서비스 자체(GitHub Pages, Web3Forms, 카카오맵, 공공데이터포털)의 취약점은 해당 서비스에 신고해 주세요.

## 저장소 운영 원칙
- 인증키·토큰은 코드와 문서에 쓰지 않고 저장소 비밀값(Secrets)으로만 전달합니다.
- 모든 페이지에 Content-Security-Policy 를 적용하고 인라인 스크립트를 쓰지 않습니다. `tools/security_check.py` 가 푸시마다 이를 검사합니다.
- 외부 액션은 커밋 SHA 로 고정하고 Dependabot 으로 갱신합니다.

---

If you believe you have found a security issue in this site, email hbok1234@naver.com with `[security]` in the subject. Please do not open a public issue. We aim to respond within 3 business days.
