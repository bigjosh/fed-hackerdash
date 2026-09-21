/* FEDLIGHT · P-05 NODE MESH
   A force-directed intrusion graph. Four clusters settle into place, our entry node holds
   a green foothold, and compromise spreads node-to-node along the edges until the net is ours,
   then it re-maps. Custom physics kept O(n^2) but tiny (<=58 nodes). */
(() => {
  'use strict';

  HD.panel('netgraph', (ctx) => {
    const U = ctx.util;
    const cv = ctx.canvas({ dprMax: 2 });
    const g = cv.ctx;
    const rng = ctx.rng(HD.seed ^ 0x05e5);

    // Four attack surfaces. Centers are fractional; positioned per resize.
    const CLUSTERS = [
      { name: 'PARIS GRID', fx: 0.23, fy: 0.31, pre: 'seine', kinds: ['scada', 'plc', 'meter', 'relay'], ip: () => `10.20.${rng.int(0, 40)}.${rng.int(2, 254)}` },
      { name: 'TARGET NET', fx: 0.77, fy: 0.31, pre: 'wraith', kinds: ['host', 'db', 'vault', 'cache'], ip: () => `10.66.${rng.int(1, 9)}.${rng.int(2, 254)}` },
      { name: 'PROXY RING', fx: 0.23, fy: 0.73, pre: 'proxy', kinds: ['exit', 'hop', 'relay', 'bridge'], ip: () => `185.${rng.int(10, 60)}.${rng.int(0, 255)}.${rng.int(2, 254)}` },
      { name: 'C2', fx: 0.77, fy: 0.73, pre: 'c2', kinds: ['relay', 'beacon', 'stage', 'sink'], ip: () => `10.66.7.${rng.int(2, 254)}` },
    ];
    // preferred bridge pairs: the four edges of the quad (avoid a busy diagonal X)
    const BRIDGE_PAIRS = [[0, 1], [0, 2], [1, 3], [2, 3], [0, 1], [2, 3], [0, 3]];
    // Strips lay the clusters out in a staggered line in this cycle order, which keeps the quad's
    // edges as neighbours (proxy → grid → target → C2); a 2x2 would pile clusters onto each other.
    const QUAD = [[0.23, 0.31], [0.77, 0.31], [0.23, 0.73], [0.77, 0.73]];
    const RING = [2, 0, 1, 3];
    const OS = ['NYX/4.2', 'HELIOS 9', 'RTK-7', 'VXKERNEL', 'DARKBSD', 'SCADA-OS', 'MOBI-X', 'VANTA SRV'];
    const PORTS = [22, 80, 443, 445, 3389, 5900, 8080, 1883, 502, 8443, 23, 161];

    let nodes = [];
    let edges = [];
    let adj = []; // adjacency: index -> [neighborIndex...]
    let entry = 0;
    let ownedCount = 0;
    let temp = 1; // settling temperature, decays to a gentle drift
    const packets = [];
    const bursts = [];
    const waves = [];
    let flyer = null; // in-flight exploit packet (one at a time)

    let nextComp = 0;
    let nextScan = 0;
    let nextPkt = 0;
    let t = 0;
    let remap = 0; // >0 while wiping
    let intr = 0; // intrusion red-pulse timer
    const contested = []; // {node, until}
    let noRoute = null; // {x, y, t}
    let urgent = false; // mission critical/final: compromise spreads faster
    let lastOwned = null; // {host, ip, t} for the HUD's last-owned readout
    let pktCount = 0, pktRate = 0, pktWin = 0; // packets launched per second, for the HUD
    const clLabel = CLUSTERS.map(() => ({ x: 0, y: 0, set: false }));
    let hover = -1;
    let pointer = { x: -1, y: -1, in: false };
    let rectDirty = true;
    let rect = null;
    let arr = 'quad'; // cluster arrangement: 'quad' | 'row' | 'col'
    let fs = 9; // label type size; grows on big panels
    let pw = 0, ph = 0, nr = 0; // size + node radius the mesh was last laid out for

    const HEX = [];
    for (let i = 0; i < 6; i++) HEX.push([Math.cos((i / 6) * Math.PI * 2 - Math.PI / 2), Math.sin((i / 6) * Math.PI * 2 - Math.PI / 2)]);

    const UIF = (px) => `600 ${px}px "Chakra Petch", "Segoe UI", sans-serif`;
    const MONOF = (px) => `500 ${px}px "JetBrains Mono", Consolas, monospace`;

    function nodeCount() {
      const area = ctx.width * ctx.height;
      // a narrow column gets a lighter mesh so each cluster keeps a gap for its label
      return U.clamp(Math.round(area / 2200), arr === 'quad' ? 34 : 26, 58);
    }
    function nodeR() {
      return U.clamp(Math.min(ctx.width, ctx.height) / 62, 2.4, 6);
    }
    function arrangeFor(w, h) {
      return w > h * 2.3 ? 'row' : h > w * 2 ? 'col' : 'quad';
    }
    // Cluster centres (fractions of the body) for the current size.
    function arrange(w, h) {
      arr = arrangeFor(w, h);
      fs = U.clamp(Math.round(Math.min(w, h) / 30), 9, 12);
      const top = padTop(w, h) + 10, bot = h - padBot() - 10;
      CLUSTERS.forEach((cl, ci) => {
        if (arr === 'quad') {
          cl.fx = QUAD[ci][0];
          cl.fy = QUAD[ci][1];
          return;
        }
        const k = RING.indexOf(ci);
        const along = (k + 0.5) / 4;
        const across = 0.5 + (k % 2 ? 0.1 : -0.1);
        if (arr === 'row') {
          cl.fx = along;
          cl.fy = (top + (bot - top) * across) / h;
        } else {
          cl.fx = across;
          cl.fy = (top + (bot - top) * along) / h;
        }
      });
    }

    function build() {
      const w = ctx.width, h = ctx.height;
      const N = nodeCount();
      nodes = [];
      edges = [];
      const per = Math.floor(N / CLUSTERS.length);
      const counts = CLUSTERS.map((_, i) => (i === CLUSTERS.length - 1 ? N - per * (CLUSTERS.length - 1) : per));
      const rad = arr === 'row' ? Math.min(w / 4, h) * 0.3 : arr === 'col' ? Math.min(w, h / 4) * 0.3 : Math.min(w, h) * 0.2;
      clLabel.forEach((l) => { l.set = false; });
      pw = w;
      ph = h;
      nr = nodeR();

      CLUSTERS.forEach((cl, ci) => {
        const cx = cl.fx * w, cy = cl.fy * h;
        for (let k = 0; k < counts[ci]; k++) {
          const a = rng.range(0, Math.PI * 2);
          const rr = Math.sqrt(rng()) * rad;
          const kind = rng.pick(cl.kinds);
          nodes.push({
            x: cx + Math.cos(a) * rr,
            y: cy + Math.sin(a) * rr,
            vx: 0, vy: 0,
            cl: ci,
            r: nodeR() * (rng.chance(0.16) ? 1.5 : 1),
            key: false, entry: false, owned: false,
            host: `${cl.pre}-${kind}-${U.pad(rng.int(1, 39))}`,
            ip: cl.ip(),
            os: rng.pick(OS),
            ports: pickPorts(),
            seed: rng.range(0, 100),
            fall: 0, // owned reveal animation 0..1
            shape: rng.chance(0.35) ? 'diamond' : 'hex',
          });
        }
      });

      buildEdges();

      // Our foothold: a router in the proxy ring, adjacent into the target surface.
      const ring = nodes.map((n, i) => i).filter((i) => nodes[i].cl === 2);
      entry = ring.length ? rng.pick(ring) : 0;
      const en = nodes[entry];
      en.entry = true;
      en.owned = true;
      en.fall = 1;
      en.host = 'fedhat-entry';
      en.ip = `185.14.${rng.int(0, 255)}.${rng.int(2, 254)}`;
      en.r = nodeR() * 1.55;
      ownedCount = 1;

      // Mark key (labelled) nodes round-robin across clusters — a wall of IPs in one corner reads badly.
      let budget = w < 150 ? 0 : w < 230 ? 4 : w * h > 600000 ? 10 : w >= 900 ? 8 : 6;
      const pool = CLUSTERS.map((_, ci) => nodes.map((n, i) => i)
        .filter((i) => nodes[i].cl === ci && i !== entry)
        .sort((a, b) => adj[b].length - adj[a].length));
      for (let round = 0; round < 3 && budget > 0; round++) {
        for (let ci = 0; ci < CLUSTERS.length && budget > 0; ci++) {
          const i = pool[ci][round];
          if (i == null) continue;
          nodes[i].key = true;
          nodes[i].r = Math.max(nodes[i].r, nodeR() * 1.35);
          budget--;
        }
      }

      temp = 1;
      packets.length = 0;
      bursts.length = 0;
      waves.length = 0;
      contested.length = 0;
      flyer = null;
      lastOwned = null;
      nextComp = t + rng.range(2500, 4200);
      nextScan = t + 1400;
      nextPkt = t;
      updateMeta();
    }

    function pickPorts() {
      const n = rng.int(2, 4);
      const s = rng.shuffle(PORTS).slice(0, n).sort((a, b) => a - b);
      return s.join(' ');
    }

    function buildEdges() {
      adj = nodes.map(() => []);
      const key = (a, b) => (a < b ? a + ',' + b : b + ',' + a);
      const seen = new Set();
      const link = (a, b, force) => {
        if (a === b) return false;
        const k = key(a, b);
        if (seen.has(k)) return false;
        if (!force && (adj[a].length >= 4 || adj[b].length >= 4)) return false;
        seen.add(k);
        edges.push({ a, b, bridge: nodes[a].cl !== nodes[b].cl });
        adj[a].push(b);
        adj[b].push(a);
        return true;
      };

      const members = [[], [], [], []];
      nodes.forEach((n, i) => members[n.cl].push(i));
      const ordered = members.map((idx, ci) => {
        const cx = CLUSTERS[ci].fx * ctx.width, cy = CLUSTERS[ci].fy * ctx.height;
        return idx.slice().sort((a, b) =>
          Math.atan2(nodes[a].y - cy, nodes[a].x - cx) - Math.atan2(nodes[b].y - cy, nodes[b].x - cx));
      });

      // 1) primary ring per cluster (keeps everyone at low degree first)
      ordered.forEach((ord) => { for (let i = 0; i < ord.length; i++) link(ord[i], ord[(i + 1) % ord.length]); });

      // 2) inter-cluster bridges, biased to adjacent surfaces (the quad edges, or line neighbours)
      const [ra, rb, rc, rd] = RING;
      const pairs = arr === 'quad' ? BRIDGE_PAIRS : [[ra, rb], [rb, rc], [rc, rd], [ra, rb], [rc, rd], [rb, rc], [ra, rd]];
      for (const [ca, cb] of rng.shuffle(pairs)) {
        const A = ordered[ca], B = ordered[cb];
        if (A.length && B.length) { link(rng.pick(A), rng.pick(B)); link(rng.pick(A), rng.pick(B)); }
      }

      // 3) guarantee full reachability (force through the cap if needed)
      connectComponents((a, b) => link(a, b, true));

      // 4) fill remaining capacity with density chords / second ring
      ordered.forEach((ord) => {
        for (let i = 0; i < ord.length; i++) if (ord.length > 3) link(ord[i], ord[(i + 2) % ord.length]);
        for (let c = 0; c < Math.max(2, (ord.length / 4) | 0); c++) link(rng.pick(ord), rng.pick(ord));
      });
    }

    function connectComponents(link) {
      const seen = new Uint8Array(nodes.length);
      const comp = (start) => {
        const stack = [start], out = [];
        seen[start] = 1;
        while (stack.length) {
          const v = stack.pop();
          out.push(v);
          for (const nb of adj[v]) if (!seen[nb]) { seen[nb] = 1; stack.push(nb); }
        }
        return out;
      };
      let main = null;
      for (let i = 0; i < nodes.length; i++) {
        if (seen[i]) continue;
        const c = comp(i);
        if (!main) { main = c; continue; }
        // stitch this component to the main one via the closest pair (cheap: pick representatives)
        link(c[0], main[rng.int(0, main.length - 1)]);
        main = main.concat(c);
      }
    }

    /* --------------------------------------------------------------- physics */

    function physics(dt) {
      const w = ctx.width, h = ctx.height;
      const drift = ctx.reducedMotion ? 0.4 : 1;
      // personal space scales with the area each node gets, so clusters fill their quadrant
      // instead of collapsing into clumps
      const minD = U.clamp(Math.sqrt((w * h) / Math.max(1, nodes.length)) * 0.62, nr * 3.4, 100);
      const minD2 = minD * minD;
      // Strips pull weakly along their long axis so each cluster spreads into its slot; big panels
      // pull more softly overall so clusters fill their quadrant instead of huddling in it.
      const soft = U.clamp(300 / Math.min(w, h), 0.25, 1);
      const kx = (arr === 'row' ? 0.4 : 1.2) * soft, ky = (arr === 'col' ? 0.4 : 1.2) * soft;
      const yTop = padTop(w, h), yBot = h - padBot();

      // short-range repulsion (all pairs, capped count is tiny)
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          let dx = a.x - b.x, dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 > minD2 || d2 < 0.001) continue;
          const d = Math.sqrt(d2) || 0.01;
          const f = ((minD - d) / minD) * 70;
          dx /= d; dy /= d;
          a.vx += dx * f * dt; a.vy += dy * f * dt;
          b.vx -= dx * f * dt; b.vy -= dy * f * dt;
        }
      }
      // edge springs
      const rest = minD * 0.85;
      for (const e of edges) {
        const a = nodes[e.a], b = nodes[e.b];
        let dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.01;
        // bridges are long by design: only pull them in gently
        const f = (d - rest) * (e.bridge ? 0.25 : 1.4);
        dx /= d; dy /= d;
        a.vx += dx * f * dt; a.vy += dy * f * dt;
        b.vx -= dx * f * dt; b.vy -= dy * f * dt;
      }
      // cluster centering + gentle idle drift
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const cl = CLUSTERS[n.cl];
        const cx = cl.fx * w, cy = cl.fy * h;
        n.vx += (cx - n.x) * kx * dt;
        n.vy += (cy - n.y) * ky * dt;
        const idle = (0.5 - temp * 0.5);
        n.vx += Math.sin(t * 0.0006 + n.seed) * 3.2 * idle * drift * dt;
        n.vy += Math.cos(t * 0.0005 + n.seed * 1.3) * 3.2 * idle * drift * dt;
        const damp = Math.exp(-6 * dt);
        n.vx *= damp; n.vy *= damp;
        n.x += n.vx * dt; n.y += n.vy * dt;
        n.x = U.clamp(n.x, 8, w - 8);
        n.y = U.clamp(n.y, yTop, yBot); // keep clear of the compromise bar
        if (n.owned && n.fall < 1) n.fall = Math.min(1, n.fall + dt * 3);
      }
      temp = Math.max(0, temp - dt * 0.35);
    }

    /* ------------------------------------------------------------ compromise */

    function ownedNeighbors() {
      // candidate = un-owned node adjacent to an owned node
      const cands = [];
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].owned) continue;
        for (const nb of adj[i]) if (nodes[nb].owned) { cands.push(i); break; }
      }
      return cands;
    }

    function startExploit(target) {
      const srcs = adj[target].filter((i) => nodes[i].owned);
      if (!srcs.length) return false;
      const src = rng.pick(srcs);
      flyer = { a: src, b: target, t: 0, target };
      return true;
    }

    function fall(i) {
      const n = nodes[i];
      if (n.owned) return;
      n.owned = true;
      n.fall = 0;
      ownedCount++;
      bursts.push({ x: n.x, y: n.y, t: 0, r: n.r });
      lastOwned = { host: n.host, ip: n.ip, t };
      updateMeta();
      ctx.emit('net:compromise', { ip: n.ip, host: n.host, owned: ownedCount, total: nodes.length });
      if (ctx.audio) ctx.audio.beep(320 + rng.range(0, 220), 40, 'square', 0.02);
      if (n.key) {
        ctx.alert('warn', `OWNED ${n.host} (${n.ip})`);
        ctx.flash('warn', 500);
      }
    }

    function doRemap() {
      remap = 1;
      ctx.alert('info', 'MESH FULLY OWNED — REMAPPING SURFACE');
    }

    /* ---------------------------------------------------------------- events */

    ctx.on('mission:reset', () => { urgent = false; remap = 1; });
    ctx.on('mission:phase', (d) => {
      const u = d.phase === 'critical' || d.phase === 'final';
      // pull the next exploit forward the moment things turn critical
      if (u && !urgent) nextComp = Math.min(nextComp, t + 1200);
      urgent = u;
    });
    ctx.on('intrusion', () => {
      intr = 1;
      ctx.flash(ctx.reducedMotion ? 'warn' : 'alert', 700);
      // a couple of owned nodes are contested back
      const owned = rng.shuffle(nodes.map((n, i) => i).filter((i) => nodes[i].owned && !nodes[i].entry));
      for (let k = 0; k < Math.min(2, owned.length); k++) {
        if (!contested.some((c) => c.node === owned[k])) contested.push({ node: owned[k], until: t + rng.range(2200, 3000) });
      }
    });

    /* ------------------------------------------------------------- pointer */

    const el = ctx.el;
    let hot = false;
    const locate = (e) => {
      if (rectDirty || !rect) { rect = el.getBoundingClientRect(); rectDirty = false; }
      pointer.x = e.clientX - rect.left;
      pointer.y = e.clientY - rect.top;
      pointer.in = true;
    };
    const setHot = (on) => {
      // the shell's reticle tightens over [data-hot]; the cursor says the node is clickable
      if (on === hot) return;
      hot = on;
      el.toggleAttribute('data-hot', on);
      el.style.cursor = on ? 'pointer' : '';
    };
    const onMove = (e) => {
      locate(e);
      // hit-test here too so the reticle state is right before the shell's window listener reads it
      hover = pick(pointer.x, pointer.y);
      setHot(hover >= 0);
    };
    const onLeave = () => { pointer.in = false; hover = -1; setHot(false); };
    const onDown = (e) => {
      // touch has no hover: resolve the target from the press itself
      locate(e);
      hover = pick(pointer.x, pointer.y);
      if (hover < 0) return;
      const n = nodes[hover];
      if (n.owned) return;
      const routed = adj[hover].some((i) => nodes[i].owned);
      if (routed) {
        if (!flyer) startExploit(hover);
        else fall(hover);
      } else {
        noRoute = { x: n.x, y: n.y, t: 0 };
        if (ctx.audio) ctx.audio.beep(140, 90, 'sawtooth', 0.03);
      }
    };
    el.addEventListener('pointermove', onMove, { passive: true });
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('pointerdown', onDown);
    addEventListener('scroll', () => { rectDirty = true; }, { passive: true, capture: true });
    addEventListener('resize', () => { rectDirty = true; }, { passive: true });
    ctx.on('layout:change', () => { rectDirty = true; });
    ctx.on('layout:settled', () => { rectDirty = true; });

    function pick(px, py) {
      let best = -1, bd = 1e9;
      const grab = Math.max(12, nodeR() * 3.4);
      for (let i = 0; i < nodes.length; i++) {
        const dx = nodes[i].x - px, dy = nodes[i].y - py;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = i; }
      }
      return bd <= grab * grab ? best : -1;
    }
    function hitTest() {
      // nodes drift under a still pointer, so re-pick every frame
      if (!pointer.in) { hover = -1; return; }
      hover = pick(pointer.x, pointer.y);
      setHot(hover >= 0);
    }

    /* ----------------------------------------------------------------- meta */

    function updateMeta() {
      ctx.meta(`${ownedCount}/${nodes.length} OWNED`);
    }

    /* ---------------------------------------------------------------- draw */

    function nodeColor(n) {
      if (n.entry) return ctx.color.phosphor;
      if (n.owned) return ctx.color.neon;
      if (n.cl === 1) return ctx.color.holo; // target net
      return ctx.color.holo2;
    }

    function pathShape(x, y, r, shape) {
      g.beginPath();
      if (shape === 'diamond') {
        g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y);
      } else {
        for (let i = 0; i < 6; i++) { const p = HEX[i]; const px = x + p[0] * r, py = y + p[1] * r; i ? g.lineTo(px, py) : g.moveTo(px, py); }
      }
      g.closePath();
    }

    function draw() {
      const w = ctx.width, h = ctx.height;
      cv.clear();

      // faint cluster wells for depth
      for (const cl of CLUSTERS) {
        const cx = cl.fx * w, cy = cl.fy * h;
        const rr = Math.min(w, h) * 0.26;
        const grd = g.createRadialGradient(cx, cy, 0, cx, cy, rr);
        grd.addColorStop(0, ctx.rgba('holo', 0.05));
        grd.addColorStop(1, ctx.rgba('holo', 0));
        g.fillStyle = grd;
        g.fillRect(cx - rr, cy - rr, rr * 2, rr * 2);
      }

      // scan waves from entry (behind edges)
      const en = nodes[entry];
      const maxR = Math.hypot(w, h);
      for (const wv of waves) {
        const p = wv.t / 2200;
        const r = p * maxR * 0.75;
        g.strokeStyle = ctx.rgba('phosphor', (1 - p) * 0.35);
        g.lineWidth = 1;
        g.beginPath(); g.arc(en.x, en.y, r, 0, Math.PI * 2); g.stroke();
      }

      // edges
      g.lineWidth = 1;
      for (const e of edges) {
        const a = nodes[e.a], b = nodes[e.b];
        const both = a.owned && b.owned;
        g.strokeStyle = both ? ctx.rgba('neon', 0.34) : ctx.rgba('holo', e.bridge ? 0.22 : 0.13);
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      }

      // packets
      for (const pk of packets) {
        const a = nodes[pk.a], b = nodes[pk.b];
        const x = U.lerp(a.x, b.x, pk.t), y = U.lerp(a.y, b.y, pk.t);
        g.fillStyle = ctx.rgba(pk.col, 0.9);
        g.fillRect(x - 1, y - 1, 2.2, 2.2);
      }

      // exploit flyer
      if (flyer) {
        const a = nodes[flyer.a], b = nodes[flyer.b];
        const x = U.lerp(a.x, b.x, flyer.t), y = U.lerp(a.y, b.y, flyer.t);
        g.strokeStyle = ctx.rgba('threat', 0.5);
        g.lineWidth = 1.4;
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(x, y); g.stroke();
        g.save();
        g.shadowBlur = 8; g.shadowColor = ctx.color.threat;
        g.fillStyle = ctx.color.ice;
        g.beginPath(); g.arc(x, y, 2.2, 0, Math.PI * 2); g.fill();
        g.restore();
      }

      // nodes
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const col = nodeColor(n);
        const con = isContested(i);
        if (n.owned && !n.entry) {
          // owned: filled magenta with core glyph
          g.fillStyle = ctx.rgba(con ? 'amber' : 'neon', 0.9);
          pathShape(n.x, n.y, n.r * (0.9 + n.fall * 0.2), n.shape); g.fill();
          g.fillStyle = ctx.color.ice;
          g.beginPath(); g.arc(n.x, n.y, Math.max(0.9, n.r * 0.32), 0, Math.PI * 2); g.fill();
        } else {
          g.strokeStyle = con ? ctx.rgba('amber', 0.9) : ctx.rgba(col, n.cl === 1 ? 0.85 : 0.6);
          g.lineWidth = n.key || n.entry ? 1.4 : 1;
          pathShape(n.x, n.y, n.r, n.shape); g.stroke();
          if (n.key) { g.fillStyle = ctx.rgba(col, 0.25); g.fill(); }
        }
      }

      // entry pulse (green foothold) — the one spot we spend shadowBlur on
      {
        const period = ctx.reducedMotion ? 3000 : 1200;
        const pp = (t % period) / period;
        g.save();
        g.shadowBlur = 10; g.shadowColor = ctx.color.phosphor;
        g.strokeStyle = ctx.rgba('phosphor', 0.95);
        g.lineWidth = 1.6;
        pathShape(en.x, en.y, en.r, 'hex'); g.stroke();
        g.restore();
        g.strokeStyle = ctx.rgba('phosphor', 0.4 * (1 - pp));
        g.lineWidth = 1;
        g.beginPath(); g.arc(en.x, en.y, en.r + 4 + pp * 8, 0, Math.PI * 2); g.stroke();
      }

      // compromise bursts
      for (const bs of bursts) {
        const p = bs.t / 620;
        g.save();
        g.strokeStyle = ctx.rgba('threat', (1 - p) * 0.9);
        g.lineWidth = 1.6;
        g.beginPath(); g.arc(bs.x, bs.y, bs.r + p * 22 * (fs / 9), 0, Math.PI * 2); g.stroke();
        g.restore();
      }

      // --- label layer with collision avoidance ---------------------------
      const placed = [];
      const hits = (x, y, bw, bh) => {
        for (const p of placed) if (x < p.x + p.w && x + bw > p.x && y < p.y + p.h && y + bh > p.y) return true;
        return false;
      };

      // cluster labels first (they win the space). Each rides just above its cluster, smoothed so
      // the idle drift never makes it jitter, with a live owned count when there is room.
      const topReserve = hudFull(w, h) ? 13 + fs : fs;
      const withCount = w >= 230;
      const lb = fs + 3; // label plate height
      for (let ci = 0; ci < CLUSTERS.length; ci++) {
        let sx = 0, n = 0, own = 0, top = 1e9;
        for (const nd of nodes) {
          if (nd.cl !== ci) continue;
          sx += nd.x; n++;
          if (nd.owned) own++;
          if (nd.y - nd.r < top) top = nd.y - nd.r;
        }
        if (!n) continue;
        const L = clLabel[ci];
        const tx = sx / n, ty = top - fs;
        if (!L.set) { L.x = tx; L.y = ty; L.set = true; }
        L.x += (tx - L.x) * 0.06;
        L.y += (ty - L.y) * 0.06;
        const name = w < 150 ? CLUSTERS[ci].name.split(' ')[0] : CLUSTERS[ci].name;
        const cnt = withCount ? `${own}/${n}` : '';
        g.textBaseline = 'middle';
        g.font = UIF(fs);
        trySpace(1.1);
        const nw = g.measureText(name).width;
        trySpace(0);
        g.font = MONOF(fs);
        const cw = cnt ? g.measureText(cnt).width + 5 : 0;
        const tw = nw + cw;
        const lx = U.clamp(L.x - tw / 2, 5, w - tw - 5);
        const ly = U.clamp(L.y, topReserve, h - padBot() - 4);
        g.fillStyle = ctx.rgba('bg', 0.6);
        g.fillRect(lx - 4, ly - lb / 2, tw + 7, lb);
        g.fillStyle = ctx.rgba(ci === 1 ? 'holo' : 'holo2', 0.8);
        g.fillRect(lx - 4, ly - lb / 2, 1.5, lb);
        g.textAlign = 'left';
        g.font = UIF(fs);
        trySpace(1.1);
        g.fillStyle = ctx.rgba('holo', 0.72);
        g.fillText(name, lx, ly);
        trySpace(0);
        if (cnt) {
          g.font = MONOF(fs);
          g.fillStyle = own === n ? ctx.rgba('neon', 0.95) : own ? ctx.rgba('neon', 0.75) : ctx.rgba('text', 0.5);
          g.fillText(cnt, lx + nw + 5, ly + 0.5);
        }
        placed.push({ x: lx - 4, y: ly - lb / 2, w: tw + 7, h: lb });
      }

      // node labels: entry, then owned key, then key. Skip any that would collide.
      if (ctx.width >= 150) {
        g.font = MONOF(fs);
        g.textBaseline = 'middle';
        const order = nodes.map((n, i) => i)
          .filter((i) => nodes[i].key || nodes[i].entry)
          .sort((a, a2) => rank(nodes[a2]) - rank(nodes[a]));
        // Labelled nodes are obstacles for the IP labels, so one never runs over a neighbour's
        // marker. The entry label only has to dodge other labels, and is always shown.
        const nodeBox = [];
        for (const i of order) {
          const n = nodes[i];
          nodeBox.push({ x: n.x - n.r - 1, y: n.y - n.r - 1, w: n.r * 2 + 2, h: n.r * 2 + 2, i });
        }
        const onNode = (x, y, bw, bh, self) => {
          for (const p of nodeBox) if (p.i !== self && x < p.x + p.w && x + bw > p.x && y < p.y + p.h && y + bh > p.y) return true;
          return false;
        };
        for (const i of order) {
          const n = nodes[i];
          const label = n.entry ? 'ENTRY·' + n.ip : (n.owned ? n.host : n.ip);
          const tw = g.measureText(label).width;
          const bh = fs + 2;
          // try right, then left of the node
          const cands = [[n.x + n.r + 3, n.y], [n.x - n.r - 3 - tw, n.y]].map(([cx, cy]) =>
            [U.clamp(cx, 2, w - tw - 2), U.clamp(cy - bh / 2, 2, h - bh - 2)]);
          let put = null;
          for (const [bx, by] of cands) {
            if (!hits(bx, by, tw + 2, bh) && (n.entry || !onNode(bx, by, tw + 2, bh, i))) { put = [bx, by]; break; }
          }
          if (!put && n.entry) put = cands[0];
          if (!put) continue;
          const [bx, by] = put;
          g.fillStyle = ctx.rgba('bg', 0.55);
          g.fillRect(bx - 1, by, tw + 2, bh);
          g.textAlign = 'left';
          g.fillStyle = ctx.rgba(n.entry ? 'phosphor' : n.owned ? 'neon' : 'text', 0.92);
          g.fillText(label, bx, by + bh / 2 + 0.5);
          placed.push({ x: bx - 1, y: by, w: tw + 2, h: bh });
        }
      }

      // contested tags: the owned nodes the intrusion is clawing back
      if (contested.length && w >= 150) {
        g.font = UIF(fs);
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        for (const c of contested) {
          const n = nodes[c.node];
          if (!n) continue;
          const tw = g.measureText('CONTESTED').width;
          const bx = U.clamp(n.x - tw / 2, 2, w - tw - 2);
          // above the node, else below, so it never sits on the entry/IP labels
          const bh = fs + 2;
          const ys = [n.y - n.r - bh - 2, n.y + n.r + 3].map((y) => U.clamp(y, 2, h - bh - 1));
          const by = ys.find((y) => !hits(bx - 2, y, tw + 4, bh)) ?? ys[0];
          placed.push({ x: bx - 2, y: by, w: tw + 4, h: bh });
          g.fillStyle = ctx.rgba('bg', 0.75);
          g.fillRect(bx - 2, by, tw + 4, bh);
          g.fillStyle = ctx.rgba('amber', 0.95);
          g.fillText('CONTESTED', bx + tw / 2, by + bh / 2 + 0.5);
        }
      }

      // hover tooltip
      if (hover >= 0) drawTip(nodes[hover]);

      // no-route flash
      if (noRoute) {
        const p = noRoute.t / 700;
        g.font = UIF(fs);
        g.textAlign = 'center';
        g.fillStyle = ctx.rgba('threat', 1 - p);
        g.fillText('NO ROUTE', noRoute.x, noRoute.y - fs - 3);
        g.strokeStyle = ctx.rgba('threat', (1 - p) * 0.8);
        g.lineWidth = 1;
        g.beginPath(); g.arc(noRoute.x, noRoute.y, 6 + p * 8, 0, Math.PI * 2); g.stroke();
      }

      // HUD micro-readouts
      drawHud(w, h);

      // intrusion red wash
      if (intr > 0) {
        const flick = ctx.reducedMotion ? 0.8 : 0.6 + 0.4 * Math.sin(t * 0.02);
        g.fillStyle = ctx.rgba('threat', 0.12 * intr * flick);
        g.fillRect(0, 0, w, h);
      }

      // remap wipe
      if (remap > 0) {
        const y = (1 - remap) * h;
        g.fillStyle = ctx.rgba('bg', 0.92);
        g.fillRect(0, y, w, h - y);
        g.strokeStyle = ctx.rgba('phosphor', 0.9);
        g.lineWidth = 1.4;
        g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
        g.font = UIF(fs + 1);
        g.textAlign = 'center';
        g.fillStyle = ctx.rgba('phosphor', 0.9);
        if (h - y > fs + 7) g.fillText('RE-MAPPING MESH…', w / 2, Math.min(h - 8, y + fs + 5));
      }
    }

    function trySpace(px) { try { g.letterSpacing = px + 'px'; } catch (e) {} }
    function rank(n) { return n.entry ? 3 : n.owned ? 2 : 1; }
    function hudFull(w, h) { return w >= 300 && h >= 250; }
    // room for the HUD line and the top clusters' labels
    function padTop(w, h) { return hudFull(w, h) ? 27 + fs : 15 + fs; }
    // room for the last-owned readout and the compromise bar
    function padBot() { return fs + 11; }

    function isContested(i) {
      // flickers between owned and amber; steady amber under reduced motion
      for (const c of contested) if (c.node === i) return ctx.reducedMotion || ((t / 90) | 0) % 2 === 0;
      return false;
    }

    function drawTip(n) {
      const lines = [
        n.host,
        'IP  ' + n.ip,
        'PORT ' + n.ports,
        'OS  ' + n.os,
        n.entry ? 'STATUS OUR FOOTHOLD' : n.owned ? 'STATUS OWNED' : (adj[hover].some((i) => nodes[i].owned) ? 'STATUS EXPLOITABLE' : 'STATUS NO ROUTE'),
      ];
      g.font = MONOF(fs);
      trySpace(0);
      let wMax = 0;
      for (const l of lines) wMax = Math.max(wMax, g.measureText(l).width);
      const pad = 5, lh = fs + 2;
      const bw = wMax + pad * 2, bh = lines.length * lh + pad * 2 - 2;
      let bx = n.x + n.r + 6, by = n.y - bh / 2;
      if (bx + bw > ctx.width - 2) bx = n.x - n.r - 6 - bw;
      by = U.clamp(by, 2, ctx.height - bh - 2);
      g.fillStyle = ctx.rgba('bg', 0.92);
      g.fillRect(bx, by, bw, bh);
      g.strokeStyle = ctx.rgba('holo', 0.7);
      g.lineWidth = 1;
      g.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
      // corner ticks
      g.strokeStyle = ctx.rgba('holo', 0.9);
      g.beginPath();
      g.moveTo(bx, by + 4); g.lineTo(bx, by); g.lineTo(bx + 4, by);
      g.moveTo(bx + bw - 4, by + bh); g.lineTo(bx + bw, by + bh); g.lineTo(bx + bw, by + bh - 4);
      g.stroke();
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      // status line colour: ours green, owned magenta, reachable amber, unreachable red
      const stCol = n.entry ? 'phosphor' : n.owned ? 'neon' : lines[4].endsWith('EXPLOITABLE') ? 'amber' : 'threat';
      for (let i = 0; i < lines.length; i++) {
        const first = i === 0;
        g.fillStyle = first ? ctx.rgba(n.entry ? 'phosphor' : n.owned ? 'neon' : 'ice', 1)
          : i === lines.length - 1 ? ctx.rgba(stCol, 0.95) : ctx.rgba('text', 0.9);
        g.fillText(lines[i], bx + pad, by + pad + i * lh + lh / 2 - 1);
      }
      // pointer line
      g.strokeStyle = ctx.rgba('holo', 0.5);
      g.beginPath(); g.moveTo(n.x, n.y); g.lineTo(bx < n.x ? bx + bw : bx, U.clamp(n.y, by + 4, by + bh - 4)); g.stroke();
    }

    function drawHud(w, h) {
      const pct = Math.round((ownedCount / nodes.length) * 100);
      g.textBaseline = 'alphabetic';
      trySpace(0);
      // top-left status
      g.font = MONOF(fs);
      g.textAlign = 'left';
      g.fillStyle = ctx.rgba('holo', 0.6);
      if (hudFull(w, h)) g.fillText(`NODES ${nodes.length}  LINKS ${edges.length}  PKT/S ${pktRate}`, 6, fs + 3);
      // last-owned readout, left of the compromise %, typed in over its first 400 ms
      if (lastOwned && w >= 200) {
        g.font = UIF(fs);
        const room = w - 12 - g.measureText(`COMPROMISE ${pct}%`).width - 10;
        g.font = MONOF(fs);
        const full = [`▸ OWNED ${lastOwned.host} ${lastOwned.ip}`, `▸ OWNED ${lastOwned.host}`, `▸ ${lastOwned.host}`, '']
          .find((s) => g.measureText(s).width <= room);
        const age = t - lastOwned.t;
        const txt = ctx.reducedMotion ? full : full.slice(0, Math.ceil(full.length * U.clamp(age / 400, 0, 1)));
        g.font = MONOF(fs);
        g.textAlign = 'left';
        g.fillStyle = age < 1500 ? ctx.rgba('neon', 0.95) : ctx.rgba('text', 0.6);
        g.fillText(txt, 6, h - 11);
      }
      // bottom compromise bar
      const barY = h - 8, barX = 6, barW = w - 12;
      g.strokeStyle = ctx.rgba('holo', 0.3);
      g.strokeRect(barX + 0.5, barY + 0.5, barW - 1, 5);
      g.fillStyle = ctx.rgba('neon', 0.8);
      g.fillRect(barX + 1, barY + 1, (barW - 2) * (ownedCount / nodes.length), 3);
      // ticks
      g.strokeStyle = ctx.rgba('holo', 0.2);
      for (let x = barX; x <= barX + barW; x += barW / 10) { g.beginPath(); g.moveTo(x, barY - 1); g.lineTo(x, barY); g.stroke(); }
      g.font = UIF(fs);
      g.textAlign = 'right';
      g.fillStyle = ctx.rgba('neon', 0.9);
      g.fillText(`COMPROMISE ${pct}%`, barX + barW, barY - 3);
      // corner crosshairs
      g.strokeStyle = ctx.rgba('holo', 0.25);
      g.lineWidth = 1;
      const c = 7;
      g.beginPath();
      g.moveTo(2, 2 + c); g.lineTo(2, 2); g.lineTo(2 + c, 2);
      g.moveTo(w - 2 - c, 2); g.lineTo(w - 2, 2); g.lineTo(w - 2, 2 + c);
      g.stroke();
    }

    /* ----------------------------------------------------------------- tick */

    // Small size changes keep the mesh (and the intrusion's progress): positions and radii scale with
    // the body so nothing sits stale outside it, and the springs settle the rest.
    function rescale(w, h) {
      const sx = w / pw, sy = h / ph;
      const r2 = nodeR();
      const rk = r2 / nr;
      for (const n of nodes) {
        n.x *= sx; n.y *= sy; n.vx = 0; n.vy = 0; n.r *= rk;
      }
      for (const b of bursts) { b.x *= sx; b.y *= sy; }
      for (const l of clLabel) { l.x *= sx; l.y *= sy; }
      if (noRoute) { noRoute.x *= sx; noRoute.y *= sy; }
      pw = w; ph = h; nr = r2;
    }

    return {
      resize(w, h) {
        rectDirty = true;
        const prev = arr;
        arrange(w, h);
        // first mount, a different arrangement or a very different mesh size: lay out a fresh mesh
        if (!nodes.length || arr !== prev || Math.abs(nodeCount() - nodes.length) > 8) build();
        else rescale(w, h);
      },
      tick(_now, dt) {
        // one clock for every schedule: the panel's own accumulated time (pauses when hidden)
        t += dt * 1000;
        const now = t;

        if (remap > 0) {
          remap -= dt * 1.6;
          if (remap <= 0) { remap = 0; build(); }
          // let the wipe animation coast; still advance a little life underneath
        }

        physics(dt);
        hitTest();

        // ambient packets, rate rises with ownership + phase + intrusion
        const busy = U.clamp(ownedCount / nodes.length, 0, 1);
        const phaseBoost = urgent ? 1.5 : 1;
        const interval = U.lerp(300, 90, busy) / (phaseBoost * (1 + intr));
        if (now >= nextPkt && edges.length) {
          nextPkt = now + interval;
          const e = rng.pick(edges);
          const dir = rng.chance(0.5);
          packets.push({ a: dir ? e.a : e.b, b: dir ? e.b : e.a, t: 0, spd: rng.range(0.6, 1.3), col: (nodes[e.a].owned && nodes[e.b].owned) ? 'neon' : 'holo' });
          if (packets.length > 26) packets.shift();
          pktCount++;
        }
        // HUD packet rate: every visible dot stands for ~40 real packets
        pktWin += dt;
        if (pktWin >= 1) { pktRate = pktCount * 40 + rng.int(0, 39); pktCount = 0; pktWin = 0; }
        for (let i = packets.length - 1; i >= 0; i--) {
          packets[i].t += packets[i].spd * dt;
          if (packets[i].t >= 1) packets.splice(i, 1);
        }

        // scan wave
        if (now >= nextScan) {
          nextScan = now + (ctx.reducedMotion ? 9000 : 5500);
          waves.push({ t: 0 });
        }
        for (let i = waves.length - 1; i >= 0; i--) { waves[i].t += dt * 1000; if (waves[i].t > 2200) waves.splice(i, 1); }

        // exploit flyer progression
        if (flyer) {
          flyer.t += dt * 0.9;
          if (flyer.t >= 1) { fall(flyer.target); flyer = null; }
        }

        // scheduled compromise
        if (!flyer && remap <= 0 && now >= nextComp) {
          const cands = ownedNeighbors();
          if (cands.length) {
            // prefer bridging into fresh clusters occasionally, else nearest-ish random
            const target = rng.pick(cands);
            startExploit(target);
          }
          nextComp = now + (urgent ? rng.range(2400, 4000) : rng.range(4000, 7000));
          if (ownedCount >= nodes.length) doRemap();
        }
        if (ownedCount >= nodes.length && remap <= 0) doRemap();

        // bursts / contested / flashes decay
        for (let i = bursts.length - 1; i >= 0; i--) { bursts[i].t += dt * 1000; if (bursts[i].t > 620) bursts.splice(i, 1); }
        for (let i = contested.length - 1; i >= 0; i--) if (now >= contested[i].until) contested.splice(i, 1);
        if (intr > 0) intr = Math.max(0, intr - dt * 0.5);
        if (noRoute) { noRoute.t += dt * 1000; if (noRoute.t > 700) noRoute = null; }

        draw();
      },
    };
  });
})();
