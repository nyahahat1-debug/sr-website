// 문의 폼 사전 선택 — URL 의 ?topic= (허용 목록) 과 ?calc= (계산기 조건 요약) 을 폼에 채운다.
//   · topic 값은 허용 목록의 키만 받고, 해당 <option> 이 있을 때만 선택한다. 사용자가 바꿀 수 있다.
//   · calc 는 문자열 길이·형식만 검사해 textarea 의 value 로 넣는다 (HTML 로 삽입하지 않음). 이미 적힌 내용이 있으면 덮어쓰지 않는다.
//   · 이름·연락처·주소 같은 개인정보는 URL 로 받지 않는다.
(function(){
  var TOPICS={ self:'자가소비 태양광', sell:'태양광 발전(판매)', rational:'수전합리화',
    monitoring:'발전소 모니터링·운영관리 상담', maintenance:'발전 저하·인버터·유지보수 상담', electrical:'전기설비·안전관리 문의', unsure:'잘 모름 (비교 원함)' };
  var CALC_MAX=600;
  var q; try{ q=new URLSearchParams(location.search); }catch(e){ return; }
  var topic=q.get('topic'), calc=q.get('calc');
  var touched=false;
  if(topic&&Object.prototype.hasOwnProperty.call(TOPICS,topic)){
    var sel=document.getElementById('fld-5');
    if(sel){
      var label=TOPICS[topic], has=false;
      for(var i=0;i<sel.options.length;i++){ if(sel.options[i].value===label||sel.options[i].text===label){ sel.value=sel.options[i].value; has=true; break; } }
      if(has){ touched=true; if(window.__srUpdateTopicHint)window.__srUpdateTopicHint(); }
    }
  }
  if(typeof calc==='string'&&calc.length>0&&calc.length<=CALC_MAX&&!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(calc)){
    var t=document.querySelector('textarea[name="추가 내용"]');
    if(t&&!t.value){ t.value=calc.replace(/\s+$/,''); touched=true; }
  }
  if(touched){
    var f=document.getElementById('analysisForm');
    if(f)setTimeout(function(){ f.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth',block:'start'}); },300);
  }
})();
