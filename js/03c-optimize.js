/* ---------- route optimizer ----------
   Goal: the plan with the best hit factor at the chosen risk attitude (robust = the worst 25% of Monte Carlo
   runs, aggressive = the mean). Practical-shooting stage-planning habits generate a few dozen sensible routes
   (fewest positions that see everything, nearest engaging position, no backtracking, stop plate last,
   first target on the entry side and last target toward the next move, shoot on entry / exit for easy targets,
   reload while moving); a local search then tries changes and every candidate is scored with the time model;
   the best ones are compared with Monte Carlo. Locked nodes (stops) keep their position, posture, targets and
   place in the sequence. */
const OPT = {running:false, results:null, stamp:'', note:''};
function optRisk(){ return UI.optRisk || 'robust'; }
const OPT_RISK = [['robust','穩健（看最差 25%）'],['mean','積極（看平均）']];
function optTick(){ return new Promise(r => setTimeout(r, 0)); }
function optRand(seed){ let s = seed || 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
function optSig(plan){ return plan.stops.map(s => [Math.round(s.x*4), Math.round(s.y*4), s.stance, s.entryShoot ? 1 : 0, s.exitShoot ? 1 : 0, s.targets.map(t => t.id).join('+')].join(':')).join('|'); }
function optStart(){ const so = stage.objects.find(o => o.type === 'start'); return so ? [so.x, so.y] : null; }
function optEasy(r, o){
  if(!r || !o) return false;
  if(r.status !== 'full') return false;
  const ns = stage.objects.some(n => n.type === 'noshoot' && n.cover === o.id);
  return !ns && r.dist <= (o.type === 'paper' ? 6 : 5);
}
// order inside a stop: sweep by bearing, the last target toward the next move (easy exit), stop plate last
function optOrderStop(plan, k){
  const st = plan.stops[k], vis = stopVisMemo(st), prev = k > 0 ? plan.stops[k-1] : null, next = plan.stops[k+1] || null;
  const d = downDir(), right = [d[1], -d[0]], lat = v => v[0]*right[0] + v[1]*right[1];
  const ids = st.targets.slice();
  ids.sort((a, b) => (vis[a.id]?.bearing || 0) - (vis[b.id]?.bearing || 0));
  let rev = false;
  if(next){ rev = lat([next.x - st.x, next.y - st.y]) < 0; }                    // leaving to the left: finish on the left
  else if(prev){ rev = lat([st.x - prev.x, st.y - prev.y]) < 0; }                // last stop: start on the side we came from
  if(rev) ids.reverse();
  const sp = ids.findIndex(x => getObj(x.id)?.type === 'stopplate'); if(sp >= 0){ const [x] = ids.splice(sp, 1); ids.push(x); }
  st.targets = ids;
}
function optFlags(plan){
  const start = optStart();
  plan.stops.forEach((st, k) => {
    if(st.locked) return;
    const vis = stopVisMemo(st), prevPt = k > 0 ? [plan.stops[k-1].x, plan.stops[k-1].y] : start, moving = prevPt && Math.hypot(st.x - prevPt[0], st.y - prevPt[1]) > 0.3;
    const f = st.targets[0], l = st.targets[st.targets.length - 1];
    st.entryShoot = !!(moving && f && optEasy(vis[f.id], getObj(f.id)) && getObj(f.id)?.type !== 'stopplate');
    st.exitShoot = !!(k < plan.stops.length - 1 && l && optEasy(vis[l.id], getObj(l.id)));
  });
}
// best order of the free (unlocked) stops: exhaustive for up to 6, otherwise nearest neighbour + 2-opt; stop plate stop last
function optSequence(stops){
  const start = optStart() || [stops[0].x, stops[0].y];
  const fixed = stops.map((s, i) => s.locked ? i : -1).filter(i => i >= 0);
  const spIdx = stops.findIndex(s => s.targets.some(t => getObj(t.id)?.type === 'stopplate'));
  const free = stops.filter((s, i) => !s.locked && i !== (stops[spIdx] && !stops[spIdx].locked ? spIdx : -2));
  const cost = seq => { let c = 0, p = start, back = 0; const dd = downDir(); seq.forEach(s => { c += Math.hypot(s.x - p[0], s.y - p[1]); const along = (s.x - p[0])*dd[0] + (s.y - p[1])*dd[1]; if(along < -0.5) back += -along; p = [s.x, s.y]; }); return c + back * 1.5; };
  const assemble = order => {   // keep locked stops at their indices; free ones fill the gaps; stop plate stop last
    const out = new Array(stops.length).fill(null); fixed.forEach(i => out[i] = stops[i]);
    const tail = stops[spIdx] && !stops[spIdx].locked ? stops[spIdx] : null;
    if(tail){ for(let i = out.length - 1; i >= 0; i--) if(!out[i]){ out[i] = tail; break; } }
    let j = 0; for(let i = 0; i < out.length; i++) if(!out[i]) out[i] = order[j++];
    return out;
  };
  let best = null, bc = Infinity;
  const tryOrder = o => { const seq = assemble(o), c = cost(seq); if(c < bc){ bc = c; best = seq; } };
  if(free.length <= 6){
    const perm = (a, n = a.length) => { if(n <= 1){ tryOrder(a.slice()); return; } for(let i = 0; i < n; i++){ perm(a, n - 1); const j = n % 2 ? 0 : i; [a[j], a[n-1]] = [a[n-1], a[j]]; } };
    perm(free.slice());
  }else{
    const left = free.slice(), order = []; let p = start;
    while(left.length){ let bi = 0, bd = Infinity; left.forEach((s, i) => { const d = Math.hypot(s.x - p[0], s.y - p[1]); if(d < bd){ bd = d; bi = i; } }); const [s] = left.splice(bi, 1); order.push(s); p = [s.x, s.y]; }
    tryOrder(order);
    for(let it = 0; it < 4; it++) for(let i = 0; i < order.length - 1; i++) for(let j = i + 1; j < order.length; j++){ const o2 = order.slice(0, i).concat(order.slice(i, j + 1).reverse(), order.slice(j + 1)); tryOrder(o2); }
  }
  return best || stops;
}
// assign every free target to the nearest stop that engages it well (or at all); locked stops keep theirs
function optAssign(plan, rowQ){
  const lockedT = new Set(plan.stops.filter(s => s.locked).flatMap(s => s.targets.map(t => t.id)));
  plan.stops.forEach(s => { if(!s.locked) s.targets = []; });
  const missing = [];
  engageable().forEach(t => {
    if(lockedT.has(t.id)) return;
    const q = st => { const r = stopVisMemo(st)[t.id]; let v = qual(r); if(v <= 0 && mechMoves(t) && mechTimeline(t, st).any) v = 0.5; return v; };
    const cand = plan.stops.filter(s => !s.locked).map(s => ({s, q:q(s), d:Math.hypot(s.x - t.x, s.y - t.y)})).filter(c => c.q > 0);
    if(!cand.length){ missing.push(t.id); return; }
    const good = cand.filter(c => c.q >= 0.5 - 1e-9), pool = good.length ? good : cand;
    pool.sort((a, b) => a.d - b.d || b.q - a.q);
    pool[0].s.targets.push({id:t.id, n:t.type === 'paper' ? (t.hits || 2) : 1});
  });
  plan.stops = plan.stops.filter(s => s.locked || s.targets.length);
  return missing;
}
function optFinish(plan){
  plan.stops = plan.stops.filter(s => s.locked || s.targets.length);
  plan.stops = optSequence(plan.stops);
  plan.stops.forEach((s, k) => { if(!s.locked) optOrderStop(plan, k); });
  optFlags(plan);
  return plan;
}
function optEval(plan){ planCache = null; const R = computePlan(plan, {noMC:true}); return {R, hf:R.eHF, t:R.total}; }
// greedy covers of the targets with the candidate positions (randomised for variety), locked stops included
function optCovers(rows, base, rnd, count){
  const lockedStops = base ? base.stops.filter(s => s.locked) : [];
  const covered0 = new Set(lockedStops.flatMap(s => s.targets.map(t => t.id)));
  const ids = engageable().map(t => t.id).filter(id => !covered0.has(id));
  const out = [];
  for(let n = 0; n < count; n++){
    const left = new Set(ids.filter(id => rows.some(r => r.q[id] > 0))), pick = [];
    while(left.size){
      const sc = rows.map(r => { let c = 0, q = 0; left.forEach(id => { if(r.q[id] > 0){ c++; q += r.q[id]; } }); return {r, s:c + 0.3 * q}; }).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
      if(!sc.length) break;
      const top = sc.slice(0, n === 0 ? 1 : 4), choice = top[Math.floor(rnd() * top.length)].r;
      pick.push(choice); [...left].forEach(id => { if(choice.q[id] > 0) left.delete(id); });
    }
    out.push(pick);
  }
  return out.map(pick => ({stops:lockedStops.map(s => clone(s)).concat(pick.map(r => ({id:uid(), x:r.p[0], y:r.p[1], stance:'stand', stopType:'full', reload:false, targets:[]})))}));
}
async function optimizeRoute(progress){
  if(OPT.running) return; OPT.running = true; OPT.results = null;
  const say = t => { OPT.note = t; progress && progress(t); };
  try{
    const base = activePlan(), rnd = optRand(20261006);
    // 1. candidate positions inside the shooting areas (or the fallback range), every 50 cm
    const pts = candidatePoints(0.5), rows = [];
    for(let i = 0; i < pts.length; i++){
      const q = {}; computeVis(tempViewpoint(pts[i][0], pts[i][1]), {coarse:true}).forEach(r => q[r.id] = quality(r));
      rows.push({p:pts[i], q});
      if(i % 12 === 11){ say('評估候選站位 ' + (i + 1) + ' / ' + pts.length); await optTick(); }
    }
    if(!rows.length){ say('找不到候選站位：請建立射擊區或放置靶。'); return; }
    // 2. seed routes: randomised greedy covers (+ the current plan), built with the planning habits
    const seeds = optCovers(rows, base, rnd, 14);
    if(base) seeds.push({stops:clone(base.stops), keepAssign:true});
    const archive = new Map();
    const keep = (plan) => { const sig = optSig(plan); if(archive.has(sig)) return archive.get(sig); const e = optEval(plan); const rec = {plan:clone(plan), hf:e.hf, t:e.t, R:e.R}; archive.set(sig, rec); return rec; };
    let si = 0;
    for(const sd of seeds){
      const plan = {id:uid(), name:'opt', stops:sd.stops, overrides:{}, reloadMode:(base && base.reloadMode) || 'auto'};
      if(!sd.keepAssign) optAssign(plan);
      optFinish(plan); keep(plan);
      si++; say('建立候選路線 ' + si + ' / ' + seeds.length); await optTick();
    }
    // 3. local search from the best few: move a target, shift a stop, toggle entry / exit shooting, drop a stop, swap neighbours
    const neighbours = (st) => rows.filter(r => Math.hypot(r.p[0] - st.x, r.p[1] - st.y) <= 0.75 && Math.hypot(r.p[0] - st.x, r.p[1] - st.y) > 0.01 && st.targets.every(t => r.q[t.id] > 0));
    const starts = [...archive.values()].sort((a, b) => b.hf - a.hf).slice(0, 4);
    let evals = 0; const budget = 320;
    for(const s0 of starts){
      let cur = s0;
      for(let it = 0; it < budget / starts.length; it++){
        const p = clone(cur.plan), free = p.stops.map((s, i) => i).filter(i => !p.stops[i].locked);
        if(!free.length) break;
        const kind = Math.floor(rnd() * 5), k = free[Math.floor(rnd() * free.length)], st = p.stops[k];
        if(kind === 0 && st.targets.length){         // move one target to another stop that sees it
          const ti = Math.floor(rnd() * st.targets.length), t = st.targets[ti], o = getObj(t.id);
          const to = free.filter(j => j !== k && qual(stopVisMemo(p.stops[j])[t.id]) > 0);
          if(!to.length || o?.type === 'stopplate') continue;
          st.targets.splice(ti, 1); p.stops[to[Math.floor(rnd() * to.length)]].targets.push(t);
          p.stops = p.stops.filter(s => s.locked || s.targets.length); optFinish(p);
        }else if(kind === 1){                        // shift the stop to a nearby candidate that still engages its targets
          const nb = neighbours(st); if(!nb.length) continue;
          const r = nb[Math.floor(rnd() * nb.length)]; st.x = r.p[0]; st.y = r.p[1]; optFinish(p);
        }else if(kind === 2){                        // shoot on entry / exit or not
          if(rnd() < 0.5) st.entryShoot = !st.entryShoot; else st.exitShoot = !st.exitShoot;
        }else if(kind === 3 && free.length > 1){     // drop a stop when its targets can go elsewhere
          const ok = st.targets.every(t => free.some(j => j !== k && qual(stopVisMemo(p.stops[j])[t.id]) > 0));
          if(!ok) continue;
          const ts = st.targets.slice(); p.stops.splice(k, 1);
          ts.forEach(t => { const c = p.stops.filter(s => !s.locked && qual(stopVisMemo(s)[t.id]) > 0).sort((a, b) => Math.hypot(a.x - getObj(t.id).x, a.y - getObj(t.id).y) - Math.hypot(b.x - getObj(t.id).x, b.y - getObj(t.id).y))[0]; c.targets.push(t); });
          optFinish(p);
        }else{                                        // reverse the sweep inside a stop
          const sp = st.targets.findIndex(x => getObj(x.id)?.type === 'stopplate');
          const body = st.targets.filter((x, i) => i !== sp).reverse(); if(sp >= 0) body.push(st.targets[sp]); st.targets = body;
        }
        const rec = keep(p); evals++;
        if(rec.hf > cur.hf + 1e-6) cur = rec;
        if(evals % 10 === 0){ say('尋找更好的路線 ' + evals + ' / ' + budget); await optTick(); }
      }
    }
    // 4. Monte Carlo on the best distinct routes; rank by the chosen risk attitude
    const top = [...archive.values()].filter(r => !r.R.warnings.some(w => /DQ|打不到|看不到/.test(w))).sort((a, b) => b.hf - a.hf).slice(0, 8);
    const pool = top.length ? top : [...archive.values()].sort((a, b) => b.hf - a.hf).slice(0, 8);
    for(let i = 0; i < pool.length; i++){
      const mc = runMonteCarlo(pool[i].plan, {n:1000, seed:777});
      pool[i].mean = mc.hf.mean; pool[i].p25 = mc.hf.p25; pool[i].time = mc.time.mean;
      say('比較風險 ' + (i + 1) + ' / ' + pool.length); await optTick();
    }
    const key = optRisk() === 'robust' ? 'p25' : 'mean';
    pool.sort((a, b) => b[key] - a[key]);
    // keep routes that really differ (same stops and order with only small shifts count once)
    const seen = new Set(), uniq = [];
    pool.forEach(r => { const k2 = r.plan.stops.map(s => s.targets.map(t => t.id).join('+') + (s.entryShoot ? 'E' : '') + (s.exitShoot ? 'X' : '')).join('|') + '#' + r.plan.stops.map(s => Math.round(s.x) + ',' + Math.round(s.y)).join(';'); if(!seen.has(k2)){ seen.add(k2); uniq.push(r); } });
    OPT.results = uniq.slice(0, 3); OPT.stamp = JSON.stringify(stage.objects).length + '|' + (base ? base.id : '');
    say('完成：比較了 ' + archive.size + ' 條路線。');
  }finally{ OPT.running = false; planCache = null; if(typeof renderPlanPanel === 'function') renderPlanPanel(); }
}
function optDescribe(rec, best){
  const s = rec.plan.stops, R = rec.R;
  const bits = [s.length + ' 個停頓點', '平均 ' + fmt(rec.time || R.total) + ' 秒', '期望 HF ' + fmt(rec.mean, 3), '最差 25% ' + fmt(rec.p25, 3)];
  const ent = s.filter(x => x.entryShoot).length, ex = s.filter(x => x.exitShoot).length;
  if(ent || ex) bits.push('進入開槍 ' + ent + '、邊打邊離開 ' + ex);
  let diff = '';
  if(best && best !== rec){
    const d = [];
    const dt = (rec.time || R.total) - (best.time || best.R.total); if(Math.abs(dt) >= 0.05) d.push((dt < 0 ? '快 ' : '慢 ') + fmt(Math.abs(dt)) + ' 秒');
    const dn = s.length - best.plan.stops.length; if(dn) d.push((dn < 0 ? '少 ' : '多 ') + Math.abs(dn) + ' 個停頓點');
    const dh = rec.p25 - best.p25; d.push('最差 25% 的 HF ' + (dh >= 0 ? '高 ' : '低 ') + fmt(Math.abs(dh), 3));
    diff = '與第 1 名相比：' + d.join('、') + '。';
  }
  const route = s.map((x, i) => 'S' + (i + 1) + (x.locked ? '🔒' : '') + '：' + x.targets.map(t => getObj(t.id)?.label).join('、')).join('　');
  return {line:bits.join('，'), diff, route};
}
function renderOptBox(box){
  const d = el('div', {class:'port optbox'});
  d.appendChild(el('div', {class:'kind', text:'路線最佳化'}));
  d.appendChild(el('p', {class:'help', text:'依射擊高手的規劃原則（停頓點少、就近射擊、不走回頭路、stop plate 最後、第一個靶在進入方向、最後一個靶朝下一個移動方向、好打的靶進入或離開時就開槍、換匣排在移動中）產生候選路線，再用時間模型與蒙地卡羅比較。勾選「鎖定節點」的停頓點會保持位置、姿勢、靶與順序。'}));
  d.appendChild(row(selField('風險偏好', OPT_RISK, optRisk(), v => { UI.optRisk = v; saveUI(); }),
    el('div', null, el('label', {class:'f', text:' '}), el('button', {class:'primary', text:OPT.running ? '計算中…' : '找最佳路線', onclick:() => {
      if(OPT.running) return;
      const msg = el('div', {class:'readout', text:'開始…'}); d.appendChild(msg);
      optimizeRoute(t => { msg.textContent = t; });
    }}))));
  if(OPT.note && !OPT.results) d.appendChild(el('div', {class:'readout', text:OPT.note}));
  if(OPT.results && OPT.results.length){
    const best = OPT.results[0];
    d.appendChild(el('div', {class:'readout', text:OPT.note + '依「' + (optRisk() === 'robust' ? '最差 25% 的 HF' : '平均 HF') + '」排序：'}));
    OPT.results.forEach((rec, i) => {
      const ds = optDescribe(rec, best), card = el('div', {class:'optres'});
      card.appendChild(el('b', {text:'第 ' + (i + 1) + ' 名　'})); card.appendChild(document.createTextNode(ds.line));
      if(ds.diff) card.appendChild(el('div', {class:'help', text:ds.diff}));
      card.appendChild(el('div', {class:'help', text:ds.route}));
      card.appendChild(el('div', {class:'btns'}, el('button', {text:'採用為新計畫', onclick:() => {
        const p = clone(rec.plan); p.id = uid(); p.name = nextPlanName() + '（最佳化 ' + (i + 1) + '）'; p.stops.forEach(s => s.id = uid()); delete p.unassigned;
        plans().push(p); activePlanId = p.id; planBase = {id:p.id, json:JSON.stringify(p)}; planChanged(true);
      }})));
      d.appendChild(card);
    });
  }
  box.appendChild(d);
}
