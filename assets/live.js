/* Live NASA data, fetched by each visitor's browser. Nothing here waits on a
 * scheduler or on any personal machine.
 *
 * Sources (all NASA or NASA-funded):
 *  - NASA Technical Reports Server: newest reports.
 *  - OpenAlex: newest NASA-affiliated papers.
 *  - Crossref: newest NASA-funded journal and conference papers.
 *  - NASA Image and Video Library: experiment imagery.
 *
 * Each source is tried in order until one answers:
 *  1. the project's relay (relay/worker.mjs): one shared, hourly-cached copy
 *     for all visitors; it is how browsers reach NTRS, which blocks them;
 *  2. the source itself, straight from the browser (OpenAlex, Crossref,
 *     NASA Images allow this);
 *  3. the starter copy published with the site (live/*.json);
 * and the last good copy stays saved on the device. One failing source never
 * empties the feed. */
(function (FF) {
  "use strict";
  // Set at publish time from the repository variable RELAY_URL.
  var RELAY = (function () {
    var m = document.querySelector('meta[name="ff-relay"]'), v = m && m.getAttribute("content");
    // https only; plain http is accepted for a relay running on this computer (development)
    return v && /^(https:\/\/|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$))/.test(v) ? v.replace(/\/$/, "") : "";
  })();

  // Direct-request fallbacks. Kept identical to relay/sources.mjs; the build
  // (scripts/check-queries.mjs) fails if they drift apart.
  var NASA_OPENALEX = "I4210124779", NASA_FUNDER = "10.13039/100000104";
  var OA = "https://api.openalex.org/works?select=id,doi,title,publication_date,primary_location,authorships,abstract_inverted_index,cited_by_count&sort=publication_date:desc&per-page=40&filter=authorships.institutions.lineage:" + NASA_OPENALEX + ",title_and_abstract.search:";
  var OA_QUERIES = ["microgravity AND (flame OR combustion OR fire OR smoke)",
    "(flammability OR \"fire safety\" OR \"flame spread\") AND (spacecraft OR lunar OR \"reduced gravity\" OR \"partial gravity\" OR microgravity)"];
  var CR = "https://api.crossref.org/works?select=DOI,title,published,published-online,container-title,author,abstract,is-referenced-by-count&rows=25";
  var CR_QUERIES = ["microgravity flame spread", "spacecraft fire safety", "partial gravity flammability", "microgravity combustion smoke suppression"];
  var IMG = "https://images-api.nasa.gov/search?media_type=image&page_size=24&q=";
  var IMG_QUERIES = ["microgravity flame", "combustion integrated rack", "spacecraft fire"];

  var CACHE = "ff.live.v3", SEEN = "ff.seen.v1";
  var MIN = 60 * 1000;
  // How often each source is asked again while the page is open.
  var TTL = { ntrs: 30 * MIN, openalex: 60 * MIN, crossref: 30 * MIN, images: 360 * MIN };

  var state = {
    items: [], images: [], newCount: 0, fetchedAt: null, relay: !!RELAY,
    status: {
      ntrs: { label: "NASA Technical Reports Server", state: "wait", at: null, count: 0 },
      openalex: { label: "OpenAlex (NASA-affiliated papers)", state: "wait", at: null, count: 0 },
      crossref: { label: "Crossref (NASA-funded papers)", state: "wait", at: null, count: 0 },
      images: { label: "NASA Image and Video Library", state: "wait", at: null, count: 0 }
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
  function pause(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function today() { return new Date().toISOString().slice(0, 10); }

  function fetchJSON(url, ms) {
    var ctl = new AbortController(), t = setTimeout(function () { ctl.abort(); }, ms || 15000);
    return fetch(url, { signal: ctl.signal, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .finally(function () { clearTimeout(t); });
  }

  /* ---------- shaping ---------- */
  function fromOpenAlex(w) {
    var loc = w.primary_location || {}, src = loc.source || {};
    return {
      uid: "OA-" + String(w.id || "").split("/").pop().replace(/[^A-Za-z0-9]/g, ""), source: "openalex", sourceLabel: txt(src.display_name, 120) || "OpenAlex",
      title: txt(w.title, 300), date: String(w.publication_date || "").slice(0, 10), abstract: txt(deinvert(w.abstract_inverted_index)),
      url: safeUrl(w.doi) || safeUrl(loc.landing_page_url) || safeUrl(w.id), doi: doiKey(w.doi), cited: w.cited_by_count || 0,
      authors: (w.authorships || []).slice(0, 4).map(function (a) { return txt(a.author && a.author.display_name, 80); }).filter(Boolean)
    };
  }
  function fromNTRS(r) {
    var id = String(r.id || "");
    if (!/^\d+$/.test(id)) return null;   // NTRS ids are numeric; anything else is malformed
    return {
      uid: "NTRS-" + id, source: "ntrs", sourceLabel: "NTRS" + (r.venue ? " · " + txt(r.venue, 100) : ""), title: txt(r.title, 300),
      date: String(r.date || "").slice(0, 10), abstract: txt(r.abstract), url: "https://ntrs.nasa.gov/citations/" + id, doi: doiKey(r.doi), cited: null,
      authors: (r.authors || []).slice(0, 4).map(function (a) { return txt(a, 80); }), center: txt(r.center, 80)
    };
  }
  function crDate(p) {
    var d = (p && p["date-parts"] && p["date-parts"][0]) || [];
    return d[0] ? d[0] + "-" + ("0" + (d[1] || 1)).slice(-2) + "-" + ("0" + (d[2] || 1)).slice(-2) : "";
  }
  function fromCrossref(w) {
    var doi = String(w.DOI || "").toLowerCase(), venue = txt((w["container-title"] || [])[0], 120);
    // "published" is the earliest of the online and print dates. A later date
    // means an accepted paper scheduled for a coming issue: shown as in press.
    var date = crDate(w["published-online"]) || crDate(w.published), inPress = !!date && date > today();
    return {
      uid: "CR-" + hashId(doi), source: "crossref", sourceLabel: venue || "Crossref",
      title: txt((w.title || [])[0], 300), date: date, inPress: inPress, abstract: txt(w.abstract),
      url: doi ? "https://doi.org/" + encodeURI(doi) : "", doi: doi, cited: w["is-referenced-by-count"] || 0,
      authors: (w.author || []).slice(0, 4).map(function (a) { return txt([a.given, a.family].filter(Boolean).join(" "), 80); }).filter(Boolean)
    };
  }
  function itemsOf(source, d) {
    if (!d) return [];
    if (source === "ntrs") return (d.items || []).map(fromNTRS).filter(Boolean);
    if (source === "openalex") return (d.results || []).map(fromOpenAlex);
    return ((d.message || {}).items || []).map(fromCrossref);
  }
  function merge(lists) {
    var seenDoi = new Map(), seenTitle = new Set(), out = [];
    lists.forEach(function (list) {
      list.forEach(function (it) {
        var tk = it.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 80);
        if (!it.title || !it.date || seenTitle.has(tk) || (it.doi && seenDoi.has(it.doi))) return;
        seenTitle.add(tk); if (it.doi) seenDoi.set(it.doi, 1);
        it.cls = FF.engine.classify(it.title, it.abstract);
        out.push(it);
      });
    });
    // newest first; in-press papers follow the published ones
    return out.filter(function (it) { return it.cls.relevant; })
      .sort(function (a, b) { return (a.inPress === b.inPress ? 0 : a.inPress ? 1 : -1) || b.date.localeCompare(a.date); });
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

  /* ---------- fetching, with fallbacks ---------- */
  var data = { ntrs: [], openalex: [], crossref: [] };
  function finish() {
    state.items = merge([data.ntrs, data.openalex, data.crossref]);
    markNew();
    FF.engine.setLive(state.items);
    state.fetchedAt = new Date().toISOString();
    store(CACHE, { at: state.fetchedAt, data: data, images: state.images, status: state.status });
    emit();
  }
  function due(k, force) { var s = state.status[k]; return force || !s.ok || Date.now() - s.ok > TTL[k]; }

  function direct(source) {
    if (source === "openalex") {
      return Promise.all(OA_QUERIES.map(function (q) { return fetchJSON(OA + encodeURIComponent(q)); }))
        .then(function (pages) { return { results: [].concat.apply([], pages.map(function (p) { return p.results || []; })) }; });
    }
    if (source === "crossref") {
      // Keyless Crossref allows 1 request per second, 1 at a time; its 429
      // replies carry no CORS header. So one query at a time, 1.1 s apart.
      var since = new Date(Date.now() - 3 * 365 * 864e5).toISOString().slice(0, 10);
      return CR_QUERIES.reduce(function (chain, q, i) {
        return chain.then(function (acc) {
          return (i ? pause(1100) : Promise.resolve()).then(function () {
            return fetchJSON(CR + "&filter=funder:" + NASA_FUNDER + ",from-pub-date:" + since + "&query.bibliographic=" + encodeURIComponent(q));
          }).then(function (d) { return acc.concat((d.message || {}).items || []); }, function () { return acc; });
        });
      }, Promise.resolve([])).then(function (items) { if (!items.length) throw new Error("no response"); return { message: { items: items } }; });
    }
    return Promise.reject(new Error("no direct route"));   // NTRS blocks browsers
  }

  // Try each route in turn; resolve with the first usable answer.
  function getSource(source) {
    var routes = [];
    var snap = window.FF_SNAPSHOT && window.FF_SNAPSHOT[source];
    if (location.protocol === "file:") {   // the single-file offline edition
      if (snap) routes.push(["copy built into this file", function () { return Promise.resolve(snap); }]);
    } else {
      if (RELAY) routes.push(["relay", function () { return fetchJSON(RELAY + "/v1/" + source, 30000); }]);
      if (source !== "ntrs") routes.push(["direct", function () { return direct(source); }]);
      routes.push(["site copy", function () { return fetchJSON("live/" + source + ".json?t=" + Math.floor(Date.now() / 600000)); }]);
    }
    var errors = [];
    return routes.reduce(function (chain, r) {
      return chain.then(function (found) {
        if (found) return found;
        // .catch after .then, so an answer with no usable data also falls through to the next route
        return r[1]().then(function (d) {
          var items = itemsOf(source, d);
          if (!items.length) throw new Error("no data");
          return { items: items, via: r[0], at: d.generatedAt || new Date().toISOString() };
        }).catch(function (e) { errors.push(r[0] + ": " + e.message); return null; });
      });
    }, Promise.resolve(null)).then(function (found) { if (!found) throw new Error(errors.join("; ") || "unavailable"); return found; });
  }

  function refresh(force) {
    var cached = load(CACHE);
    if (cached && !state.items.length && cached.data) {
      data = { ntrs: cached.data.ntrs || [], openalex: cached.data.openalex || [], crossref: cached.data.crossref || [] };
      state.images = cached.images || [];
      Object.keys(state.status).forEach(function (k) {
        var c = cached.status && cached.status[k]; if (!c) return;
        var s = state.status[k]; s.at = c.at; s.ok = c.ok || 0; s.count = c.count; s.via = c.via; s.state = "cached";
      });
      state.items = merge([data.ntrs, data.openalex, data.crossref]); markNew(); FF.engine.setLive(state.items); state.fetchedAt = cached.at; emit();
    }
    if (!navigator.onLine && state.items.length) return Promise.resolve(state);
    var todo = Object.keys(TTL).filter(function (k) { return due(k, force); });
    if (!todo.length) return Promise.resolve(state);
    todo.forEach(function (k) { state.status[k].state = "wait"; });
    emit();
    function done(k, count, at, via) { var s = state.status[k]; s.state = "ok"; s.ok = Date.now(); s.at = at; s.count = count; s.via = via; s.error = null; }
    function failed(k) { return function (e) { state.status[k].state = "err"; state.status[k].error = e.message; }; }

    var jobs = ["ntrs", "openalex", "crossref"].filter(function (k) { return todo.indexOf(k) >= 0; }).map(function (k) {
      return getSource(k).then(function (r) {
        data[k] = r.items; done(k, r.items.length, r.at, r.via);
        finish();   // show each source as soon as it arrives
      }).catch(failed(k));
    });

    if (todo.indexOf("images") >= 0) jobs.push(Promise.all(IMG_QUERIES.map(function (q) { return fetchJSON(IMG + encodeURIComponent(q)).catch(function () { return null; }); })).then(function (res) {
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
      done("images", state.images.length, new Date().toISOString(), "direct");
    }).catch(failed("images")));

    return Promise.all(jobs).then(function () { finish(); return state; });
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
    state: state, refresh: refresh, markSeen: markSeen, digest: digest, relay: RELAY,
    onChange: function (f) { listeners.push(f); }
  };
})(window.FF = window.FF || {});
