/* Lightweight SVG charts: no library, theme-aware through CSS custom
 * properties, every mark hoverable/focusable with a shared tooltip. */
(function (FF) {
  "use strict";
  var E = FF.engine;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function r1(n) { return Math.round(n * 10) / 10; }

  /* ---------- shared tooltip ---------- */
  var tip;
  function showTip(html, x, y) {
    tip = tip || document.getElementById("tip");
    tip.innerHTML = html; tip.hidden = false;
    var w = tip.offsetWidth, h = tip.offsetHeight, vw = window.innerWidth;
    var left = Math.min(vw - w - 8, Math.max(8, x + 14)), top = y - h - 12;
    if (top < 8) top = y + 18;
    tip.style.left = left + "px"; tip.style.top = top + "px";
  }
  function hideTip() { if (tip) tip.hidden = true; }
  // Elements with data-tip="Title|line|line" get a tooltip on hover and focus.
  function bindTips(root) {
    function fmt(t) { var p = t.split("|"); return "<b>" + esc(p[0]) + "</b>" + p.slice(1).map(esc).join("<br>"); }
    root.addEventListener("pointermove", function (e) {
      var el = e.target.closest && e.target.closest("[data-tip]");
      if (el && root.contains(el)) showTip(fmt(el.getAttribute("data-tip")), e.clientX, e.clientY); else hideTip();
    });
    root.addEventListener("pointerleave", hideTip);
    root.addEventListener("focusin", function (e) {
      var el = e.target.closest && e.target.closest("[data-tip]");
      if (!el) return;
      var b = el.getBoundingClientRect(); showTip(fmt(el.getAttribute("data-tip")), b.left + b.width / 2, b.top);
    });
    root.addEventListener("focusout", hideTip);
  }

  /* ---------- timeline ---------- */
  var LANES = [
    { id: "ground", label: "Ground lab", match: /ground/i },
    { id: "drop", label: "Drop tower / aircraft", match: /drop tower|aircraft/i },
    { id: "rocket", label: "Sounding rocket", match: /rocket/i },
    { id: "shuttle", label: "Space Shuttle", match: /shuttle/i },
    { id: "mir", label: "Mir", match: /\bmir\b/i },
    { id: "iss", label: "ISS", match: /\biss\b/i },
    { id: "cygnus", label: "Cygnus", match: /cygnus/i }
  ];
  function timeline(el, exps, opts) {
    var x0 = 1985, x1 = 2027, W = 1000, padL = 150, padR = 16, top = 26, rowH = 16, laneGap = 12;
    var sx = function (y) { return padL + (Math.max(x0, Math.min(x1, y)) - x0) / (x1 - x0) * (W - padL - padR); };
    var lanes = LANES.map(function (l) { return { l: l, rows: [] }; });
    exps.forEach(function (e) {
      lanes.forEach(function (ln) {
        if (!ln.l.match.test(e.platform)) return;
        var s = sx(e.years[0]), en = sx(e.years[1] + 1);
        var row = ln.rows.findIndex(function (r) { return r.every(function (b) { return en + 4 <= b.s || s >= b.e + 4; }); });
        if (row < 0) { ln.rows.push([]); row = ln.rows.length - 1; }
        ln.rows[row].push({ s: s, e: en, exp: e });
      });
    });
    var y = top, body = "", grid = "";
    for (var yr = 1985; yr <= 2025; yr += 5) {
      grid += '<line x1="' + sx(yr) + '" x2="' + sx(yr) + '" y1="' + (top - 6) + '" y2="__H__"/>';
      body += '<text x="' + sx(yr) + '" y="14" text-anchor="middle">' + yr + "</text>";
    }
    lanes.forEach(function (ln) {
      if (!ln.rows.length) return;
      var h = ln.rows.length * rowH;
      body += '<text class="lbl-strong" x="0" y="' + (y + h / 2 + 4) + '">' + esc(ln.l.label) + "</text>";
      ln.rows.forEach(function (r, ri) {
        r.forEach(function (b) {
          var e = b.exp, sel = opts.selected && opts.selected.indexOf(e.id) >= 0;
          var w = Math.max(6, b.e - b.s - 2), clipped = e.years[0] < x0;
          var col = sel ? "var(--ember)" : opts.colorFor(e);
          body += '<g class="tl-bar" tabindex="0" role="button" data-exp="' + esc(e.id) + '" data-tip="' + esc(e.id + " · " + e.name + "|" + e.years[0] + (e.years[1] !== e.years[0] ? "–" + e.years[1] : "") + " · " + e.platform + "|" + e.category) + '">' +
            '<rect class="hit" x="' + b.s + '" y="' + (y + ri * rowH) + '" width="' + (w + 2) + '" height="' + rowH + '"/>' +
            '<rect class="mark" x="' + b.s + '" y="' + (y + ri * rowH + 3) + '" width="' + w + '" height="10" rx="3" style="fill:' + col + '"/>' +
            (clipped ? '<text x="' + (b.s + 4) + '" y="' + (y + ri * rowH + 12) + '" style="fill:var(--bg);font-size:9px">since ' + e.years[0] + "</text>" : "") +
            "</g>";
        });
      });
      y += h + laneGap;
    });
    var H = y + 4;
    el.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Timeline of microgravity combustion experiments by platform, 1985 to 2026">' +
      '<g class="grid">' + grid.replace(/__H__/g, H - 6) + "</g>" + body + "</svg>";
    el.querySelectorAll("[data-exp]").forEach(function (g) {
      function go() { opts.onPick(g.getAttribute("data-exp")); }
      g.addEventListener("click", go);
      g.addEventListener("keydown", function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); go(); } });
    });
  }

  /* ---------- envelope heat map ---------- */
  var HEAT = ["var(--h0)", "var(--h1)", "var(--h2)", "var(--h3)", "var(--h4)", "var(--h5)"];
  function heatStep(r) { return r < 0.1 ? 0 : r < 0.3 ? 1 : r < 0.5 ? 2 : r < 0.7 ? 3 : r < 0.9 ? 4 : 5; }
  function envelope(el, s, mission) {
    var mat = FF.MATERIALS.find(function (m) { return m.id === s.material; });
    var W = 640, H = 380, pl = 46, pr = 14, pt = 12, pb = 40, fx = 50, o2a = 10, o2b = 45, nx = 50, ny = 35;
    var sx = function (u) { return pl + u / fx * (W - pl - pr); };
    var sy = function (o) { return pt + (1 - (o - o2a) / (o2b - o2a)) * (H - pt - pb); };
    var cw = (W - pl - pr) / nx, ch = (H - pt - pb) / ny, cells = "";
    for (var i = 0; i < nx; i++) {
      var u = (i + 0.5) / nx * fx, lim = E.limitO2(mat, u, s.g, s.p);
      for (var j = 0; j < ny; j++) {
        var o = o2a + (j + 0.5) / ny * (o2b - o2a);
        cells += '<rect x="' + r1(pl + i * cw) + '" y="' + r1(sy(o2a + (j + 1) / ny * (o2b - o2a))) + '" width="' + r1(cw + 0.4) + '" height="' + r1(ch + 0.4) + '" style="fill:' + HEAT[heatStep(E.riskOf(o, lim))] + '"/>';
      }
    }
    var path = "";
    for (var k = 0; k <= 100; k++) {
      var uu = k / 100 * fx, ll = E.limitO2(mat, uu, s.g, s.p);
      var cy = Math.max(o2a, Math.min(o2b, ll));
      path += (k ? "L" : "M") + r1(sx(uu)) + " " + r1(sy(cy));
    }
    var ax = "";
    [0, 10, 20, 30, 40, 50].forEach(function (u) { ax += '<text x="' + sx(u) + '" y="' + (H - pb + 16) + '" text-anchor="middle">' + u + "</text>"; });
    [10, 15, 20, 25, 30, 35, 40, 45].forEach(function (o) { ax += '<text x="' + (pl - 8) + '" y="' + (sy(o) + 4) + '" text-anchor="end">' + o + "%</text>"; });
    var band = mission ? '<rect x="' + sx(mission.flow[0]) + '" y="' + pt + '" width="' + (sx(mission.flow[1]) - sx(mission.flow[0])) + '" height="' + (H - pt - pb) + '" style="fill:none;stroke:var(--fg-2);stroke-width:1;stroke-dasharray:0" opacity="0.6"/>' +
      '<text x="' + (sx(mission.flow[0]) + 4) + '" y="' + (pt + 13) + '" class="lbl-strong">ventilation range</text>' : "";
    var mx = sx(Math.min(fx, s.flow)), my = sy(Math.max(o2a, Math.min(o2b, s.o2)));
    el.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Flammability map: risk by oxygen percentage and flow speed for ' + esc(mat.label) + '">' +
      cells + band +
      '<path d="' + path + '" style="fill:none;stroke:var(--fg);stroke-width:2;stroke-linejoin:round"/>' +
      '<circle cx="' + mx + '" cy="' + my + '" r="7" style="fill:var(--accent);stroke:var(--bg);stroke-width:2"/>' +
      ax + '<text x="' + ((W + pl) / 2) + '" y="' + (H - 6) + '" text-anchor="middle">Forced flow speed (cm/s)</text>' +
      '<text transform="rotate(-90)" x="' + (-(H - pb + pt) / 2) + '" y="12" text-anchor="middle">Oxygen (%)</text>' +
      '<rect class="hit" x="' + pl + '" y="' + pt + '" width="' + (W - pl - pr) + '" height="' + (H - pt - pb) + '"/></svg>';
    var svg = el.querySelector("svg"), hit = svg.querySelector(".hit");
    hit.addEventListener("pointermove", function (e) {
      var b = svg.getBoundingClientRect(), k2 = W / b.width;
      var px = (e.clientX - b.left) * k2, py = (e.clientY - b.top) * k2;
      var u = Math.max(0, (px - pl) / (W - pl - pr) * fx), o = o2a + (1 - (py - pt) / (H - pt - pb)) * (o2b - o2a);
      var lim = E.limitO2(mat, u, s.g, s.p), r = E.riskOf(o, lim);
      showTip("<b>" + E.riskBand(r).label + " risk</b>" + r1(o) + "% O₂ at " + r1(u) + " cm/s<br>Limiting O₂ here: " + r1(lim) + "%", e.clientX, e.clientY);
    });
    hit.addEventListener("pointerleave", hideTip);
  }
  function heatLegend() {
    var labels = ["<10%", "10–30%", "30–50%", "50–70%", "70–90%", ">90%"];
    return '<div class="legend" aria-label="Probability that a flame spreads">' + HEAT.map(function (c, i) {
      return '<span><i style="background:' + c + '"></i>' + labels[i] + "</span>";
    }).join("") + '<span><i style="background:var(--fg);height:2px"></i>Flammability boundary</span><span><i style="background:var(--accent);border-radius:50%"></i>Your scenario</span></div>';
  }

  /* ---------- limiting O2 vs flow at four gravity levels ---------- */
  var GLEVELS = [
    { g: 0, label: "Orbit (0 g)", c: "var(--s1)" },
    { g: 0.166, label: "Moon (0.17 g)", c: "var(--s2)" },
    { g: 0.38, label: "Mars (0.38 g)", c: "var(--s3)" },
    { g: 1, label: "Earth (1 g)", c: "var(--s4)" }
  ];
  function gravityCurves(el, s) {
    var mat = FF.MATERIALS.find(function (m) { return m.id === s.material; });
    var W = 640, H = 300, pl = 46, pr = 110, pt = 12, pb = 38, fx = 50;
    var all = [];
    GLEVELS.forEach(function (g) { for (var k = 0; k <= 50; k++) all.push(E.limitO2(mat, k, g.g, s.p)); });
    var lo = Math.floor(Math.min.apply(null, all.concat([s.o2])) - 1), hi = Math.ceil(Math.min(60, Math.max.apply(null, all.concat([s.o2]))) + 1);
    hi = Math.min(hi, lo + 40);
    var sx = function (u) { return pl + u / fx * (W - pl - pr); };
    var sy = function (o) { return pt + (1 - (Math.max(lo, Math.min(hi, o)) - lo) / (hi - lo)) * (H - pt - pb); };
    var out = '<g class="grid">', step = (hi - lo) > 20 ? 5 : 2;
    for (var o = Math.ceil(lo / step) * step; o <= hi; o += step) out += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + sy(o) + '" y2="' + sy(o) + '"/>';
    out += "</g>";
    for (o = Math.ceil(lo / step) * step; o <= hi; o += step) out += '<text x="' + (pl - 8) + '" y="' + (sy(o) + 4) + '" text-anchor="end">' + o + "%</text>";
    [0, 10, 20, 30, 40, 50].forEach(function (u) { out += '<text x="' + sx(u) + '" y="' + (H - pb + 16) + '" text-anchor="middle">' + u + "</text>"; });
    out += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + sy(s.o2) + '" y2="' + sy(s.o2) + '" style="stroke:var(--ember);stroke-width:1.5"/>' +
      '<text x="' + (W - pr + 6) + '" y="' + (sy(s.o2) + 4) + '" style="fill:var(--ember)">Cabin ' + r1(s.o2) + "%</text>";
    var ends = [];
    GLEVELS.forEach(function (g) {
      var d = "";
      for (var k = 0; k <= 100; k++) { var u = k / 2; d += (k ? "L" : "M") + r1(sx(u)) + " " + r1(sy(E.limitO2(mat, u, g.g, s.p))); }
      out += '<path d="' + d + '" style="fill:none;stroke:' + g.c + ';stroke-width:2;stroke-linecap:round;stroke-linejoin:round"/>';
      ends.push({ y: sy(E.limitO2(mat, fx, g.g, s.p)), g: g });
    });
    ends.sort(function (a, b) { return a.y - b.y; });
    for (var i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;
    ends.forEach(function (e) { out += '<circle cx="' + (W - pr) + '" cy="' + sy(E.limitO2(mat, fx, e.g.g, s.p)) + '" r="4" style="fill:' + e.g.c + ';stroke:var(--panel);stroke-width:2"/><text class="lbl-strong" x="' + (W - pr + 8) + '" y="' + (e.y + 4) + '">' + esc(e.g.label.split(" (")[0]) + "</text>"; });
    out += '<line id="gc-x" x1="0" x2="0" y1="' + pt + '" y2="' + (H - pb) + '" style="stroke:var(--fg-2);stroke-width:1" visibility="hidden"/>';
    out += '<text x="' + ((W - pr + pl) / 2) + '" y="' + (H - 6) + '" text-anchor="middle">Forced flow speed (cm/s)</text>';
    out += '<rect class="hit" x="' + pl + '" y="' + pt + '" width="' + (W - pl - pr) + '" height="' + (H - pt - pb) + '"/>';
    el.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Limiting oxygen versus flow speed at four gravity levels">' + out + "</svg>";
    var svg = el.querySelector("svg"), hit = svg.querySelector(".hit"), xl = svg.querySelector("#gc-x");
    hit.addEventListener("pointermove", function (e) {
      var b = svg.getBoundingClientRect(), k2 = W / b.width, px = (e.clientX - b.left) * k2;
      var u = Math.max(0, Math.min(fx, (px - pl) / (W - pl - pr) * fx));
      xl.setAttribute("x1", sx(u)); xl.setAttribute("x2", sx(u)); xl.setAttribute("visibility", "visible");
      showTip("<b>Flow " + r1(u) + " cm/s</b>" + GLEVELS.map(function (g) { return esc(g.label) + ": " + r1(E.limitO2(mat, u, g.g, s.p)) + "% O₂"; }).join("<br>"), e.clientX, e.clientY);
    });
    hit.addEventListener("pointerleave", function () { xl.setAttribute("visibility", "hidden"); hideTip(); });
  }
  function gravityLegend() {
    return '<div class="legend">' + GLEVELS.map(function (g) { return '<span><i style="background:' + g.c + '"></i>' + esc(g.label) + "</span>"; }).join("") +
      '<span><i style="background:var(--ember);height:2px"></i>Cabin oxygen</span></div>';
  }

  /* ---------- columns (counts per year) ---------- */
  function columns(el, data, label) {
    var W = 640, H = 180, pl = 30, pr = 8, pt = 18, pb = 26;
    if (!data.length) { el.innerHTML = '<p class="muted small">No data yet.</p>'; return; }
    var max = Math.max.apply(null, data.map(function (d) { return d.v; })), n = data.length;
    var bw = Math.min(24, (W - pl - pr) / n * 0.6), out = '<g class="grid">';
    var nice = max <= 5 ? 1 : max <= 12 ? 2 : max <= 30 ? 5 : 10;
    for (var t = 0; t <= max; t += nice) { var yy = pt + (1 - t / max) * (H - pt - pb); out += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + yy + '" y2="' + yy + '"/>'; }
    out += "</g>";
    for (t = 0; t <= max; t += nice) { yy = pt + (1 - t / max) * (H - pt - pb); out += '<text x="' + (pl - 6) + '" y="' + (yy + 4) + '" text-anchor="end">' + t + "</text>"; }
    data.forEach(function (d, i) {
      var cx = pl + (i + 0.5) / n * (W - pl - pr), h = d.v / max * (H - pt - pb), y = H - pb - h;
      var last = i === n - 1;
      out += '<g data-tip="' + esc(d.k + "|" + d.v + " " + label) + '" tabindex="0"><rect class="hit" x="' + (cx - (W - pl - pr) / n / 2) + '" y="' + pt + '" width="' + ((W - pl - pr) / n) + '" height="' + (H - pt - pb) + '"/>' +
        '<path d="M' + (cx - bw / 2) + " " + (H - pb) + "V" + (y + 4) + "q0 -4 4 -4h" + (bw - 8) + "q4 0 4 4V" + (H - pb) + 'z" style="fill:' + (last ? "var(--ember)" : "var(--s1)") + '"/></g>';
      if (n <= 14 || i % Math.ceil(n / 10) === 0 || last) out += '<text x="' + cx + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(d.k) + "</text>";
      if (last) out += '<text class="lbl-strong" x="' + cx + '" y="' + (y - 5) + '" text-anchor="middle">' + d.v + "</text>";
    });
    el.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(label) + ' per year">' + out + "</svg>";
    bindTips(el);
  }

  FF.charts = { esc: esc, bindTips: bindTips, showTip: showTip, hideTip: hideTip, timeline: timeline, envelope: envelope, heatLegend: heatLegend,
    gravityCurves: gravityCurves, gravityLegend: gravityLegend, columns: columns, GLEVELS: GLEVELS };
})(window.FF = window.FF || {});
