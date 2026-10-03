/* Flame in Freefall: application shell, views and interactions. */
(function (FF) {
  "use strict";
  var E = FF.engine, C = FF.charts, L = FF.live, esc = C.esc;
  var SDK_URL = "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.131.0/+esm";
  var MODEL = "claude-opus-5-5";

  /* ---------- storage ---------- */
  function load(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }

  /* ---------- state ---------- */
  var DEFAULT_W = { impact: 30, evidence: 25, mission: 20, action_s: 15, novelty: 10 };
  var prefs = load("ff.prefs", {}) || {};
  var S = {
    view: "briefing",
    mission: prefs.mission || "lunar",
    audience: prefs.audience || "engineer",
    weights: Object.assign({}, DEFAULT_W, prefs.weights || {}),
    sim: Object.assign({ o2: 34, p: 56.5, g: 0.166, flow: 8, material: "cotton" }, prefs.sim || {}),
    expFilter: { q: "", category: "", platform: "", regime: "" },
    compare: [],
    hazardFilter: "",
    liveFilter: { source: "all", hazard: "", mine: false, onlyNew: false, show: 15 },
    gapSel: null,
    aiMode: prefs.aiMode || "instant",
    chat: []
  };
  function persist() { save("ff.prefs", { mission: S.mission, audience: S.audience, weights: S.weights, sim: S.sim, aiMode: S.aiMode }); }
  function mission() { return FF.MISSIONS.find(function (m) { return m.id === S.mission; }) || FF.MISSIONS[0]; }
  function ctx() { return { mission: S.mission, audience: S.audience, weights: S.weights, live: L.state.items }; }

  /* ---------- user-imported findings ---------- */
  var BASE_FINDINGS = FF.FINDINGS.slice();
  function applyImported() {
    var imp = load("ff.imported", []) || [];
    FF.FINDINGS = BASE_FINDINGS.concat(imp);
    E.buildIndex(); E.setLive(L.state.items);
  }

  /* ---------- helpers ---------- */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  function toast(msg) {
    var t = $("#toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(function () { t.hidden = true; }, 2600);
  }
  function yrs(e) { return e.years[0] + (e.years[1] !== e.years[0] ? "–" + e.years[1] : ""); }
  function hazardLabel(id) { var h = FF.HAZARDS.find(function (x) { return x.id === id; }); return h ? h.label : id; }
  function regimeLabel(id) { var r = FF.REGIMES.find(function (x) { return x.id === id; }); return r ? r.short : id; }
  function ago(iso) {
    if (!iso) return "never";
    var s = (Date.now() - Date.parse(iso)) / 1000;
    if (s < 90) return "just now"; if (s < 5400) return Math.round(s / 60) + " min ago";
    if (s < 129600) return Math.round(s / 3600) + " h ago"; return Math.round(s / 86400) + " days ago";
  }
  function pct(n) { return n > 0.995 ? ">99%" : n < 0.005 ? "<1%" : Math.round(n * 100) + "%"; }
  function r1(n) { return (Math.round(n * 10) / 10).toFixed(1); }
  function liveById(uid) { return L.state.items.find(function (it) { return it.uid === uid; }); }

  // Minimal, safe markdown: escape first, then **bold**, bullets, and [ID] citations.
  function md(src) {
    var out = [], list = null;
    String(src).split(/\n+/).forEach(function (line) {
      var t = esc(line.trim());
      if (!t) return;
      t = t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>");
      t = t.replace(/\[([A-Z][A-Z0-9]*(?:-[A-Za-z0-9]+)*)\]/g, function (m, id) {
        if (E.byId(id) || liveById(id)) return '<button type="button" class="chip cite" data-cite="' + id + '">' + id + "</button>";
        return m;
      });
      if (/^[-•]\s+/.test(t)) { if (!list) { list = []; } list.push("<li>" + t.replace(/^[-•]\s+/, "") + "</li>"); return; }
      if (list) { out.push("<ul>" + list.join("") + "</ul>"); list = null; }
      out.push("<p>" + t + "</p>");
    });
    if (list) out.push("<ul>" + list.join("") + "</ul>");
    return out.join("");
  }
  function openCite(id) {
    if (FF.FINDINGS.some(function (f) { return f.id === id; })) return openFinding(id);
    if (FF.EXPERIMENTS.some(function (e) { return e.id === id; })) return openExperiment(id);
    var it = liveById(id); if (it) openLive(it);
  }
  document.addEventListener("click", function (e) {
    var c = e.target.closest("[data-cite]"); if (c) { e.preventDefault(); openCite(c.getAttribute("data-cite")); }
  });

  function download(name, text, type) {
    try {
      var url = URL.createObjectURL(new Blob([text], { type: type }));
      var a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
      toast("Downloaded " + name);
    } catch (e) { toast("Download is not available here."); }
  }
  function copy(text, label) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast((label || "Text") + " copied"); }, function () { toast("Copy was blocked by the browser."); });
    } else toast("Copy is not available here.");
  }

  /* ---------- drawer ---------- */
  var lastFocus = null;
  function openDrawer(html) {
    lastFocus = document.activeElement;
    $("#drawer-body").innerHTML = html; $("#drawer").hidden = false; document.body.style.overflow = "hidden";
    $("#drawer-close").focus();
  }
  function closeDrawer() {
    $("#drawer").hidden = true; document.body.style.overflow = "";
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  $("#drawer-close").addEventListener("click", closeDrawer);
  $("#drawer").addEventListener("click", function (e) { if (e.target.id === "drawer") closeDrawer(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { if (!$("#drawer").hidden) closeDrawer(); if (!$("#more-sheet").hidden) $("#more-sheet").hidden = true; }
    if (e.key === "Tab" && !$("#drawer").hidden) {
      var f = Array.prototype.filter.call($("#drawer").querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'), function (x) { return !x.disabled && x.offsetParent !== null; });
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });

  function findingBlock(f, rank, score) {
    var exps = f.exp.map(function (id) { return '<button type="button" class="chip" data-cite="' + esc(id) + '">' + esc(id) + "</button>"; }).join("");
    var hz = f.hazards.map(function (h) { return '<span class="chip">' + esc(hazardLabel(h)) + "</span>"; }).join("");
    return '<li class="fitem"><div class="rank">' + (rank || "") + '</div><div>' +
      '<h3><button type="button" class="linkbtn" data-cite="' + esc(f.id) + '" style="color:inherit;text-decoration:none;text-align:left">' + esc(f.title) + "</button></h3>" +
      "<p>" + esc(S.audience === "crew" ? f.plain : f.text) + "</p>" +
      '<p class="act"><b>Do this:</b> ' + esc(f.action) + "</p>" +
      '<div class="meta"><button type="button" class="chip cite" data-cite="' + esc(f.id) + '">' + esc(f.id) + "</button>" +
      (score != null ? '<span class="chip num">Score ' + Math.round(score) + "</span>" : "") + hz + exps + "</div></div></li>";
  }

  function openFinding(id) {
    var f = FF.FINDINGS.find(function (x) { return x.id === id; }); if (!f) return;
    var s = E.scoreFinding(f, S.weights, mission().tag);
    var inc = f.incident ? FF.INCIDENTS.find(function (i) { return i.id === f.incident; }) : null;
    openDrawer('<p class="eyebrow">Finding ' + esc(f.id) + '</p><h2 id="drawer-title">' + esc(f.title) + "</h2>" +
      '<div class="stack"><p>' + esc(f.text) + '</p><p class="muted">' + esc(f.plain) + "</p>" +
      '<div class="callout info"><b>Design implication:</b> ' + esc(f.action) + "</div>" +
      (inc ? '<div class="callout"><b>' + esc(inc.name) + " (" + inc.year + "):</b> " + esc(inc.text) + "</div>" : "") +
      "<h3>Score for " + esc(mission().label) + ": " + Math.round(s.total) + " / 100</h3>" +
      '<div class="rbars">' + rankBar({ f: f, total: s.total, parts: s.parts }, false) + "</div>" + criteriaLegend() +
      '<dl class="kv"><dt>Hazards</dt><dd>' + f.hazards.map(hazardLabel).map(esc).join(", ") + "</dd><dt>Conditions</dt><dd>" + f.regimes.map(regimeLabel).map(esc).join(", ") +
      "</dd><dt>Ratings</dt><dd>Impact " + f.impact + "/5 · Evidence " + f.evidence + "/5 · Novelty " + f.novelty + "/5 · Actionability " + f.action_s + "/5</dd>" +
      "<dt>Mission fit</dt><dd>ISS " + f.rel[0] + "/3 · Transit " + f.rel[1] + "/3 · Moon " + f.rel[2] + "/3 · Mars " + f.rel[3] + "/3</dd></dl>" +
      "<h3>Source experiments</h3><div class=\"row\">" + f.exp.map(function (x) { return '<button type="button" class="chip" data-cite="' + esc(x) + '">' + esc(x) + " · " + esc((E.byId(x) || {}).name || "") + "</button>"; }).join("") + "</div>" +
      '<div class="row"><button type="button" class="btn" id="d-ask">Ask FlameMind about this</button></div></div>');
    $("#d-ask").addEventListener("click", function () { closeDrawer(); askFromElsewhere("Explain finding [" + f.id + "] " + f.title + " and what it means for " + mission().label + "."); });
  }

  function openExperiment(id) {
    var e = E.byId(id); if (!e || !e.name) return;
    var fs = FF.FINDINGS.filter(function (f) { return f.exp.indexOf(id) >= 0; });
    var ntrs = "https://ntrs.nasa.gov/search?q=" + encodeURIComponent(e.name);
    openDrawer('<p class="eyebrow">' + esc(e.category) + " · " + esc(yrs(e)) + '</p><h2 id="drawer-title">' + esc(e.id) + "</h2><p><b>" + esc(e.name) + "</b></p>" +
      '<div class="stack"><p>' + esc(e.summary) + "</p>" +
      '<dl class="kv"><dt>Platform</dt><dd>' + esc(e.platform) + "</dd><dt>Facility</dt><dd>" + esc(e.facility) + "</dd><dt>Lead</dt><dd>" + esc(e.pi) +
      "</dd><dt>Fuels</dt><dd>" + esc(e.fuels) + "</dd><dt>Conditions</dt><dd>" + esc(e.conditions) + "</dd><dt>Status</dt><dd>" + esc(e.status) + "</dd></dl>" +
      "<h3>Findings from this work</h3>" + (fs.length ? '<ul class="flist">' + fs.map(function (f) { return findingBlock(f); }).join("") + "</ul>" : '<p class="muted">No ranked findings yet.</p>') +
      '<div class="row"><a class="btn" href="' + ntrs + '" target="_blank" rel="noopener noreferrer"><svg><use href="#i-ext"/></svg>Search NASA reports</a>' +
      '<button type="button" class="btn" id="d-ask">Ask FlameMind</button></div></div>');
    $("#d-ask").addEventListener("click", function () { closeDrawer(); askFromElsewhere("Summarize " + e.id + " (" + e.name + ") and its fire safety lessons for " + mission().label + "."); });
  }

  function openLive(it) {
    var dg = L.digest(it);
    openDrawer('<p class="eyebrow">' + esc(it.source === "ntrs" ? "NASA Technical Reports Server" : "OpenAlex · NASA-affiliated") + " · " + esc(it.date) + '</p><h2 id="drawer-title" style="font-size:22px">' + esc(it.title) + "</h2>" +
      '<div class="stack">' + (it.authors.length ? '<p class="muted small">' + esc(it.authors.join(", ")) + "</p>" : "") +
      (dg ? '<div class="callout info"><b>Key points (auto-extracted):</b> ' + esc(dg) + "</div>" : "") +
      (it.abstract ? "<p>" + esc(it.abstract) + "</p>" : '<p class="muted">No abstract available.</p>') +
      '<div class="row">' + it.cls.hazards.map(function (h) { return '<span class="chip">' + esc(hazardLabel(h)) + "</span>"; }).join("") + it.cls.regimes.map(function (r) { return '<span class="chip">' + esc(regimeLabel(r)) + "</span>"; }).join("") + "</div>" +
      '<div class="row">' + (it.url ? '<a class="btn" href="' + esc(it.url) + '" target="_blank" rel="noopener noreferrer"><svg><use href="#i-ext"/></svg>Open source</a>' : "") +
      '<button type="button" class="btn" id="d-ask">Ask FlameMind</button></div></div>');
    $("#d-ask").addEventListener("click", function () { closeDrawer(); askFromElsewhere("What does [" + it.uid + "] \"" + it.title + "\" mean for spacecraft fire safety?"); });
  }

  /* ---------- ranking visuals ---------- */
  var CRIT_COLORS = { impact: "var(--s1)", evidence: "var(--s2)", mission: "var(--s3)", action_s: "var(--s4)", novelty: "var(--s5)" };
  function criteriaLegend() {
    return '<div class="legend">' + E.CRITERIA.map(function (c) { return '<span><i style="background:' + CRIT_COLORS[c.id] + '"></i>' + esc(c.label) + "</span>"; }).join("") + "</div>";
  }
  function rankBar(x, clickable) {
    var tipTxt = x.f.title + "|" + E.CRITERIA.map(function (c) { return c.label + ": " + r1(x.parts[c.id]); }).join("|") + "|Total: " + Math.round(x.total);
    var segs = E.CRITERIA.map(function (c) {
      return x.parts[c.id] > 0.05 ? '<i class="seg-v" style="width:' + x.parts[c.id] + "%;background:" + CRIT_COLORS[c.id] + '"></i>' : "";
    }).join("");
    return '<div class="rbar" ' + (clickable ? 'tabindex="0" role="button" data-open="' + esc(x.f.id) + '"' : "") + ' data-tip="' + esc(tipTxt) + '">' +
      '<span class="lbl"><b>' + esc(x.f.id) + "</b>" + esc(x.f.title) + '</span><span class="track">' + segs + '</span><span class="val">' + Math.round(x.total) + "</span></div>";
  }

  /* ---------- views ---------- */
  var dirty = {};
  var R = {};

  R.briefing = function (el) {
    var m = mission(), ranked = E.rankFindings(S.weights, m.tag);
    var flights = FF.EXPERIMENTS.filter(function (e) { return !/ground/i.test(e.platform); });
    var minY = Math.min.apply(null, flights.map(function (e) { return e.years[0]; }));
    var yearAgo = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
    var recent = L.state.items.filter(function (it) { return it.date >= yearAgo; }).length;
    var screen = FF.MATERIALS.map(function (mat) {
      var a = E.assess({ o2: m.o2, p: m.p, g: m.g, flow: (m.flow[0] + m.flow[1]) / 2, material: mat.id }); return { mat: mat, a: a };
    }).sort(function (x, y) { return y.a.worstRisk - x.a.worstRisk; });
    var checks = load("ff.checks." + m.id, {}) || {};
    var acts = ranked.slice(0, 8);
    var done = acts.filter(function (x) { return checks[x.f.id]; }).length;

    el.innerHTML =
      '<div class="panel hero">' +
        '<div class="hero-copy"><p class="eyebrow">NASA Space Apps 2026 · Fire safety intelligence</p>' +
        "<h1>Fire behaves differently <em>in freefall</em></h1>" +
        '<p class="lede">Decades of NASA microgravity combustion experiments, summarized, ranked and interpreted into fire safety actions for <b>' + esc(m.label) + "</b>.</p>" +
        '<p class="small muted">' + esc(m.note) + "</p>" +
        '<div class="row"><a class="btn primary" href="#ask"><svg><use href="#i-ask"/></svg>Ask FlameMind</a><a class="btn" href="#envelope"><svg><use href="#i-env"/></svg>Check a material</a><a class="btn" href="#live"><svg><use href="#i-live"/></svg>Live NASA feed</a></div></div>' +
        '<div class="hero-stage"><canvas id="flame" aria-label="Animated candle flame changing shape with gravity" role="img"></canvas>' +
          '<p class="hero-cap">Candle flame shape vs gravity. In orbit (CFM on Mir) flames turn into dim blue spheres.</p>' +
          '<div class="hero-ctl"><div class="row"><label for="g-slider">Gravity</label><output id="g-out">0.00 g · orbit</output></div>' +
          '<input id="g-slider" type="range" min="0" max="1" step="0.01" value="0" aria-label="Gravity level for the flame animation"></div></div>' +
      "</div>" +
      '<div class="stats">' +
        stat("Experiments & campaigns", FF.EXPERIMENTS.length, "drop tower to Cygnus") +
        stat("Ranked findings", FF.FINDINGS.length, "scored for " + m.label.split(" (")[0]) +
        stat("Years of microgravity research", (FF.NOW_YEAR - minY), "since " + minY) +
        stat("New NASA papers, 12 months", L.state.items.length ? recent : "…", L.state.fetchedAt ? "updated " + ago(L.state.fetchedAt) : "loading live feed") +
      "</div>" +
      '<div class="grid">' +
        '<section class="panel span-7"><div class="panel-head"><div><h2>Top findings for ' + esc(m.label) + '</h2><p>Ranked by safety impact, evidence, mission fit, actionability and novelty.</p></div><a class="btn" href="#insights">All insights</a></div>' +
        '<ol class="flist">' + ranked.slice(0, 5).map(function (x, i) { return findingBlock(x.f, i + 1, x.total); }).join("") + "</ol></section>" +
        '<section class="panel span-5"><div class="panel-head"><div><h2>Material screen</h2><p>Worst-case flow, ' + esc(m.o2 + "% O₂, " + m.p + " kPa, " + m.g + " g") + ".</p></div></div>" +
        '<div class="table-wrap"><table class="screen-table"><thead><tr><th>Material</th><th>Risk</th><th class="num">Limit</th></tr></thead><tbody>' +
        screen.map(function (r) {
          return '<tr><td><button type="button" class="linkbtn" data-mat="' + r.mat.id + '" style="color:inherit;text-align:left">' + esc(r.mat.label) + "</button>" + (r.a.hidden ? ' <span class="chip" style="color:var(--crit)">passes 1 g, burns here</span>' : "") +
            '</td><td><span class="pill ' + r.a.worstBand.id + '">' + r.a.worstBand.label + '</span></td><td class="num">' + r1(r.a.worstLimit) + "%</td></tr>";
        }).join("") + '</tbody></table></div><p class="note" style="margin-top:8px">Screening model, illustrative values. Select a material to open it in Fire envelope.</p></section>' +
        '<section class="panel span-6"><div class="panel-head"><div><h2>Readiness checklist</h2><p>Actions from the top findings. Saved on this device.</p></div><span class="pill info">' + done + " of " + acts.length + " done</span></div><div>" +
        acts.map(function (x) {
          var on = !!checks[x.f.id];
          return '<label class="check' + (on ? " done" : "") + '"><input type="checkbox" id="chk-' + x.f.id + '" data-chk="' + x.f.id + '"' + (on ? " checked" : "") + "><span>" + esc(x.f.action) + ' <button type="button" class="chip cite" data-cite="' + x.f.id + '">' + x.f.id + "</button></span></label>";
        }).join("") + "</div></section>" +
        '<section class="panel span-6"><div class="panel-head"><div><h2>Latest from NASA</h2><p>Live from OpenAlex and the NASA Technical Reports Server.</p></div><a class="btn" href="#live">Open feed</a></div>' +
        '<ul class="feed" id="brief-feed">' + feedItems(L.state.items.slice(0, 4), true) + "</ul></section>" +
        '<section class="panel span-12"><div class="panel-head"><div><h2>Lessons from real incidents</h2><p>Operational events that shaped today\'s fire safety rules.</p></div></div>' +
        '<div class="incidents">' + FF.INCIDENTS.map(function (i) { return '<article class="card" style="cursor:default"><div class="top"><span class="id">' + esc(i.name) + '</span><span class="yrs">' + i.year + "</span></div><p style=\"-webkit-line-clamp:unset\">" + esc(i.text) + "</p></article>"; }).join("") + "</div></section>" +
      "</div>";

    el.querySelectorAll("[data-chk]").forEach(function (cb) {
      cb.addEventListener("change", function () {
        var c = load("ff.checks." + m.id, {}) || {}; c[cb.getAttribute("data-chk")] = cb.checked; save("ff.checks." + m.id, c);
        cb.closest(".check").classList.toggle("done", cb.checked);
        var n = Object.keys(c).filter(function (k) { return c[k] && acts.some(function (x) { return x.f.id === k; }); }).length;
        el.querySelector(".pill.info").textContent = n + " of " + acts.length + " done";
      });
    });
    el.querySelectorAll("[data-mat]").forEach(function (b) {
      b.addEventListener("click", function () {
        S.sim = { o2: m.o2, p: m.p, g: m.g, flow: E.worstFlow(FF.MATERIALS.find(function (x) { return x.id === b.getAttribute("data-mat"); }), m.g), material: b.getAttribute("data-mat") };
        S.sim.flow = Math.round(S.sim.flow * 10) / 10; persist(); dirty.envelope = true; location.hash = "envelope";
      });
    });
    bindFeed(el);
    startFlame();
  };
  function stat(label, value, sub) {
    return '<div class="stat"><span class="label">' + esc(label) + '</span><span class="value">' + esc(value) + '</span><span class="sub">' + esc(sub) + "</span></div>";
  }

  R.insights = function (el) {
    var m = mission(), ranked = E.rankFindings(S.weights, m.tag);
    var shown = S.hazardFilter ? ranked.filter(function (x) { return x.f.hazards.indexOf(S.hazardFilter) >= 0; }) : ranked;
    el.innerHTML =
      '<div class="view-head"><div><p class="eyebrow">Ranking</p><h1>Insights for ' + esc(m.label) + "</h1><p>Every finding gets a transparent score. Move the weights to reflect what your team values; the ranking updates instantly.</p></div>" +
      '<div class="row"><button type="button" class="btn" id="exp-csv">Download CSV</button><button type="button" class="btn" id="exp-json">Download JSON</button><button type="button" class="btn" id="exp-copy">Copy top 10</button></div></div>' +
      '<div class="grid">' +
        '<section class="panel span-4"><div class="panel-head"><div><h2>Weights</h2><p>Relative importance of each criterion.</p></div></div><div class="weights">' +
        E.CRITERIA.map(function (c) {
          return '<label class="weight" for="w-' + c.id + '"><span><i style="background:' + CRIT_COLORS[c.id] + '"></i>' + esc(c.label) + '</span><input type="range" id="w-' + c.id + '" min="0" max="50" step="1" value="' + S.weights[c.id] + '" data-w="' + c.id + '"><output class="num" id="wo-' + c.id + '">' + S.weights[c.id] + "</output></label>";
        }).join("") +
        '</div><p class="eyebrow" style="margin-top:16px">Presets</p><div class="presets" style="margin-top:8px">' +
        [["balanced", "Balanced"], ["safety", "Safety first"], ["evidence", "Evidence first"], ["frontier", "Frontier science"]].map(function (p) { return '<button type="button" class="chip" data-preset="' + p[0] + '">' + p[1] + "</button>"; }).join("") +
        '</div><p class="note" style="margin-top:14px">Score = Σ weight × normalized rating ÷ Σ weights, on a 0–100 scale. Ratings are editorial and documented in Data &amp; method.</p></section>' +
        '<section class="panel span-8"><div class="panel-head"><div><h2>Top 12 by score</h2><p>Bar segments show how much each criterion contributes.</p></div>' + criteriaLegend() + '</div><div class="rbars" id="rbars">' +
        ranked.slice(0, 12).map(function (x) { return rankBar(x, true); }).join("") + "</div></section>" +
        '<section class="panel span-12"><div class="panel-head"><div><h2>All findings</h2><p id="ins-count">' + shown.length + " of " + ranked.length + ' shown.</p></div><div class="row"><label class="sr" for="hz-filter">Filter by hazard</label><select id="hz-filter"><option value="">All hazards</option>' +
        FF.HAZARDS.map(function (h) { return '<option value="' + h.id + '"' + (S.hazardFilter === h.id ? " selected" : "") + ">" + esc(h.label) + "</option>"; }).join("") + "</select></div></div>" +
        '<ol class="flist" id="ins-list">' + shown.map(function (x) { return findingBlock(x.f, ranked.indexOf(x) + 1, x.total); }).join("") + "</ol></section>" +
      "</div>";
    C.bindTips($("#rbars", el));
    // One delegated handler survives every redraw of the bars.
    var bars = $("#rbars", el);
    bars.addEventListener("click", function (e) { var b = e.target.closest("[data-open]"); if (b) openFinding(b.getAttribute("data-open")); });
    bars.addEventListener("keydown", function (e) { var b = e.target.closest("[data-open]"); if (b && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openFinding(b.getAttribute("data-open")); } });
    // Redraw only the ranked parts, so sliders and selects keep keyboard focus.
    function refresh(withList) {
      var rk = E.rankFindings(S.weights, m.tag);
      bars.innerHTML = rk.slice(0, 12).map(function (x) { return rankBar(x, true); }).join("");
      if (withList) {
        var sh = S.hazardFilter ? rk.filter(function (x) { return x.f.hazards.indexOf(S.hazardFilter) >= 0; }) : rk;
        $("#ins-list", el).innerHTML = sh.map(function (x) { return findingBlock(x.f, rk.indexOf(x) + 1, x.total); }).join("");
        $("#ins-count", el).textContent = sh.length + " of " + rk.length + " shown.";
      }
      persist(); dirty.briefing = true;
    }
    function syncSliders() {
      E.CRITERIA.forEach(function (c) { $("#w-" + c.id, el).value = S.weights[c.id]; $("#wo-" + c.id, el).textContent = S.weights[c.id]; });
    }
    var raf = 0;
    el.querySelectorAll("[data-w]").forEach(function (inp) {
      inp.addEventListener("input", function () {
        S.weights[inp.getAttribute("data-w")] = +inp.value; $("#wo-" + inp.getAttribute("data-w"), el).textContent = inp.value;
        cancelAnimationFrame(raf); raf = requestAnimationFrame(function () { refresh(false); });
      });
      inp.addEventListener("change", function () { refresh(true); });
    });
    var PRESETS = { balanced: DEFAULT_W, safety: { impact: 45, evidence: 20, mission: 20, action_s: 15, novelty: 0 },
      evidence: { impact: 20, evidence: 45, mission: 15, action_s: 15, novelty: 5 }, frontier: { impact: 15, evidence: 10, mission: 15, action_s: 10, novelty: 50 } };
    el.querySelectorAll("[data-preset]").forEach(function (b) {
      b.addEventListener("click", function () { S.weights = Object.assign({}, PRESETS[b.getAttribute("data-preset")]); syncSliders(); refresh(true); toast("Weights set: " + b.textContent); });
    });
    $("#hz-filter", el).addEventListener("change", function (e) { S.hazardFilter = e.target.value; refresh(true); });
    function rows() {
      return E.rankFindings(S.weights, m.tag).map(function (x, i) {
        return { rank: i + 1, id: x.f.id, score: Math.round(x.total), title: x.f.title, finding: x.f.text, action: x.f.action, hazards: x.f.hazards.join("; "), experiments: x.f.exp.join("; "), evidence: x.f.evidence, mission: m.label };
      });
    }
    $("#exp-json", el).addEventListener("click", function () { download("flame-in-freefall-insights-" + m.id + ".json", JSON.stringify(rows(), null, 2), "application/json"); });
    $("#exp-csv", el).addEventListener("click", function () {
      var rs = rows(), keys = Object.keys(rs[0]);
      var q = function (v) { v = String(v).replace(/"/g, '""'); return /[",\n]/.test(v) || /^[=+\-@]/.test(v) ? '"' + (/^[=+\-@]/.test(v) ? "'" : "") + v + '"' : v; };
      download("flame-in-freefall-insights-" + m.id + ".csv", [keys.join(",")].concat(rs.map(function (r) { return keys.map(function (k) { return q(r[k]); }).join(","); })).join("\n"), "text/csv");
    });
    $("#exp-copy", el).addEventListener("click", function () {
      copy(rows().slice(0, 10).map(function (r) { return r.rank + ". " + r.title + " (" + r.score + "): " + r.action + " [" + r.id + "]"; }).join("\n"), "Top 10");
    });
  };

  R.experiments = function (el) {
    var cats = Array.from(new Set(FF.EXPERIMENTS.map(function (e) { return e.category; }))).sort();
    var plats = ["Drop tower", "Sounding rocket", "Space Shuttle", "Mir", "ISS", "Cygnus", "Aircraft", "Ground"];
    var f = S.expFilter;
    el.innerHTML =
      '<div class="view-head"><div><p class="eyebrow">Evidence base</p><h1>Experiments</h1><p>' + FF.EXPERIMENTS.length + " investigations from drop towers to orbiting cargo ships. Select any bar or card for details, or tick up to three to compare.</p></div></div>" +
      '<section class="panel"><div class="panel-head"><div><h2>Timeline by platform</h2><p>Bars span active years. Highlighted bars match your filters.</p></div></div><div class="chart" id="tl"></div></section>' +
      '<div class="filters"><label class="sr" for="ex-q">Search experiments</label><input type="search" id="ex-q" placeholder="Search by name, fuel, finding…" value="' + esc(f.q) + '">' +
      sel("ex-cat", "Category", "All categories", cats, f.category) + sel("ex-plat", "Platform", "All platforms", plats, f.platform) +
      '<label class="sr" for="ex-reg">Conditions</label><select id="ex-reg"><option value="">All conditions</option>' + FF.REGIMES.map(function (r) { return '<option value="' + r.id + '"' + (f.regime === r.id ? " selected" : "") + ">" + esc(r.label) + "</option>"; }).join("") + "</select></div>" +
      '<p class="muted small" id="ex-count"></p><div class="cards" id="ex-cards"></div><div id="cmp-slot"></div>';
    function sel(id, label, all, opts, v) {
      return '<label class="sr" for="' + id + '">' + label + '</label><select id="' + id + '"><option value="">' + all + "</option>" +
        opts.map(function (o) { return '<option' + (v === o ? " selected" : "") + ">" + esc(o) + "</option>"; }).join("") + "</select>";
    }
    function matches(e) {
      if (f.category && e.category !== f.category) return false;
      if (f.platform && e.platform.toLowerCase().indexOf(f.platform.toLowerCase()) < 0) return false;
      if (f.regime && e.regimes.indexOf(f.regime) < 0) return false;
      return true;
    }
    function update() {
      var list = FF.EXPERIMENTS.filter(matches);
      if (f.q.trim()) {
        // Keep only strong matches: common words like "flame" match almost every record.
        var hits = E.retrieve(f.q, 60), ids = new Set(), top = hits.length ? hits[0].score : 0;
        hits.filter(function (h) { return h.score >= top * 0.4; }).forEach(function (h) {
          if (h.doc.kind === "experiment") ids.add(h.doc.id);
          if (h.doc.kind === "finding") h.doc.ref.exp.forEach(function (x) { ids.add(x); });
        });
        var order = Array.from(ids);
        list = list.filter(function (e) { return ids.has(e.id); }).sort(function (a, b) { return order.indexOf(a.id) - order.indexOf(b.id); });
      }
      var on = new Set(list.map(function (e) { return e.id; }));
      C.timeline($("#tl", el), FF.EXPERIMENTS, { selected: S.compare, colorFor: function (e) { return on.has(e.id) ? "var(--accent)" : "var(--line-2)"; }, onPick: openExperiment });
      C.bindTips($("#tl", el));
      $("#ex-count", el).textContent = list.length + " of " + FF.EXPERIMENTS.length + " experiments";
      $("#ex-cards", el).innerHTML = list.length ? list.map(function (e) {
        var n = FF.FINDINGS.filter(function (x) { return x.exp.indexOf(e.id) >= 0; }).length, c = S.compare.indexOf(e.id) >= 0;
        return '<article class="card" data-exp="' + esc(e.id) + '"><div class="top"><span class="id">' + esc(e.id) + '</span><span class="yrs">' + esc(yrs(e)) + (e.ongoing ? " · ongoing" : "") + "</span></div>" +
          '<h3><button type="button" class="linkbtn" data-open-exp="' + esc(e.id) + '" style="color:inherit;text-decoration:none;text-align:left">' + esc(e.name) + "</button></h3><p>" + esc(e.summary) + '</p><div class="row"><span class="chip">' + esc(e.platform) + '</span><span class="chip">' + esc(e.category) + "</span>" + (n ? '<span class="chip">' + n + " finding" + (n > 1 ? "s" : "") + "</span>" : "") +
          '<label class="cmp"><input type="checkbox" id="cmp-' + esc(e.id) + '" data-cmp="' + esc(e.id) + '"' + (c ? " checked" : "") + ">Compare</label></div></article>";
      }).join("") : '<p class="muted">No experiments match. Clear a filter or try a broader search.</p>';
      $("#ex-cards", el).querySelectorAll("[data-exp]").forEach(function (card) {
        // The title button is the keyboard and screen-reader target; the whole card is a larger pointer target.
        card.addEventListener("click", function (ev) { if (ev.target.closest(".cmp")) return; openExperiment(card.getAttribute("data-exp")); });
      });
      $("#ex-cards", el).querySelectorAll("[data-cmp]").forEach(function (cb) {
        cb.addEventListener("change", function () {
          var id = cb.getAttribute("data-cmp");
          if (cb.checked) { if (S.compare.length >= 3) { cb.checked = false; toast("Compare up to three experiments."); return; } S.compare.push(id); }
          else S.compare = S.compare.filter(function (x) { return x !== id; });
          cmpBar(); update();
        });
      });
    }
    function cmpBar() {
      var slot = $("#cmp-slot", el);
      slot.innerHTML = S.compare.length ? '<div class="compare-bar"><span>Comparing <b>' + S.compare.map(esc).join(", ") + '</b></span><div class="row"><button type="button" class="btn" id="cmp-clear">Clear</button><button type="button" class="btn primary" id="cmp-go"' + (S.compare.length < 2 ? " disabled" : "") + ">Compare " + S.compare.length + "</button></div></div>" : "";
      if (!S.compare.length) return;
      $("#cmp-clear", el).addEventListener("click", function () { S.compare = []; cmpBar(); update(); });
      $("#cmp-go", el).addEventListener("click", openCompare);
    }
    var t = 0;
    $("#ex-q", el).addEventListener("input", function (e) { f.q = e.target.value; clearTimeout(t); t = setTimeout(update, 120); });
    $("#ex-cat", el).addEventListener("change", function (e) { f.category = e.target.value; update(); });
    $("#ex-plat", el).addEventListener("change", function (e) { f.platform = e.target.value; update(); });
    $("#ex-reg", el).addEventListener("change", function (e) { f.regime = e.target.value; update(); });
    update(); cmpBar();
  };
  function openCompare() {
    var es = S.compare.map(function (id) { return E.byId(id); });
    var rows = [["Years", function (e) { return yrs(e); }], ["Platform", function (e) { return e.platform; }], ["Category", function (e) { return e.category; }],
      ["Fuels", function (e) { return e.fuels; }], ["Conditions", function (e) { return e.conditions; }], ["Lead", function (e) { return e.pi; }],
      ["Hazards informed", function (e) { var s = new Set(); FF.FINDINGS.forEach(function (f) { if (f.exp.indexOf(e.id) >= 0) f.hazards.forEach(function (h) { s.add(hazardLabel(h)); }); }); return Array.from(s).join(", ") || "None ranked"; }],
      ["Key finding", function (e) { var f = FF.FINDINGS.find(function (x) { return x.exp.indexOf(e.id) >= 0; }); return f ? f.title : "None ranked"; }]];
    openDrawer('<p class="eyebrow">Side-by-side</p><h2 id="drawer-title">Compare experiments</h2><div class="table-wrap"><table><thead><tr><th></th>' + es.map(function (e) { return "<th>" + esc(e.id) + "</th>"; }).join("") + "</tr></thead><tbody>" +
      rows.map(function (r) { return "<tr><th>" + esc(r[0]) + "</th>" + es.map(function (e) { return "<td>" + esc(r[1](e)) + "</td>"; }).join("") + "</tr>"; }).join("") + "</tbody></table></div>" +
      '<div class="row"><button type="button" class="btn" id="d-ask">Ask FlameMind to compare</button></div>');
    $("#d-ask").addEventListener("click", function () { closeDrawer(); askFromElsewhere("Compare " + S.compare.join(" vs ")); });
  }

  R.envelope = function (el) {
    var s = S.sim, m = mission();
    el.innerHTML =
      '<div class="view-head"><div><p class="eyebrow">Screening model</p><h1>Fire envelope</h1><p>Set the cabin atmosphere, gravity and ventilation, and see whether a material can sustain flame spread. Based on the flammability trends NASA measured in flight; values are illustrative.</p></div></div>' +
      '<div class="grid">' +
        '<section class="panel span-4"><div class="panel-head"><div><h2>Scenario</h2><p>Start from a mission, then adjust.</p></div></div><div class="sim-ctl">' +
          '<div class="presets">' + FF.MISSIONS.map(function (mm) { return '<button type="button" class="chip" data-mpreset="' + mm.id + '">' + esc(mm.label.split(" (")[0]) + "</button>"; }).join("") + "</div>" +
          '<label for="sim-mat">Material<select id="sim-mat">' + FF.MATERIALS.map(function (mt) { return '<option value="' + mt.id + '"' + (mt.id === s.material ? " selected" : "") + ">" + esc(mt.label) + "</option>"; }).join("") + "</select></label>" +
          slider("o2", "Oxygen", 10, 50, 0.5, s.o2, "%") + slider("p", "Total pressure", 30, 110, 0.5, s.p, " kPa") + slider("g", "Gravity", 0, 1, 0.01, s.g, " g") +
          '<div class="presets">' + C.GLEVELS.map(function (g) { return '<button type="button" class="chip" data-g="' + g.g + '">' + esc(g.label) + "</button>"; }).join("") + "</div>" +
          slider("flow", "Forced flow (ventilation)", 0, 50, 0.5, s.flow, " cm/s") +
          '<p class="note">Partial pressure of O₂: <span class="num" id="ppo2"></span> kPa. Buoyant flow at this gravity: <span class="num" id="ub"></span> cm/s.</p>' +
        "</div></section>" +
        '<section class="panel span-8" id="verdict"></section>' +
        '<section class="panel span-7"><div class="panel-head"><div><h2>Flammability map</h2><p>Spread probability across oxygen and flow at the selected gravity and pressure. Hover for values.</p></div></div><div class="chart" id="heat"></div>' + C.heatLegend() + "</section>" +
        '<section class="panel span-5"><div class="panel-head"><div><h2>Why gravity matters</h2><p>Limiting oxygen vs flow at four gravity levels. Lower means more flammable.</p></div></div><div class="chart" id="gcurves"></div>' + C.gravityLegend() + "</section>" +
        '<section class="panel span-12"><div class="panel-head"><div><h2>All materials in this atmosphere</h2><p>Compared at your flow and at each material\'s most flammable flow.</p></div></div><div class="table-wrap" id="mtable"></div></section>' +
        '<section class="panel span-12"><details><summary>How the model works</summary><div class="stack small" style="margin-top:10px">' +
        modelDoc() +
        "<p>This captures the trends NASA measured (U-shaped boundary, more flammable at low flow and partial gravity, higher risk in enriched atmospheres) but its coefficients are illustrative. It is a teaching and screening tool, not a substitute for NASA-STD-6001 testing.</p></div></details></section>" +
      "</div>";
    function slider(k, label, min, max, step, v, unit) {
      return '<label for="sim-' + k + '"><span class="lab"><span>' + label + '</span><output id="out-' + k + '">' + (+v).toFixed(step < 0.1 ? 2 : 1) + unit + '</output></span><input type="range" id="sim-' + k + '" data-k="' + k + '" data-unit="' + unit + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + v + '"></label>';
    }
    var raf = 0;
    function update() {
      var a = E.assess(s), wf = a.worstFlow;
      $("#ppo2", el).textContent = r1(s.o2 / 100 * s.p); $("#ub", el).textContent = r1(a.ub);
      var color = { low: "var(--ok)", elevated: "var(--warn)", high: "var(--serious)", severe: "var(--crit)" }[a.band.id];
      $("#verdict", el).innerHTML = '<div class="verdict"><div class="panel-head" style="margin:0"><div><h2>' + esc(a.mat.label) + '</h2><p>At ' + r1(s.o2) + "% O₂, " + r1(s.p) + " kPa, " + s.g.toFixed(2) + " g, " + r1(s.flow) + ' cm/s</p></div><span class="pill ' + a.band.id + '">' + a.band.label + " risk</span></div>" +
        '<div class="big"><span class="num">' + pct(a.risk) + '</span><span class="muted">chance a flame spreads (model estimate)</span></div>' +
        '<div class="meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(a.risk * 100) + '" aria-label="Spread probability"><i style="width:' + Math.max(2, a.risk * 100) + "%;background:" + color + '"></i></div>' +
        '<div class="stats"><div class="stat"><span class="label">Limiting O₂ here</span><span class="value num">' + r1(a.limit) + '%</span><span class="sub">margin ' + (a.margin >= 0 ? "+" : "") + r1(a.margin) + " pts</span></div>" +
        '<div class="stat"><span class="label">Worst-case flow</span><span class="value num">' + r1(wf) + '</span><span class="sub">cm/s, limit ' + r1(a.worstLimit) + "%</span></div>" +
        '<div class="stat"><span class="label">1 g upward test limit</span><span class="value num">' + r1(a.testLimit) + '%</span><span class="sub">same atmosphere</span></div>' +
        '<div class="stat"><span class="label">Worst-case risk</span><span class="value num">' + pct(a.worstRisk) + '</span><span class="sub">' + a.worstBand.label + "</span></div></div>" +
        (a.hidden ? '<div class="callout"><b>Hidden-risk zone.</b> This material would pass a 1 g upward flammability screen in this atmosphere, yet it can burn here at a ventilation speed near ' + r1(wf) + " cm/s. This is the gap NASA's microgravity data exposed. <button type=\"button\" class=\"chip cite\" data-cite=\"F02\">F02</button> <button type=\"button\" class=\"chip cite\" data-cite=\"F03\">F03</button></div>" :
          '<div class="callout info">' + (a.margin < 0 ? "Below the limit at this flow. " + (a.worstRisk >= 0.5 ? "Careful: at " + r1(wf) + " cm/s the risk becomes " + a.worstBand.label.toLowerCase() + "." : "It stays below the limit at all flows in this atmosphere.") : "Above the limit: a flame can spread. Cutting ventilation toward zero is the most effective first response.") + ' <button type="button" class="chip cite" data-cite="F01">F01</button> <button type="button" class="chip cite" data-cite="F05">F05</button></div>') +
        '<div class="row"><button type="button" class="btn" id="sim-ask">Ask FlameMind about this scenario</button><button type="button" class="btn" id="sim-copy">Copy scenario</button></div></div>';
      $("#sim-ask", el).addEventListener("click", function () { askFromElsewhere(a.mat.label + " at " + r1(s.o2) + "% O2, " + r1(s.p) + " kPa, " + s.g.toFixed(2) + " g, " + r1(s.flow) + " cm/s"); });
      $("#sim-copy", el).addEventListener("click", function () { copy(a.mat.label + ": " + r1(s.o2) + "% O2, " + r1(s.p) + " kPa, " + s.g.toFixed(2) + " g, " + r1(s.flow) + " cm/s -> " + a.band.label + " risk (" + pct(a.risk) + "), limit " + r1(a.limit) + "%, worst-case flow " + r1(wf) + " cm/s", "Scenario"); });
      var mm = FF.MISSIONS.find(function (x) { return Math.abs(x.o2 - s.o2) < 0.01 && Math.abs(x.p - s.p) < 0.01 && Math.abs(x.g - s.g) < 0.001; });
      C.envelope($("#heat", el), s, mm || null);
      C.gravityCurves($("#gcurves", el), s);
      $("#mtable", el).innerHTML = "<table><thead><tr><th>Material</th><th class=\"num\">Limit at " + r1(s.flow) + ' cm/s</th><th>Risk</th><th class="num">Worst flow</th><th class="num">Worst limit</th><th>Worst risk</th><th>1 g screen</th></tr></thead><tbody>' +
        FF.MATERIALS.map(function (mt) {
          var b = E.assess({ o2: s.o2, p: s.p, g: s.g, flow: s.flow, material: mt.id });
          return '<tr><td>' + esc(mt.label) + '</td><td class="num">' + r1(b.limit) + '%</td><td><span class="pill ' + b.band.id + '">' + b.band.label + '</span></td><td class="num">' + r1(b.worstFlow) + ' cm/s</td><td class="num">' + r1(b.worstLimit) + '%</td><td><span class="pill ' + b.worstBand.id + '">' + b.worstBand.label + "</span></td><td>" +
            (s.o2 < b.testLimit ? (b.hidden ? '<span class="chip" style="color:var(--crit)">Passes, but burns in µg</span>' : "Passes") : "Fails") + "</td></tr>";
        }).join("") + "</tbody></table>";
    }
    el.querySelectorAll("input[data-k]").forEach(function (inp) {
      inp.addEventListener("input", function () {
        var k = inp.getAttribute("data-k"); s[k] = +inp.value;
        $("#out-" + k, el).textContent = (+inp.value).toFixed(k === "g" ? 2 : 1) + inp.getAttribute("data-unit");
        cancelAnimationFrame(raf); raf = requestAnimationFrame(update); persist();
      });
    });
    $("#sim-mat", el).addEventListener("change", function (e) { s.material = e.target.value; persist(); update(); });
    el.querySelectorAll("[data-g]").forEach(function (b) { b.addEventListener("click", function () { s.g = +b.getAttribute("data-g"); setInputs(); }); });
    el.querySelectorAll("[data-mpreset]").forEach(function (b) {
      b.addEventListener("click", function () {
        var mm = FF.MISSIONS.find(function (x) { return x.id === b.getAttribute("data-mpreset"); });
        s.o2 = mm.o2; s.p = mm.p; s.g = mm.g; s.flow = (mm.flow[0] + mm.flow[1]) / 2; setInputs(); toast("Loaded " + mm.label);
      });
    });
    function setInputs() {
      ["o2", "p", "g", "flow"].forEach(function (k) { var i = $("#sim-" + k, el); i.value = s[k]; $("#out-" + k, el).textContent = (+s[k]).toFixed(k === "g" ? 2 : 1) + i.getAttribute("data-unit"); });
      persist(); update();
    }
    update();
    redraws.envelope = update;
  };

  // Model explanation generated from the engine's constants, so the text can
  // never drift from what the code computes.
  function modelDoc() {
    var M = E.MODEL;
    return "<p>Effective flow combines ventilation with a buoyant velocity scale: u<sub>eff</sub> = max(" + M.uMin + " cm/s, √(u² + u<sub>b</sub>²)), with u<sub>b</sub> = " + M.ub1g + " cm/s × g<sup>1/3</sup>. " +
      "The limiting oxygen follows a U-shape in ln(u<sub>eff</sub>): lowest near " + M.uStarThin + " cm/s for thin fuels (" + M.uStarThick + " cm/s for thick), rising steeply at low flow (oxygen starvation and radiative loss, curvature " + M.aLow + " points per ln², " +
      '<button type="button" class="chip cite" data-cite="F01">F01</button> <button type="button" class="chip cite" data-cite="F04">F04</button>) and gently toward blowoff. ' +
      "The high-flow side is calibrated so quiescent 1 g at " + M.pRef + " kPa returns each material's representative upward-spread limit, with a microgravity reduction based on " +
      '<button type="button" class="chip cite" data-cite="F02">F02</button>. Lower pressure raises the limit by ' + M.kP + " points × ln(" + M.pRef + " kPa ÷ P) at fixed oxygen fraction. " +
      "Spread probability is a logistic function of the oxygen margin with a width of " + M.width + " points.</p>";
  }

  /* ---------- Ask FlameMind ---------- */
  var cloud = { key: null, remember: false, sdk: null, ctl: null };
  (function () {
    try { cloud.key = sessionStorage.getItem("ff.k") || null; } catch (e) { /* ignore */ }
    if (!cloud.key) { try { cloud.key = localStorage.getItem("ff.k") || null; cloud.remember = !!cloud.key; } catch (e) { /* ignore */ } }
  })();
  function setKey(k, remember) {
    cloud.key = k || null; cloud.remember = !!remember;
    try { sessionStorage.removeItem("ff.k"); localStorage.removeItem("ff.k"); } catch (e) { /* ignore */ }
    if (k) { try { (remember ? localStorage : sessionStorage).setItem("ff.k", k); } catch (e) { /* ignore */ } }
  }

  var SYSTEM = "You are FlameMind, an analyst inside a NASA Space Apps dashboard about microgravity combustion and spacecraft fire safety. " +
    "Answer using the CONTEXT records provided with each question. Cite records inline with their IDs in square brackets exactly as written, for example [F02] or [NTRS-20260000641]. " +
    "If the context does not support a claim, say so plainly rather than guessing, and mark general background knowledge as such. " +
    "Write for the stated audience. Use short paragraphs and '- ' bullets, **bold** for key terms, no headings and no tables. Keep answers under about 250 words unless asked for more. " +
    "Finish with one line starting 'Confidence:' (High, Medium or Low) and a short reason. Never present screening-model numbers as certified test results.";

  function cloudAsk(question, onText, signal) {
    var mm = mission();
    var pack = E.contextPack(question, ctx());
    var hist = S.chat.filter(function (t) { return t.final; });
    if (hist.length && hist[hist.length - 1].role === "user") hist = hist.slice(0, -1);   // the question being asked goes in below, with its evidence
    var turns = hist.slice(-6).map(function (t) { return { role: t.role, content: t.text }; });
    while (turns.length && turns[0].role !== "user") turns.shift();
    var userMsg = "Mission: " + mm.label + " (" + mm.note + ")\nAudience: " + (S.audience === "crew" ? "crew and general public, plain language" : "engineers and scientists") +
      "\n\nCONTEXT:\n" + pack + "\n\nQUESTION: " + question;
    var messages = turns.concat([{ role: "user", content: userMsg }]);
    var load = cloud.sdk ? Promise.resolve(cloud.sdk) : import(SDK_URL).then(function (mod) { cloud.sdk = mod; return mod; });
    return load.then(function (mod) {
      var Anthropic = mod.default || mod.Anthropic;
      var client = new Anthropic({ apiKey: cloud.key, dangerouslyAllowBrowser: true, maxRetries: 1 });
      function run(withFallback) {
        var body = { model: MODEL, max_tokens: 4000, output_config: { effort: "medium" }, system: SYSTEM, messages: messages };
        if (withFallback) { body.betas = ["server-side-fallback-2026-07-01"]; body.fallbacks = "default"; }
        var stream = client.beta.messages.stream(body, { signal: signal });
        stream.on("text", function (_d, snapshot) { onText(snapshot); });
        return stream.finalMessage();
      }
      return run(true).catch(function (err) {
        if (err && err.status === 400 && /fallback/i.test(String(err.message))) return run(false);
        throw err;
      }).then(function (msg) {
        if (msg.stop_reason === "refusal") { var e = new Error("Deep mode declined this request."); e.code = "refused"; throw e; }
        return msg.content.filter(function (b) { return b.type === "text"; }).map(function (b) { return b.text; }).join("");
      });
    });
  }
  function cloudError(err) {
    if (cloud.ctl && cloud.ctl.signal.aborted) return "Stopped.";
    var st = err && err.status;
    if (st === 401) return "The API key was rejected. Check it with the API key button above.";
    if (st === 403) return "This API key does not have access to the model.";
    if (st === 429) return "Rate limit reached on your API key. Try again in a minute.";
    if (st >= 500) return "The Anthropic API is temporarily unavailable.";
    if (err && err.code === "refused") return err.message;
    return "Could not reach the Anthropic API (" + ((err && err.message) || "network error") + ").";
  }

  function chatHTML(t) {
    if (t.role === "user") return '<div class="msg user"><div class="body">' + md(t.text).replace(/<button[^>]*data-cite="([^"]+)"[^>]*>[^<]*<\/button>/g, "[$1]") + "</div></div>";
    return '<div class="msg bot"><div class="who"><b>FlameMind</b><span class="chip">' + esc(t.engine) + "</span>" + (t.confidence ? '<span class="chip">Confidence: ' + esc(t.confidence) + "</span>" : "") + "</div>" +
      '<div class="body' + (t.final ? "" : " typing") + '">' + md(t.text || "Thinking…") + "</div>" + (t.note ? '<p class="note">' + esc(t.note) + "</p>" : "") + "</div>";
  }
  function welcome() {
    return { role: "assistant", final: true, engine: "On-device", text:
      "Ask me anything about how fire behaves in microgravity and what it means for **" + mission().label + "**.\n" +
      "- I rank and summarize NASA findings, compare experiments, find research gaps, and run screening scenarios such as \u201ccotton at 34% O2, 56 kPa, lunar gravity\u201d.\n" +
      "- Every claim links to its source: tap a citation chip to open it.\n" +
      "- **Instant** mode runs entirely on this device, even offline. **Deep** mode sends the same evidence to the Anthropic API with your own key for longer, conversational answers." };
  }
  R.ask = function (el) {
    if (!S.chat.length) S.chat.push(welcome());
    var deep = S.aiMode === "deep";
    el.innerHTML =
      '<div class="view-head"><div><p class="eyebrow">Evidence analyst</p><h1>Ask FlameMind</h1><p>Grounded answers with citations, tuned to your mission and audience.</p></div>' +
      '<div class="row"><div class="seg" role="group" aria-label="Answer mode"><button type="button" id="mode-instant" aria-pressed="' + !deep + '">Instant</button><button type="button" id="mode-deep" aria-pressed="' + deep + '">Deep</button></div>' +
      '<button type="button" class="btn" id="key-btn"><svg><use href="#i-key"/></svg>' + (cloud.key ? "API key set" : "Set API key") + "</button></div></div>" +
      '<section class="panel chat"><div class="msgs" id="msgs" aria-live="polite">' + S.chat.map(chatHTML).join("") + "</div>" +
      '<div class="composer"><div class="sugg">' + FF.SUGGESTED.map(function (q) { return '<button type="button" class="chip" data-q="' + esc(q) + '">' + esc(q) + "</button>"; }).join("") + "</div>" +
      '<form id="ask-form" autocomplete="off"><label class="sr" for="ask-input">Your question</label><textarea id="ask-input" rows="1" maxlength="2000" placeholder="Ask about flame spread, suppression, smoke, materials, or a scenario…"></textarea>' +
      '<button type="button" class="btn" id="ask-stop" hidden>Stop</button><button type="submit" class="btn primary" aria-label="Send"><svg><use href="#i-send"/></svg></button></form>' +
      '<p class="note">' + (deep ? "Deep mode sends your question and the cited evidence directly from your browser to the Anthropic API with your key." : "Instant mode runs on this device. Nothing leaves your browser.") + "</p></div></section>";
    var msgs = $("#msgs", el); msgs.scrollTop = msgs.scrollHeight;
    $("#mode-instant", el).addEventListener("click", function () { S.aiMode = "instant"; persist(); render("ask"); });
    $("#mode-deep", el).addEventListener("click", function () { if (!cloud.key) { keyDialog(true); return; } S.aiMode = "deep"; persist(); render("ask"); });
    $("#key-btn", el).addEventListener("click", function () { keyDialog(false); });
    el.querySelectorAll("[data-q]").forEach(function (b) { b.addEventListener("click", function () { send(b.getAttribute("data-q")); }); });
    var ta = $("#ask-input", el);
    ta.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#ask-form", el).requestSubmit ? $("#ask-form", el).requestSubmit() : send(ta.value); } });
    ta.addEventListener("input", function () { ta.style.height = "auto"; ta.style.height = Math.min(140, ta.scrollHeight) + "px"; });
    $("#ask-form", el).addEventListener("submit", function (e) { e.preventDefault(); send(ta.value); });
    $("#ask-stop", el).addEventListener("click", function () { if (cloud.ctl) cloud.ctl.abort(); });
  };
  var pendingAsk = null;
  function askFromElsewhere(q) { pendingAsk = q; if (S.view === "ask") { send(q); pendingAsk = null; } else location.hash = "ask"; }
  var busy = false;
  function send(q) {
    q = String(q || "").trim(); if (!q) return;
    if (busy) { toast("Still answering. Press Stop to ask something else."); return; }
    var input = $("#ask-input"); if (input) { input.value = ""; input.style.height = ""; }
    S.chat.push({ role: "user", text: q, final: true });
    var c = ctx(), local = E.answer(q, c);
    if (S.aiMode === "deep" && cloud.key && navigator.onLine) {
      var t = { role: "assistant", text: "", final: false, engine: "Deep · Anthropic API", confidence: null };
      S.chat.push(t); redrawChat(); busy = true; $("#ask-stop").hidden = false; $("#msgs").setAttribute("aria-busy", "true");
      cloud.ctl = new AbortController();
      var last = 0;
      cloudAsk(q, function (snap) { t.text = snap; var now = Date.now(); if (now - last > 60) { last = now; redrawLast(t); } }, cloud.ctl.signal)
        .then(function (text) {
          t.text = text; t.final = true;
          var m = text.match(/Confidence:\s*(High|Medium|Low)/i); if (m) t.confidence = m[1];
        })
        .catch(function (err) {
          t.final = true;
          if (cloud.ctl.signal.aborted) { t.note = t.text ? "Stopped early." : "Stopped before an answer arrived."; if (!t.text) t.text = "Stopped."; return; }
          t.note = cloudError(err) + " Showing the on-device answer instead.";
          t.engine = "On-device (fallback)"; t.text = local.md; t.confidence = local.confidence;
        })
        .then(function () { busy = false; var st = $("#ask-stop"); if (st) st.hidden = true; var mm = $("#msgs"); if (mm) mm.removeAttribute("aria-busy"); redrawChat(); });
    } else {
      S.chat.push({ role: "assistant", text: local.md, final: true, engine: S.aiMode === "deep" ? "On-device (offline)" : "On-device · instant", confidence: local.confidence,
        note: local.kind === "scenario" ? "Scenario loaded into Fire envelope." : null });
      if (local.kind === "scenario" && local.scenario) { S.sim = local.scenario; persist(); dirty.envelope = true; }
      redrawChat();
    }
  }
  function redrawChat() { var m = $("#msgs"); if (!m) return; m.innerHTML = S.chat.map(chatHTML).join(""); m.scrollTop = m.scrollHeight; }
  function redrawLast(t) {
    var m = $("#msgs"); if (!m) return;
    var last = m.lastElementChild; if (!last) return redrawChat();
    last.outerHTML = chatHTML(t); m.scrollTop = m.scrollHeight;
  }
  function keyDialog(enableAfter) {
    openDrawer('<p class="eyebrow">Deep analysis</p><h2 id="drawer-title">Connect Deep mode</h2><div class="stack">' +
      "<p>Deep mode sends your question and the matching NASA evidence to the Anthropic API for longer, conversational answers that cite the same sources.</p>" +
      '<div class="callout info"><b>Your key stays with you.</b> It is stored only in this browser and sent only to api.anthropic.com over HTTPS. There is no server in between. Use a key with a spending limit.</div>' +
      '<label for="key-in" class="small">Anthropic API key</label><input type="password" id="key-in" autocomplete="off" spellcheck="false" placeholder="sk-ant-…" value="' + esc(cloud.key || "") + '">' +
      '<label class="check" style="border:0"><input type="checkbox" id="key-rem"' + (cloud.remember ? " checked" : "") + "><span>Remember on this device (otherwise cleared when the tab closes)</span></label>" +
      '<div class="row"><button type="button" class="btn primary" id="key-save">Save key</button><button type="button" class="btn" id="key-clear">Remove key</button></div>' +
      '<p class="note">Without a key, Instant mode still answers every question on-device.</p></div>');
    $("#key-save").addEventListener("click", function () {
      var v = $("#key-in").value.trim();
      if (!/^sk-ant-[A-Za-z0-9_\-]{20,}$/.test(v)) { toast("That doesn't look like an Anthropic API key."); return; }
      setKey(v, $("#key-rem").checked); if (enableAfter) S.aiMode = "deep"; persist(); closeDrawer(); toast("Key saved"); render("ask");
    });
    $("#key-clear").addEventListener("click", function () { setKey(null); S.aiMode = "instant"; persist(); closeDrawer(); toast("Key removed"); render("ask"); });
  }

  /* ---------- live feed ---------- */
  function feedItems(items, compact) {
    if (!items.length) return '<li class="muted small">' + (L.state.fetchedAt ? "No items match." : "Loading the latest NASA research…") + "</li>";
    return items.map(function (it) {
      var bars = Math.round(it.cls.relevance * 5), meter = "";
      for (var i = 0; i < 5; i++) meter += "<i" + (i < bars ? ' class="on"' : "") + "></i>";
      var dg = compact ? "" : L.digest(it);
      return "<li>" + (it.isNew ? '<span class="new">New since you last opened the feed</span>' : "") +
        '<h3><a href="' + esc(it.url || "#") + '" target="_blank" rel="noopener noreferrer" data-live="' + esc(it.uid) + '">' + esc(it.title) + "</a></h3>" +
        '<div class="row small muted"><span class="num">' + esc(it.date) + "</span><span>" + esc(it.sourceLabel) + "</span>" + (it.cited ? "<span>" + it.cited + " citations</span>" : "") +
        '<span title="Fire-safety relevance" aria-label="Relevance ' + bars + ' of 5" class="relmeter">' + meter + "</span></div>" +
        (dg ? '<p class="digest">' + esc(dg) + "</p>" : "") +
        (compact ? "" : '<div class="row">' + it.cls.hazards.map(function (h) { return '<span class="chip">' + esc(hazardLabel(h)) + "</span>"; }).join("") +
          '<button type="button" class="chip" data-live-open="' + esc(it.uid) + '">Details</button><button type="button" class="chip" data-live-ask="' + esc(it.uid) + '">Ask FlameMind</button></div>') + "</li>";
    }).join("");
  }
  function bindFeed(root) {
    root.querySelectorAll("[data-live]").forEach(function (a) {
      a.addEventListener("click", function (e) { if (e.ctrlKey || e.metaKey) return; e.preventDefault(); var it = liveById(a.getAttribute("data-live")); if (it) openLive(it); });
    });
    root.querySelectorAll("[data-live-open]").forEach(function (b) { b.addEventListener("click", function () { var it = liveById(b.getAttribute("data-live-open")); if (it) openLive(it); }); });
    root.querySelectorAll("[data-live-ask]").forEach(function (b) {
      b.addEventListener("click", function () { var it = liveById(b.getAttribute("data-live-ask")); if (it) askFromElsewhere("What does [" + it.uid + "] \"" + it.title + "\" mean for spacecraft fire safety?"); });
    });
  }
  R.live = function (el) {
    var st = L.state, f = S.liveFilter, m = mission();
    var items = st.items.filter(function (it) {
      if (f.source !== "all" && it.source !== f.source) return false;
      if (f.hazard && it.cls.hazards.indexOf(f.hazard) < 0) return false;
      if (f.mine && it.cls.missions.indexOf(m.tag) < 0) return false;
      if (f.onlyNew && !it.isNew) return false;
      return true;
    });
    var byYear = {};
    st.items.forEach(function (it) { var y = it.date.slice(0, 4); if (y >= "2010") byYear[y] = (byYear[y] || 0) + 1; });
    var years = Object.keys(byYear).sort().map(function (y) { return { k: y, v: byYear[y] }; });
    el.innerHTML =
      '<div class="view-head"><div><p class="eyebrow">Always current</p><h1>Live NASA feed</h1><p>New NASA research on fire in space, fetched by your browser straight from NASA and open scholarly sources. FlameMind tags each item by hazard and mission and adds it to its evidence.</p></div>' +
      '<button type="button" class="btn" id="live-refresh"><svg><use href="#i-refresh"/></svg>Refresh now</button></div>' +
      '<div class="src-row">' + Object.keys(st.status).map(function (k) {
        var s = st.status[k], cls = s.state === "ok" ? "ok" : s.state === "err" ? "err" : s.state === "cached" ? "" : "wait";
        return '<div class="src"><b><span class="status-dot ' + cls + '"></span>' + esc(s.label) + '</b><span class="muted">' + esc(s.mode) + "</span><span>" +
          (s.state === "wait" ? "Checking…" : s.state === "err" ? "Unavailable now (" + esc(s.error || "error") + "), showing saved copy" : s.count + " items · updated " + ago(s.at)) + "</span></div>";
      }).join("") + "</div>" +
      '<div class="grid"><section class="panel span-8"><div class="panel-head"><div><h2>Latest research</h2><p>' + items.length + " of " + st.items.length + " items" + (st.newCount ? " · " + st.newCount + " new since you last opened the feed" : "") + "</p></div>" +
      '<div class="filters"><label class="sr" for="lf-src">Source</label><select id="lf-src"><option value="all">All sources</option><option value="ntrs"' + (f.source === "ntrs" ? " selected" : "") + '>NASA NTRS</option><option value="openalex"' + (f.source === "openalex" ? " selected" : "") + ">NASA-affiliated papers</option></select>" +
      '<label class="sr" for="lf-hz">Hazard</label><select id="lf-hz"><option value="">All hazards</option>' + FF.HAZARDS.map(function (h) { return '<option value="' + h.id + '"' + (f.hazard === h.id ? " selected" : "") + ">" + esc(h.label) + "</option>"; }).join("") + "</select>" +
      '<label class="chip"><input type="checkbox" id="lf-mine"' + (f.mine ? " checked" : "") + "> " + esc(m.label.split(" (")[0]) + ' only</label><label class="chip"><input type="checkbox" id="lf-new"' + (f.onlyNew ? " checked" : "") + "> New only</label></div></div>" +
      '<ul class="feed" id="live-list">' + feedItems(items.slice(0, f.show)) + "</ul>" +
      (items.length > f.show ? '<div class="row" style="margin-top:12px"><button type="button" class="btn" id="live-more">Show ' + Math.min(15, items.length - f.show) + " more of " + (items.length - f.show) + "</button></div>" : "") + "</section>" +
      '<div class="span-4 stack"><section class="panel"><div class="panel-head"><div><h2>Publications per year</h2><p>Items in the feed since 2010. Latest year highlighted.</p></div></div><div class="chart" id="live-years"></div></section>' +
      '<section class="panel"><div class="panel-head"><div><h2>What the new work covers</h2><p>Share of feed items tagged with each hazard.</p></div></div><div id="live-hz"></div></section></div>' +
      '<section class="panel span-12"><div class="panel-head"><div><h2>From the NASA image library</h2><p>Live search of images.nasa.gov for microgravity combustion.</p></div></div><div class="gallery">' +
      (st.images.length ? st.images.map(function (im) { return '<figure><a href="' + esc(im.page) + '" target="_blank" rel="noopener noreferrer"><img src="' + esc(im.thumb) + '" alt="' + esc(im.title) + '" loading="lazy" decoding="async" width="200" height="150"></a><figcaption>' + esc(im.title) + " · " + esc(im.date.slice(0, 4)) + "</figcaption></figure>"; }).join("") : '<p class="muted small">Images load when the NASA library responds.</p>') +
      "</div></section></div>";
    C.columns($("#live-years", el), years, "items");
    redraws.live = function () { C.columns($("#live-years", el), years, "items"); };
    var tot = Math.max(1, st.items.length);
    $("#live-hz", el).innerHTML = '<div class="rbars">' + FF.HAZARDS.map(function (h) {
      var n = st.items.filter(function (it) { return it.cls.hazards.indexOf(h.id) >= 0; }).length;
      return '<div class="rbar" style="grid-template-columns:minmax(0,130px) minmax(0,1fr) 40px;cursor:default" data-tip="' + esc(h.label + "|" + n + " of " + st.items.length + " items") + '"><span class="lbl">' + esc(h.label) + '</span><span class="track"><i class="seg-v" style="width:' + (n / tot * 100) + '%;background:var(--s1);border-radius:0 4px 4px 0"></i></span><span class="val">' + n + "</span></div>";
    }).join("") + "</div>";
    C.bindTips($("#live-hz", el));
    bindFeed(el);
    $("#live-refresh", el).addEventListener("click", function () { L.refresh(true).then(function () { toast("Feed refreshed"); }); render("live"); });
    $("#lf-src", el).addEventListener("change", function (e) { f.source = e.target.value; f.show = 15; render("live"); });
    $("#lf-hz", el).addEventListener("change", function (e) { f.hazard = e.target.value; f.show = 15; render("live"); });
    $("#lf-mine", el).addEventListener("change", function (e) { f.mine = e.target.checked; f.show = 15; render("live"); });
    $("#lf-new", el).addEventListener("change", function (e) { f.onlyNew = e.target.checked; f.show = 15; render("live"); });
    var more = $("#live-more", el);
    if (more) more.addEventListener("click", function () {
      var first = f.show; f.show += 15; render("live");
      var next = $("#live-list", el).children[first]; if (next) { var a = next.querySelector("a"); if (a) a.focus(); }
    });
    if (st.fetchedAt) setTimeout(L.markSeen, 4000);
  };

  /* ---------- gaps ---------- */
  var COV = ["var(--c0)", "var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)"];
  R.gaps = function (el) {
    var m = mission(), cells = E.coverage(m.tag, L.state.items);
    var top = cells.slice().sort(function (a, b) { return b.gap - a.gap; }).slice(0, 5);
    var topSet = new Set(top.map(function (c) { return c.hazard.id + "|" + c.regime.id; }));
    var maxCov = Math.max.apply(null, cells.map(function (c) { return c.cov; }));
    var sel = S.gapSel ? cells.find(function (c) { return c.hazard.id + "|" + c.regime.id === S.gapSel; }) : top[0];
    function step(c) { return c.cov === 0 ? 0 : Math.min(4, 1 + Math.floor(c.cov / maxCov * 3.99)); }
    el.innerHTML =
      '<div class="view-head"><div><p class="eyebrow">What we still don\'t know</p><h1>Research gaps</h1><p>Each cell shows how much evidence covers a hazard under a set of conditions, weighted by evidence strength. Gaps are ranked by importance to ' + esc(m.label) + " and by how thin the evidence is.</p></div></div>" +
      '<div class="grid"><section class="panel span-7"><div class="panel-head"><div><h2>Evidence coverage</h2><p>Darker means more evidence. Select a cell for details.</p></div></div><div class="table-wrap" style="border:0"><div class="matrix" aria-label="Evidence coverage by hazard and condition">' +
      '<div class="h"></div>' + FF.REGIMES.map(function (r) { return '<div class="h">' + esc(r.short) + "</div>"; }).join("") +
      FF.HAZARDS.map(function (h) {
        return '<div class="rh">' + esc(h.label) + "</div>" + FF.REGIMES.map(function (r) {
          var c = cells.find(function (x) { return x.hazard.id === h.id && x.regime.id === r.id; }), key = h.id + "|" + r.id;
          return '<button type="button" class="cell s' + step(c) + (topSet.has(key) ? " gap" : "") + '" aria-pressed="' + (sel === c) + '" aria-label="' + esc(h.label + ", " + r.label + ": " + c.ids.length + " findings" + (topSet.has(key) ? ", priority gap" : "")) + '" data-cell="' + key + '" style="background:' + COV[step(c)] + '" data-tip="' + esc(h.label + " · " + r.label + "|" + c.ids.length + " findings, coverage " + c.cov.toFixed(1) + "|" + c.live + " recent papers") + '">' + c.ids.length + "</button>";
        }).join("");
      }).join("") + '</div></div><div class="legend" style="margin-top:12px"><span><i style="background:var(--c0);border:1px solid var(--line-2)"></i>No evidence</span><span><i style="background:var(--c2)"></i>Some</span><span><i style="background:var(--c4)"></i>Strong</span><span><b style="color:var(--crit);font-size:10px">GAP</b> Top-5 priority gap</span></div></section>' +
      '<section class="panel span-5" id="gap-detail"></section>' +
      '<section class="panel span-12"><div class="panel-head"><div><h2>Priority research questions</h2><p>Generated from the five largest gaps for ' + esc(m.label) + ".</p></div></div><ol class=\"flist\">" +
      top.map(function (c, i) { return '<li class="fitem"><div class="rank">' + (i + 1) + "</div><div><h3>" + esc(question(c)) + '</h3><p class="small muted">' + esc(c.hazard.label + " · " + c.regime.label) + " · " + c.ids.length + " existing findings · " + c.live + " recent papers</p></div></li>"; }).join("") + "</ol></section></div>";
    function question(c) {
      var r = { "ug-air": "in long-duration microgravity", "ug-o2": "in enriched-oxygen, reduced-pressure cabins", partial: "at lunar and Martian gravity", ground: "in Earth-based qualification tests" }[c.regime.id];
      var q = { ignition: "Which ignition sources and energies start fires ", spread: "How fast do realistic fires grow and spread ", extinction: "What are the extinction limits of common cabin materials ",
        suppression: "Which suppression agents and doses reliably put out fires ", smoke: "How much smoke and soot do burning materials produce ", detection: "Which sensors detect early fire signatures reliably ",
        toxicity: "What toxic products form and how quickly can they be cleaned up " }[c.hazard.id];
      return q + r + "?";
    }
    function detail() {
      var c = sel, fs = c.ids.map(function (id) { return FF.FINDINGS.find(function (f) { return f.id === id; }); });
      var lv = L.state.items.filter(function (it) { return it.cls.hazards.indexOf(c.hazard.id) >= 0 && it.cls.regimes.indexOf(c.regime.id) >= 0; }).slice(0, 4);
      $("#gap-detail", el).innerHTML = '<div class="panel-head"><div><p class="eyebrow">' + esc(c.regime.label) + "</p><h2>" + esc(c.hazard.label) + '</h2></div><span class="pill ' + (c.gap > 0.35 ? "severe" : c.gap > 0.2 ? "high" : c.gap > 0.1 ? "elevated" : "low") + '">Gap ' + Math.round(c.gap * 100) + "</span></div>" +
        '<div class="stack"><p class="small"><b>Research question:</b> ' + esc(question(c)) + "</p>" +
        (fs.length ? '<ul class="flist">' + fs.map(function (f) { return findingBlock(f); }).join("") + "</ul>" : '<p class="muted small">No ranked findings cover this combination yet.</p>') +
        (lv.length ? "<h3>Recent papers touching this cell</h3><ul class=\"feed\">" + feedItems(lv, true) + "</ul>" : "") + "</div>";
      bindFeed($("#gap-detail", el));
    }
    el.querySelectorAll("[data-cell]").forEach(function (b) {
      b.addEventListener("click", function () {
        S.gapSel = b.getAttribute("data-cell"); sel = cells.find(function (c) { return c.hazard.id + "|" + c.regime.id === S.gapSel; });
        el.querySelectorAll("[data-cell]").forEach(function (x) { x.setAttribute("aria-pressed", x === b); }); detail();
      });
    });
    C.bindTips(el.querySelector(".matrix"));
    detail();
  };

  /* ---------- data & method ---------- */
  R.data = function (el) {
    var imp = load("ff.imported", []) || [];
    el.innerHTML =
      '<div class="view-head"><div><p class="eyebrow">Transparency</p><h1>Data &amp; method</h1><p>Where the information comes from, how it is scored, and how to bring your own.</p></div></div>' +
      '<div class="grid">' +
      '<section class="panel span-6"><h2>Sources</h2><div class="stack small" style="margin-top:10px">' +
      "<p><b>Curated knowledge base.</b> " + FF.EXPERIMENTS.length + " NASA and partner investigations (" + Math.min.apply(null, FF.EXPERIMENTS.map(function (e) { return e.years[0]; })) + "–" + FF.NOW_YEAR + ") and " + BASE_FINDINGS.length + " findings distilled from public NASA summaries of SSCE, BASS, Saffire, FLEX, SOFBALL, LSP, SAME, MIST, ACME, FLARE, SoFIE and more, plus " + FF.INCIDENTS.length + " operational incidents.</p>" +
      '<p><b>Live, in your browser:</b> NASA-affiliated publications from <a href="https://openalex.org" target="_blank" rel="noopener noreferrer">OpenAlex</a> and imagery from the <a href="https://images.nasa.gov" target="_blank" rel="noopener noreferrer">NASA Image and Video Library</a>, requested directly by each visitor\'s browser.</p>' +
      '<p><b>Scheduled snapshot:</b> the <a href="https://ntrs.nasa.gov" target="_blank" rel="noopener noreferrer">NASA Technical Reports Server</a>, which does not accept browser requests, is fetched every 6 hours by an automated build on GitHub\'s servers and published with the site. No personal computer is involved.</p>' +
      '<p><b>Verify before use.</b> Ratings are editorial; screening values are illustrative. Check primary sources in NTRS before engineering decisions.</p></div></section>' +
      '<section class="panel span-6"><h2>How ranking works</h2><div class="stack small" style="margin-top:10px">' +
      "<p>Each finding is rated 1–5 on <b>safety impact</b>, <b>evidence strength</b> (flight duration, replication, scale), <b>novelty</b> and <b>actionability</b>, and 0–3 for relevance to ISS, transit, lunar and Martian missions.</p>" +
      "<p>Score = 100 × Σ wᵢ·nᵢ ÷ Σ wᵢ, where nᵢ is the rating normalized to 0–1 and wᵢ are the weights you set in Insights.</p>" +
      "<p><b>FlameMind</b> retrieves evidence with BM25 search and domain synonyms, detects intent (scenario, comparison, ranking, gaps, definitions) and composes answers that cite their sources. Deep mode sends the same retrieved evidence to the Anthropic API.</p>" +
      "<p><b>Research gaps.</b> Coverage of a hazard under a set of conditions is the sum of evidence ratings ÷ 5 of the findings that address it. Gap = mission importance × condition fit × e<sup>−coverage/1.2</sup>, where mission importance is the average mission relevance of findings about that hazard.</p>" +
      "<p><b>Live items</b> are tagged by hazard and condition with a keyword classifier and scored for fire-safety relevance; low-relevance items are filtered out.</p></div></section>" +
      '<section class="panel span-6"><h2>Bring your own findings</h2><div class="stack small" style="margin-top:10px"><p>Import a JSON array of findings (for example, from your team\'s literature review). They join the ranking, the gaps matrix and FlameMind\'s evidence on this device only.</p>' +
      '<details><summary>Expected format</summary><pre class="mono small" style="white-space:pre-wrap;overflow-x:auto">[{ "id": "U-1", "title": "…", "text": "…", "plain": "…", "action": "…",\n  "exp": ["BASS"], "hazards": ["spread"], "regimes": ["ug-air"],\n  "rel": [3,3,2,2], "impact": 4, "evidence": 3, "novelty": 3, "action_s": 4 }]</pre></details>' +
      '<div class="row"><input type="file" id="imp-file" accept="application/json,.json" class="sr"><label class="btn" for="imp-file">Choose JSON file</label><button type="button" class="btn" id="imp-clear"' + (imp.length ? "" : " disabled") + ">Remove imported (" + imp.length + ")</button></div>" +
      '<p class="note">Files are read locally and validated; nothing is uploaded. A new import replaces the previous one.</p></div></section>' +
      '<section class="panel span-6"><h2>Privacy, security and offline use</h2><div class="stack small" style="margin-top:10px">' +
      "<ul style=\"margin:0;padding-left:18px;display:grid;gap:6px\"><li>No accounts, cookies or analytics. Preferences stay in your browser.</li><li>App files and fonts come from this site. A strict Content Security Policy allows only NASA's image library and OpenAlex, plus jsDelivr (to load the API client) and the Anthropic API when you turn on Deep mode.</li><li>All external text is escaped before display; imported files are schema-checked.</li><li>Installable as an app and works offline with the last saved data.</li></ul></div></section>" +
      '<section class="panel span-12"><h2>Glossary</h2><dl class="kv gloss">' +
      FF.GLOSSARY.map(function (g) { return "<dt><b>" + esc(g.term) + "</b></dt><dd>" + esc(g.def) + "</dd>"; }).join("") + "</dl></section></div>";
    $("#imp-file", el).addEventListener("change", function (e) {
      var file = e.target.files[0]; e.target.value = ""; if (!file) return;
      if (file.size > 2e6) { toast("File too large (2 MB max)."); return; }
      file.text().then(function (txt) {
        var arr = JSON.parse(txt); if (!Array.isArray(arr)) throw new Error("Expected a JSON array");
        var seen = {}, clean = arr.slice(0, 500).map(function (f, i) { return sanitizeFinding(f, i); }).filter(Boolean);
        clean.forEach(function (f) { var base = f.id, k = 2; while (seen[f.id]) f.id = base + "-" + k++; seen[f.id] = 1; });   // unique IDs
        if (!clean.length) throw new Error("No valid findings");
        save("ff.imported", clean); applyImported(); Object.keys(R).forEach(function (k) { dirty[k] = true; }); render("data");
        toast("Imported " + clean.length + " findings");
      }).catch(function (err) { toast("Import failed: " + err.message); });
    });
    $("#imp-clear", el).addEventListener("click", function () { save("ff.imported", []); applyImported(); Object.keys(R).forEach(function (k) { dirty[k] = true; }); render("data"); toast("Imported findings removed"); });
  };
  function sanitizeFinding(f, i) {
    if (!f || typeof f !== "object") return null;
    var s = function (v, n) { return String(v == null ? "" : v).slice(0, n || 800); };
    var n = function (v, lo, hi, d) { v = Math.round(+v); return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
    var hz = FF.HAZARDS.map(function (h) { return h.id; }), rg = FF.REGIMES.map(function (r) { return r.id; });
    var title = s(f.title, 160), text = s(f.text);
    if (!title || !text) return null;
    var id = "U-" + (s(f.id || i + 1, 20).replace(/[^A-Za-z0-9-]/g, "").replace(/^U-/, "") || String(i + 1));
    return { id: id, title: title, text: text, plain: s(f.plain || f.text), action: s(f.action || "Review with the safety team."),
      exp: (Array.isArray(f.exp) ? f.exp : []).map(function (x) { return s(x, 20).toUpperCase(); }).filter(function (x) { return FF.EXPERIMENTS.some(function (e) { return e.id === x; }); }),
      hazards: (Array.isArray(f.hazards) ? f.hazards : []).filter(function (x) { return hz.indexOf(x) >= 0; }),
      regimes: (Array.isArray(f.regimes) ? f.regimes : []).filter(function (x) { return rg.indexOf(x) >= 0; }),
      rel: [0, 1, 2, 3].map(function (k) { return n(f.rel && f.rel[k], 0, 3, 1); }),
      impact: n(f.impact, 1, 5, 3), evidence: n(f.evidence, 1, 5, 2), novelty: n(f.novelty, 1, 5, 3), action_s: n(f.action_s, 1, 5, 3) };
  }

  /* ---------- hero flame ---------- */
  var flameRAF = 0, flameG = 0, flameVisible = true, flameIO = null, flameSize = null;
  function startFlame() {
    var cv = $("#flame"); if (!cv) return;
    var cx2 = cv.getContext("2d"), reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    var slider = $("#g-slider"), out = $("#g-out");
    slider.value = flameG;
    function label(g) { return g < 0.02 ? "orbit" : Math.abs(g - 0.166) < 0.03 ? "Moon" : Math.abs(g - 0.38) < 0.03 ? "Mars" : g > 0.97 ? "Earth" : "partial"; }
    function setOut() { out.textContent = (+flameG).toFixed(2) + " g · " + label(flameG); }
    setOut();
    slider.addEventListener("input", function () { flameG = +slider.value; setOut(); if (reduce) draw(0); });
    function size() {
      var dpr = Math.min(2, window.devicePixelRatio || 1), b = cv.getBoundingClientRect();
      cv.width = Math.max(1, b.width * dpr); cv.height = Math.max(1, b.height * dpr); cx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function draw(t) {
      var b = cv.getBoundingClientRect(), w = b.width, h = b.height, g = flameG, sg = Math.sqrt(g);
      cx2.clearRect(0, 0, w, h);
      var base = Math.min(w, h) * 0.15, el2 = 1 + 1.9 * sg, flick = g * (Math.sin(t * 0.011) * 0.06 + Math.sin(t * 0.0173) * 0.04 + Math.sin(t * 0.031) * 0.02);
      var cx = w / 2, cy = h * 0.5, sway = g * Math.sin(t * 0.0047) * base * 0.06;
      cx2.globalCompositeOperation = "lighter";
      // outer blue envelope
      layer(cx + sway, cy - (el2 - 1) * base * 0.55, base * 1.25, el2 * (1 + flick), [[0, "rgba(60,120,255,0.0)"], [0.55, "rgba(70,130,255," + (0.28 - 0.12 * sg) + ")"], [0.8, "rgba(40,90,220," + (0.22 - 0.1 * sg) + ")"], [1, "rgba(20,40,120,0)"]]);
      // sooty luminous core: weaker and smaller in microgravity
      var y = 0.15 + 0.85 * sg;
      layer(cx + sway * 1.4, cy - (el2 - 1) * base * 0.75 - base * 0.1 * sg, base * (0.55 + 0.25 * sg), el2 * 1.15 * (1 + flick * 1.5), [[0, "rgba(255,250,230," + (0.9 * y) + ")"], [0.35, "rgba(255,200,110," + (0.75 * y) + ")"], [0.75, "rgba(255,130,40," + (0.35 * y) + ")"], [1, "rgba(255,90,20,0)"]]);
      // blue base ring
      layer(cx, cy + base * 0.25, base * 0.7, 0.55, [[0, "rgba(120,170,255,0)"], [0.7, "rgba(110,160,255," + (0.35 - 0.1 * sg) + ")"], [1, "rgba(40,80,200,0)"]]);
      cx2.globalCompositeOperation = "source-over";
      cx2.strokeStyle = "rgba(30,30,30,0.9)"; cx2.lineWidth = 2.5; cx2.beginPath(); cx2.moveTo(cx, cy + base * 0.55); cx2.lineTo(cx, cy + base * 0.15); cx2.stroke();
      cx2.fillStyle = "rgba(220,225,235,0.14)"; cx2.fillRect(cx - base * 0.3, cy + base * 0.55, base * 0.6, Math.min(base * 1.1, h * 0.72 - cy - base * 0.55));
    }
    function layer(x, y, r, sy, stops) {
      cx2.save(); cx2.translate(x, y); cx2.scale(1, sy);
      var gr = cx2.createRadialGradient(0, 0, 0, 0, 0, r);
      stops.forEach(function (s) { gr.addColorStop(s[0], s[1]); });
      cx2.fillStyle = gr; cx2.beginPath(); cx2.arc(0, 0, r, 0, Math.PI * 2); cx2.fill(); cx2.restore();
    }
    cancelAnimationFrame(flameRAF);
    size(); flameSize = size;
    if (reduce) { draw(0); return; }
    function loop(t) { if (!document.getElementById("flame")) return; if (flameVisible && !document.hidden && S.view === "briefing") draw(t); flameRAF = requestAnimationFrame(loop); }
    flameRAF = requestAnimationFrame(loop);
    if ("IntersectionObserver" in window) {
      if (!flameIO) flameIO = new IntersectionObserver(function (en) { flameVisible = en[0].isIntersecting; });
      flameIO.disconnect(); flameIO.observe(cv);
    }
    flameSize = size;
  }

  /* ---------- routing ---------- */
  var VIEWS = ["briefing", "insights", "experiments", "envelope", "ask", "live", "gaps", "data"];
  var redraws = {}, staleSize = {};   // per-view chart redraw, and views whose charts predate a resize
  var rendered = {};
  function render(v) {
    var el = document.getElementById("view-" + v), act = document.activeElement;
    var keep = act && act.id && el.contains(act) ? act.id : null;
    redraws[v] = null;
    R[v](el); rendered[v] = true; dirty[v] = false;
    if (keep) { var again = document.getElementById(keep); if (again) again.focus({ preventScroll: true }); }
  }
  function route() {
    var v = (location.hash || "").replace("#", "");
    if (VIEWS.indexOf(v) < 0) {
      if (v && document.getElementById(v) && rendered[S.view]) return;   // in-page anchor such as the skip link
      v = rendered[S.view] ? S.view : "briefing";
    }
    var changed = S.view !== v; S.view = v;
    VIEWS.forEach(function (x) { document.getElementById("view-" + x).hidden = x !== v; });
    document.querySelectorAll("[data-view]").forEach(function (a) { if (a.tagName === "A") a.setAttribute("aria-current", a.getAttribute("data-view") === v ? "page" : "false"); });
    var more = $("#more-btn"); more.setAttribute("aria-current", ["experiments", "live", "gaps", "data"].indexOf(v) >= 0 ? "page" : "false");
    $("#more-sheet").hidden = true;
    if (!rendered[v] || dirty[v]) render(v);
    else if (staleSize[v] && redraws[v]) redraws[v]();
    staleSize[v] = false;
    if (v === "ask" && pendingAsk) { var q = pendingAsk; pendingAsk = null; send(q); }
    if (changed) { window.scrollTo(0, 0); var h = document.querySelector("#view-" + v + " h1"); document.title = (h ? h.textContent + " · " : "") + "Flame in Freefall"; $("#main").focus({ preventScroll: true }); }
    if (v === "live") { $("#live-dot").hidden = true; }
  }
  window.addEventListener("hashchange", route);

  /* ---------- top controls ---------- */
  function initTop() {
    var ms = $("#mission-select");
    ms.innerHTML = FF.MISSIONS.map(function (m) { return '<option value="' + m.id + '"' + (m.id === S.mission ? " selected" : "") + ">" + esc(m.label) + "</option>"; }).join("");
    ms.addEventListener("change", function () {
      S.mission = ms.value; persist();
      var m = mission(); S.sim = Object.assign({}, S.sim, { o2: m.o2, p: m.p, g: m.g });
      VIEWS.forEach(function (v) { dirty[v] = true; }); render(S.view); toast("Mission set: " + m.label);
    });
    function aud() { document.querySelectorAll("[data-audience]").forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-audience") === S.audience); }); }
    document.querySelectorAll("[data-audience]").forEach(function (b) {
      b.addEventListener("click", function () { S.audience = b.getAttribute("data-audience"); persist(); aud(); VIEWS.forEach(function (v) { dirty[v] = true; }); render(S.view); });
    });
    aud();
    var tb = $("#theme-btn");
    function isDark() { var t = document.documentElement.getAttribute("data-theme"); return t ? t === "dark" : !(window.matchMedia && matchMedia("(prefers-color-scheme: light)").matches); }
    function icon() {
      tb.innerHTML = '<svg><use href="#i-' + (isDark() ? "sun" : "moon") + '"/></svg>';
      tb.setAttribute("aria-label", isDark() ? "Switch to light theme" : "Switch to dark theme");
      document.querySelector('meta[name="theme-color"]').setAttribute("content", isDark() ? "#0a0d13" : "#f2f4f8");
    }
    if (window.matchMedia) { var mq = matchMedia("(prefers-color-scheme: light)"); if (mq.addEventListener) mq.addEventListener("change", icon); }
    tb.addEventListener("click", function () {
      var next = isDark() ? "light" : "dark"; document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("ff.theme", next); } catch (e) { /* ignore */ }
      icon();
    });
    icon();
    $("#more-btn").addEventListener("click", function () { $("#more-sheet").hidden = false; var a = $("#more-sheet a"); if (a) a.focus(); });
    $("#more-sheet").addEventListener("click", function (e) { if (e.target.id === "more-sheet" || e.target.closest("a, button")) $("#more-sheet").hidden = true; });
    $("#install-btn").addEventListener("click", openInstall);
    $("#install-btn-2").addEventListener("click", openInstall);
    // The rail sits below the top bar, whose height changes as controls wrap.
    var top = $(".topbar");
    function topH() { document.documentElement.style.setProperty("--topbar-h", top.offsetHeight + "px"); }
    topH();
    if ("ResizeObserver" in window) new ResizeObserver(topH).observe(top); else window.addEventListener("resize", topH);
    // Charts are drawn at their on-screen width; redraw them after a real resize or rotation.
    var lastW = window.innerWidth, rt = 0;
    window.addEventListener("resize", function () {
      clearTimeout(rt);
      rt = setTimeout(function () {
        if (flameSize && document.getElementById("flame")) flameSize();
        if (Math.abs(window.innerWidth - lastW) < 40) return;
        lastW = window.innerWidth;
        VIEWS.forEach(function (v) { staleSize[v] = true; });
        if (redraws[S.view]) { redraws[S.view](); staleSize[S.view] = false; }
      }, 180);
    }, { passive: true });
  }

  /* ---------- boot ---------- */
  applyImported();
  initTop();
  route();
  L.onChange(function (st) {
    if (st.newCount) { var d = $("#live-dot"); if (d && S.view !== "live") d.hidden = false; }
    ["briefing", "live", "gaps"].forEach(function (v) { dirty[v] = true; });
    if (S.view === "live") render("live");
    else if (S.view === "briefing") {
      var feed = $("#brief-feed"); if (feed) { feed.innerHTML = feedItems(st.items.slice(0, 4), true); bindFeed(feed); }
      var stats = document.querySelectorAll("#view-briefing .stat .value"), subs = document.querySelectorAll("#view-briefing .stat .sub");
      if (stats[3]) {
        var ya = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
        stats[3].textContent = st.items.filter(function (it) { return it.date >= ya; }).length;
        subs[3].textContent = st.fetchedAt ? "updated " + ago(st.fetchedAt) : "";
      }
      dirty.briefing = false;
    }
  });
  var idle = window.requestIdleCallback || function (f) { return setTimeout(f, 200); };
  idle(function () { L.refresh(false); });
  // Keep the feed fresh while the dashboard stays open.
  setInterval(function () { if (!document.hidden) L.refresh(false); }, 15 * 60 * 1000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) L.refresh(false); });

  /* ---------- install & offline ---------- */
  var OFFLINE_EDITION = !!window.FF_OFFLINE_EDITION || location.protocol === "file:";
  var inst = { prompt: null, installed: false, sw: null, edition: null };
  function standalone() { return (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true; }
  function offlineReady() { return OFFLINE_EDITION || !!(inst.sw && inst.sw.total && inst.sw.saved === inst.sw.total); }
  function device() {
    var ua = navigator.userAgent || "";
    var ios = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    return { ios: ios, android: /android/i.test(ua), firefox: /firefox|fxios/i.test(ua), samsung: /samsungbrowser/i.test(ua),
      macSafari: !ios && /safari/i.test(ua) && !/chrome|chromium|crios|edg|opr|firefox/i.test(ua) && /macintosh/i.test(ua) };
  }
  function syncInstallButton() {
    var b = $("#install-btn"), l = $("#install-label"), ready = offlineReady();
    b.classList.toggle("ready", ready);
    l.textContent = standalone() || inst.installed || OFFLINE_EDITION ? (ready ? "Offline ready" : "Saving for offline…") : "Install app";
    b.setAttribute("aria-label", l.textContent + ". Install and offline options");
  }
  function installSteps() {
    var d = device();
    if (inst.prompt) return "<p>Your browser can install it in one step.</p>";
    if (d.ios) return '<ol class="steps"><li>Open this page in <b>Safari</b> (or Chrome on iOS 16.4 and later).</li><li>Tap <b>Share</b> (the square with an arrow).</li><li>Tap <b>Add to Home Screen</b>, then <b>Add</b>.</li></ol>';
    if (d.android && d.firefox) return '<ol class="steps"><li>Open the browser menu (⋮).</li><li>Tap <b>Install</b> or <b>Add to Home screen</b>.</li></ol>';
    if (d.android) return '<ol class="steps"><li>Open the browser menu (⋮).</li><li>Tap <b>Install app</b> or <b>Add to Home screen</b>.</li></ol>';
    if (d.macSafari) return '<ol class="steps"><li>In Safari\'s menu bar choose <b>File</b>, then <b>Add to Dock</b>.</li></ol>';
    if (d.firefox) return "<p>Firefox on computers cannot install web apps. Use the offline edition below, or open this page in Chrome, Edge or Safari to install it.</p>";
    return '<ol class="steps"><li>Click the <b>install</b> icon at the right of the address bar,</li><li>or open the browser menu and choose <b>Install Flame in Freefall</b> (Chrome) or <b>Apps, Install this site as an app</b> (Edge).</li></ol>';
  }
  function statusItem(ok, text) { return '<li class="' + (ok ? "ok" : "") + '"><svg><use href="#i-' + (ok ? "check" : "offline") + '"/></svg><span>' + text + "</span></li>"; }
  function openInstall() {
    var installed = standalone() || inst.installed, ready = offlineReady(), st = L.state;
    var appLine = OFFLINE_EDITION ? "You are using the offline edition: the whole app is inside this one file." :
      !("serviceWorker" in navigator) ? "This browser cannot save the app for offline use. Use the offline edition below." :
      ready ? "App saved on this device (" + inst.sw.saved + " files)." : inst.sw ? "Saving app files: " + inst.sw.saved + " of " + inst.sw.total + ". Stay online for a moment." : "Preparing offline copy. Stay online for a moment.";
    var dataLine = st.fetchedAt ? "Latest NASA data saved " + ago(st.fetchedAt) + " (" + st.items.length + " papers and reports, " + st.images.length + " images)." : "NASA data not saved yet. It is saved automatically the first time the feed loads.";
    openDrawer('<p class="eyebrow">Works without internet</p><h2 id="drawer-title">Install for offline use</h2><div class="stack">' +
      "<p>Install Flame in Freefall once while online. After that it opens from your home screen, dock or app list and works fully in airplane mode, using the NASA data saved on your device. It refreshes itself whenever you are back online.</p>" +
      '<ul class="status-list">' + statusItem(ready, appLine) + statusItem(!!st.fetchedAt, dataLine) +
      statusItem(installed || OFFLINE_EDITION, installed ? "Installed on this device." : OFFLINE_EDITION ? "No installation needed for this file." : "Not installed yet.") + "</ul>" +
      (installed || OFFLINE_EDITION ? "" : "<h3>Install</h3>" + installSteps() + (inst.prompt ? '<div class="row"><button type="button" class="btn primary" id="do-install"><svg><use href="#i-install"/></svg>Install now</button></div>' : "")) +
      '<h3>Check it works</h3><ol class="steps"><li>Turn on airplane mode.</li><li>Open Flame in Freefall from your home screen or app list.</li><li>Everything except the live refresh and Deep mode keeps working.</li></ol>' +
      '<div class="row"><button type="button" class="btn" id="do-save"><svg><use href="#i-refresh"/></svg>Save latest NASA data now</button></div>' +
      (OFFLINE_EDITION ? "" : '<h3>Offline edition</h3><p class="small">A single file with the whole app and the latest NASA report snapshot inside. Save it to any computer, phone or USB stick and open it in a browser, no internet or installation needed. Good for browsers that cannot install apps.</p>' +
        '<div class="row" id="edition-row"><a class="btn" id="do-edition" href="flame-in-freefall-offline.html" download="flame-in-freefall-offline.html"><svg><use href="#i-install"/></svg>Download offline edition</a><span class="note" id="edition-note"></span></div>') +
      '<p class="note">Deep mode and the live feed need a connection; Instant answers, rankings, the fire envelope, gaps and all saved data do not.</p></div>');
    var di = $("#do-install");
    if (di) di.addEventListener("click", function () {
      var pr = inst.prompt; if (!pr) return;
      inst.prompt = null;
      pr.prompt();
      (pr.userChoice || Promise.resolve({})).then(function (c) { if (c.outcome === "accepted") { inst.installed = true; toast("Installing Flame in Freefall"); } syncInstallButton(); closeDrawer(); });
    });
    $("#do-save").addEventListener("click", function () {
      if (!navigator.onLine) { toast("You're offline. Your last saved data is in use."); return; }
      toast("Saving the latest NASA data…");
      L.refresh(true).then(function () { askStatus(); toast("Saved. Ready for offline use."); if (!$("#drawer").hidden && $("#do-save")) openInstall(); });
    });
    var ed = $("#do-edition");
    if (ed) {
      // The edition is generated when the site is published; say so when it is absent (local copies).
      if (inst.edition === null) {
        fetch("flame-in-freefall-offline.html", { method: "HEAD", cache: "no-store" }).then(function (r) { inst.edition = r.ok; }, function () { inst.edition = false; }).then(showEdition);
      } else showEdition();
    }
    function showEdition() {
      var e2 = $("#do-edition"), n2 = $("#edition-note"); if (!e2) return;
      if (!inst.edition) { e2.setAttribute("aria-disabled", "true"); e2.classList.add("disabled"); e2.removeAttribute("href"); n2.textContent = navigator.onLine ? "Available on the published site." : "Connect to the internet to download it."; }
    }
  }
  function askStatus() {
    if (!("serviceWorker" in navigator) || OFFLINE_EDITION) return;
    navigator.serviceWorker.ready.then(function (reg) { if (reg.active) reg.active.postMessage({ type: "status" }); });
  }
  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); inst.prompt = e; syncInstallButton(); });
  window.addEventListener("appinstalled", function () {
    inst.installed = true; inst.prompt = null; syncInstallButton();
    toast("Installed. It now opens from your home screen or app list, even offline.");
  });

  function netState() {
    var off = !navigator.onLine;
    $("#netbar").hidden = !off;
    if (off) $("#netbar-text").textContent = "You're offline. Everything still works with the data saved on this device" + (L.state.fetchedAt ? " (NASA data from " + ago(L.state.fetchedAt) + ")." : ".");
  }
  window.addEventListener("online", function () { netState(); L.refresh(false); });
  window.addEventListener("offline", netState);
  netState();
  syncInstallButton();

  if ("serviceWorker" in navigator && window.isSecureContext && !OFFLINE_EDITION) {
    var reloading = false;
    navigator.serviceWorker.addEventListener("message", function (e) {
      if (e.data && e.data.type === "status") {
        inst.sw = e.data; syncInstallButton();
        var dlg = $("#drawer"); if (!dlg.hidden && $("#drawer-title") && $("#drawer-title").textContent === "Install for offline use") openInstall();
      }
    });
    navigator.serviceWorker.addEventListener("controllerchange", function () { if (reloading) location.reload(); });
    var onUpdate = function (w) {
      $("#updatebar").hidden = false;
      $("#update-btn").onclick = function () { reloading = true; w.postMessage({ type: "skip-waiting" }); };
    };
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").then(function (reg) {
        if (reg.waiting && navigator.serviceWorker.controller) onUpdate(reg.waiting);
        reg.addEventListener("updatefound", function () {
          var nw = reg.installing; if (!nw) return;
          nw.addEventListener("statechange", function () {
            if (nw.state === "installed" && navigator.serviceWorker.controller) onUpdate(nw);
            if (nw.state === "activated") askStatus();
          });
        });
        askStatus();
      }).catch(function () { syncInstallButton(); });
    });
  }
})(window.FF = window.FF || {});
