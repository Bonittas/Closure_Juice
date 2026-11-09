import * as THREE from 'three';
import { lin } from './strawberry_bowl.js';

export const ease=t=>t*t*(3-2*t);
export const rad=d=>d*Math.PI/180;

/* Pure pose of a container: lift (0..1), mv = carry to the target (0..1), te = extra tilt (radians).
   cfg = { lipLocal:{x,y}, home:Vector3, lipTarget:Vector3, liftH, tilt1 }. Writes obj.position / obj.rotation.z and the lip's world position into lipOut. */
const _lip=new THREE.Vector3();
export function carryPose(obj,cfg,lift,mv,te,lipOut=_lip){
  const L=cfg.lipLocal,h=cfg.home,T=cfg.lipTarget,e=ease(mv);
  const lyHome=h.y+L.y+cfg.liftH*ease(lift);
  const lx=h.x+L.x+(T.x-h.x-L.x)*e,ly=lyHome+(T.y-lyHome)*e,lz=h.z+(T.z-h.z)*e;
  const th=cfg.tilt1*e+te,c=Math.cos(th),s=Math.sin(th);
  obj.position.set(lx-(L.x*c-L.y*s),ly-(L.x*s+L.y*c),lz);obj.rotation.z=th;lipOut.set(lx,ly,lz);
  return lipOut;
}

/* Moves a container (jar / milk carton) from its home, lifts it, carries it so that its
   "lip" (pouring edge) sits on lipTarget, tilts it, lets `step` do the pouring, then puts it back. */
export class PourTask{
  constructor(o){
    Object.assign(this,{phase:'wait',lift:0,mv:0,te:0,hold:0,theta:0,atMax:0,lipW:new THREE.Vector3()},o);
    this.pose();
  }
  pose(){
    carryPose(this.obj,this,this.lift,this.mv,this.te,this.lipW);this.theta=this.obj.rotation.z;
  }
  update(dt){
    let fin=false;
    switch(this.phase){
      case 'wait': if(this.ready())this.phase='lift';break;
      case 'lift': this.lift=Math.min(1,this.lift+dt/1.1);if(this.lift>=1)this.phase='move';break;
      case 'move': this.mv=Math.min(1,this.mv+dt/1.9);if(this.mv>=1)this.phase='tilt';break;
      case 'tilt':{
        const max=this.tiltMax-this.tilt1;this.te=Math.min(max,this.te+this.rate*dt);
        const done=this.step(dt,this.theta);
        this.atMax=this.te>=max?this.atMax+dt:0;
        if(done||this.atMax>1.5){this.phase='hold';this.hold=0.4;}
        break;}
      case 'hold': this.step(dt,this.theta);this.hold-=dt;if(this.hold<=0)this.phase='untilt';break;
      case 'untilt': this.step(dt,this.theta);this.te=Math.max(0,this.te-1.0*dt);if(this.te<=0)this.phase='back';break;
      case 'back': this.mv=Math.max(0,this.mv-dt/1.5);if(this.mv<=0)this.phase='down';break;
      case 'down': this.lift=Math.max(0,this.lift-dt/1.0);if(this.lift<=0){fin=true;}break;
    }
    this.pose();
    if(fin&&this.onFinish)this.onFinish();
    return fin;
  }
}

/* A thin curved stream of liquid between two world points */
export class Stream{
  constructor(parent,mat){
    this.mesh=new THREE.Mesh(new THREE.BufferGeometry(),mat);this.mesh.visible=false;this.mesh.frustumCulled=false;parent.add(this.mesh);
    this.curve=new THREE.QuadraticBezierCurve3(new THREE.Vector3(),new THREE.Vector3(),new THREE.Vector3());
  }
  set(from,to,radius){
    if(radius<0.01){this.mesh.visible=false;return;}
    const c=this.curve;c.v0.copy(from);c.v2.copy(to);
    c.v1.set(from.x+(to.x-from.x)*0.8,from.y-0.05,from.z+(to.z-from.z)*0.8);
    this.mesh.geometry.dispose();this.mesh.geometry=new THREE.TubeGeometry(c,14,radius,7,false);this.mesh.visible=true;
  }
  hide(){this.mesh.visible=false;}
}

/* Milk carton: origin at the bottom centre, label faces +z */
export function createMilkCarton(home=new THREE.Vector3(2.1,0,-2.2)){
  const g=new THREE.Group();
  const cv=document.createElement('canvas');cv.width=256;cv.height=360;const x=cv.getContext('2d');
  x.fillStyle='#f7f7f4';x.fillRect(0,0,256,360);
  x.fillStyle='#2f6fb5';x.fillRect(0,0,256,64);x.fillRect(0,300,256,60);
  x.fillStyle='#2f6fb5';x.font='bold 64px Georgia,serif';x.textAlign='center';x.fillText('MILK',128,185);
  x.fillStyle='#fff';x.font='italic 26px Georgia,serif';x.fillText('fresh & whole',128,44);x.fillText('1 litre',128,340);
  x.strokeStyle='#2f6fb5';x.lineWidth=5;x.beginPath();x.moveTo(128,225);x.bezierCurveTo(78,265,86,290,128,290);x.bezierCurveTo(170,290,178,265,128,225);x.stroke();
  const tex=new THREE.CanvasTexture(cv);if(THREE.SRGBColorSpace)tex.colorSpace=THREE.SRGBColorSpace;else tex.encoding=THREE.sRGBEncoding;tex.anisotropy=8;
  const plain=new THREE.MeshStandardMaterial({color:lin(0xf4f4f1),roughness:0.5});
  const label=new THREE.MeshStandardMaterial({map:tex,roughness:0.5});
  const body=new THREE.Mesh(new THREE.BoxGeometry(0.84,1.35,0.84),[plain,plain,plain,plain,label,label]);body.position.y=0.675;g.add(body);
  const sh=new THREE.Shape();sh.moveTo(-0.42,0);sh.lineTo(0.42,0);sh.lineTo(0,0.42);sh.lineTo(-0.42,0);
  const rg=new THREE.ExtrudeGeometry(sh,{depth:0.84,bevelEnabled:false});rg.translate(0,0,-0.42);
  const roof=new THREE.Mesh(rg,plain);roof.position.y=1.35;g.add(roof);
  const fin=new THREE.Mesh(new THREE.BoxGeometry(0.05,0.12,0.84),plain);fin.position.y=1.35+0.42+0.05;g.add(fin);
  const spout=new THREE.Mesh(new THREE.BoxGeometry(0.2,0.1,0.28),new THREE.MeshStandardMaterial({color:lin(0x2f6fb5),roughness:0.4}));
  spout.position.set(-0.47,1.4,0);spout.rotation.z=0.3;g.add(spout);
  g.traverse(o=>{if(o.isMesh)o.castShadow=true;});
  g.position.copy(home);
  g.userData={lip:new THREE.Vector2(-0.56,1.42),home:home.clone()};
  return g;
}
