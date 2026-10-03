'use strict';
/*! Stage 模擬器 — IPSC Action Air stage 規劃、回放與檢討
 *  Copyright (C) 2026 James
 *  SPDX-License-Identifier: GPL-3.0-or-later
 *  本程式為自由軟體：你可以依自由軟體基金會發布的 GNU 通用公共授權條款第 3 版，
 *  或（由你選擇）任何更新的版本，重新散布或修改本程式。本程式不提供任何保證，
 *  亦不保證適售性或特定目的適用性。完整條款見 LICENSE 或 <https://www.gnu.org/licenses/>。
 */
// set to true by the init section after every script file has loaded; views do not draw before that
let APP_READY = false;

const SCHEMA = '0.3';
const LS_SETS = 'stageSim.venueSets';
const LS_STAGE = 'stageSim.stageDraft';
const PT_NAMES = ['後左','後右','前右','前左'];

const ITEM_TYPES = {
  stand:{label:'紙靶靶架',dims:[['top','靶架最高處']]},
  plate:{label:'Falling Plate',dims:[['d','直徑或邊長'],['cy','中心離地']]},
  stopplate:{label:'stop plate',dims:[['d','直徑'],['cy','中心離地']]},
  wall:{label:'檔牆',dims:[['w','寬'],['h','高'],['t','厚'],['pw','窗戶寬'],['ph','窗戶高'],['pb','窗戶下緣離地'],['px','窗戶距左緣']]},
  barrel:{label:'油桶',dims:[['d','直徑'],['h','高']]},
  table:{label:'桌子',dims:[['w','寬'],['dp','深'],['h','高']]},
  door:{label:'門',dims:[['w','寬'],['h','高']]},
  custom:{label:'其他',dims:[['w','寬'],['dp','深'],['h','高']]}
};
const DEFAULT_ITEMS = ['stand','plate','stopplate','wall','barrel','table'];
// Fixed by IPSC Action Air Handgun Rules, Jan 2026 Edition (meters)
const RULE_SPECS = {
  source:'IPSC Action Air Handgun Competition Rules, January 2026 Edition',
  paperTarget:{w:0.30, h:0.375, shoulder:0.125}, microTarget:{w:0.18, h:0.228, shoulder:0.076},  // shoulder = distance from top edge (App. B2/B3)
  popper:{headD:0.20, h:0.575, baseW:0.10}, miniPopper:{headD:0.12, h:0.345, baseW:0.06},
  fallingPlate:{min:0.10, max:0.20}, stopPlate:{minD:0.15, minDistFromLastPos:2.0}
};

const OBJ = {
  paper:{label:'紙靶', prefix:'T', kind:'point'},
  noshoot:{label:'no-shoot', prefix:'NS', kind:'point'},
  popper:{label:'鋼靶', prefix:'PP', kind:'point'},
  plate:{label:'Falling Plate', prefix:'PL', kind:'point'},
  stopplate:{label:'stop plate', prefix:'SP', kind:'point'},
  wall:{label:'檔牆', prefix:'W', kind:'line'},
  area:{label:'射擊區', prefix:'A', kind:'poly'},
  faultline:{label:'邊線', prefix:'L', kind:'line'},
  tunnel:{label:'礦工隧道', prefix:'CT', kind:'line'},
  barrel:{label:'油桶', prefix:'B', kind:'point'},
  table:{label:'桌子', prefix:'TB', kind:'point'},
  door:{label:'門', prefix:'D', kind:'point'},
  start:{label:'起始位置', prefix:'S', kind:'point'},
  trigger:{label:'啟動機關', prefix:'TR', kind:'point'},
  viewpoint:{label:'視點', prefix:'V', kind:'point'},
  prop:{label:'其他道具', prefix:'X', kind:'point'},
  platform:{label:'講台／平台', prefix:'PF', kind:'point'},
  bridge:{label:'橋', prefix:'BR', kind:'line'},
  boat:{label:'船', prefix:'BT', kind:'point'},
  chair:{label:'椅子', prefix:'CH', kind:'point'},
  horse:{label:'馬（鞍座、倒放油桶）', prefix:'HS', kind:'point'}
};
const TOOL_GROUPS = [
  [['select','選取']],
  [['paper','紙靶'],['noshoot','no-shoot'],['popper','鋼靶'],['plate','Falling Plate'],['stopplate','stop plate'],['trigger','啟動機關']],
  [['wall','檔牆'],['area','射擊區'],['faultline','邊線'],['tunnel','礦工隧道']],
  [['barrel','油桶'],['table','桌子'],['door','門'],['prop','其他道具'],['start','起始位置']],
  [['viewpoint','視點'],['measure','測距']]
];
const TOOL_TIPS = {
  select:'點選物件可編輯，拖曳可移動；拖曳端點或頂點可調整形狀。',
  calib:'在原圖上點出或拖曳四個校正點。',
  measure:'點兩點量距離，再點一次重新量測。',
  wall:'點檔牆與地面接觸的起點，再點終點；靠近其他檔牆或邊線時會自動吸附（綠圈）。',
  faultline:'點邊線起點，再點終點；靠近檔牆或其他邊線時會自動吸附（綠圈）。',
  area:'逐點點出射擊區頂點，點回第一點或按 Enter 完成。',
  tunnel:'點隧道入口中央，再點出口中央；寬度、高度與橫條間距在屬性面板調整。'
};

const $ = id => document.getElementById(id);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);
const clone = o => JSON.parse(JSON.stringify(o));
const fmt = (n,d=2) => (Math.round(n*Math.pow(10,d))/Math.pow(10,d)).toFixed(d);
const cm = m => m == null || isNaN(m) ? '' : String(Math.round(m*1000)/10);
const deg = r => r*180/Math.PI, rad = d => d*Math.PI/180;
const normDeg = d => { d = ((d + 180) % 360 + 360) % 360 - 180; return Math.round(d*10)/10; };

/* ---------- state ---------- */
let venueSets = [], activeSetId = null;
let stage = newStage();
let img = null, srcData = null;
let H = null, Hinv = null;
let topOff = document.createElement('canvas'), topOffKey = '', topImgExt = null;
let topExt = {xmin:0, xmax:12, ymin:0, ymax:15};
let tool = 'select';
let selId = null;
let draft = null;           // {type, pts:[[x,y],...]}
let measurePts = [];
let hover = {view:null, sx:0, sy:0, world:null};
let calibDrag = -1;
let pendingFace = null;   // id of object waiting for a 'click to face' point
const ROTATABLE = ['paper','noshoot','plate','table','door','prop','start','trigger','viewpoint','platform','boat','chair','horse'];
let pendingSlide = null;
let pendingAct = null;     // id of a moving target waiting for its activator to be clicked on the map
let pendingOrder = null;   // {planId, stopId, list:[]} while picking a stop's shooting order  // id of a slider target waiting for its end point
const MECH_TYPES = [['static','固定靶'],['swinger','搖擺靶'],['monkey','猴子靶'],['disappear','消失靶'],['slider','滑輪靶'],['other','其他機關靶']];
const MECH_SHORT = {swinger:'擺', monkey:'猴', disappear:'消', slider:'滑', other:'機'};
const TRIG_TYPES = [['laser','雷射感應（人經過啟動）'],['pedal','踏板'],['rope','手拉機關'],['other','其他']];
const ACTIVATOR_TYPES = ['trigger','popper','plate','door','prop'];
function newMech(){ return {type:'static', preVisible:true, winFrom:null, winTo:null, amp:null, period:null, ex:null, ey:null, travel:null, act:{mode:'none', id:null, delay:0}}; }
function isMech(o){ return (o.type === 'paper' || o.type === 'noshoot') && o.mech && o.mech.type !== 'static'; }
let undoStack = [], redoStack = [], lastSnap = '';
const UNDO_MAX = 100;

function newStage(){
  return {
    source:'none', name:'', matchName:'', matchDate:'',
    image:null, imgW:0, imgH:0,
    points:[],
    rect:{width:10, depth:8, depthScale:1, x0:0, y0:0},
    margins:{side:0.5, front:4, back:0.5},
    lockRow:true, showGrid:true, defTarget:'normal',
    objects:[], stgMeta:null, startCond:defaultStartCond(), eye:{stand:1.68, kneel:1.05}, safety:{downDeg:0, left:90, right:90}, plateCy:1.0, flex:true, plans:[], results:[], myPlanId:null, runs:[], clips:[]
  };
}
function defaultStartCond(){
  return {gunLoc:'holster', gunObj:null, gunNote:'', ready:'loaded', magLoc:'gun', magObj:null,
          spareLoc:'body', spareObj:null, facing:'downrange', hands:'sides', handsObj:null, note:'', auto:false, pose:'stand', seatObj:null, after:'rise'};
}
// the user's common equipment (can be edited in the venue set)
const COMMON_ITEMS = [
  {type:'wall', name:'短牆', dims:{w:0.9, h:1.85, t:0.03}},
  {type:'wall', name:'長牆', dims:{w:2.0, h:1.85, t:0.03}},
  {type:'stand', name:'高靶架', dims:{top:1.5}},
  {type:'stand', name:'中靶架', dims:{top:1.0}},
  {type:'stand', name:'低靶架', dims:{top:0.5}},
  {type:'plate', name:'Falling Plate', dims:{}},
  {type:'stopplate', name:'stop plate', dims:{}},
  {type:'barrel', name:'油桶', dims:{}},
  {type:'table', name:'桌子', dims:{}}
];
function newSet(name){
  return {id:uid(), name, note:'', created:new Date().toISOString(), updated:new Date().toISOString(),
    items:COMMON_ITEMS.map(i => ({id:uid(), type:i.type, name:i.name, dims:clone(i.dims)}))};
}
function wallSpecFor(stgName){
  const walls = venueItems('wall');
  const key = /short/.test(stgName) ? '短' : /long/.test(stgName) ? '長' : null;
  const fromVenue = key ? walls.find(w => w.name.includes(key)) : null;
  if(fromVenue) return {it:fromVenue, dims:fromVenue.dims};
  const base = key ? COMMON_ITEMS.find(i => i.type === 'wall' && i.name.includes(key)) : null;
  return base ? {it:null, dims:base.dims} : null;
}


/* ---------- storage ---------- */
function migrateSet(s){
  if(!s || !Array.isArray(s.items)) return;
  s.items = s.items.filter(i => i.type !== 'noshoot' && i.type !== 'popper').map(i => {
    if(i.type === 'paper') return {id:i.id, type:'stand', name:'紙靶靶架', dims:{}};
    if(i.type === 'stand' && i.dims && i.dims.base != null && i.dims.top == null) delete i.dims.base;
    if(i.type === 'portwall') i.type = 'wall';
    if(!ITEM_TYPES[i.type]) i.type = 'custom';
    if(!i.dims) i.dims = {};
    return i;
  });
}
function saveSets(){
  try{ localStorage.setItem(LS_SETS, JSON.stringify({activeSetId, sets:venueSets})); }
  catch(e){ note('尺寸組無法自動保存，請用「匯出尺寸組」備份。'); }
}
function loadSets(){
  try{
    const raw = localStorage.getItem(LS_SETS);
    if(raw){ const o = JSON.parse(raw); venueSets = o.sets || []; activeSetId = o.activeSetId; }
  }catch(e){}
  venueSets.forEach(migrateSet);
  if(!venueSets.length){ const s = newSet('未命名靶場'); venueSets.push(s); activeSetId = s.id; }
  if(!venueSets.find(s => s.id === activeSetId)) activeSetId = venueSets[0].id;
}
let saveTimer = null;
function snapState(){
  return JSON.stringify({objects:stage.objects, points:stage.points, rect:stage.rect, margins:stage.margins, lockRow:stage.lockRow, startCond:stage.startCond, eye:stage.eye, safety:stage.safety, plateCy:stage.plateCy, flex:stage.flex, plans:stage.plans, results:stage.results, myPlanId:stage.myPlanId});
}
function commitHistory(){
  const cur = snapState();
  if(cur === lastSnap) return;
  if(lastSnap){ undoStack.push(lastSnap); if(undoStack.length > UNDO_MAX) undoStack.shift(); }
  redoStack = []; lastSnap = cur; syncUndoButtons();
}
function resetHistory(){ undoStack = []; redoStack = []; lastSnap = snapState(); syncUndoButtons(); }
function restoreSnap(str){
  const o = JSON.parse(str);
  stage.objects = o.objects; stage.points = o.points; stage.rect = o.rect; stage.margins = o.margins; stage.lockRow = o.lockRow; stage.startCond = Object.assign(defaultStartCond(), o.startCond || {}); stage.eye = Object.assign({stand:1.68, kneel:1.05}, o.eye || {}); stage.safety = Object.assign({downDeg:0, left:90, right:90}, o.safety || {}); stage.plateCy = o.plateCy ?? 1.0; stage.flex = o.flex ?? true; stage.plans = o.plans || []; stage.results = o.results || []; stage.myPlanId = o.myPlanId || null;
  lastSnap = str;
  if(selId && !getObj(selId)) selId = null;
  draft = null; drag = null; calibDrag = -1;
  fillInputs(); recompute(false); renderList(); renderProps(); renderStartCond(); if(typeof renderPlanPanel === 'function'){ planCache = null; renderPlanPanel(); if(typeof renderResultsPanel === 'function') renderResultsPanel(); }
  layoutChanged(); syncUndoButtons();
  saveStage();
}
function undo(){ if(!undoStack.length) return; commitHistory(); if(!undoStack.length) return; redoStack.push(lastSnap); restoreSnap(undoStack.pop()); }
function redo(){ if(!redoStack.length) return; undoStack.push(lastSnap); restoreSnap(redoStack.pop()); }
function syncUndoButtons(){
  const u = document.getElementById('undoBtn'), r = document.getElementById('redoBtn');
  if(u) u.disabled = !undoStack.length; if(r) r.disabled = !redoStack.length;
}
function saveStage(){
  commitHistory();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try{ localStorage.setItem(LS_STAGE, JSON.stringify(stage)); note(''); }
    catch(e){
      try{
        const s = clone(stage); s.image = null;
        localStorage.setItem(LS_STAGE, JSON.stringify(s));
        note('圖檔太大無法自動保存，請用「匯出存檔」保存。');
      }catch(e2){ note('無法自動保存，請用「匯出存檔」保存。'); }
    }
  }, 300);
}
function loadStage(){
  try{
    const raw = localStorage.getItem(LS_STAGE);
    if(raw){ stage = Object.assign(newStage(), JSON.parse(raw)); if(!Array.isArray(stage.objects)) stage.objects = []; }
    stage.objects.forEach(o => { if(o.type === 'noshoot' && o.cover && o.dz === undefined){ o.dz = -targetSpec(o.size).h / 2; o.mount = 'lower'; } });
    migrateObjects(stage.objects);
    stage.startCond = Object.assign(defaultStartCond(), stage.startCond || {});
    stage.eye = Object.assign({stand:1.68, kneel:1.05}, stage.eye || {}); if(stage.eye.stand === 1.6) stage.eye.stand = 1.68;

    stage.safety = Object.assign({downDeg:0, left:90, right:90}, stage.safety || {}); if(stage.plateCy == null) stage.plateCy = 1.0; if(stage.flex == null) stage.flex = true;
  }catch(e){}
  if(stage.source === 'none' && stage.image) stage.source = 'jpg';
}
function note(t){ $('saveNote').textContent = t; }
function download(filename, obj){
  const blob = new Blob([JSON.stringify(obj, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function readFile(file, asText){
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result); r.onerror = () => rej(r.error);
    asText ? r.readAsText(file) : r.readAsDataURL(file);
  });
}
function safeName(s){ return (s || 'stage').replace(/[\\/:*?"<>|]/g, '_'); }

/* ---------- venue sets UI ---------- */
function activeSet(){ return venueSets.find(s => s.id === activeSetId); }
function venueItems(type){ const s = activeSet(); return s ? s.items.filter(i => i.type === type) : []; }
function renderSets(){
  const sel = $('setSelect'); sel.innerHTML = '';
  venueSets.forEach(s => { const o = document.createElement('option'); o.value = s.id; o.textContent = s.name; sel.appendChild(o); });
  sel.value = activeSetId;
  $('setDelete').disabled = venueSets.length <= 1;
  renderItems();
  const s = activeSet(); $('stVenue').textContent = s ? s.name : '';
  renderProps();
}
function renderItems(){
  const box = $('itemsBox'); box.innerHTML = '';
  const s = activeSet(); if(!s) return;
  s.items.forEach(it => {
    const t = ITEM_TYPES[it.type] || ITEM_TYPES.custom;
    const d = document.createElement('div'); d.className = 'item';
    const top = document.createElement('div'); top.className = 'top';
    const tag = document.createElement('span'); tag.className = 'type'; tag.textContent = t.label;
    const nm = document.createElement('input'); nm.type = 'text'; nm.value = it.name; nm.setAttribute('aria-label', '物件名稱');
    nm.addEventListener('change', () => { it.name = nm.value.trim() || t.label; touchSet(); });
    const del = document.createElement('button'); del.className = 'del'; del.textContent = '×';
    del.title = '刪除這個物件'; del.setAttribute('aria-label', '刪除 ' + it.name);
    del.addEventListener('click', () => { if(confirm('刪除「' + it.name + '」？')){ s.items = s.items.filter(x => x !== it); touchSet(); renderItems(); } });
    top.append(tag, nm, del);
    const dims = document.createElement('div'); dims.className = 'dims';
    t.dims.forEach(([k, lab]) => {
      const w = document.createElement('div');
      const l = document.createElement('label'); l.textContent = lab;
      const inp = document.createElement('input'); inp.type = 'number'; inp.step = '0.5'; inp.min = '0'; inp.placeholder = '公分';
      inp.value = cm(it.dims[k]);
      inp.setAttribute('aria-label', it.name + ' ' + lab + '（公分）');
      inp.addEventListener('change', () => { const v = parseFloat(inp.value); if(isNaN(v)) delete it.dims[k]; else it.dims[k] = v/100; touchSet(); });
      w.append(l, inp); dims.appendChild(w);
    });
    d.append(top, dims); box.appendChild(d);
  });
}
function touchSet(){ const s = activeSet(); if(s) s.updated = new Date().toISOString(); saveSets(); }
function initSetUI(){
  const at = $('addType');
  Object.entries(ITEM_TYPES).forEach(([k, v]) => { const o = document.createElement('option'); o.value = k; o.textContent = v.label; at.appendChild(o); });
  at.value = 'wall';
  $('setSelect').addEventListener('change', e => { activeSetId = e.target.value; saveSets(); renderSets(); });
  $('setNew').addEventListener('click', () => {
    const n = prompt('新尺寸組名稱（例如靶場名稱）'); if(!n) return;
    const s = newSet(n.trim()); venueSets.push(s); activeSetId = s.id; saveSets(); renderSets();
  });
  $('setCopy').addEventListener('click', () => {
    const cur = activeSet(); if(!cur) return;
    const n = prompt('複製後的名稱', cur.name + '（複製）'); if(!n) return;
    const s = clone(cur); s.id = uid(); s.name = n.trim(); s.created = s.updated = new Date().toISOString();
    s.items.forEach(i => i.id = uid());
    venueSets.push(s); activeSetId = s.id; saveSets(); renderSets();
  });
  $('setRename').addEventListener('click', () => {
    const cur = activeSet(); if(!cur) return;
    const n = prompt('新名稱', cur.name); if(!n) return; cur.name = n.trim(); touchSet(); renderSets();
  });
  $('setDelete').addEventListener('click', () => {
    const cur = activeSet(); if(!cur || venueSets.length <= 1) return;
    if(!confirm('刪除尺寸組「' + cur.name + '」？此動作無法復原。')) return;
    venueSets = venueSets.filter(s => s !== cur); activeSetId = venueSets[0].id; saveSets(); renderSets();
  });
  $('addItem').addEventListener('click', () => {
    const s = activeSet(); if(!s) return; const t = at.value;
    s.items.push({id:uid(), type:t, name:ITEM_TYPES[t].label, dims:{}}); touchSet(); renderItems();
  });
  $('setExport').addEventListener('click', () => download('設施尺寸組.json', {schemaVersion:SCHEMA, type:'venueSets', exported:new Date().toISOString(), sets:venueSets}));
  $('setImport').addEventListener('click', () => $('setImportFile').click());
  $('setImportFile').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = ''; if(!f) return;
    try{
      const o = JSON.parse(await readFile(f, true));
      if(o.type !== 'venueSets' || !Array.isArray(o.sets)) throw new Error('bad');
      let n = 0;
      o.sets.forEach(s => {
        if(!s || !Array.isArray(s.items)) return;
        migrateSet(s);
        const exist = venueSets.find(v => v.id === s.id);
        if(exist){ if(confirm('尺寸組「' + s.name + '」已存在，要用匯入的版本覆蓋嗎？')){ Object.assign(exist, s); n++; } }
        else{ if(venueSets.find(v => v.name === s.name)) s.name += '（匯入）'; venueSets.push(s); n++; }
      });
      saveSets(); renderSets(); alert('已匯入 ' + n + ' 組尺寸組。');
    }catch(err){ alert('匯入失敗：這個檔案不是尺寸組檔。'); }
  });
}

/* ---------- math ---------- */
function solveLinear(A, b){
  const n = b.length;
  for(let i = 0; i < n; i++){
    let p = i;
    for(let r = i+1; r < n; r++) if(Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    if(Math.abs(A[p][i]) < 1e-12) return null;
    [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
    for(let r = i+1; r < n; r++){
      const f = A[r][i] / A[i][i];
      for(let c = i; c < n; c++) A[r][c] -= f * A[i][c];
      b[r] -= f * b[i];
    }
  }
  const x = new Array(n);
  for(let i = n-1; i >= 0; i--){ let s = b[i]; for(let c = i+1; c < n; c++) s -= A[i][c] * x[c]; x[i] = s / A[i][i]; }
  return x;
}
function homography(src, dst){
  const A = [], b = [];
  for(let i = 0; i < 4; i++){
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u*x, -u*y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v*x, -v*y]); b.push(v);
  }
  const h = solveLinear(A, b);
  if(!h || h.some(v => !isFinite(v))) return null;
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}
function applyH(M, x, y){
  const w = M[6]*x + M[7]*y + M[8];
  return [(M[0]*x + M[1]*y + M[2]) / w, (M[3]*x + M[4]*y + M[5]) / w, w];
}
function invert3(m){
  const [a,b,c,d,e,f,g,h,i] = m;
  const A = e*i - f*h, B = -(d*i - f*g), C = d*h - e*g;
  const det = a*A + b*B + c*C;
  if(Math.abs(det) < 1e-15) return null;
  return [A, -(b*i - c*h), b*f - c*e, B, a*i - c*g, -(a*f - c*d), C, -(a*h - b*g), a*e - b*d].map(v => v / det);
}
function effDepth(){ return stage.rect.depth * stage.rect.depthScale; }
function worldCorners(){
  const {width:W, x0, y0} = stage.rect, D = effDepth();
  return [[x0, y0+D], [x0+W, y0+D], [x0+W, y0], [x0, y0]];
}
function imgToWorld(u, v){
  if(!Hinv) return null;
  const [x, y] = applyH(Hinv, u, v);
  const back = applyH(H, x, y);
  if(!(back[2] > 0) || !isFinite(x) || !isFinite(y)) return null;
  return [x, y];
}
function worldToImg(x, y){
  if(!H) return null;
  const [u, v, w] = applyH(H, x, y);
  if(!(w > 0)) return null;
  return [u, v];
}
function quadIsConvex(p){
  let sign = 0;
  for(let i = 0; i < 4; i++){
    const a = p[i], b = p[(i+1)%4], c = p[(i+2)%4];
    const s = Math.sign((b.u - a.u)*(c.v - b.v) - (b.v - a.v)*(c.u - b.u));
    if(s === 0) return false;
    if(sign === 0) sign = s; else if(s !== sign) return false;
  }
  return true;
}
function distPtSeg(px, py, ax, ay, bx, by){
  const dx = bx - ax, dy = by - ay, L = dx*dx + dy*dy;
  let t = L ? ((px - ax)*dx + (py - ay)*dy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t*dx), py - (ay + t*dy));
}
function pointInPoly(x, y, pts){
  let inside = false;
  for(let i = 0, j = pts.length - 1; i < pts.length; j = i++){
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if(((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function polyArea(pts){
  let a = 0;
  for(let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  return Math.abs(a / 2);
}
// facing: rot 0 = faces the front (toward -y); positive = clockwise seen from above
function facing(rot){ const a = rad(-90 - (rot || 0)); return [Math.cos(a), Math.sin(a)]; }

/* ---------- views ---------- */
class View{
  constructor(canvas, draw){
    this.c = canvas; this.ctx = canvas.getContext('2d'); this.draw = draw;
    this.s = 1; this.tx = 0; this.ty = 0; this.w = 0; this.h = 0; this.pendingFit = null;
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
  }
  resize(){
    const r = this.c.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.w = r.width; this.h = r.height;
    this.c.width = Math.max(1, Math.round(r.width * dpr));
    this.c.height = Math.max(1, Math.round(r.height * dpr));
    if(this.pendingFit && this.w > 0){ const f = this.pendingFit; this.pendingFit = null; this.fitRect(...f); }
    else this.render();
  }
  fitRect(x0, y0, cw, ch){
    if(!cw || !ch) { this.render(); return; }
    if(!this.w || !this.h){ this.pendingFit = [x0, y0, cw, ch]; return; }
    this.s = Math.min(this.w / cw, this.h / ch) * 0.94;
    this.tx = (this.w - cw * this.s) / 2 - x0 * this.s;
    this.ty = (this.h - ch * this.s) / 2 - y0 * this.s;
    this.render();
  }
  toScreen(x, y){ return [x * this.s + this.tx, y * this.s + this.ty]; }
  toContent(sx, sy){ return [(sx - this.tx) / this.s, (sy - this.ty) / this.s]; }
  zoomAt(sx, sy, f){
    const [cx, cy] = this.toContent(sx, sy);
    this.s = Math.min(3000, Math.max(0.02, this.s * f));
    this.tx = sx - cx * this.s; this.ty = sy - cy * this.s; this.render();
  }
  render(){
    if(!APP_READY) return;
    const dpr = window.devicePixelRatio || 1;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.clearRect(0, 0, this.w, this.h);
    this.draw(this.ctx, this);
  }
}
function bindPointer(view, h){
  const c = view.c;
  let down = null, pinch = null;
  const touches = new Map();
  const pos = e => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const pinchState = () => { const [a, b] = Array.from(touches.values()); return {d:Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, m:[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]}; };
  c.addEventListener('contextmenu', e => e.preventDefault());
  c.addEventListener('pointerdown', e => {
    c.setPointerCapture(e.pointerId);
    const [sx, sy] = pos(e);
    touches.set(e.pointerId, [sx, sy]);
    if(touches.size === 2){   // second finger: switch to pinch zoom / two-finger pan
      if(down && down.grabbed) h.release && h.release(down.moved, sx, sy);
      down = null; pinch = pinchState(); return;
    }
    if(touches.size > 2) return;
    down = {sx, sy, tx:view.tx, ty:view.ty, moved:false, grabbed:false};
    if(e.button === 0 && h.grab) down.grabbed = h.grab(sx, sy);
  });
  c.addEventListener('pointermove', e => {
    const [sx, sy] = pos(e);
    if(touches.has(e.pointerId)) touches.set(e.pointerId, [sx, sy]);
    if(pinch && touches.size >= 2){
      const n = pinchState();
      view.tx += n.m[0] - pinch.m[0]; view.ty += n.m[1] - pinch.m[1];
      view.zoomAt(n.m[0], n.m[1], n.d / pinch.d);
      pinch = n; return;
    }
    if(down){
      if(Math.hypot(sx - down.sx, sy - down.sy) > 4) down.moved = true;
      if(down.grabbed){ if(down.moved) h.drag && h.drag(sx, sy, e); }
      else if(down.moved){ view.tx = down.tx + sx - down.sx; view.ty = down.ty + sy - down.sy; view.render(); }
    }
    h.hover && h.hover(sx, sy);
  });
  const lift = e => { touches.delete(e.pointerId); if(pinch){ if(touches.size < 2) pinch = null; down = null; return true; } return false; };
  c.addEventListener('pointercancel', e => { lift(e); down = null; });
  c.addEventListener('pointerup', e => {
    const [sx, sy] = pos(e);
    if(lift(e)) return;
    if(down){
      if(down.grabbed){ h.release && h.release(down.moved, sx, sy); }
      else if(!down.moved && e.button === 0) h.click && h.click(sx, sy);
    }
    down = null;
  });
  c.addEventListener('pointerleave', () => h.leave && h.leave());
  c.addEventListener('wheel', e => {
    e.preventDefault();
    const [sx, sy] = pos(e);
    view.zoomAt(sx, sy, Math.pow(1.0015, -e.deltaY));
  }, {passive:false});
}

const imgView = new View($('imgCanvas'), drawImgView);
const topView = new View($('topCanvas'), drawTopView);

// world <-> screen for each view
const topS = (x, y) => topView.toScreen(x, -y);
const topW = (sx, sy) => { const [cx, cy] = topView.toContent(sx, sy); return [cx, -cy]; };
const imgS = (x, y) => { const q = worldToImg(x, y); return q ? imgView.toScreen(q[0], q[1]) : null; };
const imgW = (sx, sy) => { const [u, v] = imgView.toContent(sx, sy); return imgToWorld(u, v); };

function renderViews(){ imgView.render(); topView.render(); if(typeof render3d === 'function') render3d(); if(typeof updateActBar === 'function') updateActBar(); }

/* ---------- calibration & extent ---------- */
function recompute(persist){
  const hadH = !!H;
  H = null; Hinv = null;
  const P = stage.points;
  let msg = '';
  if(stage.image && P.length === 4 && stage.rect.width > 0 && effDepth() > 0){
    if(!quadIsConvex(P)) msg = '<div class="msg warn">四點圍成的形狀交叉或凹陷，請確認點的順序是後左、後右、前右、前左。</div>';
    else{
      H = homography(worldCorners(), P.map(p => [p.u, p.v]));
      Hinv = H ? invert3(H) : null;
      if(!H || !Hinv){ H = null; Hinv = null; msg = '<div class="msg warn">這四點無法計算校正，請重新點選。</div>'; }
    }
  }
  $('quadMsg').innerHTML = msg;
  updateExtent(!hadH && !!H && calibDrag < 0);
  syncUI();
  if(persist) saveStage();
}
function objPts(o){
  const k = OBJ[o.type] ? OBJ[o.type].kind : 'point';
  if(k === 'line') return [[o.x1, o.y1], [o.x2, o.y2]];
  if(k === 'poly') return o.pts || [];
  return [[o.x, o.y]];
}
function computeExtent(){
  let b = null;
  const add = (x, y, pad) => {
    if(!isFinite(x) || !isFinite(y)) return;
    if(!b) b = {xmin:x - pad, xmax:x + pad, ymin:y - pad, ymax:y + pad};
    else{ b.xmin = Math.min(b.xmin, x - pad); b.xmax = Math.max(b.xmax, x + pad); b.ymin = Math.min(b.ymin, y - pad); b.ymax = Math.max(b.ymax, y + pad); }
  };
  if(H){
    const {width:W, x0, y0} = stage.rect, D = effDepth(), m = stage.margins;
    add(x0 - m.side, y0 - m.front, 0); add(x0 + W + m.side, y0 + D + m.back, 0);
  }else if(stage.source !== 'stg'){
    add(0, 0, 0); add(10, 12, 0);
  }
  stage.objects.forEach(o => objPts(o).forEach(p => add(p[0], p[1], 1)));
  if(!b) b = {xmin:0, xmax:10, ymin:0, ymax:12};
  b.xmin = Math.floor(b.xmin); b.ymin = Math.floor(b.ymin); b.xmax = Math.ceil(b.xmax); b.ymax = Math.ceil(b.ymax);
  return b;
}
let firstTopFit = true;
function updateExtent(forceFit){
  topExt = computeExtent();
  renderTopImage();
  if(forceFit || firstTopFit){ fitTop(); firstTopFit = false; }
  renderViews();
}
function fitTop(){ const e = topExt; topView.fitRect(e.xmin, -e.ymax, e.xmax - e.xmin, e.ymax - e.ymin); }
function renderTopImage(){
  if(!H || !srcData){ topImgExt = null; topOffKey = ''; return; }
  const {width:W, x0, y0} = stage.rect, D = effDepth(), m = stage.margins;
  const e = {xmin:Math.min(topExt.xmin, x0 - m.side), xmax:Math.max(topExt.xmax, x0 + W + m.side),
             ymin:Math.min(topExt.ymin, y0 - m.front), ymax:Math.max(topExt.ymax, y0 + D + m.back)};
  const key = H.map(v => v.toPrecision(8)).join(',') + '|' + [e.xmin, e.xmax, e.ymin, e.ymax].join(',');
  if(key === topOffKey) return;
  topOffKey = key;
  let ppm = Math.min(60, 2400 / (e.xmax - e.xmin), 2400 / (e.ymax - e.ymin));
  const w = Math.max(1, Math.round((e.xmax - e.xmin) * ppm)), h = Math.max(1, Math.round((e.ymax - e.ymin) * ppm));
  topOff.width = w; topOff.height = h;
  const tctx = topOff.getContext('2d');
  const out = tctx.createImageData(w, h);
  const od = out.data, sd = srcData.data, SW = srcData.width, SH = srcData.height, M = H;
  for(let py = 0; py < h; py++){
    const y = e.ymax - (py + 0.5) / ppm;
    for(let px = 0; px < w; px++){
      const x = e.xmin + (px + 0.5) / ppm;
      const ww = M[6]*x + M[7]*y + M[8];
      const o = (py * w + px) * 4;
      if(!(ww > 0)){ od[o+3] = 0; continue; }
      const u = (M[0]*x + M[1]*y + M[2]) / ww - 0.5, v = (M[3]*x + M[4]*y + M[5]) / ww - 0.5;
      if(u < 0 || v < 0 || u >= SW - 1 || v >= SH - 1){ od[o+3] = 0; continue; }
      const iu = u | 0, iv = v | 0, fu = u - iu, fv = v - iv;
      const i00 = (iv * SW + iu) * 4, i10 = i00 + 4, i01 = i00 + SW * 4, i11 = i01 + 4;
      for(let c = 0; c < 3; c++) od[o+c] = (sd[i00+c]*(1-fu) + sd[i10+c]*fu)*(1-fv) + (sd[i01+c]*(1-fu) + sd[i11+c]*fu)*fv;
      od[o+3] = 255;
    }
  }
  tctx.putImageData(out, 0, 0);
  topImgExt = e;
}

/* ---------- objects ---------- */
function getObj(id){ return stage.objects.find(o => o.id === id); }
function nextLabel(type){
  const p = OBJ[type].prefix, re = new RegExp('^' + p + '(\\d+)$');
  let n = 0;
  stage.objects.forEach(o => { const m = (o.label || '').match(re); if(m) n = Math.max(n, +m[1]); });
  return p + (n + 1);
}
function targetSpec(size){ return size === 'micro' ? RULE_SPECS.microTarget : RULE_SPECS.paperTarget; }
// vertical extent of a paper target whose shoulders line up with the top of its stand
function targetZ(o){
  if(o.standTop == null) return null;
  const t = targetSpec(o.size), top = o.standTop + t.shoulder;
  return {top, bottom:top - t.h};
}
function applyStand(o, it){ o.standId = it ? it.id : null; o.standTop = it && it.dims.top != null ? it.dims.top : (it ? null : o.standTop); }
function targetW(size){ return size === 'micro' ? RULE_SPECS.microTarget.w : RULE_SPECS.paperTarget.w; }
function startObj(){ return stage.objects.find(o => o.type === 'start'); }
function faceToward(o, tx, ty){ const a = deg(Math.atan2(ty - o.y, tx - o.x)); o.rot = normDeg(-90 - a); }
function defaultRot(o){
  const s = startObj();
  if(s && s !== o) faceToward(o, s.x, s.y); else o.rot = 0;
}
function venueDims(type){
  const it = venueItems(type)[0];
  return it ? {specId:it.id, dims:it.dims} : null;
}
function newWindow(L){ return {off:Math.max(0, L/2 - 0.2), w:0.4, h:0.4, bottom:1.1, needOpen:false, holdOpen:false}; }
function setWallLength(o, v){
  const L = Math.hypot(o.x2 - o.x1, o.y2 - o.y1) || 1, ux = (o.x2 - o.x1) / L, uy = (o.y2 - o.y1) / L;
  o.x2 = o.x1 + ux * v; o.y2 = o.y1 + uy * v;
}
function wallFromSpec(o, it){
  o.specId = it ? it.id : null;
  if(it){
    const d = it.dims;
    o.h = d.h != null ? d.h : null;
    o.t = d.t != null ? d.t : 0.05;
    o.ports = d.pw != null && d.ph != null ? [{off:d.px != null ? d.px : 0, w:d.pw, h:d.ph, bottom:d.pb != null ? d.pb : 0, needOpen:false, holdOpen:false}] : [];
  }
}
function createPointObj(type, x, y){
  const o = {id:uid(), type, label:nextLabel(type), x, y, rot:0};
  if(type === 'start') o.label = '起始';
  if(type === 'paper'){ o.size = stage.defTarget; o.hits = 2; o.exposure = 'full'; const st = venueItems('stand'); applyStand(o, st.find(i => /中/.test(i.name)) || st[0]); }
  if(type === 'noshoot'){ o.size = stage.defTarget; o.cover = nearestPaper(x, y, 0.4); o.dz = -targetSpec(o.size).h / 2; o.mount = 'lower'; }
  if(type === 'popper'){ o.mini = false; }
  if(type === 'plate'){ o.shape = 'round'; o.d = 0.15; const v = venueDims('plate'); if(v && v.dims.d) o.d = v.dims.d; o.cy = v && v.dims.cy != null ? v.dims.cy : null; }
  if(type === 'stopplate'){ o.d = 0.15; const v = venueDims('stopplate'); if(v && v.dims.d) o.d = v.dims.d; o.cy = v && v.dims.cy != null ? v.dims.cy : null; }
  if(type === 'viewpoint'){ o.stance = 'stand'; o.eyeH = null; }
  if(type === 'barrel'){ const v = venueDims('barrel'); o.d = v && v.dims.d ? v.dims.d : 0.6; o.h = v && v.dims.h ? v.dims.h : 0.9; o.est = !(v && v.dims.d); }
  if(type === 'table'){ const v = venueDims('table'); o.w = v && v.dims.w ? v.dims.w : 0.9; o.dp = v && v.dims.dp ? v.dims.dp : 0.6; o.h = v && v.dims.h ? v.dims.h : 0.75; o.est = !(v && v.dims.w); }
  if(type === 'door'){ const v = venueDims('door'); o.w = v && v.dims.w ? v.dims.w : 0.8; o.h = v && v.dims.h ? v.dims.h : 1.8; o.est = !(v && v.dims.w); }
  if(type === 'prop'){ o.name = '道具'; o.w = 0.5; o.dp = 0.5; o.h = 0.5; }
  if(PERCH_DEF[type]) Object.assign(o, PERCH_DEF[type], {est:true});
  if(type === 'trigger'){ o.trig = 'laser'; o.len = 1.0; }
  if(type === 'paper' || type === 'noshoot') o.mech = newMech();
  if(['paper','noshoot','popper','plate','stopplate'].includes(type)) defaultRot(o);
  if(type === 'viewpoint') o.rot = 180;
  return o;
}
function createLineObj(type, a, b){
  const o = {id:uid(), type, label:nextLabel(type), x1:a[0], y1:a[1], x2:b[0], y2:b[1]};
  if(type === 'wall'){ o.h = null; o.t = 0.05; o.ports = []; wallFromSpec(o, venueItems('wall')[0]); }
  if(type === 'tunnel') Object.assign(o, TUNNEL_DEF);
  if(type === 'bridge') Object.assign(o, PERCH_DEF.bridge, {est:true});
  return o;
}
/* ---------- things to stand or sit on: podium / platform, bridge, boat, chair, horse ----------
   surface: height the shooter stands on; seat: height the shooter sits (or straddles) on. Sizes are estimates. */
const PERCH_DEF = {
  platform:{w:1.0, dp:1.0, h:0.4},
  bridge:{w:0.6, h:0.4},
  boat:{w:1.0, dp:2.2, h:0.2, rim:0.6, seat:0.45},
  chair:{w:0.45, dp:0.45, seat:0.45},
  horse:{w:0.5, dp:1.0, seat:0.8}
};
function boatHull(o){   // bow points along the object's facing
  const f = facing(o.rot || 0), p = [-f[1], f[0]], L = o.dp || 2.2, W = o.w || 1.0;
  const P = (a, b) => [o.x + f[0]*a + p[0]*b, o.y + f[1]*a + p[1]*b];
  return [P(-L/2, -W/2), P(L/4, -W/2), P(L/2, 0), P(L/4, W/2), P(-L/2, W/2)];
}
function inPoly(x, y, P){ let c = false; for(let i = 0, j = P.length - 1; i < P.length; j = i++){ const a = P[i], b = P[j]; if(((a[1] > y) !== (b[1] > y)) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
function perchFootprint(o){
  if(o.type === 'bridge'){ const L = Math.hypot(o.x2 - o.x1, o.y2 - o.y1) || 1e-6, u = [(o.x2 - o.x1)/L, (o.y2 - o.y1)/L], n = [-u[1], u[0]], w = (o.w || 0.6)/2;
    return [[o.x1 + n[0]*w, o.y1 + n[1]*w], [o.x2 + n[0]*w, o.y2 + n[1]*w], [o.x2 - n[0]*w, o.y2 - n[1]*w], [o.x1 - n[0]*w, o.y1 - n[1]*w]]; }
  if(o.type === 'boat') return boatHull(o);
  return rectPts(o.x, o.y, o.w || 0.5, o.dp || 0.5, o.rot || 0);
}
// height of what the shooter stands on at (x, y): platform top, bridge deck, boat floor; 0 on the ground
function surfaceAt(x, y){
  let h = 0;
  stage.objects.forEach(o => { if((o.type === 'platform' || o.type === 'bridge' || o.type === 'boat') && (o.type !== 'bridge' || o.x1 != null) && inPoly(x, y, perchFootprint(o))) h = Math.max(h, o.h || 0); });
  return h;
}
// a seat at (x, y): chair, boat bench or horse (straddled); within 40 cm of the object
function seatAt(x, y){
  let best = null, bd = 0.4;
  stage.objects.forEach(o => {
    if(o.type !== 'chair' && o.type !== 'boat' && o.type !== 'horse') return;
    const d = inPoly(x, y, perchFootprint(o)) ? 0 : Math.hypot(o.x - x, o.y - y);
    if(d <= bd){ bd = d; best = o; }
  });
  return best ? {obj:best, h:best.seat || 0.45, straddle:best.type === 'horse'} : null;
}
function drawPerchTop(ctx, toS, o, hi){
  if(o.type === 'bridge' && o.x1 == null) return;
  const P = perchFootprint(o), fill = {platform:'rgba(150,120,80,.30)', bridge:'rgba(150,120,80,.30)', boat:'rgba(70,110,150,.25)', chair:'rgba(120,90,60,.35)', horse:'rgba(184,67,58,.30)'}[o.type];
  if(pathW(ctx, toS, P, true)){ ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = hi || COL.board; ctx.lineWidth = 2; ctx.stroke(); }
  if(o.type === 'chair'){ const f = facing(o.rot || 0), pp = [-f[1], f[0]], w = (o.w || 0.45)/2, b = -(o.dp || 0.45)/2;
    if(pathW(ctx, toS, [[o.x + f[0]*b - pp[0]*w, o.y + f[1]*b - pp[1]*w], [o.x + f[0]*b + pp[0]*w, o.y + f[1]*b + pp[1]*w]])){ ctx.strokeStyle = hi || COL.ink; ctx.lineWidth = 3; ctx.stroke(); } }
  const c = o.type === 'bridge' ? [(o.x1 + o.x2)/2, (o.y1 + o.y2)/2] : [o.x, o.y];
  const hh = o.type === 'chair' || o.type === 'horse' ? '座高 ' + Math.round((o.seat || 0.45)*100) : '高 ' + Math.round((o.h || 0)*100);
  labelAt(ctx, toS, o.label + ' ' + OBJ[o.type].label.replace(/（.*）/, '') + ' ' + hh, c[0], c[1], '#7A5424');
}
function renderPerchProps(p, o, upd){
  const num = (lab, k, min) => numField(lab, o[k], 100, v => { if(v != null && v >= (min || 0)){ o[k] = v; o.est = false; upd(false); } }, '1');
  if(o.type === 'platform') p.appendChild(row(num('寬（公分）', 'w', 0.2), num('深（公分）', 'dp', 0.2), num('高（公分）', 'h', 0.05)));
  if(o.type === 'bridge') p.appendChild(row(num('寬（公分）', 'w', 0.2), num('高（公分）', 'h', 0.05)));
  if(o.type === 'boat'){ p.appendChild(row(num('寬（公分）', 'w', 0.4), num('長（公分）', 'dp', 0.8))); p.appendChild(row(num('船底高（公分）', 'h', 0), num('船舷高（公分）', 'rim', 0.1), num('座板高（公分）', 'seat', 0.1))); }
  if(o.type === 'chair') p.appendChild(row(num('座面高（公分）', 'seat', 0.2), num('寬（公分）', 'w', 0.2)));
  if(o.type === 'horse') p.appendChild(row(num('鞍座高（公分）', 'seat', 0.3), num('長（公分）', 'dp', 0.4)));
  const use = {platform:'站上去射擊，眼高會加上平台高度。', bridge:'由一端點到另一端；可走過或在橋上射擊，眼高會加上橋面高度，上下橋的時間計入移動。', boat:'固定不動的船；可站在船上（眼高加船底高）或坐在座板上（路線計畫姿勢選「坐姿」）。船舷會遮擋低的視線。', chair:'坐姿起始或坐著射擊用：起始條件選「坐在椅子、船上」，或路線計畫姿勢選「坐姿」。', horse:'跨坐用（馬、鞍座或倒放的油桶）：起始條件選「跨坐」，或路線計畫姿勢選「坐姿」。'}[o.type];
  p.appendChild(el('p', {class:'help', text:use + '尺寸與上下、起身時間為估計值，請依現場修改（時間在射手參數）。'}));
}
/* ---------- Cooper tunnel ----------
   A low frame (inverted U) along a centre line from entrance to exit. Loose slats rest across the two
   side rails at the top; knocking one down costs a procedural error each (per the WSB). */
const TUNNEL_DEF = {w:0.9, h:1.3, slat:0.25, sides:'open', knockP:0.03};
const TUNNEL_SIDES = [['open','開放框架（看得穿）'],['mesh','鐵網（看得穿）'],['panel','封板（擋視線）']];
function tunnelGeom(o){
  const L = Math.hypot(o.x2 - o.x1, o.y2 - o.y1) || 1e-6, u = [(o.x2 - o.x1) / L, (o.y2 - o.y1) / L], n = [-u[1], u[0]], w = o.w || TUNNEL_DEF.w;
  const P = (s, q) => [o.x1 + u[0]*s + n[0]*q, o.y1 + u[1]*s + n[1]*q];
  const nSlat = Math.max(1, Math.floor(L / (o.slat || TUNNEL_DEF.slat)) + 1);
  const slats = []; for(let i = 0; i < nSlat; i++) slats.push(nSlat === 1 ? L/2 : (L * i) / (nSlat - 1));
  return {L, u, n, w, h:o.h || TUNNEL_DEF.h, P, corners:[P(0, -w/2), P(L, -w/2), P(L, w/2), P(0, w/2)], slats};
}
// part of the segment a->b that runs inside the tunnel footprint, and how many slats it passes under
function tunnelInside(o, a, b){
  const g = tunnelGeom(o), loc = p => [(p[0] - o.x1)*g.u[0] + (p[1] - o.y1)*g.u[1], (p[0] - o.x1)*g.n[0] + (p[1] - o.y1)*g.n[1]];
  const A = loc(a), B = loc(b), d = [B[0] - A[0], B[1] - A[1]];
  let t0 = 0, t1 = 1;
  const clip = (p, q) => { if(Math.abs(p) < 1e-12) return q >= 0; const r = q / p; if(p < 0){ if(r > t1) return false; if(r > t0) t0 = r; } else { if(r < t0) return false; if(r < t1) t1 = r; } return true; };
  if(!(clip(-d[0], A[0]) && clip(d[0], g.L - A[0]) && clip(-d[1], A[1] + g.w/2) && clip(d[1], g.w/2 - A[1]))) return {len:0, slats:0, idx:[]};
  const len = Math.hypot(d[0], d[1]) * Math.max(0, t1 - t0);
  const s0 = A[0] + d[0]*t0, s1 = A[0] + d[0]*t1, lo = Math.min(s0, s1), hi = Math.max(s0, s1);
  const idx = []; g.slats.forEach((s, i) => { if(len > 0.05 && s >= lo - 1e-6 && s <= hi + 1e-6) idx.push(i); });
  return {len, slats:idx.length, idx};
}
function inTunnel(x, y){
  return stage.objects.find(o => { if(o.type !== 'tunnel' || o.x1 == null) return false; const g = tunnelGeom(o); const s = (x - o.x1)*g.u[0] + (y - o.y1)*g.u[1], q = (x - o.x1)*g.n[0] + (y - o.y1)*g.n[1]; return s >= 0 && s <= g.L && Math.abs(q) <= g.w/2; }) || null;
}
// older files stored the tunnel as a polygon: turn it into an entrance-to-exit centre line with a width
function migrateObjects(objs){
  (objs || []).forEach(o => {
    if(o.type === 'tunnel' && Array.isArray(o.pts) && o.x1 == null && o.pts.length >= 3){
      let best = [1, 0], bl = 0;
      o.pts.forEach((p, i) => { const q = o.pts[(i+1) % o.pts.length], l = Math.hypot(q[0] - p[0], q[1] - p[1]); if(l > bl){ bl = l; best = [(q[0] - p[0]) / l, (q[1] - p[1]) / l]; } });
      const n = [-best[1], best[0]], su = o.pts.map(p => p[0]*best[0] + p[1]*best[1]), sn = o.pts.map(p => p[0]*n[0] + p[1]*n[1]);
      const u0 = Math.min(...su), u1 = Math.max(...su), n0 = Math.min(...sn), n1 = Math.max(...sn), nm = (n0 + n1) / 2;
      o.x1 = best[0]*u0 + n[0]*nm; o.y1 = best[1]*u0 + n[1]*nm; o.x2 = best[0]*u1 + n[0]*nm; o.y2 = best[1]*u1 + n[1]*nm;
      Object.keys(TUNNEL_DEF).forEach(k => { if(o[k] == null) o[k] = TUNNEL_DEF[k]; }); o.w = Math.max(0.4, n1 - n0); delete o.pts;
    }else if(o.type === 'tunnel') Object.keys(TUNNEL_DEF).forEach(k => { if(o[k] == null) o[k] = TUNNEL_DEF[k]; });
  });
}
function drawTunnelTop(ctx, toS, o, hi){
  if(o.x1 == null) return;
  const g = tunnelGeom(o);
  if(pathW(ctx, toS, g.corners, true)){ ctx.fillStyle = 'rgba(185,139,78,.18)'; ctx.fill(); }
  const seg = (a, b, col, lw, dash) => { const p = toS(a[0], a[1]), q = toS(b[0], b[1]); if(!p || !q) return; ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.setLineDash(dash || []); ctx.stroke(); ctx.setLineDash([]); };
  g.slats.forEach(s => seg(g.P(s, -g.w/2 - 0.04), g.P(s, g.w/2 + 0.04), 'rgba(140,100,50,.85)', 1.2));
  seg(g.P(0, -g.w/2), g.P(g.L, -g.w/2), hi || COL.board, o.sides === 'panel' ? 4 : 2.5);
  seg(g.P(0, g.w/2), g.P(g.L, g.w/2), hi || COL.board, o.sides === 'panel' ? 4 : 2.5);
  seg(g.P(-0.3, 0), g.P(0.1, 0), hi || COL.board, 1.5, [3, 3]);
  labelAt(ctx, toS, o.label + ' 礦工隧道 高 ' + Math.round(g.h*100) + ' 公分', ...g.P(g.L/2, 0), COL.board);
}
function renderTunnelProps(p, o, upd){
  const g = tunnelGeom(o);
  p.appendChild(row(numField('高度（公分）', o.h, 100, v => { if(v > 0.3){ o.h = v; upd(false); } }, '1'),
                    numField('寬度（公分）', o.w, 100, v => { if(v > 0.3){ o.w = v; upd(false); } }, '1')));
  p.appendChild(row(numField('橫條間距（公分）', o.slat, 100, v => { if(v > 0.05){ o.slat = v; upd(false); } }, '1'),
                    selField('兩側', TUNNEL_SIDES, o.sides || 'open', v => { o.sides = v; upd(false); })));
  p.appendChild(numField('每通過一根橫條的碰落機率（%）', o.knockP, 100, v => { if(v != null && v >= 0 && v <= 1){ o.knockP = v; upd(false); } }, '0.5'));
  p.appendChild(el('div', {class:'readout', text:'長 ' + fmt(g.L) + ' 公尺，頂部 ' + g.slats.length + ' 根鬆放的橫條。'}));
  p.appendChild(el('p', {class:'help', text:'由入口中央點到出口中央。頂部橫條只是放在兩側框架上，碰落一根記一個 PE（依 WSB 規定）。路線計畫會：檢查在隧道內停頓時頭頂是否高過隧道、以「礦工隧道內移動速度」計算穿越時間、依通過的橫條數與碰落機率估計 PE 扣分。碰落機率為估計值，姿勢越低、動作越穩，機率越低，請依自己的經驗調整。'}));
}
function createPolyObj(type, pts){ return {id:uid(), type, label:nextLabel(type), pts:pts.map(p => [p[0], p[1]])}; }
function nearestPaper(x, y, maxD){
  let best = null, bd = maxD;
  stage.objects.forEach(o => { if(o.type === 'paper'){ const d = Math.hypot(o.x - x, o.y - y); if(d <= bd){ bd = d; best = o.id; } } });
  return best;
}
function addObj(o){ stage.objects.push(o); selId = o.id; objectsChanged(true); }
function deleteSel(){
  const o = getObj(selId); if(!o) return;
  stage.objects = stage.objects.filter(x => x !== o);
  stage.objects.forEach(x => { if(x.type === 'noshoot' && x.cover === o.id) x.cover = null; });
  if(o.type === 'viewpoint') stage.objects.forEach(x => { if(Array.isArray(x.hideFrom)){ x.hideFrom = x.hideFrom.filter(id => id !== o.id); if(!x.hideFrom.length) delete x.hideFrom; } });
  selId = null; objectsChanged(true);
}
function objectsChanged(extent){
  if(extent) updateExtent(false); else renderViews();
  renderList(); renderProps(); renderStartCond(); renderVisPanel(); planCache = null; renderPlanPanel(); if(typeof renderResultsPanel === 'function') renderResultsPanel(); if(leftTab === '3d') refresh3dModes(); syncUI(); saveStage();
  layoutChanged();
}
// anything that depends on the layout must not keep showing the previous one
function layoutChanged(){
  if(typeof renderSuggest === 'function') renderSuggest();
  if(typeof RP !== 'undefined' && RP.on && typeof refreshReplayForPlan === 'function') refreshReplayForPlan();
}

function findFaces(segs, tol){
  // segs: [{a:[x,y], b:[x,y], type, ref}]
  const pts = [];
  const nodeOf = (p) => {
    for(let i = 0; i < pts.length; i++) if(Math.hypot(pts[i][0]-p[0], pts[i][1]-p[1]) <= tol) return i;
    pts.push([p[0], p[1]]); return pts.length - 1;
  };
  // split parameters for each segment
  const cuts = segs.map(() => [0, 1]);
  const segPt = (s, t) => [s.a[0] + (s.b[0]-s.a[0])*t, s.a[1] + (s.b[1]-s.a[1])*t];
  const proj = (s, p) => {
    const dx = s.b[0]-s.a[0], dy = s.b[1]-s.a[1], L2 = dx*dx + dy*dy;
    if(!L2) return null;
    const t = ((p[0]-s.a[0])*dx + (p[1]-s.a[1])*dy) / L2;
    if(t <= 0 || t >= 1) return null;
    const q = segPt(s, t);
    return Math.hypot(q[0]-p[0], q[1]-p[1]) <= tol ? t : null;
  };
  for(let i = 0; i < segs.length; i++){
    for(let j = 0; j < segs.length; j++){
      if(i === j) continue;
      const s = segs[i], o = segs[j];
      [o.a, o.b].forEach(p => { const t = proj(s, p); if(t != null) cuts[i].push(t); });
      if(i < j){
        const x1=s.a[0],y1=s.a[1],x2=s.b[0],y2=s.b[1],x3=o.a[0],y3=o.a[1],x4=o.b[0],y4=o.b[1];
        const den = (x1-x2)*(y3-y4) - (y1-y2)*(x3-x4);
        if(Math.abs(den) > 1e-12){
          const t = ((x1-x3)*(y3-y4) - (y1-y3)*(x3-x4)) / den, u = -((x1-x2)*(y1-y3) - (y1-y2)*(x1-x3)) / den;
          if(t > 0 && t < 1 && u > 0 && u < 1){ cuts[i].push(t); cuts[j].push(u); }
        }
      }
    }
  }
  const edges = new Map();
  segs.forEach((s, i) => {
    const ts = Array.from(new Set(cuts[i].map(t => Math.round(t*1e6)/1e6))).sort((a,b)=>a-b);
    for(let k = 0; k < ts.length - 1; k++){
      const u = nodeOf(segPt(s, ts[k])), v = nodeOf(segPt(s, ts[k+1]));
      if(u === v) continue;
      const key = u < v ? u + '-' + v : v + '-' + u;
      const prev = edges.get(key);
      if(!prev) edges.set(key, {u, v, types:new Set([s.type]), refs:new Set([s.ref])});
      else { prev.types.add(s.type); prev.refs.add(s.ref); }
    }
  });
  // adjacency + prune dangling
  let adj = pts.map(() => new Set());
  edges.forEach(e => { adj[e.u].add(e.v); adj[e.v].add(e.u); });
  let changed = true;
  while(changed){
    changed = false;
    adj.forEach((s, i) => { if(s.size === 1){ const j = [...s][0]; s.delete(j); adj[j].delete(i); changed = true; } });
  }
  const sorted = adj.map((s, i) => [...s].sort((a, b) =>
    Math.atan2(pts[a][1]-pts[i][1], pts[a][0]-pts[i][0]) - Math.atan2(pts[b][1]-pts[i][1], pts[b][0]-pts[i][0])));
  const seen = new Set(), faces = [];
  sorted.forEach((nb, u) => nb.forEach(v => {
    if(seen.has(u + '>' + v)) return;
    const cyc = []; let a = u, b = v, guard = 0;
    while(!seen.has(a + '>' + b) && guard++ < 10000){
      seen.add(a + '>' + b); cyc.push(a);
      const list = sorted[b], idx = list.indexOf(a);
      const c = list[(idx - 1 + list.length) % list.length];
      a = b; b = c;
    }
    let area = 0;
    for(let k = 0; k < cyc.length; k++){ const p = pts[cyc[k]], q = pts[cyc[(k+1)%cyc.length]]; area += p[0]*q[1] - q[0]*p[1]; }
    const types = new Set(), refs = new Set();
    for(let k = 0; k < cyc.length; k++){ const x = cyc[k], y = cyc[(k+1)%cyc.length]; const e = edges.get(x < y ? x+'-'+y : y+'-'+x); if(e){ e.types.forEach(t => types.add(t)); e.refs.forEach(r => refs.add(r)); } }
    faces.push({pts:cyc.map(i => pts[i]), area:area/2, types, refs});
  }));
  return faces;
}

const SNAP_TOL = 0.25;  // meters: wall / fault line ends closer than this are treated as connected
function generateAreas(){
  stage.objects = stage.objects.filter(o => !(o.type === 'area' && o.auto));
  const segs = stage.objects.filter(o => o.type === 'wall' || o.type === 'faultline')
    .map(o => ({a:[o.x1, o.y1], b:[o.x2, o.y2], type:o.type, ref:o.id}));
  const faces = findFaces(segs, SNAP_TOL).filter(f => f.area > 0.3 && f.types.has('faultline'));
  faces.forEach(f => {
    const o = createPolyObj('area', f.pts); o.auto = true; o.refs = [...f.refs];
    stage.objects.push(o);
  });
  return faces.length;
}
function snapWorld(w, sx, sy, toS, excludeId){
  if(!w) return {w, snap:null};
  let best = null, bd = 12;
  stage.objects.forEach(o => {
    if(o.id === excludeId) return;
    const cand = (o.type === 'wall' || o.type === 'faultline') ? [[o.x1, o.y1], [o.x2, o.y2]] : (o.type === 'area' && !o.auto) ? o.pts : [];
    cand.forEach(p => { const q = toS(p[0], p[1]); if(!q) return; const d = Math.hypot(q[0] - sx, q[1] - sy); if(d < bd){ bd = d; best = [p[0], p[1]]; } });
  });
  if(best) return {w:best, snap:best};
  bd = 8;
  stage.objects.forEach(o => {
    if(o.id === excludeId || (o.type !== 'wall' && o.type !== 'faultline')) return;
    const a = toS(o.x1, o.y1), b = toS(o.x2, o.y2); if(!a || !b) return;
    const d = distPtSeg(sx, sy, a[0], a[1], b[0], b[1]);
    if(d < bd){
      const dx = o.x2 - o.x1, dy = o.y2 - o.y1, L2 = dx*dx + dy*dy || 1;
      const t = Math.max(0, Math.min(1, ((w[0] - o.x1)*dx + (w[1] - o.y1)*dy) / L2));
      bd = d; best = [o.x1 + dx*t, o.y1 + dy*t];
    }
  });
  return best ? {w:best, snap:best} : {w, snap:null};
}
const SNAP_TOOLS = ['wall','faultline','area'];
function isBoundaryLine(o){ return stage.objects.some(a => a.type === 'area' && a.auto && (a.refs || []).includes(o.id)); }

/* ---------- drawing (shared by both views) ---------- */
const COL = {ink:'#1E2B38', tape:'#C8372D', board:'#B98B4E', grid:'#2F6FA8', sel:'#2F6FA8', white:'#ffffff', ok:'#2F7D4F'};
function pathW(ctx, toS, pts, close){
  const s = pts.map(p => toS(p[0], p[1]));
  if(s.some(q => !q)) return false;
  ctx.beginPath();
  s.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]));
  if(close) ctx.closePath();
  return true;
}
function circlePts(cx, cy, r, n = 24){ const a = []; for(let i = 0; i < n; i++){ const t = i / n * Math.PI * 2; a.push([cx + r*Math.cos(t), cy + r*Math.sin(t)]); } return a; }
function rectPts(cx, cy, w, dp, rot){
  const f = facing(rot), p = [-f[1], f[0]];
  const hw = w/2, hd = dp/2;
  return [[-hw,-hd],[hw,-hd],[hw,hd],[-hw,hd]].map(([a, b]) => [cx + p[0]*a + f[0]*b, cy + p[1]*a + f[1]*b]);
}
function label(ctx, text, x, y, color){
  ctx.font = '600 12px "Noto Sans TC","Microsoft JhengHei",sans-serif';
  const w = ctx.measureText(text).width;
  ctx.fillStyle = 'rgba(255,255,255,.88)'; ctx.fillRect(x - 3, y - 12, w + 6, 16);
  ctx.fillStyle = color; ctx.fillText(text, x, y);
}
function labelAt(ctx, toS, text, x, y, color){ const q = toS(x, y); if(q) label(ctx, text, q[0] + 8, q[1] - 8, color); }

function drawObj(ctx, toS, o, selected){
  const hi = selected ? COL.sel : null;
  ctx.setLineDash([]);
  switch(o.type){
    case 'area':
      if(pathW(ctx, toS, o.pts, true)){
        ctx.fillStyle = 'rgba(234,196,80,.28)'; ctx.fill();
        if(!o.auto || hi){ ctx.strokeStyle = hi || COL.tape; ctx.lineWidth = o.auto ? 1.5 : 2.5; if(o.auto) ctx.setLineDash([4,3]); ctx.stroke(); ctx.setLineDash([]); }
      }
      if(o.pts.length) labelAt(ctx, toS, o.label, ...centroid(o.pts), COL.tape);
      break;
    case 'tunnel': { drawTunnelTop(ctx, toS, o, hi); break; }
    case 'tunnelOld':
      if(pathW(ctx, toS, o.pts, true)){ ctx.fillStyle = 'rgba(185,139,78,.25)'; ctx.fill(); ctx.setLineDash([6,4]); ctx.strokeStyle = hi || COL.board; ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]); }
      if(o.pts.length) labelAt(ctx, toS, o.label + ' 礦工隧道', ...centroid(o.pts), COL.board);
      break;
    case 'faultline': {
      if(pathW(ctx, toS, [[o.x1,o.y1],[o.x2,o.y2]])){ ctx.strokeStyle = hi || COL.tape; ctx.lineWidth = 3; ctx.stroke(); }
      if(!isBoundaryLine(o)){
        // stand-alone fault line: deemed to extend to infinity (rule 2.2.1.4)
        const L = Math.hypot(o.x2 - o.x1, o.y2 - o.y1) || 1, ux = (o.x2 - o.x1) / L, uy = (o.y2 - o.y1) / L, ext = 1.5;
        ctx.setLineDash([2,4]); ctx.strokeStyle = 'rgba(200,55,45,.55)'; ctx.lineWidth = 2;
        if(pathW(ctx, toS, [[o.x1, o.y1], [o.x1 - ux*ext, o.y1 - uy*ext]])) ctx.stroke();
        if(pathW(ctx, toS, [[o.x2, o.y2], [o.x2 + ux*ext, o.y2 + uy*ext]])) ctx.stroke();
        ctx.setLineDash([]);
      }
      break;
    }
    case 'wall': {
      if(pathW(ctx, toS, [[o.x1,o.y1],[o.x2,o.y2]])){
        ctx.strokeStyle = hi || (o.soft || o.seeThrough ? '#7F97AE' : COL.ink); ctx.lineWidth = o.h != null && o.h >= 1.8 ? 5 : 3.5;
        if(o.soft || o.seeThrough) ctx.setLineDash([7,3]);
        ctx.stroke(); ctx.setLineDash([]);
      }
      const L = Math.hypot(o.x2 - o.x1, o.y2 - o.y1) || 1, ux = (o.x2 - o.x1) / L, uy = (o.y2 - o.y1) / L;
      (o.ports || []).forEach(p => {
        const a = [o.x1 + ux*p.off, o.y1 + uy*p.off], b = [o.x1 + ux*(p.off + p.w), o.y1 + uy*(p.off + p.w)];
        if(pathW(ctx, toS, [a, b])){ ctx.strokeStyle = p.needOpen ? '#9B7BC8' : '#E8C46A'; ctx.lineWidth = 5; ctx.stroke(); }
      });
      labelAt(ctx, toS, o.label, (o.x1 + o.x2)/2, (o.y1 + o.y2)/2, COL.ink);
      break;
    }
    case 'paper': {
      const w = targetW(o.size), f = facing(o.rot), p = [-f[1], f[0]];
      const a = [o.x - p[0]*w/2, o.y - p[1]*w/2], b = [o.x + p[0]*w/2, o.y + p[1]*w/2];
      if(pathW(ctx, toS, [a, b])){ ctx.strokeStyle = hi || COL.board; ctx.lineWidth = 5; ctx.stroke(); }
      if(pathW(ctx, toS, [[o.x, o.y], [o.x + f[0]*0.3, o.y + f[1]*0.3]])){ ctx.strokeStyle = hi || COL.board; ctx.lineWidth = 1.5; ctx.stroke(); }
      const ns = stage.objects.filter(x => x.type === 'noshoot' && x.cover === o.id).map(x => x.label);
      const q = toS(o.x, o.y);
      if(q){
        // label placed behind the target face so it never sits on top of the no-shoot bar
        const q2 = toS(o.x - f[0]*0.25, o.y - f[1]*0.25) || q;
        const ms = isMech(o) ? '（' + MECH_SHORT[o.mech.type] + '）' : '';
        label(ctx, o.label + ms + (ns.length ? ' ＋' + ns.join('、') : ''), q2[0] + 8, q2[1] - 8, isMech(o) ? '#6B3FA0' : '#7A5424');
      }
      break;
    }
    case 'noshoot': {
      const d = nsDisplay(o, toS);
      if(!d) break;
      const w = targetW(o.size);
      const a = [d.x - d.p[0]*w/2, d.y - d.p[1]*w/2], b = [d.x + d.p[0]*w/2, d.y + d.p[1]*w/2];
      if(pathW(ctx, toS, [a, b])){
        ctx.lineCap = 'butt';
        ctx.strokeStyle = hi || COL.ink; ctx.lineWidth = 7; ctx.stroke();
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3.5; ctx.stroke();
      }
      if(!o.cover || selected){ const q = toS(d.x, d.y); if(q) label(ctx, o.label, q[0] + 8, q[1] + 16, COL.ink); }
      break;
    }
    case 'popper': case 'plate': case 'stopplate': case 'barrel': {
      let r = 0.1;
      if(o.type === 'popper') r = (o.mini ? RULE_SPECS.miniPopper.headD : RULE_SPECS.popper.headD) / 2;
      else if(o.type === 'plate' || o.type === 'stopplate') r = (o.d || 0.15) / 2;
      else if(o.type === 'barrel') r = (o.d || 0.6) / 2;
      const pts = (o.type === 'plate' && o.shape === 'square') ? rectPts(o.x, o.y, o.d, o.d, o.rot) : circlePts(o.x, o.y, r);
      if(pathW(ctx, toS, pts, true)){
        ctx.fillStyle = o.type === 'stopplate' ? 'rgba(200,55,45,.85)' : o.type === 'barrel' ? 'rgba(200,55,45,.25)' : 'rgba(255,255,255,.9)';
        ctx.fill(); ctx.strokeStyle = hi || (o.type === 'barrel' ? COL.tape : COL.ink); ctx.lineWidth = 2; ctx.stroke();
      }
      const q = toS(o.x, o.y);
      if(q && o.type !== 'barrel'){ ctx.beginPath(); ctx.arc(q[0], q[1], 3, 0, Math.PI*2); ctx.fillStyle = hi || COL.ink; ctx.fill(); }
      labelAt(ctx, toS, o.label, o.x, o.y, o.type === 'stopplate' ? COL.tape : COL.ink);
      break;
    }
    case 'platform': case 'boat': case 'chair': case 'horse': case 'bridge': drawPerchTop(ctx, toS, o, hi); break;
    case 'table': case 'prop':
      if(pathW(ctx, toS, rectPts(o.x, o.y, o.w, o.dp, o.rot), true)){ ctx.fillStyle = 'rgba(185,139,78,.3)'; ctx.fill(); ctx.strokeStyle = hi || COL.board; ctx.lineWidth = 2; ctx.stroke(); }
      labelAt(ctx, toS, o.type === 'prop' ? (o.name || o.label) : o.label, o.x, o.y, '#7A5424');
      break;
    case 'door': {
      const f = facing(o.rot), p = [-f[1], f[0]];
      if(pathW(ctx, toS, [[o.x - p[0]*o.w/2, o.y - p[1]*o.w/2], [o.x + p[0]*o.w/2, o.y + p[1]*o.w/2]])){ ctx.setLineDash([8,4]); ctx.strokeStyle = hi || COL.ink; ctx.lineWidth = 3; ctx.stroke(); ctx.setLineDash([]); }
      labelAt(ctx, toS, o.label, o.x, o.y, COL.ink);
      break;
    }
    case 'trigger': {
      const f = facing(o.rot), p = [-f[1], f[0]], purple = hi || '#6B3FA0';
      if(o.trig === 'laser'){
        const L = o.len || 1;
        if(pathW(ctx, toS, [[o.x - p[0]*L/2, o.y - p[1]*L/2], [o.x + p[0]*L/2, o.y + p[1]*L/2]])){ ctx.setLineDash([6,3]); ctx.strokeStyle = purple; ctx.lineWidth = 2.5; ctx.stroke(); ctx.setLineDash([]); }
        [[o.x - p[0]*L/2, o.y - p[1]*L/2], [o.x + p[0]*L/2, o.y + p[1]*L/2]].forEach(e => { const q = toS(e[0], e[1]); if(q){ ctx.beginPath(); ctx.arc(q[0], q[1], 4, 0, Math.PI*2); ctx.fillStyle = purple; ctx.fill(); } });
      }else if(o.trig === 'pedal'){
        if(pathW(ctx, toS, rectPts(o.x, o.y, 0.4, 0.4, o.rot), true)){ ctx.fillStyle = 'rgba(107,63,160,.25)'; ctx.fill(); ctx.strokeStyle = purple; ctx.lineWidth = 2; ctx.stroke(); }
      }else{
        if(pathW(ctx, toS, circlePts(o.x, o.y, 0.12), true)){ ctx.fillStyle = 'rgba(107,63,160,.35)'; ctx.fill(); ctx.strokeStyle = purple; ctx.lineWidth = 2; ctx.stroke(); }
      }
      labelAt(ctx, toS, o.label + ' ' + ({laser:'雷射', pedal:'踏板', rope:'手拉', other:'機關'}[o.trig] || ''), o.x, o.y, '#6B3FA0');
      break;
    }
    case 'viewpoint': {
      const f = facing(o.rot);
      if(pathW(ctx, toS, circlePts(o.x, o.y, 0.18), true)){ ctx.fillStyle = 'rgba(47,111,168,.2)'; ctx.fill(); ctx.strokeStyle = hi || COL.grid; ctx.lineWidth = 2; ctx.stroke(); }
      if(pathW(ctx, toS, [[o.x, o.y], [o.x + f[0]*0.4, o.y + f[1]*0.4]])){ ctx.strokeStyle = hi || COL.grid; ctx.lineWidth = 2; ctx.stroke(); }
      labelAt(ctx, toS, o.label + (o.stance && o.stance !== 'stand' ? ' ' + POSTURE_NAME[o.stance] : ''), o.x, o.y, COL.grid);
      break;
    }
    case 'start': {
      const f = facing(o.rot), p = [-f[1], f[0]];
      const tri = [[o.x + f[0]*0.35, o.y + f[1]*0.35], [o.x - f[0]*0.2 + p[0]*0.22, o.y - f[1]*0.2 + p[1]*0.22], [o.x - f[0]*0.2 - p[0]*0.22, o.y - f[1]*0.2 - p[1]*0.22]];
      if(pathW(ctx, toS, tri, true)){ ctx.fillStyle = hi || COL.grid; ctx.fill(); }
      const c = stage.startCond, onBody = [];
      if(c.gunLoc === 'holster') onBody.push('槍在槍套');
      if(c.ready === 'unloaded' && c.magLoc === 'body') onBody.push('匣在身上');
      labelAt(ctx, toS, o.label + (onBody.length ? '｜' + onBody.join('、') : ''), o.x, o.y, COL.grid);
      break;
    }
  }
  if(selected) drawHandles(ctx, toS, o);
}
function drawMechDecor(ctx, toS, o){
  if(!isMech(o)) return;
  const m = o.mech, purple = '#6B3FA0';
  if(m.type === 'slider' && m.ex != null){
    if(pathW(ctx, toS, [[o.x, o.y], [m.ex, m.ey]])){ ctx.setLineDash([5,4]); ctx.strokeStyle = purple; ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]); }
    const q = toS(m.ex, m.ey); if(q){ ctx.beginPath(); ctx.arc(q[0], q[1], 5, 0, Math.PI*2); ctx.strokeStyle = purple; ctx.lineWidth = 2; ctx.stroke(); label(ctx, o.label + ' 終點', q[0] + 8, q[1] - 8, purple); }
  }
  if(m.type === 'swinger'){
    const f = facing(o.rot), base = Math.atan2(f[1], f[0]) + Math.PI, r = 0.28, span = rad(Math.min(170, (m.amp || 90)) / 2);
    const pts = []; for(let i = 0; i <= 16; i++){ const t = base - span + 2*span*i/16; pts.push([o.x + r*Math.cos(t), o.y + r*Math.sin(t)]); }
    if(pathW(ctx, toS, pts)){ ctx.strokeStyle = purple; ctx.lineWidth = 1.5; ctx.stroke(); }
  }
  if(m.type === 'disappear' || m.type === 'monkey' || m.type === 'other'){
    const w = targetW(o.size) + 0.12;
    if(pathW(ctx, toS, rectPts(o.x, o.y, w, 0.16, o.rot), true)){ ctx.setLineDash([3,3]); ctx.strokeStyle = purple; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]); }
  }
}
function drawActLinks(ctx, toS){
  stage.objects.forEach(o => {
    if(!isMech(o) || o.mech.act.mode !== 'object') return;
    const a = getObj(o.mech.act.id); if(!a) return;
    const p = toS(a.x, a.y), q = toS(o.x, o.y); if(!p || !q) return;
    ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]);
    ctx.setLineDash([2,4]); ctx.strokeStyle = 'rgba(107,63,160,.8)'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
    const ang = Math.atan2(q[1] - p[1], q[0] - p[0]), L = 9;
    ctx.beginPath(); ctx.moveTo(q[0], q[1]); ctx.lineTo(q[0] - L*Math.cos(ang - 0.4), q[1] - L*Math.sin(ang - 0.4)); ctx.lineTo(q[0] - L*Math.cos(ang + 0.4), q[1] - L*Math.sin(ang + 0.4)); ctx.closePath();
    ctx.fillStyle = 'rgba(107,63,160,.8)'; ctx.fill();
  });
}
// place a no-shoot relative to the paper target it covers
function applyMount(o, m){
  const t = getObj(o.cover); if(!t) return;
  const H = targetSpec(t.size).h, W = targetW(t.size), f = facing(t.rot), p = [-f[1], f[0]];
  let lat = 0, dz = 0;
  if(m === 'lower') dz = -H/2; else if(m === 'upper') dz = H/2;
  else if(m === 'left') lat = -W/2; else if(m === 'right') lat = W/2;
  if(m !== 'custom'){ o.x = t.x + p[0]*lat; o.y = t.y + p[1]*lat; o.dz = dz; o.rot = t.rot; }
  o.mount = m;
}
function nsDisplay(o, toS){
  const t = o.cover ? getObj(o.cover) : null;
  const f = facing(t ? t.rot : o.rot), p = [-f[1], f[0]];
  if(!t) return {x:o.x, y:o.y, f, p};
  const q0 = toS(o.x, o.y), q1 = toS(o.x + f[0]*0.1, o.y + f[1]*0.1);
  if(!q0 || !q1) return {x:o.x, y:o.y, f, p};
  const ppm = Math.hypot(q1[0] - q0[0], q1[1] - q0[1]) / 0.1 || 1;
  const off = 7 / ppm;   // 7 screen pixels in front of the target face
  return {x:o.x + f[0]*off, y:o.y + f[1]*off, f, p};
}
function centroid(pts){ let x = 0, y = 0; pts.forEach(p => { x += p[0]; y += p[1]; }); return [x / pts.length, y / pts.length]; }
function handlePts(o){
  const k = OBJ[o.type].kind;
  if(k === 'line') return [[o.x1, o.y1], [o.x2, o.y2]];
  if(k === 'poly') return o.pts;
  return [];
}
function drawRotHandle(ctx, toS, o){
  const rh = rotHandlePos(o, toS); if(!rh) return;
  ctx.beginPath(); ctx.moveTo(rh.c[0], rh.c[1]); ctx.lineTo(rh.h[0], rh.h[1]);
  ctx.strokeStyle = COL.sel; ctx.lineWidth = 1.5; ctx.setLineDash([3,3]); ctx.stroke(); ctx.setLineDash([]);
  ctx.beginPath(); ctx.arc(rh.h[0], rh.h[1], 7, 0, Math.PI*2);
  ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = COL.sel; ctx.lineWidth = 2; ctx.stroke();
  ctx.beginPath(); ctx.arc(rh.h[0], rh.h[1], 3, 0, Math.PI*2); ctx.fillStyle = COL.sel; ctx.fill();
}
function drawWallHelpers(ctx, toS, o){
  const a = toS(o.x1, o.y1); if(a){ ctx.beginPath(); ctx.arc(a[0], a[1], 7, 0, Math.PI*2); ctx.fillStyle = '#2F7D4F'; ctx.fill(); label(ctx, '起點', a[0] + 8, a[1] + 16, '#2F7D4F'); }
  windowHandles(o, toS).forEach(h => {
    ctx.beginPath();
    if(h.k === 'c'){ ctx.moveTo(h.q[0], h.q[1] - 7); ctx.lineTo(h.q[0] + 7, h.q[1]); ctx.lineTo(h.q[0], h.q[1] + 7); ctx.lineTo(h.q[0] - 7, h.q[1]); ctx.closePath(); ctx.fillStyle = '#E8C46A'; }
    else { ctx.arc(h.q[0], h.q[1], 4.5, 0, Math.PI*2); ctx.fillStyle = '#fff'; }
    ctx.fill(); ctx.strokeStyle = '#7A5424'; ctx.lineWidth = 1.5; ctx.stroke();
    if(h.k === 'c') label(ctx, '窗' + (h.i + 1), h.q[0] + 9, h.q[1] - 8, '#7A5424');
  });
}
function drawHandles(ctx, toS, o){
  if(o.type === 'wall' && tool === 'select') drawWallHelpers(ctx, toS, o);
  if(tool === 'select') drawRotHandle(ctx, toS, o);
  handlePts(o).forEach(p => {
    const q = toS(p[0], p[1]); if(!q) return;
    ctx.fillStyle = '#fff'; ctx.strokeStyle = COL.sel; ctx.lineWidth = 2;
    ctx.fillRect(q[0] - 5, q[1] - 5, 10, 10); ctx.strokeRect(q[0] - 5, q[1] - 5, 10, 10);
  });
}
function drawScene(ctx, toS){
  const order = ['area','tunnel','faultline','trigger','viewpoint','table','prop','barrel','door','wall','paper','noshoot','popper','plate','stopplate','start'];
  const sorted = stage.objects.slice().sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  drawActLinks(ctx, toS);
  sorted.forEach(o => { if(o.type === 'paper' || o.type === 'noshoot') drawMechDecor(ctx, toS, o); });
  sorted.forEach(o => { if(o.id !== selId) drawObj(ctx, toS, o, false); });
  const s = getObj(selId); if(s) drawObj(ctx, toS, s, true);
  drawStartBadges(ctx, toS);
  if(toS === topS){ drawDesignGhost(ctx, toS); drawPlanOverlay(ctx, toS); drawReloadMarks(ctx, toS); drawVisOverlay(ctx, toS); drawSuggestOverlay(ctx, toS); }
  if(hover.snap && (SNAP_TOOLS.includes(tool) || drag)){
    const q = toS(hover.snap[0], hover.snap[1]);
    if(q){ ctx.beginPath(); ctx.arc(q[0], q[1], 8, 0, Math.PI*2); ctx.strokeStyle = COL.ok || '#2F7D4F'; ctx.lineWidth = 2.5; ctx.stroke(); }
  }
  // draft
  if(draft && draft.pts.length){
    const pts = draft.pts.slice();
    if(hover.world) pts.push(hover.world);
    if(pathW(ctx, toS, pts, false)){ ctx.setLineDash([5,4]); ctx.strokeStyle = COL.tape; ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]); }
    draft.pts.forEach((p, i) => { const q = toS(p[0], p[1]); if(q){ ctx.beginPath(); ctx.arc(q[0], q[1], i === 0 ? 6 : 4, 0, Math.PI*2); ctx.fillStyle = COL.tape; ctx.fill(); } });
  }
  // measure
  if(tool === 'measure' && measurePts.length){
    const s2 = measurePts.map(p => toS(p[0], p[1]));
    if(!s2.some(q => !q)){
      ctx.strokeStyle = COL.ink; ctx.lineWidth = 2;
      if(s2.length === 2){ ctx.beginPath(); ctx.moveTo(s2[0][0], s2[0][1]); ctx.lineTo(s2[1][0], s2[1][1]); ctx.stroke(); }
      s2.forEach(q => { ctx.beginPath(); ctx.arc(q[0], q[1], 5, 0, Math.PI*2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke(); });
      if(s2.length === 2){
        const d = Math.hypot(measurePts[1][0] - measurePts[0][0], measurePts[1][1] - measurePts[0][1]);
        label(ctx, fmt(d) + ' m', (s2[0][0] + s2[1][0]) / 2 + 6, (s2[0][1] + s2[1][1]) / 2 - 6, COL.ink);
      }
    }
  }
}

/* ---------- image view drawing ---------- */
function drawImgView(ctx, v){
  if(!img) return;
  ctx.save(); ctx.translate(v.tx, v.ty); ctx.scale(v.s, v.s);
  ctx.imageSmoothingEnabled = v.s < 2; ctx.drawImage(img, 0, 0); ctx.restore();
  const [ix0, iy0] = v.toScreen(0, 0), [ix1, iy1] = v.toScreen(stage.imgW, stage.imgH);
  ctx.save(); ctx.beginPath(); ctx.rect(ix0, iy0, ix1 - ix0, iy1 - iy0); ctx.clip();
  if(H && stage.showGrid){
    const e = topExt; ctx.lineWidth = 1;
    const line = (a, b, strong) => { if(pathW(ctx, imgS, [a, b])){ ctx.strokeStyle = strong ? 'rgba(47,111,168,.9)' : 'rgba(47,111,168,.45)'; ctx.stroke(); } };
    for(let x = Math.ceil(e.xmin); x <= Math.floor(e.xmax); x++) line([x, e.ymin], [x, e.ymax], x % 5 === 0);
    for(let y = Math.ceil(e.ymin); y <= Math.floor(e.ymax); y++) line([e.xmin, y], [e.xmax, y], y % 5 === 0);
  }
  if(H) drawScene(ctx, imgS);
  // calibration points
  const P = stage.points;
  if(P.length > 1){
    ctx.beginPath();
    P.forEach((p, i) => { const [sx, sy] = v.toScreen(p.u, p.v); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); });
    if(P.length === 4) ctx.closePath();
    ctx.strokeStyle = COL.tape; ctx.lineWidth = tool === 'calib' ? 2 : 1; ctx.setLineDash([6, 4]); ctx.stroke(); ctx.setLineDash([]);
  }
  if(tool === 'calib' && stage.lockRow && P.length === 3 && hover.view === 'img'){
    const [, sy] = v.toScreen(0, P[2].v);
    ctx.beginPath(); ctx.moveTo(ix0, sy); ctx.lineTo(ix1, sy); ctx.strokeStyle = 'rgba(200,55,45,.5)'; ctx.lineWidth = 1; ctx.stroke();
  }
  P.forEach((p, i) => {
    const [sx, sy] = v.toScreen(p.u, p.v);
    ctx.beginPath(); ctx.arc(sx, sy, tool === 'calib' ? 7 : 4, 0, Math.PI*2);
    ctx.fillStyle = COL.tape; ctx.fill();
    if(tool === 'calib'){ ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke(); label(ctx, PT_NAMES[i], sx + 10, sy - 10, COL.tape); }
  });
  ctx.restore();
  if(hover.view === 'img' && (tool !== 'select' || calibDrag >= 0)) drawLoupe(ctx, v, hover.sx, hover.sy);
}
function drawLoupe(ctx, v, sx, sy){
  const R = 64, Z = 4;
  const lx = sx + 90 > v.w ? sx - 90 : sx + 90, ly = sy - 90 < 0 ? sy + 90 : sy - 90;
  const [cx, cy] = v.toContent(sx, sy), k = v.s * Z;
  ctx.save(); ctx.beginPath(); ctx.arc(lx, ly, R, 0, Math.PI*2); ctx.clip();
  ctx.fillStyle = '#fff'; ctx.fillRect(lx - R, ly - R, 2*R, 2*R);
  ctx.imageSmoothingEnabled = false; ctx.translate(lx - cx * k, ly - cy * k); ctx.scale(k, k); ctx.drawImage(img, 0, 0);
  ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.arc(lx, ly, R, 0, Math.PI*2); ctx.lineWidth = 2; ctx.strokeStyle = COL.ink; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(lx - 10, ly); ctx.lineTo(lx + 10, ly); ctx.moveTo(lx, ly - 10); ctx.lineTo(lx, ly + 10);
  ctx.strokeStyle = COL.tape; ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
}

/* ---------- top view drawing ---------- */
function drawTopView(ctx, v){
  const e = topExt;
  const [ax, ay] = topS(e.xmin, e.ymax), [bx, by] = topS(e.xmax, e.ymin);
  ctx.fillStyle = '#FBFAF6'; ctx.fillRect(ax, ay, bx - ax, by - ay);
  if(topImgExt){
    const t = topImgExt, [px, py] = topS(t.xmin, t.ymax), [qx, qy] = topS(t.xmax, t.ymin);
    ctx.imageSmoothingEnabled = true; ctx.drawImage(topOff, px, py, qx - px, qy - py);
  }
  if(stage.showGrid){
    ctx.lineWidth = 1;
    for(let x = Math.ceil(e.xmin); x <= Math.floor(e.xmax); x++){
      const [sx1, sy1] = topS(x, e.ymin), [sx2, sy2] = topS(x, e.ymax);
      ctx.beginPath(); ctx.moveTo(sx1, sy1); ctx.lineTo(sx2, sy2);
      ctx.strokeStyle = x % 5 === 0 ? 'rgba(47,111,168,.8)' : 'rgba(47,111,168,.28)'; ctx.stroke();
      label(ctx, x + ' m', sx1 + 2, sy1 - 4, COL.grid);
    }
    for(let y = Math.ceil(e.ymin); y <= Math.floor(e.ymax); y++){
      const [sx1, sy1] = topS(e.xmin, y), [sx2, sy2] = topS(e.xmax, y);
      ctx.beginPath(); ctx.moveTo(sx1, sy1); ctx.lineTo(sx2, sy2);
      ctx.strokeStyle = y % 5 === 0 ? 'rgba(47,111,168,.8)' : 'rgba(47,111,168,.28)'; ctx.stroke();
      label(ctx, y + ' m', sx1 + 4, sy1 - 4, COL.grid);
    }
  }
  if(H){
    if(pathW(ctx, topS, worldCorners(), true)){ ctx.strokeStyle = 'rgba(200,55,45,.6)'; ctx.lineWidth = 1.5; ctx.setLineDash([6,4]); ctx.stroke(); ctx.setLineDash([]); }
  }
  if(0 >= e.xmin && 0 <= e.xmax && 0 >= e.ymin && 0 <= e.ymax){
    const [sx, sy] = topS(0, 0); ctx.beginPath(); ctx.arc(sx, sy, 4, 0, Math.PI*2); ctx.fillStyle = COL.ink; ctx.fill();
    label(ctx, '原點', sx + 8, sy - 6, COL.ink);
  }
  drawScene(ctx, topS);
}

/* ---------- interaction ---------- */
let drag = null; // {id, handle, lastW}
const ROT_HANDLE_PX = 42;
function rotHandlePos(o, toS){
  if(!ROTATABLE.includes(o.type)) return null;
  const f = facing(o.rot), q0 = toS(o.x, o.y), q1 = toS(o.x + f[0]*0.1, o.y + f[1]*0.1);
  if(!q0 || !q1) return null;
  const dx = q1[0] - q0[0], dy = q1[1] - q0[1], L = Math.hypot(dx, dy) || 1;
  return {c:q0, h:[q0[0] + dx/L*ROT_HANDLE_PX, q0[1] + dy/L*ROT_HANDLE_PX]};
}
function faceTo(o, w, snap){
  const a = deg(Math.atan2(w[1] - o.y, w[0] - o.x));
  let r = normDeg(-90 - a);
  if(snap) r = normDeg(Math.round(r / 15) * 15);
  o.rot = r;
}
function windowHandles(o, toS){
  // centre handle (slide) and two edge handles (resize) for each window of a selected wall
  const L = Math.hypot(o.x2 - o.x1, o.y2 - o.y1) || 1, ux = (o.x2 - o.x1) / L, uy = (o.y2 - o.y1) / L, out = [];
  (o.ports || []).forEach((p, i) => {
    [['c', p.off + p.w/2], ['a', p.off], ['b', p.off + p.w]].forEach(([k, s0]) => { const q = toS(o.x1 + ux*s0, o.y1 + uy*s0); if(q) out.push({i, k, q}); });
  });
  return out;
}
function hitTest(sx, sy, toS){
  const s = getObj(selId);
  if(s && s.type === 'wall' && tool === 'select'){
    const wh = windowHandles(s, toS).find(h => Math.hypot(h.q[0] - sx, h.q[1] - sy) < 9);
    if(wh) return {obj:s, handle:-10, win:wh};
  }
  if(s){
    const rh = rotHandlePos(s, toS);
    if(rh && Math.hypot(rh.h[0] - sx, rh.h[1] - sy) < 10) return {obj:s, handle:-2};
    const hp = handlePts(s);
    for(let i = 0; i < hp.length; i++){ const q = toS(hp[i][0], hp[i][1]); if(q && Math.hypot(q[0] - sx, q[1] - sy) < 9) return {obj:s, handle:i}; }
  }
  const objs = stage.objects.slice().reverse();
  for(const o of objs){
    if(OBJ[o.type].kind !== 'point') continue;
    if(o.type === 'noshoot'){
      const d = nsDisplay(o, toS), w = targetW(o.size);
      const a = toS(d.x - d.p[0]*w/2, d.y - d.p[1]*w/2), b = toS(d.x + d.p[0]*w/2, d.y + d.p[1]*w/2);
      if(a && b && distPtSeg(sx, sy, a[0], a[1], b[0], b[1]) < 5) return {obj:o, handle:-1};
      continue;
    }
    const q = toS(o.x, o.y); if(q && Math.hypot(q[0] - sx, q[1] - sy) < 12) return {obj:o, handle:-1};
  }
  for(const o of objs){
    if(OBJ[o.type].kind !== 'line') continue;
    const a = toS(o.x1, o.y1), b = toS(o.x2, o.y2);
    if(a && b && distPtSeg(sx, sy, a[0], a[1], b[0], b[1]) < 8) return {obj:o, handle:-1};
  }
  for(const o of objs){
    if(OBJ[o.type].kind !== 'poly' || o.pts.length < 3) continue;
    const s2 = o.pts.map(p => toS(p[0], p[1]));
    if(s2.some(q => !q)) continue;
    if(pointInPoly(sx, sy, s2)) return {obj:o, handle:-1};
  }
  return null;
}
function hitCalib(sx, sy){
  for(let i = stage.points.length - 1; i >= 0; i--){
    const p = stage.points[i], [px, py] = imgView.toScreen(p.u, p.v);
    if(Math.hypot(px - sx, py - sy) < 12) return i;
  }
  return -1;
}
function clampImg(u, v){ return [Math.max(0, Math.min(stage.imgW, u)), Math.max(0, Math.min(stage.imgH, v))]; }
function moveObj(o, dx, dy){
  const k = OBJ[o.type].kind;
  if(k === 'point'){ o.x += dx; o.y += dy; if(o.mech && o.mech.ex != null){ o.mech.ex += dx; o.mech.ey += dy; } }
  else if(k === 'line'){ o.x1 += dx; o.y1 += dy; o.x2 += dx; o.y2 += dy; }
  else o.pts.forEach(p => { p[0] += dx; p[1] += dy; });
}
function setHandle(o, i, w){
  const k = OBJ[o.type].kind;
  if(k === 'line'){ if(i === 0){ o.x1 = w[0]; o.y1 = w[1]; } else { o.x2 = w[0]; o.y2 = w[1]; } }
  else if(k === 'poly'){ o.pts[i] = [w[0], w[1]]; }
}
function finishDraft(){
  if(draft && draft.type === 'area' && draft.pts.length >= 3){
    const o = createPolyObj(draft.type, draft.pts); draft = null; addObj(o);
  }
}
function makeHandlers(name, view, toS, toW){
  return {
    grab(sx, sy){
      if(name === 'img' && tool === 'calib'){
        const i = hitCalib(sx, sy); if(i >= 0){ calibDrag = i; return true; } return false;
      }
      if(ROTATABLE.includes(tool) && !pendingFace && !pendingSlide){
        const w = toW(sx, sy); if(!w) return false;
        let o;
        if(tool === 'start' && startObj()){ o = startObj(); o.x = w[0]; o.y = w[1]; }
        else { o = createPointObj(tool, w[0], w[1]); stage.objects.push(o); }
        selId = o.id; drag = {id:o.id, handle:-3, lastW:w};
        renderList(); renderProps(); renderViews();
        return true;
      }
      if(tool !== 'select' || pendingFace || pendingSlide || pendingOrder || pendingAct) return false;
      const ps = planStopHit(sx, sy, toS);
      if(ps){ drag = {handle:-20, stop:ps}; return true; }
      const h = hitTest(sx, sy, toS);
      if(!h) return false;
      const w = toW(sx, sy); if(!w) return false;
      selId = h.obj.id; drag = {id:h.obj.id, handle:h.handle, lastW:w, win:h.win};
      renderList(); renderProps(); renderViews();
      return true;
    },
    drag(sx, sy, e){
      if(drag && drag.handle === -20){ const w = toW(sx, sy); if(w){ drag.stop.x = w[0]; drag.stop.y = w[1]; planCache = null; renderViews(); } return; }
      if(calibDrag >= 0){
        const [u, v] = clampImg(...imgView.toContent(sx, sy));
        const P = stage.points; P[calibDrag].u = u; P[calibDrag].v = v;
        if(stage.lockRow && (calibDrag === 2 || calibDrag === 3)){ const other = calibDrag === 2 ? 3 : 2; if(P[other]) P[other].v = v; }
        hover = {view:name, sx, sy, world:null};
        recompute(false); return;
      }
      if(!drag) return;
      const o = getObj(drag.id), w = toW(sx, sy); if(!o || !w) return;
      if(drag.handle === -10 && drag.win){
        const L = Math.hypot(o.x2 - o.x1, o.y2 - o.y1) || 1, ux = (o.x2 - o.x1) / L, uy = (o.y2 - o.y1) / L;
        const sAt = Math.max(0, Math.min(L, (w[0] - o.x1)*ux + (w[1] - o.y1)*uy)), p = o.ports[drag.win.i];
        if(drag.win.k === 'c') p.off = Math.max(0, Math.min(L - p.w, sAt - p.w/2));
        else if(drag.win.k === 'a'){ const end = p.off + p.w; p.off = Math.min(sAt, end - 0.05); p.w = end - p.off; }
        else { p.w = Math.max(0.05, Math.min(L - p.off, sAt - p.off)); }
        renderViews(); return;
      }
      if(drag.handle === -2 || drag.handle === -3){ faceTo(o, w, e && e.shiftKey); renderViews(); updateRotField(o); return; }
      if(drag.handle >= 0){ const sw = snapWorld(w, sx, sy, toS, o.id); hover.snap = sw.snap; setHandle(o, drag.handle, sw.w); }
      else moveObj(o, w[0] - drag.lastW[0], w[1] - drag.lastW[1]);
      drag.lastW = w;
      renderViews();
    },
    release(moved){
      if(calibDrag >= 0){ calibDrag = -1; recompute(true); return; }
      if(drag && drag.handle === -20){ drag = null; if(moved) planChanged(true); return; }
      if(drag){ const placing = drag.handle === -3; drag = null; hover.snap = null; if(moved || placing) objectsChanged(true); }
    },
    click(sx, sy){
      if(name === 'img' && tool === 'calib'){
        if(!img) return;
        const [u, v] = clampImg(...imgView.toContent(sx, sy));
        const P = stage.points; if(P.length >= 4) return;
        P.push({u, v:(stage.lockRow && P.length === 3) ? P[2].v : v});
        if(P.length === 4) setTool('select');
        recompute(true); return;
      }
      const w = toW(sx, sy);
      if(!w){ $('imgReadout').textContent = '請先完成地板校正，或點在地板範圍內。'; return; }
      if(pendingOrder){
        const hit = hitTest(sx, sy, toS), o = hit && hit.obj;
        if(o && ['paper','popper','plate','stopplate'].includes(o.type)){
          if(!pendingOrder.list.includes(o.id)) pendingOrder.list.push(o.id);
          renderPlanPanel(); renderViews();
          const plan = plans().find(p => p.id === pendingOrder.planId), st = plan && plan.stops.find(x => x.id === pendingOrder.stopId);
          if(st && pendingOrder.list.length >= st.targets.length && st.targets.every(x => pendingOrder.list.includes(x.id))) finishOrderPick();
        }
        return;
      }
      if(pendingAct){
        const o = getObj(pendingAct); pendingAct = null;
        let best = null, bd = 0.7;
        stage.objects.forEach(a => { if(!ACTIVATOR_TYPES.includes(a.type) || a === o) return; const d = Math.hypot(a.x - w[0], a.y - w[1]); if(d < bd){ bd = d; best = a; } });
        if(o && best){ o.mech.act = {mode:'object', id:best.id, delay:(o.mech.act && o.mech.act.delay) || 0}; selId = o.id; objectsChanged(false); }
        else if(o) alert('點的位置附近沒有可當啟動來源的物件（鋼靶、Falling Plate、啟動機關、門或道具）。');
        setTool(tool); renderProps(); return;
      }
      if(pendingSlide){
        const o = getObj(pendingSlide); pendingSlide = null;
        if(o && o.mech){ o.mech.ex = w[0]; o.mech.ey = w[1]; selId = o.id; objectsChanged(true); }
        setTool(tool); return;
      }
      if(pendingFace){
        const o = getObj(pendingFace); pendingFace = null;
        if(o){ faceTo(o, w, false); selId = o.id; objectsChanged(false); }
        setTool(tool); return;
      }
      if(tool === 'select'){ selId = null; renderList(); renderProps(); renderViews(); return; }
      if(tool === 'measure'){
        if(measurePts.length >= 2) measurePts = [];
        measurePts.push(w); updateMeasureOut(); renderViews(); return;
      }
      if(tool === 'wall' || tool === 'faultline' || tool === 'tunnel' || tool === 'bridge'){
        if(!draft) draft = {type:tool, pts:[]};
        draft.pts.push(snapWorld(w, sx, sy, toS).w);
        if(draft.pts.length === 2){ const o = createLineObj(tool, draft.pts[0], draft.pts[1]); draft = null; addObj(o); }
        else renderViews();
        return;
      }
      if(tool === 'area'){
        if(!draft) draft = {type:tool, pts:[]};
        if(draft.pts.length >= 3){
          const q = toS(draft.pts[0][0], draft.pts[0][1]);
          if(q && Math.hypot(q[0] - sx, q[1] - sy) < 12){ finishDraft(); return; }
        }
        draft.pts.push(snapWorld(w, sx, sy, toS).w); renderViews(); return;
      }
      if(MECH_TOOLS[tool]){
        const o = createPointObj('paper', w[0], w[1]); o.mech = newMech(); o.mech.type = MECH_TOOLS[tool][0];
        if(o.mech.type === 'swinger') o.mech.amp = 90;
        addObj(o); setTool('select'); renderProps(); return;
      }
      if(TRIG_TOOLS[tool]){
        const o = createPointObj('trigger', w[0], w[1]); o.trig = TRIG_TOOLS[tool][0]; addObj(o); return;
      }
      if(OBJ[tool]){
        if(tool === 'start'){ const s = startObj(); if(s){ s.x = w[0]; s.y = w[1]; selId = s.id; objectsChanged(true); return; } }
        addObj(createPointObj(tool, w[0], w[1]));
      }
    },
    hover(sx, sy){
      let w = toW(sx, sy), snap = null;
      if(SNAP_TOOLS.includes(tool) && w){ const r = snapWorld(w, sx, sy, toS); w = r.w; snap = r.snap; }
      hover = {view:name, sx, sy, world:w, snap};
      let t = '';
      if(name === 'img' && img){
        const [u, v] = imgView.toContent(sx, sy);
        t = '像素 ' + Math.round(u) + ', ' + Math.round(v);
        if(w) t += '　地板座標 x ' + fmt(w[0]) + ' m，y ' + fmt(w[1]) + ' m';
        $('imgReadout').textContent = t;
      }else if(name === 'top' && w){
        $('topReadout').textContent = '地板座標 x ' + fmt(w[0]) + ' m，y ' + fmt(w[1]) + ' m';
      }
      if(name === 'img' || draft || SNAP_TOOLS.includes(tool)) renderViews();
    },
    leave(){ hover = {view:null, sx:0, sy:0, world:null}; renderViews(); }
  };
}
bindPointer(imgView, makeHandlers('img', imgView, imgS, imgW));
bindPointer(topView, makeHandlers('top', topView, topS, topW));

/* ---------- toolbar ---------- */
// one row: 選取 | 靶 ▾ 障礙物 ▾ 區域 ▾ (build mode only) | 視點 測距 | 復原 重做
const TOOL_MENUS = [
  ['靶', ['paper','noshoot','popper','plate','stopplate']],
  ['機關', ['m_swinger','m_monkey','m_slider','m_disappear','t_laser','t_pedal','t_rope','t_other']],
  ['障礙物', ['wall','barrel','table','door','prop','tunnel']],
  ['站坐道具', ['platform','bridge','boat','chair','horse']],
  ['區域', ['area','faultline','start']]
];
const TOOL_ALWAYS = ['select', 'viewpoint', 'measure'];
// shortcut tools: a paper target that already carries a mechanism, or an activator of a given kind
const MECH_TOOLS = {m_swinger:['swinger','搖擺靶'], m_monkey:['monkey','猴子靶'], m_slider:['slider','滑行靶'], m_disappear:['disappear','消失靶']};
const TRIG_TOOLS = {t_laser:['laser','雷射感應'], t_pedal:['pedal','踏板'], t_rope:['rope','手拉機關'], t_other:['other','其他啟動機關']};
const toolLabel = k => { if(OBJ[k] && ['platform','bridge','boat','chair','horse'].includes(k)) return OBJ[k].label; if(MECH_TOOLS[k]) return MECH_TOOLS[k][1]; if(TRIG_TOOLS[k]) return TRIG_TOOLS[k][1]; for(const g of TOOL_GROUPS) for(const [kk, lab] of g) if(kk === k) return lab; return k; };
function pickTool(k){ pendingFace = null; pendingSlide = null; pendingAct = null; closeToolMenu(); setTool(tool === k && k !== 'select' ? 'select' : k); renderProps(); }
function closeToolMenu(){ const d = $('toolMenu'); if(d) d.remove(); document.querySelectorAll('#toolbar .tmenu').forEach(b => b.setAttribute('aria-expanded', 'false')); }
function openToolMenu(btn, keys){
  const was = btn.getAttribute('aria-expanded') === 'true';
  closeToolMenu(); if(was) return;
  const r = btn.getBoundingClientRect();
  const d = el('div', {id:'toolMenu', class:'tooldrop', role:'menu'});
  d.appendChild(el('div', {class:'dd-h', text:keys.includes('m_swinger') ? '機關靶放好後，在屬性面板指定啟動來源；鋼靶、Falling Plate、門也能當啟動來源' : '選好後在俯視圖或原圖上點選放置'}));
  if(keys.includes('m_swinger')) d.classList.add('wide');
  keys.forEach(k => d.appendChild(el('button', {role:'menuitem', class:tool === k ? 'on' : '', text:toolLabel(k), onclick:() => pickTool(k)})));
  document.body.appendChild(d);
  const w = d.offsetWidth; d.style.left = Math.max(6, Math.min(window.innerWidth - w - 6, r.left)) + 'px'; d.style.top = (r.bottom + 4) + 'px';
  btn.setAttribute('aria-expanded', 'true');
}
function buildToolbar(){
  const tb = $('toolbar'); tb.innerHTML = ''; closeToolMenu();
  const build = (document.body.dataset.mode || 'build') === 'build';
  const grp = () => { const d = el('div', {class:'grp'}); tb.appendChild(d); return d; };
  const tbtn = (p, k) => { const b = el('button', {text:toolLabel(k), onclick:() => pickTool(k)}); b.dataset.tool = k; p.appendChild(b); };
  tbtn(grp(), 'select');
  if(build){
    const g = grp();
    TOOL_MENUS.forEach(([name, keys]) => {
      const b = el('button', {class:'tmenu', 'aria-haspopup':'menu', 'aria-expanded':'false', text:name});
      b.dataset.menu = keys.join(','); b.addEventListener('click', e => { e.stopPropagation(); openToolMenu(b, keys); });
      g.appendChild(b);
    });
  }
  const g3 = grp(); tbtn(g3, 'viewpoint'); tbtn(g3, 'measure');
  const ug = grp();
  const ub = el('button', {id:'undoBtn', title:'復原（Ctrl+Z）', text:'復原'}); ub.addEventListener('click', undo);
  const rb = el('button', {id:'redoBtn', title:'重做（Ctrl+Y）', text:'重做'}); rb.addEventListener('click', redo);
  ug.append(ub, rb);
  if(!build) tb.appendChild(el('span', {class:'tchip', text:'放靶與障礙物請到「建場」'}));
  const tip = document.createElement('span'); tip.className = 'tip'; tip.id = 'toolTip'; tb.appendChild(tip);
  syncToolbar();
  syncUndoButtons();
}
function syncToolbar(){
  document.querySelectorAll('#toolbar button[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === tool));
  document.querySelectorAll('#toolbar .tmenu').forEach(b => {
    const keys = b.dataset.menu.split(','), on = keys.includes(tool);
    const name = TOOL_MENUS.find(m => m[1].join(',') === b.dataset.menu)[0];
    b.classList.toggle('on', on); b.textContent = on ? name + '：' + toolLabel(tool) : name;
  });
}
document.addEventListener('click', e => { if(!e.target.closest || (!e.target.closest('#toolMenu') && !e.target.closest('.tmenu'))) closeToolMenu(); });
document.addEventListener('keydown', e => { if(e.key === 'Escape') closeToolMenu(); });
window.addEventListener('resize', () => closeToolMenu());
function setTool(t){
  if(t === 'calib' && !img) return;
  tool = t; draft = null;
  if(t !== 'measure') measurePts = [];
  syncToolbar();
  $('calibTool').classList.toggle('on', t === 'calib');
  $('calibTool').textContent = t === 'calib' ? '完成調整' : '調整校正點';
  const lab = TOOL_GROUPS.flat().find(x => x[0] === t);
  $('toolTip').textContent = pendingAct ? '在圖上點選啟動這個靶的物件（鋼靶、Falling Plate、啟動機關、門）。Esc 取消。' : pendingSlide ? '在圖上點一下，設定滑輪靶的滑軌終點。Esc 取消。' : pendingFace ? '在圖上點一下，物件會轉向面對該點。Esc 取消。'
    : TOOL_TIPS[t] || (lab ? (ROTATABLE.includes(t) ? '點一下放置' + lab[1] + '；按住拖曳可同時決定朝向（Shift 以 15 度為單位）。' : '點一下放置' + lab[1] + '。') : '');
  updateMeasureOut(); renderViews();
}
function updateMeasureOut(){
  const p = measurePts;
  if(tool !== 'measure'){ $('measureOut').textContent = '用工具列的「測距」，在任一側圖上點兩點。'; $('scaleBox').classList.add('hidden'); return; }
  if(p.length === 0) $('measureOut').textContent = '點第一點。';
  else if(p.length === 1) $('measureOut').textContent = '點第二點。';
  $('scaleBox').classList.toggle('hidden', !(tool === 'measure' && p.length === 2));
  if(p.length === 2) $('measureOut').textContent = '兩點距離 ' + fmt(Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1])) + ' 公尺（再點一次重新量測）';
}
document.addEventListener('keydown', e => {
  const tag = (e.target.tagName || '').toLowerCase();
  if(tag === 'input' || tag === 'textarea' || tag === 'select') return;
  const mod = e.ctrlKey || e.metaKey;
  if(mod && (e.key === 'z' || e.key === 'Z')){ e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if(mod && (e.key === 'y' || e.key === 'Y')){ e.preventDefault(); redo(); return; }
  if(e.key === 'Escape' && pendingOrder){ pendingOrder = null; renderPlanPanel(); renderViews(); return; }
  if(e.key === 'Escape'){ if(pendingFace || pendingSlide || pendingAct){ pendingFace = null; pendingSlide = null; pendingAct = null; setTool(tool); renderProps(); } else if(draft){ draft = null; renderViews(); } else setTool('select'); }
  else if(e.key === 'Enter'){ finishDraft(); }
  else if((e.key === 'Delete' || e.key === 'Backspace') && selId){ e.preventDefault(); deleteSel(); }
  else if(selId && e.key.startsWith('Arrow')){
    const o = getObj(selId); if(!o) return;
    e.preventDefault();
    const step = e.shiftKey ? 0.01 : 0.05;
    const d = {ArrowLeft:[-step,0], ArrowRight:[step,0], ArrowUp:[0,step], ArrowDown:[0,-step]}[e.key];
    moveObj(o, d[0], d[1]); objectsChanged(false);
  }
});

/* ---------- start condition ---------- */
const HOLDERS = ['barrel','table','prop','door'];
const READY = [['loaded','CON1：上膛上匣（可頂膛，第一匣多 1 發）'],['emptyChamber','CON2：上匣不上膛（規則 8.1.3）'],['unloaded','CON3：不上膛不上匣（彈匣另放）']];
function holderObjs(){ return stage.objects.filter(o => HOLDERS.includes(o.type)); }
function objName(id){ const o = getObj(id); return o ? (o.type === 'prop' ? (o.name || o.label) : OBJ[o.type].label + ' ' + o.label) : '（物件已刪除）'; }
function startSummary(){
  const c = stage.startCond;
  const gun = c.gunLoc === 'holster' ? '槍在槍套' : c.gunLoc === 'object' ? '槍在' + objName(c.gunObj) : '槍：' + (c.gunNote || '其他');
  const rd = {loaded:'CON1', emptyChamber:'CON2', unloaded:'CON3'}[c.ready];
  const mag = c.ready !== 'unloaded' ? '' : c.magLoc === 'body' ? '、彈匣在身上' : c.magLoc === 'object' ? '、彈匣在' + objName(c.magObj) : '、彈匣另放';
  const spare = c.spareLoc === 'object' ? '、備用彈匣在' + objName(c.spareObj) : c.spareLoc === 'none' ? '、無備用彈匣' : '';
  const hands = {sides:'雙手自然垂下', wrists:'手腕高於肩', lap:'雙手放在大腿上', onObject:'雙手放在' + objName(c.handsObj), other:'手：其他'}[c.hands];
  const pose = c.pose === 'seated' ? '坐在' + objName(c.seatObj) + '、' : c.pose === 'straddle' ? '跨坐在' + objName(c.seatObj) + '、' : '';
  const face = {downrange:'面向靶擋', uprange:'背向靶擋', other:'面向：其他'}[c.facing];
  return gun + '（' + rd + '）' + mag + spare + '；' + pose + face + '、' + hands + (c.pose && c.pose !== 'stand' ? (c.after === 'stay' ? '，坐著射擊' : '，' + (c.pose === 'straddle' ? '下馬' : '起身') + '後出槍') : '');
}
// key used by the time model (phase 3) to pick the matching start-time parameter
function startKey(){
  const c = stage.startCond;
  return [c.gunLoc === 'object' ? (getObj(c.gunObj)?.type || 'object') : c.gunLoc, c.ready,
          c.ready === 'unloaded' ? (c.magLoc === 'object' ? (getObj(c.magObj)?.type || 'object') : c.magLoc) : 'gun',
          c.facing, c.hands].join('|');
}
/* beep to first shot: the shooter's draw / pick-up speed, or a time set for this stage (handy for CON2, CON3) */
function renderFirstShot(box, c, upd){
  if(typeof startParts !== 'function' || !PROFILE.time) return;   // shooter parameters not loaded yet (early init)
  const T = PROFILE.time, d = el('div', {class:'port'});
  const sh = SHOOTERS && SHOOTERS.list.find(x => x.id === SHOOTERS.activeId), who = (sh ? sh.name : '目前射手') + '・' + divInfo(PROFILE.division).name + ' 組別';
  d.appendChild(el('div', {class:'kind', text:'嗶聲到第一槍'}));
  d.appendChild(row(
    numField('出槍到第一槍（槍在身上，秒）', T.startHolster, 1, v => { if(v > 0){ PROFILE.time.startHolster = v; saveProfile(); if(typeof renderParamBox === 'function') renderParamBox(); upd(); } }, '0.05'),
    numField('取槍到第一槍（槍在物件上，秒）', T.startPickup, 1, v => { if(v > 0){ PROFILE.time.startPickup = v; saveProfile(); if(typeof renderParamBox === 'function') renderParamBox(); upd(); } }, '0.05')));
  d.appendChild(el('p', {class:'help', text:'這兩項是射手參數（' + who + '），所有 stage 共用，射手視窗也可修改。'}));
  const custom = c.firstShot != null && c.firstShot > 0, auto = startTimeAuto();
  d.appendChild(selField('這個 stage 的第一槍時間', [['auto','依射手參數計算'],['custom','自行設定秒數']], custom ? 'custom' : 'auto',
    v => { c.firstShot = v === 'custom' ? Math.round(auto * 100) / 100 : null; upd(); }));
  if(custom){
    d.appendChild(numField('嗶聲到第一槍（秒）', c.firstShot, 1, v => { if(v > 0){ c.firstShot = v; upd(); } }, '0.05'));
    d.appendChild(el('div', {class:'readout', text:'依射手參數計算為 ' + fmt(auto) + ' 秒；目前使用自行設定的 ' + fmt(c.firstShot) + ' 秒。'}));
    d.appendChild(el('p', {class:'help', text:'自行設定後，直接以這個秒數作為嗶聲到第一槍的時間，不再另加 CON2、CON3 上膛入匣或背向轉身的時間；只套用在這個 stage。改變射手的出槍、取槍參數（或比較標竿射手）時，這個 stage 的第一槍時間不會跟著變。'}));
  }else{
    d.appendChild(el('div', {class:'readout', text:startParts().map(x => x[0] + ' ' + fmt(x[1])).join(' ＋ ') + ' ＝ ' + fmt(auto) + ' 秒'}));
  }
  box.appendChild(d);
}
function renderStartCond(){
  const box = $('startBox'); if(!box) return;
  box.innerHTML = '';
  const c = stage.startCond;
  const hs = holderObjs();
  const objOpts = hs.length ? hs.map(o => [o.id, objName(o.id)]) : [['', '（圖上尚無油桶、桌子等物件）']];
  const upd = () => { commitAndRefreshStart(); };
  const fixObj = (loc, key) => { if(c[loc] === 'object' && !getObj(c[key])) c[key] = hs[0] ? hs[0].id : null; };

  box.appendChild(selField('槍的位置', [['holster','槍套內'],['object','放在物件上'],['other','其他']], c.gunLoc, v => { c.gunLoc = v; fixObj('gunLoc','gunObj'); c.auto = false; upd(); }));
  if(c.gunLoc === 'object') box.appendChild(selField('放在哪個物件', objOpts, c.gunObj || '', v => { c.gunObj = v || null; c.auto = false; upd(); }));
  if(c.gunLoc === 'other'){ const t = el('input', {type:'text', placeholder:'例如：放在箱子內'}); t.value = c.gunNote; t.addEventListener('change', () => { c.gunNote = t.value; upd(); }); box.appendChild(el('div', null, el('label', {class:'f', text:'說明'}), t)); }

  box.appendChild(selField('槍枝準備狀態', READY, c.ready, v => { c.ready = v; if(v !== 'unloaded') c.magLoc = 'gun'; else if(c.magLoc === 'gun') c.magLoc = 'body'; c.auto = false; upd(); }));
  if(c.ready === 'unloaded'){
    box.appendChild(selField('入槍用彈匣位置', [['body','身上'],['object','放在物件上'],['other','其他']], c.magLoc, v => { c.magLoc = v; fixObj('magLoc','magObj'); c.auto = false; upd(); }));
    if(c.magLoc === 'object') box.appendChild(selField('放在哪個物件', objOpts, c.magObj || '', v => { c.magObj = v || null; upd(); }));
  }
  box.appendChild(selField('備用彈匣位置', [['body','身上'],['object','放在物件上'],['none','無']], c.spareLoc, v => { c.spareLoc = v; fixObj('spareLoc','spareObj'); upd(); }));
  if(c.spareLoc === 'object') box.appendChild(selField('放在哪個物件', objOpts, c.spareObj || '', v => { c.spareObj = v || null; upd(); }));

  box.appendChild(row(
    selField('面向', [['downrange','面向靶擋'],['uprange','背向靶擋'],['other','其他']], c.facing, v => { c.facing = v; upd(); }),
    selField('手的位置', [['sides','自然垂下'],['wrists','手腕高於肩'],['lap','放在大腿上'],['onObject','放在物件上'],['other','其他']], c.hands, v => { c.hands = v; fixObj('hands','handsObj'); if(v === 'onObject' && !getObj(c.handsObj)) c.handsObj = hs[0] ? hs[0].id : null; upd(); })));
  if(c.hands === 'onObject') box.appendChild(selField('手放在哪個物件', objOpts, c.handsObj || '', v => { c.handsObj = v || null; upd(); }));
  // seated or straddling start (chair, boat, horse); either rise first or shoot from the seat
  const seats = stage.objects.filter(o => ['chair','boat','horse','barrel'].includes(o.type));
  box.appendChild(selField('起始姿勢', [['stand','站立'],['seated','坐在椅子或船上'],['straddle','跨坐（馬、鞍座、倒放油桶）']], c.pose || 'stand', v => {
    c.pose = v; if(v !== 'stand' && !getObj(c.seatObj)){ const pref = seats.find(o => v === 'straddle' ? (o.type === 'horse' || o.type === 'barrel') : (o.type === 'chair' || o.type === 'boat')); c.seatObj = pref ? pref.id : null; } upd(); }));
  if(c.pose && c.pose !== 'stand'){
    box.appendChild(row(
      selField('坐在哪個物件', seats.length ? seats.map(o => [o.id, objName(o.id)]) : [['', '（圖上尚無椅子、船或馬）']], c.seatObj || '', v => { c.seatObj = v || null; upd(); }),
      selField('開始訊號後', [['rise','先' + (c.pose === 'straddle' ? '下馬' : '起身') + '再出槍'],['stay','坐著出槍射擊']], c.after || 'rise', v => { c.after = v; upd(); })));
    if(!getObj(c.seatObj)) box.appendChild(warn('請先用工具列「站坐道具」放置椅子、船或馬，再回來選擇。'));
    else if(c.after === 'stay') box.appendChild(el('p', {class:'help', text:'坐著射擊：路線計畫第一個停頓點請放在座位上，姿勢選「坐姿」。'}));
  }
  renderFirstShot(box, c, upd);
  const n = el('input', {type:'text', placeholder:'例如：雙腳腳跟接觸標記'}); n.value = c.note;
  n.addEventListener('change', () => { c.note = n.value; upd(); });
  box.appendChild(el('div', null, el('label', {class:'f', text:'其他條件'}), n));

  if(!startObj()) box.appendChild(warn('尚未放置「起始位置」。請用工具列的「起始位置」在圖上標出射手起始站位。'));
  const missing = (c.gunLoc === 'object' && !getObj(c.gunObj)) || (c.ready === 'unloaded' && c.magLoc === 'object' && !getObj(c.magObj)) || (c.spareLoc === 'object' && !getObj(c.spareObj));
  if(missing) box.appendChild(warn('指定的物件不存在，請先在圖上放置油桶或桌子，再回來選擇。'));
  if(c.auto) box.appendChild(el('div', {class:'msg warn', text:'以上由 STG 內容自動判斷，請對照賽程簡報確認。'}));
  box.appendChild(el('div', {class:'msg ok', text:startSummary()}));
  $('stStart').textContent = c.gunLoc === 'holster' && c.ready === 'loaded' ? '預設' : '已設定';
}
function commitAndRefreshStart(){
  renderStartCond(); renderViews(); saveStage();
  // the start condition changes the first shot time: recompute plans and an open replay
  if(typeof renderPlanPanel === 'function'){ planCache = null; renderPlanPanel(); if(typeof renderResultsPanel === 'function') renderResultsPanel(); }
  layoutChanged();
}
function drawStartBadges(ctx, toS){
  const c = stage.startCond, tags = {};
  const add = (id, t) => { if(id && getObj(id)) (tags[id] = tags[id] || []).push(t); };
  if(c.gunLoc === 'object') add(c.gunObj, '槍');
  if(c.ready === 'unloaded' && c.magLoc === 'object') add(c.magObj, '匣');
  if(c.spareLoc === 'object') add(c.spareObj, '備用匣');
  Object.entries(tags).forEach(([id, t]) => {
    const o = getObj(id), q = toS(o.x, o.y); if(!q) return;
    const text = t.join('＋');
    ctx.font = '700 12px "Noto Sans TC","Microsoft JhengHei",sans-serif';
    const w = ctx.measureText(text).width + 10;
    ctx.fillStyle = COL.tape; ctx.fillRect(q[0] - w/2, q[1] + 10, w, 18);
    ctx.fillStyle = '#fff'; ctx.fillText(text, q[0] - w/2 + 5, q[1] + 23);
  });
}

/* ---------- properties panel ---------- */
function el(tag, props, ...kids){
  const e = document.createElement(tag);
  if(props) Object.entries(props).forEach(([k, v]) => { if(k === 'class') e.className = v; else if(k === 'text') e.textContent = v; else if(k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v); });
  kids.forEach(k => k && e.appendChild(k));
  return e;
}
function numField(lab, val, scale, onSet, step){
  const id = 'p_' + Math.random().toString(36).slice(2, 8);
  const inp = el('input', {type:'number', id, step:step || '0.5'});
  inp.value = val == null || isNaN(val) ? '' : String(Math.round(val * scale * 100) / 100);
  inp.addEventListener('change', () => { const v = parseFloat(inp.value); onSet(isNaN(v) ? null : v / scale); });
  return el('div', null, el('label', {class:'f', for:id, text:lab}), inp);
}
function selField(lab, options, val, onSet){
  const id = 'p_' + Math.random().toString(36).slice(2, 8);
  const s = el('select', {id});
  options.forEach(([v, t]) => { const o = el('option', {value:v, text:t}); s.appendChild(o); });
  s.value = val == null ? '' : val;
  s.addEventListener('change', () => onSet(s.value));
  return el('div', null, el('label', {class:'f', for:id, text:lab}), s);
}
function row(...kids){ return el('div', {class:'row'}, ...kids); }
function warn(t){ return el('div', {class:'msg warn', text:t}); }

function kindLabel(o){ return o.type === 'plate' ? (o.shape === 'square' ? '方形 Falling Plate' : '圓形 Falling Plate') : o.type === 'popper' && o.mini ? '迷你鋼靶' : OBJ[o.type].label; }
function renderProps(){
  if(typeof renderVisPanel === 'function') setTimeout(renderVisPanel, 0);
  const box = $('propsBox'); box.innerHTML = '';
  const o = getObj(selId);
  if(o && selId !== renderProps.last && document.body.dataset.mode === 'build'){ const so = $('secObj'); if(so && !so.open) so.open = true; }   // show the properties of what was just picked or placed
  renderProps.last = selId;
  if(!o){ box.appendChild(el('p', {class:'help', text:'尚未選取物件。用「選取」工具點物件即可編輯。'})); return; }
  const def = OBJ[o.type];
  const upd = (extent) => objectsChanged(extent);
  const p = el('div', {class:'props'});
  p.appendChild(el('h3', {text:o.label}));
  p.appendChild(el('div', {class:'kind', text:kindLabel(o)}));
  const lab = el('input', {type:'text', 'aria-label':'標籤'}); lab.value = o.label;
  lab.addEventListener('change', () => { o.label = lab.value.trim() || o.label; upd(false); });
  p.appendChild(el('div', null, el('label', {class:'f', text:'標籤'}), lab));

  if(def.kind === 'point'){
    p.appendChild(row(numField('x（公尺）', o.x, 1, v => { if(v != null){ o.x = v; upd(true); } }, '0.01'),
                      numField('y（公尺）', o.y, 1, v => { if(v != null){ o.y = v; upd(true); } }, '0.01')));
    if(['paper','noshoot','plate','table','door','prop','start','trigger','platform','boat','chair','horse'].includes(o.type)){
      const rf = numField({boat:'船頭方向（度，0 為朝前方，順時針為正）', chair:'座椅面向（度，0 為朝前方，順時針為正；椅背在後）', horse:'馬頭方向（度，0 為朝前方，順時針為正）'}[o.type] || '旋轉（度，0 為正面朝前方，順時針為正）', o.rot || 0, 1, v => { o.rot = normDeg(v || 0); upd(false); }, '1');
      rf.querySelector('input').id = 'rotField';
      p.appendChild(rf);
      const s = startObj();
      const bs = el('div', {class:'btns'});
      bs.appendChild(el('button', {class:pendingFace === o.id ? 'on' : '', text:pendingFace === o.id ? '取消點選朝向' : '點選朝向',
        onclick:() => { pendingFace = pendingFace === o.id ? null : o.id; setTool(tool); renderProps(); }}));
      if(s && s !== o) bs.appendChild(el('button', {text:'面向起始位置', onclick:() => { faceToward(o, s.x, s.y); upd(false); }}));
      p.appendChild(bs);
      p.appendChild(el('p', {class:'help', text:'也可以拖曳物件前方的藍色圓點旋轉，按住 Shift 以 15 度為單位。'}));
    }
  }
  switch(o.type){
    case 'paper':
      p.appendChild(row(
        selField('尺寸', [['normal','一般紙靶'],['micro','微型紙靶']], o.size, v => { o.size = v; upd(false); }),
        numField('應打發數', o.hits, 1, v => { o.hits = v == null ? 2 : Math.max(1, Math.round(v)); upd(false); }, '1')));
      p.appendChild(selField('遮蔽程度', [['full','全露'],['partial','部分遮蔽'],['heavy','嚴重遮蔽']], o.exposure, v => { o.exposure = v; upd(false); }));
      {
        const stands = venueItems('stand');
        p.appendChild(row(
          selField('靶架', [['', '自訂高度']].concat(stands.map(i => [i.id, i.name + (i.dims.top != null ? '（' + cm(i.dims.top) + '）' : '（未填高度）')])), o.standId || '', v => { const it = stands.find(i => i.id === v); if(it) applyStand(o, it); else o.standId = null; upd(false); }),
          numField('靶架最高處（公分）', o.standTop, 100, v => { o.standTop = v; o.standId = null; upd(false); })));
        const z = targetZ(o);
        p.appendChild(z ? el('div', {class:'readout', text:'靶紙離地 ' + cm(z.bottom) + ' 到 ' + cm(z.top) + ' 公分（肩部貼齊靶架頂）'})
                        : warn('尚未設定靶架高度。階段 2 判斷視線時需要。'));
      }
      break;
    case 'noshoot': {
      const papers = stage.objects.filter(x => x.type === 'paper');
      p.appendChild(selField('尺寸', [['normal','一般紙靶'],['micro','微型紙靶']], o.size, v => { o.size = v; upd(false); }));
      p.appendChild(selField('覆蓋的紙靶', [['', '（無）']].concat(papers.map(x => [x.id, x.label])), o.cover || '', v => { o.cover = v || null; upd(false); }));
      if(o.cover && getObj(o.cover)){
        p.appendChild(selField('釘法', [['lower','遮下半部（常見）'],['upper','遮上半部'],['left','遮左半部'],['right','遮右半部'],['full','完全重疊'],['custom','自訂']], o.mount || 'custom', v => { applyMount(o, v); upd(false); }));
      }
      p.appendChild(numField('相對紙靶的上下偏移（公分，往上為正）', (o.dz || 0), 100, v => { o.dz = v || 0; o.mount = 'custom'; upd(false); }, '1'));
      p.appendChild(el('p', {class:'help', text:'左右偏移直接移動 no-shoot 的位置即可；上下偏移用來表示只蓋住紙靶上半部或下半部。'}));
      break;
    }
    case 'popper':
      p.appendChild(selField('類型', [['0','鋼靶'],['1','迷你鋼靶']], o.mini ? '1' : '0', v => { o.mini = v === '1'; upd(false); }));
      break;
    case 'plate':
      p.appendChild(row(selField('形狀', [['round','圓形'],['square','方形']], o.shape, v => { o.shape = v; upd(false); }),
                        numField('直徑或邊長（公分）', o.d, 100, v => { if(v){ o.d = v; upd(false); } })));
      p.appendChild(numField('中心離地（公分）', o.cy, 100, v => { o.cy = v; upd(false); }));
      if(o.d < RULE_SPECS.fallingPlate.min - 1e-9 || o.d > RULE_SPECS.fallingPlate.max + 1e-9) p.appendChild(warn('規則書規定Falling Plate為 10 到 20 公分。'));
      break;
    case 'viewpoint':
      p.appendChild(row(selField('姿勢', STANCE_OPTS().concat([['custom','自訂眼高']]), o.stance, v => { o.stance = v; upd(false); }),
                        numField('眼高（公分）', eyeOf(o), 100, v => { if(v){ o.eyeH = v; o.stance = 'custom'; upd(false); } }, '1')));
      p.appendChild(el('p', {class:'help', text:'視點的朝向代表射手面對的方向，影響方位角與 3D 射手視角。視線分析結果顯示在左側「視線分析」。'}));
      break;
    case 'stopplate':
      p.appendChild(numField('直徑（公分）', o.d, 100, v => { if(v){ o.d = v; upd(false); } }));
      p.appendChild(numField('中心離地（公分）', o.cy, 100, v => { o.cy = v; upd(false); }));
      if(o.d < RULE_SPECS.stopPlate.minD - 1e-9) p.appendChild(warn('規則書規定 stop plate 直徑至少 15 公分。'));
      break;
    case 'barrel':
      p.appendChild(row(numField('直徑（公分）', o.d, 100, v => { if(v){ o.d = v; o.est = false; upd(false); } }),
                        numField('高（公分）', o.h, 100, v => { o.h = v; o.est = false; upd(false); })));
      break;
    case 'table': case 'prop':
      if(o.type === 'prop'){ const n = el('input', {type:'text'}); n.value = o.name || ''; n.addEventListener('change', () => { o.name = n.value; upd(false); }); p.appendChild(el('div', null, el('label', {class:'f', text:'名稱'}), n)); }
      p.appendChild(row(numField('寬（公分）', o.w, 100, v => { if(v){ o.w = v; o.est = false; upd(false); } }),
                        numField('深（公分）', o.dp, 100, v => { if(v){ o.dp = v; o.est = false; upd(false); } }),
                        numField('高（公分）', o.h, 100, v => { o.h = v; o.est = false; upd(false); })));
      break;
    case 'door':
      p.appendChild(row(numField('寬（公分）', o.w, 100, v => { if(v){ o.w = v; o.est = false; upd(false); } }),
                        numField('高（公分）', o.h, 100, v => { o.h = v; o.est = false; upd(false); })));
      break;
    case 'wall': {
      const walls = venueItems('wall');
      p.appendChild(selField('規格（來自設施尺寸組）', [['', '自訂']].concat(walls.map(w => [w.id, w.name])), o.specId || '', v => {
        const it = walls.find(w => w.id === v); if(it){ wallFromSpec(o, it); if(it.dims.w) setWallLength(o, it.dims.w); } else o.specId = null; o.est = false; upd(true);
      }));
      const L = Math.hypot(o.x2 - o.x1, o.y2 - o.y1);
      p.appendChild(numField('寬度（公分，固定起點調整終點；也可拖曳兩端）', L, 100, v => { if(v && v > 0) setWallLength(o, v); upd(true); }, '1'));
      p.appendChild(row(numField('高（公分）', o.h, 100, v => { o.h = v; o.est = false; upd(false); }),
                        numField('厚（公分）', o.t, 100, v => { o.t = v || 0.05; upd(false); })));
      p.appendChild(chk('可看穿後方（手動標記）', o.seeThrough, v => { o.seeThrough = v; upd(false); }));
      p.appendChild(chk('軟性掩護（賽程簡報指明可穿透射擊，規則 4.1.4.2）', o.soft, v => { o.soft = v; upd(false); }));
      if(!o.seeThrough && !o.soft) p.appendChild(el('p', {class:'help', text:'未勾選時，一律視為看不到檔牆後的靶，也不能穿透射擊（規則 9.1.6 剛性掩護）。'}));
      if(o.h == null) p.appendChild(warn('高度未設定。判斷視線時暫以 1.8 公尺計。'));
      else if(o.h >= 1.8) p.appendChild(el('div', {class:'msg ok', text:'高度 1.8 公尺以上，依規則 2.2.3.1 視為向上無限延伸。'}));
      o.ports = o.ports || [];
      p.appendChild(selField('窗戶', [['0','無窗'],['1','有窗']], o.ports.length ? '1' : '0', v => {
        if(v === '1' && !o.ports.length) o.ports.push(newWindow(L));
        if(v === '0') o.ports = [];
        upd(false);
      }));
      o.ports.forEach((pt, i) => {
        const d = el('div', {class:'port'});
        d.appendChild(el('div', {class:'kind', text:'窗戶 ' + (i + 1)}));
        d.appendChild(row(numField('距起點（公分）', pt.off, 100, v => { pt.off = v || 0; upd(false); }),
                          numField('寬', pt.w, 100, v => { pt.w = v || 0.1; upd(false); })));
        d.appendChild(row(numField('高', pt.h, 100, v => { pt.h = v || 0.1; upd(false); }),
                          numField('下緣離地', pt.bottom, 100, v => { pt.bottom = v || 0; upd(false); })));
        d.appendChild(selField('開窗', [['0','不需開窗（可直接射擊）'],['1','需要開窗']], pt.needOpen ? '1' : '0', v => { pt.needOpen = v === '1'; if(!pt.needOpen) pt.holdOpen = false; upd(false); }));
        if(pt.needOpen) d.appendChild(selField('開窗後', [['0','窗戶會保持開啟'],['1','需要單手維持開窗']], pt.holdOpen ? '1' : '0', v => { pt.holdOpen = v === '1'; upd(false); }));
        if(pt.holdOpen) d.appendChild(el('p', {class:'help', text:'需要單手維持開窗時，透過這個窗戶射擊為單手射擊，階段 3 的時間模型會另外計算。'}));
        d.appendChild(el('p', {class:'help', text:'也可以在圖上直接拖曳：黃色菱形移動窗戶，兩側白點調整寬度。距離從綠色「起點」量起。'}));
        d.appendChild(el('div', {class:'btns'}, el('button', {text:'窗戶置中', onclick:() => { pt.off = Math.max(0, (L - pt.w) / 2); upd(false); }}), el('button', {text:'起點與終點對調', onclick:() => { [o.x1, o.x2] = [o.x2, o.x1]; [o.y1, o.y2] = [o.y2, o.y1]; o.ports.forEach(q => q.off = Math.max(0, L - q.off - q.w)); upd(false); }})));
        d.appendChild(el('div', {class:'btns'}, el('button', {class:'danger', text:'刪除這個窗戶', onclick:() => { o.ports.splice(i, 1); upd(false); }})));
        p.appendChild(d);
      });
      if(o.ports.length) p.appendChild(el('div', {class:'btns'}, el('button', {text:'再加一個窗戶', onclick:() => { o.ports.push(newWindow(L)); upd(false); }})));
      break;
    }
    case 'faultline':
    {
      const L = Math.hypot(o.x2 - o.x1, o.y2 - o.y1);
      p.appendChild(el('div', {class:'readout', text:'長度 ' + fmt(L) + ' 公尺'}));
      if(isBoundaryLine(o)) p.appendChild(el('div', {class:'msg ok', text:'這條邊線是射擊區邊界的一部分（與檔牆或其他邊線相連），不視為無限延長。'}));
      else{
        p.appendChild(el('div', {class:'msg warn', text:'單獨邊線：依規則 2.2.1.4 視為無限延長（圖上以虛線示意）。若它其實是射擊區邊界的一部分，請把兩端接到檔牆或其他邊線，再按「由檔牆與邊線產生射擊區」。'}));
        if(L < 1.5) p.appendChild(warn('單獨擺放的邊線依規則至少需 1.5 公尺長。'));
      }
      break;
    }
    case 'tunnel': renderTunnelProps(p, o, upd); break;
    case 'platform': case 'bridge': case 'boat': case 'chair': case 'horse': renderPerchProps(p, o, upd); break;
    case 'area':
      p.appendChild(el('div', {class:'readout', text:o.pts.length + ' 個頂點，面積 ' + fmt(polyArea(o.pts), 1) + ' 平方公尺'}));
      if(o.auto) p.appendChild(el('div', {class:'help', text:'由檔牆與邊線自動產生。移動檔牆或邊線後，請再按一次「由檔牆與邊線產生射擊區」更新。'}));
      break;
  }
  if(['paper','popper','plate','stopplate'].includes(o.type)) renderHideProps(p, o, upd);
  if(o.type === 'paper' || o.type === 'noshoot') renderMechProps(p, o, upd);
  if(ACTIVATOR_TYPES.includes(o.type)) renderActivatorProps(p, o, upd);
  if(o.est) p.appendChild(warn('尺寸為估計值，請確認或從設施尺寸組補上。'));
  if(o.note) p.appendChild(el('div', {class:'msg warn', text:o.note}));
  p.appendChild(el('div', {class:'btns'}, el('button', {class:'danger', text:'刪除物件', onclick:deleteSel})));
  box.appendChild(p);
}
/* swinger as a compound pendulum: geometry, masses, lock angle, damping; shows the simulated swing */
function renderSwingProps(d, o, m, upd){
  const P = swingPar(m);
  const setP = (k, v) => { m.phys = Object.assign({}, swingPar(m), {[k]:v}); upd(false); };
  d.appendChild(el('div', {class:'kind', text:'搖擺靶（複擺）'}));
  d.appendChild(row(numField('鎖定角度（度）', m.amp == null ? 90 : m.amp, 1, v => { m.amp = Math.min(170, Math.max(1, v || 90)); upd(false); }, '1'),
    selField('鎖定時靶倒向', [['right','射手的右邊'],['left','射手的左邊']], P.side, v => setP('side', v))));
  d.appendChild(row(numField('支點到靶中心（公分）', Math.round(P.rT*100), 1, v => setP('rT', Math.max(0.05, (v || 45) / 100)), '1'),
    numField('支點到配重中心（公分）', Math.round(P.rC*100), 1, v => setP('rC', Math.max(0.02, (v || 20) / 100)), '1')));
  d.appendChild(row(numField('靶端質量（公克）', Math.round(P.mT*1000), 1, v => setP('mT', Math.max(0.01, (v || 300) / 1000)), '10'),
    numField('配重質量（公克）', Math.round(P.mC*1000), 1, v => setP('mC', Math.max(0.05, (v || 2000) / 1000)), '50')));
  d.appendChild(row(numField('擺臂質量（公克）', Math.round(P.mA*1000), 1, v => setP('mA', Math.max(0, (v || 0) / 1000)), '10'),
    numField('每來回一次振幅剩下（%）', P.keep, 1, v => setP('keep', Math.min(99, Math.max(5, v || 70))), '1')));
  const S = swingSim(m), B = S.B, ax = swingAxle(o);
  if(B.d <= 0) d.appendChild(warn('配重不足：重心在支點上方，靶會倒向一側而不是回到直立。請加重配重或加長配重端。'));
  if(ax.low) d.appendChild(warn('支點會低於地面：支點到靶中心的距離大於靶中心高度，請縮短擺臂或提高靶。'));
  const t = x => x == null ? '—' : fmt(x, 2) + ' 秒';
  d.appendChild(el('div', {class:'readout', text:'轉動慣量 ' + fmt(B.I, 3) + ' kg·m²；重心在支點下 ' + fmt(B.d*100, 1) + ' 公分；擺動週期約 ' + t(S.period) + '。'}));
  d.appendChild(el('div', {class:'readout', text:'解鎖後 ' + t(S.tCenter) + ' 第一次通過正中（最快，靶中心 ' + fmt(S.vMax, 2) + ' 公尺／秒）；' + t(S.tTurn) + ' 擺到對側最高點（' + fmt(S.turnAng ? S.turnAng*180/Math.PI : 0, 0) + '°，瞬間靜止）；約 ' + t(S.tSettle) + ' 後擺幅小於 3°。'}));
  const cv = el('canvas', {class:'swingplot', 'aria-label':'擺動角度隨時間變化'}); d.appendChild(cv);
  requestAnimationFrame(() => drawSwingPlot(cv, S));
  d.appendChild(el('p', {class:'help', text:'模型：剛體繞低摩擦軸承轉動，Iα = −Mgd·sinθ − 軸承阻尼 − 空氣阻力 − 軸承靜摩擦；解鎖時角速度為 0。啟動來源與延遲用下方「啟動方式」設定。3D 回放依此擺動；路線計畫的可射擊時間仍以上方「啟動後幾秒開始可見／不再可見」計算，可參考圖中時間設定。'}));
}
function drawSwingPlot(cv, S){
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth || 300, H = 110;
  cv.width = Math.round(W*dpr); cv.height = Math.round(H*dpr); cv.style.height = H + 'px';
  const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
  const T = Math.min(15, Math.max(4, (S.tSettle || 10) * 1.1)), A = Math.abs(S.th0), L = 26, Rr = W - 6, top = 8, bot = H - 18;
  const X = t => L + t / T * (Rr - L), Y = a => (top + bot) / 2 - a / A * (bot - top) / 2;
  c.strokeStyle = '#D6DCE2'; c.lineWidth = 1; c.beginPath(); c.moveTo(L, Y(0)); c.lineTo(Rr, Y(0)); c.stroke();
  c.fillStyle = '#5B6773'; c.font = '10px sans-serif'; c.textAlign = 'right';
  c.fillText(Math.round(A*180/Math.PI) + '°', L - 3, top + 8); c.fillText('0', L - 3, Y(0) + 3); c.fillText('-' + Math.round(A*180/Math.PI) + '°', L - 3, bot);
  c.textAlign = 'center'; for(let s = 0; s <= T; s += T > 8 ? 2 : 1) c.fillText(s + 's', X(s), H - 4);
  c.strokeStyle = '#6B3FA0'; c.lineWidth = 1.6; c.beginPath();
  const step = Math.max(1, Math.floor(T / S.dt / (W * 2)));
  for(let i = 0; i * S.dt <= T && i < S.th.length; i += step){ const x = X(i * S.dt), y = Y(S.th[i]); if(i === 0) c.moveTo(x, y); else c.lineTo(x, y); }
  c.stroke();
  if(S.tCenter != null){ c.fillStyle = '#C8372D'; c.beginPath(); c.arc(X(S.tCenter), Y(0), 3, 0, Math.PI*2); c.fill(); }
}
// manual 'cannot see from this viewpoint' marks: for curtains, pillars or a field layout the drawing does not show
function renderHideProps(p, o, upd){
  const vps = stage.objects.filter(x => x.type === 'viewpoint').sort((a, b) => String(a.label).localeCompare(String(b.label), 'zh-Hant', {numeric:true}));
  const d = el('div', {class:'port'});
  d.appendChild(el('div', {class:'kind', text:'現場遮擋（手動設定）'}));
  if(!vps.length){ d.appendChild(el('p', {class:'help', text:'放置視點後，可在這裡設定哪些視點現場看不到這個靶。'})); p.appendChild(d); return; }
  const list = Array.isArray(o.hideFrom) ? o.hideFrom : [];
  vps.forEach(v => d.appendChild(chk('從 ' + v.label + ' 看不到', list.includes(v.id), on => { setHidden(o, v.id, on); upd(false); })));
  d.appendChild(el('p', {class:'help', text:'模擬只算得到圖上的檔牆與道具。現場若被窗簾、柱子擋住，或擺設與設計圖不同，勾選後這個視點與距離它 ' + Math.round(HIDE_NEAR*100) + ' 公分內的停頓點都視為看不到此靶；路線計畫把此靶排在那裡時會警告。'}));
  p.appendChild(d);
}
function chk(lab, val, onSet){
  const id = 'p_' + Math.random().toString(36).slice(2, 8);
  const c = el('input', {type:'checkbox', id}); c.checked = !!val;
  c.addEventListener('change', () => onSet(c.checked));
  const l = el('label', {class:'check', for:id}); l.append(c, el('span', {text:lab}));
  return l;
}
function actName(id){ const a = getObj(id); return a ? a.label + ' ' + (a.type === 'trigger' ? ({laser:'雷射感應', pedal:'踏板', rope:'手拉機關', other:'機關'}[a.trig]) : OBJ[a.type].label) : '（已刪除）'; }
function renderMechProps(p, o, upd){
  if(!o.mech) o.mech = newMech();
  const m = o.mech;
  const d = el('div', {class:'port'});
  d.appendChild(el('div', {class:'kind', text:'機關'}));
  d.appendChild(selField('靶的類型', MECH_TYPES, m.type, v => { m.type = v; upd(false); }));
  if(m.type !== 'static'){
    d.appendChild(selField('啟動前', [['1','可見'],['0','被遮住，看不到']], m.preVisible ? '1' : '0', v => { m.preVisible = v === '1'; upd(false); }));
    d.appendChild(row(numField('啟動後幾秒開始可見', m.winFrom, 1, v => { m.winFrom = v; upd(false); }, '0.1'),
                      numField('啟動後幾秒不再可見', m.winTo, 1, v => { m.winTo = v; upd(false); }, '0.1')));
    d.appendChild(el('p', {class:'help', text:'可見時間窗從啟動當下起算。「不再可見」留空表示之後一直可見。'}));
    if(m.type === 'swinger' && o.type === 'paper') renderSwingProps(d, o, m, upd);
    else if(m.type === 'swinger') d.appendChild(el('p', {class:'help', text:'no-shoot 若要跟著擺動，請在 no-shoot 的「遮住哪個靶」選這個搖擺靶，並把搖擺參數設在該紙靶上。'}));
    if(m.type === 'slider'){
      d.appendChild(el('div', {class:'btns'}, el('button', {class:pendingSlide === o.id ? 'on' : '', text:pendingSlide === o.id ? '取消' : (m.ex != null ? '重新點選滑軌終點' : '點選滑軌終點'),
        onclick:() => { pendingSlide = pendingSlide === o.id ? null : o.id; pendingFace = null; setTool(tool); renderProps(); }})));
      if(m.ex != null) d.appendChild(el('div', {class:'readout', text:'滑軌長度 ' + fmt(Math.hypot(m.ex - o.x, m.ey - o.y)) + ' 公尺（靶的目前位置為起點）'}));
      d.appendChild(numField('滑完全程（秒）', m.travel, 1, v => { m.travel = v; upd(false); }, '0.1'));
    }
    if(m.type === 'monkey' || m.type === 'other' || m.type === 'disappear') d.appendChild(el('p', {class:'help', text:'目前以可見時間窗描述，動作細節可寫在下方備註。'}));
    const acts = stage.objects.filter(x => ACTIVATOR_TYPES.includes(x.type));
    d.appendChild(el('div', {class:'btns'}, el('button', {class:pendingAct === o.id ? 'on' : 'primary', text:pendingAct === o.id ? '取消點選' : '在圖上點選啟動來源',
      onclick:() => { pendingAct = pendingAct === o.id ? null : o.id; pendingFace = null; pendingSlide = null; setTool('select'); renderProps(); }})));
    d.appendChild(selField('啟動方式', [['none','未設定'],['start','隨開始訊號啟動'],['object','由鋼靶、Falling Plate、啟動機關、門或道具啟動']], m.act.mode, v => {
      m.act.mode = v; if(v === 'object' && !getObj(m.act.id)) m.act.id = acts[0] ? acts[0].id : null; upd(false);
    }));
    if(m.act.mode === 'object'){
      d.appendChild(selField('由哪個物件啟動', acts.length ? acts.map(a => [a.id, actName(a.id)]) : [['', '（圖上尚無鋼靶、Falling Plate 或啟動機關）']], m.act.id || '', v => { m.act.id = v || null; upd(false); }));
      d.appendChild(numField('啟動延遲（秒）', m.act.delay, 1, v => { m.act.delay = v || 0; upd(false); }, '0.1'));
      if(!getObj(m.act.id)) d.appendChild(warn('請先放置「啟動機關」，或指定鋼靶、Falling Plate作為啟動來源。'));
    }
    if(m.type !== 'monkey' && m.type !== 'other' && (m.winFrom == null && m.winTo == null)) d.appendChild(warn('可見時間窗未填。階段 3 計算時間需要，可先留空。'));
    const n = el('input', {type:'text', placeholder:'例如：擺動三次後停在牆後'}); n.value = m.note || '';
    n.addEventListener('change', () => { m.note = n.value; upd(false); });
    d.appendChild(el('div', null, el('label', {class:'f', text:'備註'}), n));
    if(m.auto) d.appendChild(el('div', {class:'msg warn', text:'由 STG 自動判斷，請確認類型與啟動方式。'}));
  }
  p.appendChild(d);
}
function renderActivatorProps(p, o, upd){
  const d = el('div', {class:'port'});
  if(o.type === 'trigger'){
    d.appendChild(selField('機關類型', TRIG_TYPES, o.trig, v => { o.trig = v; upd(false); }));
    if(o.trig === 'laser') d.appendChild(numField('感應線長度（公尺）', o.len, 1, v => { o.len = v || 1; upd(false); }, '0.1'));
  }
  const targets = stage.objects.filter(x => x.type === 'paper' || x.type === 'noshoot');
  d.appendChild(el('div', {class:'kind', text:'擊倒或觸發後，啟動哪些靶'}));
  if(o.type === 'popper' || o.type === 'plate') d.appendChild(el('p', {class:'help', text:'鋼靶、Falling Plate 被 BB 擊倒時啟動；勾選的靶從擊中時起算（再加各靶的啟動延遲）。'}));
  if(!targets.length) d.appendChild(el('p', {class:'help', text:'圖上尚無紙靶。'}));
  targets.forEach(t => {
    const linked = isMech(t) && t.mech.act.mode === 'object' && t.mech.act.id === o.id;
    d.appendChild(chk(t.label + (isMech(t) ? '（' + MECH_TYPES.find(x => x[0] === t.mech.type)[1] + '）' : '（固定靶，勾選後改為搖擺靶）'), linked, on => {
      if(!t.mech) t.mech = newMech();
      if(on){ if(t.mech.type === 'static') t.mech.type = 'swinger'; t.mech.act = {mode:'object', id:o.id, delay:t.mech.act ? t.mech.act.delay || 0 : 0}; }
      else if(t.mech.act.id === o.id) t.mech.act = {mode:'none', id:null, delay:0};
      upd(false);
    }));
  });
  p.appendChild(d);
}
function updateRotField(o){ const f = document.getElementById('rotField'); if(f) f.value = String(o.rot); }
function renderList(){
  const ul = $('objList'); ul.innerHTML = '';
  const order = Object.keys(OBJ);
  stage.objects.slice().sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || String(a.label).localeCompare(String(b.label), 'zh-Hant', {numeric:true}))
    .forEach(o => {
      const li = el('li', {class:o.id === selId ? 'sel' : ''}, el('span', {text:o.label}), el('span', {class:'k', text:kindLabel(o)}));
      li.addEventListener('click', () => { selId = o.id; setTool('select'); renderList(); renderProps(); renderViews(); });
      ul.appendChild(li);
    });
  if(!stage.objects.length) ul.appendChild(el('li', {text:'尚無物件'}));
}

/* ---------- UI sync ---------- */
function syncUI(){
  const ul = $('ptList'); ul.innerHTML = '';
  PT_NAMES.forEach((n, i) => {
    const p = stage.points[i];
    const li = el('li', {class:p ? 'set' : ''});
    li.innerHTML = '<span class="dot">' + (i+1) + '</span><span>' + n + '</span><span class="coord">' +
      (p ? Math.round(p.u) + ', ' + Math.round(p.v) : (i === stage.points.length ? '下一個要點的' : '')) + '</span>';
    ul.appendChild(li);
  });
  $('effDepth').textContent = fmt(effDepth()) + ' 公尺（原設定 ' + fmt(stage.rect.depth) + ' × ' + fmt(stage.rect.depthScale, 3) + '）';
  const srcTxt = {none:'手動', jpg:img ? '圖檔' : '圖檔（未載入）', stg:'STG'}[stage.source] || '';
  $('stStage').textContent = srcTxt; $('stStage').className = 'state' + (stage.source !== 'none' ? ' done' : '');
  $('stCal').textContent = stage.source === 'stg' ? '不需要' : !img ? '無圖檔' : H ? '已校正' : (stage.points.length + ' / 4 點');
  $('stCal').className = 'state' + (H ? ' done' : '');
  $('stObj').textContent = stage.objects.length + ' 個';
  $('ptUndo').disabled = !stage.points.length || !img;
  $('ptReset').disabled = !stage.points.length || !img;
  $('calibTool').disabled = !img;
  if(!img && leftTab === 'img') setLeftTab('3d');
  $('imgEmpty').classList.toggle('hidden', !!img);
  $('stgBox').classList.toggle('hidden', stage.source !== 'stg');
  if(stage.source === 'stg' && stage.stgMeta){
    const m = stage.stgMeta;
    $('stgMeta').textContent = [
      'STG 名稱：' + (m.stageName || ''), '設計者：' + (m.author || ''),
      '發數 ' + (m.numRounds ?? '') + '，紙靶 ' + (m.numPaper ?? '') + '，剛性靶 ' + (m.numSteel ?? '') + '，no-shoot ' + (m.numNoshoots ?? '') + '，滿分 ' + (m.numPoints ?? ''),
      '起始姿勢：' + (m.startPosition || ''), 'STG 準備狀態欄位：' + (m.readyCondition || ''), '程序：' + (m.procedure || '')
    ].join('\n');
  }
  $('mirrorBtn').disabled = stage.source !== 'stg';
}
function fillInputs(){
  $('stageName').value = stage.name; $('matchName').value = stage.matchName; $('matchDate').value = stage.matchDate;
  $('rectW').value = stage.rect.width; $('rectD').value = stage.rect.depth; $('depthScale').value = stage.rect.depthScale;
  $('x0').value = stage.rect.x0; $('y0').value = stage.rect.y0;
  $('mSide').value = stage.margins.side; $('mFront').value = stage.margins.front; $('mBack').value = stage.margins.back;
  $('lockRow').checked = stage.lockRow; $('showGrid').checked = stage.showGrid; $('defTarget').value = stage.defTarget || 'normal';
}
function numInput(id, set){
  $(id).addEventListener('input', e => { const v = parseFloat(e.target.value); if(isNaN(v)) return; set(v); recompute(false); });
  $(id).addEventListener('change', () => saveStage());
}

/* ---------- STG import ---------- */
function decodeText(buf){
  const b = new Uint8Array(buf);
  let t;
  if(b[0] === 0xFF && b[1] === 0xFE) t = new TextDecoder('utf-16le').decode(buf);
  else if(b[0] === 0xFE && b[1] === 0xFF) t = new TextDecoder('utf-16be').decode(buf);
  else if(b.length > 1 && b[1] === 0 && b[0] !== 0) t = new TextDecoder('utf-16le').decode(buf);
  else t = new TextDecoder('utf-8').decode(buf);
  return t.replace(/^\uFEFF/, '');
}
function chainSegments(segs, tol){
  const used = new Array(segs.length).fill(false);
  const near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= tol;
  const avg = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const polys = [], lines = [];
  for(let i = 0; i < segs.length; i++){
    if(used[i]) continue;
    used[i] = true;
    let path = [segs[i][0].slice(), segs[i][1].slice()];
    let grew = true;
    while(grew){
      grew = false;
      for(let j = 0; j < segs.length; j++){
        if(used[j]) continue;
        const [a, b] = segs[j], end = path[path.length - 1], st = path[0];
        if(near(end, a)){ path[path.length - 1] = avg(end, a); path.push(b.slice()); }
        else if(near(end, b)){ path[path.length - 1] = avg(end, b); path.push(a.slice()); }
        else if(near(st, b)){ path[0] = avg(st, b); path.unshift(a.slice()); }
        else if(near(st, a)){ path[0] = avg(st, a); path.unshift(b.slice()); }
        else continue;
        used[j] = true; grew = true;
      }
    }
    if(path.length >= 4 && near(path[0], path[path.length - 1])){
      const last = path.pop(); path[0] = avg(path[0], last); polys.push(path);
    }else{
      for(let k = 0; k < path.length - 1; k++) lines.push([path[k], path[k + 1]]);
    }
  }
  return {polys, lines};
}
function importSTG(d){
  if(!d || !Array.isArray(d.propList)) throw new Error('bad');
  learnStg(d);
  const keepSet = stage.defTarget;
  stage = newStage(); stage.defTarget = keepSet;
  stage.source = 'stg'; stage.name = d.stageName || '';
  stage.stgMeta = {stageName:d.stageName, author:d.stageAuthor, numRounds:d.numRounds, numPaper:d.numPaper, numSteel:d.numSteel,
    numNoshoots:d.numNoshoots, numPoints:d.numPoints, startPosition:d.startPosition, procedure:d.procedure, fileVersion:d.fileVersion,
    readyCondition:d.readyCondition, startStop:d.startStop, stageBrief:d.stageBrief};
  { const top = Object.assign({}, d); delete top.propList; const props = {}; d.propList.forEach(p => props[String(p.uniqueID)] = clone(p)); stage.stgMeta.raw = {top, props}; stage.stgMeta.mirrors = []; }
  img = null; srcData = null; H = null; Hinv = null; selId = null; draft = null;
  const conv = (X, Y) => [X / 100, -Y / 100];
  const segs = [], pendingNS = [], gunPts = [], magPts = [];
  const skip = /(^|-)(cz|glock|pistol|gun|rifle|shotgun|magazine|camera|ruler)(-|$)/;
  let skipped = 0;
  d.propList.forEach(p => {
    const tr = p.propTransform || {}, T = tr.Translation || {X:0, Y:0}, R = tr.Rotation || {Z:0, W:1}, S = tr.Scale3D || {X:1, Y:1, Z:1};
    const yaw = 2 * Math.atan2(R.Z || 0, R.W == null ? 1 : R.W);
    const name = String(p.propName || '').toLowerCase();
    const txt = p.customText && p.customText !== 'walk' ? String(p.customText) : '';
    const [x, y] = conv(T.X, T.Y), rot = normDeg(deg(yaw));
    const put = (o) => { if(txt) o.label = txt; o.stgId = String(p.uniqueID); o.stgName = name; o.stgRot0 = o.rot || 0; if(p.swingerAngle != null) o.stgSwing = p.swingerAngle; if(Array.isArray(p.activateIDs) && p.activateIDs.length) o.stgActivates = p.activateIDs.map(String); stage.objects.push(o); return o; };
    if(name.includes('faultline')){
      const L = 10 * (S.X || 1);
      segs.push([[x, y], conv(T.X + L * Math.cos(yaw), T.Y + L * Math.sin(yaw))]);
    }else if(name.includes('two-side') && name.includes('noshoot')){
      const f = facing(rot), pp = [-f[1], f[0]], off = 0.21;
      const labels = String(p.customText || '').split(/\s+/).filter(Boolean);
      const ns = createPointObj('noshoot', x, y); ns.rot = rot; ns.stgId = String(p.uniqueID); ns.stgName = name;
      [-1, 1].forEach((sgn, i) => {
        const t = createPointObj('paper', x + pp[0]*off*sgn - f[0]*0.02, y + pp[1]*off*sgn - f[1]*0.02);
        t.rot = rot; t.stgPart = String(p.uniqueID); t.note = 'STG 雙側 no-shoot 組件（' + p.propName + '）拆出的紙靶，左右位置為估計值，請確認。';
        if(labels[i]) t.label = labels[i];
        stage.objects.push(t);
        if(i === 0) ns.cover = t.id;
      });
      ns.note = '雙側 no-shoot，兩側各有一張紙靶。';
      stage.objects.push(ns);
    }else if(name.includes('noshoot') || name.includes('no-shoot')){
      const o = createPointObj('noshoot', x, y); o.rot = rot; o.size = name.includes('micro') ? 'micro' : 'normal'; pendingNS.push(put(o));
    }else if(name.includes('popper')){
      const o = createPointObj('popper', x, y); o.mini = name.includes('mini'); put(o);
    }else if(name.includes('stop')){
      put(createPointObj('stopplate', x, y));
    }else if(name.includes('plate')){
      const o = createPointObj('plate', x, y); o.rot = rot; put(o);
    }else if(name.includes('target') || name.startsWith('ipsc-')){
      const o = createPointObj('paper', x, y); o.rot = rot; o.size = name.includes('micro') ? 'micro' : 'normal'; put(o);
    }else if(name.includes('wall') || name.includes('barricade') || name.includes('panel')){
      const m = name.match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/);
      const ws = m ? null : wallSpecFor(name);
      let w = m ? parseFloat(m[1]) : (ws && ws.dims.w ? ws.dims.w : 1.2); const h = m ? parseFloat(m[2]) : (ws && ws.dims.h ? ws.dims.h : null);
      w *= (S.X || 1);
      const ux = Math.cos(yaw), uy = Math.sin(yaw), half = w * 50;
      const a = conv(T.X - ux * half, T.Y - uy * half), b = conv(T.X + ux * half, T.Y + uy * half);
      const o = createLineObj('wall', a, b);
      o.specId = ws && ws.it ? ws.it.id : null; o.h = h; o.t = ws && ws.dims.t ? ws.dims.t : 0.03; o.ports = [];
      o.est = !m && !(ws && ws.dims.w);
      o.note = 'STG 物件：' + p.propName + '。' + (m ? '寬高由名稱推得。' : ws ? '依常用' + (ws.it ? ws.it.name : '檔牆') + '尺寸' + (ws.dims.w ? '' : '（寬度未設定，暫以 120 公分計）') + '。' : 'STG 未記錄檔牆實際尺寸，寬度為估計值、高度未設定，請確認。');
      if(name.includes('port')){ o.ports = [{off:Math.max(0, w/2 - 0.25), w:0.5, h:0.5, bottom:1.2, needOpen:false, holdOpen:false}]; o.note += ' 原檔有窗戶，窗戶位置、尺寸與開窗方式為估計值。'; }
      put(o);
    }else if(name.includes('barrel')){
      put(createPointObj('barrel', x, y));
    }else if(name.includes('table')){
      const o = createPointObj('table', x, y); o.rot = rot; put(o);
    }else if(name.includes('door')){
      const o = createPointObj('door', x, y); o.rot = rot; put(o);
    }else if(name.includes('shooter')){
      const o = createPointObj('start', x, y); o.rot = normDeg(rot); o.label = '起始'; o.stgId = String(p.uniqueID); o.stgName = name; o.stgRot0 = o.rot; stage.objects.push(o);
    }else if(skip.test(name)){
      skipped++;
      if(/(^|-)magazine(-|$)/.test(name)) magPts.push([x, y]); else if(!/(camera|ruler)/.test(name)) gunPts.push([x, y]);
    }else{
      const o = createPointObj('prop', x, y); o.rot = rot; o.name = p.propName; o.est = true; put(o);
    }
  });
  pendingNS.forEach(o => { o.cover = nearestPaper(o.x, o.y, 0.4); if(o.cover){ o.dz = -targetSpec(o.size).h / 2; o.mount = 'lower'; o.note = 'STG 未記錄 no-shoot 與紙靶的上下關係，預設遮住紙靶下半部，請確認。'; } });
  // moving targets and their activators
  const guessMech = n => /swing/.test(n) ? 'swinger' : /(slide|slider|mover|pulley)/.test(n) ? 'slider' : /(drop|disappear|clam|popup|pop-up)/.test(n) ? 'disappear' : /monkey/.test(n) ? 'monkey' : null;
  stage.objects.forEach(o => {
    if((o.type === 'paper' || o.type === 'noshoot') && o.stgName){
      const g = guessMech(o.stgName);
      if(g){ o.mech.type = g === 'monkey' || g === 'disappear' || g === 'slider' ? g : 'swinger'; o.mech.auto = true; }
    }
    if(o.mech && o.mech.type === 'swinger' && o.stgSwing != null && o.mech.amp == null) o.mech.amp = o.stgSwing;
  });
  stage.objects.forEach(a => {
    (a.stgActivates || []).forEach(tid => {
      const t = stage.objects.find(x => x.stgId === tid && (x.type === 'paper' || x.type === 'noshoot'));
      if(!t) return;
      if(t.mech.type === 'static') t.mech.type = 'swinger';   // unknown mechanism: treat as swinger for now
      t.mech.act = {mode:'object', id:a.id, delay:0}; t.mech.auto = true;
    });
  });
  // start condition: guns / magazines resting on a barrel or table
  const nearestHolder = (x, y) => {
    let best = null, bd = 1.2;
    stage.objects.forEach(o => { if(HOLDERS.includes(o.type)){ const d = Math.hypot(o.x - x, o.y - y); if(d <= bd){ bd = d; best = o.id; } } });
    return best;
  };
  const sc = stage.startCond, txt = String(d.startPosition || '');
  const gh = gunPts.map(p => nearestHolder(p[0], p[1])).find(Boolean);
  if(gh){ sc.gunLoc = 'object'; sc.gunObj = gh; sc.auto = true; }
  else if(/槍.{0,4}(桶|桌|箱)|gun .{0,20}(barrel|table)/i.test(txt)){ const h = stage.objects.find(o => HOLDERS.includes(o.type)); if(h){ sc.gunLoc = 'object'; sc.gunObj = h.id; sc.auto = true; } }
  const mh = magPts.map(p => nearestHolder(p[0], p[1])).find(Boolean);
  if(mh){ sc.ready = 'unloaded'; sc.magLoc = 'object'; sc.magObj = mh; sc.auto = true; }
  else if(/(彈匣|匣).{0,3}(在)?身上|magazine.{0,20}(on|in).{0,10}(belt|body|person)/i.test(txt) && sc.gunLoc === 'object'){ sc.ready = 'unloaded'; sc.magLoc = 'body'; sc.auto = true; }
  segs.forEach(([a, b]) => stage.objects.push(createLineObj('faultline', a, b)));
  // shift so the scene starts near the origin (front-left)
  let minX = Infinity, minY = Infinity;
  stage.objects.forEach(o => objPts(o).forEach(p => { minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]); }));
  if(isFinite(minX)){ const dx = 0.5 - minX, dy = 0.5 - minY; stage.objects.forEach(o => moveObj(o, dx, dy)); stage.stgMeta.shift = [dx, dy]; }
  if(/面向靶|facing downrange/i.test(txt)) sc.facing = 'downrange';
  const allTxt = txt + ' ' + String(d.readyCondition || '');
  const cm = String(txt).match(/con\s*([123])/i) || allTxt.match(/con\s*([123])/i);
  if(cm){ sc.ready = {1:'loaded', 2:'emptyChamber', 3:'unloaded'}[cm[1]]; if(sc.ready === 'unloaded' && sc.magLoc === 'gun') sc.magLoc = 'body'; if(sc.ready !== 'unloaded') sc.magLoc = 'gun'; sc.auto = true; }
  else if(sc.gunLoc === 'holster' && /(入套|槍套|holster)/i.test(txt)){ sc.ready = /空膛|未上膛|empty chamber/i.test(txt) ? 'emptyChamber' : 'loaded'; sc.auto = true; }
  if(txt.trim()) sc.note = txt.replace(/\r?\n+/g, '／').replace(/／$/, '').trim();
  generateAreas();
  return skipped;
}
function mirrorX(){
  let minX = Infinity, maxX = -Infinity;
  stage.objects.forEach(o => objPts(o).forEach(p => { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); }));
  if(!isFinite(minX)) return;
  const c = minX + maxX;
  if(stage.stgMeta){ (stage.stgMeta.mirrors = stage.stgMeta.mirrors || []).push(c); }
  stage.objects.forEach(o => {
    const k = OBJ[o.type].kind;
    if(k === 'point'){ o.x = c - o.x; o.rot = normDeg(-(o.rot || 0)); if(o.mech && o.mech.ex != null) o.mech.ex = c - o.mech.ex; }
    else if(k === 'line'){ o.x1 = c - o.x1; o.x2 = c - o.x2; }
    else o.pts.forEach(p => p[0] = c - p[0]);
  });
  objectsChanged(true);
}

/* ---------- phase 6: STG export and prop-name catalogue ---------- */
// Practisim only understands its own prop names, so names are learned from every imported STG file.
const LS_STGCAT = 'stageSim.stgCatalog';
const STG_GUESS = {faultline:'faultline-adjustable', 'noshoot:two-side':'ipsc-two-side-noshoot', paper:'ipsc-target', 'paper:micro':'ipsc-micro-target',
  noshoot:'ipsc-noshoot', 'noshoot:micro':'ipsc-micro-noshoot', popper:'ipsc-popper', 'popper:mini':'ipsc-mini-popper', plate:'ipsc-plate', stopplate:'ipsc-stop-plate',
  wall:'wall', barrel:'barrel', table:'table', door:'door', shooter:'shooter'};
const STG_KEY_NAME = {faultline:'邊線', 'noshoot:two-side':'雙側 no-shoot', paper:'紙靶', 'paper:micro':'小紙靶', 'paper:swinger':'搖擺靶', 'paper:slider':'滑動靶', 'paper:disappear':'隱顯靶', 'paper:monkey':'猴子靶',
  noshoot:'no-shoot', 'noshoot:micro':'小 no-shoot', popper:'Popper', 'popper:mini':'Mini Popper', plate:'Falling Plate', stopplate:'stop plate', wall:'檔牆', barrel:'油桶', table:'桌子', door:'門', shooter:'起始位置', skip:'槍枝或彈匣', prop:'其他道具'};
function stgCatalog(){ try{ return JSON.parse(localStorage.getItem(LS_STGCAT)) || {keys:{}, top:null, files:0}; }catch(e){ return {keys:{}, top:null, files:0}; } }
function saveStgCatalog(c){ try{ localStorage.setItem(LS_STGCAT, JSON.stringify(c)); }catch(e){} }
function stgMechOf(n){ return /swing/.test(n) ? 'swinger' : /(slide|slider|mover|pulley)/.test(n) ? 'slider' : /(drop|disappear|clam|popup|pop-up)/.test(n) ? 'disappear' : /monkey/.test(n) ? 'monkey' : null; }
// same classification as importSTG
function stgClass(name){
  const n = String(name || '').toLowerCase();
  if(n.includes('faultline')) return 'faultline';
  if(n.includes('two-side') && n.includes('noshoot')) return 'noshoot:two-side';
  if(n.includes('noshoot') || n.includes('no-shoot')) return n.includes('micro') ? 'noshoot:micro' : 'noshoot';
  if(n.includes('popper')) return n.includes('mini') ? 'popper:mini' : 'popper';
  if(n.includes('stop')) return 'stopplate';
  if(n.includes('plate')) return 'plate';
  if(n.includes('target') || n.startsWith('ipsc-')){ const m = stgMechOf(n); return m ? 'paper:' + m : n.includes('micro') ? 'paper:micro' : 'paper'; }
  if(n.includes('wall') || n.includes('barricade') || n.includes('panel')) return 'wall';
  if(n.includes('barrel')) return 'barrel';
  if(n.includes('table')) return 'table';
  if(n.includes('door')) return 'door';
  if(n.includes('shooter')) return 'shooter';
  if(/(^|-)(cz|glock|pistol|gun|rifle|shotgun|magazine|camera|ruler)(-|$)/.test(n)) return 'skip';
  return 'prop';
}
function stgWallBaseW(name){ const n = String(name).toLowerCase(), m = n.match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/); if(m) return parseFloat(m[1]); const ws = wallSpecFor(n); return ws && ws.dims.w ? ws.dims.w : 1.2; }
function learnStg(d){
  const c = stgCatalog(); c.keys = c.keys || {};
  const top = Object.assign({}, d); delete top.propList; c.top = top; c.files = (c.files || 0) + 1;
  d.propList.forEach(p => {
    const k = stgClass(p.propName); const L = c.keys[k] || (c.keys[k] = []);
    if(L.some(x => x.name === p.propName)) return;
    const rec = clone(p); delete rec.propTransform; delete rec.activateIDs; delete rec.uniqueID;
    L.push({name:p.propName, rec, w:k === 'wall' ? stgWallBaseW(p.propName) : null});
    if(L.length > 30) L.shift();
  });
  saveStgCatalog(c);
}
function stgObjKey(o){
  if(o.type === 'faultline') return 'faultline';
  if(o.type === 'paper'){ const m = o.mech && o.mech.type && o.mech.type !== 'static' ? o.mech.type : null; return m ? 'paper:' + m : o.size === 'micro' ? 'paper:micro' : 'paper'; }
  if(o.type === 'noshoot') return (o.stgName || '').includes('two-side') ? 'noshoot:two-side' : o.size === 'micro' ? 'noshoot:micro' : 'noshoot';
  if(o.type === 'popper') return o.mini ? 'popper:mini' : 'popper';
  if(['plate','stopplate','wall','barrel','table','door'].includes(o.type)) return o.type;
  if(o.type === 'start') return 'shooter';
  if(o.type === 'prop') return 'prop';
  return null;
}
// undo the shift and any mirroring applied after import, then convert to STG centimetres (Y flipped)
function toStgXY(x, y){
  const m = stage.stgMeta || {};
  (m.mirrors || []).slice().reverse().forEach(c => { x = c - x; });
  const sh = m.shift || [0, 0];
  return [(x - sh[0]) * 100, -(y - sh[1]) * 100];
}
function stgRot(rot){ let r = rot || 0; ((stage.stgMeta || {}).mirrors || []).forEach(() => { r = -r; }); return rad(r); }
function quat(yaw){ return {X:0, Y:0, Z:Math.sin(yaw / 2), W:Math.cos(yaw / 2)}; }
function buildSTG(){
  const cat = stgCatalog(), meta = stage.stgMeta || {}, raw = meta.raw || null;
  const report = {orig:[], learned:[], guess:[], skipped:[], kept:0};
  const props = [], idOf = {};
  let nextId = 1;
  if(raw) Object.keys(raw.props).forEach(k => { const n = parseInt(k, 10); if(isFinite(n)) nextId = Math.max(nextId, n + 1); });
  const pickName = (key, o, wantW) => {
    const L = (cat.keys && cat.keys[key]) || [];
    if(L.length){
      let best = L[0];
      if(key === 'wall' && wantW){ best = L.slice().sort((a, b) => Math.abs((a.w || 1.2) - wantW) - Math.abs((b.w || 1.2) - wantW))[0]; }
      if(key === 'prop' && o.name){ const hit = L.find(x => x.name === o.name); if(hit) best = hit; else return null; }
      return {name:best.name, rec:clone(best.rec), src:'learned'};
    }
    if(key.startsWith('paper:') && key !== 'paper:micro'){ const base = (cat.keys && cat.keys.paper) || []; if(base.length) return {name:base[0].name, rec:clone(base[0].rec), src:'learned', note:'機關類型改為一般紙靶'}; }
    if(key === 'prop') return o.name ? {name:o.name, rec:{}, src:'guess'} : null;
    const g = STG_GUESS[key] || STG_GUESS[key.split(':')[0]];
    return g ? {name:g, rec:{}, src:'guess'} : null;
  };
  const isDerived = o => o.type === 'paper' && (o.stgPart || String(o.note || '').startsWith('STG 雙側'));
  stage.objects.forEach(o => {
    if(isDerived(o)) return;
    const key = stgObjKey(o);
    if(!key){ report.skipped.push((o.label ? o.label + '（' + OBJ[o.type].label + '）' : OBJ[o.type].label)); return; }
    let src, name, rec, Z = 0, sY = 1, sZ = 1, note = '';
    const orig = o.stgId && raw && raw.props[o.stgId];
    let wantW = null;
    if(o.type === 'wall') wantW = Math.hypot(o.x2 - o.x1, o.y2 - o.y1);
    if(orig && o.type !== 'faultline'){ src = 'orig'; rec = clone(orig); name = orig.propName; }
    else { const pk = pickName(key, o, wantW); if(!pk){ report.skipped.push((o.label || OBJ[o.type].label) + '（名稱庫沒有這種道具）'); return; } src = pk.src; rec = pk.rec; name = pk.name; note = pk.note || ''; }
    const T0 = (rec.propTransform && rec.propTransform.Translation) || {}, S0 = (rec.propTransform && rec.propTransform.Scale3D) || {};
    Z = T0.Z || 0; sY = S0.Y == null ? 1 : S0.Y; sZ = S0.Z == null ? 1 : S0.Z;
    let T, yaw, sX = S0.X == null ? 1 : S0.X;
    if(o.type === 'wall' || o.type === 'faultline'){
      const A = toStgXY(o.x1, o.y1), B = toStgXY(o.x2, o.y2), Lcm = Math.hypot(B[0] - A[0], B[1] - A[1]);
      yaw = Math.atan2(B[1] - A[1], B[0] - A[0]);
      if(o.type === 'wall'){ T = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2]; sX = (Lcm / 100) / stgWallBaseW(name); }
      else { T = A; sX = Lcm / 10; }
    }else{
      T = toStgXY(o.x, o.y); yaw = stgRot(o.rot);
      let r = o.rot || 0; ((stage.stgMeta || {}).mirrors || []).forEach(() => { r = -r; });
      if(orig && o.stgRot0 != null && Math.abs(normDeg(r - o.stgRot0)) < 0.01 && orig.propTransform && orig.propTransform.Rotation) yaw = null;
    }
    const id = orig ? rec.uniqueID : nextId++;
    idOf[o.id] = id;
    rec.propName = name; rec.uniqueID = id;
    rec.propTransform = {Translation:{X:Math.round(T[0] * 100) / 100, Y:Math.round(T[1] * 100) / 100, Z}, Rotation:yaw == null ? clone(orig.propTransform.Rotation) : quat(yaw), Scale3D:{X:Math.round(sX * 10000) / 10000, Y:sY, Z:sZ}};
    if(['paper','noshoot','popper','plate','stopplate'].includes(o.type) && o.label && !/^(T|NS|P|PP|SP)\d+$/.test(o.label)) rec.customText = o.label;
    else if(['paper','popper','plate','stopplate'].includes(o.type) && !orig) rec.customText = o.label || '';
    if(o.mech && o.mech.type === 'swinger' && o.mech.amp != null) rec.swingerAngle = o.mech.amp;
    delete rec.activateIDs;
    props.push({o, rec});
    report[src].push((o.label || STG_KEY_NAME[key] || key) + (note ? '（' + note + '）' : '') + (src === 'guess' ? '：' + name : ''));
  });
  // activation links: the activator lists the ids it activates
  props.forEach(({o}) => {
    const m = o.mech; if(!m || !m.act || m.act.mode !== 'object' || !m.act.id) return;
    const a = props.find(x => x.o.id === m.act.id); if(!a || idOf[o.id] == null) return;
    (a.rec.activateIDs = a.rec.activateIDs || []).push(idOf[o.id]);
  });
  // guns, magazines and other props the simulator skipped are kept exactly as they were
  if(raw) Object.values(raw.props).forEach(p => { if(stgClass(p.propName) === 'skip'){ props.push({o:null, rec:clone(p)}); report.kept++; } });
  const papers = stage.objects.filter(o => o.type === 'paper'), steel = stage.objects.filter(o => ['popper','plate','stopplate'].includes(o.type));
  const plan = activePlan(), R = plan ? planResult(plan) : null;
  const rounds = R && R.shots.length ? R.shots.length : papers.reduce((a, o) => a + (o.hits || 2), 0) + steel.length;
  const sc = stage.startCond;
  const top = Object.assign({}, cat.top || {}, raw ? raw.top : {}, {
    stageName:stage.name || (raw && raw.top.stageName) || 'Stage',
    numRounds:rounds, numPaper:papers.length, numSteel:steel.length, numNoshoots:stage.objects.filter(o => o.type === 'noshoot').length,
    numPoints:papers.reduce((a, o) => a + (o.hits || 2) * 5, 0) + steel.length * 5
  });
  if(raw){
    const isT = k => /^(paper|popper|plate|stopplate)/.test(k);
    const rawT = Object.values(raw.props).filter(p => isT(stgClass(p.propName))).length;
    const nowT = stage.objects.filter(o => ['paper','popper','plate','stopplate'].includes(o.type) && !isDerived(o));
    if(nowT.length === rawT && nowT.every(o => o.stgId && raw.props[o.stgId])) ['numRounds','numPaper','numSteel','numNoshoots','numPoints'].forEach(k => { if(raw.top[k] != null) top[k] = raw.top[k]; });
    else report.recount = true;
  }
  if(!raw){ top.startPosition = sc.note || startSummary(); top.readyCondition = {loaded:'CON1', emptyChamber:'CON2', unloaded:'CON3'}[sc.ready] || ''; top.startStop = steel.some(o => o.type === 'stopplate') ? 'Stop plate' : 'Last shot'; }
  top.propList = props.map(x => x.rec);
  return {data:top, report};
}
function utf16Blob(text){
  const buf = new Uint8Array(2 + text.length * 2); buf[0] = 0xFF; buf[1] = 0xFE;
  for(let i = 0; i < text.length; i++){ const c = text.charCodeAt(i); buf[2 + i*2] = c & 255; buf[3 + i*2] = c >> 8; }
  return new Blob([buf], {type:'application/octet-stream'});
}
function exportSTG(){
  const {data, report} = buildSTG();
  const a = document.createElement('a'); a.href = URL.createObjectURL(utf16Blob(JSON.stringify(data, null, '\t'))); a.download = safeName(stage.name || 'stage') + '.stg';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  renderStgExportReport(report);
}
function renderStgExportReport(r){
  const box = $('stgExportBox'); if(!box) return; box.innerHTML = ''; box.classList.remove('hidden');
  box.appendChild(el('div', {class:'kind', text:'STG 匯出結果'}));
  const ul = el('ul', {class:'summ'});
  const line = (t, list, warnIt) => { if(!list.length) return; const li = el('li', {text:t + ' ' + list.length + ' 個：' + list.slice(0, 12).join('、') + (list.length > 12 ? '…' : '')}); if(warnIt) li.style.color = 'var(--warn)'; ul.appendChild(li); };
  line('沿用原檔名稱與編號', r.orig); line('依名稱庫', r.learned); line('推測名稱（Practisim 可能不認得）', r.guess, true); line('未匯出', r.skipped, true);
  if(r.kept) ul.appendChild(el('li', {text:'原檔的槍枝、彈匣等物件照原樣保留 ' + r.kept + ' 個'}));
  if(r.recount) ul.appendChild(el('li', {text:'靶有增減，總發數、靶數與總分已依目前的物件重新計算（總發數優先取目前路線計畫的槍數）'}));
  box.appendChild(ul);
  box.appendChild(el('p', {class:'help', text:'請在 Practisim 開啟確認位置、方向與尺寸。射擊區由邊線與檔牆產生，本身不匯出；視點、機關觸發器等模擬器專用物件也不匯出。有「推測名稱」的物件，先匯入一個含有該種道具的 STG 讓名稱庫學會正確名稱，再匯出一次。'}));
}
function renderStgCatalogInfo(){
  const box = $('stgCatBox'); if(!box) return; box.innerHTML = '';
  const c = stgCatalog(), keys = Object.keys(c.keys || {}).filter(k => k !== 'skip');
  const n = keys.reduce((a, k) => a + c.keys[k].length, 0);
  box.appendChild(el('div', {class:'help', text:c.files ? 'STG 物件名稱庫：已從 ' + c.files + ' 個 STG 檔學到 ' + keys.length + ' 類、' + n + ' 個物件名稱（' + keys.map(k => STG_KEY_NAME[k] || k).join('、') + '）。' : 'STG 物件名稱庫是空的。匯入過的 STG 檔會自動累積 Practisim 的物件名稱，匯出時使用。'}));
  if(c.files) box.appendChild(el('div', {class:'btns'}, el('button', {text:'清除名稱庫', onclick:() => { if(confirm('清除已學到的 STG 物件名稱？')){ localStorage.removeItem(LS_STGCAT); renderStgCatalogInfo(); } }})));
}

/* ---------- stage file io ---------- */
function exportStage(){
  const set = activeSet();
  const o = {
    schemaVersion:SCHEMA, type:'stage', exported:new Date().toISOString(),
    meta:{name:stage.name, matchName:stage.matchName, matchDate:stage.matchDate, source:stage.source},
    stgMeta:stage.stgMeta,
    venueSet:set ? {name:set.name, items:clone(set.items)} : null,
    ruleSpecs:RULE_SPECS,
    sourceImage:stage.image ? {dataUrl:stage.image, width:stage.imgW, height:stage.imgH} : null,
    calibration:stage.image ? {
      mode:'rect4', imagePoints:stage.points.map((p, i) => ({name:PT_NAMES[i], u:p.u, v:p.v})),
      rect:{width:stage.rect.width, depth:stage.rect.depth, depthScale:stage.rect.depthScale, effectiveDepth:effDepth(), x0:stage.rect.x0, y0:stage.rect.y0},
      margins:clone(stage.margins), lockRow:stage.lockRow, homographyWorldToImage:H
    } : null,
    defTarget:stage.defTarget,
    design:stage.design ? clone(stage.design) : null,
    startCondition:clone(stage.startCond), startKey:startKey(), eye:clone(stage.eye), safety:clone(stage.safety), plateCy:stage.plateCy, flex:stage.flex,
    objects:clone(stage.objects), plans:clone(stage.plans || []), results:clone(stage.results || []), myPlanId:stage.myPlanId || null, runs:clone(stage.runs || []), clips:clone(stage.clips || []), clipCmp:clone(stage.clipCmp || null)
  };
  download(safeName(stage.name) + '.stage.json', o);
}
function importStage(o){
  const s = newStage();
  s.name = o.meta?.name || ''; s.matchName = o.meta?.matchName || ''; s.matchDate = o.meta?.matchDate || '';
  s.image = o.sourceImage?.dataUrl || null;
  s.source = o.meta?.source || (s.image ? 'jpg' : 'none');
  s.stgMeta = o.stgMeta || null;
  s.defTarget = o.defTarget || 'normal';
  s.objects = Array.isArray(o.objects) ? o.objects : [];
  s.plans = Array.isArray(o.plans) ? o.plans : [];
  s.results = Array.isArray(o.results) ? o.results : []; s.myPlanId = o.myPlanId || null; s.runs = Array.isArray(o.runs) ? o.runs : []; s.clips = Array.isArray(o.clips) ? o.clips : []; s.clipCmp = o.clipCmp || null;
  s.design = o.design || null;
  s.startCond = Object.assign(defaultStartCond(), o.startCondition || {});
  s.eye = Object.assign({stand:1.68, kneel:1.05}, o.eye || {});
  s.safety = Object.assign({downDeg:0, left:90, right:90}, o.safety || {}); s.plateCy = o.plateCy ?? 1.0; s.flex = o.flex ?? true;
  const cal = o.calibration || {};
  s.points = (cal.imagePoints || []).slice(0, 4).map(p => ({u:p.u, v:p.v}));
  if(cal.rect) Object.assign(s.rect, {width:cal.rect.width, depth:cal.rect.depth, depthScale:cal.rect.depthScale ?? 1, x0:cal.rect.x0 ?? 0, y0:cal.rect.y0 ?? 0});
  if(cal.margins) Object.assign(s.margins, cal.margins);
  if(typeof cal.lockRow === 'boolean') s.lockRow = cal.lockRow;
  if(o.venueSet && o.venueSet.name){
    const f = venueSets.find(v => v.name === o.venueSet.name);
    if(f){ activeSetId = f.id; saveSets(); renderSets(); }
    else if(confirm('這個 stage 使用的尺寸組「' + o.venueSet.name + '」不在你的清單中，要一併加入嗎？')){
      const ns = newSet(o.venueSet.name); ns.items = clone(o.venueSet.items || []); migrateSet(ns);
      venueSets.push(ns); activeSetId = ns.id; saveSets(); renderSets();
    }
  }
  stage = s; selId = null; draft = null; measurePts = [];
  afterSourceChange();
}
function afterSourceChange(){
  migrateObjects(stage.objects);
  if(typeof resetForNewStage === 'function') resetForNewStage();
  fillInputs(); setTool('select'); renderList(); renderProps(); renderStartCond(); syncDesignUI(); activePlanId = null; planCache = null; renderPlanPanel(); if(typeof renderResultsPanel === 'function') renderResultsPanel();
  if(stage.image) loadImage(stage.image, true, true);
  else { img = null; srcData = null; recompute(true); updateExtent(true); resetHistory(); }
}
function loadImage(url, persist, fit){
  const im = new Image();
  im.onload = () => {
    img = im; stage.imgW = im.naturalWidth; stage.imgH = im.naturalHeight;
    const c = document.createElement('canvas'); c.width = stage.imgW; c.height = stage.imgH;
    const cx = c.getContext('2d'); cx.drawImage(im, 0, 0);
    srcData = cx.getImageData(0, 0, stage.imgW, stage.imgH);
    syncUI();
    requestAnimationFrame(() => {
      imgView.fitRect(0, 0, stage.imgW, stage.imgH);
      topOffKey = '';
      recompute(persist);
      if(fit) updateExtent(true);
      if(stage.points.length < 4) setTool('calib');
      if(persist || !lastSnap) resetHistory();
    });
  };
  im.onerror = () => alert('無法讀取這個圖檔。');
  im.src = url;
}
