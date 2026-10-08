'use strict';
/*! Stage 模擬器 — IPSC Action Air stage 規劃、回放與檢討
 *  Copyright (C) 2026 James
 *  SPDX-License-Identifier: GPL-3.0-or-later
 *  本程式為自由軟體：你可以依自由軟體基金會發布的 GNU 通用公共授權條款第 3 版，
 *  或（由你選擇）任何更新的版本，重新散布或修改本程式。本程式不提供任何保證，
 *  亦不保證適售性或特定目的適用性。完整條款見 LICENSE 或 <https://www.gnu.org/licenses/>。
 */
/* ---------- phase 3b: replay & sound ---------- */
// trigger and arrival times of a planned shot (the stop plate's timeline time is its arrival)
function shotFire(x){ return x.fire != null ? x.fire : x.t; }
function shotImpact(x){ return shotFire(x) + (x.flight != null ? x.flight : 0); }
// where the BB of this shot ends: the target centre at the moment it arrives (a swinger has moved by then)
function bbEndPoint(o, when){
  if(isSwingPhys(o) && RP.on){
    const ax = swingAxle(o), A = mechActTime(o), th = swingAngle(o.mech, A == null ? null : when - A);
    return rotAxis([o.x, o.y, ax.zc], ax.piv, ax.k, -th);
  }
  return [o.x, o.y, tgtCenterZ(o)];
}
const RP = {on:false, playing:false, t:0, speed:1, total:0, sound:true, random:false, res:null, plan:null, stops:[], outcomes:[], fallT:{}, act:{}, lastWall:0, pre:null, raf:0};
let AC = null;
function audio(){ if(!AC){ try{ AC = new (window.AudioContext || window.webkitAudioContext)(); }catch(e){ AC = null; } } if(AC && AC.state === 'suspended') AC.resume(); return AC; }
function sndBeep(){ const a = audio(); if(!a) return; const o = a.createOscillator(), g = a.createGain(); o.type = 'square'; o.frequency.value = 2900; g.gain.setValueAtTime(0.0001, a.currentTime); g.gain.exponentialRampToValueAtTime(0.25, a.currentTime + 0.01); g.gain.setValueAtTime(0.25, a.currentTime + 0.33); g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.36); o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + 0.4); }
function noiseBuf(a, dur){ const b = a.createBuffer(1, Math.max(1, Math.floor(a.sampleRate * dur)), a.sampleRate), d = b.getChannelData(0); for(let i = 0; i < d.length; i++) d[i] = Math.random()*2 - 1; return b; }
function sndShot(){
  const a = audio(); if(!a) return; const t = a.currentTime;
  const n = a.createBufferSource(); n.buffer = noiseBuf(a, 0.12);
  const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 0.8;
  const g = a.createGain(); g.gain.setValueAtTime(0.6, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
  n.connect(f).connect(g).connect(a.destination); n.start(t);
  // slide cycling click
  const c = a.createBufferSource(); c.buffer = noiseBuf(a, 0.03); const hp = a.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000;
  const g2 = a.createGain(); g2.gain.setValueAtTime(0.25, t + 0.03); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
  c.connect(hp).connect(g2).connect(a.destination); c.start(t + 0.03);
}
function sndDing(stop){
  const a = audio(); if(!a) return; const t = a.currentTime;
  (stop ? [1500, 2350, 3900] : [1900, 2760, 4200]).forEach((fq, i) => {
    const o = a.createOscillator(), g = a.createGain(); o.type = 'sine'; o.frequency.value = fq;
    g.gain.setValueAtTime(0.18 / (i + 1), t); g.gain.exponentialRampToValueAtTime(0.0005, t + (stop ? 0.9 : 0.5));
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + 1);
  });
}
function sndClick(n){ const a = audio(); if(!a) return; for(let i = 0; i < (n || 2); i++){ const t = a.currentTime + i*0.12; const s = a.createBufferSource(); s.buffer = noiseBuf(a, 0.02); const g = a.createGain(); g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.02); s.connect(g).connect(a.destination); s.start(t); } }
function sndPaper(){ const a = audio(); if(!a) return; const t = a.currentTime, s = a.createBufferSource(); s.buffer = noiseBuf(a, 0.03); const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900; const g = a.createGain(); g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.03); s.connect(f).connect(g).connect(a.destination); s.start(t); }
function say(txt){ try{ const u = new SpeechSynthesisUtterance(txt); u.lang = 'en-US'; u.rate = 1; speechSynthesis.speak(u); }catch(e){} }
// speak, then call cb when the voice has finished (with fallbacks when the device has no voice or never reports the end)
function sayThen(txt, cb){
  let done = false, started = false; const fin = () => { if(!done){ done = true; cb(); } };
  const est = 0.6 + txt.length * 0.07;
  try{
    if(!('speechSynthesis' in window)) throw new Error('no speech');
    const u = new SpeechSynthesisUtterance(txt); u.lang = 'en-US'; u.rate = 1;
    u.onstart = () => { started = true; setTimeout(fin, (est + 2) * 1000); };
    u.onend = fin; u.onerror = fin;
    speechSynthesis.speak(u);
  }catch(e){ setTimeout(fin, est * 1000); return; }
  setTimeout(() => { if(!started) fin(); }, 2000);   // no voice on this device: go on after 2 s
}
const RHYTHM_READY_PAUSE = 0.6;          // seconds between the end of "Are you ready?" and "Standby"
const RHYTHM_DELAY = [0.5, 2];             // random gap between the end of "Standby" and the start beep

function rng(seed){ let x = seed | 0 || 1; return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 100000) / 100000; }; }
function startReplay(opts){
  const plan = replayPlanOverride || activePlan(); if(!plan){ alert('請先建立路線計畫。'); return; }
  const R = computePlan(plan); planCache = null;
  if(!R.shots.length){ alert('計畫中沒有任何一槍。'); return; }
  const T = PROFILE.time, start = startObj();
  // movement windows per stop
  const stops = []; let prev = start ? [start.x, start.y] : [plan.stops[0].x, plan.stops[0].y];
  plan.stops.forEach((st, k) => { stops.push(replayLeg(R, k, st, prev)); prev = [st.x, st.y]; });
  annotateAdj(R, plan);
  // outcome of every shot
  const r = rng(opts && opts.seed || 12345);
  const outcomes = R.shots.map(x => {
    if(!RP.random || !x.scored) return x.steel ? 'hit' : 'A';
    const u = r();
    if(x.steel) return u < x.pS ? 'hit' : 'miss';
    const h = x.hd; return u < h.A ? 'A' : u < h.A + h.C ? 'C' : u < h.A + h.C + h.D ? 'D' : u < h.A + h.C + h.D + h.M ? 'M' : 'NS';
  });
  const fallT = {};
  R.shots.forEach((x, i) => { const o = getObj(x.target); if(!o || !x.steel) return; if(outcomes[i] === 'hit' && fallT[o.id] == null) fallT[o.id] = shotImpact(x); });
  Object.assign(RP, {on:true, playing:false, t:0, total:R.total + 1.5, res:R, plan, stops, outcomes, fallT, pre:null, cmp:null, rl:reloadWindows(R, stops),
    seed:opts && opts.seed || 12345, srcPlanId:activePlan() ? activePlan().id : null, layout:replayLayoutKey()});
  RP.tknock = [];
  if(RP.random && R.tunnelRisk){ const rnd = mulberry32(RP.seed + 7); R.tunnelRisk.forEach(r => { const S = RP.stops[r.stop]; r.idx.forEach(i => { if(rnd() < r.p) RP.tknock.push({id:r.tunnel, idx:i, t:S ? (S.dep + S.arr) / 2 : 0}); }); }); }
  if(RP.cmpId){ const cp = plans().find(p => p.id === RP.cmpId && p.id !== plan.id); if(cp){ RP.cmp = buildRun(cp); RP.total = Math.max(RP.total, RP.cmp.res.total + 1.5); } }
  RP.act = replayActivations();
  if(leftTab !== '3d') setLeftTab('3d');
  refresh3dModes(); syncReplayUI(); render3d();
}
function buildRun(plan){
  // movement windows of a second plan for side-by-side replay
  const R = computePlan(plan); planCache = null;
  const T = PROFILE.time, start = startObj(), stops = [];
  let prev = start ? [start.x, start.y] : [plan.stops[0].x, plan.stops[0].y];
  plan.stops.forEach((st, k) => { stops.push(replayLeg(R, k, st, prev)); prev = [st.x, st.y]; });
  annotateAdj(R, plan);
  return {plan, res:R, stops, rl:reloadWindows(R, stops)};
}
// one movement leg of the replay: leave after the last shot of the previous stop, walk the path around the walls
function replayLeg(R, k, st, prev){
  const T = PROFILE.time, path = walkPath(prev, [st.x, st.y]), d = path.len;
  const lastPrev = k > 0 ? Math.max(0, ...R.shots.filter(x => x.stop === k - 1).map(x => x.t)) : 0;
  const dep = k === 0 ? 0 : lastPrev + T.exitT, arr = d > 0.3 ? dep + T.startCost + d / walkSpeed(path) : dep;
  return {from:prev.slice(), to:[st.x, st.y], path, dep, arr, stance:st.stance || 'stand', postT:PROFILE.postures[st.stance || 'stand']?.t || 0, reload:st.reload, stop:st};
}
// the posture each shot really needs (lean out past a wall edge, crouch under a port...), from the visibility
// check of its stop: the replay figure takes it before the shot, so it never appears to shoot through a wall
function annotateAdj(R, plan){
  R.shots.forEach(x => {
    const st = plan.stops[x.stop]; if(!st){ x.adj = null; return; }
    const r = stopVisMemo(st)[x.target];
    x.adj = r && r.posture ? {key:r.postureKey || st.stance || 'stand', lat:r.lean || 0} : null;
  });
}
function figAdj(t){
  const k = stopAt(t); if(k < 0) return {lat:0, eye:null, key:null};
  const S = RP.stops[k], list = RP.res.shots.filter(x => x.stop === k); if(!list.length) return {lat:0, eye:null, key:null};
  let j = list.findIndex(x => shotFire(x) >= t - 0.06); if(j < 0) j = list.length - 1;
  const cur = list[j], pv = j > 0 ? list[j-1] : null;
  const a0 = pv ? pv.adj : null, a1 = cur.adj;
  if(!a0 && !a1) return {lat:0, eye:null, key:null};
  const t0 = pv ? shotFire(pv) + 0.05 : S.arr, t1 = Math.max(t0 + 0.12, shotFire(cur) - 0.08);
  let u = Math.max(0, Math.min(1, (t - t0) / (t1 - t0))); u = u*u*(3 - 2*u);
  const base = postureEye(S.stance || 'stand'), ey = a => a ? postureEye(a.key) : base, la = a => a ? a.lat : 0;
  return {lat:la(a0) + (la(a1) - la(a0))*u, eye:ey(a0) + (ey(a1) - ey(a0))*u, key:(u >= 0.5 ? a1 : a0)?.key || null};
}
// walking direction of a leg at time t (along the path, not the straight line)
function legDir(s, t){
  if(!s.path) return [s.to[0] - s.from[0], s.to[1] - s.from[1]];
  const u = Math.max(0, Math.min(1, (t - s.dep) / Math.max(1e-6, s.arr - s.dep))), e = u*u*(3 - 2*u);
  return pathAt(s.path, s.path.len * e).dir;
}
function withRun(run, fn){ const bs = RP.stops, br = RP.res, bp = RP.plan, bl = RP.rl; RP.stops = run.stops; RP.res = run.res; RP.plan = run.plan; RP.rl = run.rl; try{ return fn(); } finally { RP.stops = bs; RP.res = br; RP.plan = bp; RP.rl = bl; } }
function effSpeed(a, b){
  const T = PROFILE.time, d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  if(!(PROFILE.body && PROFILE.body.lateral3m)) return T.speed;
  const dd = downDir(), sAng = Math.abs(((b[0] - a[0])*dd[1] - (b[1] - a[1])*dd[0]) / d), vl = 3 / Math.max(0.3, PROFILE.body.lateral3m - T.startCost);
  return 1 / ((1 - sAng) / T.speed + sAng / vl);
}
// aim direction during replay: rotates from the previous target to the next one over the modelled transition (accelerate, then settle)
function aimDirAt(t, p){
  const shots = RP.res.shots, j = shots.findIndex(x => x.t >= t - 0.02);
  if(j < 0) return null;
  const nx = shots[j], on = getObj(nx.target); if(!on) return null;
  const to = Math.atan2(on.y - p[1], on.x - p[0]);
  const pv = j > 0 ? shots[j - 1] : null;
  if(!pv || pv.stop !== nx.stop || pv.target === nx.target) return to;
  const op = getObj(pv.target); if(!op) return to;
  const from = Math.atan2(op.y - p[1], op.x - p[0]);
  const settle = PROFILE.body ? PROFILE.body.settle : 0.12, dur = Math.max(0.05, nx.dt - settle);
  let u = Math.max(0, Math.min(1, (t - pv.t) / dur)); u = u*u*(3 - 2*u);
  let dA = to - from; while(dA > Math.PI) dA -= 2*Math.PI; while(dA < -Math.PI) dA += 2*Math.PI;
  return from + dA * u;
}
function figPos(t){
  const p = figPos0(t), a = RP.res && RP.res.shots && RP.res.shots[0] && 'adj' in RP.res.shots[0] ? figAdj(t) : null;
  if(!a || !a.lat) return p;
  const d = downDir(); return [p[0] + d[1]*a.lat, p[1] - d[0]*a.lat];   // + = to the right of downrange (as in postures())
}
function figPos0(t){
  const S = RP.stops; if(!S.length) return [0, 0];
  for(let k = 0; k < S.length; k++){
    const s = S[k];
    if(t < s.dep) return s.from;
    if(t <= s.arr){ const u = (t - s.dep) / Math.max(1e-6, s.arr - s.dep), e = u*u*(3 - 2*u);
      if(s.path && s.path.pts.length > 2) return pathAt(s.path, s.path.len * e).p;
      return [s.from[0] + (s.to[0] - s.from[0])*e, s.from[1] + (s.to[1] - s.from[1])*e]; }
    if(k === S.length - 1 || t < S[k+1].dep) return s.to;
  }
  return S[S.length - 1].to;
}
function stopAt(t){ const S = RP.stops; for(let k = S.length - 1; k >= 0; k--) if(t >= S[k].arr) return (k === S.length - 1 || t < S[k+1].dep) ? k : -1; return -1; }
// is the figure sitting at time t? returns the seat ({h, straddle}) or null
function figSeat(t){
  const k = stopAt(t), p = figPos(t), c = stage.startCond || {};
  if(k >= 0 && RP.stops[k].stance === 'sit') return seatAt(p[0], p[1]) || {h:0.45, straddle:false};
  const first = RP.stops[0];
  if(c.pose && c.pose !== 'stand' && first && t < first.dep + (c.after === 'stay' ? 0 : startRise() * 0.6) && (k < 0 || k === 0)){
    const so = getObj(c.seatObj); return so ? {obj:so, h:so.seat || (so.type === 'barrel' ? (so.h || 0.9) : 0.45), straddle:c.pose === 'straddle'} : {h:0.45, straddle:c.pose === 'straddle'};
  }
  return null;
}
function figBase(t){ const p = figPos(t); return surfaceAt(p[0], p[1]); }
function figEye(t){
  const se = figSeat(t); if(se) return se.h + sitEye();
  const e = figEye0(t) + figBase(t), p = figPos(t), tn = inTunnel(p[0], p[1]);
  return tn ? Math.min(e, (tn.h || TUNNEL_DEF.h) - 0.2) : e;   // bent low under the slats of a Cooper tunnel
}
function figEye0(t){
  const k = stopAt(t), stand = postureEye('stand'); if(k < 0) return stand;
  const s = RP.stops[k], a = RP.res && RP.res.shots && RP.res.shots[0] && 'adj' in RP.res.shots[0] ? figAdj(t) : null;
  const u = s.stance === 'stand' ? 1 : Math.min(1, (t - s.arr) / Math.max(0.2, s.postT)), e0 = stand + (postureEye(s.stance) - stand) * u;
  return a && a.eye != null ? e0 + (a.eye - postureEye(s.stance || 'stand')) : e0;
}
// slats knocked off a Cooper tunnel in this replay (only when outcomes are drawn at random)
function tunnelFallen(o){
  if(!RP.on || !RP.tknock) return null;
  const s = new Set(); RP.tknock.forEach(k => { if(k.id === o.id && RP.t >= k.t) s.add(k.idx); }); return s;
}
function replayActivations(){
  // when does each activator fire? steel: when it falls; triggers: when the figure first passes within 0.6 m
  const act = {};
  stage.objects.forEach(o => {
    if(RP.fallT[o.id] != null) act[o.id] = RP.fallT[o.id];
    if(o.type === 'trigger'){ for(let t = 0; t <= RP.total; t += 0.05){ const p = figPos(t); if(Math.hypot(p[0] - o.x, p[1] - o.y) < 0.6){ act[o.id] = t; break; } } }
    if(o.type === 'paper'){ const sh = RP.res.shots.find(x => x.target === o.id); if(sh) act[o.id] = shotImpact(sh); }
  });
  return act;
}
function mechActTime(o){ const m = o.mech; if(!m || m.act.mode === 'none') return null; if(m.act.mode === 'start') return 0; const a = RP.act[m.act.id]; return a == null ? null : a + (m.act.delay || 0); }
/* ---------- swinger: compound pendulum ----------
   A rigid arm turns on a low-friction bearing (pivot). The heavy counterweight sits below the pivot,
   the light target above it, so at rest the target stands upright (theta = 0).
   Locked: the counterweight is lifted to one side (theta0), stored potential energy, angular speed 0.
   Released (activator down + delay): I*alpha = -M*g*d*sin(theta) - c*omega - q*omega*|omega| - friction. */
const SWING_DEF = {rT:0.45, rC:0.20, mT:0.30, mC:2.0, mA:0.40, keep:70, side:'right', fric:0.3};
const G0 = 9.81;
function isSwingPhys(o){ return !!(o && o.type === 'paper' && o.mech && o.mech.type === 'swinger'); }
function swingPar(m){ return Object.assign({}, SWING_DEF, m.phys || {}); }
function swingBody(m){
  const P = swingPar(m), M = P.mT + P.mC + P.mA, L = P.rT + P.rC;
  const d = (P.mC * P.rC - P.mT * P.rT + P.mA * (P.rC - P.rT) / 2) / M;          // center of mass below the pivot (+)
  const I = P.mC * P.rC * P.rC + P.mT * P.rT * P.rT + (P.mA / L) * (P.rC ** 3 + P.rT ** 3) / 3;
  const K = M * G0 * d;                                                            // gravity torque scale, N·m
  const wn = K > 0 ? Math.sqrt(K / I) : 0;
  const del = Math.log(100 / Math.min(99.9, Math.max(1, P.keep)));                // log decrement per full swing
  const zeta = del / Math.sqrt(4 * Math.PI * Math.PI + del * del);
  let c = 2 * zeta * I * wn;                                                       // bearing (viscous) damping, first guess
  const q = 0.5 * 1.2 * 1.2 * (0.02 * 0.45) * P.rT ** 3;                           // air drag on the target's leading edge
  const tf = 0.01 * P.fric * Math.max(0, K);                                       // bearing breakaway friction
  const body = {P, M, d, I, K, wn, zeta, c, q, tf, period:wn ? 2 * Math.PI / wn : null};
  if(K > 0) body.c = swingCalib(body, rad(Math.min(170, Math.max(5, m.amp == null ? 90 : m.amp))), P.keep / 100);
  return body;
}
// choose the bearing damping so that one full swing from the lock angle keeps the stated share of amplitude
// (air drag and breakaway friction included), instead of trusting the small-angle formula
function swingCalib(B, a0, keep){
  const ratio = c => {
    const dt = 1/400; let x = a0, w = 0, peaks = 0, t = 0;
    const acc = (x, w) => (-B.K * Math.sin(x) - c * w - B.q * w * Math.abs(w) - B.tf * Math.tanh(w / 0.02)) / B.I;
    while(t < 20){
      const k1w = acc(x, w), k2w = acc(x + w*dt/2, w + k1w*dt/2), k3w = acc(x + (w + k1w*dt/2)*dt/2, w + k2w*dt/2), k4w = acc(x + (w + k2w*dt/2)*dt, w + k3w*dt);
      const nx = x + dt/6*(w + 2*(w + k1w*dt/2) + 2*(w + k2w*dt/2) + (w + k3w*dt)), nw = w + dt/6*(k1w + 2*k2w + 2*k3w + k4w);
      if(Math.sign(nw) !== Math.sign(w) && w !== 0){ peaks++; if(peaks === 2) return Math.abs(nx) / a0; }
      x = nx; w = nw; t += dt;
      if(Math.abs(w) < 2e-3 && B.K * Math.abs(Math.sin(x)) <= B.tf && t > 0.1) return 0;
    }
    return 1;
  };
  let lo = 0, hi = 4 * B.I * B.wn;
  if(ratio(0) <= keep) return 0;                  // friction and air alone already lose more than asked
  for(let i = 0; i < 24; i++){ const mid = (lo + hi) / 2; if(ratio(mid) > keep) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
const SWING_CACHE = new Map();
function swingSim(m){
  const key = JSON.stringify([swingPar(m), m.amp]);
  let S = SWING_CACHE.get(key); if(S) return S;
  const B = swingBody(m), dt = 1/400, T = 40;
  const th0 = rad(Math.min(170, Math.max(1, m.amp == null ? 90 : m.amp))) * (B.P.side === 'left' ? -1 : 1);
  const n = Math.round(T / dt), th = new Float32Array(n + 1);
  let x = th0, w = 0, stopped = -1, tCenter = null, tTurn = null, turnAng = null, wMax = 0, tSettle = null, lastPeak = Math.abs(th0), crossings = [];
  const acc = (x, w) => (-B.K * Math.sin(x) - B.c * w - B.q * w * Math.abs(w) - B.tf * Math.tanh(w / 0.02)) / B.I;
  th[0] = x;
  for(let i = 1; i <= n; i++){
    if(stopped < 0){
      const k1x = w, k1w = acc(x, w), k2x = w + k1w*dt/2, k2w = acc(x + k1x*dt/2, w + k1w*dt/2);
      const k3x = w + k2w*dt/2, k3w = acc(x + k2x*dt/2, w + k2w*dt/2), k4x = w + k3w*dt, k4w = acc(x + k3x*dt, w + k3w*dt);
      const nx = x + dt/6*(k1x + 2*k2x + 2*k3x + k4x), nw = w + dt/6*(k1w + 2*k2w + 2*k3w + k4w);
      const t = i * dt;
      if(Math.sign(nx) !== Math.sign(x) && x !== 0){ crossings.push(t); if(tCenter == null) tCenter = t; }
      if(Math.sign(nw) !== Math.sign(w) && w !== 0){ if(tTurn == null){ tTurn = t; turnAng = Math.abs(nx); } lastPeak = Math.abs(nx); if(tSettle == null && lastPeak < rad(3)) tSettle = t; }
      x = nx; w = nw; wMax = Math.max(wMax, Math.abs(w));
      if(Math.abs(w) < 2e-3 && B.K * Math.abs(Math.sin(x)) <= B.tf){ stopped = i; w = 0; if(tSettle == null) tSettle = t; }
    }
    th[i] = x;
  }
  const per = crossings.length >= 3 ? crossings[2] - crossings[0] : B.period;
  S = {dt, th, th0, B, tCenter, tTurn, turnAng, wMax, vMax:wMax * B.P.rT, period:per, tSettle, restAng:x};
  if(SWING_CACHE.size > 50) SWING_CACHE.clear(); SWING_CACHE.set(key, S);
  return S;
}
function swingAngle(m, tRel){   // tRel = seconds since release; locked before that
  const S = swingSim(m);
  if(tRel == null || tRel <= 0) return S.th0;
  const f = tRel / S.dt, i = Math.floor(f);
  if(i >= S.th.length - 1) return S.th[S.th.length - 1];
  return S.th[i] + (S.th[i+1] - S.th[i]) * (f - i);
}
// pivot and axle of a swinger in world space, from its upright rest pose
function swingAxle(host){
  const g = paperGeom(Object.assign({}, host, {swing:null})), P = swingPar(host.mech);
  const zc = (g.top + g.bottom) / 2;
  return {piv:[host.x, host.y, Math.max(0.05, zc - P.rT)], k:[g.f[0], g.f[1], 0], zc, low:zc - P.rT < 0.05};
}
// pose of an object at replay time: moved copy, fallen flag, or null when hidden
function replayPose(o){
  if(!RP.on) return o;
  const t = RP.t;
  if((o.type === 'popper' || o.type === 'plate' || o.type === 'stopplate') && RP.fallT[o.id] != null && t >= RP.fallT[o.id]) return Object.assign({}, o, {fallen:Math.min(1, (t - RP.fallT[o.id]) / 0.25)});
  const host = o.type === 'noshoot' && o.cover ? getObj(o.cover) : o;
  if(!host || !isMech(host)) return o;
  const m = host.mech, A = mechActTime(host);
  const vis = A == null ? m.preVisible : (t < A ? m.preVisible : (t >= A + (m.winFrom || 0) && (m.winTo == null || t <= A + m.winTo)) || (m.preVisible && t < A + (m.winFrom || 0) && m.type === 'swinger'));
  if(!vis && m.type !== 'swinger' && m.type !== 'slider') return null;
  let dx = 0, dy = 0;
  if(m.type === 'swinger' && host.type === 'paper'){
    const ax = swingAxle(host), th = swingAngle(m, A == null ? null : t - A);
    return Object.assign({}, o, {swing:{piv:ax.piv, k:ax.k, a:-th}});   // + theta = toward the shooter's right
  }
  if(A != null && t >= A){
    if(m.type === 'slider' && m.ex != null){ const u = Math.min(1, (t - A) / (m.travel || 2)); dx = (m.ex - host.x)*u; dy = (m.ey - host.y)*u; }
  }
  return Object.assign({}, o, {x:o.x + dx, y:o.y + dy});
}
// reload windows [a, b] in replay time, from the model's reload log
function reloadWindows(R, stops){
  const T = PROFILE.time, out = [];
  (R.reloadLog || []).forEach(r => {
    if(r.forced){ const s = R.shots[r.shot]; if(s) out.push({a:s.t - s.dt, b:s.t - s.dt + r.extra, stop:r.stop}); }
    else if(r.moving){ const st = stops[r.stop]; if(st) out.push({a:st.dep, b:st.dep + Math.max(0.3, T.reloadMove), stop:r.stop, moving:true}); }
    else { const s = R.shots.find(x => x.stop === r.stop); if(s){ const a = s.t - s.dt + (s.parts.move || 0); out.push({a, b:a + r.extra, stop:r.stop}); } }
  });
  return out;
}
function tgtCenterZ(o){
  if(!o) return 1.2;
  if(o.type === 'paper' || o.type === 'noshoot'){ const g = paperGeom(o); return (g.top + g.bottom) / 2; }
  if(o.type === 'popper'){ const sp = o.mini ? RULE_SPECS.miniPopper : RULE_SPECS.popper; return sp.h - sp.headD / 2; }
  return o.cy != null ? o.cy : stage.plateCy;
}
// floor path, stop discs and reload markers of the plan (replay, or the active plan when "show route" is on)
function planPath3d(floor, labels){
  const plan = RP.on ? RP.plan : activePlan(); if(!plan || !plan.stops.length) return;
  if(!RP.on && !($('planShow') && $('planShow').checked)) return;
  const R = RP.on ? RP.res : planResult(plan), start = startObj();
  const pts = planWalkPts(plan);
  for(let i = 1; i < pts.length; i++) floor.push({line:[[pts[i-1][0], pts[i-1][1], 0.012], [pts[i][0], pts[i][1], 0.012]], stroke:'rgba(31,110,140,.7)', wlw:0.05});
  plan.stops.forEach((s, k) => {
    floor.push({pts:circlePts(s.x, s.y, 0.22, 20).map(q => [q[0], q[1], 0.011]), fill:'rgba(31,110,140,.16)', stroke:'#1F6E8C', lw:1.5});
    labels.push({p:[s.x, s.y, 0.04], t:'S' + (k + 1), c:'#1F6E8C', pri:1});
  });
  (R.reloadLog || []).forEach(r => {
    const st = plan.stops[r.stop]; if(!st) return;
    const pv = r.stop === 0 ? (start ? [start.x, start.y] : [st.x, st.y]) : [plan.stops[r.stop - 1].x, plan.stops[r.stop - 1].y];
    const at = r.forced || !r.moving ? [st.x + 0.4, st.y] : (w => pathAt(w, w.len / 2).p)(walkPath(pv, [st.x, st.y]));
    floor.push({pts:circlePts(at[0], at[1], 0.12, 14).map(q => [q[0], q[1], 0.014]), fill:'#F0A020', stroke:'#8A4F00', lw:1});
    labels.push({p:[at[0], at[1], 0.12], t:'換匣', c:'#8A4F00'});
  });
}
function replayFigure(faces, labels, colOverride, tag){
  // three.js renderer with the animated shooter: pose it, then add the muzzle flash, BB and label
  if(typeof t3Figure === 'function' && t3Wanted() && T3.on && T3.assets && !T3.failed){
    const F = t3Figure(colOverride);
    if(F){
      const t = RP.t, p = figPos(t), shotNow = RP.res.shots.some(x => t >= shotFire(x) && t - shotFire(x) < 0.05);
      const m = F.gun.localToWorld(new THREE.Vector3(0, 0.035, 0.15)), muzzle = [m.x, -m.z, m.y];
      replayTracers(faces, muzzle, t, shotNow);
      const rl = (RP.rl || []).find(w => t >= w.a && t <= w.b);
      labels.push({p:[p[0], p[1], figEye(t) + 0.35], t:(tag || ('射手' + (RP.cmp ? '（計畫 ' + RP.plan.name + '）' : ''))) + (rl ? '・換匣' : ''), c:colOverride || '#1F4E8C', pri:0});
      return;
    }
  }
  const t = RP.t, p = figPos(t), seat = figSeat(t), base = seat ? 0 : figBase(t), eye = figEye(t) - base, stand = postureEye('stand');
  const shots = RP.res.shots; let aim = null, aimObj = null;
  const nxt = shots.find(x => x.t >= t - 0.12);
  const k = stopAt(t);
  if(nxt && k >= 0 && nxt.stop === k){ aimObj = getObj(nxt.target); if(aimObj) aim = [aimObj.x, aimObj.y]; }
  const mv = RP.stops.find(s => t > s.dep && t < s.arr);
  let dir;
  const aA = aim ? aimDirAt(t, p) : null;
  if(aA != null) dir = [Math.cos(aA), Math.sin(aA)];
  else if(aim) dir = [aim[0] - p[0], aim[1] - p[1]];
  else dir = mv ? legDir(mv, t) : downDir();
  { const se0 = figSeat(t); if(se0 && se0.obj && se0.obj.rot != null && (!aim || se0.straddle) && !(aA != null && !se0.straddle)) dir = facing(se0.obj.rot); }   // sit the way the chair, boat or horse faces
  const L = Math.hypot(dir[0], dir[1]) || 1; dir = [dir[0]/L, dir[1]/L];
  const side = [dir[1], -dir[0]];                                   // shooter's right
  const hs = PROFILE.body && PROFILE.body.hand === 'left' ? -1 : 1;  // gun-hand side
  const col = colOverride || '#1F4E8C', skin = '#E6BE98', dark = '#20262E';
  const P = (fw, sd, z) => [p[0] + dir[0]*fw + side[0]*sd, p[1] + dir[1]*fw + side[1]*sd, z + base];
  const add = (a, b, w) => [a[0] + b[0]*w, a[1] + b[1]*w, a[2] + b[2]*w];
  const mix = (a, b, u) => [a[0] + (b[0] - a[0])*u, a[1] + (b[1] - a[1])*u, a[2] + (b[2] - a[2])*u];
  const limb = (a, b, w, c) => faces.push({line:[a, b], stroke:c || col, wlw:w, bias:-0.3});
  const ball = (q, r, c) => faces.push({dot:q, fill:c || col, wr:r, bias:-0.32});
  const rlw = (RP.rl || []).find(w => t >= w.a && t <= w.b);
  const first = shots[0], sc = stage.startCond || {};
  const drawEnd = first ? Math.max(0.3, first.t - first.dt + (first.parts.move || 0) + Math.max(0.2, (first.parts.shoot || 0) - 0.08)) : 0;
  const drawing = first && t < drawEnd;
  const shotNow = shots.some(x => t >= shotFire(x) && t - shotFire(x) < 0.05);
  // gun direction toward the target, including height
  const gunDir = (hand, pitchDeg) => {
    if(pitchDeg == null && aimObj){ const tz = tgtCenterZ(aimObj), hd = Math.hypot(aimObj.x - hand[0], aimObj.y - hand[1]) || 1, a = Math.atan2(tz - hand[2], hd); return [dir[0]*Math.cos(a), dir[1]*Math.cos(a), Math.sin(a)]; }
    const a = (pitchDeg || 0) * Math.PI / 180; return [dir[0]*Math.cos(a), dir[1]*Math.cos(a), Math.sin(a)];
  };
  const arm = (sh, hand, out) => { const m = mix(sh, hand, 0.5), el = [m[0] + side[0]*0.07*out, m[1] + side[1]*0.07*out, m[2] - 0.07]; limb(sh, el, 0.085); limb(el, hand, 0.075); ball(hand, 0.045, skin); };
  let muzzle = null;
  if(eye < 0.5){
    // prone
    const head = P(0.12, 0, 0.2), sh = P(0, 0, 0.18), hip = P(-0.7, 0, 0.14);
    limb(hip, sh, 0.3); ball(head, 0.11, skin);
    limb(hip, P(-1.5, 0.2, 0.07), 0.12); limb(hip, P(-1.5, -0.2, 0.07), 0.12);
    const hand = P(0.55, 0, 0.24); arm(P(0, 0.2, 0.18), hand, 1); arm(P(0, -0.2, 0.18), hand, -1);
    const gd = gunDir(hand, aimObj ? null : 0); muzzle = add(hand, gd, 0.2); limb(hand, muzzle, 0.045, dark);
  }else{
    const drop = Math.max(0, stand - eye), kneel = !seat && eye <= postureEye('kneel') + 0.05;
    const hipZ = seat ? seat.h + 0.08 : kneel ? 0.62 : Math.max(0.5, 0.53*stand - drop*0.95);
    const lean = mv ? 0.14 : 0.06, shZ = eye - 0.2;
    const hip = P(-0.03, 0, hipZ), shC = P(lean, 0, shZ);
    // legs
    const leg = (hp, knee, foot) => { limb(hp, knee, 0.13); limb(knee, foot, 0.1); limb(foot, add(foot, [dir[0], dir[1], 0], 0.17), 0.08, dark); };
    const hpR = P(-0.03, 0.1, hipZ), hpL = P(-0.03, -0.1, hipZ);
    if(seat && seat.straddle){ const fz = Math.max(0.02, seat.h - 0.75); leg(hpR, P(0.12, 0.32, seat.h - 0.2), P(0.1, 0.36, fz)); leg(hpL, P(0.12, -0.32, seat.h - 0.2), P(0.1, -0.36, fz)); }
    else if(seat){ leg(hpR, P(0.42, 0.13, seat.h + 0.04), P(0.48, 0.14, 0.02)); leg(hpL, P(0.42, -0.13, seat.h + 0.04), P(0.48, -0.14, 0.02)); }
    else if(kneel){ leg(hpR, P(-0.05, 0.12*hs, 0.06), P(-0.45, 0.12*hs, 0.05)); leg(hpL, P(0.38, -0.12*hs, 0.5), P(0.4, -0.12*hs, 0.01)); }
    else if(mv && !seat){
      const d = Math.hypot(p[0] - mv.from[0], p[1] - mv.from[1]), a = Math.sin(d / 0.6 * Math.PI);
      const fR = P(0.34*a, 0.11, 0.02 + Math.max(0, -a)*0.14), fL = P(-0.34*a, -0.11, 0.02 + Math.max(0, a)*0.14);
      leg(hpR, add(mix(hpR, fR, 0.5), [dir[0], dir[1], 0], 0.12), fR); leg(hpL, add(mix(hpL, fL, 0.5), [dir[0], dir[1], 0], 0.12), fL);
    }else{
      const kf = Math.min(0.32, drop*0.8);
      leg(hpR, P(0.05 + kf, 0.15, hipZ*0.5 + 0.04), P(0.05, 0.17, 0.01)); leg(hpL, P(0.05 + kf, -0.15, hipZ*0.5 + 0.04), P(0.05, -0.17, 0.01));
    }
    // torso and head
    limb(P(-0.03, -0.11, hipZ), P(-0.03, 0.11, hipZ), 0.16);
    limb(hip, shC, 0.3); limb(P(lean, -0.19, shZ), P(lean, 0.19, shZ), 0.12);
    limb(shC, P(lean + 0.01, 0, eye - 0.08), 0.09, skin);
    ball(P(lean + 0.02, 0, eye + 0.02), 0.11, skin);
    ball(P(lean - 0.005, 0, eye + 0.07), 0.1, dark);   // hair or cap
    // arms and gun
    const shG = P(lean, 0.19*hs, shZ), shS = P(lean, -0.19*hs, shZ);
    const aimH = P(lean + 0.52, 0, eye - 0.13), lowH = P(lean + 0.3, 0.04*hs, eye - 0.45), holster = P(-0.02, 0.24*hs, hipZ + 0.02);
    let gH, sH, gd, magAt = null, gunShown = true;
    if(drawing){
      const u0 = sc.hands === 'wrists' ? 0.12 : 0.08, u = Math.max(0, Math.min(1, (t - u0) / Math.max(0.2, drawEnd - u0)));
      const lap = sc.hands === 'lap' && seat;
      const rest = sc.hands === 'wrists' ? P(lean - 0.05, 0.3*hs, eye + 0.12) : lap ? P(0.3, 0.12*hs, hipZ + 0.05) : P(0, 0.26*hs, hipZ - 0.05);
      const restS = sc.hands === 'wrists' ? P(lean - 0.05, -0.3*hs, eye + 0.12) : lap ? P(0.3, -0.12*hs, hipZ + 0.05) : P(0, -0.26*hs, hipZ - 0.05);
      const pick = sc.gunLoc && sc.gunLoc !== 'holster';
      gH = u < 0.35 ? mix(rest, pick ? P(0.35, 0.1*hs, 0.8) : holster, u / 0.35) : mix(pick ? P(0.35, 0.1*hs, 0.8) : holster, aimH, (u - 0.35) / 0.65);
      sH = u < 0.5 ? mix(restS, P(lean + 0.2, 0, eye - 0.35), u / 0.5) : mix(P(lean + 0.2, 0, eye - 0.35), aimH, (u - 0.5) / 0.5);
      gd = gunDir(gH, u < 0.35 ? -80 : u < 0.7 ? -25 : null); gunShown = u > 0.25 || !pick;
      if(!pick && u <= 0.35){ gd = [0, 0, -1]; }
    }else if(rlw){
      const u = (t - rlw.a) / Math.max(0.05, rlw.b - rlw.a), pouch = P(-0.05, -0.2*hs, hipZ + 0.06);
      gH = P(lean + 0.3, 0.02*hs, eye - 0.4); gd = gunDir(gH, 35);
      sH = u < 0.35 ? mix(gH, pouch, u / 0.35) : u < 0.75 ? mix(pouch, add(gH, [0, 0, -1], 0.07), (u - 0.35) / 0.4) : add(gH, [0, 0, -1], 0.06);
      if(u >= 0.35 && u < 0.8) magAt = add(sH, [0, 0, 1], 0.04);
    }else if(aim){ gH = aimH; sH = aimH; gd = gunDir(gH, null); }
    else { gH = lowH; sH = add(lowH, [-dir[0], -dir[1], 0], 0.03); gd = gunDir(gH, -30); }
    arm(shG, gH, hs); arm(shS, sH, -hs);
    if(gunShown){ muzzle = add(gH, gd, 0.2); limb(add(gH, gd, -0.02), muzzle, 0.05, dark); limb(gH, add(gH, [0, 0, -1], 0.08), 0.035, dark); }
    if(magAt) limb(magAt, add(magAt, [0, 0, 1], 0.1), 0.03, '#555');
  }
  replayTracers(faces, muzzle, t, shotNow);
  labels.push({p:[p[0], p[1], base + eye + 0.35], t:(tag || ('射手' + (RP.cmp ? '（計畫 ' + RP.plan.name + '）' : ''))) + (rlw ? '・換匣' : ''), c:col, pri:0});
}
// muzzle flash and the BB in flight: drag slows it down, so it covers less ground every frame; a short trail shows the path
function replayTracers(faces, muzzle, t, shotNow){
  const shots = RP.res.shots;
  if(muzzle && shotNow) faces.push({dot:muzzle, fill:'#F5B324', wr:0.07, bias:-0.3});
  if(muzzle) shots.forEach(x => {
    const tf = shotFire(x), fl = x.flight || 0; if(t < tf || t > tf + fl + 0.03) return;
    const o = getObj(x.target); if(!o) return;
    const e = bbEndPoint(o, tf + fl), D = Math.hypot(e[0] - muzzle[0], e[1] - muzzle[1], e[2] - muzzle[2]) || 1;
    const d1 = Math.min(D, bbDistAt(t - tf)), d0 = Math.max(0, d1 - 0.6);
    const P = d => [muzzle[0] + (e[0] - muzzle[0]) * d / D, muzzle[1] + (e[1] - muzzle[1]) * d / D, muzzle[2] + (e[2] - muzzle[2]) * d / D];
    if(d1 < D){ faces.push({line:[P(d0), P(d1)], stroke:'rgba(245,179,36,.75)', lw:2, bias:-0.35}); faces.push({dot:P(d1), fill:'#FFF3B0', wr:0.012, bias:-0.36}); }
  });
}
function replayMarks(faces){
  const t = RP.t, shots = RP.res.shots;
  shots.forEach(x => { const ti = shotImpact(x); if(t < ti || t - ti > 0.15 || x.steel) return; const o0 = getObj(x.target), o = o0 && replayPose(o0); if(!o) return;
    const g = paperGeom(o); faces.push({pts:g.oct.map(([u, v]) => { const w = g.toW(u, v); return [w[0] + g.f[0]*0.004, w[1] + g.f[1]*0.004, w[2]]; }), fill:null, stroke:'#FFD23F', lw:4, bias:-0.25}); });
  shots.forEach((x, i) => {
    if(shotImpact(x) > t || x.steel) return;
    const oc = RP.outcomes[i]; if(oc === 'M') return;
    const o0 = getObj(x.target); if(!o0) return;
    const o = replayPose(o0); if(!o) return;
    const g = paperGeom(o), rr = rng(i * 7919 + 13);
    let u = 15, v = 12;
    if(oc === 'A'){ u = 15 + (rr() - 0.5)*5; v = 8 + rr()*10; }
    if(oc === 'C'){ u = 15 + (rr() < 0.5 ? -1 : 1)*(8 + rr()*3); v = 12 + rr()*12; }
    if(oc === 'D'){ u = rr() < 0.5 ? 3 : 27; v = 16 + rr()*6; }
    if(oc === 'NS'){ u = 15 + (rr() - 0.5)*8; v = 30 + rr()*4; }
    const w = g.toW(u * g.W / 30, v * g.H / 37.5);
    faces.push({dot:[w[0] + g.f[0]*0.02, w[1] + g.f[1]*0.02, w[2]], fill:oc === 'NS' ? '#C8372D' : '#111', r:3, bias:-0.2});
  });
}
function replayPhase(t){
  const shots = RP.res.shots, j = shots.findIndex(x => x.t >= t);
  if(j < 0) return {txt:'完成', col:'#2F7D4F'};
  const x = shots[j], t0 = x.t - x.dt, u = t - t0;
  const rw = (RP.rl || []).find(w => t >= w.a && t <= w.b);
  if(rw) return {txt:'換匣' + (rw.moving ? '（移動中）' : '') + '，剩 ' + fmt(Math.max(0, rw.b - t)) + ' 秒', col:'#D98A00'};
  if(u < x.parts.move) return {txt:'移動', col:'#6B3FA0'};
  if(u < x.parts.move + x.parts.wait) return {txt:'等待' + (x.why ? '：' + x.why : ''), col:'#A8641B'};
  return {txt:'射擊', col:'#2F7D4F'};
}
function replayHUD(ctx){
  const t = RP.t, R = RP.res, shots = R.shots;
  const done = shots.filter(x => x.t <= t), last = done[done.length - 1];
  ctx.save(); const hk = Math.max(0.6, Math.min(1, v3d.w / 820)); ctx.scale(hk, hk);
  ctx.fillStyle = 'rgba(20,28,38,.82)'; ctx.fillRect(10, 10, 270, RP.cmp ? 150 : 104);
  ctx.fillStyle = '#fff'; ctx.font = '700 30px "Noto Sans TC",monospace'; ctx.fillText(fmt(Math.min(t, R.total)) + ' s', 22, 48);
  ctx.font = '500 13px "Noto Sans TC",sans-serif';
  ctx.fillText('第 ' + done.length + ' ／ ' + shots.length + ' 槍' + (last ? '　split ' + fmt(last.dt) : ''), 22, 72);
  const ph = replayPhase(t); ctx.fillStyle = ph.col; ctx.fillRect(22, 82, 10, 10); ctx.fillStyle = '#fff'; ctx.fillText(ph.txt.slice(0, 22), 38, 92);
  if(RP.random){
    let pts = 0; done.forEach(x => { const oc = RP.outcomes[x.i]; if(!x.scored) return; pts += {A:5, C:3, D:1, M:-10, NS:-10, hit:5, miss:-10}[oc] || 0; });
    ctx.fillText('本次得分 ' + pts + (t >= R.total ? '，HF ' + fmt(Math.max(0, pts) / R.total, 3) : ''), 22, 108);
  }
  if(RP.cmp){
    const c = RP.cmp.res, dn = c.shots.filter(x => x.t <= t).length;
    ctx.fillStyle = '#1F4E8C'; ctx.fillRect(22, 118, 10, 10); ctx.fillStyle = '#fff';
    ctx.fillText('計畫 ' + RP.plan.name + '：' + fmt(R.total) + ' 秒', 38, 128);
    ctx.fillStyle = '#D9822B'; ctx.fillRect(22, 136, 10, 10); ctx.fillStyle = '#fff';
    ctx.fillText('計畫 ' + RP.cmp.plan.name + '：第 ' + dn + '／' + c.shots.length + ' 槍，' + fmt(c.total) + ' 秒', 38, 146);
  }
  ctx.restore();
}
let rpLastWall = 0;
function replayTick(now){
  if(!RP.on || !RP.playing){ RP.raf = 0; return; }
  const dt = rpLastWall ? (now - rpLastWall) / 1000 : 0; rpLastWall = now;
  if(RP.pre){   // rhythm drill countdown before the start signal
    const pre = RP.pre; pre.left -= dt;
    if(pre.stage === 'pause' && pre.left <= 0){
      pre.stage = 'standby'; pre.left = Infinity;
      sayThen('Standby', () => { if(RP.pre === pre && pre.stage === 'standby'){ pre.stage = 'wait'; pre.delay = RHYTHM_DELAY[0] + Math.random() * (RHYTHM_DELAY[1] - RHYTHM_DELAY[0]); pre.left = pre.delay; } });
    }
    else if(pre.stage === 'wait' && pre.left <= 0){ RP.pre = null; if(RP.sound) sndBeep(); }
    render3d(); RP.raf = requestAnimationFrame(replayTick); return;
  }
  const t0 = RP.t, t1 = Math.min(RP.total, t0 + dt * RP.speed);
  if(RP.sound) replaySounds(t0, t1);
  RP.t = t1; syncReplayUI(true); render3d();
  if(t1 >= RP.total){ RP.playing = false; syncReplayUI(); RP.raf = 0; return; }
  RP.raf = requestAnimationFrame(replayTick);
}
function replaySounds(t0, t1){
  if(t0 === 0 && t1 > 0 && !RP.beeped){ sndBeep(); RP.beeped = true; }
  RP.res.shots.forEach((x, i) => {
    const tf = shotFire(x); if(tf > t0 && tf <= t1){ sndShot(); if(!x.steel && RP.outcomes[i] !== 'M') setTimeout(sndPaper, Math.max(20, (x.flight || 0.06) * 1000 / (RP.speed || 1))); }
    const f = RP.fallT[x.target];
    if(x.steel && f != null && f > t0 && f <= t1 && RP.res.shots.findIndex(y => y.target === x.target && RP.outcomes[y.i] === 'hit') === i) sndDing(getObj(x.target)?.type === 'stopplate');
  });
  (RP.rl || []).forEach(w => { if(w.a + 0.15 > t0 && w.a + 0.15 <= t1) sndClick(1); if(w.b - 0.12 > t0 && w.b - 0.12 <= t1) sndClick(2); });
}
// keep an open replay in step with the plan chosen or edited in the planning panel
function replayLayoutKey(){ return JSON.stringify([stage.objects, stage.startCond, stage.safety]).length + '|' + JSON.stringify(stage.objects.map(o => [o.id, o.x, o.y, o.x1, o.y1, o.x2, o.y2])); }
function refreshReplayForPlan(){
  if(!RP.on) return false;
  const plan = activePlan();
  if(!plan){ exitReplay(); return false; }
  const switched = RP.srcPlanId !== plan.id;
  if(switched) replayPlanOverride = null;   // a measured-times replay stays (rebuilt on the current layout) until another plan is chosen
  const t = RP.t;
  startReplay({seed:RP.seed});
  if(!RP.on) return false;
  if(!switched){ RP.t = Math.min(t, RP.total); RP.beeped = RP.t > 0; }
  syncReplayUI(); render3d();
  if(switched && typeof toast === 'function') toast('3D 回放已改為計畫 ' + plan.name + '，按「播放」開始。', null, null, 3000);
  return true;
}
function playReplay(){
  if(!RP.on) return; audio();
  const cur = activePlan();
  if(!cur || (RP.srcPlanId !== cur.id && !replayPlanOverride) || RP.layout !== replayLayoutKey()) refreshReplayForPlan();
  if(!RP.on) return;
  if(RP.t >= RP.total - 1e-6){ RP.t = 0; RP.beeped = false; }
  RP.playing = true; rpLastWall = 0; if(!RP.raf) RP.raf = requestAnimationFrame(replayTick); syncReplayUI();
}
function pauseReplay(){ RP.playing = false; syncReplayUI(); }
function rhythmDrill(){
  if(!RP.on) startReplay(); else { const cur = activePlan(); if(cur && RP.srcPlanId !== cur.id && !replayPlanOverride) refreshReplayForPlan(); }
  if(!RP.on) return;
  audio(); RP.t = 0; RP.beeped = true; RP.sound = true; $('rpSound').checked = true;
  const pre = {stage:'ready', left:Infinity}; RP.pre = pre;
  sayThen('Are you ready?', () => { if(RP.pre === pre && pre.stage === 'ready'){ pre.stage = 'pause'; pre.left = RHYTHM_READY_PAUSE; } });
  RP.playing = true; rpLastWall = 0; if(!RP.raf) RP.raf = requestAnimationFrame(replayTick); syncReplayUI();
}
function exitReplay(){ replayPlanOverride = null; RP.on = false; RP.playing = false; RP.pre = null; if(v3d.mode === 'follow' || v3d.mode === 'fpv') v3d.mode = 'orbit'; refresh3dModes(); syncReplayUI(); render3d(); }
/* timeline strip under the replay controls: each shot's time split into moving / shooting / waiting; click jumps to that shot */
const RP_TL_COL = {move:'#4A7FB0', shoot:'#3E9B55', wait:'#E0A33A'};
function drawReplayTimeline(){
  const cv = $('rpTL'); if(!cv || !RP.on || !RP.res) return;
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth || 600, H = 34;
  if(cv.width !== Math.round(W*dpr)){ cv.width = Math.round(W*dpr); cv.height = Math.round(H*dpr); }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const T = Math.max(0.1, RP.total), X = t => 6 + (W - 12) * Math.min(1, Math.max(0, t / T));
  RP.res.shots.forEach(x => {
    const end = shotFire(x), start = end - (x.dt - (x.flight && x.kindKey === 'stopplate' ? x.flight : 0)), p = x.parts || {};
    let a = start; [['move', p.move || 0], ['wait', p.wait || 0], ['shoot', p.shoot || 0]].forEach(([k, v]) => { if(v <= 0) return; g.fillStyle = RP_TL_COL[k]; g.fillRect(X(a), 9, Math.max(1, X(a + v) - X(a)), 14); a += v; });
    g.fillStyle = x.impossible ? '#C8372D' : '#1E2B38'; g.fillRect(X(end) - 0.5, 5, 1.5, 22);
  });
  g.fillStyle = '#C8372D'; g.fillRect(X(RP.t) - 1, 0, 2, H);
  g.fillStyle = '#5B6773'; g.font = '10px sans-serif'; g.textAlign = 'left'; g.fillText('移動', 8, 33); g.fillStyle = RP_TL_COL.move; g.fillRect(30, 26, 8, 6);
  g.fillStyle = '#5B6773'; g.fillText('射擊', 44, 33); g.fillStyle = RP_TL_COL.shoot; g.fillRect(66, 26, 8, 6);
  g.fillStyle = '#5B6773'; g.fillText('等待', 80, 33); g.fillStyle = RP_TL_COL.wait; g.fillRect(102, 26, 8, 6);
}
function replayTimelineClick(e){
  if(!RP.on) return;
  const cv = $('rpTL'), r = cv.getBoundingClientRect(), W = r.width, t = Math.max(0, Math.min(1, (e.clientX - r.left - 6) / (W - 12))) * RP.total;
  // snap to the nearest shot within 0.3 s
  let best = null, bd = 0.3; RP.res.shots.forEach(x => { const d = Math.abs(shotFire(x) - t); if(d < bd){ bd = d; best = x; } });
  RP.playing = false; RP.pre = null; RP.t = best ? shotFire(best) : t; RP.beeped = RP.t > 0;
  syncReplayUI(); render3d();
}
function syncReplayUI(light){
  const bar = $('rpBar'); if(!bar) return;
  bar.classList.toggle('hidden', !RP.on);
  if(!RP.on) return;
  drawReplayTimeline();
  const sl = $('rpSlider'); sl.max = RP.total.toFixed(2); sl.value = RP.t.toFixed(2);
  $('rpTime').textContent = fmt(Math.min(RP.t, RP.res.total)) + ' ／ ' + fmt(RP.res.total) + ' 秒';
  if(light) return;
  $('rpPlay').textContent = RP.playing ? '暫停' : '播放';
  $('rpRandom').checked = RP.random; $('rpSound').checked = RP.sound;
  const cs = $('rpCmp'); cs.innerHTML = ''; cs.appendChild(el('option', {value:'', text:'不比較其他路線'}));
  plans().filter(p => p.id !== RP.plan.id).forEach(p => cs.appendChild(el('option', {value:p.id, text:'同時比較：計畫 ' + p.name})));
  cs.value = RP.cmp ? RP.cmp.plan.id : '';
}

function bindReplay(){
  $('rpPlay').addEventListener('click', () => RP.playing ? pauseReplay() : playReplay());
  $('rpTL').addEventListener('click', replayTimelineClick);
  $('rpSlider').addEventListener('input', e => { RP.t = +e.target.value; RP.beeped = RP.t > 0; RP.pre = null; syncReplayUI(true); render3d(); });
  $('rpSpeed').addEventListener('change', e => { RP.speed = +e.target.value; });
  $('rpSound').addEventListener('change', e => { RP.sound = e.target.checked; if(RP.sound) audio(); });
  $('rpRandom').addEventListener('change', e => { RP.random = e.target.checked; const t = RP.t; startReplay({seed:Math.floor(Math.random()*1e6)}); RP.t = t; syncReplayUI(); render3d(); });
  $('rpRhythm').addEventListener('click', rhythmDrill);
  $('rpExit').addEventListener('click', exitReplay);
  $('rpCmp').addEventListener('change', e => { RP.cmpId = e.target.value || null; const t = RP.t; startReplay(); RP.t = Math.min(t, RP.total); syncReplayUI(); render3d(); });
}
