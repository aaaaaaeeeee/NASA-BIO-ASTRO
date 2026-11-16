/* =============================================================================
 * BIO-ASTRO OS — núcleo sin dependencias (equipo MIB · NASA Space Apps 2026)
 *  - DSP PPG (MAX30102) en el navegador: BPM, HRV RMSSD, SpO2, PI, Resp, Rigidez (SI), SQI
 *  - DSP IMU (MPU6050): micro-temblor, repeticiones ARED independientes de la gravedad
 *  - Simulador fisiológico que emite EXACTAMENTE el mismo paquete NDJSON que el ESP32-C3
 *  - Web Serial con LineBreakTransformer + reconexión automática + failover a simulador
 *  - Motor de riesgo explicable (NASA HRP / CIPHER / CSA)
 * Este archivo no usa JSX: se puede probar en Node (`node test-dsp.js`).
 * ========================================================================== */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------- utilidades
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
  const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
  const median = (a) => {
    if (!a.length) return NaN;
    const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const randn = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  function pearson(a, b) {
    const n = a.length, ma = mean(Array.from(a)), mb = mean(Array.from(b));
    let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
    return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0;
  }
  function detrend(xs, ys) {
    const mx = mean(xs), my = mean(ys); let num = 0, den = 0;
    for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
    const b = den ? num / den : 0;
    return ys.map((y, i) => y - (my + b * (xs[i] - mx)));
  }

  /** Buffer circular sobre Float32Array (cero asignaciones en el camino caliente). */
  class Ring {
    constructor(n) { this.n = n; this.a = new Float32Array(n); this.i = 0; this.len = 0; }
    push(v) { this.a[this.i] = v; this.i = (this.i + 1) % this.n; if (this.len < this.n) this.len++; }
    /** last(0) = muestra más reciente */
    last(k = 0) { return this.a[(this.i - 1 - k + this.n * 2) % this.n]; }
  }

  // ======================================================= DSP PPG (MAX30102)
  class PPGProcessor {
    constructor(fs = 100) { this.setFs(fs); }
    setFs(fs) { this.fs = fs; this.n = 0; this.reset(); }
    reset() {
      const fs = this.fs;
      this.init = false; this.fingerOk = false; this.fingerSince = this.n;
      this.dcIr = 0; this.dcRed = 0; this.lpIr = 0; this.lpRed = 0;
      this.aDC = 1 / fs;                       // EMA τ≈1 s → línea base (DC)
      this.aLP = clamp(25 / fs, 0.05, 1);      // EMA ≈4 Hz @100 Hz → elimina ruido HF
      this.scopeIr = new Ring(fs * 8); this.scopeRed = new Ring(fs * 8); this.raw = new Ring(fs * 8);
      this.y1 = 0; this.y2 = 0; this.env = 0;
      this.minV = Infinity; this.minN = this.n;
      this.lastPeakN = -1e9; this.lastPeakT = null;
      this.ibis = []; this.ibiOk = []; this.beats = []; this.feet = []; this.beatMarks = [];
      this.templates = []; this.template = null; this.templateDur = 0; this.templateD = 0; this.sqiHist = [];
      this.lastBeatWall = 0;
      this.nl = { M: 8, u: [new Float32Array(8), new Float32Array(8), new Float32Array(8)], wI: new Float32Array(24), wR: new Float32Array(24) };
      this.ancRemoved = 0;
    }
    /** Ingresa una muestra cruda (cuentas ADC 18 bit). */
    push(ir, red, fingerThr, mref) {
      const n = this.n++;
      this.lastIr = ir;
      // Contacto óptico con histéresis (entra > umbral, sale < 80 % del umbral) → sin parpadeo
      let finger = this.fingerOk ? ir > fingerThr * 0.8 : ir > fingerThr;
      // Caída brusca (> 40 % bajo la línea base): el dedo se retiró aunque el reflejo siga sobre el umbral
      const dropped = this.fingerOk && this.init && n - this.fingerSince > this.fs * 2 && (ir < this.dcIr * 0.4 || ir > this.dcIr * 1.8); // o salto brusco (objeto → dedo)
      if (finger !== this.fingerOk || dropped) { this.reset(); this.fingerOk = finger; this.fingerSince = n; }
      if (!this.init) { this.dcIr = ir; this.dcRed = red; this.init = true; }
      this.dcIr += (ir - this.dcIr) * this.aDC;
      this.dcRed += (red - this.dcRed) * this.aDC;
      // Más sangre = más absorción = menos luz reflejada → invertimos para que el pulso suba.
      let acI = -(ir - this.dcIr), acR = -(red - this.dcRed);
      // Cancelación adaptativa de artefactos (NLMS): la aceleración del MPU6050 es la referencia de ruido.
      // Solo adapta y resta mientras hay movimiento; en reposo la señal óptica pasa intacta.
      if (mref) {
        const nl = this.nl, M = nl.M;
        for (let a = 0; a < 3; a++) { const b = nl.u[a]; b.copyWithin(1, 0, M - 1); b[0] = mref.hp[a]; }
        if (mref.active) {
          let eI = 0, eR = 0, pw = 1e-4;
          for (let a = 0; a < 3; a++) for (let k = 0; k < M; k++) { const u = nl.u[a][k], j = a * M + k; eI += nl.wI[j] * u; eR += nl.wR[j] * u; pw += u * u; }
          const cI = acI - eI, cR = acR - eR, mu = (nl.mu || 0.003) / pw; // paso pequeño: el latido no "contamina" los pesos
          for (let a = 0; a < 3; a++) for (let k = 0; k < M; k++) { const u = nl.u[a][k], j = a * M + k; nl.wI[j] += mu * cI * u; nl.wR[j] += mu * cR * u; }
          this.ancRemoved += (Math.abs(eI) - this.ancRemoved) * 0.02; // magnitud del artefacto retirado (cuentas)
          acI = cI; acR = cR;
        } else this.ancRemoved *= 0.98;
      }
      this.lpIr += (acI - this.lpIr) * this.aLP;
      this.lpRed += (acR - this.lpRed) * this.aLP;
      const y = this.lpIr;
      this.scopeIr.push(y); this.scopeRed.push(this.lpRed); this.raw.push(ir);
      if (!finger) { this.y2 = this.y1; this.y1 = y; return; }

      const settled = n - this.fingerSince > this.fs * 1.5;
      if (y < this.minV) { this.minV = y; this.minN = n; }
      this.env *= Math.pow(0.5, 1 / (this.fs * 3)); // umbral adaptativo, vida media 3 s
      const isPeak = this.y1 > this.y2 && this.y1 >= y;
      if (isPeak) {
        const pv = this.y1, pn = n - 1, amp = pv - this.minV;
        if (!settled) { this.env = Math.max(this.env, amp); }
        else {
          const lastIbiS = this.ibis.length ? (this.ibis[this.ibis.length - 1] * this.fs) / 1000 : this.fs * 0.6;
          const refractory = Math.max(this.fs * 0.3, 0.5 * lastIbiS); // evita contar la onda dicrótica
          if (amp > 0.5 * this.env && pn - this.lastPeakN > refractory) {
            // Interpolación parabólica → resolución sub-muestra (crítico para HRV)
            const den = this.y2 - 2 * pv + y;
            const off = den !== 0 ? clamp((0.5 * (this.y2 - y)) / den, -0.5, 0.5) : 0;
            const tPeak = ((pn + off) * 1000) / this.fs;
            this.env = this.env === 0 ? amp : 0.75 * this.env + 0.25 * amp;
            if (this.lastPeakT !== null) {
              const ibi = tPeak - this.lastPeakT;
              if (ibi > 270 && ibi < 2200) {
                const med = median(this.ibis.slice(-8));
                const ok = !(this.ibis.length >= 4 && Math.abs(ibi - med) > 0.3 * med); // rechazo de artefactos
                this.ibis.push(ibi); this.ibiOk.push(ok);
                if (this.ibis.length > 60) { this.ibis.shift(); this.ibiOk.shift(); }
              }
            }
            this.lastPeakT = tPeak; this.lastPeakN = pn;
            this.beatMarks.push(pn); if (this.beatMarks.length > 24) this.beatMarks.shift();
            // Pie = mínimo local justo antes del ascenso sistólico (no el mínimo global: la deriva respiratoria lo desplaza)
            const back = Math.round(Math.min(this.fs * 0.3, 0.6 * lastIbiS));
            let footN = pn, fv = Infinity;
            for (let j = pn; j >= pn - back && n - j < this.scopeIr.len; j--) { const v = this.scopeIr.last(n - j); if (v < fv) { fv = v; footN = j; } }
            const kFoot = n - footN;
            const base = kFoot < this.raw.len ? this.raw.last(kFoot) : this.dcIr;
            this.beats.push({ t: tPeak, amp: pv - fv, base });
            if (this.beats.length > 90) this.beats.shift();
            const prevFoot = this.feet.length ? this.feet[this.feet.length - 1] : null;
            this.feet.push(footN); if (this.feet.length > 24) this.feet.shift();
            if (prevFoot !== null) this._addBeat(prevFoot, footN, n);
            this.minV = Infinity;
            this.lastBeatWall = nowMs();
          }
        }
      }
      this.y2 = this.y1; this.y1 = y;
    }
    /** Promedio por conjunto (ensemble averaging) alineado al pie, en eje de tiempo FIJO
     *  (la onda reflejada llega a ΔT constante del pie, no a una fracción del IBI). */
    _addBeat(a, b, n) {
      const L = b - a;
      if (L < this.fs * 0.27 || L > this.fs * 2.2 || n - a >= this.scopeIr.len) return;
      const medIbiS = (median(this.ibis.slice(-8)) * this.fs) / 1000 || L;
      const D = Math.max(this.fs * 0.25, Math.round(0.85 * medIbiS)); // ventana común para todos los latidos
      if (this.templateD && Math.abs(D - this.templateD) > 0.1 * this.templateD) { this.templates = []; this.template = null; }
      this.templateD = this.templateD && this.templates.length ? this.templateD : D;
      const W = Math.min(this.templateD, L);
      if (W < this.templateD * 0.9) return; // latido más corto que la ventana (extrasístole) → descartar
      const v = (j) => this.scopeIr.last(n - (a + j));
      const va = v(0), vb = v(L);
      const N = 64, rs = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const x = (i * (W - 1)) / (N - 1), i0 = Math.floor(x), f = x - i0;
        const raw = v(i0) * (1 - f) + v(Math.min(i0 + 1, L)) * f;
        rs[i] = raw - (va + ((vb - va) * x) / L); // elimina la deriva respiratoria pie-a-pie
      }
      let mn = Infinity, mx = -Infinity;
      for (const v of rs) { if (v < mn) mn = v; if (v > mx) mx = v; }
      const r = mx - mn || 1;
      for (let i = 0; i < N; i++) rs[i] = (rs[i] - mn) / r;
      if (this.template) { this.sqiHist.push(pearson(rs, this.template)); if (this.sqiHist.length > 8) this.sqiHist.shift(); }
      this.templates.push({ rs, dur: ((W - 1) * 1000) / this.fs });
      if (this.templates.length > 8) this.templates.shift();
      const T = new Float32Array(N);
      for (const t of this.templates) for (let i = 0; i < N; i++) T[i] += t.rs[i] / this.templates.length;
      this.template = T; this.templateDur = mean(this.templates.map((t) => t.dur));
    }
    /** Estado del dedo: contacto óptico Y pulso arterial real.
     *  'none' sin contacto · 'verifying' contacto reciente, buscando latidos
     *  'ok' dedo con pulso · 'nopulse' algo refleja luz pero no late (mesa, tela, dedo mal puesto) */
    contactState() {
      if (!this.fingerOk) return 'none';
      const sinceS = (this.n - this.fingerSince) / this.fs;
      const beatAge = nowMs() - this.lastBeatWall;
      const recent = this.beats.slice(-6);
      const pi = recent.length >= 3 && this.dcIr ? (median(recent.map((b) => b.amp)) / this.dcIr) * 100 : null;
      const perfused = pi == null || (pi > 0.05 && pi < 25);
      if (this.ibis.length >= 2 && beatAge < 2500 && perfused) return 'ok';
      return sinceS < 10 ? "verifying" : "nopulse";
    }
    isFinger() { return this.contactState() === 'ok'; }
    metrics() {
      const state = this.contactState();
      const m = { finger: state === 'ok', contact: state };
      if (state !== 'ok') return m;
      const fresh = nowMs() - this.lastBeatWall < 3000;
      if (this.ibis.length >= 3 && fresh) m.bpm = 60000 / median(this.ibis.slice(-10));
      const d = [];
      for (let i = Math.max(1, this.ibis.length - 30); i < this.ibis.length; i++)
        if (this.ibiOk[i] && this.ibiOk[i - 1]) d.push(this.ibis[i] - this.ibis[i - 1]);
      if (d.length >= 5 && fresh) m.rmssd = Math.sqrt(mean(d.map((x) => x * x)));
      // SpO2 por Ratio of Ratios sobre ventana de 4 s
      const W = Math.min(this.scopeIr.len, this.fs * 4);
      if (W > this.fs * 2 && fresh) {
        let sI = 0, sR = 0;
        for (let k = 0; k < W; k++) { const a = this.scopeIr.last(k), b = this.scopeRed.last(k); sI += a * a; sR += b * b; }
        const R = (Math.sqrt(sR / W) / this.dcRed) / (Math.sqrt(sI / W) / this.dcIr);
        m.R = R; m.spo2 = clamp(110 - 25 * R, 70, 100); // calibración empírica clásica (Maxim AN6409)
      }
      const recent = this.beats.slice(-8);
      if (recent.length >= 3 && fresh) m.pi = (median(recent.map((b) => b.amp)) / this.dcIr) * 100;
      // Frecuencia respiratoria: modulación de la línea base latido a latido (RIIV)
      const tNow = (this.n * 1000) / this.fs;
      const bs = this.beats.filter((b) => tNow - b.t < 32000);
      if (bs.length >= 12 && (bs[bs.length - 1].t - bs[0].t) / 1000 > 15 && fresh) {
        const xs = bs.map((b) => b.t), res = detrend(xs, bs.map((b) => b.base)), h = 0.3 * std(res);
        let state = 0; const ups = [];
        for (let i = 0; i < res.length; i++) {
          if (state <= 0 && res[i] > h) { if (state === -1) ups.push(xs[i]); state = 1; }
          else if (state >= 0 && res[i] < -h) state = -1;
        }
        if (ups.length >= 3) m.resp = ((ups.length - 1) * 60000) / (ups[ups.length - 1] - ups[0]);
      }
      // Rigidez arterial: Stiffness Index SI = altura / ΔT(sistólico→diastólico)  [Millasseau 2002]
      if (this.template && this.templates.length >= 4 && fresh) {
        const T = this.template, N = T.length; let s = 0;
        for (let i = 1; i < N; i++) if (T[i] > T[s]) s = i;
        const d1 = (i) => T[i + 1] - T[i - 1];
        const end = Math.floor(N * 0.85); let di = -1;
        for (let i = s + 3; i < end; i++) if (d1(i - 1) > 0 && d1(i) <= 0) { di = i; break; }  // pico diastólico
        if (di < 0) for (let i = s + 3; i < end; i++)                                           // o "hombro" (inflexión)
          if (d1(i) > d1(i - 1) && d1(i) >= d1(i + 1) && T[i] > 0.15) { di = i; break; }
        if (di > 0) {
          const dT = ((di - s) / (N - 1)) * this.templateDur;
          m.si = clamp(1.75 / (dT / 1000), 3, 20);
          m.ri = T[di]; m.notch = di; m.sysIdx = s;
        }
      }
      if (this.sqiHist.length) m.sqi = clamp(mean(this.sqiHist), 0, 1);
      return m;
    }
  }

  // =========================================================== DSP IMU (MPU6050)
  class IMUProcessor {
    constructor(fs = 50) { this.fs = fs; this.reset(); }
    setFs(fs) { if (fs !== this.fs) { this.fs = fs; this.reset(); } }
    reset() {
      this.n = 0; this.reps = 0; this.state = 0; this.lastRepT = -1e9;
      this.aEma = null; this.aVar = [0, 0, 0]; this.sig = 0; this.gEma = [0, 0, 0];
      this.trem = new Ring(Math.round(this.fs * 2)); this.scope = new Ring(Math.round(this.fs * 8));
      this.act = new Ring(Math.round(this.fs * 5));
    }
    /** r = [ax,ay,az (g), gx,gy,gz (rad/s)] */
    push(r) {
      const t = (this.n++ * 1000) / this.fs;
      const a = [r[0], r[1], r[2]];
      if (!this.aEma) this.aEma = a.slice();
      const kG = 1 / (this.fs * 2), kV = 1 / (this.fs * 3);
      const hp = [0, 0, 0];
      for (let i = 0; i < 3; i++) {
        this.aEma[i] += (a[i] - this.aEma[i]) * kG;           // gravedad estática por eje (0g, 0.16g, 0.38g, 1g)
        hp[i] = a[i] - this.aEma[i];
        this.aVar[i] += (hp[i] * hp[i] - this.aVar[i]) * kV;
      }
      // Eje dominante de movimiento (no asume que Z = vertical: en 0g no hay "abajo")
      let k = 0; for (let i = 1; i < 3; i++) if (this.aVar[i] > this.aVar[k]) k = i;
      this.sig += (hp[k] - this.sig) * 0.3;
      this.scope.push(this.sig); this.act.push(Math.hypot(hp[0], hp[1], hp[2]));
      const th = 0.12;
      if (this.state >= 0 && this.sig < -th) this.state = -1;
      else if (this.state === -1 && this.sig > th && t - this.lastRepT > 800) { this.reps++; this.lastRepT = t; this.state = 1; }
      let s = 0;
      for (let i = 0; i < 3; i++) { this.gEma[i] += (r[3 + i] - this.gEma[i]) * 0.25; const h = r[3 + i] - this.gEma[i]; s += h * h; }
      this.trem.push(Math.sqrt(s)); // energía > ~2 Hz (temblor fisiológico 4–12 Hz)
    }
    metrics() {
      if (this.n < this.fs) return {};
      let s = 0; for (let i = 0; i < this.trem.len; i++) s += this.trem.last(i) ** 2;
      let a = 0; for (let i = 0; i < this.act.len; i++) a += this.act.last(i) ** 2;
      return { tremor: Math.sqrt(s / this.trem.len), reps: this.reps, activity: Math.sqrt(a / this.act.len) };
    }
  }

  // ================================================ Geolocalización indoor RSSI
  const ZONES = {
    shelter: { id: 'shelter', name: 'Refugio antitormentas (blindaje de agua)', short: 'REFUGIO H₂O', mult: 0.15, rssi: -44 },
    module: { id: 'module', name: 'Módulo habitable estándar', short: 'MÓDULO HAB', mult: 1.0, rssi: -60 },
    dome: { id: 'dome', name: 'Cúpula / esclusa EVA (sin blindaje pesado)', short: 'CÚPULA / EVA', mult: 2.5, rssi: -78 },
  };
  /** Zona con histéresis de 3 dB sobre la mediana de 9 lecturas (el RSSI corporal fluctúa ±6 dB). */
  function zoneFor(r, cur) {
    const raw = r > -50 ? 'shelter' : r > -70 ? 'module' : 'dome';
    if (!cur || raw === cur) return raw;
    if (cur === 'shelter' && r > -53) return cur;
    if (cur === 'module' && r <= -47 && r >= -73) return cur;
    if (cur === 'dome' && r < -67) return cur;
    return raw;
  }

  // ================================================== Simulador fisiológico
  class Simulator {
    constructor() {
      this.fs = 100; this.t = 0; this.beatT = 0; this.T = 0.88; this.prevT = 0.88; this.respPh = 0;
      this.p = { hr: 68, rmssd: 50, spo2: 98, pi: 3.5, resp: 14, si: 7, temp: 36.6, tremor: 0.02 };
      this.tg = { ...this.p };
      this.finger = true; this.g = 0; this.rssiBase = -60; this.ared = 0; this.aredPh = 0;
      this.imuDiv = 0; this.lastTemp = -9; this.lastRssi = -9; this.dcIr = 118000; this.dcRed = 94000;
      // Cinemática de la muñeca (para el subsistema inercial MPU6050)
      this.aredPeriod = 1.6; this.aredAmp = 0.38;
      this.pitchDeg = 8; this.rollDeg = -5; this.swayDeg = 0.35; this.driftRate = 0; // °/s (ataxia en test de Romberg)
      this.tremorHz = 9; this.fallT = -99; this.prevP = null; this.prevR = null;
    }
    setTargets(tg) { Object.assign(this.tg, tg); }
    /** n repeticiones; opts.period (s/rep) y opts.amp (g dinámicos) permiten simular series "sin carga". */
    startAred(n, opts = {}) { this.ared = n; this.aredPh = 0; this.aredPeriod = opts.period || 1.6; this.aredAmp = opts.amp || 0.38; }
    triggerFall() { this.fallT = this.t; this.ared = 0; }
    step() {
      const dt = 1 / this.fs; this.t += dt;
      const k = dt / 4; // los parámetros convergen con τ≈4 s (sin saltos irreales)
      for (const key in this.tg) this.p[key] += (this.tg[key] - this.p[key]) * k;
      const p = this.p;
      this.respPh += (dt * p.resp / 60) * 2 * Math.PI;
      const resp = Math.sin(this.respPh);
      this.beatT += dt;
      if (this.beatT >= this.T) {
        this.beatT -= this.T; this.prevT = this.T;
        const sd = p.rmssd / 1000 / Math.SQRT2; // IBI iid con σ → RMSSD = σ·√2
        this.T = clamp((60 / p.hr) * (1 - 0.01 * resp) + sd * randn(), 0.3, 2.0);
      }
      // Morfología: onda sistólica + onda reflejada. Arteria rígida → reflexión precoz → muesca dicrótica desaparece
      const dT = 1.75 / p.si, refl = clamp(0.3 + 0.045 * (p.si - 5), 0.25, 0.8);
      const pulse = (tau) => {
        const w = tau < 0.13 ? 0.045 : 0.08;
        return Math.exp(-(((tau - 0.13) / w) ** 2)) + refl * Math.exp(-(((tau - 0.13 - dT) / 0.085) ** 2));
      };
      const pv = pulse(this.beatT) + pulse(this.beatT + this.prevT);
      // ARED: sentadillas a 1.6 s/rep (aceleración ∝ cos de la fase)
      let mz = 0, motion = 0;
      if (this.ared > 0) {
        const prev = this.aredPh; this.aredPh += (dt * 2 * Math.PI) / this.aredPeriod;
        mz = this.aredAmp * Math.cos(this.aredPh);
        // Artefacto cinético en el PPG: copia retardada de la aceleración (lo que el filtro adaptativo puede cancelar)
        motion = 1.7 * this.aredAmp * Math.cos(this.aredPh - 0.35);
        if (Math.floor(this.aredPh / (2 * Math.PI)) > Math.floor(prev / (2 * Math.PI))) this.ared--;
      }
      const ac = p.pi / 100, R = (110 - p.spo2) / 25;
      const mod = (1 + 0.1 * resp) * pv + 0.3 * resp + 0.1 * Math.sin(this.t * 0.44) + motion;
      let ir, red;
      if (this.finger && this.object) { // objeto que refleja luz pero no late (mesa, tela)
        ir = 92000 + randn() * 60; red = 70000 + randn() * 60;
      } else if (this.finger) {
        ir = this.dcIr * (1 - ac * mod) + randn() * 22;
        red = this.dcRed * (1 - ac * R * mod) + randn() * 22;
      } else { ir = 2600 + randn() * 300; red = 2100 + randn() * 300; }
      let imu = null;
      if (++this.imuDiv >= 2) {
        this.imuDiv = 0;
        const dtI = 2 * dt, sinceFall = this.t - this.fallT, frozen = sinceFall >= 0.08 && sinceFall < 8; // tras el impacto: inmóvil
        this.pitchDeg += this.driftRate * dtI;
        const sway = frozen ? 0 : this.swayDeg * Math.sin(2 * Math.PI * 0.21 * this.t) * (1 + 4 * Math.min(1, Math.abs(this.driftRate)));
        const P = ((this.pitchDeg + sway) * Math.PI) / 180, Rr = ((this.rollDeg + 0.6 * sway) * Math.PI) / 180;
        const gyP = this.prevP == null ? 0 : (P - this.prevP) / dtI, gxR = this.prevR == null ? 0 : (Rr - this.prevR) / dtI;
        this.prevP = P; this.prevR = Rr;
        const up = [-Math.sin(P), Math.sin(Rr) * Math.cos(P), Math.cos(Rr) * Math.cos(P)]; // dirección "arriba" en ejes del sensor
        let along = this.g + mz;
        if (sinceFall >= 0 && sinceFall < 0.08) along += 4.4;                              // impacto > 3.5 g
        const A = frozen ? 0 : (p.tremor * Math.SQRT2) / Math.sqrt(3), w = 2 * Math.PI * this.tremorHz * this.t;
        imu = [
          up[0] * along + 0.006 * randn(), up[1] * along + 0.006 * randn(), up[2] * along + 0.006 * randn(),
          gxR + A * Math.sin(w) + 0.002 * randn(), gyP + A * Math.sin(w + 2) + 0.002 * randn(), A * Math.sin(w + 4) + 0.002 * randn(),
        ];
      }
      return { ir, red, imu };
    }
    /** Mismo formato que el firmware ESP32-C3 (protocolo v2, ver ares_wristband.ino). */
    packet(n = 8) {
      const ir = [], red = [], imu = [];
      for (let i = 0; i < n; i++) {
        const s = this.step();
        ir.push(Math.round(s.ir)); red.push(Math.round(s.red)); if (s.imu) imu.push(s.imu.map((v) => +v.toFixed(4)));
      }
      const pk = { v: 2, fs: this.fs, imu_fs: 50, ir, red, imu };
      if (this.t - this.lastTemp >= 1) { this.lastTemp = this.t; pk.temp = +(this.p.temp + randn() * 0.02).toFixed(2); }
      if (this.t - this.lastRssi >= 0.25) { this.lastRssi = this.t; pk.rssi = Math.round(this.rssiBase + randn() * 3); }
      return pk;
    }
  }

  // ======================================== Escenarios clínicos para la demo
  const SCENARIOS = [
    { id: 'nominal', name: '1 · Nominal', desc: 'Tripulante estable en módulo habitable. Línea base de referencia.',
      hab: { psi: 14.7, fO2: 0.21, co2: 2.0, rad: 0.5, noise: 55, glucose: 92, hyd: 3.0 },
      base: { hr: 64, rmssd: 55, spo2: 98.4, pi: 3.6, resp: 13, si: 6.6, temp: 36.6, tremor: 0.015 }, zone: 'module', g: 0, sols: 180, sol: 90, reps: 48 },
    { id: 'co2', name: '2 · Fuga de CO₂ + SANS', desc: 'Falla del CDRA: pCO₂ en ascenso + desplazamiento cefálico de fluidos en 0g.',
      hab: { psi: 14.7, fO2: 0.21, co2: 7.2, rad: 0.5, noise: 63, glucose: 96, hyd: 2.6 },
      base: { hr: 68, rmssd: 46, spo2: 97.8, pi: 3.0, resp: 14, si: 7.2, temp: 36.8, tremor: 0.03 }, zone: 'module', g: 0, sols: 180, sol: 150, reps: 40 },
    { id: 'eva', name: '3 · Despresurización / Hipoxia', desc: 'Pérdida de presión de cabina en esclusa: hipoxia hipobárica + riesgo de DCS.',
      hab: { psi: 5.2, fO2: 0.21, co2: 3.0, rad: 0.8, noise: 72, glucose: 101, hyd: 2.5 },
      base: { hr: 76, rmssd: 38, spo2: 98.0, pi: 2.4, resp: 16, si: 7.0, temp: 36.5, tremor: 0.07 }, zone: 'dome', g: 0, sols: 180, sol: 120, reps: 52 },
    { id: 'spe', name: '4 · Tormenta solar en cúpula', desc: 'Evento de partículas solares (SPE) con el tripulante en la cúpula sin blindaje.',
      hab: { psi: 14.7, fO2: 0.21, co2: 2.6, rad: 6.0, noise: 58, glucose: 94, hyd: 2.8 },
      base: { hr: 74, rmssd: 36, spo2: 98.0, pi: 3.2, resp: 15, si: 7.0, temp: 37.0, tremor: 0.03 }, zone: 'dome', g: 0, sols: 850, sol: 180, reps: 50 },
    { id: 'renal', name: '5 · Cascada renal · Sol 420', desc: 'Marte (0.38g): baja adherencia ARED + deshidratación → hipercalciuria / litiasis.',
      hab: { psi: 10.2, fO2: 0.26, co2: 3.4, rad: 0.7, noise: 60, glucose: 118, hyd: 1.6 },
      base: { hr: 78, rmssd: 29, spo2: 97.0, pi: 2.2, resp: 16, si: 9.6, temp: 37.35, tremor: 0.03 }, zone: 'module', g: 0.38, sols: 850, sol: 420, reps: 6 },
  ];

  /** Respuesta fisiológica del simulador al hábitat (lo que los jueces mueven en vivo). */
  function physioTargets(ctx, aredActive) {
    const { base, hab, zone } = ctx; const t = { ...base };
    const co2x = Math.max(0, hab.co2 - 3);
    t.hr += 2.2 * co2x; t.resp += 1.1 * co2x; t.rmssd -= 3 * co2x;
    const ppO2 = hab.psi * 51.715 * hab.fO2, deficit = Math.max(0, 110 - ppO2);
    t.spo2 -= deficit * 0.24; t.hr += deficit * 0.45; t.resp += deficit * 0.08; t.rmssd -= deficit * 0.25; t.pi -= deficit * 0.02;
    if (hab.noise > 65) { t.rmssd -= (hab.noise - 65) * 0.8; t.hr += (hab.noise - 65) * 0.3; }
    const eff = hab.rad * (ZONES[zone] || ZONES.module).mult;
    t.hr += Math.min(10, eff * 1.2); t.rmssd -= Math.min(12, eff * 1.5);
    if (hab.glucose > 100) t.si += (hab.glucose - 100) * 0.04;
    if (hab.hyd < 2.5) t.hr += (2.5 - hab.hyd) * 6;
    if (aredActive) { t.hr += 28; t.rmssd -= 15; }
    t.hr = clamp(t.hr, 40, 175); t.rmssd = clamp(t.rmssd, 8, 120); t.spo2 = clamp(t.spo2, 72, 99.5);
    t.resp = clamp(t.resp, 7, 34); t.pi = clamp(t.pi, 0.4, 8); t.si = clamp(t.si, 4.5, 14);
    return t;
  }

  // ============================================== Motor de riesgo explicable
  const ppO2Of = (hab) => hab.psi * 51.715 * hab.fO2;
  function assess(s, hab, ctx) {
    // ctx: { sols, sol, g, zone, prebreath, led, reps, gChangedAt, onsd, mode }
    const mf = ctx.sols >= 850 ? 1 : ctx.sols >= 180 ? 0.55 : 0.2; // re-ponderación CIPHER por duración
    const zone = ZONES[ctx.zone] || ZONES.module;
    const effRad = hab.rad * zone.mult, ppO2 = ppO2Of(hab);
    const risks = [];
    const add = (id, name, score, factors, src, layer) =>
      risks.push({ id, name, score: Math.round(clamp(score, 0, 100)), factors, src, layer });
    const has = (v) => v != null && Number.isFinite(v);
    { // SANS
      let sc = 0; const f = []; const c = clamp((hab.co2 - 2.5) / 4.5, 0, 1) * 50;
      if (c > 4) f.push(`pCO₂ ${hab.co2.toFixed(1)} mmHg → vasodilatación cerebral`); sc += c;
      if (ctx.g < 0.1) { sc += 20; f.push('0g: desplazamiento cefálico de fluidos'); } else if (ctx.g < 0.5) { sc += 8; f.push(`${ctx.g}g: carga hidrostática reducida`); }
      sc += mf * 15; if (mf >= 0.55) f.push(`Exposición acumulada Sol ${ctx.sol}`);
      if (ctx.onsd > 5.8) { sc += 25; f.push(`ONSD ${ctx.onsd} mm > 5.8 mm`); }
      add('sans', 'SANS · Neuro-ocular', sc, f, ['hrp-sans', 'hazards'], 'neuro');
    }
    { // Hipoxia
      let sc = 0; const f = [];
      if (has(s.spo2) && s.spo2 < 95) { sc += (95 - s.spo2) * 9; f.push(`SpO₂ ${s.spo2.toFixed(1)} %`); }
      if (ppO2 < 120) { sc += (120 - ppO2) * 0.35; f.push(`ppO₂ inspirado ${ppO2.toFixed(0)} mmHg`); }
      if (has(s.bpm) && s.bpm > 100 && sc > 0) { sc += Math.min(15, s.bpm - 100); f.push(`Taquicardia compensatoria ${Math.round(s.bpm)} lpm`); }
      add('hypoxia', 'Hipoxia hipobárica', sc, f, ['hrp-hypoxia', 'hazards'], 'cardio');
    }
    { // DCS
      let sc = 0; const f = [];
      if (hab.psi < 10.2 && !ctx.prebreath) {
        sc = 35 + (10.2 - hab.psi) * 7; f.push(`Cabina ${hab.psi.toFixed(1)} psi sin pre-respiración de O₂`);
        if (has(s.spo2) && s.spo2 >= 94) f.push('SpO₂ conservada → patrón de DCS, no de hipoxia');
      }
      add('dcs', 'Descompresión (DCS)', sc, f, ['hrp-dcs'], 'msk');
    }
    { // Radiación
      const proj = effRad * ctx.sols; const f = [];
      const sc = clamp(effRad / 5, 0, 1) * 60 + clamp(proj / 600, 0, 1) * 40;
      f.push(`${effRad.toFixed(2)} mSv/día efectivos (${zone.short} ×${zone.mult})`);
      f.push(`~30 % neutrones secundarios ≈ ${(effRad * 0.3).toFixed(2)} mSv/día`);
      f.push(`Proyección misión ${proj.toFixed(0)} / 600 mSv (límite de carrera NASA)`);
      add('rad', 'Radiación espacial', sc, f, ['hrp-rad', 'csa-rad', 'hazards'], 'immune');
    }
    { // Cascada hueso-riñón
      const months = ctx.sol / 30.4, aredF = clamp(ctx.reps / 60, 0, 1);
      const bone = 1.5 * months * (1 - ctx.g) * (1 - 0.6 * aredF);
      let sc = clamp(bone / 12, 0, 1) * 45; const f = [`Pérdida ósea estimada ${bone.toFixed(1)} % (fémur/columna)`];
      if (hab.hyd < 2.5) { sc += (2.5 - hab.hyd) * 25; f.push(`Hidratación ${hab.hyd.toFixed(1)} L/día < 2.5`); }
      if (aredF < 0.5) { sc += 15; f.push(`ARED ${ctx.reps}/60 reps hoy`); }
      add('renal', 'Cascada hueso → riñón', sc, f, ['hrp-renal', 'hazards'], 'msk');
    }
    { // Reactivación viral
      let sc = mf * 10; const f = [];
      if (has(s.rmssd) && s.rmssd < 35) { sc += (35 - s.rmssd) * 1.6; f.push(`HRV ${s.rmssd.toFixed(0)} ms → estrés autonómico`); }
      if (has(s.temp) && s.temp > 37.1) { sc += (s.temp - 37.1) * 70; f.push(`T periférica ${s.temp.toFixed(2)} °C`); }
      if (effRad > 1) { sc += 10; f.push('Radiación → inmunosupresión'); }
      add('viral', 'Reactivación viral (VZV/EBV)', sc, f, ['hrp-immune'], 'immune');
    }
    { // Envejecimiento vascular (CSA)
      let sc = mf * 12; const f = [];
      if (has(s.si) && s.si > 8) { sc += (s.si - 8) * 15; f.push(`SI ${s.si.toFixed(1)} m/s → rigidez arterial`); }
      if (hab.glucose > 100) { sc += (hab.glucose - 100) * 0.9; f.push(`Glucosa ${hab.glucose} mg/dL → resistencia a insulina`); }
      add('vasc', 'Envejecimiento vascular', sc, f, ['csa-vasc'], 'metab');
    }
    { // Conductual / aislamiento
      let sc = mf * 10; const f = [];
      if (has(s.rmssd) && s.rmssd < 40) { sc += (40 - s.rmssd); f.push('Tono vagal reducido'); }
      if (hab.noise > 60) { sc += (hab.noise - 60) * 2; f.push(`Ruido ${hab.noise} dB`); }
      if (ctx.sols >= 850) { sc += 12; f.push('Latencia Tierra hasta 22 min (autonomía)'); }
      if (!ctx.led && mf >= 0.55) { sc += 8; f.push('Sin higiene lumínica circadiana'); }
      add('behav', 'Aislamiento / circadiano', sc, f, ['hrp-bmed', 'cipher'], 'neuro');
    }
    { // Vestibular
      let sc = 0; const f = [];
      if (has(s.tremor) && s.tremor > 0.04) { sc += (s.tremor - 0.04) * 600; f.push(`Micro-temblor ${s.tremor.toFixed(3)} rad/s`); }
      if (ctx.gChangedAt && Date.now() - ctx.gChangedAt < 90000) { sc += 30; f.push('Transición gravitatoria reciente'); }
      add('vestib', 'Sensoriomotor / vestibular', sc, f, ['hrp-sensorimotor'], 'neuro');
    }
    risks.sort((a, b) => b.score - a.score);
    const top = risks.map((r) => r.score);
    let readiness = 100 - (0.55 * top[0] + 0.25 * top[1] + 0.12 * top[2]);
    const blockers = [];
    if (!s.finger) blockers.push('Sin señal óptica: datos insuficientes para certificar');
    if (has(s.spo2) && s.spo2 < 90) blockers.push(`SpO₂ ${s.spo2.toFixed(1)} % < 90 %`);
    if (has(s.bpm) && s.bpm > 130) blockers.push(`FC ${Math.round(s.bpm)} lpm > 130`);
    if (effRad > 5) blockers.push(`Dosis ${effRad.toFixed(1)} mSv/día: refugio obligatorio`);
    if (risks.find((r) => r.id === 'dcs').score >= 60) blockers.push('Riesgo DCS ≥ 60: completar pre-respiración');
    readiness = Math.round(clamp(readiness, 0, 100));
    return { risks, readiness, go: readiness >= 70 && !blockers.length, blockers, effRad, ppO2, zone };
  }

  function countermeasures(a, hab, ctx) {
    const r = Object.fromEntries(a.risks.map((x) => [x.id, x.score])); const out = [];
    const cm = (id, label, why, risk) => out.push({ id, label, why, risk });
    if (r.hypoxia > 25 && hab.fO2 < 0.99) cm('o2', 'Mascarilla O₂ 100 % (ppO₂ ↑)', 'Corrige hipoxia hipobárica', 'hypoxia');
    if (r.dcs > 0) cm('prebreath', 'Pre-respiración O₂ + represurizar a 10.2 psi', 'Desnitrogenación tisular', 'dcs');
    if (hab.co2 > 4) cm('scrub', 'Activar CDRA / cartucho LiOH (pCO₂ → 2 mmHg)', 'Reduce vasodilatación cerebral', 'sans');
    if (a.effRad > 1.5 && ctx.zone !== 'shelter') cm('shelter', 'Trasladarse al refugio de agua (RSSI > −50 dBm)', 'Blindaje ×0.15', 'rad');
    if (hab.hyd < 2.5) cm('hydrate', 'Beber 500 mL + citrato de potasio', 'Previene hipercalciuria / litiasis', 'renal');
    if (ctx.reps < 60) cm('ared', 'Completar 12 reps ARED (detectadas por MPU6050)', 'Carga ósea axial', 'renal');
    if (!ctx.led && (r.behav > 30 || r.viral > 30)) cm('led', 'LED de cabina 480 nm (azul) — reajuste circadiano', 'Supresión de melatonina diurna', 'behav');
    if (hab.noise > 65) cm('noise', 'Protección auditiva / reducir ventiladores', 'Ruido → estrés autonómico', 'behav');
    if (r.viral > 45 || r.renal > 60 || a.blockers.length) cm('surgeon', 'Notificar al cirujano de vuelo (prioridad alta)', 'Paquete urgente a la cola DSN', 'viral');
    cm('dsn', 'Empaquetar telemetría a cola DSN', 'Store-and-forward', null);
    return out;
  }

  // ===================================================== Cola DSN (Earth-Sync)
  const DSN = {
    queue: [], sent: [], seq: 0, cycle: 90, openFor: 25,
    async enqueue(kind, payload, priority = 'normal') {
      const json = JSON.stringify(payload);
      const raw = new TextEncoder().encode(json).length; let gz = null;
      try {
        if (typeof CompressionStream !== 'undefined') {
          const cs = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
          gz = (await new Response(cs).arrayBuffer()).byteLength; // compresión gzip REAL
        }
      } catch (e) { /* noop */ }
      const pk = { id: ++this.seq, t: Date.now(), kind, raw, gz, priority, payload };
      if (priority === 'high') this.queue.unshift(pk); else this.queue.push(pk);
      if (this.queue.length > 200) this.queue.pop();
      return pk;
    },
    state(sols) {
      if (sols < 850) return { mars: false, open: true, latency: sols >= 180 ? '≈0.6 s (TDRS)' : '≈1.3 s (Luna)' };
      const ph = (Date.now() / 1000) % this.cycle, open = ph < this.openFor;
      return { mars: true, open, next: Math.ceil(open ? this.openFor - ph : this.cycle - ph), latency: '20 min (rango 4–22)' };
    },
    tick(sols) {
      const st = this.state(sols);
      if (st.open) for (let i = 0; i < 3 && this.queue.length; i++) {
        const pk = this.queue.shift(); pk.sentAt = Date.now(); this.sent.unshift(pk);
      }
      if (this.sent.length > 40) this.sent.length = 40;
      return st;
    },
  };

  // ============================================ Normalización de paquetes
  /** Acepta protocolo v2 (ráfagas) y el formato heredado de una sola muestra. */
  function normalizePacket(o) {
    const pk = { fs: o.fs || null, imu_fs: o.imu_fs || null };
    if (Array.isArray(o.ir)) { pk.ir = o.ir; pk.red = o.red; }
    else if (o.ir_raw != null) { pk.ir = [o.ir_raw]; pk.red = [o.red_raw ?? o.ir_raw]; pk.legacy = true; }
    if (Array.isArray(o.imu)) pk.imu = o.imu;
    else if (Array.isArray(o.acc) && Array.isArray(o.gyr)) pk.imu = [[...o.acc, ...o.gyr]];
    pk.temp = o.temp ?? o.die_temp ?? o.skin_temp ?? null;
    pk.therm = o.therm ?? o.thermistor ?? o.ntc ?? null;          // termistor de la estación S3 (°C)
    pk.rssi = o.rssi ?? o.wifi_rssi ?? null;
    const fw = {};
    for (const k of ['bpm', 'spo2', 'hrv', 'pi', 'resp', 'tremor', 'ared_reps', 'finger_ok', 'bp_sys', 'bp_dia']) if (o[k] != null) fw[k] = o[k];
    if (Object.keys(fw).length) pk.fw = fw;
    return pk;
  }

  // =================================================================== Engine
  const HIST_KEYS = ['bpm', 'spo2', 'rmssd', 'resp', 'si', 'sys', 'temp', 'tremor', 'pi', 'therm'];
  const Engine = {
    ppg: new PPGProcessor(100), imu: new IMUProcessor(50), sim: new Simulator(),
    cfg: { fingerThr: 50000, tempOffset: 0, failover: true, anc: true },
    source: "sim", idleSource: "sim", serialState: "idle", failoverActive: false, stream: null,
    temp: null, rssiBuf: [], zone: null, fw: {}, lastPacketWall: 0,
    stats: { pps: 0, sps: 0, lines: 0, parseErr: 0, lastLog: '' }, _rc: 0, _sc: 0, _rt: 0,
    simClock: 0, simCtx: null, hist: Object.fromEntries(HIST_KEYS.map((k) => [k, []])),
    snap: { finger: false }, listeners: new Set(), events: [], estFs: 25,
    subscribe(fn) { Engine.listeners.add(fn); return () => Engine.listeners.delete(fn); },
    event(msg, level = 'info') { this.events.unshift({ t: Date.now(), msg, level }); if (this.events.length > 60) this.events.pop(); },
    start() {
      if (this._iv) return;
      this.simClock = nowMs();
      this._iv = setInterval(() => this.loop(), 20);
      this._tk = setInterval(() => this.tick(), 500);
    },
    simActive() { return this.source === 'sim' || this.failoverActive; },
    resetDSP() { this.ppg.setFs(this.ppg.fs); this.ppg.lastIr = null; this.imu.reset(); if (this.inertial) this.inertial.reset(); this._held = {}; this.rssiBuf = []; this.fw = {}; },
    loop() {
      const now = nowMs();
      if (!this.simActive()) {
        // Nunca dejar datos simulados "pegados" cuando el simulador se apaga (evita contacto falso)
        if (this.stream === "sim") { this.stream = null; this.resetDSP(); }
        this.simClock = now; return;
      }
      if (this.simCtx) this.sim.setTargets(physioTargets(this.simCtx, this.sim.ared > 0));
      let due = Math.floor((now - this.simClock) / 10);
      if (due > 300) { this.simClock = now - 3000; due = 300; } // pestaña en segundo plano: no "ponerse al día" infinito
      while (due >= 8) { this.ingest(this.sim.packet(8), 'sim'); this.simClock += 80; due -= 8; }
    },
    onLine(line) {
      this.stats.lines++;
      const s = line.trim();
      this.stats.lastLine = s.slice(0, 160);
      if (s[0] !== "{") { if (s) this.stats.lastLog = s.slice(0, 120); return; } // logs de arranque del ESP32
      let o; try { o = JSON.parse(s); } catch (e) { this.stats.parseErr++; return; }
      this.ingest(normalizePacket(o), 'serial');
    },
    ingest(pk, from) {
      if (from === 'serial') {
        this.lastPacketWall = nowMs();
        if (this.failoverActive) { this.failoverActive = false; this.event('Telemetría real restablecida — failover desactivado', 'ok'); }
      }
      if (this.stream !== from) { this.stream = from; this.resetDSP(); }
      this._rc++;
      // IMU y PPG se intercalan en orden temporal: el filtro adaptativo necesita la aceleración contemporánea
      const imuArr = pk.imu && pk.imu.length ? pk.imu : null, inr = this.inertial;
      let j = 0;
      const pushImu = (r) => { if (r && r.length >= 6) { this.imu.push(r); if (inr) inr.push(r); this.lastImuWall = nowMs(); } };
      if (imuArr) {
        const ifs = pk.imu_fs || (pk.fs ? 50 : Math.round(this.estFs));
        this.imu.setFs(ifs); if (inr) inr.setFs(ifs);
      }
      if (pk.ir && pk.ir.length) {
        const fs = pk.fs || this.estFs;
        if (Math.abs(this.ppg.fs - fs) > 2) this.ppg.setFs(Math.round(fs));
        const per = imuArr ? Math.max(1, Math.round(pk.ir.length / imuArr.length)) : 0;
        const useAnc = inr && this.cfg.anc && nowMs() - (this.lastImuWall || 0) < 1000;
        for (let i = 0; i < pk.ir.length; i++) {
          if (per && i % per === 0 && j < imuArr.length) pushImu(imuArr[j++]);
          this.ppg.push(pk.ir[i], pk.red ? pk.red[i] : pk.ir[i], this.cfg.fingerThr, useAnc ? inr.mref : null);
        }
        this._sc += pk.ir.length;
      }
      if (imuArr) while (j < imuArr.length) pushImu(imuArr[j++]);
      if (pk.temp != null) this.temp = pk.temp;
      if (pk.therm != null && from === 'serial') { this.therm = pk.therm; this.thermWall = nowMs(); }
      if (pk.rssi != null) { this.rssiBuf.push(pk.rssi); if (this.rssiBuf.length > 9) this.rssiBuf.shift(); }
      if (pk.fw) this.fw = { ...this.fw, ...pk.fw, _t: nowMs() };
    },
    tick() {
      const now = nowMs();
      if (!this._rt) this._rt = now;
      const dt = (now - this._rt) / 1000;
      if (dt >= 1) {
        this.stats.pps = this._rc / dt; this.stats.sps = this._sc / dt;
        if (this.stream === 'serial' && this.stats.sps > 5) this.estFs = this.stats.sps;
        this._rc = 0; this._sc = 0; this._rt = now;
      }
      if (this.source === 'serial' && this.serialState === 'streaming' && now - this.lastPacketWall > 2500 && this.cfg.failover && !this.failoverActive) {
        this.failoverActive = true; this.event('Sin datos del brazalete > 2.5 s — FAILOVER a simulador clínico', 'warn');
      }
      // Puerto abierto pero sin paquetes válidos: se descarta lo último recibido (no hay dedo "congelado")
      const noData = !this.simActive() && (this.source !== "serial" || now - this.lastPacketWall > 2500);
      if (noData && this.stream === "serial") { this.stream = null; this.resetDSP(); this.event("Sin datos válidos del sensor > 2.5 s", "warn"); }
      const pm = this.ppg.metrics(), im = this.imu.metrics();
      const fw = this.fw._t && now - this.fw._t < 3000 ? this.fw : {};
      const rssi = this.rssiBuf.length ? median(this.rssiBuf) : null;
      if (rssi != null) this.zone = zoneFor(rssi, this.zone);
      const s = {
        t: Date.now(), finger: !noData && (pm.finger || (pm.contact == null && fw.finger_ok === true)), contact: noData ? "nodata" : pm.contact,
        bpm: pm.bpm ?? fw.bpm, spo2: pm.spo2 ?? fw.spo2, rmssd: pm.rmssd ?? fw.hrv, pi: pm.pi ?? fw.pi,
        resp: pm.resp ?? fw.resp, si: pm.si, ri: pm.ri, sqi: pm.sqi, R: pm.R,
        temp: this.temp != null ? this.temp + this.cfg.tempOffset : null,
        therm: this.therm != null && now - (this.thermWall || 0) < 5000 ? this.therm : null,
        tremor: im.tremor ?? fw.tremor, reps: im.reps ?? fw.ared_reps ?? 0, activity: im.activity,
        rssi, zone: this.zone, dsp: pm.bpm != null,
        source: this.failoverActive ? 'failover' : this.source, sps: this.stats.sps, pps: this.stats.pps,
      };
      // Subsistema inercial avanzado (ares-imu.js) + protección ANC de métricas sensibles al movimiento
      if (this.inertial) {
        this.inertial.hr = s.finger ? s.bpm : null;
        const imuFresh = now - (this.lastImuWall || 0) < 2000;
        s.mpu = imuFresh ? this.inertial.metrics() : null;
        if (s.mpu) {
          s.mpu.ancRemoved = this.ppg.ancRemoved; s.mpu.ancEnabled = this.cfg.anc;
          const corr = s.sqi != null ? s.sqi : (s.finger ? 0.5 : 0);
          s.mpu.sqiPercent = Math.round(100 * clamp(corr, 0, 1) * (1 - clamp(s.mpu.motionEnergy / 0.35, 0, 0.85)));
          const H = this._held || (this._held = {});
          if (s.mpu.ancActive && s.finger) { // en movimiento: SpO2, HRV y rigidez se RETIENEN (no hay falsas alarmas)
            for (const k of ["spo2", "rmssd", "si"]) if (H[k] != null) s[k] = H[k];
            s.held = true;
          } else if (s.finger) for (const k of ["spo2", "rmssd", "si"]) if (s[k] != null) H[k] = s[k];
        }
      }
      if (s.si != null && s.bpm != null) { // proxy experimental: requiere calibración individual con manguito
        s.sys = 104 + 3.2 * (s.si - 6.5) + 0.35 * (s.bpm - 65); s.dia = 68 + 1.6 * (s.si - 6.5) + 0.25 * (s.bpm - 65);
      } else if (fw.bp_sys) { s.sys = fw.bp_sys; s.dia = fw.bp_dia; }
      for (const k of HIST_KEYS) { const h = this.hist[k]; h.push(s[k] ?? NaN); if (h.length > 90) h.shift(); }
      s.hist = Object.fromEntries(HIST_KEYS.map((k) => [k, this.hist[k].slice()]));
      this.snap = s;
      this.listeners.forEach((fn) => fn());
    },
  };

  // ======================================================= Web Serial (NDJSON)
  class LineBreakTransformer {
    constructor() { this.buf = ''; }
    transform(chunk, ctrl) {
      this.buf += chunk;
      const lines = this.buf.split(/\r?\n/);
      this.buf = lines.pop();                       // fragmento incompleto → espera al siguiente chunk
      for (const l of lines) if (l.trim()) ctrl.enqueue(l);
      if (this.buf.length > 65536) this.buf = '';   // protección ante basura sin '\n'
    }
    flush(ctrl) { if (this.buf.trim()) ctrl.enqueue(this.buf); }
  }

  const Serial = {
    port: null, reader: null, closed: null, wanted: false,
    supported: () => typeof navigator !== 'undefined' && 'serial' in navigator,
    init() {
      if (!this.supported() || this._init) return; this._init = true;
      navigator.serial.addEventListener('connect', (e) => {
        if (this.wanted && !this.port) { Engine.event('Brazalete re-conectado por USB — reabriendo puerto', 'ok'); this.open(e.target).catch(() => {}); }
      });
      navigator.serial.addEventListener('disconnect', (e) => {
        if (e.target === this.port) { Engine.event('USB desconectado — esperando reconexión automática', 'warn'); this._teardown(); Engine.serialState = 'waiting'; }
      });
    },
    async tryAutoReconnect() {
      if (!this.supported() || localStorage.getItem('ares.serial') !== '1') return false;
      const ports = await navigator.serial.getPorts();
      if (ports.length) { this.wanted = true; await this.open(ports[0]).catch(() => {}); return true; }
      return false;
    },
    async connect() {
      this.init();
      const port = await navigator.serial.requestPort();
      this.wanted = true; localStorage.setItem('ares.serial', '1');
      await this.open(port);
    },
    async open(port) {
      Engine.serialState = 'connecting';
      await port.open({ baudRate: 115200, bufferSize: 1 << 16 });
      // Evita que DTR/RTS reinicien el ESP32 al abrir el puerto (placas con auto-reset)
      try { await port.setSignals({ dataTerminalReady: false, requestToSend: false }); } catch (e) { /* noop */ }
      this.port = port; Engine.source = 'serial'; Engine.serialState = 'streaming'; Engine.lastPacketWall = nowMs();
      Engine.event('Puerto serie abierto a 115200 baud (NDJSON)', 'ok');
      this._loop();
    },
    async _loop() {
      const port = this.port;
      while (port === this.port && port.readable && this.wanted) {
        const dec = new TextDecoderStream();
        this.closed = port.readable.pipeTo(dec.writable).catch(() => {});
        const reader = dec.readable.pipeThrough(new TransformStream(new LineBreakTransformer())).getReader();
        this.reader = reader;
        try { for (;;) { const { value, done } = await reader.read(); if (done) break; Engine.onLine(value); } }
        catch (e) { Engine.event(`Error de lectura serie (${e.name}) — reintentando`, 'warn'); }
        finally { try { reader.releaseLock(); } catch (e) { /* noop */ } }
        await this.closed;
      }
    },
    _teardown() { this.port = null; this.reader = null; },
    async disconnect() {
      this.wanted = false; localStorage.removeItem('ares.serial');
      const port = this.port; this._teardown();
      try { await this.reader?.cancel(); } catch (e) { /* noop */ }
      try { await this.closed; } catch (e) { /* noop */ }
      try { await port?.close(); } catch (e) { /* noop */ }
      Engine.source = Engine.idleSource; Engine.serialState = "idle"; Engine.failoverActive = false;
      Engine.event(Engine.idleSource === "sim" ? "Brazalete desconectado — fuente: simulador clínico" : "Sensor desconectado — esperando conexión");
    },
  };

  // ============================== Puente USB local (bridge.rb → Server-Sent Events)
  // Sin selector de puerto: funciona en cualquier navegador mientras bridge.rb esté corriendo.
  const Bridge = {
    es: null,
    async status() {
      try { const r = await fetch("/bridge/status", { cache: "no-store" }); return r.ok ? await r.json() : null; } catch (e) { return null; }
    },
    connect() {
      if (this.es) return;
      this.es = new EventSource("/bridge/stream");
      Engine.source = "serial"; Engine.via = "bridge"; Engine.serialState = "streaming"; Engine.lastPacketWall = nowMs();
      this.es.onmessage = (e) => Engine.onLine(e.data);
      Engine.event("Puente USB local conectado — leyendo el ESP32 sin selector de puerto", "ok");
    },
    disconnect() {
      if (!this.es) return;
      this.es.close(); this.es = null;
      Engine.source = Engine.idleSource; Engine.serialState = "idle"; Engine.via = null; Engine.failoverActive = false;
      Engine.event("Puente USB desconectado");
    },
  };

  global.ARES = {
    Bridge,
    clamp, mean, median, std, Ring, PPGProcessor, IMUProcessor, Simulator, ZONES, zoneFor,
    SCENARIOS, physioTargets, assess, countermeasures, DSN, Engine, Serial, LineBreakTransformer,
    normalizePacket, ppO2Of,
  };
})(typeof window !== 'undefined' ? window : globalThis);
