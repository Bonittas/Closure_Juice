import * as THREE from 'three';
import { lin } from './strawberry_bowl.js';

// World layout (y up, table top at y = 0, blender centred on the origin)
export const BLENDER={baseTop:1.5,jarBase:1.62,jarH:2.0,floor:0.13};
const rOut=h=>0.64+0.34*Math.pow(Math.max(0,Math.min(1,h/2)),1.2);
export const jarOuter=rOut;                 // outer jar radius at height h above the jar base
export const jarInner=h=>rOut(h)-0.05;      // hollow radius at height h above the jar base

function rrect(w,d,r){const s=new THREE.Shape(),x=-w/2,y=-d/2;
  s.moveTo(x+r,y);s.lineTo(x+w-r,y);s.quadraticCurveTo(x+w,y,x+w,y+r);s.lineTo(x+w,y+d-r);
  s.quadraticCurveTo(x+w,y+d,x+w-r,y+d);s.lineTo(x+r,y+d);s.quadraticCurveTo(x,y+d,x,y+d-r);
  s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);return s;}
function slab(w,d,h,r,bv,mat){
  const g=new THREE.ExtrudeGeometry(rrect(w-2*bv,d-2*bv,r),{depth:h-2*bv,bevelEnabled:true,bevelThickness:bv,bevelSize:bv,bevelSegments:4,curveSegments:10});
  g.rotateX(-Math.PI/2);g.translate(0,bv,0);
  const m=new THREE.Mesh(g,mat);m.castShadow=m.receiveShadow=true;return m;}

export function createBlender(){
  const g=new THREE.Group();
  const metal=new THREE.MeshStandardMaterial({color:lin(0x9a9da0),metalness:0.9,roughness:0.32});
  const black=new THREE.MeshPhysicalMaterial({color:lin(0x131313),roughness:0.35,clearcoat:0.6,clearcoatRoughness:0.3});
  const steel=new THREE.MeshStandardMaterial({color:lin(0xd0d3d6),metalness:1,roughness:0.22});
  const glass=new THREE.MeshPhysicalMaterial({color:lin(0xcfe6f2),roughness:0.04,transparent:true,opacity:0.2,envMapIntensity:1.6,clearcoat:1,side:THREE.DoubleSide,depthWrite:false});
  const rimMat=glass.clone();rimMat.opacity=0.5;

  // ---- base, control panel ----
  g.add(slab(2.0,1.7,0.3,0.25,0.05,black));
  const body=slab(2.2,1.9,1.2,0.3,0.08,metal);body.position.y=0.3;g.add(body);
  const panel=new THREE.Mesh(new THREE.BoxGeometry(1.7,0.62,0.05),black);panel.position.set(0,0.88,0.96);g.add(panel);
  const lcdMat=new THREE.MeshStandardMaterial({color:lin(0x0b1a1f),emissive:lin(0x0e3c44),emissiveIntensity:0.4,roughness:0.3});
  const lcd=new THREE.Mesh(new THREE.BoxGeometry(0.4,0.15,0.02),lcdMat);lcd.position.set(-0.2,1.03,0.995);g.add(lcd);
  for(const sx of[-0.68,0.72]){const sw=new THREE.Mesh(new THREE.BoxGeometry(0.2,0.24,0.14),black);sw.position.set(sx,0.82,1.02);sw.rotation.x=-0.25;g.add(sw);}
  const dial=new THREE.Group();dial.position.set(0.02,0.84,0.99);
  const ring=new THREE.Mesh(new THREE.CylinderGeometry(0.25,0.25,0.04,40),steel);ring.rotation.x=Math.PI/2;dial.add(ring);
  const knob=new THREE.Mesh(new THREE.CylinderGeometry(0.17,0.17,0.12,40),black);knob.rotation.x=Math.PI/2;knob.position.z=0.05;dial.add(knob);
  const tick=new THREE.Mesh(new THREE.BoxGeometry(0.03,0.11,0.02),steel);tick.position.set(0,0.09,0.115);dial.add(tick);g.add(dial);
  const collar=new THREE.Mesh(new THREE.CylinderGeometry(0.92,0.98,0.12,48),black);collar.position.y=1.56;collar.castShadow=true;g.add(collar);

  // ---- jar (everything inside is in jar-local coordinates, y = 0 at jar base) ----
  const jar=new THREE.Group();jar.position.y=BLENDER.jarBase;g.add(jar);
  const pts=[new THREE.Vector2(0,0),new THREE.Vector2(rOut(0)-0.04,0),new THREE.Vector2(rOut(0),0.04)];
  for(let i=1;i<=24;i++){const h=i/24*2;pts.push(new THREE.Vector2(rOut(h),h));}
  pts.push(new THREE.Vector2(rOut(2)-0.025,2.012));
  for(let i=24;i>=0;i--){const h=0.13+(2-0.13)*i/24;pts.push(new THREE.Vector2(jarInner(h),h));}
  pts.push(new THREE.Vector2(0,0.13));
  jar.add(new THREE.Mesh(new THREE.LatheGeometry(pts,72),glass));
  const rim=new THREE.Mesh(new THREE.TorusGeometry(rOut(2)-0.025,0.03,10,72),rimMat);rim.rotation.x=Math.PI/2;rim.position.y=2.01;jar.add(rim);
  for(let k=0;k<4;k++){const a=Math.PI/4+k*Math.PI/2,P=[];
    for(let i=0;i<=8;i++){const h=0.3+1.5*i/8,r=jarInner(h)-0.01;P.push(new THREE.Vector3(Math.cos(a)*r,h,Math.sin(a)*r));}
    jar.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(P),24,0.055,8),rimMat));}
  // handle
  const rt=rOut(1.8);
  const hc=new THREE.CatmullRomCurve3([[rt-0.06,1.82],[rt+0.32,1.95],[rt+0.72,1.72],[rt+0.82,1.2],[rt+0.55,0.95],[rOut(0.9)-0.04,0.9]].map(([x,y])=>new THREE.Vector3(x,y,0)));
  const handle=new THREE.Mesh(new THREE.TubeGeometry(hc,48,0.085,12),black);handle.scale.z=1.5;handle.castShadow=true;jar.add(handle);
  // blades
  const blades=new THREE.Group();blades.position.y=0.2;
  blades.add(new THREE.Mesh(new THREE.CylinderGeometry(0.09,0.12,0.16,16),steel));
  for(let i=0;i<4;i++){const arm=new THREE.Object3D();arm.rotation.y=i*Math.PI/2;
    const bl=new THREE.Mesh(new THREE.BoxGeometry(0.46,0.014,0.13),steel);
    bl.position.set(0.3,i%2?-0.04:0.06,0);bl.rotation.z=i%2?-0.45:0.45;arm.add(bl);blades.add(arm);}
  jar.add(blades);
  // lid
  const lid=new THREE.Group(),rl=rOut(2);
  const parts=[[new THREE.CylinderGeometry(rl+0.03,rl+0.03,0.1,64),black,0.05],[new THREE.CylinderGeometry(rl-0.07,rl-0.07,0.12,64),black,-0.04],
    [new THREE.CylinderGeometry(0.5,0.62,0.08,48),black,0.14],[new THREE.CylinderGeometry(0.27,0.27,0.08,32),glass,0.21]];
  for(const[geo,mat,y]of parts){const m=new THREE.Mesh(geo,mat);m.position.y=y;m.castShadow=mat!==glass;lid.add(m);}
  g.add(lid);
  // ---- smoothie: one clipped lathe + a cap, both levelled by a WORLD-space plane so the surface stays flat when the jar tilts ----
  const FR=lin(0xe83a55),MI=lin(0xfff0e8);
  const clipPlane=new THREE.Plane(new THREE.Vector3(0,-1,0),0);
  const liquidMat=new THREE.MeshPhysicalMaterial({color:FR.clone(),roughness:0.14,clearcoat:1,transparent:true,opacity:0.96,envMapIntensity:1.2,side:THREE.DoubleSide,clippingPlanes:[clipPlane]});
  const lp=[new THREE.Vector2(0,0.14)];
  for(let i=0;i<=30;i++){const h=0.14+(2-0.14)*i/30;lp.push(new THREE.Vector2(jarInner(h)-0.012,h));}
  lp.push(new THREE.Vector2(0,2.0));
  const liquid=new THREE.Mesh(new THREE.LatheGeometry(lp,48),liquidMat);liquid.visible=false;jar.add(liquid);
  const NC=48,capPos=new Float32Array((NC+1)*3),capNor=new Float32Array((NC+1)*3),capIdx=[];
  for(let i=0;i<=NC;i++)capNor[i*3+1]=1;
  for(let i=0;i<NC;i++)capIdx.push(0,1+(i+1)%NC,1+i);   // counter-clockwise from above, so the up normal is the lit side
  const capGeo=new THREE.BufferGeometry();capGeo.setAttribute('position',new THREE.BufferAttribute(capPos,3));
  capGeo.setAttribute('normal',new THREE.BufferAttribute(capNor,3));capGeo.setIndex(capIdx);
  const cap=new THREE.Mesh(capGeo,liquidMat);cap.frustumCulled=false;cap.visible=false;g.add(cap);

  // volume model: soft-counted sample points inside the jar (only x and h matter for a tilt about z)
  const NH=56,NP=20,NR=5,H0=0.14,H1=2.0,SX=[],SH=[],SW=[],dh=(H1-H0)/NH;
  for(let i=0;i<NH;i++){const h=H0+(i+0.5)*dh,rin=jarInner(h);
    for(let p=0;p<NP;p++){const ph=(p+0.5)/NP*Math.PI*2,cp=Math.cos(ph);
      for(let k=0;k<NR;k++){const r=(k+0.5)/NR*rin;SX.push(r*cp);SH.push(h);SW.push(r*(rin/NR)*(Math.PI*2/NP)*dh);}}}
  const NS=SX.length;
  function volBelow(Y,th,py){const s=Math.sin(th),c=Math.cos(th),inv=1/0.03;let v=0;
    for(let i=0;i<NS;i++){const t=(Y-(py+SX[i]*s+SH[i]*c))*inv+0.5;if(t>=1)v+=SW[i];else if(t>0)v+=SW[i]*t;}return v;}
  function solveY(Vt,th,py){let lo=py-2.6,hi=py+2.6;for(let i=0;i<18;i++){const m=(lo+hi)/2;if(volBelow(m,th,py)<Vt)lo=m;else hi=m;}return (lo+hi)/2;}
  const home=new THREE.Vector3(0,BLENDER.jarBase,0),lipLocal=new THREE.Vector2(-(rOut(2)-0.02),2.0);
  let V=0,level=0,Vlev=0,surfY=BLENDER.jarBase+H0,mixT=0,mixShown=0;
  const mixCol=new THREE.Color();
  function applyMix(){const t=Math.pow(Math.min(1,Math.max(0,mixShown)),0.6)*0.97;mixCol.copy(FR).lerp(MI,t);liquidMat.color.copy(mixCol);}
  function refreshLiquid(){
    const th=jar.rotation.z,px=jar.position.x,py=jar.position.y,pz=jar.position.z;
    if(V<0.03){liquid.visible=cap.visible=false;surfY=py+H0;return;}
    let Y;
    if(Math.abs(th)<1e-3){if(Vlev!==V){level=solveY(V,0,0);Vlev=V;}Y=py+level;}else Y=solveY(V,th,py);
    surfY=Y;clipPlane.constant=Y+0.003;liquid.visible=cap.visible=true;
    const s=Math.sin(th),c=Math.cos(th);let cx=0,cz=0;const pts=[];
    for(let k=0;k<NC;k++){
      const ph=k/NC*Math.PI*2,cp=Math.cos(ph),sp=Math.sin(ph),gf=h=>py+jarInner(h)*cp*s+h*c-Y;
      let hl=H1,r=jarInner(H1)-0.012,ga=gf(H0),hA=H0,root=null;
      for(let i=1;i<=40;i++){const h=H0+(H1-H0)*i/40,gb=gf(h);if((ga<=0&&gb>0)||(ga>=0&&gb<0)){root=hA+(h-hA)*ga/(ga-gb);break;}ga=gb;hA=h;}
      if(root!==null){hl=root;r=jarInner(hl)-0.012;}
      else if(gf(H0)>0){const den=cp*s,num=Y-py-H0*c;hl=H0;r=Math.abs(den)<1e-4?0:Math.min(jarInner(H0)-0.012,Math.max(0,num/den));}
      const X=px+r*cp*c-hl*s,Z=pz+r*sp;pts.push(X,Z);cx+=X;cz+=Z;}
    cx/=NC;cz/=NC;capPos[0]=cx;capPos[1]=Y;capPos[2]=cz;
    for(let k=0;k<NC;k++){capPos[3+k*3]=pts[k*2];capPos[4+k*3]=Y;capPos[5+k*3]=pts[k*2+1];}
    capGeo.attributes.position.needsUpdate=true;capGeo.computeBoundingSphere();
  }

  // ---- animation state ----
  const closedPos=new THREE.Vector3(0,BLENDER.jarBase+2.0,0),openPos=new THREE.Vector3(-2.4,0.1,-2.0);
  let lidAmt=1,lidTarget=1,spin=0,spinTarget=0;
  lid.position.copy(openPos);
  function placeLid(){const e=lidAmt*lidAmt*(3-2*lidAmt);lid.position.lerpVectors(closedPos,openPos,e);lid.position.y+=Math.sin(Math.PI*e)*1.0;}
  Object.assign(g.userData,{
    jar,home,lipLocal,
    /* --- direct setters used by the scroll-driven version (no time stepping, fully reversible) --- */
    setLidAmount(a){lidAmt=lidTarget=a;placeLid();},                       // 0 = on the jar, 1 = lifted off
    setBladeAngle(a,dialAmt=0){blades.rotation.y=a;dial.rotation.z=-dialAmt*2.2;lcdMat.emissiveIntensity=0.4+0.9*dialAmt;},
    setMixNow(m){mixT=mixShown=m;},
    setVolume(v){V=v;Vlev=-1;},
    volForLevel:L=>volBelow(L,0,0),
    capAt(th){return volBelow(-jarInner(2)*Math.sin(th)+2*Math.cos(th),th,0);},   // most the jar can hold when tilted by th (translation-invariant)
    refresh(){applyMix();refreshLiquid();},
    setLidOpen(o){lidTarget=o?1:0;},
    wantsOpen:()=>lidTarget===1,
    isOpen:()=>lidTarget===1&&lidAmt>0.85,
    lidAmt:()=>lidAmt,
    setSpin(v){spinTarget=v;},
    setLiquid(L){level=L;V=volBelow(L,0,0);Vlev=V;},
    volume:()=>V,
    getLevel:()=>V<0.03?0:solveY(V,0,0),
    surfaceY:()=>surfY,
    setMix(m){mixT=m;},
    color:()=>liquidMat.color,
    drain(){const th=jar.rotation.z;if(th<0.2||V<0.02)return 0;const py=jar.position.y;
      const Yl=py-jarInner(2)*Math.sin(th)+2*Math.cos(th),capV=volBelow(Yl,th,py);
      if(V>capV){const d=V-capV;V=capV;return d;}return 0;},
    resetPose(){jar.position.copy(home);jar.rotation.z=0;},
    update(dt){
      lidAmt+=Math.sign(lidTarget-lidAmt)*Math.min(Math.abs(lidTarget-lidAmt),dt*1.3);
      placeLid();
      spin+=(spinTarget-spin)*Math.min(1,dt*3);blades.rotation.y+=spin*dt;
      dial.rotation.z=-Math.min(1,spin/40)*2.2;lcdMat.emissiveIntensity=0.4+(spin>1?0.9:0);
      mixShown+=(mixT-mixShown)*Math.min(1,dt*0.9);applyMix();refreshLiquid();}
  });
  return g;
}
