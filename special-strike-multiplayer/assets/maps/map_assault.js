// Classic cs_assault: a procedural, ground-level adaptation for multiplayer.
// Upper catwalks, the highway deck and roof ducts are scenery, not spawn surfaces:
// the supplied navigation has a single X/Z layer and no ladder/crouch traversal.
export const WORLD_SETTINGS = {
  seed: 19990627, size: 96, spawn: [0, 1.75, 38], spawnYaw: 0,
  sky: { top: 0x315574, mid: 0x8eaab4, horizon: 0xd8c8ab, fogColor: 0xb5bbba, fogNear: 68, fogFar: 158 },
  lighting: {
    hemisphereSky: 0xd6e6ed, hemisphereGround: 0x737774, hemisphereIntensity: 1.35,
    sunColor: 0xffe2b4, sunIntensity: 2.15, sunPosition: [-36, 60, 28]
  }
};

// All positions use the original world scale (player spawn eye height: 1.75).
// North is -Z. Bounds, flat Y=0 ground and 1-unit navigation grid are unchanged.
const ASSAULT = {
  warehouse: { left: -20, right: 20, back: -32, front: 6, height: 10.4, wall: 0.5 },
  gates: { front: [-5.4, 5.4], east: [-23, -18], west: [-7, -2] },
  cargo: [
    { x: -12, z: 12.5, w: 8.2, d: 3.7, tiers: 2, colors: ['cargoRed', 'cargoBlue'] },
    { x: 5.7, z: -25.6, w: 9.2, d: 3.7, tiers: 2, colors: ['cargoRed', 'cargoBlue'] },
    { x: -12.4, z: -9.6, w: 7.4, d: 3.6, tiers: 1, colors: ['cargoGreen'] },
    { x: 29, z: -32.8, w: 3.7, d: 8.2, tiers: 1, colors: ['cargoRed'] }
  ],
  crates: [
    [-12.5, 22, 3.2, 2.3, 2.8], [12.6, 14.2, 3.4, 2.5, 3.4],
    [15.5, 17.2, 2.2, 1.3, 2.2], [11.8, -5.7, 4.2, 2.4, 3.4],
    [14.3, -10.6, 2.6, 1.35, 2.5], [0.4, -13.8, 3.1, 1.2, 2.8],
    [-27, -23.5, 3, 2.1, 3], [24.8, -8, 2.6, 1.3, 2.6],
    [8.8, -38.8, 3.4, 2.2, 2.8], [18, 38.8, 3.2, 1.3, 2.4]
  ]
};

export function createWorld({ THREE, scene }) {
  const root = new THREE.Group();
  root.name = 'AssaultWarehouse'; scene.add(root);
  const colliders = [], floorObjects = [];
  const obstacles = [], batches = new Map(), random = mulberry32(WORLD_SETTINGS.seed);
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const cylinderGeo = new THREE.CylinderGeometry(1, 1, 1, 10);
  const planeGeo = new THREE.PlaneGeometry(1, 1), temp = new THREE.Object3D();
  const hiddenMaterial = new THREE.MeshBasicMaterial({ visible: false });

  const textures = {
    concrete: surfaceTexture('concrete'), asphalt: surfaceTexture('asphalt'),
    brick: surfaceTexture('brick'), panels: surfaceTexture('panels'), wood: surfaceTexture('wood')
  };
  const mat = {
    asphalt: standard(0x737b7e, { map: textures.asphalt }),
    concrete: standard(0xb7b8ad, { map: textures.concrete }),
    interior: standard(0xc0c3b4, { map: textures.concrete }),
    plaster: standard(0xbdc7be, { map: textures.concrete }),
    brick: standard(0x9c7360, { map: textures.brick }),
    brickDark: standard(0x77675d, { map: textures.brick }),
    brickLight: standard(0xb49b7b, { map: textures.brick }),
    cladding: standard(0x89988e, { map: textures.panels, metalness: 0.22 }),
    roof: standard(0x56635f, { map: textures.panels, metalness: 0.22 }),
    trim: standard(0xc0c5b9), steel: standard(0x3f5653, { metalness: 0.45 }),
    dark: standard(0x293739), rubber: standard(0x252b2d),
    glass: standard(0x43616a, { roughness: 0.32, metalness: 0.34 }),
    windowLight: standard(0x9eaeaa, { emissive: 0x627a7d, emissiveIntensity: 0.2 }),
    duct: standard(0x9ca7a6, { map: textures.panels, metalness: 0.48, roughness: 0.65 }),
    cargoRed: standard(0x9c493a, { map: textures.panels, metalness: 0.25 }),
    cargoBlue: standard(0x406581, { map: textures.panels, metalness: 0.25 }),
    cargoGreen: standard(0x657b62, { map: textures.panels, metalness: 0.2 }),
    wood: standard(0xb79862, { map: textures.wood }), woodEdge: standard(0x7d623d),
    yellow: standard(0xd6b761), white: standard(0xc6cdc8),
    // Paint is an intentional decal. Bias it slightly without changing the
    // camera's very wide depth range or disabling depth tests on architecture.
    paintYellow: standard(0xd6b761, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
    paintWhite: standard(0xc6cdc8, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
    red: standard(0xa85c42), van: standard(0x566d7d, { metalness: 0.22 }),
    lamp: standard(0xeaf1d6, { emissive: 0xd6ecc5, emissiveIntensity: 1.05 }),
    amber: standard(0xe8b669, { emissive: 0xffae48, emissiveIntensity: 0.8 })
  };
  const world = {
    map: root, colliders, floorObjects,
    isLoaded: false, spawn: new THREE.Vector3(...WORLD_SETTINGS.spawn),
    lighting: WORLD_SETTINGS.lighting, ready: null, navigation: null,
    resetPlayer
  };

  createSky(); createGround(); createWarehouse(); createSecurityRoom();
  createCargo(); createOverpass(); createSurroundings(); createYardDetails();
  flushBatches(); root.updateMatrixWorld(true);
  world.navigation = createNavigation();
  world.isLoaded = true; world.ready = Promise.resolve(world);
  return world;

  function standard(color, extra = {}) {
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.87, metalness: 0.035, ...extra });
    if (!extra.map) return material;
    // World-space tiling keeps bricks, wood and sheet-metal ribs at a consistent
    // scale on differently sized instances, without an external shader/texture.
    material.onBeforeCompile = shader => {
      shader.uniforms.assaultTileSize = { value: extra.map.userData.tileSize };
      const varyings = 'varying vec3 vAssaultPosition;\nvarying vec3 vAssaultNormal;\n';
      shader.vertexShader = varyings + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
        #include <begin_vertex>
        vec4 assaultPosition = vec4(transformed, 1.0);
        vec3 assaultNormal = normal;
        #ifdef USE_INSTANCING
          assaultPosition = instanceMatrix * assaultPosition;
          assaultNormal = mat3(instanceMatrix) * assaultNormal;
        #endif
        vAssaultPosition = (modelMatrix * assaultPosition).xyz;
        vAssaultNormal = normalize(mat3(modelMatrix) * assaultNormal);
      `);
      shader.fragmentShader = varyings + 'uniform float assaultTileSize;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec3 assaultN = abs(normalize(vAssaultNormal));
          vec2 assaultUV = assaultN.y > 0.65 ? vAssaultPosition.xz :
            (assaultN.x > assaultN.z ? vAssaultPosition.zy : vAssaultPosition.xy);
          diffuseColor *= texture2D(map, assaultUV / assaultTileSize);
        #endif
      `);
    };
    material.customProgramCacheKey = () => 'AssaultWorldTexture_v1';
    return material;
  }

  function canvasTexture(width, height, draw) {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    draw(canvas.getContext('2d'), width, height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
    return texture;
  }
  function surfaceTexture(kind) {
    const texture = canvasTexture(256, 256, (ctx, w, h) => {
      const pixels = ctx.createImageData(w, h), base = kind === 'asphalt' ? 178 : 222;
      for (let i = 0; i < pixels.data.length; i += 4) {
        const v = base + (random() - 0.5) * (kind === 'asphalt' ? 42 : 24);
        pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = v; pixels.data[i + 3] = 255;
      }
      ctx.putImageData(pixels, 0, 0);
      if (kind === 'brick') {
        for (let row = 0; row < 8; row++) {
          const y = row * 32;
          ctx.fillStyle = '#a7a79f'; ctx.fillRect(0, y, w, 2);
          for (let x = -(row % 2) * 32; x < w; x += 64) {
            ctx.fillRect(x, y, 2, 32);
            ctx.fillStyle = 'rgba(40,30,20,' + (0.03 + random() * 0.08) + ')';
            ctx.fillRect(x + 3, y + 3, 58, 26); ctx.fillStyle = '#a7a79f';
          }
        }
      } else if (kind === 'panels') {
        for (let x = 0; x < w; x += 32) {
          ctx.fillStyle = '#b5b9b4'; ctx.fillRect(x, 0, 5, h);
          ctx.fillStyle = '#f0f0e9'; ctx.fillRect(x + 5, 0, 3, h);
        }
        ctx.fillStyle = 'rgba(50,55,50,0.17)'; ctx.fillRect(0, 0, w, 2);
      } else if (kind === 'wood') {
        for (let y = 0; y < h; y += 32) {
          ctx.fillStyle = '#919186'; ctx.fillRect(0, y, w, 2);
          for (let i = 0; i < 7; i++) {
            ctx.fillStyle = 'rgba(74,63,41,0.09)';
            ctx.fillRect(random() * w, y + 5 + random() * 22, 30 + random() * 100, 1);
          }
        }
      } else if (kind === 'concrete') {
        for (let i = 0; i < 50; i++) {
          ctx.fillStyle = 'rgba(85,87,78,0.025)';
          ctx.fillRect(random() * w, random() * h, 10 + random() * 48, 12 + random() * 60);
        }
      }
    });
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.userData.tileSize = kind === 'brick' ? 3.2 : kind === 'panels' ? 3.2 : kind === 'wood' ? 2 : 5;
    return texture;
  }

  function instance(geo, material, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0, cast = true) {
    // Nearby repeated parts share a draw call without forcing the entire district
    // into one uncullable batch. Long structures have accurate union bounds.
    const key = `${geo.uuid}:${material.uuid}:${Math.floor((x + 48) / 48)}:${Math.floor((z + 48) / 48)}:${cast}`;
    if (!batches.has(key)) batches.set(key, { geo, material, matrices: [], cast });
    temp.position.set(x, y, z); temp.rotation.set(rx, ry, rz); temp.scale.set(sx, sy, sz); temp.updateMatrix();
    batches.get(key).matrices.push(temp.matrix.clone());
  }
  function box(x, y, z, w, h, d, material, solid = false, name = 'Assault structure', nav = true, cast = true) {
    instance(boxGeo, material, x, y, z, w, h, d, 0, 0, 0, cast);
    if (solid) collider(x, y, z, w, h, d, 0, name, nav);
  }
  function collider(x, y, z, w, h, d, yaw = 0, name = 'Assault collision', navigationBlock = true) {
    const mesh = new THREE.Mesh(boxGeo, hiddenMaterial);
    mesh.name = name; mesh.position.set(x, y, z); mesh.rotation.y = yaw; mesh.scale.set(w, h, d);
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
  function beam(a, b, width, material, depth = width, cast = true) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), delta = end.clone().sub(start);
    temp.position.copy(start).add(end).multiplyScalar(0.5);
    temp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize());
    temp.scale.set(width, delta.length(), depth); temp.updateMatrix();
    const key = `${boxGeo.uuid}:${material.uuid}:beams:${Math.floor((temp.position.z + 48) / 48)}:${cast}`;
    if (!batches.has(key)) batches.set(key, { geo: boxGeo, material, matrices: [], cast });
    batches.get(key).matrices.push(temp.matrix.clone());
  }
  function flushBatches() {
    for (const { geo, material, matrices, cast } of batches.values()) {
      const mesh = new THREE.InstancedMesh(geo, material, matrices.length);
      matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
      mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere();
      mesh.name = 'Assault static batch'; mesh.castShadow = cast && !material.isMeshBasicMaterial;
      mesh.receiveShadow = !material.isMeshBasicMaterial; root.add(mesh);
    }
    batches.clear();
  }

  function createGround() {
    // Keep the original single collision/spawn plane, but render adjoining
    // surface patches instead of stacking floors 0.005-0.012 units apart.
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(96, 96), hiddenMaterial);
    ground.name = 'G55FLR_AssaultGround'; ground.rotation.x = -Math.PI / 2;
    root.add(ground); colliders.push(ground); floorObjects.push(ground);
    groundSurfaces([
      { x: 0, z: -13, w: 39.5, d: 37.5, material: mat.interior },
      { x: -12.55, z: -24.9, w: 13.4, d: 13.2, material: mat.plaster },
      { x: -27, z: 0, w: 10, d: 89, material: mat.concrete },
      { x: 27, z: 0, w: 10, d: 89, material: mat.concrete },
      { x: 0, z: -38, w: 39.5, d: 8, material: mat.concrete },
      { x: 0, z: -6.8, w: 9.8, d: 26, material: mat.asphalt }
    ]);
    for (let z = -17; z < 22; z += 6) groundPlane(0.14, 2.8, 0, z, mat.paintYellow, 0.03);
    for (const x of [-5.1, 5.1]) groundPlane(0.11, 24.8, x, -6.5, mat.paintYellow, 0.032);
    for (const x of [-21, 21]) groundPlane(0.12, 35, x, -12.5, mat.paintYellow, 0.022);
    for (const z of [9, 18.9]) groundPlane(11, 0.12, -12, z, mat.paintYellow, 0.025);
    for (const x of [-17.5, -6.5]) groundPlane(0.12, 10, x, 14, mat.paintYellow, 0.025);
    for (let x = -7; x <= 7; x += 1.6) groundPlane(0.8, 2.2, x, 33, mat.paintWhite, 0.022);
    for (const p of [[-25, 6], [26, -27], [8, 32], [-8, -35]]) drain(p[0], p[1]);
    // The backdrop is a ring, so it cannot flicker through the playable floor.
    for (const x of [-91.5, 91.5]) groundPlane(87, 270, x, 0, mat.asphalt, 0);
    for (const z of [-91.5, 91.5]) groundPlane(96, 87, 0, z, mat.asphalt, 0);
  }
  function groundSurfaces(regions) {
    const xs = new Set([-48, 48]), zs = new Set([-48, 48]);
    for (const r of regions) {
      xs.add(r.x - r.w / 2); xs.add(r.x + r.w / 2);
      zs.add(r.z - r.d / 2); zs.add(r.z + r.d / 2);
    }
    const columns = [...xs].sort((a, b) => a - b), rows = [...zs].sort((a, b) => a - b);
    const rectangles = [], previous = new Map();
    for (let zi = 0; zi < rows.length - 1; zi++) {
      const z0 = rows[zi], z1 = rows[zi + 1], z = (z0 + z1) / 2;
      let runStart = columns[0], runMaterial = null;
      const finishRun = x1 => {
        const key = `${runStart}:${x1}:${runMaterial.uuid}`, old = previous.get(key);
        if (old && old.z1 === z0) old.z1 = z1;
        else {
          const rectangle = { x0: runStart, x1, z0, z1, material: runMaterial };
          rectangles.push(rectangle); previous.set(key, rectangle);
        }
      };
      for (let xi = 0; xi < columns.length - 1; xi++) {
        const x = (columns[xi] + columns[xi + 1]) / 2;
        let material = mat.asphalt;
        for (const r of regions) {
          if (Math.abs(x - r.x) < r.w / 2 && Math.abs(z - r.z) < r.d / 2) material = r.material;
        }
        if (runMaterial && material !== runMaterial) { finishRun(columns[xi]); runStart = columns[xi]; }
        runMaterial = material;
      }
      finishRun(columns[columns.length - 1]);
    }
    for (const r of rectangles) groundPlane(r.x1 - r.x0, r.z1 - r.z0, (r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, r.material, 0);
  }
  function drain(x, z) {
    box(x, 0.015, z, 0.7, 0.028, 1.5, mat.dark, false, '', false, false);
    for (let dz = -0.6; dz <= 0.6; dz += 0.2) box(x, 0.035, z + dz, 0.66, 0.02, 0.065, mat.steel, false, '', false, false);
  }

  // An opening splits the wall itself and its colliders; headers never enter
  // the ground navigation footprints. All dimensions come from one record.
  function wallWithDoor(axis, fixed, from, to, height, opening, doorHeight, material, name, thickness = 0.5) {
    const part = (a, b, bottom, top, nav) => {
      if (b <= a || top <= bottom) return;
      const along = (a + b) / 2, y = (bottom + top) / 2;
      box(axis === 'x' ? along : fixed, y, axis === 'x' ? fixed : along,
        axis === 'x' ? b - a : thickness, top - bottom, axis === 'x' ? thickness : b - a,
        material, true, name, nav);
    };
    part(from, opening[0], 0, height, true); part(opening[1], to, 0, height, true);
    part(opening[0], opening[1], doorHeight, height, false);
  }
  function createWarehouse() {
    const w = ASSAULT.warehouse;
    wallWithDoor('x', w.front, w.left, w.right, w.height, ASSAULT.gates.front, 5.4, mat.cladding, 'Warehouse front wall');
    wallWithDoor('z', w.right, w.back, w.front, w.height, ASSAULT.gates.east, 3.5, mat.cladding, 'East service wall');
    wallWithDoor('z', w.left, w.back, w.front, w.height, ASSAULT.gates.west, 3.5, mat.cladding, 'West service wall');
    box(0, w.height / 2, w.back, 40, w.height, 0.5, mat.cladding, true, 'Warehouse back wall');
    // Low concrete foundations use the same opening spans as the upper shell.
    wallWithDoor('x', w.front, w.left, w.right, 1.2, ASSAULT.gates.front, 1.2, mat.concrete, 'Front foundation', 0.6);
    wallWithDoor('z', w.right, w.back, w.front, 1.2, ASSAULT.gates.east, 1.2, mat.concrete, 'East foundation', 0.6);
    wallWithDoor('z', w.left, w.back, w.front, 1.2, ASSAULT.gates.west, 1.2, mat.concrete, 'West foundation', 0.6);
    box(0, 0.6, w.back, 40, 1.2, 0.6, mat.concrete, true, 'Back foundation');
    box(0, 10.5, -13, 41.2, 0.35, 39.2, mat.roof, true, 'Warehouse roof', false);
    for (const x of [-20.48, 20.48]) box(x, 10.7, -13, 0.22, 0.4, 39.4, mat.trim, true, 'Roof edge', false);
    for (const z of [-32.48, 6.48]) box(0, 10.7, z, 41.2, 0.4, 0.22, mat.trim, true, 'Roof edge', false);
    // Recessed upper windows are closed decorative glazing, never spawn points.
    for (const side of [-1, 1]) for (let i = 0; i < 4; i++) {
      const x = side * (7.6 + i * 3.05);
      facadeWindow(x, 7.5, 6.3, 2.45, 1.5, 0, mat.windowLight);
    }
    for (const x of [-19.7, -10, 10, 19.7]) {
      box(x, 5.25, 6.34, 0.25, 10.5, 0.16, mat.steel);
      box(x, 5.05, -31.67, 0.24, 10.1, 0.2, mat.steel);
    }
    for (const x of [-5.62, 5.62]) box(x, 2.8, 6.35, 0.3, 5.6, 0.38, mat.steel, true, 'Loading entrance frame');
    box(0, 5.58, 6.32, 11.55, 0.36, 0.52, mat.steel, true, 'Loading entrance header', false);
    box(0, 6.25, 6.4, 10.6, 1.05, 0.22, mat.duct, true, 'Raised roller shutter', false);
    for (let y = 5.86; y < 6.8; y += 0.18) box(0, y, 6.55, 10.55, 0.035, 0.06, mat.steel, false, '', false, false);
    sign('72ND STREET', 'SUPPLY STATION', 0, 8.45, 6.39, 8.6, 1.72, 0, '#d0ccad', '#263c3d');
    sign('01', 'LOADING', -7.8, 3.15, 6.42, 1.65, 1.3, 0, '#455d58', '#e4e2c7');
    for (const x of [-5.9, 5.9]) hazardPost(x, 6.75);
    for (const side of [-1, 1]) {
      const opening = side === 1 ? ASSAULT.gates.east : ASSAULT.gates.west;
      const mid = (opening[0] + opening[1]) / 2;
      for (const z of opening) box(side * 20.12, 1.78, z, 0.65, 3.56, 0.14, mat.steel, true, 'Service door jamb');
      box(side * 20.15, 3.55, mid, 0.65, 0.17, opening[1] - opening[0], mat.steel, true, 'Service lintel', false);
      sign(side === 1 ? 'SERVICE 02' : 'VENTILATION', '', side * 20.37, 4.2, mid,
        3.2, 0.58, side * Math.PI / 2, '#d2cbae', '#2c4446');
      box(side * 20.38, 3.88, mid, 0.4, 0.16, 0.58, mat.lamp, false, '', false, false);
    }
    // The distinct steel frame, high gallery and ducting retain the warehouse
    // silhouette. No gallery/roof is registered as a walkable floor.
    for (const z of [-28, -19, -9, 1.5]) {
      for (const x of [-18.9, 18.9]) box(x, 4.9, z, 0.32, 9.8, 0.4, mat.steel, true, 'Warehouse frame column');
      box(0, 9.65, z, 38.1, 0.32, 0.35, mat.steel, true, 'Warehouse roof beam', false);
      for (let x = -18; x < 17; x += 6) {
        beam([x, 9.65, z], [x + 3, 8.7, z], 0.12, mat.steel);
        beam([x + 3, 8.7, z], [x + 6, 9.65, z], 0.12, mat.steel);
      }
      box(0, 8.67, z, 36, 0.12, 0.14, mat.steel, false, '', false, false);
    }
    box(-17.9, 4.5, -12.5, 3.3, 0.22, 31, mat.steel, true, 'Upper gallery, scenery', false);
    box(0, 4.5, -29.9, 36.5, 0.22, 3.5, mat.steel, true, 'Back gallery, scenery', false);
    rail(-16.24, -27.8, -16.24, 2.7, 4.65);
    rail(-16.2, -28.13, 18.3, -28.13, 4.65);
    for (const z of [-25, -15, -5]) {
      beam([-19.45, 3.3, z], [-16.4, 4.42, z], 0.15, mat.steel);
      for (const x of [-8, 8]) {
        box(x, 8.85, z, 3.8, 0.2, 0.55, mat.dark, false, '', false, false);
        box(x, 8.71, z, 3.45, 0.055, 0.4, mat.lamp, false, '', false, false);
        for (const dx of [-1.4, 1.4]) cylinder(x + dx, 9.55, z, 0.025, 1.3, mat.steel, 0, 0, 0, false);
      }
    }
    // Unshadowed local fill only; the host still owns the main sun/hemisphere.
    for (const z of [-22, -3]) {
      const light = new THREE.PointLight(0xe3efdc, 26, 24, 2);
      light.position.set(1, 5.3, z); light.name = 'Warehouse fluorescent fill'; root.add(light);
    }
    box(-12.9, 7.3, -11, 1.4, 1.3, 31, mat.duct, true, 'Overhead ventilation', false);
    box(-12.9, 9.8, 2.8, 1.4, 4, 1.5, mat.duct, true, 'Roof ventilation riser', false);
    box(-8.1, 11.25, 2.8, 10.5, 1.1, 1.5, mat.duct, true, 'Roof intake', false);
    for (let z = -24; z < 4; z += 4) box(-12.9, 7.3, z, 1.49, 1.39, 0.09, mat.steel, false, '', false, false);
    for (let x = -12; x < -2.8; x += 2.2) box(x, 11.25, 2.8, 0.09, 1.19, 1.59, mat.steel, false, '', false, false);
    box(-2.76, 11.25, 2.8, 0.04, 0.91, 1.28, mat.dark, false, '', false, false);
    for (let z = 2.28; z <= 3.4; z += 0.16) box(-2.71, 11.25, z, 0.06, 0.86, 0.035, mat.trim, false, '', false, false);
    // Exterior duct above the adapted, full-height service route.
    box(-21, 6.2, -4.5, 1.7, 1.5, 5.6, mat.duct, true, 'West service ventilation', false);
    box(-20.8, 8.7, -6.6, 1.3, 4.9, 1.4, mat.duct, true, 'Exterior duct riser', false);
    for (const x of [-18.9, 18.9]) cylinder(x, 5, 6.55, 0.075, 9.7, mat.steel, 0, 0, 0, false);
  }

  function createSecurityRoom() {
    // A ground-level counterpart of the classic security/hostage room. Two real
    // entrances keep this useful during matches, without adding hostage mechanics.
    // Leave the corner's approach grid cell clear for the existing 1-unit
    // flood field; the former -23.2 edge stranded enemies while turning east.
    wallWithDoor('z', -5.8, -31.65, -18, 3.6, [-27.1, -22.7], 2.8, mat.plaster, 'Security room east wall', 0.35);
    wallWithDoor('x', -18, -19.65, -5.8, 3.6, [-15, -11], 2.8, mat.plaster, 'Security room front wall', 0.35);
    // The room uses open doorways; the high gallery remains scenery.
    box(-12.7, 3.7, -24.8, 13.9, 0.2, 13.6, mat.roof, true, 'Security room ceiling', false);
    sign('SECURITY', 'AUTHORIZED PERSONNEL', -13, 3.19, -17.79, 3.5, 0.54, 0, '#385451', '#e2e7d9');
    box(-18, 0.42, -27.9, 1.8, 0.84, 4, mat.dark, true, 'Security console');
    box(-17.8, 0.9, -27.9, 2.2, 0.14, 4.15, mat.steel, true, 'Security console tabletop');
    for (const z of [-26.6, -28.6]) {
      box(-18, 1.31, z, 0.65, 0.65, 1.15, mat.dark, true, 'Security monitor');
      box(-17.655, 1.34, z, 0.035, 0.48, 0.94, mat.windowLight, false, '', false, false);
      for (let dz = -0.32; dz <= 0.32; dz += 0.16) box(-17.63, 1.34, z + dz, 0.015, 0.41, 0.014, mat.steel, false, '', false, false);
    }
    box(-9.1, 1.05, -30.7, 3.9, 2.1, 1, mat.cargoGreen, true, 'Security lockers');
    for (let x = -10.6; x < -7.5; x += 1) {
      box(x, 1.05, -30.18, 0.025, 1.9, 0.02, mat.steel, false, '', false, false);
      box(x + 0.28, 1.1, -30.15, 0.045, 0.22, 0.055, mat.trim, false, '', false, false);
    }
    box(-12.7, 3.52, -25, 3.5, 0.08, 0.65, mat.lamp, false, '', false, false);
  }

  function rail(x1, z1, x2, z2, y) {
    const length = Math.hypot(x2 - x1, z2 - z1), count = Math.ceil(length / 2.2);
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      box(x1 + (x2 - x1) * t, y + 0.48, z1 + (z2 - z1) * t, 0.065, 0.98, 0.065, mat.steel, false, '', false, false);
    }
    for (const h of [0.48, 0.98]) beam([x1, y + h, z1], [x2, y + h, z2], 0.065, mat.steel, 0.065, false);
  }
  function createCargo() {
    for (const c of ASSAULT.cargo) for (let tier = 0; tier < c.tiers; tier++) {
      const bottom = tier * 2.75, h = 2.75, material = mat[c.colors[tier]];
      box(c.x, bottom + h / 2, c.z, c.w, h, c.d, material, true, 'Cargo container', tier === 0);
      for (const x of [-1, 1]) for (const z of [-1, 1]) {
        box(c.x + x * (c.w / 2 - 0.07), bottom + h / 2, c.z + z * (c.d / 2 - 0.015), 0.13, h + 0.025, 0.13, mat.steel);
      }
      for (const y of [0.12, h - 0.12]) box(c.x, bottom + y, c.z, c.w + 0.035, 0.12, c.d + 0.035, mat.steel);
      // Door details are all inside the cargo footprint except shallow hardware.
      const front = c.z + c.d / 2;
      for (const dx of [-c.w * 0.21, c.w * 0.21]) {
        box(c.x + dx, bottom + 1.36, front + 0.035, 0.055, 2.22, 0.07, mat.trim, false, '', false, false);
        box(c.x + dx + 0.13, bottom + 1.15, front + 0.085, 0.31, 0.05, 0.09, mat.trim, false, '', false, false);
      }
      box(c.x, bottom + 1.38, front + 0.025, 0.045, 2.5, 0.05, mat.steel, false, '', false, false);
      if (c.w > c.d) sign(tier ? '02' : 'FREIGHT', '', c.x, bottom + 1.65, front + 0.075,
        tier ? 0.95 : 2, 0.54, 0, tier ? '#38566a' : '#783f32', '#d8d3b3');
    }
    for (const c of ASSAULT.crates) crate(...c);
  }
  function crate(x, z, w, h, d) {
    box(x, h / 2, z, w, h, d, mat.wood, true, 'Wooden shipping crate');
    for (const side of [-1, 1]) {
      for (const y of [0.14, h - 0.14]) box(x, y, z + side * (d / 2 + 0.025), w, 0.2, 0.07, mat.woodEdge);
      for (const dx of [-w / 2 + 0.13, w / 2 - 0.13]) box(x + dx, h / 2, z + side * (d / 2 + 0.025), 0.2, h, 0.07, mat.woodEdge);
      beam([x - w / 2 + 0.15, 0.25, z + side * (d / 2 + 0.065)],
        [x + w / 2 - 0.15, h - 0.25, z + side * (d / 2 + 0.065)], 0.14, mat.woodEdge, 0.06, false);
      for (const dz of [-d / 2 + 0.13, d / 2 - 0.13]) box(x + side * (w / 2 + 0.025), h / 2, z + dz, 0.07, h, 0.2, mat.woodEdge);
    }
    for (const dx of [-w * 0.3, w * 0.3]) box(x + dx, h + 0.025, z, 0.16, 0.05, d, mat.woodEdge, false, '', false, false);
  }

  function createOverpass() {
    box(0, 7.25, 27, 95, 0.9, 8.8, mat.concrete, true, 'Highway overpass deck', false);
    box(0, 7.75, 27, 95, 0.1, 8.1, mat.asphalt, true, 'Highway road, scenery', false);
    for (const x of [-26, 26]) {
      box(x, 3.4, 27, 2.6, 6.8, 5.4, mat.concrete, true, 'Highway pier');
      box(x, 0.25, 27, 3.4, 0.5, 6, mat.concrete, true, 'Highway pier base');
      box(x, 6.35, 27, 5.8, 0.8, 7.3, mat.concrete, true, 'Highway pier cap', false);
      for (const z of [24.25, 29.75]) {
        box(x, 2.05, z, 2.66, 0.75, 0.06, mat.yellow, false, '', false, false);
        for (let dx = -1; dx <= 1; dx += 0.5) beam([x + dx - 0.2, 1.7, z + (z < 27 ? -0.035 : 0.035)],
          [x + dx + 0.2, 2.4, z + (z < 27 ? -0.035 : 0.035)], 0.17, mat.dark, 0.025, false);
      }
    }
    for (const z of [22.95, 31.05]) {
      box(0, 8.25, z, 95, 0.94, 0.42, mat.concrete, true, 'Highway parapet', false);
      box(0, 8.9, z, 95, 0.08, 0.08, mat.steel, false, '', false, false);
      for (let x = -44; x <= 44; x += 4) box(x, 8.68, z, 0.07, 0.46, 0.07, mat.steel, false, '', false, false);
      box(0, 6.88, z, 95, 0.33, 0.25, mat.steel, true, 'Bridge beam', false);
    }
    for (let x = -44; x < 46; x += 6) groundPlane(3.5, 0.13, x, 27, mat.paintYellow, 7.817);
    for (const x of [-16, 16]) {
      box(x, 6.76, 27, 1.7, 0.12, 0.5, mat.lamp, false, '', false, false);
      cylinder(x, 10.5, 30.5, 0.07, 3.5, mat.steel, 0, 0, 0, false);
      box(x, 12.23, 29.9, 0.85, 0.16, 1.5, mat.steel, false, '', false, false);
    }
    sign('WAREHOUSE DISTRICT', '72ND STREET  /  KEEP CLEAR', 10, 8.1, 31.32, 9, 1.35, 0, '#315654', '#e1e7d7');
    sign('CLEARANCE 6.8 M', '', 0, 6.28, 31.47, 4.4, 0.72, 0, '#c7af66', '#2a3637');
  }

  function createSurroundings() {
    // Side blocks bound the playable lanes; every facade has a matching solid.
    building(-39.5, -18, 14, 54, 16.8, mat.brickDark, 'West industrial block');
    building(39.5, -23, 14, 44, 20.5, mat.brick, 'East brick block');
    building(40.5, 9.5, 12, 13, 12.4, mat.brickLight, 'Yard service building');
    building(-39.8, 10.5, 13.5, 10.6, 11.1, mat.brick, 'West yard building');
    building(-34, 41.5, 24, 9, 13.6, mat.brickLight, 'South west block');
    building(35, 42.5, 22, 7, 18.1, mat.brickDark, 'South east block');
    for (const x of [-47, 47]) box(x, 2.4, 0, 1, 4.8, 96, mat.brickDark, true, 'District boundary');
    for (const z of [-47, 47]) box(0, 2.4, z, 96, 4.8, 1, mat.brickDark, true, 'District boundary');
    for (let x = -42; x <= 42; x += 7) box(x, 2.5, -46.38, 0.6, 5, 0.3, mat.concrete);
    box(0, 4.85, -47, 95, 0.2, 1.1, mat.concrete);
    sign('72ND STREET', '', -23.25, 4.7, 36.86, 5.5, 0.7, Math.PI, '#315a54', '#d5dccd');
    sign('NO PARKING', 'LOADING ZONE', 34.43, 3.4, 8.7, 3.7, 1.15, -Math.PI / 2, '#d3cbb0', '#683c31');
    waterTank(-39, -20, 17.09);
    waterTank(38.5, -27, 20.79);
    // Authored distant skyline, outside all gameplay and spawn bounds.
    const skyline = [
      [-64,-39,18,23,31],[-60,1,13,16,25],[-62,41,20,19,34],
      [60,-47,16,20,36],[66,-10,19,18,29],[61,35,15,23,32],
      [-31,-64,21,17,30],[2,-69,18,21,38],[29,-65,20,18,27],
      [-22,64,19,17,25],[7,69,22,19,32],[39,65,17,18,28]
    ];
    for (let i = 0; i < skyline.length; i++) {
      const [x,z,w,d,h] = skyline[i];
      box(x, h / 2, z, w, h, d, i % 2 ? mat.brickDark : mat.brickLight, false, '', false, false);
      box(x, h + 0.25, z, w + 0.5, 0.5, d + 0.5, mat.roof, false, '', false, false);
      for (let y = 7; y < h - 2; y += 4.7) {
        const front = z < 0 ? z + d / 2 + 0.04 : z - d / 2 - 0.04;
        for (let dx = -w / 2 + 2; dx < w / 2 - 1; dx += 3.4) box(x + dx, y, front, 1.45, 2, 0.05, mat.glass, false, '', false, false);
      }
    }
  }
  function building(x, z, w, d, h, material, name) {
    box(x, h / 2, z, w, h, d, material, true, name);
    box(x, 0.5, z, w + 0.1, 1, d + 0.1, mat.concrete, true, name + ' foundation');
    box(x, h - 0.25, z, w + 0.35, 0.4, d + 0.35, mat.trim);
    box(x, h + 0.12, z, w + 0.4, 0.34, d + 0.4, mat.roof);
    box(x + 1.5, h + 0.85, z - 1.2, 3, 1.4, 3.7, mat.duct, false, '', false, false);
    for (const side of [-1, 1]) {
      for (let y = 4.6; y < h - 1.6; y += 3.8) {
        for (let dz = -d / 2 + 2.8; dz < d / 2 - 1.7; dz += 4.2)
          facadeWindow(x + side * (w / 2 + 0.07), y, z + dz, 1.7, 2.15, side * Math.PI / 2, mat.glass);
        for (let dx = -w / 2 + 2.6; dx < w / 2 - 1.5; dx += 4.1)
          facadeWindow(x + dx, y, z + side * (d / 2 + 0.07), 1.7, 2.15, side === 1 ? 0 : Math.PI, mat.glass);
      }
    }
  }
  function facadeWindow(x, y, z, w, h, yaw, glazing) {
    const local = (lx, ly, lz, sx, sy, sz, material) => {
      instance(boxGeo, material, x + Math.cos(yaw) * lx + Math.sin(yaw) * lz, y + ly,
        z - Math.sin(yaw) * lx + Math.cos(yaw) * lz, sx, sy, sz, 0, yaw, 0, false);
    };
    local(0, 0, 0, w + 0.23, h + 0.24, 0.09, mat.dark);
    local(0, 0, 0.065, w, h, 0.06, glazing);
    local(0, -h / 2 - 0.07, 0.11, w + 0.35, 0.14, 0.22, mat.trim);
    local(0, 0, 0.115, 0.065, h, 0.045, mat.steel);
    local(0, 0, 0.115, w, 0.07, 0.045, mat.steel);
  }
  function waterTank(x, z, roofY) {
    for (const dx of [-1.5, 1.5]) for (const dz of [-1.5, 1.5]) {
      box(x + dx, roofY + 1.3, z + dz, 0.16, 2.6, 0.16, mat.steel, false, '', false, false);
      beam([x + dx, roofY, z + dz], [x - dx, roofY + 2.3, z + dz], 0.09, mat.steel, 0.09, false);
    }
    cylinder(x, roofY + 4.1, z, 2.25, 3.5, mat.wood, 0, 0, 0, false);
    for (const y of [2.45, 3.3, 4.9, 5.75]) cylinder(x, roofY + y, z, 2.29, 0.09, mat.steel, 0, 0, 0, false);
    cylinder(x, roofY + 5.95, z, 2.38, 0.22, mat.roof, 0, 0, 0, false);
  }

  function createYardDetails() {
    van(-12, 37);
    for (const p of [[-30, 14], [29.7, -1], [-29, -36]]) dumpster(...p);
    for (const p of [[-20.6, 18], [21.3, 20], [30.8, -25], [-29.8, -16]]) lampPost(...p);
    // Tall cover is deliberate; small dressing remains close to the walls.
    barrier(10.8, 34.3, 5.5); barrier(-7.8, -40.5, 5.1);
    for (const p of [[16.8,-29], [29.3,5.4], [-23.8,-30.2]]) {
      for (const dx of [-0.55, 0.55]) barrel(p[0] + dx, p[1]);
    }
    for (const p of [[-19.5,6.65],[20.6,-25.7]]) {
      box(p[0], 3.2, p[1], 0.7, 0.36, 0.85, mat.white, false, '', false, false);
      box(p[0], 3.2, p[1] + 0.45, 0.5, 0.2, 0.06, mat.dark, false, '', false, false);
      box(p[0], 2.9, p[1] - 0.13, 0.08, 0.5, 0.15, mat.steel, false, '', false, false);
    }
    // Background utility cables, well above every playable route.
    for (const x of [-30.5, 30.5]) {
      for (const z of [-39, 8]) cylinder(x, 5.7, z, 0.09, 11.4, mat.steel, 0, 0, 0, false);
      for (const dx of [-0.45, 0.45]) for (let i = 0; i < 12; i++) {
        const a = i / 12, b = (i + 1) / 12;
        beam([x + dx, 11.35 - Math.sin(a * Math.PI) * 1.4, -39 + a * 47],
          [x + dx, 11.35 - Math.sin(b * Math.PI) * 1.4, -39 + b * 47], 0.023, mat.dark, 0.023, false);
      }
    }
  }
  function hazardPost(x, z) {
    box(x, 0.65, z, 0.25, 1.3, 0.25, mat.yellow, true, 'Entrance bollard');
    for (const y of [0.37,0.83]) box(x, y, z, 0.257, 0.21, 0.257, mat.dark, false, '', false, false);
  }
  function barrier(x, z, w) {
    box(x, 0.52, z, w, 1.04, 0.85, mat.concrete, true, 'Concrete road barrier');
    box(x, 1.07, z, w, 0.1, 0.55, mat.trim);
    for (let dx = -w / 2 + 0.35; dx < w / 2; dx += 0.75) {
      box(x + dx, 0.65, z + 0.433, 0.32, 0.5, 0.023, mat.yellow, false, '', false, false);
      box(x + dx, 0.65, z - 0.433, 0.32, 0.5, 0.023, mat.yellow, false, '', false, false);
    }
  }
  function barrel(x, z) {
    cylinder(x, 0.55, z, 0.47, 1.1, mat.cargoGreen);
    for (const y of [0.14,0.88,1.1]) cylinder(x, y, z, 0.485, 0.055, mat.steel, 0, 0, 0, false);
    collider(x, 0.57, z, 0.98, 1.14, 0.98, 0, 'Steel barrel');
  }
  function dumpster(x, z) {
    box(x, 0.65, z, 2.8, 1.3, 1.6, mat.cargoGreen, true, 'Dumpster');
    box(x, 1.36, z, 2.86, 0.13, 1.66, mat.dark, true, 'Dumpster lid');
    for (const dx of [-1.1, 1.1]) box(x + dx, 0.25, z, 0.15, 0.4, 1.68, mat.steel);
  }
  function lampPost(x, z) {
    cylinder(x, 3.4, z, 0.09, 6.8, mat.steel);
    collider(x, 3.4, z, 0.2, 6.8, 0.2, 0, 'Yard light pole');
    box(x + (x < 0 ? 0.65 : -0.65), 6.7, z, 1.45, 0.15, 0.15, mat.steel);
    box(x + (x < 0 ? 1.18 : -1.18), 6.55, z, 0.8, 0.16, 0.46, mat.dark);
    box(x + (x < 0 ? 1.18 : -1.18), 6.455, z, 0.63, 0.035, 0.36, mat.lamp, false, '', false, false);
  }
  function van(x, z) {
    // A parked, procedurally built CT communications van, solid at ground level.
    box(x, 0.48, z, 2.7, 0.38, 5.8, mat.dark);
    box(x, 1.48, z - 0.6, 2.65, 2.1, 4.6, mat.van);
    box(x, 1.03, z + 2.1, 2.6, 1.15, 1.7, mat.van);
    box(x, 1.91, z + 1.45, 2.3, 0.66, 0.55, mat.glass);
    box(x, 2.49, z - 0.3, 2.7, 0.18, 4.55, mat.van, true, 'CT van roof', false);
    box(x, 0.55, z + 2.98, 2.83, 0.2, 0.16, mat.steel);
    // Match the high body and low hood separately. A full-height envelope used
    // to stop bullets above the hood and let the player stand on invisible air.
    collider(x, 1.29, z - 0.6, 2.85, 2.58, 4.6, 0, 'CT van body');
    collider(x, 0.8025, z + 2.1, 2.7, 1.605, 1.7, 0, 'CT van hood');
    collider(x, 0.55, z + 2.98, 2.83, 0.2, 0.16, 0, 'CT van bumper');
    for (const side of [-1, 1]) {
      for (const dz of [-1.8, 1.9]) {
        cylinder(x + side * 1.35, 0.49, z + dz, 0.5, 0.26, mat.rubber, 0, 0, Math.PI / 2);
        cylinder(x + side * 1.5, 0.49, z + dz, 0.27, 0.045, mat.steel, 0, 0, Math.PI / 2, false);
      }
      sign('POLICE', '', x + side * 1.345, 1.5, z - 0.55, 2.8, 0.55, side * Math.PI / 2, '#4f6778', '#d9e0d8');
      box(x + side * 0.8, 1.04, z + 2.97, 0.55, 0.28, 0.04, mat.white, false, '', false, false);
    }
    box(x, 2.7, z + 0.9, 1.6, 0.18, 0.36, mat.dark);
    for (const dx of [-0.52,0.52]) box(x + dx, 2.86, z + 0.9, 0.55, 0.16, 0.3, dx < 0 ? mat.red : mat.cargoBlue);
    cylinder(x - 0.65, 3.55, z - 1.6, 0.035, 2, mat.steel, 0, 0, 0, false);
  }

  function sign(title, subtitle, x, y, z, w, h, yaw, background, color) {
    const texture = canvasTexture(512, 128, ctx => {
      ctx.fillStyle = background; ctx.fillRect(0,0,512,128);
      ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.strokeRect(5,5,502,118);
      ctx.fillStyle = color; ctx.textAlign = 'center';
      ctx.font = 'bold ' + (title.length > 18 ? 29 : 42) + 'px Arial';
      ctx.fillText(title,256,subtitle ? 61 : 81,480);
      if (subtitle) { ctx.font = '18px Arial'; ctx.fillText(subtitle,256,100,472); }
    });
    const mesh = new THREE.Mesh(planeGeo, new THREE.MeshStandardMaterial({ map: texture, roughness: 0.86 }));
    mesh.name = title; mesh.position.set(x,y,z); mesh.rotation.y = yaw; mesh.scale.set(w,h,1);
    mesh.receiveShadow = true; root.add(mesh);
  }
  function createSky() {
    const settings = WORLD_SETTINGS.sky;
    scene.background = new THREE.Color(settings.fogColor);
    scene.fog = new THREE.Fog(settings.fogColor, settings.fogNear, settings.fogFar);
    const geometry = new THREE.SphereGeometry(450,24,16), colors = [];
    const top = new THREE.Color(settings.top), mid = new THREE.Color(settings.mid), horizon = new THREE.Color(settings.horizon);
    const position = geometry.attributes.position, color = new THREE.Color();
    for (let i = 0; i < position.count; i++) {
      const t = Math.max(0, position.getY(i) / 450);
      color.copy(t < 0.22 ? horizon : mid).lerp(t < 0.22 ? mid : top, t < 0.22 ? t / 0.22 : (t - 0.22) / 0.78);
      colors.push(color.r,color.g,color.b);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors,3));
    const dome = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false }));
    dome.name = 'Assault city sky'; dome.renderOrder = -1000; scene.add(dome);
    const sun = new THREE.Mesh(new THREE.SphereGeometry(2.3,12,8), new THREE.MeshBasicMaterial({ color: 0xffefcf, fog: false }));
    // The visible sun and host directional light share exactly one direction.
    sun.position.set(...WORLD_SETTINGS.lighting.sunPosition).normalize().multiplyScalar(240);
    sun.name = 'Sun aligned with world lighting'; scene.add(sun);
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
