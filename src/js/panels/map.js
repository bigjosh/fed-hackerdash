/* FEDLIGHT · P-02 GRIDTRACK // PARIS
   The hero map over real Paris (HD.data.paris · map data © OpenStreetMap contributors, ODbL).
   The static city is rendered lazily into an LRU cache of raster tiles at discrete zoom stops, so a
   resting view is a pixel-exact blit; every frame blits the visible tiles and layers the live chase
   on top: WRAITH's red dot driving the real street graph, intercept units, traffic cameras, the
   predicted route, landmarks, range rings, sweep and HUD. */
(() => {
  'use strict';

  HD.panel('map', (ctx) => {
    const bornAt = performance.now(); // the label fallback timer counts from mount
    const U = ctx.util;
    const C = ctx.color;
    const rgba = ctx.rgba;
    const ST = ctx.state;
    const RM = ctx.reducedMotion;
    const TAU = Math.PI * 2;
    const DEG = 180 / Math.PI;
    const RL = ctx.rng(HD.seed ^ 0x2f0c11d3); // live simulation

    const PD = HD.data && HD.data.paris;
    if (!PD) {
      ctx.el.appendChild(U.el('div', 'map-nodata', 'GEODATA OFFLINE · PARIS'));
      return {};
    }

    const W = PD.W;
    const H = PD.H;
    const ND = PD.nodes;
    const GM = PD.geom;
    const NAMES = PD.names;
    const EDG = PD.edges;
    const NE = EDG.count;
    const EA = EDG.a;
    const EB = EDG.b;
    const ECLS = EDG.cls;
    const EFL = EDG.flags;
    const ENAME = EDG.name;
    const ELEN = EDG.len;
    const EG0 = EDG.g0;
    const EGN = EDG.gn;
    const NV = ND.length / 2;
    const F_BRIDGE = 1;
    const F_TUNNEL = 2;
    const F_ONEWAY = 4;

    const SIM = RM ? 0.55 : 1.35; // metres of map motion per second per km/h shown: movie time
    const SPD = [98, 78, 66, 50]; // cruise km/h by road class
    const COST = [1 / 84, 1 / 78, 1 / 66, 1 / 44]; // routing cost per metre by class
    const ICON_MUL = 0.6; // iconic axes are cheaper, so WRAITH tours them
    const H_MUL = (1 / 84) * ICON_MUL * 0.85 * 1.25; // weighted A* heuristic per metre
    const GRID = 1000; // coordinate grid: 1 km cells, A..R × 01..10
    const CAM_R = 55; // camera pickup radius (m)
    const LAND = '#030a10';
    const WATER_C = '#021529';
    const VOID = '#010307';
    const HALO = 'rgba(2,6,11,0.92)';

    const FM = (px, w = 500) => `${w} ${px}px "JetBrains Mono", Consolas, monospace`;
    const FU = (px, w = 600) => `${w} ${px}px "Chakra Petch", "Segoe UI", sans-serif`;
    const FD = (px) => `${px}px Michroma, "Arial Black", sans-serif`;
    const F9 = FM(9);
    const F10 = FM(10);
    const U9 = FU(9);
    const U10 = FU(10, 700);

    const CORNERS = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    const uprightAng = (a) => {
      if (a > Math.PI / 2) a -= Math.PI;
      if (a <= -Math.PI / 2) a += Math.PI;
      return a;
    };

    /* ======================================================== geometry prep */

    const bbOf = (arrs) => {
      const b = [1e9, 1e9, -1e9, -1e9];
      for (const a of arrs) {
        for (let i = 0; i < a.length; i += 2) {
          if (a[i] < b[0]) b[0] = a[i];
          if (a[i] > b[2]) b[2] = a[i];
          if (a[i + 1] < b[1]) b[1] = a[i + 1];
          if (a[i + 1] > b[3]) b[3] = a[i + 1];
        }
      }
      return b;
    };
    const hitBB = (b, x0, y0, x1, y1) => b[0] <= x1 && b[2] >= x0 && b[1] <= y1 && b[3] >= y0;

    function pipRings(rings, x, y) {
      let c = false;
      for (const r of rings) {
        const n = r.length;
        for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
          const yi = r[i + 1];
          const yj = r[j + 1];
          if (yi > y !== yj > y && x < ((r[j] - r[i]) * (y - yi)) / (yj - yi) + r[i]) c = !c;
        }
      }
      return c;
    }

    const WATER = PD.water.map((w) => ({ kind: w.kind, name: w.name, rings: w.rings, bb: bbOf(w.rings) }));
    const PARKS = PD.parks.map((p) => ({ kind: p.kind, name: p.name, rings: p.rings, bb: bbOf(p.rings) }));
    const ARR = PD.arr.map((a) => {
      const parts = a.name.split(' · ');
      return { n: a.n, name: a.name, num: parts[0], sub: parts[1] || '', lx: a.label[0], ly: a.label[1], rings: a.rings, bb: bbOf(a.rings) };
    });
    const BOUND = PD.boundary;
    const BOUND_BB = bbOf(BOUND);
    const CONTEXT = PD.context.map((c) => ({ cls: c.cls, pts: c.pts, bb: bbOf([c.pts]) }));
    const RAIL = PD.rail.map((pts) => ({ pts, bb: bbOf([pts]) }));
    const SEINE = WATER.filter((w) => w.name === 'LA SEINE');
    const LMK = PD.landmarks.map((l) => ({ name: l.name, kind: l.kind, x: l.x, y: l.y }));
    {
      const order = ['TOUR EIFFEL', 'ARC DE TRIOMPHE', 'NOTRE-DAME', 'LOUVRE', 'SACRÉ-CŒUR', 'PLACE DE LA CONCORDE', 'OPÉRA GARNIER', 'LES INVALIDES', 'PANTHÉON', 'GRAND PALAIS', 'CENTRE POMPIDOU', 'PLACE DE LA BASTILLE', 'MUSÉE D\'ORSAY', 'TROCADÉRO', 'PLACE DE LA RÉPUBLIQUE', 'TOUR MONTPARNASSE', 'MOULIN ROUGE'];
      for (const l of LMK) {
        const k = order.indexOf(l.name);
        l.pri = k >= 0 ? k : 40 + (l.kind === 'station' ? 0 : 10);
        l.w = 0;
      }
      LMK.sort((a, b) => a.pri - b.pri);
    }

    // edge bounding boxes + grid buckets (an edge sits in every bucket its box touches)
    const EBB = new Float32Array(NE * 4);
    function edgeBB() {
      for (let e = 0; e < NE; e++) {
        let x0 = Math.min(ND[EA[e] * 2], ND[EB[e] * 2]);
        let x1 = Math.max(ND[EA[e] * 2], ND[EB[e] * 2]);
        let y0 = Math.min(ND[EA[e] * 2 + 1], ND[EB[e] * 2 + 1]);
        let y1 = Math.max(ND[EA[e] * 2 + 1], ND[EB[e] * 2 + 1]);
        for (let k = EG0[e], k1 = EG0[e] + EGN[e]; k < k1; k++) {
          const x = GM[k * 2];
          const y = GM[k * 2 + 1];
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
        const o = e * 4;
        EBB[o] = x0;
        EBB[o + 1] = y0;
        EBB[o + 2] = x1;
        EBB[o + 3] = y1;
      }
    }
    edgeBB();
    const BK = 250;
    const BW = Math.ceil(W / BK);
    const BH = Math.ceil(H / BK);
    const bci = (v, n) => (v < 0 ? 0 : v >= n ? n - 1 : v | 0);
    const bStart = new Int32Array(BW * BH + 1);
    let bList;
    {
      for (let pass = 0; pass < 2; pass++) {
        const fill = pass ? new Int32Array(BW * BH) : null;
        if (pass) bList = new Int32Array(bStart[BW * BH]);
        for (let e = 0; e < NE; e++) {
          const o = e * 4;
          const i0 = bci(EBB[o] / BK, BW);
          const i1 = bci(EBB[o + 2] / BK, BW);
          const j0 = bci(EBB[o + 1] / BK, BH);
          const j1 = bci(EBB[o + 3] / BK, BH);
          for (let j = j0; j <= j1; j++) {
            for (let i = i0; i <= i1; i++) {
              const c = j * BW + i;
              if (pass) bList[bStart[c] + fill[c]++] = e;
              else bStart[c + 1]++;
            }
          }
        }
        if (!pass) for (let c = 0; c < BW * BH; c++) bStart[c + 1] += bStart[c];
      }
    }
    const eStamp = new Uint32Array(NE);
    let eRun = 0;
    let qBuf = new Int32Array(4096);
    function queryEdges(x0, y0, x1, y1) {
      eRun++;
      let n = 0;
      const i0 = bci(x0 / BK, BW);
      const i1 = bci(x1 / BK, BW);
      const j0 = bci(y0 / BK, BH);
      const j1 = bci(y1 / BK, BH);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const c = j * BW + i;
          for (let k = bStart[c], k1 = bStart[c + 1]; k < k1; k++) {
            const e = bList[k];
            if (eStamp[e] === eRun) continue;
            eStamp[e] = eRun;
            const o = e * 4;
            if (EBB[o] > x1 || EBB[o + 2] < x0 || EBB[o + 1] > y1 || EBB[o + 3] < y0) continue;
            if (n >= qBuf.length) {
              const nb = new Int32Array(qBuf.length * 2);
              nb.set(qBuf);
              qBuf = nb;
            }
            qBuf[n++] = e;
          }
        }
      }
      return n;
    }

    // adjacency (CSR)
    const adjStart = new Int32Array(NV + 1);
    const adj = new Int32Array(NE * 2);
    {
      for (let e = 0; e < NE; e++) {
        if (EA[e] === EB[e]) continue;
        adjStart[EA[e] + 1]++;
        adjStart[EB[e] + 1]++;
      }
      for (let v = 0; v < NV; v++) adjStart[v + 1] += adjStart[v];
      const fill = new Int32Array(NV);
      for (let e = 0; e < NE; e++) {
        if (EA[e] === EB[e]) continue;
        adj[adjStart[EA[e]] + fill[EA[e]]++] = e;
        adj[adjStart[EB[e]] + fill[EB[e]]++] = e;
      }
    }
    const deg = (v) => adjStart[v + 1] - adjStart[v];
    const vMinCls = new Uint8Array(NV).fill(3);
    for (let e = 0; e < NE; e++) {
      if (ECLS[e] < vMinCls[EA[e]]) vMinCls[EA[e]] = ECLS[e];
      if (ECLS[e] < vMinCls[EB[e]]) vMinCls[EB[e]] = ECLS[e];
    }

    // iconic axes: routing bias toward the postcard streets
    const PERI = NAMES.indexOf('BOULEVARD PÉRIPHÉRIQUE');
    const ICON = new Uint8Array(NE);
    {
      const set = new Set([
        'AVENUE DES CHAMPS-ÉLYSÉES', 'PLACE DE LA CONCORDE', 'RUE DE RIVOLI', 'PLACE CHARLES DE GAULLE',
        'VOIE GEORGES POMPIDOU', 'VOIE GEORGES-POMPIDOU', 'BOULEVARD DE LA MADELEINE', 'BOULEVARD DES CAPUCINES',
        'BOULEVARD DES ITALIENS', 'BOULEVARD MONTMARTRE', 'BOULEVARD POISSONNIÈRE', 'BOULEVARD DE BONNE NOUVELLE',
        'BOULEVARD SAINT-DENIS', 'BOULEVARD SAINT-MARTIN', 'BOULEVARD DU TEMPLE', 'BOULEVARD DES FILLES DU CALVAIRE',
        'BOULEVARD BEAUMARCHAIS', 'BOULEVARD HAUSSMANN', 'PLACE DE LA BASTILLE', 'BOULEVARD SAINT-GERMAIN',
        'BOULEVARD SAINT-MICHEL', 'BOULEVARD DE SÉBASTOPOL', "AVENUE DE L'OPÉRA", 'AVENUE FOCH', 'AVENUE MONTAIGNE',
        'PLACE DE LA RÉPUBLIQUE', 'AVENUE DE LA GRANDE ARMÉE', 'AVENUE KLÉBER', 'AVENUE WINSTON CHURCHILL',
        'PLACE DE LA NATION', 'RUE DE LA PAIX', 'BOULEVARD RASPAIL', 'BOULEVARD DU MONTPARNASSE', 'RUE SAINT-ANTOINE',
        'AVENUE VICTORIA', 'AVENUE DE NEW YORK', 'AVENUE DU GÉNÉRAL LEMONNIER', 'PLACE DU TROCADÉRO ET DU 11 NOVEMBRE 1918',
      ]);
      const ids = new Set();
      NAMES.forEach((n, i) => {
        if (set.has(n) || n.startsWith('QUAI ') || n.startsWith('PONT ')) ids.add(i);
      });
      for (let e = 0; e < NE; e++) if (ids.has(ENAME[e]) && ECLS[e] <= 2) ICON[e] = 1;
    }

    // arrondissement lookup through a lazily filled 100 m grid
    const DGC = 100;
    const DGW = Math.ceil(W / DGC);
    const DGH = Math.ceil(H / DGC);
    const DG = new Int8Array(DGW * DGH).fill(-2);
    function arrAt(x, y) {
      const i = bci(x / DGC, DGW);
      const j = bci(y / DGC, DGH);
      const c = j * DGW + i;
      if (DG[c] !== -2) return DG[c];
      const cx = (i + 0.5) * DGC;
      const cy = (j + 0.5) * DGC;
      let r = -1;
      for (let k = 0; k < ARR.length; k++) {
        const a = ARR[k];
        if (cx < a.bb[0] || cx > a.bb[2] || cy < a.bb[1] || cy > a.bb[3]) continue;
        if (pipRings(a.rings, cx, cy)) {
          r = k;
          break;
        }
      }
      DG[c] = r;
      return r;
    }
    const districtAt = (x, y) => {
      const k = arrAt(x, y);
      return k >= 0 ? ARR[k].name : 'HORS PARIS';
    };
    const inParis = (x, y) => arrAt(x, y) >= 0;

    // street runs: consecutive edges of one way share a name and chain b -> a
    const RUNS = [];
    {
      let cur = null;
      for (let e = 0; e < NE; e++) {
        if (cur && EB[e - 1] === EA[e] && ENAME[e - 1] === ENAME[e] && !(EFL[e] & F_TUNNEL) === !(EFL[e - 1] & F_TUNNEL)) {
          cur.e1 = e;
          cur.len += ELEN[e];
          if (ECLS[e] < cur.cls) cur.cls = ECLS[e];
        } else {
          cur = { e0: e, e1: e, name: ENAME[e], cls: ECLS[e], len: ELEN[e], tun: !!(EFL[e] & F_TUNNEL), br: !!(EFL[e] & F_BRIDGE), poly: null };
          RUNS.push(cur);
        }
      }
    }
    // chains: runs of one street joined where exactly two of them meet at a vertex, so a boulevard
    // split into many OSM ways still reads as one line for labelling
    const CHAINS = [];
    const CHAIN_OF = new Int32Array(NE);
    {
      // group run ends by (vertex, name, tunnel) with one numeric sort: key * 2^18 + run end id
      const RE = RUNS.length * 2;
      const keys = new Float64Array(RE);
      let nk = 0;
      RUNS.forEach((r, i) => {
        if (!r.name) return;
        const t = r.tun ? 1 : 0;
        keys[nk++] = ((EA[r.e0] * 8192 + r.name) * 2 + t) * 262144 + i * 2;
        keys[nk++] = ((EB[r.e1] * 8192 + r.name) * 2 + t) * 262144 + i * 2 + 1;
      });
      const sorted = keys.subarray(0, nk).sort();
      const link = new Int32Array(RE).fill(-1); // run end (run * 2 + side) -> the run end it joins
      for (let a = 0; a < nk; ) {
        const k = Math.floor(sorted[a] / 262144);
        let b = a + 1;
        while (b < nk && Math.floor(sorted[b] / 262144) === k) b++;
        if (b - a === 2) {
          const p = sorted[a] % 262144;
          const q = sorted[a + 1] % 262144;
          if (p >> 1 !== q >> 1) {
            link[p] = q;
            link[q] = p;
          }
        }
        a = b;
      }
      const done = new Uint8Array(RUNS.length);
      const walk = (start) => {
        // back up to a free end so the chain starts at its head
        let i = start;
        let side = 0;
        for (let guard = 0; guard < RUNS.length; guard++) {
          const l = link[i * 2 + side];
          if (l < 0 || (l >> 1) === start) break;
          i = l >> 1;
          side = (l & 1) ^ 1;
        }
        const parts = [];
        let len = 0;
        let cls = 3;
        // walk forward: enter run i at end `side`, leave through the other end
        for (let guard = 0; guard < RUNS.length && !done[i]; guard++) {
          done[i] = 1;
          parts.push(i, side);
          len += RUNS[i].len;
          cls = Math.min(cls, RUNS[i].cls);
          const l = link[i * 2 + (side ^ 1)];
          if (l < 0) break;
          i = l >> 1;
          side = l & 1;
        }
        return { parts, len, cls, name: RUNS[start].name, tun: RUNS[start].tun, br: false, poly: null, e0: RUNS[start].e0 };
      };
      for (let i = 0; i < RUNS.length; i++) {
        if (done[i]) continue;
        const ch = walk(i);
        const ci = CHAINS.length;
        CHAINS.push(ch);
        let br = true;
        for (let k = 0; k < ch.parts.length; k += 2) {
          const r = RUNS[ch.parts[k]];
          if (!r.br) br = false;
          for (let e = r.e0; e <= r.e1; e++) CHAIN_OF[e] = ci;
        }
        ch.br = br;
      }
    }
    function chainPoly(ch) {
      if (ch.poly) return ch.poly;
      let n = 1;
      for (let k = 0; k < ch.parts.length; k += 2) n += runPoly(RUNS[ch.parts[k]]).n - 1;
      const pts = new Float32Array(n * 2);
      const cum = new Float32Array(n);
      let m = 0;
      for (let k = 0; k < ch.parts.length; k += 2) {
        const rp = runPoly(RUNS[ch.parts[k]]);
        const rev = ch.parts[k + 1] === 1;
        for (let q = m ? 1 : 0; q < rp.n; q++) {
          const j = rev ? rp.n - 1 - q : q;
          const x = rp.pts[j * 2];
          const y = rp.pts[j * 2 + 1];
          pts[m * 2] = x;
          pts[m * 2 + 1] = y;
          cum[m] = m ? cum[m - 1] + Math.hypot(x - pts[m * 2 - 2], y - pts[m * 2 - 1]) : 0;
          m++;
        }
      }
      ch.poly = { pts, cum, n: m };
      return ch.poly;
    }
    function runPoly(r) {
      if (r.poly) return r.poly;
      let n = 1;
      for (let e = r.e0; e <= r.e1; e++) n += EGN[e] + 1;
      const pts = new Float32Array(n * 2);
      const cum = new Float32Array(n);
      let k = 0;
      const push = (x, y) => {
        pts[k * 2] = x;
        pts[k * 2 + 1] = y;
        cum[k] = k ? cum[k - 1] + Math.hypot(x - pts[k * 2 - 2], y - pts[k * 2 - 1]) : 0;
        k++;
      };
      push(ND[EA[r.e0] * 2], ND[EA[r.e0] * 2 + 1]);
      for (let e = r.e0; e <= r.e1; e++) {
        for (let g = EG0[e], g1 = EG0[e] + EGN[e]; g < g1; g++) push(GM[g * 2], GM[g * 2 + 1]);
        push(ND[EB[e] * 2], ND[EB[e] * 2 + 1]);
      }
      r.poly = { pts, cum, n };
      return r.poly;
    }
    const PP = { x: 0, y: 0, i: 0 };
    function polyAt(p, t) {
      const cum = p.cum;
      let lo = 0;
      let hi = p.n - 1;
      if (t <= 0) {
        PP.x = p.pts[0];
        PP.y = p.pts[1];
        PP.i = 0;
        return PP;
      }
      while (hi - lo > 1) {
        const m = (lo + hi) >> 1;
        if (cum[m] < t) lo = m;
        else hi = m;
      }
      const sl = cum[hi] - cum[lo];
      const f = sl > 1e-6 ? U.clamp((t - cum[lo]) / sl, 0, 1) : 0;
      PP.x = p.pts[lo * 2] + (p.pts[hi * 2] - p.pts[lo * 2]) * f;
      PP.y = p.pts[lo * 2 + 1] + (p.pts[hi * 2 + 1] - p.pts[lo * 2 + 1]) * f;
      PP.i = lo;
      return PP;
    }

    function nearestVertex(x, y, r, maxCls) {
      const n = queryEdges(x - r, y - r, x + r, y + r);
      let best = -1;
      let bd = r * r;
      for (let k = 0; k < n; k++) {
        const e = qBuf[k];
        if (ECLS[e] > maxCls) continue;
        for (const v of [EA[e], EB[e]]) {
          const d = (ND[v * 2] - x) ** 2 + (ND[v * 2 + 1] - y) ** 2;
          if (d < bd) {
            bd = d;
            best = v;
          }
        }
      }
      return best;
    }

    /* ======================================================== destinations + cameras */

    const CENTER = PD.toXY(48.8589, 2.3469); // Châtelet
    const vx = (v) => ND[v * 2];
    const vy = (v) => ND[v * 2 + 1];
    function thin(cands, cell) {
      const seen = new Set();
      const out = [];
      for (const v of cands) {
        const k = Math.floor(vy(v) / cell) * 1000 + Math.floor(vx(v) / cell);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(v);
      }
      return out;
    }
    const POOL_LM = [];
    for (const l of LMK) {
      let v = nearestVertex(l.x, l.y, 380, 2);
      if (v < 0) v = nearestVertex(l.x, l.y, 600, 3);
      l.v = v;
      if (v >= 0) POOL_LM.push({ v, name: l.name });
    }
    const POOL_AX = [];
    const POOL_PERI = [];
    const POOL_MAJ = [];
    {
      const ax = [];
      const peri = [];
      const maj = [];
      for (let e = 0; e < NE; e++) {
        if (ICON[e]) ax.push(EA[e], EB[e]);
        if (ENAME[e] === PERI) peri.push(EA[e]);
        if (ECLS[e] <= 1 && ENAME[e] !== PERI && !(EFL[e] & F_TUNNEL)) maj.push(EA[e]);
      }
      const shuffled = (a) => RL.shuffle(a);
      for (const v of thin(shuffled(ax), 320)) if (inParis(vx(v), vy(v))) POOL_AX.push({ v, name: '' });
      for (const v of thin(shuffled(peri), 700)) POOL_PERI.push({ v, name: 'BOULEVARD PÉRIPHÉRIQUE' });
      for (const v of thin(shuffled(maj), 260)) if (inParis(vx(v), vy(v))) POOL_MAJ.push(v);
    }
    if (!POOL_MAJ.length) for (let v = 0; v < NV; v += 97) POOL_MAJ.push(v);

    const cams = [];
    {
      const cand = [];
      for (let v = 0; v < NV; v++) {
        if (deg(v) < 3 || vMinCls[v] > 1) continue;
        const x = vx(v);
        const y = vy(v);
        if (!inParis(x, y)) continue;
        let s = RL() * 2.2 + (deg(v) >= 4 ? 1 : 0);
        const dc = Math.hypot(x - CENTER[0], y - CENTER[1]);
        s += U.clamp(1 - dc / 5000, 0, 1) * 2.4;
        cand.push({ v, x, y, s });
      }
      cand.sort((a, b) => b.s - a.s);
      const conc = LMK.find((l) => l.name === 'PLACE DE LA CONCORDE');
      if (conc) {
        let best = null;
        let bd = 1e18;
        for (const c of cand) {
          const d = (c.x - conc.x) ** 2 + (c.y - conc.y) ** 2;
          if (d < bd) {
            bd = d;
            best = c;
          }
        }
        if (best) cand.unshift(best);
      }
      const ids = new Set(['0417']);
      for (const c of cand) {
        if (cams.length >= 42) break;
        if (cams.some((k) => Math.hypot(k.x - c.x, k.y - c.y) < 330)) continue;
        let id = cams.length === 0 ? '0417' : U.pad(RL.int(100, 9899), 4);
        while (cams.length && ids.has(id)) id = U.pad(RL.int(100, 9899), 4);
        ids.add(id);
        cams.push({ v: c.v, x: c.x, y: c.y, id: `CAM-${id}`, ang: RL.range(0, TAU), last: -1e9, flash: -1e9, big: false });
      }
    }

    /* ======================================================== pathfinding */

    const gS = new Float64Array(NV);
    const cameE = new Int32Array(NV);
    const cameR = new Uint8Array(NV);
    const seen = new Uint32Array(NV);
    const closed = new Uint32Array(NV);
    let run = 0;
    const heapN = new Int32Array(NE * 2 + 16);
    const heapK = new Float64Array(NE * 2 + 16);
    let heapSize = 0;
    function hpush(n, k) {
      if (heapSize >= heapN.length) return;
      let i = heapSize++;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heapK[p] <= k) break;
        heapN[i] = heapN[p];
        heapK[i] = heapK[p];
        i = p;
      }
      heapN[i] = n;
      heapK[i] = k;
    }
    function hpop() {
      const top = heapN[0];
      const n = heapN[--heapSize];
      const k = heapK[heapSize];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= heapSize) break;
        if (c + 1 < heapSize && heapK[c + 1] < heapK[c]) c++;
        if (heapK[c] >= k) break;
        heapN[i] = heapN[c];
        heapK[i] = heapK[c];
        i = c;
      }
      heapN[i] = n;
      heapK[i] = k;
      return top;
    }
    // returns an array of steps (edge * 2 + reversed) or null
    function astar(s, t, oneway, bias) {
      run++;
      heapSize = 0;
      const tx = vx(t);
      const ty = vy(t);
      gS[s] = 0;
      seen[s] = run;
      cameE[s] = -1;
      hpush(s, 0);
      let found = s === t;
      while (heapSize && !found) {
        const u = hpop();
        if (u === t) {
          found = true;
          break;
        }
        if (closed[u] === run) continue;
        closed[u] = run;
        for (let k = adjStart[u], k1 = adjStart[u + 1]; k < k1; k++) {
          const e = adj[k];
          const rev = EA[e] === u ? 0 : 1;
          if (rev && oneway && EFL[e] & F_ONEWAY) continue;
          const v = rev ? EA[e] : EB[e];
          if (closed[v] === run) continue;
          const c = ECLS[e];
          const ng = gS[u] + ELEN[e] * COST[c] * (bias ? bias[c] : 1) * (ICON[e] ? ICON_MUL : 1);
          if (seen[v] !== run || ng < gS[v]) {
            seen[v] = run;
            gS[v] = ng;
            cameE[v] = e;
            cameR[v] = rev;
            hpush(v, ng + Math.hypot(vx(v) - tx, vy(v) - ty) * H_MUL);
          }
        }
      }
      if (!found) return null;
      const steps = [];
      for (let v = t; v !== s; ) {
        const e = cameE[v];
        const r = cameR[v];
        steps.push(e * 2 + r);
        v = r ? EB[e] : EA[e];
      }
      steps.reverse();
      return steps;
    }

    /* ======================================================== agents */

    const stepFrom = (st) => (st & 1 ? EB[st >> 1] : EA[st >> 1]);
    const stepTo = (st) => (st & 1 ? EA[st >> 1] : EB[st >> 1]);
    // point + unit tangent at arclength s along edge e (reversed when r)
    function edgePointAt(e, r, s, out) {
      const n = EGN[e] + 2;
      const g0 = EG0[e];
      let d = r ? ELEN[e] - s : s;
      let px = ND[EA[e] * 2];
      let py = ND[EA[e] * 2 + 1];
      for (let i = 1; i < n; i++) {
        let qx;
        let qy;
        if (i === n - 1) {
          qx = ND[EB[e] * 2];
          qy = ND[EB[e] * 2 + 1];
        } else {
          qx = GM[(g0 + i - 1) * 2];
          qy = GM[(g0 + i - 1) * 2 + 1];
        }
        const sl = Math.hypot(qx - px, qy - py);
        if (d <= sl || i === n - 1) {
          const f = sl > 1e-6 ? U.clamp(d / sl, 0, 1) : 0;
          out.x = px + (qx - px) * f;
          out.y = py + (qy - py) * f;
          if (sl > 1e-6) {
            out.dx = ((qx - px) / sl) * (r ? -1 : 1);
            out.dy = ((qy - py) / sl) * (r ? -1 : 1);
          }
          return out;
        }
        d -= sl;
        px = qx;
        py = qy;
      }
      return out;
    }

    function makeAgent(v, trailN) {
      return {
        steps: [],
        i: 0,
        s: 0,
        v0: v,
        x: vx(v),
        y: vy(v),
        dx: 0,
        dy: -1,
        speed: 40,
        hd: 0,
        hdS: 0,
        trail: new Float32Array(trailN * 2),
        tN: trailN,
        tHead: 0,
        tCount: 0,
        tAcc: 0,
      };
    }
    const resetTrail = (A) => {
      A.tHead = 0;
      A.tCount = 0;
    };
    function pushTrail(A) {
      A.trail[A.tHead * 2] = A.x;
      A.trail[A.tHead * 2 + 1] = A.y;
      A.tHead = (A.tHead + 1) % A.tN;
      A.tCount = Math.min(A.tN, A.tCount + 1);
    }
    const endNode = (A) => (A.steps.length ? stepTo(A.steps[A.steps.length - 1]) : A.v0);
    const curEdge = (A) => (A.i < A.steps.length ? A.steps[A.i] >> 1 : -1);
    function place(A) {
      if (A.i >= A.steps.length) {
        const v = endNode(A);
        A.x = vx(v);
        A.y = vy(v);
        return;
      }
      const st = A.steps[A.i];
      edgePointAt(st >> 1, st & 1, A.s, A);
      A.hd = (Math.atan2(A.dx, -A.dy) * DEG + 360) % 360;
    }
    function advance(A, d) {
      while (d > 0 && A.i < A.steps.length) {
        const rem = ELEN[A.steps[A.i] >> 1] - A.s;
        if (d < rem) {
          A.s += d;
          d = 0;
          break;
        }
        d -= rem;
        A.i++;
        A.s = 0;
      }
      place(A);
    }
    function setRoute(A, goal, oneway, bias) {
      const mid = A.i < A.steps.length;
      const from = mid ? stepTo(A.steps[A.i]) : endNode(A);
      let r = astar(from, goal, oneway, bias);
      if (!r && oneway) r = astar(from, goal, false, bias);
      if (!r) return false;
      if (mid) A.steps = [A.steps[A.i]].concat(r);
      else {
        A.v0 = from;
        A.steps = r;
        A.s = 0;
      }
      A.i = 0;
      place(A);
      if (A === T) buildRoutePoly();
      return true;
    }
    const AH = { x: 0, y: 0, dx: 0, dy: 0 };
    function pointAhead(A, dist) {
      let i = A.i;
      let s = A.s + dist;
      while (i < A.steps.length) {
        const st = A.steps[i];
        const e = st >> 1;
        if (s <= ELEN[e]) return edgePointAt(e, st & 1, s, AH);
        s -= ELEN[e];
        i++;
      }
      const v = endNode(A);
      AH.x = vx(v);
      AH.y = vy(v);
      return AH;
    }

    // WRAITH's predicted route as one polyline, so drawing it is a single pass per frame
    let rPts = new Float32Array(0);
    let rCum = new Float32Array(0);
    let rStep = new Int32Array(0);
    let rN = 0;
    function buildRoutePoly() {
      const A = T;
      let n = 1;
      for (const st of A.steps) n += EGN[st >> 1] + 1;
      if (rPts.length < n * 2) {
        rPts = new Float32Array(n * 2 + 256);
        rCum = new Float32Array(n + 128);
      }
      if (rStep.length < A.steps.length + 1) rStep = new Int32Array(A.steps.length + 64);
      let k = 0;
      const push = (x, y) => {
        rPts[k * 2] = x;
        rPts[k * 2 + 1] = y;
        rCum[k] = k ? rCum[k - 1] + Math.hypot(x - rPts[k * 2 - 2], y - rPts[k * 2 - 1]) : 0;
        k++;
      };
      const v0 = A.steps.length ? stepFrom(A.steps[0]) : A.v0;
      push(vx(v0), vy(v0));
      for (let i = 0; i < A.steps.length; i++) {
        const st = A.steps[i];
        const e = st >> 1;
        rStep[i] = k - 1;
        const g0 = EG0[e];
        const gn = EGN[e];
        if (st & 1) for (let g = g0 + gn - 1; g >= g0; g--) push(GM[g * 2], GM[g * 2 + 1]);
        else for (let g = g0; g < g0 + gn; g++) push(GM[g * 2], GM[g * 2 + 1]);
        const v = stepTo(st);
        push(vx(v), vy(v));
      }
      rStep[A.steps.length] = k - 1;
      rN = k;
    }
    function remainingLen(A) {
      if (A.i >= A.steps.length || !rN) return 0;
      return Math.max(0, rCum[rN - 1] - (rCum[rStep[A.i]] + A.s));
    }

    const unitDefs = ctx.words.units.slice(0, 4).map((u) => u.replace(/^UNIT\s+/, ''));
    const recentDest = [];
    function pickStart() {
      const c = POOL_AX.filter((p) => Math.hypot(vx(p.v) - CENTER[0], vy(p.v) - CENTER[1]) < 2600);
      return (c.length ? RL.pick(c) : RL.pick(POOL_AX.length ? POOL_AX : POOL_LM)).v;
    }
    const T = makeAgent(pickStart(), 150);
    T.street = '—';
    T.district = '—';
    T.cls = 3;
    T.frozen = false;
    T.evadeAt = -1e9;
    T.periLeg = 0;
    T.destName = '';
    T.conf = 80;
    let units = [];
    let routeBias = [1, 1, 1, 1];

    function pickDest(fx, fy, ax, ay) {
      let pool;
      let dMin = 1500;
      let dMax = 5200;
      const roll = RL();
      if (T.periLeg > 0) {
        T.periLeg--;
        pool = POOL_PERI;
        dMin = 2400;
        dMax = 5200;
      } else if (roll < 0.46) pool = POOL_LM;
      else if (roll < 0.86) pool = POOL_AX;
      else if (roll < 0.94 && POOL_PERI.length) {
        pool = POOL_PERI;
        T.periLeg = 1;
      } else pool = POOL_MAJ.map((v) => ({ v, name: '' }));
      let best = null;
      let bestS = -1e9;
      for (let relax = 0; relax < 3 && !best; relax++) {
        const lo = dMin * (1 - relax * 0.35);
        const hi = dMax * (1 + relax * 0.5);
        for (const p of pool) {
          const x = vx(p.v);
          const y = vy(p.v);
          const d = Math.hypot(x - fx, y - fy);
          if (d < lo || d > hi) continue;
          let s = RL() * 1.6;
          if (pool !== POOL_PERI) s -= U.clamp((Math.hypot(x - CENTER[0], y - CENTER[1]) - 3800) / 2000, 0, 1.5);
          if (ax != null) s += Math.hypot(x - ax, y - ay) / 900;
          if (recentDest.includes(p.v)) s -= 2;
          if (s > bestS) {
            bestS = s;
            best = p;
          }
        }
      }
      if (!best) best = { v: RL.pick(POOL_MAJ), name: '' };
      recentDest.push(best.v);
      if (recentDest.length > 6) recentDest.shift();
      return best;
    }
    function newTargetRoute(ax, ay) {
      routeBias = [RL.range(0.9, 1.1), RL.range(0.9, 1.1), RL.range(0.92, 1.15), RL.range(0.95, 1.25)];
      for (let t = 0; t < 4; t++) {
        const d = pickDest(T.x, T.y, ax, ay);
        if (setRoute(T, d.v, true, routeBias) && T.steps.length > 1) {
          T.destName = d.name;
          break;
        }
      }
      T.conf = RL.int(71, 96);
    }
    function spawnUnits() {
      units = unitDefs.map((name, k) => {
        let start = -1;
        for (let t = 0; t < 120; t++) {
          const v = RL.pick(POOL_MAJ);
          const d = Math.hypot(vx(v) - T.x, vy(v) - T.y);
          if (d > 700 && d < 1700) {
            start = v;
            break;
          }
        }
        if (start < 0) start = RL.pick(POOL_MAJ);
        const u = makeAgent(start, 36);
        u.name = name;
        u.replanAt = 0;
        u.stunUntil = 0;
        u.k = k;
        u.role = k;
        u.standoff = [150, 210, 270, 330][k];
        u.dist = 1e9;
        return u;
      });
    }
    function planUnit(u) {
      let goal = endNode(T);
      if (T.frozen) goal = T.i < T.steps.length ? stepTo(T.steps[T.i]) : endNode(T);
      else if (u.role === 3) {
        // perimeter: patrol a node on a loose ring around the target
        for (let t = 0; t < 40; t++) {
          const v = RL.pick(POOL_MAJ);
          const d = Math.hypot(vx(v) - T.x, vy(v) - T.y);
          if (d > 450 && d < 950) {
            goal = v;
            break;
          }
        }
      } else if (u.role !== 1) {
        // intercept: the first node on WRAITH's route that this unit can reach first
        let acc = 0;
        for (let k = T.i; k < T.steps.length; k++) {
          acc += ELEN[T.steps[k] >> 1];
          if ((k - T.i) % 3) continue;
          const v = stepTo(T.steps[k]);
          if (Math.hypot(vx(v) - u.x, vy(v) - u.y) * 1.25 < acc * (u.role === 2 ? 0.7 : 0.95)) {
            goal = v;
            break;
          }
        }
      }
      setRoute(u, goal, false);
    }

    /* ======================================================== DOM + HUD */

    const cv = ctx.canvas({ className: 'map-cv' });
    const hud = U.el('div', 'map-hud');
    hud.innerHTML = `
      <div class="map-tgt">
        <div class="map-tgt-hd"><span class="map-k">TGT</span><b class="map-tgt-name">WRAITH</b><span class="map-lock"><i></i>LOCK</span></div>
        <div class="map-rows">
          <div class="map-row map-r-st"><span class="map-k">ST</span><span class="map-v" data-f="street">—</span></div>
          <div class="map-row map-r-dist"><span class="map-k">ARR</span><span class="map-v" data-f="district">—</span></div>
          <div class="map-row map-r-near"><span class="map-k">NEAR</span><span class="map-v" data-f="near">—</span></div>
          <div class="map-row map-r-spd"><span class="map-k">SPD</span><span class="map-v"><b data-f="speed">000</b> KM/H<span class="map-bar"><i data-f="bar"></i></span></span></div>
          <div class="map-row map-r-hdg"><span class="map-k">HDG</span><span class="map-v" data-f="heading">000° N</span></div>
          <div class="map-row map-r-ll"><span class="map-k">POS</span><span class="map-v" data-f="ll">—</span></div>
          <div class="map-row map-r-unit"><span class="map-k">NRST</span><span class="map-v" data-f="unit">—</span></div>
          <div class="map-row map-r-eta"><span class="map-k">ETA</span><span class="map-v map-v-eta" data-f="eta">—</span></div>
          <div class="map-row map-r-plate"><span class="map-k">PLT</span><span class="map-v" data-f="plate">░░-░░░-░░</span></div>
        </div>
      </div>
      <div class="map-status">
        <div class="map-s-main">
          <span class="map-s-sat">SAT <b>KH-9</b></span>
          <span class="map-s-gsd"><b data-f="gsd">3.4</b> M/PX</span>
          <span class="map-s-lock">LOCK <i class="map-dot"></i></span>
          <span class="map-s-frame">FRAME <b data-f="frame">000000</b></span>
          <span class="map-s-zoom">Z <b data-f="zoom">1.00X</b></span>
          <span class="map-s-grid">GRID <b data-f="grid">A-01</b></span>
          <span class="map-s-mode" data-f="mode">AUTO-TRACK</span>
          <span class="map-s-nodes">NODES <b>${NV}</b></span>
          <span class="map-s-cams">CAMS <b>${cams.length}</b></span>
          <span class="map-s-sig">SIG <b data-f="sig">-61</b> DBM</span>
        </div>
        <span class="map-s-osm">© OPENSTREETMAP CONTRIBUTORS</span>
      </div>
      <button class="map-recenter" type="button" data-hot hidden><i></i>RE-CENTER <span data-f="auto"></span></button>
      <div class="map-vig"></div>`;
    ctx.el.appendChild(hud);
    const F = {};
    hud.querySelectorAll('[data-f]').forEach((e) => (F[e.dataset.f] = e));
    const recBtn = hud.querySelector('.map-recenter');
    const setT = (el, v) => {
      if (el && el._v !== v) {
        el._v = v;
        el.textContent = v;
      }
    };

    /* ======================================================== tiles */

    let dpr = Math.min(2, window.devicePixelRatio || 1);
    let PPER = Math.max(4, Math.round(8 * dpr)); // hatch pattern period; divides TS so patterns never seam
    let TS = PPER * 32; // tile edge in device px (~256 css px)
    let TILE_CAP = 60;
    let gen = 0; // bumps when fonts load: tiles and label placements from before are stale
    // labels wait for the webfonts (placing them with fallback metrics is wasted work); a timer
    // covers pages where the fonts never arrive
    let labelsOn = !!HD.fontsReady || !document.fonts;
    const tiles = new Map();
    const tpool = [];
    let useStamp = 0;
    const tkey = (l, tx, ty) => ((l + 64) * 4096 + ty) * 4096 + tx;
    const lvScale = (l) => Math.pow(2, l / 4); // css px per metre at level l

    const MC = document.createElement('canvas').getContext('2d');
    const measCache = new Map();
    function measure(font, text) {
      const k = font + '|' + text;
      let w = measCache.get(k);
      if (w == null) {
        MC.font = font;
        w = MC.measureText(text).width;
        measCache.set(k, w);
      }
      return w;
    }

    let PAT = {};
    function makePatterns() {
      const P = PPER;
      const d = dpr;
      const mk = (fn) => {
        const c = document.createElement('canvas');
        c.width = c.height = P;
        fn(c.getContext('2d'), P);
        return MC.createPattern(c, 'repeat');
      };
      const diag = (s, n, col, w, flip) => {
        s.strokeStyle = col;
        s.lineWidth = w;
        s.beginPath();
        if (flip) {
          s.moveTo(-1, -1);
          s.lineTo(n + 1, n + 1);
          s.moveTo(n - 1, -1);
          s.lineTo(n + 1, 1);
          s.moveTo(-1, n - 1);
          s.lineTo(1, n + 1);
        } else {
          s.moveTo(-1, n + 1);
          s.lineTo(n + 1, -1);
          s.moveTo(-1, 1);
          s.lineTo(1, -1);
          s.moveTo(n - 1, n + 1);
          s.lineTo(n + 1, n - 1);
        }
        s.stroke();
      };
      PAT = {
        water: mk((s, n) => {
          s.fillStyle = 'rgba(43,182,214,0.2)';
          s.fillRect(0, 0, n, Math.max(1, 0.8 * d));
          s.fillStyle = 'rgba(43,182,214,0.11)';
          s.fillRect(0, n / 2, n, Math.max(1, 0.8 * d));
        }),
        park: mk((s, n) => diag(s, n, 'rgba(95,243,255,0.085)', 0.9 * d, false)),
        wood: mk((s, n) => {
          diag(s, n, 'rgba(95,243,255,0.075)', 0.9 * d, false);
          diag(s, n, 'rgba(43,182,214,0.06)', 0.8 * d, true);
        }),
        cemetery: mk((s, n) => {
          s.fillStyle = 'rgba(169,220,232,0.2)';
          const a = Math.max(1, Math.round(d));
          const c = n / 2;
          s.fillRect(c - a / 2, c - 2 * a, a, 4 * a);
          s.fillRect(c - 1.5 * a, c - a, 3 * a, a);
        }),
      };
    }

    // label styles; sizes in css px (tile text is drawn at css size × dpr)
    const LSTY = {
      peri: { f: (d) => FM(9.5 * d, 700), fc: FM(9.5, 700), ls: 1.2, h: 14, box: true },
      c1: { f: (d) => FM(10 * d, 600), fc: FM(10, 600), ls: 0.8, h: 12, fill: rgba('holo', 0.95) },
      c2: { f: (d) => FM(9.5 * d, 500), fc: FM(9.5, 500), ls: 0.5, h: 12, fill: rgba('holo', 0.78) },
      c3: { f: (d) => FM(9 * d, 500), fc: FM(9, 500), ls: 0.3, h: 11, fill: rgba('text', 0.6) },
      bridge: { f: (d) => FU(9 * d, 700), fc: FU(9, 700), ls: 1.2, h: 11, fill: rgba('ice', 0.88) },
      water: { f: (d) => FD(10 * d), fc: FD(10), ls: 6, h: 13, fill: rgba('holo2', 0.7) },
      canal: { f: (d) => FD(9 * d), fc: FD(9), ls: 3, h: 12, fill: rgba('holo2', 0.72) },
      wood: { f: (d) => FD(10.5 * d), fc: FD(10.5), ls: 5, h: 14, fill: rgba('holo', 0.36) },
      park: { f: (d) => FU(9 * d, 600), fc: FU(9, 600), ls: 1.5, h: 11, fill: rgba('holo2', 0.75) },
    };
    const textW = (sty, text) => measure(sty.fc, text) + sty.ls * text.length;
    const ABBR = [
      [/^BOULEVARD /, 'BD '],
      [/^AVENUE /, 'AV. '],
      [/^PLACE /, 'PL. '],
      [/^QUAI /, 'Q. '],
      [/^RUE /, 'R. '],
    ];
    const abbr = (t) => {
      for (const [re, s] of ABBR) if (re.test(t)) return t.replace(re, s);
      return t;
    };
    const NAME_AB = NAMES.map(abbr);
    // street label fonts are monospaced: width is a character count, no text measuring needed
    const monoCache = new Map();
    function monoW(sty, n) {
      let cw = monoCache.get(sty.fc);
      if (cw == null) {
        cw = measure(sty.fc, 'MMMMMMMMMM') / 10;
        monoCache.set(sty.fc, cw);
      }
      return n * (cw + sty.ls);
    }

    // fixed label candidates (world anchors): the Seine between bridges, canals, the Bois, big parks, bridges
    const FIXED = [];
    {
      // bridges: one anchor per named bridge over the water
      const br = new Map();
      for (let e = 0; e < NE; e++) {
        if (!(EFL[e] & F_BRIDGE) || !NAMES[ENAME[e]].startsWith('PONT ')) continue;
        const o = e * 4;
        const cx = (EBB[o] + EBB[o + 2]) / 2;
        const cy = (EBB[o + 1] + EBB[o + 3]) / 2;
        let b = br.get(ENAME[e]);
        if (!b) br.set(ENAME[e], (b = { x: 0, y: 0, n: 0, dx: 0, dy: 0, len: 0 }));
        b.x += cx;
        b.y += cy;
        b.n++;
        const ddx = ND[EB[e] * 2] - ND[EA[e] * 2];
        const ddy = ND[EB[e] * 2 + 1] - ND[EA[e] * 2 + 1];
        const sgn = ddx * b.dx + ddy * b.dy < 0 ? -1 : 1;
        b.dx += ddx * sgn;
        b.dy += ddy * sgn;
        b.len = Math.max(b.len, ELEN[e]);
      }
      const bridges = [];
      for (const [nid, b] of br) {
        const x = b.x / b.n;
        const y = b.y / b.n;
        if (!SEINE.some((w) => hitBB(w.bb, x, y, x, y) && pipRings(w.rings, x, y))) continue;
        let name = NAMES[nid].replace(/ - .*$/, '');
        bridges.push({ x, y, ang: Math.atan2(b.dy, b.dx), len: b.len, name });
      }
      for (const b of bridges) FIXED.push({ kind: 'bridge', x: b.x, y: b.y, ang: uprightAng(b.ang), text: b.name, blen: b.len, pri: 1.5, minS: 0.52 });
      // LA SEINE: midway between neighbouring bridges, along the chord between them
      const used = [];
      for (const a of bridges) {
        let best = null;
        let bd = 1e9;
        for (const b of bridges) {
          if (a === b) continue;
          const d = Math.hypot(b.x - a.x, b.y - a.y);
          if (d > 380 && d < 1300 && d < bd) {
            bd = d;
            best = b;
          }
        }
        if (!best) continue;
        const mx = (a.x + best.x) / 2;
        const my = (a.y + best.y) / 2;
        if (used.some((u) => Math.hypot(u[0] - mx, u[1] - my) < 300)) continue;
        if (!SEINE.some((w) => hitBB(w.bb, mx, my, mx, my) && pipRings(w.rings, mx, my))) continue;
        used.push([mx, my]);
        FIXED.push({ kind: 'water', x: mx, y: my, ang: uprightAng(Math.atan2(best.y - a.y, best.x - a.x)), text: 'LA SEINE', span: bd * 0.8, pri: -3, minS: 0.06 });
      }
      // canals and basins along their principal axis
      for (const w of WATER) {
        if (!w.name || (w.kind !== 'canal' && w.kind !== 'basin' && !w.name.startsWith('BASSIN'))) continue;
        if (w.name === 'BASSIN' || w.name.startsWith('FONTAINE') || w.name.startsWith('GRAND BASSIN') || w.name.startsWith('RÉSERVOIR') || w.name.startsWith('ÉCLUSE')) continue;
        const r = w.rings[0];
        const n = r.length / 2;
        let mx = 0;
        let my = 0;
        for (let i = 0; i < r.length; i += 2) {
          mx += r[i];
          my += r[i + 1];
        }
        mx /= n;
        my /= n;
        let sxx = 0;
        let syy = 0;
        let sxy = 0;
        for (let i = 0; i < r.length; i += 2) {
          const dx = r[i] - mx;
          const dy = r[i + 1] - my;
          sxx += dx * dx;
          syy += dy * dy;
          sxy += dx * dy;
        }
        const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
        let span = 0;
        for (let i = 0; i < r.length; i += 2) span = Math.max(span, Math.abs((r[i] - mx) * Math.cos(ang) + (r[i + 1] - my) * Math.sin(ang)));
        if (!pipRings(w.rings, mx, my)) continue;
        FIXED.push({ kind: 'canal', x: mx, y: my, ang: uprightAng(ang), text: w.name, span: span * 1.8, pri: -2, minS: 0.22 });
      }
      // parks: the Bois in display type, big named parks and cemeteries small
      for (const p of PARKS) {
        if (!p.name) continue;
        const cx = (p.bb[0] + p.bb[2]) / 2;
        const cy = (p.bb[1] + p.bb[3]) / 2;
        if (!pipRings(p.rings, cx, cy)) continue;
        const bw = p.bb[2] - p.bb[0];
        const bh = p.bb[3] - p.bb[1];
        if (p.kind === 'wood' && bw > 1500) FIXED.push({ kind: 'wood', x: cx, y: cy, ang: 0, text: p.name, bw, bh, pri: -2.5, minS: 0.03 });
        else if (bw * bh > 60000 && inParis(cx, cy)) FIXED.push({ kind: 'park', x: cx, y: cy, ang: 0, text: p.name, bw, bh, pri: 2.6, minS: 0.2 });
      }
    }

    // per-level label placement, filled one tile-cell at a time
    const LV = new Map();
    const CG = 40; // collision grid cell (device px)
    function lvState(l) {
      let L = LV.get(l);
      if (L) return L;
      const s = lvScale(l);
      L = { l, s, sd: s * dpr, cells: new Set(), grid: new Map(), byName: new Map(), cellLabels: new Map(), numW: null };
      LV.set(l, L);
      // obstacles: landmark glyphs and their default label slot, the small arrondissement names
      const d = dpr;
      for (const lm of LMK) {
        const X = lm.x * L.sd;
        const Y = lm.y * L.sd;
        addCircle(L, X, Y, 14 * d);
        const w = measure(U10, lm.name) + 14;
        for (let k = 12; k < w + 12; k += 10) addCircle(L, X + k * d, Y - 5 * d, 8 * d);
      }
      if (s >= 0.1) {
        for (const a of ARR) {
          const sz = arrNumSize(s);
          const X = a.lx * L.sd;
          const Y = (a.ly + (sz * 0.72) / s) * L.sd;
          const w = measure(FU(10, 600), a.sub) + a.sub.length * 3;
          for (let k = -w / 2; k <= w / 2; k += 10) addCircle(L, X + k * d, Y, 8 * d);
        }
      }
      return L;
    }
    function addCircle(L, x, y, r) {
      const k = Math.floor(y / CG) * 1e6 + Math.floor(x / CG);
      let a = L.grid.get(k);
      if (!a) L.grid.set(k, (a = []));
      a.push(x, y, r);
    }
    function hitCircle(L, x, y, r) {
      const reach = r + 16 * dpr;
      const i0 = Math.floor((x - reach) / CG);
      const i1 = Math.floor((x + reach) / CG);
      const j0 = Math.floor((y - reach) / CG);
      const j1 = Math.floor((y + reach) / CG);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const a = L.grid.get(j * 1e6 + i);
          if (!a) continue;
          for (let k = 0; k < a.length; k += 3) {
            const dx = a[k] - x;
            const dy = a[k + 1] - y;
            const rr = a[k + 2] + r;
            if (dx * dx + dy * dy < rr * rr) return true;
          }
        }
      }
      return false;
    }
    // walk a label's axis as a chain of circles; test or claim them
    function labelCircles(L, X, Y, ang, w, h, claim) {
      const r = (h / 2 + 2) * dpr;
      const hl = Math.max(0, (w / 2 + 3) * dpr - r);
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      const n = Math.max(1, Math.ceil((2 * hl) / (r * 1.3)));
      for (let k = 0; k <= n; k++) {
        const t = -hl + (2 * hl * k) / n;
        if (claim) addCircle(L, X + c * t, Y + s * t, r);
        else if (hitCircle(L, X + c * t, Y + s * t, r)) return false;
      }
      return true;
    }
    function tryPlace(L, cand, cellKey) {
      const sty = LSTY[cand.st];
      const X = cand.x * L.sd;
      const Y = cand.y * L.sd;
      const ext = (cand.w / 2 + 8) * dpr;
      if (ext > TS * 0.95) return false;
      if (cand.key != null) {
        const prev = L.byName.get(cand.key);
        if (prev) {
          const gap = (cand.w + 320) * dpr;
          for (let k = 0; k < prev.length; k += 2) if (Math.hypot(prev[k] - X, prev[k + 1] - Y) < gap) return false;
        }
      }
      if (!labelCircles(L, X, Y, cand.ang, cand.w, sty.h, false)) return false;
      labelCircles(L, X, Y, cand.ang, cand.w, sty.h, true);
      if (cand.key != null) {
        let prev = L.byName.get(cand.key);
        if (!prev) L.byName.set(cand.key, (prev = []));
        prev.push(X, Y);
      }
      let list = L.cellLabels.get(cellKey);
      if (!list) L.cellLabels.set(cellKey, (list = []));
      list.push({ X, Y, ang: cand.ang, text: cand.text, st: cand.st, w: cand.w, ext });
      return true;
    }
    const clsStyle = ['peri', 'c1', 'c2', 'c3'];
    const clsMinS = [0.05, 0.12, 0.2, 0.27];
    const runSeen = new Uint32Array(CHAINS.length);
    let runRun = 0;
    function ensureCell(L, cx, cy) {
      const ck = cy * 4096 + cx;
      if (L.cells.has(ck)) return;
      L.cells.add(ck);
      const cw = TS / L.sd;
      const x0 = cx * cw;
      const y0 = cy * cw;
      const x1 = x0 + cw;
      const y1 = y0 + cw;
      if (x1 < 0 || y1 < 0 || x0 > W || y0 > H) return;
      const s = L.s;
      const cands = [];
      const inCell = (x, y) => x >= x0 && x < x1 && y >= y0 && y < y1;
      for (const f of FIXED) {
        if (s < f.minS || !inCell(f.x, f.y)) continue;
        const sty = LSTY[f.kind];
        let text = f.text;
        let w = textW(sty, text);
        let ang = f.ang;
        if (f.kind === 'water' || f.kind === 'canal') {
          if (w / s > f.span) continue;
        } else if (f.kind === 'bridge') {
          if (w / s > f.blen * 1.1) ang = 0;
        } else if (f.kind === 'wood' || f.kind === 'park') {
          if (w / s > f.bw * 0.85 || (sty.h + 4) / s > f.bh * 0.8) {
            if (f.kind === 'park') continue;
            text = f.text.replace(/^BOIS DE /, 'BOIS ');
            w = textW(sty, text);
            if (w / s > f.bw) continue;
          }
        }
        cands.push({ x: f.x, y: f.y, ang, text, st: f.kind, w, pri: f.pri, key: f.kind === 'water' ? -1 : null, len: 0 });
      }
      if (s >= clsMinS[0]) {
        runRun++;
        const n = queryEdges(x0, y0, x1, y1);
        for (let k = 0; k < n; k++) {
          const ri = CHAIN_OF[qBuf[k]];
          if (runSeen[ri] === runRun) continue;
          runSeen[ri] = runRun;
          const r = CHAINS[ri];
          if (!r.name || r.tun || s < clsMinS[r.cls] || (r.cls === 0 && r.name !== PERI && s < 0.14)) continue;
          if (r.br && s < 0.5) continue;
          const sty = LSTY[clsStyle[r.cls]];
          let text = NAMES[r.name];
          let w = monoW(sty, text.length);
          if ((w + 18) / s > r.len * 0.95) {
            text = NAME_AB[r.name];
            w = monoW(sty, text.length);
          }
          const Lm = (w + 18) / s;
          if (Lm > r.len * 0.95) continue;
          const p = chainPoly(r);
          const step = Math.max(Lm * 2.4, 560 / s);
          const cnt = Math.max(1, Math.floor((r.len - Lm) / step) + 1);
          const start = (r.len - (cnt - 1) * step) / 2;
          for (let j = 0; j < cnt; j++) {
            for (const shift of [0, 0.3, -0.3]) {
              const t = start + j * step + shift * Lm;
              if (t - Lm / 2 < 0 || t + Lm / 2 > r.len) continue;
              const a = polyAt(p, t - Lm / 2);
              const ax = a.x;
              const ay = a.y;
              const ia = a.i;
              const b = polyAt(p, t + Lm / 2);
              const ib = b.i;
              const chx = b.x - ax;
              const chy = b.y - ay;
              const cl = Math.hypot(chx, chy);
              if (cl < Lm * 0.9) continue;
              const mx = (ax + b.x) / 2;
              const my = (ay + b.y) / 2;
              if (!inCell(mx, my)) continue;
              let ok = true;
              const tol = 2.4 / s;
              for (let q = ia + 1; q <= ib; q++) {
                const dev = Math.abs(((p.pts[q * 2] - ax) * chy - (p.pts[q * 2 + 1] - ay) * chx) / cl);
                if (dev > tol) {
                  ok = false;
                  break;
                }
              }
              if (!ok) continue;
              cands.push({ x: mx, y: my, ang: uprightAng(Math.atan2(chy, chx)), text, st: clsStyle[r.cls], w, pri: r.cls + (ICON[r.e0] ? -0.4 : 0) - Math.min(0.3, r.len / 20000), key: r.name, len: r.len });
              break;
            }
          }
        }
      }
      cands.sort((a, b) => a.pri - b.pri);
      for (const c of cands) tryPlace(L, c, ck);
    }
    const arrNumSize = (s) => U.clamp(s * 560, 30, 190);

    function allocTile() {
      const c = tpool.pop() || document.createElement('canvas');
      if (c.width !== TS) c.width = c.height = TS;
      return c;
    }
    function evict() {
      while (tiles.size > TILE_CAP) {
        let old = null;
        for (const t of tiles.values()) if (t.used < useStamp && (!old || t.used < old.used)) old = t;
        if (!old) return;
        tiles.delete(old.key);
        if (tpool.length < 6) tpool.push(old.c);
      }
    }
    function flushTiles() {
      tiles.clear();
      tpool.length = 0;
      LV.clear();
      sprites.clear();
    }

    // one static tile: land, parks, water, arrondissements, rail, roads, boundary, labels
    function renderTile(t) {
      const c = t.c;
      const g = c.getContext('2d', { alpha: false });
      const sd = t.sd;
      const s = sd / dpr;
      const d = dpr;
      const ox = t.tx * TS;
      const oy = t.ty * TS;
      const wx0 = ox / sd;
      const wy0 = oy / sd;
      const wx1 = (ox + TS) / sd;
      const wy1 = (oy + TS) / sd;
      const m = (24 * d) / sd;
      const qx0 = wx0 - m;
      const qy0 = wy0 - m;
      const qx1 = wx1 + m;
      const qy1 = wy1 + m;
      const lw = U.clamp(Math.pow(s / 0.3, 0.3), 0.72, 1.4) * d;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
      g.setLineDash([]);
      g.lineJoin = 'round';
      g.lineCap = 'round';
      g.fillStyle = LAND;
      g.fillRect(0, 0, TS, TS);
      if (wx0 > W || wy0 > H || wx1 < 0 || wy1 < 0) {
        g.fillStyle = VOID;
        g.fillRect(0, 0, TS, TS);
        t.gen = gen;
        t.lab = labelsOn;
        return;
      }
      const ring = (r, close) => {
        g.moveTo(r[0] * sd - ox, r[1] * sd - oy);
        for (let i = 2; i < r.length; i += 2) g.lineTo(r[i] * sd - ox, r[i + 1] * sd - oy);
        if (close) g.closePath();
      };

      // parks, woods, cemeteries
      for (const kind of ['wood', 'park', 'cemetery']) {
        g.beginPath();
        let any = false;
        for (const p of PARKS) {
          if (p.kind !== kind || !hitBB(p.bb, qx0, qy0, qx1, qy1)) continue;
          for (const r of p.rings) ring(r, true);
          any = true;
        }
        if (!any) continue;
        g.fillStyle = kind === 'cemetery' ? 'rgba(169,220,232,0.035)' : kind === 'wood' ? 'rgba(43,182,214,0.05)' : 'rgba(43,182,214,0.04)';
        g.fill();
        g.fillStyle = PAT[kind];
        g.fill();
        g.lineWidth = 0.8 * d;
        if (kind === 'cemetery') {
          g.strokeStyle = 'rgba(169,220,232,0.2)';
          g.stroke();
        } else {
          g.setLineDash([3 * d, 3 * d]);
          g.strokeStyle = rgba('holo2', kind === 'wood' ? 0.3 : 0.26);
          g.stroke();
          g.setLineDash([]);
        }
      }

      // water: near-black, hatched, with bright banks
      {
        g.beginPath();
        let any = false;
        for (const w of WATER) {
          if (!hitBB(w.bb, qx0, qy0, qx1, qy1)) continue;
          for (const r of w.rings) ring(r, true);
          any = true;
        }
        if (any) {
          g.fillStyle = WATER_C;
          g.fill();
          g.fillStyle = PAT.water;
          g.fill();
          // banks: a deep-blue glow and a bright rim, a different family from the cyan roads
          g.strokeStyle = 'rgba(43,140,214,0.22)';
          g.lineWidth = 6 * d;
          g.stroke();
          g.strokeStyle = 'rgba(120,200,255,0.85)';
          g.lineWidth = 1.1 * d;
          g.stroke();
        }
      }

      // arrondissement stencil numerals (under everything else)
      if (s >= 0.035) {
        const sz = arrNumSize(s) * d;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.font = FD(sz);
        g.letterSpacing = `${sz * 0.06}px`;
        for (const a of ARR) {
          const X = a.lx * sd - ox;
          const Y = a.ly * sd - oy;
          const w = measure(FD(arrNumSize(s)), a.num) * d + sz * 0.06 * a.num.length;
          if (X + w / 2 < -4 || X - w / 2 > TS + 4 || Y + sz < -4 || Y - sz > TS + 4) continue;
          g.save();
          g.beginPath();
          const top = Y - sz * 0.55;
          const step = Math.max(4, sz * 0.055);
          for (let yy = top; yy < Y + sz * 0.55; yy += step) g.rect(X - w / 2 - 8, yy, w + 16, step * 0.62);
          g.clip();
          g.fillStyle = 'rgba(95,243,255,0.075)';
          g.fillText(a.num, X, Y);
          g.restore();
          g.strokeStyle = 'rgba(95,243,255,0.13)';
          g.lineWidth = d;
          g.strokeText(a.num, X, Y);
        }
        g.letterSpacing = '0px';
      }

      // arrondissement borders
      if (s >= 0.035) {
        g.beginPath();
        for (const a of ARR) if (hitBB(a.bb, qx0, qy0, qx1, qy1)) for (const r of a.rings) ring(r, true);
        g.setLineDash([6 * d, 5 * d]);
        g.strokeStyle = rgba('holo', 0.2);
        g.lineWidth = 0.9 * d;
        g.stroke();
        g.setLineDash([]);
      }

      // surface rail
      if (s >= 0.06) {
        g.beginPath();
        let any = false;
        for (const r of RAIL) {
          if (!hitBB(r.bb, qx0, qy0, qx1, qy1)) continue;
          ring(r.pts, false);
          any = true;
        }
        if (any) {
          g.setLineDash([4 * d, 3 * d]);
          g.lineCap = 'butt';
          g.strokeStyle = rgba('neon', s >= 0.2 ? 0.34 : 0.24);
          g.lineWidth = 0.9 * d;
          g.stroke();
          g.setLineDash([]);
          g.lineCap = 'round';
        }
      }

      // roads beyond the routable area
      for (const cls of [1, 0]) {
        g.beginPath();
        let any = false;
        for (const cx of CONTEXT) {
          if (cx.cls !== cls || !hitBB(cx.bb, qx0, qy0, qx1, qy1)) continue;
          ring(cx.pts, false);
          any = true;
        }
        if (!any) continue;
        g.strokeStyle = rgba('holo', cls ? 0.3 : 0.5);
        g.lineWidth = (cls ? 1 : 1.6) * lw;
        g.stroke();
      }

      // the street graph by class, bridges and tunnels
      const n = queryEdges(qx0, qy0, qx1, qy1);
      const edgePath = (e) => {
        g.moveTo(ND[EA[e] * 2] * sd - ox, ND[EA[e] * 2 + 1] * sd - oy);
        for (let k = EG0[e], k1 = EG0[e] + EGN[e]; k < k1; k++) g.lineTo(GM[k * 2] * sd - ox, GM[k * 2 + 1] * sd - oy);
        g.lineTo(ND[EB[e] * 2] * sd - ox, ND[EB[e] * 2 + 1] * sd - oy);
      };
      const pathOf = (test) => {
        g.beginPath();
        let any = false;
        for (let k = 0; k < n; k++) {
          const e = qBuf[k];
          if (!test(e)) continue;
          edgePath(e);
          any = true;
        }
        return any;
      };
      const show3 = s >= 0.07;
      const a3 = s >= 0.5 ? 0.32 : s >= 0.2 ? 0.24 : 0.13;
      // tunnels: dashed ghosts underneath
      if (pathOf((e) => EFL[e] & F_TUNNEL && (show3 || ECLS[e] < 3))) {
        g.setLineDash([3 * d, 3 * d]);
        g.lineCap = 'butt';
        g.strokeStyle = rgba('holo', 0.3);
        g.lineWidth = lw;
        g.stroke();
        g.setLineDash([]);
        g.lineCap = 'round';
      }
      // bridge decks: bright rails either side of a dark deck, over the water
      if (s >= 0.1 && pathOf((e) => EFL[e] & F_BRIDGE && !(EFL[e] & F_TUNNEL) && (show3 || ECLS[e] < 3))) {
        g.lineCap = 'butt';
        g.strokeStyle = rgba('holo', 0.75);
        g.lineWidth = 6.5 * lw;
        g.stroke();
        g.strokeStyle = '#04121b';
        g.lineWidth = 4.3 * lw;
        g.stroke();
        g.lineCap = 'round';
      }
      // up close, every street gets a translucent surface at its real-world width
      if (s >= 0.45) {
        g.lineCap = 'butt';
        for (const [cls, wm, a] of [
          [3, 9, 0.05],
          [2, 14, 0.06],
          [1, 20, 0.07],
          [0, 16, 0.07],
        ]) {
          if (!pathOf((e) => ECLS[e] === cls && !(EFL[e] & F_TUNNEL))) continue;
          g.strokeStyle = rgba('holo', a);
          g.lineWidth = wm * sd;
          g.stroke();
        }
        g.lineCap = 'round';
      }
      if (show3 && pathOf((e) => ECLS[e] === 3 && !(EFL[e] & F_TUNNEL))) {
        g.strokeStyle = rgba('holo', a3);
        g.lineWidth = (s >= 0.5 ? 1.1 : 1) * lw;
        g.stroke();
      }
      if (pathOf((e) => ECLS[e] === 2 && !(EFL[e] & F_TUNNEL))) {
        if (s >= 0.12) {
          g.strokeStyle = rgba('holo', 0.07);
          g.lineWidth = 3.6 * lw;
          g.stroke();
        }
        g.strokeStyle = rgba('holo', s >= 0.12 ? 0.52 : 0.3);
        g.lineWidth = 1.2 * lw;
        g.stroke();
      }
      if (pathOf((e) => ECLS[e] === 1 && !(EFL[e] & F_TUNNEL))) {
        g.strokeStyle = rgba('holo2', 0.12);
        g.lineWidth = 6 * lw;
        g.stroke();
        g.strokeStyle = rgba('holo', s >= 0.12 ? 0.8 : 0.55);
        g.lineWidth = 1.6 * lw;
        g.stroke();
      }
      if (pathOf((e) => ECLS[e] === 0 && !(EFL[e] & F_TUNNEL))) {
        g.strokeStyle = rgba('holo', 0.09);
        g.lineWidth = 10 * lw;
        g.stroke();
        g.strokeStyle = rgba('ice', 0.95);
        g.lineWidth = (s >= 0.14 ? 3.6 : 2.4) * lw;
        g.stroke();
        if (s >= 0.14) {
          g.strokeStyle = '#03141d';
          g.lineWidth = 1.5 * lw;
          g.stroke();
        }
      }

      // the city limit, then everything outside it pushed back into the dark
      if (hitBB(BOUND_BB, qx0 - 2000, qy0 - 2000, qx1 + 2000, qy1 + 2000)) {
        g.beginPath();
        for (const r of BOUND) ring(r, true);
        g.strokeStyle = rgba('holo', 0.1);
        g.lineWidth = 6 * d;
        g.stroke();
        g.setLineDash([10 * d, 5 * d]);
        g.strokeStyle = rgba('holo', 0.62);
        g.lineWidth = 1.2 * d;
        g.stroke();
        g.setLineDash([]);
        g.rect(0, 0, TS, TS);
        g.fillStyle = 'rgba(1,3,7,0.46)';
        g.fill('evenodd');
      }

      // arrondissement names under the numerals
      if (s >= 0.1) {
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.font = FU(10 * d, 600);
        g.letterSpacing = `${3 * d}px`;
        g.lineJoin = 'round';
        for (const a of ARR) {
          const X = a.lx * sd - ox + 1.5 * d;
          const Y = (a.ly + (arrNumSize(s) * 0.72) / s) * sd - oy;
          if (X < -200 * d || X > TS + 200 * d || Y < -20 * d || Y > TS + 20 * d) continue;
          g.strokeStyle = HALO;
          g.lineWidth = 3 * d;
          g.strokeText(a.sub, X, Y);
          g.fillStyle = 'rgba(169,220,232,0.5)';
          g.fillText(a.sub, X, Y);
        }
        g.letterSpacing = '0px';
      }

      t.gen = gen;
      t.lab = labelsOn;
      if (!labelsOn) return;
      // labels placed for this level; the 3×3 neighbourhood covers every label that can reach us
      const L = lvState(t.l);
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) ensureCell(L, t.tx + i, t.ty + j);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineJoin = 'round';
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          const list = L.cellLabels.get((t.ty + j) * 4096 + t.tx + i);
          if (!list) continue;
          for (const lb of list) {
            const X = lb.X - ox;
            const Y = lb.Y - oy;
            if (X + lb.ext < 0 || X - lb.ext > TS || Y + lb.ext < 0 || Y - lb.ext > TS) continue;
            drawLabel(g, lb, X, Y);
          }
        }
      }
    }
    // Rotated glyphs rasterize from outlines (slow); an upright sprite drawn rotated is a bitmap op.
    const sprites = new Map();
    const HX = [1, 0.7, 0, -0.7, -1, -0.7, 0, 0.7];
    const HY = [0, 0.7, 1, 0.7, 0, -0.7, -1, -0.7];
    function labelSprite(lb) {
      const key = lb.st + '|' + lb.text;
      let c = sprites.get(key);
      if (c) {
        sprites.delete(key);
        sprites.set(key, c);
        return c;
      }
      const sty = LSTY[lb.st];
      const d = dpr;
      c = document.createElement('canvas');
      c.width = Math.ceil((lb.w + (sty.box ? 16 : 10)) * d);
      c.height = Math.ceil((sty.h + 6) * d);
      const g = c.getContext('2d');
      g.translate(c.width / 2, c.height / 2);
      g.font = sty.f(d);
      g.letterSpacing = `${sty.ls * d}px`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineJoin = 'round';
      const tx = (sty.ls * d) / 2;
      if (sty.box) {
        const w = lb.w * d + 12 * d;
        g.fillStyle = '#021018';
        g.fillRect(-w / 2, -7 * d, w, 14 * d);
        g.strokeStyle = rgba('holo', 0.9);
        g.lineWidth = d;
        g.strokeRect(-w / 2 + 0.5, -7 * d + 0.5, w - 1, 14 * d - 1);
        g.fillStyle = C.ice;
        g.fillText(lb.text, tx, 0.5 * d);
      } else {
        if (lb.st !== 'water' && lb.st !== 'wood' && lb.st !== 'canal') {
          // a soft band so the road line does not read through the gaps between words
          g.fillStyle = 'rgba(2,6,11,0.5)';
          g.fillRect((-lb.w / 2 - 2) * d, (-sty.h / 2 + 1.5) * d, (lb.w + 4) * d, (sty.h - 3) * d);
        }
        // halo from offset copies: glyph-cached fills are far cheaper than stroking outlines
        g.fillStyle = HALO;
        const o = (lb.st === 'water' || lb.st === 'wood' ? 1.8 : 1.4) * d;
        for (let k = 0; k < 8; k++) g.fillText(lb.text, tx + HX[k] * o, HY[k] * o);
        g.fillStyle = sty.fill;
        g.fillText(lb.text, tx, 0);
      }
      sprites.set(key, c);
      if (sprites.size > 800) sprites.delete(sprites.keys().next().value);
      return c;
    }
    function drawLabel(g, lb, X, Y) {
      const c = labelSprite(lb);
      if (Math.abs(lb.ang) < 0.01) {
        g.drawImage(c, Math.round(X - c.width / 2), Math.round(Y - c.height / 2));
        return;
      }
      g.save();
      g.translate(X, Y);
      g.rotate(lb.ang);
      g.drawImage(c, -c.width / 2, -c.height / 2);
      g.restore();
    }

    // low-res whole-world backdrop: the fallback under any tile that is not ready yet
    const wb = document.createElement('canvas');
    let wbS = 0;
    function renderBackdrop() {
      wbS = Math.min(0.06, 1400 / W);
      wb.width = Math.ceil(W * wbS);
      wb.height = Math.ceil(H * wbS);
      const g = wb.getContext('2d', { alpha: false });
      const s = wbS;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = LAND;
      g.fillRect(0, 0, wb.width, wb.height);
      g.lineJoin = 'round';
      const ring = (r, close) => {
        g.moveTo(r[0] * s, r[1] * s);
        for (let i = 2; i < r.length; i += 2) g.lineTo(r[i] * s, r[i + 1] * s);
        if (close) g.closePath();
      };
      g.beginPath();
      for (const p of PARKS) for (const r of p.rings) ring(r, true);
      g.fillStyle = 'rgba(43,182,214,0.06)';
      g.fill();
      g.beginPath();
      for (const w of WATER) for (const r of w.rings) ring(r, true);
      g.fillStyle = WATER_C;
      g.fill();
      g.strokeStyle = rgba('holo', 0.45);
      g.lineWidth = 0.7;
      g.stroke();
      for (const cls of [2, 1, 0]) {
        g.beginPath();
        for (let e = 0; e < NE; e++) {
          if (ECLS[e] !== cls) continue;
          g.moveTo(ND[EA[e] * 2] * s, ND[EA[e] * 2 + 1] * s);
          for (let k = EG0[e], k1 = EG0[e] + EGN[e]; k < k1; k++) g.lineTo(GM[k * 2] * s, GM[k * 2 + 1] * s);
          g.lineTo(ND[EB[e] * 2] * s, ND[EB[e] * 2 + 1] * s);
        }
        g.strokeStyle = rgba('holo', [0.9, 0.5, 0.28][cls]);
        g.lineWidth = [1.4, 0.8, 0.6][cls];
        g.stroke();
      }
      g.beginPath();
      for (const r of BOUND) ring(r, true);
      g.rect(0, 0, wb.width, wb.height);
      g.fillStyle = 'rgba(1,3,7,0.46)';
      g.fill('evenodd');
    }

    // overview inset: city silhouette, the Seine, the Périphérique
    const thumb = document.createElement('canvas');
    let thumbW = 0;
    let thumbH = 0;
    function renderThumb(w) {
      thumbW = w;
      thumbH = Math.round((w * H) / W);
      thumb.width = Math.round(thumbW * dpr);
      thumb.height = Math.round(thumbH * dpr);
      const g = thumb.getContext('2d');
      const s = (thumbW * dpr) / W;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, thumb.width, thumb.height);
      g.lineJoin = 'round';
      const ring = (r) => {
        g.moveTo(r[0] * s, r[1] * s);
        for (let i = 2; i < r.length; i += 2) g.lineTo(r[i] * s, r[i + 1] * s);
        g.closePath();
      };
      g.beginPath();
      for (const r of BOUND) ring(r);
      g.fillStyle = '#05161f';
      g.fill();
      g.strokeStyle = rgba('holo', 0.55);
      g.lineWidth = dpr;
      g.stroke();
      g.beginPath();
      for (const a of ARR) for (const r of a.rings) ring(r);
      g.strokeStyle = rgba('holo', 0.12);
      g.lineWidth = 0.7 * dpr;
      g.stroke();
      g.beginPath();
      for (const p of PARKS) if (p.kind === 'wood') for (const r of p.rings) ring(r);
      g.fillStyle = 'rgba(43,182,214,0.14)';
      g.fill();
      g.beginPath();
      for (const w of WATER) if (w.kind === 'river' || w.kind === 'canal') for (const r of w.rings) ring(r);
      g.fillStyle = '#2bb6d6';
      g.globalAlpha = 0.75;
      g.fill();
      g.globalAlpha = 1;
      g.beginPath();
      for (let e = 0; e < NE; e++) {
        if (ECLS[e] !== 1) continue;
        g.moveTo(ND[EA[e] * 2] * s, ND[EA[e] * 2 + 1] * s);
        g.lineTo(ND[EB[e] * 2] * s, ND[EB[e] * 2 + 1] * s);
      }
      g.strokeStyle = rgba('holo', 0.2);
      g.lineWidth = 0.6 * dpr;
      g.stroke();
      g.beginPath();
      for (let e = 0; e < NE; e++) {
        if (ENAME[e] !== PERI) continue;
        g.moveTo(ND[EA[e] * 2] * s, ND[EA[e] * 2 + 1] * s);
        for (let k = EG0[e], k1 = EG0[e] + EGN[e]; k < k1; k++) g.lineTo(GM[k * 2] * s, GM[k * 2 + 1] * s);
        g.lineTo(ND[EB[e] * 2] * s, ND[EB[e] * 2 + 1] * s);
      }
      g.strokeStyle = C.ice;
      g.lineWidth = 1.1 * dpr;
      g.stroke();
    }

    /* ---- sprites */

    function sprite(size, fn) {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      fn(c.getContext('2d'), size);
      return c;
    }
    const glowRed = sprite(128, (s, n) => {
      const gr = s.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
      gr.addColorStop(0, 'rgba(255,60,80,0.95)');
      gr.addColorStop(0.16, 'rgba(255,35,64,0.5)');
      gr.addColorStop(0.45, 'rgba(255,35,64,0.13)');
      gr.addColorStop(1, 'rgba(255,35,64,0)');
      s.fillStyle = gr;
      s.fillRect(0, 0, n, n);
    });
    const glowCyan = sprite(64, (s, n) => {
      const gr = s.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
      gr.addColorStop(0, 'rgba(95,243,255,0.8)');
      gr.addColorStop(0.3, 'rgba(95,243,255,0.2)');
      gr.addColorStop(1, 'rgba(95,243,255,0)');
      s.fillStyle = gr;
      s.fillRect(0, 0, n, n);
    });
    const sweepSpr = sprite(256, (s, n) => {
      const wedge = 0.95;
      const gr = s.createConicGradient(-wedge, n / 2, n / 2);
      gr.addColorStop(0, 'rgba(95,243,255,0)');
      gr.addColorStop(wedge / TAU, 'rgba(95,243,255,0.26)');
      gr.addColorStop(wedge / TAU + 0.001, 'rgba(95,243,255,0)');
      gr.addColorStop(1, 'rgba(95,243,255,0)');
      s.fillStyle = gr;
      s.beginPath();
      s.arc(n / 2, n / 2, n / 2, 0, TAU);
      s.fill();
    });
    let roseSpr = null;
    let roseR = 0;
    function buildRose(r, d) {
      roseR = r;
      const pad = 14;
      const n = Math.ceil((r + pad) * 2 * d);
      roseSpr = sprite(n, (s) => {
        s.scale(d, d);
        const c = r + pad;
        s.translate(c, c);
        s.fillStyle = 'rgba(2,8,14,0.72)';
        s.beginPath();
        s.arc(0, 0, r + 2, 0, TAU);
        s.fill();
        s.strokeStyle = rgba('holo', 0.55);
        s.lineWidth = 1;
        s.beginPath();
        s.arc(0, 0, r, 0, TAU);
        s.stroke();
        s.strokeStyle = rgba('holo', 0.22);
        s.beginPath();
        s.arc(0, 0, r * 0.62, 0, TAU);
        s.stroke();
        s.beginPath();
        for (let a = 0; a < 72; a++) {
          const t = (a / 72) * TAU;
          const l = a % 18 === 0 ? 7 : a % 6 === 0 ? 4.5 : 2.2;
          s.moveTo(Math.sin(t) * r, -Math.cos(t) * r);
          s.lineTo(Math.sin(t) * (r - l), -Math.cos(t) * (r - l));
        }
        s.strokeStyle = rgba('holo', 0.7);
        s.stroke();
        s.fillStyle = rgba('holo', 0.14);
        s.strokeStyle = rgba('holo', 0.5);
        for (let k = 0; k < 4; k++) {
          s.save();
          s.rotate((k * Math.PI) / 2);
          s.beginPath();
          s.moveTo(0, -r * 0.6);
          s.lineTo(r * 0.1, -r * 0.1);
          s.lineTo(-r * 0.1, -r * 0.1);
          s.closePath();
          s.fill();
          s.stroke();
          s.restore();
        }
        s.font = FU(Math.max(9, Math.round(r * 0.3)), 700);
        s.textAlign = 'center';
        s.textBaseline = 'middle';
        const lr = r + 8;
        s.fillStyle = C.threat;
        s.fillText('N', 0, -lr);
        s.fillStyle = C.text;
        s.fillText('S', 0, lr);
        s.fillText('E', lr, 0);
        s.fillText('W', -lr, 0);
      });
    }

    /* ======================================================== view state */

    let Wd = cv.w;
    let Hd = cv.h;
    let mode = 'L';
    const rulerT = 14; // top ruler height
    const rulerL = 18; // left ruler width
    let navBox = { x0: 0, y0: 0, x1: 0, y1: 0 };
    let zones = [];
    let tgtBox = null;
    let telem = null; // bottom-left telemetry block, when it has room
    let band = 14; // lowest HUD edge over the middle of the view
    let hudK = 1; // HUD modules grow a notch on very large bodies
    // where the target rests on screen (below the HUD when the HUD spans the middle), and the box the
    // look-ahead may push it around in
    let anc = { x: 0, y: 0, x0: 0, y0: 0, x1: 0, y1: 0 };
    const tagP = { bx: 0, by: 0, w: 0, h: 0, sx: 1, sy: -1 };
    let lvDef = -7; // default zoom level for this panel size (quarter octaves)
    let kMin = -6;
    let kMax = 4;
    let baseK = 0; // user's zoom stop, relative to the default
    let zl = -7; // continuous zoom level actually shown
    let zoom = lvScale(zl);
    let camX = T.x;
    let camY = T.y;
    let follow = true;
    let drag = null;
    let lastUser = -1e9;
    let punch = null;
    let nextPunch = performance.now() + (RM ? 1e12 : RL.range(9000, 14000));
    let phase = ctx.state.phase || 'elevated';
    let sweepA = 0;
    let frame = RL.int(1000, 9000);
    let glitchAt = -1e9;
    let reacqAt = -1e9;
    let zeroAt = -1e9;
    let lastEmit = 0;
    let lastHud = 0;
    let lastCamEmit = -1e9;
    let lastAlert = -1e9;
    let lastStreetAlert = -1e9;
    let lastLmAlert = -1e9;
    let lastLmName = '';
    let etaS = 0;
    let lastMeta = '';
    let simT = 0;
    let unitAlertArmed = true;
    let plateTxt = ST.target.plateRevealed ? ST.target.plate : '░░-░░░-░░';
    let nearLm = null;
    let nearD = 1e9;
    let firstTick = true;
    let clockTxt = '';
    let clockAt = 0;
    const glitchBands = [];
    const tzTag = HD.tz ? (HD.tz.offset === 2 ? 'CEST' : HD.tz.offset === 1 ? 'CET' : `UTC${HD.tz.offset >= 0 ? '+' : ''}${HD.tz.offset}`) : 'CET';
    const tzOff = HD.tz ? HD.tz.offset : 1;

    function alertOnce(level, msg, gap = 7000) {
      const now = performance.now();
      if (now - lastAlert < gap) return false;
      lastAlert = now;
      ctx.alert(level, msg);
      return true;
    }

    function respawn() {
      let best = -1;
      for (let t = 0; t < 80; t++) {
        const p = RL.pick(POOL_AX.length ? POOL_AX : POOL_LM);
        const d = Math.hypot(vx(p.v) - T.x, vy(p.v) - T.y);
        if (d > 1400 && Math.hypot(vx(p.v) - CENTER[0], vy(p.v) - CENTER[1]) < 3200) {
          best = p.v;
          break;
        }
      }
      if (best < 0) best = pickStart();
      T.steps = [];
      T.v0 = best;
      T.i = 0;
      T.s = 0;
      T.frozen = false;
      T.periLeg = 0;
      place(T);
      resetTrail(T);
      newTargetRoute();
      spawnUnits();
      for (const u of units) planUnit(u);
    }

    newTargetRoute();
    spawnUnits();
    for (const u of units) planUnit(u);
    camX = T.x;
    camY = T.y;

    function startPunch(now) {
      if (punch || RM || !follow || T.frozen) return;
      const to = Math.min(kMax, baseK + 3);
      if (to <= baseK) return;
      punch = { t0: now, ain: 0.75, hold: 2.4, aout: 0.9, to, e: 0 };
    }
    function punchE(now) {
      if (!punch) return 0;
      const t = (now - punch.t0) / 1000;
      const p = punch;
      let e;
      if (t < p.ain) e = U.ease.outCubic(t / p.ain);
      else if (t < p.ain + p.hold) e = 1;
      else if (t < p.ain + p.hold + p.aout) e = 1 - U.ease.inOutCubic((t - p.ain - p.hold) / p.aout);
      else {
        punch = null;
        nextPunch = now + RL.range(20000, 30000);
        return 0;
      }
      p.e = e;
      return e;
    }
    const stopLevel = (k) => lvDef + 2 * k;

    /* ======================================================== events */

    const applyPhase = (p) => {
      phase = p;
      hud.classList.toggle('is-crit', p === 'critical' || p === 'final' || p === 'zero');
      hud.classList.toggle('is-final', p === 'final');
    };
    applyPhase(phase);
    ctx.on('mission:phase', (d) => applyPhase(d.phase));
    ctx.on('mission:zero', () => {
      T.frozen = true;
      zeroAt = performance.now();
      punch = null;
      for (const u of units) planUnit(u);
      ctx.flash('alert', 1800);
    });
    ctx.on('mission:reset', () => {
      respawn();
      reacqAt = performance.now();
      follow = true;
      ctx.flash('ok', 1400);
      alertOnce('warn', `SIGNAL REACQUIRED · ${ST.target.codename} ON ${T.street}`, 0);
    });
    ctx.on('intrusion', () => {
      glitchAt = performance.now();
      glitchBands.length = 0;
      for (let k = 0; k < 7; k++) glitchBands.push({ y: RL(), h: RL.range(0.02, 0.09), dx: RL.range(-34, 34), seed: RL() });
      ctx.flash('alert', 1200);
    });
    ctx.on('ui:enhance', () => startPunch(performance.now()));
    ctx.on('enhance:result', (d) => {
      plateTxt = (d && d.plate) || ST.target.plate;
    });
    ctx.on('fonts:ready', () => {
      labelsOn = true;
      gen++;
      measCache.clear();
      monoCache.clear();
      sprites.clear();
      LV.clear();
      for (const l of LMK) l.w = 0;
      if (Wd > 0) layoutHud(); // the webfont changes the target block's height
    });

    /* ======================================================== input */

    const el = ctx.el;
    el.classList.add('map-bd');
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('.map-recenter')) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, cx: camX, cy: camY, moved: false };
      try {
        el.setPointerCapture(e.pointerId);
      } catch (err) {
        /* capture can fail on synthetic pointers */
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      if (!drag.moved) {
        drag.moved = true;
        follow = false;
        punch = null;
        el.classList.add('is-drag');
      }
      lastUser = performance.now();
      camX = drag.cx - dx / zoom;
      camY = drag.cy - dy / zoom;
    });
    const endDrag = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag = null;
      lastUser = performance.now();
      el.classList.remove('is-drag');
    };
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);
    let wheelAcc = 0;
    let wheelPt = null;
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        wheelAcc += e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
        if (Math.abs(wheelAcc) < 60) return;
        const dir = wheelAcc > 0 ? -1 : 1;
        wheelAcc = 0;
        const nk = U.clamp(baseK + dir, kMin, kMax);
        if (nk === baseK) return;
        punch = null;
        baseK = nk;
        if (!follow) {
          const r = el.getBoundingClientRect();
          wheelPt = { mx: e.clientX - r.left - Wd / 2, my: e.clientY - r.top - Hd / 2 };
          lastUser = performance.now();
        }
      },
      { passive: false }
    );
    el.addEventListener('dblclick', (e) => {
      if (e.target.closest('.map-recenter')) return;
      follow = true;
      baseK = 0;
    });
    recBtn.addEventListener('click', () => {
      follow = true;
    });

    /* ======================================================== simulation */

    const compass16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const hdgTxt = (h) => compass16[Math.round(h / 22.5) % 16];
    const gridRef = (x, y) =>
      `${String.fromCharCode(65 + U.clamp(Math.floor(x / GRID), 0, 25))}-${U.pad(U.clamp(Math.floor(y / GRID), 0, 98) + 1)}`;
    const distTxt = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} M` : `${(m / 1000).toFixed(1)} KM`);
    const LL = [0, 0];
    const latLon = (x, y) => {
      const r = PD.toLatLon(x, y);
      LL[0] = r[0];
      LL[1] = r[1];
      return LL;
    };

    function simTarget(now, dt) {
      if (T.frozen) {
        T.speed = U.damp(T.speed, 0, 4, dt);
        return;
      }
      if (T.i >= T.steps.length) newTargetRoute();
      const e = curEdge(T);
      const cls = e >= 0 ? ECLS[e] : 3;
      let want = SPD[cls] * (1 + 0.08 * Math.sin(simT * 0.37) + 0.05 * Math.sin(simT * 1.3));
      if (phase === 'final' || phase === 'critical') want *= 1.1;
      // brake into sharp turns
      const a = pointAhead(T, 25);
      const ax = a.x;
      const ay = a.y;
      const b = pointAhead(T, 80);
      const v1x = ax - T.x;
      const v1y = ay - T.y;
      const v2x = b.x - ax;
      const v2y = b.y - ay;
      const l1 = Math.hypot(v1x, v1y);
      const l2 = Math.hypot(v2x, v2y);
      if (l1 > 1 && l2 > 1) {
        const turn = Math.acos(U.clamp((v1x * v2x + v1y * v2y) / (l1 * l2), -1, 1)) * DEG;
        if (turn > 25) want = Math.min(want, 70 - 40 * U.clamp((turn - 25) / 65, 0, 1));
      }
      T.speed = U.damp(T.speed, U.clamp(want, 26, 128), T.speed < want ? 0.9 : 2.2, dt);
      advance(T, T.speed * SIM * dt);
      const ce = curEdge(T);
      if (ce >= 0) {
        const nm = ENAME[ce];
        if (nm && NAMES[nm] !== T.street) {
          const prev = T.street;
          T.street = NAMES[nm];
          if (prev !== '—' && ECLS[ce] <= 1 && now - lastStreetAlert > 12000) {
            if (alertOnce(ECLS[ce] === 0 ? 'warn' : 'info', `${ST.target.codename} TURNED ONTO ${T.street}`)) lastStreetAlert = now;
          }
        } else if (!nm && T.street === '—') T.street = 'VOIE SANS NOM';
        T.cls = ECLS[ce];
      }
      const dn = districtAt(T.x, T.y);
      if (dn !== T.district) {
        if (T.district !== '—') alertOnce('info', `${ST.target.codename} ENTERING ${dn} · GRID ${gridRef(T.x, T.y)}`, 9000);
        T.district = dn;
      }
    }

    function simUnits(now, dt) {
      let nearest = null;
      let planned = false;
      for (const u of units) {
        // at most one route search per frame keeps the frame time flat
        if (!planned && (u.i >= u.steps.length || now > u.replanAt)) {
          planUnit(u);
          planned = true;
          u.replanAt = now + 3400 + u.k * 700 + RL.range(0, 900);
        }
        const e = curEdge(u);
        let want = e >= 0 ? SPD[ECLS[e]] * 0.96 : 50;
        if (now < u.stunUntil) want *= 0.4;
        u.dist = Math.hypot(u.x - T.x, u.y - T.y);
        // shadow at a standoff instead of riding WRAITH's bumper
        if (!T.frozen && u.dist < u.standoff) want *= U.clamp(u.dist / u.standoff, 0.35, 1);
        if (T.frozen && u.dist < 55 + u.k * 20) want = 0;
        u.speed = U.damp(u.speed, want, 1.2, dt);
        advance(u, u.speed * SIM * dt);
        u.tAcc += dt;
        if (u.tAcc > 0.14) {
          u.tAcc = 0;
          pushTrail(u);
        }
        if (!nearest || u.dist < nearest.dist) nearest = u;
      }
      if (!nearest || T.frozen) return nearest;
      const dm = nearest.dist;
      if (dm < 400 && unitAlertArmed) {
        if (alertOnce('warn', `UNIT ${nearest.name} ${Math.round(dm / 10) * 10} M FROM TARGET`, 5000)) unitAlertArmed = false;
      } else if (dm > 650) unitAlertArmed = true;
      // too close: WRAITH breaks away and the unit overshoots
      if (nearest.dist < 80 && now - T.evadeAt > 12000) {
        T.evadeAt = now;
        nearest.stunUntil = now + 4500;
        nearest.replanAt = now + 4500;
        newTargetRoute(nearest.x, nearest.y);
        if (alertOnce('warn', `${ST.target.codename} EVADING ${nearest.name} · REROUTING`, 4000)) ctx.flash('warn', 900);
      }
      return nearest;
    }

    function simCams(now) {
      if (T.frozen) return;
      for (const c of cams) {
        const d = Math.hypot(c.x - T.x, c.y - T.y);
        if (d > CAM_R || now - c.last < 6000) continue;
        c.last = now;
        c.flash = now;
        c.big = false;
        if (now - lastCamEmit > 8000) {
          lastCamEmit = now;
          c.big = true;
          ctx.emit('target:camera', { camId: c.id, street: T.street, district: T.district });
          alertOnce('info', `${c.id} VISUAL ON ${ST.target.codename} · ${T.street}`, 3000);
          ctx.audio.beep(1320, 60, 'square', 0.02);
        }
      }
    }

    function simLandmarks(now) {
      let best = null;
      let bd = 1e9;
      for (const l of LMK) {
        const d = Math.hypot(l.x - T.x, l.y - T.y);
        if (d < bd) {
          bd = d;
          best = l;
        }
      }
      nearLm = best;
      nearD = bd;
      if (!T.frozen && best && bd < 280 && best.name !== lastLmName && now - lastLmAlert > 15000) {
        if (alertOnce('info', `${ST.target.codename} PASSING ${best.name}`, 3500)) {
          lastLmAlert = now;
          lastLmName = best.name;
        }
      }
    }

    let nearestUnit = null;

    /* ======================================================== tile scheduling */

    const need = [];
    const byDist = (a, b) => a.d - b.d;
    const ALT = [-2, 2, -4, -6, 4, -8]; // fallback levels, nearest first
    const TILE_BUDGET = 7; // ms of tile rendering per frame while the view has holes
    const PREFETCH_BUDGET = 2.5;
    const STALE_BUDGET = 5;
    function tileAt(l, tx, ty) {
      return tiles.get(tkey(l, tx, ty));
    }
    function makeTile(l, tx, ty) {
      const key = tkey(l, tx, ty);
      let t = tiles.get(key);
      if (!t) {
        t = { key, l, tx, ty, sd: lvScale(l) * dpr, c: allocTile(), gen: -1, lab: false, used: useStamp };
        tiles.set(key, t);
      }
      renderTile(t);
      evict();
      return t;
    }
    // tile requests are pooled objects: this runs several times a frame
    const reqPool = [];
    let reqN = 0;
    function req(l, tx, ty, d) {
      let o = reqPool[reqN];
      if (!o) reqPool[reqN] = o = { l: 0, tx: 0, ty: 0, d: 0 };
      reqN++;
      o.l = l;
      o.tx = tx;
      o.ty = ty;
      o.d = d;
      return o;
    }
    // tiles of level l covering the world rect, nearest to the centre first
    function wantTiles(l, x0, y0, x1, y1, out) {
      const sd = lvScale(l) * dpr;
      const ntx = Math.ceil((W * sd) / TS);
      const nty = Math.ceil((H * sd) / TS);
      const tx0 = Math.max(0, Math.floor((x0 * sd) / TS));
      const tx1 = Math.min(ntx - 1, Math.floor((x1 * sd) / TS));
      const ty0 = Math.max(0, Math.floor((y0 * sd) / TS));
      const ty1 = Math.min(nty - 1, Math.floor((y1 * sd) / TS));
      const cx = ((x0 + x1) / 2) * sd;
      const cy = ((y0 + y1) / 2) * sd;
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          out.push(req(l, tx, ty, Math.hypot((tx + 0.5) * TS - cx, (ty + 0.5) * TS - cy)));
        }
      }
      return out;
    }
    function scheduleTiles(lvl, zT, now, frameStart) {
      // the view as it will be once the zoom settles
      const hw = Wd / 2 / zT;
      const hh = Hd / 2 / zT;
      need.length = 0;
      reqN = 0;
      wantTiles(lvl, camX - hw, camY - hh, camX + hw, camY + hh, need);
      need.sort(byDist);
      let holes = 0;
      for (const n of need) {
        const t = tileAt(n.l, n.tx, n.ty);
        if (t) t.used = useStamp;
        if (!t || t.gen < 0) holes++;
      }
      const budgetEnd = frameStart + (firstTick ? 400 : TILE_BUDGET);
      let rendered = 0;
      for (const n of need) {
        const t = tileAt(n.l, n.tx, n.ty);
        if (t && t.gen >= 0) continue;
        if (rendered && performance.now() > budgetEnd) break;
        makeTile(n.l, n.tx, n.ty).used = useStamp;
        rendered++;
      }
      if (holes && rendered) return;
      // stale tiles in view (the fonts arrived), a few per frame
      const staleEnd = performance.now() + STALE_BUDGET;
      let restaled = 0;
      for (const n of need) {
        const t = tileAt(n.l, n.tx, n.ty);
        if (!t || (t.gen === gen && t.lab === labelsOn)) continue;
        if (restaled && performance.now() > staleEnd) return;
        makeTile(n.l, n.tx, n.ty).used = useStamp;
        restaled++;
      }
      if (restaled) return;
      // then a prefetch ring, then the punch level ahead of time (only while under the memory cap;
      // prefetched tiles count as recent, not in view, so they stay evictable)
      if (performance.now() - frameStart > PREFETCH_BUDGET || tiles.size >= TILE_CAP) return;
      need.length = 0;
      const m = 180 / zT;
      wantTiles(lvl, camX - hw - m, camY - hh - m, camX + hw + m, camY + hh + m, need);
      if (!punch && follow && !RM && nextPunch - now < 5000 && !T.frozen) {
        const pz = lvScale(stopLevel(Math.min(kMax, baseK + 3)));
        const ph = Wd / 2 / pz;
        const pv = Hd / 2 / pz;
        const ax = pointAhead(T, T.speed * SIM * 2);
        wantTiles(stopLevel(Math.min(kMax, baseK + 3)), ax.x - ph, ax.y - pv, ax.x + ph, ax.y + pv, need);
      }
      for (const n of need) {
        const t = tileAt(n.l, n.tx, n.ty);
        if (t) {
          if (t.used < useStamp) t.used = useStamp - 1;
          continue;
        }
        makeTile(n.l, n.tx, n.ty).used = useStamp - 1;
        return;
      }
    }

    /* ======================================================== draw */

    function drawTrail(g, A, ox, oy, z, col, maxA, width) {
      const n = A.tCount;
      if (n < 2) return;
      const chunks = 6;
      const per = Math.ceil(n / chunks);
      for (let c = 0; c < chunks; c++) {
        const s = c * per;
        const e = Math.min(n - 1, s + per);
        if (e <= s) break;
        g.beginPath();
        for (let k = s; k <= e; k++) {
          const idx = (A.tHead - n + k + A.tN * 2) % A.tN;
          const x = A.trail[idx * 2] * z + ox;
          const y = A.trail[idx * 2 + 1] * z + oy;
          if (k === s) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        const t = (c + 1) / chunks;
        g.strokeStyle = rgba(col, maxA * t * t);
        g.lineWidth = width * (0.4 + 0.6 * t);
        g.stroke();
      }
    }

    // blit the tile layer; returns the device-px origin of world (0,0)
    const ORG = { x: 0, y: 0 };
    function drawTiles(g, lvl, z) {
      const d = dpr;
      const k = z * d;
      const sd = lvScale(lvl) * d;
      const ratio = k / sd;
      const exact = Math.abs(ratio - 1) < 1e-6;
      let orgX = (Wd * d) / 2 - camX * k;
      let orgY = (Hd * d) / 2 - camY * k;
      if (exact) {
        orgX = Math.round(orgX);
        orgY = Math.round(orgY);
      }
      ORG.x = orgX;
      ORG.y = orgY;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = VOID;
      g.fillRect(0, 0, cv.canvas.width, cv.canvas.height);
      const vx0 = -orgX / k;
      const vy0 = -orgY / k;
      const vx1 = (Wd * d - orgX) / k;
      const vy1 = (Hd * d - orgY) / k;
      need.length = 0;
      reqN = 0;
      wantTiles(lvl, vx0, vy0, vx1, vy1, need);
      let missing = 0;
      for (const n of need) {
        const t = tileAt(n.l, n.tx, n.ty);
        if (!t || t.gen < 0) missing++;
      }
      g.imageSmoothingEnabled = !exact;
      if (missing) {
        // fallback: the world backdrop, then any cached neighbouring level
        g.imageSmoothingEnabled = true;
        const sx0 = U.clamp(vx0 * wbS, 0, wb.width - 1);
        const sy0 = U.clamp(vy0 * wbS, 0, wb.height - 1);
        const sx1 = U.clamp(vx1 * wbS, sx0 + 1, wb.width);
        const sy1 = U.clamp(vy1 * wbS, sy0 + 1, wb.height);
        g.drawImage(wb, sx0, sy0, sx1 - sx0, sy1 - sy0, orgX + (sx0 / wbS) * k, orgY + (sy0 / wbS) * k, ((sx1 - sx0) / wbS) * k, ((sy1 - sy0) / wbS) * k);
        for (const n of need) {
          const t = tileAt(n.l, n.tx, n.ty);
          if (t && t.gen >= 0) continue;
          const rx0 = (n.tx * TS) / sd;
          const ry0 = (n.ty * TS) / sd;
          const rx1 = ((n.tx + 1) * TS) / sd;
          const ry1 = ((n.ty + 1) * TS) / sd;
          for (const da of ALT) {
            const alt = lvl + da;
            const asd = lvScale(alt) * d;
            const ax0 = Math.floor((rx0 * asd) / TS);
            const ax1 = Math.floor((rx1 * asd - 1e-3) / TS);
            const ay0 = Math.floor((ry0 * asd) / TS);
            const ay1 = Math.floor((ry1 * asd - 1e-3) / TS);
            let ok = true;
            for (let ty = ay0; ty <= ay1 && ok; ty++) {
              for (let tx = ax0; tx <= ax1 && ok; tx++) {
                const at = tileAt(alt, tx, ty);
                if (!at || at.gen < 0) ok = false;
              }
            }
            if (!ok) continue;
            g.save();
            g.beginPath();
            g.rect(orgX + rx0 * k, orgY + ry0 * k, (rx1 - rx0) * k, (ry1 - ry0) * k);
            g.clip();
            const ar = k / asd;
            for (let ty = ay0; ty <= ay1; ty++) {
              for (let tx = ax0; tx <= ax1; tx++) {
                const at = tileAt(alt, tx, ty);
                at.used = useStamp;
                g.drawImage(at.c, orgX + tx * TS * ar, orgY + ty * TS * ar, TS * ar, TS * ar);
              }
            }
            g.restore();
            break;
          }
        }
        g.imageSmoothingEnabled = !exact;
      }
      const sz = TS * ratio;
      for (const n of need) {
        const t = tileAt(n.l, n.tx, n.ty);
        if (!t || t.gen < 0) continue;
        t.used = useStamp;
        if (exact) g.drawImage(t.c, orgX + n.tx * TS, orgY + n.ty * TS);
        else {
          // overlap by a hair so scaled tiles never show seams
          const x = orgX + n.tx * sz;
          const y = orgY + n.ty * sz;
          g.drawImage(t.c, x, y, sz + 0.6, sz + 0.6);
        }
      }
      g.imageSmoothingEnabled = true;
      g.setTransform(d, 0, 0, d, 0, 0);
      return missing;
    }

    function drawLandmarkGlyph(g, l, x, y, sc, hot) {
      const col = hot ? C.ice : l.kind === 'station' ? rgba('neon', 0.9) : rgba('holo', 0.95);
      g.strokeStyle = col;
      g.fillStyle = col;
      g.lineWidth = 1.1;
      if (l.name === 'TOUR EIFFEL') {
        // a little line-drawn tower
        const h = 34 * sc;
        const b = 10 * sc;
        g.globalCompositeOperation = 'lighter';
        g.drawImage(glowCyan, x - 16, y - h * 0.55 - 16, 32, 32);
        g.globalCompositeOperation = 'source-over';
        g.beginPath();
        g.moveTo(x - b, y);
        g.quadraticCurveTo(x - b * 0.35, y - h * 0.35, x - 1, y - h * 0.9);
        g.moveTo(x + b, y);
        g.quadraticCurveTo(x + b * 0.35, y - h * 0.35, x + 1, y - h * 0.9);
        g.moveTo(x, y - h * 0.9);
        g.lineTo(x, y - h * 1.08);
        g.moveTo(x - b * 0.62, y - h * 0.2);
        g.lineTo(x + b * 0.62, y - h * 0.2);
        g.moveTo(x - b * 0.34, y - h * 0.45);
        g.lineTo(x + b * 0.34, y - h * 0.45);
        g.moveTo(x - b * 0.14, y - h * 0.72);
        g.lineTo(x + b * 0.14, y - h * 0.72);
        g.stroke();
        g.beginPath();
        g.arc(x, y - h * 0.2 + b * 0.5, b * 0.45, Math.PI, 0);
        g.stroke();
        g.beginPath();
        g.ellipse(x, y, b * 1.35, b * 0.4, 0, 0, TAU);
        g.strokeStyle = rgba('holo', 0.45);
        g.stroke();
        return;
      }
      if (l.name === 'ARC DE TRIOMPHE') {
        // the star at Étoile: twelve avenues
        g.beginPath();
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * TAU + 0.13;
          const r1 = 5 * sc;
          const r2 = (k % 2 ? 11 : 15) * sc;
          g.moveTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
          g.lineTo(x + Math.cos(a) * r2, y + Math.sin(a) * r2);
        }
        g.stroke();
        g.beginPath();
        g.arc(x, y, 4.2 * sc, 0, TAU);
        g.stroke();
        g.fillRect(x - 1.5, y - 1.5, 3, 3);
        return;
      }
      const r = 4.6 * sc;
      g.beginPath();
      if (l.kind === 'monument') {
        g.moveTo(x, y - r - 1);
        g.lineTo(x + r, y);
        g.lineTo(x, y + r + 1);
        g.lineTo(x - r, y);
        g.closePath();
      } else if (l.kind === 'museum') g.rect(x - r + 0.5, y - r + 0.5, r * 2 - 1, r * 2 - 1);
      else if (l.kind === 'venue') {
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * TAU + Math.PI / 6;
          if (k) g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
          else g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        }
        g.closePath();
      } else g.arc(x, y, r, 0, TAU);
      g.fillStyle = 'rgba(2,8,14,0.85)';
      g.fill();
      g.stroke();
      if (l.kind === 'square') {
        g.beginPath();
        g.moveTo(x - r - 3, y);
        g.lineTo(x - r + 1, y);
        g.moveTo(x + r - 1, y);
        g.lineTo(x + r + 3, y);
        g.moveTo(x, y - r - 3);
        g.lineTo(x, y - r + 1);
        g.moveTo(x, y + r - 1);
        g.lineTo(x, y + r + 3);
        g.stroke();
      }
      g.fillStyle = col;
      g.fillRect(x - 1, y - 1, 2, 2);
    }

    // the target's data tag: above the dot on the roomier side, else below it or level with it, and
    // never under the HUD modules
    function placeTag(tx, ty, w, h) {
      const pref = tx + 34 + w < Wd - (mode === 'L' ? 110 : 70) ? 1 : -1;
      let first = true;
      for (const sy of [-1, 1, 0]) {
        for (const sx of [pref, -pref]) {
          const lx = tx + sx * 30;
          const bx = sx > 0 ? lx : lx - w;
          const by = U.clamp(sy < 0 ? ty - 30 - h : sy > 0 ? ty + 30 : ty - h / 2, rulerT + 4, Hd - h - 24);
          const ok = bx >= rulerL + 2 && bx + w <= Wd - 2 && !zones.some((zn) => zn && bx < zn.x1 && bx + w > zn.x0 && by < zn.y1 && by + h > zn.y0);
          if (ok || first) Object.assign(tagP, { bx, by, w, h, sx, sy });
          first = false;
          if (ok) return tagP;
        }
      }
      return tagP;
    }

    const lmBoxes = [];
    function drawLandmarks(g, ox, oy, z, now, S) {
      lmBoxes.length = 0;
      for (const zn of zones) if (zn) lmBoxes.push(zn.x0, zn.y0, zn.x1, zn.y1);
      if (mode === 'L') lmBoxes.push(Wd - 52, navBox.y1, Wd, Hd - 150); // zoom ladder column
      // the arrondissement names printed in the tiles
      if (z >= 0.1) {
        const off = arrNumSize(z) * 0.72;
        for (const a of ARR) {
          const x = a.lx * z + ox;
          const y = a.ly * z + oy + off;
          if (x < -100 || x > Wd + 100 || y < -20 || y > Hd + 20) continue;
          const hw = (a.sub.length * 9.5) / 2 + 4;
          lmBoxes.push(x - hw, y - 7, x + hw, y + 7);
        }
      }
      const sc = U.clamp(Math.pow(z / 0.3, 0.35), 0.75, 1.3);
      const tx = T.x * z + ox;
      const ty = T.y * z + oy;
      lmBoxes.push(tx - 30, ty - 30, tx + 30, ty + 30);
      // the target's data tag and the unit tags are drawn later but outrank landmark labels
      lmBoxes.push(tagP.bx, tagP.by, tagP.bx + tagP.w, tagP.by + tagP.h);
      for (const u of units) {
        const x = u.x * z + ox;
        const y = u.y * z + oy;
        if (x < -20 || y < -20 || x > Wd + 20 || y > Hd + 20) continue;
        lmBoxes.push(x - 8, y - 8, x + 70, y + 27);
      }
      g.font = U10;
      g.textBaseline = 'middle';
      g.textAlign = 'left';
      const maxLabels = z < 0.08 ? 8 : 40;
      let nl = 0;
      for (const l of LMK) {
        const x = l.x * z + ox;
        const y = l.y * z + oy;
        if (x < -40 || y < -40 || x > Wd + 40 || y > Hd + 40) continue;
        const hot = nearLm === l && nearD < 450 && !T.frozen;
        drawLandmarkGlyph(g, l, x, y, sc, hot);
        if (hot && !RM) {
          const q = (now / 1400) % 1;
          g.beginPath();
          g.arc(x, y, 8 + q * 26, 0, TAU);
          g.strokeStyle = rgba('ice', (1 - q) * 0.6);
          g.lineWidth = 1;
          g.stroke();
        }
        if (nl >= maxLabels || (S && !hot && l.pri > 8)) continue;
        if (!l.w) l.w = measure(U10, l.name) + l.name.length * 1.2;
        const w = l.w + 8;
        const gy = l.name === 'TOUR EIFFEL' ? y - 20 * sc : y;
        let placed = false;
        for (const side of [1, -1]) {
          const bx = side > 0 ? x + 11 : x - 11 - w;
          const by = gy - 7;
          if (bx < 20 || bx + w > Wd - 4 || by < 16 || by + 14 > Hd - 20) continue;
          let clash = false;
          for (let k = 0; k < lmBoxes.length; k += 4) {
            if (bx < lmBoxes[k + 2] && bx + w > lmBoxes[k] && by < lmBoxes[k + 3] && by + 14 > lmBoxes[k + 1]) {
              clash = true;
              break;
            }
          }
          if (clash) continue;
          lmBoxes.push(bx, by, bx + w, by + 14);
          g.fillStyle = hot ? 'rgba(10,30,40,0.9)' : 'rgba(2,8,14,0.78)';
          g.fillRect(bx, by, w, 14);
          g.fillStyle = hot ? C.ice : l.kind === 'station' ? rgba('neon', 0.9) : C.holo;
          g.fillRect(side > 0 ? bx : bx + w - 2, by, 2, 14);
          g.fillStyle = hot ? C.ice : l.pri < 17 ? rgba('ice', 0.92) : rgba('text', 0.85);
          g.letterSpacing = '1.2px';
          g.fillText(l.name, bx + 5, by + 7.5);
          g.letterSpacing = '0px';
          placed = true;
          nl++;
          break;
        }
        if (!placed) lmBoxes.push(x - 6, y - 6, x + 6, y + 6);
      }
      // proximity leader from the target to the landmark it is passing
      if (nearLm && nearD < 450 && !T.frozen) {
        const x = nearLm.x * z + ox;
        const y = nearLm.y * z + oy;
        g.setLineDash([3, 3]);
        g.lineDashOffset = RM ? 0 : -now * 0.02;
        g.strokeStyle = rgba('ice', 0.55);
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(tx, ty);
        g.lineTo(x, y);
        g.stroke();
        g.setLineDash([]);
        if (Math.hypot(x - tx, y - ty) > 60) {
          g.font = F9;
          g.textAlign = 'center';
          const mx = (x + tx) / 2;
          const my = (y + ty) / 2;
          const txt = distTxt(nearD);
          const tw = measure(F9, txt) + 6;
          g.fillStyle = 'rgba(2,8,14,0.85)';
          g.fillRect(mx - tw / 2, my - 6, tw, 12);
          g.fillStyle = C.ice;
          g.fillText(txt, mx, my + 0.5);
          g.textAlign = 'left';
        }
      }
    }

    function draw(now) {
      const g = cv.ctx;
      Wd = cv.w;
      Hd = cv.h;
      const z = zoom;
      const L = mode === 'L';
      const S = mode === 'S';
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
      g.lineCap = 'butt';
      g.lineJoin = 'miter';
      g.setLineDash([]);

      // tiles: the target stop once it covers the view, else the sharpest level that does
      const base = stopLevel(baseK);
      const lvlT = punch ? stopLevel(punch.to) : base;
      const near = lvDef + 2 * Math.round((zl - lvDef) / 2);
      let lvl = lvlT;
      if (!viewReady(lvlT, z)) {
        if (near !== lvlT && viewReady(near, z)) lvl = near;
        else if (base !== lvlT && viewReady(base, z)) lvl = base;
      }
      drawTiles(g, lvl, z);
      const ox = ORG.x / dpr;
      const oy = ORG.y / dpr;
      const wx0 = -ox / z;
      const wy0 = -oy / z;
      const wx1 = (Wd - ox) / z;
      const wy1 = (Hd - oy) / z;

      const crit = phase === 'critical' || phase === 'final' || phase === 'zero';
      if (crit) {
        g.fillStyle = `rgba(255,35,64,${phase === 'final' ? 0.07 : 0.045})`;
        g.fillRect(0, 0, Wd, Hd);
      }

      // coordinate grid
      g.beginPath();
      for (let k = Math.max(0, Math.floor(wx0 / GRID)); k <= Math.min(26, Math.ceil(wx1 / GRID)); k++) {
        const x = Math.round(k * GRID * z + ox) + 0.5;
        g.moveTo(x, rulerT);
        g.lineTo(x, Hd);
      }
      for (let k = Math.max(0, Math.floor(wy0 / GRID)); k <= Math.ceil(wy1 / GRID); k++) {
        const y = Math.round(k * GRID * z + oy) + 0.5;
        g.moveTo(rulerL, y);
        g.lineTo(Wd, y);
      }
      g.strokeStyle = rgba('holo', 0.07);
      g.lineWidth = 1;
      g.stroke();
      // where the survey data ends
      if (wx0 < 0 || wy0 < 0 || wx1 > W || wy1 > H) {
        g.setLineDash([8, 6]);
        g.strokeStyle = rgba('holo', 0.3);
        g.strokeRect(Math.round(ox) + 0.5, Math.round(oy) + 0.5, Math.round(W * z), Math.round(H * z));
        g.setLineDash([]);
      }

      const tx = T.x * z + ox;
      const ty = T.y * z + oy;
      const hr = (T.hdS * Math.PI) / 180;
      const enh = punch && punch.e > 0.6;
      placeTag(tx, ty, enh ? 176 : S ? 92 : 118, enh ? 58 : S ? 24 : 34);

      // range rings + bearing ticks
      g.setLineDash([2, 4]);
      g.strokeStyle = rgba(crit ? 'threat' : 'holo', 0.32);
      g.lineWidth = 1;
      const rings = [250, 500, 1000];
      for (const m of rings) {
        g.beginPath();
        g.arc(tx, ty, m * z, 0, TAU);
        g.stroke();
      }
      g.setLineDash([]);
      {
        const r = 500 * z;
        g.beginPath();
        for (let a = 0; a < 72; a++) {
          const t = (a / 72) * TAU;
          const l = a % 9 === 0 ? 7 : a % 3 === 0 ? 4 : 2;
          const s = Math.sin(t);
          const c = -Math.cos(t);
          g.moveTo(tx + s * r, ty + c * r);
          g.lineTo(tx + s * (r - l), ty + c * (r - l));
        }
        g.strokeStyle = rgba('holo', 0.45);
        g.stroke();
      }
      g.font = F9;
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      for (const m of rings) {
        const r = m * z;
        if (r < 26) continue;
        const lx = tx + r * 0.707 + 3;
        const ly = ty - r * 0.707 - 3;
        if (lx < rulerL || lx > Wd - 30 || ly < rulerT + 6 || ly > Hd - 24) continue;
        const txt = m >= 1000 ? '1 KM' : `${m} M`;
        g.fillStyle = 'rgba(2,6,11,0.78)';
        g.fillRect(lx - 2, ly - 6, measure(F9, txt) + 4, 12);
        g.fillStyle = rgba(crit ? 'threat' : 'holo', 0.85);
        g.fillText(txt, lx, ly);
      }

      // radar sweep
      {
        const r = Math.max(60, 1000 * z);
        g.save();
        g.translate(tx, ty);
        g.rotate(sweepA);
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = crit ? 0.62 : 0.42;
        g.drawImage(sweepSpr, -r, -r, r * 2, r * 2);
        g.globalAlpha = 1;
        g.strokeStyle = rgba(crit ? 'threat' : 'holo', 0.55);
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(r, 0);
        g.stroke();
        g.restore();
      }

      // predicted route
      if (!T.frozen && T.i < T.steps.length && rN) {
        const cur = rCum[rStep[T.i]] + T.s;
        let j = rStep[T.i] + 1;
        while (j < rN - 1 && rCum[j] <= cur) j++;
        g.beginPath();
        g.moveTo(tx, ty);
        for (let k = j; k < rN; k++) g.lineTo(rPts[k * 2] * z + ox, rPts[k * 2 + 1] * z + oy);
        g.strokeStyle = rgba('amber', 0.13);
        g.lineWidth = 6;
        g.lineJoin = 'round';
        g.stroke();
        g.setLineDash([7, 5]);
        g.lineDashOffset = RM ? 0 : -now * 0.03;
        g.strokeStyle = rgba('amber', 0.92);
        g.lineWidth = 1.6;
        g.stroke();
        g.setLineDash([]);
        g.lineJoin = 'miter';
        const dx = rPts[(rN - 1) * 2] * z + ox;
        const dy = rPts[(rN - 1) * 2 + 1] * z + oy;
        if (dx > -40 && dy > -40 && dx < Wd + 40 && dy < Hd + 40) {
          g.save();
          g.translate(dx, dy);
          g.rotate(RM ? 0 : now * 0.0012);
          g.strokeStyle = C.amber;
          g.lineWidth = 1.2;
          g.strokeRect(-6, -6, 12, 12);
          g.rotate(Math.PI / 4);
          g.strokeStyle = rgba('amber', 0.5);
          g.strokeRect(-9, -9, 18, 18);
          g.restore();
          g.fillStyle = C.amber;
          g.fillRect(dx - 1.5, dy - 1.5, 3, 3);
          if (!S) {
            const rem = remainingLen(T);
            const eta = rem / Math.max(20, T.speed * SIM);
            const l1 = `PRED DEST · P${U.pad(T.conf, 2)}`;
            const l2 = `T+${U.pad(Math.floor(eta / 60))}:${U.pad(Math.floor(eta % 60))} · ${(rem / 1000).toFixed(1)}KM`;
            const l3 = T.destName;
            g.font = F9;
            g.textAlign = 'left';
            const bw = Math.max(measure(F9, l1), measure(F9, l2), l3 ? measure(F9, l3) : 0) + 8;
            const bh = l3 ? 38 : 26;
            let bx = dx + 13 + bw > Wd - 8 ? dx - 13 - bw : dx + 13;
            const by = U.clamp(dy - 14, rulerT + 3, Hd - 22 - bh);
            // stay clear of the HUD modules: flip sides, or keep only the marker
            const hits = (x) => zones.some((zn) => zn && x < zn.x1 && x + bw > zn.x0 && by < zn.y1 && by + bh > zn.y0);
            if (hits(bx)) bx = bx > dx ? dx - 13 - bw : dx + 13;
            if (!hits(bx) && bx > rulerL && bx + bw < Wd) {
              g.fillStyle = 'rgba(2,6,11,0.8)';
              g.fillRect(bx, by, bw, bh);
              g.fillStyle = C.amber;
              g.fillText(l1, bx + 4, by + 7);
              g.fillStyle = rgba('amber', 0.75);
              g.fillText(l2, bx + 4, by + 19);
              if (l3) g.fillText(l3, bx + 4, by + 31);
            }
          }
        }
      }

      drawLandmarks(g, ox, oy, z, now, S);

      // traffic cameras
      g.font = F9;
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      for (const c of cams) {
        const x = c.x * z + ox;
        const y = c.y * z + oy;
        if (x < -80 || y < -80 || x > Wd + 80 || y > Hd + 80) continue;
        const age = (now - c.flash) / 1000;
        const hot = age < (c.big ? 3.2 : 1.6);
        if (!hot && z < 0.12) continue;
        if (hot) {
          const f = 1 - age / (c.big ? 3.2 : 1.6);
          // view cone toward the target
          const a = Math.atan2(ty - y, tx - x);
          const len = Math.min(140, Math.hypot(tx - x, ty - y) + 26);
          g.beginPath();
          g.moveTo(x, y);
          g.arc(x, y, len, a - 0.36, a + 0.36);
          g.closePath();
          g.fillStyle = rgba('holo', 0.16 * f);
          g.fill();
          g.strokeStyle = rgba('holo', 0.6 * f);
          g.stroke();
          if (!RM) {
            const pr = age / (c.big ? 3.2 : 1.6);
            for (let k = 0; k < (c.big ? 2 : 1); k++) {
              const q = (pr * 2 + k * 0.5) % 1;
              g.beginPath();
              g.arc(x, y, 5 + q * 34, 0, TAU);
              g.strokeStyle = rgba('ice', (1 - q) * 0.7 * f);
              g.stroke();
            }
          }
        }
        g.save();
        g.translate(x, y);
        g.rotate(c.ang);
        g.beginPath();
        g.moveTo(0, -4.5);
        g.lineTo(4.5, 0);
        g.lineTo(0, 4.5);
        g.lineTo(-4.5, 0);
        g.closePath();
        g.fillStyle = hot ? rgba('ice', 0.9) : 'rgba(2,8,14,0.85)';
        g.fill();
        g.strokeStyle = hot ? C.ice : rgba('holo', 0.85);
        g.lineWidth = 1;
        g.stroke();
        g.beginPath();
        g.moveTo(5.5, -2.5);
        g.lineTo(9, 0);
        g.lineTo(5.5, 2.5);
        g.strokeStyle = rgba('holo', 0.7);
        g.stroke();
        g.restore();
        if ((!S || hot) && z > 0.12 && (hot || L || z > 0.5)) {
          const label = hot ? `${c.id} ● REC` : c.id;
          const lw = measure(F9, label) + 4;
          // idle camera tags give way to landmark labels and HUD modules
          let clash = false;
          if (!hot) {
            for (let k = 0; k < lmBoxes.length; k += 4) {
              if (x + 8 < lmBoxes[k + 2] && x + 8 + lw > lmBoxes[k] && y - 13 < lmBoxes[k + 3] && y - 2 > lmBoxes[k + 1]) {
                clash = true;
                break;
              }
            }
          }
          if (!clash) {
            lmBoxes.push(x + 8, y - 13, x + 8 + lw, y - 2);
            g.fillStyle = 'rgba(2,6,11,0.7)';
            g.fillRect(x + 8, y - 13, lw, 11);
            g.fillStyle = hot ? C.ice : rgba('holo', 0.72);
            g.fillText(label, x + 10, y - 7.5);
          }
        }
      }

      // intercept units
      for (const u of units) drawTrail(g, u, ox, oy, z, 'holo', 0.55, 2);
      for (const u of units) {
        const x = u.x * z + ox;
        const y = u.y * z + oy;
        const km = u.dist / 1000;
        const close = u.dist < 400;
        const col = close ? 'amber' : 'holo';
        const inView = x > 10 && y > rulerT + 6 && x < Wd - 10 && y < Hd - 22;
        if (inView) {
          g.globalCompositeOperation = 'lighter';
          g.drawImage(glowCyan, x - 12, y - 12, 24, 24);
          g.globalCompositeOperation = 'source-over';
          g.beginPath();
          g.arc(x, y, 3.2, 0, TAU);
          g.fillStyle = close ? C.amber : C.ice;
          g.fill();
          g.beginPath();
          g.arc(x, y, 7, 0, TAU);
          g.strokeStyle = rgba(col, 0.6);
          g.lineWidth = 1;
          g.stroke();
          g.beginPath();
          g.moveTo(x + u.dx * 7, y + u.dy * 7);
          g.lineTo(x + u.dx * 13, y + u.dy * 13);
          g.stroke();
          g.font = U9;
          const w = Math.max(measure(U9, u.name), 52);
          g.fillStyle = 'rgba(2,6,11,0.78)';
          g.fillRect(x + 9, y + 3, w + 6, S ? 12 : 23);
          g.fillStyle = rgba(col, 0.95);
          g.fillText(u.name, x + 12, y + 9.5);
          if (!S) {
            g.font = F9;
            g.fillStyle = rgba(col, 0.7);
            g.fillText(`${km.toFixed(2)} KM`, x + 12, y + 20);
          }
        } else if (!S || close) {
          // off-screen tracker on the panel edge
          const ang = Math.atan2(y - Hd / 2, x - Wd / 2);
          let ex = U.clamp(x, rulerL + 16, Wd - 16);
          let ey = U.clamp(y, rulerT + 16, Hd - 32);
          // slide along the panel edge out from under the HUD modules
          const vEdge = ex === rulerL + 16 || ex === Wd - 16;
          for (const zn of zones) {
            if (!zn || ex < zn.x0 - 14 || ex > zn.x1 + 14 || ey < zn.y0 - 14 || ey > zn.y1 + 14) continue;
            if (vEdge) ey = ey - zn.y0 < zn.y1 - ey && zn.y0 - 20 > rulerT + 16 ? zn.y0 - 20 : zn.y1 + 20;
            else ex = ex - zn.x0 < zn.x1 - ex && zn.x0 - 20 > rulerL + 16 ? zn.x0 - 20 : zn.x1 + 20;
          }
          g.save();
          g.translate(ex, ey);
          g.rotate(ang);
          g.beginPath();
          g.moveTo(7, 0);
          g.lineTo(-3, -5);
          g.lineTo(-1, 0);
          g.lineTo(-3, 5);
          g.closePath();
          g.fillStyle = rgba(col, 0.9);
          g.fill();
          g.restore();
          g.font = F9;
          const txt = `${u.name} ${km.toFixed(1)}`;
          const tw = measure(F9, txt);
          const lx = U.clamp(ex - tw / 2, rulerL + 2, Wd - tw - 4);
          const ly = ey + (ey > Hd / 2 ? -12 : 12);
          g.fillStyle = 'rgba(2,6,11,0.72)';
          g.fillRect(lx - 2, ly - 6, tw + 4, 12);
          g.fillStyle = rgba(col, 0.85);
          g.fillText(txt, lx, ly);
        }
      }

      // target trail
      g.lineCap = 'round';
      g.lineJoin = 'round';
      drawTrail(g, T, ox, oy, z, 'threat', 0.16, 9);
      drawTrail(g, T, ox, oy, z, 'threat', 0.95, 3);
      g.lineCap = 'butt';
      g.lineJoin = 'miter';

      // crosshair through the target with ticks
      {
        const gap = 20;
        const cc = crit ? 'threat' : 'holo';
        g.strokeStyle = rgba(cc, 0.26);
        g.lineWidth = 1;
        const yy = Math.round(ty) + 0.5;
        const xx = Math.round(tx) + 0.5;
        g.beginPath();
        g.moveTo(rulerL, yy);
        g.lineTo(tx - gap, yy);
        g.moveTo(tx + gap, yy);
        g.lineTo(Wd, yy);
        g.moveTo(xx, rulerT);
        g.lineTo(xx, ty - gap);
        g.moveTo(xx, ty + gap);
        g.lineTo(xx, Hd);
        g.stroke();
        g.beginPath();
        for (let d = gap; d < 150; d += 10) {
          const l = d % 50 === 0 ? 5 : 2.5;
          g.moveTo(tx + d, yy - l);
          g.lineTo(tx + d, yy + l);
          g.moveTo(tx - d, yy - l);
          g.lineTo(tx - d, yy + l);
          g.moveTo(xx - l, ty + d);
          g.lineTo(xx + l, ty + d);
          g.moveTo(xx - l, ty - d);
          g.lineTo(xx + l, ty - d);
        }
        g.strokeStyle = rgba(cc, 0.5);
        g.stroke();
        if (!S) {
          const ll = latLon(T.x, T.y);
          g.font = F9;
          g.fillStyle = rgba(cc, 0.8);
          g.textAlign = 'right';
          const lx = Wd - (L ? 28 : 6);
          if (!zones.some((zn) => zn && lx - 50 < zn.x1 && lx > zn.x0 && yy - 13 < zn.y1 && yy > zn.y0)) g.fillText(`${ll[0].toFixed(4)}N`, lx, yy - 7);
          g.textAlign = 'left';
          g.save();
          g.translate(xx + 7, Hd - 24);
          g.rotate(-Math.PI / 2);
          g.fillText(`${ll[1].toFixed(4)}E`, 0, 0);
          g.restore();
        }
      }

      // the target
      {
        const pulse = RM ? 1 : 0.88 + 0.12 * Math.sin(now * 0.006);
        g.globalCompositeOperation = 'lighter';
        const gs = 96 * pulse;
        g.drawImage(glowRed, tx - gs / 2, ty - gs / 2, gs, gs);
        g.drawImage(glowRed, tx - 16, ty - 16, 32, 32);
        g.globalCompositeOperation = 'source-over';
        if (!RM) {
          for (let k = 0; k < 3; k++) {
            const q = (now / 1700 + k / 3) % 1;
            g.beginPath();
            g.arc(tx, ty, 7 + U.ease.outCubic(q) * 44, 0, TAU);
            g.strokeStyle = rgba('threat', (1 - q) * 0.9);
            g.lineWidth = 1.6 - q;
            g.stroke();
          }
        } else {
          g.beginPath();
          g.arc(tx, ty, 16, 0, TAU);
          g.strokeStyle = rgba('threat', 0.5);
          g.lineWidth = 1.2;
          g.stroke();
        }
        // heading chevron
        g.save();
        g.translate(tx, ty);
        g.rotate(hr);
        g.beginPath();
        g.moveTo(0, -17);
        g.lineTo(5, -10);
        g.lineTo(0, -12.5);
        g.lineTo(-5, -10);
        g.closePath();
        g.fillStyle = C.ice;
        g.fill();
        g.restore();
        g.beginPath();
        g.arc(tx, ty, 8, 0, TAU);
        g.strokeStyle = rgba('threat', 0.85);
        g.lineWidth = 1.2;
        g.stroke();
        g.beginPath();
        g.arc(tx, ty, 5.5, 0, TAU);
        g.fillStyle = C.threat;
        g.fill();
        g.beginPath();
        g.arc(tx, ty, 2.4, 0, TAU);
        g.fillStyle = '#fff';
        g.fill();
        // lock brackets
        const bs = T.frozen ? 26 : 13;
        const bl = 5;
        const blink = RM || Math.floor(now / 380) % 2 === 0;
        g.strokeStyle = rgba('threat', blink ? 0.95 : 0.45);
        g.lineWidth = 1.4;
        g.beginPath();
        for (const [sx, sy] of CORNERS) {
          g.moveTo(tx + sx * bs, ty + sy * (bs - bl));
          g.lineTo(tx + sx * bs, ty + sy * bs);
          g.lineTo(tx + sx * (bs - bl), ty + sy * bs);
        }
        g.stroke();

        // data tag with leader line
        const { bx, by, w: tagW, h: tagH, sx: side, sy } = tagP;
        const lxp = tx + side * 30;
        const lyp = ty + sy * 30;
        g.strokeStyle = rgba('threat', 0.7);
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(tx + side * (sy ? 7 : 10), ty + sy * 7);
        g.lineTo(lxp, lyp);
        if (sy) g.lineTo(lxp, sy < 0 ? by + tagH : by);
        g.stroke();
        g.fillStyle = 'rgba(20,2,8,0.82)';
        g.fillRect(bx, by, tagW, tagH);
        g.strokeStyle = rgba('threat', 0.8);
        g.strokeRect(bx + 0.5, by + 0.5, tagW - 1, tagH - 1);
        g.fillStyle = C.threat;
        g.fillRect(bx, by, 3, tagH);
        g.textAlign = 'left';
        g.font = U10;
        g.fillStyle = '#ff5a6e';
        g.fillText(`TGT ${ST.target.codename}`, bx + 8, by + 10);
        g.font = F9;
        g.fillStyle = C.ice;
        if (!S) g.fillText(`${U.pad(Math.round(T.speed), 3)} KM/H · ${U.pad(Math.round(T.hdS) % 360, 3)}°`, bx + 8, by + 24);
        else g.fillText(`${Math.round(T.speed)}`, bx + 72, by + 10);
        if (enh) {
          g.fillStyle = rgba('text', 0.9);
          g.fillText(`VEH ${ST.target.vehicle}`, bx + 8, by + 37);
          g.fillText(`PLT ${plateTxt} · ${ST.target.vehicleColor}`, bx + 8, by + 49);
        }
      }

      // INTERCEPT marker
      if (T.frozen) {
        const t = (now - zeroAt) / 1000;
        const k = U.ease.outCubic(U.clamp(t / 0.8, 0, 1));
        const s = U.lerp(130, 38, k);
        const on = RM || Math.floor(now / 260) % 2 === 0 || t > 3;
        g.strokeStyle = rgba('threat', on ? 1 : 0.5);
        g.lineWidth = 2;
        g.beginPath();
        for (const [sx, sy] of CORNERS) {
          g.moveTo(tx + sx * s, ty + sy * (s - 12));
          g.lineTo(tx + sx * s, ty + sy * s);
          g.lineTo(tx + sx * (s - 12), ty + sy * s);
        }
        g.stroke();
        g.textAlign = 'center';
        g.font = FD(S ? 15 : 22);
        g.letterSpacing = S ? '3px' : '6px';
        const iy = U.clamp(ty - s - 26, rulerT + 20, Hd - 60);
        g.fillStyle = 'rgba(20,2,8,0.8)';
        const tw = g.measureText('INTERCEPT').width + 24;
        g.fillRect(tx - tw / 2, iy - 17, tw, 32);
        g.strokeStyle = C.threat;
        g.lineWidth = 1;
        g.strokeRect(tx - tw / 2 + 0.5, iy - 16.5, tw - 1, 31);
        g.fillStyle = on ? '#ff4d63' : '#b01a30';
        g.fillText('INTERCEPT', tx + 3, iy);
        g.letterSpacing = '0px';
        g.font = F9;
        g.fillStyle = C.ice;
        const nu = nearestUnit ? nearestUnit.name : unitDefs[0];
        g.fillText(`TARGET IMMOBILIZED · ${nu} ON SITE`, tx, U.clamp(ty + s + 16, rulerT + 30, Hd - 28));
        g.fillStyle = rgba('text', 0.8);
        g.fillText(`${T.street} · ${T.district}`, tx, U.clamp(ty + s + 28, rulerT + 42, Hd - 16));
      }

      /* ---- screen-space HUD */

      // rulers
      g.fillStyle = 'rgba(2,7,12,0.88)';
      g.fillRect(0, 0, Wd, rulerT);
      g.fillRect(0, rulerT, rulerL, Hd - rulerT);
      g.strokeStyle = rgba('holo', 0.35);
      g.beginPath();
      g.moveTo(0, rulerT + 0.5);
      g.lineTo(Wd, rulerT + 0.5);
      g.moveTo(rulerL + 0.5, rulerT);
      g.lineTo(rulerL + 0.5, Hd);
      g.stroke();
      g.beginPath();
      const sub = z > 0.16 ? 100 : 250;
      const per = GRID / sub;
      for (let k = Math.max(0, Math.floor(wx0 / sub)); k <= Math.ceil(wx1 / sub); k++) {
        const x = Math.round(k * sub * z + ox) + 0.5;
        if (x < rulerL) continue;
        const l = k % per === 0 ? 6 : per === 10 && k % 5 === 0 ? 4 : 2.5;
        g.moveTo(x, rulerT);
        g.lineTo(x, rulerT - l);
      }
      for (let k = Math.max(0, Math.floor(wy0 / sub)); k <= Math.ceil(wy1 / sub); k++) {
        const y = Math.round(k * sub * z + oy) + 0.5;
        if (y < rulerT) continue;
        const l = k % per === 0 ? 6 : per === 10 && k % 5 === 0 ? 4 : 2.5;
        g.moveTo(rulerL, y);
        g.lineTo(rulerL - l, y);
      }
      g.strokeStyle = rgba('holo', 0.5);
      g.stroke();
      g.font = F9;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const tcol = Math.floor(T.x / GRID);
      const trow = Math.floor(T.y / GRID);
      for (let k = Math.max(0, Math.floor(wx0 / GRID)); k <= Math.min(25, Math.floor(wx1 / GRID)); k++) {
        const x = (k + 0.5) * GRID * z + ox;
        if (x < rulerL + 6 || x > Wd - 6) continue;
        g.fillStyle = k === tcol ? C.threat : rgba('text', 0.75);
        g.fillText(String.fromCharCode(65 + k), x, 6.5);
      }
      for (let k = Math.max(0, Math.floor(wy0 / GRID)); k <= Math.floor(wy1 / GRID); k++) {
        const y = (k + 0.5) * GRID * z + oy;
        if (y < rulerT + 6 || y > Hd - 20) continue;
        g.fillStyle = k === trow ? C.threat : rgba('text', 0.75);
        g.fillText(U.pad(k + 1), rulerL / 2, y);
      }
      // target position markers on the rulers
      g.fillStyle = C.threat;
      g.beginPath();
      g.moveTo(tx, rulerT);
      g.lineTo(tx - 4, rulerT - 5);
      g.lineTo(tx + 4, rulerT - 5);
      g.closePath();
      g.moveTo(rulerL, ty);
      g.lineTo(rulerL - 5, ty - 4);
      g.lineTo(rulerL - 5, ty + 4);
      g.closePath();
      g.fill();

      // nav module (top right): compass rose, heading readout, scale bar
      const rr = roseR;
      const nb = navBox;
      {
        // drawn in module units, scaled up as one piece on very large bodies
        const k = hudK;
        g.save();
        g.translate(nb.x0, nb.y0);
        g.scale(k, k);
        const x0 = 0;
        const y0 = 0;
        const w = (nb.x1 - nb.x0) / k;
        const h = (nb.y1 - nb.y0) / k;
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x0 + w - 9, y0);
        g.lineTo(x0 + w, y0 + 9);
        g.lineTo(x0 + w, y0 + h);
        g.lineTo(x0 + 9, y0 + h);
        g.lineTo(x0, y0 + h - 9);
        g.closePath();
        g.fillStyle = 'rgba(2,8,14,0.86)';
        g.fill();
        g.strokeStyle = rgba('holo', 0.4);
        g.lineWidth = 1;
        g.stroke();
        g.fillStyle = C.holo;
        g.fillRect(x0 + w - 2, y0 + 9, 2, 16);
        const rcx = x0 + rr + 14;
        const rcy = y0 + rr + 14;
        if (roseSpr) {
          const n = roseSpr.width / (dpr * k);
          g.drawImage(roseSpr, rcx - n / 2, rcy - n / 2, n, n);
          g.save();
          g.translate(rcx, rcy);
          g.rotate(hr);
          g.beginPath();
          g.moveTo(0, -rr + 3);
          g.lineTo(3.5, 0);
          g.lineTo(0, rr * 0.25);
          g.lineTo(-3.5, 0);
          g.closePath();
          g.fillStyle = rgba('threat', 0.95);
          g.fill();
          g.restore();
          g.beginPath();
          g.arc(rcx, rcy, 2, 0, TAU);
          g.fillStyle = C.ice;
          g.fill();
        }
        const hx = rcx + rr + 16;
        g.textAlign = 'left';
        g.textBaseline = 'middle';
        g.font = U9;
        g.fillStyle = rgba('text', 0.6);
        g.fillText('HDG', hx, y0 + 16);
        g.font = S ? FM(11, 700) : FM(13, 700);
        g.fillStyle = C.ice;
        g.fillText(`${U.pad(Math.round(T.hdS) % 360, 3)}°`, hx, y0 + (S ? 29 : 31));
        g.font = U10;
        g.fillStyle = C.holo;
        g.fillText(hdgTxt(T.hdS), hx, y0 + (S ? 42 : 46));
        if (!S) {
          g.font = F9;
          g.fillStyle = rgba('text', 0.6);
          g.fillText(`M/PX ${(1 / z).toFixed(1)}`, hx, y0 + 61);
        }
        // scale bar
        const opts = [50, 100, 250, 500, 1000, 2000, 5000];
        const maxPx = w - 24;
        let m = opts[0];
        for (const o of opts) if ((o * z) / k <= maxPx) m = o;
        const px = (m * z) / k;
        const sx0 = x0 + 10;
        const sx1 = sx0 + px;
        const sy = y0 + h - 9;
        for (let q = 0; q < 4; q++) {
          g.fillStyle = q % 2 ? 'rgba(95,243,255,0.25)' : C.holo;
          g.fillRect(sx0 + (px / 4) * q, sy, px / 4, 3);
        }
        g.strokeStyle = C.holo;
        g.beginPath();
        g.moveTo(sx0 + 0.5, sy - 4);
        g.lineTo(sx0 + 0.5, sy + 3);
        g.moveTo(sx1 - 0.5, sy - 4);
        g.lineTo(sx1 - 0.5, sy + 3);
        g.stroke();
        g.font = F9;
        g.textAlign = 'right';
        g.fillStyle = C.ice;
        g.fillText(m >= 1000 ? `${m / 1000} KM` : `${m} M`, sx1, sy - 8);
        g.textAlign = 'left';
        g.fillStyle = rgba('text', 0.6);
        g.fillText('0', sx0, sy - 8);
        g.restore();
      }

      // zoom ladder (hero only): one tick per zoom stop
      if (L) {
        const x = Wd - 12;
        const y0 = nb.y1 + 34;
        const y1 = Hd - 160;
        if (y1 - y0 > 80) {
          const n = kMax - kMin;
          const yk = (k) => y1 - ((k - kMin) / n) * (y1 - y0);
          g.strokeStyle = rgba('holo', 0.45);
          g.beginPath();
          g.moveTo(x + 0.5, y0);
          g.lineTo(x + 0.5, y1);
          for (let k = kMin; k <= kMax; k++) {
            const yy = Math.round(yk(k)) + 0.5;
            const l = k === 0 ? 8 : 4;
            g.moveTo(x, yy);
            g.lineTo(x - l, yy);
          }
          g.stroke();
          const yc = yk(U.clamp((zl - lvDef) / 2, kMin, kMax));
          g.fillStyle = punch ? C.amber : C.holo;
          g.beginPath();
          g.moveTo(x - 3, yc);
          g.lineTo(x - 10, yc - 4);
          g.lineTo(x - 10, yc + 4);
          g.closePath();
          g.fill();
          g.font = F9;
          g.textAlign = 'right';
          g.fillStyle = 'rgba(2,6,11,0.8)';
          g.fillRect(x - 46, y0 - 26, 46, 22);
          g.fillStyle = rgba('text', 0.6);
          g.fillText('ZOOM', x, y0 - 20);
          g.fillStyle = punch ? C.amber : C.ice;
          g.fillText(`${(z / lvScale(lvDef)).toFixed(2)}X`, x, y0 - 9);
        }
      }

      // overview inset (hero only): whole city, view box, units, target
      if (L && Hd > 420 && thumbW) {
        const s = thumbW;
        const sh = thumbH;
        const x0 = Wd - s - 12;
        const y0 = Hd - sh - 30;
        g.fillStyle = 'rgba(2,6,11,0.85)';
        g.fillRect(x0 - 4, y0 - 16, s + 8, sh + 20);
        g.drawImage(thumb, x0, y0, s, sh);
        g.strokeStyle = rgba('holo', 0.5);
        g.strokeRect(x0 - 3.5, y0 - 15.5, s + 7, sh + 19);
        g.font = F9;
        g.textAlign = 'left';
        g.fillStyle = rgba('text', 0.8);
        g.fillText('OVERVIEW · PARIS 75', x0, y0 - 8);
        const k = s / W;
        const bx0 = U.clamp(wx0, 0, W) * k;
        const by0 = U.clamp(wy0, 0, H) * k;
        g.strokeStyle = C.ice;
        g.strokeRect(x0 + bx0 + 0.5, y0 + by0 + 0.5, Math.max(2, (U.clamp(wx1, 0, W) - U.clamp(wx0, 0, W)) * k), Math.max(2, (U.clamp(wy1, 0, H) - U.clamp(wy0, 0, H)) * k));
        g.fillStyle = C.holo;
        for (const u of units) g.fillRect(x0 + u.x * k - 1, y0 + u.y * k - 1, 2.5, 2.5);
        g.fillStyle = C.threat;
        g.beginPath();
        g.arc(x0 + T.x * k, y0 + T.y * k, 2.6, 0, TAU);
        g.fill();
      }

      // satellite telemetry micro-readout (bottom left), when it clears the target block
      if (telem) {
        g.font = F9;
        g.textAlign = 'left';
        g.fillStyle = rgba('text', 0.6);
        const t = simT;
        if (now - clockAt > 500) {
          clockAt = now;
          clockTxt = `PARIS ${U.fmtClock(new Date(), tzOff)} ${tzTag}`;
        }
        g.fillText(`ALT ${(412.6 + Math.sin(t * 0.1) * 0.4).toFixed(1)} KM · INC 97.4° · AZ ${U.pad(Math.round((t * 3) % 360), 3)}° · ${clockTxt}`, rulerL + 8, Hd - 28);
        g.fillText(`TRACK ${follow ? 'AUTO' : 'MANUAL'} · ${gridRef(T.x, T.y)} · ${NV} NODES · ${NE} EDGES`, rulerL + 8, Hd - 40);
      }

      // ENHANCE GRID
      if (punch) {
        const e = punch.e;
        const t = (now - punch.t0) / 1000;
        const a = U.clamp(e * 1.6, 0, 1);
        g.globalAlpha = a;
        const inset = U.lerp(30, 10, e);
        g.strokeStyle = C.amber;
        g.lineWidth = 1.5;
        g.beginPath();
        const bl = 22;
        const x0 = rulerL + inset;
        const y0 = rulerT + inset;
        const x1 = Wd - inset;
        const y1 = Hd - 18 - inset;
        g.moveTo(x0, y0 + bl);
        g.lineTo(x0, y0);
        g.lineTo(x0 + bl, y0);
        g.moveTo(x1 - bl, y0);
        g.lineTo(x1, y0);
        g.lineTo(x1, y0 + bl);
        g.moveTo(x1, y1 - bl);
        g.lineTo(x1, y1);
        g.lineTo(x1 - bl, y1);
        g.moveTo(x0 + bl, y1);
        g.lineTo(x0, y1);
        g.lineTo(x0, y1 - bl);
        g.stroke();
        // scanline sweep on the way in
        if (t < 0.9) {
          const sy = rulerT + (Hd - rulerT) * (t / 0.9);
          g.fillStyle = 'rgba(255,182,39,0.08)';
          g.fillRect(rulerL, sy - 24, Wd - rulerL, 24);
          g.fillStyle = 'rgba(255,220,150,0.7)';
          g.fillRect(rulerL, sy, Wd - rulerL, 1);
        }
        const title = 'ENHANCE GRID';
        g.font = FD(S ? 11 : 14);
        g.letterSpacing = S ? '3px' : '5px';
        g.textAlign = 'center';
        const tw = g.measureText(title).width;
        const bw = tw + 40;
        const bh = S ? 36 : 40;
        // the title card takes the gap between the HUD modules, else a clear strip above or below
        // the target; with no room it sits out and the brackets carry the beat
        const clearAt = (x, y) =>
          y >= rulerT + 4 && y + bh <= Hd - 22 && (y > ty + 28 || y + bh < ty - 28) &&
          !zones.some((zn) => zn && x - bw / 2 < zn.x1 && x + bw / 2 > zn.x0 && y < zn.y1 && y + bh > zn.y0);
        let cxm = rulerL + (Wd - rulerL) / 2;
        let by = -1;
        const gx0 = tgtBox ? tgtBox.x1 + 8 : rulerL;
        const gx1 = navBox.x0 - 8;
        if (gx1 - gx0 >= bw && clearAt((gx0 + gx1) / 2, rulerT + 12)) {
          cxm = (gx0 + gx1) / 2;
          by = rulerT + 12;
        } else {
          for (const y of [band + 8, rulerT + 12, Hd - 44 - bh]) {
            if (clearAt(cxm, y)) {
              by = y;
              break;
            }
          }
        }
        if (by >= 0) {
          g.fillStyle = 'rgba(24,14,2,0.85)';
          g.fillRect(cxm - bw / 2, by, bw, bh);
          g.strokeStyle = C.amber;
          g.lineWidth = 1;
          g.strokeRect(cxm - bw / 2 + 0.5, by + 0.5, bw - 1, bh - 1);
          g.fillStyle = '#ffd27a';
          g.fillText(title, cxm + 2, by + 13);
          g.letterSpacing = '0px';
          const prog = U.clamp((t - 0.3) / (punch.ain + punch.hold - 0.5), 0, 1);
          g.fillStyle = rgba('amber', 0.25);
          g.fillRect(cxm - bw / 2 + 8, by + (S ? 24 : 25), bw - 16, 3);
          g.fillStyle = C.amber;
          g.fillRect(cxm - bw / 2 + 8, by + (S ? 24 : 25), (bw - 16) * prog, 3);
          g.font = F9;
          g.fillStyle = rgba('amber', 0.9);
          g.fillText(
            prog < 1 ? `RESAMPLING ${gridRef(T.x, T.y)} · ${Math.round(prog * 4096)}/4096` : `×${(z / lvScale(lvDef)).toFixed(1)} · ${(1 / z).toFixed(1)} M/PX · SHARP`,
            cxm,
            by + (S ? 32 : 34)
          );
        }
        g.letterSpacing = '0px';
        g.textAlign = 'left';
        g.globalAlpha = 1;
      }

      // SIGNAL REACQUIRED flash
      {
        const t = (now - reacqAt) / 1000;
        if (t < 2.6) {
          if (t < 0.25 && !RM) {
            g.fillStyle = `rgba(223,248,255,${0.35 * (1 - t / 0.25)})`;
            g.fillRect(0, 0, Wd, Hd);
          }
          const a = t < 2 ? 1 : 1 - (t - 2) / 0.6;
          g.globalAlpha = a;
          const cxm = Wd / 2;
          const cym = Hd * 0.3;
          g.font = FD(S ? 12 : 17);
          g.letterSpacing = S ? '3px' : '6px';
          g.textAlign = 'center';
          const txt = 'SIGNAL REACQUIRED';
          const tw = g.measureText(txt).width + 36;
          g.fillStyle = 'rgba(2,14,20,0.88)';
          g.fillRect(cxm - tw / 2, cym - 20, tw, 40);
          g.strokeStyle = C.phosphor;
          g.strokeRect(cxm - tw / 2 + 0.5, cym - 19.5, tw - 1, 39);
          g.fillStyle = C.phosphor;
          const shown = RM ? txt : txt.slice(0, Math.floor(U.clamp(t / 0.6, 0, 1) * txt.length));
          g.fillText(shown, cxm + 3, cym - 3);
          g.letterSpacing = '0px';
          g.font = F9;
          g.fillStyle = C.ice;
          g.fillText(`${ST.target.codename} · ${T.street} · ${gridRef(T.x, T.y)}`, cxm, cym + 12);
          g.globalAlpha = 1;
        }
      }

      // intrusion: sliced glitch + red scan
      {
        const t = (now - glitchAt) / 1000;
        if (t < 1.6) {
          if (!RM && t < 1.1) {
            const cw = cv.canvas.width;
            const ch = cv.canvas.height;
            const jitter = Math.floor(now / 60);
            for (const b of glitchBands) {
              if ((jitter + Math.floor(b.seed * 10)) % 3 === 0) continue;
              const y = Math.floor(((b.y + Math.sin(jitter * 0.7 + b.seed * 9) * 0.05) % 1) * ch);
              const h = Math.max(2, Math.floor(b.h * ch));
              const dx = b.dx * (1 - t / 1.1) * (jitter % 2 ? 1 : -0.6);
              g.drawImage(cv.canvas, 0, y, cw, Math.min(h, ch - y), dx, y / dpr, Wd, Math.min(h, ch - y) / dpr);
            }
          }
          const sy = (t / 1.6) * Hd;
          g.fillStyle = 'rgba(255,35,64,0.1)';
          g.fillRect(0, 0, Wd, Hd);
          g.fillStyle = 'rgba(255,35,64,0.22)';
          g.fillRect(0, sy - 40, Wd, 40);
          g.fillStyle = 'rgba(255,90,110,0.9)';
          g.fillRect(0, sy, Wd, 1.5);
          g.font = F10;
          g.textAlign = 'left';
          g.fillStyle = C.threat;
          if (Math.floor(now / 120) % 2 === 0 || RM) g.fillText('SIGNAL INTEGRITY FAULT · RESYNC', rulerL + 10, rulerT + (Hd - rulerT) * 0.52);
        }
      }
    }

    // every tile of level l under the current view is rendered
    function viewReady(l, z) {
      const sd = lvScale(l) * dpr;
      const hw = Wd / 2 / z;
      const hh = Hd / 2 / z;
      const ntx = Math.ceil((W * sd) / TS);
      const nty = Math.ceil((H * sd) / TS);
      const tx0 = Math.max(0, Math.floor(((camX - hw) * sd) / TS));
      const tx1 = Math.min(ntx - 1, Math.floor(((camX + hw) * sd) / TS));
      const ty0 = Math.max(0, Math.floor(((camY - hh) * sd) / TS));
      const ty1 = Math.min(nty - 1, Math.floor(((camY + hh) * sd) / TS));
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          const t = tileAt(l, tx, ty);
          if (!t || t.gen < 0) return false;
        }
      }
      return true;
    }

    /* ======================================================== HUD (DOM) */

    function updateHud(now) {
      setT(F.street, T.street);
      setT(F.district, T.district);
      setT(F.near, nearLm ? `${nearLm.name} · ${distTxt(nearD)}` : '—');
      setT(F.speed, U.pad(Math.round(T.speed + (T.frozen ? 0 : RL.range(-0.6, 0.6))), 3));
      const pct = U.clamp(T.speed / 130, 0, 1);
      if (F.bar._p !== Math.round(pct * 100)) {
        F.bar._p = Math.round(pct * 100);
        F.bar.style.transform = `scaleX(${pct.toFixed(2)})`;
      }
      setT(F.heading, `${U.pad(Math.round(T.hdS) % 360, 3)}° ${hdgTxt(T.hdS)}`);
      const ll = latLon(T.x, T.y);
      setT(F.ll, `${ll[0].toFixed(4)} N · ${ll[1].toFixed(4)} E`);
      if (nearestUnit) {
        const km = nearestUnit.dist / 1000;
        setT(F.unit, `${nearestUnit.name} · ${km.toFixed(2)} KM`);
        const want = T.frozen ? 0 : nearestUnit.dist / Math.max(4, (nearestUnit.speed / 3.6) * 0.55);
        etaS = etaS ? U.lerp(etaS, want, 0.25) : want;
        const s = Math.max(0, Math.round(etaS));
        setT(F.eta, T.frozen ? 'INTERCEPTED' : `INTERCEPT ${U.pad(Math.floor(s / 60))}:${U.pad(s % 60)}`);
      }
      setT(F.plate, plateTxt);
      setT(F.frame, U.pad(frame % 1000000, 6));
      setT(F.zoom, `${(zoom / lvScale(lvDef)).toFixed(2)}X`);
      setT(F.gsd, (1 / zoom).toFixed(1));
      setT(F.grid, gridRef(T.x, T.y));
      setT(F.mode, T.frozen ? 'TARGET HELD' : follow ? (punch ? 'ENHANCE' : 'AUTO-TRACK') : 'MANUAL');
      if (now % 1000 < 130) setT(F.sig, String(-RL.int(54, 71)));
      recBtn.hidden = follow;
      if (!follow) {
        const left = Math.max(0, Math.ceil((6000 - (now - lastUser)) / 1000));
        setT(F.auto, drag ? '' : `· ${left}S`);
      }
      const meta = metaText();
      if (meta !== lastMeta) {
        lastMeta = meta;
        ctx.meta(meta);
      }
    }
    // a narrow header keeps the zoom and gives the title the room
    const metaText = () => `${Wd < 400 ? '' : 'SAT KH-9 · '}Z ${(zoom / lvScale(lvDef)).toFixed(1)}X`;

    // HUD footprint for this body size: the modules the canvas labels keep clear of, and the target's
    // resting point, dropped below them when they span the middle of the view
    function layoutHud() {
      const w = Wd;
      const h = Hd;
      const bw = (mode === 'L' ? 150 : mode === 'M' ? 130 : 108) * hudK;
      navBox = { x0: w - bw - 6, y0: 20, x1: w - 6, y1: 20 + (roseR * 2 + 54) * hudK };
      const hr = hud.getBoundingClientRect();
      const tr = hud.querySelector('.map-tgt').getBoundingClientRect();
      // per axis: a layout morph can leave the panel non-uniformly scaled while this runs
      const qx = hr.width > 0 ? w / hr.width : 1;
      const qy = hr.height > 0 ? h / hr.height : 1;
      tgtBox = { x0: (tr.left - hr.left) * qx, y0: (tr.top - hr.top) * qy, x1: (tr.right - hr.left) * qx, y1: (tr.bottom - hr.top) * qy };
      const miniBox = mode === 'L' && h > 420 ? { x0: w - thumbW - 18, y0: h - thumbH - 48, x1: w - 6, y1: h - 26 } : null;
      telem = mode !== 'S' && h >= 240 && h - 50 > tgtBox.y1 + 6 ? { x0: rulerL + 4, y0: h - 50, x1: rulerL + 316, y1: h - 20 } : null;
      zones = [tgtBox, navBox, miniBox, telem];
      band = rulerT;
      for (const zn of [tgtBox, navBox]) if (zn.x0 < w / 2 + 24 && zn.x1 > w / 2 - 24) band = Math.max(band, zn.y1);
      const lo = h - 18 - 20;
      const y = band > rulerT ? Math.max(h / 2, (band + 12 + lo) / 2) : h / 2;
      anc = { x: w / 2, y, x0: rulerL + 30, x1: w - 30, y0: Math.min(y, Math.max(rulerT + 24, band + 14)), y1: Math.max(y, lo - 4) };
    }

    function emitMove() {
      const tg = ST.target;
      const ll = latLon(T.x, T.y);
      tg.street = T.street;
      tg.district = T.district;
      tg.speed = Math.round(T.speed);
      tg.heading = Math.round(T.hdS) % 360;
      tg.x = U.clamp(T.x / W, 0, 1);
      tg.y = U.clamp(T.y / H, 0, 1);
      ctx.emit('target:move', {
        x: tg.x,
        y: tg.y,
        street: T.street,
        district: T.district,
        speed: tg.speed,
        heading: tg.heading,
        lat: +ll[0].toFixed(5),
        lon: +ll[1].toFixed(5),
      });
    }

    makePatterns();
    renderThumb(156);
    renderBackdrop();

    /* ======================================================== lifecycle */

    return {
      resize(w, h) {
        Wd = w;
        Hd = h;
        mode = w >= 720 && h >= 460 ? 'L' : w >= 470 ? 'M' : 'S';
        hud.dataset.mode = mode;
        const k = mode === 'L' && w >= 1300 && h >= 760 ? 1.25 : 1;
        const nd = Math.min(2, window.devicePixelRatio || 1);
        if (nd !== dpr || k !== hudK) {
          if (nd !== dpr) {
            dpr = nd;
            PPER = Math.max(4, Math.round(8 * dpr));
            TS = PPER * 32;
            flushTiles();
            makePatterns();
          }
          hudK = k;
          hud.style.setProperty('--map-k', String(k));
          renderThumb(Math.round(156 * k));
        }
        TILE_CAP = Math.max(24, Math.floor(48e6 / (TS * TS * 4))); // ~48 MB of tile bitmaps
        // default view ~3 km across (never finer than 0.21 px/m), snapped to quarter octaves; on a
        // wide strip the short side sets it, so the street grid keeps the hero's density
        const was = lvDef;
        lvDef = Math.round(4 * Math.log2(Math.max(Math.min(w, h * 2.6) / 3000, 0.21)));
        kMax = Math.max(1, Math.min(4, Math.floor((4 * Math.log2(w / 700) - lvDef) / 2)));
        kMin = -1;
        while (kMin > -12 && lvScale(stopLevel(kMin)) * W * 1.04 > w) kMin--;
        baseK = U.clamp(baseK, kMin, kMax);
        if (was !== lvDef || firstTick) zl = stopLevel(baseK);
        zoom = lvScale(zl);
        const r = mode === 'L' ? 30 : mode === 'M' ? 24 : 19;
        buildRose(r, cv.dpr * hudK);
        layoutHud();
        ctx.meta(lastMeta = metaText());
      },
      tick(now, dt) {
        const frameStart = performance.now();
        if (!labelsOn && frameStart - bornAt > 2500) labelsOn = true;
        frame++;
        useStamp++;
        simT += dt;
        simTarget(now, dt);
        nearestUnit = simUnits(now, dt);
        simCams(now);
        T.tAcc += dt;
        if (T.tAcc > 0.09 && !T.frozen) {
          T.tAcc = 0;
          pushTrail(T);
        }
        // heading smoothing
        const dh = ((T.hd - T.hdS + 540) % 360) - 180;
        T.hdS = (T.hdS + dh * (1 - Math.exp(-6 * dt)) + 360) % 360;
        for (const u of units) {
          const du = ((u.hd - u.hdS + 540) % 360) - 180;
          u.hdS = (u.hdS + du * (1 - Math.exp(-6 * dt)) + 360) % 360;
        }
        const rate = phase === 'final' ? 3.2 : phase === 'critical' || phase === 'zero' ? 2.2 : phase === 'severe' ? 1.4 : 1;
        sweepA = (sweepA + dt * rate * (RM ? 0.35 : 1.6)) % TAU;

        // zoom: damp toward the stop (or the punch stop), landing exactly on it
        if (!punch && follow && now > nextPunch) startPunch(now);
        const pe = punchE(now);
        const base = stopLevel(baseK);
        let target = punch ? base + (stopLevel(punch.to) - base) * pe : base;
        if (!punch) {
          const old = zoom;
          zl = RM ? target : U.damp(zl, target, 9, dt);
          if (Math.abs(zl - target) < 0.004) zl = target;
          zoom = lvScale(zl);
          if (wheelPt && !follow) {
            camX += wheelPt.mx / old - wheelPt.mx / zoom;
            camY += wheelPt.my / old - wheelPt.my / zoom;
            if (zl === target) wheelPt = null;
          }
        } else {
          zl = target;
          zoom = lvScale(zl);
        }
        if (follow && !drag) {
          // lead the target by a slice of the shorter view axis, keeping it inside the free area
          const look = Math.min(0.12 * Wd, 0.2 * Hd, 260 * zoom) * U.clamp(T.speed / 90, 0, 1.2) * (punch ? 0.25 : 1) * (T.frozen ? 0 : 1);
          const hr = (T.hdS * Math.PI) / 180;
          const lam = punch || now - reacqAt < 1500 ? 5 : 2.2;
          const sx = U.clamp(anc.x - Math.sin(hr) * look, anc.x0, anc.x1);
          const sy = U.clamp(anc.y + Math.cos(hr) * look, anc.y0, anc.y1);
          camX = U.damp(camX, T.x - (sx - Wd / 2) / zoom, lam, dt);
          camY = U.damp(camY, T.y - (sy - Hd / 2) / zoom, lam, dt);
        } else if (!follow && !drag && now - lastUser > 6000) follow = true;
        const hw = Wd / 2 / zoom;
        const hh = Hd / 2 / zoom;
        camX = hw * 2 > W + 400 ? W / 2 : U.clamp(camX, hw - 200, W - hw + 200);
        camY = hh * 2 > H + 400 ? H / 2 : U.clamp(camY, hh - 200, H - hh + 200);
        if (firstTick) {
          camX = T.x - (anc.x - Wd / 2) / zoom;
          camY = T.y - (anc.y - Hd / 2) / zoom;
        }

        const lvlT = punch ? stopLevel(punch.to) : base;
        scheduleTiles(lvlT, lvScale(lvlT), now, frameStart);
        draw(now);
        firstTick = false;

        if (now - lastEmit > 250) {
          lastEmit = now;
          simLandmarks(now);
          emitMove();
        }
        if (now - lastHud > 120) {
          lastHud = now;
          updateHud(now);
        }
      },
    };
  });
})();
