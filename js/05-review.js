'use strict';
/*! Stage 模擬器 — IPSC Action Air stage 規劃、回放與檢討
 *  Copyright (C) 2026 James
 *  SPDX-License-Identifier: GPL-3.0-or-later
 *  本程式為自由軟體：你可以依自由軟體基金會發布的 GNU 通用公共授權條款第 3 版，
 *  或（由你選擇）任何更新的版本，重新散布或修改本程式。本程式不提供任何保證，
 *  亦不保證適售性或特定目的適用性。完整條款見 LICENSE 或 <https://www.gnu.org/licenses/>。
 */
/* ---------- shooter benchmark & weakness ranking ---------- */
// Each group is one ability. Swapping a group copies that ability from the benchmark into my profile,
// while body geometry (height, eye heights, lean) and magazine load stay mine.
let benchCache = null;
const BENCH_GROUPS = [
  {key:'start', name:'起始（出槍或取槍）', t:['startHolster','startPickup','loadExtra','emptyChamber','uprange','daFirst'], show:P => '出槍 ' + fmt(P.time.startHolster) + ' 秒'},
  {key:'split', name:'同靶 split（扳機控制）', t:['split','expPen','steelPen','nsPen','moveSplitPen','oneHandMult'], show:P => '5 m 內 ' + fmt(P.time.split[0]) + '、10 m 以上 ' + fmt(P.time.split[3]) + ' 秒'},
  {key:'trans', name:'換靶（啟動、轉動、停穩）', t:['trans'], b:['init','settle','armSpeed','hipSpeed','armZone','stepAngle','stepTime','leftMult','rightMult'], show:P => '45° 換靶 ' + fmt(transTime(45, 1, 'stand', 0)) + ' 秒'},
  {key:'move', name:'移動（爆發力、速度、進位）', t:['exitT','startCost','speed','entry'], b:['lateral3m'], show:P => '起步 ' + fmt(P.time.startCost) + ' 秒、速度 ' + fmt(P.time.speed) + ' m/s、進位 ' + fmt(P.time.entry.full) + ' 秒'},
  {key:'reload', name:'換匣', t:['reloadStatic','reloadMove'], show:P => '定點 ' + fmt(P.time.reloadStatic) + '、移動中 ' + fmt(P.time.reloadMove) + ' 秒'},
  {key:'posture', name:'姿態轉換（協調性）', post:true, show:P => '跪姿 ' + fmt(P.postures.kneel.t) + ' 秒'},
  {key:'hit', name:'命中（準度）', hit:true, show:P => '5 m 內 A ' + P.hit.paper[0].A + '%、10 m 以上 A ' + P.hit.paper[3].A + '%'},
  {key:'misc', name:'其他動作（開窗）', t:['windowOpen'], show:P => '開窗 ' + fmt(P.time.windowOpen) + ' 秒'}
];
function bench(){ if(!SHOOTERS.bench) SHOOTERS.bench = {baseId:null, from:{}}; SHOOTERS.bench.from = SHOOTERS.bench.from || {}; return SHOOTERS.bench; }
function saveShooters(){ try{ localStorage.setItem(LS_SHOOTERS, JSON.stringify(SHOOTERS)); }catch(e){} }
function shooterName(id){ const s = SHOOTERS.list.find(x => x.id === id); return s ? s.name : '（已刪除）'; }
// run fn with PROFILE temporarily set to p (same division as the current shooter)
function withProfile(p, fn){
  const cur = PROFILE, div = cur.division;
  PROFILE = p;
  try{ ensureProfileParams(); PROFILE.division = div; bindDivision(div); return fn(p); }
  finally{ PROFILE = cur; bindDivision(PROFILE.division); planCache = null; }
}
function shooterParams(id){
  saveProfile();
  const s = SHOOTERS.list.find(x => x.id === id); if(!s) return null;
  const p = mergeProfile(clone(s.profile));
  withProfile(p, () => {});
  return p;
}
function myParams(){ const p = mergeProfile(clone(stripAliases(PROFILE))); withProfile(p, () => {}); return p; }
function copyGroup(dst, src, g){
  const div = PROFILE.division, dt = dst.byDiv[div].time, st = src.byDiv[div].time;
  (g.t || []).forEach(k => { dt[k] = clone(st[k]); });
  (g.b || []).forEach(k => { dst.body[k] = src.body[k]; });
  if(g.post) POSTURE_ORDER.forEach(k => { if(dst.postures[k] && src.postures[k]) dst.postures[k].t = src.postures[k].t; });
  if(g.hit) dst.byDiv[div].hit = clone(src.byDiv[div].hit);
}
function benchSource(gk){ const b = bench(); return b.from[gk] || b.baseId; }
function benchReady(){ const b = bench(); return !!(b.baseId && SHOOTERS.list.some(x => x.id === b.baseId)); }
// my profile with the chosen ability groups replaced by the benchmark's
function mixedProfile(keys){
  const me = myParams(), cache = {};
  BENCH_GROUPS.filter(g => keys.includes(g.key)).forEach(g => {
    const id = benchSource(g.key); if(!id || id === SHOOTERS.activeId) return;
    const src = cache[id] || (cache[id] = shooterParams(id)); if(src) copyGroup(me, src, g);
  });
  return withProfile(me, () => me);
}
function evalWith(p, plan){ return withProfile(p, () => computePlan(plan, {noMC:true})); }
function weaknessRanking(plan){
  const all = BENCH_GROUPS.map(g => g.key);
  const mine = evalWith(myParams(), plan), full = evalWith(mixedProfile(all), plan);
  const rows = BENCH_GROUPS.map(g => {
    const src = benchSource(g.key);
    if(!src || src === SHOOTERS.activeId) return {g, same:true, dHF:0, dT:0, dP:0};
    const r = evalWith(mixedProfile([g.key]), plan);
    return {g, src, dHF:r.eHF - mine.eHF, dT:mine.total - r.total, dP:r.ePts - mine.ePts,
            mineShow:withProfile(myParams(), P => g.show(P)), benchShow:withProfile(shooterParams(src), P => g.show(P))};
  });
  return {mine, full, rows:rows.sort((a, b) => b.dHF - a.dHF)};
}
function renderBenchBox(box, plan){
  const d = el('div', {class:'props'});
  d.appendChild(el('h3', {text:'與標竿比較：弱項排序'}));
  const b = bench(), others = SHOOTERS.list.filter(x => x.id !== SHOOTERS.activeId);
  if(!others.length){
    d.appendChild(el('p', {class:'help', text:'需要至少兩位射手才能比較。可按頂端的「射手」新增一位標竿射手（例如冠軍、教練），或複製自己後改成「目標水準」的數值。'}));
    box.appendChild(d); return;
  }
  const opts = [['', '（未指定）']].concat(SHOOTERS.list.map(x => [x.id, x.name + (x.id === SHOOTERS.activeId ? '（目前射手）' : '')]));
  d.appendChild(selField('標竿射手', opts, b.baseId || '', v => { b.baseId = v || null; saveShooters(); renderPlanPanel(); renderShooterBox(); }));
  d.appendChild(el('p', {class:'help', text:'弱項排序的算法：把你的某一項能力換成標竿的數值，其他條件（身高、眼高、裝填數、這條路線）都不變，重算期望 hit factor，提升越多代表這項越值得補強。這等於「差距乘上對 hit factor 的影響」，但直接重算，不用線性近似。'}));
  const det = el('details', null, el('summary', {text:'個別能力改用其他射手當標竿（選填）'}));
  BENCH_GROUPS.forEach(g => det.appendChild(selField(g.name, [['', '跟隨標竿射手']].concat(others.map(x => [x.id, x.name])), b.from[g.key] || '', v => { if(v) b.from[g.key] = v; else delete b.from[g.key]; saveShooters(); renderPlanPanel(); })));
  det.appendChild(el('p', {class:'help', text:'例如出槍以 A 射手為標竿、移動以 B 射手為標竿。想用自訂的目標數值，可以複製一位射手、改名為「目標水準」再修改參數。'}));
  d.appendChild(det);
  if(!benchReady()){ box.appendChild(d); return; }
  if(b.baseId === SHOOTERS.activeId && !Object.keys(b.from).length){ d.appendChild(warn('標竿射手就是目前射手，請改選其他射手。')); box.appendChild(d); return; }
  const wkey = JSON.stringify([plan, stage.objects, stage.startCond, stage.safety, SHOOTERS, PROFILE.division]);
  if(!benchCache || benchCache.key !== wkey) benchCache = {key:wkey, W:weaknessRanking(plan)};
  const W = benchCache.W;
  d.appendChild(el('div', {class:'readout', text:'這條路線：你 ' + fmt(W.mine.total) + ' 秒、期望 HF ' + fmt(W.mine.eHF, 3) + '；全部換成標竿能力 ' + fmt(W.full.total) + ' 秒、期望 HF ' + fmt(W.full.eHF, 3) + '（差 ' + fmt(W.full.eHF - W.mine.eHF, 3) + '）'}));
  const ul = el('ol', {class:'summ'}); ul.style.paddingLeft = '20px'; ul.style.listStyle = 'decimal';
  const sumGain = W.rows.reduce((a, r) => a + Math.max(0, r.dHF), 0);
  W.rows.forEach(r => {
    if(r.same){ ul.appendChild(el('li', {text:r.g.name + '：標竿與你相同，未比較'})); return; }
    const txt = r.g.name + '：HF ' + (r.dHF >= 0 ? '+' : '') + fmt(r.dHF, 3) + (Math.abs(r.dT) >= 0.005 ? '（時間 ' + (r.dT >= 0 ? '快 ' : '慢 ') + fmt(Math.abs(r.dT)) + ' 秒）' : '') + (Math.abs(r.dP) >= 0.05 ? '（期望得分 ' + (r.dP >= 0 ? '+' : '') + fmt(r.dP, 1) + '）' : '') +
      '。你：' + r.mineShow + '；' + shooterName(r.src) + '：' + r.benchShow;
    const li = el('li', {text:txt + (Math.abs(r.dHF) < 0.0005 ? '（這條路線上看不出差別）' : '')});
    if(r.dHF < -0.0005) li.style.color = 'var(--ok)';
    ul.appendChild(li);
  });
  d.appendChild(ul);
  const inter = (W.full.eHF - W.mine.eHF) - W.rows.reduce((a, r) => a + r.dHF, 0);
  d.appendChild(el('p', {class:'help', text:'數值為負（綠色）代表你這項比標竿好。各項提升相加 ' + fmt(sumGain, 3) + '，與全部換掉的差距之間的落差（' + fmt(inter, 3) + '）來自能力之間的交互作用：例如出槍與移動同時進行時，只改善其中一項會被另一項蓋掉，兩項一起改善才看得到效果；反過來，移動變快也可能讓等機關靶的死時間變多。排序只反映這一條路線；換路線時請重新比較。估計值多的參數，排序只供參考。'}));
  box.appendChild(d);
}
function exportAllShooters(){ saveProfile(); download('射手資料庫.shooters.json', {schemaVersion:SCHEMA, type:'shooterLibrary', exported:new Date().toISOString(), shooters:clone(SHOOTERS)}); }
async function importAllShooters(file){
  try{
    const o = JSON.parse(await readFile(file, true));
    if(o.type !== 'shooterLibrary' || !o.shooters || !Array.isArray(o.shooters.list)) throw new Error('bad');
    saveProfile();
    const idMap = {};
    o.shooters.list.forEach(x => {
      const same = SHOOTERS.list.find(y => y.id === x.id);
      if(same){ if(confirm('射手「' + x.name + '」已存在，要用檔案內的資料覆蓋嗎？')){ same.name = x.name; same.profile = x.profile; same.updated = x.updated; } idMap[x.id] = same.id; }
      else { SHOOTERS.list.push(clone(x)); idMap[x.id] = x.id; }
    });
    if(o.shooters.bench && o.shooters.bench.baseId && (!bench().baseId || confirm('要一併套用檔案內的標竿設定嗎？'))) SHOOTERS.bench = clone(o.shooters.bench);
    saveShooters(); switchShooter(SHOOTERS.activeId); planChanged(false);
    alert('已匯入 ' + o.shooters.list.length + ' 位射手。');
  }catch(e){ alert('匯入失敗：這個檔案不是射手資料庫。'); }
}

/* ---------- phase 4b: scores, actual route, weakness report ---------- */
function runShooter(run){ return run.shooterId && SHOOTERS.list.some(x => x.id === run.shooterId) ? run.shooterId : SHOOTERS.activeId; }
function runParams(run){ return shooterParams(runShooter(run)); }
function scoredTargets(){ return engageable().filter(o => o.type !== 'stopplate'); }
function runTotals(run){
  const sc = Object.assign({A:0, C:0, D:0, M:0, NS:0, PE:0}, run.score || {});
  if(run.scoreMode !== 'target') return sc;
  const t = {A:0, C:0, D:0, M:0, NS:0, PE:+sc.PE || 0}, pt = run.perTarget || {};
  scoredTargets().forEach(o => {
    const x = pt[o.id]; if(!x) return;
    if(o.type === 'paper'){ ['A','C','D','M','NS'].forEach(k => t[k] += +x[k] || 0); }
    else if(x.down === 1) t.A += 1; else if(x.down === 0) t.M += 1;
  });
  return t;
}
function targetPts(o, x){
  if(!x) return null;
  if(o.type === 'paper') return 5*(+x.A || 0) + 3*(+x.C || 0) + (+x.D || 0) - 10*(+x.M || 0) - 10*(+x.NS || 0);
  return x.down === 1 ? 5 : x.down === 0 ? -10 : null;
}
function perTargetFilled(run){ const pt = run.perTarget || {}; return scoredTargets().some(o => targetPts(o, pt[o.id]) != null); }
// expected result per target from the model timeline
function expectedByTarget(R, plan){
  const m = {};
  R.shots.forEach(s => {
    if(!s.scored) return;
    const e = m[s.target] || (m[s.target] = {n:0, A:0, C:0, D:0, M:0, NS:0, pts:0, steel:s.steel, band:s.band, expo:s.expo, stop:s.stop, stopType:plan.stops[s.stop] ? plan.stops[s.stop].stopType : 'full'});
    e.n++; e.pts += s.ep;
    if(s.steel){ e.A += s.pS; e.M += 1 - s.pS; } else { ['A','C','D','M','NS'].forEach(k => e[k] += s.hd[k] || 0); }
  });
  return m;
}
const BAND_TXT = ['5 公尺內','5 到 8 公尺','8 到 10 公尺','10 公尺以上'], EXPO_TXT = {full:'全露', partial:'部分遮蔽', heavy:'嚴重遮蔽'}, STOP_TXT = {full:'完全停頓', rolling:'減速通過', move:'移動中射擊'};
function catStats(rows){
  const g = {};
  rows.filter(r => r.clean).forEach(r => { const k = kindGroup(r.shot); const x = g[k] || (g[k] = {n:0, sum:0}); x.n++; x.sum += r.meas; });
  return g;
}
function modelCatStats(R){
  const g = {};
  R.shots.forEach(s => { const k = kindGroup(s); const x = g[k] || (g[k] = {n:0, sum:0}); x.n++; x.sum += s.dt; });
  return g;
}
const DRILL = {
  '第一槍（起始）':'出槍到第一槍：乾練出槍、起始姿勢與握槍一致性',
  '移動或換姿態後第一槍':'爆發力與步法：起步、煞車、進位時槍已指向靶（出位與進位練習）',
  '換靶':'換靶：眼睛先到、髖部帶動、停穩即擊發（依夾角分組練習）',
  '同靶 split':'扳機控制與節奏：同靶雙發、確認準星回位的速度',
  '換匣':'換匣：乾練換匣、移動中換匣，並檢查換匣位置是否排在最長的移動段',
  '補槍與略過':'第一發準度與補槍決策：減少需要補槍的情況',
  '得分':'準度：針對下面列出最多丟分的距離與遮蔽條件練習',
  '路線':'靶位選擇與 stage 規劃：比較停頓點與射擊順序'
};
function hfGainTime(P, T, dt){ return T - dt > 0.1 && P > 0 ? P / (T - dt) - P / T : 0; }
// the diagnosis: everything is expressed as how much hit factor it costs
function diagnose(run, plan, R, rows){
  const T = run.times[run.times.length - 1] || 0, tot = runTotals(run);
  const actPts = 5*tot.A + 3*tot.C + tot.D - 10*tot.M - 10*tot.NS - 10*tot.PE;
  const hasScore = tot.A + tot.C + tot.D + tot.M + tot.NS > 0;
  const P = hasScore ? Math.max(0, actPts) : R.ePts;
  const out = {T, P, hasScore, actPts, items:[], score:null, route:null, comp:null, notes:[]};
  // comparison source: a measured run of another shooter, else the benchmark model
  const b = bench(), rs = runs().filter(r => r !== run);
  let comp = rs.find(r => r.id === run.compId) || null;
  if(!comp && run.compId !== 'model') comp = rs.slice().reverse().find(r => runShooter(r) === b.baseId && runShooter(r) !== runShooter(run)) || null;
  let cStats = null, cName = '', cPts = null, cT = null;
  const myStats = catStats(rows);
  if(comp){
    const cPlan = plans().find(p => p.id === comp.planId);
    cName = shooterName(runShooter(comp)) + ' 實測「' + (comp.name || '') + '」';
    cT = comp.times[comp.times.length - 1] || 0;
    const ct = runTotals(comp); if(ct.A + ct.C + ct.D + ct.M + ct.NS > 0) cPts = Math.max(0, 5*ct.A + 3*ct.C + ct.D - 10*ct.M - 10*ct.NS - 10*ct.PE);
    if(cPlan){ const cR = runModel(comp, cPlan);
      if(!Array.isArray(comp.map) || comp.map.length !== comp.times.length || comp.map.some(j => j >= cR.shots.length)){ comp.map = alignShots(comp.times, cR); comp.mapN = cR.shots.length; }
      cStats = catStats(compareRun(comp, cR)); if(cPlan.id !== plan.id) out.notes.push('對照紀錄跑的是另一條路線（計畫 ' + cPlan.name + '），換靶角度與移動距離不同，各類動作以「每次平均」乘上你的次數比較，只能粗略參考。'); }
    else out.notes.push('對照紀錄沒有對應路線計畫，只能比較總時間與得分。');
    out.comp = {name:cName, T:cT, P:cPts, HF:cPts != null && cT > 0 ? cPts / cT : null, run:comp};
  }else if(benchReady() && b.baseId !== runShooter(run)){
    const bR = evalWith(mixedProfile(BENCH_GROUPS.map(g => g.key)), plan);
    cStats = modelCatStats(bR); cName = shooterName(b.baseId) + ' 的參數預測（同一條路線）';
    out.comp = {name:cName, T:bR.total, P:bR.ePts, HF:bR.eHF, model:true};
  }
  // time categories
  ['第一槍（起始）', '移動或換姿態後第一槍', '換靶', '換匣', '同靶 split'].forEach(k => {
    const m = myStats[k]; if(!m) return;
    const c = cStats && cStats[k];
    if(c){
      const d = (m.sum / m.n - c.sum / c.n) * m.n;
      out.items.push({name:k, dHF:hfGainTime(P, T, d), detail:'你平均 ' + fmt(m.sum / m.n) + ' 秒，' + (comp ? '對照' : '標竿預測') + ' ' + fmt(c.sum / c.n) + ' 秒，共 ' + m.n + ' 次，合計' + (d >= 0 ? '多花 ' : '少花 ') + fmt(Math.abs(d)) + ' 秒', drill:DRILL[k]});
    }
  });
  // make-up shots and skipped segments
  const dirty = rows.filter(r => !r.clean);
  if(dirty.length){
    const d = dirty.reduce((a, r) => a + r.meas - r.model, 0);
    if(d > 0.01) out.items.push({name:'補槍與略過', dHF:hfGainTime(P, T, d), detail:dirty.length + ' 段含補槍或略過，比模型多花 ' + fmt(d) + ' 秒', drill:DRILL['補槍與略過']});
  }
  // scoring face
  if(hasScore){
    const ref = out.comp && out.comp.P != null ? {pts:out.comp.P, name:out.comp.name} : {pts:R.ePts, name:'你的模型期望'};
    const dP = ref.pts - P;
    out.items.push({name:'得分', dHF:T > 0 ? dP / T : 0, detail:'你 ' + fmt(P, 0) + ' 分，' + ref.name + ' ' + fmt(ref.pts, 1) + ' 分，' + (dP >= 0 ? '少 ' : '多 ') + fmt(Math.abs(dP), 1) + ' 分', drill:DRILL['得分']});
    out.score = scoreFace(run, plan, R, tot);
  }else out.notes.push('尚未輸入成績，得分面以模型期望值代替，不列入弱項。');
  // route face
  out.route = routeFace(run, plan, comp);
  if(out.route && out.route.best && out.route.best.p.id !== plan.id){
    const d = out.route.best.hf - out.route.mine;
    if(d > 0.001) out.items.push({name:'路線', dHF:d, detail:'以你的參數，計畫 ' + out.route.best.p.name + ' 期望 HF ' + fmt(out.route.best.hf, 3) + '，你跑的計畫 ' + plan.name + ' 為 ' + fmt(out.route.mine, 3), drill:DRILL['路線']});
  }
  out.items.sort((a, b) => b.dHF - a.dHF);
  return out;
}
function scoreFace(run, plan, R, tot){
  const exp = expectedByTarget(R, plan), res = {rows:[], groups:{}, totals:null};
  if(run.scoreMode === 'target' && perTargetFilled(run)){
    const pt = run.perTarget || {};
    scoredTargets().forEach(o => {
      const e = exp[o.id], a = targetPts(o, pt[o.id]);
      if(!e || a == null) return;
      const loss = e.pts - a;
      res.rows.push({o, e, a, loss});
      const key = BAND_TXT[e.band] + '、' + EXPO_TXT[e.expo] + '、' + STOP_TXT[e.stopType];
      const g = res.groups[key] || (res.groups[key] = {n:0, a:0, e:0, max:0}); g.n++; g.a += a; g.e += e.pts; g.max += 5 * e.n;
    });
    res.rows.sort((x, y) => y.loss - x.loss);
  }else{
    const e = {A:0, C:0, D:0, M:0, NS:0, n:0};
    Object.values(exp).forEach(x => { ['A','C','D','M','NS'].forEach(k => e[k] += x[k]); e.n += x.n; });
    const hits = tot.A + tot.C + tot.D + tot.M;
    res.totals = {e, hits};
  }
  return res;
}
function routeFace(run, plan, comp){
  const ps = plans(); if(!ps.length) return null;
  const P = runParams(run);
  const ev = ps.map(p => ({p, hf:evalWith(P, p).eHF}));
  const mine = (ev.find(x => x.p.id === plan.id) || {hf:0}).hf;
  const best = ev.slice().sort((a, b) => b.hf - a.hf)[0];
  let compRoute = null;
  if(comp && comp.planId && comp.planId !== plan.id){ const x = ev.find(e => e.p.id === comp.planId); if(x) compRoute = x; }
  return {ev, mine, best, compRoute};
}
function renderScoreInput(box, run){
  box.appendChild(row(selField('成績輸入方式', [['total','只輸入總計'],['target','逐靶輸入']], run.scoreMode || 'total', v => { run.scoreMode = v; runsChanged(); })));
  const sc = run.score = Object.assign({A:0, C:0, D:0, M:0, NS:0, PE:0}, run.score || {});
  if(run.scoreMode !== 'target'){
    const f = (k, lab) => numField(lab, sc[k], 1, v => { sc[k] = v == null ? 0 : v; runsChanged(); }, '1');
    box.appendChild(row(f('A', 'A'), f('C', 'C'), f('D', 'D'), f('M', '脫靶'), f('NS', '誤中 NS'), f('PE', '程序罰則')));
    return;
  }
  run.perTarget = run.perTarget || {};
  const ul = el('ul', {class:'vislist'});
  const small = (x, k, lab) => { const i = el('input', {type:'number', min:'0', step:'1', 'aria-label':lab, title:lab}); i.style.width = '44px'; i.value = x[k] != null ? x[k] : ''; i.placeholder = lab; i.addEventListener('change', () => { const v = parseFloat(i.value); if(isNaN(v)) delete x[k]; else x[k] = v; runsChanged(); }); return i; };
  scoredTargets().forEach(o => {
    const x = run.perTarget[o.id] || (run.perTarget[o.id] = {});
    const li = el('li', null, el('span', {class:'tl', text:o.label}));
    if(o.type === 'paper'){
      [['A','A'],['C','C'],['D','D'],['M','脫'],['NS','NS']].forEach(([k, lab]) => { li.appendChild(el('span', {class:'dt', text:lab})); li.appendChild(small(x, k, lab)); });
    }else{
      const s = el('select', {'aria-label':o.label + ' 結果'}); s.style.width = 'auto';
      [['','未輸入'],['1','倒下'],['0','未倒（脫靶）']].forEach(([v, t]) => s.appendChild(el('option', {value:v, text:t})));
      s.value = x.down == null ? '' : String(x.down);
      s.addEventListener('change', () => { if(s.value === '') delete x.down; else x.down = +s.value; runsChanged(); });
      li.appendChild(el('span', {class:'dt', text:kindLabel(o)})); li.appendChild(s);
    }
    ul.appendChild(li);
  });
  box.appendChild(ul);
  box.appendChild(numField('程序罰則', sc.PE, 1, v => { sc.PE = v == null ? 0 : v; runsChanged(); }, '1'));
  const t = runTotals(run);
  box.appendChild(el('div', {class:'help', text:'逐靶合計：A ' + t.A + '、C ' + t.C + '、D ' + t.D + '、脫靶 ' + t.M + '、誤中 NS ' + t.NS + '（鋼靶與 Falling Plate 倒下計為 A 區 5 分）。誤中 no-shoot 請記在它所遮擋的紙靶那一列。'}));
}
function renderDiagnosis(box, run, plan, R, rows){
  const D = diagnose(run, plan, R, rows);
  const d = el('div', {class:'props'});
  d.appendChild(el('h3', {text:'弱項報告：' + shooterName(runShooter(run))}));
  const others = runs().filter(r => r !== run);
  d.appendChild(selField('對照對象', [['', '自動（標竿射手最新的實測，沒有就用標竿的參數預測）'], ['model', '標竿的參數預測']].concat(others.map(r => [r.id, shooterName(runShooter(r)) + '：' + (r.date || '') + ' ' + (r.name || '')])), run.compId || '', v => { run.compId = v || null; runsChanged(); }));
  const myHF = D.T > 0 ? D.P / D.T : 0;
  d.appendChild(el('div', {class:'readout', text:'你：' + fmt(D.T) + ' 秒、' + (D.hasScore ? fmt(D.P, 0) + ' 分、HF ' + fmt(myHF, 3) : '未輸入成績（以模型期望 ' + fmt(D.P, 1) + ' 分估算 HF ' + fmt(myHF, 3) + '）')}));
  if(D.comp) d.appendChild(el('div', {class:'readout', text:'對照：' + D.comp.name + '：' + fmt(D.comp.T) + ' 秒' + (D.comp.P != null ? '、' + fmt(D.comp.P, D.comp.model ? 1 : 0) + ' 分、HF ' + fmt(D.comp.HF, 3) : '')}));
  else d.appendChild(el('p', {class:'help', text:'尚未設定標竿射手，也沒有其他射手的實測，時間面只能看下方與你自己模型的差距。'}));
  const weak = D.items.filter(x => x.dHF > 0.001), strong = D.items.filter(x => x.dHF < -0.001);
  if(weak.length){
    d.appendChild(el('div', {class:'kind', text:'弱項排序（依對 hit factor 的影響）'}));
    const ol = el('ol', {class:'summ'}); ol.style.cssText = 'padding-left:20px;list-style:decimal';
    weak.forEach(x => ol.appendChild(el('li', null, el('b', {text:x.name + '：HF −' + fmt(x.dHF, 3)}), document.createTextNode('。' + x.detail + '。建議練習：' + x.drill))));
    d.appendChild(ol);
  }else d.appendChild(el('p', {class:'help', text:'沒有找到明顯的弱項。'}));
  if(strong.length){
    const ul = el('ul', {class:'summ'});
    strong.forEach(x => { const li = el('li', {text:x.name + '：比對照好，HF +' + fmt(-x.dHF, 3) + '。' + x.detail}); li.style.color = 'var(--ok)'; ul.appendChild(li); });
    d.appendChild(el('div', {class:'kind', text:'強項'})); d.appendChild(ul);
  }
  // scoring face details
  if(D.score){
    if(D.score.rows.length){
      d.appendChild(el('div', {class:'kind', text:'得分面：逐靶（實際得分與模型期望）'}));
      const ul = el('ul', {class:'summ'});
      D.score.rows.slice(0, 8).forEach(r => {
        const li = el('li', {text:r.o.label + '（' + BAND_TXT[r.e.band] + '、' + EXPO_TXT[r.e.expo] + '、S' + (r.e.stop + 1) + ' ' + STOP_TXT[r.e.stopType] + '）：實際 ' + r.a + ' 分，期望 ' + fmt(r.e.pts, 1) + ' 分，' + (r.loss >= 0 ? '少 ' : '多 ') + fmt(Math.abs(r.loss), 1) + ' 分'});
        if(r.loss > 2) li.style.color = 'var(--tape)'; else if(r.loss < -0.5) li.style.color = 'var(--ok)';
        ul.appendChild(li);
      });
      d.appendChild(ul);
      const gs = Object.entries(D.score.groups).map(([k, g]) => ({k, g, loss:g.e - g.a})).sort((a, b) => b.loss - a.loss);
      if(gs.length > 1){
        d.appendChild(el('div', {class:'kind', text:'得分面：依射擊條件（距離、遮蔽、停頓類型）'}));
        const u2 = el('ul', {class:'summ'});
        gs.forEach(x => u2.appendChild(el('li', {text:x.k + '（' + x.g.n + ' 靶）：實際 ' + x.g.a + ' ／ ' + x.g.max + ' 分，期望 ' + fmt(x.g.e, 1) + ' 分，' + (x.loss >= 0 ? '少 ' : '多 ') + fmt(Math.abs(x.loss), 1) + ' 分'})));
        d.appendChild(u2);
      }
    }else if(D.score.totals){
      const e = D.score.totals.e, t = runTotals(run), n = Math.max(1, e.n), h = Math.max(1, t.A + t.C + t.D + t.M);
      d.appendChild(el('div', {class:'kind', text:'得分面：總計（比例與模型期望比較）'}));
      d.appendChild(el('div', {class:'readout', text:'A 區 ' + fmt(t.A / h * 100, 0) + '%（期望 ' + fmt(e.A / n * 100, 0) + '%）、C ' + fmt(t.C / h * 100, 0) + '%（' + fmt(e.C / n * 100, 0) + '%）、D ' + fmt(t.D / h * 100, 0) + '%（' + fmt(e.D / n * 100, 0) + '%）、脫靶 ' + t.M + ' 發（期望 ' + fmt(e.M, 1) + '）、誤中 NS ' + t.NS + ' 發（期望 ' + fmt(e.NS, 1) + '）'}));
      d.appendChild(el('p', {class:'help', text:'只有總計時無法指出是哪一種距離或遮蔽的靶丟分；改用逐靶輸入可以得到更細的分析。'}));
    }
  }
  // route face details
  if(D.route && D.route.ev.length > 1){
    d.appendChild(el('div', {class:'kind', text:'路線面：用' + shooterName(runShooter(run)) + '的參數比較各條路線（期望 HF）'}));
    const ul = el('ul', {class:'summ'});
    D.route.ev.slice().sort((a, b) => b.hf - a.hf).forEach(x => ul.appendChild(el('li', {text:'計畫 ' + x.p.name + (x.p.id === plan.id ? '（實際跑的）' : '') + (D.route.compRoute && D.route.compRoute.p.id === x.p.id ? '（對照射手跑的）' : '') + '：' + fmt(x.hf, 3)})));
    d.appendChild(ul);
  }
  D.notes.forEach(n => d.appendChild(el('p', {class:'help', text:n})));
  d.appendChild(el('p', {class:'help', text:'影響的算法：時間差用你的得分換算（得分 ÷ 縮短後的時間 − 目前 HF），得分差用你的時間換算（分數差 ÷ 你的時間），路線差為同一套參數下兩條路線的期望 HF 差。單一次紀錄雜訊大，請累積多次再下結論。'}));
  box.appendChild(d);
}
function copyPlanAsActual(run, plan){
  const c = clone(plan); c.id = uid(); c.name = plan.name + ' 實際' + (run.name ? '（' + run.name + '）' : ''); c.stops.forEach(s => s.id = uid()); c.overrides = {};
  plans().push(c); run.planId = c.id; activePlanId = c.id;
  const sp = $('secPlan'); if(sp) sp.open = true;
  planChanged();
  alert('已建立計畫「' + c.name + '」並設為這筆實測的路線。請切到「規劃」模式，在「路線計畫與換匣」調整成你實際的停頓點與射擊順序；修改後槍數若改變，會自動重新對位。');
}

/* ---------- phase 4: measured times ---------- */
let runSel = null, runImp = null, runPaste = '', replayPlanOverride = null;
const RUN_SRC = [['paste','手動貼上'],['video','影片量測'],['other','其他']];
const runSrc = v => RUN_SRC.some(x => x[0] === v) ? v : 'other';
function runs(){ if(!Array.isArray(stage.runs)) stage.runs = []; return stage.runs; }
function activeRun(){ const rs = runs(); return rs.find(r => r.id === runSel) || rs[rs.length - 1] || null; }
function runsChanged(){ saveStage(); renderRunsPanel(); }
const sgn = x => (x >= 0 ? '+' : '−') + fmt(Math.abs(x));
function gapColor(d, base){ const r = Math.abs(d) / Math.max(0.3, base); return r < 0.15 ? 'var(--ok)' : r < 0.4 ? 'var(--warn)' : 'var(--tape)'; }

/* --- parsing --- */
function splitLine(line){
  if(line.indexOf('\t') >= 0) return line.split('\t');
  if(line.indexOf(';') >= 0) return line.split(';');
  if(line.indexOf(',') >= 0) return line.split(',');
  return line.trim().split(/\s+/);
}
function parseTime(s){
  if(s == null) return NaN;
  s = String(s).trim().replace(/[()\[\]]/g, '').replace(/\s*(s|sec)$/i, '');
  const m = s.match(/^(\d+):(\d+(?:\.\d+)?)$/); if(m) return +m[1] * 60 + +m[2];
  return /^-?\d+(\.\d+)?$/.test(s) ? parseFloat(s) : NaN;
}
function parseRunText(text){
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const rows = lines.map(l => splitLine(l).map(c => c.trim().replace(/^"|"$/g, '')));
  let header = null, body = rows;
  const numCells = r => r.filter(c => !isNaN(parseTime(c))).length;
  if(rows.length > 1 && numCells(rows[0]) === 0 && rows.slice(1).some(r => numCells(r) > 0)){ header = rows[0]; body = rows.slice(1); }
  body = body.filter(r => numCells(r) > 0);
  return {header, body};
}
function autoCol(header, body){
  const nc = Math.max(1, ...body.map(r => r.length));
  const numeric = c => body.filter(r => !isNaN(parseTime(r[c]))).length;
  const cands = []; for(let c = 0; c < nc; c++) if(numeric(c) >= Math.max(1, body.length * 0.6)) cands.push(c);
  if(!cands.length) return 0;
  if(header){
    const h = c => (header[c] || '').toLowerCase();
    let c = cands.find(c => /(cum|total|elapsed|shot ?time|^time|time$|時間)/.test(h(c)) && !/split/.test(h(c)));
    if(c != null) return c;
    c = cands.find(c => /split|間隔/.test(h(c))); if(c != null) return c;
  }
  const isIdx = c => body.every((r, i) => { const v = parseTime(r[c]); return Math.abs(v - (i + 1)) < 1e-9 || Math.abs(v - i) < 1e-9; });
  const inc = cands.find(c => !isIdx(c) && body.every((r, i) => i === 0 || parseTime(r[c]) > parseTime(body[i - 1][c])));
  if(inc != null) return inc;
  const non = cands.find(c => !isIdx(c)); return non != null ? non : cands[0];
}
function newImport(text, source){
  const p = parseRunText(text);
  if(!p.body.length) return null;
  return {header:p.header, body:p.body, col:autoCol(p.header, p.body), kind:'auto', unit:'auto', source, name:'', date:new Date().toISOString().slice(0, 10), planId:stage.myPlanId || (activePlan() ? activePlan().id : '')};
}
function extractTimes(imp){
  let v = imp.body.map(r => parseTime(r[imp.col])).filter(x => !isNaN(x));
  let unit = imp.unit;
  if(unit === 'auto') unit = v.length && v.every(x => x >= 50 && Number.isInteger(x)) ? 'ms' : 's';
  if(unit === 'ms') v = v.map(x => x / 1000);
  let kind = imp.kind;
  if(kind === 'auto') kind = v.length >= 2 && v.every((x, i) => i === 0 || x > v[i - 1]) ? 'cum' : 'int';
  let cum = v.slice();
  if(kind === 'int'){ cum = []; let s = 0; v.forEach(x => { s += x; cum.push(s); }); }
  return {cum, kind, unit};
}

/* --- alignment of measured shots to plan shots --- */
function alignShots(times, R){
  const n = times.length, m = R.shots.length;
  if(n === m) return times.map((_, i) => i);
  if(!m) return times.map(() => -1);
  const dtM = times.map((t, i) => Math.max(0.05, t - (i ? times[i - 1] : 0)));
  const dtP = R.shots.map(s => Math.max(0.05, s.dt));
  const EX = 0.9, SK = 1.3, INF = 1e9;
  const D = Array.from({length:n + 1}, () => new Float64Array(m + 1).fill(INF));
  const B = Array.from({length:n + 1}, () => new Int8Array(m + 1));
  D[0][0] = 0;
  for(let i = 0; i <= n; i++) for(let j = 0; j <= m; j++){
    const d = D[i][j]; if(d >= INF) continue;
    if(i < n && j < m){ const c = d + Math.abs(Math.log(dtM[i] / dtP[j])); if(c < D[i + 1][j + 1]){ D[i + 1][j + 1] = c; B[i + 1][j + 1] = 1; } }
    if(i < n){ const c = d + EX; if(c < D[i + 1][j]){ D[i + 1][j] = c; B[i + 1][j] = 2; } }
    if(j < m){ const c = d + SK; if(c < D[i][j + 1]){ D[i][j + 1] = c; B[i][j + 1] = 3; } }
  }
  const map = new Array(n).fill(-1);
  let i = n, j = m;
  while(i > 0 || j > 0){
    const b = B[i][j];
    if(b === 1){ map[i - 1] = j - 1; i--; j--; }
    else if(b === 2){ map[i - 1] = -1; i--; }
    else if(b === 3){ j--; }
    else break;
  }
  return map;
}

/* --- comparison --- */
function runModel(run, plan){
  const f = () => computePlan(plan, {noMC:true, div:run.div && run.div !== PROFILE.division ? run.div : null});
  return runShooter(run) === SHOOTERS.activeId ? f() : withProfile(runParams(run), f);
}
function compareRun(run, R){
  const t = run.times, rows = [];
  let pi = -1, pj = -1;
  const cumP = j => j < 0 ? 0 : R.shots[j].t;
  (run.map || []).forEach((j, i) => {
    if(j == null || j < 0 || j >= R.shots.length || i >= t.length) return;
    const meas = t[i] - (pi < 0 ? 0 : t[pi]), model = cumP(j) - cumP(pj);
    const extras = Math.max(0, i - pi - 1), skipped = Math.max(0, j - pj - 1);
    rows.push({i, j, pj, shot:R.shots[j], meas, model, diff:meas - model, extras, skipped, clean:extras === 0 && skipped === 0, tAbs:t[i]});
    pi = i; pj = j;
  });
  return rows;
}
function kindGroup(s){ return s.reloadT > 0.05 ? '換匣' : s.kind.indexOf('換靶') === 0 ? '換靶' : s.kind === '起始' ? '第一槍（起始）' : s.kind === '同靶' ? '同靶 split' : '移動或換姿態後第一槍'; }
function stopCompare(run, R, plan){
  const res = [];
  const lastIdx = plan.stops.map((_, k) => { let l = -1; R.shots.forEach((s, j) => { if(s.stop === k) l = j; }); return l; });
  const timeAt = j => { const i = run.map.indexOf(j); return i >= 0 && i < run.times.length ? run.times[i] : null; };
  let prevM = 0, prevP = 0, ok = true;
  plan.stops.forEach((st, k) => {
    const j = lastIdx[k]; if(j < 0){ return; }
    const tm = timeAt(j);
    if(tm == null || !ok){ ok = tm != null; if(tm != null){ prevM = tm; prevP = R.shots[j].t; } return; }
    res.push({k, meas:tm - prevM, model:R.shots[j].t - prevP});
    prevM = tm; prevP = R.shots[j].t;
  });
  return res;
}
function calibSuggest(rows, R){
  const T = PROFILE.time, out = [];
  for(let b = 0; b < 4; b++){
    const xs = rows.filter(r => r.clean && r.shot.kind === '同靶' && r.shot.band === b && !r.shot.overridden).map(r => r.meas - (r.model - T.split[b]));
    if(xs.length) out.push({key:'split.' + b, label:'同靶 split（' + ['5 公尺內','5 到 8 公尺','8 到 10 公尺','10 公尺以上'][b] + '）', cur:T.split[b], sug:xs.reduce((a, x) => a + x, 0) / xs.length, n:xs.length});
  }
  const f = rows.find(r => r.i === 0 && r.clean && r.shot.kind === '起始' && r.shot.parts.move < 0.001 && r.shot.parts.wait < 0.001 && !r.shot.overridden);
  if(f){ const key = stage.startCond.gunLoc === 'holster' ? 'startHolster' : 'startPickup'; out.push({key, label:key === 'startHolster' ? '出槍到第一槍（槍在槍套）' : '取槍到第一槍（槍在物件上）', cur:T[key], sug:T[key] + f.diff, n:1}); }
  return out.filter(x => x.sug > 0.05 && x.sug < 5);
}
function measuredPlanClone(run, plan, R, rows){
  const cp = clone(plan); cp.id = uid(); cp.name = plan.name + ' 實測'; cp.overrides = {};
  rows.forEach(r => {
    const from = r.pj + 1, to = r.j; let sum = 0;
    for(let k = from; k <= to; k++) sum += Math.max(0.01, R.shots[k].dt);
    for(let k = from; k <= to; k++) cp.overrides[k] = r.meas * Math.max(0.01, R.shots[k].dt) / (sum || 1);
  });
  return cp;
}
function runScore(run){ const s = runTotals(run); return 5*(+s.A || 0) + 3*(+s.C || 0) + (+s.D || 0) - 10*(+s.M || 0) - 10*(+s.NS || 0) - 10*(+s.PE || 0); }

/* --- UI --- */
function renderRunImport(box){
  const ta = el('textarea', {rows:'5', placeholder:'貼上逐槍時間：每行一個時間，或從 Excel 複製的多欄資料。支援秒、毫秒、m:ss.xx。'});
  ta.value = runPaste;
  ta.addEventListener('input', () => { runPaste = ta.value; });
  box.appendChild(ta);
  box.appendChild(el('div', {class:'btns'},
    el('button', {class:'primary', text:'解析貼上的內容', onclick:() => {
      const imp = newImport(runPaste, 'paste');
      if(!imp){ alert('找不到可用的時間資料，請確認內容含有數字。'); return; }
      runImp = imp; renderRunsPanel();
    }}),
    runImp ? el('button', {text:'取消匯入', onclick:() => { runImp = null; renderRunsPanel(); }}) : null));
  if(!runImp) return;
  const imp = runImp, nc = Math.max(1, ...imp.body.map(r => r.length));
  const colName = c => (imp.header && imp.header[c] ? imp.header[c] : '第 ' + (c + 1) + ' 欄');
  const cols = Array.from({length:nc}, (_, c) => [String(c), colName(c)]);
  const pv = el('div', {class:'readout'});
  pv.style.overflowX = 'auto';
  const tbl = el('table', {style:'border-collapse:collapse;font-size:12px'});
  const mk = (cells, head) => { const tr = el('tr'); cells.forEach(c => { const td = el(head ? 'th' : 'td', {text:c}); td.style.cssText = 'border:1px solid var(--line);padding:2px 6px;text-align:left'; tr.appendChild(td); }); return tr; };
  if(imp.header) tbl.appendChild(mk(Array.from({length:nc}, (_, c) => imp.header[c] || ''), true));
  imp.body.slice(0, 6).forEach(r => tbl.appendChild(mk(Array.from({length:nc}, (_, c) => r[c] || ''))));
  pv.appendChild(tbl);
  if(imp.body.length > 6) pv.appendChild(el('div', {class:'help', text:'（只預覽前 6 列，共 ' + imp.body.length + ' 列）'}));
  box.appendChild(pv);
  box.appendChild(row(
    selField('時間所在欄位', cols, String(imp.col), v => { imp.col = +v; renderRunsPanel(); }),
    selField('欄位內容', [['auto','自動判斷'],['cum','累計時間（從起始嗶聲算起）'],['int','每槍間隔（split）']], imp.kind, v => { imp.kind = v; renderRunsPanel(); }),
    selField('單位', [['auto','自動判斷'],['s','秒'],['ms','毫秒']], imp.unit, v => { imp.unit = v; renderRunsPanel(); })));
  const ex = extractTimes(imp);
  if(!ex.cum.length){ box.appendChild(warn('用這個欄位解析不出時間，請換一個欄位。')); return; }
  const dts = ex.cum.map((t, i) => t - (i ? ex.cum[i - 1] : 0));
  box.appendChild(el('div', {class:'readout', text:'解析結果：' + ex.cum.length + ' 槍，' + (ex.kind === 'cum' ? '視為累計時間' : '視為每槍間隔') + '，總時間 ' + fmt(ex.cum[ex.cum.length - 1]) + ' 秒'}));
  box.appendChild(el('div', {class:'help', text:'各槍間隔：' + dts.map(x => fmt(x)).join('、')}));
  if(dts.some(x => x < 0)) box.appendChild(warn('出現負的間隔，代表累計時間並非遞增，請把欄位內容改成「每槍間隔」或換欄位。'));
  const nm = el('input', {type:'text', placeholder:'例如：9/29 練習第 3 次'}); nm.value = imp.name || '';
  nm.addEventListener('input', () => { imp.name = nm.value; });
  const dt = el('input', {type:'date'}); dt.value = imp.date || ''; dt.addEventListener('input', () => { imp.date = dt.value; });
  const ps = plans();
  box.appendChild(row(el('div', null, el('label', {class:'f', text:'名稱'}), nm), el('div', null, el('label', {class:'f', text:'日期'}), dt)));
  box.appendChild(row(
    selField('對應的路線計畫', [['', '（不對應計畫）']].concat(ps.map(p => [p.id, '計畫 ' + p.name])), imp.planId || '', v => { imp.planId = v; }),
    selField('資料來源', RUN_SRC, imp.source, v => { imp.source = v; })));
  box.appendChild(el('div', {class:'btns'}, el('button', {class:'primary', text:'建立實測紀錄', onclick:() => {
    const plan = ps.find(p => p.id === imp.planId) || null;
    const run = {id:uid(), name:imp.name || ('實測 ' + (runs().length + 1)), date:imp.date, planId:plan ? plan.id : null, source:imp.source, div:PROFILE.division, shooterId:SHOOTERS.activeId, times:ex.cum.map(x => Math.round(x * 1000) / 1000), map:[], score:{A:0, C:0, D:0, M:0, NS:0, PE:0}, note:''};
    run.map = plan ? alignShots(run.times, runModel(run, plan)) : run.times.map(() => -1);
    runs().push(run); runSel = run.id; runImp = null; runPaste = ''; runsChanged();
  }})));
}
function renderRunsPanel(){
  let box = $('runBox'); if(!box) return; box.innerHTML = '';
  if(typeof renderClipsPanel === 'function' && $('clipBox')) renderClipsPanel();
  const rvA = $('rvAlign'), rvR = $('rvReport');
  [rvA, rvR].forEach(x => { if(x) x.innerHTML = ''; });
  const note = t => [rvA, rvR].forEach(x => x && x.appendChild(el('p', {class:'help', text:t})));
  const rs = runs();
  const st = $('stRuns'); if(st) st.textContent = rs.length ? rs.length + ' 筆' : '';
  box.appendChild(el('p', {class:'help', text:'把逐槍時間（練習時的計時器、比賽影片逐格量測等）貼進來，和路線計畫的模型時間逐槍比對，找出哪一段實際比模型慢或快，並可回頭校正個人參數。時間以「從起始嗶聲算起的累計時間」為準；每槍間隔也能匯入，會自動換算。'}));
  renderRunImport(box);
  if(!rs.length){ note('尚無實測紀錄。在左側「實測時間與成績」貼上逐槍時間，建立第一筆紀錄。'); return; }
  const run = activeRun(); runSel = run.id;
  box.appendChild(el('div', {class:'kind', text:'實測紀錄'}));
  const sel = el('select', {'aria-label':'選擇實測紀錄'});
  rs.forEach(r => sel.appendChild(el('option', {value:r.id, text:shooterName(runShooter(r)) + '：' + (r.date || '') + ' ' + (r.name || '') + '（' + r.times.length + ' 槍，' + fmt(r.times[r.times.length - 1] || 0) + ' 秒）'})));
  sel.value = run.id; sel.addEventListener('change', () => { runSel = sel.value; renderRunsPanel(); });
  box.appendChild(sel);
  const nm = el('input', {type:'text'}); nm.value = run.name || ''; nm.addEventListener('change', () => { run.name = nm.value; runsChanged(); });
  const ps = plans();
  box.appendChild(row(el('div', null, el('label', {class:'f', text:'名稱'}), nm),
    selField('對應的路線計畫', [['', '（不對應計畫）']].concat(ps.map(p => [p.id, '計畫 ' + p.name])), run.planId || '', v => { run.planId = v || null; const p = ps.find(x => x.id === v); run.map = p ? alignShots(run.times, runModel(run, p)) : run.times.map(() => -1); runsChanged(); }),
    selField('資料來源', RUN_SRC, runSrc(run.source || 'paste'), v => { run.source = v; runsChanged(); })));
  box.appendChild(selField('射手（這筆是誰跑的；標竿射手的影片實測也可以輸入）', SHOOTERS.list.map(x => [x.id, x.name + (bench().baseId === x.id ? '（標竿）' : '')]), runShooter(run), v => { run.shooterId = v; run.mapN = -1; runsChanged(); }));
  const curPlan = ps.find(p => p.id === run.planId);
  if(curPlan) box.appendChild(el('div', {class:'btns'}, el('button', {text:'複製計畫 ' + curPlan.name + ' 作為實際路線，再調整', onclick:() => copyPlanAsActual(run, curPlan)})));
  // score
  const sc = run.score = Object.assign({A:0, C:0, D:0, M:0, NS:0, PE:0}, run.score || {});
  renderScoreInput(box, run);
  const total = run.times[run.times.length - 1] || 0, pts = runScore(run);
  box.appendChild(el('div', {class:'readout', text:'實測總時間 ' + fmt(total) + ' 秒；得分 ' + pts + ' 分；hit factor ' + fmt(total > 0 ? Math.max(0, pts) / total : 0, 4) + '（成績欄位可留 0，只看時間）'}));
  const plan = ps.find(p => p.id === run.planId) || null;
  if(!plan){
    note('這筆實測尚未對應路線計畫。在左側選一份計畫後，才能逐槍比對與產生弱項報告。');
    box.appendChild(el('p', {class:'help', text:'尚未對應路線計畫。選一份計畫後才能逐槍比對；目前只顯示各槍間隔。'}));
    const tl = el('ul', {class:'vislist'});
    run.times.forEach((t, i) => tl.appendChild(el('li', null, el('span', {class:'tl', text:'#' + (i + 1)}), el('span', {class:'dt', text:'累計 ' + fmt(t) + ' 秒，間隔 ' + fmt(t - (i ? run.times[i - 1] : 0)) + ' 秒'}))));
    box.appendChild(tl);
    box.appendChild(el('div', {class:'btns'}, el('button', {class:'danger', text:'刪除這筆實測', onclick:() => { if(confirm('刪除這筆實測紀錄？')){ stage.runs = rs.filter(r => r !== run); runSel = null; runsChanged(); } }})));
    return;
  }
  box.appendChild(el('div', {class:'btns'}, el('button', {class:'danger', text:'刪除這筆實測', onclick:() => { if(confirm('刪除這筆實測紀錄？')){ stage.runs = rs.filter(r => r !== run); runSel = null; runsChanged(); } }})));
  if(document.body.dataset.mode !== 'review'){ note('切到「檢討」模式時計算。'); return; }
  box = rvA;
  const R = runModel(run, plan);
  if(!Array.isArray(run.map) || run.map.length !== run.times.length || run.map.some(j => j >= R.shots.length) || (run.mapN != null && run.mapN !== R.shots.length)) run.map = alignShots(run.times, R);
  if(run.mapN !== R.shots.length){ run.mapN = R.shots.length; saveStage(); }
  const rows = compareRun(run, R), byI = new Map(rows.map(r => [r.i, r]));
  const dm = R.shots.length - run.times.length;
  if(run.div && run.div !== PROFILE.division) box.appendChild(warn('這筆紀錄是用 ' + divInfo(run.div).name + ' 組別記錄，目前選的是 ' + divInfo(PROFILE.division).name + '；比對仍以原組別的模型計算，套用參數建議前請先切回原組別。'));
  if(dm !== 0) box.appendChild(warn(dm > 0 ? '計畫有 ' + R.shots.length + ' 槍，實測只有 ' + run.times.length + ' 槍，少了 ' + dm + ' 槍；工具已自動推測略過哪幾槍，可在下方逐槍對位修改。' : '實測比計畫多 ' + (-dm) + ' 槍（計畫 ' + R.shots.length + ' 槍），多的視為補槍；可在下方逐槍對位修改。'));
  // summary
  const lastMatched = rows.length ? rows[rows.length - 1] : null;
  box.appendChild(el('div', {class:'kind', text:'總覽（實測 vs 計畫 ' + plan.name + ' 的模型）'}));
  const d = total - R.total;
  const ov = el('div', {class:'readout', text:'總時間：實測 ' + fmt(total) + ' 秒，模型 ' + fmt(R.total) + ' 秒，' + (d >= 0 ? '實測慢 ' : '實測快 ') + fmt(Math.abs(d)) + ' 秒'}); ov.style.color = gapColor(d, R.total * 0.2);
  box.appendChild(ov);
  if(total > 0 && run.map.some(x => x >= 0)) box.appendChild(el('div', {class:'readout', text:'期望得分（模型）' + fmt(R.ePts, 1) + ' 分，期望 hit factor ' + fmt(R.eHF, 3) + (pts ? '；實測 hit factor ' + fmt(Math.max(0, pts) / total, 3) : '')}));
  if(rows.length){
    const clean = rows.filter(r => r.clean);
    if(clean.length){
      const grp = {};
      clean.forEach(r => { const g = kindGroup(r.shot); (grp[g] = grp[g] || {n:0, m:0, p:0}); grp[g].n++; grp[g].m += r.meas; grp[g].p += r.model; });
      box.appendChild(el('div', {class:'kind', text:'依動作類型的平均差距（只計對位乾淨、沒有補槍或略過的槍）'}));
      const ul = el('ul', {class:'summ'});
      ['第一槍（起始）', '移動或換姿態後第一槍', '換靶', '換匣', '同靶 split'].filter(g => grp[g]).forEach(g => {
        const x = grp[g], dv = (x.m - x.p) / x.n, li = el('li', {text:g + '（' + x.n + ' 筆）：實測平均 ' + fmt(x.m / x.n) + ' 秒，模型 ' + fmt(x.p / x.n) + ' 秒，' + (dv >= 0 ? '慢 ' : '快 ') + fmt(Math.abs(dv)) + ' 秒'});
        li.style.color = gapColor(dv, x.p / x.n); ul.appendChild(li);
      });
      box.appendChild(ul);
    }
    const sc2 = stopCompare(run, R, plan);
    if(sc2.length){
      box.appendChild(el('div', {class:'kind', text:'各停頓點花費時間（從上一個停頓點打完最後一槍算起，含出位、移動與射擊）'}));
      const ul = el('ul', {class:'summ'});
      sc2.forEach(x => { const dv = x.meas - x.model, li = el('li', {text:'S' + (x.k + 1) + '：實測 ' + fmt(x.meas) + ' 秒，模型 ' + fmt(x.model) + ' 秒，' + (dv >= 0 ? '慢 ' : '快 ') + fmt(Math.abs(dv)) + ' 秒'}); li.style.color = gapColor(dv, x.model); ul.appendChild(li); });
      box.appendChild(ul);
    }
    const worst = rows.filter(r => r.clean).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, 5);
    if(worst.length){
      box.appendChild(el('div', {class:'kind', text:'差距最大的幾槍'}));
      const ul = el('ul', {class:'summ'});
      worst.forEach(r => ul.appendChild(el('li', {text:'計畫第 ' + (r.j + 1) + ' 槍（S' + (r.shot.stop + 1) + ' ' + r.shot.label + '，' + r.shot.kind + '）：實測 ' + fmt(r.meas) + ' 秒，模型 ' + fmt(r.model) + ' 秒，' + (r.diff >= 0 ? '慢 ' : '快 ') + fmt(Math.abs(r.diff)) + ' 秒' + (r.shot.why ? '（模型註記：' + r.shot.why + '）' : '')})));
      box.appendChild(ul);
    }
    const extraT = rows.filter(r => r.extras > 0).reduce((a, r) => a + r.meas, 0);
    if(rows.some(r => r.extras > 0)) box.appendChild(el('div', {class:'help', text:'含補槍的段落共 ' + rows.filter(r => r.extras > 0).length + ' 段，這幾段的實測時間包含補槍時間，未列入上面的平均與排名。'}));
    // calibration
    const cs = calibSuggest(rows, R);
    if(cs.length){
      box.appendChild(el('div', {class:'kind', text:'校正建議（依這筆實測反推個人參數）'}));
      const ul = el('ul', {class:'summ'});
      cs.forEach(x => {
        const li = el('li', {text:x.label + '：目前 ' + fmt(x.cur) + ' 秒 → 建議 ' + fmt(x.sug) + ' 秒（樣本 ' + x.n + ' 筆）　'});
        const b = el('button', {text:'套用', onclick:() => {
          if(runShooter(run) !== SHOOTERS.activeId){ alert('這筆是「' + shooterName(runShooter(run)) + '」的紀錄，請先在射手選單切換到該射手再套用。'); return; }
          if(run.div && run.div !== PROFILE.division){ alert('請先把組別切回 ' + divInfo(run.div).name + ' 再套用。'); return; }
          setPath(PROFILE.time, x.key, Math.round(x.sug * 100) / 100); PROFILE.measured['t.' + x.key] = today(); saveProfile(); renderParamBox(); planChanged();
        }});
        li.appendChild(b); ul.appendChild(li);
      });
      box.appendChild(ul);
      box.appendChild(el('p', {class:'help', text:'單一次練習的樣本很少，只有一兩筆的建議僅供參考；累積多次實測後再套用比較可靠。同靶 split 的建議已扣除遮蔽、鋼靶、no-shoot 等額外時間。'}));
    }
  }
  renderDiagnosis(rvR, run, plan, R, rows);
  // per-shot alignment
  box.appendChild(el('div', {class:'kind', text:'逐槍對位（左側為實測，右側選它對應計畫的第幾槍）'}));
  const maxDt = Math.max(0.5, ...run.times.map((t, i) => t - (i ? run.times[i - 1] : 0)), ...R.shots.map(s => s.dt));
  const tl = el('ul', {class:'vislist'});
  run.times.forEach((t, i) => {
    const dt = t - (i ? run.times[i - 1] : 0), r = byI.get(i);
    const s = el('select', {'aria-label':'對應計畫的第幾槍'}); s.style.width = 'auto';
    s.appendChild(el('option', {value:'-1', text:'補槍／不對應'}));
    R.shots.forEach((x, j) => s.appendChild(el('option', {value:String(j), text:'#' + (j + 1) + ' S' + (x.stop + 1) + ' ' + x.label})));
    s.value = String(run.map[i] != null ? run.map[i] : -1);
    s.addEventListener('change', () => { run.map[i] = +s.value; runsChanged(); });
    const tag = !r ? el('span', {class:'st none', text:'補槍'}) : r.clean ? el('span', {class:'st ' + (Math.abs(r.diff) / Math.max(0.3, r.model) < 0.15 ? 'full' : Math.abs(r.diff) / Math.max(0.3, r.model) < 0.4 ? 'part' : 'unsafe'), text:sgn(r.diff)}) : el('span', {class:'st post', text:'含補槍或略過'});
    const info = el('span', {class:'dt', text:'累計 ' + fmt(t) + '，間隔 ' + fmt(dt) + (r ? '；模型 ' + fmt(r.model) + '，' + r.shot.kind + (r.skipped ? '，略過計畫 ' + r.skipped + ' 槍' : '') + (r.extras ? '，含 ' + r.extras + ' 發補槍' : '') : '')});
    const bar = el('div'); bar.style.cssText = 'position:relative;height:6px;background:var(--line);border-radius:3px;margin-top:3px;flex:1';
    const bm = el('div'); bm.style.cssText = 'position:absolute;left:0;top:0;height:3px;background:#8A94A0;width:' + Math.min(100, (r ? r.model : 0) / maxDt * 100) + '%';
    const bx = el('div'); bx.style.cssText = 'position:absolute;left:0;top:3px;height:3px;background:var(--grid);width:' + Math.min(100, dt / maxDt * 100) + '%';
    bar.appendChild(bm); bar.appendChild(bx);
    const li = el('li', null, el('span', {class:'tl', text:'#' + (i + 1)}), tag, el('div', {style:'flex:1;min-width:0'}, info, bar), s);
    tl.appendChild(li);
  });
  box.appendChild(tl);
  box.appendChild(el('p', {class:'help', text:'長條：灰色為模型間隔，藍色為實測間隔。標籤數字為實測與模型的差（正數代表實測較慢）；綠色差距在 15% 內，橘色 15–40%，紅色 40% 以上。'}));
  // actions
  box.appendChild(el('div', {class:'btns'},
    el('button', {class:'primary', text:'用實測時間 3D 回放', onclick:() => { if(!rows.length){ alert('沒有對位成功的槍。'); return; } replayPlanOverride = measuredPlanClone(run, plan, R, rows); startReplay(); }}),
    el('button', {text:'聽我實際的節奏', onclick:() => { if(!rows.length){ alert('沒有對位成功的槍。'); return; } replayPlanOverride = measuredPlanClone(run, plan, R, rows); if(RP.on) startReplay(); rhythmDrill(); }}),
    el('button', {text:'把實測間隔寫入計畫的手動間隔', onclick:() => {
      const ok = rows.filter(r => r.skipped === 0);
      if(!ok.length){ alert('沒有可寫入的槍。'); return; }
      if(!confirm('把 ' + ok.length + ' 槍的實測間隔寫入計畫 ' + plan.name + ' 的手動指定間隔？之後該計畫的時間會以實測為準，可在計畫的逐槍時間軸清除。')) return;
      plan.overrides = plan.overrides || {}; ok.forEach(r => { plan.overrides[r.j] = Math.round(r.meas * 100) / 100; }); planChanged();
    }}),
    el('button', {text:'加入成績比對', onclick:() => { const tt = runTotals(run), isMe = runShooter(run) === SHOOTERS.activeId; results().push({id:uid(), kind:isMe ? 'mine' : bench().baseId === runShooter(run) ? 'best' : 'other', name:shooterName(runShooter(run)) + ' ' + (run.name || '實測'), time:Math.round(total * 100) / 100, A:tt.A, C:tt.C, D:tt.D, M:tt.M, NS:tt.NS, PE:tt.PE}); if(isMe) stage.myPlanId = plan.id; resultsChanged(); }}),
    el('button', {text:'重新自動對位', onclick:() => { run.map = alignShots(run.times, R); runsChanged(); }})));
}
