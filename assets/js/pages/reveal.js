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
