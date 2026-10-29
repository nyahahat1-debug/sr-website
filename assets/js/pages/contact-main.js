// 문의 폼 전송 (Web3Forms) — 입력 검증 · 전송 상태 · 시간초과 · 재시도 · 문의 참조번호
//   · 성공 표시는 Web3Forms 응답의 success 가 true 일 때만 한다 (이메일 최종 도달·담당자 확인은 알 수 없으므로 "전송 서비스가 접수" 로만 표현).
//   · 실패·시간초과·네트워크 오류 시 입력값은 그대로 두고 재시도·전화 안내.
//   · 문의 참조번호는 브라우저가 만든 번호(서버 접수번호 아님). 같은 폼 세션의 재시도에는 같은 번호를 쓰고 전송 내용에도 포함한다.
//   · 개인정보는 localStorage·콘솔에 남기지 않는다.
const reduce=window.matchMedia('(prefers-reduced-motion:reduce)').matches;

// scroll progress bar (v2 에서 숨김 — 요소가 있을 때만)
const prog=document.getElementById('progress');
if(prog&&!reduce){
  const onScroll=()=>{const h=document.documentElement;const sc=h.scrollTop/(h.scrollHeight-h.clientHeight);prog.style.width=(sc*100)+'%';};
  document.addEventListener('scroll',onScroll,{passive:true});onScroll();
}

// 숫자 즉시 표시 (v2: 카운트업 없음)
function countUp(el){
  const to=parseFloat(el.dataset.to),dec=parseInt(el.dataset.dec||'0'),suf=el.dataset.suffix||'';
  el.textContent=to.toLocaleString('ko-KR',{minimumFractionDigits:dec,maximumFractionDigits:dec})+suf;
}
const io=new IntersectionObserver(e=>e.forEach(x=>{ if(x.isIntersecting){ const el=x.target;el.classList.add('in'); el.querySelectorAll('.cu').forEach(countUp); io.unobserve(el);} }),{threshold:.12});
document.querySelectorAll('.reveal').forEach(el=>io.observe(el));
document.querySelectorAll('.cu').forEach(countUp);

// ── 관심 분야별 안내문 (상담 후 제공 범위를 확인하는 흐름 — 수행·계약 가능으로 표현하지 않는다)
const TOPIC_HINT={
  '발전소 모니터링·운영관리 상담':'운영 중인 발전소의 모니터링·운영관리 범위는 현장 설비와 계약 조건에 따라 다릅니다. 상담 후 제공 가능한 범위와 조건을 확인해 안내드립니다.',
  '발전 저하·인버터·유지보수 상담':'발전량 저하·인버터 이상·유지보수는 현장 상태와 설비 제조사 보증 조건을 확인한 뒤 가능한 조치 범위를 안내드립니다. 긴급 상황은 전화로 연락 주세요.',
  '전기설비·안전관리 문의':'전기설비·안전관리 관련 업무는 자격·인력 요건이 따르는 항목이 있어, 상담 후 직접 제공 가능한 범위와 협력사 연계가 필요한 범위를 구분해 안내드립니다.',
};
const topicSel=document.getElementById('fld-5'), topicHint=document.getElementById('topicHint');
function updateTopicHint(){ if(!topicSel||!topicHint)return; const t=TOPIC_HINT[topicSel.value]; topicHint.textContent=t||''; topicHint.hidden=!t; }
if(topicSel){ topicSel.addEventListener('change',updateTopicHint); updateTopicHint(); }
window.__srUpdateTopicHint=updateTopicHint;   // contact-prefill.js 가 ?topic= 적용 후 호출

// ── 문의 참조번호: SR-YYMMDD-XXXX (브라우저 생성, 폼 세션당 1개 — 재시도에도 동일)
function makeRef(){
  const d=new Date(), p=n=>String(n).padStart(2,'0');
  const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 혼동 글자(I,O,0,1) 제외
  let s=''; const buf=new Uint8Array(4);
  try{ crypto.getRandomValues(buf); }catch(e){ for(let i=0;i<4;i++)buf[i]=Math.floor(Math.random()*256); }
  for(const b of buf)s+=alphabet[b%alphabet.length];
  return `SR-${String(d.getFullYear()).slice(2)}${p(d.getMonth()+1)}${p(d.getDate())}-${s}`;
}

const af=document.getElementById('analysisForm');
if(af){
  const btn=af.querySelector('.form-submit');
  const status=document.getElementById('formStatus');
  const refInput=document.getElementById('fldRef');
  const okBox=document.getElementById('formOk'), okRef=document.getElementById('formOkRef');
  const TEL='063-544-8142';
  let ref=null, inFlight=false;
  const LABEL={ '담당자':'담당자 성함', '연락처':'연락처', '사업장 주소':'사업장 주소', '개인정보 수집·이용 동의':'개인정보 수집·이용 동의' };

  function setStatus(kind,html){ if(!status)return; status.className='form-status'+(kind?' '+kind:''); status.innerHTML=html; status.hidden=!html; }
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const refLine=()=>`문의 참조번호 <b>${esc(ref)}</b> (브라우저에서 만든 번호입니다. 전화 문의 시 알려 주시면 확인이 빠릅니다)`;
  const telLink=`<a href="tel:${TEL.replace(/-/g,'')}">${TEL}</a>`;

  // 입력 검증: 첫 번째 문제 항목에 포커스, 항목별 메시지
  function validate(){
    af.querySelectorAll('.form-row.invalid').forEach(r=>r.classList.remove('invalid'));
    const fields=[...af.querySelectorAll('input:not([type=hidden]):not(.hp),select,textarea')];
    for(const f of fields){
      if(f.checkValidity())continue;
      const row=f.closest('.form-row')||f.closest('.form-consent');
      if(row)row.classList.add('invalid');
      const name=LABEL[f.name]||f.name;
      let msg;
      if(f.type==='checkbox')msg='개인정보 수집·이용에 동의해 주셔야 접수할 수 있습니다.';
      else if(f.validity.valueMissing)msg=`${name}을(를) 입력해 주세요.`;
      else msg=`${name} 입력값을 확인해 주세요.`;
      setStatus('err',esc(msg));
      try{ f.focus({preventScroll:false}); }catch(e){}
      return false;
    }
    return true;
  }
  af.addEventListener('input',e=>{ const row=e.target.closest('.form-row,.form-consent'); if(row&&row.classList.contains('invalid')&&e.target.checkValidity())row.classList.remove('invalid'); });

  af.addEventListener('submit',async(e)=>{
    e.preventDefault();
    if(inFlight)return;                       // 중복 클릭 방지 (프런트엔드 한정 — 서버 측 중복 제거는 없음)
    if(af.querySelector('input[name="botcheck"]')?.checked)return;   // honeypot
    if(!validate())return;
    if(!ref)ref=makeRef();
    if(refInput)refInput.value=ref;
    // 관심 분야에 따라 메일 제목 구분 (담당자 분류용)
    const subj=af.querySelector('input[name="subject"]');
    const topic=topicSel&&topicSel.value?topicSel.value:'무료 사업성 진단 신청';
    if(subj)subj.value=`[에스알 홈페이지] ${topic} · ${ref}`;

    inFlight=true; btn.disabled=true; btn.setAttribute('aria-busy','true');
    const orig=btn.dataset.label||(btn.dataset.label=btn.textContent);
    btn.textContent='전송 중…';
    setStatus('busy',`전송 중입니다. 잠시만 기다려 주세요. ${refLine()}`);

    const fd=new FormData(af);
    fd.delete('botcheck');
    const payload=JSON.stringify(Object.fromEntries(fd));
    const ctrl=new AbortController(); const timer=setTimeout(()=>ctrl.abort(),20000);
    let outcome='error';
    try{
      const res=await fetch('https://api.web3forms.com/submit',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:payload,signal:ctrl.signal});
      let data=null; try{ data=await res.json(); }catch(e){ data=null; }
      if(res.ok&&data&&data.success===true)outcome='ok';
      else outcome='rejected';
    }catch(err){ outcome=(err&&err.name==='AbortError')?'timeout':'network'; }
    finally{ clearTimeout(timer); }

    if(outcome==='ok'){
      // 성공: 전송 서비스가 접수를 확인한 상태. 이메일 도달·담당자 확인은 별도.
      setStatus('',''); af.hidden=true;
      if(okRef)okRef.innerHTML=refLine();
      if(okBox){ okBox.hidden=false; okBox.setAttribute('tabindex','-1'); okBox.focus({preventScroll:true}); okBox.scrollIntoView({behavior:reduce?'auto':'smooth',block:'center'}); }
      inFlight=false; return;
    }
    // 실패·시간초과·네트워크: 입력값 유지, 재시도 안내
    const msg= outcome==='timeout'
      ? `응답이 20초 안에 오지 않았습니다. 전송됐는지 확인할 수 없으니 잠시 후 <b>다시 전송</b>을 눌러 주세요(같은 참조번호로 보내집니다). 급하시면 ${telLink}로 전화 주세요. ${refLine()}`
      : outcome==='network'
      ? `네트워크 오류로 전송하지 못했습니다. 연결을 확인한 뒤 다시 전송해 주세요. 급하시면 ${telLink}로 전화 주세요. ${refLine()}`
      : `전송 서비스가 접수를 거부했습니다. 잠시 후 다시 시도하시거나 ${telLink}로 전화 주세요. ${refLine()}`;
    setStatus('err',msg);
    btn.disabled=false; btn.removeAttribute('aria-busy'); btn.textContent=outcome==='timeout'?'다시 전송':orig;
    inFlight=false;
    status&&status.scrollIntoView({behavior:reduce?'auto':'smooth',block:'nearest'});
  });
}
