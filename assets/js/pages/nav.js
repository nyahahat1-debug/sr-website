(function(){
  var header=document.querySelector('header');
  var btn=header&&header.querySelector('.nav-toggle');
  var nav=document.getElementById('navLinks');
  if(!header||!btn||!nav)return;
  var mq=window.matchMedia('(max-width:960px)');
  function setOpen(open){
    header.classList.toggle('nav-open',open);
    btn.setAttribute('aria-expanded',open?'true':'false');
    btn.setAttribute('aria-label',open?'메뉴 닫기':'메뉴 열기');
    document.body.style.overflow=(open&&mq.matches)?'hidden':'';
  }
  btn.addEventListener('click',function(e){e.stopPropagation();setOpen(!header.classList.contains('nav-open'));});
  nav.addEventListener('click',function(e){if(e.target.closest('a'))setOpen(false);});
  document.addEventListener('click',function(e){if(!header.classList.contains('nav-open'))return;if(!header.contains(e.target)||e.target===header)setOpen(false);});
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&header.classList.contains('nav-open')){setOpen(false);btn.focus();}});
  if(mq.addEventListener)mq.addEventListener('change',function(){setOpen(false);});
})();
