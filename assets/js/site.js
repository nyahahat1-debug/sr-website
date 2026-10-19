/* 공통 보안·안전 스크립트 — 모든 페이지의 <head> 에서 동기 로드 (CSP script-src 'self' 와 함께 사용)
   · 정적 호스팅(GitHub Pages)은 X-Frame-Options / frame-ancestors 헤더를 보낼 수 없어 프레임 차단을 스크립트로 보완
   · 인라인 onerror 를 쓰지 않도록 이미지 대체(webp→jpg)를 한곳에서 처리
   · 새 창 링크는 항상 opener 를 끊는다
   자체 iframe(map-embed.html)은 이 파일을 포함하지 않는다. */
(function () {
  'use strict';
  // 1) 클릭재킹 방지: 다른 사이트의 프레임 안에서 열리면 최상위로 빠져나오고, 막히면 화면을 숨긴다
  try {
    if (window.top !== window.self) { window.top.location.href = window.location.href; }
  } catch (e) {
    document.documentElement.style.display = 'none';
  }
  // 2) 이미지 대체: data-fallback="jpg" → .webp 실패 시 .jpg 한 번 시도, 그래도 실패하면 제거
  //                data-fallback="<경로>" → 그 경로로 한 번 교체
  document.addEventListener('error', function (e) {
    var t = e.target;
    if (!t || t.tagName !== 'IMG') return;
    var fb = t.getAttribute('data-fallback');
    if (!fb) return;
    if (t.dataset.f) { if (fb === 'jpg') t.remove(); return; }
    t.dataset.f = '1';
    t.src = fb === 'jpg' ? t.src.replace('.webp', '.jpg') : fb;
  }, true);
  // 3) target=_blank 링크의 opener 차단
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[target="_blank"]') : null;
    if (a && !/\bnoopener\b/.test(a.rel || '')) a.rel = (a.rel ? a.rel + ' ' : '') + 'noopener noreferrer';
  }, true);
})();
