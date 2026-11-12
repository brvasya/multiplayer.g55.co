import * as THREE from "./vendor/three.module.js";
import { parseSourcePhysics } from "./SourcePhysics.js";

// HL2-style articulated bodies backed by the model's native PHY data.
// Bullet/Ammo is bundled locally; no extra CDN, build step or asset conversion.
let ammoPromise;
function loadAmmo() {
  if (!ammoPromise) {
    ammoPromise = Promise.all([
      import("./vendor/ammo.wasm.js"),
      new THREE.FileLoader().setResponseType("arraybuffer").loadAsync(new URL("./vendor/ammo.wasm.wasm", import.meta.url).href)
    ]).then(([module, wasmBinary]) => module.default({ wasmBinary }));
    ammoPromise.catch(() => { ammoPromise = null; });
  }
  return ammoPromise;
}

const defaults = {
  maxRagdolls: 8, lifetime: 5,
  gravity: 18, fixedTimeStep: 1 / 120, maxSubSteps: 8, solverIterations: 20,
  bulletImpulseScale: 0.32
};
const pairKey = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;
const clamp = THREE.MathUtils.clamp;

// Standalone prop collision meshes can be exported separately from their MDL,
// with different axes/checksums. Resolve only rigid axis rotations, never resize
// or replace the native hull. Matching native exports keep their authored frame.
function alignWeaponHull(model, solid, boneName) {
  model.updateWorldMatrix(true, true);
  const frame = boneName ? model.getObjectByName(boneName) : model;
  const inverse = frame.matrixWorld.clone().invert();
  const point = new THREE.Vector3(), meshBounds = new THREE.Box3(), meshPoints = [];
  model.traverseVisible(object => {
    if (!object.isMesh || !object.geometry?.attributes.position) return;
    if (object.isSkinnedMesh) object.skeleton.update();
    const toFrame = new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld);
    const count = object.geometry.attributes.position.count;
    for (let i = 0; i < count; i++) {
      object.getVertexPosition(i, point).applyMatrix4(toFrame);
      meshBounds.expandByPoint(point);
      meshPoints.push(point.clone());
    }
  });
  if (meshBounds.isEmpty()) throw new Error("Cannot align weapon PHY without visible model geometry.");
  const extent = meshBounds.getSize(new THREE.Vector3()).length();
  if (!(extent > 1e-6)) throw new Error("Weapon geometry has no usable extent.");
  const hullPoints = [];
  for (const hull of solid.hulls) for (let i = 0; i < hull.length; i += 3) {
    hullPoints.push(new THREE.Vector3().fromArray(hull, i));
  }
  const x = new THREE.Vector3(), y = new THREE.Vector3(), z = new THREE.Vector3();
  const candidate = new THREE.Matrix4(), best = new THREE.Matrix4(), bounds = new THREE.Box3();
  let bestScore = Infinity;
  // The 24 proper axis rotations include identity first. Bounds prune obvious
  // mismatches; hull-to-mesh distances distinguish asymmetric stocks/magazines.
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
    if (a === b) continue;
    for (const sx of [1, -1]) for (const sy of [1, -1]) {
      x.set(0, 0, 0).setComponent(a, sx); y.set(0, 0, 0).setComponent(b, sy);
      z.crossVectors(x, y); candidate.makeBasis(x, y, z);
      bounds.makeEmpty();
      for (const vertex of hullPoints) bounds.expandByPoint(point.copy(vertex).applyMatrix4(candidate));
      const boundError = Math.sqrt((bounds.min.distanceToSquared(meshBounds.min)
        + bounds.max.distanceToSquared(meshBounds.max)) / 6) / extent;
      if (boundError >= bestScore) continue;
      let distance = 0, samples = 0;
      const stride = Math.max(1, Math.ceil(hullPoints.length / 128));
      for (let i = 0; i < hullPoints.length; i += stride) {
        point.copy(hullPoints[i]).applyMatrix4(candidate);
        let nearest = Infinity;
        for (const vertex of meshPoints) nearest = Math.min(nearest, point.distanceToSquared(vertex));
        distance += Math.sqrt(nearest); samples++;
      }
      const score = boundError + distance / (samples * extent);
      if (score < bestScore - 1e-9) { bestScore = score; best.copy(candidate); }
    }
  }
  // A different checksum alone is not a prop-loading failure. Still reject
  // unrelated collision geometry rather than attaching a clearly wrong hull.
  if (bestScore > 0.08) throw new Error("Weapon PHY geometry does not match the displayed MDL. Use its matching collision mesh.");
  return best;
}

export function createRagdolls({ colliders = [], floorObjects = [], config = {}, onExpire = () => {} } = {}) {
  const options = { ...defaults, ...config };
  const records = [], statics = [], models = new Map(), weapons = new Map();
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), scale = new THREE.Vector3();
  const v = new THREE.Vector3(), w = new THREE.Vector3(), rotation = new THREE.Quaternion();
  const worldMatrix = new THREE.Matrix4(), localMatrix = new THREE.Matrix4();
  let A, world, collisionConfig, dispatcher, broadphase, solver, av, aq;
  let readyPromise, accumulator = 0, colliderSnapshot = [];
  const step = clamp(options.fixedTimeStep, 1 / 240, 1 / 60);
  const maxSteps = clamp(Math.floor(options.maxSubSteps), 1, 16);

  function initialize() {
    if (!readyPromise) readyPromise = loadAmmo().then(ammo => {
      A = ammo;
      av = new A.btVector3(0, 0, 0); aq = new A.btQuaternion(0, 0, 0, 1);
      collisionConfig = new A.btDefaultCollisionConfiguration();
      dispatcher = new A.btCollisionDispatcher(collisionConfig);
      broadphase = new A.btDbvtBroadphase();
      solver = new A.btSequentialImpulseConstraintSolver();
      world = new A.btDiscreteDynamicsWorld(dispatcher, broadphase, solver, collisionConfig);
      av.setValue(0, -Math.max(0, options.gravity), 0); world.setGravity(av);
      world.getSolverInfo().set_m_numIterations(clamp(Math.floor(options.solverIterations), 8, 40));
      world.getSolverInfo().set_m_splitImpulse(true);
      return true;
    }).catch(error => {
      throw new Error("Required ragdoll physics could not initialize.", { cause: error });
    });
    return readyPromise;
  }

  async function loadModel(src, result, setting = {}) {
    const url = setting?.phy || src.replace(/\.mdl(?=([?#]|$))/i, ".phy");
    const key = `${url}:${result.metadata.checksum}`;
    if (!models.has(key)) models.set(key, (async () => {
      try {
        const buffer = await new THREE.FileLoader().setResponseType("arraybuffer").loadAsync(url);
        const definition = parseSourcePhysics(buffer, result.metadata.checksum);
        const byName = new Map(result.boneData.map(b => [b.sourceName.toLowerCase(), b]));
        for (const solid of definition.solids) {
          const bone = byName.get(solid.name.toLowerCase());
          if (!bone) throw new Error(`PHY bone is absent from MDL: ${solid.name}`);
          solid.boneName = bone.name;
          solid.bind = bone.inverse.clone().invert();
        }
        return definition;
      } catch (error) {
        throw new Error(`Required ragdoll PHY could not load: ${url}`, { cause: error });
      }
    })());
    return models.get(key);
  }

  async function loadWeapon(src, result, setting = {}) {
    setting ||= {};
    const url = setting.phy || src.replace(/\.mdl(?=([?#]|$))/i, ".phy");
    // Idle pose/bodygroup variants can need different frames for the same PHY.
    const key = JSON.stringify([url, result.metadata.checksum, result.scene.uuid, setting]);
    if (!weapons.has(key)) weapons.set(key, (async () => {
      try {
        const buffer = await new THREE.FileLoader().setResponseType("arraybuffer").loadAsync(url);
        // A weapon is a standalone rigid prop: its PHY may come from a separate
        // collision-mesh export. Validate the binary, and honor an explicit
        // checksum override; character ragdolls keep strict MDL/PHY matching.
        const definition = parseSourcePhysics(buffer, setting.checksum);
        if (definition.solids.length !== 1 || definition.constraints.length) {
          throw new Error("A dropped weapon requires one rigid PHY solid (which may contain multiple convex hulls).");
        }
        const solid = definition.solids[0];
        // Prop PHY names can refer to a collision mesh, not an MDL bone.
        // In that case its coordinates are relative to the model root.
        const bone = result.boneData.find(b => b.sourceName.toLowerCase() === solid.name.toLowerCase());
        const explicitFrame = setting.rotation || setting.position;
        const correction = !explicitFrame && definition.checksum !== result.metadata.checksum
          ? alignWeaponHull(result.scene, solid, bone?.name)
          : new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...(setting.rotation || [0, 0, 0])));
        if (setting.position) correction.setPosition(new THREE.Vector3().fromArray(setting.position));
        return { solid, boneName: bone?.name, correction };
      } catch (error) {
        throw new Error(`Required weapon PHY could not load: ${url}`, { cause: error });
      }
    })());
    return weapons.get(key);
  }

  function boneMap(model) {
    const bones = new Map();
    model.traverse(object => { if (object.isBone && !bones.has(object.name)) bones.set(object.name, object); });
    return bones;
  }

  function poseSample(object, center, correction = new THREE.Matrix4()) {
    return { bone: object, center: new THREE.Vector3().fromArray(center), correction,
      position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), velocity: new THREE.Vector3(),
      angularVelocity: new THREE.Vector3(), valid: false };
  }

  function trackSample(sample, delta) {
    if (!sample.bone) return;
    worldMatrix.copy(sample.bone.matrixWorld).multiply(sample.correction);
    worldMatrix.decompose(p, q, scale);
    p.copy(sample.center).applyMatrix4(worldMatrix);
    if (sample.valid) {
      sample.velocity.copy(p).sub(sample.position).divideScalar(delta).clampLength(0, 8);
      rotation.copy(sample.quaternion).invert().premultiply(q).normalize();
      if (rotation.w < 0) rotation.set(-rotation.x, -rotation.y, -rotation.z, -rotation.w);
      const angle = 2 * Math.acos(clamp(rotation.w, -1, 1));
      sample.angularVelocity.set(rotation.x, rotation.y, rotation.z);
      if (sample.angularVelocity.lengthSq() > 1e-10) sample.angularVelocity.setLength(angle / delta).clampLength(0, 12);
    }
    sample.position.copy(p); sample.quaternion.copy(q); sample.valid = true;
  }

  function weaponFrame(weapon, definition) {
    const object = definition.boneName ? boneMap(weapon).get(definition.boneName) : weapon;
    if (!object) throw new Error(`Weapon PHY bone is absent from the clone: ${definition.boneName}`);
    return object;
  }

  // Capture the last two evaluated poses, including navigation motion. Those
  // derivatives carry a running/falling enemy into physics without a dead stop.
  function trackPose(enemy, definition, delta) {
    if (!definition || !enemy.userData.model || enemy.userData.isDead || !(delta > 0)) return;
    let history = enemy.userData.ragdollHistory;
    if (!history) {
      const bones = boneMap(enemy.userData.model);
      history = definition.solids.map(s => poseSample(bones.get(s.boneName), s.center));
      enemy.userData.ragdollHistory = history;
    }
    enemy.updateMatrixWorld(true);
    for (const sample of history) trackSample(sample, delta);
    const weapon = enemy.userData.weapon, physics = enemy.userData.weaponPhysics;
    if (weapon && physics) {
      const sample = enemy.userData.weaponHistory ||= poseSample(weaponFrame(weapon, physics), physics.solid.center, physics.correction);
      trackSample(sample, delta);
    }
  }

  function ammoTransform(position, quaternion) {
    const t = new A.btTransform(); t.setIdentity();
    av.setValue(position.x, position.y, position.z); t.setOrigin(av);
    aq.setValue(quaternion.x, quaternion.y, quaternion.z, quaternion.w); t.setRotation(aq);
    return t;
  }

  function makeBody(shape, position, quaternion, mass, inertia = null) {
    const t = ammoTransform(position, quaternion);
    const motion = new A.btDefaultMotionState(t);
    av.setValue(0, 0, 0);
    if (mass) shape.calculateLocalInertia(mass, av);
    if (inertia && inertia.every(n => n > 1e-8 && Number.isFinite(n))) av.setValue(...inertia);
    const info = new A.btRigidBodyConstructionInfo(mass, motion, shape, av);
    const body = new A.btRigidBody(info);
    body.setFriction(0.72); body.setRestitution(0.02);
    if (mass) {
      body.setSleepingThresholds(0.12, 0.22);
      body.setCcdMotionThreshold(0.025); body.setCcdSweptSphereRadius(0.025);
    }
    world.addRigidBody(body);
    A.destroy(info); A.destroy(t);
    return { body, motion, shape, children: [], triangleMesh: null };
  }

  function destroyBody(entry) {
    world.removeRigidBody(entry.body);
    A.destroy(entry.body); A.destroy(entry.motion); A.destroy(entry.shape);
    entry.children.forEach(child => A.destroy(child));
    if (entry.triangleMesh) A.destroy(entry.triangleMesh);
  }

  function makePhyBody(solid, matrix, sample, compound = true) {
    matrix.decompose(p, q, scale);
    if (scale.x <= 0 || Math.abs(scale.x - scale.y) > 0.00001 || Math.abs(scale.x - scale.z) > 0.00001) {
      throw new Error("PHY bodies require positive uniform scale.");
    }
    const unitScale = scale.x;
    const center = new THREE.Vector3().fromArray(solid.center).multiplyScalar(unitScale);
    const position = p.clone().add(v.copy(center).applyQuaternion(q));
    const quaternion = q.clone();
    const hulls = solid.hulls.map(vertices => {
      const hull = new A.btConvexHullShape();
      for (let j = 0; j < vertices.length; j += 3) {
        av.setValue(vertices[j] * unitScale - center.x, vertices[j + 1] * unitScale - center.y, vertices[j + 2] * unitScale - center.z);
        hull.addPoint(av, j + 3 === vertices.length);
      }
      hull.setMargin(Math.min(0.005, unitScale * 0.12));
      return hull;
    });
    // A single weapon hull stays convex so Bullet's continuous collision
    // detection works for a thin rifle falling onto floors at high speed.
    let shape = hulls[0], children = [];
    if (compound || hulls.length > 1) {
      shape = new A.btCompoundShape(true); children = hulls;
      const identity = new A.btTransform(); identity.setIdentity();
      for (const hull of hulls) shape.addChildShape(identity, hull);
      A.destroy(identity);
    }
    const inertia = solid.inertia.map(n => n * unitScale * unitScale * solid.mass * clamp(solid.inertiaScale, 0.25, 12));
    const entry = makeBody(shape, position, quaternion, solid.mass, inertia);
    Object.assign(entry, { center, unitScale, mass: solid.mass, children,
      position, quaternion, previousPosition: position.clone(), previousQuaternion: quaternion.clone() });
    entry.body.setDamping(clamp(1 - Math.exp(-solid.damping * 0.1), 0.04, 0.9),
      clamp(1 - Math.exp(-solid.angularDamping * 0.08), 0.08, 0.85));
    if (sample?.valid) {
      av.setValue(sample.velocity.x, sample.velocity.y, sample.velocity.z); entry.body.setLinearVelocity(av);
      av.setValue(sample.angularVelocity.x, sample.angularVelocity.y, sample.angularVelocity.z); entry.body.setAngularVelocity(av);
    }
    return entry;
  }

  function ignoreCollisionPair(a, b) {
    const identity = new A.btTransform(); identity.setIdentity();
    const filter = new A.btGeneric6DofConstraint(a, b, identity, identity, true);
    av.setValue(1, 1, 1); filter.setLinearLowerLimit(av); filter.setAngularLowerLimit(av);
    av.setValue(-1, -1, -1); filter.setLinearUpperLimit(av); filter.setAngularUpperLimit(av);
    world.addConstraint(filter, true); A.destroy(identity);
    return filter;
  }

  function dropWeapon(enemy, record) {
    const weapon = enemy.userData.weapon, physics = enemy.userData.weaponPhysics;
    if (!weapon || !physics) return;
    const frame = weaponFrame(weapon, physics);
    worldMatrix.copy(frame.matrixWorld).multiply(physics.correction);
    const modelOffset = worldMatrix.clone().invert().multiply(weapon.matrixWorld);
    const entry = makePhyBody(physics.solid, worldMatrix, enemy.userData.weaponHistory, false);
    Object.assign(entry, { model: weapon, modelOffset });
    record.weapon = entry;
    record.bodies.push(entry);
    // Keep ownership under the corpse for disposal, outside its animated
    // bones. attach() preserves the exact world pose at the release frame.
    const socket = weapon.parent;
    enemy.attach(weapon);
    if (socket?.name === "EnemyWeaponSocket" && !socket.children.length) socket.removeFromParent();
    // The grip initially overlaps the hand. Briefly exclude this corpse only;
    // floors, walls and other ragdolls collide from the first physics step.
    for (const body of record.bodies) if (body !== entry) {
      record.releaseFilters.push(ignoreCollisionPair(body.body, entry.body));
    }
  }

  function syncWorld() {
    const meshes = [], seen = new Set();
    for (const root of [...colliders, ...floorObjects]) root?.traverse(object => {
      if (object.isMesh && object.geometry?.attributes.position && !seen.has(object)) {
        seen.add(object); meshes.push(object);
      }
    });
    if (meshes.length === colliderSnapshot.length && meshes.every((mesh, i) => mesh === colliderSnapshot[i])) return;
    statics.forEach(destroyBody); statics.length = 0;
    colliderSnapshot = meshes;
    for (const mesh of meshes) {
      mesh.updateWorldMatrix(true, false);
      const geometry = mesh.geometry;
      if (geometry.type === "BoxGeometry") {
        geometry.computeBoundingBox();
        mesh.matrixWorld.decompose(p, q, scale);
        geometry.boundingBox.getCenter(v).applyMatrix4(mesh.matrixWorld);
        geometry.boundingBox.getSize(w).multiply(scale).multiplyScalar(0.5);
        av.setValue(Math.abs(w.x), Math.abs(w.y), Math.abs(w.z));
        const shape = new A.btBoxShape(av); shape.setMargin(0.005);
        statics.push(makeBody(shape, v, q, 0));
      } else {
        // Exact static triangles retain stairs, ramps, rotated planes and
        // irregular floors. Visual-only detail never becomes an obstacle.
        const triangleMesh = new A.btTriangleMesh(true, true);
        const vertices = geometry.attributes.position, index = geometry.index;
        const vectors = [new A.btVector3(0, 0, 0), new A.btVector3(0, 0, 0), new A.btVector3(0, 0, 0)];
        const count = index ? index.count : vertices.count;
        for (let i = 0; i + 2 < count; i += 3) {
          for (let j = 0; j < 3; j++) {
            p.fromBufferAttribute(vertices, index ? index.getX(i + j) : i + j).applyMatrix4(mesh.matrixWorld);
            vectors[j].setValue(p.x, p.y, p.z);
          }
          triangleMesh.addTriangle(...vectors, true);
        }
        vectors.forEach(vector => A.destroy(vector));
        const shape = new A.btBvhTriangleMeshShape(triangleMesh, true, true); shape.setMargin(0.005);
        const entry = makeBody(shape, new THREE.Vector3(), new THREE.Quaternion(), 0);
        entry.triangleMesh = triangleMesh; statics.push(entry);
      }
    }
  }

  function create(enemy, definition, impact = {}) {
    if (!world || !definition || !enemy.userData.model || enemy.userData.ragdoll) return false;
    const bones = boneMap(enemy.userData.model);
    enemy.updateMatrixWorld(true);
    const mapped = definition.solids.map(s => bones.get(s.boneName));
    if (mapped.some(b => !b)) return false;
    // Source hulls/joint frames require a rigid transform plus uniform scale.
    for (const bone of mapped) {
      bone.matrixWorld.decompose(p, q, scale);
      if (scale.x <= 0 || Math.abs(scale.x - scale.y) > 0.00001 || Math.abs(scale.x - scale.z) > 0.00001) {
        console.warn("Ragdolls require positive uniform character scale.");
        return false;
      }
    }
    syncWorld();
    const limit = clamp(Math.floor(options.maxRagdolls), 1, 32);
    while (records.length >= limit) {
      const oldest = records[0].enemy; remove(oldest); onExpire(oldest);
    }
    const record = { enemy, bodies: [], joints: [], filters: [], releaseFilters: [], age: 0, definition };
    try {
      definition.solids.forEach((solid, index) => {
        const bone = mapped[index];
        const entry = makePhyBody(solid, bone.matrixWorld, enemy.userData.ragdollHistory?.[index]);
        entry.bone = bone;
        record.bodies.push(entry);
      });
      const jointPairs = new Set();
      for (const joint of definition.constraints) {
        const parent = record.bodies[joint.parent], child = record.bodies[joint.child];
        const relative = definition.solids[joint.parent].bind.clone().invert().multiply(definition.solids[joint.child].bind);
        relative.decompose(p, q, scale);
        // Shared animation MDLs can use slightly different bone lengths. Keep
        // the live pivot to avoid a position pop, and the authored bind axes
        // so limits never become relative to the arbitrary pose at death.
        p.setFromMatrixPosition(child.bone.matrixWorld).applyMatrix4(localMatrix.copy(parent.bone.matrixWorld).invert());
        p.multiplyScalar(parent.unitScale).sub(parent.center);
        const frameA = ammoTransform(p, q);
        const frameB = ammoTransform(v.copy(child.center).negate(), new THREE.Quaternion());
        const constraint = new A.btGeneric6DofConstraint(parent.body, child.body, frameA, frameB, true);
        av.setValue(0, 0, 0); constraint.setLinearLowerLimit(av); constraint.setLinearUpperLimit(av);
        // Bullet's legacy 6DOF measures inverse-frame XYZ angles, equivalent
        // to the negative Source ZYX angles. Swap/negate both bounds: otherwise
        // elbows and knees bend backwards despite numerically valid limits.
        av.setValue(...joint.upper.map(value => -value)); constraint.setAngularLowerLimit(av);
        av.setValue(...joint.lower.map(value => -value)); constraint.setAngularUpperLimit(av);
        // Softer correction removes initial pose mismatch without snapping limbs.
        for (let axis = 0; axis < 6; axis++) {
          constraint.setParam(2, 0.2, axis); // BT_CONSTRAINT_STOP_ERP
          constraint.setParam(4, 0.00001, axis); // BT_CONSTRAINT_STOP_CFM
        }
        world.addConstraint(constraint, true);
        record.joints.push(constraint); jointPairs.add(pairKey(joint.parent, joint.child));
        A.destroy(frameA); A.destroy(frameB);
      }
      // This Ammo build does not expose per-pair ignoreCollisionCheck. A fully
      // free 6DOF has zero solver rows but supplies Bullet's collision exclusion.
      // This preserves every PHY self-collision rule, even with >15 body parts,
      // without sacrificing collisions between different corpses or the map.
      const allowed = new Set(definition.collisionPairs.map(pair => pairKey(...pair)));
      for (let i = 0; i < record.bodies.length; i++) for (let j = i + 1; j < record.bodies.length; j++) {
        const key = pairKey(i, j);
        if (jointPairs.has(key) || (definition.selfCollisions && (!definition.hasCollisionRules || allowed.has(key)))) continue;
        record.filters.push(ignoreCollisionPair(record.bodies[i].body, record.bodies[j].body));
      }
      const depth = bone => { let n = 0; while (bone.parent) { n++; bone = bone.parent; } return n; };
      record.ordered = [...record.bodies].sort((a, b) => depth(a.bone) - depth(b.bone));
      dropWeapon(enemy, record);
      enemy.userData.ragdoll = record;
      records.push(record);
      // Pausing avoids AnimationMixer.stopAllAction restoring the bind pose.
      if (enemy.userData.mixer) enemy.userData.mixer.timeScale = 0;
      hit(enemy, impact);
      return true;
    } catch (error) {
      if (records.includes(record)) records.splice(records.indexOf(record), 1);
      delete enemy.userData.ragdoll;
      destroyRecord(record);
      console.warn("Could not create PHY ragdoll.", error);
      return false;
    }
  }

  function wake(record) { record.bodies.forEach(entry => entry.body.activate(true)); }

  function hit(enemy, { point, direction, damage = 30 } = {}) {
    const record = enemy.userData.ragdoll;
    if (!record) return false;
    wake(record);
    if (!direction || direction.lengthSq() < 1e-10) return true;
    const target = point ? record.ordered.reduce((a, b) =>
      a.position.distanceToSquared(point) < b.position.distanceToSquared(point) ? a : b) : record.ordered[0];
    const impulse = clamp(damage * options.bulletImpulseScale, 4, 45);
    const totalMass = record.ordered.reduce((sum, entry) => sum + entry.mass, 0);
    for (const entry of record.ordered) {
      v.copy(direction).normalize().multiplyScalar(impulse * 0.2 * entry.mass / totalMass);
      av.setValue(v.x, v.y, v.z); entry.body.applyCentralImpulse(av);
    }
    v.copy(direction).normalize().multiplyScalar(Math.min(impulse * 0.8, target.mass * 5));
    av.setValue(v.x, v.y, v.z);
    w.copy(point || target.position).sub(target.position).clampLength(0, 0.6);
    const relative = new A.btVector3(w.x, w.y, w.z);
    target.body.applyImpulse(av, relative); A.destroy(relative);
    return true;
  }

  function readBody(entry) {
    // getWorldTransform returns the actual fixed-step transform; interpolation
    // belongs to this module, not Bullet's separate graphics MotionState clock.
    const t = entry.body.getWorldTransform(), origin = t.getOrigin(), orientation = t.getRotation();
    entry.position.set(origin.x(), origin.y(), origin.z());
    entry.quaternion.set(orientation.x(), orientation.y(), orientation.z(), orientation.w()).normalize();
  }

  function syncSkeleton(record, alpha) {
    for (const entry of record.ordered) {
      p.lerpVectors(entry.previousPosition, entry.position, alpha);
      q.slerpQuaternions(entry.previousQuaternion, entry.quaternion, alpha);
      p.sub(v.copy(entry.center).applyQuaternion(q));
      worldMatrix.compose(p, q, scale.setScalar(entry.unitScale));
      entry.bone.parent.updateWorldMatrix(true, false);
      localMatrix.copy(entry.bone.parent.matrixWorld).invert().multiply(worldMatrix);
      localMatrix.decompose(entry.bone.position, entry.bone.quaternion, entry.bone.scale);
      entry.bone.updateMatrix(); entry.bone.updateWorldMatrix(false, false);
    }
    if (record.weapon) {
      const entry = record.weapon;
      p.lerpVectors(entry.previousPosition, entry.position, alpha);
      q.slerpQuaternions(entry.previousQuaternion, entry.quaternion, alpha);
      p.sub(v.copy(entry.center).applyQuaternion(q));
      worldMatrix.compose(p, q, scale.setScalar(entry.unitScale)).multiply(entry.modelOffset);
      entry.model.parent.updateWorldMatrix(true, false);
      localMatrix.copy(entry.model.parent.matrixWorld).invert().multiply(worldMatrix);
      localMatrix.decompose(entry.model.position, entry.model.quaternion, entry.model.scale);
      entry.model.updateMatrix();
    }
    record.enemy.updateMatrixWorld(true);
  }

  function update(delta) {
    if (!world || !records.length || !(delta > 0)) return;
    const dt = Math.min(delta, 0.1);
    accumulator = Math.min(accumulator + dt, step * maxSteps);
    while (accumulator + 1e-9 >= step) {
      for (const record of records) for (const entry of record.bodies) {
        entry.previousPosition.copy(entry.position); entry.previousQuaternion.copy(entry.quaternion);
      }
      world.stepSimulation(step, 0); accumulator = Math.max(0, accumulator - step);
      for (const record of records) for (const entry of record.bodies) readBody(entry);
    }
    const alpha = accumulator / step;
    const expired = [];
    for (const record of records) {
      record.age += dt;
      if (record.age >= 0.25 && record.releaseFilters.length) {
        removeConstraints(record.releaseFilters);
      }
      if (record.age >= options.lifetime || record.bodies.some(entry =>
        !Number.isFinite(entry.position.lengthSq()) || entry.position.y < -60)) {
        expired.push(record.enemy); continue;
      }
      syncSkeleton(record, alpha);
    }
    expired.forEach(onExpire);
  }

  function removeConstraints(constraints) {
    for (const constraint of constraints) {
      world.removeConstraint(constraint); A.destroy(constraint);
    }
    constraints.length = 0;
  }

  function destroyRecord(record) {
    removeConstraints(record.joints); removeConstraints(record.filters); removeConstraints(record.releaseFilters);
    record.bodies.forEach(destroyBody);
    record.bodies.length = 0; record.weapon = null;
  }

  function remove(enemy) {
    const record = enemy.userData.ragdoll;
    if (!record) return;
    const index = records.indexOf(record);
    if (index !== -1) records.splice(index, 1);
    destroyRecord(record); delete enemy.userData.ragdoll;
    if (!records.length) accumulator = 0;
  }

  function dispose() {
    [...records].forEach(record => { remove(record.enemy); onExpire(record.enemy); });
    if (!world) return;
    statics.forEach(destroyBody); statics.length = 0; colliderSnapshot = [];
    [world, solver, broadphase, dispatcher, collisionConfig, aq, av].forEach(object => A.destroy(object));
    world = null;
  }

  return { initialize, loadModel, loadWeapon, trackPose, create, update, remove, dispose,
    get count() { return records.length; } };
}
