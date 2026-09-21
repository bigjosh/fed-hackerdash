/* FEDLIGHT · P-13 event log
   Newest-first log of every `alert` on the bus, padded with local SOC chatter (never re-emitted).
   Rows are a capped, recycled DOM list: once MAX_ROWS exist, the oldest node is rewritten and moved
   to the top instead of creating a new one. The list is backfilled with older chatter so it always
   covers the panel height. A canvas activity strip above the list shows events per bin. */
(() => {
  'use strict';

  const MAX_ROWS = 72;
  // row pitch per size mode (must match alerts.css)
  const ROW_H = { base: 15, big: 21, two: 29 };
  const BIN_MS = 500;
  const NBINS = 256;
  const LEVELS = { info: 1, warn: 2, crit: 3 };
  const LABEL = { info: 'INFO', warn: 'WARN', crit: 'CRIT' };

  HD.panel('alerts', (ctx) => {
    const U = ctx.util;
    const C = ctx.color;
    const RM = ctx.reducedMotion;
    const R = ctx.rng(HD.seed ^ 0xa1e713);
    const ip = () => U.ip(R);
    const lan = () => `10.66.${R.int(0, 12)}.${R.int(2, 254)}`;
    const hex = (n) => U.randHex(n, R);
    // '11E · POPINCOURT' -> '11E'
    const arr = () => String(R.pick(ctx.words.districts)).split(' · ')[0];

    // [weight, level, source, message()]
    const CHATTER = [
      [6, 'info', 'AUTH', () => `AUTH OK ${lan()} (svc_${R.pick(['cam', 'grid', 'dns', 'relay', 'ops', 'mesh', 'fedhat'])})`],
      [6, 'info', 'FW', () => `FW DROP ${ip()}:${R.pick([443, 22, 8443, 3389, 53, 1883, 5060])}`],
      [3, 'warn', 'IDS', () => `IDS SIG ${R.int(1000, 9999)} MATCH · ${lan()}`],
      [2, 'warn', 'NET', () => `BGP ROUTE FLAP AS${R.int(64512, 65534)}`],
      [2, 'warn', 'DECY', () => `HONEYPOT TOUCHED ${lan()}`],
      [4, 'info', 'TLS', () => `CERT PINNING OK · ${R.pick(['gw', 'edge', 'core', 'cam'])}-${R.int(1, 9)}`],
      [3, 'warn', 'NET', () => `PACKET LOSS ${R.range(0.4, 6.8).toFixed(1)}% TRUNK ${R.pick(['A', 'B', 'C', 'D'])}`],
      [4, 'info', 'KRB', () => `KERBEROS TGT RENEWED svc_${R.pick(['grid', 'cam', 'sched'])}`],
      [3, 'info', 'DNS', () => `DNS SINKHOLE HIT c2-${hex(6).toLowerCase()}.onion`],
      [2, 'warn', 'FW', () => `PORT SCAN ${ip()} → 10.66.${R.int(0, 12)}.0/24`],
      [3, 'info', 'VPN', () => `VPN TUNNEL REKEY gw-${R.int(1, 9)} · AES-GCM`],
      [3, 'info', 'NTP', () => `NTP DRIFT +0.00${R.int(1, 9)}s NODE-${R.pick(['A', 'B', 'C'])}`],
      [2, 'warn', 'SSH', () => `SSH BRUTE 22/tcp ×${R.int(40, 900)} BLOCKED`],
      [3, 'info', 'EDGE', () => `LATENCY ${R.int(12, 240)}ms EDGE-${R.int(1, 7)}`],
      [2, 'warn', 'DLP', () => `DLP HOLD OUTBOUND ${R.range(0.2, 9.9).toFixed(1)}MB ws-${R.int(100, 480)}`],
      [2, 'warn', 'ARP', () => `ARP SPOOF SUSPECT ${lan()}`],
      [3, 'info', 'GEO', () => `GEOFENCE PING CAM-${U.pad(R.int(1, 999), 4)}`],
      [3, 'info', 'ANPR', () => `ANPR READ CAM-${U.pad(R.int(1, 999), 4)} · ${arr()}`],
      [2, 'info', 'GRID', () => `SUBSTATION ${arr()} LOAD ${R.int(38, 91)}% NOMINAL`],
      [2, 'info', 'RAIL', () => `METRO SCADA L${R.int(1, 14)} HEARTBEAT OK`],
      [2, 'info', 'SIGN', () => `SIGNAL SYNC ${arr()} · ${R.int(12, 64)} JUNCTIONS`],
      [1, 'warn', 'GRID', () => `FEEDER ${arr()}-${R.int(1, 9)} HARMONIC SPIKE`],
      [3, 'info', 'SYS', () => `WATCHDOG OK proc=${R.pick(['grid-sched', 'cam-ingest', 'mesh-sync', 'tracer'])}`],
      [2, 'info', 'SIEM', () => `SIEM CORR ${R.int(3, 19)} EVT → RULE ${R.int(1000, 1999)}`],
      [1, 'crit', 'IDS', () => `ROOTKIT HEURISTIC ${lan()} · QUARANTINE`],
      [1, 'crit', 'FW', () => `SYN FLOOD ${R.int(4, 90)}k pps · MITIGATING`],
      [1, 'crit', 'SOC', () => `LATERAL MOVE ${lan()} → ${lan()}`],
    ];
    const BURST = [
      ['crit', 'IDS', () => `ANOMALY SCORE 0.${R.int(91, 99)} · SESSION ${hex(4)}`],
      ['warn', 'FW', () => `EGRESS SPIKE ${R.range(1.1, 4.8).toFixed(1)} GB/s ${lan()}`],
      ['crit', 'SOC', () => 'ESCALATED → TIER 3 · KEYS ROTATING'],
      ['warn', 'NET', () => `ROUTE HIJACK AS${R.int(64512, 65534)} · NULL-ROUTED`],
    ];
    const chatterTotal = CHATTER.reduce((s, c) => s + c[0], 0);

    /* ------------------------------------------------------------------ DOM */

    const root = U.el('div', 'al-root');
    const strip = U.el('div', 'al-strip');
    const stripLbl = U.el('span', 'al-strip-lbl', 'EPS');
    const sparkBox = U.el('div', 'al-spark');
    const epsEl = U.el('span', 'al-eps', '0.0/s');
    const head = U.el('div', 'al-head');
    for (const t of [HD.tz.label, 'SEV', 'SRC', 'MESSAGE']) head.appendChild(U.el('span', 'al-h' + (t === 'SRC' ? ' al-h-src' : ''), t));
    const list = U.el('ol', 'al-list');
    list.setAttribute('aria-live', 'off');
    // the list slides inside a clipped viewport, so a new row never covers the strip or header
    const listBox = U.el('div', 'al-listbox');
    listBox.appendChild(list);
    strip.append(stripLbl, sparkBox, epsEl);
    root.append(strip, head, listBox);
    ctx.el.appendChild(root);
    const spark = ctx.canvas({ parent: sparkBox, className: 'al-spark-cv' });
    // the strip's width also moves when its neighbours do (webfont swap, EPS digits), not only
    // when the panel resizes; refit its buffer so the bars never stretch
    if (window.ResizeObserver) new ResizeObserver(() => spark.fit()).observe(sparkBox);
    let rowH = ROW_H.base;

    let total = 0;
    let crits = 0;
    let rowCount = 0;
    let chatterTimer = 0;
    let glitchTimer = 0;
    const burstTimers = [];
    const bins = new Uint8Array(NBINS);
    const binLvl = new Uint8Array(NBINS);
    let binIdx = 0;
    let binNo = 0; // monotonic bin counter, anchors the strip's grid lines to the bars
    let binStart = performance.now();
    let epsAt = 0;

    function makeRow() {
      const li = U.el('li', 'al-row');
      const t = U.el('span', 'al-t');
      const hh = U.el('i', 'al-hh');
      const mid = document.createTextNode('');
      const ms = U.el('i', 'al-ms');
      t.append(hh, mid, ms);
      const sev = U.el('b', 'al-sev');
      const src = U.el('span', 'al-src');
      const msg = U.el('span', 'al-msg');
      li.append(t, sev, src, msg);
      li._p = { hh, mid, ms, sev, src, msg };
      return li;
    }

    // Paris wall clock: the op runs on local time, like the top bar's PARIS clock
    function fmtTime(ts) {
      const d = new Date(ts + HD.tz.offset * 3600000);
      return {
        hh: U.pad(d.getUTCHours()) + ':',
        mid: U.pad(d.getUTCMinutes()) + ':' + U.pad(d.getUTCSeconds()),
        ms: '.' + U.pad(d.getUTCMilliseconds(), 3),
      };
    }

    function fillRow(li, level, source, msg, ts, ambient) {
      const p = li._p;
      const t = fmtTime(ts);
      p.ts = ts;
      p.hh.textContent = t.hh;
      p.mid.nodeValue = t.mid;
      p.ms.textContent = t.ms;
      p.sev.textContent = LABEL[level];
      p.src.textContent = source || '—';
      p.msg.textContent = msg;
      li.className = `al-row is-${level}${ambient ? ' is-amb' : ''}`;
      li.title = `${t.hh}${t.mid}${t.ms} ${HD.tz.label}  [${LABEL[level]}]  ${source || ''}  ${msg}`;
      total++;
      if (level === 'crit') crits++;
      ctx.meta(`${total} EVT · ${crits} CRIT`);
    }

    // `ambient` rows come from this panel's own chatter; the rest arrived on the bus
    function addRow(level, source, msg, ts, { ambient = false, animate = true } = {}) {
      if (!LEVELS[level]) level = 'info';
      let li;
      if (rowCount >= MAX_ROWS) {
        li = list.lastElementChild;
      } else {
        li = makeRow();
        rowCount++;
      }
      const p = li._p;
      fillRow(li, level, source, msg, ts, ambient);
      list.insertBefore(li, list.firstChild);

      bins[binIdx] = Math.min(255, bins[binIdx] + 1);
      binLvl[binIdx] = Math.max(binLvl[binIdx], LEVELS[level]);

      if (!animate) return;
      if (!RM) {
        list.animate([{ transform: `translateY(-${rowH}px)` }, { transform: 'translateY(0)' }], {
          duration: 260,
          easing: 'cubic-bezier(.2,.8,.2,1)',
        });
      }
      const hl = level === 'crit' ? 'rgba(255,35,64,0.38)' : level === 'warn' ? 'rgba(255,182,39,0.22)' : 'rgba(95,243,255,0.2)';
      li.animate([{ backgroundColor: hl }, { backgroundColor: 'rgba(0,0,0,0)' }], { duration: RM ? 1400 : 900, easing: 'ease-out' });
      if (level === 'crit' && !RM) {
        p.sev.animate(
          [{ opacity: 1 }, { opacity: 1, offset: 0.5 }, { opacity: 0.15, offset: 0.5 }, { opacity: 0.15 }],
          { duration: 160, iterations: 5 }
        );
      }
    }

    function pickChatter() {
      const hot = HD.state.phase === 'critical' || HD.state.phase === 'final';
      let r = R() * chatterTotal;
      for (const c of CHATTER) {
        r -= c[0];
        if (r <= 0) {
          // late in the countdown the network gets noisier: promote some info to warn
          const lvl = hot && c[1] === 'info' && R.chance(0.25) ? 'warn' : c[1];
          return [lvl, c[2], c[3]()];
        }
      }
      return ['info', 'SYS', 'HEARTBEAT OK'];
    }

    function scheduleChatter() {
      clearTimeout(chatterTimer);
      const hot = HD.state.phase === 'critical' || HD.state.phase === 'final';
      const delay = R.int(1200, 3500) * (hot ? 0.6 : 1);
      chatterTimer = setTimeout(() => {
        const [lvl, src, msg] = pickChatter();
        addRow(lvl, src, msg, Date.now(), { ambient: true });
        scheduleChatter();
      }, delay);
    }

    /* ----------------------------------------------------------------- bus */

    ctx.on('alert', (a) => {
      if (!a || !a.msg) return;
      addRow(a.level, a.source || (a.panel ? String(a.panel).slice(0, 4).toUpperCase() : 'SYS'), String(a.msg), a.time || Date.now());
    });
    ctx.on('intrusion', () => {
      for (const id of burstTimers) clearTimeout(id);
      burstTimers.length = 0;
      R.shuffle(BURST)
        .slice(0, 3)
        .forEach(([lvl, src, fn], i) => {
          burstTimers.push(setTimeout(() => addRow(lvl, src, fn(), Date.now(), { ambient: true }), 350 + i * 260));
        });
      if (!RM) {
        root.classList.add('is-glitch');
        clearTimeout(glitchTimer);
        glitchTimer = setTimeout(() => root.classList.remove('is-glitch'), 700);
      }
    });
    // the wipe lands: substations drop one after another (local rows, behind the takeover)
    ctx.on('mission:zero', () => {
      for (const id of burstTimers) clearTimeout(id);
      burstTimers.length = 0;
      const hit = R.shuffle(ctx.words.districts.map((d) => String(d).split(' · ')[0])).slice(0, 3);
      hit.forEach((a, i) => {
        burstTimers.push(setTimeout(() => addRow('crit', 'GRID', `BLACKOUT ${a} · SUBSTATION OFFLINE`, Date.now(), { ambient: true }), 200 + i * 420));
      });
      burstTimers.push(setTimeout(() => addRow('crit', 'GRID', 'GRID DOWN 20/20 · WIPE PROPAGATED', Date.now(), { ambient: true }), 1700));
    });
    ctx.on('mission:reset', () => scheduleChatter());

    // backlog so the log opens mid-shift instead of empty
    const now0 = Date.now();
    const backlog = [];
    let tb = now0 - R.int(2500, 4000);
    for (let i = 0; i < 16; i++) {
      const [lvl, src, msg] = pickChatter();
      backlog.push([lvl === 'crit' && i > 3 ? 'warn' : lvl, src, msg, tb]);
      tb -= R.int(900, 3800);
    }
    for (let i = backlog.length - 1; i >= 0; i--) {
      const b = backlog[i];
      addRow(b[0], b[1], b[2], b[3], { ambient: true, animate: false });
    }
    // re-file the backlog into the rate strip at its real (past) times
    bins.fill(0);
    binLvl.fill(0);
    for (const b of backlog) {
      const back = Math.floor((now0 - b[3]) / BIN_MS);
      if (back >= NBINS) continue;
      const k = (binIdx - back + NBINS) % NBINS;
      bins[k]++;
      binLvl[k] = Math.max(binLvl[k], LEVELS[b[0]]);
    }
    // older than the backlog: a plausible background rate, so a wide strip (up to NBINS bins)
    // does not open half empty
    for (let back = Math.floor((now0 - tb) / BIN_MS) + 1; back < NBINS; back++) {
      if (!R.chance(0.2)) continue;
      const k = (binIdx - back + NBINS) % NBINS;
      bins[k] = 1;
      binLvl[k] = R.chance(0.25) ? 2 : 1;
    }
    scheduleChatter();

    // Older chatter appended under the oldest row until the list holds `n` rows, so a panel made
    // taller never shows an empty log. Old CRITs are filed as WARN, like the opening backlog.
    function backfill(n) {
      const want = Math.min(MAX_ROWS, n);
      const now = Date.now();
      while (rowCount < want) {
        const last = list.lastElementChild;
        const ts = (last && last._p.ts ? last._p.ts : now) - R.int(900, 3800);
        const [lvl0, src, msg] = pickChatter();
        const lvl = lvl0 === 'crit' ? 'warn' : lvl0;
        const li = makeRow();
        rowCount++;
        fillRow(li, lvl, src, msg, ts, true);
        list.appendChild(li);
        const back = Math.floor((now - ts) / BIN_MS);
        if (back < NBINS) {
          const k = (binIdx - back + NBINS) % NBINS;
          bins[k] = Math.min(255, bins[k] + 1);
          binLvl[k] = Math.max(binLvl[k], LEVELS[lvl]);
        }
      }
    }

    // size modes: two-line rows for narrow, tall logs; larger type for full-screen logs
    let mode = '';
    function resize(w, h) {
      const two = (w < 300 && h >= 220) || (w < 360 && h >= 480);
      const big = !two && w >= 900 && h >= 420;
      const m = two ? 'two' : big ? 'big' : 'base';
      if (m !== mode) {
        mode = m;
        root.classList.toggle('is-2l', two);
        root.classList.toggle('is-big', big);
        rowH = ROW_H[m];
      }
      // the strip and the optional column header sit above the list
      const top = (big ? 20 : 15) + (!two && h >= 180 ? (big ? 18 : 14) : 0);
      backfill(Math.ceil((h - top) / rowH) + 1);
    }

    /* ------------------------------------------------------ activity strip */

    function drawSpark(now) {
      const g = spark.ctx;
      const w = spark.w;
      const h = spark.h;
      spark.clear();
      // wider strips get wider bars, so the visible window stays inside the bin ring (NBINS)
      const pitch = U.clamp(Math.round(w / 150), 3, 8);
      const bw = pitch > 4 ? pitch - 2 : 2;
      const frac = (now - binStart) / BIN_MS;
      const n = Math.min(NBINS - 1, Math.ceil(w / pitch) + 1);
      g.fillStyle = HD.rgba(C.holo, 0.1);
      g.fillRect(0, h - 1, w, 1);
      // smoothed rate (3 s window) behind the bars, so the strip reads as a sparkline
      g.strokeStyle = HD.rgba(C.holo2, 0.55);
      g.lineWidth = 1;
      g.beginPath();
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let j = 0; j < 6; j++) s += bins[(binIdx - i - j + NBINS * 2) % NBINS];
        const x = w - 2 - bw / 2 - (i + frac) * pitch;
        const y = h - 1.5 - Math.min(h - 3, s * 2.2);
        if (i) g.lineTo(x, y);
        else g.moveTo(x, y);
        if (x < -pitch) break;
      }
      g.stroke();
      for (let i = 0; i < n; i++) {
        const k = (binIdx - i + NBINS) % NBINS;
        const x = Math.round(w - 3 - bw - (i + frac) * pitch);
        if (x < -pitch) break;
        if ((binNo - i) % 20 === 0) {
          g.fillStyle = HD.rgba(C.holo, 0.1);
          g.fillRect(x - 1, 0, 1, h);
        }
        const c = bins[k];
        if (!c) {
          g.fillStyle = HD.rgba(C.holo, 0.16);
          g.fillRect(x, h - 2, bw, 1);
          continue;
        }
        const bh = Math.min(h - 1, 3 + (c - 1) * Math.max(3, Math.round(h / 4)));
        const lv = binLvl[k];
        g.fillStyle = lv === 3 ? C.threat : lv === 2 ? C.amber : HD.rgba(C.holo, 0.85);
        g.fillRect(x, h - 1 - bh, bw, bh);
      }
      // scan head at the newest edge
      g.fillStyle = HD.rgba(C.ice, 0.7);
      g.fillRect(w - 2, 0, 1, h);
    }

    return {
      fps: 20,
      resize,
      tick(now) {
        if (now - binStart > NBINS * BIN_MS) {
          // back from a long pause (hidden tab / off screen): the whole window is stale
          bins.fill(0);
          binLvl.fill(0);
          binStart = now;
        }
        while (now - binStart >= BIN_MS) {
          binStart += BIN_MS;
          binIdx = (binIdx + 1) % NBINS;
          binNo++;
          bins[binIdx] = 0;
          binLvl[binIdx] = 0;
        }
        if (now - epsAt > 500) {
          epsAt = now;
          let s = 0;
          for (let i = 0; i < 20; i++) s += bins[(binIdx - i + NBINS) % NBINS];
          epsEl.textContent = (s / 10).toFixed(1) + '/s';
        }
        drawSpark(now);
      },
    };
  });
})();
