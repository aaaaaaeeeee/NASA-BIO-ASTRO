/* =============================================================================
 * BIO-ASTRO FLIGHT SURGEON — copiloto clínico autónomo
 *
 * CAPA A · Reflejo clínico (watchdog en cada tick de 500 ms): fusiona MAX30102 + MPU6050 +
 *          hábitat + NASA/NOAA; abre el HUD de intercepción, habla (Web Speech API) y guía paso a paso.
 * CAPA B · Chat: motor experto LOCAL (sin internet ni claves) con los valores en vivo, y modo Claude opcional
 *          (clave del usuario → proxy local /llm → api.anthropic.com).
 *
 * Detección de pérdida de pulso (como los relojes con "loss of pulse detection"):
 *   - Dedo fuera del sensor (sin contacto óptico) → NUNCA es código rojo: aviso ámbar (el MPU6050 dice si hay movimiento).
 *   - Contacto con la piel SIN onda pulsátil (o FC < 40) + MPU6050 inmóvil → cuenta atrás de 15 s ("¿me escuchas?").
 *     Cualquier movimiento voluntario o el regreso del pulso la cancela. Si expira → CÓDIGO ROJO.
 *
 * Prototipo de investigación: no es un dispositivo médico.
 * ========================================================================== */
(() => {
  'use strict';
  const { Engine } = window.ARES;
  const NASA = window.ARES_NASA, B = window.ARES_BODY;
  const $ = (id) => document.getElementById(id);
  const fmt = (v, d = 0) => (v == null || !Number.isFinite(+v) ? '—' : (+v).toFixed(d));
  const C = { ok: '#10B981', warn: '#F59E0B', crit: '#EF4444', cyan: '#38BDF8', dim: '#63636E' };
  const STATE = (window.ARES_AI_STATE = { codeRed: false });
  const COUNTDOWN_S = 15, CPR_BPM = 110;

  /* =================================================================== estilos + DOM */
  const css = document.createElement('style');
  css.textContent = `
  .aiHud { position:fixed; left:50%; top:172px; transform:translateX(-50%); z-index:150; width:min(980px,96vw); display:none; }
  .aiHud .box { border:2px solid; border-radius:8px; padding:10px 14px; background:rgba(5,8,17,.96); box-shadow:0 10px 40px rgba(0,0,0,.6); }
  .aiHud .t { font-family:ui-monospace,Menlo,monospace; font-weight:800; letter-spacing:.06em; font-size:14px; }
  .aiHud .cite { font-family:ui-monospace,Menlo,monospace; font-size:9.5px; padding:2px 6px; border:1px solid rgba(56,189,248,.4); color:#A0A0AB; border-radius:3px; }
  .aiHud .more { font-size:11.5px; color:#F4F3EF; margin-top:4px; line-height:1.45; }
  .aiChips { display:flex; gap:6px; flex-wrap:wrap; margin-top:6px; }
  .aiChips span { font-family:ui-monospace,Menlo,monospace; font-size:10px; padding:2px 7px; border:1px solid; border-radius:10px; cursor:pointer; }
  .aiDock { position:fixed; right:16px; bottom:16px; z-index:140; }
  .aiDock .fab { font-family:ui-monospace,Menlo,monospace; font-weight:800; font-size:12px; padding:12px 16px; border-radius:30px; border:1px solid var(--cyan); background:rgba(56,189,248,.12); color:#fff; cursor:pointer; box-shadow:0 0 22px rgba(56,189,248,.35); }
  .aiDrawer { position:fixed; right:16px; bottom:70px; width:min(470px,94vw); height:min(640px,78vh); z-index:141; display:none; flex-direction:column; background:#121215; }
  .aiDrawer.show { display:flex; }
  .aiMsgs { flex:1; overflow:auto; padding:8px; display:flex; flex-direction:column; gap:8px; }
  .aiMsg { max-width:92%; padding:8px 10px; border-radius:8px; font-size:12.5px; line-height:1.5; white-space:pre-wrap; }
  .aiMsg.u { align-self:flex-end; background:rgba(56,189,248,.14); border:1px solid rgba(56,189,248,.35); }
  .aiMsg.a { align-self:flex-start; background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.1); }
  .aiMsg .src { display:block; font-family:ui-monospace,Menlo,monospace; font-size:9.5px; color:#63636E; margin-top:5px; }
  .aiQuick { display:flex; gap:5px; flex-wrap:wrap; padding:6px 8px; border-top:1px solid rgba(255,255,255,.06); }
  .aiQuick button { font-size:10px; padding:4px 7px; }
  .aiIn { display:flex; gap:6px; padding:8px; border-top:1px solid rgba(255,255,255,.06); }
  .aiIn input { flex:1; background:#1A1A1F; border:1px solid rgba(56,189,248,.35); color:#F4F3EF; border-radius:4px; font-size:12.5px; padding:8px; }
  .cr { position:fixed; inset:0; z-index:300; background:rgba(40,0,8,.94); display:none; overflow:auto; }
  .cr.show { display:block; }
  .cr .wrapc { max-width:1200px; margin:0 auto; padding:16px; display:grid; grid-template-columns:1fr 380px; gap:14px; }
  @media (max-width:1000px) { .cr .wrapc { grid-template-columns:1fr; } }
  .cr .head { grid-column:1/-1; display:flex; gap:14px; align-items:center; flex-wrap:wrap; border:2px solid var(--red); border-radius:8px; padding:12px 16px; background:rgba(255,42,85,.12); }
  .cr h1 { font-family:ui-monospace,Menlo,monospace; font-size:26px; color:var(--red); letter-spacing:.08em; }
  .cr .clock { font-family:ui-monospace,Menlo,monospace; font-size:42px; font-weight:800; color:#fff; }
  .step { display:flex; gap:10px; align-items:flex-start; border:1px solid rgba(255,255,255,.12); border-radius:6px; padding:10px; margin-bottom:8px; background:rgba(0,0,0,.35); cursor:pointer; }
  .step.done { border-color:var(--green); background:rgba(43,255,136,.08); }
  .step .ck { width:22px; height:22px; border:2px solid #fff; border-radius:4px; flex-shrink:0; display:grid; place-items:center; font-weight:800; }
  .step.done .ck { border-color:var(--green); color:var(--green); }
  .step b { font-family:ui-monospace,Menlo,monospace; color:#fff; } .step p { font-size:12.5px; color:#f2d6dc; margin-top:3px; line-height:1.5; }
  .metro { width:150px; height:150px; border-radius:50%; border:4px solid var(--red); display:grid; place-items:center; font-family:ui-monospace,Menlo,monospace; font-weight:800; font-size:30px; color:#fff; margin:8px auto; transition:transform .06s, background .06s; }
  .metro.beat { transform:scale(1.12); background:rgba(255,42,85,.45); }
  .aiPill { font-family:ui-monospace,Menlo,monospace; font-size:10.5px; padding:5px 8px; border:1px solid; border-radius:4px; cursor:pointer; background:none; }
  `;
  document.head.appendChild(css);

  // controles en la cabecera
  const hdr = $('btnSim').parentElement;
  const mute = document.createElement('button'); mute.className = 'aiPill'; mute.id = 'aiMute';
  const simBtn = document.createElement('button'); simBtn.className = 'aiPill'; simBtn.id = 'aiSimArrest';
  simBtn.style.cssText = 'color:var(--red);border-color:var(--red);font-weight:800';
  simBtn.textContent = '[ SIMULAR PÉRDIDA DE PULSO · CÓDIGO ROJO ]';
  hdr.appendChild(mute); hdr.appendChild(simBtn);

  document.body.insertAdjacentHTML('beforeend', `
    <div class="aiHud" id="aiHud"><div class="box" id="aiHudBox"></div></div>
    <div class="aiDock"><button class="fab" id="aiFab">BIO-ASTRO FLIGHT SURGEON</button></div>
    <section class="panel aiDrawer" id="aiDrawer">
      <div class="row" style="justify-content:space-between;padding:4px 4px 8px;border-bottom:1px solid rgba(255,255,255,.06)">
        <div><div class="ptitle">BIO-ASTRO Flight Surgeon</div><div class="mono" id="aiMode" style="font-size:10px;color:#A0A0AB"></div></div>
        <div class="row" style="gap:6px"><button class="btn" id="aiCfg" style="padding:4px 8px;font-size:10px">CLAUDE</button><button class="btn" id="aiClose" style="padding:4px 8px;font-size:10px">✕</button></div>
      </div>
      <div id="aiCfgBox" style="display:none;padding:8px;border-bottom:1px solid rgba(255,255,255,.06)">
        <div class="muted" style="margin-bottom:6px">Opcional: pega tu clave de Claude (console.anthropic.com) para respuestas generativas. Se guarda solo en este navegador y se envía únicamente a api.anthropic.com a través del servidor local. Sin clave, la IA usa su motor experto local.</div>
        <div class="row" style="gap:6px"><input type="password" id="aiKey" placeholder="sk-ant-…" style="flex:1;background:#1A1A1F;border:1px solid rgba(56,189,248,.35);color:#F4F3EF;border-radius:4px;padding:6px;font-size:11.5px"><button class="btn" id="aiKeySave" style="padding:5px 8px;font-size:10px">GUARDAR</button><button class="btn" id="aiKeyDel" style="padding:5px 8px;font-size:10px">BORRAR</button></div>
      </div>
      <div class="aiMsgs" id="aiMsgs"></div>
      <div class="aiQuick" id="aiQuick"></div>
      <div class="aiIn"><input id="aiInput" placeholder="Escribe un síntoma o una pregunta…" autocomplete="off"><button class="btn" id="aiSend">ENVIAR</button></div>
    </section>
    <div class="cr" id="aiCR"></div>`);

  /* =================================================================== voz y audio */
  let voiceOn = localStorage.getItem('ares.voice') !== '0', esVoice = null, audio = null;
  const pickVoice = () => { const v = speechSynthesis.getVoices(); esVoice = v.find((x) => /^es[-_]MX/i.test(x.lang)) || v.find((x) => /^es[-_]ES/i.test(x.lang)) || v.find((x) => /^es/i.test(x.lang)) || null; };
  if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
  function speak(text, priority = false) {
    if (!voiceOn || !('speechSynthesis' in window) || !text) return;
    if (priority) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text); u.lang = esVoice ? esVoice.lang : 'es-ES'; if (esVoice) u.voice = esVoice; u.rate = 1.05; u.pitch = 0.95;
    speechSynthesis.speak(u);
  }
  const renderMute = () => { mute.textContent = voiceOn ? 'VOZ IA' : 'VOZ OFF'; mute.classList.toggle('off', !voiceOn); mute.style.color = mute.style.borderColor = voiceOn ? C.cyan : C.dim; };
  mute.onclick = () => { voiceOn = !voiceOn; localStorage.setItem('ares.voice', voiceOn ? '1' : '0'); if (!voiceOn) speechSynthesis.cancel(); else speak('Voz de BIO-ASTRO activada.'); renderMute(); };
  renderMute();
  // los navegadores exigen un gesto del usuario antes de reproducir audio: se desbloquea con el primer clic
  document.addEventListener('pointerdown', () => { if (!audio) try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* noop */ } }, { once: true });
  function beep(freq = 880, dur = 0.08, vol = 0.25) {
    if (!audio) return; if (audio.state === 'suspended') audio.resume();
    const o = audio.createOscillator(), g = audio.createGain(); o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, audio.currentTime); g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + dur);
    o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + dur);
  }

  /* =================================================================== lectura de estado fusionado */
  function read() {
    const L = B.evaluate(); if (!L) return null;
    const { S, R } = L, snap = Engine.snap || {}, m = snap.mpu, H = B.H, OV = B.OV, N = NASA.N;
    let contact, bpm = S.bpm, moving, still, motionKnown;
    if (OV.on) {
      contact = OV.hr > 0 ? 'ok' : 'nopulse'; bpm = OV.hr || null;
      moving = OV.tremor > 0.18; still = OV.tremor <= 0.05; motionKnown = true;
    } else {
      contact = snap.contact || 'nodata';
      motionKnown = !!m;
      moving = !!m && (m.motionEnergy > 0.035 || m.gyroMag > 0.6 || m.tremor > 0.18);
      still = !!m && m.motionEnergy < 0.02 && m.gyroMag < 0.15;
    }
    return { S, R, H, N, contact, bpm, moving, still, motionKnown, live: OV.on || Engine.simActive() || Engine.source === 'serial' };
  }

  /* =================================================================== watchdog de pérdida de pulso */
  const P = { phase: 'idle', stillSince: 0, cdStart: 0, crStart: 0, sim: false, dismissUntil: 0 };
  function pulseLogic(F, now) {
    if (STATE.codeRed) return null;                          // el protocolo sigue abierto hasta que el usuario lo cierre
    if (P.phase === 'countdown') {
      const pulseBack = !P.sim && F.contact === 'ok' && F.bpm >= 40;
      if (!P.sim && (F.moving || pulseBack)) { cancelCountdown(pulseBack ? 'pulso recuperado' : 'movimiento voluntario detectado'); return null; }
      const left = COUNTDOWN_S - (now - P.cdStart) / 1000;
      if (left <= 0) { startCodeRed(); return null; }
      if (Math.ceil(left) !== P.lastTick) { P.lastTick = Math.ceil(left); beep(left < 5 ? 1200 : 700, 0.12, 0.3); }
      return { id: 'PULSE_CHECK', sev: 'crit', countdown: left };
    }
    if (!F.live) return null;
    const noPulseWithContact = F.contact === 'nopulse' || (F.contact === 'ok' && F.bpm != null && F.bpm < 40);
    if (noPulseWithContact) {
      if (F.moving) { P.stillSince = 0; return { id: 'PERFUSION_ARTIFACT', sev: 'warn' }; }
      if (!P.stillSince) P.stillSince = now;
      if (now - P.stillSince > 3000 || !F.motionKnown) startCountdown(false);
      return { id: 'PULSE_CHECK_PENDING', sev: 'warn' };
    }
    P.stillSince = 0;
    if (F.contact === "none") { if (!P.noneSince) P.noneSince = now; } else P.noneSince = 0;
    if (F.contact === "none" && now - P.noneSince > 2000 && now > P.dismissUntil) return { id: F.moving ? "SENSOR_LOOSE" : "SENSOR_OFF_STILL", sev: "warn" };
    return null;
  }
  function startCountdown(sim) {
    P.phase = 'countdown'; P.cdStart = performance.now(); P.sim = sim; P.lastTick = null;
    speak('Atención. No detecto pulso en el brazalete y el acelerómetro no registra movimiento. ¿Me escuchas? Mueve la mano o pulsa estoy bien. Si no hay respuesta en quince segundos inicio el código rojo.', true);
    Engine.event(sim ? 'IA · simulación: pérdida de pulso, cuenta atrás de 15 s' : 'IA · pérdida de pulso con contacto + inmovilidad: cuenta atrás de 15 s', 'warn');
    tick();
  }
  function cancelCountdown(why) {
    P.phase = 'idle'; P.stillSince = 0; P.dismissUntil = performance.now() + 30000;
    speak(`Alerta cancelada: ${why}.`, true); Engine.event(`IA · cuenta atrás cancelada (${why})`, 'ok'); tick();
  }

  /* =================================================================== reglas clínicas (6 disparadores) */
  function rules(F) {
    const { S, R, H, N } = F, out = [], g0 = H.g < 0.1, eff = R.eff, reps = S.reps ?? 0;
    const tr = S.tremor ?? 0, sleepEff = S.sleepEff, zone = R.rad.zone;
    if ((S.spo2 != null && S.spo2 < 92) || H.psi < 10) out.push({ id: 'DCS_HYPOXIA', sev: 'crit' });
    if (g0 && (H.co2 > 4 || (S.sys != null && S.sys > 135))) out.push({ id: 'SANS_CO2', sev: 'crit' });
    const storm = N.swActive || N.sLevel > 0;
    if ((zone === 'dome' && (storm || H.neutron > 1.2)) || (eff > 1.2 && S.rmssd != null && S.rmssd < 35) || (S.temp != null && S.temp > 37.4)) out.push({ id: 'RAD_NEUTRON_VIRAL', sev: zone === 'dome' && storm ? 'crit' : 'warn' });
    if (tr > 0.35 || (sleepEff != null && sleepEff < 70) || H.noise > 62) out.push({ id: 'VESTIBULAR', sev: tr > 0.35 ? 'crit' : 'warn' });
    if ((H.g < 0.5 && reps < 15) || (S.si != null && S.si > 8.5) || H.glucose > 110) out.push({ id: 'BONE_METABOLIC', sev: 'warn' });
    return out;
  }

  /* =================================================================== base de conocimiento */
  const CITE = {
    cv: 'NASA HRP · Cardiovascular · Altered Gravity', cpr: 'Guía RCP en microgravedad DGLRM / ESAM-SMG (Hinkelbein et al. 2020)', dcs: 'NASA HRP · DCS vs. Hypoxia · Hostile Closed Environment',
    sans: 'NASA HRP · 5 Hazards · SANS', rad: 'CSA · Monitoring Radiation (CANS, Radi-N2)', viral: 'NASA HRP · Space Radiation & Viral Reactivation', donki: 'NASA DONKI + GOES (NOAA SWPC)',
    bone: 'NASA HRP · Bone Loss & Renal Stone', aging: 'CSA · Why do we conduct science in space (Vascular Aging)', vest: 'NASA HRP · Sensorimotor · Isolation & Confinement · CIPHER', hw: 'Fusión de hardware MAX30102 + MPU6050',
  };
  const ALERTS = {
    SENSOR_LOOSE: { title: 'AVISO TÉCNICO · CONTACTO ÓPTICO PERDIDO EN MAX30102', cite: ['hw'],
      voice: 'Atención. Señal de pulso perdida en el sensor óptico, pero el acelerómetro detecta movimiento activo. No es una emergencia: ajusta el brazalete contra la piel.',
      dx: () => 'El fotodetector ya no recibe luz reflejada por la sangre (sin contacto óptico), pero el MPU6050 registra movimiento voluntario: el tripulante está consciente. Es un problema de colocación, no de circulación.',
      steps: [['Presiona la yema del dedo sobre el MAX30102 con presión suave', null], ['Comprueba que la luz roja del sensor esté encendida', null]] },
    SENSOR_OFF_STILL: { title: 'SIN CONTACTO ÓPTICO · TRIPULANTE INMÓVIL', cite: ['hw'],
      voice: 'No hay contacto en el sensor óptico y no detecto movimiento. Si estás bien, pulsa estoy bien o vuelve a colocar el dedo.',
      dx: () => 'Sin contacto óptico no se puede medir el pulso. El brazo está quieto, lo que es normal en reposo; por eso esto NO dispara un código rojo. Si el tripulante no responde, revísalo en persona.',
      steps: [['Recoloca el dedo en el sensor', null], ['Si no responde, comprueba consciencia y respiración en persona', null]], ok: true },
    PERFUSION_ARTIFACT: { title: 'CONTACTO SIN PULSO, PERO CON MOVIMIENTO', cite: ['hw', 'cv'],
      voice: 'El sensor toca la piel pero no encuentra pulso, aunque hay movimiento. Probablemente el brazalete está mal colocado o el dedo está frío.',
      dx: () => 'El MAX30102 tiene contacto (hay luz reflejada) pero sin onda pulsátil. Como el MPU6050 detecta movimiento voluntario, lo más probable es un artefacto: mala posición, presión excesiva o vasoconstricción por frío.',
      steps: [['Afloja la presión: apretar demasiado corta la circulación del dedo', null], ['Calienta la mano y recoloca el sensor', null]] },
    PULSE_CHECK_PENDING: { title: 'VERIFICANDO PÉRDIDA DE PULSO…', cite: ['hw'], voice: null,
      dx: () => 'Contacto con la piel sin onda pulsátil y sin movimiento. Esperando 3 s de inmovilidad para iniciar la verificación.', steps: [] },
    DCS_HYPOXIA: { title: 'ALERTA ROJA PULMONAR · HIPOXIA / RIESGO DE DESCOMPRESIÓN', cite: ['dcs'],
      voice: 'Alerta roja pulmonar. Caída de oxígeno o despresurización de cabina. Colócate la máscara de oxígeno al cien por cien.',
      dx: (F) => `SpO₂ ${fmt(F.S.spo2, 1)} % con cabina a ${fmt(F.H.psi, 1)} psi. Con SpO₂ < 92 % falta oxígeno en los alvéolos (hipoxia). Con presión < 10 psi el nitrógeno disuelto puede formar burbujas en articulaciones ("the bends").`,
      steps: [['Colócate la máscara de oxígeno al 100 %', null], ['Aborta la despresurización: bloquea la esclusa EVA', 'airlock'], ['Represuriza la cabina a 14.7 psi si hay dolor articular', 'psi'], ['Inicia la pre-respiración de O₂ de 45 min antes de cualquier EVA', 'prebreathe'], ['Revisa dolor en hombros, codos y rodillas; activa el filtro HEPA si entró regolito', 'hepa']] },
    SANS_CO2: { title: 'ALERTA NEURO-OCULAR · SANS + VASODILATACIÓN POR CO₂', cite: ['sans'],
      voice: 'Alerta neuro ocular. El dióxido de carbono supera cuatro milímetros de mercurio en microgravedad y aumenta la presión dentro del cráneo.',
      dx: (F) => `En 0g la sangre sube a la cabeza; con ${fmt(F.H.co2, 1)} mmHg de CO₂ los vasos del cerebro se dilatan. La presión intracraneal sube y comprime la vaina del nervio óptico (SANS).`,
      steps: [['Sube el depurador de CO₂ del ECLSS al 100 %', 'co2'], ['Colócate los manguitos de muslo / LBNP (−40 mmHg) para bajar la sangre a las piernas', 'cuffs'], ['Mide la vaina del nervio óptico con la guía de ultrasonido (> 5.8 mm = SANS)', 'tool:onsd'], ['Haz la rejilla de Amsler', 'tool:amsler']] },
    RAD_NEUTRON_VIRAL: { title: 'ALERTA DE RADIACIÓN · NEUTRONES SECUNDARIOS + SUPRESIÓN INMUNE', cite: ['rad', 'viral', 'donki'],
      voice: 'Alerta de radiación espacial. Estás en una zona con poco blindaje durante actividad solar. Evacúa al refugio de agua.',
      dx: (F) => `Dosis efectiva ${fmt(F.R.eff, 2)} mSv/día en ${B.ZONES[F.R.rad.zone].name}; ~30 % son neutrones secundarios (CSA CANS). ${F.N.swReasons.join(' · ')}. ${F.S.rmssd != null ? `HRV ${fmt(F.S.rmssd)} ms. ` : ''}${F.S.temp != null ? `Temperatura ${fmt(F.S.temp, 2)} °C. ` : ''}Radiación + estrés pueden reactivar virus latentes (herpes zóster, EBV).`,
      steps: [['Evacúa al refugio de agua (RSSI > −50 dBm, dosis ×0.15)', 'shelter'], ['Cuenta las burbujas del detector Radi-N2', 'tool:radin2'], ['Revisa la piel con el escáner de erupciones', 'tool:rash'], ['Inicia el protocolo antiviral / antioxidante', 'antiviral']] },
    VESTIBULAR: { title: 'ALERTA SENSORIOMOTORA · DERIVA VESTIBULAR / DESFASE CIRCADIANO', cite: ['vest'],
      voice: 'Precaución vestibular. El giroscopio detecta temblor e inestabilidad. Se restringe la conducción del rover hasta pasar el test.',
      dx: (F) => `Temblor ${fmt(F.S.tremor, 3)} rad/s${F.S.sleepEff != null ? `, sueño ${fmt(F.S.sleepEff)} % de eficiencia` : ''}, ruido ${F.H.noise} dB. Los otolitos del oído interno se descalibran al cambiar de gravedad y con la falta de sueño.`,
      steps: [['Conducción del rover restringida hasta aprobar el test', null], ['Luces de cabina a 480 nm (azul) para la fase activa', 'led480'], ['Reduce el ruido: modo ventilador silencioso y luz ámbar 630 nm antes de dormir', 'led630'], ['Haz el test vestibular de 15 s', 'tool:pvt']] },
    BONE_METABOLIC: { title: 'ALERTA METABÓLICA · CASCADA HUESO → RIÑÓN Y RIGIDEZ ARTERIAL', cite: ['bone', 'aging'],
      voice: null, // se anuncia con el conteo de repeticiones
      dx: (F) => `En baja gravedad se pierde 1–1.5 % de hueso al mes; el calcio viaja al riñón (cálculos). Repeticiones ARED hoy: ${F.S.reps ?? 0}/15${F.S.si != null ? ` · rigidez ${fmt(F.S.si, 1)} m/s` : ''} · glucosa ${F.H.glucose} mg/dL (la CSA documentó rigidez carotídea y resistencia a la insulina tras 6 meses en la ISS).`,
      steps: [['Haz 15 sentadillas con el brazalete: la IA las cuenta en voz alta', 'reps'], ['Bebe 500 mL de agua con citrato de potasio', 'hyd'], ['Ración de bajo índice glucémico', 'ration']] },
  };

  /* =================================================================== HUD de intercepción */
  let active = [], lastSpoken = {}, hudPinned = null, autoDone = {};
  const SEV = { crit: 3, warn: 2, ok: 1 };
  function tick() {
    const F = read(); if (!F) return;
    const now = performance.now();
    const pl = pulseLogic(F, now);
    const list = [...(pl ? [pl] : []), ...rules(F)];
    list.sort((a, b) => SEV[b.sev] - SEV[a.sev]);
    // voz al activar (o escalar) una alerta, con 90 s de enfriamiento por alerta
    for (const a of list) {
      const prev = active.find((x) => x.id === a.id);
      if ((!prev || SEV[a.sev] > SEV[prev.sev]) && ALERTS[a.id] && ALERTS[a.id].voice && Date.now() - (lastSpoken[a.id] || 0) > 90000 && !STATE.codeRed && P.phase !== 'countdown') {
        lastSpoken[a.id] = Date.now(); speak(ALERTS[a.id].voice, a.sev === 'crit');
        Engine.event(`IA · ${ALERTS[a.id].title}`, a.sev === 'crit' ? 'warn' : 'info');
      }
      // acción autónoma: la nave ajusta la iluminación circadiana al detectar deriva vestibular
      if (a.id === 'VESTIBULAR' && !autoDone.led && B.H.led !== '480') { autoDone.led = true; B.act('led480'); }
    }
    if (!list.find((x) => x.id === 'VESTIBULAR')) autoDone.led = false;
    repsCoach(F, list);
    active = list;
    STATE.active = list.map((x) => x.id);
    renderHud(F, list);
  }

  // conteo de repeticiones en voz alta mientras la alerta ósea está activa
  let lastReps = null, repsSpokenStart = false;
  function repsCoach(F, list) {
    const reps = F.S.reps ?? 0, on = list.some((x) => x.id === 'BONE_METABOLIC') && F.H.g < 0.5;
    if (lastReps == null) lastReps = reps;
    if (on && reps > lastReps && reps <= 15) {
      if (!repsSpokenStart) { repsSpokenStart = true; speak('Buen trabajo, sigue. Cuento tus repeticiones.'); }
      speak(reps >= 15 ? 'Quince. Carga ósea completada. Alerta renal desactivada.' : String(reps));
      if (reps >= 15) Engine.event('IA · 15 repeticiones ARED completadas: cascada hueso-riñón desactivada', 'ok');
    }
    if (!on) repsSpokenStart = false;
    lastReps = reps;
  }

  function stepButtons(steps) {
    return steps.filter(([, a]) => a).map(([t, a]) => `<button class="btn aiAct" data-ai-act="${a}">${a.startsWith('tool:') ? 'ABRIR' : 'APLICAR'} · ${t}</button>`).join('');
  }
  function runAct(a) {
    if (a.startsWith('tool:')) { document.querySelector('[data-tab=BODY]').click(); setTimeout(() => B.openTool(a.slice(5)), 60); return; }
    B.act(a); tick();
  }
  function renderHud(F, list) {
    const hud = $('aiHud'), box = $('aiHudBox');
    if (STATE.codeRed || !list.length) { hud.style.display = 'none'; return; }
    const top = (hudPinned && list.find((x) => x.id === hudPinned)) || list[0];
    if (top.id === 'PULSE_CHECK') {
      hud.style.display = 'block'; box.style.borderColor = C.crit; box.classList.add('pulse-red');
      box.innerHTML = `<div class="row" style="justify-content:space-between;gap:10px"><span class="t" style="color:${C.crit}">⚠ ¿ME ESCUCHAS? · PÉRDIDA DE PULSO EN VERIFICACIÓN</span><span class="mono" style="font-size:34px;font-weight:800;color:#fff">${Math.ceil(top.countdown)} s</span></div>
        <div class="more">${P.sim ? 'SIMULACIÓN para el jurado. ' : ''}El MAX30102 toca la piel pero no encuentra onda pulsátil y el MPU6050 no registra movimiento. Si el tripulante está bien, que mueva la mano o pulse el botón. Si no hay respuesta, se inicia el CÓDIGO ROJO.</div>
        <div class="row" style="gap:8px;margin-top:8px"><button class="btn" id="aiImOk" style="border-color:${C.ok};color:${C.ok};font-size:13px;padding:8px 16px">✓ ESTOY BIEN</button><button class="btn" id="aiNow" style="border-color:${C.crit};color:${C.crit}">INICIAR RCP YA</button></div>`;
      $('aiImOk').onclick = () => cancelCountdown('el tripulante confirmó que está bien');
      $('aiNow').onclick = () => startCodeRed();
      return;
    }
    const A = ALERTS[top.id], col = top.sev === 'crit' ? C.crit : C.warn;
    hud.style.display = 'block'; box.style.borderColor = col; box.classList.toggle('pulse-red', top.sev === 'crit');
    if (top.sev !== 'crit' && !expanded[top.id]) {               // precaución: barra compacta
      box.innerHTML = `<div class="row" style="gap:10px;align-items:center"><span class="t" style="color:${col};font-size:12px">${A.title}</span><span style="margin-left:auto"></span>${list.length > 1 ? `<span class="mono" style="font-size:10px;color:#A0A0AB">+${list.length - 1} alerta(s)</span>` : ''}<button class="btn" id="aiExp" style="padding:3px 8px;font-size:10px">DETALLES</button><button class="btn" id="aiHide" style="padding:3px 8px;font-size:10px">✕</button></div>`;
      $('aiExp').onclick = () => { expanded[top.id] = true; renderHud(F, list); };
      $('aiHide').onclick = () => { hud.style.display = 'none'; hidden[top.id] = Date.now(); };
      if (hidden[top.id] && Date.now() - hidden[top.id] < 120000) hud.style.display = 'none';
      return;
    }
    box.innerHTML = `<div class="row" style="justify-content:space-between;gap:8px;align-items:flex-start">
        <div><div class="t" style="color:${col}">BIO-ASTRO INTERCEPT · ${A.title}</div><div style="margin-top:4px">${A.cite.map((c) => `<span class="cite">${CITE[c]}</span>`).join(' ')}</div></div>
        <div class="row" style="gap:6px">${A.ok ? '<button class="btn" id="aiOkStill" style="padding:4px 8px;font-size:10px">ESTOY BIEN</button>' : ''}<button class="btn" id="aiOpen" style="padding:4px 8px;font-size:10px">VER PROTOCOLO</button>${top.sev !== 'crit' ? '<button class="btn" id="aiMin" title="Minimizar en la barra superior" style="padding:4px 8px;font-size:10px">—</button>' : ''}<button class="btn" id="aiHide" title="Cerrar" style="padding:4px 8px;font-size:10px">✕</button></div></div>
      <div class="more">${A.dx(F)}</div>
      <div class="row" style="gap:6px;margin-top:6px;flex-wrap:wrap">${stepButtons(A.steps)}</div>
      ${list.length > 1 ? `<div class="aiChips">${list.filter((x) => x !== top && ALERTS[x.id]).map((x) => `<span data-pin="${x.id}" style="color:${x.sev === 'crit' ? C.crit : C.warn};border-color:${x.sev === 'crit' ? C.crit : C.warn}">${ALERTS[x.id].title.split('·')[0].trim()}</span>`).join('')}</div>` : ''}`;
    box.querySelectorAll('[data-ai-act]').forEach((b) => (b.onclick = () => runAct(b.dataset.aiAct)));
    box.querySelectorAll('[data-pin]').forEach((b) => (b.onclick = () => { hudPinned = b.dataset.pin; renderHud(F, list); }));
    $('aiOpen').onclick = () => { openDrawer(); explainAlert(top.id, F); };
    if ($('aiMin')) $('aiMin').onclick = () => { expanded[top.id] = false; renderHud(F, list); };
    $('aiHide').onclick = () => { hud.style.display = 'none'; hidden[top.id] = Date.now(); };
    if ($('aiOkStill')) $('aiOkStill').onclick = () => { P.dismissUntil = performance.now() + 5 * 60000; tick(); };
    if (hidden[top.id] && Date.now() - hidden[top.id] < 60000 && top.sev !== 'crit') hud.style.display = 'none';
  }
  const hidden = {}, expanded = {};

  /* =================================================================== CÓDIGO ROJO + RCP en microgravedad */
  let metroIv = null, crIv = null, crSteps = [];
  const CPR_STEPS = [
    ['VERIFICAR (≤ 10 s)', 'Llama al tripulante por su nombre y sacude sus hombros. Comprueba si respira con normalidad. Si no responde y no respira: es un paro. Avisa a toda la tripulación.'],
    ['ANCLAJE · CMRS', 'Sujeta al paciente al Crew Medical Restraint System (o a una superficie firme). En 0g, si empujas el pecho sin anclaje, tú y el paciente salen despedidos en direcciones opuestas (tercera ley de Newton).'],
    ['RCP MÉTODO HANDSTAND', 'Si el techo está cerca: apoya los pies en el techo del módulo, las manos en el centro del esternón y comprime extendiendo las piernas. 100–120 compresiones/min, 5–6 cm de profundidad. Sigue el metrónomo.'],
    ['ALTERNATIVA · EVETTS-RUSSOMANO', 'Sin techo cerca: rodea el torso del paciente con tus piernas (cruzadas en su espalda) y comprime el esternón con los brazos; tus piernas hacen la contrapresión.'],
    ['30 : 2', 'Ciclos de 30 compresiones y 2 ventilaciones con bolsa-válvula-mascarilla y O₂ al 100 %. Cambia de reanimador cada 2 minutos.'],
    ['DESFIBRILADOR (AED)', 'Coloca los parches del AED del kit médico en cuanto esté disponible y sigue sus instrucciones de voz. Nadie toca al paciente durante la descarga.'],
    ['SOPORTE AVANZADO', 'Si el kit médico lo incluye y hay personal entrenado: acceso IV/IO y epinefrina 1 mg cada 3–5 min, según el protocolo de soporte vital avanzado.'],
    ['EARTH-SYNC', 'El paquete de emergencia ya está en la cola prioritaria hacia los cirujanos de vuelo. Con hasta ~20 min de retraso a Marte, no esperes respuesta: continúa los ciclos.'],
  ];
  function startCodeRed() {
    P.phase = 'idle'; STATE.codeRed = true; P.crStart = performance.now(); crSteps = CPR_STEPS.map(() => false);
    speak('Código rojo. Pérdida crítica de pulso en el brazalete y ausencia de respuesta motora. Inicia la reanimación cardiopulmonar en microgravedad. Ancla al paciente y comprime al ritmo del metrónomo.', true);
    Engine.event(`IA · CÓDIGO ROJO${P.sim ? ' (simulación)' : ''}: protocolo de RCP en microgravedad iniciado`, 'warn');
    B.update();
    B.sendPacket('emergency-code-red');
    toggleMetro(true); renderCR(); $("aiCR").classList.add("show");
    clearInterval(crIv); crIv = setInterval(renderClock, 250);
  }
  function endCodeRed(how) {
    STATE.codeRed = false; toggleMetro(false); clearInterval(crIv); $('aiCR').classList.remove('show');
    P.sim = false; P.dismissUntil = performance.now() + 30000;
    speak(how === 'rosc' ? 'Pulso recuperado. Mantén al paciente en observación, oxígeno al cien por cien y registra los tiempos.' : 'Protocolo de código rojo cerrado.', true);
    Engine.event(`IA · código rojo cerrado (${how === 'rosc' ? 'retorno de circulación' : 'finalizado'}) · pasos completados ${crSteps.filter(Boolean).length}/${CPR_STEPS.length}`, 'ok');
    B.update(); B.sendPacket('emergency-code-red-closed'); tick();
  }
  function toggleMetro(on) {
    clearInterval(metroIv); metroIv = null;
    if (!on) return;
    let n = 0;
    metroIv = setInterval(() => {
      n++; const el = $('crMetro'); if (el) { el.classList.add('beat'); setTimeout(() => el.classList.remove('beat'), 90); el.textContent = ((n - 1) % 30) + 1; }
      beep((n - 1) % 30 === 29 ? 520 : 880, 0.07, 0.3);
    }, 60000 / CPR_BPM);
  }
  function renderClock() {
    const s = (performance.now() - P.crStart) / 1000, mm = Math.floor(s / 60), ss = Math.floor(s % 60);
    const c = $('crClock'); if (c) c.textContent = `${mm}:${String(ss).padStart(2, '0')}`;
    const cyc = $('crCycle'); if (cyc) { const left = 120 - (s % 120); cyc.textContent = `ciclo ${Math.floor(s / 120) + 1} · cambio de reanimador en ${Math.ceil(left)} s`; if (left < 0.3) speak('Dos minutos. Cambia de reanimador y revisa el ritmo con el desfibrilador.'); }
  }
  function renderCR() {
    const done = crSteps.filter(Boolean).length;
    $('aiCR').innerHTML = `<div class="wrapc">
      <div class="head"><h1>🚨 CÓDIGO ROJO · PÉRDIDA DE PULSO</h1><span class="clock" id="crClock">0:00</span>
        <span class="mono" style="color:#f2d6dc;font-size:12px">${P.sim ? 'SIMULACIÓN · ' : ''}MAX30102 sin onda pulsátil + MPU6050 inmóvil · paquete prioritario enviado a Earth-Sync</span>
        <div class="row" style="gap:8px;margin-left:auto"><button class="btn" id="crRosc" style="border-color:var(--green);color:var(--green)">PULSO RECUPERADO</button><button class="btn" id="crEnd">CERRAR PROTOCOLO</button></div></div>
      <div>
        <div class="ptitle" style="margin-bottom:8px;color:#ffb3c1">PROTOCOLO PASO A PASO · ${done}/${CPR_STEPS.length} · márcalos al completarlos</div>
        ${CPR_STEPS.map(([t, d], i) => `<div class="step ${crSteps[i] ? 'done' : ''}" data-s="${i}"><span class="ck">${crSteps[i] ? '✓' : i + 1}</span><div><b>${t}</b><p>${d}</p></div></div>`).join('')}
        <div class="mono" style="font-size:10px;color:#c99;margin-top:6px">Fuentes: ${CITE.cpr} · ${CITE.cv} · Crew Medical Restraint System (ISS). Técnicas evaluadas en vuelos parabólicos; no es un protocolo oficial publicado por NASA. Prototipo, no dispositivo médico.</div>
      </div>
      <div>
        <section class="panel" style="text-align:center;background:rgba(0,0,0,.4)">
          <div class="ptitle" style="color:#ffb3c1">METRÓNOMO RCP · ${CPR_BPM} / min</div>
          <div class="metro" id="crMetro">1</div>
          <div class="mono" id="crCycle" style="font-size:11px;color:#f2d6dc"></div>
          <button class="btn" id="crMetroBtn" style="margin-top:8px;width:100%">${metroIv ? 'PAUSAR METRÓNOMO' : 'ACTIVAR METRÓNOMO RCP 110 BPM'}</button>
        </section>
        <section class="panel" style="margin-top:12px;background:rgba(0,0,0,.4)">
          <div class="ptitle" style="color:#ffb3c1;margin-bottom:6px">MÉTODO HANDSTAND EN 0g</div>
          <svg viewBox="0 0 300 210" style="width:100%">
            <rect x="10" y="8" width="280" height="194" rx="10" fill="none" stroke="#63636E" stroke-dasharray="5 5"/><text x="20" y="24" fill="#63636E" font-size="10" font-family="monospace">TECHO DEL MÓDULO</text>
            <rect x="60" y="168" width="180" height="16" rx="4" fill="#3a1a22" stroke="#EF4444"/><text x="78" y="198" fill="#EF4444" font-size="9" font-family="monospace">CMRS (paciente anclado)</text>
            <ellipse cx="150" cy="160" rx="70" ry="9" fill="#F4F3EF" opacity=".7"/><circle cx="222" cy="158" r="9" fill="#F4F3EF" opacity=".7"/>
            <g stroke="#38BDF8" stroke-width="5" stroke-linecap="round" fill="none"><line x1="150" y1="150" x2="150" y2="110"/><line x1="150" y1="110" x2="150" y2="62"/><line x1="150" y1="62" x2="135" y2="12"/><line x1="150" y1="62" x2="165" y2="12"/><line x1="150" y1="105" x2="140" y2="150"/><line x1="150" y1="105" x2="160" y2="150"/></g>
            <circle cx="150" cy="120" r="9" fill="#38BDF8"/>
            <path d="M178 40 L178 120" stroke="#F59E0B" stroke-width="2" marker-end="url(#ar)"/><defs><marker id="ar" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10Z" fill="#F59E0B"/></marker></defs>
            <text x="184" y="80" fill="#F59E0B" font-size="9" font-family="monospace">empuje de piernas</text><text x="112" y="10" fill="#38BDF8" font-size="9" font-family="monospace">pies en el techo</text>
          </svg>
        </section>
      </div></div>`;
    $('aiCR').querySelectorAll('[data-s]').forEach((el) => (el.onclick = () => { const i = +el.dataset.s; crSteps[i] = !crSteps[i]; if (crSteps[i] && i < CPR_STEPS.length - 1) speak(`${CPR_STEPS[i + 1][0]}.`); renderCR(); }));
    $('crRosc').onclick = () => endCodeRed('rosc');
    $('crEnd').onclick = () => endCodeRed('end');
    $('crMetroBtn').onclick = () => { toggleMetro(!metroIv); renderCR(); };
    renderClock();
  }
  simBtn.onclick = () => { if (STATE.codeRed || P.phase === 'countdown') return; if (!audio) try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* noop */ } startCountdown(true); };

  /* =================================================================== CAPA B · chat */
  const msgs = [];
  const quick = ['¿Qué hago si un tripulante pierde el pulso?', 'Tengo visión borrosa y dolor de cabeza', '¿Cómo funciona el detector canadiense CANS?', 'Analizar mi estado actual de sensores', 'Me duelen las rodillas después de la EVA', 'Me siento mareado', '¿Puedo salir a la EVA ahora?'];
  $('aiQuick').innerHTML = quick.map((q) => `<button class="btn" data-q="${q}">${q}</button>`).join('');
  $('aiQuick').querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => ask(b.dataset.q)));
  const openDrawer = () => { $('aiDrawer').classList.add('show'); if (!msgs.length) greet(); };
  $('aiFab').onclick = () => ($('aiDrawer').classList.contains('show') ? $('aiDrawer').classList.remove('show') : openDrawer());
  $('aiClose').onclick = () => $('aiDrawer').classList.remove('show');
  $('aiCfg').onclick = () => { const b = $('aiCfgBox'); b.style.display = b.style.display === 'none' ? 'block' : 'none'; };
  const claudeKey = () => localStorage.getItem('ares.claudeKey') || '';
  $('aiKeySave').onclick = () => { const v = $('aiKey').value.trim(); if (v) { localStorage.setItem('ares.claudeKey', v); $('aiKey').value = ''; } renderMode(); };
  $('aiKeyDel').onclick = () => { localStorage.removeItem('ares.claudeKey'); renderMode(); };
  function renderMode() { $('aiMode').textContent = claudeKey() ? 'Modo: Claude (claude-opus-5-5) + datos en vivo · respaldo: motor experto local' : 'Modo: motor experto local (sin internet ni claves) + datos en vivo'; }
  renderMode();
  $('aiSend').onclick = () => { const v = $('aiInput').value.trim(); if (v) { $('aiInput').value = ''; ask(v); } };
  $('aiInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('aiSend').click(); });
  function addActs(el, acts) {
    const row = document.createElement('div'); row.className = 'aiActs'; row.innerHTML = stepButtons(acts);
    row.querySelectorAll('[data-ai-act]').forEach((b) => (b.onclick = () => runAct(b.dataset.aiAct))); el.appendChild(row);
  }
  function push(role, text, src, acts) {
    msgs.push({ role, text });
    const el = document.createElement('div'); el.className = 'aiMsg ' + (role === 'user' ? 'u' : 'a');
    el.textContent = text; if (src) { const s = document.createElement('span'); s.className = 'src'; s.textContent = src; el.appendChild(s); }
    if (acts && acts.length) addActs(el, acts);
    $('aiMsgs').appendChild(el); $('aiMsgs').scrollTop = 1e9; return el;
  }
  function greet() { const F = read(); push('assistant', `Soy BIO-ASTRO, tu cirujano de vuelo autónomo. Vigilo tu brazalete (MAX30102 + MPU6050), la cabina y el clima espacial de NASA.\n\n${F ? statusLine(F) : ''}\n\nPregúntame por un síntoma o usa los botones de abajo.`, 'motor local'); }

  function statusLine(F) {
    const { S, H, R, N } = F;
    return `Ahora: FC ${fmt(F.bpm)} lpm · SpO₂ ${fmt(S.spo2, 1)} % · HRV ${fmt(S.rmssd)} ms · temblor ${fmt(S.tremor, 3)} rad/s · reps ${S.reps ?? 0} · T ${fmt(S.temp, 2)} °C · CO₂ ${fmt(H.co2, 1)} mmHg · ${fmt(H.psi, 1)} psi · ${H.g}g · ${B.LOCS[H.loc].short} · dosis ${fmt(R.eff, 2)} mSv/d · GOES S${N.sLevel} · Kp ${fmt(N.kpNow, 1)}.`;
  }
  function explainAlert(id, F) {
    const A = ALERTS[id]; if (!A) return;
    push('assistant', `${A.title}\n\n${A.dx(F)}\n\nQué hacer:\n${A.steps.map(([t], i) => `${i + 1}. ${t}`).join('\n')}\n\nFuente: ${A.cite.map((c) => CITE[c]).join(' · ')}`, 'motor local · alerta activa', A.steps);
  }

  // ---------------- motor experto local (intenciones + datos en vivo)
  const has = (t, ...ws) => ws.some((w) => t.includes(w));
  function localAnswer(q, F) {
    const t = q.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const { S, H, R, N } = F;
    const live = statusLine(F);
    if (has(t, 'pulso', 'paro', 'rcp', 'reanim', 'desmay', 'colaps', 'inconsciente', 'no respira')) {
      return { text: `Pérdida de pulso en 0g:\n${CPR_STEPS.map(([a, b], i) => `${i + 1}. ${a}: ${b}`).join('\n')}\n\nEl brazalete distingue "dedo fuera" (aviso ámbar) de "contacto sin pulso + inmovilidad" (cuenta atrás de 15 s y luego código rojo).\n${live}`, cite: [CITE.cpr, CITE.cv] };
    }
    if (has(t, 'vision', 'borros', 'ojo', 'cabeza', 'cefalea', 'presion intracraneal', 'sans')) {
      const crit = H.g < 0.1 && H.co2 > 4;
      return { text: `${crit ? '⚠ Compatible con SANS: ' : ''}En 0g la sangre sube a la cabeza; con CO₂ alto (ahora ${fmt(H.co2, 1)} mmHg) los vasos cerebrales se dilatan y sube la presión intracraneal, que comprime el nervio óptico.\n\n1. Sube el depurador de CO₂ al 100 %.\n2. Manguitos de muslo / LBNP para bajar la sangre a las piernas.\n3. Mide la vaina del nervio óptico con la guía de ultrasonido (> 5.8 mm = SANS).\n4. Haz la rejilla de Amsler.\n${B.EX.onsd ? `Tu último ONSD: ${fmt(B.EX.onsd.mm, 2)} mm. ` : ''}${live}`, cite: [CITE.sans] };
    }
    if (has(t, 'cans', 'neutron', 'radi-n2', 'radin2', 'radiacion', 'tormenta solar', 'dosis', 'goes', 'donki')) {
      return { text: `La CSA mide la radiación de la ISS con dos herramientas: CANS, un espectrómetro autónomo de neutrones, y Radi-N2, detectores de burbujas (cada neutrón que golpea el gel deja una burbuja que se cuenta).\n\nLos neutrones secundarios (~30 % de la dosis) se producen cuando los rayos cósmicos chocan con el casco de la nave.\n\nTu dosis ahora: ${fmt(R.eff, 2)} mSv/día en ${B.ZONES[R.rad.zone].name} (${B.LOCS[H.loc].name}). Clima espacial: GOES S${N.sLevel}, Kp ${fmt(N.kpNow, 1)}, ${N.timeline.length} eventos DONKI en 30 días. ${N.swReasons.join(' · ')}.\n\nSi hay tormenta y estás en la cúpula (RSSI < −70 dBm), ve al refugio de agua (×0.15).`, cite: [CITE.rad, CITE.donki] };
    }
    if (has(t, 'rodilla', 'hombro', 'articul', 'codo', 'bends', 'descompres', 'dcs')) {
      return { text: `Dolor articular tras una EVA o una despresurización sugiere enfermedad por descompresión ("the bends"): burbujas de nitrógeno en las articulaciones.\n\n1. Oxígeno al 100 % de inmediato.\n2. Represuriza (cabina a 14.7 psi) o usa el traje como cámara de recompresión si el protocolo lo prevé.\n3. Avisa al cirujano de vuelo con prioridad alta.\n4. Antes de la próxima EVA: pre-respiración de O₂ de 45 min.\n\nCabina ahora: ${fmt(H.psi, 1)} psi · SpO₂ ${fmt(S.spo2, 1)} %.`, cite: [CITE.dcs] };
    }
    if (has(t, 'mare', 'vertigo', 'temblor', 'equilibrio', 'sueno', 'dormir', 'cansad', 'fatiga')) {
      return { text: `El mareo y el temblor tras un cambio de gravedad vienen del oído interno: los otolitos tardan días en recalibrarse. La falta de sueño lo empeora (en órbita hay 16 amaneceres al día).\n\nAhora: temblor ${fmt(S.tremor, 3)} rad/s${S.sleepEff != null ? `, sueño ${fmt(S.sleepEff)} %` : ''}, ruido ${H.noise} dB.\n\n1. No conduzcas el rover hasta aprobar el test vestibular de 15 s.\n2. Movimientos de cabeza lentos.\n3. Luz azul de 480 nm de día y ámbar de 630 nm antes de dormir.\n4. Reduce el ruido de la cabina.`, cite: [CITE.vest] };
    }
    if (has(t, 'hueso', 'rinon', 'calculo', 'ared', 'ejercicio', 'sentadilla', 'glucosa', 'azucar', 'arteria', 'rigidez')) {
      return { text: `En baja gravedad se pierde 1–1.5 % de hueso al mes. El calcio liberado va al riñón y puede formar cálculos. La CSA vio además rigidez carotídea y resistencia a la insulina tras 6 meses en la ISS.\n\nHoy: ${S.reps ?? 0}/15 reps ARED · hidratación ${H.hyd} mL · glucosa ${H.glucose} mg/dL${S.si != null ? ` · rigidez ${fmt(S.si, 1)} m/s` : ''}.\n\n1. Haz 15 sentadillas con el brazalete (las cuento en voz alta).\n2. Bebe 500 mL de agua con citrato de potasio.\n3. Ración de bajo índice glucémico.`, cite: [CITE.bone, CITE.aging] };
    }
    if (has(t, 'oxigeno', 'respir', 'ahog', 'aire', 'spo2', 'saturacion')) {
      return { text: `SpO₂ ahora ${fmt(S.spo2, 1)} % con cabina a ${fmt(H.psi, 1)} psi.${S.spo2 != null && S.spo2 < 92 ? ' ⚠ Por debajo de 92 %: máscara de O₂ al 100 % de inmediato.' : ''}\n\nSi falta el aire: oxígeno al 100 %, revisa la presión de cabina y el CO₂ (${fmt(H.co2, 1)} mmHg). Si la presión cae, bloquea la esclusa y represuriza.`, cite: [CITE.dcs] };
    }
    if (has(t, 'eva', 'salir', 'caminata')) {
      const L = B.evaluate();
      return { text: `${L.R.go ? '✓ EVA AUTORIZADA' : '✗ EVA NO AUTORIZADA'} · aptitud ${L.R.score}/100.${L.R.blockers.length ? `\nBloqueos: ${L.R.blockers.join(', ')}.` : ''}\nClima espacial: GOES S${N.sLevel}, Kp ${fmt(N.kpNow, 1)}. Conducción del rover: ${L.R.rover ? 'autorizada' : 'revocada'}.\n${live}`, cite: [CITE.donki, CITE.dcs] };
    }
    if (has(t, 'estado', 'analiz', 'como estoy', 'resumen', 'sensores')) {
      const L = B.evaluate(), bad = Object.entries(L.R.o).filter(([, v]) => v.level === 'crit' || v.level === 'warn');
      return { text: `${live}\n\nAptitud EVA ${L.R.score}/100 (${L.R.go ? 'GO' : 'NO-GO'}).\n${bad.length ? 'Fuera de rango:\n' + bad.map(([k, v]) => `• ${k}: ${v.level === 'crit' ? 'CRÍTICO' : 'precaución'} — ${v.reasons[0]}`).join('\n') : 'Todos los órganos en rango.'}\n\nAlertas activas de la IA: ${active.length ? active.map((a) => (ALERTS[a.id] ? ALERTS[a.id].title : a.id)).join(' · ') : 'ninguna'}.`, cite: ['NASA-STD-3001', CITE.hw] };
    }
    return { text: `No tengo una respuesta específica para eso en mi base local. Lo que veo en tus sensores:\n${live}\n\nSi hay dolor intenso, pérdida de consciencia, dificultad para respirar o sangrado, trátalo como urgencia y avisa al cirujano de vuelo. Prueba también: "visión borrosa", "mareo", "rodillas", "radiación", "estado".`, cite: [CITE.hw] };
  }

  // ---------------- modo Claude (opcional)
  const SYSTEM = `Eres "BIO-ASTRO Flight Surgeon", el asistente médico de una tripulación en una misión espacial larga (prototipo para el NASA Space Apps Challenge, no es un dispositivo médico). Respondes en español, a astronautas que NO son médicos, en pasos numerados cortos y claros. Basa tus respuestas en: NASA Human Research Program (5 peligros: radiación, aislamiento, distancia, gravedad alterada, ambiente cerrado; riesgos SANS, pérdida ósea y cálculos renales, DCS vs. hipoxia, reactivación viral, sensoriomotor), NASA CIPHER, CSA (CANS y Radi-N2 para neutrones; envejecimiento vascular y resistencia a la insulina), NASA-STD-3001. Para RCP en 0g: anclaje al CMRS, métodos Handstand y Evetts-Russomano (guía DGLRM/ESAM-SMG). Usa los datos en vivo del brazalete y la nave que vienen en cada mensaje; cítalos con sus valores. Si algo es una emergencia, dilo primero. Si no sabes algo, dilo. Nunca inventes valores de sensores. Estructura SIEMPRE la respuesta en tres bloques con estos encabezados exactos: [ SÍNTESIS BIOMÉTRICA Y SUEÑO ] (correlaciona HRV, arquitectura del sueño REM/profundo y carga cardiovascular/autonómica), [ TELEMETRÍA NASA DONKI & ECLSS ] (eventos solares, dosis en la zona de blindaje actual, pCO₂ y su efecto en SANS y cognición, citando NASA-STD-3001 y CSA) y [ PLAN DE ACCIÓN CLÍNICO ] (contramedidas numeradas y cuantificadas). Si los datos DONKI son un escenario de referencia, dilo.`;
  // ---------------- síntesis clínica multi-fuente (se añade a TODA respuesta del motor local)
  const agoTxt = (t) => { if (!t) return ''; const h = (Date.now() - Date.parse(t)) / 36e5; return h < 48 ? `hace ${h.toFixed(0)} h` : `hace ${(h / 24).toFixed(0)} d`; };
  const sleepOf = () => (window.ARES_UI && window.ARES_UI.sleepSummary ? window.ARES_UI.sleepSummary() : null);
  function synth(F) {
    const { S, R, H, N } = F, sl = sleepOf(), hrv = S.rmssd, eff = sl ? sl.efficiency : S.sleepEff;
    const gName = H.g < 0.1 ? '0G (microgravedad)' : H.g < 0.2 ? 'LUNA 0.16G' : H.g < 0.5 ? 'MARTE 0.38G' : '1G';
    const bio = [`FC ${fmt(F.bpm)} lpm · SpO₂ ${fmt(S.spo2, 1)} % · HRV ${fmt(hrv)} ms · rigidez ${fmt(S.si, 1)} m/s · glucosa ${fmt(H.glucose)} mg/dL · ARED ${S.reps ?? 0}/15 · temblor MPU6050 ${fmt(S.tremor, 3)} rad/s.`];
    bio.push(sl ? `Sueño: ${fmt(sl.hours, 1)} h · eficiencia ${fmt(sl.efficiency)} % · REM ${fmt(sl.rem)} % · profundo ${fmt(sl.deep)} % · ${fmt(sl.perHour, 1)} despertares/h.` : 'Sueño: sin registro nocturno todavía.');
    let auto;
    if (hrv == null) auto = 'Sin onda de pulso estable: el tono autonómico no se puede evaluar.';
    else if (hrv < 20) auto = `Tono vagal muy bajo (HRV ${fmt(hrv)} ms < 20): carga simpática alta${eff != null && eff < 80 ? `, coherente con la deuda de sueño (${fmt(eff)} %)` : ''}.`;
    else if (hrv < 35) auto = `Tono vagal reducido (HRV ${fmt(hrv)} ms)${eff != null && eff < 85 ? ` con sueño de ${fmt(eff)} %: recuperación autonómica incompleta` : ': estrés moderado'}.`;
    else auto = `Tono vagal adecuado (HRV ${fmt(hrv)} ms)${sl && sl.rem < 18 ? `, aunque el REM (${fmt(sl.rem)} %) está por debajo del 20–25 % esperado` : eff != null && eff >= 85 ? ' con sueño reparador' : ''}.`;
    if (F.bpm != null && F.bpm > 100) auto += ` Taquicardia de ${fmt(F.bpm)} lpm.`;
    if (S.si != null && S.si > 8.5) auto += ` Rigidez arterial ${fmt(S.si, 1)} m/s (> 8.5): envejecimiento vascular acelerado (CSA).`;
    bio.push(auto);
    const fl = N.flr && N.flr.latest ? `fulguración ${N.flr.latest.classType} ${agoTxt(N.flr.latest.peakTime)}` : 'sin fulguraciones registradas';
    const cme = N.cme && N.cme.fastest ? `CME más rápida ${N.cme.fastest.speed} km/s ${agoTxt(N.cme.fastest.time)}` : 'sin CME relevantes';
    const zoneName = (B.ZONES[R.rad.zone] || {}).name || R.rad.zone;
    const nasa = [
      `DONKI${N.reference ? ' (escenario de referencia, sin enlace)' : ''}: ${fl} · ${cme} · SEP 30 d: ${N.sep ? N.sep.count : '—'} · GOES S${N.sLevel}${N.protons && N.protons.now10 != null ? ` (${fmt(N.protons.now10, 1)} pfu ≥10 MeV)` : ''} · Kp ${fmt(N.kpNow, 1)} (G${N.gLevel}).`,
      `Dosis ${fmt(R.eff, 2)} mSv/d en ${zoneName} · multiplicador solar ×${fmt(N.swMult, 2)} (CSA CANS / Radi-N2).`,
      `ECLSS: pCO₂ ${fmt(H.co2, 1)} mmHg${H.co2 > 4 ? ' — supera 4 mmHg: riesgo SANS y deterioro cognitivo (NASA-STD-3001)' : H.co2 > 3 ? ' — cerca del límite de 4 mmHg' : ' — en rango'} · ${fmt(H.psi, 1)} psi · hidratación ${H.hyd} mL${H.hyd < 2000 ? ' (< 2 L: riesgo de cálculo renal)' : ''} · ruido ${H.noise} dB · ${gName}.`,
    ];
    const plan = [];
    if (S.spo2 != null && S.spo2 < 92) plan.push(`O₂ al 100 % por mascarilla hasta SpO₂ ≥ 95 % (ahora ${fmt(S.spo2, 1)} %).`);
    if (H.co2 > 3) plan.push(`Bajar pCO₂ de ${fmt(H.co2, 1)} a < 3 mmHg: depurador de CO₂ al 100 % durante 30–60 min.`);
    if (H.hyd < 2500) plan.push(`Beber ${2500 - H.hyd} mL más hoy (objetivo 2.5 L) con citrato de potasio.`);
    if ((S.reps ?? 0) < 15 && H.g < 0.5) plan.push(`Completar ${15 - (S.reps ?? 0)} sentadillas ARED (carga ósea diaria).`);
    if (eff != null && eff < 85) plan.push(`Sueño: ventana ≥ 8 h, luz 480 nm de día y 630 nm 2 h antes de dormir, ruido < 55 dB (ahora ${H.noise} dB).`);
    if (hrv != null && hrv < 35) plan.push('Respiración resonante a 6 rpm durante 5 min y volver a medir HRV (objetivo > 35 ms).');
    if (N.swActive || N.sLevel > 0 || R.eff > 1.2) plan.push(`Refugio de tormenta (dosis ×0.15) hasta que GOES vuelva a S0 (ahora S${N.sLevel}).`);
    if (H.glucose > 100) plan.push(`Glucosa ${H.glucose} mg/dL: ración de bajo índice glucémico y 20 min de ejercicio aeróbico.`);
    if (!plan.length) plan.push('Sin contramedidas urgentes: mantener la rutina y volver a evaluar en 1 h.');
    const seen = new Set(), acts = [];
    for (const a of active) for (const st of ((ALERTS[a.id] || {}).steps || [])) if (st[1] && !seen.has(st[1]) && acts.length < 4) { seen.add(st[1]); acts.push(st); }
    return { bio: bio.join('\n'), nasa: nasa.join('\n'), plan, acts, sleep: sl };
  }
  function composeLocal(q, F) {
    const a = localAnswer(q, F), d = synth(F);
    const topic = a.text.replace(statusLine(F), '').replace(/\n{3,}/g, '\n\n').trim();
    const text = `[ SÍNTESIS BIOMÉTRICA Y SUEÑO ]\n${d.bio}\n\n[ TELEMETRÍA NASA DONKI & ECLSS ]\n${d.nasa}\n\n[ PLAN DE ACCIÓN CLÍNICO ]\n${topic}\n\nContramedidas cuantificadas:\n${d.plan.map((p, i) => `${i + 1}. ${p}`).join('\n')}`;
    return { text, topic, cite: a.cite, acts: d.acts };
  }

  async function claudeAnswer(q, F) {
    const L = B.evaluate(), ctx = { vitals: { hr: F.bpm, spo2: F.S.spo2, hrv: F.S.rmssd, resp: F.S.resp, stiffness: F.S.si, temp: F.S.temp, tremor: F.S.tremor, reps: F.S.reps, sleep_eff: F.S.sleepEff, rssi: F.S.rssi, contact: F.contact },
      habitat: { gravity: F.H.g, location: B.LOCS[F.H.loc].name, co2_mmHg: F.H.co2, pressure_psi: F.H.psi, noise_dB: F.H.noise, hydration_ml: F.H.hyd, glucose_mgdl: F.H.glucose, sol: F.H.sol },
      radiation: { dose_mSv_day: +F.R.eff.toFixed(3), zone: F.R.rad.zone, goes_S: F.N.sLevel, kp: F.N.kpNow, reasons: F.N.swReasons },
      sleep: (() => { const s = sleepOf(); return s ? { hours: +s.hours.toFixed(1), efficiency: Math.round(s.efficiency), rem_pct: Math.round(s.rem), deep_pct: Math.round(s.deep), awakenings_per_h: +s.perHour.toFixed(1) } : null; })(),
      nasa_donki: { reference_scenario: !!F.N.reference, latest_flare: F.N.flr && F.N.flr.latest ? { class: F.N.flr.latest.classType, peak: F.N.flr.latest.peakTime } : null, fastest_cme_kms: F.N.cme && F.N.cme.fastest ? F.N.cme.fastest.speed : null, sep_30d: F.N.sep ? F.N.sep.count : null, goes_protons_10MeV_pfu: F.N.protons ? F.N.protons.now10 : null, kp_now: F.N.kpNow, noaa_G: F.N.gLevel, dose_multiplier: F.N.swMult },
      organs: Object.fromEntries(Object.entries(L.R.o).map(([k, v]) => [k, v.level])), eva: { score: L.R.score, go: L.R.go, blockers: L.R.blockers }, ai_alerts: active.map((a) => a.id) };
    const history = msgs.filter((m) => m.role === 'user' || m.role === 'assistant').slice(-8, -1).map((m) => ({ role: m.role, content: m.text }));
    if (history.length && history[0].role !== 'user') history.shift();
    const body = { model: 'claude-opus-5-5', max_tokens: 16000, output_config: { effort: 'low' }, fallbacks: 'default', system: SYSTEM,
      messages: [...history, { role: 'user', content: `DATOS EN VIVO (JSON):\n${JSON.stringify(ctx)}\n\nPREGUNTA DEL TRIPULANTE: ${q}` }] };
    let r = null;
    if (location.protocol !== 'file:') { try { r = await fetch('/llm', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Claude-Key': claudeKey() }, body: JSON.stringify(body) }); if (r.status === 404 || r.status === 405) r = null; } catch (e) { r = null; } }
    // sin servidor local (doble clic): llamada directa a la API de Claude desde el navegador
    if (!r) r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': claudeKey(), 'anthropic-version': '2026-10-21', 'anthropic-beta': 'server-side-fallback-2026-07-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ? j.error.message || JSON.stringify(j.error) : `HTTP ${r.status}`);
    if (j.stop_reason === 'refusal') throw new Error('Claude rechazó la consulta');
    const text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (!text) throw new Error('respuesta vacía');
    return { text, model: j.model };
  }

  async function ask(q) {
    openDrawer(); push('user', q);
    const F = read(); if (!F) return;
    if (claudeKey()) {
      const el = push('assistant', 'Consultando a Claude con tus datos en vivo…', 'Claude');
      try { const a = await claudeAnswer(q, F); el.textContent = a.text; const s = document.createElement('span'); s.className = 'src'; s.textContent = `Claude (${a.model}) · con datos en vivo del brazalete y la nave`; el.appendChild(s); addActs(el, synth(F).acts); msgs[msgs.length - 1].text = a.text; speak(a.text.split('\n')[0].slice(0, 220)); return; }
      catch (e) { el.remove(); msgs.pop(); push('assistant', `No pude usar Claude (${e.message}). Respondo con el motor experto local:`, 'aviso'); }
    }
    const a = composeLocal(q, F); push('assistant', a.text, `BIO-ASTRO · motor clínico local · ${a.cite.join(' · ')} · NASA DONKI · NASA-STD-3001`, a.acts); speak(a.topic.split('\n')[0].slice(0, 220));
  }

  /* =================================================================== arranque */
  Engine.subscribe(tick);
  setInterval(() => { if (P.phase === 'countdown') tick(); }, 250);   // cuenta atrás fluida
  window.ARES_AI = { tick, ask, startCountdown, startCodeRed, endCodeRed, state: STATE, P, localAnswer: (q) => localAnswer(q, read()), synth: () => synth(read()), compose: (q) => composeLocal(q, read()), speak };
  window.BioAstroAI = window.ARES_AI;
})();
