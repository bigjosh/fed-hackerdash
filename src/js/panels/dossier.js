/* FEDLIGHT · P-12 TARGET DOSSIER
   Classified file card for WRAITH: a grainy procedural surveillance photo plus live label/value
   rows (last seen, speed, plate reveal, confirmation badges). DOM for crisp text, ~12 fps. */
(() => {
  'use strict';

  HD.panel('dossier', (ctx) => {
    const U = ctx.util;
    const W = ctx.words;
    const T = ctx.state.target;
    const RM = ctx.reducedMotion;
    const R = ctx.rng(HD.seed ^ 0xd05517);
    const el = U.el;
    const BLOCK = '█████████'; // same width as an SIV plate, AB-123-CD
    const timers = new Set();
    const later = (fn, ms) => {
      const id = setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
      return id;
    };

    /* ------------------------------------------------------------------ DOM */

    const root = el('div', 'dos-root');
    const sweep = el('div', 'dos-sweep');
    const top = el('div', 'dos-top');
    const file = el('span', 'dos-file');
    file.append(el('i', '', 'FILE'), el('b', '', 'NS-7731-Ω'));
    const bar = el('span', 'dos-barcode');
    bar.style.backgroundImage = barcode(HD.rng(HD.seed ^ 0xba7c0de));
    const copy = el('span', 'dos-copy', `CPY 0${R.int(2, 4)}/05`);
    top.append(file, bar, copy);

    const main = el('div', 'dos-main');
    const photo = el('div', 'dos-photo');
    const idCol = el('div', 'dos-id');
    main.append(photo, idCol);
    const list = el('div', 'dos-rows');
    const stamp = el('div', 'dos-stamp');
    stamp.setAttribute('aria-hidden', 'true');
    stamp.append(el('b', '', 'CLASSIFIED'), el('small', '', 'EYES ONLY · NULLSEC/Ω'));
    root.append(sweep, top, main, list, stamp);
    // The size container wraps the root: a container cannot query itself, and the compact/large
    // rules below restyle .dos-root (paddings, --k-w, --v-size).
    const cq = el('div', 'dos-cq');
    cq.appendChild(root);
    ctx.el.appendChild(cq);

    const rows = {};
    function row(parent, key, label, cls) {
      const r = el('div', 'dos-row' + (cls ? ' ' + cls : ''));
      r.dataset.k = key;
      const k = el('span', 'dos-k', label);
      const vl = el('div', 'dos-vl');
      const v = el('span', 'dos-v');
      vl.appendChild(v);
      r.append(k, vl);
      parent.appendChild(r);
      return (rows[key] = { r, k, vl, v, text: '' });
    }
    const sub = (r, cls, text) => {
      const s = el('span', 'dos-sub' + (cls ? ' ' + cls : ''), text);
      r.vl.appendChild(s);
      return s;
    };

    const rCode = row(idCol, 'codename', 'CODENAME');
    rCode.v.classList.add('dos-code');
    const rName = row(idCol, 'name', 'NAME');
    const redact = el('span', 'dos-redact');
    const cells = [];
    for (let i = 0; i < 11; i++) {
      const c = el('i', '', '');
      cells.push(c);
      redact.appendChild(c);
    }
    rName.v.replaceWith(redact);
    rName.v = redact;
    sub(rName, 'dos-dim', '[REDACTED]');
    const rAlias = row(idCol, 'aliases', 'ALIASES');
    const pair = el('div', 'dos-pair');
    idCol.appendChild(pair);
    const rThreat = row(pair, 'threat', 'THREAT');
    rThreat.v.classList.add('dos-chip');
    const rStatus = row(pair, 'status', 'STATUS');
    rStatus.v.classList.add('dos-status');
    row(idCol, 'bio', 'BIOMETRICS', 'dos-xtra');

    const rSeen = row(list, 'seen', 'LAST SEEN');
    const seenLine = el('span', 'dos-line2');
    const distEl = el('span', 'dos-dist', '—');
    const ageEl = el('span', 'dos-age', '0S AGO');
    seenLine.append(distEl, ageEl);
    rSeen.vl.appendChild(seenLine);
    const rVeh = row(list, 'vehicle', 'VEHICLE');
    sub(rVeh, 'dos-dim dos-opt', T.vehicleColor || 'MATTE BLACK');
    const rPlate = row(list, 'plate', 'PLATE');
    const plateTag = sub(rPlate, 'dos-tag is-wait', '');
    const tagL = el('span', 'dos-tl');
    const tagS = el('span', 'dos-ts'); // short form for compact containers
    plateTag.append(tagL, tagS);
    function setTag(state, long, short) {
      tagL.textContent = long;
      tagS.textContent = short;
      plateTag.className = `dos-sub dos-tag is-${state}`;
    }
    setTag('wait', 'AWAITING OCR', 'OCR?');
    const rSpeed = row(list, 'speed', 'SPEED');
    const hdgSub = sub(rSpeed, 'dos-dim', 'HDG 000° N');
    const rAssoc = row(list, 'assoc', 'KNOWN ASSOC.');
    row(list, 'implants', 'IMPLANTS', 'dos-mid');
    row(list, 'bounty', 'BOUNTY', 'dos-xtra');
    const rCharges = row(list, 'charges', 'CHARGES');

    const assoc = W.handles.filter((h) => h !== T.codename && !T.aliases.includes(h) && h !== '0xFEDLIGHT');
    const TEXT = {
      codename: T.codename,
      aliases: T.aliases.join(' · '),
      threat: 'OMEGA',
      status: 'TRACKING',
      bio: 'M · 1.86 M · 79 KG · O-NEG',
      seen: '—',
      vehicle: T.vehicle,
      plate: BLOCK,
      speed: '— KM/H',
      assoc: assoc.join(' · '),
      implants: 'OPTIC MK-IV · NEURAL JACK · SUBDERMAL RF',
      bounty: `${(R.int(38, 52) / 10).toFixed(1)}M CR · DEAD OR ALIVE`,
      charges: 'GRID INTRUSION ×14 · ORBITAL KEY THEFT · 3× IDENTITY FORGERY',
    };

    function barcode(r) {
      const stops = [];
      let x = 0;
      while (x < 150) {
        const bw = r.pick([1, 1, 1, 2, 2, 3]);
        const gap = r.pick([1, 1, 2, 2, 3]);
        stops.push(`var(--holo) ${x}px ${x + bw}px`, `transparent ${x + bw}px ${x + bw + gap}px`);
        x += bw + gap;
      }
      return `linear-gradient(90deg, ${stops.join(', ')})`;
    }

    /* ----------------------------------------------------------- boot type-in */

    const order = ['codename', 'name', 'aliases', 'threat', 'status', 'bio', 'seen', 'vehicle', 'plate', 'speed', 'assoc', 'implants', 'bounty', 'charges'];
    function setVal(key, text, { scramble = false, duration = 420, chars } = {}) {
      const r = rows[key];
      r.text = text;
      if (key === 'name') return;
      if (scramble && !RM) {
        r.busyUntil = performance.now() + duration + 40;
        U.scramble(r.v, text, { duration, chars: chars || U.CHARS.alnum, r: R });
      } else {
        r.busyUntil = 0;
        r.v.__scramble = null;
        r.v.textContent = text;
      }
    }
    function boot(fast) {
      order.forEach((key, i) => {
        const r = rows[key];
        r.r.classList.add('is-pending');
        if (key !== 'name') r.v.textContent = '';
        later(() => {
          r.r.classList.remove('is-pending');
          setVal(key, rows[key].text || TEXT[key], { scramble: true, duration: fast ? 260 : 420 });
        }, (fast ? 40 : 75) * i + (fast ? 0 : 250));
      });
    }
    for (const k of order) rows[k].text = TEXT[k];
    if (T.plateRevealed) rows.plate.text = T.plate;
    boot(false);
    later(fit, 1500); // re-fit once every value has typed in

    /* ------------------------------------------------------------ live state */

    const sim = { street: R.pick(W.streets), district: R.pick(W.districts), speed: R.range(70, 120), heading: R.range(0, 360), turnAt: 0 };
    let live = null;
    let liveAt = -1e9;
    let shownSeen = '';
    let seenAt = performance.now();
    let resyncIv = 7000;
    let lastSecs = -1;
    let dispSpeed = 0;
    let lastSpeedTxt = '';
    let lastHdgTxt = '';
    let leakAt = performance.now() + 2500;
    let plateRevealed = !!T.plateRevealed;
    let glitchUntil = 0;

    ctx.on('target:move', (d) => {
      if (!d) return;
      live = d;
      liveAt = performance.now();
    });

    const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    function stepSim(now, dt) {
      sim.speed = U.clamp(sim.speed + R.range(-14, 14) * dt, 38, 168);
      sim.heading = (sim.heading + R.range(-6, 6) * dt + 360) % 360;
      if (now > sim.turnAt) {
        sim.turnAt = now + R.range(5000, 9000);
        sim.street = R.pick(W.streets);
        if (R.chance(0.35)) sim.district = R.pick(W.districts);
        sim.heading = (sim.heading + R.pick([-90, 90, 0])) % 360;
        if (sim.heading < 0) sim.heading += 360;
      }
    }

    // Restart a CSS animation without a forced reflow: alternate between twin class names whose
    // keyframes are identical, so the animation-name change restarts it.
    function restart(node, cls) {
      const a = node.classList.contains(cls + '-a');
      node.classList.remove(cls + (a ? '-a' : '-b'));
      node.classList.add(cls + (a ? '-b' : '-a'));
    }
    const pulse = (r, cls) => restart(r.r, cls);

    function updateLive(now, dt) {
      const useSim = now - liveAt > 3000;
      if (useSim) stepSim(now, dt);
      const src = useSim ? sim : live;
      const street = src.street && src.street !== '—' ? src.street : sim.street;
      const district = src.district && src.district !== '—' ? src.district : sim.district;
      const seen = `${street}|${district}`;
      if (seen !== shownSeen && (now - seenAt > 2500 || !shownSeen)) {
        shownSeen = seen;
        seenAt = now;
        resyncIv = R.range(6000, 9500);
        if (distEl.textContent !== district) {
          if (RM || rSeen.r.classList.contains('is-pending')) distEl.textContent = district;
          else U.scramble(distEl, district, { duration: 380, r: R });
        }
        if (!rSeen.r.classList.contains('is-pending')) {
          setVal('seen', street, { scramble: true, duration: 380 });
          pulse(rSeen, 'is-ping');
        } else rows.seen.text = street;
      } else if (now - seenAt > resyncIv) {
        seenAt = now; // periodic re-sync from the grid even when the street has not changed
        resyncIv = R.range(6000, 9500);
        pulse(rSeen, 'is-ping');
      }
      const secs = Math.floor((now - seenAt) / 1000);
      if (secs !== lastSecs) {
        lastSecs = secs;
        ageEl.textContent = `${secs}S AGO`;
        ageEl.classList.toggle('is-stale', secs >= 6);
      }
      const spd = Number.isFinite(src.speed) ? src.speed : sim.speed;
      dispSpeed = U.damp(dispSpeed || spd, spd, 3, dt);
      const st = `${Math.round(dispSpeed)} KM/H`;
      if (st !== lastSpeedTxt && !rSpeed.r.classList.contains('is-pending') && now > (rSpeed.busyUntil || 0)) {
        lastSpeedTxt = st;
        setVal('speed', st);
      } else if (rSpeed.r.classList.contains('is-pending')) rows.speed.text = st;
      const hd = ((Number.isFinite(src.heading) ? src.heading : sim.heading) % 360 + 360) % 360;
      const ht = `HDG ${U.pad(Math.round(hd) % 360, 3)}° ${COMPASS[Math.round(hd / 45) % 8]}`;
      if (ht !== lastHdgTxt) hdgSub.textContent = lastHdgTxt = ht;
    }

    // NAME: a black bar that occasionally leaks a letter
    function leak(now) {
      if (now < leakAt) return;
      leakAt = now + (RM ? R.range(4500, 8000) : R.range(2200, 5600));
      const n = R.chance(0.3) ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const c = R.pick(cells);
        later(() => {
          c.textContent = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[R.int(0, 25)];
          c.classList.add('is-leak');
          later(() => {
            c.classList.remove('is-leak');
            c.textContent = '';
          }, RM ? 700 : R.range(90, 170)); // reduced motion: a slow reveal instead of a flicker
        }, i * 210);
      }
    }

    /* ---------------------------------------------------------------- events */

    function badge(key, src) {
      const r = rows[key];
      if (!r) return;
      if (!r.badge) {
        r.badge = el('span', 'dos-badge');
        r.badge.append(el('i', '', src), document.createTextNode('CONFIRMED'));
        r.vl.appendChild(r.badge);
      }
      restart(r.badge, 'is-new');
    }
    function clearBadges() {
      for (const k of Object.keys(rows)) {
        if (rows[k].badge) {
          rows[k].badge.remove();
          rows[k].badge = null;
        }
      }
    }

    function revealPlate(plate, conf) {
      plateRevealed = true;
      rPlate.v.classList.remove('is-redacted');
      rPlate.v.classList.add('is-plate');
      setVal('plate', plate, { scramble: true, duration: 950 });
      pulse(rPlate, 'is-ok');
      const pct = conf > 1 ? conf : conf * 100;
      setTag('ok', `OCR ${pct.toFixed(0)}%`, `${pct.toFixed(0)}%`);
      ctx.flash('ok', 1300);
    }
    function redactPlate() {
      plateRevealed = false;
      rPlate.v.classList.add('is-redacted');
      rPlate.v.classList.remove('is-plate');
      setVal('plate', BLOCK);
      setTag('wait', 'AWAITING OCR', 'OCR?');
    }
    if (!plateRevealed) rPlate.v.classList.add('is-redacted');
    else {
      rPlate.v.classList.add('is-plate');
      setTag('ok', 'OCR LOCKED', 'LOCK');
    }

    ctx.on('enhance:start', () => {
      if (plateRevealed) return;
      setTag('run', 'OCR RUNNING', 'OCR…');
    });
    ctx.on('enhance:result', (d) => {
      revealPlate((d && d.plate) || T.plate, (d && Number(d.confidence)) || 0.97);
    });
    ctx.on('face:match', () => {
      badge('codename', 'BIO');
      pulse(rCode, 'is-ping');
    });
    ctx.on('voice:match', () => {
      badge('aliases', 'VOX');
      pulse(rAlias, 'is-ping');
    });
    ctx.on('mission:reset', () => {
      for (const id of timers) clearTimeout(id);
      timers.clear();
      clearBadges();
      redactPlate();
      boot(true);
      later(fit, 800);
    });
    ctx.on('intrusion', () => {
      glitchUntil = performance.now() + (RM ? 400 : 1000);
      if (!RM) {
        restart(root, 'is-glitch');
        later(() => root.classList.remove('is-glitch-a', 'is-glitch-b'), 1000);
      }
      // corrupt a few values, then restore them
      for (const key of R.shuffle(['codename', 'aliases', 'seen', 'vehicle', 'assoc']).slice(0, 3)) {
        const r = rows[key];
        if (r.r.classList.contains('is-pending')) continue;
        const keep = r.text;
        U.scramble(r.v, keep.replace(/[^ ·]/g, '#'), { duration: 250, chars: U.CHARS.glyph, r: R }).then(() =>
          later(() => setVal(key, rows[key].text || keep, { scramble: true, duration: 380 }), 350)
        );
      }
    });
    ctx.on('fonts:ready', () => {
      fit();
      renderPhoto();
    });

    /* ------------------------------------------------------------ the photo */

    const pc = ctx.canvas({ parent: photo, dprMax: 2, className: 'dos-canvas' });
    const pg = pc.ctx;
    let base = null;
    let lo = null;
    let loCtx = null;
    let grainPat = null;
    let pw = 0;
    let ph = 0;

    const grainTile = document.createElement('canvas');
    grainTile.width = grainTile.height = 64;
    {
      const g = grainTile.getContext('2d');
      const img = g.createImageData(64, 64);
      const gr = HD.rng((HD.seed ^ 0x6a1a) >>> 0);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = gr() < 0.5 ? 0 : 255;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = gr() * 46;
      }
      g.putImageData(img, 0, 0);
    }

    function figurePath(w, h) {
      const cx = w * 0.47;
      const hw = w * 0.2;
      const p = new Path2D();
      p.moveTo(-w * 0.08, h);
      p.bezierCurveTo(w * 0.0, h * 0.8, cx - hw * 1.7, h * 0.68, cx - hw * 1.1, h * 0.61);
      p.bezierCurveTo(cx - hw * 1.35, h * 0.36, cx - hw * 0.95, h * 0.13, cx, h * 0.12);
      p.bezierCurveTo(cx + hw * 0.98, h * 0.13, cx + hw * 1.35, h * 0.36, cx + hw * 1.12, h * 0.61);
      p.bezierCurveTo(cx + hw * 1.75, h * 0.68, w * 0.98, h * 0.8, w * 1.08, h);
      p.closePath();
      return p;
    }

    function drawScene(s, w, h) {
      const r = HD.rng(HD.seed ^ 0x0091);
      const bg = s.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#1a4550');
      bg.addColorStop(0.55, '#0c2429');
      bg.addColorStop(1, '#03090b');
      s.fillStyle = bg;
      s.fillRect(0, 0, w, h);
      // distant tower windows
      for (let i = 0; i < 34; i++) {
        s.fillStyle = `rgba(150,240,255,${r.range(0.05, 0.22).toFixed(2)})`;
        s.fillRect(r.range(0, w * 0.4), r.range(0, h * 0.55), r.range(0.6, 1.8), r.range(0.6, 1.4));
      }
      // magenta neon sign bleeding in from the right
      s.save();
      s.shadowColor = '#ff2a6d';
      s.shadowBlur = w * 0.14;
      s.fillStyle = 'rgba(255,60,130,0.95)';
      s.fillRect(w * 0.87, h * 0.06, w * 0.045, h * 0.4);
      s.restore();
      const mg = s.createRadialGradient(w * 0.96, h * 0.28, 0, w * 0.96, h * 0.28, w * 0.75);
      mg.addColorStop(0, 'rgba(255,42,109,0.38)');
      mg.addColorStop(1, 'rgba(255,42,109,0)');
      s.fillStyle = mg;
      s.fillRect(0, 0, w, h);
      // cold street light from upper left
      const cl = s.createRadialGradient(w * 0.05, h * 0.05, 0, w * 0.05, h * 0.05, w * 0.6);
      cl.addColorStop(0, 'rgba(95,243,255,0.22)');
      cl.addColorStop(1, 'rgba(95,243,255,0)');
      s.fillStyle = cl;
      s.fillRect(0, 0, w, h);
      // backlight haze behind the head so the hood reads as a silhouette
      const hz = s.createRadialGradient(w * 0.5, h * 0.32, 0, w * 0.5, h * 0.32, w * 0.62);
      hz.addColorStop(0, 'rgba(150,235,245,0.6)');
      hz.addColorStop(0.5, 'rgba(70,170,190,0.24)');
      hz.addColorStop(1, 'rgba(60,150,170,0)');
      s.fillStyle = hz;
      s.fillRect(0, 0, w, h);
      // rain
      s.strokeStyle = 'rgba(190,235,255,0.12)';
      s.lineWidth = 0.5;
      s.beginPath();
      for (let i = 0; i < 60; i++) {
        const x = r.range(0, w * 1.1);
        const y = r.range(-5, h);
        const l = r.range(3, 8);
        s.moveTo(x, y);
        s.lineTo(x - l * 0.22, y + l);
      }
      s.stroke();
      // hooded figure
      const path = figurePath(w, h);
      s.fillStyle = '#020405';
      s.fill(path);
      const cx = w * 0.47;
      const hw = w * 0.2;
      // rim light: magenta from the sign (right), cold cyan (left); inner half of a clipped stroke
      s.save();
      s.clip(path);
      s.save();
      s.beginPath();
      s.rect(cx + hw * 0.1, 0, w, h);
      s.clip();
      s.shadowColor = '#ff2a6d';
      s.shadowBlur = w * 0.05;
      s.strokeStyle = 'rgba(255,80,150,0.95)';
      s.lineWidth = w * 0.04;
      s.stroke(path);
      s.restore();
      s.save();
      s.beginPath();
      s.rect(0, 0, cx - hw * 0.1, h);
      s.clip();
      s.strokeStyle = 'rgba(120,245,255,0.7)';
      s.lineWidth = w * 0.03;
      s.stroke(path);
      s.restore();
      // fabric folds catching light
      s.strokeStyle = 'rgba(255,80,150,0.18)';
      s.lineWidth = w * 0.008;
      s.beginPath();
      s.moveTo(cx + hw * 0.55, h * 0.62);
      s.quadraticCurveTo(cx + hw * 0.9, h * 0.8, cx + hw * 0.7, h);
      s.moveTo(cx + hw * 0.2, h * 0.68);
      s.quadraticCurveTo(cx + hw * 0.35, h * 0.85, cx + hw * 0.25, h);
      s.stroke();
      s.restore();
      // face void inside the hood, jaw barely lit
      const fy = h * 0.38;
      s.beginPath();
      s.ellipse(cx + w * 0.012, fy, hw * 0.56, hw * 0.78, 0, 0, Math.PI * 2);
      const fv = s.createRadialGradient(cx, fy - hw * 0.2, 0, cx, fy, hw * 0.8);
      fv.addColorStop(0, '#000000');
      fv.addColorStop(1, '#05080a');
      s.fillStyle = fv;
      s.fill();
      s.strokeStyle = 'rgba(255,80,150,0.35)';
      s.lineWidth = w * 0.01;
      s.beginPath();
      s.ellipse(cx + w * 0.012, fy, hw * 0.52, hw * 0.74, 0, -0.15, 1.2);
      s.stroke();
      // eye glints
      s.save();
      s.shadowColor = '#ff2340';
      s.shadowBlur = w * 0.03;
      s.fillStyle = '#ff4057';
      s.fillRect(cx - hw * 0.3, fy - hw * 0.08, w * 0.032, w * 0.016);
      s.fillRect(cx + hw * 0.16, fy - hw * 0.08, w * 0.032, w * 0.016);
      s.restore();
    }

    function renderPhoto() {
      pc.fit();
      pw = pc.w;
      ph = pc.h;
      if (pw < 10 || ph < 10) return;
      const dpr = pc.dpr;
      // scene at reduced resolution, upscaled without smoothing: digital-zoom blockiness
      const lw = Math.max(28, Math.round(pw / 1.7));
      const lh = Math.max(34, Math.round((lw * ph) / pw));
      // one reusable CPU-side canvas: the grain pass reads it back (no GPU readback per resize)
      if (!lo) {
        lo = document.createElement('canvas');
        loCtx = lo.getContext('2d', { willReadFrequently: true });
      }
      lo.width = lw;
      lo.height = lh;
      const s = loCtx;
      drawScene(s, lw, lh);
      const img = s.getImageData(0, 0, lw, lh);
      const d = img.data;
      const nr = HD.rng(HD.seed ^ 0x9a1f);
      for (let i = 0; i < d.length; i += 4) {
        const n = (nr() - 0.5) * 22;
        d[i] += n;
        d[i + 1] += n * 1.1;
        d[i + 2] += n;
      }
      s.putImageData(img, 0, 0);
      if (!base) base = document.createElement('canvas');
      base.width = Math.round(pw * dpr);
      base.height = Math.round(ph * dpr);
      const b = base.getContext('2d');
      b.imageSmoothingEnabled = false;
      b.drawImage(lo, 0, 0, base.width, base.height);
      b.setTransform(dpr, 0, 0, dpr, 0, 0);
      // halftone dot screen over the highlights + scanlines + vignette
      b.fillStyle = 'rgba(0,0,0,0.22)';
      for (let y = 0; y < ph; y += 2) b.fillRect(0, y, pw, 1);
      b.globalCompositeOperation = 'destination-out';
      b.fillStyle = 'rgba(0,0,0,0.18)';
      for (let y = 1; y < ph; y += 3) for (let x = (y % 6) / 2; x < pw; x += 3) b.fillRect(x, y, 1, 1);
      b.globalCompositeOperation = 'source-over';
      const vg = b.createRadialGradient(pw / 2, ph * 0.45, Math.min(pw, ph) * 0.2, pw / 2, ph / 2, Math.max(pw, ph) * 0.72);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.7)');
      b.fillStyle = vg;
      b.fillRect(0, 0, pw, ph);
      grainPat = pg.createPattern(grainTile, 'repeat');
    }

    function bracket(g, x, y, w, h, len) {
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

    function drawPhoto(now) {
      if (!base || pc.w !== pw || pc.h !== ph) renderPhoto();
      if (!base) return;
      const g = pg;
      pc.clear();
      const glitch = now < glitchUntil && !RM;
      if (glitch) {
        // horizontal tear slices
        const n = 7;
        const sh = base.height / n;
        for (let i = 0; i < n; i++) {
          const off = R.chance(0.5) ? R.range(-8, 8) : 0;
          g.drawImage(base, 0, i * sh, base.width, sh, off, (i * sh) / pc.dpr, pw, sh / pc.dpr);
        }
        g.fillStyle = ctx.rgba('neon', 0.25);
        g.fillRect(0, R.range(0, ph), pw, R.range(2, 8));
      } else g.drawImage(base, 0, 0, pw, ph);
      // animated film grain
      if (grainPat) {
        g.save();
        g.translate(-R.int(0, 63), -R.int(0, 63));
        g.fillStyle = grainPat;
        g.fillRect(0, 0, pw + 64, ph + 64);
        g.restore();
      }
      // CCTV roll bar
      if (!RM) {
        const by = ((now / 45) % (ph + 30)) - 15;
        g.fillStyle = 'rgba(170,240,255,0.06)';
        g.fillRect(0, by, pw, 10);
      }
      const tiny = pw < 70;
      const pk = U.clamp(pw / 180, 1, 1.8); // overlay scale on big photos
      // target bracket on the head
      const breathe = RM ? 0 : Math.sin(now / 420) * 1.2 * pk;
      const bx = pw * 0.24 - breathe;
      const by = ph * 0.1 - breathe;
      const bw = pw * 0.48 + breathe * 2;
      const bh = ph * 0.44 + breathe * 2;
      g.strokeStyle = ctx.color.threat;
      g.lineWidth = tiny ? 1 : 1.3 * pk;
      bracket(g, Math.round(bx) + 0.5, Math.round(by) + 0.5, Math.round(bw), Math.round(bh), (tiny ? 4 : 7) * pk);
      g.lineWidth = 1;
      // side ticks on the bracket
      g.strokeStyle = ctx.rgba('threat', 0.6);
      const my = Math.round(by + bh / 2) + 0.5;
      g.beginPath();
      g.moveTo(Math.round(bx) - 3 * pk, my);
      g.lineTo(Math.round(bx) + 2 * pk, my);
      g.moveTo(Math.round(bx + bw) - 2 * pk, my);
      g.lineTo(Math.round(bx + bw) + 3 * pk, my);
      g.stroke();
      if (tiny) return;
      const fz = Math.round(9 * pk);
      const cw = 5.4 * pk; // JetBrains Mono advance at this size
      g.font = `500 ${fz}px "JetBrains Mono", Consolas, monospace`;
      g.textBaseline = 'middle';
      // target tag under the bracket
      const tt = 'TGT-01';
      const tagW = tt.length * cw + 5 * pk;
      const tx = Math.round(bx + bw) - tagW;
      const ty = Math.round(by + bh) + 3 * pk;
      g.fillStyle = 'rgba(40,0,8,0.82)';
      g.fillRect(tx, ty, tagW, 10 * pk);
      g.fillStyle = '#ff8a98';
      g.fillText(tt, tx + 3 * pk, ty + 5.5 * pk);
      // REC + cam id
      const rec = RM || ((now / 600) | 0) % 2 === 0;
      if (rec) {
        g.fillStyle = ctx.color.threat;
        g.fillRect(4 * pk, 5 * pk, 5 * pk, 5 * pk);
      }
      g.fillStyle = 'rgba(223,248,255,0.85)';
      g.fillText('REC', 12 * pk, 8 * pk);
      g.textAlign = 'right';
      g.fillStyle = 'rgba(169,220,232,0.7)';
      if (pw >= 100) g.fillText('×4.0', pw - 4 * pk, 8 * pk);
      // caption strip
      const cap = 12 * pk;
      g.fillStyle = 'rgba(2,6,10,0.72)';
      g.fillRect(0, ph - cap, pw, cap);
      g.fillStyle = 'rgba(223,248,255,0.9)';
      g.textAlign = 'left';
      g.fillText('IMG 0091', 4 * pk, ph - cap / 2 + 0.5);
      g.textAlign = 'right';
      g.fillStyle = 'rgba(169,220,232,0.75)';
      if (pw >= 100) g.fillText(U.fmtClock(new Date(), HD.tz.offset), pw - 4 * pk, ph - cap / 2 + 0.5);
      g.textAlign = 'left';
    }

    /* ----------------------------------------------------------------- frame */

    /* ---------------------------------------------------------------- layout */

    // Arrangement per size: short strips go wide (photo | ID | rows in columns), narrow strips go
    // tall (photo on top, labels over values), everything else keeps the classic card, whose
    // container queries tune the density. --dk scales the type on big panels.
    let mode = '';
    let curDk = 1;
    function arrange(w, h) {
      const next = w >= 540 && w / h >= 2.2 ? 'wide' : w < 300 && h / w >= 1.8 ? 'tall' : 'std';
      if (next !== mode) {
        root.classList.toggle('is-wide', next === 'wide');
        root.classList.toggle('is-tall', next === 'tall');
        mode = next;
      }
      const dk = next === 'wide' ? U.clamp(h / 230, 1, 1.5) : next === 'tall' ? U.clamp(w / 210, 1, 1.2) : U.clamp(Math.min(w / 430, h / 400), 1, 1.8);
      curDk = dk;
      root.style.setProperty('--dk', dk.toFixed(3));
      if (next === 'wide') {
        // the photo spans the body under the file strip at roughly 5:6
        const ph = Math.max(40, h - 12 - 14 * dk - 5);
        root.style.setProperty('--ph-w', Math.round(ph * 0.83) + 'px');
        root.style.setProperty('--id-w', Math.round(U.clamp(w * 0.2, 160, 320 * dk)) + 'px');
      } else if (next === 'tall') {
        root.style.setProperty('--ph-w', Math.round(Math.min(w - 12, h * 0.36 * 0.83)) + 'px');
      }
    }

    // Fold away what does not fit, least important first, so nothing is sliced by an edge.
    // Layout reads: resize / font load / after the boot type-in only.
    const DROP_ROWS = ['bounty', 'implants', 'assoc', 'charges', 'speed'];
    const DROP_ID = ['bio', 'aliases', 'name'];
    const DROP_LAST = ['vehicle', 'plate'];
    const shown = (n) => n.offsetParent !== null;
    // A row counts as cut when the card's clip edge would bite into its text. Rows may bleed into
    // the card's bottom padding and lose their own padding + dashed rule (the classic 1080p card
    // does exactly that); the plate tag's frame has to stay whole.
    const LIST_KEYS = ['seen', 'vehicle', 'plate', 'speed', 'assoc', 'implants', 'bounty', 'charges'];
    const over = (n) => (n === list ? overList() : n.scrollHeight > n.clientHeight + 2);
    function overList() {
      const edge = root.getBoundingClientRect().bottom + 0.5;
      for (const k of LIST_KEYS) {
        const r = rows[k];
        if (r.r.offsetParent === null) continue;
        if (r.vl.getBoundingClientRect().bottom - (k === 'plate' ? 0 : 2 * curDk) > edge) return true;
      }
      return false;
    }
    // (the root's own scroll size is useless here: the sweep band is transformed past its edges)
    const overMain = () => main.getBoundingClientRect().bottom > root.getBoundingClientRect().bottom - 2;
    // wide strips: rows run down columns; use as many columns as it takes to fill the height
    // (instead of one sparse line of many columns), capped by a readable column width
    function flowWide() {
      let n = 0;
      for (const c of list.children) if (shown(c)) n++;
      n = Math.max(1, n);
      list.style.setProperty('--rc', '1');
      list.style.setProperty('--rr', String(n));
      const maxC = Math.max(1, Math.floor(list.clientWidth / (210 * curDk)));
      let c = U.clamp(Math.ceil(list.scrollHeight / Math.max(1, list.clientHeight)), 1, maxC);
      if (list.clientWidth >= 900 * curDk) c = Math.max(c, Math.min(maxC, 2)); // very wide: spread out
      const apply = () => {
        list.style.setProperty('--rc', String(c));
        list.style.setProperty('--rr', String(Math.ceil(n / c)));
      };
      apply();
      while (over(list) && c < maxC) {
        c++;
        apply();
      }
    }

    function fit() {
      for (const k of order) rows[k].r.classList.remove('is-cut');
      pair.classList.remove('is-cut');
      root.classList.remove('is-tight');
      const cut = (keys, box) => {
        for (const k of keys) {
          if (!over(box)) return;
          const n = rows[k].r;
          if (shown(n)) n.classList.add('is-cut');
        }
      };
      if (mode === 'wide') {
        cut(DROP_ID, idCol);
        flowWide();
        for (const k of DROP_ROWS.concat(DROP_LAST)) {
          if (!over(list)) break;
          const n = rows[k].r;
          if (!shown(n)) continue;
          n.classList.add('is-cut');
          flowWide();
        }
        return;
      }
      // stacked: the rows soak up what the card leaves; the ID extras go before the key rows
      cut(DROP_ROWS, list);
      for (const k of DROP_ID) {
        if (!over(list) && !overMain()) break;
        const n = rows[k].r;
        if (shown(n)) n.classList.add('is-cut');
      }
      cut(DROP_LAST, list);
      // last resort on tiny cards: LAST SEEN keeps only its street, then the threat line goes
      if (over(list)) root.classList.add('is-tight');
      if (over(list) || overMain()) pair.classList.add('is-cut');
    }

    return {
      fps: 12,
      resize(w, h) {
        arrange(w, h);
        fit();
        renderPhoto();
      },
      tick(now, dt) {
        updateLive(now, dt);
        leak(now);
        drawPhoto(now);
      },
    };
  });
})();
