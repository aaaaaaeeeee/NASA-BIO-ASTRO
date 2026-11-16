/* =============================================================================
 * BIO-ASTRO · Pestaña "CUERPO 3D" — Gemelo anatómico WebGL (Three.js) + motor de triaje
 * Conecta MAX30102 + MPU6050 (Engine.snap), el hábitat de la nave y el clima espacial real
 * de NASA (ARES_NASA) con 10 órganos. No modifica la lógica de sensores: solo LEE Engine.
 * Si WebGL no está disponible, usa el cuerpo SVG de 3 capas como respaldo.
 * ========================================================================== */
(() => {
  'use strict';
  const { Engine, DSN, clamp } = window.ARES;
  const NASA = window.ARES_NASA;
  const $ = (id) => document.getElementById(id);
  const fmt = (v, d = 0) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d));
  const C = { ok: '#10B981', warn: '#F59E0B', crit: '#EF4444', na: '#63636E', cyan: '#38BDF8' };
  const LBL = { ok: 'NOMINAL', warn: 'PRECAUCIÓN', crit: 'CRÍTICO', na: 'SIN DATOS' };

  /* ======================================================== estado del hábitat */
  const H = {
    loc: "iss", g: 0, sol: 180, co2: 2.2, psi: 14.7, noise: 50, neutron: 0.5, hyd: 2500, zone: 'module', glucose: 95,
    gChangedAt: 0, earth: false, cuffs: false, led: null, airlock: false, hepa: false,
    prebreathe: null, // { t0, speed } temporizador de pre-respiración de O2 (45 min)
  };
  const ZONES = {
    shelter: { name: 'Refugio antitormentas (agua)', mult: 0.15, rssi: '> −50 dBm' },
    module: { name: 'Laboratorio central', mult: 1.0, rssi: '−50 a −70 dBm' },
    dome: { name: 'Cúpula / zona EVA sin blindaje', mult: 2.5, rssi: '< −70 dBm' },
  };
  // Dosis de referencia PUBLICADAS por ubicación (dosis equivalente, mSv/día). spe = fracción del evento solar que llega (modelo BIO-ASTRO)
  const LOCS = {
    iss: { name: "ISS · órbita baja 400 km", short: "ISS", base: 0.5, g: 0, spe: 0.3, delay: "≈0.6 s (TDRS)", src: "NASA: ISS ≈ 0.3–0.8 mSv/día (la magnetosfera desvía la mayoría de protones solares)" },
    moon: { name: "Superficie lunar", short: "LUNA", base: 1.37, g: 0.16, spe: 1, delay: "≈1.3 s", src: "Chang’e-4 LND (Zhang et al. 2020): 1.37 mSv/día en la superficie lunar" },
    transit: { name: "Tránsito Tierra–Marte", short: "TRÁNSITO", base: 1.84, g: 0, spe: 1, delay: "hasta ~22 min", src: "NASA Curiosity · RAD en crucero (Zeitlin et al. 2013): 1.84 mSv/día" },
    mars: { name: "Superficie de Marte", short: "MARTE", base: 0.64, g: 0.38, spe: 0.5, delay: "hasta ~22 min", src: "NASA Curiosity · RAD en Gale (Hassler et al. 2014): 0.64 mSv/día (la atmósfera frena parte de los protones)" },
  };
  const SOLS = { 7: { name: 'Sol 7 · misión corta', delay: '≈1.3 s (Luna)', mf: 0.2 }, 180: { name: 'Sol 180 · ISS', delay: '≈0.6 s (TDRS)', mf: 0.55 }, 850: { name: 'Sol 850 · Marte', delay: 'hasta ~20 min (140 M millas)', mf: 1 } };
  const EX = { amsler: null, onsd: null, pvt: null, radin2: null, rash: null }; // resultados de los autoexámenes
  // Override manual de sensores (para probar sin hardware)
  const OV = { on: false, hr: 72, spo2: 98, hrv: 45, resp: 14, stiffness: 7, tremor: 0.03, reps: 0, sleep_eff: 88, temp: 36.6, rssi: -60 };
  const PREBREATHE_MIN = 45;

  /* ======================================================== estilos */
  const css = document.createElement('style');
  css.textContent = `
  .b3 { display:grid; grid-template-columns:310px minmax(0,1fr) 390px; gap:12px; }
  @media (max-width:1250px) { .b3 { grid-template-columns:1fr; } }
  .hab label { display:block; font-size:11.5px; margin-bottom:10px; }
  .hab .hv { font-family:ui-monospace,Menlo,monospace; float:right; font-weight:700; }
  .hab .ref { display:block; font-family:ui-monospace,Menlo,monospace; font-size:9.5px; color:#63636E; margin-top:3px; line-height:1.35; }
  .hab input[type=range], .ovr input[type=range] { -webkit-appearance:none; appearance:none; width:100%; height:4px; background:rgba(56,189,248,.18); border-radius:2px; margin-top:6px; }
  .hab input[type=range]::-webkit-slider-thumb, .ovr input[type=range]::-webkit-slider-thumb { -webkit-appearance:none; width:13px; height:13px; border-radius:2px; background:var(--cyan); box-shadow:0 0 8px var(--cyan); cursor:pointer; }
  .seg3 { display:flex; flex-wrap:wrap; border:1px solid rgba(56,189,248,.35); border-radius:4px; overflow:hidden; margin:4px 0 10px; }
  .seg3 button { flex:1; font-family:ui-monospace,Menlo,monospace; font-size:10px; padding:6px 4px; color:#A0A0AB; background:none; border:0; cursor:pointer; }
  .seg3 button.on { background:rgba(56,189,248,.2); color:#fff; }
  .seg3 button:disabled { opacity:.4; cursor:not-allowed; }
  .stageWrap { position:relative; height:700px; perspective:1100px; overflow:hidden; border-radius:6px;
    background:radial-gradient(ellipse at 50% 45%, rgba(56,189,248,.09), transparent 62%), #03060d; }
  .has3d .stack, .has3d .laser, .has3d .laserGlow { display:none !important; }
  .b3d { position:absolute; inset:0; }
  .c3d { position:absolute; inset:0; width:100%; height:100%; display:block; cursor:grab; }
  .c3dl { position:absolute; inset:0; pointer-events:none; }
  .l3d { font-family:ui-monospace,Menlo,monospace; font-size:11px; letter-spacing:.1em; padding:3px 8px; border:1px solid; border-radius:3px; background:rgba(5,8,17,.82); white-space:nowrap; transition:opacity .3s; }
  .l3d.small { font-size:9px; letter-spacing:.04em; opacity:.8; } .l3d.sel { font-size:11px; letter-spacing:.04em; }
  .stack { position:absolute; inset:0; transform-style:preserve-3d; transition:transform .9s cubic-bezier(.2,.8,.2,1); }
  .layer { position:absolute; inset:0; transition:transform .9s cubic-bezier(.2,.8,.2,1), opacity .4s; pointer-events:none; }
  .layer svg { width:100%; height:100%; display:block; overflow:visible; }
  .layer .frame { opacity:0; transition:opacity .5s; }
  .layer .ltag { position:absolute; top:10px; left:50%; transform:translateX(-50%); font-family:ui-monospace,Menlo,monospace; font-size:11px; letter-spacing:.12em; padding:4px 10px; border:1px solid; border-radius:3px; background:rgba(5,8,17,.8); opacity:0; transition:opacity .5s; white-space:nowrap; }
  .exploded .stack { transform:scale(.78) rotateY(-28deg) rotateX(8deg); }
  .exploded .L1 { transform:translateX(-230px) translateZ(-140px); }
  .exploded .L2 { transform:translateZ(10px); }
  .exploded .L3 { transform:translateX(230px) translateZ(160px); }
  .exploded .layer .frame, .exploded .layer .ltag { opacity:1; }
  .organ { pointer-events:all; cursor:pointer; transition:opacity .35s; }
  .organ * { fill:var(--c,#63636E); fill-opacity:.28; stroke:var(--c,#63636E); stroke-width:1.5; transition:fill .4s, stroke .4s; }
  .organ.line * { fill:none; }
  .organ:hover * { fill-opacity:.55; stroke-width:2.2; }
  .organ.sel * { stroke:#fff; stroke-width:2.4; }
  .organ.crit { animation:orgPulse 1s ease-in-out infinite; }
  .organ.dim { opacity:.15; }
  @keyframes orgPulse { 50% { opacity:.45; } }
  #organ-heart .beat { transform-box:fill-box; transform-origin:center; animation:beat var(--hb,.9s) ease-out infinite; }
  @keyframes beat { 0% { transform:scale(1) } 12% { transform:scale(1.16) } 30% { transform:scale(1) } }
  .flow { fill:none; stroke-dasharray:6 9; animation:flow var(--fs,1.6s) linear infinite; }
  @keyframes flow { to { stroke-dashoffset:-30; } }
  .vec { transition:opacity .5s; }
  .laser { position:absolute; left:4%; right:4%; height:2px; background:var(--cyan); box-shadow:0 0 14px 3px var(--cyan); display:none; z-index:5; pointer-events:none; }
  .laserGlow { position:absolute; left:0; right:0; top:0; background:linear-gradient(180deg, rgba(56,189,248,0), rgba(56,189,248,.09)); display:none; z-index:4; pointer-events:none; }
  .scanHud { position:absolute; left:10px; right:10px; bottom:10px; z-index:6; display:none; }
  .olist button { width:100%; display:flex; justify-content:space-between; align-items:center; gap:8px; background:none; border:1px solid rgba(255,255,255,.08); border-radius:4px; padding:6px 8px; margin-bottom:4px; color:#F4F3EF; cursor:pointer; font-size:11.5px; text-align:left; }
  .olist button:hover { border-color:rgba(56,189,248,.5); }
  .olist .st { font-family:ui-monospace,Menlo,monospace; font-size:10px; padding:2px 6px; border-radius:3px; border:1px solid; white-space:nowrap; }
  .cite { display:inline-block; font-family:ui-monospace,Menlo,monospace; font-size:9.5px; padding:2px 6px; border:1px solid rgba(56,189,248,.35); color:#A0A0AB; border-radius:3px; margin:0 4px 4px 0; text-decoration:none; }
  a.cite:hover { border-color:#fff; color:#fff; }
  .insp h3 { font-family:ui-monospace,Menlo,monospace; font-size:15px; color:#fff; letter-spacing:.06em; }
  .insp .sec { margin-top:10px; }
  .insp .sec > div:first-child { font-family:ui-monospace,Menlo,monospace; font-size:10px; letter-spacing:.12em; color:var(--cyan); margin-bottom:4px; }
  .insp p, .insp li { font-size:12px; line-height:1.5; color:#F4F3EF; } .insp ul { padding-left:16px; }
  .fix { display:flex; gap:8px; align-items:flex-start; border:1px solid rgba(255,255,255,.08); border-radius:4px; padding:7px 8px; margin-bottom:6px; font-size:11.5px; }
  .fix .btn { padding:4px 8px; font-size:10px; margin-left:auto; flex-shrink:0; }
  .bmodal { position:fixed; inset:0; z-index:200; background:rgba(0,0,0,.78); display:none; align-items:center; justify-content:center; padding:16px; }
  .bmodal.show { display:flex; }
  .bmodal .box { width:min(980px,100%); max-height:92vh; overflow:auto; background:#121215; }
  .amsler { display:grid; grid-template-columns:repeat(15,1fr); width:min(440px,90vw); aspect-ratio:1; border:1px solid #F4F3EF; background:#fff; position:relative; user-select:none; }
  .amsler div { border:1px solid #333; cursor:pointer; }
  .amsler div.w { background:#F59E0B; }
  .amsler .dot { position:absolute; left:50%; top:50%; width:10px; height:10px; margin:-5px; border-radius:50%; background:#000; pointer-events:none; }
  .demo button { font-size:10.5px; padding:6px 8px; }
  .nasa .kv { display:flex; justify-content:space-between; gap:8px; font-size:11px; padding:3px 0; border-bottom:1px solid rgba(255,255,255,.05); }
  .nasa .kv span:last-child { font-family:ui-monospace,Menlo,monospace; color:#fff; text-align:right; }
  .nasa input { width:100%; background:#1A1A1F; border:1px solid rgba(56,189,248,.35); color:#F4F3EF; border-radius:4px; font-size:11.5px; padding:6px; font-family:ui-monospace,Menlo,monospace; }
  .ovr summary { cursor:pointer; font-family:ui-monospace,Menlo,monospace; font-size:10.5px; letter-spacing:.14em; color:var(--cyan); text-transform:uppercase; }
  .ovr label { display:block; font-size:11px; margin-top:8px; } .ovr .hv { float:right; font-family:ui-monospace,Menlo,monospace; color:#fff; }
  .shelterAlert { display:none; border-color:var(--red) !important; color:var(--red); }
  .shelterAlert.show { display:flex; }
  `;
  document.head.appendChild(css);

  /* ======================================================== cuerpo SVG (respaldo sin WebGL) */
  const BODY = 'M150 20 C176 20 186 40 186 62 C186 86 174 100 162 104 L162 118 C182 122 200 126 208 134 C214 152 214 172 212 196 L222 300 C224 314 222 322 216 324 L206 306 L200 214 L196 232 C194 262 194 290 198 318 C200 330 190 338 178 340 L176 470 L182 584 C184 596 166 598 160 590 L156 470 L152 350 L148 350 L144 470 L140 590 C134 598 116 596 118 584 L124 470 L122 340 C110 338 100 330 102 318 C106 290 106 262 104 232 L100 214 L94 306 L84 324 C78 322 76 314 78 300 L88 196 C86 172 86 152 92 134 C100 126 118 122 138 118 L138 104 C126 100 114 86 114 62 C114 40 124 20 150 20 Z';
  const svgOpen = '<svg viewBox="0 0 300 620" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">';
  const frame = (c) => `<rect class="frame" x="40" y="6" width="220" height="608" rx="10" fill="${c}" fill-opacity=".035" stroke="${c}" stroke-opacity=".55" stroke-dasharray="5 5"/>`;
  const silhouette = (op) => `<path d="${BODY}" fill="none" stroke="#38BDF8" stroke-opacity="${op}" stroke-width="1.1"/>`;
  const vert = Array.from({ length: 18 }, (_, i) => `<rect x="145" y="${124 + i * 11}" width="10" height="8" rx="2"/>`).join('');
  const L1 = `${svgOpen}${frame('#F59E0B')}${silhouette(0.12)}
    <g class="organ" id="organ-spine" data-organ="spine">${vert}<path d="M118 330 Q150 352 182 330 L176 318 Q150 336 124 318 Z"/></g>
    <g class="organ" id="organ-femur" data-organ="femur"><path d="M128 344 L124 462 L132 462 L138 344 Z"/><path d="M162 344 L168 462 L176 462 L172 344 Z"/><circle cx="128" cy="466" r="6"/><circle cx="172" cy="466" r="6"/></g>
    <g class="organ" id="organ-kidneys" data-organ="kidneys"><path d="M122 262 C110 262 110 290 122 292 C130 293 132 284 128 277 C132 270 130 262 122 262 Z"/><path d="M178 262 C190 262 190 290 178 292 C170 293 168 284 172 277 C168 270 170 262 178 262 Z"/></g>
    <g class="vec" id="vector-calcium" style="opacity:0"><path class="flow" d="M130 456 Q114 372 124 296" stroke="#F59E0B" stroke-width="2.4"/><path class="flow" d="M170 456 Q186 372 176 296" stroke="#F59E0B" stroke-width="2.4"/></g></svg>
    <div class="ltag" style="color:#F59E0B;border-color:#F59E0B">L1: ESQUELÉTICO &amp; RENAL</div>`;
  const L2 = `${svgOpen}${frame('#38BDF8')}${silhouette(0.55)}
    <g class="organ" id="organ-lungs" data-organ="lungs"><path d="M120 146 C100 150 98 210 106 224 C114 232 134 228 138 214 L138 156 C136 148 128 144 120 146 Z"/><path d="M180 146 C200 150 202 210 194 224 C186 232 166 228 162 214 L162 156 C164 148 172 144 180 146 Z"/></g>
    <g class="organ line" id="organ-carotid" data-organ="carotid"><path d="M146 186 Q140 140 141 96" stroke-width="3"/><path d="M156 186 Q160 140 159 96" stroke-width="3"/></g>
    <g class="organ" id="organ-heart" data-organ="heart"><path class="beat" d="M156 216 C136 202 134 186 145 181 C152 178 156 185 156 188 C156 185 161 178 168 181 C178 186 176 202 156 216 Z"/></g>
    <g class="vec" id="vector-fluid" style="opacity:0"><path class="flow" d="M134 560 L136 380 L140 260 L144 130" stroke="#38BDF8" stroke-width="2"/><path class="flow" d="M166 560 L164 380 L160 260 L156 130" stroke="#38BDF8" stroke-width="2"/></g></svg>
    <div class="ltag" style="color:#38BDF8;border-color:#38BDF8">L2: CARDIO &amp; PULMONAR</div>`;
  const L3 = `${svgOpen}${frame('#D4FF33')}${silhouette(0.12)}
    <g class="organ" id="organ-brain" data-organ="brain"><path d="M150 30 C128 30 120 44 122 56 C118 66 128 76 138 74 C142 80 158 80 162 74 C172 76 182 66 178 56 C180 44 172 30 150 30 Z"/></g>
    <g class="organ" id="organ-eyes" data-organ="eyes"><circle cx="139" cy="84" r="5.5"/><circle cx="161" cy="84" r="5.5"/></g>
    <g class="organ" id="organ-vestibular" data-organ="vestibular"><circle cx="117" cy="70" r="4"/><circle cx="183" cy="70" r="4"/></g>
    <g class="organ" id="organ-marrow" data-organ="marrow"><rect x="146" y="150" width="8" height="54" rx="3"/><circle cx="104" cy="146" r="3.5"/><circle cx="196" cy="146" r="3.5"/><circle cx="128" cy="332" r="3.5"/><circle cx="172" cy="332" r="3.5"/></g>
    <g class="vec" id="vector-rad" style="opacity:0"></g></svg>
    <div class="ltag" style="color:#D4FF33;border-color:#D4FF33">L3: NEURO &amp; INMUNE</div>`;

  const ORG = {
    brain: { name: 'Cerebro (corteza)', sys: 'neuro', layer: 3, tool: 'onsd' },
    eyes: { name: 'Ojos y nervio óptico', sys: 'neuro', layer: 3, tool: 'amsler' },
    vestibular: { name: 'Oído interno (laberinto)', sys: 'neuro', layer: 3, tool: 'pvt' },
    marrow: { name: 'Médula ósea y ganglios', sys: 'immune', layer: 3, tool: 'radin2' },
    heart: { name: 'Corazón', sys: 'cardio', layer: 2 },
    lungs: { name: 'Pulmones', sys: 'cardio', layer: 2 },
    carotid: { name: 'Carótidas y aorta', sys: 'cardio', layer: 2 },
    spine: { name: 'Columna, costillas y pelvis', sys: 'skeletal', layer: 1 },
    femur: { name: 'Fémures', sys: 'skeletal', layer: 1 },
    kidneys: { name: 'Riñones', sys: 'skeletal', layer: 1, tool: 'flank' },
  };

  /* ======================================================== DOM */
  const ovSlider = (k, label, min, max, step) => `<label>${label} <span class="hv" id="ov_${k}V"></span><input type="range" id="ov_${k}" min="${min}" max="${max}" step="${step}"></label>`;
  $('viewBODY').innerHTML = `
  <div class="panel row shelterAlert pulse-red" id="bShelter"></div>
  <div class="panel row" id="bEarthBanner" style="display:none;border-color:var(--green);color:var(--green)"><b class="mono">MODO TIERRA · TELEMEDICINA GERIÁTRICA Y RURAL</b><span class="muted" style="color:#F4F3EF">Umbrales adaptados a adultos mayores (CSA · transferencia tecnológica). Gravedad fija en 1g.</span></div>
  <div class="b3">
    <!-- ---------------- IZQUIERDA -->
    <div style="display:flex;flex-direction:column;gap:12px;min-width:0">
      <section class="panel nasa" id="bNasa">
        <div class="row" style="justify-content:space-between;margin-bottom:8px"><div class="ptitle">Telemetría NASA en vivo · DONKI + OSDR</div><span class="mono" id="nStatus" style="font-size:10px"></span></div>
        <div class="row" style="gap:6px;flex-wrap:nowrap"><input type="password" id="nKey" placeholder="NASA API key" autocomplete="off" /><button class="btn" id="nShow" style="padding:5px 7px;font-size:10px">VER</button></div>
        <button class="btn" id="nFetch" style="width:100%;margin-top:6px">[ OBTENER DATOS NASA EN VIVO ]</button>
        <div id="nBody" style="margin-top:8px"></div>
      </section>
      <section class="panel hab">
        <div class="row" style="justify-content:space-between;margin-bottom:8px"><div class="ptitle">Hábitat de la nave · ECLSS</div>
          <label class="mono" style="font-size:10px;margin:0;display:flex;gap:5px;align-items:center"><input type="checkbox" id="hEarth"> MODO TIERRA</label></div>
        <div class="mono" style="font-size:10.5px;color:#A0A0AB">UBICACIÓN DE LA MISIÓN (dosis NASA de referencia)</div>
        <div class="seg3" id="hLoc">${Object.entries(LOCS).map(([k, l]) => `<button data-v="${k}">${l.short}</button>`).join("")}</div>
        <div class="mono" id="hLocSrc" style="font-size:9.5px;color:#A0A0AB;margin:-4px 0 10px;line-height:1.4"></div>
        <div class="mono" style="font-size:10.5px;color:#A0A0AB">RÉGIMEN DE GRAVEDAD</div>
        <div class="seg3" id="hG">${[[0, '0g ISS'], [0.16, '0.16g Luna'], [0.38, '0.38g Marte'], [1, '1g Tierra']].map(([v, l]) => `<button data-v="${v}">${l}</button>`).join('')}</div>
        <div class="mono" style="font-size:10.5px;color:#A0A0AB">DÍA DE MISIÓN (NASA CIPHER)</div>
        <div class="seg3" id="hSol">${[7, 180, 850].map((v) => `<button data-v="${v}">SOL ${v}</button>`).join('')}</div>
        <div class="mono" id="hDelay" style="font-size:10.5px;margin:-4px 0 10px"></div>
        <label>pCO₂ de cabina <span class="hv" id="hCo2V"></span><input type="range" id="hCo2" min="0.5" max="8" step="0.1" /><span class="ref">ISS típico 2–4 mmHg · SANS se agrava &gt; 4 mmHg (NASA HRP)</span></label>
        <label>Presión de cabina <span class="hv" id="hPsiV"></span><input type="range" id="hPsi" min="4.3" max="14.7" step="0.1" /><span class="ref">ISS 14.7 psi · atmósfera de exploración 8.2 psi / 34 % O₂ · traje EVA 4.3 psi</span></label>
        <label>Ruido de cabina <span class="hv" id="hNoiseV"></span><input type="range" id="hNoise" min="40" max="85" step="1" /></label>
        <label>Hidratación del día <span class="hv" id="hHydV"></span><input type="range" id="hHyd" min="500" max="4000" step="100" /><span class="ref">objetivo ≥ 2–2.5 L/día contra cálculos renales (NASA HRP)</span></label>
        <label>Glucosa en ayunas (CSA) <span class="hv" id="hGluV"></span><input type="range" id="hGlu" min="70" max="200" step="1" /><span class="ref">normal &lt; 100 · prediabetes 100–125 · diabetes ≥ 126 mg/dL</span></label>
        <label>Dosis base de rayos cósmicos (GCR) <span class="hv" id="hNeuV"></span><input type="range" id="hNeu" min="0.1" max="3.5" step="0.01" /><span class="ref" id="hNeuRef"></span></label>
        <div class="mono" style="font-size:10.5px;color:#A0A0AB">ZONA DE BLINDAJE (Wi-Fi RSSI del ESP32-C3)</div>
        <div class="seg3" id="hZone">${Object.keys(ZONES).map((k) => `<button data-v="${k}">${k === 'shelter' ? 'REFUGIO ×0.15' : k === 'module' ? 'LAB ×1.0' : 'EVA ×2.5'}</button>`).join('')}</div>
        <div class="mono" id="hZoneInfo" style="font-size:10.5px;color:#A0A0AB;margin-top:-4px"></div>
        <div class="mono" id="hState" style="font-size:10.5px;margin-top:8px;line-height:1.6"></div>
      </section>
      <section class="panel">
        <div class="ptitle" style="margin-bottom:8px">Lecturas del brazalete usadas por el cuerpo</div>
        <div id="bLive" class="mono" style="font-size:11px;line-height:1.75"></div>
      </section>
      <section class="panel ovr">
        <details id="ovBox"><summary>Override manual de sensores (sin hardware)</summary>
          <label class="mono" style="font-size:11px;display:flex;gap:6px;align-items:center;margin-top:8px"><input type="checkbox" id="ovOn"> Usar estos valores en lugar del brazalete</label>
          ${ovSlider('hr', 'FC (lpm)', 35, 160, 1)}${ovSlider('spo2', 'SpO₂ (%)', 80, 100, 0.5)}${ovSlider('hrv', 'HRV RMSSD (ms)', 8, 120, 1)}${ovSlider('resp', 'Respiración (rpm)', 6, 34, 1)}
          ${ovSlider('stiffness', 'Rigidez SI (m/s)', 4, 14, 0.1)}${ovSlider('tremor', 'Temblor (rad/s)', 0, 0.6, 0.01)}${ovSlider('reps', 'Reps ARED', 0, 40, 1)}${ovSlider('sleep_eff', 'Eficiencia de sueño (%)', 40, 100, 1)}
          ${ovSlider('temp', 'Temperatura (°C)', 35.5, 39.5, 0.05)}${ovSlider('rssi', 'Wi-Fi RSSI (dBm)', -90, -35, 1)}
        </details>
      </section>
      <section class="panel demo">
        <div class="ptitle" style="margin-bottom:8px">Demo con el simulador (pasa por el DSP real)</div>
        <div class="simbtns" style="grid-template-columns:1fr 1fr">
          <button class="btn" data-demo="shake">AGITAR MUÑECA</button>
          <button class="btn" data-demo="reps">15 REPS ARED</button>
          <button class="btn" data-demo="hypoxia">CAÍDA DE SpO₂</button>
          <button class="btn" data-demo="tachy">TAQUICARDIA</button>
          <button class="btn" data-demo="stiff">RIGIDEZ ARTERIAL</button>
          <button class="btn" data-demo="reset">VOLVER A NORMAL</button>
        </div>
      </section>
    </div>

    <!-- ---------------- CENTRO -->
    <section class="panel" style="min-width:0">
      <div class="row" style="justify-content:space-between;margin-bottom:8px;gap:8px">
        <div class="row" style="gap:6px" id="bFilter">
          ${[['all', 'TODOS'], ['neuro', 'NEURO / SANS'], ['cardio', 'CARDIO / PULM'], ['skeletal', 'ESQUELÉTICO / RENAL'], ['immune', 'RAD / INMUNE']].map(([k, l]) => `<button class="btn" data-f="${k}" style="padding:5px 8px;font-size:10.5px">[ ${l} ]</button>`).join('')}
        </div>
        <button class="btn" id="bSplit" style="padding:5px 10px;font-size:10.5px">[ EXPLOTAR CAPAS 3D ]</button>
      </div>
      <div class="stageWrap" id="bStageWrap">
        <div class="b3d" id="b3d"></div>
        <div class="stack" id="bStack">
          <div class="layer L1">${L1}</div><div class="layer L2">${L2}</div><div class="layer L3">${L3}</div>
        </div>
        <div class="laserGlow" id="bGlow"></div><div class="laser" id="bLaser"></div>
        <div class="scanHud panel" id="bHud" style="background:rgba(5,8,17,.85)">
          <div class="row mono" style="justify-content:space-between;font-size:11px"><span id="bHudStage" style="color:var(--cyan)"></span><span id="bHudT" style="color:#fff"></span></div>
          <div class="bar" style="height:5px;margin-top:5px"><div id="bHudBar" style="width:0;background:var(--cyan)"></div></div>
          <div class="mono" id="bHudLock" style="font-size:10.5px;color:#A0A0AB;margin-top:4px"></div>
        </div>
        <div class="mono" id="bHint" style="position:absolute;left:10px;top:10px;font-size:10.5px;color:#A0A0AB;z-index:3;pointer-events:none"></div>
        <div class="mono" id="bBpm" style="position:absolute;right:10px;top:34px;font-size:11px;z-index:3;text-align:right;pointer-events:none"></div>
      </div>
      <div class="row" style="gap:8px;margin-top:10px">
        <button class="btn" id="bScan" style="flex:1;padding:10px;font-size:12px">[ INICIAR BIO-ESCANEO 3D · 30 s ]</button>
        <button class="btn" id="bScanFast" style="padding:10px;font-size:11px">[ DEMO RÁPIDA · 8 s ]</button>
      </div>
    </section>

    <!-- ---------------- DERECHA -->
    <div style="display:flex;flex-direction:column;gap:12px;min-width:0">
      <section class="panel">
        <div class="row" style="justify-content:space-between;margin-bottom:8px"><div class="ptitle" id="bScoreTitle">Aptitud EVA y de vuelo</div><span class="mono" id="bGo" style="font-weight:700"></span></div>
        <div class="row" style="align-items:flex-end;gap:10px"><span class="mono" id="bScore" style="font-size:44px;font-weight:700;line-height:1">—</span><span class="mono muted">/ 100</span></div>
        <div class="bar" style="margin-top:6px"><div id="bScoreBar" style="width:0"></div></div>
        <div class="muted" id="bScoreWhy" style="margin-top:6px"></div>
        <div class="mono" id="bClear" style="font-size:10.5px;margin-top:8px;line-height:1.7"></div>
      </section>
      <section class="panel"><div class="ptitle" style="margin-bottom:8px">Estado de los 10 órganos</div><div class="olist" id="bList"></div></section>
      <section class="panel insp" id="bInsp"><div class="muted">Selecciona un órgano en el cuerpo 3D o en la lista para ver qué está pasando, por qué, y qué hacer.</div></section>
    </div>
  </div>
  <div class="bmodal" id="bModal"><div class="panel box" id="bModalBox"></div></div>`;

  /* ======================================================== cuerpo 3D (WebGL) o respaldo SVG */
  let filter = 'all', exploded = false, selected = null;
  const use3D = !!(window.ARES_3D && window.ARES_3D.init($('b3d'), (o) => select(o)));
  $('bStageWrap').classList.toggle('has3d', use3D);
  $('bHint').textContent = use3D ? 'Arrastra para rotar 360° · rueda para zoom · clic derecho para desplazar · clic en un órgano para inspeccionarlo' : 'WebGL no disponible: vista SVG de respaldo. Clic en un órgano para inspeccionarlo.';
  if (!use3D) document.querySelectorAll('#viewBODY .organ').forEach((g) => g.addEventListener('click', (e) => { e.stopPropagation(); select(g.dataset.organ); }));

  /* ======================================================== controles del hábitat */
  function syncSimG(v) { Engine.sim.g = v; document.querySelectorAll('#gSeg button').forEach((b) => b.classList.toggle('on', +b.dataset.g === v)); }
  const setG = (v) => { if (v !== H.g) { H.gChangedAt = Date.now(); H.g = v; syncSimG(v); } };
  const seg = (id, key, cast = Number) => {
    $(id).querySelectorAll('button').forEach((b) => (b.onclick = () => { const v = cast(b.dataset.v); if (key === 'g') setG(v); else H[key] = v; render(); }));
  };
  seg('hG', 'g'); seg('hSol', 'sol'); seg('hZone', 'zone', String);
  $("hLoc").querySelectorAll("button").forEach((b) => (b.onclick = () => { const L = LOCS[b.dataset.v]; H.loc = b.dataset.v; H.neutron = L.base; $("hNeu").value = L.base; if (!H.earth) setG(L.g); Engine.event(`Ubicación: ${L.name} · dosis de referencia ${L.base} mSv/día`); render(); }));
  syncSimG(H.g);
  const slide = (id, key) => { $(id).value = H[key]; $(id).oninput = (e) => { H[key] = +e.target.value; render(); }; };
  slide('hCo2', 'co2'); slide('hPsi', 'psi'); slide('hNoise', 'noise'); slide('hHyd', 'hyd'); slide('hNeu', 'neutron'); slide('hGlu', 'glucose');
  $('hEarth').onchange = (e) => { H.earth = e.target.checked; if (H.earth) setG(1); Engine.event(H.earth ? 'Modo Tierra: telemedicina geriátrica y rural' : 'Modo espacio profundo'); render(); };
  $('bFilter').querySelectorAll('button').forEach((b) => (b.onclick = () => { filter = b.dataset.f; render(); }));
  $('bSplit').onclick = () => {
    exploded = !exploded; $('bStageWrap').classList.toggle('exploded', exploded && !use3D);
    $('bSplit').textContent = exploded ? '[ UNIR CAPAS ]' : '[ EXPLOTAR CAPAS 3D ]'; $('bSplit').classList.toggle('on', exploded); render();
  };
  // override manual
  for (const k of Object.keys(OV)) {
    if (k === 'on') continue;
    const el = $('ov_' + k); el.value = OV[k];
    const show = () => ($('ov_' + k + 'V').textContent = OV[k]);
    el.oninput = (e) => { OV[k] = +e.target.value; show(); render(); }; show();
  }
  $('ovOn').onchange = (e) => { OV.on = e.target.checked; Engine.event(OV.on ? 'Override manual de sensores ACTIVO (valores ficticios)' : 'Override manual desactivado: datos del brazalete', OV.on ? 'warn' : 'info'); render(); };

  /* ======================================================== NASA */
  $('nKey').value = NASA.N.key;
  $('nShow').onclick = () => { const i = $('nKey'); i.type = i.type === 'password' ? 'text' : 'password'; $('nShow').textContent = i.type === 'password' ? 'VER' : 'OCULTAR'; };
  const applyKey = () => { const v = $("nKey").value.trim(); if (!v) return; const changed = v !== NASA.N.key; NASA.setKey(v); if (changed) Engine.event("Clave NASA guardada en este navegador", "ok"); NASA.fetchAll(true); };
  $("nFetch").onclick = applyKey;
  $("nKey").addEventListener("keydown", (e) => { if (e.key === "Enter") applyKey(); });           // Enter también guarda y consulta
  $("nKey").addEventListener("change", () => { if ($("nKey").value.trim() !== NASA.N.key) applyKey(); }); // y al salir del campo
  NASA.onChange(() => { renderNasa(); render(); });
  function renderNasa() {
    const N = NASA.N, st = $('nStatus');
    const stTxt = { idle: ['SIN CONSULTAR', C.na], loading: ['CONSULTANDO…', C.cyan], live: ['EN VIVO', C.ok], partial: ['PARCIAL · DONKI CON ERRORES', C.warn], cache: ['CACHÉ (offline)', C.warn], error: ['SIN CONEXIÓN', C.crit] }[N.status];
    if (N.reference) { stTxt[0] = 'REFERENCIA · SIN ENLACE'; stTxt[1] = C.warn; }
    else if (N.refFields && N.refFields.length && N.status !== 'loading') stTxt[0] += ' · REF ' + N.refFields.join('/');
    st.textContent = stTxt[0]; st.style.color = stTxt[1];
    $('nFetch').disabled = N.status === 'loading';
    const kv = (k, v, c = '#fff') => `<div class="kv"><span style="color:#A0A0AB">${k}</span><span style="color:${c}">${v}</span></div>`;
    const ago = (t) => { if (!t) return ''; const h = (Date.now() - Date.parse(t)) / 36e5; return h < 48 ? `hace ${h.toFixed(0)} h` : `hace ${(h / 24).toFixed(0)} d`; };
    if (N.status === 'idle' || (N.status === 'loading' && !N.fetchedAt)) { $('nBody').innerHTML = '<div class="muted">Consultando NASA DONKI y OSDR…</div>'; return; }
    if (N.status === 'error') { $('nBody').innerHTML = `<div class="muted">Enlace con NASA en espera · reintentando. La dosis usa ×1.0 hasta recibir datos.</div>`; return; }
    const fl = N.flr ? (N.flr.latest ? `${N.flr.latest.classType} · ${ago(N.flr.latest.peakTime || N.flr.latest.beginTime)}` : 'ninguna en 30 d') : 'sin reporte · se usa CME';
    $('nBody').innerHTML =
      kv('Eventos SEP (30 d)', N.sep ? (N.sep.count ? `${N.sep.count} · último ${ago(N.sep.latest.eventTime)}` : '0') : '—', N.sep && N.sep.count ? C.warn : '#fff')
      + (N.sep && N.sep.latest ? `<div class="mono" style="font-size:9.5px;color:#A0A0AB;margin:2px 0 4px">${N.sep.latest.id}</div>` : '')
      + kv('Fulguración más reciente', fl, N.flr ? (/^[MX]/.test(N.flr.latest?.classType || '') ? C.warn : '#fff') : C.na)
      + (N.flr && N.flr.latest ? `<div class="mono" style="font-size:9.5px;color:#A0A0AB;margin:2px 0 4px">${N.flr.latest.id}${N.flr.latest.region ? ' · región ' + N.flr.latest.region : ''}</div>` : '')
      + (!N.flr && N.cme && N.cme.fastest ? kv('CME más rápida (7 d)', `${N.cme.fastest.speed} km/s · ${ago(N.cme.fastest.time)}`, N.cme.fastest.speed >= 1000 ? C.warn : '#fff') + `<div class="mono" style="font-size:9.5px;color:#A0A0AB;margin:2px 0 4px">${N.cme.fastest.id}</div>` : '')
      + kv('Kp (72 h / máx 30 d)', `${fmt(N.kpNow, 1)} / ${fmt(N.kpMax, 1)}`, (N.kpNow ?? 0) >= 5 ? C.warn : '#fff')
      + kv('Apagón DSN / HF (modelo)', `${Math.round(N.blackout * 100)} %`, N.blackout >= 0.25 ? C.warn : '#fff')
      + kv('Multiplicador de neutrones', `×${N.swMult.toFixed(2)}`, N.swMult > 1.5 ? C.crit : N.swMult > 1 ? C.warn : C.ok)
      + `<div class="muted" style="margin-top:4px">${N.swReasons.join('<br>')}</div>`
      + (N.donkiError ? `<div class="muted" style="margin-top:4px">${/429/.test(N.donkiError) ? 'Cuota de DEMO_KEY agotada: pega tu clave gratuita de api.nasa.gov para datos en vivo. ' : 'Parte de DONKI no respondió. '}${N.refFields && N.refFields.length ? 'Campos ' + N.refFields.join(', ') + ' con escenario de referencia (no en vivo).' : 'Se usan los últimos datos guardados.'}</div>` : "")
      + (N.reference ? `<div class="muted" style="margin-top:4px">Sin enlace con NASA y sin caché: valores de un escenario de referencia BIO-ASTRO, no datos en vivo.</div>` : '')
      + `<div class="muted" style="margin-top:4px">${N.fromCache ? "Caché reciente de " : "Actualizado "}${N.fetchedAt ? new Date(N.fetchedAt).toLocaleString() : ''}${N.rateRemaining != null ? ` · cuota restante ${N.rateRemaining}` : ''}${NASA.N.key === 'DEMO_KEY' ? ' · DEMO_KEY (límite bajo: pega tu clave)' : ''}</div>`;
  }

  /* ======================================================== lectura de sensores */
  function readSensors() {
    if (OV.on) {
      const z = OV.rssi > -50 ? 'shelter' : OV.rssi >= -70 ? 'module' : 'dome';
      return { finger: true, bpm: OV.hr, spo2: OV.spo2, rmssd: OV.hrv, resp: OV.resp, si: OV.stiffness, sys: 104 + 3.2 * (OV.stiffness - 6.5) + 0.35 * (OV.hr - 65), temp: OV.temp, held: false,
        mpu: true, tremor: OV.tremor, gyro: null, reps: OV.reps, motion: 0, rssi: OV.rssi, zone: z, zoneAuto: true, sleepH: 8 * OV.sleep_eff / 100, sleepEff: OV.sleep_eff, override: true };
    }
    const s = Engine.snap || {}, m = s.mpu || null;
    // Solo el RSSI del brazalete REAL decide la zona; con el simulador manda la zona elegida en el hábitat
    const realRssi = Engine.source === "serial" && !Engine.failoverActive ? s.rssi : null;
    const zoneFromRssi = realRssi != null ? (realRssi > -50 ? "shelter" : realRssi >= -70 ? "module" : "dome") : null;
    const sl = window.ARES_UI && window.ARES_UI.sleepSummary ? window.ARES_UI.sleepSummary() : null;
    return {
      finger: !!s.finger, bpm: s.finger ? s.bpm : null, spo2: s.finger ? s.spo2 : null, rmssd: s.finger ? s.rmssd : null, resp: s.finger ? s.resp : null,
      si: s.finger ? s.si : null, sys: s.finger ? s.sys : null, temp: s.temp, held: !!s.held,
      mpu: !!m, tremor: m ? m.tremor : null, gyro: m ? m.gyroMag : null, reps: m ? m.reps : null, motion: m ? m.motionEnergy : null,
      rssi: s.rssi, zone: zoneFromRssi || H.zone, zoneAuto: !!zoneFromRssi, sleepH: sl ? sl.hours : null, sleepEff: sl ? sl.efficiency : null, override: false,
    };
  }

  /* ======================================================== motor de estados por órgano */
  const prebreatheDone = () => H.prebreathe && (Date.now() - H.prebreathe.t0) * H.prebreathe.speed >= PREBREATHE_MIN * 60000;
  function evaluate(S) {
    const o = {}, g0 = H.g < 0.1, low = H.g < 0.5, mf = SOLS[H.sol].mf, N = NASA.N, E = H.earth;
    const swRaw = N.swMult || 1, sw = 1 + (swRaw - 1) * LOCS[H.loc].spe, eff = H.neutron * ZONES[S.zone].mult * sw;
    const put = (id, level, value, reasons) => (o[id] = { level, value, reasons });
    const T = E ? { hrW: 100, hrC: 120, siW: 9.5, siC: 11, gluW: 126, gluC: 180 } : { hrW: 95, hrC: 115, siW: 8.5, siC: 10, gluW: 110, gluC: 140 };

    // Corazón — FC del MAX30102 + glucosa (resistencia a la insulina, CSA)
    {
      const r = []; let lv;
      if (S.bpm == null) { lv = 'na'; r.push('El MAX30102 no detecta un dedo con pulso.'); }
      else { lv = S.bpm >= T.hrC || S.bpm < 50 ? 'crit' : S.bpm > T.hrW || S.bpm < 55 ? 'warn' : 'ok'; r.push(`FC ${fmt(S.bpm)} lpm (nominal 55–${T.hrW}).`); }
      if (H.glucose > T.gluW) { if (lv === 'ok' || lv === 'na') lv = 'warn'; r.push(`Glucosa ${H.glucose} mg/dL (> ${T.gluW}): resistencia a la insulina tipo diabetes 2 (CSA).`); }
      put('heart', lv, S.bpm != null ? `${fmt(S.bpm)} lpm` : '—', r);
    }
    // Pulmones — hipoxia (SpO2) vs. descompresión (presión)
    {
      const r = []; let lv = 'ok';
      if (S.spo2 == null) { lv = 'na'; r.push('Sin SpO₂: coloca el dedo en el MAX30102.'); }
      else if (S.spo2 < 93) { lv = 'crit'; r.push(`SpO₂ ${fmt(S.spo2, 1)} % (< 93 %): HIPOXIA alveolar.`); }
      else if (S.spo2 < 96) { lv = 'warn'; r.push(`SpO₂ ${fmt(S.spo2, 1)} % (93–95 %).`); }
      else r.push(`SpO₂ ${fmt(S.spo2, 1)} % normal.`);
      if (H.psi < 10) {
        if (S.spo2 != null && S.spo2 < 93) r.push(`Cabina a ${fmt(H.psi, 1)} psi: hipoxia hipobárica + riesgo de DCS.`);
        else if (!prebreatheDone()) { if (lv !== 'crit') lv = 'warn'; r.push(`Cabina a ${fmt(H.psi, 1)} psi con SpO₂ conservada: patrón de RIESGO DE DCS (burbujas de N₂), no de hipoxia. Completa la pre-respiración de 45 min.`); }
        else r.push(`Cabina a ${fmt(H.psi, 1)} psi · pre-respiración de O₂ completada.`);
      }
      put('lungs', lv, S.spo2 != null ? `${fmt(S.spo2, 1)} %` : `${fmt(H.psi, 1)} psi`, r);
    }
    // Carótidas — rigidez PPG + glucosa (envejecimiento acelerado CSA)
    {
      const r = []; let lv = 'na';
      if (S.si != null) { lv = S.si >= T.siC ? 'crit' : S.si >= T.siW ? 'warn' : 'ok'; r.push(`Índice de rigidez ${fmt(S.si, 1)} m/s (normal < ${T.siW}).`); }
      else r.push('La rigidez se calcula tras ~8 latidos limpios con el dedo quieto.');
      if (H.glucose > T.gluC) { lv = 'crit'; r.push(`Glucosa ${H.glucose} mg/dL (> ${T.gluC}).`); }
      else if (H.glucose > T.gluW) { if (lv !== 'crit') lv = 'warn'; r.push(`Glucosa ${H.glucose} mg/dL (> ${T.gluW}).`); }
      put('carotid', lv, S.si != null ? `SI ${fmt(S.si, 1)}` : `${H.glucose} mg/dL`, r);
    }
    // Cerebro y ojos — SANS: 0g + (CO2 > 4 o PA > 135)
    {
      const r = [], highBp = S.sys != null && S.sys > 135;
      let lv = g0 && (H.co2 > 4 || highBp) ? 'crit' : (g0 && H.co2 >= 3.2) || H.co2 > 4 ? 'warn' : 'ok';
      r.push(`pCO₂ ${fmt(H.co2, 1)} mmHg${g0 ? ' en 0g (fluido desplazado hacia la cabeza)' : ''}.`);
      if (highBp) r.push(`PA sistólica estimada ${fmt(S.sys)} mmHg (> 135, proxy experimental).`);
      if (H.cuffs && lv === 'crit') { lv = 'warn'; r.push('Manguitos de muslo / LBNP activos: retienen fluido en las piernas.'); }
      const eyeR = r.slice(); let eyeLv = lv;
      if (EX.onsd) { const pos = EX.onsd.mm > 5.8; eyeR.push(`ONSD medido ${fmt(EX.onsd.mm, 2)} mm ${pos ? '> 5.8 mm (SANS positivo)' : '(normal)'}.`); if (pos) eyeLv = 'crit'; }
      if (EX.amsler && EX.amsler.cells > 0) { eyeR.push(`Rejilla de Amsler: ${EX.amsler.cells} zona(s) distorsionada(s).`); if (eyeLv !== 'crit') eyeLv = EX.amsler.cells >= 5 ? 'crit' : 'warn'; }
      put('brain', lv, `${fmt(H.co2, 1)} mmHg`, r);
      put('eyes', eyeLv, EX.onsd ? `ONSD ${fmt(EX.onsd.mm, 1)} mm` : `${fmt(H.co2, 1)} mmHg`, eyeR);
    }
    // Oído interno — temblor MPU6050 + sueño (ARCHeR) + ruido + transición gravitatoria
    {
      const r = []; let lv = 'ok';
      if (S.tremor == null) { lv = 'na'; r.push('MPU6050 sin datos.'); }
      else { r.push(`Temblor ${fmt(S.tremor, 3)} rad/s (banda 4–12 Hz).`); if (S.tremor > 0.35) lv = 'crit'; else if (S.tremor > 0.2) lv = 'warn'; }
      if (S.sleepEff != null && S.sleepEff < 70) { lv = 'crit'; r.push(`Eficiencia de sueño ${fmt(S.sleepEff)} % (< 70 %).`); }
      const bump = (msg) => { r.push(msg); if (lv === 'ok' || lv === 'na') lv = 'warn'; };
      if (H.noise > 60) bump(`Ruido de cabina ${H.noise} dB (> 60): fragmenta el sueño.`);
      if (Date.now() - H.gChangedAt < 90000 && H.gChangedAt) bump('Transición gravitatoria reciente: otolitos desorientados.');
      if (EX.pvt) { r.push(`Test vestibular: ${EX.pvt.grade}.`); if (EX.pvt.level === 'crit') lv = 'crit'; else if (EX.pvt.level === 'warn' && lv !== 'crit') lv = 'warn'; }
      put('vestibular', lv, S.tremor != null ? `${fmt(S.tremor, 3)} rad/s` : '—', r);
    }
    // Columna, fémur, riñones — cascada hueso → riñón
    {
      const reps = S.reps ?? 0, r = [], cascade = low && reps < 15;
      r.push(H.g >= 1 ? '1g: la gravedad carga el esqueleto.' : `${reps} reps ARED en ${H.g}g (mínimo 15).`);
      if (!S.mpu && H.g < 1) r.push('Sin MPU6050: no hay registro de ejercicio.');
      r.push(`Pérdida ósea estimada a Sol ${H.sol}: ${fmt(1.25 * (H.sol / 30.4) * (1 - H.g) * (reps >= 15 ? 0.4 : 1), 1)} % (1.0–1.5 %/mes en 0g).`);
      const bl = cascade ? 'warn' : 'ok';
      put('spine', bl, `${reps} reps`, r); put('femur', bl, `${reps} reps`, r);
      const kr = []; let kl = 'ok';
      if (cascade) { kl = 'crit'; kr.push(`Hipercalciuria: el calcio liberado del hueso llega al riñón (${reps} reps < 15 en ${H.g}g).`); }
      if (H.hyd < 2000) { if (kl !== 'crit') kl = 'warn'; kr.push(`Hidratación ${H.hyd} mL (< 2000): orina concentrada → cálculos.`); }
      if (kl === 'ok') kr.push(`Carga ósea e hidratación (${H.hyd} mL) adecuadas.`);
      put('kidneys', kl, `${H.hyd} mL`, kr);
    }
    // Médula ósea — radiación (NASA DONKI × CANS × zona RSSI) + estrés (HRV) + fiebre
    {
      const r = [], lowHrv = S.rmssd != null && S.rmssd < 35, fever = S.temp != null && S.temp > 37.4;
      let lv = 'ok';
      r.push(`Dosis efectiva ${fmt(eff, 2)} mSv/día = ${fmt(H.neutron, 2)} base (${LOCS[H.loc].name}) × ${ZONES[S.zone].mult} (${ZONES[S.zone].name}) × ${fmt(sw, 2)} clima espacial NASA/NOAA.`);
      r.push(`~30 % son neutrones secundarios (CSA CANS / Radi-N2): ${fmt(eff * 0.3, 2)} mSv/día.`);
      if ((S.zone === 'dome' && (N.swActive || H.neutron > 1.2)) || fever) lv = 'crit';
      else if (eff > 1 || N.swActive || lowHrv) lv = 'warn';
      if (N.swActive) r.push(`Clima espacial activo (NASA DONKI): ${N.swReasons.join(' · ')}.`);
      if (lowHrv) r.push(`HRV ${fmt(S.rmssd)} ms (< 35): estrés → reactivación viral latente (VZV, EBV).`);
      if (fever) r.push(`Temperatura ${fmt(S.temp, 2)} °C (> 37.4).`);
      if (EX.radin2) { r.push(`Radi-N2: ${EX.radin2.bubbles} burbujas ≈ ${fmt(EX.radin2.uSv)} µSv de neutrones.`); if (EX.radin2.uSv > 800) lv = 'crit'; else if (EX.radin2.uSv > 300 && lv === 'ok') lv = 'warn'; }
      if (EX.rash && EX.rash.pct > 2) { r.push(`Escáner dérmico: ${fmt(EX.rash.pct, 1)} % de piel enrojecida.`); if (lv === 'ok') lv = 'warn'; }
      put('marrow', lv, `${fmt(eff, 2)} mSv/d`, r);
    }

    // BIO-ASTRO Flight Surgeon: durante un CÓDIGO ROJO confirmado, corazón y cerebro pasan a crítico
    const ai = window.ARES_AI_STATE;
    if (ai && ai.codeRed) {
      o.heart = { level: 'crit', value: 'SIN PULSO', reasons: ['CÓDIGO ROJO: pérdida de pulso confirmada por la IA (MAX30102 sin onda pulsátil + MPU6050 inmóvil).'] };
      o.brain = { level: 'crit', value: 'HIPOPERFUSIÓN', reasons: ['Sin circulación el cerebro empieza a sufrir daño en ~4–6 minutos: RCP inmediata.'] };
    }

    // Puntuación de aptitud EVA y autorizaciones
    let score = 100; const why = [];
    for (const [k, v] of Object.entries(o)) { if (v.level === 'crit') { score -= 22 * (0.8 + 0.2 * mf); why.push(`${ORG[k].name} crítico`); } else if (v.level === 'warn') score -= 8 * (0.8 + 0.2 * mf); }
    const blockers = [];
    if (o.lungs.level === 'crit') blockers.push('hipoxia');
    if (H.psi < 10 && !prebreatheDone()) blockers.push('pre-respiración de O₂ incompleta');
    if (o.heart.level === 'crit') blockers.push('corazón');
    if (S.zone === 'dome' && N.swActive) blockers.push('tormenta solar en zona sin blindaje');
    if (!S.finger) blockers.push('sin pulso óptico');
    score = Math.round(clamp(score, 0, 100));
    const pvtOk = EX.pvt && EX.pvt.level === 'ok' && EX.pvt.at > H.gChangedAt;
    const rover = o.vestibular.level !== 'crit' && (!(H.gChangedAt && Date.now() - H.gChangedAt < 3600e3) || pvtOk) && !(EX.pvt && EX.pvt.level === 'crit');
    const rad = { base: H.neutron, loc: H.loc, zone: S.zone, zoneMult: ZONES[S.zone].mult, swRaw, sw, eff, neutron: eff * 0.3, missionToDate: H.neutron * sw * H.sol, projected: eff * H.sol };
    return { o, score, go: score >= 70 && !blockers.length, blockers, why, eff, rover, rad };
  }

  /* ======================================================== textos para no-médicos y citas */
  const CITE = {
    hazards: 'NASA HRP · 5 Hazards', sans: 'NASA HRP · SANS', bone: 'NASA HRP · Bone Loss & Renal Stone', csarad: 'CSA · CANS / Radi-N2', viral: 'NASA HRP · Viral Reactivation',
    aging: 'CSA · ISS Accelerated Aging', dcs: 'NASA HRP · DCS vs Hypoxia', archer: 'NASA HRP · ARCHeR (Artemis II) · Sleep', cipher: 'NASA CIPHER', donki: 'NASA DONKI (live)',
  };
  const INFO = {
    heart: { cite: ['aging', 'cipher'], osdr: 'cardio', plain: (S) => `Tu corazón late a ${fmt(S.bpm)} lpm según el MAX30102. En microgravedad el corazón trabaja menos y se "desacondiciona". La CSA observó además resistencia a la insulina en 6 meses (glucosa actual ${H.glucose} mg/dL).`,
      crew: [['Ración baja en glucemia y antiinflamatoria', 'ration'], ['Protocolo aeróbico de 30 min en cicloergómetro', 'ergo']], ship: [['Verificar O₂ y CO₂ de cabina', 'co2']] },
    lungs: { cite: ['dcs', 'hazards'], osdr: 'cardio', plain: (S) => `Si la SpO₂ baja de 93 % falta oxígeno (hipoxia). Si la cabina baja de 10 psi pero la SpO₂ sigue normal, el riesgo es otro: el nitrógeno disuelto puede formar burbujas en las articulaciones (enfermedad por descompresión). Cabina: ${fmt(H.psi, 1)} psi · SpO₂: ${S.spo2 != null ? fmt(S.spo2, 1) + ' %' : '—'}.`,
      crew: [['Iniciar pre-respiración de O₂ al 100 % (45 min)', 'prebreathe']], ship: [['Bloquear la despresurización de la esclusa', 'airlock'], ['Depuración HEPA de polvo de regolito', 'hepa'], ['Represurizar cabina a 14.7 psi', 'psi']] },
    carotid: { cite: ['aging'], osdr: 'cardio', plain: (S) => `La forma de cada latido (onda PPG) revela qué tan elásticas son tus arterias. La CSA vio que ~6 meses en la ISS endurecen las carótidas como años de envejecimiento en Tierra. Índice: ${S.si != null ? fmt(S.si, 1) + ' m/s' : 'sin datos'} · glucosa ${H.glucose} mg/dL.`,
      crew: [['Protocolo aeróbico de 30 min en cicloergómetro', 'ergo'], ['Ración baja en glucemia', 'ration']], ship: [['Enviar tendencia al cirujano de vuelo', 'dsn']] },
    brain: { cite: ['sans', 'hazards'], osdr: 'neuro', plain: () => `En 0g la sangre sube hacia la cabeza. Con CO₂ alto (${fmt(H.co2, 1)} mmHg) los vasos del cerebro se dilatan y sube la presión dentro del cráneo: puede deformar el ojo (SANS).`,
      crew: [['Aplicar manguitos de muslo / LBNP (−40 mmHg)', 'cuffs'], ['Guía de ultrasonido ocular (ONSD)', 'tool']], ship: [['Subir el depurador de CO₂ (ECLSS) al 100 %', 'co2']] },
    eyes: { cite: ['sans'], osdr: 'neuro', plain: () => `El nervio óptico está rodeado de una vaina con líquido. Si la presión intracraneal sube, la vaina se ensancha: más de 5.8 mm sugiere SANS. La rejilla de Amsler detecta si ves líneas torcidas.`,
      crew: [['Rejilla de Amsler (1 min)', 'tool'], ['Medir ONSD con la guía de ultrasonido', 'onsd'], ['Aplicar manguitos de muslo / LBNP', 'cuffs']], ship: [['Subir el depurador de CO₂ al 100 %', 'co2']] },
    vestibular: { cite: ['archer', 'hazards'], osdr: 'neuro', plain: (S) => `El oído interno usa cristales (otolitos) para saber dónde es "abajo". Al pasar de 0g a 0.38g se confunde: mareo y torpeza. El MPU6050 mide ${S.tremor != null ? fmt(S.tremor, 3) + ' rad/s' : '—'} de temblor. Hasta 16 amaneceres al día y el ruido rompen el sueño.`,
      crew: [['Test vestibular de 15 s (requisito para conducir el rover)', 'tool']], ship: [['LED de cabina 480 nm (despertar)', 'led480'], ['LED de cabina 630 nm ámbar (dormir) + ventiladores silenciosos', 'led630']] },
    spine: { cite: ['bone', 'hazards'], osdr: 'skeletal', plain: () => `Sin peso sobre el esqueleto, el cuerpo desmonta el hueso: 1.0–1.5 % al mes en columna y cadera. El ejercicio con carga (ARED), contado por el MPU6050, es la contramedida.`,
      crew: [['Completar 15 sentadillas ARED con el brazalete', 'reps']], ship: [['Reservar 30 min de ARED en la agenda', null]] },
    femur: { cite: ['bone'], osdr: 'skeletal', plain: () => `El fémur es el hueso que más pierde. El calcio que sale del hueso viaja por la sangre hasta los riñones (partículas ámbar).`,
      crew: [['Completar 15 sentadillas ARED con el brazalete', 'reps']], ship: [['Reservar 30 min de ARED en la agenda', null]] },
    kidneys: { cite: ['bone'], osdr: 'skeletal', plain: () => `Los riñones filtran el calcio liberado por los huesos. Con poca agua (${H.hyd} mL) el calcio se concentra y forma cálculos renales, una emergencia grave lejos de la Tierra.`,
      crew: [['Beber 500 mL de agua + citrato de potasio', 'hyd'], ['Completar 15 reps ARED', 'reps'], ['Guía de ultrasonido de flanco (riñón)', 'tool']], ship: [['Recordatorios de hidratación', null]] },
    marrow: { cite: ['csarad', 'viral', 'donki'], osdr: 'immune', plain: (S) => `La médula ósea fabrica las células de defensa y es muy sensible a la radiación. El 30 % de la dosis son neutrones secundarios (rayos cósmicos que golpean el casco). Estás en: ${ZONES[S.zone].name}${S.zoneAuto ? ' (por Wi-Fi)' : ''}. Radiación + estrés pueden despertar virus dormidos (herpes zóster, EBV).`,
      crew: [['Contar burbujas del detector Radi-N2', 'tool'], ['Escáner de erupción cutánea', 'rash'], ['Protocolo antiviral / antioxidante', 'antiviral']], ship: [['Evacuar al refugio de agua (RSSI > −50 dBm)', 'shelter']] },
  };

  const ACTIONS = {
    hyd: () => { H.hyd = Math.min(4000, H.hyd + 500); $('hHyd').value = H.hyd; return 'Hidratación +500 mL + citrato de potasio'; },
    co2: () => { H.co2 = 2.0; $('hCo2').value = 2; return 'Depurador de CO₂ al 100 %: pCO₂ → 2.0 mmHg'; },
    psi: () => { H.psi = 14.7; $('hPsi').value = 14.7; return 'Cabina represurizada a 14.7 psi'; },
    airlock: () => { H.airlock = true; return 'Despresurización de la esclusa BLOQUEADA'; },
    hepa: () => { H.hepa = true; return 'Depuración HEPA de polvo de regolito activa'; },
    prebreathe: () => { H.prebreathe = { t0: Date.now(), speed: 1 }; return 'Pre-respiración de O₂ al 100 % iniciada (45 min)'; },
    cuffs: () => { H.cuffs = !H.cuffs; return H.cuffs ? 'Manguitos de muslo / LBNP −40 mmHg aplicados' : 'Manguitos retirados'; },
    led480: () => { H.led = '480'; return 'Iluminación de cabina 480 nm (azul, despertar)'; },
    led630: () => { H.led = '630'; H.noise = Math.min(H.noise, 48); $('hNoise').value = H.noise; return 'Iluminación 630 nm ámbar + modo ventilador silencioso'; },
    ration: () => { H.glucose = Math.max(85, H.glucose - 20); $('hGlu').value = H.glucose; return 'Ración baja en glucemia: glucosa −20 mg/dL'; },
    ergo: () => { H.glucose = Math.max(85, H.glucose - 10); $('hGlu').value = H.glucose; return 'Cicloergómetro 30 min completado'; },
    antiviral: () => 'Protocolo antiviral / antioxidante registrado para el cirujano de vuelo',
    shelter: () => { H.zone = 'shelter'; return 'Tripulante en el refugio de agua (×0.15)'; },
    reps: () => { if (Engine.source === 'serial') return 'Haz 15 sentadillas con el brazalete: el MPU6050 las cuenta en vivo'; if (OV.on) { OV.reps = 15; $('ov_reps').value = 15; $('ov_repsV').textContent = 15; return 'Override: 15 reps'; } startSimIfNeeded(); Engine.sim.startAred(15); return 'Serie ARED de 15 reps (simulada) en curso'; },
    dsn: () => { sendPacket('manual'); return 'Paquete enviado a la cola Earth-Sync'; },
    rash: () => { openTool('rash'); return null; },
  };

  /* ======================================================== render */
  let last = null;
  function render() {
    const S = readSensors(), R = evaluate(S); last = { S, R };
    if (Engine.simActive()) Engine.sim.rssiBase = { shelter: -44, module: -60, dome: -78 }[H.zone];
    const vis = $('viewBODY').style.display !== 'none';
    shelterAlert(S, R);
    if (!vis && !scan) return;
    const N = NASA.N;
    // hábitat
    document.querySelectorAll('#hG button').forEach((b) => { b.classList.toggle('on', +b.dataset.v === H.g); b.disabled = H.earth; });
    document.querySelectorAll("#hLoc button").forEach((b) => { b.classList.toggle("on", b.dataset.v === H.loc); b.disabled = H.earth; });
    $("hLocSrc").textContent = LOCS[H.loc].src;
    $("hNeuRef").textContent = `referencia ${LOCS[H.loc].base} mSv/día · × zona ${R.rad.zoneMult} · × clima espacial ${fmt(R.rad.sw, 2)} = ${fmt(R.eff, 2)} mSv/día · ~30 % neutrones (CSA CANS)`;
    document.querySelectorAll('#hSol button').forEach((b) => b.classList.toggle('on', +b.dataset.v === H.sol));
    document.querySelectorAll('#hZone button').forEach((b) => { b.classList.toggle('on', b.dataset.v === S.zone); b.disabled = S.zoneAuto; });
    $('bEarthBanner').style.display = H.earth ? 'flex' : 'none';
    const colv = (v, w, c) => (v > c ? C.crit : v > w ? C.warn : C.cyan);
    $('hDelay').innerHTML = `<span style="color:#A0A0AB">Enlace con la Tierra:</span> <span style="color:${/min/.test(LOCS[H.loc].delay) ? C.warn : C.cyan}">${LOCS[H.loc].delay}</span>${N.blackout > 0.05 ? ` <span style="color:${C.warn}">· apagón ${Math.round(N.blackout * 100)} %</span>` : ''}`;
    $('hCo2V').textContent = `${fmt(H.co2, 1)} mmHg`; $('hCo2V').style.color = colv(H.co2, 3.2, 4);
    $('hPsiV').textContent = `${fmt(H.psi, 1)} psi`; $('hPsiV').style.color = H.psi < 10 ? C.crit : C.cyan;
    $('hNoiseV').textContent = `${H.noise} dB`; $('hNoiseV').style.color = colv(H.noise, 55, 60);
    $('hHydV').textContent = `${H.hyd} mL`; $('hHydV').style.color = H.hyd < 2000 ? C.warn : C.cyan;
    $('hGluV').textContent = `${H.glucose} mg/dL`; $('hGluV').style.color = colv(H.glucose, H.earth ? 126 : 110, H.earth ? 180 : 140);
    $("hNeuV").textContent = `${fmt(H.neutron, 2)} mSv/d`; $('hNeuV').style.color = colv(R.eff, 1, 2.5);
    $('hZoneInfo').textContent = S.zoneAuto ? `Por RSSI ${fmt(S.rssi)} dBm → ${ZONES[S.zone].name}` : `Manual (el firmware actual no envía RSSI) · ${ZONES[S.zone].rssi}`;
    const pb = H.prebreathe ? Math.min(PREBREATHE_MIN, ((Date.now() - H.prebreathe.t0) * H.prebreathe.speed) / 60000) : null;
    $('hState').innerHTML = [
      H.prebreathe ? `<span style="color:${prebreatheDone() ? C.ok : C.warn}">Pre-respiración O₂: ${fmt(pb, 1)} / ${PREBREATHE_MIN} min</span> <a href="#" id="pbFast" style="color:#A0A0AB">[×60 demo]</a>` : '',
      H.cuffs ? `<span style="color:${C.cyan}">Manguitos de muslo / LBNP activos</span>` : '', H.airlock ? `<span style="color:${C.cyan}">Esclusa bloqueada</span>` : '',
      H.hepa ? `<span style="color:${C.cyan}">HEPA activo</span>` : '', H.led ? `<span style="color:${C.cyan}">LED ${H.led} nm</span>` : '',
    ].filter(Boolean).join('<br>');
    const pf = $('pbFast'); if (pf) pf.onclick = (e) => { e.preventDefault(); H.prebreathe.speed = 60; H.prebreathe.t0 = Date.now() - (pb * 60000) / 60; render(); };
    const row = (k, v, c = '#fff') => `<div style="display:flex;justify-content:space-between"><span style="color:#A0A0AB">${k}</span><span style="color:${c}">${v}</span></div>`;
    $('bLive').innerHTML = (S.override ? row('FUENTE', 'OVERRIDE MANUAL (ficticio)', C.warn) : '')
      + row('MAX30102 · FC', S.bpm != null ? `${fmt(S.bpm)} lpm` : 'sin dedo', S.bpm != null ? '#fff' : C.na)
      + row('MAX30102 · SpO₂', S.spo2 != null ? `${fmt(S.spo2, 1)} %` : '—') + row('MAX30102 · HRV', S.rmssd != null ? `${fmt(S.rmssd)} ms` : '—')
      + row('MAX30102 · respiración', S.resp != null ? `${fmt(S.resp)} rpm` : '—') + row('MAX30102 · rigidez', S.si != null ? `${fmt(S.si, 1)} m/s` : '—')
      + row('Temperatura', S.temp != null ? `${fmt(S.temp, 2)} °C` : '—')
      + row('MPU6050 · temblor', S.tremor != null ? `${fmt(S.tremor, 3)} rad/s` : 'sin datos', S.mpu ? '#fff' : C.na) + row('MPU6050 · reps ARED', S.reps != null ? S.reps : '—')
      + row('Sueño', S.sleepEff != null ? `${fmt(S.sleepEff)} % eficiencia` : '—')
      + (S.held ? row('ANC', 'métricas retenidas por movimiento', C.warn) : '');
    document.querySelectorAll('#viewBODY .demo button').forEach((b) => (b.disabled = Engine.source === 'serial' || OV.on));

    // cuerpo 3D (o SVG de respaldo)
    const levels = Object.fromEntries(Object.entries(R.o).map(([k, v]) => [k, v.level]));
    const scanSys = scan ? SCAN[scan.stage].sys : null, f = scanSys || filter;
    if (use3D) {
      window.ARES_3D.update({ levels, bpm: S.bpm, resp: S.resp || 14, g: H.g, co2: H.co2, reps: S.reps ?? 0, cuffs: H.cuffs, eff: R.eff, filter: f, exploded, selected, finger: S.finger, swActive: N.swActive });
    } else {
      for (const [id, st] of Object.entries(R.o)) {
        const el = $('organ-' + id); if (!el) continue;
        el.style.setProperty('--c', C[st.level]); el.classList.toggle('crit', st.level === 'crit'); el.classList.toggle('sel', selected === id);
        el.classList.toggle('dim', f !== 'all' && ORG[id].sys !== f);
      }
      const beat = document.querySelector('#organ-heart .beat'); beat.style.animationPlayState = S.bpm ? 'running' : 'paused'; if (S.bpm) beat.style.setProperty('--hb', `${(60 / S.bpm).toFixed(3)}s`);
      $('vector-calcium').style.opacity = H.g < 0.5 && (S.reps ?? 0) < 15 ? 1 : 0;
      const fl = $('vector-fluid'); fl.style.opacity = H.g < 0.1 ? 1 : 0; fl.style.setProperty('--fs', H.co2 > 4 ? '0.6s' : '1.8s');
    }
    $('bBpm').innerHTML = S.bpm ? `<span style="color:${C[R.o.heart.level]}">♥ ${fmt(S.bpm)} lpm</span><br><span style="color:#A0A0AB">${S.override ? 'override manual' : 'latido real del MAX30102'}</span>` : '<span style="color:#63636E">♥ sin pulso</span>';
    $('bFilter').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.f === filter));

    // aptitud
    $('bScoreTitle').textContent = H.earth ? 'Índice de estabilidad clínica' : 'Aptitud EVA y de vuelo';
    const sc = $('bScore'), col = R.go ? C.ok : R.score >= 50 ? C.warn : C.crit;
    sc.textContent = R.score; sc.style.color = col;
    $('bScoreBar').style.width = `${R.score}%`; $('bScoreBar').style.background = col;
    const go = $('bGo'); go.textContent = H.earth ? (R.go ? 'ESTABLE' : 'DERIVAR') : R.go ? 'GO · EVA' : 'NO-GO · EVA'; go.style.color = R.go ? C.ok : C.crit;
    $('bScoreWhy').textContent = R.blockers.length ? `Bloqueos: ${R.blockers.join(', ')}.` : R.why.length ? R.why.join(' · ') : 'Todos los sistemas dentro de rango.';
    $('bClear').innerHTML = `<span style="color:${R.rover ? C.ok : C.crit}">● Conducción del rover: ${R.rover ? 'AUTORIZADA' : 'REVOCADA hasta aprobar el test vestibular de 15 s'}</span><br><span style="color:${R.go ? C.ok : C.crit}">● Salida EVA: ${R.go ? 'AUTORIZADA' : 'NO AUTORIZADA'}</span>`;

    $('bList').innerHTML = Object.keys(ORG).map((id) => { const st = R.o[id]; return `<button data-o="${id}" style="${selected === id ? 'border-color:#fff' : ''}"><span>${ORG[id].name}</span><span class="mono" style="color:#A0A0AB;font-size:10.5px;margin-left:auto">${st.value}</span><span class="st" style="color:${C[st.level]};border-color:${C[st.level]}">${LBL[st.level]}</span></button>`; }).join('');
    $('bList').querySelectorAll('button').forEach((b) => (b.onclick = () => select(b.dataset.o)));
    if (selected) renderInspector();
  }

  /* ---------------------------------------- alerta de refugio antitormentas */
  let shelterShown = 0;
  function shelterAlert(S, R) {
    const N = NASA.N, on = N.swActive && S.zone === 'dome', el = $('bShelter');
    el.classList.toggle('show', on);
    if (!on) return;
    el.innerHTML = `<b class="mono blink" style="font-size:13px">☢ ALERTA DE TORMENTA SOLAR · TRASLADO AL REFUGIO</b><span style="color:#F4F3EF">${N.swReasons.join(' · ')}. Estás en zona sin blindaje (RSSI &lt; −70 dBm): ${fmt(R.eff, 2)} mSv/día.</span><button class="btn" id="bShelterGo" style="margin-left:auto;border-color:var(--red);color:var(--red)">IR AL REFUGIO DE AGUA</button>`;
    $('bShelterGo').onclick = () => { if (S.zoneAuto) Engine.event('Muévete físicamente al refugio: el RSSI del brazalete confirmará la zona', 'warn'); else { H.zone = 'shelter'; Engine.event('Tripulante en el refugio de agua', 'ok'); } render(); };
    if (Date.now() - shelterShown > 60000) { shelterShown = Date.now(); Engine.event('ALERTA: tormenta solar con el tripulante en zona sin blindaje', 'warn'); }
  }

  /* ======================================================== inspector */
  function select(id) { selected = id; render(); renderInspector(); }
  function renderInspector() {
    if (!last || !selected) return;
    const { S, R } = last, st = R.o[selected], info = INFO[selected], org = ORG[selected];
    const tools = { amsler: 'Rejilla de Amsler digital', onsd: 'Guía POCUS ocular (ONSD)', pvt: 'Test vestibular de 15 s', radin2: 'Contador de burbujas Radi-N2', flank: 'Guía POCUS de flanco (riñón)' };
    const fixRow = ([txt, act], kind) => `<div class="fix"><span>${kind === 'crew' ? '👩‍🚀' : '🛰️'} ${txt}</span>${act ? `<button class="btn" data-act="${act}">${['tool', 'onsd', 'rash'].includes(act) ? 'ABRIR' : 'APLICAR'}</button>` : ''}</div>`;
    const studies = (NASA.N.osdr[info.osdr] || []).slice(0, 3);
    $('bInsp').innerHTML = `
      <div class="row" style="justify-content:space-between"><h3>${org.name.toUpperCase()}</h3><span class="olist"><span class="st" style="color:${C[st.level]};border-color:${C[st.level]}">${LBL[st.level]}</span></span></div>
      <div style="margin-top:6px">${info.cite.map((c) => `<span class="cite">${CITE[c]}</span>`).join('')}<span class="cite" style="color:#A0A0AB;border-color:#63636E">Capa L${org.layer}</span></div>
      <div class="sec"><div>QUÉ ESTÁ PASANDO</div><p>${info.plain(S)}</p></div>
      <div class="sec"><div>POR QUÉ ESTÁ EN ESTE ESTADO</div><ul>${st.reasons.map((r) => `<li>${r}</li>`).join('')}</ul></div>
      ${org.tool ? `<div class="sec"><div>AUTOEXAMEN DE CONFIRMACIÓN</div><button class="btn" data-tool="${org.tool}" style="width:100%">[ ${tools[org.tool].toUpperCase()} ]</button>${selected === 'brain' || selected === 'eyes' ? `<button class="btn" data-tool="${selected === 'brain' ? 'amsler' : 'onsd'}" style="width:100%;margin-top:6px">[ ${tools[selected === 'brain' ? 'amsler' : 'onsd'].toUpperCase()} ]</button>` : ''}</div>` : ''}
      <div class="sec"><div>ACCIÓN DEL TRIPULANTE</div>${info.crew.map((f) => fixRow(f, 'crew')).join('')}</div>
      <div class="sec"><div>ACCIÓN AUTÓNOMA DE LA NAVE (ECLSS)</div>${info.ship.map((f) => fixRow(f, 'ship')).join('')}</div>
      <div class="sec"><div>ESTUDIOS NASA OSDR RELACIONADOS (EN VIVO)</div>${studies.length ? studies.map((s) => `<a class="cite" href="${s.url}" target="_blank" rel="noopener" title="${(s.title || '').replace(/"/g, '')}">${s.acc}</a> <span class="muted">${(s.title || '').slice(0, 90)}</span><br>`).join('') : '<span class="muted">Sin datos OSDR (pulsa "Obtener datos NASA en vivo").</span>'}</div>`;
    $('bInsp').querySelectorAll('[data-tool]').forEach((b) => (b.onclick = () => openTool(b.dataset.tool)));
    $('bInsp').querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => {
      const a = b.dataset.act;
      if (a === 'tool') { openTool(org.tool); return; }
      if (a === 'onsd') { openTool('onsd'); return; }
      const msg = ACTIONS[a] ? ACTIONS[a]() : null; if (msg) Engine.event(`Cuerpo 3D · ${msg}`, 'ok'); render();
    }));
  }

  /* ======================================================== demo (simulador) */
  function startSimIfNeeded() { if (Engine.source !== 'sim' && Engine.source !== 'serial' && window.ARES_UI) { Engine.sim.g = H.g; window.ARES_UI.startSim(); } }
  let demoTimer = null;
  const tweak = (patch, secs, msg) => {
    startSimIfNeeded(); if (!Engine.simCtx) return;
    if (!tweak.base) tweak.base = { ...Engine.simCtx.base };
    Engine.simCtx = { ...Engine.simCtx, base: { ...tweak.base, ...patch } };
    clearTimeout(demoTimer); if (secs) demoTimer = setTimeout(() => { Engine.simCtx = { ...Engine.simCtx, base: { ...tweak.base } }; }, secs * 1000);
    Engine.event(`Cuerpo 3D · demo: ${msg}`, 'warn');
  };
  document.querySelectorAll('#viewBODY [data-demo]').forEach((b) => (b.onclick = () => {
    const d = b.dataset.demo;
    if (d === 'shake') tweak({ tremor: 0.5 }, 14, 'muñeca agitada (temblor 0.5 rad/s)');
    else if (d === 'reps') { startSimIfNeeded(); Engine.sim.startAred(15); Engine.event('Cuerpo 3D · demo: 15 reps ARED'); }
    else if (d === 'hypoxia') tweak({ spo2: 88, hr: 104 }, 25, 'SpO₂ 88 %');
    else if (d === 'tachy') tweak({ hr: 124 }, 25, 'taquicardia 124 lpm');
    else if (d === 'stiff') tweak({ si: 11 }, 30, 'rigidez arterial alta');
    else if (d === 'reset') { if (tweak.base && Engine.simCtx) Engine.simCtx = { ...Engine.simCtx, base: { ...tweak.base } }; clearTimeout(demoTimer); }
  }));

  /* ======================================================== bio-escaneo 3D de 4 etapas */
  const SCAN = [
    { name: 'ETAPA 1 · CABEZA · NEURO-OCULAR Y VESTIBULAR', sys: 'neuro', lock: (S) => `temblor ${fmt(S.tremor, 3)} rad/s · sueño ${S.sleepEff != null ? fmt(S.sleepEff) + ' %' : '—'} · CO₂ ${fmt(H.co2, 1)} mmHg` },
    { name: 'ETAPA 2 · TÓRAX · CARDIOVASCULAR Y PULMONAR', sys: 'cardio', lock: (S) => `FC ${fmt(S.bpm)} lpm · SpO₂ ${fmt(S.spo2, 1)} % · HRV ${fmt(S.rmssd)} ms · SI ${fmt(S.si, 1)}` },
    { name: 'ETAPA 3 · PELVIS Y FÉMURES · ESQUELÉTICO Y RENAL', sys: 'skeletal', lock: (S) => `reps ARED ${S.reps ?? 0} · hidratación ${H.hyd} mL · g ${H.g}` },
    { name: 'ETAPA 4 · CUERPO COMPLETO · CLIMA ESPACIAL Y SÍNTESIS', sys: 'all', lock: (S) => `NASA DONKI ×${fmt(NASA.N.swMult, 2)} · zona ${ZONES[S.zone].name} · ${fmt(last ? last.R.eff : 0, 2)} mSv/d · T ${fmt(S.temp, 2)} °C` },
  ];
  let scan = null;
  function startScan(dur) {
    if (scan) return;
    scan = { t0: performance.now(), dur: dur * 1000, stage: 0, locks: [] };
    if (!use3D) ['bLaser', 'bGlow'].forEach((i) => ($(i).style.display = 'block'));
    $('bHud').style.display = 'block';
    $('bScan').disabled = $('bScanFast').disabled = true;
    Engine.event(`Bio-escaneo 3D de ${dur} s iniciado`);
    requestAnimationFrame(scanFrame);
  }
  function scanFrame(t) {
    if (!scan) return;
    const p = clamp((t - scan.t0) / scan.dur, 0, 1), stage = Math.min(3, Math.floor(p * 4));
    if (stage !== scan.stage) { scan.locks[scan.stage] = SCAN[scan.stage].lock(readSensors()); scan.stage = stage; render(); }
    if (use3D) window.ARES_3D.scan(p, stage);
    else { const y = 4 + p * 92; $('bLaser').style.top = `${y}%`; $('bGlow').style.height = `${y}%`; }
    $('bHudStage').textContent = SCAN[stage].name; $('bHudT').textContent = `${((1 - p) * scan.dur / 1000).toFixed(1)} s`;
    $('bHudBar').style.width = `${p * 100}%`;
    $('bHudLock').textContent = `Fijando: ${SCAN[stage].lock(readSensors())}`;
    if (p >= 1) { scan.locks[3] = SCAN[3].lock(readSensors()); finishScan(); return; }
    requestAnimationFrame(scanFrame);
  }
  async function finishScan() {
    const locks = scan.locks; scan = null;
    if (use3D) window.ARES_3D.scan(null);
    ['bLaser', 'bGlow', 'bHud'].forEach((i) => ($(i).style.display = 'none'));
    $('bScan').disabled = $('bScanFast').disabled = false;
    render();
    const { R } = last, pk = await sendPacket('bioscan', locks);
    const bad = Object.entries(R.o).filter(([, v]) => v.level === 'crit' || v.level === 'warn');
    openModal(`
      <div class="row" style="justify-content:space-between"><div class="ptitle">Reporte del bio-escaneo 3D</div><button class="btn" data-close>CERRAR</button></div>
      <div class="row" style="gap:16px;margin-top:10px;align-items:flex-end">
        <span class="mono" style="font-size:52px;font-weight:700;color:${R.go ? C.ok : C.crit}">${R.score}</span>
        <div><div class="mono" style="font-size:18px;font-weight:700;color:${R.go ? C.ok : C.crit}">${R.go ? 'GO · EVA AUTORIZADA' : 'NO-GO · EVA NO AUTORIZADA'}</div><div class="muted">${R.blockers.length ? 'Bloqueos: ' + R.blockers.join(', ') : 'Sin bloqueos duros'} · rover ${R.rover ? 'autorizado' : 'revocado'}</div></div>
      </div>
      <div class="sec" style="margin-top:12px">${SCAN.map((s, i) => `<div class="fix"><span class="mono" style="color:var(--cyan);min-width:300px">${s.name}</span><span>${locks[i] || '—'}</span></div>`).join('')}</div>
      <div class="sec"><div class="ptitle" style="margin:8px 0 4px">Órganos fuera de rango</div>${bad.length ? bad.map(([k, v]) => `<div class="fix"><span style="color:${C[v.level]};min-width:90px" class="mono">${LBL[v.level]}</span><span><b>${ORG[k].name}</b> — ${v.reasons[0]}</span></div>`).join('') : '<div class="muted">Ninguno.</div>'}</div>
      <div class="sec"><div class="ptitle" style="margin:8px 0 4px">Paquete Earth-Sync (store-and-forward)</div>
        <div class="muted">${pk.raw} bytes JSON → <b style="color:#fff">${pk.gz ?? '—'} bytes gzip</b> · cola DSN · latencia ${LOCS[H.loc].delay} · probabilidad de apagón ${Math.round(NASA.N.blackout * 100)} % (Kp ${fmt(NASA.N.kpNow, 1)})</div>
        <pre class="mono" style="font-size:10px;max-height:160px;overflow:auto;background:rgba(0,0,0,.4);padding:8px;margin-top:6px;border-radius:4px">${JSON.stringify(pk.payload, null, 1).slice(0, 1800)}</pre>
        <button class="btn" id="bDl" style="margin-top:6px">DESCARGAR PAQUETE JSON</button></div>`);
    $('bDl').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(pk.payload, null, 2)], { type: 'application/json' })); a.download = `ARES_earthsync_${Date.now()}.json`; a.click(); };
    Engine.event(`Bio-escaneo 3D: ${R.score}/100 · ${R.go ? 'GO' : 'NO-GO'} · paquete Earth-Sync en cola`, R.go ? 'ok' : 'warn');
  }
  async function sendPacket(kind, locks) {
    const { S, R } = last;
    const payload = { kind, ts: new Date().toISOString(), sol: H.sol, mode: H.earth ? 'earth-telemedicine' : 'deep-space', habitat: { ...H }, sensorSource: S.override ? 'manual-override' : Engine.source,
      vitals: { hr: S.bpm, spo2: S.spo2, hrv: S.rmssd, resp: S.resp, stiffness: S.si, temp: S.temp, tremor: S.tremor, reps: S.reps, sleep_eff: S.sleepEff, rssi: S.rssi },
      organs: Object.fromEntries(Object.entries(R.o).map(([k, v]) => [k, { level: v.level, value: v.value }])), exams: EX, nasa: NASA.summary(),
      readiness: R.score, go: R.go, roverClearance: R.rover, blockers: R.blockers, locks };
    return DSN.enqueue(kind, payload, R.go ? 'normal' : 'high');
  }
  $('bScan').onclick = () => startScan(30);
  $('bScanFast').onclick = () => startScan(8);

  /* ======================================================== modal genérico */
  let modalCleanup = null;
  function openModal(html, cleanup) {
    closeModal();
    $('bModalBox').innerHTML = html; $('bModal').classList.add('show');
    $('bModalBox').querySelectorAll('[data-close]').forEach((b) => (b.onclick = closeModal));
    modalCleanup = cleanup || null;
  }
  function closeModal() { if (modalCleanup) { try { modalCleanup(); } catch (e) { /* noop */ } modalCleanup = null; } $('bModal').classList.remove('show'); }
  $('bModal').addEventListener('click', (e) => { if (e.target === $('bModal')) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('bModal').classList.contains('show')) closeModal(); });
  const header = (t, sub) => `<div class="row" style="justify-content:space-between"><div><div class="ptitle">${t}</div><div class="muted" style="margin-top:3px">${sub}</div></div><button class="btn" data-close>CERRAR</button></div>`;
  async function getCamera() {
    try { if (!navigator.mediaDevices?.getUserMedia) return null; return await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: { ideal: "environment" } }, audio: false }); } catch (e) { return null; }
  }
  const stopStream = (st) => st && st.getTracks().forEach((t) => t.stop());

  function openTool(t) { ({ amsler: toolAmsler, onsd: toolOnsd, pvt: toolPvt, radin2: toolRadin2, flank: toolFlank, rash: toolRash })[t](); }

  /* ---------------------------------------------- 1. Rejilla de Amsler */
  function toolAmsler() {
    openModal(`${header('Rejilla de Amsler digital', 'Tapa un ojo. Mira fijo el punto negro a 35 cm de la pantalla. Haz clic en las zonas donde las líneas se vean torcidas, borrosas o falten.')}
      <div class="row" style="gap:18px;margin-top:12px;align-items:flex-start">
        <div class="amsler" id="amG">${"<div></div>".repeat(225)}<span class="dot"></span></div>
        <div style="flex:1;min-width:220px">
          <div class="mono" style="font-size:12px">Ojo evaluado</div><div class="seg3" id="amEye"><button data-v="izq" class="on">IZQUIERDO</button><button data-v="der">DERECHO</button></div>
          <div class="mono" style="font-size:12px;margin-top:6px">Zonas marcadas: <b id="amN" style="font-size:18px">0</b></div>
          <p class="muted" style="margin-top:8px">Rejilla 15×15. 0 zonas = normal · 1–4 = vigilar (precaución) · 5 o más = probable metamorfopsia o escotoma (crítico). Un resultado anormal se envía al cirujano de vuelo.</p>
          <div class="row" style="gap:6px;margin-top:10px"><button class="btn" id="amClear">BORRAR</button><button class="btn" id="amSave">GUARDAR RESULTADO</button></div>
        </div></div>`);
    let eye = 'izq';
    $('amEye').querySelectorAll('button').forEach((b) => (b.onclick = () => { eye = b.dataset.v; $('amEye').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); }));
    const cells = [...$('amG').querySelectorAll('div')], count = () => ($('amN').textContent = cells.filter((c) => c.classList.contains('w')).length);
    let painting = false, mode = true;
    // Eventos pointer: el mismo código sirve para ratón, dedo y lápiz (arrastrar pinta varias celdas)
    const grid = $('amG'); grid.style.touchAction = 'none';
    let lastCell = null;
    grid.addEventListener('pointerdown', (e) => {
      const t = document.elementFromPoint(e.clientX, e.clientY) || e.target; const c = t.closest ? t.closest('#amG > div') : null; if (!c) return;
      e.preventDefault(); painting = true; mode = !c.classList.contains('w'); c.classList.toggle('w', mode); lastCell = c; count();
    });
    grid.addEventListener('pointermove', (e) => {
      if (!painting) return;
      const c = document.elementFromPoint(e.clientX, e.clientY); const cell = c && c.closest ? c.closest('#amG > div') : null;
      if (cell && cell !== lastCell) { cell.classList.toggle('w', mode); lastCell = cell; count(); }
    });
    const up = () => { painting = false; lastCell = null; }; document.addEventListener('pointerup', up); document.addEventListener('pointercancel', up);
    $('amClear').onclick = () => { cells.forEach((c) => c.classList.remove('w')); count(); };
    $('amSave').onclick = () => { const n = +$('amN').textContent; EX.amsler = { cells: n, eye, at: Date.now() }; Engine.event(`Amsler (${eye}): ${n} zona(s) distorsionada(s)`, n ? 'warn' : 'ok'); closeModal(); select('eyes'); };
    modalCleanup = () => { document.removeEventListener("pointerup", up); document.removeEventListener("pointercancel", up); };
  }

  /* ---------------------------------------------- 2. Guía de ultrasonido ocular (ONSD) */
  async function toolOnsd() {
    openModal(`${header('Guía AR de ultrasonido ocular · ONSD', 'Coloca la sonda sobre el párpado cerrado. Alinea el globo ocular con el círculo y el nervio óptico con la línea vertical. Arrastra los dos calibres a los bordes de la vaina, 3 mm detrás del globo.')}
      <div class="row" style="gap:14px;margin-top:12px;align-items:flex-start">
        <div style="position:relative;width:min(560px,100%);aspect-ratio:4/3;background:#000;border-radius:4px;overflow:hidden">
          <video id="usV" autoplay playsinline muted style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:none"></video>
          <canvas id="usC" style="position:absolute;inset:0;width:100%;height:100%;cursor:ew-resize"></canvas>
        </div>
        <div style="flex:1;min-width:220px">
          <div class="mono" id="usSrc" style="font-size:11px;color:#A0A0AB">Iniciando cámara…</div>
          <div class="mono" style="font-size:12px;margin-top:10px">ONSD medido</div><div class="mono" id="usMm" style="font-size:40px;font-weight:700">—</div>
          <label class="mono" style="font-size:11px;display:block;margin-top:8px">Escala de la sonda: <b id="usScV"></b> px/mm<input type="range" class="sl" id="usSc" min="6" max="24" step="0.5" value="12" style="width:100%"></label>
          <p class="muted" style="margin-top:8px">&gt; 5.8 mm sugiere presión intracraneal elevada (SANS). Sin cámara se usa una imagen de ultrasonido simulada coherente con el CO₂ y la gravedad actuales.</p>
          <button class="btn" id="usSave" style="margin-top:10px;width:100%">GUARDAR MEDICIÓN</button>
        </div></div>`);
    const cv = $('usC'), video = $('usV'), stream = await getCamera();
    if (stream) { video.srcObject = stream; video.style.display = 'block'; $('usSrc').textContent = 'Cámara activa: superposición AR sobre la imagen en vivo'; }
    else $('usSrc').textContent = 'Cámara no disponible: imagen de ultrasonido simulada';
    const trueMm = 4.9 + (H.g < 0.1 ? 0.5 : 0) + clamp((H.co2 - 3) * 0.35, 0, 1.1) + (Math.random() - 0.5) * 0.2;
    let scale = 12, cal = [null, null], drag = -1, raf, moved = false;
    $('usScV').textContent = scale; $('usSc').oninput = (e) => { scale = +e.target.value; $('usScV').textContent = scale; };
    const pos = (e) => { const r = cv.getBoundingClientRect(); return ((e.clientX - r.left) / r.width) * cv.width; };
    cv.style.touchAction = "none";                                   // calibres arrastrables con ratón o dedo
    cv.onpointerdown = (e) => { const x = pos(e); drag = Math.abs(x - cal[0]) < Math.abs(x - cal[1]) ? 0 : 1; cal[drag] = x; moved = true; try { cv.setPointerCapture(e.pointerId); } catch (er) { /* noop */ } };
    cv.onpointermove = (e) => { if (drag >= 0) cal[drag] = pos(e); };
    cv.onpointerup = cv.onpointercancel = () => (drag = -1);
    window.addEventListener("pointerup", () => (drag = -1));
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const w = (cv.width = cv.clientWidth), h = (cv.height = cv.clientHeight), ctx = cv.getContext('2d');
      const cx = w / 2, gy = h * 0.3, gr = h * 0.2, nerveY = gy + gr + 3 * scale;
      if (cal[0] == null) cal = [cx - 95, cx + 95]; // calibres abiertos: el tripulante los ajusta
      if (!stream) { // ultrasonido simulado en modo B
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
        ctx.save(); ctx.beginPath(); ctx.moveTo(cx, -h * 0.1); ctx.arc(cx, -h * 0.1, h * 1.05, Math.PI * 0.32, Math.PI * 0.68); ctx.closePath(); ctx.clip();
        const img = ctx.createImageData(w, h);
        for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
          const dg = Math.hypot(x - cx, y - gy), inGlobe = dg < gr, inNerve = y > gy + gr * 0.85 && Math.abs(x - cx) < (trueMm * scale) / 2 && y < h * 0.95;
          const sheath = !inNerve && y > gy + gr * 0.85 && Math.abs(Math.abs(x - cx) - (trueMm * scale) / 2) < 4;
          let v = 70 + Math.random() * 90; if (inGlobe) v = Math.random() * 18; if (Math.abs(dg - gr) < 3) v = 210; if (inNerve) v = 20 + Math.random() * 25; if (sheath) v = 190 + Math.random() * 50;
          for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const i = ((y + dy) * w + x + dx) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
        }
        ctx.putImageData(img, 0, 0); ctx.restore();
      } else ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = '#38BDF8'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 5]);
      ctx.beginPath(); ctx.arc(cx, gy, gr, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, gy + gr); ctx.lineTo(cx, h); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = '#F59E0B'; ctx.beginPath(); ctx.moveTo(cx - 70, nerveY); ctx.lineTo(cx + 70, nerveY); ctx.stroke();
      ctx.fillStyle = '#F59E0B'; ctx.font = '11px ui-monospace, Menlo, monospace'; ctx.fillText("3 mm tras el globo", cx + 100, nerveY - 6);
      ctx.strokeStyle = '#10B981'; ctx.lineWidth = 2;
      for (const x of cal) { ctx.beginPath(); ctx.moveTo(x, nerveY - 30); ctx.lineTo(x, nerveY + 30); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(cal[0], nerveY + 24); ctx.lineTo(cal[1], nerveY + 24); ctx.stroke();
      const mm = Math.abs(cal[1] - cal[0]) / scale; const el = $('usMm');
      if (el) { el.textContent = moved ? `${mm.toFixed(2)} mm` : "arrastra"; el.style.color = !moved ? C.na : mm > 5.8 ? C.crit : C.ok; }
      const sb = $("usSave"); if (sb) sb.disabled = !moved;
      ctx.fillStyle = '#10B981'; ctx.fillText(`${mm.toFixed(2)} mm`, (cal[0] + cal[1]) / 2 - 22, nerveY + 40);
    };
    draw();
    $('usSave').onclick = () => { const mm = Math.abs(cal[1] - cal[0]) / scale; EX.onsd = { mm, at: Date.now(), simulated: !stream }; Engine.event(`ONSD ${mm.toFixed(2)} mm ${mm > 5.8 ? '> 5.8 mm (SANS positivo)' : '(normal)'}`, mm > 5.8 ? 'warn' : 'ok'); closeModal(); select('eyes'); };
    modalCleanup = () => { cancelAnimationFrame(raf); stopStream(stream); };
  }

  /* ---------------------------------------------- 3. Test vestibular + vigilancia (15 s) */
  function toolPvt() {
    openModal(`${header('Test vestibular y de vigilancia · 15 s', 'Mantén el cursor dentro del círculo que se mueve. Cuando el círculo se ponga ROJO, haz clic lo más rápido posible.')}
      <div style="position:relative;margin-top:12px"><canvas id="pvC" style="width:100%;height:380px;background:rgba(0,0,0,.45);border-radius:4px;cursor:crosshair"></canvas>
        <button class="btn" id="pvGo" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);padding:12px 18px">[ INICIAR 15 s ]</button></div>
      <div class="row mono" style="gap:18px;margin-top:10px;font-size:12px" id="pvStats">—</div>`);
    const cv = $('pvC'); let raf, run = null, mouse = { x: -99, y: -99 };
    cv.style.touchAction = "none";                                   // en móvil el dedo sigue el blanco
    cv.onpointermove = cv.onpointerdown = (e) => { const r = cv.getBoundingClientRect(); mouse = { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const draw = (t) => {
      raf = requestAnimationFrame(draw);
      const w = (cv.width = cv.clientWidth), h = (cv.height = cv.clientHeight), ctx = cv.getContext('2d');
      if (!run) return;
      const el = (t - run.t0) / 1000;
      const x = w / 2 + Math.sin(el * 0.9) * w * 0.32 + Math.sin(el * 2.3) * w * 0.06, y = h / 2 + Math.sin(el * 1.3 + 1) * h * 0.3;
      const r = 34, inside = Math.hypot(mouse.x - x, mouse.y - y) < r;
      run.frames++; if (inside) run.on++;
      if (!run.flash && el > run.next) { run.flash = t; }
      if (run.flash && t - run.flash > 1200) { run.lapses++; run.flash = 0; run.next = el + 1.5 + Math.random() * 2; }
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = run.flash ? 'rgba(255,42,85,.85)' : 'rgba(56,189,248,.25)'; ctx.fill();
      ctx.strokeStyle = inside ? '#10B981' : '#38BDF8'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#F4F3EF'; ctx.font = '12px ui-monospace, Menlo, monospace'; ctx.fillText(`${Math.max(0, 15 - el).toFixed(1)} s`, 10, 18);
      const m = Engine.snap.mpu; if (m) run.trem.push(m.tremor);
      $('pvStats').innerHTML = `en el blanco ${(100 * run.on / run.frames).toFixed(0)} % · reacciones ${run.rts.length} · lapsos ${run.lapses}`;
      if (el >= 15) finish();
    };
    cv.onclick = () => { if (run && run.flash) { run.rts.push(performance.now() - run.flash); run.flash = 0; run.next = (performance.now() - run.t0) / 1000 + 1.5 + Math.random() * 2; } };
    $('pvGo').onclick = () => { $('pvGo').style.display = 'none'; run = { t0: performance.now(), frames: 0, on: 0, rts: [], lapses: 0, flash: 0, next: 1.5, trem: [] }; };
    const finish = () => {
      const onPct = (100 * run.on) / run.frames, rt = run.rts.length ? run.rts.reduce((a, b) => a + b, 0) / run.rts.length : null, lapses = run.lapses + run.rts.filter((x) => x > 500).length;
      const trem = run.trem.length ? run.trem.reduce((a, b) => a + b, 0) / run.trem.length : null;
      const level = onPct < 40 || (rt && rt > 550) || lapses >= 3 ? 'crit' : onPct < 60 || (rt && rt > 400) || lapses >= 1 ? 'warn' : 'ok';
      const grade = level === 'ok' ? 'NORMAL' : level === 'warn' ? 'RENDIMIENTO REDUCIDO' : 'DESORIENTACIÓN / FATIGA';
      EX.pvt = { onPct, rt, lapses, trem, level, grade, at: Date.now() };
      run = null; cancelAnimationFrame(raf);
      $('pvStats').innerHTML = `<b style="color:${C[level]}">${grade}</b> · en el blanco ${onPct.toFixed(0)} % · reacción media ${rt ? rt.toFixed(0) + ' ms' : '—'} · lapsos ${lapses}${trem != null ? ` · temblor MPU ${trem.toFixed(3)} rad/s` : ''}`;
      Engine.event(`Test vestibular: ${grade} (${onPct.toFixed(0)} % en el blanco, ${rt ? rt.toFixed(0) : '—'} ms)`, level === 'ok' ? 'ok' : 'warn');
      render();
    };
    requestAnimationFrame(draw);
    modalCleanup = () => cancelAnimationFrame(raf);
  }

  /* ---------------------------------------------- 4. Contador de burbujas Radi-N2 */
  async function toolRadin2() {
    openModal(`${header('Escáner de burbujas Radi-N2 (CSA)', 'Cada neutrón que golpea el gel del detector deja una burbuja visible. Contar burbujas = medir la dosis de neutrones. El conteo usa detección de manchas brillantes (umbral + componentes conectados) sobre la imagen.')}
      <div class="row" style="gap:14px;margin-top:12px;align-items:flex-start">
        <canvas id="rnC" width="320" height="400" style="width:320px;height:400px;background:#000;border-radius:4px"></canvas>
        <div style="flex:1;min-width:240px">
          <div class="seg3" id="rnSrc"><button data-v="sim" class="on">TUBO SIMULADO</button><button data-v="cam">CÁMARA</button></div>
          <div class="mono" id="rnMsg" style="font-size:11px;color:#A0A0AB"></div>
          <button class="btn" id="rnExpose" style="width:100%;margin-top:8px">EXPONER DETECTOR 24 h (dosis actual del hábitat)</button>
          <label class="mono" style="font-size:11px;display:block;margin-top:10px">Umbral de brillo: <b id="rnThV">200</b><input type="range" class="sl" id="rnTh" min="120" max="250" value="200" style="width:100%"></label>
          <label class="mono" style="font-size:11px;display:block;margin-top:6px">Sensibilidad del detector: <b id="rnSeV">0.15</b> burbujas/µSv<input type="range" class="sl" id="rnSe" min="0.05" max="1" step="0.05" value="0.15" style="width:100%"></label>
          <div class="mono" style="margin-top:12px;font-size:12px">Burbujas detectadas</div><div class="mono" id="rnN" style="font-size:40px;font-weight:700">0</div>
          <div class="mono" id="rnDose" style="font-size:13px">—</div>
          <button class="btn" id="rnSave" style="width:100%;margin-top:10px">GUARDAR LECTURA</button>
        </div></div>`);
    const cv = $('rnC'), ctx = cv.getContext('2d', { willReadFrequently: true });
    let src = 'sim', stream = null, video = null, bubbles = [], raf, last = { n: 0, comps: [] };
    const th = () => +$('rnTh').value, sens = () => +$('rnSe').value;
    $('rnTh').oninput = (e) => ($('rnThV').textContent = e.target.value);
    $('rnSe').oninput = (e) => ($('rnSeV').textContent = e.target.value);
    const eff = () => H.neutron * ZONES[readSensors().zone].mult; // mSv/día totales
    $('rnExpose').onclick = () => {
      const uSvNeutron = eff() * 1000 * 0.3, n = Math.round(uSvNeutron * sens() * (0.85 + Math.random() * 0.3));
      // burbujas sin solaparse (como en el gel real); si no caben, el detector está saturado
      bubbles = []; let lost = 0;
      for (let i = 0; i < n; i++) {
        let ok = false;
        for (let tries = 0; tries < 40 && !ok; tries++) {
          const b = { x: 72 + Math.random() * 176, y: 42 + Math.random() * 316, r: 2 + Math.random() * 3 };
          if (bubbles.every((o) => Math.hypot(o.x - b.x, o.y - b.y) > o.r + b.r + 3)) { bubbles.push(b); ok = true; }
        }
        if (!ok) lost++;
      }
      $("rnMsg").innerHTML = `Exposición simulada: ${eff().toFixed(2)} mSv/día × 30 % neutrones = ${uSvNeutron.toFixed(0)} µSv` + (lost ? `<br><span style="color:#F59E0B">Detector SATURADO: ${lost} burbujas no caben. Cambia el detector y repite (la dosis real es mayor).</span>` : "");
    };
    const detect = () => { // umbral + componentes conectados (4-vecindad) sobre la imagen del canvas
      const W = cv.width, Hh = cv.height, d = ctx.getImageData(0, 0, W, Hh).data, T = th(), seen = new Uint8Array(W * Hh), comps = [];
      for (let p = 0; p < W * Hh; p++) {
        if (seen[p]) continue; const i = p * 4; if ((d[i] + d[i + 1] + d[i + 2]) / 3 < T) continue;
        const st = [p]; seen[p] = 1; let n = 0, sx = 0, sy = 0;
        while (st.length) { const q = st.pop(), x = q % W, y = (q / W) | 0; n++; sx += x; sy += y;
          for (const nq of [q - 1, q + 1, q - W, q + W]) { if (nq < 0 || nq >= W * Hh || seen[nq]) continue; if (Math.abs((nq % W) - x) > 1) continue; const j = nq * 4; if ((d[j] + d[j + 1] + d[j + 2]) / 3 >= T) { seen[nq] = 1; st.push(nq); } } }
        if (n >= 3 && n <= 160) comps.push({ x: sx / n, y: sy / n, n });
      }
      return comps;
    };
    let tick = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (src === 'cam' && video && video.readyState >= 2) ctx.drawImage(video, 0, 0, cv.width, cv.height);
      else {
        ctx.fillStyle = '#04070c'; ctx.fillRect(0, 0, cv.width, cv.height);
        const g = ctx.createLinearGradient(60, 0, 260, 0); g.addColorStop(0, '#1a2a33'); g.addColorStop(0.5, '#2c4652'); g.addColorStop(1, '#1a2a33');
        ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(60, 30, 200, 345, 18); ctx.fill();
        for (const b of bubbles) { ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 7); ctx.fillStyle = '#f2fbff'; ctx.fill(); }
        ctx.fillStyle = "#3d6a7d"; ctx.font = "10px ui-monospace, Menlo, monospace"; ctx.fillText("Radi-N2 · gel polimérico", 92, 392); // tono bajo el umbral: no se cuenta como burbuja
      }
      if (++tick % 15 === 0) last.comps = detect();
      ctx.strokeStyle = '#EF4444'; ctx.lineWidth = 1.2; for (const c of last.comps) { ctx.beginPath(); ctx.arc(c.x, c.y, 7, 0, 7); ctx.stroke(); }
      const n = last.comps.length, uSv = n / sens();
      $('rnN').textContent = n; $('rnDose').innerHTML = `≈ <b>${uSv.toFixed(0)} µSv</b> de neutrones${src === 'sim' ? ' en 24 h' : ''}`;
      $('rnDose').style.color = uSv > 800 ? C.crit : uSv > 300 ? C.warn : C.ok;
    };
    $('rnSrc').querySelectorAll('button').forEach((b) => (b.onclick = async () => {
      src = b.dataset.v; $('rnSrc').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      if (src === 'cam' && !stream) {
        stream = await getCamera();
        if (!stream) { src = 'sim'; $('rnSrc').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.v === 'sim')); $('rnMsg').textContent = 'Cámara no disponible: se usa el tubo simulado.'; return; }
        video = document.createElement('video'); video.srcObject = stream; video.muted = true; video.playsInline = true; await video.play().catch(() => {});
        $('rnMsg').textContent = 'Cámara activa: apunta al tubo del detector con fondo oscuro.';
      }
    }));
    $('rnExpose').click(); draw();
    $('rnSave').onclick = () => { const n = last.comps.length; EX.radin2 = { bubbles: n, uSv: n / sens(), at: Date.now(), source: src }; Engine.event(`Radi-N2: ${n} burbujas ≈ ${(n / sens()).toFixed(0)} µSv`, n / sens() > 300 ? 'warn' : 'ok'); closeModal(); select('marrow'); };
    modalCleanup = () => { cancelAnimationFrame(raf); stopStream(stream); };
  }

  /* ---------------------------------------------- 5. Guía POCUS de flanco (riñón) */
  async function toolFlank() {
    openModal(`${header('Guía AR de ultrasonido de flanco · riñón', 'Para no médicos: sigue la retícula para colocar la sonda en el costado y busca dilatación de la pelvis renal (hidronefrosis), signo de un cálculo que obstruye.')}
      <div class="row" style="gap:14px;margin-top:12px;align-items:flex-start">
        <div style="position:relative;width:min(560px,100%);aspect-ratio:4/3;background:#000;border-radius:4px;overflow:hidden">
          <video id="fkV" autoplay playsinline muted style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:none"></video>
          <canvas id="fkC" style="position:absolute;inset:0;width:100%;height:100%"></canvas>
        </div>
        <div style="flex:1;min-width:230px">
          <div class="mono" id="fkSrc" style="font-size:11px;color:#A0A0AB">Iniciando cámara…</div>
          <ol class="muted" style="padding-left:16px;margin-top:8px;line-height:1.7">
            <li>Túmbate de lado. Sonda en la línea axilar media, entre las costillas 10 y 12.</li>
            <li>Marcador de la sonda hacia la cabeza. Alinea el riñón con la elipse.</li>
            <li>Barre de delante hacia atrás despacio.</li>
            <li>Marca qué ves en el centro del riñón:</li>
          </ol>
          <div class="seg3" id="fkGrade"><button data-v="0">SIN DILATACIÓN</button><button data-v="1">LEVE</button><button data-v="2">MODERADA/GRAVE</button></div>
          <button class="btn" id="fkSave" style="width:100%">GUARDAR HALLAZGO</button>
        </div></div>`);
    const cv = $('fkC'), video = $('fkV'), stream = await getCamera();
    if (stream) { video.srcObject = stream; video.style.display = 'block'; $('fkSrc').textContent = 'Cámara activa: retícula AR sobre la imagen en vivo'; } else $('fkSrc').textContent = 'Cámara no disponible: imagen simulada';
    const reps = last ? last.S.reps ?? 0 : 0, dil = H.g < 0.5 && reps < 15 && H.hyd < 2000 ? 2 : H.g < 0.5 && reps < 15 ? 1 : 0;
    let grade = null, raf;
    $('fkGrade').querySelectorAll('button').forEach((b) => (b.onclick = () => { grade = +b.dataset.v; $('fkGrade').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); }));
    const draw = (t) => {
      raf = requestAnimationFrame(draw);
      const w = (cv.width = cv.clientWidth), h = (cv.height = cv.clientHeight), ctx = cv.getContext('2d'), cx = w / 2, cy = h / 2;
      if (!stream) {
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < 2200; i++) { const x = Math.random() * w, y = Math.random() * h, v = 40 + Math.random() * 90; ctx.fillStyle = `rgb(${v},${v},${v})`; ctx.fillRect(x, y, 2, 2); }
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(-0.25);
        ctx.fillStyle = 'rgba(70,70,70,.9)'; ctx.beginPath(); ctx.ellipse(0, 0, 150, 70, 0, 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(200,200,200,.75)'; ctx.beginPath(); ctx.ellipse(0, 0, 70, 22, 0, 0, 7); ctx.fill();
        if (dil) { ctx.fillStyle = '#050505'; ctx.beginPath(); ctx.ellipse(0, 0, 18 + 14 * dil, 8 + 6 * dil, 0, 0, 7); ctx.fill(); for (const a of [-1, 1]) { ctx.beginPath(); ctx.ellipse(a * 40, a * 4, 6 + 5 * dil, 4 + 3 * dil, 0, 0, 7); ctx.fill(); } }
        ctx.restore();
      } else ctx.clearRect(0, 0, w, h);
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(-0.25);
      ctx.strokeStyle = '#38BDF8'; ctx.setLineDash([7, 6]); ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(0, 0, 160, 78, 0, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      ctx.restore();
      ctx.strokeStyle = 'rgba(56,189,248,.6)'; ctx.beginPath(); ctx.moveTo(cx - 20, cy); ctx.lineTo(cx + 20, cy); ctx.moveTo(cx, cy - 20); ctx.lineTo(cx, cy + 20); ctx.stroke();
      const sweep = (Math.sin(t / 700) * 0.5 + 0.5) * w; ctx.strokeStyle = 'rgba(255,184,0,.6)'; ctx.beginPath(); ctx.moveTo(sweep, h - 30); ctx.lineTo(sweep, h - 10); ctx.stroke();
      ctx.fillStyle = '#F59E0B'; ctx.font = '11px ui-monospace, Menlo, monospace'; ctx.fillText('← barrido →', Math.min(w - 80, sweep + 6), h - 14);
      ctx.fillStyle = '#38BDF8'; ctx.fillText('RIÑÓN (corte longitudinal)', 10, 18);
    };
    requestAnimationFrame(draw);
    $('fkSave').onclick = () => {
      if (grade == null) return;
      EX.flank = { grade, at: Date.now() };
      if (grade > 0) { H.hyd = Math.min(H.hyd, 1900); }
      Engine.event(`POCUS de flanco: ${['sin dilatación', 'hidronefrosis leve', 'hidronefrosis moderada/grave'][grade]}`, grade ? 'warn' : 'ok'); closeModal(); select('kidneys');
    };
    modalCleanup = () => { cancelAnimationFrame(raf); stopStream(stream); };
  }

  /* ---------------------------------------------- 6. Escáner de erupción cutánea (reactivación viral) */
  async function toolRash() {
    openModal(`${header('Escáner dérmico · erupción por reactivación viral', 'Apunta la cámara a la zona de piel (p. ej. el tórax, donde suele aparecer el herpes zóster). Se mide el porcentaje de píxeles enrojecidos respecto al tono de piel de la imagen.')}
      <div class="row" style="gap:14px;margin-top:12px;align-items:flex-start">
        <canvas id="rsC" width="360" height="270" style="width:360px;height:270px;background:#000;border-radius:4px"></canvas>
        <div style="flex:1;min-width:230px">
          <div class="mono" id="rsSrc" style="font-size:11px;color:#A0A0AB">Iniciando cámara…</div>
          <label class="mono" style="font-size:11px;display:block;margin-top:10px">Sensibilidad al rojo: <b id="rsThV">45</b><input type="range" class="sl" id="rsTh" min="20" max="90" value="45" style="width:100%"></label>
          <div class="mono" style="margin-top:12px;font-size:12px">Piel enrojecida</div><div class="mono" id="rsPct" style="font-size:40px;font-weight:700">—</div>
          <div class="mono" id="rsGrade" style="font-size:13px">—</div>
          <button class="btn" id="rsSave" style="width:100%;margin-top:10px">GUARDAR LECTURA</button>
        </div></div>`);
    const cv = $('rsC'), ctx = cv.getContext('2d', { willReadFrequently: true }), stream = await getCamera();
    let video = null, raf, pct = 0, tick = 0;
    if (stream) { video = document.createElement('video'); video.srcObject = stream; video.muted = true; video.playsInline = true; await video.play().catch(() => {}); $('rsSrc').textContent = 'Cámara activa'; }
    else $('rsSrc').textContent = 'Cámara no disponible: piel simulada (coherente con el estado de estrés y radiación)';
    const risk = last && last.R.o.marrow.level === 'crit' ? 3 : last && last.R.o.marrow.level === 'warn' ? 1 : 0;
    const spots = Array.from({ length: risk * 6 }, () => ({ x: 110 + Math.random() * 170, y: 50 + Math.random() * 150, r: 9 + Math.random() * 10 })); // dermatoma: banda de vesículas
    $('rsTh').oninput = (e) => ($('rsThV').textContent = e.target.value);
    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (video && video.readyState >= 2) ctx.drawImage(video, 0, 0, cv.width, cv.height);
      else {
        ctx.fillStyle = '#d6a283'; ctx.fillRect(0, 0, cv.width, cv.height);
        for (const s of spots) { const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r); g.addColorStop(0, '#c4363a'); g.addColorStop(0.6, 'rgba(196,54,58,.85)'); g.addColorStop(1, 'rgba(196,54,58,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 7); ctx.fill(); }
      }
      if (++tick % 10) return;
      // índice de eritema: R − (G+B)/2 frente a la mediana de la imagen (tono de piel propio)
      const d = ctx.getImageData(0, 0, cv.width, cv.height).data, th = +$('rsTh').value, vals = [];
      for (let i = 0; i < d.length; i += 16) vals.push(d[i] - (d[i + 1] + d[i + 2]) / 2);
      const sorted = vals.slice().sort((a, b) => a - b), med = sorted[sorted.length >> 1];
      pct = (100 * vals.filter((v) => v - med > th).length) / vals.length;
      $('rsPct').textContent = `${pct.toFixed(1)} %`;
      const g = pct > 8 ? ['ERUPCIÓN EXTENSA', C.crit] : pct > 2 ? ['ERUPCIÓN LOCALIZADA', C.warn] : ['SIN ERUPCIÓN', C.ok];
      $('rsGrade').textContent = g[0]; $('rsGrade').style.color = g[1]; $('rsPct').style.color = g[1];
    };
    draw();
    $('rsSave').onclick = () => { EX.rash = { pct, at: Date.now() }; Engine.event(`Escáner dérmico: ${pct.toFixed(1)} % de piel enrojecida`, pct > 2 ? 'warn' : 'ok'); closeModal(); select('marrow'); };
    modalCleanup = () => { cancelAnimationFrame(raf); stopStream(stream); };
  }

  /* ======================================================== API pública */
  /** Punto de entrada único: datos del brazalete (o null), hábitat y NASA → órganos 3D + triaje. */
  function update3DAnatomyAndTriage(sensorData, habitatData, nasaApiData) {
    if (sensorData) {
      const map = { hr: 'hr', spo2: 'spo2', hrv: 'hrv', resp: 'resp', stiffness: 'stiffness', tremor: 'tremor', reps: 'reps', sleep_eff: 'sleep_eff', temp: 'temp', rssi: 'rssi' };
      for (const [k, v] of Object.entries(sensorData)) if (map[k] && Number.isFinite(+v)) OV[map[k]] = +v;
      OV.on = true; $('ovOn').checked = true;
    }
    if (habitatData) {
      const map = { gravity: 'g', co2_mmHg: 'co2', pressure_psi: 'psi', noise_dB: 'noise', neutron_mSv: 'neutron', hydration_ml: 'hyd', glucose_mgdl: 'glucose', sol: 'sol', zone: 'zone' };
      for (const [k, v] of Object.entries(habitatData)) { const key = map[k] || k; if (key === 'g') setG(+v); else if (key in H) H[key] = v; }
    }
    if (nasaApiData) { Object.assign(NASA.N, nasaApiData); NASA.model(); renderNasa(); }
    render();
    return last;
  }

  /* ======================================================== arranque */
  document.querySelectorAll('#tabs button[data-tab]').forEach((b) => b.addEventListener('click', () => setTimeout(render, 0)));
  Engine.subscribe(render);
  render(); renderNasa();
  NASA.fetchAll(false);                              // consulta automática al cargar (reutiliza caché < 15 min)
  setInterval(() => NASA.fetchAll(true), 30 * 60000);    // y cada 30 min
  window.update3DAnatomyAndTriage = update3DAnatomyAndTriage;
  const act = (k) => { const m = ACTIONS[k] ? ACTIONS[k]() : null; if (m) Engine.event(`Cuerpo 3D · ${m}`, "ok"); render(); return m; };
  window.ARES_BODY = { H, EX, OV, LOCS, ZONES, SOLS, act, sendPacket: (k) => sendPacket(k), evaluate: () => last, startScan, openTool, select, update: update3DAnatomyAndTriage };
})();
