/* DEADLIGHT · P-04 OPTIC RECON
   The "ENHANCE" shot. Every capture paints a rainy Paris traffic-camera frame procedurally (once) and
   caches a pyramid of low-res reconstruction stages, then plays the movie beat: degraded live feed →
   acquire → ENHANCE (eased zoom + stepped sharpening) → ENHANCE the plate → OCR lock → MATCH →
   glitch-cut away. Painting a capture costs ~100 ms, so the next one is built by a generator in
   ≤ ~4 ms slices while the current one plays. Per frame it is one pixelated drawImage of the current
   stage plus overlays. */
(() => {
  'use strict';

  const SRC_W = 1280;
  const SRC_H = 860;
  const DETAIL = 6; // the plate region is re-painted at ≥ 6× for the final read (more on big panels)
  const CAR_STAGES = [1 / 10, 1 / 6, 1 / 3, 1 / 2, 1]; // × source resolution
  const PLATE_STAGES = [0.55, 0.9, 1.5, 2.6]; // × source resolution; the last stage is the full detail render
  // CCTV teal for each car stage below full (colour returns as the image resolves); strong reds, the
  // target's tail lights, are spared
  const CAR_TINT = [0.88, 0.66, 0.4];
  const CAR_GRADE = [0.12, 0.06, 0.02];
  // [desaturate, teal tint, black lift] for each plate stage below full
  const PLATE_GRADE = [[0.2, 0.1, 0.04], [0.13, 0.06, 0.02], [0.06, 0.03, 0.01], [0.02, 0.01, 0]];
  const DEG = Math.PI / 180;
  const FX = 10.5; // facade line, metres from the road centre
  const RX = 7; // road half-width

  /* ---------------------------------------------------------------- helpers */

  function mk(w, h, read) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    c.g = c.getContext('2d', read ? { willReadFrequently: true } : undefined);
    return c;
  }
  const hexRgb = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const css = (rgb, a) => `rgba(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0},${a})`;
  const whiten = (rgb, t) => [rgb[0] + (255 - rgb[0]) * t, rgb[1] + (255 - rgb[1]) * t, rgb[2] + (255 - rgb[2]) * t];
  function poly(g, pts) {
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.closePath();
  }
  function bbox(pts) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of pts) {
      if (p.x < x0) x0 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.x > x1) x1 = p.x;
      if (p.y > y1) y1 = p.y;
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  const hit = (b, c) => !c || (b.x < c.x + c.w && b.x + b.w > c.x && b.y < c.y + c.h && b.y + b.h > c.y);
  const onCanvas = (b) => b.x < SRC_W + 40 && b.x + b.w > -40 && b.y < SRC_H + 40 && b.y + b.h > -40;
  // maps a local uw×vh rectangle onto the plane through three projected corners (affine is plenty here)
  function affine(g, o, ue, ve, uw, vh) {
    g.transform((ue.x - o.x) / uw, (ue.y - o.y) / uw, (ve.x - o.x) / vh, (ve.y - o.y) / vh, o.x, o.y);
  }
  // strokes the current path as a neon tube: wide haze, body, hot core
  function neon(g, rgb, w, k = 1) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = css(rgb, 0.13 * k);
    g.lineWidth = w * 3.8;
    g.stroke();
    g.strokeStyle = css(rgb, 0.55 * k);
    g.lineWidth = w * 1.4;
    g.stroke();
    g.strokeStyle = css(whiten(rgb, 0.7), 0.95 * k);
    g.lineWidth = w * 0.5;
    g.stroke();
    g.restore();
  }
  // lit sign lettering: a wide haze, a body and a hot filled core (reads even when pixelated)
  function neonText(g, text, x, y, size, rgb, k = 1) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.font = `700 ${size}px "Chakra Petch", "Segoe UI", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.strokeStyle = css(rgb, 0.14 * k);
    g.lineWidth = size * 0.36;
    g.strokeText(text, x, y);
    g.strokeStyle = css(rgb, 0.6 * k);
    g.lineWidth = size * 0.13;
    g.strokeText(text, x, y);
    g.fillStyle = css(whiten(rgb, 0.72), 0.95 * k);
    g.fillText(text, x, y);
    g.restore();
  }
  // pseudo-kanji block glyph: 2–5 strokes snapped to a 3×3 lattice
  function glyph(g, r, x, y, s) {
    const n = r.int(2, 5);
    for (let i = 0; i < n; i++) {
      const t = r();
      if (t < 0.4) {
        const yy = r.int(0, 2) * 0.5;
        const a = r.chance(0.7) ? 0 : 0.5;
        const b = r.chance(0.7) ? 1 : 0.5;
        g.moveTo(x + a * s, y + yy * s);
        g.lineTo(x + b * s, y + yy * s);
      } else if (t < 0.75) {
        const xx = r.int(0, 2) * 0.5;
        const a = r.chance(0.7) ? 0 : 0.5;
        const b = r.chance(0.7) ? 1 : 0.5;
        g.moveTo(x + xx * s, y + a * s);
        g.lineTo(x + xx * s, y + b * s);
      } else if (t < 0.9) {
        const x0 = r.int(0, 1) * 0.5;
        const y0 = r.int(0, 1) * 0.5;
        const d = r.chance(0.5);
        g.moveTo(x + (d ? x0 : x0 + 0.5) * s, y + y0 * s);
        g.lineTo(x + (d ? x0 + 0.5 : x0) * s, y + (y0 + 0.5) * s);
      } else {
        g.rect(x + r.int(0, 1) * 0.5 * s, y + r.int(0, 1) * 0.5 * s, 0.5 * s, 0.5 * s);
      }
    }
  }

  /* ------------------------------------------------------------------ scene */

  const SHOP = ['#ffcf8a', '#ffe2b0', '#bfe8ff', '#9ff7ff', '#ff9ec9', '#d6c2ff', '#fff0d6', '#ffb86b'].map(hexRgb);
  const WALL = ['#0d1017', '#10131a', '#0b0e14', '#13121b', '#0e1116', '#15111a', '#0c1219'];
  const SODIUM = hexRgb('#ff9a3c');
  const TAIL = [255, 34, 56];

  function buildScene(seed, plate) {
    const r = HD.rng(seed);
    const pitch = r.range(15.2, 16.4) * DEG;
    const cam = {
      x: r.range(-0.7, -0.2),
      h: r.range(4.8, 5.1),
      f: 1100,
      cx: r.range(566, 600),
      cy: SRC_H / 2,
      sin: Math.sin(pitch),
      cos: Math.cos(pitch),
    };
    const P = (x, y, z) => {
      const dx = x - cam.x;
      const dy = y - cam.h;
      const yc = dy * cam.cos + z * cam.sin;
      const zc = Math.max(0.05, z * cam.cos - dy * cam.sin);
      const k = cam.f / zc;
      return { x: cam.cx + dx * k, y: cam.cy - yc * k, k };
    };
    const S = { seed, cam, P, plate, horizon: cam.cy - cam.f * Math.tan(pitch) };
    const rest = r.shuffle(['#b36bff', '#ffb627', '#ff4fd8', '#2bffc6', '#ff5a36', '#7df9ff', '#8a7dff']);
    S.pal = ['#ff2a6d', '#5ff3ff', '#ff2a6d', '#5ff3ff', rest[0], rest[1], rest[2]].map(hexRgb);
    S.car = { x: r.range(1.6, 1.9), z: r.range(8.3, 8.9), yaw: r.range(-4.5, -1.5) * DEG };
    S.zStop = S.car.z + 4.7 + r.range(0.6, 1.0);
    S.zc0 = S.zStop + 0.8;
    S.zc1 = S.zc0 + 3.2;
    S.zx0 = S.zc1 + 0.5;
    S.zx1 = S.zx0 + r.range(11, 14);
    S.zf0 = S.zx1 + 0.5;
    S.zf1 = S.zf0 + 3.2;
    S.zb = S.zf1 + 1.2;
    S.zo = r.range(56, 74);
    S.wind = r.range(0.12, 0.28) * r.sign();
    S.refl = [];

    // buildings along both facades, beyond the cross street
    S.buildings = [];
    S.blades = [];
    // Paris among the pseudo-glyph blades: a green pharmacy cross on one side, a tabac "carotte" on
    // the other, and stacked HÔTEL / BAR lettering
    const special = { '-1': 'cross', 1: 'tabac' };
    if (r.chance(0.5)) [special[-1], special[1]] = [special[1], special[-1]];
    for (const side of [-1, 1]) {
      let z = S.zb;
      let first = true;
      while (z < 330) {
        const w = first ? r.range(16, 24) : r.range(6, 19);
        const b = {
          side,
          z0: z,
          z1: z + w,
          h: r.range(24, 80),
          col: r.pick(WALL),
          lit: r.range(0.1, 0.34),
          shop: r.pick(SHOP),
          shopA: r.range(0.35, 0.85),
          strip: r.chance(0.55) ? { y: r.range(3.3, 4.4), c: r.pick(S.pal) } : null,
          strip2: r.chance(0.3) ? { y: r.range(6, 11), c: r.pick(S.pal) } : null,
          seed: r.int(1, 1e9),
          front: first,
        };
        S.buildings.push(b);
        const nb = w > 11 ? r.int(1, 3) : r.int(0, 2);
        for (let i = 0; i < nb; i++) {
          let bw = r.range(0.8, 1.5);
          const s = {
            side,
            z: r.range(z + 1.2, z + w - 1.2),
            w: bw,
            h: r.range(2.8, 7.5),
            y: r.range(3.2, 5.4),
            c1: r.pick(S.pal),
            c2: r.pick(S.pal),
            seed: r.int(1, 1e9),
            kind: r.chance(0.55) ? 'word' : 'glyph',
            word: r.pick(['HÔTEL', 'BAR', 'HÔTEL', 'CAFÉ', 'BAR', 'CLUB']),
          };
          if (special[side] && r.chance(0.75)) {
            s.kind = special[side];
            special[side] = null;
          }
          if (s.kind === 'cross') {
            s.w = bw = r.range(1.0, 1.25);
            s.h = bw;
            s.y = r.range(3.6, 4.4);
            s.c1 = s.c2 = [43, 255, 136];
          } else if (s.kind === 'tabac') {
            s.w = bw = r.range(0.62, 0.75);
            s.h = bw * 2.7;
            s.c1 = s.c2 = [255, 38, 58];
          } else if (s.kind === 'word') {
            s.h = Math.max(s.h, [...s.word].length * bw * 0.8 + bw * 0.35);
          }
          S.blades.push(s);
          const xa = side * FX;
          const xb = side * (FX - bw);
          S.refl.push({ x0: Math.min(xa, xb), x1: Math.max(xa, xb), y0: s.y, y1: s.y + s.h, z: s.z, rgb: s.c1, a: 0.42, seed: s.seed });
        }
        z += w + (r.chance(0.2) ? r.range(2.5, 5) : 0);
        first = false;
      }
    }
    // billboards on the first far block faces (facing the camera)
    S.boards = [];
    const metroSide = r.sign();
    for (const side of [-1, 1]) {
      if (side !== metroSide && !r.chance(0.9)) continue;
      const x0 = side * (FX + r.range(1.0, 2.4));
      const w = r.range(5.5, 9);
      const bd = {
        side,
        xl: side < 0 ? x0 - w : x0,
        w,
        y: r.range(3.6, 4.8),
        h: r.range(3.2, 5.2),
        z: S.zb - 0.06,
        c1: r.pick(S.pal),
        c2: r.pick(S.pal),
        kind: side === metroSide ? 'metro' : r.pick(['word', 'word', 'glyph', 'bars', 'ring']),
        word: r.pick(['CINÉMA', 'CABARET', 'HÔTEL', 'CAFÉ']),
        seed: r.int(1, 1e9),
      };
      if (bd.kind === 'metro') bd.c1 = [255, 196, 60];
      S.boards.push(bd);
      S.refl.push({ x0: bd.xl, x1: bd.xl + w, y0: bd.y, y1: bd.y + bd.h, z: bd.z, rgb: bd.c1, a: 0.5, seed: bd.seed });
    }
    // streetlights, paired either side of the road
    S.lamps = [];
    for (let z = r.range(9, 14); z < 170; z += r.range(19, 24)) {
      for (const side of [-1, 1]) {
        const lz = z + (side > 0 ? r.range(0, 4) : 0);
        const on = r.chance(0.94);
        S.lamps.push({ side, z: lz, on });
        if (on) S.refl.push({ x0: side * 4.6 - 0.35, x1: side * 4.6 + 0.35, y0: 7.45, y1: 7.7, z: lz, rgb: SODIUM, a: 0.75, seed: r.int(1, 1e9) });
      }
    }
    // the signal our car is waiting at: red
    S.signal = { x: r.range(2.2, 3.4), z: S.zx0 + 0.7 };
    S.refl.push({ x0: S.signal.x - 0.16, x1: S.signal.x + 0.16, y0: 6.05, y1: 6.35, z: S.signal.z, rgb: [255, 40, 50], a: 0.85, seed: r.int(1, 1e9) });
    // overpass neon underglow
    S.overC = r.pick(S.pal);
    S.refl.push({ x0: -RX - 2, x1: RX + 2, y0: 8.55, y1: 8.75, z: S.zo, rgb: S.overC, a: 0.3, seed: r.int(1, 1e9) });

    // other traffic
    S.cars = [];
    if (r.chance(0.85)) S.cars.push({ x: -r.range(1.5, 2.2), z: S.zx1 + r.range(4, 14), dir: -1, kind: 'car' });
    S.cars.push({ x: -r.range(4.7, 5.5), z: r.range(55, 110), dir: -1, kind: r.pick(['car', 'van']) });
    S.cars.push({ x: r.range(1.4, 2.1), z: r.range(40, 64), dir: 1, kind: 'car' });
    if (r.chance(0.65)) S.cars.push({ x: r.range(4.7, 5.5), z: r.range(75, 140), dir: 1, kind: r.pick(['van', 'car']) });
    for (const v of S.cars) {
      v.col = r.pick(['#1a1d22', '#23262c', '#2a1e22', '#1c2430', '#30343a']);
      if (v.dir < 0) S.refl.push({ x0: v.x - 0.85, x1: v.x + 0.85, y0: 0.55, y1: 0.72, z: v.z, rgb: [200, 220, 255], a: 0.55, seed: r.int(1, 1e9) });
      else S.refl.push({ x0: v.x - 0.85, x1: v.x + 0.85, y0: 0.62, y1: 0.74, z: v.z, rgb: TAIL, a: 0.55, seed: r.int(1, 1e9) });
    }
    S.cross = r.chance(0.55) ? { x: -r.range(6.5, 11), z: S.zx0 + r.range(2.5, 5), col: r.pick(['#2a2e36', '#3a2a30', '#1f2a36']) } : null;
    S.far = Array.from({ length: 16 }, () => ({ x: r.range(-6, 6), z: r.range(130, 320) }));

    // rain, splashes, drops on the lens and on the car
    const N = 1700;
    S.rain = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      const y = r.range(-20, SRC_H);
      const near = Math.max(0, y / SRC_H);
      S.rain[i * 4] = r.range(-20, SRC_W + 20);
      S.rain[i * 4 + 1] = y;
      S.rain[i * 4 + 2] = (7 + 26 * near * near) * r.range(0.6, 1.25);
      S.rain[i * 4 + 3] = r.range(0.05, 0.13);
    }
    S.splash = [];
    for (let i = 0; i < 90; i++) {
      const x = r.range(-RX - 3, RX + 3);
      const z = r.range(3.5, 60);
      S.splash.push({ x, z, s: r.range(0.08, 0.2) });
    }
    S.drops = Array.from({ length: 60 }, () => [r.range(-0.8, 0.8), r.range(0, 1), r.range(0.5, 1.4)]);

    carGeom(S);
    // lens drops away from the subject
    S.lens = [];
    for (let i = 0; i < 40 && S.lens.length < 6; i++) {
      const d = { x: r.range(160, 1180), y: r.range(40, 820), r: r.range(9, 26) };
      const cb = S.carBox;
      if (d.x > cb.x - 60 && d.x < cb.x + cb.w + 60 && d.y > cb.y - 60 && d.y < cb.y + cb.h + 60) continue;
      S.lens.push(d);
    }
    // detection candidates (other vehicles, signal, boards) for the acquire overlay
    S.objs = [];
    for (const v of S.cars) {
      const l = v.kind === 'van' ? 5 : 4.5;
      const hh = v.kind === 'van' ? 2.1 : 1.4;
      const zz = v.dir > 0 ? v.z : v.z - l;
      const b = bbox([P(v.x - 0.9, 0, zz), P(v.x + 0.9, 0, zz), P(v.x - 0.9, hh, zz + l), P(v.x + 0.9, hh, zz), P(v.x - 0.9, 0, zz + l)]);
      if (b.w > 6) S.objs.push({ b, label: 'VEH', conf: r.range(0.31, 0.72) });
    }
    const sb = bbox([P(S.signal.x - 0.3, 5.3, S.signal.z), P(S.signal.x + 0.3, 6.5, S.signal.z)]);
    S.objs.push({ b: sb, label: 'SIGNAL', conf: r.range(0.5, 0.8) });
    for (const bd of S.boards) {
      const b = bbox([P(bd.xl, bd.y, bd.z), P(bd.xl + bd.w, bd.y + bd.h, bd.z)]);
      S.objs.push({ b, label: 'SIGN', conf: r.range(0.2, 0.5) });
    }
    return S;
  }

  function carFrame(S) {
    const c = S.car;
    const cs = Math.cos(c.yaw);
    const sn = Math.sin(c.yaw);
    return (X, Y, Z) => S.P(c.x + X * cs + Z * sn, Y, c.z - X * sn + Z * cs);
  }
  function carGeom(S) {
    const W = carFrame(S);
    S.carBox = bbox([W(-0.93, 0.2, 0.1), W(0.92, 0.2, 0.08), W(-0.93, 0.2, 4.6), W(-0.64, 1.35, 2.85), W(0.64, 1.35, 2.85), W(0.86, 0.92, 0), W(-0.92, 0.9, 4.6)]);
    // a French SIV plate is 520 × 110 mm; plate-local units are millimetres
    const tl = W(-0.26, 0.535, -0.012);
    const tr = W(0.26, 0.535, -0.012);
    const bl = W(-0.26, 0.425, -0.012);
    const br = W(0.26, 0.425, -0.012);
    S.plateM = [(tr.x - tl.x) / PLATE_W, (tr.y - tl.y) / PLATE_W, (bl.x - tl.x) / PLATE_H, (bl.y - tl.y) / PLATE_H, tl.x, tl.y];
    S.plateBox = bbox([tl, tr, bl, br]);
  }

  // Character cells of a SIV plate ('AB-123-CD') in plate millimetres, shared by the painter and the OCR grid.
  const PLATE_W = 520;
  const PLATE_H = 110;
  const TXT_X0 = 52;
  const TXT_X1 = 468;
  function plateCells(txt) {
    const chars = [...txt];
    const unit = (TXT_X1 - TXT_X0) / chars.reduce((a, ch) => a + (ch === '-' ? 0.55 : 1), 0);
    let x = TXT_X0;
    return chars.map((ch) => {
      const w = unit * (ch === '-' ? 0.55 : 1);
      const c = { ch, sep: ch === '-', x0: x, x1: x + w, cx: x + w / 2, y0: 17, y1: 93 };
      x += w;
      return c;
    });
  }

  /* ------------------------------------------------------------------ paint */

  let asphalt = null;
  function asphaltTile() {
    if (asphalt) return asphalt;
    asphalt = mk(96, 96, true);
    const id = asphalt.g.createImageData(96, 96);
    for (let i = 0; i < id.data.length; i += 4) {
      const v = Math.random();
      const lum = v > 0.5 ? 255 : 0;
      id.data[i] = id.data[i + 1] = id.data[i + 2] = lum;
      id.data[i + 3] = Math.abs(v - 0.5) * 34;
    }
    asphalt.g.putImageData(id, 0, 0);
    return asphalt;
  }

  const gq = (P, x0, x1, z0, z1, y = 0) => [P(x0, y, z0), P(x1, y, z0), P(x1, y, z1), P(x0, y, z1)];

  function paintSky(g, S) {
    const hy = S.horizon;
    const sky = g.createLinearGradient(0, 0, 0, hy + 30);
    sky.addColorStop(0, '#05060c');
    sky.addColorStop(0.6, '#150b1d');
    sky.addColorStop(1, '#3a1a2c');
    g.fillStyle = sky;
    g.fillRect(0, 0, SRC_W, hy + 30);
    const glow = g.createRadialGradient(S.cam.cx, hy, 0, S.cam.cx, hy, 380);
    glow.addColorStop(0, 'rgba(255,120,90,0.35)');
    glow.addColorStop(0.4, 'rgba(180,40,110,0.16)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, SRC_W, hy + 30);
    // distant megastructures at the end of the canyon
    const r = HD.rng(S.seed ^ 0x51c7);
    for (let i = 0; i < 22; i++) {
      const w = r.range(8, 34);
      const x = S.cam.cx + r.range(-160, 160) - w / 2;
      const h = r.range(20, 150);
      g.fillStyle = r.pick(['#0a0a12', '#0d0b14', '#100c16']);
      g.fillRect(x, hy - h, w, h + 4);
      g.fillStyle = 'rgba(255,190,140,0.35)';
      for (let k = 0; k < 6; k++) if (r.chance(0.5)) g.fillRect(x + r.range(1, w - 2), hy - r.range(4, h), 1, 1);
      if (h > 90) {
        g.fillStyle = 'rgba(255,40,60,0.9)';
        g.fillRect(x + w / 2 - 1, hy - h - 1, 2, 2);
      }
    }
  }

  // The Eiffel Tower down the canyon, gold-lit with its beacon: the one Paris cue that survives 1/10 res.
  function paintTower(g, S, hy) {
    const r = HD.rng(S.seed ^ 0xe1ffe1);
    const cx = S.cam.cx + r.range(-46, 46);
    const base = hy + 8;
    // tall enough that the spire and beacon clear the overpass deck
    const ht = Math.max(70, hy + r.range(0, 8));
    const B = ht * 0.21;
    // flared legs into a long, slowly tapering upper shaft (top platform ≈ 1/8 of the base)
    const hw = (t) => B * (Math.pow(1 - t, 2.4) * 0.8 + 0.2 * (1 - 0.5 * t));
    const Y = (t) => base - t * ht;
    g.save();
    const halo = g.createRadialGradient(cx, Y(0.35), 0, cx, Y(0.35), ht * 0.75);
    halo.addColorStop(0, 'rgba(255,160,60,0.2)');
    halo.addColorStop(1, 'rgba(255,120,40,0)');
    g.fillStyle = halo;
    g.fillRect(cx - ht, Y(1.1), ht * 2, ht * 1.3);
    g.beginPath();
    for (let i = 0; i <= 24; i++) {
      const t = (i / 24) * 0.94;
      g.lineTo(cx - hw(t), Y(t));
    }
    for (let i = 24; i >= 0; i--) {
      const t = (i / 24) * 0.94;
      g.lineTo(cx + hw(t), Y(t));
    }
    g.closePath();
    const body = g.createLinearGradient(0, Y(0), 0, Y(1));
    body.addColorStop(0, 'rgba(255,168,64,0.95)');
    body.addColorStop(0.5, 'rgba(255,186,92,0.85)');
    body.addColorStop(1, 'rgba(255,214,150,0.8)');
    g.fillStyle = body;
    g.fill();
    g.clip();
    // lattice, platforms and the arch between the legs
    g.strokeStyle = 'rgba(70,30,10,0.55)';
    g.lineWidth = 0.7;
    g.beginPath();
    for (let x = -B; x < B; x += 3) {
      g.moveTo(cx + x, base);
      g.lineTo(cx + x + ht * 0.3, base - ht * 0.6);
      g.moveTo(cx - x, base);
      g.lineTo(cx - x - ht * 0.3, base - ht * 0.6);
    }
    g.stroke();
    g.fillStyle = 'rgba(40,16,8,0.8)';
    for (const [t, th] of [[0.11, 0.022], [0.39, 0.016], [0.9, 0.012]]) g.fillRect(cx - hw(t) - 2, Y(t), hw(t) * 2 + 4, th * ht);
    g.fillStyle = '#1a0c16';
    g.beginPath();
    g.ellipse(cx, base, hw(0) * 0.5, ht * 0.085, 0, Math.PI, 0);
    g.fill();
    g.restore();
    // antenna, beacon and sparkle
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.strokeStyle = 'rgba(255,220,170,0.9)';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(cx, Y(0.93));
    g.lineTo(cx, Y(1.02));
    g.stroke();
    const top = Y(1.0);
    for (const sgn of [-1, 1]) {
      const bg = g.createLinearGradient(cx, top, cx + sgn * 260, top - 40);
      bg.addColorStop(0, 'rgba(255,240,200,0.3)');
      bg.addColorStop(1, 'rgba(255,240,200,0)');
      g.fillStyle = bg;
      g.beginPath();
      g.moveTo(cx, top);
      g.lineTo(cx + sgn * 260, top - 58 + r.range(-10, 10));
      g.lineTo(cx + sgn * 260, top - 26 + r.range(-10, 10));
      g.closePath();
      g.fill();
    }
    glowDot(g, cx, top, 9, [255, 236, 190], 0.95);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    for (let i = 0; i < 26; i++) {
      const t = r.range(0.02, 0.9);
      const x = cx + r.range(-1, 1) * hw(t) * 0.9;
      g.fillRect(x, Y(t), 1.1, 1.1);
    }
    g.restore();
  }

  function* groundSteps(g, S, o) {
    const { P } = S;
    const hy = S.horizon;
    g.fillStyle = '#08090c';
    g.fillRect(0, hy - 2, SRC_W, SRC_H - hy + 2);
    const road = g.createLinearGradient(0, hy, 0, SRC_H);
    road.addColorStop(0, '#2a1c28');
    road.addColorStop(0.07, '#17141b');
    road.addColorStop(0.35, '#0e0f13');
    road.addColorStop(1, '#0a0b0e');
    g.fillStyle = road;
    poly(g, gq(P, -RX, RX, 0.6, 3000));
    g.fill();
    poly(g, gq(P, -90, 90, S.zx0 - 0.3, S.zx1 + 0.3));
    g.fill();
    yield 'ground';
    // sidewalks (near block and far blocks), slightly lighter wet concrete
    const walk = g.createLinearGradient(0, hy, 0, SRC_H);
    walk.addColorStop(0, '#2a2230');
    walk.addColorStop(0.1, '#17161d');
    walk.addColorStop(1, '#121318');
    g.fillStyle = walk;
    for (const s of [-1, 1]) {
      poly(g, gq(P, s * (RX + 0.15), s * (FX + 0.2), 0.6, S.zc0 - 0.7));
      g.fill();
      poly(g, gq(P, s * (RX + 0.15), s * (FX + 0.2), S.zf1 + 0.3, 3000));
      g.fill();
      // corner walk along the cross street
      poly(g, gq(P, s * (RX + 0.15), s * 60, S.zc0 - 3.2, S.zc0 - 0.7));
      g.fill();
      poly(g, gq(P, s * (RX + 0.15), s * 60, S.zf1 + 0.3, S.zb));
      g.fill();
    }
    // curbs catch the light
    g.strokeStyle = 'rgba(150,160,175,0.28)';
    g.lineWidth = 1.2;
    g.beginPath();
    for (const s of [-1, 1]) {
      let a = P(s * RX, 0.12, 0.6);
      let b = P(s * RX, 0.12, S.zc0 - 0.7);
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      a = P(s * RX, 0.12, S.zf1 + 0.3);
      b = P(s * RX, 0.12, 3000);
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
    }
    g.stroke();
    yield 'walks';
    if (!o.cull) {
      // asphalt grain, a band per step
      const bh = (SRC_H - hy) / 4;
      for (let y = hy; y < SRC_H - 1; y += bh) {
        g.save();
        g.globalAlpha = 0.9;
        g.fillStyle = g.createPattern(asphaltTile(), 'repeat');
        g.fillRect(0, y, SRC_W, bh);
        g.restore();
        yield 'asphalt';
      }
    }
    // glossy puddles pick up the sky glow
    const r = HD.rng(S.seed ^ 0x9d1e);
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 16; i++) {
      const x = r.range(-RX, RX);
      const z = r.range(4, 45);
      const c = P(x, 0, z);
      const e = P(x + 1, 0, z);
      const f = P(x, 0, z + 1);
      g.save();
      g.transform(e.x - c.x, e.y - c.y, f.x - c.x, f.y - c.y, c.x, c.y);
      const rr = r.range(0.8, 2.6);
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, rr);
      gr.addColorStop(0, 'rgba(90,60,100,0.16)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.scale(1, r.range(0.5, 1.4));
      g.fillRect(-rr, -rr, rr * 2, rr * 2);
      g.restore();
    }
    g.restore();
  }

  function paintMarkings(g, S) {
    const { P } = S;
    const r = HD.rng(S.seed ^ 0x3a7c);
    const q = (x0, x1, z0, z1, col) => {
      g.fillStyle = col;
      poly(g, gq(P, x0, x1, z0, z1, 0.005));
      g.fill();
    };
    const yel = 'rgba(232,176,60,0.5)';
    const wht = (a) => `rgba(215,225,232,${a})`;
    // double centre line, broken by the intersection
    for (const x of [-0.2, 0.08]) {
      q(x, x + 0.12, 0.6, S.zc0 - 0.9, yel);
      q(x, x + 0.12, S.zf1 + 1, 3000, yel);
    }
    // dashed lane dividers + solid edges
    for (const x of [-3.5, 3.5]) {
      for (let z = 1; z < 300; z += 9) {
        if (z + 3 > S.zc0 - 1 && z < S.zf1 + 1) continue;
        q(x - 0.07, x + 0.07, z, z + 3, wht(r.range(0.28, 0.5)));
      }
    }
    for (const s of [-1, 1]) {
      q(s * 6.8 - 0.07, s * 6.8 + 0.07, 0.6, S.zc0 - 0.9, wht(0.35));
      q(s * 6.8 - 0.07, s * 6.8 + 0.07, S.zf1 + 1, 3000, wht(0.35));
    }
    // stop line
    q(0.25, 6.8, S.zStop, S.zStop + 0.45, wht(0.55));
    // zebra crossings, worn
    for (const [z0, z1] of [[S.zc0, S.zc1], [S.zf0, S.zf1]]) {
      for (let x = -6.6; x < 6.6; x += 1.05) {
        q(x, x + 0.56, z0, z1, wht(r.range(0.22, 0.42)));
        // wear patches
        for (let k = 0; k < 2; k++) {
          const wz = r.range(z0, z1 - 0.5);
          q(x + r.range(0, 0.3), x + r.range(0.3, 0.56), wz, wz + r.range(0.2, 0.6), 'rgba(12,13,17,0.55)');
        }
      }
    }
    // lane arrows on the far side
    g.fillStyle = wht(0.3);
    for (const x of [1.75, 5.25]) {
      const z = S.zf1 + 5;
      const a = P(x - 0.12, 0, z);
      const b = P(x + 0.12, 0, z);
      const c = P(x + 0.12, 0, z + 3);
      const d = P(x + 0.4, 0, z + 3);
      const e = P(x, 0, z + 4.5);
      const f = P(x - 0.4, 0, z + 3);
      const h = P(x - 0.12, 0, z + 3);
      poly(g, [a, b, c, d, e, f, h]);
      g.fill();
    }
  }

  function groundGlow(g, S, x, z, rad, rgb, a) {
    const { P } = S;
    const c = P(x, 0, z);
    const e = P(x + 1, 0, z);
    const f = P(x, 0, z + 1);
    g.save();
    g.transform(e.x - c.x, e.y - c.y, f.x - c.x, f.y - c.y, c.x, c.y);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, rad);
    gr.addColorStop(0, css(rgb, a));
    gr.addColorStop(0.35, css(rgb, a * 0.45));
    gr.addColorStop(1, css(rgb, 0));
    g.fillStyle = gr;
    g.fillRect(-rad, -rad, rad * 2, rad * 2);
    g.restore();
  }

  function* poolSteps(g, S) {
    const glows = [];
    for (const l of S.lamps) if (l.on) glows.push([l.side * 4.6, l.z, 7, SODIUM, 0.32]);
    // shopfront spill onto the far sidewalks
    for (const b of S.buildings) {
      if (b.z0 > 120) continue;
      glows.push([b.side * (FX - 1.4), (b.z0 + b.z1) / 2, Math.min(7, (b.z1 - b.z0) * 0.6), b.shop, 0.16 * b.shopA]);
    }
    glows.push([S.signal.x, S.signal.z - 2, 5, [255, 30, 40], 0.12]);
    for (let i = 0; i < glows.length; i += 8) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      for (const gl of glows.slice(i, i + 8)) groundGlow(g, S, ...gl);
      g.restore();
      yield 'pools';
    }
  }

  // a smear of vertical streaks with rippled slivers: how a light reads on wet asphalt
  function streaks(g, r, l, wdt, top, bot, rgb, a) {
    const span = bot - top;
    if (span < 2) return;
    const gr = g.createLinearGradient(0, top, 0, bot);
    gr.addColorStop(0, css(rgb, a));
    gr.addColorStop(0.3, css(rgb, a * 0.5));
    gr.addColorStop(1, css(rgb, 0));
    g.fillStyle = gr;
    const n = Math.max(1, Math.min(16, Math.round(wdt / 2.2)));
    const cw = wdt / n;
    for (let i = 0; i < n; i++) {
      g.globalAlpha = r.range(0.35, 1);
      g.fillRect(l + i * cw + r.range(-0.3, 0.3) * cw, top, cw * r.range(0.6, 1.2), span * r.range(0.4, 1));
    }
    g.globalAlpha = 1;
    const step = Math.max(1.5, span / 70);
    g.fillStyle = css(whiten(rgb, 0.3), 1);
    for (let y = top; y < bot; y += step) {
      if (r() < 0.4) continue;
      const t = (y - top) / span;
      g.globalAlpha = a * 0.45 * (1 - t) * (1 - t);
      const ww = wdt * r.range(0.25, 1.1);
      g.fillRect(l + (wdt - ww) / 2 + (r() - 0.5) * wdt * 0.7, y, ww, 0.8);
    }
    g.globalAlpha = 1;
  }

  // wet-road reflection of an emitter: mirrored under the ground plane and stretched toward the lens
  function reflect(g, S, e) {
    const { P } = S;
    const xm = (e.x0 + e.x1) / 2;
    const top = P(xm, -e.y0 * 0.85, e.z).y;
    const bot = P(xm, -e.y1 * 1.5 - 0.6, e.z).y;
    const l = P(e.x0, -e.y0, e.z).x;
    const rr = P(e.x1, -e.y0, e.z).x;
    if (bot <= S.horizon || top > SRC_H || l > SRC_W + 40 || rr < -40) return;
    streaks(g, HD.rng(e.seed), l, Math.max(1.2, rr - l), top, Math.min(bot, SRC_H + 40), e.rgb, e.a);
  }

  function carReflect(g, S) {
    const W = carFrame(S);
    const rr = HD.rng(S.seed ^ 0x7a11);
    const l = W(-0.84, 0, -0.05);
    const rt = W(0.84, 0, -0.05);
    const top = Math.min(l.y, rt.y) + 1;
    const bot = W(0, -2.4, -0.05).y;
    streaks(g, rr, l.x, rt.x - l.x, top, bot, TAIL, 0.5);
    const cwid = Math.max(3, (rt.x - l.x) * 0.06);
    streaks(g, rr, l.x - cwid * 0.3, cwid, top, bot + 14, whiten(TAIL, 0.35), 0.7);
    streaks(g, rr, rt.x - cwid * 0.7, cwid, top, bot + 14, whiten(TAIL, 0.35), 0.7);
  }

  // All wet-road reflections go into a quarter-width, half-height layer that is composited back
  // smoothed: the cheap way to get a soft, mostly-horizontal blur without a filter.
  function* reflectionSteps(g, S, o) {
    const tw = g.canvas.width;
    const th = g.canvas.height;
    const L = mk(Math.ceil(tw / 4), Math.ceil(th / 2), true);
    const m = g.getTransform();
    L.g.setTransform(m.a / 4, m.b / 2, m.c / 4, m.d / 2, m.e / 4, m.f / 2);
    L.g.globalCompositeOperation = 'lighter';
    if (!o.cull) {
      for (let i = 0; i < S.refl.length; i += 16) {
        for (let k = i; k < Math.min(S.refl.length, i + 16); k++) reflect(L.g, S, S.refl[k]);
        L.g.getImageData(0, 0, 1, 1);
        yield 'refl';
      }
      paintShopRefl(L.g, S);
    }
    carReflect(L.g, S);
    L.g.getImageData(0, 0, 1, 1);
    yield 'refl-car';
    yield* bands(g, tw, th, o.cull ? 3 : 5, 'refl-composite', () => g.drawImage(L, 0, 0, tw, th));
  }

  // runs a device-space draw clipped to horizontal bands, one step per band; clipping keeps the
  // resampling seamless while each slice only rasterises its own rows
  function* bands(g, tw, th, n, label, draw) {
    for (let i = 0; i < n; i++) {
      const y0 = Math.floor((th * i) / n);
      const y1 = Math.floor((th * (i + 1)) / n);
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.beginPath();
      g.rect(0, y0, tw, y1 - y0);
      g.clip();
      g.globalCompositeOperation = 'lighter';
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'low'; // plain bilinear: these are all soft upscales
      draw();
      g.restore();
      yield label;
    }
  }

  // shopfronts mirrored into the wet sidewalk
  function paintShopRefl(g, S) {
    for (const b of S.buildings) {
      if (b.z0 > 150) continue;
      const x = b.side * FX;
      const q = [P0(S, x, -0.15, b.z0 + 0.5), P0(S, x, -0.15, b.z1 - 0.5), P0(S, x, -4.4, b.z1 - 0.5), P0(S, x, -4.4, b.z0 + 0.5)];
      const bb = bbox(q);
      if (!onCanvas(bb)) continue;
      const gr = g.createLinearGradient(0, bb.y, 0, bb.y + bb.h);
      gr.addColorStop(0, css(b.shop, 0.3 * b.shopA));
      gr.addColorStop(1, css(b.shop, 0));
      g.fillStyle = gr;
      poly(g, q);
      g.fill();
    }
  }
  const P0 = (S, x, y, z) => S.P(x, y, z);

  function paintFacade(g, S, b) {
    const { P } = S;
    const x = b.side * FX;
    const top = Math.min(b.h, 48);
    const q = [P(x, 0, b.z0), P(x, 0, b.z1), P(x, top, b.z1), P(x, top, b.z0)];
    const bb = bbox(q);
    if (!onCanvas(bb)) return;
    g.fillStyle = b.col;
    poly(g, q);
    g.fill();
    // street-level light washing up the wall
    const zm = (b.z0 + b.z1) / 2;
    const g0 = P(x, 0, zm);
    const g1 = P(x, 12, zm);
    const wash = g.createLinearGradient(0, g0.y, 0, g1.y);
    wash.addColorStop(0, css(b.shop, 0.2));
    wash.addColorStop(1, css(b.shop, 0));
    g.fillStyle = wash;
    g.fill();
    // window grid
    const r = HD.rng(b.seed);
    for (let fy = 4.4; fy < top - 2; fy += 3.4) {
      for (let wz = b.z0 + 0.7; wz < b.z1 - 1.5; wz += 2.3) {
        const lit = r() < b.lit;
        const tint = r.pick(SHOP);
        const lum = r.range(0.25, 0.8);
        const a = P(x, fy, wz);
        const c = P(x, fy + 1.9, wz + 1.4);
        if (Math.abs(c.x - a.x) < 0.6 || a.y < -30 || c.x < -30 || c.x > SRC_W + 30) continue;
        g.fillStyle = lit ? css(tint, lum) : 'rgba(22,28,40,0.7)';
        poly(g, [a, P(x, fy, wz + 1.4), c, P(x, fy + 1.9, wz)]);
        g.fill();
      }
    }
    // shopfront: bright interior, mullions, awning
    const s0 = P(x, 0.25, b.z0 + 0.4);
    const s1 = P(x, 0.25, b.z1 - 0.4);
    const s2 = P(x, 3.0, b.z1 - 0.4);
    const s3 = P(x, 3.0, b.z0 + 0.4);
    const sg = g.createLinearGradient(0, s0.y, 0, s3.y);
    sg.addColorStop(0, css(whiten(b.shop, 0.15), b.shopA * 0.85));
    sg.addColorStop(1, css(b.shop, b.shopA * 0.45));
    g.fillStyle = sg;
    poly(g, [s0, s1, s2, s3]);
    g.fill();
    // some bays are shuttered
    for (let z = b.z0 + 0.4; z < b.z1 - 0.6; z += 3.2) {
      if (r() > 0.3) continue;
      g.fillStyle = 'rgba(14,14,20,0.92)';
      poly(g, [P(x, 0.25, z), P(x, 0.25, Math.min(b.z1 - 0.4, z + 3)), P(x, 3.0, Math.min(b.z1 - 0.4, z + 3)), P(x, 3.0, z)]);
      g.fill();
    }
    g.strokeStyle = 'rgba(8,8,12,0.6)';
    g.lineWidth = 0.8;
    g.beginPath();
    for (let z = b.z0 + 3.6; z < b.z1 - 0.5; z += 3.2) {
      const a = P(x, 0.25, z);
      const c = P(x, 3.0, z);
      g.moveTo(a.x, a.y);
      g.lineTo(c.x, c.y);
    }
    g.stroke();
    g.fillStyle = 'rgba(10,8,14,0.85)';
    poly(g, [P(x, 3.0, b.z0 + 0.2), P(x, 3.0, b.z1 - 0.2), P(x, 3.5, b.z1 - 0.2), P(x, 3.5, b.z0 + 0.2)]);
    g.fill();
    for (const st of [b.strip, b.strip2]) {
      if (!st || st.y > top) continue;
      const a = P(x - b.side * 0.05, st.y, b.z0 + 0.3);
      const c = P(x - b.side * 0.05, st.y, b.z1 - 0.3);
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(c.x, c.y);
      neon(g, st.c, Math.max(0.6, 0.09 * a.k));
    }
  }

  function paintFront(g, S, b) {
    const { P } = S;
    const x0 = b.side * FX;
    const x1 = b.side * (FX + 40);
    const top = Math.min(b.h, 48);
    const z = b.z0;
    const q = [P(x0, 0, z), P(x1, 0, z), P(x1, top, z), P(x0, top, z)];
    if (!onCanvas(bbox(q))) return;
    g.fillStyle = b.col;
    poly(g, q);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.025)';
    g.fill();
    const r = HD.rng(b.seed ^ 0x77);
    for (let fy = 4.4; fy < top - 2; fy += 3.4) {
      for (let wx = FX + 0.8; wx < FX + 38; wx += 2.4) {
        const lit = r() < b.lit;
        const tint = r.pick(SHOP);
        const lum = r.range(0.25, 0.8);
        const xa = b.side * wx;
        const xb = b.side * (wx + 1.5);
        const a = P(Math.min(xa, xb), fy + 1.9, z);
        const c = P(Math.max(xa, xb), fy, z);
        if (a.x > SRC_W + 20 || c.x < -20 || a.y < -30) continue;
        g.fillStyle = lit ? css(tint, lum) : 'rgba(22,28,40,0.7)';
        g.fillRect(a.x, a.y, c.x - a.x, c.y - a.y);
      }
    }
    // ground floor: shop bays, some shuttered, each with an awning and a small sign
    for (let wx = FX + 0.3; wx < FX + 38; ) {
      const bw = r.range(3.5, 6.5);
      const shut = r() < 0.28;
      const col = r.pick(SHOP);
      const alpha = r.range(0.3, 0.75);
      const sc = r.pick(S.pal);
      const xa = b.side * wx;
      const xb = b.side * (wx + bw - 0.3);
      const tl = P(Math.min(xa, xb), 3.0, z);
      const br = P(Math.max(xa, xb), 0.25, z);
      wx += bw;
      if (tl.x > SRC_W + 20 || br.x < -20) continue;
      if (shut) {
        g.fillStyle = '#121219';
        g.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
        g.fillStyle = 'rgba(255,255,255,0.04)';
        for (let yy = tl.y; yy < br.y; yy += 2) g.fillRect(tl.x, yy, br.x - tl.x, 0.7);
      } else {
        const sg = g.createLinearGradient(0, br.y, 0, tl.y);
        sg.addColorStop(0, css(whiten(col, 0.2), alpha));
        sg.addColorStop(1, css(col, alpha * 0.45));
        g.fillStyle = sg;
        g.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
        g.fillStyle = 'rgba(6,6,10,0.55)';
        const mw = Math.max(0.8, (br.x - tl.x) * 0.03);
        g.fillRect(tl.x + (br.x - tl.x) * 0.5, tl.y, mw, br.y - tl.y);
      }
      const aw = P(Math.min(xa, xb), 3.45, z);
      g.fillStyle = '#0a090e';
      g.fillRect(tl.x, aw.y, br.x - tl.x, tl.y - aw.y);
      g.fillStyle = css(sc, 0.55);
      g.fillRect(tl.x, tl.y - 1, br.x - tl.x, 1.2);
      if (r() < 0.6) {
        const s0 = P(Math.min(xa, xb) + 0.6, 4.3, z);
        const s1 = P(Math.min(xa, xb) + 0.6 + Math.min(3, bw * 0.6), 3.65, z);
        g.save();
        g.beginPath();
        g.rect(s0.x, s0.y, s1.x - s0.x, s1.y - s0.y);
        g.fillStyle = css(sc, 0.12);
        g.fill();
        neon(g, sc, Math.max(0.5, 0.05 * s0.k));
        const gs = (s1.y - s0.y) * 0.6;
        if (r() < 0.55) {
          const word = r.pick(['BAR', 'CAFÉ', 'TABAC', 'HÔTEL', 'BISTRO', 'CLUB']);
          const sw = Math.abs(s1.x - s0.x);
          neonText(g, word, (s0.x + s1.x) / 2, (s0.y + s1.y) / 2, Math.min(Math.abs(s1.y - s0.y) * 0.72, sw / (word.length * 0.62)), sc);
        } else {
          g.beginPath();
          for (let gx = s0.x + gs * 0.4; gx < s1.x - gs; gx += gs * 1.3) glyph(g, r, gx, s0.y + gs * 0.33, gs);
          neon(g, sc, Math.max(0.4, 0.04 * s0.k));
        }
        g.restore();
      }
    }
  }

  function paintBlade(g, S, s) {
    const { P } = S;
    const xa = s.side * FX;
    const xb = s.side * (FX - s.w);
    const xl = Math.min(xa, xb);
    const xr = Math.max(xa, xb);
    const o = P(xl, s.y + s.h, s.z);
    const ue = P(xr, s.y + s.h, s.z);
    const ve = P(xl, s.y, s.z);
    if (!onCanvas(bbox([o, ue, ve]))) return;
    const U = 100;
    const V = (100 * s.h) / s.w;
    g.save();
    affine(g, o, ue, ve, U, V);
    if (s.kind === 'cross') {
      // pharmacie: a green cross of light in a dark square
      g.fillStyle = '#050a07';
      g.fillRect(0, 0, U, V);
      const a = U * 0.17;
      const pts = [[-a, -3 * a], [a, -3 * a], [a, -a], [3 * a, -a], [3 * a, a], [a, a], [a, 3 * a], [-a, 3 * a], [-a, a], [-3 * a, a], [-3 * a, -a], [-a, -a]];
      g.translate(U / 2, V / 2);
      g.fillStyle = css(s.c1, 0.55);
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.fill();
      neon(g, s.c1, 5);
      g.scale(0.55, 0.55);
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      neon(g, whiten(s.c1, 0.4), 6);
      g.restore();
      return;
    }
    if (s.kind === 'tabac') {
      // the red tabac "carotte": a tall lozenge with the word down its spine
      g.beginPath();
      g.moveTo(U / 2, 0);
      g.lineTo(U, V / 2);
      g.lineTo(U / 2, V);
      g.lineTo(0, V / 2);
      g.closePath();
      g.fillStyle = 'rgba(120,8,20,0.9)';
      g.fill();
      neon(g, s.c1, 5);
      const cell = (V * 0.56) / 5;
      [...'TABAC'].forEach((ch, i) => neonText(g, ch, U / 2, V * 0.22 + (i + 0.5) * cell, cell * 0.86, [255, 236, 214], 0.9));
      g.restore();
      return;
    }
    // bracket to the wall
    g.fillStyle = '#07070b';
    g.fillRect(0, 0, U, V);
    g.fillStyle = css(s.c1, 0.14);
    g.fillRect(6, 6, U - 12, V - 12);
    g.beginPath();
    g.rect(6, 6, U - 12, V - 12);
    neon(g, s.c1, 4.5);
    if (s.kind === 'word') {
      // stacked letters, the classic Paris HÔTEL blade
      const letters = [...s.word];
      const cell = Math.min(U * 0.78, (V - 20) / letters.length);
      const y0 = (V - cell * letters.length) / 2;
      letters.forEach((ch, i) => neonText(g, ch, U / 2, y0 + (i + 0.55) * cell, cell * 0.8, s.c2));
      g.restore();
      return;
    }
    const r = HD.rng(s.seed);
    const cell = U * 0.62;
    const n = Math.max(2, Math.floor((V - 24) / (cell * 1.25)));
    const gap = (V - 24 - n * cell) / Math.max(1, n - 1);
    g.beginPath();
    for (let i = 0; i < n; i++) glyph(g, r, (U - cell) / 2, 12 + i * (cell + gap), cell);
    neon(g, s.c2, 6);
    g.restore();
  }

  function paintBoard(g, S, bd) {
    const { P } = S;
    const o = P(bd.xl, bd.y + bd.h, bd.z);
    const ue = P(bd.xl + bd.w, bd.y + bd.h, bd.z);
    const ve = P(bd.xl, bd.y, bd.z);
    if (!onCanvas(bbox([o, ue, ve]))) return;
    const U = 300;
    const V = (300 * bd.h) / bd.w;
    g.save();
    affine(g, o, ue, ve, U, V);
    const gr = g.createLinearGradient(0, 0, U, V);
    gr.addColorStop(0, css(bd.c1, 0.55));
    gr.addColorStop(1, css(bd.c2, 0.3));
    g.fillStyle = '#050509';
    g.fillRect(-6, -6, U + 12, V + 12);
    g.fillStyle = gr;
    g.fillRect(0, 0, U, V);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (let y = 0; y < V; y += 6) g.fillRect(0, y, U, 2.5);
    const r = HD.rng(bd.seed);
    g.strokeStyle = css(whiten(bd.c1, 0.6), 0.85);
    g.lineWidth = 9;
    g.lineCap = 'square';
    if (bd.kind === 'metro') {
      // MÉTRO: a ringed M roundel beside the word, on deep green enamel
      g.fillStyle = '#062a22';
      g.fillRect(0, 0, U, V);
      const R0 = Math.min(V * 0.36, U * 0.16);
      const cx = R0 + V * 0.16;
      g.beginPath();
      g.arc(cx, V / 2, R0, 0, Math.PI * 2);
      neon(g, [255, 204, 70], 7);
      neonText(g, 'M', cx, V / 2 + R0 * 0.04, R0 * 1.25, [255, 214, 90]);
      const fs = Math.min(V * 0.5, (U - cx - R0 - 20) / 3.6);
      neonText(g, 'MÉTRO', (cx + R0 + U) / 2, V / 2 + fs * 0.06, fs, [255, 238, 190]);
    } else if (bd.kind === 'word') {
      const fs = Math.min(V * 0.56, (U - 30) / (bd.word.length * 0.66));
      neonText(g, bd.word, U / 2, V / 2, fs, whiten(bd.c1, 0.2));
    } else if (bd.kind === 'glyph') {
      g.beginPath();
      const s = Math.min(V * 0.6, U / 4);
      for (let i = 0; i < 3; i++) glyph(g, r, 24 + i * (s + 18), (V - s) / 2, s);
      g.stroke();
    } else if (bd.kind === 'bars') {
      g.fillStyle = css(whiten(bd.c2, 0.5), 0.8);
      for (let i = 0; i < 14; i++) {
        const h = r.range(0.2, 0.85) * V;
        g.fillRect(16 + i * 19, V - 10 - h, 12, h);
      }
    } else {
      g.beginPath();
      for (let k = 1; k <= 3; k++) g.arc(U * 0.28, V / 2, (V * 0.14 * k) / 1.1, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      const s = V * 0.4;
      glyph(g, r, U * 0.52, (V - s) / 2, s);
      glyph(g, r, U * 0.52 + s + 10, (V - s) / 2, s);
      g.stroke();
    }
    g.restore();
  }

  function paintOverpass(g, S) {
    const { P } = S;
    const z = S.zo;
    const front = [P(-80, 8.6, z), P(80, 8.6, z), P(80, 10.4, z), P(-80, 10.4, z)];
    const under = [P(-80, 8.6, z), P(80, 8.6, z), P(80, 8.6, z + 4), P(-80, 8.6, z + 4)];
    g.fillStyle = '#08080d';
    poly(g, under);
    g.fill();
    g.fillStyle = '#0c0c12';
    poly(g, front);
    g.fill();
    for (const s of [-1, 1]) {
      const a = P(s * (FX + 0.6), 8.6, z + 1);
      const c = P(s * (FX + 1.8), 0, z + 1);
      g.fillStyle = '#0a0a10';
      g.fillRect(Math.min(a.x, c.x), a.y, Math.abs(c.x - a.x), c.y - a.y);
    }
    const a = P(-80, 8.62, z);
    const c = P(80, 8.62, z);
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(c.x, c.y);
    neon(g, S.overC, Math.max(0.8, 0.07 * a.k));
    // running lights on the deck edge
    g.fillStyle = 'rgba(255,230,190,0.8)';
    for (let x = -30; x <= 30; x += 3) {
      const p = P(x, 10.2, z);
      g.fillRect(p.x - 0.8, p.y - 0.5, 1.6, 1);
    }
  }

  function glowDot(g, x, y, rad, rgb, a) {
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, css(whiten(rgb, 0.7), a));
    gr.addColorStop(0.18, css(rgb, a * 0.6));
    gr.addColorStop(1, css(rgb, 0));
    g.fillStyle = gr;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }

  function paintLamp(g, S, l) {
    const { P } = S;
    const px = l.side * (RX + 0.5);
    const hx = l.side * 4.6;
    const base = P(px, 0, l.z);
    const top = P(px, 7.9, l.z);
    const head = P(hx, 7.65, l.z);
    if (top.y > SRC_H || (base.x < -40 && head.x < -40) || (base.x > SRC_W + 40 && head.x > SRC_W + 40)) return;
    g.strokeStyle = '#15161c';
    g.lineWidth = Math.max(1, 0.18 * base.k);
    g.beginPath();
    g.moveTo(base.x, base.y);
    g.lineTo(top.x, top.y);
    g.lineTo(head.x, head.y);
    g.stroke();
    if (!l.on) return;
    g.save();
    g.globalCompositeOperation = 'lighter';
    glowDot(g, head.x, head.y + 0.1 * head.k, Math.max(6, 1.6 * head.k), SODIUM, 0.9);
    g.fillStyle = 'rgba(255,236,200,0.95)';
    g.fillRect(head.x - 0.35 * head.k, head.y, 0.7 * head.k, Math.max(1, 0.12 * head.k));
    // the lamp's light cone in the rain
    const gr = g.createLinearGradient(0, head.y, 0, head.y + 7 * head.k);
    gr.addColorStop(0, css(SODIUM, 0.1));
    gr.addColorStop(1, css(SODIUM, 0));
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(head.x - 0.3 * head.k, head.y);
    g.lineTo(head.x + 0.3 * head.k, head.y);
    g.lineTo(head.x + 3.2 * head.k, head.y + 7.6 * head.k);
    g.lineTo(head.x - 3.2 * head.k, head.y + 7.6 * head.k);
    g.fill();
    g.restore();
  }

  function paintSignal(g, S) {
    const { P } = S;
    const sg = S.signal;
    const pole = P(FX - 1.6, 0, sg.z);
    const pt = P(FX - 1.6, 6.8, sg.z);
    const arm = P(sg.x, 6.6, sg.z);
    g.strokeStyle = '#1a1b21';
    g.lineWidth = Math.max(1.2, 0.16 * pole.k);
    g.beginPath();
    g.moveTo(pole.x, pole.y);
    g.lineTo(pt.x, pt.y);
    g.lineTo(arm.x, arm.y);
    g.stroke();
    const a = P(sg.x - 0.22, 6.6, sg.z);
    const c = P(sg.x + 0.22, 5.35, sg.z);
    g.fillStyle = '#0b0c10';
    g.fillRect(a.x, a.y, c.x - a.x, c.y - a.y);
    const lights = [[6.35, [255, 40, 50], 1], [5.97, [255, 170, 40], 0.12], [5.6, [60, 255, 140], 0.08]];
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const [y, rgb, on] of lights) {
      const p = P(sg.x, y, sg.z - 0.05);
      const rad = 0.13 * p.k;
      g.fillStyle = css(on > 0.5 ? whiten(rgb, 0.5) : rgb, on > 0.5 ? 1 : on);
      g.beginPath();
      g.arc(p.x, p.y, Math.max(0.8, rad), 0, Math.PI * 2);
      g.fill();
      if (on > 0.5) glowDot(g, p.x, p.y, Math.max(8, 1.4 * p.k), rgb, 0.85);
    }
    // pedestrian signal on the far corner, red hand
    const ped = P(-(FX - 1.4), 2.6, S.zf0);
    glowDot(g, ped.x, ped.y, Math.max(4, 0.6 * ped.k), [255, 60, 40], 0.7);
    g.restore();
  }

  // generic box helper for background traffic: fills the faces the camera can see
  function box(g, S, x0, x1, y0, y1, z0, z1, cols) {
    const { P, cam } = S;
    const v = (x, y, z) => P(x, y, z);
    g.fillStyle = cols.top;
    poly(g, [v(x0, y1, z0), v(x1, y1, z0), v(x1, y1, z1), v(x0, y1, z1)]);
    g.fill();
    if (x0 > cam.x) {
      g.fillStyle = cols.side;
      poly(g, [v(x0, y0, z0), v(x0, y0, z1), v(x0, y1, z1), v(x0, y1, z0)]);
      g.fill();
    } else if (x1 < cam.x) {
      g.fillStyle = cols.side;
      poly(g, [v(x1, y0, z0), v(x1, y0, z1), v(x1, y1, z1), v(x1, y1, z0)]);
      g.fill();
    }
    g.fillStyle = cols.near;
    poly(g, [v(x0, y0, z0), v(x1, y0, z0), v(x1, y1, z0), v(x0, y1, z0)]);
    g.fill();
  }

  function paintVehicle(g, S, v) {
    const { P } = S;
    const van = v.kind === 'van';
    const len = van ? 5 : 4.5;
    const z0 = v.dir > 0 ? v.z : v.z - len;
    const near = z0;
    const pr = P(v.x, 0, near);
    if (pr.x < -80 || pr.x > SRC_W + 80) return;
    g.fillStyle = 'rgba(0,0,0,0.5)';
    poly(g, gq(P, v.x - 1, v.x + 1, z0 - 0.2, z0 + len + 0.2));
    g.fill();
    const body = { top: '#15171c', side: '#0c0d11', near: v.col };
    if (van) {
      box(g, S, v.x - 0.95, v.x + 0.95, 0.3, 2.1, z0, z0 + len, body);
    } else {
      box(g, S, v.x - 0.9, v.x + 0.9, 0.25, 0.82, z0, z0 + len, body);
      const c0 = v.dir > 0 ? z0 + 0.9 : z0 + 1.4;
      box(g, S, v.x - 0.7, v.x + 0.7, 0.82, 1.32, c0, c0 + 2.1, { top: '#121419', side: '#0a0c10', near: '#0b1119' });
    }
    g.save();
    g.globalCompositeOperation = 'lighter';
    const ly = van ? 0.9 : 0.66;
    for (const s of [-1, 1]) {
      const p = P(v.x + s * 0.72, ly, near - 0.02);
      if (v.dir > 0) {
        g.fillStyle = css(whiten(TAIL, 0.4), 0.95);
        g.fillRect(p.x - 0.14 * p.k, p.y - 0.05 * p.k, 0.28 * p.k, Math.max(1, 0.09 * p.k));
        glowDot(g, p.x, p.y, Math.max(4, 0.8 * p.k), TAIL, 0.75);
      } else {
        glowDot(g, p.x, p.y, Math.max(5, 1.0 * p.k), [210, 230, 255], 0.85);
        // anamorphic streak
        const w = Math.max(16, 4 * p.k);
        const gr = g.createLinearGradient(p.x - w, 0, p.x + w, 0);
        gr.addColorStop(0, 'rgba(120,180,255,0)');
        gr.addColorStop(0.5, 'rgba(200,225,255,0.5)');
        gr.addColorStop(1, 'rgba(120,180,255,0)');
        g.fillStyle = gr;
        g.fillRect(p.x - w, p.y - 0.6, w * 2, 1.2);
      }
    }
    g.restore();
  }

  // a car crossing the intersection, side-on, smeared by the shutter
  function paintCross(g, S) {
    const { P } = S;
    const c = S.cross;
    const z0 = c.z - 0.9;
    const x0 = c.x - 2.3;
    const x1 = c.x + 2.3;
    g.fillStyle = 'rgba(0,0,0,0.45)';
    poly(g, gq(P, x0 - 0.2, x1 + 0.2, z0 - 0.1, z0 + 1.9));
    g.fill();
    for (let k = 0; k < 3; k++) {
      const o = (k - 1) * 0.35;
      g.globalAlpha = k === 1 ? 1 : 0.35;
      box(g, S, x0 + o, x1 + o, 0.25, 0.8, z0, z0 + 1.8, { top: '#16181d', side: '#0d0e12', near: c.col });
      box(g, S, x0 + 1.0 + o, x1 - 1.3 + o, 0.8, 1.3, z0 + 0.2, z0 + 1.6, { top: '#121419', side: '#0a0c10', near: '#0c1017' });
    }
    g.globalAlpha = 1;
    g.save();
    g.globalCompositeOperation = 'lighter';
    const head = P(x1 + 0.02, 0.62, z0 + 0.3);
    const tail = P(x0 - 0.02, 0.66, z0 + 0.3);
    glowDot(g, head.x, head.y, Math.max(4, 0.5 * head.k), [220, 235, 255], 0.75);
    glowDot(g, tail.x, tail.y, Math.max(4, 0.6 * tail.k), TAIL, 0.7);
    const w = Math.max(18, 3 * head.k);
    const gr = g.createLinearGradient(tail.x, 0, head.x + w, 0);
    gr.addColorStop(0, 'rgba(255,34,56,0.25)');
    gr.addColorStop(0.5, 'rgba(255,34,56,0)');
    gr.addColorStop(1, 'rgba(210,230,255,0.3)');
    g.fillStyle = gr;
    g.fillRect(tail.x, head.y - 0.6, head.x + w - tail.x, 1.2);
    g.restore();
  }

  function paintFar(g, S) {
    const { P } = S;
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const f of S.far) {
      const toward = f.x < 0;
      for (const s of [-0.7, 0.7]) {
        const p = P(f.x + s, 0.7, f.z);
        glowDot(g, p.x, p.y, 3, toward ? [220, 235, 255] : TAIL, 0.7);
      }
    }
    g.restore();
  }

  function* carSteps(g, S, o) {
    const W = carFrame(S);
    const px = o.scale;
    // contact shadow
    g.fillStyle = 'rgba(0,0,0,0.35)';
    poly(g, [W(-1.25, 0, -0.5), W(1.2, 0, -0.5), W(1.2, 0, 5.1), W(-1.25, 0, 5.1)]);
    g.fill();
    g.fillStyle = 'rgba(0,0,0,0.6)';
    poly(g, [W(-1.0, 0, -0.1), W(0.98, 0, -0.1), W(0.98, 0, 4.8), W(-1.0, 0, 4.8)]);
    g.fill();

    // wheels (far one first)
    for (const zc of [3.72, 0.98]) {
      const t = [];
      const rim = [];
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2;
        t.push(W(-0.9, 0.34 + 0.34 * Math.sin(a), zc + 0.34 * Math.cos(a)));
        rim.push(W(-0.94, 0.34 + 0.22 * Math.sin(a), zc + 0.22 * Math.cos(a)));
      }
      g.fillStyle = '#040506';
      poly(g, t);
      g.fill();
      g.fillStyle = '#15181d';
      poly(g, rim);
      g.fill();
      const c = W(-0.95, 0.34, zc);
      g.strokeStyle = '#2d333b';
      g.lineWidth = 1;
      g.beginPath();
      for (let i = 0; i < 20; i += 4) {
        g.moveTo(c.x, c.y);
        g.lineTo(rim[i].x, rim[i].y);
      }
      g.stroke();
    }

    // body side (left), arches cut around the wheels
    const side = [W(-0.9, 0.62, 0.02), W(-0.92, 0.24, 0.16)];
    for (const zc of [0.98, 3.72]) {
      for (let i = 0; i <= 12; i++) {
        const a = Math.PI - (i / 12) * Math.PI;
        side.push(W(-0.93, 0.34 + 0.4 * Math.sin(a), zc + 0.42 * Math.cos(a)));
      }
    }
    side.push(W(-0.9, 0.28, 4.55), W(-0.86, 0.72, 4.64), W(-0.88, 0.9, 3.8), W(-0.93, 0.9, 0.34), W(-0.88, 0.9, 0.04));
    const sideB = bbox(side);
    const sg = g.createLinearGradient(0, sideB.y, 0, sideB.y + sideB.h);
    sg.addColorStop(0, '#1c2027');
    sg.addColorStop(0.35, '#0e1014');
    sg.addColorStop(1, '#07080a');
    g.fillStyle = sg;
    poly(g, side);
    g.fill();
    // neon picked up along the rocker
    g.strokeStyle = 'rgba(95,243,255,0.22)';
    g.lineWidth = 1;
    g.beginPath();
    let p = W(-0.93, 0.3, 1.45);
    g.moveTo(p.x, p.y);
    p = W(-0.93, 0.3, 3.26);
    g.lineTo(p.x, p.y);
    g.stroke();

    // greenhouse side + window
    g.fillStyle = '#0d0f13';
    poly(g, [W(-0.86, 0.9, 0.58), W(-0.64, 1.33, 1.75), W(-0.64, 1.35, 2.85), W(-0.84, 0.92, 3.78)]);
    g.fill();
    const sw = [W(-0.81, 0.95, 1.0), W(-0.66, 1.28, 1.95), W(-0.66, 1.3, 2.75), W(-0.8, 0.96, 3.55)];
    const swb = bbox(sw);
    const swg = g.createLinearGradient(swb.x, 0, swb.x + swb.w, 0);
    swg.addColorStop(0, '#0c1520');
    swg.addColorStop(0.55, '#16222e');
    swg.addColorStop(1, '#070b10');
    g.fillStyle = swg;
    poly(g, sw);
    g.fill();
    p = W(-0.73, 1.12, 2.35);
    const p2 = W(-0.73, 1.12, 2.45);
    g.strokeStyle = '#06070a';
    g.lineWidth = Math.max(1.5, Math.abs(p2.x - p.x) * 1.4);
    g.beginPath();
    let a = W(-0.8, 0.96, 2.4);
    g.moveTo(a.x, a.y);
    a = W(-0.66, 1.3, 2.4);
    g.lineTo(a.x, a.y);
    g.stroke();

    // rear quarter corner
    g.fillStyle = '#12151a';
    poly(g, [W(-0.9, 0.55, 0.02), W(-0.86, 0.92, 0), W(-0.93, 0.9, 0.34), W(-0.93, 0.55, 0.3), W(-0.92, 0.24, 0.16), W(-0.86, 0.22, 0.08)]);
    g.fill();

    yield 'car-side';
    // trunk deck
    const deck = [W(-0.86, 0.92, 0.0), W(0.86, 0.92, 0.0), W(0.86, 0.94, 0.6), W(-0.86, 0.94, 0.6)];
    const db = bbox(deck);
    const dg = g.createLinearGradient(0, db.y, 0, db.y + db.h);
    dg.addColorStop(0, '#1b1e24');
    dg.addColorStop(1, '#2a2522');
    g.fillStyle = dg;
    poly(g, deck);
    g.fill();

    // rear greenhouse (C-pillars) then the glass with the cabin behind it
    g.fillStyle = '#101216';
    poly(g, [W(-0.86, 0.93, 0.58), W(0.86, 0.93, 0.58), W(0.64, 1.33, 1.75), W(-0.64, 1.33, 1.75)]);
    g.fill();
    const glass = [W(-0.74, 0.96, 0.66), W(0.74, 0.96, 0.66), W(0.57, 1.3, 1.7), W(-0.57, 1.3, 1.7)];
    const gb = bbox(glass);
    g.save();
    poly(g, glass);
    g.clip();
    g.fillStyle = '#04070b';
    g.fillRect(gb.x, gb.y, gb.w, gb.h);
    // dash glow through the cabin
    const dash = W(-0.1, 1.05, 3.3);
    const dgl = g.createRadialGradient(dash.x, dash.y, 0, dash.x, dash.y, gb.w * 0.8);
    dgl.addColorStop(0, 'rgba(80,235,255,0.6)');
    dgl.addColorStop(0.5, 'rgba(40,130,180,0.24)');
    dgl.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = dgl;
    g.fillRect(gb.x, gb.y, gb.w, gb.h);
    // passenger headrest (empty seat) and the driver, silhouetted against the dash
    const hr = W(0.36, 1.14, 2.25);
    const hs = Math.abs(W(0.47, 1.14, 2.25).x - hr.x);
    g.fillStyle = '#020305';
    g.beginPath();
    g.ellipse(hr.x, hr.y, hs, hs * 0.8, 0, 0, Math.PI * 2);
    g.fill();
    const head = W(-0.36, 1.2, 2.5);
    const hw = Math.abs(W(-0.26, 1.2, 2.5).x - head.x);
    const sh = W(-0.36, 1.0, 2.35);
    g.beginPath();
    g.moveTo(sh.x - hw * 2.6, sh.y + hw * 2);
    g.quadraticCurveTo(sh.x - hw * 2.4, sh.y - hw * 0.4, sh.x - hw * 0.8, sh.y - hw * 0.5);
    g.lineTo(head.x - hw * 0.5, head.y + hw * 0.9);
    g.ellipse(head.x, head.y, hw, hw * 1.2, 0, Math.PI * 0.7, Math.PI * 0.3, false);
    g.lineTo(sh.x + hw * 0.8, sh.y - hw * 0.5);
    g.quadraticCurveTo(sh.x + hw * 2.4, sh.y - hw * 0.4, sh.x + hw * 2.6, sh.y + hw * 2);
    g.closePath();
    g.fillStyle = '#010203';
    g.fill();
    g.strokeStyle = 'rgba(95,243,255,0.35)';
    g.lineWidth = Math.max(0.6, hw * 0.12);
    g.beginPath();
    g.ellipse(head.x, head.y, hw, hw * 1.2, 0, Math.PI * 1.05, Math.PI * 1.95);
    g.stroke();
    // glass tint + reflections (magenta neon streak, sodium band)
    g.fillStyle = 'rgba(12,22,34,0.3)';
    g.fillRect(gb.x, gb.y, gb.w, gb.h);
    g.globalCompositeOperation = 'lighter';
    const rs = g.createLinearGradient(gb.x, gb.y + gb.h, gb.x + gb.w, gb.y);
    rs.addColorStop(0.18, 'rgba(255,42,109,0)');
    rs.addColorStop(0.28, 'rgba(255,42,109,0.28)');
    rs.addColorStop(0.36, 'rgba(255,42,109,0)');
    rs.addColorStop(0.62, 'rgba(255,154,60,0)');
    rs.addColorStop(0.7, 'rgba(255,154,60,0.14)');
    rs.addColorStop(0.8, 'rgba(255,154,60,0)');
    g.fillStyle = rs;
    g.fillRect(gb.x, gb.y, gb.w, gb.h);
    g.restore();
    // high-mount brake light
    g.save();
    g.globalCompositeOperation = 'lighter';
    a = W(-0.22, 1.29, 1.66);
    let b = W(0.22, 1.29, 1.66);
    g.strokeStyle = css(whiten(TAIL, 0.35), 0.95);
    g.lineWidth = Math.max(1, 0.025 * a.k);
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.stroke();
    g.strokeStyle = css(TAIL, 0.3);
    g.lineWidth = Math.max(3, 0.1 * a.k);
    g.stroke();
    g.restore();

    // roof with sodium sheen
    const roof = [W(-0.64, 1.33, 1.75), W(0.64, 1.33, 1.75), W(0.64, 1.35, 2.85), W(-0.64, 1.35, 2.85)];
    const rb = bbox(roof);
    const rg = g.createLinearGradient(rb.x, 0, rb.x + rb.w, 0);
    rg.addColorStop(0, '#15181d');
    rg.addColorStop(0.5, '#2c2723');
    rg.addColorStop(1, '#121418');
    g.fillStyle = rg;
    poly(g, roof);
    g.fill();

    yield 'car-cabin';
    // rear face
    const face = [W(-0.86, 0.22, 0.08), W(0.86, 0.22, 0.08), W(0.9, 0.55, 0.02), W(0.86, 0.92, 0), W(-0.86, 0.92, 0), W(-0.9, 0.55, 0.02)];
    const fb = bbox(face);
    const fg = g.createLinearGradient(0, fb.y, 0, fb.y + fb.h);
    fg.addColorStop(0, '#22252b');
    fg.addColorStop(0.3, '#121418');
    fg.addColorStop(1, '#08090b');
    g.fillStyle = fg;
    poly(g, face);
    g.fill();
    // diffuser + exhaust
    g.fillStyle = '#050608';
    poly(g, [W(-0.8, 0.22, 0.08), W(0.8, 0.22, 0.08), W(0.78, 0.33, 0.05), W(-0.78, 0.33, 0.05)]);
    g.fill();
    g.strokeStyle = 'rgba(80,90,100,0.35)';
    g.lineWidth = 0.8;
    g.beginPath();
    for (let x = -0.5; x <= 0.5; x += 0.25) {
      a = W(x, 0.22, 0.07);
      b = W(x, 0.32, 0.05);
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
    }
    g.stroke();
    for (const x of [-0.62, 0.62]) {
      const e0 = W(x - 0.09, 0.3, 0.02);
      const e1 = W(x + 0.09, 0.24, 0.02);
      g.fillStyle = '#0f1114';
      g.fillRect(e0.x, e0.y, e1.x - e0.x, e1.y - e0.y);
      g.strokeStyle = 'rgba(160,170,180,0.5)';
      g.lineWidth = 0.8;
      g.strokeRect(e0.x, e0.y, e1.x - e0.x, e1.y - e0.y);
    }
    yield 'car-rear';
    // plate recess + lamp
    g.fillStyle = '#030405';
    poly(g, [W(-0.3, 0.56, -0.004), W(0.3, 0.56, -0.004), W(0.3, 0.4, -0.004), W(-0.3, 0.4, -0.004)]);
    g.fill();
    paintPlate(g, S, px < 2);
    g.save();
    g.globalCompositeOperation = 'lighter';
    a = W(0, 0.552, -0.02);
    glowDot(g, a.x, a.y, Math.max(3, 0.2 * a.k), [230, 240, 255], 0.35);
    g.restore();

    yield 'car-plate';
    // tail lights: full-width bar + corner blades. The one place shadowBlur earns its cost (once per capture).
    const bar = [W(-0.8, 0.79, -0.006), W(0.8, 0.79, -0.006), W(0.8, 0.745, -0.006), W(-0.8, 0.745, -0.006)];
    const cl = [W(-0.9, 0.79, 0.02), W(-0.8, 0.79, -0.006), W(-0.8, 0.745, -0.006), W(-0.9, 0.5, 0.02), W(-0.93, 0.5, 0.2), W(-0.93, 0.79, 0.24)];
    const cr = [W(0.9, 0.79, 0.02), W(0.8, 0.79, -0.006), W(0.8, 0.745, -0.006), W(0.9, 0.5, 0.02)];
    g.save();
    g.shadowColor = 'rgba(255,30,50,0.95)';
    g.shadowBlur = 9 * px;
    g.fillStyle = css(TAIL, 1);
    for (const q of [bar, cl, cr]) {
      poly(g, q);
      g.fill();
    }
    g.shadowBlur = 0;
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = 'rgba(255,190,200,0.9)';
    const core = [W(-0.78, 0.774, -0.008), W(0.78, 0.774, -0.008), W(0.78, 0.762, -0.008), W(-0.78, 0.762, -0.008)];
    poly(g, core);
    g.fill();
    for (const s of [-1, 1]) {
      a = W(s * 0.86, 0.77, 0);
      b = W(s * 0.86, 0.53, 0);
      g.strokeStyle = 'rgba(255,200,205,0.9)';
      g.lineWidth = Math.max(0.8, 0.012 * a.k);
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
      glowDot(g, a.x, (a.y + b.y) / 2, Math.max(10, 0.5 * a.k), TAIL, 0.5);
    }
    a = W(0, 0.77, 0);
    const hb = Math.max(20, 1.2 * a.k);
    const hg = g.createLinearGradient(a.x - hb, 0, a.x + hb, 0);
    hg.addColorStop(0, 'rgba(255,34,56,0)');
    hg.addColorStop(0.5, 'rgba(255,34,56,0.25)');
    hg.addColorStop(1, 'rgba(255,34,56,0)');
    g.fillStyle = hg;
    g.fillRect(a.x - hb, a.y - 0.12 * a.k, hb * 2, 0.24 * a.k);
    g.restore();

    yield 'car-lights';
    // badge + model script, only legible in the plate enhance
    g.save();
    a = W(-0.3, 0.7, -0.004);
    b = W(0.3, 0.7, -0.004);
    const c = W(-0.3, 0.63, -0.004);
    affine(g, a, b, c, 600, 70);
    g.fillStyle = 'rgba(200,210,220,0.75)';
    g.font = '52px Michroma, "Arial Black", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('KAIZEN', 300, 38);
    g.restore();
    g.save();
    a = W(0.42, 0.66, -0.004);
    b = W(0.78, 0.66, -0.004);
    affine(g, a, b, W(0.42, 0.62, -0.004), 360, 40);
    g.fillStyle = 'rgba(190,200,210,0.6)';
    g.font = 'italic 600 34px "Chakra Petch", "Segoe UI", sans-serif';
    g.textBaseline = 'middle';
    g.fillText('MORRIGAN GT', 0, 22);
    g.restore();

    // specular edges
    g.save();
    g.globalCompositeOperation = 'lighter';
    a = W(-0.86, 0.92, 0);
    b = W(0.86, 0.92, 0);
    const lip = g.createLinearGradient(a.x, 0, b.x, 0);
    lip.addColorStop(0, 'rgba(95,243,255,0.3)');
    lip.addColorStop(0.5, 'rgba(255,170,90,0.75)');
    lip.addColorStop(1, 'rgba(255,170,90,0.2)');
    g.strokeStyle = lip;
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.stroke();
    g.strokeStyle = 'rgba(200,225,240,0.35)';
    g.lineWidth = 1;
    g.beginPath();
    a = W(-0.93, 0.8, 0.34);
    b = W(-0.92, 0.8, 4.4);
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    a = W(-0.64, 1.34, 1.78);
    b = W(-0.64, 1.35, 2.85);
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    a = W(-0.74, 0.96, 0.66);
    b = W(0.74, 0.96, 0.66);
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.stroke();
    // rain beading on roof, deck and glass
    for (const [x, t, s] of S.drops) {
      const d = t < 0.35 ? W(x, 0.93, t * 1.6) : t < 0.7 ? W(x * 0.8, 0.96 + (t - 0.35) * 1.0, 0.66 + (t - 0.35) * 3) : W(x * 0.75, 1.34, 1.8 + (t - 0.7) * 3.4);
      g.fillStyle = `rgba(210,225,240,${0.22 * s})`;
      g.beginPath();
      g.arc(d.x, d.y, Math.max(0.35, 0.006 * d.k * s), 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  function paintPlate(g, S, soft) {
    const cells = plateCells(S.plate);
    g.save();
    g.transform(...S.plateM);
    const W0 = PLATE_W;
    const H0 = PLATE_H;
    const rr = (x, y, w, h, q) => {
      g.beginPath();
      g.moveTo(x + q, y);
      g.lineTo(x + w - q, y);
      g.quadraticCurveTo(x + w, y, x + w, y + q);
      g.lineTo(x + w, y + h - q);
      g.quadraticCurveTo(x + w, y + h, x + w - q, y + h);
      g.lineTo(x + q, y + h);
      g.quadraticCurveTo(x, y + h, x, y + h - q);
      g.lineTo(x, y + q);
      g.quadraticCurveTo(x, y, x + q, y);
    };
    // retroreflective white with a faint sheen from the plate lamp
    const pg = g.createLinearGradient(0, 0, 0, H0);
    pg.addColorStop(0, '#f6f8f7');
    pg.addColorStop(0.5, '#e6ecec');
    pg.addColorStop(1, '#c4cccd');
    g.fillStyle = pg;
    rr(0, 0, W0, H0, 7);
    g.fill();
    g.strokeStyle = '#0d1114';
    g.lineWidth = 3;
    rr(3, 3, W0 - 6, H0 - 6, 5);
    g.stroke();
    // EU band: ring of 12 stars and the country letter
    const blue = '#1f3f9e';
    g.fillStyle = blue;
    g.fillRect(5, 5, 42, H0 - 10);
    g.fillStyle = '#ffd400';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      star(g, 26 + Math.cos(a) * 13, 36 + Math.sin(a) * 13, 2.7);
    }
    g.fillStyle = '#ffffff';
    g.font = '700 34px "Chakra Petch", "Segoe UI", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('F', 26, 82);
    // regional band: a generic emblem over the département number
    g.fillStyle = blue;
    g.fillRect(W0 - 47, 5, 42, H0 - 10);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 2.2;
    g.beginPath();
    g.moveTo(W0 - 38, 18);
    g.lineTo(W0 - 14, 18);
    g.lineTo(W0 - 14, 36);
    g.quadraticCurveTo(W0 - 26, 50, W0 - 26, 50);
    g.quadraticCurveTo(W0 - 38, 36, W0 - 38, 36);
    g.closePath();
    g.stroke();
    g.fillStyle = '#ffd400';
    g.beginPath();
    g.moveTo(W0 - 33, 32);
    g.quadraticCurveTo(W0 - 26, 25, W0 - 19, 32);
    g.lineTo(W0 - 21, 36);
    g.lineTo(W0 - 31, 36);
    g.closePath();
    g.fill();
    g.fillStyle = '#ffffff';
    g.font = '700 30px "Chakra Petch", "Segoe UI", sans-serif';
    g.fillText('75', W0 - 26, 80);
    // the characters: bold, condensed. At camera resolution the glass, rain and compression smear
    // them, so the 1× painter ghosts them; only the detail render is crisp.
    const ink = (a) => {
      g.fillStyle = `rgba(14,18,21,${a})`;
      for (const c of cells) {
        if (c.sep) {
          g.fillRect(c.cx - 9, 51, 18, 9);
          continue;
        }
        g.save();
        g.translate(c.cx, 92);
        g.scale(0.74, 1);
        g.fillText(c.ch, 0, 0);
        g.restore();
      }
    };
    g.font = '700 100px "JetBrains Mono", Consolas, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    if (soft) {
      // ~2 source px of smear: you can tell it is a plate, not what it says
      for (const [dx, dy] of [[-17, -3], [16, 4], [-4, -12], [5, 12], [0, 0]]) {
        g.save();
        g.translate(dx, dy);
        ink(0.26);
        g.restore();
      }
    } else {
      ink(1);
    }
    // rivets + road grime + a lamp hot spot along the top
    g.fillStyle = '#20262a';
    for (const x of [58, W0 - 58]) {
      g.beginPath();
      g.arc(x, 12, 3.2, 0, Math.PI * 2);
      g.fill();
    }
    const grime = g.createLinearGradient(0, 70, 0, H0);
    grime.addColorStop(0, 'rgba(40,40,30,0)');
    grime.addColorStop(1, 'rgba(46,40,30,0.32)');
    g.fillStyle = grime;
    g.fillRect(0, 70, W0, H0 - 70);
    const hot = g.createRadialGradient(W0 / 2, -10, 0, W0 / 2, -10, 180);
    hot.addColorStop(0, 'rgba(255,255,255,0.22)');
    hot.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = hot;
    g.fillRect(0, 0, W0, H0);
    g.restore();
  }

  function star(g, x, y, r) {
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const k = i % 2 ? r * 0.42 : r;
      if (i) g.lineTo(x + Math.cos(a) * k, y + Math.sin(a) * k);
      else g.moveTo(x + Math.cos(a) * k, y + Math.sin(a) * k);
    }
    g.closePath();
    g.fill();
  }

  function paintRain(g, S, o, from = 0, to = S.rain.length / 4) {
    const L = o.light;
    const d = L.d;
    const lw = L.w;
    const lh = L.h;
    const cull = o.cull;
    const rain = S.rain;
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.lineWidth = o.scale > 1 ? 0.4 : 0.9;
    g.lineCap = 'butt';
    for (let i = from * 4; i < to * 4; i += 4) {
      const x = rain[i];
      const y = rain[i + 1];
      const len = rain[i + 2];
      const dx = S.wind * len;
      if (cull && (x + Math.max(dx, 0) < cull.x || x + Math.min(dx, 0) > cull.x + cull.w || y + len < cull.y || y > cull.y + cull.h)) continue;
      const lx = Math.min(lw - 1, Math.max(0, (x / 8) | 0));
      const ly = Math.min(lh - 1, Math.max(0, (y / 8) | 0));
      const k = (ly * lw + lx) * 4;
      const rr = d[k];
      const gg = d[k + 1];
      const bb = d[k + 2];
      const lum = Math.max(rr, gg, bb) / 255;
      const a = rain[i + 3] * (0.35 + 2.4 * lum);
      const m = 1 / Math.max(0.3, lum);
      g.strokeStyle = `rgba(${Math.min(255, 150 + rr * m * 0.4) | 0},${Math.min(255, 165 + gg * m * 0.4) | 0},${Math.min(255, 185 + bb * m * 0.4) | 0},${Math.min(0.6, a)})`;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + dx, y + len);
      g.stroke();
    }
    g.restore();
  }

  function paintSplash(g, S, o) {
    const cull = o.cull;
    g.save();
    g.lineWidth = o.scale > 1 ? 0.25 : 0.6;
    g.strokeStyle = 'rgba(200,215,230,0.13)';
    g.beginPath();
    for (const s of S.splash) {
      const p = S.P(s.x, 0, s.z);
      if (p.y < S.horizon || p.y > SRC_H || p.x < -10 || p.x > SRC_W + 10) continue;
      if (cull && (p.x < cull.x - 10 || p.x > cull.x + cull.w + 10 || p.y < cull.y - 10 || p.y > cull.y + cull.h + 10)) continue;
      const w = s.s * p.k;
      g.moveTo(p.x + w, p.y);
      g.ellipse(p.x, p.y, w, w * 0.3, 0, 0, Math.PI * 2);
    }
    g.stroke();
    g.restore();
  }

  function paintLens(g, S) {
    g.save();
    for (const d of S.lens) {
      const gr = g.createRadialGradient(d.x - d.r * 0.3, d.y - d.r * 0.3, d.r * 0.2, d.x, d.y, d.r);
      gr.addColorStop(0, 'rgba(255,255,255,0.02)');
      gr.addColorStop(0.75, 'rgba(200,220,255,0.05)');
      gr.addColorStop(0.92, 'rgba(230,240,255,0.16)');
      gr.addColorStop(1, 'rgba(230,240,255,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  // Painter's order: ground → reflections → facades → tall things by depth → our car. Each yield ends
  // a bounded slice of raster work; the caller flushes the canvas there so the cost lands in the slice.
  function* sceneSteps(g, S, o) {
    const detail = !!o.cull;
    if (!detail) {
      paintSky(g, S);
      yield 'sky';
      paintTower(g, S, S.horizon);
      yield 'tower';
    }
    yield* groundSteps(g, S, o);
    yield 'puddles';
    paintMarkings(g, S);
    yield 'markings';
    yield* poolSteps(g, S);
    paintSplash(g, S, o);
    yield* reflectionSteps(g, S, o);
    yield 'refl-composite';
    if (!detail) {
      for (const b of S.buildings.slice().sort((a, c) => c.z0 - a.z0)) {
        paintFacade(g, S, b);
        yield 'facade';
      }
      for (const b of S.buildings) {
        if (!b.front) continue;
        paintFront(g, S, b);
        yield 'front';
      }
      const items = [];
      for (const s of S.blades) items.push([s.z, () => paintBlade(g, S, s)]);
      for (const bd of S.boards) items.push([bd.z, () => paintBoard(g, S, bd)]);
      for (const l of S.lamps) items.push([l.z, () => paintLamp(g, S, l)]);
      for (const v of S.cars) items.push([v.z, () => paintVehicle(g, S, v)]);
      items.push([S.zo, () => paintOverpass(g, S)]);
      items.push([S.signal.z, () => paintSignal(g, S)]);
      items.push([400, () => paintFar(g, S)]);
      if (S.cross) items.push([S.cross.z, () => paintCross(g, S)]);
      items.sort((a, c) => c[0] - a[0]);
      for (const it of items) {
        it[1]();
        yield 'items';
      }
    }
    yield* carSteps(g, S, o);
    yield 'car';
  }

  function* rainSteps(g, S, o) {
    const n = S.rain.length / 4;
    for (let i = 0; i < n; i += 350) {
      paintRain(g, S, o, i, Math.min(n, i + 350));
      yield 'rain';
    }
  }

  /* ----------------------------------------------------------- image cache */

  function grade(g, w, h, gr) {
    g.save();
    g.globalCompositeOperation = 'saturation';
    g.globalAlpha = gr[0];
    g.fillStyle = '#808080';
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'color';
    g.globalAlpha = gr[1];
    g.fillStyle = '#33b8ad';
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'screen';
    g.globalAlpha = 1;
    g.fillStyle = `rgba(22,56,62,${gr[2]})`;
    g.fillRect(0, 0, w, h);
    g.restore();
  }

  // 1/8-res luminance source for rain tint and bloom, kept on CPU canvases (no GPU readback stall)
  function* lightSteps(src, out) {
    const q = mk(SRC_W / 4, SRC_H / 4, true);
    q.g.imageSmoothingQuality = 'medium';
    q.g.drawImage(src, 0, 0, q.width, q.height);
    q.g.getImageData(0, 0, 1, 1);
    yield 'light';
    const w = SRC_W / 8;
    const h = Math.round(SRC_H / 8);
    const c = mk(w, h, true);
    c.g.imageSmoothingQuality = 'medium';
    c.g.drawImage(q, 0, 0, w, h);
    Object.assign(out, { c, w, h, d: c.g.getImageData(0, 0, w, h).data });
    yield 'light';
  }

  function makeBloom(L) {
    const id = new ImageData(L.w, L.h);
    const s = L.d;
    const t = id.data;
    for (let i = 0; i < s.length; i += 4) {
      const m = Math.max(s[i], s[i + 1], s[i + 2]);
      const k = m > 120 ? Math.pow((m - 120) / 135, 1.4) * 1.5 : 0;
      t[i] = Math.min(255, s[i] * k);
      t[i + 1] = Math.min(255, s[i + 1] * k);
      t[i + 2] = Math.min(255, s[i + 2] * k);
      t[i + 3] = 255;
    }
    // CPU canvases: they are only ever drawn into other CPU canvases, so no GPU readback stalls
    const tight = mk(L.w, L.h, true);
    tight.g.putImageData(id, 0, 0);
    const half = mk(L.w / 2, L.h / 2, true);
    half.g.drawImage(tight, 0, 0, half.width, half.height);
    const soft = mk(L.w, L.h, true);
    soft.g.drawImage(half, 0, 0, L.w, L.h);
    const wide = mk(L.w / 5, L.h / 5, true);
    wide.g.imageSmoothingQuality = 'high';
    wide.g.drawImage(tight, 0, 0, wide.width, wide.height);
    return { tight: soft, wide };
  }

  // adds the bloom for source rect (x,y,w,h) into a dw×dh device-space target, a band per step
  function* bloomSteps(g, B, x, y, w, h, dw, dh, n) {
    yield* bands(g, dw, dh, n, 'bloom', () => {
      let k = B.tight.width / SRC_W;
      g.globalAlpha = 0.42;
      g.drawImage(B.tight, x * k, y * k, w * k, h * k, 0, 0, dw, dh);
      k = B.wide.width / SRC_W;
      g.globalAlpha = 0.5;
      g.drawImage(B.wide, x * k, y * k, w * k, h * k, 0, 0, dw, dh);
    });
  }

  /* ------------------------------------------------------------ capture job */

  const FULL_R = { x: 0, y: 0, w: SRC_W, h: SRC_H };
  const FL = mk(1, 1);
  // drawing a canvas once forces its pending raster work to happen now, inside the slice
  const touch = (c) => FL.g.drawImage(c, 0, 0, 1, 1);

  // quality: an exact halving is a clean 2×2 box under plain bilinear ('low'); other ratios want mipmaps
  function resample(img, w, h, cpu, quality = 'medium') {
    const out = mk(w, h, cpu);
    out.g.imageSmoothingQuality = quality;
    out.g.drawImage(img, 0, 0, out.width, out.height);
    touch(out);
    return out;
  }
  // per-pixel CCTV grade (small images only)
  function cctv(img, amt) {
    const w = img.width;
    const h = img.height;
    const id = img.g.getImageData(0, 0, w, h);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i];
      const gg = d[i + 1];
      const b = d[i + 2];
      const lum = 0.3 * r + 0.59 * gg + 0.11 * b;
      const red = Math.min(1, Math.max(0, r - Math.max(gg, b) - 24) / 80);
      const k = amt * (1 - red * 0.85);
      d[i] = r + (lum * 0.74 + 6 - r) * k;
      d[i + 1] = gg + (lum * 1.04 + 13 - gg) * k;
      d[i + 2] = b + (lum * 0.98 + 15 - b) * k;
    }
    const out = mk(w, h);
    out.g.putImageData(id, 0, 0);
    touch(out);
    return out;
  }
  function graded(img, gr) {
    const out = mk(img.width, img.height);
    out.g.drawImage(img, 0, 0);
    grade(out.g, out.width, out.height, gr);
    touch(out);
    return out;
  }

  // The full-frame capture: scene, rain, bloom, lens, then the pyramid of graded low-res stages.
  function* captureJob(n, info) {
    const seed = (HD.seed ^ 0x0e4a4ce ^ Math.imul(n + 1, 0x9e3779b1)) >>> 0;
    const S = buildScene(seed, HD.state.target.plate);
    const src = mk(SRC_W, SRC_H, true);
    const flush = () => src.g.getImageData(0, 0, 1, 1);
    yield 'build';
    for (const step of sceneSteps(src.g, S, { scale: 1 })) {
      flush();
      yield step;
    }
    const light = {};
    yield* lightSteps(src, light);
    for (const step of rainSteps(src.g, S, { scale: 1, light })) {
      flush();
      yield step;
    }
    const bloom = makeBloom(light);
    for (const step of bloomSteps(src.g, bloom, 0, 0, SRC_W, SRC_H, SRC_W, SRC_H, 4)) {
      flush();
      yield step;
    }
    paintLens(src.g, S);
    flush();
    yield 'lens';
    const full = mk(SRC_W, SRC_H);
    full.g.drawImage(src, 0, 0);
    touch(full);
    yield 'full';
    // the whole chain stays on CPU canvases: reading a GPU canvas back mid-chain stalls for ~10 ms
    const at = (img, k, q) => resample(img, SRC_W * CAR_STAGES[k], SRC_H * CAR_STAGES[k], true, q);
    const u2 = at(src, 3, 'low');
    yield 'u2';
    const u3 = at(u2, 2);
    yield 'u3';
    const u6 = at(u3, 1, 'low');
    const u10 = at(u6, 0);
    yield 'u6';
    const car = [cctv(u10, CAR_TINT[0]), cctv(u6, CAR_TINT[1])];
    yield 'g10';
    car.push(cctv(u3, CAR_TINT[2]));
    yield 'g3';
    car.push(graded(u2, CAR_GRADE), full);
    yield 'g2';
    const r = HD.rng(seed ^ 0x0c4);
    const cells = plateCells(S.plate);
    let j = 0;
    for (const c of cells) {
      c.conf = c.sep ? 100 : r.range(91.5, 99.7);
      c.order = c.sep ? -1 : j++;
    }
    return { n, S, info, full, car, thumb: u6, light, bloom, detailR: null, D: 0, cells, conf: r.range(96.4, 98.8), plate: null, vk: null, pl: null, dtok: null, dwant: null };
  }

  // The plate neighbourhood re-painted at D× plus its own stage pyramid, for the second ENHANCE. The
  // region is sized for the panel shape that asked for it; a newer request (a resize) supersedes it.
  function* detailJob(cap, want, tok) {
    const { S } = cap;
    const { dr, D } = want;
    const d = mk(dr.w * D, dr.h * D, true);
    const flush = () => d.g.getImageData(0, 0, 1, 1);
    d.g.setTransform(D, 0, 0, D, -dr.x * D, -dr.y * D);
    for (const step of sceneSteps(d.g, S, { scale: D, cull: dr })) {
      flush();
      yield 'd-' + step;
    }
    for (const step of rainSteps(d.g, S, { scale: D, light: cap.light, cull: dr })) {
      flush();
      yield 'd-' + step;
    }
    d.g.setTransform(1, 0, 0, 1, 0, 0);
    for (const step of bloomSteps(d.g, cap.bloom, dr.x, dr.y, dr.w, dr.h, d.width, d.height, 4)) {
      flush();
      yield 'd-' + step;
    }
    const top = mk(d.width, d.height);
    top.g.drawImage(d, 0, 0);
    touch(top);
    yield 'd-top';
    // stage sizes are in source pixels, whatever D is: the plate stays a smear until stage 2
    const sz = PLATE_STAGES.map((f) => [dr.w * f, dr.h * f]);
    const q3 = resample(d, ...sz[3]);
    const q2 = resample(q3, ...sz[2]);
    yield 'd-q2';
    const q1 = resample(q2, ...sz[1]);
    const q0 = resample(q1, ...sz[0]);
    yield 'd-q0';
    const plate = [graded(q0, PLATE_GRADE[0]), graded(q1, PLATE_GRADE[1]), graded(q2, PLATE_GRADE[2])];
    yield 'd-g';
    plate.push(graded(q3, PLATE_GRADE[3]), top);
    if (cap.dtok !== tok) return;
    cap.detailR = dr;
    cap.D = D;
    cap.plate = plate;
  }

  function drain(gen) {
    for (;;) {
      const r = gen.next();
      if (r.done) return r.value;
    }
  }

  /* ------------------------------------------------------------------ panel */

  // sequence beats in seconds (reduced motion plays the same script ~1.4× slower)
  const TL = {
    enh1: 1.5,
    z1: 1.85,
    z1d: 2.4,
    sw1: [2.0, 2.62, 3.24, 3.86],
    acq2: 4.55,
    enh2: 5.15,
    z2: 5.5,
    z2d: 2.2,
    sw2: [5.8, 6.35, 6.9, 7.45],
    ocr: 8.1,
    lock0: 8.55,
    lockStep: 0.21,
    match: 10.2,
    cut: 13.2,
  };
  const SWEEPS = TL.sw1.concat(TL.sw2);
  const SWD = 0.44; // one reconstruction sweep
  const WORD_D = 0.8; // the ENHANCE title card
  const CUT_D = 0.4; // glitch-cut between cameras
  const PLATE_Y = 0.36; // where the plate settles in the final frame (fraction of height)
  const UPSCALE = [1, 2, 4, 6, 8];
  const GLYPHS = 'ABCDEFGHJKLMNPQRSTVWXYZ0123456789';
  const STATE = { live: 'LIVE', acq: 'ACQUIRING', enh: 'ENHANCING', ocr: 'OCR', match: 'MATCH' };
  // the arrondissement each fallback street (HD.words.streets) mostly runs through, so a solo HUD never
  // puts Avenue d'Italie in the 2e
  const ARR_OF = {
    'RUE DE RIVOLI': 1, 'BOULEVARD HAUSSMANN': 8, 'AVENUE DES CHAMPS-ÉLYSÉES': 8, 'BOULEVARD SAINT-GERMAIN': 6,
    'BOULEVARD DE SÉBASTOPOL': 2, 'RUE LA FAYETTE': 9, "AVENUE DE L'OPÉRA": 1, 'QUAI DES GRANDS AUGUSTINS': 6,
    'BOULEVARD VOLTAIRE': 11, 'RUE DE LA ROQUETTE': 11, 'AVENUE MONTAIGNE': 8, 'RUE SAINT-HONORÉ': 1,
    'BOULEVARD SAINT-MICHEL': 5, 'RUE DU FAUBOURG SAINT-ANTOINE': 12, "QUAI D'ORSAY": 7, 'AVENUE FOCH': 16,
    'BOULEVARD PÉRIPHÉRIQUE': 17, 'RUE DE VAUGIRARD': 15, 'AVENUE DE CLICHY': 17, 'RUE OBERKAMPF': 11,
    'BOULEVARD DE MAGENTA': 10, 'RUE DE BELLEVILLE': 20, "AVENUE D'ITALIE": 13, 'QUAI DE BERCY': 12,
  };
  const F_MONO = (px, w = 500) => `${w} ${px}px "JetBrains Mono", Consolas, monospace`;
  const F_UI = (px) => `600 ${px}px "Chakra Petch", "Segoe UI", sans-serif`;
  const hash = (a, b) => {
    let h = Math.imul(a ^ 0x9e3779b1, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
    h ^= h >>> 15;
    h = Math.imul(h, 0x27d4eb2f);
    return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
  };

  function sweep(t, starts) {
    let a = 0;
    for (let i = 0; i < starts.length; i++) {
      if (t >= starts[i] + SWD) a = i + 1;
      else return t >= starts[i] ? [a, (t - starts[i]) / SWD] : [a, -1];
    }
    return [a, -1];
  }

  function brackets(g, x, y, w, h, len) {
    len = Math.min(len, w / 3, h / 3);
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

  HD.panel('enhance', (ctx) => {
    const U = ctx.util;
    const T = ctx.state.target;
    const RM = ctx.reducedMotion;
    const SPEED = RM ? 0.72 : 1;
    const R = ctx.rng((HD.seed ^ 0x0e4a4ce) >>> 0);
    const C = ctx.color;
    const view = ctx.canvas({ alpha: false, className: 'enh-view' });
    let W = ctx.width || 466;
    let H = ctx.height || 458;
    // the header and status strips (DOM), scaled with the HUD on very large bodies
    let hs = 1;
    let TOP_H = 34;
    let BOT_H = 22;

    /* ---- HUD (DOM: crisp text, ellipsis, container queries) */
    const fxEl = U.el('div', 'enh-fx');
    const hud = U.el('div', 'enh-hud');
    hud.innerHTML = `
      <div class="enh-top">
        <div class="enh-id">
          <div class="enh-l1"><b class="enh-cam"></b><span class="enh-tag">PTZ · 4K · IR-CUT</span></div>
          <div class="enh-loc"></div>
        </div>
        <div class="enh-rec"><span class="enh-rec-l"><i></i>REC</span><span class="enh-clk"></span></div>
      </div>
      <div class="enh-proc" hidden>
        <div class="enh-pr enh-pr-main"><span>RECONSTRUCTING</span><b data-p="pct"></b></div>
        <div class="enh-meter"><i></i></div>
        <div class="enh-pr enh-pr-x"><span>AI UPSCALE</span><b data-p="up"></b></div>
        <div class="enh-pr enh-pr-x"><span>DEBLUR PASS</span><b data-p="db"></b></div>
        <div class="enh-pr enh-pr-res"><span>RES</span><b data-p="res"></b></div>
        <div class="enh-pr"><span>ZOOM</span><b data-p="zm"></b></div>
      </div>
      <div class="enh-final" hidden>
        <span class="enh-fl1"><span class="enh-f-pl">PLATE <b data-f="plate"></b></span><i class="enh-f-sep"> · </i><span>CONF <b data-f="conf"></b></span><i class="enh-f-sep"> · </i><span>MATCH: <em>WRAITH</em></span></span>
        <span class="enh-fl2"></span>
      </div>
      <div class="enh-bot">
        <span class="enh-st" data-s="live">LIVE</span>
        <span class="enh-kv"><i>ZOOM</i><b data-b="zm"></b></span>
        <span class="enh-kv enh-kv-res"><i>RES</i><b data-b="res"></b></span>
        <span class="enh-kv enh-kv-snr"><i>SNR</i><b data-b="snr"></b></span>
        <button class="enh-btn" type="button" data-hot aria-label="Enhance the camera image">[ ENHANCE ]</button>
      </div>`;
    ctx.el.append(fxEl, hud);
    const $ = (s) => hud.querySelector(s);
    const el = {
      cam: $('.enh-cam'),
      loc: $('.enh-loc'),
      clk: $('.enh-clk'),
      proc: $('.enh-proc'),
      meter: $('.enh-meter'),
      pct: $('[data-p="pct"]'),
      up: $('[data-p="up"]'),
      db: $('[data-p="db"]'),
      pres: $('[data-p="res"]'),
      pzm: $('[data-p="zm"]'),
      fin: $('.enh-final'),
      fplate: $('[data-f="plate"]'),
      fconf: $('[data-f="conf"]'),
      fl2: $('.enh-fl2'),
      st: $('.enh-st'),
      zm: $('[data-b="zm"]'),
      res: $('[data-b="res"]'),
      snr: $('[data-b="snr"]'),
      btn: $('.enh-btn'),
    };
    const setT = (e, s) => {
      if (e.__t !== s) {
        e.__t = s;
        e.textContent = s;
      }
    };
    const setVar = (e, k, v) => {
      const s = v.toFixed(3);
      if (e[k] !== s) {
        e[k] = s;
        e.style.setProperty('--p', s);
      }
    };
    let metaTxt = '';
    const meta = (s) => {
      if (s !== metaTxt) ctx.meta((metaTxt = s));
    };

    /* ---- sprites: grain tile, rolling bars, sweep trail, title card, stamp */
    const noise = mk(128, 128);
    {
      const id = noise.g.createImageData(128, 128);
      for (let i = 0; i < id.data.length; i += 4) {
        const v = R();
        const hi = v > 0.5;
        id.data[i] = hi ? 190 : 0;
        id.data[i + 1] = hi ? 255 : 8;
        id.data[i + 2] = hi ? 240 : 12;
        id.data[i + 3] = Math.abs(v - 0.5) * 112;
      }
      noise.g.putImageData(id, 0, 0);
    }
    let grainPat = null;
    const band = mk(1, 64);
    {
      const gr = band.g.createLinearGradient(0, 0, 0, 64);
      gr.addColorStop(0, 'rgba(255,255,255,0)');
      gr.addColorStop(0.55, 'rgba(255,255,255,1)');
      gr.addColorStop(0.7, 'rgba(255,255,255,0.5)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      band.g.fillStyle = gr;
      band.g.fillRect(0, 0, 1, 64);
    }
    const trail = mk(1, 64);
    {
      const gr = trail.g.createLinearGradient(0, 0, 0, 64);
      gr.addColorStop(0, 'rgba(95,243,255,0)');
      gr.addColorStop(1, 'rgba(95,243,255,0.42)');
      trail.g.fillStyle = gr;
      trail.g.fillRect(0, 0, 1, 64);
    }
    let spr = null;
    function sprites() {
      const dpr = view.dpr;
      const key = `${W}|${H}|${hs}|${dpr}|${HD.fontsReady}`;
      if (spr && spr.key === key) return spr;
      const m = mk(1, 1).g;
      let fs = Math.min(54 * hs, W * 0.12, H * 0.28);
      const ls = () => `${(fs * 0.26).toFixed(1)}px`;
      m.font = `${fs}px Michroma, "Arial Black", sans-serif`;
      m.letterSpacing = ls();
      let tw = m.measureText('ENHANCE').width;
      if (tw > W * 0.82) {
        fs *= (W * 0.82) / tw;
        tw = W * 0.82;
      }
      const pad = fs * 0.55;
      const ww = tw + pad * 2;
      const wh = fs * 2;
      const word = (fill, glow) => {
        const c = mk(ww * dpr, wh * dpr);
        const g = c.g;
        g.scale(dpr, dpr);
        g.font = `${fs}px Michroma, "Arial Black", sans-serif`;
        g.letterSpacing = ls();
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        if (glow) {
          g.shadowColor = glow;
          g.shadowBlur = fs * 0.4;
        }
        g.fillStyle = fill;
        g.fillText('ENHANCE', ww / 2 + fs * 0.13, wh / 2);
        return c;
      };
      // rubber MATCH stamp: double frame, worn ink
      const sf = U.clamp(Math.min(W * 0.062, H * 0.09), 15, 36 * hs);
      const sw = sf * 6.4;
      const sh = sf * 2.1;
      const st = mk(sw * dpr, sh * dpr);
      {
        const g = st.g;
        g.scale(dpr, dpr);
        g.strokeStyle = '#ff2340';
        g.fillStyle = '#ff2340';
        g.lineWidth = Math.max(2, sf * 0.12);
        g.strokeRect(g.lineWidth, g.lineWidth, sw - g.lineWidth * 2, sh - g.lineWidth * 2);
        g.lineWidth = 1;
        g.strokeRect(sf * 0.3, sf * 0.3, sw - sf * 0.6, sh - sf * 0.6);
        g.font = `${sf}px Michroma, "Arial Black", sans-serif`;
        g.letterSpacing = `${(sf * 0.2).toFixed(1)}px`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('MATCH', sw / 2 + sf * 0.1, sh / 2 + 1);
        g.globalCompositeOperation = 'destination-out';
        const r = HD.rng(0x57a3b);
        for (let i = 0; i < 90; i++) g.fillRect(r.range(0, sw), r.range(0, sh), r.range(0.6, 2.4), r.range(0.6, 1.8));
      }
      spr = {
        key,
        fs,
        w: ww,
        h: wh,
        white: word('#eafcff', 'rgba(95,243,255,0.95)'),
        cyan: word('rgba(95,243,255,0.8)'),
        mag: word('rgba(255,42,109,0.8)'),
        stamp: st,
        sw,
        sh,
      };
      return spr;
    }
    const scratch = mk(1, 1);
    const tint = mk(1, 1);

    /* ---- captures: the one on screen, the next one being built in the background */
    const jobs = [];
    let capN = 0;
    let cur = null;
    let next = null;
    function autoInfo() {
      const known = (v) => v && v !== '—';
      if (known(T.street) && known(T.district)) return { camId: `CAM-${U.pad(R.int(100, 9899), 4)}`, street: T.street, district: T.district };
      // no live fix from the map (solo, or before it reports): a real street in its own arrondissement
      const street = known(T.street) ? T.street : R.pick(ctx.words.streets);
      const n = ARR_OF[street];
      const ds = ctx.words.districts;
      const district = (n && ds.find((d) => parseInt(d, 10) === n)) || R.pick(ds);
      return { camId: `CAM-${U.pad(R.int(100, 9899), 4)}`, street, district };
    }
    function infoFrom(d) {
      const a = autoInfo();
      return { camId: (d && d.camId) || a.camId, street: (d && d.street) || a.street, district: (d && d.district) || a.district };
    }
    // the plate detail for this panel shape: the frame's whole view at the final read (plus the
    // default neighbourhood), rendered at about the display scale
    function wantDetail(c) {
      const L = plateLayout(c);
      const pb = c.S.plateBox;
      const pw = Math.max(pb.w, 40);
      const cx = pb.x + pb.w / 2;
      const cy = pb.y + pb.h / 2;
      const vx = cx + (W / 2 - L.px) / L.s2;
      const vy = cy + (H / 2 - L.py) / L.s2;
      const hw = (W / L.s2) * 0.52;
      const hh = (H / L.s2) * 0.52;
      const x0 = Math.floor(Math.min(cx - 0.75 * pw, vx - hw));
      const y0 = Math.floor(Math.min(cy - 0.8 * pw, vy - hh));
      const x1 = Math.ceil(Math.max(cx + 0.75 * pw, vx + hw));
      const y1 = Math.ceil(Math.max(cy + 1.3 * pw, vy + hh));
      const dr = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      let D = U.clamp(Math.ceil(L.s2 * 1.025 * view.dpr * 0.9), DETAIL, 9);
      while (D > 4 && dr.w * dr.h * D * D > 4.5e6) D--; // cap the paint on huge strips
      return { dr, D };
    }
    function* detailFor(c) {
      const want = wantDetail(c);
      const tok = (c.dtok = {});
      c.dwant = want;
      yield* detailJob(c, want, tok);
    }
    // (re)build a capture's plate detail; its old one is dropped so no beat reads a mismatched frame
    function queueDetail(c) {
      for (let i = jobs.length - 1; i >= 0; i--) if (jobs[i].detailOf === c) jobs.splice(i, 1);
      c.plate = null;
      c.detailR = null;
      c.vk = null;
      const job = detailFor(c);
      job.detailOf = c;
      jobs.unshift(job);
      schedule();
    }
    // a capture whose detail (built or in flight) no longer covers what this panel shape needs
    function staleDetail(c) {
      const have = c.plate ? { dr: c.detailR, D: c.D } : c.dwant;
      if (!have || !have.dr) return false;
      const w = wantDetail(c);
      const a = have.dr;
      const b = w.dr;
      return b.x < a.x - 1 || b.y < a.y - 1 || b.x + b.w > a.x + a.w + 1 || b.y + b.h > a.y + a.h + 1 || have.D < w.D - 1;
    }
    function prepareNext() {
      const n = capN++;
      jobs.push(
        (function* () {
          const c = yield* captureJob(n, null);
          yield* detailFor(c);
          next = c;
        })()
      );
      schedule();
    }
    // Background building runs in the browser's idle time between frames. When a beat is waiting on
    // it (or there is no requestIdleCallback) the tick lends it a sliver of its own budget as well.
    const ric = window.requestIdleCallback ? window.requestIdleCallback.bind(window) : null;
    let ricId = 0;
    let jobFails = 0;
    function stepJob() {
      try {
        if (jobs[0].next().done) jobs.shift();
      } catch (err) {
        // a broken capture must not wedge the queue: drop it, rebuild a few times, then give up
        jobs.shift();
        if (!next && !jobs.length && ++jobFails <= 3) prepareNext();
        HD.logErr(`[enhance] capture job: ${(err && err.stack) || err}`);
      }
    }
    function pump(budget) {
      const t0 = performance.now();
      while (jobs.length && performance.now() - t0 < budget) stepJob();
    }
    function onIdle(dl) {
      ricId = 0;
      const t0 = performance.now();
      if (jobs.length) stepJob();
      while (jobs.length && dl.timeRemaining() > 3 && performance.now() - t0 < 10) stepJob();
      schedule();
    }
    function schedule() {
      if (ric && jobs.length && !ricId) ricId = ric(onIdle, { timeout: 400 });
    }
    // the first capture renders at mount; its plate detail waits for the webfonts (≤ 3 s)
    cur = drain(captureJob(capN++, infoFrom({ camId: 'CAM-0417' })));
    const cap0 = cur;
    let cap0Queued = false;
    const firstDetail = () => {
      if (cap0Queued) return;
      cap0Queued = true;
      if (!cap0.dtok) queueDetail(cap0);
    };
    if (HD.fontsReady) firstDetail();
    else {
      ctx.on('fonts:ready', firstDetail);
      setTimeout(firstDetail, 3000);
    }
    // title card + stamp sprites (shadowBlur) are built ahead of their first beat
    ctx.on('fonts:ready', () => {
      jobs.push(
        (function* () {
          sprites();
          yield 'sprites';
        })()
      );
      schedule();
    });
    prepareNext();

    /* ---- sequence state */
    let seq = null; // {t}
    let cut = null; // {t, to, info, swapped, fromCam}
    let pendingCam = null; // a camera the map reported; it gets the next capture and runs soon after
    let idle = 0;
    let idleAt = RM ? 3.4 : 2.6;
    let glitchT = 0;
    let tearT = 0;
    let snr = 9.4;
    let snrT = 0;

    function showCam() {
      setT(el.cam, cur.info.camId);
      setT(el.loc, `${cur.info.street} / ${cur.info.district}`);
      el.loc.title = el.loc.textContent;
      setT(el.fl2, `${T.vehicle} · ${T.vehicleColor} · SIV 75 · FLAGGED`);
    }
    showCam();

    function startSeq() {
      if (seq || cut) return false;
      seq = { t: 0 };
      idle = 0;
      ctx.emit('enhance:start', { camId: cur.info.camId });
      ctx.audio.chirp(300, 900, 140, 'square', 0.02);
      return true;
    }
    function beginCut(info, fromCam) {
      cut = { t: 0, to: next, info, swapped: false, fromCam };
      ctx.audio.chirp(1800, 240, 160, 'sawtooth', 0.014);
    }
    function matchBeat() {
      const plate = cur.S.plate;
      const confidence = +cur.conf.toFixed(1);
      ctx.emit('enhance:result', { camId: cur.info.camId, plate, confidence, match: 'WRAITH' });
      T.plateRevealed = true;
      ctx.flash('ok');
      ctx.alert('crit', `PLATE LOCK ${plate} — MATCH WRAITH`);
      ctx.audio.chirp(520, 1560, 240, 'sawtooth', 0.03);
      setT(el.fplate, plate);
      setT(el.fconf, `${confidence.toFixed(1)}%`);
    }
    function beats(t0, t1) {
      const x = (at) => t0 < at && t1 >= at;
      if (x(TL.enh1) || x(TL.enh2)) ctx.audio.beep(1320, 120, 'square', 0.04);
      SWEEPS.forEach((at, i) => {
        if (x(at)) ctx.audio.beep(520 + (i % 4) * 160, 45, 'square', 0.014);
      });
      if (x(TL.acq2)) ctx.audio.chirp(700, 1100, 90, 'square', 0.016);
      for (const c of cur.cells) if (!c.sep && x(TL.lock0 + c.order * TL.lockStep)) ctx.audio.beep(1760, 28, 'square', 0.012);
      if (x(TL.match)) matchBeat();
    }

    ctx.on('ui:enhance', () => startSeq());
    el.btn.addEventListener('click', () => startSeq());
    ctx.on('target:camera', (d) => {
      pendingCam = infoFrom(d);
    });
    ctx.on('intrusion', () => {
      glitchT = 0.6;
    });
    // a new cycle: the dossier re-redacts the plate, so the flag this panel owns goes back down too, and
    // the recon restarts from a fresh LIVE feed
    ctx.on('mission:reset', () => {
      T.plateRevealed = false;
      if (cut) return;
      if (next) {
        beginCut(pendingCam || autoInfo(), true);
        pendingCam = null;
      } else if (seq) {
        seq = null;
        idle = 0;
        idleAt = RM ? 3.4 : 2.6;
        tearT = 0.3;
      }
    });

    /* ---- view: where the virtual camera looks, in source pixels */
    function fitIn(v, r) {
      const hw = W / (2 * v.s);
      const hh = H / (2 * v.s);
      v.cx = hw * 2 >= r.w ? r.x + r.w / 2 : U.clamp(v.cx, r.x + hw, r.x + r.w - hw);
      v.cy = hh * 2 >= r.h ? r.y + r.h / 2 : U.clamp(v.cy, r.y + hh, r.y + r.h - hh);
      return v;
    }
    // The final read, laid out for the panel shape: where the plate settles (centre, on-screen width)
    // and where the OCR readout and the verdict go. 'stack' puts plate, readout and verdict in a
    // column; short wide strips go 'side' by side (the verdict replaces the readout at MATCH); tiny
    // bodies keep the plate alone ('solo') with its glyph boxes.
    function plateLayout(c) {
      if (c.pl && c.pl.W === W && c.pl.H === H && c.pl.hs === hs) return c.pl;
      const pb = c.S.plateBox;
      const a = pb.h / pb.w;
      const n = c.cells.length;
      const fk = Math.min(hs, 1.3);
      const top = TOP_H + 6;
      const bot = H - BOT_H - 6;
      const finTop = H - (30 + (W <= 330 ? 24 : 38)) * hs - 4; // the verdict box sits at bottom: 30px
      const pwMax = Math.min(0.86 * W, 560 + 0.25 * W);
      let L = null;
      // stacked, trimming the readout (confidence figures, then cell size) before giving up on it
      const cw0 = Math.min(40 * hs, (W * 0.84) / n);
      for (const [cw, fig] of [[cw0, true], [cw0, false], [Math.min(cw0, 28), false]]) {
        const ch = Math.round(cw * 1.2);
        const conf = fig && cw >= 25 * fk;
        const below = 22 + ch + (conf ? 26 : 12) * fk;
        const room = finTop - top - below;
        const pw = Math.min(pwMax, room / a);
        if (pw * a >= 20 && pw >= Math.min(pwMax, 0.45 * W)) {
          const ph = pw * a;
          const py = U.clamp(PLATE_Y * H, top + ph / 2, top + room - ph / 2);
          L = { mode: 'stack', pw, px: W / 2, py, ro: { cw, ch, conf, yMax: finTop - ch - (conf ? 26 : 12) * fk } };
          break;
        }
      }
      if (!L && W >= 440) {
        const avH = bot - top;
        let conf = true;
        let cw = Math.min(40 * hs, (avH - 16 - 26 - 6) / 1.2);
        if (cw < 24) {
          conf = false;
          cw = Math.min(40 * hs, (avH - 16 - 12 - 6) / 1.2);
        }
        if (cw >= 15) {
          const ch = Math.round(cw * 1.2);
          const rw = n * cw + 16;
          const gap = 30;
          const pw = Math.min(pwMax, 0.9 * (W - 32 - rw - gap), (avH * 0.8) / a);
          const x0 = (W - pw - gap - rw) / 2;
          const cy = (top + bot) / 2;
          const bh = 16 + ch + (conf ? 26 : 12);
          // the verdict takes the readout's place when that leaves it room, else the whole right side
          const fx0 = x0 + pw + 16;
          const rx = x0 + pw + gap + rw / 2;
          const half = Math.min(rx - fx0, W - 8 - rx);
          const fin = half * 2 >= 360 * hs ? { x: rx, y: cy, w: half * 2 } : { x: (fx0 + W - 8) / 2, y: cy, w: W - 8 - fx0 };
          L = { mode: 'side', pw, px: x0 + pw / 2, py: cy, ro: { cw, ch, conf, x: x0 + pw + gap + 8, y: Math.round(cy - bh / 2 + 16) }, fin };
        }
      }
      if (!L) {
        const room = finTop - top;
        const pw = Math.max(40, Math.min(0.86 * W, room / a));
        L = { mode: 'solo', pw, px: W / 2, py: top + Math.max(pw * a, room) / 2, ro: null };
      }
      L.W = W;
      L.H = H;
      L.hs = hs;
      L.s2 = L.pw / pb.w;
      c.pl = L;
      return L;
    }
    function keys(c) {
      const dr = c.detailR || FULL_R;
      if (c.vk && c.vk.W === W && c.vk.H === H && c.vk.hs === hs && c.vk.dr === dr) return c.vk;
      const cb = c.S.carBox;
      const pb = c.S.plateBox;
      const L = plateLayout(c);
      const s0 = Math.max(W / SRC_W, H / SRC_H);
      const v0 = fitIn({ cx: U.lerp(SRC_W / 2, cb.x + cb.w / 2, 0.3), cy: SRC_H / 2, s: s0 }, FULL_R);
      const s2 = Math.max(L.s2, s0 * 1.3);
      // the vehicle beat stays a real step in from LIVE and short of the plate
      const s1 = Math.max(s0 * 1.15, Math.min(s2 / 1.3, Math.max(s0 * 1.6, Math.min(W / (cb.w * 1.3), (H - TOP_H) / (cb.h * 1.4)))));
      const v1 = fitIn({ cx: cb.x + cb.w / 2, cy: cb.y + cb.h * 0.55, s: s1 }, FULL_R);
      const v1b = { cx: v1.cx, cy: v1.cy, s: s1 * 1.04 };
      const v2 = fitIn({ cx: pb.x + pb.w / 2 + (W / 2 - L.px) / s2, cy: pb.y + pb.h / 2 + (H / 2 - L.py) / s2, s: s2 }, dr);
      const v2b = { cx: v2.cx, cy: v2.cy, s: s2 * 1.025 };
      c.vk = { W, H, hs, dr, v0, v1, v1b, v2, v2b };
      return c.vk;
    }
    const vv = { cx: 0, cy: 0, s: 1, x: 0, y: 0 };
    // log-space zoom about the one point that stays put on screen: reads as a lens, not a pan
    function zoomLerp(a, b, e) {
      const s = Math.exp(Math.log(a.s) + (Math.log(b.s) - Math.log(a.s)) * e);
      const r = a.s / b.s;
      if (Math.abs(1 - r) < 1e-4) {
        vv.cx = U.lerp(a.cx, b.cx, e);
        vv.cy = U.lerp(a.cy, b.cy, e);
      } else {
        const fx = (b.cx - a.cx * r) / (1 - r);
        const fy = (b.cy - a.cy * r) / (1 - r);
        const q = a.s / s;
        vv.cx = fx + (a.cx - fx) * q;
        vv.cy = fy + (a.cy - fy) * q;
      }
      vv.s = s;
    }
    function viewAt(t) {
      const k = keys(cur);
      const io = U.ease.inOutCubic;
      const z1e = TL.z1 + TL.z1d;
      const z2e = TL.z2 + TL.z2d;
      if (!seq || t < TL.z1) zoomLerp(k.v0, k.v0, 0);
      else if (t < z1e) zoomLerp(k.v0, k.v1, io((t - TL.z1) / TL.z1d));
      else if (t < TL.z2) zoomLerp(k.v1, k.v1b, (t - z1e) / (TL.z2 - z1e));
      else if (t < z2e) zoomLerp(k.v1b, k.v2, io((t - TL.z2) / TL.z2d));
      else zoomLerp(k.v2, k.v2b, U.clamp((t - z2e) / (TL.cut - z2e), 0, 1));
      vv.x = vv.cx - W / (2 * vv.s);
      vv.y = vv.cy - H / (2 * vv.s);
      return vv;
    }
    const toPanel = (v, b) => ({ x: (b.x - v.x) * v.s, y: (b.y - v.y) * v.s, w: b.w * v.s, h: b.h * v.s });

    /* ---- drawing */
    // blits the part of `img` (covering source rect `rr`) that the view sees, rows y0..y1 of the panel
    function blit(g, img, rr, v, y0 = 0, y1 = H) {
      const f = img.width / rr.w;
      const sx0 = Math.max(v.x, rr.x);
      const sx1 = Math.min(v.x + W / v.s, rr.x + rr.w);
      const sy0 = Math.max(v.y + y0 / v.s, rr.y);
      const sy1 = Math.min(v.y + y1 / v.s, rr.y + rr.h);
      if (sx1 <= sx0 || sy1 <= sy0) return;
      g.drawImage(img, (sx0 - rr.x) * f, (sy0 - rr.y) * f, (sx1 - sx0) * f, (sy1 - sy0) * f, (sx0 - v.x) * v.s, (sy0 - v.y) * v.s, (sx1 - sx0) * v.s, (sy1 - sy0) * v.s);
    }
    // stage a, with stage a+1 revealed above the sweep line (or cross-faded under reduced motion)
    function layer(g, st, a, f, rr, v) {
      const last = st.length - 1;
      g.imageSmoothingEnabled = a === last;
      blit(g, st[a], rr, v);
      if (f < 0) return;
      g.imageSmoothingEnabled = a + 1 === last;
      if (RM) {
        g.globalAlpha = f;
        blit(g, st[a + 1], rr, v);
        g.globalAlpha = 1;
      } else {
        blit(g, st[a + 1], rr, v, 0, f * H);
      }
    }
    function stageInfo(t) {
      if (!seq || t < TL.z2 || !cur.plate) {
        const [a, f] = seq ? sweep(t, TL.sw1) : [0, -1];
        return { plate: false, a, f };
      }
      const [a, f] = sweep(t, TL.sw2);
      return { plate: true, a, f };
    }
    function drawFeed(g, v, si) {
      if (!si.plate) {
        layer(g, cur.car, si.a, si.f, FULL_R, v);
        return;
      }
      g.imageSmoothingEnabled = v.s < 2.5;
      blit(g, cur.car[4], FULL_R, v);
      layer(g, cur.plate, si.a, si.f, cur.detailR, v);
    }

    function drawSweep(g, si, v) {
      if (si.f < 0 || RM) return;
      const y = si.f * H;
      const img = (si.plate ? cur.plate : cur.car)[si.a + 1];
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 1;
      g.drawImage(trail, 0, y - 44, W, 44);
      // freshly reconstructed tiles flicker along the line
      const bs = Math.max(4, v.s / (img.width / (si.plate ? cur.detailR.w : SRC_W)));
      g.fillStyle = ctx.rgba('holo', 0.22);
      for (let i = 0; i < 10; i++) g.fillRect(Math.random() * W, y - bs * (1 + ((Math.random() * 3) | 0)), bs, bs);
      g.fillStyle = ctx.rgba('holo', 0.45);
      g.fillRect(0, y - 3, W, 5);
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = 'rgba(236,252,255,0.95)';
      g.fillRect(0, y - 1, W, 1.5);
    }
    // the "PASS n/4 · WxH" tag rides the sweep line; it takes the first slot that keeps clear of the
    // region read-out, the reconstruction block, the PiP and the status strip (or sits this frame out)
    // the source PiP (bottom right): sized to the panel, and left out where it would not fit under
    // the header with its label
    function pipGeom() {
      let pw = Math.round(U.clamp(W * 0.23, 68, 132 * hs));
      pw = Math.min(pw, Math.floor(((H - TOP_H - BOT_H - 44) * SRC_W) / SRC_H));
      if (pw < 60) return null;
      const ph = Math.round((pw * SRC_H) / SRC_W);
      return { x: W - pw - 10, y: H - BOT_H - ph - 22, pw, ph };
    }
    const pipRect = () => {
      const p = pipGeom();
      return p && { x: p.x, y: p.y - 14, w: p.pw, h: p.ph + 14 };
    };
    function drawSweepLabel(g, si, pipOn) {
      if (si.f < 0) return;
      const img = (si.plate ? cur.plate : cur.car)[si.a + 1];
      const label = `PASS ${si.a + 1}/4 · ${img.width}×${img.height}`;
      g.font = F_MONO(9);
      g.textBaseline = 'alphabetic';
      const lw = g.measureText(label).width;
      const busy = [];
      if (subBox) busy.push(subBox);
      if (tagBox) busy.push(tagBox);
      if (procOn) busy.push({ x: 0, y: 0, w: procBox.x + procBox.w + 4, h: procBox.y + procBox.h + 2 });
      const pip = pipOn ? pipRect() : null;
      if (pip) busy.push(pip);
      const clear = (x, y) => y - 10 > TOP_H && y + 3 < H - BOT_H && !busy.some((b) => hit({ x: x - 3, y: y - 10, w: lw + 6, h: 13 }, b));
      const ly = si.f * H;
      // reduced motion has no moving line: the tag parks bottom-right
      const ys = RM ? [H - BOT_H - 10, TOP_H + 16] : [ly - 6, ly + 14];
      const xs = [W - 12 - lw, (pip ? pip.x : W) - 10 - lw, 12];
      for (const y of ys) {
        for (const x of xs) {
          if (!clear(x, y)) continue;
          g.textAlign = 'left';
          g.fillStyle = ctx.rgba(RM ? 'holo' : 'ice', 0.9);
          g.fillText(label, x, y);
          return;
        }
      }
    }

    function drawGrain(g, amt, bars, now) {
      if (!grainPat) grainPat = g.createPattern(noise, 'repeat');
      const ox = RM ? 0 : (Math.random() * 128) | 0;
      const oy = RM ? 0 : (Math.random() * 128) | 0;
      g.save();
      g.globalAlpha = amt;
      g.translate(-ox, -oy);
      g.fillStyle = grainPat;
      g.fillRect(ox, oy, W, H);
      g.restore();
      if (bars <= 0) return;
      const ts = (now / 1000) * (RM ? 0.3 : 1);
      g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 2; i++) {
        const bh = H * (i ? 0.09 : 0.24);
        const y = ((ts * (i ? 61 : 33) + i * 0.47 * H) % (H + bh)) - bh;
        g.globalAlpha = (i ? 0.1 : 0.07) * bars;
        g.drawImage(band, 0, y, W, bh);
      }
      g.globalCompositeOperation = 'source-over';
      const bh = H * 0.16;
      const y = ((ts * 21 + 0.2 * H) % (H + bh)) - bh;
      g.globalAlpha = 0.28 * bars;
      g.fillStyle = '#000';
      g.fillRect(0, y + bh * 0.35, W, bh * 0.3);
      g.globalAlpha = 1;
    }

    let tagY = 0; // baseline of the last region tag, so its coordinate line can keep clear
    let tagBox = null; // this frame's region tag
    let pipBox = null; // this frame's PiP footprint, when it is up
    function tag(g, x, y, text, bg, fg, right) {
      g.font = F_UI(9.5);
      g.letterSpacing = '1px';
      const w = g.measureText(text).width + 8;
      y = U.clamp(y, TOP_H + 14, H - BOT_H - 4);
      if (procOn && x < procBox.x + procBox.w + 4 && y - 14 < procBox.y + procBox.h) {
        x = Math.max(procBox.x + procBox.w + 6, right - w);
        if (x > W - w - 4) y = Math.min(procBox.y + procBox.h + 16, H - BOT_H - 4);
      }
      if (pipBox && hit({ x, y: y - 13, w, h: 14 }, pipBox)) x = pipBox.x - w - 4;
      x = U.clamp(x, 4, W - w - 4);
      tagY = y;
      tagBox = { x, y: y - 13, w, h: 14 };
      g.fillStyle = bg;
      g.fillRect(x, y - 13, w, 14);
      g.fillStyle = fg;
      g.textAlign = 'left';
      g.textBaseline = 'alphabetic';
      g.fillText(text, x + 4, y - 3);
      g.letterSpacing = '0px';
    }

    // a region box that snaps in steps from wide to tight, then locks
    function region(g, t, t0, b, v, label, sub, alpha) {
      const p = U.clamp((t - t0) / 0.6, 0, 1);
      const e = RM ? U.ease.outCubic(p) : p >= 1 ? 1 : 0.75 * (Math.floor(U.ease.outExpo(p) * 5) / 5) + 0.25 * U.ease.outExpo(p);
      const tb = toPanel(v, b);
      const cx = tb.x + tb.w / 2;
      const cy = tb.y + tb.h / 2;
      const k = U.lerp(2.3, 1, e);
      const w = tb.w * k;
      const h = tb.h * k;
      const x = cx - w / 2;
      const y = cy - h / 2;
      g.globalAlpha = alpha;
      g.strokeStyle = ctx.rgba('threat', 0.28);
      g.lineWidth = 1;
      g.strokeRect(x + 0.5, y + 0.5, w, h);
      g.strokeStyle = C.threat;
      g.lineWidth = p >= 1 && !RM && ((t * 6) | 0) % 2 === 0 && t - t0 < 1.1 ? 2.5 : 1.6;
      brackets(g, x, y, w, h, Math.max(8, Math.min(w, h) * 0.22));
      // centre tick
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(cx - 5, cy);
      g.lineTo(cx + 5, cy);
      g.moveTo(cx, cy - 5);
      g.lineTo(cx, cy + 5);
      g.stroke();
      tag(g, x, y - 3, label, ctx.rgba('threat', 0.88), '#1a0308', x + w);
      if (p >= 1) {
        const n = Math.min(sub.length, ((t - t0 - 0.6) * 60) | 0);
        g.font = F_MONO(9);
        g.fillStyle = ctx.rgba('ice', 0.85);
        // clamp by the full line, so the typed-in text never runs off the right edge
        const sw = g.measureText(sub).width;
        let sx = U.clamp(x, 4, Math.max(4, W - sw - 6));
        let sy = Math.min(y + h + 12, H - BOT_H - 6);
        // pinned against the status strip with the tag: the line goes above the tag instead
        if (Math.abs(sy - tagY) < 13) sy = tagY - 16 > TOP_H + 10 ? tagY - 16 : -1;
        if (pipBox && hit({ x: sx, y: sy - 9, w: sw, h: 12 }, pipBox)) sx = Math.max(4, pipBox.x - sw - 6);
        // it sits the frame out rather than run under the DOM readout block or the PiP
        const sb = { x: sx, y: sy - 9, w: sw, h: 12 };
        if ((procOn && hit(sb, procBox)) || (pipBox && hit(sb, pipBox))) sy = -1;
        if (sy > 0) {
          g.fillText(sub.slice(0, n), sx, sy);
          if (alpha > 0.05) subBox = { x: sx, y: sy - 9, w: sw, h: 12 };
        }
      }
      g.globalAlpha = 1;
    }

    function detections(g, t, v, amt) {
      const objs = cur.S.objs;
      g.lineWidth = 1;
      g.font = F_MONO(9);
      objs.forEach((o, i) => {
        if (hash(i * 7 + cur.n, (t * 9) | 0) < 0.3) return;
        const b = toPanel(v, o.b);
        if (b.w < 6 || b.x > W || b.y > H || b.x + b.w < 0 || b.y + b.h < TOP_H) return;
        g.globalAlpha = amt;
        g.strokeStyle = ctx.rgba('holo', 0.55);
        g.strokeRect(b.x + 0.5, b.y + 0.5, b.w, b.h);
        g.fillStyle = ctx.rgba('holo', 0.85);
        // a box that tops out under the header strip gets its label underneath instead
        g.fillText(`${o.label} ${o.conf.toFixed(2)}`, b.x, b.y - 3 < TOP_H + 10 ? b.y + b.h + 10 : b.y - 3);
      });
      g.globalAlpha = 1;
    }

    // idle LIVE: the analytics scan one object at a time
    function scanIdle(g, v) {
      const objs = cur.S.objs;
      if (!objs.length) return;
      const slot = Math.floor(idle / 1.6);
      if (idle / 1.6 - slot > 0.5) return;
      const o = objs[(slot + cur.n) % objs.length];
      const b = toPanel(v, o.b);
      if (b.w < 6 || b.y < TOP_H) return;
      g.strokeStyle = ctx.rgba('holo', 0.6);
      g.lineWidth = 1;
      brackets(g, b.x - 2, b.y - 2, b.w + 4, b.h + 4, 6);
      g.font = F_MONO(9);
      g.fillStyle = ctx.rgba('holo', 0.85);
      g.fillText(`${o.label} ${o.conf.toFixed(2)}`, b.x, b.y - 5 < TOP_H + 10 ? b.y + b.h + 12 : b.y - 5);
    }

    function drawWord(g, t, t0, sub) {
      const p = (t - t0) / WORD_D;
      if (p < 0 || p > 1) return;
      const sp = sprites();
      const x = (W - sp.w) / 2;
      const y = (H - sp.h) / 2 - H * 0.03;
      const fade = p < 0.1 ? p / 0.1 : p > 0.82 ? (1 - p) / 0.18 : 1;
      if (!RM && p < 0.12) {
        g.fillStyle = `rgba(210,250,255,${(0.3 * (0.12 - p)) / 0.12})`;
        g.fillRect(0, 0, W, H);
      }
      g.globalAlpha = fade * 0.62;
      g.fillStyle = '#020609';
      g.fillRect(0, y + sp.h * 0.18, W, sp.h * 0.64);
      g.globalAlpha = fade;
      g.fillStyle = ctx.rgba('holo', 0.7);
      g.fillRect(0, y + sp.h * 0.18, W, 1);
      g.fillRect(0, y + sp.h * 0.82, W, 1);
      if (RM) {
        g.drawImage(sp.white, x, y, sp.w, sp.h);
      } else {
        const glitchy = p < 0.3 || p > 0.84;
        const off = glitchy ? 3 + 9 * Math.random() : 1.5;
        g.globalCompositeOperation = 'lighter';
        g.drawImage(sp.cyan, x - off, y, sp.w, sp.h);
        g.drawImage(sp.mag, x + off, y, sp.w, sp.h);
        g.globalCompositeOperation = 'source-over';
        if (glitchy) {
          const d = view.dpr;
          const n = 6;
          for (let i = 0; i < n; i++) {
            const sy = (sp.h / n) * i;
            const dx = Math.random() < 0.5 ? (Math.random() - 0.5) * 26 : 0;
            g.drawImage(sp.white, 0, sy * d, sp.w * d, (sp.h / n) * d, x + dx, y + sy, sp.w, sp.h / n);
          }
        } else {
          g.drawImage(sp.white, x, y, sp.w, sp.h);
        }
      }
      g.font = F_MONO(9);
      g.textAlign = 'center';
      g.fillStyle = ctx.rgba('holo', 0.95);
      g.fillText(sub, W / 2, y + sp.h * 0.82 + 12);
      g.textAlign = 'left';
      g.globalAlpha = 1;
    }

    function drawPip(g, v, z, alpha) {
      const pg = alpha > 0 && pipGeom();
      if (!pg) return;
      const { x, y, pw, ph } = pg;
      g.globalAlpha = alpha;
      g.imageSmoothingEnabled = true;
      g.fillStyle = '#000';
      g.fillRect(x - 1, y - 1, pw + 2, ph + 2);
      g.drawImage(cur.thumb, x, y, pw, ph);
      g.strokeStyle = ctx.rgba('holo', 0.6);
      g.lineWidth = 1;
      g.strokeRect(x - 0.5, y - 0.5, pw + 1, ph + 1);
      const k = pw / SRC_W;
      const rw = Math.max(3, (W / v.s) * k);
      const rh = Math.max(3, (H / v.s) * k);
      g.strokeStyle = C.threat;
      g.strokeRect(x + v.x * k, y + v.y * k, rw, rh);
      g.font = F_MONO(9);
      g.fillStyle = ctx.rgba('ice', 0.9);
      g.textAlign = 'right';
      g.fillText(pw > 96 ? `SRC · VIEW ×${z.toFixed(1)}` : `×${z.toFixed(1)}`, x + pw, y - 5);
      g.textAlign = 'left';
      g.globalAlpha = 1;
    }

    function drawOCR(g, t, v) {
      const c = cur;
      const m = c.S.plateM;
      const pt = (u, w) => [(m[0] * u + m[2] * w + m[4] - v.x) * v.s, (m[1] * u + m[3] * w + m[5] - v.y) * v.s];
      const a = U.clamp((t - TL.ocr) / 0.35, 0, 1);
      const quad = (q) => {
        g.beginPath();
        g.moveTo(q[0][0], q[0][1]);
        for (let i = 1; i < 4; i++) g.lineTo(q[i][0], q[i][1]);
        g.closePath();
      };
      const upNext = c.cells.find((cl) => !cl.sep && t < TL.lock0 + cl.order * TL.lockStep);
      g.lineWidth = 1;
      for (const cell of c.cells) {
        if (cell.sep) continue;
        const lockAt = TL.lock0 + cell.order * TL.lockStep;
        const lk = t >= lockAt;
        const q = [pt(cell.x0 + 3, cell.y0), pt(cell.x1 - 3, cell.y0), pt(cell.x1 - 3, cell.y1), pt(cell.x0 + 3, cell.y1)];
        quad(q);
        if (lk && t - lockAt < 0.25) {
          g.fillStyle = ctx.rgba('phosphor', 0.3 * (1 - (t - lockAt) / 0.25));
          g.fill();
        } else if (cell === upNext) {
          g.fillStyle = ctx.rgba('amber', 0.16);
          g.fill();
        }
        g.strokeStyle = lk ? ctx.rgba('phosphor', 0.95) : ctx.rgba('holo', 0.75 * a);
        g.stroke();
      }
      const tl = pt(0, 0);
      const tr = pt(PLATE_W, 0);
      const bl = pt(0, PLATE_H);
      const br = pt(PLATE_W, PLATE_H);
      const plateTop = Math.min(tl[1], tr[1]);
      const plateBot = Math.max(bl[1], br[1]);
      if (t >= TL.match) {
        g.strokeStyle = RM ? C.threat : ctx.rgba('threat', 0.65 + 0.35 * Math.cos((t - TL.match) * 7));
        g.lineWidth = 2;
        const px0 = Math.min(tl[0], bl[0]) - 6;
        const px1 = Math.max(tr[0], br[0]) + 6;
        brackets(g, px0, plateTop - 6, px1 - px0, plateBot - plateTop + 12, 14);
        g.lineWidth = 1;
      }
      // readout row: every cell cycles glyphs until its lock, with a confidence meter (numbers when
      // the cells are wide enough to hold them)
      const L = plateLayout(c);
      const ro = L.ro;
      const side = L.mode === 'side';
      const ra = a * (side ? 1 - U.clamp((t - TL.match) / 0.25, 0, 1) : 1);
      if (ro && ra > 0) {
        const n = c.cells.length;
        const fk = Math.min(hs, 1.3);
        const { cw, ch } = ro;
        const x0 = Math.round(side ? ro.x : W / 2 - (n * cw) / 2);
        const y0 = Math.round(side ? ro.y : Math.min(plateBot + 22, ro.yMax));
        const lw = n * cw;
        g.globalAlpha = ra;
        g.fillStyle = 'rgba(2,8,12,0.78)';
        g.fillRect(x0 - 8, y0 - 16 * fk, lw + 16, ch + (16 + (ro.conf ? 26 : 12)) * fk);
        g.font = F_UI(9 * fk);
        g.letterSpacing = '1px';
        g.fillStyle = ctx.rgba('holo', 0.9);
        g.fillText(lw >= 150 * fk ? 'OCR · SIV-FR · 7 GLYPHS' : 'OCR · SIV-FR', x0 - 2, y0 - 5 * fk);
        if (lw >= 225 * fk) {
          g.textAlign = 'right';
          g.fillStyle = ctx.rgba('text', 0.8);
          g.fillText(`${(t - TL.ocr > 0 ? Math.min(99, ((t - TL.ocr) * 131) | 0) : 0) + 1} FR/S`, x0 + lw + 2, y0 - 5 * fk);
        }
        g.letterSpacing = '0px';
        g.textAlign = 'center';
        const fs = Math.round(ch * 0.66);
        c.cells.forEach((cell, i) => {
          const x = x0 + i * cw;
          const lockAt = TL.lock0 + cell.order * TL.lockStep;
          const lk = cell.sep || t >= lockAt;
          g.strokeStyle = lk ? ctx.rgba('phosphor', cell.sep ? 0.25 : 0.7) : ctx.rgba('holo', 0.35);
          g.strokeRect(x + 2.5, y0 + 0.5, cw - 5, ch);
          let chr = cell.ch;
          if (!lk) chr = GLYPHS[(hash(i + c.n * 13, (t * 16) | 0) * GLYPHS.length) | 0];
          g.font = F_MONO(fs, 700);
          g.fillStyle = lk ? (cell.sep ? ctx.rgba('text', 0.6) : C.ice) : C.amber;
          g.fillText(chr, x + cw / 2, y0 + ch / 2 + fs * 0.36);
          if (cell.sep) return;
          const conf = lk ? cell.conf : 40 + 50 * hash(i, (t * 12) | 0);
          const bw = cw - 8;
          g.fillStyle = ctx.rgba('holo', 0.15);
          g.fillRect(x + 4, y0 + ch + 4, bw, 3);
          g.fillStyle = lk ? C.phosphor : C.amber;
          g.fillRect(x + 4, y0 + ch + 4, (bw * conf) / 100, 3);
          if (!ro.conf) return;
          g.font = F_MONO(9 * fk);
          g.fillStyle = lk ? ctx.rgba('phosphor', 0.95) : ctx.rgba('amber', 0.8);
          g.fillText(lk ? conf.toFixed(1) : '··.·', x + cw / 2, y0 + ch + 17 * fk);
        });
      }
      g.textAlign = 'left';
      g.globalAlpha = 1;
      if (t >= TL.match) {
        const sp = sprites();
        const p = (t - TL.match) / 0.2;
        const sc = RM ? 1 : 1 + 0.9 * (1 - U.ease.outCubic(Math.min(1, p)));
        const x = Math.min(W - sp.sw / 2 - 10, Math.max(tr[0], br[0]) - sp.sw * 0.4);
        const y = Math.max(TOP_H + sp.sh / 2 + 6, plateTop - sp.sh * 0.42);
        g.save();
        g.globalAlpha = RM ? Math.min(1, (t - TL.match) / 0.4) : Math.min(1, p * 1.6);
        g.translate(x, y);
        g.rotate(-0.12);
        g.scale(sc, sc);
        g.drawImage(sp.stamp, -sp.sw / 2, -sp.sh / 2, sp.sw, sp.sh);
        g.restore();
      }
    }

    // the DOM readout block's footprint (top-left), so canvas tags can keep clear of it
    let procOn = false;
    let procBox = { x: 13, y: 42, w: 184, h: 150 };
    let subBox = null; // this frame's region coordinate line

    function drawOsd(g, now, alpha) {
      if (alpha <= 0) return;
      const d = new Date();
      const off = (HD.tz && HD.tz.offset) || 0;
      const loc = new Date(d.getTime() + off * 3600000);
      const date = W < 330 ? '' : `${loc.getUTCFullYear()}-${U.pad(loc.getUTCMonth() + 1)}-${U.pad(loc.getUTCDate())} `;
      const s = `${cur.info.camId}  ${date}${U.fmtClock(d, off)}.${U.pad(loc.getUTCMilliseconds(), 3)}  REC`;
      g.font = F_MONO(10 * Math.min(hs, 1.3));
      g.textAlign = 'left';
      g.textBaseline = 'alphabetic';
      const y = H - BOT_H - 9;
      g.globalAlpha = alpha;
      g.fillStyle = 'rgba(0,0,0,0.7)';
      g.fillText(s, 17, y + 1);
      g.fillStyle = 'rgba(236,246,240,0.9)';
      g.fillText(s, 16, y);
      if (RM || ((now / 500) | 0) % 2 === 0) {
        g.fillStyle = C.threat;
        g.beginPath();
        g.arc(16 + g.measureText(s).width + 7, y - 3.5, 3.2, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
    }

    function glitch(g, amt, rgb) {
      const c = view.canvas;
      const cw = c.width;
      const chh = c.height;
      if (scratch.width !== cw || scratch.height !== chh) {
        scratch.width = tint.width = cw;
        scratch.height = tint.height = chh;
      }
      scratch.g.globalCompositeOperation = 'copy';
      scratch.g.drawImage(c, 0, 0);
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      const n = 2 + Math.round(amt * 10);
      for (let i = 0; i < n; i++) {
        const sh = Math.max(2, (0.01 + Math.random() * 0.12 * amt) * chh);
        const sy = Math.random() * (chh - sh);
        const dx = (Math.random() - 0.5) * 0.18 * amt * cw;
        g.drawImage(scratch, 0, sy, cw, sh, dx, sy, cw, sh);
      }
      if (rgb) {
        for (const [hex, sgn] of [[C.neon, 1], [C.holo, -1]]) {
          tint.g.globalCompositeOperation = 'copy';
          tint.g.drawImage(scratch, 0, 0);
          tint.g.globalCompositeOperation = 'multiply';
          tint.g.fillStyle = hex;
          tint.g.fillRect(0, 0, cw, chh);
          g.globalCompositeOperation = 'lighter';
          g.globalAlpha = 0.5 * amt;
          g.drawImage(tint, sgn * amt * cw * (0.012 + Math.random() * 0.02), 0);
        }
      }
      g.restore();
    }

    /* ---- HUD text */
    // the verdict box: bottom centre, or in the readout's place on a side-by-side strip
    function placeFin() {
      const f = plateLayout(cur).fin;
      const st = el.fin.style;
      st.left = f ? `${f.x / hs}px` : '';
      st.top = f ? `${f.y / hs}px` : '';
      st.bottom = f ? 'auto' : '';
      st.transform = f ? 'translate(-50%, -50%)' : '';
      st.maxWidth = f ? `${f.w / hs}px` : '';
      el.fin.classList.toggle('is-side', !!f);
    }
    function hudUpdate(t, v, si, ph, z, now) {
      const k = keys(cur);
      setT(el.st, STATE[ph]);
      if (el.st.dataset.s !== ph) el.st.dataset.s = ph;
      setT(el.zm, `×${z.toFixed(1)}`);
      const img = si.plate ? cur.plate[si.a] : cur.car[si.a];
      setT(el.res, `${img.width}×${img.height}`);
      snrT -= 1;
      if (snrT <= 0) {
        snrT = 5;
        const base = !seq ? 8.4 : si.plate ? 30 + si.a * 3.1 : 9 + si.a * 5.2;
        snr = base + R.range(-0.8, 0.8);
      }
      setT(el.snr, `${snr.toFixed(1)} dB`);
      const clk = U.fmtClock(new Date(), (HD.tz && HD.tz.offset) || 0);
      setT(el.clk, clk);
      const showProc = procShown(t);
      if (el.proc.hidden === showProc) el.proc.hidden = !showProc;
      if (showProc) {
        const done = (si.plate ? 4 : 0) + si.a + Math.max(0, si.f);
        const pct = Math.min(100, Math.round((done / 8) * 100));
        setT(el.pct, `${pct}%`);
        setVar(el.meter, '__p', pct / 100);
        setT(el.up, `×${UPSCALE[si.a]}`);
        // the pass in flight, matching the "PASS n/4" tag on the sweep line
        setT(el.db, `${Math.min(4, si.a + (si.f >= 0 ? 1 : 0))}/4`);
        setT(el.pres, `${img.width}×${img.height} → ${si.plate ? '7680×4320' : '3840×2160'}`);
        const target = t < TL.acq2 ? k.v1.s / k.v0.s : k.v2.s / k.v0.s;
        setT(el.pzm, `×${z.toFixed(1)} → ×${target.toFixed(1)}`);
      }
      const showFin = seq && t >= TL.match;
      if (el.fin.hidden === !!showFin) {
        el.fin.hidden = !showFin;
        if (showFin) placeFin();
      }
      const busy = !!(seq || cut);
      if (el.btn.classList.contains('is-busy') !== busy) {
        el.btn.classList.toggle('is-busy', busy);
        el.btn.setAttribute('aria-disabled', String(busy));
      }
      setVar(el.btn, '__p', seq ? Math.min(1, t / TL.cut) : 0);
      const id = cur.info.camId;
      meta(ph === 'live' ? `${id} · LIVE` : ph === 'acq' ? `${id} · ACQUIRE` : ph === 'enh' ? 'ENHANCING' : ph === 'ocr' ? 'OCR · SIV-FR' : 'MATCH · WRAITH');
    }

    function draw(now, dt) {
      const g = view.ctx;
      const t = seq ? seq.t : 0;
      const v = viewAt(t);
      const si = stageInfo(t);
      procOn = procShown(t);
      const ph = !seq ? 'live' : t < TL.enh1 ? 'acq' : t < TL.ocr ? 'enh' : t < TL.match ? 'ocr' : 'match';
      const z = v.s / keys(cur).v0.s;
      const inCard = (t0) => t >= t0 && t < t0 + WORD_D;
      const under = seq && (inCard(TL.enh1) || inCard(TL.enh2)) ? 0.3 : 1;
      // the MATCH stamp lands with a short thump
      const dpr = view.dpr;
      const thump = !RM && seq && t >= TL.match && t < TL.match + 0.18 ? (1 - (t - TL.match) / 0.18) * 7 * dpr : 0;
      g.setTransform(dpr, 0, 0, dpr, thump * (Math.random() - 0.5), thump * (Math.random() - 0.5));
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = '#020407';
      g.fillRect(-8, -8, W + 16, H + 16);
      drawFeed(g, v, si);
      drawSweep(g, si, v);
      const grain = !seq ? 1 : si.plate ? 0.28 - si.a * 0.04 : [1, 0.72, 0.5, 0.36, 0.28][si.a];
      const bars = !seq || t < TL.z1 ? 1 : U.clamp(1 - (t - TL.z1) / 1.2, 0.18, 1);
      drawGrain(g, grain, bars, now);
      const pipA = seq ? U.clamp((z - 1.3) / 0.5, 0, 1) * (t >= TL.ocr ? Math.max(0, 1 - (t - TL.ocr) / 0.3) : 1) : 0;
      subBox = null;
      tagBox = null;
      pipBox = pipA > 0.05 ? pipRect() : null;
      if (!seq) {
        scanIdle(g, v);
      } else {
        if (t < TL.enh1 + 0.3) detections(g, t, v, t < TL.enh1 ? 1 : 1 - (t - TL.enh1) / 0.3);
        if (t < TL.acq2) region(g, t, 0, cur.S.carBox, v, 'REGION 01 · VEHICLE', regionSub(cur.S.carBox), under * (t > TL.acq2 - 0.35 ? (TL.acq2 - t) / 0.35 : 1));
        if (t >= TL.acq2 && t < TL.ocr) {
          const pb = cur.S.plateBox;
          const b = { x: pb.x - pb.w * 0.12, y: pb.y - pb.h * 0.5, w: pb.w * 1.24, h: pb.h * 2 };
          region(g, t, TL.acq2, b, v, 'REGION 02 · PLATE', `${regionSub(pb)} · SKEW ${((Math.atan2(cur.S.plateM[1], cur.S.plateM[0]) * 180) / Math.PI).toFixed(1)}°`, under * (t > TL.ocr - 0.3 ? (TL.ocr - t) / 0.3 : 1));
        }
        if (t >= TL.ocr) drawOCR(g, t, v);
        drawSweepLabel(g, si, pipA > 0.05);
        drawWord(g, t, TL.enh1, 'PASS 1 · REGION 01 · VEHICLE');
        drawWord(g, t, TL.enh2, 'PASS 2 · REGION 02 · PLATE');
      }
      drawPip(g, v, z, pipA);
      drawOsd(g, now, !seq ? 1 : Math.max(0, 1 - t / 0.35));
      // interference: intrusion burst, the cut between cameras, occasional tape tearing on LIVE
      let gl = 0;
      let rgb = false;
      if (glitchT > 0) {
        gl = Math.max(gl, 0.35 + 0.65 * (glitchT / 0.6));
        rgb = true;
      }
      if (cut) {
        gl = Math.max(gl, 1 - Math.abs(cut.t / CUT_D - 0.5) * 2);
        rgb = true;
      }
      if (tearT > 0) gl = Math.max(gl, 0.22);
      if (gl > 0) {
        if (RM) {
          g.fillStyle = cut ? `rgba(2,4,7,${0.85 * gl})` : `rgba(255,42,109,${0.16 * gl})`;
          g.fillRect(0, 0, W, H);
        } else {
          glitch(g, gl, rgb);
        }
      }
      if (glitchT > 0) {
        g.font = F_UI(11);
        g.letterSpacing = '3px';
        g.textAlign = 'center';
        g.fillStyle = C.neon;
        g.fillText('SIGNAL INTERFERENCE', W / 2, H / 2);
        g.textAlign = 'left';
        g.letterSpacing = '0px';
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      hudUpdate(t, v, si, ph, z, now);
    }
    // the readout block runs through ENHANCE, stepping aside while a title card is up
    const procShown = (t) =>
      !!seq && t >= TL.enh1 + WORD_D * 0.8 && t < (procAway ? TL.z2 + TL.z2d * 0.4 : TL.ocr) && !(t >= TL.enh2 && t < TL.enh2 + WORD_D * 0.8);
    const regionSub = (b) => `X${U.pad(Math.round(b.x), 4)} Y${U.pad(Math.round(b.y), 4)} · ${Math.round(b.w)}×${Math.round(b.h)}`;

    // HUD scale, strip heights and the readout block's footprint for this body size
    function layoutHud() {
      hs = U.clamp(Math.min(W / 700, H / 560), 1, 1.5);
      hs = Math.round(hs * 20) / 20;
      ctx.el.style.setProperty('--enh-k', String(hs));
      TOP_H = 34 * hs;
      BOT_H = 22 * hs;
      const hidden = el.proc.hidden;
      el.proc.hidden = false;
      el.proc.style.left = '';
      const hr = hud.getBoundingClientRect();
      const pr = el.proc.getBoundingClientRect();
      el.proc.hidden = hidden;
      // per axis: a layout morph can leave the panel non-uniformly scaled while this runs
      const qx = hr.width > 0 ? W / hr.width : 1;
      const qy = hr.height > 0 ? H / hr.height : 1;
      procHome = { x: (pr.left - hr.left) * qx, y: (pr.top - hr.top) * qy, w: pr.width * qx, h: pr.height * qy };
      placeProc();
    }
    // Where the plate settles on a strip or a tiny body, the readout block would sit on it: beside the
    // plate it moves over to the readout's spot (free until OCR); on a tiny body it bows out early.
    let procHome = { x: 13, y: 42, w: 184, h: 150 };
    let procAway = false;
    function placeProc() {
      const L = plateLayout(cur);
      const pb = cur.S.plateBox;
      const ph = (L.pw * pb.h) / pb.w;
      let left = -1;
      procAway = false;
      if (L.mode !== 'stack' && hit(procHome, { x: L.px - L.pw / 2, y: L.py - ph / 2, w: L.pw, h: ph })) {
        if (L.mode === 'side' && L.ro.x - 8 + procHome.w <= W - 6) left = L.ro.x - 8;
        else procAway = true;
      }
      el.proc.style.left = left < 0 ? '' : `${left / hs}px`;
      procBox = left < 0 ? procHome : { x: left, y: procHome.y, w: procHome.w, h: procHome.h };
    }
    // after a resize settles: a capture whose plate detail no longer fits the new shape is rebuilt,
    // and a read already on the plate restarts from LIVE rather than play a mismatched frame
    let fitAt = 0;
    function refit() {
      fitAt = 0;
      if (staleDetail(cur)) {
        if (seq && seq.t >= TL.acq2 - 0.4) {
          seq = null;
          idle = 0;
          idleAt = RM ? 2.4 : 1.6;
          tearT = 0.3;
        }
        queueDetail(cur);
      }
      if (next && staleDetail(next)) queueDetail(next);
    }

    return {
      fps: 30,
      resize(w, h) {
        W = w;
        H = h;
        layoutHud();
        if (!el.fin.hidden) placeFin();
        fitAt = performance.now() + 350;
      },
      tick(now, dt) {
        if (fitAt && now > fitAt) refit();
        // a beat waiting on the builder borrows a little tick time; otherwise it lives in idle time
        const urgent = seq && ((!cur.plate && seq.t > TL.acq2 - 2) || (!next && seq.t > TL.match));
        if (!ric || urgent) pump(1.5);
        const step = dt * SPEED;
        if (glitchT > 0) glitchT -= dt;
        if (tearT > 0) tearT -= dt;
        if (cut) {
          cut.t += dt;
          if (!cut.swapped && cut.t >= CUT_D / 2) {
            cut.swapped = true;
            cur = cut.to;
            cur.info = cut.info;
            next = null;
            seq = null;
            idle = 0;
            idleAt = cut.fromCam ? (RM ? 2.4 : 1.6) : R.range(5, 9);
            showCam();
            placeProc();
            if (staleDetail(cur)) queueDetail(cur);
            prepareNext();
          }
          if (cut.t >= CUT_D) cut = null;
        } else if (seq) {
          const prev = seq.t;
          let nt = prev + step;
          // the plate render has not landed yet: hold the beat rather than enhance nothing
          if (nt >= TL.acq2 && !cur.plate) nt = Math.max(prev, TL.acq2 - 0.001);
          if (nt >= TL.cut) {
            nt = TL.cut;
            if (next) {
              beginCut(pendingCam || autoInfo(), !!pendingCam);
              pendingCam = null;
            }
          }
          seq.t = nt;
          beats(prev, nt);
        } else {
          idle += dt;
          if (!RM && tearT <= 0 && R() < dt * 0.35) tearT = R.range(0.06, 0.14);
          if (pendingCam) {
            if (next) {
              beginCut(pendingCam, true);
              pendingCam = null;
            }
          } else if (idle >= idleAt) {
            startSeq();
          }
        }
        draw(now, dt);
      },
    };
  });
})();
