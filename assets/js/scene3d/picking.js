// ─────────────────────────────────────────────────────────────
// 설비 선택(피킹): 마우스 호버 / 클릭·탭 → 하이라이트 + 콜백
// 드래그(궤도 회전)와 클릭을 구분하기 위해 이동 거리(6px)·시간(400ms)으로 판정한다.
// ─────────────────────────────────────────────────────────────

export function createPicker(THREE, { camera, dom, pickables, modules, onSelect, onHover }) {
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hiC = new THREE.Color(1.9, 1.9, 1.4);   // 선택: 밝은 노랑끼
  const hoC = new THREE.Color(1.45, 1.45, 1.25); // 호버: 살짝 밝게
  const white = new THREE.Color(1, 1, 1);
  let enabled = true, hovered = null, selected = null, down = null;

  function hit(x, y) {
    const r = dom.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const h = ray.intersectObjects(pickables, false)[0];
    if (!h) return null;
    return { key: h.object.userData.key, object: h.object, instanceId: h.instanceId ?? null, point: h.point };
  }
  const same = (a, b) => !!a && !!b && a.object === b.object && a.instanceId === b.instanceId;

  function paint(h, color, on) {
    if (!h) return;
    if (h.object === modules) {
      modules.setColorAt(h.instanceId, on ? color : white);
      modules.instanceColor.needsUpdate = true;
    } else {
      const m = h.object.material;
      if (on) {
        if (m.userData.em === undefined) { m.userData.em = m.emissive.getHex(); }
        if (m.userData.ei === undefined) { m.userData.ei = m.emissiveIntensity; }
        m.emissive.setHex(0x0077B6); m.emissiveIntensity = color === hiC ? 1.0 : 0.55;
      } else {
        m.emissive.setHex(m.userData.em ?? 0); m.emissiveIntensity = m.userData.ei ?? 0;
      }
    }
  }
  function setHover(h) {
    if (same(h, hovered)) return;
    if (hovered && !same(hovered, selected)) paint(hovered, hoC, false);
    hovered = h;
    if (h && !same(h, selected)) paint(h, hoC, true);
    dom.style.cursor = h ? 'pointer' : '';
    onHover && onHover(h);
  }
  function select(h) {
    if (selected) paint(selected, hiC, false);
    if (hovered && same(hovered, h)) hovered = null;
    selected = h;
    if (h) paint(h, hiC, true);
    onSelect && onSelect(h);
  }

  const onMove = e => { if (!enabled || down || e.pointerType === 'touch') return; setHover(hit(e.clientX, e.clientY)); };
  const onDown = e => { if (!enabled) return; down = { x: e.clientX, y: e.clientY, t: performance.now() }; };
  const onUp = e => {
    if (!enabled || !down) return;
    const d = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t;
    down = null;
    if (d > 6 || dt > 400) return;             // 드래그였음 → 선택 아님
    select(hit(e.clientX, e.clientY));
  };
  const onLeave = () => { down = null; setHover(null); };
  dom.addEventListener('pointermove', onMove, { passive: true });
  dom.addEventListener('pointerdown', onDown, { passive: true });
  dom.addEventListener('pointerup', onUp, { passive: true });
  dom.addEventListener('pointerleave', onLeave, { passive: true });

  return {
    get selected() { return selected; },
    setEnabled(v) { enabled = !!v; if (!enabled) { setHover(null); } },
    clear() { setHover(null); if (selected) select(null); },
    dispose() {
      dom.removeEventListener('pointermove', onMove); dom.removeEventListener('pointerdown', onDown);
      dom.removeEventListener('pointerup', onUp); dom.removeEventListener('pointerleave', onLeave);
    },
  };
}
