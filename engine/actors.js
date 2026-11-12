import { importEngine } from "./importEngine.js";
import { RULES } from "./config.js";
import { playerEyeHeight } from "./playerStance.js";

const { createBodygroupSchema, normalizeAppearance, sameAppearance } = await importEngine("bodygroups.js");

// Living replicas and corpses have different lifetimes. A respawn must never
// move a corpse or reconnect an animation mixer to a physics-driven skeleton.
export async function createMultiplayerActors({ scene, world, asset, weaponSlots, localId, makeLabel, muzzleEffects = null, physicsConfig = {}, rules = RULES }) {
  const [THREE, characters, SkeletonUtils, { loadWorldWeaponAsset, findWorldWeaponMuzzle }, { createRagdolls }, { updateSourceProceduralBones }] = await Promise.all([
    importEngine("vendor/three.module.js"), importEngine("characterLoader.js"),
    importEngine("vendor/SkeletonUtils.js"), importEngine("weaponLoader.js"),
    importEngine("ragdolls.js"), importEngine("SourceProcedural.js")
  ]);
  const actors = new Map(), visuals = new Map(), deadLives = new Map();
  const physics = createRagdolls({ colliders: world.colliders, floorObjects: world.floorObjects,
    config: physicsConfig, onExpire: disposeRoot });
  let soldiers, loadedWeapons, characterModels;
  try {
    [soldiers, loadedWeapons] = await Promise.all([
      Promise.all(asset.models.map(model => characters.loadCharacterAsset(model, asset))),
      Promise.all(weaponSlots.map(async slot => {
        const template = await loadWorldWeaponAsset(slot.asset);
        const definition = await physics.loadWeapon(template.model, template, template.physics);
        return [slot.id, { template, physics: definition }];
      })),
      physics.initialize()
    ]);
    characterModels = await Promise.all(soldiers.map(async (template, index) => ({
      template, asset,
      schema: createBodygroupSchema(template.metadata, asset.source?.bodygroups),
      physics: await physics.loadModel(asset.models[index], template, asset.ragdoll)
    })));
    if (new Set(characterModels.map(entry => entry.schema.model)).size !== characterModels.length) {
      throw new Error("Selectable player models must have distinct native model identities.");
    }
  } catch (error) { physics.dispose(); throw error; }
  const worldWeapons = new Map(loadedWeapons);
  const defaultSlot = worldWeapons.has(rules.defaultWeaponSlot) ? rules.defaultWeaponSlot : weaponSlots[0].id;
  const appearanceSchema = { ...characterModels[0].schema, models: characterModels.map(entry => entry.schema) };
  const modelsById = new Map(characterModels.map(entry => [entry.schema.model, entry]));

  // Geometry/textures stay shared, while each body and equipped weapon owns
  // its materials and cloned skeletons for independent cleanup.
  function ownMaterials(model) {
    const copies = new Map();
    model?.traverse(object => {
      if (!object.isMesh) return;
      object.castShadow = true; object.receiveShadow = true; object.frustumCulled = false;
      const own = material => {
        if (!copies.has(material)) {
          const copy = material.clone();
          copies.set(material, copy);
        }
        return copies.get(material);
      };
      if (object.material) object.material = Array.isArray(object.material) ? object.material.map(own) : own(object.material);
    });
    return [...copies.values()];
  }

  function disposeSkeletons(root) {
    const skeletons = new Set(); root.traverse(o => { if (o.isSkinnedMesh) skeletons.add(o.skeleton); });
    skeletons.forEach(s => s.dispose());
  }

  function setWeapon(a, slot) {
    slot = worldWeapons.has(slot) ? slot : defaultSlot;
    if (a.slot === slot) return;
    muzzleEffects?.remove(a.root);
    const previous = a.root.userData.weapon;
    if (previous) {
      const socket = previous.parent;
      previous.removeFromParent(); disposeSkeletons(previous);
      if (socket?.name === "EnemyWeaponSocket" && !socket.children.length) socket.removeFromParent();
    }
    a.weaponMaterials.forEach(material => material.dispose());
    const entry = worldWeapons.get(slot);
    a.animator.setHoldType?.(weaponSlots.find(value => value.id === slot)?.asset.holdType);
    const weapon = characters.attachCharacterWeapon(a.model, entry.template, asset, SkeletonUtils.clone);
    a.slot = slot; a.weaponMaterials = ownMaterials(weapon);
    Object.assign(a.root.userData, { weapon, weaponPhysics: entry.physics, weaponSlot: slot });
    a.muzzle = findWorldWeaponMuzzle(weapon, entry.template.muzzleFlash);
    if (a.id !== localId()) muzzleEffects?.bind(a.root, a.muzzle);
    // The old weapon's velocity samples belong to a different skeleton/frame.
    delete a.root.userData.weaponHistory;
  }

  function create(p) {
    const appearance = normalizeAppearance(appearanceSchema, p.hp <= 0 ? p.death?.appearance || p.appearance : p.appearance);
    const entry = modelsById.get(appearance.model), soldier = entry.template;
    const root = new THREE.Group();
    const { model, animator } = characters.createCharacterInstance(soldier, asset, appearance.bodygroups, 1.9 * rules.playerHeight / 1.75);
    root.name = `Multiplayer soldier ${p.id}, life ${p.life}`;
    const { mixer } = animator;
    const materials = ownMaterials(model);
    root.add(model); const nameplate = makeLabel(p.name); root.add(nameplate);
    root.position.set(p.p[0], p.p[1] - playerEyeHeight(p.motion, rules), p.p[2]); root.rotation.y = p.yaw + Math.PI;
    Object.assign(root.userData, { model, mixer, animation: animator.state, appearance, ragdollDefinition: entry.physics, isDead: false });
    const actor = { root, model, animator, nameplate, appearance, materials, slot: null, weaponMaterials: [],
      target: root.position.clone(), yaw: root.rotation.y, pose: p, life: p.life, id: p.id };
    actors.set(p.id, actor); visuals.set(root, actor); scene.add(root);
    return actor;
  }

  function disposeRoot(root) {
    const a = visuals.get(root); if (!a) return;
    muzzleEffects?.remove(root);
    physics.remove(root);
    a.animator.dispose();
    disposeSkeletons(root); a.materials.forEach(m => m.dispose()); a.weaponMaterials.forEach(m => m.dispose());
    a.nameplate.material?.map?.dispose(); a.nameplate.material?.dispose();
    root.removeFromParent(); visuals.delete(root);
    if (actors.get(a.id) === a) actors.delete(a.id);
  }

  function die(a, p) {
    deadLives.set(p.id, p.life); actors.delete(p.id);
    muzzleEffects?.remove(a.root);
    // Use the master's death position even if interpolation or a newer local
    // movement packet had placed this replica slightly ahead of the lethal hit.
    const position = p.death?.p || p.p, yaw = p.death?.yaw ?? p.yaw;
    a.root.position.set(position[0], position[1] - playerEyeHeight(p.death?.motion || p.motion, rules), position[2]);
    a.root.rotation.y = yaw + Math.PI; a.root.visible = true; a.nameplate.visible = false;
    a.root.userData.isDead = true;
    const impact = p.death?.direction ? {
      direction: new THREE.Vector3(...p.death.direction), point: new THREE.Vector3(...p.death.point), damage: p.death.damage
    } : {};
    if (!physics.create(a.root, a.root.userData.ragdollDefinition, impact)) {
      console.warn("Could not create multiplayer soldier ragdoll."); disposeRoot(a.root);
    }
  }

  function pose(p) {
    if (!p.ready || p.life < 1) return;
    let a = actors.get(p.id);
    if ((deadLives.get(p.id) ?? -1) >= p.life || (a && a.life > p.life)) return;
    const appearance = normalizeAppearance(appearanceSchema, p.hp <= 0 ? p.death?.appearance || p.appearance : p.appearance);
    if (a && (a.life !== p.life || !sameAppearance(a.appearance, appearance))) { disposeRoot(a.root); a = null; }
    const created = !a;
    a ||= create(p);
    setWeapon(a, p.hp <= 0 ? p.death?.slot ?? p.slot : p.slot);
    if (created) a.animator.snap?.({ ...p, motion: p.hp <= 0 ? p.death?.motion || p.motion : p.motion });
    if (p.hp <= 0) {
      die(a, p); return;
    }
    // Keep a hidden local replica so the local death has a complete, animated
    // skeleton and the same selected physical weapon as every remote death.
    a.root.visible = p.id !== localId();
    const height = playerEyeHeight(p.motion, rules);
    a.target.set(p.p[0], p.p[1] - height, p.p[2]);
    a.nameplate.position.y = height + .7;
    a.yaw = p.yaw + Math.PI; a.pose = { ...p, motion: p.motion && structuredClone(p.motion) };
    a.nameplate.material?.color?.set(p.protected ? 0x9cdbff : 0xffffff);
  }

  function sync(players) {
    for (const [id, actor] of actors) if (!players[id]) disposeRoot(actor.root);
    for (const id of deadLives.keys()) if (!players[id]) deadLives.delete(id);
    Object.values(players).forEach(pose);
  }

  function update(delta) {
    for (const a of actors.values()) {
      a.root.position.lerp(a.target, 1 - Math.exp(-15 * delta));
      const turn = Math.atan2(Math.sin(a.yaw - a.root.rotation.y), Math.cos(a.yaw - a.root.rotation.y));
      a.root.rotation.y += turn * (1 - Math.exp(-15 * delta));
      a.animator.update(delta, { ...a.pose, bodyYaw: a.root.rotation.y - Math.PI }); updateSourceProceduralBones(a.model);
      physics.trackPose(a.root, a.root.userData.ragdollDefinition, delta);
    }
    // Online menus, deaths and intermission do not pause falling bodies.
    physics.update(delta);
  }

  function clear() {
    [...visuals.keys()].forEach(disposeRoot); deadLives.clear();
  }
  return { pose, sync, update, clear, dispose() { clear(); physics.dispose(); },
    getMuzzlePosition(shot, target) {
      const a = actors.get(shot.actor);
      if (!a?.root.visible || !a.muzzle || (shot.life != null && shot.life !== a.life) || shot.slot !== a.slot) return null;
      return a.muzzle.getWorldPosition(target);
    },
    showShot(shot) {
      const a = actors.get(shot.actor);
      if (a && (shot.life == null || shot.life === a.life) && shot.slot === a.slot) {
        a.animator.trigger?.("fire");
        if (a.id !== localId()) muzzleEffects?.trigger(a.root);
      }
    },
    appearanceSchema, characterModels,
    getWeaponTemplate(slot) { return (worldWeapons.get(slot) || worldWeapons.get(defaultSlot)).template; },
    get corpseCount() { return physics.count; } };
}
