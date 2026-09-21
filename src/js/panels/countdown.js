/* FEDLIGHT · P-03 grid wipe countdown
   A hand-built 7-segment LED module on two stacked canvases:
   - HUD layer: backplate, ghost segments, labels, bar ticks and slow readouts. It is repainted only
     when one of its values changes (a few times a second), from a cached static base.
   - FX layer: lit digits, progress fill and every escalation effect, repainted each frame.
   Lit digits are blitted from pre-glowed sprite atlases, so a frame costs a handful of drawImage
   calls. Clicking the panel "attempts an abort". It never works. */
(() => {
  'use strict';

  // segment bitmasks, bit0..6 = a b c d e f g
  const SEGS = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];
  // glyph metrics, as fractions of the digit height
  const DW = 0.5; // digit width
  const TH = 0.13; // segment thickness
  const GAP = 0.02; // dark joint between segments
  const SKEW = 0.07; // italic lean of an LED module
  const SP = 0.12; // digit spacing
  const COLW = 0.2;
  const DOTW = 0.15;
  const SMALL = 0.58; // centisecond digits
  const COLON = 10;
  const DOT = 11;

  const PHASES = ['elevated', 'severe', 'critical', 'final', 'zero'];
  const SUB = {
    elevated: 'PAYLOAD ARMED · UPLINK WINDOW OPEN',
    severe: 'WINDOW CLOSING · REROUTE FAILED',
    critical: 'CRITICAL · ABORT CODES REJECTED',
    final: 'IMMINENT',
    zero: '00:00:00 · DETONATION',
  };
  const SUB_SHORT = {
    elevated: 'UPLINK WINDOW OPEN',
    severe: 'REROUTE FAILED',
    critical: 'ABORT CODES REJECTED',
    final: 'IMMINENT',
    zero: 'DETONATION',
  };
  const META = {
    elevated: 'PAYLOAD ARMED',
    severe: 'WINDOW CLOSING',
    critical: 'CRITICAL',
    final: 'IMMINENT',
    zero: 'DETONATION',
  };
  // narrow headers (720p) truncate the long meta; keep one word there
  const META_SHORT = {
    elevated: 'ARMED',
    severe: 'CLOSING',
    critical: 'CRITICAL',
    final: 'IMMINENT',
    zero: 'DETONATION',
  };
  const PHASE_ALERT = {
    severe: ['warn', 'T−02:00 · UPLINK WINDOW CLOSING — REROUTE FAILED'],
    critical: ['crit', 'T−01:00 · GRID WIPE CRITICAL — ABORT CODES REJECTED'],
    final: ['crit', 'T−00:10 · GRID WIPE IMMINENT — ALL SECTORS BRACE'],
  };
  const MARKS = [
    [120000, 'SEV', 'amber'],
    [60000, 'CRIT', 'threat'],
    [10000, 'IMM', 'ice'],
  ];
  const VARIANTS = {
    red: { base: '#ff2340', glow: 'rgba(255,35,64,0.9)', core: [[0, '#ff6b7c'], [0.45, '#ff2a45'], [1, '#e0102c']] },
    hot: { base: '#ff4058', glow: 'rgba(255,50,72,1)', core: [[0, '#ffffff'], [1, '#ffd0d6']] },
    green: { base: '#3dff7f', glow: 'rgba(61,255,127,0.9)', core: [[0, '#d2ffe0'], [1, '#56ff8f']] },
  };

  const FUI = (px, w = 600) => `${w} ${px}px "Chakra Petch", "Segoe UI", sans-serif`;
  const FMONO = (px, w = 500) => `${w} ${px}px "JetBrains Mono", Consolas, monospace`;
  const FDISP = (px) => `${px}px Michroma, "Arial Black", sans-serif`;

  /* ------------------------------------------------------------ geometry */

  function pt(g, ox, oy, H, x, y, first) {
    const X = ox + x + (H - y) * SKEW;
    const Y = oy + y;
    if (first) g.moveTo(X, Y);
    else g.lineTo(X, Y);
  }
  function hseg(g, ox, oy, H, x0, x1, yc, ht) {
    pt(g, ox, oy, H, x0, yc, true);
    pt(g, ox, oy, H, x0 + ht, yc - ht);
    pt(g, ox, oy, H, x1 - ht, yc - ht);
    pt(g, ox, oy, H, x1, yc);
    pt(g, ox, oy, H, x1 - ht, yc + ht);
    pt(g, ox, oy, H, x0 + ht, yc + ht);
    g.closePath();
  }
  function vseg(g, ox, oy, H, xc, y0, y1, ht) {
    pt(g, ox, oy, H, xc, y0, true);
    pt(g, ox, oy, H, xc + ht, y0 + ht);
    pt(g, ox, oy, H, xc + ht, y1 - ht);
    pt(g, ox, oy, H, xc, y1);
    pt(g, ox, oy, H, xc - ht, y1 - ht);
    pt(g, ox, oy, H, xc - ht, y0 + ht);
    g.closePath();
  }
  function quad(g, ox, oy, H, cx, cy, s) {
    pt(g, ox, oy, H, cx - s / 2, cy - s / 2, true);
    pt(g, ox, oy, H, cx + s / 2, cy - s / 2);
    pt(g, ox, oy, H, cx + s / 2, cy + s / 2);
    pt(g, ox, oy, H, cx - s / 2, cy + s / 2);
    g.closePath();
  }
  // Adds glyph `idx` (0-9, COLON, DOT) to the current path; (ox, oy) is the unskewed top-left.
  function glyphPath(g, idx, ox, oy, H) {
    const ht = (TH * H) / 2;
    const W = DW * H;
    const gp = GAP * H;
    if (idx < 10) {
      const m = SEGS[idx];
      if (m & 1) hseg(g, ox, oy, H, ht + gp, W - ht - gp, ht, ht);
      if (m & 2) vseg(g, ox, oy, H, W - ht, ht + gp, H / 2 - gp, ht);
      if (m & 4) vseg(g, ox, oy, H, W - ht, H / 2 + gp, H - ht - gp, ht);
      if (m & 8) hseg(g, ox, oy, H, ht + gp, W - ht - gp, H - ht, ht);
      if (m & 16) vseg(g, ox, oy, H, ht, H / 2 + gp, H - ht - gp, ht);
      if (m & 32) vseg(g, ox, oy, H, ht, ht + gp, H / 2 - gp, ht);
      if (m & 64) hseg(g, ox, oy, H, ht + gp, W - ht - gp, H / 2, ht);
    } else {
      const s = TH * H * 1.05;
      if (idx === COLON) {
        quad(g, ox, oy, H, (COLW * H) / 2, H * 0.3, s);
        quad(g, ox, oy, H, (COLW * H) / 2, H * 0.7, s);
      } else {
        quad(g, ox, oy, H, (DOTW * H) / 2, H - s / 2, s);
      }
    }
  }

  function glyphSeq(hours) {
    return hours ? ['d', 'd', ':', 'd', 'd', ':', 'd', 'd', '.', 's', 's'] : ['d', 'd', ':', 'd', 'd', '.', 's', 's'];
  }
  // tall panels stack one unit per row: [HH] MM / SS / .cs (the centisecond row is all small glyphs)
  const STACK_CAPS = ['MIN', 'SEC'];
  const STACK_CAPS_H = ['HRS', 'MIN', 'SEC'];
  const ROW2 = DW + SP + DW + SKEW; // width of a two-digit row, in digit heights
  // x offsets (in units of digit height) of each glyph, plus the total block width
  function seqPlan(seq) {
    const xs = [];
    let x = 0;
    for (const k of seq) {
      xs.push(x);
      if (k === 'd') x += DW + SP;
      else if (k === ':') x += COLW + SP * 0.6;
      else if (k === '.') x += DOTW + SP * 0.45;
      else x += (DW + SP * 0.9) * SMALL;
    }
    const last = seq[seq.length - 1];
    const lastW = last === 's' ? (DW + SKEW) * SMALL : DW + SKEW;
    return { xs, total: xs[xs.length - 1] + lastW };
  }

  HD.panel('countdown', (ctx) => {
    const U = ctx.util;
    const C = ctx.color;
    const M = ctx.mission;
    const RM = ctx.reducedMotion;
    const R = ctx.rng(HD.seed ^ 0xc0de03);

    const cvA = ctx.canvas({ className: 'cd-hud' });
    // compositor-only layers between the HUD and the lit digits: phase wash and scan sweep
    const wash = U.el('div', 'cd-wash');
    const scan = U.el('div', 'cd-scan');
    ctx.el.append(wash, scan);
    const cvB = ctx.canvas({ className: 'cd-fx' });
    const base = document.createElement('canvas');
    const bg = base.getContext('2d');
    const litBar = document.createElement('canvas');
    const stripe = document.createElement('canvas');

    // Chrome may drop 2D canvas backing stores under memory pressure (they come back blank, with a
    // 'contextrestored' event). The cached layers never repaint on their own, so rebuild them all.
    let lost = false;
    const watch = (c) => c.addEventListener('contextrestored', () => (lost = true));

    const hit = U.el('button', 'cd-hit');
    hit.type = 'button';
    hit.dataset.hot = '';
    hit.setAttribute('aria-label', 'Attempt to abort the grid wipe');
    hit.title = 'ATTEMPT ABORT';
    ctx.el.appendChild(hit);
    const sr = U.el('span', 'cd-sr');
    sr.setAttribute('role', 'timer');
    ctx.el.appendChild(sr);

    let w = 0;
    let h = 0;
    let L = null;
    let phase = M.phase || 'elevated';
    let hoursMode = M.remaining() >= 3600000;
    let lastTotal = M.total;
    let atl = {};
    let aborts = 0;
    let lastAbortAlert = -1e9;
    let denyAt = -1e9;
    let shakeAt = -1e9;
    let adjAt = -1e9;
    let adjGood = true;
    let rearmAt = -1e9;
    let glitchUntil = 0;
    let hover = false;
    let sync = 0.002;
    let syncAt = 0;
    let trig = U.randHex(4, R);
    let lastSec = -1;
    let jx = 0;
    let jy = 0;
    let jitterAt = 0;
    let stripeOff = 0;
    let hudSig = '';
    let fxFull = true;
    let fxKey = '';
    let fxBar = -1;
    let fxLamp = null;
    let fxLad = null;
    let fxOverlay = false;
    const fxs = {};
    const fxRects = [];
    const floaters = [];
    const beepTimers = [];

    /* -------------------------------------------------------------- layout */

    function accent() {
      return phase === 'elevated' ? C.amber : C.threat;
    }

    function measure(font, text, ls) {
      const g = cvA.ctx;
      g.font = font;
      g.letterSpacing = ls ? ls + 'px' : '0px';
      const m = g.measureText(text).width;
      g.letterSpacing = '0px';
      return m;
    }

    function relayout() {
      w = cvA.w;
      h = cvA.h;
      if (w < 20 || h < 20) return;
      const compact = h < 112;
      // full-screen sized panels scale their chrome (labels, bar, side column) with the panel
      const k = U.clamp(Math.min(w / 800, h / 260), 1, 1.8);
      const K = (v) => Math.round(v * k);
      const o = { compact, k };
      o.pad = w < 330 ? 6 : K(9);
      o.topY = compact ? 3 : K(5);
      o.topH = compact ? 11 : K(13);
      o.gapTop = compact ? 5 : K(8);
      o.barH = compact ? 5 : K(7);
      o.gapBar = compact ? 6 : K(9);
      o.tickLbl = h >= 125 ? K(12) : 0;
      o.botPad = compact ? 4 : K(5);
      o.fs = 9 * k; // small label font px
      const single = glyphSeq(hoursMode);
      const plan = seqPlan(single);
      const innerW = w - o.pad * 2;
      // "T−" prefix: font scales with the digits, so budget it as ~0.3 H plus a fixed gap
      const tmU = 0.3;
      const tmGap = 7;
      const rowH = h >= 120 ? K(13) : 0;
      const areaTop = o.topY + o.topH + o.gapTop;
      const availFor = (extra) => h - o.botPad - extra - o.tickLbl - o.barH - o.gapBar - areaTop;
      const sideW = U.clamp(Math.round(w * 0.19), 80, K(150));
      const hSide = Math.min(availFor(0), (innerW - tmGap - sideW - 14) / (plan.total + tmU));
      const hFree = Math.min(availFor(rowH), (innerW - tmGap) / (plan.total + tmU));
      const sideOK = hSide >= hFree * 0.8 && hSide >= 34;
      // tall, narrow panels: one unit per row gives far bigger digits than one long row
      const nBig = hoursMode ? 3 : 2;
      let capH = K(12);
      const stackUnits = nBig + SMALL + nBig * 0.08;
      // (the backplate adds 5 px above and below the block)
      const hStackFor = (cap) => Math.min((availFor(rowH) - (nBig + 1) * cap - 16) / stackUnits, (innerW - 12) / ROW2);
      let hStack = hStackFor(capH);
      o.stack = hStack >= 40 && hStack >= Math.max(sideOK ? hSide : hFree, 1) * 1.45;
      if (o.stack) {
        // caption lines grow a little with the digits
        capH = Math.max(capH, Math.round(hStack * 0.08));
        hStack = hStackFor(capH);
        o.capH = capH;
      }
      o.side = !o.stack && sideOK;
      o.readRow = !o.side && rowH > 0;
      o.rowH = o.readRow ? rowH : 0;
      o.H = Math.max(12, Math.floor(o.stack ? hStack : o.side ? hSide : hFree));
      o.Hs = Math.round(o.H * SMALL);
      o.sideW = o.side ? sideW : 0;
      o.spine = o.side;

      o.barY = h - o.botPad - o.rowH - o.tickLbl - o.barH;
      let areaBot = o.barY - o.gapBar;
      o.tmPx = U.clamp(Math.round(o.H * 0.21), 10, K(32));

      if (o.stack) {
        // rows of [d d] (+ caption line above each), then [. s s] right-aligned under them
        const gap = Math.max(4, Math.round(o.H * 0.08));
        const csPlan = seqPlan(['.', 'd', 'd']);
        const rowW = ROW2 * o.H;
        const blockH = nBig * (capH + o.H + gap) + capH + o.Hs;
        // spare height below the block becomes a stacked readout list (the side column's rows)
        const rh = K(15);
        const spare = areaBot + o.rowH - areaTop - 12 - blockH - K(10);
        const nInfo = Math.min(6, Math.floor(spare / rh));
        if (nInfo >= 3) {
          o.side = true;
          o.readRow = false;
          o.rowH = 0;
          o.barY = h - o.botPad - o.tickLbl - o.barH;
          areaBot = o.barY - o.gapBar;
          o.sideX = o.pad;
          o.sideW = innerW;
        }
        const infoH = o.side ? nInfo * rh + K(10) : 0;
        const top = Math.round(areaTop + 6 + (areaBot - areaTop - 12 - blockH - infoH) / 2);
        o.blockX = Math.round(o.pad + (innerW - rowW) / 2);
        o.blockR = Math.round(o.blockX + rowW);
        o.blockTop = top;
        o.blockBot = top + blockH;
        o.seq = [];
        o.gx = [];
        o.gy = [];
        o.gsm = [];
        o.caps = [];
        const caps = hoursMode ? STACK_CAPS_H : STACK_CAPS;
        let y = top;
        let lastTop = top;
        for (let r = 0; r < nBig; r++) {
          o.caps.push({ x: o.blockX, y: y + capH / 2, text: caps[r], tm: r === 0 });
          y += capH;
          lastTop = y;
          for (let j = 0; j < 2; j++) {
            o.seq.push('d');
            o.gx.push(Math.round(o.blockX + j * (DW + SP) * o.H));
            o.gy.push(y);
            o.gsm.push(false);
          }
          y += o.H + gap;
        }
        const csX = o.blockR - csPlan.total * o.Hs;
        o.caps.push({ x: o.blockX, y: y + capH / 2, text: '1/100 S' });
        y += capH;
        ['.', 's', 's'].forEach((kk, j) => {
          o.seq.push(kk);
          o.gx.push(Math.round(csX + csPlan.xs[j] * o.Hs));
          o.gy.push(y);
          o.gsm.push(true);
        });
        o.digTop = y - o.H + o.Hs; // (single-row reference; the stacked paths use gy / bandCY / flY)
        // the one-second dial sits in the free space left of the centisecond row
        const free = csX - o.blockX;
        const dr = Math.floor(Math.min(free / 2 - 4, o.Hs / 2 - 2));
        o.dial = dr >= 6 ? { r: dr, x: o.blockX + free / 2 - 2, y: y + o.Hs / 2 } : null;
        o.bandCY = lastTop + o.H / 2; // over the seconds row
        o.flX = (o.blockX + o.blockR) / 2;
        o.flY = o.bandCY;
        o.rowsTop = o.blockBot + K(10);
      } else {
        o.seq = single;
        o.digTop = Math.round(areaTop + (areaBot - areaTop - o.H) / 2);
        o.tmW = measure(FDISP(o.tmPx), 'T−') + tmGap;
        // a one-second sweep dial tucked under the T− prefix, when the column has room
        const dr = Math.floor(Math.min((o.tmW - tmGap) / 2 - 1, (o.H - o.tmPx * 1.3 - 6) / 2));
        o.dial = dr >= 6 ? { r: dr } : null;
        const blockW = o.tmW + plan.total * o.H;
        const leftSpan = w - o.pad * 2 - (o.side ? o.sideW + 14 : 0);
        o.blockX = Math.round(o.pad + Math.max(0, (leftSpan - blockW) / 2));
        o.digX = o.blockX + o.tmW;
        o.gx = plan.xs.map((x) => Math.round(o.digX + x * o.H));
        o.gy = o.seq.map((kk) => (kk === 's' ? o.digTop + o.H - o.Hs : o.digTop));
        o.gsm = o.seq.map((kk) => kk === 's');
        o.blockR = o.digX + plan.total * o.H;
        o.blockTop = o.digTop;
        o.blockBot = o.digTop + o.H;
        if (o.dial) {
          o.dial.x = o.blockX + 1 + (o.tmW - tmGap) / 2;
          o.dial.y = o.digTop + o.H - o.dial.r - 2;
        }
        o.sideX = w - o.pad - o.sideW;
        o.caps = [];
        // centisecond caption above the small digits, only where it fits
        const csX = o.gx[o.gx.length - 2];
        if (o.H - o.Hs >= 18) {
          const lim = o.side ? o.sideX - 14 : w - o.pad;
          for (const t of ['1/100 S', '1/100']) {
            if (csX + 1 + measure(FUI(o.fs), t, 1) <= lim) {
              o.caps.push({ x: csX + 1, y: o.digTop + (o.H - o.Hs) / 2 - 1, text: t });
              break;
            }
          }
        }
        o.bandCY = o.digTop + o.H / 2;
        o.flX = (o.gx[o.gx.length - 3] + o.gx[o.gx.length - 1]) / 2 + 4;
        o.flY = o.digTop + o.H * 0.42;
      }

      // progress bar: whole segments only
      o.pitch = compact ? 3 : K(4);
      o.segN = Math.floor((innerW + 1) / o.pitch);
      o.barW = o.segN * o.pitch - 1;
      o.barX = Math.round((w - o.barW) / 2);

      // side column rows, by priority, then back in display order
      o.rows = [];
      o.rh = compact ? 13 : K(15);
      if (o.side) {
        const want = ['abort', 'sync', 'chip', 'cycle', 'ladder', 'trig'];
        const order = ['ladder', 'cycle', 'abort', 'sync', 'trig', 'chip'];
        const rh = o.rh;
        if (o.stack) {
          // a plain list under the stacked digits
          const n = U.clamp(Math.floor((o.barY - o.gapBar - o.rowsTop + 2) / rh), 1, want.length);
          const keep = want.slice(0, n);
          order.filter((kk) => keep.includes(kk)).forEach((kk, i) => o.rows.push({ k: kk, y: o.rowsTop + i * rh, h: rh }));
        } else {
          const n = U.clamp(Math.floor((o.H + 4) / rh), 1, want.length);
          const keep = want.slice(0, n);
          const shown = order.filter((kk) => keep.includes(kk));
          const step = shown.length > 1 ? (o.H + 2 - rh) / (shown.length - 1) : 0;
          shown.forEach((kk, i) => o.rows.push({ k: kk, y: Math.round(o.digTop - 1 + i * Math.min(step, rh + 6)), h: rh }));
          // keep the chip pinned to the bottom of the column
          const chip = o.rows.find((r) => r.k === 'chip');
          if (chip) chip.y = Math.round(o.digTop + o.H - rh + 1);
        }
      }
      // dirty rects for the FX layer's partial repaints (sprite glow pads included)
      const padS = Math.ceil(o.Hs * 0.32) + 2;
      const si = o.seq.indexOf('s');
      const sx0 = o.gx[si] - padS;
      o.rSmall = { x: sx0, y: o.gy[si] - padS, w: Math.min(w, o.blockR + padS + 2) - sx0, h: o.Hs + padS * 2 };
      o.rDial = o.dial ? { x: o.dial.x - o.dial.r - 3, y: o.dial.y - o.dial.r - 3, w: o.dial.r * 2 + 6, h: o.dial.r * 2 + 6 } : null;
      o.rBar = { x: o.barX - 1, y: o.barY - 3, w: o.barW + 2, h: o.barH + 6 };
      o.lamp = compact ? 6 : K(6);
      o.rLamp = { x: o.pad - 1, y: Math.floor(o.topY + o.topH / 2 - o.lamp / 2) - 1, w: o.lamp + 2, h: o.lamp + 2 };
      const sbh = compact ? 3 : K(4);
      o.rTop = { x: 0, y: 0, w, h: sbh };
      o.rBot = { x: 0, y: h - sbh, w, h: sbh };
      scan.style.cssText = `left:${o.blockX - 5}px;top:${o.blockTop - 5}px;width:${Math.round(o.blockR - o.blockX + 12)}px;height:${o.blockBot - o.blockTop + 10}px`;

      L = o;
      atl = {};
      fxFull = true;
      buildBase();
      buildBar();
      buildStripe();
      hudSig = '';
    }

    /* -------------------------------------------------------------- sprites */

    function atlas(variant, small) {
      const key = variant + (small ? 's' : 'b');
      if (atl[key]) return atl[key];
      const H = small ? L.Hs : L.H;
      const dpr = cvB.dpr;
      const pad = Math.ceil(H * 0.32);
      const cwD = Math.ceil(((DW + SKEW) * H + pad * 2) * dpr);
      const chD = Math.ceil((H + pad * 2) * dpr);
      const c = document.createElement('canvas');
      watch(c);
      c.width = cwD * 12;
      c.height = chD;
      const g = c.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const V = VARIANTS[variant];
      const grad = g.createLinearGradient(0, pad, 0, pad + H);
      for (const [o, col] of V.core) grad.addColorStop(o, col);
      for (let i = 0; i < 12; i++) {
        g.beginPath();
        glyphPath(g, i, (i * cwD) / dpr + pad, pad, H);
        g.save();
        g.shadowColor = V.glow;
        g.fillStyle = V.base;
        g.shadowBlur = H * 0.3 * dpr;
        g.fill();
        g.shadowBlur = H * 0.09 * dpr;
        g.fill();
        g.restore();
        g.fillStyle = grad;
        g.fill();
      }
      return (atl[key] = { c, cwD, chD, cw: cwD / dpr, ch: chD / dpr, pad });
    }

    function blit(g, A, idx, x, y) {
      g.drawImage(A.c, idx * A.cwD, 0, A.cwD, A.chD, x - A.pad, y - A.pad, A.cw, A.ch);
    }

    function buildBar() {
      const dpr = cvA.dpr;
      litBar.width = Math.ceil(L.barW * dpr);
      litBar.height = Math.ceil(L.barH * dpr);
      const g = litBar.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const acc = accent();
      const grad = g.createLinearGradient(0, 0, 0, L.barH);
      grad.addColorStop(0, HD.rgba(acc, 1));
      grad.addColorStop(1, HD.rgba(acc, 0.7));
      g.fillStyle = grad;
      g.beginPath();
      for (let i = 0; i < L.segN; i++) g.rect(i * L.pitch, 0, L.pitch - 1, L.barH);
      g.fill();
    }

    // one long strip of hazard stripes; sliding the source window makes them crawl
    function buildStripe() {
      const dpr = cvB.dpr;
      const bh = L.compact ? 3 : Math.round(4 * L.k);
      const period = Math.round(12 * L.k);
      stripe.width = Math.ceil((w + period * 2) * dpr);
      stripe.height = Math.ceil(bh * dpr);
      const g = stripe.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = '#12020a';
      g.fillRect(0, 0, w + period * 2, bh);
      g.fillStyle = C.threat;
      g.beginPath();
      for (let x = -period; x < w + period * 3; x += period) {
        g.moveTo(x, bh);
        g.lineTo(x + bh, 0);
        g.lineTo(x + bh + period / 2, 0);
        g.lineTo(x + period / 2, bh);
        g.closePath();
      }
      g.fill();
      stripe.bh = bh;
      stripe.period = period;
    }

    /* ----------------------------------------------------------- base layer */

    function txt(g, s, x, y, font, color, align = 'left', ls = 0) {
      g.font = font;
      g.letterSpacing = ls ? ls + 'px' : '0px';
      g.fillStyle = color;
      g.textAlign = align;
      // canvas letter-spacing trails the last glyph; pull right-aligned text back by one gap
      g.fillText(s, align === 'right' ? x + ls : x, y);
      const m = g.measureText(s).width;
      g.letterSpacing = '0px';
      return m;
    }
    function fit(g, s, font, maxW, ls) {
      g.font = font;
      g.letterSpacing = ls ? ls + 'px' : '0px';
      let out = s;
      if (g.measureText(out).width > maxW) {
        while (out.length > 1 && g.measureText(out + '…').width > maxW) out = out.slice(0, -1);
        out = out.trimEnd() + '…';
      }
      g.letterSpacing = '0px';
      return out;
    }
    function brackets(g, x, y, bw, bh, len, color, lw = 1) {
      g.strokeStyle = color;
      g.lineWidth = lw;
      g.beginPath();
      g.moveTo(x, y + len);
      g.lineTo(x, y);
      g.lineTo(x + len, y);
      g.moveTo(x + bw - len, y);
      g.lineTo(x + bw, y);
      g.lineTo(x + bw, y + len);
      g.moveTo(x + bw, y + bh - len);
      g.lineTo(x + bw, y + bh);
      g.lineTo(x + bw - len, y + bh);
      g.moveTo(x + len, y + bh);
      g.lineTo(x, y + bh);
      g.lineTo(x, y + bh - len);
      g.stroke();
    }

    function buildBase() {
      const dpr = cvA.dpr;
      base.width = cvA.canvas.width;
      base.height = cvA.canvas.height;
      const g = bg;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      g.textBaseline = 'middle';
      const acc = accent();
      const o = L;

      const k = o.k;
      // ground: darker than the shared panel glass, with a red haze behind the module
      g.fillStyle = 'rgba(2,4,8,0.5)';
      g.fillRect(0, 0, w, h);
      const hzY = (o.blockTop + o.blockBot) / 2;
      const hz = g.createRadialGradient(
        (o.blockX + o.blockR) / 2, hzY, 0,
        (o.blockX + o.blockR) / 2, hzY, Math.max(60, Math.max(o.blockR - o.blockX, o.blockBot - o.blockTop) * 0.7)
      );
      hz.addColorStop(0, HD.rgba(C.threat, phase === 'elevated' ? 0.07 : 0.12));
      hz.addColorStop(1, HD.rgba(C.threat, 0));
      g.fillStyle = hz;
      g.fillRect(0, 0, w, h);

      // label row
      const ty = o.topY + o.topH / 2 + 0.5;
      const lblPx = o.compact ? 9 : 10 * k;
      const lblX = o.pad + Math.round(10 * k);
      const lblW = txt(g, 'GRID WIPE IN', lblX, ty, FUI(lblPx), acc, 'left', o.compact ? 1.4 : 2 * k);
      const subFont = FUI(o.compact ? 9 : 9.5 * k, 600);
      const subLs = o.compact ? 0.8 : 1.4 * k;
      const subX0 = lblX + lblW + 14;
      const subMax = w - o.pad - subX0 - 4;
      const sub = fit(g, measure(subFont, SUB[phase], subLs) <= subMax ? SUB[phase] : SUB_SHORT[phase], subFont, subMax, subLs);
      if (phase === 'final' || phase === 'zero') {
        const sw = measure(subFont, sub, subLs) + 10;
        g.fillStyle = C.threat;
        g.fillRect(w - o.pad - sw, o.topY, sw, o.topH);
        txt(g, sub, w - o.pad - 5, ty, subFont, '#12020a', 'right', subLs);
      } else {
        txt(g, sub, w - o.pad, ty, subFont, phase === 'elevated' ? C.text : HD.rgba(C.threat, 0.95), 'right', subLs);
      }
      // hairline with ruler notches under the label row
      const hy = o.topY + o.topH + Math.floor(o.gapTop / 2) + 0.5;
      g.fillStyle = HD.rgba(acc, 0.16);
      g.fillRect(o.pad, hy, w - o.pad * 2, 1);
      g.fillStyle = HD.rgba(acc, 0.4);
      for (let x = o.pad; x < w - o.pad; x += Math.round(24 * k)) g.fillRect(x, hy - 1, 1, 3);
      g.fillRect(o.pad, hy - 1, Math.round(18 * k), 2);

      // LED backplate
      const bx = o.blockX - 5;
      const by = o.blockTop - 5;
      const bw = o.blockR - o.blockX + 12;
      const bh = o.blockBot - o.blockTop + 10;
      g.fillStyle = 'rgba(8,2,6,0.72)';
      g.fillRect(bx, by, bw, bh);
      g.fillStyle = HD.rgba(C.threat, 0.035);
      for (let y = by + 2; y < by + bh; y += 3) g.fillRect(bx, y, bw, 1);
      g.strokeStyle = HD.rgba(C.threat, 0.16);
      g.lineWidth = 1;
      g.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
      brackets(g, bx + 0.5, by + 0.5, bw - 1, bh - 1, Math.round(6 * k), HD.rgba(acc, 0.85), 1.5);

      // ghost segments: every segment faintly visible, like an unlit LED module
      g.fillStyle = HD.rgba(C.threat, 0.085);
      g.beginPath();
      o.seq.forEach((kk, i) => {
        const gh = o.gsm[i] ? o.Hs : o.H;
        glyphPath(g, kk === 'd' || kk === 's' ? 8 : kk === ':' ? COLON : DOT, o.gx[i], o.gy[i], gh);
      });
      g.fill();

      if (o.stack) {
        // caption line above each stacked row: T− (first row) + unit label + a faint rule
        const cf = FUI(Math.max(o.fs, Math.min(13, o.capH * 0.62)));
        for (const cp of o.caps) {
          let x = cp.x + 1;
          if (cp.tm) {
            const px = U.clamp(Math.round(o.capH * 0.95), 10, 24);
            x += txt(g, 'T−', x, cp.y + 0.5, FDISP(px), C.threat) + Math.round(px * 0.6);
          }
          const tw = txt(g, cp.text, x, cp.y, cf, HD.rgba(C.text, 0.7), 'left', 1.2);
          g.fillStyle = HD.rgba(C.threat, 0.18);
          const rx = x + tw + 6;
          if (o.blockR - rx > 10) g.fillRect(rx, Math.round(cp.y), o.blockR - rx, 1);
        }
      } else {
        // T− prefix
        g.textBaseline = 'alphabetic';
        txt(g, 'T−', o.blockX + 1, o.digTop + o.tmPx * 0.95, FDISP(o.tmPx), C.threat);
        g.textBaseline = 'middle';
        // centisecond caption above the small digits
        for (const cp of o.caps) txt(g, cp.text, cp.x, cp.y, FUI(o.fs), HD.rgba(C.text, 0.7), 'left', 1);
      }
      if (o.dial) {
        const { x, y, r } = o.dial;
        g.strokeStyle = HD.rgba(C.threat, 0.22);
        g.lineWidth = 1;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.stroke();
        g.fillStyle = HD.rgba(C.threat, 0.55);
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          const r0 = i % 3 ? r - 2 : r - 3.5;
          g.fillRect(x + Math.sin(a) * r0 - 0.5, y - Math.cos(a) * r0 - 0.5, 1, 1);
        }
      }

      // side column: ruler spine + labels
      if (o.side) {
        if (o.spine) {
          const sx = o.sideX - 8.5;
          g.fillStyle = HD.rgba(C.holo, 0.18);
          g.fillRect(sx, o.digTop - 4, 1, o.H + 8);
          for (let y = o.digTop - 4; y <= o.digTop + o.H + 4; y += 4) {
            g.fillRect(sx - ((y - o.digTop) % 16 ? 2 : 4), y, (y - o.digTop) % 16 ? 2 : 4, 1);
          }
        }
        const lf = FUI(o.fs);
        for (const r of o.rows) {
          const cy = r.y + r.h / 2;
          if (r.k === 'chip') continue;
          const label = { ladder: 'THREAT', cycle: 'CYCLE', abort: 'ABORT', sync: 'SYNC', trig: 'TRIG' }[r.k];
          txt(g, label, o.sideX, cy, lf, C.dim, 'left', 1.2 * k);
          g.fillStyle = HD.rgba(C.holo, 0.07);
          g.fillRect(o.sideX, r.y + r.h - 0.5, o.sideW, 1);
        }
      }

      // progress bar: unlit segments, ruler ticks, phase markers
      g.fillStyle = HD.rgba(acc, 0.13);
      g.beginPath();
      for (let i = 0; i < o.segN; i++) g.rect(o.barX + i * o.pitch, o.barY, o.pitch - 1, o.barH);
      g.fill();
      if (o.gapBar >= 7) {
        g.fillStyle = HD.rgba(C.text, 0.35);
        const t1 = Math.round(4 * k);
        const t0 = Math.round(2 * k);
        for (let i = 0; i <= 20; i++) {
          const x = Math.round(o.barX + (o.barW - 1) * (i / 20));
          const big = i % 5 === 0;
          g.fillRect(x, o.barY - (big ? t1 + 1 : t0 + 1), 1, big ? t1 : t0);
        }
      }
      o.markers = [];
      const tri = Math.round(3 * k);
      for (const [ms, lbl, col] of MARKS) {
        const p = 1 - ms / M.total;
        if (p <= 0.001 || p >= 0.999) continue;
        const x = Math.round(o.barX + o.barW * p) + 0.5;
        const c = C[col];
        g.fillStyle = c;
        g.fillRect(x - 0.5, o.barY - 2, 1, o.barH + 4);
        g.beginPath();
        g.moveTo(x, o.barY + o.barH + 1);
        g.lineTo(x + tri, o.barY + o.barH + 1 + tri);
        g.lineTo(x - tri, o.barY + o.barH + 1 + tri);
        g.closePath();
        g.fill();
        o.markers.push({ x, lbl, c });
      }
      if (o.tickLbl) {
        const ly = o.barY + o.barH + Math.round(7 * k);
        const lf = FUI(o.fs);
        const lw0 = txt(g, 'WIPE SEQ', o.barX, ly, lf, C.dim, 'left', 1.2 * k);
        // the live percentage sits right after the label (drawn on the HUD layer)
        o.pctX = o.barX + lw0 + 5;
        let minX = o.pctX + measure(FMONO(9.5 * k, 500), '000.0%') + 10;
        const maxX = o.barX + o.barW;
        for (const m of o.markers) {
          const mw = measure(lf, m.lbl, k);
          // label right of its marker, or left of it when the bar end is too close
          let x0 = m.x + 5;
          if (x0 + mw > maxX) x0 = m.x - 5 - mw;
          if (x0 >= minX && x0 + mw <= maxX) {
            txt(g, m.lbl, x0, ly, lf, m.c, 'left', k);
            minX = x0 + mw + 6;
          }
        }
      }
    }

    /* ------------------------------------------------------------ HUD layer */

    function drawHud(pct) {
      cvA.clear();
      const g = cvA.ctx;
      g.drawImage(base, 0, 0, w, h);
      g.textBaseline = 'middle';
      const o = L;
      const k = o.k;
      const acc = accent();
      const vf = FMONO(o.compact ? 9.5 : 10.5 * k, 500);
      const lf = FUI(o.fs);
      const vals = {
        cycle: U.pad(M.cycle),
        abort: '×' + aborts,
        sync: '±' + sync.toFixed(3) + 's',
        trig: 'NODE ' + trig,
      };
      if (o.side) {
        const right = o.sideX + o.sideW;
        for (const r of o.rows) {
          const cy = r.y + r.h / 2;
          if (r.k === 'ladder') {
            const pi = PHASES.indexOf(phase);
            const cw = Math.round(7 * k);
            const chh = Math.round(6 * k);
            for (let i = 0; i < 5; i++) {
              const x = right - (5 - i) * (cw + 2) + 2;
              g.fillStyle = i <= pi ? (i === 0 ? C.amber : C.threat) : HD.rgba(C.text, 0.14);
              g.fillRect(x, Math.round(cy - chh / 2), cw, chh);
            }
            o.ladderCell = { x: right - (5 - pi) * (cw + 2) + 2, y: Math.round(cy - chh / 2), w: cw, h: chh };
          } else if (r.k === 'chip') {
            drawChip(g, o.sideX, r.y, o.sideW, r.h);
          } else {
            const col = r.k === 'abort' && aborts ? C.threat : r.k === 'cycle' ? C.ice : C.text;
            txt(g, vals[r.k], right, cy, vf, col, 'right');
          }
        }
      }
      if (o.readRow) {
        const y = o.barY + o.barH + o.tickLbl + o.rowH / 2 + 1;
        const chipW = Math.round(66 * k);
        const chipH = Math.round(12 * k);
        drawChip(g, w - o.pad - chipW, Math.round(y - chipH / 2), chipW, chipH);
        let x = o.pad;
        const items = [['CYCLE', vals.cycle, C.ice], ['ABORT', vals.abort, aborts ? C.threat : C.text], ['SYNC', vals.sync, C.text]];
        for (const [kk, v, col] of items) {
          const need = measure(lf, kk, 1.2 * k) + 4 + measure(vf, v) + 12;
          if (x + need > w - o.pad - chipW - 6) break;
          x += txt(g, kk, x, y, lf, C.dim, 'left', 1.2 * k) + 4;
          x += txt(g, v, x, y, vf, col) + 12;
        }
      }
      if (o.tickLbl) {
        const ly = o.barY + o.barH + Math.round(7 * k);
        txt(g, (pct / 10).toFixed(1).padStart(5, '0') + '%', o.pctX, ly, FMONO(9.5 * k, 500), acc, 'left');
      }
    }

    function drawChip(g, x, y, cw, ch) {
      const hot = hover || performance.now() - denyAt < 400;
      const k = L.k;
      g.fillStyle = hot ? HD.rgba(C.threat, 0.32) : HD.rgba(C.threat, 0.08);
      g.fillRect(x, y, cw, ch);
      g.strokeStyle = hot ? C.threat : HD.rgba(C.threat, 0.6);
      g.lineWidth = 1;
      g.strokeRect(x + 0.5, y + 0.5, cw - 1, ch - 1);
      const cy = y + ch / 2;
      g.fillStyle = hot ? '#fff' : C.threat;
      g.beginPath();
      g.moveTo(x + 5 * k, cy - 3 * k);
      g.lineTo(x + 9 * k, cy);
      g.lineTo(x + 5 * k, cy + 3 * k);
      g.closePath();
      g.fill();
      txt(g, 'OVERRIDE', x + cw / 2 + 5 * k, cy + 0.5, FUI(9 * k, 700), hot ? '#fff' : C.threat, 'center', 1.4 * k);
    }

    /* ------------------------------------------------------------- FX layer */

    function digitsOf(rem) {
      const t = Math.floor(rem / 10);
      const cs = t % 100;
      const s = Math.floor(t / 100) % 60;
      const m = Math.floor(t / 6000) % 60;
      const hr = Math.min(99, Math.floor(t / 360000));
      const d = [];
      if (hoursMode) d.push((hr / 10) | 0, hr % 10);
      d.push((m / 10) | 0, m % 10, (s / 10) | 0, s % 10, (cs / 10) | 0, cs % 10);
      return d;
    }

    // The FX layer repaints in full only when the big digits (or an overlay) change, i.e. about
    // twice a second. Other frames repaint just the dirty rects (centiseconds, dial, bar, lamps)
    // under a clip, which keeps the 60 fps cost to a few small blits.
    function fxFrame(now, dt, rem) {
      const o = L;
      const f = fxs;
      f.now = now;
      f.rem = rem;
      f.ox = 0;
      f.oy = 0;
      if (!RM) {
        if (phase === 'final') {
          if (now - jitterAt > 55) {
            jitterAt = now;
            jx = R.int(-2, 2);
            jy = R.int(-1, 1);
          }
          f.ox += jx;
          f.oy += jy;
        }
        const sk = now - shakeAt;
        if (sk < 520) {
          const amp = 7 * (1 - sk / 520);
          f.ox += Math.round(Math.sin(sk * 0.11) * amp);
          f.oy += Math.round(R.range(-1, 1) * amp * 0.25);
        }
      }
      f.ag = now - adjAt;
      f.variant = 'red';
      f.show = true;
      if (f.ag < 450 && adjGood) f.variant = 'green';
      else if (phase === 'final') f.variant = RM || Math.floor(now / 70) % 2 ? 'hot' : 'red';
      else if (phase === 'zero') {
        f.variant = 'hot';
        f.show = RM || Math.floor(now / 260) % 2 === 0;
      }
      f.d = digitsOf(phase === 'zero' ? 0 : rem);
      f.glitch = now < glitchUntil && !RM;
      f.colon = phase === 'zero' || RM || rem % 1000 >= 500;
      const p = phase === 'zero' ? 1 : M.progress();
      f.lit = Math.min(o.segN, Math.floor(p * o.segN + 1e-6));
      f.blink = f.lit < o.segN && (RM || Math.floor(now / 250) % 2 === 0);
      f.lamp = RM || phase === 'zero' || rem % 1000 >= 500;
      f.lad = !!o.ladderCell && !RM && Math.floor(now / 300) % 2 === 1;
      f.stripes = phase === 'final' || phase === 'zero';
      if (f.stripes && !RM) stripeOff = (stripeOff + dt * 36) % stripe.period;

      const overlay = floaters.length > 0 || now - denyAt < 1500 || now - rearmAt < 1800 || f.ag < 700 || f.glitch;
      let key = f.variant + (f.show ? '1' : '0') + f.ox + ',' + f.oy + (f.colon ? ':' : '_');
      for (let i = 0; i < f.d.length - 2; i++) key += f.d[i];
      const bar = f.lit * 2 + (f.blink ? 1 : 0);
      const g = cvB.ctx;

      if (fxFull || overlay || fxOverlay || key !== fxKey) {
        cvB.clear();
        paintFx(g, f);
        fxFull = false;
      } else {
        const rs = fxRects;
        rs.length = 0;
        rs.push(o.rSmall);
        if (o.rDial && phase !== 'zero') rs.push(o.rDial);
        if (bar !== fxBar) rs.push(o.rBar);
        if (f.lamp !== fxLamp) rs.push(o.rLamp);
        if (f.lad !== fxLad && o.ladderCell) rs.push({ x: o.ladderCell.x - 1, y: o.ladderCell.y - 1, w: o.ladderCell.w + 2, h: o.ladderCell.h + 2 });
        if (f.stripes) rs.push(o.rTop, o.rBot);
        for (const r of rs) {
          g.save();
          g.beginPath();
          g.rect(r.x, r.y, r.w, r.h);
          g.clip();
          g.clearRect(r.x, r.y, r.w, r.h);
          paintFx(g, f);
          g.restore();
        }
      }
      fxKey = key;
      fxBar = bar;
      fxLamp = f.lamp;
      fxLad = f.lad;
      fxOverlay = overlay;
    }

    function paintFx(g, f) {
      const o = L;
      const now = f.now;
      if (f.ag < 700) {
        g.fillStyle = HD.rgba(adjGood ? C.phosphor : C.threat, 0.22 * (1 - f.ag / 700));
        g.fillRect(0, 0, w, h);
      }

      // lit digits
      if (f.show) {
        const big = atlas(f.variant, false);
        const sm = atlas(f.variant, true);
        let di = 0;
        for (let i = 0; i < o.seq.length; i++) {
          const k = o.seq[i];
          const A = o.gsm[i] ? sm : big;
          let x = o.gx[i] + f.ox;
          const y = o.gy[i] + f.oy;
          if (k === 'd' || k === 's') {
            let v = f.d[di++];
            if (f.glitch && R.chance(0.35)) {
              v = R.int(0, 9);
              x += R.int(-3, 3);
            }
            blit(g, A, v, x, y);
          } else if (k === ':') {
            if (f.colon) blit(g, A, COLON, x, y);
          } else {
            blit(g, A, DOT, x, y);
          }
        }
      }

      // progress fill + blinking leading segment
      const litW = f.lit * o.pitch;
      if (litW > 0) {
        const dpr = cvB.dpr;
        g.drawImage(litBar, 0, 0, Math.min(litBar.width, litW * dpr), litBar.height, o.barX, o.barY, Math.min(o.barW, litW), o.barH);
        g.fillStyle = HD.rgba(accent(), 0.1);
        g.fillRect(o.barX, o.barY - 2, Math.min(o.barW, litW), o.barH + 4);
      }
      if (f.blink) {
        g.fillStyle = C.ice;
        g.fillRect(o.barX + f.lit * o.pitch, o.barY, o.pitch - 1, o.barH);
      }

      // armed lamp, blinking with the second
      g.fillStyle = f.lamp ? accent() : HD.rgba(accent(), 0.25);
      g.fillRect(o.pad, o.rLamp.y + 1, o.lamp, o.lamp);
      if (o.dial && phase !== 'zero') {
        const { x, y, r } = o.dial;
        const a = -Math.PI / 2 + (1 - (f.rem % 1000) / 1000) * Math.PI * 2;
        g.strokeStyle = accent();
        g.lineWidth = 2;
        g.beginPath();
        g.arc(x, y, r, -Math.PI / 2, a);
        g.stroke();
        g.fillStyle = C.ice;
        g.fillRect(x + Math.cos(a) * r - 1.5, y + Math.sin(a) * r - 1.5, 3, 3);
      }
      if (f.lad) {
        g.fillStyle = 'rgba(2,5,10,0.7)';
        g.fillRect(o.ladderCell.x, o.ladderCell.y, o.ladderCell.w, o.ladderCell.h);
      }

      // hazard stripes crawl along the top and bottom edges in the last seconds
      if (f.stripes) {
        const dpr = cvB.dpr;
        const sw = Math.min(stripe.width, Math.ceil(w * dpr));
        g.drawImage(stripe, stripeOff * dpr, 0, sw, stripe.height, 0, 0, sw / dpr, stripe.bh);
        g.drawImage(stripe, (stripe.period - stripeOff) * dpr, 0, sw, stripe.height, 0, h - stripe.bh, sw / dpr, stripe.bh);
      }

      drawFloaters(g, now);
      drawBand(g, now);
    }

    function drawFloaters(g, now) {
      for (let i = floaters.length - 1; i >= 0; i--) {
        const f = floaters[i];
        const k = (now - f.t0) / 1700;
        if (k >= 1) {
          floaters.splice(i, 1);
          continue;
        }
        const px = U.clamp(Math.round(L.H * 0.3), 12, Math.round(34 * L.k));
        const y = L.flY - U.ease.outCubic(k) * Math.max(24, L.H * 0.55);
        const x = L.flX;
        g.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
        g.fillStyle = 'rgba(2,5,10,0.75)';
        g.font = FMONO(px, 700);
        const tw = g.measureText(f.text).width;
        g.fillRect(x - tw / 2 - 5, y - px * 0.62, tw + 10, px * 1.24);
        g.textBaseline = 'middle';
        txt(g, f.text, x, y + 1, FMONO(px, 700), f.good ? C.phosphor : C.threat, 'center');
        g.globalAlpha = 1;
      }
    }

    // ACCESS DENIED (abort attempt) / RE-ARMED (new cycle) band across the module
    function drawBand(g, now) {
      const dk = now - denyAt;
      const rk = now - rearmAt;
      let kind = null;
      let k = 0;
      if (dk < 1500) {
        kind = 'deny';
        k = dk;
      } else if (rk < 1800) {
        kind = 'rearm';
        k = rk;
      }
      if (!kind) return;
      if (!RM && k < 900 && Math.floor(k / 120) % 2 === 1) return;
      const o = L;
      const bh = U.clamp(Math.round(o.H * 0.46), 22, Math.round(64 * o.k));
      const x0 = o.blockX - 5;
      const bw = o.blockR - o.blockX + 12;
      const y0 = Math.round(o.bandCY - bh / 2);
      const col = kind === 'deny' ? C.threat : C.holo;
      g.globalAlpha = k > 1200 ? U.clamp(1 - (k - 1200) / 350, 0, 1) : 1;
      g.fillStyle = kind === 'deny' ? 'rgba(24,0,6,0.92)' : 'rgba(0,14,20,0.92)';
      g.fillRect(x0, y0, bw, bh);
      g.fillStyle = col;
      g.fillRect(x0, y0, bw, 1);
      g.fillRect(x0, y0 + bh - 1, bw, 1);
      g.fillRect(x0, y0, 3, bh);
      g.fillRect(x0 + bw - 3, y0, 3, bh);
      if (kind === 'deny' && bw > 60) {
        // hazard ticks on the band's shoulders
        const sw = Math.min(stripe.width / cvB.dpr, 34);
        const dpr = cvB.dpr;
        for (const sx of [x0 + 6, x0 + bw - 6 - sw]) {
          g.drawImage(stripe, 0, 0, sw * dpr, stripe.height, sx, y0 + 3, sw, stripe.bh);
          g.drawImage(stripe, 0, 0, sw * dpr, stripe.height, sx, y0 + bh - 3 - stripe.bh, sw, stripe.bh);
        }
      }
      let big = kind === 'deny' ? 'ACCESS DENIED' : 'PAYLOAD RE-ARMED';
      const small = kind === 'deny' ? `BIOMETRIC MISMATCH · ABORT ×${aborts}` : `NEW SIGNAL · CYCLE ${U.pad(M.cycle)}`;
      let px = U.clamp(Math.round(bh * 0.36), 10, Math.round(24 * o.k));
      g.font = FDISP(px);
      g.letterSpacing = '2px';
      while (px > 9 && g.measureText(big).width > bw - 16) g.font = FDISP(--px);
      let bls = 2;
      if (g.measureText(big).width > bw - 12) {
        // narrow modules: tighter tracking, then the short form
        bls = 0.5;
        g.letterSpacing = '0.5px';
        if (g.measureText(big).width > bw - 12) big = kind === 'deny' ? 'DENIED' : 'RE-ARMED';
      }
      g.letterSpacing = '0px';
      const twoLine = bh >= 30;
      const cy = y0 + (twoLine ? bh * 0.4 : bh / 2);
      g.textBaseline = 'middle';
      if (!RM) txt(g, big, x0 + bw / 2 + 1.5, cy + 1, FDISP(px), HD.rgba(kind === 'deny' ? C.neon : C.holo2, 0.6), 'center', bls);
      txt(g, big, x0 + bw / 2, cy, FDISP(px), kind === 'deny' ? '#fff' : C.ice, 'center', bls);
      if (twoLine) {
        // the caption must fit the band (narrow stacked modules): shrink, then shorten
        let sf = Math.max(9, Math.min(9 * o.k, bh * 0.2));
        let cap = small;
        g.font = FUI(sf, 600);
        g.letterSpacing = '1.6px';
        if (g.measureText(cap).width > bw - 12) cap = kind === 'deny' ? `ABORT ×${aborts}` : `CYCLE ${U.pad(M.cycle)}`;
        while (sf > 9 && g.measureText(cap).width > bw - 12) g.font = FUI(--sf, 600);
        g.letterSpacing = '0px';
        txt(g, cap, x0 + bw / 2, y0 + bh * 0.76, FUI(sf, 600), kind === 'deny' ? C.amber : C.holo, 'center', 1.6);
      }
      g.globalAlpha = 1;
    }

    /* --------------------------------------------------------------- phase */

    function setMeta() {
      const tbl = ctx.width && ctx.width < 340 ? META_SHORT : META;
      ctx.meta(tbl[phase] || phase.toUpperCase());
    }

    function setPhase(next, announce) {
      const prev = phase;
      phase = next;
      ctx.frame.dataset.cdPhase = phase;
      setMeta();
      if (L) {
        buildBase();
        buildBar();
        hudSig = '';
        fxFull = true;
      }
      if (!announce) return;
      const up = PHASES.indexOf(next) > PHASES.indexOf(prev);
      if (up && PHASE_ALERT[next]) ctx.alert(PHASE_ALERT[next][0], PHASE_ALERT[next][1]);
      if (up) ctx.flash(next === 'severe' ? 'warn' : 'alert', next === 'severe' ? 900 : 1400);
    }

    function tickSound(rem) {
      if (!ctx.audio.enabled || rem <= 0) return;
      if (phase === 'critical' || phase === 'final') {
        const f = phase === 'final' ? 1760 : 1320;
        ctx.audio.beep(f, 40, 'square', 0.03);
        beepTimers.push(setTimeout(() => ctx.audio.beep(f, 40, 'square', 0.03), 120));
        if (beepTimers.length > 4) clearTimeout(beepTimers.shift());
      } else {
        ctx.audio.beep(phase === 'severe' ? 1040 : 880, 32, 'square', 0.02);
      }
    }

    /* -------------------------------------------------------------- events */

    function attemptAbort() {
      const now = performance.now();
      aborts++;
      denyAt = now;
      shakeAt = now;
      hudSig = '';
      if (now - lastAbortAlert > 900) {
        lastAbortAlert = now;
        ctx.alert('crit', 'ABORT REJECTED — BIOMETRIC MISMATCH');
      }
      ctx.flash('alert', 900);
      if (ctx.audio.enabled) {
        ctx.audio.beep(150, 260, 'sawtooth', 0.04);
        ctx.audio.beep(110, 320, 'square', 0.02);
      }
    }
    hit.addEventListener('click', attemptAbort);
    hit.addEventListener('pointerenter', () => {
      hover = true;
      hudSig = '';
    });
    hit.addEventListener('pointerleave', () => {
      hover = false;
      hudSig = '';
    });

    ctx.on('mission:adjust', (d) => {
      const ms = (d && d.deltaMs) || 0;
      if (!ms) return;
      const f = U.fmtDuration(Math.abs(ms));
      const now = performance.now();
      floaters.push({ text: (ms > 0 ? '+' : '−') + f.m + ':' + f.s, good: ms > 0, t0: now });
      if (floaters.length > 4) floaters.shift();
      adjAt = now;
      adjGood = ms > 0;
      ctx.flash(ms > 0 ? 'ok' : 'alert', 900);
      if (ctx.audio.enabled) ctx.audio.chirp(ms > 0 ? 500 : 1400, ms > 0 ? 1400 : 400, 220, 'sine', 0.04);
    });
    ctx.on('mission:reset', () => {
      rearmAt = performance.now();
      trig = U.randHex(4, R);
      aborts = 0;
      floaters.length = 0;
      hudSig = '';
      fxFull = true;
    });
    ctx.on('intrusion', () => {
      glitchUntil = performance.now() + 900;
    });
    ctx.on('fonts:ready', () => relayout());
    for (const c of [cvA.canvas, cvB.canvas, base, litBar, stripe]) watch(c);
    if (document.fonts && document.fonts.load) {
      Promise.all(
        ['600 10px "Chakra Petch"', '700 10px "Chakra Petch"', '500 10px "JetBrains Mono"', '700 10px "JetBrains Mono"', '10px Michroma'].map(
          (f) => document.fonts.load(f)
        )
      )
        .then(() => {
          if (w) relayout();
        })
        .catch(() => {});
    }

    setPhase(phase, false);

    return {
      fps: 60,
      resize() {
        relayout();
        setMeta();
      },
      tick(now, dt) {
        if (lost) {
          lost = false;
          relayout();
        }
        if (!L) return;
        const rem = M.remaining();
        if (M.phase && M.phase !== phase) setPhase(M.phase, true);
        const hrs = rem >= 3600000;
        if (hrs !== hoursMode || M.total !== lastTotal) {
          hoursMode = hrs;
          lastTotal = M.total;
          relayout();
        }
        const sec = Math.ceil(rem / 1000);
        if (sec !== lastSec) {
          if (lastSec >= 0 && sec < lastSec) tickSound(rem);
          lastSec = sec;
          const f = U.fmtDuration(rem);
          sr.textContent = `Grid wipe in ${f.h !== '00' ? f.h + ':' : ''}${f.m}:${f.s}`;
        }
        if (now - syncAt > 650) {
          syncAt = now;
          sync = U.clamp(sync + R.range(-0.0012, 0.0012), 0.001, 0.004);
        }
        const pct = Math.floor(M.progress() * 1000);
        const chipHot = hover || now - denyAt < 400;
        const sig = `${pct}|${sync.toFixed(3)}|${aborts}|${M.cycle}|${chipHot}|${trig}|${phase}`;
        if (sig !== hudSig) {
          hudSig = sig;
          drawHud(pct);
        }
        fxFrame(now, dt, rem);
      },
    };
  });
})();
