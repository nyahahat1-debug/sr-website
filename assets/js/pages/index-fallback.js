// ── 폴백 훅: WebGL 미지원 / 모듈 로드 실패 / 초기화 오류 / 7초 내 준비 안 됨 → 정적 폴백
//    3D 없이도 장면 텍스트는 스크롤로 읽을 수 있게 한다. 구간 값은 timeline.js SCENES 와 동일하게 유지할 것.
window.__srGate=new Promise(function(r){window.__srGateDone=r;});     // 시작 화면에서 '들어가기'를 누르면 resolve → 타이포 인트로 시작 (scene3d/main.js)
window.__srIntro=new Promise(function(r){window.__srIntroDone=r;});   // 인트로가 끝나면 resolve (scene3d/main.js)
window.__sr3dFail=function(reason){
  window.__srIntroDone&&window.__srIntroDone();
  if(window.__sr3dFallbackOn)return; window.__sr3dFallbackOn=true; window.__sr3dFallbackReason=reason;
  console.warn('[sr3d] fallback:',reason);
  // <head> 에서 호출되면 아직 body 가 없으므로 DOM 준비 후 실행
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',function(){window.__sr3dFallbackRun(reason);});return;}
  window.__sr3dFallbackRun(reason);
};
window.__sr3dFallbackRun=function(reason){
  var stage=document.getElementById('stage'); stage.classList.add('no-webgl'); stage.classList.remove('intro','intro-lines','intro-video');
  var note=document.getElementById('fallbackNote'); if(note)note.hidden=false;
  var story=document.getElementById('story'), video=document.getElementById('stageVideo'), sh=document.getElementById('stageShade'), s1=document.getElementById('s1Shade');
  if(!video||matchMedia('(prefers-reduced-motion:reduce)').matches){ stage.classList.add('video-off'); }
  else{ video.addEventListener('error',function(){ stage.classList.add('video-off'); }); if(video.play){ video.play().catch(function(){ stage.classList.add('video-off'); }); } }
  var ovs=[].slice.call(document.querySelectorAll('.ov[data-ov]'));
  var bounds={t1:[0,.14],t2:[.14,.28],t3:[.28,.52],t4:[.52,.72],t5:[.72,.88],t6:[.88,1.01],econ:[.72,.88],cta:[.9,1.01]};
  function tick(){
    var r=story.getBoundingClientRect(), span=story.offsetHeight-innerHeight;
    var p=span>0?Math.min(1,Math.max(0,-r.top/span)):0;
    ovs.forEach(function(el){ var b=bounds[el.dataset.ov]; var on=!!b&&p>=b[0]&&p<b[1]; el.style.opacity=on?1:0; el.style.visibility=on?'visible':'hidden'; if(on)el.removeAttribute('inert');else el.setAttribute('inert',''); });
    if(video)video.style.opacity=p<.18?1:0; if(s1)s1.style.opacity=p<.18?1:0;
    if(sh)sh.style.opacity=(p>=.14&&p<.88)?1:0;
    stage.dataset.scene=p<.14?1:p<.28?2:p<.52?3:p<.72?4:p<.88?5:6;
  }
  addEventListener('scroll',tick,{passive:true}); addEventListener('resize',tick); tick();
  window.__sr3dFallbackStop=function(){ removeEventListener('scroll',tick); removeEventListener('resize',tick); };
};
(function(){ if(/[?&]nowebgl(=|&|$)/.test(location.search)){window.__sr3dFail('forced-by-query');return;} try{ var c=document.createElement('canvas'); if(!(window.WebGLRenderingContext&&(c.getContext('webgl2')||c.getContext('webgl'))))window.__sr3dFail('webgl-unsupported'); }catch(e){ window.__sr3dFail('webgl-error'); } })();
setTimeout(function(){ if(!window.__sr3dReady)window.__sr3dFail('timeout'); },/[?&]fbtest(=|&|$)/.test(location.search)?50:20000);   // ?fbtest: 시간 초과 폴백 → 3D 인수 경로 테스트용   // 느린 회선(모바일) 고려. 늦게라도 3D 가 준비되면 main.js 가 폴백을 걷어낸다
// scene3d/main.js 로드 실패 감지 (인라인 onerror 대신, 캡처 단계 리스너)
document.addEventListener('error',function(e){var t=e.target; if(t&&t.tagName==='SCRIPT'&&/scene3d\/main\.js/.test(t.src||''))window.__sr3dFail('module-load');},true);
