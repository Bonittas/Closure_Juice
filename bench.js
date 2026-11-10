/* Maleda benchmark (loaded only with ?bench, see index.html).
   Records load timings, then auto-scrolls the whole page stop by stop (smooth scroll in, ~3 s hold),
   measures frame times per segment and POSTs one JSON document to /bench (bench_server.py). */
(function(){
  'use strict';
  const T0=performance.now(),Q=new URLSearchParams(location.search);
  const HOLD=parseFloat(Q.get('hold')||'3')*1000;          // hold per stop (ms)
  const SPEED=parseFloat(Q.get('speed')||'1');             // viewport heights per second while scrolling
  const errors=[],longTasks=[];let fontsReadyAt=null;
  addEventListener('error',e=>errors.push({t:+performance.now().toFixed(1),msg:String(e.message||e.type),src:(e.filename||'')+':'+(e.lineno||'')}));
  addEventListener('unhandledrejection',e=>errors.push({t:+performance.now().toFixed(1),msg:'unhandledrejection: '+String(e.reason&&e.reason.message||e.reason)}));
  try{new PerformanceObserver(l=>{for(const e of l.getEntries())longTasks.push({start:+e.startTime.toFixed(1),dur:+e.duration.toFixed(1)});}).observe({type:'longtask',buffered:true});}catch(e){}
  if(document.fonts)document.fonts.ready.then(()=>{fontsReadyAt=performance.now();});

  const r1=x=>x==null?null:+(+x).toFixed(1),r2=x=>x==null?null:+(+x).toFixed(2);
  const ui=document.createElement('div');
  ui.style.cssText='position:fixed;left:8px;top:8px;z-index:9999;font:12px/1.3 monospace;background:rgba(0,0,0,.72);color:#fff;padding:6px 9px;border-radius:6px;pointer-events:none';
  const say=t=>{ui.textContent='BENCH · '+t;if(!ui.isConnected&&document.body)document.body.appendChild(ui);};
  say('loading…');

  /* ---- frame recorder: every rAF interval is one sample of the current segment ---- */
  let seg=null,lastTs=0;const segs=[];
  const longFrames=[];
  // every frame >100 ms is logged with where the story was and what the renderer had built by then (to localise GPU/driver stalls)
  function rafLoop(ts){if(lastTs){const dt=ts-lastTs;if(seg)seg.dt.push(dt);
      if(dt>100&&longFrames.length<40){const R=window.__r,B=window.__benchT||{};
        longFrames.push({t:r1(ts),dt:r1(dt),seg:seg?seg.kind+':'+seg.name:null,P:r2(Pnow()),programs:R?R.info.programs.length:null,
          geometries:R?R.info.memory.geometries:null,textures:R?R.info.memory.textures:null,warmDone:!!B.warmDone,lateReady:!!B.lateReady});}}
    lastTs=ts;requestAnimationFrame(rafLoop);}
  requestAnimationFrame(rafLoop);
  const perf=()=>window.__perf||{n:0,ms:0,calls:0,tris:0};
  const Pnow=()=>{try{return window.__maleda.state().P;}catch(e){return null;}};
  function begin(name,kind){const p=perf();seg={name,kind,dt:[],p0:{...p},P0:Pnow(),lt0:longTasks.length,t0:performance.now()};}
  function end(){if(!seg)return;const p=perf(),d=seg.dt.slice().sort((a,b)=>a-b),n=d.length,sum=d.reduce((a,b)=>a+b,0);
    const q=f=>n?d[Math.min(n-1,Math.floor(f*n))]:null,renders=p.n-seg.p0.n,lt=longTasks.slice(seg.lt0);
    segs.push({name:seg.name,kind:seg.kind,durMs:r1(performance.now()-seg.t0),frames:n,
      avgMs:n?r2(sum/n):null,p50Ms:r2(q(0.5)),p95Ms:r2(q(0.95)),p99Ms:r2(q(0.99)),maxMs:r2(n?d[n-1]:null),
      over33:d.filter(x=>x>33.4).length,over50:d.filter(x=>x>50).length,over100:d.filter(x=>x>100).length,fps:n?r1(1000*n/sum):null,
      renders,renderCpuAvgMs:renders?r2((p.ms-seg.p0.ms)/renders):null,
      drawCallsAvg:renders?r1((p.calls-seg.p0.calls)/renders):null,trianglesAvg:renders?Math.round((p.tris-seg.p0.tris)/renders):null,
      P:[r2(seg.P0),r2(Pnow())],longTasks:lt.length,longTaskMaxMs:lt.length?Math.max(...lt.map(x=>x.dur)):0});
    seg=null;}

  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const nextFrame=()=>new Promise(r=>requestAnimationFrame(r));
  async function scrollToY(y){const y0=scrollY,dist=Math.abs(y-y0),dur=Math.max(1200,Math.min(7000,1000*dist/(innerHeight*SPEED)));
    const t0=performance.now();for(;;){await nextFrame();const u=Math.min(1,(performance.now()-t0)/dur),e=0.5-0.5*Math.cos(Math.PI*u);
      scrollTo({top:y0+(y-y0)*e,behavior:'instant'});if(u>=1)break;}}
  function stops(){const vh=innerHeight,maxY=document.documentElement.scrollHeight-vh,out=[];
    document.querySelectorAll('[data-i]').forEach(el=>{const top=el.getBoundingClientRect().top+scrollY;
      const y=el.matches('.chap')?(el.dataset.i==='0'?0:top+0.42*el.offsetHeight-0.5*vh):top;out.push([el.id||('chap'+el.dataset.i),y]);});
    const after=document.getElementById('after');
    if(after)[...after.children].forEach(el=>{if(el.id)out.push([el.id,el.getBoundingClientRect().top+scrollY-(el.tagName==='FOOTER'?0:70)]);});
    return out.map(([n,y])=>[n,Math.round(Math.max(0,Math.min(maxY,y)))]);}

  function gpuInfo(){const c=document.getElementById('c');let gl=null;try{gl=c&&(c.getContext('webgl2')||c.getContext('webgl'));}catch(e){}
    if(!gl)return {available:false};const ext=gl.getExtension('WEBGL_debug_renderer_info');
    return {available:true,webgl2:typeof WebGL2RenderingContext!=='undefined'&&gl instanceof WebGL2RenderingContext,
      vendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR),renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),
      version:gl.getParameter(gl.VERSION),maxTextureSize:gl.getParameter(gl.MAX_TEXTURE_SIZE),samples:gl.getParameter(gl.SAMPLES),
      antialias:!!(gl.getContextAttributes()||{}).antialias};}

  function loadInfo(readyAt,loaderGoneAt){const nav=performance.getEntriesByType('navigation')[0]||{},B=window.__benchT||{};
    const res=performance.getEntriesByType('resource'),pick=re=>res.filter(e=>re.test(e.name)).map(e=>({name:e.name.split('/').slice(-3).join('/'),start:r1(e.startTime),end:r1(e.responseEnd),dur:r1(e.duration),transferKB:r1((e.transferSize||0)/1024)}));
    const three=pick(/three(\.module)?(\.min)?\.js/)[0]||null,fonts=pick(/fonts\.(googleapis|gstatic)\.com/),local=pick(/localhost|127\.0\.0\.1|\[::1\]/);
    const d=(a,b)=>B[a]!=null&&B[b]!=null?r1(B[b]-B[a]):null;
    return {navigation:{type:nav.type,ttfbMs:r1(nav.responseStart),responseEndMs:r1(nav.responseEnd),domInteractiveMs:r1(nav.domInteractive),
        domContentLoadedMs:r1(nav.domContentLoadedEventEnd),loadEventMs:r1(nav.loadEventEnd),transferKB:r1((nav.transferSize||0)/1024)},
      threeJs:three,threeLoadedMs:three?three.end:null,
      fontsReadyMs:r1(fontsReadyAt),fontFiles:fonts,fontsLoaded:document.fonts?[...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family+' '+f.weight+' '+f.style):[],
      localFiles:local,
      mainModuleStartMs:r1(B.mainStart),
      sceneBuildMs:d('rendererStart','physicsStart'),physicsPrecomputeMs:d('physicsStart','physicsEnd'),
      shaderCompileMs:d('compileStart','compileEnd'),shaderWarmupMs:d('compileEnd','warmupEnd'),
      firstRender3dMs:r1(B.firstRender),readyEventMs:r1(readyAt),loaderHiddenMs:r1(loaderGoneAt),
      marks:Object.fromEntries(Object.entries(B).map(([k,v])=>[k,typeof v==='number'?r2(v):v]))};}

  async function run(){
    say('waiting for the 3D…');
    const tWait=performance.now();
    while(!window.__maledaReady){if(performance.now()-tWait>120000)break;await wait(50);}
    const readyAt=window.__maledaReady?((window.__benchT||{}).firstRender||performance.now()):null;
    let loaderGoneAt=null;for(let k=0;k<60;k++){const l=document.getElementById('loader');if(!l||l.classList.contains('done')){loaderGoneAt=performance.now();break;}await wait(50);}
    await wait(1200);                                        // loader fade
    scrollTo({top:0,behavior:'instant'});await wait(300);
    const S=stops();
    for(let k=0;k<S.length;k++){const [name,y]=S[k];
      if(k>0){say('scroll → '+name+' ('+(k+1)+'/'+S.length+')');begin(name,'scroll');await scrollToY(y);end();}
      say('hold '+name+' ('+(k+1)+'/'+S.length+')');begin(name,'hold');await wait(k===0?HOLD+1000:HOLD);end();}
    // scroll back to the top in one go (worst case: rewinding the whole story)
    say('rewind to top');begin('rewind','scroll');await scrollToY(0);end();begin('fresh-again','hold');await wait(1500);end();

    const all=segs.filter(s=>s.frames),tot=all.reduce((a,s)=>a+s.frames,0),wavg=k=>tot?r2(all.reduce((a,s)=>a+s[k]*s.frames,0)/tot):null;
    const c=document.getElementById('c'),M=window.__maleda||{};
    const data={bench:'maleda-v3',createdAt:new Date().toISOString(),url:location.href,
      env:{userAgent:navigator.userAgent,platform:navigator.platform,hardwareConcurrency:navigator.hardwareConcurrency,deviceMemoryGB:navigator.deviceMemory||null,
        devicePixelRatio:devicePixelRatio,screen:{w:screen.width,h:screen.height,availW:screen.availWidth,availH:screen.availHeight},
        window:{innerW:innerWidth,innerH:innerHeight,outerW:outerWidth,outerH:outerHeight},
        jsHeapMB:performance.memory?r1(performance.memory.usedJSHeapSize/1048576):null},
      canvas:c?{cssW:c.clientWidth,cssH:c.clientHeight,bufferW:c.width,bufferH:c.height,rendererPixelRatio:(window.__benchT||{}).pixelRatio||null}:null,
      gpu:gpuInfo(),
      load:loadInfo(readyAt,loaderGoneAt),
      sims:{baked:!!(window.__benchT||{}).baked,parallelCompile:!!(window.__benchT||{}).parallelCompile,programs:window.__r?window.__r.info.programs.length:null,dropMs:M.drop&&M.drop.ms,tipMs:M.tip&&M.tip.ms,jarMs:M.jar&&M.jar.ms,simTotalMs:M.tip&&M.tip.simMs,berries:M.berries,landers:M.landers},
      settings:{holdMs:HOLD,scrollSpeedVhPerS:SPEED},
      sections:segs,
      overall:{frames:tot,avgMs:wavg('avgMs'),fps:tot?r1(1000*tot/all.reduce((a,s)=>a+s.avgMs*s.frames,0)):null,
        worstP95Ms:all.length?Math.max(...all.map(s=>s.p95Ms)):null,maxMs:all.length?Math.max(...all.map(s=>s.maxMs)):null,
        over33:all.reduce((a,s)=>a+s.over33,0),over50:all.reduce((a,s)=>a+s.over50,0),over100:all.reduce((a,s)=>a+s.over100,0),
        slowestSections:[...all].sort((a,b)=>b.p95Ms-a.p95Ms).slice(0,5).map(s=>s.kind+':'+s.name+' p95 '+s.p95Ms+' ms')},
      longTasks:{count:longTasks.length,totalMs:r1(longTasks.reduce((a,x)=>a+x.dur,0)),maxMs:longTasks.length?Math.max(...longTasks.map(x=>x.dur)):0,
        top:[...longTasks].sort((a,b)=>b.dur-a.dur).slice(0,15)},
      longFrames,
      // per rendered frame >50 ms: CPU time of the render call and gl.finish() time after it (GPU / driver), what was visible
      slowFrames:(window.__benchLog||{}).frames||[],
      // every first draw of a material (gl.finish around that one draw): the slowest ones point at the program the driver stalled on
      firstDrawsSlowest:(((window.__benchLog||{}).firstDraws)||[]).slice().sort((a,b)=>b.ms-a.ms).slice(0,30),
      firstDrawsTotalMs:r1((((window.__benchLog||{}).firstDraws)||[]).reduce((a,d)=>a+d.ms,0)),
      firstDrawsCount:(((window.__benchLog||{}).firstDraws)||[]).length,
      errors,benchDurationMs:r1(performance.now()-T0)};
    window.__benchResult=data;
    say('posting results…');
    try{const r=await fetch('/bench',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
      window.__benchPosted=r.ok;say(r.ok?'DONE ✓ results saved, you can close this window':'POST failed: HTTP '+r.status);}
    catch(e){window.__benchPosted=false;say('POST failed ('+e.message+'); JSON is in the console');console.log(JSON.stringify(data));}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run);else run();
})();
