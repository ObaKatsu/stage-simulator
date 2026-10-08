/*! Stage 模擬器 — IPSC Action Air stage 規劃、回放與檢討
 *  Copyright (C) 2026 James
 *  SPDX-License-Identifier: GPL-3.0-or-later
 *  本程式為自由軟體：你可以依自由軟體基金會發布的 GNU 通用公共授權條款第 3 版，
 *  或（由你選擇）任何更新的版本，重新散布或修改本程式。本程式不提供任何保證，
 *  亦不保證適售性或特定目的適用性。完整條款見 LICENSE 或 <https://www.gnu.org/licenses/>。
 */
/* ---------- 3D: three.js renderer (r147, MIT) ----------
   Lighting and shadows, materials (concrete floor, painted panels, wood, scored target faces),
   optional range surroundings, and an animated shooter (Quaternius Universal Base Characters and
   Universal Animation Library, CC0). Draws the same display list that build3d() produces; the 2D
   label overlay, camera model and picking are unchanged. Falls back to the WebGL renderer in 02b. */
const T3 = {on:false, failed:false, renderer:null, scene:null, cam:null, sun:null, dyn:null, bg:null, bgKey:'', mats:new Map(), tex:{},
  assets:null, loading:false, figs:[], figUsed:0, charFailed:false};
const T3_ASSETS = ['vendor/three.min.js', 'vendor/GLTFLoader.js', 'vendor/SkeletonUtils.js'];
const T3_MODELS = ['assets/anims.js', 'assets/model-male.js', 'assets/model-female.js', 'assets/hair-male.js', 'assets/hair-female.js', 'assets/sr-logo.js'];
const W3 = (x, y, z) => new THREE.Vector3(x, z, -y);   // world (x right, y downrange, z up) -> three (y up)
// 3D look: rich / plain background (with shadows), low (no shadows, plain), basic (the WebGL renderer in 02b)
function t3Look(){ const mobile = window.matchMedia && matchMedia('(max-width: 900px)').matches; return UI.look3 || (mobile ? 'low' : 'rich'); }
function t3Settings(){ const l = t3Look(); return {quality:l === 'low' ? 'low' : 'high', bg:l === 'rich' ? 'rich' : 'plain'}; }
function t3Wanted(){ return t3Look() !== 'basic'; }
function t3Script(src){ return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error(src)); document.head.appendChild(s); }); }
// three.js itself is loaded on first use; the models after it (they are several megabytes)
function t3Ensure(){
  if(T3.renderer) return true;
  if(T3.failed || T3.loading) return false;
  if(typeof THREE === 'undefined'){
    T3.loading = true;
    (async () => { try{ for(const s of T3_ASSETS) await t3Script(s); T3.loading = false; if(APP_READY) render3d(); }catch(e){ T3.loading = false; T3.failed = true; if(APP_READY) render3d(); } })();
    return false;
  }
  try{
    const wrap = $('v3dWrap'), c = document.createElement('canvas'); c.id = 'v3dThree'; c.setAttribute('aria-hidden', 'true');
    c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none';
    wrap.insertBefore(c, $('v3dCanvas'));
    const r = new THREE.WebGLRenderer({canvas:c, antialias:true, preserveDrawingBuffer:true});
    r.shadowMap.type = THREE.PCFSoftShadowMap; r.outputEncoding = THREE.sRGBEncoding;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.85;
    c.addEventListener('webglcontextlost', e => { e.preventDefault(); T3.failed = true; c.style.display = 'none'; if(APP_READY) render3d(); });
    const sc = new THREE.Scene(); sc.background = new THREE.Color('#CFD8E0'); sc.fog = new THREE.Fog('#CFD8E0', 30, 80);
    sc.add(new THREE.HemisphereLight('#EEF3F8', '#6B6355', 0.6));
    const sun = new THREE.DirectionalLight('#FFF6E8', 1.25); sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
    sc.add(sun); sc.add(sun.target);
    T3.dyn = new THREE.Group(); T3.bg = new THREE.Group(); sc.add(T3.dyn); sc.add(T3.bg);
    Object.assign(T3, {renderer:r, canvas:c, scene:sc, sun, cam:new THREE.PerspectiveCamera(60, 1, 0.05, 300), on:true});
    t3LoadModels();
    return true;
  }catch(e){ T3.failed = true; return false; }
}
/* ---------- procedural textures ---------- */
function t3CanvasTex(w, h, draw, repeat){
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4;
  if(repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function t3Noise(g, w, h, base, amp, n, seed){
  let s = seed || 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for(let i = 0; i < n; i++){ const a = rnd() * amp; g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,' + a + ')' : 'rgba(255,255,255,' + a + ')'; g.fillRect(rnd()*w, rnd()*h, 1 + rnd()*3, 1 + rnd()*3); }
}
function t3Textures(){
  if(T3.tex.floor) return T3.tex;
  T3.tex.floor = t3CanvasTex(512, 512, (g, w, h) => { t3Noise(g, w, h, '#8F8A80', 0.07, 9000, 3); g.strokeStyle = 'rgba(60,55,50,.18)'; g.lineWidth = 2; g.strokeRect(1, 1, w - 2, h - 2); }, true);
  T3.tex.wood = t3CanvasTex(256, 256, (g, w, h) => { let s = 11; const r = () => (s = (s * 16807) % 2147483647) / 2147483647; g.fillStyle = '#B88A55'; g.fillRect(0, 0, w, h); for(let y = 0; y < h; y += 3){ g.fillStyle = 'rgba(90,60,30,' + (0.05 + r()*0.12) + ')'; g.fillRect(0, y + Math.sin(y)*1.5, w, 1 + r()*2); } }, true);
  T3.tex.panel = t3CanvasTex(256, 256, (g, w, h) => t3Noise(g, w, h, '#9AA8B5', 0.035, 3000, 5), true);
  T3.tex.paper = t3CanvasTex(300, 375, (g, w, h) => {
    // Action Air target: cardboard with scoring-zone lines (App. B2, approximate); the outer octagon is the polygon itself
    t3Noise(g, w, h, '#C9A26A', 0.05, 5000, 9);
    const sx = w / 30, sy = h / 37.5, path = P => { g.beginPath(); P.forEach(([u, v], i) => i ? g.lineTo(u*sx, v*sy) : g.moveTo(u*sx, v*sy)); g.closePath(); };
    g.strokeStyle = 'rgba(90,60,25,.65)'; g.lineWidth = 2;
    path(OCT.map(([u, v]) => [15 + (u - 15) * 0.66, 18 + (v - 18.75) * 0.72])); g.stroke(); path(AZONE); g.stroke();
    g.fillStyle = 'rgba(90,60,25,.5)'; g.font = 'bold 18px sans-serif'; g.textAlign = 'center';
    g.fillText('A', 15*sx, 12*sy); g.fillText('C', 15*sx, 27*sy); g.fillText('D', 4*sx, 30*sy);
  });
  T3.tex.noshoot = t3CanvasTex(300, 375, (g, w, h) => { t3Noise(g, w, h, '#F4F4F2', 0.03, 2000, 13); g.fillStyle = 'rgba(30,30,30,.5)'; g.font = 'bold 60px sans-serif'; g.textAlign = 'center'; g.fillText('NS', w/2, h*0.55); });
  return T3.tex;
}
/* ---------- materials by display-list colour ---------- */
const T3_WOOD = ['#9C7746','#8A6A40','#B88A55','#A98458','#9C7A50','#8C6A44','#C49A62','#7E6448','#5E4628','#D9B98A','#8F6E4A','#C9A56E','#B88A55'];
const T3_STEEL = ['#E4E4E4','#6B7177','#3A3F44','#5E6A75','#C8372D','#B8433A','#3F6E96'];
function t3Mat(fill, extra){
  const key = fill + (extra ? JSON.stringify(extra) : '');
  let m = T3.mats.get(key); if(m) return m;
  const c = glColor(fill), col = new THREE.Color(c[0], c[1], c[2]).convertSRGBToLinear(), up = String(fill).toUpperCase(), tx = t3Textures();
  const p = {color:col, roughness:0.85, metalness:0, side:THREE.DoubleSide, flatShading:true};
  if(T3_WOOD.includes(up)){ p.map = tx.wood; p.color = new THREE.Color(1, 1, 1).lerp(col, 0.35); p.roughness = 0.8; }
  else if(up === '#98A6B4' || up === '#7A8998'){ p.map = tx.panel; p.color = new THREE.Color(1, 1, 1); p.roughness = 0.92; }
  else if(T3_STEEL.includes(up)){ p.metalness = 0.4; p.roughness = 0.45; }
  if(c[3] < 0.999){ p.transparent = true; p.opacity = c[3]; p.depthWrite = false; }
  Object.assign(p, extra || {});
  m = new THREE.MeshStandardMaterial(p); T3.mats.set(key, m); return m;
}
/* ---------- merged geometry from the display list (one draw per material) ---------- */
function t3Bucket(B, key, it){ return B[key] = B[key] || {pos:[], uv:[], it}; }
function t3Tri(b, a, c, d){ b.pos.push(a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z); }
function t3PolyInto(B, it, lift){
  const P = it.pts; if(!P || P.length < 3) return;
  const n = polyNormal(P); if(!n) return;
  const T = triangulate(P, n), key = it.tex ? 'tex:' + it.tex : it.fill, b = t3Bucket(B, key, it), dz = lift || 0;
  for(let i = 0; i < T.length; i++){ const q = P[T[i]]; b.pos.push(q[0], q[2] + dz, -q[1]); if(it.uvs) b.uv.push(it.uvs[T[i]][0], it.uvs[T[i]][1]); }
}
const T3_TMP = {};
function t3CylInto(B, key, it, a, b, r, seg){
  const A = W3(...a), C = W3(...b), d = new THREE.Vector3().subVectors(C, A), L = d.length(); if(L < 1e-4) return;
  d.divideScalar(L); const u = Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0); u.cross(d).normalize(); const v = new THREE.Vector3().crossVectors(d, u);
  const bk = t3Bucket(B, key, it), n = seg || 8, ring = (o) => { const out = []; for(let i = 0; i < n; i++){ const t = i / n * Math.PI * 2; out.push(o.clone().addScaledVector(u, Math.cos(t)*r).addScaledVector(v, Math.sin(t)*r)); } return out; };
  const ra = ring(A), rb = ring(C);
  for(let i = 0; i < n; i++){ const j = (i + 1) % n; t3Tri(bk, ra[i], ra[j], rb[j]); t3Tri(bk, ra[i], rb[j], rb[i]); }
}
function t3SphereInto(B, key, it, c, r){
  const C = W3(...c), bk = t3Bucket(B, key, it), la = 6, lo = 10, P = (i, j) => { const th = i / la * Math.PI, ph = j / lo * Math.PI * 2; return new THREE.Vector3(C.x + r*Math.sin(th)*Math.cos(ph), C.y + r*Math.cos(th), C.z + r*Math.sin(th)*Math.sin(ph)); };
  for(let i = 0; i < la; i++) for(let j = 0; j < lo; j++){ const a = P(i, j), b = P(i + 1, j), c2 = P(i + 1, j + 1), d = P(i, j + 1); t3Tri(bk, a, b, c2); t3Tri(bk, a, c2, d); }
}
function t3LineInto(L, it, a, b, dz){ const k = it.stroke, l = L[k] = L[k] || []; l.push(a[0], a[2] + (dz || 0), -a[1], b[0], b[2] + (dz || 0), -b[1]); }
function t3Flush(G, B, L, floorPass){
  const tx = t3Textures();
  Object.entries(B).forEach(([key, b]) => {
    if(!b.pos.length) return;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    let mat;
    if(key.startsWith('tex:')){ g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2)); mat = T3.mats.get(key) || (T3.mats.set(key, new THREE.MeshStandardMaterial({map:tx[b.it.tex], roughness:0.95, side:THREE.DoubleSide})), T3.mats.get(key)); }
    else mat = floorPass ? t3Mat(key, {flatShading:false, polygonOffset:true, polygonOffsetFactor:-1}) : t3Mat(key);
    if(mat.map && !key.startsWith('tex:')){ const uv = []; for(let i = 0; i < b.pos.length; i += 3) uv.push((b.pos[i] + b.pos[i+2]) * 1.2, b.pos[i+1] * 1.2); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); }
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.castShadow = !floorPass && !mat.transparent; m.receiveShadow = true; G.add(m);
  });
  Object.entries(L).forEach(([col, arr]) => {
    const c = glColor(col), g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    G.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({color:new THREE.Color(c[0], c[1], c[2]).convertSRGBToLinear(), transparent:c[3] < 1, opacity:c[3]})));
  });
}
function t3Clear(G){ for(let i = G.children.length - 1; i >= 0; i--){ const o = G.children[i]; if(o.userData.keep) continue; G.remove(o); if(o.geometry) o.geometry.dispose(); } }
function t3Build(floor, faces){
  const G = T3.dyn; t3Clear(G);
  // floor overlays as decals just above the concrete
  const FB = {}, FL = {};
  floor.forEach(it => {
    if(it.pts && (it.fill === '#D9D2C0' || it.fill === '#EFE6CF')) return;   // replaced by the concrete floor
    if(it.line){ if(it.wlw) t3CylInto(FB, it.stroke, it, [it.line[0][0], it.line[0][1], 0.012], [it.line[1][0], it.line[1][1], 0.012], it.wlw/2, 6); else t3LineInto(FL, it, it.line[0], it.line[1], 0.006); return; }
    if(it.pts && it.fill) t3PolyInto(FB, it, 0.004);
  });
  t3Flush(G, FB, FL, true);
  const B = {}, L = {};
  faces.forEach(it => {
    if(it.azone) return;
    if(it.dot){ t3SphereInto(B, it.fill, it, it.dot, it.wr || 0.02); return; }
    if(it.line){
      if(it.wlw) t3CylInto(B, it.stroke, it, it.line[0], it.line[1], it.wlw/2, 8);
      else if(it.lw && it.lw >= 2.5) t3CylInto(B, it.stroke, it, it.line[0], it.line[1], 0.008, 6);
      else t3LineInto(L, it, it.line[0], it.line[1]);
      return;
    }
    if(it.pts && (it.fill || it.tex)) t3PolyInto(B, it);
    if(it.hl && it.pts) for(let i = 0; i < it.pts.length; i++) t3LineInto(L, {stroke:it.stroke}, it.pts[i], it.pts[(i+1) % it.pts.length]);
  });
  t3Flush(G, B, L, false);
}
/* ---------- floor, backstop and (optionally) the range around the stage; rebuilt only when the stage extent changes ---------- */
function t3Surroundings(rich){
  const e = topExt, key = [e.xmin, e.xmax, e.ymin, e.ymax, rich].join(',');
  if(T3.bgKey === key) return; T3.bgKey = key;
  const G = T3.bg; t3Clear(G);
  const tx = t3Textures(), cx = (e.xmin + e.xmax)/2, cy = (e.ymin + e.ymax)/2, W = e.xmax - e.xmin + 30, D = e.ymax - e.ymin + 30;
  const std = (c, r, m, em) => new THREE.MeshStandardMaterial({color:new THREE.Color(c).convertSRGBToLinear(), roughness:r == null ? 0.9 : r, metalness:m || 0, emissive:em ? new THREE.Color(em) : new THREE.Color(0)});
  const box = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.copy(W3(x, y, z)); m.castShadow = true; m.receiveShadow = true; G.add(m); return m; };
  const floorTex = tx.floor.clone(); floorTex.needsUpdate = true; floorTex.repeat.set(W / 2, D / 2);
  const gm = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({map:floorTex, roughness:0.95}));
  gm.rotation.x = -Math.PI/2; gm.position.copy(W3(cx, cy, 0)); gm.receiveShadow = true; G.add(gm);
  const sw = e.xmax - e.xmin + 4, yb = e.ymax + 1.2, xl = e.xmin - 2, xr = e.xmax + 2, len = e.ymax - e.ymin + 6;
  box(sw, 3.2, 0.3, std('#5B6470', 0.95), cx, e.ymax + 1.5, 1.6);
  [xl, xr].forEach(x => box(0.3, 3.2, len, std('#6B7480', 0.95), x, cy + 1, 1.6));
  if(!rich){ box(sw, 2.2, 0.25, std('#2E3640', 1), cx, e.ymax + 1.3, 1.1); return; }
  // backstop: rubber berm, angled baffle planks, team banner
  box(sw, 1.2, 0.6, std('#22262B', 1), cx, yb - 0.1, 0.6);
  for(let i = 0; i < 6; i++){ const m = box(sw, 0.05, 0.42, std('#6E5A43', 0.85), cx, yb - 0.25, 1.5 + i * 0.32); m.rotation.x = -0.6; }
  if(window.SR_LOGO){
    const lt = new THREE.TextureLoader().load(window.SR_LOGO, () => { if(APP_READY) render3d(); }); lt.encoding = THREE.sRGBEncoding; lt.anisotropy = 8;
    const bgp = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 1.75), std('#F2F2F2', 0.95)); bgp.position.copy(W3(cx, yb + 0.12, 3.75)); G.add(bgp);
    const lg = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2 * 234 / 512), new THREE.MeshStandardMaterial({map:lt, transparent:true, alphaTest:0.3, roughness:0.9})); lg.position.copy(W3(cx, yb + 0.1, 3.75)); G.add(lg);
  }
  // side walls: acoustic panels and wall lights; nothing above the stage, so no view is blocked
  [xl, xr].forEach((x, side) => {
    for(let y = e.ymin - 3; y < e.ymax + 1.5; y += 1.2){ const k = Math.round((y - e.ymin) / 1.2) % 2; box(0.08, 1.8, 1.15, std(k ? '#8D99A6' : '#7C8895', 0.95), x + (side ? -0.2 : 0.2), y + 0.6, 1.4); }
    box(0.1, 0.25, len, std('#2B3036'), x + (side ? -0.22 : 0.22), cy + 1, 0.125);
    for(let y = e.ymin; y < e.ymax; y += 2.4) box(0.06, 0.08, 0.9, std('#F6F4EC', 0.4, 0, '#FFF3D6'), x + (side ? -0.26 : 0.26), y, 2.8);
  });
  [-0.3, 0, 0.3].forEach(f => box(1.4, 0.08, 0.12, std('#F6F4EC', 0.4, 0, '#FFF3D6'), cx + f * sw, yb - 0.05, 3.3));
  // waiting area behind the start: bench, safety table with a gear bag, timer stand
  const yS = e.ymin - 1.6;
  box(2.2, 0.06, 0.45, std('#8A6A44', 0.8), cx - 2.5, yS, 0.45); [-0.9, 0.9].forEach(dx => box(0.06, 0.45, 0.4, std('#3A3F44'), cx - 2.5 + dx, yS, 0.22));
  box(1.4, 0.05, 0.7, std('#B9BEC4', 0.6, 0.2), cx + 2.4, yS, 0.8); [-0.6, 0.6].forEach(dx => box(0.05, 0.8, 0.6, std('#3A3F44'), cx + 2.4 + dx, yS, 0.4));
  box(0.5, 0.35, 0.35, std('#C8372D', 0.6), cx + 2.4, yS, 1.0);
  box(0.04, 1.2, 0.04, std('#2B3036', 0.5, 0.4), cx + 0.9, yS + 0.4, 0.6); box(0.14, 0.22, 0.06, std('#F2C14E', 0.5), cx + 0.9, yS + 0.4, 1.25);
  box(0.05, 1.85, 2.0, std('#98A6B4', 0.92), xr + 1.2, e.ymax - 1.5, 0.925); box(0.05, 1.85, 2.0, std('#98A6B4', 0.92), xl - 1.2, e.ymax - 2.5, 0.925);
}
/* ---------- the shooter ---------- */
function t3B64(s){ const b = atob(s), u = new Uint8Array(b.length); for(let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u.buffer; }
function t3Parse(b64){ return new Promise((res, rej) => new THREE.GLTFLoader().parse(t3B64(b64), '', res, rej)); }
function t3LoadModels(){
  if(T3.assets || T3.charLoading || T3.charFailed) return;
  T3.charLoading = true;
  (async () => {
    try{
      for(const s of T3_MODELS) await t3Script(s);
      const [anim, male, female, hm, hf] = await Promise.all([t3Parse(window.M3_ANIMS), t3Parse(window.M3_MALE), t3Parse(window.M3_FEMALE), t3Parse(window.M3_HAIR_M), t3Parse(window.M3_HAIR_F)]);
      const clips = {}; anim.animations.forEach(c => clips[c.name] = c);
      const upper = n => /^(spine|neck|Head|clavicle|upperarm|lowerarm|hand|index|middle|pinky|ring|thumb)/.test(n);
      const sub = (c, keep, nm) => new THREE.AnimationClip(nm, c.duration, c.tracks.filter(tr => keep(tr.name.split('.')[0])));
      const part = {}; Object.values(clips).forEach(c => { part[c.name + ':up'] = sub(c, upper, c.name + ':up'); part[c.name + ':low'] = sub(c, n => !upper(n), c.name + ':low'); });
      T3.assets = {clips, part, male:male.scene, female:female.scene, hairM:hm.scene, hairF:hf.scene};
      ['M3_ANIMS','M3_MALE','M3_FEMALE','M3_HAIR_M','M3_HAIR_F'].forEach(k => { try{ delete window[k]; }catch(e){ window[k] = null; } });   // free the base64 text
      T3.charLoading = false; if(APP_READY) render3d();
    }catch(err){ T3.charLoading = false; T3.charFailed = true; if(APP_READY) render3d(); }
  })();
}
const T3_STYLE = {shirt:'#B8322A', vest:'#1E2328', pants:'#4A5260', shoes:'#2A2420', glove:'#E6BE98', belt:'#121518', cap:'#1E2328', ear:'#2B2F36', lens:'#F2C14E'};
const T3_STYLE_CMP = {shirt:'#D9822B', vest:'#3A3F44'};
function t3MakeShooter(female, style, height){
  const A = T3.assets, S = Object.assign({}, T3_STYLE, style || {});
  const root = THREE.SkeletonUtils.clone(female ? A.female : A.male), lin = h => new THREE.Color(h).convertSRGBToLinear();
  let skinned = null; root.traverse(o => { if(o.isSkinnedMesh){ o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; if(!skinned || o.geometry.attributes.position.count > skinned.geometry.attributes.position.count) skinned = o; } });
  // clothing painted from bone weights: torso = vest, arms = sleeves, hands = skin, legs = trousers, feet = shoes; head and neck keep the skin texture
  const bones = skinned.skeleton.bones.map(b => b.name), G = skinned.geometry.clone(), si = G.attributes.skinIndex, sw = G.attributes.skinWeight, pos = G.attributes.position;
  skinned.geometry = G;
  const zone = n => /^(Head|neck)/.test(n) ? null : /^(hand|index|middle|pinky|ring|thumb)/.test(n) ? 'glove' : /^(clavicle|upperarm|lowerarm)/.test(n) ? 'shirt' : /^spine/.test(n) ? 'vest' : /^(foot|ball)/.test(n) ? 'shoes' : 'pants';
  root.updateMatrixWorld(true); skinned.skeleton.pose();
  const pelvis = new THREE.Vector3(); skinned.skeleton.bones.find(b => b.name === 'pelvis').getWorldPosition(pelvis);
  const pv = pelvis.clone().applyMatrix4(new THREE.Matrix4().copy(skinned.matrixWorld).invert()).y;
  const comp = (X, i, k) => k === 0 ? X.getX(i) : k === 1 ? X.getY(i) : k === 2 ? X.getZ(i) : X.getW(i);
  const cl = new Float32Array(pos.count * 4), cols = {}; Object.keys(S).forEach(k => cols[k] = lin(S[k]));
  for(let v = 0; v < pos.count; v++){
    let r = 0, g = 0, b = 0, a = 0;
    for(let k = 0; k < 4; k++){
      const w = comp(sw, v, k); if(w <= 0) continue; const z = zone(bones[comp(si, v, k)]); if(!z) continue;
      let c = cols[z]; if((z === 'vest' || z === 'pants') && Math.abs(pos.getY(v) - (pv + 0.09)) < 0.035) c = cols.belt;
      r += c.r*w; g += c.g*w; b += c.b*w; a += w;
    }
    if(a > 0){ r /= a; g /= a; b /= a; }
    cl[v*4] = r; cl[v*4+1] = g; cl[v*4+2] = b; cl[v*4+3] = Math.min(1, Math.max(0, (a - 0.35) / 0.3));
  }
  G.setAttribute('clothes', new THREE.BufferAttribute(cl, 4));
  const m = skinned.material.clone();
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 clothes;\nvarying vec4 vClothes;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvClothes = clothes;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec4 vClothes;').replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vClothes.rgb, vClothes.a);')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(mix(normal, geometryNormal, vClothes.a * 0.75));')   // fabric: soften the skin relief of the normal map
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.85, vClothes.a);');
  };
  m.customProgramCacheKey = () => 'clothes';
  skinned.material = m;
  const box = new THREE.Box3().setFromObject(root), h0 = box.max.y - box.min.y, s = height / h0;
  root.scale.setScalar(s); root.updateMatrixWorld(true);
  const bone = n => skinned.skeleton.bones.find(b => b.name === n), head = bone('Head'), hp = new THREE.Vector3(); head.getWorldPosition(hp);
  const std = (c, rough, metal) => new THREE.MeshStandardMaterial({color:lin(c), roughness:rough == null ? 0.7 : rough, metalness:metal || 0});
  const add = (mesh, parent, x, y, z) => { mesh.position.set(hp.x + x, hp.y + y, hp.z + z); mesh.castShadow = true; mesh.updateMatrixWorld(true); parent.attach(mesh); return mesh; };
  const hair = (female ? A.hairF : A.hairM).clone(true); hair.traverse(o => { if(o.isMesh){ o.material = o.material.clone(); o.material.color = lin(female ? '#3A2618' : '#2E2219'); o.castShadow = true; } });
  hair.scale.setScalar(s); hair.updateMatrixWorld(true); head.attach(hair);
  const hr = 0.098 * s;
  add(new THREE.Mesh(new THREE.SphereGeometry(hr, 24, 12, 0, Math.PI*2, 0, Math.PI*0.5), std(S.cap)), head, 0, 0.1*s, -0.01*s);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(hr*0.9, hr*0.9, 0.006, 24, 1, false, -Math.PI/2.8, Math.PI/1.4), std(S.cap)); brim.scale.set(1, 1, 1.25); add(brim, head, 0, 0.1*s, 0.045*s);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.13*s, 0.03*s, 0.008*s), new THREE.MeshStandardMaterial({color:lin(S.lens), roughness:0.15, metalness:0.3, transparent:true, opacity:0.85})), head, 0, 0.045*s, 0.095*s);
  [-1, 1].forEach(sd => { const ear = new THREE.Mesh(new THREE.CylinderGeometry(0.036*s, 0.036*s, 0.03*s, 20), std(S.ear, 0.5)); ear.rotation.z = Math.PI/2; add(ear, head, sd*0.088*s, 0.035*s, -0.01*s); });
  add(new THREE.Mesh(new THREE.TorusGeometry(0.09*s, 0.006*s, 6, 24, Math.PI), std(S.ear, 0.5)), head, 0, 0.035*s, -0.03*s);
  // pistol: placed while holding the aim pose so it points forward, then carried by the right hand
  const mixer = new THREE.AnimationMixer(root), aim = mixer.clipAction(A.clips['Pistol_Aim_Neutral']); aim.play(); mixer.update(0); root.updateMatrixWorld(true);
  const hand = bone('hand_r'), hw = new THREE.Vector3(); hand.getWorldPosition(hw);
  const gun = new THREE.Group(), gm = std('#1B1E22', 0.45, 0.6);
  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.035, 0.19), gm); slide.position.set(0, 0.035, 0.05); gun.add(slide);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.11, 0.045), gm); grip.rotation.x = 0.25; grip.position.set(0, -0.02, -0.01); gun.add(grip);
  const optic = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.025, 0.03), std('#30343A', 0.3, 0.5)); optic.position.set(0, 0.065, 0); gun.add(optic);
  gun.scale.setScalar(s); gun.position.copy(hw).add(new THREE.Vector3(0, 0.035*s, 0.04*s)); gun.traverse(o => o.castShadow = true); gun.updateMatrixWorld(true); hand.attach(gun);
  aim.stop(); mixer.update(0); skinned.skeleton.pose(); root.updateMatrixWorld(true);
  // holster on the right hip with a gun in it (shown before the draw), and a loose gun for starts with the gun on a table or barrel
  const pel = bone('pelvis'), pw = new THREE.Vector3(); pel.getWorldPosition(pw);
  const holster = new THREE.Group(), hm = std('#1E2328', 0.6);
  const hb = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.09), hm); holster.add(hb);
  const hg = gun.clone(true); hg.scale.setScalar(1); hg.rotation.set(Math.PI / 2, 0, 0); hg.position.set(0, 0.07, -0.02); holster.add(hg);
  holster.scale.setScalar(s); holster.position.set(pw.x - 0.2 * s, pw.y - 0.06 * s, pw.z); holster.traverse(o => o.castShadow = true); holster.updateMatrixWorld(true); pel.attach(holster);
  const tableGun = gun.clone(true); tableGun.scale.setScalar(s); tableGun.visible = false; tableGun.traverse(o => o.castShadow = true);
  root.userData.keep = true; tableGun.userData.keep = true;
  return {root, mixer, actions:{}, gun, key:'', holsterGun:hg, tableGun, bone};
}
function t3Act(F, name, part){ const key = name + (part ? ':' + part : ''); let a = F.actions[key]; if(!a){ const clip = part ? T3.assets.part[key] : T3.assets.clips[name]; if(!clip) return null; a = F.mixer.clipAction(clip); F.actions[key] = a; } return a; }
// smoothstep 0..1
const t3S = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
// rotate a bone about a world-space axis (used to spread the legs when straddling)
function t3RotBone(b, axis, ang){
  if(!b || !b.parent) return;
  const q = new THREE.Quaternion().setFromAxisAngle(axis, ang), wq = new THREE.Quaternion(), pq = new THREE.Quaternion();
  b.getWorldQuaternion(wq); b.parent.getWorldQuaternion(pq);
  b.quaternion.copy(pq.invert().multiply(q.multiply(wq)));
}
// start sequence from the beep: rise from a seat, draw from the holster or pick up the gun, load / rack, then aim
function t3StartPhases(){
  const c = stage.startCond || {}, T = PROFILE.time, shots = RP.res.shots, first = shots.length ? shotFire(shots[0]) : 0;
  const rise = startRise(), load = c.ready === 'unloaded' ? (T.loadExtra || 0) + (T.emptyChamber || 0) : c.ready === 'emptyChamber' ? (T.emptyChamber || 0) : 0;
  const pick = c.gunLoc === 'object', drawDur = pick ? 0.9 : 0.6;
  const drawEnd = Math.max(rise + drawDur, first - 0.15 - load), drawStart = Math.max(rise, drawEnd - drawDur);
  return {rise, drawStart, drawEnd, loadEnd:drawEnd + load, first, pick, gunObj:pick ? getObj(c.gunObj) : null};
}
// pose the shooter for replay time t (called while the replay context of that figure is active)
function t3PoseShooter(F, t){
  const p = figPos(t), k = stopAt(t), mv = RP.stops.find(s => t > s.dep && t < s.arr), seat = figSeat(t);
  // smooth step up / down onto podiums, bridges and boats instead of a jump
  const base = seat ? 0 : (() => { let a = 0, n = 0; [-0.18, -0.09, 0, 0.09, 0.18].forEach(d => { const q = figPos(Math.max(0, t + d)); a += surfaceAt(q[0], q[1]); n++; }); return a / n; })();
  Object.values(F.actions).forEach(a => { a.enabled = false; a.setEffectiveWeight(0); });
  const use = (name, part, time, w) => { const a = t3Act(F, name, part); if(!a) return; const d = a.getClip().duration; a.enabled = true; a.play(); a.setEffectiveWeight(w == null ? 1 : w); a.time = Math.max(0, Math.min(d - 1e-4, time)); };
  const loop = (name, part, time, w) => { const a = t3Act(F, name, part); if(!a) return; const d = a.getClip().duration; use(name, part, ((time % d) + d) % d, w); };
  const dur = n => T3.assets.clips[n] ? T3.assets.clips[n].duration : 1;
  const shots = RP.res.shots, nxt = shots.find(x => x.t >= t - 0.12), aimObj = nxt && k >= 0 && nxt.stop === k ? getObj(nxt.target) : null;
  const rl = (RP.rl || []).find(w => t >= w.a && t <= w.b), T = PROFILE.time;
  const shotAgo = shots.reduce((m, x) => { const d = t - shotFire(x); return d >= 0 && d < m ? d : m; }, 9);
  const S = t3StartPhases();
  let gunIn = 'hand', dir, prone = false, straddle = false, fullBody = false;
  const aimUpper = (w0) => {
    const eye = figEye(t), tz = aimObj ? tgtCenterZ(aimObj) : eye, dd = aimObj ? Math.hypot(aimObj.x - p[0], aimObj.y - p[1]) : 5, pitch = Math.atan2(tz - eye, dd);
    const u = Math.max(-1, Math.min(1, pitch / 0.7)), w = w0 == null ? 1 : w0;
    use('Pistol_Aim_Neutral', 'up', 0, w * (1 - Math.abs(u))); use(u > 0 ? 'Pistol_Aim_Up' : 'Pistol_Aim_Down', 'up', 0, w * Math.abs(u));
    if(shotAgo < 0.15) use('Pistol_Shoot', 'up', shotAgo, 0.6 * w);
  };
  // upper body while the start sequence is running (also used while moving off the start)
  const startUpper = () => {
    if(t < S.drawStart){ loop('Idle_Loop', 'up', t); gunIn = S.pick ? 'object' : 'holster'; return true; }
    if(t < S.drawEnd){ const u = t3S((t - S.drawStart) / (S.drawEnd - S.drawStart));
      if(S.pick){ use('PickUp_Table', 'up', u * dur('PickUp_Table')); gunIn = u < 0.6 ? 'object' : 'hand'; }
      else { loop('Idle_Loop', 'up', t, 1 - u); aimUpper(u); gunIn = u < 0.35 ? 'holster' : 'hand'; }
      return true; }
    if(t < S.loadEnd){ use('Pistol_Reload', 'up', (t - S.drawEnd) / Math.max(0.3, S.loadEnd - S.drawEnd) * dur('Pistol_Reload')); return true; }
    return false;
  };
  if(mv){
    const k2 = RP.stops.indexOf(mv), prevSit = k2 > 0 && RP.stops[k2 - 1].stance === 'sit', sinceDep = t - mv.dep;
    const standUp = prevSit ? ((seatAt(mv.from[0], mv.from[1]) || {}).straddle ? (T.dismount || 1) : (T.standUp || 0.6)) : 0;
    const dist = mv.path ? mv.path.len : Math.hypot(mv.to[0] - mv.from[0], mv.to[1] - mv.from[1]), v = dist / Math.max(0.1, mv.arr - mv.dep);
    if(prevSit && sinceDep < standUp){ use('Sitting_Exit', null, sinceDep / standUp * dur('Sitting_Exit')); fullBody = true; }
    else if(k2 === 0 && S.rise && t < S.rise){ use('Sitting_Exit', null, t / S.rise * dur('Sitting_Exit')); fullBody = true; }
    else {
      const tn = inTunnel(p[0], p[1]);
      if(tn) loop('Crouch_Fwd_Loop', null, sinceDep * 1.1);
      else if(v < 1.6){ loop('Walk_Loop', 'low', sinceDep * Math.max(0.7, v / 1.3)); }
      else loop('Jog_Fwd_Loop', 'low', sinceDep * 1.1);
      if(!tn){ if(t < S.loadEnd && startUpper()); else if(rl) use('Pistol_Reload', 'up', (t - rl.a) / Math.max(0.3, rl.b - rl.a) * dur('Pistol_Reload')); else loop('Pistol_Idle_Loop', 'up', t); }
    }
    dir = legDir(mv, t);
  }else{
    const st = k >= 0 ? (figAdj(t).key || RP.stops[k].stance) : 'stand', S0 = k >= 0 ? RP.stops[k] : null, sinceArr = S0 ? t - S0.arr : 0;
    const firstAt = k >= 0 ? shots.find(x => x.stop === k) : null, opening = firstAt && /開窗/.test(firstAt.why || '') && sinceArr >= 0 && sinceArr < (T.windowOpen || 0.5);
    const sitting = seat && st === 'sit' && k >= 0 && !(k === 0 && stage.startCond.pose && stage.startCond.pose !== 'stand') && !(k > 0 && RP.stops[k - 1].stance === 'sit' && Math.hypot(RP.stops[k-1].to[0] - S0.to[0], RP.stops[k-1].to[1] - S0.to[1]) < 0.05) && sinceArr >= 0 && sinceArr < (T.sitDown || 0.6);
    prone = st === 'prone' && !seat; straddle = !!(seat && seat.straddle);
    if(k < 0 && S.rise && t < S.rise){ use('Sitting_Exit', null, t / S.rise * dur('Sitting_Exit')); fullBody = true; gunIn = S.pick ? 'object' : 'holster'; }
    else if(sitting){ use('Sitting_Enter', null, sinceArr / (T.sitDown || 0.6) * dur('Sitting_Enter')); fullBody = true; }
    else {
      const low = seat ? 'Sitting_Idle_Loop' : prone ? 'Idle_Loop' : st === 'kneel' ? 'Fixing_Kneeling' : (st === 'half' || st === 'crouch') ? 'Crouch_Idle_Loop' : 'Pistol_Idle_Loop';
      loop(low, 'low', low === 'Fixing_Kneeling' ? 0.5 : t);
      if(t < S.loadEnd && (k < 0 || shots.every(x => shotFire(x) >= t)) && startUpper());
      else if(rl) use('Pistol_Reload', 'up', (t - rl.a) / Math.max(0.3, rl.b - rl.a) * dur('Pistol_Reload'));
      else if(opening) use('Interact', 'up', Math.min(0.55, sinceArr / (T.windowOpen || 0.5)) * dur('Interact'));
      else if(prone){ use('Pistol_Aim_Up', 'up', 0, 1); if(shotAgo < 0.15) use('Pistol_Shoot', 'up', shotAgo, 0.5); }
      else aimUpper();
    }
    const aA = aimObj ? aimDirAt(t, p) : null;
    dir = aA != null ? [Math.cos(aA), Math.sin(aA)] : aimObj ? [aimObj.x - p[0], aimObj.y - p[1]] : (seat && seat.obj && seat.obj.rot != null ? facing(seat.obj.rot) : downDir());
    if(straddle && seat.obj && seat.obj.rot != null){ F.aimYaw = Math.atan2(dir[0], -dir[1]); dir = facing(seat.obj.rot); }   // legs stay along the horse; the upper body turns
    else F.aimYaw = null;
  }
  F.mixer.update(0);
  const yaw = Math.atan2(dir[0], -dir[1]);
  F.root.rotation.set(0, yaw, 0, 'YXZ');
  if(prone){
    // no prone clip: lay the body flat facing the target, chest slightly raised, eyes at the stop point
    const L = (PROFILE.body && PROFILE.body.height) || 1.76, f = [Math.sin(yaw), Math.cos(yaw)];
    F.root.rotation.x = 1.42;
    const w = W3(p[0], p[1], 0.1); F.root.position.set(w.x - f[0] * L * 0.86, 0.1, w.z - f[1] * L * 0.86);
  }else F.root.position.copy(W3(p[0], p[1], base));
  F.root.updateMatrixWorld(true);
  if(straddle){   // legs either side of the horse / barrel
    const fw = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    t3RotBone(F.bone('thigh_l'), fw, -0.55); t3RotBone(F.bone('thigh_r'), fw, 0.55);
    if(F.aimYaw != null){ let dy = F.aimYaw - yaw; while(dy > Math.PI) dy -= 2*Math.PI; while(dy < -Math.PI) dy += 2*Math.PI;
      dy = Math.max(-1.6, Math.min(1.6, dy)); F.root.updateMatrixWorld(true); const up = new THREE.Vector3(0, 1, 0);
      t3RotBone(F.bone('spine_01'), up, dy * 0.4); F.root.updateMatrixWorld(true); t3RotBone(F.bone('spine_02'), up, dy * 0.3); F.root.updateMatrixWorld(true); t3RotBone(F.bone('spine_03'), up, dy * 0.3); }
    F.root.updateMatrixWorld(true);
  }
  // where the gun is: in the hand, in the holster, or still on the table / barrel
  F.gun.visible = gunIn === 'hand'; if(F.holsterGun) F.holsterGun.visible = gunIn === 'holster';
  if(F.tableGun){
    F.tableGun.visible = gunIn === 'object' && !!S.gunObj;
    if(F.tableGun.visible){ const o = S.gunObj, top = o.type === 'table' ? (o.h || 0.75) : o.type === 'barrel' ? (o.h || 0.9) : (o.h || 0.5); F.tableGun.position.copy(W3(o.x, o.y, top + 0.02)); F.tableGun.rotation.set(Math.PI / 2, 0, Math.random() * 0); }
  }
}
// called by replayFigure when the three.js renderer and the models are ready
function t3Figure(colOverride){
  if(!T3.on || !T3.assets || T3.failed) return false;
  const b = PROFILE.body || {}, female = b.gender === 'female', h = b.height || 1.76, idx = T3.figUsed++;
  const key = [female, h, colOverride || ''].join('|');
  let F = T3.figs[idx];
  if(!F || F.key !== key){ if(F){ T3.dyn.remove(F.root); T3.dyn.remove(F.tableGun); } F = t3MakeShooter(female, colOverride ? T3_STYLE_CMP : null, h); F.key = key; T3.figs[idx] = F; T3.dyn.add(F.root); T3.dyn.add(F.tableGun); }
  F.root.visible = true; t3PoseShooter(F, RP.t); F.root.updateMatrixWorld(true);
  return F;
}
function t3Render(cam, floor, faces){
  if(!T3.renderer || T3.failed) return false;
  const set = t3Settings(), r = T3.renderer, dpr = Math.min(window.devicePixelRatio || 1, set.quality === 'low' ? 1.25 : 2);
  r.setPixelRatio(dpr); r.setSize(v3d.w, v3d.h, false);
  r.shadowMap.enabled = set.quality !== 'low'; T3.sun.castShadow = set.quality !== 'low';
  T3.canvas.style.display = 'block'; const gl = $('v3dGL'); if(gl) gl.style.visibility = 'hidden';
  t3Surroundings(set.bg === 'rich');
  t3Build(floor, faces);
  T3.figs.forEach((F, i) => { if(F){ F.root.visible = i < T3.figUsed; if(i >= T3.figUsed) F.tableGun.visible = false; } });
  const e = topExt, cx = (e.xmin + e.xmax)/2, cy = (e.ymin + e.ymax)/2, span = Math.max(e.xmax - e.xmin, e.ymax - e.ymin) * 0.75 + 4;
  T3.sun.position.copy(W3(cx - span*0.5, cy - span*0.8, span*1.6)); T3.sun.target.position.copy(W3(cx, cy, 0));
  const sc = T3.sun.shadow.camera; sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span; sc.near = 0.5; sc.far = span*5; sc.updateProjectionMatrix();
  const C = cam.C, F = cam.F, U = cam.U;
  T3.cam.fov = 2 * Math.atan((v3d.h / 2) / cam.f) * 180 / Math.PI; T3.cam.aspect = v3d.w / v3d.h; T3.cam.updateProjectionMatrix();
  T3.cam.position.copy(W3(...C)); T3.cam.up.copy(W3(U[0], U[1], U[2])).normalize(); T3.cam.lookAt(W3(C[0] + F[0], C[1] + F[1], C[2] + F[2]));
  r.render(T3.scene, T3.cam);
  return true;
}
function t3Hide(){ if(T3.canvas) T3.canvas.style.display = 'none'; const gl = $('v3dGL'); if(gl) gl.style.visibility = ''; }
