/* FEDLIGHT · core runtime
   Namespace, event bus, mission clock, frame loop, panel registry and shared helpers.
   Panels register with HD.panel(id, factory) — see CONTRACT.md for the full API. */
(() => {
  'use strict';

  const HD = (window.HD = window.HD || {});
  const params = new URLSearchParams(location.search);
  HD.params = params;
  HD.solo = params.get('solo') || null;
  HD.reducedMotion =
    params.has('still') || !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ------------------------------------------------------------------ errors */

  HD.errors = [];
  const logErr = (msg) => {
    msg = String(msg);
    HD.errors.push(msg);
    console.error('[HD] ' + msg);
    const pre = document.getElementById('hd-errlog');
    if (pre) pre.textContent += msg + '\n';
  };
  HD.logErr = logErr;
  addEventListener('error', (e) =>
    logErr(`${e.message || 'error'} @ ${(e.filename || '').split('/').pop()}:${e.lineno || 0}:${e.colno || 0}`)
  );
  addEventListener('unhandledrejection', (e) =>
    logErr('unhandled rejection: ' + ((e.reason && (e.reason.stack || e.reason.message)) || e.reason))
  );

  /* ----------------------------------------------------------------- palette */

  // Mirrors the tokens in base.css so canvas code draws from the same set.
  HD.color = {
    bg: '#02050a',
    bg2: '#061019',
    holo: '#5ff3ff',
    holo2: '#2bb6d6',
    ice: '#dff8ff',
    text: '#a9dce8',
    dim: '#5d8793',
    faint: '#2d4d57',
    neon: '#ff2a6d',
    amber: '#ffb627',
    threat: '#ff2340',
    phosphor: '#3dff7f',
    phosphorDim: '#1a7a3c',
  };
  const rgbCache = new Map();
  HD.rgba = (c, a = 1) => {
    const hex = HD.color[c] || c;
    let rgb = rgbCache.get(hex);
    if (!rgb) {
      let h = hex.replace('#', '');
      if (h.length === 3) h = h.replace(/./g, '$&$&');
      const n = parseInt(h, 16);
      rgb = `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
      rgbCache.set(hex, rgb);
    }
    return `rgba(${rgb},${a})`;
  };

  /* --------------------------------------------------------------------- rng */

  HD.rng = (seed = (Math.random() * 4294967296) >>> 0) => {
    let s = seed >>> 0;
    const r = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    r.range = (a, b) => a + (b - a) * r();
    r.int = (a, b) => Math.floor(a + (b - a + 1) * r()); // inclusive
    r.pick = (arr) => arr[Math.floor(r() * arr.length)];
    r.chance = (p) => r() < p;
    r.sign = () => (r() < 0.5 ? -1 : 1);
    r.gauss = () => (r() + r() + r() + r() - 2) / 2; // ~N(0, 0.58), bounded to ±1
    r.shuffle = (arr) => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };
    return r;
  };
  const seedParam = parseInt(params.get('seed'), 10);
  HD.seed = Number.isFinite(seedParam) ? seedParam >>> 0 : (Math.random() * 4294967296) >>> 0;
  HD.rand = HD.rng(HD.seed);

  /* ------------------------------------------------------------------- utils */

  const U = (HD.util = {});
  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.damp = (a, b, lambda, dt) => U.lerp(a, b, 1 - Math.exp(-lambda * dt));
  U.map = (v, a, b, c, d) => c + ((v - a) * (d - c)) / (b - a);
  U.ease = {
    linear: (t) => t,
    inQuad: (t) => t * t,
    outQuad: (t) => 1 - (1 - t) * (1 - t),
    outCubic: (t) => 1 - Math.pow(1 - t, 3),
    inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
    outBack: (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2),
  };
  U.pad = (n, len = 2, ch = '0') => String(n).padStart(len, ch);
  U.hex = (n, len = 2) => (n >>> 0).toString(16).toUpperCase().padStart(len, '0');
  U.randHex = (len, r = HD.rand) => {
    let s = '';
    for (let i = 0; i < len; i++) s += '0123456789ABCDEF'[(r() * 16) | 0];
    return s;
  };
  U.ip = (r = HD.rand) => `${r.int(11, 223)}.${r.int(0, 255)}.${r.int(0, 255)}.${r.int(1, 254)}`;
  // every MAC on our side of the wire carries the FE:D0 prefix, a quiet nod to Fed
  U.mac = (r = HD.rand) => ['FE', 'D0'].concat(Array.from({ length: 4 }, () => U.randHex(2, r))).join(':');
  U.fmtClock = (d = new Date(), offsetHours = 0) => {
    const t = new Date(d.getTime() + offsetHours * 3600000);
    return `${U.pad(t.getUTCHours())}:${U.pad(t.getUTCMinutes())}:${U.pad(t.getUTCSeconds())}`;
  };
  U.fmtDuration = (ms) => {
    const total = Math.max(0, Math.floor(ms / 10));
    const cs = total % 100;
    const s = Math.floor(total / 100) % 60;
    const m = Math.floor(total / 6000) % 60;
    const h = Math.floor(total / 360000);
    const o = { h: U.pad(h), m: U.pad(m), s: U.pad(s), cs: U.pad(cs) };
    o.text = `${o.h}:${o.m}:${o.s}.${o.cs}`;
    return o;
  };
  U.el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  U.CHARS = {
    hex: '0123456789ABCDEF',
    alnum: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    kata: 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン',
    glyph: '#%&@$*+=<>/\\|{}[]░▒▓█',
  };
  // Decode-style text reveal. Calling again on the same element cancels the previous run.
  U.scramble = (el, text, { duration = 700, chars = U.CHARS.alnum, r = HD.rand } = {}) =>
    new Promise((resolve) => {
      const token = {};
      el.__scramble = token;
      text = String(text);
      if (HD.reducedMotion || duration <= 0) {
        el.textContent = text;
        return resolve();
      }
      const start = performance.now();
      const step = (now) => {
        if (el.__scramble !== token) return resolve();
        const p = Math.min(1, (now - start) / duration);
        const lock = Math.floor(p * text.length);
        let out = text.slice(0, lock);
        for (let i = lock; i < text.length; i++) out += text[i] === ' ' ? ' ' : chars[(r() * chars.length) | 0];
        el.textContent = out;
        if (p < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });

  /* ------------------------------------------------------------------- words */

  HD.words = {
    city: 'PARIS',
    // arrondissements as they read on the HUD; the map panel reports the live one from OSM data
    districts: [
      '1ER · LOUVRE', '2E · BOURSE', '3E · TEMPLE', '4E · HÔTEL-DE-VILLE', '5E · PANTHÉON',
      '6E · LUXEMBOURG', '7E · PALAIS-BOURBON', '8E · ÉLYSÉE', '9E · OPÉRA', '10E · ENTREPÔT',
      '11E · POPINCOURT', '12E · REUILLY', '13E · GOBELINS', '14E · OBSERVATOIRE', '15E · VAUGIRARD',
      '16E · PASSY', '17E · BATIGNOLLES', '18E · MONTMARTRE', '19E · BUTTES-CHAUMONT', '20E · MÉNILMONTANT',
    ],
    streets: [
      'RUE DE RIVOLI', 'BOULEVARD HAUSSMANN', 'AVENUE DES CHAMPS-ÉLYSÉES', 'BOULEVARD SAINT-GERMAIN',
      'BOULEVARD DE SÉBASTOPOL', 'RUE LA FAYETTE', "AVENUE DE L'OPÉRA", 'QUAI DES GRANDS AUGUSTINS',
      'BOULEVARD VOLTAIRE', 'RUE DE LA ROQUETTE', 'AVENUE MONTAIGNE', 'RUE SAINT-HONORÉ',
      'BOULEVARD SAINT-MICHEL', 'RUE DU FAUBOURG SAINT-ANTOINE', "QUAI D'ORSAY", 'AVENUE FOCH',
      'BOULEVARD PÉRIPHÉRIQUE', 'RUE DE VAUGIRARD', 'AVENUE DE CLICHY', 'RUE OBERKAMPF',
      'BOULEVARD DE MAGENTA', 'RUE DE BELLEVILLE', "AVENUE D'ITALIE", 'QUAI DE BERCY',
    ],
    cities: [
      { name: 'REYKJAVIK', cc: 'IS', lat: 64.15, lon: -21.94 },
      { name: 'TALLINN', cc: 'EE', lat: 59.44, lon: 24.75 },
      { name: 'BUCHAREST', cc: 'RO', lat: 44.43, lon: 26.1 },
      { name: 'ZURICH', cc: 'CH', lat: 47.38, lon: 8.54 },
      { name: 'CASABLANCA', cc: 'MA', lat: 33.57, lon: -7.59 },
      { name: 'LAGOS', cc: 'NG', lat: 6.52, lon: 3.38 },
      { name: 'NAIROBI', cc: 'KE', lat: -1.29, lon: 36.82 },
      { name: 'KARACHI', cc: 'PK', lat: 24.86, lon: 67.0 },
      { name: 'ULAANBAATAR', cc: 'MN', lat: 47.89, lon: 106.91 },
      { name: 'SINGAPORE', cc: 'SG', lat: 1.35, lon: 103.82 },
      { name: 'JAKARTA', cc: 'ID', lat: -6.21, lon: 106.85 },
      { name: 'MACAU', cc: 'MO', lat: 22.2, lon: 113.54 },
      { name: 'SEOUL', cc: 'KR', lat: 37.57, lon: 126.98 },
      { name: 'VLADIVOSTOK', cc: 'RU', lat: 43.12, lon: 131.89 },
      { name: 'PERTH', cc: 'AU', lat: -31.95, lon: 115.86 },
      { name: 'HONOLULU', cc: 'US', lat: 21.31, lon: -157.86 },
      { name: 'ANCHORAGE', cc: 'US', lat: 61.22, lon: -149.9 },
      { name: 'LIMA', cc: 'PE', lat: -12.05, lon: -77.04 },
      { name: 'BUENOS AIRES', cc: 'AR', lat: -34.6, lon: -58.38 },
      { name: 'SAO PAULO', cc: 'BR', lat: -23.55, lon: -46.63 },
      { name: 'MONTEVIDEO', cc: 'UY', lat: -34.9, lon: -56.16 },
    ],
    handles: ['WRAITH', '0xFEDLIGHT', 'NULLKATANA', 'GH0STWIRE', 'SABLE', 'M1RR0R', 'CINDERELLA_ROOT', 'PALE_HORSE'],
    units: ['UNIT FEDORA', 'K-9 KONA', 'UNIT KESTREL', 'UNIT MANTIS', 'UNIT HALBERD'],
  };

  /* ------------------------------------------------------------------- state */

  const sr = HD.rng(HD.seed ^ 0x9e3779b9);
  // French SIV plate, AB-123-CD (I, O and U are never issued)
  const L = 'ABCDEFGHJKLMNPQRSTVWXYZ';
  const pl = () => L[sr.int(0, L.length - 1)];
  const plate = `${pl()}${pl()}-${U.pad(sr.int(1, 999), 3)}-${pl()}${pl()}`;

  // Paris wall clock offset from UTC (CET/CEST), resolved once from the browser's tz database
  HD.tz = { label: 'PARIS', offset: 2 };
  try {
    const d = new Date();
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
    const hh = +parts.find((p) => p.type === 'hour').value;
    const mm = +parts.find((p) => p.type === 'minute').value;
    let off = hh * 60 + mm - (d.getUTCHours() * 60 + d.getUTCMinutes());
    if (off > 720) off -= 1440;
    if (off < -720) off += 1440;
    HD.tz.offset = off / 60;
  } catch (err) {
    /* keep the CEST default */
  }
  HD.state = {
    op: 'FEDLIGHT',
    agency: 'NULLSEC',
    city: HD.words.city,
    phase: 'elevated',
    target: {
      codename: 'WRAITH',
      realName: '[REDACTED]',
      aliases: ['SABLE', 'M1RR0R', 'NULLKATANA'],
      vehicle: 'KAIZEN MORRIGAN GT',
      vehicleColor: 'MATTE BLACK',
      plate, // canonical plate; the enhance panel "reveals" it
      plateRevealed: false,
      street: '—',
      district: '—',
      speed: 0,
      heading: 0,
      x: 0.5,
      y: 0.5,
      faceSeed: sr.int(1, 1e9),
    },
  };

  /* --------------------------------------------------------------------- bus */

  const listeners = new Map();
  HD.bus = {
    on(evt, fn) {
      if (!listeners.has(evt)) listeners.set(evt, new Set());
      listeners.get(evt).add(fn);
      return () => HD.bus.off(evt, fn);
    },
    once(evt, fn) {
      const off = HD.bus.on(evt, (d) => {
        off();
        fn(d);
      });
      return off;
    },
    off(evt, fn) {
      const set = listeners.get(evt);
      if (set) set.delete(fn);
    },
    emit(evt, data) {
      for (const key of [evt, '*']) {
        const set = listeners.get(key);
        if (!set) continue;
        for (const fn of [...set]) {
          try {
            key === '*' ? fn(evt, data) : fn(data);
          } catch (err) {
            logErr(`bus "${evt}": ${(err && err.stack) || err}`);
          }
        }
      }
    },
  };

  /* ----------------------------------------------------------------- mission */

  const DEFAULT_SECONDS = 240;
  const ZERO_HOLD_MS = 7000;
  const tParam = parseFloat(params.get('t'));
  const defaultTotal = (Number.isFinite(tParam) && tParam > 0 ? tParam : DEFAULT_SECONDS) * 1000;
  const phaseFor = (rem) =>
    rem <= 0 ? 'zero' : rem <= 10000 ? 'final' : rem <= 60000 ? 'critical' : rem <= 120000 ? 'severe' : 'elevated';

  const M = (HD.mission = {
    total: defaultTotal,
    deadline: performance.now() + defaultTotal,
    cycle: 1,
    phase: null,
    zeroAt: 0,
    remaining() {
      return Math.max(0, this.deadline - performance.now());
    },
    progress() {
      return U.clamp(1 - this.remaining() / this.total, 0, 1);
    },
    reset(ms) {
      this.total = ms || defaultTotal;
      this.deadline = performance.now() + this.total;
      this.cycle++;
      this.zeroAt = 0;
      HD.bus.emit('mission:reset', { total: this.total, cycle: this.cycle });
      updateMission(performance.now());
    },
    add(ms) {
      if (this.zeroAt) return;
      this.deadline += ms;
      const rem = this.remaining();
      if (rem > this.total) this.total = rem;
      HD.bus.emit('mission:adjust', { deltaMs: ms, remaining: rem });
      updateMission(performance.now());
    },
  });

  function updateMission(now) {
    const rem = M.remaining();
    const phase = phaseFor(rem);
    if (phase !== M.phase) {
      M.phase = phase;
      HD.state.phase = phase;
      document.documentElement.dataset.phase = phase;
      HD.bus.emit('mission:phase', { phase, remaining: rem });
    }
    if (phase === 'zero' && !M.zeroAt) {
      M.zeroAt = now;
      HD.bus.emit('mission:zero', { cycle: M.cycle });
    }
    if (M.zeroAt && now - M.zeroAt > ZERO_HOLD_MS) M.reset();
  }

  /* ------------------------------------------------------------------- audio */

  HD.audio = {
    enabled: false,
    ctx: null,
    master: null,
    enable(on) {
      this.enabled = !!on;
      if (this.enabled && !this.ctx) {
        try {
          this.ctx = new (window.AudioContext || window.webkitAudioContext)();
          this.master = this.ctx.createGain();
          this.master.gain.value = 0.5;
          this.master.connect(this.ctx.destination);
        } catch (err) {
          this.enabled = false;
        }
      }
      if (this.ctx && this.enabled && this.ctx.state === 'suspended') this.ctx.resume();
      HD.bus.emit('audio:toggle', { enabled: this.enabled });
    },
    _voice(type, gain, ms) {
      if (!this.enabled || !this.ctx) return null;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type;
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
      osc.connect(g).connect(this.master);
      osc.start(t);
      osc.stop(t + ms / 1000 + 0.03);
      return { osc, t };
    },
    beep(freq = 880, ms = 70, type = 'square', gain = 0.03) {
      const v = this._voice(type, gain, ms);
      if (v) v.osc.frequency.setValueAtTime(freq, v.t);
    },
    chirp(f1 = 400, f2 = 1600, ms = 180, type = 'sawtooth', gain = 0.025) {
      const v = this._voice(type, gain, ms);
      if (!v) return;
      v.osc.frequency.setValueAtTime(f1, v.t);
      v.osc.frequency.exponentialRampToValueAtTime(Math.max(1, f2), v.t + ms / 1000);
    },
  };

  /* ------------------------------------------------------------------ canvas */

  // A DPR-aware canvas that absolutely fills `parent` (which must be positioned and sized).
  // Draw in CSS pixels: the transform is pre-scaled. fit() returns true when the size changed.
  HD.makeCanvas = (parent, { dprMax = 2, className = '', alpha = true } = {}) => {
    const canvas = document.createElement('canvas');
    canvas.className = ('hd-canvas ' + className).trim();
    parent.appendChild(canvas);
    const ctx = canvas.getContext('2d', { alpha });
    const c = {
      canvas,
      ctx,
      w: 0,
      h: 0,
      dpr: 1,
      fit() {
        const w = Math.max(1, Math.round(parent.clientWidth));
        const h = Math.max(1, Math.round(parent.clientHeight));
        const dpr = Math.min(dprMax, window.devicePixelRatio || 1);
        if (w === c.w && h === c.h && dpr === c.dpr) return false;
        c.w = w;
        c.h = h;
        c.dpr = dpr;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        return true;
      },
      clear() {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.setTransform(c.dpr, 0, 0, c.dpr, 0, 0);
      },
    };
    c.fit();
    return c;
  };

  /* ------------------------------------------------------------ frame loop */

  const mounted = [];
  const frameHooks = new Set();
  let lastNow = 0;
  HD.now = performance.now();

  // Per-frame callback for non-panel chrome (shell). Returns an unsubscribe function.
  HD.onFrame = (fn) => {
    frameHooks.add(fn);
    return () => frameHooks.delete(fn);
  };

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 1 / 60;
    lastNow = now;
    HD.now = now;
    updateMission(now);
    for (const fn of frameHooks) {
      try {
        fn(now, dt);
      } catch (err) {
        logErr(`frame hook: ${(err && err.stack) || err}`);
        frameHooks.delete(fn);
      }
    }
    for (const p of mounted) {
      if (p.dead || !p.visible || !p.inst.tick) continue;
      if (p.interval && now - p.lastTick < p.interval - 1) continue;
      const pdt = p.lastTick ? Math.min(0.25, (now - p.lastTick) / 1000) : dt;
      p.lastTick = now;
      try {
        p.inst.tick(now, pdt);
      } catch (err) {
        panelError(p, err, 'tick');
      }
    }
  }

  function panelError(p, err, where) {
    p.errors++;
    logErr(`[${p.id}] ${where}: ${(err && err.stack) || err}`);
    if (p.errors >= 8 && !p.dead) {
      p.dead = true;
      p.frame.classList.add('is-dead');
      const tag = U.el('div', 'panel-dead', `SIGNAL LOST · ${p.code || p.id}`);
      p.body.appendChild(tag);
    }
  }

  /* -------------------------------------------------------- panel registry */

  const registry = new Map();
  const byBody = new Map();
  let booted = false;
  let ro = null;
  let io = null;

  HD.panel = (id, factory) => {
    if (registry.has(id)) logErr(`duplicate panel registration: ${id}`);
    registry.set(id, factory);
    if (booted) {
      const el = document.querySelector(`[data-panel="${id}"]`);
      if (el) mountPanel(el);
    }
  };

  function measure(p) {
    const w = Math.round(p.body.clientWidth);
    const h = Math.round(p.body.clientHeight);
    if (w === p.w && h === p.h) return;
    p.w = w;
    p.h = h;
    for (const c of p.canvases) c.fit();
    if (p.inst.resize) {
      try {
        p.inst.resize(w, h);
      } catch (err) {
        panelError(p, err, 'resize');
      }
    }
  }

  function makeCtx(p) {
    const metaEl = p.frame.querySelector('[data-meta]');
    return {
      id: p.id,
      code: p.code,
      frame: p.frame,
      el: p.body,
      bus: HD.bus,
      state: HD.state,
      mission: HD.mission,
      color: HD.color,
      rgba: HD.rgba,
      util: HD.util,
      words: HD.words,
      rng: HD.rng,
      rand: HD.rand,
      audio: HD.audio,
      reducedMotion: HD.reducedMotion,
      get width() {
        return p.w;
      },
      get height() {
        return p.h;
      },
      meta(text) {
        if (metaEl) metaEl.textContent = text;
      },
      flash(level = 'alert', ms = 1400) {
        p.frame.dataset.flash = level;
        clearTimeout(p.flashTimer);
        p.flashTimer = setTimeout(() => delete p.frame.dataset.flash, ms);
      },
      canvas(opts = {}) {
        const c = HD.makeCanvas(opts.parent || p.body, opts);
        p.canvases.push(c);
        return c;
      },
      on: (evt, fn) => HD.bus.on(evt, fn),
      emit: (evt, data) => HD.bus.emit(evt, data),
      alert(level, msg) {
        HD.bus.emit('alert', { level, msg, source: p.code, panel: p.id, time: Date.now() });
      },
    };
  }

  function mountPanel(frameEl) {
    const id = frameEl.dataset.panel;
    const factory = registry.get(id);
    if (!factory || frameEl.__hdMounted) {
      if (!factory) frameEl.classList.add('is-empty');
      return;
    }
    frameEl.__hdMounted = true;
    frameEl.classList.remove('is-empty');
    const body = frameEl.querySelector('.panel-bd');
    const codeEl = frameEl.querySelector('.panel-code');
    const p = {
      id,
      code: codeEl ? codeEl.textContent.trim() : id,
      frame: frameEl,
      body,
      inst: {},
      visible: true,
      interval: 0,
      lastTick: 0,
      errors: 0,
      dead: false,
      canvases: [],
      w: 0,
      h: 0,
    };
    try {
      p.inst = factory(makeCtx(p)) || {};
    } catch (err) {
      logErr(`[${id}] mount failed: ${(err && err.stack) || err}`);
      frameEl.classList.add('is-dead');
      body.appendChild(U.el('div', 'panel-dead', `SIGNAL LOST · ${p.code}`));
      return;
    }
    p.interval = p.inst.fps ? 1000 / p.inst.fps : 0;
    mounted.push(p);
    byBody.set(body, p);
    measure(p);
    ro.observe(body);
    io.observe(frameEl);
  }

  function setupSolo() {
    document.documentElement.classList.add('is-solo');
    for (const f of document.querySelectorAll('[data-panel]')) {
      if (f.dataset.panel !== HD.solo) {
        f.remove();
        continue;
      }
      const w = parseInt(params.get('w'), 10);
      const h = parseInt(params.get('h'), 10);
      if (w) f.style.width = w + 'px';
      if (h) f.style.height = h + 'px';
      if (w || h) f.classList.add('is-sized');
    }
  }

  HD.boot = () => {
    if (booted) return;
    booted = true;
    if (HD.solo) setupSolo();
    if (HD.reducedMotion) document.documentElement.classList.add('is-still');
    ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const p = byBody.get(e.target);
        if (p) measure(p);
      }
    });
    io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const p = byBody.get(e.target.querySelector('.panel-bd'));
        if (p) p.visible = e.isIntersecting;
      }
    });
    M.deadline = performance.now() + M.total;
    updateMission(performance.now());
    for (const el of document.querySelectorAll('[data-panel]')) mountPanel(el);
    HD.bus.emit('boot', { panels: mounted.map((p) => p.id) });
    requestAnimationFrame(frame);
    HD.fontsReady = false;
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        HD.fontsReady = true;
        HD.bus.emit('fonts:ready', {});
      });
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', HD.boot);
  else setTimeout(HD.boot, 0);
})();
