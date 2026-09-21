/* FEDLIGHT · P-11 BIOMETRIC
   Procedural 3D face scan (point mesh, depth-faded wireframe, sweeping scan line, landmark
   measurements) over a civil-registry match carousel that locks onto WRAITH every ~23 s. */
(() => {
  'use strict';

  HD.panel('face', (ctx) => {
    const U = ctx.util;
    const C = ctx.color;
    const RM = ctx.reducedMotion;
    const R = ctx.rng(HD.seed ^ 0xface11);
    const cv = ctx.canvas();
    const g = cv.ctx;
    const TAU = Math.PI * 2;

    const MONO = (px, wt = 500) => `${wt} ${px}px "JetBrains Mono", Consolas, monospace`;
    const UI = (px) => `600 ${px}px "Chakra Petch", "Segoe UI", sans-serif`;
    const DISP = (px) => `${px}px Michroma, "Arial Black", sans-serif`;
    const monoW = (s, px) => s.length * px * 0.6; // JetBrains Mono advance is 0.6 em
    const setLS = (v) => {
      if ('letterSpacing' in g) g.letterSpacing = v;
    };

    /* ------------------------------------------------------------ head model */

    const smooth = (a, b, x) => {
      const t = U.clamp((x - a) / (b - a), 0, 1);
      return t * t * (3 - 2 * t);
    };
    const gau = (dx, sx, dy, sy) => Math.exp(-(dx * dx) / (sx * sx) - (dy * dy) / (sy * sy));

    function headParams(seed) {
      const r = HD.rng(seed >>> 0);
      return {
        a: r.range(0.66, 0.72),
        c: r.range(0.78, 0.86),
        chinW: r.range(0.3, 0.4),
        brow: r.range(0.26, 0.3),
        eyeY: r.range(0.11, 0.14),
        eyeX: r.range(0.25, 0.29),
        noseLen: r.range(0.34, 0.41),
        noseH: r.range(0.24, 0.3),
        mouthY: r.range(-0.5, -0.46),
        mouthW: r.range(0.16, 0.2),
        lip: r.range(0.045, 0.065),
        chin: r.range(0.06, 0.1),
        cheek: r.range(0.035, 0.06),
        // fictional anthropometrics (mm) shown as measurement labels
        iod: r.range(58, 68),
        nasal: r.range(47, 56),
        ml: r.range(46, 55),
        ngn: r.range(112, 127),
        bzy: r.range(128, 142),
      };
    }

    // Facial relief, pushed toward the viewer on the front of the skull only.
    function relief(P, x, y) {
      const ax = Math.abs(x);
      let d = 0;
      d += 0.07 * gau(ax - 0.2, 0.26, y - P.brow, 0.055); // brow ridge
      d -= 0.15 * gau(ax - P.eyeX, 0.13, y - P.eyeY, 0.085); // sockets
      d += 0.055 * gau(ax - P.eyeX, 0.07, y - P.eyeY, 0.045); // globes
      const n0 = P.eyeY + 0.06; // nasion
      const n1 = n0 - P.noseLen; // tip
      const t = U.clamp((n0 - y) / (n0 - n1), 0, 1.1);
      let nh;
      if (y > n0) nh = 0.025 * Math.exp(-((y - n0) * (y - n0)) / 0.0025);
      else if (y >= n1) nh = 0.025 + (P.noseH - 0.025) * Math.pow(t, 1.7);
      else nh = P.noseH * Math.exp(-((y - n1) * (y - n1)) / 0.003);
      const nw = 0.045 + 0.075 * t;
      d += nh * Math.exp(-(x * x) / (nw * nw)); // bridge + tip
      d += 0.05 * gau(ax - 0.09, 0.045, y - (n1 - 0.02), 0.04); // alae
      d += P.cheek * gau(ax - 0.42, 0.13, y - (P.eyeY - 0.16), 0.1); // zygomatic
      d += 0.05 * gau(x, 0.3, y - (P.mouthY + 0.02), 0.2); // muzzle
      d += P.lip * gau(x, P.mouthW, y - (P.mouthY + 0.035), 0.033); // upper lip
      d += P.lip * 0.9 * gau(x, P.mouthW * 0.85, y - (P.mouthY - 0.045), 0.035); // lower lip
      d -= 0.03 * gau(x, P.mouthW * 1.05, y - P.mouthY, 0.012); // stomion
      d -= 0.022 * gau(x, 0.16, y - (P.mouthY - 0.13), 0.035); // labiomental fold
      d += P.chin * gau(x, 0.17, y + 0.83, 0.09); // chin
      d -= 0.04 * gau(ax - 0.62, 0.1, y - 0.32, 0.15); // temples
      return d;
    }

    // Skull silhouette: cranium dome above the brow, near-vertical cheeks, then a jaw taper.
    function widthAt(P, y) {
      if (y > 0.18) {
        const t = (y - 0.18) / 0.82;
        return P.a * Math.pow(Math.max(0, 1 - t * t), 0.55);
      }
      if (y > -0.3) return P.a * (1 - 0.07 * ((0.18 - y) / 0.48));
      const t = U.clamp((-0.3 - y) / 0.67, 0, 1);
      return P.a * (0.93 - (0.93 - P.chinW) * Math.pow(t, 1.5));
    }
    function depthAt(P, y) {
      if (y > 0.18) {
        const t = (y - 0.18) / 0.82;
        return P.c * Math.pow(Math.max(0, 1 - t * t), 0.5);
      }
      if (y > -0.3) return P.c;
      const t = U.clamp((-0.3 - y) / 0.67, 0, 1);
      return P.c * (1 - 0.3 * Math.pow(t, 1.8));
    }

    function surf(P, y, th) {
      const wx = widthAt(P, y);
      const dz = depthAt(P, y);
      const ct = Math.cos(th);
      let x = wx * Math.sin(th);
      let z = dz * Math.sign(ct) * Math.pow(Math.abs(ct), 0.7);
      const front = smooth(0.2, 0.78, ct);
      if (front > 0) z += relief(P, x, y) * front * 1.25;
      const ear = 0.09 * gau(Math.abs(th) - Math.PI / 2, 0.13, y - 0.03, 0.16);
      x *= 1 + ear;
      return [x, y * 1.06, z];
    }

    // Point on the front of the face at lateral fx / height fy (model units).
    function frontPoint(P, fx, fy) {
      return surf(P, fy, Math.asin(U.clamp(fx / widthAt(P, fy), -1, 1)));
    }

    const TH_MAX = Math.PI * 0.64;
    let P = headParams(ctx.state.target.faceSeed || HD.seed);
    let mesh = null;
    let meshLod = 0;

    function buildMesh(lod) {
      const rings = lod === 2 ? 32 : lod === 1 ? 26 : 21;
      const segs = lod === 2 ? 34 : lod === 1 ? 28 : 22;
      const cols = segs + 1;
      const nv = rings * cols;
      const pos = new Float32Array(nv * 3);
      for (let i = 0; i < rings; i++) {
        const y = 0.97 - (1.94 * i) / (rings - 1);
        for (let j = 0; j <= segs; j++) {
          const u = (j / segs) * 2 - 1;
          const th = TH_MAX * Math.sign(u) * Math.pow(Math.abs(u), 1.3); // denser meridians up front
          pos.set(surf(P, y, th), (i * cols + j) * 3);
        }
      }
      // per-vertex normals from grid neighbours, oriented outward
      const nrm = new Float32Array(nv * 3);
      for (let i = 0; i < rings; i++) {
        for (let j = 0; j <= segs; j++) {
          const o = (i * cols + j) * 3;
          const a = (i * cols + Math.max(0, j - 1)) * 3;
          const b = (i * cols + Math.min(segs, j + 1)) * 3;
          const c = (Math.max(0, i - 1) * cols + j) * 3;
          const d = (Math.min(rings - 1, i + 1) * cols + j) * 3;
          const ux = pos[b] - pos[a];
          const uy = pos[b + 1] - pos[a + 1];
          const uz = pos[b + 2] - pos[a + 2];
          const vx = pos[d] - pos[c];
          const vy = pos[d + 1] - pos[c + 1];
          const vz = pos[d + 2] - pos[c + 2];
          let nx = uy * vz - uz * vy;
          let ny = uz * vx - ux * vz;
          let nz = ux * vy - uy * vx;
          if (nx * pos[o] + nz * pos[o + 2] < 0) {
            nx = -nx;
            ny = -ny;
            nz = -nz;
          }
          const l = Math.hypot(nx, ny, nz) || 1;
          nrm[o] = nx / l;
          nrm[o + 1] = ny / l;
          nrm[o + 2] = nz / l;
        }
      }
      const e = [];
      const id = (i, j) => i * cols + j;
      for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) e.push(id(i, j), id(i, j + 1), 0);
      for (let i = 0; i < rings - 1; i++) for (let j = 0; j <= segs; j++) e.push(id(i, j), id(i + 1, j), 1);
      for (let i = 0; i < rings - 1; i++) {
        for (let j = 0; j < segs; j++) {
          if ((i + j) & 1) e.push(id(i, j), id(i + 1, j + 1), 2);
          else e.push(id(i, j + 1), id(i + 1, j), 2);
        }
      }
      const ne = e.length / 3;
      const ea = new Uint16Array(ne);
      const eb = new Uint16Array(ne);
      const et = new Uint8Array(ne);
      for (let k = 0; k < ne; k++) {
        ea[k] = e[k * 3];
        eb[k] = e[k * 3 + 1];
        et[k] = e[k * 3 + 2];
      }
      // landmarks in model space
      const n0 = P.eyeY + 0.06;
      const tip = n0 - P.noseLen;
      const L = {
        pupL: frontPoint(P, -P.eyeX, P.eyeY),
        pupR: frontPoint(P, P.eyeX, P.eyeY),
        nas: frontPoint(P, 0, n0),
        tip: frontPoint(P, 0, tip),
        sn: frontPoint(P, 0, tip - 0.07),
        chL: frontPoint(P, -P.mouthW * 1.05, P.mouthY),
        chR: frontPoint(P, P.mouthW * 1.05, P.mouthY),
        gn: frontPoint(P, 0, -0.9),
        zyL: frontPoint(P, -0.5, P.eyeY - 0.14),
        zyR: frontPoint(P, 0.5, P.eyeY - 0.14),
      };
      // facial feature contours (drawn over the mesh so the face reads at small sizes)
      const curves = [];
      const curve = (fn, n, closed, w) => {
        const pts = [];
        for (let k = 0; k <= n; k++) {
          const [cx, cy] = fn(k / n);
          const q = frontPoint(P, cx, cy);
          q[2] += 0.012;
          pts.push(q);
        }
        curves.push({ pts, closed, w, proj: new Float32Array(pts.length * 3) });
      };
      for (const sd of [-1, 1]) {
        const ex = sd * P.eyeX;
        const ey = P.eyeY;
        const ew = 0.105;
        const tilt = 0.012;
        curve((t) => [ex + sd * ew * Math.cos(Math.PI * (1 - t)), ey + 0.042 * Math.sin(Math.PI * t) + tilt * (sd * Math.cos(Math.PI * (1 - t)))], 10, false, 1);
        curve((t) => [ex + sd * ew * Math.cos(Math.PI * (1 - t)), ey - 0.03 * Math.sin(Math.PI * t) + tilt * (sd * Math.cos(Math.PI * (1 - t)))], 10, false, 0.7);
        curve((t) => [ex + 0.024 * Math.cos(t * TAU), ey + 0.005 + 0.024 * Math.sin(t * TAU)], 10, true, 0.9);
        curve((t) => [sd * (0.12 + 0.3 * t), P.brow - 0.01 + 0.045 * Math.sin(Math.PI * Math.min(1, t * 1.25)) - 0.03 * t], 10, false, 0.75);
      }
      const n0p = P.eyeY + 0.06;
      const tp = n0p - P.noseLen;
      for (const sd of [-1, 1]) {
        curve((t) => [sd * (0.045 + 0.025 * t), n0p - 0.04 - (n0p - 0.04 - (tp + 0.04)) * t], 6, false, 0.45);
        curve((t) => {
          const a = Math.PI * (0.5 + 1.1 * t);
          return [sd * (0.085 - 0.045 * Math.cos(a)), tp - 0.035 + 0.04 * Math.sin(a) * 0.9];
        }, 8, false, 0.9);
      }
      curve((t) => [-0.04 + 0.08 * t, tp - 0.075 - 0.006 * Math.sin(Math.PI * t)], 4, false, 0.6);
      const my = P.mouthY;
      const mw = P.mouthW * 1.05;
      curve((t) => {
        const x = -mw + 2 * mw * t;
        const ax = Math.abs(x) / mw;
        const bow = 0.04 * Math.pow(1 - ax, 0.7) - 0.01 * Math.exp(-(x * x) / 0.0006);
        return [x, my + bow];
      }, 14, false, 1);
      curve((t) => [-mw + 2 * mw * t, my - 0.004 * Math.sin(Math.PI * t)], 10, false, 0.8);
      curve((t) => [-mw * 0.85 + 1.7 * mw * t, my - 0.058 * Math.pow(Math.sin(Math.PI * t), 0.9)], 12, false, 0.7);
      curve((t) => [-0.12 + 0.24 * t, -0.83 - 0.035 * Math.sin(Math.PI * t)], 8, false, 0.4);
      mesh = {
        curves,
        rings, cols, nv, ne, pos, nrm, ea, eb, et,
        proj: new Float32Array(nv * 3),
        shade: new Float32Array(nv),
        bucket: new Uint8Array(ne),
        order: new Uint16Array(ne),
        L,
        LK: Object.keys(L),
        lp: {},
      };
      for (const k of mesh.LK) mesh.lp[k] = [0, 0, 0];
    }

    /* ------------------------------------------------------------ sprites */

    function sprite(w, h, draw) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      draw(c.getContext('2d'), w, h);
      return c;
    }
    const glowHolo = sprite(32, 32, (s, w) => {
      const gr = s.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      gr.addColorStop(0, ctx.rgba('holo', 0.9));
      gr.addColorStop(0.3, ctx.rgba('holo', 0.25));
      gr.addColorStop(1, ctx.rgba('holo', 0));
      s.fillStyle = gr;
      s.fillRect(0, 0, w, w);
    });
    const glowThreat = sprite(32, 32, (s, w) => {
      const gr = s.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      gr.addColorStop(0, ctx.rgba('threat', 0.95));
      gr.addColorStop(0.3, ctx.rgba('threat', 0.3));
      gr.addColorStop(1, ctx.rgba('threat', 0));
      s.fillStyle = gr;
      s.fillRect(0, 0, w, w);
    });
    const bandSprite = sprite(4, 64, (s, w, h) => {
      const gr = s.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, ctx.rgba('holo', 0));
      gr.addColorStop(1, ctx.rgba('holo', 0.22));
      s.fillStyle = gr;
      s.fillRect(0, 0, w, h);
    });
    const haloSprite = sprite(128, 128, (s, w) => {
      const gr = s.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      gr.addColorStop(0, ctx.rgba('holo', 0.1));
      gr.addColorStop(0.6, ctx.rgba('holo', 0.04));
      gr.addColorStop(1, ctx.rgba('holo', 0));
      s.fillStyle = gr;
      s.fillRect(0, 0, w, w);
    });

    // Tiny procedural ID-photo silhouettes for the carousel. The last cell is WRAITH, hooded.
    const TW = 40;
    const THH = 48;
    const NTHUMB = 12;
    const thumbs = sprite(TW * 2 * NTHUMB, THH * 2, (s) => {
      const r = HD.rng(HD.seed ^ 0x7b1d);
      s.scale(2, 2);
      for (let i = 0; i < NTHUMB; i++) {
        const x = i * TW;
        const hood = i === NTHUMB - 1;
        const tint = hood ? 'threat' : 'holo';
        s.save();
        s.beginPath();
        s.rect(x, 0, TW, THH);
        s.clip();
        const bg = s.createLinearGradient(0, 0, 0, THH);
        bg.addColorStop(0, hood ? '#1a0509' : '#062130');
        bg.addColorStop(1, '#02070b');
        s.fillStyle = bg;
        s.fillRect(x, 0, TW, THH);
        const cx = x + TW / 2 + r.range(-2, 2);
        const hy = THH * r.range(0.4, 0.45);
        const hr = TW * r.range(0.17, 0.21);
        const vr = hr * r.range(1.2, 1.36);
        const body = s.createLinearGradient(0, THH * 0.6, 0, THH);
        body.addColorStop(0, ctx.rgba(tint, 0.42));
        body.addColorStop(1, ctx.rgba(tint, 0.12));
        s.fillStyle = body;
        s.strokeStyle = ctx.rgba(tint, 0.85);
        s.lineWidth = 0.8;
        const sw = r.range(0.34, 0.44) * TW;
        s.beginPath();
        s.moveTo(cx - sw - 6, THH + 1);
        s.bezierCurveTo(cx - sw - 4, THH * 0.8, cx - sw * 0.6, THH * 0.72, cx - hr * 0.55, hy + vr * 0.92);
        s.lineTo(cx + hr * 0.55, hy + vr * 0.92);
        s.bezierCurveTo(cx + sw * 0.6, THH * 0.72, cx + sw + 4, THH * 0.8, cx + sw + 6, THH + 1);
        s.closePath();
        s.fill();
        s.stroke();
        if (hood) {
          s.beginPath();
          s.moveTo(cx - hr * 1.5, hy + vr * 1.25);
          s.bezierCurveTo(cx - hr * 1.7, hy - vr * 0.6, cx - hr * 0.9, hy - vr * 1.45, cx, hy - vr * 1.45);
          s.bezierCurveTo(cx + hr * 0.9, hy - vr * 1.45, cx + hr * 1.7, hy - vr * 0.6, cx + hr * 1.5, hy + vr * 1.25);
          s.closePath();
          s.fillStyle = ctx.rgba('threat', 0.3);
          s.fill();
          s.stroke();
          s.beginPath();
          s.ellipse(cx, hy + 1, hr * 0.8, vr * 0.82, 0, 0, TAU);
          s.fillStyle = '#050001';
          s.fill();
          s.fillStyle = C.threat;
          s.fillRect(cx - 3.5, hy - 0.5, 1.6, 1);
          s.fillRect(cx + 2, hy - 0.5, 1.6, 1);
        } else {
          s.beginPath();
          s.ellipse(cx, hy, hr, vr, 0, 0, TAU);
          const head = s.createLinearGradient(cx - hr, 0, cx + hr, 0);
          head.addColorStop(0, ctx.rgba(tint, 0.18));
          head.addColorStop(1, ctx.rgba(tint, 0.45));
          s.fillStyle = head;
          s.fill();
          s.stroke();
          const hair = r.int(0, 3);
          s.fillStyle = ctx.rgba(tint, 0.55);
          if (hair === 1) {
            s.beginPath();
            s.ellipse(cx, hy - vr * 0.45, hr * 1.05, vr * 0.6, 0, Math.PI, TAU);
            s.fill();
          } else if (hair === 2) {
            s.beginPath();
            s.moveTo(cx - hr * 1.1, hy + vr * 0.9);
            s.quadraticCurveTo(cx - hr * 1.4, hy - vr * 1.3, cx, hy - vr * 1.15);
            s.quadraticCurveTo(cx + hr * 1.4, hy - vr * 1.3, cx + hr * 1.1, hy + vr * 0.9);
            s.lineTo(cx + hr * 0.8, hy - vr * 0.3);
            s.lineTo(cx - hr * 0.8, hy - vr * 0.3);
            s.closePath();
            s.fill();
          } else if (hair === 3) {
            s.fillRect(cx - 1.5, hy - vr - 3, 3, vr * 0.8);
          }
          if (r.chance(0.35)) {
            s.fillStyle = ctx.rgba('ice', 0.7);
            s.fillRect(cx - hr * 0.75, hy - vr * 0.08, hr * 0.62, 1.2);
            s.fillRect(cx + hr * 0.13, hy - vr * 0.08, hr * 0.62, 1.2);
          }
        }
        s.fillStyle = 'rgba(0,0,0,0.35)';
        for (let yy = 0; yy < THH; yy += 2) s.fillRect(x, yy, TW, 0.7);
        s.restore();
      }
    });

    /* ------------------------------------------------------------ layout */

    let W = 0;
    let H = 0;
    let wide = false;
    let F = null; // face rect
    let RD = null; // readouts rect (or null)
    let CR = null; // carousel rect
    let S = 60; // model→px scale
    let fx0 = 0;
    let fy0 = 0;
    let small = false;
    let stat = null; // static layer
    let k = 1; // UI scale of the readouts + carousel on big panels
    let kf = 1; // text/marker scale inside the face viewport
    let strip = false; // wide + short: face | readouts | carousel side by side

    function layout(w, h) {
      W = w;
      H = h;
      wide = w > h * 1.1;
      k = U.clamp(Math.min(w / 420, h / 330), 1, 1.8);
      strip = false;
      if (wide) {
        let fw = Math.round(Math.min(w * 0.47, h * 0.66));
        const rest = w - fw - 9;
        if (rest >= 470 && h < 300) {
          // strip: the readouts get their own column (with trend lines), the carousel the rest
          strip = true;
          const rdW = Math.round(U.clamp(rest * 0.3, 170, 280 * k));
          F = { x: 0, y: 0, w: fw, h };
          RD = { x: fw + 6, y: 3, w: rdW, h: h - 6 };
          const cx = RD.x + rdW + 12;
          CR = { x: cx, y: 3, w: w - cx - 2, h: h - 5 };
        } else {
          // the side column is capped, the face viewport takes whatever width is left
          const colW = Math.round(Math.min(rest, 340 * k));
          fw = w - 9 - colW;
          F = { x: 0, y: 0, w: fw, h };
          const cx = fw + 6;
          const rh = Math.round(64 * k);
          RD = { x: cx, y: 3, w: colW, h: rh };
          CR = { x: cx, y: rh + 8, w: colW, h: h - rh - 10 };
        }
      } else {
        const showRead = h >= 230 && w >= 120;
        const fh = Math.round(Math.min(h * (showRead ? 0.58 : 0.6), w * 1.3));
        F = { x: 0, y: 0, w, h: fh };
        const rh = showRead ? Math.round((w >= 180 ? 32 : 29) * k) : 0;
        RD = showRead ? { x: 3, y: fh + 3, w: w - 6, h: rh } : null;
        const cy = fh + 3 + (rh ? rh + 3 : 0);
        CR = { x: 3, y: cy, w: w - 6, h: h - cy - 2 };
      }
      small = F.w < 120;
      kf = U.clamp(Math.min(F.w, F.h) / 300, 1, 1.7);
      S = Math.min(F.h * 0.36, F.w * 0.5);
      fx0 = F.x + F.w / 2;
      fy0 = F.y + F.h * 0.49 + 1;
      const lod = F.h >= 300 ? 2 : F.h >= 185 ? 1 : 0;
      if (!mesh || lod !== meshLod) {
        meshLod = lod;
        buildMesh(lod);
      }
      renderStatic();
    }

    function bracket(s, x, y, w, h, len, col) {
      s.strokeStyle = col;
      s.beginPath();
      s.moveTo(x, y + len);
      s.lineTo(x, y);
      s.lineTo(x + len, y);
      s.moveTo(x + w - len, y);
      s.lineTo(x + w, y);
      s.lineTo(x + w, y + len);
      s.moveTo(x + w, y + h - len);
      s.lineTo(x + w, y + h);
      s.lineTo(x + w - len, y + h);
      s.moveTo(x + len, y + h);
      s.lineTo(x, y + h);
      s.lineTo(x, y + h - len);
      s.stroke();
    }

    function renderStatic() {
      const dpr = cv.dpr;
      if (!stat) stat = document.createElement('canvas');
      stat.width = Math.max(1, Math.round(W * dpr));
      stat.height = Math.max(1, Math.round(H * dpr));
      const s = stat.getContext('2d');
      s.setTransform(dpr, 0, 0, dpr, 0, 0);
      s.clearRect(0, 0, W, H);
      const fx = F.x + 3.5;
      const fy = F.y + 3.5;
      const fw = F.w - 7;
      const fh = F.h - 7;
      // viewport ground + dot grid
      s.fillStyle = 'rgba(2,8,14,0.55)';
      s.fillRect(fx, fy, fw, fh);
      s.fillStyle = ctx.rgba('holo', 0.13);
      const step = Math.round((small ? 8 : 10) * Math.min(kf, 1.5));
      for (let y = fy + step; y < fy + fh - 2; y += step) {
        for (let x = fx + step; x < fx + fw - 2; x += step) s.fillRect(Math.round(x), Math.round(y), 1, 1);
      }
      s.drawImage(haloSprite, fx0 - S * 1.3, fy0 - S * 1.35, S * 2.6, S * 2.7);
      // symmetry axis
      s.strokeStyle = ctx.rgba('holo', 0.12);
      s.setLineDash([2, 3]);
      s.beginPath();
      s.moveTo(Math.round(fx0) + 0.5, fy + 12);
      s.lineTo(Math.round(fx0) + 0.5, fy + fh - 12);
      s.stroke();
      s.setLineDash([]);
      // frame + corner brackets
      s.lineWidth = 1;
      s.strokeStyle = ctx.rgba('holo', 0.16);
      s.strokeRect(fx, fy, fw, fh);
      bracket(s, fx, fy, fw, fh, (small ? 6 : 9) * kf, ctx.rgba('holo', 0.75));
      // vertical rulers
      s.strokeStyle = ctx.rgba('holo', 0.35);
      s.beginPath();
      const rulerX = [fx + 1, fx + fw - 1];
      for (const rx of rulerX) {
        const dir = rx < fx0 ? 1 : -1;
        for (let y = fy + 14, i = 0; y < fy + fh - 12; y += 5, i++) {
          const len = i % 5 === 0 ? 5 : 2;
          s.moveTo(rx, Math.round(y) + 0.5);
          s.lineTo(rx + dir * len, Math.round(y) + 0.5);
        }
      }
      s.stroke();
      // separators with tick marks
      const sep = (x, y, w) => {
        s.strokeStyle = ctx.rgba('holo', 0.22);
        s.beginPath();
        s.moveTo(x, Math.round(y) + 0.5);
        s.lineTo(x + w, Math.round(y) + 0.5);
        s.stroke();
        s.fillStyle = ctx.rgba('holo', 0.7);
        s.fillRect(x, Math.round(y) - 1, 6, 3);
        s.fillRect(x + w - 2, Math.round(y) - 1, 2, 3);
      };
      if (RD) sep(RD.x, RD.y - 2, RD.w);
      sep(CR.x, CR.y - 2, CR.w);
      if (wide) {
        s.strokeStyle = ctx.rgba('holo', 0.14);
        s.beginPath();
        s.moveTo(F.x + F.w + 2.5, 4);
        s.lineTo(F.x + F.w + 2.5, H - 4);
        if (strip) {
          s.moveTo(Math.round(CR.x - 6) + 0.5, 4);
          s.lineTo(Math.round(CR.x - 6) + 0.5, H - 4);
        }
        s.stroke();
      }
    }

    /* ------------------------------------------------------------ story state */

    const CLS = ['CIV', 'EMP', 'VIS', 'TRN', 'MED', 'SEC', 'RES', 'GOV'];
    const LET = 'ABCDEFGHJKLMNPRSTUVWXYZ';
    function mkCand() {
      return {
        id: `FR-${U.pad(R.int(0, 9999), 4)}-${LET[R.int(0, 22)]}${LET[R.int(0, 22)]}`,
        cls: `${R.pick(CLS)}·${U.randHex(3, R)}`,
        pct: Math.min(78, Math.abs(R.gauss()) * 70 + R.range(3, 12)),
        thumb: R.int(0, NTHUMB - 2),
        wraith: false,
      };
    }
    const WRAITH = { id: 'NS-7731-Ω', cls: 'OMEGA·BLK', pct: 94.1, thumb: NTHUMB - 1, wraith: true };

    let st = 'build';
    let stT0 = 0;
    let cycleT0 = 0;
    let started = false;
    let cand = mkCand();
    let flipAt = 0;
    let flipT = 0;
    let flipIv = 70;
    const rejects = []; // capped queue: big panels show a multi-column reject log
    const REJ_MAX = 120;
    let rejVer = 0; // bumps on every new reject (the log layer redraws from it)
    // the registry sweep is already under way when the panel comes up: big layouts show a full log
    for (let i = 0; i < 40; i++) rejects.push(mkCand());
    let scanned = R.int(1200000, 1900000);
    let conf = 94.1;
    let xref = '';
    let lockT = 0;
    let lastAlert = -1e9;
    let glitchUntil = 0;
    let lastMeta = '';
    let speed = 1;
    const marks = []; // landmark reveal schedule
    const readout = { live: 97.8, depth: 41.6, ir: 36.6, t: 0 };
    // normalised readout history for the trend lines in strip layouts (ring buffers)
    const RH = 64;
    const rhist = [new Float32Array(RH), new Float32Array(RH), new Float32Array(RH)];
    let rhHead = 0;
    const normRead = (i) => U.clamp(i === 0 ? (readout.live - 90) / 10 : i === 1 ? (readout.depth - 36) / 10 : (readout.ir - 35.5) / 2, 0, 1);
    for (let i = 0; i < 3; i++) rhist[i].fill(normRead(i));

    const SCAN_S = 11.5;
    const CONV_S = 3.4;
    const HOLD_S = 7;
    const REL_S = 0.9;
    const BUILD_S = 1.1;
    const XREF_S = 2.8;

    function meta(t) {
      if (t !== lastMeta) ctx.meta((lastMeta = t));
    }

    function schedMarks(now) {
      marks.length = 0;
      const base = now + (RM ? 800 : 1300);
      const seq = ['iod', 'nas', 'nasal', 'ml', 'ngn', 'bzy'];
      seq.forEach((k, i) => marks.push({ k, t0: base + i * (RM ? 1300 : 1050) }));
    }

    function begin(now) {
      st = 'build';
      stT0 = now;
      cycleT0 = now;
      xref = '';
      conf = 94.1;
      cand = mkCand();
      flipAt = now + 200;
      schedMarks(now);
      meta('SCANNING');
    }

    function flip(now) {
      if (!cand.wraith) {
        rejects.push(cand);
        if (rejects.length > REJ_MAX) rejects.shift();
        rejVer++;
      }
      cand = mkCand();
      flipT = now;
      scanned += R.int(900, 5200);
    }

    function lock(now) {
      st = 'hold';
      stT0 = now;
      lockT = now;
      cand = Object.assign({}, WRAITH, { pct: conf });
      flipT = now;
      const pct = conf.toFixed(1);
      meta(`MATCH ${Math.round(conf)}%`);
      if (!RM) ctx.flash('alert', 1500);
      ctx.audio.beep(1320, 90, 'square', 0.035);
      setTimeout(() => ctx.audio.beep(880, 160, 'square', 0.03), 110);
      ctx.emit('face:match', { codename: 'WRAITH', confidence: Math.round(conf * 10) / 1000 });
      if (now - lastAlert > 8000) {
        lastAlert = now;
        ctx.alert('crit', xref ? `BIOMETRIC X-REF WRAITH ${pct}% · ${xref} CORROBORATED` : `BIOMETRIC MATCH WRAITH ${pct}%`);
      }
      for (const m of marks) m.t0 = Math.min(m.t0, now); // every landmark visible on lock
    }

    let lastXref = -1e9;
    function crossRef(src) {
      const now = performance.now();
      if (now - lastXref < 5000) return;
      lastXref = now;
      xref = src;
      if (st === 'build' || st === 'scan') {
        st = 'converge';
        stT0 = now;
        conf = 94.1;
        meta(`X-REF ${src.split(' ')[0]}`);
      } else if (st === 'hold' || st === 'release') {
        st = 'xref';
        stT0 = now;
        conf = 94.1 + R.range(2.2, 4.4);
        cand = mkCand();
        meta(`X-REF ${src.split(' ')[0]}`);
      }
    }

    ctx.on('enhance:result', (d) => crossRef(`PLATE ${(d && d.plate) || ctx.state.target.plate}`));
    ctx.on('voice:match', () => crossRef('VOICEPRINT'));
    ctx.on('mission:reset', () => begin(performance.now()));
    ctx.on('intrusion', () => {
      glitchUntil = performance.now() + (RM ? 500 : 1200);
    });
    ctx.on('mission:phase', ({ phase }) => {
      speed = phase === 'critical' || phase === 'final' ? 1.5 : 1;
    });
    ctx.on('fonts:ready', () => {
      renderStatic();
      rejSig = ''; // text layer: redraw with the webfont
    });

    function update(now) {
      const t = (now - stT0) / 1000;
      if (st === 'build' && t > BUILD_S) {
        st = 'scan';
        stT0 = now;
      } else if (st === 'scan' && t > SCAN_S / speed) {
        st = 'converge';
        stT0 = now;
        meta('CONVERGING');
      } else if (st === 'converge' && t > CONV_S) {
        lock(now);
      } else if (st === 'xref' && t > XREF_S) {
        lock(now);
      } else if (st === 'hold' && t > HOLD_S) {
        st = 'release';
        stT0 = now;
      } else if (st === 'release' && t > REL_S) {
        begin(now);
      }
      // carousel flipping
      if (st === 'build' || st === 'scan' || st === 'converge' || st === 'xref') {
        if (now >= flipAt) {
          flip(now);
          let iv = RM ? 320 : 70;
          if (st === 'converge' || st === 'xref') {
            const p = U.clamp((now - stT0) / 1000 / (st === 'xref' ? XREF_S : CONV_S), 0, 1);
            iv = U.lerp(RM ? 320 : 75, RM ? 700 : 560, p * p);
            cand.pct = U.lerp(35, 88, p) + R.range(-8, 6);
            if (p > 0.55 && R.chance(0.4)) cand.partial = true;
          }
          flipIv = iv;
          flipAt = now + iv;
        }
      }
      // biometric readouts jitter ~6x/s
      if (now - readout.t > 160) {
        readout.t = now;
        const locked = st === 'hold';
        readout.live = U.clamp(readout.live + R.range(-0.4, 0.4), locked ? 98.5 : 94, 99.8);
        readout.depth = U.clamp(readout.depth + R.range(-0.5, 0.5), 38, 45);
        readout.ir = U.clamp(readout.ir + R.range(-0.08, 0.08), 36.1, 37.2);
        for (let i = 0; i < 3; i++) rhist[i][rhHead] = normRead(i);
        rhHead = (rhHead + 1) % RH;
      }
    }

    /* ------------------------------------------------------------ drawing */

    function project(yaw, pitch) {
      const m = mesh;
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      const cp = Math.cos(pitch);
      const sp = Math.sin(pitch);
      const D = 5;
      const pos = m.pos;
      const nrm = m.nrm;
      const pr = m.proj;
      const sh = m.shade;
      for (let i = 0, v = 0, n = m.nv * 3; i < n; i += 3, v++) {
        const x = pos[i];
        const y = pos[i + 1];
        const z = pos[i + 2];
        const x1 = x * cy + z * sy;
        const z1 = -x * sy + z * cy;
        const y2 = y * cp - z1 * sp;
        const z2 = y * sp + z1 * cp;
        const f = (D / (D - z2)) * S;
        pr[i] = fx0 + x1 * f;
        pr[i + 1] = fy0 - y2 * f;
        pr[i + 2] = z2;
        // hologram shading: fresnel rim + key light from upper left, faded with depth
        const nx = nrm[i] * cy + nrm[i + 2] * sy;
        const nz1 = -nrm[i] * sy + nrm[i + 2] * cy;
        const ny = nrm[i + 1] * cp - nz1 * sp;
        const nz = nrm[i + 1] * sp + nz1 * cp;
        let s;
        if (nz < -0.05) s = 0.07;
        else {
          const rim = 1 - nz;
          const lam = Math.max(0, nx * LX + ny * LY + nz * LZ);
          s = 0.1 + 0.5 * lam * lam + 0.85 * rim * rim * rim;
        }
        const df = U.clamp((z2 + 0.75) / 1.5, 0.15, 1);
        sh[v] = Math.min(1, s * df);
      }
      for (const cu of m.curves) {
        const pts = cu.pts;
        let zs = 0;
        for (let k = 0; k < pts.length; k++) {
          const p = pts[k];
          const x1 = p[0] * cy + p[2] * sy;
          const z1 = -p[0] * sy + p[2] * cy;
          const y2 = p[1] * cp - z1 * sp;
          const z2 = p[1] * sp + z1 * cp;
          const f = (D / (D - z2)) * S;
          cu.proj[k * 3] = fx0 + x1 * f;
          cu.proj[k * 3 + 1] = fy0 - y2 * f;
          zs += z2;
        }
        cu.z = zs / pts.length;
      }
      for (const k of m.LK) {
        const p = m.L[k];
        const x1 = p[0] * cy + p[2] * sy;
        const z1 = -p[0] * sy + p[2] * cy;
        const y2 = p[1] * cp - z1 * sp;
        const z2 = p[1] * sp + z1 * cp;
        const f = (D / (D - z2)) * S;
        const o = m.lp[k];
        o[0] = fx0 + x1 * f;
        o[1] = fy0 - y2 * f;
        o[2] = z2;
      }
    }

    const LX = -0.45;
    const LY = 0.55;
    const LZ = 0.7;
    const NB = 8; // normal alpha buckets
    const NH = 3; // scan-highlight buckets
    const counts = new Uint16Array(NB + NH + 1);
    const TYPE_W = [1, 0.7, 0.32];

    function drawMesh(now, scanY, reveal, locked, dx) {
      const m = mesh;
      const pr = m.proj;
      const band = (small ? 7 : 10) * kf;
      counts.fill(0);
      const top = F.y + 4;
      const bot = F.y + F.h - 4;
      for (let k = 0; k < m.ne; k++) {
        const a = m.ea[k] * 3;
        const b = m.eb[k] * 3;
        const ya = pr[a + 1];
        const yb = pr[b + 1];
        let bk = NB + NH; // hidden
        if (m.pos[a + 1] <= reveal && m.pos[b + 1] <= reveal && ya > top && yb > top && ya < bot && yb < bot) {
          const shd = (m.shade[a / 3] + m.shade[b / 3]) * 0.5;
          const al = TYPE_W[m.et[k]] * shd;
          const dy = Math.abs((ya + yb) * 0.5 - scanY);
          if (dy < band && shd > 0.12) bk = NB + Math.min(NH - 1, ((1 - dy / band) * NH) | 0);
          else bk = Math.min(NB - 1, (al * NB) | 0);
          if (bk === 0) bk = NB + NH;
        }
        m.bucket[k] = bk;
        counts[bk]++;
      }
      // counting sort: contiguous edge ranges per bucket → one stroke per bucket
      let acc = 0;
      const start = new Uint16Array(NB + NH + 1);
      for (let i = 0; i <= NB + NH; i++) {
        start[i] = acc;
        acc += counts[i];
      }
      const fill = start.slice();
      for (let k = 0; k < m.ne; k++) m.order[fill[m.bucket[k]]++] = k;

      const baseCol = locked ? 'holo2' : 'holo';
      const lw = small ? 0.7 : 0.85 * Math.min(kf, 1.3);
      g.lineWidth = lw;
      for (let bk = 1; bk < NB + NH; bk++) {
        const n = counts[bk];
        if (!n) continue;
        const hl = bk >= NB;
        g.strokeStyle = hl ? ctx.rgba('ice', 0.4 + 0.2 * (bk - NB)) : ctx.rgba(baseCol, 0.06 + (bk / NB) * 0.7);
        g.beginPath();
        for (let i = start[bk], e = start[bk] + n; i < e; i++) {
          const k = m.order[i];
          const a = m.ea[k] * 3;
          const b = m.eb[k] * 3;
          g.moveTo(pr[a] + dx, pr[a + 1]);
          g.lineTo(pr[b] + dx, pr[b + 1]);
        }
        g.stroke();
        if (hl && bk === NB + NH - 1) {
          g.strokeStyle = ctx.rgba('holo', 0.16);
          g.lineWidth = 3 * Math.min(kf, 1.4);
          g.stroke();
          g.lineWidth = lw;
        }
      }
      // point cloud: front vertices only, two brightness buckets + scan-lit
      const ds = small ? 1.1 : 1.4 * Math.min(kf, 1.5);
      for (let pass = 0; pass < 3; pass++) {
        g.beginPath();
        for (let i = 0; i < m.nv; i++) {
          const o = i * 3;
          if (m.pos[o + 1] > reveal) continue;
          const shd = m.shade[i];
          if (shd < 0.2) continue;
          const y = pr[o + 1];
          if (y < top || y > bot) continue;
          const lit = Math.abs(y - scanY) < band * 0.6;
          const p = lit ? 2 : shd > 0.55 ? 1 : 0;
          if (p !== pass) continue;
          const sz = lit ? ds + 0.6 * kf : ds;
          g.rect(pr[o] + dx - sz / 2, y - sz / 2, sz, sz);
        }
        g.fillStyle = pass === 2 ? C.ice : ctx.rgba('holo', pass === 1 ? 0.85 : 0.4);
        g.fill();
      }
      // feature contours
      g.lineWidth = small ? 0.9 : 1.1 * Math.min(kf, 1.4);
      for (const cu of m.curves) {
        const a = U.clamp((cu.z - 0.25) / 0.45, 0, 1) * cu.w;
        if (a < 0.05) continue;
        const pts = cu.pts;
        if (pts[0][1] > reveal) continue;
        const pj = cu.proj;
        g.strokeStyle = ctx.rgba(locked ? 'holo' : 'ice', Math.round(a * 0.9 * 20) / 20);
        g.beginPath();
        g.moveTo(pj[0] + dx, pj[1]);
        for (let k = 1; k < pts.length; k++) g.lineTo(pj[k * 3] + dx, pj[k * 3 + 1]);
        if (cu.closed) g.closePath();
        g.stroke();
      }
      g.lineWidth = 1;
    }

    // Landmark label boxes of the current frame, so the scan readout can dodge them.
    const boxes = [];
    let recBoxes = false;
    const hitsBox = (x, y, w, h) => boxes.some((b) => x < b[0] + b[2] && x + w > b[0] && y < b[1] + b[3] && y + h > b[1]);

    function tag(x, y, text, col, px = 9, align = 'left') {
      const w = monoW(text, px);
      const bx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
      if (recBoxes) boxes.push([bx - 2, y - px / 2 - 2, w + 4, px + 3]);
      g.fillStyle = 'rgba(2,6,11,0.78)';
      g.fillRect(bx - 2, y - px / 2 - 2, w + 4, px + 3);
      g.fillStyle = col;
      g.textAlign = 'left';
      g.fillText(text, bx, y + 0.5);
      return bx;
    }

    function markP(now, k) {
      const m = marks.find((q) => q.k === k);
      if (!m || now < m.t0) return 0;
      return U.clamp((now - m.t0) / 280, 0, 1);
    }

    function jitterVal(now, k, v) {
      const m = marks.find((q) => q.k === k);
      const age = m ? now - m.t0 : 1e9;
      if (age < 700 && !RM) return (v + R.range(-9, 9)).toFixed(1);
      return v.toFixed(1);
    }

    function drawPoint(p, pp, col, glow) {
      const x = p[0];
      const y = p[1];
      if (pp < 1 && !RM) {
        const rr = (2 + (1 - pp) * 9) * kf;
        g.strokeStyle = ctx.rgba(col, 0.8 * (1 - pp));
        g.beginPath();
        g.arc(x, y, rr, 0, TAU);
        g.stroke();
      }
      g.drawImage(glow, x - 6 * kf, y - 6 * kf, 12 * kf, 12 * kf);
      g.strokeStyle = C[col] || col;
      const q = Math.round(2.5 * kf - 0.5) + 0.5;
      g.strokeRect(Math.round(x) - q, Math.round(y) - q, q * 2, q * 2);
      g.fillStyle = C.ice;
      g.fillRect(Math.round(x) - 0.5, Math.round(y) - 0.5, 1, 1);
    }

    function dimLine(x1, y1, x2, y2, col) {
      g.strokeStyle = col;
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
      const dx = x2 - x1;
      const dy = y2 - y1;
      const l = Math.hypot(dx, dy) || 1;
      const nx = (-dy / l) * 3 * kf;
      const ny = (dx / l) * 3 * kf;
      g.moveTo(x1 - nx, y1 - ny);
      g.lineTo(x1 + nx, y1 + ny);
      g.moveTo(x2 - nx, y2 - ny);
      g.lineTo(x2 + nx, y2 + ny);
      g.stroke();
    }

    function drawLandmarks(now, locked) {
      boxes.length = 0;
      recBoxes = true;
      const L = mesh.lp;
      const col = locked ? 'threat' : 'holo';
      const glow = locked ? glowThreat : glowHolo;
      const lineCol = locked ? ctx.rgba('threat', 0.75) : ctx.rgba('ice', 0.6);
      const txtCol = locked ? '#ff8a98' : C.ice;
      const fz = Math.round(9 * kf);
      g.lineWidth = 1;
      g.font = MONO(fz);
      g.textBaseline = 'middle';
      const fl = F.x + 5;
      const fr = F.x + F.w - 5;
      let nasY = -99;
      // IOD — pupils
      let p = markP(now, 'iod');
      if (p) {
        drawPoint(L.pupL, p, col, glow);
        drawPoint(L.pupR, p, col, glow);
        if (p >= 1) {
          const yy = Math.min(L.pupL[1], L.pupR[1]) - (small ? 8 : 11) * kf;
          dimLine(L.pupL[0], yy, L.pupR[0], yy, lineCol);
          g.strokeStyle = ctx.rgba(col, 0.3);
          g.beginPath();
          g.moveTo(L.pupL[0], L.pupL[1] - 3);
          g.lineTo(L.pupL[0], yy);
          g.moveTo(L.pupR[0], L.pupR[1] - 3);
          g.lineTo(L.pupR[0], yy);
          g.stroke();
          const txt = small ? jitterVal(now, 'iod', P.iod) : `IOD ${jitterVal(now, 'iod', P.iod)}`;
          const cx = U.clamp((L.pupL[0] + L.pupR[0]) / 2, fl + monoW(txt, fz) / 2 + 2, fr - monoW(txt, fz) / 2 - 2);
          // big viewports put the nasion marker right where the value sits: lift the value over it
          let ty = yy - 7 * kf;
          const nasOn = markP(now, 'nas') > 0;
          if (nasOn && Math.abs(L.nas[1] - ty) < fz / 2 + 5 * kf) ty = L.nas[1] - 5 * kf - fz / 2 - 3;
          // tiny viewports: the value yields to the HUD corner line instead of covering it
          if (ty - fz / 2 - 2 >= F.y + 17 * kf) tag(cx, ty, txt, txtCol, fz, 'center');
        }
      }
      // nasion
      p = markP(now, 'nas');
      if (p) drawPoint(L.nas, p, col, glow);
      // nasal height: nasion → subnasale, label out to the side
      p = markP(now, 'nasal');
      if (p) {
        drawPoint(L.tip, p, col, glow);
        if (p >= 1) {
          const off = (small ? 7 : 10) * kf;
          const side = 1;
          const x = Math.max(L.nas[0], L.tip[0], L.sn[0]) + off;
          const xl = Math.min(L.nas[0], L.tip[0], L.sn[0]) - off;
          const lx = side > 0 ? x : xl;
          dimLine(lx, L.nas[1], lx, L.sn[1], lineCol);
          if (!small) {
            const txt = `NAS ${jitterVal(now, 'nasal', P.nasal)}`;
            const ty = L.sn[1] - 3 * kf;
            nasY = ty;
            if (side > 0) tag(Math.min(lx + 4 * kf, fr - monoW(txt, fz)), ty, txt, txtCol, fz, 'left');
            else tag(Math.max(lx - 4 * kf, fl + monoW(txt, fz)), ty, txt, txtCol, fz, 'right');
          }
        }
      }
      // mouth width
      p = markP(now, 'ml');
      if (p) {
        drawPoint(L.chL, p, col, glow);
        drawPoint(L.chR, p, col, glow);
        if (p >= 1 && !small) {
          const yy = Math.max(L.chL[1], L.chR[1]) + 7 * kf;
          dimLine(L.chL[0], yy, L.chR[0], yy, lineCol);
          const txt = `ML ${jitterVal(now, 'ml', P.ml)}`;
          const cx = U.clamp((L.chL[0] + L.chR[0]) / 2, fl + monoW(txt, fz) / 2 + 2, fr - monoW(txt, fz) / 2 - 2);
          tag(cx, yy + 7 * kf, txt, txtCol, fz, 'center');
        }
      }
      // face height N–GN along the left rail (rotated label)
      p = markP(now, 'ngn');
      if (p) {
        drawPoint(L.gn, p, col, glow);
        if (p >= 1) {
          const x = F.x + (small ? 9 : 12) * kf;
          g.strokeStyle = ctx.rgba(col, 0.25);
          g.setLineDash([1, 2]);
          g.beginPath();
          g.moveTo(x, L.nas[1]);
          g.lineTo(L.nas[0] - 6, L.nas[1]);
          g.moveTo(x, L.gn[1]);
          g.lineTo(L.gn[0] - 6, L.gn[1]);
          g.stroke();
          g.setLineDash([]);
          dimLine(x, L.nas[1], x, L.gn[1], lineCol);
          if (!small) {
            const txt = `N-GN ${jitterVal(now, 'ngn', P.ngn)}`;
            g.save();
            g.translate(x + 7 * kf, (L.nas[1] + L.gn[1]) / 2);
            g.rotate(-Math.PI / 2);
            recBoxes = false; // rotated: its box is not in panel space
            tag(0, 0, txt, txtCol, fz, 'center');
            recBoxes = true;
            g.restore();
          }
        }
      }
      // bizygomatic — only when there is room
      p = markP(now, 'bzy');
      if (p && F.w >= 160) {
        drawPoint(L.zyL, p, col, glow);
        drawPoint(L.zyR, p, col, glow);
        if (p >= 1) {
          g.strokeStyle = ctx.rgba(col, 0.35);
          g.setLineDash([2, 2]);
          g.beginPath();
          g.moveTo(L.zyL[0], L.zyL[1]);
          g.lineTo(L.zyR[0], L.zyR[1]);
          g.stroke();
          g.setLineDash([]);
          const txt = `BZY ${jitterVal(now, 'bzy', P.bzy)}`;
          let by = L.zyR[1] + 9 * kf;
          if (Math.abs(by - nasY) < 13 * kf) by = nasY + 13 * kf;
          tag(fr - 3, by, txt, txtCol, fz, 'right');
        }
      }
      recBoxes = false;
    }

    function drawScan(now, scanY, dir, locked) {
      const x0 = F.x + 4;
      const w = F.w - 8;
      const bh = (small ? 22 : 34) * kf;
      g.globalAlpha = locked ? 0.4 : 1;
      if (dir > 0) g.drawImage(bandSprite, x0, scanY - bh, w, bh);
      else {
        g.save();
        g.translate(0, scanY + bh);
        g.scale(1, -1);
        g.drawImage(bandSprite, x0, 0, w, bh);
        g.restore();
      }
      g.globalAlpha = 1;
      const col = locked ? C.threat : C.holo;
      g.fillStyle = col;
      g.globalAlpha = locked ? 0.5 : 0.9;
      g.fillRect(x0, Math.round(scanY), w, 1);
      g.globalAlpha = 1;
      const cw = Math.round(3 * Math.min(kf, 1.5));
      const chh = Math.round(5 * Math.min(kf, 1.5));
      g.fillRect(x0 - 1, Math.round(scanY) - (chh >> 1), cw, chh);
      g.fillRect(x0 + w - cw + 1, Math.round(scanY) - (chh >> 1), cw, chh);
    }

    // The height readout rides the scan line, but yields to the HUD corner text, the landmark
    // labels and the ID lock. Drawn after the landmarks so it can test their boxes.
    function drawScanLabel(scanY, dir, locked) {
      if (small || locked) return;
      const fz = Math.round(9 * kf);
      const ly = scanY + (dir > 0 ? 7 : -7) * kf;
      if (ly < F.y + 19 * kf || ly > F.y + F.h - 18 * kf) return;
      const v = U.clamp((fy0 - scanY) / S, -1.2, 1.2);
      const txt = `Y${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`;
      const tw = monoW(txt, fz);
      const rx = F.x + F.w - 9 * kf;
      if (hitsBox(rx - tw - 2, ly - fz * 0.72, tw + 4, fz * 1.34)) return;
      g.font = MONO(fz);
      g.textBaseline = 'middle';
      tag(rx, ly, txt, ctx.rgba('holo', 0.9), fz, 'right');
    }

    function drawFaceHud(now, yawDeg, pitchDeg, locked) {
      const fz = Math.round(9 * kf);
      g.font = MONO(fz);
      g.textBaseline = 'middle';
      g.textAlign = 'left';
      const x0 = F.x + 8 * kf;
      const x1 = F.x + F.w - 8 * kf;
      const y0 = F.y + 11 * kf;
      const y1 = F.y + F.h - 10 * kf;
      const yaw = `${yawDeg >= 0 ? '+' : '−'}${Math.abs(yawDeg).toFixed(small ? 0 : 1)}°`;
      // status line (bottom-right; top-left on small viewports)
      let s;
      if (st === 'hold') s = 'ID LOCK';
      else if (st === 'xref') s = 'X-REF';
      else if (st === 'converge') s = 'CONVERGE';
      else if (st === 'build') s = 'MESHING';
      else s = `SCAN ${Math.min(99, Math.floor(((now - stT0) / 1000 / (SCAN_S / speed)) * 100))}%`;
      g.fillStyle = ctx.rgba('holo', 0.8);
      if (small) {
        // yaw yields when the status would run into it (very narrow viewports)
        if (monoW(s, fz) + monoW(yaw, fz) + 6 <= x1 - x0) {
          g.textAlign = 'right';
          g.fillText(yaw, x1, y0);
        }
      } else {
        g.fillText(`MESH ${mesh.nv}V`, x0, y0);
        g.textAlign = 'right';
        g.fillText(`YAW ${yaw}`, x1, y0);
        g.fillStyle = ctx.rgba('text', 0.6);
        g.textAlign = 'left';
        g.fillText(`P${pitchDeg >= 0 ? '+' : '−'}${Math.abs(pitchDeg).toFixed(1)}°`, x0, y1);
      }
      const blink = st === 'hold' ? (RM ? true : ((now / 260) | 0) % 2 === 0) : true;
      g.fillStyle = locked ? C.threat : C.holo;
      if (small) {
        g.textAlign = 'left';
        if (blink) g.fillText(s, x0, y0);
      } else {
        g.textAlign = 'right';
        if (blink) g.fillText(s, x1, y1);
      }
      g.textAlign = 'left';
      if (locked) {
        // subject lock brackets around the head
        const hw = S * 0.92;
        const hh = Math.min(S * 1.16, fy0 - F.y - 17 * kf);
        const pulse = RM ? 0 : Math.sin(now / 160) * 1.5 * kf;
        g.lineWidth = 1.2 * Math.min(kf, 1.5);
        bracket(g, fx0 - hw - pulse, fy0 - hh - pulse, (hw + pulse) * 2, (hh + pulse) * 2, (small ? 6 : 10) * kf, C.threat);
        g.lineWidth = 1;
        if (!small) {
          g.font = UI(fz);
          setLS(`${(1.5 * kf).toFixed(1)}px`);
          const txt = 'SUBJECT · WRAITH';
          const tw = g.measureText(txt).width;
          const tx = U.clamp(fx0 - tw / 2, F.x + 6, F.x + F.w - 6 - tw);
          const ty = Math.max(F.y + 23 * kf, fy0 - hh - 7 * kf);
          g.fillStyle = 'rgba(40,0,8,0.8)';
          g.fillRect(tx - 3 * kf, ty - fz * 0.67, tw + 6 * kf, fz * 1.34);
          g.fillStyle = '#ff6b7e';
          g.fillText(txt, tx, ty + 0.5);
          setLS('0px');
        }
      }
    }

    function drawReadouts(now) {
      if (!RD) return;
      const items = [
        ['LIVE', `${readout.live.toFixed(1)}%`, (readout.live - 90) / 10, 'LIVENESS'],
        ['DEPTH', `${readout.depth.toFixed(1)}`, (readout.depth - 36) / 10, 'DEPTH MM'],
        ['IR', `${readout.ir.toFixed(1)}°`, (readout.ir - 35.5) / 2, 'IR °C'],
      ];
      const fz = Math.round(9 * k);
      const fv = Math.round(11 * k);
      g.textBaseline = 'middle';
      if (wide) {
        const rh = RD.h / 3;
        items.forEach((it, i) => {
          const y = RD.y + i * rh;
          const col = i === 0 ? 'phosphor' : 'holo';
          g.font = UI(fz);
          setLS(`${(1.4 * k).toFixed(1)}px`);
          g.fillStyle = C.dim;
          g.textAlign = 'left';
          g.fillText(it[3], RD.x, y + 6 * k);
          setLS('0px');
          g.font = MONO(fv);
          g.fillStyle = C.ice;
          g.textAlign = 'right';
          g.fillText(it[1], RD.x + RD.w, y + 6 * k);
          barTicks(RD.x, y + 14 * k, RD.w, Math.round(3 * k), it[2], col);
          // strip layouts have room under each gauge for its trend line
          const ty = y + 21 * k;
          const th = rh - 21 * k - 7;
          if (strip && th >= 14) trend(RD.x, ty, RD.w, th, rhist[i], col);
        });
        g.textAlign = 'left';
        return;
      }
      const cw = RD.w / 3;
      items.forEach((it, i) => {
        const x = RD.x + i * cw;
        g.font = UI(fz);
        setLS(`${k.toFixed(1)}px`);
        g.fillStyle = C.dim;
        g.textAlign = 'left';
        g.fillText(it[0], x + 1, RD.y + 5 * k);
        setLS('0px');
        g.font = MONO(Math.round((RD.w >= 180 ? 11 : 10) * k));
        g.fillStyle = C.ice;
        g.fillText(it[1], x + 1, RD.y + 16 * k);
        barTicks(x + 1, RD.y + RD.h - 5 * k, cw - 6, Math.round(2 * k), it[2], i === 0 ? 'phosphor' : 'holo');
      });
    }

    // readout trend: newest sample on the right, faint grid
    function trend(x, y, w, h, buf, col) {
      g.strokeStyle = ctx.rgba('holo', 0.08);
      g.beginPath();
      for (let q = 0; q <= 2; q++) {
        const yy = Math.round(y + (h * q) / 2) + 0.5;
        g.moveTo(x, yy);
        g.lineTo(x + w, yy);
      }
      g.stroke();
      const n = RH;
      const step = w / (n - 1);
      g.beginPath();
      for (let j = 0; j < n; j++) {
        const v = buf[(rhHead + j) % n];
        const px = x + j * step;
        const py = y + h - v * h;
        if (j) g.lineTo(px, py);
        else g.moveTo(px, py);
      }
      g.strokeStyle = ctx.rgba(col, 0.75);
      g.stroke();
      const last = buf[(rhHead + n - 1) % n];
      g.fillStyle = C.ice;
      g.fillRect(x + w - 1.5, y + h - last * h - 1.5, 3, 3);
    }

    function barTicks(x, y, w, h, v, col) {
      const n = Math.max(6, Math.floor(w / (4 * k)));
      const on = Math.round(U.clamp(v, 0, 1) * n);
      const cw = w / n;
      g.fillStyle = ctx.rgba(col, 0.9);
      for (let i = 0; i < on; i++) g.fillRect(Math.round(x + i * cw), y, Math.max(1, cw - 1), h);
      g.fillStyle = ctx.rgba('holo', 0.14);
      for (let i = on; i < n; i++) g.fillRect(Math.round(x + i * cw), y, Math.max(1, cw - 1), h);
    }

    function fmtCount(n) {
      if (CR.w < 120) return `${(n / 1e6).toFixed(2)}M`;
      return n.toLocaleString('en-US');
    }

    function drawCarousel(now) {
      const r = CR;
      const x0 = r.x;
      const w = r.w;
      const fz = Math.round(9 * k);
      const f11 = Math.round(11 * k);
      let y = r.y + 1;
      const locked = st === 'hold' || (st === 'release' && cand.wraith);
      // header
      g.textBaseline = 'middle';
      g.font = UI(fz);
      setLS(`${(1.2 * k).toFixed(1)}px`);
      g.textAlign = 'left';
      let head;
      if (st === 'xref' || (xref && (st === 'converge' || locked))) head = w < 120 ? 'X-REF' : `X-REF·${xref.split(' ')[0]}`;
      else head = w < 120 ? 'DB·CIV' : 'DB · CIVREG';
      g.fillStyle = xref ? C.amber : C.dim;
      g.fillText(head, x0, y + 5 * k);
      setLS('0px');
      g.font = MONO(fz);
      g.textAlign = 'right';
      g.fillStyle = C.holo2;
      g.fillText(fmtCount(scanned), x0 + w, y + 5 * k);
      g.textAlign = 'left';
      y += 12 * k;
      // query progress bar
      let prog;
      if (st === 'scan') prog = ((now - stT0) / 1000 / (SCAN_S / speed)) * 0.8;
      else if (st === 'converge' || st === 'xref') prog = 0.8 + ((now - stT0) / 1000 / (st === 'xref' ? XREF_S : CONV_S)) * 0.2;
      else if (st === 'build') prog = 0;
      else prog = 1;
      prog = U.clamp(prog, 0, 1);
      const pbh = Math.round(2 * Math.min(k, 1.5));
      g.fillStyle = ctx.rgba('holo', 0.12);
      g.fillRect(x0, y, w, pbh);
      g.fillStyle = locked ? C.threat : xref ? C.amber : C.holo;
      g.fillRect(x0, y, Math.round(w * prog), pbh);
      if (!locked && !RM) {
        const sx = x0 + ((now / 7) % w);
        g.fillStyle = ctx.rgba('ice', 0.7);
        g.fillRect(sx, y, 4 * k, pbh);
      }
      y += 5 * k;
      // card, with the reject log under it, or beside it in columns when the carousel is wide
      const lineH = Math.round(12 * k);
      const side = w >= 440 * k;
      const cardW = side ? Math.round(Math.min(w * 0.4, 250 * k)) : w;
      let nRej = 0;
      let ch;
      if (side) ch = Math.round(U.clamp(r.y + r.h - y - 4, 26, 60 * k));
      else {
        nRej = r.h >= 110 * k ? Math.floor((r.h - 80 * k) / lineH) : r.h >= 80 * k ? Math.floor((r.h - 66 * k) / lineH) : 0;
        ch = Math.round(U.clamp(r.h - 18 * k - Math.max(0, nRej) * lineH - 4, 26, (wide ? 60 : 56) * k));
      }
      const th = Math.round(Math.min(ch, cardW * 0.36));
      const tw = Math.round(th * (TW / THH));
      const cardY = y;
      g.save();
      g.beginPath();
      g.rect(x0, cardY, cardW, ch);
      g.clip();
      // slot-machine roll: small nudge while flipping fast, a real roll once it slows down
      const fp = RM ? 1 : U.clamp((now - flipT) / Math.min(flipIv * 0.5, 110), 0, 1);
      const off = (1 - U.ease.outCubic(fp)) * (flipIv > 150 ? ch * 0.35 : 4);
      g.globalAlpha = 0.7 + 0.3 * fp;
      const yy = cardY + off;
      g.drawImage(thumbs, cand.thumb * TW * 2, 0, TW * 2, THH * 2, x0, yy, tw, th);
      g.strokeStyle = locked ? C.threat : ctx.rgba('holo', 0.5);
      g.strokeRect(x0 + 0.5, yy + 0.5, tw - 1, th - 1);
      const tx = x0 + tw + 5 * k;
      const colW = x0 + cardW - tx;
      // a squat card has no room for three text lines: keep the id and the score
      const two = ch < 34 * k;
      const lh = ch / (two ? 2 : 3);
      const lastL = two ? 1.5 : 2.5;
      const pct = cand.pct;
      const ptxt = `${pct.toFixed(1)}%`;
      if (cand.wraith) {
        // "WRAITH · 94.1%" on one line when it fits, the MATCH stamp gets the bottom line
        const one = !two && colW >= monoW(`WRAITH · ${ptxt}`, f11) + 2;
        g.font = MONO(fz);
        g.fillStyle = locked ? '#ff8a98' : C.dim;
        if (one) g.fillText(cand.id, tx, yy + lh * 0.5);
        g.font = MONO(f11, 700);
        g.fillStyle = C.ice;
        const ly = yy + lh * (one ? 1.5 : 0.5);
        g.fillText('WRAITH', tx, ly);
        g.fillStyle = C.threat;
        if (one) g.fillText(`· ${ptxt}`, tx + monoW('WRAITH ', f11), ly);
        else g.fillText(ptxt, tx, yy + lh * 1.5);
      } else {
        g.font = MONO(fz);
        g.fillStyle = C.dim;
        g.fillText(cand.id, tx, yy + lh * 0.5);
        if (!two) {
          g.font = MONO(Math.round((w < 120 ? 9 : 10) * k));
          g.fillStyle = cand.partial ? C.amber : C.text;
          g.fillText(cand.partial && w >= 120 ? 'PARTIAL' : cand.cls, tx, yy + lh * 1.5);
        }
        g.font = MONO(f11, 700);
        g.fillStyle = pct > 80 ? C.amber : pct > 55 ? C.text : C.dim;
        g.fillText(ptxt, tx, yy + lh * lastL);
        const bx = tx + monoW(ptxt, f11) + 5 * k;
        const bw = x0 + cardW - bx;
        if (bw > 14) {
          const bh = Math.round(3 * Math.min(k, 1.5));
          const by = Math.round(yy + lh * lastL) - (bh >> 1);
          g.fillStyle = ctx.rgba('holo', 0.14);
          g.fillRect(bx, by, bw, bh);
          g.fillStyle = pct > 80 ? C.amber : C.holo2;
          g.fillRect(bx, by, Math.round((bw * pct) / 100), bh);
        }
      }
      g.globalAlpha = 1;
      g.restore();
      // MATCH stamp, slammed onto the bottom line of the record
      if (locked) {
        const age = now - lockT;
        const p = RM ? 1 : U.clamp(age / 220, 0, 1);
        const sc = RM ? 1 : 1 + (1 - U.ease.outCubic(p)) * 1.2;
        const fade = st === 'release' ? U.clamp(1 - (now - stT0) / (REL_S * 1000), 0, 1) : 1;
        const fs = Math.round((colW >= 110 * k ? 12 : colW >= 80 * k ? 10 : 9) * k);
        g.font = DISP(fs);
        setLS(colW >= 80 * k ? `${(2 * k).toFixed(1)}px` : `${k.toFixed(1)}px`);
        const sw = g.measureText('MATCH').width + 10 * k;
        const sh = fs + 8 * k;
        const sx = Math.min(tx + colW / 2, x0 + cardW - sw / 2 - 1);
        const sy = cardY + lh * lastL;
        g.save();
        g.translate(sx, sy);
        g.rotate(colW < 80 * k ? -0.06 : -0.1);
        g.scale(sc, sc);
        g.globalAlpha = p * fade;
        g.fillStyle = 'rgba(40,0,8,0.72)';
        g.fillRect(-sw / 2, -sh / 2, sw, sh);
        g.strokeStyle = C.threat;
        g.lineWidth = 1.5 * Math.min(k, 1.5);
        g.strokeRect(-sw / 2, -sh / 2, sw, sh);
        g.lineWidth = 0.8 * Math.min(k, 1.5);
        const ins = 2.5 * k;
        g.strokeRect(-sw / 2 + ins, -sh / 2 + ins, sw - ins * 2, sh - ins * 2);
        g.fillStyle = C.threat;
        g.textAlign = 'center';
        g.fillText('MATCH', 1, 1);
        g.restore();
        setLS('0px');
        g.textAlign = 'left';
        g.lineWidth = 1;
      }
      // reject log
      let lx = x0;
      let ly0 = cardY + ch + 4;
      let rows = nRej;
      let ncol = 1;
      let colWd = w;
      const gapC = Math.round(16 * k);
      if (side) {
        lx = x0 + cardW + gapC;
        ly0 = cardY;
        const regW = x0 + w - lx;
        ncol = Math.max(1, Math.floor((regW + gapC) / (170 * k + gapC)));
        colWd = (regW - (ncol - 1) * gapC) / ncol;
        rows = Math.max(0, Math.floor((r.y + r.h - ly0) / lineH));
        g.strokeStyle = ctx.rgba('holo', 0.12);
        g.beginPath();
        g.moveTo(Math.round(lx - gapC / 2) + 0.5, cardY);
        g.lineTo(Math.round(lx - gapC / 2) + 0.5, r.y + r.h - 2);
        g.stroke();
      }
      const total = rows > 0 ? Math.min(rejects.length, rows * ncol) : 0;
      if (!total) return;
      // The log is text-heavy on big layouts (100+ rows), so it lives in its own layer that is
      // redrawn only when it changed, at most ~8x/s; every frame just blits it.
      const lw = Math.ceil(side ? x0 + w - lx : w);
      const lhh = Math.ceil(rows * lineH);
      const sig = `${lw}|${lhh}|${rows}|${ncol}|${colWd}|${fz}|${cv.dpr}`;
      if (sig !== rejSig || (rejVer !== rejDrawnVer && now - rejAt > 120)) {
        rejSig = sig;
        rejDrawnVer = rejVer;
        rejAt = now;
        drawRejects(lw, lhh, total, rows, colWd, gapC, lineH, fz);
      }
      g.drawImage(rejCv, 0, 0, rejCv.width, rejCv.height, lx, ly0, lw, lhh);
    }

    let rejCv = null;
    let rejSig = '';
    let rejAt = -1e9;
    let rejDrawnVer = -1;
    function drawRejects(lw, lhh, total, rows, colWd, gapC, lineH, fz) {
      const dpr = cv.dpr;
      if (!rejCv) rejCv = document.createElement('canvas');
      rejCv.width = Math.max(1, Math.round(lw * dpr));
      rejCv.height = Math.max(1, Math.round(lhh * dpr));
      const c2 = rejCv.getContext('2d');
      c2.setTransform(dpr, 0, 0, dpr, 0, 0);
      c2.clearRect(0, 0, lw, lhh);
      c2.font = MONO(fz);
      c2.textBaseline = 'middle';
      // narrow columns drop the FR- registry prefix so the score never touches the id
      const short = colWd < monoW('FR-0000-XX 00.0%', fz) + 9 * k + 6;
      for (let i = 0; i < total; i++) {
        const c = rejects[rejects.length - 1 - i];
        const cx = Math.floor(i / rows) * (colWd + gapC);
        const ry = (i % rows) * lineH + 5 * k;
        c2.globalAlpha = 0.85 - i * (0.55 / Math.max(1, total));
        c2.textAlign = 'left';
        c2.fillStyle = C.threat;
        c2.fillText('×', cx, ry);
        c2.fillStyle = C.dim;
        c2.fillText(short ? c.id.slice(3) : c.id, cx + 9 * k, ry);
        c2.textAlign = 'right';
        c2.fillStyle = C.text;
        c2.fillText(`${c.pct.toFixed(1)}%`, cx + colWd, ry);
      }
    }

    /* ------------------------------------------------------------ frame */

    function tick(now) {
      if (!started) {
        started = true;
        begin(now);
      }
      update(now);
      const locked = st === 'hold';
      const t = now / 1000;
      // yaw settles toward frontal while the ID is locked
      const ampTarget = locked ? 6 : 25;
      yawAmp += (ampTarget - yawAmp) * 0.05;
      const per = RM ? 22 : 9;
      const yawDeg = Math.sin((t * TAU) / per) * yawAmp;
      const pitchDeg = Math.sin((t * TAU) / (per * 1.7) + 1) * (RM ? 2 : 5) - 2;
      project((yawDeg * Math.PI) / 180, (pitchDeg * Math.PI) / 180);

      const top = F.y + 8;
      const bot = F.y + F.h - 8;
      const sp = RM ? 7 : 3.2 / speed;
      const ph = (t % sp) / sp;
      const tri = ph < 0.5 ? ph * 2 : 2 - ph * 2;
      const dir = ph < 0.5 ? 1 : -1; // 1 = moving down
      const scanY = top + (bot - top) * tri;
      let reveal = 2;
      if (st === 'build') reveal = 1.1 - 2.4 * U.ease.inOutCubic(U.clamp((now - stT0) / 1000 / BUILD_S, 0, 1));

      cv.clear();
      g.drawImage(stat, 0, 0, W, H);

      const glitch = now < glitchUntil;
      const dx = glitch && !RM ? R.range(-4, 4) : 0;
      g.save();
      g.beginPath();
      g.rect(F.x + 4, F.y + 4, F.w - 8, F.h - 8);
      g.clip();
      drawMesh(now, locked ? -999 : scanY, reveal, locked, dx);
      if (glitch && !RM) {
        // chroma split: a magenta ghost of the mesh slice
        g.globalAlpha = 0.5;
        g.drawImage(cv.canvas, 0, 0, cv.canvas.width, cv.canvas.height, 3, R.range(-2, 2), W, H);
        g.globalAlpha = 1;
        g.fillStyle = ctx.rgba('neon', 0.18);
        const by = F.y + R.range(0, F.h - 16);
        g.fillRect(F.x, by, F.w, R.range(4, 16));
      }
      if (st === 'build') {
        const ry = fy0 - reveal * 1.06 * S;
        g.fillStyle = ctx.rgba('ice', 0.9);
        g.fillRect(F.x + 4, Math.round(ry), F.w - 8, 1);
      }
      drawScan(now, scanY, dir, locked);
      drawLandmarks(now, locked);
      drawScanLabel(scanY, dir, locked);
      g.restore();
      drawFaceHud(now, yawDeg, pitchDeg, locked);
      if (glitch) {
        const fz = Math.round(9 * kf);
        g.font = MONO(fz);
        g.textBaseline = 'middle';
        tag(fx0, F.y + F.h * 0.5, small ? 'CORRUPT' : 'SIGNAL CORRUPT', C.neon, fz, 'center');
      }
      drawReadouts(now);
      drawCarousel(now);
    }
    let yawAmp = 25;

    return {
      fps: 30,
      resize(w, h) {
        layout(w, h);
      },
      tick,
    };
  });
})();
