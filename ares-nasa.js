/* =============================================================================
 * BIO-ASTRO · Motor de telemetría NASA en vivo (DONKI + OSDR + GOES vía NOAA SWPC)
 * Todo pasa por el proxy local /nasa (bridge.rb) para evitar CORS.
 * La clave de API se guarda solo en este navegador (localStorage).
 *
 *  NASA DONKI (api.nasa.gov):  SEP · FLR · CME · GST · RBE · HSS · IPS   (30 días)
 *  NOAA SWPC (fuente de los datos GOES que usa DONKI): flujo de protones GOES (24 h) · Kp planetario (7 días)
 *  NASA OSDR: estudios reales de biología espacial, citas por sistema
 *
 * El acoplamiento fisiológico (multiplicador de dosis, probabilidad de apagón DSN)
 * es un MODELO BIO-ASTRO explicado en pantalla, no un producto oficial de NASA.
 * ========================================================================== */
(function (global) {
  'use strict';
  const LS_KEY = 'ares.nasaKey', LS_CACHE = 'ares.nasaCache2';
  const OSDR_TERMS = { neuro: 'astronaut', immune: 'Inspiration4', cardio: 'spaceflight cardiovascular', skeletal: 'bone loss spaceflight', radiation: 'space radiation' };
  const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  const N = {
    key: localStorage.getItem(LS_KEY) || 'DEMO_KEY',
    status: 'idle', error: null, fetchedAt: null, fromCache: false, rateRemaining: null,
    sep: null, flr: null, flrError: null, cme: null, gst: null, rbe: null, hss: null, ips: null,
    protons: null, kpSeries: null, sLevel: 0, gLevel: 0, timeline: [], osdr: {},
    swMult: 1, swActive: false, swReasons: [], kpNow: null, kpMax: null, blackout: 0.02,
    donkiError: null, cachedFields: [], listeners: [],
  };

  async function get(url) {
    // api.nasa.gov (DONKI) y NOAA SWPC permiten CORS → llamada DIRECTA a los endpoints oficiales.
    // OSDR no permite CORS → usa el proxy local (/nasa) si existe. Cada ruta sirve de respaldo de la otra.
    const direct = /^https:\/\/(api\.nasa\.gov|services\.swpc\.noaa\.gov)\//.test(url);
    const viaProxy = async () => {
      if (location.protocol === 'file:') return null;
      try { const p = await fetch('/nasa?url=' + encodeURIComponent(url), { cache: 'no-store' }); return p.status === 404 || p.status === 405 ? null : p; } catch (e) { return null; }
    };
    let r = null;
    if (direct) { try { r = await fetch(url, { cache: 'no-store' }); } catch (e) { r = await viaProxy(); } }
    else { r = await viaProxy(); if (!r) r = await fetch(url, { cache: 'no-store' }); }
    if (!r) throw new Error('sin conexión');
    const rem = r.headers.get('X-RateLimit-Remaining'); if (rem != null && /api\.nasa\.gov/.test(url)) N.rateRemaining = +rem;
    const txt = await r.text();
    if (!r.ok) { let m = `HTTP ${r.status}`; try { const j = JSON.parse(txt); m += ' · ' + (j.error?.message || j.error || j.msg || ''); } catch (e) { /* noop */ } throw new Error(m.trim()); }
    return txt.trim() ? JSON.parse(txt) : [];
  }
  const S_SCALE = [[1e5, 5], [1e4, 4], [1e3, 3], [100, 2], [10, 1]];       // NOAA: flujo protones ≥10 MeV (pfu)
  const S_MULT = [1, 1.5, 3, 6, 12, 20];                                    // modelo BIO-ASTRO (espacio libre, tras blindaje medio)

  /** Modelo BIO-ASTRO: clima espacial → multiplicador de dosis en espacio libre */
  function model() {
    const now = Date.now(), reasons = [];
    let mult = 1, active = false;
    if (N.sLevel > 0) { mult *= S_MULT[N.sLevel]; active = true; reasons.push(`Tormenta de radiación S${N.sLevel} en GOES (protones ≥10 MeV) → ×${S_MULT[N.sLevel]}`); }
    if (N.flr && N.flr.latest) {
      const f = N.flr.latest, hrs = (now - Date.parse(f.peakTime || f.beginTime)) / 36e5, cls = (f.classType || '')[0];
      if (hrs < 72 && (cls === 'X' || cls === 'M')) { const m = cls === 'X' ? 3 : 1.8; mult *= m; active = true; reasons.push(`Fulguración ${f.classType} hace ${hrs.toFixed(0)} h → ×${m}`); }
    } else if (N.cme && N.cme.fastest) {
      const c = N.cme.fastest, hrs = (now - Date.parse(c.time)) / 36e5;
      if (hrs < 72 && c.speed >= 1000) { const m = c.speed >= 1500 ? 1.6 : 1.3; mult *= m; active = active || c.speed >= 1500; reasons.push(`CME de ${c.speed} km/s hace ${hrs.toFixed(0)} h → ×${m}`); }
    }
    if (N.sep && N.sep.latest && N.sLevel === 0) {
      const d = (now - Date.parse(N.sep.latest.eventTime)) / 864e5;
      if (d < 3) { mult *= 2.5; active = true; reasons.push(`Evento SEP de DONKI hace ${d.toFixed(1)} días → ×2.5`); }
      else if (d < 30) { mult *= 1.15; reasons.push(`Evento SEP en los últimos 30 días → ×1.15`); }
    }
    N.swMult = Math.min(mult, 25); N.swActive = active; N.swReasons = reasons.length ? reasons : ['Sin eventos solares relevantes → ×1.0'];
    // Kp → probabilidad de apagón HF / DSN (escala NOAA G1–G5, modelo BIO-ASTRO)
    const kp = N.kpNow ?? 2, table = [[9, 0.9], [8, 0.7], [7, 0.45], [6, 0.25], [5, 0.1]];
    N.blackout = (table.find(([k]) => kp >= k) || [0, 0.02])[1];
    N.gLevel = kp >= 9 ? 5 : kp >= 8 ? 4 : kp >= 7 ? 3 : kp >= 6 ? 2 : kp >= 5 ? 1 : 0;
    buildTimeline();
  }

  function buildTimeline() {
    const ev = [];
    if (N.sep && N.sep.all) for (const e of N.sep.all) ev.push({ type: 'SEP', t: e.eventTime, id: e.id, txt: 'Partículas solares energéticas' });
    if (N.flr && N.flr.all) for (const e of N.flr.all) ev.push({ type: 'FLR', t: e.peakTime || e.beginTime, id: e.id, txt: `Fulguración ${e.classType}` });
    if (N.cme && N.cme.all) for (const e of N.cme.all) ev.push({ type: 'CME', t: e.time, id: e.id, txt: e.speed ? `CME ${e.speed} km/s (${e.type || '?'})` : 'CME' });
    if (N.gst && N.gst.all) for (const e of N.gst.all) ev.push({ type: 'GST', t: e.time, id: e.id, txt: `Tormenta geomagnética Kp ${e.kp}` });
    if (N.rbe && N.rbe.all) for (const e of N.rbe.all) ev.push({ type: 'RBE', t: e.time, id: e.id, txt: 'Realce de cinturón de radiación' });
    if (N.hss && N.hss.all) for (const e of N.hss.all) ev.push({ type: 'HSS', t: e.time, id: e.id, txt: 'Corriente de viento solar rápido' });
    if (N.ips && N.ips.all) for (const e of N.ips.all) ev.push({ type: 'IPS', t: e.time, id: e.id, txt: `Choque interplanetario (${e.loc || '—'})` });
    N.timeline = ev.filter((e) => e.t).sort((a, b) => Date.parse(b.t) - Date.parse(a.t));
  }

  async function fetchAll(force = true) {
    const cache = JSON.parse(localStorage.getItem(LS_CACHE) || 'null') || {};
    if (!force && cache.gstAt && Date.now() - Date.parse(cache.gstAt) < 15 * 60000) {
      for (const k of ['sep', 'flr', 'cme', 'gst', 'rbe', 'hss', 'ips', 'kpMax', 'osdr']) if (cache[k] !== undefined) N[k] = cache[k];
      N.flrError = cache.flr ? null : 'el servicio FLR de NASA no respondió en la última consulta';
      N.status = 'live'; N.fetchedAt = cache.gstAt; N.fromCache = true; N.donkiError = null;
      await fetchNoaa(); model(); emit(); return;     // NOAA no consume cuota de NASA: siempre en vivo
    }
    N.status = 'loading'; N.error = null; N.flrError = null; emit();
    const k = encodeURIComponent(N.key || 'DEMO_KEY'), today = day(0), D = (ep, n) => get(`https://api.nasa.gov/DONKI/${ep}?startDate=${day(n)}&endDate=${today}&api_key=${k}`);
    const names = ['sep', 'flr', 'cme', 'gst', 'rbe', 'hss', 'ips'];
    const results = await Promise.allSettled([D('SEP', 30), D('FLR', 30), D('CME', 30), D('GST', 30), D('RBE', 30), D('HSS', 30), D('IPS', 30),
      ...Object.values(OSDR_TERMS).map((t) => get(`https://osdr.nasa.gov/osdr/data/search?term=${encodeURIComponent(t)}&size=4`))]);
    const R = Object.fromEntries(names.map((n, i) => [n, results[i]])), osdr = results.slice(names.length);
    const val = (n) => (R[n].status === 'fulfilled' ? R[n].value || [] : null);
    let ok = 0; const nowIso = new Date().toISOString(); N.cachedFields = [];
    const keep = (name, parsed) => {
      if (parsed !== null) { N[name] = parsed; cache[name] = parsed; cache[name + 'At'] = nowIso; ok++; }
      else if (cache[name + 'At'] && name !== 'flr') { N[name] = cache[name]; N.cachedFields.push(`${name.toUpperCase()} (${new Date(cache[name + 'At']).toLocaleString()})`); }
      else N[name] = null;
    };
    const byTime = (a, f) => a.sort((x, y) => Date.parse(f(y)) - Date.parse(f(x)));
    let a;
    a = val('sep'); keep('sep', a && (byTime(a, (e) => e.eventTime), { count: a.length, all: a.map((e) => ({ id: e.sepID, eventTime: e.eventTime })), latest: a[0] ? { id: a[0].sepID, eventTime: a[0].eventTime, instruments: (a[0].instruments || []).map((i) => i.displayName) } : null }));
    a = val('flr'); keep('flr', a && (byTime(a, (e) => e.peakTime || e.beginTime), { count: a.length, strong: a.filter((f) => /^[MX]/.test(f.classType || '')).length, all: a.map((e) => ({ id: e.flrID, classType: e.classType, peakTime: e.peakTime, beginTime: e.beginTime })), latest: a[0] ? { id: a[0].flrID, classType: a[0].classType, peakTime: a[0].peakTime, beginTime: a[0].beginTime, region: a[0].activeRegionNum } : null }));
    if (R.flr.status === 'rejected') N.flrError = R.flr.reason.message;
    a = val('cme');
    if (a) {
      let best = null; const all = [];
      for (const c of a) { let sp = null, ty = null; for (const an of c.cmeAnalyses || []) if (an.speed && (!sp || an.speed > sp)) { sp = Math.round(an.speed); ty = an.type; } all.push({ id: c.activityID, time: c.startTime, speed: sp, type: ty }); if (sp && Date.now() - Date.parse(c.startTime) < 7 * 864e5 && (!best || sp > best.speed)) best = { id: c.activityID, speed: sp, type: ty, time: c.startTime }; }
      keep('cme', { count: a.length, all, fastest: best });
    } else keep('cme', null);
    a = val('gst'); keep('gst', a && { count: a.length, all: a.map((g) => ({ id: g.gstID, time: g.startTime, kp: Math.max(...(g.allKpIndex || [{ kpIndex: 0 }]).map((x) => x.kpIndex)) })) });
    N.kpMax = N.gst && N.gst.all.length ? Math.max(...N.gst.all.map((g) => g.kp)) : N.kpMax; cache.kpMax = N.kpMax;
    a = val('rbe'); keep('rbe', a && { count: a.length, all: a.map((e) => ({ id: e.rbeID, time: e.eventTime })) });
    a = val('hss'); keep('hss', a && { count: a.length, all: a.map((e) => ({ id: e.hssID, time: e.eventTime })) });
    a = val('ips'); keep('ips', a && { count: a.length, all: a.map((e) => ({ id: e.activityID, time: e.eventTime, loc: e.location })) });
    Object.keys(OSDR_TERMS).forEach((sys, i) => {
      if (osdr[i].status !== 'fulfilled') return; ok++;
      N.osdr[sys] = ((osdr[i].value.hits || {}).hits || []).map((h) => h._source).filter((s) => s && s.Accession).map((s) => ({ acc: s.Accession, title: s['Study Title'], url: /^OSD-/.test(s.Accession) ? `https://osdr.nasa.gov/bio/repo/data/studies/${s.Accession}` : `https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${s.Accession}` }));
    });
    if (Object.keys(N.osdr).length) cache.osdr = N.osdr; else if (cache.osdr) N.osdr = cache.osdr;
    const donkiRej = ['sep', 'cme', 'gst', 'rbe', 'hss', 'ips'].filter((n) => R[n].status === 'rejected');
    N.donkiError = donkiRej.length ? R[donkiRej[0]].reason.message : null;
    const noaaOk = await fetchNoaa(); if (noaaOk) ok++;
    // Sin datos en vivo NI en caché (límite de DEMO_KEY, sin internet, servicio caído): escenario de
    // REFERENCIA etiquetado como tal en pantalla. Nunca se presenta como dato en vivo de NASA.
    N.refFields = [];
    const hAgo = (h) => new Date(Date.now() - h * 36e5).toISOString().slice(0, 16) + 'Z';
    const REF = {
      sep: { count: 0, all: [], latest: null },
      flr: { count: 3, strong: 0, all: [{ id: 'REF-FLR', classType: 'C4.1', peakTime: hAgo(30) }], latest: { id: 'REF-FLR', classType: 'C4.1', peakTime: hAgo(30) } },
      cme: { count: 2, all: [{ id: 'REF-CME', time: hAgo(40), speed: 640, type: 'C' }], fastest: { id: 'REF-CME', time: hAgo(40), speed: 640, type: 'C' } },
      gst: { count: 0, all: [] },
    };
    const donkiDown = ['sep', 'cme', 'gst'].every((k) => N[k] == null);
    if (donkiDown) for (const k of Object.keys(REF)) if (N[k] == null) { N[k] = REF[k]; N.refFields.push(k.toUpperCase()); }
    if (N.kpNow == null) { N.kpNow = 2.3; N.refFields.push('Kp'); }
    if (!ok) { N.error = N.donkiError || 'sin conexión'; N.status = 'cache'; N.fromCache = true; N.reference = !N.cachedFields.length; }
    else { N.status = N.donkiError ? 'partial' : 'live'; N.fromCache = false; N.fetchedAt = nowIso; N.reference = false; }
    localStorage.setItem(LS_CACHE, JSON.stringify(cache));
    model(); emit();
  }

  /** NOAA SWPC: protones GOES (24 h) y Kp planetario — datos en tiempo real, sin cuota */
  async function fetchNoaa() {
    const [pr, kp] = await Promise.allSettled([
      get('https://services.swpc.noaa.gov/json/goes/primary/integral-protons-1-day.json'),
      get('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json'),
    ]);
    let ok = false;
    if (pr.status === 'fulfilled') {
      ok = true;
      const pick = (e) => pr.value.filter((x) => x.energy === e).map((x) => ({ t: x.time_tag, f: Math.max(x.flux, 1e-3) }));
      const p10 = pick('>=10 MeV'), p100 = pick('>=100 MeV');
      const sat = pr.value.length ? pr.value[pr.value.length - 1].satellite : null;
      const now10 = p10.length ? p10[p10.length - 1].f : null;
      N.protons = { p10, p100, sat, now10, now100: p100.length ? p100[p100.length - 1].f : null, max10: p10.length ? Math.max(...p10.map((x) => x.f)) : null, at: p10.length ? p10[p10.length - 1].t : null };
      N.sLevel = now10 != null ? (S_SCALE.find(([th]) => now10 >= th) || [0, 0])[1] : 0;
    }
    if (kp.status === 'fulfilled') {
      ok = true;
      const rows = Array.isArray(kp.value[0]) ? kp.value.slice(1).map((r) => ({ t: r[0], kp: +r[1] })) : kp.value.map((r) => ({ t: r.time_tag, kp: +r.Kp }));
      N.kpSeries = rows.filter((r) => Number.isFinite(r.kp));
      if (N.kpSeries.length) N.kpNow = N.kpSeries[N.kpSeries.length - 1].kp;
    }
    return ok;
  }

  function setKey(k) { N.key = (k || '').trim() || 'DEMO_KEY'; localStorage.setItem(LS_KEY, N.key); }
  function emit() { N.listeners.forEach((f) => { try { f(N); } catch (e) { /* noop */ } }); }
  function onChange(f) { N.listeners.push(f); }
  /** Resumen compacto para el paquete Earth-Sync */
  function summary() {
    return { source: N.fromCache ? 'cache' : N.status, fetchedAt: N.fetchedAt, sep: N.sep && { count: N.sep.count, latest: N.sep.latest && N.sep.latest.id },
      flare: N.flr ? N.flr.latest && { id: N.flr.latest.id, class: N.flr.latest.classType } : { unavailable: N.flrError }, cme: N.cme && N.cme.fastest,
      goesProtons10MeV_pfu: N.protons && N.protons.now10, noaaS: N.sLevel, kpNow: N.kpNow, kpMax30d: N.kpMax, noaaG: N.gLevel,
      events30d: N.timeline.length, neutronMultiplier: N.swMult, dsnBlackoutProbability: N.blackout };
  }
  // NOAA cada 5 min (los datos GOES se actualizan cada 5 min y no gastan cuota de NASA)
  setInterval(() => { fetchNoaa().then((ok) => { if (ok) { model(); emit(); } }); }, 5 * 60000);
  global.ARES_NASA = { N, fetchAll, fetchNoaa, setKey, onChange, summary, model };
})(typeof window !== 'undefined' ? window : globalThis);
