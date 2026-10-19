const reduce=window.matchMedia('(prefers-reduced-motion:reduce)').matches;

// scroll progress bar
const prog=document.getElementById('progress');
if(prog&&!reduce){
  const onScroll=()=>{const h=document.documentElement;const sc=h.scrollTop/(h.scrollHeight-h.clientHeight);prog.style.width=(sc*100)+'%';};
  document.addEventListener('scroll',onScroll,{passive:true});onScroll();
}

// (히어로 영상은 3D 스테이지의 #stageVideo 가 담당 — scene3d/main.js)

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
    if(el.classList.contains('report')){
      el.classList.add('swept');
      const bars=el.querySelectorAll('.bar');
      bars.forEach((b,i)=>setTimeout(()=>b.style.height=b.dataset.h+'%',reduce?0:i*48+300));
    }
    io.unobserve(el);
  }
}),{threshold:.12});
document.querySelectorAll('.reveal').forEach(el=>io.observe(el));
document.querySelectorAll('.cu').forEach(countUp);   // v2: 숫자는 스크롤과 무관하게 즉시 표시

// hero trust-bar count-up (not inside .reveal, fire after entrance)
(window.__srIntro||Promise.resolve()).then(()=>setTimeout(()=>{document.querySelectorAll('.trust-bar .cu').forEach(countUp);},reduce?0:600));

// prep bars
const bw=document.getElementById('bars');
if(bw)bw.querySelectorAll('.bar').forEach(b=>b.style.height='6px');

(function(){
  const state={site:null,bill:null,contract:null,peak:null,daytime:null,space:null};
  const f=document.getElementById('dxForm');if(!f)return;
  f.querySelectorAll('.chips').forEach(g=>{
    g.addEventListener('click',e=>{
      const c=e.target.closest('.chip');if(!c)return;
      g.querySelectorAll('.chip').forEach(x=>x.classList.remove('sel'));
      c.classList.add('sel');state[g.dataset.key]=c.dataset.v;
      g.closest('.dx-q').classList.remove('missing');
      document.getElementById('dxHint').textContent='';
    });
  });
  const bm={b1:70,b2:300,b3:1000,b4:2000};
  const fmt=n=>n.toLocaleString('ko-KR');
  function score(){
    const s=state;
    let self=0;
    self+={high:38,mid:20,low:4}[s.daytime]||0;
    self+={large:30,some:16,none:2}[s.space]||0;
    self+={b4:28,b3:20,b2:12,b1:4,bx:14}[s.bill]||0;
    self+={factory:6,logistics:8,building:5,transport:6,land:0}[s.site]||0;
    let sell=0;
    sell+={large:40,some:20,none:2}[s.space]||0;
    sell+={low:28,mid:12,high:2}[s.daytime]||0;
    sell+={land:24,transport:10,building:6,logistics:6,factory:2}[s.site]||0;
    sell+=5;
    let rat=0,rs='ok';
    if(s.contract==='lowV'){rat=0;rs='already';}
    else if(s.peak==='over500'){rat=0;rs='peak';}
    else{
      rat+={highV:42,cx:22,general:10}[s.contract]||0;
      rat+={under500:34,px:16}[s.peak]||0;
      rat+={b4:24,b3:18,b2:9,b1:3,bx:12}[s.bill]||0;
    }
    const cap=v=>Math.min(100,Math.round(v));
    return[{id:'self',name:'자가소비 태양광',score:cap(self)},{id:'sell',name:'태양광 발전(판매)',score:cap(sell)},{id:'rat',name:'수전합리화',score:cap(rat),status:rs}];
  }
  function verdict(m){
    if(m.id==='rat'&&m.status==='already')return{t:'해당 없음',rec:false};
    if(m.id==='rat'&&m.status==='peak')return{t:'전환 불가',rec:false};
    if(m.score>=62)return{t:'추천',rec:true};
    if(m.score>=38)return{t:'검토 가능',rec:false};
    return{t:'적합도 낮음',rec:false};
  }
  function reason(m){
    if(m.id==='self')return'낮 시간 전력 사용과 지붕·부지 조건을 보면, 자가소비 방식이 가장 경제적일 가능성이 높습니다.';
    if(m.id==='sell')return'자가 소비가 많지 않고 활용할 부지가 있어, 발전판매 사업이 적합합니다.';
    if(state.contract==='cx'||state.peak==='px')return'고압 여부와 피크(500kW 미만)만 확인되면, 태양광 없이 요금제를 저압으로 바꿔 매월 20~30% 절감할 수 있습니다.';
    return'현재 고압 요금에 실제 피크가 500kW 미만이라, 요금제를 저압(갑)으로 바꾸는 것만으로 매월 20~30% 절감이 가능한 조건입니다.';
  }
  document.getElementById('dxRun').addEventListener('click',()=>{
    let miss=false;
    f.querySelectorAll('.chips').forEach(g=>{if(!state[g.dataset.key]){g.closest('.dx-q').classList.add('missing');miss=true;}});
    if(miss){document.getElementById('dxHint').textContent='모든 항목을 선택해 주세요.';return;}
    const ranked=score().sort((a,b)=>b.score-a.score);
    let lead=ranked[0];
    if(lead.id==='rat'&&(lead.status==='already'||lead.status==='peak'))lead=ranked.find(r=>r.id!=='rat')||lead;
    const weak=lead.score<32;
    const mid=bm[state.bill];
    let est=null;
    if(lead.id==='rat'&&mid){const lo=Math.round(mid*.2),hi=Math.round(mid*.3);est={m:`월 약 ${fmt(lo)}~${fmt(hi)}만 원`,y:`연 약 ${fmt(lo*12)}~${fmt(hi*12)}만 원`};}
    const bars=ranked.map(m=>{const v=verdict(m);const top=m.id===lead.id&&!weak;return`<div class="dx-brow"><span class="dx-bname">${m.name}</span><span class="dx-btrack"><span class="dx-bfill ${top?'top':''}" data-w="${m.score}"></span></span><span class="dx-bverdict ${v.rec?'rec':''}">${v.t} · ${m.score}</span></div>`;}).join('');
    let html='';
    if(weak){html=`<div class="dx-rlabel">진단 결과</div><div class="dx-rhead">조건이 경계에 있어 단정하기 어렵습니다.<br><b>정밀진단으로 정확히 짚어 드립니다.</b></div><div class="dx-reason">최근 전기요금 명세와 현장 정보를 보면 숫자로 가려낼 수 있습니다.</div>`;}
    else{html=`<div class="dx-rlabel">진단 결과 · 추천</div><div class="dx-rhead">현재 조건에서는 <b>${lead.name}</b> 방식이 가장 적합합니다.</div><div class="dx-reason">${reason(lead)}</div>`;if(est)html+=`<div class="dx-est"><span class="el">추정 절감액 (수전합리화)</span><span class="ev">${est.m}</span><span class="ev">${est.y}</span></div>`;}
    html+=`<div class="dx-bars">${bars}</div><div class="dx-rfoot">* 입력 정보 기반 참고용. 실제 효과는 현장 분석 후 확정됩니다.</div><div class="dx-rcta"><a href="contact.html" class="btn btn-sky" style="font-size:14px;padding:12px 20px">이 결과로 정밀진단 신청</a></div>`;
    const box=document.getElementById('dxResult');
    box.innerHTML=html;box.hidden=false;
    requestAnimationFrame(()=>box.querySelectorAll('.dx-bfill').forEach(x=>x.style.width=x.dataset.w+'%'));
    box.scrollIntoView({behavior:'smooth',block:'nearest'});
  });
  document.getElementById('dxReset').addEventListener('click',()=>{
    Object.keys(state).forEach(k=>state[k]=null);
    f.querySelectorAll('.chip').forEach(c=>c.classList.remove('sel'));
    f.querySelectorAll('.dx-q').forEach(q=>q.classList.remove('missing'));
    document.getElementById('dxHint').textContent='';
    document.getElementById('dxResult').hidden=true;
  });
})();
