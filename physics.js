/* Maleda: a tiny, deterministic rigid-body solver (position-based, substepped) for the berry scenes.
   - Containers (bowl, blender jar) are solids of revolution, given as their real (rho, y) cross-section polygon, the same profile
     the lathe mesh is built from. The signed distance to that solid is baked once into a fine 2D grid.
   - Each berry collides with the solid through its own convex hull: ~60 support points taken from its actual mesh (body + leaves),
     so no visible part can enter the wall in any orientation. Berry vs berry uses a sphere (cheap, and berries may touch).
   - Contacts get restitution, friction and torque, so berries tumble and roll. Gravity may change over time (a tipping bowl).
   Simulated once at start-up, recorded at recHz, and played back by the page. */

// ---------- signed-distance grid of a solid of revolution ----------
// poly: closed polygon [[rho,y],...] of the solid (edges lying on the axis are not surfaces). circles: [[rho,y,r]] extra solids (e.g. a rim bead).
export function makeShell({poly,circles=[],rings=[],rmax,ymin,ymax,res=0.008,pad=0.4}){
  // the grid must reach at least `pad` beyond the solid on every side: outside it, distance >= pad + distance to the grid box
  const segs=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length];if(a[0]<1e-9&&b[0]<1e-9)continue;
    const tx=b[0]-a[0],ty=b[1]-a[1],l=Math.hypot(tx,ty);if(l<1e-9)continue;segs.push([a[0],a[1],tx/l,ty/l,l]);}
  function inside(r,y){let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const [xi,yi]=poly[i],[xj,yj]=poly[j];
    if((yi>y)!==(yj>y)&&r<(xj-xi)*(y-yi)/(yj-yi)+xi)c=!c;}return c;}
  function exact(r,y){let best=1e9;for(const [ax,ay,tx,ty,l] of segs){let t=(r-ax)*tx+(y-ay)*ty;t=t<0?0:t>l?l:t;const dx=r-ax-tx*t,dy=y-ay-ty*t,d=dx*dx+dy*dy;if(d<best)best=d;}
    let d=Math.sqrt(best)*(inside(r,y)?-1:1);for(const [cr,cy,cR] of circles)d=Math.min(d,Math.sqrt((r-cr)*(r-cr)+(y-cy)*(y-cy))-cR);return d;}
  const nx=Math.ceil(rmax/res)+1,ny=Math.ceil((ymax-ymin)/res)+1,G=new Float32Array(nx*ny);
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++)G[j*nx+i]=exact(i*res,ymin+j*res);
  const out={d:0,nr:0,ny:1},RM=(nx-1)*res,YM=ymin+(ny-1)*res;
  const far=(r,y)=>{const dr=Math.max(0,r-RM),dy=Math.max(0,ymin-y,y-YM);return pad+Math.sqrt(dr*dr+dy*dy);};
  // bilinear distance + gradient at (rho,y); far = outside the grid (nothing to hit there)
  function query(r,y){const fx=r/res,fy=(y-ymin)/res;
    if(fx>=nx-1||fy<0||fy>=ny-1){out.d=far(r,y);out.nr=0;out.ny=1;return out;}
    const i=fx|0,j=fy|0,u=fx-i,v=fy-j,k=j*nx+i,a=G[k],b=G[k+1],c=G[k+nx],e=G[k+nx+1];
    out.d=(a*(1-u)+b*u)*(1-v)+(c*(1-u)+e*u)*v;
    let gr=((b-a)*(1-v)+(e-c)*v),gy=((c-a)*(1-u)+(e-b)*u);const l=Math.hypot(gr,gy)||1;out.nr=gr/l;out.ny=gy/l;return out;}
  function qd(r,y){const fx=r/res,fy=(y-ymin)/res;if(fx>=nx-1||fy<0||fy>=ny-1)return far(r,y);
    const i=fx|0,j=fy|0,u=fx-i,v=fy-j,k=j*nx+i;return (G[k]*(1-u)+G[k+1]*u)*(1-v)+(G[k+nx]*(1-u)+G[k+nx+1]*u)*v;}
  return {query,qd,exact,inside,rings};   // rings: [[R,y,r]] thin convex beads (a rim): tested against each berry's support function
}

// support points of a point cloud in ~n directions (a compact convex hull approximation), plus its bounding radius
export function hullOf(pts,n=64){
  const dirs=[];const ga=Math.PI*(3-Math.sqrt(5));for(let i=0;i<n;i++){const y=1-2*(i+0.5)/n,r=Math.sqrt(1-y*y),a=i*ga;dirs.push([Math.cos(a)*r,y,Math.sin(a)*r]);}
  const pick=new Set();for(const [dx,dy,dz] of dirs){let best=-1e9,bi=0;for(let i=0;i<pts.length;i+=3){const s=pts[i]*dx+pts[i+1]*dy+pts[i+2]*dz;if(s>best){best=s;bi=i;}}pick.add(bi);}
  let R=0,far=0;for(let i=0;i<pts.length;i+=3){const d=Math.hypot(pts[i],pts[i+1],pts[i+2]);if(d>R){R=d;far=i;}}pick.add(far);   // always keep the farthest point
  const h=new Float32Array(pick.size*3);let k=0;for(const i of pick){h[k++]=pts[i];h[k++]=pts[i+1];h[k++]=pts[i+2];}
  return {pts:h,R};
}

export function simulateBodies({shell,hulls,radii,spawns,g=42,gravity=null,guard=null,release=null,hz=480,recHz=60,maxT=7.5,
  restitution=0.28,friction=0.35,settleDelay=1.1,settleRate=45,margin=0.012,stopWhenSettled=true,allowSleep=true,staticDamp=true,coulomb=0,
  compounds=null,muB=0.6,sleepRest=0.4,sleepSpeed=0.05,settleGrace=1.2,iters=3}){
  const T0=performance.now(),N=radii.length,dt=1/hz;
  const P=new Float64Array(N*3),V=new Float64Array(N*3),Q=new Float64Array(N*4),W=new Float64Array(N*3),act=new Uint8Array(N),rest=new Float64Array(N);
  for(let i=0;i<N;i++){const s=spawns[i];P.set(s.p,i*3);V.set(s.v,i*3);Q.set(s.q,i*4);W.set(s.w,i*3);}
  // hull points sorted far-to-near, with their distance from the centre: a point can only touch the wall if centreDist - |p| < margin
  hulls=hulls.map(h=>{const ix=[...Array(h.length/3).keys()].sort((a,b)=>Math.sqrt((h[b*3])*(h[b*3])+(h[b*3+1])*(h[b*3+1])+(h[b*3+2])*(h[b*3+2]))-Math.sqrt((h[a*3])*(h[a*3])+(h[a*3+1])*(h[a*3+1])+(h[a*3+2])*(h[a*3+2])));
    const o=new Float64Array(h.length);ix.forEach((j,k)=>{o[k*3]=h[j*3];o[k*3+1]=h[j*3+1];o[k*3+2]=h[j*3+2];});return o;});
  const HN=hulls.map(h=>{const n=new Float64Array(h.length/3);for(let k=0;k<n.length;k++)n[k]=Math.sqrt((h[k*3])*(h[k*3])+(h[k*3+1])*(h[k*3+1])+(h[k*3+2])*(h[k*3+2]));return n;});
  const HR=HN.map(n=>n[0]);
  // a coarse subset (support points in 40 directions) for the cheap iterations; the full hull is used on the last iteration
  const CH=hulls.map(h=>{const sel=new Set();const ga=Math.PI*(3-Math.sqrt(5));for(let d=0;d<40;d++){const y=1-2*(d+0.5)/40,r=Math.sqrt(1-y*y),a=d*ga,dx=Math.cos(a)*r,dz=Math.sin(a)*r;
    let best=-1e9,bi=0;for(let k=0;k<h.length;k+=3){const s=h[k]*dx+h[k+1]*y+h[k+2]*dz;if(s>best){best=s;bi=k;}}sel.add(bi);}sel.add(0);return [...sel].sort((a,b)=>a-b);});
  const tmp=hulls.map(h=>new Float64Array(h.length)),rotOK=new Uint8Array(N);
  // optional berry-vs-berry contact on the real shape: each body is a chain of spheres inscribed in its visual body mesh,
  // and the other body's hull points (leaves, cap, stem) are tested against those spheres too
  const CS=compounds?compounds.map(c=>new Float64Array(c.length)):null;
  function rotComp(i){const c=compounds[i],o=CS[i],q=i*4,x=Q[q],y=Q[q+1],z=Q[q+2],w=Q[q+3];
    for(let k=0;k<c.length;k+=4){const vx=c[k],vy=c[k+1],vz=c[k+2],tx=2*(y*vz-z*vy),ty=2*(z*vx-x*vz),tz=2*(x*vy-y*vx);
      o[k]=vx+w*tx+(y*tz-z*ty);o[k+1]=vy+w*ty+(z*tx-x*tz);o[k+2]=vz+w*tz+(x*ty-y*tx);o[k+3]=c[k+3];}}
  function pairContact(i,j,nx,ny,nz,pen,first,rix,riy,riz,rjx,rjy,rjz){
    const ki=i*3,kj=j*3;
    if(sleep[i]||sleep[j]){const rv=Math.sqrt((V[ki]-V[kj])*(V[ki]-V[kj])+(V[ki+1]-V[kj+1])*(V[ki+1]-V[kj+1])+(V[ki+2]-V[kj+2])*(V[ki+2]-V[kj+2]));
      if(rv>0.6||pen>0.02){sleep[i]=sleep[j]=0;rest[i]=rest[j]=0;}
      else{if(sleep[j]){P[ki]+=nx*pen;P[ki+1]+=ny*pen;P[ki+2]+=nz*pen;const vn=V[ki]*nx+V[ki+1]*ny+V[ki+2]*nz;if(vn<0){V[ki]-=nx*vn;V[ki+1]-=ny*vn;V[ki+2]-=nz*vn;}}
        else{P[kj]-=nx*pen;P[kj+1]-=ny*pen;P[kj+2]-=nz*pen;const vn=V[kj]*nx+V[kj+1]*ny+V[kj+2]*nz;if(vn>0){V[kj]-=nx*vn;V[kj+1]-=ny*vn;V[kj+2]-=nz*vn;}}
        touch[i]=touch[j]=1;return;}}
    const c=pen*0.5;P[ki]+=nx*c;P[ki+1]+=ny*c;P[ki+2]+=nz*c;P[kj]-=nx*c;P[kj+1]-=ny*c;P[kj+2]-=nz*c;touch[i]=touch[j]=1;
    if(!first)return;
    const Ii=0.4*radii[i]*radii[i],Ij=0.4*radii[j]*radii[j];
    const vix=V[ki]+W[ki+1]*riz-W[ki+2]*riy,viy=V[ki+1]+W[ki+2]*rix-W[ki]*riz,viz=V[ki+2]+W[ki]*riy-W[ki+1]*rix;
    const vjx=V[kj]+W[kj+1]*rjz-W[kj+2]*rjy,vjy=V[kj+1]+W[kj+2]*rjx-W[kj]*rjz,vjz=V[kj+2]+W[kj]*rjy-W[kj+1]*rjx;
    const rvx=vix-vjx,rvy=viy-vjy,rvz=viz-vjz,vn=rvx*nx+rvy*ny+rvz*nz;if(vn>=0)return;
    const cix=riy*nz-riz*ny,ciy=riz*nx-rix*nz,ciz=rix*ny-riy*nx,cjx=rjy*nz-rjz*ny,cjy=rjz*nx-rjx*nz,cjz=rjx*ny-rjy*nx;
    const kk=2+(cix*cix+ciy*ciy+ciz*ciz)/Ii+(cjx*cjx+cjy*cjy+cjz*cjz)/Ij,jn=-(1+restitution*0.6)*vn/kk;
    let ix=nx*jn,iy=ny*jn,iz=nz*jn;
    const tx=rvx-nx*vn,ty=rvy-ny*vn,tz=rvz-nz*vn,vt=Math.sqrt(tx*tx+ty*ty+tz*tz);
    if(vt>1e-9){const jt=Math.min(vt/kk,muB*jn);ix-=tx/vt*jt;iy-=ty/vt*jt;iz-=tz/vt*jt;}
    V[ki]+=ix;V[ki+1]+=iy;V[ki+2]+=iz;V[kj]-=ix;V[kj+1]-=iy;V[kj+2]-=iz;
    W[ki]+=(riy*iz-riz*iy)/Ii;W[ki+1]+=(riz*ix-rix*iz)/Ii;W[ki+2]+=(rix*iy-riy*ix)/Ii;
    W[kj]-=(rjy*iz-rjz*iy)/Ij;W[kj+1]-=(rjz*ix-rjx*iz)/Ij;W[kj+2]-=(rjx*iy-rjy*ix)/Ij;}
  function compoundPair(i,j,first){
    const ki=i*3,kj=j*3,A=CS[i],B=CS[j];
    for(let a=0;a<A.length;a+=4)for(let b=0;b<B.length;b+=4){
      const ax=P[ki]+A[a],ay=P[ki+1]+A[a+1],az=P[ki+2]+A[a+2],bx=P[kj]+B[b],by=P[kj+1]+B[b+1],bz=P[kj+2]+B[b+2];
      const dx=ax-bx,dy=ay-by,dz=az-bz,m=A[a+3]+B[b+3],d2=dx*dx+dy*dy+dz*dz;if(d2>=m*m||d2<1e-12)continue;
      const d=Math.sqrt(d2),nx=dx/d,ny=dy/d,nz=dz/d;
      pairContact(i,j,nx,ny,nz,m-d,first,A[a]-nx*A[a+3],A[a+1]-ny*A[a+3],A[a+2]-nz*A[a+3],B[b]+nx*B[b+3],B[b+1]+ny*B[b+3],B[b+2]+nz*B[b+3]);}
    // hull points (leaves, cap, stem) of one body against the other's spheres
    for(let s=0;s<2;s++){const u=s?j:i,v=s?i:j,ku=u*3,kv=v*3,o=tmp[u],C=CS[v],ci=CH[u];
      const dxc=P[ku]-P[kv],dyc=P[ku+1]-P[kv+1],dzc=P[ku+2]-P[kv+2];
      for(let q=0;q<ci.length;q++){const p=ci[q],px=P[ku]+o[p],py=P[ku+1]+o[p+1],pz=P[ku+2]+o[p+2];
        for(let b=0;b<C.length;b+=4){const cx=P[kv]+C[b],cy=P[kv+1]+C[b+1],cz=P[kv+2]+C[b+2],dx=px-cx,dy=py-cy,dz=pz-cz,r=C[b+3],d2=dx*dx+dy*dy+dz*dz;
          if(d2>=r*r||d2<1e-12)continue;const d=Math.sqrt(d2),nx=dx/d,ny=dy/d,nz=dz/d;
          if(s===0)pairContact(u,v,nx,ny,nz,r-d,first,o[p],o[p+1],o[p+2],px-nx*(r-d)-P[kv],py-ny*(r-d)-P[kv+1],pz-nz*(r-d)-P[kv+2]);
          else pairContact(v,u,-nx,-ny,-nz,r-d,first,px-nx*(r-d)-P[kv],py-ny*(r-d)-P[kv+1],pz-nz*(r-d)-P[kv+2],o[p],o[p+1],o[p+2]);}}}}   // hull points rotated into the world (lazily, once per step)
  const F=Math.ceil(maxT*recHz)+1,rec=new Float32Array(F*N*7),stepsPerRec=Math.round(hz/recHz),rel=new Array(N).fill(null);
  let frame=0,settledAt=-1,everPen=0;const lastSpawn=Math.max(...spawns.map(s=>s.t)),grav=[0,-g,0];
  function record(){const o=frame*N*7;for(let i=0;i<N;i++){const k=o+i*7;rec[k]=P[i*3];rec[k+1]=P[i*3+1];rec[k+2]=P[i*3+2];
    rec[k+3]=Q[i*4];rec[k+4]=Q[i*4+1];rec[k+5]=Q[i*4+2];rec[k+6]=Q[i*4+3];}frame++;}
  function rotHull(i){const h=hulls[i],o=tmp[i],q=i*4,x=Q[q],y=Q[q+1],z=Q[q+2],w=Q[q+3];
    for(let k=0;k<h.length;k+=3){const vx=h[k],vy=h[k+1],vz=h[k+2],tx=2*(y*vz-z*vy),ty=2*(z*vx-x*vz),tz=2*(x*vy-y*vx);
      o[k]=vx+w*tx+(y*tz-z*ty);o[k+1]=vy+w*ty+(z*tx-x*tz);o[k+2]=vz+w*tz+(x*ty-y*tx);}}
  record();
  const touch=new Uint8Array(N),sleep=new Uint8Array(N);
  for(let step=1;frame<F;step++){
    const t=step*dt;if(gravity)gravity(t,grav);
    for(let i=0;i<N;i++){
      if(act[i]===2)continue;
      if(!act[i]){if(t>=spawns[i].t)act[i]=1;else continue;}
      if(sleep[i]){touch[i]=1;continue;}
      const k=i*3;V[k]+=grav[0]*dt;V[k+1]+=grav[1]*dt;V[k+2]+=grav[2]*dt;const air=1-0.15*dt;V[k]*=air;V[k+1]*=air;V[k+2]*=air;
      P[k]+=V[k]*dt;P[k+1]+=V[k+1]*dt;P[k+2]+=V[k+2]*dt;
      const q=i*4,wx=W[k],wy=W[k+1],wz=W[k+2],x=Q[q],y=Q[q+1],z=Q[q+2],w=Q[q+3],h=0.5*dt;
      let nx=x+h*(wx*w+wy*z-wz*y),ny=y+h*(wy*w+wz*x-wx*z),nz=z+h*(wz*w+wx*y-wy*x),nw=w-h*(wx*x+wy*y+wz*z);
      const l=1/Math.sqrt((nx)*(nx)+(ny)*(ny)+(nz)*(nz)+(nw)*(nw));Q[q]=nx*l;Q[q+1]=ny*l;Q[q+2]=nz*l;Q[q+3]=nw*l;
      touch[i]=0;rotOK[i]=0;
    }
    for(let it=0;it<iters;it++){
      const first=it===0;
      // berry vs berry: compound shapes (real body + leaves) when given, else plain spheres
      if(compounds){for(let i=0;i<N;i++){if(act[i]!==1)continue;if(!rotOK[i]){rotHull(i);rotOK[i]=1;}if(first)rotComp(i);}
        for(let i=0;i<N;i++){if(act[i]!==1)continue;const ki=i*3;
          for(let j=i+1;j<N;j++){if(act[j]!==1)continue;if(sleep[i]&&sleep[j])continue;const kj=j*3,dx=P[ki]-P[kj],dy=P[ki+1]-P[kj+1],dz=P[ki+2]-P[kj+2],m=HR[i]+HR[j];
            if(dx*dx+dy*dy+dz*dz>=m*m)continue;compoundPair(i,j,first);}}}
      else for(let i=0;i<N;i++){if(act[i]!==1)continue;const ki=i*3;
        for(let j=i+1;j<N;j++){if(act[j]!==1)continue;const kj=j*3;
          const dx=P[ki]-P[kj],dy=P[ki+1]-P[kj+1],dz=P[ki+2]-P[kj+2],m=radii[i]+radii[j],d2=dx*dx+dy*dy+dz*dz;
          if(d2>=m*m||d2<1e-12)continue;
          if(sleep[i]&&sleep[j])continue;
          const d=Math.sqrt(d2),nx=dx/d,ny=dy/d,nz=dz/d;
          if(sleep[i]||sleep[j]){const rv=Math.sqrt((V[ki]-V[kj])*(V[ki]-V[kj])+(V[ki+1]-V[kj+1])*(V[ki+1]-V[kj+1])+(V[ki+2]-V[kj+2])*(V[ki+2]-V[kj+2]));
            if(rv>0.6||m-d>0.02){sleep[i]=sleep[j]=0;rest[i]=rest[j]=0;}                 // a real knock wakes it
            else{const c=m-d;if(sleep[j]){P[ki]+=nx*c;P[ki+1]+=ny*c;P[ki+2]+=nz*c;const vn=V[ki]*nx+V[ki+1]*ny+V[ki+2]*nz;if(vn<0){V[ki]-=nx*vn;V[ki+1]-=ny*vn;V[ki+2]-=nz*vn;}}
              else{P[kj]-=nx*c;P[kj+1]-=ny*c;P[kj+2]-=nz*c;const vn=V[kj]*nx+V[kj+1]*ny+V[kj+2]*nz;if(vn>0){V[kj]-=nx*vn;V[kj+1]-=ny*vn;V[kj+2]-=nz*vn;}}
              touch[i]=touch[j]=1;continue;}}
          const c=(m-d)*0.5;
          P[ki]+=nx*c;P[ki+1]+=ny*c;P[ki+2]+=nz*c;P[kj]-=nx*c;P[kj+1]-=ny*c;P[kj+2]-=nz*c;touch[i]=touch[j]=1;
          if(first){const rvx=V[ki]-V[kj],rvy=V[ki+1]-V[kj+1],rvz=V[ki+2]-V[kj+2],vn=rvx*nx+rvy*ny+rvz*nz;
            if(vn<0){const jn=-(1+restitution*0.6)*vn*0.5;V[ki]+=nx*jn;V[ki+1]+=ny*jn;V[ki+2]+=nz*jn;V[kj]-=nx*jn;V[kj+1]-=ny*jn;V[kj+2]-=nz*jn;}
            const tx=rvx-nx*vn,ty=rvy-ny*vn,tz=rvz-nz*vn,f=friction*0.5;
            V[ki]-=tx*f;V[ki+1]-=ty*f;V[ki+2]-=tz*f;V[kj]+=tx*f;V[kj+1]+=ty*f;V[kj+2]+=tz*f;}
        }}
      // berry hull vs container solid
      for(let i=0;i<N;i++){if(act[i]!==1)continue;const k=i*3;
        if((it>0&&it<iters-1&&(it%2===1||!compounds))||sleep[i])continue;   // hull contacts: coarse first, the full hull on the last iteration
        let cd=shell.qd(Math.sqrt(P[k]*P[k]+P[k+2]*P[k+2]),P[k+1]);if(cd>HR[i]+margin+0.01)continue;
        if(!rotOK[i]){rotHull(i);rotOK[i]=1;}
        const o=tmp[i],hn=HN[i],I=0.4*radii[i]*radii[i];
        for(let pass=0;pass<2;pass++){
          if(pass)cd=shell.qd(Math.sqrt(P[k]*P[k]+P[k+2]*P[k+2]),P[k+1]);
          let md=1e9,mk=-1,mnx=0,mny=0,mnz=0;
          const ci=CH[i],nP=it<iters-1?ci.length:o.length/3;
          const Px=P[k],Py=P[k+1],Pz=P[k+2];
          for(let q=0;q<nP;q++){const p=it<iters-1?ci[q]:q*3;if(cd-hn[p/3]>=margin)break;
            const x=Px+o[p],z=Pz+o[p+2],d=shell.qd(Math.sqrt(x*x+z*z),Py+o[p+1]);if(d<md){md=d;mk=p;}}
          if(md<margin){const x=Px+o[mk],z=Pz+o[mk+2],rho=Math.sqrt(x*x+z*z),s=shell.query(rho,Py+o[mk+1]);
            const ux=rho>1e-6?x/rho:1,uz=rho>1e-6?z/rho:0;mnx=s.nr*ux;mny=s.ny;mnz=s.nr*uz;}
          if(md>=margin)break;
          const pen=margin-md;P[k]+=mnx*pen;P[k+1]+=mny*pen;P[k+2]+=mnz*pen;touch[i]=1;
          if(pen-margin>everPen&&t>spawns[i].t+0.05)everPen=pen-margin;
          if(first&&pass===0){const rx=o[mk],ry=o[mk+1],rz=o[mk+2];
            // contact point velocity v + w x r
            let cvx=V[k]+W[k+1]*rz-W[k+2]*ry,cvy=V[k+1]+W[k+2]*rx-W[k]*rz,cvz=V[k+2]+W[k]*ry-W[k+1]*rx;const vn=cvx*mnx+cvy*mny+cvz*mnz;
            const cx=ry*mnz-rz*mny,cy=rz*mnx-rx*mnz,cz=rx*mny-ry*mnx,kk=1+(cx*cx+cy*cy+cz*cz)/I;
            let jn=0;if(vn<0){jn=-(1+restitution)*vn/kk;V[k]+=mnx*jn;V[k+1]+=mny*jn;V[k+2]+=mnz*jn;W[k]+=cx*jn/I;W[k+1]+=cy*jn/I;W[k+2]+=cz*jn/I;}
            cvx=V[k]+W[k+1]*rz-W[k+2]*ry;cvy=V[k+1]+W[k+2]*rx-W[k]*rz;cvz=V[k+2]+W[k]*ry-W[k+1]*rx;
            const vn2=cvx*mnx+cvy*mny+cvz*mnz;let fk=friction;
            if(coulomb){const vt=Math.sqrt((cvx-mnx*vn2)*(cvx-mnx*vn2)+(cvy-mny*vn2)*(cvy-mny*vn2)+(cvz-mnz*vn2)*(cvz-mnz*vn2));fk=vt>1e-9?Math.min(1,coulomb*jn*kk/vt)*0.5:0;}   // Coulomb: bounded by mu x normal impulse
            const tx=(cvx-mnx*vn2)*fk,ty=(cvy-mny*vn2)*fk,tz=(cvz-mnz*vn2)*fk;
            V[k]-=tx;V[k+1]-=ty;V[k+2]-=tz;const s=0.5/I;           // friction also spins the berry (rolling)
            W[k]-=(ry*tz-rz*ty)*s;W[k+1]-=(rz*tx-rx*tz)*s;W[k+2]-=(rx*ty-ry*tx)*s;
            const wl=Math.sqrt((W[k])*(W[k])+(W[k+1])*(W[k+1])+(W[k+2])*(W[k+2]));if(wl>25){W[k]*=25/wl;W[k+1]*=25/wl;W[k+2]*=25/wl;}}
        }
        // rim beads: a convex edge can poke into a berry between its hull points, so test the berry's support function instead
        if(!rotOK[i]){rotHull(i);rotOK[i]=1;}
        for(let ri=0;ri<shell.rings.length;ri++){const RG=shell.rings[ri],Rc=RG[0],yc=RG[1],br=RG[2],x=P[k],y=P[k+1],z=P[k+2],rho=Math.sqrt((x)*(x)+(z)*(z))||1e-6;
          const px=Rc*x/rho,pz=Rc*z/rho,vx=px-x,vy=yc-y,vz=pz-z,L=Math.sqrt((vx)*(vx)+(vy)*(vy)+(vz)*(vz));if(L>HR[i]+br+margin)continue;
          const dx=vx/L,dy=vy/L,dz=vz/L;let hs=-1e9;for(let p=0;p<o.length;p+=3){const s2=o[p]*dx+o[p+1]*dy+o[p+2]*dz;if(s2>hs)hs=s2;}
          const pen=hs+br+margin-L;if(pen<=0)continue;P[k]-=dx*pen;P[k+1]-=dy*pen;P[k+2]-=dz*pen;touch[i]=1;
          if(first){const vn=V[k]*dx+V[k+1]*dy+V[k+2]*dz;if(vn>0){const j=(1+restitution)*vn;V[k]-=dx*j;V[k+1]-=dy*j;V[k+2]-=dz*j;}
            const vn2=V[k]*dx+V[k+1]*dy+V[k+2]*dz;V[k]-=(V[k]-dx*vn2)*friction*0.5;V[k+1]-=(V[k+1]-dy*vn2)*friction*0.5;V[k+2]-=(V[k+2]-dz*vn2)*friction*0.5;}}
        if(guard){const x=P[k],z=P[k+2],rho=Math.sqrt((x)*(x)+(z)*(z)),lim=guard.rimR-radii[i]-0.01;      // invisible column over the opening
          if(P[k+1]>=guard.rimY-0.05&&rho>lim){const s=lim/rho;P[k]*=s;P[k+2]*=s;const ux=x/rho,uz=z/rho,vr=V[k]*ux+V[k+2]*uz;
            if(vr>0){V[k]-=ux*vr*(1+restitution);V[k+2]-=uz*vr*(1+restitution);}}}
      }
    }
    const late=t-lastSpawn-settleDelay;if(late>0){const kd=Math.exp(-dt*Math.min(60,late*settleRate));for(let i=0;i<N*3;i++){V[i]*=kd;W[i]*=kd;}}
    let moving=0;
    for(let i=0;i<N;i++){if(act[i]===2)continue;if(!act[i]){moving++;continue;}const k=i*3;
      if(sleep[i])continue;
      if(touch[i]){W[k]*=0.985;W[k+1]*=0.985;W[k+2]*=0.985;
        const sp=Math.sqrt((V[k])*(V[k])+(V[k+1])*(V[k+1])+(V[k+2])*(V[k+2]));if(staticDamp&&sp<0.25){V[k]*=0.9;V[k+1]*=0.9;V[k+2]*=0.9;W[k]*=0.95;W[k+1]*=0.95;W[k+2]*=0.95;}
        if(sp<sleepSpeed)rest[i]+=dt;else rest[i]=0;}
      else{W[k]*=0.9995;W[k+1]*=0.9995;W[k+2]*=0.9995;rest[i]=0;}
      if(rest[i]<0.25&&late<settleGrace)moving++;
      if(allowSleep&&rest[i]>sleepRest){sleep[i]=1;V[k]=V[k+1]=V[k+2]=0;W[k]=W[k+1]=W[k+2]=0;}
      if(release&&release(i,P[k],P[k+1],P[k+2],t)){act[i]=2;rel[i]={t,p:[P[k],P[k+1],P[k+2]],v:[V[k],V[k+1],V[k+2]],q:[Q[i*4],Q[i*4+1],Q[i*4+2],Q[i*4+3]],w:[W[k],W[k+1],W[k+2]]};}}
    if(step%stepsPerRec===0)record();
    if(!moving&&settledAt<0)settledAt=t;
    if(stopWhenSettled&&settledAt>=0&&t>settledAt+0.3){while(frame<F){record();}}
  }
  const fin=[];const o=(F-1)*N*7;for(let i=0;i<N;i++){const k=o+i*7;fin.push({p:[rec[k],rec[k+1],rec[k+2]],q:[rec[k+3],rec[k+4],rec[k+5],rec[k+6]]});}
  let tail=0;{const a=(F-1)*N*7,b=Math.max(0,F-1-Math.round(0.25*recHz))*N*7;for(let i=0;i<N;i++){if(act[i]===2)continue;const ka=a+i*7,kb=b+i*7;tail=Math.max(tail,Math.sqrt((rec[ka]-rec[kb])*(rec[ka]-rec[kb])+(rec[ka+1]-rec[kb+1])*(rec[ka+1]-rec[kb+1])+(rec[ka+2]-rec[kb+2])*(rec[ka+2]-rec[kb+2])));}}
  let over=0;for(let i=0;i<N;i++)for(let j=i+1;j<N;j++){if(rel[i]||rel[j])continue;const a=fin[i].p,b=fin[j].p;over=Math.max(over,radii[i]+radii[j]-Math.sqrt((a[0]-b[0])*(a[0]-b[0])+(a[1]-b[1])*(a[1]-b[1])+(a[2]-b[2])*(a[2]-b[2])));}
  return {rec,frames:F,recHz,fin,rel,settledAt,stats:{ms:Math.round(performance.now()-T0),hullPts:Math.round(hulls.reduce((a,h)=>a+h.length/3,0)/N),hullPenMax:+everPen.toFixed(4),tailMove:+tail.toFixed(4),maxOverlap:+over.toFixed(4),settledAt:+settledAt.toFixed(2),released:rel.filter(Boolean).length}};
}
