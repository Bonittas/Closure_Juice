import * as THREE from 'three';
import { lin } from './strawberry_bowl.js';
import { GLASS, gOut } from './glass.js';

/* =====================================================================================
   Visual identity of the five scenes: backdrop, counter material, lighting, atmosphere.
   Nothing here touches the existing models; main.js just asks for look(i).
   ===================================================================================== */

const rgb = h => new THREE.Vector3(((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255);
const srgb = t => { if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace; else t.encoding = THREE.sRGBEncoding; return t; };
function rng(seed) { let s = (seed * 9301 + 49297) >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }

/* ---------- the five looks ---------- */
export const LOOKS = [
  { // 1 · burgundy studio, polished dark marble
    name: 'burgundy', top: 0x12020a, hor: 0x5a0a14, bot: 0x1c0409, glow: 0xd1161f, glowPos: [0.5, 0.45], glowR: 0.5, glowI: 0.55,
    counter: 'marble', roughness: 0.2, metalness: 0.05, repeat: 9, fogDensity: 0.05,
    exposure: 0.8, hemi: [0xffe1d0, 0x3a1118, 0.3], key: [0xffe2c4, 1.35, -3, 9, 7], rim: [0xff4a3a, 1.7, 7, 4, -5],
    fill: [0xffb8a0, 0.22, 8, 3, 8], spot: [0xffe9d2, 1.5, 3.6, 8.5, 5.5, 3.6, 1.2, 0.9], mote: 0xffb4a0, moteOp: 0.45
  },
  { // 2 · dark chocolate kitchen, walnut counter, tungsten light
    name: 'chocolate', top: 0x120805, hor: 0x40200f, bot: 0x1a0d06, glow: 0xd98a4a, glowPos: [0.5, 0.5], glowR: 0.55, glowI: 0.36,
    counter: 'wood', roughness: 0.38, metalness: 0.0, repeat: 8, fogDensity: 0.045,
    exposure: 0.8, hemi: [0xffd9b0, 0x2a1409, 0.34], key: [0xffd2a0, 1.35, -5, 9, 5], rim: [0xff9a50, 1.4, 2, 4, -6],
    fill: [0xffc89a, 0.22, 7, 3, 8], spot: [0xffd9a8, 1.5, 1.8, 9, 6, 1.5, 1.8, 0.4], mote: 0xffc88a, moteOp: 0.5
  },
  { // 3 · cool slate studio, the blending scene
    name: 'slate', top: 0x04090c, hor: 0x1b3a46, bot: 0x0a171c, glow: 0x5aa0b4, glowPos: [0.5, 0.52], glowR: 0.5, glowI: 0.3,
    counter: 'slate', roughness: 0.42, metalness: 0.05, repeat: 8, fogDensity: 0.05,
    exposure: 0.85, hemi: [0xcfe6f2, 0x16252b, 0.4], key: [0xf2f6ff, 1.25, -4, 9, 6], rim: [0x7fd0e6, 1.5, 3, 4, -6],
    fill: [0xffc9b0, 0.35, 6, 2.5, 8], spot: [0xfff0e0, 1.4, 0.5, 9, 5, 0, 2.4, 0], mote: 0xbfe4f0, moteOp: 0.4
  },
  { // 4 · aubergine and rose, polished granite, the pour
    name: 'aubergine', top: 0x120513, hor: 0x4a2043, bot: 0x1c0a1b, glow: 0xd27aa6, glowPos: [0.45, 0.5], glowR: 0.5, glowI: 0.32,
    counter: 'granite', roughness: 0.25, metalness: 0.05, repeat: 8, fogDensity: 0.05,
    exposure: 0.85, hemi: [0xffd6e4, 0x2a1228, 0.38], key: [0xfff0e6, 1.3, -5, 9, 5], rim: [0xff78b4, 1.6, 4, 4, -6],
    fill: [0xffd0c0, 0.3, 7, 3, 8], spot: [0xfff0e8, 1.6, -3.4, 8.5, 5, -3.2, 1.6, 0.9], mote: 0xffc4de, moteOp: 0.45
  },
  { // 5 · black-red luxury product stage, lacquered counter
    name: 'crimson', top: 0x080104, hor: 0x4a0710, bot: 0x120206, glow: 0xff3a30, glowPos: [0.5, 0.56], glowR: 0.4, glowI: 0.62,
    counter: 'lacquer', roughness: 0.14, metalness: 0.2, repeat: 8, fogDensity: 0.055,
    exposure: 0.8, hemi: [0xffd0c4, 0x2a0508, 0.26], key: [0xfff0e0, 1.6, -4, 9, 5], rim: [0xff3d2e, 2.0, 5, 3.5, -6],
    fill: [0xffc0a8, 0.3, 7, 3, 7], spot: [0xfff4e8, 2.0, -3.4, 9, 4.5, -3.4, 1.8, 0.9], mote: 0xff9a80, moteOp: 0.5
  }
];

/* ---------- screen-space gradient backdrop (one quad, uniforms switched per scene) ---------- */
export function createBackdrop() {
  const u = {
    uTop: { value: new THREE.Vector3() }, uHor: { value: new THREE.Vector3() }, uBot: { value: new THREE.Vector3() },
    uGlow: { value: new THREE.Vector3() }, uGlowPos: { value: new THREE.Vector2(0.5, 0.5) },
    uGlowR: { value: 0.5 }, uGlowI: { value: 0.5 }, uAspect: { value: 1 }, uShift: { value: 0 }
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, depthTest: false, depthWrite: false, fog: false,
    vertexShader: 'varying vec2 vUv;void main(){vUv=position.xy*0.5+0.5;gl_Position=vec4(position.xy,1.0,1.0);}',
    fragmentShader: `varying vec2 vUv;uniform vec3 uTop,uHor,uBot,uGlow;uniform vec2 uGlowPos;uniform float uGlowR,uGlowI,uAspect,uShift;
      float h(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
      void main(){
        float y=vUv.y;vec3 c=mix(uBot,uHor,smoothstep(0.0,0.45,y));c=mix(c,uTop,smoothstep(0.45,1.0,y));
        vec2 d=(vUv-uGlowPos-vec2(uShift,0.0))*vec2(uAspect,1.0);
        c+=uGlow*exp(-dot(d,d)/(uGlowR*uGlowR))*uGlowI;
        c+=(h(gl_FragCoord.xy)-0.5)/255.0;
        gl_FragColor=vec4(c,1.0);}`
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false; mesh.renderOrder = -1000;
  return {
    mesh, uniforms: u,
    set(L) {
      u.uTop.value.copy(rgb(L.top)); u.uHor.value.copy(rgb(L.hor)); u.uBot.value.copy(rgb(L.bot)); u.uGlow.value.copy(rgb(L.glow));
      u.uGlowPos.value.set(L.glowPos[0], L.glowPos[1]); u.uGlowR.value = L.glowR; u.uGlowI.value = L.glowI;
    }
  };
}

/* ---------- procedural counter textures (seamless, generated once, small) ---------- */
const hash = (x, y, s) => { let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
const wrap = (i, p) => ((i % p) + p) % p;
function vnoise(x, y, s, px, py) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(wrap(xi, px), wrap(yi, py), s), b = hash(wrap(xi + 1, px), wrap(yi, py), s), c = hash(wrap(xi, px), wrap(yi + 1, py), s), d = hash(wrap(xi + 1, px), wrap(yi + 1, py), s);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}
function fbm(u, v, s, px, py, oct = 4) { let a = 0.5, f = 1, t = 0; for (let i = 0; i < oct; i++) { t += a * vnoise(u * px * f, v * py * f, s + i, px * f, py * f); f *= 2; a *= 0.5; } return t; }
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const col = h => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function counterTexture(type, R, seed) {
  const c = document.createElement('canvas'); c.width = c.height = R; const x = c.getContext('2d'), img = x.createImageData(R, R), d = img.data, r = rng(seed);
  for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
    const u = i / R, v = j / R; let p;
    if (type === 'marble') {
      const n = fbm(u, v, 11, 3, 3, 5), vein = Math.pow(1 - Math.abs(Math.sin((u * 2 + v * 3) * Math.PI * 2 + n * 9)), 22), vein2 = Math.pow(1 - Math.abs(Math.sin((u * 3 - v * 2) * Math.PI * 2 + n * 7 + 2)), 30);
      p = mix3(col(0x1d0b0f), col(0x3a1a20), n); p = mix3(p, col(0xb89a98), vein * 0.5 + vein2 * 0.3);
    } else if (type === 'wood') {
      const plank = Math.floor(v * 6), pv = hash(plank, 3, 5), g = fbm(u, v, 21, 2, 36, 4), rings = 0.5 + 0.5 * Math.sin(g * 34 + pv * 6.28), seam = sstep(0.0, 0.012, (v * 6) % 1) * sstep(0.0, 0.012, 1 - ((v * 6) % 1));
      p = mix3(col(0x24120a), col(0x5a3418), rings * 0.6 + (g - 0.5) * 0.8 + pv * 0.25); p = mix3(col(0x0a0503), p, 0.35 + 0.65 * seam);
    } else if (type === 'slate') {
      const n = fbm(u, v, 31, 6, 6, 5), f = hash(i, j, 9); p = mix3(col(0x182329), col(0x34484f), n); p = mix3(p, col(0x0b1215), f * 0.12);
    } else if (type === 'granite') {
      const n = fbm(u, v, 41, 5, 5, 4), s1 = hash(i, j, 4), s2 = hash(i, j, 8); p = mix3(col(0x24101f), col(0x4a2742), n);
      if (s1 > 0.965) p = mix3(p, col(0xc79ab8), 0.7); else if (s2 > 0.95) p = mix3(p, col(0x080308), 0.8);
    } else { // lacquer
      const n = fbm(u, v, 51, 4, 4, 3), s1 = hash(i, j, 2); p = mix3(col(0x10040a), col(0x2c0a12), n); if (s1 > 0.992) p = mix3(p, col(0x9a4a4a), 0.5);
    }
    const o = (j * R + i) * 4; d[o] = p[0]; d[o + 1] = p[1]; d[o + 2] = p[2]; d[o + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return srgb(t);
}

export function createCounters(mobile) {
  const R = mobile ? 256 : 512, geo = new THREE.PlaneGeometry(90, 90);
  const mats = LOOKS.map((L, i) => {
    const tex = counterTexture(L.counter, R, 100 + i); tex.repeat.set(L.repeat, L.repeat);
    return new THREE.MeshStandardMaterial({ map: tex, roughness: L.roughness, metalness: L.metalness, envMapIntensity: 0.9, fog: true });
  });
  const mesh = new THREE.Mesh(geo, mats[0]); mesh.rotation.x = -Math.PI / 2; mesh.receiveShadow = true;
  return { mesh, mats };
}

/* ---------- floating dust motes (cheap atmosphere, drift with scroll) ---------- */
export function createMotes(mobile) {
  const N = mobile ? 50 : 110, r = rng(77), base = new Float32Array(N * 3), pos = new Float32Array(N * 3), sp = new Float32Array(N);
  for (let i = 0; i < N; i++) { base.set([(r() - 0.5) * 18, r() * 8, -7 + r() * 12], i * 3); sp[i] = 0.5 + r(); }
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ size: 0.11, sizeAttenuation: true, map: new THREE.CanvasTexture(c), transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false;
  return {
    pts,
    update(p) { for (let i = 0; i < N; i++) { pos[i * 3] = base[i * 3] + 0.35 * Math.sin(p * 18 * sp[i] + i); pos[i * 3 + 1] = (base[i * 3 + 1] + p * 6 * sp[i]) % 8; pos[i * 3 + 2] = base[i * 3 + 2]; } geo.attributes.position.needsUpdate = true; },
    set(L) { mat.color.copy(lin(L.mote)); mat.opacity = L.moteOp; }
  };
}

/* ---------- condensation on the outside of the cold glass ---------- */
export function createCondensation(mobile) {
  const g = new THREE.Group(), { H, floor: FL } = GLASS, r = rng(5), o = new THREE.Object3D();
  const mk = (N, kMin, kRange, tall) => {
    const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0, roughness: 0.02, metalness: 0, clearcoat: 1, envMapIntensity: 2.6, depthWrite: false });
    const m = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), mat, N);
    for (let i = 0; i < N; i++) {
      const h = FL + 0.12 + Math.pow(r(), 0.85) * (H - FL - 0.55), a = r() * 6.2832, R = gOut(h) * 1.012 + 0.002, k = kMin + Math.pow(r(), 3) * kRange, st = r() < tall ? 1 + r() * 3.5 : 1 + r() * 0.5;
      o.position.set(Math.cos(a) * R, h, Math.sin(a) * R); o.lookAt(Math.cos(a) * R * 2, h, Math.sin(a) * R * 2);
      o.scale.set(k, k * st, k * 0.5); o.updateMatrix(); m.setMatrixAt(i, o.matrix);
    }
    m.frustumCulled = false; m.renderOrder = 6; g.add(m); return mat;
  };
  const fine = mk(mobile ? 220 : 520, 0.0045, 0.006, 0), big = mk(mobile ? 90 : 190, 0.01, 0.018, 0.35);
  g.visible = false;
  return { group: g, set(v) { g.visible = v > 0.002; fine.opacity = 0.5 * Math.min(1, v * 2); big.opacity = 0.62 * Math.min(1, Math.max(0, v * 1.6 - 0.4) / 0.6 + 0.0001); } };
}
