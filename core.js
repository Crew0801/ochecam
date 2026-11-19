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
  /** Average colour shift between two frames inside the mask (auto-exposure / light changes). */
  function meanOffset(a, b, mask, w, h) {
    const n = w * h;
    let s0 = 0, s1 = 0, s2 = 0, c = 0;
    for (let i = 0, j = 0; i < n; i += 3, j += 12) {
      if (!mask[i]) continue;
      s0 += a[j] - b[j]; s1 += a[j + 1] - b[j + 1]; s2 += a[j + 2] - b[j + 2]; c++;
    }
    return c ? [s0 / c, s1 / c, s2 / c] : [0, 0, 0];
  }

  /** Changed pixels between frames a and b. off = [r,g,b] global shift removed first. */
  function diffMask(a, b, mask, w, h, thr, out, off) {
    const n = w * h;
    const bin = out || new Uint8Array(n);
    const o0 = off ? off[0] : 0, o1 = off ? off[1] : 0, o2 = off ? off[2] : 0;
    let count = 0;
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      if (!mask[i]) { bin[i] = 0; continue; }
      const d = Math.max(Math.abs(a[j] - b[j] - o0), Math.abs(a[j + 1] - b[j + 1] - o1), Math.abs(a[j + 2] - b[j + 2] - o2));
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

  /** Group connected components that lie close together (a dart's shaft often breaks apart). */
  function clusters(bin, w, h) {
    const gap = Math.max(6, Math.round(w / 40));
    const comps = components(bin, w, h).filter(c => c.pts.length >= 4).sort((a, b) => b.pts.length - a.pts.length);
    const out = [];
    for (const c of comps) {
      const near = out.find(k => c.minx <= k.maxx + gap && c.maxx >= k.minx - gap && c.miny <= k.maxy + gap && c.maxy >= k.miny - gap);
      if (near) {
        near.pts = near.pts.concat(c.pts);
        near.minx = Math.min(near.minx, c.minx); near.maxx = Math.max(near.maxx, c.maxx);
        near.miny = Math.min(near.miny, c.miny); near.maxy = Math.max(near.maxy, c.maxy);
      } else out.push({ pts: c.pts.slice(), minx: c.minx, maxx: c.maxx, miny: c.miny, maxy: c.maxy });
    }
    return out.sort((a, b) => b.pts.length - a.pts.length);
  }

  /**
   * All new darts in a binary change mask, biggest first.
   * opts: minArea, minElong (shape filter against blobs of light/noise), max, tipPref.
   * Returns [{x, y, area, elong, conf, ...}] in mask pixel coords; rejected blobs in .rejected.
   */
  function findDarts(bin, w, h, opts) {
    opts = opts || {};
    const minArea = opts.minArea || 25, minElong = opts.minElong || 1.5, max = opts.max || 3;
    const found = [], rejected = [];
    for (const c of clusters(bin, w, h)) {
      if (c.pts.length < minArea) break;
      const r = analyzeDart(c.pts, w, opts);
      if (r.elong >= minElong && r.length >= 6) found.push(r); else rejected.push(r);
      if (found.length >= max) break;
    }
    found.rejected = rejected;
    return found;
  }

  /** Biggest dart only (kept for compatibility). */
  function findDart(bin, w, h, opts) {
    return findDarts(bin, w, h, Object.assign({ minElong: 1 }, opts, { max: 1 }))[0] || null;
  }

  /** Axis, tip end and confidence of one blob. tipPref: 'auto' (thinner end), 'up', 'down'. */
  function analyzeDart(pts, w, opts) {
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

  // ---------- Camera movement ----------
  /**
   * How far the picture moved from frame b to frame a (a(x) ≈ b(x - d)), searched within ±R pixels.
   * Returns {dx, dy, score, score0}: mean luma error at the best shift and at no shift.
   */
  function estimateShift(a, b, mask, w, h, R) {
    R = R || 10;
    const step = 3, idx = [];
    for (let y = R; y < h - R; y += step) for (let x = R; x < w - R; x += step) if (mask[y * w + x]) idx.push(y * w + x);
    const n = idx.length;
    if (n < 50) return { dx: 0, dy: 0, score: 0, score0: 0 };
    const lum = (px, i) => (px[i * 4] * 77 + px[i * 4 + 1] * 150 + px[i * 4 + 2] * 29) >> 8;
    const la = new Float32Array(n);
    let ma = 0;
    for (let k = 0; k < n; k++) { la[k] = lum(a, idx[k]); ma += la[k]; }
    ma /= n;
    const lb = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) lb[i] = lum(b, i);
    const cost = (dx, dy) => {
      const off = dy * w + dx;
      let mb = 0;
      for (let k = 0; k < n; k++) mb += lb[idx[k] - off];
      mb /= n;
      let s = 0;
      for (let k = 0; k < n; k++) s += Math.abs(la[k] - ma - lb[idx[k] - off] + mb);
      return s / n;
    };
    const score0 = cost(0, 0);
    let best = { dx: 0, dy: 0, score: score0 };
    for (let dy = -R; dy <= R; dy += 2) for (let dx = -R; dx <= R; dx += 2) {
      const c = cost(dx, dy);
      if (c < best.score) best = { dx, dy, score: c };
    }
    const c0 = best;
    for (let dy = c0.dy - 1; dy <= c0.dy + 1; dy++) for (let dx = c0.dx - 1; dx <= c0.dx + 1; dx++) {
      if (Math.abs(dx) > R || Math.abs(dy) > R) continue;
      const c = cost(dx, dy);
      if (c < best.score) best = { dx, dy, score: c };
    }
    best.score0 = score0;
    return best;
  }

  /** Copy of an RGBA image moved by (dx, dy) pixels; uncovered borders repeat the edge. */
  function shiftImage(px, w, h, dx, dy) {
    const out = new Uint8ClampedArray(px.length);
    for (let y = 0; y < h; y++) {
      const sy = Math.min(h - 1, Math.max(0, y - dy));
      for (let x = 0; x < w; x++) {
        const sx = Math.min(w - 1, Math.max(0, x - dx));
        const i = (y * w + x) * 4, j = (sy * w + sx) * 4;
        out[i] = px[j]; out[i + 1] = px[j + 1]; out[i + 2] = px[j + 2]; out[i + 3] = 255;
      }
    }
    return out;
  }

  // ---------- Automatic calibration ----------
  /** 0 = other, 1 = board red, 2 = board green (hue/chroma based, tolerant to lighting). */
  function boardColor(r, g, b) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn;
    if (c < 30 || c < 0.28 * mx) return 0;
    let hue;
    if (mx === r) hue = ((g - b) / c) * 60;
    else if (mx === g) hue = ((b - r) / c + 2) * 60;
    else hue = ((r - g) / c + 4) * 60;
    if (hue < 0) hue += 360;
    if (hue <= 28 || hue >= 330) return 1;
    if (hue >= 75 && hue <= 175) return 2;
    return 0;
  }

  /**
   * Find the four calibration points (outer double ring at 20, 6, 3, 11) in an RGBA image.
   * Assumes the board hangs roughly upright (20 at the top, within about ±40°).
   * Returns {points: [[x,y] x4] in pixels, segments, center} or {error}.
   */
  function autoCalibrate(px, w, h) {
    const cls = new Uint8Array(w * h);
    const xs = [], ys = [];
    for (let i = 0, j = 0; i < w * h; i++, j += 4) {
      const k = boardColor(px[j], px[j + 1], px[j + 2]);
      cls[i] = k;
      if (k) { xs.push(i % w); ys.push((i / w) | 0); }
    }
    if (xs.length < w * h * 0.005) return { error: 'Kein Dartboard im Bild gefunden' };
    const med = a => { const s = a.slice().sort((p, q) => p - q); return s[s.length >> 1]; };
    const at = (x, y) => {
      const xi = Math.round(x), yi = Math.round(y);
      return xi < 0 || yi < 0 || xi >= w || yi >= h ? -1 : cls[yi * w + xi];
    };
    const N = 360;

    // For each ray from the centre: the outer double ring is the outermost coloured band that has
    // a matching triple band at ~0.62 of its radius (rules out red walls, flags, etc.).
    function rays(cx, cy) {
      const out = new Array(N).fill(null);
      for (let k = 0; k < N; k++) {
        const t = k / N * Math.PI * 2, dx = Math.cos(t), dy = Math.sin(t);
        const rmax = Math.min(dx > 0 ? (w - 1 - cx) / dx : dx < 0 ? -cx / dx : 1e9, dy > 0 ? (h - 1 - cy) / dy : dy < 0 ? -cy / dy : 1e9);
        const iv = [];
        let a = -1, lastC = -10;
        for (let r = 0; r <= rmax; r += 0.5) {
          const c = at(cx + dx * r, cy + dy * r);
          if (c > 0) { if (a < 0 || r - lastC > 1.5) { if (a >= 0) iv.push([a, lastC]); a = r; } lastC = r; }
        }
        if (a >= 0) iv.push([a, lastC]);
        for (let j = iv.length - 1; j >= 0; j--) {
          const [da, db] = iv[j];
          // Real rings are a few percent of the radius thick; single noisy pixels are not.
          if (db < 12 || db - da > 0.18 * db || db - da < Math.max(1.5, 0.022 * db)) continue;
          const rm = (da + db) / 2, col = at(cx + dx * rm, cy + dy * rm);
          // Triple ring inside, same segment colour as the double on this ray.
          const tri = iv.find(([ta, tb]) => tb > 0.46 * db && tb < 0.8 * db && tb - ta < 0.18 * tb && tb - ta >= Math.max(1, 0.015 * tb)
            && at(cx + dx * (ta + tb) / 2, cy + dy * (ta + tb) / 2) === col);
          if (!tri) continue;
          out[k] = { r: db + 0.5, col };
          break;
        }
      }
      // Drop outliers against the local median radius.
      const rs = out.map(o => (o ? o.r : null));
      for (let k = 0; k < N; k++) {
        if (!out[k]) continue;
        const nb = [];
        for (let d = -6; d <= 6; d++) { const v = rs[(k + d + N) % N]; if (v) nb.push(v); }
        const m = med(nb);
        if (Math.abs(out[k].r - m) > 0.08 * m) out[k] = null;
      }
      return out;
    }

    // Expected board colour (0 none, 1 red, 2 green) at board polar coords (mm, degrees clockwise from top).
    const expect = (rr, th) => {
      if ((rr > R.tIn && rr < R.tOut) || (rr > R.dIn && rr < R.dOut)) {
        const idx = Math.floor((((th + 9) % 360) + 360) % 360 / 18);
        return idx % 2 === 0 ? 1 : 2;
      }
      return 0;
    };
    // Sample radii (mm): inside both coloured rings and just outside their edges.
    const RADII = [96, 101, 105, 110, 158, 165, 168, 175];
    const SAMPLES = [];
    for (let th = 1; th < 360; th += 2) for (const rr of RADII) {
      const t = th * Math.PI / 180;
      SAMPLES.push([rr * Math.sin(t), -rr * Math.cos(t), expect(rr, th)]);
    }
    /** How well the board model, placed by 4 image points, matches the colours in the image. */
    function modelScore(points) {
      const Hm = homography(CAL_BOARD, points);
      if (!Hm) return -1e9;
      let sc = 0;
      for (const [bx, by, e] of SAMPLES) {
        const [x, y] = applyH(Hm, bx, by);
        const c = at(x, y);
        if (c < 0) continue;
        sc += c === e ? 1 : (e && c ? -2 : -1);
      }
      return sc;
    }

    function solveFrom(cx, cy) {
      const ray = rays(cx, cy);
      const pts = [];
      ray.forEach((o, k) => { if (o) { const t = k / N * Math.PI * 2; pts.push([Math.cos(t) * o.r, Math.sin(t) * o.r]); } });
      if (pts.length < N * 0.12) return { error: 'Doppelring nicht klar erkennbar (Licht, Ausschnitt oder Zoom prüfen)' };
      // Least-squares ellipse a x² + b xy + c y² + d x + e y = 1 (coords relative to the ray centre).
      const A = [0, 0, 0, 0, 0].map(() => [0, 0, 0, 0, 0]), B = [0, 0, 0, 0, 0];
      for (const [x, y] of pts) {
        const v = [x * x, x * y, y * y, x, y];
        for (let i = 0; i < 5; i++) { B[i] += v[i]; for (let j = 0; j < 5; j++) A[i][j] += v[i] * v[j]; }
      }
      const q = solve(A, B);
      if (!q) return { error: 'Ellipse nicht bestimmbar' };
      const [ea, eb, ec, ed, ee] = q;
      const det = 4 * ea * ec - eb * eb;
      if (det <= 0) return { error: 'Doppelring nicht als Ellipse erkennbar' };
      const x0 = (-2 * ec * ed + eb * ee) / det, y0 = (eb * ed - 2 * ea * ee) / det;
      const f = ea * x0 * x0 + eb * x0 * y0 + ec * y0 * y0 + ed * x0 + ee * y0 - 1;
      if (f >= 0) return { error: 'Doppelring nicht als Ellipse erkennbar' };
      // Q = conic / -f is positive definite; M = Q^(-1/2) maps the unit circle onto the ellipse.
      const qa = ea / -f, qb = eb / 2 / -f, qc = ec / -f;
      const tr = qa + qc, dd = Math.sqrt(Math.max(0, (qa - qc) * (qa - qc) / 4 + qb * qb));
      const l1 = tr / 2 + dd, l2 = tr / 2 - dd;
      if (l2 <= 0) return { error: 'Doppelring nicht als Ellipse erkennbar' };
      const ang = 0.5 * Math.atan2(2 * qb, qa - qc), cs = Math.cos(ang), sn = Math.sin(ang);
      const s1 = 1 / Math.sqrt(l1), s2 = 1 / Math.sqrt(l2);
      const M = [cs * cs * s1 + sn * sn * s2, cs * sn * (s1 - s2), cs * sn * (s1 - s2), sn * sn * s1 + cs * cs * s2];
      const ex = cx + x0, ey = cy + y0;
      const inlier = pts.filter(([x, y]) => {
        const u = x - x0, v = y - y0;
        return Math.abs(qa * u * u + 2 * qb * u * v + qc * v * v - 1) < 0.15;
      }).length;
      // Affine guess for 4 points at rotation phi, then pick phi by the colour pattern.
      const guess = phi => [0, 90, 180, 270].map(th => {
        const t = (th + phi) * Math.PI / 180, u = Math.sin(t), v = -Math.cos(t);
        return [ex + M[0] * u + M[1] * v, ey + M[2] * u + M[3] * v];
      });
      const tries = [];
      for (let phi = -60; phi <= 60; phi += 1) tries.push({ phi, sc: modelScore(guess(phi)) });
      // Several phases are plausible under perspective; return the best few, the fine-tuning decides.
      tries.sort((p1, p2) => p2.sc - p1.sc);
      const phases = [];
      for (const t of tries) { if (phases.every(q => Math.abs(q - t.phi) >= 8)) phases.push(t.phi); if (phases.length >= 5) break; }
      return { options: phases.map(ph => guess(ph)), valid: inlier, center: [ex, ey], from: [cx, cy] };
    }

    /** Fine-tune the 4 points so the full (perspective) board model matches the colours best. */
    function refine(points) {
      let P = points.map(p => p.slice()), sc = modelScore(P);
      for (const step of [12, 6, 3, 1.5, 0.75]) {
        let improved = true, guard = 0;
        while (improved && guard++ < 20) {
          improved = false;
          const moves = [];
          for (let i = 0; i < 4; i++) for (const [dx, dy] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
            moves.push(() => { const T = P.map(p => p.slice()); T[i][0] += dx; T[i][1] += dy; return T; });
          }
          // Whole-board moves: rotate and scale around the centre (escape local optima).
          const cxm = (P[0][0] + P[1][0] + P[2][0] + P[3][0]) / 4, cym = (P[0][1] + P[1][1] + P[2][1] + P[3][1]) / 4;
          const rad = Math.max(...P.map(p => Math.hypot(p[0] - cxm, p[1] - cym))) || 1;
          for (const a of [step / rad, -step / rad]) moves.push(() => P.map(([x, y]) => [cxm + (x - cxm) * Math.cos(a) - (y - cym) * Math.sin(a), cym + (x - cxm) * Math.sin(a) + (y - cym) * Math.cos(a)]));
          for (const f of [1 + step / rad, 1 - step / rad]) moves.push(() => P.map(([x, y]) => [cxm + (x - cxm) * f, cym + (y - cym) * f]));
          for (const f of [1 + step / rad, 1 - step / rad]) {
            moves.push(() => P.map(([x, y]) => [cxm + (x - cxm) * f, y]));
            moves.push(() => P.map(([x, y]) => [x, cym + (y - cym) * f]));
          }
          for (const [dx, dy] of [[step, 0], [-step, 0], [0, step], [0, -step]]) moves.push(() => P.map(([x, y]) => [x + dx, y + dy]));
          // Opposite points moving together (perspective tilt).
          for (const [i, j] of [[0, 2], [1, 3]]) for (const [dx, dy] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
            moves.push(() => { const T = P.map(p => p.slice()); T[i][0] += dx; T[i][1] += dy; T[j][0] += dx; T[j][1] += dy; return T; });
          }
          for (const mv of moves) {
            const T = mv();
            const s2 = modelScore(T);
            if (s2 > sc) { sc = s2; P = T; improved = true; }
          }
        }
      }
      return { points: P, score: sc };
    }

    // Centre candidates: median of coloured pixels plus the densest coloured areas
    // (a red wall or flag next to the board would pull the median away).
    const G = 12, gw = Math.ceil(w / G), gh = Math.ceil(h / G), dens = new Float32Array(gw * gh);
    for (let i = 0; i < xs.length; i++) dens[((ys[i] / G) | 0) * gw + ((xs[i] / G) | 0)]++;
    // Solid coloured areas (walls, posters) are not ring-like: ignore cells that are mostly coloured.
    for (let i = 0; i < dens.length; i++) if (dens[i] > G * G * 0.6) dens[i] = 0;
    const sm = new Float32Array(gw * gh);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      let t = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && xx >= 0 && yy < gh && xx < gw) t += dens[yy * gw + xx]; }
      sm[y * gw + x] = t;
    }
    const cands = [[med(xs), med(ys)]];
    const order = Array.from(sm.keys()).sort((a, b) => sm[b] - sm[a]);
    for (const i of order) {
      const c = [(i % gw + 0.5) * G, (((i / gw) | 0) + 0.5) * G];
      if (cands.every(q => Math.hypot(q[0] - c[0], q[1] - c[1]) > 4 * G)) cands.push(c);
      if (cands.length >= 8) break;
    }
    // Ellipse fits from the centre candidates; keep the two with the most ring points.
    let fits = [], lastErr = 'Doppelring nicht klar erkennbar (Licht, Ausschnitt oder Zoom prüfen)';
    for (const [qx, qy] of cands) {
      const r = solveFrom(qx, qy);
      if (r.error) { lastErr = r.error; continue; }
      fits.push(r);
    }
    if (!fits.length) return { error: lastErr };
    // Re-run from each fit's ellipse centre (close to the bull) – twice – and keep the best two.
    for (let pass = 0; pass < 2; pass++) {
      fits.sort((f1, f2) => f2.valid - f1.valid);
      const more = [];
      for (const f of fits.slice(0, 3)) {
        if (fits.some(g => g !== f && Math.hypot(g.from[0] - f.center[0], g.from[1] - f.center[1]) < 3)) continue;
        const r = solveFrom(f.center[0], f.center[1]);
        if (!r.error) more.push(r);
      }
      fits = fits.concat(more);
    }
    fits.sort((f1, f2) => f2.valid - f1.valid);
    fits = fits.slice(0, 2);
    // Fine-tune every plausible placement against the colours; best match wins,
    // near-ties go to the placement with 20 closest to the top.
    const results = [];
    for (const f of fits) for (const opt of f.options) results.push(refine(opt));
    const top = Math.max(...results.map(r => r.score));
    const up = r => { const c = applyH(homography(CAL_BOARD, r.points), 0, 0); return Math.atan2(r.points[0][0] - c[0], c[1] - r.points[0][1]); };
    const pick = results.filter(r => r.score >= top * 0.97).sort((r1, r2) => Math.abs(up(r1)) - Math.abs(up(r2)))[0];
    const quality = pick.score / SAMPLES.length;
    if (quality < 0.45) return { error: 'Board nur unsicher erkannt – bitte von Hand nachziehen', points: pick.points, quality };
    return { points: pick.points, quality, center: applyH(homography(CAL_BOARD, pick.points), 0, 0) };
  }

  // ---------- Dart bot ----------
  /** Board point (mm) a player aims at for a given bed. */
  function aimPoint(d) {
    if (!d || !d.n) return [0, -135];
    if (d.n === 25) return [0, 0];
    const r = d.m === 3 ? (R.tIn + R.tOut) / 2 : d.m === 2 ? (R.dIn + R.dOut) / 2 : (R.tOut + R.dIn) / 2;
    const a = SEG.indexOf(d.n) * 18 * Math.PI / 180;
    return [r * Math.sin(a), -r * Math.cos(a)];
  }

  function gauss(rng) {
    let u = 0, v = 0;
    while (!u) u = rng();
    while (!v) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** What the bot aims at with `rem` points left and `left` darts in the visit. */
  function botTarget(rem, left, out) {
    const route = checkout(rem, left, out);
    if (route) return route[0];
    if (out !== 'single' && rem <= 60) {
      // No finish this visit: set up a good double.
      for (const dbl of [40, 32, 16, 24, 36, 20, 8, 12]) {
        const s = rem - dbl;
        if (s >= 1 && s <= 20) return dart(s, 1);
      }
      if (rem > 40) return dart(rem - 40 <= 20 ? rem - 40 : 20, 1);
      return dart(Math.max(1, rem - 2 > 20 ? 20 : rem - 2 || 1), 1);
    }
    if (out === 'single' && rem <= 60) return rem <= 20 ? dart(rem, 1) : dart(20, 1);
    return dart(20, 3);
  }

  /** One simulated throw. sigma = spread in mm (lower = better). */
  function botThrow(rem, left, out, sigma, rng) {
    rng = rng || Math.random;
    const target = botTarget(rem, left, out);
    const [ax, ay] = aimPoint(target);
    const x = ax + gauss(rng) * sigma, y = ay + gauss(rng) * sigma;
    return { target, point: [x, y], dart: scoreAt(x, y) };
  }

  // Bot levels: target 3-dart average -> spread in mm (calibrated by simulation, 501 double out).
  const BOT_LEVELS = [
    { id: 'beginner', name: 'Anfänger', avg: 35, sigma: 22.5 },
    { id: 'hobby', name: 'Hobby', avg: 50, sigma: 15.6 },
    { id: 'league', name: 'Liga', avg: 65, sigma: 12.1 },
    { id: 'pro', name: 'Profi', avg: 85, sigma: 8.3 },
    { id: 'world', name: 'Weltklasse', avg: 100, sigma: 6.5 }
  ];

  const api = {
    SEG, R, CAL_NUMS, CAL_BOARD, dart, scoreAt, homography, applyH, checkout, isFinish,
    meanOffset, diffMask, denoise, components, findDart, findDarts, autoCalibrate, boardColor, estimateShift, shiftImage, aimPoint, botTarget, botThrow, BOT_LEVELS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Core = api;
})(typeof self !== 'undefined' ? self : this);
