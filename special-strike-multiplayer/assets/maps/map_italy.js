// cs_italy — a procedural Counter-Strike village adapted to this engine's
// ground-level combat. Upper storeys are scenery; all active routes are level.
// Shared FFA spawning uses this map's walkable grid and cover queries.
export const WORLD_SETTINGS = {
  seed: 20000608, size: 96, spawn: [6, 1.75, 36], spawnYaw: -0.55,
  sky: { top: 0x5791bd, mid: 0x9fc4d4, horizon: 0xe3e2cf, fogColor: 0xd0d8d1, fogNear: 58, fogFar: 165 },
  lighting: {
    hemisphereSky: 0xddeafa, hemisphereGround: 0x9a8063, hemisphereIntensity: 1.65,
    sunColor: 0xffe3b1, sunIntensity: 2.6, sunPosition: [-28, 45, 25]
  }
};

export function createWorld({ THREE, scene }) {
  const root = new THREE.Group(); root.name = "cs_italy"; scene.add(root);
  const colliders = [], floorObjects = [];
  const obstacles = [], batches = new Map(), random = mulberry32(WORLD_SETTINGS.seed);
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const planeGeo = new THREE.PlaneGeometry(1, 1);
  const cylinderGeo = new THREE.CylinderGeometry(1, 1, 1, 10);
  const sphereGeo = new THREE.IcosahedronGeometry(1, 1);
  const gableShape = new THREE.Shape();
  gableShape.moveTo(-0.5, 0); gableShape.lineTo(0.5, 0); gableShape.lineTo(0, 1); gableShape.closePath();
  const gableGeo = new THREE.ShapeGeometry(gableShape);
  // Closed roof volume, shared by every solid building. It is not walkable
  // ground and must never enter the flat navigation footprint list.
  const roofCollisionGeo = new THREE.BufferGeometry();
  roofCollisionGeo.setAttribute("position", new THREE.Float32BufferAttribute([
    -0.5, 0, 0.5, 0.5, 0, 0.5, 0, 1, 0.5,
    -0.5, 0, -0.5, 0.5, 0, -0.5, 0, 1, -0.5
  ], 3));
  roofCollisionGeo.setIndex([0, 1, 2, 4, 3, 5, 3, 4, 1, 3, 1, 0, 3, 0, 2, 3, 2, 5, 1, 4, 5, 1, 5, 2]);
  roofCollisionGeo.computeVertexNormals();
  const temp = new THREE.Object3D(), hiddenMaterial = new THREE.MeshBasicMaterial({ visible: false });
  const roofCollisionMaterial = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
  const textures = {
    plaster: surfaceTexture("plaster"), stone: surfaceTexture("stone"),
    cobble: surfaceTexture("cobble"), roof: surfaceTexture("roof"), wood: surfaceTexture("wood")
  };
  const mat = {
    ivory: standard(0xe3d4b2, { map: textures.plaster }),
    ochre: standard(0xcbb17c, { map: textures.plaster }),
    peach: standard(0xd0a086, { map: textures.plaster }),
    pale: standard(0xddd9c5, { map: textures.plaster }),
    rose: standard(0xb98a78, { map: textures.plaster }),
    stone: standard(0xb1aa96, { map: textures.stone, bumpMap: textures.stone, bumpScale: 0.045 }),
    trim: standard(0xd4c9ad), darkStone: standard(0x8e8a75, { map: textures.stone }),
    cobble: standard(0xb5b4a8, { map: textures.cobble, bumpMap: textures.cobble, bumpScale: 0.055 }),
    roof: standard(0xb76543, { map: textures.roof, bumpMap: textures.roof, bumpScale: 0.055 }),
    tileEdge: standard(0x995435), interior: standard(0xd7c7a7),
    floor: standard(0xb8aa8b, { map: textures.stone }),
    wood: standard(0x87704a, { map: textures.wood }), darkWood: standard(0x61533b, { map: textures.wood }),
    green: standard(0x4e6650), greenLight: standard(0x6c7a5b),
    recess: standard(0x394544), glass: standard(0x647c79, { roughness: 0.6, metalness: 0.15 }),
    iron: standard(0x3e433e, { metalness: 0.5, roughness: 0.7 }),
    canvas: standard(0xe5dbc0), stripe: standard(0x657b56),
    red: standard(0xb44b35), apple: standard(0x94a04c), yellow: standard(0xd6ad43),
    leaf: standard(0x627452), leafLight: standard(0x81916b), trunk: standard(0x77674b),
    pot: standard(0xb16e4c), white: standard(0xe4ddc6), chickenDark: standard(0x796d52),
    water: standard(0x6f9e9b, { roughness: 0.28, metalness: 0.22 }),
    distant: standard(0x8fa49a), hill: standard(0x91a78c),
    lamp: standard(0xe1c79a, { emissive: 0xc5a377, emissiveIntensity: 0.14 })
  };
  const world = {
    map: root, colliders, floorObjects,
    isLoaded: false, spawn: new THREE.Vector3(...WORLD_SETTINGS.spawn),
    lighting: WORLD_SETTINGS.lighting, ready: null, navigation: null,
    resetPlayer
  };

  createSky(); createGround(); createTown(); createInteriors(); createLongHall();
  createCover();
  // Architectural details are built separately from the shared solid footprints.
  createArchitecture(); createMarket(); createStreetDetails(); createBackdrop();
  flushBatches(); root.updateMatrixWorld(true);
  world.navigation = createNavigation();
  world.isLoaded = true; world.ready = Promise.resolve(world);
  return world;

  function standard(color, extra = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.94, metalness: 0, ...extra });
  }
  function canvasTexture(width, height, draw) {
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    draw(canvas.getContext("2d"), width, height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
    return texture;
  }
  function surfaceTexture(kind) {
    const texture = canvasTexture(512, 512, (ctx, w, h) => {
      ctx.fillStyle = kind === "cobble" ? "#77766d" : kind === "roof" ? "#b0a392" : "#d9d6cc";
      ctx.fillRect(0, 0, w, h);
      if (kind === "cobble" || kind === "stone") {
        const cw = kind === "cobble" ? 64 : 128, ch = kind === "cobble" ? 42.6667 : 64;
        for (let row = -1; row <= h / ch; row++) for (let col = -1; col <= w / cw; col++) {
          const x = col * cw + (row % 2) * cw / 2, y = row * ch;
          const gray = 164 + Math.floor(random() * 49);
          ctx.fillStyle = `rgb(${gray},${gray - 2},${gray - 9})`;
          ctx.beginPath(); ctx.roundRect(x + 2, y + 2, cw - 4, ch - 4, kind === "cobble" ? 7 : 2); ctx.fill();
          ctx.strokeStyle = "rgba(255,255,255,0.16)"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(x + 7, y + ch - 5); ctx.lineTo(x + 7, y + 6); ctx.lineTo(x + cw - 6, y + 6); ctx.stroke();
        }
      } else if (kind === "roof") {
        for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
          const x = col * 64, y = row * 64, v = 174 + Math.floor(random() * 28);
          const gradient = ctx.createLinearGradient(x, y, x, y + 64);
          gradient.addColorStop(0, `rgb(${v - 36},${v - 40},${v - 43})`);
          gradient.addColorStop(0.35, `rgb(${v + 22},${v + 17},${v + 9})`);
          gradient.addColorStop(1, `rgb(${v - 9},${v - 15},${v - 20})`);
          ctx.fillStyle = gradient; ctx.fillRect(x, y, 63, 64);
          ctx.fillStyle = "rgba(58,45,35,0.3)"; ctx.fillRect(x, y, 3, 64);
        }
      } else if (kind === "wood") {
        for (let i = 0; i < 90; i++) {
          ctx.strokeStyle = `rgba(80,65,44,${0.04 + random() * 0.17})`; ctx.lineWidth = 1 + random() * 3;
          const x = random() * w; ctx.beginPath(); ctx.moveTo(x, 0);
          ctx.bezierCurveTo(x + 12, 165, x - 10, 340, x + 2, h); ctx.stroke();
        }
      }
      const image = ctx.getImageData(0, 0, w, h);
      for (let i = 0; i < image.data.length; i += 4) {
        const noise = (random() - 0.5) * (kind === "plaster" ? 20 : 15);
        for (let c = 0; c < 3; c++) image.data[i + c] += noise;
      }
      ctx.putImageData(image, 0, 0);
      if (kind === "plaster") {
        for (let i = 0; i < 35; i++) {
          ctx.fillStyle = `rgba(98,85,65,${0.015 + random() * 0.025})`;
          ctx.beginPath(); ctx.ellipse(random() * w, random() * h, 8 + random() * 36, 5 + random() * 24, 0, 0, Math.PI * 2); ctx.fill();
        }
      }
    });
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(kind === "cobble" ? 30 : kind === "roof" ? 3 : 2, kind === "cobble" ? 30 : 2);
    return texture;
  }
  function instance(geo, material, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0, shadow = true) {
    // Modest spatial cells retain culling for long streets and enclosed rooms.
    const sector = Math.floor(x / 48) + ":" + Math.floor(z / 48);
    const key = geo.uuid + material.uuid + sector + shadow;
    if (!batches.has(key)) batches.set(key, { geo, material, shadow, matrices: [] });
    temp.position.set(x, y, z); temp.rotation.set(rx, ry, rz); temp.scale.set(sx, sy, sz); temp.updateMatrix();
    batches.get(key).matrices.push(temp.matrix.clone());
  }
  function box(x, y, z, w, h, d, material, yaw = 0, solid = false, name = "Italy detail", navigationBlock = true, shadow = true) {
    instance(boxGeo, material, x, y, z, w, h, d, 0, yaw, 0, shadow);
    if (solid) collider(x, y, z, w, h, d, yaw, name, navigationBlock);
  }
  function collider(x, y, z, w, h, d, yaw = 0, name = "Italy collision", navigationBlock = true) {
    const mesh = new THREE.Mesh(boxGeo, hiddenMaterial);
    mesh.name = name; mesh.position.set(x, y, z); mesh.rotation.y = yaw; mesh.scale.set(w, h, d);
    root.add(mesh); colliders.push(mesh);
    if (navigationBlock) obstacles.push({ x, z, halfW: w / 2, halfD: d / 2, cos: Math.cos(yaw), sin: Math.sin(yaw) });
    return mesh;
  }
  function cylinder(x, y, z, radius, height, material, rx = 0, ry = 0, rz = 0, shadow = true) {
    instance(cylinderGeo, material, x, y, z, radius, height, radius, rx, ry, rz, shadow);
  }
  function localPosition(x, z, yaw, lx, lz) {
    return [x + Math.cos(yaw) * lx + Math.sin(yaw) * lz, z - Math.sin(yaw) * lx + Math.cos(yaw) * lz];
  }
  function localBox(x, z, yaw, lx, y, lz, w, h, d, material, shadow = true) {
    const p = localPosition(x, z, yaw, lx, lz); box(p[0], y, p[1], w, h, d, material, yaw, false, "Facade", false, shadow);
  }
  function flushBatches() {
    for (const { geo, material, shadow, matrices } of batches.values()) {
      const mesh = new THREE.InstancedMesh(geo, material, matrices.length);
      matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
      mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere();
      mesh.name = "Italy " + (shadow ? "architecture" : "dressing");
      mesh.castShadow = shadow && geo !== planeGeo; mesh.receiveShadow = true; root.add(mesh);
    }
    batches.clear();
  }
  function createGround() {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(96, 96), mat.cobble);
    ground.name = "G55FLR_ItalyCobblestones"; ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
    root.add(ground); colliders.push(ground); floorObjects.push(ground);
  }
  function mass(x, z, w, d, h, material, name) {
    box(x, h / 2, z, w, h, d, material, 0, true, name);
  }
  function createTown() {
    // The building backs form a solid boundary, with no invisible outer fence.
    mass(-41.5, 0, 11, 94, 9.8, mat.ochre, "West village boundary");
    mass(42, 0, 12, 94, 10.6, mat.ivory, "East village boundary");
    mass(0, 46, 96, 10, 11.5, mat.pale, "South village boundary");
    mass(0, -47, 96, 10, 10, mat.pale, "North village boundary");
    mass(-32.5, 35, 7, 12, 10.4, mat.peach, "CT courtyard west house");
    mass(26, 36, 20, 10, 10.2, mat.rose, "Market south house");
    mass(-1, 21, 20, 14, 10, mat.ochre, "Bakery approach block");
    mass(-7, -4, 12, 28, 12.2, mat.peach, "Middle street apartments");
    mass(16, -5, 20, 14, 11.4, mat.ivory, "Market northern block");
    mass(-31, -3, 10, 10, 8.4, mat.rose, "West street corner house");
    mass(-27, -35.5, 18, 13, 9.2, mat.ochre, "Wine cellar rear block");
    mass(25, -36.5, 22, 11, 11.8, mat.peach, "Hostage house east neighbour");
    mass(-35.5, 18, 1, 20, 9.6, mat.pale, "Apartment party wall");
  }
  function wallWithDoor(x, z, width, height, material, yaw, offset, opening, label) {
    const a = -width / 2, b = width / 2, left = offset - opening / 2, right = offset + opening / 2;
    for (const [lo, hi] of [[a, left], [right, b]]) {
      if (hi <= lo) continue;
      const p = localPosition(x, z, yaw, (lo + hi) / 2, 0);
      box(p[0], height / 2, p[1], hi - lo, height, 0.55, material, yaw, true, label);
    }
    const p = localPosition(x, z, yaw, offset, 0), head = 3.15;
    box(p[0], (head + height) / 2, p[1], opening, height - head, 0.55, material, yaw, true, label + " lintel", false);
    for (const dx of [left - 0.12, right + 0.12]) localBox(x, z, yaw, dx, 1.58, 0.07, 0.24, 3.16, 0.72, mat.trim);
    localBox(x, z, yaw, offset, 3.22, 0.07, opening + 0.48, 0.27, 0.74, mat.trim);
  }
  function roomShell(x, z, w, d, h, material, name, doors) {
    const floor = new THREE.Mesh(new THREE.BoxGeometry(w - 0.5, 0.08, d - 0.5), mat.floor);
    floor.name = "G55FLR_" + name; floor.position.set(x, 0, z); floor.receiveShadow = true;
    root.add(floor); colliders.push(floor); floorObjects.push(floor);
    // Full-height exterior walls are cut around actual ground-floor openings.
    for (let side = 0; side < 4; side++) {
      const yaw = side * Math.PI / 2, width = side % 2 ? d : w, depth = side % 2 ? w : d;
      const p = localPosition(x, z, yaw, 0, depth / 2);
      const door = doors[side];
      if (door) wallWithDoor(p[0], p[1], width, h, material, yaw, door[0], door[1], name + " wall");
      else box(p[0], h / 2, p[1], width, h, 0.55, material, yaw, true, name + " wall");
    }
    box(x, 3.85, z, w, 0.28, d, mat.interior, 0, true, name + " ceiling", false);
    // The upper volume blocks shots without contributing a ground footprint.
    box(x, (4 + h) / 2, z, w - 0.55, h - 4, d - 0.55, material, 0, true, name + " upper storey", false);
    for (const bx of [-w / 2 + 1.1, w / 2 - 1.1])
      box(x + bx, 3.55, z, 0.16, 0.3, d - 0.6, mat.darkWood);
  }
  function createInteriors() {
    roomShell(-26, 18, 18, 20, 9.6, mat.pale, "Apartments", { 0: [3, 4.6], 1: [0, 4.4], 2: [1, 4.6] });
    wallWithDoor(-26, 14.4, 17.5, 3.72, mat.interior, 0, -1.5, 4.6, "Apartment internal doorway");
    roomShell(-27, -22, 18, 14, 8.8, mat.stone, "WineCellar", { 0: [0, 5], 1: [-1, 4.6] });
    roomShell(3, -35, 22, 14, 10.5, mat.ochre, "HostageHouse", { 0: [0, 4.8], 3: [-1, 4.6] });
  }
  function createLongHall() {
    // Market-to-house tunnel. The north exit and west side exit both stay open.
    wallWithDoor(26, -13, 28, 5.4, mat.stone, -Math.PI / 2, -8, 5.2, "Long hall west wall");
    box(31, 5.35, -13, 10.4, 0.5, 28.4, mat.stone, 0, true, "Long hall ceiling", false);
    box(31, 7.8, -13, 10, 4.4, 28, mat.pale, 0, true, "Long hall upper rooms", false);
  }
  function crate(x, z, w = 1.8, h = 1.6, d = 1.7, yaw = 0, base = 0) {
    box(x, base + h / 2, z, w, h, d, mat.wood, yaw, true, "Wooden crate", base < 2.4);
    for (const side of [-1, 1]) {
      for (const y of [base + 0.12, base + h - 0.12]) localBox(x, z, yaw, 0, y, side * (d / 2 + 0.025), w + 0.04, 0.18, 0.08, mat.darkWood);
      for (const dx of [-w / 2 + 0.1, w / 2 - 0.1]) localBox(x, z, yaw, dx, base + h / 2, side * (d / 2 + 0.045), 0.16, h, 0.08, mat.darkWood);
      for (let dx = -w / 2 + 0.4; dx < w / 2 - 0.1; dx += 0.43) localBox(x, z, yaw, dx, base + h / 2, side * (d / 2 + 0.012), 0.022, h - 0.3, 0.02, mat.darkWood, false);
    }
  }
  function barrel(x, z, y = 0, solid = true) {
    cylinder(x, y + 0.68, z, 0.57, 1.36, mat.wood);
    for (const height of [0.12, 0.35, 1.03, 1.25]) cylinder(x, y + height, z, 0.59, 0.075, mat.iron);
    cylinder(x, y + 1.37, z, 0.51, 0.035, mat.darkWood, 0, 0, 0, false);
    if (solid) collider(x, y + 0.7, z, 1.17, 1.4, 1.17, 0, "Wine barrel");
  }
  function createCover() {
    crate(12.8, 25, 2.2, 1.55, 2.1); crate(13.2, 24.8, 1.25, 1.1, 1.25, 0, 1.55);
    crate(4.2, 5.5, 1.9, 1.55, 2.5);
    crate(-21, -10.8, 2.4, 1.5, 1.8); crate(-22.1, -10.7, 1.15, 1.1, 1.5, 0, 1.5);
    crate(24.4, -29.9, 2.7, 1.6, 1.7);
    crate(-11.2, -26, 2.1, 1.7, 2);
    // Interior cover hugs walls and leaves the doorway-to-doorway routes free.
    box(-32.8, 0.62, 23, 2.7, 1.24, 1.2, mat.darkWood, 0, true, "Apartment sideboard");
    box(-19, 0.55, 12, 2.5, 1.1, 1.3, mat.wood, 0, true, "Apartment table");
    for (const z of [-26.4, -24.4, -22.4, -20.4]) barrel(-34.5, z);
    barrel(-30, -27.6);
    box(10.2, 0.7, -38.4, 4.5, 1.4, 1.4, mat.darkWood, 0, true, "Hostage house sideboard");
    box(-3.8, 0.53, -38.8, 2.8, 1.06, 1.4, mat.wood, 0, true, "Hostage house bench");
  }

  function roof(x, z, w, d, eave, rise = 2, solid = true) {
    const half = w / 2 + 0.42, length = d + 0.84, angle = Math.atan2(rise, half);
    if (solid) {
      const collision = new THREE.Mesh(roofCollisionGeo, roofCollisionMaterial);
      collision.name = "Tiled roof"; collision.position.set(x, eave - 0.1, z);
      collision.scale.set(half * 2, rise + 0.2, length);
      root.add(collision); colliders.push(collision);
    }
    box(x, eave - 0.12, z, w + 0.55, 0.28, d + 0.55, mat.trim);
    for (const side of [-1, 1]) {
      instance(boxGeo, mat.roof, x + side * half / 2, eave + rise / 2, z,
        Math.hypot(half, rise), 0.16, length, 0, 0, -side * angle);
      cylinder(x + side * half, eave + 0.025, z, 0.11, length, mat.tileEdge, Math.PI / 2);
    }
    cylinder(x, eave + rise + 0.11, z, 0.16, length, mat.tileEdge, Math.PI / 2);
    for (const side of [-1, 1]) {
      instance(gableGeo, mat.ochre, x, eave, z + side * d / 2, w, rise, 1, 0, side < 0 ? Math.PI : 0, 0);
    }
    // Short chimney stacks and caps read against the sky at street height.
    box(x + w * 0.24, eave + rise + 0.2, z - d * 0.25, 0.68, 1.7, 0.85, mat.peach, 0, solid, "Chimney", false);
    box(x + w * 0.24, eave + rise + 1.13, z - d * 0.25, 0.92, 0.2, 1.08, mat.trim, 0, solid, "Chimney cap", false);
  }
  function windowDetail(x, z, yaw, lx, y, width = 1.25, shutters = true) {
    // These are deliberately decorative upper-floor windows, never spawn sites.
    localBox(x, z, yaw, lx, y, 0.055, width + 0.22, 2.02, 0.1, mat.trim);
    localBox(x, z, yaw, lx, y, 0.125, width, 1.82, 0.08, mat.recess, false);
    localBox(x, z, yaw, lx, y, 0.176, width - 0.17, 1.64, 0.035, mat.glass, false);
    localBox(x, z, yaw, lx, y, 0.205, 0.06, 1.7, 0.04, mat.darkWood, false);
    localBox(x, z, yaw, lx, y + 0.08, 0.21, width - 0.12, 0.06, 0.04, mat.darkWood, false);
    localBox(x, z, yaw, lx, y - 1.05, 0.19, width + 0.46, 0.18, 0.45, mat.trim);
    if (shutters) for (const side of [-1, 1]) {
      const sx = lx + side * (width / 2 + 0.4);
      localBox(x, z, yaw, sx, y, 0.13, 0.57, 1.92, 0.13, mat.green);
      for (let k = -3; k <= 3; k++) localBox(x, z, yaw, sx, y + k * 0.23, 0.211, 0.47, 0.045, 0.035, mat.greenLight, false);
      for (const dy of [-0.74, 0.74]) localBox(x, z, yaw, sx, y + dy, 0.22, 0.6, 0.045, 0.045, mat.iron, false);
    }
  }
  function facade(x, z, yaw, width, height, material, options = {}) {
    const groundDetails = !options.openGround && !options.upperOnly;
    if (groundDetails) localBox(x, z, yaw, 0, 0.37, 0.04, width, 0.74, 0.17, mat.stone);
    localBox(x, z, yaw, 0, 4.2, 0.055, width + 0.08, 0.2, 0.22, mat.trim);
    localBox(x, z, yaw, 0, height - 0.28, 0.11, width + 0.28, 0.26, 0.34, mat.trim);
    const bays = Math.max(1, Math.floor((width - 1.4) / 3.6));
    for (let i = 0; i < bays; i++) {
      const lx = (i + 0.5) * (width - 0.8) / bays - (width - 0.8) / 2;
      windowDetail(x, z, yaw, lx, 6.1, 1.18 + (i % 2) * 0.12);
      if (height > 11.5) windowDetail(x, z, yaw, lx, 9.4, 1.08, i % 2 === 0);
    }
    for (const side of [-1, 1]) for (let y = options.upperOnly ? 4.34 : 0.5; y < height - 0.4; y += 0.64) {
      localBox(x, z, yaw, side * (width / 2 - 0.18), y, 0.12, y % 1.28 < 0.64 ? 0.5 : 0.74, 0.55, 0.18, mat.trim, false);
    }
    if (groundDetails) {
      for (let i = 0; i < Math.max(1, Math.floor(width / 5)); i++) {
        const lx = (i + 0.5) * width / Math.max(1, Math.floor(width / 5)) - width / 2;
        localBox(x, z, yaw, lx, 1.45, 0.11, 1.5, 2.9, 0.17, mat.trim);
        localBox(x, z, yaw, lx, 1.4, 0.22, 1.26, 2.68, 0.12, i % 2 ? mat.green : mat.darkWood);
        for (let p = -2; p <= 2; p++) localBox(x, z, yaw, lx + p * 0.21, 1.4, 0.29, 0.025, 2.6, 0.025, mat.wood, false);
        localBox(x, z, yaw, lx + 0.4, 1.25, 0.34, 0.07, 0.13, 0.05, mat.iron, false);
      }
    }
    // Thin drainpipe held against the wall, never a navigation obstruction.
    const p = localPosition(x, z, yaw, width / 2 - 0.46, 0.25);
    const bottom = options.upperOnly ? 4 : 0;
    cylinder(p[0], (height + bottom) / 2, p[1], 0.065, height - bottom, mat.iron, 0, 0, 0, false);
  }
  function dressedBuilding(x, z, w, d, h, material, sides = [0, 1, 2, 3], openGround = false) {
    roof(x, z, w, d, h, Math.min(2.2, w * 0.16));
    for (const side of sides) {
      const yaw = side * Math.PI / 2, width = side % 2 ? d : w, depth = side % 2 ? w : d;
      const p = localPosition(x, z, yaw, 0, depth / 2 + (openGround ? 0.29 : 0.025));
      facade(p[0], p[1], yaw, width, h, material, { openGround });
    }
  }
  function arch(x, z, width, spring, rise, yaw = 0) {
    // Real open arch: the curved spandrel itself is also the shot collider.
    // The cap meets the long-hall ceiling underside; no floating strip above it.
    const half = width / 2, top = 5.1, shape = new THREE.Shape();
    shape.moveTo(-half, top); shape.lineTo(half, top); shape.lineTo(half, spring);
    for (let i = 1; i <= 20; i++) {
      const t = i / 20 * Math.PI; shape.lineTo(Math.cos(t) * half, spring + Math.sin(t) * rise);
    }
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.58, bevelEnabled: false });
    const mesh = new THREE.Mesh(geometry, mat.stone); mesh.position.set(x, 0, z); mesh.rotation.y = yaw;
    mesh.name = "Open stone arch"; mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh); colliders.push(mesh);
    for (let i = 0; i <= 14; i++) {
      const t = i / 14 * Math.PI, lx = Math.cos(t) * (half + 0.02);
      const p = localPosition(x, z, yaw, lx, 0.67), y = spring + Math.sin(t) * rise;
      const angle = Math.atan2(rise * Math.cos(t), -half * Math.sin(t));
      instance(boxGeo, mat.trim, p[0], y + 0.06, p[1], 0.45, 0.26, 0.18, 0, yaw, angle);
    }
  }
  function sign(title, subtitle, x, y, z, w, h, yaw = 0, background = "#e3d6b6", color = "#515d43") {
    const texture = canvasTexture(768, 192, (ctx, tw, th) => {
      ctx.fillStyle = background; ctx.fillRect(0, 0, tw, th);
      ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.strokeRect(9, 9, tw - 18, th - 18);
      ctx.textAlign = "center"; ctx.fillStyle = color;
      ctx.font = "bold " + (title.length > 18 ? 46 : 62) + "px Georgia";
      ctx.fillText(title, tw / 2, subtitle ? 91 : 117, tw - 50);
      if (subtitle) { ctx.font = "23px Georgia"; ctx.fillText(subtitle, tw / 2, 149, tw - 50); }
    });
    const mesh = new THREE.Mesh(planeGeo, new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95 }));
    mesh.name = title; mesh.position.set(x, y, z); mesh.rotation.y = yaw; mesh.scale.set(w, h, 1);
    mesh.receiveShadow = true; root.add(mesh);
  }
  function balcony(x, z, yaw, width = 5.4, y = 4.8) {
    const slab = localPosition(x, z, yaw, 0, 0.6);
    box(slab[0], y, slab[1], width, 0.25, 1.7, mat.trim, yaw, true, "Balcony slab", false);
    for (const dx of [-width / 2 + 0.55, width / 2 - 0.55]) localBox(x, z, yaw, dx, y - 0.4, 0.25, 0.22, 0.6, 0.85, mat.stone);
    localBox(x, z, yaw, 0, y + 1, 1.41, width, 0.08, 0.08, mat.iron);
    localBox(x, z, yaw, 0, y + 0.24, 1.41, width, 0.06, 0.06, mat.iron);
    for (let dx = -width / 2 + 0.1; dx < width / 2; dx += 0.36) localBox(x, z, yaw, dx, y + 0.61, 1.41, 0.045, 0.78, 0.045, mat.iron, false);
    for (const side of [-1, 1]) {
      localBox(x, z, yaw, side * width / 2, y + 1, 0.76, 0.06, 0.06, 1.3, mat.iron);
      for (const lz of [0.3, 0.7, 1.1]) localBox(x, z, yaw, side * width / 2, y + 0.61, lz, 0.045, 0.78, 0.045, mat.iron, false);
    }
  }
  function createArchitecture() {
    dressedBuilding(-1, 21, 20, 14, 10, mat.ochre);
    dressedBuilding(-7, -4, 12, 28, 12.2, mat.peach);
    dressedBuilding(16, -5, 20, 14, 11.4, mat.ivory);
    dressedBuilding(-31, -3, 10, 10, 8.4, mat.rose, [0, 1, 2]);
    dressedBuilding(-32.5, 35, 7, 12, 10.4, mat.peach, [1, 2]);
    dressedBuilding(26, 36, 20, 10, 10.2, mat.rose, [2, 3]);
    dressedBuilding(-27, -35.5, 18, 13, 9.2, mat.ochre, [1]);
    dressedBuilding(25, -36.5, 22, 11, 11.8, mat.peach, [0]);
    dressedBuilding(-26, 18, 18, 20, 9.6, mat.pale, [0, 1, 2], true);
    dressedBuilding(-27, -22, 18, 14, 8.8, mat.stone, [0, 1], true);
    dressedBuilding(3, -35, 22, 14, 10.5, mat.ochre, [0, 3], true);
    roof(31, -13, 10, 28, 10, 1.7);
    facade(25.7, -13, -Math.PI / 2, 28, 10, mat.pale, { openGround: true });
    for (const z of [0.7, -12, -26.9]) arch(31, z, 9.4, 3.2, 1.2);
    // A small upper connection gives middle street its familiar enclosed profile.
    box(2.5, 7.8, -8, 7, 2.4, 4.1, mat.ochre, 0, true, "Middle overhead bridge", false);
    box(2.5, 6.52, -8, 7.4, 0.23, 4.3, mat.trim, 0, true, "Middle bridge underside", false);
    roof(2.5, -8, 7.5, 4.5, 9.05, 1);
    windowDetail(2.5, -5.9, 0, 0, 7.8, 1.1, false);
    balcony(3, -27.65, 0, 6.3, 4.75);
    balcony(-16.65, 22, Math.PI / 2, 4.6, 4.75);
    // Edge houses use varied facade bands, with a continuous solid back wall.
    for (const [z, length, height, material] of [[32, 15, 10.7, mat.peach], [11, 27, 10.3, mat.ochre], [-14, 22, 11.4, mat.ivory], [-34, 18, 10.8, mat.rose]]) {
      box(36.12, height / 2, z, 0.26, height, length, material);
      facade(35.94, z, -Math.PI / 2, length - 0.35, height, material);
      roof(41, z, 10, length, height, 1.7);
    }
    for (const [z, length, height, material] of [[32, 16, 10.4, mat.ochre], [13, 20, 10, mat.pale], [-7, 19, 10.8, mat.peach], [-32, 28, 10, mat.ivory]]) {
      box(-36.12, height / 2, z, 0.26, height, length, material);
      // These boundary walls touch the cellar: ground-floor facade details
      // would otherwise protrude through its interior stone wall.
      facade(-35.94, z, Math.PI / 2, length - 0.35, height, material, { upperOnly: z < 0 });
      roof(-41, z, 10, length, height, 1.9);
    }
    for (const [x, width, h, material] of [[-24, 23, 12, mat.peach], [-4, 17, 11.5, mat.ivory], [13, 17, 12.8, mat.ochre], [30, 17, 11.5, mat.pale]]) {
      box(x, h / 2, 41.12, width, h, 0.26, material);
      facade(x, 40.94, Math.PI, width - 0.3, h, material);
      roof(x, 46, width, 10, h, 1.9);
    }
    sign("PANIFICIO", "PANE FRESCO OGNI GIORNO", -1, 3.3, 28.36, 6.3, 1.1);
    sign("ALIMENTARI", "FRUTTA  ·  VERDURA", 17, 3.25, 2.35, 6.1, 1.05);
    sign("VINO", "CANTINA", -27, 3.75, -14.61, 3.1, 0.8, 0, "#644b38", "#e9d5a8");
    sign("PIAZZA DEL MERCATO", "", 10.15, 2.7, 21, 3.4, 0.5, Math.PI / 2);
    sign("VIA ROMA", "", -13.28, 2.5, -14, 2.4, 0.42, -Math.PI / 2);
    sign("23", "", 6.2, 2.15, -27.64, 0.42, 0.5);
  }
  function stall(x, z, width, depth, green = true) {
    const canopyY = 3.24, slope = 0.12, canopyHalfDepth = (depth + 0.8) / 2;
    const frontZ = z + Math.cos(slope) * canopyHalfDepth;
    const frontY = canopyY - Math.sin(slope) * canopyHalfDepth;
    box(x, 0.75, z, width, 1.5, depth, mat.wood, 0, true, "Market stall counter");
    box(x, 1.5, z, width + 0.16, 0.13, depth + 0.16, mat.darkWood, 0, true, "Market counter top");
    for (let dx = -width / 2 + 0.3; dx < width / 2; dx += 0.44) box(x + dx, 0.76, z + depth / 2 + 0.016, 0.025, 1.3, 0.035, mat.darkWood, 0, false, "Stall boards", false, false);
    for (const dx of [-width / 2 + 0.14, width / 2 - 0.14]) for (const dz of [-depth / 2 + 0.1, depth / 2 - 0.1]) {
      const top = canopyY - Math.tan(slope) * dz - 0.02;
      box(x + dx, (top + 1.5) / 2, z + dz, 0.09, top - 1.5, 0.09, mat.darkWood, 0, true, "Stall support post", false);
    }
    const strips = Math.round(width / 0.42), sw = (width + 0.65) / strips;
    for (let i = 0; i < strips; i++) {
      const material = i % 2 === 0 ? mat.canvas : green ? mat.stripe : mat.rose;
      const sx = x - (width + 0.65) / 2 + (i + 0.5) * sw;
      instance(boxGeo, material, sx, canopyY, z, sw, 0.045, depth + 0.8, slope, 0, 0);
      box(sx, frontY - 0.13, frontZ, sw, 0.26, 0.035, material);
    }
    const backY = canopyY + Math.sin(slope) * canopyHalfDepth;
    box(x, backY - 0.04, z - Math.cos(slope) * canopyHalfDepth, width + 0.7, 0.08, 0.07, mat.darkWood);
    for (let bin = 0; bin < 3; bin++) {
      const bx = x + (bin - 1) * width / 3, bw = width / 3 - 0.2;
      box(bx, 1.6, z, bw, 0.12, depth - 0.2, mat.darkWood, 0, true, "Produce bin base", false);
      for (const dz of [-depth / 2 + 0.1, depth / 2 - 0.1]) box(bx, 1.75, z + dz, bw, 0.24, 0.08, mat.wood, 0, true, "Produce bin board", false);
      for (const dx of [-bw / 2, bw / 2]) box(bx + dx, 1.74, z, 0.07, 0.22, depth - 0.15, mat.wood, 0, true, "Produce bin board", false);
      for (let i = 0; i < 15; i++) {
        const px = bx + (i % 5 - 2) * bw / 5.7, pz = z + (Math.floor(i / 5) - 1) * depth / 4;
        instance(sphereGeo, [mat.red, mat.apple, mat.yellow][bin], px, 1.82 + random() * 0.05, pz, 0.13, 0.12, 0.13, 0, 0, 0, false);
      }
    }
  }
  function createMarket() {
    stall(23.8, 14, 6, 2.15);
    stall(32.8, 6.4, 4.1, 2.0, false);
    crate(31.8, 17.1, 1.65, 1.15, 1.4); crate(32, 18.8, 1.4, 0.85, 1.25);
    barrel(34.2, 21.8); barrel(34.2, 23.25);
    chicken(20, 18.4, -0.6); chicken(28.2, 10.4, 1.1);
  }
  function chicken(x, z, yaw) {
    const part = (lx, y, lz, sx, sy, sz, material) => {
      const p = localPosition(x, z, yaw, lx, lz); instance(sphereGeo, material, p[0], y, p[1], sx, sy, sz, 0, yaw, 0, false);
    };
    part(0, 0.39, 0, 0.24, 0.25, 0.34, mat.white);
    part(0, 0.63, 0.23, 0.115, 0.17, 0.12, mat.white);
    part(0, 0.79, 0.21, 0.045, 0.075, 0.09, mat.red);
    part(0, 0.66, 0.36, 0.05, 0.035, 0.095, mat.yellow);
    part(0, 0.51, -0.29, 0.13, 0.24, 0.11, mat.chickenDark);
    for (const side of [-1, 1]) {
      part(side * 0.2, 0.4, -0.02, 0.08, 0.15, 0.23, mat.canvas);
      part(side * 0.105, 0.69, 0.275, 0.018, 0.018, 0.018, mat.iron);
      localBox(x, z, yaw, side * 0.1, 0.14, 0, 0.025, 0.25, 0.025, mat.yellow, false);
      localBox(x, z, yaw, side * 0.1, 0.035, 0.065, 0.13, 0.025, 0.14, mat.yellow, false);
    }
  }
  function lantern(x, y, z, yaw = 0) {
    localBox(x, z, yaw, 0, y + 0.4, 0.28, 0.07, 0.12, 0.65, mat.iron);
    localBox(x, z, yaw, 0, y, 0.58, 0.3, 0.48, 0.27, mat.lamp);
    for (const dy of [-0.27, 0.27]) localBox(x, z, yaw, 0, y + dy, 0.58, 0.43, 0.09, 0.4, mat.iron);
    for (const dx of [-0.17, 0.17]) for (const lz of [0.43, 0.73]) localBox(x, z, yaw, dx, y, lz, 0.035, 0.55, 0.035, mat.iron, false);
  }
  function flowerBox(x, y, z, yaw = 0) {
    localBox(x, z, yaw, 0, y, 0.05, 1.6, 0.32, 0.43, mat.pot);
    for (let i = 0; i < 8; i++) {
      const p = localPosition(x, z, yaw, (i - 3.5) * 0.18, 0.08);
      instance(sphereGeo, mat.leaf, p[0], y + 0.24, p[1], 0.22, 0.19, 0.24, 0, 0, 0, false);
      instance(sphereGeo, i % 2 ? mat.red : mat.white, p[0], y + 0.41, p[1] + 0.04, 0.085, 0.08, 0.09, 0, 0, 0, false);
    }
  }
  function tree(x, z, scale = 1, solid = true) {
    cylinder(x, 1.5 * scale, z, 0.18 * scale, 3 * scale, mat.trunk);
    if (solid) collider(x, 1.5 * scale, z, 0.42 * scale, 3 * scale, 0.42 * scale, 0, "Olive tree trunk");
    for (let i = 0; i < 7; i++) {
      const angle = i * 2.4, radius = i ? 0.65 * scale : 0;
      const px = x + Math.cos(angle) * radius, pz = z + Math.sin(angle) * radius;
      instance(sphereGeo, i % 2 ? mat.leafLight : mat.leaf, px, (3.15 + i % 3 * 0.26) * scale, pz, 1.05 * scale, 0.7 * scale, 0.9 * scale, 0, angle, 0, false);
    }
  }
  function wire(points, material = mat.iron) {
    const geo = new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(...p)));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: material.color }));
    line.name = "Overhead utility line"; root.add(line);
  }
  function createStreetDetails() {
    for (const [x, y, z, yaw] of [[-10.9, 3.5, 29, 0], [8, 3.5, 28.2, 0], [-16.65, 3.5, 24, Math.PI / 2], [-13.3, 3.2, -8, -Math.PI / 2], [6.3, 3.6, -10, -Math.PI / 2], [18, 3.6, 2.2, 0], [-8, 3.5, -27.6, 0], [14, 3.5, -27.6, 0], [-17.6, 3.4, -18, Math.PI / 2], [26.4, 3.1, -14, Math.PI / 2]]) lantern(x, y, z, yaw);
    flowerBox(-5.8, 5.1, 28.42); flowerBox(4, 5.1, 28.42);
    flowerBox(-16.55, 5.1, 12.2, Math.PI / 2); flowerBox(7.8, 5.1, -27.5);
    flowerBox(20, 5.1, 2.45); flowerBox(35.6, 5.1, 17, -Math.PI / 2);
    // Wall fountain: a low solid basin, kept out of the main CT approach.
    box(-24.9, 0.48, 39.1, 3.2, 0.96, 1.8, mat.stone, 0, true, "Courtyard fountain basin");
    box(-24.9, 0.99, 39.1, 3.45, 0.18, 2.05, mat.trim);
    box(-24.9, 1.09, 39.1, 2.92, 0.035, 1.55, mat.water, 0, false, "Fountain water", false, false);
    box(-24.9, 1.6, 40.4, 2.2, 3.2, 0.45, mat.stone, 0, true, "Fountain back");
    cylinder(-24.9, 2.1, 40.05, 0.12, 0.45, mat.iron, Math.PI / 2);
    sign("ACQUA", "", -24.9, 2.8, 40.12, 1.2, 0.36, Math.PI);
    for (const [x, z] of [[-28.2, 39.8], [34.5, 28.5], [-35, 4.8], [17, -28.8]]) {
      box(x, 0.36, z, 1.55, 0.72, 1.55, mat.stone, 0, true, "Tree planter");
      tree(x, z, 1, true);
    }
    for (const [x, z] of [[-15.5, 29.1], [10.4, 14.9], [-14.7, -19.5], [29, 1.7]]) {
      cylinder(x, 0.03, z, 0.42, 0.04, mat.iron, 0, 0, 0, false);
      for (let k = -2; k <= 2; k++) box(x, 0.057, z + k * 0.11, 0.58, 0.008, 0.028, mat.darkStone, 0, false, "Drain", false, false);
    }
    const lines = [ [[-16.6, 8, 2], [-13.5, 7.35, 2], [-12.6, 8, 2]], [[9.2, 9.1, 22], [21.5, 7.8, 22], [35.7, 9, 22]], [[-12.8, 11, -14], [7, 9.9, -14], [25.7, 10.8, -14]] ];
    let laundryLine;
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const pts = lines[lineIndex];
      const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)));
      wire(curve.getPoints(20).map(p => p.toArray()));
      if (lineIndex === 1) laundryLine = curve;
    }
    // Laundry is high overhead, leaving all ground routes and sightlines clear.
    for (let i = 0; i < 5; i++) {
      const t = (i + 1) / 6, point = laundryLine.getPoint(t);
      box(point.x, point.y - 0.55, point.z, i % 2 ? 0.7 : 1.1, 1.1, 0.035, i % 2 ? mat.pale : mat.canvas, 0, false, "Hanging linen", false, false);
      for (const dt of [-0.01, 0.01]) {
        const peg = laundryLine.getPoint(t + dt);
        box(peg.x, peg.y - 0.01, peg.z, 0.045, 0.11, 0.05, mat.wood, 0, false, "Peg", false, false);
      }
    }
    // Quiet interior dressing: trims, old radio, shelves and a rug.
    for (const [x, z, w, d] of [[-26, 18, 17.3, 19.3], [-27, -22, 17.3, 13.3], [3, -35, 21.3, 13.3]]) {
      for (const dx of [-w / 2, w / 2]) box(x + dx, 3.4, z, 0.12, 0.13, d, mat.darkWood);
      for (const dz of [-d / 2, d / 2]) box(x, 3.4, z + dz, w, 0.13, 0.12, mat.darkWood);
    }
    box(10.1, 1.67, -38.4, 0.95, 0.48, 0.42, mat.wood);
    box(10.1, 1.69, -38.16, 0.75, 0.25, 0.03, mat.iron, 0, false, "Old radio", false, false);
    for (const x of [9.8, 10.4]) cylinder(x, 1.6, -38.11, 0.045, 0.03, mat.trim, Math.PI / 2, 0, 0, false);
    box(-31.9, 1.38, 23, 0.5, 0.25, 0.4, mat.canvas, 0, false, "Folded cloth", false, false);
    sign("VINI DELLA CASA", "", -27, 2.1, -28.68, 3.2, 0.7);
  }
  function createBackdrop() {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(410, 410), mat.hill);
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.16; ground.name = "Distant countryside"; root.add(ground);
    const hills = [[-95, -91, 38, 19, 30], [-40, -112, 47, 26, 36], [28, -109, 48, 21, 30], [97, -82, 44, 28, 35], [115, 17, 37, 22, 42], [-104, 21, 33, 24, 43], [57, 103, 46, 23, 30], [-43, 110, 42, 19, 33]];
    for (const [x, z, sx, sy, sz] of hills) instance(sphereGeo, mat.hill, x, -3, z, sx, sy, sz, 0, 0, 0, false);
    for (const [x, z, w, d, h, material] of [[-51, -49, 14, 13, 16, mat.ochre], [-23, -59, 12, 15, 17, mat.peach], [1, -61, 17, 15, 14, mat.pale], [30, -56, 13, 14, 15, mat.ochre], [53, -39, 13, 17, 14, mat.ivory], [-56, 27, 12, 14, 16, mat.ivory], [57, 29, 12, 13, 14, mat.peach], [4, 58, 15, 14, 14, mat.ochre]]) {
      box(x, h / 2, z, w, h, d, material, 0, false, "Distant village", false, false);
      roof(x, z, w, d, h, 1.9, false);
    }
    // A restrained village campanile locates the north skyline.
    box(-18, 11.5, -57, 4.6, 23, 4.6, mat.pale, 0, false, "Campanile", false, false);
    box(-18, 23.25, -57, 5.1, 0.55, 5.1, mat.trim, 0, false, "Tower cornice", false, false);
    for (const dx of [-1.9, 1.9]) for (const dz of [-1.9, 1.9]) box(-18 + dx, 25, -57 + dz, 0.52, 3.3, 0.52, mat.trim, 0, false, "Bell tower pier", false, false);
    cylinder(-18, 24.2, -57, 0.72, 0.95, mat.iron, 0, 0, 0, false);
    roof(-18, -57, 5.4, 5.4, 26.7, 2.4, false);
    for (const [x, z, s] of [[-51, -12, 1.9], [49, -19, 2.1], [48, 43, 1.8], [-48, 45, 1.9], [-36, -54, 1.7]]) tree(x, z, s, false);
  }
  function createSky() {
    const settings = WORLD_SETTINGS.sky;
    scene.background = new THREE.Color(settings.fogColor);
    scene.fog = new THREE.Fog(settings.fogColor, settings.fogNear, settings.fogFar);
    const geometry = new THREE.SphereGeometry(450, 24, 16), colors = [];
    const top = new THREE.Color(settings.top), mid = new THREE.Color(settings.mid), horizon = new THREE.Color(settings.horizon);
    const position = geometry.attributes.position, color = new THREE.Color();
    for (let i = 0; i < position.count; i++) {
      const t = Math.max(0, position.getY(i) / 450);
      color.copy(t < 0.22 ? horizon : mid).lerp(t < 0.22 ? mid : top, t < 0.22 ? t / 0.22 : (t - 0.22) / 0.78);
      colors.push(color.r, color.g, color.b);
    }
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const dome = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false }));
    dome.name = "Italy daylight sky"; dome.renderOrder = -1000; scene.add(dome);
    const sun = new THREE.Mesh(new THREE.SphereGeometry(2.1, 16, 10), new THREE.MeshBasicMaterial({ color: 0xfff2d4, fog: false }));
    sun.position.set(...WORLD_SETTINGS.lighting.sunPosition).normalize().multiplyScalar(200);
    sun.name = "Sun aligned with world lighting"; scene.add(sun);
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
