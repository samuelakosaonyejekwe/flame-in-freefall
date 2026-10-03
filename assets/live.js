/* Live NASA data. Runs entirely in each visitor's browser:
 *  - OpenAlex: newest NASA-affiliated papers on microgravity flames and
 *    spacecraft fire (CORS-enabled, fetched live on every visit).
 *  - NASA Image and Video Library: experiment imagery (live).
 *  - NASA Technical Reports Server: a snapshot refreshed every 6 hours by a
 *    scheduled GitHub Actions build (NTRS does not allow browser requests).
 * Results are cached locally so the dashboard opens instantly and offline. */
(function (FF) {
  "use strict";
  var NASA_OPENALEX = "I4210124779"; // National Aeronautics and Space Administration (incl. centers)
  var OA = "https://api.openalex.org/works?select=id,doi,title,publication_date,primary_location,authorships,abstract_inverted_index,cited_by_count&sort=publication_date:desc&per-page=40&filter=authorships.institutions.lineage:" + NASA_OPENALEX + ",title_and_abstract.search:";
  var OA_QUERIES = ["microgravity AND (flame OR combustion OR fire OR smoke)", "(spacecraft OR habitat OR lunar OR \"partial gravity\") AND (fire OR flammability OR flame)"];
  var IMG = "https://images-api.nasa.gov/search?media_type=image&page_size=24&q=";
  var IMG_QUERIES = ["microgravity flame", "combustion integrated rack", "spacecraft fire"];
  var CACHE = "ff.live.v1", SEEN = "ff.seen.v1", MAX_AGE = 10 * 60 * 1000;

  var state = {
    items: [], images: [], newCount: 0, fetchedAt: null,
    status: {
      openalex: { label: "OpenAlex (NASA-affiliated papers)", mode: "Live in your browser", state: "wait", at: null, count: 0 },
      ntrs: { label: "NASA Technical Reports Server", mode: "Snapshot, refreshed every 6 h", state: "wait", at: null, count: 0 },
      images: { label: "NASA Image and Video Library", mode: "Live in your browser", state: "wait", at: null, count: 0 }
    }
  };
  var listeners = [];
  function emit() { listeners.forEach(function (f) { try { f(state); } catch (e) { console.error(e); } }); }

  function store(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  function load(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }

  function txt(s, n) { return String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, n || 1500); }
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

  function merge(lists) {
    var seenDoi = new Map(), seenTitle = new Set(), out = [];
    lists.forEach(function (list) {
      list.forEach(function (it) {
        var tk = it.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 80);
        if (!it.title || seenTitle.has(tk) || (it.doi && seenDoi.has(it.doi))) return;
        seenTitle.add(tk); if (it.doi) seenDoi.set(it.doi, 1);
        it.cls = FF.engine.classify(it.title + " " + it.abstract);
        out.push(it);
      });
    });
    return out.filter(function (it) { return it.cls.relevance >= 0.25; }).sort(function (a, b) { return b.date.localeCompare(a.date); });
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

  var lastOA = [], lastNTRS = [];
  function finish() {
    state.items = merge([lastNTRS, lastOA]);
    markNew();
    FF.engine.setLive(state.items);
    state.fetchedAt = new Date().toISOString();
    store(CACHE, { at: state.fetchedAt, oa: lastOA, ntrs: lastNTRS, images: state.images, status: state.status });
    emit();
  }

  function refresh(force) {
    var cached = load(CACHE);
    if (cached && !state.items.length) {
      lastOA = cached.oa || []; lastNTRS = cached.ntrs || []; state.images = cached.images || [];
      Object.keys(state.status).forEach(function (k) { if (cached.status && cached.status[k]) { state.status[k].at = cached.status[k].at; state.status[k].count = cached.status[k].count; state.status[k].state = "cached"; } });
      state.items = merge([lastNTRS, lastOA]); markNew(); FF.engine.setLive(state.items); state.fetchedAt = cached.at; emit();
      if (!force && cached.at && Date.now() - Date.parse(cached.at) < MAX_AGE) return Promise.resolve(state);
    }
    if (!navigator.onLine && state.items.length) return Promise.resolve(state);
    Object.keys(state.status).forEach(function (k) { state.status[k].state = "wait"; });
    emit();

    var pOA = Promise.all(OA_QUERIES.map(function (q) { return fetchJSON(OA + encodeURIComponent(q)); })).then(function (res) {
      lastOA = [].concat.apply([], res.map(function (d) { return (d.results || []).map(fromOpenAlex); }));
      state.status.openalex.state = "ok"; state.status.openalex.at = new Date().toISOString(); state.status.openalex.count = lastOA.length;
    }).catch(function (e) { state.status.openalex.state = "err"; state.status.openalex.error = e.message; });

    var pNTRS = fetchJSON("live/ntrs.json?t=" + Math.floor(Date.now() / 600000)).then(function (d) {
      lastNTRS = (d.items || []).map(fromNTRS);
      state.status.ntrs.state = "ok"; state.status.ntrs.at = d.generatedAt; state.status.ntrs.count = lastNTRS.length;
    }).catch(function (e) { state.status.ntrs.state = "err"; state.status.ntrs.error = e.message; });

    var pIMG = Promise.all(IMG_QUERIES.map(function (q) { return fetchJSON(IMG + encodeURIComponent(q)).catch(function () { return null; }); })).then(function (res) {
      var seen = new Set(), imgs = [];
      res.forEach(function (d) {
        ((d && d.collection && d.collection.items) || []).forEach(function (it) {
          var meta = (it.data || [])[0] || {}, link = (it.links || []).find(function (l) { return l.render === "image"; });
          var href = link && safeUrl(link.href);
          if (!href || seen.has(meta.nasa_id) || !/^https:\/\/images-assets\.nasa\.gov\//.test(href)) return;
          seen.add(meta.nasa_id);
          imgs.push({ id: meta.nasa_id, title: txt(meta.title, 140), date: (meta.date_created || "").slice(0, 10), center: meta.center || "",
            thumb: href.replace(/~(orig|large|medium)\./, "~thumb."), page: "https://images.nasa.gov/details/" + encodeURIComponent(meta.nasa_id) });
        });
      });
      if (!imgs.length) throw new Error("no images");
      state.images = imgs.sort(function (a, b) { return b.date.localeCompare(a.date); }).slice(0, 18);
      state.status.images.state = "ok"; state.status.images.at = new Date().toISOString(); state.status.images.count = state.images.length;
    }).catch(function (e) { state.status.images.state = "err"; state.status.images.error = e.message; });

    return Promise.all([pOA, pNTRS, pIMG]).then(function () { finish(); return state; });
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
