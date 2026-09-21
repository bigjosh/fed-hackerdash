/* FEDLIGHT · P-07 decrypt — CIPHER BREAK
   The movie password crack. A grid of cycling glyphs locks one character at a time in random
   order, a hex dump streams beside it, and a KEY RECOVERED stamp slams in when the last byte
   falls. Labels and frames live on a static canvas (redrawn on resize and font load); the live
   canvas is repainted every tick, with grid glyphs blitted from a pre-rendered atlas. */
(() => {
  'use strict';

  const FILES = [
    { name: 'WRAITH_COMMS.PGP', size: '4.21 MB' },
    // cracked second: all that compute, and the "intel" is Agent Fed's old personal ad (his recognition phrase)
    {
      name: 'LEWIS_PERSONAL_AD.TXT',
      size: '1.97 KB',
      plain: ['“EYES LIKE A PUPPY DOG, LIPS MADE FOR SIN.”', "“YOU'RE NOT DREAMING, I'M FOR REAL.”", '— REPLY TO LEWIS · BOX 1997'],
    },
    { name: 'PAYLOAD.BIN', size: '118.6 MB' },
    { name: 'C2_BEACON.CFG', size: '12.8 KB' },
    { name: 'ORBITAL_KEYS.KDBX', size: '2.04 MB' },
    { name: 'FEDHAT_1997.GIF', size: '52.4 KB' },
  ];
  const CIPHERS = [
    { name: 'AES-4096-GCM', space: '2^4096', rate: 1.42 },
    { name: 'RSA-16384', space: '2^16384', rate: 0.87 },
    { name: 'QUANTUM-LATTICE', space: '2^8192', rate: 3.16 },
  ];
  const HEX = '0123456789ABCDEF';
  const GLYPHS = HEX + 'GHJKMNPRSTVWXYZ#$%&@*+=?<>/\\';
  const NG = GLYPHS.length;
  const S_DIM = 0;
  const S_HOT = 1;
  const S_LOCK = 2;
  const S_WIN = 3;
  const S_BAD = 4;
  const S_PROBE = 5;
  const MONO = '"JetBrains Mono", "Cascadia Mono", Consolas, monospace';
  const UI = '"Chakra Petch", "Segoe UI", sans-serif';
  const DISPLAY = 'Michroma, "Arial Black", sans-serif';
  const HOLD = 3200; // stamp stays up this long before the next file loads
  const WIPE = 750;
  const ROT = 2600; // key-rotation banner; matches the shell's intrusion banner
  const BAD = 1400;
  const PHASE_SPEED = { elevated: 1, severe: 1.05, critical: 1.15, final: 1.3, zero: 1 };

  const ls = (c, px) => {
    if ('letterSpacing' in c) c.letterSpacing = px + 'px';
  };

  HD.panel('decrypt', (ctx) => {
    const { util: U, color: C, rgba } = ctx;
    const R = ctx.rng(HD.seed ^ 0x7dec0de);
    const still = ctx.reducedMotion;
    const base = ctx.canvas({ className: 'dec-base' });
    const live = ctx.canvas({ className: 'dec-live' });
    const b = base.ctx;
    const g = live.ctx;
    // Chrome can drop 2D contexts under memory pressure; the static layer and the offscreen
    // atlas/stamp are not repainted per frame, so rebuild them all once a context comes back.
    let needRefresh = false;
    const onRestore = () => (needRefresh = true);
    base.canvas.addEventListener('contextrestored', onRestore);
    live.canvas.addEventListener('contextrestored', onRestore);

    const cwCache = new Map();
    function charW(px) {
      let v = cwCache.get(px);
      if (!v) {
        g.font = `500 ${px}px ${MONO}`;
        ls(g, 0);
        v = g.measureText('0').width || px * 0.6;
        cwCache.set(px, v);
      }
      return v;
    }

    let L = null;
    let atlas = null;
    let cellX = [];
    let cellY = [];

    // grid
    let n = 0;
    let glyph = new Uint8Array(0);
    let key = new Uint8Array(0);
    let locked = new Uint8Array(0);
    let hot = new Uint8Array(0);
    let lockT = new Float64Array(0);
    let badT = new Float64Array(0);
    let pending = [];
    let lockedCount = 0;

    // crack
    let cycle = 0;
    let file = FILES[0];
    let cipher = CIPHERS[0];
    let salt = '';
    let mode = 'crack';
    let modeAt = 0;
    let startAt = 0;
    let pct = 0;
    let lastStep = 0;
    let dur = 30;
    let speed = 1;
    let avgSpeed = 1;
    let speedTgt = 1;
    let speedAt = 0;
    let stallUntil = 0;
    let rotAt = -1e9;
    let rotDrop = 0;
    let revealAt = 0;
    let keyText = '';
    let stamp = null;
    let rateShown = '0.00';
    let rateAt = 0;
    let eta = 30;
    let crackSecs = 0;
    let lockSound = 0;

    // hex dump + worker strip
    let dump = [];
    const recovered = [];
    let dumpOff = R.int(0x1000, 0xe000) & 0xfff0;
    let dumpScroll = 0;
    const thr = new Float32Array(128);

    /* ----------------------------------------------------------- layout */

    function layout(w, h) {
      const tiny = w < 260 || h < 200;
      const big = w >= 400 && h >= 380;
      const pad = tiny ? 6 : big ? 10 : 8;
      const headH = tiny ? 19 : big ? 44 : 38;
      const footH = tiny ? 36 : big ? 76 : 62;
      const dumpOn = !tiny && w >= 300;
      const dF = big ? 10 : 9;
      const dcw = charW(dF);
      const dBytes = big ? 3 : 2;
      const dumpW = dumpOn ? Math.ceil((5 + dBytes * 3 + dBytes) * dcw) : 0;
      const labW = !tiny && w >= 280 ? Math.ceil(charW(9) * 4) + 7 : 0;
      const colHead = tiny ? 0 : 12;
      const GG = tiny ? 5 : 7;
      const gx0 = pad + labW;
      const gx1 = w - pad - (dumpOn ? dumpW + 14 : 0);
      const gy0 = headH + 5 + colHead;
      const gy1 = h - footH - 5;
      const gw = gx1 - gx0;
      const gh = gy1 - gy0;
      // wall-sized bodies (solo on a monitor) get a bigger, denser grid instead of a lonely island
      const huge = w > 700 && h > 500;
      let f = huge ? 24 : big ? 17 : tiny ? 13 : 15;
      const maxC = huge ? 32 : 16;
      const maxR = huge ? 16 : 10;
      let cols = 4;
      let rows = 2;
      for (; f >= 10; f--) {
        cols = Math.min(maxC, Math.floor((gw + GG) / (4 * f + GG)) * 4);
        rows = Math.min(maxR, Math.floor(gh / (f * 1.55)));
        if (cols >= 12 && rows >= 5) break;
      }
      f = Math.max(10, f);
      cols = Math.max(4, cols);
      rows = Math.max(2, rows);
      const groups = cols / 4;
      const cw = Math.min(f * 1.5, (gw - (groups - 1) * GG) / cols);
      const rh = Math.min(f * 2.1, gh / rows);
      const gridW = cw * cols + (groups - 1) * GG;
      const gridH = rh * rows;
      const ox = Math.round(gx0 + (gw - gridW) / 2);
      const oy = Math.round(gy0 + (gh - gridH) / 2);
      const fy = h - footH;
      const o = {
        w, h, tiny, big, pad, headH, footH, dumpOn, dF, dcw, dBytes, dumpW, labW, colHead, GG,
        f, cols, rows, cw, rh, gridW, gridH, ox, oy, gy0, gy1, fy,
        dx: w - pad - dumpW,
        dlh: Math.round(dF * 1.45),
      };
      if (tiny) {
        o.bar = { x: pad, y: fy + 5, w: w - pad * 2 - 52, h: 7 };
        o.rowC = fy + 25;
      } else {
        const bh = big ? 11 : 9;
        o.rowA = fy + (big ? 8 : 7);
        o.bar = { x: pad, y: fy + (big ? 17 : 14), w: w - pad * 2, h: bh };
        o.rowC = o.bar.y + bh + (big ? 15 : 12);
        o.rowD = o.rowC + (big ? 17 : 14);
      }
      return o;
    }

    function place() {
      cellX = [];
      cellY = [];
      for (let c = 0; c < L.cols; c++) cellX.push(L.ox + c * L.cw + (c >> 2) * L.GG + L.cw / 2);
      for (let r = 0; r < L.rows; r++) cellY.push(L.oy + r * L.rh + L.rh / 2);
    }

    /* ------------------------------------------------------ glyph atlas */

    function buildAtlas() {
      const dpr = live.dpr;
      const f = L.f;
      const gp = Math.ceil(f * 0.55);
      const bw = Math.ceil(f * 0.62) + gp * 2;
      const bh = Math.ceil(f * 1.2) + gp * 2;
      let cv = atlas && atlas.cv;
      if (!cv) {
        cv = document.createElement('canvas');
        cv.addEventListener('contextrestored', onRestore);
      }
      cv.width = Math.round(bw * NG * dpr);
      cv.height = Math.round(bh * 6 * dpr);
      const a = cv.getContext('2d');
      a.setTransform(dpr, 0, 0, dpr, 0, 0);
      a.clearRect(0, 0, bw * NG, bh * 6);
      a.font = `500 ${f}px ${MONO}`;
      a.textAlign = 'center';
      a.textBaseline = 'middle';
      // [fill, glow blur, glow color]; the glow is baked here so the grid never needs shadowBlur
      const styles = [
        [rgba('holo', 0.36), 0, ''],
        [rgba('holo', 0.78), 0, ''],
        [C.ice, f * 0.7, rgba('holo', 0.95)],
        [C.phosphor, f * 0.75, rgba('phosphor', 0.95)],
        [C.threat, f * 0.6, rgba('threat', 0.9)],
        [C.amber, f * 0.35, rgba('amber', 0.6)],
      ];
      styles.forEach(([fill, blur, glow], s) => {
        const y = s * bh + bh / 2 + f * 0.05;
        for (let pass = blur ? 0 : 1; pass < 2; pass++) {
          a.shadowBlur = pass ? 0 : blur * dpr;
          a.shadowColor = pass ? 'transparent' : glow;
          a.fillStyle = fill;
          for (let i = 0; i < NG; i++) a.fillText(GLYPHS[i], i * bw + bw / 2, y);
        }
      });
      atlas = { cv, bw, bh, dpr };
    }

    /* ----------------------------------------------------- static layer */

    function tickRow(c, x0, x1, y, step, major, down) {
      c.beginPath();
      let i = 0;
      for (let x = x0; x <= x1; x += step, i++) {
        const len = i % major === 0 ? 4 : 2;
        c.moveTo(Math.round(x) + 0.5, y);
        c.lineTo(Math.round(x) + 0.5, y + (down ? len : -len));
      }
      c.stroke();
    }

    function brackets(c, x, y, w, h, len) {
      c.beginPath();
      c.moveTo(x, y + len); c.lineTo(x, y); c.lineTo(x + len, y);
      c.moveTo(x + w - len, y); c.lineTo(x + w, y); c.lineTo(x + w, y + len);
      c.moveTo(x + w, y + h - len); c.lineTo(x + w, y + h); c.lineTo(x + w - len, y + h);
      c.moveTo(x + len, y + h); c.lineTo(x, y + h); c.lineTo(x, y + h - len);
      c.stroke();
    }

    function drawStatic() {
      base.clear();
      const { w, pad, headH, tiny, ox, oy, gridW, gridH, cols, rows, cw, rh } = L;
      b.save();
      b.textBaseline = 'middle';
      b.lineWidth = 1;

      // header labels + divider
      if (!tiny) {
        b.font = `600 9px ${UI}`;
        ls(b, 1.6);
        b.fillStyle = C.dim;
        b.fillText('TARGET', pad, pad + 6);
        b.fillText('CIPHER', pad, pad + 21);
        L.hx = pad + Math.ceil(Math.max(b.measureText('TARGET').width, b.measureText('CIPHER').width)) + 7;
        ls(b, 0);
      }
      b.strokeStyle = rgba('holo', 0.24);
      b.beginPath();
      b.moveTo(pad, headH + 0.5);
      b.lineTo(w - pad, headH + 0.5);
      b.stroke();
      b.strokeStyle = rgba('holo', 0.2);
      tickRow(b, pad, w - pad, headH + 1, 6, 8, true);

      // grid bed: faint field, slot underscores, group seams, corner brackets
      b.fillStyle = rgba('holo', 0.022);
      b.fillRect(ox - 3, oy - 2, gridW + 6, gridH + 4);
      b.strokeStyle = rgba('holo', 0.16);
      b.beginPath();
      for (let r = 0; r < rows; r++) {
        const y = Math.round(cellY[r] + rh / 2 - Math.max(3, rh * 0.16)) + 0.5;
        for (let c = 0; c < cols; c++) {
          b.moveTo(Math.round(cellX[c] - cw * 0.3), y);
          b.lineTo(Math.round(cellX[c] + cw * 0.3), y);
        }
      }
      b.stroke();
      b.strokeStyle = rgba('holo', 0.13);
      b.setLineDash([2, 3]);
      b.beginPath();
      for (let gi = 1; gi < cols / 4; gi++) {
        const x = Math.round(ox + gi * (4 * cw + L.GG) - L.GG / 2) + 0.5;
        b.moveTo(x, oy);
        b.lineTo(x, oy + gridH);
      }
      b.stroke();
      b.setLineDash([]);
      b.strokeStyle = rgba('holo', 0.5);
      brackets(b, ox - 3.5, oy - 2.5, gridW + 7, gridH + 5, 6);

      // column indices + row offsets
      if (L.colHead) {
        b.font = `500 9px ${MONO}`;
        b.textAlign = 'center';
        b.fillStyle = rgba('dim', 0.75);
        for (let c = 0; c < cols; c++) b.fillText(HEX[c & 15], cellX[c], oy - 9);
      }
      if (L.labW) {
        b.font = `500 9px ${MONO}`;
        b.textAlign = 'right';
        for (let r = 0; r < rows; r++) {
          b.fillStyle = rgba('dim', r % 2 ? 0.55 : 0.8);
          b.fillText(U.hex(r * cols * 4, 4), ox - 7, cellY[r]);
        }
      }
      b.textAlign = 'left';

      // hex dump column
      if (L.dumpOn) {
        const sx = L.dx - 7.5;
        b.strokeStyle = rgba('holo', 0.2);
        b.beginPath();
        b.moveTo(sx, L.gy0 - L.colHead);
        b.lineTo(sx, L.gy1);
        b.stroke();
        b.strokeStyle = rgba('holo', 0.28);
        b.beginPath();
        for (let y = L.gy0 - L.colHead + 4; y < L.gy1; y += 8) {
          b.moveTo(sx - 2, Math.round(y) + 0.5);
          b.lineTo(sx, Math.round(y) + 0.5);
        }
        b.stroke();
        b.font = `600 9px ${UI}`;
        ls(b, 1.4);
        b.fillStyle = C.dim;
        b.fillText('MEMDUMP', L.dx, oy - 9);
        ls(b, 0);
      }

      // footer frame
      const B = L.bar;
      b.strokeStyle = rgba('holo', 0.42);
      b.strokeRect(B.x + 0.5, B.y + 0.5, B.w - 1, B.h - 1);
      b.strokeStyle = rgba('holo', 0.3);
      tickRow(b, B.x, B.x + B.w - 1, B.y + B.h + 1, (B.w - 1) / 20, 2, true);
      if (!tiny) {
        b.font = `600 9px ${UI}`;
        ls(b, 1.6);
        b.fillStyle = C.dim;
        b.fillText('KEYSPACE EXHAUSTION', pad, L.rowA);
        b.fillText('THR', pad, L.rowD);
        ls(b, 0);
      }
      b.restore();
    }

    /* ------------------------------------------------------------ grid */

    function initCells() {
      n = L.cols * L.rows;
      glyph = new Uint8Array(n);
      key = new Uint8Array(n);
      locked = new Uint8Array(n);
      hot = new Uint8Array(n);
      lockT = new Float64Array(n).fill(-1e9);
      badT = new Float64Array(n).fill(-1e9);
      for (let i = 0; i < n; i++) {
        key[i] = R.int(0, 15);
        glyph[i] = R.int(0, NG - 1);
      }
      pending = R.shuffle(Array.from({ length: n }, (_, i) => i));
      lockedCount = 0;
      const want = mode === 'crack' ? Math.floor((pct / 100) * n) : mode === 'done' ? n : 0;
      while (lockedCount < want && pending.length) {
        const i = pending.pop();
        locked[i] = 1;
        glyph[i] = key[i];
        lockedCount++;
      }
      keyText = '';
      for (let i = 0; i < Math.min(16, n); i++) keyText += (i && i % 4 === 0 ? '-' : '') + HEX[key[i]];
    }

    // the grid wipe is close: the rig runs hotter (PHASE_SPEED) and says so in the status tag
    const overclocked = () => mode === 'crack' && (HD.state.phase === 'critical' || HD.state.phase === 'final');

    function lockCell(i, now) {
      locked[i] = 1;
      glyph[i] = key[i];
      lockT[i] = now;
      lockedCount++;
      // recovered nibbles stream through the dump in ice, tying the two columns together
      if (recovered.length < 6) recovered.push(key[i] * 16 + key[(i + 1) % n]);
      if (++lockSound % 2 === 0) ctx.audio.beep(lockSound % 4 ? 2200 : 1700, 14, 'square', 0.01);
    }

    function startCrack(now) {
      file = FILES[cycle % FILES.length];
      cipher = CIPHERS[cycle % CIPHERS.length];
      salt = U.randHex(4, R) + '·' + U.randHex(4, R);
      mode = 'crack';
      modeAt = startAt = revealAt = now;
      pct = 0;
      lastStep = 0;
      // stalls and the slow last 6 % add ~10 %, so this lands a crack in ~26-36 s
      dur = R.range(24, 32);
      speed = speedTgt = avgSpeed = 1;
      speedAt = stallUntil = 0;
      rotAt = -1e9;
      stamp = null;
      eta = dur;
      ctx.meta(cipher.name);
      if (L) initCells();
      ctx.alert('info', `CIPHER BREAK ENGAGED · ${file.name} · ${cipher.name}`);
    }

    function complete(now) {
      mode = 'done';
      modeAt = now;
      crackSecs = (now - startAt) / 1000;
      if (lastStep < 10) {
        lastStep = 10;
        ctx.emit('decrypt:progress', { pct: 100, file: file.name });
      }
      buildStamp();
      ctx.flash('ok', 1800);
      ctx.emit('decrypt:complete', { key: keyText, file: file.name });
      ctx.alert('crit', 'KEY RECOVERED — ' + file.name);
      ctx.audio.chirp(700, 2400, 260, 'square', 0.03);
    }

    function rotate(now) {
      rotAt = now;
      if (mode !== 'crack' || !n) {
        // the key is already out; the stamp just tears (drawStamp reads rotAt)
        if (mode === 'done') ctx.flash('warn', 700);
        return;
      }
      const lost = Math.min(lockedCount, Math.max(4, Math.round(R.range(0.035, 0.075) * n)));
      const before = pct;
      pct = Math.max(0, ((lockedCount - lost) / n) * 100 - R.range(0, 0.6));
      rotDrop = before - pct;
      const lockedIdx = [];
      for (let i = 0; i < n; i++) if (locked[i]) lockedIdx.push(i);
      const victims = R.shuffle(lockedIdx).slice(0, lost);
      for (const i of victims) {
        locked[i] = 0;
        badT[i] = now;
        lockedCount--;
        // back into the queue, never at the probe end, so they do not re-lock at once
        pending.splice(R.int(0, Math.max(0, pending.length - 3)), 0, i);
      }
      speed = 0.1;
      stallUntil = now + 1500;
      ctx.flash(still ? 'warn' : 'alert', 1200);
      ctx.alert('warn', `KEY ROTATION DETECTED · ${file.name} −${rotDrop.toFixed(1)}%`);
      ctx.audio.chirp(900, 180, 260, 'sawtooth', 0.03);
    }

    /* ------------------------------------------------------- hex dump */

    function dumpLine() {
      const nb = L ? L.dBytes : 2;
      const found = recovered.length ? recovered.shift() : -1;
      const fi = found >= 0 ? R.int(0, nb - 1) : -1;
      let hex = '';
      let asc = '';
      for (let i = 0; i < nb; i++) {
        const v = i === fi ? found : R.chance(0.4) ? R.int(0x30, 0x7a) : R.int(0, 255);
        hex += (i ? ' ' : '') + U.hex(v, 2);
        asc += v > 0x20 && v < 0x7f ? String.fromCharCode(v) : '.';
      }
      dumpOff = (dumpOff + 16) & 0xffff;
      if (fi >= 0) return { off: U.hex(dumpOff, 4), hex, asc, hi: fi, hc: C.ice, mark: true };
      const hi = R.chance(0.2) ? R.int(0, nb - 1) : -1;
      return { off: U.hex(dumpOff, 4), hex, asc, hi, hc: R.chance(0.72) ? C.amber : C.neon };
    }

    function refillDump() {
      const need = Math.ceil((L.gy1 - L.gy0) / L.dlh) + 2;
      dump = [];
      for (let i = 0; i < need; i++) dump.push(dumpLine());
      L.dumpFade = [
        g.createLinearGradient(0, L.gy0, 0, L.gy0 + 18),
        g.createLinearGradient(0, L.gy1 - 18, 0, L.gy1),
      ];
      L.dumpFade[0].addColorStop(0, 'rgba(0,0,0,1)');
      L.dumpFade[0].addColorStop(1, 'rgba(0,0,0,0)');
      L.dumpFade[1].addColorStop(0, 'rgba(0,0,0,0)');
      L.dumpFade[1].addColorStop(1, 'rgba(0,0,0,1)');
    }

    /* ---------------------------------------------------------- stamp */

    function wrapText(c, text, maxW) {
      const out = [];
      let cur = '';
      for (const w of text.split(' ')) {
        const t = cur ? cur + ' ' + w : w;
        if (!cur || c.measureText(t).width <= maxW) cur = t;
        else {
          out.push(cur);
          cur = w;
        }
      }
      if (cur) out.push(cur);
      return out;
    }

    function buildStamp() {
      if (!L) return;
      const dpr = live.dpr;
      const maxW = Math.min(L.w - L.pad * 2 - 8, L.big ? 380 : 320);
      const title = 'KEY RECOVERED';
      const cv = document.createElement('canvas');
      cv.addEventListener('contextrestored', onRestore);
      const s = cv.getContext('2d');
      s.font = `400 20px ${DISPLAY}`;
      ls(s, 2.4);
      const tw20 = s.measureText(title).width;
      let fs = Math.min(L.big ? 24 : L.tiny ? 14 : 18, (20 * (maxW - 34)) / tw20);
      fs = Math.max(9, Math.floor(fs * 2) / 2);
      const lsp = fs * 0.12;
      const font = `400 ${fs}px ${DISPLAY}`;
      s.font = font;
      ls(s, lsp);
      const tw = s.measureText(title).width;
      const plain = file.plain || null;
      const sw = Math.ceil(plain ? maxW : Math.min(maxW, tw + 44));
      const showFile = !L.tiny;
      const titleY = 11 + fs * 0.6;
      const barH = L.tiny ? 12 : 14;
      const barY = Math.round(11 + fs * 1.2 + 6);
      const keyY = barY + barH + 10;
      const plainFont = `500 ${L.tiny ? 9 : 10}px ${MONO}`;
      const rows = [];
      if (plain) {
        s.font = plainFont;
        ls(s, 0);
        for (const p of plain) rows.push(...wrapText(s, p, sw - 18));
      }
      const lineH = L.tiny ? 11 : 12.5;
      const lastY = keyY + Math.max(0, rows.length - 1) * lineH;
      const fileY = lastY + 12;
      const sh = Math.ceil((showFile ? fileY : lastY) + 11);
      cv.width = Math.round(sw * dpr);
      cv.height = Math.round(sh * dpr);
      s.setTransform(dpr, 0, 0, dpr, 0, 0);
      s.textBaseline = 'middle';
      s.textAlign = 'center';

      s.fillStyle = 'rgba(2, 14, 8, 0.92)';
      s.fillRect(0, 0, sw, sh);
      s.strokeStyle = rgba('phosphor', 0.85);
      s.lineWidth = 1;
      s.strokeRect(0.5, 0.5, sw - 1, sh - 1);
      s.strokeStyle = rgba('phosphor', 0.25);
      s.strokeRect(3.5, 3.5, sw - 7, sh - 7);
      s.lineWidth = 2;
      s.strokeStyle = C.phosphor;
      brackets(s, 1, 1, sw - 2, sh - 2, 9);

      s.font = font;
      ls(s, lsp);
      s.shadowColor = rgba('phosphor', 0.95);
      s.shadowBlur = 14 * dpr;
      s.fillStyle = C.phosphor;
      s.fillText(title, sw / 2 + lsp / 2, titleY);
      s.shadowBlur = 0;
      s.fillStyle = 'rgba(214, 255, 226, 0.55)';
      s.fillText(title, sw / 2 + lsp / 2, titleY);

      s.fillStyle = C.phosphor;
      s.fillRect(10, barY, sw - 20, barH);
      s.fillStyle = C.bg;
      s.font = `700 ${L.tiny ? 9 : 10}px ${UI}`;
      const gl = L.tiny ? 2.2 : 3.2;
      ls(s, gl);
      s.fillText(plain ? 'PLAINTEXT · COVER LEWIS' : 'ACCESS GRANTED', sw / 2 + gl / 2, barY + barH / 2 + 0.5);
      s.fillRect(14, barY + barH / 2 - 2, 4, 4);
      s.fillRect(sw - 18, barY + barH / 2 - 2, 4, 4);

      ls(s, 0.6);
      s.font = `500 ${L.tiny ? 9 : 10}px ${MONO}`;
      s.fillStyle = C.ice;
      if (plain) {
        s.font = plainFont;
        ls(s, 0);
        rows.forEach((r, i) => {
          s.fillStyle = r.startsWith('—') ? rgba('phosphor', 0.8) : C.ice;
          s.fillText(r, sw / 2, keyY + i * lineH);
        });
      } else s.fillText('KEY ' + keyText, sw / 2, keyY);
      if (showFile) {
        s.font = `500 9px ${MONO}`;
        s.fillStyle = rgba('phosphor', 0.72);
        s.fillText(`${file.name} · ${crackSecs.toFixed(1)} s`, sw / 2, fileY);
      }
      s.fillStyle = 'rgba(0, 0, 0, 0.22)';
      for (let y = 0; y < sh; y += 3) s.fillRect(0, y, sw, 1);
      stamp = { cv, w: sw, h: sh, fs, lsp, title, titleY, font };
    }

    /* ----------------------------------------------------------- update */

    function update(now, dt) {
      if (mode === 'crack') {
        if (now > speedAt) {
          speedAt = now + R.range(900, 2600);
          speedTgt = R.range(0.6, 1.55);
          if (R.chance(0.12)) stallUntil = now + R.range(600, 1300);
        }
        let tgt = now < stallUntil ? 0.12 : speedTgt;
        if (pct > 94) tgt *= 0.55; // the last few characters always fight back
        tgt *= PHASE_SPEED[HD.state.phase] || 1;
        speed = U.damp(speed, tgt, 3, dt);
        pct = Math.min(100, pct + (100 / dur) * speed * dt);
        const step = Math.floor(pct / 10);
        if (step > lastStep && step < 10) {
          lastStep = step;
          ctx.emit('decrypt:progress', { pct: step * 10, file: file.name });
        }
        const want = pct >= 100 ? n : Math.floor((pct / 100) * n);
        while (lockedCount < want && pending.length) lockCell(pending.pop(), now);
        if (n && lockedCount >= n) complete(now);
        // ETA follows the slow average rate so it counts down instead of lurching with every stall
        avgSpeed = U.damp(avgSpeed, speed, 0.6, dt);
        const tail = Math.max(0, Math.min(100 - pct, 6));
        const rawEta = (100 - pct + tail * 0.8) / ((100 / dur) * Math.max(0.35, avgSpeed));
        eta = U.damp(eta, rawEta, 2.5, dt);
      } else if (mode === 'done') {
        if (now - modeAt > HOLD) {
          mode = 'wipe';
          modeAt = now;
        }
      } else if (mode === 'wipe') {
        const t = (now - modeAt) / WIPE;
        for (let i = 0; i < n; i++) {
          if (!locked[i]) continue;
          const c = i % L.cols;
          const r = (i / L.cols) | 0;
          if (t > (c / L.cols) * 0.75 + (r / L.rows) * 0.25) {
            locked[i] = 0;
            hot[i] = 1;
          }
        }
        if (t >= 1) {
          cycle++;
          startCrack(now);
        }
      }

      if (now > rateAt) {
        rateAt = now + 160;
        const v = mode === 'crack' ? cipher.rate * speed * (0.96 + R() * 0.08) : 0;
        rateShown = v.toFixed(2);
      }

      const p = still ? 0.05 : mode === 'crack' ? 0.42 : 0.3;
      for (let i = 0; i < n; i++) {
        if (locked[i]) {
          hot[i] = 0;
          continue;
        }
        if (R() < p) {
          glyph[i] = (R() * NG) | 0;
          hot[i] = !still && R() < 0.22 ? 1 : 0;
        } else hot[i] = 0;
      }

      if (L.dumpOn) {
        const v = still ? 9 : mode === 'crack' ? 22 + 30 * speed : 8;
        dumpScroll += v * dt;
        while (dumpScroll >= L.dlh) {
          dumpScroll -= L.dlh;
          dump.shift();
          dump.push(dumpLine());
        }
      }

      const tp = still ? 0.04 : overclocked() ? 0.34 : 0.22;
      for (let i = 0; i < thr.length; i++) {
        thr[i] *= still ? 0.97 : 0.84;
        if (R() < tp) thr[i] = mode === 'crack' ? R.range(0.35, 1) * Math.min(1, speed + 0.25) : R.range(0.2, 0.6);
      }
    }

    /* ------------------------------------------------------------- draw */

    function tag(xr, y, text, col, blink) {
      g.font = `600 9px ${UI}`;
      ls(g, 1.4);
      const tw = g.measureText(text).width;
      const w = Math.ceil(tw + 17);
      const x = Math.round(xr - w);
      const y0 = Math.round(y - 6.5);
      g.fillStyle = rgba(col, 0.1);
      g.fillRect(x, y0, w, 13);
      g.strokeStyle = rgba(col, 0.6);
      g.lineWidth = 1;
      g.strokeRect(x + 0.5, y0 + 0.5, w - 1, 12);
      g.fillStyle = rgba(col, blink ? 0.25 : 1);
      g.fillRect(x + 4, y - 2, 4, 4);
      g.fillStyle = C[col] || col;
      g.fillText(text, x + 11, y + 0.5);
      ls(g, 0);
    }

    function scrambled(text, since, ms) {
      if (still) return text;
      const k = Math.floor(U.clamp((performance.now() - since) / ms, 0, 1) * text.length);
      if (k >= text.length) return text;
      let s = text.slice(0, k);
      for (let i = k; i < text.length; i++) s += text[i] === '.' || text[i] === '-' ? text[i] : GLYPHS[(R() * NG) | 0];
      return s;
    }

    function drawHeader(now) {
      const { w, pad, tiny, big } = L;
      const rot = now - rotAt < ROT && mode === 'crack';
      const blink = !still && ((now / 380) | 0) % 2 === 0;
      let st = ['SIEVING', 'amber'];
      if (mode === 'done') st = ['CRACKED', 'phosphor'];
      else if (mode === 'wipe') st = ['NEXT FILE', 'holo'];
      else if (rot) st = ['ROTATION', 'threat'];
      else if (now < stallUntil) st = ['COLLISION', 'amber'];
      else if (overclocked()) st = ['OVERCLOCK', 'neon'];
      g.textBaseline = 'middle';
      const name = scrambled(file.name, revealAt, 650);
      if (tiny) {
        g.font = `500 11px ${MONO}`;
        g.fillStyle = C.ice;
        g.fillText(name, pad, pad + 4);
        tag(w - pad, pad + 4, st[0], st[1], blink && mode === 'crack');
        return;
      }
      const hx = L.hx || pad + 44;
      g.font = `500 ${big ? 14 : 12}px ${MONO}`;
      g.fillStyle = C.ice;
      g.fillText(name, hx, pad + 6);
      g.font = `500 ${big ? 11 : 10}px ${MONO}`;
      g.fillStyle = C.holo;
      g.fillText(scrambled(cipher.name, revealAt + 200, 600), hx, pad + 21);
      tag(w - pad, pad + 6, st[0], st[1], blink && mode === 'crack');
      g.font = `500 9px ${MONO}`;
      g.textAlign = 'right';
      g.fillStyle = C.dim;
      g.fillText(`${file.size} · SALT ${salt}`, w - pad, pad + 21);
      g.textAlign = 'left';
    }

    function drawGrid(now) {
      const { cols, rows, cw, rh } = L;
      const win = mode !== 'crack';
      const rot = now - rotAt;
      g.save();
      if (!still && rot < 320 && mode === 'crack') g.translate(R.range(-2, 2), R.range(-1, 1));

      // sweeping scan band
      if (!still) {
        const period = 2600;
        const t = (now % period) / period;
        const y = L.oy - rh + t * (L.gridH + rh * 2);
        const grad = g.createLinearGradient(0, y - rh, 0, y + rh);
        grad.addColorStop(0, rgba('holo', 0));
        grad.addColorStop(0.5, rgba(win ? 'phosphor' : 'holo', 0.075));
        grad.addColorStop(1, rgba('holo', 0));
        g.fillStyle = grad;
        g.fillRect(L.ox - 3, Math.max(L.oy - 2, y - rh), L.gridW + 6, Math.min(rh * 2, L.oy + L.gridH + 2 - (y - rh)));
      }

      const p1 = mode === 'crack' ? pending[pending.length - 1] : -1;
      const p2 = mode === 'crack' ? pending[pending.length - 2] : -1;
      const bx = Math.max(2, cw * 0.1);
      const by = Math.max(2, rh * 0.12);

      // probe column glow
      if (p1 >= 0 && p1 !== undefined) {
        const c = p1 % cols;
        g.fillStyle = rgba('amber', 0.045);
        g.fillRect(cellX[c] - cw / 2, L.oy, cw, L.gridH);
      }

      // locked boxes (one path each for fill, frame and underline)
      g.beginPath();
      for (let i = 0; i < n; i++) {
        if (!locked[i]) continue;
        const x = cellX[i % cols] - cw / 2 + bx;
        const y = cellY[(i / cols) | 0] - rh / 2 + by;
        g.rect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(cw - bx * 2) - 1, Math.round(rh - by * 2) - 1);
      }
      g.fillStyle = rgba(win ? 'phosphor' : 'holo', 0.07);
      g.fill();
      g.strokeStyle = rgba(win ? 'phosphor' : 'holo', 0.34);
      g.lineWidth = 1;
      g.stroke();
      g.beginPath();
      for (let i = 0; i < n; i++) {
        if (!locked[i]) continue;
        const x = cellX[i % cols];
        const y = Math.round(cellY[(i / cols) | 0] + rh / 2 - by) - 1.5;
        g.moveTo(Math.round(x - cw / 2 + bx + 2), y);
        g.lineTo(Math.round(x + cw / 2 - bx - 2), y);
      }
      g.strokeStyle = win ? C.phosphor : C.ice;
      g.stroke();

      // fresh locks flash, scrambled cells burn red
      for (let i = 0; i < n; i++) {
        const tl = now - lockT[i];
        const tb = now - badT[i];
        if (!(tl < 480 || tb < BAD)) continue;
        const x = cellX[i % cols];
        const y = cellY[(i / cols) | 0];
        if (tl < 480 && locked[i]) {
          const k = 1 - tl / 480;
          g.fillStyle = rgba('ice', 0.5 * k);
          g.fillRect(x - cw / 2 + bx, y - rh / 2 + by, cw - bx * 2, rh - by * 2);
          const e = 5 * k;
          g.strokeStyle = rgba('ice', 0.9 * k);
          brackets(g, x - cw / 2 + bx - e, y - rh / 2 + by - e, cw - bx * 2 + e * 2, rh - by * 2 + e * 2, 3);
        } else if (tb < BAD && !locked[i]) {
          const k = 1 - tb / BAD;
          g.fillStyle = rgba('threat', 0.28 * k);
          g.fillRect(x - cw / 2 + bx, y - rh / 2 + by, cw - bx * 2, rh - by * 2);
          g.strokeStyle = rgba('threat', 0.85 * k);
          g.strokeRect(Math.round(x - cw / 2 + bx) + 0.5, Math.round(y - rh / 2 + by) + 0.5, Math.round(cw - bx * 2) - 1, Math.round(rh - by * 2) - 1);
        }
      }

      // probes: amber brackets on the next characters to fall
      g.strokeStyle = rgba('amber', !still && ((now / 90) | 0) % 2 ? 0.55 : 0.95);
      for (const i of [p1, p2]) {
        if (i === undefined || i < 0) continue;
        const x = cellX[i % cols];
        const y = cellY[(i / cols) | 0];
        brackets(g, Math.round(x - cw / 2 + 1) + 0.5, Math.round(y - rh / 2 + 1) + 0.5, Math.round(cw) - 3, Math.round(rh) - 3, 3);
      }

      // glyphs
      const { cv, bw, bh, dpr } = atlas;
      const sw = bw * dpr;
      const sh = bh * dpr;
      for (let i = 0; i < n; i++) {
        let s;
        if (locked[i]) s = win ? S_WIN : S_LOCK;
        else if (now - badT[i] < BAD) s = S_BAD;
        else if (i === p1 || i === p2) s = S_PROBE;
        else s = hot[i] ? S_HOT : S_DIM;
        g.drawImage(cv, glyph[i] * sw, s * sh, sw, sh, cellX[i % cols] - bw / 2, cellY[(i / cols) | 0] - bh / 2, bw, bh);
      }

      // rotation glitch tears
      if (!still && rot < 500 && mode === 'crack') {
        for (let k = 0; k < 4; k++) {
          g.fillStyle = rgba(k % 2 ? 'threat' : 'neon', R.range(0.2, 0.55));
          g.fillRect(L.ox - 3, L.oy + R() * L.gridH, L.gridW + 6, R.range(1, 2.5));
        }
      }
      g.restore();
    }

    function drawDump() {
      const { dx, dcw, dlh, dF, dBytes, gy0, gy1 } = L;
      g.save();
      g.beginPath();
      g.rect(dx - 2, gy0, L.dumpW + 4, gy1 - gy0);
      g.clip();
      g.font = `400 ${dF}px ${MONO}`;
      g.textBaseline = 'top';
      let y = gy0 - dumpScroll;
      const hx = dx + 5 * dcw;
      const ax = dx + (5 + dBytes * 3) * dcw;
      for (const ln of dump) {
        g.fillStyle = rgba('dim', 0.85);
        g.fillText(ln.off, dx, y);
        g.fillStyle = rgba('holo', 0.6);
        g.fillText(ln.hex, hx, y);
        if (ln.hi >= 0) {
          if (ln.mark) {
            g.fillStyle = rgba('holo', 0.2);
            g.fillRect(hx + ln.hi * 3 * dcw - 1, y - 1, dcw * 2 + 2, dlh - 1);
            g.fillStyle = C.holo;
            g.fillRect(dx - 5, y + 1, 2, dlh - 4);
          }
          g.fillStyle = ln.hc;
          g.fillText(ln.hex.substr(ln.hi * 3, 2), hx + ln.hi * 3 * dcw, y);
        }
        g.fillStyle = rgba('text', 0.38);
        g.fillText(ln.asc, ax, y);
        y += dlh;
      }
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = L.dumpFade[0];
      g.fillRect(dx - 2, gy0, L.dumpW + 4, 18);
      g.fillStyle = L.dumpFade[1];
      g.fillRect(dx - 2, gy1 - 18, L.dumpW + 4, 18);
      g.restore();
    }

    function segs(x, y, list, px) {
      const cw = charW(px);
      g.font = `500 ${px}px ${MONO}`;
      for (const [t, col] of list) {
        g.fillStyle = col;
        g.fillText(t, x, y);
        x += t.length * cw;
      }
    }

    function drawFooter(now) {
      const { w, pad, tiny, big } = L;
      const B = L.bar;
      const win = mode !== 'crack';
      const recent = now - rotAt < 1600 && mode === 'crack';
      const col = win ? 'phosphor' : recent ? 'threat' : 'holo';
      const p = mode === 'crack' ? pct : 100;
      const fw = Math.max(0, ((B.w - 2) * p) / 100);
      const x0 = B.x + 1;
      const y0 = B.y + 1;
      const h0 = B.h - 2;

      g.fillStyle = rgba(col, 0.55);
      g.fillRect(x0, y0, fw, h0);
      // shimmer
      if (!still && fw > 8) {
        const sx = x0 + ((now / 1400) % 1) * (fw + 60) - 30;
        const grad = g.createLinearGradient(sx - 30, 0, sx + 30, 0);
        grad.addColorStop(0, rgba('ice', 0));
        grad.addColorStop(0.5, rgba('ice', 0.45));
        grad.addColorStop(1, rgba('ice', 0));
        g.fillStyle = grad;
        g.fillRect(Math.max(x0, sx - 30), y0, Math.min(60, x0 + fw - Math.max(x0, sx - 30)), h0);
      }
      // cut the fill into LED blocks
      g.save();
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = '#000';
      for (let x = x0 + 3; x < x0 + fw; x += 4) g.fillRect(x, y0, 1, h0);
      g.restore();
      if (recent) {
        const k = 1 - (now - rotAt) / 1600;
        g.fillStyle = rgba('threat', 0.55 * k);
        g.fillRect(x0 + fw, y0, ((B.w - 2) * rotDrop) / 100, h0);
      }
      if (fw > 1) {
        g.fillStyle = rgba(col === 'holo' ? 'ice' : col, 0.3);
        g.fillRect(x0 + fw - 4, B.y - 2, 8, B.h + 4);
        g.fillStyle = col === 'holo' ? C.ice : C[col];
        g.fillRect(x0 + fw - 1, B.y - 2, 2, B.h + 4);
      }

      const pctTxt = p.toFixed(1) + '%';
      const etaS = win ? 0 : Math.min(5999, Math.ceil(eta));
      const etaTxt = `${U.pad(Math.floor(etaS / 60))}:${U.pad(etaS % 60)}`;
      g.textBaseline = 'middle';
      const sep = rgba('dim', 0.8);
      if (tiny) {
        g.font = `500 11px ${MONO}`;
        g.textAlign = 'right';
        g.fillStyle = win ? C.phosphor : C.ice;
        g.fillText(pctTxt, w - pad, B.y + B.h / 2 + 0.5);
        g.font = `500 9px ${MONO}`;
        g.fillStyle = C.dim;
        g.fillText(cipher.space, w - pad, L.rowC);
        g.textAlign = 'left';
        segs(
          pad,
          L.rowC,
          win
            ? [['SOLVED ', C.dim], [crackSecs.toFixed(1) + ' s', C.phosphor]]
            : [[rateShown + ' PH/s', C.holo], [' · ', sep], ['ETA ', C.dim], [etaTxt, C.amber]],
          9
        );
        return;
      }

      g.font = `500 ${big ? 15 : 13}px ${MONO}`;
      g.textAlign = 'right';
      g.fillStyle = win ? C.phosphor : C.ice;
      g.fillText(pctTxt, w - pad, L.rowA);
      g.textAlign = 'left';

      const px = big ? 10.5 : 9;
      const list = win
        ? [
          ['KEYSPACE ', C.dim], [cipher.space, C.text], [' · ', sep],
          [pctTxt, C.phosphor], [' · ', sep],
          ['SOLVED IN ', C.dim], [crackSecs.toFixed(1) + ' s', C.phosphor],
        ]
        : [
          ['KEYSPACE ', C.dim], [cipher.space, C.text], [' · ', sep],
          [pctTxt, C.ice], [' · ', sep],
          [rateShown + ' PH/s', C.holo], [' · ', sep],
          ['ETA ', C.dim], [etaTxt, C.amber],
        ];
      let chars = 0;
      for (const s of list) chars += s[0].length;
      if (chars * charW(px) > w - pad * 2) list.splice(0, 1);
      segs(pad, L.rowC, list, px);

      // worker threads
      const blk = `${U.pad(lockedCount, 3)}/${U.pad(n, 3)}`;
      const blkW = (4 + blk.length) * charW(9);
      const sx = pad + 24;
      const count = Math.min(thr.length, Math.floor((w - pad * 2 - 24 - blkW - 8) / 4));
      const y = Math.round(L.rowD - 3);
      const hotC = overclocked() ? C.neon : C.amber;
      for (let i = 0; i < count; i++) {
        const v = thr[i];
        g.fillStyle = win ? rgba('phosphor', 0.2 + v * 0.6) : v > 0.93 ? hotC : rgba('holo', 0.12 + v * 0.7);
        g.fillRect(sx + i * 4, y, 3, 6);
      }
      segs(w - pad - blkW, L.rowD, [['BLK ', C.dim], [blk, win ? C.phosphor : C.ice]], 9);
    }

    function drawStamp(now) {
      if (!stamp) return;
      const t = (now - modeAt) / 1000;
      let alpha = 1;
      let t2 = t;
      if (mode === 'wipe') {
        alpha = Math.max(0, 1 - (now - modeAt) / (WIPE * 0.55));
        t2 = 10;
      }
      if (alpha <= 0) return;
      const { pad, w } = L;
      const top = L.headH + 2;
      const bot = L.fy - 3;
      g.fillStyle = rgba('bg', 0.62 * alpha * Math.min(1, t2 * 5));
      g.fillRect(pad - 2, top, w - pad * 2 + 4, bot - top);

      const cx = Math.round(w / 2);
      const cy = Math.round(L.oy + L.gridH / 2);
      const gl = still ? 0 : Math.max(0, 1 - t2 / 0.5);
      const hit = !still && now - rotAt < 700;
      const micro = !still && gl === 0 && (hit || now % 1700 < 70);
      const sc = still || t2 >= 0.26 ? 1 : 1 + 0.3 * (1 - U.ease.outCubic(t2 / 0.26));
      const { cv, dpr } = { cv: stamp.cv, dpr: live.dpr };
      g.save();
      g.globalAlpha = alpha * (gl > 0 && R() < 0.3 * gl ? 0.35 : 1);
      g.translate(cx, cy);
      g.scale(sc, sc);
      const x0 = -stamp.w / 2;
      const y0 = -stamp.h / 2;
      if (gl > 0 || micro) {
        const slices = 8;
        const hS = stamp.h / slices;
        for (let i = 0; i < slices; i++) {
          const amp = gl * 16 + (hit ? 12 : micro ? 5 : 0);
          const dx = R() < 0.55 ? (R() - 0.5) * 2 * amp : 0;
          g.drawImage(cv, 0, i * hS * dpr, cv.width, hS * dpr, x0 + dx, y0 + i * hS, stamp.w, hS);
        }
        if (gl > 0) {
          g.globalCompositeOperation = 'lighter';
          g.font = stamp.font;
          ls(g, stamp.lsp);
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          const off = 2 + gl * 5;
          g.fillStyle = rgba('neon', 0.6 * gl);
          g.fillText(stamp.title, stamp.lsp / 2 - off, y0 + stamp.titleY);
          g.fillStyle = rgba('holo', 0.6 * gl);
          g.fillText(stamp.title, stamp.lsp / 2 + off, y0 + stamp.titleY + 1);
          ls(g, 0);
        }
      } else {
        g.drawImage(cv, x0, y0, stamp.w, stamp.h);
      }
      // scan line rolling down the stamp
      if (!still) {
        const sy = y0 + ((now % 1400) / 1400) * stamp.h;
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = rgba('phosphor', 0.12);
        g.fillRect(x0 + 2, sy, stamp.w - 4, 2);
      }
      g.restore();
      g.textAlign = 'left';
    }

    function drawRotation(now) {
      const t = (now - rotAt) / ROT;
      if (t < 0 || t >= 1 || mode !== 'crack') return;
      const { w, pad, tiny } = L;
      const bh = tiny ? 16 : 19;
      const y = Math.round(L.oy + L.gridH / 2 - bh / 2);
      const x0 = pad;
      const x1 = w - pad;
      const a = t < 0.06 ? t / 0.06 : t > 0.85 ? (1 - t) / 0.15 : 1;
      g.save();
      g.globalAlpha = a;
      g.fillStyle = 'rgba(26, 0, 8, 0.9)';
      g.fillRect(x0, y, x1 - x0, bh);
      g.fillStyle = C.threat;
      g.fillRect(x0, y, x1 - x0, 1);
      g.fillRect(x0, y + bh - 1, x1 - x0, 1);
      // hazard stripes at both ends
      g.save();
      g.beginPath();
      g.rect(x0, y + 1, 14, bh - 2);
      g.rect(x1 - 14, y + 1, 14, bh - 2);
      g.clip();
      g.fillStyle = C.amber;
      g.beginPath();
      const shift = still ? 0 : ((now / 40) | 0) % 6;
      for (const [a0, a1] of [[x0 - bh, x0 + 14], [x1 - 14 - bh, x1]]) {
        for (let sx = a0 + shift; sx < a1; sx += 6) {
          g.moveTo(sx, y + bh);
          g.lineTo(sx + 3, y + bh);
          g.lineTo(sx + 3 + bh, y);
          g.lineTo(sx + bh, y);
        }
      }
      g.fill();
      g.restore();

      const flick = !still && ((now / 170) | 0) % 2 === 0;
      const main = tiny || w < 300 ? 'KEY ROTATION' : 'KEY ROTATION DETECTED';
      const drop = `−${rotDrop.toFixed(1)}%`;
      g.font = `700 ${tiny ? 9 : 10}px ${UI}`;
      ls(g, tiny ? 1.4 : 2.2);
      const mw = g.measureText(main).width;
      g.font = `500 ${tiny ? 9 : 10}px ${MONO}`;
      ls(g, 0);
      const dw = g.measureText(drop).width;
      const total = mw + 10 + dw;
      let x = Math.round(w / 2 - total / 2);
      // warning triangle
      g.fillStyle = flick ? C.ice : C.threat;
      g.font = `700 ${tiny ? 9 : 10}px ${UI}`;
      ls(g, tiny ? 1.4 : 2.2);
      g.textBaseline = 'middle';
      g.fillText(main, x, y + bh / 2 + 0.5);
      ls(g, 0);
      x += mw + 10;
      g.font = `500 ${tiny ? 9 : 10}px ${MONO}`;
      g.fillStyle = C.amber;
      g.fillText(drop, x, y + bh / 2 + 0.5);
      g.restore();
    }

    function draw(now) {
      live.clear();
      drawHeader(now);
      drawGrid(now);
      if (L.dumpOn) drawDump(now);
      drawFooter(now);
      if (mode === 'done' || mode === 'wipe') drawStamp(now);
      drawRotation(now);
    }

    /* ---------------------------------------------------------- wiring */

    function refresh() {
      if (!L) return;
      cwCache.clear();
      const keep = { w: L.w, h: L.h };
      L = null;
      resize(keep.w, keep.h);
    }

    function resize(w, h) {
      if (w < 40 || h < 40) return;
      const prevN = n;
      L = layout(w, h);
      place();
      buildAtlas();
      drawStatic();
      if (L.cols * L.rows !== prevN) initCells();
      if (L.dumpOn) refillDump();
      if (stamp && mode !== 'crack') buildStamp();
    }

    ctx.on('intrusion', () => rotate(performance.now()));
    ctx.on('mission:reset', () => {
      cycle = 0;
      startCrack(performance.now());
    });
    ctx.on('fonts:ready', refresh);
    if (document.fonts && document.fonts.load) {
      Promise.all(
        ['600 9px "Chakra Petch"', '700 10px "Chakra Petch"', '500 10px "JetBrains Mono"', '400 10px "JetBrains Mono"', '400 12px Michroma'].map((f) =>
          document.fonts.load(f)
        )
      ).then(refresh, () => {});
    }

    startCrack(performance.now());

    return {
      fps: 30,
      resize,
      tick(now, dt) {
        if (!L || !atlas) return;
        if (needRefresh) {
          needRefresh = false;
          refresh();
        }
        if (atlas.dpr !== live.dpr) buildAtlas();
        update(now, dt);
        draw(now);
      },
    };
  });
})();
