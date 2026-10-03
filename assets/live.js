/* Live research data, fetched by each visitor's browser. Freshness does not
 * depend on any scheduler: three independent public APIs are read directly.
 *  - OpenAlex: newest NASA-affiliated papers on microgravity flames and
 *    spacecraft fire.
 *  - Crossref: newest journal and conference papers on fire in space from
 *    any institution, including NASA conference papers also filed in NTRS.
 *  - NASA Image and Video Library: experiment imagery.
 *  - NASA Technical Reports Server: NTRS blocks browser requests, so a
 *    GitHub Actions build adds a snapshot when it runs. It is a bonus, not a
 *    requirement: the three live sources keep the feed current without it.
 * Each source has its own refresh interval (kind to free APIs) and its own
 * saved copy, so one failing or rate-limited source never blanks the feed. */
(function (FF) {
  "use strict";
  var NASA_OPENALEX = "I4210124779"; // National Aeronautics and Space Administration (incl. centers)
  var OA = "https://api.openalex.org/works?select=id,doi,title,publication_date,primary_location,authorships,abstract_inverted_index,cited_by_count&sort=publication_date:desc&per-page=40&filter=authorships.institutions.lineage:" + NASA_OPENALEX + ",title_and_abstract.search:";
  // Two focused queries; broader ones (e.g. "spacecraft AND fire") return unrelated NASA work.
  var OA_QUERIES = ["microgravity AND (flame OR combustion OR fire OR smoke)",
    "(flammability OR \"fire safety\" OR \"flame spread\") AND (spacecraft OR lunar OR \"reduced gravity\" OR \"partial gravity\" OR microgravity)"];
  var IMG = "https://images-api.nasa.gov/search?media_type=image&page_size=24&q=";
  var IMG_QUERIES = ["microgravity flame", "combustion integrated rack", "spacecraft fire"];
  // Crossref: relevance-ranked (sorting by date discards relevance), recent only.
  var CR = "https://api.crossref.org/works?select=DOI,title,published,container-title,author,abstract,is-referenced-by-count&rows=25&query.bibliographic=";
  var CR_QUERIES = ["microgravity flame spread", "spacecraft fire safety", "partial gravity flammability", "microgravity combustion smoke suppression"];
  var CACHE = "ff.live.v2", SEEN = "ff.seen.v1";
  var MIN = 60 * 1000, TTL = { openalex: 60 * MIN, crossref: 30 * MIN, images: 360 * MIN, ntrs: 10 * MIN };

  var state = {
    items: [], images: [], newCount: 0, fetchedAt: null,
    status: {
      openalex: { label: "OpenAlex (NASA-affiliated papers)", mode: "Live in your browser", state: "wait", at: null, count: 0 },
      crossref: { label: "Crossref (journal and conference papers)", mode: "Live in your browser", state: "wait", at: null, count: 0 },
      ntrs: { label: "NASA Technical Reports Server", mode: "Bonus snapshot from the site's build", state: "wait", at: null, count: 0 },
      images: { label: "NASA Image and Video Library", mode: "Live in your browser", state: "wait", at: null, count: 0 }
    }
  };
  var listeners = [];
  function emit() { listeners.forEach(function (f) { try { f(state); } catch (e) { console.error(e); } }); }

  function store(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  function load(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }

  function txt(s, n) {
    var t = String(s || "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, "&");
    return t.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, n || 1500);
  }
  // Short, citation-safe id from a DOI (letters, digits, dashes only).
  function hashId(str) { var h = 5381; for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0; return h.toString(36).toUpperCase(); }
  function deinvert(ix) {
    if (!ix) return "";
    var words = [];
    Object.keys(ix).forEach(function (w) { ix[w].forEach(function (p) { words[p] = w; }); });
    return words.join(" ");
  }
  function doiKey(d) { return String(d || "").toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, ""); }
  function safeUrl(u) { try { var x = new URL(u); return x.protocol === "https:" ? x.href : ""; } catch (e) { return ""; } }

  function fetchJSON(url, ms) {
    var ctl = new AbortController(), t = setTimeout(function () { ctl.abort(); }, ms || 15000);
    return fetch(url, { signal: ctl.signal, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .finally(function () { clearTimeout(t); });
  }

  function fromOpenAlex(w) {
    var loc = w.primary_location || {}, src = loc.source || {};
    return {
      uid: "OA-" + String(w.id || "").split("/").pop(), source: "openalex", sourceLabel: src.display_name || "OpenAlex",
      title: txt(w.title, 300), date: w.publication_date || "", abstract: txt(deinvert(w.abstract_inverted_index)),
      url: safeUrl(w.doi) || safeUrl(loc.landing_page_url) || safeUrl(w.id), doi: doiKey(w.doi), cited: w.cited_by_count || 0,
      authors: (w.authorships || []).slice(0, 4).map(function (a) { return a.author && a.author.display_name; }).filter(Boolean)
    };
  }
  function fromNTRS(r) {
    return {
      uid: "NTRS-" + r.id, source: "ntrs", sourceLabel: "NTRS" + (r.venue ? " · " + r.venue : ""), title: txt(r.title, 300),
      date: r.date || "", abstract: txt(r.abstract), url: safeUrl(r.url), doi: doiKey(r.doi), cited: null, authors: r.authors || [], center: r.center
    };
  }

  function fromCrossref(w) {
    var d = ((w.published || {})["date-parts"] || [[]])[0], doi = String(w.DOI || "").toLowerCase();
    var date = d[0] ? d[0] + "-" + ("0" + (d[1] || 1)).slice(-2) + "-" + ("0" + (d[2] || 1)).slice(-2) : "";
    var venue = txt((w["container-title"] || [])[0], 120);
    return {
      uid: "CR-" + hashId(doi), source: "crossref", sourceLabel: venue || "Crossref",
      title: txt((w.title || [])[0], 300), date: date, abstract: txt(w.abstract), url: doi ? "https://doi.org/" + encodeURI(doi) : "",
      doi: doi, cited: w["is-referenced-by-count"] || 0,
      authors: (w.author || []).slice(0, 4).map(function (a) { return txt([a.given, a.family].filter(Boolean).join(" "), 80); }).filter(Boolean)
    };
  }
  function merge(lists) {
    var seenDoi = new Map(), seenTitle = new Set(), out = [];
    lists.forEach(function (list) {
      list.forEach(function (it) {
        var tk = it.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 80);
        if (!it.title || seenTitle.has(tk) || (it.doi && seenDoi.has(it.doi))) return;
        seenTitle.add(tk); if (it.doi) seenDoi.set(it.doi, 1);
        it.cls = FF.engine.classify(it.title, it.abstract);
        out.push(it);
      });
    });
    return out.filter(function (it) { return it.cls.relevant; }).sort(function (a, b) { return b.date.localeCompare(a.date); });
  }

  function markNew() {
    var seen = load(SEEN), first = !seen;
    var set = new Set(seen || []);
    state.newCount = 0;
    state.items.forEach(function (it) { it.isNew = !first && !set.has(it.uid); if (it.isNew) state.newCount++; });
  }
  function markSeen() {
    var ids = state.items.map(function (it) { return it.uid; });
    var prev = load(SEEN) || [];
    store(SEEN, Array.from(new Set(ids.concat(prev))).slice(0, 1500));
  }

  var lastOA = [], lastCR = [], lastNTRS = [];
  function finish() {
    state.items = merge([lastNTRS, lastOA, lastCR]);
    markNew();
    FF.engine.setLive(state.items);
    state.fetchedAt = new Date().toISOString();
    store(CACHE, { at: state.fetchedAt, oa: lastOA, cr: lastCR, ntrs: lastNTRS, images: state.images, status: state.status });
    emit();
  }
  // A source is due when its last success is older than its interval.
  function due(k, force) { var s = state.status[k]; return force || !s.ok || Date.now() - s.ok > TTL[k]; }

  function refresh(force) {
    var cached = load(CACHE);
    if (cached && !state.items.length) {
      lastOA = cached.oa || []; lastCR = cached.cr || []; lastNTRS = cached.ntrs || []; state.images = cached.images || [];
      Object.keys(state.status).forEach(function (k) {
        var c = cached.status && cached.status[k]; if (!c) return;
        state.status[k].at = c.at; state.status[k].ok = c.ok || 0; state.status[k].count = c.count; state.status[k].state = "cached";
      });
      state.items = merge([lastNTRS, lastOA, lastCR]); markNew(); FF.engine.setLive(state.items); state.fetchedAt = cached.at; emit();
    }
    if (!navigator.onLine && state.items.length) return Promise.resolve(state);
    var todo = Object.keys(TTL).filter(function (k) { return due(k, force); });
    if (!todo.length) return Promise.resolve(state);
    todo.forEach(function (k) { state.status[k].state = "wait"; });
    emit();
    function done(k, count, at) { var s = state.status[k]; s.state = "ok"; s.ok = Date.now(); s.at = at || new Date().toISOString(); s.count = count; s.error = null; }
    function failed(k) { return function (e) { state.status[k].state = "err"; state.status[k].error = e.message; }; }

    var pOA = todo.indexOf("openalex") < 0 ? null : Promise.all(OA_QUERIES.map(function (q) { return fetchJSON(OA + encodeURIComponent(q)); })).then(function (res) {
      lastOA = [].concat.apply([], res.map(function (d) { return (d.results || []).map(fromOpenAlex); }));
      done("openalex", lastOA.length);
      finish();   // show each source as soon as it arrives
    }).catch(failed("openalex"));

    var since = new Date(Date.now() - 3 * 365 * 864e5).toISOString().slice(0, 10), today = new Date().toISOString().slice(0, 10);
    // Crossref's keyless limit is 1 request per second, 1 at a time (its
    // x-rate-limit headers); over-limit 429 replies carry no CORS header. So
    // queries run one after another, 1.1 s apart.
    var pause = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var pCR = todo.indexOf("crossref") < 0 ? null : CR_QUERIES.reduce(function (chain, q, i) {
      return chain.then(function (acc) {
        return (i ? pause(1100) : Promise.resolve()).then(function () {
          return fetchJSON(CR + encodeURIComponent(q) + "&filter=from-pub-date:" + since);
        }).then(function (d) { return acc.concat([d]); }, function () { return acc.concat([null]); });
      });
    }, Promise.resolve([])).then(function (res) {
      var ok = res.filter(Boolean);
      if (!ok.length) throw new Error("no response");
      lastCR = [].concat.apply([], ok.map(function (d) { return ((d.message || {}).items || []).map(fromCrossref); }))
        .filter(function (it) { return it.date && it.date <= today; });   // "published" is the earliest date; later means not out yet
      done("crossref", lastCR.length);
      finish();
    }).catch(failed("crossref"));

    // The single-file offline edition carries its own snapshot; a file:// page cannot fetch one.
    var snap = window.FF_SNAPSHOT && window.FF_SNAPSHOT.ntrs;
    var getNTRS = location.protocol === "file:" && snap ? Promise.resolve(snap) :
      fetchJSON("live/ntrs.json?t=" + Math.floor(Date.now() / 600000)).catch(function (e) { if (snap) return snap; throw e; });
    var pNTRS = todo.indexOf("ntrs") < 0 ? null : getNTRS.then(function (d) {
      lastNTRS = (d.items || []).map(fromNTRS);
      done("ntrs", lastNTRS.length, d.generatedAt);
      finish();
    }).catch(failed("ntrs"));

    var pIMG = todo.indexOf("images") < 0 ? null : Promise.all(IMG_QUERIES.map(function (q) { return fetchJSON(IMG + encodeURIComponent(q)).catch(function () { return null; }); })).then(function (res) {
      var seen = new Set(), imgs = [];
      res.forEach(function (d) {
        ((d && d.collection && d.collection.items) || []).forEach(function (it) {
          var meta = (it.data || [])[0] || {}, link = (it.links || []).find(function (l) { return l.render === "image"; });
          var href = link && safeUrl(link.href);
          if (!href || seen.has(meta.nasa_id) || !/^https:\/\/images-assets\.nasa\.gov\//.test(href)) return;
          seen.add(meta.nasa_id);
          imgs.push({ id: meta.nasa_id, title: txt(meta.title, 140), date: (meta.date_created || "").slice(0, 10), center: meta.center || "",
            thumb: href.replace(/~(orig|large|medium|small)\./, "~thumb."), page: "https://images.nasa.gov/details/" + encodeURIComponent(meta.nasa_id) });
        });
      });
      if (!imgs.length) throw new Error("no images");
      state.images = imgs.sort(function (a, b) { return b.date.localeCompare(a.date); }).slice(0, 18);
      done("images", state.images.length);
    }).catch(failed("images"));

    return Promise.all([pOA, pCR, pNTRS, pIMG]).then(function () { finish(); return state; });
  }

  // Extractive digest: the two abstract sentences densest in fire-safety terms.
  var DIGEST_KW = /flame|fire|combust|flammab|extinct|ignit|spread|soot|smoke|oxygen|gravity|suppress|detect|limit|spacecraft|lunar|mars/gi;
  function digest(it) {
    var s = (it.abstract || "").replace(/([.!?])\s+(?=[A-Z])/g, "$1\u0001").split("\u0001").filter(function (x) { return x.length > 40 && x.length < 420; });
    if (!s.length) return "";
    var scored = s.map(function (x, i) { var m = x.match(DIGEST_KW); return { x: x, i: i, sc: (m ? m.length : 0) / Math.sqrt(x.length / 80) + (i === 0 ? 0.3 : 0) + (/we (find|found|show)|results (show|indicate)|conclu/i.test(x) ? 1 : 0) }; });
    return scored.sort(function (a, b) { return b.sc - a.sc; }).slice(0, 2).sort(function (a, b) { return a.i - b.i; }).map(function (o) { return o.x; }).join(" ");
  }

  FF.live = {
    state: state, refresh: refresh, markSeen: markSeen, digest: digest,
    onChange: function (f) { listeners.push(f); }
  };
})(window.FF = window.FF || {});
