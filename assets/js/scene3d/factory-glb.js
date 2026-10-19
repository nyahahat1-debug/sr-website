// ─────────────────────────────────────────────────────────────
// GLB 에셋 기반 공장 (factory.glb + module.glb + layout.json)
// docs/3D_에셋_제작명세.md 의 노드 이름 규칙을 읽어 factory.js 와 동일한 인터페이스로 돌려준다.
// 로드 실패(파일 없음·노드 누락·디코더 오류)는 예외로 던지고, main.js 가 박스 모델로 폴백한다.
// ─────────────────────────────────────────────────────────────
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { createFlow, defaultRoutes } from './flow.js';

const REQUIRED = ['building_walls', 'building_roof', 'inverter', 'transformer', 'switchgear', 'ess', 'grid_pole', 'load_1', 'load_2', 'load_3'];
const PICK_KEYS = { inverter: 'inverter', transformer: 'transformer', switchgear: 'switchgear', ess: 'ess', grid_pole: 'grid', load_1: 'load', load_2: 'load', load_3: 'load' };
const LABELS = [
  ['flow_pv', 'modules', '태양광 모듈 ({N}장)', [0, 1.4, -2]],
  ['inverter', 'inverter', '인버터', [0, 1.2, 0]],
  ['transformer', 'transformer', '수전설비 (변압기·수배전반)', [1.6, 1.2, 0]],
  ['load_2', 'load', '공장 부하 (자가소비)', [0, 1.2, 0]],
  ['ess', 'ess', 'ESS (선택 설비)', [0, 1.2, 0]],
  ['grid_pole', 'grid', '한전 계통', [0, 1.2, 0]],
];

export async function loadFactoryGLB(THREE, { shadows = true, base = 'assets/models/', dracoPath = 'assets/vendor/three/addons/libs/draco/gltf/' } = {}) {
  const draco = new DRACOLoader(); draco.setDecoderPath(dracoPath);
  const loader = new GLTFLoader(); loader.setDRACOLoader(draco);
  // 모델은 models.js(base64 내장)를 우선 사용 — 정적 호스팅의 .glb MIME 제약 회피. 없으면 .glb 파일을 직접 받는다.
  let fac, mod, layout;
  try {
    const M = await import('../../models/models.js');
    [fac, mod] = await Promise.all([loader.parseAsync(M.toArrayBuffer(M.FACTORY_GLB_B64), base), loader.parseAsync(M.toArrayBuffer(M.MODULE_GLB_B64), base)]);
    layout = M.LAYOUT;
  } catch (e) {
    console.warn('[sr3d] models.js 사용 불가 → .glb 직접 로드:', e && e.message);
    [fac, mod, layout] = await Promise.all([
      loader.loadAsync(base + 'factory.glb'),
      loader.loadAsync(base + 'module.glb'),
      fetch(base + 'layout.json').then(r => { if (!r.ok) throw new Error('layout.json ' + r.status); return r.json(); }),
    ]);
  }

  const group = new THREE.Group(); group.name = 'factory-glb';
  group.add(fac.scene);
  const byName = {};
  fac.scene.traverse(o => { byName[o.name] = o; if (o.isMesh) { o.castShadow = shadows; o.receiveShadow = shadows; } });
  const missing = REQUIRED.filter(n => !byName[n]);
  if (missing.length) throw new Error('GLB 노드 누락: ' + missing.join(', '));
  if (byName.ground) { byName.ground.castShadow = false; }

  // ── 외벽 투명화 대상 (머티리얼 복제: 다른 노드와 공유 방지)
  // 외벽·띠창 (동이 여러 개면 building_walls_2 … 도 포함)
  const wallMats = Object.keys(byName).filter(n => /^building_(walls|band)(_\d+)?$/.test(n)).map(n => {
    const o = byName[n]; o.material = o.material.clone(); o.material.transparent = true; return o.material;
  });
  function setWallOpacity(v) {
    v = Math.min(1, Math.max(0, v)); const t = v < 0.999;
    wallMats.forEach(m => { m.opacity = v; m.depthWrite = !t; });
  }

  // ── 피킹 대상 (각자 머티리얼 인스턴스 + emissive 준비)
  const pickables = [];
  const loads = [];
  for (const [n, key] of Object.entries(PICK_KEYS)) {
    const o = byName[n]; if (!o) continue;
    o.userData.key = key; o.material = o.material.clone();
    if (!o.material.emissive) o.material.emissive = new THREE.Color(0);
    pickables.push(o);
    if (key === 'load') { o.material.emissive.setHex(0x0077B6); o.material.emissiveIntensity = 0; loads.push(o); }
  }

  // ── 모듈: module.glb 메시 1개 → InstancedMesh (layout.json 배치)
  let modMesh = null; mod.scene.traverse(o => { if (o.isMesh && !modMesh) modMesh = o; });
  if (!modMesh) throw new Error('module.glb 에 메시가 없음');
  const base_ = layout.modules; const count = base_.length;
  const rows = layout.rows || Math.max(...base_.map(m => m.r)) + 1, cols = layout.cols || Math.max(...base_.map(m => m.c)) + 1;
  const orderOf = b => (b.order != null ? b.order : b.c * rows + b.r) / count;   // layout 에 order 가 있으면 동·스트립 순서 그대로
  const modules = new THREE.InstancedMesh(modMesh.geometry, modMesh.material, count);
  modules.name = 'modules'; modules.userData.key = 'modules';
  modules.castShadow = shadows; modules.receiveShadow = shadows;
  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  const _qTilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(layout.tilt_deg ?? 12), 0, 0)); // 앞(+z)이 낮게
  const white = new THREE.Color(1, 1, 1);
  for (let i = 0; i < count; i++) modules.setColorAt(i, white);
  let installedLevel = -1;
  function setInstalled(a) {
    a = Math.min(1, Math.max(0, a)); if (a === installedLevel) return; installedLevel = a;
    for (let i = 0; i < count; i++) {
      const b = base_[i];
      const order = orderOf(b);                                 // 동 순서(6번→3-2→7번) · 스트립(서→동) · 각 스트립 북→남
      const k = Math.min(1, Math.max(0, (a - order * 0.82) / 0.18));
      const e = 1 - Math.pow(1 - k, 3);
      _p.set(b.x, b.y + (1 - e) * 6, b.z);
      const sc = Math.max(e, 0.001); _s.set(sc, sc, sc);
      _m.compose(_p, _qTilt, _s); modules.setMatrixAt(i, _m);
    }
    modules.instanceMatrix.needsUpdate = true;
  }
  setInstalled(1); group.add(modules);

  // ── 전력 흐름: flow_* Empty 를 앵커로
  const anchors = {};
  Object.keys(byName).forEach(n => { if (n.startsWith('flow_')) anchors[n] = byName[n].getWorldPosition(new THREE.Vector3()); });
  const flow = createFlow(THREE, defaultRoutes(anchors), { loads });
  group.add(flow.group);

  // ── 라벨 위치: 노드 바운딩 박스 상단 + 오프셋
  const _box = new THREE.Box3();
  const labels = LABELS.filter(([n]) => byName[n]).map(([n, key, text, off]) => {
    const o = byName[n]; let pos;
    if (o.isMesh) { _box.setFromObject(o); pos = new THREE.Vector3((_box.min.x + _box.max.x) / 2, _box.max.y, (_box.min.z + _box.max.z) / 2); }
    else pos = o.getWorldPosition(new THREE.Vector3());
    return { key, text: text.replace('{N}', count.toLocaleString('ko-KR')), pos: pos.add(new THREE.Vector3(...off)) };
  });

  function dispose() {
    group.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
    });
    flow.dispose(); draco.dispose();
    if (group.parent) group.parent.remove(group);
  }

  return {
    kind: 'glb', group, modules, moduleCount: count, pickables: [modules, ...pickables], labels,
    scale: layout.building ? 0.8 * Math.max(layout.building.w, layout.building.d) / 48 : 1, building: layout.building || null,   // 긴 건물은 0.8배로 조금 가깝게
    moduleAt: i => base_[i],
    setInstalled, setWallOpacity, setFlow: flow.setFlow, animateFlow: flow.animateFlow, dispose,
    get installed() { return installedLevel; }, get flow() { return flow.level; },
    nodes: byName,
  };
}
