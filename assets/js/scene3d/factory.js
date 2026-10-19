// ─────────────────────────────────────────────────────────────
// 임시 3D 공장 (프로토타입용 박스 모델)
//
// 지시서 4항: "우선 단순한 박스형 건물과 반복 배치된 모듈로 프로토타입을 제작한다."
// 실제 GLB 에셋이 오면 이 파일의 buildFactory() 만 교체하면 되도록,
// 외부에 노출하는 인터페이스(setInstalled/setWallOpacity/setFlow/animateFlow/pickables/labels)를 고정한다.
// 단위: 1 = 1 m, Y-up, 원점 = 주 건물 바닥 중심.
// ─────────────────────────────────────────────────────────────

export function buildFactory(THREE, { shadows = true } = {}) {
  const group = new THREE.Group();
  group.name = 'factory';
  const disposables = [];
  const track = o => { disposables.push(o); return o; };
  const std = o => track(new THREE.MeshStandardMaterial(o));
  const basic = o => track(new THREE.MeshBasicMaterial(o));
  const geo = g => track(g);
  const mesh = (g, m, { pos = [0, 0, 0], rot = null, cast = shadows, recv = shadows, name = '', key = null } = {}) => {
    const mm = new THREE.Mesh(g, m);
    mm.position.set(...pos); if (rot) mm.rotation.set(...rot);
    mm.castShadow = cast; mm.receiveShadow = recv;
    if (name) mm.name = name; if (key) mm.userData.key = key;
    return mm;
  };

  // ── 조명 ─────────────────────────────────────────────
  group.add(new THREE.HemisphereLight(0xBFD8EA, 0x0D1B2A, 0.55));
  const sun = new THREE.DirectionalLight(0xFFF2DC, 2.2);
  sun.position.set(60, 80, 30);
  sun.castShadow = shadows;
  if (shadows) {
    sun.shadow.mapSize.set(2048, 2048);
    const c = sun.shadow.camera; c.left = -75; c.right = 75; c.top = 75; c.bottom = -75; c.near = 10; c.far = 260;
    sun.shadow.bias = -0.0006;
  }
  group.add(sun);
  group.add(new THREE.AmbientLight(0x90AFC4, 0.18));

  // ── 지면 ─────────────────────────────────────────────
  group.add(mesh(geo(new THREE.PlaneGeometry(600, 600)), std({ color: 0x12243A, roughness: 1 }), { rot: [-Math.PI / 2, 0, 0], cast: false }));
  const grid = new THREE.GridHelper(400, 80, 0x2B4A6B, 0x1D3550);
  grid.position.y = 0.02; grid.material.transparent = true; grid.material.opacity = 0.35;
  track(grid.material); track(grid.geometry); group.add(grid);
  group.add(mesh(geo(new THREE.PlaneGeometry(130, 90)), std({ color: 0x1A2E44, roughness: 0.95 }), { pos: [6, 0.03, -2], rot: [-Math.PI / 2, 0, 0], cast: false }));

  // ── 주 건물 (48 × 11 × 26) ─────────────────────────────
  const W = 48, H = 11, D = 26;
  const wallMat = std({ color: 0xB9C8D8, roughness: 0.85, transparent: true, opacity: 1 });
  const bandMat = std({ color: 0x3B5068, roughness: 0.6, metalness: 0.2, transparent: true, opacity: 1 });
  const walls = mesh(geo(new THREE.BoxGeometry(W, H, D)), wallMat, { pos: [0, H / 2, 0], name: 'walls' });
  const band = mesh(geo(new THREE.BoxGeometry(W + 0.1, 1.6, D + 0.1)), bandMat, { pos: [0, 7.2, 0], cast: false });
  const roof = mesh(geo(new THREE.BoxGeometry(W + 0.8, 0.6, D + 0.8)), std({ color: 0x8FA5BB, roughness: 0.8 }), { pos: [0, H + 0.3, 0] });
  const floor = mesh(geo(new THREE.PlaneGeometry(W - 1, D - 1)), std({ color: 0x263B52, roughness: 1 }), { pos: [0, 0.06, 0], rot: [-Math.PI / 2, 0, 0], cast: false });
  group.add(walls, band, roof, floor);

  // 부속동 (전기실 등)
  group.add(mesh(geo(new THREE.BoxGeometry(14, 7, 12)), std({ color: 0xA9B9C9, roughness: 0.85 }), { pos: [31, 3.5, 0] }));
  group.add(mesh(geo(new THREE.BoxGeometry(14.6, 0.4, 12.6)), std({ color: 0x8FA5BB }), { pos: [31, 7.2, 0] }));
  [[27, -3], [31, 2], [35, -2]].forEach(([x, z]) =>
    group.add(mesh(geo(new THREE.BoxGeometry(2.2, 1.2, 2.2)), std({ color: 0x7F93A8 }), { pos: [x, 8, z] })));

  // ── 태양광 모듈 (InstancedMesh 180장) ──────────────────
  const ROWS = 10, COLS = 18, count = ROWS * COLS;
  const PX = 2.4, PZ = 2.2;
  const Y = H + 0.6 + 0.55;
  const X0 = -((COLS - 1) * PX) / 2, Z0 = -((ROWS - 1) * PZ) / 2;
  const base = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) base.push({ x: X0 + c * PX, y: Y, z: Z0 + r * PZ, r, c });

  const modTex = track(makeModuleTexture(THREE));
  const modules = new THREE.InstancedMesh(geo(new THREE.BoxGeometry(2.28, 0.05, 1.13)), std({ map: modTex, roughness: 0.4, metalness: 0.35 }), count);
  modules.name = 'modules'; modules.userData.key = 'modules';
  modules.castShadow = shadows; modules.receiveShadow = shadows;
  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  const _qTilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.21, 0, 0)); // +X 회전: 앞쪽(+z, 카메라·남향) 가장자리가 낮아지도록
  const _qI = new THREE.Quaternion();
  const white = new THREE.Color(1, 1, 1);
  for (let i = 0; i < count; i++) modules.setColorAt(i, white);

  let installedLevel = -1;
  /** 설치 진행 0~1. 뒷줄부터 순서대로 내려앉으며 커진다. */
  function setInstalled(a) {
    a = Math.min(1, Math.max(0, a));
    if (a === installedLevel) return;
    installedLevel = a;
    for (let i = 0; i < count; i++) {
      const b = base[i];
      const order = (b.r * COLS + b.c) / count;   // 뒷줄(-z)부터 카메라 쪽(+z)으로, 각 줄은 왼쪽→오른쪽
      const k = Math.min(1, Math.max(0, (a - order * 0.82) / 0.18));
      const e = 1 - Math.pow(1 - k, 3);
      _p.set(b.x, b.y + (1 - e) * 6, b.z);
      const sc = Math.max(e, 0.001); _s.set(sc, sc, sc);
      _m.compose(_p, _qTilt, _s);
      modules.setMatrixAt(i, _m);
    }
    modules.instanceMatrix.needsUpdate = true;
  }
  setInstalled(1);
  group.add(modules);

  // 구조물: 레일 + 포스트
  const railMat = std({ color: 0x7E8E9E, metalness: 0.6, roughness: 0.4 });
  const rails = new THREE.InstancedMesh(geo(new THREE.BoxGeometry((COLS - 1) * PX + 2.4, 0.1, 0.1)), railMat, ROWS * 2);
  let ri = 0;
  for (let r = 0; r < ROWS; r++) for (const dz of [-0.42, 0.42]) {
    _p.set(0, Y - 0.08 + (dz < 0 ? 0.09 : -0.09), Z0 + r * PZ + dz); _s.set(1, 1, 1);
    _m.compose(_p, _qI, _s); rails.setMatrixAt(ri++, _m);
  }
  rails.castShadow = shadows; group.add(rails);
  const posts = new THREE.InstancedMesh(geo(new THREE.CylinderGeometry(0.05, 0.05, 0.6, 6)), railMat, ROWS * 7);
  let pi = 0;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c += 3) {
    _p.set(X0 + c * PX + 1.2, Y - 0.35, Z0 + r * PZ); _s.set(1, 1, 1);
    _m.compose(_p, _qI, _s); posts.setMatrixAt(pi++, _m);
  }
  posts.count = pi; group.add(posts);

  // ── 설비 ─────────────────────────────────────────────
  const eq = {};
  function cabinet(key, name, size, pos, color) {
    const m = std({ color, roughness: 0.55, metalness: 0.3, emissive: 0x000000, emissiveIntensity: 0 });
    const mm = mesh(geo(new THREE.BoxGeometry(...size)), m, { pos, key, name });
    eq[key] = eq[key] || []; eq[key].push(mm); group.add(mm);
    return mm;
  }
  cabinet('inverter', '인버터', [1.3, 1.7, 0.55], [24.3, 2.3, -9.5], 0x4A5F75);
  group.add(mesh(geo(new THREE.BoxGeometry(0.9, 0.08, 0.05)), basic({ color: 0x00B4D8, toneMapped: false }), { pos: [24.3, 2.9, -9.2], cast: false }));
  cabinet('transformer', '변압기', [2.4, 2.0, 1.8], [30, 1.0, -16], 0x55687C);
  for (let i = 0; i < 3; i++) group.add(mesh(geo(new THREE.BoxGeometry(0.2, 1.4, 1.9)), std({ color: 0x44566A }), { pos: [29.2 + i * 0.8, 1.0, -17.05], cast: false }));
  cabinet('switchgear', '수배전반', [1.5, 2.2, 0.9], [33.2, 1.1, -16], 0x5A6E84);
  cabinet('ess', 'ESS (선택)', [6.1, 2.9, 2.44], [-32, 1.45, 10], 0x5B6E82);
  group.add(mesh(geo(new THREE.BoxGeometry(6.12, 0.3, 2.46)), basic({ color: 0x0077B6, toneMapped: false }), { pos: [-32, 2.2, 10], cast: false }));
  const loads = [-14, 0, 14].map(x => cabinet('load', '공장 부하', [6, 3, 3], [x, 1.5, 0], 0x3A5068));
  loads.forEach(l => { l.material.emissive.setHex(0x0077B6); l.material.emissiveIntensity = 0; });
  // 한전 전주 + 인입선
  const pole = cabinet('grid', '한전 계통', [0.36, 12, 0.36], [44, 6, -28], 0x6B7A8A);
  group.add(mesh(geo(new THREE.BoxGeometry(2.6, 0.16, 0.16)), std({ color: 0x6B7A8A }), { pos: [44, 11.4, -28] }));
  const wire = new THREE.Line(
    track(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(43, 11.3, -28), new THREE.Vector3(30.5, 2.1, -16.2)])),
    track(new THREE.LineBasicMaterial({ color: 0x7F93A8 })));
  group.add(wire);

  // ── 전력 흐름 (튜브 + 입자) ─────────────────────────────
  const flows = [
    { pts: [[6, 12.4, 0], [22, 12.4, -6], [24.9, 7, -9.5], [24.9, 3.2, -9.5]], n: 9, speed: 0.35 },      // 모듈 → 인버터
    { pts: [[24.9, 2.3, -9.5], [27, 0.4, -12], [32.4, 0.5, -15.2]], n: 5, speed: 0.4 },                  // 인버터 → 수배전반
    { pts: [[33.2, 0.4, -15.2], [26, 0.4, -10], [20, 0.5, -6], [14, 1.5, 0], [0, 1.5, 0], [-14, 1.5, 0]], n: 10, speed: 0.3 }, // → 부하
    { pts: [[33.2, 0.4, -17], [30, 0.3, -22], [0, 0.3, -20], [-30, 0.3, -6], [-32, 0.5, 8]], n: 10, speed: 0.3 },           // → ESS
    { pts: [[33.6, 1.2, -16.5], [38, 0.8, -22], [43.4, 10.8, -27.8]], n: 5, speed: 0.35 },                // → 한전
  ];
  const flowGroup = new THREE.Group(); flowGroup.name = 'flow';
  const tubeMat = basic({ color: 0x00B4D8, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
  let total = 0;
  flows.forEach(f => {
    f.curve = new THREE.CatmullRomCurve3(f.pts.map(p => new THREE.Vector3(...p)), false, 'catmullrom', 0.3);
    f.off = total; total += f.n;
    flowGroup.add(new THREE.Mesh(geo(new THREE.TubeGeometry(f.curve, 40, 0.09, 6, false)), tubeMat));
  });
  const partMat = basic({ color: 0x90E0EF, transparent: true, opacity: 0, toneMapped: false });
  const parts = new THREE.InstancedMesh(geo(new THREE.SphereGeometry(0.18, 8, 8)), partMat, total);
  parts.frustumCulled = false;
  flowGroup.add(parts); flowGroup.visible = false; group.add(flowGroup);

  let flowLevel = 0;
  function setFlow(v) {
    v = Math.min(1, Math.max(0, v));
    flowLevel = v;
    flowGroup.visible = v > 0.01;
    tubeMat.opacity = 0.42 * v; partMat.opacity = v;
    loads.forEach(l => { l.material.emissiveIntensity = 0.7 * v; l.material.userData.ei = 0.7 * v; });
  }
  function animateFlow(t) {
    if (!flowGroup.visible) return;
    flows.forEach(f => {
      for (let i = 0; i < f.n; i++) {
        const u = ((t * f.speed) + i / f.n) % 1;
        f.curve.getPointAt(u, _p); _s.set(1, 1, 1);
        _m.compose(_p, _qI, _s); parts.setMatrixAt(f.off + i, _m);
      }
    });
    parts.instanceMatrix.needsUpdate = true;
  }
  animateFlow(0);

  function setWallOpacity(o) {
    o = Math.min(1, Math.max(0, o));
    const t = o < 0.999;
    wallMat.opacity = o; bandMat.opacity = o;
    wallMat.depthWrite = !t; bandMat.depthWrite = !t;
  }

  // ── 외부 인터페이스 ─────────────────────────────────────
  const pickables = [modules, ...eq.inverter, ...eq.transformer, ...eq.switchgear, ...eq.ess, ...loads, pole];
  const labels = [
    { key: 'modules', text: '태양광 모듈 (180장 · 데모)', pos: new THREE.Vector3(0, Y + 1.8, -2) },
    { key: 'inverter', text: '인버터', pos: new THREE.Vector3(24.3, 4.6, -9.5) },
    { key: 'transformer', text: '수전설비 (변압기·수배전반)', pos: new THREE.Vector3(31.6, 4.1, -16) },
    { key: 'load', text: '공장 부하 (자가소비)', pos: new THREE.Vector3(0, 4.6, 0) },
    { key: 'ess', text: 'ESS (선택 설비)', pos: new THREE.Vector3(-32, 4.7, 10) },
    { key: 'grid', text: '한전 계통', pos: new THREE.Vector3(44, 13.4, -28) },
  ];

  function dispose() {
    group.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
    });
    disposables.forEach(d => d.dispose && d.dispose());
    if (group.parent) group.parent.remove(group);
  }

  return {
    group, modules, moduleCount: count, pickables, labels,
    moduleAt: i => base[i],
    setInstalled, setWallOpacity, setFlow, animateFlow, dispose,
    get installed() { return installedLevel; }, get flow() { return flowLevel; },
  };
}

/** 모듈 셀 패턴 텍스처 (캔버스로 생성 — 외부 이미지 의존 없음) */
function makeModuleTexture(THREE) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#0B2140'; g.fillRect(0, 0, 256, 128);
  g.strokeStyle = '#2E5A8A'; g.lineWidth = 1;
  for (let i = 1; i < 12; i++) { g.beginPath(); g.moveTo(i * 256 / 12, 0); g.lineTo(i * 256 / 12, 128); g.stroke(); }
  for (let j = 1; j < 6; j++) { g.beginPath(); g.moveTo(0, j * 128 / 6); g.lineTo(256, j * 128 / 6); g.stroke(); }
  g.strokeStyle = '#8DA3B8'; g.lineWidth = 4; g.strokeRect(2, 2, 252, 124);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
