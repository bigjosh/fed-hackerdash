/* FEDLIGHT · P-08 sysmon — CORE TELEMETRY
   Cockpit telemetry for the cluster doing the heavy lifting: per-core load bars with peak-hold,
   MEM / THERMAL bars, NET IN/OUT sparklines and an ICE load arc. Everything random-walks and
   climbs with the mission clock. Static chrome sits on its own canvas (redrawn on resize and
   font load) so a tick only paints the moving parts. */
(() => {
  'use strict';

  const MONO = '"JetBrains Mono", "Cascadia Mono", Consolas, monospace';
  const UI = '"Chakra Petch", "Segoe UI", sans-serif';
  const NCORE = 16;
  const SPARK = 420;
  const PHASE_BOOST = { elevated: 0, severe: 6, critical: 14, final: 24, zero: 30 };
  const PEG = 97;

  const ls = (c, px) => {
    if ('letterSpacing' in c) c.letterSpacing = px + 'px';
  };

  HD.panel('sysmon', (ctx) => {
    const { util: U, color: C, rgba } = ctx;
    const R = ctx.rng(HD.seed ^ 0x5157e8);
    const still = ctx.reducedMotion;
    const base = ctx.canvas({ className: 'sys-base' });
    const live = ctx.canvas({ className: 'sys-live' });
    const b = base.ctx;
    const g = live.ctx;
    // Chrome can drop 2D contexts under memory pressure; the static layer is not repainted per
    // frame, so redraw it once a context comes back.
    let needRefresh = false;
    const onRestore = () => (needRefresh = true);
    base.canvas.addEventListener('contextrestored', onRestore);
    live.canvas.addEventListener('contextrestored', onRestore);

    /* -------------------------------------------------------------- sim */

    const load = new Float32Array(NCORE);
    const tgt = new Float32Array(NCORE);
    const off = new Float32Array(NCORE);
    const nextAt = new Float64Array(NCORE);
    const burstUntil = new Float64Array(NCORE);
    const peak = new Float32Array(NCORE);
    const peakAt = new Float64Array(NCORE);
    for (let i = 0; i < NCORE; i++) {
      off[i] = R.range(-16, 16);
      load[i] = tgt[i] = peak[i] = R.range(12, 55);
    }
    let avg = 35;
    let mem = 54;
    let memT = 54;
    let memAt = 0;
    let therm = 58;
    let thermBoost = 0;
    let ice = 30;
    let iceT = 30;
    let iceAt = 0;
    let pwr = 3.1;
    let netIn = 3.1;
    let netInT = 3.1;
    let netOut = 1.1;
    let netOutT = 1.1;
    let netAt = 0;
    let spikeUntil = 0;
    let spikeAt = -1e9;
    let shuffleAt = 0;
    const bufIn = new Float32Array(SPARK);
    const bufOut = new Float32Array(SPARK);
    let head = 0;
    let count = 0;
    let lastSample = 0;
    const SI = still ? 0.3 : 0.12; // seconds between sparkline samples
    let vmaxIn = 8;
    let vmaxOut = 4;
    // synthesize history so the sparklines are full from the first frame
    (() => {
      let vi = netIn;
      let vo = netOut;
      let ti = vi;
      let to = vo;
      for (let k = 0; k < SPARK; k++) {
        if (k % 7 === 0) {
          ti = Math.max(0.4, 1.6 + Math.abs(R.gauss()) * 3.2 * (R.chance(0.12) ? 2 : 1));
          to = Math.max(0.15, 0.5 + Math.abs(R.gauss()) * 1.6);
        }
        vi += (ti - vi) * 0.3 + R.gauss() * 0.1;
        vo += (to - vo) * 0.3 + R.gauss() * 0.06;
        bufIn[k] = Math.max(0.05, vi);
        bufOut[k] = Math.max(0.02, vo);
      }
      count = SPARK;
      netIn = netInT = bufIn[SPARK - 1];
      netOut = netOutT = bufOut[SPARK - 1];
    })();
    let shown = null; // throttled readouts so numbers are legible, not a blur
    let shownAt = 0;

    function sim(now, dt) {
      const prog = ctx.mission.progress();
      const boost = PHASE_BOOST[HD.state.phase] || 0;
      const mean = 32 + 40 * prog + boost;
      const spike = now < spikeUntil;
      const burstP = 0.015 + 0.06 * prog + boost * 0.003;
      if (now > shuffleAt) {
        shuffleAt = now + R.range(5000, 9000);
        off[R.int(0, NCORE - 1)] = R.range(-18, 18);
      }
      let sum = 0;
      for (let i = 0; i < NCORE; i++) {
        if (now > nextAt[i]) {
          nextAt[i] = now + R.range(250, 1100) * (still ? 2.5 : 1);
          tgt[i] = U.clamp(mean + off[i] + R.gauss() * 26, 3, 100);
          if (R.chance(burstP)) burstUntil[i] = now + R.range(500, 2200);
        }
        const burst = now < burstUntil[i];
        let v = U.damp(load[i], burst ? 100 : tgt[i], burst ? 9 : 5, dt);
        if (!still) v += R.gauss() * 1.4;
        if (spike) v = 100;
        load[i] = v = U.clamp(v, 0, 100);
        if (v >= peak[i]) {
          peak[i] = v;
          peakAt[i] = now;
        } else if (now - peakAt[i] > 1200) {
          peak[i] = Math.max(v, peak[i] - 28 * dt);
        }
        sum += v;
      }
      avg = sum / NCORE;

      if (now > memAt) {
        memAt = now + R.range(1200, 3200);
        memT = U.clamp(44 + 34 * prog + boost * 0.5 + R.gauss() * 7, 18, 97);
      }
      mem = U.damp(mem, spike ? Math.min(99, memT + 8) : memT, 0.9, dt);
      thermBoost = U.damp(thermBoost, 0, 0.22, dt);
      therm = U.damp(therm, 34 + avg * 0.5 + thermBoost, 0.7, dt);
      pwr = U.damp(pwr, 2.2 + avg * 0.038 + (spike ? 1.5 : 0), 2, dt);
      if (now > iceAt) {
        iceAt = now + R.range(600, 2000);
        iceT = U.clamp(20 + 42 * prog + boost + R.gauss() * 14, 4, 99);
      }
      ice = U.damp(ice, spike ? 100 : iceT, spike ? 8 : 1.6, dt);
      if (now > netAt) {
        netAt = now + R.range(300, 1400);
        netInT = Math.max(0.3, 1.5 + 4.5 * prog + boost * 0.07 + Math.abs(R.gauss()) * 3.2);
        if (R.chance(0.12)) netInT *= 2;
        netOutT = Math.max(0.1, 0.5 + 1.8 * prog + Math.abs(R.gauss()) * 1.6);
        if (R.chance(0.08)) netOutT *= 2.4;
      }
      netIn = Math.max(0.05, U.damp(netIn, spike ? netInT * 2.6 : netInT, 4, dt) + (still ? 0 : R.gauss() * 0.08));
      netOut = Math.max(0.02, U.damp(netOut, netOutT, 4, dt) + (still ? 0 : R.gauss() * 0.05));

      const t = now / 1000;
      if (t - lastSample >= SI) {
        lastSample = t;
        bufIn[head] = netIn;
        bufOut[head] = netOut;
        head = (head + 1) % SPARK;
        count = Math.min(SPARK, count + 1);
      }
      let mi = 0;
      let mo = 0;
      for (let k = 0; k < count; k++) {
        mi = Math.max(mi, bufIn[k]);
        mo = Math.max(mo, bufOut[k]);
      }
      vmaxIn = U.damp(vmaxIn, Math.max(2, mi, netIn) * 1.3, 1.5, dt);
      vmaxOut = U.damp(vmaxOut, Math.max(1, mo, netOut) * 1.3, 1.5, dt);

      if (!shown || now > shownAt) {
        shownAt = now + (still ? 600 : 220);
        shown = { avg, mem, therm, ice, pwr, netIn, netOut, nums: Array.from(load, (v) => Math.round(v)) };
      }
    }

    /* ----------------------------------------------------------- layout */

    let L = null;

    // text width at a given label font (Chakra Petch 600, letter-spaced); layout-time only
    function lblW(text, px, spacing) {
      b.font = `600 ${px}px ${UI}`;
      ls(b, spacing);
      const v = b.measureText(text).width;
      ls(b, 0);
      return v;
    }

    // CPU block: label row, optional per-core number rows, bars, optional core index labels
    function cpuBlock(o, x, y, cw, bot, { axis = true, nums = true, labels = true } = {}) {
      const k = o.k;
      o.ax = x;
      o.aw = cw;
      o.axisW = axis ? 7 : 0;
      // fewer, fatter cores when the column is narrow
      o.ncore = NCORE;
      for (const n of [16, 12, 8]) {
        o.ncore = n;
        if ((cw - o.axisW) / n >= (o.mini ? 5.5 : 6)) break;
      }
      const cell = (cw - o.axisW) / o.ncore;
      o.nums = nums ? (cell >= 17 * k ? 1 : 2) : 0;
      o.labelY = y + Math.round(5 * k);
      o.numY = [y + Math.round(17 * k), y + Math.round(27 * k)];
      o.barTop = o.nums ? y + Math.round(12 * k) + o.nums * Math.round(10 * k) + Math.round(5 * k) : y + Math.round(14 * k);
      o.coreLabels = labels;
      o.barBot = bot - (labels ? Math.round(11 * k) : 2);
    }

    // MEM / THERM / PWR rows with the ICE arc on their right, inside (x, y, cw, bh)
    function statsBlock(o, x, y, cw, bh, gaugeMax) {
      const k = o.k;
      // rows need room for label + value; the arc gives way first, and goes when too small
      const cv = charW(o.fv);
      const rowNeed = Math.max(
        lblW('THERM', o.fs, 1.4) + 6 + cv * 4,
        lblW('PWR', o.fs, 1.4) + 8 + cv * 4 + charW(o.fs) * 2
      );
      const gd = Math.max(0, Math.floor(Math.min(bh, cw * 0.42, gaugeMax, cw - 8 - rowNeed)));
      o.gauge = gd >= 34 ? { cx: x + cw - gd / 2, cy: y + bh / 2 + 1, r: gd / 2 - 4 } : null;
      const rx1 = o.gauge ? x + cw - gd - 8 : x + cw;
      const nr = bh >= 48 * k ? 3 : 2;
      const pitch = bh / nr;
      const rowH = Math.round(15 * k);
      const off = Math.max(0, Math.round((pitch - rowH) / 2) - 1);
      const keys = ['mem', 'therm', 'pwr'];
      o.rows = [];
      for (let i = 0; i < nr; i++) {
        const ry = y + i * pitch + off;
        o.rows.push({ key: keys[i], x, w: rx1 - x, ty: ry + Math.round(5 * k), by: Math.round(ry + 10.5 * k), bh: Math.max(4, Math.round(4 * k)) });
      }
    }

    // NET IN / NET OUT sparklines, stacked or side by side, inside (x, y, cw, ch)
    function sparkBlock(o, x, y, cw, ch, sideBySide) {
      const k = o.k;
      const lh = Math.round(11 * k);
      const mk = (key, sx, sy, sw, sh) => ({
        key,
        label: key === 'in' ? 'NET IN' : 'NET OUT',
        col: key === 'in' ? 'holo' : 'neon',
        x: Math.round(sx),
        y: Math.round(sy + lh),
        w: Math.round(sw),
        h: Math.max(6, Math.round(sh - lh)),
        ty: Math.round(sy + 4 * k),
      });
      if (sideBySide) {
        const gap = Math.round(14 * k);
        const sw = (cw - gap) / 2;
        o.sparks = [mk('in', x, y, sw, ch), mk('out', x + sw + gap, y, sw, ch)];
      } else {
        const gap = Math.round(5 * k);
        const sh = (ch - gap) / 2;
        o.sparks = [mk('in', x, y, cw, sh), mk('out', x, y + sh + gap, cw, sh)];
      }
    }

    function layout(w, h) {
      const tall = h >= 250 && h >= w * 1.6 && w < 420;
      const wide = !tall && w >= 480 && w >= h * 3.6;
      const mini = !tall && !wide && (h < 100 || w < 230);
      const big = w >= 400;
      // full-screen sized panels scale type and geometry with the panel, within caps
      const k = mini || tall ? 1 : wide ? U.clamp(Math.min(w / 1400, h / 200), 1, 1.6) : U.clamp(Math.min(w / 700, h / 320), 1, 1.7);
      const pad = mini ? 5 : big ? Math.round(8 * k) : 6;
      const o = { w, h, mini, big, tall, wide, pad, k, seams: [], rows: [], gauge: null, therm: null };
      o.fs = 9 * k; // label px
      o.fv = 10 * k; // value px
      const iw = w - pad * 2;
      if (mini) {
        // CPU on the left, THERM + one NET sparkline on the right; the right column gets
        // at least the width its readouts need, the cores make do with what is left
        const need = Math.max(lblW('THERM', 9, 1.4) + 4 + charW(11) * 4, lblW('NET', 9, 1.4) + 8 + charW(9) * 9 + 2) + 2;
        const bw = Math.min(iw - 50, Math.max(Math.round(iw * 0.47), Math.ceil(need)));
        cpuBlock(o, pad, pad, iw - bw - 10, h - pad + 2, { axis: false, nums: false, labels: false });
        o.bx = w - pad - bw;
        o.bw = bw;
        o.therm = { x: o.bx, xr: o.bx + bw, y: pad + 5 };
        o.sparks = [{ key: 'in', label: 'NET', col: 'holo', x: o.bx, y: pad + 26, w: bw, h: h - pad - (pad + 26), ty: pad + 19 }];
        o.seams.push([o.bx - 6.5, pad, o.bx - 6.5, h - pad]);
      } else if (tall) {
        // CPU across the top, then the stats block, then two stacked sparklines
        const cpuH = Math.round(h * 0.42);
        cpuBlock(o, pad, pad, iw, cpuH);
        const y0 = cpuH + 12;
        o.seams.push([pad, cpuH + 5.5, w - pad, cpuH + 5.5]);
        const topH = U.clamp(Math.round(h * 0.13), 48, 110);
        statsBlock(o, pad, y0, iw, topH, 110);
        const sy0 = y0 + topH + 8;
        o.seams.push([pad, sy0 - 3.5, w - pad, sy0 - 3.5]);
        sparkBlock(o, pad, sy0, iw, h - pad - sy0, false);
      } else if (wide) {
        // three columns: CPU | stats + ICE arc | NET IN and NET OUT side by side
        const cw = Math.round(iw * 0.4);
        const short = h < 110;
        cpuBlock(o, pad, pad, cw, h - pad + (short ? 2 : 0), { nums: !short, labels: h >= 120 });
        const sx = pad + cw + 13;
        const sw = Math.round(iw * 0.24);
        statsBlock(o, sx, pad, sw, h - pad * 2, Math.round(120 * k));
        const px0 = sx + sw + 13;
        sparkBlock(o, px0, pad, w - pad - px0, h - pad * 2, true);
        o.seams.push([sx - 6.5, pad, sx - 6.5, h - pad], [px0 - 6.5, pad, px0 - 6.5, h - pad]);
      } else {
        const aw = Math.round(iw * (big ? 0.5 : 0.47));
        cpuBlock(o, pad, pad, aw, h - pad, { labels: h >= 120 });
        o.bx = o.ax + o.aw + 13;
        o.bw = w - pad - o.bx;
        // right column: bars + ICE arc on top, two sparklines below
        const topH = h >= 170 ? Math.min(Math.round(110 * k), Math.max(50, Math.round(h * 0.26))) : 40;
        statsBlock(o, o.bx, pad, o.bw, topH, topH);
        const sy0 = pad + topH + 7;
        sparkBlock(o, o.bx, sy0, o.bw, h - pad - sy0, false);
        o.seams.push([o.bx - 6.5, pad, o.bx - 6.5, h - pad]);
      }
      o.cell = (o.aw - o.axisW) / o.ncore;
      o.barW = Math.max(3, Math.floor(o.cell - (o.cell > 9 ? 3 : 2)));
      o.coreX = [];
      for (let i = 0; i < o.ncore; i++) o.coreX.push(Math.round(o.ax + o.axisW + i * o.cell + (o.cell - o.barW) / 2));
      o.barGrad = g.createLinearGradient(0, o.barBot, 0, o.barTop);
      o.barGrad.addColorStop(0, rgba('holo2', 0.5));
      o.barGrad.addColorStop(0.55, rgba('holo', 0.85));
      o.barGrad.addColorStop(0.8, C.holo);
      o.barGrad.addColorStop(0.86, C.amber);
      o.barGrad.addColorStop(1, C.amber);
      if (o.gauge) o.gauge.lw = Math.max(3, Math.round(o.gauge.r / 16));
      for (const r of o.rows) {
        r.memTag = r.key === 'mem' && r.w >= lblW('MEM', o.fs, 1.4) + 10 + charW(o.fv) * 4 + charW(o.fs) * 13;
      }
      for (const s of o.sparks) {
        // narrow beds: short label so it never runs into the live value
        const valW = charW(mini ? 9 : o.fv) * 5 + charW(o.fs) * 4 + 2;
        if (lblW(s.label, o.fs, 1.4) + 8 + valW > s.w) s.label = s.key === 'in' ? 'IN' : 'OUT';
        // "PK x.x" beside the label, only when it clears the live value on the right
        const pkX = s.x + Math.round(Math.max(lblW('NET IN', o.fs, 1.4), lblW('NET OUT', o.fs, 1.4))) + 10;
        s.pkX = !mini && pkX + charW(o.fs) * 8 + 10 + charW(o.fv) * 5 + charW(o.fs) * 4 <= s.x + s.w ? pkX : 0;
        s.fill = g.createLinearGradient(0, s.y, 0, s.y + s.h);
        s.fill.addColorStop(0, rgba(s.col, 0.34));
        s.fill.addColorStop(1, rgba(s.col, 0.02));
        s.step = mini ? 2.5 : 3;
      }
      for (const r of o.rows) {
        if (r.key !== 'therm') continue;
        r.grad = g.createLinearGradient(r.x, 0, r.x + r.w, 0);
        r.grad.addColorStop(0, C.holo2);
        r.grad.addColorStop(0.55, C.holo);
        r.grad.addColorStop(0.78, C.amber);
        r.grad.addColorStop(1, C.threat);
      }
      return o;
    }

    /* ----------------------------------------------------- static layer */

    function label(c, text, x, y, col, spacing) {
      c.font = `600 ${L ? L.fs : 9}px ${UI}`;
      ls(c, spacing == null ? 1.4 : spacing);
      c.fillStyle = col || C.dim;
      c.fillText(text, x, y);
      const w = c.measureText(text).width;
      ls(c, 0);
      return w;
    }

    function drawStatic() {
      base.clear();
      const { ax, aw, barTop, barBot } = L;
      const fs = L.fs;
      b.save();
      b.textBaseline = 'middle';
      b.lineWidth = 1;

      // cores: label, axis ticks, segmented tracks, baseline, index labels
      const lw = label(b, 'CPU', ax, L.labelY, C.holo, 1.8);
      b.font = `500 ${fs}px ${MONO}`;
      // the core-count tag only where the AVG readout leaves room for it
      L.tagR = ax + lw + 6 + b.measureText('16C/128T').width;
      if (!L.mini && L.tagR + 8 + charW(fs) * 4 + lblW('AVG', fs, 1.2) + 4 <= ax + aw) {
        b.fillStyle = C.dim;
        b.fillText('16C/128T', ax + lw + 6, L.labelY);
      } else {
        L.tagR = ax + lw;
      }
      // spike readout: the full word only where it clears the label (and tag)
      b.font = `700 ${fs}px ${UI}`;
      ls(b, 1.4);
      L.sat = ax + aw - b.measureText('SATURATED').width >= L.tagR + 6 ? 'SATURATED' : 'SAT';
      ls(b, 0);
      if (L.axisW) {
        b.strokeStyle = rgba('holo', 0.35);
        b.beginPath();
        for (let k = 0; k <= 4; k++) {
          const y = Math.round(barBot - ((barBot - barTop) * k) / 4) + 0.5;
          b.moveTo(ax, y);
          b.lineTo(ax + (k % 2 ? 2 : 4), y);
        }
        b.moveTo(ax + 0.5, barTop);
        b.lineTo(ax + 0.5, barBot);
        b.stroke();
        b.strokeStyle = rgba('holo', 0.07);
        b.setLineDash([1, 3]);
        b.beginPath();
        for (let k = 1; k < 4; k++) {
          const y = Math.round(barBot - ((barBot - barTop) * k) / 4) + 0.5;
          b.moveTo(ax + L.axisW, y);
          b.lineTo(ax + aw, y);
        }
        b.stroke();
        b.setLineDash([]);
      }
      b.fillStyle = rgba('holo', 0.07);
      for (let i = 0; i < L.ncore; i++) {
        for (let y = barBot - 2; y >= barTop; y -= 3) b.fillRect(L.coreX[i], y, L.barW, 2);
      }
      b.strokeStyle = rgba('holo', 0.4);
      b.beginPath();
      b.moveTo(ax + L.axisW, barBot + 1.5);
      b.lineTo(ax + aw, barBot + 1.5);
      b.stroke();
      if (L.coreLabels) {
        b.font = `500 ${fs}px ${MONO}`;
        b.textAlign = 'center';
        for (let i = 0; i < L.ncore; i += 4) {
          b.fillStyle = rgba('dim', 0.9);
          b.fillText(U.pad(i), L.coreX[i] + L.barW / 2, barBot + Math.round(7 * L.k));
        }
        b.textAlign = 'left';
      }

      // column / block seams
      b.strokeStyle = rgba('holo', 0.14);
      b.setLineDash([2, 3]);
      b.beginPath();
      for (const [x0, y0, x1, y1] of L.seams) {
        if (x0 === x1) {
          b.moveTo(Math.round(x0) + 0.5, y0);
          b.lineTo(Math.round(x1) + 0.5, y1);
        } else {
          b.moveTo(x0, Math.round(y0) + 0.5);
          b.lineTo(x1, Math.round(y1) + 0.5);
        }
      }
      b.stroke();
      b.setLineDash([]);

      // MEM / THERM / PWR rows
      for (const r of L.rows) {
        label(b, r.key === 'mem' ? 'MEM' : r.key === 'therm' ? 'THERM' : 'PWR', r.x, r.ty);
        b.fillStyle = rgba('holo', 0.08);
        for (let x = r.x; x < r.x + r.w - 1; x += 3) b.fillRect(x, r.by, 2, r.bh);
      }

      // ICE arc
      if (L.gauge) {
        const { cx, cy, r } = L.gauge;
        const a0 = Math.PI * 0.75;
        const a1 = Math.PI * 2.25;
        b.strokeStyle = rgba('holo', 0.13);
        b.lineWidth = L.gauge.lw;
        b.beginPath();
        b.arc(cx, cy, r, a0, a1);
        b.stroke();
        b.lineWidth = 1;
        b.strokeStyle = rgba('holo', 0.45);
        b.beginPath();
        for (let k = 0; k <= 10; k++) {
          const a = a0 + ((a1 - a0) * k) / 10;
          const r0 = r + 2.5;
          const r1 = r + (k % 5 === 0 ? 5 : 3.5);
          b.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
          b.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        }
        b.stroke();
        b.textAlign = 'center';
        label(b, 'ICE', cx + 0.7, cy + r * 0.78, C.dim, 1.4);
        b.textAlign = 'left';
      }

      // sparkline beds: faint grid + frame ticks + labels
      for (const s of L.sparks) {
        b.fillStyle = rgba(s.col, 0.025);
        b.fillRect(s.x, s.y, s.w, s.h);
        b.strokeStyle = rgba('holo', 0.07);
        b.beginPath();
        for (let k = 1; k < 3; k++) {
          const y = Math.round(s.y + (s.h * k) / 3) + 0.5;
          b.moveTo(s.x, y);
          b.lineTo(s.x + s.w, y);
        }
        for (let x = s.x + s.w - 16; x > s.x; x -= 16) {
          b.moveTo(Math.round(x) + 0.5, s.y);
          b.lineTo(Math.round(x) + 0.5, s.y + s.h);
        }
        b.stroke();
        b.strokeStyle = rgba(s.col, 0.35);
        b.beginPath();
        b.moveTo(s.x, s.y + s.h + 0.5);
        b.lineTo(s.x + s.w, s.y + s.h + 0.5);
        b.stroke();
        b.strokeStyle = rgba('holo', 0.4);
        b.beginPath();
        b.moveTo(s.x + 0.5, s.y);
        b.lineTo(s.x + 0.5, s.y + 3);
        b.moveTo(s.x + s.w - 0.5, s.y);
        b.lineTo(s.x + s.w - 0.5, s.y + 3);
        b.stroke();
        label(b, s.label, s.x, s.ty);
      }
      if (L.therm) label(b, 'THERM', L.therm.x, L.therm.y);
      b.restore();
    }

    /* ------------------------------------------------------------- draw */

    const cwCache = new Map();
    function charW(px) {
      let v = cwCache.get(px);
      if (!v) {
        g.font = `500 ${px}px ${MONO}`;
        v = g.measureText('0').width || px * 0.6;
        cwCache.set(px, v);
      }
      return v;
    }

    // right-aligned "value unit" pair, value bright and unit dim
    function valUnit(xr, y, val, unit, px, col) {
      const cw = charW(px);
      const uw = unit ? charW(L.fs) * unit.length : 0;
      g.textAlign = 'left';
      if (unit) {
        g.font = `500 ${L.fs}px ${MONO}`;
        g.fillStyle = C.dim;
        g.fillText(unit, xr - uw, y);
      }
      g.font = `500 ${px}px ${MONO}`;
      g.fillStyle = col;
      g.fillText(val, xr - uw - (unit ? 2 : 0) - val.length * cw, y);
    }

    const heat = (v, warn, crit) => (v >= crit ? C.threat : v >= warn ? C.amber : C.ice);

    function drawCores(now) {
      const { ax, aw, barTop, barBot, barW, coreX, ncore } = L;
      const H = barBot - barTop;
      const spike = now < spikeUntil;
      const blink = !still && ((now / 160) | 0) % 2 === 0;

      g.textBaseline = 'middle';
      // header readout: average, or a saturation warning while spiking
      const fs = L.fs;
      if (spike) {
        g.font = `700 ${fs}px ${UI}`;
        ls(g, 1.4);
        g.textAlign = 'right';
        g.fillStyle = blink ? C.threat : C.ice;
        g.fillText(L.sat, ax + aw, L.labelY);
        ls(g, 0);
        g.textAlign = 'left';
      } else if (!L.mini) {
        const a = Math.round(shown.avg);
        valUnit(ax + aw, L.labelY, `${a}%`, '', fs, heat(a, 80, 95));
        g.font = `600 ${fs}px ${UI}`;
        ls(g, 1.2);
        g.textAlign = 'right';
        g.fillStyle = C.dim;
        g.fillText('AVG', ax + aw - charW(fs) * `${a}%`.length - 4, L.labelY);
        ls(g, 0);
        g.textAlign = 'left';
      }

      // bars
      for (let i = 0; i < ncore; i++) {
        const v = load[i];
        const bh = Math.round((H * v) / 100);
        if (bh <= 0) continue;
        g.fillStyle = v >= PEG ? C.threat : L.barGrad;
        g.fillRect(coreX[i], barBot - bh, barW, bh);
      }
      // cut the bars into LED segments (only touches the live layer)
      g.save();
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = '#000';
      for (let y = barBot - 3; y > barTop - 1; y -= 3) g.fillRect(ax + L.axisW, y, aw - L.axisW, 1);
      g.restore();
      // pegged glow (additive wash, no shadowBlur)
      g.save();
      g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < ncore; i++) {
        if (load[i] < PEG) continue;
        g.fillStyle = rgba('threat', spike ? 0.22 : 0.14);
        g.fillRect(coreX[i] - 2, barTop, barW + 4, H);
      }
      g.restore();

      // peak-hold ticks
      for (let i = 0; i < ncore; i++) {
        const y = Math.round(barBot - (H * peak[i]) / 100);
        g.fillStyle = peak[i] >= PEG ? C.threat : C.ice;
        g.fillRect(coreX[i] - 1, Math.max(barTop - 1, y - 2), barW + 2, 2);
      }

      // average marker on the axis
      if (L.axisW) {
        const y = barBot - (H * avg) / 100;
        g.fillStyle = C.amber;
        g.beginPath();
        g.moveTo(ax + 1, y - 3);
        g.lineTo(ax + 6, y);
        g.lineTo(ax + 1, y + 3);
        g.closePath();
        g.fill();
        g.strokeStyle = rgba('amber', 0.28);
        g.setLineDash([2, 2]);
        g.beginPath();
        g.moveTo(ax + L.axisW, Math.round(y) + 0.5);
        g.lineTo(ax + aw, Math.round(y) + 0.5);
        g.stroke();
        g.setLineDash([]);
      }

      // per-core numbers, staggered over two rows so each gets two cells of width
      if (L.nums) {
        g.font = `500 ${fs}px ${MONO}`;
        g.textAlign = 'center';
        // three digits only fit when each number owns ~19 px; otherwise a pegged core reads PK
        const room = (L.nums === 1 ? L.cell : L.cell * 2) / L.k;
        for (let i = 0; i < ncore; i++) {
          const v = shown.nums[i];
          const y = L.nums === 1 ? L.numY[0] : L.numY[i % 2];
          g.fillStyle = v >= PEG ? C.threat : v >= 85 ? C.amber : i % 2 ? rgba('ice', 0.72) : C.ice;
          g.fillText(v >= 100 && room < 19 ? 'PK' : String(v), coreX[i] + barW / 2, y);
        }
        g.textAlign = 'left';
      }
    }

    function drawRows() {
      for (const r of L.rows) {
        let frac;
        let val;
        let unit;
        let col;
        let fill;
        if (r.key === 'mem') {
          frac = mem / 100;
          val = `${Math.round(shown.mem)}%`;
          // the dim "·" keeps "45%" and "29.0/64T" from reading as one number
          unit = r.memTag ? ` · ${((shown.mem / 100) * 64).toFixed(1)}/64T` : '';
          col = heat(shown.mem, 85, 95);
          fill = rgba('holo', 0.85);
        } else if (r.key === 'therm') {
          frac = U.clamp((therm - 30) / 75, 0, 1);
          val = `${Math.round(shown.therm)}°C`;
          unit = '';
          col = heat(shown.therm, 82, 92);
          fill = r.grad;
        } else {
          frac = U.clamp(pwr / 8, 0, 1);
          val = shown.pwr.toFixed(2);
          unit = 'MW';
          col = C.ice;
          fill = rgba('holo2', 0.9);
        }
        const fw = Math.round((r.w - 1) * frac);
        g.fillStyle = fill;
        g.fillRect(r.x, r.by, fw, r.bh);
        g.save();
        g.globalCompositeOperation = 'destination-out';
        g.fillStyle = '#000';
        for (let x = r.x + 2; x < r.x + fw; x += 3) g.fillRect(x, r.by, 1, r.bh);
        g.restore();
        g.fillStyle = C.ice;
        g.fillRect(r.x + fw, r.by - 1, 1, r.bh + 2);
        g.textBaseline = 'middle';
        valUnit(r.x + r.w, r.ty, val, unit, L.fv, col);
      }
    }

    function drawGauge(now) {
      if (!L.gauge) return;
      const { cx, cy, r } = L.gauge;
      const a0 = Math.PI * 0.75;
      const a1 = Math.PI * 2.25;
      const v = U.clamp(ice / 100, 0, 1);
      const a = a0 + (a1 - a0) * v;
      const col = ice >= 90 ? C.threat : ice >= 70 ? C.amber : C.holo;
      const lw = L.gauge.lw;
      g.lineWidth = lw;
      g.strokeStyle = col;
      g.beginPath();
      g.arc(cx, cy, r, a0, a);
      g.stroke();
      g.lineWidth = lw + 4;
      g.strokeStyle = rgba(col, 0.12);
      g.beginPath();
      g.arc(cx, cy, r, a0, a);
      g.stroke();
      g.lineWidth = 1;
      // needle
      g.strokeStyle = rgba('ice', 0.9);
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * (r - 6), cy + Math.sin(a) * (r - 6));
      g.lineTo(cx + Math.cos(a) * (r + 3), cy + Math.sin(a) * (r + 3));
      g.stroke();
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `500 ${r >= 20 ? Math.round(U.clamp(r * 0.32, 12, 30)) : 11}px ${MONO}`;
      g.fillStyle = ice >= 90 ? C.threat : C.ice;
      g.fillText(String(Math.round(shown.ice)), cx, cy - 1);
      g.textAlign = 'left';
      if (!still && ice >= 90 && ((now / 200) | 0) % 2 === 0) {
        g.strokeStyle = rgba('threat', 0.5);
        g.beginPath();
        g.arc(cx, cy, r + 7, a0, a1);
        g.stroke();
      }
    }

    function drawSpark(s, buf, cur, vmax, now) {
      const { x, y, w, h, step } = s;
      const frac = U.clamp((now / 1000 - lastSample) / SI, 0, 1);
      const yOf = (v) => y + h - U.clamp(v / vmax, 0, 1) * (h - 2) - 1;
      g.save();
      g.beginPath();
      g.rect(x, y - 3, w, h + 4);
      g.clip();
      g.beginPath();
      const x1 = x + w - 1;
      g.moveTo(x1, yOf(cur));
      let px = x1;
      for (let k = 0; k < count; k++) {
        px = x1 - (k + frac) * step;
        g.lineTo(px, yOf(buf[(head - 1 - k + SPARK) % SPARK]));
        if (px < x) break;
      }
      g.strokeStyle = C[s.col];
      g.lineWidth = 1.25;
      g.lineJoin = 'round';
      g.stroke();
      g.lineTo(px, y + h);
      g.lineTo(x1, y + h);
      g.closePath();
      g.fillStyle = s.fill;
      g.fill();
      g.restore();
      const ey = yOf(cur);
      g.fillStyle = rgba(s.col, 0.25);
      g.beginPath();
      g.arc(x1 - 1, ey, 4.5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = C.ice;
      g.beginPath();
      g.arc(x1 - 1, ey, 2, 0, Math.PI * 2);
      g.fill();
    }

    function drawSparks(now) {
      for (const s of L.sparks) {
        const isIn = s.key === 'in';
        drawSpark(s, isIn ? bufIn : bufOut, isIn ? netIn : netOut, isIn ? vmaxIn : vmaxOut, now);
        const v = isIn ? shown.netIn : shown.netOut;
        g.textBaseline = 'middle';
        valUnit(s.x + s.w, s.ty, v.toFixed(2), 'Gb/s', L.mini ? 9 : L.fv, isIn ? C.ice : rgba('neon', 1));
        if (s.pkX) {
          g.font = `500 ${L.fs}px ${MONO}`;
          g.fillStyle = rgba('dim', 0.9);
          g.fillText(`PK ${((isIn ? vmaxIn : vmaxOut) / 1.3).toFixed(1)}`, s.pkX, s.ty);
        }
      }
    }

    function drawMini() {
      const t = Math.round(shown.therm);
      valUnit(L.therm.xr, L.therm.y, `${t}°C`, '', 11, heat(t, 82, 92));
    }

    function draw(now) {
      live.clear();
      drawCores(now);
      if (L.therm) drawMini();
      drawRows();
      drawGauge(now);
      drawSparks(now);
    }

    /* ---------------------------------------------------------- wiring */

    function resize(w, h) {
      if (w < 40 || h < 30) return;
      L = layout(w, h);
      drawStatic();
      ctx.meta(w >= 350 ? 'CLUSTER Ω · 64 NODES' : w >= 280 ? 'Ω · 64 NODES' : 'Ω·64N');
    }

    function refresh() {
      cwCache.clear();
      if (L) resize(L.w, L.h);
    }

    ctx.on('intrusion', () => {
      const now = performance.now();
      spikeAt = now;
      spikeUntil = now + 1500;
      thermBoost += 18;
      therm += 9;
      for (let i = 0; i < NCORE; i++) burstUntil[i] = now + R.range(1500, 2300);
      ctx.flash(still ? 'warn' : 'alert', 1100);
      ctx.audio.beep(160, 220, 'sawtooth', 0.03);
    });
    ctx.on('mission:reset', () => {
      thermBoost = 0;
      spikeUntil = 0;
    });
    ctx.on('fonts:ready', refresh);
    if (document.fonts && document.fonts.load) {
      Promise.all(['600 9px "Chakra Petch"', '700 9px "Chakra Petch"', '500 10px "JetBrains Mono"'].map((f) => document.fonts.load(f))).then(refresh, () => {});
    }

    return {
      fps: 30,
      resize,
      tick(now, dt) {
        if (!L) return;
        if (needRefresh) {
          needRefresh = false;
          refresh();
        }
        sim(now, dt);
        draw(now);
      },
    };
  });
})();
