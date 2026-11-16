/* =============================================================================
 * BIO-ASTRO · Interfaz del subsistema inercial MPU6050 (pestaña de max30102.html)
 * Sin dependencias. Lee Engine.snap.mpu a 2 Hz y los buffers a 60 fps (canvas).
 * ========================================================================== */
(() => {
  'use strict';
  const { Engine, SleepStager, clamp } = window.ARES;
  const inr = Engine.inertial;
  const COL = { cyan: '#38BDF8', amber: '#F59E0B', red: '#EF4444', green: '#10B981', dim: '#63636E', violet: '#D4FF33' };
  const $ = (id) => document.getElementById(id);
  const fmt = (v, d = 0) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d));
  const lvl = { ok: COL.cyan, good: COL.green, warn: COL.amber, crit: COL.red, na: COL.dim };

  /* ------------------------------------------------------------------ estilos */
  const css = document.createElement('style');
  css.textContent = `
    .mrow { display:grid; gap:12px; }
    .m2 { grid-template-columns:minmax(0,1fr) 340px; } .m3 { grid-template-columns:repeat(3,minmax(0,1fr)); } .m2e { grid-template-columns:repeat(2,minmax(0,1fr)); }
    @media (max-width:1100px) { .m2,.m3,.m2e { grid-template-columns:1fr; } }
    .g6 { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:8px; } .g4 { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px; }
    @media (max-width:1100px) { .g6 { grid-template-columns:repeat(3,minmax(0,1fr)); } .g4 { grid-template-columns:repeat(2,minmax(0,1fr)); } }
    .cv { background:rgba(0,0,0,.4); border:1px solid rgba(255,255,255,.05); border-radius:4px; }
    .bigval { font-family:ui-monospace,Menlo,monospace; font-size:54px; font-weight:700; line-height:1; }
    .phase { font-family:ui-monospace,Menlo,monospace; font-size:13px; font-weight:700; padding:6px 10px; border:1px solid; border-radius:4px; display:inline-block; }
    .bar { height:10px; background:rgba(255,255,255,.08); border-radius:5px; overflow:hidden; } .bar > div { height:100%; border-radius:5px; transition:width .5s; }
    .alertbox { font-family:ui-monospace,Menlo,monospace; font-size:11.5px; padding:8px 10px; border:1px solid; border-radius:4px; margin-top:8px; }
    .seg2 { display:inline-flex; border:1px solid rgba(56,189,248,.35); border-radius:4px; overflow:hidden; }
    .seg2 button { font-family:ui-monospace,Menlo,monospace; font-size:11px; padding:5px 9px; color:#A0A0AB; background:none; border:0; cursor:pointer; } .seg2 button.on { background:rgba(56,189,248,.2); color:#fff; }
    .simbtns { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:6px; } @media (max-width:1100px) { .simbtns { grid-template-columns:repeat(2,minmax(0,1fr)); } }
    input[type=range].sl { -webkit-appearance:none; appearance:none; width:100%; height:4px; background:rgba(56,189,248,.18); border-radius:2px; }
    input[type=range].sl::-webkit-slider-thumb { -webkit-appearance:none; width:13px; height:13px; border-radius:2px; background:var(--cyan); cursor:pointer; }
  `;
  document.head.appendChild(css);

  /* ------------------------------------------------------------------ DOM */
  const card = (id, label, unit, ref) => `<div class="card" id="c_${id}" style="border-color:rgba(56,189,248,.3)"><div class="lbl">${label}</div><div><span class="val" id="v_${id}">—</span><span class="unit">${unit}</span></div><div class="ref" id="r_${id}">${ref}</div></div>`;
  $('viewMPU').innerHTML = `
    <div class="panel banner row" id="mpuNoData" style="border-color:rgba(255,42,85,.7);color:var(--red)">
      <span class="mono blink" style="font-weight:700;font-size:13px">[ MPU6050 SIN DATOS ]</span>
      <span class="muted" style="color:#F4F3EF">El brazalete no está enviando el bloque "imu". Carga el firmware <b>max30102_mpu6050_c3.ino</b> (MAX30102 + MPU6050 en los mismos pines SDA/SCL), o usa el simulador.</span>
      <button class="btn" id="mpuUseSim" style="margin-left:auto">USAR SIMULADOR</button>
    </div>

    <div class="mrow m2">
      <section class="panel">
        <div class="row" style="justify-content:space-between;margin-bottom:8px">
          <div class="ptitle">Señal inercial cruda · 6 ejes a 50 Hz</div>
          <div class="mono" style="font-size:10.5px"><span style="color:${COL.cyan}">■ X</span> <span style="color:${COL.amber}">■ Y</span> <span style="color:${COL.violet}">■ Z</span> <span style="color:${COL.green}">■ velocidad vertical</span></div>
        </div>
        <div class="cv" style="height:270px"><canvas id="imuScope"></canvas></div>
        <div class="mono muted" id="imuRaw" style="margin-top:6px">—</div>
      </section>
      <section class="panel">
        <div class="ptitle" style="margin-bottom:8px">Horizonte artificial · fusión acel + giro</div>
        <div class="cv" style="height:230px"><canvas id="horizon"></canvas></div>
        <div class="row mono" style="justify-content:space-between;font-size:12px;margin-top:8px">
          <span>PITCH <b id="v_pitch" style="color:var(--cyan)">—</b>°</span><span>ROLL <b id="v_roll" style="color:var(--cyan)">—</b>°</span><span id="oriMode" style="color:#6f8a9a;font-size:10.5px">—</span>
        </div>
      </section>
    </div>

    <section class="panel">
      <div class="ptitle" style="margin-bottom:8px">Fusión MPU6050 ↔ MAX30102 · energía de movimiento y protección de métricas</div>
      <div class="g6">
        ${card('enmo', 'ENERGÍA DE MOVIMIENTO', 'g', 'umbral ANC 0.035 g')}
        ${card('g', 'GRAVEDAD LOCAL (AUTO)', 'g', '—')}
        ${card('sqi', 'CALIDAD ÓPTICA · SQI', '%', 'latido × (1 − movimiento)')}
        ${card('anc', 'CANCELACIÓN ADAPTATIVA', '', '—')}
        ${card('strain', 'STRAIN 0–21', '', 'cinético + cardiovascular')}
        ${card('maxg', 'IMPACTO MÁXIMO', 'g', 'alerta > 3.5 g + inmovilidad')}
      </div>
      <div class="row" style="margin-top:8px;gap:14px">
        <label class="mono" style="font-size:11px;display:flex;align-items:center;gap:6px"><input type="checkbox" id="ancToggle" checked /> Filtro adaptativo NLMS activo (desmárcalo para comparar la onda con y sin cancelación)</label>
        <span class="muted" id="ancInfo">—</span>
      </div>
    </section>

    <div class="mrow m2e">
      <section class="panel">
        <div class="row" style="justify-content:space-between;margin-bottom:8px">
          <div class="ptitle">A · ARED Strength Trainer · estímulo osteogénico</div>
          <button class="btn" id="aredReset" style="padding:4px 8px;font-size:10.5px">NUEVA SESIÓN</button>
        </div>
        <div class="row" style="align-items:flex-end;gap:18px">
          <div><div class="mono muted">REPETICIONES</div><div class="bigval" id="v_reps" style="color:var(--cyan)">0</div></div>
          <div><div class="mono muted" style="margin-bottom:4px">FASE</div><span class="phase" id="v_phase">REPOSO</span></div>
          <div class="mono" style="font-size:11px;color:#A0A0AB" id="v_setinfo">—</div>
        </div>
        <div class="g4" style="margin-top:10px">
          ${card('peak', 'FUERZA PICO', 'g', 'aceleración máx. por serie')}
          ${card('tut', 'TIEMPO BAJO TENSIÓN', 's', 'sesión acumulada')}
          ${card('mcv', 'VELOCIDAD CONCÉNTRICA', 'm/s', 'media por rep (VBT)')}
          ${card('vloss', 'PÉRDIDA DE VELOCIDAD', '%', 'fatiga intra-serie')}
        </div>
        <div style="margin-top:10px">
          <div class="row mono" style="justify-content:space-between;font-size:11px"><span>ÍNDICE DE ESTÍMULO OSTEOGÉNICO</span><b id="v_osteo" style="font-size:16px">0 %</b></div>
          <div class="bar"><div id="b_osteo" style="width:0%"></div></div>
        </div>
        <div class="cv" style="height:110px;margin-top:10px"><canvas id="repBars"></canvas></div>
        <div class="mono muted" style="margin-top:4px">Barra = aceleración dinámica pico de cada rep · línea = 0.30 g (carga útil) · color = estímulo (verde ≥ 0.8)</div>
        <div class="alertbox" id="osteoAlert" style="display:none;color:var(--red);border-color:var(--red)">⚠ CARGA OSTEOGÉNICA INSUFICIENTE: movimiento rápido sin tensión ni fuerza. Riesgo de hipercalciuria y cálculos renales activo.</div>
      </section>

      <section class="panel">
        <div class="ptitle" style="margin-bottom:8px">C · Neuro-vestibular · temblor 4–12 Hz y test de Romberg</div>
        <div class="g4" style="grid-template-columns:repeat(3,minmax(0,1fr))">
          ${card('trem', 'MICRO-TEMBLOR', 'rad/s', 'RMS banda 4–12 Hz')}
          ${card('hz', 'FRECUENCIA DOMINANTE', 'Hz', '—')}
          ${card('gyro', 'VELOCIDAD ANGULAR', 'rad/s', 'magnitud instantánea')}
        </div>
        <div class="cv" style="height:110px;margin-top:10px"><canvas id="spectrum"></canvas></div>
        <div class="mono muted" id="tremClass" style="margin-top:4px">—</div>
        <div class="row" style="margin-top:10px;gap:10px">
          <button class="btn" id="rombergBtn">[ INICIAR TEST DE ROMBERG · 10 s ]</button>
          <span class="muted">Brazo extendido al frente, ojos cerrados, inmóvil.</span>
        </div>
        <div class="bar" style="margin-top:8px"><div id="b_romberg" style="width:0%;background:var(--cyan)"></div></div>
        <div class="alertbox" id="rombergRes" style="display:none"></div>
      </section>
    </div>

    <section class="panel">
      <div class="row" style="justify-content:space-between;margin-bottom:8px">
        <div class="ptitle">D · Arquitectura del sueño · MPU6050 + MAX30102 + hábitat (ruido / CO₂)</div>
        <div class="row" style="gap:6px">
          <button class="btn" id="slLive" style="padding:5px 9px;font-size:10.5px">REGISTRAR EN VIVO (épocas de 10 s)</button>
          <button class="btn" data-night="ruido" style="padding:5px 9px;font-size:10.5px">SIMULAR NOCHE · RUIDO ECLSS</button>
          <button class="btn" data-night="fisiologico" style="padding:5px 9px;font-size:10.5px">NOCHE · ESTRÉS</button>
          <button class="btn" data-night="ideal" style="padding:5px 9px;font-size:10.5px">NOCHE · IDEAL</button>
        </div>
      </div>
      <div class="cv" style="height:190px"><canvas id="hypno"></canvas></div>
      <div class="g6" style="margin-top:10px">
        ${card('sdeep', 'PROFUNDO (SWS)', '%', 'inmóvil + FC↓ + HRV↑')}
        ${card('srem', 'REM', '%', 'atonía + FC irregular')}
        ${card('slight', 'LIGERO', '%', '')}
        ${card('swake', 'DESPIERTO', '%', '')}
        ${card('sdist', 'MICRO-DESPERTARES', '/h', 'giros de muñeca')}
        ${card('senv', 'COINCIDEN CON RUIDO/CO₂', '%', 'correlación ECLSS')}
      </div>
      <div class="alertbox" id="sleepVerdict" style="color:var(--cyan);border-color:rgba(56,189,248,.4)">Sin registro. Simula una noche o inicia el registro en vivo.</div>
      <div class="row" style="margin-top:8px;gap:18px" id="slEnv">
        <label class="mono" style="font-size:11px;flex:1">Ruido del hábitat: <b id="slNoiseV">55</b> dB<input type="range" class="sl" id="slNoise" min="40" max="85" value="55" /></label>
        <label class="mono" style="font-size:11px;flex:1">pCO₂ cabina: <b id="slCo2V">2.0</b> mmHg<input type="range" class="sl" id="slCo2" min="0.5" max="8" step="0.1" value="2" /></label>
        <span class="muted" style="flex:1">En el registro en vivo, estos valores son los del hábitat (aún no hay sensores de ruido/CO₂ en el brazalete).</span>
      </div>
    </section>

    <section class="panel" id="mpuSim">
      <div class="row" style="justify-content:space-between;margin-bottom:8px">
        <div class="ptitle">Simulador inercial (demo sin hardware)</div>
        <div class="row mono" style="font-size:11px;gap:8px">GRAVEDAD
          <div class="seg2" id="gSeg">${[[0, '0g'], [0.16, '0.16g Luna'], [0.38, '0.38g Marte'], [1, '1g Tierra']].map(([v, l]) => `<button data-g="${v}">${l}</button>`).join('')}</div>
        </div>
      </div>
      <div class="simbtns">
        <button class="btn" id="simLoad">SERIE ARED CON CARGA (12 reps)</button>
        <button class="btn" id="simWeak">SERIE SIN CARGA (rápida, 12 reps)</button>
        <button class="btn" id="simTrem5">TEMBLOR 5 Hz (cerebeloso)</button>
        <button class="btn" id="simTrem10">TEMBLOR 10 Hz (fatiga)</button>
        <button class="btn" id="simTrem0">SIN TEMBLOR</button>
        <button class="btn" id="simAtax">ATAXIA EN ROMBERG: NO</button>
        <button class="btn" id="simFall" style="border-color:var(--red);color:var(--red)">SIMULAR CAÍDA EVA (4.4 g)</button>
        <button class="btn" id="simTilt">INCLINAR MUÑECA</button>
      </div>
    </section>`;

  /* ------------------------------------------------------------------ pestañas */
  let tab = 'MAX';
  document.querySelectorAll('#tabs button').forEach((b) => (b.onclick = () => {
    tab = b.dataset.tab;
    document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
    document.querySelectorAll('#tabs button[data-tab]').forEach((x) => { const v = $('view' + x.dataset.tab); if (v) v.style.display = x.dataset.tab === tab ? 'flex' : 'none'; });
    render();
  }));

  /* ------------------------------------------------------------------ sueño */
  const stager = new SleepStager(30);
  let sleepSummary = null, sleepAnim = null, live = null, hypnoDirty = true;
  const startNight = (kind) => {
    if (live) stopLive();
    const script = SleepStager.script(kind); stager.reset(30); let i = 0;
    clearInterval(sleepAnim);
    sleepAnim = setInterval(() => {                       // 8 h comprimidas en ~4 s
      for (let k = 0; k < 24 && i < script.length; k++) stager.add(script[i++]);
      sleepSummary = stager.summary(); hypnoDirty = true; renderSleep();
      if (i >= script.length) { clearInterval(sleepAnim); Engine.event(`Sueño (${kind}): ${sleepSummary.verdict}`, sleepSummary.envFrac >= 0.6 ? 'warn' : 'ok'); }
    }, 100);
  };
  document.querySelectorAll('[data-night]').forEach((b) => (b.onclick = () => startNight(b.dataset.night)));
  const stopLive = () => { live = null; $('slLive').textContent = 'REGISTRAR EN VIVO (épocas de 10 s)'; $('slLive').classList.remove('on'); };
  $('slLive').onclick = () => {
    if (live) { stopLive(); return; }
    clearInterval(sleepAnim); stager.reset(10); sleepSummary = null; hypnoDirty = true;
    live = { t0: performance.now(), act: [], bpm: [], rmssd: [], turns0: inr.turns };
    $('slLive').textContent = 'DETENER REGISTRO'; $('slLive').classList.add('on');
    Engine.event('Registro de sueño en vivo iniciado (épocas de 10 s)');
  };
  const liveTick = (s) => {
    if (!live || !s.mpu) return;
    live.act.push(s.mpu.motionEnergy); if (s.bpm) live.bpm.push(s.bpm); if (s.rmssd) live.rmssd.push(s.rmssd);
    if (performance.now() - live.t0 >= 10000) {
      const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
      const mb = avg(live.bpm), sd = live.bpm.length > 2 ? Math.sqrt(avg(live.bpm.map((x) => (x - mb) ** 2))) : 1;
      stager.add({ act: avg(live.act) ?? 0, turns: inr.turns - live.turns0, bpm: mb, rmssd: avg(live.rmssd) ?? 40, hrSd: sd, noise: +$('slNoise').value, co2: +$('slCo2').value });
      live = { t0: performance.now(), act: [], bpm: [], rmssd: [], turns0: inr.turns };
      sleepSummary = stager.summary(); hypnoDirty = true; renderSleep();
    }
  };
  window.ARES_UI = Object.assign(window.ARES_UI || {}, { sleepSummary: () => sleepSummary });
  $('slNoise').oninput = (e) => ($('slNoiseV').textContent = e.target.value);
  $('slCo2').oninput = (e) => ($('slCo2V').textContent = (+e.target.value).toFixed(1));
  const setCard = (id, text, color, ref) => { const v = $('v_' + id); if (!v) return; v.textContent = text; v.style.color = color; $('c_' + id).style.borderColor = color + '55'; if (ref != null) $('r_' + id).textContent = ref; };
  function renderSleep() {
    const s = sleepSummary;
    if (!s) { ['sdeep', 'srem', 'slight', 'swake', 'sdist', 'senv'].forEach((k) => setCard(k, '—', COL.dim)); $('sleepVerdict').textContent = live ? 'Registrando… la primera época aparece a los 10 s.' : 'Sin registro. Simula una noche o inicia el registro en vivo.'; return; }
    setCard('sdeep', fmt(s.deep), s.deep < 13 ? COL.amber : COL.cyan); setCard('srem', fmt(s.rem), s.rem < 15 ? COL.amber : COL.violet);
    setCard('slight', fmt(s.light), COL.cyan); setCard('swake', fmt(s.wake), s.wake > 10 ? COL.amber : COL.cyan);
    setCard('sdist', fmt(s.perHour, 1), s.perHour > 1.2 ? COL.amber : COL.green, `${s.disturbances} en ${fmt(s.hours, 1)} h`);
    setCard('senv', fmt(s.envFrac * 100), s.envFrac >= 0.6 ? COL.red : COL.cyan);
    const v = $('sleepVerdict'); v.textContent = `${s.verdict} · eficiencia ${fmt(s.efficiency)} %`;
    const c = s.envFrac >= 0.6 && s.perHour >= 0.8 ? COL.red : s.perHour >= 0.8 ? COL.amber : COL.green; v.style.color = c; v.style.borderColor = c;
  }

  /* ------------------------------------------------------------------ controles */
  const needSim = () => { if (Engine.source === 'serial') { Engine.event('Botón del simulador: desconecta el sensor real para usarlo', 'warn'); return false; } if (Engine.source !== 'sim') window.ARES_UI.startSim(); return true; };
  $('mpuUseSim').onclick = () => needSim();
  $('simLoad').onclick = () => { if (needSim()) { Engine.sim.startAred(12); Engine.event('Simulación: serie ARED con carga (12 reps, 1.6 s/rep, 0.38 g)'); } };
  $('simWeak').onclick = () => { if (needSim()) { Engine.sim.startAred(12, { period: 0.6, amp: 0.13 }); Engine.event('Simulación: serie rápida sin carga (0.6 s/rep, 0.13 g)', 'warn'); } };
  const setTrem = (amp, hz, msg) => { if (!needSim()) return; Engine.simCtx = { ...Engine.simCtx, base: { ...Engine.simCtx.base, tremor: amp } }; Engine.sim.tremorHz = hz; Engine.event(msg); };
  $('simTrem5').onclick = () => setTrem(0.09, 5.5, 'Simulación: temblor de 5.5 Hz');
  $('simTrem10').onclick = () => setTrem(0.07, 10, 'Simulación: temblor de 10 Hz');
  $('simTrem0').onclick = () => setTrem(0.01, 9, 'Simulación: sin temblor');
  let ataxia = false;
  $('simAtax').onclick = () => { ataxia = !ataxia; $('simAtax').textContent = `ATAXIA EN ROMBERG: ${ataxia ? 'SÍ' : 'NO'}`; $('simAtax').classList.toggle('on', ataxia); };
  $('simFall').onclick = () => { if (needSim()) { Engine.sim.triggerFall(); Engine.event('Simulación: impacto de 4.4 g seguido de inmovilidad', 'warn'); } };
  $('simTilt').onclick = () => { if (needSim()) { Engine.sim.pitchDeg = Math.round(-25 + Math.random() * 50); Engine.sim.rollDeg = Math.round(-40 + Math.random() * 80); } };
  document.querySelectorAll('#gSeg button').forEach((b) => (b.onclick = () => { Engine.sim.g = +b.dataset.g; needSim(); renderG(); }));
  const renderG = () => document.querySelectorAll('#gSeg button').forEach((b) => b.classList.toggle('on', +b.dataset.g === Engine.sim.g));
  Engine.sim.g = 1; renderG();
  $('aredReset').onclick = () => { inr.resetSession(); render(); };
  $('ancToggle').onchange = (e) => { Engine.cfg.anc = e.target.checked; Engine.event(`Filtro adaptativo NLMS ${e.target.checked ? 'activado' : 'desactivado'}`); };
  $('rombergBtn').onclick = () => {
    if (inr.romberg) return;
    inr.startRomberg(10); $('rombergRes').style.display = 'none';
    if (Engine.simActive() && ataxia) { Engine.sim.driftRate = 1.1; setTimeout(() => { Engine.sim.driftRate = 0; Engine.sim.pitchDeg = 8; }, 10500); }
    Engine.event('Test de Romberg iniciado: 10 s con el brazo extendido y ojos cerrados');
  };

  /* ------------------------------------------------------------------ render 2 Hz */
  const PH = { con: ['CONCÉNTRICA ▲', COL.green], ecc: ['EXCÉNTRICA ▼', COL.amber], iso: ['ISOMÉTRICA ■', COL.cyan], rest: ['REPOSO', COL.dim] };
  let lastRomb = 0, lastFall = 0;
  function render() {
    const s = Engine.snap, m = s.mpu;
    // --- elementos globales (visibles en ambas pestañas)
    const chip = $('mpuChip');
    chip.textContent = m ? `MPU6050 OK · ${fmt(inr.fs)} Hz · ${fmt(m.gLocal, 2)} g` : 'MPU6050 SIN DATOS';
    chip.style.color = chip.style.borderColor = m ? COL.green : COL.dim;
    const ab = $('ancBadge');
    if (m && m.ancActive) {
      ab.style.display = '';
      ab.textContent = m.ancBlocked ? 'ANC EN ESPERA: cadencia ≈ frecuencia cardíaca · métricas retenidas'
        : `ANC ACTIVO: filtrando artefacto cinético en MAX30102${s.held ? ' · SpO₂ / HRV / rigidez retenidas' : ''}`;
    } else ab.style.display = 'none';
    const fb = $('fallBanner');
    if (m && m.fallAlert) {
      fb.style.display = 'flex';
      if (lastFall !== m.fallAlert.at) {
        lastFall = m.fallAlert.at;
        fb.innerHTML = `<span class="mono blink" style="font-weight:700;font-size:14px">🚨 PROTOCOLO DE EMERGENCIA EVA</span>
          <span style="color:#F4F3EF">Impacto de <b>${fmt(m.fallAlert.peakG, 1)} g</b> seguido de inmovilidad (${new Date(m.fallAlert.at).toLocaleTimeString()}). FC actual: ${fmt(s.bpm)} lpm · SpO₂: ${fmt(s.spo2, 1)} %.</span>
          <button class="btn" id="fallAck" style="margin-left:auto;border-color:var(--red);color:var(--red)">ESTOY BIEN · CANCELAR ALERTA</button>`;
        $('fallAck').onclick = () => { inr.ackFall(); Engine.event('Alerta de caída cancelada por el tripulante', 'ok'); render(); };
        Engine.event(`ALERTA EVA: impacto ${fmt(m.fallAlert.peakG, 1)} g + inmovilidad`, 'warn');
      }
    } else fb.style.display = 'none';
    liveTick(s);
    if (tab !== 'MPU') return;

    $('mpuNoData').classList.toggle('show', !m);
    $('mpuSim').style.opacity = Engine.source === 'serial' ? 0.35 : 1;
    $('slEnv').style.display = live ? 'flex' : 'none';
    if (!m) return;

    $('imuRaw').textContent = `acel [g]  x ${fmt(m.ax, 3)}  y ${fmt(m.ay, 3)}  z ${fmt(m.az, 3)}   ·   giro [rad/s]  x ${fmt(m.gx, 3)}  y ${fmt(m.gy, 3)}  z ${fmt(m.gz, 3)}   ·   sesgo giro ${m.bias.map((b) => fmt(b, 3)).join(' / ')}`;
    $('v_pitch').textContent = fmt(m.pitch, 1); $('v_roll').textContent = fmt(m.roll, 1);
    $('oriMode').textContent = m.zeroG ? '0g: solo giroscopio (sin referencia de gravedad)' : 'filtro complementario 98 / 2';

    setCard('enmo', fmt(m.motionEnergy, 3), m.ancActive ? COL.amber : COL.cyan, m.ancActive ? 'MOVIMIENTO sobre umbral' : 'reposo · umbral ANC 0.035 g');
    const gName = m.gLocal < 0.08 ? 'microgravedad (0g)' : m.gLocal < 0.27 ? 'Luna (0.16g)' : m.gLocal < 0.7 ? 'Marte (0.38g)' : 'Tierra (1g)';
    setCard('g', fmt(m.gLocal, 2), COL.cyan, gName);
    setCard('sqi', s.finger ? fmt(m.sqiPercent) : '—', !s.finger ? COL.dim : m.sqiPercent < 35 ? COL.red : m.sqiPercent < 60 ? COL.amber : COL.green);
    setCard('anc', !m.ancEnabled ? 'OFF' : m.ancBlocked ? 'ESPERA' : m.ancFiltering ? 'ACTIVO' : 'LISTO', !m.ancEnabled ? COL.dim : m.ancBlocked ? COL.red : m.ancFiltering ? COL.amber : COL.green,
      s.held ? 'SpO₂ / HRV / rigidez retenidas' : 'métricas en vivo');
    setCard('strain', fmt(m.strain, 1), m.strain > 14 ? COL.red : m.strain > 8 ? COL.amber : COL.cyan, `TRIMP ${fmt(m.trimp, 1)} · cinético ${fmt(m.kin, 1)} g·s`);
    setCard('maxg', fmt(m.maxG, 2), m.maxG > 3.5 ? COL.red : COL.cyan, m.fallWatching ? 'IMPACTO: vigilando inmovilidad…' : 'alerta > 3.5 g + inmovilidad');
    $('ancInfo').textContent = m.ancFiltering ? `Artefacto retirado ≈ ${fmt(m.ancRemoved, 0)} cuentas ADC` : m.ancBlocked ? 'Cadencia del ejercicio ≈ pulso: restar el artefacto borraría el latido.' : 'En reposo la señal óptica pasa sin modificar.';

    $('v_reps').textContent = m.reps;
    const [pt, pc] = PH[m.phase] || PH.rest; const pe = $('v_phase'); pe.textContent = pt; pe.style.color = pe.style.borderColor = pc;
    $('v_setinfo').innerHTML = m.setActive ? `SERIE EN CURSO · rep ${m.setReps}<br>velocidad ${fmt(m.velocity, 2)} m/s` : m.sets.length ? `${m.sets.length} serie(s) completada(s)<br>última: ${m.sets[m.sets.length - 1].reps} reps` : 'Esperando movimiento…';
    setCard('peak', m.reps ? fmt(m.peakForceG, 2) : '—', COL.cyan);
    setCard('tut', fmt(m.tut, 1), COL.cyan, m.reps ? `${fmt(m.tut / m.reps, 1)} s por rep` : 'sesión acumulada');
    setCard('mcv', m.reps ? fmt(m.mcv, 2) : '—', COL.cyan);
    setCard('vloss', m.reps ? fmt(m.velLoss) : '—', m.velLoss > 30 ? COL.amber : COL.cyan);
    const oc = m.osteoScore >= 70 ? COL.green : m.osteoScore >= 35 ? COL.amber : COL.red;
    $('v_osteo').textContent = `${fmt(m.osteoScore)} %`; $('v_osteo').style.color = m.reps ? oc : COL.dim;
    $('b_osteo').style.width = `${clamp(m.osteoScore, 0, 100)}%`; $('b_osteo').style.background = oc;
    $('osteoAlert').style.display = m.osteoWeak ? '' : 'none';

    setCard('trem', fmt(m.tremor, 3), m.tremor > 0.1 ? COL.red : m.tremor > 0.04 ? COL.amber : COL.cyan);
    setCard('hz', fmt(m.domHz, 1), m.domHz ? (m.domHz < 7 ? COL.amber : COL.cyan) : COL.dim, m.domHz ? (m.domHz < 7 ? 'banda cerebelosa 4–7 Hz' : 'banda fisiológica 8–12 Hz') : 'sin pico dominante');
    setCard('gyro', fmt(m.gyroMag, 2), COL.cyan);
    $('tremClass').textContent = `Clasificación: ${m.tremClass}`;
    const R = m.romberg, rb = $('rombergBtn');
    rb.disabled = !!R; rb.textContent = R ? `MIDIENDO… ${fmt(R.dur - R.elapsed, 1)} s · desviación ${fmt(R.dev, 1)}°` : '[ INICIAR TEST DE ROMBERG · 10 s ]';
    $('b_romberg').style.width = R ? `${clamp((R.elapsed / R.dur) * 100, 0, 100)}%` : '0%';
    const rr = m.rombergResult;
    if (rr && rr.at !== lastRomb) {
      lastRomb = rr.at;
      const c = rr.grade === 'NORMAL' ? COL.green : rr.grade.startsWith('ATAXIA') ? COL.red : COL.amber, el = $('rombergRes');
      el.style.display = ''; el.style.color = c; el.style.borderColor = c;
      el.innerHTML = `<b>${rr.grade}</b> · deriva postural ${fmt(rr.driftDeg, 1)}° · desviación máx. ${fmt(rr.maxDevDeg, 1)}° · balanceo ${fmt(rr.swayDeg, 1)}° RMS · temblor ${fmt(rr.tremor, 3)} rad/s${rr.domHz ? ` @ ${fmt(rr.domHz, 1)} Hz` : ''}${rr.zeroG ? ' · (0g: solo giroscopio)' : ''}`;
      Engine.event(`Romberg: ${rr.grade} (deriva ${fmt(rr.driftDeg, 1)}°)`, rr.grade === 'NORMAL' ? 'ok' : 'warn');
    }
  }

  /* ------------------------------------------------------------------ canvas 60 fps */
  function fit(c) {
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return null;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }
  const AX = [COL.cyan, COL.amber, COL.violet];
  function trace(ctx, ring, N, y0, hh, w, lo, hi, color, lw = 1.3) {
    if (ring.len < 2) return;
    ctx.beginPath();
    for (let k = N - 1; k >= 0; k--) {
      const x = w - (k / (N - 1)) * w, y = y0 + hh - ((clamp(ring.last(k), lo, hi) - lo) / (hi - lo)) * hh;
      k === N - 1 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.stroke();
  }
  const scale = { a: 1.6, g: 0.5, v: 0.6 };
  function drawScope() {
    const f = fit($('imuScope')); if (!f) return; const { ctx, w, h } = f;
    ctx.strokeStyle = 'rgba(56,189,248,0.07)';
    for (let i = 1; i < 12; i++) { ctx.beginPath(); ctx.moveTo((i * w) / 12, 0); ctx.lineTo((i * w) / 12, h); ctx.stroke(); }
    const N = Math.min(inr.scopeA[0].len, inr.fs * 6); if (N < 3) return;
    const lanes = [[inr.scopeA, 'a', 'ACELERÓMETRO (g)'], [inr.scopeG, 'g', 'GIROSCOPIO (rad/s)']], lh = h * 0.36;
    lanes.forEach(([rings, key, label], li) => {
      let mx = 0.05; for (const r of rings) for (let k = 0; k < N; k += 3) mx = Math.max(mx, Math.abs(r.last(k)));
      scale[key] += (mx * 1.15 - scale[key]) * 0.05; const S = scale[key], y0 = li * (lh + 6) + 4;
      ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.beginPath(); ctx.moveTo(0, y0 + lh / 2); ctx.lineTo(w, y0 + lh / 2); ctx.stroke();
      rings.forEach((r, i) => trace(ctx, r, N, y0, lh, w, -S, S, AX[i]));
      ctx.fillStyle = 'rgba(207,233,255,.7)'; ctx.font = '9.5px ui-monospace, Menlo, monospace'; ctx.fillText(`${label} ±${S.toFixed(2)}`, 6, y0 + 11);
    });
    let mv = 0.2; for (let k = 0; k < N; k += 3) mv = Math.max(mv, Math.abs(inr.scopeV.last(k)));
    scale.v += (mv * 1.2 - scale.v) * 0.05; const y0 = 2 * (lh + 6) + 4, vh = h - y0 - 4;
    ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.beginPath(); ctx.moveTo(0, y0 + vh / 2); ctx.lineTo(w, y0 + vh / 2); ctx.stroke();
    trace(ctx, inr.scopeV, N, y0, vh, w, -scale.v, scale.v, COL.green, 1.6);
    ctx.fillStyle = 'rgba(43,255,136,.8)'; ctx.fillText(`VELOCIDAD VERTICAL (m/s) ±${scale.v.toFixed(2)} · ▲ concéntrica ▼ excéntrica`, 6, y0 + 11);
  }
  function drawHorizon() {
    const f = fit($('horizon')); if (!f) return; const { ctx, w, h } = f;
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 8, pitch = inr.pitch * 57.2958, roll = inr.roll;
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.clip();
    ctx.translate(cx, cy); ctx.rotate(-roll); const pp = (R / 45) * pitch;
    ctx.fillStyle = '#06324a'; ctx.fillRect(-2 * R, -3 * R + pp, 4 * R, 3 * R);
    ctx.fillStyle = '#3d2a08'; ctx.fillRect(-2 * R, pp, 4 * R, 3 * R);
    ctx.strokeStyle = COL.cyan; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-2 * R, pp); ctx.lineTo(2 * R, pp); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1; ctx.font = '9px ui-monospace, Menlo, monospace';
    for (let d = -60; d <= 60; d += 10) { if (!d) continue; const y = pp - (R / 45) * d, l = d % 20 ? 14 : 26; ctx.beginPath(); ctx.moveTo(-l, y); ctx.lineTo(l, y); ctx.stroke(); if (!(d % 20)) ctx.fillText(Math.abs(d), l + 4, y + 3); }
    ctx.restore();
    ctx.strokeStyle = 'rgba(56,189,248,.5)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();
    ctx.strokeStyle = COL.amber; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx - 46, cy); ctx.lineTo(cx - 14, cy); ctx.lineTo(cx, cy + 9); ctx.lineTo(cx + 14, cy); ctx.lineTo(cx + 46, cy); ctx.stroke();
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(-roll); ctx.fillStyle = COL.amber; ctx.beginPath(); ctx.moveTo(0, -R + 2); ctx.lineTo(-6, -R + 13); ctx.lineTo(6, -R + 13); ctx.fill(); ctx.restore();
  }
  function drawReps() {
    const f = fit($('repBars')); if (!f) return; const { ctx, w, h } = f; const reps = inr.reps.slice(-24);
    const top = 0.6, yOf = (v) => h - 6 - (clamp(v, 0, top) / top) * (h - 14);
    ctx.strokeStyle = 'rgba(43,255,136,.6)'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(0, yOf(0.3)); ctx.lineTo(w, yOf(0.3)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(43,255,136,.8)'; ctx.font = '9px ui-monospace, Menlo, monospace'; ctx.fillText('0.30 g', w - 38, yOf(0.3) - 3);
    if (!reps.length) { ctx.fillStyle = COL.dim; ctx.textAlign = 'center'; ctx.fillText('Las repeticiones aparecerán aquí', w / 2, h / 2); ctx.textAlign = 'left'; return; }
    const bw = Math.min(26, (w - 12) / 24 - 3);
    reps.forEach((r, i) => { ctx.fillStyle = r.stim >= 0.8 ? COL.green : r.stim >= 0.45 ? COL.amber : COL.red; const x = 6 + i * (bw + 3), y = yOf(r.peakDyn); ctx.fillRect(x, y, bw, h - 6 - y); });
  }
  function drawSpec() {
    const f = fit($('spectrum')); if (!f) return; const { ctx, w, h } = f; const sp = inr.spec, F = window.ARES_SPEC_F || null;
    const n = sp.length, mx = Math.max(0.004, ...sp), bw = w / n;
    for (let i = 0; i < n; i++) {
      const fr = 3 + i * 0.5, inBand = fr >= 4 && fr <= 12, bh = (sp[i] / mx) * (h - 22);
      ctx.fillStyle = !inBand ? 'rgba(93,127,149,.4)' : fr < 7 ? COL.amber : COL.cyan; ctx.fillRect(i * bw + 1, h - 14 - bh, bw - 2, bh);
      if (fr % 2 === 0) { ctx.fillStyle = 'rgba(207,233,255,.6)'; ctx.font = '9px ui-monospace, Menlo, monospace'; ctx.fillText(`${fr}`, i * bw + 2, h - 3); }
    }
    ctx.fillStyle = 'rgba(207,233,255,.6)'; ctx.fillText('Hz', w - 16, h - 3);
    if (inr.domHz) { const x = ((inr.domHz - 3) / 0.5 + 0.5) * bw; ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.moveTo(x, 2); ctx.lineTo(x, h - 14); ctx.stroke(); ctx.fillStyle = '#fff'; ctx.fillText(`${inr.domHz.toFixed(1)} Hz`, Math.min(x + 4, w - 44), 11); }
    void F;
  }
  const STY = { wake: [0, COL.red], rem: [1, COL.violet], light: [2, COL.cyan], deep: [3, '#38BDF8'] };
  function drawHypno() {
    const f = fit($('hypno')); if (!f) return; const { ctx, w, h } = f; const ep = stager.ep, n = ep.length;
    const L = 74, top = 14, bh = h - top - 20, rowH = bh / 4;
    ctx.font = '9.5px ui-monospace, Menlo, monospace';
    [['DESPIERTO', COL.red], ['REM', COL.violet], ['LIGERO', COL.cyan], ['PROFUNDO', '#38BDF8']].forEach(([t, c], i) => { ctx.fillStyle = c; ctx.fillText(t, 6, top + rowH * i + rowH / 2 + 3); ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.beginPath(); ctx.moveTo(L, top + rowH * (i + 1)); ctx.lineTo(w, top + rowH * (i + 1)); ctx.stroke(); });
    if (!n) { ctx.fillStyle = COL.dim; ctx.textAlign = 'center'; ctx.fillText('Hipnograma vacío', (w + L) / 2, h / 2); ctx.textAlign = 'left'; return; }
    const total = Math.max(n, stager.epochSec === 30 ? 960 : 36), xw = (w - L - 4) / total;
    for (let i = 0; i < n; i++) { const [row, c] = STY[ep[i].stage]; ctx.fillStyle = c; ctx.fillRect(L + i * xw, top + row * rowH + 3, Math.max(1, xw + 0.4), rowH - 6); }
    // ruido (ámbar) y CO2 (blanco tenue) superpuestos
    ctx.strokeStyle = 'rgba(255,184,0,.85)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let i = 0; i < n; i++) { const y = top + bh - (clamp(((ep[i].noise ?? 50) - 45) / 40, 0, 1)) * bh; i ? ctx.lineTo(L + i * xw, y) : ctx.moveTo(L + i * xw, y); } ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.setLineDash([3, 3]); ctx.beginPath();
    for (let i = 0; i < n; i++) { const y = top + bh - (clamp((ep[i].co2 ?? 2) / 8, 0, 1)) * bh; i ? ctx.lineTo(L + i * xw, y) : ctx.moveTo(L + i * xw, y); } ctx.stroke(); ctx.setLineDash([]);
    for (let i = 0; i < n; i++) if (ep[i].disturb && !(i && ep[i - 1].disturb)) { ctx.fillStyle = ep[i].env ? COL.amber : '#fff'; ctx.beginPath(); ctx.moveTo(L + i * xw, top - 2); ctx.lineTo(L + i * xw - 4, top - 11); ctx.lineTo(L + i * xw + 4, top - 11); ctx.fill(); }
    ctx.fillStyle = 'rgba(207,233,255,.6)';
    const hrs = (total * stager.epochSec) / 3600;
    if (hrs >= 1) for (let k = 0; k <= Math.floor(hrs); k++) ctx.fillText(`${k} h`, L + (k * 3600 / stager.epochSec) * xw, h - 5);
    else ctx.fillText(`${Math.round(total * stager.epochSec / 60)} min`, w - 44, h - 5);
    ctx.fillStyle = 'rgba(255,184,0,.9)'; ctx.fillText('— ruido dB', w - 190, 10); ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.fillText('--- CO₂', w - 120, 10); ctx.fillStyle = COL.amber; ctx.fillText('▼ despertar', w - 70, 10);
  }
  let slow = 0;
  function frame(t) {
    requestAnimationFrame(frame);
    if (tab !== 'MPU') return;
    drawScope(); drawHorizon();
    if (t - slow > 200) { slow = t; drawReps(); drawSpec(); if (hypnoDirty) { drawHypno(); hypnoDirty = false; } }
  }
  window.addEventListener('resize', () => (hypnoDirty = true));
  document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => (hypnoDirty = true)));

  Engine.subscribe(render);
  renderSleep();
  requestAnimationFrame(frame);
})();
