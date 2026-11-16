/* =============================================================================
 * BIO-ASTRO OS — Subsistema inercial avanzado (MPU6050) · equipo MIB
 *
 * TODO se calcula aquí, en el navegador, a partir de los 6 ejes crudos a 50 Hz
 * [ax, ay, az (g), gx, gy, gz (rad/s)]. El ESP32-C3 solo adquiere. Ventajas:
 *   - Los algoritmos se pueden ajustar/depurar sin re-flashear el brazalete.
 *   - Los datos crudos se pueden re-procesar (y auditar) después.
 *   - Filtros en doble precisión y FFT sin gastar RAM/CPU del microcontrolador.
 *   - La fusión con el PPG del MAX30102 ocurre donde ya vive el DSP óptico.
 *
 * Módulos:
 *   A. ARED Strength Trainer  → reps, fase, fuerza pico, TUT, velocidad (VBT), estímulo osteogénico
 *   B. Energía de movimiento  → ENMO + referencia de ruido para el filtro adaptativo del PPG (ANC)
 *   C. Neuro-vestibular       → Pitch/Roll (filtro complementario), temblor 4–12 Hz, test de Romberg
 *   D. Sueño                  → SleepStager (profundo / REM / ligero / despierto + micro-despertares)
 *   E. Strain 0–21 y caída    → carga cinética + cardiovascular (escala logarítmica), impacto + inmovilidad
 *
 * Las escalas "tipo WHOOP" son aproximaciones propias inspiradas en lo publicado;
 * no son los algoritmos propietarios de WHOOP.
 * ========================================================================== */
(function (global) {
  'use strict';
  const A = global.ARES;
  const { clamp, mean, median, std, Ring } = A;
  const G0 = 9.80665, DEG = 180 / Math.PI;
  const wall = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  /** Filtro bicuadrático (RBJ cookbook), Butterworth Q = 0.707. */
  class Biquad {
    constructor(type, fc, fs, q = 0.7071) {
      const w = (2 * Math.PI * fc) / fs, c = Math.cos(w), al = Math.sin(w) / (2 * q);
      let b0, b1, b2;
      if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; }
      else { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; }
      const a0 = 1 + al;
      this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = (-2 * c) / a0; this.a2 = (1 - al) / a0;
      this.x1 = this.x2 = this.y1 = this.y2 = 0;
    }
    step(x) {
      const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
      this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
      return y;
    }
  }

  const SPEC_F = []; for (let f = 3; f <= 14.01; f += 0.5) SPEC_F.push(f);

  class Inertial {
    constructor(fs = 50) { this.fs = fs; this.cfg = { hrRest: 55, hrMax: 190, ancThr: 0.035 }; this.reset(); }
    setFs(fs) { if (fs && fs !== this.fs) { this.fs = fs; this.reset(); } }
    reset() {
      const fs = this.fs;
      this.n = 0; this.last = [0, 0, 0, 0, 0, 0];
      this.aLp = null; this.gLocal = 1; this.gVec = [0, 0, 1]; this.zeroG = false;
      this.bias = [0, 0, 0]; this.pitch = 0; this.roll = 0; this.oriInit = false;
      this.hp = [0, 0, 0]; this.moving = false; this.ancBlocked = false; this.enmo = 0; this.dyn = 0; this.gyroMag = 0; this.maxG = 0;
      this.mref = { hp: this.hp, active: false };
      this.aVar = [0, 0, 0];
      // temblor 4–12 Hz
      this.bp = [0, 1, 2].map(() => ({ hp: new Biquad('hp', 4, fs), lp: new Biquad('lp', 12, fs) }));
      this.tBuf = [0, 1, 2].map(() => new Ring(128)); this.tSq = new Ring(Math.round(fs * 2));
      this.tremor = 0; this.domHz = null; this.spec = SPEC_F.map(() => 0);
      // osciloscopio
      this.scopeA = [0, 1, 2].map(() => new Ring(fs * 8)); this.scopeG = [0, 1, 2].map(() => new Ring(fs * 8));
      this.scopeV = new Ring(fs * 8);
      // ARED strength trainer
      this.v = 0; this.phase = 'rest'; this.cur = null; this.reps = []; this.tut = 0; this.osteoSum = 0;
      this.setActive = false; this.lastRepT = -1e9; this.sets = []; this.setStartIdx = 0;
      // strain y caída
      this.kin = 0; this.trimp = 0; this.hr = null;
      this.fallState = 'idle'; this.fallT = 0; this.fallPeak = 0; this.stillT = 0; this.fallAlert = null;
      // micro-despertares (sueño) y Romberg
      this.turns = 0; this.turnHigh = false; this.romberg = null; this.rombergResult = null;
    }
    resetSession() { this.reps = []; this.tut = 0; this.osteoSum = 0; this.sets = []; this.setActive = false; this.cur = null; this.setStartIdx = 0; }

    /** r = [ax, ay, az (g), gx, gy, gz (rad/s)] */
    push(r) {
      const fs = this.fs, dt = 1 / fs, t = this.n++ * dt;
      this.last = r;
      const a = [r[0], r[1], r[2]];
      const g = [r[3] - this.bias[0], r[4] - this.bias[1], r[5] - this.bias[2]];
      const mag = Math.hypot(a[0], a[1], a[2]), gm = Math.hypot(g[0], g[1], g[2]);
      this.gyroMag = gm; if (mag > this.maxG) this.maxG = mag;
      if (!this.aLp) { this.aLp = a.slice(); this.gLocal = mag; }

      // ---- gravedad local AUTO-ESTIMADA (0g / 0.16g / 0.38g / 1g) y sesgo del giroscopio, solo en reposo
      for (let i = 0; i < 3; i++) this.aLp[i] += (a[i] - this.aLp[i]) * (dt / 1.5);
      const hpNow = Math.hypot(a[0] - this.aLp[0], a[1] - this.aLp[1], a[2] - this.aLp[2]);
      const still = gm < 0.05 && hpNow < 0.03;              // quieto = sin rotación ni aceleración dinámica
      if (still) this.gLocal += (mag - this.gLocal) * (dt / (this.n < fs * 3 ? 0.3 : 2));
      if (still) for (let i = 0; i < 3; i++) this.bias[i] += (r[3 + i] - this.bias[i]) * (dt / 20);
      const lg = Math.hypot(this.aLp[0], this.aLp[1], this.aLp[2]);
      // en movimiento sostenido, la media de la aceleración sigue siendo la gravedad: seguimiento lento
      if (!still && this.n > fs) this.gLocal += (lg - this.gLocal) * (dt / 4);
      this.zeroG = this.zeroG ? this.gLocal < 0.11 : this.gLocal < 0.08;
      if (lg > 0.05) for (let i = 0; i < 3; i++) this.gVec[i] = this.aLp[i] / lg;
      for (let i = 0; i < 3; i++) { this.hp[i] = a[i] - this.aLp[i]; this.aVar[i] += (this.hp[i] * this.hp[i] - this.aVar[i]) * (dt / 3); }

      // ---- B. energía de movimiento: ENMO = max(0, |a| − g_local) y componente dinámica
      const dynNow = Math.hypot(this.hp[0], this.hp[1], this.hp[2]);
      this.enmo += (Math.max(0, mag - this.gLocal) - this.enmo) * (dt / 1.0);
      this.dyn += (dynNow - this.dyn) * (dt / 0.4);
      // histéresis para que el ANC no parpadee
      this.moving = this.moving ? this.dyn > this.cfg.ancThr * 0.6 : this.dyn > this.cfg.ancThr;
      // Límite físico del filtro adaptativo: si la cadencia del movimiento ≈ frecuencia cardíaca, restar el
      // artefacto borraría también el latido → el ANC queda en espera y las métricas solo se retienen.
      const lastRep = this.reps[this.reps.length - 1];
      const cadence = lastRep && t - lastRep.t < 4 ? 60 / lastRep.dur : null;
      this.ancBlocked = !!(this.moving && cadence && this.hr && Math.abs(cadence - this.hr) / this.hr < 0.2);
      this.mref.active = this.moving && !this.ancBlocked;

      // ---- C1. orientación: filtro complementario (giroscopio rápido + acelerómetro como referencia lenta)
      const accOk = !this.zeroG && Math.abs(mag - this.gLocal) < 0.12 * Math.max(this.gLocal, 0.1);
      const rAcc = Math.atan2(a[1], a[2]), pAcc = Math.atan2(-a[0], Math.hypot(a[1], a[2]));
      if (!this.oriInit && !this.zeroG && this.n > 5) { this.roll = rAcc; this.pitch = pAcc; this.oriInit = true; }
      this.roll += g[0] * dt; this.pitch += g[1] * dt;
      if (accOk) { // en 0g no hay referencia de gravedad: queda solo el giroscopio (deriva lenta)
        let dr = rAcc - this.roll; if (dr > Math.PI) dr -= 2 * Math.PI; if (dr < -Math.PI) dr += 2 * Math.PI;
        this.roll += 0.02 * dr; this.pitch += 0.02 * (pAcc - this.pitch);
      }

      // ---- C2. temblor: banda 4–12 Hz del giroscopio
      let sq = 0;
      for (let i = 0; i < 3; i++) { const y = this.bp[i].lp.step(this.bp[i].hp.step(g[i])); this.tBuf[i].push(y); sq += y * y; }
      this.tSq.push(sq);
      if (this.n % Math.round(fs / 2) === 0) this._spectrum();
      if (gm > 1.0 && !this.turnHigh) { this.turns++; this.turnHigh = true; } else if (gm < 0.5) this.turnHigh = false;

      // ---- A. cinemática vertical → velocidad (VBT) → fases y repeticiones
      let av; // aceleración a lo largo de la vertical (g). En 0g: eje dominante de movimiento.
      if (!this.zeroG && lg > 0.12) av = this.hp[0] * this.gVec[0] + this.hp[1] * this.gVec[1] + this.hp[2] * this.gVec[2];
      else { let k = 0; for (let i = 1; i < 3; i++) if (this.aVar[i] > this.aVar[k]) k = i; av = this.hp[k]; }
      this.v += av * G0 * dt; this.v *= 1 - dt / 1.2;                     // integrador con fuga: sin deriva
      const ph = this.v > 0.07 ? 'con' : this.v < -0.07 ? 'ecc' : (this.setActive || this.cur ? 'iso' : 'rest');
      this._strength(t, dt, ph, mag, Math.abs(av));
      this.phase = ph;

      // ---- E. strain: carga cinética (g·s) + cardiovascular (TRIMP de Banister)
      this.kin += dynNow * dt;
      if (this.hr) {
        const x = clamp((this.hr - this.cfg.hrRest) / (this.cfg.hrMax - this.cfg.hrRest), 0, 1);
        this.trimp += (dt / 60) * x * 0.64 * Math.exp(1.92 * x);
      }
      this._fall(t, dt, mag, dynNow, gm);
      if (this.romberg) this._romberg(t);

      for (let i = 0; i < 3; i++) { this.scopeA[i].push(a[i]); this.scopeG[i].push(g[i]); }
      this.scopeV.push(this.v);
    }

    _spectrum() {
      const N = this.tBuf[0].len; if (N < 64) return;
      let s = 0; for (let i = 0; i < this.tSq.len; i++) s += this.tSq.last(i);
      this.tremor = Math.sqrt(s / this.tSq.len);
      let best = 0, bi = -1;
      for (let fi = 0; fi < SPEC_F.length; fi++) {
        const w = (2 * Math.PI * SPEC_F[fi]) / this.fs; let p = 0;
        for (let ax = 0; ax < 3; ax++) {
          let re = 0, im = 0;
          for (let k = 0; k < N; k++) { const x = this.tBuf[ax].last(k) * (0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (N - 1))); re += x * Math.cos(w * k); im += x * Math.sin(w * k); }
          p += re * re + im * im;
        }
        this.spec[fi] = Math.sqrt(p) / N;
        if (SPEC_F[fi] >= 4 && SPEC_F[fi] <= 12 && this.spec[fi] > best) { best = this.spec[fi]; bi = fi; }
      }
      if (bi > 0 && this.tremor > 0.008) {
        const y0 = this.spec[bi - 1], y1 = this.spec[bi], y2 = this.spec[bi + 1] ?? y1, den = y0 - 2 * y1 + y2;
        this.domHz = SPEC_F[bi] + (den ? (0.5 * (y0 - y2)) / den : 0) * 0.5;
      } else this.domHz = null;
    }

    _strength(t, dt, ph, mag, avAbs) {
      const moving = ph === 'con' || ph === 'ecc';
      let c = this.cur;
      if (moving) {
        if (!c) c = this.cur = { t0: t, first: ph, seen: { con: false, ecc: false }, peakG: 0, peakDyn: 0, vSum: 0, vN: 0, vPk: 0, tut: 0, lastMove: t, wraps: false };
        // ciclo completo: vuelve a empezar la primera fase tras haber visto las dos → repetición terminada
        if (ph === c.first && c.seen.con && c.seen.ecc && this.phase !== ph) { this._closeRep(t); c = this.cur = { t0: t, first: ph, seen: { con: false, ecc: false }, peakG: 0, peakDyn: 0, vSum: 0, vN: 0, vPk: 0, tut: 0, lastMove: t }; }
        c.seen[ph] = true; c.lastMove = t; c.tut += dt;
        if (ph === 'con') { c.vSum += this.v; c.vN++; if (this.v > c.vPk) c.vPk = this.v; }
      }
      if (c) {
        if (mag > c.peakG) c.peakG = mag; if (avAbs > c.peakDyn) c.peakDyn = avAbs;
        if (!moving && t - c.lastMove > 0.5) { if (c.seen.con && c.seen.ecc) this._closeRep(c.lastMove); this.cur = null; }
        else if (t - c.t0 > 8) this.cur = null; // movimiento que no es una repetición
      }
      if (this.setActive && t - this.lastRepT > 4 && !this.cur) this._closeSet();
    }
    _closeRep(t) {
      const c = this.cur, dur = t - c.t0;
      if (dur < 0.35 || c.vPk < 0.1 || c.peakDyn < 0.04) return; // ruido, no repetición
      const load = clamp(c.peakDyn / 0.30, 0, 1.4);               // 0.30 g dinámicos = carga mecánica útil
      const tempo = clamp(dur / 1.5, 0.25, 1.2);                  // ≥ 1.5 s por rep = tensión sostenida
      const stim = load * tempo;
      if (!this.setActive) { this.setActive = true; this.setStartIdx = this.reps.length; }
      this.reps.push({ t, dur, peakG: c.peakG, peakDyn: c.peakDyn, mcv: c.vN ? c.vSum / c.vN : 0, vPk: c.vPk, tut: c.tut, stim });
      if (this.reps.length > 200) { this.reps.shift(); this.setStartIdx = Math.max(0, this.setStartIdx - 1); }
      this.tut += c.tut; this.osteoSum += stim; this.lastRepT = t;
    }
    _closeSet() {
      const rs = this.reps.slice(this.setStartIdx);
      if (rs.length) {
        const best = Math.max(...rs.map((r) => r.mcv)), lastV = rs[rs.length - 1].mcv;
        this.sets.push({ reps: rs.length, peakG: Math.max(...rs.map((r) => r.peakG)), tut: rs.reduce((s, r) => s + r.tut, 0),
          mcv: mean(rs.map((r) => r.mcv)), velLoss: best > 0 ? clamp((1 - lastV / best) * 100, 0, 100) : 0, stim: mean(rs.map((r) => r.stim)) });
        if (this.sets.length > 12) this.sets.shift();
      }
      this.setActive = false;
    }

    _fall(t, dt, mag, dyn, gm) {
      if (this.fallState === 'idle') { if (mag > 3.5) { this.fallState = 'impact'; this.fallT = t; this.fallPeak = mag; this.stillT = 0; } }
      else {
        if (t - this.fallT < 0.4) { if (mag > this.fallPeak) this.fallPeak = mag; return; }
        if (dyn < 0.05 && gm < 0.15) this.stillT += dt; else this.stillT = 0;
        if (this.stillT >= 3) { this.fallAlert = { at: Date.now(), peakG: this.fallPeak, stillS: this.stillT }; this.fallState = 'idle'; }
        else if (t - this.fallT > 9) this.fallState = 'idle'; // hubo impacto pero el tripulante se movió: sin alerta
      }
    }
    ackFall() { this.fallAlert = null; }

    // ---- Test de Romberg de brazo extendido (10 s)
    startRomberg(seconds = 10) {
      this.rombergResult = null;
      this.romberg = { t0: this.n / this.fs, dur: seconds, p0: this.pitch, r0: this.roll, maxDev: 0, sumSq: 0, n: 0, trem: [], hz: [], tail: [] };
    }
    _romberg(t) {
      const R = this.romberg, dev = Math.hypot(this.pitch - R.p0, this.roll - R.r0) * DEG, el = t - R.t0;
      if (dev > R.maxDev) R.maxDev = dev;
      R.n++; R.elapsed = el; R.dev = dev;
      if (el > R.dur - 0.6) R.tail.push(dev);
      if (R.n % 25 === 0) { R.trem.push(this.tremor); if (this.domHz) R.hz.push(this.domHz); }
      R.sumSq += dev * dev;
      if (el >= R.dur) {
        const drift = R.tail.length ? mean(R.tail) : dev;
        const rms = Math.sqrt(R.sumSq / R.n), sway = Math.sqrt(Math.max(0, rms * rms - (drift * drift) / 3)); // quita la rampa de deriva
        const grade = drift < 3 && sway < 1.5 ? 'NORMAL' : drift < 8 && sway < 4 ? 'INESTABILIDAD LEVE' : 'ATAXIA VESTIBULAR';
        this.rombergResult = { at: Date.now(), driftDeg: drift, maxDevDeg: R.maxDev, swayDeg: sway, tremor: R.trem.length ? mean(R.trem) : this.tremor, domHz: R.hz.length ? median(R.hz) : null, grade, zeroG: this.zeroG };
        this.romberg = null;
      }
    }

    get osteoScore() { return 100 * (1 - Math.exp(-this.osteoSum / 8)); }
    get strain() { return 21 * (1 - Math.exp(-(this.trimp / 90 + this.kin / 50 + this.osteoSum / 120))); }

    metrics() {
      const rs = this.setActive ? this.reps.slice(this.setStartIdx) : [];
      const lastSet = this.sets[this.sets.length - 1] || null;
      const cur = rs.length ? { reps: rs.length, peakG: Math.max(...rs.map((r) => r.peakG)), tut: rs.reduce((s, r) => s + r.tut, 0), mcv: mean(rs.map((r) => r.mcv)),
        velLoss: clamp((1 - rs[rs.length - 1].mcv / Math.max(...rs.map((r) => r.mcv))) * 100, 0, 100), stim: mean(rs.map((r) => r.stim)) } : null;
      const ref = cur || lastSet;
      const weak = !!ref && ref.reps >= 5 && ref.stim < 0.45;
      const tremClass = this.domHz == null || this.tremor < 0.02 ? 'sin temblor relevante'
        : this.domHz < 7 ? 'baja frecuencia (4–7 Hz): patrón cerebeloso / reposo' : 'fisiológico acentuado (8–12 Hz): fatiga / estrés';
      return {
        ax: this.last[0], ay: this.last[1], az: this.last[2], gx: this.last[3], gy: this.last[4], gz: this.last[5],
        pitch: this.pitch * DEG, roll: this.roll * DEG, gLocal: this.gLocal, zeroG: this.zeroG, bias: this.bias.slice(),
        motionEnergy: this.dyn, enmo: this.enmo, ancActive: !!this.moving, ancFiltering: this.mref.active, ancBlocked: !!this.ancBlocked, gyroMag: this.gyroMag, maxG: this.maxG,
        tremor: this.tremor, domHz: this.domHz, tremClass, spec: this.spec.slice(), specF: SPEC_F,
        phase: this.phase, velocity: this.v, reps: this.reps.length, setReps: cur ? cur.reps : 0, setActive: this.setActive,
        peakForceG: ref ? ref.peakG : 0, tut: this.tut, setTut: ref ? ref.tut : 0, mcv: ref ? ref.mcv : 0, velLoss: ref ? ref.velLoss : 0,
        osteoScore: this.osteoScore, osteoWeak: weak, repList: this.reps.slice(-24), sets: this.sets.slice(),
        strain: this.strain, kin: this.kin, trimp: this.trimp,
        fallAlert: this.fallAlert, fallWatching: this.fallState !== 'idle', turns: this.turns,
        romberg: this.romberg ? { elapsed: this.romberg.elapsed || 0, dur: this.romberg.dur, dev: this.romberg.dev || 0 } : null, rombergResult: this.rombergResult,
      };
    }
  }

  // ====================================================== D. Arquitectura del sueño
  /** Clasifica épocas a partir de: actividad (g), giros de muñeca, FC, HRV y variabilidad de la FC. */
  class SleepStager {
    constructor(epochSec = 30) { this.epochSec = epochSec; this.ep = []; }
    reset(epochSec) { if (epochSec) this.epochSec = epochSec; this.ep = []; }
    add(f) { // f = { act, turns, bpm, rmssd, hrSd, noise, co2 }
      const hist = this.ep.filter((e) => e.bpm != null);
      const base = hist.length >= 6 ? median(hist.map((e) => e.bpm)) : f.bpm;
      const baseR = hist.length >= 6 ? median(hist.map((e) => e.rmssd)) : f.rmssd;
      const baseSd = hist.length >= 6 ? median(hist.map((e) => e.hrSd)) : f.hrSd;
      let stage;
      if (f.act > 0.02 || f.turns >= 2) stage = 'wake';
      else if (f.turns === 1 || f.act > 0.006) stage = 'light';                                  // micro-despertar
      else if (f.bpm != null && f.bpm < 0.94 * base && f.rmssd > 1.08 * baseR) stage = 'deep';   // inmóvil + FC↓ + HRV↑
      else if (f.act < 0.003 && f.hrSd > 1.5 * baseSd) stage = 'rem';                            // atonía + FC irregular
      else stage = 'light';
      const disturb = f.turns >= 1 || f.act > 0.02;
      const prev = this.ep[this.ep.length - 1];
      const env = disturb && (Math.max(f.noise ?? 0, prev?.noise ?? 0) > 65 || (f.co2 ?? 0) > 4.5);
      this.ep.push({ ...f, stage, disturb, env });
      return stage;
    }
    summary() {
      const n = this.ep.length; if (!n) return null;
      const pct = (s) => (100 * this.ep.filter((e) => e.stage === s).length) / n;
      const hours = (n * this.epochSec) / 3600;
      // un despertar = flanco de subida de "disturb"
      let d = 0, dEnv = 0;
      for (let i = 0; i < n; i++) if (this.ep[i].disturb && !(i && this.ep[i - 1].disturb)) { d++; if (this.ep[i].env) dEnv++; }
      const envFrac = d ? dEnv / d : 0;
      const verdict = (hours ? d / hours : 0) < 0.8 ? 'Sueño consolidado: sin fragmentación relevante'
        : envFrac >= 0.6 ? 'INSOMNIO AMBIENTAL: los despertares coinciden con picos de ruido / CO₂ del hábitat (ECLSS)'
        : envFrac <= 0.3 ? 'INSOMNIO FISIOLÓGICO: despertares sin causa ambiental (estrés, desfase circadiano)'
        : 'Origen MIXTO: parte de los despertares coincide con ruido / CO₂';
      return { hours, deep: pct('deep'), rem: pct('rem'), light: pct('light'), wake: pct('wake'), disturbances: d, perHour: hours ? d / hours : 0, envFrac, verdict,
        efficiency: 100 - pct('wake') };
    }
    /** Noche de 8 h guionizada (a nivel de épocas) para la demo. kind: 'ruido' | 'fisiologico' | 'ideal' */
    static script(kind = 'ruido') {
      const out = [], N = 960; // 8 h en épocas de 30 s
      const rnd = (a, b) => a + Math.random() * (b - a);
      const events = [];
      const nEv = kind === 'ideal' ? 2 : 13;
      for (let i = 0; i < nEv; i++) events.push({ at: Math.floor(rnd(40, N - 20)), env: kind === 'ruido' ? Math.random() < 0.85 : Math.random() < 0.1 });
      for (let i = 0; i < N; i++) {
        const cyc = (i % 180) / 180;                                   // ciclos de 90 min
        const late = i / N;                                            // más REM al final de la noche
        let target = cyc < 0.12 ? 'light' : cyc < 0.45 - 0.2 * late ? 'deep' : cyc < 0.72 - 0.1 * late ? 'light' : 'rem';
        if (i < 14) target = 'wake';                                   // latencia de sueño
        const ev = events.find((e) => i >= e.at && i < e.at + 3);
        const noise = 52 + rnd(-2, 2) + (events.some((e) => e.env && i >= e.at - 1 && i <= e.at) ? rnd(16, 24) : 0);
        const co2 = (kind === 'ruido' ? 2.4 + 2.6 * late : 2.2 + 0.4 * late) + rnd(-0.1, 0.1);
        const f = { noise, co2 };
        if (target === 'wake' || ev) { f.act = ev ? rnd(0.015, 0.06) : rnd(0.03, 0.08); f.turns = ev ? (i === ev.at ? 2 : 1) : 2; f.bpm = rnd(64, 72); f.rmssd = rnd(30, 40); f.hrSd = rnd(2, 4); }
        else if (target === 'deep') { f.act = rnd(0, 0.002); f.turns = 0; f.bpm = rnd(49, 53); f.rmssd = rnd(62, 80); f.hrSd = rnd(0.6, 1.2); }
        else if (target === 'rem') { f.act = rnd(0, 0.0015); f.turns = 0; f.bpm = rnd(58, 66); f.rmssd = rnd(36, 48); f.hrSd = rnd(3.2, 5.5); }
        else { f.act = rnd(0.001, 0.005); f.turns = 0; f.bpm = rnd(56, 61); f.rmssd = rnd(44, 55); f.hrSd = rnd(1.2, 2.0); }
        out.push(f);
      }
      return out;
    }
  }

  A.Biquad = Biquad; A.Inertial = Inertial; A.SleepStager = SleepStager;
  A.Engine.inertial = new Inertial(50);
})(typeof window !== 'undefined' ? window : globalThis);
