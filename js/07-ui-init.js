'use strict';
/*! Stage 模擬器 — IPSC Action Air stage 規劃、回放與檢討
 *  Copyright (C) 2026 James
 *  SPDX-License-Identifier: GPL-3.0-or-later
 *  本程式為自由軟體：你可以依自由軟體基金會發布的 GNU 通用公共授權條款第 3 版，
 *  或（由你選擇）任何更新的版本，重新散布或修改本程式。本程式不提供任何保證，
 *  亦不保證適售性或特定目的適用性。完整條款見 LICENSE 或 <https://www.gnu.org/licenses/>。
 */
/* ---------- layout: modes, results panel, shooter window ---------- */
const LS_UI = 'stageSim.ui';
let UI = (() => { try{ return JSON.parse(localStorage.getItem(LS_UI)) || {}; }catch(e){ return {}; } })();
if(UI.uiv !== 2){ UI.uiv = 2; UI.res = 'closed'; }   // 0.47 layout: results panel starts as a one-line summary
const RES_TABS = {
  build:[],
  plan:[['p-sum','摘要'],['p-tl','逐槍時間軸'],['p-mc','蒙地卡羅'],['p-sens','敏感度與標竿'],['p-cmp','計畫比較']],
  review:[['r-rep','弱項報告'],['r-align','逐槍對位與差距'],['r-vid','影片'],['r-cmp','片段比較'],['r-res','成績比對']]
};
/* one-line results summary shown while the results panel is folded */
function renderResStrip(){
  const s = $('resStrip'); if(!s) return;
  s.innerHTML = '';
  if(UI.res !== 'closed') return;
  const kv = (k, v) => { const x = el('span', {class:'kv'}); x.appendChild(el('span', {class:'k', text:k})); x.appendChild(el('b', {text:v})); s.appendChild(x); };
  const sep = () => s.appendChild(el('span', {class:'sep'}));
  if(UI.mode === 'plan'){
    const plan = typeof activePlan === 'function' ? activePlan() : null;
    if(!plan){ s.appendChild(el('span', {class:'k', text:'尚無路線計畫'})); return; }
    const R = planResult(plan);
    kv('計畫', plan.name); sep(); kv('期望 HF', fmt(R.eHF, 3)); kv('時間', fmt(R.total) + ' 秒'); kv('得分', fmt(R.ePts, 1) + '／' + R.maxPts);
    if(typeof runMonteCarlo === 'function'){
      const key = mcSig(plan, Object.assign({}, mcOpts(), {n:2000}));
      if(!renderResStrip.mc || renderResStrip.mc.sig !== key) renderResStrip.mc = runMonteCarlo(plan, {n:2000});
      sep(); kv('實戰八成', fmt(renderResStrip.mc.hf.p10, 2) + '–' + fmt(renderResStrip.mc.hf.p90, 2));
    }
    if(R.warnings.length) s.appendChild(el('button', {class:'linkbtn warnlink', text:'⚠ ' + R.warnings.length + ' 項提醒', onclick:() => { UI.tab.plan = 'p-sum'; UI.res = 'open'; renderResTabs(); saveUI(); }}));
  }else if(UI.mode === 'review'){
    const rs = typeof runs === 'function' ? runs() : [], cs = typeof clips === 'function' ? clips() : [];
    kv('實測紀錄', rs.length + ' 筆'); kv('影片片段', cs.length + ' 段');
    if(!rs.length) s.appendChild(el('span', {class:'k', text:'在左側「實測紀錄」貼上計時器時間'}));
  }
}
/* left column: one section open at a time per mode; long explanations folded behind 說明 */
function applyAccordion(m){
  const secs = [...document.querySelectorAll('aside > details[data-mode="' + m + '"]')];
  if(!secs.length) return;
  UI.openSec = UI.openSec || {};
  let want = secs.find(d => d.id === UI.openSec[m]) || (m === 'plan' && typeof plans === 'function' && plans().length ? $('secPlan') : null) || secs.find(d => d.open) || secs[0];
  applyAccordion.busy = true;
  secs.forEach(d => d.open = d === want);
  applyAccordion.busy = false;
}
function setupAside(){
  document.querySelectorAll('aside > details').forEach(d => {
    const s = d.querySelector('summary');
    if(s && !s.querySelector('.hbtn')){
      const h = el('button', {class:'hbtn', type:'button', 'aria-pressed':'false', title:'顯示或隱藏這一區的說明文字', text:'說明'});
      h.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); const on = d.classList.toggle('showhelp'); h.setAttribute('aria-pressed', String(on)); if(on && !d.open) d.open = true; });
      s.appendChild(h);
    }
    d.addEventListener('toggle', () => {
      if(applyAccordion.busy || !d.open) return;
      const m = d.dataset.mode;
      document.querySelectorAll('aside > details[data-mode="' + m + '"]').forEach(x => { if(x !== d && x.open){ applyAccordion.busy = true; x.open = false; applyAccordion.busy = false; } });
      UI.openSec = UI.openSec || {}; UI.openSec[m] = d.id; saveUI();
    });
  });
}
/* the canvas hint sits on the picture and fades after a few seconds */
/* a different stage replaced the current one: drop everything that belonged to the old one */
function resetForNewStage(){
  if(RP.on) exitReplay();
  replayPlanOverride = null; pendingOrder = null; activePlanId = null; planCache = null; planBase = null;
  stopSuggest = null; MC.res = null; MC.cmpRes = null; renderResStrip.mc = null;
  visCacheKey = ''; visCache = null; VISMEMO.clear();
  if(CMP.playing) cmpPlay(false);
  runSel = null; runImp = null;
  orbitInit = false; orbitAuto = false;
  if(UI.openSec) delete UI.openSec.plan;
  renderSuggest(); renderPlanPanel(); renderVisPanel(); renderResultsPanel(); renderRunsPanel(); renderClipsPanel(); loadClipIntoPlayer(); renderResTabs();
  if(leftTab === '3d'){ resetOrbit(true); render3d(); }
}
function flashHint(){
  const h = $('leftHint'); if(!h) return;
  h.classList.remove('faded'); clearTimeout(flashHint.t); flashHint.t = setTimeout(() => h.classList.add('faded'), 5000);
}
function saveUI(){ try{ localStorage.setItem(LS_UI, JSON.stringify(UI)); }catch(e){} }
function setMode(m){
  UI.mode = m; document.body.dataset.mode = m;
  document.querySelectorAll('header .modes button').forEach(b => { const on = b.dataset.mode === m; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
  if(m !== 'build' && !TOOL_ALWAYS.includes(tool) && tool !== 'calib') setTool('select');
  buildToolbar(); applyAccordion(m);
  renderResTabs(); saveUI(); if(typeof syncMobileNav === 'function') syncMobileNav();
  if(m === 'review'){ renderRunsPanel(); renderClipsPanel(); loadClipIntoPlayer(); }
  else { const v = $('vPlayer'); if(v && !v.paused) v.pause(); }
}
function renderResTabs(){
  const m = UI.mode, tabs = RES_TABS[m] || [], panel = $('resPanel'); if(!panel) return;
  panel.classList.toggle('hidden', !tabs.length);
  UI.tab = UI.tab || {};
  let cur = UI.tab[m]; if(!tabs.some(t => t[0] === cur)) cur = UI.tab[m] = tabs.length ? tabs[0][0] : null;
  const bar = $('resTabs'); bar.innerHTML = '';
  tabs.forEach(([k, n]) => bar.appendChild(el('button', {class:k === cur ? 'on' : '', role:'tab', 'aria-selected':String(k === cur), text:n, onclick:() => { UI.tab[m] = k; if(UI.res === 'closed') UI.res = 'open'; renderResTabs(); saveUI(); }})));
  document.querySelectorAll('#resBody>[data-rt]').forEach(d => d.classList.toggle('hidden', d.dataset.rt !== cur));
  if(cur === 'r-vid') setTimeout(() => { if(typeof drawWave === 'function'){ drawWave(); drawOverlay(); } }, 0);
  if(cur === 'r-cmp') renderCompare(); else if(CMP.playing) cmpPlay(false);
  if(cur === 'p-mc' && typeof renderMC === 'function') renderMC();
  panel.classList.toggle('closed', UI.res === 'closed'); panel.classList.toggle('big', UI.res === 'big');
  $('resToggle').textContent = UI.res === 'closed' ? '展開明細' : '收起';
  renderResStrip();
  $('resBig').textContent = UI.res === 'big' ? '縮小' : '放大';
}
function updateQuickPlan(){
  const q = $('qPlan'); if(!q) return;
  const ps = plans(); q.innerHTML = '';
  if(!ps.length){ q.appendChild(el('option', {value:'', text:'（尚無計畫）'})); q.disabled = true; return; }
  q.disabled = false; ps.forEach(p => q.appendChild(el('option', {value:p.id, text:'計畫 ' + p.name})));
  q.value = (activePlan() || ps[0]).id;
}
function updateQuickShooter(){ const b = $('qShooter'); if(!b || !SHOOTERS) return; const s = SHOOTERS.list.find(x => x.id === SHOOTERS.activeId); b.textContent = '射手：' + (s ? s.name : ''); }
function smTab(t){
  document.querySelectorAll('#smTabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  document.querySelectorAll('.modal-body [data-st]').forEach(d => d.classList.toggle('hidden', d.dataset.st !== t));
}
function openShooter(tab){ $('shooterModal').classList.remove('hidden'); smTab(tab || 'body'); $('smClose').focus(); }
function closeShooter(){ $('shooterModal').classList.add('hidden'); $('qShooter').focus(); }
function drawReloadMarks(ctx, toS){
  const plan = activePlan(); if(!plan || !plan.stops.length || !$('planShow')?.checked) return;
  const R = planResult(plan), start = startObj();
  R.reloadLog.forEach(r => {
    const st = plan.stops[r.stop]; if(!st) return;
    const pv = r.stop === 0 ? (start ? [start.x, start.y] : [st.x, st.y]) : [plan.stops[r.stop - 1].x, plan.stops[r.stop - 1].y];
    const at = r.forced || !r.moving ? [st.x, st.y] : [(pv[0] + st.x) / 2, (pv[1] + st.y) / 2];
    const q = toS(at[0], at[1]); if(!q) return;
    const txt = r.forced || !r.moving ? '換匣 ' + fmt(r.extra, 1) + 's' : r.extra > 0.005 ? '換匣 +' + fmt(r.extra, 1) + 's' : '換匣';
    ctx.save(); ctx.font = '600 12px system-ui, sans-serif';
    const w = ctx.measureText(txt).width + 10, x = q[0] + (r.forced || !r.moving ? 14 : -w / 2), y = q[1] + (r.forced || !r.moving ? 8 : -9);
    ctx.fillStyle = '#FFF4E0'; ctx.strokeStyle = '#B86B00'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.rect(x, y, w, 18); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#8A4F00'; ctx.fillText(txt, x + 5, y + 13); ctx.restore();
  });
}
function initUI(){
  document.querySelectorAll('header .modes button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $('qPlan').addEventListener('change', e => { activePlanId = e.target.value; planChanged(false); });
  $('qReplay').addEventListener('click', () => { replayPlanOverride = null; startReplay(); });
  $('qRhythm').addEventListener('click', () => { if(!RP.on) replayPlanOverride = null; rhythmDrill(); });
  $('qShooter').addEventListener('click', () => openShooter());
  $('smClose').addEventListener('click', closeShooter);
  $('shooterModal').addEventListener('click', e => { if(e.target.id === 'shooterModal') closeShooter(); });
  document.addEventListener('keydown', e => { if(e.key === 'Escape' && !$('shooterModal').classList.contains('hidden')){ e.stopPropagation(); closeShooter(); } }, true);
  document.querySelectorAll('#smTabs button').forEach(b => b.addEventListener('click', () => smTab(b.dataset.t)));
  $('resToggle').addEventListener('click', () => { UI.res = UI.res === 'closed' ? 'open' : 'closed'; renderResTabs(); saveUI(); });
  $('resBig').addEventListener('click', () => { UI.res = UI.res === 'big' ? 'open' : 'big'; renderResTabs(); saveUI(); });
  const syncWide = () => { document.body.classList.toggle('wide', !!UI.wide); $('wideBtn').textContent = UI.wide ? '顯示俯視圖' : '加寬畫面'; };
  $('wideBtn').addEventListener('click', () => { UI.wide = !UI.wide; saveUI(); syncWide(); setTimeout(() => { if(typeof resize3d === 'function') resize3d(); imgView.render(); topView.render(); }, 0); });
  syncWide();
  { const lk = $('v3dLook'); if(lk){ lk.value = t3Look(); lk.addEventListener('change', () => { UI.look3 = lk.value; saveUI(); render3d(); }); } }
  initVideo(); renderClipsPanel(); renderStgCatalogInfo(); initMobile(); initPWA();
  updateQuickShooter(); updateQuickPlan();
  setupAside();
  { const h = $('leftHint'), pane = $('imgPane'); if(h && pane){ h.classList.add('ovhint'); pane.appendChild(h); flashHint(); pane.addEventListener('pointerenter', () => flashHint()); } }
  setMode(UI.mode || (stage.objects && stage.objects.length ? 'plan' : 'build'));
}

/* ---------- mobile layout, action bar, PWA ---------- */
const MOBQ = window.matchMedia('(max-width: 900px)');
const isMobile = () => MOBQ.matches;
function toast(msg, btnText, onBtn, ms){
  const t = $('toast'); if(!t) return; t.innerHTML = ''; t.appendChild(document.createTextNode(msg));
  if(btnText) t.appendChild(el('button', {text:btnText, onclick:() => { t.classList.add('hidden'); onBtn && onBtn(); }}));
  t.classList.remove('hidden'); clearTimeout(toast.h); if(ms) toast.h = setTimeout(() => t.classList.add('hidden'), ms);
}
function setMPane(p){
  UI.mpane = p;
  document.body.dataset.mpane = p === 'left' || p === 'top' ? 'view' : p;
  if(p === 'left' || p === 'top') document.body.dataset.mview = p;
  else if(!document.body.dataset.mview) document.body.dataset.mview = 'top';
  document.querySelectorAll('#mnav button').forEach(b => { const on = b.dataset.p === p; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  if(p === 'result'){ UI.res = 'open'; renderResTabs(); }
  saveUI(); updateActBar();
}
function syncMobileNav(){
  const rb = document.querySelector('#mnav button[data-p=result]'); if(!rb) return;
  const has = (RES_TABS[UI.mode] || []).length > 0; rb.disabled = !has;
  const lb = document.querySelector('#mnav button[data-p=left]'); if(lb) lb.textContent = v3dWrapVisible() ? '3D' : '原圖';
  if(!has && UI.mpane === 'result') setMPane('top');
}
function v3dWrapVisible(){ const w = $('v3dWrap'); return w && !w.classList.contains('hidden'); }
function updateActBar(){
  const bar = $('actBar'); if(!bar) return; bar.innerHTML = '';
  const add = (t, f, cls) => bar.appendChild(el('button', {text:t, class:cls || '', onclick:f}));
  if(draft){ bar.appendChild(el('span', {text:'繪製中：' + draft.pts.length + ' 點'})); add('完成', () => finishDraft(), 'primary'); add('取消', () => { draft = null; renderViews(); }); }
  else if(pendingOrder){ bar.appendChild(el('span', {text:'依序點靶中（' + pendingOrder.list.length + '）'})); add('完成', () => finishOrderPick(), 'primary'); add('另存新計畫', () => saveAsNewPlan()); add('取消', () => { pendingOrder = null; renderPlanPanel(); renderViews(); }); }
  else if(pendingFace || pendingSlide){ bar.appendChild(el('span', {text:pendingFace ? '點一下設定面向' : '點一下設定終點'})); add('取消', () => { pendingFace = null; pendingSlide = null; setTool(tool); renderProps(); renderViews(); }); }
  else if(selId && getObj(selId)){ const o = getObj(selId); bar.appendChild(el('span', {text:'已選取 ' + (o.label || OBJ[o.type].label)})); add('刪除', () => deleteSel(), 'danger'); add('取消選取', () => { selId = null; renderProps(); renderViews(); }); if(isMobile()) add('編輯屬性', () => { setMPane('input'); const d = $('secObj'); if(d){ d.open = true; setTimeout(() => d.scrollIntoView({block:'start'}), 50); } }); }
  bar.classList.toggle('hidden', !bar.children.length);
}
function initMobile(){
  document.querySelectorAll('#mnav button').forEach(b => b.addEventListener('click', () => {
    if(b.dataset.p === 'left' && !v3dWrapVisible() && !stage.image) setLeftTab('3d');
    setMPane(b.dataset.p);
  }));
  setMPane(UI.mpane || 'top');
  const onChange = () => { document.body.classList.toggle('mobile', isMobile()); syncMobileNav(); updateActBar(); };
  MOBQ.addEventListener ? MOBQ.addEventListener('change', onChange) : MOBQ.addListener(onChange);
  onChange();
  // on phones, starting a replay jumps to the 3D view
  $('qReplay').addEventListener('click', () => { if(isMobile()){ setLeftTab('3d'); setMPane('left'); } });
  $('qRhythm').addEventListener('click', () => { if(isMobile() && RP.on){ setMPane('left'); } });
}
function initPWA(){
  // install button (Android and desktop Chrome); iPhone uses Safari's share menu instead
  let deferred = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; $('qInstall').classList.remove('hidden'); });
  $('qInstall').addEventListener('click', async () => { if(!deferred) return; deferred.prompt(); try{ await deferred.userChoice; }catch(e){} deferred = null; $('qInstall').classList.add('hidden'); });
  window.addEventListener('appinstalled', () => { $('qInstall').classList.add('hidden'); toast('已安裝。之後可從主畫面開啟。', null, null, 4000); });
  if(navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  const secure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if(!('serviceWorker' in navigator) || !secure) return;
  navigator.serviceWorker.register('sw.js').then(reg => {
    const watch = w => w && w.addEventListener('statechange', () => {
      if(w.state === 'installed' && navigator.serviceWorker.controller) toast('有新版本可以使用。', '重新載入', () => location.reload());
    });
    if(reg.installing) watch(reg.installing);
    reg.addEventListener('updatefound', () => watch(reg.installing));
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  }).catch(() => {});
}

/* ---------- init ---------- */
bind3d(); bindReplay();   // event bindings that reference functions from later files
APP_READY = true;
function initStageUI(){
  ['stageName', 'matchName', 'matchDate'].forEach(id => $(id).addEventListener('input', e => { stage[id] = e.target.value; saveStage(); }));
  $('defTarget').addEventListener('change', e => { stage.defTarget = e.target.value; saveStage(); });
  const confirmReplace = () => !stage.objects.length && !stage.image || confirm('載入新的來源會清除目前的 stage 內容（尺寸組不受影響），確定嗎？');
  $('loadImg').addEventListener('click', () => { if(confirmReplace()) $('imgFile').click(); });
  $('imgFile').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = ''; if(!f) return;
    const url = await readFile(f, false);
    const keep = {name:stage.name, matchName:stage.matchName, matchDate:stage.matchDate, defTarget:stage.defTarget};
    stage = Object.assign(newStage(), keep);
    stage.source = 'jpg'; stage.image = url; selId = null; draft = null; measurePts = [];
    resetForNewStage();
    if(!stage.name) stage.name = f.name.replace(/\.[^.]+$/, '');
    fillInputs(); renderList(); renderProps();
    $('secCal').open = true;
    loadImage(url, true, true);
  });
  $('loadStg').addEventListener('click', () => { if(confirmReplace()) $('stgFile').click(); });
  $('stgExport').addEventListener('click', () => { if(!stage.objects.length){ alert('圖上還沒有物件。'); return; } exportSTG(); });
  $('stgFile').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = ''; if(!f) return;
    try{
      const d = JSON.parse(decodeText(await f.arrayBuffer()));
      const skipped = importSTG(d);
      afterSourceChange(); renderStgCatalogInfo(); const eb = $('stgExportBox'); if(eb) eb.classList.add('hidden');
      const walls = stage.objects.filter(o => o.type === 'wall').length;
      alert('已匯入 ' + stage.objects.length + ' 個物件' + (skipped ? '（略過 ' + skipped + ' 個槍枝等非場地物件）' : '') + '。' + (walls ? '\n檔牆尺寸為估計值，請逐一確認。' : ''));
    }catch(err){ alert('匯入失敗：無法解析這個 STG 檔。'); }
  });
  $('mirrorBtn').addEventListener('click', mirrorX);
  $('fieldVer').addEventListener('click', () => {
    if(stage.design && !confirm('已有設計圖對照，要以目前內容重新建立嗎？')) return;
    if(!confirm('建議先按「匯出存檔」保存原始設計。建立現場版本後，原始位置會以灰色虛線保留在俯視圖供對照，之後依現場擺設拖曳物件即可。繼續嗎？')) return;
    stage.design = {name:stage.name, objects:clone(stage.objects), created:new Date().toISOString()};
    if(!/（現場）$/.test(stage.name)){ stage.name += '（現場）'; $('stageName').value = stage.name; }
    objectsChanged(false); syncDesignUI();
  });
  $('dropDesign').addEventListener('click', () => { if(confirm('移除設計圖對照？')){ stage.design = null; objectsChanged(false); syncDesignUI(); } });
  $('genAreas').addEventListener('click', () => {
    const n = generateAreas(); selId = null; objectsChanged(true);
    alert(n ? '已產生 ' + n + ' 個射擊區（黃色範圍）。不需要的可以選取後刪除。' : '找不到封閉範圍。請確認邊線兩端有接到檔牆或其他邊線（誤差 25 公分內）。');
  });
  $('stageExport').addEventListener('click', exportStage);
  $('stageImport').addEventListener('click', () => $('stageImportFile').click());
  $('stageImportFile').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = ''; if(!f) return;
    try{ const o = JSON.parse(await readFile(f, true)); if(o.type !== 'stage') throw new Error('bad'); importStage(o); }
    catch(err){ alert('開啟失敗：這個檔案不是模擬器存檔。Practisim 的 STG 請用「匯入 STG 檔」。'); }
  });
  $('stageClear').addEventListener('click', () => {
    if(!confirm('清除目前的 stage 內容？尺寸組不受影響。')) return;
    stage = newStage(); img = null; srcData = null; selId = null; draft = null; measurePts = [];
    afterSourceChange();
  });
  numInput('rectW', v => stage.rect.width = v);
  numInput('rectD', v => stage.rect.depth = v);
  numInput('depthScale', v => stage.rect.depthScale = v);
  numInput('x0', v => stage.rect.x0 = v);
  numInput('y0', v => stage.rect.y0 = v);
  numInput('mSide', v => stage.margins.side = Math.max(0, v));
  numInput('mFront', v => stage.margins.front = Math.max(0, v));
  numInput('mBack', v => stage.margins.back = Math.max(0, v));
  $('applyDepth').addEventListener('click', () => {
    stage.rect.depth = +effDepth().toFixed(3); stage.rect.depthScale = 1;
    $('rectD').value = stage.rect.depth; $('depthScale').value = 1; recompute(true);
  });
  $('lockRow').addEventListener('change', e => { stage.lockRow = e.target.checked; if(stage.lockRow && stage.points.length === 4) stage.points[3].v = stage.points[2].v; recompute(true); });
  $('showGrid').addEventListener('change', e => { stage.showGrid = e.target.checked; renderViews(); saveStage(); });
  $('calibTool').addEventListener('click', () => setTool(tool === 'calib' ? 'select' : 'calib'));
  $('ptUndo').addEventListener('click', () => { stage.points.pop(); setTool('calib'); recompute(true); });
  $('ptReset').addEventListener('click', () => { if(confirm('清除四個校正點？')){ stage.points = []; setTool('calib'); recompute(true); } });
  $('fitImg').addEventListener('click', () => { if(img) imgView.fitRect(0, 0, stage.imgW, stage.imgH); });
  $('fitTop').addEventListener('click', fitTop);
}

loadSets();
loadStage();
initSetUI();
buildToolbar();
renderSets();
initStageUI();
fillInputs();
renderList();
renderStartCond();
loadProfile();
renderShooterBox();
renderPostureBox();
renderVisPanel();
ensureProfileParams();
renderParamBox();
renderStartCond();   // again, now that the shooter's draw / pick-up times are loaded
renderPlanPanel();
renderResultsPanel();
syncDesignUI();
$('planShow').addEventListener('change', () => renderViews());
if(!stage.image) setLeftTab('3d');
setTool('select');
if(stage.image) loadImage(stage.image, false, true); else { recompute(false); updateExtent(true); resetHistory(); }

initUI();
// first draw now that everything is loaded
imgView.resize(); topView.resize(); if(typeof resize3d === 'function') resize3d(); renderViews();
