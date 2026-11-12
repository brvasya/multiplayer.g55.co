// CS_MILITIA — procedural rocky compound, built for the supplied multiplayer world API.
// Layout (x east / z south, ground y=0, original 96-unit footprint):
// Zone                 Center x,z     Size w,d    Floor   Role
// House                   -6,-14         24,20       0    Connected interior / main landmark
// Attached garage         15,-14         18,20       0    Wide front and rear approach
// Front yard                1,15         58,30       0    Medium engagements / broken long views
// Rear yard                 0,-34        62,18       0    Rear doors / range / shed
// West sewer              -39,-1          9,66       0    Covered, three-entry flank
// East service lane        30,-1         10,61       0    Outdoor rotation past silos
// Player start              4,35                    1.75  Facing north (-z)
// Engagements: interiors 4–15, yards 15–35, selective outside lanes 40–60 units.
// The existing navigation is 2D. Upper rooms/roofs are scenery; the sewer is
// buried beneath the western ridge at ground level, with no ladders or drops.
// No environment downloads, renderer changes, or new gameplay/navigation rules.
export const WORLD_SETTINGS = {
  seed: 19990914, size: 96, spawn: [4, 1.75, 35], spawnYaw: 0,
  sky: { top: 0x739dbd, mid: 0xb6cbd5, horizon: 0xe4dfcd, fogColor: 0xc4c7b3, fogNear: 70, fogFar: 185 },
  lighting: {
    hemisphereSky: 0xd8e7f1, hemisphereGround: 0x777151, hemisphereIntensity: 1.65,
    sunColor: 0xffe5b1, sunIntensity: 2.35, sunPosition: [-35, 52, 28]
  }
};

export function createWorld({ THREE, scene }) {
  const root = new THREE.Group(); root.name = "CS_Militia"; scene.add(root);
  const colliders = [], floorObjects = [];
  const obstacles = [], batches = new Map(), random = mulberry32(WORLD_SETTINGS.seed);
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const planeGeo = new THREE.PlaneGeometry(1, 1);
  const cylinderGeo = new THREE.CylinderGeometry(1, 1, 1, 12);
  const coneGeo = new THREE.ConeGeometry(1, 1, 9);
  const rockGeo = new THREE.IcosahedronGeometry(1, 1);
  const temp = new THREE.Object3D();
  const hiddenMaterial = new THREE.MeshBasicMaterial({ visible: false });

  const textures = {
    soil: surfaceTexture("soil"), gravel: surfaceTexture("gravel"),
    plaster: surfaceTexture("plaster"), wood: surfaceTexture("wood"),
    stone: surfaceTexture("stone"), roof: surfaceTexture("roof")
  };
  const mat = {
    earth: standard(0xaaa181, { map: textures.soil }),
    grass: standard(0x79805a, { map: textures.soil }),
    gravel: standard(0xc1b799, { map: textures.gravel }),
    stucco: standard(0xc4bba5, { map: textures.plaster }),
    inside: standard(0xd7cbb4, { map: textures.plaster }),
    concrete: standard(0x979a8a, { map: textures.plaster }),
    rock: standard(0x969080, { map: textures.stone }),
    rockLight: standard(0xb0a48b, { map: textures.stone }),
    rockShade: standard(0x7c8176, { map: textures.stone }),
    wood: standard(0x826348, { map: textures.wood }),
    siding: standard(0xa8875e, { map: textures.wood }),
    woodDark: standard(0x514636, { map: textures.wood }),
    trim: standard(0xdcd6bb), roof: standard(0x514e45, { map: textures.roof }),
    metal: standard(0x545b53, { roughness: 0.72, metalness: 0.4 }),
    zinc: standard(0x9ba398, { roughness: 0.62, metalness: 0.38 }),
    dark: standard(0x343c39), glass: standard(0x506777, { roughness: 0.3, metalness: 0.32 }),
    red: standard(0x914d3c), olive: standard(0x737b59), rust: standard(0x83583c),
    leaf: standard(0x526246), leafLight: standard(0x6c7850), leafDark: standard(0x3c5040),
    sandbag: standard(0x9a916e), rubber: standard(0x303630), water: standard(0x668780, { roughness: 0.4, metalness: 0.2 }),
    lamp: new THREE.MeshBasicMaterial({ color: 0xffe2a5, toneMapped: false }),
    white: standard(0xd3cbb4)
  };
  const world = {
    map: root, colliders, floorObjects,
    isLoaded: false, spawn: new THREE.Vector3(...WORLD_SETTINGS.spawn),
    lighting: WORLD_SETTINGS.lighting, ready: null, navigation: null,
    resetPlayer
  };
  createSky(); createGround(); createBoundary(); createHouse(); createGarage();
  createSewer(); createYardCover();
  createArchitectureDetail(); createInteriorDetail(); createCompoundProps(); createLandscape();
  flushBatches(); root.updateMatrixWorld(true);
  world.navigation = createNavigation();
  world.isLoaded = true; world.ready = Promise.resolve(world);
  return world;

  function standard(color, extra = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.94, metalness: 0.015, ...extra });
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
      const pixels = ctx.createImageData(w, h);
      for (let i = 0; i < pixels.data.length; i += 4) {
        const value = 192 + (random() - 0.5) * (kind === "gravel" ? 74 : 34);
        pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value; pixels.data[i + 3] = 255;
      }
      ctx.putImageData(pixels, 0, 0);
      if (kind === "wood" || kind === "roof") {
        const rows = kind === "wood" ? 32 : 28;
        ctx.strokeStyle = "rgba(47,40,29,0.3)"; ctx.lineWidth = 2;
        for (let y = 0; y < 256; y += rows) {
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(256, y); ctx.stroke();
          if (kind === "roof") for (let x = ((y / rows) % 2) * 32; x < 256; x += 64) {
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + rows); ctx.stroke();
          }
        }
      }
      for (let i = 0; i < 160; i++) {
        ctx.fillStyle = i % 2 ? "rgba(40,39,30,0.07)" : "rgba(255,250,230,0.13)";
        ctx.fillRect(random() * w, random() * h, kind === "wood" ? 15 + random() * 65 : 2 + random() * 8, 1 + random() * 3);
      }
    });
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    const repeat = kind === "soil" ? 30 : kind === "gravel" ? 8 : kind === "roof" ? 4 : 2;
    texture.repeat.set(repeat, repeat); return texture;
  }
  function instance(geo, material, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0, shadow = true) {
    // Spatial cells retain frustum culling; backdrop foliage does not cast shadows.
    const cell = shadow ? 24 : 64;
    const key = `${geo.uuid}:${material.uuid}:${Math.floor(x / cell)}:${Math.floor(z / cell)}:${shadow}`;
    if (!batches.has(key)) batches.set(key, { geo, material, shadow, matrices: [] });
    temp.position.set(x, y, z); temp.rotation.set(rx, ry, rz); temp.scale.set(sx, sy, sz); temp.updateMatrix();
    batches.get(key).matrices.push(temp.matrix.clone());
  }
  function box(x, y, z, w, h, d, material, solid = false, name = "Compound wall", nav = true) {
    instance(boxGeo, material, x, y, z, w, h, d);
    if (solid) return collider(x, y, z, w, h, d, 0, name, nav);
  }
  function collider(x, y, z, w, h, d, yaw = 0, name = "Compound collision", navigationBlock = true) {
    const mesh = new THREE.Mesh(boxGeo, hiddenMaterial);
    mesh.name = name; mesh.position.set(x, y, z); mesh.rotation.y = yaw; mesh.scale.set(w, h, d);
    root.add(mesh); colliders.push(mesh);
    if (navigationBlock) navigationFootprint(x, z, w, d, yaw);
    return mesh;
  }
  function navigationFootprint(x, z, w, d, yaw = 0) {
    obstacles.push({ x, z, halfW: w / 2, halfD: d / 2, cos: Math.cos(yaw), sin: Math.sin(yaw) });
  }
  function cylinder(x, y, z, r, h, material, rx = 0, ry = 0, rz = 0, shadow = true, solidName = null) {
    instance(cylinderGeo, material, x, y, z, r, h, r, rx, ry, rz, shadow);
    if (solidName) {
      const mesh = new THREE.Mesh(cylinderGeo, hiddenMaterial);
      mesh.name = solidName; mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz); mesh.scale.set(r, h, r);
      root.add(mesh); colliders.push(mesh);
    }
  }
  function groundPatch(x, z, w, d, material, y = 0.018) {
    instance(planeGeo, material, x, y, z, w, d, 1, -Math.PI / 2, 0, 0, false);
  }
  function floor(x, z, w, d, material) {
    box(x, 0.015, z, w, 0.06, d, material);
    floorObjects.push(collider(x, 0.015, z, w, 0.06, d, 0, "G55FLR_CompoundFloor", false));
  }
  function flushBatches() {
    for (const { geo, material, shadow, matrices } of batches.values()) {
      const mesh = new THREE.InstancedMesh(geo, material, matrices.length);
      matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
      mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere();
      mesh.name = "Militia static detail"; mesh.castShadow = shadow && geo !== planeGeo && !material.isMeshBasicMaterial;
      mesh.receiveShadow = !material.isMeshBasicMaterial; root.add(mesh);
    }
    batches.clear();
  }
  // Cut actual holes, registering the exact same wall sections for collision.
  // All apertures are explicit; lintels above head height never block the nav grid.
  function wall(axis, fixed, start, end, low, high, thickness, material, openings = [], name = "House wall") {
    const holes = [...openings].sort((a, b) => a[0] - b[0]);
    const part = (a, b, bottom, top) => {
      if (b - a < 0.001 || top - bottom < 0.001) return;
      const along = (a + b) / 2, y = (bottom + top) / 2;
      box(axis === "z" ? along : fixed, y, axis === "z" ? fixed : along,
        axis === "z" ? b - a : thickness, top - bottom, axis === "z" ? thickness : b - a,
        material, true, name, bottom < 2.6);
    };
    let cursor = start;
    for (const [center, width, bottom, top] of holes) {
      const a = center - width / 2, b = center + width / 2;
      part(cursor, a, low, high); part(a, b, low, bottom); part(a, b, top, high); cursor = b;
    }
    part(cursor, end, low, high);
  }
  function createGround() {
    // A single flat collision floor; visible terrain is partitioned into adjoining
    // faces instead of stacking coplanar grass/gravel planes over this surface.
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(280, 280), hiddenMaterial);
    ground.name = "G55FLR_MilitiaGround"; ground.rotation.x = -Math.PI / 2;
    root.add(ground); colliders.push(ground); floorObjects.push(ground);
    terrainSurfaces([
      [1,15,58,30,mat.grass], [6,28,20,34,mat.gravel],
      [12,0,27,11,mat.gravel], [30,-12,11,57,mat.gravel],
      [-25,-12,9,60,mat.gravel], [0,-33,53,16,mat.grass],
      [-24,25,24,8,mat.gravel], [-24,-29,25,8,mat.gravel]
    ]);
    floor(-6, -14, 24, 20, mat.wood); floor(15, -14, 18, 20, mat.concrete);
  }
  function terrainSurfaces(patches) {
    const xs = [-140, 140], zs = [-140, 140], groups = new Map();
    for (const [x,z,w,d] of patches) { xs.push(x-w/2,x+w/2); zs.push(z-d/2,z+d/2); }
    const xx = [...new Set(xs)].sort((a,b)=>a-b), zz = [...new Set(zs)].sort((a,b)=>a-b);
    for (let i=0;i<xx.length-1;i++) for(let j=0;j<zz.length-1;j++) {
      const x0=xx[i],x1=xx[i+1],z0=zz[j],z1=zz[j+1],x=(x0+x1)/2,z=(z0+z1)/2;
      let surface=[0,0,280,280,mat.earth];
      for(const patch of patches) {
        const [px,pz,w,d]=patch;
        if(Math.abs(x-px)<w/2 && Math.abs(z-pz)<d/2) surface=patch;
      }
      const [px,pz,w,d,material]=surface;
      if(!groups.has(material)) groups.set(material,{positions:[],uv:[]});
      const group=groups.get(material);
      for(const [vx,vz] of [[x0,z0],[x0,z1],[x1,z0],[x1,z0],[x0,z1],[x1,z1]]) {
        group.positions.push(vx,0,vz);
        group.uv.push((vx-px)/w+.5,.5-(vz-pz)/d);
      }
    }
    for(const [material,data] of groups) {
      const geometry=new THREE.BufferGeometry();
      geometry.setAttribute("position",new THREE.Float32BufferAttribute(data.positions,3));
      geometry.setAttribute("uv",new THREE.Float32BufferAttribute(data.uv,2));geometry.computeVertexNormals();
      const mesh=new THREE.Mesh(geometry,material);mesh.name="Non-overlapping compound terrain";mesh.receiveShadow=true;root.add(mesh);
    }
  }
  function createBoundary() {
    for (const x of [-47, 47]) collider(x, 8, 0, 2, 16, 96, 0, "Canyon boundary");
    for (const z of [-47, 47]) collider(0, 8, z, 96, 16, 2, 0, "Canyon boundary");
    // Explicit ridges separate the covered flank from the exterior west lane.
    collider(-31, 4.3, 7, 5, 8.6, 22, 0, "West ridge south");
    collider(-31, 4.3, -18, 5, 8.6, 12, 0, "West ridge north");
  }
  function createHouse() {
    const front = [[-12, 4.4, 1.05, 2.85], [-3, 4, 0, 3.15]];
    wall("z", -4, -18, 6, 0, 3.5, 0.45, mat.stucco, front, "House front");
    wall("z", -24, -18, 6, 0, 3.5, 0.45, mat.stucco, [[-4, 4, 0, 3.15], [-13, 3.4, 1.1, 2.8]], "House rear");
    wall("x", -18, -24, -4, 0, 3.5, 0.45, mat.stucco, [[-13, 4, 0, 3.15]], "West entrance");
    wall("x", 6, -24, -4, 0, 3.5, 0.4, mat.inside, [[-14, 4.6, 0, 3.15]], "Garage connection");
    // Wide living-room / kitchen loop. No narrow corridor or sealed interior.
    wall("x", -8, -21, -7, 0, 3.25, 0.24, mat.inside, [[-14, 5, 0, 3.05]], "Living room divider");
    wall("z", -17, -7.9, 5.8, 0, 3.25, 0.24, mat.inside, [[-2, 4.6, 0, 3.05]], "Kitchen divider");
    box(-6, 3.38, -14, 24.4, 0.26, 20.4, mat.inside, true, "House ceiling", false);
    box(-6, 5.3, -14, 24, 3.6, 20, mat.siding, true, "Scenic upper floor", false);
    for (const z of [-3.71, -24.29]) {
      box(-6, 3.55, z, 24.5, 0.25, 0.25, mat.woodDark);
      box(-6, 7.03, z, 24.7, 0.22, 0.28, mat.trim);
    }
    gableRoof(-6, -14, 25.5, 21.6, 7.2, 3.3, false);
    // Front porch: level threshold, columns at the edges, open central approach.
    floor(-2, -2.2, 11.4, 3.1, mat.concrete);
    // Keep the top above the player's upward-offset ground probe when its head
    // hits the underside; a thin slab can otherwise be mistaken for a floor.
    box(-2, 3.35, -2.2, 12, 0.4, 3.8, mat.woodDark, true, "Porch canopy", false);
    for (const x of [-7.4, 3.4]) box(x, 1.58, -0.65, 0.25, 3.16, 0.25, mat.trim, true, "Porch post");
    box(-2, 3.12, -0.6, 11.5, 0.24, 0.22, mat.trim, true, "Porch beam", false);
  }
  function createGarage() {
    wall("z", -4, 6, 24, 0, 4.3, 0.45, mat.stucco, [[16, 8, 0, 3.55]], "Open garage front");
    wall("z", -24, 6, 24, 0, 4.3, 0.45, mat.stucco, [[17, 5.6, 0, 3.4]], "Open garage rear");
    wall("x", 24, -24, -4, 0, 4.3, 0.45, mat.stucco, [[-14, 4.4, 0, 3.3]], "Garage side door");
    box(15, 4.28, -14, 18, 0.4, 20, mat.woodDark, true, "Garage ceiling", false);
    gableRoof(15, -14, 19.3, 21.2, 4.4, 4, true);
    box(16, 3.77, -3.65, 8.4, 0.34, 0.3, mat.metal);
    for (const x of [11.75, 20.25]) box(x, 1.8, -3.64, 0.18, 3.6, 0.2, mat.metal);
    // Rolled-up door is visibly overhead and excluded from navigation.
    cylinder(16, 4.03, -3.46, 0.32, 8.3, mat.zinc, 0, 0, Math.PI / 2, true, "Garage door roll");
  }
  function gableRoof(x, z, w, d, eave, rise, alongZ) {
    const span = alongZ ? w : d, length = alongZ ? d : w;
    const slope = Math.atan2(rise, span / 2), panel = Math.hypot(span / 2, rise);
    for (const side of [-1, 1]) {
      const mesh = new THREE.Mesh(boxGeo, mat.roof);
      mesh.position.set(x + (alongZ ? side * span / 4 : 0), eave + rise / 2, z + (alongZ ? 0 : side * span / 4));
      mesh.scale.set(alongZ ? panel : length, 0.2, alongZ ? length : panel);
      if (alongZ) mesh.rotation.z = -side * slope; else mesh.rotation.x = side * slope;
      mesh.castShadow = mesh.receiveShadow = true; mesh.name = "Solid pitched roof";
      root.add(mesh); colliders.push(mesh);
    }
    // Triangle gables close both ends without filling the ground-floor footprint.
    const shape = new THREE.Shape(); shape.moveTo(-span / 2, 0); shape.lineTo(span / 2, 0); shape.lineTo(0, rise); shape.closePath();
    const geometry = new THREE.ShapeGeometry(shape);
    const material = standard(0xa58c67, { side: THREE.DoubleSide, map: textures.wood });
    for (const side of [-1, 1]) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x + (alongZ ? 0 : side * (length / 2 - 0.7)), eave, z + (alongZ ? side * (length / 2 - 0.6) : 0));
      mesh.rotation.y = alongZ ? 0 : Math.PI / 2; mesh.castShadow = mesh.receiveShadow = true;
      root.add(mesh); colliders.push(mesh);
    }
    box(x, eave + rise + 0.05, z, alongZ ? 0.28 : length + 0.1, 0.19, alongZ ? length + 0.1 : 0.28, mat.woodDark);
  }
  function createSewer() {
    floor(-39, -1, 9, 66, mat.concrete);
    box(-43.75, 2, -1, 0.5, 4, 66, mat.concrete, true, "Sewer outer wall");
    wall("x", -34.25, -34, 32, 0, 4, 0.5, mat.concrete,
      [[-29, 7, 0, 3.4], [-8, 7, 0, 3.4], [26, 8, 0, 3.4]], "Sewer entrances");
    for (const z of [-34, 32]) box(-39, 2, z, 10, 4, 0.5, mat.concrete, true, "Sewer end");
    box(-39, 4.15, -1, 10, 0.5, 66.5, mat.concrete, true, "Sewer roof", false);
    // Continuous solid rock above the roof; no accessible platform is registered.
    collider(-39, 7.15, -1, 10.5, 5.5, 67, 0, "Ridge over sewer", false);
    for (const z of [-29, -8, 26]) {
      const width = z === 26 ? 8 : 7;
      box(-33.89, 3.5, z, 0.45, 0.35, width + 0.45, mat.woodDark);
      for (const side of [-1, 1]) box(-33.89, 1.72, z + side * (width / 2 + 0.13), 0.45, 3.45, 0.3, mat.woodDark);
    }
    for (let z = -30; z <= 30; z += 10) {
      box(-39, 3.82, z, 9.25, 0.36, 0.2, mat.metal);
      collider(-39, 4.02, z, 9.25, 0.76, 0.2, 0, "Sewer ceiling beam", false);
      box(-39, 3.56, z, 1.3, 0.12, 0.32, mat.lamp);
      for (const x of [-43.36, -34.64]) box(x, 1.9, z, 0.1, 3.8, 0.16, mat.metal);
    }
    // Bright low-cost local fill; no shadow maps for enclosed service lighting.
    for (const z of [-22, 0, 22]) {
      const light = new THREE.PointLight(0xdfe9d5, 18, 18, 2); light.position.set(-39, 2.9, z); root.add(light);
    }
    cylinder(-43.1, 2.83, -1, 0.2, 64, mat.rust, Math.PI / 2);
  }
  function createYardCover() {
    boulder(-10, 14, 3.8, 3.1, 3.2);
    boulder(26, 17, 3, 2.5, 2.8);
    boulder(-20, 33, 5, 4, 4);
    boulder(-26, -37, 3.5, 3.5, 3.5);
    boulder(31, -39, 3, 3.3, 3);
    crate(-19, 3, 2.1, 2.2, 2); crate(-21.4, 3, 2.1, 1.5, 2);
    crate(10, 11, 2.4, 1.5, 2.4); crate(12.6, 11, 2.4, 2.5, 2.4);
    crate(4, -31, 2.6, 1.6, 2.5); crate(7, -31, 2.6, 1.6, 2.5);
    crate(-23, -23, 2.3, 1.7, 2.3);
    // Functional interior cover has honest box bounds and leaves both exits clear.
    box(-14.8, 0.65, -8, 4.4, 1.3, 1.3, mat.olive, true, "Living room sofa");
    box(2.9, 0.52, -21.7, 3.8, 1.04, 1.2, mat.wood, true, "Kitchen counter");
    box(21.9, 0.53, -19.6, 2.9, 1.06, 2, mat.woodDark, true, "Garage workbench");
    // Rear tool shed with two open sides.
    floor(31, -31, 8, 8, mat.concrete);
    box(31, 1.6, -35, 8.4, 3.2, 0.3, mat.wood, true, "Shed back");
    box(35, 1.6, -31, 0.3, 3.2, 8, mat.wood, true, "Shed side");
    for (const x of [27, 35]) box(x, 1.6, -27, 0.25, 3.2, 0.25, mat.woodDark, true, "Shed post");
    box(31, 3.34, -31, 9, 0.4, 9, mat.roof, true, "Shed roof", false);
    // Silos are closed scenery at grade, not spawning platforms.
    for (const [x, z, r, h] of [[36, -8, 2.9, 9.5], [36, -18, 2.5, 7.6]]) {
      cylinder(x, h / 2, z, r, h, mat.zinc, 0, 0, 0, true, "Grain silo");
      instance(coneGeo, mat.metal, x, h + 0.7, z, r + 0.15, 1.4, r + 0.15);
      // Conservative pathfinding footprint, precise round shot/movement surface.
      navigationFootprint(x, z, r * 2.04, r * 2.04);
      for (let y = 0.6; y < h; y += 1.5) cylinder(x, y, z, r + 0.06, 0.07, mat.metal);
    }
  }
  function crate(x, z, w, h, d) {
    box(x, h / 2, z, w, h, d, mat.siding, true, "Supply crate");
    for (const side of [-1, 1]) {
      box(x, 0.16, z + side * (d / 2 + 0.025), w + 0.08, 0.18, 0.06, mat.woodDark);
      box(x, h - 0.16, z + side * (d / 2 + 0.025), w + 0.08, 0.18, 0.06, mat.woodDark);
      for (const dx of [-w * 0.35, w * 0.35]) box(x + dx, h / 2, z + side * (d / 2 + 0.045), 0.13, h, 0.09, mat.woodDark);
    }
  }
  function boulder(x, z, rx, h, rz, solid = true, base = 0) {
    // The full visible base determines clearance; the rock mesh below handles
    // impacts, with no hidden box blocking air beside its chamfered corners.
    if (solid) navigationFootprint(x, z, rx * 2, rz * 2);
    // Broad flat base, broken shoulders and a sloping crown; no visible box plinth.
    const ring = [[-1,-.82],[-.82,-1],[.82,-1],[1,-.82],[1,.82],[.82,1],[-.82,1],[-1,.82]];
    const points = [], uv = [];
    const vertex = (i, level) => {
      const p = ring[i % 8], scale = level === 2 ? .57 : 1;
      return [x + p[0] * rx * scale, base + (level === 0 ? 0 : level === 1 ? h * .77 : h * (1.12 + ((i % 8) % 3) * .045)), z + p[1] * rz * scale];
    };
    const tri = (a,b,c) => { points.push(...a,...c,...b); uv.push(0,0,.5,1,1,0); };
    for (let level=0;level<2;level++) for(let i=0;i<8;i++) {
      const a=vertex(i,level),b=vertex(i+1,level),c=vertex(i+1,level+1),d=vertex(i,level+1);
      tri(a,b,d);tri(b,c,d);
    }
    for(let i=0;i<8;i++) tri(vertex(i,2),vertex(i+1,2),[x,base+h*1.15,z]);
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position",new THREE.Float32BufferAttribute(points,3));
    geometry.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2)); geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry,mat.rockLight); mesh.castShadow=solid; mesh.receiveShadow=true; mesh.name="Solid faceted rock"; root.add(mesh); colliders.push(mesh);
  }
  function faceBox(x, y, z, dx, dy, dz, w, h, d, material, yaw = 0) {
    instance(boxGeo, material, x + Math.cos(yaw) * dx + Math.sin(yaw) * dz, y + dy,
      z - Math.sin(yaw) * dx + Math.cos(yaw) * dz, w, h, d, 0, yaw);
  }
  function windowFrame(x, y, z, w, h, yaw = 0, open = false) {
    if (!open) {
      faceBox(x,y,z,0,0,0,w+.28,h+.28,.12,mat.woodDark,yaw);
      faceBox(x,y,z,0,0,.085,w,h,.08,mat.glass,yaw);
      faceBox(x,y,z,0,0,.15,.085,h,.06,mat.trim,yaw);
      faceBox(x,y,z,0,0,.15,w,.085,.06,mat.trim,yaw);
    }
    for(const side of [-1,1]) {
      faceBox(x,y,z,side*(w/2+.08),0,.1,.16,h+.34,.2,mat.trim,yaw);
      faceBox(x,y,z,0,side*(h/2+.09),.1,w+.45,.18,.24,mat.trim,yaw);
    }
    faceBox(x,y,z,0,-h/2-.17,.2,w+.6,.14,.48,mat.woodDark,yaw);
    if(!open) for(const side of [-1,1]) {
      faceBox(x,y,z,side*(w/2+.48),0,.08,.52,h+.1,.1,mat.woodDark,yaw);
      for(let k=0;k<8;k++) faceBox(x,y,z,side*(w/2+.48),-h*.4+k*h*.115,.15,.49,.08,.07,mat.siding,yaw);
    }
  }
  function createArchitectureDetail() {
    for(const x of [-14,-6,2]) {
      windowFrame(x,5.36,-3.89,2.25,1.85);
      windowFrame(x,5.36,-24.11,2.25,1.85,Math.PI);
    }
    for(const z of [-19,-9]) windowFrame(-18.11,5.36,z,2.1,1.85,-Math.PI/2);
    windowFrame(-12,1.95,-3.74,4.25,1.69,0,true);
    windowFrame(-13,1.95,-24.26,3.25,1.58,Math.PI,true);
    // Overhead garage loft opening is glazed scenery, not an enemy spawn.
    windowFrame(15,5.68,-3.91,1.85,1.35);
    for(const z of [-3.7,-24.3]) for(const x of [-17.8,5.8]) box(x,5.28,z,.2,3.5,.21,mat.woodDark);
    for(const x of [-17.55,5.45]) cylinder(x,1.65,-3.6,.055,3.3,mat.zinc);
    for(const x of [-17.7,23.7]) cylinder(x,2,-24.3,.07,4,mat.metal);
    // A stone chimney breaks the long roof silhouette.
    box(-12,9.35,-16,1.8,5.2,1.65,mat.rock, true,"House chimney",false);
    box(-12,12.02,-16,2.1,.26,1.95,mat.stucco);
    box(-12,12.19,-16,1.5,.14,1.32,mat.dark);
    for(let y=7.4;y<11.9;y+=.45) box(-12,y,-15.16,1.81,.035,.035,mat.woodDark);
    // Door trims are kept outside the original aperture widths.
    for(const [x,z,w,yaw] of [[-3,-3.7,4,0],[-4,-24.3,4,Math.PI],[-18.3,-13,4,-Math.PI/2],[24.3,-14,4.4,Math.PI/2]]) {
      for(const side of [-1,1]) faceBox(x,0,z,side*(w/2+.09),1.58,0,.16,3.16,.18,mat.woodDark,yaw);
      faceBox(x,0,z,0,3.18,0,w+.34,.18,.2,mat.woodDark,yaw);
    }
    for(const x of [-7.1,3.1]) {
      box(x,2.75,-3.5,.28,.42,.25,mat.metal);box(x,2.74,-3.35,.18,.27,.09,mat.lamp);
    }
    plaque("117",-3,3.02,-3.47,0.66,.24,0,"#4d4b3a","#e4dab8");
    plaque("WORKSHOP",21.8,2.8,-3.73,2.35,.4,0,"#6b5640","#e4d6b5");
    // Garage braces and roof fascia follow its slope, above all playable routes.
    for(const side of [-1,1]) {
      const angle=-side*Math.atan2(4,19.3/2);
      instance(boxGeo,mat.trim,15+side*19.3/4,6.38,-3.29,Math.hypot(19.3/2,4),.13,.16,0,0,angle);
    }
  }
  function createInteriorDetail() {
    // Ceiling beams, skirtings and furniture details stay within existing solids.
    // Extend hidden beam colliders through the overlapping ceiling slab. The
    // union has no exposed internal top face for the controller to snap onto.
    for(const z of [-7,-13,-20]) {
      box(-6,3.17,z,23.5,.18,.2,mat.woodDark);
      collider(-6,3.295,z,23.5,.43,.2,0,"House ceiling beam",false);
    }
    for(const z of [-8,-14,-20]) {
      box(15,4,z,17.6,.32,.2,mat.metal);
      collider(15,4.16,z,17.6,.64,.2,0,"Garage ceiling beam",false);
    }
    box(-14.8,1.09,-8.44,4.35,.72,.36,mat.olive);
    for(const x of [-16.8,-12.8]) box(x,.86,-8,.36,.47,1.26,mat.woodDark);
    for(const x of [-16,-14.8,-13.6]) box(x,.86,-7.8,1.02,.16,.8,mat.sandbag);
    groundPatch(-13,-12.7,6.4,4.7,mat.woodDark,.07);
    // Cabinet doors and a cooker share the existing kitchen-counter footprint.
    for(const x of [1.7,2.8,3.9]) {
      box(x,.51,-21.05,.94,.88,.08,mat.siding);box(x+.24,.7,-20.99,.07,.07,.07,mat.metal);
    }
    box(2.9,1.075,-21.7,3.85,.12,1.24,mat.inside);
    box(3.65,1.15,-21.75,1.22,.07,.85,mat.metal);
    for(const x of [3.35,3.95]) for(const z of [-21.52,-21.98]) cylinder(x,1.197,z,.18,.025,mat.dark);
    box(21.9,1.105,-19.6,3.02,.13,2.06,mat.siding);
    for(const x of [21.1,22.7]) box(x,1.23,-19.7,.6,.15,.4,mat.metal);
    // Tool rack against a solid garage wall, not across the side entrance.
    box(23.67,2.03,-20.7,.12,1.45,3.2,mat.woodDark);
    for(let k=0;k<5;k++) box(23.54,2.0,-21.8+k*.54,.14,.8,.07,mat.zinc);
    for(const x of [11,20]) {box(x,4,-11,1.1,.13,.34,mat.metal);box(x,3.91,-11,.92,.03,.24,mat.lamp);}
    // Low-intensity fill makes enemies readable under the existing host lighting.
    const fill = new THREE.PointLight(0xffe2b5,12,16,2);fill.position.set(-3,2.85,-11);root.add(fill);
    const garageFill = new THREE.PointLight(0xe4ebd6,12,15,2);garageFill.position.set(15,3.4,-13);root.add(garageFill);
    plaque("KEEP CLEAR",16,3.62,-4.25,2.7,.28,Math.PI,"#514c3c","#d2ba78");
  }
  function createCompoundProps() {
    // Six-wheel APC at the CT approach, functioning as ordinary static cover.
    const x=18,z=33;
    box(x,1.3,z,3.55,1.8,6.8,mat.olive,true,"Parked APC",false);
    navigationFootprint(x,z,3.96,7.3);
    box(x,2.24,z-.7,3.25,.44,3.7,mat.olive,true,"APC roof",false);
    box(x,2.27,z+2.35,2.9,.56,1.2,mat.metal,true,"APC cab",false);
    box(x,2.46,z+2.97,2.5,.22,.06,mat.glass);
    box(x,2.9,z-.8,1.55,.72,1.6,mat.olive,true,"APC turret",false);
    cylinder(x,3.3,z-.8,.48,.12,mat.metal,0,0,0,true,"APC hatch");
    for(const side of [-1,1]) {
      for(const dz of [-2.15,0,2.15]) {
        cylinder(x+side*1.74,.69,z+dz,.69,.35,mat.rubber,0,0,Math.PI/2,true,"APC wheel");
        cylinder(x+side*1.94,.69,z+dz,.34,.065,mat.metal,0,0,Math.PI/2);
      }
      box(x+side*1.81,1.84,z,.12,.24,5.7,mat.metal);
      box(x+side*1.26,1.65,z+3.44,.47,.2,.07,mat.lamp);
    }
    box(x,.75,z+3.53,3.9,.26,.2,mat.metal,true,"APC bumper",false);
    // Ranch fence separates the approach, with a generous central opening.
    for(const [a,b] of [[-15,-3],[10,14]]) fence(a,b,40.5);
    plaque("PRIVATE PROPERTY",-8.9,1.8,40.66,4.8,.68,0,"#6d654e","#e2d5ac");
    // Hot tub on the side patio: contained scenic water, no unsupported swimming.
    floor(-22.1,-18.5,3.8,4,mat.wood);
    box(-22.1,.48,-18.5,3.25,.96,3.1,mat.woodDark,true,"Covered patio hot tub");
    box(-22.1,.98,-18.5,2.75,.06,2.6,mat.water);
    for(const dx of [-1.54,1.54]) box(-22.1+dx,1.05,-18.5,.22,.2,3.15,mat.trim);
    for(const dz of [-1.48,1.48]) box(-22.1,1.05,-18.5+dz,3.28,.2,.22,mat.trim);
    // Range boards: solid targets with a clear rear circulation route.
    const targetTexture=canvasTexture(128,192,ctx=>{
      ctx.fillStyle="#c7b991";ctx.fillRect(0,0,128,192);
      ctx.fillStyle="#6a6751";ctx.beginPath();ctx.arc(64,37,16,0,Math.PI*2);ctx.fill();
      ctx.fillRect(34,59,60,88);ctx.strokeStyle="#d2c7a6";ctx.lineWidth=2;
      for(const r of [9,20,31]){ctx.beginPath();ctx.ellipse(64,100,r,r*1.25,0,0,Math.PI*2);ctx.stroke();}
    });
    const targetMat=standard(0xffffff,{map:targetTexture});
    for(const x of [-17,-12,-7]) {
      box(x,1.3,-42.5,1.45,2.6,.22,mat.woodDark,true,"Range target board");
      const board=new THREE.Mesh(planeGeo,targetMat);board.position.set(x,1.64,-42.36);board.scale.set(1.28,1.85,1);root.add(board);
    }
    plaque("RANGE",-12,3.4,-45.7,4.3,.6,0,"#66583d","#d6cba8");
    // Three portals are visibly marked without adding HUD or UI elements.
    for(const [z,title] of [[26,"DRAINAGE"],[-8,"SERVICE"],[-29,"NORTH YARD"]]) plaque(title,-33.61,3.67,z,3.7,.38,Math.PI/2,"#3f4e46","#c4d0b9");
    box(-43.3,1.8,-28,0.24,1.3,2.2,mat.metal);
    for(const z of [-28.6,-27.5]) box(-43.13,1.91,z,.13,.61,.81,mat.glass);
    // Empty side yard has restrained barrels, a pallet and a wood pile.
    for(const [bx,bz] of [[27,-21],[28.5,-21],[30,-32]]) barrel(bx,bz);
    crate(32,-33,2.2,1.45,1.9);
    for(let i=0;i<5;i++) cylinder(28.4+i*.65,.43,-34,.27,4,mat.woodDark,0,0,Math.PI/2);
    for(const [bx,bz] of [[-25,2],[26,3]]) {
      box(bx,1.9,bz,.16,3.8,.16,mat.woodDark,true,"Utility pole");
      box(bx,3.65,bz,.8,.12,.14,mat.metal);box(bx,3.47,bz+.16,.45,.16,.44,mat.metal);
    }
  }
  function barrel(x,z) {
    cylinder(x,.63,z,.48,1.26,mat.rust,0,0,0,true,"Fuel barrel");navigationFootprint(x,z,.99,.99);
    for(const y of [.12,.94,1.2]) cylinder(x,y,z,.495,.065,mat.metal);
    cylinder(x,1.27,z,.44,.03,mat.metal);
  }
  function fence(a,b,z) {
    // Solid lower rails are honest movement/shot cover; upper rail is thin.
    box((a+b)/2,.56,z,b-a,1.12,.18,mat.wood,true,"Ranch fence");
    for(let x=a;x<=b+.01;x+=2) box(x,.85,z,.18,1.7,.22,mat.woodDark,true,"Fence post",false);
    box((a+b)/2,1.45,z,b-a,.16,.2,mat.siding,true,"Fence rail",false);
  }
  function plaque(text,x,y,z,w,h,yaw,bg,fg) {
    const texture=canvasTexture(512,96,ctx=>{
      ctx.fillStyle=bg;ctx.fillRect(0,0,512,96);ctx.strokeStyle=fg;ctx.lineWidth=3;ctx.strokeRect(7,7,498,82);
      ctx.fillStyle=fg;ctx.font="bold 45px Arial";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText(text,256,51,475);
    });
    const mesh=new THREE.Mesh(planeGeo,standard(0xffffff,{map:texture}));mesh.position.set(x,y,z);mesh.rotation.y=yaw;mesh.scale.set(w,h,1);root.add(mesh);
  }
  function createLandscape() {
    // The actual boundary is flat at foot/eye level. Faceted higher tiers recede
    // outward, so scenery never protrudes invisibly into the playable perimeter.
    for(let side=0;side<4;side++) cliffFace(side);
    boulder(-31,7,2.55,8.7,11.05,false);
    boulder(-31,-18,2.55,8.7,6.05,false);
    boulder(-39,-1,5.25,5.5,33.5,false,4.4);
    // Background mountains, then a loose pine line, all beyond solid boundaries.
    for(const [x,z,sx,sy,sz] of [[-73,-73,35,25,24],[-10,-91,37,38,25],[60,-83,32,26,26],[-91,-4,26,31,34],[87,2,25,28,34],[-42,80,35,24,22],[50,91,32,30,22]]) {
      instance(rockGeo,mat.rockShade,x,sy*.4,z,sx,sy,sz,.05,random(),0,false);
    }
    for(let i=0;i<48;i++) {
      const side=i%4,along=-57+Math.floor(i/4)*10.5,offset=53+random()*9;
      const x=side%2 ? (side===1?offset:-offset) : along;
      const z=side%2 ? along : (side===0?-offset:offset);
      pine(x,z,12+random()*10,7+random()*4,false);
    }
    for(const [x,z,h] of [[-30,39,11],[-27,19,9],[41,26,12],[40,-31,12],[-22,-44,10],[20,-43,11]]) {
      pine(x,z,h,0,true);
    }
    deadOak(-23,10);
    // Small vegetation stays against cover and solid boundaries, never in apertures.
    for(const [x,z] of [[-20,34],[-10,14],[26,17],[-26,-37],[31,-39],[-26,36],[41,31],[41,-31],[-21,-44]]) {
      for(let k=0;k<5;k++) {
        const px=x+(random()-.5)*4,pz=z+(random()-.5)*4;
        instance(rockGeo,k%2?mat.leaf:mat.leafLight,px,.38,pz,.5+random()*.7,.38+random()*.28,.5+random()*.6,0,random()*5,0,false);
      }
    }
    // A few broad, distant cloud clusters. Opaque geometry avoids sprite overdraw.
    const cloudMat=new THREE.MeshBasicMaterial({color:0xe7e9de,fog:true});
    for(const [x,y,z,s] of [[-71,58,-92,1],[20,64,-118,1.2],[105,59,-50,.8],[-100,68,65,.9],[42,63,111,1]]) {
      for(let k=0;k<4;k++) instance(rockGeo,cloudMat,x+(k-1.5)*9*s,y+(k%2)*2*s,z,12*s,3.2*s,5*s,0,.2*k,0,false);
    }
  }
  function deadOak(x,z) {
    collider(x,2.7,z,.8,5.4,.8,0,"Old oak trunk");
    const branch=(a,b,r1,r2)=>{
      const from=new THREE.Vector3(...a),to=new THREE.Vector3(...b),dir=to.clone().sub(from);
      const geometry=new THREE.CylinderGeometry(r2,r1,dir.length(),6);
      const mesh=new THREE.Mesh(geometry,mat.woodDark);mesh.position.copy(from.add(to).multiplyScalar(.5));
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),dir.normalize());mesh.castShadow=true;root.add(mesh);
    };
    branch([x,0,z],[x+.25,6.7,z-.2],.44,.21);
    branch([x+.2,4.1,z],[x-2.5,6.8,z-.6],.24,.1);
    branch([x-2.5,6.8,z-.6],[x-3.1,8.1,z-1.2],.1,.035);
    branch([x+.2,5.6,z],[x+2.7,8.1,z+.5],.19,.06);
    branch([x+2.2,7.5,z+.4],[x+4,7.9,z+1.3],.09,.025);
    branch([x+.25,6.7,z-.2],[x-.6,9.2,z+.1],.18,.04);
    branch([x,3.6,z],[x+1.2,5.4,z-2.4],.17,.035);
  }
  function pine(x,z,h,base=0,solid=false) {
    cylinder(x,base+h*.28,z,.2,h*.56,mat.woodDark,0,0,0,solid);
    if(solid) collider(x,h*.27,z,.48,h*.54,.48,0,"Pine trunk");
    for(let k=0;k<4;k++) {
      const r=h*(.22-k*.035),height=h*(.43-k*.035);
      instance(coneGeo,k%2?mat.leaf:mat.leafDark,x,base+h*(.42+k*.15),z,r,height,r,0,k*.55,0,solid);
    }
  }
  function cliffFace(side) {
    const points=[],uv=[],colors=[],baseColor=new THREE.Color();
    const rows=[0,2.6,7.4,13,18],along=[];
    for(let i=0;i<=12;i++) {
      const column=[];
      for(let j=0;j<rows.length;j++) {
        const spread=j<2?0:j===2?.18:1+(j-2)*2.6+random()*3;
        const a=-49+i*98/12,y=rows[j]+(j>1?(random()-.5)*3.8:0),out=46+spread;
        column.push(side===0?[a,y,-out]:side===1?[out,y,a]:side===2?[a,y,out]:[-out,y,a]);
      }
      along.push(column);
    }
    const tri=(a,b,c,shade)=>{
      baseColor.setHex(shade);for(const p of [a,b,c]){points.push(...p);uv.push((side%2?p[2]:p[0])/9,p[1]/9);colors.push(baseColor.r,baseColor.g,baseColor.b);}
    };
    for(let i=0;i<12;i++) for(let j=0;j<4;j++) {
      const a=along[i][j],b=along[i+1][j],c=along[i+1][j+1],d=along[i][j+1];
      const shade=[0xc2bba6,0xb4ad9c,0xa5a594,0xc9c0a8][(i+j*3)%4];tri(a,b,d,shade);tri(b,c,d,shade);
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.Float32BufferAttribute(points,3));
    geometry.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));geometry.setAttribute("color",new THREE.Float32BufferAttribute(colors,3));geometry.computeVertexNormals();
    const material=standard(0xffffff,{map:textures.stone,vertexColors:true,side:THREE.DoubleSide,flatShading:true});
    const mesh=new THREE.Mesh(geometry,material);mesh.name="Stratified canyon wall";mesh.receiveShadow=true;root.add(mesh);
  }
  function createSky() {
    const settings = WORLD_SETTINGS.sky;
    scene.background = new THREE.Color(settings.fogColor); scene.fog = new THREE.Fog(settings.fogColor, settings.fogNear, settings.fogFar);
    const geometry = new THREE.SphereGeometry(220, 24, 16), colors = [];
    const top = new THREE.Color(settings.top), mid = new THREE.Color(settings.mid), horizon = new THREE.Color(settings.horizon), color = new THREE.Color();
    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const t = Math.max(0, pos.getY(i) / 220);
      color.copy(t < 0.2 ? horizon : mid).lerp(t < 0.2 ? mid : top, t < 0.2 ? t / 0.2 : (t - 0.2) / 0.8);
      colors.push(color.r, color.g, color.b);
    }
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const dome = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false }));
    dome.name = "Militia late-afternoon sky"; dome.renderOrder = -1000; scene.add(dome);
    const sun = new THREE.Mesh(new THREE.SphereGeometry(2.5, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffedc7, fog: false }));
    // Host-owned directional light and visible disk share the same direction.
    sun.position.set(...WORLD_SETTINGS.lighting.sunPosition).normalize().multiplyScalar(180);
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

