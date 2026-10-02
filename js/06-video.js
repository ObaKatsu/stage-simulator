'use strict';
/*! Stage 模擬器 — IPSC Action Air stage 規劃、回放與檢討
 *  Copyright (C) 2026 James
 *  SPDX-License-Identifier: GPL-3.0-or-later
 *  本程式為自由軟體：你可以依自由軟體基金會發布的 GNU 通用公共授權條款第 3 版，
 *  或（由你選擇）任何更新的版本，重新散布或修改本程式。本程式不提供任何保證，
 *  亦不保證適售性或特定目的適用性。完整條款見 LICENSE 或 <https://www.gnu.org/licenses/>。
 */
/* ---------- phase 5a: clip-based video review ---------- */
// clip metadata lives in stage.clips; the video files themselves stay on the user's disk and are re-linked by name + size
const CLIPFILES = new Map();   // clipId -> {file, url, audio:{env, rate}|null, cands:[]}
let clipSel = null, vFpsProbe = null;
const MARK_KINDS = [['beep','起始嗶聲'],['shot','槍響'],['draw','出槍開始'],['clear','槍離開槍套'],['sight','第一格瞄準'],['leave','離開位置'],['arrive','到位'],['rlStart','換匣開始'],['rlEnd','換匣完成'],['other','其他']];
const markName = k => (MARK_KINDS.find(x => x[0] === k) || [k, k])[1];
const FPS_STD = [23.976, 25, 29.97, 30, 50, 59.94, 60, 100, 120, 240];
const WB_PARAMS = [['startHolster','出槍到第一槍（槍在槍套）'],['startPickup','取槍到第一槍（槍在物件上）'],['split.0','同靶 split：5 公尺內'],['split.1','同靶 split：5 到 8 公尺'],['split.2','同靶 split：8 到 10 公尺'],['split.3','同靶 split：10 公尺以上'],['reloadStatic','定點換匣'],['reloadMove','移動中換匣'],['exitT','出位時間'],['windowOpen','開窗']];
function clips(){ if(!Array.isArray(stage.clips)) stage.clips = []; return stage.clips; }
function activeClip(){ const cs = clips(); return cs.find(c => c.id === clipSel) || cs[cs.length - 1] || null; }
function clipsChanged(){ saveStage(); renderClipsPanel(); drawOverlay(); if(UI.tab && UI.tab.review === 'r-cmp' && document.body.dataset.mode === 'review') renderCompare(); }
function clipFps(c){ return c.fps || c.fpsGuess || 30; }
function realT(c, vt){ return vt * (c.timeScale || 1); }          // video time -> real time
function clipMarks(c){ c.marks = c.marks || []; c.marks.sort((a, b) => a.t - b.t); return c.marks; }
function beepOf(c){ return clipMarks(c).find(m => m.kind === 'beep') || null; }
function vEl(){ return $('vPlayer'); }

/* --- files --- */
async function addClipFiles(files){
  const added = [];
  for(const f of files){
    let c = clips().find(x => x.fileName === f.name && x.fileSize === f.size);
    if(!c){ c = {id:uid(), name:f.name.replace(/\.[^.]+$/, ''), fileName:f.name, fileSize:f.size, fps:null, timeScale:1, marks:[], shooterId:SHOOTERS.activeId, targets:[], stop:null, runId:null, note:'', created:today()}; clips().push(c); added.push(c); }
    const old = CLIPFILES.get(c.id); if(old && old.url) URL.revokeObjectURL(old.url);
    CLIPFILES.set(c.id, {file:f, url:URL.createObjectURL(f), audio:null, cands:[]});
    clipSel = c.id;
  }
  clipsChanged(); loadClipIntoPlayer();
  if(document.body.dataset.mode === 'review'){ UI.tab.review = 'r-vid'; if(UI.res !== 'big') UI.res = 'big'; renderResTabs(); saveUI(); }
  return added;
}
function loadClipIntoPlayer(){
  const v = vEl(), c = activeClip(); if(!v) return;
  const cf = c && CLIPFILES.get(c.id);
  if(!cf){ if(v.getAttribute('src')){ v.removeAttribute('src'); v.load(); } drawWave(); return; }
  if(v.dataset.clip !== c.id){ v.dataset.clip = c.id; v.src = cf.url; v.playbackRate = +($('vSpeed').value || 1); }
  drawWave();
}

/* --- fps detection with requestVideoFrameCallback --- */
function snapFps(f){ let best = f, bd = Infinity; FPS_STD.forEach(s => { const d = Math.abs(s - f) / s; if(d < bd){ bd = d; best = s; } }); return bd < 0.07 ? best : Math.round(f * 10) / 10; }
function detectFps(){
  const v = vEl(), c = activeClip(); if(!v || !c || !CLIPFILES.get(c.id)) return;
  if(!('requestVideoFrameCallback' in HTMLVideoElement.prototype)){ alert('這個瀏覽器不支援自動偵測格率，請手動選擇。建議使用 Chrome 或 Edge。'); return; }
  const times = [], rate0 = v.playbackRate, muted0 = v.muted;
  v.muted = true; v.playbackRate = 0.25;
  const stop = () => {
    v.pause(); v.playbackRate = rate0; v.muted = muted0; vFpsProbe = null;
    const d = []; for(let i = 1; i < times.length; i++){ const x = times[i] - times[i - 1]; if(x > 0.0005) d.push(x); }
    if(d.length < 5){ alert('偵測失敗，請手動選擇格率。'); return; }
    d.sort((a, b) => a - b);
    const base = d[Math.floor(d.length * 0.1)], cl = d.filter(x => x <= base * 1.5);   // consecutive-frame gaps only (skip dropped frames)
    c.fpsGuess = snapFps(cl.length / cl.reduce((a, x) => a + x, 0));
    if(!c.fps) c.fps = c.fpsGuess;
    clipsChanged();
  };
  const cb = (now, md) => { times.push(md.mediaTime); if(vFpsProbe && times.length < 60) v.requestVideoFrameCallback(cb); else if(vFpsProbe) stop(); };
  vFpsProbe = true; v.requestVideoFrameCallback(cb); v.play().catch(() => {});
  setTimeout(() => { if(vFpsProbe) stop(); }, 4000);
}

/* --- audio envelope + shot candidates --- */
async function analyzeAudio(){
  const c = activeClip(), cf = c && CLIPFILES.get(c.id); if(!cf) return;
  if(cf.file.size > 600 * 1024 * 1024 && !confirm('檔案很大（' + Math.round(cf.file.size / 1048576) + ' MB），解析聲音可能很慢或記憶體不足。要繼續嗎？')) return;
  $('vAudioMsg').textContent = '解析聲音中…';
  try{
    const buf = await cf.file.arrayBuffer();
    const AC = window.AudioContext || window.webkitAudioContext, ac = new AC();
    const ab = await ac.decodeAudioData(buf); ac.close && ac.close();
    const ch = ab.getChannelData(0), sr = ab.sampleRate, win = Math.max(1, Math.round(sr * 0.002));
    const n = Math.floor(ch.length / win), env = new Float32Array(n);
    let prev = 0;
    for(let i = 0; i < n; i++){
      let m = 0; for(let j = i * win, e = j + win; j < e; j++){ const x = ch[j] - prev; prev = ch[j]; const a = x < 0 ? -x : x; if(a > m) m = a; }   // first difference = crude high-pass, emphasises sharp reports
      env[i] = m;
    }
    cf.audio = {env, rate:1 / 0.002};
    cf.cands = findOnsets(env, 1 / 0.002);
    $('vAudioMsg').textContent = '找到 ' + cf.cands.length + ' 個可能的槍聲（虛線）。GBB 槍聲小，請逐一確認。';
  }catch(e){ $('vAudioMsg').textContent = '無法解析這個檔案的聲音（可能沒有音軌或格式不支援）。'; }
  drawWave(); renderClipMarks();
}
function findOnsets(env, rate){
  const s = Array.from(env).sort((a, b) => a - b), med = s[Math.floor(s.length / 2)];
  const mad = s.map(x => Math.abs(x - med)).sort((a, b) => a - b)[Math.floor(s.length / 2)] || 1e-4;
  const thr = Math.max(med + 8 * mad, s[Math.floor(s.length * 0.995)] * 0.6);
  const out = [], gap = Math.round(0.07 * rate), look = Math.round(0.03 * rate);
  for(let i = look; i < env.length; i++){
    if(env[i] < thr) continue;
    let before = 0; for(let j = i - look; j < i; j++) if(env[j] > before) before = env[j];
    if(env[i] > before * 2.5 && (!out.length || i - out[out.length - 1] > gap)) out.push(i);
  }
  return out.map(i => i / rate);
}

/* --- waveform & timeline strip --- */
function drawWave(){
  const cv = $('vWave'); if(!cv) return;
  const w = cv.clientWidth || 600, h = 64, dpr = window.devicePixelRatio || 1;
  cv.width = w * dpr; cv.height = h * dpr; const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#F3F1EC'; g.fillRect(0, 0, w, h);
  const v = vEl(), c = activeClip(), cf = c && CLIPFILES.get(c.id);
  const dur = v && isFinite(v.duration) ? v.duration : 0; if(!dur || !c) return;
  const X = t => t / dur * w;
  if(cf && cf.audio){
    const env = cf.audio.env, per = env.length / w; let mx = 0; for(let i = 0; i < env.length; i++) if(env[i] > mx) mx = env[i];
    g.fillStyle = '#9AA5B1';
    for(let x = 0; x < w; x++){ let m = 0; for(let i = Math.floor(x * per), e = Math.floor((x + 1) * per); i < e; i++) if(env[i] > m) m = env[i]; const hh = mx ? m / mx * (h - 8) : 0; g.fillRect(x, h - 4 - hh, 1, hh); }
    g.strokeStyle = '#1F6E8C'; g.setLineDash([3, 3]);
    cf.cands.forEach(t => { g.beginPath(); g.moveTo(X(t) + .5, 0); g.lineTo(X(t) + .5, h); g.stroke(); });
    g.setLineDash([]);
  }else{ g.fillStyle = '#8A94A0'; g.font = '12px system-ui'; g.fillText('按「解析聲音」可在這裡顯示聲音波形與槍聲候選', 8, 36); }
  clipMarks(c).forEach(m => { g.fillStyle = m.kind === 'beep' ? '#C8372D' : m.kind === 'shot' ? '#1F6E8C' : '#B86B00'; g.fillRect(X(m.t) - 1, 0, 2, h); });
  if(v){ g.fillStyle = '#111'; g.fillRect(X(v.currentTime) - 0.5, 0, 1.5, h); }
}

/* --- marks --- */
function addMark(kind){
  const v = vEl(), c = activeClip(); if(!v || !c || !CLIPFILES.get(c.id)) return;
  const t = Math.round(v.currentTime * 10000) / 10000;
  if(kind === 'beep'){ c.marks = clipMarks(c).filter(m => m.kind !== 'beep'); }
  if(kind === 'other'){ const lab = $('vMarkKind') ? $('vMarkKind').value : 'other'; kind = lab; }
  clipMarks(c).push({id:uid(), t, kind}); clipsChanged();
}
function stepFrames(n){ const v = vEl(), c = activeClip(); if(!v || !c) return; v.pause(); v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + n / clipFps(c))); }
function fmtVT(c, vt){ const fr = Math.round(vt * clipFps(c)); return fmt(vt, 3) + ' 秒（第 ' + fr + ' 格）'; }
function renderClipMarks(){
  const box = $('vMarks'), c = activeClip(); if(!box) return; box.innerHTML = '';
  const v = vEl(); if(!c){ return; }
  const ms = clipMarks(c), b = beepOf(c), cf = CLIPFILES.get(c.id);
  if(cf && cf.cands && cf.cands.length){
    const unused = cf.cands.filter(t => !ms.some(m => Math.abs(m.t - t) < 0.03));
    if(unused.length) box.appendChild(el('div', {class:'btns'},
      el('button', {text:'把 ' + unused.length + ' 個候選槍聲全部加為「槍響」', onclick:() => { unused.forEach(t => clipMarks(c).push({id:uid(), t:Math.round(t * 10000) / 10000, kind:'shot'})); clipsChanged(); }}),
      el('button', {text:'清除候選', onclick:() => { cf.cands = []; drawWave(); renderClipMarks(); }})));
  }
  if(!ms.length){ box.appendChild(el('p', {class:'help', text:'尚無標記。播放或逐格找到關鍵格後，按下方按鈕或快速鍵加入標記。'})); renderAngleList(box, c); return; }
  const ul = el('ul', {class:'vislist'});
  let prev = null, shotN = 0;
  ms.forEach(m => {
    if(m.kind === 'shot') shotN++;
    const rel = b ? realT(c, m.t - b.t) : null, dp = prev ? realT(c, m.t - prev.t) : null;
    const tag = el('span', {class:'st ' + (m.kind === 'beep' ? 'unsafe' : m.kind === 'shot' ? 'full' : 'part'), text:m.kind === 'shot' ? '槍 ' + shotN : markName(m.kind)});
    const info = el('span', {class:'dt', text:fmtVT(c, m.t) + (rel != null && m.kind !== 'beep' ? '；距嗶聲 ' + fmt(rel) + ' 秒' : '') + (dp != null ? '；距上一個 ' + fmt(dp) + ' 秒' : '')});
    const k = el('select', {'aria-label':'標記種類'}); k.style.width = 'auto';
    MARK_KINDS.forEach(([a, n]) => k.appendChild(el('option', {value:a, text:n}))); k.value = m.kind;
    k.addEventListener('change', () => { if(k.value === 'beep') c.marks = clipMarks(c).filter(x => x === m || x.kind !== 'beep'); m.kind = k.value; clipsChanged(); });
    ul.appendChild(el('li', null, tag, info,
      el('button', {text:'跳到', onclick:() => { v.pause(); v.currentTime = m.t; }}),
      el('button', {text:'−1 格', title:'往前 1 格', onclick:() => { m.t = Math.max(0, m.t - 1 / clipFps(c)); v.currentTime = m.t; clipsChanged(); }}),
      el('button', {text:'+1 格', title:'往後 1 格', onclick:() => { m.t = m.t + 1 / clipFps(c); v.currentTime = m.t; clipsChanged(); }}),
      k, el('button', {class:'danger', text:'×', title:'刪除標記', onclick:() => { c.marks = ms.filter(x => x !== m); clipsChanged(); }})));
    prev = m;
  });
  box.appendChild(ul);
  renderAngleList(box, c);
  // segment measurement + write back
  const opts = ms.map((m, i) => [String(i), '#' + (i + 1) + ' ' + markName(m.kind) + ' ' + fmt(m.t, 3)]);
  c.seg = c.seg || {a:0, b:Math.min(1, ms.length - 1)};
  if(c.seg.a >= ms.length) c.seg.a = 0; if(c.seg.b >= ms.length) c.seg.b = ms.length - 1;
  if(c.seg.a === c.seg.b && ms.length > 1) c.seg.b = c.seg.a + 1 < ms.length ? c.seg.a + 1 : c.seg.a - 1;
  const segBox = el('div', {class:'port'});
  segBox.appendChild(el('div', {class:'kind', text:'量測一段時間'}));
  segBox.appendChild(row(selField('從', opts, String(c.seg.a), v2 => { c.seg.a = +v2; clipsChanged(); }), selField('到', opts, String(c.seg.b), v2 => { c.seg.b = +v2; clipsChanged(); })));
  const dur = realT(c, ms[c.seg.b].t - ms[c.seg.a].t);
  segBox.appendChild(el('div', {class:'readout', text:'這段時間：' + fmt(dur, 3) + ' 秒（精度約 ±' + fmt(realT(c, 1 / clipFps(c)) * 1000, 0) + ' 毫秒，一格）'}));
  const wp = el('select', {'aria-label':'寫入哪一項參數'}); WB_PARAMS.forEach(([k2, n]) => wp.appendChild(el('option', {value:k2, text:n})));
  segBox.appendChild(el('div', {class:'btns'}, wp, el('button', {text:'寫入射手參數', onclick:() => {
    const sid = c.shooterId || SHOOTERS.activeId;
    if(sid !== SHOOTERS.activeId){ alert('這段影片的射手是「' + shooterName(sid) + '」，請先按頂端的「射手」切換到該射手再寫入。'); return; }
    if(!(dur > 0.02 && dur < 10)){ alert('這段時間不合理（' + fmt(dur, 3) + ' 秒），請確認起訖標記。'); return; }
    if(!confirm('把「' + WB_PARAMS.find(x => x[0] === wp.value)[1] + '」設為 ' + fmt(dur) + ' 秒（' + divInfo(PROFILE.division).name + ' 組別）？')) return;
    setPath(PROFILE.time, wp.value, Math.round(dur * 100) / 100); PROFILE.measured['t.' + wp.value] = today(); saveProfile(); renderParamBox(); planChanged();
    alert('已寫入。');
  }})));
  box.appendChild(segBox);
  // create or update a measured run from shot marks
  const shots = ms.filter(m => m.kind === 'shot');
  const rb = el('div', {class:'port'});
  rb.appendChild(el('div', {class:'kind', text:'轉成實測紀錄'}));
  if(!b || !shots.length){ rb.appendChild(el('p', {class:'help', text:'需要一個「起始嗶聲」標記和至少一個「槍響」標記，才能轉成逐槍時間。'})); }
  else{
    const times = shots.map(m => Math.round(realT(c, m.t - b.t) * 1000) / 1000).filter(x => x > 0);
    rb.appendChild(el('div', {class:'readout', text:times.length + ' 槍，總時間 ' + fmt(times[times.length - 1] || 0) + ' 秒'}));
    const linked = runs().find(r => r.id === c.runId);
    rb.appendChild(el('div', {class:'btns'}, el('button', {class:'primary', text:linked ? '更新實測紀錄「' + (linked.name || '') + '」' : '建立實測紀錄', onclick:() => {
      if(linked){ linked.times = times; linked.map = []; linked.mapN = -1; runSel = linked.id; }
      else{
        const planId = (c.stop && c.stop.planId) || stage.myPlanId || (activePlan() ? activePlan().id : null);
        const run = {id:uid(), name:c.name, date:c.created || today(), planId, source:'video', div:PROFILE.division, shooterId:c.shooterId || SHOOTERS.activeId, times, map:[], score:{A:0, C:0, D:0, M:0, NS:0, PE:0}, note:'由影片「' + c.name + '」建立'};
        runs().push(run); c.runId = run.id; runSel = run.id;
      }
      saveStage(); renderRunsPanel(); clipsChanged();
      UI.tab.review = 'r-align'; renderResTabs(); saveUI();
    }})));
  }
  box.appendChild(rb);
}

/* --- sidebar: clip library & links --- */
function renderClipsPanel(){
  const box = $('clipBox'); if(!box) return; box.innerHTML = '';
  const cs = clips(), stc = $('stClips'); if(stc) stc.textContent = cs.length ? cs.length + ' 段' : '';
  box.appendChild(el('p', {class:'help', text:'拍特定靶位、轉折點或出槍的短片段即可，不必拍整個 stage。影片檔留在你的電腦裡，這裡只存標記；下次開啟請再選一次同一個檔案，會依檔名與大小自動對回。'}));
  const f = el('input', {type:'file', accept:'video/*', multiple:'', style:'display:none'});
  f.addEventListener('change', () => { const fl = Array.from(f.files); f.value = ''; if(fl.length) addClipFiles(fl); });
  box.appendChild(el('div', {class:'btns'}, el('button', {class:'primary', text:'加入或重新連結影片（可多選）', onclick:() => f.click()}), f));
  if(!cs.length) return;
  const c = activeClip(); clipSel = c.id;
  const sel = el('select', {'aria-label':'選擇影片片段'});
  cs.forEach(x => sel.appendChild(el('option', {value:x.id, text:(CLIPFILES.has(x.id) ? '' : '（未連結）') + shooterName(x.shooterId || SHOOTERS.activeId) + '：' + x.name})));
  sel.value = c.id; sel.addEventListener('change', () => { clipSel = sel.value; renderClipsPanel(); loadClipIntoPlayer(); });
  box.appendChild(sel);
  if(!CLIPFILES.has(c.id)) box.appendChild(warn('尚未連結影片檔「' + c.fileName + '」。請按上方按鈕再選一次這個檔案。'));
  const nm = el('input', {type:'text'}); nm.value = c.name || ''; nm.addEventListener('change', () => { c.name = nm.value; clipsChanged(); });
  box.appendChild(el('div', null, el('label', {class:'f', text:'名稱'}), nm));
  box.appendChild(row(selField('射手', SHOOTERS.list.map(x => [x.id, x.name]), c.shooterId || SHOOTERS.activeId, v => { c.shooterId = v; clipsChanged(); }),
    selField('實測紀錄', [['', '（無）']].concat(runs().map(r => [r.id, shooterName(runShooter(r)) + '：' + (r.name || '')])), c.runId || '', v => { c.runId = v || null; clipsChanged(); })));
  const ps = plans();
  const sp = c.stop || {};
  const planOpts = [['', '（無）']].concat(ps.map(p => [p.id, '計畫 ' + p.name]));
  const pl = ps.find(p => p.id === sp.planId);
  const stopOpts = pl ? pl.stops.map((s, i) => [String(i), 'S' + (i + 1)]) : [['', '（先選計畫）']];
  box.appendChild(row(selField('停頓點或轉折：計畫', planOpts, sp.planId || '', v => { c.stop = v ? {planId:v, idx:0} : null; clipsChanged(); }),
    selField('停頓點', stopOpts, pl ? String(sp.idx || 0) : '', v => { if(c.stop){ c.stop.idx = +v; clipsChanged(); } })));
  const tg = el('div', {class:'btns'});
  engageable().forEach(o => { const on = (c.targets || []).includes(o.id); tg.appendChild(el('button', {class:on ? 'on' : '', text:o.label, 'aria-pressed':String(on), onclick:() => { c.targets = on ? c.targets.filter(x => x !== o.id) : (c.targets || []).concat(o.id); clipsChanged(); }})); });
  box.appendChild(el('label', {class:'f', text:'相關靶位（可多選）'})); box.appendChild(tg);
  box.appendChild(row(
    selField('格率', [['', '自動（' + (c.fpsGuess ? c.fpsGuess : '未偵測，暫用 30') + '）']].concat(FPS_STD.map(x => [String(x), x + ' 格／秒'])), c.fps && c.fps !== c.fpsGuess ? String(c.fps) : '', v => { c.fps = v ? +v : c.fpsGuess || null; clipsChanged(); }),
    selField('影片時間與真實時間', [['1','相同（一般錄影）'],['0.5','2 倍慢動作已放慢'],['0.25','4 倍慢動作已放慢'],['0.125','8 倍慢動作已放慢']], String(c.timeScale || 1), v => { c.timeScale = +v; clipsChanged(); })));
  box.appendChild(el('p', {class:'help', text:'手機慢動作影片分享或匯出後，常會變成「已放慢」的一般影片（例如 240 格錄、30 格播，時間拉長 8 倍），這時請選對應的倍數，量到的時間才會是真實時間。'}));
  const note = el('textarea', {rows:'2', placeholder:'備註'}); note.value = c.note || ''; note.addEventListener('change', () => { c.note = note.value; clipsChanged(); });
  box.appendChild(note);
  box.appendChild(el('div', {class:'btns'},
    el('button', {text:'到結果面板看影片', onclick:() => { UI.tab.review = 'r-vid'; UI.res = 'big'; renderResTabs(); saveUI(); }}),
    el('button', {class:'danger', text:'刪除片段標記', onclick:() => { if(confirm('刪除片段「' + c.name + '」的所有標記？影片檔本身不受影響。')){ const cf = CLIPFILES.get(c.id); if(cf && cf.url) URL.revokeObjectURL(cf.url); CLIPFILES.delete(c.id); stage.clips = cs.filter(x => x !== c); clipSel = null; clipsChanged(); loadClipIntoPlayer(); } }})));
  renderClipMarks(); updateVInfo();
}
function updateVInfo(){
  const v = vEl(), c = activeClip(), inf = $('vInfo'); if(!inf) return;
  if(!c || !CLIPFILES.get(c.id)){ inf.textContent = c ? '尚未連結影片檔「' + c.fileName + '」' : '尚無影片。在左側「影片片段」加入影片。'; return; }
  const b = beepOf(c);
  inf.textContent = fmtVT(c, v.currentTime || 0) + (b ? '；距嗶聲 ' + fmt(realT(c, (v.currentTime || 0) - b.t), 3) + ' 秒' : '') + '；格率 ' + clipFps(c) + (c.timeScale && c.timeScale !== 1 ? '；時間 ×' + c.timeScale : '');
}
function initVideo(){
  const box = $('rvVideo'); if(!box) return;
  box.innerHTML = '';
  const v = el('video', {id:'vPlayer', playsinline:'', preload:'auto'}); v.style.cssText = 'max-width:100%;max-height:40vh;background:#111;display:block;border-radius:6px';
  const ov = el('canvas', {id:'vOverlay', 'aria-label':'角度量測圖層'}); ov.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none';
  ov.addEventListener('click', overlayClick);
  const vwrap = el('div', {style:'position:relative;display:inline-block;max-width:100%'}, v, ov);
  v.addEventListener('timeupdate', () => { updateVInfo(); drawWave(); drawOverlay(); });
  v.addEventListener('seeked', () => { updateVInfo(); drawWave(); drawOverlay(); });
  v.addEventListener('loadedmetadata', () => { updateVInfo(); drawWave(); const c = activeClip(); if(c && !c.fpsGuess) setTimeout(detectFps, 200); });
  let raf = null; const tick = () => { if(!v.paused){ updateVInfo(); drawWave(); raf = requestAnimationFrame(tick); } };
  v.addEventListener('play', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); });
  const wave = el('canvas', {id:'vWave', 'aria-label':'聲音波形與標記，點擊可跳到該時間'}); wave.style.cssText = 'width:100%;height:64px;display:block;margin-top:6px;cursor:pointer;border-radius:4px';
  bindWave(wave, v);
  const speed = el('select', {id:'vSpeed', 'aria-label':'播放速度'}); speed.style.width = 'auto';
  [['1','1 倍速'],['0.5','0.5 倍速'],['0.25','0.25 倍速'],['0.1','0.1 倍速']].forEach(([a, n]) => speed.appendChild(el('option', {value:a, text:n})));
  speed.addEventListener('change', () => { v.playbackRate = +speed.value; });
  const mk = el('select', {id:'vMarkKind', 'aria-label':'自訂標記種類'}); mk.style.width = 'auto';
  MARK_KINDS.filter(x => x[0] !== 'beep' && x[0] !== 'shot').forEach(([a, n]) => mk.appendChild(el('option', {value:a, text:n})));
  box.appendChild(el('div', {style:'display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start'},
    el('div', {style:'flex:1 1 480px;min-width:0'}, vwrap, wave,
      el('div', {class:'readout', id:'vInfo'}),
      el('div', {class:'btns'},
        el('button', {text:'−10 格', onclick:() => stepFrames(-10)}), el('button', {text:'−1 格', onclick:() => stepFrames(-1)}),
        el('button', {class:'primary', text:'播放／暫停', onclick:() => { v.paused ? v.play() : v.pause(); }}),
        el('button', {text:'+1 格', onclick:() => stepFrames(1)}), el('button', {text:'+10 格', onclick:() => stepFrames(10)}), speed),
      el('div', {class:'btns'},
        el('button', {text:'標記起始嗶聲（B）', onclick:() => addMark('beep')}),
        el('button', {class:'primary', text:'標記槍響（S）', onclick:() => addMark('shot')}),
        mk, el('button', {text:'加入這個標記（M）', onclick:() => addMark('other')})),
      el('div', {class:'btns'},
        el('button', {text:'解析聲音、找槍聲候選', onclick:analyzeAudio}),
        el('button', {text:'重新偵測格率', onclick:detectFps})),
      el('div', {class:'btns'},
        el('button', {text:'量角度（三點）', onclick:() => startAngle('3pt')}),
        el('button', {text:'量與水平線的夾角（兩點）', onclick:() => startAngle('2pt')})),
      el('div', {class:'help', id:'vAngleMsg'}),
      el('div', {class:'help', id:'vAudioMsg'}),
      el('p', {class:'help', text:'快速鍵：空白鍵播放／暫停，← → 逐格，Shift 加 ← → 一次 10 格，B 起始嗶聲，S 槍響，M 自訂標記。波形列：點虛線可單獨把那個候選加為槍響，拖曳彩色直線可移動標記，點其他位置跳到該時間。記錄一整段的每一槍：用 0.25 或 0.5 倍速播放，每聽到或看到一槍就按 S，最後再逐格微調。以聲音為準時，相機每離射手 1 公尺，聲音約晚 3 毫秒。'})),
    el('div', {style:'flex:1 1 360px;min-width:0', id:'vMarks'})));
  document.addEventListener('keydown', e => {
    if(document.body.dataset.mode !== 'review' || UI.tab.review !== 'r-vid' || UI.res === 'closed') return;
    const tag = (e.target.tagName || '').toLowerCase(); if(tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if(!$('shooterModal').classList.contains('hidden')) return;
    const c = activeClip(); if(!c || !CLIPFILES.get(c.id)) return;
    let done = true;
    if(e.key === 'Escape' && angleMode){ angleMode = null; $('vAngleMsg').textContent = ''; drawOverlay(); }
    else if(e.key === ' '){ v.paused ? v.play() : v.pause(); }
    else if(e.key === 'ArrowLeft') stepFrames(e.shiftKey ? -10 : -1);
    else if(e.key === 'ArrowRight') stepFrames(e.shiftKey ? 10 : 1);
    else if(e.key === 's' || e.key === 'S') addMark('shot');
    else if(e.key === 'b' || e.key === 'B') addMark('beep');
    else if(e.key === 'm' || e.key === 'M') addMark('other');
    else done = false;
    if(done){ e.preventDefault(); e.stopPropagation(); }
  }, true);
  new ResizeObserver(() => { drawWave(); drawOverlay(); }).observe(wave);
}

/* ---------- phase 5b: angles, waveform editing, multi-clip compare ---------- */
let angleMode = null;   // {type:'3pt'|'2pt', pts:[]}
function drawOverlay(){
  const v = vEl(), ov = $('vOverlay'), c = activeClip(); if(!v || !ov) return;
  const w = v.clientWidth, h = v.clientHeight, dpr = window.devicePixelRatio || 1;
  ov.style.width = w + 'px'; ov.style.height = h + 'px'; ov.width = w * dpr; ov.height = h * dpr;
  const g = ov.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  ov.style.pointerEvents = angleMode ? 'auto' : 'none'; ov.style.cursor = angleMode ? 'crosshair' : 'default';
  if(!c) return;
  const P = p => [p[0] * w, p[1] * h];
  const drawSet = (pts, col, txt) => {
    g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 2;
    if(pts.length >= 2){ g.beginPath(); const a = P(pts[0]); g.moveTo(a[0], a[1]); pts.slice(1).forEach(p => { const q = P(p); g.lineTo(q[0], q[1]); }); g.stroke(); }
    pts.forEach(p => { const q = P(p); g.beginPath(); g.arc(q[0], q[1], 4, 0, Math.PI * 2); g.fill(); });
    if(txt){ const q = P(pts.length === 3 ? pts[1] : pts[0]); g.font = '600 14px system-ui'; const tw = g.measureText(txt).width; g.fillStyle = 'rgba(0,0,0,.65)'; g.fillRect(q[0] + 8, q[1] - 22, tw + 10, 20); g.fillStyle = '#fff'; g.fillText(txt, q[0] + 13, q[1] - 7); }
  };
  (c.angles || []).filter(a => Math.abs(a.t - v.currentTime) <= 0.6 / clipFps(c)).forEach(a => drawSet(a.pts, '#FFD23F', fmt(a.deg, 1) + '°'));
  if(angleMode) drawSet(angleMode.pts, '#4FD1C5', '');
}
function angleOf(type, p){
  const w = vEl().videoWidth || 16, h = vEl().videoHeight || 9;   // measure in video pixels so the aspect ratio is right
  const q = p.map(x => [x[0] * w, x[1] * h]);
  if(type === '2pt'){ const a = Math.atan2(-(q[1][1] - q[0][1]), q[1][0] - q[0][0]) * 180 / Math.PI; return Math.abs(a) > 90 ? 180 - Math.abs(a) : Math.abs(a); }
  const v1 = [q[0][0] - q[1][0], q[0][1] - q[1][1]], v2 = [q[2][0] - q[1][0], q[2][1] - q[1][1]];
  const cs = (v1[0] * v2[0] + v1[1] * v2[1]) / ((Math.hypot(...v1) * Math.hypot(...v2)) || 1);
  return Math.acos(Math.max(-1, Math.min(1, cs))) * 180 / Math.PI;
}
function startAngle(type){
  const v = vEl(), c = activeClip(); if(!c || !CLIPFILES.get(c.id)) return;
  v.pause(); angleMode = {type, pts:[]}; drawOverlay();
  $('vAngleMsg').textContent = type === '3pt' ? '在畫面上依序點三點：第一個端點、頂點、第二個端點。按 Esc 取消。' : '在畫面上點兩點，量這條線與水平線的夾角。按 Esc 取消。';
}
function overlayClick(e){
  if(!angleMode) return;
  const ov = $('vOverlay'), r = ov.getBoundingClientRect(), c = activeClip();
  angleMode.pts.push([(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]);
  const need = angleMode.type === '3pt' ? 3 : 2;
  if(angleMode.pts.length >= need){
    c.angles = c.angles || [];
    c.angles.push({id:uid(), t:Math.round(vEl().currentTime * 10000) / 10000, type:angleMode.type, pts:angleMode.pts.map(p => [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4]), deg:Math.round(angleOf(angleMode.type, angleMode.pts) * 10) / 10});
    angleMode = null; $('vAngleMsg').textContent = ''; clipsChanged();
  }
  drawOverlay();
}
function renderAngleList(box, c){
  const as = (c.angles || []).slice().sort((a, b) => a.t - b.t); if(!as.length) return;
  box.appendChild(el('div', {class:'kind', text:'角度量測'}));
  const ul = el('ul', {class:'summ'}), b = beepOf(c);
  as.forEach(a => {
    const lab = el('input', {type:'text', placeholder:'說明，例如 45° 換靶的髖部轉角', 'aria-label':'角度說明'}); lab.value = a.label || ''; lab.style.width = '220px';
    lab.addEventListener('change', () => { a.label = lab.value; clipsChanged(); });
    ul.appendChild(el('li', null, el('b', {text:fmt(a.deg, 1) + '°'}), document.createTextNode('　' + (a.type === '2pt' ? '與水平線' : '三點夾角') + '，' + fmt(a.t, 3) + ' 秒' + (b ? '（距嗶聲 ' + fmt(realT(c, a.t - b.t)) + ' 秒）' : '') + '　'), lab,
      el('button', {text:'跳到', onclick:() => { const v = vEl(); v.pause(); v.currentTime = a.t; }}),
      el('button', {class:'danger', text:'×', onclick:() => { c.angles = c.angles.filter(x => x !== a); clipsChanged(); drawOverlay(); }})));
  });
  box.appendChild(ul);
  box.appendChild(el('p', {class:'help', text:'畫面上的角度是投影角度。相機要盡量正對量測的平面（例如從正上方或正側面拍），否則會有誤差。'}));
}
// waveform: click candidate to add it, drag a mark to move it, click elsewhere to seek
function bindWave(wave, v){
  let drag = null;
  const pos = e => { const r = wave.getBoundingClientRect(); return {x:e.clientX - r.left, w:r.width}; };
  const near = (x, w) => {
    const c = activeClip(); if(!c || !v.duration) return {};
    const X = t => t / v.duration * w;
    const m = clipMarks(c).find(m => Math.abs(X(m.t) - x) <= 5);
    const cf = CLIPFILES.get(c.id);
    const cand = !m && cf && cf.cands ? cf.cands.find(t => Math.abs(X(t) - x) <= 5 && !clipMarks(c).some(mm => Math.abs(mm.t - t) < 0.03)) : null;
    return {c, m, cand};
  };
  wave.addEventListener('pointerdown', e => {
    const {x, w} = pos(e), n = near(x, w); if(!n.c || !v.duration) return;
    if(n.m){ drag = {m:n.m, moved:false}; wave.setPointerCapture(e.pointerId); v.pause(); return; }
    if(n.cand != null){ clipMarks(n.c).push({id:uid(), t:Math.round(n.cand * 10000) / 10000, kind:'shot'}); v.pause(); v.currentTime = n.cand; clipsChanged(); return; }
    v.currentTime = Math.max(0, Math.min(v.duration, x / w * v.duration));
  });
  wave.addEventListener('pointermove', e => {
    const {x, w} = pos(e);
    if(drag){ drag.m.t = Math.max(0, Math.min(v.duration, x / w * v.duration)); drag.moved = true; v.currentTime = drag.m.t; drawWave(); return; }
    const n = near(x, w); wave.style.cursor = n.m ? 'ew-resize' : n.cand != null ? 'copy' : 'pointer';
    wave.title = n.m ? '拖曳可移動這個標記' : n.cand != null ? '點一下，把這個候選加為槍響' : '點擊跳到這個時間';
  });
  const end = () => { if(drag){ const c = activeClip(); if(drag.moved){ drag.m.t = Math.round(drag.m.t * 10000) / 10000; clipsChanged(); } drag = null; } };
  wave.addEventListener('pointerup', end); wave.addEventListener('pointercancel', end);
}

/* --- side-by-side comparison of 2–3 clips --- */
const SYNC_KEYS = [['beep','起始嗶聲'],['draw','出槍開始'],['clear','槍離開槍套'],['sight','第一格瞄準'],['shot1','第一槍'],['leave','離開位置'],['arrive','到位'],['rlStart','換匣開始']];
const CMP = {off:0, playing:false, raf:0, last:0, speed:0.25, vids:[]};
function cmpState(){ if(!stage.clipCmp) stage.clipCmp = {ids:[], sync:'beep'}; stage.clipCmp.ids = stage.clipCmp.ids.filter(id => clips().some(c => c.id === id)); return stage.clipCmp; }
function syncT(c, key){ const ms = clipMarks(c); const m = key === 'shot1' ? ms.find(x => x.kind === 'shot') : ms.find(x => x.kind === key); return m ? m.t : null; }
function markKeys(c, s){
  const out = [], cnt = {}; let shot = 0;
  clipMarks(c).forEach(m => {
    let k; if(m.kind === 'shot'){ shot++; k = '槍 ' + shot; } else { cnt[m.kind] = (cnt[m.kind] || 0) + 1; k = markName(m.kind) + (cnt[m.kind] > 1 ? ' ' + cnt[m.kind] : ''); }
    out.push({k, rt:realT(c, m.t - s), t:m.t});
  });
  return out;
}
function cmpRange(){
  let lo = 0, hi = 0;
  CMP.vids.forEach(x => { const sc = x.c.timeScale || 1, d = x.v.duration || 0; lo = Math.min(lo, -x.s * sc); hi = Math.max(hi, (d - x.s) * sc); });
  return [lo, hi];
}
function cmpApply(exact){
  CMP.vids.forEach(x => {
    const sc = x.c.timeScale || 1, vt = x.s + CMP.off / sc, d = x.v.duration || 0;
    const inR = vt >= 0 && vt <= d;
    x.lab.textContent = shooterName(x.c.shooterId || SHOOTERS.activeId) + '：' + x.c.name + (inR ? '' : vt < 0 ? '（尚未開始）' : '（已結束）');
    if(CMP.playing){
      if(!inR){ if(!x.v.paused) x.v.pause(); const tgt = Math.max(0, Math.min(d, vt)); if(Math.abs(x.v.currentTime - tgt) > 0.05) x.v.currentTime = tgt; return; }
      if(x.v.paused){ x.v.currentTime = vt; x.v.play().catch(() => {}); return; }
      if(Math.abs(x.v.currentTime - vt) > 2 / clipFps(x.c)) x.v.currentTime = vt;   // drift correction
    }else if(exact || Math.abs(x.v.currentTime - vt) > 0.5 / clipFps(x.c)) x.v.currentTime = Math.max(0, Math.min(d, vt));
  });
  const sl = $('cmpSlider'); if(sl){ const [lo, hi] = cmpRange(); sl.min = lo; sl.max = hi; sl.value = CMP.off; }
  const tv = $('cmpTime'); if(tv) tv.textContent = '距同步點 ' + (CMP.off >= 0 ? '+' : '−') + fmt(Math.abs(CMP.off), 3) + ' 秒（真實時間）';
}
function cmpPlay(on){
  CMP.playing = on;
  CMP.vids.forEach(x => { x.v.playbackRate = Math.max(0.0625, Math.min(16, CMP.speed / (x.c.timeScale || 1))); if(!on) x.v.pause(); });
  cancelAnimationFrame(CMP.raf);
  if(on){
    CMP.last = performance.now();
    const loop = now => {
      if(!CMP.playing) return;
      CMP.off += (now - CMP.last) / 1000 * CMP.speed; CMP.last = now;
      const [, hi] = cmpRange(); if(CMP.off >= hi){ CMP.off = hi; cmpPlay(false); cmpApply(true); return; }
      cmpApply(false); CMP.raf = requestAnimationFrame(loop);
    };
    CMP.raf = requestAnimationFrame(loop);
  }else cmpApply(true);
  const pb = $('cmpPlayBtn'); if(pb) pb.textContent = on ? '暫停' : '播放';
}
function cmpStep(n){ if(CMP.playing) cmpPlay(false); const f = Math.max(...CMP.vids.map(x => clipFps(x.c) / (x.c.timeScale || 1)), 30); CMP.off += n / f; const [lo, hi] = cmpRange(); CMP.off = Math.max(lo, Math.min(hi, CMP.off)); cmpApply(true); }
function renderCompare(){
  const box = $('rvCompare'); if(!box) return;
  if(CMP.playing) cmpPlay(false);
  box.innerHTML = ''; CMP.vids = [];
  const st = cmpState(), cs = clips();
  box.appendChild(el('p', {class:'help', text:'選 2 到 3 段影片，以同一個標記（例如起始嗶聲或出槍開始）對齊後並排播放、同步逐格，並比較各標記的時間差。建議同一機位拍攝。'}));
  if(cs.length < 2){ box.appendChild(el('p', {class:'help', text:'至少需要兩段影片。請在左側「影片片段」加入。'})); return; }
  const pick = el('div', {class:'btns'});
  cs.forEach(c => { const on = st.ids.includes(c.id); pick.appendChild(el('button', {class:on ? 'on' : '', 'aria-pressed':String(on), text:(CLIPFILES.has(c.id) ? '' : '（未連結）') + shooterName(c.shooterId || SHOOTERS.activeId) + '：' + c.name, onclick:() => {
    if(on) st.ids = st.ids.filter(x => x !== c.id); else { if(st.ids.length >= 3){ alert('最多同時比較 3 段。'); return; } st.ids.push(c.id); }
    saveStage(); CMP.off = 0; renderCompare();
  }})); });
  box.appendChild(pick);
  box.appendChild(selField('同步對齊的標記', SYNC_KEYS, st.sync, v => { st.sync = v; saveStage(); CMP.off = 0; renderCompare(); }));
  const chosen = st.ids.map(id => cs.find(c => c.id === id)).filter(Boolean);
  if(chosen.length < 2){ box.appendChild(el('p', {class:'help', text:'請選至少兩段。'})); return; }
  const miss = chosen.filter(c => !CLIPFILES.has(c.id)), nos = chosen.filter(c => syncT(c, st.sync) == null);
  if(miss.length){ box.appendChild(warn('以下影片尚未連結檔案：' + miss.map(c => c.name).join('、') + '。請在左側重新選擇檔案。')); return; }
  if(nos.length){ box.appendChild(warn('以下影片沒有「' + SYNC_KEYS.find(x => x[0] === st.sync)[1] + '」標記，無法對齊：' + nos.map(c => c.name).join('、') + '。請先在「影片」分頁標記，或換一個同步標記。')); return; }
  const grid = el('div', {style:'display:grid;grid-template-columns:repeat(' + chosen.length + ', minmax(0,1fr));gap:8px'});
  chosen.forEach(c => {
    const v = el('video', {playsinline:'', preload:'auto', muted:''}); v.muted = true; v.src = CLIPFILES.get(c.id).url;
    v.style.cssText = 'width:100%;max-height:36vh;background:#111;border-radius:6px;display:block';
    v.addEventListener('loadedmetadata', () => cmpApply(true));
    const lab = el('div', {class:'kind'});
    grid.appendChild(el('div', null, lab, v));
    CMP.vids.push({c, v, s:syncT(c, st.sync), lab});
  });
  box.appendChild(grid);
  const sl = el('input', {type:'range', id:'cmpSlider', step:'0.001', 'aria-label':'比較時間軸'}); sl.style.width = '100%';
  sl.addEventListener('input', () => { if(CMP.playing) cmpPlay(false); CMP.off = +sl.value; cmpApply(true); });
  const sp = el('select', {'aria-label':'比較播放速度'}); sp.style.width = 'auto';
  [['1','1 倍速'],['0.5','0.5 倍速'],['0.25','0.25 倍速'],['0.1','0.1 倍速']].forEach(([a, n]) => sp.appendChild(el('option', {value:a, text:n}))); sp.value = String(CMP.speed);
  sp.addEventListener('change', () => { CMP.speed = +sp.value; if(CMP.playing){ cmpPlay(false); cmpPlay(true); } });
  box.appendChild(sl);
  box.appendChild(el('div', {class:'readout', id:'cmpTime'}));
  box.appendChild(el('div', {class:'btns'},
    el('button', {text:'回到同步點', onclick:() => { if(CMP.playing) cmpPlay(false); CMP.off = 0; cmpApply(true); }}),
    el('button', {text:'−10 格', onclick:() => cmpStep(-10)}), el('button', {text:'−1 格', onclick:() => cmpStep(-1)}),
    el('button', {class:'primary', id:'cmpPlayBtn', text:'播放', onclick:() => cmpPlay(!CMP.playing)}),
    el('button', {text:'+1 格', onclick:() => cmpStep(1)}), el('button', {text:'+10 格', onclick:() => cmpStep(10)}), sp));
  // aligned mark table
  const keyed = chosen.map(c => markKeys(c, syncT(c, st.sync)));
  const order = []; keyed.forEach(list => list.forEach(x => { if(!order.includes(x.k)) order.push(x.k); }));
  const ul = el('ul', {class:'summ'});
  order.forEach(k => {
    const vals = keyed.map(list => { const x = list.find(y => y.k === k); return x ? x.rt : null; });
    const base = vals[0];
    const txt = k + '：' + vals.map((x, i) => (i ? '' : '') + (x == null ? '—' : fmt(x, 3)) + (i && x != null && base != null ? '（' + (x - base >= 0 ? '+' : '−') + fmt(Math.abs(x - base), 3) + '）' : '')).join('　｜　');
    const li = el('li', null, el('button', {text:'跳到', onclick:() => { if(CMP.playing) cmpPlay(false); const x = vals.find(y => y != null); if(x != null){ CMP.off = x; cmpApply(true); } }}), document.createTextNode('　' + txt));
    ul.appendChild(li);
  });
  box.appendChild(el('div', {class:'kind', text:'各標記時間（距同步點，真實時間；括號為與第一段 ' + chosen[0].name + ' 的差，正數代表較慢）'}));
  box.appendChild(el('div', {class:'help', text:'順序：' + chosen.map(c => shooterName(c.shooterId || SHOOTERS.activeId) + '：' + c.name).join('　｜　')}));
  box.appendChild(ul);
  cmpApply(true);
}
