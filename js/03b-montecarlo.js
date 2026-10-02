/*! Stage 模擬器 — IPSC Action Air stage 規劃、回放與檢討
 *  Copyright (C) 2026 James
 *  SPDX-License-Identifier: GPL-3.0-or-later
 *  本程式為自由軟體：你可以依自由軟體基金會發布的 GNU 通用公共授權條款第 3 版，
 *  或（由你選擇）任何更新的版本，重新散布或修改本程式。本程式不提供任何保證，
 *  亦不保證適售性或特定目的適用性。完整條款見 LICENSE 或 <https://www.gnu.org/licenses/>。
 */
/* ---------- Monte Carlo: run the same route many times without animation ----------
   Each run draws every shot's hit from the model's hit distribution and varies every shot's time.
   Steel that does not fall is shot again (like a real run); a missed stop plate is shot until it falls;
   extra rounds can empty a magazine early, which costs an unplanned standing reload. */
const MC_DEF = {n:10000, runSd:4, shotSd:10, steelMakeup:3, seed:20261001};
const MC = {opts:null, res:null, cmpRes:null};
function mcOpts(){
  if(!MC.opts){ MC.opts = Object.assign({}, MC_DEF); try{ Object.assign(MC.opts, JSON.parse(localStorage.getItem('stageSim.mc') || '{}')); }catch(e){} }
  return MC.opts;
}
function mcSaveOpts(){ try{ localStorage.setItem('stageSim.mc', JSON.stringify(Object.assign({}, MC.opts, {seed:undefined}))); }catch(e){} }
function mulberry32(a){ return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function gaussFn(rand){ let spare = null; return () => { if(spare != null){ const s = spare; spare = null; return s; } let u = 0, v = 0; while(u <= 1e-12) u = rand(); v = rand(); const m = Math.sqrt(-2 * Math.log(u)); spare = m * Math.sin(2 * Math.PI * v); return m * Math.cos(2 * Math.PI * v); }; }
function pct(sorted, q){ if(!sorted.length) return 0; const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1)))); return sorted[i]; }
function runMonteCarlo(plan, o){
  o = Object.assign({}, mcOpts(), o || {});
  const R = computePlan(plan, {noMC:true});
  const shots = R.shots, N = Math.max(100, Math.min(200000, o.n | 0));
  const rand = mulberry32(o.seed), g = gaussFn(rand);
  const sRun = o.runSd / 100, sShot = o.shotSd / 100;
  const ln = s => Math.exp(s * g() - s * s / 2);           // lognormal factor with mean 1
  const load = PROFILE.byDiv[R.division] ? PROFILE.byDiv[R.division].load : 15, T = PROFILE.time;
  const times = new Float64Array(N), pts = new Float64Array(N), hfs = new Float64Array(N);
  let anyMiss = 0, anyNS = 0, steelDown = 0, makeups = 0, extraRl = 0, spMiss = 0;
  const steelTargets = new Set(shots.filter(x => x.steel).map(x => x.target));
  for(let n = 0; n < N; n++){
    const day = ln(sRun);
    let t = 0, p = 0, debt = 0, miss = false, ns = false, down = false, mk = 0, rl = false, prevLeft = Infinity;
    const fallen = {};
    for(let i = 0; i < shots.length; i++){
      const x = shots[i];
      if(x.magLeft > prevLeft - 1) debt = 0;              // a planned reload happened before this shot
      prevLeft = x.magLeft;
      const rest = Math.max(0, x.dt - x.parts.shoot - x.parts.move);
      if(x.steel && fallen[x.target]){ t += x.parts.move * day + rest; debt--; continue; }   // already down: skip the planned shot
      t += (x.parts.shoot + x.parts.move) * day * ln(sShot) + rest;
      const avail = () => x.magLeft - debt;                 // rounds left after this shot, counting extra rounds already fired
      if(avail() < 0){ t += T.reloadStatic; debt = x.magLeft - load + 1; rl = true; }   // ran dry earlier than planned
      if(x.steel){
        let hit = rand() < x.pS, tries = 0;
        const cap = x.kindKey === 'stopplate' ? 6 : o.steelMakeup;
        while(!hit && tries < cap){
          tries++; mk++; debt++;
          if(avail() < 0){ t += T.reloadStatic; debt = x.magLeft - load + 1; rl = true; }
          t += x.sp * day * ln(sShot);
          hit = rand() < x.pS;
        }
        if(hit){ fallen[x.target] = true; if(x.scored) p += 5; }
        else if(x.scored){ p -= 10; down = true; }
        else spMiss++;
      }else if(x.scored){
        const h = x.hd, u = rand();
        if(u < h.A) p += 5; else if(u < h.A + h.C) p += 3; else if(u < h.A + h.C + h.D) p += 1;
        else if(u < h.A + h.C + h.D + h.M){ p -= 10; miss = true; } else { p -= 10; ns = true; }
      }
    }
    times[n] = t; pts[n] = Math.max(0, p); hfs[n] = t > 0 ? Math.max(0, p) / t : 0;
    if(miss) anyMiss++; if(ns) anyNS++; if(down) steelDown++; makeups += mk; if(rl) extraRl++;
  }
  const mean = a => { let s = 0; for(const v of a) s += v; return s / a.length; };
  const sd = (a, m) => { let s = 0; for(const v of a) s += (v - m) * (v - m); return Math.sqrt(s / Math.max(1, a.length - 1)); };
  const mHF = mean(hfs), sHF = sd(hfs, mHF), mT = mean(times), mP = mean(pts);
  const sT = Float64Array.from(times).sort(), sP = Float64Array.from(pts).sort(), sH = Float64Array.from(hfs).sort();
  let below = 0; for(const v of hfs) if(v < R.eHF * 0.9) below++;
  return {plan, N, R, opts:o, hfs, sig:mcSig(plan, o),
    time:{mean:mT, p10:pct(sT, 0.1), p50:pct(sT, 0.5), p90:pct(sT, 0.9)},
    pts:{mean:mP, p10:pct(sP, 0.1), p50:pct(sP, 0.5), p90:pct(sP, 0.9), max:R.maxPts},
    hf:{mean:mHF, sd:sHF, se:sHF / Math.sqrt(N), p5:pct(sH, 0.05), p10:pct(sH, 0.1), p50:pct(sH, 0.5), p90:pct(sH, 0.9), min:sH[0], max:sH[N - 1]},
    pMiss:anyMiss / N, pNS:anyNS / N, pSteelDown:steelDown / N, makeups:makeups / N, pExtraRl:extraRl / N, spMiss:spMiss / N,
    pBelow:below / N, hasSteel:steelTargets.size > 0};
}
function mcSig(plan, o){ return JSON.stringify([plan, o.n, o.runSd, o.shotSd, o.steelMakeup, o.seed, PROFILE.division, PROFILE.time, PROFILE.hit, JSON.stringify(stage.objects).length]); }
function drawMCHist(cv, res){
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth || 520, H = 150;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.height = H + 'px';
  const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
  const lo = res.hf.min, hi = res.hf.max, B = 40, bins = new Array(B).fill(0), span = Math.max(1e-6, hi - lo);
  for(const v of res.hfs) bins[Math.min(B - 1, Math.floor((v - lo) / span * B))]++;
  const top = Math.max(...bins), L = 8, Rr = W - 8, bw = (Rr - L) / B, base = H - 22;
  const X = v => L + (v - lo) / span * (Rr - L);
  c.fillStyle = 'rgba(31,110,140,.18)'; c.fillRect(X(res.hf.p10), 6, X(res.hf.p90) - X(res.hf.p10), base - 6);
  c.fillStyle = '#1F6E8C';
  bins.forEach((b, i) => { const h = b / top * (base - 10); c.fillRect(L + i * bw + 0.5, base - h, Math.max(1, bw - 1), h); });
  c.strokeStyle = '#1E2B38'; c.lineWidth = 1; c.beginPath(); c.moveTo(L, base + 0.5); c.lineTo(Rr, base + 0.5); c.stroke();
  const mark = (v, col, txt, up) => { const x = X(v); c.strokeStyle = col; c.lineWidth = 2; c.beginPath(); c.moveTo(x, 6); c.lineTo(x, base); c.stroke(); c.fillStyle = col; c.font = '600 11px sans-serif'; c.textAlign = 'center'; c.fillText(txt, Math.min(Rr - 30, Math.max(L + 30, x)), up ? 14 : base + 15); };
  mark(res.hf.mean, '#C8372D', '平均 ' + fmt(res.hf.mean, 3), false);
  c.fillStyle = '#5B6773'; c.font = '11px sans-serif'; c.textAlign = 'left'; c.fillText(fmt(lo, 2), L, H - 4); c.textAlign = 'right'; c.fillText(fmt(hi, 2), Rr, H - 4);
}
function renderMC(force){
  const box = $('rpMC'); if(!box) return;
  const plan = activePlan(), o = mcOpts();
  box.innerHTML = '';
  if(!plan){ box.appendChild(el('p', {class:'help', text:'尚無路線計畫。請在左側「路線計畫與換匣」建立。'})); return; }
  const set = el('div', {class:'mcset'});
  const num = (lab, key, min, max, step, unit, title) => {
    const i = el('input', {type:'number', min:String(min), max:String(max), step:String(step), value:String(o[key]), title:title || ''});
    i.addEventListener('change', () => { const v = parseFloat(i.value); if(isFinite(v)){ o[key] = Math.min(max, Math.max(min, v)); mcSaveOpts(); renderMC(true); } });
    return el('label', {title:title || ''}, document.createTextNode(lab + ' '), i, document.createTextNode(unit ? ' ' + unit : ''));
  };
  const ns = el('select', {'aria-label':'模擬次數'});
  [[2000, '2,000 次（快速試算）'], [10000, '10,000 次（建議）'], [50000, '50,000 次（精細）']].forEach(([v, t]) => ns.appendChild(el('option', {value:String(v), text:t})));
  ns.value = String(o.n); ns.addEventListener('change', () => { o.n = +ns.value; mcSaveOpts(); renderMC(true); });
  set.appendChild(el('label', null, document.createTextNode('次數 '), ns));
  set.appendChild(num('每槍時間變異', 'shotSd', 0, 40, 1, '%', '每一槍的動作時間（射擊、換靶、移動）隨機快慢的幅度，以標準差表示'));
  set.appendChild(num('每次整體快慢', 'runSd', 0, 20, 1, '%', '同一次跑 stage 整體偏快或偏慢的幅度（狀態好壞），以標準差表示'));
  set.appendChild(num('鋼靶最多補射', 'steelMakeup', 0, 6, 1, '發', '鋼靶沒倒時，最多再補幾發；stop plate 一律補到倒為止'));
  box.appendChild(set);
  box.appendChild(el('div', {class:'btns'},
    el('button', {class:'primary', text:'重新抽樣', title:'換一組亂數再跑一次', onclick:() => { o.seed = (Math.random() * 1e9) | 0; renderMC(true); }}),
    el('button', {text:'所有計畫一起跑', onclick:() => renderMCCompare()})));
  const sig = mcSig(plan, o);
  if(force || !MC.res || MC.res.sig !== sig){
    const t0 = performance.now(); MC.res = runMonteCarlo(plan, o); MC.res.ms = performance.now() - t0;
  }
  const r = MC.res, R = r.R;
  const out = el('div', {class:'mcout'});
  out.appendChild(el('div', {class:'readout', text:'計畫 ' + plan.name + '：模擬 ' + r.N.toLocaleString() + ' 次，期望 HF ' + fmt(r.hf.mean, 3) + '（95% 誤差約 ±' + fmt(r.hf.se * 1.96, 3) + '）'}));
  const ul = el('ul', {class:'summ'});
  const li = t => ul.appendChild(el('li', {text:t}));
  li('Hit factor：中位數 ' + fmt(r.hf.p50, 3) + '；八成落在 ' + fmt(r.hf.p10, 3) + ' 到 ' + fmt(r.hf.p90, 3) + '；最差 5% 低於 ' + fmt(r.hf.p5, 3) + '。');
  li('得分：平均 ' + fmt(r.pts.mean, 1) + ' ／ ' + r.pts.max + ' 分；八成落在 ' + fmt(r.pts.p10, 0) + ' 到 ' + fmt(r.pts.p90, 0) + ' 分。');
  li('時間：平均 ' + fmt(r.time.mean) + ' 秒；八成落在 ' + fmt(r.time.p10) + ' 到 ' + fmt(r.time.p90) + ' 秒（計畫值 ' + fmt(R.total) + ' 秒）。');
  li('至少一發紙靶 M：' + Math.round(r.pMiss * 100) + '%；打到 no-shoot：' + Math.round(r.pNS * 100) + '%。');
  if(r.hasSteel) li('鋼靶平均補射 ' + fmt(r.makeups, 2) + ' 發；補射後仍有鋼靶沒倒：' + fmt(r.pSteelDown * 100, 1) + '%。');
  li('補射用掉額外子彈，造成計畫外定點換匣：' + fmt(r.pExtraRl * 100, 1) + '%。');
  li('HF 低於計畫期望值 ' + fmt(R.eHF, 3) + ' 的九成：' + Math.round(r.pBelow * 100) + '%。');
  out.appendChild(ul);
  const cv = el('canvas', {class:'mchist', 'aria-label':'hit factor 分布圖'}); out.appendChild(cv);
  out.appendChild(el('p', {class:'help', text:'長條為各次 HF 的分布，淺色區為中間八成，紅線為平均。與「摘要」的期望 HF 不同之處：這裡鋼靶沒倒會補射（多花時間但不扣 10 分），stop plate 補到倒為止，時間也會隨機快慢，所以比較接近實戰的結果。時間變異預設為估計值，有實測紀錄後可依實際起伏調整。計算 ' + Math.round(r.ms) + ' 毫秒。'}));
  box.appendChild(out);
  requestAnimationFrame(() => drawMCHist(cv, r));
  if(MC.cmpRes && MC.cmpRes.sig === JSON.stringify([plans().map(p => p.id), sig])) box.appendChild(mcCompareBlock(MC.cmpRes));
}
function renderMCCompare(){
  const ps = plans(); if(ps.length < 2){ alert('至少要有兩份路線計畫才能比較。'); return; }
  const o = mcOpts();
  const rows = ps.map(p => ({p, r:runMonteCarlo(p, o)})).sort((a, b) => b.r.hf.mean - a.r.hf.mean);
  const [a, b] = rows; let win = 0; for(let i = 0; i < a.r.N; i++) if(a.r.hfs[i] > b.r.hfs[(i * 7919) % b.r.N]) win++;
  MC.cmpRes = {rows, pWin:win / a.r.N, sig:JSON.stringify([ps.map(p => p.id), mcSig(activePlan(), o)])};
  renderMC();
}
function mcCompareBlock(c){
  const d = el('div', {class:'port'});
  d.appendChild(el('div', {class:'kind', text:'所有計畫比較（各 ' + c.rows[0].r.N.toLocaleString() + ' 次）'}));
  const ul = el('ul', {class:'summ'});
  c.rows.forEach(({p, r}) => ul.appendChild(el('li', {text:'計畫 ' + p.name + '：期望 HF ' + fmt(r.hf.mean, 3) + '，八成落在 ' + fmt(r.hf.p10, 3) + ' 到 ' + fmt(r.hf.p90, 3) + '，平均 ' + fmt(r.time.mean) + ' 秒、' + fmt(r.pts.mean, 1) + ' 分'})));
  d.appendChild(ul);
  const [a, b] = c.rows;
  d.appendChild(el('p', {class:'help', text:'計畫 ' + a.p.name + ' 單次 HF 高過計畫 ' + b.p.name + ' 的機率約 ' + Math.round(c.pWin * 100) + '%。' + (c.pWin < 0.6 ? '兩者差距不大，選自己比較有把握的路線即可。' : '')}));
  return d;
}
