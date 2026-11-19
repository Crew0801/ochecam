/* OcheCam core: board geometry, scoring, homography, checkout, dart detection.
   Pure functions, usable in the browser (window.Core) and in Node (module.exports). */
(function (root) {
  'use strict';

  // Clockwise from the top.
  const SEG = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
  // Standard steel-tip board radii in mm (to the wire centre).
  const R = { bull: 6.35, obull: 15.9, tIn: 99, tOut: 107, dIn: 162, dOut: 170 };
  // Calibration targets: outer edge of the double ring, centre of 20, 6, 3, 11.
  const CAL_NUMS = [20, 6, 3, 11];
  const CAL_BOARD = [[0, -R.dOut], [R.dOut, 0], [0, R.dOut], [-R.dOut, 0]];

  function dart(n, m) {
    if (!n || !m) return { n: 0, m: 0, v: 0, label: 'Miss' };
    const v = n * m;
    let label;
    if (n === 25) label = m === 2 ? 'Bull' : '25';
    else label = (m === 3 ? 'T' : m === 2 ? 'D' : '') + n;
    return { n, m, v, label };
  }

  /** Score for a point in board millimetres (origin = bull, y pointing down). */
  function scoreAt(x, y) {
    const r = Math.hypot(x, y);
    if (r > R.dOut) return dart(0, 0);
    if (r <= R.bull) return dart(25, 2);
    if (r <= R.obull) return dart(25, 1);
    let a = Math.atan2(x, -y) * 180 / Math.PI; // 0 = top, clockwise
    a = (a + 360 + 9) % 360;
    const n = SEG[Math.floor(a / 18) % 20];
    let m = 1;
    if (r >= R.tIn && r <= R.tOut) m = 3;
    else if (r >= R.dIn) m = 2;
    return dart(n, m);
  }

  // ---------- Homography ----------
  function solve(A, b) {
    const n = b.length;
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      if (Math.abs(A[p][c]) < 1e-12) return null;
      [A[c], A[p]] = [A[p], A[c]];
      [b[c], b[p]] = [b[p], b[c]];
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = A[r][c] / A[c][c];
        if (!f) continue;
        for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
        b[r] -= f * b[c];
      }
    }
    return b.map((v, i) => v / A[i][i]);
  }

  /** 3x3 homography (as 9-array) mapping src[i] -> dst[i], 4 point pairs. */
  function homography(src, dst) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = src[i], [u, v] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    const h = solve(A, b);
    return h ? h.concat([1]) : null;
  }

  function applyH(h, x, y) {
    const w = h[6] * x + h[7] * y + h[8];
    return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
  }

  // ---------- Checkout ----------
  const THROWS = [];
  for (let n = 1; n <= 20; n++) for (let m = 1; m <= 3; m++) THROWS.push(dart(n, m));
  THROWS.push(dart(25, 1), dart(25, 2));

  const DOUBLE_ORDER = [20, 16, 8, 18, 12, 10, 4, 6, 14, 2, 19, 17, 15, 13, 11, 9, 7, 5, 3, 25, 1];
  function finishRank(d) {
    const i = DOUBLE_ORDER.indexOf(d.n);
    return (i < 0 ? 30 : i) + (d.m === 3 ? 5 : 0) + (d.m === 1 ? 2 : 0);
  }
  // Preferred set-up darts, best first.
  const SETUP = [];
  for (let n = 20; n >= 10; n--) SETUP.push(dart(n, 3));
  SETUP.push(dart(25, 1), dart(25, 2));
  for (let n = 20; n >= 1; n--) SETUP.push(dart(n, 1));
  for (let n = 9; n >= 1; n--) SETUP.push(dart(n, 3));
  for (let n = 20; n >= 1; n--) SETUP.push(dart(n, 2));

  function isFinish(d, out) {
    if (out === 'single') return d.v > 0;
    if (out === 'master') return d.m === 2 || d.m === 3;
    return d.m === 2;
  }

  /** Best checkout route for `rem` with `left` darts. Returns array of dart objects or null. */
  function checkout(rem, left, out) {
    out = out || 'double';
    if (rem <= 0 || rem > 180 || left < 1) return null;
    const finishes = THROWS.filter(d => isFinish(d, out));
    const byValue = new Map();
    for (const f of finishes) {
      const cur = byValue.get(f.v);
      if (!cur || finishRank(f) < finishRank(cur)) byValue.set(f.v, f);
    }
    for (let k = 1; k <= left; k++) {
      let best = null, bestCost = Infinity;
      const walk = (path, r, cost) => {
        if (path.length === k - 1) {
          const f = byValue.get(r);
          if (!f) return;
          const c = cost + finishRank(f) * 3;
          if (c < bestCost) { bestCost = c; best = path.concat([f]); }
          return;
        }
        for (let i = 0; i < SETUP.length; i++) {
          const s = SETUP[i];
          if (s.v >= r) continue;
          if (cost + i >= bestCost) break;
          walk(path.concat([s]), r - s.v, cost + i);
        }
      };
      walk([], rem, 0);
      if (best) return best;
    }
    return null;
  }

  // ---------- Detection ----------
  /** Per-pixel max channel difference between two RGBA buffers, inside mask. */
  function diffMask(a, b, mask, w, h, thr, out) {
    const n = w * h;
    const bin = out || new Uint8Array(n);
    let count = 0;
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      if (!mask[i]) { bin[i] = 0; continue; }
      const d = Math.max(Math.abs(a[j] - b[j]), Math.abs(a[j + 1] - b[j + 1]), Math.abs(a[j + 2] - b[j + 2]));
      if (d > thr) { bin[i] = 1; count++; } else bin[i] = 0;
    }
    return { bin, count };
  }

  /** Remove isolated noise: keep a pixel only if >= 2 of its 4 neighbours are set. */
  function denoise(bin, w, h) {
    const out = new Uint8Array(w * h);
    let count = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!bin[i]) continue;
        const nb = bin[i - 1] + bin[i + 1] + bin[i - w] + bin[i + w];
        if (nb >= 2) { out[i] = 1; count++; }
      }
    }
    return { bin: out, count };
  }

  function components(bin, w, h) {
    const lab = new Int32Array(w * h);
    const comps = [];
    const stack = new Int32Array(w * h);
    let next = 1;
    for (let i = 0; i < w * h; i++) {
      if (!bin[i] || lab[i]) continue;
      let sp = 0; stack[sp++] = i; lab[i] = next;
      const pts = [];
      let minx = w, miny = h, maxx = 0, maxy = 0;
      while (sp) {
        const p = stack[--sp];
        const x = p % w, y = (p / w) | 0;
        pts.push(p);
        if (x < minx) minx = x; if (x > maxx) maxx = x;
        if (y < miny) miny = y; if (y > maxy) maxy = y;
        const nbs = [p - 1, p + 1, p - w, p + w, p - w - 1, p - w + 1, p + w - 1, p + w + 1];
        for (const q of nbs) {
          if (q < 0 || q >= w * h) continue;
          const qx = q % w;
          if (Math.abs(qx - x) > 1) continue;
          if (bin[q] && !lab[q]) { lab[q] = next; stack[sp++] = q; }
        }
      }
      comps.push({ id: next++, pts, minx, miny, maxx, maxy });
    }
    return comps;
  }

  /**
   * Locate the newest dart in a binary change mask.
   * tipPref: 'auto' (thinner end), 'up', 'down' (image direction of the tip).
   * Returns {x, y} in pixel coords of the mask, plus diagnostics, or null.
   */
  function findDart(bin, w, h, opts) {
    opts = opts || {};
    const minArea = opts.minArea || 25;
    const comps = components(bin, w, h).sort((a, b) => b.pts.length - a.pts.length);
    if (!comps.length || comps[0].pts.length < minArea) return null;
    const main = comps[0];
    let pts = main.pts.slice();
    // Merge fragments near the main blob (thin shafts often break apart).
    const gap = Math.max(6, Math.round(w / 40));
    for (let k = 1; k < comps.length; k++) {
      const c = comps[k];
      if (c.pts.length < 4) continue;
      if (c.minx <= main.maxx + gap && c.maxx >= main.minx - gap && c.miny <= main.maxy + gap && c.maxy >= main.miny - gap) {
        pts = pts.concat(c.pts);
      }
    }
    const n = pts.length;
    let mx = 0, my = 0;
    for (const p of pts) { mx += p % w; my += (p / w) | 0; }
    mx /= n; my /= n;
    let sxx = 0, syy = 0, sxy = 0;
    for (const p of pts) {
      const dx = p % w - mx, dy = ((p / w) | 0) - my;
      sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
    }
    sxx /= n; syy /= n; sxy /= n;
    const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    let ux = Math.cos(theta), uy = Math.sin(theta);
    const tr = sxx + syy, det = sxx * syy - sxy * sxy;
    const l1 = tr / 2 + Math.sqrt(Math.max(0, tr * tr / 4 - det));
    const l2 = tr / 2 - Math.sqrt(Math.max(0, tr * tr / 4 - det));
    const elong = l2 > 0 ? Math.sqrt(l1 / l2) : 10;

    // Project onto axis.
    const proj = new Float32Array(n), perp = new Float32Array(n);
    let umin = Infinity, umax = -Infinity;
    for (let i = 0; i < n; i++) {
      const dx = pts[i] % w - mx, dy = ((pts[i] / w) | 0) - my;
      proj[i] = dx * ux + dy * uy;
      perp[i] = -dx * uy + dy * ux;
      if (proj[i] < umin) umin = proj[i];
      if (proj[i] > umax) umax = proj[i];
    }
    const len = umax - umin;

    // Width profile in bins along the axis.
    const B = 12;
    const bmin = new Float32Array(B).fill(Infinity), bmax = new Float32Array(B).fill(-Infinity);
    for (let i = 0; i < n; i++) {
      const b = Math.min(B - 1, Math.floor((proj[i] - umin) / (len + 1e-6) * B));
      if (perp[i] < bmin[b]) bmin[b] = perp[i];
      if (perp[i] > bmax[b]) bmax[b] = perp[i];
    }
    const width = b => (bmax[b] >= bmin[b] ? bmax[b] - bmin[b] + 1 : 0);
    let wLow = 0, wHigh = 0;
    for (let b = 0; b < 4; b++) { wLow += width(b); wHigh += width(B - 1 - b); }

    let tipAtHigh;
    const highY = uy; // image-y direction of the "high" end
    if (opts.tipPref === 'up') tipAtHigh = highY < 0;
    else if (opts.tipPref === 'down') tipAtHigh = highY > 0;
    else tipAtHigh = wHigh < wLow;

    // Average of the extreme 5% at the tip end.
    const cut = len * 0.05;
    let tx = 0, ty = 0, tc = 0;
    for (let i = 0; i < n; i++) {
      const inEnd = tipAtHigh ? proj[i] >= umax - cut : proj[i] <= umin + cut;
      if (inEnd) { tx += pts[i] % w; ty += (pts[i] / w) | 0; tc++; }
    }
    tx /= tc; ty /= tc;

    const ratio = Math.max(wLow, wHigh) / Math.max(1, Math.min(wLow, wHigh));
    let conf = Math.min(1, (elong - 1) / 3) * 0.6 + Math.min(1, (ratio - 1) / 1.5) * 0.4;
    if (opts.tipPref && opts.tipPref !== 'auto') conf = Math.min(1, (elong - 1) / 3);
    return {
      x: tx + 0.5, y: ty + 0.5, area: n, length: len, elong, conf,
      axis: { ux, uy, cx: mx, cy: my, umin, umax }, tipAtHigh
    };
  }

  const api = {
    SEG, R, CAL_NUMS, CAL_BOARD, dart, scoreAt, homography, applyH, checkout, isFinish,
    diffMask, denoise, components, findDart
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Core = api;
})(typeof self !== 'undefined' ? self : this);
