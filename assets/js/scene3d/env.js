// 공통 환경: 조명·지면·그리드 (박스 모델과 GLB 모델이 함께 사용)
export function createEnvironment(THREE, { shadows = true, scale = 1 } = {}) {
  const group = new THREE.Group(); group.name = 'env';
  const disposables = [];
  const track = o => { disposables.push(o); return o; };

  group.add(new THREE.HemisphereLight(0xBFD8EA, 0x0D1B2A, 0.55));
  const sun = new THREE.DirectionalLight(0xFFF2DC, 2.2);
  sun.position.set(60 * scale, 80 * scale, 30 * scale);
  sun.castShadow = shadows;
  if (shadows) {
    sun.shadow.mapSize.set(2048, 2048);
    const e = 75 * scale; const c = sun.shadow.camera; c.left = -e; c.right = e; c.top = e; c.bottom = -e; c.near = 10; c.far = 260 * scale;
    sun.shadow.bias = -0.0006;
  }
  group.add(sun);
  group.add(new THREE.AmbientLight(0x90AFC4, 0.18));

  const ground = new THREE.Mesh(track(new THREE.PlaneGeometry(600 * scale, 600 * scale)), track(new THREE.MeshStandardMaterial({ color: 0x12243A, roughness: 1 })));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = shadows; group.add(ground);
  const grid = new THREE.GridHelper(400 * scale, 80, 0x2B4A6B, 0x1D3550);
  grid.position.y = 0.02; grid.material.transparent = true; grid.material.opacity = 0.35;
  track(grid.material); track(grid.geometry); group.add(grid);

  return { group, dispose() { disposables.forEach(d => d.dispose()); group.parent && group.parent.remove(group); } };
}
