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

// reveal + trigger nested count-ups
const io=new IntersectionObserver(e=>e.forEach(x=>{
  if(x.isIntersecting){
    const el=x.target;el.classList.add('in');
    el.querySelectorAll('.cu').forEach(countUp);
    io.unobserve(el);
  }
}),{threshold:.12});
document.querySelectorAll('.reveal').forEach(el=>io.observe(el));
document.querySelectorAll('.cu').forEach(countUp);   // v2: 숫자는 스크롤과 무관하게 즉시 표시

// 문의 폼 전송 (Web3Forms)
const af=document.getElementById('analysisForm');
if(af){
  af.addEventListener('submit',async(e)=>{
    e.preventDefault();
    const btn=af.querySelector('.form-submit');
    const orig=btn.textContent;btn.disabled=true;btn.textContent='전송 중…';
    try{
      const payload=JSON.stringify(Object.fromEntries(new FormData(af)));
      const res=await fetch('https://api.web3forms.com/submit',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:payload});
      const data=await res.json();
      if(data.success){
        af.style.display='none';
        document.getElementById('formOk').hidden=false;
        document.getElementById('formOk').scrollIntoView({behavior:'smooth',block:'center'});
      }else{
        alert('전송에 실패했습니다. 잠시 후 다시 시도하시거나 063-544-8142로 연락 주세요.');
        btn.disabled=false;btn.textContent=orig;
      }
    }catch(err){
      alert('전송 중 오류가 발생했습니다. 063-544-8142로 연락 주세요.');
      btn.disabled=false;btn.textContent=orig;
    }
  });
}
