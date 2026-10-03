/* FlameMind: the on-device analysis engine.
 * Retrieval (BM25 with domain synonyms), transparent multi-criteria ranking,
 * a screening flammability model, research-gap analysis, a classifier for
 * live literature, and a grounded answer composer. No network, no model
 * download: everything runs instantly in the browser. */
(function (FF) {
  "use strict";

  /* ---------- text processing ---------- */
  var STOP = new Set(("a an and are as at be by for from has have how i in is it its of on or that the this to " +
    "was were what when where which who why will with do does did can could should would about into than then " +
    "there these those they them their our we you your me my us more most very also any all not no").split(" "));

  var SYN = {
    fire: ["flame", "combust", "burn"], flame: ["fire", "combust"], combust: ["flame", "fire"], burn: ["flame", "combust"],
    extinguish: ["suppress", "extinct"], suppress: ["extinguish", "suppression"], extinct: ["quench", "blowoff"],
    smoke: ["soot", "aerosol", "particle"], soot: ["smoke"], detector: ["detect", "sensor", "alarm"], detect: ["detector", "sensor"],
    moon: ["lunar", "partial"], lunar: ["moon", "partial"], mars: ["martian", "partial"], martian: ["mars"],
    oxygen: ["o2"], o2: ["oxygen"], microgravity: ["ug", "orbit", "space"], ug: ["microgravity"], zero: ["microgravity"],
    toxic: ["toxicity", "co", "product"], ventilation: ["flow", "fan"], flow: ["ventilation"], fan: ["ventilation"],
    wire: ["insulation", "electrical"], electrical: ["wire"], material: ["materials", "flammability"],
    gap: ["unknown", "future"], hydrogen: ["h2", "lean"], droplet: ["spray", "liquid", "fuel"], spray: ["droplet"],
    cool: ["low-temperature"], standard: ["std", "6001", "test"], test: ["standard"], water: ["mist"], mist: ["water"],
    habitat: ["module", "cabin"], cabin: ["module", "habitat", "spacecraft"], spacecraft: ["cabin", "vehicle"]
  };

  function norm(s) {
    return String(s || "").toLowerCase().replace(/[µμ]/g, "u").replace(/₂/g, "2").normalize("NFKD").replace(/[̀-ͯ]/g, "");
  }
  function stem(w) {
    if (w.length > 5 && /ing$/.test(w)) return w.slice(0, -3);
    if (w.length > 4 && /ion$/.test(w)) return w.slice(0, -3);
    if (w.length > 4 && /ed$/.test(w)) return w.slice(0, -2);
    if (w.length > 4 && /ies$/.test(w)) return w.slice(0, -3) + "y";
    if (w.length > 3 && /s$/.test(w) && !/ss$/.test(w)) return w.slice(0, -1);
    return w;
  }
  function tokens(s) {
    var out = [];
    norm(s).split(/[^a-z0-9%.-]+/).forEach(function (t) {
      t = t.replace(/^[.-]+|[.-]+$/g, "");
      if (!t || STOP.has(t)) return;
      out.push(stem(t));
    });
    return out;
  }
  function expand(qt) {
    var seen = new Map();
    qt.forEach(function (t) { seen.set(t, 1); });
    qt.forEach(function (t) {
      (SYN[t] || []).forEach(function (s) { s = stem(s); if (!seen.has(s)) seen.set(s, 0.45); });
    });
    return seen;
  }

  /* ---------- BM25 index ---------- */
  function Index(docs) {
    this.docs = docs; this.df = new Map(); this.len = []; this.tf = [];
    var total = 0, self = this;
    docs.forEach(function (d, i) {
      var tk = tokens(d.body), m = new Map();
      tk.forEach(function (t) { m.set(t, (m.get(t) || 0) + 1); });
      self.tf[i] = m; self.len[i] = tk.length; total += tk.length;
      m.forEach(function (_, t) { self.df.set(t, (self.df.get(t) || 0) + 1); });
    });
    this.avg = total / Math.max(1, docs.length);
  }
  Index.prototype.search = function (q, k) {
    var qt = expand(tokens(q)), N = this.docs.length, res = [], self = this;
    this.docs.forEach(function (d, i) {
      var s = 0, tf = self.tf[i], dl = self.len[i];
      qt.forEach(function (w, t) {
        var f = tf.get(t); if (!f) return;
        var idf = Math.log(1 + (N - self.df.get(t) + 0.5) / (self.df.get(t) + 0.5));
        s += w * idf * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * dl / self.avg));
      });
      if (s > 0) res.push({ doc: d, score: s });
    });
    res.sort(function (a, b) { return b.score - a.score; });
    return res.slice(0, k || 8);
  };

  /* ---------- lookup helpers ---------- */
  var byId = {};
  function reindex() {
    byId = {};
    FF.EXPERIMENTS.forEach(function (e) { byId[e.id] = e; });
    FF.FINDINGS.forEach(function (f) { byId[f.id] = f; });
  }
  function expName(id) { var e = byId[id]; return e ? e.name : id; }

  /* ---------- ranking ---------- */
  var MISSION_IDX = { iss: 0, transit: 1, lunar: 2, mars: 3 };
  var CRITERIA = [
    { id: "impact", label: "Safety impact" },
    { id: "evidence", label: "Evidence strength" },
    { id: "mission", label: "Mission fit" },
    { id: "action_s", label: "Actionability" },
    { id: "novelty", label: "Novelty" }
  ];
  function scoreFinding(f, w, tag) {
    var mi = MISSION_IDX[tag] == null ? 0 : MISSION_IDX[tag];
    var n = {
      impact: (f.impact - 1) / 4, evidence: (f.evidence - 1) / 4, novelty: (f.novelty - 1) / 4,
      action_s: (f.action_s - 1) / 4, mission: (f.rel ? f.rel[mi] : 1) / 3
    };
    var sw = 0; CRITERIA.forEach(function (c) { sw += w[c.id]; });
    sw = sw || 1;
    var parts = {}, total = 0;
    CRITERIA.forEach(function (c) { parts[c.id] = 100 * w[c.id] * n[c.id] / sw; total += parts[c.id]; });
    return { total: total, parts: parts };
  }
  function rankFindings(w, tag, list) {
    return (list || FF.FINDINGS).map(function (f) {
      var s = scoreFinding(f, w, tag); return { f: f, total: s.total, parts: s.parts };
    }).sort(function (a, b) { return b.total - a.total; });
  }

  /* ---------- screening flammability model ----------
   * Semi-empirical, illustrative. Effective flow combines forced flow with a
   * buoyant velocity scale (~30 cm/s at 1 g, scaling with g^(1/3)). The
   * minimum O2 for spread is U-shaped in log(effective flow), with its floor
   * (moc1g - dmu) near 8 cm/s (12 cm/s for thick fuels), steeper on the
   * low-flow quench side, and calibrated to moc1g at quiescent 1 g. Lower
   * pressure raises the limit slightly at fixed mole fraction. */
  function buoyantU(g) { return 30 * Math.cbrt(Math.max(0, g)); }
  function effFlow(u, g) { return Math.max(0.3, Math.hypot(Math.max(0, u), buoyantU(g))); }
  function limitO2(mat, u, g, p) {
    var us = mat.thick ? 12 : 8, floor = mat.moc1g - mat.dmu;
    var L = Math.log(effFlow(u, g) / us);
    var aHigh = mat.dmu / Math.pow(Math.log(30 / us), 2);
    var a = L < 0 ? 1.6 : aHigh;
    return floor + a * L * L + 2.0 * Math.log(101.3 / Math.max(20, p));
  }
  function riskOf(o2, lim) { return 1 / (1 + Math.exp(-(o2 - lim) / 1.2)); }
  function riskBand(r) {
    if (r >= 0.8) return { id: "severe", label: "Severe" };
    if (r >= 0.5) return { id: "high", label: "High" };
    if (r >= 0.2) return { id: "elevated", label: "Elevated" };
    return { id: "low", label: "Low" };
  }
  function worstFlow(mat, g) {
    var us = mat.thick ? 12 : 8, ub = buoyantU(g);
    return ub >= us ? 0 : Math.sqrt(us * us - ub * ub);
  }
  function assess(s) {
    var mat = FF.MATERIALS.find(function (m) { return m.id === s.material; }) || FF.MATERIALS[1];
    var lim = limitO2(mat, s.flow, s.g, s.p), r = riskOf(s.o2, lim);
    var wf = worstFlow(mat, s.g), wlim = limitO2(mat, wf, s.g, s.p), wr = riskOf(s.o2, wlim);
    var test = limitO2(mat, 0, 1, s.p);           // 1 g upward screen at this atmosphere
    var hidden = s.o2 < test && s.o2 > wlim;        // passes 1 g screen, can burn here at worst flow
    return { mat: mat, limit: lim, margin: s.o2 - lim, risk: r, band: riskBand(r), worstFlow: wf, worstLimit: wlim,
      worstRisk: wr, worstBand: riskBand(wr), testLimit: test, hidden: hidden, ub: buoyantU(s.g) };
  }

  /* ---------- research gaps ---------- */
  function coverage(tag, liveItems) {
    var mi = MISSION_IDX[tag] == null ? 0 : MISSION_IDX[tag], cells = [];
    FF.HAZARDS.forEach(function (h) {
      FF.REGIMES.forEach(function (r) {
        var cov = 0, ids = [];
        FF.FINDINGS.forEach(function (f) {
          if (f.hazards.indexOf(h.id) >= 0 && f.regimes.indexOf(r.id) >= 0) { cov += f.evidence / 5; ids.push(f.id); }
        });
        var live = (liveItems || []).filter(function (it) {
          return it.cls && it.cls.hazards.indexOf(h.id) >= 0 && it.cls.regimes.indexOf(r.id) >= 0;
        }).length;
        // importance: how much this hazard matters for the mission, and whether
        // the regime applies to the mission at all.
        var hz = FF.FINDINGS.filter(function (f) { return f.hazards.indexOf(h.id) >= 0; });
        var imp = hz.length ? hz.reduce(function (a, f) { return a + f.rel[mi]; }, 0) / (3 * hz.length) : 0.3;
        var regimeFit = { "ug-air": [1, 1, 0.4, 0.4], "ug-o2": [0.4, 0.8, 1, 1], partial: [0.1, 0.1, 1, 1], ground: [0.5, 0.5, 0.6, 0.6] }[r.id][mi];
        var gap = imp * regimeFit * Math.exp(-cov / 1.2);
        cells.push({ hazard: h, regime: r, cov: cov, ids: ids, live: live, gap: gap });
      });
    });
    return cells;
  }

  /* ---------- live literature classifier ---------- */
  var HZ_KW = {
    ignition: ["ignit", "autoignit", "spark", "overload", "hot surface", "wire"],
    spread: ["spread", "propagat", "fire growth", "burning rate", "flame growth"],
    extinction: ["extinct", "quench", "blowoff", "blow-off", "flammability limit", "limiting oxygen", "minimum oxygen"],
    suppression: ["suppress", "extinguish", "water mist", "inert", "fire-fighting", "firefighting"],
    smoke: ["smoke", "soot", "particulate", "aerosol"],
    detection: ["detect", "sensor", "alarm", "monitoring", "diagnos"],
    toxicity: ["toxic", "carbon monoxide", "combustion product", "cleanup", "hcn", "acid gas"]
  };
  var RG_KW = {
    "ug-air": ["microgravity", "micro-gravity", "ugravity", "zero gravity", "zero-gravity", "drop tower", "space station", "iss", "orbit", "spacecraft", "parabolic"],
    "ug-o2": ["oxygen-enriched", "enriched oxygen", "elevated oxygen", "reduced pressure", "low pressure", "sub-atmospheric", "exploration atmosphere", "34%"],
    partial: ["partial gravity", "partial-gravity", "lunar", "moon", "mars", "martian", "centrifuge", "reduced gravity", "reduced-gravity"],
    ground: ["normal gravity", "earth gravity", "1g", "1-g", "ground-based", "upward flame"]
  };
  var FIRE_KW = ["flame", "fire", "combust", "flammab", "burn", "soot", "smoke", "ignit", "extinct", "smolder", "smoulder"];
  function classify(text) {
    var t = " " + norm(text) + " ", hz = [], rg = [], hits = 0;
    Object.keys(HZ_KW).forEach(function (k) { if (HZ_KW[k].some(function (w) { return t.indexOf(w) >= 0; })) hz.push(k); });
    Object.keys(RG_KW).forEach(function (k) { if (RG_KW[k].some(function (w) { return t.indexOf(w) >= 0; })) rg.push(k); });
    FIRE_KW.forEach(function (w) { var i = -1; while ((i = t.indexOf(w, i + 1)) >= 0) hits++; });
    var space = rg.length > 0 ? 1 : 0;
    var relevance = Math.min(1, (Math.min(hits, 10) / 10) * 0.6 + space * 0.25 + Math.min(hz.length, 3) / 3 * 0.15);
    var missions = [];
    if (rg.indexOf("ug-air") >= 0) missions.push("iss", "transit");
    if (rg.indexOf("ug-o2") >= 0) missions.push("lunar", "mars", "transit");
    if (rg.indexOf("partial") >= 0) missions.push("lunar", "mars");
    return { hazards: hz, regimes: rg, relevance: relevance, missions: Array.from(new Set(missions)) };
  }

  /* ---------- query understanding ---------- */
  function parseScenario(q) {
    var t = norm(q), s = {}, m;
    if ((m = t.match(/(\d+(?:\.\d+)?)\s*%/))) s.o2 = +m[1];
    if ((m = t.match(/(\d+(?:\.\d+)?)\s*(kpa|psia|psi|atm)\b/))) {
      var v = +m[1]; s.p = m[2] === "kpa" ? v : m[2] === "atm" ? v * 101.325 : v * 6.89476;
    }
    if ((m = t.match(/(\d+(?:\.\d+)?)\s*(cm\/s|cm s|cms|m\/s)/))) s.flow = m[2] === "m/s" ? +m[1] * 100 : +m[1];
    if ((m = t.match(/\b(\d*\.?\d+)\s*g\b/))) s.g = Math.min(1, +m[1]);
    if (/lunar|moon/.test(t)) s.g = 0.166;
    else if (/mars|martian/.test(t) && !/transit/.test(t)) s.g = 0.38;
    else if (/orbit|\biss\b|microgravity|zero.?g|\b0\s*g\b|transit|orion/.test(t)) s.g = s.g == null ? 0 : s.g;
    else if (/earth|ground|1\s*g\b/.test(t)) s.g = 1;
    var keys = { paper: "paper", cellulose: "paper", cotton: "cotton", sibal: "sibal", fiberglass: "sibal", foam: "pufoam",
      polyurethane: "pufoam", wire: "pewire", polyethylene: "pewire", pmma: "pmma", acrylic: "pmma", silicone: "silicone",
      nomex: "nomex", ultem: "ultem", polyetherimide: "ultem", kapton: "kapton" };
    Object.keys(keys).some(function (k) { if (t.indexOf(k) >= 0) { s.material = keys[k]; return true; } return false; });
    var n = Object.keys(s).length;
    return n >= 2 || (s.material && n >= 1 && (s.o2 != null || s.p != null)) ? s : null;
  }
  function detectMission(q) {
    var t = norm(q);
    if (/mars transit|to mars|cruise/.test(t)) return "mars-transit";
    if (/mars|martian/.test(t)) return "mars";
    if (/lunar|moon|artemis base|gateway/.test(t)) return "lunar";
    if (/orion/.test(t)) return "orion";
    if (/\biss\b|space station|leo|low earth/.test(t)) return "iss";
    return null;
  }
  function detectExperiments(q) {
    var t = norm(q), out = [];
    FF.EXPERIMENTS.forEach(function (e) {
      var key = norm(e.id).replace(/-i-iii|-iv-vi/, "");
      var re = new RegExp("(^|[^a-z0-9])" + key.replace(/[-]/g, "[- ]?") + "([^a-z0-9]|$)");
      if (re.test(t)) out.push(e.id);
    });
    // prefer exact variants: "flex-2" should not also pull "flex"
    if (out.indexOf("FLEX-2") >= 0 && !/flex(?!.?2)/.test(t.replace(/flex.?2/g, ""))) out = out.filter(function (x) { return x !== "FLEX"; });
    if (out.indexOf("BASS-II") >= 0 && !/bass(?!.?ii)/.test(t.replace(/bass.?ii/g, ""))) out = out.filter(function (x) { return x !== "BASS"; });
    return out;
  }

  /* ---------- knowledge index ---------- */
  var kIndex = null, liveIndex = null;
  function buildIndex() {
    reindex();
    var docs = [];
    FF.FINDINGS.forEach(function (f) {
      docs.push({ kind: "finding", id: f.id, ref: f,
        body: [f.title, f.title, f.text, f.plain, f.action, f.hazards.join(" "), f.exp.map(function (x) { return x + " " + expName(x); }).join(" ")].join(" ") });
    });
    FF.EXPERIMENTS.forEach(function (e) {
      docs.push({ kind: "experiment", id: e.id, ref: e, body: [e.id, e.name, e.name, e.category, e.platform, e.fuels, e.conditions, e.summary].join(" ") });
    });
    FF.GLOSSARY.forEach(function (g, i) { docs.push({ kind: "term", id: "G" + i, ref: g, body: g.term + " " + g.term + " " + g.def }); });
    kIndex = new Index(docs);
  }
  function setLive(items) {
    liveIndex = items && items.length ? new Index(items.map(function (it) {
      return { kind: "live", id: it.uid, ref: it, body: it.title + " " + it.title + " " + (it.abstract || "") };
    })) : null;
  }
  function retrieve(q, k) { if (!kIndex) buildIndex(); return kIndex.search(q, k || 10); }
  function retrieveLive(q, k) { return liveIndex ? liveIndex.search(q, k || 5) : []; }

  /* ---------- answer composer ---------- */
  function pick(f, audience) { return audience === "crew" || audience === "public" ? f.plain : f.text; }
  function confidenceOf(fs) {
    if (!fs.length) return "Low";
    var e = fs.reduce(function (a, f) { return a + f.evidence; }, 0) / fs.length;
    return e >= 4 ? "High" : e >= 3 ? "Medium" : "Low";
  }
  function fmt(n, d) { return (Math.round(n * Math.pow(10, d || 0)) / Math.pow(10, d || 0)).toString(); }

  function answer(q, ctx) {
    if (!kIndex) buildIndex();
    var t = norm(q), mission = FF.MISSIONS.find(function (m) { return m.id === (detectMission(q) || ctx.mission); });
    var lines = [], cites = [];

    // 1. Scenario: run the screening model
    var sc = parseScenario(q);
    if (sc && (sc.o2 != null || sc.material)) {
      var s = { o2: sc.o2 != null ? sc.o2 : mission.o2, p: sc.p != null ? sc.p : mission.p, g: sc.g != null ? sc.g : mission.g,
        flow: sc.flow != null ? sc.flow : 10, material: sc.material || "cotton" };
      var a = assess(s);
      lines.push("**Screening result: " + a.band.label + " risk** for " + a.mat.label.toLowerCase() + " at " + fmt(s.o2, 1) + "% O₂, " +
        fmt(s.p, 1) + " kPa, " + fmt(s.g, 3) + " g, " + fmt(s.flow, 1) + " cm/s.");
      lines.push("- Estimated limiting O₂ here: **" + fmt(a.limit, 1) + "%** (margin " + (a.margin >= 0 ? "+" : "") + fmt(a.margin, 1) + " points).");
      lines.push("- Most flammable flow at this gravity: about **" + fmt(a.worstFlow, 1) + " cm/s**, where the limit drops to " + fmt(a.worstLimit, 1) + "% (" + a.worstBand.label.toLowerCase() + " risk).");
      if (a.hidden) lines.push("- **Hidden-risk zone:** this material would pass a 1 g upward screen in this atmosphere (limit " + fmt(a.testLimit, 1) + "%) yet can burn at the worst-case flow here. [F02] [F03]");
      lines.push("- Why: " + (s.g > 0 && s.g < 1 ? "weak buoyancy near the most flammable flow speed [F03]" : s.g === 0 ? "in free fall, ventilation sets the flow; a gentle breeze is the worst case [F01]" : "on Earth buoyant flow is strong and pushes flames toward blowoff") + ".");
      lines.push("This is a screening estimate from a simplified model, not a certification result. Open **Fire envelope** to explore it.");
      cites.push("F01", "F02", "F03");
      return { md: lines.join("\n"), cites: cites, kind: "scenario", scenario: s, confidence: "Model" };
    }

    // 2. Comparison
    var exps = detectExperiments(q);
    if (exps.length >= 2 && /compar|vs\.?|versus|differ|between/.test(t)) {
      lines.push("**Comparing " + exps.map(function (x) { return x; }).join(" and ") + "**");
      exps.slice(0, 4).forEach(function (id) {
        var e = byId[id], fs = FF.FINDINGS.filter(function (f) { return f.exp.indexOf(id) >= 0; });
        lines.push("- **" + e.id + "** (" + e.years[0] + (e.years[1] !== e.years[0] ? "–" + e.years[1] : "") + ", " + e.platform + ", " + e.category.toLowerCase() + "): " +
          (fs[0] ? pick(fs[0], ctx.audience) + " [" + fs[0].id + "]" : e.summary));
        if (fs[0]) cites.push(fs[0].id);
      });
      var hz = exps.map(function (id) {
        var set = new Set(); FF.FINDINGS.forEach(function (f) { if (f.exp.indexOf(id) >= 0) f.hazards.forEach(function (h) { set.add(h); }); }); return set;
      });
      var shared = Array.from(hz[0]).filter(function (h) { return hz.slice(1).every(function (s) { return s.has(h); }); });
      lines.push(shared.length ? "**Common ground:** both inform " + shared.join(", ") + " hazards." :
        "**Complementary:** they address different hazards, so together they widen coverage.");
      return { md: lines.join("\n"), cites: cites, kind: "compare", confidence: "High" };
    }

    // 3. Gaps
    if (/gap|unknown|missing|under.?stud|future research|don.?t know|open question|need more/.test(t)) {
      var cells = coverage(mission.tag, ctx.live).sort(function (a, b) { return b.gap - a.gap; }).slice(0, 4);
      lines.push("**Largest evidence gaps for " + mission.label + "**, by mission importance against existing evidence:");
      cells.forEach(function (c) {
        lines.push("- **" + c.hazard.label + " × " + c.regime.label + "**: " + (c.ids.length ? c.ids.length + " finding(s) so far " + c.ids.slice(0, 3).map(function (i) { return "[" + i + "]"; }).join(" ") : "no direct findings") +
          (c.live ? "; " + c.live + " recent paper(s) touch it" : "") + ".");
        cites = cites.concat(c.ids.slice(0, 3));
      });
      lines.push("Partial-gravity and enriched-oxygen conditions for smoke, detection and suppression are the thinnest areas. See **Gaps** for the full matrix.");
      return { md: lines.join("\n"), cites: cites, kind: "gaps", confidence: "Medium" };
    }

    // 4. Ranking
    if (/top|most important|rank|priorit|biggest|key (finding|insight|risk)|matter most|critical/.test(t)) {
      var r = rankFindings(ctx.weights, mission.tag).slice(0, 5);
      lines.push("**Top findings for " + mission.label + "** (current ranking weights):");
      r.forEach(function (x, i) { lines.push("- " + (i + 1) + ". **" + x.f.title + "** (" + Math.round(x.total) + "): " + x.f.action + " [" + x.f.id + "]"); cites.push(x.f.id); });
      lines.push("**Confidence:** " + confidenceOf(r.map(function (x) { return x.f; })) + ". Adjust weights in **Insights** to see how the order changes.");
      return { md: lines.join("\n"), cites: cites, kind: "rank", confidence: confidenceOf(r.map(function (x) { return x.f; })) };
    }

    // 5. Retrieval-grounded synthesis
    var hits = retrieve(q, 12);
    var term = hits.find(function (h) { return h.doc.kind === "term"; });
    var defn = /what is|what are|define|meaning|stand for|what does/.test(t) && term && term.score > 2;
    var fHits = hits.filter(function (h) { return h.doc.kind === "finding"; });
    var tag = mission.tag, mi = MISSION_IDX[tag];
    fHits.forEach(function (h) { h.score *= 0.8 + 0.2 * (h.doc.ref.rel[mi] / 3) + 0.05 * h.doc.ref.evidence + 0.05 * h.doc.ref.impact; });
    fHits.sort(function (a, b) { return b.score - a.score; });
    var eHits = hits.filter(function (h) { return h.doc.kind === "experiment"; });
    var lHits = retrieveLive(q, 3).filter(function (h) { return h.score > 3; });

    if (defn) lines.push("**" + term.doc.ref.term + ":** " + term.doc.ref.def);
    var top = fHits.slice(0, 4).filter(function (h, i) { return i === 0 || h.score > fHits[0].score * 0.35; });
    if (!top.length && !defn) {
      lines.push("I couldn't find strong evidence for that in the curated microgravity combustion record.");
      if (eHits.length) lines.push("Closest experiment: **" + eHits[0].doc.ref.name + "** [" + eHits[0].doc.id + "]. " + eHits[0].doc.ref.summary);
      lines.push("Try asking about flame spread, suppression, smoke detection, materials, or a specific mission.");
      return { md: lines.join("\n"), cites: eHits.length ? [eHits[0].doc.id] : [], kind: "none", confidence: "Low" };
    }
    if (top.length) {
      var lead = top[0].doc.ref;
      lines.push((defn ? "" : "**Short answer:** ") + pick(lead, ctx.audience) + " [" + lead.id + "]");
      if (top.length > 1) {
        lines.push("**Supporting evidence**");
        top.slice(1).forEach(function (h) { var f = h.doc.ref; lines.push("- **" + f.title + ".** " + pick(f, ctx.audience) + " [" + f.id + "]"); });
      }
      lines.push("**What to do for " + mission.label + "**");
      top.slice(0, 3).forEach(function (h) { lines.push("- " + h.doc.ref.action); });
      top.forEach(function (h) { cites.push(h.doc.ref.id); });
    }
    if (lHits.length) {
      lines.push("**Recent literature**");
      lHits.forEach(function (h) { lines.push("- " + h.doc.ref.title + " (" + h.doc.ref.date.slice(0, 4) + ", " + h.doc.ref.sourceLabel + ") [" + h.doc.ref.uid + "]"); cites.push(h.doc.ref.uid); });
    }
    var conf = confidenceOf(top.map(function (h) { return h.doc.ref; }));
    lines.push("**Confidence:** " + conf + " (based on evidence strength of the cited findings).");
    return { md: lines.join("\n"), cites: cites, kind: "answer", confidence: conf };
  }

  // Context pack for the optional cloud model: the same retrieval, as text.
  function contextPack(q, ctx) {
    var hits = retrieve(q, 10), lines = [];
    var ids = new Set();
    hits.forEach(function (h) {
      if (h.doc.kind === "finding") ids.add(h.doc.id);
      if (h.doc.kind === "experiment") FF.FINDINGS.forEach(function (f) { if (f.exp.indexOf(h.doc.id) >= 0) ids.add(f.id); });
    });
    rankFindings(ctx.weights, (FF.MISSIONS.find(function (m) { return m.id === ctx.mission; }) || FF.MISSIONS[0]).tag)
      .slice(0, 4).forEach(function (x) { ids.add(x.f.id); });
    Array.from(ids).slice(0, 12).forEach(function (id) {
      var f = byId[id];
      lines.push("[" + f.id + "] " + f.title + ". " + f.text + " Design implication: " + f.action +
        " Experiments: " + f.exp.map(function (x) { return x + " (" + expName(x) + ")"; }).join(", ") + ". Evidence " + f.evidence + "/5.");
    });
    retrieveLive(q, 5).forEach(function (h) {
      var it = h.doc.ref;
      lines.push("[" + it.uid + "] " + it.title + " (" + it.date + ", " + it.sourceLabel + "). " + (it.abstract || "").slice(0, 600));
    });
    return lines.join("\n");
  }

  FF.engine = {
    tokens: tokens, Index: Index, buildIndex: buildIndex, setLive: setLive, retrieve: retrieve,
    CRITERIA: CRITERIA, MISSION_IDX: MISSION_IDX, scoreFinding: scoreFinding, rankFindings: rankFindings,
    buoyantU: buoyantU, effFlow: effFlow, limitO2: limitO2, riskOf: riskOf, riskBand: riskBand, worstFlow: worstFlow, assess: assess,
    coverage: coverage, classify: classify, parseScenario: parseScenario, detectMission: detectMission,
    detectExperiments: detectExperiments, answer: answer, contextPack: contextPack, byId: function (id) { return byId[id]; }, reindex: reindex
  };
})(window.FF = window.FF || {});
