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
      reticleLabel.textContent = `X${U.pad(Math.max(0, px | 0), 4)} Y${U.pad(Math.max(0, py | 0), 4)}${hoverCode ? '\n' + hoverCode + ' // LOCK' : ''}`;
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
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const life = 1 - (now - b.t) / 420;
      tctx.strokeStyle = HD.rgba('holo', 0.5 * life);
      tctx.lineWidth = 1 + 5 * life;
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
    const r = mapEl.getBoundingClientRect();
    uplink.style.left = `${Math.round(r.left + 26)}px`;
    uplink.style.top = `${Math.round(r.bottom - uplink.offsetHeight - 34)}px`;
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
