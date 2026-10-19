(function(){
  var g=document.getElementById('gate'); if(!g)return;
  var done=function(){ try{sessionStorage.setItem('srGateSeen','1');}catch(e){} document.documentElement.classList.remove('gate-open'); window.__srGateDone&&window.__srGateDone(); };
  var skip=/[?&]nogate(=|&|$)/.test(location.search), force=/[?&]gate(=|&|$)/.test(location.search), seen=false;
  try{ seen=sessionStorage.getItem('srGateSeen')==='1'; }catch(e){}
  if(skip||(seen&&!force)){ g.remove(); done(); return; }
  document.documentElement.classList.add('gate-open');
  g.classList.add('in');                                               // 등장·회전은 CSS 애니메이션
  var btn=document.getElementById('gEnter'), leaving=false;
  setTimeout(function(){ try{ btn.focus({preventScroll:true}); }catch(e){} },1400);
  btn.addEventListener('click',function(){
    if(leaving)return; leaving=true; g.classList.add('leave');
    var reduce=false; try{ reduce=matchMedia('(prefers-reduced-motion:reduce)').matches; }catch(e){}
    setTimeout(function(){ g.remove(); done(); }, reduce?50:1000);
  });
})();
