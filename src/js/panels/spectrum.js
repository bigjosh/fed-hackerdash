/* FEDLIGHT · P-09 SIGINT // VOICE
   An intercepted voice channel: an oscilloscope and a scrolling spectrogram driven by one synthetic
   speech model, a redacted transcript that types in step with the speech, and a voiceprint matcher
   that climbs, emits voice:match, loses the target to a frequency hop and hunts again. */
(() => {
  'use strict';

  const TAU = Math.PI * 2;
  const FMAX = 4000; // Hz at the top of the spectrogram
  const THRESH = 0.88;
  const FREQS = ['437.225', '441.875', '439.650', '436.100', '443.375', '438.925', '440.510'];
  // F1/F2/F3 (Hz) for a handful of vowels; syllables glide between them.
  const VOWELS = [
    [730, 1090, 2440], [530, 1840, 2480], [270, 2290, 3010], [570, 840, 2410],
    [300, 870, 2240], [500, 1500, 2500], [660, 1720, 2410], [440, 1020, 2240],
  ];
  // '#' is a redacted character. {street} / {district} come from the live target state.
  const LINES_S1 = [
    'package moves at ##:00… east of Pont ###',
    'tell SABLE the key is ####',
    'switch plates at porte ######. not before ##:##',
    'the wipe runs at ####. make sure the ### is clean',
    "they're on the grid. go dark after ##:##",
    'M1RR0R holds the other half of the #####',
    'taking {street}. no cameras past ######',
    'if KESTREL shows up, burn the ######',
    'I want ###### gone before zero. all of it',
    'the car is clean. ### plates, ### chassis',
    'drop is on quai ###, under the ###### arch',
    'last métro out of ###### at ##:##. be on it',
  ];
  const LINES_S2 = [
    'copy. the ##### waits on level ##',
    "you're hot, W. they have the ### on you",
    'buyer wants proof of #### first',
    'drone net over {district}. go around',
    'understood. ######## in ## minutes',
    'NULLSEC is on this channel. switch to ###',
    'flics on every bridge. stay off the quais',
  ];
  const LINES_URGENT = [
    'go now. the grid drops in ## seconds',
    'cut the ######. cut it NOW',
    "it's done. burn this channel. burn ###",
    'forget the ####. just drive',
  ];

  const MONO = (px) => `500 ${px}px "JetBrains Mono", Consolas, monospace`;
  const UI = (px) => `600 ${px}px "Chakra Petch", "Segoe UI", sans-serif`;
  const DISP = (px) => `${px}px Michroma, "Arial Black", sans-serif`;

  // black → deep teal → cyan → ice → magenta on the peaks
  const LUT = (() => {
    const stops = [
      [0, 2, 5, 10], [0.14, 2, 20, 28], [0.3, 4, 58, 72], [0.45, 10, 118, 138], [0.6, 40, 190, 215],
      [0.72, 95, 243, 255], [0.85, 223, 248, 255], [0.93, 255, 150, 196], [1, 255, 42, 109],
    ];
    const lut = new Uint8ClampedArray(256 * 4);
    for (let i = 0; i < 256; i++) {
      const v = i / 255;
      let k = 1;
      while (k < stops.length - 1 && stops[k][0] < v) k++;
      const a = stops[k - 1];
      const b = stops[k];
      const t = (v - a[0]) / (b[0] - a[0] || 1);
      for (let c = 0; c < 3; c++) lut[i * 4 + c] = a[c + 1] + (b[c + 1] - a[c + 1]) * t;
      lut[i * 4 + 3] = 255;
    }
    return lut;
  })();

  const gauss = (f, c, bw) => {
    const d = (f - c) / bw;
    return Math.exp(-d * d);
  };

  /* ---------------------------------------------------------- speech model */

  function makeVoice(r) {
    return {
      r, talking: false, t: 0, dur: 0.7, spk: 1, syl: null, gap: 0,
      env: 0, fr: 0, frF: 3200, pl: 0, f0: 110, F: [500, 1500, 2500], urg: 0, wordEnd: true, last: null,
      burst: 0, tone: 1200, jam: 0, glitch: 0, onStart: null, onEnd: null,
    };
  }

  // Syllables chain into words with continuous voicing, so formants read as gliding bands.
  function newSyllable(v) {
    const r = v.r;
    const tgt = r.pick(VOWELS);
    const sc = v.spk === 1 ? 1 : 1.13;
    const ws = v.wordEnd;
    const kind = r() < (ws ? 0.25 : 0.06) ? 'f' : r() < (ws ? 0.3 : 0.1) ? 'p' : '';
    const on = kind === 'f' ? r.range(0.05, 0.09) : kind === 'p' ? 0.02 : 0;
    v.wordEnd = r() < 0.36;
    v.syl = {
      t: 0, on, kind, ws: ws || kind === 'f', we: v.wordEnd,
      dur: on + r.range(0.17, 0.34) * (1 - 0.25 * v.urg),
      amp: r.range(0.55, 1),
      acc: r.range(-0.06, 0.14),
      base: (v.spk === 1 ? 104 : 176) * (1 + 0.14 * v.urg),
      F0: v.F.slice(),
      Ft: tgt.map((f) => f * sc * r.range(0.94, 1.06)),
    };
    v.frF = r.range(2500, 3400);
  }

  function stepVoice(v, dt) {
    const r = v.r;
    v.t += dt;
    let envT = 0;
    let frT = 0;
    if (!v.talking && v.t >= v.dur) {
      v.talking = true;
      v.t = 0;
      v.syl = null;
      v.last = null;
      v.gap = 0.03;
      v.dur = v.onStart ? v.onStart(v) : r.range(1.4, 3.4);
    }
    if (v.talking) {
      const s = v.syl;
      if (s) {
        s.t += dt;
        const vt = s.t - s.on;
        const vd = s.dur - s.on;
        if (s.t >= s.dur) {
          v.syl = null;
          v.gap = s.we ? (r() < 0.2 ? r.range(0.18, 0.3) : r.range(0.05, 0.13)) : 0;
          v.last = s;
        } else {
          if (s.t < s.on) {
            if (s.kind === 'f') frT = Math.min(1, s.t / 0.02, (s.on - s.t) / 0.02) * 0.85;
            else v.pl = 1;
          }
          if (vt >= 0) {
            const att = s.ws ? Math.min(1, vt / 0.03) : 0.72 + 0.28 * Math.min(1, vt / 0.05);
            const rel = s.we ? Math.min(1, (vd - vt) / 0.05) : 1;
            envT = Math.max(0, Math.min(att, rel)) * s.amp;
            const k = Math.min(1, vt / (0.8 * vd));
            const e = k * k * (3 - 2 * k);
            for (let i = 0; i < 3; i++) v.F[i] = s.F0[i] + (s.Ft[i] - s.F0[i]) * e;
            const prog = Math.min(1, v.t / v.dur);
            v.f0 = s.base * (1 + 0.16 * (1 - prog)) * (1 + s.acc * Math.sin((Math.PI * vt) / vd)) * (1 + 0.012 * r.gauss());
          }
        }
      } else {
        v.gap -= dt;
        if (v.gap <= 0) {
          if (v.t >= v.dur) {
            v.talking = false;
            v.t = 0;
            v.dur = r.range(0.45, 1.6) * (1 - 0.35 * v.urg);
            if (v.onEnd) v.onEnd(v);
          } else {
            v.wordEnd = v.last ? v.last.we : true;
            newSyllable(v);
          }
        }
      }
    }
    const k = Math.min(1, dt * 45);
    v.env += (envT - v.env) * k;
    v.fr += (frT - v.fr) * k;
    if (v.burst > 0) {
      v.burst -= dt;
      if (r() < 0.45) v.tone = v.tone === 1200 ? 2200 : 1200;
    }
    if (v.jam > 0) v.jam -= dt;
    if (v.glitch > 0) v.glitch -= dt;
  }

  // One spectrogram column (power → dB → colormap) into `data`, starting at byte `off`, `stride` bytes per row.
  function synthColumn(v, H, data, off, stride, t) {
    const r = v.r;
    const env2 = v.env * v.env;
    const f0 = v.f0;
    const F1 = v.F[0];
    const F2 = v.F[1];
    const F3 = v.F[2];
    const hzRow = FMAX / H;
    // harmonic striations only where the rows can resolve them (avoids moiré on short panels)
    const combDepth = Math.max(0, Math.min(0.9, (f0 / hzRow - 2) / 3));
    const jam = v.jam > 0;
    const chirp = ((t * 1.35) % 1) * FMAX;
    const chirp2 = ((t * 0.9 + 0.5) % 1) * FMAX;
    const glitch = v.glitch > 0;
    const whF = 1650 + 60 * Math.sin(t * 0.37);
    const whA = 0.05 + 0.03 * Math.sin(t * 1.3);
    for (let y = 0; y < H; y++) {
      const f = FMAX * (1 - (y + 0.5) / H);
      let p = 0.016 * (0.3 + r() * 1.4);
      // CTCSS pilot, channel edge and two faint heterodyne whistles
      p += 0.6 * gauss(f, 88.5, 45) + 0.01 * gauss(f, 3450, 30) + whA * gauss(f, whF, 26) + 0.03 * gauss(f, 2890, 22);
      if (env2 > 0.0004) {
        const c = 0.5 + 0.5 * Math.cos((TAU * f) / f0);
        const comb = 1 - combDepth + combDepth * c * c * c * c;
        const form = gauss(f, F1, 75) + 0.62 * gauss(f, F2, 95) + 0.34 * gauss(f, F3, 120) + 0.002;
        p += (env2 * 30 * form * comb) / (1 + f / 1800);
      }
      if (v.fr > 0.01) p += v.fr * 1.6 * (0.3 + r()) / (1 + Math.exp(-(f - v.frF) / 180));
      if (v.pl) p += (f > 1500 ? 0.08 : 0.015) * (0.3 + r());
      if (v.burst > 0) p += 26 * gauss(f, v.tone, 40);
      if (jam) p += 2.2 * r() * r() + 70 * gauss(f, chirp, 55) + 30 * gauss(f, chirp2, 70) + (r() < 0.012 ? 90 : 0);
      if (glitch) p += 4 * r();
      const db = (10 * Math.log10(p) + 24) / 38;
      const l = (db <= 0 ? 0 : db >= 1 ? 255 : (db * 255) | 0) * 4;
      const o = off + y * stride;
      data[o] = LUT[l];
      data[o + 1] = LUT[l + 1];
      data[o + 2] = LUT[l + 2];
      data[o + 3] = 255;
    }
    v.pl = 0;
  }

  /* ----------------------------------------------------------------- panel */

  HD.panel('spectrum', (ctx) => {
    const { util: U, color: C, rgba } = ctx;
    const R = ctx.rng(HD.seed ^ 0x5bec7a1);
    const RM = ctx.reducedMotion;
    const FPS = RM ? 20 : 40;
    const S = ctx.state;

    const root = U.el('div', 'spec-root');
    root.innerHTML = `
      <div class="spec-top">
        <span class="spec-rec"><i></i>REC</span>
        <span class="spec-fq"><b class="spec-freq">437.225</b><span class="spec-u">MHz</span></span>
        <span class="spec-sep spec-mod-s">·</span><span class="spec-mod">NFM</span>
        <span class="spec-sep">·</span><span class="spec-dbm">−71 dBm</span>
        <span class="spec-sep">·</span><span class="spec-snr">SNR <b>14</b><span class="spec-snr-u"> dB</span></span>
        <span class="spec-tc">T+00:00:00</span>
      </div>
      <div class="spec-stage"><div class="spec-wf"></div></div>
      <div class="spec-vp">
        <span class="spec-vp-l"><span class="spec-long">VOICEPRINT</span><span class="spec-short">VPRINT</span></span>
        <span class="spec-vp-bar"><i class="spec-vp-fill"></i><i class="spec-vp-thr"></i></span>
        <b class="spec-vp-v">0.00</b>
        <span class="spec-vp-s">HUNTING</span>
      </div>
      <div class="spec-tx">
        <div class="spec-ln is-prev"><span class="spec-who"></span><span class="spec-run"></span></div>
        <div class="spec-ln is-cur"><span class="spec-who">S1▸</span><span class="spec-run"></span><i class="spec-caret"></i></div>
        <div class="spec-jamtx">▲ SIGNAL DEGRADED · BARRAGE JAMMING ON CHANNEL</div>
      </div>
      <span class="spec-measure" aria-hidden="true">0000000000</span>`;
    ctx.el.appendChild(root);
    const $ = (s) => root.querySelector(s);
    const stage = $('.spec-stage');
    const wfBox = $('.spec-wf');
    const freqEl = $('.spec-freq');
    const dbmEl = $('.spec-dbm');
    const snrEl = $('.spec-snr b');
    const tcEl = $('.spec-tc');
    const vpFill = $('.spec-vp-fill');
    const vpVal = $('.spec-vp-v');
    const vpStat = $('.spec-vp-s');
    const txBox = $('.spec-tx');
    const curLn = $('.spec-ln.is-cur');
    const prevLn = $('.spec-ln.is-prev');
    const curWho = curLn.querySelector('.spec-who');
    const curRun = curLn.querySelector('.spec-run');
    const prevWho = prevLn.querySelector('.spec-who');
    const prevRun = prevLn.querySelector('.spec-run');
    const measure = $('.spec-measure');

    const wf = ctx.canvas({ parent: wfBox, dprMax: 1, alpha: false, className: 'spec-wfc' });
    const ov = ctx.canvas({ parent: stage, className: 'spec-ov' });
    const stat = document.createElement('canvas');
    let colImg = null;
    // Chrome may drop 2D canvas backing stores under memory pressure; they come back blank with a
    // 'contextrestored' event, so the waterfall history and the static layer are rebuilt then.
    let lost = false;
    for (const c of [wf.canvas, ov.canvas, stat]) c.addEventListener('contextrestored', () => (lost = true));

    /* ------------------------------------------------------------- state */

    const voice = makeVoice(ctx.rng(HD.seed ^ 0x1dea5));
    let lay = 'sm';
    let wide = false;
    let G = { sw: 0, sh: 0, scW: 0, wx: 0, wW: 0, wH: 0, side: 0, gut: 0 };
    let simT = 0;
    let colN = 0;
    let started = 0;
    let freq = FREQS[0];
    let matched = false; // S1 is identified as the target until the next hop
    const vp = { state: 'hunt', v: 0.18, rate: 0.11, conf: 0, until: 0 };
    let nextHop = 0;
    let hopDue = 0; // forced evasion hop after a match
    let nextBurst = 0;
    let hopCount = 0;
    let hopLabel = null; // {text, t0, until}
    let stamp = null; // {t0, until, conf}
    let metaBack = 0;
    let lastUi = 0;
    let lastSec = -1;
    const markers = []; // {col, text, color} anchored to scrolled waterfall columns
    const GL = 5; // afterglow traces
    const MAXN = 420;
    const glow = Array.from({ length: GL }, () => new Float32Array(MAXN));
    const glowN = new Int32Array(GL);
    let gi = 0;
    const amps = new Float32Array(40);
    const phs = new Float32Array(40).map(() => R.range(0, TAU));

    /* ------------------------------------------------------- transcript */

    let cw = 6.6; // mono char width at 11px, measured at resize
    let cap = 40; // chars that fit on the current line
    let line = null; // {segs:[{text, red, start, el}], len, plain, spk}
    let shownCount = -1;
    let shownCap = -1;
    let lineUsed = new Set();

    const live = (v) => (v && v !== '—' ? v : null);
    // district labels read '8E · ÉLYSÉE'; people on the radio say the quarter's name
    const quarter = (d) => String(d).split('·').pop().trim();
    const fillVars = (s) =>
      s
        .replace('{street}', live(S.target.street) || R.pick(ctx.words.streets))
        .replace('{district}', quarter(live(S.target.district) || R.pick(ctx.words.districts)));

    function pickLine(spk) {
      const urgent = spk === 1 && (S.phase === 'critical' || S.phase === 'final');
      const pool = urgent ? LINES_URGENT : spk === 1 ? LINES_S1 : LINES_S2;
      let src = R.pick(pool);
      for (let i = 0; i < 4 && lineUsed.has(src); i++) src = R.pick(pool);
      lineUsed.add(src);
      if (lineUsed.size > 8) lineUsed = new Set([src]);
      return fillVars(src);
    }

    function whoLabel(spk) {
      return spk === 1 && matched ? (S.target.codename || 'WRAITH') + '▸' : `S${spk}▸`;
    }

    function startLine(spk) {
      // retire the finished line into the dim "previous" row (built once per phrase, not per frame)
      if (line) {
        for (const s of line.segs) s.el.textContent = s.text;
        prevRun.replaceChildren(...curRun.childNodes);
        prevWho.textContent = curWho.textContent;
        prevWho.classList.toggle('is-tgt', curWho.classList.contains('is-tgt'));
      }
      const text = '…' + pickLine(spk) + '…';
      const segs = [];
      let plain = '';
      for (const ch of text) {
        const red = ch === '#';
        const c = red ? '█' : ch;
        plain += c;
        const last = segs[segs.length - 1];
        if (last && last.red === red) last.text += c;
        else segs.push({ text: c, red, start: plain.length - 1, el: null });
      }
      curRun.replaceChildren();
      for (const s of segs) {
        s.el = U.el('span', s.red ? 'spec-rd' : '');
        curRun.appendChild(s.el);
      }
      line = { segs, len: plain.length, plain, spk };
      curWho.textContent = whoLabel(spk);
      curWho.classList.toggle('is-tgt', spk === 1 && matched);
      shownCount = -1;
      return line;
    }

    // Show the tail of the typed text so the newest words stay visible on a single line.
    function revealLine(count) {
      if (!line || (count === shownCount && cap === shownCap)) return;
      shownCount = count;
      shownCap = cap;
      const a = Math.max(0, count - cap);
      for (const s of line.segs) {
        const s0 = s.start;
        const from = Math.max(0, a - s0);
        const to = Math.max(0, Math.min(s.text.length, count - s0));
        let vis = from < to ? s.text.slice(from, to) : '';
        if (a > 0 && a >= s0 && a < s0 + s.text.length && !s.red && vis) vis = '…' + vis.slice(1);
        if (s.el.textContent !== vis) s.el.textContent = vis;
      }
    }

    voice.onStart = (v) => {
      // mostly the target talking; the contact answers now and then
      v.spk = v.spk === 2 ? 1 : R() < 0.62 ? 1 : 2;
      const l = startLine(v.spk);
      return U.clamp(l.len / (15 + 6 * v.urg), 1.5, 4.4);
    };
    voice.onEnd = () => {
      if (line) revealLine(line.len);
    };

    /* ------------------------------------------------------------ layout */

    function layout(w, h) {
      lay = h < 100 ? 'xs' : h < 168 ? 'sm' : 'md';
      wide = w >= 400;
      root.dataset.lay = lay;
      root.classList.toggle('is-wide', wide);
      ov.fit();
      const sw = ov.w;
      const sh = ov.h;
      const side = wide ? 88 : 0;
      const gut = lay === 'xs' ? 17 : 21;
      const scW = Math.round(U.clamp((sw - side) * 0.38, 60, 200));
      const wx = scW + gut;
      G = { sw, sh, side, gut, scW, wx, wW: Math.max(8, sw - side - wx), wH: sh };
      wfBox.style.cssText = `left:${G.wx}px;top:0;width:${G.wW}px;height:${G.wH}px`;
      wf.fit();
      const mw = measure.getBoundingClientRect().width;
      if (mw > 20) cw = mw / 10;
      const lw = curLn.clientWidth;
      cap = Math.max(8, Math.floor((lw - 10) / cw) - (curWho.textContent.length + 1));
      shownCap = -1;
      prefill();
      renderStatic();
    }

    // Fill the waterfall with a few seconds of plausible history so it is never blank.
    function prefill() {
      const W = wf.canvas.width;
      const H = wf.canvas.height;
      if (W < 2 || H < 2) return;
      const img = wf.ctx.createImageData(W, H);
      const pv = makeVoice(ctx.rng(HD.seed ^ 0x77e1));
      pv.t = 0.5;
      for (let x = 0; x < W; x++) {
        stepVoice(pv, 1 / 40);
        synthColumn(pv, H, img.data, x * 4, W * 4, x / 40);
      }
      wf.ctx.putImageData(img, 0, 0);
      colImg = wf.ctx.createImageData(1, H);
      markers.length = 0;
    }

    function bracket(g, x, y, w, h, l) {
      g.beginPath();
      g.moveTo(x, y + l); g.lineTo(x, y); g.lineTo(x + l, y);
      g.moveTo(x + w - l, y); g.lineTo(x + w, y); g.lineTo(x + w, y + l);
      g.moveTo(x + w, y + h - l); g.lineTo(x + w, y + h); g.lineTo(x + w - l, y + h);
      g.moveTo(x + l, y + h); g.lineTo(x, y + h); g.lineTo(x, y + h - l);
      g.stroke();
    }

    function renderStatic() {
      const d = ov.dpr;
      stat.width = ov.canvas.width;
      stat.height = ov.canvas.height;
      const g = stat.getContext('2d');
      g.setTransform(d, 0, 0, d, 0, 0);
      const { sw, sh, scW, wx, wW, wH, side } = G;
      if (sw < 20 || sh < 20) return;

      // scope well + graticule (square divisions)
      g.fillStyle = 'rgba(1, 10, 14, 0.72)';
      g.fillRect(0, 0, scW, sh);
      const ny = sh >= 70 ? 6 : 4;
      const div = sh / ny;
      const nx = Math.max(4, Math.round(scW / div));
      const dx = scW / nx;
      g.lineWidth = 1;
      g.strokeStyle = rgba('holo', 0.08);
      g.beginPath();
      for (let i = 1; i < nx; i++) {
        const x = Math.round(i * dx) + 0.5;
        g.moveTo(x, 0); g.lineTo(x, sh);
      }
      for (let j = 1; j < ny; j++) {
        const y = Math.round(j * div) + 0.5;
        g.moveTo(0, y); g.lineTo(scW, y);
      }
      g.stroke();
      // centre axes with fifth-division ticks
      const cy = Math.round(sh / 2) + 0.5;
      const cx = Math.round((Math.round(nx / 2) * dx)) + 0.5;
      g.strokeStyle = rgba('holo', 0.2);
      g.beginPath();
      g.moveTo(0, cy); g.lineTo(scW, cy);
      g.moveTo(cx, 0); g.lineTo(cx, sh);
      for (let x = 0; x < scW; x += dx / 5) {
        g.moveTo(Math.round(x) + 0.5, cy - 2); g.lineTo(Math.round(x) + 0.5, cy + 2);
      }
      for (let y = 0; y < sh; y += div / 5) {
        g.moveTo(cx - 2, Math.round(y) + 0.5); g.lineTo(cx + 2, Math.round(y) + 0.5);
      }
      g.stroke();
      g.strokeStyle = rgba('holo', 0.3);
      g.strokeRect(0.5, 0.5, scW - 1, sh - 1);
      g.strokeStyle = rgba('holo', 0.85);
      bracket(g, 0.5, 0.5, scW - 1, sh - 1, 5);

      g.textBaseline = 'alphabetic';
      if (sh >= 56 && scW >= 90) {
        g.font = UI(9);
        g.fillStyle = rgba('holo', 0.8);
        g.fillText('CH1 · AF', 5, 11);
        g.font = MONO(9);
        g.fillStyle = C.dim;
        g.fillText('5 ms/div', 5, sh - 4);
        g.textAlign = 'right';
        g.fillText('0.5 V', scW - 5, sh - 4);
        g.textAlign = 'left';
      }

      // frequency gutter
      g.font = MONO(9);
      g.fillStyle = C.dim;
      g.textAlign = 'right';
      g.strokeStyle = rgba('holo', 0.35);
      g.beginPath();
      const step = wH < 60 ? 2000 : 1000;
      for (let f = 0; f <= FMAX; f += 500) {
        const y = Math.round(wH * (1 - f / FMAX)) + 0.5;
        const major = f % step === 0;
        g.moveTo(wx - (major ? 5 : 2), Math.min(wH - 0.5, Math.max(0.5, y)));
        g.lineTo(wx, Math.min(wH - 0.5, Math.max(0.5, y)));
        if (major) g.fillText(f === 0 ? '0' : f / 1000 + 'k', wx - 6, U.clamp(y + 3, 8, wH - 1));
      }
      g.stroke();
      g.textAlign = 'left';
      // waterfall frame + 3.4 kHz channel edge
      g.strokeStyle = rgba('holo', 0.3);
      g.strokeRect(wx - 0.5, 0.5, wW + 1, wH - 1);
      g.strokeStyle = rgba('holo', 0.85);
      bracket(g, wx - 0.5, 0.5, wW + 1, wH - 1, 5);
      const ye = Math.round(wH * (1 - 3400 / FMAX)) + 0.5;
      g.setLineDash([2, 3]);
      g.strokeStyle = rgba('amber', 0.35);
      g.beginPath();
      g.moveTo(wx, ye); g.lineTo(wx + wW, ye);
      g.stroke();
      g.setLineDash([]);
      if (wW >= 120 && wH >= 50) {
        g.font = MONO(9);
        g.fillStyle = rgba('amber', 0.7);
        g.textAlign = 'right';
        g.fillText('BW 3.4k', wx + wW - 24, ye - 3);
        g.textAlign = 'left';
      }

      // formant / matcher stats column (wide layouts)
      if (side) {
        const x0 = sw - side + 8;
        g.strokeStyle = rgba('holo', 0.22);
        g.beginPath();
        g.moveTo(sw - side + 3.5, 0); g.lineTo(sw - side + 3.5, sh);
        g.stroke();
        g.font = UI(9);
        g.fillStyle = rgba('holo', 0.85);
        g.fillText('FORMANTS', x0, 10);
        g.font = MONO(9);
        g.fillStyle = C.dim;
        const rows = ['F0', 'F1', 'F2', 'F3', 'VAD', 'LPC', 'CAND'];
        const lh = Math.min(13, (sh - 16) / rows.length);
        rows.forEach((t, i) => g.fillText(t, x0, 24 + i * lh));
      }
    }

    /* ----------------------------------------------------------- effects */

    function hop(now, evasive) {
      let next = freq;
      while (next === freq) next = R.pick(FREQS);
      freq = next;
      hopCount++;
      matched = false;
      voice.glitch = 0.35;
      // retune: existing traces jump vertically relative to the new centre frequency
      const W = wf.canvas.width;
      const H = wf.canvas.height;
      if (W > 2 && H > 8) {
        const dy = R.int(4, 9) * R.sign();
        const g = wf.ctx;
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.drawImage(wf.canvas, 0, 0, W, H, 0, dy, W, H);
        g.fillStyle = 'rgba(2, 5, 10, 0.85)';
        g.fillRect(0, dy > 0 ? 0 : H + dy, W, Math.abs(dy));
      }
      markers.push({ col: colN, text: 'HOP ' + next, color: 'amber' });
      hopLabel = { text: `FREQ HOP → ${next}`, t0: now, until: now + 2000 };
      U.scramble(freqEl, next, { duration: RM ? 0 : 520, chars: '0123456789', r: R });
      ctx.meta(`${next} MHz`);
      if (evasive || hopCount % 2 === 1) ctx.alert('info', `FREQ HOP → ${next} MHz · ${evasive ? 'TARGET EVADING · ' : ''}RE-LOCKED`);
      ctx.audio.chirp(1800, 600, 120, 'square', 0.02);
    }

    function match(now) {
      const code = S.target.codename || 'WRAITH';
      vp.state = 'match';
      vp.conf = Math.round(R.range(0.89, 0.96) * 100) / 100;
      vp.until = now + 4200;
      matched = true;
      curWho.textContent = whoLabel(voice.spk);
      curWho.classList.toggle('is-tgt', voice.spk === 1);
      const phrase = line ? line.plain : '';
      ctx.emit('voice:match', { codename: code, confidence: vp.conf, phrase });
      ctx.alert('warn', `VOICEPRINT MATCH ${code} ${vp.conf.toFixed(2)}`);
      ctx.flash('warn', 1600);
      stamp = { t0: now, until: now + 3800, conf: vp.conf, code };
      markers.push({ col: colN, text: 'ID ' + code, color: 'threat' });
      ctx.meta(`ID ${code} ${vp.conf.toFixed(2)}`);
      metaBack = now + 4200;
      hopDue = now + 4600; // the target notices and jumps channel
      root.classList.add('is-match');
      ctx.audio.beep(1320, 90, 'square', 0.03);
    }

    ctx.on('intrusion', () => {
      voice.jam = 2.8;
      markers.push({ col: colN, text: 'ECM', color: 'neon' });
    });
    ctx.on('mission:phase', ({ phase }) => {
      voice.urg = { elevated: 0, severe: 0.3, critical: 0.7, final: 1, zero: 1 }[phase] || 0;
    });
    ctx.on('mission:reset', () => {
      // new cycle: the matcher starts cold and the target is anonymous again
      const now = performance.now();
      vp.state = 'hunt';
      vp.v = 0.18;
      vp.rate = R.range(0.095, 0.125);
      matched = false;
      stamp = null;
      hopLabel = null;
      hopDue = 0;
      metaBack = 0;
      voice.jam = 0;
      voice.urg = 0;
      nextHop = now + R.range(22000, 30000);
      root.classList.remove('is-match', 'is-hot', 'is-jam');
      curWho.textContent = whoLabel(voice.spk);
      curWho.classList.remove('is-tgt');
      lineUsed.clear();
      markers.push({ col: colN, text: 'NEW CYCLE', color: 'holo' });
      ctx.meta(`${freq} MHz`);
    });
    ctx.on('fonts:ready', () => layout(ctx.width, ctx.height));

    /* ------------------------------------------------------------ drawing */

    function scopeTrace(n, out) {
      const v = voice;
      const f0 = v.f0;
      const T = 0.02;
      const r = R;
      let K = 0;
      if (v.env > 0.02) {
        // only harmonics the trace can resolve at this width
        K = Math.max(3, Math.min(36, Math.floor(3600 / f0), Math.floor(n / (4 * f0 * T))));
        let norm = 0;
        for (let k = 1; k <= K; k++) {
          const fk = k * f0;
          const a = (gauss(fk, v.F[0], 140) + 0.6 * gauss(fk, v.F[1], 180) + 0.3 * gauss(fk, v.F[2], 220) + 0.06) / (1 + fk / 900);
          amps[k] = a;
          norm += a;
          phs[k] += r.gauss() * 0.05;
        }
        const g = (v.env * 1.7) / norm;
        for (let k = 1; k <= K; k++) amps[k] *= g;
      }
      const jam = v.jam > 0;
      for (let i = 0; i < n; i++) {
        const t = (i / (n - 1)) * T;
        let y = 0.08 * Math.sin(TAU * 88.5 * t + simT * 3) + 0.05 * (r() - 0.5);
        for (let k = 1; k <= K; k++) y += amps[k] * Math.sin(TAU * k * f0 * t + phs[k]);
        if (v.fr > 0.01) y += v.fr * 0.9 * (r() - 0.5);
        if (v.pl) y += 0.8 * (r() - 0.5);
        // AFSK drawn at a visual rate (true 1.2/2.2 kHz would alias at this width)
        if (v.burst > 0) y += 0.55 * (Math.sin((TAU * (v.tone / 200) * t) / T) > 0 ? 1 : -1);
        if (jam) y += 2.2 * (r() - 0.5);
        if (v.glitch > 0) y += (r() - 0.5) * 0.9;
        out[i] = Math.tanh(y * 1.15);
      }
    }

    function tracePath(g, buf, n, x0, w, cy, amp) {
      g.beginPath();
      for (let i = 0; i < n; i++) {
        const x = x0 + (i / (n - 1)) * w;
        const y = cy - buf[i] * amp;
        if (i) g.lineTo(x, y);
        else g.moveTo(x, y);
      }
    }

    function label(g, text, x, y, col, bg = true) {
      const w = g.measureText(text).width;
      if (bg) {
        g.fillStyle = 'rgba(2, 5, 10, 0.78)';
        g.fillRect(x - 2, y - 8, w + 4, 11);
      }
      g.fillStyle = col;
      g.fillText(text, x, y);
      return w;
    }

    function draw(now) {
      const g = ov.ctx;
      const { sw, sh, scW, wx, wW, wH, side } = G;
      ov.clear();
      if (sw < 20 || sh < 20) return;
      g.drawImage(stat, 0, 0, sw, sh);

      // oscilloscope: afterglow ghosts, then a soft glow pass and the bright ice trace
      const n = Math.max(24, Math.min(MAXN, Math.floor(scW - 6)));
      gi = (gi + 1) % GL;
      scopeTrace(n, glow[gi]);
      glowN[gi] = n;
      const cy = sh / 2;
      const amp = sh * 0.4;
      g.save();
      g.beginPath();
      g.rect(1, 1, scW - 2, sh - 2);
      g.clip();
      g.lineJoin = 'round';
      g.lineWidth = 1;
      for (let j = GL - 1; j >= 1; j--) {
        const b = (gi - j + GL) % GL;
        if (!glowN[b]) continue;
        g.strokeStyle = rgba('holo', 0.34 - j * 0.065);
        tracePath(g, glow[b], glowN[b], 3, scW - 6, cy, amp);
        g.stroke();
      }
      tracePath(g, glow[gi], n, 3, scW - 6, cy, amp);
      g.strokeStyle = rgba('holo', 0.22);
      g.lineWidth = 3.2;
      g.stroke();
      g.strokeStyle = voice.jam > 0 ? C.neon : C.ice;
      g.lineWidth = 1.15;
      g.stroke();
      g.restore();
      // trigger marker + voice activity lamp
      g.fillStyle = rgba('amber', 0.85);
      g.beginPath();
      g.moveTo(scW - 1, cy); g.lineTo(scW - 5, cy - 3); g.lineTo(scW - 5, cy + 3);
      g.fill();
      const vad = voice.talking && voice.env > 0.05;
      if (sh >= 56 && scW >= 90) {
        g.font = UI(9);
        g.fillStyle = vad ? C.phosphor : C.faint;
        g.fillRect(scW - 30, 5, 5, 5);
        g.fillText('VAD', scW - 22, 11);
      } else {
        g.fillStyle = vad ? C.phosphor : C.faint;
        g.fillRect(scW - 8, 4, 4, 4);
      }

      // waterfall overlays: scrolled event markers, live formant ticks, labels
      g.font = MONO(9);
      const right = wx + wW - 1;
      for (let i = markers.length - 1; i >= 0; i--) {
        const m = markers[i];
        const x = right - (colN - m.col) + 0.5;
        if (x < wx - 60) {
          markers.splice(i, 1);
          continue;
        }
        if (x < wx) continue;
        g.strokeStyle = rgba(m.color, 0.7);
        g.setLineDash([2, 2]);
        g.beginPath();
        g.moveTo(x, 1); g.lineTo(x, wH - 1);
        g.stroke();
        g.setLineDash([]);
        if (wH >= 40) {
          const tw = g.measureText(m.text).width;
          const lx = Math.min(x + 3, right - tw - 26);
          if (lx > wx + 2) label(g, m.text, lx, wH - 4, rgba(m.color, 0.95));
        }
      }
      if (voice.env > 0.08 && voice.jam <= 0 && wW > 30) {
        let ly = Infinity; // F1 is lowest; skip a label that would sit on the one below it
        for (let k = 0; k < 3; k++) {
          const y = wH * (1 - voice.F[k] / FMAX);
          g.fillStyle = C.ice;
          g.fillRect(right - 5, Math.round(y), 5, 1);
          if (wH >= 70 && wW >= 110 && ly - y >= 10) {
            ly = y;
            label(g, 'F' + (k + 1), right - 20, U.clamp(y + 3, 9, wH - 2), rgba('ice', 0.85));
          }
        }
      }
      if (wH >= 40 && wW >= 90) {
        g.fillStyle = rgba('holo', 0.75);
        g.font = UI(9);
        label(g, 'SPECTROGRAM', wx + 4, 11, rgba('holo', 0.8));
      }

      // hop banner
      if (hopLabel && now < hopLabel.until) {
        const k = U.clamp((now - hopLabel.t0) / 180, 0, 1);
        g.font = MONO(wW >= 150 ? 10 : 9);
        const tw = g.measureText(hopLabel.text).width;
        const x = wx + Math.max(3, (wW - tw) / 2);
        const y = Math.round(wH * 0.42);
        const jit = !RM && now - hopLabel.t0 < 380 ? R.int(-3, 3) : 0;
        g.globalAlpha = k;
        g.fillStyle = 'rgba(20, 12, 0, 0.82)';
        g.fillRect(x - 5 + jit, y - 10, tw + 10, 14);
        g.strokeStyle = rgba('amber', 0.8);
        g.strokeRect(x - 5.5 + jit, y - 10.5, tw + 11, 15);
        g.fillStyle = C.amber;
        g.fillText(hopLabel.text, x + jit, y);
        g.globalAlpha = 1;
      } else hopLabel = null;

      // jamming stamp
      if (voice.jam > 0) {
        const on = RM || Math.floor(now / 160) % 2 === 0;
        g.font = DISP(wH >= 60 ? 12 : 10);
        const t = 'JAMMING';
        const tw = g.measureText(t).width;
        const x = wx + (wW - tw) / 2;
        const y = wH / 2 + 5;
        g.fillStyle = 'rgba(30, 0, 12, 0.72)';
        g.fillRect(x - 8, y - 14, tw + 16, 19);
        g.strokeStyle = on ? C.neon : rgba('neon', 0.4);
        g.strokeRect(x - 8.5, y - 14.5, tw + 17, 20);
        g.fillStyle = on ? C.neon : rgba('neon', 0.55);
        g.fillText(t, x, y);
        if (sh >= 50) {
          // over the scope's scale labels, on its own plate
          g.font = MONO(9);
          const t2 = 'ECM · WIDEBAND';
          const w2 = g.measureText(t2).width;
          g.fillStyle = 'rgba(30, 0, 12, 0.9)';
          g.fillRect(2, sh - 15, scW - 4, 13);
          g.fillStyle = C.neon;
          g.fillText(t2, (scW - w2) / 2, sh - 5);
        }
      }

      // voiceprint match stamp over the waterfall
      if (stamp && now < stamp.until) {
        const age = now - stamp.t0;
        const blink = !RM && age < 900 && Math.floor(age / 110) % 2 === 1;
        const big = wW >= 150 && wH >= 60;
        const t1 = 'VOICEPRINT MATCH';
        const t2 = `${stamp.code} · ${stamp.conf.toFixed(2)}`;
        g.font = DISP(big ? 11 : 9);
        const w2 = g.measureText(t2).width;
        g.font = UI(9);
        const w1 = g.measureText(t1).width;
        const bw = Math.min(wW - 8, Math.max(w1, w2) + 16);
        const bh = big ? 34 : wH >= 44 ? 28 : 18;
        const bx = wx + (wW - bw) / 2;
        const by = (wH - bh) / 2;
        g.fillStyle = 'rgba(28, 0, 6, 0.84)';
        g.fillRect(bx, by, bw, bh);
        g.strokeStyle = blink ? C.ice : C.threat;
        g.lineWidth = 1;
        g.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
        g.lineWidth = 2;
        bracket(g, bx - 1, by - 1, bw + 2, bh + 2, 5);
        g.lineWidth = 1;
        if (bh >= 28) {
          g.fillStyle = rgba('threat', 0.9);
          g.fillText(t1, bx + (bw - w1) / 2, by + 11);
          g.font = DISP(big ? 11 : 9);
          g.fillStyle = blink ? C.ice : C.threat;
          g.fillText(t2, bx + (bw - w2) / 2, by + bh - 7);
        } else {
          g.font = DISP(9);
          g.fillStyle = C.threat;
          g.fillText(t2, bx + (bw - w2) / 2, by + 13);
        }
      } else if (stamp) {
        stamp = null;
      }

      // stats column
      if (side) {
        const x1 = sw - 6;
        const rows = [
          vad ? Math.round(voice.f0) + ' Hz' : '— Hz',
          vad ? String(Math.round(voice.F[0])) : '—',
          vad ? String(Math.round(voice.F[1])) : '—',
          vad ? String(Math.round(voice.F[2])) : '—',
          vad ? 'ON' : 'OFF',
          '12·AR',
          U.pad(Math.max(1, Math.round(4096 * Math.pow(1 - U.clamp(vp.v, 0, 0.999), 3.2))), 4),
        ];
        const lh = Math.min(13, (sh - 16) / rows.length);
        g.font = MONO(9);
        g.textAlign = 'right';
        rows.forEach((t, i) => {
          g.fillStyle = i === 4 ? (vad ? C.phosphor : C.dim) : i === 6 && vp.state === 'match' ? C.threat : C.ice;
          g.fillText(t, x1, 24 + i * lh);
        });
        g.textAlign = 'left';
      }
    }

    /* ------------------------------------------------------------ the loop */

    function pushColumn() {
      const W = wf.canvas.width;
      const H = wf.canvas.height;
      if (W < 4 || H < 4 || !colImg) return;
      const g = wf.ctx;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(wf.canvas, 1, 0, W - 1, H, 0, 0, W - 1, H);
      synthColumn(voice, H, colImg.data, 0, 4, simT);
      g.putImageData(colImg, W - 1, 0);
      colN++;
      if (colN % FPS === 0) {
        g.fillStyle = rgba('holo', 0.55);
        g.fillRect(W - 1, H - 3, 1, 3);
      }
    }

    function director(now, dt) {
      if (!started) {
        started = now;
        nextHop = now + R.range(26000, 34000);
        nextBurst = now + R.range(5000, 9000);
        ctx.meta(`${freq} MHz`);
      }
      // voiceprint matcher
      if (vp.state === 'hunt') {
        if (voice.jam > 0) vp.v -= dt * 0.02;
        else if (voice.talking && voice.spk === 1 && voice.env > 0.1) vp.v += dt * vp.rate * (1 + 0.5 * voice.urg) * (0.5 + R());
        else if (voice.talking && voice.spk === 2) vp.v -= dt * 0.01;
        else vp.v -= dt * 0.003;
        vp.v = U.clamp(vp.v, 0.05, 0.99);
        if (vp.v >= THRESH) match(now);
      } else if (vp.state === 'match') {
        vp.v = U.damp(vp.v, vp.conf, 4, dt);
        if (now > vp.until) {
          vp.state = 'decay';
          root.classList.remove('is-match');
        }
      } else {
        vp.v = U.damp(vp.v, 0.14, 1.1, dt);
        if (vp.v < 0.22) {
          vp.state = 'hunt';
          vp.rate = R.range(0.095, 0.125);
        }
      }
      if (hopDue && now > hopDue) {
        hopDue = 0;
        hop(now, true);
        nextHop = now + R.range(24000, 34000);
      } else if (now > nextHop) {
        if (vp.state === 'hunt' && vp.v < 0.7 && voice.jam <= 0) hop(now, false);
        nextHop = now + R.range(22000, 32000);
      }
      if (now > nextBurst) {
        if (!voice.talking && voice.jam <= 0) {
          voice.burst = R.range(0.35, 0.6);
          markers.push({ col: colN, text: 'AFSK', color: 'neon' });
          nextBurst = now + R.range(9000, 16000);
        } else nextBurst = now + 700;
      }
      if (metaBack && now > metaBack) {
        metaBack = 0;
        ctx.meta(`${freq} MHz`);
      }
      // transcript typing follows the phrase clock
      if (line && voice.talking) revealLine(Math.floor(line.len * U.clamp((voice.t / voice.dur) * 1.08, 0, 1)));
    }

    function updateUi(now) {
      const jam = voice.jam > 0;
      root.classList.toggle('is-jam', jam);
      const talk = voice.talking && voice.env > 0.05;
      const dbm = jam ? -38 - R.int(0, 5) : -71 + (talk ? 2 : 0) + R.int(-2, 2);
      const snr = jam ? -R.int(2, 5) : (talk ? 14 : 12) + R.int(-1, 1);
      dbmEl.textContent = `${dbm < 0 ? '−' : ''}${Math.abs(dbm)} dBm`;
      snrEl.textContent = `${snr < 0 ? '−' : ''}${Math.abs(snr)}`;
      const sec = Math.floor((now - started) / 1000) + 197;
      if (sec !== lastSec) {
        lastSec = sec;
        tcEl.textContent = `T+${U.pad(Math.floor(sec / 3600))}:${U.pad(Math.floor(sec / 60) % 60)}:${U.pad(sec % 60)}`;
      }
      const st =
        vp.state === 'match' ? `MATCH ${S.target.codename || 'WRAITH'}` :
        vp.state === 'decay' ? 'LOST · RE-ACQ' :
        jam ? 'NO SIGNAL' :
        vp.v > 0.62 ? 'CORRELATING' : 'HUNTING';
      if (vpStat.textContent !== st) vpStat.textContent = st;
    }

    return {
      fps: FPS,
      resize(w, h) {
        layout(w, h);
      },
      tick(now, dt) {
        if (lost) {
          lost = false;
          layout(ctx.width, ctx.height);
        }
        simT += dt;
        stepVoice(voice, dt);
        director(now, dt);
        pushColumn();
        draw(now);
        const shown = vp.state === 'hunt' && !RM ? vp.v + (R() - 0.5) * 0.012 : vp.v;
        vpFill.style.clipPath = `inset(0 ${((1 - U.clamp(shown, 0, 1)) * 100).toFixed(1)}% 0 0)`;
        if (now - lastUi > 180) {
          lastUi = now;
          vpVal.textContent = U.clamp(shown, 0, 0.99).toFixed(2);
          root.classList.toggle('is-hot', vp.v > 0.62 && vp.state === 'hunt');
          updateUi(now);
        }
      },
    };
  });
})();
