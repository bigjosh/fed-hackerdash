/* FEDLIGHT · P-10 ORBITAL SWEEP
   A PPI radar scope: pre-rendered range rings and bearing bezel, a rotating conic sweep whose
   afterglow also lights the ground clutter, blips with phosphor persistence and history dots,
   six tracked contacts (WRAITH steers by target:move when the map is talking), a contact table,
   an A-scope strip and a track log when the panel has room for them. */
(() => {
  'use strict';

  const TAU = Math.PI * 2;
  const RANGE = 12; // km at the outer range ring
  const TS = 7; // contacts move 7x real time so the picture visibly evolves between sweeps
  const ROWS = 7;
  const MONO = (px, w = 500) => `${w} ${px}px "JetBrains Mono", Consolas, monospace`;
  const UI = (px) => `600 ${px}px "Chakra Petch", "Segoe UI", sans-serif`;
  const DISP = (px) => `${px}px Michroma, "Arial Black", sans-serif`;
  // The scope sits on central Paris. km east / km south of the origin, for the ground picture and
  // for placing WRAITH from target:move lat/lon.
  const LAT0 = 48.8566;
  const LON0 = 2.3522;
  const KM_LAT = 110.57;
  const KM_LON = 111.32 * Math.cos((LAT0 * Math.PI) / 180);
  // The Seine from Choisy downstream through Paris, round the Boulogne meander and up to Saint-Denis.
  const SEINE = [
    [4.3, 10.1], [3.9, 6.8], [4.5, 4.4], [2.3, 3.2], [1.8, 2.6], [0.9, 1.3], [0.5, 0.7], [-0.2, 0.4],
    [-0.8, -0.1], [-2.4, -0.8], [-3.7, -0.7], [-4.4, -0.4], [-4.7, 0.1], [-5.3, 0.7], [-5.6, 1.1],
    [-6.1, 2], [-6.9, 3], [-8.2, 3.6], [-9.2, 3.3], [-9.5, 1.4], [-9.2, -1.5], [-8.2, -2.4],
    [-6.8, -3.3], [-4.6, -5.6], [-2.4, -6.2], [-0.9, -7.6], [-1.3, -8.7], [-3.5, -10.7], [-7.5, -9.8],
  ];
  const BRIDGES = [3, 5, 7, 8, 9, 10, 11, 13, 15, 19, 22, 24];

  HD.panel('radar', (ctx) => {
    const { util: U, color: C, rgba } = ctx;
    const R = ctx.rng(HD.seed ^ 0x7ad4c3);
    const RM = ctx.reducedMotion;
    const PERIOD = RM ? 9 : 3.6; // seconds per turn
    const S = ctx.state;

    /* ---------------------------------------------------------------- DOM */

    const tbl = U.el('div', 'rad-tbl');
    tbl.innerHTML =
      '<div class="rad-tr rad-th"><span>ID</span><span class="rad-iff">IFF</span><span>BRG</span><span>RNG</span><span>SPD</span></div>';
    const logBox = U.el('div', 'rad-log');
    const RPM = (60 / PERIOD).toFixed(1);
    logBox.innerHTML = `<div class="rad-lh"><span>TRACK LOG</span><b>SWEEP ${RPM} RPM</b></div><div class="rad-ll"></div>`;
    const logList = logBox.querySelector('.rad-ll');
    ctx.el.append(tbl, logBox);
    const cv = ctx.canvas({ className: 'rad-cv' });

    const stat = document.createElement('canvas'); // rings, bezel, labels, frames
    const clutter = document.createElement('canvas'); // ground returns, revealed by the sweep
    const mask = document.createElement('canvas'); // long-tail persistence wedge
    const wedge = document.createElement('canvas'); // bright beam wedge
    const tmp = document.createElement('canvas');
    const glowSpr = {};
    // Chrome may drop 2D canvas backing stores under memory pressure; they come back blank with a
    // 'contextrestored' event. The cached layers never repaint on their own, so rebuild them all.
    let lost = false;
    const watch = (c) => c.addEventListener('contextrestored', () => (lost = true));
    [cv.canvas, stat, clutter, mask, wedge, tmp].forEach(watch);

    /* ----------------------------------------------------------- contacts */

    const contacts = [];
    const add = (id, kind, col, iff) => {
      const k = {
        id, kind, col, iff, x: 0, y: 0, hdg: 0, want: 0, spd: 100, wantSpd: 100,
        hit: -1e9, px: 0, py: 0, hist: [], tracked: true, hidden: 0, due: 0, turnAt: 0,
        path: null, row: null, cells: null, spr: null, hot: false, lostAt: -1e9,
        sx: 0, sy: 0, ex: 0, ey: 0, I: 0, vis: false,
      };
      contacts.push(k);
      return k;
    };
    const TGT = add(S.target.codename || 'WRAITH', 'tgt', 'threat', 'HOS');
    const KES = add('KESTREL', 'unit', 'holo', 'FRD');
    const D04 = add('DRONE-04', 'drone', 'text', 'NEU');
    const D11 = add('DRONE-11', 'drone', 'text', 'NEU');
    const SA = add('SAT-KH9', 'sat', 'holo2', 'FRD');
    const SB = add('SAT-ORB2', 'sat', 'holo2', 'NEU');
    const UNK = add('UNK-00', 'unk', 'amber', 'UNK');

    const rangeOf = (k) => Math.hypot(k.x, k.y);
    const brgOf = (k) => (Math.atan2(k.x, -k.y) + TAU) % TAU;
    const turn = (k, want, rate, dt) => {
      const d = ((want - k.hdg + Math.PI * 3) % TAU) - Math.PI;
      k.hdg = (k.hdg + U.clamp(d, -rate * dt, rate * dt) + TAU) % TAU;
    };
    const advance = (k, dt) => {
      const d = (k.spd / 3600) * TS * dt;
      k.x += Math.sin(k.hdg) * d;
      k.y -= Math.cos(k.hdg) * d;
    };
    const toward = (k, x, y) => (Math.atan2(x - k.x, -(y - k.y)) + TAU) % TAU;

    function placePolar(k, r, b) {
      k.x = Math.sin(b) * r;
      k.y = -Math.cos(b) * r;
    }

    function satInit(k, mid) {
      const a = R.range(0, TAU);
      k.path = {
        dx: Math.sin(a), dy: -Math.cos(a), nx: Math.cos(a), ny: Math.sin(a),
        off: R.range(-0.55, 0.55) * RANGE,
        cur: R.range(-0.014, 0.014),
        s: mid ? R.range(-0.45, 0.35) * RANGE : -1.12 * RANGE,
        vs: (2.2 * RANGE) / R.range(48, 72),
      };
      k.spd = R.int(26900, 27700);
      satPos(k);
    }
    function satPos(k) {
      const p = k.path;
      const s = p.s;
      const bend = p.off + p.cur * s * s;
      k.x = p.nx * bend + p.dx * s;
      k.y = p.ny * bend + p.dy * s;
      const tx = p.dx + p.nx * 2 * p.cur * s;
      const ty = p.dy + p.ny * 2 * p.cur * s;
      k.hdg = (Math.atan2(tx, -ty) + TAU) % TAU;
    }

    function unkSpawn() {
      UNK.id = `UNK-${U.pad(R.int(11, 97))}`;
      UNK.spr = null;
      if (UNK.cells) UNK.cells[0].textContent = UNK.id;
      const b = R.range(0, TAU);
      placePolar(UNK, RANGE * 1.04, b);
      UNK.hdg = (b + Math.PI + R.range(-0.45, 0.45) + TAU) % TAU;
      UNK.spd = R.int(260, 420);
      UNK.hidden = 0;
      UNK.fadeAt = R() < 0.35 ? performance.now() + R.range(9000, 15000) : 0;
    }

    function initContacts() {
      // spread the opening picture: one 60° sector each so blips and labels start apart
      const sec = R.shuffle([0, 1, 2, 3, 4, 5]);
      const inSec = (i) => ((sec[i] + R.range(0.2, 0.8)) * TAU) / 6;
      placePolar(TGT, RANGE * R.range(0.34, 0.52), inSec(0));
      TGT.hdg = TGT.want = R.int(0, 3) * (Math.PI / 2);
      TGT.spd = TGT.wantSpd = R.int(110, 150);
      const kb = brgOf(TGT) + R.sign() * R.range(0.5, 0.8);
      placePolar(KES, rangeOf(TGT) * R.range(0.9, 1.25), kb);
      KES.hdg = toward(KES, TGT.x, TGT.y);
      KES.spd = 140;
      [D04, D11].forEach((d, i) => {
        placePolar(d, RANGE * R.range(0.5, 0.82), inSec(i + 2));
        d.hdg = d.want = R.range(0, TAU);
        d.spd = d.wantSpd = R.int(60, 105);
      });
      satInit(SA, true);
      satInit(SB, true);
      UNK.tracked = false;
      UNK.hidden = 1;
      placePolar(UNK, RANGE * 1.5, 0);
    }
    initContacts();

    /* -------------------------------------------------------------- state */

    let sweep = R.range(0, TAU);
    let started = 0;
    let lastAlert = 0;
    let unkDue = 0;
    let d11Drop = 0;
    let moveAt = -1e9; // last target:move
    let mv = null;
    let jamUntil = 0;
    let jamSeed = 0;
    let vox = 0;
    let urg = 0;
    let geoFix = false;
    let lastTable = 0;
    let lastClock = '';
    let metaN = -1;
    const fx = []; // {x, y, t0, kind}
    let L = null; // layout
    let link = null; // KESTREL→target midpoint for the separation label
    const logRows = [];

    /* ------------------------------------------------------------- table */

    const tableRows = contacts.map((k) => {
      const row = U.el('div', `rad-tr is-${k.kind}`);
      const cells = ['id', 'iff', 'brg', 'rng', 'spd'].map((n) => {
        const s = U.el('span', n === 'iff' ? 'rad-iff' : n === 'id' ? 'rad-id' : '');
        row.appendChild(s);
        return s;
      });
      cells[0].textContent = k.id;
      cells[1].textContent = k.iff;
      k.row = row;
      k.cells = cells;
      tbl.appendChild(row);
      return row;
    });

    function updateTable(now) {
      let n = 0;
      for (const k of contacts) {
        const show = k.kind !== 'unk' || k.tracked || now - k.lostAt < 6000;
        k.row.hidden = !show;
        if (!show) continue;
        const b = k.tracked ? U.pad(Math.round((brgOf(k) * 180) / Math.PI) % 360, 3) : '---';
        const r = k.tracked ? rangeOf(k).toFixed(1) : 'LOST';
        const s = k.kind === 'sat' ? (k.spd / 1000).toFixed(1) + 'K' : String(Math.round(k.spd));
        if (k.cells[2].textContent !== b) k.cells[2].textContent = b;
        if (k.cells[3].textContent !== r) k.cells[3].textContent = r;
        if (k.cells[4].textContent !== s) k.cells[4].textContent = s;
        k.row.classList.toggle('is-lost', !k.tracked);
        if (k.tracked && k !== TGT) n++;
      }
      if (n !== metaN) {
        metaN = n;
        ctx.meta(`${n} CONTACTS`);
      }
    }

    function clock() {
      return U.fmtClock(new Date(), HD.tz.offset);
    }

    function logLine(text, cls) {
      const row = U.el('div', 'rad-lr' + (cls ? ' is-' + cls : ''));
      row.append(U.el('i', '', clock()), U.el('span', '', text));
      logList.prepend(row);
      logRows.unshift(row);
      while (logRows.length > 12) logRows.pop().remove();
    }
    // boot history, oldest first (each line is prepended)
    logLine(`SWEEP ONLINE · X-BAND · ${RPM} RPM`, 'ok');
    logLine('GROUND MAP · PARIS · SEINE / PÉRIPH', '');
    logLine('CLUTTER MAP LEARNED · 420 CELLS', '');
    logLine('KESTREL DATALINK · ENCRYPTED', 'new');
    logLine('TRACK INIT · 6 CONTACTS', '');
    logLine('IFF MODE-5 INTERROGATE · OK', '');
    logLine('TGT ' + TGT.id + ' DESIGNATED · HOSTILE', 'tgt');

    function contactEvent(k, kind, now) {
      const b = U.pad(Math.round((brgOf(k) * 180) / Math.PI) % 360, 3);
      const r = rangeOf(k).toFixed(1);
      if (kind === 'new') {
        logLine(`NEW CONTACT ${k.id} · ${b}° ${r}KM`, k.kind === 'unk' ? 'warn' : 'new');
        fx.push({ x: k.x, y: k.y, t0: now, kind, k });
      } else {
        logLine(`CONTACT LOST ${k.id} · LAST ${b}°`, 'lost');
        fx.push({ x: k.px, y: k.py, t0: now, kind, k });
        k.lostAt = now;
      }
      if (fx.length > 6) fx.shift();
      if (now - lastAlert >= 15000 && now - started > 6000) {
        lastAlert = now;
        ctx.alert('info', kind === 'new' ? `NEW CONTACT ${k.id} · BRG ${b} · ${r} KM` : `CONTACT LOST ${k.id} · LAST BRG ${b}`);
      }
      ctx.audio.beep(kind === 'new' ? 1480 : 520, 60, 'sine', 0.02);
    }

    /* ----------------------------------------------------------- simulate */

    function simulate(now, dt) {
      // target: follows the map's heading/speed when it is talking, grid-wanders otherwise
      if (mv && now - moveAt < 3000) {
        TGT.want = mv.hdg;
        TGT.wantSpd = mv.spd;
        turn(TGT, TGT.want, 2.4, dt);
        TGT.spd = U.damp(TGT.spd, TGT.wantSpd, 2, dt);
        advance(TGT, dt);
        // a real Paris fix is trusted more than the map's normalised coordinates
        const k = 1 - Math.exp(-(mv.geo ? 1.2 : 0.35) * dt);
        TGT.x += (mv.x - TGT.x) * k;
        TGT.y += (mv.y - TGT.y) * k;
      } else {
        if (now > TGT.turnAt) {
          TGT.turnAt = now + R.range(3500, 8000);
          const r = rangeOf(TGT);
          if (r > RANGE * 0.62) {
            // pick the grid direction that heads most toward the centre
            const home = toward(TGT, 0, 0);
            TGT.want = Math.round(home / (Math.PI / 2)) * (Math.PI / 2);
          } else if (R() < 0.7) TGT.want = (TGT.want + R.sign() * (Math.PI / 2) + TAU) % TAU;
          TGT.wantSpd = R.int(95, 175) * (1 + 0.2 * urg);
        }
        turn(TGT, TGT.want, 1.5, dt);
        TGT.spd = U.damp(TGT.spd, TGT.wantSpd, 0.8, dt);
        advance(TGT, dt);
      }
      // KESTREL closes on the target but holds a stand-off
      const dist = Math.hypot(TGT.x - KES.x, TGT.y - KES.y);
      turn(KES, toward(KES, TGT.x, TGT.y), dist < 1.5 ? 0.5 : 0.9, dt);
      KES.spd = U.damp(KES.spd, dist > 3 ? 168 : dist > 1.6 ? 128 : 84, 1, dt);
      advance(KES, dt);
      // drones drift on a random walk, turning back at the edge
      for (const d of [D04, D11]) {
        if (now > d.turnAt) {
          d.turnAt = now + R.range(2500, 6000);
          d.want = (d.want + R.range(-1.1, 1.1) + TAU) % TAU;
          d.wantSpd = R.int(55, 110);
        }
        if (rangeOf(d) > RANGE * 0.84) d.want = toward(d, 0, 0);
        turn(d, d.want, 0.7, dt);
        d.spd = U.damp(d.spd, d.wantSpd, 0.6, dt);
        advance(d, dt);
      }
      // satellites ride long arcs across the scope, then re-enter from elsewhere
      for (const s of [SA, SB]) {
        s.path.s += s.path.vs * dt;
        satPos(s);
        if (s.path.s > RANGE * 1.2) {
          if (!s.due) s.due = now + R.range(4000, 9000);
          else if (now > s.due) {
            s.due = 0;
            satInit(s, false);
          }
        }
      }
      // transient unknown
      if (UNK.hidden) {
        if (!unkDue) unkDue = now + R.range(9000, 16000);
        if (now > unkDue) {
          unkDue = 0;
          unkSpawn();
        }
      } else {
        advance(UNK, dt);
        if (UNK.fadeAt && now > UNK.fadeAt) UNK.hidden = 1;
        if (rangeOf(UNK) > RANGE * 1.1 && Math.cos(brgOf(UNK) - UNK.hdg) > 0) UNK.hidden = 1;
      }
      // DRONE-11 drops below the radar horizon now and then
      if (!d11Drop) d11Drop = now + R.range(30000, 45000);
      if (now > d11Drop && !D11.hidden) {
        D11.hidden = now + R.range(7000, 11000);
        d11Drop = now + R.range(40000, 60000);
      }
      if (D11.hidden && D11.hidden !== 1 && now > D11.hidden) D11.hidden = 0;

      // tracked-state transitions drive NEW / LOST
      for (const k of contacts) {
        const inside = !k.hidden && rangeOf(k) <= RANGE;
        if (inside !== k.tracked) {
          k.tracked = inside;
          if (started && now - started > 1500) contactEvent(k, inside ? 'new' : 'lost', now);
          if (inside) k.hist.length = 0;
        }
      }
    }

    function paint(k, now) {
      k.hist.unshift(k.px, k.py);
      if (k.hist.length > (k === TGT ? 16 : 10)) k.hist.length = k === TGT ? 16 : 10;
      k.px = k.x;
      k.py = k.y;
      k.hit = now;
      if (!RM && !k.hot) {
        k.hot = true;
        k.row.classList.add('is-hit');
      }
    }

    /* ------------------------------------------------------------- layout */

    function layout(w, h) {
      const big = Math.min(w, h) >= 380;
      const rowH = big ? 13 : 11;
      const TH = 15 + ROWS * rowH + 4;
      const TW = w >= 340 ? 146 : 132;
      const sideD = Math.min(h, w - TW - 6);
      const stackD = Math.min(w, h - TH - 4);
      const mode = Math.max(sideD, stackD) < 150 || w < 130 ? 'solo' : stackD >= sideD ? 'stack' : 'side';
      let scope;
      let tb = null;
      let asc = null;
      let lg = null;
      if (mode === 'solo') scope = { x: 0, y: 0, w, h };
      else if (mode === 'stack') {
        const sh = Math.min(h - TH - 4, Math.round(w * 1.02));
        scope = { x: 0, y: 0, w, h: sh };
        let y = sh + 2;
        if (h - sh - TH >= 150) {
          asc = { x: 6, y, w: w - 12, h: 56 };
          y += 62;
        }
        tb = { x: 5, y, w: w - 10, h: TH };
        y += TH + 4;
        if (h - y >= 44) lg = { x: 5, y, w: w - 10, h: h - y - 4 };
      } else {
        scope = { x: 0, y: 0, w: w - TW - 6, h };
        const x = w - TW - 5;
        let y = 5;
        tb = { x, y, w: TW, h: TH };
        y += TH + 6;
        if (h - y >= 120) {
          asc = { x, y, w: TW, h: 52 };
          y += 58;
        }
        if (h - y >= 44) lg = { x, y, w: TW, h: h - y - 4 };
      }
      const rad = Math.max(20, Math.min(scope.w, scope.h) / 2 - 3);
      const bez = rad >= 110 ? 22 : rad >= 70 ? 19 : 14;
      L = {
        w, h, mode, scope, tb, asc, lg, rowH, big,
        cx: Math.round(scope.x + scope.w / 2), cy: Math.round(scope.y + scope.h / 2),
        rad, rr: rad - bez, labels: rad >= 64, corners: [],
      };
      const place = (el, r) => {
        el.hidden = !r;
        if (r) el.style.cssText = `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`;
      };
      place(tbl, tb);
      place(logBox, lg);
      tbl.classList.toggle('is-big', big);
      tbl.classList.toggle('is-narrow', !!tb && tb.w < 200);
      buildLayers();
    }

    // How much horizontal room a corner text line has before it would touch the scope ring.
    function cornerRoom(yTop, yBot, left) {
      const { cx, cy, rad, scope } = L;
      const yy = yBot < cy ? yBot : yTop > cy ? yTop : cy;
      const dy = Math.abs(yy - cy);
      const half = dy >= rad + 2 ? 0 : Math.sqrt((rad + 2) * (rad + 2) - dy * dy);
      return left ? cx - half - (scope.x + 4) - 3 : scope.x + scope.w - 4 - (cx + half) - 3;
    }

    function buildLayers() {
      const d = cv.dpr;
      const { w, h, cx, cy, rad, rr, asc } = L;
      stat.width = Math.max(1, Math.round(w * d));
      stat.height = Math.max(1, Math.round(h * d));
      const g = stat.getContext('2d');
      g.setTransform(d, 0, 0, d, 0, 0);
      g.clearRect(0, 0, w, h);

      // disc
      const bg = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
      bg.addColorStop(0, 'rgba(8, 40, 50, 0.55)');
      bg.addColorStop(0.75, 'rgba(3, 18, 26, 0.7)');
      bg.addColorStop(1, 'rgba(2, 8, 14, 0.9)');
      g.fillStyle = bg;
      g.beginPath();
      g.arc(cx, cy, rad, 0, TAU);
      g.fill();

      // faint square grid inside the range area
      g.save();
      g.beginPath();
      g.arc(cx, cy, rr, 0, TAU);
      g.clip();
      g.strokeStyle = rgba('holo', 0.045);
      g.lineWidth = 1;
      g.beginPath();
      const gs = rr / 6;
      for (let i = -6; i <= 6; i++) {
        const o = Math.round(i * gs) + 0.5;
        g.moveTo(cx + o, cy - rr); g.lineTo(cx + o, cy + rr);
        g.moveTo(cx - rr, cy + o); g.lineTo(cx + rr, cy + o);
      }
      g.stroke();
      g.restore();

      // range rings (+ dashed half rings)
      for (let i = 1; i <= 4; i++) {
        g.strokeStyle = rgba('holo', i === 4 ? 0.45 : 0.26);
        g.beginPath();
        g.arc(cx, cy, (rr * i) / 4, 0, TAU);
        g.stroke();
      }
      g.setLineDash([2, 4]);
      g.strokeStyle = rgba('holo', 0.1);
      for (let i = 0; i < 4; i++) {
        g.beginPath();
        g.arc(cx, cy, (rr * (i + 0.5)) / 4, 0, TAU);
        g.stroke();
      }
      // cross hairs + diagonals
      g.strokeStyle = rgba('holo', 0.18);
      g.setLineDash([]);
      g.beginPath();
      g.moveTo(cx - rr, cy + 0.5); g.lineTo(cx + rr, cy + 0.5);
      g.moveTo(cx + 0.5, cy - rr); g.lineTo(cx + 0.5, cy + rr);
      g.stroke();
      g.setLineDash([1, 5]);
      g.strokeStyle = rgba('holo', 0.12);
      g.beginPath();
      for (const a of [Math.PI / 4, (3 * Math.PI) / 4]) {
        g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
        g.lineTo(cx - Math.cos(a) * rr, cy - Math.sin(a) * rr);
      }
      g.stroke();
      g.setLineDash([]);

      // bezel: outer rings, degree ticks, bearing labels every 30°
      g.strokeStyle = rgba('holo', 0.55);
      g.beginPath();
      g.arc(cx, cy, rad - 0.5, 0, TAU);
      g.stroke();
      g.strokeStyle = rgba('holo', 0.22);
      g.beginPath();
      g.arc(cx, cy, rr + 1.5, 0, TAU);
      g.stroke();
      g.beginPath();
      for (let deg = 0; deg < 360; deg += 5) {
        const a = (deg * Math.PI) / 180 - Math.PI / 2;
        const len = deg % 30 === 0 ? 7 : deg % 10 === 0 ? 5 : 2.5;
        const c0 = Math.cos(a);
        const s0 = Math.sin(a);
        g.moveTo(cx + c0 * (rad - 1), cy + s0 * (rad - 1));
        g.lineTo(cx + c0 * (rad - 1 - len), cy + s0 * (rad - 1 - len));
      }
      g.strokeStyle = rgba('holo', 0.6);
      g.stroke();
      if (L.labels) {
        g.font = MONO(9);
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        const lr = rad - (rad >= 110 ? 14 : 12.5);
        for (let deg = 0; deg < 360; deg += 30) {
          const a = (deg * Math.PI) / 180 - Math.PI / 2;
          g.fillStyle = deg === 0 ? C.ice : rgba('text', 0.75);
          g.fillText(deg === 0 ? 'N' : U.pad(deg, 3), cx + Math.cos(a) * lr, cy + Math.sin(a) * lr + 0.5);
        }
        // range labels just inside each ring on the south axis
        g.fillStyle = C.dim;
        g.textAlign = 'left';
        g.textBaseline = 'alphabetic';
        for (let i = 1; i <= 4; i++) {
          if (i < 4 && rr < 60) continue;
          g.fillText(i === 4 ? '12 KM' : String(i * 3), cx + 3, cy + (rr * i) / 4 - 3);
        }
        g.textAlign = 'left';
        g.textBaseline = 'alphabetic';
      }
      // own position
      g.strokeStyle = rgba('ice', 0.8);
      g.beginPath();
      g.moveTo(cx - 4, cy + 0.5); g.lineTo(cx + 4, cy + 0.5);
      g.moveTo(cx + 0.5, cy - 4); g.lineTo(cx + 0.5, cy + 4);
      g.stroke();

      // corner readouts (only where they clear the ring)
      L.corners = [];
      const sc = L.scope;
      const corner = (text, left, top, line, dyn, col) => {
        const y = top ? sc.y + 11 + line * 11 : sc.y + sc.h - 5 - line * 11;
        const room = cornerRoom(y - 8, y + 1, left);
        g.font = MONO(9);
        const tw = g.measureText(dyn ? dyn : text).width;
        if (tw > room) return;
        const x = left ? sc.x + 5 : sc.x + sc.w - 5;
        if (dyn) L.corners.push({ x, y, left, key: text, col });
        else {
          g.fillStyle = col || C.dim;
          g.textAlign = left ? 'left' : 'right';
          g.fillText(text, x, y);
          g.textAlign = 'left';
        }
      };
      corner('PPI 12KM', true, true, 0, null, rgba('holo', 0.85));
      corner('TWS · X-BAND', true, true, 1);
      corner('GAIN 42dB', false, true, 0);
      corner('PRF 1.2kHz', false, true, 1);
      corner('swp', true, false, 1, 'SWP 000.0°', C.ice);
      corner('RPM ' + RPM, true, false, 0);
      corner('trk', false, false, 1, 'TRK 07', C.text);
      corner('utc', false, false, 0, '00:00:00', C.dim);

      // A-scope frame
      if (asc) {
        g.strokeStyle = rgba('holo', 0.3);
        g.strokeRect(asc.x + 0.5, asc.y + 0.5, asc.w - 1, asc.h - 1);
        g.fillStyle = 'rgba(1, 10, 14, 0.6)';
        g.fillRect(asc.x + 1, asc.y + 1, asc.w - 2, asc.h - 2);
        g.font = UI(9);
        g.fillStyle = rgba('holo', 0.85);
        g.fillText('A-SCOPE', asc.x + 5, asc.y + 11);
        const base = asc.y + asc.h - 13;
        g.strokeStyle = rgba('holo', 0.25);
        g.beginPath();
        g.moveTo(asc.x + 4, base + 0.5); g.lineTo(asc.x + asc.w - 4, base + 0.5);
        for (let i = 0; i <= 4; i++) {
          const x = Math.round(asc.x + 4 + ((asc.w - 8) * i) / 4) + 0.5;
          g.moveTo(x, base); g.lineTo(x, base + 3);
        }
        g.stroke();
        g.font = MONO(9);
        g.fillStyle = C.dim;
        for (let i = 0; i <= 4; i++) {
          const x = asc.x + 4 + ((asc.w - 8) * i) / 4;
          g.textAlign = i === 0 ? 'left' : i === 4 ? 'right' : 'center';
          g.fillText(String(i * 3), x, asc.y + asc.h - 3);
        }
        g.textAlign = 'left';
      }

      // sprites share one size: the range area at 1 px per CSS px (soft glows need no retina)
      const size = Math.max(8, Math.ceil(rr * 2));
      for (const cnv of [clutter, mask, wedge, tmp]) {
        cnv.width = size;
        cnv.height = size;
      }
      buildClutter(size);
      buildWedges(size);
      for (const name of ['threat', 'holo', 'holo2', 'text', 'amber', 'ice']) glowSpr[name] = glowSprite(C[name] || name);
      for (const k of contacts) k.spr = null;
    }

    function buildClutter(size) {
      const g = clutter.getContext('2d');
      const r0 = size / 2;
      const cr = HD.rng(HD.seed ^ 0xc1077e);
      g.clearRect(0, 0, size, size);
      // ground clutter close in, thinning with range
      for (let i = 0; i < 420; i++) {
        const r = Math.pow(cr(), 2.2) * r0 * 0.36;
        const a = cr() * TAU;
        g.fillStyle = cr() < 0.25 ? rgba('holo', 0.5 + cr() * 0.5) : rgba('holo2', 0.35 + cr() * 0.5);
        const s = cr() < 0.2 ? 2 : 1;
        g.fillRect(r0 + Math.cos(a) * r, r0 + Math.sin(a) * r, s, s);
      }
      // the Seine: water gives no return, so it reads as a dark channel between bright quays,
      // with hard returns where the bridges cross
      const k = r0 / RANGE;
      const inDisc = (x, y) => Math.hypot(x - r0, y - r0) < r0 - 1;
      for (let i = 0; i < SEINE.length - 1; i++) {
        const [ax, ay] = SEINE[i];
        const [bx, by] = SEINE[i + 1];
        const len = Math.hypot(bx - ax, by - ay);
        const nx = -(by - ay) / len;
        const ny = (bx - ax) / len;
        const bank = Math.max(1.3, 0.09 * k);
        const steps = Math.max(2, Math.ceil(len * k * 1.6));
        for (let j = 0; j < steps; j++) {
          const t = j / steps;
          const x = r0 + (ax + (bx - ax) * t) * k;
          const y = r0 + (ay + (by - ay) * t) * k;
          for (const side of [-1, 1]) {
            if (cr() < 0.25) continue;
            const o = bank + cr() * 1.2;
            const qx = x + nx * o * side;
            const qy = y + ny * o * side;
            if (!inDisc(qx, qy)) continue;
            g.fillStyle = rgba('holo', 0.4 + cr() * 0.45);
            g.fillRect(qx, qy, cr() < 0.25 ? 2 : 1, 1);
          }
        }
        if (BRIDGES.includes(i)) {
          for (let o = -bank - 1; o <= bank + 1; o += 0.8) {
            const qx = r0 + ax * k + nx * o;
            const qy = r0 + ay * k + ny * o;
            if (!inDisc(qx, qy)) continue;
            g.fillStyle = rgba('ice', 0.5 + cr() * 0.3);
            g.fillRect(qx, qy, 1, 1);
          }
        }
      }
      // the Boulevard Périphérique: a faint dotted loop round the city
      for (let a = 0; a < TAU; a += 0.014) {
        if (cr() < 0.35) continue;
        const wob = 1 + 0.06 * Math.sin(a * 3 + 0.8) + 0.04 * Math.sin(a * 5);
        const x = r0 + (-1.3 + Math.cos(a) * 5.6 * wob) * k;
        const y = r0 + (-0.4 + Math.sin(a) * 4.1 * wob) * k;
        g.fillStyle = rgba('holo2', 0.3 + cr() * 0.35);
        g.fillRect(x, y, 1, 1);
      }
      // two weather cells
      for (let c = 0; c < 2; c++) {
        const a = cr() * TAU;
        const rr0 = r0 * (0.45 + cr() * 0.35);
        const x0 = r0 + Math.cos(a) * rr0;
        const y0 = r0 + Math.sin(a) * rr0;
        const sp = r0 * (0.06 + cr() * 0.05);
        for (let i = 0; i < 90; i++) {
          const x = x0 + (cr() + cr() + cr() - 1.5) * sp * 1.6;
          const y = y0 + (cr() + cr() + cr() - 1.5) * sp;
          g.fillStyle = rgba('holo2', 0.18 + cr() * 0.35);
          g.fillRect(x, y, 1 + (cr() < 0.3), 1);
        }
      }
    }

    // Both wedges point along +x; the tail trails counter-clockwise (where the beam has been).
    function buildWedges(size) {
      const r0 = size / 2;
      let g = mask.getContext('2d');
      g.clearRect(0, 0, size, size);
      let cg = g.createConicGradient(0, r0, r0);
      for (let i = 0; i <= 12; i++) {
        const p = i / 12;
        cg.addColorStop(Math.min(0.999, p), `rgba(255,255,255,${(0.06 + 0.94 * Math.exp(-(1 - p) * 3)).toFixed(3)})`);
      }
      cg.addColorStop(1, 'rgba(255,255,255,0.06)');
      g.fillStyle = cg;
      g.beginPath();
      g.arc(r0, r0, r0, 0, TAU);
      g.fill();

      g = wedge.getContext('2d');
      g.clearRect(0, 0, size, size);
      cg = g.createConicGradient(0, r0, r0);
      const tail = 0.25; // ~90° of afterglow
      cg.addColorStop(0, rgba('holo', 0));
      cg.addColorStop(1 - tail, rgba('holo', 0));
      cg.addColorStop(1 - tail * 0.66, rgba('holo', 0.06));
      cg.addColorStop(1 - tail * 0.33, rgba('holo', 0.15));
      cg.addColorStop(1 - tail * 0.12, rgba('holo', 0.3));
      cg.addColorStop(1 - tail * 0.03, rgba('holo', 0.46));
      cg.addColorStop(0.999, rgba('holo', 0.6));
      cg.addColorStop(1, rgba('holo', 0));
      g.fillStyle = cg;
      g.beginPath();
      g.arc(r0, r0, r0, 0, TAU);
      g.fill();
    }

    function glowSprite(col) {
      const s = document.createElement('canvas');
      watch(s);
      s.width = s.height = 28;
      const g = s.getContext('2d');
      const gr = g.createRadialGradient(14, 14, 0, 14, 14, 14);
      gr.addColorStop(0, rgba(col, 0.9));
      gr.addColorStop(0.25, rgba(col, 0.35));
      gr.addColorStop(1, rgba(col, 0));
      g.fillStyle = gr;
      g.fillRect(0, 0, 28, 28);
      return s;
    }

    // small scopes get short tags (KH9, D04, KES) so six labels fit without piling up
    const tag = (k) =>
      L.rr >= 72 || k === TGT ? k.id : k.id.replace('SAT-', '').replace('DRONE-', 'D').replace('KESTREL', 'KES').replace('UNK-', 'U');

    function labelSprite(k) {
      const d = cv.dpr;
      const s = document.createElement('canvas');
      watch(s);
      const g = s.getContext('2d');
      const text = tag(k);
      g.font = MONO(9);
      const w = Math.ceil(g.measureText(text).width) + 4;
      s.width = Math.ceil(w * d);
      s.height = Math.ceil(12 * d);
      g.setTransform(d, 0, 0, d, 0, 0);
      g.font = MONO(9);
      g.fillStyle = 'rgba(2, 5, 10, 0.55)';
      g.fillRect(0, 0, w, 12);
      g.fillStyle = C[k.col] || k.col;
      g.textBaseline = 'middle';
      g.fillText(text, 2, 6.5);
      k.spr = { cv: s, w, h: 12 };
    }

    /* --------------------------------------------------------------- draw */

    const toX = (x) => L.cx + (x / RANGE) * L.rr;
    const toY = (y) => L.cy + (y / RANGE) * L.rr;

    // Pass 1: marks (history, vector, blip, reticle). Stores the screen position for labelling.
    function drawMarks(g, k, now, pulse) {
      k.vis = false;
      const age = now - k.hit;
      const I = Math.exp(-age / (PERIOD * 1000 * 0.42));
      if (I < 0.02 && !k.tracked) return;
      const col = C[k.col];
      const sx = toX(k.px);
      const sy = toY(k.py);
      for (let i = 0; i < k.hist.length; i += 2) {
        g.fillStyle = rgba(k.col, Math.max(0.08, 0.55 - i * (k === TGT ? 0.03 : 0.045)));
        g.fillRect(toX(k.hist[i]) - 1, toY(k.hist[i + 1]) - 1, 2, 2);
      }
      if (!k.tracked && age > PERIOD * 1000) return;
      k.vis = true;
      k.sx = sx;
      k.sy = sy;
      k.I = I;
      const len = k.kind === 'sat' ? L.rr * 0.15 : U.clamp(k.spd / 160, 0.25, 1.3) * L.rr * 0.12;
      const vx = Math.sin(k.hdg);
      const vy = -Math.cos(k.hdg);
      k.ex = sx + vx * len;
      k.ey = sy + vy * len;
      g.strokeStyle = rgba(k.col, 0.4 + 0.4 * I);
      g.beginPath();
      g.moveTo(sx, sy);
      g.lineTo(k.ex, k.ey);
      g.stroke();
      if (k === TGT && L.rr >= 60) {
        // predicted track: amber = where we think it is going
        const pl = L.rr * 0.3;
        g.setLineDash([2, 3]);
        g.strokeStyle = rgba('amber', 0.6);
        g.beginPath();
        g.moveTo(k.ex, k.ey);
        g.lineTo(k.ex + vx * pl, k.ey + vy * pl);
        g.stroke();
        g.setLineDash([]);
        g.fillStyle = rgba('amber', 0.8);
        for (const f of [0.5, 1]) g.fillRect(k.ex + vx * pl * f - 1.5, k.ey + vy * pl * f - 1.5, 3, 3);
      }
      const spr = glowSpr[k.col];
      if (spr && I > 0.03) {
        const gs = k === TGT ? 30 : 22;
        g.globalAlpha = Math.min(1, I * 1.15);
        g.drawImage(spr, sx - gs / 2, sy - gs / 2, gs, gs);
        g.globalAlpha = 1;
      }
      g.fillStyle = I > 0.55 ? C.ice : col;
      g.globalAlpha = 0.62 + 0.38 * I;
      const bs = k === TGT ? 5 : 4;
      if (k.kind === 'sat') {
        g.beginPath();
        g.moveTo(sx, sy - 3.5); g.lineTo(sx + 3.5, sy); g.lineTo(sx, sy + 3.5); g.lineTo(sx - 3.5, sy);
        g.fill();
      } else g.fillRect(Math.round(sx - bs / 2), Math.round(sy - bs / 2), bs, bs);
      g.globalAlpha = 1;
      if (k === TGT) {
        const s = 7 + pulse * 2;
        g.strokeStyle = C.threat;
        g.lineWidth = 1.2;
        g.beginPath();
        for (const [ax, ay] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          g.moveTo(sx + ax * s, sy + ay * (s - 3));
          g.lineTo(sx + ax * s, sy + ay * s);
          g.lineTo(sx + ax * (s - 3), sy + ay * s);
        }
        g.stroke();
        g.lineWidth = 1;
      }
    }

    const placed = [];
    const avoid = [];
    // labels keep a 2 px gutter so two of them never read as one run of text
    const overlap = (a, b) => {
      const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) + 2;
      const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) + 1;
      return w > 0 && h > 0 ? w * h : 0;
    };
    // Greedy label placement: four candidate corners, scored by overlap with earlier labels,
    // blips and vector tips, and by how far they poke outside the scope ring.
    function placeLabel(sx, sy, w, h, o, list) {
      const cands = list || [
        [sx + o, sy - o - h + 3], [sx + o, sy + o - 3], [sx - o - w, sy - o - h + 3], [sx - o - w, sy + o - 3],
        [sx - w / 2, sy - o - h - 1], [sx - w / 2, sy + o + 1], [sx + o + 2, sy - h / 2], [sx - o - w - 2, sy - h / 2],
      ];
      let best = null;
      let bs = Infinity;
      for (const [x, y] of cands) {
        const r = { x, y, w, h };
        let s = 0;
        for (const p of placed) s += overlap(r, p) * 3;
        for (const [px, py] of avoid) if (px > x - 3 && px < x + w + 3 && py > y - 3 && py < y + h + 3) s += 80;
        for (const [qx, qy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
          const d = Math.hypot(qx - L.cx, qy - L.cy);
          if (d > L.rr + 2) s += (d - L.rr - 2) * 25;
        }
        if (s < bs) {
          bs = s;
          best = r;
        }
      }
      best.s = bs;
      placed.push(best);
      return best;
    }

    function drawLabels(g) {
      placed.length = 0;
      avoid.length = 0;
      for (const k of contacts) if (k.vis) avoid.push([k.sx, k.sy], [k.ex, k.ey], [(k.sx + k.ex) / 2, (k.sy + k.ey) / 2]);
      if (TGT.vis) placed.push({ x: TGT.sx - 10, y: TGT.sy - 10, w: 20, h: 20 });
      g.font = MONO(9);
      for (const k of [TGT, ...contacts.filter((c) => c !== TGT)]) {
        if (!k.vis) continue;
        if (!k.spr) labelSprite(k);
        const sp = k.spr;
        const two = k === TGT && L.rr >= 70;
        const r = placeLabel(k.sx, k.sy, two ? Math.max(sp.w, 50) : sp.w, two ? 23 : sp.h, k === TGT ? 11 : 6);
        g.globalAlpha = k.tracked ? 0.62 + 0.38 * k.I : 0.35;
        g.drawImage(sp.cv, r.x, r.y, sp.w, sp.h);
        if (two) {
          g.fillStyle = 'rgba(2, 5, 10, 0.55)';
          g.fillRect(r.x, r.y + 12, 50, 11);
          g.fillStyle = rgba('threat', 0.9);
          g.fillText(`${Math.round(k.spd)} KM/H`, r.x + 2, r.y + 21);
        }
        g.globalAlpha = 1;
      }
      // KESTREL → target separation, placed like any other label
      if (link) {
        const txt = `Δ${link.d.toFixed(1)}KM`;
        const tw = g.measureText(txt).width + 4;
        const x = link.x - tw / 2;
        const r = placeLabel(0, 0, tw, 11, 0, [[x, link.y - 5], [x, link.y - 18], [x, link.y + 8], [x - tw / 2 - 6, link.y - 5], [x + tw / 2 + 6, link.y - 5]]);
        // secondary readout: never drawn over a contact label or blip
        if (r.s < 1) {
          g.fillStyle = 'rgba(2, 5, 10, 0.72)';
          g.fillRect(r.x, r.y, tw, 11);
          g.fillStyle = rgba('holo', 0.95);
          g.fillText(txt, r.x + 2, r.y + 8.5);
        }
      }
    }

    function draw(now) {
      const g = cv.ctx;
      const { w, h, cx, cy, rad, rr } = L;
      cv.clear();
      g.drawImage(stat, 0, 0, w, h);
      const jam = now < jamUntil;
      const rot = sweep - Math.PI / 2;
      const size = clutter.width;

      // clutter lit by the persistence mask, then the beam itself
      const t = tmp.getContext('2d');
      t.globalCompositeOperation = 'source-over';
      t.clearRect(0, 0, size, size);
      t.save();
      t.translate(size / 2, size / 2);
      t.rotate(rot);
      t.drawImage(mask, -size / 2, -size / 2);
      t.restore();
      t.globalCompositeOperation = 'source-in';
      t.drawImage(clutter, 0, 0);
      t.globalCompositeOperation = 'source-over';
      g.globalCompositeOperation = 'lighter';
      g.drawImage(tmp, cx - rr, cy - rr, rr * 2, rr * 2);
      g.save();
      g.translate(cx, cy);
      g.rotate(rot);
      g.drawImage(wedge, -rr, -rr, rr * 2, rr * 2);
      g.restore();
      const ex = Math.cos(rot);
      const ey = Math.sin(rot);
      g.strokeStyle = rgba('holo', 0.35);
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + ex * rr, cy + ey * rr);
      g.stroke();
      g.strokeStyle = rgba('ice', 0.9);
      g.lineWidth = 1;
      g.stroke();
      g.globalCompositeOperation = 'source-over';
      // sweep marker on the bezel
      g.fillStyle = C.ice;
      g.beginPath();
      g.moveTo(cx + ex * (rad - 1), cy + ey * (rad - 1));
      g.lineTo(cx + ex * (rad - 7) - ey * 3, cy + ey * (rad - 7) + ex * 3);
      g.lineTo(cx + ex * (rad - 7) + ey * 3, cy + ey * (rad - 7) - ex * 3);
      g.fill();

      g.save();
      g.beginPath();
      g.arc(cx, cy, rr + 1, 0, TAU);
      g.clip();

      // jamming: radial strobes, speckle and false returns
      if (jam) {
        const jr = RM ? HD.rng(jamSeed) : R;
        for (let i = 0; i < 3; i++) {
          const a = jr() * TAU - Math.PI / 2;
          g.strokeStyle = rgba(i ? 'neon' : 'amber', 0.25 + jr() * 0.3);
          g.lineWidth = 2 + jr() * 4;
          g.beginPath();
          g.moveTo(cx, cy);
          g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
          g.stroke();
        }
        g.lineWidth = 1;
        for (let i = 0; i < 70; i++) {
          const r = Math.sqrt(jr()) * rr;
          const a = jr() * TAU;
          g.fillStyle = jr() < 0.3 ? rgba('neon', 0.8) : rgba('holo', 0.5);
          g.fillRect(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 2, 1);
        }
      }

      // satellite ground tracks (faint dashed arcs along each pass)
      g.setLineDash([2, 5]);
      g.strokeStyle = rgba('holo2', 0.3);
      for (const sat of [SA, SB]) {
        const p = sat.path;
        g.beginPath();
        for (let i = 0; i <= 24; i++) {
          const s0 = (-1.2 + (2.4 * i) / 24) * RANGE;
          const b = p.off + p.cur * s0 * s0;
          const x = toX(p.nx * b + p.dx * s0);
          const y = toY(p.ny * b + p.dy * s0);
          if (i) g.lineTo(x, y);
          else g.moveTo(x, y);
        }
        g.stroke();
      }
      g.setLineDash([]);

      // KESTREL → target intercept line
      if (KES.tracked && TGT.tracked && KES.hit > 0 && TGT.hit > 0) {
        const ax = toX(KES.px);
        const ay = toY(KES.py);
        const bx = toX(TGT.px);
        const by = toY(TGT.py);
        g.setLineDash([3, 3]);
        g.strokeStyle = rgba('holo', 0.45);
        g.beginPath();
        g.moveTo(ax, ay);
        g.lineTo(bx, by);
        g.stroke();
        g.setLineDash([]);
        link = rr >= 70 ? { x: (ax + bx) / 2, y: (ay + by) / 2, d: Math.hypot(TGT.px - KES.px, TGT.py - KES.py) } : null;
      } else link = null;

      const pulse = RM ? 0.5 : 0.5 + 0.5 * Math.sin(now / (urg > 0.5 ? 90 : 220));
      for (const k of contacts) if (k !== TGT) drawMarks(g, k, now, pulse);
      drawMarks(g, TGT, now, pulse);

      // false targets while jammed
      if (jam) {
        const jr = HD.rng(jamSeed + Math.floor(now / (RM ? 1e9 : 400)));
        g.fillStyle = rgba('amber', 0.8);
        g.font = MONO(9);
        for (let i = 0; i < 4; i++) {
          const x = cx + (jr() - 0.5) * rr * 1.3;
          const y = cy + (jr() - 0.5) * rr * 1.3;
          g.fillRect(x - 1.5, y - 1.5, 3, 3);
          if (rr >= 60) g.fillText('?', x + 4, y - 3);
        }
      }

      // NEW / LOST / VOX effects
      for (let i = fx.length - 1; i >= 0; i--) {
        const f = fx[i];
        const age = (now - f.t0) / 1000;
        const life = f.kind === 'lost' ? 3.2 : 2.4;
        if (age > life) {
          fx.splice(i, 1);
          continue;
        }
        const k = f.k;
        const x = f.kind === 'lost' ? toX(f.x) : toX(k.tracked ? k.px || k.x : f.x);
        const y = f.kind === 'lost' ? toY(f.y) : toY(k.tracked ? k.py || k.y : f.y);
        const a = 1 - age / life;
        g.font = MONO(9);
        if (f.kind === 'lost') {
          g.strokeStyle = rgba('dim', a);
          g.beginPath();
          g.moveTo(x - 4, y - 4); g.lineTo(x + 4, y + 4);
          g.moveTo(x + 4, y - 4); g.lineTo(x - 4, y + 4);
          g.stroke();
          g.fillStyle = rgba('dim', a);
          g.fillText('LOST', x + 6, y + 10);
        } else {
          const col = f.kind === 'vox' ? 'threat' : 'amber';
          const p = RM ? 0.6 : (age % 1.2) / 1.2;
          g.strokeStyle = rgba(col, a * (1 - p));
          g.beginPath();
          g.arc(x, y, 4 + p * 16, 0, TAU);
          g.stroke();
          g.fillStyle = rgba(col, Math.min(1, a * 1.5));
          g.fillText(f.kind === 'vox' ? 'VOX ID' : 'NEW', x + 7, y + 11);
        }
      }
      g.restore();
      if (L.rr >= 44) drawLabels(g);

      if (jam && rr >= 50) {
        const on = RM || Math.floor(now / 170) % 2 === 0;
        g.font = DISP(rr >= 90 ? 10 : 9);
        const txt = 'ECM JAMMING';
        const tw = g.measureText(txt).width;
        const x = cx - tw / 2;
        const y = cy + rr * 0.55;
        g.fillStyle = 'rgba(30, 0, 12, 0.8)';
        g.fillRect(x - 6, y - 11, tw + 12, 15);
        g.strokeStyle = on ? C.neon : rgba('neon', 0.4);
        g.strokeRect(x - 6.5, y - 11.5, tw + 13, 16);
        g.fillStyle = on ? C.neon : rgba('neon', 0.6);
        g.fillText(txt, x, y);
      }

      // dynamic corner readouts
      g.font = MONO(9);
      for (const c of L.corners) {
        let txt = '';
        if (c.key === 'swp') txt = `SWP ${U.pad(((sweep * 180) / Math.PI).toFixed(1), 5)}°`;
        else if (c.key === 'trk') txt = `TRK ${U.pad(contacts.filter((k) => k.tracked).length, 2)}`;
        else if (c.key === 'utc') txt = lastClock;
        g.fillStyle = c.col;
        g.textAlign = c.left ? 'left' : 'right';
        g.fillText(txt, c.x, c.y);
      }
      g.textAlign = 'left';

      if (L.asc) drawAScope(g, now);
    }

    function drawAScope(g, now) {
      const a = L.asc;
      const x0 = a.x + 4;
      const x1 = a.x + a.w - 4;
      const base = a.y + a.h - 13;
      const top = a.y + 15;
      const n = Math.max(20, Math.floor((x1 - x0) / 2));
      const hits = [];
      for (const k of contacts) {
        if (!k.tracked) continue;
        const d = Math.abs(((brgOf(k) - sweep + Math.PI * 3) % TAU) - Math.PI);
        if (d < 0.16) hits.push([rangeOf(k), (1 - d / 0.16) * (k.kind === 'sat' ? 0.55 : 0.95), k]);
      }
      const jam = now < jamUntil;
      g.beginPath();
      for (let i = 0; i < n; i++) {
        const r = (i / (n - 1)) * RANGE;
        let v = 0.05 + R() * 0.08 + Math.exp(-r / 1.1) * 0.55 * R();
        for (const [hr, amp] of hits) {
          const d = (r - hr) / 0.28;
          v += amp * Math.exp(-d * d);
        }
        if (jam) v += R() * 0.6;
        const x = x0 + (i / (n - 1)) * (x1 - x0);
        const y = base - Math.min(1, v) * (base - top);
        if (i) g.lineTo(x, y);
        else g.moveTo(x, y);
      }
      g.strokeStyle = rgba('holo', 0.22);
      g.lineWidth = 3;
      g.stroke();
      g.strokeStyle = jam ? C.neon : C.ice;
      g.lineWidth = 1;
      g.stroke();
      // range gate on the target
      if (TGT.tracked) {
        const gx = Math.round(x0 + (rangeOf(TGT) / RANGE) * (x1 - x0)) + 0.5;
        g.setLineDash([2, 2]);
        g.strokeStyle = rgba('threat', 0.8);
        g.beginPath();
        g.moveTo(gx, top - 2); g.lineTo(gx, base);
        g.stroke();
        g.setLineDash([]);
        g.font = MONO(9);
        g.fillStyle = C.threat;
        const txt = 'TGT';
        const tw = g.measureText(txt).width;
        g.fillText(txt, Math.min(gx + 3, x1 - tw), top + 6);
      }
      g.font = MONO(9);
      g.fillStyle = C.dim;
      g.textAlign = 'right';
      g.fillText(`BRG ${U.pad(Math.round((sweep * 180) / Math.PI) % 360, 3)}°`, a.x + a.w - 5, a.y + 11);
      g.textAlign = 'left';
    }

    /* ------------------------------------------------------------- events */

    ctx.on('target:move', (d) => {
      if (!d || !Number.isFinite(d.heading)) return;
      moveAt = performance.now();
      // real position when the map reports Paris lat/lon, otherwise its normalised x/y
      const geo = Number.isFinite(d.lat) && Number.isFinite(d.lon) && Math.abs(d.lat - LAT0) < 0.2 && Math.abs(d.lon - LON0) < 0.3;
      mv = {
        hdg: ((d.heading % 360) * Math.PI) / 180,
        spd: U.clamp(+d.speed || 0, 0, 260),
        geo,
        x: geo ? (d.lon - LON0) * KM_LON : Number.isFinite(d.x) ? (U.clamp(d.x, 0, 1) - 0.5) * 2 * RANGE * 0.8 : TGT.x,
        y: geo ? (LAT0 - d.lat) * KM_LAT : Number.isFinite(d.y) ? (U.clamp(d.y, 0, 1) - 0.5) * 2 * RANGE * 0.8 : TGT.y,
      };
      if (geo && !geoFix) {
        // first fix from the map: snap instead of gliding across the scope
        geoFix = true;
        TGT.x = mv.x;
        TGT.y = mv.y;
        TGT.hdg = mv.hdg;
      }
    });
    ctx.on('intrusion', () => {
      jamUntil = performance.now() + 2800;
      jamSeed = R.int(1, 1e9);
      logLine('ECM DETECTED · BARRAGE JAMMING', 'lost');
    });
    ctx.on('voice:match', () => {
      const now = performance.now();
      if (now - vox < 3000) return;
      vox = now;
      fx.push({ x: TGT.x, y: TGT.y, t0: now, kind: 'vox', k: TGT });
      if (fx.length > 6) fx.shift();
      logLine(`VOX ID ${TGT.id} · TRACK CORRELATED`, 'tgt');
    });
    ctx.on('mission:phase', ({ phase }) => {
      urg = { elevated: 0, severe: 0.3, critical: 0.7, final: 1, zero: 1 }[phase] || 0;
      if (phase === 'critical') logLine('INTERCEPT WINDOW OPEN · ' + KES.id, 'warn');
    });
    ctx.on('mission:reset', ({ cycle }) => {
      // new cycle: fresh opening picture, primed again on the next tick without NEW/LOST noise
      initContacts();
      for (const k of contacts) {
        k.hist.length = 0;
        k.tracked = k !== UNK;
        k.hidden = k === UNK ? 1 : 0;
        k.lostAt = -1e9;
      }
      if (mv && performance.now() - moveAt < 3000) {
        TGT.x = mv.x;
        TGT.y = mv.y;
      }
      fx.length = 0;
      unkDue = 0;
      d11Drop = 0;
      jamUntil = 0;
      urg = 0;
      started = 0;
      logLine(`CYCLE ${cycle} · TRACKS RE-INITIALISED`, 'ok');
    });
    ctx.on('fonts:ready', () => {
      if (L) buildLayers();
    });

    /* --------------------------------------------------------------- loop */

    return {
      resize(w, h) {
        layout(w, h);
      },
      tick(now, dt) {
        if (!L) return;
        if (lost) {
          lost = false;
          buildLayers();
        }
        if (!started) {
          started = now;
          // prime the phosphor so contacts start mid-fade instead of blank (off-scope ones stay dark)
          for (const k of contacts) {
            if (!k.tracked) {
              k.hit = -1e9;
              continue;
            }
            k.px = k.x;
            k.py = k.y;
            k.hit = now - (((sweep - brgOf(k) + TAU) % TAU) / TAU) * PERIOD * 1000;
          }
        }
        const prev = sweep;
        sweep = (sweep + (dt * TAU) / PERIOD) % TAU;
        const span = (sweep - prev + TAU) % TAU;
        simulate(now, dt);
        for (const k of contacts) {
          if (!k.tracked) continue;
          if ((sweep - brgOf(k) + TAU) % TAU < span) paint(k, now);
          if (k.hot && now - k.hit > 220) {
            k.hot = false;
            k.row.classList.remove('is-hit');
          }
        }
        if (now - lastTable > 250) {
          lastTable = now;
          lastClock = clock();
          updateTable(now);
        }
        draw(now);
      },
    };
  });
})();
