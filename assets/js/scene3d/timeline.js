// ─────────────────────────────────────────────────────────────
// 스크롤 진행률 p(0~1) → 장면 상태
//
// 설계 원칙: 이 파일의 모든 함수는 "순수 함수"다. 같은 p 를 넣으면 항상 같은 상태가 나온다.
// 그래서 정방향/역방향 스크롤, 점프, 새로고침 후 중간 위치 복원이 전부 자동으로 맞는다.
// (GSAP ScrollTrigger 없이도 되돌리기가 정확한 이유 — Phase 1 문서 ADR-C 참고)
// ─────────────────────────────────────────────────────────────

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const stepf = t => (t >= 0.5 ? 1 : 0);

/** 6개 장면의 진행률 구간 */
export const SCENES = [
  { id: 1, a: 0.00, b: 0.14, title: '현장 영상' },
  { id: 2, a: 0.14, b: 0.28, title: '현장 모델링' },
  { id: 3, a: 0.28, b: 0.52, title: '설계·시공' },
  { id: 4, a: 0.52, b: 0.72, title: '전력 흐름' },
  { id: 5, a: 0.72, b: 0.88, title: '경제성 (데모)' },
  { id: 6, a: 0.88, b: 1.00, title: '시공 사례·상담' },
];
export const sceneOf = p => SCENES.find(s => p <= s.b) || SCENES[SCENES.length - 1];

/**
 * 카메라 키프레임. 전부 건물 바깥(타깃에서 40m 이상)에 둔다.
 * 키프레임 사이는 "구면 보간"(타깃 중심 궤도)으로 움직이므로 직선 경로가 건물을 관통하는 일이 없다.
 */
export const CAMERA_KEYS = [
  { p: 0.00, pos: [76, 58, 98], tgt: [0, 4, 0], zoom: 1.0 },
  { p: 0.14, pos: [76, 58, 98], tgt: [0, 4, 0], zoom: 1.0 },
  { p: 0.28, pos: [16, 96, 44], tgt: [0, 9, 0], zoom: 0.75 },   // S3 시작: 지붕을 내려다보는 높은 시점 (전체 부지 조감)
  { p: 0.42, pos: [-12, 84, 56], tgt: [0, 9, 0], zoom: 0.7 },   // 모듈이 깔리는 동안 높이 유지하며 살짝 선회
  { p: 0.52, pos: [-34, 30, 52], tgt: [2, 8, 0], zoom: 0.45 },  // 설치 마무리와 함께 서서히 내려오며 대표 동으로 접근
  { p: 0.72, pos: [36, 17, 42], tgt: [6, 4, -2], zoom: 0.4 },
  { p: 0.88, pos: [-28, 15, 46], tgt: [-4, 5, 2], zoom: 0.45 },
  { p: 1.00, pos: [64, 36, 84], tgt: [0, 4, 0], zoom: 0.85 },
];
/** 긴 부지(여러 동)에서는 키프레임의 zoom 배율로 타깃에 접근시킨다 (단일 건물 모델에서는 zoom 미적용) */
export function zoomKey(k, on) {
  if (!on || !k.zoom || k.zoom === 1) return k;
  return { ...k, pos: k.pos.map((v, i) => k.tgt[i] + (v - k.tgt[i]) * k.zoom) };
}

// ── 구면 좌표 유틸 (three.js Spherical 과 같은 규약: phi = +y 기준, theta = atan2(x, z))
export function toSph(pos, tgt) {
  const x = pos[0] - tgt[0], y = pos[1] - tgt[1], z = pos[2] - tgt[2];
  const r = Math.hypot(x, y, z) || 1e-6;
  return { r, phi: Math.acos(clamp(y / r, -1, 1)), theta: Math.atan2(x, z) };
}
export function fromSph(s, tgt) {
  const sp = Math.sin(s.phi);
  return [tgt[0] + s.r * sp * Math.sin(s.theta), tgt[1] + s.r * Math.cos(s.phi), tgt[2] + s.r * sp * Math.cos(s.theta)];
}
/** 두 카메라 포즈를 타깃 중심 궤도로 보간 (theta 는 최단 경로) */
export function lerpPose(A, B, t) {
  const tgt = [0, 1, 2].map(i => A.tgt[i] + (B.tgt[i] - A.tgt[i]) * t);
  const a = toSph(A.pos, A.tgt), b = toSph(B.pos, B.tgt);
  let dth = b.theta - a.theta;
  dth = ((dth + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  const s = { r: a.r + (b.r - a.r) * t, phi: a.phi + (b.phi - a.phi) * t, theta: a.theta + dth * t };
  return { pos: fromSph(s, tgt), tgt };
}
/** 포즈를 월드 스케일(건물 가로/48)로 확대. 키프레임은 48 m 건물 기준으로 작성돼 있다. */
export const scalePose = (pose, s) => s === 1 ? pose : { pos: pose.pos.map(v => v * s), tgt: pose.tgt.map(v => v * s) };

/** 포즈를 허용 범위(거리·앙각) 안으로 밀어 넣는다 — 모드 전환 시 충돌 방지 */
export function clampPose(pose, { minR = 42, maxR = 160, minPhi = 0.15, maxPhi = 1.42 } = {}) {
  const s = toSph(pose.pos, pose.tgt);
  s.r = clamp(s.r, minR, maxR); s.phi = clamp(s.phi, minPhi, maxPhi);
  return { pos: fromSph(s, pose.tgt), tgt: [...pose.tgt] };
}

/** p 에서의 스토리 카메라 포즈. reduce(동작 줄이기) 면 보간 없이 구간 시작 키프레임으로 고정 */
export function cameraAt(p, reduce = false, zoom = false) {
  p = clamp(p, 0, 1);
  const K = CAMERA_KEYS; let i = 0;
  while (i < K.length - 2 && p > K[i + 1].p) i++;
  const A = zoomKey(K[i], zoom), B = zoomKey(K[i + 1], zoom);
  if (reduce) return { pos: [...A.pos], tgt: [...A.tgt] };
  return lerpPose(A, B, smooth((p - A.p) / (B.p - A.p)));
}

function ramp(p, a, b, reduce) {
  if (b <= a) return p >= b ? 1 : 0;
  const t = (p - a) / (b - a);
  return reduce ? stepf(t) : smooth(t);
}
/** [a,b] 창 안에서 1, 양끝 fi/fo 만큼 페이드. reduce 면 페이드 없이 on/off */
function win(p, a, b, fi, fo, reduce) {
  if (p < a || p > b) return 0;
  if (reduce) return (p < b || b >= 1) ? 1 : 0;
  const i = fi > 0 ? ramp(p, a, a + fi, false) : 1;
  const o = fo > 0 ? 1 - ramp(p, b - fo, b, false) : 1;
  return Math.min(i, o);
}

/** 진행률 → 모든 화면 상태. UI/3D 는 이 결과만 읽는다. */
export function evaluate(p, reduce = false) {
  p = clamp(p, 0, 1);
  const R = (a, b) => ramp(p, a, b, reduce);
  const text = [
    win(p, 0.00, 0.14, 0.00, 0.05, reduce),
    win(p, 0.14, 0.28, 0.05, 0.04, reduce),
    win(p, 0.28, 0.52, 0.05, 0.04, reduce),
    win(p, 0.52, 0.72, 0.05, 0.04, reduce),
    win(p, 0.72, 0.88, 0.05, 0.04, reduce),
    win(p, 0.88, 1.00, 0.05, 0.00, reduce),
  ];
  return {
    p,
    scene: sceneOf(p).id,
    video: 1 - R(0.14, 0.22),              // 영상 불투명도 (S1→S2 크로스페이드)
    canvas: R(0.14, 0.22),                 // 3D 캔버스 불투명도
    installed: R(0.30, 0.50),              // 모듈 설치 진행 0→1 (S3)
    wallOpacity: 1 - 0.88 * R(0.52, 0.60), // 외벽 투명화 (S4)
    flow: R(0.56, 0.62),                   // 전력 흐름 표시 (S4~)
    labels: R(0.54, 0.60) * (1 - R(0.90, 0.95)),
    econ: win(p, 0.72, 0.88, 0.03, 0.03, reduce),
    cta: R(0.90, 0.96),
    text,
    shade: Math.max(text[1], text[2], text[3], text[4]) * 0.95,
  };
}
