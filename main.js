import * as THREE from 'three';
import { createBowl, createStrawberry, lin } from './strawberry_bowl.js';
import { createBlender, BLENDER, jarInner } from './blender.js';
import { createGlassStation, GLASS, gIn } from './glass.js';
import { Stream, carryPose, rad } from './pour.js';
import { createCondensation } from './looks.js';

/* =====================================================================================
   Berrylane v2: one continuous vertical world, the camera travels down through it.
     y = +22  the bowl                (section 1; it tips as soon as you scroll)
     falling  berries only            (section 2; the camera falls with them)
     y =  0   the blender             (section 3; berries + milk land in the jar, then it blends)
     falling  the shake stream only   (section 4; the jar tips off-frame, the camera follows the stream down)
     y = -22  the glass               (section 5; the stream fills it, then cream, syrup, berry, straw)
   P = story position (section index + progress within it). Everything is a pure function of P,
   so scrolling up rewinds exactly. Only the intro rain, blade spin and droplet shimmer use the clock.
   Objects leave the frame by the camera moving away from them, so there are no fades or cuts.
   ===================================================================================== */

const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x)),sm=t=>{t=clamp(t);return t*t*(3-2*t);},lerp=(a,b,t)=>a+(b-a)*t;
const narrow=()=>innerWidth<=860;
const lowPower=matchMedia('(pointer:coarse)').matches||narrow();
const RNG=(s)=>()=>(s=(s*16807)%2147483647)/2147483647;const R=RNG(11);

/* ---------- renderer ---------- */
const cv=document.getElementById('c');
const renderer=new THREE.WebGLRenderer({canvas:cv,antialias:true,alpha:true,powerPreference:'high-performance'});
renderer.setClearColor(0x000000,0);
renderer.setPixelRatio(Math.min(devicePixelRatio,lowPower?1.5:2));
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
if('outputColorSpace' in renderer)renderer.outputColorSpace=THREE.SRGBColorSpace;else renderer.outputEncoding=THREE.sRGBEncoding;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.localClippingEnabled=true;                        // the blender's liquid uses a clipping plane (blender stays at the origin)
const scene=new THREE.Scene();
const cam=new THREE.PerspectiveCamera(32,1,0.1,120);

function brightEnv(){
  const s=new THREE.Scene();
  s.add(new THREE.Mesh(new THREE.SphereGeometry(20,32,16),new THREE.MeshBasicMaterial({color:0x8a7470,side:THREE.BackSide})));
  const box=(w,h,pos,k,col=0xffffff)=>{const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({color:new THREE.Color(col).multiplyScalar(k),side:THREE.DoubleSide}));m.position.set(...pos);m.lookAt(0,0,0);s.add(m);};
  box(10,4,[0,10,2],6);box(3,8,[-9,3,4],5);box(2,6,[9,2,-4],4,0xffd9c0);box(8,2,[0,-3,-10],2,0xffb0a0);box(6,3,[0,2,12],2.5);
  const pm=new THREE.PMREMGenerator(renderer),t=pm.fromScene(s,0.04).texture;pm.dispose();return t;
}
const envTex=brightEnv();scene.environment=envTex;
const hemi=new THREE.HemisphereLight(0xfff4ee,0x8a6a60,0.6);scene.add(hemi);
const key=new THREE.DirectionalLight(0xfff1e4,1.7);key.castShadow=true;scene.add(key,key.target);   // key light + shadow box travel with the camera
key.shadow.mapSize.set(lowPower?1024:2048,lowPower?1024:2048);Object.assign(key.shadow.camera,{left:-6,right:6,top:8,bottom:-6,near:1,far:30});
key.shadow.bias=-0.0004;key.shadow.radius=4;
const KEY_OFF=new THREE.Vector3(2.5,12,4.5);
const fill=new THREE.DirectionalLight(0xffe0e6,0.5);fill.position.set(-7,3,5);scene.add(fill);
const rimL=new THREE.DirectionalLight(0xffffff,0.7);rimL.position.set(-2,5,-8);scene.add(rimL);
const shadowPlane=y=>{const m=new THREE.Mesh(new THREE.PlaneGeometry(40,40),new THREE.ShadowMaterial({opacity:0.16,depthWrite:false}));
  m.rotation.x=-Math.PI/2;m.position.y=y;m.receiveShadow=true;scene.add(m);return m;};


/* ---------- world layout ---------- */
const Y_B=22;                                              // bowl table height
const LIPT=new THREE.Vector3(-5.4,6.2,0);                  // where the jar's pouring lip is held during the pour
const STREAM_ARC=0.2,GX=LIPT.x+0.04-STREAM_ARC,GY=-22;     // glass sits under the falling part of the stream (it arcs out of the lip first)                                    // glass position (straight under the lip)
const JB=BLENDER.jarBase,JAR_TOP=JB+BLENDER.jarH,LMAX=1.09,MIX=0.04;
const SHAKE_HEX=0xb4304c,STREAM_COL=lin(0xc63652),MILK_COL=lin(0xfbf7f1),MID_PINK=lin(0xee8fa3),SHAKE_COL_L=lin(SHAKE_HEX);   // deep strawberry milkshake pink

/* ---------- material helpers: creamy milkshake + whipped cream ---------- */
const NOISE=`
varying vec3 vLP;
float h3(vec3 p){p=fract(p*0.3183099+0.1);p*=17.0;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float n3(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.0-2.0*f);
  return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z);}`;
const withLP=sh=>{sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vLP;').replace('#include <begin_vertex>','#include <begin_vertex>\nvLP=position;');
  sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\n'+NOISE);};
const f1=x=>Number(x).toFixed(3);
function shakeShader(mat,{grad=true,y0=0.26,y1=2.5,scale=24,bright=1}={}){
  const key='shake'+[grad,y0,y1,scale,bright].join('|');mat.customProgramCacheKey=()=>key;   // distinct programs per parameter set
  mat.onBeforeCompile=sh=>{withLP(sh);
    sh.fragmentShader=sh.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
    { float t=${grad?`smoothstep(${f1(y0)},${f1(y1)},vLP.y)`:'0.7'};
      vec3 c=diffuseColor.rgb*mix(0.72,1.04,t)*${f1(bright)};                       // deeper towards the bottom
      float m=n3(vLP*3.5)*0.6+n3(vLP*8.0)*0.4; c*=0.92+0.16*m;                       // soft creamy marbling
      float s=n3(vLP*${f1(scale)}); c=mix(c,c*vec3(0.55,0.32,0.36),smoothstep(0.8,0.9,s)*0.5);   // tiny crushed-berry flecks
      float sd=n3(vLP*80.0+3.7); c=mix(c,vec3(0.36,0.2,0.05),smoothstep(0.91,0.95,sd)*0.45);    // seeds
      diffuseColor.rgb=c; }`)
    .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
    { float fr=pow(1.0-clamp(abs(dot(normal,normalize(vViewPosition))),0.0,1.0),2.2);  // light scattering through the rim
      diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(1.25,1.4,1.35)+vec3(0.03,0.015,0.02),fr*0.35); }`);};
  mat.needsUpdate=true;
}
function creamShader(mat){
  mat.onBeforeCompile=sh=>{withLP(sh);
    sh.fragmentShader=sh.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
    { float m=n3(vLP*14.0)*0.5+n3(vLP*30.0)*0.5; diffuseColor.rgb*=0.94+0.08*m; }`)
    .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
    { float fr=pow(1.0-clamp(abs(dot(normal,normalize(vViewPosition))),0.0,1.0),2.0);
      diffuseColor.rgb=mix(diffuseColor.rgb*vec3(0.93,0.9,0.86),diffuseColor.rgb*1.06,1.0-fr*0.6); }`);};
  mat.needsUpdate=true;
}

/* ---------- 1: bowl, tips FORWARD (toward the camera) over its front rim ---------- */
const bowl=createBowl(),BH=bowl.userData,BR=BH.topRadius,BHt=BH.height;
const pivot=new THREE.Group();pivot.position.set(0,Y_B+BHt,0);scene.add(pivot);    // pivot = front rim, straight above the blender
pivot.add(bowl);bowl.position.set(0,-BHt,-BR);                                     // bowl centre sits 1.5 behind the pivot
const bowlShadow=shadowPlane(Y_B);
const PIV=pivot.position.clone(),XA=new THREE.Vector3(1,0,0),ONE=new THREE.Vector3(1,1,1);
const Moff=new THREE.Matrix4().makeTranslation(0,-BHt,-BR);
const tiltOf=P=>rad(112)*sm((P-0.26)/0.42);                // starts tipping with the very first scroll
const _M=new THREE.Matrix4(),_v=new THREE.Vector3(),_q=new THREE.Quaternion(),_q2=new THREE.Quaternion(),_e=new THREE.Euler();
const bowlWorld=(out,th)=>out.compose(PIV,_q.setFromAxisAngle(XA,th),ONE).multiply(Moff);

// heap: berries packed in layers, every one kept inside the bowl's inner wall (with a margin for the berry's own radius)
const FOOT=0.6,WALL=0.07;
const innerR=y=>{const s=clamp((y-0.12)/(BHt-0.12));return FOOT*0.8+(BR-WALL-FOOT*0.8)*(1-Math.pow(1-s,1.7));};
const MARGIN=0.3;
const maxR=y=>y<=BHt?innerR(Math.max(0.12,y-0.22))-MARGIN:Math.min(innerR(BHt-0.02)-MARGIN,1.1-(y-BHt)*1.5);
const berries=[],up=new THREE.Vector3(0,1,0),dir=new THREE.Vector3();
let seed=1;
for(const ly of[0.98,1.18,1.36,1.52,1.66]){
  let rr=maxR(ly),ring=0;
  while(rr>-0.01){
    const n=rr<0.16?1:Math.floor(2*Math.PI*rr/0.44),off=R()*6.283;
    for(let i=0;i<n;i++){
      const a=off+i/n*6.283+(R()-0.5)*0.12,r=n===1?0:rr-R()*0.04,y=ly+(R()-0.5)*0.05,size=0.42*(0.9+R()*0.15);
      dir.set(Math.cos(a)*0.3+(R()-0.5)*0.3,1,Math.sin(a)*0.3+(R()-0.5)*0.3).normalize();
      const tmp=new THREE.Object3D();tmp.quaternion.setFromUnitVectors(up,dir);tmp.rotateY(R()*6.283);
      tmp.position.set(Math.cos(a)*r,y,Math.sin(a)*r);tmp.updateMatrix();
      const b=createStrawberry({size,seed:seed++,detail:0.7}),h=new THREE.Group();b.position.y=-0.5*size;h.add(b);scene.add(h);
      berries.push({h,size,L:tmp.matrix.clone(),spin:new THREE.Vector3((R()-0.5)*14,(R()-0.5)*14,(R()-0.5)*14),gk:1+R()*0.08,rnd:R()});
    }
    if(n===1)break;rr-=0.43;ring++;
  }
}
const N=berries.length;
// hero intro: every berry gets its own drop height, timing, sway, tumble axis and bounce (seeded, so it is the same each load)
{const IR=RNG(4242);berries.forEach((f,i)=>{const H=5.2+IR()*4.6;
  f.it={st:0.3+2.3*i/N+(IR()-0.5)*0.42,H,dur:0.2*Math.sqrt(H)+IR()*0.08,
    jx:(IR()-0.5)*1.4,jz:(IR()-0.5)*1.0,sw:0.05+IR()*0.1,ph:IR()*6.283,
    ax:new THREE.Vector3(IR()-0.5,IR()-0.5,IR()-0.5).normalize(),ang:(3+IR()*7)*(IR()<0.5?-1:1),
    bA:0.04+IR()*0.13,bN:IR()<0.35?2:1,bD:0.22+IR()*0.2};});}
{const bm=bowl.children[0].material;bm.clearcoat=0.3;bm.clearcoatRoughness=0.3;bm.roughness=0.45;bm.envMapIntensity=0.5;
  bowl.children[1].material.envMapIntensity=0.55;
  berries.forEach(f=>f.h.traverse(o=>{if(o.isMesh&&o.material.isMeshPhysicalMaterial&&o.material.vertexColors){const m=o.material;m.envMapIntensity=0.6;m.clearcoat=0.5;m.clearcoatRoughness=0.14;}}));}
// release order: front of the heap (toward the pouring rim) and top first
berries.map((f,i)=>{_v.setFromMatrixPosition(f.L);return{i,s:-_v.z-0.9*_v.y};}).sort((a,b)=>a.s-b.s)
  .forEach((o,k)=>berries[o.i].Pr=0.3+0.34*k/(N-1));
const UT=0.3,fallF=u=>u<=0?0:u<UT?u*u/(2*UT):u-UT/2;
// Just before its release, each berry rolls toward the front-centre of the rim (the pouring lip), so the stream of berries is narrow
// and lines up with the jar. After release the fall is straight down: x never changes.
// ~75% (those nearest the middle) roll right to the lip and land in the jar; the outer ~25% spill wide and fall past the blender.
const LP=new THREE.Vector3(),LQ=new THREE.Quaternion(),LS=new THREE.Vector3(),_ML=new THREE.Matrix4(),_lp=new THREE.Vector3();
berries.forEach(f=>{f.L.decompose(LP,LQ,LS);f.lp=LP.clone();f.lq=LQ.clone();});
[...berries].sort((a,b)=>Math.abs(a.lp.x)-Math.abs(b.lp.x)).forEach((f,k)=>{f.land=k<Math.round(N*0.76);});
berries.forEach(f=>{f.LT=new THREE.Vector3(f.lp.x*(f.land?0.3:0.92),Math.max(f.lp.y,1.05),1.0);});
const rollOf=(f,P)=>sm((P-(f.Pr-0.1))/0.1);
function localAt(f,P){const r=rollOf(f,P);if(r<=0)return f.L;
  // lift first, then roll forward, always kept inside the inner wall
  const ry=sm(r*1.8),rx=sm(r*1.6-0.6);
  _lp.set(lerp(f.lp.x,f.LT.x,rx),lerp(f.lp.y,f.LT.y,ry),lerp(f.lp.z,f.LT.z,rx));
  const m=maxR(_lp.y)+0.05,d=Math.hypot(_lp.x,_lp.z);if(d>m){_lp.x*=m/d;_lp.z*=m/d;}
  return _ML.compose(_lp,f.lq,ONE);}
let landers=[];
berries.forEach(f=>{bowlWorld(_M,tiltOf(f.Pr)).multiply(localAt(f,f.Pr));f.R=new THREE.Vector3();f.Rq=new THREE.Quaternion();_M.decompose(f.R,f.Rq,_v);
  if(f.land)landers.push(f);else f.zT=1.45+f.rnd*0.6;});
// settle the landers in layers: each takes the lowest layer that has room and is wide enough for its x
const LAYERS=[...Array(9)].map((_,k)=>({h:0.28+k*0.2,n:0}));
landers.sort((a,b)=>a.Pr-b.Pr).forEach(f=>{
  let L=LAYERS.find(l=>l.n<6&&jarInner(l.h)-0.2>Math.abs(f.R.x)+0.02)||LAYERS[LAYERS.length-1];L.n++;
  const rmax=jarInner(L.h)-0.2,zr=Math.sqrt(Math.max(0,rmax*rmax-f.R.x*f.R.x))*0.6;f.zT=(f.rnd*2-1)*zr;
  // once down, it settles sideways into its spot in the layer (a ring, so the layers don't stack into a column)
  const li=LAYERS.indexOf(L),an=(L.n-1)/6*6.283+li*0.9,sr=L.n===6?0.05:rmax*0.82;
  f.E=new THREE.Vector3(Math.cos(an)*sr,JB+L.h,Math.sin(an)*sr);});
let G=0;landers.forEach(f=>G=Math.max(G,(f.R.y-f.E.y)/(2.32-f.Pr-UT/2)));
berries.forEach(f=>{if(!f.land)return;f.D=f.R.y-f.E.y;const g=G*f.gk;f.uL=f.D<=g*UT/2?Math.sqrt(2*UT*f.D/g):f.D/g+UT/2;
  f.r0=Math.hypot(f.E.x,f.E.z);f.a0=Math.atan2(f.E.z,f.E.x);});

/* ---------- 3: blender (moodier), milk pitcher ---------- */
const blender=createBlender();scene.add(blender);const BL=blender.userData;
const capMesh=blender.children.find(c=>c.isMesh&&c.material.clippingPlanes&&c.material.clippingPlanes.length);
const lid=blender.children.find(c=>c.isGroup&&c!==BL.jar&&c.children.length===4);
const blenderBody=blender.children.filter(c=>c!==BL.jar&&c!==capMesh);
{const seen=new Set();blender.traverse(o=>{if(!o.isMesh||seen.has(o.material))return;seen.add(o.material);const m=o.material;
  if(m.clippingPlanes&&m.clippingPlanes.length){m.clearcoat=1;m.roughness=0.1;return;}             // the shake keeps its sheen
  m.envMapIntensity=(m.envMapIntensity??1)*0.5;if(m.metalness>0.5)m.roughness=Math.min(1,m.roughness+0.12);});}
const blenderShadow=shadowPlane(0);
{const seen=new Set();blender.traverse(o=>{if(!o.isMesh||seen.has(o.material))return;seen.add(o.material);const m=o.material;
  if(m.clippingPlanes&&m.clippingPlanes.length)return;
  m.envMapIntensity*=0.6;if(m.transparent){m.opacity=Math.min(m.opacity,0.11);m.clearcoat=0.35;m.clearcoatRoughness=0.2;m.roughness=Math.max(m.roughness,0.12);}
  if('clearcoat' in m&&!m.transparent)m.clearcoat=Math.min(m.clearcoat,0.3);});
  const lm=capMesh.material;lm.transparent=false;lm.opacity=1;lm.roughness=0.42;lm.clearcoat=0.12;lm.clearcoatRoughness=0.4;lm.envMapIntensity=0.4;lm.specularIntensity=0.45;shakeShader(lm,{grad:false,scale:22});
  // the top surface faces the key light; give it its own, slightly deeper material so it reads as the same shake, not a pale disc
  const cm=lm.clone();cm.clippingPlanes=lm.clippingPlanes;cm.color=new THREE.Color();cm.roughness=0.55;cm.clearcoat=0;cm.envMapIntensity=0.2;cm.specularIntensity=0.2;shakeShader(cm,{grad:false,scale:22,bright:0.8});capMesh.material=cm;}
const V0=BL.volForLevel(LMAX);
const jarGlassMats=[];{const seen=new Set();BL.jar.traverse(o=>{if(o.isMesh&&o.material.transparent&&!(o.material.clippingPlanes&&o.material.clippingPlanes.length)&&!seen.has(o.material)){seen.add(o.material);jarGlassMats.push([o.material,o.material.opacity,o.material.envMapIntensity,o.material.clearcoat]);}});}
const milkStream=new Stream(scene,new THREE.MeshPhysicalMaterial({color:lin(0xfdf8f2),roughness:0.25,clearcoat:1,transparent:true,opacity:0.97}));
const J={lipLocal:BL.lipLocal,home:BL.home,lipTarget:LIPT,liftH:4.6,tilt1:0};

/* the jar's liquid surface gets a soft rolled meniscus along its outline, so the level cut never shows a crisp edge */
const jarMen=new THREE.Mesh(new THREE.BufferGeometry(),capMesh.material.clone());jarMen.material.clippingPlanes=[];jarMen.material.color=capMesh.material.color;shakeShader(jarMen.material,{grad:false,scale:22,bright:0.8});jarMen.frustumCulled=false;blender.add(jarMen);
const _men=[...Array(48)].map(()=>new THREE.Vector3()),menCurve=new THREE.CatmullRomCurve3(_men,true);
function updateJarMeniscus(){
  if(!capMesh.visible){jarMen.visible=false;return;}
  const p=capMesh.geometry.attributes.position.array,cx=p[0],cy=p[1],cz=p[2];
  for(let k=0;k<48;k++){const x=p[3+k*3],z=p[5+k*3],dx=x-cx,dz=z-cz,d=Math.hypot(dx,dz)||1,sh=Math.min(0.03,d*0.3);
    _men[k].set(x-dx/d*sh,cy-0.012,z-dz/d*sh);}
  jarMen.geometry.dispose();jarMen.geometry=new THREE.TubeGeometry(menCurve,96,0.034,8,true);jarMen.visible=true;
}

/* the shake stream: a thick, wobbling rope of liquid. It leaves the lip with a rounded, wide start, arcs out
   and then falls straight; both ends are rounded, the thickness breathes, so it never reads as a flat tube. */
class ThickStream{
  constructor(parent,mat){
    this.R=[...Array(13)].map((_,i)=>i/12),this.NR=13+44+10;this.M=18;
    const n=this.NR*(this.M+1),idx=[];
    for(let i=0;i<this.NR-1;i++)for(let j=0;j<this.M;j++){const a=i*(this.M+1)+j,b=a+this.M+1;idx.push(a,b,a+1,b,b+1,a+1);}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(n*3),3));g.setIndex(idx);
    this.mesh=new THREE.Mesh(g,mat);this.mesh.frustumCulled=false;this.mesh.visible=false;parent.add(this.mesh);
  }
  hide(){this.mesh.visible=false;}
  // path, measured by drop d below the lip (d<0 starts just inside the jar so the rounded start tucks under the liquid)
  static px(x0,d){return x0+0.04-STREAM_ARC*(d<=0?d/0.22:1-Math.exp(-d/0.22));}
  set(lip,dTop,dBot,time){
    if(dBot-dTop<0.03){this.hide();return;}
    const ds=[],L=dBot-dTop;
    const top=Math.min(1.0,L*0.45),head=Math.min(0.35,L*0.3);
    for(let i=0;i<13;i++)ds.push(dTop+top*Math.pow(i/12,1.6));
    for(let i=1;i<=44;i++)ds.push(dTop+top+(L-top-head)*i/45);
    for(let i=0;i<10;i++)ds.push(dBot-head*(1-Math.sin(Math.PI/2*i/9)));
    const pos=this.mesh.geometry.attributes.position.array,M=this.M,y0=lip.y+0.02;let o=0;
    for(let i=0;i<this.NR;i++){
      const d=ds[i],x=ThickStream.px(lip.x,d)+0.012*Math.sin(d*1.7-time*4)*Math.min(1,Math.max(0,d)),y=y0-d;
      const sl=d<=0?-1/0.22*STREAM_ARC:-STREAM_ARC/0.22*Math.exp(-d/0.22);    // dx/dd
      let tx=sl,ty=-1;const tl=Math.hypot(tx,ty);tx/=tl;ty/=tl;            // tangent; ring spans the normal (-ty,tx) and z
      const nx=-ty,ny=tx;
      let r=0.072+0.06*Math.exp(-Math.max(0,d)/0.35);                      // thick at the lip, settles into a steady rope
      r*=1+0.11*Math.sin(d*4.3-time*9)+0.05*Math.sin(d*11.7+time*6.1)+0.03*Math.sin(d*23-time*13);
      const fT=Math.sqrt(Math.min(1,Math.max(0,(d-dTop)/0.12))),fB=Math.sqrt(Math.min(1,Math.max(0,(dBot-d)/Math.max(0.02,head))));
      r*=fT*fB*(1+0.18*Math.max(0,1-(dBot-d)/Math.max(0.02,head*2)));       // rounded ends, a slightly fuller falling head
      const az=1+0.55*Math.exp(-Math.max(0,d)/0.3);                          // a wider sheet where it leaves the lip
      for(let j=0;j<=M;j++){const a=j/M*Math.PI*2,c=Math.cos(a)*r,sn=Math.sin(a)*r*az;
        pos[o++]=x+nx*c;pos[o++]=y+ny*c;pos[o++]=lip.z+sn;}
    }
    const g=this.mesh.geometry;g.attributes.position.needsUpdate=true;g.computeVertexNormals();this.mesh.visible=true;
  }
}
const jarStream=new ThickStream(scene,new THREE.MeshPhysicalMaterial({color:STREAM_COL.clone().lerp(SHAKE_COL_L,0.6),roughness:0.3,clearcoat:0.45,clearcoatRoughness:0.25,envMapIntensity:0.6}));
shakeShader(jarStream.mesh.material,{grad:false,scale:18,bright:0.8});

// glass milk pitcher: origin at the bottom centre, spout on -x
function createPitcher(){
  const g=new THREE.Group(),Hh=1.3,rb=0.4,rt=0.46,w=0.035,pts=[];
  const ro=h=>rb+(rt-rb)*h/Hh;
  pts.push(new THREE.Vector2(0,0),new THREE.Vector2(rb-0.03,0));
  for(let i=0;i<=16;i++){const h=0.02+(Hh-0.02)*i/16;pts.push(new THREE.Vector2(ro(h),h));}
  pts.push(new THREE.Vector2(rt-w/2,Hh+0.01));
  for(let i=16;i>=0;i--){const h=0.08+(Hh-0.08)*i/16;pts.push(new THREE.Vector2(ro(h)-w,h));}
  pts.push(new THREE.Vector2(0,0.08));
  const geo=new THREE.LatheGeometry(pts,64),p=geo.attributes.position;
  for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i),a=Math.atan2(z,x),k=sm((y-1.0)/0.3)*Math.pow(Math.max(0,-Math.cos(a)),6);
    p.setX(i,x-0.16*k);p.setY(i,y+0.03*k);}
  geo.computeVertexNormals();
  const gm=new THREE.MeshPhysicalMaterial({color:lin(0xeef6fa),roughness:0.04,transparent:true,opacity:0.34,envMapIntensity:1.4,clearcoat:1,side:THREE.DoubleSide,depthWrite:false});
  const body=new THREE.Mesh(geo,gm);body.renderOrder=5;g.add(body);
  const hc=new THREE.CatmullRomCurve3([[rt-0.04,1.12],[rt+0.3,1.05],[rt+0.36,0.6],[rt+0.22,0.3],[ro(0.3)-0.02,0.28]].map(([x,y])=>new THREE.Vector3(x,y,0)));
  const handle=new THREE.Mesh(new THREE.TubeGeometry(hc,32,0.05,10),gm.clone());handle.material.opacity=0.55;handle.renderOrder=5;g.add(handle);
  const plane=new THREE.Plane(new THREE.Vector3(0,-1,0),0);
  const milkMat=new THREE.MeshPhysicalMaterial({color:lin(0xfbf7f1),roughness:0.35,clearcoat:0.4,side:THREE.DoubleSide,clippingPlanes:[plane]});
  const milk=new THREE.Mesh(new THREE.CylinderGeometry(rt-w-0.012,rb-w-0.012,Hh-0.1,40),milkMat);milk.position.y=0.08+(Hh-0.1)/2;g.add(milk);
  g.userData={lip:new THREE.Vector2(-(rt+0.14),Hh+0.03),plane,milk};
  return g;
}
const pitcher=createPitcher();scene.add(pitcher);
pitcher.traverse(o=>{if(o.isMesh&&o.material.transparent){o.material.envMapIntensity=0.55;o.material.clearcoat=0.35;o.material.clearcoatRoughness=0.2;}});
const PH=new THREE.Vector3(2.5,0,0.9);
const PC={lipLocal:pitcher.userData.lip,home:PH,lipTarget:new THREE.Vector3(0.3,JAR_TOP+0.75,0.1),liftH:3.2,tilt1:rad(15)};

/* droplets: decorative instanced spheres */
function droplets(n,color,parent=scene){
  const m=new THREE.InstancedMesh(new THREE.SphereGeometry(1,10,8),new THREE.MeshPhysicalMaterial({color,roughness:0.15,clearcoat:1}),n);
  m.frustumCulled=false;m.visible=false;parent.add(m);const o=new THREE.Object3D(),r=RNG(99+n),d=[...Array(n)].map(()=>({a:r()*6.283,b:r(),c:r(),s:0.6+r()*0.8}));
  return{m,d,set(i,x,y,z,s){o.position.set(x,y,z);o.scale.setScalar(s);o.updateMatrix();m.setMatrixAt(i,o.matrix);},done(){m.instanceMatrix.needsUpdate=true;}};
}
const milkSplash=droplets(14,lin(0xfdf8f2)),streamDrops=droplets(40,STREAM_COL),glassSplash=droplets(16,STREAM_COL);
function crown(D,cx,cy,cz,time,on,size=0.035){
  D.m.visible=on;if(!on)return;
  D.d.forEach((q,i)=>{const c=(time*1.7+q.b)%1,rr=0.1+0.42*c*q.s;D.set(i,cx+Math.cos(q.a)*rr,cy+0.42*q.s*Math.sin(Math.PI*c),cz+Math.sin(q.a)*rr,size*q.s*(1-0.6*c));});D.done();
}

/* ---------- 5: glass ---------- */
const glass=createGlassStation(GX,0);glass.position.y=GY;scene.add(glass);const GL=glass.userData;
const cond=createCondensation(lowPower);glass.add(cond.group);
const glassShadow=shadowPlane(GY);
const G_TARGET=GL.fullVolume()*0.97;
GL.setColor(lin(SHAKE_HEX));
const shakeMesh=glass.children.find(c=>c.isMesh&&c.material.map);
glass.children.slice(0,3).forEach(c=>{if(c.isMesh&&c.material.transparent){c.material.opacity*=0.6;c.material.envMapIntensity=0.8;}});   // clearer tumbler, less milky haze
{const m=shakeMesh.material;m.map=null;m.emissive.setRGB(0,0,0);m.roughness=0.42;m.clearcoat=0.3;m.clearcoatRoughness=0.35;m.envMapIntensity=0.55;
  shakeShader(m,{grad:true,y0:GLASS.floor,y1:GLASS.H,scale:24});}
// meniscus: a soft lip where the shake meets the glass wall
const menMat=new THREE.MeshPhysicalMaterial({roughness:0.4,clearcoat:0.3,envMapIntensity:0.55});menMat.color=shakeMesh.material.color;shakeShader(menMat,{grad:false,scale:24,bright:1.08});
const meniscus=new THREE.Mesh(new THREE.TorusGeometry(1,0.03,10,72),menMat);meniscus.rotation.x=-Math.PI/2;glass.add(meniscus);
GL.setVolume(G_TARGET);GL.setCream(0.001);GL.setSyrup(0.001);GL.setBerry(0.001);GL.setStraw(0.001);
GL.setCream(0);GL.setSyrup(0);GL.setBerry(0);GL.setStraw(0);GL.setVolume(0);
{const deco=glass.children.find(c=>c.isGroup&&c.children.length>3),cm=deco.children[0].material;
  const cream=new THREE.MeshPhysicalMaterial({color:lin(0xf6ece0),roughness:0.66,clearcoat:0.12,clearcoatRoughness:0.6,envMapIntensity:0.45,side:THREE.DoubleSide,sheen:new THREE.Color(0xfff6ee)});
  creamShader(cream);
  deco.traverse(o=>{if(!o.isMesh)return;const m=o.material;
    if(m===cm)o.material=cream;
    else if(m.isMeshPhysicalMaterial&&m.roughness===0.1&&m.clearcoat===1){m.color.copy(lin(0x5e0614));m.roughness=0.05;m.clearcoatRoughness=0.02;m.envMapIntensity=1.6;m.emissive.copy(lin(0x1a0205));}});}
const SIDE=[[-1.35,0.75,0.4],[1.25,0.95,-2.0],[-0.6,1.75,1.1]];
const sideBerries=SIDE.map(([x,z,ry],i)=>{const b=createStrawberry({size:0.45,seed:80+i,detail:0.8}),h=new THREE.Group();
  b.rotation.z=(i%2?-1:1)*Math.PI/2+0.2;b.position.y=0.2;h.add(b);h.rotation.y=ry;h.position.set(GX+x,GY,z);scene.add(h);return h;});

/* ---------- scroll -> P ---------- */
const secs=[...document.querySelectorAll('[data-i]')],layers=[...document.querySelectorAll('#bg .layer')];
let tops=[],hs=[];
function measure(){tops=secs.map(e=>e.getBoundingClientRect().top+scrollY);hs=secs.map(e=>e.offsetHeight);}
function scrollState(){
  const y=scrollY,vh=innerHeight,c=y+0.5*vh;
  let P=5;
  for(let i=0;i<5;i++){const u=(c-tops[i])/hs[i];if(u<1){P=i+Math.max(0,u);break;}}
  for(let j=0;j<layers.length;j++){const o=j===0?1:sm((y-(tops[j]-0.5*vh))/(0.4*vh)+0.5);const l=layers[j];if(l._o!==o){l._o=o;l.style.opacity=o;}}
  return{P,A:Math.min(5,Math.floor(P))};
}

/* ---------- timings ---------- */
const jarLift=P=>sm((P-2.92)/0.07),jarMv=P=>sm((P-3.0)/0.16);
const jarTilt=P=>rad(44)*sm((P-3.12)/0.12)+rad(38)*clamp((P-3.24)/0.76);
const STREAM_ON=3.22;

/* ---------- camera path ---------- */
const YF=Y_B+0.95,YS3=2.9;
const softFloor=(x,f,k=1.2)=>f+Math.log1p(Math.exp(k*(x-f)))/k;
const dummyJar=new THREE.Object3D(),JC=new THREE.Vector3();
function jarPoseAt(P){carryPose(dummyJar,J,jarLift(P),jarMv(P),jarTilt(P));dummyJar.updateMatrixWorld(true);dummyJar.localToWorld(JC.set(0,1.0,0));}
const CT=new THREE.Vector3();let CTz=0,CTd=1;
function camTarget(P){
  const yCloud=YF-G*fallF(P-0.45);                         // follows the middle of the falling berries
  let x=0,y=softFloor(yCloud,YS3);
  if(P>2.9){jarPoseAt(P);const s=sm((P-2.91)/0.06);x=lerp(0,JC.x,s);y=lerp(y,JC.y,s);    // rise with the jar (base drops out below), then slide with it
    if(P>3.18){x=lerp(JC.x,LIPT.x,sm((P-3.18)/0.3));y=lerp(JC.y,GY+1.75,sm((P-3.18)/0.84));}}   // then ride the stream down
  CTz=lerp(-BR*0.6,0,sm((P-0.5)/0.6));CTd=lerp(1,0.86,sm((P-3.6)/0.45));
  return CT.set(x,y,CTz);
}
const OFF=new THREE.Vector3(0.3,1.6,10.2);
const OFF_R=OFF.length(),OFF_YAW=Math.atan2(OFF.x,OFF.z),OFF_PITCH=Math.asin(OFF.y/OFF_R);

/* ---------- user orbit on top of the scroll camera ---------- */
// The scroll camera picks the focus point; the user's yaw/pitch/zoom is a damped spherical offset around it.
const view={yaw:0,pitch:0,zoom:1,ty:0,tp:0,tz:1};
const PITCH_MIN=-0.12,PITCH_MAX=1.25,ZMIN=0.55,ZMAX=1.8;
const ctl=document.getElementById('viewctl'),hint=document.getElementById('viewhint');
let touched=false;
function interacted(){if(!touched){touched=true;hint.classList.add('gone');}}
function resetView(){view.yaw=((view.yaw+Math.PI)%(2*Math.PI)+2*Math.PI)%(2*Math.PI)-Math.PI;view.ty=0;view.tp=0;view.tz=1;}
const ptrs=new Map();let pinch0=0;
cv.addEventListener('pointerdown',e=>{
  if(e.pointerType==='mouse'&&e.button!==0)return;
  ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY,t:e.pointerType});
  if(e.pointerType==='mouse'){cv.setPointerCapture(e.pointerId);cv.classList.add('dragging');}
  if(ptrs.size===2){const [a,b]=[...ptrs.values()];pinch0=Math.hypot(a.x-b.x,a.y-b.y);}
});
cv.addEventListener('pointermove',e=>{
  const p=ptrs.get(e.pointerId);if(!p)return;
  const dx=e.clientX-p.x,dy=e.clientY-p.y;p.x=e.clientX;p.y=e.clientY;
  if(ptrs.size===2){const [a,b]=[...ptrs.values()],d=Math.hypot(a.x-b.x,a.y-b.y);if(pinch0>0){view.tz=clamp(view.tz*pinch0/d,ZMIN,ZMAX);}pinch0=d;interacted();return;}
  view.ty-=dx*0.005;                                           // horizontal drag: rotate around the focus
  if(p.t==='mouse')view.tp=clamp(view.tp+dy*0.004,PITCH_MIN-OFF_PITCH,PITCH_MAX-OFF_PITCH);   // mouse also tilts (touch keeps vertical for page scroll)
  if(Math.abs(dx)+Math.abs(dy)>1)interacted();
});
const endPtr=e=>{ptrs.delete(e.pointerId);if(ptrs.size<2)pinch0=0;if(!ptrs.size)cv.classList.remove('dragging');};
['pointerup','pointercancel','lostpointercapture'].forEach(t=>cv.addEventListener(t,endPtr));
// a plain wheel scrolls the page as usual; ctrl+wheel (and trackpad pinch) zooms the 3D
cv.addEventListener('wheel',e=>{if(!e.ctrlKey&&!e.metaKey)return;e.preventDefault();view.tz=clamp(view.tz*Math.exp(e.deltaY*0.003),ZMIN,ZMAX);interacted();},{passive:false});
cv.addEventListener('dblclick',resetView);
ctl.querySelector('[data-a="in"]').addEventListener('click',()=>{view.tz=clamp(view.tz/1.2,ZMIN,ZMAX);interacted();});
ctl.querySelector('[data-a="out"]').addEventListener('click',()=>{view.tz=clamp(view.tz*1.2,ZMIN,ZMAX);interacted();});
ctl.querySelector('[data-a="reset"]').addEventListener('click',()=>{resetView();interacted();});
let lastT=0;

const INTRO_FREEZE=parseFloat(new URLSearchParams(location.search).get('intro')??'-1');   // ?intro=1.2 freezes the hero drop at that second (for stills)
let heroStart=-1,heroDone=false,lastA=-1;const clock=new THREE.Clock();let time=0;
const LIP=new THREE.Vector3(),PLIP=new THREE.Vector3(),TO=new THREE.Vector3(),FROM=new THREE.Vector3(),_w=new THREE.Vector3();

function apply(P,A){
  /* ---- lights: soft and rich on the bowl and on the blender ---- */
  const gl=sm((P-3.7)/0.3)*0.35,hero=1-sm((P-0.55)/0.4),bld=sm((P-1.8)/0.3)*(1-sm((P-3.05)/0.2)),dim=Math.max(hero,bld,gl);
  renderer.toneMappingExposure=lerp(1.0,0.68,dim);key.intensity=lerp(1.7,0.85,dim);hemi.intensity=lerp(0.6,0.24,dim);fill.intensity=lerp(0.5,0.18,dim);rimL.intensity=lerp(0.7,0.32,dim);

  /* ---- bowl ---- */
  if(P>0.27)heroDone=true;
  const tau=heroDone?1e9:(INTRO_FREEZE>=0?INTRO_FREEZE:Math.max(0,time-heroStart));
  const th=tiltOf(P),intro=-0.35*(1-sm(tau/0.7));
  pivot.visible=bowlShadow.visible=P<1.05;
  pivot.position.set(PIV.x,PIV.y+intro,PIV.z);pivot.rotation.x=th;

  /* ---- berries: bowl -> straight fall -> jar (or past it) -> blended away ---- */
  const bl=clamp((P-2.71)/0.19),b=sm(bl);
  berries.forEach((f,i)=>{
    const h=f.h;
    if(P<f.Pr){
      bowlWorld(_M,th).multiply(localAt(f,P));_M.decompose(h.position,h.quaternion,_v);
      if(!heroDone){const I=f.it,e=clamp((tau-I.st)/I.dur),k=clamp((tau-I.st-I.dur)/I.bD),fe=1-e;
        // falls under gravity; the sideways jitter and sway die out well before it reaches the rim, so it lands exactly in its slot
        h.position.x+=I.jx*Math.pow(fe,1.5)+I.sw*Math.sin(I.ph+e*7)*fe*fe;
        h.position.z+=I.jz*Math.pow(fe,1.5)+I.sw*Math.cos(I.ph*1.3+e*6)*fe*fe;
        h.position.y+=intro+I.H*(1-e*e)+I.bA*Math.abs(Math.sin(Math.PI*k*I.bN))*(1-k)*(1-k);
        _q2.setFromAxisAngle(I.ax,I.ang*Math.pow(fe,1.3)+0.18*Math.sin(Math.PI*k*I.bN)*(1-k));h.quaternion.multiply(_q2);h.visible=e>0;}
      else h.visible=true;
      h.scale.setScalar(1);return;
    }
    const u=f.land?Math.min(P-f.Pr,f.uL):P-f.Pr;
    let fy=G*f.gk*fallF(u);if(f.land)fy=Math.min(f.D,fy);
    h.position.set(f.R.x,f.R.y-fy,lerp(f.R.z,f.zT,sm(u/0.3)));
    if(f.land){const st=sm((P-f.Pr-f.uL)/0.05);if(st>0){h.position.x=lerp(f.R.x,f.E.x,st);h.position.z=lerp(f.zT,f.E.z,st);}}           // straight down, nudged toward the camera (in front of the bowl)
    _q2.setFromEuler(_e.set(f.spin.x*u,f.spin.y*u,f.spin.z*u));h.quaternion.copy(f.Rq).multiply(_q2);
    if(f.land&&bl>0){const ramp=sm(bl*6),an=f.a0+bl*14*(1+0.06*(i%7)),r=f.r0*(1-0.55*b);
      h.position.set(lerp(f.E.x,Math.cos(an)*r,ramp),f.E.y+ramp*0.25*Math.sin(bl*20+i*1.3)*(1-b)-sm(bl*2.2)*(f.E.y-JB-0.45)*0.9,lerp(f.E.z,Math.sin(an)*r,ramp));
      _q2.setFromEuler(_e.set(bl*6,bl*3,0));h.quaternion.multiply(_q2);}
    const landed=f.land?sm((P-f.Pr-f.uL+0.02)/0.04):0;h.scale.setScalar(f.land?(1-0.2*landed)*(1-0.95*bl*bl):1);
    h.visible=f.land?(bl<0.995&&P<3.2):h.position.y>-9;
  });

  /* ---- blender ---- */
  const bVis=P>1.5&&P<3.5;blender.visible=bVis;blenderBody.forEach(o=>o.visible=P<3.2);blenderShadow.visible=P>1.5&&P<3.2;
  milkStream.hide();milkSplash.m.visible=false;jarStream.hide();streamDrops.m.visible=false;glassSplash.m.visible=false;
  pitcher.visible=P>1.8&&P<2.95;
  // pitcher choreography: lift, carry over the jar, tilt and pour, then back to the table
  const pl=sm((P-2.16)/0.08)*(1-sm((P-2.7)/0.06)),pm=sm((P-2.22)/0.12)*(1-sm((P-2.62)/0.08)),pt=sm((P-2.32)/0.18)*(1-sm((P-2.55)/0.07));
  const pTe=rad(100)*pt;carryPose(pitcher,PC,pl,pm,pTe,PLIP);
  const pour=sm((pTe+PC.tilt1*sm(pm)-rad(42))/rad(70)),milkLeft=1-Math.max(pour,P>2.55?1:0)*1;
  const pourLvl=P<2.55?pour:1;                               // how much milk has left the pitcher (never comes back once poured)
  {pitcher.updateMatrixWorld(true);const md=pitcher.userData;
    const top=pitcher.localToWorld(_w.set(0,1.18,0)).y,low=Math.min(pitcher.localToWorld(_w.set(0.36,0.1,0)).y,pitcher.localToWorld(_w.set(-0.36,0.1,0)).y);
    const lvl=Math.min(PLIP.y-0.02,top);md.plane.constant=lerp(lvl,low+0.02,pourLvl);md.milk.visible=pourLvl<0.985;}
  if(bVis){
    const lidOn=sm((P-2.63)/0.08);
    BL.setLidAmount(1-lidOn);
    if(P>2.9){lid.position.set(0,JAR_TOP+4.6*jarLift(P)+9*sm((P-2.93)/0.09),0);}    // lid lifts off and away upward
    const spinning=bl>0.001&&bl<0.999;
    BL.setBladeAngle(bl*60+(spinning?time*38:0),spinning?1:0);
    BL.setMixNow(lerp(1,MIX,b));
    if(P<2.92){BL.resetPose();const L=0.14+0.5*pourLvl+(LMAX-0.64)*b;if(L>0.17)BL.setLiquid(L);else BL.setVolume(0);}
    else{const te=jarTilt(P);carryPose(BL.jar,J,jarLift(P),jarMv(P),te,LIP);BL.setVolume(Math.min(V0,BL.capAt(te)));}
    BL.refresh();
    {const k=sm((P-2.95)/0.15);jarGlassMats.forEach(([m,o,e,c])=>{m.opacity=lerp(o,o*0.45,k);m.envMapIntensity=lerp(e,e*0.3,k);m.clearcoat=lerp(c,0.05,k);});}
    BL.color().copy(MILK_COL).lerp(MID_PINK,sm(b*2)).lerp(SHAKE_COL_L,sm(b*2-1));capMesh.material.color.copy(BL.color()).multiplyScalar(0.62);if(P>2.95)capMesh.visible=false;   // while tilted the inside of the liquid reads better than a flat cut disc   // same deep shake colour as the glass
    if(P<2.6&&pour>0.02&&pour<0.995){const surf=BL.surfaceY();
      milkStream.set(PLIP,TO.set(0.05,surf,0.05),0.045*Math.min(1,pour*6,(1-pour)*8+0.3));crown(milkSplash,0.05,surf,0.05,time,true,0.03);}
  }

  /* ---- the shake stream: lip -> (down through section 4) -> glass ---- */
  const gSurf=GY+GL.surfaceY();
  if(P>STREAM_ON&&P<4.42){
    LIP.copy(LIPT);
    const yTop=LIP.y-Math.max(0,P-4.22)*150,yBot=Math.max(gSurf,LIP.y-(P-STREAM_ON)*70);
    if(yTop>yBot+0.05){
      jarStream.set(LIP,yTop>=LIP.y-0.001?-0.09:LIP.y-yTop,LIP.y+0.02-yBot,time);
      streamDrops.m.visible=false;const span=yTop-yBot;
      streamDrops.d.forEach((q,i)=>{const y=yTop-((q.b*span+P*40*q.s+time*3*q.s)%span);
        const d=LIP.y-y,on=d>0.8&&y>yBot+0.2;streamDrops.set(i,ThickStream.px(LIP.x,d)+(q.c-0.5)*0.2,y,Math.sin(q.a)*0.1,on?0.01+0.014*q.s:0);});streamDrops.done();
      crown(glassSplash,GX,gSurf,0,time,yBot<=gSurf+0.01&&P>3.7,0.04);
    }
  }

  /* ---- glass ---- */
  glass.visible=glassShadow.visible=P>3.5;sideBerries.forEach(h=>h.visible=false);
  if(P>3.5){
    const g=P;
    GL.setVolume(G_TARGET*sm((g-3.9)/0.45));
    {const L=GL.surfaceY(),r=gIn(L)-0.035;meniscus.visible=GL.liquid()>0.02;meniscus.scale.set(r,r,1);meniscus.position.y=L+0.012;}
    GL.setCream(sm((g-4.42)/0.16));GL.setSyrup(clamp((g-4.56)/0.1));GL.setBerry(clamp((g-4.64)/0.07));GL.setStraw(clamp((g-4.7)/0.07));
    cond.set(0.35*clamp((g-4.2)/0.6));            // light frosting only
    sideBerries.forEach((h,i)=>{const s=clamp((g-4.68-0.035*i)/0.08);h.visible=s>0;h.position.y=GY+6*(1-s*s);});
    glass.rotation.y=P>=5?time*0.35:0.12*Math.sin(time*0.5);
  }

  /* ---- camera + key light ---- */
  camTarget(P);const k=Math.max(1,1.05/cam.aspect)*CTd;
  const dt=Math.min(0.1,Math.max(0,time-lastT));lastT=time;const kd=1-Math.exp(-dt*7);
  view.yaw+=(view.ty-view.yaw)*kd;view.pitch+=(view.tp-view.pitch)*kd;view.zoom+=(view.tz-view.zoom)*kd;
  const r=OFF_R*k*view.zoom,yw=OFF_YAW+view.yaw,pc=clamp(OFF_PITCH+view.pitch,PITCH_MIN,PITCH_MAX);
  cam.position.set(CT.x+r*Math.cos(pc)*Math.sin(yw),CT.y+r*Math.sin(pc),CT.z+r*Math.cos(pc)*Math.cos(yw));cam.lookAt(CT);
  key.target.position.copy(CT);key.position.set(CT.x+KEY_OFF.x,CT.y+KEY_OFF.y,CT.z+KEY_OFF.z);

  let op=1;
  if(A===5&&narrow()){const r=secs[5].getBoundingClientRect();op=sm((r.top/innerHeight-0.05)/0.25);}
  cv.style.opacity=op.toFixed(3);
  const foot=document.getElementById('after').getBoundingClientRect().top<innerHeight-40,live=op>0.1&&!foot;
  cv.style.pointerEvents=live?'auto':'none';ctl.classList.toggle('off',!live);hint.classList.toggle('off',!live);
  if(A!==lastA){if(lastA>=0)resetView();lastA=A;secs.forEach((s,i)=>s.classList.toggle('in',i===A));}
}

/* ---------- sizing ---------- */
function size(){const w=cv.clientWidth||innerWidth,h=cv.clientHeight||innerHeight;renderer.setSize(w,h,false);cam.aspect=w/h;cam.updateProjectionMatrix();measure();}
addEventListener('resize',size);addEventListener('load',measure);
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(measure);
size();
{const vis=[];scene.traverse(o=>{vis.push([o,o.visible]);o.visible=true;});try{renderer.compile(scene,cam);}catch(e){}vis.forEach(([o,v])=>o.visible=v);}

function frame(){
  time=clock.getElapsedTime();if(heroStart<0)heroStart=time;
  const {P,A}=scrollState();apply(P,A);renderer.render(scene,cam);
  if(!window.__berrylaneReady){window.__berrylaneReady=true;document.dispatchEvent(new Event('berrylane:ready'));}
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__berrylane={state:()=>scrollState(),berries:N,landers:landers.length,view:()=>({...view})};
