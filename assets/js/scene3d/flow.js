// 전력 흐름 표현: 경로(CatmullRom) 튜브 + 이동 입자 (박스 모델·GLB 모델 공용)
// routes: [{ pts: [[x,y,z], ...], n: 입자 수, speed }]
export function createFlow(THREE, routes, { loads = [] } = {}) {
  const group = new THREE.Group(); group.name = 'flow';
  const disposables = [];
  const track = o => { disposables.push(o); return o; };
  const tubeMat = track(new THREE.MeshBasicMaterial({ color: 0x00B4D8, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
  const partMat = track(new THREE.MeshBasicMaterial({ color: 0x90E0EF, transparent: true, opacity: 0, toneMapped: false }));
  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _q = new THREE.Quaternion();

  let total = 0;
  const flows = routes.map(r => {
    const curve = new THREE.CatmullRomCurve3(r.pts.map(p => new THREE.Vector3(...p)), false, 'catmullrom', 0.3);
    const f = { curve, n: r.n, speed: r.speed, off: total }; total += r.n;
    group.add(new THREE.Mesh(track(new THREE.TubeGeometry(curve, 40, 0.09, 6, false)), tubeMat));
    return f;
  });
  const parts = new THREE.InstancedMesh(track(new THREE.SphereGeometry(0.18, 8, 8)), partMat, total);
  parts.frustumCulled = false; group.add(parts); group.visible = false;

  let level = 0;
  function setFlow(v) {
    v = Math.min(1, Math.max(0, v)); level = v;
    group.visible = v > 0.01;
    tubeMat.opacity = 0.42 * v; partMat.opacity = v;
    loads.forEach(l => { l.material.emissiveIntensity = 0.7 * v; l.material.userData.ei = 0.7 * v; });
  }
  function animateFlow(t) {
    if (!group.visible) return;
    for (const f of flows) for (let i = 0; i < f.n; i++) {
      f.curve.getPointAt(((t * f.speed) + i / f.n) % 1, _p);
      _m.compose(_p, _q, _s); parts.setMatrixAt(f.off + i, _m);
    }
    parts.instanceMatrix.needsUpdate = true;
  }
  animateFlow(0);
  return { group, setFlow, animateFlow, get level() { return level; }, dispose() { disposables.forEach(d => d.dispose()); } };
}

/** 박스 모델·GLB 공통 기본 경로. anchors 에 같은 이름이 있으면 그 좌표로 끝점을 교체한다. */
export function defaultRoutes(anchors = {}) {
  const A = (name, fallback) => anchors[name] ? [anchors[name].x, anchors[name].y, anchors[name].z] : fallback;
  const pv = A('flow_pv', [6, 12.4, 0]), inv = A('flow_inv', [24.9, 3.2, -9.5]), sg = A('flow_sg', [32.4, 0.5, -15.2]);
  const l1 = A('flow_load_1', [-14, 1.5, 0]), l2 = A('flow_load_2', [0, 1.5, 0]), l3 = A('flow_load_3', [14, 1.5, 0]);
  const ess = A('flow_ess', [-32, 0.5, 8]), grid = A('flow_grid', [43.4, 10.8, -27.8]);
  // 경유점은 앵커 사이 상대 위치 — 건물 크기가 달라도 경로가 따라간다. s = 48 m 건물 대비 배율
  const s = Math.max(1, Math.hypot(sg[0] - l1[0], sg[2] - l1[2]) / 47);
  const mid = (a, b, t, y) => [a[0] + (b[0] - a[0]) * t, y, a[2] + (b[2] - a[2]) * t];
  return [
    { pts: [pv, mid(pv, inv, 0.5, pv[1]), inv], n: Math.round(8 * s), speed: 0.35 / s },                                    // 모듈 → 지붕 인버터
    { pts: [inv, [inv[0], pv[1] - 1, inv[2]], [sg[0], pv[1] - 1, inv[2]], [sg[0], 4, sg[2]], sg], n: Math.round(8 * s), speed: 0.4 / s }, // 인버터 → 수배전반 (지붕 따라 → 전기실로 하강)
    { pts: [sg, [sg[0] - 6 * s, 0.5, sg[2]], l3, l2, l1], n: Math.round(12 * s), speed: 0.3 / s },                          // → 부하 (건물 내부)
    { pts: [sg, [sg[0], 0.4, sg[2] - 8 * s], mid(sg, ess, 0.5, 0.4), ess], n: Math.round(12 * s), speed: 0.3 / s },          // → ESS
    { pts: [sg, mid(sg, grid, 0.5, 1.0), grid], n: Math.round(6 * s), speed: 0.35 / s },                                     // → 한전
  ];
}
