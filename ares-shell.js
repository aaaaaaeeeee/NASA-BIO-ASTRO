/* =============================================================================
 * BIO-ASTRO // OS v4.5 — Capa de estación de trabajo (solo AÑADE y REUBICA nodos).
 * Nunca borra ni renombra un id, handler o global. Lee ARES_BODY / ARES_AI / ARES_NASA / Engine.
 *   1. Barra de comando de 56 px en 3 zonas (enlace · isla + MET · módulos / gravedad / DONKI)
 *   2. Estación 100vh de 3 columnas: vitales | escenario 3D | mazo AI · LABS · NASA
 *   3. Escenario sin caja: retículas, dock físico inferior, inspector flotante
 *   4. Anillos de readiness + bloques vitales con referencias oficiales
 *   5. Móvil: escenario fijo 42 % + hoja inferior de 5 pestañas
 * ========================================================================== */
(() => {
  'use strict';
  const { Engine, clamp } = window.ARES;
  const B = window.ARES_BODY;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const fmt = (v, d = 0) => (v == null || !Number.isFinite(+v) ? '—' : (+v).toFixed(d));
  const COL = { ok: '#10B981', warn: '#F59E0B', crit: '#EF4444', na: '#63636E', lime: '#D4FF33', sky: '#38BDF8', orange: '#FF5722' };
  const strip = (b) => b && (b.textContent = b.textContent.replace(/\[\s*/g, '').replace(/\s*\]/g, '').trim());
  const mq = window.matchMedia('(max-width: 1023px)');
  const T0 = Date.now();
  const ICON = {
    pulse: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
    cube: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
    reticle: '<circle cx="12" cy="12" r="7"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="1.5"/>',
    dish: '<path d="M4 10a8 8 0 0 0 10 10z"/><path d="M9 15l4-4"/><path d="M14 4a6 6 0 0 1 6 6M14 8a2 2 0 0 1 2 2"/>',
    neural: '<circle cx="12" cy="5" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="18" r="2"/><circle cx="12" cy="12.5" r="2"/><path d="M12 7v3.5M10.3 13.6 6.6 16.6M13.7 13.6l3.7 3"/>',
    scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M4 12h16"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
    sliders: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    optic: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h4M17 12h4"/><circle cx="12" cy="12" r="3"/>',
    gyro: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="9" ry="3.5"/><circle cx="12" cy="12" r="1.5"/>',
    rad: '<circle cx="12" cy="12" r="2"/><path d="M12 9.5V3a9 9 0 0 1 7.8 4.5l-5.6 3.3M14.2 13.3l5.6 3.2A9 9 0 0 1 12 21v-6.5M9.8 13.3l-5.6 3.2A9 9 0 0 1 4.2 7.5l5.6 3.3"/>',
    kidney: '<path d="M15 4c-4 0-7 3-7 8s3 8 7 8c2 0 3-1.5 3-3s-2-2.5-2-5 2-3.5 2-5-1-3-3-3z"/>',
    grid: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 12h16M12 4v16M8 4v16M16 4v16" opacity=".5"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  };
  const ic = (k, s = 16) => `<svg class="ico" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k] || ''}</svg>`;
  // alias de marca BIO-ASTRO (los identificadores internos ARES_* se mantienen: cero regresiones)
  window.BIO_ASTRO = window.ARES; window.BIO_ASTRO_BODY = window.ARES_BODY; window.BIO_ASTRO_NASA = window.ARES_NASA; window.BIO_ASTRO_AI = window.ARES_AI;

  /* ================================================================ 1. barra de comando */
  const hdr = document.querySelector('header.panel');
  const R = { connect: $('btnConnect'), sim: $('btnSim'), simBadge: $('simBadge'), src: $('srcLabel'), rate: $('rateLabel'), finger: $('fingerChip'), mute: $('aiMute'), arrest: $('aiSimArrest') };
  const linkBox = R.src && R.src.parentElement;
  hdr.classList.add('cmd');
  const zL = el('div', 'cmdZone l'), zC = el('div', 'cmdZone c'), zR = el('div', 'cmdZone r');
  const oldKids = [...hdr.children];
  hdr.append(zL, zC, zR);                                         // las zonas entran primero al documento
  zL.appendChild(el('div', 'wordmark', '<b>BIO-ASTRO <em>//</em><span class="wm2"> OS</span></b><i>v4.5</i>'));
  zL.appendChild(R.connect); R.connect.textContent = 'CONECTAR ESP32 · USB';
  linkBox.className = 'link'; linkBox.removeAttribute('style'); zL.appendChild(linkBox);
  const drop = el('div', 'cmdDrop'); drop.id = 'uiSimDrop';
  drop.innerHTML = '<button class="btn" id="uiSimBtn">SIM <span class="lbl">▾</span></button><div class="menu" id="uiSimMenu"><div class="hd">Fuente de datos · simulador</div><div class="row" id="uiSimRow1"></div><div class="row" id="uiSimRow2"></div><div class="hd">Estado del dedo</div><div class="row" id="uiSimRow3"></div><div class="hd">Entrenamiento de emergencia</div><div class="row" id="uiSimRow4"></div></div>';
  zL.appendChild(drop);
  $('uiSimRow1').appendChild(R.sim); $('uiSimRow2').appendChild(R.simBadge); $('uiSimRow3').appendChild(R.finger);
  if (R.arrest) $('uiSimRow4').appendChild(R.arrest);
  $('uiSimBtn').onclick = (e) => { e.stopPropagation(); drop.classList.toggle('open'); };
  document.addEventListener('click', (e) => { if (!drop.contains(e.target)) drop.classList.remove('open'); });
  oldKids.forEach((c) => { if (!c.querySelector('[id]') && !c.id) c.remove(); else c.style.display = 'none'; });

  // --- isla dinámica + MET
  const isl = el('div', 'isl'); isl.id = 'uiIsland';
  isl.innerHTML = '<span class="idot" id="uiIslDot"></span><span class="wave" id="uiWave"><i></i><i></i><i></i><i></i><i></i></span><span class="it" id="uiIslT">MISSION STATUS: NOMINAL</span><span class="im" id="uiIslM"></span><span class="met" id="uiMET">MET —</span><button class="btn ib" id="uiIslBtn" style="display:none"></button>';
  zC.appendChild(isl);

  // --- zona derecha: módulos, gravedad, DONKI, silencio
  const tabs = [...document.querySelectorAll('#tabs button[data-tab]')];
  const MODS = { MAX: 'PPG', MPU: 'IMU', BODY: '3D', RAD: 'RAD' };
  const mods = el('div', 'cmdSeg mods'); mods.id = 'uiMods';
  mods.innerHTML = tabs.map((t) => `<button data-mod="${t.dataset.tab}" title="${t.textContent.trim()}">${MODS[t.dataset.tab] || t.dataset.tab}</button>`).join('');
  const grav = el('div', 'cmdSeg grav'); grav.id = 'uiGrav';
  grav.innerHTML = [[0, '0G'], [0.16, 'LUNA'], [0.38, 'MARTE'], [1, '1G']].map(([v, l]) => `<button data-g="${v}">${l}</button>`).join('');
  const wx = el('button', 'wx'); wx.id = 'uiDonki'; wx.innerHTML = '<span class="d" id="uiDonkiDot"></span><b>DONKI</b><span class="t" id="uiDonkiT">—</span>';
  zR.append(mods, grav, wx); if (R.mute) zR.appendChild(R.mute);
  const showView = (k) => { const t = document.querySelector(`#tabs button[data-tab="${k}"]`); if (t) t.click(); syncMods(); };
  mods.querySelectorAll('button').forEach((b) => (b.onclick = () => showView(b.dataset.mod)));
  function syncMods() {
    mods.querySelectorAll('button').forEach((b) => { const v = $('view' + b.dataset.mod); b.classList.toggle('on', !!v && v.style.display !== 'none'); });
    syncNav();
  }
  tabs.forEach((t) => t.addEventListener('click', () => setTimeout(syncMods, 0)));
  grav.querySelectorAll('button').forEach((b) => (b.onclick = () => { const t = document.querySelector(`#hG button[data-v="${b.dataset.g}"]`); if (t && !t.disabled) t.click(); syncGrav(); }));
  function syncGrav() { grav.querySelectorAll('button').forEach((b) => { b.classList.toggle('on', +b.dataset.g === B.H.g); b.disabled = !!B.H.earth; }); }

  /* ================================================================ 2. estación de trabajo (CUERPO 3D) */
  const view = $('viewBODY');
  const N = {
    nasa: $('bNasa'), hab: view.querySelector('section.hab'), live: $('bLive') && $('bLive').closest('section'), ovr: view.querySelector('section.ovr'),
    demo: view.querySelector('section.demo'), stageSec: $('bStageWrap').closest('section'), stage: $('bStageWrap'), score: $('bScore').closest('section'),
    list: $('bList').closest('section'), insp: $('bInsp'), shelter: $('bShelter'), earth: $('bEarthBanner'), b3: view.querySelector('.b3'),
    filter: $('bFilter'), split: $('bSplit'), scan: $('bScan'), scanFast: $('bScanFast'), log: $('log'), drawer: $('aiDrawer'),
  };
  const ws = el('div', 'ws'); ws.id = 'uiWS'; ws.dataset.m = 'vitals';
  const wsL = el('div', 'wsCol wsL'), wsC = el('div', 'wsC'), wsR = el('div', 'wsCol wsR');
  ws.append(wsL, wsC, wsR); view.insertBefore(ws, view.firstChild);

  // --- izquierda: anillos · aptitud EVA · bloques vitales · calibración
  const ticks = Array.from({ length: 24 }, (_, i) => { const a = (i / 24) * Math.PI * 2; return `<line x1="${(60 + Math.cos(a) * 56).toFixed(1)}" y1="${(60 + Math.sin(a) * 56).toFixed(1)}" x2="${(60 + Math.cos(a) * 59).toFixed(1)}" y2="${(60 + Math.sin(a) * 59).toFixed(1)}" stroke="#34343F" stroke-width="1"/>`; }).join('');
  const ring = (id, label) => `<div class="ring"><svg viewBox="0 0 120 120"><circle class="trk" cx="60" cy="60" r="49" stroke-width="7"/>${ticks}
      <circle class="arc" id="r_${id}" cx="60" cy="60" r="49" stroke-width="7" stroke="#63636E" transform="rotate(-90 60 60)" stroke-dasharray="307.9" stroke-dashoffset="307.9"/>
      <text class="ring-v" id="rv_${id}" x="60" y="64" text-anchor="middle">—</text><text class="ring-u" id="ru_${id}" x="60" y="81" text-anchor="middle"></text></svg>
      <div class="rl">${label}</div><div class="rs" id="rs_${id}"></div></div>`;
  const rings = el('section', 'panel'); rings.id = 'uiRings';
  rings.innerHTML = `<div class="row" style="justify-content:space-between;margin-bottom:12px"><div class="ptitle">Crew readiness</div><span class="mono" id="uiRingsSrc" style="font-size:10px;color:var(--text-muted)"></span></div>
    <div class="rings">${ring('eva', 'EVA')}${ring('sleep', 'Sueño')}${ring('hrv', 'HRV')}</div>`;
  const bento = el('section', 'panel'); bento.id = 'uiBento';
  bento.innerHTML = `<div class="row" style="justify-content:space-between;margin-bottom:12px"><div class="ptitle">Vitals · ESP32-C3</div><span class="mono" id="uiBentoSrc" style="font-size:10px;color:var(--text-muted)"></span></div><div class="bento" id="uiBentoGrid"></div>
    <details style="margin-top:12px"><summary class="ptitle">Lecturas en texto</summary><div id="uiBentoText" style="margin-top:8px"></div></details>`;
  const cal = el('details', 'calDrawer'); cal.id = 'uiCal';
  cal.innerHTML = `<summary><span class="sumL">${ic('gear', 14)}Sensor calibration &amp; overrides</span></summary>`;
  const QS = [['nominal', 'NOMINAL'], ['sleep', 'PRIVACIÓN SUEÑO'], ['eva', 'ESTRÉS EVA'], ['hypoxia', 'HIPOXIA'], ['storm', 'TORMENTA SOLAR']];
  const simBar = el('section', 'panel'); simBar.id = 'uiSimBar';
  simBar.innerHTML = `<div class="row" style="justify-content:space-between;margin-bottom:10px"><div class="ptitle">Live simulation</div><span class="srcTag" id="uiSimSrc">SIMULACIÓN</span></div>
    <div class="qsim">${QS.map(([k, l]) => `<button class="btn" data-qs="${k}">${l}</button>`).join('')}</div><div class="qsNote" id="uiSimNote"></div>`;
  wsL.append(rings, N.score, simBar, bento, cal, el('div', 'fillR'));
  $('uiBentoText').appendChild($('bLive'));
  cal.appendChild(N.ovr);
  const ovBox = $('ovBox'); if (ovBox) { ovBox.open = true; const s = ovBox.querySelector('summary'); if (s) s.style.display = 'none'; }

  // --- centro: alertas + escenario
  const alerts = el('div', 'alerts'); const host = el('div', 'stageHost');
  wsC.append(alerts, host); alerts.append(N.shelter, N.earth); host.appendChild(N.stageSec);
  const st = N.stage;
  ['tl', 'tr', 'bl', 'br', 'c'].forEach((k) => st.appendChild(el('div', 'reticle ' + k)));
  const meta = el('div', 'stageMeta'); meta.id = 'uiStageMeta'; st.appendChild(meta);
  const dock = el('div', 'dock'); dock.id = 'uiDock';
  const gF = el('div', 'grp'), gS = el('div', 'grp');
  dock.append(gF, gS); st.appendChild(dock);
  const shellBtn = el('button', 'btn'); shellBtn.id = 'uiShellBtn'; shellBtn.textContent = 'PIEL';
  gF.appendChild(N.filter); gS.append(N.split, shellBtn); dock.append(N.scan, N.scanFast);
  const FL = { all: 'TODO', neuro: 'NEURO', cardio: 'CARDIO', skeletal: 'ÓSEO', immune: 'INMUNE' };
  N.filter.querySelectorAll('button').forEach((b) => { strip(b); b.removeAttribute('style'); if (FL[b.dataset.f]) b.textContent = FL[b.dataset.f]; });
  N.filter.removeAttribute('style');
  [N.split, N.scan, N.scanFast].forEach((b) => b.removeAttribute('style'));
  N.split.textContent = 'EXPLOTAR'; N.scan.innerHTML = `${ic('scan', 15)}<span>30s LASER BIO-SCAN</span>`; N.scanFast.textContent = 'DEMO 8s';
  const syncShell = () => shellBtn.classList.toggle('on', !!(window.ARES_3D && window.ARES_3D.shell));
  shellBtn.onclick = () => { if (!window.ARES_3D) return; window.ARES_3D.setShell(!window.ARES_3D.shell); syncShell(); };
  N.stageSec.querySelectorAll(':scope > .row').forEach((r) => { if (!r.querySelector('[id]')) r.remove(); });
  N.stage.querySelectorAll(':scope > .stageBar').forEach((r) => { if (!r.querySelector('[id]')) r.remove(); });
  // inspector flotante
  const ov = el('div', 'inspOverlay empty'); ov.id = 'uiInspOv';
  const ovX = el('button', 'btn x', '✕'); ovX.title = 'Cerrar inspector';
  ov.append(ovX, N.insp); st.appendChild(ov);
  let lastInsp = '', dismissed = false;
  ovX.onclick = () => { dismissed = true; syncInsp(); };
  function syncInsp() {
    const h = N.insp.querySelector('h3'), sig = h ? h.textContent : '';
    if (sig !== lastInsp) { dismissed = false; lastInsp = sig; }
    ov.classList.toggle('empty', !mq.matches && (!h || dismissed));
    ovX.style.display = mq.matches ? 'none' : '';
  }
  new MutationObserver(syncInsp).observe(N.insp, { childList: true });

  // --- derecha: mazo de 3 pestañas (todos los nodos siguen montados)
  const DECK = [['ai', 'AI SURGEON', 'neural'], ['labs', 'CLINICAL LABS', 'reticle'], ['nasa', 'NASA / HAB', 'dish']];
  const deckTabs = el('div', 'deckTabs'); deckTabs.id = 'uiDeckTabs';
  deckTabs.innerHTML = DECK.map(([k, l, i]) => `<button data-deck="${k}">${ic(i, 15)}<span>${l}</span></button>`).join('');
  const pane = {}; ['ai', 'labs', 'nasa', 'ctrl'].forEach((k) => { pane[k] = el('div', 'deckPane'); pane[k].id = 'uiPane_' + k; });
  wsR.append(deckTabs, pane.ai, pane.labs, pane.nasa, pane.ctrl);
  // AI
  pane.ai.appendChild(N.drawer);
  const feed = el('section', 'panel feed', '<div class="ptitle">Telemetry log</div>');
  pane.ai.append(N.demo, feed); feed.appendChild(N.log);
  // LABS
  const LABS = [
    ['amsler', 'eye', 'Amsler', 'Rejilla 15×15 · metamorfopsia por SANS', 'NEURO-OCULAR'],
    ['onsd', 'optic', 'ONSD', 'POCUS ocular · vaina del nervio óptico', 'SANS · HRP'],
    ['pvt', 'gyro', 'Vestibular 15 s', 'Estabilidad tras cambio de gravedad', 'ROVER GO/NO-GO'],
    ['radin2', 'rad', 'Radi-N2', 'Contador de burbujas · dosis de neutrones', 'CSA'],
    ['flank', 'kidney', 'POCUS flanco', 'Guía renal · cálculos por desmineralización', 'RENAL'],
    ['rash', 'grid', 'Piel / rash', 'Foto dermatológica · reactivación inmune', 'INMUNE'],
  ];
  const labs = el('section', 'panel'); labs.id = 'uiLabs';
  labs.innerHTML = `<div class="ptitle">Clinical lab instruments</div><div class="labsGrid">${LABS.map(([k, icn, t, d, tag]) => `<button class="labBtn" data-lab="${k}"><span class="ic">${ic(icn, 20)}</span><b>${t}</b><span>${d}</span><em>${tag}</em></button>`).join('')}</div>
    <div class="ptitle" style="margin-top:16px">Módulos del brazalete</div><div class="modLinks">${tabs.filter((t) => t.dataset.tab !== 'BODY').map((t) => `<button class="btn" data-go="${t.dataset.tab}">${MODS[t.dataset.tab] || t.dataset.tab}</button>`).join('')}</div>`;
  pane.labs.append(labs, N.list);
  labs.querySelectorAll('[data-lab]').forEach((b) => (b.onclick = () => B.openTool(b.dataset.lab)));
  labs.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => showView(b.dataset.go)));
  // NASA / HÁBITAT
  const RES = [
    ['HRP', 'NASA Human Research Program', 'Riesgos: SANS, radiación, hueso, renal, inmune', 'https://humanresearchroadmap.nasa.gov/'],
    ['STD', 'NASA-STD-3001 Vol. 1 & 2', 'Estándares de salud y hábitat de tripulación', 'https://www.nasa.gov/ochmo/human-spaceflight-standards/'],
    ['OSDR', 'NASA Open Science Data Repository', 'Estudios ómicos y fisiológicos de vuelo', 'https://osdr.nasa.gov/bio/'],
    ['DONKI', 'NASA DONKI · CCMC', 'SEP, CME, fulguraciones y tormentas geomagnéticas', 'https://kauai.ccmc.gsfc.nasa.gov/DONKI/'],
    ['CSA', 'Agencia Espacial Canadiense', 'Bio-Monitor, Radi-N2, Vascular Aging, CANS', 'https://www.asc-csa.gc.ca/eng/sciences/'],
  ];
  const res = el('section', 'panel'); res.id = 'uiRes';
  res.innerHTML = `<div class="ptitle">Official resources</div><div class="resList">${RES.map(([k, t, d, u]) => `<a href="${u}" target="_blank" rel="noopener"><i>${k}</i><div><b>${t}</b><span>${d}</span></div></a>`).join('')}</div>`;
  const donki = el('section', 'panel'); donki.id = 'uiDonkiGrid';
  pane.nasa.append(donki, N.nasa, N.hab, res);
  // restos de la vieja rejilla: solo se eliminan contenedores que ya no tienen ningún id
  if (N.b3) { if (N.b3.querySelectorAll('[id]').length === 0) N.b3.remove(); else N.b3.style.display = 'none'; }
  if (N.live && !N.live.querySelector('[id]')) N.live.remove();

  let deck = 'ai';
  function setDeck(k) {
    deck = k; deckTabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.deck === k));
    Object.entries(pane).forEach(([n, p]) => p.classList.toggle('on', n === k));
    if (k === 'ai' && !N.drawer.classList.contains('show')) $('aiFab').click();   // abre y saluda con la lógica original
    if (mq.matches) { ws.dataset.m = { ai: 'ai', labs: 'labs', nasa: 'nasa', ctrl: 'controls' }[k]; syncNav(); }
    wsR.scrollTop = 0;
  }
  deckTabs.querySelectorAll('button').forEach((b) => (b.onclick = () => setDeck(b.dataset.deck)));
  // si un flujo de la IA abre el chat (HUD, código rojo…), el mazo salta a AI
  new MutationObserver(() => {
    if (!N.drawer.classList.contains('show') || deck === 'ai') return;
    if (view.style.display === 'none') showView('BODY'); setDeck('ai');
  }).observe(N.drawer, { attributes: true, attributeFilter: ['class'] });
  wx.onclick = () => { showView('BODY'); setDeck('nasa'); };

  /* ================================================================ 4. anillos + bento */
  const CARDS = [
    { k: 'bpm', l: 'Heart rate', u: 'lpm', d: 0, ref: 'STD-3001', org: 'heart', hist: 'bpm', c: COL.lime },
    { k: 'spo2', l: 'SpO₂', u: '%', d: 1, ref: 'STD-3001', org: 'lungs', hist: 'spo2', c: COL.sky },
    { k: 'si', l: 'Stiffness', u: 'm/s', d: 1, ref: 'CSA', org: 'carotid', hist: 'si', c: COL.lime },
    { k: 'glucose', l: 'Glucose', u: 'mg/dL', d: 0, ref: 'CSA', bar: [70, 200], st: (v) => (v > 140 ? 'crit' : v > 110 ? 'warn' : 'ok') },
    { k: 'reps', l: 'ARED reps', u: '/ 15', d: 0, ref: 'HRP', org: 'femur', bar: [0, 15] },
    { k: 'tremor', l: 'Tremor', u: 'rad/s', d: 3, ref: 'HRP', org: 'vestibular', hist: 'tremor', c: COL.sky },
    { k: 'temp', l: 'Temp', u: '°C', d: 1, ref: 'NTC', hist: 'therm', c: COL.lime, st: (v) => (v > 38 ? 'crit' : v > 37.4 ? 'warn' : 'ok') },
    { k: 'dose', l: 'Dose', u: 'mSv/d', d: 2, ref: 'CANS', org: 'marrow', bar: [0, 5] },
  ];
  $('uiBentoGrid').innerHTML = CARDS.map((c) => `<div class="bc" id="bc_${c.k}"><span class="bref">${c.ref}</span><div class="bl"><span class="dot" id="bcd_${c.k}"></span>${c.l}</div><div><span class="bv" id="bcv_${c.k}">—</span><span class="bu">${c.u}</span></div>${c.bar ? `<div class="pb"><div id="bcb_${c.k}"></div></div>` : `<svg class="sp" id="bcs_${c.k}" viewBox="0 0 100 26" preserveAspectRatio="none"></svg>`}</div>`).join('');
  const spark = (svg, data, col) => {
    if (!svg) return; const v = (data || []).filter(Number.isFinite); if (v.length < 2) { svg.innerHTML = ''; return; }
    const mn = Math.min(...v), mx = Math.max(...v), r = mx - mn || 1, n = data.length;
    const pts = data.map((d, i) => (Number.isFinite(d) ? `${((i / (n - 1)) * 100).toFixed(1)},${(23 - ((d - mn) / r) * 20).toFixed(1)}` : null)).filter(Boolean);
    svg.innerHTML = `<polygon points="0,26 ${pts.join(' ')} 100,26" fill="${col}" fill-opacity=".08"/><polyline points="${pts.join(' ')}" fill="none" stroke="${col}" stroke-width="1.25" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>`;
  };
  const setRing = (id, pct, val, unit, sub, col) => {
    const arc = $('r_' + id); if (!arc) return;
    arc.style.strokeDashoffset = 307.9 * (1 - clamp(pct ?? 0, 0, 1)); arc.setAttribute('stroke', col);
    $('rv_' + id).textContent = val; $('ru_' + id).textContent = unit; $('rs_' + id).textContent = sub;
  };
  function renderData() {
    const L = B.evaluate(); if (!L) return;
    const { S, R: Rv } = L, H = B.H, hist = (Engine.snap && Engine.snap.hist) || {};
    const sc = Rv.score;
    setRing('eva', sc / 100, sc, '%', Rv.go ? 'GO' : 'NO-GO', Rv.go ? COL.lime : sc >= 50 ? COL.warn : COL.crit);
    const se = S.sleepEff, sl = window.ARES_UI && window.ARES_UI.sleepSummary ? window.ARES_UI.sleepSummary() : null;
    setRing('sleep', se != null ? se / 100 : 0, se != null ? Math.round(se) : '—', se != null ? '%' : 'sin datos', se == null ? 'sin noche' : sl ? `${fmt(sl.hours, 1)}h · REM ${Math.round(sl.rem)}%` : se < 70 ? 'baja' : se < 85 ? 'media' : 'recuperado', se == null ? COL.na : se < 70 ? COL.crit : se < 85 ? COL.warn : COL.sky);
    const hv = S.rmssd;
    setRing('hrv', hv != null ? (hv - 10) / 80 : 0, hv != null ? Math.round(hv) : '—', hv != null ? 'ms' : 'sin pulso', hv == null ? 'pon el dedo' : hv < 20 ? 'estrés alto' : hv < 35 ? 'moderado' : 'RMSSD óptimo', hv == null ? COL.na : hv < 20 ? COL.crit : hv < 35 ? COL.warn : COL.ok);
    const srcTxt = S.override ? 'OVERRIDE' : Engine.source === 'serial' ? 'SENSOR' : Engine.simActive && Engine.simActive() ? 'SIM' : 'NO LINK';
    $('uiRingsSrc').textContent = srcTxt; $('uiBentoSrc').textContent = srcTxt;
    const hw = Engine.source === 'serial' && !Engine.failoverActive, ss = $('uiSimSrc');
    ss.textContent = hw ? 'ESP32 LIVE HARDWARE' : Engine.simActive() ? 'SIMULACIÓN' : 'SIN FUENTE'; ss.className = 'srcTag' + (hw ? ' hw' : '');
    $('uiSimNote').textContent = hw ? 'Hardware real conectado: los escenarios solo cambian hábitat y clima espacial.' : '';
    renderHab(); renderDonkiGrid();
    const val = { bpm: S.bpm, spo2: S.spo2, si: S.si, glucose: H.glucose, reps: S.reps ?? 0, tremor: S.tremor, temp: (Engine.snap && Engine.snap.therm) ?? S.temp, dose: Rv.eff };
    // tarjeta de temperatura: termistor de la estación S3 si está conectado, si no el sensor interno del MAX30102
    const ntc = Engine.snap && Engine.snap.therm != null, tc = CARDS.find((c) => c.k === 'temp');
    tc.hist = ntc ? 'therm' : 'temp';
    const tb = document.querySelector('#bc_temp .bref'), tl = document.querySelector('#bc_temp .bl');
    if (tb) tb.textContent = ntc ? 'NTC' : 'DIE';
    if (tl && tl.lastChild) tl.lastChild.textContent = ntc ? 'Temp dedo' : 'Temp';
    for (const c of CARDS) {
      const v = val[c.k], e = $('bcv_' + c.k); if (!e) continue;
      const lvl = c.st ? (v == null ? 'na' : c.st(v)) : c.org ? Rv.o[c.org].level : 'ok';
      const col = v == null ? COL.na : COL[lvl] || COL.na;
      e.textContent = fmt(v, c.d); $('bcd_' + c.k).style.color = col;
      if (c.bar) { const b = $('bcb_' + c.k); b.style.width = `${clamp(((v ?? 0) - c.bar[0]) / (c.bar[1] - c.bar[0]), 0, 1) * 100}%`; b.style.background = col; }
      else spark($('bcs_' + c.k), hist[c.hist], lvl === 'ok' ? c.c : col);
    }
    const loc = (B.LOCS[H.loc] || {}).short || H.loc;
    meta.innerHTML = `<b>${String(loc).toUpperCase()}</b> · ${H.g}G · SOL ${H.sol}<br>DOSIS ${fmt(Rv.eff, 2)} mSv/d · EVA ${sc}<br>L1 ÓSEO · L2 CARDIO · L3 NEURO`;
    syncGrav(); syncShell();
  }

  /* ================================================================ isla + MET + DONKI */
  const hud = $('aiHud'), hudBox = $('aiHudBox');
  let islMode = 'nominal';
  function renderIsland() {
    const L = B.evaluate(); const s = window.ARES_AI_STATE || {};
    const compact = hudBox && hudBox.querySelector('#aiExp');
    const anyAlert = Array.isArray(s.active) && s.active.length > 0;
    const hudOn = anyAlert && hud && (hud.style.display !== 'none' || compact);
    let mode = 'nominal', title = 'MISSION STATUS: NOMINAL', m = '', btn = null;
    if (s.codeRed) { mode = 'crit'; title = 'CODE RED · RCP EN CURSO'; btn = ['PROTOCOLO', () => $('aiCR').classList.add('show')]; }
    else if (hudOn && compact) {
      mode = 'caution'; title = (hudBox.querySelector('.t') || {}).textContent || 'CAUTION';
      btn = ['DETALLES', () => { const e = hudBox.querySelector('#aiExp'); if (e) e.click(); }];
      hud.style.display = 'none';
    } else if (hudOn) { mode = 'crit'; title = 'MASTER ALARM'; }
    if (L && mode === 'nominal') { const { S, R: Rv } = L; m = `HR ${fmt(S.bpm)} · SpO₂ ${fmt(S.spo2, 1)} · EVA ${Rv.score}`; }
    isl.className = 'isl' + (mode === 'nominal' ? '' : ' ' + mode); islMode = mode;
    $('uiIslDot').style.color = mode === 'crit' ? COL.crit : mode === 'caution' ? COL.warn : COL.ok;
    $('uiIslT').textContent = title.replace('🩺 ', ''); $('uiIslM').textContent = m;
    const b = $('uiIslBtn'); if (btn) { b.style.display = ''; b.textContent = btn[0]; b.onclick = btn[1]; } else b.style.display = 'none';
  }
  const p2 = (n) => String(n).padStart(2, '0');
  function tickMET() {
    const s = Math.floor((Date.now() - T0) / 1000);
    $('uiMET').textContent = `MET ${String(B.H.sol).padStart(3, '0')}/${p2(Math.floor(s / 3600) % 24)}:${p2(Math.floor(s / 60) % 60)}:${p2(s % 60)}`;
    const w = $('uiWave'); if (w) w.classList.toggle('on', 'speechSynthesis' in window && speechSynthesis.speaking);
  }
  let nT = 0;
  setInterval(() => { tickMET(); if (++nT % 2 === 0) renderIsland(); }, 250); tickMET();
  if (hudBox) new MutationObserver(() => renderIsland()).observe(hudBox, { childList: true, subtree: true });
  if (hud) new MutationObserver(() => { if (islMode !== 'caution' || !hudBox.querySelector('#aiExp')) renderIsland(); }).observe(hud, { attributes: true, attributeFilter: ['style'] });
  function renderDonki() {
    const NS = window.ARES_NASA && window.ARES_NASA.N; if (!NS) return;
    const live = NS.status === 'live' || NS.status === 'partial', cache = NS.status === 'cache' || NS.fromCache;
    const col = NS.status === 'error' ? COL.crit : NS.status === 'loading' ? COL.warn : live || cache ? (NS.sLevel >= 2 || NS.gLevel >= 2 ? COL.warn : COL.ok) : COL.na;
    $('uiDonkiDot').style.background = col;
    const lbl = NS.status === 'loading' ? 'SYNC' : NS.status === 'error' ? 'OFFLINE' : cache ? 'CACHE' : live ? 'LIVE' : 'IDLE';
    $('uiDonkiT').textContent = `${lbl} · S${NS.sLevel ?? 0} · Kp ${fmt(NS.kpNow, 1)}`;
  }
  if (window.ARES_NASA) window.ARES_NASA.onChange(renderDonki);

  /* ================================================================ 5. móvil: hoja de 5 pestañas */
  const NAV = [['vitals', 'pulse', 'Vitales'], ['controls', 'cube', '3D'], ['labs', 'reticle', 'Labs'], ['nasa', 'dish', 'NASA'], ['ai', 'neural', 'IA']];
  const nav = el('nav', 'bnav'); nav.id = 'uiBottomNav';
  nav.innerHTML = NAV.map(([k, icn, l]) => `<button data-nav="${k}"><span class="ic">${ic(icn, 20)}</span>${l}</button>`).join('');
  document.body.appendChild(nav);
  nav.querySelectorAll('button').forEach((b) => (b.onclick = () => {
    const k = b.dataset.nav;
    if (view.style.display === 'none') showView('BODY');
    ws.dataset.m = k;
    if (k !== 'vitals') setDeck({ controls: 'ctrl', labs: 'labs', nasa: 'nasa', ai: 'ai' }[k]);
    syncNav();
  }));
  function syncNav() {
    const body = view.style.display !== 'none';
    nav.querySelectorAll('button').forEach((b) => b.classList.toggle('on', body && ws.dataset.m === b.dataset.nav));
  }
  // barra "volver" en MAX / MPU / RAD (solo visible en móvil)
  tabs.filter((t) => t.dataset.tab !== 'BODY').forEach((t) => {
    const v = $('view' + t.dataset.tab); if (!v) return;
    const bb = el('div', 'backBar', `<button class="btn">← CUERPO 3D</button><span class="mono" style="font-size:10px;color:var(--text-muted)">${MODS[t.dataset.tab] || t.dataset.tab}</span>`);
    v.insertBefore(bb, v.firstChild); bb.querySelector('button').onclick = () => showView('BODY');
  });
  // inspector + lista de órganos: overlay en escritorio, pestaña "3D" en móvil
  function layout() {
    if (mq.matches) { pane.ctrl.append(ov, N.list); if (R.mute) $('uiSimRow4').appendChild(R.mute); }
    else { st.appendChild(ov); if (R.mute) zR.appendChild(R.mute); pane.labs.appendChild(N.list); if (deck === 'ctrl') setDeck('ai'); }
    syncInsp();
  }
  mq.addEventListener('change', layout);

  /* ================================================================ simulación rápida */
  const clickSel = (sel) => { const b = document.querySelector(sel); if (b && !b.disabled) b.click(); };
  const preset = (id) => clickSel(`#presets button[data-id="${id}"]`);
  const night = (k) => clickSel(`[data-night="${k}"]`);
  const zone = (z) => clickSel(`#hZone button[data-v="${z}"]`);
  let stormSaved = null;
  function storm(on) {
    const NA = window.ARES_NASA; if (!NA) return; const NS = NA.N;
    if (on && !stormSaved) { stormSaved = { s: NS.sLevel, kp: NS.kpNow, p: NS.protons ? NS.protons.now10 : null }; NS.sLevel = 3; NS.kpNow = 7.3; if (NS.protons) NS.protons.now10 = 1500; NS.simStorm = true; }
    if (!on && stormSaved) { NS.sLevel = stormSaved.s; NS.kpNow = stormSaved.kp; if (NS.protons) NS.protons.now10 = stormSaved.p; stormSaved = null; NS.simStorm = false; }
    NA.model(); NS.listeners.forEach((f) => { try { f(NS); } catch (e) { /* noop */ } });
  }
  const QACT = {
    nominal: () => { storm(false); preset('normal'); zone('module'); night('ideal'); },
    sleep: () => { storm(false); preset('normal'); if (Engine.simCtx) Engine.simCtx = { ...Engine.simCtx, base: { ...Engine.simCtx.base, hr: 80, rmssd: 22, resp: 16 } }; night('fisiologico'); },
    eva: () => { storm(false); preset('taqui'); zone('dome'); },
    hypoxia: () => { storm(false); preset('hipoxia'); },
    storm: () => { storm(true); },
  };
  simBar.querySelectorAll('[data-qs]').forEach((b) => (b.onclick = () => {
    QACT[b.dataset.qs](); simBar.querySelectorAll('[data-qs]').forEach((x) => x.classList.toggle('on', x === b)); renderData();
  }));
  simBar.querySelector('[data-qs="nominal"]').classList.add('on');

  /* ================================================================ hábitat: telemetría bloqueada (solo lectura) */
  // Los <input type=range> originales siguen existiendo (mismos ids y handlers) dentro del cajón de calibración.
  const HAB = [
    ['hCo2', 'co2', 'pCO₂ de cabina', 'mmHg', 1, 'NASA-STD-3001', [0.5, 8], [3, 4], 'up'],
    ['hPsi', 'psi', 'Presión de cabina', 'psi', 1, 'NASA-STD-3001', [4.3, 14.7], [10, 8], 'down'],
    ['hNoise', 'noise', 'Ruido de cabina', 'dB', 0, 'NASA-STD-3001', [40, 85], [60, 70], 'up'],
    ['hHyd', 'hyd', 'Hidratación del día', 'mL', 0, 'NASA HRP', [500, 4000], [2000, 1500], 'down'],
    ['hGlu', 'glucose', 'Glucosa en ayunas', 'mg/dL', 0, 'CSA', [70, 200], [100, 126], 'up'],
    ['hNeu', 'neutron', 'Dosis base GCR', 'mSv/d', 2, 'CSA CANS', [0.1, 3.5], [0.7, 1.5], 'up'],
  ];
  const habCards = el('div', 'habLock'); habCards.id = 'uiHabLock';
  habCards.innerHTML = `<div class="hlHead">${ic('lock', 12)}<span>Telemetría ECLSS · solo lectura</span></div>` + HAB.map(([id, , name, unit, , badge]) => `<div class="hl" id="hl_${id}"><div class="hlTop"><span class="hlN">${name}</span><span class="bref">${badge}</span></div>
    <div class="hlV"><b id="hlv_${id}">—</b><span>${unit}</span><em id="hls_${id}"></em></div><div class="gauge" id="hlg_${id}">${'<i></i>'.repeat(24)}<s></s><s></s></div></div>`).join('');
  const firstRange = N.hab.querySelector('label input[type=range]');
  N.hab.insertBefore(habCards, firstRange ? firstRange.closest('label') : null);
  const habOv = el('section', 'panel hab habOv'); habOv.id = 'uiHabOverrides';
  habOv.innerHTML = '<div class="ptitle" style="margin-bottom:6px">Habitat overrides · ingeniería</div><div class="muted" style="font-size:11px;margin-bottom:6px">Ajustes manuales para demos. En vuelo estos valores llegan del ECLSS.</div>';
  cal.appendChild(habOv);
  HAB.forEach(([id]) => { const inp = $(id); const lab = inp && inp.closest('label'); if (lab) habOv.appendChild(lab); });
  function renderHab() {
    const H = B.H;
    for (const [id, key, , , d, , [lo, hi], [w, c], dir] of HAB) {
      const v = +H[key]; const ve = $('hlv_' + id); if (!ve || !Number.isFinite(v)) continue;
      const lvl = dir === 'up' ? (v >= c ? 'crit' : v >= w ? 'warn' : 'ok') : (v <= c ? 'crit' : v <= w ? 'warn' : 'ok');
      const col = COL[lvl], frac = clamp((v - lo) / (hi - lo), 0, 1), n = Math.round(frac * 24);
      ve.textContent = d ? v.toFixed(d) : Math.round(v).toLocaleString('es');
      const se = $('hls_' + id); se.textContent = lvl === 'ok' ? 'NOMINAL' : lvl === 'warn' ? 'PRECAUCIÓN' : 'CRÍTICO'; se.style.color = col;
      const g = $('hlg_' + id); g.querySelectorAll('i').forEach((seg, i) => (seg.style.background = i < n ? col : ''));
      const ss = g.querySelectorAll('s'); [w, c].forEach((t, i) => (ss[i].style.left = `${clamp((t - lo) / (hi - lo), 0, 1) * 100}%`));
    }
  }

  /* ================================================================ NASA DONKI en vivo */
  const ago = (t) => { if (!t) return ''; const h = (Date.now() - Date.parse(t)) / 36e5; return h < 48 ? `hace ${Math.max(0, h).toFixed(0)} h` : `hace ${(h / 24).toFixed(0)} d`; };
  function renderDonkiGrid() {
    const NA = window.ARES_NASA; if (!NA) return; const NS = NA.N, L = B.evaluate();
    const st = NS.simStorm ? ['SIMULACIÓN · TORMENTA', COL.warn] : NS.reference ? ['REFERENCIA · SIN ENLACE', COL.warn] : NS.status === 'loading' ? ['SINCRONIZANDO', COL.warn] : NS.fromCache ? ['CACHÉ', COL.warn] : NS.status === 'live' || NS.status === 'partial' ? ['EN VIVO', COL.ok] : ['EN ESPERA', COL.na];
    const fl = NS.flr && NS.flr.latest, cm = NS.cme && NS.cme.fastest;
    const cell = (k, v, sub, col = COL.ok) => `<div class="dg"><span class="dk">${k}</span><b style="color:${col}">${v}</b><span class="ds">${sub}</span></div>`;
    donki.innerHTML = `<div class="row" style="justify-content:space-between;margin-bottom:10px"><div class="ptitle">Live NASA DONKI space weather</div><span class="srcTag" style="color:${st[1]};border-color:${st[1]}55">${st[0]}</span></div><div class="dgrid">`
      + cell('FLARE · FLR', fl ? fl.classType : '—', fl ? ago(fl.peakTime || fl.beginTime) : 'sin reporte', fl && /^[X]/.test(fl.classType) ? COL.crit : fl && /^M/.test(fl.classType) ? COL.warn : COL.ok)
      + cell('CME', cm && cm.speed ? `${cm.speed}` : '—', cm ? `km/s · ${ago(cm.time)}` : 'sin CME', cm && cm.speed >= 1000 ? COL.warn : COL.ok)
      + cell('SEP · 30 d', NS.sep ? String(NS.sep.count) : '—', NS.sep && NS.sep.latest ? ago(NS.sep.latest.eventTime) : 'eventos', NS.sep && NS.sep.count ? COL.warn : COL.ok)
      + cell('GOES', `S${NS.sLevel ?? 0}`, NS.protons && NS.protons.now10 != null ? `${fmt(NS.protons.now10, 1)} pfu ≥10 MeV` : 'protones', NS.sLevel >= 2 ? COL.crit : NS.sLevel ? COL.warn : COL.ok)
      + cell('Kp', fmt(NS.kpNow, 1), `G${NS.gLevel ?? 0} · NOAA`, NS.gLevel >= 2 ? COL.crit : NS.gLevel ? COL.warn : COL.ok)
      + cell('BLINDAJE', `×${fmt(NS.swMult, 2)}`, L ? `${fmt(L.R.eff, 2)} mSv/d` : 'dosis', NS.swMult > 1.5 ? COL.crit : NS.swMult > 1 ? COL.warn : COL.ok)
      + '</div>';
  }
  if (window.ARES_NASA) window.ARES_NASA.onChange(renderDonkiGrid);

  /* ================================================================ HUD de la IA dentro del escenario 3D */
  const aiHud = $('aiHud');
  function placeHud() {
    if (!aiHud) return;
    const host = !mq.matches && view.style.display !== 'none' ? N.stage : document.body;
    if (aiHud.parentElement !== host) host.appendChild(aiHud);
  }
  tabs.forEach((t) => t.addEventListener('click', () => setTimeout(placeHud, 0)));
  mq.addEventListener('change', placeHud);

  /* ================================================================ arranque */
  Engine.subscribe(() => { renderData(); renderIsland(); });
  showView('BODY'); setDeck('ai'); layout(); ws.dataset.m = 'vitals'; syncNav(); placeHud();
  // sin registro de sueño todavía: noche simulada (8 h comprimidas en ~4 s) para poblar el anillo de SUEÑO
  setTimeout(() => { if (!(window.ARES_UI && window.ARES_UI.sleepSummary && window.ARES_UI.sleepSummary())) night('ideal'); }, 400);
  renderData(); renderIsland(); renderDonki(); syncMods();
  window.ARES_SHELL = { renderData, renderIsland, syncNav, setDeck, showView };
})();
