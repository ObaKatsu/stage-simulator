'use strict';
/*! Stage 模擬器 — IPSC Action Air stage 規劃、回放與檢討
 *  Copyright (C) 2026 James
 *  SPDX-License-Identifier: GPL-3.0-or-later
 *  本程式為自由軟體：你可以依自由軟體基金會發布的 GNU 通用公共授權條款第 3 版，
 *  或（由你選擇）任何更新的版本，重新散布或修改本程式。本程式不提供任何保證，
 *  亦不保證適售性或特定目的適用性。完整條款見 LICENSE 或 <https://www.gnu.org/licenses/>。
 */
/* ---------- phase 2: visibility ---------- */
const OCT = [[10,0],[20,0],[30,12.5],[30,25],[20,37.5],[10,37.5],[0,25],[0,12.5]];          // App. B2 outline (cm from top-left)
const AZONE = [[13,1.5],[17,1.5],[18.5,6],[18.5,18],[17,22],[13,22],[11.5,18],[11.5,6]];      // approximate A zone
let visVersion = 0;
const LS_PROFILE = 'stageSim.profile';
const POSTURE_ORDER = ['stand','crouch','half','kneel','prone'];
const POSTURE_NAME = {stand:'站姿', crouch:'微蹲', half:'半蹲', kneel:'跪姿', prone:'趴地', sit:'坐姿', custom:'自訂'};
const STANCE_OPTS = () => POSTURE_ORDER.map(k => [k, POSTURE_NAME[k]]).concat([['sit','坐姿（坐在椅子、船上或跨坐）']]);
function defaultProfile(){
  return {schemaVersion:SCHEMA, type:'profile', name:'', lean:0.25, postures:{
    stand:{eye:1.68, t:0, est:false}, crouch:{eye:1.55, t:0.2, est:true}, half:{eye:1.30, t:0.5, est:true},
    kneel:{eye:1.05, t:1.0, est:true}, prone:{eye:0.30, t:2.5, est:true}}};
}
let PROFILE = defaultProfile();
/* BB flight: 6 mm sphere, quadratic air drag, hop-up assumed set for a flat path over 3-10 m.
   v(x) = v0·e^(−kx), t(x) = (e^(kx) − 1)/(k·v0), k = ½ρCdA/m */
const BB_AIR = {rho:1.2, cd:0.47, d:0.006};
const BB_DEF = {mass:0.28, v0:90};
function bbPar(){ return Object.assign({}, BB_DEF, PROFILE.bb || {}); }
function bbK(){ const b = bbPar(); return 0.5 * BB_AIR.rho * BB_AIR.cd * Math.PI * (BB_AIR.d / 2) ** 2 / (b.mass / 1000); }
function bbFlight(dist){ if(!(dist > 0)) return 0; const b = bbPar(), k = bbK(); return (Math.exp(k * dist) - 1) / (k * b.v0); }
function bbSpeedAt(dist){ return bbPar().v0 * Math.exp(-bbK() * Math.max(0, dist)); }
function bbDistAt(tau){ const b = bbPar(), k = bbK(); return tau > 0 ? Math.log(1 + k * b.v0 * tau) / k : 0; }   // distance covered after tau seconds
function bbEnergy(){ const b = bbPar(); return 0.5 * b.mass / 1000 * b.v0 * b.v0; }
const LS_SHOOTERS = 'stageSim.shooters';
let SHOOTERS = null;   // {activeId, list:[{id, name, profile}]}
function defaultBody(){
  return {height:1.76, hand:'right', init:0.08, settle:0.12, armSpeed:400, hipSpeed:250, armZone:30, stepAngle:90, stepTime:0.15,
          leftMult:1.0, rightMult:1.0, lateral3m:null, fitted:false, drills:{}};
}
function mergeProfile(o){
  const p = Object.assign(defaultProfile(), o || {});
  p.postures = Object.assign(defaultProfile().postures, (o && o.postures) || {});
  p.body = Object.assign(defaultBody(), (o && o.body) || {});
  return p;
}
function stripAliases(p){ const o = Object.assign({}, p); delete o.time; delete o.hit; delete o.measured; return o; }
function loadProfile(){
  try{
    const raw = localStorage.getItem(LS_SHOOTERS);
    if(raw) SHOOTERS = JSON.parse(raw);
  }catch(e){}
  let had = !!(SHOOTERS && SHOOTERS.list && SHOOTERS.list.length);
  if(!had){
    let old = null; try{ const r = localStorage.getItem(LS_PROFILE); if(r) old = JSON.parse(r); }catch(e){}
    const id = uid();
    SHOOTERS = {activeId:id, list:[{id, name:(old && old.name) || '我', profile:old || defaultProfile()}]};
    had = !!old;
  }
  const act = SHOOTERS.list.find(x => x.id === SHOOTERS.activeId) || SHOOTERS.list[0];
  SHOOTERS.activeId = act.id;
  PROFILE = mergeProfile(act.profile);
  if(typeof ensureProfileParams === 'function') ensureProfileParams();
  saveProfile();
  return had;
}
function saveProfile(){
  try{
    if(!SHOOTERS) return;
    const act = SHOOTERS.list.find(x => x.id === SHOOTERS.activeId); if(!act) return;
    const np = stripAliases(PROFILE), was = JSON.stringify(act.profile);
    act.profile = np; if(JSON.stringify(np) !== was) act.updated = new Date().toISOString().slice(0, 10);
    localStorage.setItem(LS_SHOOTERS, JSON.stringify(SHOOTERS));
  }catch(e){}
}
function switchShooter(id){
  saveProfile();
  const s2 = SHOOTERS.list.find(x => x.id === id); if(!s2) return;
  SHOOTERS.activeId = id; PROFILE = mergeProfile(s2.profile); ensureProfileParams(); saveProfile();
  renderShooterBox(); renderPostureBox(); renderParamBox(); objectsChanged(false);
}
function applyHeight(h){
  // eye heights scale with body height unless the user measured them
  const b = PROFILE.body, ratio = h / 1.76, dflt = defaultProfile().postures;
  b.height = h;
  PROFILE.postures.stand.eye = Math.max(0.5, h - 0.08);
  ['crouch','half','kneel','prone'].forEach(k => { if(!PROFILE.postures[k].eyeMeasured) PROFILE.postures[k].eye = +(dflt[k].eye * ratio).toFixed(3); });
}
// transition between two targets: start-up + rotation (arms, then hips, then a foot step) + settling on the new target
function transTime(angle, dirSign, stance, extraSettle){
  const b = PROFILE.body, a = Math.abs(angle);
  const hipMult = stance === 'kneel' ? 1.3 : stance === 'half' ? 1.15 : stance === 'prone' ? 2.0 : 1.0;
  let rot = Math.min(a, b.armZone) / b.armSpeed;
  if(a > b.armZone) rot += (Math.min(a, b.stepAngle) - b.armZone) / b.hipSpeed * hipMult;
  if(a > b.stepAngle) rot += (b.stepTime * (stance === 'prone' ? 4 : stance === 'kneel' ? 2 : 1)) + (a - b.stepAngle) / b.hipSpeed * hipMult;
  rot *= dirSign > 0 ? b.rightMult : b.leftMult;
  return b.init + rot + b.settle + (extraSettle || 0);
}
function fitTransitions(){
  const b = PROFILE.body, d = b.drills || {}, c = b.init + b.settle;
  const side = s2 => { const v = k => +d[s2 + k] || null; return {t15:v(15), t45:v(45), t90:v(90), t135:v(135)}; };
  const L = side('L'), R = side('R');
  const avg = k => { const xs = [L[k], R[k]].filter(x => x > 0); return xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : null; };
  const t15 = avg('t15'), t45 = avg('t45'), t90 = avg('t90'), t135 = avg('t135');
  if(!t15 || !t45){ alert('至少需要 15 度與 45 度的實測值（左右任一側）。'); return; }
  const arm = Math.max(60, Math.min(2000, 15 / Math.max(0.005, t15 - c)));
  const hips = [];
  hips.push(15 / Math.max(0.005, t45 - c - 30 / arm));
  if(t90) hips.push(60 / Math.max(0.005, t90 - c - 30 / arm));
  const hip = Math.max(40, Math.min(1500, hips.reduce((a, x) => a + x, 0) / hips.length));
  b.armSpeed = Math.round(arm); b.hipSpeed = Math.round(hip); b.armZone = 30; b.stepAngle = 90;
  if(t135) b.stepTime = Math.max(0, +(t135 - c - 30 / arm - 105 / hip).toFixed(3));
  const sideMean = S => { const xs = ['t15','t45','t90','t135'].map(k => S[k]).filter(x => x > 0); return xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : null; };
  const lm = sideMean(L), rm = sideMean(R);
  if(lm && rm){ const m = (lm + rm) / 2; b.leftMult = +(lm / m).toFixed(3); b.rightMult = +(rm / m).toFixed(3); }
  b.fitted = true; saveProfile(); renderShooterBox(); planChanged(false);
}
function renderShooterBox(){
  const box = $('shooterBox'); if(!box || !SHOOTERS) return; box.innerHTML = ''; updateQuickShooter();
  const sel = el('select', {'aria-label':'射手'}); SHOOTERS.list.forEach(x => sel.appendChild(el('option', {value:x.id, text:(SHOOTERS.bench && SHOOTERS.bench.baseId === x.id ? '★ ' : '') + x.name + (SHOOTERS.bench && SHOOTERS.bench.baseId === x.id ? '（標竿）' : '')})));
  sel.value = SHOOTERS.activeId; sel.addEventListener('change', () => switchShooter(sel.value));
  box.appendChild(el('div', null, el('label', {class:'f', text:'射手（每位射手各自保存身體資料與所有參數）'}), sel));
  const curS = SHOOTERS.list.find(x => x.id === SHOOTERS.activeId);
  box.appendChild(el('div', {class:'help', text:'參數最後更新：' + (curS && curS.updated ? curS.updated : '未記錄') + '。標竿射手在「規劃」模式結果面板的「敏感度與標竿」分頁指定；★ 為目前的標竿。'}));
  box.appendChild(el('div', {class:'btns'},
    el('button', {text:'新增射手', onclick:() => { const n = prompt('射手名稱'); if(!n) return; saveProfile(); const id = uid(); SHOOTERS.list.push({id, name:n.trim(), profile:defaultProfile()}); switchShooter(id); }}),
    el('button', {text:'複製', onclick:() => { const n = prompt('複製後的名稱', SHOOTERS.list.find(x => x.id === SHOOTERS.activeId).name + '（複製）'); if(!n) return; saveProfile(); const id = uid(); SHOOTERS.list.push({id, name:n.trim(), profile:clone(stripAliases(PROFILE))}); switchShooter(id); }}),
    el('button', {text:'改名', onclick:() => { const cur = SHOOTERS.list.find(x => x.id === SHOOTERS.activeId); const n = prompt('新名稱', cur.name); if(!n) return; cur.name = n.trim(); PROFILE.name = cur.name; saveProfile(); renderShooterBox(); }}),
    el('button', {class:'danger', text:'刪除', onclick:() => { if(SHOOTERS.list.length <= 1){ alert('至少保留一位射手。'); return; } const cur = SHOOTERS.list.find(x => x.id === SHOOTERS.activeId); if(!confirm('刪除射手「' + cur.name + '」與其所有參數？')) return; SHOOTERS.list = SHOOTERS.list.filter(x => x !== cur); if(SHOOTERS.bench){ if(SHOOTERS.bench.baseId === cur.id) SHOOTERS.bench.baseId = null; Object.keys(SHOOTERS.bench.from || {}).forEach(k => { if(SHOOTERS.bench.from[k] === cur.id) delete SHOOTERS.bench.from[k]; }); } SHOOTERS.activeId = SHOOTERS.list[0].id; PROFILE = mergeProfile(SHOOTERS.list[0].profile); ensureProfileParams(); localStorage.setItem(LS_SHOOTERS, JSON.stringify(SHOOTERS)); renderShooterBox(); renderPostureBox(); renderParamBox(); objectsChanged(false); }})));
  const b = PROFILE.body, upd = () => { saveProfile(); planChanged(false); renderShooterBox(); };
  box.appendChild(el('div', {class:'kind', text:'身體資料'}));
  box.appendChild(row(
    numField('身高（公分）', b.height, 100, v => { if(v > 1){ applyHeight(v); saveProfile(); renderPostureBox(); objectsChanged(false); renderShooterBox(); } }, '1'),
    selField('慣用手', [['right','右手'],['left','左手']], b.hand, v => { b.hand = v; upd(); })));
  box.appendChild(el('p', {class:'help', text:'輸入身高會自動設定站姿眼高（身高減 8 公分），並依比例調整其他姿態的估計眼高；已實測修改的眼高不受影響。'}));
  box.appendChild(numField('橫向移動 3 公尺所需時間（秒，含起步；空白表示與前後移動相同）', b.lateral3m, 1, v => { b.lateral3m = v > 0 ? v : null; upd(); }, '0.01'));
  box.appendChild(el('div', {class:'kind', text:'換靶轉動（' + (b.fitted ? '已依實測擬合' : '估計值') + '）'}));
  box.appendChild(row(numField('手臂擺動（度／秒）', b.armSpeed, 1, v => { if(v > 0){ b.armSpeed = v; upd(); } }, '10'), numField('轉髖（度／秒）', b.hipSpeed, 1, v => { if(v > 0){ b.hipSpeed = v; upd(); } }, '10')));
  box.appendChild(row(numField('只用手臂的角度（度）', b.armZone, 1, v => { if(v > 0){ b.armZone = v; upd(); } }, '1'), numField('需移動腳步的角度（度）', b.stepAngle, 1, v => { if(v > 0){ b.stepAngle = v; upd(); } }, '1'), numField('移腳另加（秒）', b.stepTime, 1, v => { if(v >= 0){ b.stepTime = v; upd(); } }, '0.01')));
  box.appendChild(row(numField('啟動（秒）', b.init, 1, v => { if(v >= 0){ b.init = v; upd(); } }, '0.01'), numField('停穩（秒）', b.settle, 1, v => { if(v >= 0){ b.settle = v; upd(); } }, '0.01'), numField('往左倍數', b.leftMult, 1, v => { if(v > 0){ b.leftMult = v; upd(); } }, '0.01'), numField('往右倍數', b.rightMult, 1, v => { if(v > 0){ b.rightMult = v; upd(); } }, '0.01')));
  const sample = [15, 45, 90, 135].map(a => a + '°：' + fmt(transTime(a, 1, 'stand', 0)) + ' 秒').join('，');
  box.appendChild(el('div', {class:'readout', text:'目前站姿往右換靶（5 公尺內全露）：' + sample}));
  box.appendChild(el('div', {class:'kind', text:'實測校正：兩靶換靶練習'}));
  box.appendChild(el('p', {class:'help', text:'兩張全露紙靶放在 5 公尺內同距離，站姿，依夾角擺放；每個角度各做約 5 次，記下「打完第一張最後一槍到第二張第一槍」的計時器 split，填入平均值。左、右指的是從第一張轉向第二張的方向。'}));
  b.drills = b.drills || {};
  [15, 45, 90, 135].forEach(a => box.appendChild(row(el('div', {class:'readout', text:a + ' 度'}),
    numField('往左（秒）', b.drills['L' + a], 1, v => { b.drills['L' + a] = v; saveProfile(); }, '0.01'),
    numField('往右（秒）', b.drills['R' + a], 1, v => { b.drills['R' + a] = v; saveProfile(); }, '0.01'))));
  box.appendChild(el('div', {class:'btns'}, el('button', {class:'primary', text:'依實測擬合轉動參數', onclick:fitTransitions})));
}
function postureEye(k){ const p = PROFILE.postures[k]; return p ? p.eye : PROFILE.postures.stand.eye; }
// eye height above the ground: the posture's eye height plus what the shooter stands on, or the seat plus the seated eye height
function sitEye(){ return (PROFILE.time && PROFILE.time.sitEye) || 0.78; }
function eyeOf(v){
  if(v.stance === 'custom' && v.eyeH) return v.eyeH;
  if(v.stance === 'sit'){ const s = typeof seatAt === 'function' ? seatAt(v.x, v.y) : null; return (s ? s.h : 0.45) + sitEye(); }
  return postureEye(v.stance || 'stand') + (typeof surfaceAt === 'function' ? surfaceAt(v.x, v.y) : 0);
}
function renderPostureBox(){
  const box = $('postureBox'); if(!box) return; box.innerHTML = '';
  POSTURE_ORDER.forEach(k => {
    const p = PROFILE.postures[k];
    box.appendChild(row(
      el('div', {class:'readout', text:POSTURE_NAME[k]}),
      numField('眼高（公分）', p.eye, 100, v => { if(v > 0){ p.eye = v; p.eyeMeasured = true; saveProfile(); objectsChanged(false); } }, '1'),
      numField(k === 'stand' ? '轉換時間（秒）' : '由站姿轉換（秒）' + (p.est ? '・估計' : ''), p.t, 1, v => { if(v != null && v >= 0){ p.t = v; p.est = false; saveProfile(); objectsChanged(false); } }, '0.1')));
  });
  box.appendChild(numField('左右探身距離（公分）', PROFILE.lean, 100, v => { if(v != null && v >= 0){ PROFILE.lean = v; saveProfile(); objectsChanged(false); } }, '1'));
  const b = bbPar(), setB = (k, v) => { PROFILE.bb = Object.assign({}, bbPar(), {[k]:v}); saveProfile(); objectsChanged(false); renderPostureBox(); };
  box.appendChild(el('div', {class:'kind', text:'BB 彈'}));
  box.appendChild(row(numField('彈重（公克）', b.mass, 1, v => { if(v > 0.05 && v < 1) setB('mass', v); }, '0.01'),
                      numField('初速（公尺／秒）', b.v0, 1, v => { if(v > 20 && v < 200) setB('v0', v); }, '1')));
  box.appendChild(el('div', {class:'readout', text:'槍口動能 ' + fmt(bbEnergy(), 2) + ' 焦耳。飛行時間：' + [3, 5, 7, 10].map(d => d + ' 公尺 ' + fmt(bbFlight(d), 3) + ' 秒').join('、') + '；10 公尺處剩 ' + fmt(bbSpeedAt(10), 0) + ' 公尺／秒。'}));
  box.appendChild(el('p', {class:'help', text:'以 6 毫米球體、空氣阻力係數 0.47 計算，hop-up 視為已調平（3 到 10 公尺內彈道近似水平）。用於：stop plate 命中才停錶的時間、鋼靶倒下與機關啟動的時間、移動靶的提前量，以及 3D 回放的 BB 飛行。初速請以測速器實測。'}));
  box.appendChild(el('p', {class:'help', text:'轉換時間為由站姿換到該姿態所需的時間，標示「估計」者為暫定值，請依實測修改；階段 3 的時間模型會使用這些數值。'}));
}
function standTopOf(o){
  if(o.type === 'noshoot'){ const t = o.cover ? getObj(o.cover) : null; if(t && t.standTop != null) return t.standTop; }
  return o.standTop != null ? o.standTop : null;
}
// rotate point P about the axis through piv along unit vector k by angle a (Rodrigues)
function rotAxis(P, piv, k, a){
  const v = [P[0] - piv[0], P[1] - piv[1], P[2] - piv[2]], c = Math.cos(a), s = Math.sin(a), d = k[0]*v[0] + k[1]*v[1] + k[2]*v[2];
  const x = [k[1]*v[2] - k[2]*v[1], k[2]*v[0] - k[0]*v[2], k[0]*v[1] - k[1]*v[0]];
  return [piv[0] + v[0]*c + x[0]*s + k[0]*d*(1 - c), piv[1] + v[1]*c + x[1]*s + k[1]*d*(1 - c), piv[2] + v[2]*c + x[2]*s + k[2]*d*(1 - c)];
}
function paperGeom(o){
  const spec = targetSpec(o.size), sx = spec.w / 0.30, sy = spec.h / 0.375;
  const st = standTopOf(o), est = st == null;
  const top = (st == null ? 1.0 : st) + spec.shoulder;
  const f = facing(o.rot), p = [-f[1], f[0]];
  const W = 30 * sx;
  const toW0 = (u, v) => { const lat = (u - W/2) / 100; return [o.x + p[0]*lat, o.y + p[1]*lat, top - v/100]; };
  const S = o.swing;   // replay pose of a swinger: rotation about the pivot axle
  const toW = S ? (u, v) => rotAxis(toW0(u, v), S.piv, S.k, S.a) : toW0;
  const oct = OCT.map(([u, v]) => [u*sx, v*sy]), az = AZONE.map(([u, v]) => [u*sx, v*sy]);
  return {f, p, top, bottom:top - spec.h, est, W, H:37.5*sy, oct, az, toW};
}
function occluders(){
  const out = []; out.windows = [];
  const addRect = (a, b, z0, z1, o, see, soft) => out.push({a, b, z0, z1, see, soft, label:o.label});
  stage.objects.forEach(o => {
    if(o.type === 'wall'){
      const H = o.h == null ? 1.8 : o.h, zTop = H >= 1.8 ? 1e3 : H;
      const L = Math.hypot(o.x2 - o.x1, o.y2 - o.y1); if(L < 1e-6) return;
      const ux = (o.x2 - o.x1) / L, uy = (o.y2 - o.y1) / L, P = s => [o.x1 + ux*s, o.y1 + uy*s];
      let cur = 0;
      (o.ports || []).slice().sort((a, b) => a.off - b.off).forEach(pt => {
        const s0 = Math.max(0, pt.off), s1 = Math.min(L, pt.off + pt.w);
        if(s0 > cur) addRect(P(cur), P(s0), 0, zTop, o, !!o.seeThrough, !!o.soft);
        if(s1 > s0){
          if(pt.bottom > 0) addRect(P(s0), P(s1), 0, pt.bottom, o, !!o.seeThrough, !!o.soft);
          addRect(P(s0), P(s1), pt.bottom + pt.h, zTop, o, !!o.seeThrough, !!o.soft);
          out.windows.push({a:P(s0), b:P(s1), z0:pt.bottom, z1:pt.bottom + pt.h, needOpen:!!pt.needOpen, holdOpen:!!pt.holdOpen, label:o.label});
        }
        cur = Math.max(cur, s1);
      });
      if(cur < L) addRect(P(cur), P(L), 0, zTop, o, !!o.seeThrough, !!o.soft);
    }else if(o.type === 'platform' || (o.type === 'bridge' && o.x1 != null)){
      const c = perchFootprint(o), h = o.h || 0.4; for(let i = 0; i < 4; i++) addRect(c[i], c[(i+1)%4], 0, h, o, false, false);
    }else if(o.type === 'boat'){
      const c = boatHull(o), h = (o.h || 0.2) + (o.rim || 0.6); for(let i = 0; i < c.length; i++) addRect(c[i], c[(i+1)%c.length], 0, h, o, false, false);
    }else if(o.type === 'tunnel' && o.x1 != null && o.sides && o.sides !== 'open'){
      const g = tunnelGeom(o);
      addRect(g.P(0, -g.w/2), g.P(g.L, -g.w/2), 0, g.h, o, o.sides === 'mesh', false);
      addRect(g.P(0, g.w/2), g.P(g.L, g.w/2), 0, g.h, o, o.sides === 'mesh', false);
    }else if(o.type === 'barrel' || o.type === 'table' || o.type === 'prop'){
      const w = o.type === 'barrel' ? (o.d || 0.6) : (o.w || 0.5), dp = o.type === 'barrel' ? (o.d || 0.6) : (o.dp || 0.5);
      const c = rectPts(o.x, o.y, w, dp, o.rot || 0), h = o.h || 0.9;
      for(let i = 0; i < 4; i++) addRect(c[i], c[(i+1)%4], 0, h, o, false, false);
    }else if(o.type === 'door'){
      const f = facing(o.rot), p = [-f[1], f[0]], w = o.w || 0.8;
      addRect([o.x - p[0]*w/2, o.y - p[1]*w/2], [o.x + p[0]*w/2, o.y + p[1]*w/2], 0, o.h || 1.8, o, false, false);
    }
  });
  return out;
}
function rayBlock(E, S, occ, mode){
  const rx = S[0] - E[0], ry = S[1] - E[1];
  for(const r of occ){
    if(mode === 'shoot' && r.soft) continue;
    if(mode === 'see' && r.see) continue;
    const qx = r.b[0] - r.a[0], qy = r.b[1] - r.a[1];
    const den = rx*qy - ry*qx; if(Math.abs(den) < 1e-12) continue;
    const wx = r.a[0] - E[0], wy = r.a[1] - E[1];
    const t = (wx*qy - wy*qx) / den, u = (wx*ry - wy*rx) / den;
    if(t <= 1e-4 || t >= 1 - 1e-4 || u < 0 || u > 1) continue;
    const z = E[2] + t*(S[2] - E[2]);
    if(z >= r.z0 && z <= r.z1) return r.label;
  }
  return null;
}
function inPolyUV(u, v, poly){ return pointInPoly(u, v, poly); }
function rayWindow(E, S, wins){
  const rx = S[0] - E[0], ry = S[1] - E[1];
  for(const r of wins){
    const qx = r.b[0] - r.a[0], qy = r.b[1] - r.a[1], den = rx*qy - ry*qx; if(Math.abs(den) < 1e-12) continue;
    const wx = r.a[0] - E[0], wy = r.a[1] - E[1], t = (wx*qy - wy*qx) / den, u = (wx*ry - wy*rx) / den;
    if(t <= 1e-4 || t >= 1 - 1e-4 || u < 0 || u > 1) continue;
    const z = E[2] + t*(S[2] - E[2]);
    if(z >= r.z0 && z <= r.z1) return r;
  }
  return null;
}
function downDir(){ const a = rad(stage.safety.downDeg || 0); return [Math.sin(a), Math.cos(a)]; }
function evalSamples(E, samples, occ){
  let shoot = 0, seen = 0, aTot = 0, aShoot = 0, nsCov = 0; const blockers = {}, viaWin = {};
  samples.forEach(s => {
    if(s.a) aTot++;
    const bs = rayBlock(E, s.w, occ, 'shoot'), bv = rayBlock(E, s.w, occ, 'see');
    if(!bv) seen++;
    if(bs){ blockers[bs] = (blockers[bs] || 0) + 1; return; }
    if(s.ns){ nsCov++; return; }
    shoot++; if(s.a) aShoot++;
    const wn = rayWindow(E, s.w, occ.windows); if(wn) viaWin[wn.label] = wn;
  });
  const N = samples.length || 1;
  return {exp:shoot / N, aExp:aTot ? aShoot / aTot : 0, seen:seen / N, nsCov:nsCov / N, blockers, viaWin};
}
function postures(vp){
  const d = downDir(), right = [d[1], -d[0]], L = PROFILE.lean;
  const base = vp.stance === 'custom' ? null : vp.stance || 'stand';
  const t0 = base && PROFILE.postures[base] ? PROFILE.postures[base].t : 0;
  const lift = typeof surfaceAt === 'function' ? surfaceAt(vp.x, vp.y) : 0;
  const mk = (k, eye, lat, tag) => ({E:[vp.x + right[0]*lat, vp.y + right[1]*lat, eye], key:k, lat, dt:k && PROFILE.postures[k] ? Math.max(0, PROFILE.postures[k].t - t0) : 0, tag});
  const list = [mk(base, eyeOf(vp), 0, '')];
  if(!stage.flex) return list;
  list.push(mk(base, eyeOf(vp), -L, '向左探身'), mk(base, eyeOf(vp), L, '向右探身'));
  if(base === 'sit') return list;   // seated: lean only
  const from = base ? POSTURE_ORDER.indexOf(base) + 1 : 0;
  POSTURE_ORDER.slice(from).forEach(k => {
    const eye = postureEye(k) + (vp.stance === 'custom' ? 0 : lift);
    if(vp.stance === 'custom' && eye >= eyeOf(vp)) return;
    list.push(mk(k, eye, 0, ''));
    if(k !== 'prone') list.push(mk(k, eye, -L, '向左探身'), mk(k, eye, L, '向右探身'));
  });
  return list;
}
/* manual 'cannot see from here' marks (target.hideFrom = [viewpoint ids]) for blockers the drawing does not show */
const HIDE_NEAR = 0.6;   // plan stops and candidate spots within this distance of a marked viewpoint inherit its marks
function nearestViewpoint(x, y, maxD){
  let best = null, bd = maxD;
  stage.objects.forEach(v => { if(v.type !== 'viewpoint') return; const d = Math.hypot(v.x - x, v.y - y); if(d <= bd){ bd = d; best = v; } });
  return best;
}
function hiddenByUser(o, vp){
  const list = o.hideFrom; if(!Array.isArray(list) || !list.length) return null;
  if(vp.type === 'viewpoint' && !String(vp.id).startsWith('__')) return list.includes(vp.id) ? vp : null;
  const v = nearestViewpoint(vp.x, vp.y, HIDE_NEAR);
  return v && list.includes(v.id) ? v : null;
}
function setHidden(o, vpId, on){
  const list = (Array.isArray(o.hideFrom) ? o.hideFrom : []).filter(id => id !== vpId && getObj(id));
  if(on) list.push(vpId);
  if(list.length) o.hideFrom = list; else delete o.hideFrom;
}
let visCacheKey = '', visCache = null;
function computeVis(vp, opts){
  opts = opts || {};
  const key = vp.id + '|' + [vp.x, vp.y, vp.rot, vp.stance, vp.eyeH].join(',') + '|' + JSON.stringify(stage.objects) + JSON.stringify(PROFILE) + JSON.stringify(stage.safety) + stage.plateCy + stage.flex;
  if(!opts.coarse && key === visCacheKey && visCache) return visCache;
  const occ = occluders(), E0 = [vp.x, vp.y, eyeOf(vp)], P = postures(vp);
  const d = downDir(), da = Math.atan2(d[1], d[0]), sf = stage.safety;
  const res = [];
  stage.objects.forEach(o => {
    if(!['paper','popper','plate','stopplate'].includes(o.type)) return;
    const dist = Math.hypot(o.x - vp.x, o.y - vp.y);
    const bearing = normDeg(deg(da - Math.atan2(o.y - vp.y, o.x - vp.x)));   // + = right of downrange
    const r = {id:o.id, label:o.label, type:o.type, dist, bearing, notes:[]};
    const unsafe = bearing > sf.right || bearing < -sf.left;
    const unsafeNote = '超出安全射擊角度（靶擋方向左 ' + sf.left + '°／右 ' + sf.right + '°），依規則 2.1.2、10.5.2 會判 DQ';
    const hv = hiddenByUser(o, vp);
    if(hv){
      Object.assign(r, {status:'none', nomStatus:'none', exp:0, aExp:0, seen:0, nsCov:0, manual:true, manualVp:hv.id});
      r.notes.push('已手動設定：現場從 ' + hv.label + (hv.id === vp.id ? '' : ' 附近') + ' 看不到');
      if(unsafe){ r.unsafe = true; r.status = r.nomStatus = 'unsafe'; r.notes.unshift(unsafeNote); }
      res.push(r); return;
    }
    let samples = [];
    if(o.type === 'paper'){
      const g = paperGeom(o);
      if(g.est) r.notes.push('靶架高度未設定，暫以 100 公分計');
      if(g.f[0]*(vp.x - o.x) + g.f[1]*(vp.y - o.y) <= 0){
        r.status = r.nomStatus = unsafe ? 'unsafe' : 'back'; r.exp = 0; r.aExp = 0; r.notes.push('在靶的背面'); if(unsafe) r.notes.unshift(unsafeNote); res.push(r); return;
      }
      const nss = stage.objects.filter(n => n.type === 'noshoot' && (n.cover === o.id || (Math.hypot(n.x - o.x, n.y - o.y) < 0.35 && !n.cover)));
      const nsOff = nss.map(n => [((n.x - o.x)*g.p[0] + (n.y - o.y)*g.p[1]) * 100, -(n.dz || 0) * 100]);
      const sv = opts.coarse ? 6.5 : 3.2, su = opts.coarse ? 6 : 2.8;
      for(let v = 1.5; v < g.H; v += sv) for(let u = 1.5; u < g.W; u += su){
        if(!inPolyUV(u, v, g.oct)) continue;
        samples.push({w:g.toW(u, v), a:inPolyUV(u, v, g.az), ns:nsOff.some(q => inPolyUV(u - q[0], v - q[1], g.oct))});
      }
    }else{
      let zc, radius;
      if(o.type === 'popper'){ const sp = o.mini ? RULE_SPECS.miniPopper : RULE_SPECS.popper; radius = sp.headD / 2; zc = sp.h - radius; }
      else { radius = (o.d || 0.15) / 2; zc = o.cy != null ? o.cy : stage.plateCy; }
      const dx = E0[0] - o.x, dy = E0[1] - o.y, L = Math.hypot(dx, dy) || 1, px = -dy / L, py = dx / L;
      samples.push({w:[o.x, o.y, zc], a:true, ns:false});
      for(let k = 0, nk = opts.coarse ? 4 : 8; k < nk; k++){ const t = k / nk * Math.PI * 2, rr = radius * 0.75; samples.push({w:[o.x + px*rr*Math.cos(t), o.y + py*rr*Math.cos(t), zc + rr*Math.sin(t)], a:true, ns:false}); }
    }
    const nominal = evalSamples(P[0].E, samples, occ);
    let best = nominal, bestP = P[0];
    for(let i = 1; i < P.length; i++){
      if(best.exp >= 0.95) break;
      const e = evalSamples(P[i].E, samples, occ);
      if(e.exp > best.exp + 0.05){ best = e; bestP = P[i]; }
    }
    Object.assign(r, {exp:best.exp, aExp:best.aExp, seen:best.seen, nsCov:best.nsCov, nomExp:nominal.exp});
    r.nomStatus = nominal.exp >= 0.95 ? 'full' : nominal.exp >= 0.05 ? 'part' : 'none';
    r.status = r.exp >= 0.95 ? 'full' : r.exp >= 0.05 ? 'part' : 'none';
    if(bestP !== P[0]){
      const changed = bestP.key !== P[0].key;
      const txt = (changed ? '改為' + POSTURE_NAME[bestP.key] : '') + (bestP.tag ? (changed ? '並' : '') + bestP.tag : '');
      r.posture = txt; r.postureKey = bestP.key; r.postureTime = bestP.dt;
      const est = changed && PROFILE.postures[bestP.key].est ? '，估計值' : '';
      r.notes.push('需' + txt + (changed ? '（姿態轉換約 +' + fmt(bestP.dt, 1) + ' 秒' + est + '）' : '') + '（原姿勢可射擊 ' + Math.round(nominal.exp*100) + '%）');
    }
    const bl = Object.entries(best.blockers).sort((a, b) => b[1] - a[1]).map(x => x[0]);
    if(bl.length) r.blockers = bl;
    if(r.status === 'none' && r.blockers && r.seen > 0.05) r.notes.push('看得到但不能射擊（穿過可看穿的檔牆）');
    Object.values(best.viaWin).forEach(wn => { r.notes.push('透過 ' + wn.label + ' 的窗戶射擊' + (wn.holdOpen ? '，需先開窗並單手維持開窗' : wn.needOpen ? '，需先開窗' : '')); if(wn.holdOpen) r.oneHand = true; if(wn.needOpen) r.needOpen = true; });
    if(isMech(o)) r.notes.push('機關靶，以靜止位置計算' + (o.mech.preVisible ? '' : '；啟動前被遮住'));
    if(unsafe){ r.unsafe = true; r.status = 'unsafe'; r.nomStatus = 'unsafe'; r.notes.unshift(unsafeNote); }
    res.push(r);
  });
  res.sort((a, b) => String(a.label).localeCompare(String(b.label), 'zh-Hant', {numeric:true}));
  if(!opts.coarse){ visCacheKey = key; visCache = res; }
  return res;
}
const ST_TXT = {full:'全露', part:'部分', none:'看不到', back:'背面', unsafe:'DQ 角度'};
function visLine(r){
  const bR = Math.round(r.bearing);
  let d = fmt(r.dist, 1) + ' m，靶擋方向' + (bR > 0 ? '右 ' + bR + '°' : bR < 0 ? '左 ' + (-bR) + '°' : '正前方');
  if(r.status === 'full' || r.status === 'part'){
    d += '，可射擊 ' + Math.round(r.exp * 100) + '%';
    if(r.type === 'paper') d += '（A 區 ' + Math.round(r.aExp * 100) + '%）';
  }
  if(r.nsCov > 0.01) d += '，no-shoot 遮 ' + Math.round(r.nsCov * 100) + '%';
  if(r.blockers && r.status !== 'full' && r.status !== 'unsafe') d += '，被 ' + r.blockers.join('、') + ' 擋住';
  if(r.notes.length) d += '。' + r.notes.join('；');
  return d;
}
function renderVisPanel(){
  const box = $('visBox'); if(!box) return;
  box.innerHTML = '';
  { // selecting a viewpoint on the map while planning shows its visibility section
    const so = selId && getObj(selId);
    if(so && so.type === 'viewpoint' && selId !== renderVisPanel.last && document.body.dataset.mode === 'plan' && !(typeof pendingOrder !== 'undefined' && pendingOrder)){ const sv = $('secVis'); if(sv && !sv.open) sv.open = true; }
    renderVisPanel.last = selId;
  }
  $('downDeg').value = stage.safety.downDeg; $('safeL').value = stage.safety.left; $('safeR').value = stage.safety.right;
  $('plateCy').value = Math.round(stage.plateCy * 100); $('flexChk').checked = !!stage.flex;
  const vps = stage.objects.filter(o => o.type === 'viewpoint');
  $('stVis').textContent = vps.length ? vps.length + ' 個視點' : '';
  const v = getObj(selId);
  if(!v || v.type !== 'viewpoint'){
    box.appendChild(el('p', {class:'help', text:vps.length ? '選取一個視點，就會顯示從那裡的視線分析。' : '尚未放置視點。'}));
    return;
  }
  const res = computeVis(v);
  box.appendChild(el('div', {class:'readout', text:v.label + '：' + POSTURE_NAME[v.stance || 'stand'] + '，眼高 ' + Math.round(eyeOf(v)*100) + ' 公分'}));
  const ul = el('ul', {class:'vislist'});
  res.forEach(r => {
    const ns = r.nomStatus || r.status;
    const o = getObj(r.id);
    const canMark = r.manual || r.status === 'full' || r.status === 'part';
    const tg = canMark ? el('button', {class:'mini' + (r.manual ? ' on' : ''), title:r.manual ? '取消手動設定，改回依圖面計算' : '現場被窗簾、柱子等圖上沒有的東西擋住時，設定這個視點看不到此靶',
      text:r.manual ? '取消「看不到」' : '現場看不到', onclick:() => { setHidden(o, v.id, !r.manual); objectsChanged(false); }}) : null;
    const li = el('li', null, el('span', {class:'tl', text:r.label}), el('span', {class:'st ' + ns, text:r.manual ? '看不到（手動）' : ST_TXT[ns]}),
      (ns !== r.status ? el('span', {class:'st post', text:'調整後' + ST_TXT[r.status]}) : null), tg, el('span', {class:'dt', text:visLine(r)}));
    ul.appendChild(li);
  });
  if(!res.length) ul.appendChild(el('li', {text:'圖上尚無靶。'}));
  box.appendChild(ul);
  const n = res.filter(r => r.nomStatus === 'full' || r.nomStatus === 'part').length, nu = res.filter(r => r.status === 'unsafe').length;
  const na = res.filter(r => (r.status === 'full' || r.status === 'part') && !(r.nomStatus === 'full' || r.nomStatus === 'part')).length;
  box.appendChild(el('div', {class:'msg ok', text:'以目前姿勢可射擊 ' + n + ' 個靶（全露 ' + res.filter(r => r.nomStatus === 'full').length + '，部分 ' + res.filter(r => r.nomStatus === 'part').length + '）' + (na ? '；另有 ' + na + ' 個靶需調整姿態才打得到' : '') + (nu ? '；' + nu + ' 個靶超出安全射擊角度，不可射擊' : '') + '。'}));
  const nm = res.filter(r => r.manual).length;
  box.appendChild(el('p', {class:'help explain', text:'A 區範圍依附錄 B2 圖面近似。1.8 公尺以上的檔牆依規則 2.2.3.1 視為無限高；高度未設定者暫以 1.8 公尺計。' + (stage.flex ? '已考慮探身與降低姿態的調整。' : '') +
    '圖上沒有的遮擋（窗簾、柱子、現場擺放不同）可按「現場看不到」手動排除；設定後，這個視點與 ' + fmt(HIDE_NEAR*100, 0) + ' 公分內的停頓點都視為看不到該靶。' + (nm ? '目前有 ' + nm + ' 個靶為手動設定。' : '')}));
}
function renderVisSummary(){
  const box = $('visSummary'); box.innerHTML = '';
  const vps = stage.objects.filter(o => o.type === 'viewpoint');
  if(!vps.length){ box.appendChild(el('p', {class:'help', text:'請先放置視點。'})); return; }
  const table = {};
  vps.forEach(v => computeVis(v).forEach(r => { (table[r.label] = table[r.label] || []).push({v:v.label, s:r.status, e:r.exp, p:r.posture, m:r.manual}); }));
  const ul = el('ul', {class:'summ'});
  Object.keys(table).sort((a, b) => a.localeCompare(b, 'zh-Hant', {numeric:true})).forEach(t => {
    const ok = table[t].filter(x => x.s === 'full' || x.s === 'part');
    const man = table[t].filter(x => x.m).map(x => x.v);
    const txt = (ok.length ? ok.map(x => x.v + (x.s === 'full' ? ' 全露' : ' 部分 ' + Math.round(x.e*100) + '%') + (x.p ? '（' + x.p + '）' : '')).join('、') : '沒有任何視點可射擊') + (man.length ? '；手動設定看不到：' + man.join('、') : '');
    const li = el('li', null, el('b', {text:t + '：'}), document.createTextNode(txt));
    if(!ok.length) li.style.color = 'var(--tape)';
    ul.appendChild(li);
  });
  box.appendChild(ul);
}
let visShowHidden = false;
function scaleStage(k){
  const S = (x) => x * k;
  stage.objects.forEach(o => {
    const kd = OBJ[o.type].kind;
    if(kd === 'point'){ o.x = S(o.x); o.y = S(o.y); if(o.mech && o.mech.ex != null){ o.mech.ex = S(o.mech.ex); o.mech.ey = S(o.mech.ey); } }
    else if(kd === 'line'){
      o.x1 = S(o.x1); o.y1 = S(o.y1); o.x2 = S(o.x2); o.y2 = S(o.y2);
      (o.ports || []).forEach(p => { p.off = S(p.off); });
    }else o.pts.forEach(p => { p[0] = S(p[0]); p[1] = S(p[1]); });
  });
  if(stage.image){ stage.rect.width = S(stage.rect.width); stage.rect.depth = S(stage.rect.depth); stage.rect.x0 = S(stage.rect.x0); stage.rect.y0 = S(stage.rect.y0); fillInputs(); recompute(false); }
  measurePts = measurePts.map(p => [S(p[0]), S(p[1])]);
  stopSuggest = null;
  objectsChanged(true); updateMeasureOut();
}
function syncDesignUI(){ $('dropDesign').classList.toggle('hidden', !stage.design); }
function drawDesignGhost(ctx, toS){
  if(!stage.design) return;
  ctx.save(); ctx.globalAlpha = 0.55; ctx.setLineDash([4,4]); ctx.strokeStyle = '#7A8590'; ctx.lineWidth = 1.5;
  stage.design.objects.forEach(o => {
    const k = OBJ[o.type] ? OBJ[o.type].kind : 'point';
    if(k === 'line'){ if(pathW(ctx, toS, [[o.x1,o.y1],[o.x2,o.y2]])) ctx.stroke(); }
    else if(k === 'poly'){ if(o.type !== 'area' && pathW(ctx, toS, o.pts, true)) ctx.stroke(); }
    else { const q = toS(o.x, o.y); if(q){ ctx.beginPath(); ctx.arc(q[0], q[1], 6, 0, Math.PI*2); ctx.stroke(); } }
  });
  ctx.restore();
}
function drawSafeFan(ctx, toS, v){
  const q0 = toS(v.x, v.y); if(!q0) return;
  const dd = stage.safety.downDeg || 0, L = 4;
  [[-stage.safety.left, '左'], [stage.safety.right, '右']].forEach(([a, t]) => {
    const ang = rad(dd + a), q = toS(v.x + Math.sin(ang)*L, v.y + Math.cos(ang)*L); if(!q) return;
    ctx.beginPath(); ctx.moveTo(q0[0], q0[1]); ctx.lineTo(q[0], q[1]); ctx.setLineDash([8,5]); ctx.strokeStyle = 'rgba(200,55,45,.7)'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
    label(ctx, '安全角度' + t + ' ' + Math.abs(a) + '°', q[0] + 4, q[1] - 4, '#C8372D');
  });
  const qd = toS(v.x + Math.sin(rad(dd))*1.2, v.y + Math.cos(rad(dd))*1.2);
  if(qd){ ctx.beginPath(); ctx.moveTo(q0[0], q0[1]); ctx.lineTo(qd[0], qd[1]); ctx.strokeStyle = 'rgba(200,55,45,.5)'; ctx.lineWidth = 1; ctx.stroke(); }
}
function drawVisOverlay(ctx, toS){
  const v = getObj(selId); if(!v || v.type !== 'viewpoint') return;
  const res = computeVis(v), q0 = toS(v.x, v.y); if(!q0) return;
  const col = {full:'rgba(47,125,79,.85)', part:'rgba(168,100,27,.85)', none:'rgba(138,148,160,.5)', back:'rgba(138,148,160,.35)', unsafe:'rgba(200,55,45,.75)'};
  drawSafeFan(ctx, toS, v);
  res.forEach(r => {
    const o = getObj(r.id), q = toS(o.x, o.y); if(!q) return;
    const ns = r.nomStatus || r.status, needPost = ns !== r.status && (r.status === 'full' || r.status === 'part');
    if((ns === 'none' || ns === 'back') && !needPost && !visShowHidden) return;   // hidden targets: no line unless asked
    ctx.beginPath(); ctx.moveTo(q0[0], q0[1]); ctx.lineTo(q[0], q[1]);
    ctx.strokeStyle = needPost ? 'rgba(107,63,160,.8)' : col[ns]; ctx.lineWidth = ns === 'full' ? 2.5 : 1.6;
    if(needPost || ns === 'none' || ns === 'back' || ns === 'unsafe') ctx.setLineDash(needPost ? [2,3] : [3,4]);
    ctx.stroke(); ctx.setLineDash([]);
    if(ns === 'full' || ns === 'part') label(ctx, Math.round(r.nomExp * 100) + '%', q[0] - 14, q[1] + 22, ns === 'full' ? '#2F7D4F' : '#A8641B');
    else if(needPost) label(ctx, r.posture, q[0] - 14, q[1] + 22, '#6B3FA0');
  });
}

/* ---------- phase 2: 3D view ---------- */
const v3d = {mode:'orbit', yaw:-Math.PI/2 - 0.5, pitch:0.75, dist:18, tx:5, ty:6, fov:60, eyeYaw:0, eyePitch:-0.05, eyeFov:70, w:0, h:0};
const v3dCanvas = $('v3dCanvas'), v3dCtx = v3dCanvas.getContext('2d');
let leftTab = 'img';
function resize3d(){
  const r = v3dCanvas.parentElement.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  v3d.w = r.width; v3d.h = r.height; v3dCanvas.width = Math.max(1, Math.round(r.width*dpr)); v3dCanvas.height = Math.max(1, Math.round(r.height*dpr));
  if(typeof gl3dResize === 'function') gl3dResize(r.width, r.height, dpr);
  if(orbitAuto && v3d.mode === 'orbit' && r.width > 0) resetOrbit(true);
  render3d();
}
new ResizeObserver(() => { if(APP_READY) resize3d(); }).observe(v3dCanvas.parentElement);
function setLeftTab(t){
  setTimeout(() => { if(typeof syncMobileNav === 'function') syncMobileNav(); }, 0);
  leftTab = t;
  $('tabImg').classList.toggle('on', t === 'img'); $('tab3d').classList.toggle('on', t === '3d');
  $('imgWrap').classList.toggle('hidden', t !== 'img'); $('v3dWrap').classList.toggle('hidden', t !== '3d');
  $('fitImg').classList.toggle('hidden', t !== 'img'); $('v3dBar').classList.toggle('hidden', t !== '3d');
  const touch = window.matchMedia && matchMedia('(pointer:coarse)').matches;
  $('leftHint').textContent = t === '3d' ? (v3d.mode === 'orbit' ? (touch ? '單指拖曳旋轉　雙指縮放與平移' : '拖曳旋轉　滾輪縮放　Shift＋拖曳或右鍵拖曳平移') : (touch ? '單指拖曳轉動視線　雙指調整視角寬度' : '拖曳轉動視線　滾輪調整視角寬度')) : (touch ? '雙指縮放　拖曳空白處平移' : '滾輪縮放　拖曳空白處平移');
  if(typeof flashHint === 'function') flashHint();
  if(t === '3d'){ refresh3dModes(); if(!orbitInit){ const r = v3dCanvas.parentElement.getBoundingClientRect(); if(r.width > 0){ v3d.w = r.width; v3d.h = r.height; } } resetOrbit(false); render3d(); }
}
function refresh3dModes(){
  const sel = $('v3dMode'), cur = v3d.mode;
  sel.innerHTML = '';
  sel.appendChild(el('option', {value:'orbit', text:'環繞視角'}));
  if(RP.on){ sel.appendChild(el('option', {value:'follow', text:'跟隨射手'})); sel.appendChild(el('option', {value:'fpv', text:'射手第一人稱'})); }
  stage.objects.filter(o => o.type === 'viewpoint').forEach(o => sel.appendChild(el('option', {value:o.id, text:'射手視角：' + o.label})));
  sel.value = [...sel.options].some(x => x.value === cur) ? cur : 'orbit';
  v3d.mode = sel.value;
}
let orbitInit = false, orbitAuto = false;   // orbitAuto: view not moved by the user yet, so refit when the pane size changes
function objBounds(){
  let b = null;
  stage.objects.forEach(o => objPts(o).forEach(p => { if(!isFinite(p[0]) || !isFinite(p[1])) return;
    if(!b) b = {xmin:p[0], xmax:p[0], ymin:p[1], ymax:p[1]}; else { b.xmin = Math.min(b.xmin, p[0]); b.xmax = Math.max(b.xmax, p[0]); b.ymin = Math.min(b.ymin, p[1]); b.ymax = Math.max(b.ymax, p[1]); } }));
  return b || topExt;
}
function resetOrbit(force){
  if(orbitInit && !force) return;
  const e = objBounds(), pad = 0.8;
  v3d.tx = (e.xmin + e.xmax) / 2; v3d.ty = (e.ymin + e.ymax) / 2 + 0.3;
  const W = e.xmax - e.xmin + 2*pad, D = e.ymax - e.ymin + 2*pad;
  const asp = v3d.w && v3d.h ? v3d.w / v3d.h : 1.4, tv = Math.tan(rad(v3d.fov) / 2), th = tv * asp;
  v3d.yaw = -Math.PI/2 - 0.3; v3d.pitch = 0.72;
  // the stage seen from behind the start: width across the screen, depth foreshortened by the pitch
  const across = W*Math.cos(0.3) + D*Math.sin(0.3);   // the view is turned 0.3 rad off the stage axis
  v3d.dist = Math.max(4, Math.min(60, Math.max((across / 2) / th * 1.2, (D * Math.sin(v3d.pitch) / 2 + 1) / tv * 1.12)));
  orbitInit = true; orbitAuto = true;
}
function camera(){
  if(RP.on && (v3d.mode === 'follow' || v3d.mode === 'fpv')){
    const p = figPos(RP.t), eye = figEye(RP.t);
    const nxt = RP.res.shots.find(x => x.t >= RP.t - 0.12), o = nxt && getObj(nxt.target);
    let dir = o ? [o.x - p[0], o.y - p[1]] : downDir(); const L = Math.hypot(dir[0], dir[1]) || 1; dir = [dir[0]/L, dir[1]/L];
    const aA = o && stopAt(RP.t) >= 0 ? aimDirAt(RP.t, p) : null; if(aA != null) dir = [Math.cos(aA), Math.sin(aA)];
    if(v3d.mode === 'fpv'){ const zt = o ? 1.0 : eye; const F = norm3([dir[0]*L, dir[1]*L, zt - eye]); return basis([p[0], p[1], eye], F, v3d.eyeFov, null); }
    const C = [p[0] - dir[0]*3.2, p[1] - dir[1]*3.2, 2.6];
    return basis(C, norm3([p[0] + dir[0]*2 - C[0], p[1] + dir[1]*2 - C[1], 0.9 - C[2]]), 60, null);
  }
  if(v3d.mode === 'follow' || v3d.mode === 'fpv') v3d.mode = 'orbit';
  if(v3d.mode !== 'orbit'){
    const vp = getObj(v3d.mode);
    if(vp){
      const f = facing(vp.rot), yaw = Math.atan2(f[1], f[0]) + v3d.eyeYaw, pitch = v3d.eyePitch;
      const F = [Math.cos(pitch)*Math.cos(yaw), Math.cos(pitch)*Math.sin(yaw), Math.sin(pitch)];
      return basis([vp.x, vp.y, eyeOf(vp)], F, v3d.eyeFov, vp);
    }
    v3d.mode = 'orbit';
  }
  const cp = Math.cos(v3d.pitch);
  const C = [v3d.tx + v3d.dist*cp*Math.cos(v3d.yaw), v3d.ty + v3d.dist*cp*Math.sin(v3d.yaw), v3d.dist*Math.sin(v3d.pitch)];
  const F = norm3([v3d.tx - C[0], v3d.ty - C[1], -C[2]]);
  return basis(C, F, v3d.fov, null);
}
function norm3(v){ const L = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0]/L, v[1]/L, v[2]/L]; }
function cross3(a, b){ return [a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]]; }
function basis(C, F, fov, vp){
  let R = norm3(cross3(F, [0,0,1])); if(!isFinite(R[0])) R = [1,0,0];
  const U = cross3(R, F);
  return {C, F, R, U, f:(v3d.h/2) / Math.tan(rad(fov)/2), vp};
}
function toCam(cam, P){ const d = [P[0]-cam.C[0], P[1]-cam.C[1], P[2]-cam.C[2]]; return [d[0]*cam.R[0]+d[1]*cam.R[1]+d[2]*cam.R[2], d[0]*cam.U[0]+d[1]*cam.U[1]+d[2]*cam.U[2], d[0]*cam.F[0]+d[1]*cam.F[1]+d[2]*cam.F[2]]; }
const NEAR = 0.05;
function clipNear(pts){
  const out = [];
  for(let i = 0; i < pts.length; i++){
    const a = pts[i], b = pts[(i+1) % pts.length], ain = a[2] >= NEAR, bin = b[2] >= NEAR;
    if(ain) out.push(a);
    if(ain !== bin){ const t = (NEAR - a[2]) / (b[2] - a[2]); out.push([a[0] + t*(b[0]-a[0]), a[1] + t*(b[1]-a[1]), NEAR]); }
  }
  return out;
}
function scr(cam, p){ return [v3d.w/2 + cam.f*p[0]/p[2], v3d.h/2 - cam.f*p[1]/p[2]]; }
/* swinger frame: post up to the axle, arm from the counterweight through the pivot to the target */
function swingFrame3d(faces, o, g, solid){
  const host = o, ax = swingAxle(Object.assign({}, host, {swing:null})), P = swingPar(host.mech);
  const a = o.swing ? o.swing.a : 0, R = q => rotAxis(q, ax.piv, ax.k, a);
  const bk = [-g.f[0]*0.04, -g.f[1]*0.04], pv = [ax.piv[0] + bk[0], ax.piv[1] + bk[1], ax.piv[2]];
  const pt = R([ax.piv[0] + bk[0]*0.6, ax.piv[1] + bk[1]*0.6, ax.zc - 0.05]), pc = R([ax.piv[0] + bk[0]*0.6, ax.piv[1] + bk[1]*0.6, ax.piv[2] - P.rC]);
  const post = [pv[0] + bk[0], pv[1] + bk[1]];
  if(solid){
    postFaces(faces, post[0], post[1], 0.02, 0, pv[2] + 0.04, '#5E6A75', '#2F3840');
    boxFaces(faces, segCorners([post[0] - g.p[0]*0.18, post[1] - g.p[1]*0.18], [post[0] + g.p[0]*0.18, post[1] + g.p[1]*0.18], 0.3), 0, 0.03, '#5E6A75', '#2F3840', 0.8);
  }else faces.push({line:[[post[0], post[1], 0], [post[0], post[1], pv[2]]], stroke:'#5E6A75', lw:3});
  faces.push({line:[pc, pt], stroke:'#3A3F44', wlw:0.025});
  faces.push({dot:pv, fill:'#C8372D', wr:0.022});
  // counterweight block, turned with the arm
  const cw = 0.07, chh = 0.05, e1 = R([pc[0], pc[1], pc[2]]), u = [g.p[0], g.p[1], 0];
  const cor = [[-cw, -chh], [cw, -chh], [cw, chh], [-cw, chh]].map(([s, h]) => { const q = [ax.piv[0] + bk[0]*0.6 + u[0]*s, ax.piv[1] + bk[1]*0.6 + u[1]*s, ax.piv[2] - P.rC + h]; return R(q); });
  faces.push({pts:cor, fill:'#2F3840', stroke:'#111', lw:1});
  if(!RP.on){   // show the locked position as an outline so the swing is visible while planning
    const lk = swingAngle(host.mech, null), gl = paperGeom(Object.assign({}, host, {swing:{piv:ax.piv, k:ax.k, a:-lk}}));
    faces.push({pts:gl.oct.map(([u2, v2]) => gl.toW(u2, v2)), fill:null, stroke:'rgba(107,63,160,.75)', lw:1.5});
  }
}
/* podium, bridge, boat, chair, horse */
function cylAxisFaces(faces, a, b, r, fill, edge, seg){
  seg = seg || 16; const d = [b[0]-a[0], b[1]-a[1], b[2]-a[2]], L = Math.hypot(d[0], d[1], d[2]) || 1, k = [d[0]/L, d[1]/L, d[2]/L];
  let u = Math.abs(k[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]; u = cross3(k, u); const ul = Math.hypot(u[0], u[1], u[2]); u = [u[0]/ul, u[1]/ul, u[2]/ul]; const v = cross3(k, u);
  const ring = c => { const out = []; for(let i = 0; i < seg; i++){ const t = i/seg*Math.PI*2; out.push([c[0] + (u[0]*Math.cos(t) + v[0]*Math.sin(t))*r, c[1] + (u[1]*Math.cos(t) + v[1]*Math.sin(t))*r, c[2] + (u[2]*Math.cos(t) + v[2]*Math.sin(t))*r]); } return out; };
  const A = ring(a), B = ring(b);
  for(let i = 0; i < seg; i++){ const j = (i+1) % seg; faces.push({pts:[A[i], A[j], B[j], B[i]], fill, stroke:null}); }
  faces.push({pts:A, fill, stroke:edge, lw:1}); faces.push({pts:B, fill, stroke:edge, lw:1});
}
function perch3d(faces, floor, labels, o, solid){
  const wood = '#B88A55', woodE = '#6E5230', f = facing(o.rot || 0), p = [-f[1], f[0]];
  const L = (a, b) => [o.x + f[0]*a + p[0]*b, o.y + f[1]*a + p[1]*b];
  let top = 0.5;
  if(o.type === 'platform'){ const h = o.h || 0.4; top = h; boxFaces(faces, perchFootprint(o), 0, h, '#A98458', woodE, 1.2); }
  else if(o.type === 'bridge'){
    if(o.x1 == null) return; const h = o.h || 0.4, a = [o.x1, o.y1], b = [o.x2, o.y2], Ln = Math.hypot(b[0]-a[0], b[1]-a[1]) || 1, u = [(b[0]-a[0])/Ln, (b[1]-a[1])/Ln]; top = h;
    boxFaces(faces, perchFootprint(o), h - 0.05, h, '#A98458', woodE, 1.2);
    const n = Math.max(2, Math.ceil(Ln / 1.0) + 1), w = (o.w || 0.6)/2, nn = [-u[1], u[0]];
    for(let i = 0; i < n; i++){ const s = Ln*i/(n-1); [-1, 1].forEach(sd => { const q = [a[0] + u[0]*s + nn[0]*sd*(w - 0.04), a[1] + u[1]*s + nn[1]*sd*(w - 0.04)]; postFaces(faces, q[0], q[1], 0.03, 0, h - 0.05, wood, woodE); }); }
    [[a, -1], [b, 1]].forEach(([e, sg]) => { const c0 = [e[0] + u[0]*sg*0.15, e[1] + u[1]*sg*0.15]; boxFaces(faces, segCorners([c0[0] - u[0]*0.15, c0[1] - u[1]*0.15], [c0[0] + u[0]*0.15, c0[1] + u[1]*0.15], o.w || 0.6), 0, h/2, '#9C7A50', woodE, 1); });
  }else if(o.type === 'boat'){
    const hull = boatHull(o), h0 = o.h || 0.2, rim = h0 + (o.rim || 0.6); top = rim;
    for(let i = 0; i < hull.length; i++){ const c = segCorners(hull[i], hull[(i+1) % hull.length], 0.04); if(solid) boxFaces(faces, c, 0, rim, '#3F6E96', '#1F3A52', 1); else faces.push({pts:[[hull[i][0],hull[i][1],0],[hull[(i+1)%hull.length][0],hull[(i+1)%hull.length][1],0],[hull[(i+1)%hull.length][0],hull[(i+1)%hull.length][1],rim],[hull[i][0],hull[i][1],rim]], fill:'#3F6E96'}); }
    faces.push({pts:hull.map(q => [q[0], q[1], h0]), fill:'#8F6E4A', stroke:'#5E4628', lw:1});
    const Lb = o.dp || 2.2, W = o.w || 1.0, sb = o.seat || 0.45;
    boxFaces(faces, segCorners(L(-Lb/4, -W/2 + 0.04), L(-Lb/4, W/2 - 0.04), 0.25), sb - 0.04, sb, wood, woodE, 1);
  }else if(o.type === 'chair'){
    const sh = o.seat || 0.45, w = (o.w || 0.45)/2, d = (o.dp || 0.45)/2; top = sh + 0.45;
    boxFaces(faces, perchFootprint(o), sh - 0.04, sh, '#8C6A44', woodE, 1);
    [[-d + 0.03, -w + 0.03], [-d + 0.03, w - 0.03], [d - 0.03, -w + 0.03], [d - 0.03, w - 0.03]].forEach(([a, b]) => { const q = L(a, b); postFaces(faces, q[0], q[1], 0.018, 0, sh - 0.04, '#5E4628', '#3A2A18'); });
    boxFaces(faces, segCorners(L(-d + 0.02, -w), L(-d + 0.02, w), 0.03), sh, sh + 0.45, '#8C6A44', woodE, 1);
  }else if(o.type === 'horse'){
    const sh = o.seat || 0.8, Lh = o.dp || 1.0, r = 0.28; top = sh;
    [-Lh/2 + 0.12, Lh/2 - 0.12].forEach(a => { const l1 = L(a, -0.25), l2 = L(a, 0.25), mid = L(a, 0); faces.push({line:[[l1[0], l1[1], 0], [mid[0], mid[1], sh - 2*r]], stroke:'#5E4628', wlw:0.04}); faces.push({line:[[l2[0], l2[1], 0], [mid[0], mid[1], sh - 2*r]], stroke:'#5E4628', wlw:0.04}); });
    const a3 = L(-Lh/2, 0), b3 = L(Lh/2, 0);
    cylAxisFaces(faces, [a3[0], a3[1], sh - r], [b3[0], b3[1], sh - r], r, '#B8433A', '#6E211B', 18);
    boxFaces(faces, segCorners(L(-0.18, 0), L(0.18, 0), 0.34), sh - 0.02, sh + 0.04, '#5A3A22', '#2E1D10', 1);
  }
  const c = o.type === 'bridge' ? [(o.x1 + o.x2)/2, (o.y1 + o.y2)/2] : [o.x, o.y];
  labels.push({p:[c[0], c[1], top + 0.15], t:o.label + ' ' + OBJ[o.type].label.replace(/（.*）/, ''), c:'#6E5230', pri:3});
}
/* Cooper tunnel: posts and side rails (inverted U), optional mesh or panels, loose slats across the top */
function tunnel3d(faces, floor, labels, o, solid){
  const g = tunnelGeom(o), H = g.h, post = 0.025, wood = '#B88A55', woodE = '#6E5230';
  floor.push({pts:g.corners.map(q => [q[0], q[1], 0.006]), fill:'rgba(185,139,78,.16)', stroke:null});
  const nPost = Math.max(2, Math.ceil(g.L / 1.2) + 1);
  [-1, 1].forEach(sd => {
    const q = sd * g.w / 2;
    for(let i = 0; i < nPost; i++){ const s = g.L * i / (nPost - 1), c = g.P(s, q); if(solid) postFaces(faces, c[0], c[1], post, 0, H, wood, woodE); else faces.push({line:[[c[0], c[1], 0], [c[0], c[1], H]], stroke:wood, lw:2}); }
    const a = g.P(0, q), b = g.P(g.L, q);
    if(solid) boxFaces(faces, segCorners(a, b, 0.05), H - 0.05, H, wood, woodE, 0.8); else faces.push({line:[[a[0], a[1], H], [b[0], b[1], H]], stroke:wood, lw:2});
    if(o.sides === 'panel'){ if(solid) boxFaces(faces, segCorners(a, b, 0.02), 0, H - 0.05, '#A9927A', woodE, 0.8); else faces.push({pts:[[a[0],a[1],0],[b[0],b[1],0],[b[0],b[1],H],[a[0],a[1],H]], fill:'#A9927A', stroke:woodE}); }
    else if(o.sides === 'mesh') faces.push({pts:[[a[0],a[1],0.02],[b[0],b[1],0.02],[b[0],b[1],H - 0.05],[a[0],a[1],H - 0.05]], fill:'rgba(110,120,130,.22)', stroke:'rgba(70,80,90,.6)', lw:0.8});
  });
  // loose slats resting on the rails (not fixed); knocked ones lie on the ground during replay
  const fallen = typeof tunnelFallen === 'function' ? tunnelFallen(o) : null;
  g.slats.forEach((s, i) => {
    const a = g.P(s, -g.w/2 - 0.06), b = g.P(s, g.w/2 + 0.06);
    if(fallen && fallen.has(i)){ const a2 = g.P(s + 0.05, -g.w/2 + 0.1), b2 = g.P(s + 0.25, g.w/2 - 0.05); if(solid) boxFaces(faces, segCorners(a2, b2, 0.035), 0, 0.02, '#D9B98A', woodE, 0.8); return; }
    if(solid) boxFaces(faces, segCorners(a, b, 0.035), H, H + 0.02, '#D9B98A', woodE, 0.8);
    else faces.push({line:[[a[0], a[1], H + 0.01], [b[0], b[1], H + 0.01]], stroke:'#D9B98A', lw:2});
  });
  const m = g.P(g.L/2, 0); labels.push({p:[m[0], m[1], H + 0.2], t:o.label + ' 礦工隧道', c:'#6E5230', pri:3});
}
/* solid shapes for the 3D view (planar polygons, usable by both renderers) */
function boxFaces(faces, c4, z0, z1, fill, edge, lw, extra){
  const q = (a, b) => [[a[0],a[1],z0],[b[0],b[1],z0],[b[0],b[1],z1],[a[0],a[1],z1]];
  const add = pts => faces.push(Object.assign({pts, fill, stroke:edge, lw:lw || 1}, extra || {}));
  for(let i = 0; i < 4; i++) add(q(c4[i], c4[(i+1) % 4]));
  add(c4.map(p => [p[0], p[1], z1]));
  if(z0 > 0.005) add(c4.map(p => [p[0], p[1], z0]).reverse());
}
function segCorners(a, b, T){
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / L * T/2, ny = (b[0] - a[0]) / L * T/2;
  return [[a[0] - nx, a[1] - ny], [b[0] - nx, b[1] - ny], [b[0] + nx, b[1] + ny], [a[0] + nx, a[1] + ny]];
}
function postFaces(faces, x, y, s, z0, z1, fill, edge){ boxFaces(faces, [[x - s, y - s], [x + s, y - s], [x + s, y + s], [x - s, y + s]], z0, z1, fill, edge, 0.8); }
function cylFaces(faces, x, y, r, z0, z1, fill, edge, seg){
  seg = seg || 18; const ring = [];
  for(let i = 0; i < seg; i++){ const t = i / seg * Math.PI * 2; ring.push([x + r*Math.cos(t), y + r*Math.sin(t)]); }
  for(let i = 0; i < seg; i++){ const a = ring[i], b = ring[(i+1) % seg]; faces.push({pts:[[a[0],a[1],z0],[b[0],b[1],z0],[b[0],b[1],z1],[a[0],a[1],z1]], fill, stroke:null}); }
  faces.push({pts:ring.map(p => [p[0], p[1], z1]), fill, stroke:edge, lw:1.2});
  return ring;
}
function build3d(statusMap, cam){
  const floor = [], faces = [], labels = [];
  const solid = typeof GL3D !== 'undefined' && GL3D.active;   // depth-buffered renderer: whole boxes instead of small tiles
  const quad = (a, b, z0, z1) => [[a[0],a[1],z0],[b[0],b[1],z0],[b[0],b[1],z1],[a[0],a[1],z1]];
  const e = topExt;
  if(solid){ const g = 12; floor.push({pts:[[e.xmin - g,e.ymin - g,0],[e.xmax + g,e.ymin - g,0],[e.xmax + g,e.ymax + g,0],[e.xmin - g,e.ymax + g,0]], fill:'#D9D2C0'}); }
  floor.push({pts:[[e.xmin,e.ymin,0],[e.xmax,e.ymin,0],[e.xmax,e.ymax,0],[e.xmin,e.ymax,0]], fill:'#EFE6CF'});
  for(let x = Math.ceil(e.xmin); x <= Math.floor(e.xmax); x++) floor.push({line:[[x,e.ymin,0.002],[x,e.ymax,0.002]], stroke:x % 5 ? 'rgba(47,111,168,.18)' : 'rgba(47,111,168,.45)'});
  for(let y = Math.ceil(e.ymin); y <= Math.floor(e.ymax); y++) floor.push({line:[[e.xmin,y,0.002],[e.xmax,y,0.002]], stroke:y % 5 ? 'rgba(47,111,168,.18)' : 'rgba(47,111,168,.45)'});
  stage.objects.forEach(o => {
    if(o.type === 'area') floor.push({pts:o.pts.map(p => [p[0], p[1], 0.004]), fill:'rgba(234,196,80,.45)'});
    if(o.type === 'faultline') floor.push(solid ? {line:[[o.x1,o.y1,0.02],[o.x2,o.y2,0.02]], stroke:'#C8372D', wlw:0.05} : {line:[[o.x1,o.y1,0.02],[o.x2,o.y2,0.02]], stroke:'#C8372D', lw:4});
    if(o.type === 'start'){ const f = facing(o.rot), p = [-f[1], f[0]]; floor.push({pts:[[o.x+f[0]*0.35,o.y+f[1]*0.35,0.01],[o.x-f[0]*0.2+p[0]*0.22,o.y-f[1]*0.2+p[1]*0.22,0.01],[o.x-f[0]*0.2-p[0]*0.22,o.y-f[1]*0.2-p[1]*0.22,0.01]], fill:'#2F6FA8'}); }
    if(o.type === 'trigger' && o.trig === 'laser'){ const f = facing(o.rot), p = [-f[1], f[0]], L = o.len || 1;
      const a1 = [o.x-p[0]*L/2, o.y-p[1]*L/2], b1 = [o.x+p[0]*L/2, o.y+p[1]*L/2];
      if(solid){ postFaces(faces, a1[0], a1[1], 0.03, 0, 0.4, '#3A3F44', '#111'); postFaces(faces, b1[0], b1[1], 0.03, 0, 0.4, '#3A3F44', '#111'); }
      faces.push({line:[[a1[0], a1[1], 0.3], [b1[0], b1[1], 0.3]], stroke:'rgba(220,40,40,.85)', lw:1.5}); }
    else if(o.type === 'trigger' && o.trig === 'pedal'){ const c = rectPts(o.x, o.y, 0.4, 0.3, o.rot || 0); if(solid) boxFaces(faces, c, 0, 0.04, '#6B3FA0', '#3B2160', 1); else floor.push({pts:c.map(q => [q[0], q[1], 0.01]), fill:'#6B3FA0'}); }
    else if(o.type === 'trigger' && (o.trig === 'rope' || o.trig === 'other')){
      if(solid) postFaces(faces, o.x, o.y, 0.03, 0, 1.4, '#6E7F90', '#34404C'); else faces.push({line:[[o.x, o.y, 0], [o.x, o.y, 1.4]], stroke:'#6E7F90', lw:3});
      if(o.trig === 'rope'){ faces.push({line:[[o.x, o.y, 1.4], [o.x + 0.05, o.y, 0.9]], stroke:'#C9A56E', lw:2}); faces.push({dot:[o.x + 0.05, o.y, 0.88], fill:'#C8372D', wr:0.03}); }
      else faces.push({dot:[o.x, o.y, 1.42], fill:'#6B3FA0', wr:0.05}); }
  });
  if(typeof planPath3d === 'function') planPath3d(floor, labels);
  stage.objects.forEach(o0 => {
    const o = RP.on ? replayPose(o0) : o0; if(!o) return;
    if(RP.on && o.type === 'viewpoint') return;
    const st = statusMap && statusMap[o.id];
    const hl = st === 'full' ? '#2F7D4F' : st === 'part' ? '#E08A1E' : st === 'unsafe' ? '#C8372D' : null;
    if(o.type === 'wall'){
      const H = o.h == null ? 1.8 : o.h, L = Math.hypot(o.x2 - o.x1, o.y2 - o.y1); if(L < 1e-6) return;
      const ux = (o.x2 - o.x1)/L, uy = (o.y2 - o.y1)/L, P = s => [o.x1 + ux*s, o.y1 + uy*s];
      const light = o.seeThrough || o.soft, fill = light ? 'rgba(140,153,166,.28)' : solid ? '#98A6B4' : '#7A8998';
      const pieces = []; let cur = 0;
      (o.ports || []).slice().sort((a, b) => a.off - b.off).forEach(pt => {
        const s0 = Math.max(0, pt.off), s1 = Math.min(L, pt.off + pt.w);
        if(s0 > cur) pieces.push([cur, s0, 0, H]);
        if(s1 > s0){ if(pt.bottom > 0) pieces.push([s0, s1, 0, pt.bottom]); if(pt.bottom + pt.h < H) pieces.push([s0, s1, pt.bottom + pt.h, H]); }
        cur = Math.max(cur, s1);
      });
      if(cur < L) pieces.push([cur, L, 0, H]);
      (o.ports || []).forEach(pt => { if(!pt.needOpen) return; const a = P(pt.off), b = P(pt.off + pt.w);
        faces.push({pts:quad(a, b, pt.bottom, pt.bottom + pt.h), fill:null, stroke:'#9B7BC8', lw:2.5, bias:-0.05}); });
      if(solid){
        const T = Math.max(0.03, o.t || 0.05), edge = light ? 'rgba(60,71,83,.7)' : '#46525E';
        pieces.forEach(([s0, s1, z0, z1]) => boxFaces(faces, segCorners(P(s0), P(s1), T), z0, z1, fill, edge, 1.3));
        if(!light) pieces.forEach(([s0, s1, z0, z1]) => { if(z1 - z0 > 0.5 && s1 - s0 > 0.4) faces.push({line:[[P(s0 + 0.03)[0], P(s0 + 0.03)[1], z0 + (z1 - z0)/2], [P(s1 - 0.03)[0], P(s1 - 0.03)[1], z0 + (z1 - z0)/2]], stroke:'rgba(70,82,94,.35)', lw:1}); });
        labels.push({p:[(o.x1+o.x2)/2, (o.y1+o.y2)/2, H + 0.1], t:o.label, c:'#1E2B38', pri:3});
        return;
      }
      pieces.forEach(([s0, s1, z0, z1]) => {
        const n = Math.max(1, Math.ceil((s1 - s0) / 0.3)), m = Math.max(1, Math.ceil((z1 - z0) / 0.6));
        for(let i = 0; i < n; i++) for(let j = 0; j < m; j++){
          const a = s0 + (s1 - s0)*i/n, b = s0 + (s1 - s0)*(i+1)/n, za = z0 + (z1 - z0)*j/m, zb = z0 + (z1 - z0)*(j+1)/m;
          faces.push({pts:quad(P(a), P(b), za, zb), fill, stroke:fill, lw:0.8});
        }
        faces.push({line:[[P(s0)[0], P(s0)[1], z0], [P(s0)[0], P(s0)[1], z1]], stroke:'rgba(40,50,60,.9)', lw:1.2});
        faces.push({line:[[P(s1)[0], P(s1)[1], z0], [P(s1)[0], P(s1)[1], z1]], stroke:'rgba(40,50,60,.9)', lw:1.2});
        faces.push({line:[[P(s0)[0], P(s0)[1], z1], [P(s1)[0], P(s1)[1], z1]], stroke:'rgba(40,50,60,.9)', lw:1.2});
      });
      labels.push({p:[(o.x1+o.x2)/2, (o.y1+o.y2)/2, H + 0.1], t:o.label, c:'#1E2B38'});
    }else if(o.type === 'paper' || o.type === 'noshoot'){
      const g = paperGeom(o), off = o.type === 'noshoot' ? 0.012 : 0;
      const dz = o.type === 'noshoot' ? (o.dz || 0) : 0;
      const pts = g.oct.map(([u, v]) => { const w = g.toW(u, v - dz*100); return [w[0] + g.f[0]*off, w[1] + g.f[1]*off, w[2]]; });
      faces.push({pts, fill:o.type === 'paper' ? '#D2A86E' : '#FAFAFA', stroke:hl || (o.type === 'paper' ? '#7A5424' : '#333'), lw:hl ? 3 : 1.2, bias:o.type === 'noshoot' ? -0.02 : 0});
      if(o.type === 'paper'){
        faces.push({pts:g.az.map(([u, v]) => g.toW(u, v)).map(w => [w[0] + g.f[0]*0.001, w[1] + g.f[1]*0.001, w[2]]), fill:null, stroke:'rgba(122,84,36,.8)', lw:1, bias:-0.01});
        const l = g.toW(0, g.H/2), r2 = g.toW(g.W, g.H/2);
        if(isSwingPhys(o)) swingFrame3d(faces, o, g, solid);
        else if(solid){
          const bk = [-g.f[0]*0.015, -g.f[1]*0.015];
          const sTop = Math.max(0.15, g.top - targetSpec(o.size).shoulder);   // stand frame top = target shoulders
          postFaces(faces, l[0] + bk[0], l[1] + bk[1], 0.012, 0, sTop, '#9C7746', '#6E5230');
          postFaces(faces, r2[0] + bk[0], r2[1] + bk[1], 0.012, 0, sTop, '#9C7746', '#6E5230');
          const f0 = [l[0] + bk[0], l[1] + bk[1]], f1 = [r2[0] + bk[0], r2[1] + bk[1]];
          boxFaces(faces, segCorners([f0[0] - g.f[0]*0.2, f0[1] - g.f[1]*0.2], [f0[0] + g.f[0]*0.2, f0[1] + g.f[1]*0.2], 0.04), 0, 0.03, '#8A6A40', '#5E4628', 0.8);
          boxFaces(faces, segCorners([f1[0] - g.f[0]*0.2, f1[1] - g.f[1]*0.2], [f1[0] + g.f[0]*0.2, f1[1] + g.f[1]*0.2], 0.04), 0, 0.03, '#8A6A40', '#5E4628', 0.8);
        }else{
          faces.push({line:[[l[0],l[1],0],[l[0],l[1],g.bottom + 0.1]], stroke:'#8B6B3E', lw:2});
          faces.push({line:[[r2[0],r2[1],0],[r2[0],r2[1],g.bottom + 0.1]], stroke:'#8B6B3E', lw:2});
        }
        labels.push({id:o.id, p:[o.x, o.y, g.top + 0.12], t:o.label + (isMech(o) ? '（' + MECH_SHORT[o.mech.type] + '）' : ''), c:isMech(o) ? '#6B3FA0' : '#7A5424', pri:1});
      }
    }else if((o.type === 'popper' || o.type === 'plate' || o.type === 'stopplate') && o.fallen){
      const f = facing(o.rot || 0), rad1 = o.type === 'popper' ? (o.mini ? RULE_SPECS.miniPopper.headD : RULE_SPECS.popper.headD)/2 : (o.d || 0.15)/2;
      const h = o.type === 'popper' ? (o.mini ? RULE_SPECS.miniPopper.h : RULE_SPECS.popper.h) : 0.3, a = o.fallen * Math.PI / 2;
      const cx = o.x - f[0]*Math.sin(a)*(h - rad1), cy = o.y - f[1]*Math.sin(a)*(h - rad1), cz = Math.max(0.03, Math.cos(a)*(h - rad1));
      faces.push({pts:circlePts(cx, cy, rad1, 12).map(q => [q[0], q[1], cz]), fill:o.type === 'stopplate' ? '#C8372D' : '#BDBDBD', stroke:'#555', lw:1});
    }else if(o.type === 'popper' || o.type === 'plate' || o.type === 'stopplate'){
      let zc, rad0, stem = false;
      if(o.type === 'popper'){ const sp = o.mini ? RULE_SPECS.miniPopper : RULE_SPECS.popper; rad0 = sp.headD/2; zc = sp.h - rad0; stem = true; }
      else { rad0 = (o.d || 0.15)/2; zc = o.cy != null ? o.cy : stage.plateCy; }
      const f = facing(o.rot || 0), p = [-f[1], f[0]], ring = [];
      const sq = o.type === 'plate' && o.shape === 'square';
      if(sq) [[-1,-1],[1,-1],[1,1],[-1,1]].forEach(([a, b]) => ring.push([o.x + p[0]*a*rad0, o.y + p[1]*a*rad0, zc + b*rad0]));
      else for(let k = 0; k < 16; k++){ const t = k/16*Math.PI*2; ring.push([o.x + p[0]*rad0*Math.cos(t), o.y + p[1]*rad0*Math.cos(t), zc + rad0*Math.sin(t)]); }
      if(stem){ const bw = (o.mini ? RULE_SPECS.miniPopper.baseW : RULE_SPECS.popper.baseW)/2; faces.push({pts:[[o.x-p[0]*bw,o.y-p[1]*bw,0],[o.x+p[0]*bw,o.y+p[1]*bw,0],[o.x+p[0]*rad0*0.66,o.y+p[1]*rad0*0.66,zc],[o.x-p[0]*rad0*0.66,o.y-p[1]*rad0*0.66,zc]], fill:'#E4E4E4', stroke:hl || '#444', lw:hl ? 2.5 : 1});
        if(solid) boxFaces(faces, segCorners([o.x - p[0]*(bw + 0.03), o.y - p[1]*(bw + 0.03)], [o.x + p[0]*(bw + 0.03), o.y + p[1]*(bw + 0.03)], 0.22), 0, 0.02, '#6B7177', '#3A3F44', 0.8); }
      else if(solid){ postFaces(faces, o.x - f[0]*0.02, o.y - f[1]*0.02, 0.012, 0, zc - rad0 * 0.2, '#6B7177', '#3A3F44'); boxFaces(faces, segCorners([o.x - p[0]*0.15, o.y - p[1]*0.15], [o.x + p[0]*0.15, o.y + p[1]*0.15], 0.25), 0, 0.02, '#6B7177', '#3A3F44', 0.8); }
      else faces.push({line:[[o.x,o.y,0],[o.x,o.y,zc - rad0]], stroke:'#666', lw:2});
      faces.push({pts:ring, fill:o.type === 'stopplate' ? '#C8372D' : '#EDEDED', stroke:hl || '#333', lw:hl ? 3 : 1.2, bias:-0.01});
      labels.push({id:o.id, p:[o.x, o.y, zc + rad0 + 0.12], t:o.label, c:o.type === 'stopplate' ? '#C8372D' : '#1E2B38', pri:1});
    }else if(solid && o.type === 'barrel'){
      const r = (o.d || 0.6) / 2, h = o.h || 0.9;
      cylFaces(faces, o.x, o.y, r, 0, h, '#B8433A', '#6E211B', 20);
      [0.3, 0.62].forEach(k => { const ring = circlePts(o.x, o.y, r + 0.004, 20); for(let i = 0; i < ring.length; i++){ const a = ring[i], b = ring[(i+1) % ring.length]; faces.push({line:[[a[0], a[1], h*k], [b[0], b[1], h*k]], stroke:'#7A2A22', lw:1.5}); } });
      labels.push({p:[o.x, o.y, h + 0.1], t:o.label, c:'#8C2E25', pri:3});
    }else if(solid && o.type === 'table'){
      const w = o.w || 0.9, dp = o.dp || 0.6, h = o.h || 0.75, c = rectPts(o.x, o.y, w, dp, o.rot || 0);
      boxFaces(faces, c, h - 0.035, h, '#C49A62', '#6E5230', 1);
      rectPts(o.x, o.y, w - 0.1, dp - 0.1, o.rot || 0).forEach(q => postFaces(faces, q[0], q[1], 0.02, 0, h - 0.035, '#7E6448', '#4F3E2A'));
      labels.push({p:[o.x, o.y, h + 0.1], t:o.label, c:'#6E5230', pri:3});
    }else if(solid && (o.type === 'prop' || o.type === 'door')){
      const door = o.type === 'door', w = o.w || (door ? 0.8 : 0.5), dp = door ? 0.04 : (o.dp || 0.5), h = o.h || (door ? 1.8 : 0.75);
      boxFaces(faces, rectPts(o.x, o.y, w, dp, o.rot || 0), 0, h, door ? '#6E7F90' : '#C9A56E', door ? '#34404C' : '#6E5230', 1.2);
      labels.push({p:[o.x, o.y, h + 0.1], t:door ? o.label : (o.name || o.label), c:'#1E2B38', pri:3});
    }else if(o.type === 'barrel' || o.type === 'table' || o.type === 'prop' || o.type === 'door'){
      let w, dp, h, fill;
      if(o.type === 'barrel'){ w = dp = o.d || 0.6; h = o.h || 0.9; fill = 'rgba(200,55,45,.75)'; }
      else if(o.type === 'door'){ w = o.w || 0.8; dp = 0.04; h = o.h || 1.8; fill = 'rgba(90,104,118,.85)'; }
      else { w = o.w || 0.5; dp = o.dp || 0.5; h = o.h || 0.75; fill = 'rgba(185,139,78,.85)'; }
      const c = rectPts(o.x, o.y, w, dp, o.rot || 0);
      for(let i = 0; i < 4; i++) faces.push({pts:quad(c[i], c[(i+1)%4], 0, h), fill, stroke:'rgba(40,40,40,.5)', lw:0.8});
      faces.push({pts:c.map(q => [q[0], q[1], h]), fill, stroke:'rgba(40,40,40,.5)', lw:0.8});
    }else if(o.type === 'tunnel' && o.x1 != null){
      tunnel3d(faces, floor, labels, o, solid);
    }else if(['platform','bridge','boat','chair','horse'].includes(o.type)){
      perch3d(faces, floor, labels, o, solid);
    }else if(o.type === 'viewpoint'){
      const eh = eyeOf(o);
      if(solid){ floor.push({pts:circlePts(o.x, o.y, 0.2, 20).map(q => [q[0], q[1], 0.008]), fill:'rgba(47,111,168,.18)', stroke:'#2F6FA8', lw:1.5});
        const f = facing(o.rot || 0); floor.push({line:[[o.x, o.y, 0.009], [o.x + f[0]*0.35, o.y + f[1]*0.35, 0.009]], stroke:'#2F6FA8', wlw:0.03}); }
      faces.push({line:[[o.x,o.y,0],[o.x,o.y,eh]], stroke:'#2F6FA8', lw:3});
      faces.push({dot:[o.x, o.y, eh], fill:'#2F6FA8'});
      labels.push({p:[o.x, o.y, eh + 0.15], t:o.label, c:'#2F6FA8', pri:2});
    }
  });
  if(RP.on){ replayMarks(faces); if(v3d.mode !== 'fpv') replayFigure(faces, labels); if(RP.cmp) withRun(RP.cmp, () => replayFigure(faces, labels, '#D9822B', '射手（計畫 ' + RP.cmp.plan.name + '）')); }
  return {floor, faces, labels};
}
const V3D_BG = '#DCE3EA';
function render3d(){
  if(leftTab !== '3d' || !v3d.w) return;
  const ctx = v3dCtx, dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const useGL = typeof gl3dInit === 'function' && gl3dInit();
  const cam = camera();
  let statusMap = null;
  if(cam.vp && !RP.on){ statusMap = {}; computeVis(cam.vp).forEach(r => statusMap[r.id] = r.nomStatus || r.status); }
  const {floor, faces, labels} = build3d(statusMap, cam);
  if(useGL && gl3dRender(cam, floor, faces, V3D_BG)){
    ctx.clearRect(0, 0, v3d.w, v3d.h);
    draw3dLabels(ctx, cam, labels, statusMap);
    draw3dOverlay(ctx, cam);
    return;
  }
  ctx.fillStyle = V3D_BG; ctx.fillRect(0, 0, v3d.w, v3d.h);
  const drawPoly = (it) => {
    const c = clipNear(it.pts.map(p => toCam(cam, p))); if(c.length < 3) return;
    const s = c.map(p => scr(cam, p));
    ctx.beginPath(); s.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.closePath();
    if(it.fill){ ctx.fillStyle = it.fill; ctx.fill(); }
    if(it.stroke){ ctx.strokeStyle = it.stroke; ctx.lineWidth = it.lw || 1; ctx.stroke(); }
  };
  const drawLine = (it) => {
    let a = toCam(cam, it.line[0]), b = toCam(cam, it.line[1]);
    if(a[2] < NEAR && b[2] < NEAR) return;
    if(a[2] < NEAR){ const t = (NEAR - a[2])/(b[2] - a[2]); a = [a[0]+t*(b[0]-a[0]), a[1]+t*(b[1]-a[1]), NEAR]; }
    if(b[2] < NEAR){ const t = (NEAR - b[2])/(a[2] - b[2]); b = [b[0]+t*(a[0]-b[0]), b[1]+t*(a[1]-b[1]), NEAR]; }
    const p = scr(cam, a), q = scr(cam, b);
    const lw = it.wlw ? Math.max(1, Math.min(80, cam.f * it.wlw / ((a[2] + b[2]) / 2))) : (it.lw || 1);
    ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.strokeStyle = it.stroke; ctx.lineWidth = lw; ctx.lineCap = it.wlw ? 'round' : 'butt'; ctx.stroke(); ctx.lineCap = 'butt';
  };
  floor.forEach(it => it.line ? drawLine(it) : drawPoly(it));
  const items = faces.map(it => {
    const P = it.pts || it.line || [it.dot];
    let x = 0, y = 0, z = 0; P.forEach(p => { const c = toCam(cam, p); x += c[0]; y += c[1]; z += c[2]; });
    const n = P.length;
    return {it, z:Math.hypot(x/n, y/n, z/n) + (it.bias || 0)};
  }).sort((a, b) => b.z - a.z);
  items.forEach(({it}) => {
    if(it.line) drawLine(it);
    else if(it.dot){ const c = toCam(cam, it.dot); if(c[2] > NEAR){ const q = scr(cam, c), r = it.wr ? Math.max(1.5, Math.min(120, cam.f * it.wr / c[2])) : (it.r || 5); ctx.beginPath(); ctx.arc(q[0], q[1], r, 0, Math.PI*2); ctx.fillStyle = it.fill; ctx.fill(); } }
    else drawPoly(it);
  });
  draw3dLabels(ctx, cam, labels, statusMap);
  draw3dOverlay(ctx, cam);
}
// labels: nearer and more important first; a label that would overlap one already drawn is skipped
function draw3dLabels(ctx, cam, labels, statusMap){
  ctx.font = '600 12px "Noto Sans TC","Microsoft JhengHei",sans-serif';
  const placed = [], list = [];
  labels.forEach(l => {
    if(statusMap && l.id && (statusMap[l.id] === 'none' || statusMap[l.id] === 'back')) return;
    if(statusMap && !l.id) return;
    const c = toCam(cam, l.p); if(c[2] <= NEAR) return;
    const q = scr(cam, c); if(q[0] < -50 || q[0] > v3d.w + 50 || q[1] < -20 || q[1] > v3d.h + 20) return;
    list.push({l, q, z:c[2], pri:l.pri == null ? 2 : l.pri});
  });
  list.sort((a, b) => a.pri - b.pri || a.z - b.z).forEach(({l, q}) => {
    const w = ctx.measureText(l.t).width, x = q[0] - w/2, y = q[1];
    const box = [x - 4, y - 13, x + w + 4, y + 5];
    if(placed.some(b => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) return;
    placed.push(box); label(ctx, l.t, x, y, l.c);
  });
}
function draw3dOverlay(ctx, cam){
  if(RP.on) replayHUD(ctx);
  if(cam.vp && !RP.on){
    const t = cam.vp.label + '　' + POSTURE_NAME[cam.vp.stance || 'stand'] + '　眼高 ' + Math.round(eyeOf(cam.vp)*100) + ' 公分　視角寬 ' + Math.round(v3d.eyeFov) + '°　綠框全露、橘框部分、紅框超出安全角度';
    label(ctx, t, 12, 22, '#1E2B38');
  }
}
function bind3d(){
  const c = v3dCanvas; let down = null, pinch = null;
  const touches = new Map();
  const pst = () => { const [a, b] = Array.from(touches.values()); return {d:Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, m:[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]}; };
  c.addEventListener('contextmenu', e => e.preventDefault());
  c.addEventListener('pointerdown', e => {
    c.setPointerCapture(e.pointerId); touches.set(e.pointerId, [e.clientX, e.clientY]);
    if(touches.size === 2){ down = null; pinch = pst(); return; }
    if(touches.size > 2) return;
    down = {x:e.clientX, y:e.clientY, pan:e.button === 2 || e.shiftKey, v:{...v3d}};
  });
  const lift = e => { touches.delete(e.pointerId); if(touches.size < 2) pinch = null; if(touches.size === 0) down = null; };
  c.addEventListener('pointercancel', lift);
  c.addEventListener('pointermove', e => {
    if(touches.has(e.pointerId)) touches.set(e.pointerId, [e.clientX, e.clientY]);
    if(pinch && touches.size >= 2){
      const n = pst(), f = n.d / pinch.d, dx = n.m[0] - pinch.m[0], dy = n.m[1] - pinch.m[1];
      if(v3d.mode === 'orbit'){
        v3d.dist = Math.max(1.5, Math.min(120, v3d.dist / f));
        const k = v3d.dist / 600, cy = Math.cos(v3d.yaw), sy = Math.sin(v3d.yaw);
        v3d.tx += (sy*dx - cy*dy) * k; v3d.ty += (-cy*dx - sy*dy) * k;
      }else v3d.eyeFov = Math.max(25, Math.min(110, v3d.eyeFov / f));
      orbitAuto = false; pinch = n; render3d(); return;
    }
    if(!down) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    if(v3d.mode === 'orbit'){
      orbitAuto = false;
      if(down.pan){
        const k = v3d.dist / 600, cy = Math.cos(v3d.yaw), sy = Math.sin(v3d.yaw);
        // move target in the ground plane relative to the view direction
        v3d.tx = down.v.tx + (sy*dx - cy*dy) * k; v3d.ty = down.v.ty + (-cy*dx - sy*dy) * k;
      }else{
        v3d.yaw = down.v.yaw - dx * 0.008;
        v3d.pitch = Math.max(0.08, Math.min(1.5, down.v.pitch + dy * 0.006));
      }
    }else{
      v3d.eyeYaw = down.v.eyeYaw - dx * 0.004;
      v3d.eyePitch = Math.max(-1.2, Math.min(1.2, down.v.eyePitch - dy * 0.004));
    }
    render3d();
  });
  c.addEventListener('pointerup', e => { lift(e); down = null; });
  c.addEventListener('wheel', e => {
    e.preventDefault(); orbitAuto = false;
    if(v3d.mode === 'orbit') v3d.dist = Math.max(1.5, Math.min(120, v3d.dist * Math.pow(1.0015, e.deltaY)));
    else v3d.eyeFov = Math.max(25, Math.min(110, v3d.eyeFov * Math.pow(1.001, e.deltaY)));
    render3d();
  }, {passive:false});
  $('tabImg').addEventListener('click', () => setLeftTab('img'));
  $('tab3d').addEventListener('click', () => setLeftTab('3d'));
  $('v3dMode').addEventListener('change', e => { v3d.mode = e.target.value; v3d.eyeYaw = 0; v3d.eyePitch = -0.05; setLeftTab('3d'); });
  $('v3dReset').addEventListener('click', () => { if(v3d.mode === 'orbit') resetOrbit(true); else { v3d.eyeYaw = 0; v3d.eyePitch = -0.05; v3d.eyeFov = 70; } render3d(); });
  $('profExport').addEventListener('click', () => { const cur = SHOOTERS.list.find(x => x.id === SHOOTERS.activeId); const o = stripAliases(PROFILE); o.name = cur.name; download('射手_' + safeName(cur.name) + '.profile.json', o); });
  $('profImport').addEventListener('click', () => $('profImportFile').click());
  $('libExport').addEventListener('click', exportAllShooters);
  $('libImport').addEventListener('click', () => $('libImportFile').click());
  $('libImportFile').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if(f) importAllShooters(f); });
  $('profImportFile').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = ''; if(!f) return;
    try{ const o = JSON.parse(await readFile(f, true)); if(o.type !== 'profile') throw new Error('bad');
      const id = uid(); saveProfile(); SHOOTERS.list.push({id, name:o.name || '匯入射手', profile:o}); switchShooter(id); alert('已匯入射手「' + (o.name || '匯入射手') + '」。'); }
    catch(err){ alert('匯入失敗：這個檔案不是個人參數檔。'); }
  });
  $('visSummaryBtn').addEventListener('click', renderVisSummary);
  $('suggestBtn').addEventListener('click', runStopSuggest);
  $('scaleBtn').addEventListener('click', () => {
    const real = parseFloat($('realDist').value), p = measurePts;
    if(!(real > 0) || p.length !== 2) return;
    const cur = Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]); if(cur < 1e-6) return;
    const k = real / cur;
    if(!confirm('量得 ' + fmt(cur) + ' 公尺，實際 ' + fmt(real) + ' 公尺，將整個 stage 放大 ' + fmt(k, 3) + ' 倍。確定嗎？')) return;
    scaleStage(k);
  });
  $('showHiddenChk').addEventListener('change', e => { visShowHidden = e.target.checked; renderViews(); });
  const setNum = (id, fn) => $(id).addEventListener('change', e => { const v = parseFloat(e.target.value); if(!isNaN(v)){ fn(v); objectsChanged(false); } });
  setNum('downDeg', v => stage.safety.downDeg = normDeg(v));
  setNum('safeL', v => stage.safety.left = Math.max(0, Math.min(180, v)));
  setNum('safeR', v => stage.safety.right = Math.max(0, Math.min(180, v)));
  setNum('plateCy', v => stage.plateCy = v / 100);
  $('flexChk').addEventListener('change', e => { stage.flex = e.target.checked; objectsChanged(false); });
}

/* ---------- phase 2: stop-point suggestions ---------- */
let stopSuggest = null;   // {cands, proposals, uncovered, shown, key}
// suggestions belong to one layout: anything but viewpoints changing makes them out of date
function suggestKey(){ return JSON.stringify([stage.objects.filter(o => o.type !== 'viewpoint'), stage.safety, stage.flex, stage.plateCy, PROFILE.lean, PROFILE.postures]); }
function suggestStale(){ return !!(stopSuggest && stopSuggest.key !== suggestKey()); }
function candidatePoints(step){
  const pts = [];
  stage.objects.filter(o => o.type === 'area' && o.pts && o.pts.length >= 3).forEach(a => {
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    a.pts.forEach(p => { xmin = Math.min(xmin, p[0]); xmax = Math.max(xmax, p[0]); ymin = Math.min(ymin, p[1]); ymax = Math.max(ymax, p[1]); });
    for(let x = Math.ceil(xmin / step) * step; x <= xmax; x += step) for(let y = Math.ceil(ymin / step) * step; y <= ymax; y += step){
      if(!pointInPoly(x, y, a.pts)) continue;
      let dmin = Infinity;
      for(let i = 0, j = a.pts.length - 1; i < a.pts.length; j = i++) dmin = Math.min(dmin, distPtSeg(x, y, a.pts[j][0], a.pts[j][1], a.pts[i][0], a.pts[i][1]));
      if(dmin >= 0.15 && !blockedSpot(x, y)) pts.push([+x.toFixed(2), +y.toFixed(2)]);
    }
  });
  return pts;
}
// a shooter cannot stand on a barrel, table, prop or inside a wall
function blockedSpot(x, y){
  return stage.objects.some(o => {
    if(o.type === 'barrel') return Math.hypot(o.x - x, o.y - y) < (o.d || 0.6)/2 + 0.3;
    if(o.type === 'table' || o.type === 'prop'){ const r = rectPts(o.x, o.y, (o.w || 0.5) + 0.6, (o.dp || 0.5) + 0.6, o.rot || 0); return pointInPoly(x, y, r); }
    if(o.type === 'wall' || o.type === 'door'){
      if(o.type === 'wall') return distPtSeg(x, y, o.x1, o.y1, o.x2, o.y2) < 0.3;
      return Math.hypot(o.x - x, o.y - y) < (o.w || 0.8)/2 + 0.2;
    }
    return false;
  });
}
function tempViewpoint(x, y){ return {id:'__cand', type:'viewpoint', x, y, rot:normDeg((stage.safety.downDeg || 0) - 180), stance:'stand'}; }
function quality(r){
  if(!r || r.status === 'unsafe' || r.status === 'back' || r.status === 'none') return 0;
  if(r.exp < 0.5) return 0;                                  // too little exposed to count as an engagement
  return r.exp - 0.08 * (r.postureTime || 0) - (r.oneHand ? 0.05 : 0);
}
function runStopSuggest(){
  const out = $('suggestBox'); out.innerHTML = '';
  const targets = stage.objects.filter(o => ['paper','popper','plate','stopplate'].includes(o.type));
  if(!targets.length){ out.appendChild(el('p', {class:'help', text:'圖上尚無靶。'})); return; }
  const pts = candidatePoints(0.5);
  if(!pts.length){ out.appendChild(warn('找不到候選點。請先建立射擊區（描出或由檔牆與邊線產生）。')); return; }
  const prog = el('div', {class:'readout', text:'計算中… 0 / ' + pts.length}); out.appendChild(prog);
  const rows = []; let i = 0;
  const step = () => {
    const t0 = performance.now();
    while(i < pts.length && performance.now() - t0 < 40){
      const res = computeVis(tempViewpoint(pts[i][0], pts[i][1]), {coarse:true});
      const q = {}, info = {};
      res.forEach(r => { q[r.id] = quality(r); info[r.id] = r; });
      rows.push({p:pts[i], q, info});
      i++;
    }
    prog.textContent = '計算中… ' + i + ' / ' + pts.length;
    if(i < pts.length) setTimeout(step, 0); else finishSuggest(rows, targets);
  };
  setTimeout(step, 0);
}
function finishSuggest(rows, targets){
  const ids = targets.map(t => t.id);
  const coverable = ids.filter(id => rows.some(r => r.q[id] > 0));
  const uncovered = ids.filter(id => !coverable.includes(id));
  // drop dominated candidates
  let cands = rows.filter(r => coverable.some(id => r.q[id] > 0));
  cands.sort((a, b) => coverable.filter(id => b.q[id] > 0).length - coverable.filter(id => a.q[id] > 0).length);
  const kept = [];
  cands.forEach(c => {
    const dom = kept.some(k => coverable.every(id => k.q[id] >= c.q[id] - 1e-9));
    if(!dom) kept.push(c);
  });
  cands = kept.slice(0, 40);
  const start = startObj();
  const pathLen = (stops) => {
    // nearest-neighbour order from the start position
    let cur = start ? [start.x, start.y] : stops[0].p, rest = stops.slice(), order = [], L = 0;
    while(rest.length){
      let bi = 0, bd = Infinity;
      rest.forEach((s, k) => { const d = Math.hypot(s.p[0] - cur[0], s.p[1] - cur[1]); if(d < bd){ bd = d; bi = k; } });
      L += bd; cur = rest[bi].p; order.push(rest.splice(bi, 1)[0]);
    }
    return {L, order};
  };
  const score = (combo) => {
    let tot = 0;
    for(const id of coverable){ let m = 0; combo.forEach(c => { if(c.q[id] > m) m = c.q[id]; }); if(m <= 0) return -Infinity; tot += m; }
    return tot - 0.05 * pathLen(combo).L;
  };
  const proposals = [];
  const n = cands.length;
  let kmin = null;
  for(let k = 1; k <= Math.min(6, n); k++){
    let best = null, bestS = -Infinity, count = 0;
    const idx = Array.from({length:k}, (_, j) => j);
    const combos = (function(){ let c = 1; for(let j = 0; j < k; j++) c = c * (n - j) / (j + 1); return c; })();
    if(combos > 250000){
      // greedy fallback
      const chosen = [];
      while(chosen.length < k){
        let bc = null, bs = -Infinity;
        cands.forEach(c => { if(chosen.includes(c)) return; const s2 = score(chosen.concat([c])); const part = coverable.reduce((acc, id) => acc + Math.max(0, ...chosen.concat([c]).map(x => x.q[id])), 0); const v = isFinite(s2) ? s2 + 1000 : part; if(v > bs){ bs = v; bc = c; } });
        chosen.push(bc);
      }
      const s2 = score(chosen); if(isFinite(s2)){ best = chosen; bestS = s2; }
    }else{
      while(true){
        const combo = idx.map(j => cands[j]);
        const sc = score(combo); count++;
        if(sc > bestS){ bestS = sc; best = combo; }
        let j = k - 1; while(j >= 0 && idx[j] === n - k + j) j--;
        if(j < 0) break;
        idx[j]++; for(let m = j + 1; m < k; m++) idx[m] = idx[m - 1] + 1;
      }
    }
    if(best && isFinite(bestS)){
      if(kmin == null) kmin = k;
      proposals.push({k, stops:pathLen(best).order, L:pathLen(best).L, score:bestS});
      if(k >= kmin + 2) break;
    }
  }
  // assign every target to the stop with the best quality
  proposals.forEach(pr => {
    pr.assign = {};
    coverable.forEach(id => { let bi = 0, bq = -1; pr.stops.forEach((s, j) => { if(s.q[id] > bq){ bq = s.q[id]; bi = j; } }); pr.assign[id] = bi; });
  });
  // keep extra-stop proposals only when every stop is used and the engagement quality clearly improves
  const useful = [];
  proposals.forEach(pr => {
    const allUsed = pr.stops.every((_, j) => Object.values(pr.assign).includes(j));
    const prev = useful[useful.length - 1];
    if(!prev || (allUsed && pr.score > prev.score + 0.3)) useful.push(pr);
  });
  stopSuggest = {proposals:useful, uncovered, ncand:rows.length, shown:useful.length ? 0 : -1, key:suggestKey()};
  renderSuggest(); renderViews();
}
function renderSuggest(){
  const out = $('suggestBox'); out.innerHTML = '';
  if(!stopSuggest) return;
  if(suggestStale()){
    out.appendChild(warn('stage 的物件已經變動，這組停頓點建議已過期。請重新按「自動找停頓點建議」。'));
    out.appendChild(el('div', {class:'btns'}, el('button', {text:'清除建議', onclick:() => { stopSuggest = null; renderSuggest(); renderViews(); }})));
    return;
  }
  const S = stopSuggest;
  out.appendChild(el('div', {class:'readout', text:'在射擊區內每 50 公分取候選點，共 ' + S.ncand + ' 個。以可射擊比例 50% 以上、且在安全射擊角度內視為可交戰。'}));
  if(S.uncovered.length) out.appendChild(warn('沒有任何候選點可射擊：' + S.uncovered.map(id => getObj(id)?.label).join('、') + '。請檢查遮蔽、no-shoot 位置或射擊區範圍。'));
  if(!S.proposals.length){ out.appendChild(warn('找不到能涵蓋所有靶的停頓點組合。')); return; }
  S.proposals.forEach((pr, pi) => {
    const box = el('div', {class:'port'});
    box.appendChild(el('div', {class:'kind', text:'方案 ' + String.fromCharCode(65 + pi) + '：' + pr.k + ' 個停頓點，移動距離約 ' + fmt(pr.L, 1) + ' 公尺' + (pi === S.shown ? '（顯示中）' : '')}));
    const ul = el('ul', {class:'summ'});
    pr.stops.forEach((st, j) => {
      const ts = Object.keys(pr.assign).filter(id => pr.assign[id] === j).map(id => {
        const r = st.info[id], lab = getObj(id)?.label || '?';
        let t = lab;
        if(r.status === 'part') t += '（部分 ' + Math.round(r.exp*100) + '%）';
        if(r.posture) t += '（' + r.posture + '）';
        if(r.oneHand) t += '（單手維持開窗）'; else if(r.needOpen) t += '（需開窗）';
        return t;
      });
      ul.appendChild(el('li', null, el('b', {text:'S' + (j + 1) + '（' + fmt(st.p[0], 1) + ', ' + fmt(st.p[1], 1) + '）：'}), document.createTextNode(ts.join('、') || '（僅經過）')));
    });
    box.appendChild(ul);
    box.appendChild(el('div', {class:'btns'},
      el('button', {text:'在俯視圖顯示', onclick:() => { S.shown = pi; renderSuggest(); renderViews(); }}),
      el('button', {class:'primary', text:'轉成視點', onclick:() => suggestToViewpoints(pr)})));
    out.appendChild(box);
  });
  out.appendChild(el('p', {class:'help', text:'停頓點位置是依視線計算的建議，實際站不站得穩、動線是否順暢，請轉成視點後自行拖曳微調。移動距離以直線近似，尚未計算繞過檔牆。'}));
  out.appendChild(el('div', {class:'btns'}, el('button', {text:'清除建議', onclick:() => { stopSuggest = null; renderSuggest(); renderViews(); }})));
}
function suggestToViewpoints(pr){
  if(suggestStale()){ alert('stage 的物件已經變動，這組停頓點建議已過期。請重新按「自動找停頓點建議」。'); renderSuggest(); return; }
  pr.stops.forEach((st, j) => {
    const v = createPointObj('viewpoint', st.p[0], st.p[1]);
    v.rot = normDeg((stage.safety.downDeg || 0) - 180);
    v.fromSuggest = true;
    stage.objects.push(v);
  });
  stopSuggest.shown = -1;
  objectsChanged(true);
  renderSuggest();
  alert('已新增 ' + pr.stops.length + ' 個視點，可在俯視圖拖曳微調，再用視線分析確認。');
}
function drawSuggestOverlay(ctx, toS){
  if(!stopSuggest || stopSuggest.shown < 0 || suggestStale()) return;
  const pr = stopSuggest.proposals[stopSuggest.shown]; if(!pr) return;
  const purple = '#6B3FA0';
  // path
  const start = startObj();
  const path = (start ? [[start.x, start.y]] : []).concat(pr.stops.map(s => s.p));
  if(path.length > 1 && pathW(ctx, toS, path)){ ctx.setLineDash([6,4]); ctx.strokeStyle = 'rgba(107,63,160,.6)'; ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]); }
  pr.stops.forEach((st, j) => {
    const q0 = toS(st.p[0], st.p[1]); if(!q0) return;
    Object.keys(pr.assign).filter(id => pr.assign[id] === j).forEach(id => {
      const o = getObj(id); const q = o && toS(o.x, o.y); if(!q) return;
      ctx.beginPath(); ctx.moveTo(q0[0], q0[1]); ctx.lineTo(q[0], q[1]); ctx.strokeStyle = 'rgba(107,63,160,.35)'; ctx.lineWidth = 1.2; ctx.stroke();
    });
    ctx.beginPath(); ctx.arc(q0[0], q0[1], 11, 0, Math.PI*2); ctx.fillStyle = purple; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '700 11px "Noto Sans TC",sans-serif'; ctx.fillText('S' + (j + 1), q0[0] - 7, q0[1] + 4);
  });
}
