// cs_office-inspired winter office complex. Entire environment is procedural.
// Flat playable floor; the supplied collision, navigation and spawn API is retained.
export const WORLD_SETTINGS = {
  seed: 52375200, size: 96, spawn: [-14, 1.75, 31], spawnYaw: -0.65,
  sky: { top: 0x819aaf, mid: 0xb5c6d0, horizon: 0xdce4e6, fogColor: 0xc0cdd4, fogNear: 64, fogFar: 170 },
  lighting: {
    hemisphereSky: 0xdfeaf2, hemisphereGround: 0x959a9b, hemisphereIntensity: 1.65,
    sunColor: 0xe5edf4, sunIntensity: 2.05, sunPosition: [-28, 45, 22]
  }
};

export function createWorld({ THREE, scene }) {
  const root = new THREE.Group(); root.name = "OfficeWinterComplex"; scene.add(root);
  const colliders = [], floorObjects = [];
  const obstacles = [], batches = new Map(), random = mulberry32(WORLD_SETTINGS.seed);
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const cylinderGeo = new THREE.CylinderGeometry(1, 1, 1, 10);
  const sphereGeo = new THREE.SphereGeometry(1, 12, 8);
  const coneGeo = new THREE.ConeGeometry(1, 1, 9);
  const temp = new THREE.Object3D();
  const hiddenMaterial = new THREE.MeshBasicMaterial({ visible: false });
  let snow, snowFloor;
  const textures = {
    snow: surfaceTexture("snow"), carpet: surfaceTexture("carpet"),
    brick: surfaceTexture("brick"), concrete: surfaceTexture("concrete"),
    ceiling: surfaceTexture("ceiling"), wood: surfaceTexture("wood")
  };
  const mat = {
    snow: standard(0xe4edf0, { map: textures.snow }),
    snowBank: standard(0xe1e9ec), ice: standard(0x9faeb5, { roughness: 0.73 }),
    asphalt: standard(0x66737b, { map: textures.concrete }),
    concrete: standard(0x9aa3a7, { map: textures.concrete }),
    brick: standard(0x82574a, { map: textures.brick }),
    brickDark: standard(0x625653, { map: textures.brick }),
    wall: standard(0xd3cfbd), dado: standard(0x919c98), trim: standard(0xe2dfd3),
    carpet: standard(0x526779, { map: textures.carpet }),
    carpetGrey: standard(0x758487, { map: textures.carpet }),
    carpetWine: standard(0x826760, { map: textures.carpet }),
    ceiling: standard(0xdcded6, { map: textures.ceiling }),
    wood: standard(0x937056, { map: textures.wood }),
    woodDark: standard(0x634a37, { map: textures.wood }),
    metal: standard(0x69777d, { metalness: 0.38, roughness: 0.62 }),
    dark: standard(0x293238), plastic: standard(0xc4c6bd),
    blue: standard(0x3d6379), teal: standard(0x416d6c), red: standard(0x8b4035),
    ochre: standard(0xcbb475), paper: standard(0xe3dfcc), leaf: standard(0x466453),
    glass: standard(0x385665, { metalness: 0.23, roughness: 0.33 }),
    white: standard(0xd3d9d9), tire: standard(0x2b3033),
    tube: new THREE.MeshBasicMaterial({ color: 0xe8f5ee, toneMapped: false }),
    warmTube: new THREE.MeshBasicMaterial({ color: 0xf0dfbc, toneMapped: false }),
    indicator: new THREE.MeshBasicMaterial({ color: 0x82bb9b }),
    amber: new THREE.MeshBasicMaterial({ color: 0xdb9d56 })
  };
  worldBrickMapping(mat.brick); worldBrickMapping(mat.brickDark);
  const labels = createLabels();
  const world = {
    map: root, colliders, floorObjects,
    isLoaded: false, spawn: new THREE.Vector3(...WORLD_SETTINGS.spawn),
    lighting: WORLD_SETTINGS.lighting, ready: null, navigation: null,
    resetPlayer, update
  };

  createSky(); createGround(); createOfficeShell(); createGarage();
  furnishOffices(); createExterior(); createBackdrop(); flushBatches();
  root.updateMatrixWorld(true);
  createSnow();
  world.navigation = createNavigation();
  world.isLoaded = true; world.ready = Promise.resolve(world);
  return world;

  function standard(color, extra = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.91, metalness: 0.025, ...extra });
  }
  function worldBrickMapping(material) {
    // Fixed physical brick size on every facade, independent of instance dimensions.
    // Only the diffuse-map coordinates change; Three.js retains its standard lighting.
    material.onBeforeCompile = shader => {
      shader.vertexShader = "varying vec3 officeWorldPosition;\nvarying vec3 officeWorldNormal;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", `
        #include <begin_vertex>
        vec4 officePosition = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          officePosition = instanceMatrix * officePosition;
        #endif
        officeWorldPosition = (modelMatrix * officePosition).xyz;
        officeWorldNormal = normalize(mat3(modelMatrix) * normal);
      `);
      shader.fragmentShader = "varying vec3 officeWorldPosition;\nvarying vec3 officeWorldNormal;\n" + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `
        #ifdef USE_MAP
          vec3 officeAxis = abs(officeWorldNormal);
          vec2 officeUV = officeAxis.y > 0.5 ? officeWorldPosition.xz :
            (officeAxis.x > 0.5 ? officeWorldPosition.zy : officeWorldPosition.xy);
          diffuseColor *= texture2D(map, officeUV * vec2(0.42, 0.75));
        #endif
      `);
    };
    material.customProgramCacheKey = () => "office-world-brick-v1";
  }
  function canvasTexture(w, h, draw) {
    const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
    draw(canvas.getContext("2d"), w, h);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
    return texture;
  }
  function surfaceTexture(kind) {
    const texture = canvasTexture(256, 256, (ctx, w, h) => {
      const data = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        let v = 219 + (random() - 0.5) * (kind === "carpet" ? 40 : 17);
        if (kind === "carpet") v += ((x + y) % 3 === 0 ? -17 : 0);
        if (kind === "wood") v = 212 + Math.sin(x * 0.24 + Math.sin(y * 0.04)) * 12 + random() * 12;
        data.data[i] = data.data[i + 1] = data.data[i + 2] = v; data.data[i + 3] = 255;
      }
      ctx.putImageData(data, 0, 0);
      if (kind === "brick") {
        for (let row = 0; row < 8; row++) for (let col = -1; col < 5; col++) {
          ctx.fillStyle = `rgba(70,60,54,${0.06 + random() * 0.14})`;
          ctx.fillRect(col * 64 + row % 2 * 32, row * 32, 61, 29);
        }
        ctx.strokeStyle = "#999b94"; ctx.lineWidth = 3;
        for (let y = 0; y <= h; y += 32) {
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
          for (let x = (y / 32 % 2) * 32; x < w; x += 64) {
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 32); ctx.stroke();
          }
        }
      }
      if (kind === "ceiling") {
        ctx.fillStyle = "#aeb7b5"; ctx.fillRect(0, 0, w, 4); ctx.fillRect(0, 0, 4, h);
        for (let i = 0; i < 420; i++) { ctx.fillStyle = "#c8cdc6"; ctx.fillRect(random() * w, random() * h, 1, 2); }
      }
    });
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    if (kind === "brick") texture.repeat.set(2, 2);
    return texture;
  }
  function sector(x, z) {
    // Two indoor and two outdoor zones balance culling against submission cost.
    return (Math.abs(x) < 29 && z > -30 && z < 14 ? "in" : "out") + (z < -5 ? "N" : "S");
  }
  function instance(geo, material, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0, shadow = false) {
    const key = `${geo.uuid}/${material.uuid}/${sector(x, z)}/${shadow}`;
    if (!batches.has(key)) batches.set(key, { geo, material, shadow, matrices: [] });
    temp.position.set(x, y, z); temp.rotation.set(rx, ry, rz); temp.scale.set(sx, sy, sz); temp.updateMatrix();
    batches.get(key).matrices.push(temp.matrix.clone());
  }
  function box(x, y, z, w, h, d, material, solid = false, name = "Office cover", nav = true, shadow = solid) {
    instance(boxGeo, material, x, y, z, w, h, d, 0, 0, 0, shadow);
    if (solid) collider(x, y, z, w, h, d, 0, name, nav);
  }
  function collider(x, y, z, w, h, d, yaw = 0, name = "Office collision", navigationBlock = true) {
    const mesh = new THREE.Mesh(boxGeo, hiddenMaterial);
    mesh.name = name; mesh.position.set(x, y, z); mesh.rotation.y = yaw; mesh.scale.set(w, h, d);
    root.add(mesh); colliders.push(mesh);
    if (navigationBlock) obstacles.push({ x, z, halfW: w / 2, halfD: d / 2, cos: Math.cos(yaw), sin: Math.sin(yaw) });
    return mesh;
  }
  function cylinder(x, y, z, radius, height, material, rx = 0, rz = 0) {
    instance(cylinderGeo, material, x, y, z, radius, height, radius, rx, 0, rz);
  }
  function ellipsoid(x, y, z, rx, ry, rz, material) { instance(sphereGeo, material, x, y, z, rx, ry, rz); }
  function flushBatches() {
    for (const { geo, material, shadow, matrices } of batches.values()) {
      const mesh = new THREE.InstancedMesh(geo, material, matrices.length);
      matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
      mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere();
      mesh.name = "Office static details"; mesh.castShadow = shadow;
      mesh.receiveShadow = !material.isMeshBasicMaterial; root.add(mesh);
    }
    batches.clear();
  }
  function surface(x, z, w, d, material, y = 0.016, ceiling = false) {
    const geo = new THREE.PlaneGeometry(w, d), uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 1.5, uv.getY(i) * d / 1.5);
    const mesh = new THREE.Mesh(geo, material); mesh.rotation.x = ceiling ? Math.PI / 2 : -Math.PI / 2;
    mesh.position.set(x, y, z); mesh.receiveShadow = true; root.add(mesh); return mesh;
  }
  function createGround() {
    const floor = surface(0, 0, 96, 96, mat.snow, 0);
    floor.name = "G55FLR_OfficeGround"; colliders.push(floor); floorObjects.push(floor);
    // Adjacent room surfaces meet under the walls instead of overlapping.
    for (const [x,z,w,d,material] of [
      [0,-2,54,6,mat.carpet], [12,-16.5,6,23,mat.carpet], [12,6.5,6,11,mat.carpet],
      [-17,6.5,20,11,mat.carpetGrey], [1,6.5,16,11,mat.carpet], [21,6.5,12,11,mat.concrete],
      [-16,-16.5,22,23,mat.carpet], [2,-10.5,14,11,mat.carpet],
      [2,-22,14,12,mat.carpetWine], [21,-10.5,12,11,mat.carpet], [21,-22,12,12,mat.concrete]
    ]) surface(x,z,w,d,material);
    surface(-34, 28, 22, 26, mat.concrete);
    surface(3, 28, 52, 12, mat.asphalt);
    surface(34, 25, 10, 34, mat.asphalt);
    // Entrance mat is purely visual; every gameplay floor remains at zero.
    surface(1, 10, 5.7, 3.7, mat.dark, 0.028);
    for (const x of [-18, -8, 2, 12, 22]) {
      box(x, 0.025, 34, 0.12, 0.015, 6, mat.white);
      box(x + 4, 0.025, 37, 8, 0.015, 0.12, mat.white);
    }
  }

  // Each aperture is [start, end, bottom, top]. Headers do not enter the 2D nav grid.
  function wall(axis, fixed, from, to, apertures = [], exteriorSide = 0) {
    const h = 4.35, thick = 0.42, sorted = apertures.slice().sort((a, b) => a[0] - b[0]);
    function rect(a, b, low, high) {
      if (b - a < 0.01 || high - low < 0.01) return;
      const mid = (a + b) / 2, height = high - low, y = (low + high) / 2;
      const x = axis === "x" ? mid : fixed, z = axis === "x" ? fixed : mid;
      const w = axis === "x" ? b - a : thick, d = axis === "x" ? thick : b - a;
      box(x, y, z, w, height, d, mat.wall, true, "Office wall", low < 2.4);
      if (exteriorSide) {
        const ex = x + (axis === "z" ? exteriorSide * 0.265 : 0);
        const ez = z + (axis === "x" ? exteriorSide * 0.265 : 0);
        box(ex, y, ez, axis === "x" ? w : 0.12, height, axis === "x" ? 0.12 : d, mat.brick);
      }
      // Shallow continuous dado and skirting, with the same real door gaps.
      if (low === 0) {
        const cap = Math.min(high, 1.02);
        box(x, cap / 2, z, w + (axis === "z" ? 0.035 : 0), cap, d + (axis === "x" ? 0.035 : 0), mat.dado);
        box(x, 0.08, z, w + (axis === "z" ? 0.065 : 0), 0.16, d + (axis === "x" ? 0.065 : 0), mat.woodDark);
        if (high > 1.03) box(x, 1.04, z, w + (axis === "z" ? 0.07 : 0), 0.075, d + (axis === "x" ? 0.07 : 0), mat.trim);
      }
    }
    let cursor = from;
    for (const [a, b, low, high] of sorted) {
      rect(cursor, a, 0, h); rect(a, b, 0, low); rect(a, b, high, h); cursor = b;
      const frame = low ? mat.trim : mat.woodDark;
      for (const along of [a - 0.04, b + 0.04]) {
        box(axis === "x" ? along : fixed, (low + high) / 2, axis === "x" ? fixed : along,
          axis === "x" ? 0.16 : 0.52, high - low + 0.08, axis === "x" ? 0.52 : 0.16, frame);
      }
      box(axis === "x" ? (a + b) / 2 : fixed, high + 0.02, axis === "x" ? fixed : (a + b) / 2,
        axis === "x" ? b - a + 0.24 : 0.52, 0.16, axis === "x" ? 0.52 : b - a + 0.24, frame);
      if (low) box(axis === "x" ? (a + b) / 2 : fixed, low - 0.02, axis === "x" ? fixed : (a + b) / 2,
        axis === "x" ? b - a + 0.25 : 0.68, 0.16, axis === "x" ? 0.68 : b - a + 0.25, mat.trim);
    }
    rect(cursor, to, 0, h);
  }
  function createOfficeShell() {
    wall("x", 12, -27, 27, [[-24,-19,1.12,3.38],[-16,-11,1.12,3.38],[-2,4,0,3.4],[18,24,1.12,3.38]], 1);
    wall("x", -28, -27, 27, [[-22,-17,0,3.3],[0,5,1.18,3.35],[18,24,1.18,3.35]], -1);
    wall("z", -27, -28, 12, [[-24,-19,1.12,3.35],[-12,-7,0,3.3],[4,9,1.12,3.35]], -1);
    wall("z", 27, -28, 12, [[-24,-19,1.12,3.35],[-12,-7,0,3.3],[4,9,1.12,3.35]], 1);
    wall("x", 1, -27, 9, [[-22,-17,0,3.3],[-3,4,0,3.3]]);
    wall("x", 1, 15, 27, [[20,25,0,3.3]]);
    wall("x", -5, -27, 9, [[-15,-10,0,3.3],[-2,4,0,3.3]]);
    wall("x", -5, 15, 27, [[20,25,0,3.3]]);
    wall("z", -7, 1, 12, [[4,8,0,3.3]]);
    wall("z", -5, -28, -5, [[-24,-20,0,3.3],[-12,-8,0,3.3]]);
    wall("z", 9, -28, 1, [[-24,-20,0,3.3],[-12,-8,0,3.3]]);
    wall("z", 9, 1, 12, [[4,8,0,3.3]]);
    wall("z", 15, -28, -5, [[-24,-20,0,3.3],[-12,-8,0,3.3]]);
    wall("z", 15, 1, 12, [[4,8,0,3.3]]);
    wall("x", -16, -27, -5, [[-23,-18,0,3.3],[-12,-7,0,3.3]]);
    wall("x", -16, -5, 9, [[1,6,0,3.3]]);
    wall("x", -16, 15, 27, [[20,25,0,3.3]]);
    // Real opaque ceiling; no ceiling geometry is registered as a walkable floor.
    box(0, 4.56, -8, 54.7, 0.42, 40.7, mat.concrete, true, "Office ceiling", false);
    surface(0, -8, 54, 40, mat.ceiling, 4.342, true);
    for (const x of [-20,-11,1,12,21]) for (const z of [-22,-10,-2,6]) fluorescent(x, z, x === 12 ? 0.8 : 2.3, x === 12 ? 2.7 : 0.72);
    for (const x of [-19,-9,1,12,22]) {
      box(x, 4.318, -8, 0.045, 0.025, 40, mat.metal);
    }
    // A second-storey facade gives the exterior its recognizable office-block silhouette.
    for (const z of [-28.05,12.05]) {
      box(0, 7.6, z, 55, 5.7, 0.48, mat.brick, true, "Upper facade", false, true);
      box(0, 4.89, z, 55.5, 0.25, 0.72, mat.concrete);
      box(0, 10.3, z, 55.8, 0.3, 0.86, mat.trim);
      for (let x = -23; x <= 23; x += 7.7) upperWindow(x, z, 0, z > 0 ? 1 : -1);
    }
    for (const x of [-27.05,27.05]) {
      box(x, 7.6, -8, 0.48, 5.7, 40, mat.brick, true, "Upper facade", false, true);
      box(x, 4.89, -8, 0.72, 0.25, 40.7, mat.concrete);
      box(x, 10.3, -8, 0.86, 0.3, 40.7, mat.trim);
      for (const z of [-23,-15,-7,2,9]) upperWindow(x, z, Math.PI / 2, x > 0 ? 1 : -1);
    }
    box(0, 10.45, -8, 55.4, 0.3, 41.4, mat.snowBank, true, "Office upper roof", false, false);
    for (const [x,z,w,d] of [[-13,-15,8,5],[15,-19,7,4]]) {
      box(x, 11.3, z, w, 1.4, d, mat.metal); box(x, 12.04, z, w + 0.1, 0.12, d + 0.1, mat.snowBank);
      for (let i = -2; i <= 2; i++) box(x + i * 1.05, 11.4, z + d / 2 + 0.012, 0.55, 0.95, 0.045, mat.dark);
    }
    // Entrance canopy and address, supported at its outer corners.
    box(1, 3.72, 14.2, 10.5, 0.3, 4.3, mat.teal, true, "Entrance canopy", false);
    box(1, 3.92, 14.2, 10.7, 0.13, 4.45, mat.snowBank);
    for (const x of [-3.8,5.8]) box(x, 1.78, 15.7, 0.19, 3.56, 0.19, mat.metal, true, "Entrance post");
    label("ADDRESS", 1, 4.75, 12.56, 6.8, 0.72);
    box(1, 5.51, 12.47, 7.9, 0.82, 0.16, mat.dark);
    label("OFFICE", 1, 5.51, 12.56, 7.7, 0.70);
    label("RECEPTION", 1, 3.75, 1.235, 4.4, 0.58);
    label("DIRECTORY", 7.72, 2.15, 11.755, 1.32, 1.76, Math.PI);
    label("EXIT", 1, 3.75, 11.75, 1.2, 0.36, Math.PI);
    label("HALL", -21, 3.74, -4.75, 4.8, 0.58);
    label("MEETING", 9.245, 3.7, -22, 3.5, 0.48, Math.PI / 2);
    label("SERVER", 14.755, 3.72, -22, 2.8, 0.48, -Math.PI / 2);
    label("BREAK", 14.755, 3.7, 6, 2.8, 0.48, -Math.PI / 2);
    label("EXIT", -26.755, 3.65, -9.5, 1.2, 0.36, Math.PI / 2);
  }
  function upperWindow(x, z, yaw, side) {
    const sideX = yaw ? side : 0, sideZ = yaw ? 0 : side;
    const wx = yaw ? 0.1 : 4.9, wz = yaw ? 4.9 : 0.1;
    box(x + sideX * 0.30, 7.37, z + sideZ * 0.30, wx, 2.8, wz, mat.dark);
    box(x + sideX * 0.36, 7.4, z + sideZ * 0.36, yaw ? 0.05 : 4.62, 2.52, yaw ? 4.62 : 0.05, mat.glass);
    box(x + sideX * 0.405, 7.4, z + sideZ * 0.405, yaw ? 0.06 : 0.1, 2.55, yaw ? 0.1 : 0.06, mat.metal);
    box(x + sideX * 0.43, 7.03, z + sideZ * 0.43, yaw ? 0.055 : 4.64, 0.07, yaw ? 4.64 : 0.055, mat.metal);
    box(x + sideX * 0.46, 5.95, z + sideZ * 0.46, yaw ? 0.5 : 5.2, 0.16, yaw ? 5.2 : 0.5, mat.trim);
    box(x + sideX * 0.48, 6.08, z + sideZ * 0.48, yaw ? 0.46 : 5.15, 0.1, yaw ? 5.15 : 0.46, mat.snowBank);
  }
  function fluorescent(x, z, w = 2.2, d = 0.7, y = 4.29) {
    box(x, y, z, w + 0.14, 0.10, d + 0.12, mat.metal);
    box(x, y - 0.057, z, w, 0.022, d, mat.tube);
    for (const q of [-0.32,0,0.32]) box(x + w * q, y - 0.075, z, 0.032, 0.018, d, mat.white);
  }

  function localBox(x, z, yaw, lx, y, lz, w, h, d, material, shadow = false) {
    const px = x + Math.cos(yaw) * lx + Math.sin(yaw) * lz;
    const pz = z - Math.sin(yaw) * lx + Math.cos(yaw) * lz;
    instance(boxGeo, material, px, y, pz, w, h, d, 0, yaw, 0, shadow);
  }
  function desk(x, z, yaw = 0, computer = true) {
    localBox(x,z,yaw,0,0.81,0,2.5,0.13,1.28,mat.wood);
    for (const dx of [-1.02,1.02]) localBox(x,z,yaw,dx,0.39,0,0.16,0.78,1.08,mat.metal);
    localBox(x,z,yaw,0.76,0.49,0.03,0.56,0.62,0.98,mat.plastic);
    for (const y of [0.34,0.53,0.72]) localBox(x,z,yaw,0.76,y,0.531,0.23,0.025,0.025,mat.metal);
    collider(x,0.43,z,2.52,0.86,1.3,yaw,"Office desk");
    if (computer) {
      localBox(x,z,yaw,-0.30,0.95,-0.23,0.52,0.12,0.45,mat.plastic);
      localBox(x,z,yaw,-0.30,1.26,-0.24,0.83,0.62,0.59,mat.plastic);
      collider(x - Math.cos(yaw) * 0.30 - Math.sin(yaw) * 0.24,1.26,
        z + Math.sin(yaw) * 0.30 - Math.cos(yaw) * 0.24,0.83,0.62,0.59,yaw,"Computer monitor",false);
      localBox(x,z,yaw,-0.30,1.29,0.064,0.69,0.43,0.03,mat.dark);
      const sx = x + Math.cos(yaw) * -0.30 + Math.sin(yaw) * 0.083;
      const sz = z - Math.sin(yaw) * -0.30 + Math.cos(yaw) * 0.083;
      label("MONITOR", sx,1.29,sz,0.64,0.38,yaw);
      localBox(x,z,yaw,-0.30,0.91,0.35,0.73,0.06,0.27,mat.plastic);
      for (let row = 0; row < 3; row++) for (let col = 0; col < 7; col++)
        localBox(x,z,yaw,-0.57 + col * 0.087,0.944,0.27 + row * 0.069,0.053,0.01,0.037,mat.metal);
      localBox(x,z,yaw,0.37,0.925,0.32,0.15,0.08,0.23,mat.plastic);
      localBox(x,z,yaw,-0.91,0.25,-0.08,0.30,0.5,0.60,mat.plastic);
    } else localBox(x,z,yaw,-0.3,0.9,0.1,0.68,0.07,0.43,mat.paper);
    const cx = x + Math.sin(yaw) * 1.31, cz = z + Math.cos(yaw) * 1.31;
    chair(cx,cz,yaw);
  }
  function chair(x, z, yaw = 0) {
    localBox(x,z,yaw,0,0.5,0,0.72,0.15,0.70,mat.blue);
    localBox(x,z,yaw,0,0.91,0.31,0.72,0.74,0.14,mat.blue);
    cylinder(x,0.25,z,0.06,0.48,mat.metal);
    localBox(x,z,yaw,0,0.10,0,0.76,0.06,0.08,mat.dark);
    localBox(x,z,yaw,0,0.10,0,0.08,0.06,0.76,mat.dark);
    collider(x,0.62,z,0.77,1.24,0.78,yaw,"Office chair");
  }
  function cabinet(x, z, yaw = 0, width = 1.0) {
    localBox(x,z,yaw,0,0.82,0,width,1.64,0.6,mat.dado);
    for (let i = 0; i < 4; i++) {
      localBox(x,z,yaw,0,0.23 + i * 0.39,0.31,width - 0.08,0.34,0.035,mat.plastic);
      localBox(x,z,yaw,0,0.31 + i * 0.39,0.335,width * 0.27,0.037,0.04,mat.dark);
      localBox(x,z,yaw,0,0.21 + i * 0.39,0.337,width * 0.26,0.07,0.014,mat.paper);
    }
    collider(x,0.82,z,width,1.64,0.67,yaw,"Filing cabinet");
  }
  function sofa(x, z, yaw = 0, width = 3.1) {
    localBox(x,z,yaw,0,0.28,0,width,0.43,0.98,mat.dark);
    localBox(x,z,yaw,0,0.54,0.05,width - 0.30,0.19,0.85,mat.teal);
    localBox(x,z,yaw,0,0.94,-0.39,width,0.85,0.23,mat.teal);
    for (const dx of [-1,1]) localBox(x,z,yaw,dx * (width / 2 - 0.1),0.72,0,0.22,0.6,1.03,mat.teal);
    for (let i = 1; i < 3; i++) localBox(x,z,yaw,(i / 3 - 0.5) * (width - 0.3),0.65,0.05,0.02,0.018,0.80,mat.dark);
    collider(x,0.7,z,width,1.4,1.06,yaw,"Office sofa");
  }
  function plant(x, z) {
    cylinder(x,0.31,z,0.34,0.6,mat.woodDark);
    cylinder(x,0.58,z,0.36,0.12,mat.ochre); cylinder(x,0.89,z,0.044,0.65,mat.woodDark);
    for (let i = 0; i < 7; i++) {
      const a = i * 2.399; ellipsoid(x + Math.cos(a) * 0.27,1.18 + i % 3 * 0.16,z + Math.sin(a) * 0.27,0.32,0.18,0.28,mat.leaf);
    }
    collider(x,0.65,z,0.78,1.3,0.78,0,"Planter");
  }
  function wasteBin(x, z) {
    cylinder(x,0.3,z,0.25,0.58,mat.metal);
    cylinder(x,0.6,z,0.26,0.035,mat.dark);
    box(x,0.615,z,0.18,0.04,0.15,mat.paper);
  }
  function copier(x, z) {
    box(x,0.57,z,1.55,1.14,1.04,mat.plastic,true,"Photocopier");
    box(x,1.16,z,1.58,0.11,1.08,mat.dark,true,"Photocopier top",false,false);
    box(x - 0.12,1.26,z - 0.04,1.23,0.11,0.78,mat.white,true,"Photocopier lid",false,false);
    box(x + 0.53,1.35,z + 0.36,0.36,0.13,0.30,mat.blue,true,"Photocopier control panel",false,false);
    for (const y of [0.24,0.61]) { box(x,y,z + 0.532,1.40,0.035,0.025,mat.metal); box(x,y + 0.10,z + 0.56,0.41,0.04,0.04,mat.dark); }
    box(x - 0.81,0.88,z,0.42,0.07,0.78,mat.metal);
    box(x - 0.86,0.94,z,0.36,0.06,0.61,mat.paper);
  }
  function coffeeTable(x, z, w = 2.7, d = 1.25) {
    box(x,0.53,z,w,0.12,d,mat.wood,true,"Low office table");
    for (const dx of [-1,1]) for (const dz of [-1,1]) box(x + dx * (w / 2 - 0.12),0.25,z + dz * (d / 2 - 0.12),0.10,0.5,0.10,mat.metal);
    box(x - 0.3,0.61,z,0.52,0.045,0.38,mat.paper);
  }
  function furnishOffices() {
    // Front office: two facing desk islands and clear circulation around all four sides.
    for (const x of [-22,-14]) { desk(x,5,0); desk(x,3.5,Math.PI); }
    for (const x of [-24.5,-23.4,-22.3]) cabinet(x,1.66,0);
    copier(-9.4,10.1); plant(-24.9,10.4);
    label("MONDAYS", -26.745,2.55,2.95,1.75,1.20,Math.PI / 2);
    label("LANDSCAPE", -12.2,2.66,1.257,2.25,1.26);

    // Reception desk is offset from the front door's main line of movement.
    box(-4.05,0.63,7.9,3.4,1.26,1.3,mat.woodDark,true,"Reception counter");
    box(-4.05,1.31,7.9,3.6,0.13,1.48,mat.wood);
    for (const x of [-5.2,-4.05,-2.9]) box(x,0.70,8.566,0.055,0.94,0.025,mat.ochre);
    box(-4.2,1.50,7.8,0.76,0.40,0.21,mat.dark);
    chair(-4.1,6.5,Math.PI); plant(7.5,10.2);
    sofa(5.8,2.1,0,3.7); coffeeTable(5.8,4.3,2.7,1.05);
    label("LOGO", -6.744,2.85,9.6,2.35,1.18,Math.PI / 2);
    label("LANDSCAPE", 5.9,2.5,1.256,2.9,1.30);

    // West staff lounge and rear desks connect through two separate doorways.
    sofa(-21.5,-14.7,0,4.2); coffeeTable(-21.5,-12.55,3,1.25);
    sofa(-7,-13.6,-Math.PI / 2,3.0); plant(-25,-14.2);
    label("ACHIEVE", -15,2.60,-15.75,2.15,1.36);
    label("BOARD", -6.05,2.52,-5.25,1.6,1.2,Math.PI);
    for (const x of [-22.1,-15]) for (const z of [-23.0,-19.9]) desk(x,z,z < -21 ? Math.PI : 0);
    for (const x of [-12,-10.8,-9.6]) cabinet(x,-27.25,0);
    box(-8,0.38,-26.6,1.1,0.76,1.02,mat.ochre,true,"Archive cartons");
    box(-8.08,1.00,-26.62,0.9,0.48,0.85,mat.wood);
    label("TEAM", -12,2.7,-27.75,2.4,1.25);

    // Central meeting lounge and the iconic projection room.
    sofa(-3.75,-13.5,Math.PI / 2,3.5); coffeeTable(-1.6,-13.5,1.15,2.5);
    cabinet(6.2,-5.8,Math.PI,1.2); cabinet(7.6,-5.8,Math.PI,1.2);
    plant(7.45,-14.35); label("LANDSCAPE", -1.5,2.5,-15.75,3.0,1.5);
    box(2.0,0.79,-22,3.05,0.16,6.30,mat.wood,true,"Conference table");
    box(2,0.39,-22,1.7,0.78,4.7,mat.woodDark,true,"Conference table base");
    for (const z of [-24.4,-22,-19.6]) { chair(-0.25,z,Math.PI / 2); chair(4.25,z,-Math.PI / 2); }
    box(2,3.54,-22.0,0.38,1.56,0.07,mat.metal);
    box(2,2.79,-22,0.67,0.24,0.57,mat.plastic);
    cylinder(2,2.79,-22.34,0.075,0.14,mat.glass,Math.PI / 2);
    box(2,2.63,-27.68,6.5,2.8,0.12,mat.dark);
    label("PROJECTOR",2,2.63,-27.597,6.2,2.55);
    for (const x of [1.3,2.6]) box(x,0.907,-20.5,0.42,0.04,0.32,mat.paper);
    cabinet(-3.8,-17,Math.PI,1.1);

    // Service wing: readable rack silhouettes, copier, folders, and a kitchenette.
    for (const x of [17.3,19.1,20.9,22.7,24.5]) {
      box(x,1.17,-26.5,1.25,2.34,1.28,mat.dark,true,"Server rack");
      for (let row = 0; row < 6; row++) {
        box(x,0.28 + row * 0.33,-25.844,1.08,0.23,0.035,mat.metal);
        for (let k = 0; k < 3; k++) box(x - 0.35 + k * 0.08,0.29 + row * 0.33,-25.818,0.026,0.025,0.016,mat.indicator);
      }
    }
    desk(24.9,-18,Math.PI,false); label("SERVER",20.9,3.78,-27.75,2.8,0.6);
    copier(17,-14.2);
    for (const x of [16.5,17.6,18.7]) cabinet(x,-5.78,Math.PI);
    box(25.45,0.62,-14.0,1.4,1.24,1.35,mat.wood,true,"Paper storage");
    for (let i=0;i<4;i++) box(25.45,1.31 + i*0.065,-14.0,0.76,0.058,0.65,mat.paper);
    label("BOARD",18,2.70,-15.75,2.8,1.30);
    vendingMachine(24.7,10.93,"VENDING"); vendingMachine(22.65,10.93,"SNACKS");
    box(25.9,0.48,4,1.10,0.96,4.4,mat.wood,true,"Kitchen units");
    box(25.85,1.01,4,1.27,0.10,4.55,mat.trim);
    box(25.9,1.074,3.6,0.77,0.036,0.8,mat.metal); cylinder(26.05,1.23,3.25,0.025,0.31,mat.metal);
    box(25.86,1.35,5.4,0.72,0.58,0.69,mat.plastic);
    box(25.485,1.35,5.4,0.018,0.4,0.47,mat.dark);
    coffeeTable(19.2,7.2,2.3,1.4); chair(19.2,8.45,0); chair(19.2,5.92,Math.PI);
    label("COFFEE",26.74,2.46,2.6,1.5,1.10,-Math.PI / 2);
    // Details sit against walls, with no small snags in the main movement lanes.
    for (const [x,z] of [[-8.5,9.8],[-24.9,-26],[7.4,-26],[25.5,2.1]]) wasteBin(x,z);
    for (const x of [-24,-6,18]) {
      box(x,1.38,-4.71,0.25,0.75,0.23,mat.red);
      box(x,1.82,-4.71,0.11,0.12,0.07,mat.dark);
    }
    for (const [x,z] of [[1,6],[2,-22],[-18,-21]]) {
      const light = new THREE.PointLight(0xffead0,8,10,2); light.position.set(x,3.8,z); root.add(light);
    }
  }
  function vendingMachine(x, z, kind) {
    box(x,1.12,z,1.6,2.24,0.90,kind === "SNACKS" ? mat.dark : mat.blue,true,"Vending machine");
    label(kind,x,1.33,z-0.465,1.4,1.68,Math.PI);
    box(x,0.3,z-0.48,0.8,0.22,0.03,mat.dark);
  }

  function createGarage() {
    wall("x",15,-45,-23,[[-42,-36,0,3.8]]);
    wall("x",41,-45,-23,[[-40,-29,0,3.8]]);
    wall("z",-45,15,41);
    wall("z",-23,15,41,[[22,32,0,3.85]]);
    box(-34,4.49,28,23,0.28,27,mat.concrete,true,"Garage roof",false);
    box(-34,4.69,28,23.3,0.18,27.3,mat.snowBank);
    for (const x of [-42,-34,-26]) fluorescent(x,28,0.6,3.3,4.29);
    for (const x of [-41,-34,-27]) box(x,4.01,28,0.24,0.50,25.6,mat.concrete);
    for (const [x,z] of [[-43,21],[-25,37]]) {
      box(x,1.8,z,0.78,3.6,0.78,mat.concrete,true,"Garage support");
      box(x,0.66,z,0.81,1.3,0.81,mat.ochre);
      for (const y of [0.22,0.55,0.88]) box(x, y, z + 0.415,0.78,0.15,0.016,mat.dark);
    }
    for (const z of [20,27,34,39]) box(-39,0.026,z,10,0.015,0.11,mat.ochre);
    sedan(-38,30); dumpster(-27.6,18.3);
    label("PARKING",-22.75,4.13,27,4.0,0.34,Math.PI/2);
    label("GARAGE",-34.5,4.15,41.25,7.5,0.30);
    label("EXIT",-39,4.14,15.23,1.1,0.26);
    label("P1",-44.75,2.75,28,1.6,1.20,Math.PI/2);
    box(-44.65,2.4,36,0.20,1.9,1.3,mat.metal);
    for (const z of [35.7,36.3]) box(-44.5,2.4,z,0.11,1.68,0.06,mat.dark);
  }
  function sedan(x,z) {
    box(x,0.63,z,2.18,0.62,4.8,mat.teal);
    box(x,1.15,z-0.3,1.85,0.63,2.3,mat.glass);
    box(x,1.5,z-0.4,1.88,0.14,2.10,mat.teal);
    for (const dx of [-0.92,0.92]) {
      box(x+dx,1.22,z-0.4,0.11,0.64,0.12,mat.teal);
      for (const dz of [-1.55,1.45]) {
        cylinder(x+dx*1.15,0.43,z+dz,0.43,0.22,mat.tire,0,Math.PI/2);
        cylinder(x+dx*1.29,0.43,z+dz,0.21,0.035,mat.metal,0,Math.PI/2);
      }
    }
    box(x,0.53,z+2.44,2.20,0.16,0.12,mat.metal);
    for (const dx of [-0.76,0.76]) box(x+dx,0.85,z+2.411,0.43,0.22,0.035,mat.warmTube);
    collider(x,0.80,z,2.34,1.60,4.95,0,"Parked car");
  }
  function van(x,z) {
    box(x,0.94,z,2.5,1.42,5.7,mat.white);
    box(x,2.02,z-0.6,2.45,1.15,4.1,mat.white);
    box(x,1.89,z+1.83,2.16,0.86,1.02,mat.glass);
    box(x,2.4,z+1.49,2.4,0.15,1.9,mat.white);
    box(x,1.30,z+2.20,2.43,0.26,1.1,mat.white);
    for (const dx of [-1.21,1.21]) {
      box(x+dx,1.07,z+1.2,0.045,0.07,0.29,mat.dark);
      box(x+dx,1.23,z-0.6,0.024,1.67,0.035,mat.metal);
      for (const dz of [-1.87,1.67]) {
        cylinder(x+dx,0.47,z+dz,0.47,0.23,mat.tire,0,Math.PI/2);
        cylinder(x+dx*1.108,0.47,z+dz,0.24,0.025,mat.metal,0,Math.PI/2);
      }
    }
    box(x,0.49,z+2.94,2.48,0.18,0.16,mat.dark);
    box(x,0.91,z+2.87,1.18,0.31,0.04,mat.dark);
    for (const dx of [-0.9,0.9]) box(x+dx,1.05,z+2.878,0.41,0.31,0.05,mat.warmTube);
    box(x,2.63,z-0.45,2.35,0.09,3.8,mat.snowBank);
    collider(x,1.33,z,2.66,2.66,5.94,0,"Snow-covered delivery van");
  }
  function dumpster(x,z) {
    box(x,0.77,z,2.75,1.46,1.60,mat.teal,true,"Service dumpster");
    box(x,1.54,z,2.93,0.16,1.76,mat.dark);
    box(x,1.65,z,2.89,0.08,1.72,mat.snowBank);
    for (const dx of [-0.94,0.94]) box(x+dx,0.18,z,0.16,0.32,1.73,mat.metal);
    for (const dx of [-0.9,0,0.9]) box(x+dx,0.83,z+0.825,0.06,1.1,0.04,mat.metal);
  }
  function createExterior() {
    van(14.5,28); dumpster(33,-19.5); dumpster(-34.5,-3.2);
    // Shallow planters divide the courtyard without sealing the front approach.
    for (const [x,z,w,d] of [[-11,18.7,10,2.1],[15,18.7,9,2.1],[39,-4,3,8]]) {
      box(x,0.38,z,w,0.76,d,mat.concrete,true,"Courtyard planter");
      box(x,0.81,z,w+0.12,0.12,d+0.12,mat.trim);
      box(x,0.90,z,w-0.16,0.10,d-0.15,mat.snowBank);
      for (const dx of [-0.27,0.27]) ellipsoid(x+dx*w,1.17,z,w*0.18,0.37,d*0.42,mat.leaf);
      for (const dx of [-0.27,0.27]) ellipsoid(x+dx*w,1.36,z,w*0.18,0.15,d*0.39,mat.snowBank);
    }
    // Thin boundary walls use the original world extents and navigation clearance.
    for (const x of [-47,47]) {
      box(x,1.6,0,1,3.2,96,mat.brickDark,true,"Site boundary");
      box(x,3.27,0,1.14,0.15,96,mat.snowBank);
    }
    for (const z of [-47,47]) {
      box(0,1.6,z,96,3.2,1,mat.brickDark,true,"Site boundary");
      box(0,3.27,z,96,0.15,1.14,mat.snowBank);
    }
    for (const [x,z] of [[-33,-39],[35,-39],[39,39]]) {
      box(x,2.60,z,0.18,5.2,0.18,mat.metal,true,"Courtyard lamp");
      box(x,5.16,z,1.6,0.16,0.42,mat.metal);
      box(x,5.06,z,1.48,0.028,0.33,mat.warmTube);
    }
    // Tire marks and ploughed strips sit above the base floor, with no coplanar overlays.
    for (const x of [11.9,17.1]) surface(x,37.1,0.31,10,mat.ice,0.028);
    for (const z of [23.3,25]) surface(1, z, 48,0.19,mat.ice,0.028);
    for (const [x,z] of [[-42,-41],[-36,-41],[-30,-41],[41,-41],[41,43],[30,43],[-12,43],[0,43]])
      ellipsoid(x,0.05,z,4.2,0.36,1.5,mat.snowBank);
    // Office's snowman court is an orientation landmark, not an enemy spawn platform.
    snowman(-37.8,-19.5);
    for (const x of [-43,-31]) {
      box(x,0.62,-25.5,3.6,0.14,0.8,mat.wood,true,"Courtyard bench");
      box(x,1.06,-25.86,3.6,0.70,0.13,mat.wood);
      for (const dx of [-1.3,1.3]) box(x+dx,0.3,-25.5,0.12,0.6,0.68,mat.metal);
      box(x,0.73,-25.5,3.6,0.07,0.78,mat.snowBank);
    }
    label("DELIVERIES",27.39,3.75,-9.5,4.5,0.55,Math.PI/2);
    label("OFFICE",-27.40,3.75,-9.5,5.6,0.52,-Math.PI/2);
    // Grounded utility equipment occupies the boundary edges, clear of door approaches.
    for (const x of [1,4.2]) {
      box(x,1.09,-40.5,2.6,2.18,1.45,mat.metal,true,"Service equipment");
      for (let k=0;k<7;k++) box(x,0.43+k*0.20,-39.76,2.25,0.065,0.04,mat.dark);
      box(x,2.25,-40.5,2.7,0.15,1.55,mat.snowBank);
    }
    for (const [x,z] of [[34,1],[-32,9],[-9,-32]]) {
      box(x,0.65,z,1.15,1.3,1.1,mat.wood,true,"Delivery crate");
      box(x,1.36,z,1.22,0.12,1.16,mat.snowBank);
      for (const dx of [-0.47,0.47]) box(x+dx,0.65,z+0.56,0.12,1.24,0.055,mat.woodDark);
    }
  }
  function snowman(x,z) {
    ellipsoid(x,0.66,z,0.81,0.76,0.78,mat.snowBank);
    ellipsoid(x,1.58,z,0.58,0.61,0.56,mat.snowBank);
    ellipsoid(x,2.30,z,0.40,0.43,0.40,mat.snowBank);
    cylinder(x,2.69,z,0.53,0.09,mat.dark); cylinder(x,2.91,z,0.34,0.40,mat.dark);
    cylinder(x,1.99,z,0.44,0.12,mat.red);
    box(x+0.22,1.73,z+0.53,0.16,0.6,0.06,mat.red);
    for (const dx of [-0.14,0.14]) ellipsoid(x+dx,2.40,z+0.355,0.045,0.045,0.03,mat.dark);
    instance(coneGeo,mat.ochre,x,2.25,z+0.51,0.08,0.36,0.08,Math.PI/2);
    for (const y of [1.34,1.65]) ellipsoid(x,y,z+0.555,0.055,0.055,0.03,mat.dark);
    for (const side of [-1,1]) {
      instance(cylinderGeo,mat.woodDark,x+side*0.85,1.72,z,0.042,1.05,0.042,0,0,side*0.94);
      instance(cylinderGeo,mat.woodDark,x+side*1.23,2.02,z,0.024,0.36,0.024,0,0,side*0.4);
    }
    collider(x,1.0,z,1.5,2.0,1.5,0,"Snowman");
  }
  function pine(x,z,h) {
    cylinder(x,h*0.34,z,0.22,h*0.68,mat.woodDark);
    for (let layer=0;layer<4;layer++) {
      const r=h*(0.23-layer*0.043), y=h*(0.33+layer*0.18), height=h*0.40;
      instance(coneGeo,mat.leaf,x,y,z,r,height,r);
      instance(coneGeo,mat.snowBank,x,y+height*0.125,z,r*0.78,height*0.77,r*0.78);
    }
  }
  function createBackdrop() {
    // These are unoccupied backdrop buildings: no gameplay colliders or expensive lights.
    for (const [x,z,w,d,h] of [[-61,-20,18,36,20],[-60,30,17,29,14],[62,23,20,42,22],[24,-65,40,24,21],[-27,-64,28,22,15],[58,-43,20,26,30],[8,66,62,20,14]]) {
      box(x,h/2,z,w,h,d,mat.brickDark);
      box(x,h+0.15,z,w+0.5,0.3,d+0.5,mat.snowBank);
      // Only the inward-facing elevation gets windows.
      const alongX = Math.abs(z) > Math.abs(x), span = alongX ? w : d, count=Math.floor(span/4.2);
      for (let row=0;row<Math.floor(h/3.6)-1;row++) for (let i=0;i<count;i++) {
        const offset=(i+0.5)*span/count-span/2, faceX=alongX?x+offset:x-Math.sign(x)*(w/2+0.025);
        const faceZ=alongX?z-Math.sign(z)*(d/2+0.025):z+offset;
        box(faceX,4.5+row*3.6,faceZ,alongX?1.5:0.08,1.9,alongX?0.08:1.5,mat.glass);
      }
    }
    for (const [x,z,h] of [[-51,-39,12],[-52,-9,15],[-51,5,11],[51,-31,12],[52,-15,16],[52,5,13],[-37,-51,11],[-13,-51,14],[8,-51,12],[36,-52,15],[-28,52,12],[34,53,13]]) pine(x,z,h);
    // A broad non-colliding snow apron hides the playable ground's square edges.
    surface(0,0,210,210,mat.snow,-0.09);
  }
  function createSky() {
    const settings = WORLD_SETTINGS.sky;
    scene.background=new THREE.Color(settings.fogColor); scene.fog=new THREE.Fog(settings.fogColor,settings.fogNear,settings.fogFar);
    const geo=new THREE.SphereGeometry(450,24,12), colors=[], position=geo.attributes.position;
    const top=new THREE.Color(settings.top), mid=new THREE.Color(settings.mid), horizon=new THREE.Color(settings.horizon), color=new THREE.Color();
    for (let i=0;i<position.count;i++) {
      const t=Math.max(0,position.getY(i)/450);
      color.copy(t<0.26?horizon:mid).lerp(t<0.26?mid:top,t<0.26?t/0.26:(t-0.26)/0.74);
      colors.push(color.r,color.g,color.b);
    }
    geo.setAttribute("color",new THREE.Float32BufferAttribute(colors,3));
    const dome=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.BackSide,depthWrite:false,fog:false}));
    dome.name="Overcast winter sky"; dome.renderOrder=-1000; scene.add(dome);
    // Overcast sky has no visible sun/moon disk to disagree with the game's light direction.
  }
  function createSnow() {
    const points=[];
    snowFloor=new Float32Array(220);
    // Resolve actual visible tops once, after instancing and world matrices exist.
    // Snow then recycles above canopies, vehicles and snow-covered props.
    const surfaces=root.children.filter(object=>object.isMesh && object.material.visible!==false);
    const ray=new THREE.Raycaster(new THREE.Vector3(),new THREE.Vector3(0,-1,0),0,18);
    for (let i=0;i<220;i++) {
      let x,z;
      do { x=(random()-0.5)*90; z=(random()-0.5)*90; }
      while ((x>-28 && x<28 && z>-29 && z<13) || (x>-46 && x<-22 && z>14 && z<42));
      ray.ray.origin.set(x,16,z);
      const hit=ray.intersectObjects(surfaces,false)[0];
      snowFloor[i]=(hit?hit.point.y:0)+0.04;
      points.push(x,snowFloor[i]+random()*(13.3-snowFloor[i]),z);
    }
    const geo=new THREE.BufferGeometry();
    geo.setAttribute("position",new THREE.Float32BufferAttribute(points,3).setUsage(THREE.DynamicDrawUsage));
    const flake=canvasTexture(32,32,ctx=>{
      const gradient=ctx.createRadialGradient(16,16,0,16,16,15);
      gradient.addColorStop(0,"rgba(255,255,255,1)");gradient.addColorStop(0.45,"rgba(255,255,255,0.9)");gradient.addColorStop(1,"rgba(255,255,255,0)");
      ctx.fillStyle=gradient;ctx.fillRect(0,0,32,32);
    });
    snow=new THREE.Points(geo,new THREE.PointsMaterial({map:flake,color:0xf4f7f8,size:0.065,transparent:true,opacity:0.78,depthWrite:false}));
    snow.name="Outdoor snowfall"; snow.frustumCulled=false; root.add(snow);
  }
  function update(delta) {
    const a=snow.geometry.attributes.position;
    for (let i=1;i<a.array.length;i+=3) {
      a.array[i]-=Math.min(delta,0.05)*0.8;
      const bottom=snowFloor[(i-1)/3];
      if (a.array[i]<bottom) a.array[i]+=13.3-bottom;
    }
    a.needsUpdate=true;
  }

  function createLabels() {
    const definitions = {
      ADDRESS:["52375","", "#e0ded1","#343f44"],
      OFFICE:["OFFICE COMPLEX","NORTH CAMPUS", "#344c56","#e7e6d8"],
      RECEPTION:["RECEPTION","OFFICES  /  MEETING ROOMS", "#38565d","#e8e7d9"],
      DIRECTORY:["DIRECTORY","RECEPTION  ·  01", "#d7d9ce","#364d54"],
      EXIT:["EXIT  →","", "#366857","#e8f0dd"],
      HALL:["←  OFFICES     MEETING ROOMS  →","", "#3f5d65","#e5e8dc"],
      MEETING:["MEETING ROOM","02", "#3f5d65","#e5e8dc"],
      SERVER:["SERVER ROOM","AUTHORIZED PERSONNEL", "#3f5d65","#e5e8dc"],
      BREAK:["BREAK ROOM","", "#3f5d65","#e5e8dc"],
      LOGO:["NORTHPOINT","BUSINESS CENTER", "#d2cfbc","#34565e"],
      MONDAYS:["MONDAYS","A FRESH START.", "#1e3945","#e9e2c7"],
      ACHIEVE:["ACHIEVE","ONE STEP AT A TIME", "#314f60","#ede6ce"],
      TEAM:["TEAMWORK","BETTER TOGETHER", "#455b5e","#ede6ce"],
      LANDSCAPE:["","", "#667f8b","#e4e5d4"],
      BOARD:["OFFICE NOTICEBOARD","", "#9a8569","#f0ead4"],
      MONITOR:["NORTHPOINT / WORKSTATION","", "#294c68","#9cd0db"],
      PROJECTOR:["QUARTERLY REVIEW","NORTHPOINT   /   MEETING ROOM 02", "#e2e6d8","#2d5367"],
      VENDING:["ICE COLD","REFRESHMENTS", "#286986","#e4ece4"],
      SNACKS:["SNACKS","TAKE A BREAK", "#34434b","#e5e2cd"],
      COFFEE:["COFFEE","IS ALWAYS A GOOD IDEA", "#5d4c3b","#f0e6c8"],
      PARKING:["PARKING  P1","OFFICE ACCESS  →", "#465a65","#e5e6d6"],
      GARAGE:["PARKING / CLEARANCE 3.8 m","", "#4c595c","#e4dec3"],
      P1:["P1","PARKING", "#3a617a","#e7e9db"],
      DELIVERIES:["DELIVERIES","SERVICE ENTRANCE", "#465c62","#e9e8db"]
    };
    const names=Object.keys(definitions), uvGeometries=new Map();
    const texture=canvasTexture(2048,2048,(ctx)=>{
      names.forEach((key,i)=>{
        ctx.save(); ctx.translate(i%4*512,Math.floor(i/4)*256);
        const [title,sub,bg,fg]=definitions[key]; ctx.fillStyle=bg; ctx.fillRect(0,0,512,256);
        ctx.strokeStyle=fg; ctx.globalAlpha=0.28; ctx.lineWidth=3; ctx.strokeRect(9,9,494,238); ctx.globalAlpha=1;
        if (["MONDAYS","ACHIEVE","TEAM","LANDSCAPE"].includes(key)) {
          const gradient=ctx.createLinearGradient(0,25,0,210); gradient.addColorStop(0,"#9bb1b3"); gradient.addColorStop(1,"#d4cfc0");
          ctx.fillStyle=gradient; ctx.fillRect(28,25,456,170);
          for (let j=0;j<3;j++) {
            ctx.fillStyle=["#758f96","#4c707b","#36515e"][j]; ctx.beginPath(); ctx.moveTo(28,192);
            for (let k=0;k<9;k++) ctx.lineTo(28+k*57,80+j*28+(k%3)*18);
            ctx.lineTo(484,195); ctx.closePath(); ctx.fill();
          }
          if (key==="LANDSCAPE") {ctx.restore();return;}
          ctx.fillStyle=bg; ctx.fillRect(0,175,512,81);
          ctx.textAlign="center"; ctx.fillStyle=fg; ctx.font="bold 31px Arial"; ctx.fillText(title,256,212,460);
          ctx.font="13px Arial"; ctx.fillText(sub,256,237,460);
        } else if (key==="PROJECTOR") {
          ctx.fillStyle="#355d72"; ctx.fillRect(0,0,512,59); ctx.fillStyle="#eceddf"; ctx.font="bold 25px Arial"; ctx.fillText(title,24,38);
          ctx.fillStyle="#8299a1"; ctx.fillRect(33,85,200,4);
          for (let k=0;k<6;k++) {ctx.fillStyle=k%2?"#668797":"#9eb5b8";ctx.fillRect(43+k*29,192-k*15,18,17+k*15);}
          ctx.strokeStyle="#9aaaa6"; ctx.beginPath();ctx.moveTo(33,98);ctx.lineTo(33,211);ctx.lineTo(235,211);ctx.stroke();
          ctx.fillStyle="#758e99";ctx.beginPath();ctx.arc(351,150,53,0,Math.PI*2);ctx.fill();
          ctx.fillStyle="#b7c6bb";ctx.beginPath();ctx.moveTo(351,150);ctx.arc(351,150,53,-Math.PI/2,0.6);ctx.closePath();ctx.fill();
          ctx.fillStyle="#55707c";ctx.font="12px Arial";ctx.fillText(sub,26,241);
        } else if (key==="MONITOR") {
          ctx.fillStyle="#83a6b5";ctx.fillRect(0,0,512,25);ctx.fillStyle="#d1e1dc";ctx.font="14px monospace";ctx.fillText(title,16,18);
          ctx.fillStyle="#adc2bc";ctx.fillRect(92,61,337,148);ctx.fillStyle="#446581";ctx.fillRect(96,65,329,22);
          for(let k=0;k<6;k++){ctx.fillStyle=k%2?"#9caeab":"#d0d8cb";ctx.fillRect(107,100+k*15,240-(k%3)*35,5);}
          ctx.fillStyle="#678795";ctx.fillRect(0,233,512,23);
        } else if (key==="BOARD") {
          for(let k=0;k<5;k++){ctx.fillStyle=k%2?"#d2dcb8":"#e8e3ca";ctx.fillRect(22+k*96,52+(k%2)*14,84,151-(k%3)*13);ctx.fillStyle="#586d73";for(let r=0;r<6;r++)ctx.fillRect(33+k*96,88+r*14,58,3);}
          ctx.fillStyle="#293f48";ctx.font="bold 21px Arial";ctx.fillText(title,24,31);
        } else if (key==="VENDING"||key==="SNACKS") {
          ctx.textAlign="center";ctx.fillStyle=fg;ctx.font="bold 52px Arial";ctx.fillText(title,256,57,445);
          for(let row=0;row<3;row++) for(let col=0;col<5;col++) {ctx.fillStyle=["#c29653","#b2c2a3","#a26044","#739bab","#d4ba6c"][(col+row)%5];ctx.fillRect(40+col*77,82+row*43,46,33);}
          ctx.fillStyle=fg;ctx.font="17px Arial";ctx.fillText(sub,256,237);
        } else if (key==="DIRECTORY") {
          ctx.textAlign="left";ctx.fillStyle=fg;ctx.font="bold 37px Arial";ctx.fillText(title,34,49);
          ["01   RECEPTION","02   MEETING ROOM","03   OFFICES","04   SERVER ROOM","05   BREAK ROOM"].forEach((t,i)=>{ctx.font="23px Arial";ctx.fillText(t,35,89+i*33);});
        } else {
          const ratios={ADDRESS:9.44,OFFICE:11.15,RECEPTION:7.59,EXIT:3.33,HALL:8.28,MEETING:7.29,SERVER:5.83,BREAK:5.83,LOGO:2,COFFEE:1.36,PARKING:7.14,GARAGE:15,P1:1.33,DELIVERIES:8.18};
          const vh=512/(ratios[key]||2);
          ctx.save();ctx.scale(1,256/vh);ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillStyle=fg;
          const font=Math.min(62,vh*(sub?0.39:0.6),456/(title.length*0.61));
          ctx.font=`bold ${font}px Arial`;ctx.fillText(title,256,vh*(sub?0.4:0.52),456);
          if(sub){ctx.font=`${Math.min(25,vh*0.2)}px Arial`;ctx.fillText(sub,256,vh*0.76,456);}
          ctx.restore();
        }
        ctx.restore();
      });
    });
    const material=new THREE.MeshBasicMaterial({map:texture});
    names.forEach((key,i)=>{
      const geo=new THREE.PlaneGeometry(1,1),uv=geo.attributes.uv;
      for(let j=0;j<uv.count;j++) uv.setXY(j,(i%4+uv.getX(j))/4,1-(Math.floor(i/4)+1-uv.getY(j))/8);
      uvGeometries.set(key,geo);
    });
    return {material,geometries:uvGeometries};
  }
  function label(key,x,y,z,w,h,yaw=0) {
    instance(labels.geometries.get(key),labels.material,x,y,z,w,h,1,0,yaw);
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
