const reduce=window.matchMedia('(prefers-reduced-motion:reduce)').matches;

// scroll progress bar
const prog=document.getElementById('progress');
if(prog&&!reduce){
  const onScroll=()=>{const h=document.documentElement;const sc=h.scrollTop/(h.scrollHeight-h.clientHeight);prog.style.width=(sc*100)+'%';};
  document.addEventListener('scroll',onScroll,{passive:true});onScroll();
}

// count-up helper
function countUp(el){
  const to=parseFloat(el.dataset.to),dec=parseInt(el.dataset.dec||'0'),suf=el.dataset.suffix||'';
  el.textContent=to.toLocaleString('ko-KR',{minimumFractionDigits:dec,maximumFractionDigits:dec})+suf;   // v2: 카운트업 애니메이션 제거 — 숫자는 바로 보여준다
}

// reveal + trigger nested animations
const io=new IntersectionObserver(e=>e.forEach(x=>{
  if(x.isIntersecting){
    const el=x.target;el.classList.add('in');setTimeout(()=>el.classList.add('done'),1000);
    el.querySelectorAll('.cu').forEach(countUp);
    io.unobserve(el);
  }
}),{threshold:.12});
document.querySelectorAll('.reveal').forEach(el=>io.observe(el));
document.querySelectorAll('.cu').forEach(countUp);   // v2: 숫자는 스크롤과 무관하게 즉시 표시

// v2: 분류 필터 (사업방식 기준)
(function(){
  var bar=document.querySelector('.filter-bar');if(!bar)return;
  var cards=[].slice.call(document.querySelectorAll('#gal>.tile'));
  bar.addEventListener('click',function(e){
    var b=e.target.closest('.filter-btn');if(!b)return;
    bar.querySelectorAll('.filter-btn').forEach(function(x){var on=x===b;x.classList.toggle('on',on);x.setAttribute('aria-pressed',on?'true':'false');});
    var f=b.dataset.filter||'all';
    cards.forEach(function(c){c.hidden=!(f==='all'||(c.dataset.cat||'').split(' ').indexOf(f)>=0);});
  });
})();
