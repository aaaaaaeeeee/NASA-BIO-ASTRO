/* =============================================================================
 * BIO-ASTRO · Gemelo anatómico WebGL (Three.js r128 + OrbitControls + CSS2DRenderer)
 * Escena 3D procedural: 4 grupos (cáscara, esquelético-renal, cardio-pulmonar, neuro-inmune),
 * vista explotada en Z, partículas de fluido cefálico y de calcio, anillo láser de escaneo,
 * selección de órganos por raycasting. No conoce sensores: recibe el estado ya evaluado.
 *
 * API:  ARES_3D.init(container, onPick) → true | false (sin WebGL)
 *       ARES_3D.update(state)  ·  ARES_3D.scan(p | null, stage)  ·  ARES_3D.flyTo(key)
 * ========================================================================== */
(function (global) {
  'use strict';
  const T = global.THREE;
  const COL = { ok: 0x10b981, warn: 0xf59e0b, crit: 0xef4444, na: 0x63636e, cyan: 0x38bdf8, orange: 0xff5722, lime: 0xd4ff33, amber: 0xf59e0b, violet: 0xd4ff33 };
  const ORGAN_SYS = { brain: 'neuro', eyes: 'neuro', vestibular: 'neuro', marrow: 'immune', heart: 'cardio', lungs: 'cardio', carotid: 'cardio', spine: 'skeletal', femur: 'skeletal', kidneys: 'skeletal' };
  const NAMES = { brain: 'Cerebro', eyes: 'Ojos · nervio óptico', vestibular: 'Oído interno', marrow: 'Médula ósea · ganglios', heart: 'Corazón', lungs: 'Pulmones', carotid: 'Carótidas · aorta', spine: 'Columna · costillas · pelvis', femur: 'Fémures', kidneys: 'Riñones' };

  let R, scene, camera, controls, labelR, container, onPick, clock;
  const groups = {}, mats = {}, pickables = [], planes = {}, labels = {};
  let st = { levels: {}, bpm: null, resp: 14, g: 0, co2: 2, reps: 0, cuffs: false, eff: 0.5, filter: 'all', exploded: false, selected: null, finger: false, swActive: false };
  let heartPh = 0, fly = null, scanState = null, hovered = null, alive = false;
  let fluid, calcium, rad, ring, disc, scanLight, bracelet, selLabel;

  /* ---------------------------------------------------------------- helpers */
  const v3 = (x, y, z) => new T.Vector3(x, y, z);
  function organMat(key) {
    if (!mats[key]) mats[key] = new T.MeshStandardMaterial({ color: COL.na, emissive: COL.na, emissiveIntensity: 0.35, roughness: 0.38, metalness: 0.08, transparent: true, opacity: 0.92 });
    return mats[key];
  }
  function add(group, geo, key, pos, opts = {}) {
    const m = new T.Mesh(geo, key ? organMat(key) : opts.mat);
    if (pos) m.position.copy(pos);
    if (opts.scale) m.scale.set(...opts.scale);
    if (opts.rot) m.rotation.set(...opts.rot);
    if (key) { m.userData.organ = key; pickables.push(m); }
    group.add(m); return m;
  }
  /** cilindro orientado entre dos puntos */
  function limb(a, b, r1, r2, mat, seg = 14) {
    const d = new T.Vector3().subVectors(b, a), len = d.length();
    const geo = new T.CylinderGeometry(r2, r1, len, seg, 1, true);
    const m = new T.Mesh(geo, mat);
    m.position.copy(a).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(v3(0, 1, 0), d.normalize());
    return m;
  }
  function boneBetween(group, a, b, r, key) {
    const m = limb(a, b, r, r * 0.9, organMat(key), 10); m.userData.organ = key; pickables.push(m); group.add(m); return m;
  }
  function tube(group, pts, r, key, mat) {
    const geo = new T.TubeGeometry(new T.CatmullRomCurve3(pts), 48, r, 8, false);
    const m = new T.Mesh(geo, key ? organMat(key) : mat);
    if (key) { m.userData.organ = key; pickables.push(m); }
    group.add(m); return m;
  }
  function makeLabel(text, color, cls = '') {
    const d = document.createElement('div');
    d.className = 'l3d ' + cls; d.textContent = text; d.style.color = color; d.style.borderColor = color;
    return new T.CSS2DObject(d);
  }

  /* ---------------------------------------------------------------- cuerpo */
  function buildShell(g) {
    const glass = new T.MeshPhysicalMaterial({ color: 0xc9ccd2, transparent: true, opacity: 0.07, roughness: 0.15, metalness: 0, side: T.DoubleSide, depthWrite: false, clearcoat: 1 });
    const wire = new T.MeshBasicMaterial({ color: 0xa0a0ab, wireframe: true, transparent: true, opacity: 0.11, depthWrite: false });
    const both = (geo, pos, sc, rot) => { for (const m of [glass, wire]) { const x = new T.Mesh(geo, m); if (pos) x.position.copy(pos); if (sc) x.scale.set(...sc); if (rot) x.rotation.set(...rot); g.add(x); } };
    // torso por revolución (perfil radio–altura), algo achatado en Z
    const prof = [[0.01, -0.45], [0.46, -0.42], [0.55, -0.15], [0.52, 0.25], [0.46, 0.7], [0.55, 1.2], [0.66, 1.7], [0.72, 2.05], [0.55, 2.25], [0.2, 2.32], [0.01, 2.33]].map(([r, y]) => new T.Vector2(r, y));
    both(new T.LatheGeometry(prof, 28), null, [1, 1, 0.62]);
    both(new T.SphereGeometry(0.42, 28, 20), v3(0, 3.0, 0.02), [0.95, 1.18, 1.08]);           // cabeza
    both(new T.CylinderGeometry(0.15, 0.18, 0.4, 16, 1, true), v3(0, 2.48, 0));               // cuello
    const limbs = [[v3(0.72, 2.08, 0), v3(0.95, 0.85, 0.02), 0.16, 0.12], [v3(0.95, 0.85, 0.02), v3(1.07, -0.3, 0.12), 0.115, 0.085],
      [v3(0.3, -0.3, 0), v3(0.36, -1.85, 0.02), 0.22, 0.15], [v3(0.36, -1.85, 0.02), v3(0.36, -3.3, -0.02), 0.145, 0.095]];
    for (const [a, b, r1, r2] of limbs) for (const s of [1, -1]) {
      const A = v3(a.x * s, a.y, a.z), B = v3(b.x * s, b.y, b.z);
      for (const m of [glass, wire]) g.add(limb(A, B, r1, r2, m));
      for (const m of [glass, wire]) { const j = new T.Mesh(new T.SphereGeometry(r2, 14, 10), m); j.position.copy(B); g.add(j); }
    }
    for (const s of [1, -1]) { both(new T.SphereGeometry(0.11, 14, 10), v3(1.09 * s, -0.48, 0.14), [0.8, 1.3, 0.55]); both(new T.BoxGeometry(0.2, 0.1, 0.38), v3(0.36 * s, -3.38, 0.1)); }
    // brazalete BIO-ASTRO en la muñeca izquierda (MAX30102 + MPU6050)
    bracelet = new T.Mesh(new T.TorusGeometry(0.105, 0.03, 10, 28), new T.MeshStandardMaterial({ color: COL.na, emissive: COL.na, emissiveIntensity: 0.8 }));
    bracelet.position.set(-1.06, -0.26, 0.12); bracelet.rotation.set(Math.PI / 2, 0, 0.1); g.add(bracelet);
    const bl = makeLabel('ESP32-C3 · MAX30102 + MPU6050', '#10B981', 'small'); bl.position.set(-1.5, -0.55, 0.2); g.add(bl);
  }

  function buildSkeletal(g) {
    // columna: 14 vértebras + discos sobre una curva en S
    const sp = new T.CatmullRomCurve3([v3(0, 2.38, -0.2), v3(0, 1.9, -0.3), v3(0, 1.3, -0.26), v3(0, 0.7, -0.3), v3(0, 0.05, -0.22)]);
    for (let i = 0; i < 14; i++) {
      const t = i / 13, p = sp.getPointAt(t), tan = sp.getTangentAt(t);
      const q = new T.Quaternion().setFromUnitVectors(v3(0, 1, 0), tan);
      const v = add(g, new T.CylinderGeometry(0.075, 0.08, 0.1, 12), 'spine', p); v.quaternion.copy(q);
      const proc = add(g, new T.BoxGeometry(0.04, 0.05, 0.14), 'spine', p.clone().add(v3(0, 0, -0.1))); proc.quaternion.copy(q);
      if (i < 13) { const d = new T.Mesh(new T.CylinderGeometry(0.07, 0.07, 0.035, 12), new T.MeshStandardMaterial({ color: 0xcfe9ff, transparent: true, opacity: 0.35 })); d.position.copy(sp.getPointAt(t + 0.5 / 13)); d.quaternion.copy(q); g.add(d); }
    }
    // costillas: arcos toroidales abiertos por delante
    for (let i = 0; i < 9; i++) {
      const y = 2.02 - i * 0.12, r = 0.42 + Math.sin((i / 8) * Math.PI) * 0.16;
      const rib = add(g, new T.TorusGeometry(r, 0.018, 6, 40, Math.PI * 1.55), 'spine', v3(0, y, -0.06), { rot: [Math.PI / 2 + 0.12, 0, Math.PI * 0.725] });
      rib.scale.set(1, 0.8, 1);
    }
    add(g, new T.BoxGeometry(0.1, 0.62, 0.04), 'spine', v3(0, 1.62, 0.4));                       // esternón (hueso)
    add(g, new T.TorusGeometry(0.4, 0.06, 10, 36), 'spine', v3(0, -0.12, -0.05), { rot: [1.25, 0, 0], scale: [1.05, 0.8, 1] }); // pelvis
    for (const s of [1, -1]) {
      add(g, new T.SphereGeometry(0.1, 16, 12), 'femur', v3(0.3 * s, -0.27, -0.02));              // cabeza femoral
      add(g, new T.SphereGeometry(0.06, 12, 8), 'femur', v3(0.4 * s, -0.36, -0.02));              // trocánter
      boneBetween(g, v3(0.33 * s, -0.3, -0.02), v3(0.37 * s, -1.78, 0.02), 0.058, 'femur');
      add(g, new T.SphereGeometry(0.085, 14, 10), 'femur', v3(0.37 * s, -1.85, 0.02), { scale: [1.3, 0.8, 1] }); // cóndilos
      boneBetween(g, v3(0.36 * s, -1.95, 0.02), v3(0.36 * s, -3.25, -0.02), 0.045, 'femur');       // tibia
      // riñones: elipsoides en la fosa lumbar + arterias renales desde la aorta
      add(g, new T.SphereGeometry(1, 24, 16), 'kidneys', v3(0.33 * s, 0.55, -0.22), { scale: [0.13, 0.23, 0.1], rot: [0, 0, 0.28 * s] });
      tube(g, [v3(0.02 * s, 0.6, -0.2), v3(0.12 * s, 0.6, -0.21), v3(0.23 * s, 0.57, -0.22)], 0.018, 'kidneys');
      tube(g, [v3(0.3 * s, 0.38, -0.2), v3(0.22 * s, 0.0, -0.08), v3(0.06 * s, -0.25, 0.12)], 0.012, 'kidneys'); // uréter
    }
    add(g, new T.SphereGeometry(0.11, 14, 10), 'kidneys', v3(0, -0.3, 0.22), { scale: [1.1, 0.8, 0.9] }); // vejiga
  }

  function buildCardio(g) {
    const heart = new T.Group(); heart.position.set(0.12, 1.45, 0.14); heart.userData.heart = true; g.add(heart);
    add(heart, new T.SphereGeometry(1, 28, 20), 'heart', v3(0.03, -0.04, 0), { scale: [0.2, 0.26, 0.18], rot: [0, 0, -0.55] }); // VI
    add(heart, new T.SphereGeometry(1, 24, 18), 'heart', v3(-0.1, -0.02, 0.06), { scale: [0.17, 0.21, 0.15], rot: [0, 0, -0.4] }); // VD
    add(heart, new T.SphereGeometry(0.1, 18, 12), 'heart', v3(-0.12, 0.17, 0));    // AD
    add(heart, new T.SphereGeometry(0.09, 18, 12), 'heart', v3(0.08, 0.18, -0.06)); // AI
    groups.heart = heart;
    // pulmones: lóbulos volumétricos (el izquierdo con escotadura cardíaca)
    const lungs = new T.Group(); g.add(lungs); groups.lungs = lungs;
    for (const s of [1, -1]) {
      const x = 0.4 * s;
      add(lungs, new T.SphereGeometry(1, 26, 18), 'lungs', v3(x, 1.78, 0), { scale: [0.27, 0.36, 0.3] });
      add(lungs, new T.SphereGeometry(1, 26, 18), 'lungs', v3(x * (s > 0 ? 1.02 : 1.08), 1.38, -0.02), { scale: [s > 0 ? 0.25 : 0.3, 0.3, 0.29] });
      if (s < 0) add(lungs, new T.SphereGeometry(1, 20, 14), 'lungs', v3(-0.42, 1.12, 0.02), { scale: [0.24, 0.18, 0.25] });
      tube(lungs, [v3(0, 2.15, 0.02), v3(0.08 * s, 1.95, 0.0), v3(0.25 * s, 1.75, 0)], 0.025, 'lungs');   // bronquios
    }
    tube(lungs, [v3(0, 2.6, 0.06), v3(0, 2.15, 0.02)], 0.035, 'lungs');                                    // tráquea
    // aorta (arco + descendente) y carótidas hacia el cráneo
    tube(g, [v3(0.1, 1.62, 0.12), v3(0.06, 1.98, 0.08), v3(-0.06, 2.02, -0.05), v3(-0.04, 1.7, -0.18), v3(0, 0.9, -0.17), v3(0, -0.15, -0.12)], 0.045, 'carotid');
    for (const s of [1, -1]) tube(g, [v3(0.02 * s, 2.0, 0.02), v3(0.12 * s, 2.35, 0.08), v3(0.15 * s, 2.7, 0.04), v3(0.11 * s, 2.92, -0.02)], 0.026, 'carotid');
    // arterias de las piernas (camino del fluido, sin selección)
    const vessel = new T.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.12 });
    for (const s of [1, -1]) tube(g, [v3(0, -0.15, -0.12), v3(0.22 * s, -0.5, 0.05), v3(0.33 * s, -1.8, 0.08), v3(0.34 * s, -3.15, 0.02)], 0.02, null, vessel);
  }

  function buildNeuro(g) {
    for (const s of [1, -1]) {
      add(g, new T.SphereGeometry(1, 30, 22), 'brain', v3(0.1 * s, 3.1, -0.02), { scale: [0.17, 0.23, 0.3] });
      // giros y surcos: icosaedro con desplazamiento en alambre
      const ico = new T.IcosahedronGeometry(1, 3), pos = ico.attributes.position;
      for (let i = 0; i < pos.count; i++) { const v = v3(pos.getX(i), pos.getY(i), pos.getZ(i)); const n = 1 + 0.06 * Math.sin(v.x * 9) * Math.cos(v.y * 11) * Math.sin(v.z * 7); pos.setXYZ(i, v.x * n, v.y * n, v.z * n); }
      const gy = new T.Mesh(ico, new T.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.18 }));
      gy.position.set(0.1 * s, 3.1, -0.02); gy.scale.set(0.175, 0.235, 0.305); gy.userData.organ = 'brain'; g.add(gy);
      add(g, new T.SphereGeometry(0.075, 20, 14), 'eyes', v3(0.15 * s, 2.95, 0.36));
      boneBetween(g, v3(0.15 * s, 2.95, 0.29), v3(0.05 * s, 2.99, 0.06), 0.026, 'eyes');            // nervio óptico (vaina = ONSD)
      // laberinto vestibular: 3 canales semicirculares ortogonales
      for (const rot of [[0, 0, 0], [Math.PI / 2, 0, 0], [0, Math.PI / 2, 0]]) add(g, new T.TorusGeometry(0.055, 0.011, 8, 24), 'vestibular', v3(0.39 * s, 2.98, -0.04), { rot });
      add(g, new T.SphereGeometry(0.03, 10, 8), 'vestibular', v3(0.39 * s, 2.95, -0.04));
      // médula ósea (cresta ilíaca) y ganglios linfáticos cervicales, axilares e inguinales
      add(g, new T.SphereGeometry(0.09, 16, 12), 'marrow', v3(0.32 * s, -0.04, -0.06), { scale: [1.2, 0.7, 0.6] });
      for (const p of [v3(0.15 * s, 2.42, 0.1), v3(0.6 * s, 1.98, 0.02), v3(0.24 * s, -0.42, 0.16)]) add(g, new T.SphereGeometry(0.045, 12, 10), 'marrow', p);
    }
    add(g, new T.BoxGeometry(0.06, 0.55, 0.03), 'marrow', v3(0, 1.62, 0.43));                       // médula del esternón
  }

  /* ---------------------------------------------------------------- partículas */
  function stream(n, curves, color, size, parent) {
    const geo = new T.BufferGeometry(), arr = new Float32Array(n * 3);
    geo.setAttribute('position', new T.BufferAttribute(arr, 3));
    const pts = new T.Points(geo, new T.PointsMaterial({ color, size, transparent: true, opacity: 0.95, depthWrite: false, blending: T.AdditiveBlending }));
    pts.userData = { curves, u: Float32Array.from({ length: n }, () => Math.random()), c: Uint8Array.from({ length: n }, (_, i) => i % curves.length), j: Float32Array.from({ length: n * 3 }, () => (Math.random() - 0.5) * 0.07), speed: 0.12 };
    parent.add(pts); return pts;
  }
  function stepStream(pts, dt) {
    const { curves, u, c, j, speed } = pts.userData, a = pts.geometry.attributes.position;
    for (let i = 0; i < u.length; i++) {
      u[i] = (u[i] + dt * speed * (0.75 + (i % 7) * 0.06)) % 1;
      const p = curves[c[i]].getPointAt(u[i]);
      a.setXYZ(i, p.x + j[i * 3], p.y + j[i * 3 + 1], p.z + j[i * 3 + 2]);
    }
    a.needsUpdate = true;
  }

  /* ---------------------------------------------------------------- init */
  function init(el, pick) {
    if (!T || !T.OrbitControls || !T.CSS2DRenderer) return false;
    try {
      R = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      if (!R.getContext()) return false;
    } catch (e) { return false; }
    container = el; onPick = pick; clock = new T.Clock();
    R.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
    R.setClearColor(0x000000, 0);
    el.appendChild(R.domElement); R.domElement.className = 'c3d';
    labelR = new T.CSS2DRenderer(); labelR.domElement.className = 'c3dl'; el.appendChild(labelR.domElement);
    scene = new T.Scene(); scene.fog = new T.Fog(0x0a0a0c, 14, 30);
    camera = new T.PerspectiveCamera(36, 1, 0.1, 100); camera.position.set(0, 0.4, 10.2);
    controls = new T.OrbitControls(camera, R.domElement);
    controls.target.set(0, 0.1, 0); controls.enableDamping = true; controls.dampingFactor = 0.08; controls.minDistance = 2.2; controls.maxDistance = 22;
    controls.addEventListener('start', () => (fly = null));
    scene.add(new T.AmbientLight(0xb8b8c2, 0.42));                         // luz de estudio neutra (titanio)
    const dl = new T.DirectionalLight(0xfff6ec, 0.85); dl.position.set(3, 6, 6); scene.add(dl);   // luz principal cálida
    const rim = new T.DirectionalLight(0xffffff, 0.55); rim.position.set(-4, 3, -6); scene.add(rim); // contraluz de estudio (rim light)
    const pl = new T.PointLight(0xff5722, 0.25, 14); pl.position.set(-3, -2, 4); scene.add(pl);    // reflejo naranja aeroespacial muy sutil
    // suelo médico: rejilla + anillos brillantes
    const grid = new T.GridHelper(12, 24, 0x34343f, 0x1f1f26); grid.position.y = -3.48; grid.material.transparent = true; grid.material.opacity = 0.9; scene.add(grid);
    const rings = new T.Group(); rings.position.y = -3.46; scene.add(rings); groups.rings = rings;
    for (const [r, o] of [[1.2, 0.5], [2.0, 0.3], [3.0, 0.18], [4.2, 0.1]]) { const m = new T.Mesh(new T.RingGeometry(r, r + 0.012, 128), new T.MeshBasicMaterial({ color: 0xa0a0ab, transparent: true, opacity: o * 0.8, side: T.DoubleSide, blending: T.AdditiveBlending })); m.rotation.x = -Math.PI / 2; rings.add(m); }
    const tick = new T.Mesh(new T.RingGeometry(1.6, 1.64, 64, 1, 0, Math.PI / 3), new T.MeshBasicMaterial({ color: 0xff5722, transparent: true, opacity: 0.85, side: T.DoubleSide, blending: T.AdditiveBlending })); tick.rotation.x = -Math.PI / 2; rings.add(tick);

    for (const k of ['shell', 'skeletal', 'cardio', 'neuro']) { groups[k] = new T.Group(); scene.add(groups[k]); }
    buildShell(groups.shell); buildSkeletal(groups.skeletal); buildCardio(groups.cardio); buildNeuro(groups.neuro);
    // planos holográficos + etiquetas de capa (visibles en vista explotada)
    const layerDef = { skeletal: ["L1 · ESQUELÉTICO / RENAL", "#FF5722", COL.orange], cardio: ["L2 · CARDIO / PULMONAR", "#38BDF8", COL.cyan], neuro: ["L3 · NEURO-OCULAR / INMUNE", "#D4FF33", COL.lime] };
    for (const [k, [txt, css, hex]] of Object.entries(layerDef)) {
      const pg = new T.PlaneGeometry(3.2, 7.4), pm = new T.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0, side: T.DoubleSide, depthWrite: false });
      const plane = new T.Mesh(pg, pm); plane.position.set(0, 0, -0.75);
      const edge = new T.LineSegments(new T.EdgesGeometry(pg), new T.LineBasicMaterial({ color: hex, transparent: true, opacity: 0 })); edge.position.copy(plane.position);
      groups[k].add(plane, edge); planes[k] = { pm, em: edge.material };
      const lab = makeLabel(txt, css, 'lyr'); lab.position.set(0, 3.95, -0.75); lab.element.style.opacity = 0; groups[k].add(lab); labels[k] = lab;
    }
    // corrientes de partículas
    const legCurve = (s) => new T.CatmullRomCurve3([v3(0.34 * s, -3.1, 0.04), v3(0.33 * s, -1.8, 0.08), v3(0.2 * s, -0.45, 0.06), v3(0.02 * s, 0.4, -0.1), v3(0.05 * s, 1.35, 0.1), v3(0.1 * s, 2.3, 0.08), v3(0.08 * s, 3.0, -0.02)]);
    fluid = stream(150, [legCurve(1), legCurve(-1)], 0x38bdf8, 0.075, groups.cardio);
    const caCurve = (s) => new T.CatmullRomCurve3([v3(0.37 * s, -1.5, 0.02), v3(0.36 * s, -0.8, 0), v3(0.42 * s, -0.1, -0.12), v3(0.38 * s, 0.35, -0.2), v3(0.33 * s, 0.55, -0.22)]);
    calcium = stream(120, [caCurve(1), caCurve(-1)], 0xf59e0b, 0.07, groups.skeletal);
    const radCurves = Array.from({ length: 6 }, (_, i) => { const a = (i / 6) * Math.PI * 2; return new T.CatmullRomCurve3([v3(Math.cos(a) * 3, 5.5, Math.sin(a) * 3), v3(Math.cos(a) * 0.6, 1.2 - i * 0.3, Math.sin(a) * 0.4)]); });
    rad = stream(90, radCurves, 0xef4444, 0.06, scene); rad.userData.speed = 0.5;
    // anillo láser de escaneo
    ring = new T.Mesh(new T.TorusGeometry(1.55, 0.018, 8, 120), new T.MeshBasicMaterial({ color: 0xff5722, transparent: true, opacity: 0.95, blending: T.AdditiveBlending }));
    disc = new T.Mesh(new T.CircleGeometry(1.55, 64), new T.MeshBasicMaterial({ color: 0xff5722, transparent: true, opacity: 0.07, side: T.DoubleSide, depthWrite: false, blending: T.AdditiveBlending }));
    ring.rotation.x = disc.rotation.x = Math.PI / 2; scanLight = new T.PointLight(0xff5722, 2.0, 3.5);
    for (const o of [ring, disc, scanLight]) { o.visible = false; scene.add(o); }
    selLabel = makeLabel('', '#ffffff', 'sel'); selLabel.visible = false; scene.add(selLabel);

    // selección por raycasting (clic sin arrastre)
    const ray = new T.Raycaster(), ndc = new T.Vector2(); let down = null;
    const hit = (e) => {
      const r = R.domElement.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hs = ray.intersectObjects(pickables, false).filter((h) => h.object.material.opacity > 0.3 && visibleIn(h.object));
      return hs.length ? hs[0].object.userData.organ : null;
    };
    R.domElement.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
    R.domElement.addEventListener('pointerup', (e) => { if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) { const o = hit(e); if (o && onPick) onPick(o); } down = null; });
    R.domElement.addEventListener('pointermove', (e) => { const o = hit(e); hovered = o; R.domElement.style.cursor = o ? 'pointer' : 'grab'; });
    R.domElement.addEventListener('pointerleave', () => (hovered = null));
    new ResizeObserver(resize).observe(el); resize();
    alive = true; requestAnimationFrame(loop);
    return true;
  }
  function visibleIn(o) { let p = o; while (p) { if (p.visible === false) return false; p = p.parent; } return true; }
  function resize() {
    if (!R) return; const w = container.clientWidth, h = container.clientHeight; if (!w || !h) return;
    R.setSize(w, h); labelR.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
  }

  /* ---------------------------------------------------------------- cámara */
  const VIEWS = {
    all: [v3(0, 0.4, 10.2), v3(0, 0.05, 0)], neuro: [v3(1.3, 3.4, 3.4), v3(0, 2.98, 0)], cardio: [v3(1.8, 1.9, 4.4), v3(0, 1.55, 0)],
    skeletal: [v3(-2.4, 0.2, 5.6), v3(0, -0.3, -0.15)], immune: [v3(2.2, 1.0, 7.2), v3(0, 1.0, 0)],
    exploded: [v3(-6.2, 2.6, 11.5), v3(0.2, 0.1, 0.3)], head: [v3(0.9, 3.3, 4.2), v3(0, 2.9, 0)], chest: [v3(1.4, 1.7, 5), v3(0, 1.5, 0)], pelvis: [v3(-1.6, -0.6, 6), v3(0, -0.6, 0)],
  };
  const SYS_GROUP = { neuro: 'neuro', immune: 'neuro', cardio: 'cardio', skeletal: 'skeletal' };
  function flyTo(key) {
    const [p, t] = VIEWS[key] || VIEWS.all, off = new T.Vector3();
    if (st.exploded && SYS_GROUP[key]) off.copy(EXPLODE[SYS_GROUP[key]]);
    fly = { p: p.clone().add(off), t: t.clone().add(off) };
  }
  const EXPLODE = { skeletal: v3(-2.2, 0, -2.0), cardio: v3(0, 0, 0), neuro: v3(2.2, 0, 2.0), shell: v3(0, 0, 0) };

  /* ---------------------------------------------------------------- estado */
  function update(next) {
    const prev = st; st = { ...st, ...next };
    if (!R) return;
    if (prev.exploded !== st.exploded) flyTo(st.exploded ? (st.filter !== 'all' ? st.filter : 'exploded') : st.filter);
    else if (prev.filter !== st.filter) flyTo(st.filter === 'all' && st.exploded ? 'exploded' : st.filter);
    for (const [k, m] of Object.entries(mats)) {
      const c = COL[st.levels[k] || 'na']; m.color.setHex(c); m.emissive.setHex(c);
      const vis = st.filter === 'all' || ORGAN_SYS[k] === st.filter;
      m.userData.targetOp = vis ? 0.92 : 0.1;
    }
    const bc = st.finger ? COL.ok : COL.na; bracelet.material.color.setHex(bc); bracelet.material.emissive.setHex(bc);
    calcium.visible = st.g < 0.5 && st.reps < 15;
    fluid.visible = st.g < 0.1;
    fluid.userData.speed = (st.co2 > 4 ? 0.34 : 0.13) * (st.cuffs ? 0.45 : 1);
    rad.visible = st.eff > 1 || st.swActive;
    rad.material.opacity = st.swActive ? 1 : 0.7;
    if (st.selected && R) {
      const meshes = pickables.filter((m) => m.userData.organ === st.selected);
      const box = new T.Box3(); meshes.forEach((m) => box.expandByObject(m));
      const c = box.getCenter(new T.Vector3()); selLabel.position.set(c.x, box.max.y + 0.22, c.z);
      selLabel.element.textContent = '◆ ' + NAMES[st.selected]; selLabel.visible = true;
    } else selLabel.visible = false;
  }
  function scan(p, stage) {
    if (!R) return;
    if (p == null) { scanState = null; for (const o of [ring, disc, scanLight]) o.visible = false; flyTo(st.exploded ? 'exploded' : st.filter); return; }
    if (!scanState || scanState.stage !== stage) flyTo(['head', 'chest', 'pelvis', 'all'][stage]);
    scanState = { p, stage };
    const y = 3.55 - 7.05 * p;
    for (const o of [ring, disc]) { o.visible = true; o.position.set(0, y, 0); }
    scanLight.visible = true; scanLight.position.set(0, y, 0.6);
  }

  /* ---------------------------------------------------------------- bucle */
  function loop() {
    if (!alive) return;
    requestAnimationFrame(loop);
    if (!container.offsetParent) return;                       // pestaña oculta: no gastar GPU
    const dt = Math.min(clock.getDelta(), 0.1), t = clock.elapsedTime;
    // latido real: fase avanzada a bpm/60 Hz; pulso sistólico rápido
    if (st.bpm) heartPh = (heartPh + (dt * st.bpm) / 60) % 1;
    const beat = st.bpm ? Math.exp(-Math.pow(heartPh * 7, 2)) + 0.35 * Math.exp(-Math.pow((heartPh - 0.18) * 9, 2)) : 0;
    groups.heart.scale.setScalar(1 + 0.13 * beat);
    const br = Math.sin((t * (st.resp || 14) * 2 * Math.PI) / 60);
    groups.lungs.scale.set(1 + 0.035 * br, 1 + 0.05 * br, 1 + 0.035 * br);
    // explosión de capas (lerp) + planos
    for (const k of ['skeletal', 'cardio', 'neuro', 'shell']) {
      const tgt = st.exploded ? EXPLODE[k] : EXPLODE.shell; groups[k].position.lerp(tgt, 0.08);
      if (planes[k]) { const o = st.exploded ? 1 : 0; planes[k].pm.opacity += (0.06 * o - planes[k].pm.opacity) * 0.1; planes[k].em.opacity += (0.7 * o - planes[k].em.opacity) * 0.1; labels[k].element.style.opacity = planes[k].em.opacity; }
    }
    groups.shell.visible = st.shell !== false;                     // botón "Carcasa" del dock
    // materiales: opacidad por filtro, pulso de órganos críticos, realce al pasar el ratón / seleccionado
    for (const [k, m] of Object.entries(mats)) {
      m.opacity += ((m.userData.targetOp ?? 0.92) - m.opacity) * 0.12;
      const lvl = st.levels[k], base = lvl === 'crit' ? 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 6)) : lvl === 'na' ? 0.15 : 0.32;
      m.emissiveIntensity = base + (hovered === k ? 0.5 : 0) + (st.selected === k ? 0.35 : 0);
    }
    if (fluid.visible) stepStream(fluid, dt);
    if (calcium.visible) stepStream(calcium, dt);
    if (rad.visible) stepStream(rad, dt);
    groups.rings.rotation.y += dt * 0.25;
    if (scanState) ring.rotation.z += dt * 2;
    if (fly) {
      camera.position.lerp(fly.p, 0.06); controls.target.lerp(fly.t, 0.06);
      if (camera.position.distanceTo(fly.p) < 0.02) fly = null;
    }
    controls.update();
    R.render(scene, camera); labelR.render(scene, camera);
  }

  function setShell(on) { st.shell = !!on; }
  global.ARES_3D = { init, update, scan, flyTo, setShell, get shell() { return st.shell !== false; }, _s: () => ({ scene, planes, groups, labels, camera, R }), get ready() { return !!R; }, debug: () => ({ cam: camera.position.toArray().map((x) => +x.toFixed(2)), tgt: controls.target.toArray().map((x) => +x.toFixed(2)), fly: !!fly, groups: Object.fromEntries(["skeletal", "cardio", "neuro"].map((k) => [k, groups[k].position.toArray().map((x) => +x.toFixed(2))])), st: { exploded: st.exploded, filter: st.filter } }) };
})(typeof window !== 'undefined' ? window : globalThis);
