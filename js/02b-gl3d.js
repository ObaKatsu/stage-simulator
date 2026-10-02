/*! Stage 模擬器 — IPSC Action Air stage 規劃、回放與檢討
 *  Copyright (C) 2026 James
 *  SPDX-License-Identifier: GPL-3.0-or-later
 *  本程式為自由軟體：你可以依自由軟體基金會發布的 GNU 通用公共授權條款第 3 版，
 *  或（由你選擇）任何更新的版本，重新散布或修改本程式。本程式不提供任何保證，
 *  亦不保證適售性或特定目的適用性。完整條款見 LICENSE 或 <https://www.gnu.org/licenses/>。
 */
/* ---------- 3D: WebGL renderer (depth buffer, no external library) ----------
   Draws the same display list that build3d() produces (floor / faces with pts, line, dot),
   but with a real depth buffer, so walls correctly hide what is behind them.
   Falls back to the 2D painter's renderer in 02 when WebGL is not available. */
const GL3D = {active:false, gl:null, failed:false, prog:null, loc:null, vbo:null, cbo:null, tris:0};
const GL3D_NEAR = 0.05, GL3D_FAR = 400;
const GL3D_LIGHT = (() => { const v = [-0.35, -0.55, 0.76], L = Math.hypot(v[0], v[1], v[2]); return [v[0]/L, v[1]/L, v[2]/L]; })();
function gl3dInit(){
  if(GL3D.gl) return true;
  if(GL3D.failed) return false;
  const c = $('v3dGL');
  if(!c){ GL3D.failed = true; return false; }
  let gl = null;
  try{ gl = c.getContext('webgl', {antialias:true, alpha:false, preserveDrawingBuffer:true}) || c.getContext('experimental-webgl', {antialias:true, alpha:false, preserveDrawingBuffer:true}); }catch(e){ gl = null; }
  if(!gl){ GL3D.failed = true; c.classList.add('hidden'); return false; }
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  try{
    const vs = sh(gl.VERTEX_SHADER, 'attribute vec3 p;attribute vec4 c;uniform mat4 m;varying vec4 vc;void main(){gl_Position=m*vec4(p,1.0);vc=c;}');
    const fs = sh(gl.FRAGMENT_SHADER, 'precision mediump float;varying vec4 vc;void main(){gl_FragColor=vc;}');
    const pr = gl.createProgram(); gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
    if(!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    GL3D.prog = pr; GL3D.loc = {p:gl.getAttribLocation(pr, 'p'), c:gl.getAttribLocation(pr, 'c'), m:gl.getUniformLocation(pr, 'm')};
    GL3D.vbo = gl.createBuffer(); GL3D.cbo = gl.createBuffer();
  }catch(e){ GL3D.failed = true; c.classList.add('hidden'); return false; }
  c.addEventListener('webglcontextlost', e => { e.preventDefault(); GL3D.gl = null; GL3D.active = false; GL3D.failed = true; c.classList.add('hidden'); if(APP_READY) render3d(); });
  GL3D.gl = gl; GL3D.active = true;
  return true;
}
function gl3dResize(w, h, dpr){
  const c = $('v3dGL'); if(!c) return;
  c.width = Math.max(1, Math.round(w*dpr)); c.height = Math.max(1, Math.round(h*dpr));
}
/* colors */
const GLCOL = new Map();
function glColor(s){
  if(!s) return null;
  let c = GLCOL.get(s); if(c) return c;
  let m;
  if(s[0] === '#'){
    let h = s.slice(1); if(h.length === 3) h = h.split('').map(x => x + x).join('');
    c = [parseInt(h.slice(0,2), 16)/255, parseInt(h.slice(2,4), 16)/255, parseInt(h.slice(4,6), 16)/255, h.length >= 8 ? parseInt(h.slice(6,8), 16)/255 : 1];
  }else if((m = s.match(/rgba?\(([^)]+)\)/))){
    const a = m[1].split(',').map(x => parseFloat(x));
    c = [a[0]/255, a[1]/255, a[2]/255, a.length > 3 ? a[3] : 1];
  }else c = [0.5, 0.5, 0.5, 1];
  GLCOL.set(s, c); return c;
}
// face tone by direction (not a light source and no shadows): tops lightest, sides toned so boxes read as solid
function faceTone(n, cam, p0){
  let nx = n[0], ny = n[1], nz = n[2];
  if(nx*(cam.C[0] - p0[0]) + ny*(cam.C[1] - p0[1]) + nz*(cam.C[2] - p0[2]) < 0){ nx = -nx; ny = -ny; nz = -nz; }
  const d = nx*GL3D_LIGHT[0] + ny*GL3D_LIGHT[1] + nz*GL3D_LIGHT[2];
  return 0.74 + 0.26 * Math.max(0, d);
}
function polyNormal(P){
  let nx = 0, ny = 0, nz = 0;
  for(let i = 0; i < P.length; i++){ const a = P[i], b = P[(i+1) % P.length]; nx += (a[1] - b[1])*(a[2] + b[2]); ny += (a[2] - b[2])*(a[0] + b[0]); nz += (a[0] - b[0])*(a[1] + b[1]); }
  const L = Math.hypot(nx, ny, nz); return L < 1e-12 ? null : [nx/L, ny/L, nz/L];
}
// ear clipping in the polygon's dominant plane (handles concave shooting areas)
function triangulate(P, n){
  const N = P.length; if(N < 3) return [];
  if(N === 3) return [0, 1, 2];
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  const pr = az >= ax && az >= ay ? (p => [p[0], p[1]]) : ax >= ay ? (p => [p[1], p[2]]) : (p => [p[2], p[0]]);
  const Q = P.map(pr);
  let area = 0; for(let i = 0; i < N; i++){ const a = Q[i], b = Q[(i+1) % N]; area += a[0]*b[1] - b[0]*a[1]; }
  const idx = []; for(let i = 0; i < N; i++) idx.push(area >= 0 ? i : N - 1 - i);
  const out = [];
  const cr = (a, b, c) => (b[0] - a[0])*(c[1] - a[1]) - (b[1] - a[1])*(c[0] - a[0]);
  let guard = 0;
  while(idx.length > 3 && guard++ < 5000){
    let cut = false;
    for(let i = 0; i < idx.length; i++){
      const i0 = idx[(i + idx.length - 1) % idx.length], i1 = idx[i], i2 = idx[(i+1) % idx.length];
      const a = Q[i0], b = Q[i1], c = Q[i2];
      if(cr(a, b, c) <= 1e-12) continue;
      let inside = false;
      for(const j of idx){ if(j === i0 || j === i1 || j === i2) continue; const p = Q[j]; if(cr(a, b, p) >= 0 && cr(b, c, p) >= 0 && cr(c, a, p) >= 0){ inside = true; break; } }
      if(inside) continue;
      out.push(i0, i1, i2); idx.splice(i, 1); cut = true; break;
    }
    if(!cut) break;
  }
  if(idx.length === 3) out.push(idx[0], idx[1], idx[2]);
  else for(let i = 1; i < idx.length - 1; i++) out.push(idx[0], idx[i], idx[i+1]);   // degenerate fallback
  return out;
}
/* geometry buckets */
function glBucket(){ return {p:[], c:[]}; }
function tri(B, a, b, c, col){ B.p.push(a[0],a[1],a[2], b[0],b[1],b[2], c[0],c[1],c[2]); for(let i = 0; i < 3; i++) B.c.push(col[0], col[1], col[2], col[3]); }
function glPoly(B, it, cam, tone){
  const P = it.pts; if(!P || P.length < 3 || !it.fill) return;
  const n = polyNormal(P); if(!n) return;
  const c0 = glColor(it.fill), k = tone === false || it.flat ? 1 : faceTone(n, cam, P[0]);
  const col = [c0[0]*k, c0[1]*k, c0[2]*k, c0[3]];
  const T = triangulate(P, n);
  for(let i = 0; i < T.length; i += 3) tri(B, P[T[i]], P[T[i+1]], P[T[i+2]], col);
}
// camera-facing strip for a line; width in pixels (lw) or in meters (wlw, with round ends)
function glLine(B, a, b, cam, col, lw, wlw){
  const ca = toCam(cam, a), cb = toCam(cam, b);
  if(ca[2] < GL3D_NEAR && cb[2] < GL3D_NEAR) return;
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], m = [(a[0] + b[0])/2 - cam.C[0], (a[1] + b[1])/2 - cam.C[1], (a[2] + b[2])/2 - cam.C[2]];
  let s = cross3(d, m); const L = Math.hypot(s[0], s[1], s[2]);
  if(L < 1e-12) return;
  s = [s[0]/L, s[1]/L, s[2]/L];
  const za = Math.max(GL3D_NEAR, ca[2]), zb = Math.max(GL3D_NEAR, cb[2]);
  const ha = wlw ? wlw/2 : (lw || 1) * 0.5 * za / cam.f, hb = wlw ? wlw/2 : (lw || 1) * 0.5 * zb / cam.f;
  const A1 = [a[0] + s[0]*ha, a[1] + s[1]*ha, a[2] + s[2]*ha], A2 = [a[0] - s[0]*ha, a[1] - s[1]*ha, a[2] - s[2]*ha];
  const B1 = [b[0] + s[0]*hb, b[1] + s[1]*hb, b[2] + s[2]*hb], B2 = [b[0] - s[0]*hb, b[1] - s[1]*hb, b[2] - s[2]*hb];
  tri(B, A1, B1, B2, col); tri(B, A1, B2, A2, col);
  if(wlw){ glDisc(B, a, wlw/2, cam, col, 10); glDisc(B, b, wlw/2, cam, col, 10); }
}
function glDisc(B, p, r, cam, col, seg){
  seg = seg || 14;
  const R = cam.R, U = cam.U; let prev = null;
  for(let i = 0; i <= seg; i++){
    const t = i / seg * Math.PI * 2, q = [p[0] + (R[0]*Math.cos(t) + U[0]*Math.sin(t))*r, p[1] + (R[1]*Math.cos(t) + U[1]*Math.sin(t))*r, p[2] + (R[2]*Math.cos(t) + U[2]*Math.sin(t))*r];
    if(prev) tri(B, p, prev, q, col);
    prev = q;
  }
}
function glItem(fills, strokes, it, cam, tone){
  if(it.dot){
    const c = toCam(cam, it.dot); if(c[2] < GL3D_NEAR) return;
    const r = it.wr ? it.wr : (it.r || 5) * c[2] / cam.f;
    glDisc(strokes, it.dot, r, cam, glColor(it.fill), 16); return;
  }
  if(it.line){ glLine(strokes, it.line[0], it.line[1], cam, glColor(it.stroke), it.lw, it.wlw); return; }
  if(it.fill) glPoly(fills, it, cam, tone);
  if(it.stroke && it.stroke !== it.fill && it.pts){
    const col = glColor(it.stroke), P = it.pts;
    for(let i = 0; i < P.length; i++) glLine(strokes, P[i], P[(i+1) % P.length], cam, col, it.lw || 1, null);
  }
}
function itemAlpha(it){
  const a = x => x ? glColor(x)[3] : 1;
  return Math.min(a(it.fill), it.dot ? 1 : a(it.stroke));
}
function camMatrix(cam){
  const ax = cam.f / (v3d.w / 2), ay = cam.f / (v3d.h / 2);
  const A = (GL3D_FAR + GL3D_NEAR) / (GL3D_FAR - GL3D_NEAR), Bz = -2 * GL3D_FAR * GL3D_NEAR / (GL3D_FAR - GL3D_NEAR);
  const R = cam.R, U = cam.U, F = cam.F, C = cam.C;
  const tR = -(R[0]*C[0] + R[1]*C[1] + R[2]*C[2]), tU = -(U[0]*C[0] + U[1]*C[1] + U[2]*C[2]), tF = -(F[0]*C[0] + F[1]*C[1] + F[2]*C[2]);
  // rows: clip.x = ax*(R.p + tR), clip.y = ay*(U.p + tU), clip.z = A*(F.p + tF) + Bz, clip.w = F.p + tF  (column-major for WebGL)
  return new Float32Array([
    ax*R[0], ay*U[0], A*F[0], F[0],
    ax*R[1], ay*U[1], A*F[1], F[1],
    ax*R[2], ay*U[2], A*F[2], F[2],
    ax*tR,   ay*tU,   A*tF + Bz, tF
  ]);
}
function glDraw(B, mode){
  const gl = GL3D.gl; if(!B.p.length) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, GL3D.vbo); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(B.p), gl.STREAM_DRAW);
  gl.vertexAttribPointer(GL3D.loc.p, 3, gl.FLOAT, false, 0, 0); gl.enableVertexAttribArray(GL3D.loc.p);
  gl.bindBuffer(gl.ARRAY_BUFFER, GL3D.cbo); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(B.c), gl.STREAM_DRAW);
  gl.vertexAttribPointer(GL3D.loc.c, 4, gl.FLOAT, false, 0, 0); gl.enableVertexAttribArray(GL3D.loc.c);
  gl.drawArrays(gl.TRIANGLES, 0, B.p.length / 3);
  GL3D.tris += B.p.length / 9;
}
function gl3dRender(cam, floor, faces, bg){
  const gl = GL3D.gl; if(!gl) return false;
  const c = $('v3dGL');
  gl.viewport(0, 0, c.width, c.height);
  const b = glColor(bg || '#DDE5EC'); gl.clearColor(b[0], b[1], b[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.useProgram(GL3D.prog); gl.uniformMatrix4fv(GL3D.loc.m, false, camMatrix(cam));
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  GL3D.tris = 0;
  // 1) floor layers in list order, no depth (everything lies on the ground)
  const fl = glBucket();
  floor.forEach(it => glItem(fl, fl, it, cam, false));
  gl.disable(gl.DEPTH_TEST); gl.depthMask(false); glDraw(fl);
  // 2) solid objects with a depth buffer; fills pushed back slightly so their outlines stay visible
  const oF = glBucket(), oS = glBucket(), tr = [];
  faces.forEach(it => {
    if(itemAlpha(it) < 0.999){ tr.push(it); return; }
    glItem(oF, oS, it, cam, true);
  });
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
  gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.5, 2); glDraw(oF);
  gl.disable(gl.POLYGON_OFFSET_FILL); glDraw(oS);
  // 3) see-through items back to front, without writing depth
  if(tr.length){
    const dist = it => { const P = it.pts || it.line || [it.dot]; let x = 0, y = 0, z = 0; P.forEach(p => { x += p[0]; y += p[1]; z += p[2]; }); const n = P.length; return Math.hypot(x/n - cam.C[0], y/n - cam.C[1], z/n - cam.C[2]); };
    tr.map(it => ({it, d:dist(it)})).sort((a, b) => b.d - a.d).forEach(({it}) => { const T = glBucket(); glItem(T, T, it, cam, true); gl.depthMask(false); gl.enable(gl.POLYGON_OFFSET_FILL); glDraw(T); });
    gl.disable(gl.POLYGON_OFFSET_FILL); gl.depthMask(true);
  }
  return true;
}
