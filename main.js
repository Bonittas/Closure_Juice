import * as THREE from 'three';
import { simulateBodies, makeShell, hullOf } from './physics.js';
import { createBowl, createStrawberry, lin } from './strawberry_bowl.js';
import { createBlender, BLENDER, jarInner, jarOuter } from './blender.js';
import { createGlassStation, GLASS, gIn } from './glass.js';
import { Stream, carryPose, rad } from './pour.js';
import { createCondensation } from './looks.js';
// ?bench only: load-phase timestamps for bench.js (nothing is recorded or exposed without ?bench)
const BENCH=/[?&]bench(=|&|$)/.test(location.search);
const BT=BENCH?(window.__benchT={mainStart:performance.now()}):null;const bmark=k=>{if(BT)BT[k]=performance.now();};
const QS=new URLSearchParams(location.search),AUDIT=QS.has('audit'),BAKE_MODE=QS.has('bake');
/* Baked physics: the three simulations (hero drop, bowl tip, jar landing) are deterministic (fixed seeds, fixed inputs), so they
   are run once offline (?bake, see tools/bake.py) and shipped as sims.bin, a gzip of the exact float32 recordings. The fetch starts
   here, in parallel with the scene build; if the file is missing, stale or can't be decoded, the page runs the same simulations
   itself (same code, same result). ?nobake forces the runtime simulation. */
const BAKE_V=13;
const bakeP=(BAKE_MODE||QS.has('nobake'))?Promise.resolve(null):
  fetch('sims.bin?v='+BAKE_V).then(r=>{bmark('bakeResponse');if(!r.ok||typeof DecompressionStream==='undefined')throw new Error('no bake');
    return new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();}).then(b=>{bmark('bakeInflated');const d=decodeBake(b);bmark('bakeDecoded');return d;}).catch(e=>{console.info('Maleda: running the physics live ('+(e&&e.message)+')');return null;});

/* =====================================================================================
   Maleda: one continuous vertical world, the camera travels down through it.
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
bmark('rendererStart');const renderer=new THREE.WebGLRenderer({canvas:cv,antialias:true,alpha:true,powerPreference:'high-performance'});
renderer.setClearColor(0x000000,0);renderer.setSize(cv.clientWidth||innerWidth,cv.clientHeight||innerHeight,false);   // final buffer size up front (one allocation)
/* Adaptive quality. "lite" keeps every object, light, shadow and colour, but compiles the physically based materials without
   their clearcoat layer (the same shader as MeshStandardMaterial: roughly a third less shader code per program, which is what
   old GPUs / D3D11 drivers stall on), a 1024 shadow map and pixel ratio <= 1.25. Chosen up front for known old or software
   GPUs, or at run time when the hero's shaders turn out slow to build (then for everything not yet compiled).
   ?quality=full / ?quality=lite force a mode. */
const GPU_STR=(()=>{try{const g=renderer.getContext(),e=g.getExtension('WEBGL_debug_renderer_info');return String(e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):g.getParameter(g.RENDERER));}catch(e){return '';}})();
const OLD_GPU=/SwiftShader|llvmpipe|softpipe|Software|Microsoft Basic|Direct3D ?9|D3D9|GeForce (GTX |GT |GTS )?[1-7]\d\d[A-Z]?\b|GeForce [89]\d{3}|Quadro (FX|NVS|K\d)|\bHD Graphics( [2-6]\d{2,3})?\b|Radeon HD|Radeon R[5-7] |Mali-[4T]|Adreno \(TM\) [1-5]\d\d|PowerVR/i;
const QMODE=QS.get('quality');
let LITE=QMODE==='lite'||(QMODE!=='full'&&(OLD_GPU.test(GPU_STR)||(navigator.hardwareConcurrency||8)<=2));
let LITE_WHY=QMODE==='lite'?'forced':LITE?'gpu: '+GPU_STR:'';
if(BT){BT.gpu=GPU_STR;BT.quality=LITE?'lite':'full';BT.qualityWhy=LITE_WHY;}
renderer.setPixelRatio(Math.min(devicePixelRatio,LITE?1.25:lowPower?1.5:1.75));     // capped: retina screens don't need 2x+ for this look
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;           // PCF with a blur radius: same soft look, cheaper than PCFSoft
if('outputColorSpace' in renderer)renderer.outputColorSpace=THREE.SRGBColorSpace;else renderer.outputEncoding=THREE.sRGBEncoding;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.localClippingEnabled=true;                        // the blender's liquid uses a clipping plane (blender stays at the origin)
const scene=new THREE.Scene();if(BENCH||/[?&]audit/.test(location.search))window.__scene=scene;
const cam=new THREE.PerspectiveCamera(32,1,0.1,120);

function brightEnv(){
  const s=new THREE.Scene();
  s.add(new THREE.Mesh(new THREE.SphereGeometry(20,32,16),new THREE.MeshBasicMaterial({color:0x8a7470,side:THREE.BackSide})));
  const box=(w,h,pos,k,col=0xffffff)=>{const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({color:new THREE.Color(col).multiplyScalar(k),side:THREE.DoubleSide}));m.position.set(...pos);m.lookAt(0,0,0);s.add(m);};
  box(10,4,[0,10,2],6);box(3,8,[-9,3,4],5);box(2,6,[9,2,-4],4,0xffd9c0);box(8,2,[0,-3,-10],2,0xffb0a0);box(6,3,[0,2,12],2.5);
  const pm=new THREE.PMREMGenerator(renderer),t=pm.fromScene(s,0.04).texture;pm.dispose();return t;
}
bmark('envStart');const envTex=brightEnv();scene.environment=envTex;
// KHR_parallel_shader_compile: programs compile on the driver's threads and three (patched, see vendor/three.module.js) skips a
// draw until its program is ready instead of blocking the main thread. The page shows the hero once all of its programs are ready.
const PSC=!QS.has('nopsc')&&renderer.getContext().getExtension('KHR_parallel_shader_compile');if(PSC)renderer.debug.parallelCompile=true;
if(BT)BT.parallelCompile=!!PSC;
const hemi=new THREE.HemisphereLight(0xfff4ee,0x8a6a60,0.6);scene.add(hemi);
const key=new THREE.DirectionalLight(0xfff1e4,1.7);key.castShadow=true;scene.add(key,key.target);   // key light + shadow box travel with the camera
key.shadow.mapSize.set(lowPower||LITE?1024:1536,lowPower||LITE?1024:1536);Object.assign(key.shadow.camera,{left:-6,right:6,top:8,bottom:-6,near:1,far:30});
key.shadow.bias=-0.0004;key.shadow.radius=4;
const KEY_OFF=new THREE.Vector3(2.5,12,4.5);
const fill=new THREE.DirectionalLight(0xffe0e6,0.5);fill.position.set(-7,3,5);scene.add(fill);
const KEY_C=new THREE.Color(0xfff1e4),KEY_W=new THREE.Color(0xffd9b8),RIM_C=new THREE.Color(0xffffff),RIM_W=new THREE.Color(0xff9a74),FILL_C=new THREE.Color(0xffe0e6),FILL_W=new THREE.Color(0xffc7b8);
const rimL=new THREE.DirectionalLight(0xffffff,0.7);rimL.position.set(-2,5,-8);scene.add(rimL);
const shadowPlane=y=>{const m=new THREE.Mesh(new THREE.PlaneGeometry(40,40),new THREE.ShadowMaterial({opacity:0.16,depthWrite:false}));
  m.rotation.x=-Math.PI/2;m.position.y=y;m.receiveShadow=true;scene.add(m);return m;};


/* ---------- world layout ---------- */
const Y_B=22;                                              // bowl table height
const LIPT=new THREE.Vector3(-5.4,6.2,0);                  // where the jar's pouring lip is held during the pour
const STREAM_ARC=0.2,GX=LIPT.x+0.04-STREAM_ARC,GY=-32.5;   // glass position (pushed lower so the 3D sits closer to the bottom edge of the screen)
const JB=BLENDER.jarBase,JAR_TOP=JB+BLENDER.jarH,LMAX=1.09,MIX=0.04;
const SHAKE_HEX=0xc2283f,STREAM_COL=lin(0xc63652),MILK_COL=lin(0xfbf7f1),MID_PINK=lin(0xee8fa3),SHAKE_COL_L=lin(SHAKE_HEX);   // deep strawberry milkshake pink

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
  // one program for every shake surface: the per-surface look (gradient, fleck scale, brightness) comes in as uniforms
  const U={value:new THREE.Vector4(+f1(y0),+f1(y1),+f1(scale),+f1(bright))},UG={value:grad?1:0};
  mat.customProgramCacheKey=()=>'shake';
  mat.onBeforeCompile=sh=>{withLP(sh);sh.uniforms.uShake=U;sh.uniforms.uShakeGrad=UG;
    sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nuniform vec4 uShake;\nuniform float uShakeGrad;')
    .replace('#include <color_fragment>',`#include <color_fragment>
    { float t=uShakeGrad>0.5?smoothstep(uShake.x,uShake.y,vLP.y):0.7;
      vec3 c=diffuseColor.rgb*mix(0.84,1.04,t)*uShake.w;                       // deeper towards the bottom
      float m=n3(vLP*3.5)*0.6+n3(vLP*8.0)*0.4; c*=0.92+0.16*m;                       // soft creamy marbling
      float s=n3(vLP*uShake.z); c=mix(c,c*vec3(0.55,0.32,0.36),smoothstep(0.8,0.9,s)*0.5);   // tiny crushed-berry flecks
      float sd=n3(vLP*80.0+3.7); c=mix(c,vec3(0.36,0.2,0.05),smoothstep(0.91,0.95,sd)*0.45);    // seeds
      float fz=n3(vLP*46.0+9.1); c=mix(c,c*1.3+vec3(0.07,0.05,0.05),smoothstep(0.84,0.93,fz)*0.55*uShakeGrad);   // frosty ice glints (glass)
      diffuseColor.rgb=c; }`)
    .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
    { float fr=pow(1.0-clamp(abs(dot(normal,normalize(vViewPosition))),0.0,1.0),2.2);  // light scattering through the rim
      diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(1.25,1.4,1.35)+vec3(0.03,0.015,0.02),fr*0.35); }`);};
  mat.needsUpdate=true;
}
// lite: the same material object (every reference in the code stays valid), compiled without PHYSICAL (no clearcoat); the coat's
// gloss is folded into the base roughness / environment strength so it reads nearly the same
const liteDone=new WeakSet();
function liteMat(m){if(!m||!m.isMeshPhysicalMaterial||liteDone.has(m))return;liteDone.add(m);
  const cc=m.clearcoat||0;if(cc>0){m.roughness=lerp(m.roughness,Math.min(m.roughness,m.clearcoatRoughness),0.35*cc);m.envMapIntensity*=1+0.25*cc;}
  m.defines={STANDARD:''};m.needsUpdate=true;}
function liteify(root,skip){let n=0;root.traverse(o=>{if(!o.material)return;(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{if(!(skip&&skip.has(m))&&!liteDone.has(m)&&m.isMeshPhysicalMaterial){liteMat(m);n++;}});});return n;}
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
bmark('bowlStart');const bowl=createBowl(),BH=bowl.userData,BR=BH.topRadius,BHt=BH.height;
const pivot=new THREE.Group();pivot.position.set(0,Y_B+BHt,0);scene.add(pivot);    // pivot = front rim, straight above the blender
pivot.add(bowl);bowl.position.set(0,-BHt,-BR);                                     // bowl centre sits 1.5 behind the pivot
const bowlShadow=shadowPlane(Y_B);
const PIV=pivot.position.clone(),XA=new THREE.Vector3(1,0,0),ONE=new THREE.Vector3(1,1,1);
const Moff=new THREE.Matrix4().makeTranslation(0,-BHt,-BR);
const tiltOf=P=>rad(128)*sm((P-0.26)/0.46);                // starts tipping with the very first scroll
const _M2=new THREE.Matrix4(),_dp=new THREE.Vector3(),_dqq=new THREE.Quaternion(),_M=new THREE.Matrix4(),_v=new THREE.Vector3(),_q=new THREE.Quaternion(),_q2=new THREE.Quaternion(),_e=new THREE.Euler();
const bowlWorld=(out,th)=>out.compose(PIV,_q.setFromAxisAngle(XA,th),ONE).multiply(Moff);

/* Performance: a strawberry is built from ~18 meshes (body, seeds, 5 water drops, 9 leaves, cap, stem).
   Merge the small parts so each berry costs 4 draw calls (body, seeds, drops, green parts) and share materials. */
const GREEN_MAT=new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.56,side:THREE.DoubleSide});
function mergeMeshes(meshes,relTo,withColor){
  let nv=0,ni=0;const parts=[];const inv=new THREE.Matrix4().copy(relTo.matrixWorld).invert(),M=new THREE.Matrix4(),NM=new THREE.Matrix3(),v=new THREE.Vector3(),c=new THREE.Color();
  for(const o of meshes){const g=o.geometry,cnt=g.attributes.position.count;parts.push([o,g,nv]);nv+=cnt;ni+=g.index?g.index.count:cnt;}
  const pos=new Float32Array(nv*3),nor=new Float32Array(nv*3),col=withColor?new Float32Array(nv*3):null,idx=new (nv>65535?Uint32Array:Uint16Array)(ni);let io=0;
  for(const [o,g,base] of parts){M.multiplyMatrices(inv,o.matrixWorld);NM.getNormalMatrix(M);
    const P=g.attributes.position,Nn=g.attributes.normal,C=g.attributes.color;if(!C&&withColor)c.copy(o.material.color);
    for(let i=0;i<P.count;i++){v.fromBufferAttribute(P,i).applyMatrix4(M);pos.set([v.x,v.y,v.z],(base+i)*3);
      v.fromBufferAttribute(Nn,i).applyMatrix3(NM).normalize();nor.set([v.x,v.y,v.z],(base+i)*3);
      if(withColor){if(C)col.set([C.getX(i),C.getY(i),C.getZ(i)],(base+i)*3);else col.set([c.r,c.g,c.b],(base+i)*3);}}
    if(g.index){const I=g.index.array;for(let i=0;i<I.length;i++)idx[io++]=I[i]+base;}else for(let i=0;i<P.count;i++)idx[io++]=base+i;}
  const out=new THREE.BufferGeometry();out.setAttribute('position',new THREE.BufferAttribute(pos,3));out.setAttribute('normal',new THREE.BufferAttribute(nor,3));
  if(col)out.setAttribute('color',new THREE.BufferAttribute(col,3));out.setIndex(new THREE.BufferAttribute(idx,1));out.computeBoundingSphere();return out;}
function compactBerry(root){
  const g=root.children[0];root.updateMatrixWorld(true);
  const body=root.userData.mesh,drops=[],green=[];
  g.traverse(o=>{if(!o.isMesh||o===body||o.isInstancedMesh)return;if(o.material.transparent)drops.push(o);else green.push(o);});
  const dm=drops.length?new THREE.Mesh(mergeMeshes(drops,g,false),drops[0].material):null,gm=new THREE.Mesh(mergeMeshes(green,g,true),GREEN_MAT);
  [...drops,...green].forEach(o=>{o.parent.remove(o);o.geometry.dispose&&o.geometry!==drops[0]?.geometry&&o.geometry.dispose();});
  g.children.filter(o=>!o.isMesh).forEach(o=>g.remove(o));       // empty leaf pivots
  g.children.forEach(o=>{if(o.isInstancedMesh)o.frustumCulled=true;});   // seeds: the unit-sphere bounds cover the berry
  if(dm)g.add(dm);g.add(gm);return root;}
/* v14: shared berry prototypes + instancing. Every berry is a light clone of one of a few prototypes (geometry and materials
   shared, scaled to its own size). The clones stay in the scene graph as invisible proxies (physics, poses, audits use them);
   INST draws them: one InstancedMesh per prototype part, its instance matrices copied from the proxies every frame. */
function seedsToMesh(im){const g=im.geometry,n=im.count,P=g.attributes.position,Nn=g.attributes.normal,cnt=P.count,M=new THREE.Matrix4(),NM=new THREE.Matrix3(),v=new THREE.Vector3();
  const I=g.index?g.index.array:null,ni=I?I.length:cnt,pos=new Float32Array(n*cnt*3),nor=new Float32Array(n*cnt*3),idx=new (n*cnt>65535?Uint32Array:Uint16Array)(n*ni);
  for(let k=0;k<n;k++){im.getMatrixAt(k,M);NM.getNormalMatrix(M);
    for(let i=0;i<cnt;i++){v.fromBufferAttribute(P,i).applyMatrix4(M);pos.set([v.x,v.y,v.z],(k*cnt+i)*3);v.fromBufferAttribute(Nn,i).applyMatrix3(NM).normalize();nor.set([v.x,v.y,v.z],(k*cnt+i)*3);}
    for(let j=0;j<ni;j++)idx[k*ni+j]=(I?I[j]:j)+k*cnt;}
  const out=new THREE.BufferGeometry();out.setAttribute('position',new THREE.BufferAttribute(pos,3));out.setAttribute('normal',new THREE.BufferAttribute(nor,3));
  out.setIndex(new THREE.BufferAttribute(idx,1));out.computeBoundingSphere();
  const m=new THREE.Mesh(out,im.material);m.position.copy(im.position);m.quaternion.copy(im.quaternion);m.scale.copy(im.scale);m.castShadow=im.castShadow;return m;}
function protoBerry(opts){const b=compactBerry(createStrawberry(opts)),g=b.children[0];
  g.children.filter(o=>o.isInstancedMesh).forEach(im=>{g.add(seedsToMesh(im));g.remove(im);});return b;}
function cloneBerry(proto,size){const ud=proto.userData;proto.userData={};const c=proto.clone(true);proto.userData=ud;   // (Object3D.copy JSON-copies userData)
  const bi=proto.children[0].children.indexOf(ud.mesh);c.userData={size,mesh:c.children[0].children[bi]};c.scale.setScalar(size/ud.size);return c;}
const INST=(()=>{const groups=new Map(),list=[];
  const vis=o=>{for(let p=o.parent;p;p=p.parent){if(!p.visible)return false;if(p===scene)return true;}return false;};
  return {
    add(root){root.traverse(o=>{if(!o.isMesh||o.isInstancedMesh||o.userData.inst)return;const key=o.geometry.uuid+'/'+o.material.uuid;let G=groups.get(key);
      if(!G){G={items:[],im:null};groups.set(key,G);}G.items.push(o);o.userData.inst=true;});},
    build(){for(const G of groups.values()){if(G.im)continue;const o=G.items[0],im=new THREE.InstancedMesh(o.geometry,o.material,G.items.length);
      im.castShadow=o.castShadow;im.receiveShadow=o.receiveShadow;im.renderOrder=o.renderOrder;im.frustumCulled=false;im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.name='inst';G.im=im;scene.add(im);G.items.forEach(x=>{x.visible=false;});list.push(G);}},
    sync(){for(const G of list){const a=G.im.instanceMatrix.array;let any=0;
      for(let i=0;i<G.items.length;i++){const o=G.items[i];if(vis(o)){o.matrixWorld.toArray(a,i*16);any++;}else a.fill(0,i*16,i*16+16);}
      G.im.visible=any>0;G.im.instanceMatrix.needsUpdate=true;}},
    stats:()=>({groups:list.length,instances:list.reduce((s,G)=>s+G.items.length,0)})};})();
scene.autoUpdate=false;
function renderNow(){scene.updateMatrixWorld();INST.sync();renderer.render(scene,cam);}

// heap: berries packed in layers, every one kept inside the bowl's inner wall (with a margin for the berry's own radius)
const FOOT=0.6,WALL=0.07;
const innerR=y=>{const s=clamp((y-0.12)/(BHt-0.12));return FOOT*0.8+(BR-WALL-FOOT*0.8)*(1-Math.pow(1-s,1.7));};
const MARGIN=0.3;
const maxR=y=>y<=BHt?innerR(Math.max(0.12,y-0.22))-MARGIN:Math.min(innerR(BHt-0.02)-MARGIN,1.1-(y-BHt)*1.5);
const berries=[],up=new THREE.Vector3(0,1,0),dir=new THREE.Vector3();
let seed=1;const BPROTO=new Array(9).fill(null),BERRY_N=84;   // must match sims.bin bake (changing this forces a live physics sim that can hang the tab)

bmark('berriesStart');for(const ly of[0.98,1.18,1.36,1.52,1.66,0,0,0,0,0,0]){if(!ly&&berries.length>=BERRY_N)break;
  let rr=ly?maxR(ly):0.9,ring=0;
  while(rr>-0.01){
    const n=!ly?Math.min(BERRY_N-berries.length,Math.floor(2*Math.PI*rr/0.44)):rr<0.16?1:Math.floor(2*Math.PI*rr/0.44),off=R()*6.283;
    for(let i=0;i<n;i++){
      const a=off+i/n*6.283+(R()-0.5)*0.12,r=n===1?0:rr-R()*0.04,y=ly+(R()-0.5)*0.05,size=0.42*(0.9+R()*0.15);
      dir.set(Math.cos(a)*0.3+(R()-0.5)*0.3,1,Math.sin(a)*0.3+(R()-0.5)*0.3).normalize();
      const tmp=new THREE.Object3D();tmp.quaternion.setFromUnitVectors(up,dir);tmp.rotateY(R()*6.283);
      tmp.position.set(Math.cos(a)*r,y,Math.sin(a)*r);tmp.updateMatrix();
      const pk=(seed++-1)%BPROTO.length,b=cloneBerry(BPROTO[pk]||(BPROTO[pk]=protoBerry({size:0.42,seed:pk+1,detail:0.5})),size),h=new THREE.Group();b.position.y=-0.5*size;h.add(b);scene.add(h);
      if(berries.length%6===5)await new Promise(r=>setTimeout(r,0));   // yield: no single long task while the berries are built
      berries.push({h,body:b.userData.mesh,size,L:tmp.matrix.clone(),spin:new THREE.Vector3((R()-0.5)*14,(R()-0.5)*14,(R()-0.5)*14),gk:1+R()*0.08,rnd:R()});
    }
    if(n===1)break;rr-=0.43;ring++;
  }
}
const LAND_SCALE_=0.64;   // v14: 77 landers (50 in v13): a little smaller in the jar so it fills to the same height
const N=berries.length;
// Collision shapes taken from the real meshes:
//  - each berry: ~60 support points of its own body + leaf geometry (its convex hull), in the berry's frame
//  - the bowl: the exact lathe cross-section the bowl mesh is built from, plus the gold rim bead
function buildShapes(){for(const f of berries){const h=f.h;h.position.set(0,0,0);h.quaternion.identity();h.scale.setScalar(1);h.updateMatrixWorld(true);
  const pts=[],v=new THREE.Vector3();
  h.traverse(o=>{if(!o.isMesh||o.isInstancedMesh)return;const p=o.geometry.attributes.position;   // body, water drops, leaves, cap, stem
    for(let k=0;k<p.count;k++){v.fromBufferAttribute(p,k).applyMatrix4(o.matrixWorld);pts.push(v.x,v.y,v.z);}});
  const H=hullOf(pts,320);f.hull=H.pts;f.hullR=H.R;
  // contact shape for berry vs berry: 5 spheres along the berry's axis, each inscribed in the visual body mesh
  {const bp=f.body.geometry.attributes.position,M=f.body.matrixWorld,B=[];for(let k=0;k<bp.count;k++){v.fromBufferAttribute(bp,k).applyMatrix4(M);B.push(v.x,v.y,v.z);}
    let y0=1e9,y1=-1e9;for(let k=1;k<B.length;k+=3){y0=Math.min(y0,B[k]);y1=Math.max(y1,B[k]);}
    const C=[];for(const t of [0.2,0.34,0.48,0.62,0.76]){const yc=y0+(y1-y0)*t;let sx=0,sz=0,n=0;
      for(let k=0;k<B.length;k+=3)if(Math.abs(B[k+1]-yc)<(y1-y0)*0.06){sx+=B[k];sz+=B[k+2];n++;}
      const xc=n?sx/n:0,zc=n?sz/n:0;let r=1e9;for(let k=0;k<B.length;k+=3){const dx=B[k]-xc,dy=B[k+1]-yc,dz=B[k+2]-zc;r=Math.min(r,dx*dx+dy*dy+dz*dz);}
      C.push(xc,yc,zc,Math.sqrt(r)*0.99);}
    f.comp=new Float64Array(C);}}}
// shape signature of the scene the bake was made for (berry sizes, seeds, placements and the bowl/jar geometry): a stale bake is ignored
const BAKE_SIG=(()=>{let s=[N,BHt,BR,BLENDER.jarH,BLENDER.jarBase,jarInner(1),jarOuter(1),LAND_SCALE_].join(',');
  berries.forEach(f=>{s+='|'+[f.size,f.rnd,f.gk,f.spin.x,f.spin.y,f.spin.z,...f.L.elements].map(x=>x.toFixed(6)).join(',');});
  s+='|'+JSON.stringify(BH.profile)+JSON.stringify(BH.rimBead);
  let h=0x811c9dc5;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}return h.toString(16);})();
bmark('bakeWait');let BAKED=await bakeP;bmark('bakeReady');
if(BAKED&&(BAKED.v!==BAKE_V||BAKED.sig!==BAKE_SIG)){console.info('Maleda: sims.bin is stale, running the physics live');BAKED=null;}
if(BT)BT.baked=!!BAKED;
if(!BAKED||AUDIT)buildShapes();else berries.forEach((f,i)=>{f.hullR=BAKED.hullR[i];});

const BERRY_R=f=>0.56*f.size;            // berry vs berry contact sphere (the bowl/jar contact uses the hull)
bmark('physicsStart');let _bowlShell=null;const bowlShell=()=>_bowlShell||(_bowlShell=makeShell({poly:BH.profile,circles:[BH.rimBead],rings:[BH.rimBead],rmax:1.95,ymin:-0.45,ymax:1.5,res:0.007}));
// hero intro: a real physics drop. Every berry spawns over the bowl opening at its own height and time, with its own sideways
// nudge and tumble, then collides with the bowl and the other berries, bounces, rolls and settles. Simulated once and played back.
const _t0=performance.now();
const DROP=BAKED?BAKED.DROP:(()=>{const IR=RNG(4242),rim=innerR(BHt),spawns=berries.map(f=>{
    const r=BERRY_R(f),a=IR()*6.283,u_=IR(),t=0.25+2.4*IR(),rr=(rim-f.hullR-0.12)*Math.sqrt(u_)*(1-0.75*Math.pow((t-0.25)/2.4,0.7)),   // later berries drop nearer the middle: a heap over the rim
     q=new THREE.Quaternion().setFromRotationMatrix(f.L);
    return {t,p:[Math.cos(a)*rr,BHt+(4.8+IR()*4.4)*(1-0.45*(t-0.25)/2.4),Math.sin(a)*rr],v:[(IR()-0.5)*0.7,-IR()*1.5,(IR()-0.5)*0.7],q:[q.x,q.y,q.z,q.w],
      w:[(IR()-0.5)*14,(IR()-0.5)*14,(IR()-0.5)*14]};});
  if(AUDIT)window.__dropInputs={poly:BH.profile,bead:BH.rimBead,hulls:berries.map(f=>[...f.hull]),radii:berries.map(BERRY_R),spawns,guard:{rimY:BHt,rimR:rim}};
  const res=simulateBodies({shell:bowlShell(),hulls:berries.map(f=>f.hull),radii:berries.map(BERRY_R),compounds:berries.map(f=>f.comp),spawns,guard:{rimY:BHt,rimR:rim},
    maxT:9,margin:0.004,sleepRest:0.6,sleepSpeed:0.03,settleGrace:3.5,iters:8,muB:0.9,restitution:0.12});
  res.spawnT=spawns.map(s=>s.t);return res;})();
berries.forEach((f,i)=>{const F=DROP.fin[i];f.L.compose(_v.set(...F.p),_q.set(...F.q),ONE);});
const _dq=new THREE.Quaternion();
function recPose(S,N_,i,t,pos,quat){const fr=Math.min(S.frames-1.001,Math.max(0,t)*S.recHz),a=Math.floor(fr),u=fr-a,N7=N_*7,ka=a*N7+i*7,kb=ka+N7,r=S.rec;
  pos.set(r[ka]+(r[kb]-r[ka])*u,r[ka+1]+(r[kb+1]-r[ka+1])*u,r[ka+2]+(r[kb+2]-r[ka+2])*u);
  quat.set(r[ka+3],r[ka+4],r[ka+5],r[ka+6]);_dq.set(r[kb+3],r[kb+4],r[kb+5],r[kb+6]);quat.slerp(_dq,u);}
function dropPose(i,tau,pos,quat){if(tau<DROP.spawnT[i])return false;recPose(DROP,N,i,tau,pos,quat);return true;}   // bowl-local
const DROP_END=DROP.frames/DROP.recHz;
{const bm=bowl.children[0].material;bm.clearcoat=0.3;bm.clearcoatRoughness=0.3;bm.roughness=0.45;bm.envMapIntensity=0.5;
  bowl.children[1].material.envMapIntensity=0.55;
  {let shared=null;berries.forEach(f=>f.h.traverse(o=>{if(o.isMesh&&o.material.isMeshPhysicalMaterial&&o.material.vertexColors){if(!shared){shared=o.material;shared.envMapIntensity=0.6;shared.clearcoat=0.5;shared.clearcoatRoughness=0.14;}else{o.material.dispose();o.material=shared;}}}));}}
berries.forEach(f=>INST.add(f.h));INST.build();
/* Tipping the bowl: a second physics run in the bowl's own frame, starting from the settled pile. As the bowl tips (scroll),
   gravity turns in that frame, so the berries slide and tumble toward the front rim and spill over it, colliding with the bowl
   (its real inner wall, rim and outer wall) and each other the whole way. Sim time is tied to scroll: t = (P - TIP_P0) * TIP_TS.
   A berry is handed over to the straight fall only once it is fully in front of the rim's vertical plane, where nothing of the
   bowl can be below it at any tilt, so a falling berry can never pass through the bowl. */
const TIP_P0=0.26,TIP_P1=1.05,TIP_TS=2.6;
const TIP=BAKED?BAKED.TIP:(()=>{const spawns=berries.map((f,i)=>({t:0,p:DROP.fin[i].p,v:[0,0,0],q:DROP.fin[i].q,w:[0,0,0]}));
  const thAt=t=>tiltOf(TIP_P0+t/TIP_TS);
  return simulateBodies({shell:bowlShell(),hulls:berries.map(f=>f.hull),radii:berries.map(BERRY_R),compounds:berries.map(f=>f.comp),spawns,maxT:(TIP_P1-TIP_P0)*TIP_TS,
    settleDelay:1e9,stopWhenSettled:false,allowSleep:false,staticDamp:false,restitution:0.1,friction:0.08,coulomb:0.3,
    gravity:(t,gv)=>{const th=thAt(t);gv[0]=0;gv[1]=-42*Math.cos(th);gv[2]=42*Math.sin(th);},
    release:(i,x,y,z,t)=>{const r=berries[i].hullR+0.05,P_=TIP_P0+t/TIP_TS;
      // clear to fall straight down? the whole vertical line under the berry must miss the bowl, now and as the bowl keeps tipping
      for(let s=0;s<=16;s++){const th=tiltOf(s<16?P_+s*0.01:9);const c=Math.cos(th),sn=Math.sin(th);
        const yw=(y-BHt)*c-(z-BR)*sn,zw=(y-BHt)*sn+(z-BR)*c;          // berry centre relative to the pivot, world axes
        for(let d=0;d<3.2;d+=0.03){const Y=yw-d,ly=Y*c+zw*sn+BHt,lz=-Y*sn+zw*c+BR;if(bowlShell().query(Math.hypot(x,lz),ly).d<r)return false;}}
      return true;}});})();
const SIM_MS=performance.now()-_t0;
function tipPose(i,P,pos,quat){recPose(TIP,N,i,(P-TIP_P0)*TIP_TS,pos,quat);}
// straight fall after the hand-over: starts at the berry's own speed v0 and eases to the story's fall speed G (both per unit of P)
const UT=0.3,fallF=u=>u<=0?0:u<UT?u*u/(2*UT):u-UT/2;          // (camera path)
const fallY=(f,u)=>{if(u<=0)return 0;const g=f.g,e=1-Math.exp(-u/UT);return g*u+(f.v0-g)*UT*e;};
const _rq=new THREE.Quaternion(),_rv=new THREE.Vector3();
berries.forEach((f,i)=>{const R=TIP.rel[i];
  const tr=R?R.t:(TIP.frames-1)/TIP.recHz;f.Pr=TIP_P0+tr/TIP_TS;
  const th=tiltOf(f.Pr);
  if(R){_M.compose(_v.set(...R.p),_rq.set(...R.q),ONE);}else{recPose(TIP,N,i,tr,_v,_rq);_M.compose(_v,_rq,ONE);}
  bowlWorld(_M2,th).multiply(_M);f.R=new THREE.Vector3();f.Rq=new THREE.Quaternion();_M2.decompose(f.R,f.Rq,_v);
  _rv.set(...(R?R.v:[0,0,0])).applyAxisAngle(XA,th);f.v0=Math.max(0,-_rv.y)*TIP_TS;   // world downward speed, per unit of P
  f.clearY=PIV.y-1.12-f.hullR;});          // below this height nothing of the bowl can be beside the berry: only then drift sideways
// all but three berries land in the blender jar; three from the middle of the stream miss it and fall past the front of the
// blender (well clear of the base, the panel and the milk jug, which stands at x=+2.5 to the right)
{const byP=[...berries].sort((a,b)=>a.Pr-b.Pr),miss=new Set([0.3,0.58,0.84].map(t=>byP[Math.round(t*(N-1))]));
  berries.forEach(f=>{f.land=!miss.has(f);});}
let landers=[];
berries.forEach(f=>{if(f.land)landers.push(f);else f.zT=1.8+f.rnd*0.3;});
// Fall speed: the last berry reaches the jar around P=2.32, so the scroll pacing is unchanged.
const LAYERS=[...Array(11)].map((_,k)=>({h:0.28+k*0.2,n:0}));
landers.sort((a,b)=>a.Pr-b.Pr).forEach(f=>{
  const L=LAYERS.find(l=>l.n<6&&jarInner(l.h)-0.2>Math.abs(f.R.x)+0.02)||LAYERS[LAYERS.length-1];L.n++;f.Ey=JB+L.h;});
// every berry gets its own fall speed g so the stream reaches the jar in release order between P=1.96 and 2.16,
// i.e. before the milk pitcher lifts (P 2.16) and swings over the jar: nothing can fall onto or through the pitcher
let G=0;{const bySt=[...berries].sort((a,b)=>a.Pr-b.Pr);bySt.forEach((f,k)=>{const T=1.96+0.2*k/(N-1)+(f.rnd-0.5)*0.02,u=T-f.Pr,e=1-Math.exp(-u/UT),
  D=f.R.y-(f.land?f.Ey:JB+0.6);f.v0=Math.min(f.v0,(D/u)*0.9);f.g=(D-f.v0*UT*e)/(u-UT*e);G+=f.g/N;});}
const fallU=(f,D)=>{let lo=0,hi=8;for(let k=0;k<50;k++){const mid=(lo+hi)/2;if(fallY(f,mid)<D)lo=mid;else hi=mid;}return (lo+hi)/2;};
/* Blender landing: the same solver. Each lander falls straight down until it reaches the jar opening; from there it collides
   with the jar's real inner wall and floor (and the blade hub) through its hull, and with the other berries, with a small
   sideways jitter on entry so they tumble and spread across the jar. Sim time: t = (P - P_A) * TS seconds. */
const LAND_SCALE=LAND_SCALE_,YE=JAR_TOP+0.35;
const jarShell=()=>{const poly=[[0,0.34],[0.1,0.33],[0.15,0.24],[0.19,0.13]];
  for(let i=0;i<=30;i++){const h=0.13+(2-0.13)*i/30;poly.push([jarInner(h),h]);}
  for(let i=30;i>=0;i--){const h=2*i/30;poly.push([jarOuter(h),h]);}poly.push([0,0]);
  return makeShell({poly,rmax:1.4,ymin:-0.45,ymax:2.45,res:0.008});};
const JAR=(()=>{const IR=RNG(777),TS=G/6.5,spawns=[],radii=[],hulls=[];let PA=1e9;   // (the lander set-up below always runs: the fall uses it)
  landers.forEach(f=>{
    const a=f.rnd*40.0,rr=0.48*Math.sqrt((f.rnd*7.31)%1);   // wider stream
    f.x0=f.R.x*0.5+Math.cos(a)*rr;f.zT=Math.sin(a)*rr;
    f.uE=fallU(f,f.R.y-YE);f.PE=f.Pr+f.uE;PA=Math.min(PA,f.PE);});
  PA-=0.002;
  if(BAKED){const J_=BAKED.JAR;if(Math.abs(J_.PA-PA)>1e-9||Math.abs(J_.TS-TS)>1e-9)console.warn('Maleda: baked jar timing differs',J_.PA,PA);return J_;}
  landers.forEach(f=>{const g=f.g,vy=(g+(f.v0-g)*Math.exp(-f.uE/UT))/TS;
    _q2.setFromEuler(_e.set(f.spin.x*f.uE,f.spin.y*f.uE,f.spin.z*f.uE));const q=f.Rq.clone().multiply(_q2);
    const ja=IR()*6.283,js=1.2+IR()*1.6;        // lateral jitter (sim units / s)
    spawns.push({t:(f.PE-PA)*TS,p:[f.x0,YE-JB,f.zT],v:[Math.cos(ja)*js,-vy,Math.sin(ja)*js],q:[q.x,q.y,q.z,q.w],
      w:[f.spin.x/TS,f.spin.y/TS,f.spin.z/TS]});radii.push(BERRY_R(f)*LAND_SCALE);hulls.push(f.hull.map(x=>x*LAND_SCALE));});
  const maxT=(2.705-PA)*TS;
  const res=simulateBodies({shell:jarShell(),hulls,radii,compounds:landers.map(f=>f.comp.map(x=>x*LAND_SCALE)),spawns,guard:{rimY:BLENDER.jarH,rimR:jarInner(BLENDER.jarH)},maxT,restitution:0.3,friction:0.18,
    settleDelay:0.35,settleRate:90,hz:720});
  res.PA=PA;res.TS=TS;res.maxT=maxT;return res;})();
landers.forEach((f,k)=>{f.k=k;const F=JAR.fin[k];f.E=new THREE.Vector3(F.p[0],F.p[1]+JB,F.p[2]);f.Eq=new THREE.Quaternion(...F.q);
  f.r0=Math.hypot(f.E.x,f.E.z);f.a0=Math.atan2(f.E.z,f.E.x);});
const NL=landers.length;bmark('physicsEnd');
if(BAKE_MODE)window.__bake=encodeBake({v:BAKE_V,sig:BAKE_SIG,hullR:berries.map(f=>f.hullR)},{DROP,TIP,JAR},[N,N,NL]);
function jarPoseOf(k,P,pos,quat){recPose(JAR,NL,k,(P-JAR.PA)*JAR.TS,pos,quat);pos.y+=JB;}   // world (the jar sits at the origin until P>2.9)


/* sims.bin codec. Layout (before gzip): 'MLD2', u32 meta length, meta JSON (everything but the recordings, exact doubles), padding
   to 4, then each recording: float32 frames, stored per channel as the XOR of consecutive frames' bits, split into byte planes
   (lossless, and a resting berry turns into long runs of zeros, which gzip squeezes to almost nothing). */
function encodeBake(meta,sims,ns){meta={...meta,sims:{}};const blobs=[];let off=0;
  Object.entries(sims).forEach(([k,S],si)=>{const F=S.frames,C=ns[si]*7,u=new Uint32Array(S.rec.buffer,S.rec.byteOffset,S.rec.length),x=new Uint32Array(u.length);let o=0;
    for(let c=0;c<C;c++){let prev=0;for(let f=0;f<F;f++){const w=u[f*C+c];x[o++]=(w^prev)>>>0;prev=w;}}
    const b=new Uint8Array(x.buffer),n=x.length,sh=new Uint8Array(n*4);for(let j=0;j<4;j++)for(let i=0;i<n;i++)sh[j*n+i]=b[i*4+j];
    const {rec,...m}=S;meta.sims[k]={...m,n:ns[si],off,len:sh.length};off+=sh.length;blobs.push(sh);});
  const mj=new TextEncoder().encode(JSON.stringify(meta)),head=8+mj.length,pad=(4-head%4)%4,out=new Uint8Array(head+pad+off);
  out.set([77,76,68,50]);new DataView(out.buffer).setUint32(4,mj.length,true);out.set(mj,8);let p=head+pad;blobs.forEach(b=>{out.set(b,p);p+=b.length;});return out;}
function decodeBake(buf){const a=new Uint8Array(buf);if(a[0]!==77||a[1]!==76||a[2]!==68||a[3]!==50)throw new Error('bad sims.bin');
  const ml=new DataView(buf).getUint32(4,true),meta=JSON.parse(new TextDecoder().decode(a.subarray(8,8+ml))),base=8+ml+(4-(8+ml)%4)%4;
  for(const [k,m] of Object.entries(meta.sims)){const F=m.frames,C=m.n*7,n=F*C,sh=a.subarray(base+m.off,base+m.off+m.len),x=new Uint8Array(n*4);
    for(let j=0;j<4;j++){const pl=sh.subarray(j*n,(j+1)*n);for(let i=0;i<n;i++)x[i*4+j]=pl[i];}
    const w=new Uint32Array(x.buffer),u=new Uint32Array(n);let o=0;
    for(let c=0;c<C;c++){let prev=0;for(let f=0;f<F;f++){prev=(w[o++]^prev)>>>0;u[f*C+c]=prev;}}
    const {n:_n,off,len,...rest}=m;meta[k]={...rest,rec:new Float32Array(u.buffer)};}
  delete meta.sims;return meta;}

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
  if(P>2.9&&LATE){jarPoseAt(P);const s=sm((P-2.91)/0.06);x=lerp(0,JC.x,s);y=lerp(y,JC.y,s);    // rise with the jar (base drops out below), then slide with it
    if(P>3.18){x=lerp(JC.x,LIPT.x,sm((P-3.18)/0.3));y=lerp(JC.y,GY+2.2,sm((P-3.18)/0.84));}}   // then ride the stream down
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

let INTRO_FREEZE=parseFloat(new URLSearchParams(location.search).get('intro')??'-1');   // ?intro=1.2 freezes the hero drop at that second (for stills)
let heroStart=-1,heroDone=false,lastA=-1,LATE=false,shown=false;const clock=new THREE.Clock();let time=0;
const LIP=new THREE.Vector3(),PLIP=new THREE.Vector3(),TO=new THREE.Vector3(),FROM=new THREE.Vector3(),_w=new THREE.Vector3();

function apply(P,A,warm=false){
  /* ---- lights: soft and rich on the bowl and on the blender ---- */
  const gl=sm((P-3.7)/0.3)*0.35,hero=1-sm((P-0.55)/0.4),bld=sm((P-1.8)/0.3)*(1-sm((P-3.05)/0.2)),dim=Math.max(hero,bld,gl);
  renderer.toneMappingExposure=lerp(1.0,0.68,dim);key.intensity=lerp(1.7,0.85,dim);hemi.intensity=lerp(0.6,0.24,dim);fill.intensity=lerp(0.5,0.18,dim);rimL.intensity=lerp(0.7,0.32,dim);
  {const wg=sm((P-3.7)/0.4);key.color.copy(KEY_C).lerp(KEY_W,wg);rimL.color.copy(RIM_C).lerp(RIM_W,wg);fill.color.copy(FILL_C).lerp(FILL_W,wg);   // the glass: warm and dramatic
    rimL.intensity+=1.4*wg;hemi.intensity*=1-0.4*wg;fill.intensity*=1-0.25*wg;key.intensity*=1+0.1*wg;}

  /* ---- bowl ---- */
  if(P>0.27)heroDone=true;
  const tau=heroDone?1e9:(INTRO_FREEZE>=0?INTRO_FREEZE:heroStart<0?0:Math.max(0,time-heroStart));
  const th=tiltOf(P),intro=-0.35*(1-sm(tau/0.7));
  pivot.visible=bowlShadow.visible=P<1.05;
  pivot.position.set(PIV.x,PIV.y+intro,PIV.z);pivot.rotation.x=th;

  /* ---- berries: bowl -> straight fall -> jar (or past it) -> blended away ---- */
  const bl=clamp((P-2.71)/0.48),b=sm(bl);   // longer blend so berries stay visible while spinning
  berries.forEach((f,i)=>{
    const h=f.h;
    if(P<f.Pr){                                // in the bowl: settled pile, or the tipping sim (bowl-local), or the hero drop
      if(P<TIP_P0)_M.copy(f.L);else{tipPose(i,P,_dp,_dqq);_M.compose(_dp,_dqq,ONE);}
      bowlWorld(_M2,th).multiply(_M);_M2.decompose(h.position,h.quaternion,_v);h.visible=true;
      if(!heroDone&&tau<DROP_END){const on=dropPose(i,tau,_dp,_dqq);h.visible=on;
        if(on){_M.compose(_dp,_dqq,ONE);bowlWorld(_M2,th).multiply(_M);_M2.decompose(h.position,h.quaternion,_v);}}
      h.position.y+=intro;h.scale.setScalar(1);return;
    }
    const u=P-f.Pr;
    if(f.land&&P>=f.PE){                       // inside the jar: the collision sim (then the blend)
      jarPoseOf(f.k,P,h.position,h.quaternion);
      if(bl>0){const ramp=sm(Math.min(1,bl*3.2)),an=f.a0+bl*18*(1+0.06*(i%7)),r=f.r0*(1-0.4*b);
        h.position.set(lerp(f.E.x,Math.cos(an)*r,ramp),f.E.y+ramp*0.32*Math.sin(bl*28+i*1.3)*(1-b)-sm(bl*1.4)*Math.max(0,f.E.y-JB-0.45)*0.75,lerp(f.E.z,Math.sin(an)*r,ramp));
        _q2.setFromEuler(_e.set(bl*9,bl*5,bl*2));h.quaternion.copy(f.Eq).multiply(_q2);}
      // shrink late in the blend so chunks read as fruit, then puree
      h.scale.setScalar(LAND_SCALE*(1-0.92*Math.pow(Math.max(0,bl-0.35)/0.65,1.6)));
    }else{                                     // straight fall from the bowl's lip
      const y=f.R.y-fallY(f,u);
      // delay the sideways slide so they fall straight at first, then fan out gently to the wider target
      const cl=Math.pow(sm((f.clearY-y)/1.4),1.6);
      h.position.set(f.land?lerp(f.R.x,f.x0,cl):f.R.x,y,lerp(f.R.z,f.zT,cl));
      _q2.setFromEuler(_e.set(f.spin.x*u,f.spin.y*u,f.spin.z*u));h.quaternion.copy(f.Rq).multiply(_q2);
      h.scale.setScalar(f.land?lerp(1,LAND_SCALE,sm(u/f.uE)):1);
    }
    h.visible=f.land?(bl<0.97&&P<3.35):h.position.y>-9;
  });

  /* ---- later sections: built in idle time after the hero is on screen ---- */
  if(LATE){
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
    BL.setMixNow(lerp(1,MIX,sm(Math.max(0,b-0.25)/0.75)));
    if(P<2.92){BL.resetPose();const L=0.14+0.5*pourLvl+(LMAX-0.64)*sm(Math.max(0,b-0.2)/0.8);if(L>0.17)BL.setLiquid(L);else BL.setVolume(0);}
    else{const te=jarTilt(P);carryPose(BL.jar,J,jarLift(P),jarMv(P),te,LIP);BL.setVolume(Math.min(V0,BL.capAt(te)));}
    BL.refresh();
    {const k=sm((P-2.95)/0.15);jarGlassMats.forEach(([m,o,e,c])=>{m.opacity=lerp(o,o*0.45,k);m.envMapIntensity=lerp(e,e*0.3,k);m.clearcoat=lerp(c,0.05,k);});}
    // colour shifts after berries have been spinning a while — milk → blush → finished juice
    BL.color().copy(MILK_COL).lerp(MID_PINK,sm(Math.max(0,b-0.2)/0.45)).lerp(SHAKE_COL_L,sm(Math.max(0,b-0.55)/0.45));capMesh.material.color.copy(BL.color()).multiplyScalar(0.62);if(P>2.95)capMesh.visible=false;
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
  glass.visible=glassShadow.visible=P>3.5;sideBerries.forEach(h=>h.visible=false);splash.visible=false;
  if(P>3.5){
    const g=P;
    GL.setVolume(G_TARGET*sm((g-3.9)/0.45));
    {const L=GL.surfaceY(),r=gIn(L)-0.035;meniscus.visible=GL.liquid()>0.02;meniscus.scale.set(r,r,1);meniscus.position.y=L+0.012;}
    GL.setCream(sm((g-4.42)/0.16));GL.setSyrup(clamp((g-4.56)/0.1));GL.setBerry(clamp((g-4.64)/0.07));GL.setStraw(clamp((g-4.7)/0.07));
    cond.set(0.45*clamp((g-4.2)/0.6));            // cold: beaded condensation on the cup
    sideBerries.forEach((h,i)=>{const s=clamp((g-4.68-0.035*i)/0.08),u=h.userData;h.visible=s>0;   // rest on the table beside the glass
      h.position.set(GX+u.x,GY+u.y,u.z);h.rotation.y=u.ry;});
    glass.rotation.y=P>=5?time*0.35:0.12*Math.sin(time*0.5);
  }

  }

  /* ---- camera + key light ---- */
  camTarget(P);
  // framing: pull back for narrow screens / very tall screens
  const k=Math.max(1,1.05/cam.aspect)*CTd;
  const dt=warm?0:Math.min(0.1,Math.max(0,time-lastT));if(!warm)lastT=time;const kd=1-Math.exp(-dt*7);
  view.yaw+=(view.ty-view.yaw)*kd;view.pitch+=(view.tp-view.pitch)*kd;view.zoom+=(view.tz-view.zoom)*kd;
  // On a phone the canvas is the top band and the header covers it. A small lift (0.6) keeps the
  // pour readable; once the glass is the subject, look higher so the finished shake clears the bar.
  let yNudge=0;
  if(narrow()){
    // on small screens, raise the camera target (meaning the glass moves DOWN visually)
    yNudge=P>3.18?0.4:0;
  }
  const r=OFF_R*k*view.zoom,yw=OFF_YAW+view.yaw,pc=clamp(OFF_PITCH+view.pitch,PITCH_MIN,PITCH_MAX);
  cam.position.set(CT.x+r*Math.cos(pc)*Math.sin(yw),CT.y+yNudge+r*Math.sin(pc),CT.z+r*Math.cos(pc)*Math.cos(yw));
  CT.y+=yNudge;cam.lookAt(CT);
  key.target.position.copy(CT);key.position.set(CT.x+KEY_OFF.x,CT.y+KEY_OFF.y,CT.z+KEY_OFF.z);

  if(warm)return;            // warm-up renders leave the page (opacity, controls, section state) alone
  let op=1;
  if(A===5&&narrow()){const r=secs[5].getBoundingClientRect();op=sm((r.top/winH-0.05)/0.25);}
  cv.style.opacity=op.toFixed(3);
  
  // Cache DOM reads to avoid forced reflows during scroll
  const afterEl=document.getElementById('after');
  const foot=afterEl?afterEl.getBoundingClientRect().top<winH-40:false;
  const live=op>0.1&&!foot;
  cv.style.pointerEvents=live?'auto':'none';ctl.classList.toggle('off',!live);hint.classList.toggle('off',!live);
  if(A!==lastA){if(lastA>=0)resetView();lastA=A;secs.forEach((s,i)=>s.classList.toggle('in',i===A));}
}

/* ---------- sizing ---------- */
let cvW=1,cvH=1,winH=1000;
function size(){
  const w=cv.clientWidth||innerWidth,h=cv.clientHeight||innerHeight;
  winH=innerHeight;
  cvW=w;cvH=h;
  renderer.setSize(w,h,false);
  cam.aspect=w/h;cam.updateProjectionMatrix();measure();
}
addEventListener('resize',size);addEventListener('load',measure);
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(measure);
size();

/* ---------- frame loop ----------
   - the story position eases toward the scroll position with a frame-rate-independent lerp (smooth on wheel steps, keeps up fast)
   - a frame is only rendered when something can change: scroll, orbit, resize, or a time-driven animation on screen
   - nothing runs while the tab is hidden */
const SMOOTH=14;let Ps=-1,lastRenderP=-1,needRender=true,lastFrameT=0;
const viewMoving=()=>Math.abs(view.ty-view.yaw)+Math.abs(view.tp-view.pitch)+Math.abs(view.tz-view.zoom)>1e-4;
const timeDriven=P=>(!heroDone&&INTRO_FREEZE<0&&time-heroStart<DROP_END+0.3)||(P>2.28&&P<2.64)||(P>2.7&&P<2.92)||(P>3.2&&P<4.45)||P>3.5;
addEventListener('resize',()=>{needRender=true;});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){needRender=true;lastFrameT=clock.getElapsedTime();}});
cv.addEventListener('pointermove',()=>{needRender=true;},{passive:true});
/* Start-up, all behind the loader, on the real canvas (same framebuffer, MSAA, shadow map and pipeline state as every later frame,
   so the driver builds exactly the variants the story will use; nothing is drawn offscreen):
     1. 'hero'  draw the hero (settled pile) until all its programs are compiled (in parallel) and drawn once
     2. 'late'  wait for the later sections (built in idle chunks meanwhile); choose lite quality now if the hero was slow
     3. 'warm'  draw every story beat once, one per frame, until each drew with nothing pending (time-boxed)
     4. show    draw the real first frame and hide the loader
   Beats left over after the time box are drawn after start-up in spare frames, each followed by the real frame. */
// every story beat where the set of visible objects or their state changes (pitcher, pour, lid, blend, jar lift and tilt, stream,
// glass, splash, cream, syrup, berry, straw, side berries)
const WARM=[0.6,1.0,1.5,1.9,2.2,2.35,2.45,2.55,2.68,2.8,2.93,3.0,3.1,3.25,3.4,3.6,3.8,4.0,4.3,4.5,4.6,4.66,4.72,4.8,5.0];
// software GL (SwiftShader, llvmpipe) compiles on the CPU at first use either way and every extra draw is expensive: no warm-up there
// (?warm=1 forces it, e.g. to exercise this path headless)
const SOFT_GL=/SwiftShader|llvmpipe|softpipe|Software|Microsoft Basic/i.test(GPU_STR)&&!QS.has('warm');
if(SOFT_GL){WARM.length=0;if(BT)BT.warmSkipped='software GL';}
const WARM_BUDGET=QS.has('warmms')?+QS.get('warmms'):1000,HERO_SLOW=3500,FRAME_SLOW=1500;
let frameNo=0,warmI=0,warmPass=0,phase='hero',tPhase=-1,tLoop=-1,tPrev=0,maxPre=0,heroMats=null,warmP=-1;
function drawBeat(P){
  const keepHero=heroDone;heroDone=true;warmP=P;renderer.info.pending=0;
  try{apply(P,Math.min(5,Math.floor(P)),true);renderNow();}catch(e){console.warn(e);}
  heroDone=keepHero;warmP=-1;return renderer.info.pending===0;
}
function warmStep(){
  if(drawBeat(WARM[warmI]))WARM.splice(warmI,1);else warmI++;
  if(warmI>=WARM.length){warmI=0;warmPass++;}
  if(!WARM.length&&BT){BT.warmDone=performance.now();BT.warmPasses=warmPass+1;BT.programsAtWarm=renderer.info.programs.length;}
}
function heroPile(){        // the settled pile: every berry is drawn (the intro starts them hidden)
  const keepHero=heroDone;heroDone=true;renderer.info.pending=0;
  apply(Ps,Math.min(5,Math.floor(Ps)));renderNow();heroDone=keepHero;return renderer.info.pending===0;
}
function startup(now){
  if(tLoop<0){tLoop=tPhase=now;heroMats=new Set();scene.traverse(o=>{if(o.material)heroMats.add(o.material);});if(LITE)liteify(scene);}
  if(tPrev)maxPre=Math.max(maxPre,now-tPrev);tPrev=now;
  if(phase==='hero'){
    if(Ps<1.4&&!heroPile())return false;
    phase='late';bmark('heroCompiled');
    if(!LITE&&QMODE!=='full'&&(now-tLoop>HERO_SLOW||maxPre>FRAME_SLOW)){LITE=true;LITE_WHY='slow start: hero '+Math.round(now-tLoop)+' ms, frame '+Math.round(maxPre)+' ms';
      if(BT){BT.quality='lite';BT.qualityWhy=LITE_WHY;}}
  }
  if(phase==='late'){
    if(!LATE)return false;
    if(LITE){const n=liteify(scene,heroMats);if(BT)BT.liteMaterials=n;}
    phase='warm';tPhase=now;bmark('warmStart');if(WARM.length)cv.style.visibility='hidden';   // never visible, even if the loader is gone
  }
  if(phase==='warm'){
    if(WARM.length&&now-tPhase<WARM_BUDGET){warmStep();return false;}
    phase='show';cv.style.visibility='';if(BT)BT.warmLeftAtShow=WARM.length;
  }
  renderer.info.pending=0;apply(Ps,Math.min(5,Math.floor(Ps)));renderNow();   // the real first frame (intro at t=0)
  return renderer.info.pending===0;
}
function frame(){
  requestAnimationFrame(frame);
  if(document.hidden)return;
  time=clock.getElapsedTime();
  const dts=Math.min(0.5,Math.max(0,time-lastFrameT));lastFrameT=time;
  const sP=scrollState().P;
  if(Ps<0)Ps=sP;else{Ps+=(sP-Ps)*(1-Math.exp(-dts*SMOOTH));if(Math.abs(sP-Ps)<2e-4)Ps=sP;}
  if(!shown){
    const t0=performance.now(),ok=startup(t0);if(BENCH)benchFrame(t0,'startup:'+phase);
    if(!ok)return;
    shown=true;heroStart=time;lastRenderP=Ps;needRender=false;
    if(BT){gl_finish();BT.firstRender=BT.heroReady=performance.now();BT.programsAtHero=renderer.info.programs.length;}
    window.__maledaReady=true;document.dispatchEvent(new Event('maleda:ready'));return;
  }
  if(document.body.classList.contains('past-story')){needRender=true;return;}   // below the story the canvas is hidden: draw nothing
  let draw=needRender||Ps!==lastRenderP||viewMoving()||timeDriven(Ps);
  const _t0=performance.now();
  if(LATE&&WARM.length>0&&++frameNo%2===0){warmStep();draw=true;}   // a left-over beat, then the real frame over it (never shown)
  if(!draw)return;
  renderer.info.pending=0;
  apply(Ps,Math.min(5,Math.floor(Ps)));renderNow();lastRenderP=Ps;needRender=renderer.info.pending>0;   // still compiling: draw again
  perf.n++;perf.ms+=performance.now()-_t0;perf.calls+=renderer.info.render.calls;perf.tris+=renderer.info.render.triangles;
  if(BENCH)benchFrame(_t0,'story');
}
/* ?bench only: per-frame GPU timing (gl.finish after each rendered frame) and, for every first draw of a material, the time that
   single draw took (gl.finish before and after), so a long frame can be traced to the draw (and the program) that stalled. */
const benchLog={frames:[],firstDraws:[]};
function benchFrame(t0,what){const t1=performance.now();gl_finish();const t2=performance.now(),cpu=t1-t0,gpu=t2-t1;
  if(cpu+gpu>50&&benchLog.frames.length<80){const vis={};scene.traverseVisible(o=>{if(o.isMesh&&o.material){const m=o.material,k=m.type+(m.transparent?'/T':'')+(m.defines&&m.defines.PHYSICAL!==undefined?'/phys':'');vis[k]=(vis[k]||0)+1;}});
    benchLog.frames.push({t:+t0.toFixed(1),what,P:+Ps.toFixed(3),cpuMs:+cpu.toFixed(1),finishMs:+gpu.toFixed(1),calls:renderer.info.render.calls,programs:renderer.info.programs.length,pending:renderer.info.pending||0,visible:vis});}}
if(BENCH){window.__benchLog=benchLog;const seen=new Set(),rbd=renderer.renderBufferDirect.bind(renderer);
  renderer.renderBufferDirect=function(camera,sc,geometry,material,object,group){
    const rt=renderer.getRenderTarget(),key=material.uuid+(object.isInstancedMesh?'i':'')+(rt?'rt'+rt.texture.uuid:'');
    if(seen.has(key))return rbd(camera,sc,geometry,material,object,group);
    const c0=renderer.info.render.calls;gl_finish();const t=performance.now();rbd(camera,sc,geometry,material,object,group);
    if(renderer.info.render.calls===c0)return;                       // skipped (program still compiling): not a first draw yet
    gl_finish();const dt=performance.now()-t;seen.add(key);
    if(benchLog.firstDraws.length<300)benchLog.firstDraws.push({t:+t.toFixed(1),ms:+dt.toFixed(1),P:+Ps.toFixed(2),beat:warmP,mat:material.type+(material.name?':'+material.name:''),
      color:material.color?material.color.getHexString():null,flags:[material.transparent?'transparent':'',material.side===2?'double':'',(material.clippingPlanes||[]).length?'clip':'',object.isInstancedMesh?'instanced':'',material.vertexColors?'vcol':'',material.map?'map':'',material.sheen?'sheen':'',material.defines&&material.defines.PHYSICAL!==undefined?'physical':'',rt?'shadow/rt':''].filter(Boolean).join(','),
      tris:geometry.index?geometry.index.count/3:(geometry.attributes.position?geometry.attributes.position.count/3:0)});};}
const perf={n:0,ms:0,calls:0,tris:0};window.__perf=perf;
function gl_finish(){try{renderer.getContext().finish();}catch(e){}}
if(BT)BT.pixelRatio=renderer.getPixelRatio();
if(BENCH||AUDIT)window.__r=renderer;
requestAnimationFrame(frame);
bmark('loopStart');

/* ---------- later sections, built in idle chunks while the hero compiles / plays ---------- */
const idle=()=>new Promise(r=>typeof requestIdleCallback==='function'?requestIdleCallback(()=>r(),{timeout:80}):setTimeout(r,16));
// let the first frame request the hero's programs first (they then compile on the driver's threads while this runs)
await new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));await idle();bmark('lateStart');
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

await idle();bmark('latePitcher');
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

await idle();bmark('lateGlass');
/* ---------- 5: glass ---------- */
const glass=createGlassStation(GX,0);glass.position.y=GY;scene.add(glass);const GL=glass.userData;
await idle();
const cond=createCondensation(lowPower);glass.add(cond.group);
const glassShadow=shadowPlane(GY);
const G_TARGET=GL.fullVolume();   // to the rim
GL.setColor(lin(SHAKE_HEX));
const shakeMesh=glass.children.find(c=>c.isMesh&&c.material.map);
glass.children.slice(0,3).forEach(c=>{if(c.isMesh&&c.material.transparent){c.material.opacity*=0.6;c.material.envMapIntensity=0.8;}});   // clearer tumbler, less milky haze
{const m=shakeMesh.material;m.map=null;m.emissive.setRGB(0,0,0);m.roughness=0.42;m.clearcoat=0.3;m.clearcoatRoughness=0.35;m.envMapIntensity=0.55;
  shakeShader(m,{grad:true,y0:GLASS.floor,y1:GLASS.H,scale:24});}
// meniscus: a soft lip where the shake meets the glass wall
const menMat=new THREE.MeshPhysicalMaterial({roughness:0.4,clearcoat:0.3,envMapIntensity:0.55});menMat.color=shakeMesh.material.color;shakeShader(menMat,{grad:false,scale:24,bright:1.08});
const meniscus=new THREE.Mesh(new THREE.TorusGeometry(1,0.03,10,72),menMat);meniscus.rotation.x=-Math.PI/2;glass.add(meniscus);
await idle();
GL.setVolume(G_TARGET);GL.setCream(0.001);GL.setSyrup(0.001);GL.setBerry(0.001);GL.setStraw(0.001);
GL.setCream(0);GL.setSyrup(0);GL.setBerry(0);GL.setStraw(0);GL.setVolume(0);
{const deco=glass.children.find(c=>c.isGroup&&c.children.length>3),cm=deco.children[0].material;
  const cream=new THREE.MeshPhysicalMaterial({vertexColors:true,color:lin(0xfaf1e8),emissive:lin(0x3a302a),roughness:0.62,clearcoat:0.12,clearcoatRoughness:0.6,envMapIntensity:0.45,side:THREE.DoubleSide,sheen:new THREE.Color(0xfff6ee)});
  creamShader(cream);
  deco.traverse(o=>{if(!o.isMesh)return;const m=o.material;
    if(m===cm)o.material=cream;
    else if(m.isMeshPhysicalMaterial&&m.roughness===0.1&&m.clearcoat===1){m.color.copy(lin(0x8a0614));m.roughness=0.05;m.clearcoatRoughness=0.02;m.envMapIntensity=1.25;m.emissive.copy(lin(0x1c0206));}});}
await idle();
// section 5 extras: whole berries resting on the table beside the glass (only the topping berry sits on the cream).
const SIDE=[[-1.55,0.22,0.55,0.35,-0.15],[1.5,0.22,-0.35,-0.45,0.2],[1.25,0.2,0.7,0.25,0.35]];
const sideBerries=SIDE.map(([x,y,z,rz,rx],i)=>{const b=protoBerry({size:0.5,seed:80+i,detail:0.8}),h=new THREE.Group();
  b.rotation.set(rx,i*1.3,rz);b.position.y=-0.25;h.add(b);h.userData={x,y,z,ry:i*0.8};h.position.set(GX+x,GY+y,z);h.visible=false;scene.add(h);INST.add(h);return h;});
{const tb=glass.children.find(c=>c.isGroup&&c.children.length>3).children.find(c=>c.isGroup&&c.children[0]&&c.children[0].userData&&c.children[0].userData.mesh);
  if(tb){const b=tb.children[0],g=b.children[0];compactBerry(b);g.children.filter(o=>o.isInstancedMesh).forEach(im=>{g.add(seedsToMesh(im));g.remove(im);});INST.add(tb);}}
INST.build();
const splash={visible:false};   // side splash ribbons removed
LATE=true;needRender=true;bmark('lateReady');

window.__maleda={perfReset:()=>{perf.n=perf.ms=perf.calls=perf.tris=0;},perf:()=>({...perf}),state:()=>scrollState(),berries:N,landers:landers.length,drop:DROP.stats,tip:{...TIP.stats,simMs:Math.round(SIM_MS)},jar:{...JAR.stats,PA:+JAR.PA.toFixed(3),TS:+JAR.TS.toFixed(2),maxT:+JAR.maxT.toFixed(2),G:+G.toFixed(2),bottomLayer:landers.filter(f=>f.E.y-JB<0.45).length,spreadR:+Math.max(...landers.map(f=>f.r0)).toFixed(2)},view:()=>({...view})};

/* ?audit: verification hook for automated tests only (measures every rendered berry vertex against the bowl's real solid) */
if(AUDIT){
  const VS=berries.map(f=>{const h=f.h,pts=[],v=new THREE.Vector3(),M=new THREE.Matrix4(),inv=new THREE.Matrix4();h.updateMatrixWorld(true);inv.copy(h.matrixWorld).invert();
    h.traverse(o=>{if(!o.isMesh)return;const p=o.geometry.attributes.position;
      if(o.isInstancedMesh){for(let k=0;k<o.count;k++){o.getMatrixAt(k,M);v.setFromMatrixPosition(M).applyMatrix4(o.matrixWorld).applyMatrix4(inv);pts.push(v.x,v.y,v.z);}}
      else for(let k=0;k<p.count;k++){v.fromBufferAttribute(p,k).applyMatrix4(o.matrixWorld).applyMatrix4(inv);pts.push(v.x,v.y,v.z);}});
    return new Float32Array(pts);});
  window.__maleda._audit=({Ps=[],taus=[]}={})=>{const out=[],inv=new THREE.Matrix4(),M=new THREE.Matrix4(),v=new THREE.Vector3();
    const run=(label)=>{scene.updateMatrixWorld(true);inv.copy(bowl.matrixWorld).invert();let worst=0,bad=0,who=-1,nv=0,wr=0,wy=0,wk=0;
      berries.forEach((f,i)=>{if(!f.h.visible)return;M.multiplyMatrices(inv,f.h.matrixWorld);const s=f.h.scale.x,P_=VS[i];let bi=0;
        for(let k=0;k<P_.length;k+=3){v.set(P_[k],P_[k+1],P_[k+2]).applyMatrix4(M);if(v.y>1.4||v.y<-0.3)continue;const rho=Math.hypot(v.x,v.z);if(rho>1.9)continue;nv++;
          const d=bowlShell().exact(rho,v.y);if(d<0){bad++;if(-d>worst){worst=-d;who=i;wr=rho;wy=v.y;wk=k/3;}}}});
      out.push({at:label,maxInsideWall:+worst.toFixed(4),verticesInsideWall:bad,berry:who,rho:+wr.toFixed(3),y:+wy.toFixed(3),vi:wk,nv:who>=0?VS[who].length/3:0,released:who>=0&&berries[who].Pr<=+label.slice(2),checked:nv});};
    const keepHero=heroDone,keepF=INTRO_FREEZE;
    heroDone=false;for(const t of taus){INTRO_FREEZE=t;apply(0,0);run('tau='+t);}
    heroDone=true;INTRO_FREEZE=keepF;for(const P of Ps){apply(P,Math.min(5,Math.floor(P)));run('P='+P);}
    heroDone=keepHero;needRender=true;return out;};
  // resting pile: per berry, the smallest gap (visual mesh) to the bowl and to any other berry, in the settled pose f.L (bowl-local)
  window.__maleda._rest=(useFin)=>{const v=new THREE.Vector3();
    const DIRS=[];{const n=200,ga=Math.PI*(3-Math.sqrt(5));for(let d=0;d<n;d++){const y=1-2*(d+0.5)/n,r=Math.sqrt(1-y*y);DIRS.push(Math.cos(d*ga)*r,y,Math.sin(d*ga)*r);}}
    const HP=berries.map((f,i)=>{const NB=f.body.geometry.attributes.position.count*3,P_=VS[i],h=new Float64Array(DIRS.length/3).fill(-1e9);
      for(let k=0;k<NB;k+=3){v.set(P_[k],P_[k+1],P_[k+2]).applyMatrix4(f.L);for(let d=0;d<DIRS.length;d+=3){const e=DIRS[d]*v.x+DIRS[d+1]*v.y+DIRS[d+2]*v.z;if(e>h[d/3])h[d/3]=e;}}
      return {n:DIRS,h,c:new THREE.Vector3().setFromMatrixPosition(f.L)};});
    const W=berries.map((f,i)=>{const M=f.L,P_=VS[i],o=new Float32Array(P_.length);
      for(let k=0;k<P_.length;k+=3){v.set(P_[k],P_[k+1],P_[k+2]).applyMatrix4(M);o[k]=v.x;o[k+1]=v.y;o[k+2]=v.z;}return o;});
    const C=0.03,key=(x,y,z)=>((Math.floor(x/C)+512)*1048576)+((Math.floor(y/C)+512)*1024)+(Math.floor(z/C)+512),G=new Map();
    W.forEach((o,i)=>{for(let k=0;k<o.length;k+=3){const q=key(o[k],o[k+1],o[k+2]);let a=G.get(q);if(!a)G.set(q,a=[]);a.push(i,k);}});
    return berries.map((f,i)=>{const o=W[i];let gb=1e9,gq=1e9,nb=-1;
      for(let k=0;k<o.length;k+=3){const x=o[k],y=o[k+1],z=o[k+2];const d=bowlShell().exact(Math.hypot(x,z),y);if(d<gb)gb=d;
        const cx=Math.floor(x/C),cy=Math.floor(y/C),cz=Math.floor(z/C);
        for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++)for(let c=-1;c<=1;c++){const L=G.get(((cx+a+512)*1048576)+((cy+b+512)*1024)+(cz+c+512));if(!L)continue;
          for(let t=0;t<L.length;t+=2){const j=L[t];if(j===i)continue;const p=W[j],m=L[t+1],dx=p[m]-x,dy=p[m+1]-y,dz=p[m+2]-z,dd=Math.sqrt(dx*dx+dy*dy+dz*dz);if(dd<gq){gq=dd;nb=j;}}}}
      let pen=0,penB=0;const NB=f.body.geometry.attributes.position.count*3,ci=_v.setFromMatrixPosition(f.L).clone();
      berries.forEach((g,j)=>{if(j===i)return;const H=HP[j];if(ci.distanceTo(H.c)>f.hullR+g.hullR+0.02)return;
        for(let k=0;k<o.length;k+=3){const x=o[k],y=o[k+1],z=o[k+2];let m=-1e9;
          for(let d=0;d<H.n.length;d+=3){const e=H.n[d]*x+H.n[d+1]*y+H.n[d+2]*z-H.h[d/3];if(e>m){m=e;if(m>=0)break;}}
          if(m<0){if(-m>pen)pen=-m;if(k<NB&&-m>penB)penB=-m;}}});
      return {i,pen:+pen.toFixed(4),penBody:+penB.toFixed(4),gapBowl:+gb.toFixed(4),gapBerry:+(gq>1e8?9:gq).toFixed(4),nb,gap:+Math.min(gb,gq>1e8?9:gq).toFixed(4),y:+f.L.elements[13].toFixed(3)};});};
  window.__maleda._dbg=(i,P)=>{apply(P,0);scene.updateMatrixWorld(true);const inv=new THREE.Matrix4().copy(bowl.matrixWorld).invert(),c=berries[i].h.position.clone().applyMatrix4(inv),f=berries[i];
    return {Pr:f.Pr,R:f.R.toArray(),pos:f.h.position.toArray(),local:c.toArray(),sd:bowlShell().exact(Math.hypot(c.x,c.z),c.y),hullR:f.hullR,rel:TIP.rel[i]};};
  // pitcher clearance: every pitcher vertex vs every visible berry's bounding sphere (hull radius x current scale), world space
  window.__maleda._jug=(Ps)=>{const out=[];const pv=[];pitcher.traverse(o=>{if(o.isMesh)pv.push(o);});
    for(const P of Ps){apply(P,Math.min(5,Math.floor(P)));scene.updateMatrixWorld(true);let minGap=1e9,who=-1,outside=0,top=-1e9;
      const bpts=[];if(blender.visible)blender.traverse(o=>{if(!o.isMesh||!o.visible)return;const a=o.geometry.attributes.position;if(!a)return;for(let k=0;k<a.count;k+=3)bpts.push(_w.fromBufferAttribute(a,k).applyMatrix4(o.matrixWorld).clone());});let missGap=1e9;
      const pts=[];if(pitcher.visible)for(const o of pv){if(!o.visible)continue;const a=o.geometry.attributes.position;for(let k=0;k<a.count;k+=2){pts.push(_w.fromBufferAttribute(a,k).applyMatrix4(o.matrixWorld).clone());}}
      berries.forEach((f,i)=>{const h=f.h;if(!h.visible)return;const r=f.hullR*h.scale.x,c=h.position;
        for(const q of pts){const g=q.distanceTo(c)-r;if(g<minGap){minGap=g;who=i;}}
        if(!f.land&&bpts.length){for(const q of bpts){const g=q.distanceTo(c)-r;if(g<missGap)missGap=g;}}
        if(f.land&&P>=f.PE){const y=c.y-JB;if(y<BLENDER.jarH&&Math.hypot(c.x,c.z)>jarInner(Math.max(0.13,y))+0.01)outside++;top=Math.max(top,y+r);}});
      out.push({P,missGap:+missGap.toFixed(3),minGap:+minGap.toFixed(3),berry:who,outside,pileTop:+top.toFixed(2),jugVisible:pitcher.visible});}
    needRender=true;return out;};
  window.__maleda._rel=()=>berries.map(f=>[+f.Pr.toFixed(3),f.land?1:0,+f.v0.toFixed(2),+f.hullR.toFixed(3),+f.size.toFixed(3)]);
}