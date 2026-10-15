/* Convierte una imagen de plano (zonas de colores planos) en bloques vectoriales.
   Sin dependencias: corre en el navegador y en node (para probarlo).

   1) analyze(img, opts)   -> paleta de colores detectados + mapa de etiquetas por píxel
   2) vectorize(an, groups, opts) -> bloques (contorno exterior + huecos) por grupo de colores
*/
(function (root) {
  'use strict';

  /* ---------- colores ---------- */
  function rgb2hsv(r, g, b) {
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, h = 0;
    if (d) {
      if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return { h: h, s: mx ? d / mx : 0, v: mx / 255 };
  }
  function hex(r, g, b) { return '#' + [r, g, b].map(function (x) { return ('0' + Math.round(x).toString(16)).slice(-2); }).join(''); }
  function lum(r, g, b) { return 0.299 * r + 0.587 * g + 0.114 * b; }

  /* nombre en castellano y tipo sugerido: 'edif' (volumen), 'bajo' (plano bajo), 'agua' (nivel 0), 'ign' (ignorar) */
  function describe(r, g, b) {
    var c = rgb2hsv(r, g, b), L = lum(r, g, b), name, kind = 'edif';
    if (Math.min(r, g, b) >= 232) return { name: 'Fondo blanco', kind: 'ign' };
    if (Math.max(r, g, b) < 70) return { name: 'Líneas negras / texto', kind: 'ign' };
    if (c.s < 0.2) {
      if (L < 110) return { name: 'Líneas negras / grises', kind: 'ign' };
      return { name: L > 190 ? 'Gris claro' : 'Gris', kind: 'ign' };
    }
    var h = c.h;
    if (h < 15 || h >= 345) name = 'Rojo';
    else if (h < 40) name = 'Naranja';
    else if (h < 70) { name = (c.s < 0.4 && L > 170) ? 'Arena' : 'Amarillo'; if (name === 'Arena') kind = 'bajo'; }
    else if (h < 165) { name = L < 90 ? 'Verde oscuro' : 'Verde'; kind = 'bajo'; }
    else if (h < 255) {
      if (c.s < 0.5 && L > 85) { name = 'Azul grisáceo (¿agua?)'; kind = 'agua'; } else name = L < 100 ? 'Azul oscuro' : 'Azul';
    } else if (h < 300) name = 'Violeta';
    else name = 'Rosa';
    return { name: name, kind: kind };
  }

  /* ---------- 1. análisis ---------- */
  function analyze(img, opts) {
    opts = opts || {};
    var w = img.width, h = img.height, data = img.data, N = w * h;
    var tol = opts.tol || 30, maxColors = opts.maxColors || 16, minFrac = opts.minFrac || 0.0006;
    var cnt = new Uint32Array(4096), sr = new Float64Array(4096), sg = new Float64Array(4096), sb = new Float64Array(4096), total = 0;
    var i, k;
    for (i = 0; i < N; i++) {
      if (data[4 * i + 3] < 128) continue;
      var r = data[4 * i], g = data[4 * i + 1], b = data[4 * i + 2];
      k = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      cnt[k]++; sr[k] += r; sg[k] += g; sb[k] += b; total++;
    }
    var bins = [];
    for (k = 0; k < 4096; k++) if (cnt[k]) bins.push(k);
    bins.sort(function (a, c) { return cnt[c] - cnt[a]; });
    var pal = [], t2 = tol * tol;
    for (var bi = 0; bi < bins.length && pal.length < maxColors; bi++) {
      k = bins[bi];
      if (cnt[k] < minFrac * total) break;
      var m = [sr[k] / cnt[k], sg[k] / cnt[k], sb[k] / cnt[k]], near = false;
      for (var j = 0; j < pal.length; j++) {
        var dr = m[0] - pal[j][0], dg = m[1] - pal[j][1], db = m[2] - pal[j][2];
        if (dr * dr + dg * dg + db * db <= t2) { near = true; break; }
      }
      if (!near) pal.push(m);
    }
    var labels = new Uint8Array(N).fill(255), P = pal.length;
    var lim2 = (tol * 1.15) * (tol * 1.15);
    function assign() {
      var cn = new Uint32Array(P), s = [];
      for (var p = 0; p < P; p++) s.push([0, 0, 0]);
      for (var q = 0; q < N; q++) {
        if (data[4 * q + 3] < 128) { labels[q] = 255; continue; }
        var R = data[4 * q], G = data[4 * q + 1], B = data[4 * q + 2], best = 255, bd = lim2 + 1;
        for (var z = 0; z < P; z++) {
          var a = R - pal[z][0], c = G - pal[z][1], d = B - pal[z][2], dd = a * a + c * c + d * d;
          if (dd < bd) { bd = dd; best = z; }
        }
        labels[q] = best;
        if (best !== 255 && bd < t2 * 0.25) { cn[best]++; s[best][0] += R; s[best][1] += G; s[best][2] += B; }
      }
      return { cn: cn, s: s };
    }
    var st = assign();
    for (var p = 0; p < P; p++) if (st.cn[p] > 20) pal[p] = [st.s[p][0] / st.cn[p], st.s[p][1] / st.cn[p], st.s[p][2] / st.cn[p]];
    assign();
    var cnts = new Uint32Array(P);
    for (i = 0; i < N; i++) if (labels[i] !== 255) cnts[labels[i]]++;
    var palette = pal.map(function (c, idx) {
      var d = describe(c[0], c[1], c[2]);
      return { r: Math.round(c[0]), g: Math.round(c[1]), b: Math.round(c[2]), hex: hex(c[0], c[1], c[2]), frac: cnts[idx] / N, name: d.name, kind: d.kind };
    });
    /* colores muy chicos (tramas, rayas): se unen al color con el que más se tocan */
    var adj = [];
    for (var a0 = 0; a0 < P; a0++) adj.push(new Uint32Array(P));
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var l0 = labels[y * w + x]; if (l0 === 255) continue;
      for (var off = 1; off <= 3; off++) {
        if (x + off < w) { var l1 = labels[y * w + x + off]; if (l1 !== 255 && l1 !== l0) { adj[l0][l1]++; adj[l1][l0]++; } }
        if (y + off < h) { var l2 = labels[(y + off) * w + x]; if (l2 !== 255 && l2 !== l0) { adj[l0][l2]++; adj[l2][l0]++; } }
      }
    }
    palette.forEach(function (c, idx) {
      c.mergeInto = -1;
      if (c.kind === 'ign' || c.frac >= 0.006) return;
      var best = -1, bv = 0;
      for (var q = 0; q < P; q++) if (q !== idx && adj[idx][q] > bv) { bv = adj[idx][q]; best = q; }
      if (best >= 0 && palette[best].kind !== 'ign' && palette[best].frac > c.frac * 2) c.mergeInto = best;
    });
    return { w: w, h: h, labels: labels, palette: palette };
  }

  /* ---------- 2. vectorizado ---------- */
  function fillSmallHoles(mask, w, h, maxArea) {
    var N = w * h, seen = new Uint8Array(N), stack = new Int32Array(N), i;
    for (i = 0; i < N; i++) {
      if (mask[i] || seen[i]) continue;
      var sp = 0, n = 0, touches = false, comp = [];
      stack[sp++] = i; seen[i] = 1;
      while (sp) {
        var p = stack[--sp], x = p % w, y = (p / w) | 0;
        n++; if (n <= maxArea + 1) comp.push(p);
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touches = true;
        if (x > 0 && !mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[sp++] = p - 1; }
        if (x < w - 1 && !mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[sp++] = p + 1; }
        if (y > 0 && !mask[p - w] && !seen[p - w]) { seen[p - w] = 1; stack[sp++] = p - w; }
        if (y < h - 1 && !mask[p + w] && !seen[p + w]) { seen[p + w] = 1; stack[sp++] = p + w; }
      }
      if (!touches && n <= maxArea) for (var j = 0; j < comp.length; j++) mask[comp[j]] = 1;
    }
  }
  function majority(mask, w, h) {
    var out = new Uint8Array(mask.length);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var s = 0;
      for (var dy = -1; dy <= 1; dy++) {
        var yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (var dx = -1; dx <= 1; dx++) { var xx = x + dx; if (xx < 0 || xx >= w) continue; s += mask[yy * w + xx]; }
      }
      out[y * w + x] = s >= 5 ? 1 : 0;
    }
    return out;
  }
  function closeMask(mask, w, h, r) {
    var N = w * h, a = new Uint8Array(N), b = new Uint8Array(N), x, y, k;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) { var v = 0; for (k = -r; k <= r && !v; k++) { var xx = x + k; if (xx >= 0 && xx < w && mask[y * w + xx]) v = 1; } a[y * w + x] = v; }
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) { var v2 = 0; for (k = -r; k <= r && !v2; k++) { var yy = y + k; if (yy >= 0 && yy < h && a[yy * w + x]) v2 = 1; } b[y * w + x] = v2; }
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) { var u = 1; for (k = -r; k <= r && u; k++) { var xx2 = x + k; if (xx2 >= 0 && xx2 < w && !b[y * w + xx2]) u = 0; } a[y * w + x] = u; }
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) { var u2 = 1; for (k = -r; k <= r && u2; k++) { var yy2 = y + k; if (yy2 >= 0 && yy2 < h && !a[yy2 * w + x]) u2 = 0; } b[y * w + x] = u2 ? 1 : 0; }
    for (var i = 0; i < N; i++) if (mask[i]) b[i] = 1;
    return b;
  }
  function components(mask, w, h, minArea) {
    var N = w * h, comp = new Int32Array(N).fill(0), list = [], stack = new Int32Array(N), id = 0;
    for (var i = 0; i < N; i++) {
      if (!mask[i] || comp[i]) continue;
      id++;
      var sp = 0, n = 0, x0 = w, y0 = h, x1 = 0, y1 = 0, sx = 0, sy = 0;
      stack[sp++] = i; comp[i] = id;
      while (sp) {
        var p = stack[--sp], x = p % w, y = (p / w) | 0;
        n++; sx += x; sy += y;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0 && mask[p - 1] && !comp[p - 1]) { comp[p - 1] = id; stack[sp++] = p - 1; }
        if (x < w - 1 && mask[p + 1] && !comp[p + 1]) { comp[p + 1] = id; stack[sp++] = p + 1; }
        if (y > 0 && mask[p - w] && !comp[p - w]) { comp[p - w] = id; stack[sp++] = p - w; }
        if (y < h - 1 && mask[p + w] && !comp[p + w]) { comp[p + w] = id; stack[sp++] = p + w; }
      }
      list.push({ id: id, area: n, x0: x0, y0: y0, x1: x1, y1: y1, cx: sx / n, cy: sy / n, keep: n >= minArea });
    }
    return { comp: comp, list: list };
  }

  /* contornos del componente `c.id`: bordes entre píxeles, con el interior siempre a la derecha */
  var DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
  function traceLoops(comp, w, c) {
    var bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1, W1 = bw + 1;
    var has = new Uint8Array((bw + 1) * (bh + 1) * 4);
    function inC(x, y) { return x >= c.x0 && x <= c.x1 && y >= c.y0 && y <= c.y1 && comp[y * w + x] === c.id; }
    var any = false, x, y;
    for (y = c.y0; y <= c.y1; y++) for (x = c.x0; x <= c.x1; x++) {
      if (comp[y * w + x] !== c.id) continue;
      var lx = x - c.x0, ly = y - c.y0;
      if (!inC(x, y - 1)) { has[(ly * W1 + lx) * 4 + 0] = 1; any = true; }       // arriba: va al este
      if (!inC(x + 1, y)) { has[(ly * W1 + lx + 1) * 4 + 1] = 1; any = true; }   // derecha: va al sur
      if (!inC(x, y + 1)) { has[((ly + 1) * W1 + lx + 1) * 4 + 2] = 1; any = true; } // abajo: va al oeste
      if (!inC(x - 1, y)) { has[((ly + 1) * W1 + lx) * 4 + 3] = 1; any = true; } // izquierda: va al norte
    }
    var loops = [];
    if (!any) return loops;
    for (var v0 = 0; v0 < W1 * (bh + 1); v0++) for (var d0 = 0; d0 < 4; d0++) {
      if (!has[v0 * 4 + d0]) continue;
      var pts = [], v = v0, d = d0, guard = 0, lastD = -1;
      while (has[v * 4 + d] && guard++ < 4000000) {
        has[v * 4 + d] = 0;
        var vx = v % W1, vy = (v / W1) | 0;
        if (d !== lastD) pts.push([vx + c.x0, vy + c.y0]);
        lastD = d;
        vx += DX[d]; vy += DY[d]; v = vy * W1 + vx;
        var nd = -1, cand = [(d + 1) % 4, d, (d + 3) % 4];
        for (var q = 0; q < 3; q++) if (has[v * 4 + cand[q]]) { nd = cand[q]; break; }
        if (nd < 0) break;
        d = nd;
      }
      if (pts.length >= 3) loops.push(pts);
    }
    return loops;
  }
  function area2(p) { var s = 0; for (var i = 0, n = p.length; i < n; i++) { var a = p[i], b = p[(i + 1) % n]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; }

  function dp(pts, lo, hi, eps, keep) {
    if (hi <= lo + 1) return;
    var ax = pts[lo][0], ay = pts[lo][1], bx = pts[hi][0], by = pts[hi][1], dx = bx - ax, dy = by - ay, L = Math.sqrt(dx * dx + dy * dy), md = -1, mi = -1;
    for (var i = lo + 1; i < hi; i++) {
      var d = L ? Math.abs(dy * (pts[i][0] - ax) - dx * (pts[i][1] - ay)) / L : Math.hypot(pts[i][0] - ax, pts[i][1] - ay);
      if (d > md) { md = d; mi = i; }
    }
    if (md > eps) { keep[mi] = 1; dp(pts, lo, mi, eps, keep); dp(pts, mi, hi, eps, keep); }
  }
  function simplifyClosed(pts, eps) {
    var n = pts.length; if (n <= 4) return pts.slice();
    var far = 0, md = -1;
    for (var i = 1; i < n; i++) { var d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > md) { md = d; far = i; } }
    var keep = new Uint8Array(n); keep[0] = 1; keep[far] = 1;
    var a = pts.slice(0, far + 1), b = pts.slice(far).concat([pts[0]]);
    var ka = new Uint8Array(a.length), kb = new Uint8Array(b.length);
    ka[0] = ka[a.length - 1] = 1; kb[0] = kb[b.length - 1] = 1;
    dp(a, 0, a.length - 1, eps, ka); dp(b, 0, b.length - 1, eps, kb);
    var out = [], j;
    for (j = 0; j < a.length; j++) if (ka[j]) out.push(a[j]);
    for (j = 1; j < b.length - 1; j++) if (kb[j]) out.push(b[j]);
    return out;
  }
  /* aristas casi horizontales o verticales quedan exactamente alineadas */
  function snapAxes(p, tolPx) {
    var n = p.length, q = p.map(function (a) { return [a[0], a[1]]; }), i;
    for (i = 0; i < n; i++) {
      var a = q[i], b = q[(i + 1) % n], len = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (len < 6) continue;
      if (Math.abs(a[0] - b[0]) <= tolPx) { var mx = (a[0] + b[0]) / 2; a[0] = mx; b[0] = mx; }
      else if (Math.abs(a[1] - b[1]) <= tolPx) { var my = (a[1] + b[1]) / 2; a[1] = my; b[1] = my; }
    }
    return q;
  }
  function dedupe(p) {
    var out = [];
    for (var i = 0; i < p.length; i++) {
      var a = p[i], b = out[out.length - 1];
      if (!b || Math.abs(a[0] - b[0]) > 0.01 || Math.abs(a[1] - b[1]) > 0.01) out.push(a);
    }
    if (out.length > 1 && Math.abs(out[0][0] - out[out.length - 1][0]) < 0.01 && Math.abs(out[0][1] - out[out.length - 1][1]) < 0.01) out.pop();
    return out;
  }
  function flat(p) { var o = []; for (var i = 0; i < p.length; i++) { o.push(Math.round(p[i][0] * 10) / 10, Math.round(p[i][1] * 10) / 10); } return o; }

  /* groups: [{ members:[índices de paleta], ... }]. Devuelve { polys:[[grupo, contorno, huecos?]], centroids:[...] } */
  function vectorize(an, groups, opts) {
    opts = opts || {};
    var w = an.w, h = an.h, N = w * h, minArea = opts.minArea || Math.max(40, Math.round(w * h * 0.00012)), eps = opts.eps == null ? 1.1 : opts.eps;
    var holeMax = opts.holeMax || Math.max(120, Math.round(N * 0.0016));
    var polys = [], info = [];
    groups.forEach(function (g, gi) {
      var inG = new Uint8Array(256); g.members.forEach(function (m) { inG[m] = 1; });
      var mask = new Uint8Array(N), any = false;
      for (var i = 0; i < N; i++) if (an.labels[i] !== 255 && inG[an.labels[i]]) { mask[i] = 1; any = true; }
      if (!any) return;
      if (g.kind === 'agua' || g.kind === 'bajo') mask = closeMask(mask, w, h, 4);
      fillSmallHoles(mask, w, h, holeMax);
      mask = majority(mask, w, h);
      var cc = components(mask, w, h, (g.kind === 'agua' || g.kind === 'bajo') ? minArea * 4 : minArea);
      cc.list.forEach(function (c) {
        if (!c.keep) return;
        var loops = traceLoops(cc.comp, w, c), outer = null, holes = [];
        loops.forEach(function (lp) {
          var a = area2(lp);
          if (a > 0) { if (!outer || a > outer.a) outer = { a: a, p: lp }; }
          else if (-a >= Math.max(20, holeMax * 0.5)) holes.push(lp);
        });
        if (!outer) return;
        var e2 = (g.kind === 'agua' || g.kind === 'bajo') ? eps * 1.6 : eps;
        var simp = function (lp) { return dedupe(snapAxes(simplifyClosed(lp, e2), 1.6)); };
        var o = simp(outer.p);
        if (o.length < 3 || Math.abs(area2(o)) < minArea * 0.5) return;
        var hs = holes.map(simp).filter(function (hp) { return hp.length >= 3; });
        var poly = [gi, flat(o)];
        if (hs.length) poly.push(hs.map(flat));
        polys.push(poly);
        info.push({ g: gi, area: c.area, cx: c.cx, cy: c.cy });
      });
    });
    return { polys: polys, info: info };
  }

  var api = { analyze: analyze, vectorize: vectorize, describe: describe };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Plano = api;
})(typeof self !== 'undefined' ? self : this);
