// 경제성 계산기에서 넘어온 조건 요약을 '추가 내용' 칸에 채운다 (calcPrefill)
(function(){var v=new URLSearchParams(location.search).get('calc');if(!v)return;var t=document.querySelector('textarea[name="추가 내용"]');if(t&&!t.value){t.value=v;}var f=t&&t.closest('form');if(f)setTimeout(function(){f.scrollIntoView({behavior:'smooth',block:'start'});},300);})();
