/* FEDLIGHT · P-06 PROXY TRACE
   A rotating orthographic wireframe globe with a hand-authored dotted land mask, running a
   live proxy-chain trace of 7-10 hops that great-circle their way to the origin, PARIS.
   Layout adapts to aspect: stacked when tall, globe+list when wide, minimal at ~97px. */
(() => {
  'use strict';

  // Coarse 5-degree land bitmap: [row] -> list of [colStart,colEnd] inclusive.
  // row 0 = 90N..85N, row 35 = -85S; col 0 = lon -180, col 71 = lon +175. Hand-authored to read
  // as Earth's continents (Americas / Europe+Africa / Asia / Australia).
  const LAND = {
    1: [[13, 18], [27, 29]],
    2: [[10, 20], [26, 31], [50, 67]],
    3: [[7, 24], [25, 31], [37, 41], [44, 71]],
    4: [[3, 8], [9, 24], [26, 30], [35, 42], [44, 71]],
    5: [[3, 9], [9, 25], [27, 29], [34, 43], [45, 71]],
    6: [[4, 9], [9, 25], [34, 34], [36, 45], [46, 71]],
    7: [[6, 24], [34, 46], [47, 71]],
    8: [[8, 24], [34, 47], [48, 71]],
    9: [[9, 23], [33, 48], [49, 71]],
    10: [[10, 22], [33, 45], [46, 72]],
    11: [[11, 21], [32, 50], [52, 67]],
    12: [[13, 20], [31, 52], [53, 66]],
    13: [[15, 19], [31, 52], [53, 59], [60, 66]],
    14: [[16, 21], [31, 52], [53, 58], [60, 65]],
    15: [[19, 27], [31, 52], [54, 57], [60, 65]],
    16: [[21, 28], [32, 51], [60, 66]],
    17: [[20, 29], [33, 49], [58, 66]],
    18: [[20, 29], [34, 48], [58, 65]],
    19: [[20, 29], [34, 47], [59, 64]],
    20: [[21, 28], [34, 46], [60, 63]],
    21: [[21, 27], [35, 45], [58, 64]],
    22: [[22, 27], [36, 44], [57, 65]],
    23: [[22, 26], [37, 43], [57, 65]],
    24: [[23, 25], [38, 42], [58, 64]],
    25: [[23, 24], [39, 40], [59, 62]],
    26: [[23, 24]],
    27: [[23, 23]],
    28: [[23, 23]],
  };
  const ORIGIN = { name: 'PARIS', cc: 'FR', lat: 48.8566, lon: 2.3522 };
  // the proxy chain always bounces through Agent Fed's old haunts before locking on the origin
  const ROUTE = [
    { name: 'BUENOS AIRES', cc: 'AR', lat: -34.6037, lon: -58.3816 },
    { name: 'PITTSBURGH', cc: 'PA', lat: 40.4406, lon: -79.9959 },
    { name: 'BROOKLYN', cc: 'NY', lat: 40.6782, lon: -73.9442 },
    { name: 'NYC SEAPORT', cc: 'NY', lat: 40.7066, lon: -74.0031 },
    { name: 'SANTA MONICA', cc: 'CA', lat: 34.0195, lon: -118.4912 },
  ];
  const D2R = Math.PI / 180;

  HD.panel('trace', (ctx) => {
    const U = ctx.util;
    const rng = ctx.rng(HD.seed ^ 0x06ce);

    /* ------------------------------------------------------------------ DOM */
    const root = U.el('div', 'tr-root');
    const globeEl = U.el('div', 'tr-globe');
    const side = U.el('div', 'tr-side');
    const listEl = U.el('div', 'tr-list');
    const rttEl = U.el('div', 'tr-rtt'); // per-hop latency bars; takes whatever height is left
    const lock = U.el('div', 'tr-lock');
    lock.innerHTML =
      '<div class="tr-lock-top"><span>ORIGIN LOCK</span><span class="tr-lock-pct">0%</span></div>' +
      '<div class="tr-lock-bar"><i class="tr-lock-fill"></i></div>';
    side.append(listEl, rttEl, lock);
    root.append(globeEl, side);
    ctx.el.appendChild(root);
    const pctEl = lock.querySelector('.tr-lock-pct');
    const fillEl = lock.querySelector('.tr-lock-fill');

    const cv = ctx.canvas({ parent: globeEl, dprMax: 2 });
    const g = cv.ctx;
    const rcv = ctx.canvas({ parent: rttEl, dprMax: 2 });
    const rg = rcv.ctx;
    // the strip's height is whatever the rows leave, and rows reflow when webfonts land or the
    // hop count changes, none of which resizes the panel body, so watch the strip itself
    if (window.ResizeObserver) new ResizeObserver(() => rcv.fit()).observe(rttEl);

    /* ----------------------------------------------------- precomputed geometry */
    function ll2v(lat, lon) {
      const a = lat * D2R, b = lon * D2R, ca = Math.cos(a);
      return { x: ca * Math.sin(b), y: Math.sin(a), z: ca * Math.cos(b) };
    }
    // land points; big globes use a 2x2 subdivision of every cell so the continents stay dense
    const landPts = [];
    const landFine = [];
    for (const rowKey in LAND) {
      const row = +rowKey;
      const lat = 90 - row * 5 - 2.5;
      for (const [s, e] of LAND[row]) {
        for (let c = s; c <= e; c++) {
          const lon = -180 + c * 5 + 2.5;
          landPts.push(ll2v(lat, lon));
          for (const dl of [-1.25, 1.25]) for (const dn of [-1.25, 1.25]) landFine.push(ll2v(lat + dl, lon + dn));
        }
      }
    }
    // land dot colours by quantised alpha: no per-dot string building
    const LV = 24;
    const lutIce = [];
    const lutHolo = [];
    for (let i = 0; i < LV; i++) {
      lutIce.push(ctx.rgba('ice', i / (LV - 1)));
      lutHolo.push(ctx.rgba('holo', i / (LV - 1)));
    }
    // graticule: parallels every 30, meridians every 30, sampled
    const grat = [];
    for (let lat = -60; lat <= 60; lat += 30) {
      const line = [];
      for (let lon = -180; lon <= 180; lon += 9) line.push(ll2v(lat, lon));
      grat.push(line);
    }
    for (let lon = -180; lon < 180; lon += 30) {
      const line = [];
      for (let lat = -80; lat <= 80; lat += 8) line.push(ll2v(lat, lon));
      grat.push(line);
    }

    /* ----------------------------------------------------------------- state */
    let chain = [];
    let segs = []; // slerp samples per segment
    let N = 0;
    let locked = 1; // cities fully reached (origin counts)
    let arcT = 0;
    let dwellT = 0;
    let phase = 'hop'; // hop | dwell | lock | fade | idle
    let phaseT = 0;
    let fast = false;
    let alpha = 1; // chain fade
    let yaw = 0, targetYaw = 0, pitch = 0.34, targetPitch = 0.34;
    let lost = null; // intrusion reroute marker
    const pulses = []; // {vec, t}
    let layout = 'tall';
    let started = false;
    let k = 1; // UI scale for big panels (text, bars)
    let gk = 1; // globe marker scale, from the globe radius
    let cols = false; // very wide strip: list and RTT side by side
    let totalLat = 1; // sum of every hop latency in the chain (origin level of the RTT history)
    // cumulative-RTT history, sampled every 100 ms (ring buffer)
    const HIST = 256;
    const hist = new Float32Array(HIST);
    let histHead = 0;
    let histCount = 0;
    let histAcc = 0;
    for (let i = 0; i < HIST; i++) hist[i] = 2 + Math.abs(Math.sin(i * 0.7)) * 3;
    histHead = 0;
    histCount = HIST;

    const DUR = { arc: 1500, dwell: 480, lock: 3200, fade: 1400, idle: 1400 };
    const spd = () => (fast ? 2 : 1) * (urgent ? 1.35 : 1) * (ctx.reducedMotion ? 0.8 : 1);

    function slerp(a, b, n) {
      let dot = U.clamp(a.x * b.x + a.y * b.y + a.z * b.z, -1, 1);
      const om = Math.acos(dot), so = Math.sin(om) || 1e-6;
      const out = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n, s0 = Math.sin((1 - t) * om) / so, s1 = Math.sin(t * om) / so;
        out.push({ x: a.x * s0 + b.x * s1, y: a.y * s0 + b.y * s1, z: a.z * s0 + b.z * s1, t });
      }
      return out;
    }

    function mkHop(city, i) {
      return {
        name: city.name, cc: city.cc, lat: city.lat, lon: city.lon,
        vec: ll2v(city.lat, city.lon),
        ip: U.ip(rng),
        latency: 8 + i * rng.int(6, 22) + rng.int(0, 12),
      };
    }

    function buildChain() {
      chain = ROUTE.map((c, i) => mkHop(c, i));
      chain.push(mkHop(ORIGIN, ROUTE.length));
      N = chain.length;
      sumLat();
      segs = [];
      for (let i = 1; i < N; i++) segs.push(slerp(chain[i - 1].vec, chain[i].vec, 22));
      locked = 1;
      arcT = 0; dwellT = 0; phase = 'hop'; phaseT = 0; alpha = 1; lost = null;
      pulses.length = 0;
      pulses.push({ vec: chain[0].vec, t: 0 });
      targetYaw = -chain[0].lon * D2R;
      targetPitch = U.clamp(chain[0].lat * D2R * 0.55, -0.42, 0.5);
      ctx.frame.classList.remove('is-locked');
      buildRows();
      updateRows();
      // the row count may have changed, which resizes the RTT strip (a layout read, once per chain)
      if (started) rcv.fit();
      emitHop(0);
    }

    function reroute() {
      // the hop drops and is re-established on a fresh relay address, so the route stays on its named stops
      const idx = locked; // 0-based index being travelled to
      if (idx >= N - 1) return;
      chain[idx] = mkHop(chain[idx], idx);
      sumLat();
      arcT = 0;
      updateRows();
      ctx.alert('warn', `HOP ${idx + 1} LOST — RE-ESTABLISHING ${chain[idx].name} RELAY`);
    }

    function sumLat() {
      totalLat = 0;
      for (let i = 0; i < N; i++) totalLat += chain[i].latency;
      totalLat = Math.max(1, totalLat);
    }

    function emitHop(i) {
      const h = chain[i];
      ctx.emit('trace:hop', { index: i + 1, total: N, city: h.name, cc: h.cc, ip: h.ip, latency: h.latency });
      if (ctx.audio) ctx.audio.beep(520 + i * 40, 40, 'sine', 0.02);
    }

    /* ------------------------------------------------------------------ rows */
    const rows = [];
    function buildRows() {
      while (rows.length < N) {
        const r = U.el('div', 'tr-row');
        r.innerHTML = '<span class="tr-idx"></span><span class="tr-mark"></span><span class="tr-ci"></span><span class="tr-cc"></span><div class="tr-l2"></div>';
        listEl.appendChild(r);
        rows.push({ el: r, idx: r.querySelector('.tr-idx'), mark: r.querySelector('.tr-mark'), ci: r.querySelector('.tr-ci'), cc: r.querySelector('.tr-cc'), l2: r.querySelector('.tr-l2') });
      }
      for (let i = 0; i < rows.length; i++) rows[i].el.style.display = i < N ? '' : 'none';
    }
    function updateRows() {
      for (let i = 0; i < N; i++) {
        const h = chain[i], r = rows[i];
        const done = i < locked;
        const cur = i === locked && phase !== 'lock' && phase !== 'fade' && phase !== 'idle';
        const isTarget = i === N - 1;
        const reachedAll = phase === 'lock' || phase === 'fade' || phase === 'idle';
        r.idx.textContent = U.pad(i + 1);
        r.ci.textContent = h.name;
        r.cc.textContent = h.cc;
        r.mark.textContent = (done || reachedAll) ? '✓' : cur ? '▸' : '·';
        r.l2.textContent = (done || reachedAll) ? `${h.ip} · ${h.latency}ms` : cur ? `${h.ip} · SYN…` : '···';
        r.el.className = 'tr-row' +
          (i === 0 ? ' is-origin' : '') +
          (isTarget ? ' is-target' : '') +
          ((done || reachedAll) ? ' is-done' : cur ? ' is-cur' : ' is-pending');
      }
      scrollRows();
    }

    // When the list cannot show every hop, keep the current one (and the next) in view: fold away
    // whole rows above it and hide a row the bottom edge would cut, so no row is ever sliced in
    // half. Layout reads: runs on hop changes and resizes only, never per frame.
    const clipFlags = [];
    function scrollRows() {
      if (!N || !rows[0]) return;
      for (let i = 0; i < N; i++) rows[i].el.classList.remove('is-gone', 'is-clip');
      listEl.scrollTop = 0;
      if (listEl.scrollHeight <= listEl.clientHeight + 1) return;
      const t0 = rows[0].el.offsetTop;
      const avail = listEl.clientHeight - Math.max(0, t0 - listEl.offsetTop - listEl.clientTop);
      const ci = Math.min(locked, N - 1);
      const ti = Math.min(ci + 1, N - 1);
      const bottom = rows[ti].el.offsetTop + rows[ti].el.offsetHeight - t0;
      let f = 0;
      while (f < ci && bottom - (rows[f].el.offsetTop - t0) > avail) f++;
      const shift = rows[f].el.offsetTop - t0;
      // measure everything first, then write (no read-after-write thrash)
      for (let i = 0; i < N; i++) {
        const r = rows[i].el;
        clipFlags[i] = i < f ? 1 : r.offsetTop - t0 + r.offsetHeight - shift > avail + 1 ? 2 : 0;
      }
      for (let i = 0; i < N; i++) {
        if (clipFlags[i] === 1) rows[i].el.classList.add('is-gone');
        else if (clipFlags[i] === 2) rows[i].el.classList.add('is-clip');
      }
    }

    // DOM writes only when the value changes: tick runs at 40 fps
    let lastMeta = '', lastPct = -1;
    function setMeta() {
      const m = phase === 'lock' || phase === 'fade' || phase === 'idle' ? 'ORIGIN LOCKED'
        : lost ? 'HOP LOST' : `HOP ${Math.min(locked + 1, N)}/${N}`;
      if (m !== lastMeta) { lastMeta = m; ctx.meta(m); }
    }
    function setProgress() {
      const p = N > 1 ? (locked - 1 + (phase === 'hop' ? arcT : phase === 'dwell' ? 1 : 0)) / (N - 1) : 0;
      const pct = phase === 'lock' || phase === 'fade' || phase === 'idle' ? 100 : Math.round(U.clamp(p, 0, 1) * 100);
      if (pct === lastPct) return;
      lastPct = pct;
      fillEl.style.width = pct + '%';
      pctEl.textContent = pct + '%';
    }

    /* --------------------------------------------------------------- events */
    // the clock running down pushes the trace harder
    let urgent = false;
    ctx.on('ui:trace', () => { fast = true; buildChain(); setMeta(); setProgress(); });
    ctx.on('mission:reset', () => { fast = false; urgent = false; buildChain(); setMeta(); setProgress(); });
    ctx.on('mission:phase', (d) => {
      urgent = d.phase === 'critical' || d.phase === 'final';
      ctx.frame.classList.toggle('is-urgent', urgent);
    });
    ctx.on('intrusion', () => {
      if (phase === 'hop' && locked < N - 1 && !lost) {
        lost = { t: 0 };
        if (rows[locked]) rows[locked].el.classList.add('is-lost');
        setMeta();
        ctx.flash(ctx.reducedMotion ? 'warn' : 'alert', 600);
        if (ctx.audio) ctx.audio.chirp(700, 180, 220, 'sawtooth', 0.03);
      }
    });

    /* ---------------------------------------------------------------- render */
    let cx = 0, cy = 0, R = 0;
    function project(v, cosY, sinY, cosP, sinP, lift) {
      const x1 = v.x * cosY + v.z * sinY;
      const z1 = -v.x * sinY + v.z * cosY;
      const y1 = v.y;
      const y2 = y1 * cosP - z1 * sinP;
      const z2 = y1 * sinP + z1 * cosP;
      const f = R * (lift || 1);
      return { x: cx + f * x1, y: cy - f * y2, z: z2 };
    }

    function draw() {
      cv.clear();
      const gw = cv.w, gh = cv.h;
      // leave room outside the limb for the bezel ticks
      cx = gw / 2; cy = gh / 2; R = Math.min(gw, gh) * (Math.min(gw, gh) > 110 ? 0.42 : 0.45);
      gk = U.clamp(R / 110, 1, 2.2);
      const cosY = Math.cos(yaw), sinY = Math.sin(yaw), cosP = Math.cos(pitch), sinP = Math.sin(pitch);

      // globe disc + limb
      const disc = g.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R);
      disc.addColorStop(0, ctx.rgba('holo', 0.10));
      disc.addColorStop(0.7, ctx.rgba('bg2', 0.55));
      disc.addColorStop(1, ctx.rgba('bg', 0.7));
      g.fillStyle = disc;
      g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
      g.strokeStyle = ctx.rgba('holo', 0.5); g.lineWidth = 1;
      g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = ctx.rgba(urgent ? 'threat' : 'holo', urgent ? 0.3 : 0.12);
      g.beginPath(); g.arc(cx, cy, R + 2.5 * gk, 0, Math.PI * 2); g.stroke();
      // outer bezel: rotating tick ring gives the globe instrument chrome
      if (R + 8.5 * gk < Math.min(gw, gh) / 2) {
        const ticks = R > 160 ? 96 : 48, major = ticks / 8, r0 = R + 4 * gk, spin = ctx.reducedMotion ? 0 : yaw * 0.5;
        g.strokeStyle = ctx.rgba('holo2', 0.35);
        g.beginPath();
        for (let i = 0; i < ticks; i++) {
          const a = spin + (i / ticks) * Math.PI * 2, len = (i % major === 0 ? 4 : 2) * gk;
          const ca = Math.cos(a), sa = Math.sin(a);
          g.moveTo(cx + ca * r0, cy + sa * r0);
          g.lineTo(cx + ca * (r0 + len), cy + sa * (r0 + len));
        }
        g.stroke();
      }

      // graticule (front hemisphere only) — kept faint so the land reads
      g.strokeStyle = ctx.rgba('holo2', 0.09);
      g.lineWidth = 1;
      for (const line of grat) {
        g.beginPath();
        let pen = false;
        for (const v of line) {
          const p = project(v, cosY, sinY, cosP, sinP);
          if (p.z > 0.02) { if (pen) g.lineTo(p.x, p.y); else { g.moveTo(p.x, p.y); pen = true; } }
          else pen = false;
        }
        g.stroke();
      }

      // land dots — brighter than the grid, strong limb darkening for roundness
      // (projection inlined: no per-dot allocation)
      const fine = R > 230;
      const pts = fine ? landFine : landPts;
      const dsc = fine ? gk * 0.75 : gk;
      const sBig = (R > 90 ? 2 : 1.5) * dsc, sSmall = (R > 90 ? 1.5 : 1.1) * dsc;
      for (let i = 0; i < pts.length; i++) {
        const v = pts[i];
        const z1 = -v.x * sinY + v.z * cosY;
        const z2 = v.y * sinP + z1 * cosP;
        if (z2 <= 0.05) continue;
        const li = Math.round((Math.pow(z2, 0.7) * 0.85 + 0.12) * alpha * (LV - 1));
        if (li <= 0) continue;
        const x1 = v.x * cosY + v.z * sinY;
        const y2 = v.y * cosP - z1 * sinP;
        const s = z2 > 0.55 ? sBig : sSmall;
        g.fillStyle = (z2 > 0.6 ? lutIce : lutHolo)[li];
        g.fillRect(cx + R * x1 - s / 2, cy - R * y2 - s / 2, s, s);
      }

      // arcs
      g.lineCap = 'round';
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        const full = i < locked - 1;
        const active = i === locked - 1 && (phase === 'hop' || phase === 'dwell');
        if (!full && !active) continue;
        const upto = full || phase === 'dwell' ? 1 : arcT;
        drawArc(seg, upto, cosY, sinY, cosP, sinP, i === N - 2);
      }

      // city dots + pulses
      for (let i = 0; i < N; i++) {
        const reached = i < locked || phase === 'lock' || phase === 'fade' || phase === 'idle';
        const p = project(chain[i].vec, cosY, sinY, cosP, sinP);
        if (p.z <= 0.02) continue;
        const isT = i === N - 1;
        const col = isT ? 'threat' : reached ? 'ice' : 'holo';
        g.fillStyle = ctx.rgba(col, (reached ? 0.95 : 0.4) * alpha);
        g.beginPath(); g.arc(p.x, p.y, (isT ? 2.6 : 1.8) * gk, 0, Math.PI * 2); g.fill();
        if (reached && !isT) {
          g.strokeStyle = ctx.rgba('holo', 0.5 * alpha); g.lineWidth = 1;
          g.beginPath(); g.arc(p.x, p.y, 3.4 * gk, 0, Math.PI * 2); g.stroke();
        }
      }

      // reach pulses
      for (const pl of pulses) {
        const p = project(pl.vec, cosY, sinY, cosP, sinP);
        if (p.z <= 0.02) continue;
        const t = pl.t / 900;
        g.strokeStyle = ctx.rgba('holo', (1 - t) * 0.8 * alpha); g.lineWidth = 1;
        g.beginPath(); g.arc(p.x, p.y, (3 + t * 10) * gk, 0, Math.PI * 2); g.stroke();
      }

      // current hop label
      if (layout !== 'mini' && (phase === 'hop' || phase === 'dwell')) {
        const h = chain[Math.min(locked, N - 1)];
        const p = project(h.vec, cosY, sinY, cosP, sinP);
        if (p.z > 0.02) {
          const fz = Math.round(Math.min(15, 9 * gk));
          g.font = `600 ${fz}px "Chakra Petch", "Segoe UI", sans-serif`;
          g.textAlign = 'left'; g.textBaseline = 'middle';
          const tx = p.x + 6 * gk, label = h.name;
          const tw = g.measureText(label).width;
          const bx = tx + tw > cv.w - 2 ? Math.max(2, p.x - 6 * gk - tw) : tx;
          g.fillStyle = ctx.rgba('bg', 0.6); g.fillRect(bx - 2, p.y - fz * 0.67, tw + 4, fz * 1.34);
          g.fillStyle = ctx.rgba('holo', 0.95); g.fillText(label, bx, p.y);
        }
      }

      // intrusion reroute X
      if (lost) {
        const seg = segs[locked - 1];
        const s = seg[Math.min(seg.length - 1, Math.round(arcT * (seg.length - 1)))];
        const p = project(s, cosY, sinY, cosP, sinP, 1 + 0.12 * Math.sin(arcT * Math.PI));
        g.strokeStyle = ctx.rgba('threat', 0.95); g.lineWidth = 1.6 * Math.min(gk, 1.6);
        const d = 4 * gk;
        g.beginPath(); g.moveTo(p.x - d, p.y - d); g.lineTo(p.x + d, p.y + d); g.moveTo(p.x + d, p.y - d); g.lineTo(p.x - d, p.y + d); g.stroke();
      }

      // origin lock ring on PARIS
      if (phase === 'lock' || phase === 'fade') {
        const p = project(chain[N - 1].vec, cosY, sinY, cosP, sinP);
        if (p.z > -0.2) {
          const pu = ctx.reducedMotion ? 0.5 : (phaseT % 900) / 900;
          const q = gk, lw = Math.min(gk, 1.6);
          g.save();
          g.shadowBlur = 8; g.shadowColor = ctx.color.threat;
          g.strokeStyle = ctx.rgba('threat', (0.9 - pu * 0.6) * alpha); g.lineWidth = 1.6 * lw;
          g.beginPath(); g.arc(p.x, p.y, (6 + pu * 12) * q, 0, Math.PI * 2); g.stroke();
          g.strokeStyle = ctx.rgba('threat', 0.9 * alpha); g.lineWidth = 1.4 * lw;
          g.beginPath(); g.arc(p.x, p.y, 6 * q, 0, Math.PI * 2); g.stroke();
          // crosshair
          g.beginPath(); g.moveTo(p.x - 10 * q, p.y); g.lineTo(p.x - 4 * q, p.y); g.moveTo(p.x + 4 * q, p.y); g.lineTo(p.x + 10 * q, p.y);
          g.moveTo(p.x, p.y - 10 * q); g.lineTo(p.x, p.y - 4 * q); g.moveTo(p.x, p.y + 4 * q); g.lineTo(p.x, p.y + 10 * q); g.stroke();
          g.restore();
          if (layout !== 'mini') drawLockPlate();
        }
      }

      // scan sweep line across globe (subtle life)
      if (!ctx.reducedMotion) {
        const sweep = ((phaseT + yaw * 200) % 2600) / 2600;
        const sy = cy - R + sweep * R * 2;
        g.strokeStyle = ctx.rgba('holo', 0.06); g.lineWidth = 1;
        g.beginPath(); g.moveTo(cx - R, sy); g.lineTo(cx + R, sy); g.stroke();
      }
    }

    // "ORIGIN LOCATED" stamp on a plate over the lower globe, with coordinates when there is room
    function drawLockPlate() {
      const two = R > 50;
      const fz = Math.round(Math.min(16, 9 * gk));
      const ph = two ? Math.round(fz * 2.8) : fz + 5;
      g.font = `700 ${fz}px "Chakra Petch", "Segoe UI", sans-serif`;
      try { g.letterSpacing = ((1.4 * fz) / 9).toFixed(1) + 'px'; } catch (e) { /* older canvas: no tracking */ }
      const tw = g.measureText('ORIGIN LOCATED').width;
      const pw = Math.min(cv.w - 4, tw + (12 * fz) / 9);
      const px = cx - pw / 2, py = Math.min(cy + R * 0.5, cv.h - ph - 2);
      g.fillStyle = ctx.rgba('bg', 0.82 * alpha);
      g.fillRect(px, py, pw, ph);
      g.strokeStyle = ctx.rgba('threat', 0.85 * alpha); g.lineWidth = 1;
      g.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
      g.fillStyle = ctx.rgba('threat', alpha);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('ORIGIN LOCATED', cx + 0.7, py + (two ? fz * 0.83 : ph / 2 + 0.5));
      try { g.letterSpacing = '0px'; } catch (e) { /* see above */ }
      if (two) {
        g.font = `500 ${fz}px "JetBrains Mono", Consolas, monospace`;
        g.fillStyle = ctx.rgba('ice', 0.9 * alpha);
        g.fillText(`${ORIGIN.lat.toFixed(3)}N ${ORIGIN.lon.toFixed(3)}E`, cx, py + fz * 2);
      }
    }

    // RTT strip: one bar per hop. Done hops hold their latency, the hop being probed jitters
    // until it answers, pending hops are empty slots, PARIS is red.
    // Tall strips split: per-hop bars on top, the cumulative-RTT history fills the rest.
    const UIF = (px) => `600 ${px}px "Chakra Petch", "Segoe UI", sans-serif`;
    const MONOF = (px) => `500 ${px}px "JetBrains Mono", Consolas, monospace`;
    function drawRtt() {
      const w = rcv.w, h = rcv.h;
      rcv.clear();
      if (h < 14 || !N) return;
      const ox = cols ? 12 : 0; // side-by-side with the list: a rule and some air on the left
      if (cols) {
        rg.strokeStyle = ctx.rgba('holo', 0.14); rg.lineWidth = 1;
        rg.beginPath(); rg.moveTo(0.5, 0); rg.lineTo(0.5, h); rg.stroke();
      }
      const fz = Math.round(9 * k);
      const split = h >= 150 * Math.min(k, 1.3) && w - ox >= 90;
      const barH = split ? Math.round(Math.min(h * 0.42, 100 * k + 30)) : h;
      drawBars(ox, 0, w - ox, barH, fz);
      if (split) drawHist(ox, barH + Math.round(8 * k), w - ox, h, fz);
    }

    function drawBars(ox, oy, w, h, fz) {
      // short strip: one line, label left, sum right, bars in between
      const compact = h < 34 * k;
      const reachedAll = phase === 'lock' || phase === 'fade' || phase === 'idle';
      let maxL = 1, sum = 0;
      for (let i = 0; i < N; i++) {
        maxL = Math.max(maxL, chain[i].latency);
        if (i < locked || reachedAll) sum += chain[i].latency;
      }
      const ly = oy + (compact ? h / 2 + 0.5 : 1);
      rg.textBaseline = compact ? 'middle' : 'top';
      rg.font = UIF(fz);
      rg.textAlign = 'left';
      rg.fillStyle = ctx.rgba('dim', 1);
      const lab = w < 120 || compact ? 'RTT' : 'RTT / HOP';
      rg.fillText(lab, ox + 1, ly);
      const labW = compact ? rg.measureText(lab).width + 6 : 0;
      rg.font = MONOF(fz);
      rg.textAlign = 'right';
      rg.fillStyle = ctx.rgba(reachedAll ? 'threat' : 'holo', 0.9);
      const sumTxt = (w < 120 ? '' : 'Σ ') + sum + 'ms';
      rg.fillText(sumTxt, ox + w - 1, ly);
      const sumW = compact ? rg.measureText(sumTxt).width + 6 : 0;

      // roomy strips get hop numbers under the bars and latencies over them
      const tags = !compact && h >= 70 * k;
      const top = oy + (compact ? 4 : fz + 5 + (tags ? fz + 2 : 0)), base = oy + h - 2 - (tags ? fz + 3 : 0), span = base - top;
      const x0 = ox + 1 + labW, bwAll = w - 2 - labW - sumW;
      if (bwAll < N * 2 || span < 2) return;
      // bars never get chunkier than ~64px: wide strips spread them out instead
      let bw = Math.max(1, (bwAll - (compact ? 1 : 2) * (N - 1)) / N);
      bw = Math.min(bw, 64 * k);
      const gap = N > 1 ? (bwAll - bw * N) / (N - 1) : 0;
      // quarter grid lines
      rg.strokeStyle = ctx.rgba('faint', 0.8);
      rg.lineWidth = 1;
      rg.beginPath();
      for (let q = 1; q < 4; q++) { const y = Math.round(top + (span * q) / 4) + 0.5; rg.moveTo(x0, y); rg.lineTo(x0 + bwAll, y); }
      rg.stroke();
      const vals = tags && bw >= fz * 0.6 * 3 + 2;
      for (let i = 0; i < N; i++) {
        const x = x0 + i * (bw + gap);
        const done = i < locked || reachedAll, cur = !done && i === locked;
        const isT = i === N - 1;
        let v = chain[i].latency / maxL;
        if (cur) v *= ctx.reducedMotion ? 0.5 : 0.35 + 0.5 * Math.abs(Math.sin(phaseT * 0.011 + i));
        const bh = done || cur ? Math.max(2, v * span) : 2;
        const col = isT ? 'threat' : cur ? 'ice' : done ? 'holo2' : 'faint';
        rg.fillStyle = ctx.rgba(col, done ? 0.75 * Math.max(alpha, 0.4) : cur ? 0.9 : 1);
        rg.fillRect(x, base - bh, bw, bh);
        if (done) { rg.fillStyle = ctx.rgba(isT ? 'threat' : 'holo', 0.95); rg.fillRect(x, base - bh, bw, 1); }
        if (tags) {
          rg.font = MONOF(fz);
          rg.textAlign = 'center';
          rg.textBaseline = 'top';
          rg.fillStyle = ctx.rgba(isT ? 'threat' : cur ? 'ice' : 'dim', done || cur ? 0.9 : 0.5);
          rg.fillText(U.pad(i + 1), x + bw / 2, base + 3);
          if (vals && done) {
            rg.textBaseline = 'bottom';
            rg.fillStyle = ctx.rgba(isT ? 'threat' : 'text', 0.85);
            rg.fillText(String(chain[i].latency), x + bw / 2, base - bh - 2);
          }
        }
      }
      rg.strokeStyle = ctx.rgba('holo', 0.35);
      rg.beginPath(); rg.moveTo(x0, base + 0.5); rg.lineTo(x0 + bwAll, base + 0.5); rg.stroke();
    }

    function drawHist(ox, y0, w, y1, fz) {
      if (y1 - y0 < 40) return;
      const reachedAll = phase === 'lock' || phase === 'fade' || phase === 'idle';
      rg.strokeStyle = ctx.rgba('faint', 0.9); rg.lineWidth = 1;
      rg.beginPath(); rg.moveTo(ox, Math.round(y0) + 0.5); rg.lineTo(ox + w, Math.round(y0) + 0.5); rg.stroke();
      rg.textBaseline = 'top';
      rg.font = UIF(fz);
      rg.textAlign = 'left';
      rg.fillStyle = ctx.rgba('dim', 1);
      rg.fillText(w < 150 ? 'Σ RTT' : 'CUMULATIVE RTT · LIVE', ox + 1, y0 + 4);
      rg.font = MONOF(fz);
      rg.textAlign = 'right';
      rg.fillStyle = ctx.rgba(reachedAll ? 'threat' : 'ice', 0.9);
      rg.fillText(Math.round(hist[(histHead + HIST - 1) % HIST]) + 'ms', ox + w - 1, y0 + 4);
      const top = y0 + fz + 12, bot = y1 - 2, span = bot - top;
      if (span < 16) return;
      const x0 = ox + 1, pw = w - 2;
      rg.strokeStyle = ctx.rgba('faint', 0.8);
      rg.beginPath();
      for (let q = 1; q < 4; q++) { const y = Math.round(top + (span * q) / 4) + 0.5; rg.moveTo(x0, y); rg.lineTo(x0 + pw, y); }
      rg.stroke();
      // the origin level: the chain's full round trip
      const vmax = totalLat * 1.15;
      const oyL = Math.round(bot - (totalLat / vmax) * span) + 0.5;
      rg.strokeStyle = ctx.rgba('threat', 0.4);
      rg.setLineDash([3, 3]);
      rg.beginPath(); rg.moveTo(x0, oyL); rg.lineTo(x0 + pw, oyL); rg.stroke();
      rg.setLineDash([]);
      rg.font = UIF(fz);
      rg.textAlign = 'left'; rg.textBaseline = 'bottom';
      rg.fillStyle = ctx.rgba('threat', 0.75);
      rg.fillText('ORIGIN', x0 + 2, oyL - 2);
      // newest sample at the right edge; ~3px per sample
      const n = Math.min(HIST, Math.max(8, Math.floor(pw / 3)));
      const step = pw / (n - 1);
      rg.strokeStyle = ctx.rgba('dim', 0.6);
      rg.beginPath();
      for (let j = 0; j < n; j++) {
        if ((histCount - n + j) % 10) continue; // scrolling 1 s ticks
        const x = Math.round(x0 + pw - (n - 1 - j) * step) + 0.5;
        rg.moveTo(x, bot); rg.lineTo(x, bot - 3);
      }
      rg.stroke();
      const col = reachedAll ? 'threat' : 'holo';
      rg.beginPath();
      let lx = 0, lyv = 0;
      for (let j = 0; j < n; j++) {
        const v = hist[(histHead - n + j + HIST) % HIST];
        lx = x0 + pw - (n - 1 - j) * step;
        lyv = bot - U.clamp(v / vmax, 0, 1) * span;
        if (j) rg.lineTo(lx, lyv); else rg.moveTo(lx, lyv);
      }
      rg.strokeStyle = ctx.rgba(col, 0.85); rg.lineWidth = 1.2;
      rg.stroke();
      rg.lineTo(x0 + pw, bot); rg.lineTo(x0, bot); rg.closePath();
      rg.fillStyle = ctx.rgba(col, 0.08);
      rg.fill();
      rg.lineWidth = 1;
      rg.fillStyle = ctx.rgba('ice', 0.95);
      rg.fillRect(lx - 1.5, lyv - 1.5, 3, 3);
    }

    // running round trip to the hop frontier; the probed hop jitters until it answers
    function sampleRtt() {
      if (phase === 'idle') return 2 + Math.random() * 3;
      const reachedAll = phase === 'lock' || phase === 'fade';
      let s = 0;
      for (let i = 0; i < N; i++) if (i < locked || reachedAll) s += chain[i].latency;
      if (phase === 'fade') return Math.max(2, s * alpha) + Math.random() * 2;
      if (!reachedAll && locked < N) {
        const cur = chain[locked].latency;
        s += phase === 'dwell' ? cur : cur * (0.35 + 0.5 * Math.abs(Math.sin(phaseT * 0.011 + locked)));
      }
      return s + (Math.random() - 0.5) * 4;
    }

    function drawArc(seg, upto, cosY, sinY, cosP, sinP, isFinal) {
      const col = isFinal ? 'threat' : 'holo';
      g.strokeStyle = ctx.rgba(col, 0.75 * alpha);
      g.lineWidth = 1.4 * Math.min(gk, 1.8);
      g.beginPath();
      let pen = false, headP = null;
      for (const s of seg) {
        if (s.t > upto + 0.0001) break;
        const lift = 1 + 0.14 * Math.sin(s.t * Math.PI);
        const p = project(s, cosY, sinY, cosP, sinP, lift);
        headP = p;
        if (p.z > -0.15) { if (pen) g.lineTo(p.x, p.y); else { g.moveTo(p.x, p.y); pen = true; } }
        else pen = false;
      }
      g.stroke();
      // animated dash head
      if (upto < 1 && headP && headP.z > -0.15) {
        g.save();
        g.shadowBlur = 6; g.shadowColor = ctx.color[col === 'threat' ? 'threat' : 'holo'];
        g.fillStyle = ctx.rgba('ice', alpha);
        g.beginPath(); g.arc(headP.x, headP.y, 1.8 * gk, 0, Math.PI * 2); g.fill();
        g.restore();
      }
    }

    /* ------------------------------------------------------------------ tick */
    function advance(ms) {
      phaseT += ms;
      if (phase === 'hop') {
        // ease rotation toward current destination
        arcT += ms / DUR.arc;
        if (lost) {
          lost.t += ms;
          if (lost.t > 640) { reroute(); lost = null; }
          return;
        }
        if (arcT >= 1) { arcT = 1; phase = 'dwell'; dwellT = 0; pulses.push({ vec: chain[locked].vec, t: 0 }); emitHop(locked); }
      } else if (phase === 'dwell') {
        dwellT += ms;
        if (dwellT >= DUR.dwell) {
          locked++;
          updateRows();
          if (locked >= N) enterLock();
          else { phase = 'hop'; arcT = 0; targetYaw = -chain[locked].lon * D2R; targetPitch = U.clamp(chain[locked].lat * D2R * 0.55, -0.42, 0.5); }
        }
      } else if (phase === 'lock') {
        if (phaseT >= DUR.lock) { phase = 'fade'; phaseT = 0; }
      } else if (phase === 'fade') {
        alpha = 1 - phaseT / DUR.fade;
        if (phaseT >= DUR.fade) { phase = 'idle'; phaseT = 0; alpha = 0; }
      } else if (phase === 'idle') {
        if (phaseT >= DUR.idle) { fast = false; buildChain(); }
      }
    }

    function enterLock() {
      phase = 'lock'; phaseT = 0;
      targetYaw = -chain[N - 1].lon * D2R;
      targetPitch = U.clamp(chain[N - 1].lat * D2R * 0.55, -0.42, 0.5);
      ctx.frame.classList.add('is-locked');
      updateRows();
      ctx.emit('trace:complete', { city: ORIGIN.name, lat: ORIGIN.lat, lon: ORIGIN.lon, hops: N });
      ctx.alert('crit', 'TRACE COMPLETE — ORIGIN PARIS');
      ctx.flash('ok', 1200);
      if (ctx.audio) ctx.audio.chirp(300, 1200, 400, 'sine', 0.04);
    }

    // Layout per size: pick the arrangement, the UI scale and the globe box, then make sure every
    // hop row fits (shrink the globe a little, then fold the address lines). Layout reads here are
    // fine: this runs on resize and font load only.
    function setGlobe(px) {
      globeEl.style.width = px + 'px';
      globeEl.style.height = px + 'px';
    }
    const listOver = () => listEl.scrollHeight - listEl.clientHeight;
    function relayout(w, h) {
      if (!w || !h) return;
      const F = ctx.frame;
      layout = w < 120 ? 'mini' : w / h > 1.05 ? 'wide' : 'tall';
      F.classList.toggle('is-wide', layout === 'wide');
      F.classList.toggle('is-mini', layout === 'mini');
      // square the globe box so the canvas is round
      let gsz = Math.floor(layout === 'wide' ? Math.min(h - 8, w * 0.5) : layout === 'mini' ? Math.min(w - 4, h * 0.34) : Math.min(w - 8, h * 0.44));
      const sideW = layout === 'wide' ? w - gsz - 12 : w - 8;
      const sideH = layout === 'wide' ? h - 8 : h - gsz - 12;
      k = layout === 'mini' ? 1 : U.clamp(Math.min(sideW / 300, sideH / 260), 1, 1.6);
      cols = layout === 'wide' && sideW >= 620 && sideW / sideH > 1.5;
      root.style.setProperty('--tr-k', k.toFixed(3));
      F.classList.toggle('is-cols', cols);
      F.classList.remove('is-compact');
      setGlobe(gsz);
      let over = listOver();
      if (over > 1 && layout !== 'wide') {
        const min = Math.floor(layout === 'mini' ? Math.min(w - 4, h * 0.26) : Math.min(w - 8, h * 0.3));
        const g2 = Math.max(min, gsz - Math.ceil(over));
        if (g2 < gsz) {
          gsz = g2;
          setGlobe(gsz);
          over = listOver();
        }
      }
      if (over > 1) F.classList.add('is-compact');
      // core fitted the canvases to the old boxes before calling us; refit or the globe is stretched
      cv.fit();
      scrollRows();
      rcv.fit(); // after the rows settle: the strip only gets the height the list leaves over
    }
    ctx.on('fonts:ready', () => relayout(ctx.width, ctx.height));

    return {
      fps: 40,
      resize(w, h) {
        if (!started) { started = true; buildChain(); }
        relayout(w, h);
        setMeta();
        setProgress();
        updateRows();
      },
      tick(now, dt) {
        const ms = dt * 1000 * spd();
        advance(ms);
        histAcc += dt * 1000;
        while (histAcc >= 100) {
          histAcc -= 100;
          hist[histHead] = sampleRtt();
          histHead = (histHead + 1) % HIST;
          histCount++;
        }
        // rotation easing + gentle idle drift
        // hold PARIS dead-centre while locked, then let the globe idle-spin
        if (phase === 'idle' || phase === 'fade') targetYaw -= (ctx.reducedMotion ? 0.05 : 0.12) * dt;
        yaw = U.damp(yaw, targetYaw, 2.6, dt);
        pitch = U.damp(pitch, targetPitch, 2.2, dt);
        for (let i = pulses.length - 1; i >= 0; i--) { pulses[i].t += ms; if (pulses[i].t > 900) pulses.splice(i, 1); }
        setMeta();
        setProgress();
        draw();
        drawRtt();
      },
    };
  });
})();
