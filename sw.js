/*! Stage 模擬器 — IPSC Action Air stage 規劃、回放與檢討
 *  Copyright (C) 2026 James
 *  SPDX-License-Identifier: GPL-3.0-or-later
 *  本程式為自由軟體：你可以依自由軟體基金會發布的 GNU 通用公共授權條款第 3 版，
 *  或（由你選擇）任何更新的版本，重新散布或修改本程式。本程式不提供任何保證，
 *  亦不保證適售性或特定目的適用性。完整條款見 LICENSE 或 <https://www.gnu.org/licenses/>。
 */
// Stage 模擬器 service worker: network first (always the newest files when online), cache fallback (works offline).
const CACHE = 'stage-sim-v10';
const APP = ['./', 'index.html', 'style.css', 'manifest.webmanifest',
  'js/01-core.js', 'js/02-visibility-3d.js', 'js/02b-gl3d.js', 'js/03-model-plan.js', 'js/03b-montecarlo.js', 'js/04-replay.js', 'js/05-review.js', 'js/06-video.js', 'js/07-ui-init.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(APP)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if(req.method !== 'GET' || url.origin !== self.location.origin) return;   // video blobs, fonts and other sites are not touched
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const timeout = new Promise(r => setTimeout(() => r(null), 3000));
    try{
      const net = fetch(req).then(res => { if(res && res.ok) cache.put(req, res.clone()); return res; });
      const res = await Promise.race([net, timeout]);
      if(res) return res;
      const hit = await cache.match(req, {ignoreSearch:true}); if(hit) return hit;
      return await net;
    }catch(err){
      const hit = await cache.match(req, {ignoreSearch:true}) || (req.mode === 'navigate' ? await cache.match('index.html') : null);
      if(hit) return hit; throw err;
    }
  })());
});
