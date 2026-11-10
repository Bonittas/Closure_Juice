import * as THREE from 'three';

/* ---------- helpers ---------- */
function rng(seed){let s=(seed*9301+49297)>>>0;return()=>(s=(s*1664525+1013904223)>>>0)/4294967296;}
// hex (sRGB) -> colour that renders correctly on every three.js version (fixes washed-out, pinkish reds)
export const lin=hex=>{const c=new THREE.Color(hex),m=THREE.ColorManagement;
  if(!(m&&m.enabled&&!m.legacyMode))c.convertSRGBToLinear();return c;};
function srgb(tex){if(THREE.SRGBColorSpace)tex.colorSpace=THREE.SRGBColorSpace;else tex.encoding=THREE.sRGBEncoding;}

/* ================= STEP 1: THE BOWL ================= */
export function createBowl({height=1,topRadius=1.5,footRadius=0.6}={}){
  const g=new THREE.Group(), wall=0.07;
  const outerR=s=>footRadius+(topRadius-footRadius)*(1-Math.pow(1-s,1.7));
  const outerY=s=>0.08+s*(height-0.08);
  // profile: foot -> outer wall -> rim -> inner wall -> inner floor
  const pts=[new THREE.Vector2(0,0),new THREE.Vector2(footRadius*0.9,0),new THREE.Vector2(footRadius,0.04)];
  const nOuterStart=pts.length;
  for(let i=0;i<=14;i++){const s=i/14;pts.push(new THREE.Vector2(outerR(s),outerY(s)));}
  const nOuterEnd=pts.length-1;
  pts.push(new THREE.Vector2(topRadius-wall/2,height+0.012));
  for(let i=14;i>=0;i--){const s=i/14;
    pts.push(new THREE.Vector2(footRadius*0.8+(topRadius-wall-footRadius*0.8)*(1-Math.pow(1-s,1.7)),0.12+s*(height-0.12)));}
  pts.push(new THREE.Vector2(0,0.12));
  // ornament band UV range (v = index/(n-1))
  let i0=nOuterStart,i1=nOuterEnd;
  for(let i=nOuterStart;i<=nOuterEnd;i++){if(pts[i].y>=height*0.45){i0=i;break;}}
  for(let i=nOuterEnd;i>=nOuterStart;i--){if(pts[i].y<=height*0.8){i1=i;break;}}
  const v0=i0/(pts.length-1),v1=i1/(pts.length-1);
  // painted texture
  const W=2048,H=1024,c=document.createElement('canvas');c.width=W;c.height=H;const x=c.getContext('2d');
  x.fillStyle='#e8dac1';x.fillRect(0,0,W,H);
  const yT=(1-v1)*H,yB=(1-v0)*H;
  x.fillStyle='#1b1e3c';x.fillRect(0,yT,W,yB-yT);
  x.strokeStyle='#c99c40';x.lineWidth=6;
  for(const y of[yT,yB]){x.beginPath();x.moveTo(0,y);x.lineTo(W,y);x.stroke();}
  const mid=(yT+yB)/2,hh=(yB-yT)/2*0.75,n=14,step=W/n;
  x.strokeStyle='#b9552f';x.lineWidth=9;x.lineCap='round';
  for(let k=0;k<n;k++){const x0=k*step;
    x.beginPath();x.moveTo(x0,mid);
    x.bezierCurveTo(x0+step*.25,mid-hh*1.6,x0+step*.5,mid-hh*1.6,x0+step*.5,mid);
    x.bezierCurveTo(x0+step*.5,mid+hh*1.6,x0+step*.75,mid+hh*1.6,x0+step,mid);x.stroke();
    x.beginPath();x.arc(x0+step*.5,mid-hh*.55,hh*.17,0,6.283);x.stroke();}
  const tex=new THREE.CanvasTexture(c);srgb(tex);tex.anisotropy=8;
  const body=new THREE.Mesh(new THREE.LatheGeometry(pts,96),
    new THREE.MeshPhysicalMaterial({map:tex,roughness:0.3,clearcoat:1,clearcoatRoughness:0.08,side:THREE.DoubleSide}));
  body.castShadow=body.receiveShadow=true;g.add(body);
  // gold rim
  const rim=new THREE.Mesh(new THREE.TorusGeometry(topRadius-wall/2,0.04,16,128),
    new THREE.MeshStandardMaterial({color:lin(0xd9a441),metalness:0.7,roughness:0.3,emissive:lin(0x3a2406)}));
  rim.rotation.x=Math.PI/2;rim.position.y=height+0.012;rim.castShadow=true;g.add(rim);
  // water droplets on the outside
  const r=rng(7),dm=new THREE.MeshPhysicalMaterial({color:0xffffff,transparent:true,opacity:0.45,roughness:0,clearcoat:1});
  for(let i=0;i<10;i++){const s=0.1+r()*0.55,a=r()*6.283,R=outerR(s)+0.004;
    const d=new THREE.Mesh(new THREE.SphereGeometry(1,10,8),dm);
    d.position.set(Math.cos(a)*R,outerY(s),Math.sin(a)*R);
    d.lookAt(d.position.x*2,d.position.y,d.position.z*2);
    const k=0.012+r()*0.014;d.scale.set(k,k*1.5,k*0.5);g.add(d);}
  g.userData={height,topRadius,footRadius,profile:pts.map(p=>[p.x,p.y]),rimBead:[topRadius-wall/2,height+0.012,0.04]};   // exact solid cross-section (for collisions)
  return g;
}

/* ================= STEP 2: REALISTIC 3D STRAWBERRY ================= */
const R0=0.58;
const rad=t=>R0*Math.pow(t,0.55)*Math.sqrt(Math.max(0,1-Math.pow(t,6)));
const topY=rho=>{let lo=0.72,hi=1;for(let i=0;i<24;i++){const m=(lo+hi)/2;if(rad(m)>rho)lo=m;else hi=m;}return(lo+hi)/2;};
const SEED_GEO=new THREE.SphereGeometry(1,6,4),DROP_GEO=new THREE.SphereGeometry(1,8,6);   // seeds are a few pixels wide: a low-poly sphere looks identical
const SEED_MAT=new THREE.MeshStandardMaterial({color:lin(0xf0b73c),roughness:0.4,emissive:lin(0x4a2a00)});
const DROP_MAT=new THREE.MeshPhysicalMaterial({color:0xffffff,transparent:true,opacity:0.35,roughness:0,clearcoat:1,envMapIntensity:2});
const STOPS=[[0,0xb80f1c],[0.4,0xdc1420],[0.8,0xe8281c],[0.93,0xee5a2a],[1,0xe8c26a]].map(s=>[s[0],lin(s[1])]);
const _cache={};
function fixSeam(geo,NR,NP){const n=geo.attributes.normal,A=new THREE.Vector3(),B=new THREE.Vector3();
  for(let j=0;j<NP;j++){const a=j,b=NR*NP+j;A.fromBufferAttribute(n,a);B.fromBufferAttribute(n,b);A.add(B).normalize();n.setXYZ(a,A.x,A.y,A.z);n.setXYZ(b,A.x,A.y,A.z);}}
// Built once per variant and shared by every berry that uses it
function bodyVariant(v,detail){
  const key=v+'_'+detail;if(_cache[key])return _cache[key];
  const r=rng(100+v*17),ph=r()*6.28,ph2=r()*6.28;
  const lump=a=>1+0.04*Math.sin(3*a+ph)+0.025*Math.sin(5*a+ph2)+0.02*Math.sin(2*a+ph);
  const surf=(t,a)=>{const rr=rad(t)*lump(a);return new THREE.Vector3(rr*Math.cos(a),t,rr*Math.sin(a));};
  const place=(t,a)=>{const e=0.003,Pt=surf(t+e,a).sub(surf(t-e,a)),Pa=surf(t,a+e).sub(surf(t,a-e));
    return{P:surf(t,a),n:Pt.cross(Pa).normalize()};};
  const NP=Math.round(140*detail)+1,NR=Math.round(200*detail),prof=[];
  for(let i=0;i<NP;i++){const t=i/(NP-1);prof.push(new THREE.Vector2(rad(t),t));}
  const geo=new THREE.LatheGeometry(prof,NR),p=geo.attributes.position;
  for(let i=0;i<p.count;i++){const x=p.getX(i),z=p.getZ(i),k=lump(Math.atan2(z,x));p.setX(i,x*k);p.setZ(i,z*k);}
  geo.computeVertexNormals();fixSeam(geo,NR,NP);
  // seed layout: golden-angle spiral, evenly spread by surface area
  const N=200,t0=0.06,t1=0.93,M=200,cdf=[0],seeds=[];
  for(let i=1;i<=M;i++){const t=t0+(t1-t0)*i/M,e=1e-3,dr=(rad(t+e)-rad(t-e))/(2*e);cdf.push(cdf[i-1]+rad(t)*Math.sqrt(1+dr*dr));}
  let k=0;
  for(let i=0;i<N;i++){const u=(i+0.5)/N*cdf[M];while(cdf[k+1]<u)k++;
    const t=t0+(t1-t0)*(k+(u-cdf[k])/(cdf[k+1]-cdf[k]))/M;seeds.push(place(t,i*2.39996+ph));}
  // dimples around each seed + colour gradient
  const nm=geo.attributes.normal,DEPTH=0.015,baseCol=new Float32Array(p.count*3),c=new THREE.Color();
  for(let i=0;i<p.count;i++){
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i);let w=0;
    for(const s of seeds){const dy=y-s.P.y;if(dy>0.085||dy<-0.085)continue;
      const dx=x-s.P.x,dz=z-s.P.z,d2=dx*dx+dy*dy+dz*dz;if(d2<0.0072)w+=Math.exp(-d2/0.00157);}
    w=Math.min(w,1)*DEPTH;p.setXYZ(i,x-nm.getX(i)*w,y-nm.getY(i)*w,z-nm.getZ(i)*w);
    let j=0;while(j<STOPS.length-2&&y>STOPS[j+1][0])j++;
    c.copy(STOPS[j][1]).lerp(STOPS[j+1][1],Math.min(1,Math.max(0,(y-STOPS[j][0])/(STOPS[j+1][0]-STOPS[j][0]))));
    baseCol.set([c.r,c.g,c.b],i*3);}
  geo.computeVertexNormals();fixSeam(geo,NR,NP);
  // seed instance matrices (each seed rests at the bottom of its dimple)
  const mats=new Float32Array(N*16),m=new THREE.Matrix4(),q=new THREE.Quaternion(),q2=new THREE.Quaternion(),up=new THREE.Vector3(0,1,0),sc=new THREE.Vector3(0.02,0.009,0.034);
  seeds.forEach((s,i)=>{q.setFromUnitVectors(up,s.n);q2.setFromAxisAngle(s.n,i*1.7);q2.multiply(q);
    m.compose(s.P.clone().addScaledVector(s.n,-(DEPTH-0.003)),q2,sc);m.toArray(mats,i*16);});
  return _cache[key]={geo,baseCol,mats,place,N};
}
// Origin is the tip, +Y goes toward the stem, height = size.
export function createStrawberry({size=0.5,seed=1,detail=1,drops=5}={}){
  const r=rng(seed),root=new THREE.Group(),g=new THREE.Group(),V=bodyVariant(seed%3,detail);
  const sx=0.92+r()*0.16,sy=0.95+r()*0.14,sz=0.92+r()*0.16;
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',V.geo.attributes.position);geo.setAttribute('normal',V.geo.attributes.normal);geo.setIndex(V.geo.index);
  const colA=new THREE.BufferAttribute(V.baseCol.slice(),3);geo.setAttribute('color',colA);
  const body=new THREE.Mesh(geo,new THREE.MeshPhysicalMaterial({vertexColors:true,roughness:0.3,clearcoat:1,clearcoatRoughness:0.06,envMapIntensity:1.1,emissive:lin(0x2a0204)}));
  body.castShadow=true;g.add(body);
  const seeds=new THREE.InstancedMesh(SEED_GEO,SEED_MAT,V.N);seeds.instanceMatrix.array.set(V.mats);seeds.frustumCulled=false;g.add(seeds);
  for(let i=0;i<drops;i++){const{P,n}=V.place(0.15+r()*0.7,r()*6.283),d=new THREE.Mesh(DROP_GEO,DROP_MAT),k=0.012+r()*0.014;
    d.position.copy(P).addScaledVector(n,0.004);d.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),n);d.scale.set(k,k*0.45,k);g.add(d);}
  // calyx: thin pointed leaves lying on the shoulder, tips curling up or down
  const lm=new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.55,side:THREE.DoubleSide});
  const shape=new THREE.Shape();shape.moveTo(0,0);shape.bezierCurveTo(0.09,0.08,0.07,0.26,0,0.42);shape.bezierCurveTo(-0.07,0.26,-0.09,0.08,0,0);
  const c1=lin(0xcfdc8c),c2=lin(0x3f9a28),cc=new THREE.Color(),NL=9;
  for(let i=0;i<NL;i++){
    const lg=new THREE.ShapeGeometry(shape,10);lg.rotateX(-Math.PI/2);
    const lp=lg.attributes.position,s=0.8+r()*0.4,curl=-1.5+r()*4.3,cols=new Float32Array(lp.count*3);
    for(let v=0;v<lp.count;v++){const d=-lp.getZ(v)*s,x=lp.getX(v)*s;
      lp.setXYZ(v,x,topY(Math.min(d,0.4))+0.018+curl*Math.pow(Math.max(0,d-0.12),2)+0.3*Math.abs(x),-d);
      cc.copy(c1).lerp(c2,Math.min(1,d/0.18));cols.set([cc.r,cc.g,cc.b],v*3);}
    lg.setAttribute('color',new THREE.BufferAttribute(cols,3));lg.computeVertexNormals();
    const piv=new THREE.Object3D();piv.rotation.y=i*6.283/NL+(r()-0.5)*0.4;piv.add(new THREE.Mesh(lg,lm));g.add(piv);}
  const cap=new THREE.Mesh(new THREE.SphereGeometry(0.08,12,8),new THREE.MeshStandardMaterial({color:lin(0xc2cf78),roughness:0.6}));
  cap.scale.y=0.4;cap.position.y=1.0;g.add(cap);
  const stem=new THREE.Mesh(new THREE.CylinderGeometry(0.014,0.02,0.1,8),new THREE.MeshStandardMaterial({color:lin(0x8fb04a),roughness:0.6}));
  stem.position.y=1.045;stem.rotation.z=(r()-0.5)*0.4;g.add(stem);
  g.scale.set(size*sx,size*sy,size*sz);root.add(g);
  const unripe=lin(0xd8ecb0),c0=new THREE.Color();
  Object.assign(root.userData,{size,mesh:body,ripeness:1,
    setSize(s){g.scale.set(s*sx,s*sy,s*sz);root.userData.size=s;},
    setRipeness(v){root.userData.ripeness=v;const b=V.baseCol;
      for(let i=0;i<colA.count;i++){c0.setRGB(b[i*3],b[i*3+1],b[i*3+2]).lerp(unripe,(1-v)*0.85);colA.setXYZ(i,c0.r,c0.g,c0.b);}
      colA.needsUpdate=true;}});
  return root;
}

// Soft studio reflections so the berries look wet and glossy. Use: scene.environment = createStudioEnvironment(renderer)
export function createStudioEnvironment(renderer){
  const s=new THREE.Scene();
  s.add(new THREE.Mesh(new THREE.SphereGeometry(20,32,16),new THREE.MeshBasicMaterial({color:0x3a0f14,side:THREE.BackSide})));
  const box=(w,h,pos,k,col=0xffffff)=>{const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),
    new THREE.MeshBasicMaterial({color:new THREE.Color(col).multiplyScalar(k),side:THREE.DoubleSide}));m.position.set(...pos);m.lookAt(0,0,0);s.add(m);};
  box(10,4,[0,10,2],6);box(3,8,[-9,3,4],5);box(2,6,[9,2,-4],4,0xffc9a0);box(8,2,[0,-3,-10],2,0xff6a50);
  const pm=new THREE.PMREMGenerator(renderer),t=pm.fromScene(s,0.04).texture;pm.dispose();return t;
}

/* ================= STEP 3: BOWL + HEAP OF STRAWBERRIES ================= */
export function createStrawberryBowl({berrySize=0.5,seed=3}={}){
  const group=new THREE.Group(),bowl=createBowl(),h=bowl.userData.height,r=rng(seed);
  group.add(bowl);const berries=[];group.userData={bowl,berries};
  const tiers=[{R:1.1,y:h*0.9,n:12},{R:0.78,y:h*1.02,n:9},{R:0.42,y:h*1.16,n:6},{R:0,y:h*1.32,n:1}];
  let id=1;const dir=new THREE.Vector3(),up=new THREE.Vector3(0,1,0);
  for(const t of tiers)for(let i=0;i<t.n;i++){
    const a=(i/t.n)*6.283+r()*0.5,rr=t.R*(0.9+r()*0.2);
    const pos=new THREE.Vector3(Math.cos(a)*rr,t.y+(r()-0.5)*0.06,Math.sin(a)*rr);
    dir.set(Math.cos(a)*0.8,0.7,Math.sin(a)*0.8).add(new THREE.Vector3(r()-0.5,r()*0.3,r()-0.5).multiplyScalar(0.7)).normalize();
    const b=createStrawberry({size:berrySize*(0.9+r()*0.25),seed:id++});
    b.quaternion.setFromUnitVectors(up,dir);
    b.rotateY(r()*6.283);
    b.position.copy(pos).addScaledVector(dir,-0.5*b.userData.size);
    b.name='berry-'+(id-1);berries.push(b);group.add(b);}
  // loose berries on the table
  [[-2.2,1.2,0.4],[-1.9,0.55,2.2],[2.3,1.0,-0.5]].forEach(([x,z,tilt],k)=>{
    const b=createStrawberry({size:berrySize,seed:50+k});
    b.rotation.z=Math.PI/2*(k%2?-1:1)+0.2;b.rotation.y=tilt;
    b.position.set(x,berrySize*0.28,z);b.name='berry-loose-'+k;berries.push(b);group.add(b);});
  return group;
}
