/* Maleda: page chrome around the 3D story (preloader, header + mobile menu, progress dots, sticky CTA, smooth anchors, hours, newsletter). No network calls. */
(function(){
  const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
  const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- preloader: waits for the first 3D frame (with a fail-safe) ---- */
  const loader=$('#loader');let gone=false;
  function hideLoader(){if(gone)return;gone=true;loader.classList.add('done');setTimeout(()=>loader.remove(),900);}
  if(window.__maledaReady)hideLoader();
  document.addEventListener('maleda:ready',hideLoader);      // the hero's programs are ready: show it at once
  setTimeout(hideLoader,30000);          // fail-safe only (the 3D start-up is time-boxed and signals maleda:ready itself)
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
  document.addEventListener('click',e=>{const a=e.target.closest('a[href^="#"]');if(!a)return;const href=a.getAttribute('href');
    if(href==='#'){e.preventDefault();return;}                 // social / legal links without a destination yet
    if(mnav.classList.contains('open'))closeMenu(false);
    if(go(href))e.preventDefault();});

  /* ---- mobile menu ---- */
  const burger=$('.burger'),mnav=$('#mnav');
  function openMenu(){mnav.hidden=false;requestAnimationFrame(()=>mnav.classList.add('open'));document.documentElement.classList.add('nav-open');
    burger.setAttribute('aria-expanded','true');burger.setAttribute('aria-label','Close menu');const f=mnav.querySelector('a');f&&f.focus({preventScroll:true});}
  function closeMenu(refocus=true){mnav.classList.remove('open');document.documentElement.classList.remove('nav-open');
    burger.setAttribute('aria-expanded','false');burger.setAttribute('aria-label','Open menu');setTimeout(()=>{if(!mnav.classList.contains('open'))mnav.hidden=true;},260);
    if(refocus)burger.focus({preventScroll:true});}
  burger.addEventListener('click',()=>mnav.classList.contains('open')?closeMenu():openMenu());
  document.addEventListener('keydown',e=>{if(!mnav.classList.contains('open'))return;
    if(e.key==='Escape'){closeMenu();return;}
    if(e.key==='Tab'){const f=[burger,...mnav.querySelectorAll('a')],i=f.indexOf(document.activeElement);   // keep focus inside the open menu
      if(e.shiftKey&&i<=0){e.preventDefault();f[f.length-1].focus();}else if(!e.shiftKey&&i===f.length-1){e.preventDefault();f[0].focus();}}});
  matchMedia('(min-width:861px)').addEventListener('change',m=>{if(m.matches&&mnav.classList.contains('open'))closeMenu(false);});

  /* ---- the 3D control hint fades on its own after a few seconds ---- */
  setTimeout(()=>{const h=$('#viewhint');h&&h.classList.add('gone');},7000);

  /* ---- progress dots + sticky CTA ---- */
  const navLinks=$$('#nav .primary a'),NAVS=[['menu',$('#fullmenu')],['reviews',$('#reviews')],['visit',$('#hours')]];let curNav='';
  const dots=$$('#steps a'),steps=$('#steps'),cta=$('#stickycta'),menu=$('#menu'),after=$('#after');
  function onScroll(){
    const vh=innerHeight,c=scrollY+0.5*vh;let P=5;
    for(let i=0;i<5;i++){const el=chapters[i],t=el.offsetTop,u=(c-t)/el.offsetHeight;if(u<1){P=i+Math.max(0,u);break;}}
    const A=Math.min(5,Math.floor(P));
    dots.forEach((d,i)=>{d.classList.toggle('on',i===A);d.style.setProperty('--p',i<A?1:i===A?(P-i):0);});
    const menuTop=menu.getBoundingClientRect().top;
    steps.classList.toggle('hide',menuTop<vh*0.6);
    // the fixed 3D layer is fully covered once the page below reaches the top: hide it (no stale controls, no GPU work under the footer)
    document.body.classList.toggle('past-story',after.getBoundingClientRect().top<=0);
    cta.classList.toggle('show',scrollY>vh*0.6&&menuTop>vh*0.85);
    // header: highlight the section in view
    let cur='story';for(const [k,el] of NAVS){if(el.getBoundingClientRect().top<vh*0.45)cur=k;}
    if(cur!==curNav){curNav=cur;navLinks.forEach(a=>{const on=a.dataset.nav===cur;a.classList.toggle('cur',on);on?a.setAttribute('aria-current','true'):a.removeAttribute('aria-current');});}
  }
  // passive listeners only schedule; the DOM work happens once per animation frame
  let queued=false;const schedule=()=>{if(!queued){queued=true;requestAnimationFrame(()=>{queued=false;onScroll();});}};
  addEventListener('scroll',schedule,{passive:true});addEventListener('resize',schedule);onScroll();

  /* ---- today's opening hours + "open now" in the header (local time of the visitor) ---- */
  const now=new Date(),d=now.getDay(),hr=now.getHours()+now.getMinutes()/60,wk=d>=1&&d<=5,o=wk?8:9,c=wk?21:22,on=$('#opennow');
  if(on){if(hr>=o&&hr<c){on.textContent='Open now · until '+(c-12)+' pm';on.classList.add('is-open');}
    else on.textContent=hr<o?'Closed · opens '+o+' am':'Closed · opens '+((d+1)%7>=1&&(d+1)%7<=5?8:9)+' am';}
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
