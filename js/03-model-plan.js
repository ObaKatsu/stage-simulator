'use strict';
/*! Stage 模擬器 — IPSC Action Air stage 規劃、回放與檢討
 *  Copyright (C) 2026 James
 *  SPDX-License-Identifier: GPL-3.0-or-later
 *  本程式為自由軟體：你可以依自由軟體基金會發布的 GNU 通用公共授權條款第 3 版，
 *  或（由你選擇）任何更新的版本，重新散布或修改本程式。本程式不提供任何保證，
 *  亦不保證適售性或特定目的適用性。完整條款見 LICENSE 或 <https://www.gnu.org/licenses/>。
 */
/* ---------- phase 3a: time & hit parameters (personal profile) ---------- */
// IPSC Action Air Handgun Rules Jan 2026, Appendix D (magazine capacity at the start signal)
const DIVISIONS = [
  {key:'OPEN', name:'Open', cap:28, optic:true, da:false},
  {key:'STANDARD', name:'Standard', cap:18, optic:false, da:false},
  {key:'PRODUCTION', name:'Production', cap:15, optic:false, da:true},
  {key:'PRODUCTION_OPTIC', name:'Production Optic', cap:15, optic:true, da:true},
  {key:'CLASSIC', name:'Classic', cap:10, optic:false, da:false}
];
const divInfo = k => DIVISIONS.find(d => d.key === k) || DIVISIONS[1];
const TP_DEFAULT = {
  daFirst:0,
  startHolster:1.20, startPickup:1.50, loadExtra:0.80, emptyChamber:0.30, uprange:0.40,
  split:[0.20, 0.25, 0.30, 0.35], expPen:{full:0, partial:0.05, heavy:0.10}, steelPen:0.03,
  trans:[0.25, 0.35, 0.50],
  nsPen:0.05,
  exitT:0.15, startCost:0.30, speed:3.0, entry:{full:0.35, rolling:0.15, move:0}, moveSplitPen:0.08,
  reloadStatic:1.20, reloadMove:1.00, windowOpen:0.50, oneHandMult:1.30, tunnelSpeed:0.45,
  climbUp:0.50, climbDown:0.40, sitDown:0.60, standUp:0.60, dismount:1.00, sitEye:0.78
};
const HP_DEFAULT = {
  paper:[{A:90,C:9,D:1,M:0},{A:80,C:15,D:3,M:2},{A:70,C:20,D:5,M:5},{A:60,C:25,D:7,M:8}],
  partial:{A:-10, M:2, NS:3}, heavy:{A:-20, M:5, NS:6},
  rolling:{A:-5, M:1}, move:{A:-15, M:4}, oneHand:{A:-10, M:3},
  steel:[98, 95, 90, 85], steelRolling:-2, steelMove:-6
};
const TP_LABELS = [
  ['startHolster','出槍到第一槍（槍在槍套）','s'],['daFirst','第一槍雙動作另加（Production 組別，外置擊錘）','s'],['startPickup','取槍到第一槍（槍在物件上）','s'],['loadExtra','CON3 另加入匣時間','s'],
  ['emptyChamber','CON2／CON3 另加上膛時間','s'],['uprange','背向靶擋起始另加轉身時間','s'],
  ['split.0','同靶 split：5 公尺內','s'],['split.1','同靶 split：5 到 8 公尺','s'],['split.2','同靶 split：8 到 10 公尺','s'],['split.3','同靶 split：10 公尺以上','s'],
  ['expPen.partial','部分遮蔽另加','s'],['expPen.heavy','嚴重遮蔽另加','s'],['steelPen','鋼靶、Falling Plate 另加','s'],['nsPen','有 no-shoot 的靶另加（精確瞄準）','s'],
  
  ['exitT','出位時間','s'],['startCost','起步成本','s'],['speed','行進速度','m/s'],['tunnelSpeed','礦工隧道內移動速度（一般速度的倍數）','×'],['climbUp','站上講台、橋、船（估計）','s'],['climbDown','走下講台、橋、船（估計）','s'],['sitDown','坐下或跨坐上去（估計）','s'],['standUp','從座位起身（估計）','s'],['dismount','下馬（估計）','s'],['sitEye','坐姿眼睛高於座面（估計）','m'],
  ['entry.full','進位：完全停頓','s'],['entry.rolling','進位：減速通過','s'],['entry.move','進位：移動中射擊','s'],['moveSplitPen','移動中射擊 split 另加','s'],
  ['reloadStatic','定點換匣','s'],['reloadMove','移動中換匣','s'],['windowOpen','開窗','s'],['oneHandMult','單手射擊 split 倍數','×']
];
function divDefaults(key){
  const d = divInfo(key), T = clone(TP_DEFAULT), H = clone(HP_DEFAULT);
  if(d.optic){ T.split[2] -= 0.02; T.split[3] -= 0.03; H.paper[2].A += 5; H.paper[2].C -= 5; H.paper[3].A += 7; H.paper[3].C -= 7; }
  if(key === 'OPEN' || key === 'STANDARD'){ T.reloadStatic = 1.10; T.reloadMove = 0.90; }
  if(d.da){ T.daFirst = 0.05; T.reloadStatic = 1.30; T.reloadMove = 1.10; }
  return {time:T, hit:H, measured:{}, load:d.cap};
}
function ensureProfileParams(){
  if(!PROFILE.division || (PROFILE.division === 'STANDARD' && !PROFILE.divisionChosen)) PROFILE.division = 'PRODUCTION_OPTIC';
  if(!PROFILE.byDiv){
    PROFILE.byDiv = {};
    DIVISIONS.forEach(d => {
      const dd = divDefaults(d.key);
      // carry over values the user already measured before divisions existed
      const m = PROFILE.measured || {};
      Object.keys(m).forEach(k => { if(!m[k]) return;
        if(k.startsWith('t.')){ const v = getPath(PROFILE.time || {}, k.slice(2)); if(v != null) setPath(dd.time, k.slice(2), v); }
        if(k.startsWith('h.paper.')){ const i = +k.split('.')[2]; if(PROFILE.hit && PROFILE.hit.paper) dd.hit.paper[i] = clone(PROFILE.hit.paper[i]); }
        dd.measured[k] = true; });
      PROFILE.byDiv[d.key] = dd;
    });
  }
  DIVISIONS.forEach(d => { if(!PROFILE.byDiv[d.key]) PROFILE.byDiv[d.key] = divDefaults(d.key); });
  bindDivision(PROFILE.division);
}
// PROFILE.time / hit / measured always point at the active division's parameters
function bindDivision(key){
  const b = PROFILE.byDiv[key];
  b.time = Object.assign(clone(TP_DEFAULT), b.time || {});
  ['split','trans'].forEach(k => { if(!Array.isArray(b.time[k])) b.time[k] = clone(TP_DEFAULT[k]); });
  ['expPen','entry'].forEach(k => { b.time[k] = Object.assign(clone(TP_DEFAULT[k]), b.time[k] || {}); });
  b.hit = Object.assign(clone(HP_DEFAULT), b.hit || {});
  b.measured = b.measured || {};
  if(!(b.load > 0)) b.load = divInfo(key).cap;
  PROFILE.time = b.time; PROFILE.hit = b.hit; PROFILE.measured = b.measured;
}
function withDivision(key, fn){
  const cur = PROFILE.division;
  PROFILE.division = key; bindDivision(key);
  try{ return fn(); } finally { PROFILE.division = cur; bindDivision(cur); }
}
function ensureProfileParamsOld(){
  PROFILE.time = Object.assign(clone(TP_DEFAULT), PROFILE.time || {});
  ['split','trans'].forEach(k => { if(!Array.isArray(PROFILE.time[k])) PROFILE.time[k] = clone(TP_DEFAULT[k]); });
  ['expPen','entry'].forEach(k => { PROFILE.time[k] = Object.assign(clone(TP_DEFAULT[k]), PROFILE.time[k] || {}); });
  PROFILE.hit = Object.assign(clone(HP_DEFAULT), PROFILE.hit || {});
  PROFILE.measured = PROFILE.measured || {};
}
const today = () => new Date().toISOString().slice(0, 10);
function mTag(k){ const m = PROFILE.measured[k]; return !m ? '・估' : typeof m === 'string' ? '・實測 ' + m : '・實測'; }
function getPath(o, p){ return p.split('.').reduce((a, k) => a == null ? a : a[k], o); }
function setPath(o, p, v){ const ks = p.split('.'), last = ks.pop(); const t = ks.reduce((a, k) => a[k], o); t[last] = v; }
function renderParamBox(){
  ensureProfileParams();
  const box = $('paramBox'); if(!box) return; box.innerHTML = '';
  box.appendChild(el('div', {class:'msg ok', text:'目前編輯：' + divInfo(PROFILE.division).name + ' 組別的參數。每個組別各有一套參數，切換組別請用上方的組別選單。'}));
  box.appendChild(el('p', {class:'help', text:'以下為個人時間與命中參數，除你修改過的項目外都是估計值（標「估」）。光學瞄具組別（Open、Production Optic）預設遠距較快、較準；Production 組別換匣預設較慢（不得加裝 magwell）。修改後會自動保存，並隨「匯出個人參數」一起匯出。'}));
  TP_LABELS.forEach(([k, lab, unit]) => {
    const v = getPath(PROFILE.time, k), est = !PROFILE.measured['t.' + k];
    box.appendChild(numField(lab + '（' + unit + '）' + mTag('t.' + k), v, 1, x => { if(x != null && x >= 0){ setPath(PROFILE.time, k, x); PROFILE.measured['t.' + k] = today(); saveProfile(); planChanged(); } }, '0.01'));
  });
  box.appendChild(el('div', {class:'kind', text:'紙靶命中分布（完全停頓、全露，百分比 A／C／D／脫靶）'}));
  ['5 公尺內','5 到 8 公尺','8 到 10 公尺','10 公尺以上'].forEach((lab, i) => {
    const h = PROFILE.hit.paper[i];
    box.appendChild(row(el('div', {class:'readout', text:lab + mTag('h.paper.' + i)}),
      ...['A','C','D','M'].map(z => numField(z === 'M' ? '脫靶' : z, h[z], 1, x => { if(x != null && x >= 0){ h[z] = x; PROFILE.measured['h.paper.' + i] = today(); saveProfile(); planChanged(); } }, '1'))));
  });
  box.appendChild(el('div', {class:'kind', text:'鋼靶與 Falling Plate 擊倒率（%）'}));
  box.appendChild(row(...['5 m 內','5–8 m','8–10 m','10 m 以上'].map((lab, i) => numField(lab, PROFILE.hit.steel[i], 1, x => { if(x != null && x >= 0 && x <= 100){ PROFILE.hit.steel[i] = x; saveProfile(); planChanged(); } }, '1'))));
  box.appendChild(el('p', {class:'help', text:'部分遮蔽、嚴重遮蔽、減速通過、移動中射擊與單手射擊，會依內建修正值降低 A 區比例、提高脫靶與誤中 no-shoot 的比例（估計值）。'}));
  box.appendChild(el('div', {class:'btns'}, el('button', {class:'danger', text:'重設為估計值', onclick:() => { if(confirm('把 ' + divInfo(PROFILE.division).name + ' 組別的時間與命中參數重設為估計值？')){ const load = PROFILE.byDiv[PROFILE.division].load; PROFILE.byDiv[PROFILE.division] = divDefaults(PROFILE.division); PROFILE.byDiv[PROFILE.division].load = load; bindDivision(PROFILE.division); saveProfile(); renderParamBox(); planChanged(); } }})));
}

/* ---------- phase 3a: plans ---------- */
let activePlanId = null;
function plans(){ if(!Array.isArray(stage.plans)) stage.plans = []; return stage.plans; }
function activePlan(){ return plans().find(p => p.id === activePlanId) || plans()[0] || null; }
function engageable(){ return stage.objects.filter(o => ['paper','popper','plate','stopplate'].includes(o.type)); }
function stopVP(st){ return {id:'__plan_' + st.id, type:'viewpoint', x:st.x, y:st.y, rot:normDeg((stage.safety.downDeg || 0) - 180), stance:st.stance || 'stand'}; }
function qual(r){ if(!r || r.status === 'unsafe' || r.status === 'back' || r.status === 'none') return 0; return r.exp - 0.08*(r.postureTime || 0); }
function nextPlanName(){ const used = plans().map(p => p.name); for(let i = 0; i < 26; i++){ const n = String.fromCharCode(65 + i); if(!used.includes(n)) return n; } return 'P' + (plans().length + 1); }
function buildPlan(points, name){
  const stops = points.map(pt => ({id:uid(), x:pt.x, y:pt.y, stance:pt.stance || 'stand', stopType:'full', reload:false, targets:[]}));
  const vis = stops.map(st => { const m = {}; computeVis(stopVP(st), {coarse:true}).forEach(r => m[r.id] = r); return m; });
  const unassigned = [];
  engageable().forEach(t => {
    let bi = -1, bq = 0;
    stops.forEach((st, j) => { const q = qual(vis[j][t.id]); if(q > bq + 1e-9 || (q > 0 && Math.abs(q - bq) < 1e-9 && bi < 0)){ bq = q; bi = j; } });
    if(t.type === 'stopplate'){ for(let j = stops.length - 1; j >= 0; j--) if(qual(vis[j][t.id]) > 0){ bi = j; break; } }
    if(bi < 0){ unassigned.push(t.id); return; }
    stops[bi].targets.push({id:t.id, n:t.type === 'paper' ? (t.hits || 2) : 1});
  });
  // left-to-right order inside each stop; stop plate always last
  stops.forEach((st, j) => {
    st.targets.sort((a, b) => (vis[j][a.id]?.bearing || 0) - (vis[j][b.id]?.bearing || 0));
    const sp = st.targets.findIndex(x => getObj(x.id)?.type === 'stopplate');
    if(sp >= 0){ const [x] = st.targets.splice(sp, 1); st.targets.push(x); }
  });
  return {id:uid(), name:name || nextPlanName(), stops, overrides:{}, unassigned};
}
let vpPick = null;   // {viewpointId: order} while choosing viewpoints for a new plan
function renderVpPicker(box){
  const vps = stage.objects.filter(o => o.type === 'viewpoint').sort((a, b) => String(a.label).localeCompare(String(b.label), 'zh-Hant', {numeric:true}));
  const d = el('div', {class:'props'});
  d.appendChild(el('h3', {text:'選擇這條路線的停頓點'}));
  if(!vps.length){ d.appendChild(el('p', {class:'help', text:'圖上尚無視點。'})); box.appendChild(d); return; }
  d.appendChild(el('p', {class:'help', text:'依序勾選視點，勾選的先後就是停頓順序。每條路線可以用不同的視點組合，不必刪除視點重來。'}));
  vpPick.__rev = vpPick.__rev || false;
  d.appendChild(selField('勾選方式', [['0','正推：先勾第一站'],['1','倒推：先勾最後一站（例如打 stop plate 的位置），再往回勾']], vpPick.__rev ? '1' : '0', v => { vpPick.__rev = v === '1'; renderPlanPanel(); }));
  const order0 = Object.keys(vpPick).filter(k => !k.startsWith('__')).sort((a, b) => vpPick[a] - vpPick[b]);
  const order = vpPick.__rev ? order0.slice().reverse() : order0;
  vps.forEach(v => {
    const i = order.indexOf(v.id);
    d.appendChild(chk(v.label + (i >= 0 ? '　→ 第 ' + (i + 1) + ' 站' + (vpPick.__rev ? '（倒數第 ' + (order.length - i) + ' 站）' : '') : '') + '（' + fmt(v.x, 1) + ', ' + fmt(v.y, 1) + '，' + POSTURE_NAME[v.stance || 'stand'] + '）', i >= 0, on => {
      if(on) vpPick[v.id] = Date.now() + Math.random(); else delete vpPick[v.id];
      renderPlanPanel();
    }));
  });
  d.appendChild(el('div', {class:'btns'},
    el('button', {class:'primary', text:'建立路線（' + order.length + ' 個停頓點）', onclick:() => {
      if(!order.length){ alert('請至少勾選一個視點。'); return; }
      const pts = order.map(id => getObj(id)).filter(Boolean).map(v => ({x:v.x, y:v.y, stance:v.stance === 'custom' ? 'stand' : v.stance}));
      vpPick = null;
      const p = buildPlan(pts); plans().push(p); activePlanId = p.id; planChanged(true);
      if(p.unassigned.length) alert('以下靶沒有任何停頓點可射擊，未排入計畫：' + p.unassigned.map(id => getObj(id)?.label).join('、'));
    }}),
    el('button', {text:'取消', onclick:() => { vpPick = null; renderPlanPanel(); }})));
  box.appendChild(d);
}
function newPlanFrom(source){
  let pts = [];
  { const n0 = plans().length; setTimeout(() => { if(plans().length > n0){ const sp = $('secPlan'); if(sp) sp.open = true; } }, 0); }   // show the new plan
  if(source === 'suggest'){
    if(!stopSuggest || stopSuggest.shown < 0){ alert('請先在「停頓點建議」選一個方案並按「在俯視圖顯示」。'); return; }
    if(suggestStale()){ alert('stage 的物件已經變動，這組停頓點建議已過期。請重新按「自動找停頓點建議」。'); renderSuggest(); return; }
    pts = stopSuggest.proposals[stopSuggest.shown].stops.map(s => ({x:s.p[0], y:s.p[1]}));
  }else{
    pts = stage.objects.filter(o => o.type === 'viewpoint').sort((a, b) => String(a.label).localeCompare(String(b.label), 'zh-Hant', {numeric:true})).map(v => ({x:v.x, y:v.y, stance:v.stance === 'custom' ? 'stand' : v.stance}));
    if(!pts.length){ alert('請先放置視點（依視點編號順序作為停頓順序）。'); return; }
  }
  const p = buildPlan(pts); plans().push(p); activePlanId = p.id; planChanged(true);
  if(p.unassigned.length) alert('以下靶沒有任何停頓點可射擊，未排入計畫：' + p.unassigned.map(id => getObj(id)?.label).join('、'));
}
/* drag a target row (by its handle) to change the shooting order, or onto another stop's list */
let planDrag = null;
function planDragStart(e, plan, k, j, li){
  if(e.button != null && e.button !== 0) return;
  e.preventDefault();
  try{ window.getSelection().removeAllRanges(); }catch(err){}
  const r = li.getBoundingClientRect();
  const ghost = li.cloneNode(true); ghost.classList.add('dragghost'); ghost.style.width = r.width + 'px';
  ghost.style.left = r.left + 'px'; ghost.style.top = r.top + 'px'; document.body.appendChild(ghost);
  li.classList.add('dragsrc'); document.body.classList.add('pdrag');
  planDrag = {plan, k, j, li, ghost, dy:e.clientY - r.top, dx:e.clientX - r.left, drop:null, id:e.pointerId};
  try{ e.target.setPointerCapture(e.pointerId); }catch(err){}
  const move = ev => planDragMove(ev), up = ev => { cleanup(); planDragEnd(true); }, cancel = () => { cleanup(); planDragEnd(false); };
  const key = ev => { if(ev.key === 'Escape'){ cleanup(); planDragEnd(false); } };
  const cleanup = () => { e.target.removeEventListener('pointermove', move); e.target.removeEventListener('pointerup', up); e.target.removeEventListener('pointercancel', cancel); document.removeEventListener('keydown', key); };
  e.target.addEventListener('pointermove', move); e.target.addEventListener('pointerup', up); e.target.addEventListener('pointercancel', cancel); document.addEventListener('keydown', key);
}
function planDragMove(ev){
  const D = planDrag; if(!D) return;
  D.ghost.style.left = (ev.clientX - D.dx) + 'px'; D.ghost.style.top = (ev.clientY - D.dy) + 'px';
  document.querySelectorAll('.tlist .dropbefore, .tlist .dropafter, .tlist.dropin').forEach(x => x.classList.remove('dropbefore', 'dropafter', 'dropin'));
  D.drop = null;
  const hit = document.elementFromPoint(ev.clientX, ev.clientY);
  const ul = hit && hit.closest ? (hit.closest('.tlist') || (hit.closest('.port') && hit.closest('.port').querySelector('.tlist'))) : null;
  if(ul){
    const k2 = +ul.dataset.stop, rows = [...ul.querySelectorAll(':scope > li')];
    let idx = rows.length;
    for(let i = 0; i < rows.length; i++){ const rr = rows[i].getBoundingClientRect(); if(ev.clientY < rr.top + rr.height / 2){ idx = i; break; } }
    if(rows.length === 0) ul.classList.add('dropin');
    else if(idx < rows.length) rows[idx].classList.add('dropbefore'); else rows[rows.length - 1].classList.add('dropafter');
    D.drop = {k:k2, idx};
  }
  // keep the list scrolling while dragging near the edges of the side column
  const side = document.querySelector('aside'), sr = side.getBoundingClientRect();
  if(ev.clientY < sr.top + 40) side.scrollTop -= 12; else if(ev.clientY > sr.bottom - 40) side.scrollTop += 12;
}
function planDragEnd(commit){
  const D = planDrag; planDrag = null; if(!D) return;
  D.ghost.remove(); D.li.classList.remove('dragsrc'); document.body.classList.remove('pdrag');
  document.querySelectorAll('.tlist .dropbefore, .tlist .dropafter, .tlist.dropin').forEach(x => x.classList.remove('dropbefore', 'dropafter', 'dropin'));
  if(!commit || !D.drop) return;
  const {plan} = D, src = plan.stops[D.k], dst = plan.stops[D.drop.k]; if(!src || !dst) return;
  let idx = D.drop.idx;
  if(src === dst){
    if(idx === D.j || idx === D.j + 1) return;   // dropped where it already was
    const [asg] = src.targets.splice(D.j, 1); if(idx > D.j) idx--; src.targets.splice(idx, 0, asg);
  }else{
    const asg = src.targets[D.j];
    if(!confirmAssign(D.drop.k, dst, [asg.id])) return;
    src.targets.splice(D.j, 1); dst.targets.splice(idx, 0, asg);
  }
  planChanged();
}
// can this stop actually shoot the target? used to warn when a target is moved to a stop that cannot see it
function visProblem(r){
  if(!r) return '無法判斷視線';
  if(r.status === 'unsafe') return '超出安全射擊角度，會判 DQ';
  if(r.status === 'back') return '在靶的背面';
  if(r.status === 'none') return r.manual ? '已手動設定為現場看不到' : '看不到' + (r.blockers ? '（被 ' + r.blockers.join('、') + ' 擋住）' : '');
  return null;
}
function visBadge(r){
  if(!r) return el('span', {class:'st none', text:'?'});
  if(r.manual) return el('span', {class:'st none', text:'看不到（手動）'});
  if(r.status === 'unsafe') return el('span', {class:'st unsafe', text:'DQ 角度'});
  if(r.status === 'back' || r.status === 'none') return el('span', {class:'st none', text:r.status === 'back' ? '背面' : '看不到'});
  if(r.nomStatus !== r.status && r.posture) return el('span', {class:'st post', title:'需' + r.posture, text:'需調整姿態'});
  return el('span', {class:'st ' + r.status, text:r.status === 'full' ? '全露' : '部分 ' + Math.round(r.exp * 100) + '%'});
}
function confirmAssign(stopIdx, st, ids){
  const vis = stopVisMemo(st);
  const bad = ids.map(id => ({o:getObj(id), why:visProblem(vis[id])})).filter(x => x.o && x.why);
  if(!bad.length) return true;
  const lines = bad.map(x => x.o.label + '：' + x.why).join('\n');
  return confirm('S' + (stopIdx + 1) + ' 無法射擊以下的靶：\n' + lines + '\n\n排進去會讓時間與得分計算失真，而且現場打不到。仍要排在 S' + (stopIdx + 1) + ' 嗎？');
}
// the active plan as it was when it was selected or last saved; edits can be kept or split off into a new plan
let planBase = null;
function syncPlanBase(plan){ if(!plan){ planBase = null; return; } if(!planBase || planBase.id !== plan.id) planBase = {id:plan.id, json:JSON.stringify(plan)}; }
function planModified(plan){ return !!(plan && planBase && planBase.id === plan.id && planBase.json !== JSON.stringify(plan)); }
function keepPlanEdits(){ const plan = activePlan(); if(plan) planBase = {id:plan.id, json:JSON.stringify(plan)}; renderPlanPanel(); }
function saveAsNewPlan(){
  const plan = activePlan(); if(!plan) return;
  if(pendingOrder) finishOrderPick();
  const c = clone(plan); c.id = uid(); c.name = nextPlanName(); c.stops.forEach(x => x.id = uid());
  const was = plan.name, reverted = planModified(plan);
  if(reverted){ const orig = JSON.parse(planBase.json); Object.keys(plan).forEach(k => delete plan[k]); Object.assign(plan, orig); }
  plans().push(c); activePlanId = c.id; planBase = {id:c.id, json:JSON.stringify(c)};
  planChanged();
  if(typeof toast === 'function') toast('已另存為計畫 ' + c.name + (reverted ? '；計畫 ' + was + ' 恢復修改前的樣子。' : '。'), null, null, 4000);
}
/* moving targets: lateral aiming error added by judging the lead */
const LEAD_JUDGE = 0.35;       // the lead actually held misses the needed lead by about this share (1 sd)
const TRIGGER_JITTER = 0.03;   // seconds of trigger timing scatter while the target moves
const AZONE_HALF = 0.035;      // half width of the A zone on a 30 cm Action Air target (approx., App. B2)
function erfFn(x){ const s = Math.sign(x), a = Math.abs(x), t = 1 / (1 + 0.3275911 * a); return s * (1 - (((((1.061405429*t - 1.453152027)*t) + 1.421413741)*t - 0.284496736)*t + 0.254829592)*t*Math.exp(-a*a)); }
function erfInv(y){ y = Math.min(0.999999, Math.max(-0.999999, y)); const a = 0.147, l = Math.log(1 - y*y), b = 2/(Math.PI*a) + l/2; return Math.sign(y) * Math.sqrt(Math.sqrt(b*b - l/a) - b); }
// widen a hit distribution by an extra sideways error sig (m): A inside +-aw, on paper inside +-w
function blurHd(hd, sig, w, aw){
  const on0 = Math.max(1e-4, 1 - hd.M - hd.NS), A0 = Math.max(1e-4, hd.A);
  const sA0 = aw / (Math.SQRT2 * erfInv(Math.min(0.9999, A0))), sO0 = w / (Math.SQRT2 * erfInv(Math.min(0.9999, on0)));
  const A = erfFn(aw / (Math.SQRT2 * Math.hypot(sA0, sig))), on = Math.min(on0, erfFn(w / (Math.SQRT2 * Math.hypot(sO0, sig))));
  const a2 = Math.min(A, on), cd = hd.C + hd.D, rest = Math.max(0, on - a2);
  const C = cd > 0 ? hd.C / cd * rest : rest, D = cd > 0 ? hd.D / cd * rest : 0;
  return {A:a2, C, D, M:hd.M + (on0 - on), NS:hd.NS};
}
function planChanged(persist){ planCache = null; if(typeof refreshReplayForPlan === 'function') refreshReplayForPlan(); renderPlanPanel(); if(typeof renderResultsPanel === 'function') renderResultsPanel(); if(typeof renderResultsPanel === 'function') renderResultsPanel(); renderViews(); if(persist !== false) saveStage(); }

/* ---------- phase 3a: time model ---------- */
let planCache = null;
function distBand(d){ return d <= 5 ? 0 : d <= 8 ? 1 : d <= 10 ? 2 : 3; }
// beep to first shot: a value set for this stage, or the shooter's draw / pick-up time plus the extras
function startParts(){
  const T = PROFILE.time, c = stage.startCond, out = [];
  out.push(c.gunLoc === 'holster' ? ['出槍（槍在身上）', T.startHolster] : ['取槍（槍在物件上）', T.startPickup]);
  if(c.ready === 'unloaded') out.push(['CON3 入匣', T.loadExtra], ['上膛', T.emptyChamber]);
  if(c.ready === 'emptyChamber') out.push(['CON2 上膛', T.emptyChamber]);
  if(c.facing === 'uprange') out.push(['背向靶擋轉身', T.uprange]);
  const rise = startRise(); if(rise) out.unshift([c.pose === 'straddle' ? '下馬' : '起身', rise]);
  if(divInfo(PROFILE.division).da && c.ready === 'loaded' && T.daFirst) out.push(['第一槍雙動作', T.daFirst]);
  return out;
}
// seated or straddling start that must get up before drawing (time in seconds, 0 when standing or shooting seated)
function startRise(){
  const c = stage.startCond, T = PROFILE.time;
  if(!c.pose || c.pose === 'stand' || c.after === 'stay') return 0;
  return c.pose === 'straddle' ? (T.dismount || 1.0) : (T.standUp || 0.6);
}
function startTimeAuto(){ return startParts().reduce((a, x) => a + (x[1] || 0), 0); }
function startTime(){
  const c = stage.startCond;
  if(c.firstShot != null && c.firstShot > 0) return c.firstShot;
  return startTimeAuto();
}
function hitDist(band, expo, stopType, oneHand, hasNS){
  const H = PROFILE.hit, b = Object.assign({NS:0}, H.paper[band]);
  const add = (m) => { if(!m) return; b.A += m.A || 0; b.M += m.M || 0; if(hasNS) b.NS += m.NS || 0; };
  if(expo !== 'full') add(H[expo]);
  if(stopType !== 'full') add(H[stopType]);
  if(oneHand) add(H.oneHand);
  b.A = Math.max(0, b.A);
  const tot = b.A + b.C + b.D + b.M + b.NS || 1;
  return {A:b.A/tot, C:b.C/tot, D:b.D/tot, M:b.M/tot, NS:b.NS/tot};
}
function steelP(band, stopType){ const H = PROFILE.hit; let p = H.steel[band]; if(stopType === 'rolling') p += H.steelRolling; if(stopType === 'move') p += H.steelMove; return Math.max(0, Math.min(100, p)) / 100; }
const VISMEMO = new Map();
function stopVisMemo(st){
  const key = JSON.stringify([st.x, st.y, st.stance, stage.safety, stage.flex, stage.plateCy, PROFILE.lean, PROFILE.postures]) + '|' + JSON.stringify(stage.objects);
  let v = VISMEMO.get(key);
  if(!v){ v = {}; computeVis(stopVP(st)).forEach(r => v[r.id] = r); if(VISMEMO.size > 300) VISMEMO.clear(); VISMEMO.set(key, v); }
  return v;
}
function computePlan(plan, opts){
  opts = opts || {};
  ensureProfileParams();
  if(opts.div && opts.div !== PROFILE.division) return withDivision(opts.div, () => computePlan(plan, Object.assign({}, opts, {div:null})));
  const rmode = opts.autoReload ? 'auto' : reloadMode(plan);
  if(rmode !== 'manual'){ plan = clone(plan); if(rmode === 'auto') applyAutoReloads(plan); else plan.stops.forEach(s => s.reload = false); }
  const reloadLog = [];
  const T = PROFILE.time, start = startObj();
  const load = PROFILE.byDiv[PROFILE.division].load;
  const topOff = stage.startCond.ready === 'loaded' ? 1 : 0;   // CON1: one extra round in the chamber
  let mag = load + topOff, reloads = 0;
  const shots = [], warnings = [];
  let t = 0, prev = start ? [start.x, start.y] : (plan.stops[0] ? [plan.stops[0].x, plan.stops[0].y] : [0, 0]);
  let prevStance = 'stand', idx = 0, sumShoot = 0, sumMove = 0, sumWait = 0;
  const tunnelRisk = [];  // tunnel crossings: slats passed and the chance to knock each one
  const shotTime = {};   // target id -> time of its last shot
  const hitTime = {};    // target id -> when the BB of its last shot arrives (activations start from the hit)
  plan.stops.forEach((st, k) => {
    const vis = stopVisMemo(st);
    const d = Math.hypot(st.x - prev[0], st.y - prev[1]);
    const moving = d > 0.3;
    let vEff = T.speed;
    if(moving && PROFILE.body && PROFILE.body.lateral3m){
      const dd = downDir(), sAng = Math.abs(((st.x - prev[0])*dd[1] - (st.y - prev[1])*dd[0]) / (d || 1));   // share of sideways movement
      const vl = 3 / Math.max(0.3, PROFILE.body.lateral3m - T.startCost);
      vEff = 1 / ((1 - sAng) / T.speed + sAng / vl);
    }
    // crossing a Cooper tunnel: slower (bent low) and every slat passed may be knocked down (1 PE each)
    let tunExtra = 0;
    if(moving) stage.objects.forEach(o => {
      if(o.type !== 'tunnel' || o.x1 == null) return;
      const ins = tunnelInside(o, prev, [st.x, st.y]); if(ins.len < 0.05) return;
      const f = Math.min(1, Math.max(0.1, T.tunnelSpeed || 0.45));
      tunExtra += ins.len / vEff * (1 / f - 1);
      tunnelRisk.push({tunnel:o.id, label:o.label, stop:k, n:ins.slats, p:o.knockP != null ? o.knockP : TUNNEL_DEF.knockP, idx:ins.idx, len:ins.len});
    });
    // stepping up onto / down from a podium, bridge or boat; getting up from a seat before leaving it
    let climb = 0;
    if(moving){
      const h0 = surfaceAt(prev[0], prev[1]), h1 = surfaceAt(st.x, st.y);
      if(h1 - h0 > 0.12){ climb += T.climbUp || 0.5; } else if(h0 - h1 > 0.12){ climb += T.climbDown || 0.4; }
      const pst = k > 0 ? plan.stops[k-1] : null;
      if(pst && pst.stance === 'sit'){ const s0 = seatAt(pst.x, pst.y); climb += s0 && s0.straddle ? (T.dismount || 1.0) : (T.standUp || 0.6); }
      if(k === 0) climb += startRise();
    }
    const travel = moving ? d / vEff + tunExtra + climb : 0;
    const moveT = moving ? (k > 0 ? T.exitT : 0) + T.startCost + travel : 0;
    let wait = 0; const waitWhy = [];
    let stopRl = null;
    if(st.reload){
      mag = load + (mag > 0 ? 1 : 0); reloads++;   // reloading before running dry keeps the chambered round
      const extra = moving ? Math.max(0, T.reloadMove - travel) : T.reloadStatic;
      if(extra > 0){ wait += extra; waitWhy.push('換匣 ' + fmt(extra) + ' 秒'); } else waitWhy.push('換匣隱藏在移動中');
      stopRl = {used:false, extra}; reloadLog.push({stop:k, extra, moving, forced:false});
    }
    const stance = st.stance || 'stand';
    if(stance === 'sit'){
      const se = seatAt(st.x, st.y), startSeated = k === 0 && !moving && stage.startCond.pose && stage.startCond.pose !== 'stand';
      if(!se) warnings.push('S' + (k+1) + ' 設為坐姿，但附近沒有椅子、船或馬');
      else if(!startSeated && !(k > 0 && !moving && plan.stops[k-1].stance === 'sit')){ wait += T.sitDown || 0.6; waitWhy.push((se.straddle ? '跨坐上去 ' : '坐下 ') + fmt(T.sitDown || 0.6) + ' 秒'); }
    }
    if(k === 0 && stage.startCond.after === 'stay' && stage.startCond.pose && stage.startCond.pose !== 'stand' && (stance !== 'sit' || moving)) warnings.push('起始條件為坐著射擊，但第一個停頓點不在座位上或姿勢不是坐姿');
    { const tn = inTunnel(st.x, st.y);
      if(tn){ const head = (PROFILE.postures[stance]?.eye || 1.6) + 0.12, hh = tn.h || TUNNEL_DEF.h;
        if(head > hh - 0.02) warnings.push('S' + (k+1) + ' 在 ' + tn.label + ' 礦工隧道內：' + POSTURE_NAME[stance] + '頭頂約 ' + Math.round(head*100) + ' 公分，高於隧道的 ' + Math.round(hh*100) + ' 公分，會撞落橫條；請改用較低的姿勢'); } }
    const postT = Math.max(0, (PROFILE.postures[stance]?.t || 0) - (!moving && prevStance === stance ? PROFILE.postures[stance]?.t || 0 : 0));
    if(postT > 0){ wait += postT; waitWhy.push(POSTURE_NAME[stance] + ' ' + fmt(postT) + ' 秒'); }
    if(st.targets.some(x => vis[x.id]?.needOpen)){ wait += T.windowOpen; waitWhy.push('開窗 ' + fmt(T.windowOpen) + ' 秒'); }
    const entry = T.entry[st.stopType] ?? T.entry.full;
    let prevTarget = null, firstAtStop = true;
    st.targets.forEach(asg => {
      const o = getObj(asg.id); if(!o) return;
      const r = vis[o.id];
      if(!r || r.status === 'none' || r.status === 'back'){ warnings.push('S' + (k+1) + ' 看不到 ' + o.label); }
      if(r && r.status === 'unsafe') warnings.push('S' + (k+1) + ' 射擊 ' + o.label + ' 超出安全射擊角度（DQ）');
      let extraPost = 0;
      if(r && r.nomStatus !== r.status && r.postureTime){ extraPost = r.postureTime; }
      if(r && r.nomStatus === 'none' && r.status !== 'none' && r.posture) warnings.push('S' + (k+1) + ' 打 ' + o.label + ' 需' + r.posture);
      const dist = r ? r.dist : Math.hypot(o.x - st.x, o.y - st.y), band = distBand(dist);
      const expRatio = r ? r.exp : 1, expo = expRatio >= 0.95 ? 'full' : expRatio >= 0.5 ? 'partial' : 'heavy';
      const steel = o.type !== 'paper', oneHand = !!(r && r.oneHand);
      const hasNS = stage.objects.some(n => n.type === 'noshoot' && n.cover === o.id);
      let sp = T.split[band] + (T.expPen[expo] || 0) + (steel ? T.steelPen : 0) + (st.stopType === 'move' ? T.moveSplitPen : 0) + (hasNS ? (T.nsPen || 0) : 0);
      if(oneHand) sp *= T.oneHandMult;

      const hd0 = steel ? null : hitDist(band, expo, st.stopType, oneHand, hasNS), pS = steel ? steelP(band, st.stopType) : null;
      const flight = bbFlight(dist);
      for(let s = 0; s < asg.n; s++){
        let hd = hd0, lead = null;
        let dt, kind, parts = {shoot:0, move:0, wait:0}, why = '';
        let emptyReload = 0;
        if(mag <= 0){ emptyReload = T.reloadStatic; mag = load; reloads++; reloadLog.push({stop:k, shot:idx, extra:T.reloadStatic, moving:false, forced:true}); if(rmode === 'manual') warnings.push('第 ' + (idx+1) + ' 槍前彈匣已空（每匣 ' + load + ' 發），模型自動加入定點換匣 ' + fmt(T.reloadStatic) + ' 秒；可把換匣安排改成「自動」，讓換匣排在移動中'); }
        if(firstAtStop){
          if(idx === 0){
            const st0 = startTime();
            dt = Math.max(st0, moveT + entry) + wait + extraPost;
            parts.move = moveT; parts.shoot = Math.max(st0 - moveT, entry); parts.wait = wait + extraPost;
            kind = '起始'; why = moving ? '邊移動邊出槍' : '';
          }else{
            dt = moveT + entry + wait + extraPost + T.split[band] * 0; parts.move = moveT; parts.shoot = entry; parts.wait = wait + extraPost;
            kind = moving ? '移動後第一槍' : '換姿態後第一槍';
          }
          firstAtStop = false;
        }else if(prevTarget !== o.id){
          const a = r && prevTarget && vis[prevTarget] ? Math.abs(normDeg(r.bearing - vis[prevTarget].bearing)) : 30;
          const sgn = r && prevTarget && vis[prevTarget] ? Math.sign(normDeg(r.bearing - vis[prevTarget].bearing)) : 1;
          dt = transTime(a, sgn, stance, sp - T.split[0]) + extraPost; parts.shoot = dt - extraPost; parts.wait = extraPost; kind = '換靶（' + Math.round(a) + '°）';
        }else{ dt = sp; parts.shoot = sp; kind = '同靶'; }
        if(emptyReload){ dt += emptyReload; parts.wait += emptyReload; why = '彈匣打空，定點換匣'; }
        mag--;
        // moving targets: wait for the visible window
        if(isMech(o) && s === 0){
          const m = o.mech; let A = 0;
          if(m.act.mode === 'object'){ const at = hitTime[m.act.id]; A = at != null ? at + (m.act.delay || 0) : null; if(A == null) warnings.push(o.label + ' 的啟動來源尚未在它之前射擊'); }
          if(A != null){
            const open = m.preVisible ? 0 : A + (m.winFrom || 0), close = m.winTo != null ? A + m.winTo : Infinity;
            const tShot = t + dt;
            if(tShot < open){ const w = open - tShot; dt += w; parts.wait += w; why = '等 ' + o.label + ' 出現 ' + fmt(w) + ' 秒'; }
            if(t + dt > close) warnings.push(o.label + ' 可能已錯過可見時間窗');
          }
        }
        // a swinging target moves while the BB is in the air: the lead the shooter has to judge adds lateral error
        if(!steel && isSwingPhys(o) && o.mech.act.mode !== 'none'){
          const m = o.mech, at = m.act.mode === 'start' ? 0 : hitTime[m.act.id], A = at != null ? at + (m.act.mode === 'start' ? 0 : (m.act.delay || 0)) : null;
          if(A != null){
            const rel = t + dt + flight - A, h = 0.005, om = rel > 0 ? Math.abs(swingAngle(m, rel + h) - swingAngle(m, Math.max(1e-6, rel - h))) / (2*h) : 0;
            const v = om * swingPar(m).rT, need = v * flight, sig = Math.hypot(LEAD_JUDGE * need, TRIGGER_JITTER * v);
            if(v > 0.05){ hd = blurHd(hd0, sig, targetSpec(o.size).w / 2, AZONE_HALF * targetSpec(o.size).w / 0.30); lead = {v, need, sig}; why = (why ? why + '；' : '') + o.label + ' 擺動中，需提前約 ' + Math.round(need * 100) + ' 公分'; }
          }
        }
        const ov = plan.overrides && plan.overrides[idx];
        if(ov != null){ const sc = ov / (dt || 1); parts.shoot *= sc; parts.move *= sc; parts.wait *= sc; dt = ov; }
        t += dt; sumShoot += parts.shoot; sumMove += parts.move; sumWait += parts.wait;
        const scored = o.type !== 'stopplate';   // stop plate is not scored (rule 4.3.3)
        const ep = !scored ? 0 : steel ? 5*pS - 10*(1 - pS) : 5*hd.A + 3*hd.C + hd.D - 10*hd.M - 10*hd.NS;
        let rlAt = emptyReload > 0, rlT = emptyReload;
        if(stopRl && !stopRl.used){ stopRl.used = true; rlAt = true; rlT += stopRl.extra; }
        shots.push({i:idx, stop:k, target:o.id, label:o.label, kind, dt, t, parts, reloadT:rlT, reloadAt:rlAt, why:why || (parts.wait > 0.001 && firstAtStop === false && s === 0 && waitWhy.length ? waitWhy.join('、') : ''), ep, hd, pS, steel, scored, band, expo, overridden:ov != null, flight, fire:t, lead, dist, magLeft:mag, sp, kindKey:o.type});
        shotTime[o.id] = t; hitTime[o.id] = t + flight; prevTarget = o.id; idx++;
      }
      // first shot row carries the reasons for waiting at this stop
    });
    if(waitWhy.length){ const f = shots.find(x => x.stop === k); if(f && !f.why) f.why = waitWhy.join('、'); }
    prev = [st.x, st.y]; prevStance = stance;
  });
  // the timer stops when the BB hits the stop plate, so the last shot's flight time is part of the stage time
  const lastShot = shots[shots.length - 1];
  if(lastShot && lastShot.kindKey === 'stopplate' && lastShot.flight > 0){
    const f = lastShot.flight; lastShot.t += f; lastShot.dt += f; lastShot.parts.wait += f; sumWait += f; t += f;
    lastShot.why = (lastShot.why ? lastShot.why + '；' : '') + '含 BB 飛行 ' + fmt(f, 3) + ' 秒（stop plate 命中才停錶）';
  }
  const ePE = tunnelRisk.reduce((a, r) => a + r.n * r.p, 0);
  tunnelRisk.forEach(r => { if(r.n) warnings.push('S' + (r.stop + 1) + ' 前穿越 ' + r.label + ' 礦工隧道：通過 ' + r.n + ' 根橫條，預估碰落 ' + fmt(r.n * r.p, 2) + ' 根（每根一個 PE）'); });
  const total = t, ePts = shots.reduce((a, x) => a + x.ep, 0) - 10 * ePE;
  const maxPts = shots.reduce((a, x) => a + (x.scored ? 5 : 0), 0);
  // Monte Carlo risk
  const N = opts.noMC ? 0 : 4000, hfs = new Float64Array(Math.max(1, N));
  for(let n = 0; n < N; n++){
    let pts = 0;
    for(const x of shots){
      if(!x.scored) continue;
      const u = Math.random();
      if(x.steel) pts += u < x.pS ? 5 : -10;
      else { const h = x.hd; pts += u < h.A ? 5 : u < h.A + h.C ? 3 : u < h.A + h.C + h.D ? 1 : u < h.A + h.C + h.D + h.M ? -10 : -10; }
    }
    tunnelRisk.forEach(r => { for(let i = 0; i < r.n; i++) if(Math.random() < r.p) pts -= 10; });
    hfs[n] = total > 0 ? Math.max(0, pts) / total : 0;
  }
  hfs.sort();
  const perT = {}; plan.stops.forEach(st => st.targets.forEach(x => perT[x.id] = (perT[x.id] || 0) + x.n));
  engageable().forEach(o => { if(o.type === 'paper' && perT[o.id] != null && perT[o.id] < (o.hits || 2)) warnings.push(o.label + ' 只安排 ' + perT[o.id] + ' 發，少於應打的 ' + (o.hits || 2) + ' 發'); });
  const minR = stage.stgMeta && stage.stgMeta.numRounds;
  if(minR && shots.length < minR) warnings.push('計畫共 ' + shots.length + ' 發，少於 STG 記錄的 ' + minR + ' 發');
  const covered = new Set(plan.stops.flatMap(s => s.targets.map(x => x.id)));
  engageable().forEach(o => { if(!covered.has(o.id)) warnings.push(o.label + ' 沒有排入計畫'); });
  return {shots, total, ePts, maxPts, tunnelRisk, ePE, eHF:total > 0 ? ePts / total : 0, p10:N ? hfs[Math.floor(N*0.1)] : 0, p50:N ? hfs[Math.floor(N*0.5)] : 0,
          sumShoot, sumMove, sumWait, stops:plan.stops.length, reloads, load, division:PROFILE.division, full:plan.stops.filter(s => s.stopType === 'full').length,
          rolling:plan.stops.filter(s => s.stopType === 'rolling').length, warnings, reloadLog, reloadMode:rmode};
}
// place reloads at stop boundaries so no magazine runs dry, preferring the longest movement (hidden reload)
function applyAutoReloads(plan){
  const load = PROFILE.byDiv[PROFILE.division].load, start = startObj();
  plan.stops.forEach(s => s.reload = false);
  const need = plan.stops.map(s => s.targets.reduce((a, x) => a + x.n, 0));
  const dist = plan.stops.map((s, k) => { const p = k === 0 ? (start ? [start.x, start.y] : [s.x, s.y]) : [plan.stops[k-1].x, plan.stops[k-1].y]; return Math.hypot(s.x - p[0], s.y - p[1]); });
  let mag = load + (stage.startCond.ready === 'loaded' ? 1 : 0), last = 0;
  for(let k = 0; k < plan.stops.length; k++){
    if(need[k] <= mag){ mag -= need[k]; continue; }
    // reload at a stop boundary j in (last, k] with the longest approach, if stops j..k fit in one magazine
    let best = -1, bd = -1;
    for(let j = Math.max(1, last + 1); j <= k; j++){
      const sum = need.slice(j, k + 1).reduce((a, b) => a + b, 0);
      if(sum <= load + 1 && dist[j] > bd){ bd = dist[j]; best = j; }
    }
    if(best >= 0){ plan.stops[best].reload = true; last = best; mag = load + 1 - need.slice(best, k + 1).reduce((a, b) => a + b, 0); continue; }
    // this stop needs more rounds than are left: the model reloads inside the stop when the magazine runs dry
    let rem = need[k] - mag; while(rem > load) rem -= load;
    mag = load - rem; last = k;
  }
  return plan;
}
function reloadMode(plan){ return plan.reloadMode || (plan.stops.some(s => s.reload) ? 'manual' : 'auto'); }
function reloadText(r){ return r.forced ? '第 ' + (r.shot + 1) + ' 槍前彈匣打空，定點換匣 ' + fmt(r.extra) + ' 秒' : r.moving ? (r.extra > 0.005 ? '移動中換匣，比移動多花 ' + fmt(r.extra) + ' 秒' : '換匣藏在移動中，不花額外時間') : '定點換匣 ' + fmt(r.extra) + ' 秒'; }
function planResult(plan){
  const key = JSON.stringify(plan) + JSON.stringify(stage.objects) + JSON.stringify(PROFILE.byDiv) + PROFILE.division + JSON.stringify(stage.startCond) + JSON.stringify(stage.safety);
  if(planCache && planCache.key === key) return planCache.res;
  const res = computePlan(plan); planCache = {key, res}; return res;
}
function reorderFromStopPlate(plan){
  const sp = engageable().find(o => o.type === 'stopplate');
  if(!sp){ alert('圖上沒有 stop plate。'); return false; }
  let last = plan.stops.find(s => s.targets.some(x => x.id === sp.id));
  if(!last){
    // pick the stop that sees the stop plate best
    let bq = 0; plan.stops.forEach(s => { const r = computeVis(stopVP(s), {coarse:true}).find(x => x.id === sp.id); const q = qual(r); if(q > bq){ bq = q; last = s; } });
    if(!last){ alert('沒有任何停頓點看得到 stop plate。'); return false; }
    last.targets.push({id:sp.id, n:1});
  }
  // backward nearest-neighbour from the final stop, then reverse
  const rest = plan.stops.filter(s => s !== last), seq = [last];
  let cur = last;
  while(rest.length){ let bi = 0, bd = Infinity; rest.forEach((s, i) => { const d = Math.hypot(s.x - cur.x, s.y - cur.y); if(d < bd){ bd = d; bi = i; } }); cur = rest.splice(bi, 1)[0]; seq.push(cur); }
  plan.stops = seq.reverse();
  const k = last.targets.findIndex(x => x.id === sp.id); if(k >= 0){ const [x] = last.targets.splice(k, 1); last.targets.push(x); }
  return true;
}

/* ---------- target time: what it takes ---------- */
const CAPS = [
  {key:'split', name:'同靶 split', apply:(f, P) => { P.time.split = P.time.split.map(x => x * f); }, show:P => fmt(P.time.split[0]) + '（5 m 內）'},
  {key:'trans', name:'換靶（啟動、轉動、停穩）', apply:(f, P) => { P.body.init *= f; P.body.settle *= f; P.body.armSpeed /= f; P.body.hipSpeed /= f; P.body.stepTime *= f; }, show:P => '45° 換靶 ' + fmt(transTime(45, 1, 'stand', 0))},
  {key:'move', name:'移動（起步、速度、進位）', apply:(f, P) => { P.time.speed /= f; P.time.startCost *= f; P.time.exitT *= f; P.time.entry.full *= f; P.time.entry.rolling *= f; if(P.body.lateral3m) P.body.lateral3m *= f; }, show:P => '速度 ' + fmt(P.time.speed, 2) + ' m/s，進位 ' + fmt(P.time.entry.full)},
  {key:'start', name:'起始（出槍或取槍）', apply:(f, P) => { P.time.startHolster *= f; P.time.startPickup *= f; P.time.loadExtra *= f; P.time.emptyChamber *= f; }, show:P => '出槍 ' + fmt(P.time.startHolster) + '，取槍 ' + fmt(P.time.startPickup)},
  {key:'reload', name:'換匣', apply:(f, P) => { P.time.reloadStatic *= f; P.time.reloadMove *= f; }, show:P => '定點 ' + fmt(P.time.reloadStatic)},
  {key:'posture', name:'姿態轉換', apply:(f, P) => { Object.values(P.postures).forEach(q => q.t *= f); }, show:P => '跪姿 ' + fmt(P.postures.kneel.t)}
];
function withScaled(caps, f, fn){
  const bak = {time:clone(PROFILE.time), body:clone(PROFILE.body), postures:clone(PROFILE.postures)};
  const P = {time:PROFILE.time, body:PROFILE.body, postures:PROFILE.postures};
  caps.forEach(c => c.apply(f, P));
  try{ return fn(P); }
  finally{ const div = PROFILE.division; PROFILE.byDiv[div].time = bak.time; bindDivision(div); PROFILE.body = bak.body; PROFILE.postures = bak.postures; planCache = null; }
}
function solveFactor(plan, caps, target){
  // largest factor f in (0.2, 1] (1 = unchanged) so that the plan finishes within target seconds
  const t = f => withScaled(caps, f, () => computePlan(plan, {noMC:true}).total);
  if(t(1) <= target) return 1;
  if(t(0.2) > target) return null;
  let lo = 0.2, hi = 1;
  for(let i = 0; i < 22; i++){ const m = (lo + hi) / 2; if(t(m) <= target) lo = m; else hi = m; }
  return lo;
}
function renderTargetBox(box, plan, R){
  const d = el('div', {class:'props'});
  d.appendChild(el('h3', {text:'目標反推：要達成特定成績，需要什麼'}));
  plan.target = plan.target || {mode:'time', value:null};
  d.appendChild(row(selField('目標', [['time','總時間（秒）'],['hf','hit factor']], plan.target.mode, v => { plan.target.mode = v; plan.target.value = null; planChanged(); }),
    numField(plan.target.mode === 'time' ? '目標秒數' : '目標 hit factor', plan.target.value, 1, v => { plan.target.value = v > 0 ? v : null; planChanged(); }, '0.01')));
  const tv = plan.target.value;
  if(!tv){ d.appendChild(el('p', {class:'help', text:'輸入目標後，工具會算出各停頓點的時間預算，以及每項能力需要進步多少。目標 hit factor 會依目前期望得分換算成秒數。'})); box.appendChild(d); return; }
  const target = plan.target.mode === 'time' ? tv : R.ePts / tv;
  d.appendChild(el('div', {class:'readout', text:'目標總時間 ' + fmt(target) + ' 秒（目前 ' + fmt(R.total) + ' 秒，' + (R.total > target ? '需快 ' + fmt(R.total - target) + ' 秒，' + fmt((1 - target / R.total) * 100, 1) + '%' : '已達成') + '）'}));
  // time budget per stop
  const k = target / R.total, ul = el('ul', {class:'summ'});
  plan.stops.forEach((st, i) => {
    const sh = R.shots.filter(x => x.stop === i); if(!sh.length) return;
    const mv = sh[0].parts.move, dwell = sh.reduce((a, x) => a + x.dt, 0) - mv;
    ul.appendChild(el('li', {text:'S' + (i + 1) + '：移動 ' + fmt(mv) + ' → ' + fmt(mv * k) + ' 秒；停留射擊 ' + fmt(dwell) + ' → ' + fmt(dwell * k) + ' 秒（' + sh.length + ' 發，平均每發 ' + fmt(dwell * k / sh.length) + ' 秒）'}));
  });
  d.appendChild(el('div', {class:'kind', text:'時間預算（各段等比例縮短）'})); d.appendChild(ul);
  if(R.total > target){
    const ul2 = el('ul', {class:'summ'});
    CAPS.forEach(c => {
      const f = solveFactor(plan, [c], target);
      const cur = withScaled([], 1, P => c.show(P));
      if(f == null){ ul2.appendChild(el('li', {text:c.name + '：單靠這一項無法達成（快 80% 仍不夠）'})); return; }
      const need = withScaled([c], f, P => c.show(P)), pct = (1 - f) * 100;
      ul2.appendChild(el('li', {text:c.name + '：需快 ' + fmt(pct, 0) + '%，' + cur + ' → ' + need + (pct > 30 ? '（幅度很大，不切實際）' : pct > 15 ? '（需要明顯進步）' : '（可透過練習達成）')}));
    });
    const fAll = solveFactor(plan, CAPS, target);
    ul2.appendChild(el('li', {text:fAll == null ? '全部能力一起進步仍無法達成，需換更快的路線。' : '全部能力一起進步：每項約快 ' + fmt((1 - fAll) * 100, 1) + '%'}));
    d.appendChild(el('div', {class:'kind', text:'需要的運動能力（單項達成所需，及全部一起進步）'})); d.appendChild(ul2);
    d.appendChild(el('p', {class:'help', text:'以目前射手與組別的參數試算；以秒數達成為準，未計入準度變化。進步幅度的判斷（15%、30%）為粗略參考。'}));
  }
  box.appendChild(d);
}
function sensitivity(plan){
  const base = computePlan(plan).eHF, out = [];
  const trial = (name, fn) => { const div = PROFILE.division, bak = clone(PROFILE.time); fn(PROFILE.time); const r = computePlan(plan).eHF; PROFILE.byDiv[div].time = bak; bindDivision(div); out.push({name, d:r - base}); };
  trial('起始時間 -0.10 秒', T => { T.startHolster -= 0.1; T.startPickup -= 0.1; });
  trial('同靶 split -0.02 秒', T => { T.split = T.split.map(x => x - 0.02); });
  { const bb = clone(PROFILE.body); PROFILE.body.settle = Math.max(0, PROFILE.body.settle - 0.05); const r = computePlan(plan).eHF; PROFILE.body = bb; out.push({name:'換靶 -0.05 秒（停穩更快）', d:r - base}); }
  { const bb = clone(PROFILE.body); PROFILE.body.hipSpeed *= 1.1; PROFILE.body.armSpeed *= 1.1; const r = computePlan(plan).eHF; PROFILE.body = bb; out.push({name:'轉動速度 +10%（手臂與轉髖）', d:r - base}); }
  trial('進位 -0.05 秒', T => { T.entry.full -= 0.05; T.entry.rolling -= 0.05; });
  trial('行進速度 +10%', T => { T.speed *= 1.1; });
  trial('換匣 -0.10 秒', T => { T.reloadStatic -= 0.1; T.reloadMove -= 0.1; });
  planCache = null;
  return out.sort((a, b) => b.d - a.d);
}

/* ---------- phase 3a: plan UI ---------- */
function renderPlanPanel(){
  const box = $('planBox'); if(!box) return; box.innerHTML = '';
  if(typeof UI !== 'undefined' && UI.mode === 'plan' && UI.tab && UI.tab.plan === 'p-mc' && typeof renderMC === 'function'){ clearTimeout(renderPlanPanel.mc); renderPlanPanel.mc = setTimeout(() => renderMC(), 60); }
  if(typeof renderResStrip === 'function'){ clearTimeout(renderPlanPanel.st); renderPlanPanel.st = setTimeout(() => renderResStrip(), 30); }
  const ps = plans();
  if(!activePlan() && ps.length) activePlanId = ps[0].id;
  const plan = activePlan();
  const rpS = $('rpSummary'), rpT = $('rpTimeline'), rpV = $('rpSens'), rpC = $('rpCompare');
  [rpS, rpT, rpV, rpC].forEach(x => { if(x) x.innerHTML = ''; });
  updateQuickPlan();
  $('stPlan').textContent = ps.length ? ps.length + ' 份計畫' : '';
  ensureProfileParams();
  const dv = divInfo(PROFILE.division), byd = PROFILE.byDiv[PROFILE.division];
  box.appendChild(row(
    selField('組別', DIVISIONS.map(d => [d.key, d.name]), PROFILE.division, v => { PROFILE.division = v; PROFILE.divisionChosen = true; bindDivision(v); saveProfile(); renderParamBox(); planChanged(false); }),
    numField('每匣實際裝填（上限 ' + dv.cap + ' 發）', byd.load, 1, v => { if(v > 0){ byd.load = Math.min(dv.cap, Math.round(v)); saveProfile(); planChanged(false); } }, '1')));
  box.appendChild(el('p', {class:'help explain', text:'彈匣上限依規則附錄 D：Open 28、Standard 18、Production 與 Production Optic 15、Classic 10 發（開始訊號時可取用的彈匣）。' + (dv.optic ? '本組別使用光學瞄具。' : '本組別為開放式照門。') + (dv.da ? '外置擊錘的槍枝第一槍須為雙動作（上膛起始時）。' : '') + 'CON1 起始可頂膛，第一匣多 1 發；在彈匣打空前換匣，也保有膛內 1 發。'}));
  const head = el('div', {class:'btns'});
  if(ps.length){
    const sel = el('select', {'aria-label':'選擇路線計畫'}); ps.forEach(p => sel.appendChild(el('option', {value:p.id, text:'計畫 ' + p.name})));
    sel.value = plan.id; sel.addEventListener('change', () => { activePlanId = sel.value; planChanged(false); });
    sel.style.width = 'auto'; head.appendChild(sel);
  }
  head.appendChild(el('button', {text:'由視點建立', onclick:() => { vpPick = vpPick ? null : {}; renderPlanPanel(); }}));
  head.appendChild(el('button', {text:'由停頓點建議建立', onclick:() => newPlanFrom('suggest')}));
  if(plan){
    head.appendChild(el('button', {text:'複製', onclick:() => { const c = clone(plan); c.id = uid(); c.name = nextPlanName(); c.stops.forEach(s => s.id = uid()); ps.push(c); activePlanId = c.id; planChanged(); }}));
    head.appendChild(el('button', {class:'danger', text:'刪除', onclick:() => { if(confirm('刪除計畫 ' + plan.name + '？')){ stage.plans = ps.filter(p => p !== plan); activePlanId = null; planChanged(); } }}));
  }
  box.appendChild(head);
  if(vpPick) renderVpPicker(box);
  if(!plan){
    box.appendChild(el('p', {class:'help', text:'尚無路線計畫。可由視點（依編號為停頓順序）或停頓點建議自動建立，再調整。'}));
    [rpS, rpT, rpV, rpC].forEach(x => x && x.appendChild(el('p', {class:'help', text:'尚無路線計畫。請在左側「路線計畫與換匣」建立。'})));
    return;
  }
  syncPlanBase(plan);
  if(planModified(plan)){
    const nb = el('div', {class:'msg warn'});
    nb.appendChild(el('div', {text:'計畫 ' + plan.name + ' 已修改。要保留原本的計畫，請另存為新計畫（計畫 ' + plan.name + ' 會恢復修改前的樣子）。'}));
    nb.appendChild(el('div', {class:'btns'},
      el('button', {class:'primary', text:'另存為新計畫 ' + nextPlanName(), onclick:saveAsNewPlan}),
      el('button', {text:'保留在計畫 ' + plan.name, onclick:keepPlanEdits})));
    box.appendChild(nb);
  }
  const R = planResult(plan);
  // --- reloads ---
  const rm = reloadMode(plan);
  const rb = el('div', {class:'port'});
  rb.appendChild(el('div', {class:'kind', text:'換匣安排'}));
  rb.appendChild(selField('方式', [['auto','自動（建議）：提前換，排在最長的移動段'],['dry','打空才換：彈匣空了才定點換匣'],['manual','手動指定每個停頓點']], rm, v => {
    if(v === 'manual' && rm !== 'manual'){ const tmp = clone(plan); if(rm === 'auto') applyAutoReloads(tmp); else tmp.stops.forEach(x => x.reload = false); plan.stops.forEach((x, i) => x.reload = !!tmp.stops[i].reload); }
    plan.reloadMode = v; planChanged();
  }));
  const rA = computePlan(Object.assign({}, plan, {reloadMode:'auto'}), {noMC:true}), rD = computePlan(Object.assign({}, plan, {reloadMode:'dry'}), {noMC:true});
  planCache = null;
  rb.appendChild(el('div', {class:'readout', text:'自動 ' + fmt(rA.total) + ' 秒（換匣 ' + rA.reloads + ' 次）；打空才換 ' + fmt(rD.total) + ' 秒（換匣 ' + rD.reloads + ' 次）' + (Math.abs(rD.total - rA.total) > 0.005 ? '，' + (rD.total > rA.total ? '自動快 ' : '打空才換快 ') + fmt(Math.abs(rD.total - rA.total)) + ' 秒' : '，兩者相同')}));
  rb.appendChild(el('p', {class:'help', text:R.reloadLog.length ? '目前：' + R.reloadLog.map(r => 'S' + (r.stop + 1) + (r.forced ? '' : ' 前') + ' ' + reloadText(r)).join('；') : '這個計畫不需要換匣（每匣 ' + R.load + ' 發）。'}));
  box.appendChild(rb);
  // --- editor ---
  plan.stops.forEach((st, k) => {
    const d = el('div', {class:'port'});
    d.appendChild(el('div', {class:'kind', text:'停頓點 S' + (k+1) + '（' + fmt(st.x, 1) + ', ' + fmt(st.y, 1) + '）'}));
    d.appendChild(row(
      selField('停頓類型', [['full','完全停頓'],['rolling','減速通過'],['move','移動中射擊']], st.stopType, v => { st.stopType = v; planChanged(); }),
      selField('姿勢', STANCE_OPTS(), st.stance || 'stand', v => { st.stance = v; planChanged(); })));
    if(rm === 'manual') d.appendChild(chk('到這個停頓點前換匣', st.reload, v => { st.reload = v; planChanged(); }));
    R.reloadLog.filter(r => r.stop === k).forEach(r => { const w = el('div', {class:'readout', text:'換匣：' + (r.forced ? '' : '到這個停頓點前，') + reloadText(r)}); w.style.color = 'var(--warn)'; d.appendChild(w); });
    const picking = pendingOrder && pendingOrder.stopId === st.id;
    d.appendChild(el('div', {class:'btns'},
      el('button', {class:picking ? 'on' : '', text:picking ? '完成點選（已點 ' + pendingOrder.list.length + ' 個）' : '在圖上依序點靶，設定射擊順序', onclick:() => {
        if(picking) finishOrderPick(); else { pendingOrder = {planId:plan.id, stopId:st.id, list:[]}; setTool('select'); renderPlanPanel(); renderViews(); }
      }}),
      picking ? el('button', {text:'完成並另存為新計畫 ' + nextPlanName(), onclick:saveAsNewPlan}) : null));
    if(picking) d.appendChild(el('p', {class:'help', text:'在俯視圖或 3D 以外的原圖上依序點靶。點到已在其他停頓點的靶會移到這裡；未點到的靶保持原順序排在後面。按 Esc 取消。'}));
    const ul = el('ul', {class:'summ tlist'}); ul.dataset.stop = String(k);
    const svis = stopVisMemo(st);
    const badHere = st.targets.filter(x => visProblem(svis[x.id]));
    if(badHere.length) d.appendChild(warn('S' + (k+1) + ' 打不到：' + badHere.map(x => (getObj(x.id)?.label || '?') + '（' + visProblem(svis[x.id]) + '）').join('、') + '。請移到看得到的停頓點，或移動這個停頓點。'));
    st.targets.forEach((asg, j) => {
      const o = getObj(asg.id);
      const li = el('li', {class:visProblem(svis[asg.id]) ? 'bad' : ''});
      li.dataset.stop = String(k); li.dataset.idx = String(j);
      const hd = el('span', {class:'draghandle', title:'按住拖曳：調整射擊順序，或拖到其他停頓點', 'aria-label':'拖曳調整順序', text:'⠿'});
      hd.addEventListener('pointerdown', e => planDragStart(e, plan, k, j, li));
      li.appendChild(hd);
      li.appendChild(el('span', {class:'ord', text:String(j + 1)}));
      li.appendChild(el('b', {text:(o ? o.label : '?') + ' '}));
      li.appendChild(visBadge(svis[asg.id]));
      const n = el('input', {type:'number', min:'1', step:'1', 'aria-label':'發數'}); n.value = asg.n; n.style.width = '52px';
      n.addEventListener('change', () => { asg.n = Math.max(1, Math.round(+n.value || 1)); planChanged(); });
      li.appendChild(n); li.appendChild(document.createTextNode(' 發 '));
      li.appendChild(el('button', {text:'↑', title:'往前', onclick:() => { if(j > 0){ [st.targets[j-1], st.targets[j]] = [st.targets[j], st.targets[j-1]]; planChanged(); } }}));
      li.appendChild(el('button', {text:'↓', title:'往後', onclick:() => { if(j < st.targets.length - 1){ [st.targets[j+1], st.targets[j]] = [st.targets[j], st.targets[j+1]]; planChanged(); } }}));
      const mv = el('select', {'aria-label':'移到其他停頓點'}); mv.style.width = 'auto';
      plan.stops.forEach((s2, m) => { const pb = m === k ? null : visProblem(stopVisMemo(s2)[asg.id]); mv.appendChild(el('option', {value:String(m), text:'S' + (m+1) + (pb ? '（打不到）' : '')})); });
      mv.value = String(k); mv.addEventListener('change', () => {
        const m = +mv.value;
        if(!confirmAssign(m, plan.stops[m], [asg.id])){ mv.value = String(k); return; }
        st.targets.splice(j, 1); plan.stops[m].targets.push(asg); planChanged();
      });
      li.appendChild(mv);
      li.appendChild(el('button', {class:'danger', text:'×', title:'移出計畫', onclick:() => { st.targets.splice(j, 1); planChanged(); }}));
      ul.appendChild(li);
    });
    d.appendChild(ul);
    const assigned = new Set(plan.stops.flatMap(s => s.targets.map(x => x.id)));
    const free = engageable().filter(o => !assigned.has(o.id));
    if(free.length){
      const add = el('select', {'aria-label':'加入靶'}); add.style.width = 'auto';
      add.appendChild(el('option', {value:'', text:'加入靶…'})); free.forEach(o => add.appendChild(el('option', {value:o.id, text:o.label + (visProblem(svis[o.id]) ? '（打不到）' : '')})));
      add.addEventListener('change', () => {
        const o = getObj(add.value); if(!o) return;
        if(!confirmAssign(k, st, [o.id])){ add.value = ''; return; }
        st.targets.push({id:o.id, n:o.type === 'paper' ? (o.hits || 2) : 1}); planChanged();
      });
      d.appendChild(add);
    }
    d.appendChild(el('div', {class:'btns'},
      el('button', {text:'停頓點往前', onclick:() => { if(k > 0){ [plan.stops[k-1], plan.stops[k]] = [plan.stops[k], plan.stops[k-1]]; planChanged(); } }}),
      el('button', {text:'往後', onclick:() => { if(k < plan.stops.length - 1){ [plan.stops[k+1], plan.stops[k]] = [plan.stops[k], plan.stops[k+1]]; planChanged(); } }}),
      el('button', {class:'danger', text:'刪除停頓點', onclick:() => { if(confirm('刪除 S' + (k+1) + '？它的靶會移出計畫。')){ plan.stops.splice(k, 1); planChanged(); } }})));
    box.appendChild(d);
  });
  // --- results ---
  const res = el('div', {class:'props'});
  res.appendChild(el('h3', {text:'計畫 ' + plan.name + ' 結果'}));
  res.appendChild(el('div', {class:'readout', text:divInfo(R.division).name + ' 組別，每匣 ' + R.load + ' 發' + (stage.startCond.ready === 'loaded' ? '，CON1 起始頂膛共 ' + (R.load + 1) + ' 發' : '，' + {emptyChamber:'CON2', unloaded:'CON3'}[stage.startCond.ready] + ' 起始') + '，換匣 ' + R.reloads + ' 次'}));
  res.appendChild(el('div', {class:'readout', text:'總時間 ' + fmt(R.total) + ' 秒；停頓 ' + R.stops + ' 次（完全停頓 ' + R.full + '、減速通過 ' + R.rolling + '）'}));
  res.appendChild(el('div', {class:'readout', text:'期望得分 ' + fmt(R.ePts, 1) + ' ／ ' + R.maxPts + ' 分；期望 hit factor ' + fmt(R.eHF, 3)}));
  res.appendChild(el('div', {class:'readout', text:'模擬 hit factor：中位數 ' + fmt(R.p50, 3) + '，最差一成 ' + fmt(R.p10, 3)}));
  res.appendChild(el('div', {class:'readout', text:'時間分配：射擊 ' + fmt(R.sumShoot) + ' 秒、移動 ' + fmt(R.sumMove) + ' 秒、等待（死時間）' + fmt(R.sumWait) + ' 秒'}));
  R.warnings.forEach(w => res.appendChild(warn(w)));
  res.appendChild(el('div', {class:'readout', text:'換匣 ' + R.reloads + ' 次' + (R.reloadLog.length ? '：' + R.reloadLog.map(r => 'S' + (r.stop + 1) + ' ' + reloadText(r)).join('；') : '') + '（換匣安排：' + {auto:'自動', dry:'打空才換', manual:'手動'}[R.reloadMode] + '）'}));
  res.appendChild(el('div', {class:'btns'},
    el('button', {text:'用五個組別試算這個計畫', onclick:() => {
      const out = $('divCompare'); out.innerHTML = '';
      const ul = el('ul', {class:'summ'});
      DIVISIONS.map(d => ({d, r:computePlan(plan, {div:d.key, autoReload:true})})).sort((a, b) => b.r.eHF - a.r.eHF).forEach(({d, r}) =>
        ul.appendChild(el('li', {text:d.name + '：' + fmt(r.total) + ' 秒，換匣 ' + r.reloads + ' 次，期望 ' + fmt(r.ePts, 1) + ' 分，期望 HF ' + fmt(r.eHF, 3) + '，最差一成 ' + fmt(r.p10, 3)})));
      out.appendChild(el('div', {class:'kind', text:'各組別試算（換匣自動安排；各組別使用自己的個人參數）'})); out.appendChild(ul);
      planCache = null;
    }})));
  res.appendChild(el('div', {id:'divCompare'}));
  const svAll = sensitivity(plan), sens0 = svAll[0];
  if(sens0) res.appendChild(el('div', {class:'readout', text:'對這條路線幫助最大的進步項目：' + sens0.name + '（hit factor +' + fmt(sens0.d, 3) + '），細節見「敏感度與標竿」分頁'}));
  res.appendChild(el('p', {class:'help', text:'起始條件：' + startSummary() + '。時間與命中參數多為估計值，請按頂端的「射手」依實測修改。'}));
  rpS.appendChild(res);
  // --- timeline ---
  const tl = el('ul', {class:'vislist'});
  R.shots.forEach(x => {
    const inp = el('input', {type:'number', step:'0.01', 'aria-label':'手動指定間隔'}); inp.value = x.overridden ? x.dt.toFixed(2) : ''; inp.placeholder = fmt(x.dt); inp.style.width = '64px';
    inp.addEventListener('change', () => { plan.overrides = plan.overrides || {}; const v = parseFloat(inp.value); if(isNaN(v)) delete plan.overrides[x.i]; else plan.overrides[x.i] = v; planChanged(); });
    const tag = x.reloadAt ? el('span', {class:'st part', text:'換匣'}) : x.parts.wait > 0.05 ? el('span', {class:'st part', text:'等待'}) : x.parts.move > 0.05 ? el('span', {class:'st post', text:'移動'}) : el('span', {class:'st full', text:'射擊'});
    tl.appendChild(el('li', null, el('span', {class:'tl', text:'#' + (x.i+1)}), tag,
      el('span', {class:'dt', text:'S' + (x.stop+1) + ' ' + x.label + '，' + x.kind + '，間隔 ' + fmt(x.dt) + ' 秒，累計 ' + fmt(x.t) + ' 秒' + (x.why ? '（' + x.why + '）' : '') + (x.scored ? '，期望 ' + fmt(x.ep, 1) + ' 分' : '，不計分')}), inp));
  });
  rpT.appendChild(el('div', {class:'kind', text:'逐槍時間軸（右側可手動指定該槍間隔秒數，留空為模型計算）'}));
  rpT.appendChild(tl);
  // --- backward planning / target time ---
  rpT.appendChild(el('div', {class:'btns'}, el('button', {text:'以打 stop plate 的停頓點為終點，倒推重排停頓順序', onclick:() => { if(reorderFromStopPlate(plan)) planChanged(); }})));
  renderTargetBox(rpT, plan, R);
  // --- sensitivity ---
  const sv = svAll;
  const su = el('ul', {class:'summ'});
  sv.forEach(x => su.appendChild(el('li', {text:x.name + '：hit factor ' + (x.d >= 0 ? '+' : '') + fmt(x.d, 3)})));
  rpV.appendChild(el('div', {class:'kind', text:'敏感度：哪個項目進步對這條路線幫助最大'}));
  rpV.appendChild(su);
  renderBenchBox(rpV, plan);
  // --- compare ---
  if(ps.length > 1){
    const cu = el('ul', {class:'summ'});
    const rs = ps.map(p => ({p, r:planResult(p)}));
    planCache = null;
    rs.sort((a, b) => b.r.eHF - a.r.eHF).forEach(({p, r}) => cu.appendChild(el('li', {text:'計畫 ' + p.name + '：' + fmt(r.total) + ' 秒，' + r.stops + ' 停，期望 ' + fmt(r.ePts, 1) + ' 分，期望 HF ' + fmt(r.eHF, 3) + '，最差一成 ' + fmt(r.p10, 3)})));
    if(rs.length >= 2){
      const [a, b] = rs, dt = b.r.total - a.r.total, dp = a.r.ePts - b.r.ePts;
      cu.appendChild(el('li', {text:'計畫 ' + a.p.name + ' 期望 HF 較高。計畫 ' + b.p.name + ' 要打平，需在分數不變下再快 ' + fmt(Math.max(0, b.r.total - b.r.ePts / a.r.eHF)) + ' 秒（目前相差 ' + fmt(dt) + ' 秒、' + fmt(dp, 1) + ' 分）。'}));
    }
    rpC.appendChild(el('div', {class:'kind', text:'計畫比較（依期望 hit factor 排序；各計畫依自己的換匣安排計算）'}));
    rpC.appendChild(cu);
  }else rpC.appendChild(el('p', {class:'help', text:'只有一份計畫。複製或另建一份計畫後，這裡會依期望 hit factor 比較。'}));
}
function planStopHit(sx, sy, toS){
  const plan = activePlan(); if(!plan || !$('planShow')?.checked || toS !== topS) return null;
  for(const st of plan.stops){ const q = toS(st.x, st.y); if(q && Math.abs(q[0] - sx) <= 11 && Math.abs(q[1] - sy) <= 11) return st; }
  return null;
}
function finishOrderPick(){
  const po = pendingOrder; pendingOrder = null; if(!po) return;
  const plan = plans().find(p => p.id === po.planId), st = plan && plan.stops.find(x => x.id === po.stopId);
  if(!st){ renderPlanPanel(); return; }
  const sIdx = plan.stops.indexOf(st);
  const incoming = po.list.filter(id => !st.targets.some(x => x.id === id));
  if(!confirmAssign(sIdx, st, incoming)){
    const vis = stopVisMemo(st);
    po.list = po.list.filter(id => !incoming.includes(id) || !visProblem(vis[id]));   // leave the targets it cannot shoot where they were
  }
  const picked = [];
  po.list.forEach(id => {
    let asg = st.targets.find(x => x.id === id);
    if(!asg){ plan.stops.forEach(o => { const i = o.targets.findIndex(x => x.id === id); if(i >= 0) asg = o.targets.splice(i, 1)[0]; }); }
    if(!asg){ const o = getObj(id); asg = {id, n:o && o.type === 'paper' ? (o.hits || 2) : 1}; }
    picked.push(asg);
  });
  st.targets = picked.concat(st.targets.filter(x => !po.list.includes(x.id)));
  const sp = st.targets.findIndex(x => getObj(x.id)?.type === 'stopplate');
  if(sp >= 0 && sp !== st.targets.length - 1 && plan.stops.indexOf(st) === plan.stops.length - 1) alert('提醒：stop plate 不是最後一槍。依關卡程序，最後一槍通常必須打 stop plate。');
  planChanged();
  if(planModified(plan) && typeof toast === 'function') toast('S' + (plan.stops.indexOf(st) + 1) + ' 的射擊順序已更新。', '另存為新計畫', saveAsNewPlan, 8000);
}
function drawPlanOverlay(ctx, toS){
  const plan = activePlan(); if(!plan || !plan.stops.length || !$('planShow')?.checked) return;
  if(pendingOrder){
    pendingOrder.list.forEach((id, j) => { const o = getObj(id), q = o && toS(o.x, o.y); if(!q) return;
      ctx.beginPath(); ctx.arc(q[0], q[1], 13, 0, Math.PI*2); ctx.strokeStyle = '#C8372D'; ctx.lineWidth = 3; ctx.stroke();
      label(ctx, '第 ' + (j + 1), q[0] - 12, q[1] - 16, '#C8372D'); });
  }
  const start = startObj(), col = '#1F6E8C';
  const path = (start ? [[start.x, start.y]] : []).concat(plan.stops.map(s => [s.x, s.y]));
  if(path.length > 1 && pathW(ctx, toS, path)){ ctx.strokeStyle = 'rgba(31,110,140,.8)'; ctx.lineWidth = 2.5; ctx.stroke(); }
  let n = 0;
  plan.stops.forEach((st, k) => {
    const q0 = toS(st.x, st.y); if(!q0) return;
    st.targets.forEach(asg => {
      const o = getObj(asg.id), q = o && toS(o.x, o.y); if(!q) return;
      n++;
      ctx.beginPath(); ctx.moveTo(q0[0], q0[1]); ctx.lineTo(q[0], q[1]); ctx.strokeStyle = 'rgba(31,110,140,.3)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.beginPath(); ctx.arc(q[0] + 12, q[1] - 14, 8, 0, Math.PI*2); ctx.fillStyle = col; ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '700 10px sans-serif'; ctx.fillText(String(n), q[0] + 12 - (n > 9 ? 6 : 3), q[1] - 10);
    });
    ctx.beginPath(); ctx.rect(q0[0] - 10, q0[1] - 10, 20, 20); ctx.fillStyle = col; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '700 11px sans-serif'; ctx.fillText('S' + (k+1), q0[0] - 8, q0[1] + 4);
  });
}
/* ---------- phase 3a: compare with real results ---------- */
const RES_KINDS = [['best','最佳成績（冠軍或標竿）'],['mine','我的成績'],['other','其他射手']];
function results(){ if(!Array.isArray(stage.results)) stage.results = []; return stage.results; }
function resultPoints(r){ return 5*(+r.A || 0) + 3*(+r.C || 0) + (+r.D || 0) - 10*(+r.M || 0) - 10*(+r.NS || 0) - 10*(+r.PE || 0); }
function resultHF(r){ const t = +r.time || 0; return t > 0 ? Math.max(0, resultPoints(r)) / t : 0; }
function renderResultsPanel(){
  if(typeof renderResStrip === 'function') setTimeout(() => renderResStrip(), 0);
  const box = $('resultBox'); if(!box) return; box.innerHTML = '';
  const rs = results();
  box.appendChild(el('p', {class:'help', text:'輸入實際成績（時間與 A、C、D、脫靶、誤中 no-shoot、程序罰則次數），與工具的最佳路線、你的路線比對。計分依 Action Air：A 5、C 3、D 1，脫靶、誤中 no-shoot、程序罰則各扣 10 分。'}));
  rs.forEach((r, i) => {
    const d = el('div', {class:'port'});
    const nm = el('input', {type:'text', placeholder:'名稱，例如：冠軍 王大明'}); nm.value = r.name || '';
    nm.addEventListener('change', () => { r.name = nm.value; resultsChanged(); });
    d.appendChild(row(selField('類型', RES_KINDS, r.kind, v => { r.kind = v; resultsChanged(); }), el('div', null, el('label', {class:'f', text:'名稱'}), nm)));
    const f = (k, lab, step) => numField(lab, r[k], 1, v => { r[k] = v == null ? 0 : v; resultsChanged(); }, step || '1');
    d.appendChild(row(f('time', '時間（秒）', '0.01'), f('A', 'A'), f('C', 'C'), f('D', 'D')));
    d.appendChild(row(f('M', '脫靶'), f('NS', '誤中 NS'), f('PE', '程序罰則')));
    d.appendChild(el('div', {class:'readout', text:'得分 ' + resultPoints(r) + ' 分，hit factor ' + fmt(resultHF(r), 4)}));
    d.appendChild(el('div', {class:'btns'}, el('button', {class:'danger', text:'刪除這筆成績', onclick:() => { rs.splice(i, 1); resultsChanged(); }})));
    box.appendChild(d);
  });
  box.appendChild(el('div', {class:'btns'},
    el('button', {text:'新增最佳成績', onclick:() => { rs.push({id:uid(), kind:'best', name:'', time:0, A:0, C:0, D:0, M:0, NS:0, PE:0}); resultsChanged(); }}),
    el('button', {text:'新增我的成績', onclick:() => { rs.push({id:uid(), kind:'mine', name:'我', time:0, A:0, C:0, D:0, M:0, NS:0, PE:0}); resultsChanged(); }})));
  const ps = plans();
  if(ps.length){
    stage.myPlanId = ps.find(p => p.id === stage.myPlanId) ? stage.myPlanId : null;
    box.appendChild(selField('我的路線（我實際採用或打算採用的計畫）', [['', '（未指定）']].concat(ps.map(p => [p.id, '計畫 ' + p.name])), stage.myPlanId || '', v => { stage.myPlanId = v || null; resultsChanged(); }));
  }
  renderComparison(box);
  if(typeof renderRunsPanel === 'function') renderRunsPanel();
}
function resultsChanged(){ saveStage(); renderResultsPanel(); }
function renderComparison(box){
  const rs = results().filter(r => +r.time > 0);
  const ps = plans();
  const rows = [];
  rs.forEach(r => rows.push({name:(r.kind === 'best' ? '最佳成績' : r.kind === 'mine' ? '我的成績' : '其他') + (r.name ? '：' + r.name : ''), time:+r.time, pts:resultPoints(r), hf:resultHF(r), kind:r.kind}));
  let toolBest = null;
  if(ps.length){
    const evals = ps.map(p => ({p, r:planResult(p)})); planCache = null;
    toolBest = evals.slice().sort((a, b) => b.r.eHF - a.r.eHF)[0];
    rows.push({name:'工具最佳路線：計畫 ' + toolBest.p.name + '（期望值）', time:toolBest.r.total, pts:toolBest.r.ePts, hf:toolBest.r.eHF, kind:'tool'});
    const mine = evals.find(x => x.p.id === stage.myPlanId);
    if(mine && mine !== toolBest) rows.push({name:'我的路線：計畫 ' + mine.p.name + '（期望值）', time:mine.r.total, pts:mine.r.ePts, hf:mine.r.eHF, kind:'myplan'});
    if(mine && mine === toolBest) rows[rows.length - 1].name += '＝我的路線';
  }
  if(!rows.length) return;
  const top = rows.reduce((m, x) => x.hf > m.hf ? x : m, rows[0]);
  const maxPts = toolBest ? toolBest.r.maxPts : null;
  box.appendChild(el('div', {class:'kind', text:'比對（依 hit factor 排序；stage 分數＝hit factor ÷ 最高 hit factor × 滿分）'}));
  const ul = el('ul', {class:'summ'});
  rows.sort((a, b) => b.hf - a.hf).forEach(x => {
    const pct = top.hf > 0 ? x.hf / top.hf * 100 : 0;
    ul.appendChild(el('li', null, el('b', {text:x.name + '：'}), document.createTextNode(fmt(x.time) + ' 秒，' + fmt(x.pts, 1) + ' 分，HF ' + fmt(x.hf, 4) + '，' + fmt(pct, 1) + '%' + (maxPts ? '（stage 分數 ' + fmt(maxPts * pct / 100, 1) + '）' : ''))));
  });
  box.appendChild(ul);
  // gap analysis against the best result
  const best = rows.find(x => x.kind === 'best') || top;
  const gaps = el('ul', {class:'summ'});
  rows.filter(x => x !== best && x.hf > 0).forEach(x => {
    const tNeed = x.pts / best.hf, pNeed = best.hf * x.time;
    const ptsTxt = maxPts && pNeed > maxPts ? '；以 ' + fmt(x.time) + ' 秒完成的話，即使滿分 ' + maxPts + ' 分也追不上，必須縮短時間' : '，或同樣 ' + fmt(x.time) + ' 秒時需拿 ' + fmt(pNeed, 1) + ' 分（多 ' + fmt(pNeed - x.pts, 1) + ' 分）';
    gaps.appendChild(el('li', {text:x.name + ' 要追平「' + best.name + '」：同樣 ' + fmt(x.pts, 1) + ' 分時需在 ' + fmt(tNeed) + ' 秒內完成（快 ' + fmt(x.time - tNeed) + ' 秒）' + ptsTxt + '。'}));
  });
  if(gaps.children.length){ box.appendChild(el('div', {class:'kind', text:'差距分析'})); box.appendChild(gaps); }
  if(best.hf > 0) box.appendChild(el('p', {class:'help', text:'以「' + best.name + '」的 hit factor ' + fmt(best.hf, 3) + ' 計算，1 分約等於 ' + fmt(1 / best.hf, 3) + ' 秒；一次脫靶或誤中 no-shoot（失去該槍分數並扣 10 分）約等於 ' + fmt(15 / best.hf, 2) + ' 秒。工具路線為期望值，實際成績為單次結果，兩者比較時請一併參考最差一成的風險。'}));
}
