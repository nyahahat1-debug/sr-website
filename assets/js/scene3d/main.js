// ─────────────────────────────────────────────────────────────
// 3D 시제품 부트스트랩 — 렌더러 / 스크롤 동기화 / 모드 전환 / 피킹 / 라벨 / 정리
//
// 상태 관리 원칙 (지시서 5항): 스크롤의 "단일 진행률 p" 하나가 진실의 원천이다.
//   p → evaluate(p) → (DOM 오버레이, 3D 상태, 카메라)   ※ timeline.js 의 순수 함수
// 렌더링은 필요할 때만 한다 (state.needs 플래그 / 흐름 애니메이션 / 트윈 / 감쇠 중).
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildFactory } from './factory.js';
import { loadFactoryGLB } from './factory-glb.js';
import { createEnvironment } from './env.js';
import { evaluate, cameraAt as cameraAtRaw, lerpPose, clampPose, scalePose, SCENES } from './timeline.js';
import { createPicker } from './picking.js';
import { EQUIPMENT, demoEconomics, moduleSpec, SITE } from './data.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;
const lowPower = coarse || matchMedia('(max-width: 960px)').matches;

const story = $('#story'), stage = $('#stage'), canvas = $('#scene3d'), video = $('#stageVideo');
const overlays = $$('.ov[data-ov]');
const ovMap = Object.fromEntries(overlays.map(el => [el.dataset.ov, { el, inner: el.querySelector('.ov-in') || el }]));
const texts = [1, 2, 3, 4, 5, 6].map(i => ovMap['t' + i]);
const shade = $('#stageShade'), s1Shade = $('#s1Shade'), labelsEl = $('#labels'), dots = $$('.dot');
const live = $('#sceneLive'), sel = $('#selPanel'), hint = $('#hudHint');

const EXPLORE_LIMITS = { minR: 42, maxR: 160, minPhi: 0.15, maxPhi: 1.42 };   // 48 m 건물 기준, 로드 후 WS 배율
const HOME_POSE = { pos: [54, 30, 64], tgt: [0, 5, 0] };
let WS = 1;                                                                   // 월드 스케일 (건물 가로 / 48)
let ZOOM = false;                                                             // 긴 부지(여러 동)면 장면별 줌 적용
const cameraAt = (p, r) => scalePose(cameraAtRaw(p, r, ZOOM), WS);

const state = {
  p: -1, pDirty: true, scene: 0, S: null,
  mode: 'story', visible: true, needs: true,
  tween: null, replay: null,
  ex: { walls: false, flow: false },
  flowLevel: 0, raf: 0, lastTgt: [0, 5, 0], videoOK: false,
};
let renderer, scene, camera, controls, factory, env = null, picker, io, labels = [];
const _v = new THREE.Vector3();

// ═══════════════════════════════════════════════ init
async function init() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowPower, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowPower ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = !lowPower;
  renderer.shadowMap.type = THREE.PCFShadowMap; // r186: PCFSoftShadowMap 제거됨

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0D1B2A);
  scene.fog = new THREE.Fog(0x0D1B2A, 110, 260);
  camera = new THREE.PerspectiveCamera(40, 1, 0.5, 700);

  // 모델: GLB(assets/models) 우선, 실패하면 박스 모델. ?box 로 박스 강제.
  const forceBox = /[?&]box(=|&|$)/.test(location.search);
  if (!forceBox) {
    try {
      factory = await loadFactoryGLB(THREE, { shadows: !lowPower });
      env = createEnvironment(THREE, { shadows: !lowPower, scale: factory.scale || 1 }); scene.add(env.group);
      state.model = 'glb';
    } catch (err) {
      console.warn('[sr3d] GLB 로드 실패 → 박스 모델로 폴백:', err && err.message);
      factory = null;
    }
  }
  if (!factory) { factory = buildFactory(THREE, { shadows: !lowPower }); state.model = 'box'; }
  scene.add(factory.group);
  // 월드 스케일: 카메라·안개·탐색 한계를 건물 크기에 맞춘다
  WS = factory.scale || 1;
  ZOOM = WS > 3;   // 부지 가로가 건물 기준(48 m)의 3배를 넘으면 장면별 줌 사용
  if (WS !== 1) {
    EXPLORE_LIMITS.minR *= ZOOM ? WS * 0.35 : WS; EXPLORE_LIMITS.maxR *= WS;   // 타깃이 지면 위 5×WS m 라 가까워도 건물 위를 지남
    HOME_POSE.pos = HOME_POSE.pos.map(v => v * WS); HOME_POSE.tgt = HOME_POSE.tgt.map(v => v * WS);
    scene.fog.near *= WS; scene.fog.far *= WS; camera.far *= WS;   // controls 는 이 뒤에서 EXPLORE_LIMITS 로 생성됨
  }
  stage.dataset.model = state.model;

  controls = new OrbitControls(camera, canvas);
  controls.enabled = false;
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = EXPLORE_LIMITS.minR; controls.maxDistance = EXPLORE_LIMITS.maxR;
  controls.minPolarAngle = EXPLORE_LIMITS.minPhi; controls.maxPolarAngle = EXPLORE_LIMITS.maxPhi;
  controls.target.set(0, 5, 0);
  controls.addEventListener('change', () => { state.needs = true; });
  // OrbitControls 가 touch-action:none 으로 덮어쓴 것을 되돌린다 (스토리 모드에서는 페이지 스크롤이 우선)
  canvas.style.touchAction = 'pan-y';

  picker = createPicker(THREE, { camera, dom: canvas, pickables: factory.pickables, modules: factory.modules, onSelect: showSelection });

  buildLabels(); fillEconomics(); bindUI();
  onScroll();                                   // 인트로 판단용 p 선계산
  const startIntro = () => { state.intro = runIntro(); setupVideo(); };   // 시작 화면(게이트)이 있으면 '들어가기' 뒤에 인트로·영상 시작
  if (window.__srGate) { state.intro = true; window.__srGate.then(startIntro); } else startIntro();
  resize();
  addEventListener('resize', onResize, { passive: true });
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  io = new IntersectionObserver(e => { state.visible = e[0].isIntersecting; if (state.visible) state.needs = true; }, { threshold: 0 });
  io.observe(story);
  document.addEventListener('visibilitychange', onVis);

  // 시간원: performance.now() (THREE.Clock 은 r186 에서 deprecated)
  stage.classList.add('ready');
  window.__sr3dReady = true;
  state.raf = requestAnimationFrame(loop);
  // 감시 타이머: rAF 가 멈추거나 극단적으로 느린 환경(일부 iOS 웹뷰·미리보기 패널)에서도 스크롤에 맞춰 장면이 갱신되게 한다
  setInterval(() => { if (!document.hidden && performance.now() - (state.lastFrame || 0) > 350) tick(); }, 250);
  addEventListener('pagehide', dispose, { once: true });
}

// ═══════════════════════════════════════════════ loop
function loop() {
  state.raf = requestAnimationFrame(loop);
  state.lastFrame = performance.now();
  if (!state.visible || document.hidden) return;
  tick();
}
/** 한 프레임 처리. rAF 가 멈춘 환경(백그라운드 탭·자동화)에서는 window.__sr3d.tick() 으로 직접 호출할 수 있다. */
function tick() {
  const t = performance.now() / 1000;
  // 스테이지 크기가 resize 이벤트 없이 바뀌는 경우(모바일 주소창 접힘, 뷰포트 에뮬레이션) 대비
  if (stage.clientWidth !== sized.w || stage.clientHeight !== sized.h) resize();

  if (state.mode === 'explore' && !state.tween && controls.enabled) { if (controls.update()) state.needs = true; }

  let render = state.needs;
  if (state.pDirty) {
    const S = evaluate(state.p, reduce); state.S = S;
    applyOverlays(S); apply3D(S);
    state.pDirty = false; render = true;
  }
  if (state.tween) { stepTween(); render = true; }
  if (state.replay) {
    const k = clamp((performance.now() - state.replay.t0) / state.replay.dur, 0, 1);
    factory.setInstalled(k); if (k >= 1) state.replay = null; render = true;
  }
  if (state.flowLevel > 0.01 && !reduce) { factory.animateFlow(t); render = true; }

  if (render) { updateLabels(); renderer.render(scene, camera); state.needs = false; fpsMeter.renders++; }
  fpsMeter.tick();
}

// 성능 측정 훅: URL 에 ?fps 를 붙이면 HUD 에 초당 rAF / 실제 렌더 횟수를 표시한다 (Phase 6 검수용)
const fpsMeter = {
  on: /[?&]fps\b/.test(location.search), frames: 0, renders: 0, t0: performance.now(), el: null,
  tick() {
    if (!this.on) return;
    this.frames++;
    const dt = performance.now() - this.t0;
    if (dt < 1000) return;
    if (!this.el) { this.el = document.createElement('div'); this.el.className = 'hud-hint'; this.el.style.color = '#90E0EF'; hint.after(this.el); }
    const gl = renderer.getContext(), dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'GPU ?';
    this.el.textContent = `FPS ${Math.round(this.frames * 1000 / dt)} · 렌더 ${Math.round(this.renders * 1000 / dt)}/s · 드로우콜 ${renderer.info.render.calls} · 삼각형 ${renderer.info.render.triangles.toLocaleString()} · DPR ${renderer.getPixelRatio()} · 모델 ${state.model} · ${gpu}`;
    this.frames = 0; this.renders = 0; this.t0 = performance.now();
  },
};

// ═══════════════════════════════════════════════ scroll → p
function onScroll() {
  const r = story.getBoundingClientRect();
  const span = story.offsetHeight - innerHeight;
  const p = span > 0 ? clamp(-r.top / span, 0, 1) : 0;
  if (p !== state.p) {
    state.p = p; state.pDirty = true; state.needs = true;
    if (performance.now() - (state.lastFrame || 0) > 350) tick();   // rAF 가 죽은 환경: 스크롤 즉시 갱신
    // 스토리 모드로 돌아오는 트윈 중에 스크롤하면 목적지를 갱신
    if (state.tween && state.mode === 'story') state.tween.to = cameraAt(p, reduce);
  }
}
let rsT = 0;
function onResize() { clearTimeout(rsT); rsT = setTimeout(resize, 120); }
const sized = { w: 0, h: 0 };
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  if (!w || !h) return;
  sized.w = w; sized.h = h;
  renderer.setSize(w, h, false);
  const aspect = w / h;
  camera.aspect = aspect;
  // 세로 화면(모바일): 카메라 위치는 그대로 두고 투영만 보정 —
  //  · FOV 를 넓혀 건물 전체가 들어오게
  //  · 뷰 오프셋으로 장면 중심을 화면 위쪽(≈35%)에 두어 아래쪽 텍스트·HUD 자리를 확보
  if (aspect < 1) {
    camera.fov = Math.min(68, 40 * Math.pow(1 / aspect, 0.45));
    camera.setViewOffset(w, Math.round(h * 1.3), 0, Math.round(h * 0.3), w, h);
  } else {
    camera.fov = 40;
    camera.clearViewOffset();
  }
  camera.updateProjectionMatrix();
  state.pDirty = true; state.needs = true;
}
function onVis() { if (!document.hidden) state.needs = true; }

// ═══════════════════════════════════════════════ apply state
function setOv(o, op) {
  o.el.style.opacity = op;
  o.el.style.visibility = op > 0.02 ? 'visible' : 'hidden';
  o.el.toggleAttribute('inert', !(op > 0.5));
  o.inner.style.transform = reduce ? 'none' : `translateY(${((1 - op) * 16).toFixed(2)}px)`;
}
function applyOverlays(S) {
  if (video) video.style.opacity = S.video;
  if (s1Shade) s1Shade.style.opacity = S.video;
  canvas.style.opacity = S.canvas;
  texts.forEach((o, i) => setOv(o, S.text[i]));
  setOv(ovMap.econ, S.econ);
  setOv(ovMap.cta, S.cta);
  shade.style.opacity = S.shade;
  labelsEl.style.opacity = state.mode === 'explore' ? 1 : S.labels;
  dots.forEach(d => d.classList.toggle('on', +d.dataset.scene === S.scene));
  if (S.scene !== state.scene) {
    state.scene = S.scene;
    stage.dataset.scene = S.scene;
    live.textContent = `장면 ${S.scene} / 6 — ${SCENES[S.scene - 1].title}`;
  }
  // 영상은 보일 때만 재생 (CPU 절약)
  if (video && state.videoOK) {
    if (S.video < 0.02 && !video.paused) video.pause();
    else if (S.video >= 0.02 && video.paused) video.play().catch(() => { stage.classList.add('video-off'); });
  }
}
function apply3D(S) {
  if (state.mode !== 'story') return;
  factory.setInstalled(S.installed);
  factory.setWallOpacity(S.wallOpacity);
  setFlowLevel(S.flow);
  if (!state.tween) setCam(cameraAt(S.p, reduce));
}
function setCam(c) {
  camera.position.set(c.pos[0], c.pos[1], c.pos[2]);
  camera.lookAt(c.tgt[0], c.tgt[1], c.tgt[2]);
  state.lastTgt = c.tgt;
}
function setFlowLevel(v) {
  state.flowLevel = v; factory.setFlow(v);
  if (reduce || v <= 0.01) factory.animateFlow(0);
}

// ═══════════════════════════════════════════════ camera tween (구면 보간 → 건물 관통 없음)
function tweenCamera(to, dur, done) {
  const from = { pos: camera.position.toArray(), tgt: state.mode === 'explore' ? controls.target.toArray() : [...state.lastTgt] };
  state.tween = { from, to, t0: performance.now(), dur: reduce ? 0 : dur, done };
}
function stepTween() {
  const tw = state.tween;
  const k = tw.dur <= 0 ? 1 : smooth((performance.now() - tw.t0) / tw.dur);
  setCam(lerpPose(tw.from, tw.to, k));
  if (k >= 1) { state.tween = null; tw.done && tw.done(); }
}

// ═══════════════════════════════════════════════ mode
function setMode(m) {
  if (m === state.mode) return;
  state.mode = m; stage.dataset.mode = m;
  $('#modeStory').setAttribute('aria-pressed', String(m === 'story'));
  $('#modeExplore').setAttribute('aria-pressed', String(m === 'explore'));
  if (m === 'explore') {
    controls.enabled = false;
    const to = clampPose({ pos: camera.position.toArray(), tgt: [0, 5 * WS, 0] }, EXPLORE_LIMITS);
    // 세로 화면에서는 건물이 꽉 차므로 시작 거리를 1.35배 (허용 범위 내)
    if (sized.w < sized.h) {
      const d = to.pos.map((v, i) => v - to.tgt[i]);
      const r = Math.hypot(...d), r2 = Math.min(EXPLORE_LIMITS.maxR, r * 1.35);
      to.pos = d.map((v, i) => to.tgt[i] + v / r * r2);
    }
    tweenCamera(to, 700, () => { controls.target.set(0, 5 * WS, 0); controls.enabled = true; controls.update(); state.needs = true; });
    canvas.style.touchAction = 'none';
    factory.setInstalled(1);
    factory.setWallOpacity(state.ex.walls ? 0.12 : 1);
    setFlowLevel(state.ex.flow ? 1 : 0);
    labelsEl.style.opacity = 1;
    hint.textContent = coarse
      ? '드래그로 회전 · 두 손가락으로 확대/축소 · 설비를 탭하면 설명이 열립니다'
      : '드래그로 회전 · 휠로 확대/축소 · 설비를 클릭하면 설명 · 방향키/+/- 키보드 조작 가능';
    canvas.focus({ preventScroll: true });
  } else {
    controls.enabled = false;
    picker.clear(); state.replay = null;
    canvas.style.touchAction = 'pan-y';
    tweenCamera(cameraAt(state.p, reduce), 800, () => { state.pDirty = true; });
    state.pDirty = true;
    hint.textContent = '스크롤하면 장면이 진행됩니다 · 탐색 모드에서 직접 돌려볼 수 있습니다';
  }
  state.needs = true;
}

// ═══════════════════════════════════════════════ UI
function bindUI() {
  $('#modeStory').addEventListener('click', () => setMode('story'));
  $('#modeExplore').addEventListener('click', () => setMode('explore'));
  $('#tgWalls').addEventListener('click', e => {
    state.ex.walls = !state.ex.walls; e.currentTarget.setAttribute('aria-pressed', String(state.ex.walls));
    if (state.mode === 'explore') { factory.setWallOpacity(state.ex.walls ? 0.12 : 1); state.needs = true; }
  });
  $('#tgFlow').addEventListener('click', e => {
    state.ex.flow = !state.ex.flow; e.currentTarget.setAttribute('aria-pressed', String(state.ex.flow));
    if (state.mode === 'explore') { setFlowLevel(state.ex.flow ? 1 : 0); state.needs = true; }
  });
  $('#btnReplay').addEventListener('click', () => {
    if (state.mode !== 'explore') return;
    state.replay = { t0: performance.now(), dur: reduce ? 1 : 2600 };
  });
  $('#btnReset').addEventListener('click', () => {
    if (state.mode !== 'explore' || state.tween) return;
    controls.enabled = false;
    tweenCamera(HOME_POSE, 600, () => { controls.target.set(0, 5 * WS, 0); controls.enabled = true; controls.update(); });
  });
  dots.forEach(d => d.addEventListener('click', () => gotoScene(+d.dataset.scene)));
  $$('[data-goto]').forEach(b => b.addEventListener('click', () => gotoScene(+b.dataset.goto)));
  $('#selClose').addEventListener('click', () => picker.clear());
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!sel.hidden) { picker.clear(); return; }
    if (state.mode === 'explore') setMode('story');
  });
  canvas.addEventListener('keydown', onCanvasKey);
}
function gotoScene(n) {
  const s = SCENES[clamp(n, 1, 6) - 1];
  const span = story.offsetHeight - innerHeight;
  const top = story.offsetTop + (s.a + 0.012) * span;
  if (state.mode === 'explore') setMode('story');
  scrollTo({ top, behavior: reduce ? 'auto' : 'smooth' });
}
function onCanvasKey(e) {
  if (state.mode !== 'explore' || state.tween) return;
  const map = { ArrowLeft: [0.1, 0, 0], ArrowRight: [-0.1, 0, 0], ArrowUp: [0, -0.06, 0], ArrowDown: [0, 0.06, 0], '+': [0, 0, -6], '=': [0, 0, -6], '-': [0, 0, 6] };
  const d = map[e.key]; if (!d) return;
  e.preventDefault();
  const sph = new THREE.Spherical().setFromVector3(_v.copy(camera.position).sub(controls.target));
  sph.theta += d[0];
  sph.phi = clamp(sph.phi + d[1], controls.minPolarAngle, controls.maxPolarAngle);
  sph.radius = clamp(sph.radius + d[2] * WS, controls.minDistance, controls.maxDistance);
  camera.position.setFromSpherical(sph).add(controls.target);
  camera.lookAt(controls.target);
  controls.update(); state.needs = true;
}

// ═══════════════════════════════════════════════ selection panel
function showSelection(h) {
  if (!h) { sel.hidden = true; return; }
  const info = EQUIPMENT[h.key] || EQUIPMENT.modules;
  let sub = '';
  if (h.key === 'modules' && h.instanceId != null) {
    const b = factory.moduleAt(h.instanceId);
    sub = `모듈 #${h.instanceId + 1} / ${factory.moduleCount} · ${b.r + 1}열 ${b.c + 1}번`;
  }
  $('#selTitle').textContent = info.name;
  $('#selSub').textContent = sub;
  $('#selDesc').textContent = info.desc;
  $('#selSpecs').innerHTML = info.specs.map(([k, v]) => `<div><dt>${k}</dt><dd>${String(v).replace('{SPEC}', moduleSpec(factory.moduleCount))}</dd></div>`).join('');
  sel.hidden = false;
}

// ═══════════════════════════════════════════════ labels (3D → 화면 투영)
function buildLabels() {
  labels = factory.labels.map(l => {
    const el = document.createElement('div');
    el.className = 'lbl'; el.innerHTML = `<span class="lbl-dot"></span>${l.text}`;
    labelsEl.appendChild(el);
    return { el, pos: l.pos };
  });
}
function updateLabels() {
  if (state.mode === 'story' && parseFloat(labelsEl.style.opacity || '0') < 0.02) return;
  const w = stage.clientWidth, h = stage.clientHeight;
  // 스토리 모드에서 왼쪽 텍스트 칼럼이 떠 있으면 그 위로 오는 라벨은 숨긴다 (겹침 방지)
  const textCol = state.mode === 'story' && state.S && state.S.shade > 0.3 && w > 960 ? 0.0 : -2;
  for (const l of labels) {
    _v.copy(l.pos).project(camera);
    const vis = _v.z < 1 && Math.abs(_v.x) < 1.05 && Math.abs(_v.y) < 1.05 && _v.x > textCol;
    l.el.style.display = vis ? '' : 'none';
    if (vis) l.el.style.transform = `translate(${((_v.x + 1) / 2 * w).toFixed(1)}px,${((1 - _v.y) / 2 * h).toFixed(1)}px)`;
  }
}

// ═══════════════════════════════════════════════ economics panel (데모)
function fillEconomics() {
  const e = demoEconomics(factory.moduleCount);
  if (SITE) return fillSiteEconomics(e);
  const f = (n, d = 0) => n.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const krw = n => { const man = Math.round(n / 10000); return man >= 10000 ? `${Math.floor(man / 10000)}억 ${f(man % 10000)}` : f(man); };
  const note = $('#noteModules'); if (note) note.textContent = `* 모듈 ${moduleSpec(factory.moduleCount)}. 발전량·절감액은 데모 가정값 기준`;
  $('#ecoRows').innerHTML = `
    <div class="rr"><span class="rk">설치 모듈</span><span class="rv">${e.moduleCount}<span class="u">장</span></span></div>
    <div class="rr"><span class="rk">설치 용량</span><span class="rv">${f(e.kw, 1)}<span class="u">kW</span></span></div>
    <div class="rr"><span class="rk">연간 예상 발전량</span><span class="rv">약 ${f(e.mwh)}<span class="u">MWh</span></span></div>
    <div class="rr hi"><span class="rk">연간 전기요금 절감</span><span class="rv">약 ${krw(e.savingKrw)}<span class="u">만 원</span></span></div>
    <div class="rr"><span class="rk">잉여 전력 판매</span><span class="rv">약 ${krw(e.saleKrw)}<span class="u">만 원</span></span></div>`;
  const calcLink = $('#ecoCalcLink') || Object.assign(document.createElement('a'), { id: 'ecoCalcLink', className: 'btn btn-sky', style: 'margin-top:12px;width:100%;justify-content:center' });
  calcLink.href = `analysis.html?kw=${Math.round(e.kw)}#calculator`; calcLink.textContent = '이 조건으로 직접 계산해 보기 →';
  if (!calcLink.isConnected) $('#ecoAssump').closest('.rassump').after(calcLink);
  $('#ecoAssump').innerHTML = e.assumptions.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}

/** 장면 5: 실제 현장(효성 전주공장) 공개 수치 — 투자비·회수기간은 비공개라 표시하지 않음 */
function fillSiteEconomics(e) {
  const P = SITE.published;
  const f = n => n.toLocaleString('ko-KR');
  const krw = n => { const man = Math.round(n / 10000); return man >= 10000 ? `${Math.floor(man / 10000)}억 ${f(man % 10000)}` : f(man); };
  const panel = $('#ecoRows').closest('.econ');
  const set = (sel, txt) => { const el = panel.querySelector(sel); if (el) el.textContent = txt; };
  set('.rl', `실제 현장 · ${SITE.completed} 준공`);
  set('.rt', `${SITE.name} ${f(SITE.capacityKw)} kW`);
  set('.rtag', '실측 기준');
  const tag = panel.querySelector('.rtag'); if (tag) tag.style.cssText = 'color:#166534;background:#DCFCE7;border-color:#86EFAC';
  $('#ecoRows').innerHTML = `
    <div class="rr"><span class="rk">월 발전량 (실측)</span><span class="rv">${f(Math.round(P.monthGenKwh))}<span class="u">kWh</span></span></div>
    <div class="rr"><span class="rk">연간 예상 발전량</span><span class="rv">${f(P.annualGenKwh)}<span class="u">kWh</span></span></div>
    <div class="rr"><span class="rk">월 전기요금 절감 (추정)</span><span class="rv">약 ${krw(P.monthSavingKrw)}<span class="u">만 원</span></span></div>
    <div class="rr hi"><span class="rk">연간 전기요금 절감효과</span><span class="rv">약 ${krw(P.annualSavingKrw)}<span class="u">만 원</span></span></div>
    <div class="rr"><span class="rk">연간 총 경제적 효과</span><span class="rv">약 ${krw(P.annualTotalKrw)}<span class="u">만 원</span></span></div>`;
  const ab = panel.querySelector('.rassump b'); if (ab) ab.textContent = '산정 기준';
  $('#ecoAssump').innerHTML = [
    ['요금제', '산업용(을) 고압A 선택Ⅱ'],
    ['시간대 절감', `경부하 ${f(P.tou.light.kwh)} · 중간 ${f(P.tou.mid.kwh)} · 최대 ${f(P.tou.peak.kwh)} kWh`],
    ['포함 항목', '기후환경 9원 · 연료비 5원 · 부가세 · 기금'],
    ['자가소비', '전량 (상시 부하 > 발전량)'],
  ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  set('.rfoot', `* 실측 발전량 × 현행 요금(기후환경·연료비·부가세·기금 포함) 기준. 연간 수치는 분석 기준 예상치이며 온실가스 저감가치(연 약 ${P.co2Tons}톤·${krw(P.co2ValueKrw)}만 원)를 총 효과에 포함. 생산량·기상·요금 개정에 따라 달라질 수 있습니다.`);
  const note = $('#noteModules'); if (note) note.textContent = `* 3D 모델: 전체 ${(factory.building && factory.building.buildings) ? new Set(factory.building.buildings.map(b => b.building)).size : 1}개 동 · 모듈 ${moduleSpec(factory.moduleCount)} (도면 기준) · 현장 공개 용량 ${f(SITE.capacityKw)} kW`;
  let links = $('#ecoLinks');
  if (!links) { links = document.createElement('div'); links.id = 'ecoLinks'; links.style.cssText = 'display:grid;gap:8px;margin-top:12px'; panel.querySelector('.rassump').after(links); }
  links.innerHTML = `<a class="btn btn-sky" style="justify-content:center" href="${SITE.link}">절감 내역 자세히 보기 →</a>
    <a class="btn btn-ghost" style="justify-content:center" href="analysis.html?preset=${SITE.id}#calculator">내 현장 조건으로 계산해 보기</a>`;
}


// ═══════════════════════════════════════════════ 첫 화면 타이포 인트로
// 가운데 큰 제목(줄 단위 등장) → 2.3s 영상 페이드인 → 3.4s 왼쪽 제자리로 이동·축소(1.9s) → 5.4s 뒤 나머지 요소 등장
function runIntro() {
  const ov = ovMap.t1; const h1 = ov && ov.inner.querySelector('h1');
  const finish = () => { stage.classList.remove('intro', 'intro-lines', 'intro-video'); stage.classList.add('intro-done'); window.__srIntroDone && window.__srIntroDone(); };
  if (h1 && !h1.querySelector('.il')) h1.innerHTML = h1.innerHTML.split(/<br\s*\/?>/i).map(l => `<span class="il">${l.trim()}</span>`).join('');
  const skip = !h1 || reduce || state.p > 0.02 || /[?&]nointro(=|&|$)/.test(location.search) || stage.classList.contains('intro-done');
  if (skip) { finish(); return false; }
  stage.classList.add('intro');
  const sr = stage.getBoundingClientRect(), r = h1.getBoundingClientRect();
  const scale = Math.max(1.15, Math.min(1.9, (sr.width * 0.86) / r.width));
  const dx = (sr.left + sr.width / 2) - (r.left + r.width * scale / 2);
  const dy = (sr.top + sr.height / 2) - (r.top + r.height * scale / 2);
  h1.style.transformOrigin = '0 0'; h1.style.transition = 'none';
  h1.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${scale.toFixed(3)})`;
  const showLines = () => { if (stage.classList.contains('intro')) stage.classList.add('intro-lines'); };
  requestAnimationFrame(() => requestAnimationFrame(showLines));
  setTimeout(showLines, 120);   // 백그라운드 탭(rAF 정지) 대비
  // 영상은 인트로 시작과 동시에 숨긴 채 재생해 두고(첫 프레임 준비), 제목 세 줄이 다 나타나는 2.3s 에 바로 보이게 한다
    if (video && video.isConnected) video.play().then(() => { state.videoOK = true; }).catch(() => { video.style.display = 'none'; state.videoOK = false; stage.classList.add('video-off'); });
  setTimeout(() => { stage.classList.add('intro-video'); }, 2300);
  setTimeout(() => {                                                   // 제목 이동·축소
    h1.style.transition = 'transform 1.9s cubic-bezier(.65,0,.2,1)';
    h1.style.transform = 'none';
  }, 3400);
  setTimeout(() => {
    const kids = [...ov.inner.children].filter(k => k !== h1);
    kids.forEach((k, i) => { k.classList.add('anim-up'); k.style.setProperty('--d', (0.1 + i * 0.22).toFixed(2) + 's'); });
    finish();
    setTimeout(() => { h1.style.transition = ''; h1.style.transform = ''; }, 100);
  }, 5400);
  return true;
}

// ═══════════════════════════════════════════════ video
function setupVideo() {
  if (!video) return;
  if (reduce) { video.remove(); stage.classList.add('video-off'); return; }
  if (state.intro) { video.addEventListener('error', () => { video.style.display = 'none'; state.videoOK = false; stage.classList.add('video-off'); }); return; }   // 인트로가 재생 시작을 맡는다
  video.addEventListener('error', () => { video.style.display = 'none'; state.videoOK = false; stage.classList.add('video-off'); });
  video.play().then(() => { state.videoOK = true; }).catch(() => {
    // 자동재생 실패(저전력 모드 등) → 포스터가 아래에 깔려 있으므로 영상만 숨긴다
    video.style.display = 'none'; state.videoOK = false; stage.classList.add('video-failed', 'video-off');
  });
}

// ═══════════════════════════════════════════════ cleanup
function dispose() {
  cancelAnimationFrame(state.raf);
  removeEventListener('scroll', onScroll); removeEventListener('resize', onResize);
  document.removeEventListener('visibilitychange', onVis);
  io && io.disconnect();
  controls && controls.dispose(); picker && picker.dispose(); factory && factory.dispose(); env && env.dispose();
  if (renderer) { renderer.dispose(); renderer.forceContextLoss && renderer.forceContextLoss(); }
  window.__sr3d = null;
}

// ═══════════════════════════════════════════════ boot
if (window.__sr3dFallbackOn && window.__sr3dFallbackReason !== 'timeout') {
  console.warn('[sr3d] 폴백이 이미 동작 중이라 3D 초기화를 건너뜁니다.');
} else {
  init().then(() => {
    if (window.__sr3dFallbackOn) {                                        // 시간 초과 폴백이 먼저 켜졌다면 걷어내고 정상 모드로
      window.__sr3dFallbackStop && window.__sr3dFallbackStop();
      window.__sr3dFallbackOn = false; stage.classList.remove('no-webgl');
      const note = document.getElementById('fallbackNote'); if (note) note.hidden = true;
      document.querySelectorAll('.ov[data-ov]').forEach(o => { o.style.opacity = ''; o.style.visibility = ''; o.removeAttribute('inert'); });
      state.pDirty = true; state.needs = true;
    }
    window.__sr3d = { state, setMode, gotoScene, evaluate, tick, dispose, get factory() { return factory; }, get camera() { return camera; }, get renderer() { return renderer; } };
  }).catch(err => {
    console.error('[sr3d] init 실패', err);
    window.__sr3dFail && window.__sr3dFail('init: ' + (err && err.message));
  });
}
