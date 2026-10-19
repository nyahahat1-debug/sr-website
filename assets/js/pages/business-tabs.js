document.querySelectorAll('.biz-tab').forEach(tab=>{
  tab.addEventListener('click',()=>{
    document.querySelectorAll('.biz-tab').forEach(t=>t.classList.remove('on'));
    document.querySelectorAll('.biz-panel').forEach(p=>p.classList.remove('on'));
    tab.classList.add('on');
    document.getElementById(tab.dataset.target).classList.add('on');
    tab.scrollIntoView({block:'nearest',inline:'nearest',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'});
  });
});
// v2: index 원장에서 #factory 등으로 들어오면 해당 탭을 연다
(function(){var id=location.hash.replace('#','');var t=id&&document.querySelector('.biz-tab[data-target="'+id+'"]');if(t)t.click();})();
