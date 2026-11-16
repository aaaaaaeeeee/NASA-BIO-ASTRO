/* =============================================================================
 * BIO-ASTRO · Pestaña "☢ RADIACIÓN" — Centro de radiación y clima espacial
 * Datos reales: NASA DONKI (SEP, FLR, CME, GST, RBE, HSS, IPS), GOES (protones, vía NOAA SWPC),
 * Kp planetario (NOAA SWPC), NASA OSDR. Dosis de referencia publicadas por ubicación.
 * Lee el estado del hábitat y del triaje desde ARES_BODY (no duplica lógica).
 * ========================================================================== */
(() => {
  'use strict';
  const { Engine, clamp } = window.ARES;
  const NASA = window.ARES_NASA, B = window.ARES_BODY;
  const $ = (id) => document.getElementById(id);
  const fmt = (v, d = 0) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d));
  const C = { ok: '#10B981', warn: '#F59E0B', crit: '#EF4444', na: '#63636E', cyan: '#38BDF8', violet: '#D4FF33', blue: '#38BDF8' };
  const S_COL = ['#10B981', '#FFE14D', '#F59E0B', '#FF7A1A', '#EF4444', '#C21DFF'];
  const S_TXT = ['S0 · sin tormenta de radiación', 'S1 · menor', 'S2 · moderada', 'S3 · fuerte', 'S4 · severa', 'S5 · extrema'];
  const G_TXT = ['G0 · sin tormenta geomagnética', 'G1 · menor', 'G2 · moderada', 'G3 · fuerte', 'G4 · severa', 'G5 · extrema'];
  const EV_COL = { SEP: C.crit, FLR: '#FF7A1A', CME: C.warn, GST: C.violet, RBE: '#FF5722', HSS: C.cyan, IPS: '#A0A0AB' };
  const EV_TXT = { SEP: 'Partículas solares (SEP)', FLR: 'Fulguraciones (FLR)', CME: 'Eyecciones de masa coronal (CME)', GST: 'Tormentas geomagnéticas (GST)', RBE: 'Cinturones de radiación (RBE)', HSS: 'Viento solar rápido (HSS)', IPS: 'Choques interplanetarios (IPS)' };
  const CAREER = 600, BFO30 = 250, EARTH_BG = 2.4 / 365; // NASA-STD-3001: carrera 600 mSv · 30 días órganos hematopoyéticos 250 mGy-Eq · fondo natural Tierra 2.4 mSv/año (UNSCEAR)

  /* ------------------------------------------------------------------ estilos + pestaña */
  const css = document.createElement('style');
  css.textContent = `
  .r4 { display:grid; grid-template-columns:1.25fr 1fr 1fr 1fr; gap:12px; }
  .r2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .r3 { display:grid; grid-template-columns:1.2fr 1fr 1fr; gap:12px; }
  @media (max-width:1200px) { .r4, .r2, .r3 { grid-template-columns:1fr; } }
  .rhero { font-family:ui-monospace,Menlo,monospace; font-size:76px; font-weight:800; line-height:1; letter-spacing:-.02em; }
  .rbig { font-family:ui-monospace,Menlo,monospace; font-size:54px; font-weight:800; line-height:1; }
  .rsub { font-family:ui-monospace,Menlo,monospace; font-size:11px; color:#A0A0AB; letter-spacing:.06em; }
  .rcv { width:100%; display:block; background:rgba(0,0,0,.35); border:1px solid rgba(255,255,255,.05); border-radius:4px; }
  .rrow { display:flex; justify-content:space-between; gap:10px; font-size:11.5px; padding:5px 0; border-bottom:1px solid rgba(255,255,255,.05); }
  .rrow span:last-child { font-family:ui-monospace,Menlo,monospace; color:#fff; text-align:right; }
  .rbar { height:14px; background:rgba(255,255,255,.07); border-radius:3px; overflow:hidden; position:relative; }
  .rbar > div { height:100%; transition:width .6s; }
  .rbar .lim { position:absolute; top:-3px; bottom:-3px; width:2px; background:#fff; }
  .evrow { display:grid; grid-template-columns:70px 120px 1fr; gap:8px; font-size:11px; padding:4px 0; border-bottom:1px solid rgba(255,255,255,.05); }
  .evrow .ty { font-family:ui-monospace,Menlo,monospace; font-weight:700; }
  .srcs a, .srcs span.s { display:inline-block; font-family:ui-monospace,Menlo,monospace; font-size:10px; padding:3px 7px; border:1px solid rgba(56,189,248,.35); color:#A0A0AB; border-radius:3px; margin:0 5px 5px 0; text-decoration:none; }
  .srcs a:hover { border-color:#fff; color:#fff; }
  .rbanner { font-family:ui-monospace,Menlo,monospace; font-size:14px; font-weight:800; letter-spacing:.06em; padding:10px 14px; border:1px solid; border-radius:6px; display:flex; align-items:center; gap:14px; flex-wrap:wrap; }
  .zonebtn { flex:1; border:1px solid rgba(255,255,255,.12); border-radius:5px; padding:8px; text-align:left; background:none; color:#F4F3EF; cursor:pointer; }
  .zonebtn.on { border-color:#fff; background:rgba(56,189,248,.1); }
  .zonebtn b { font-family:ui-monospace,Menlo,monospace; font-size:18px; display:block; }
  `;
  document.head.appendChild(css);
  const nav = document.getElementById('tabs');
  const tb = document.createElement('button');
  tb.className = 'btn'; tb.dataset.tab = 'RAD'; tb.style.cssText = 'font-size:12.5px;padding:9px 16px;border-color:var(--red);color:var(--red)';
  tb.textContent = '☢ RADIACIÓN · CLIMA ESPACIAL NASA';
  nav.insertBefore(tb, document.getElementById('ancBadge'));
  const view = document.createElement('div'); view.id = 'viewRAD'; view.style.cssText = 'display:none;flex-direction:column;gap:12px';
  document.getElementById('viewBODY').after(view);
  // al pulsar cualquier otra pestaña, ocultar esta
  document.querySelectorAll('#tabs button[data-tab]').forEach((x) => { if (x !== tb) x.addEventListener('click', () => { view.style.display = 'none'; tb.classList.remove('on'); }); });
  tb.addEventListener('click', () => {
    document.querySelectorAll('#tabs button[data-tab]').forEach((x) => { x.classList.toggle('on', x === tb); const v = $('view' + x.dataset.tab); if (v) v.style.display = x === tb ? 'flex' : 'none'; });
    setTimeout(() => { dirty = true; render(); }, 0);
  });

  view.innerHTML = `
    <div class="rbanner" id="rBanner"></div>
    <div class="r4">
      <section class="panel">
        <div class="ptitle">Dosis efectiva del tripulante · ahora</div>
        <div class="row" style="align-items:flex-end;gap:10px;margin-top:8px"><span class="rhero" id="rDose">—</span><span class="rsub" style="margin-bottom:10px">mSv / día</span></div>
        <div class="rsub" id="rDoseSub" style="margin-top:6px"></div>
        <div class="rbar" style="margin-top:10px"><div id="rDoseBar"></div></div>
        <div class="rsub" style="margin-top:4px;display:flex;justify-content:space-between"><span>0</span><span>1</span><span>2.5</span><span>5+ mSv/d</span></div>
      </section>
      <section class="panel">
        <div class="ptitle">Tormenta de radiación · GOES en vivo</div>
        <div class="rbig" id="rS" style="margin-top:10px">—</div>
        <div class="rsub" id="rSTxt" style="margin-top:6px"></div>
        <div class="rrow" style="margin-top:8px"><span>Protones ≥10 MeV</span><span id="rP10">—</span></div>
        <div class="rrow"><span>Protones ≥100 MeV</span><span id="rP100">—</span></div>
        <div class="rsub" id="rPAt" style="margin-top:4px"></div>
      </section>
      <section class="panel">
        <div class="ptitle">Tormenta geomagnética · Kp</div>
        <div class="rbig" id="rG" style="margin-top:10px">—</div>
        <div class="rsub" id="rGTxt" style="margin-top:6px"></div>
        <div class="rrow" style="margin-top:8px"><span>Kp actual (NOAA)</span><span id="rKp">—</span></div>
        <div class="rrow"><span>Kp máx. 30 d (DONKI)</span><span id="rKpMax">—</span></div>
        <div class="rrow"><span>Apagón DSN / HF (modelo)</span><span id="rBlack">—</span></div>
      </section>
      <section class="panel">
        <div class="ptitle">Ventana de EVA</div>
        <div class="rbig" id="rEva" style="margin-top:10px;font-size:40px">—</div>
        <div id="rEvaWhy" class="rsub" style="margin-top:8px;line-height:1.7"></div>
      </section>
    </div>

    <div class="r2">
      <section class="panel">
        <div class="row" style="justify-content:space-between;margin-bottom:8px"><div class="ptitle">Flujo de protones GOES · últimas 24 h (escala log)</div><span class="rsub" id="rPSat"></span></div>
        <canvas class="rcv" id="rcProt" style="height:260px"></canvas>
        <div class="rsub" style="margin-top:6px">Líneas S1–S4: umbrales NOAA de tormenta de radiación solar (pfu = partículas·cm⁻²·s⁻¹·sr⁻¹)</div>
      </section>
      <section class="panel">
        <div class="row" style="justify-content:space-between;margin-bottom:8px"><div class="ptitle">Índice Kp planetario · últimos días</div><span class="rsub">NOAA SWPC · cada 3 h</span></div>
        <canvas class="rcv" id="rcKp" style="height:260px"></canvas>
        <div class="rsub" style="margin-top:6px">Kp ≥ 5 = tormenta geomagnética (G1–G5): degrada enlaces de radio y puede realzar los cinturones de radiación</div>
      </section>
    </div>

    <div class="r3">
      <section class="panel">
        <div class="ptitle" style="margin-bottom:8px">Cómo se calcula tu dosis (modelo BIO-ASTRO)</div>
        <canvas class="rcv" id="rcBreak" style="height:150px"></canvas>
        <div id="rBreak" style="margin-top:8px"></div>
      </section>
      <section class="panel">
        <div class="ptitle" style="margin-bottom:8px">Dosis de la misión vs. límites NASA</div>
        <div id="rMission"></div>
      </section>
      <section class="panel">
        <div class="ptitle" style="margin-bottom:8px">Dónde estás · blindaje (Wi-Fi RSSI)</div>
        <div class="row" style="gap:6px" id="rZones"></div>
        <div class="rsub" id="rZoneInfo" style="margin-top:8px;line-height:1.6"></div>
        <button class="btn" id="rRadin2" style="width:100%;margin-top:10px">[ CONTAR BURBUJAS RADI-N2 (CSA) ]</button>
        <div class="rsub" id="rRadin2Res" style="margin-top:6px"></div>
      </section>
    </div>

    <div class="r2">
      <section class="panel">
        <div class="ptitle" style="margin-bottom:8px">Dosis diaria por ubicación · datos publicados</div>
        <canvas class="rcv" id="rcLocs" style="height:230px"></canvas>
        <div class="rsub" style="margin-top:6px">ISS: NASA · Luna: Chang’e-4 LND (2020) · Tránsito y Marte: NASA Curiosity RAD (2013, 2014) · Tierra: fondo natural 2.4 mSv/año (UNSCEAR)</div>
      </section>
      <section class="panel">
        <div class="ptitle" style="margin-bottom:8px">Efectos en el cuerpo · NASA HRP Space Radiation</div>
        <div id="rOrgans"></div>
      </section>
    </div>

    <section class="panel">
      <div class="row" style="justify-content:space-between;margin-bottom:8px"><div class="ptitle">Línea de tiempo NASA DONKI · últimos 30 días</div><div class="row" id="rLegend" style="gap:10px"></div></div>
      <canvas class="rcv" id="rcTime" style="height:150px"></canvas>
      <div id="rEvents" style="margin-top:10px;max-height:240px;overflow:auto"></div>
    </section>

    <section class="panel">
      <div class="ptitle" style="margin-bottom:8px">Fuentes y recursos</div>
      <div class="srcs" id="rSrcs"></div>
    </section>`;

  /* ------------------------------------------------------------------ helpers de canvas */
  function fit(c) {
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight; if (!w || !h) return null;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h); ctx.font = '10px ui-monospace, Menlo, monospace';
    return { ctx, w, h };
  }
  const hhmm = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dmy = (t) => new Date(t).toLocaleDateString([], { day: '2-digit', month: 'short' });

  function drawProtons() {
    const f = fit($('rcProt')); if (!f) return; const { ctx, w, h } = f, P = NASA.N.protons;
    const L = 46, Rr = 10, T = 10, Bm = 22, lo = -2, hi = 5, y = (v) => T + (h - T - Bm) * (1 - (Math.log10(Math.max(v, 1e-2)) - lo) / (hi - lo));
    ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.fillStyle = '#63636E';
    for (let e = lo; e <= hi; e++) { const yy = y(10 ** e); ctx.beginPath(); ctx.moveTo(L, yy); ctx.lineTo(w - Rr, yy); ctx.stroke(); ctx.fillText(`1e${e}`, 6, yy + 3); }
    [[10, 1], [100, 2], [1e3, 3], [1e4, 4]].forEach(([v, s]) => { const yy = y(v); ctx.strokeStyle = S_COL[s]; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(L, yy); ctx.lineTo(w - Rr, yy); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = S_COL[s]; ctx.fillText(`S${s}`, w - Rr - 18, yy - 3); });
    if (!P || !P.p10.length) { ctx.fillStyle = C.na; ctx.textAlign = 'center'; ctx.fillText('Sin datos GOES (pulsa "Obtener datos NASA en vivo")', w / 2, h / 2); ctx.textAlign = 'left'; return; }
    const t0 = Date.parse(P.p10[0].t), t1 = Date.parse(P.p10[P.p10.length - 1].t), x = (t) => L + (w - L - Rr) * ((Date.parse(t) - t0) / Math.max(1, t1 - t0));
    const line = (arr, col, lw) => { ctx.beginPath(); arr.forEach((p, i) => (i ? ctx.lineTo(x(p.t), y(p.f)) : ctx.moveTo(x(p.t), y(p.f)))); ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.stroke(); ctx.lineWidth = 1; };
    line(P.p100, C.violet, 1.3); line(P.p10, C.cyan, 2);
    ctx.fillStyle = '#63636E'; for (let k = 0; k <= 4; k++) { const t = t0 + ((t1 - t0) * k) / 4; ctx.fillText(hhmm(t), L + ((w - L - Rr) * k) / 4 - 14, h - 6); }
    ctx.fillStyle = C.cyan; ctx.fillText('≥10 MeV', L + 6, T + 12); ctx.fillStyle = C.violet; ctx.fillText('≥100 MeV', L + 70, T + 12);
    const last = P.p10[P.p10.length - 1]; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x(last.t), y(last.f), 3.5, 0, 7); ctx.fill();
  }
  function drawKp() {
    const f = fit($('rcKp')); if (!f) return; const { ctx, w, h } = f, K = NASA.N.kpSeries;
    const L = 28, Rr = 8, T = 10, Bm = 22, y = (v) => T + (h - T - Bm) * (1 - v / 9);
    ctx.fillStyle = '#63636E'; ctx.strokeStyle = 'rgba(255,255,255,.07)';
    for (let k = 0; k <= 9; k += 1) { const yy = y(k); ctx.beginPath(); ctx.moveTo(L, yy); ctx.lineTo(w - Rr, yy); ctx.stroke(); if (k % 3 === 0) ctx.fillText(k, 10, yy + 3); }
    ctx.strokeStyle = C.warn; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(L, y(5)); ctx.lineTo(w - Rr, y(5)); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = C.warn; ctx.fillText('G1', w - Rr - 16, y(5) - 3);
    if (!K || !K.length) { ctx.fillStyle = C.na; ctx.textAlign = 'center'; ctx.fillText('Sin datos de Kp', w / 2, h / 2); ctx.textAlign = 'left'; return; }
    const n = K.length, bw = (w - L - Rr) / n;
    K.forEach((r, i) => { const g = r.kp >= 9 ? 5 : r.kp >= 8 ? 4 : r.kp >= 7 ? 3 : r.kp >= 6 ? 2 : r.kp >= 5 ? 1 : 0; ctx.fillStyle = g ? S_COL[g] : 'rgba(56,189,248,.55)'; ctx.fillRect(L + i * bw + 0.5, y(r.kp), Math.max(1, bw - 1), y(0) - y(r.kp)); });
    ctx.fillStyle = '#63636E'; for (let i = 0; i < n; i += Math.ceil(n / 6)) ctx.fillText(dmy(K[i].t), L + i * bw, h - 6);
  }
  function drawBreak(R) {
    const f = fit($('rcBreak')); if (!f) return; const { ctx, w, h } = f, r = R.rad;
    const steps = [['Base GCR', r.base, C.cyan], [`× zona ${r.zoneMult}`, r.base * r.zoneMult, C.violet], [`× clima ${fmt(r.sw, 2)}`, r.eff, r.eff > 2.5 ? C.crit : r.eff > 1 ? C.warn : C.ok]];
    const mx = Math.max(2, ...steps.map((s) => s[1])) * 1.15, bw = (w - 40) / steps.length;
    steps.forEach(([lab, v, col], i) => {
      const bh = ((h - 40) * v) / mx, x = 20 + i * bw + 10, yy = h - 22 - bh;
      ctx.fillStyle = col; ctx.globalAlpha = 0.85; ctx.fillRect(x, yy, bw - 20, bh); ctx.globalAlpha = 1;
      if (i === steps.length - 1) { ctx.fillStyle = C.crit; ctx.globalAlpha = 0.9; ctx.fillRect(x, yy, bw - 20, bh * 0.3); ctx.globalAlpha = 1; ctx.fillStyle = '#fff'; ctx.fillText('30 % n⁰', x + 4, yy + 12); }
      ctx.fillStyle = '#fff'; ctx.fillText(`${fmt(v, 2)}`, x + 4, yy - 4); ctx.fillStyle = '#A0A0AB'; ctx.fillText(lab, x, h - 8);
    });
  }
  function drawLocs(R) {
    const f = fit($('rcLocs')); if (!f) return; const { ctx, w, h } = f, H = B.H;
    const rows = [['Tierra (fondo)', EARTH_BG, '#4a6a7a', null], ...Object.entries(B.LOCS).map(([k, l]) => [l.name, l.base, k === H.loc ? C.cyan : 'rgba(56,189,248,.35)', k])];
    rows.push(['TÚ AHORA', R.eff, R.eff > 2.5 ? C.crit : R.eff > 1 ? C.warn : C.ok, 'now']);
    const L = 170, mx = Math.max(2.2, R.eff * 1.1), rh = (h - 16) / rows.length;
    rows.forEach(([lab, v, col, k], i) => {
      const yy = 8 + i * rh, bw = ((w - L - 70) * v) / mx;
      ctx.fillStyle = k === H.loc || k === 'now' ? '#fff' : '#A0A0AB'; ctx.fillText(lab, 8, yy + rh / 2 + 3);
      ctx.fillStyle = col; ctx.fillRect(L, yy + 4, Math.max(2, bw), rh - 8);
      ctx.fillStyle = '#fff'; ctx.fillText(`${v < 0.1 ? v.toFixed(4) : v.toFixed(2)} mSv/d`, L + Math.max(2, bw) + 6, yy + rh / 2 + 3);
    });
  }
  function drawTimeline() {
    const f = fit($('rcTime')); if (!f) return; const { ctx, w, h } = f, ev = NASA.N.timeline || [];
    const types = Object.keys(EV_TXT), L = 46, Rr = 10, t1 = Date.now(), t0 = t1 - 30 * 864e5, rh = (h - 22) / types.length, x = (t) => L + (w - L - Rr) * ((Date.parse(t) - t0) / (t1 - t0));
    types.forEach((ty, i) => { const yy = 4 + i * rh; ctx.fillStyle = EV_COL[ty]; ctx.fillText(ty, 8, yy + rh / 2 + 3); ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.beginPath(); ctx.moveTo(L, yy + rh / 2); ctx.lineTo(w - Rr, yy + rh / 2); ctx.stroke(); });
    for (const e of ev) { const i = types.indexOf(e.type); if (i < 0) continue; const xx = x(e.t); if (xx < L) continue; ctx.fillStyle = EV_COL[e.type]; ctx.beginPath(); ctx.arc(xx, 4 + i * rh + rh / 2, 4, 0, 7); ctx.fill(); }
    ctx.fillStyle = '#63636E'; for (let k = 0; k <= 5; k++) { const t = t0 + ((t1 - t0) * k) / 5; ctx.fillText(dmy(t), L + ((w - L - Rr) * k) / 5 - 14, h - 6); }
    ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.moveTo(w - Rr, 2); ctx.lineTo(w - Rr, h - 18); ctx.stroke();
  }

  /* ------------------------------------------------------------------ render */
  let dirty = true;
  function render() {
    if (view.style.display === 'none') return;
    const L = B.evaluate(); if (!L) return;
    const { S, R } = L, N = NASA.N, H = B.H, r = R.rad, LOC = B.LOCS[H.loc], Z = B.ZONES[r.zone];
    // banner
    const storm = N.sLevel > 0 || N.swActive, unsafe = storm && r.zone === 'dome';
    const bn = $('rBanner'), bc = unsafe ? C.crit : storm ? C.warn : C.ok;
    bn.style.color = bc; bn.style.borderColor = bc; bn.classList.toggle('pulse-red', unsafe);
    bn.innerHTML = `<span>${unsafe ? '☢ TORMENTA SOLAR · TRASLADO INMEDIATO AL REFUGIO' : storm ? '⚠ CLIMA ESPACIAL ACTIVO · VIGILAR DOSIS' : '✓ CLIMA ESPACIAL TRANQUILO'}</span>
      <span style="font-size:11px;font-weight:400;color:#F4F3EF">${N.swReasons.join(' · ')} · ${LOC.name} · ${Z.name}</span>
      <span style="margin-left:auto;font-size:10.5px;font-weight:400;color:#A0A0AB">NASA ${N.status === 'live' ? 'EN VIVO' : N.status.toUpperCase()} · ${N.fetchedAt ? new Date(N.fetchedAt).toLocaleTimeString() : '—'}</span>`;
    // dosis
    const dc = R.eff > 2.5 ? C.crit : R.eff > 1 ? C.warn : C.ok;
    $('rDose').textContent = fmt(R.eff, 2); $('rDose').style.color = dc;
    $('rDoseSub').innerHTML = `≈ ${fmt(R.eff / 0.1, 0)} radiografías de tórax al día · ${fmt(R.eff / EARTH_BG, 0)}× el fondo natural de la Tierra<br>neutrones secundarios (CSA CANS): <b style="color:#fff">${fmt(r.neutron, 2)} mSv/d</b> (~30 %)`;
    $('rDoseBar').style.width = `${clamp((R.eff / 5) * 100, 1, 100)}%`; $('rDoseBar').style.background = dc;
    // S / G
    const P = N.protons;
    $('rS').textContent = `S${N.sLevel}`; $('rS').style.color = S_COL[N.sLevel]; $('rSTxt').textContent = S_TXT[N.sLevel];
    $('rP10').textContent = P && P.now10 != null ? `${P.now10.toPrecision(3)} pfu` : '—'; $('rP100').textContent = P && P.now100 != null ? `${P.now100.toPrecision(3)} pfu` : '—';
    $('rPAt').textContent = P ? `GOES-${P.sat} · ${new Date(P.at).toLocaleString()} · máx. 24 h ${P.max10.toPrecision(3)} pfu` : 'Sin datos GOES';
    $('rPSat').textContent = P ? `GOES-${P.sat} · NOAA SWPC` : '';
    $('rG').textContent = `G${N.gLevel}`; $('rG').style.color = S_COL[N.gLevel]; $('rGTxt').textContent = G_TXT[N.gLevel];
    $('rKp').textContent = fmt(N.kpNow, 2); $('rKpMax').textContent = fmt(N.kpMax, 1); $('rBlack').textContent = `${Math.round(N.blackout * 100)} %`;
    // ventana EVA
    const sepRecent = N.sep && N.sep.latest && Date.now() - Date.parse(N.sep.latest.eventTime) < 3 * 864e5;
    const checks = [[N.sLevel === 0, `Sin tormenta de radiación (GOES S${N.sLevel})`], [!sepRecent, sepRecent ? 'Evento SEP en las últimas 72 h' : 'Sin SEP en las últimas 72 h (DONKI)'], [(N.kpNow ?? 0) < 5, `Kp ${fmt(N.kpNow, 1)} < 5 (enlaces estables)`], [R.eff * 30 < BFO30, `Dosis a 30 días ${fmt(R.eff * 30, 0)} < ${BFO30} mSv (NASA-STD-3001)`]];
    const evaOk = checks.every((c) => c[0]);
    $('rEva').textContent = evaOk ? 'ABIERTA' : 'CERRADA'; $('rEva').style.color = evaOk ? C.ok : C.crit;
    $('rEvaWhy').innerHTML = checks.map(([ok, t]) => `<span style="color:${ok ? C.ok : C.crit}">${ok ? '✓' : '✗'} ${t}</span>`).join('<br>');
    // desglose
    $('rBreak').innerHTML = [
      ['Base de rayos cósmicos (GCR)', `${fmt(r.base, 2)} mSv/d · ${LOC.name}`],
      ['Referencia publicada', LOC.src.split(':')[0]],
      ['Blindaje por zona (RSSI)', `× ${r.zoneMult} · ${Z.name}`],
      ['Clima espacial (NASA DONKI + GOES)', `× ${fmt(r.swRaw, 2)} en espacio libre → × ${fmt(r.sw, 2)} en ${LOC.short}`],
      ['Neutrones secundarios (CSA CANS)', `${fmt(r.neutron, 2)} mSv/d (30 %)`],
    ].map(([k, v]) => `<div class="rrow"><span style="color:#A0A0AB">${k}</span><span>${v}</span></div>`).join('');
    // misión
    const sols = H.sol, toDate = r.base * sols, d30 = R.eff * 30;
    const bar = (v, lim, col) => `<div class="rbar"><div style="width:${clamp((v / lim) * 100, 1, 100)}%;background:${col}"></div></div>`;
    const mc = (v, lim) => (v >= lim ? C.crit : v >= 0.6 * lim ? C.warn : C.ok);
    $('rMission').innerHTML = `
      <div class="rrow"><span>Dosis acumulada a Sol ${sols} (tasa de referencia)</span><span style="color:${mc(toDate, CAREER)}">${fmt(toDate, 0)} mSv</span></div>${bar(toDate, CAREER, mc(toDate, CAREER))}
      <div class="rsub" style="margin:3px 0 10px">${fmt((toDate / CAREER) * 100, 0)} % del límite de carrera NASA (600 mSv, NASA-STD-3001)</div>
      <div class="rrow"><span>Próximos 30 días a la tasa actual</span><span style="color:${mc(d30, BFO30)}">${fmt(d30, 0)} mSv</span></div>${bar(d30, BFO30, mc(d30, BFO30))}
      <div class="rsub" style="margin:3px 0 10px">límite NASA a 30 días para órganos hematopoyéticos: 250 mGy-Eq</div>
      <div class="rrow"><span>Misión Marte completa (~860 días, RAD)</span><span style="color:${C.warn}">≈ 1 000 mSv</span></div>${bar(1000, CAREER, C.crit)}
      <div class="rsub" style="margin-top:3px">Hassler et al. 2014: ~1.01 Sv para tránsito + 500 días en superficie → supera el límite de carrera actual</div>`;
    // zonas
    $('rZones').innerHTML = Object.entries(B.ZONES).map(([k, z]) => `<button class="zonebtn ${k === r.zone ? 'on' : ''}" data-z="${k}" ${S.zoneAuto ? 'disabled' : ''}><b style="color:${z.mult < 1 ? C.ok : z.mult > 1 ? C.crit : C.cyan}">×${z.mult}</b><span class="rsub">${z.name}</span><br><span class="rsub">${z.rssi}</span></button>`).join('');
    $('rZones').querySelectorAll('[data-z]').forEach((b) => (b.onclick = () => { H.zone = b.dataset.z; B.update(); dirty = true; render(); }));
    $('rZoneInfo').innerHTML = S.zoneAuto ? `Zona detectada por el RSSI del brazalete: ${fmt(S.rssi)} dBm` : 'Zona manual: tu firmware aún no envía RSSI (el C3 puede medirlo con Wi-Fi).';
    $('rRadin2Res').textContent = B.EX.radin2 ? `Última lectura Radi-N2: ${B.EX.radin2.bubbles} burbujas ≈ ${fmt(B.EX.radin2.uSv)} µSv de neutrones (${new Date(B.EX.radin2.at).toLocaleTimeString()})` : 'Sin lecturas Radi-N2 todavía.';
    // órganos
    const lens = R.eff * sols > 500 ? 'crit' : R.eff * sols > 150 ? 'warn' : 'ok';
    const orgs = [
      ['Médula ósea (hematopoyesis)', R.o.marrow.level, 'El órgano más sensible: baja de glóbulos blancos y defensas.'],
      ['Piel', R.eff > 2.5 ? 'warn' : 'ok', 'Eritema en dosis altas de protones de baja energía (EVA).'],
      ['Cristalino (cataratas)', lens, `Dosis acumulada estimada ${fmt(R.eff * sols, 0)} mSv: riesgo tardío de cataratas.`],
      ['Sistema nervioso central', H.loc === 'transit' || H.loc === 'moon' ? 'warn' : 'ok', 'Iones pesados (HZE) del GCR: riesgo cognitivo en misiones largas.'],
      ['Reactivación viral latente', R.o.marrow.level === 'crit' || (S.rmssd != null && S.rmssd < 35) ? 'warn' : 'ok', 'Radiación + estrés (HRV baja) → herpes zóster / EBV.'],
    ];
    const LV = { ok: ['NOMINAL', C.ok], warn: ['PRECAUCIÓN', C.warn], crit: ['CRÍTICO', C.crit], na: ['SIN DATOS', C.na] };
    $('rOrgans').innerHTML = orgs.map(([n, l, t]) => `<div class="rrow"><span><b style="color:#fff">${n}</b><br><span class="rsub">${t}</span></span><span style="color:${LV[l][1]}">${LV[l][0]}</span></div>`).join('')
      + `<div class="row" style="gap:6px;margin-top:10px"><button class="btn" id="rToBody" style="flex:1">[ VER EN EL CUERPO 3D ]</button><button class="btn" id="rShelter" style="flex:1;border-color:var(--red);color:var(--red)">[ IR AL REFUGIO DE AGUA ]</button></div>`;
    $('rToBody').onclick = () => { document.querySelector('[data-tab=BODY]').click(); B.select('marrow'); };
    $('rShelter').onclick = () => { if (S.zoneAuto) Engine.event('Muévete físicamente al refugio: el RSSI del brazalete confirmará la zona', 'warn'); else { H.zone = 'shelter'; B.update(); Engine.event('Tripulante en el refugio de agua (×0.15)', 'ok'); } dirty = true; render(); };
    // eventos
    $('rLegend').innerHTML = Object.keys(EV_TXT).map((k) => `<span class="rsub"><b style="color:${EV_COL[k]}">●</b> ${k}</span>`).join('');
    const ev = (N.timeline || []).slice(0, 40);
    $('rEvents').innerHTML = ev.length ? ev.map((e) => `<div class="evrow"><span class="ty" style="color:${EV_COL[e.type]}">${e.type}</span><span class="rsub">${new Date(e.t).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span><span>${e.txt} <span class="rsub">· ${e.id}</span></span></div>`).join('') : '<div class="rsub">Sin eventos (o sin datos DONKI todavía).</div>';
    // fuentes
    const osdr = (N.osdr.radiation || []).slice(0, 4).map((s) => `<a href="${s.url}" target="_blank" rel="noopener" title="${(s.title || '').replace(/"/g, '')}">OSDR ${s.acc}</a>`).join('');
    $('rSrcs').innerHTML = `<a href="https://www.nasa.gov/hrp/hazards/" target="_blank" rel="noopener">NASA HRP · 5 Hazards (Radiación)</a><a href="https://humanresearchroadmap.nasa.gov/" target="_blank" rel="noopener">NASA HRP · Human Research Roadmap</a>
      <a href="https://www.asc-csa.gc.ca/eng/sciences/radiation.asp" target="_blank" rel="noopener">CSA · Monitoring radiation (CANS, Radi-N2)</a><a href="https://api.nasa.gov/" target="_blank" rel="noopener">NASA DONKI API</a>
      <a href="https://www.swpc.noaa.gov/products/goes-proton-flux" target="_blank" rel="noopener">NOAA SWPC · GOES proton flux</a><a href="https://www.swpc.noaa.gov/noaa-scales-explanation" target="_blank" rel="noopener">NOAA Space Weather Scales (S/G)</a>
      <span class="s">NASA-STD-3001 Vol. 1 (límites de exposición)</span><span class="s">Zeitlin et al. 2013, Science (MSL RAD crucero)</span><span class="s">Hassler et al. 2014, Science (RAD en Marte)</span><span class="s">Zhang et al. 2020, Sci. Adv. (Chang’e-4 LND)</span>${osdr}`;
    if (dirty) { drawProtons(); drawKp(); drawTimeline(); dirty = false; }
    drawBreak(R); drawLocs(R);
  }
  $('rRadin2').onclick = () => { document.querySelector('[data-tab=BODY]').click(); setTimeout(() => B.openTool('radin2'), 50); };
  NASA.onChange(() => { dirty = true; render(); });
  Engine.subscribe(render);
  window.addEventListener('resize', () => { dirty = true; render(); });
})();
