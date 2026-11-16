// Valida el DSP contra el simulador: node test-dsp.js
require('./ares-core.js');
const { Simulator, PPGProcessor, IMUProcessor } = globalThis.ARES;
const cases = [
  { hr: 64, rmssd: 55, spo2: 98.4, pi: 3.6, resp: 13, si: 6.6, temp: 36.6, tremor: 0.015 },
  { hr: 110, rmssd: 20, spo2: 86, pi: 1.5, resp: 22, si: 7, temp: 36.6, tremor: 0.08 },
  { hr: 78, rmssd: 29, spo2: 97, pi: 2.2, resp: 16, si: 10.5, temp: 37.3, tremor: 0.03 },
  { hr: 50, rmssd: 80, spo2: 99, pi: 5, resp: 9, si: 5.2, temp: 36.6, tremor: 0.01 },
];
for (const c of cases) {
  const sim = new Simulator(); sim.p = { ...c }; sim.setTargets(c);
  const ppg = new PPGProcessor(100), imu = new IMUProcessor(50);
  for (let i = 0; i < 100 * 45; i++) { const s = sim.step(); ppg.push(s.ir, s.red, 50000); if (s.imu) imu.push(s.imu); }
  const m = ppg.metrics(), im = imu.metrics();
  const f = (x, d = 1) => (x == null ? '—' : x.toFixed(d));
  console.log(`target hr ${c.hr} rmssd ${c.rmssd} spo2 ${c.spo2} pi ${c.pi} resp ${c.resp} si ${c.si} trem ${c.tremor}`);
  console.log(`  got  hr ${f(m.bpm)} rmssd ${f(m.rmssd)} spo2 ${f(m.spo2)} pi ${f(m.pi, 2)} resp ${f(m.resp)} si ${f(m.si)} trem ${f(im.tremor, 3)} sqi ${f(m.sqi, 2)}`);
}
// ARED en 0g y 1g
for (const g of [0, 0.38, 1]) {
  const sim = new Simulator(); sim.g = g; const imu = new IMUProcessor(50);
  for (let i = 0; i < 300; i++) { const s = sim.step(); if (s.imu) imu.push(s.imu); }
  sim.startAred(12);
  for (let i = 0; i < 100 * 25; i++) { const s = sim.step(); if (s.imu) imu.push(s.imu); }
  console.log(`ARED g=${g}: 12 reps → detectadas ${imu.metrics().reps}`);
}
// LineBreakTransformer con JSON partido
const { LineBreakTransformer } = globalThis.ARES; const t = new LineBreakTransformer(); const out = [];
const ctrl = { enqueue: (l) => out.push(JSON.parse(l)) };
['{"bpm": 7', '5, "spo2": 98}\n{"a"', ':1}\r\n'].forEach((c) => t.transform(c, ctrl));
console.log('LineBreak:', JSON.stringify(out));
