// de_train — procedural, ground-route adaptation of classic Counter-Strike Train.
// Shared FFA spawning uses this map's walkable grid and cover queries.
// Layout (X east, -Z north; floor Y=0; original 96-unit map / 1.75 eye height):
// A yard      X -14..45, Z -29..8    : three rail lanes, staggered freight cover.
// B depot     X -14..45, Z 15..45    : covered two-track hall, three entrances.
// T concourse X -45..-32, Z -45..45 : A Main (-17), Popdog (2), B halls (24).
// Ivy         X -32..45, Z -45..-35 : north flank; turns into A at the east end.
// Z connector X 0..16, Z 8..15      : offset, 7-unit-wide openings between sites.
// CT link     X 34..45, Z 8..15     : second A/B connection and starting approach.
// Start (38,1.75,4), facing WNW. Close 5–12, medium 12–28, long 28–50 units.
// All combat/spawning stays on the original flat navigation surface. High-level
// offices, ladders, water tower and roof structures are architectural scenery.
export const WORLD_SETTINGS = {
  seed: 19991105, size: 96, spawn: [38, 1.75, 4], spawnYaw: Math.PI * 0.35,
  sky: { top: 0x657f93, mid: 0xa8b7be, horizon: 0xd3cbb8, fogColor: 0xb0b8b8, fogNear: 72, fogFar: 195 },
  lighting: {
    hemisphereSky: 0xd6e3eb, hemisphereGround: 0xb5b3a6, hemisphereIntensity: 2.05,
    sunColor: 0xffe4bb, sunIntensity: 1.85, sunPosition: [-34, 52, -25]
  }
};

export function createWorld({ THREE, scene }) {
  const root = new THREE.Group(); root.name = 'de_train'; scene.add(root);
  const colliders = [], floorObjects = [];
  const obstacles = [], batches = new Map(), boxGeometryCache = new Map();
  const random = mulberry32(WORLD_SETTINGS.seed), temp = new THREE.Object3D();
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const cylinderGeo = new THREE.CylinderGeometry(1, 1, 1, 12);
  const tankBandGeo = new THREE.CylinderGeometry(1, 1, 1, 20);
  const warningDotGeo = new THREE.CircleGeometry(0.065, 10);
  const warningBladeGeo = new THREE.RingGeometry(0.1, 0.27, 7, 1, 0, Math.PI / 3);
  const planeGeo = new THREE.PlaneGeometry(1, 1);
  const hiddenMaterial = new THREE.MeshBasicMaterial({ visible: false });
  const textures = { brick: surfaceTexture('brick'), concrete: surfaceTexture('concrete'), asphalt: surfaceTexture('asphalt'), steel: surfaceTexture('steel') };
  const mat = {
    brick: standard(0x99745e, { map: textures.brick }),
    darkBrick: standard(0x766557, { map: textures.brick }),
    plaster: standard(0xb4b7aa, { map: textures.concrete }),
    concrete: standard(0xaba99b, { map: textures.concrete }),
    asphalt: standard(0x8b8d86, { map: textures.asphalt, roughness: 0.88 }),
    ballast: standard(0x646963, { map: textures.asphalt }),
    base: standard(0x727a77), trim: standard(0xb0b1a4), roof: standard(0x626e6c, { metalness: 0.32 }),
    metal: standard(0x4b5857, { metalness: 0.6, roughness: 0.65 }),
    rail: standard(0x878b84, { metalness: 0.76, roughness: 0.48 }),
    dark: standard(0x414b4a), rust: standard(0x85614b), wood: standard(0x92836a), sleeper: standard(0x69685a),
    blue: standard(0x416a79, { map: textures.steel, metalness: 0.23 }),
    green: standard(0x6c8064, { map: textures.steel, metalness: 0.23 }),
    red: standard(0x92574c, { map: textures.steel, metalness: 0.23 }),
    yellow: standard(0xe1b542, { map: textures.steel, metalness: 0.14 }),
    tanker: standard(0x676e69, { metalness: 0.48, roughness: 0.72 }),
    white: standard(0xe1dbc2), orange: standard(0xba6d39), ivy: standard(0x526c4c),
    glass: standard(0x74919a, { roughness: 0.32, metalness: 0.25, emissive: 0x253e46, emissiveIntensity: 0.22 }),
    lamp: new THREE.MeshBasicMaterial({ color: 0xffe3a0, toneMapped: false }),
    signal: new THREE.MeshBasicMaterial({ color: 0xc74735, toneMapped: false })
  };
  const depotTexture = textures.concrete.clone(); depotTexture.repeat.set(12, 6); depotTexture.needsUpdate = true;
  mat.depotFloor = standard(0xb3b3a7, { map: depotTexture });
  // Only these large masonry surfaces receive metre-scaled UVs. Small detail
  // and rolling stock share the original inexpensive instanced primitives.
  for (const key of ['brick', 'darkBrick']) mat[key].userData.tileSize = 3.2;
  for (const key of ['plaster', 'concrete']) mat[key].userData.tileSize = 5;
  const atlasCanvas = document.createElement('canvas'); atlasCanvas.width = 2048; atlasCanvas.height = 1024;
  const atlasContext = atlasCanvas.getContext('2d'), signCache = new Map();
  const atlasTexture = new THREE.CanvasTexture(atlasCanvas); atlasTexture.colorSpace = THREE.SRGBColorSpace; atlasTexture.anisotropy = 4;
  const signMaterial = standard(0xffffff, { map: atlasTexture, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const world = {
    map: root, colliders, floorObjects,
    isLoaded: false, spawn: new THREE.Vector3(...WORLD_SETTINGS.spawn),
    lighting: WORLD_SETTINGS.lighting, ready: null, navigation: null,
    resetPlayer
  };

  createSky(); createGround(); createArchitecture(); createDepot();
  createRailYards(); createLandmarks(); createCover(); createDetails(); createBackdrop();
  flushBatches(); root.updateMatrixWorld(true);
  world.navigation = createNavigation();
  world.isLoaded = true; world.ready = Promise.resolve(world);
  return world;

  function standard(color, extra = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.91, metalness: 0.04, ...extra });
  }
  function surfaceTexture(kind) {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d'), pixels = ctx.createImageData(256, 256);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const v = 211 + (random() - 0.5) * (kind === 'asphalt' ? 55 : 25);
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = v; pixels.data[i + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
    if (kind === 'brick') {
      for (let row = 0; row < 16; row++) {
        const y = row * 16;
        for (let x = -32 + (row % 2) * 32; x < 256; x += 64) {
          ctx.fillStyle = `rgba(54,45,32,${0.03 + random() * 0.12})`; ctx.fillRect(x + 2, y + 2, 60, 12);
          ctx.strokeStyle = '#aaa79d'; ctx.lineWidth = 1.7; ctx.strokeRect(x, y, 64, 16);
        }
      }
    } else if (kind === 'steel') {
      for (let x = 8; x < 256; x += 32) {
        ctx.fillStyle = 'rgba(20,27,24,0.08)'; ctx.fillRect(x, 0, 2, 256);
        ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(x + 2, 0, 2, 256);
      }
      for (let i = 0; i < 45; i++) {
        ctx.fillStyle = `rgba(68,48,31,${0.03 + random() * 0.14})`;
        ctx.fillRect(random() * 256, random() * 256, 1 + random() * 3, 7 + random() * 30);
      }
    } else if (kind === 'concrete') {
      ctx.strokeStyle = 'rgba(65,69,61,0.13)'; ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, 255, 255);
      for (let i = 0; i < 12; i++) {
        ctx.fillStyle = 'rgba(70,74,65,0.025)'; ctx.fillRect(random() * 256, random() * 256, 30 + random() * 70, 20 + random() * 40);
      }
    }
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.anisotropy = 4;
    if (kind === 'asphalt') texture.repeat.set(32, 32);
    return texture;
  }
  function zone(x, z) {
    if (Math.abs(x) > 48 || Math.abs(z) > 48) return 'backdrop';
    if (x < -14) return 'west';
    return z > 13 ? 'depot' : 'yard';
  }
  function instance(geo, material, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0, cast = true) {
    const key = `${geo.uuid}/${material.uuid}/${zone(x, z)}/${cast}`;
    if (!batches.has(key)) batches.set(key, { geo, material, matrices: [], cast });
    temp.position.set(x, y, z); temp.rotation.set(rx, ry, rz); temp.scale.set(sx, sy, sz); temp.updateMatrix();
    batches.get(key).matrices.push(temp.matrix.clone());
  }
  function box(x, y, z, w, h, d, material, solid = false, name = 'Train detail', cast = true) {
    let geometry = boxGeo, sx = w, sy = h, sz = d;
    if (material.userData.tileSize) {
      const tile = material.userData.tileSize, key = `${w}/${h}/${d}/${tile}`;
      if (!boxGeometryCache.has(key)) {
        const geo = new THREE.BoxGeometry(w, h, d), uv = geo.attributes.uv;
        const scale = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
        for (let face = 0; face < 6; face++) for (let k = 0; k < 4; k++) {
          const i = face * 4 + k; uv.setXY(i, uv.getX(i) * scale[face][0] / tile, uv.getY(i) * scale[face][1] / tile);
        }
        boxGeometryCache.set(key, geo);
      }
      geometry = boxGeometryCache.get(key); sx = sy = sz = 1;
    }
    instance(geometry, material, x, y, z, sx, sy, sz, 0, 0, 0, cast);
    if (solid) collider(x, y, z, w, h, d, 0, name);
  }
  function collider(x, y, z, w, h, d, yaw = 0, name = 'Train collision', navigationBlock = true) {
    const mesh = new THREE.Mesh(boxGeo, hiddenMaterial); mesh.name = name;
    mesh.position.set(x, y, z); mesh.rotation.y = yaw; mesh.scale.set(w, h, d);
    root.add(mesh); colliders.push(mesh);
    if (navigationBlock) obstacles.push({ x, z, halfW: w / 2, halfD: d / 2, cos: Math.cos(yaw), sin: Math.sin(yaw) });
    return mesh;
  }
  function cylinder(x, y, z, radius, height, material, rx = 0, ry = 0, rz = 0, cast = true) {
    instance(cylinderGeo, material, x, y, z, radius, height, radius, rx, ry, rz, cast);
  }
  function groundPlane(w, d, x, z, material, y = 0.018, angle = 0) {
    instance(planeGeo, material, x, y, z, w, d, 1, -Math.PI / 2, 0, angle, false);
  }
  function beam(a, b, thickness, material, cast = true) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), direction = end.clone().sub(start);
    temp.position.copy(start).add(end).multiplyScalar(0.5);
    temp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
    temp.scale.set(thickness, direction.length(), thickness); temp.updateMatrix();
    const key = `${boxGeo.uuid}/${material.uuid}/${zone(temp.position.x, temp.position.z)}/${cast}`;
    if (!batches.has(key)) batches.set(key, { geo: boxGeo, material, matrices: [], cast });
    batches.get(key).matrices.push(temp.matrix.clone());
  }
  function flushBatches() {
    for (const { geo, material, matrices, cast } of batches.values()) {
      const mesh = new THREE.InstancedMesh(geo, material, matrices.length);
      matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix)); mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere(); mesh.name = 'Train static geometry';
      mesh.castShadow = cast && !material.isMeshBasicMaterial;
      mesh.receiveShadow = !material.isMeshBasicMaterial; root.add(mesh);
    }
    batches.clear();
  }
  function sign(title, subtitle, x, y, z, w, h, yaw = 0, bg = '#344547', ink = '#e0dac4') {
    const key = `${title}/${subtitle}/${bg}/${ink}`;
    if (!signCache.has(key)) {
      const slot = signCache.size;
      const px = (slot % 4) * 512, py = Math.floor(slot / 4) * 128, ctx = atlasContext;
      ctx.fillStyle = bg; ctx.fillRect(px, py, 512, 128);
      ctx.strokeStyle = ink; ctx.lineWidth = 2; ctx.strokeRect(px + 7, py + 7, 498, 114);
      ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.font = `bold ${title.length > 17 ? 34 : 44}px Arial`;
      ctx.fillText(title, px + 256, py + (subtitle ? 65 : 79), 472);
      if (subtitle) { ctx.font = '19px Arial'; ctx.fillText(subtitle, px + 256, py + 103, 470); }
      const geometry = planeGeo.clone(), uv = geometry.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (px + 1 + uv.getX(i) * 510) / 2048, 1 - (py + 127 - uv.getY(i) * 126) / 1024);
      signCache.set(key, geometry); atlasTexture.needsUpdate = true;
    }
    instance(signCache.get(key), signMaterial, x, y, z, w, h, 1, 0, yaw, 0, false);
  }
  function mass(x1, x2, z1, z2, h, material, name) {
    const x = (x1 + x2) / 2, z = (z1 + z2) / 2, w = x2 - x1, d = z2 - z1;
    box(x, h / 2, z, w, h, d, material, true, name);
    box(x, 0.38, z, w + 0.08, 0.76, d + 0.08, mat.base);
    box(x, h - 0.35, z, w + 0.2, 0.25, d + 0.2, mat.trim);
    box(x, h + 0.05, z, w + 0.35, 0.3, d + 0.35, mat.roof);
  }
  function lintel(x, z, w, d, bottom, h, material, name) {
    box(x, bottom + h / 2, z, w, h, d, material);
    collider(x, bottom + h / 2, z, w, h, d, 0, name, false);
  }
  function createGround() {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(96, 96), mat.asphalt);
    ground.name = 'G55FLR_TrainYard'; ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
    root.add(ground); colliders.push(ground); floorObjects.push(ground);
    groundPlane(220, 220, 0, 0, mat.base, -0.08);
    groundPlane(58.9, 30, 15.5, 30.2, mat.depotFloor, 0.012);
    for (const z of [-17, 2.5, 24]) groundPlane(18, 7, -23, z, mat.concrete, 0.009);
    groundPlane(16, 7, 8, 11.5, mat.concrete, 0.009);
    groundPlane(10, 7, 39.5, 11.5, mat.concrete, 0.009);
    for (const z of [16.4, 44.4]) groundPlane(57, 0.15, 15, z, mat.yellow, 0.023);
  }
  function createArchitecture() {
    // The concourse connects all western entrances; none requires a ladder.
    mass(-32, -14, -35, -21, 10.5, mat.brick, 'North freight office');
    mass(-32, -14, -13, -1, 8.8, mat.plaster, 'A Main / Popdog divider');
    mass(-32, -14, 6, 20, 9.8, mat.brick, 'Popdog / B halls divider');
    mass(-32, -14, 28, 45.8, 10.5, mat.darkBrick, 'South service block');
    // Wide, genuine openings: the lintels have no navigation footprint.
    lintel(-23, -17, 18, 8, 5.2, 3.6, mat.plaster, 'A Main ceiling');
    lintel(-23, 2.5, 18, 7, 4.6, 4.2, mat.brick, 'Popdog ceiling');
    lintel(-23, 24, 18, 8, 5.2, 4.6, mat.darkBrick, 'B halls ceiling');
    for (const z of [-20.9, -13.1]) box(-23, 0.45, z, 18, 0.9, 0.12, mat.base);
    for (const z of [20.1, 27.9]) box(-23, 1.1, z, 18, 1.1, 0.1, mat.orange);
    // North office strip creates the long Ivy route behind A.
    mass(-14, 34, -35, -29, 8.2, mat.plaster, 'Ivy office strip');
    for (let x = -11; x < 33; x += 5.5) windowPanel(x, 5.8, -28.89, 3.7, 2.1, 0);
    for (let x = -9; x < 33; x += 8) windowPanel(x, 5.8, -35.11, 3, 1.9, Math.PI);
    sign('A / FREIGHT YARD', 'NO UNAUTHORISED ACCESS', 10, 3.3, -28.85, 8, 1.5);
    sign('IVY  →', 'EAST YARD ACCESS', 7, 2.7, -35.14, 6, 1.2, Math.PI);
    // Two independent connections between the sites. The left one bends.
    mass(-14, 0, 8, 15, 8.6, mat.darkBrick, 'West connector building');
    mass(16, 34, 8, 15, 9.3, mat.brick, 'CT signal building');
    box(3.5, 4.2, 8.4, 7, 8.4, 0.8, mat.darkBrick, true, 'Z north return');
    box(11.5, 4.2, 14.6, 9, 8.4, 0.8, mat.darkBrick, true, 'Z south return');
    lintel(8, 11.5, 16, 7, 5, 3.4, mat.darkBrick, 'Z connector ceiling');
    lintel(40, 11.5, 12, 7, 5.6, 2.1, mat.plaster, 'CT tunnel ceiling');
    for (const x of [20, 25.5, 31]) windowPanel(x, 6.8, 7.88, 3, 1.5, Math.PI);
    sign('Z  /  B  →', 'LOADING HALL 02', 4, 2.8, 7.94, 4.5, 1.1, Math.PI);
    sign('←  A   /   B  →', 'EAST CONNECTION', 34.14, 2.8, 11.5, 5.5, 1.1, Math.PI / 2);
    sign('←  A / MAIN', 'FREIGHT YARD', -32.16, 6.3, -17, 6.2, 1.4, -Math.PI / 2);
    sign('POPDOG', 'GROUND ACCESS', -32.15, 5.8, 2.5, 5.8, 1.2, -Math.PI / 2);
    sign('B / LOADING HALL', 'WAREHOUSE 02', -32.15, 6.4, 24, 7, 1.5, -Math.PI / 2);
    // Perimeter surfaces are physical walls, rather than invisible blockers.
    box(-46.7, 4.5, 0, 1.8, 9, 95.2, mat.darkBrick, true, 'West perimeter');
    box(46.7, 4.5, 0, 1.8, 9, 95.2, mat.brick, true, 'East perimeter');
    box(0, 3.1, -46.7, 95.2, 6.2, 1.8, mat.darkBrick, true, 'North perimeter');
    box(0, 5.1, 46.7, 95.2, 10.2, 1.8, mat.brick, true, 'South perimeter');
    for (const x of [-46.7, 46.7]) box(x, 9.07, 0, 1.95, 0.28, 95.3, mat.trim);
    box(0, 6.27, -46.7, 95.3, 0.28, 2, mat.trim);
    for (let z = -40; z < 44; z += 9) {
      box(-45.72, 4.5, z, 0.22, 9, 0.65, mat.base);
      box(45.72, 4.5, z, 0.22, 9, 0.65, mat.base);
    }
    for (const z of [-23, -13, -3]) {
      box(45.72, 2.7, z, 0.12, 5.4, 5, mat.roof);
      for (let y = 0.5; y < 5.1; y += 0.45) box(45.63, y, z, 0.06, 0.055, 4.9, mat.metal, false, '', false);
      sign('TRACK ' + (z === -23 ? '01' : z === -13 ? '02' : '03'), 'END OF LINE', 45.58, 5.9, z, 3.6, 0.75, -Math.PI / 2);
    }
    // Glazed control room over a solid building: no unreachable occupied floor.
    box(25, 11, 11.5, 12, 3.3, 5.4, mat.plaster);
    for (const x of [20.6, 23.5, 26.5, 29.4]) windowPanel(x, 11.2, 8.74, 2.35, 2, Math.PI);
    box(25, 12.82, 11.5, 12.5, 0.34, 5.8, mat.roof);
  }
  function windowPanel(x, y, z, w, h, yaw) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const part = (lx, ly, lz, sx, sy, sz, material) => instance(boxGeo, material, x + c * lx + s * lz, y + ly, z - s * lx + c * lz, sx, sy, sz, 0, yaw, 0, false);
    part(0, 0, 0, w + 0.18, h + 0.18, 0.12, mat.metal);
    part(0, 0, 0.075, w, h, 0.045, mat.glass);
    for (let dx = -w / 2; dx <= w / 2 + 0.01; dx += w / 3) part(dx, 0, 0.12, 0.055, h, 0.04, mat.trim);
    part(0, 0, 0.12, w, 0.06, 0.04, mat.trim); part(0, -h / 2 - 0.12, 0.14, w + 0.3, 0.12, 0.3, mat.trim);
  }
  function createDepot() {
    // The depot has segmented walls around the two B-hall/connector entrances.
    box(-14, 5.1, 17.5, 0.8, 10.2, 5, mat.plaster, true, 'B west wall north');
    box(-14, 5.1, 36.9, 0.8, 10.2, 17.8, mat.plaster, true, 'B west wall south');
    lintel(-14, 24, 0.8, 8, 5.2, 5, mat.plaster, 'B halls portal lintel');
    lintel(15.8, 15.35, 60.4, 0.7, 6, 4.2, mat.plaster, 'Depot north clerestory wall');
    // Wall surfaces and orange safety stripe share exact open intervals.
    for (const [x, w] of [[-7, 14], [20.5, 27]]) {
      box(x, 6.8, 15.14, w, 3, 0.2, mat.plaster);
      box(x, 1.2, 15.15, w, 1.15, 0.12, mat.orange, false, '', false);
    }
    box(15.4, 1.2, 45.72, 59.6, 1.15, 0.12, mat.orange, false, '', false);
    for (let x = -10; x < 43; x += 7.5) windowPanel(x, 7.3, 45.69, 5.1, 2.7, Math.PI);
    for (let x = -10; x < 45; x += 6) windowPanel(x, 8.2, 15.76, 4.4, 2.2, 0);
    sign('B / DEPOT 02', 'HAZARDOUS FREIGHT — KEEP CLEAR', 13, 4.8, 45.57, 12, 2, Math.PI, '#b1a68a', '#413e33');
    sign('← A / CONNECTOR', 'Z', 11.5, 3.4, 15.12, 6.5, 1.3, 0);
    // One continuous pitched roof with a raised glazed monitor. The roof itself
    // participates in shooting collision but never becomes a navigation floor.
    roofSlope(-14.6, 46.3, 14.7, 10.2, 26.8, 14.2);
    roofSlope(-14.6, 46.3, 33.4, 14.2, 46.3, 10.2);
    depotGable(-14.4); depotGable(45.8);
    box(15.85, 14.2, 26.8, 61, 0.32, 0.3, mat.metal);
    box(15.85, 14.2, 33.4, 61, 0.32, 0.3, mat.metal);
    box(15.85, 15, 30.1, 61.5, 0.3, 7.2, mat.roof);
    // Roof and glazing block shots, without blocking the floor below them.
    collider(15.85, 15, 30.1, 61.5, 0.3, 7.2, 0, 'Depot monitor roof', false);
    for (const z of [26.8, 33.4]) {
      box(15.85, 14.65, z, 61, 0.7, 0.1, mat.glass, false, '', false);
      collider(15.85, 14.65, z, 61, 0.7, 0.1, 0, 'Depot monitor glazing', false);
      for (let x = -14; x <= 46; x += 3.75) box(x, 14.6, z, 0.08, 0.9, 0.15, mat.metal, false, '', false);
    }
    for (const x of [-13.5, -2, 9.5, 21, 32.5, 45.7]) {
      for (const z of [15.6, 45.5]) {
        box(x, 5.1, z, 0.42, 10.2, 0.42, mat.metal);
        // Piers stand against the existing solid intervals, outside doorway mouths.
        if (!(z === 15.6 && (x > 0 && x < 7 || x > 34))) collider(x, 5.1, z, 0.42, 10.2, 0.42, 0, 'Depot pier');
      }
      beam([x, 10.15, 15.5], [x, 10.15, 45.6], 0.2, mat.metal);
      beam([x, 10.15, 15.5], [x, 14.1, 27], 0.22, mat.metal);
      beam([x, 14.1, 33.2], [x, 10.15, 45.6], 0.22, mat.metal);
      for (let z = 16; z < 44; z += 4.7) {
        beam([x, 10.15, z], [x, 12.2, z + 2.3], 0.085, mat.metal, false);
        beam([x, 12.2, z + 2.3], [x, 10.15, z + 4.7], 0.085, mat.metal, false);
      }
    }
    for (const x of [-6, 10, 27, 41]) for (const z of [19, 41]) {
      cylinder(x, 8.6, z, 0.025, 3.1, mat.dark);
      box(x, 7.05, z, 2.7, 0.13, 0.48, mat.metal);
      box(x, 6.97, z, 2.5, 0.025, 0.34, mat.lamp, false, '', false);
    }
    for (const x of [0, 29]) {
      const light = new THREE.PointLight(0xffdc9f, 42, 25, 2); light.position.set(x, 6.6, 30); root.add(light);
    }
  }
  function depotGable(x) {
    const shape = new THREE.Shape(); shape.moveTo(14.7, 10.2);
    shape.lineTo(26.8, 14.2); shape.lineTo(26.8, 15.0); shape.lineTo(33.4, 15.0);
    shape.lineTo(33.4, 14.2); shape.lineTo(46.3, 10.2); shape.closePath();
    const geometry = new THREE.ShapeGeometry(shape), uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 5, uv.getY(i) / 5);
    geometry.rotateY(-Math.PI / 2);
    const material = mat.plaster.clone(); material.side = THREE.DoubleSide;
    const mesh = new THREE.Mesh(geometry, material); mesh.position.x = x;
    mesh.castShadow = mesh.receiveShadow = true; mesh.name = 'Depot gable end'; root.add(mesh); colliders.push(mesh);
  }
  function roofSlope(x1, x2, z1, y1, z2, y2) {
    const vertices = [x1,y1,z1, x2,y1,z1, x2,y2,z2, x1,y1,z1, x2,y2,z2, x1,y2,z2];
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geometry.computeVertexNormals();
    const material = mat.roof.clone(); material.side = THREE.DoubleSide;
    const mesh = new THREE.Mesh(geometry, material); mesh.name = 'Depot pitched roof'; mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh); colliders.push(mesh);
    for (let x = x1 + 1; x < x2; x += 3.8) beam([x, y1 + 0.04, z1], [x, y2 + 0.04, z2], 0.055, mat.metal, false);
  }
  function track(z, x1, x2) {
    groundPlane(x2 - x1, 3.5, (x1 + x2) / 2, z, mat.ballast, 0.026);
    for (let x = x1 + 0.4; x < x2; x += 1.05) {
      box(x, 0.025, z, 0.22, 0.04, 2.7, mat.sleeper, false, '', false);
      for (const dz of [-0.8, 0.8]) box(x, 0.056, z + dz, 0.32, 0.026, 0.3, mat.rust, false, '', false);
    }
    for (const dz of [-0.8, 0.8]) box((x1 + x2) / 2, 0.077, z + dz, x2 - x1, 0.065, 0.105, mat.rail, false, '', false);
  }
  function createRailYards() {
    for (const z of [-23, -13, -3]) track(z, -13.5, 45.6);
    for (const z of [23.5, 36]) track(z, -13.5, 45.6);
    wagon(-4.4, -23, 13.8, mat.blue, 'box', '074 / BLUE');
    wagon(22.2, -23, 13.6, mat.green, 'box', '219 / GREEN');
    wagon(15.5, -13, 15, mat.red, 'box', '463 / RED');
    wagon(-1.7, -3, 15.5, mat.yellow, 'cargo', 'A / 01');
    wagon(1.2, 36, 15.6, mat.red, 'box', '827 / FREIGHT');
    wagon(25.2, 23.5, 15.2, mat.tanker, 'tank', 'OIL / 683');
    wagon(27.2, 36, 13.5, mat.yellow, 'cargo', 'B / 02');
    siteOutline(-1.7, -3, 17.8, 5.4);
    siteOutline(27.2, 36, 15.7, 5.4);
    for (const z of [-23, -13, -3]) {
      box(43.9, 0.62, z, 0.35, 1.24, 3, mat.rust, true, 'Rail end buffer');
      box(43.65, 1.04, z, 0.26, 0.22, 2.8, mat.white, true, 'Rail buffer front plate');
    }
  }
  function wagon(x, z, length, material, type, number) {
    // Full underframe / side skirts explicitly close the non-playable underside.
    box(x, 0.61, z, length, 1.08, 3.1, mat.dark, true, 'Freight wagon underframe');
    box(x, 1.19, z, length + 0.12, 0.24, 3.6, mat.metal, true, 'Freight wagon deck');
    for (const dz of [-1.52, 1.52]) {
      box(x, 0.76, z + dz, length, 0.48, 0.13, mat.rust);
      for (const dx of [-length * 0.33, length * 0.33]) {
        box(x + dx, 0.59, z + dz, 2.6, 0.3, 0.16, mat.metal);
        for (const axle of [-0.75, 0.75]) {
          cylinder(x + dx + axle, 0.55, z + dz, 0.48, 0.19, mat.dark, Math.PI / 2);
          cylinder(x + dx + axle, 0.55, z + dz * 1.085, 0.23, 0.035, mat.rail, Math.PI / 2);
        }
      }
    }
    for (const end of [-1, 1]) {
      box(x + end * (length / 2 + 0.25), 0.9, z, 0.6, 0.2, 0.4, mat.dark);
      for (const dz of [-1.13, 1.13]) box(x + end * (length / 2 + 0.2), 0.95, z + dz, 0.36, 0.38, 0.36, mat.metal);
    }
    if (type === 'box') {
      box(x, 2.7, z, length, 2.8, 3.45, material, true, 'Closed freight boxcar');
      box(x, 4.16, z, length + 0.2, 0.16, 3.62, mat.roof);
      box(x, 4.27, z, length + 0.1, 0.12, 2.5, mat.roof);
      collider(x, 4.16, z, length + 0.2, 0.16, 3.62, 0, 'Freight wagon roof edge', false);
      collider(x, 4.27, z, length + 0.1, 0.12, 2.5, 0, 'Freight wagon roof crown', false);
      for (const side of [-1, 1]) {
        for (let dx = -length / 2 + 0.35; dx < length / 2; dx += 1.12) box(x + dx, 2.73, z + side * 1.77, 0.085, 2.6, 0.1, material);
        box(x, 2.65, z + side * 1.84, 3.4, 2.45, 0.1, mat.metal);
        box(x, 2.68, z + side * 1.91, 3.12, 2.22, 0.06, material);
        collider(x, 2.65, z + side * 1.835, 3.4, 2.45, 0.22, 0, 'Freight wagon sliding door');
        box(x, 3.99, z + side * 1.88, 5.5, 0.08, 0.15, mat.rail);
        box(x + 1.25, 2.4, z + side * 1.98, 0.055, 0.42, 0.07, mat.rail);
        sign(number, 'TARE 24 600 KG / RAIL FREIGHT', x - length * 0.3, 2.5, z + side * 1.835, 3.1, 0.7, side > 0 ? 0 : Math.PI, '#404a45', '#dad5bb');
      }
      for (const dx of [-length / 2, length / 2]) {
        box(x + dx, 2.75, z, 0.08, 2.65, 0.08, mat.metal);
        for (const dz of [-1.3, 1.3]) box(x + dx, 2.73, z + dz, 0.12, 2.65, 0.12, mat.metal);
      }
    } else if (type === 'tank') {
      const geometry = new THREE.CylinderGeometry(1.47, 1.47, length - 0.8, 20);
      const tank = new THREE.Mesh(geometry, material); tank.rotation.z = Math.PI / 2; tank.position.set(x, 2.8, z);
      tank.castShadow = tank.receiveShadow = true; tank.name = 'Oil tanker shell'; root.add(tank); colliders.push(tank);
      for (const dx of [-length * 0.3, length * 0.3]) instance(tankBandGeo, mat.metal, x + dx, 2.8, z, 1.5, 0.17, 1.5, 0, 0, Math.PI / 2);
      const endGeometry = new THREE.SphereGeometry(1, 20, 12);
      for (const side of [-1, 1]) {
        const end = new THREE.Mesh(endGeometry, material); end.position.set(x + side * (length - 0.8) / 2, 2.8, z); end.scale.set(0.36, 1.47, 1.47);
        end.name = 'Oil tanker rounded end'; end.castShadow = end.receiveShadow = true; root.add(end); colliders.push(end);
      }
      box(x, 4.32, z, length * 0.65, 0.08, 0.65, mat.metal);
      cylinder(x, 4.42, z, 0.42, 0.24, mat.metal);
      for (const side of [-1, 1]) sign(number, 'FLAMMABLE / NO OPEN FLAME', x, 2.65, z + side * 1.49, 5.2, 0.83, side > 0 ? 0 : Math.PI, '#74786b', '#e2d4ae');
    } else {
      for (const dx of [-length * 0.23, length * 0.23]) {
        box(x + dx, 2.43, z, length * 0.39, 2.3, 2.85, material, true, 'Marked hazardous freight container');
        box(x + dx, 3.63, z, length * 0.39 + 0.08, 0.15, 3, mat.metal);
        collider(x + dx, 3.63, z, length * 0.39 + 0.08, 0.15, 3, 0, 'Cargo container top cover', false);
        for (const side of [-1, 1]) {
          for (let rib = -2; rib <= 2; rib++) box(x + dx + rib * 0.8, 2.45, z + side * 1.47, 0.08, 2.13, 0.085, material);
          sign(number, 'CAUTION / CONTROLLED CARGO', x + dx, 2.6, z + side * 1.53, 3.8, 0.95, side > 0 ? 0 : Math.PI, '#b38c37', '#302f24');
          for (const offset of [-1.7, 1.7]) radiationMark(x + dx + offset, 1.75, z + side * 1.535, side > 0 ? 0 : Math.PI);
        }
      }
    }
  }
  function radiationMark(x, y, z, yaw) {
    // Procedural trefoil; kept on the cargo panels, clear of all sightlines.
    instance(warningDotGeo, mat.dark, x, y, z, 1, 1, 1, 0, yaw, 0, false);
    for (let i = 0; i < 3; i++) instance(warningBladeGeo, mat.dark, x, y, z, 1, 1, 1, 0, yaw, i * Math.PI * 2 / 3, false);
  }
  function siteOutline(x, z, w, d) {
    // Above the 0.026 ballast surface; rails and sleepers still occlude the paint.
    for (const dz of [-d / 2, d / 2]) groundPlane(w, 0.15, x, z + dz, mat.yellow, 0.04);
    for (const dx of [-w / 2, w / 2]) groundPlane(0.15, d, x + dx, z, mat.yellow, 0.04);
  }
  function createLandmarks() {
    // Water tower belongs to the closed northern office roof, out of navigation.
    const x = -25, z = -28.5;
    for (const dx of [-1.8, 1.8]) for (const dz of [-1.8, 1.8]) {
      beam([x + dx * 1.4, 10.7, z + dz * 1.4], [x + dx, 19.9, z + dz], 0.24, mat.metal);
    }
    for (const dz of [-1.8, 1.8]) {
      beam([x - 2.5, 11, z + dz], [x + 1.8, 19.8, z + dz], 0.11, mat.metal);
      beam([x + 2.5, 11, z + dz], [x - 1.8, 19.8, z + dz], 0.11, mat.metal);
    }
    cylinder(x, 22.4, z, 3.65, 5.1, mat.rust);
    for (const y of [20, 21, 23.7, 24.95]) cylinder(x, y, z, 3.73, 0.14, mat.metal);
    cylinder(x, 22.4, z, 3.68, 1.3, mat.trim);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(3.95, 1.5, 20), mat.roof); cone.position.set(x, 25.75, z); cone.castShadow = true; root.add(cone);
    sign('TRAIN / 01', 'WATER RESERVE', x, 22.4, z + 3.73, 5.4, 1.1, 0, '#adb09e', '#45514a');
    cylinder(x + 3.1, 15.4, z, 0.16, 10.3, mat.metal);
    // Two open signal bridges frame the tracks without blocking the lanes.
    for (const gx of [-11.8, 33.7]) {
      for (const gz of [-27.4, 6.4]) {
        box(gx, 4.65, gz, 0.38, 9.3, 0.38, mat.metal, true, 'Signal gantry pier');
        box(gx, 0.28, gz, 0.8, 0.56, 0.8, mat.concrete, true, 'Signal gantry footing');
      }
      for (const y of [8.9, 9.9]) box(gx, y, -10.5, 0.24, 0.18, 34, mat.metal);
      for (let z0 = -27; z0 < 6; z0 += 3.3) {
        beam([gx, 8.95, z0], [gx, 9.85, z0 + 1.65], 0.09, mat.metal);
        beam([gx, 9.85, z0 + 1.65], [gx, 8.95, z0 + 3.3], 0.09, mat.metal);
      }
      for (const gz of [-23, -13, -3]) {
        box(gx + 0.2, 8.2, gz, 0.35, 1.15, 0.65, mat.dark);
        cylinder(gx + 0.4, 8.4, gz, 0.16, 0.06, mat.signal, 0, 0, Math.PI / 2, false);
        cylinder(gx + 0.4, 8, gz, 0.16, 0.06, mat.glass, 0, 0, Math.PI / 2, false);
      }
    }
  }
  function crate(x, z, w = 2.2, d = 2, h = 1.7) {
    box(x, h / 2, z, w, h, d, mat.wood, true, 'Timber shipping crate');
    for (const dx of [-w / 2 + 0.15, w / 2 - 0.15]) box(x + dx, h / 2, z, 0.16, h + 0.08, d + 0.06, mat.rust);
    for (const y of [0.18, h - 0.16]) box(x, y, z, w + 0.08, 0.16, d + 0.08, mat.rust);
    for (const side of [-1, 1]) beam([x - w / 2 + 0.18, 0.25, z + side * (d / 2 + 0.05)], [x + w / 2 - 0.18, h - 0.25, z + side * (d / 2 + 0.05)], 0.13, mat.rust);
  }
  function createCover() {
    // Cover is concentrated at crossings; the floor remains clear around trains.
    box(-9.7, 1.4, 2.7, 3, 2.8, 2.6, mat.green, true, 'A electrical cabinet');
    box(-9.7, 2.9, 2.7, 3.15, 0.2, 2.72, mat.roof);
    collider(-9.7, 2.9, 2.7, 3.15, 0.2, 2.72, 0, 'Electrical cabinet cap', false);
    for (let y = 0.6; y < 2.4; y += 0.18) box(-9.7, y, 4.035, 2.5, 0.05, 0.04, mat.dark, false, '', false);
    sign('DANGER / 400 V', 'HIGH VOLTAGE', -9.7, 2.37, 4.07, 2.3, 0.5);
    crate(29.8, 1.7, 2.8, 2.5, 1.25);
    crate(-9, 18.4, 2.3, 2.1, 1.65); crate(42.3, 42.5, 2.8, 2.5, 1.7);
    crate(-43.2, -7, 2.8, 2.7, 1.5); crate(-43.2, 35, 2.8, 2.7, 1.8);
    box(-42.9, 0.85, -39.5, 3.4, 1.7, 2.6, mat.green, true, 'Ivy dumpster');
    box(-42.9, 1.77, -39.5, 3.6, 0.18, 2.75, mat.dark, true, 'Ivy dumpster lid');
    for (const x of [-44, -41.8]) box(x, 0.25, -39.5, 0.23, 0.5, 2.6, mat.metal);
    box(24, 1.1, -42.6, 3.2, 2.2, 2, mat.metal, true, 'Ivy utility cabinet');
    for (const x of [23.2, 24.8]) box(x, 1.1, -41.55, 1.45, 1.95, 0.06, mat.base);
  }
  function createDetails() {
    // Exposed conduits are attached to masonry and do not narrow passages.
    for (const z of [-34.83, -29.16]) for (const y of [3.6, 4.05]) {
      cylinder(10, y, z, 0.085, 46, mat.metal, 0, 0, Math.PI / 2, false);
    }
    for (const z of [-26, -7, 13, 36]) {
      cylinder(-32.18, 4.2, z, 0.085, 8.4, mat.metal, 0, 0, 0, false);
      for (const y of [1.5, 4, 6.5]) box(-32.2, y, z, 0.18, 0.08, 0.4, mat.metal, false, '', false);
    }
    for (const z of [-17, 2.5, 24]) {
      box(-23, 4.25, z, 2.5, 0.1, 0.4, mat.metal);
      box(-23, 4.18, z, 2.3, 0.035, 0.3, mat.lamp, false, '', false);
    }
    for (const p of [[-45.5,-18],[-45.5,18],[45.5,-35],[45.5,3]]) {
      const side = p[0] < 0 ? 1 : -1;
      box(p[0] + side * 0.7, 6.4, p[1], 1.4, 0.1, 0.12, mat.metal);
      box(p[0] + side * 1.35, 6.3, p[1], 0.8, 0.18, 0.5, mat.dark);
      box(p[0] + side * 1.35, 6.2, p[1], 0.7, 0.03, 0.4, mat.lamp, false, '', false);
    }
    // Ivy is sparse at head level, concentrated around the north wall corners.
    const leafGeo = new THREE.IcosahedronGeometry(1, 0);
    for (const center of [-24, 14, 37]) {
      for (let k = 0; k < 26; k++) {
        const x = center + (random() - 0.5) * 3.2, y = 0.5 + random() * 5;
        instance(leafGeo, mat.ivy, x, y, -45.66, 0.25 + random() * 0.25, 0.25 + random() * 0.3, 0.14, random(), random(), random(), false);
      }
    }
    // Roof ventilators and ladders belong only to closed non-playable buildings.
    for (const p of [[-23,-7,9],[-23,13,10],[-23,35,10.7],[6,-32,8.4]]) {
      box(p[0], p[2] + 0.7, p[1], 3.2, 1.4, 2.3, mat.metal);
      for (let y = p[2] + 0.2; y < p[2] + 1.4; y += 0.2) box(p[0], y, p[1] + 1.18, 2.8, 0.05, 0.04, mat.dark, false, '', false);
    }
    for (const x of [-27.5, -26.4]) cylinder(x, 15, -24.78, 0.045, 8.5, mat.metal, 0, 0, 0, false);
    for (let y = 11; y < 19; y += 0.38) box(-26.95, y, -24.78, 1.18, 0.045, 0.065, mat.metal, false, '', false);
    // Drain grates and a few wall-side debris groups; no loose collision snags.
    for (const p of [[-35,-10],[-35,30],[39,-28],[38,18]]) {
      box(p[0], 0.017, p[1], 1.4, 0.024, 0.65, mat.metal, false, '', false);
      for (let x = -0.55; x < 0.65; x += 0.16) box(p[0] + x, 0.032, p[1], 0.055, 0.012, 0.55, mat.dark, false, '', false);
    }
    for (const p of [[-44,42],[-44,-32],[43,-40],[-12,-27],[43,43]]) {
      for (let i = 0; i < 5; i++) groundPlane(0.16 + random() * 0.18, 0.25, p[0] + random(), p[1] + random(), mat.white, 0.02, random() * 5);
    }
  }
  function createBackdrop() {
    // Authored, low-cost industrial skyline. No gameplay randomness or downloads.
    // Keep every background footprint outside the physical perimeter walls.
    for (const p of [[-60,-23,16,42,18],[-55.5,38,12,26,16],[16,-58,46,15,18],[56,-23,14,35,23],[60,28,18,32,17],[-8,61,42,16,15]]) {
      const [x,z,w,d,h] = p;
      box(x, h / 2 - 0.1, z, w, h, d, mat.darkBrick, false, '', false);
      box(x, h + 0.1, z, w + 0.4, 0.4, d + 0.4, mat.roof, false, '', false);
      for (let dx = -w / 2 + 2.5; dx < w / 2; dx += 4.8) {
        box(x + dx, h - 4.5, z + d / 2 + 0.08, 2.4, 3.3, 0.1, mat.glass, false, '', false);
        box(x + dx, h - 4.5, z - d / 2 - 0.08, 2.4, 3.3, 0.1, mat.glass, false, '', false);
      }
    }
    for (const p of [[-5,-63,34],[5,-65,29],[57,54,31]]) {
      cylinder(p[0], p[2] / 2, p[1], 1.2, p[2], mat.rust, 0, 0, 0, false);
      for (const y of [p[2] - 2.4, p[2] - 6]) cylinder(p[0], y, p[1], 1.23, 1.6, mat.trim, 0, 0, 0, false);
      cylinder(p[0], p[2] + 0.1, p[1], 1.3, 0.25, mat.metal, 0, 0, 0, false);
    }
    for (const x of [-37, 27]) {
      box(x, 18, 59, 0.3, 36, 0.3, mat.metal, false, '', false);
      box(x, 36, 59, 12, 0.3, 0.3, mat.metal, false, '', false);
      for (const dx of [-4.8,-2.4,0,2.4,4.8]) box(x + dx, 35.8, 59, 1.15, 0.9, 0.55, mat.trim, false, '', false);
    }
  }
  function createSky() {
    const s = WORLD_SETTINGS.sky; scene.background = new THREE.Color(s.fogColor); scene.fog = new THREE.Fog(s.fogColor, s.fogNear, s.fogFar);
    const geometry = new THREE.SphereGeometry(450, 24, 16), colors = [], color = new THREE.Color();
    const top = new THREE.Color(s.top), mid = new THREE.Color(s.mid), horizon = new THREE.Color(s.horizon);
    const position = geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      const t = Math.max(0, position.getY(i) / 450);
      color.copy(t < 0.25 ? horizon : mid).lerp(t < 0.25 ? mid : top, t < 0.25 ? t / 0.25 : (t - 0.25) / 0.75); colors.push(color.r, color.g, color.b);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const dome = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false }));
    dome.name = 'Train industrial sky'; dome.renderOrder = -1000; scene.add(dome);
    // One definition controls both the visible sun and the engine-owned sunlight.
    const sun = new THREE.Mesh(new THREE.SphereGeometry(4, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffedc9, fog: false }));
    sun.position.set(...WORLD_SETTINGS.lighting.sunPosition).normalize().multiplyScalar(360);
    scene.add(sun);
  }
  function blocked(x, z, margin = 0.55) {
    if (Math.abs(x) > 46.2 - margin || Math.abs(z) > 46.2 - margin) return true;
    for (const b of obstacles) {
      const dx = x - b.x, dz = z - b.z, lx = b.cos * dx - b.sin * dz, lz = b.sin * dx + b.cos * dz;
      if (Math.abs(lx) < b.halfW + margin && Math.abs(lz) < b.halfD + margin) return true;
    }
    return false;
  }
  function createNavigation() {
    // Keep the walkable grid and cover queries used for multiplayer spawns.
    const cellSize = 1, width = 94, origin = -47, count = width * width;
    const walkable = new Uint8Array(count);
    const cellX = i => origin + (i % width + 0.5) * cellSize, cellZ = i => origin + (Math.floor(i / width) + 0.5) * cellSize;
    for (let i = 0; i < count; i++) walkable[i] = blocked(cellX(i), cellZ(i), 0.62) ? 0 : 1;

    function hasLineOfSight(a, b, margin = 0.12) {
      if (Math.abs(b.x) > 46.2 - margin || Math.abs(b.z) > 46.2 - margin) return false;
      // Exact segment/expanded-box tests avoid clipping small corners between
      // samples, especially around diagonally parked vehicles.
      for (const block of obstacles) {
        const ax = a.x - block.x, az = a.z - block.z;
        const bx = b.x - block.x, bz = b.z - block.z;
        const ox = block.cos * ax - block.sin * az;
        const oz = block.sin * ax + block.cos * az;
        const dx = block.cos * bx - block.sin * bz - ox;
        const dz = block.sin * bx + block.cos * bz - oz;
        let near = 0, far = 1, misses = false;
        for (const axis of [[ox, dx, block.halfW + margin], [oz, dz, block.halfD + margin]]) {
          const [start, delta, half] = axis;
          if (Math.abs(delta) < 1e-9) {
            if (Math.abs(start) >= half) { misses = true; break; }
            continue;
          }
          const first = (-half - start) / delta, second = (half - start) / delta;
          near = Math.max(near, Math.min(first, second));
          far = Math.min(far, Math.max(first, second));
          if (near >= far) { misses = true; break; }
        }
        if (!misses) return false;
      }
      return true;
    }

    return {
      hasLineOfSight,
      grid: { width, cellSize, origin, walkable }
    };
  }

  function resetPlayer(player) { if (world.isLoaded) player.reset({ position: world.spawn.clone(), yaw: WORLD_SETTINGS.spawnYaw }); }
  function mulberry32(seed) {
    let value = seed >>> 0;
    return () => {
      value += 0x6D2B79F5; let t = value;
      t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
}
