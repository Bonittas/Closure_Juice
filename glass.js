import * as THREE from 'three';
import { lin, createStrawberry } from './strawberry_bowl.js';

/* Milkshake glass (v14, after the reference photo): tall clear tapered cup with a thin rim and a clear base, shake to the rim,
   one piped whipped-cream swirl rising to a soft peak, glossy syrup drizzled over it and dripping down the outside of the cup,
   a whole strawberry beside the peak, a red-and-white straw angled to the right.
   Origin = centre of the glass bottom on the table (y up). */
export const GLASS={H:2.5,floor:0.24,rBot:0.5,rTop:0.72,wall:0.03};
const {H,floor:FL,rBot,rTop,wall}=GLASS;
export const gOut=h=>rBot+(rTop-rBot)*Math.max(0,Math.min(1,h/H));
export const gIn=h=>gOut(h)-wall;
const sstep=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const RNG_=s=>()=>((s=Math.imul(s^(s>>>15),2246822507)+0x6d2b79f5|0)>>>0)/4294967296;   // deterministic shapes (same glass every load)
const FULL=H-0.05,HTOP=0.98,RM=rTop+0.025;         // fill limit (to the rim); cream dome height above the rim; cream overhang radius

// volume <-> level table for the inside of the glass
const NT=80,cum=[0];for(let i=1;i<=NT;i++){const y=FL+(H-FL)*(i-0.5)/NT;cum.push(cum[i-1]+Math.PI*gIn(y)**2*(H-FL)/NT);}
const volFromLevel=L=>{const t=clamp((L-FL)/(H-FL),0,1)*NT,i=Math.min(NT-1,Math.floor(t));return cum[i]+(cum[i+1]-cum[i])*(t-i);};
const levelFromVol=v=>{if(v<=0)return FL;for(let i=0;i<NT;i++)if(v<=cum[i+1])return FL+(H-FL)*(i+(v-cum[i])/(cum[i+1]-cum[i]))/NT;return H;};
const VFULL=volFromLevel(FULL);

const creamOuter=y=>{if(y<=H)return gIn(y)-0.03;const t=Math.min(1,(y-H)/HTOP);return RM*Math.pow(1-Math.pow(t,1.7),0.62);};

function speckTexture(){
  const c=document.createElement('canvas');c.width=512;c.height=256;const x=c.getContext('2d');
  x.fillStyle='#fff';x.fillRect(0,0,512,256);
  for(let i=0;i<260;i++){x.fillStyle=`rgba(255,${200+Math.random()*40|0},${205+Math.random()*40|0},.35)`;x.beginPath();x.arc(Math.random()*512,Math.random()*256,3+Math.random()*9,0,6.283);x.fill();}
  for(let i=0;i<1100;i++){x.fillStyle=`rgba(${170+Math.random()*40|0},${60+Math.random()*50|0},${70+Math.random()*50|0},${0.35+Math.random()*0.4})`;
    x.beginPath();x.ellipse(Math.random()*512,Math.random()*256,0.8+Math.random()*1.6,0.7+Math.random()*1.2,Math.random()*3,0,6.283);x.fill();}
  const t=new THREE.CanvasTexture(c);t.wrapS=THREE.RepeatWrapping;if(THREE.SRGBColorSpace)t.colorSpace=THREE.SRGBColorSpace;else t.encoding=THREE.sRGBEncoding;t.anisotropy=8;return t;}
function strawTexture(){
  const c=document.createElement('canvas');c.width=64;c.height=256;const x=c.getContext('2d');
  x.fillStyle='#fbf6f0';x.fillRect(0,0,64,256);x.fillStyle='#d8262f';
  for(let i=-4;i<12;i++){x.beginPath();x.moveTo(0,i*32);x.lineTo(64,i*32-40);x.lineTo(64,i*32-40+16);x.lineTo(0,i*32+16);x.fill();}
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(1,5);
  if(THREE.SRGBColorSpace)t.colorSpace=THREE.SRGBColorSpace;else t.encoding=THREE.sRGBEncoding;return t;}

function glassBody(mat){
  const pts=[],add=(r,h)=>pts.push(new THREE.Vector2(r,h));
  add(0,0);add(gOut(0)-0.05,0);add(gOut(0)-0.01,0.015);
  const NO=30;for(let i=0;i<=NO;i++){const h=0.05+(H-0.05)*i/NO;add(gOut(h),h);}
  const nOuter=pts.length;add(gOut(H)-wall/2,H+0.012);
  const NI=26;for(let i=NI;i>=0;i--){const h=FL+(H-FL)*i/NI;add(gIn(h),h);}add(0,FL);
  const geo=new THREE.LatheGeometry(pts,96);geo.computeVertexNormals();   // smooth plastic cup (no flutes)
  return new THREE.Mesh(geo,mat);
}

export function createGlassStation(x=-3.4,z=0.9){
  const root=new THREE.Group();root.position.set(x,0,z);
  const glassMat=new THREE.MeshPhysicalMaterial({color:lin(0xf2f8fb),roughness:0.03,transparent:true,opacity:0.17,envMapIntensity:1.8,clearcoat:1,side:THREE.DoubleSide,depthWrite:false});
  const rimMat=glassMat.clone();rimMat.opacity=0.45;
  const body=glassBody(glassMat);body.renderOrder=5;root.add(body);
  const rim=new THREE.Mesh(new THREE.TorusGeometry(gOut(H)-wall/2,0.017,8,96),rimMat);rim.rotation.x=Math.PI/2;rim.position.y=H+0.008;rim.renderOrder=5;root.add(rim);
  const foot=new THREE.Mesh(new THREE.CylinderGeometry(rBot-0.025,rBot-0.05,FL-0.04,64),glassMat.clone());foot.material.opacity=0.14;foot.position.y=FL/2;foot.renderOrder=5;root.add(foot);

  // ---- the shake ----
  const tex=speckTexture();
  const shakeMat=new THREE.MeshPhysicalMaterial({map:tex,color:lin(0xf2a0b0),roughness:0.4,clearcoat:0.35,clearcoatRoughness:0.35,emissive:lin(0x3a1018),side:THREE.DoubleSide,envMapIntensity:0.8});
  const shake=new THREE.Mesh(new THREE.BufferGeometry(),shakeMat);shake.castShadow=true;shake.visible=false;root.add(shake);
  const deco=new THREE.Group();root.add(deco);

  let V=0,shown=FL,built=-1;
  function buildShake(L){
    if(Math.abs(L-built)<0.002)return;built=L;
    if(L<=FL+0.01){shake.visible=false;return;}
    const p=[new THREE.Vector2(0,FL+0.001),new THREE.Vector2(gIn(FL)-0.012,FL+0.001)],n=Math.max(2,Math.ceil((L-FL)/0.1));
    for(let i=1;i<=n;i++){const h=FL+(L-FL)*i/n;p.push(new THREE.Vector2(gIn(h)-0.012,h));}
    const r=gIn(L)-0.012;p.push(new THREE.Vector2(r*0.6,L+0.018),new THREE.Vector2(0,L+0.024));
    shake.geometry.dispose();shake.geometry=new THREE.LatheGeometry(p,72);shake.visible=true;
  }

  // ---- whipped cream (piped spiral) ----
  const creamMat=new THREE.MeshStandardMaterial({color:lin(0xfff3de),roughness:0.55,envMapIntensity:0.7,emissive:lin(0x2b211c),side:THREE.DoubleSide});
  const nozzleMat=new THREE.MeshStandardMaterial({color:lin(0xd0d3d6),metalness:1,roughness:0.25});
  let cream=null;
  function buildCream(y0){
    // one continuous piped rope: ~3.6 turns climbing a dome-shaped envelope, each turn resting on the one below (overlapping,
    // so it reads as a single swirl, not a stack of rings), the rope thinning as it climbs and ending in a soft curled peak.
    // CREAM_LIFT is tiny so the first turn sits on the juice (no visible air gap above the rim fill).
    const CREAM_LIFT=0.02,Hc=H+HTOP-y0,NL=4.3,SEG=64,M=Math.round(NL*SEG),RS=24;
    const tr=u=>0.22*(1-0.5*u)*(1-0.85*sstep(0.86,1,u))+0.012;                 // rope radius
    const env=u=>{const y=y0+CREAM_LIFT+(Hc-CREAM_LIFT)*u;return y<=H?RM-0.01:creamOuter(y);};   // outer envelope (overhangs the rim)
    const rc=u=>Math.max(0,env(u)-tr(u)*0.92);
    const pos=new Float32Array((M+1)*(RS+1)*3),col=new Float32Array((M+1)*(RS+1)*3),idx=[],ctr=new Float32Array((M+1)*4);
    for(let k=0;k<=M;k++){
      const u=k/M,ang=u*NL*Math.PI*2+0.6,r=rc(u),t=tr(u),ca=Math.cos(ang),sa=Math.sin(ang);
      const yy=y0+CREAM_LIFT+(Hc-0.08)*Math.pow(u,0.92)+0.1*sstep(0.9,1,u);
      ctr.set([r*ca,yy,r*sa,t],k*4);
      for(let j=0;j<=RS;j++){const a=j/RS*Math.PI*2,rr=t*(1+0.045*Math.cos(6*a+u*30)),o=(k*(RS+1)+j)*3;
        const out=Math.cos(a),up=Math.sin(a)*(Math.sin(a)>0?0.95:0.75);      // flatter underneath: it sits on the turn below
        pos[o]=r*ca+ca*rr*out;pos[o+1]=yy+rr*up;pos[o+2]=r*sa+sa*rr*out;
        const ao=1-0.55*Math.pow(Math.max(0,-Math.sin(a)),1.6)-0.12*Math.max(0,-Math.cos(a));col[o]=col[o+1]=col[o+2]=ao;}}   // soft crease under each turn: reads as one rope
    for(let k=0;k<M;k++)for(let j=0;j<RS;j++){const a=k*(RS+1)+j,b=(k+1)*(RS+1)+j;idx.push(a,b,a+1,b,b+1,a+1);}
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('color',new THREE.BufferAttribute(col,3));geo.setIndex(idx);geo.computeVertexNormals();
    const coil=new THREE.Mesh(geo,creamMat);coil.castShadow=true;coil.frustumCulled=false;
    // solid core so you never see through the spiral (just inside the rope's inner side)
    const cp=[new THREE.Vector2(0.02,0)];for(let i=0;i<=24;i++){const u=i/24;cp.push(new THREE.Vector2(Math.max(0.012,rc(u)),CREAM_LIFT+(Hc-0.08)*Math.pow(u,0.92)));}cp.push(new THREE.Vector2(0,Hc-0.02));
    const cg=new THREE.LatheGeometry(cp,40);cg.setAttribute('color',new THREE.BufferAttribute(new Float32Array(cg.attributes.position.count*3).fill(0.8),3));
    const core=new THREE.Mesh(cg,creamMat);core.position.y=y0;core.scale.y=0.001;
    const nozzle=new THREE.Mesh(new THREE.ConeGeometry(0.13,0.34,18,1,true),nozzleMat);nozzle.rotation.x=Math.PI;
    deco.add(coil,core,nozzle);
    cream={coil,core,nozzle,f:0,M,RS,ctr,y0,Hc,top:y0+Hc,NL,lift:CREAM_LIFT};
    coil.geometry.setDrawRange(0,0);
  }

  // ---- syrup ----
  const syrupMat=new THREE.MeshPhysicalMaterial({color:lin(0x8e0a1c),roughness:0.1,clearcoat:1,emissive:lin(0x2a0408),envMapIntensity:1.3});
  const drips=[];
  // the real outer surface of the piped cream (spiral coil + core) at height y and angle ph: a ray cast in from outside,
  // against the full cream geometry (independent of how much of it is drawn yet)
  const _rc=new THREE.Raycaster(),_ro=new THREE.Vector3(),_rd=new THREE.Vector3(),_rm=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
  let _rt=null;
  function creamSurfaceR(y,ph){
    if(!cream)return creamOuter(y);
    if(!_rt){const a=new THREE.Mesh(cream.coil.geometry,_rm),b=new THREE.Mesh(cream.core.geometry,_rm);b.position.y=cream.y0;b.updateMatrixWorld(true);a.updateMatrixWorld(true);_rt=[a,b];}
    const g=cream.coil.geometry,dr={...g.drawRange};g.setDrawRange(0,Infinity);
    const c=Math.cos(ph),s=Math.sin(ph);_ro.set(3*c,y,3*s);_rd.set(-c,0,-s);_rc.set(_ro,_rd);_rc.far=3;
    const hit=_rc.intersectObjects(_rt,false)[0];g.setDrawRange(dr.start,dr.count);
    return hit?3-hit.distance:0;}
  const DSEG=90,DRS=10;
  function buildDrip(yStart,yEnd,phi0,delay,rad,sway){
    // a drizzle line from near the peak down the swirl (zig-zagging a little), over the overhanging lip of the cream and, if
    // yEnd is below the rim, on down the OUTSIDE of the cup, ending in a round drop
    const sd=(phi0*3.71)%6,P=[],yLip=cream?cream.y0+(cream.lift||0.02):H+0.1,N1=34;
    const Y=[],PH=[],RS=[];
    for(let i=0;i<=N1;i++){const s=i/N1,y=yStart+(Math.max(yLip,yEnd)-yStart)*s,ph=phi0+sway*Math.sin(s*4.2+sd)*(0.4+0.6*s);Y.push(y);PH.push(ph);RS.push(creamSurfaceR(y,ph));}
    // on the cream: follow its surface, smoothed along the drip, and sit flush on it (sunk ~40% of its radius, never standing
    // off a local hollow of the swirl by more than 0.3 x its radius)
    for(let i=0;i<=N1;i++){let sum=0,n=0;for(let k=-2;k<=2;k++){const j=i+k;if(j>=0&&j<=N1&&RS[j]>0){sum+=RS[j];n++;}}
      const R=RS[i]>0?Math.min(sum/n+0.6*rad,RS[i]+0.7*rad):0.05;P.push(new THREE.Vector3(R*Math.cos(PH[i]),Y[i],R*Math.sin(PH[i])));}
    if(yEnd<yLip){const ph=PH[N1],c=Math.cos(ph),sn=Math.sin(ph);
      // hanging off the lip, then flush on the outside of the cup (sunk 30% of its radius into the wall it runs down)
      const L=P[N1],R0=Math.hypot(L.x,L.z);
      P.push(new THREE.Vector3(c*(R0-0.01),yLip-0.1,sn*(R0-0.01)));
      const N2=Math.max(3,Math.round((H-0.04-yEnd)/0.06));
      for(let i=0;i<=N2;i++){const y=H-0.04-(H-0.04-yEnd)*i/N2,R=gOut(y)+0.7*rad,p2=ph+0.015*Math.sin(i*0.9+sd);P.push(new THREE.Vector3(R*Math.cos(p2),y,R*Math.sin(p2)));}}
    const geo=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(P,false,'centripetal'),DSEG,rad,DRS,false);geo.setDrawRange(0,0);
    const m=new THREE.Mesh(geo,syrupMat);m.frustumCulled=false;m.castShadow=false;
    const E=P[P.length-1],bulb=new THREE.Mesh(new THREE.SphereGeometry(rad*1.45,12,10),syrupMat);bulb.position.copy(E);bulb.position.y-=rad*0.5;bulb.scale.set(1,1.35,1);bulb.visible=false;
    if(yEnd<yLip){const ph=Math.atan2(E.z,E.x),k=0.35*rad;bulb.position.x-=Math.cos(ph)*k;bulb.position.z-=Math.sin(ph)*k;}   // the drop hugs the wall
    deco.add(m,bulb);drips.push({m,bulb,geo,f:-delay,len:Math.abs(yStart-yEnd)});
  }

  function makeSyrup(){
    const top=cream?cream.y0+cream.Hc*0.9:levelFromVol(V),n=8,R_=RNG_(11);
    for(let i=0;i<n;i++){const ph=(i/n)*6.283+R_()*0.5,onCream=i%4===3,len=0.25+R_()*0.65;
      const yEnd=!cream?top-0.6:onCream?cream.y0+0.2:Math.max(FL+0.4,H-0.05-len);
      buildDrip(cream?Math.min(top,H+HTOP*0.82):top-0.02,yEnd,ph,i*0.12,0.04+R_()*0.018,0.03+R_()*0.05);}
  }

  // ---- topping, straw ----
  let topBerry=null,straw=null;
  // height of the cream's top surface at (x,z): a ray cast straight down onto the full swirl
  function creamTopY(x,z){if(!cream)return levelFromVol(V);creamSurfaceR(H+0.3,0);   // (builds the ray targets)
    const g=cream.coil.geometry,dr={...g.drawRange};g.setDrawRange(0,Infinity);_ro.set(x,H+HTOP+2,z);_rd.set(0,-1,0);_rc.set(_ro,_rd);_rc.far=4;
    const hit=_rc.intersectObjects(_rt,false)[0];g.setDrawRange(dr.start,dr.count);return hit?hit.point.y:H;}
  function makeBerry(){
    // a whole berry with its leaves up, resting in the swirl to the left of the peak, leaning out a little
    const holder=new THREE.Group(),b=createStrawberry({size:0.6,seed:5,detail:0.8});b.rotation.z=0.42;b.rotation.y=0.9;holder.add(b);
    const bx=-0.3,bz=0.14,top=cream?creamTopY(bx,bz):levelFromVol(V);
    holder.userData={yEnd:top-0.2,t:0};holder.position.set(bx,top-0.2+1.6,bz);deco.add(holder);return holder;}
  function makeStraw(){
    // red-and-white striped straw from inside the cup, angled up and to the right, through the cream
    const a=0.3,B=new THREE.Vector3(-0.08,0.45,-0.12),L=(H+HTOP+0.75-B.y)/Math.cos(a);
    const m=new THREE.Mesh(new THREE.CylinderGeometry(0.06,0.06,L,16,1,true),new THREE.MeshStandardMaterial({map:strawTexture(),roughness:0.42,side:THREE.DoubleSide}));
    m.castShadow=true;m.rotation.z=-a;const d=new THREE.Vector3(Math.sin(a),Math.cos(a),0);
    const fin=B.clone().addScaledVector(d,L/2);m.position.copy(fin).addScaledVector(d,1.8);
    m.userData={fin,d,t:0};deco.add(m);return m;}

  const api={
    root,center:new THREE.Vector3(x,0,z),
    surfaceY:()=>Math.max(FL,shown),
    hasCream:()=>!!cream,
    liquid:()=>V,
    canPour:()=>!cream&&V<VFULL-0.02,
    isFull:()=>V>=VFULL-0.005,
    add(dV,col){const nv=Math.min(VFULL,V+dV),k=(nv-V)/Math.max(nv,1e-6);if(V<=1e-6)shakeMat.color.copy(col);else shakeMat.color.lerp(col,k);V=nv;},
    addCream(){
      if(cream)return 'There is already cream on top';
      if(V<volFromLevel(FL+0.5))return 'Pour some smoothie into the glass first';
      buildCream(Math.max(FL+0.5,levelFromVol(V)-0.06));return null;},
    addSyrup(){
      if(V<volFromLevel(FL+0.5))return 'Pour some smoothie into the glass first';
      makeSyrup();return null;},
    addBerry(){
      if(topBerry)return 'Already has a strawberry on top';
      if(V<volFromLevel(FL+0.5))return 'Pour some smoothie into the glass first';
      topBerry=makeBerry();return null;},
    addStraw(){
      if(straw)return 'The straw is already in';
      if(V<volFromLevel(FL+0.5))return 'Pour some smoothie into the glass first';
      straw=makeStraw();return null;},
    /* --- direct setters for the scroll-driven version: f in 0..1, no time stepping, fully reversible --- */
    fullVolume:()=>VFULL,
    setVolume(v){V=v;shown=levelFromVol(V);buildShake(shown);},
    setColor(c){shakeMat.color.copy(c);},
    setCream(f){
      if(f>0&&!cream)buildCream(Math.max(FL+0.5,levelFromVol(V)-0.06));
      if(!cream)return;cream.f=f;const k=Math.floor(f*cream.M);
      cream.coil.visible=cream.core.visible=f>0;cream.coil.geometry.setDrawRange(0,k*cream.RS*6);cream.core.scale.y=Math.max(0.001,f);
      const o=k*4;cream.nozzle.position.set(cream.ctr[o],cream.ctr[o+1]+cream.ctr[o+3]+0.16,cream.ctr[o+2]);cream.nozzle.visible=f>0&&f<1;},
    setSyrup(f){
      if(f>0&&!drips.length&&cream)makeSyrup();
      const n=drips.length;
      drips.forEach((d,i)=>{const p=clamp(f*1.7-0.7*i/Math.max(1,n-1),0,1);d.m.visible=p>0;d.geo.setDrawRange(0,Math.floor(p*DSEG)*DRS*6);d.bulb.visible=p>=1;});},
    setBerry(t){
      if(t>0&&!topBerry)topBerry=makeBerry();
      if(!topBerry)return;const e=1-Math.pow(1-t,3),u=topBerry.userData;topBerry.visible=t>0;topBerry.position.y=u.yEnd+1.6*(1-e);},
    setStraw(t){
      if(t>0&&!straw)straw=makeStraw();
      if(!straw)return;const e=1-Math.pow(1-t,3),u=straw.userData;straw.visible=t>0;straw.position.copy(u.fin).addScaledVector(u.d,1.8*(1-e));},
    empty(){
      V=0;shown=FL;built=-1;shake.visible=false;
      for(const o of deco.children.slice()){deco.remove(o);o.traverse&&o.traverse(c=>{if(c.geometry)c.geometry.dispose();});}
      cream=null;topBerry=null;straw=null;drips.length=0;},
    update(dt){
      const target=levelFromVol(V);shown+=(target-shown)*Math.min(1,dt*8);if(Math.abs(target-shown)<0.0015)shown=target;buildShake(shown);
      if(cream&&cream.f<1){
        cream.f=Math.min(1,cream.f+dt/3.0);const k=Math.floor(cream.f*cream.M);
        cream.coil.geometry.setDrawRange(0,k*cream.RS*6);cream.core.scale.y=Math.max(0.001,cream.f);
        const o=k*4;cream.nozzle.position.set(cream.ctr[o],cream.ctr[o+1]+cream.ctr[o+3]+0.16,cream.ctr[o+2]);
        if(cream.f>=1){cream.nozzle.visible=false;cream.core.scale.y=1;}}
      for(const d of drips){if(d.f>=1)continue;d.f+=dt/(1.2+d.len*0.9);
        if(d.f>0){const f=Math.min(1,d.f);d.geo.setDrawRange(0,Math.floor(f*DSEG)*DRS*6);if(f>=1)d.bulb.visible=true;}}
      if(topBerry&&topBerry.userData.t<1){const u=topBerry.userData;u.t=Math.min(1,u.t+dt/0.7);const e=1-Math.pow(1-u.t,3);
        topBerry.position.y=(u.yEnd+1.6)+(u.yEnd-(u.yEnd+1.6))*e;}
      if(straw&&straw.userData.t<1){const u=straw.userData;u.t=Math.min(1,u.t+dt/0.9);const e=1-Math.pow(1-u.t,3);
        straw.position.copy(u.fin).addScaledVector(u.d,1.8*(1-e));}
    }
  };
  root.userData=api;
  return root;
}
