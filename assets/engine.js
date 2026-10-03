/* FlameMind: the on-device analysis engine.
 * Retrieval (BM25 with domain synonyms), transparent multi-criteria ranking,
 * a screening flammability model, research-gap analysis, a classifier for
 * live literature, and a grounded answer composer. Everything runs in the
 * browser with no network access. */
(function (FF) {
  "use strict";

  /* ---------- text processing ---------- */
  var STOP = new Set(("a an and are as at be by for from has have how i in is it its of on or that the this to " +
    "was were what when where which who why will with do does did can could should would about into than then " +
    "there these those they them their our we you your me my us more most very also any all not no").split(" "));

  var SYN = {
    fire: ["flame", "combust", "burn"], flame: ["fire", "combust"], combust: ["flame", "fire"], burn: ["flame", "combust"],
    extinguish: ["suppress", "extinct"], stop: ["extinguish", "suppress"], put: ["extinguish"], fight: ["suppress", "extinguish"], suppress: ["extinguish", "suppression"], extinct: ["quench", "blowoff"],
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
  // Query tokens are stemmed, so the synonym table is keyed by stems too
  // (otherwise "ventilation" or "mars" never find their synonyms).
  var SYN_STEM = {};
  Object.keys(SYN).forEach(function (k) {
    var key = stem(norm(k));
    SYN_STEM[key] = (SYN_STEM[key] || []).concat(SYN[k].map(function (v) { return stem(norm(v)); }));
  });
  function expand(qt) {
    var seen = new Map();
    qt.forEach(function (t) { seen.set(t, 1); });
    qt.forEach(function (t) {
      (SYN_STEM[t] || []).forEach(function (s) { if (!seen.has(s)) seen.set(s, 0.45); });
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
    FF.FINDINGS.forEach(function (f) {
      byId[f.id] = f;
      var d = deriveEvidence(f);
      if (d) { f.evidence = d.score; f.evidenceWhy = d.why; }
      else if (!f.evidence) { f.evidence = 2; f.evidenceWhy = ["No linked experiment: default rating"]; }
    });
  }

  /* ---------- evidence strength, computed ----------
   * From the linked experiments, not hand-rated:
   *   base = best test platform: spacecraft-scale fire (Cygnus) or standardized
   *          ground testing 4; long-duration orbital (ISS, Shuttle, Mir) 3;
   *          short-duration microgravity (drop tower, aircraft, rocket) 2
   *   +1 when two or more investigations support the finding
   *   -1 when every supporting investigation is still ongoing (preliminary)
   *   documented operational incidents score 5. Result clamped to 1-5. */
  var TIERS = [
    { re: /cygnus/i, t: 4, why: "spacecraft-scale fire tests" },
    { re: /ground/i, t: 4, why: "standardized ground testing" },
    { re: /iss|shuttle|mir/i, t: 3, why: "long-duration orbital tests" },
    { re: /./, t: 2, why: "short-duration microgravity tests" }
  ];
  function deriveEvidence(f) {
    if (f.incident) return { score: 5, why: ["Documented operational incident"] };
    var ex = (f.exp || []).map(function (id) { return byId[id]; }).filter(Boolean);
    if (!ex.length) return null;
    var best = null;
    ex.forEach(function (e) { var r = TIERS.find(function (x) { return x.re.test(e.platform); }); if (!best || r.t > best.t) best = r; });
    var score = best.t, why = [best.why + " (" + best.t + ")"];
    if (ex.length >= 2) { score += 1; why.push("supported by " + ex.length + " investigations (+1)"); }
    if (ex.every(function (e) { return /ongoing/i.test(e.status); })) { score -= 1; why.push("results still preliminary (-1)"); }
    return { score: Math.max(1, Math.min(5, score)), why: why };
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
  var MODEL = {
    ub1g: 30,          // buoyant velocity scale at 1 g, cm/s
    uMin: 0.3,         // residual diffusive flow floor, cm/s
    uStarThin: 8,      // most flammable effective flow, thin fuels, cm/s
    uStarThick: 12,    // most flammable effective flow, thick fuels, cm/s
    aLow: 1.6,         // curvature on the low-flow (quench) side, O2 points per ln^2
    kP: 2.0,           // pressure sensitivity, O2 points per ln(101.3 kPa / P)
    pRef: 101.3,       // reference pressure, kPa
    pMin: 20,          // pressure clamp, kPa
    width: 1.2         // logistic width of the spread probability, O2 points
  };
  function uStar(mat) { return mat.thick ? MODEL.uStarThick : MODEL.uStarThin; }
  function buoyantU(g) { return MODEL.ub1g * Math.cbrt(Math.max(0, g)); }
  function effFlow(u, g) { return Math.max(MODEL.uMin, Math.hypot(Math.max(0, u), buoyantU(g))); }
  function limitO2(mat, u, g, p) {
    var us = uStar(mat), floor = mat.moc1g - mat.dmu;
    var L = Math.log(effFlow(u, g) / us);
    // calibrated so quiescent 1 g at reference pressure returns moc1g
    var aHigh = mat.dmu / Math.pow(Math.log(MODEL.ub1g / us), 2);
    var a = L < 0 ? MODEL.aLow : aHigh;
    return floor + a * L * L + MODEL.kP * Math.log(MODEL.pRef / Math.max(MODEL.pMin, p));
  }
  function riskOf(o2, lim) { return 1 / (1 + Math.exp(-(o2 - lim) / MODEL.width)); }
  function riskBand(r) {
    if (r >= 0.8) return { id: "severe", label: "Severe" };
    if (r >= 0.5) return { id: "high", label: "High" };
    if (r >= 0.2) return { id: "elevated", label: "Elevated" };
    return { id: "low", label: "Low" };
  }
  function worstFlow(mat, g) {
    var us = uStar(mat), ub = buoyantU(g);
    return ub >= us ? 0 : Math.sqrt(us * us - ub * ub);
  }
  // Spread of the limiting O2 when every model coefficient is varied over its
  // stated uncertainty (all 2^6 corner combinations).
  var UNCERTAINTY = { uStarThin: 0.25, uStarThick: 0.25, aLow: 0.25, kP: 0.5, ub1g: 0.2, dmu: 0.5 };
  function limitRange(mat, u, g, p) {
    var keys = Object.keys(UNCERTAINTY), saved = {}, lo = Infinity, hi = -Infinity;
    keys.forEach(function (k) { if (k !== "dmu") saved[k] = MODEL[k]; });
    for (var mask = 0; mask < (1 << keys.length); mask++) {
      var m2 = mat;
      keys.forEach(function (k, i) {
        var f = 1 + ((mask >> i) & 1 ? 1 : -1) * UNCERTAINTY[k];
        if (k === "dmu") m2 = { moc1g: mat.moc1g, dmu: mat.dmu * f, thick: mat.thick };
        else MODEL[k] = saved[k] * f;
      });
      var v = limitO2(m2, u, g, p);
      if (v < lo) lo = v; if (v > hi) hi = v;
    }
    keys.forEach(function (k) { if (k !== "dmu") MODEL[k] = saved[k]; });
    return [lo, hi];
  }

  function assess(s) {
    var mat = FF.MATERIALS.find(function (m) { return m.id === s.material; }) || FF.MATERIALS[1];
    var lim = limitO2(mat, s.flow, s.g, s.p), r = riskOf(s.o2, lim);
    var wf = worstFlow(mat, s.g), wlim = limitO2(mat, wf, s.g, s.p), wr = riskOf(s.o2, wlim);
    var test = limitO2(mat, 0, 1, s.p);           // 1 g upward screen at this atmosphere
    var hidden = s.o2 < test && s.o2 > wlim;        // passes 1 g screen, can burn here at worst flow
    var rng = limitRange(mat, s.flow, s.g, s.p);
    return { mat: mat, limit: lim, limitLo: rng[0], limitHi: rng[1], riskLo: riskOf(s.o2, rng[1]), riskHi: riskOf(s.o2, rng[0]),
      margin: s.o2 - lim, risk: r, band: riskBand(r), worstFlow: wf, worstLimit: wlim,
      worstRisk: wr, worstBand: riskBand(wr), testLimit: test, hidden: hidden, ub: buoyantU(s.g) };
  }

  /* ---------- model checks ----------
   * Calibration checks hold by construction; independent checks compare the
   * model with NASA observations it was not fitted to. Shown in Data & method
   * and run on every page load, so a coefficient change that breaks one shows. */
  function mat(id) { return FF.MATERIALS.find(function (m) { return m.id === id; }); }
  function modelChecks() {
    var paper = mat("paper"), sibal = mat("sibal"), nomex = mat("nomex");
    var c = [];
    function add(kind, claim, source, pass, detail) { c.push({ kind: kind, claim: claim, source: source, pass: !!pass, detail: detail }); }
    var calOk = FF.MATERIALS.every(function (m) { return Math.abs(limitO2(m, 0, 1, MODEL.pRef) - m.moc1g) < 1e-9; });
    add("Calibration", "Quiescent 1 g at sea-level pressure returns each material's upward-spread limit", "STD-6001", calOk, "all " + FF.MATERIALS.length + " materials");
    add("Calibration", "Thin fuels are most flammable near " + MODEL.uStarThin + " cm/s in orbit (5–10 cm/s observed)", "F01", worstFlow(paper, 0) >= 5 && worstFlow(paper, 0) <= 10, worstFlow(paper, 0).toFixed(1) + " cm/s");
    var q = limitO2(paper, 0, 0, 101.3);
    add("Independent", "Thin paper does not spread in still air in orbit (21% O₂)", "F04", q > 21, "model limit " + q.toFixed(1) + "%");
    add("Independent", "Thin paper spreads in still air in orbit at 35% O₂ (SSCE)", "F04", q < 35, "model limit " + q.toFixed(1) + "%");
    var sb = limitO2(sibal, 20, 0, 101.3);
    add("Independent", "Cotton-fiberglass fabric burns in cabin air at ~20 cm/s in orbit (Saffire)", "F06", sb < 21, "model limit " + sb.toFixed(1) + "%");
    var lun = limitO2(paper, 0, 0.166, 101.3), earth = limitO2(paper, 0, 1, 101.3);
    add("Independent", "Thin fuels are more flammable at lunar gravity than on Earth", "F03", lun < earth, lun.toFixed(1) + "% vs " + earth.toFixed(1) + "%");
    var nIss = riskOf(21, limitO2(nomex, 10, 0, 101.3)), nLun = riskOf(34, limitO2(nomex, 10, 0.166, 56.5));
    add("Independent", "An exploration atmosphere (34% O₂, 56.5 kPa) makes Nomex far more flammable than ISS air", "F08", nLun > 0.8 && nIss < 0.2, "risk " + (nIss < 0.005 ? "<1" : Math.round(nIss * 100)) + "% → " + (nLun > 0.995 ? ">99" : Math.round(nLun * 100)) + "%");
    var mono = true;
    for (var u = 0; u <= 50 && mono; u += 5) for (var o = 10; o < 50; o += 5) if (riskOf(o + 5, limitO2(paper, u, 0, 101.3)) < riskOf(o, limitO2(paper, u, 0, 101.3))) mono = false;
    add("Invariant", "More oxygen never lowers the spread risk", "", mono, "checked across flows 0–50 cm/s");
    add("Invariant", "Lower pressure never lowers the limit at fixed oxygen fraction", "", limitO2(paper, 10, 0, 50) > limitO2(paper, 10, 0, 101.3), "50 vs 101.3 kPa");
    return c;
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
    "ug-air": ["microgravity", "micro-gravity", "micro gravity", "ugravity", "zero gravity", "zero-gravity", "drop tower", "space station", "iss", "orbit", "orbital", "spacecraft", "parabolic"],
    "ug-o2": ["oxygen-enriched", "enriched oxygen", "elevated oxygen", "reduced pressure", "low pressure", "sub-atmospheric", "exploration atmosphere", "34%"],
    partial: ["partial gravity", "partial-gravity", "lunar", "moon", "mars", "martian", "centrifuge", "reduced gravity", "reduced-gravity"],
    ground: ["normal gravity", "earth gravity", "1g", "1-g", "1 g", "ground-based", "upward flame"]
  };
  var FIRE_KW = ["flame", "fire", "combust", "flammab", "burn", "soot", "smoke", "ignit", "extinct", "extinguish", "smolder", "smoulder", "pyrolys", "autoignit", "cool flame"];
  // Keywords match at word starts only, so "iss" does not fire inside
  // "mission" and "mars" does not fire inside "Marshall".
  function kwRe(list, whole) {
    return new RegExp("(^|[^a-z0-9])(" + list.map(function (w) { return w.replace(/[.*+?^${}()|[\]\\%]/g, "\\$&"); }).join("|") + ")" + (whole ? "(?![a-z0-9])" : ""), "g");
  }
  var HZ_RE = {}, RG_RE = {};
  Object.keys(HZ_KW).forEach(function (k) { HZ_RE[k] = kwRe(HZ_KW[k], false); });
  Object.keys(RG_KW).forEach(function (k) { RG_RE[k] = kwRe(RG_KW[k], true); });
  var FIRE_RE = kwRe(FIRE_KW, false);
  // Relevance to spacecraft fire safety, 0-1. Fire vocabulary in the title
  // counts most, so short records without abstracts are judged fairly and
  // space papers that never mention fire score zero.
  var RELEVANCE_MIN = 0.3;
  function classify(title, abstract) {
    var tt = norm(title), t = norm(title + " " + (abstract || "")), hz = [], rg = [];
    Object.keys(HZ_RE).forEach(function (k) { HZ_RE[k].lastIndex = 0; if (HZ_RE[k].test(t)) hz.push(k); });
    Object.keys(RG_RE).forEach(function (k) { RG_RE[k].lastIndex = 0; if (RG_RE[k].test(t)) rg.push(k); });
    var hits = (t.match(FIRE_RE) || []).length, inTitle = (tt.match(FIRE_RE) || []).length > 0;
    var relevance = hits === 0 ? 0 : Math.min(1, 0.35 * (inTitle ? 1 : 0) + 0.35 * Math.min(hits, 6) / 6 + 0.2 * (rg.length ? 1 : 0) + 0.1 * Math.min(hz.length, 3) / 3);
    var missions = [];
    if (rg.indexOf("ug-air") >= 0) missions.push("iss", "transit");
    if (rg.indexOf("ug-o2") >= 0) missions.push("lunar", "mars", "transit");
    if (rg.indexOf("partial") >= 0) missions.push("lunar", "mars");
    return { hazards: hz, regimes: rg, relevance: relevance, relevant: relevance >= RELEVANCE_MIN, missions: Array.from(new Set(missions)) };
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
    if (/gateway|orion|cislunar/.test(t)) return "orion";
    if (/lunar|moon|artemis base/.test(t)) return "lunar";
    if (/\biss\b|space station|leo|low earth/.test(t)) return "iss";
    return null;
  }
  var AMBIGUOUS = { SAME: 1, MIST: 1, ELF: 1, FLARE: 1 };
  function detectExperiments(q) {
    var t = norm(q), out = [], pos = {};
    FF.EXPERIMENTS.forEach(function (e) {
      var key = norm(e.id).replace(/-i-iii|-iv-vi/, "");
      var src = key.replace(/[-]/g, "[- ]?");
      var re = AMBIGUOUS[e.id] ? new RegExp("(^|[^A-Za-z0-9])" + e.id + "([^A-Za-z0-9]|$)") : new RegExp("(^|[^a-z0-9])" + src + "([^a-z0-9]|$)");
      var m = re.exec(AMBIGUOUS[e.id] ? q : t);
      if (m) { out.push(e.id); pos[e.id] = m.index; }
    });
    // prefer exact variants: "flex-2" should not also pull "flex"
    if (out.indexOf("FLEX-2") >= 0 && !/flex(?!.?2)/.test(t.replace(/flex.?2/g, ""))) out = out.filter(function (x) { return x !== "FLEX"; });
    if (out.indexOf("BASS-II") >= 0 && !/bass(?!.?ii)/.test(t.replace(/bass.?ii/g, ""))) out = out.filter(function (x) { return x !== "BASS"; });
    return out.sort(function (a, b) { return pos[a] - pos[b]; });   // in the order the user named them
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
      // An Earth scenario without a stated pressure means sea level, not the mission cabin.
      var s = { o2: sc.o2 != null ? sc.o2 : mission.o2, p: sc.p != null ? sc.p : (sc.g === 1 ? 101.3 : mission.p), g: sc.g != null ? sc.g : mission.g,
        flow: sc.flow != null ? sc.flow : 10, material: sc.material || "cotton" };
      var a = assess(s);
      lines.push("**Screening result: " + a.band.label + " risk** for " + a.mat.label + " at " + fmt(s.o2, 1) + "% O₂, " +
        fmt(s.p, 1) + " kPa, " + fmt(s.g, 3) + " g, " + fmt(s.flow, 1) + " cm/s.");
      lines.push("- Estimated limiting O₂ here: **" + fmt(a.limit, 1) + "%** (margin " + (a.margin >= 0 ? "+" : "") + fmt(a.margin, 1) + " points).");
      lines.push(a.worstFlow < 0.05 ?
        "- Most flammable with **no forced flow**: buoyancy alone supplies about " + fmt(a.ub, 1) + " cm/s here, and the limit is " + fmt(a.worstLimit, 1) + "% (" + a.worstBand.label.toLowerCase() + " risk)." :
        "- Most flammable forced flow at this gravity: about **" + fmt(a.worstFlow, 1) + " cm/s**, where the limit drops to " + fmt(a.worstLimit, 1) + "% (" + a.worstBand.label.toLowerCase() + " risk).");
      if (a.hidden) lines.push("- **Hidden-risk zone:** this material would pass a 1 g upward screen in this atmosphere (limit " + fmt(a.testLimit, 1) + "%) yet can burn at the worst-case flow here. [F02] [F03]");
      lines.push("- Why: " + (s.g > 0 && s.g < 1 ? "weak buoyancy supplies a flow close to the most flammable speed [F03]" : s.g === 0 ? "in free fall, ventilation sets the flow, and a gentle breeze is the worst case [F01]" : "on Earth, buoyancy alone supplies about " + fmt(a.ub, 0) + " cm/s, faster than the most flammable speed") + ".");
      lines.push("This is a screening estimate from a simplified model, not a certification result. Open **Fire envelope** to explore it.");
      cites.push("F01", "F02", "F03");
      return { md: lines.join("\n"), cites: cites, kind: "scenario", scenario: s, confidence: "Model" };
    }

    // 2. Comparison
    var exps = detectExperiments(q);
    if (exps.length >= 2 && /\bcompar|\bvs\b|\bversus\b|\bdiffer|\bbetween\b/.test(t)) {
      lines.push("**Comparing " + exps.slice(0, 4).join(" and ") + "**");
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
    if (/\bgaps?\b|\bunknowns?\b|\bmissing\b|\bunder.?stud|\bfuture research|\bdon.?t (we )?know|\bopen questions?\b|\bneed more research/.test(t)) {
      var cells = coverage(mission.tag, ctx.live).sort(function (a, b) { return b.gap - a.gap; }).slice(0, 4);
      lines.push("**Largest evidence gaps for " + mission.label + "**, by mission importance against existing evidence:");
      cells.forEach(function (c) {
        lines.push("- **" + c.hazard.label + " × " + c.regime.label + "**: " + (c.ids.length ? c.ids.length + " finding(s) so far " + c.ids.slice(0, 3).map(function (i) { return "[" + i + "]"; }).join(" ") : "no direct findings") +
          (c.live ? "; " + c.live + " recent paper(s) touch it" : "") + ".");
        cites = cites.concat(c.ids.slice(0, 3));
      });
      var regs = {};
      cells.forEach(function (c) { regs[c.regime.label] = (regs[c.regime.label] || 0) + 1; });
      var thin = Object.keys(regs).sort(function (a, b) { return regs[b] - regs[a]; })[0];
      lines.push("Most of these gaps sit under **" + thin.toLowerCase() + "** conditions. See **Research gaps** for the full matrix.");
      return { md: lines.join("\n"), cites: cites, kind: "gaps", confidence: "Medium" };
    }

    // 4. Ranking
    if (/\btop\b|\bmost important|\brank|\bpriorit|\bbiggest\b|\bkey (finding|insight|risk|lesson)s?\b|\bmatters? most\b|\bmost critical\b/.test(t)) {
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

  FF.engine = {
    tokens: tokens, Index: Index, buildIndex: buildIndex, setLive: setLive, retrieve: retrieve,
    MODEL: MODEL, UNCERTAINTY: UNCERTAINTY, limitRange: limitRange, modelChecks: modelChecks, deriveEvidence: deriveEvidence, CRITERIA: CRITERIA, MISSION_IDX: MISSION_IDX, scoreFinding: scoreFinding, rankFindings: rankFindings,
    buoyantU: buoyantU, effFlow: effFlow, limitO2: limitO2, riskOf: riskOf, riskBand: riskBand, worstFlow: worstFlow, assess: assess,
    coverage: coverage, classify: classify, parseScenario: parseScenario, detectMission: detectMission,
    detectExperiments: detectExperiments, answer: answer, byId: function (id) { return byId[id]; }, reindex: reindex
  };
})(window.FF = window.FF || {});
