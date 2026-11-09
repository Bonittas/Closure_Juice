/* Maleda Juice: page chrome around the 3D story (preloader, progress dots, sticky CTA, smooth anchors, hours, newsletter). No network calls. */
(function(){
  const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
  const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- preloader: waits for the first 3D frame (with a fail-safe) ---- */
  const loader=$('#loader');let gone=false;
  function hideLoader(){if(gone)return;gone=true;loader.classList.add('done');setTimeout(()=>loader.remove(),900);}
  if(window.__maledaReady)hideLoader();
  document.addEventListener('maleda:ready',()=>setTimeout(hideLoader,250));
  setTimeout(hideLoader,9000);
  window.addEventListener('error',()=>setTimeout(hideLoader,400));

  /* ---- smooth anchor scrolling (story chapters land on their key moment) ---- */
  const chapters=$$('[data-i]');
  function targetY(el){
    const r=el.getBoundingClientRect(),top=r.top+scrollY;
    if(el.matches('.chap'))return el.dataset.i==='0'?0:Math.max(0,top+0.42*el.offsetHeight-0.5*innerHeight);
    return Math.max(0,top-(el.id==='menu'?0:70));
  }
  function go(hash){const el=hash&&hash.length>1&&document.getElementById(hash.slice(1));if(!el)return false;
    scrollTo({top:targetY(el),behavior:reduce?'auto':'smooth'});history.replaceState(null,'',hash);return true;}
  document.addEventListener('click',e=>{const a=e.target.closest('a[href^="#"]');if(!a)return;if(go(a.getAttribute('href')))e.preventDefault();});

  /* ---- progress dots + sticky CTA ---- */
  const dots=$$('#steps a'),steps=$('#steps'),cta=$('#stickycta'),menu=$('#menu'),after=$('#after');
  function onScroll(){
    const vh=innerHeight,c=scrollY+0.5*vh;let P=5;
    for(let i=0;i<5;i++){const el=chapters[i],t=el.offsetTop,u=(c-t)/el.offsetHeight;if(u<1){P=i+Math.max(0,u);break;}}
    const A=Math.min(5,Math.floor(P));
    dots.forEach((d,i)=>{d.classList.toggle('on',i===A);d.style.setProperty('--p',i<A?1:i===A?(P-i):0);});
    const menuTop=menu.getBoundingClientRect().top;
    steps.classList.toggle('hide',menuTop<vh*0.6);
    cta.classList.toggle('show',scrollY>vh*0.6&&menuTop>vh*0.85);
  }
  addEventListener('scroll',onScroll,{passive:true});addEventListener('resize',onScroll);onScroll();

  /* ---- today's opening hours ---- */
  const d=new Date().getDay();
  $$('.hrs tr').forEach(tr=>{if(tr.dataset.d.split(',').includes(String(d))){tr.classList.add('today');tr.querySelector('th').insertAdjacentHTML('beforeend',' <em>today</em>');}});

  /* ---- reveal-on-scroll for the extra sections ---- */
  if('IntersectionObserver' in window){const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('seen');io.unobserve(e.target);}}),{threshold:0.15});
    $$('.band').forEach(b=>io.observe(b));}else $$('.band').forEach(b=>b.classList.add('seen'));

  /* ---- newsletter: front-end only, nothing is sent ---- */
  const f=$('#nlform'),inp=$('#nlemail'),err=$('#nlerr'),thanks=$('#nlthanks');
  f.addEventListener('submit',e=>{e.preventDefault();
    const v=inp.value.trim();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)){err.textContent='Please enter a valid email address.';inp.setAttribute('aria-invalid','true');inp.focus();return;}
    err.textContent='';inp.removeAttribute('aria-invalid');f.hidden=true;thanks.hidden=false;});
})();
