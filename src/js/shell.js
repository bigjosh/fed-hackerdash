/* FEDLIGHT · shell chrome
   Top bar clocks + chips, intel ticker, gesture reticle + light trail, panel tilt,
   intrusion banner, zero-hour takeover, hotkeys, boot flicker. */
(() => {
  'use strict';

  const { bus, util: U, mission: M, state: S, words: W } = HD;
  const R = HD.rng(HD.seed ^ 0x51f15e);
  const $ = (sel) => document.querySelector(sel);
  const root = document.documentElement;

  /* ------------------------------------------------------------ clocks/chips */

  const clkUtc = $('#clk-utc');
  const clkLocal = $('#clk-local');
  const chipCd = $('#chip-cd b');
  const chipThreat = $('#chip-threat b');
  const chipUplink = $('#chip-uplink');
  const chipSat = $('#chip-sat b');
  const chipTarget = $('#chip-target b');
  const PHASE_LABEL = { elevated: 'ELEVATED', severe: 'SEVERE', critical: 'CRITICAL', final: 'IMMINENT', zero: 'ZERO HOUR' };

  let lastCd = '';
  function tickClocks() {
    const d = new Date();
    clkUtc.textContent = U.fmtClock(d, 0);
    clkLocal.textContent = U.fmtClock(d, HD.tz.offset);
    const t = U.fmtDuration(M.remaining());
    const cd = t.h !== '00' ? `${t.h}:${t.m}:${t.s}` : `${t.m}:${t.s}`;
    if (cd !== lastCd) chipCd.textContent = lastCd = cd;
  }
  setInterval(tickClocks, 250);
  tickClocks();

  bus.on('mission:phase', ({ phase }) => {
    chipThreat.textContent = PHASE_LABEL[phase] || phase.toUpperCase();
  });
  setInterval(() => {
    chipSat.textContent = `${R.int(3, 6)}/6`;
  }, 7000);
  bus.on('enhance:result', (d) => {
    chipTarget.textContent = `${S.target.codename} · ${(d && d.plate) || S.target.plate}`;
  });
  bus.on('mission:reset', () => {
    chipTarget.textContent = S.target.codename;
  });

  /* ------------------------------------------------------------------ ticker */

  const run = $('#ticker-run');
  const track = run.parentElement;
  const tickerItems = [];
  const priority = [];
  let tx = 0;
  let runW = 0;
  let trackW = track.clientWidth;
  new ResizeObserver(() => (trackW = track.clientWidth)).observe(track);

  const AMBIENT = [
    () => `PREFECTURE DISPATCH: ${R.pick(W.units)} REPOSITIONING TO ${R.pick(W.districts)}`,
    () => `SAT KH-9 NEXT PASS T+${R.int(3, 19)}M · CLOUD COVER ${R.int(4, 88)}%`,
    () => `DARKNET CHATTER +${R.int(12, 340)}% ON ${R.pick(W.handles)} MIRRORS`,
    () => `GRID OPERATOR: SUBSTATION ${U.randHex(4, R)} LOAD ${R.int(61, 99)}%`,
    () => `BOLO ${U.randHex(3, R)}-${R.int(100, 999)}: ALIAS "${R.pick(S.target.aliases)}" FLAGGED IN ${R.pick(W.cities).name}`,
    () => `TRAFFIC MESH: ${R.int(280, 411)}/412 CAMERAS UNDER NULLSEC CONTROL`,
    () => `EURONEXT PARIS HALTED — ${R.int(40, 900)} TRADING ALGOS FROZEN`,
    () => `WEATHER: ACID RAIN ADVISORY · VISIBILITY ${R.int(80, 600)} M`,
    () => `CIPHER CELL: KEYSPACE ${R.int(31, 97)}.${R.int(0, 9)}% EXHAUSTED`,
    () => `COMMS ${R.pick(W.units)}: "EYES ON ${R.pick(W.streets)}. HOLDING."`,
    () => `PACKET STORM ON BACKBONE ${U.randHex(2, R)}:${U.randHex(2, R)} — ${R.int(2, 40)} GBPS`,
    () => `MÉTRO LIGNE ${R.int(1, 14)} SUSPENDED · SIGNAL FAULT AT ${R.pick(W.districts)}`,
    () => `DRONE NET: ${R.int(6, 24)} UNITS AIRBORNE OVER ${R.pick(W.districts)}`,
    () => `FIELD NOTE: AGENT FED ON SITE IN ${R.pick(W.districts)} · ALL UNITS DEFER`,
    () => `HQ: FED CALLED IT AGAIN · ${S.target.codename} ROUTE CONFIRMED`,
    () => `MAKER CELL: FED LEARNS TO MAKE · FIELD JIG #${R.int(12, 99)} PRINTED OVERNIGHT`,
    () => `CREW CALL 06:00 · FEDHAT ON SET SINCE '92 · QUIET ON THE GRID`,
    () => `K-9 KONA ON SCENT NEAR ${R.pick(W.streets)} · TAIL WAGGING · HANDLER CONFIRMS`,
    () => 'CLASSIFIEDS INTERCEPT · BOX 1997 · "EYES LIKE A PUPPY DOG, LIPS MADE FOR SIN" · REPLY: LEWIS',
    () => `FLIGHT DESK: PASSENGER LEWIS · BOARDING GROUP A · OPEN SEATING · CLEARED FOR ${W.city}`,
    () => (HD.assets && HD.assets.fedhead ? 'ARCHIVE 26·06·1997 · FEDHEAD PROTOCOL DORMANT · ↑↑↓↓←→←→BA' : `SAT KH-9 HANDSHAKE ${U.randHex(4, R)} OK`),
  ];

  let lastAmbient = -1;
  function appendTicker() {
    let next = priority.shift();
    if (!next) {
      let k = R.int(0, AMBIENT.length - 1);
      if (k === lastAmbient) k = (k + 1) % AMBIENT.length;
      lastAmbient = k;
      next = { text: AMBIENT[k](), level: '' };
    }
    const el = U.el('span', 'ticker-item' + (next.level ? ' is-' + next.level : ''), next.text);
    run.appendChild(el);
    const w = el.offsetWidth;
    tickerItems.push({ el, w });
    runW += w;
  }
  function pushTicker(text, level = '') {
    priority.push({ text, level });
    if (priority.length > 6) priority.shift();
  }
  pushTicker(`OPERATION ${S.op} ONLINE · TARGET ${S.target.codename} ACQUIRED ON ${W.city} GRID`, 'warn');

  HD.onFrame((now, dt) => {
    tx -= (HD.reducedMotion ? 28 : 64) * dt;
    while (tickerItems.length && tx + tickerItems[0].w < 0) {
      const it = tickerItems.shift();
      it.el.remove();
      tx += it.w;
      runW -= it.w;
    }
    let guard = 0;
    while (tx + runW < trackW + 240 && guard++ < 8) appendTicker();
    run.style.transform = `translate3d(${tx.toFixed(1)}px,0,0)`;
  });

  bus.on('alert', (a) => {
    if (!a || !a.msg) return;
    if (a.level === 'crit' || a.level === 'warn') pushTicker(`${a.source ? a.source + ' · ' : ''}${a.msg}`, a.level);
  });

  /* ---------------------------------------------------------- reticle + trail */

  const fine = !!(window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches);
  const reticle = $('#reticle');
  const reticleLabel = $('#reticle-label');
  const trail = $('#fx-trail');
  const tctx = trail.getContext('2d');
  const pts = [];
  let px = -200;
  let py = -200;
  let hoverCode = '';
  let labelAt = 0;
  let trailDirty = false;

  function sizeTrail() {
    trail.width = innerWidth;
    trail.height = innerHeight;
  }
  sizeTrail();
  addEventListener('resize', sizeTrail);

  if (fine && !HD.solo) root.classList.add('has-reticle');

  addEventListener(
    'pointermove',
    (e) => {
      px = e.clientX;
      py = e.clientY;
      if (e.pointerType === 'mouse' && !HD.reducedMotion) pts.push({ x: px, y: py, t: performance.now() });
      const hot = e.target.closest && e.target.closest('button, a, input, textarea, select, [data-hot]');
      reticle.classList.toggle('is-hot', !!hot);
      const panel = e.target.closest && e.target.closest('.panel');
      hoverCode = panel ? (panel.querySelector('.panel-code') || {}).textContent || '' : '';
      reticle.classList.toggle('is-grab', editing && !!panel && !hot);
      tilt(panel, e);
    },
    { passive: true }
  );
  addEventListener('pointerleave', () => tilt(null));
  document.addEventListener('mouseleave', () => {
    px = py = -200;
    tilt(null);
  });

  addEventListener('pointerdown', (e) => {
    reticle.classList.add('is-down');
    if (HD.reducedMotion) return;
    for (const cls of ['ripple', 'ripple r2']) {
      const r = U.el('i', cls);
      r.style.left = e.clientX + 'px';
      r.style.top = e.clientY + 'px';
      r.addEventListener('animationend', () => r.remove());
      document.body.appendChild(r);
    }
  });
  addEventListener('pointerup', () => reticle.classList.remove('is-down'));

  HD.onFrame((now) => {
    reticle.style.transform = `translate3d(${px}px,${py}px,0)`;
    if (now - labelAt > 90) {
      labelAt = now;
      const verb = gest ? (gest.type === 'resize' ? 'SIZE' : 'MOVE') : editing ? 'GRAB' : 'LOCK';
      reticleLabel.textContent = `X${U.pad(Math.max(0, px | 0), 4)} Y${U.pad(Math.max(0, py | 0), 4)}${hoverCode ? '\n' + hoverCode + ' // ' + verb : ''}`;
    }
    // holo-glove light trail
    while (pts.length && now - pts[0].t > 420) pts.shift();
    if (pts.length < 2) {
      if (trailDirty) {
        tctx.clearRect(0, 0, trail.width, trail.height);
        trailDirty = false;
      }
      return;
    }
    tctx.clearRect(0, 0, trail.width, trail.height);
    tctx.lineCap = 'round';
    tctx.lineJoin = 'round';
    const heavy = gest ? 2.3 : 1; // the glove glows hotter while it holds something
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const life = 1 - (now - b.t) / 420;
      tctx.strokeStyle = HD.rgba(gest ? 'ice' : 'holo', (gest ? 0.65 : 0.5) * life);
      tctx.lineWidth = (1 + 5 * life) * heavy;
      tctx.beginPath();
      tctx.moveTo(a.x, a.y);
      tctx.lineTo(b.x, b.y);
      tctx.stroke();
    }
    trailDirty = true;
  });

  /* ---------------------------------------------------------------- tilt */

  let tiltPanel = null;
  let tiltRect = null;
  function tilt(panel, e) {
    if (HD.reducedMotion || !fine) return;
    if (editing) panel = null; // the glass lies flat on the light table
    if (panel !== tiltPanel) {
      if (tiltPanel) {
        tiltPanel.classList.remove('is-hover');
        tiltPanel.style.removeProperty('--rx');
        tiltPanel.style.removeProperty('--ry');
      }
      tiltPanel = panel;
      tiltRect = panel ? panel.getBoundingClientRect() : null;
      if (panel) panel.classList.add('is-hover');
    }
    if (!panel || !e || !tiltRect) return;
    const nx = (e.clientX - tiltRect.left) / tiltRect.width - 0.5;
    const ny = (e.clientY - tiltRect.top) / tiltRect.height - 0.5;
    panel.style.setProperty('--ry', (nx * 2.4).toFixed(2) + 'deg');
    panel.style.setProperty('--rx', (-ny * 2.4).toFixed(2) + 'deg');
  }
  addEventListener('scroll', () => (tiltRect = tiltPanel ? tiltPanel.getBoundingClientRect() : null), { passive: true });

  /* ---------------------------------------------------------------- layout */
  // LAYOUT mode (fixed desktop layout only): drag any panel to rearrange it, pull the glove nodes on
  // its edges to resize it, all on a 24x12 snap grid. The arrangement is kept per viewer. Theatrics:
  // the glass table tips back, panels lift off it and swing with their velocity, afterimages trail,
  // the landing zone lights up, drops thunk and shockwave, resizes get CAD rulers and rematerialise.

  const grid = $('#grid');
  const hdEl = $('#hd');
  const btnLayout = $('#btn-layout');
  const layBar = $('#lay-bar');
  const layCv = $('#lay-fx');
  const lctx = layCv.getContext('2d');
  const COLS = 24;
  const ROWS = 12;
  const LAY_KEY = 'fedlight.layout.v1';
  const LAY_PAD = 28; // the fx canvas overhangs the grid so rulers and afterimages can leave it
  // the stock arrangement, in snap units (the CSS grid-template-areas at double resolution)
  const DEFAULT_LAYOUT = {
    terminal: [0, 0, 6, 6], map: [6, 0, 12, 8], countdown: [18, 0, 6, 2], enhance: [18, 2, 6, 6],
    netgraph: [0, 6, 4, 4], trace: [4, 6, 2, 6], decrypt: [6, 8, 4, 4], spectrum: [10, 8, 4, 2],
    sysmon: [10, 10, 4, 2], radar: [14, 8, 4, 4], face: [18, 8, 2, 4], dossier: [20, 8, 4, 4], alerts: [0, 10, 4, 2],
  };
  const MIN_SIZE = { map: [6, 4], terminal: [4, 3], enhance: [4, 3], countdown: [4, 2], trace: [2, 4], face: [2, 3], radar: [3, 3], dossier: [3, 3], netgraph: [3, 3] };
  const minOf = (id) => MIN_SIZE[id] || [3, 2];
  const lpanels = [...grid.querySelectorAll('.panel[data-panel]')].filter((p) => DEFAULT_LAYOUT[p.dataset.panel]);
  const byId = {};
  for (const p of lpanels) byId[p.dataset.panel] = p;
  const IDS = lpanels.map((p) => p.dataset.panel);
  const wideMq = matchMedia('(min-width: 1280px) and (min-height: 700px)');
  const canLayout = () => !HD.solo && wideMq.matches;
  // damped spring step response: overshoots ~15% at 0.26 s, settled by ~1 s
  const springy = (t) => (t >= 1.2 ? 1 : 1 - Math.exp(-7 * t) * Math.cos(12 * t));

  let layout = null; // {id: {x, y, w, h, z}} while a custom arrangement is live
  let editing = false;
  let zTop = 0;
  let gest = null; // the move/resize gesture in progress
  let lastMovedId = 'map';
  let flourishUntil = 0;
  let G = { x: 0, y: 0, w: 1, h: 1, gap: 6, px: 1, py: 1 };
  const anims = new Map(); // panel -> running transform animation
  const fx = { rings: [], pulses: [], cells: [], sparks: [], ghosts: [], enterAt: 0, exitAt: -1e9, origin: { x: 0, y: 0 }, exitOrigin: { x: 0, y: 0 }, zoneAt: 0, zone: null };

  const cloneDefault = () => {
    const o = {};
    IDS.forEach((id, i) => {
      const [x, y, w, h] = DEFAULT_LAYOUT[id];
      o[id] = { x, y, w, h, z: i + 1 };
    });
    return o;
  };
  const sameAsDefault = (l) =>
    IDS.every((id) => {
      const r = l[id];
      const d = DEFAULT_LAYOUT[id];
      return r.x === d[0] && r.y === d[1] && r.w === d[2] && r.h === d[3];
    });
  function validLayout(l) {
    return (
      !!l &&
      IDS.every((id) => {
        const r = l[id];
        if (!r || ![r.x, r.y, r.w, r.h, r.z].every(Number.isInteger)) return false;
        const [mw, mh] = minOf(id);
        return r.w >= mw && r.h >= mh && r.x >= 0 && r.y >= 0 && r.x + r.w <= COLS && r.y + r.h <= ROWS;
      })
    );
  }
  function loadLayout() {
    try {
      const raw = JSON.parse(localStorage.getItem(LAY_KEY) || 'null');
      if (raw && raw.v === 1 && validLayout(raw.panels)) return raw.panels;
    } catch (err) {
      /* storage blocked or corrupt: stock grid */
    }
    return null;
  }
  function saveLayout() {
    try {
      if (!layout || sameAsDefault(layout)) localStorage.removeItem(LAY_KEY);
      else localStorage.setItem(LAY_KEY, JSON.stringify({ v: 1, panels: layout }));
    } catch (err) {
      /* a per-viewer convenience only */
    }
  }

  function applyPanel(id) {
    const r = layout[id];
    const p = byId[id];
    p.style.setProperty('--lx', r.x);
    p.style.setProperty('--ly', r.y);
    p.style.setProperty('--lw', r.w);
    p.style.setProperty('--lh', r.h);
    p.style.setProperty('--lz', r.z); // stacking applies only inside the custom-layout media block
  }
  function applyLayout() {
    if (!layout) {
      root.classList.remove('has-custom-layout');
      for (const p of lpanels) {
        for (const v of ['--lx', '--ly', '--lw', '--lh', '--lz']) p.style.removeProperty(v);
      }
      return;
    }
    root.classList.add('has-custom-layout');
    IDS.forEach(applyPanel);
    zTop = Math.max(...IDS.map((id) => layout[id].z));
  }
  function raise(id) {
    if (layout[id].z === zTop) return;
    layout[id].z = ++zTop;
    if (zTop > 80) {
      // renumber so z-index stays under the fx canvas
      IDS.slice()
        .sort((a, b) => layout[a].z - layout[b].z)
        .forEach((k, i) => (layout[k].z = i + 1));
      zTop = IDS.length;
      IDS.forEach(applyPanel);
    } else applyPanel(id);
  }

  function geo() {
    const hr = hdEl.getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(root).getPropertyValue('--gap')) || 6;
    const w = grid.clientWidth;
    const h = grid.clientHeight;
    G = { x: hr.left + grid.offsetLeft, y: hr.top + grid.offsetTop, w, h, gap, px: (w + gap) / COLS, py: (h + gap) / ROWS };
    return G;
  }
  const uRect = (r) => ({ x: r.x * G.px, y: r.y * G.py, w: r.w * G.px - G.gap, h: r.h * G.py - G.gap });
  const rectsOf = () => {
    const o = {};
    for (const p of lpanels) o[p.dataset.panel] = p.getBoundingClientRect();
    return o;
  };
  function sizeLayFx() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = G.w + LAY_PAD * 2;
    const h = G.h + LAY_PAD * 2;
    layCv.width = Math.round(w * dpr);
    layCv.height = Math.round(h * dpr);
    layCv.style.width = w + 'px';
    layCv.style.height = h + 'px';
    layCv.__dpr = dpr;
  }
  function tagText(id) {
    const r = layout[id];
    const code = (byId[id].querySelector('.panel-code') || {}).textContent || id;
    return `${code} · ${r.w}×${r.h} · X${U.pad(r.x)} Y${U.pad(r.y)}`;
  }
  function updateTag(id) {
    const t = byId[id].querySelector('.lay-tag');
    if (t) t.textContent = tagText(id);
  }

  /* ---- transform animations: FLIP morphs, the held card, throws, settles, shivers */

  function setAnim(p, a) {
    anims.set(p, a);
    p.classList.add('is-lay-anim');
  }
  // settled: the morph ran to completion, so the panel now sits at its real geometry
  function endAnim(p, settled) {
    const a = anims.get(p);
    if (!a) return;
    anims.delete(p);
    p.style.transform = '';
    p.style.transformOrigin = '';
    p.classList.remove('is-lay-anim');
    if (a.kind === 'glide') {
      // backstop: a flight dropped without docking must not leave the grab costume behind
      p.classList.remove('is-grabbed');
      titleRestore(p);
      markOverlaps(a.id, null);
      syncDragClass();
    }
    if (settled) bus.emit('layout:settled', { id: p.dataset.panel });
  }
  const flying = () => [...anims.values()].some((o) => o.kind === 'glide');
  function syncDragClass() {
    if (!(gest && gest.type === 'move') && !flying()) grid.classList.remove('is-dragging');
  }
  // land any card still in flight where it is (before an action that would otherwise cancel it)
  function landGlides(except) {
    const now = performance.now();
    for (const [q, a] of [...anims]) if (a.kind === 'glide' && q !== except) dock(a, now);
  }
  const flipXf = (a, k) => {
    const sx = Math.max(0.15, a.sx + (1 - a.sx) * k);
    const sy = Math.max(0.15, a.sy + (1 - a.sy) * k);
    return `translate3d(${(a.dx * (1 - k)).toFixed(1)}px,${(a.dy * (1 - k)).toFixed(1)}px,0) scale(${sx.toFixed(4)},${sy.toFixed(4)})`;
  };
  function startFlip(p, from, to, delay = 0) {
    if (!from || !to || !to.width || !to.height || HD.reducedMotion) return;
    const a = { kind: 'flip', t0: performance.now() + delay, dx: from.left - to.left, dy: from.top - to.top, sx: from.width / to.width, sy: from.height / to.height };
    if (Math.abs(a.dx) < 0.5 && Math.abs(a.dy) < 0.5 && Math.abs(a.sx - 1) < 0.003 && Math.abs(a.sy - 1) < 0.003) return;
    setAnim(p, a);
    p.style.transformOrigin = '0 0';
    p.style.transform = flipXf(a, 0); // same frame as the layout change: no flash at the new spot
  }
  // Morph every panel from `before` to wherever the current layout puts it (one forced layout).
  function flipAll(before, delayOf) {
    for (const p of lpanels) endAnim(p);
    const after = rectsOf();
    lpanels.forEach((p, i) => startFlip(p, before[p.dataset.panel], after[p.dataset.panel], delayOf ? delayOf(p, i) : 0));
  }
  const cardXf = (offX, offY, ox, oy, rx, ry, rz, sx, sy) =>
    `translate3d(${offX.toFixed(1)}px,${offY.toFixed(1)}px,0) translate(${ox.toFixed(1)}px,${oy.toFixed(1)}px) perspective(1100px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) rotateZ(${rz.toFixed(2)}deg) scale(${sx.toFixed(4)},${sy.toFixed(4)}) translate(${(-ox).toFixed(1)}px,${(-oy).toFixed(1)}px)`;

  // A held glass card swings about the grab point: it leans into its velocity on underdamped springs.
  function swing(a, dt) {
    const hx = U.clamp((a.h / 2 - a.oy) / (a.h / 2 || 1), -1, 1);
    const wx = U.clamp((a.w / 2 - a.ox) / (a.w / 2 || 1), -1, 1);
    const tz = U.clamp(a.svx * 0.006 * hx - a.svy * 0.006 * wx, -9, 9);
    const ty = U.clamp(a.svx * 0.011, -13, 13);
    const tx = U.clamp(-a.svy * 0.011, -13, 13);
    for (let left = dt; left > 1e-4; left -= 1 / 120) {
      const h = Math.min(1 / 120, left);
      a.vrz += (170 * (tz - a.rz) - 13 * a.vrz) * h;
      a.vry += (170 * (ty - a.ry) - 13 * a.vry) * h;
      a.vrx += (170 * (tx - a.rx) - 13 * a.vrx) * h;
      a.rz += a.vrz * h;
      a.ry += a.vry * h;
      a.rx += a.vrx * h;
    }
  }
  function releaseVelocity(a, now) {
    const s = a.samples;
    if (s.length < 2 || now - s[s.length - 1].t > 70) return { vx: 0, vy: 0 };
    const f = s[0];
    const l = s[s.length - 1];
    const span = Math.max(16, l.t - f.t) / 1000;
    return { vx: (l.x - f.x) / span, vy: (l.y - f.y) / span };
  }
  function zoneTrack(a, now) {
    const r = layout[a.id];
    const zx = U.clamp(Math.round(a.x / G.px), 0, COLS - r.w);
    const zy = U.clamp(Math.round(a.y / G.py), 0, ROWS - r.h);
    if (!a.zone || zx !== a.zone.x || zy !== a.zone.y) {
      const first = !a.zone;
      a.zone = { x: zx, y: zy, w: r.w, h: r.h };
      fx.zoneAt = now;
      if (!first) HD.audio.beep(2400, 14, 'square', 0.01);
      markOverlaps(a.id, a.zone);
    }
  }
  function ghostTrack(a, now, speed) {
    if (HD.reducedMotion || speed < 140 || now - a.ghostAt < 34) return;
    a.ghostAt = now;
    fx.ghosts.push({ x: a.x, y: a.y, w: a.w, h: a.h, ox: a.ox, oy: a.oy, rz: a.rz, t: now });
    if (fx.ghosts.length > 16) fx.ghosts.shift();
  }

  function stepAnim(p, a, now, dt) {
    if (a.kind === 'flip') {
      const t = (now - a.t0) / 1000;
      if (t >= 1.15) return endAnim(p, true);
      p.style.transform = flipXf(a, t < 0 ? 0 : springy(t));
      return;
    }
    if (a.kind === 'drag' || a.kind === 'glide') {
      let vx;
      let vy;
      if (a.kind === 'drag') {
        a.x = U.clamp(a.gx - a.ox, -a.w * 0.6, G.w - a.w * 0.4);
        a.y = U.clamp(a.gy - a.oy, -a.h * 0.3, G.h - 24);
        const s = a.samples;
        const l = s[s.length - 1];
        const span = (l.t - s[0].t) / 1000;
        const fresh = now - l.t < 60;
        vx = fresh && span > 0.008 ? (l.x - s[0].x) / span : 0;
        vy = fresh && span > 0.008 ? (l.y - s[0].y) / span : 0;
        a.lift = HD.reducedMotion ? 1 : U.ease.outBack(Math.min(1, (now - a.t0) / 240));
      } else {
        // thrown: coast with friction, bounce off the table edge, then dock
        a.x += a.gvx * dt;
        a.y += a.gvy * dt;
        const f = Math.exp(-4.6 * dt);
        a.gvx *= f;
        a.gvy *= f;
        const wall = (x, y) => {
          fx.rings.push({ x, y, t0: now, max: 70, dur: 420, c: 'neon' });
          HD.audio.beep(180, 40, 'square', 0.02);
        };
        // only an outward-bound card bounces, so one thrown from past the edge coasts back in
        if ((a.x < 0 && a.gvx < 0) || (a.x + a.w > G.w && a.gvx > 0)) {
          a.gvx = -a.gvx * 0.5;
          wall(a.x < 0 ? 0 : G.w, a.y + a.h / 2);
        }
        if ((a.y < 0 && a.gvy < 0) || (a.y + a.h > G.h && a.gvy > 0)) {
          a.gvy = -a.gvy * 0.5;
          wall(a.x + a.w / 2, a.y < 0 ? 0 : G.h);
        }
        vx = a.gvx;
        vy = a.gvy;
        if (Math.hypot(a.gvx, a.gvy) < 110 || now - a.gt0 > 700) {
          dock(a, now);
          return;
        }
      }
      a.svx = U.damp(a.svx, vx, 14, dt);
      a.svy = U.damp(a.svy, vy, 14, dt);
      if (!HD.reducedMotion) swing(a, dt);
      const s = 1 + 0.045 * a.lift;
      p.style.transform = cardXf(a.x - a.bx, a.y - a.by, a.ox, a.oy, a.rx, a.ry, a.rz, s, s);
      zoneTrack(a, now);
      ghostTrack(a, now, Math.hypot(a.svx, a.svy));
      return;
    }
    if (a.kind === 'settle') {
      const t = (now - a.t0) / 1000;
      if (t >= 1.1) return endAnim(p, true);
      const k = 1 - springy(t);
      // an impact squash as the card lands in its slot
      const sq = a.squash && t < 0.28 && !HD.reducedMotion ? Math.sin((t / 0.28) * Math.PI) * 0.022 : 0;
      const s = 1 + 0.045 * a.lift * k;
      p.style.transform = cardXf(a.offX * k, a.offY * k, a.ox, a.oy, a.rx * k, a.ry * k, a.rz * k, s * (1 + sq * 0.6), s * (1 - sq));
      return;
    }
    if (a.kind === 'shiver') {
      const t = (now - a.t0) / 1000;
      if (t >= 0.45) return endAnim(p);
      const amp = a.amp * Math.exp(-8 * t);
      p.style.transform = `translate3d(${(Math.sin(t * 75) * amp).toFixed(2)}px,${(Math.cos(t * 58) * amp * 0.5).toFixed(2)}px,0)`;
    }
  }

  /* ---- gestures */

  function markOverlaps(id, z) {
    for (const k of IDS) {
      if (k === id) continue;
      const r = layout[k];
      const hit = z && r.x < z.x + z.w && z.x < r.x + r.w && r.y < z.y + z.h && z.y < r.y + r.h;
      byId[k].classList.toggle('is-overlap', !!hit);
    }
  }
  function titleSwap(p, text) {
    const t = p.querySelector('.panel-title');
    if (!t) return;
    if (!t.dataset.orig) t.dataset.orig = t.textContent;
    U.scramble(t, text, { duration: 260, chars: U.CHARS.glyph });
  }
  function titleRestore(p) {
    const t = p.querySelector('.panel-title');
    if (!t || !t.dataset.orig) return;
    U.scramble(t, t.dataset.orig, { duration: 420 });
  }

  function startMove(p, e, now) {
    const id = p.dataset.panel;
    const prev = anims.get(p);
    const vr = prev ? p.getBoundingClientRect() : null; // read before endAnim wipes the transform
    const caught = prev && prev.kind === 'glide' ? prev : null;
    if (caught) anims.delete(p); // caught mid-air: keep the grab costume, swap the flight for the hand
    else endAnim(p);
    raise(id);
    const b = uRect(layout[id]);
    let vx = b.x;
    let vy = b.y;
    if (caught) (vx = caught.x), (vy = caught.y);
    else if (vr) (vx = vr.left - G.x), (vy = vr.top - G.y);
    const gx = e.clientX - G.x;
    const gy = e.clientY - G.y;
    gest = {
      type: 'move', kind: 'drag', id, p, pid: e.pointerId, t0: now, bx: b.x, by: b.y, w: b.w, h: b.h,
      ox: U.clamp(gx - vx, 0, b.w), oy: U.clamp(gy - vy, 0, b.h), x: vx, y: vy, gx, gy, sgx: gx, sgy: gy, svx: 0, svy: 0,
      rx: caught ? caught.rx : 0, ry: caught ? caught.ry : 0, rz: caught ? caught.rz : 0,
      vrx: caught ? caught.vrx : 0, vry: caught ? caught.vry : 0, vrz: caught ? caught.vrz : 0,
      lift: 0, ghostAt: 0, moved: !!caught, zone: null,
      samples: [{ x: gx, y: gy, t: now }],
    };
    if (caught) gest.t0 = now - 240; // already lifted
    fx.zone = null;
    setAnim(p, gest);
    p.style.transformOrigin = '0 0';
    p.classList.add('is-grabbed');
    grid.classList.add('is-dragging');
    reticle.classList.add('is-grabbing');
    titleSwap(p, 'RELOCATING…');
    HD.audio.chirp(260, 900, 90, 'sine', 0.03);
  }
  function startResize(p, edge, e, now) {
    const id = p.dataset.panel;
    endAnim(p);
    raise(id);
    const b = uRect(layout[id]);
    const gx = e.clientX - G.x;
    const gy = e.clientY - G.y;
    gest = {
      type: 'resize', id, p, pid: e.pointerId, edge, t0: now, l: b.x, t: b.y, r: b.x + b.w, b: b.y + b.h,
      gx, gy, sgx: gx, sgy: gy, cur: b, snap: { ...layout[id] }, moved: false, atMin: false,
    };
    p.classList.add('is-resizing');
    grid.classList.add('is-sizing');
    titleSwap(p, 'RECALIBRATING…');
    HD.audio.chirp(900, 420, 110, 'triangle', 0.03);
  }
  function resizeTrack(a) {
    const dx = a.gx - a.sgx;
    const dy = a.gy - a.sgy;
    const [mw, mh] = minOf(a.id);
    const minW = mw * G.px - G.gap;
    const minH = mh * G.py - G.gap;
    const e = a.edge;
    let { l, t, r, b } = a;
    if (e.includes('w')) l = U.clamp(a.l + dx, 0, a.r - minW);
    if (e.includes('e')) r = U.clamp(a.r + dx, a.l + minW, G.w);
    if (e.includes('n')) t = U.clamp(a.t + dy, 0, a.b - minH);
    if (e.includes('s')) b = U.clamp(a.b + dy, a.t + minH, G.h);
    a.cur = { x: l, y: t, w: r - l, h: b - t };
    let x0 = Math.round(l / G.px);
    let x1 = Math.round((r + G.gap) / G.px);
    let y0 = Math.round(t / G.py);
    let y1 = Math.round((b + G.gap) / G.py);
    if (x1 - x0 < mw) e.includes('w') ? (x0 = x1 - mw) : (x1 = x0 + mw);
    if (y1 - y0 < mh) e.includes('n') ? (y0 = y1 - mh) : (y1 = y0 + mh);
    x0 = U.clamp(x0, 0, COLS - mw);
    y0 = U.clamp(y0, 0, ROWS - mh);
    x1 = U.clamp(x1, x0 + mw, COLS);
    y1 = U.clamp(y1, y0 + mh, ROWS);
    const s = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    a.atMin = s.w === mw || s.h === mh;
    if (s.x !== a.snap.x || s.y !== a.snap.y || s.w !== a.snap.w || s.h !== a.snap.h) {
      a.snap = s;
      fx.zoneAt = performance.now();
      HD.audio.beep(1900 + s.w * s.h * 6, 14, 'square', 0.01);
      markOverlaps(a.id, s);
    }
  }

  function dockFx(id, label, now, quiet) {
    const r = uRect(layout[id]);
    const L = layout[id];
    const p = byId[id];
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    fx.cells.push({ x: L.x, y: L.y, w: L.w, h: L.h, t0: now });
    if (!HD.reducedMotion) {
      const max = Math.hypot(r.w, r.h) * 0.62 + 40;
      for (let i = 0; i < 3; i++) fx.rings.push({ x: cx, y: cy, t0: now + i * 90, max: max * (1 + i * 0.25), dur: 760, c: i === 1 ? 'ice' : 'holo' });
      fx.pulses.push({ r, t0: now });
      const per = 2 * (r.w + r.h);
      for (let i = 0; i < 44; i++) {
        let d = R.range(0, per);
        let x;
        let y;
        let nx = 0;
        let ny = 0;
        if (d < r.w) (x = r.x + d), (y = r.y), (ny = -1);
        else if ((d -= r.w) < r.h) (x = r.x + r.w), (y = r.y + d), (nx = 1);
        else if ((d -= r.h) < r.w) (x = r.x + r.w - d), (y = r.y + r.h), (ny = 1);
        else (d -= r.w), (x = r.x), (y = r.y + r.h - d), (nx = -1);
        const v = R.range(60, 260);
        fx.sparks.push({ x, y, vx: nx * v + R.range(-40, 40), vy: ny * v + R.range(-40, 40), s: R.pick([1.5, 2, 2, 3]), c: R.pick(['holo', 'ice', 'holo', 'neon']), life: R.range(0.35, 0.8), t: 0 });
      }
      if (fx.sparks.length > 400) fx.sparks.splice(0, fx.sparks.length - 400);
      remat(p, 0);
    }
    if (!quiet) {
      const st = U.el('span', 'lay-stamp', `${label} · ${L.w}×${L.h}`);
      p.appendChild(st);
      setTimeout(() => st.remove(), 1300);
      HD.audio.beep(95, 150, 'sine', 0.07);
      HD.audio.beep(190, 50, 'square', 0.018);
    }
  }
  function remat(p, delay) {
    const d = U.el('div', 'lay-remat');
    d.style.setProperty('--d', `${delay | 0}ms`);
    p.appendChild(d);
    setTimeout(() => d.remove(), 720 + delay);
    try {
      p.animate(
        [
          { boxShadow: '-5px 0 0 rgba(255,42,109,0.8), 5px 0 0 rgba(95,243,255,0.8), 0 0 42px rgba(95,243,255,0.55)' },
          { boxShadow: '-2px 0 0 rgba(255,42,109,0.4), 2px 0 0 rgba(95,243,255,0.4), 0 0 20px rgba(95,243,255,0.25)', offset: 0.4 },
          { boxShadow: '0 10px 30px rgba(0,0,0,0.5)' },
        ],
        { duration: 460, delay, easing: 'ease-out' }
      );
    } catch (err) {
      /* WAAPI missing: the scan wipe alone still reads */
    }
  }
  function flashPanel(p, delay, cls = '') {
    const f = U.el('i', ('lay-flash ' + cls).trim());
    f.style.setProperty('--d', `${delay | 0}ms`);
    p.appendChild(f);
    setTimeout(() => f.remove(), 700 + delay);
  }
  function layoutChanged(id) {
    if (id) lastMovedId = id;
    IDS.forEach(updateTag);
    saveLayout();
    bus.emit('layout:change', { id: id || null });
  }

  function dock(a, now) {
    const r = layout[a.id];
    const p = a.p;
    const nx = U.clamp(Math.round(a.x / G.px), 0, COLS - r.w);
    const ny = U.clamp(Math.round(a.y / G.py), 0, ROWS - r.h);
    const changed = nx !== r.x || ny !== r.y;
    r.x = nx;
    r.y = ny;
    applyPanel(a.id);
    const nb = uRect(r);
    if (HD.reducedMotion) endAnim(p);
    else setAnim(p, { kind: 'settle', t0: now, offX: a.x - nb.x, offY: a.y - nb.y, ox: a.ox, oy: a.oy, rx: a.rx, ry: a.ry, rz: a.rz, lift: a.lift, squash: a.moved });
    p.classList.remove('is-grabbed');
    if (gest === a) gest = null;
    syncDragClass();
    titleRestore(p);
    const hit = [...grid.querySelectorAll('.panel.is-overlap')];
    markOverlaps(a.id, null);
    if (!a.moved) return;
    for (const o of hit) if (!anims.has(o) && !HD.reducedMotion) setAnim(o, { kind: 'shiver', t0: now + 60, amp: 3.2 });
    dockFx(a.id, changed ? 'DOCKED' : 'RETURNED', now);
    layoutChanged(a.id);
  }
  function endResize(a, now) {
    const p = a.p;
    const r = layout[a.id];
    const s = a.snap;
    p.classList.remove('is-resizing');
    grid.classList.remove('is-sizing');
    titleRestore(p);
    const hit = [...grid.querySelectorAll('.panel.is-overlap')];
    markOverlaps(a.id, null);
    gest = null;
    if (s.x === r.x && s.y === r.y && s.w === r.w && s.h === r.h) return;
    const from = p.getBoundingClientRect();
    Object.assign(r, { x: s.x, y: s.y, w: s.w, h: s.h });
    applyPanel(a.id);
    startFlip(p, from, p.getBoundingClientRect());
    for (const o of hit) if (!anims.has(o) && !HD.reducedMotion) setAnim(o, { kind: 'shiver', t0: now + 120, amp: 2.6 });
    dockFx(a.id, 'RESIZED', now);
    layoutChanged(a.id);
  }
  function endGesture(e) {
    if (!gest || (e && e.pointerId !== gest.pid)) return;
    const a = gest;
    const now = performance.now();
    reticle.classList.remove('is-grabbing');
    if (a.type === 'resize') return endResize(a, now);
    const v = releaseVelocity(a, now);
    if (a.moved && e && e.type === 'pointerup' && !HD.reducedMotion && Math.hypot(v.vx, v.vy) > 650) {
      // a throw: the card keeps flying, the gesture is over
      a.kind = 'glide';
      a.gvx = U.clamp(v.vx, -4200, 4200);
      a.gvy = U.clamp(v.vy, -4200, 4200);
      a.gt0 = now;
      gest = null;
      HD.audio.chirp(700, 240, 160, 'sine', 0.025);
      return;
    }
    dock(a, now);
  }

  grid.addEventListener('pointerdown', (e) => {
    if (!editing || gest || e.button > 0) return;
    const now = performance.now();
    if (now < flourishUntil) return;
    const p = e.target.closest && e.target.closest('.panel');
    if (!p || !byId[p.dataset.panel]) return;
    e.preventDefault();
    p.focus({ preventScroll: true });
    geo();
    const h = e.target.closest('.lay-h');
    landGlides(h ? null : p);
    if (h) startResize(p, h.dataset.edge, e, now);
    else startMove(p, e, now);
  });
  addEventListener(
    'pointermove',
    (e) => {
      if (!gest || e.pointerId !== gest.pid) return;
      const now = performance.now();
      gest.gx = e.clientX - G.x;
      gest.gy = e.clientY - G.y;
      if (!gest.moved && Math.hypot(gest.gx - gest.sgx, gest.gy - gest.sgy) > 4) gest.moved = true;
      if (gest.type === 'resize') return resizeTrack(gest);
      const s = gest.samples;
      s.push({ x: gest.gx, y: gest.gy, t: now });
      while (s.length > 2 && now - s[0].t > 90) s.shift();
    },
    { passive: true }
  );
  addEventListener('pointerup', endGesture);
  addEventListener('pointercancel', endGesture);
  addEventListener('blur', () => endGesture(null));

  /* ---- keyboard: arrows nudge the focused panel a cell, shift+arrows resize it */

  function nudge(id, dx, dy, dw, dh) {
    landGlides();
    const r = layout[id];
    const [mw, mh] = minOf(id);
    const n = { w: U.clamp(r.w + dw, mw, COLS), h: U.clamp(r.h + dh, mh, ROWS) };
    n.x = U.clamp(r.x + dx, 0, COLS - n.w);
    n.y = U.clamp(r.y + dy, 0, ROWS - n.h);
    const p = byId[id];
    const now = performance.now();
    raise(id);
    if (n.x === r.x && n.y === r.y && n.w === r.w && n.h === r.h) {
      // hit the edge of the table: a dull knock and a shiver
      HD.audio.beep(120, 60, 'square', 0.025);
      if (!anims.has(p) && !HD.reducedMotion) setAnim(p, { kind: 'shiver', t0: now, amp: 3 });
      return;
    }
    const from = p.getBoundingClientRect();
    Object.assign(r, n);
    applyPanel(id);
    endAnim(p);
    startFlip(p, from, p.getBoundingClientRect());
    fx.cells.push({ x: r.x, y: r.y, w: r.w, h: r.h, t0: now });
    if (dw || dh) {
      if (now - (p.__stampAt || 0) > 450) {
        p.__stampAt = now;
        remat(p, 0);
      }
      HD.audio.beep(1500 + r.w * r.h * 8, 22, 'square', 0.014);
    } else HD.audio.beep(2100, 16, 'square', 0.012);
    layoutChanged(id);
  }

  /* ---- entering / leaving LAYOUT mode */

  function decorate() {
    for (const p of lpanels) {
      if (p.querySelector(':scope > .lay-deco')) continue;
      const d = U.el('div', 'lay-deco');
      for (const edge of ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se']) {
        const h = U.el('i', `lay-h lay-h-${edge}`);
        h.dataset.edge = edge;
        h.setAttribute('data-hot', '');
        d.appendChild(h);
      }
      d.appendChild(U.el('span', 'lay-tag', tagText(p.dataset.panel)));
      p.appendChild(d);
      p.tabIndex = 0;
    }
  }
  function undecorate() {
    for (const p of lpanels) {
      const d = p.querySelector(':scope > .lay-deco');
      if (d) d.remove();
      p.removeAttribute('tabindex');
      p.classList.remove('is-overlap', 'is-grabbed', 'is-resizing');
    }
    grid.classList.remove('is-dragging', 'is-sizing');
  }
  function gridPoint(cx, cy) {
    return { x: U.clamp(cx - G.x, 0, G.w), y: U.clamp(cy - G.y, 0, G.h) };
  }
  function flourish(frames, ms) {
    if (HD.reducedMotion) return;
    try {
      grid.animate(frames, { duration: ms, easing: 'cubic-bezier(0.3, 0.7, 0.2, 1)' });
    } catch (err) {
      /* no WAAPI: skip the flourish */
    }
  }

  function enterLayout(origin) {
    if (editing || !canLayout()) return;
    tilt(null);
    editing = true;
    const a = document.activeElement;
    if (a && a !== document.body && a.blur) a.blur();
    const before = rectsOf();
    if (!layout) layout = cloneDefault();
    applyLayout();
    root.classList.add('is-layout');
    flipAll(before);
    decorate();
    geo();
    sizeLayFx();
    layCv.hidden = false;
    const now = performance.now();
    const br = btnLayout.getBoundingClientRect();
    fx.origin = origin || gridPoint(br.left + br.width / 2, br.top + br.height);
    fx.enterAt = now;
    fx.exitAt = -1e9;
    flourishUntil = now + (HD.reducedMotion ? 0 : 520);
    // the glass table tips back like a slide on a light box, then settles
    flourish(
      [
        { transform: 'none' },
        { transform: 'perspective(1800px) rotateX(11deg) scale(0.945)', offset: 0.38 },
        { transform: 'perspective(1800px) rotateX(-2deg) scale(1.006)', offset: 0.74 },
        { transform: 'none' },
      ],
      780
    );
    for (const p of lpanels) {
      const r = uRect(layout[p.dataset.panel]);
      const d = Math.hypot(r.x + r.w / 2 - fx.origin.x, r.y + r.h / 2 - fx.origin.y);
      if (!HD.reducedMotion) flashPanel(p, d / 2.6);
    }
    btnLayout.setAttribute('aria-pressed', 'true');
    btnLayout.querySelector('b').textContent = 'LOCK';
    layBar.hidden = false;
    HD.audio.chirp(220, 1320, 380, 'sine', 0.035);
    setTimeout(() => HD.audio.beep(1760, 60, 'square', 0.015), 380);
    bus.emit('layout:mode', { editing: true });
    bus.emit('alert', { level: 'info', msg: 'LAYOUT MODE · GRID UNLOCKED · PANELS FREE', source: 'SYS', panel: 'shell', time: Date.now() });
  }

  function exitLayout(quiet) {
    if (!editing) return;
    if (gest) endGesture(null);
    landGlides();
    editing = false;
    const now = performance.now();
    root.classList.remove('is-layout');
    undecorate();
    layBar.hidden = true;
    btnLayout.setAttribute('aria-pressed', 'false');
    btnLayout.querySelector('b').textContent = 'EDIT';
    const lr = layout && layout[lastMovedId] ? uRect(layout[lastMovedId]) : { x: G.w / 2, y: G.h / 2, w: 0, h: 0 };
    fx.exitOrigin = { x: lr.x + lr.w / 2, y: lr.y + lr.h / 2 };
    fx.exitAt = now;
    if (layout && sameAsDefault(layout)) {
      // the stock arrangement: hand the panels back to the CSS grid
      const before = rectsOf();
      layout = null;
      applyLayout();
      flipAll(before);
    }
    saveLayout();
    bus.emit('layout:mode', { editing: false });
    bus.emit('layout:change', { id: null });
    if (quiet) {
      layCv.hidden = true;
      return;
    }
    if (!HD.reducedMotion) {
      fx.rings.push({ x: fx.exitOrigin.x, y: fx.exitOrigin.y, t0: now, max: Math.hypot(G.w, G.h), dur: 900, c: 'phosphor' });
      for (const p of lpanels) {
        const r = p.getBoundingClientRect();
        const d = Math.hypot(r.left + r.width / 2 - G.x - fx.exitOrigin.x, r.top + r.height / 2 - G.y - fx.exitOrigin.y);
        flashPanel(p, d / 3.2, 'is-lock');
      }
      flourish([{ transform: 'none' }, { transform: 'perspective(1800px) rotateX(3deg) scale(0.99)', offset: 0.35 }, { transform: 'none' }], 520);
    }
    [784, 988, 1319].forEach((f, i) => setTimeout(() => HD.audio.beep(f, 110, 'sine', 0.03), i * 90));
    pushTicker(`LAYOUT COMMITTED · ${IDS.length} PANELS DOCKED`);
    bus.emit('alert', { level: 'info', msg: `LAYOUT COMMITTED · ${IDS.length} PANELS DOCKED`, source: 'SYS', panel: 'shell', time: Date.now() });
  }

  function resetLayout() {
    if (!editing) return;
    if (gest) endGesture(null);
    landGlides();
    const before = rectsOf();
    layout = cloneDefault();
    applyLayout();
    geo();
    const c = { x: G.w / 2, y: G.h / 2 };
    const order = IDS.map((id) => {
      const r = uRect(layout[id]);
      return Math.hypot(r.x + r.w / 2 - c.x, r.y + r.h / 2 - c.y);
    });
    flipAll(before, (p, i) => order[i] / 3.4);
    const now = performance.now();
    if (!HD.reducedMotion) {
      lpanels.forEach((p, i) => remat(p, order[i] / 3.4 + 380));
      fx.rings.push({ x: c.x, y: c.y, t0: now, max: Math.hypot(G.w, G.h) * 0.6, dur: 800, c: 'ice' });
    }
    for (const id of IDS) fx.cells.push({ ...layout[id], t0: now + 300 });
    HD.audio.chirp(1400, 180, 260, 'sawtooth', 0.02);
    setTimeout(() => HD.audio.chirp(180, 1100, 320, 'sine', 0.03), 280);
    layoutChanged(null);
    bus.emit('alert', { level: 'info', msg: 'LAYOUT RESET · STOCK GRID RESTORED', source: 'SYS', panel: 'shell', time: Date.now() });
  }

  function layoutKey(e, k) {
    if (k === 'l') {
      if (!canLayout()) return false;
      editing ? exitLayout() : enterLayout(px > 0 ? gridPoint(px, py) : null);
      return true;
    }
    if (!editing) return false;
    if (k === 'escape') {
      // an overlay on top (zero hour, the protocol) takes Escape first
      if (!takeover.hidden || !protocol.hidden) return false;
      exitLayout();
      return true;
    }
    const dir = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] }[k];
    if (!dir) return false;
    e.preventDefault();
    if (gest) return true;
    const f = document.activeElement && document.activeElement.closest && document.activeElement.closest('.panel[data-panel]');
    const id = (f && byId[f.dataset.panel] && f.dataset.panel) || lastMovedId;
    geo();
    if (e.shiftKey) nudge(id, 0, 0, dir[0], dir[1]);
    else nudge(id, dir[0], dir[1], 0, 0);
    return true;
  }

  btnLayout.addEventListener('click', () => (editing ? exitLayout() : enterLayout()));
  $('#lay-reset').addEventListener('click', resetLayout);
  $('#lay-lock').addEventListener('click', () => exitLayout());
  bus.on('ui:layout', () => (editing ? exitLayout() : enterLayout()));
  const onWide = () => {
    btnLayout.hidden = !canLayout();
    if (!canLayout()) exitLayout(true);
  };
  if (wideMq.addEventListener) wideMq.addEventListener('change', onWide);
  else if (wideMq.addListener) wideMq.addListener(onWide);
  onWide();
  addEventListener('resize', () => {
    if (!editing) return;
    if (gest) endGesture(null);
    landGlides();
    geo();
    sizeLayFx();
  });

  // a saved arrangement comes back before the panels mount, so they boot at their final size
  if (!HD.solo) {
    layout = loadLayout();
    if (layout) applyLayout();
  }

  /* ---- the light table: snap grid, landing zone, afterimages, rulers, shockwaves */

  const lcol = (c, a) => HD.rgba(c, U.clamp(a, 0, 1).toFixed(3));
  function brackets(g, x, y, w, h, len) {
    g.beginPath();
    g.moveTo(x, y + len);
    g.lineTo(x, y);
    g.lineTo(x + len, y);
    g.moveTo(x + w - len, y);
    g.lineTo(x + w, y);
    g.lineTo(x + w, y + len);
    g.moveTo(x + w, y + h - len);
    g.lineTo(x + w, y + h);
    g.lineTo(x + w - len, y + h);
    g.moveTo(x + len, y + h);
    g.lineTo(x, y + h);
    g.lineTo(x, y + h - len);
    g.stroke();
  }
  function label(g, text, x, y, color, bg = 'rgba(2,10,16,0.9)') {
    g.font = '600 10px "JetBrains Mono", Consolas, monospace';
    const w = g.measureText(text).width + 12;
    g.fillStyle = bg;
    g.fillRect(x, y - 15, w, 17);
    g.strokeStyle = color;
    g.lineWidth = 1;
    g.strokeRect(x + 0.5, y - 14.5, w - 1, 16);
    g.fillStyle = color;
    g.fillText(text, x + 6, y - 3);
    return w;
  }
  function litCells(g, s, now, base) {
    const flash = Math.max(0, 1 - (now - fx.zoneAt) / 260);
    g.fillStyle = lcol('holo', base + 0.2 * flash);
    for (let i = 0; i < s.w; i++)
      for (let j = 0; j < s.h; j++) g.fillRect((s.x + i) * G.px + 1, (s.y + j) * G.py + 1, G.px - G.gap - 2, G.py - G.gap - 2);
  }
  function zoneOutline(g, r, now, text, warn) {
    g.save();
    g.setLineDash([7, 5]);
    g.lineDashOffset = -now / 28;
    g.strokeStyle = lcol('holo', 0.9);
    g.lineWidth = 1.5;
    g.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    g.restore();
    g.save();
    g.shadowColor = HD.color.holo;
    g.shadowBlur = 10;
    g.strokeStyle = HD.color.ice;
    g.lineWidth = 2.5;
    brackets(g, r.x - 3, r.y - 3, r.w + 6, r.h + 6, Math.min(18, r.w / 3, r.h / 3));
    g.restore();
    if (text) {
      const ty = r.y > 20 ? r.y - 5 : r.y + 20;
      const w = label(g, text, r.x, ty, HD.color.holo);
      if (warn) label(g, warn, r.x + w + 4, ty, HD.color.amber, 'rgba(24,12,0,0.9)');
    }
  }
  function ruler(g, x, y, len, horiz, pitch, units, text) {
    g.strokeStyle = lcol('ice', 0.85);
    g.fillStyle = lcol('ice', 0.85);
    g.lineWidth = 1;
    g.beginPath();
    if (horiz) {
      g.moveTo(x, y + 0.5);
      g.lineTo(x + len, y + 0.5);
    } else {
      g.moveTo(x + 0.5, y);
      g.lineTo(x + 0.5, y + len);
    }
    for (let i = 0; i <= units * 2; i++) {
      const o = Math.min(len, (i / 2) * pitch);
      const tl = i % 2 ? 3 : i === 0 || i === units * 2 ? 9 : 6;
      if (horiz) {
        g.moveTo(x + o + 0.5, y);
        g.lineTo(x + o + 0.5, y - tl);
      } else {
        g.moveTo(x, y + o + 0.5);
        g.lineTo(x - tl, y + o + 0.5);
      }
    }
    g.stroke();
    g.font = '500 8px "JetBrains Mono", Consolas, monospace';
    const every = pitch < 34 ? 2 : 1;
    for (let i = every; i < units; i += every) {
      const o = i * pitch;
      if (horiz) g.fillText(String(i), x + o - 2, y - 11);
      else g.fillText(String(i), x - 20, y + o + 3);
    }
    g.save();
    g.translate(horiz ? x + len / 2 : x, horiz ? y : y + len / 2);
    if (!horiz) g.rotate(-Math.PI / 2);
    g.font = '600 9px "JetBrains Mono", Consolas, monospace';
    const w = g.measureText(text).width + 10;
    g.fillStyle = 'rgba(2,10,16,0.92)';
    g.fillRect(-w / 2, -6, w, 12);
    g.fillStyle = HD.color.ice;
    g.textAlign = 'center';
    g.fillText(text, 0, 3);
    g.restore();
  }

  function drawGridMarks(g, now) {
    const hot = !!gest || [...anims.values()].some((a) => a.kind === 'glide');
    const waveR = (now - fx.enterAt) * 2.6;
    const outR = (now - fx.exitAt) * 3.2;
    const pg = px > 0 ? { x: px - G.x, y: py - G.y } : { x: -1e4, y: -1e4 };
    if (hot && editing) {
      // faint guide rails on every snap line while something is in the air
      g.strokeStyle = lcol('holo', 0.07);
      g.lineWidth = 1;
      g.beginPath();
      for (let i = 0; i <= COLS; i++) {
        const x = Math.round(i * G.px - G.gap / 2) + 0.5;
        g.moveTo(x, -G.gap / 2);
        g.lineTo(x, G.h + G.gap / 2);
      }
      for (let j = 0; j <= ROWS; j++) {
        const y = Math.round(j * G.py - G.gap / 2) + 0.5;
        g.moveTo(-G.gap / 2, y);
        g.lineTo(G.w + G.gap / 2, y);
      }
      g.stroke();
    }
    g.lineWidth = 1;
    for (let i = 0; i <= COLS; i++) {
      for (let j = 0; j <= ROWS; j++) {
        const x = Math.round(i * G.px - G.gap / 2) + 0.5;
        const y = Math.round(j * G.py - G.gap / 2) + 0.5;
        let a;
        let arm = 3.5;
        if (editing) {
          const d = Math.hypot(x - fx.origin.x, y - fx.origin.y);
          a = U.clamp((waveR - d) / 90, 0, 1) * (hot ? 0.55 : 0.34);
          const front = Math.abs(waveR - d);
          if (front < 46) {
            a += 0.75 * (1 - front / 46);
            arm += 4 * (1 - front / 46);
          }
          const near = Math.max(0, 1 - Math.hypot(x - pg.x, y - pg.y) / 170);
          a += 0.55 * near;
          arm += 3 * near;
        } else {
          const d = Math.hypot(x - fx.exitOrigin.x, y - fx.exitOrigin.y);
          a = 0.34 * U.clamp(1 - (outR - d) / 90, 0, 1);
          const front = Math.abs(outR - d);
          if (front < 46) a += 0.6 * (1 - front / 46);
          if (a < 0.01) continue;
        }
        g.strokeStyle = lcol('holo', a);
        g.beginPath();
        g.moveTo(x - arm, y);
        g.lineTo(x + arm, y);
        g.moveTo(x, y - arm);
        g.lineTo(x, y + arm);
        g.stroke();
      }
    }
  }

  function drawZone(g, a, now, dt) {
    if (!a.zone) return;
    const t = uRect(a.zone);
    const z = (fx.zone = fx.zone || { ...t });
    const k = 1 - Math.exp(-30 * dt);
    z.x += (t.x - z.x) * k;
    z.y += (t.y - z.y) * k;
    z.w += (t.w - z.w) * k;
    z.h += (t.h - z.h) * k;
    litCells(g, a.zone, now, 0.06);
    const n = grid.querySelectorAll('.panel.is-overlap').length;
    zoneOutline(g, z, now, `X${U.pad(a.zone.x)} Y${U.pad(a.zone.y)} · ${a.zone.w}×${a.zone.h}`, n ? `OVERLAP ×${n}` : '');
    // tether from the card to its landing slot
    const cx = a.x + a.w / 2;
    const cy = a.y + a.h / 2;
    const zx = z.x + z.w / 2;
    const zy = z.y + z.h / 2;
    if (Math.hypot(cx - zx, cy - zy) > 8) {
      g.save();
      g.setLineDash([2, 5]);
      g.lineDashOffset = now / 20;
      g.strokeStyle = lcol('neon', 0.75);
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(zx, zy);
      g.stroke();
      g.restore();
      g.fillStyle = HD.color.neon;
      g.beginPath();
      g.arc(zx, zy, 3 + Math.sin(now / 90), 0, Math.PI * 2);
      g.fill();
    }
  }

  function drawResize(g, a, now) {
    const s = uRect(a.snap);
    litCells(g, a.snap, now, 0.05);
    zoneOutline(g, s, now, '', '');
    const c = a.cur;
    // the live wireframe under the glove
    g.strokeStyle = lcol('ice', 0.55);
    g.lineWidth = 1;
    g.strokeRect(c.x + 0.5, c.y + 0.5, c.w - 1, c.h - 1);
    g.strokeStyle = lcol('holo', 0.14);
    g.beginPath();
    g.moveTo(c.x, c.y);
    g.lineTo(c.x + c.w, c.y + c.h);
    g.moveTo(c.x + c.w, c.y);
    g.lineTo(c.x, c.y + c.h);
    g.stroke();
    // the edges being pulled glow
    g.save();
    g.shadowColor = HD.color.neon;
    g.shadowBlur = 12;
    g.strokeStyle = HD.color.neon;
    g.lineWidth = 2;
    g.beginPath();
    const e = a.edge;
    if (e.includes('n')) g.moveTo(c.x, c.y), g.lineTo(c.x + c.w, c.y);
    if (e.includes('s')) g.moveTo(c.x, c.y + c.h), g.lineTo(c.x + c.w, c.y + c.h);
    if (e.includes('w')) g.moveTo(c.x, c.y), g.lineTo(c.x, c.y + c.h);
    if (e.includes('e')) g.moveTo(c.x + c.w, c.y), g.lineTo(c.x + c.w, c.y + c.h);
    g.stroke();
    g.restore();
    // glove node at the fingertip
    const nr = 6 + 2 * Math.sin(now / 110);
    g.strokeStyle = HD.color.ice;
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(a.gx, a.gy, nr, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = lcol('holo', 0.5);
    g.beginPath();
    g.arc(a.gx, a.gy, nr + 7 + ((now / 12) % 14), 0, Math.PI * 2);
    g.stroke();
    // CAD rulers along the top and left of the snapped frame
    const topY = s.y > 30 ? s.y - 10 : s.y + 22;
    const leftX = s.x > 34 ? s.x - 10 : s.x + 30;
    ruler(g, s.x, topY, s.w, true, G.px, a.snap.w, `${Math.round(s.w)} PX`);
    ruler(g, leftX, s.y, s.h, false, G.py, a.snap.h, `${Math.round(s.h)} PX`);
    // the big readout
    const fs = Math.round(U.clamp(Math.min(s.w * 0.13, s.h * 0.26), 14, 46));
    g.save();
    g.textAlign = 'center';
    g.shadowColor = HD.color.holo;
    g.shadowBlur = 16;
    g.fillStyle = HD.color.ice;
    g.font = `400 ${fs}px Michroma, "Arial Black", sans-serif`;
    g.fillText(`${a.snap.w} × ${a.snap.h}`, s.x + s.w / 2, s.y + s.h / 2 + fs * 0.2);
    g.shadowBlur = 0;
    g.font = '600 10px "JetBrains Mono", Consolas, monospace';
    g.fillStyle = a.atMin ? HD.color.amber : HD.color.holo;
    g.fillText(`${Math.round(s.w)} × ${Math.round(s.h)} PX${a.atMin ? ' · MIN' : ''}`, s.x + s.w / 2, s.y + s.h / 2 + fs * 0.2 + 18);
    g.restore();
  }

  function drawTransients(g, now, dt) {
    for (let i = fx.ghosts.length - 1; i >= 0; i--) {
      const q = fx.ghosts[i];
      const age = (now - q.t) / 380;
      if (age >= 1) {
        fx.ghosts.splice(i, 1);
        continue;
      }
      const al = 0.5 * (1 - age);
      g.save();
      g.translate(q.x + q.ox, q.y + q.oy);
      g.rotate((q.rz * Math.PI) / 180);
      g.translate(-q.ox, -q.oy);
      g.fillStyle = lcol('holo', al * 0.08);
      g.fillRect(0, 0, q.w, q.h);
      g.strokeStyle = lcol('neon', al * 0.5);
      g.lineWidth = 1;
      g.strokeRect(3.5, 0.5, q.w - 1, q.h - 1);
      g.strokeStyle = lcol('holo', al);
      g.strokeRect(0.5, 0.5, q.w - 1, q.h - 1);
      g.restore();
    }
    for (let i = fx.cells.length - 1; i >= 0; i--) {
      const c = fx.cells[i];
      const cx = c.x + c.w / 2;
      const cy = c.y + c.h / 2;
      let live = false;
      for (let x = 0; x < c.w; x++) {
        for (let y = 0; y < c.h; y++) {
          const t = (now - c.t0 - Math.hypot(c.x + x + 0.5 - cx, c.y + y + 0.5 - cy) * 45) / 520;
          if (t >= 1) continue;
          live = true;
          if (t < 0) continue;
          g.fillStyle = lcol('holo', 0.34 * (1 - t));
          g.fillRect((c.x + x) * G.px + 1, (c.y + y) * G.py + 1, G.px - G.gap - 2, G.py - G.gap - 2);
        }
      }
      if (!live) fx.cells.splice(i, 1);
    }
    for (let i = fx.pulses.length - 1; i >= 0; i--) {
      const q = fx.pulses[i];
      const t = (now - q.t0) / 620;
      if (t >= 1) {
        fx.pulses.splice(i, 1);
        continue;
      }
      const grow = 30 * U.ease.outCubic(t);
      g.strokeStyle = lcol('ice', 0.75 * (1 - t));
      g.lineWidth = 2 * (1 - t) + 0.5;
      g.strokeRect(q.r.x - grow, q.r.y - grow, q.r.w + grow * 2, q.r.h + grow * 2);
    }
    for (let i = fx.rings.length - 1; i >= 0; i--) {
      const q = fx.rings[i];
      const t = (now - q.t0) / (q.dur || 700);
      if (t < 0) continue;
      if (t >= 1) {
        fx.rings.splice(i, 1);
        continue;
      }
      g.strokeStyle = lcol(q.c || 'holo', 0.8 * (1 - t));
      g.lineWidth = 3 * (1 - t) + 0.5;
      g.beginPath();
      g.arc(q.x, q.y, Math.max(1, q.max * U.ease.outCubic(t)), 0, Math.PI * 2);
      g.stroke();
    }
    for (let i = fx.sparks.length - 1; i >= 0; i--) {
      const q = fx.sparks[i];
      q.t += dt;
      if (q.t >= q.life) {
        fx.sparks.splice(i, 1);
        continue;
      }
      q.vx *= 0.94;
      q.vy *= 0.94;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      g.fillStyle = lcol(q.c, 1 - q.t / q.life);
      g.fillRect(q.x - q.s / 2, q.y - q.s / 2, q.s, q.s);
    }
  }

  HD.onFrame((now, dt) => {
    for (const [p, a] of anims) stepAnim(p, a, now, dt);
    if (layCv.hidden) return;
    const busy = fx.rings.length || fx.pulses.length || fx.cells.length || fx.sparks.length || fx.ghosts.length;
    if (!editing && !busy && now - fx.exitAt > 900) {
      layCv.hidden = true;
      return;
    }
    const g = lctx;
    const dpr = layCv.__dpr || 1;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, layCv.width, layCv.height);
    g.setTransform(dpr, 0, 0, dpr, LAY_PAD * dpr, LAY_PAD * dpr);
    drawGridMarks(g, now);
    drawTransients(g, now, dt);
    let flying = null;
    for (const a of anims.values()) if (a.kind === 'drag' || a.kind === 'glide') flying = a;
    if (flying) drawZone(g, flying, now, dt);
    if (gest && gest.type === 'resize') drawResize(g, gest, now);
  });

  HD.layout = {
    enter: enterLayout,
    exit: exitLayout,
    reset: resetLayout,
    get editing() {
      return editing;
    },
    get: () => (layout ? JSON.parse(JSON.stringify(layout)) : null),
    defaults: () => {
      const d = cloneDefault();
      return d;
    },
    min: minOf,
  };

  /* ------------------------------------------------------- intrusion banner */

  const banner = $('#banner');
  const bannerSub = $('#banner-sub');
  const takeover = $('#takeover');
  let intrusionTimer = 0;
  let bannerHide = 0;
  const INTRUSION_SUBS = [
    'COUNTER-TRACE INBOUND · ROTATING KEYS',
    'HOSTILE ICE ON PORT 443 · FIREWALL HOLDING',
    'WRAITH IS PINGING BACK · SCRAMBLING ORIGIN',
    'ROOTKIT SIGNATURE ON NODE 7 · QUARANTINED',
    'SPOOFED BADGE ON SUBNET 10.66 · LOCKING DOWN',
  ];

  function scheduleIntrusion(first) {
    clearTimeout(intrusionTimer);
    intrusionTimer = setTimeout(() => triggerIntrusion('auto'), first ? R.int(24000, 34000) : R.int(48000, 78000));
  }
  function triggerIntrusion(source) {
    if (M.zeroAt || !takeover.hidden) return scheduleIntrusion();
    bannerSub.textContent = R.pick(INTRUSION_SUBS);
    banner.hidden = true;
    void banner.offsetWidth; // restart the entry animation
    banner.hidden = false;
    clearTimeout(bannerHide);
    bannerHide = setTimeout(() => (banner.hidden = true), 2600);
    chipUplink.classList.add('is-bad');
    chipUplink.querySelector('b').textContent = 'REROUTING';
    setTimeout(() => {
      chipUplink.classList.remove('is-bad');
      chipUplink.querySelector('b').textContent = 'SECURE';
    }, 4200);
    const frames = R.shuffle([...document.querySelectorAll('.panel')]).slice(0, 4);
    frames.forEach((f, i) =>
      setTimeout(() => {
        f.dataset.flash = 'alert';
        setTimeout(() => delete f.dataset.flash, 1500);
      }, i * 140)
    );
    for (let i = 0; i < 3; i++) setTimeout(() => HD.audio.beep(i % 2 ? 660 : 990, 140, 'square', 0.04), i * 180);
    bus.emit('intrusion', { source });
    bus.emit('alert', { level: 'crit', msg: `INTRUSION DETECTED — ${bannerSub.textContent}`, source: 'SYS', panel: 'shell', time: Date.now() });
    scheduleIntrusion();
  }
  bus.on('ui:intrusion', () => triggerIntrusion('manual'));
  if (!HD.solo) scheduleIntrusion(true);

  /* ------------------------------------------------------ zero-hour takeover */

  const tkEyebrow = $('#takeover-eyebrow');
  const tkTitle = $('#takeover-title');
  const tkSub = $('#takeover-sub');
  const tkFoot = $('#takeover-foot');
  let tkTimer = 0;

  bus.on('mission:zero', ({ cycle }) => {
    if (HD.solo) return;
    const win = cycle % 2 === 1;
    const title = win ? 'TARGET INTERCEPTED' : 'UPLINK SEVERED';
    banner.hidden = true;
    takeover.classList.toggle('is-win', win);
    tkEyebrow.textContent = 'T− 00:00:00.00';
    tkTitle.dataset.text = title;
    tkSub.textContent = win
      ? `PAYLOAD NEUTRALIZED · ${R.pick(W.units)} ON SITE`
      : `${W.city} GRID OFFLINE · ${S.target.codename} HAS GONE DARK`;
    takeover.hidden = false;
    U.scramble(tkTitle, title, { duration: 900, chars: U.CHARS.glyph });
    if (win) HD.audio.chirp(300, 1400, 600, 'sine', 0.05);
    else HD.audio.chirp(1200, 60, 900, 'sawtooth', 0.05);
    const until = performance.now() + 7000;
    clearInterval(tkTimer);
    const foot = () => {
      const s = Math.max(0, Math.ceil((until - performance.now()) / 1000));
      tkFoot.textContent = `NEW SIGNAL DETECTED · RE-ARMING IN ${s}s · CLICK TO RE-ARM NOW`;
    };
    foot();
    tkTimer = setInterval(foot, 250);
    bus.emit('alert', {
      level: 'crit',
      msg: win ? 'ZERO HOUR — TARGET INTERCEPTED' : 'ZERO HOUR — UPLINK SEVERED',
      source: 'SYS',
      panel: 'shell',
      time: Date.now(),
    });
  });
  takeover.addEventListener('click', () => M.reset());
  bus.on('mission:reset', ({ cycle }) => {
    takeover.hidden = true;
    clearInterval(tkTimer);
    bus.emit('alert', { level: 'warn', msg: `NEW SIGNAL — CYCLE ${cycle} · COUNTDOWN RE-ARMED`, source: 'SYS', panel: 'shell', time: Date.now() });
  });

  /* ---------------------------------------------------------------- hotkeys */

  const btnAudio = $('#btn-audio');
  const btnFull = $('#btn-full');
  function toggleAudio() {
    HD.audio.enable(!HD.audio.enabled);
    if (HD.audio.enabled) HD.audio.chirp(500, 1500, 160, 'sine', 0.04);
  }
  bus.on('audio:toggle', ({ enabled }) => {
    btnAudio.setAttribute('aria-pressed', String(enabled));
    btnAudio.querySelector('b').textContent = enabled ? 'ON' : 'OFF';
  });
  btnAudio.addEventListener('click', toggleAudio);

  function toggleFull() {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else root.requestFullscreen().catch(() => {});
    } catch (err) {
      /* fullscreen not permitted in this frame */
    }
  }
  if (!document.fullscreenEnabled) btnFull.hidden = true;
  btnFull.addEventListener('click', toggleFull);

  const KONAMI = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a'];
  let konami = 0;
  addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const k = e.key.toLowerCase();
    konami = k === KONAMI[konami] ? konami + 1 : k === KONAMI[0] ? 1 : 0;
    if (konami === KONAMI.length) {
      konami = 0;
      bus.emit('ui:fedhead', { source: 'konami' });
      return;
    }
    if (layoutKey(e, k)) return;
    if (k === 'escape' && HD.fedhead && HD.fedhead.dismiss()) return;
    if (k === 'e') bus.emit('ui:enhance', { source: 'key' });
    else if (k === 't') bus.emit('ui:trace', { source: 'key' });
    else if (k === '`' || k === '/') {
      e.preventDefault();
      bus.emit('ui:terminal', { source: 'key' });
    } else if (k === 'i') bus.emit('ui:intrusion', { source: 'key' });
    else if (k === 'm') toggleAudio();
    else if (k === 'f') toggleFull();
    else if (k === 'escape' && !takeover.hidden) M.reset();
  });

  /* ---------------------------------------------------------------- fedhead */
  // The handler's 1997 head-scan GIF: a top-bar badge, "secure uplink" calls at story beats, a cameo
  // on the zero-hour takeover, and the FEDHEAD PROTOCOL surprise (Konami code, badge triple-click,
  // `fedhead` in the shell, or the idle screensaver hitting a corner).

  const FH = (HD.assets && HD.assets.fedhead) || '';
  const badge = $('#op-badge');
  const uplink = $('#uplink');
  const upLine = $('#uplink-line');
  const upClock = $('#uplink-clock');
  const upLat = $('#uplink-lat');
  const upCh = $('#uplink-ch');
  const protocol = $('#protocol');
  const protoFoot = $('#protocol-foot');
  const pfx = $('#protocol-fx');
  const pctx = pfx.getContext('2d');
  const bouncer = $('#bouncer');
  const tkHandler = $('#takeover-handler');
  const tkQuote = $('#takeover-quote');
  for (const img of document.querySelectorAll('img[data-fh]')) if (FH) img.src = FH;
  // the uplink call comes in on a different face: the handler's 1997 head scan got a Hollywood recast
  const BRAD = (HD.assets && HD.assets.bradhead) || '';
  if (FH && BRAD) for (const img of uplink.querySelectorAll('img[data-fh]')) img.src = BRAD;
  const vu = $('#uplink-vu');
  for (let i = 0; i < 18; i++) {
    const bar = U.el('i');
    bar.style.animationDelay = `${-R.range(0, 0.42).toFixed(2)}s`;
    bar.style.animationDuration = `${R.range(0.22, 0.5).toFixed(2)}s`;
    vu.appendChild(bar);
  }

  let upOpenAt = 0;
  let upLast = -1e9;
  let upHide = 0;
  let upOut = 0;
  let typeTimer = 0;
  const IDLE_LINES = [
    () => `${S.target.codename} is on ${S.target.street !== '—' ? S.target.street : 'the move'}. Do not let him reach the Périphérique.`,
    () => 'Paris at night. Perfect weather for a manhunt.',
    () => `Dale, dale. ${S.target.codename} is turning. Stay on him.`,
    () => "Kona's got his scent. Follow the dog.",
    () => `Good dog, Kona. ${S.target.codename} can change plates. He can't change his smell.`,
    () => "Fed learns to make... interceptors. Get me a unit on that bumper.",
    () => "I've been doing this since '97. He's nervous. I can feel it.",
    () => `Coffee's cold. The trail isn't. Stay on ${S.target.codename}.`,
    () => 'Every camera in this city answers to us tonight. Use them.',
    () => `Keep ${R.pick(W.units)} close. I want him boxed in, not spooked.`,
    () => "Old school tip: the shell takes the command 'fedhead'. Don't tell anyone.",
  ];

  function placeUplink() {
    const mapEl = document.querySelector('[data-panel="map"]');
    const wide = innerWidth >= 1280 && innerHeight >= 700;
    if (!mapEl || !wide) {
      uplink.style.left = uplink.style.top = '';
      return;
    }
    // hug the map's lower-left corner, but never leave the grid (a rearranged map can sit anywhere)
    const r = mapEl.getBoundingClientRect();
    const gr = grid.getBoundingClientRect();
    const uw = uplink.offsetWidth;
    const uh = uplink.offsetHeight;
    uplink.style.left = `${Math.round(U.clamp(r.left + 26, gr.left, gr.right - uw))}px`;
    uplink.style.top = `${Math.round(U.clamp(r.bottom - uh - 34, gr.top, gr.bottom - uh))}px`;
    uplink.style.right = 'auto';
    uplink.style.bottom = 'auto';
  }

  function closeUplink(now) {
    clearTimeout(upHide);
    clearInterval(typeTimer);
    if (uplink.hidden) return;
    badge.classList.remove('is-live');
    if (now) {
      uplink.hidden = true;
      return;
    }
    uplink.classList.add('is-out');
    clearTimeout(upOut);
    upOut = setTimeout(() => {
      uplink.hidden = true;
      uplink.classList.remove('is-out');
    }, 280);
  }

  const upTitle = uplink.querySelector('.uplink-title');
  const upReply = $('#uplink-reply');
  const upName = uplink.querySelector('.uplink-name');
  let seq = 0;

  function typeInto(el, text, done) {
    clearInterval(typeTimer);
    let i = 0;
    el.textContent = '';
    const step = () => {
      i = HD.reducedMotion ? text.length : Math.min(text.length, i + 2);
      el.textContent = text.slice(0, i);
      if (i >= text.length) {
        clearInterval(typeTimer);
        if (done) done();
      }
    };
    step();
    typeTimer = setInterval(step, 45);
  }

  // Priority lines (story beats) interrupt; ambient ones wait their turn.
  // opts.title relabels the call; opts.then runs once the line has been typed.
  function speak(text, pri = false, opts = {}) {
    if (!FH || HD.solo || !takeover.hidden || !protocol.hidden) return;
    const now = performance.now();
    if (!pri && (now - upLast < 26000 || !uplink.hidden)) return;
    upLast = now;
    const my = ++seq;
    clearTimeout(upOut);
    uplink.classList.remove('is-out');
    if (uplink.hidden) {
      upOpenAt = now;
      upCh.textContent = `CH-${U.pad(R.int(2, 48))}`;
      U.scramble(upName, 'FEDHAT', { duration: 0 }); // a fresh call opens under his handle
      uplink.hidden = false;
      void uplink.offsetWidth; // restart the materialise animation
      placeUplink();
      HD.audio.chirp(700, 1500, 110, 'sine', 0.025);
    }
    upTitle.textContent = opts.title || 'SECURE UPLINK · HANDLER';
    uplink.classList.toggle('is-verified', !!opts.verified);
    upReply.hidden = true;
    badge.classList.add('is-live');
    uplink.classList.add('is-talking');
    typeInto(upLine, text, () => {
      setTimeout(() => my === seq && uplink.classList.remove('is-talking'), 500);
      if (opts.then) setTimeout(() => my === seq && opts.then(), opts.thenDelay || 900);
    });
    clearTimeout(upHide);
    upHide = setTimeout(() => closeUplink(), Math.max(6000, text.length * 70 + 3200) + (opts.hold || 0));
    return my;
  }

  // Fed authenticates like it's 1997: his old personal ad is the challenge, the reply is the countersign,
  // and once it lands the caller shows his cover name.
  function countersign(after) {
    const my = speak('Eyes like a puppydog\nlips made for sin', true, {
      title: 'SECURE UPLINK · CHALLENGE',
      hold: 6000,
      thenDelay: 700,
      then: () => {
        upReply.hidden = false;
        typeInto(upReply, 'You are not dreaming\nI am for real', () => {
          if (my !== seq) return;
          upTitle.textContent = 'VERIFIED · COVER ID LEWIS';
          U.scramble(upName, 'LEWIS', { duration: 650 });
          uplink.classList.add('is-verified');
          HD.audio.beep(1320, 90, 'sine', 0.03);
          if (after) setTimeout(() => my === seq && speak(after, true, { title: 'SECURE UPLINK · LEWIS', verified: true }), 1900);
        });
      },
    });
  }

  HD.onFrame((now) => {
    if (uplink.hidden) return;
    const s = Math.floor((now - upOpenAt) / 1000);
    upClock.textContent = `${U.pad(Math.floor(s / 60))}:${U.pad(s % 60)}`;
    if (!(s % 2) && now % 1000 < 20) upLat.textContent = `LAT ${R.int(18, 41)} MS`;
  });
  $('#uplink-x').addEventListener('click', () => closeUplink());
  addEventListener('resize', () => !uplink.hidden && placeUplink());
  bus.on('layout:change', () => !uplink.hidden && placeUplink());
  bus.on('layout:settled', (d) => d && d.id === 'map' && !uplink.hidden && placeUplink());

  // story beats
  bus.on('boot', () => setTimeout(() => countersign(`${S.op} desk, this is Fed. ${S.target.codename} is mobile in ${W.city}. Don't blink.`), 5200));
  bus.on('decrypt:complete', (d) => d && /LEWIS/.test(d.file || '') && speak("That's... my old personal ad. Eyes like a puppy dog. Delete it. Now.", true));
  bus.on('enhance:result', (d) => speak(`Plate ${(d && d.plate) || S.target.plate} confirmed. That's our ghost.`, true));
  bus.on('trace:complete', () => speak('Trace says Paris. Of course it does. Keep the net tight.'));
  bus.on('face:match', () => speak(`Face match. Hello again, ${S.target.codename}.`));
  bus.on('voice:match', () => speak("That's his voice. I'd know it anywhere."));
  bus.on('target:camera', (d) => R.chance(0.35) && speak(`${(d && d.camId) || 'A camera'} has eyes on him. ${(d && d.street) || S.target.street}.`));
  bus.on('intrusion', (d) => d && d.source !== 'fedhead' && speak("He's pinging us back. Rotate everything. Now.", true));
  bus.on('mission:phase', ({ phase }) => {
    const line = { severe: 'Two minutes. I want a unit on his bumper.', critical: '¡Vamos! Sixty seconds! Where are my interceptors?', final: "Ten seconds. It's now or never, Agent." }[phase];
    if (line) speak(line, true);
  });
  bus.on('mission:reset', () => {
    tkHandler.hidden = true;
    setTimeout(() => speak('New signal. Same ghost. Go again.', true), 1600);
  });
  bus.on('mission:zero', ({ cycle }) => {
    if (!FH || HD.solo) return;
    closeUplink(true);
    tkQuote.textContent = cycle % 2 === 1 ? 'Target intercepted. Drinks are on Fed tonight.' : 'We lost the grid. Reset, reacquire, and do not make me call twice.';
    setTimeout(() => (tkHandler.hidden = takeover.hidden), 900);
  });
  setInterval(() => speak(R.pick(IDLE_LINES)()), 31000);

  // badge: click to call in, triple-click for the protocol
  let clicks = [];
  badge.addEventListener('click', () => {
    const now = performance.now();
    clicks = clicks.filter((t) => now - t < 900);
    clicks.push(now);
    if (clicks.length >= 3) {
      clicks = [];
      bus.emit('ui:fedhead', { source: 'badge' });
      return;
    }
    if (!uplink.hidden) closeUplink();
    else if (R.chance(0.3)) countersign('Just checking you still know the phrase. Carry on.');
    else speak(R.pick(IDLE_LINES)(), true);
  });

  /* ---- the surprise: FEDHEAD PROTOCOL */

  const HIJACK = ['THE FED IS WATCHING', 'FEDHEAD WAS HERE', 'HELLO, AGENT', 'SAY HI TO THE FED', 'NULLSEC SEES ALL'];
  const sparks = [];
  let protoTimer = 0;
  let protoHide = 0;

  function hijack(panel, i) {
    const r = panel.getBoundingClientRect();
    const fw = Math.round(U.clamp(Math.min(r.width * 0.34, (r.height - 48) / 1.6), 16, 110));
    const d = U.el('div', 'fh-hijack');
    const face = U.el('span', 'fh-face');
    face.style.setProperty('--fw', `${fw}px`);
    const img = U.el('img');
    img.alt = '';
    img.src = FH;
    face.appendChild(img);
    d.append(face, U.el('b', '', HIJACK[i % HIJACK.length]));
    d.addEventListener('animationend', (e) => e.target === d && d.remove());
    panel.appendChild(d);
  }

  function burst() {
    pfx.width = innerWidth;
    pfx.height = innerHeight;
    const face = protocol.querySelector('.protocol-face').getBoundingClientRect();
    const cx = face.left + face.width / 2;
    const cy = face.top + face.height / 2;
    const cols = [HD.color.phosphor, HD.color.holo, HD.color.ice, HD.color.neon, HD.color.amber];
    sparks.length = 0;
    const n = HD.reducedMotion ? 0 : 220;
    for (let i = 0; i < n; i++) {
      const a = R.range(0, Math.PI * 2);
      const v = R.range(120, 620);
      sparks.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 160, s: R.pick([2, 3, 3, 4, 6]), c: R.pick(cols), life: R.range(1.2, 2.6), t: 0 });
    }
  }
  HD.onFrame((now, dt) => {
    if (!sparks.length) return;
    pctx.clearRect(0, 0, pfx.width, pfx.height);
    for (let i = sparks.length - 1; i >= 0; i--) {
      const p = sparks[i];
      p.t += dt;
      if (p.t > p.life) {
        sparks.splice(i, 1);
        continue;
      }
      p.vy += 520 * dt;
      p.vx *= 0.99;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      pctx.globalAlpha = 1 - p.t / p.life;
      pctx.fillStyle = p.c;
      pctx.fillRect(p.x | 0, p.y | 0, p.s, p.s);
    }
    pctx.globalAlpha = 1;
    if (!sparks.length) pctx.clearRect(0, 0, pfx.width, pfx.height);
  });

  function fedheadProtocol(source) {
    if (!FH || HD.solo || !protocol.hidden || !takeover.hidden || protoTimer) return;
    closeUplink(true);
    bouncer.hidden = true;
    [...document.querySelectorAll('.panel')].forEach((p, i) => setTimeout(() => hijack(p, i), i * 65));
    HD.audio.chirp(160, 1700, 900, 'square', 0.04);
    bus.emit('intrusion', { source: 'fedhead' });
    protoTimer = setTimeout(() => {
      const bonus = !M.zeroAt;
      protoFoot.textContent = `${source === 'corner' ? 'IT HIT THE CORNER. ' : ''}${bonus ? '+01:00 OVERRIDE APPLIED · ' : ''}CLICK TO RESUME`;
      protocol.hidden = false;
      burst();
      if (bonus) M.add(60000);
      for (let i = 0; i < 4; i++) setTimeout(() => HD.audio.beep([523, 659, 784, 1047][i], 160, 'square', 0.035), i * 140);
      bus.emit('alert', { level: 'warn', msg: 'FEDHEAD PROTOCOL ENGAGED · WELCOME BACK, AGENT', source: 'HQ', panel: 'shell', time: Date.now() });
      protoHide = setTimeout(endProtocol, 8000);
    }, 1400);
  }
  function endProtocol() {
    if (protocol.hidden) return false;
    clearTimeout(protoHide);
    protoTimer = 0;
    protocol.hidden = true;
    sparks.length = 0;
    pctx.clearRect(0, 0, pfx.width, pfx.height);
    setTimeout(() => speak('Protocol complete. Fed out. Back to work.', true), 900);
    return true;
  }
  protocol.addEventListener('click', endProtocol);
  bus.on('ui:fedhead', (d) => fedheadProtocol((d && d.source) || 'manual'));

  /* ---- idle screensaver: a 1997 DVD-logo bounce; a perfect corner hit fires the protocol */

  const IDLE_MS = (parseFloat(HD.params.get('idle')) || 90) * 1000;
  let idleAt = performance.now();
  let bx = 0;
  let by = 0;
  let bvx = 150;
  let bvy = 112;
  let bw = 0;
  let bh = 0;
  let hue = 0;
  let hitXAt = -1e9;
  let hitYAt = -1e9;
  const wake = () => {
    idleAt = performance.now();
    if (!bouncer.hidden) bouncer.hidden = true;
  };
  for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart']) addEventListener(ev, wake, { passive: true });
  HD.onFrame((now, dt) => {
    if (bouncer.hidden) {
      if (FH && !HD.reducedMotion && !HD.solo && protocol.hidden && takeover.hidden && !protoTimer && now - idleAt > IDLE_MS) {
        bouncer.hidden = false;
        bw = bouncer.offsetWidth;
        bh = bouncer.offsetHeight;
        bx = R.range(0, innerWidth - bw);
        by = R.range(0, innerHeight - bh);
      }
      return;
    }
    bx += bvx * dt;
    by += bvy * dt;
    let hit = false;
    if (bx <= 0 || bx + bw >= innerWidth) {
      bvx = bx <= 0 ? Math.abs(bvx) : -Math.abs(bvx);
      bx = U.clamp(bx, 0, innerWidth - bw);
      hitXAt = now;
      hit = true;
    }
    if (by <= 0 || by + bh >= innerHeight) {
      bvy = by <= 0 ? Math.abs(bvy) : -Math.abs(bvy);
      by = U.clamp(by, 0, innerHeight - bh);
      hitYAt = now;
      hit = true;
    }
    if (hit) {
      hue = (hue + R.int(70, 150)) % 360;
      bouncer.style.setProperty('--hue', `${hue}deg`);
      if (Math.abs(hitXAt - hitYAt) < 140) {
        bouncer.hidden = true;
        idleAt = now;
        fedheadProtocol('corner');
        return;
      }
    }
    bouncer.style.transform = `translate3d(${bx.toFixed(1)}px,${by.toFixed(1)}px,0)`;
  });

  /* ---- the viewer's reflection: once a minute or so, the operator's own face (a rabbit) surfaces
     in the monitor glass for ~2 s. Mirrored, lit only by the dashboard's glow, defocused, and added
     to the screen the way glass adds light, so it shows over dark UI and vanishes over bright UI. */

  const RABBIT = (HD.assets && HD.assets.rabbit) || '';
  const rcv = $('#fx-reflect');
  const rctx = rcv.getContext('2d');
  const REF_MS = 2300;
  const refEvery = parseFloat(HD.params.get('rabbit')); // test hook: ?rabbit=8 appears every ~8 s
  let refSprite = null;
  let refAt = 0;
  let refNext = performance.now() + (refEvery > 0 ? refEvery * 1000 : R.int(22000, 36000));
  let refLive = false;
  let refTilt = 0;

  function prepReflection(img) {
    const h = Math.min(1200, img.naturalHeight);
    const w = Math.round((img.naturalWidth * h) / img.naturalHeight);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    // mirrored, slightly out of focus (glass is not a mirror), and lit only by the screen: the
    // contrast push keeps the pale, screen-lit face bright while the room behind sinks into the dark
    g.save();
    g.translate(w, 0);
    g.scale(-1, 1);
    g.filter = 'contrast(1.75) brightness(1.02) blur(0.9px)';
    g.drawImage(img, 0, 0, w, h);
    g.restore();
    g.filter = 'none';
    // the dashboard's glow re-colours it: cool cyan above, phosphor green below, red nose still reads
    g.globalCompositeOperation = 'color';
    g.globalAlpha = 0.55;
    const tint = g.createLinearGradient(0, 0, 0, h);
    tint.addColorStop(0, '#a8f7ff');
    tint.addColorStop(0.5, '#5ff3ff');
    tint.addColorStop(1, '#3dff9a');
    g.fillStyle = tint;
    g.fillRect(0, 0, w, h);
    g.globalAlpha = 1;
    // an oval falloff around the head: whatever the screen does not light fades into the glass
    g.globalCompositeOperation = 'destination-in';
    g.save();
    g.translate(w * 0.5, h * 0.4);
    g.scale(1, (h / w) * 1.15);
    const r = w * 0.58;
    const vig = g.createRadialGradient(0, 0, r * 0.3, 0, 0, r);
    vig.addColorStop(0, 'rgba(0,0,0,1)');
    vig.addColorStop(0.55, 'rgba(0,0,0,0.8)');
    vig.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = vig;
    g.fillRect(-w, -h, w * 2, h * 2);
    g.restore();
    g.globalCompositeOperation = 'source-over';
    refSprite = c;
  }
  if (RABBIT && !HD.solo) {
    const img = new Image();
    img.onload = () => prepReflection(img);
    img.src = RABBIT;
  }

  function sizeReflect() {
    rcv.width = innerWidth;
    rcv.height = innerHeight;
  }
  sizeReflect();
  addEventListener('resize', sizeReflect);

  const REF_LINES = ['[?] reflection on glass · operator unidentified', '[?] motion behind the operator', 'knock, knock.'];
  function camTag() {
    const p = document.querySelector('[data-panel="face"]');
    if (!p) return;
    const d = U.el('div', 'fx-camtag');
    d.append(U.el('b', '', 'OPERATOR CAM'), U.el('span', '', 'UNREGISTERED BIOMETRIC'), U.el('span', '', 'SPECIES: LAGOMORPH?'));
    p.appendChild(d);
    setTimeout(() => d.remove(), REF_MS + 500);
  }

  function reflectOk() {
    return refSprite && !refLive && !editing && takeover.hidden && protocol.hidden && bouncer.hidden && !protoTimer && !M.zeroAt && !document.hidden;
  }
  function startReflection(now) {
    refLive = true;
    refAt = now;
    refTilt = R.range(-0.012, 0.012);
    rcv.hidden = false;
    camTag();
    HD.audio.chirp(140, 70, 900, 'sine', 0.012);
    bus.emit('reflection', { line: R.pick(REF_LINES) });
    if (R.chance(0.5)) bus.emit('alert', { level: 'info', msg: 'OPERATOR CAM · UNREGISTERED BIOMETRIC ON GLASS', source: 'P-11', panel: 'shell', time: Date.now() });
  }
  function endReflection(now) {
    refLive = false;
    rctx.clearRect(0, 0, rcv.width, rcv.height);
    rcv.hidden = true;
    refNext = now + (refEvery > 0 ? refEvery * 1000 : R.int(45000, 80000));
  }
  bus.on('ui:reflection', () => reflectOk() && startReflection(performance.now()));

  HD.onFrame((now) => {
    if (!refSprite) return;
    if (!refLive) {
      if (now >= refNext) {
        if (reflectOk()) startReflection(now);
        else refNext = now + 4000;
      }
      return;
    }
    const t = (now - refAt) / REF_MS;
    if (t >= 1) return endReflection(now);
    // surfaces slowly, lingers, then is gone as if the head moved out of the light
    const env = t < 0.3 ? U.ease.inOutCubic(t / 0.3) : t > 0.66 ? 1 - U.ease.inOutCubic((t - 0.66) / 0.34) : 1;
    const flick = HD.reducedMotion ? 1 : 0.9 + 0.1 * Math.sin(now * 0.041) * Math.sin(now * 0.013);
    const W = rcv.width;
    const H = rcv.height;
    const g = rctx;
    g.clearRect(0, 0, W, H);
    const sh = H * 1.02;
    const sw = sh * (refSprite.width / refSprite.height);
    // parallax: the reflection drifts against the pointer, like a head moving in front of the screen
    const mx = px > 0 ? px / W - 0.5 : 0;
    const my = py > 0 ? py / H - 0.5 : 0;
    const lean = HD.reducedMotion ? 0 : U.ease.outCubic(t);
    const sc = 1 + 0.025 * lean;
    const cx = W / 2 - mx * W * 0.05;
    const top = H * 0.02 - my * H * 0.03 - lean * H * 0.012;
    g.save();
    g.translate(cx, top + (sh * sc) / 2);
    g.rotate(refTilt * lean);
    g.scale(sc, sc);
    g.globalAlpha = 0.3 * env * flick;
    g.drawImage(refSprite, -sw / 2, -sh / 2, sw, sh);
    // the glass has two surfaces: a fainter second image, slightly offset
    g.globalAlpha = 0.09 * env * flick;
    g.drawImage(refSprite, -sw / 2 + 7, -sh / 2 + 4, sw, sh);
    g.restore();
    // a glare streak sweeps the glass as the face surfaces
    const sx = U.lerp(-0.3, 1.3, t) * W;
    const glare = g.createLinearGradient(sx - W * 0.12, 0, sx + W * 0.12, H * 0.35);
    glare.addColorStop(0, 'rgba(200,245,255,0)');
    glare.addColorStop(0.5, `rgba(200,245,255,${(0.07 * env).toFixed(3)})`);
    glare.addColorStop(1, 'rgba(200,245,255,0)');
    g.globalAlpha = 1;
    g.fillStyle = glare;
    g.fillRect(0, 0, W, H);
  });

  if (FH) badge.hidden = false;
  if (!HD.solo) console.log('%cFEDLIGHT%c  built for fedhat · try ↑↑↓↓←→←→BA', 'font: 700 18px Michroma, sans-serif; color: #3dff7f; letter-spacing: .3em; text-shadow: 0 0 8px #3dff7f', 'color: #5d8793');
  HD.fedhead = {
    speak,
    protocol: fedheadProtocol,
    dismiss() {
      if (endProtocol()) return true;
      if (!uplink.hidden) {
        closeUplink();
        return true;
      }
      return false;
    },
  };

  /* ------------------------------------------------------------------ boot */

  if (!HD.reducedMotion) {
    document.querySelectorAll('.panel').forEach((p, i) => {
      p.style.setProperty('--boot-delay', i * 55 + 'ms');
      p.classList.add('is-booting');
      p.addEventListener('animationend', function done(e) {
        if (e.target !== p || e.animationName !== 'boot') return;
        p.classList.remove('is-booting');
        p.removeEventListener('animationend', done);
      });
    });
  }
  bus.on('boot', () => {
    bus.emit('alert', { level: 'info', msg: `FEDLIGHT CONSOLE ONLINE · SESSION FED-${U.randHex(6, R)}`, source: 'SYS', panel: 'shell', time: Date.now() });
  });
})();
