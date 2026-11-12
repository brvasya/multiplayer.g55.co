import { updateSourceProceduralBones } from "./SourceProcedural.js";
import { loadWeaponAsset } from "./weaponLoader.js";
import { createMuzzleFlashTexture } from "./muzzleFlash.js";
import * as SkeletonUtils from "./vendor/SkeletonUtils.js";

export function createWeaponSystem({ THREE, weaponScene, worldScene, weaponCamera, playerVelocity, weaponSlots, handsAsset, onReloadStart, onShootSecondaryStart }) {
  const handsModels = Array.isArray(handsAsset.model) ? handsAsset.model : [handsAsset.model];
  let handsPath = handsModels[0];
  const VALVEBIPED_SOURCE_PREFIX = "ValveBiped.Bip01";
  const VALVEBIPED_MERGE_PREFIX = THREE.PropertyBinding.sanitizeNodeName(VALVEBIPED_SOURCE_PREFIX);
  const slots = createSlots(weaponSlots);

  const settings = {
    bobAmount: 0.018,
    bobSpeed: 10.5,
    swayAmount: 0.00085,
    swayMax: 0.035,
    tiltAmount: 0.045,
    lagAmount: 0.08,
    motionBlend: 18
  };

  let currentSlotIndex = 0;
  let weaponTime = 0; // Milliseconds of active weapon simulation, never wall time.
  let lastShotTime = Number.NEGATIVE_INFINITY;
  let isReloading = false;
  let reloadStartedAt = 0;
  let reloadDuration = 0;
  let reloadSequenceId = 0;
  let shootSequenceEndTime = 0;

  const rig = new THREE.Group();
  const modelCache = new Map();
  const audioCache = new Map();

  const handsCache = new Map();

  const actions = new Map();
  const targetPosition = new THREE.Vector3();
  const targetRotation = new THREE.Euler();
  const shellGeometry = new THREE.CylinderGeometry(0.18, 0.18, 0.8, 8);
  const shellMaterial = new THREE.MeshStandardMaterial({
    color: 0xc89b3c, roughness: 0.42, metalness: 0.45
  });
  const shells = [];
  const tempShellPosition = new THREE.Vector3();
  const tempShellVelocity = new THREE.Vector3();

  let model = null;
  let handsModel = null;
  let boneMergePairs = [];
  let mixer = null;
  let activeAction = null;
  let returnTimer = null;
  let reloadTimer = null;
  let bobTime = 0;
  let swayX = 0;
  let swayY = 0;
  let currentState = "idle";
  let currentStateTime = 0;
  let currentStateDuration = 0;
  let attachmentBone = null;
  let muzzleFlashBone = null;
  let flashlightActive = false;
  let muzzleFlashTime = 0;
  const boneMergeLocalMatrix = new THREE.Matrix4();
  const boneMergeParentInverse = new THREE.Matrix4();
  const effectPosition = new THREE.Vector3();
  const effectQuaternion = new THREE.Quaternion();
  const attachmentRotationEuler = new THREE.Euler(0, 0, 0, "XYZ");
  const attachmentRotationQuaternion = new THREE.Quaternion();
  const effectDirection = new THREE.Vector3();
  const cameraForward = new THREE.Vector3();

  const FLASHLIGHT_INTENSITY = 42;
  // Keep the spotlight registered in Three.js from startup at zero intensity.
  // Toggling .visible on the first use changes the active light set and can
  // force a world-material shader compile, causing a noticeable flashlight delay.
  const flashlight = new THREE.SpotLight(0xffffff, 0, 34, Math.PI / 7, 0.55, 1.35);
  flashlight.name = "WeaponFlashlight";
  flashlight.visible = true;
  flashlight.castShadow = false;
  const flashlightTarget = new THREE.Object3D();
  flashlightTarget.name = "WeaponFlashlightTarget";

  // Keep the point light in the active Three.js light set from startup.
  // Toggling a light from invisible -> visible on the first shot can force
  // expensive world-material shader compilation in the firing frame.
  const muzzleLight = new THREE.PointLight(0xffc36a, 0, 6, 2);
  muzzleLight.name = "WeaponMuzzleFlashLight";
  muzzleLight.visible = true;
  muzzleLight.castShadow = false;

  if (worldScene) {
    worldScene.add(flashlight, flashlightTarget, muzzleLight);
    flashlight.target = flashlightTarget;
  }

  const muzzleFlashTexture = createMuzzleFlashTexture(THREE);
  const muzzleFlashMaterial = new THREE.SpriteMaterial({
    map: muzzleFlashTexture,
    color: 0xffd27a,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    toneMapped: false
  });
  const muzzleFlashSprite = new THREE.Sprite(muzzleFlashMaterial);
  muzzleFlashSprite.name = "WeaponMuzzleFlash";
  // Keep the sprite renderable at zero opacity so its shader is compiled
  // before the player fires for the first time.
  muzzleFlashSprite.visible = true;
  muzzleFlashSprite.material.opacity = 0;
  muzzleFlashSprite.scale.set(5.2, 5.2, 1);

  rig.name = "FirstPersonWeaponRig";
  resetRigTransform();
  weaponScene.add(rig);

  function makeSlot(slotConfig) {
    const behavior = slotConfig.asset.behavior;
    const reserveAmmo = Math.max(behavior.magazineSize * 10, 50);

    return {
      id: slotConfig.id,
      asset: slotConfig.asset,
      name: String(slotConfig.asset.name).toUpperCase(),
      magazineSize: behavior.magazineSize,
      ammo: behavior.magazineSize,
      reserveAmmo,
      defaultReserveAmmo: reserveAmmo,
      fireCooldownMs: behavior.fireCooldownMs,
    };
  }

  function createSlots(slotConfigs) {
    return slotConfigs.map(makeSlot);
  }

  function currentSlot() {
    return slots[currentSlotIndex];
  }

  function currentModelConfig() {
    return currentSlot().asset;
  }

  function preloadAll() {
    const tasks = [...new Set(handsModels)].map(preloadHandsAsset);
    for (const { asset } of slots) {
      tasks.push(preloadWeaponAsset(asset));
      if (asset.fireSound) tasks.push(preloadSound(asset.fireSound));
      if (asset.shootSound) tasks.push(preloadSound(asset.shootSound));
      if (asset.reloadSound) tasks.push(preloadSound(asset.reloadSound));
    }

    return Promise.all(tasks).then(() => {
      const failed = Array.from(modelCache.values()).find(entry => entry.failed);
      if (failed) throw failed.error || new Error("A weapon model failed to load.");
      const failedHands = Array.from(handsCache.values()).find(entry => entry.failed);
      if (failedHands) throw failedHands.error || new Error("A hands model failed to load.");
      attachCurrentModel();
    });
  }

  function preloadWeaponAsset(asset) {
    // Display names are not identities. Even the same MDL can have different
    // source/bodygroup/animation settings in two configured weapon definitions.
    let cached = modelCache.get(asset);

    if (cached?.promise) return cached.promise;
    cached = {
      source: null,
      animations: [],
      failed: false,
      promise: null
    };

    modelCache.set(asset, cached);

    cached.promise = loadWeaponAsset(asset).then(result => {
      cached.source = result.scene;
      cached.animations = result.animations;
      cached.source.traverse(object => {
        if (!object.isMesh) return;
        object.frustumCulled = false;
        object.castShadow = false;
        object.receiveShadow = true;
      });
      return cached;
    }).catch(error => {
      cached.failed = true;
      cached.error = error;
      console.warn("Weapon model failed to preload:", asset.model, error);
      return cached;
    });

    return cached.promise;
  }

  function preloadHandsAsset(path) {
    if (slots.every(slot => slot.asset.hands === false)) return Promise.resolve(null);
    if (handsCache.has(path)) return handsCache.get(path).promise;
    const cached = { source: null, failed: false, promise: null };
    handsCache.set(path, cached);
    cached.promise = loadWeaponAsset({ ...handsAsset, model: path }, { hands: true }).then(result => {
      cached.source = result.scene;
      return cached;
    }).catch(error => {
      cached.failed = true;
      cached.error = error;
      console.warn("Hands model failed to preload:", path, error);
      return cached;
    });

    return cached.promise;
  }

  // The index follows character.models. A single path shares hands across all
  // characters. Swapping only this rig preserves weapon animation and ammo.
  function setHandsModel(index) {
    if (!Number.isInteger(index) || index < 0) return false;
    const path = Array.isArray(handsAsset.model) ? handsModels[index] : handsModels[0];
    if (!path || path === handsPath) return false;
    handsPath = path;
    boneMergePairs = [];
    if (handsModel) {
      handsModel.removeFromParent();
      disposeModel(handsModel);
      handsModel = null;
    }
    if (model) {
      setupValveBipedBoneMerge();
      syncValveBipedBoneMerge();
      if (handsModel) handsModel.visible = model.visible && boneMergePairs.length > 0;
    }
    return true;
  }

  function ensureHandsModel() {
    const source = handsCache.get(handsPath)?.source;
    if (handsModel || !source) return handsModel;

    handsModel = SkeletonUtils.clone(source);
    handsModel.name = "GModHands";

    handsModel.traverse(object => {
      if (!object.isMesh) return;

      object.frustumCulled = false;
      object.castShadow = false;
      object.receiveShadow = true;

      if (Array.isArray(object.material)) {
        object.material = object.material.map(material => material.clone());
      } else if (object.material) {
        object.material = object.material.clone();
      }
    });

    rig.add(handsModel);
    handsModel.visible = false;
    return handsModel;
  }

  function preloadSound(src) {
    if (!src) return Promise.resolve();
    if (audioCache.has(src)) return audioCache.get(src);

    const audio = new Audio();
    const promise = new Promise(resolve => {
      let timer;
      const finish = () => {
        clearTimeout(timer);
        audio.removeEventListener("canplaythrough", finish);
        audio.removeEventListener("error", finish);
        resolve();
      };
      audio.preload = "auto";
      audio.src = src;
      audio.volume = 1;
      audio.addEventListener("canplaythrough", finish, { once: true });
      audio.addEventListener("error", finish, { once: true });
      // Some mobile browsers never signal canplaythrough before a gesture.
      // Optional audio must not leave the entire game stuck loading.
      timer = setTimeout(finish, 5000);
      audio.load();
    });
    audioCache.set(src, promise);
    return promise;
  }

  function switchSlot(slotNumber) {
    const index = slots.findIndex(slot => slot.id === slotNumber);
    const slot = slots[index];

    if (!slot || index === currentSlotIndex) return false;

    // Switching weapons cancels an in-progress reload. Segmented reloads
    // keep any shells already inserted because ammo is updated per shell.
    if (isReloading) cancelReload();

    currentSlotIndex = index;
    lastShotTime = Number.NEGATIVE_INFINITY;

    attachCurrentModel();

    return true;
  }

  function resetSlots() {
    slots.forEach(slot => {
      slot.ammo = slot.magazineSize;
      slot.reserveAmmo = slot.defaultReserveAmmo;
    });

    currentSlotIndex = 0;
    lastShotTime = Number.NEGATIVE_INFINITY;
    cancelReload();
    attachCurrentModel();
  }

  function shoot() {
    const slot = currentSlot();
    const now = weaponTime;

    if (currentState === "deploy") return { ok: false, reason: "deploying" };
    if (isReloading) return { ok: false, reason: "reloading" };
    if (now < shootSequenceEndTime || now - lastShotTime < slot.fireCooldownMs) {
      return { ok: false, reason: "cooldown" };
    }

    if (slot.ammo <= 0) return { ok: false, reason: "empty" };

    lastShotTime = now;
    // Start the fire animation immediately, then trigger all shot effects in
    // the same accepted-shot call. This prevents effect timing from waiting
    // on a later animation/update frame.
    play("shoot");
    triggerMuzzleFlash();
    ejectShell();
    slot.ammo -= 1;

    return { ok: true, slot: slot.id, ammo: slot.ammo };
  }

  function reload() {
    const slot = currentSlot();

    if (currentState === "deploy" || isReloading || slot.ammo === slot.magazineSize || slot.reserveAmmo <= 0) {
      return { started: false, duration: 0 };
    }

    const reloadConfig = currentModelConfig().anim?.reload;
    const segmentedReload = Array.isArray(reloadConfig) ? getSegmentedReloadActions() : null;
    if (Array.isArray(reloadConfig) && !segmentedReload) return { started: false, duration: 0 };

    // Keep every shoot segment, including the pump after the final shell.
    // Queue manual/automatic reloads on the same paused weapon clock.
    const shootDelay = Math.max(0, shootSequenceEndTime - weaponTime);
    if (shootDelay > 0) return queueReload(slot, segmentedReload, shootDelay);
    if (segmentedReload) return startSegmentedReload(slot, segmentedReload);

    isReloading = true;
    const sequenceId = ++reloadSequenceId;
    const duration = playAction(actions.get("reload"), "reload", false);
    reloadStartedAt = weaponTime;
    reloadDuration = duration;

    reloadTimer = scheduleWeaponTimer(() => {
      if (!isReloading || sequenceId !== reloadSequenceId) return;

      const needed = slot.magazineSize - slot.ammo;
      const loaded = Math.min(needed, slot.reserveAmmo);
      slot.ammo += loaded;
      slot.reserveAmmo -= loaded;
      finishReload(sequenceId);
    }, duration);

    notifyReloadStart();
    return { started: true, duration };
  }

  function queueReload(slot, segmentedReload, delay) {
    isReloading = true;
    const sequenceId = ++reloadSequenceId;
    reloadStartedAt = weaponTime + delay;
    reloadDuration = segmentedReload
      ? getSegmentedReloadDuration(slot, segmentedReload)
      : getEffectiveActionDuration("reload");

    reloadTimer = scheduleWeaponTimer(() => {
      if (!isReloading || sequenceId !== reloadSequenceId) return;
      isReloading = false;
      reload();
      }, delay);

    return { started: true, duration: delay + reloadDuration };
  }

  function getSegmentedReloadDuration(slot, { startAction, loopAction, endAction }) {
    const shellCount = Math.min(slot.magazineSize - slot.ammo, slot.reserveAmmo);
    return getActionDuration(startAction, "reload")
      + getActionDuration(loopAction, "reload") * Math.max(0, shellCount - 1)
      + getActionDuration(endAction, "reload");
  }

  function getSegmentedReloadActions() {
    const startAction = actions.get("reload:0");
    const loopAction = actions.get("reload:1");
    const endAction = actions.get("reload:2");

    if (!startAction || !loopAction || !endAction) {
      console.warn("Segmented reload requires reload_start, loop, and end animation clips.");
      return null;
    }

    return { startAction, loopAction, endAction };
  }

  function getActionDuration(action, stateName) {
    if (!action) return 0;

    const rawDuration = action.getClip().duration * 1000;
    if (stateName === "shoot") return currentSlot().fireCooldownMs;
    return rawDuration / getAnimationSpeed(stateName);
  }

  function startSegmentedReload(slot, segmentedReload) {
    const shellCount = Math.min(slot.magazineSize - slot.ammo, slot.reserveAmmo);
    if (shellCount <= 0) return { started: false, duration: 0 };

    isReloading = true;
    const sequenceId = ++reloadSequenceId;

    const startDuration = getActionDuration(segmentedReload.startAction, "reload");
    const loopCount = Math.max(0, shellCount - 1);
    const duration = getSegmentedReloadDuration(slot, segmentedReload);

    reloadStartedAt = weaponTime;
    reloadDuration = duration;

    reloadTimer = null;
    playAction(segmentedReload.startAction, "reload", false);

    reloadTimer = scheduleWeaponTimer(() => {
      if (!isReloading || sequenceId !== reloadSequenceId) return;

      // reload_start inserts the first shell.
      if (slot.ammo < slot.magazineSize && slot.reserveAmmo > 0) {
        slot.ammo += 1;
        slot.reserveAmmo -= 1;
          }

      runReloadShellLoop(slot, segmentedReload, loopCount, sequenceId);
    }, startDuration);

    notifyReloadStart();
    return { started: true, duration, shellCount };
  }

  function runReloadShellLoop(slot, segmentedReload, shellsRemaining, sequenceId) {
    if (!isReloading || sequenceId !== reloadSequenceId) return;

    if (shellsRemaining <= 0 || slot.ammo >= slot.magazineSize || slot.reserveAmmo <= 0) {
      playReloadEnd(segmentedReload, sequenceId);
      return;
    }

    const loopDuration = playAction(segmentedReload.loopAction, "reload", false);

    reloadTimer = scheduleWeaponTimer(() => {
      if (!isReloading || sequenceId !== reloadSequenceId) return;

      if (slot.ammo < slot.magazineSize && slot.reserveAmmo > 0) {
        slot.ammo += 1;
        slot.reserveAmmo -= 1;
          }

      runReloadShellLoop(slot, segmentedReload, shellsRemaining - 1, sequenceId);
    }, loopDuration);
    notifyReloadStart();
  }

  function playReloadEnd(segmentedReload, sequenceId) {
    if (!isReloading || sequenceId !== reloadSequenceId) return;

    const endDuration = playAction(segmentedReload.endAction, "reload", false);

    reloadTimer = scheduleWeaponTimer(() => finishReload(sequenceId), endDuration);
    notifyReloadStart();
  }

  function finishReload(sequenceId) {
    if (!isReloading || sequenceId !== reloadSequenceId) return;

    isReloading = false;
    reloadTimer = null;
    reloadDuration = 0;
    play("idle");
  }

  function cancelReload() {
    reloadSequenceId += 1;
    reloadTimer = null;
    isReloading = false;
    reloadStartedAt = 0;
    reloadDuration = 0;
  }

  function notifyReloadStart() {
    if (typeof onReloadStart === "function") onReloadStart();
  }

  function notifyShootSecondaryStart() {
    if (typeof onShootSecondaryStart === "function") onShootSecondaryStart();
  }

  function getCurrentAsset() {
    return currentSlot().asset;
  }

  function getHudState() {
    const slot = currentSlot();
    return {
      weaponSlot: slot.id,
      weaponName: slot.name,
      ammo: slot.ammo,
      reserveAmmo: slot.reserveAmmo,
      isReloading,
      magazineSize: slot.magazineSize,
      reloadProgress: isReloading ? Math.max(0, Math.min(1, (weaponTime - reloadStartedAt) / Math.max(1, reloadDuration))) : 0,
    };
  }

  function getWeaponList() {
    return slots.map(slot => ({ id: slot.id, name: slot.name, active: slot.id === currentSlot().id,
      ammo: slot.ammo, reserveAmmo: slot.reserveAmmo }));
  }

  function attachCurrentModel() {
    const config = currentModelConfig();
    const cached = modelCache.get(config);

    if (!cached || !cached.source) {
      clearModel();
      // Stop here on failure; reattaching a rejected asset would loop forever.
      if (cached?.failed) return;
      preloadWeaponAsset(config).then(() => {
        if (currentModelConfig() === config) {
          attachCurrentModel();
        }
      });
      return;
    }

    clearModel();

    model = SkeletonUtils.clone(cached.source);
    model.name = "WeaponMDL";
    model.visible = false;

    model.traverse(object => {
      if (!object.isMesh) return;

      object.frustumCulled = false;
      object.castShadow = false;
      object.receiveShadow = true;

      if (Array.isArray(object.material)) {
        object.material = object.material.map(material => material.clone());
      } else if (object.material) {
        object.material = object.material.clone();
      }

    });

    rig.add(model);
    resetRigTransform();
    setupAnimations(cached.animations);
    setupValveBipedBoneMerge();
    setupWeaponEffects();

    // Evaluate the deploy pose and merge the hands before either is exposed.
    // Weapons without a configured deploy action start in idle.
    play(actions.has("deploy") ? "deploy" : "idle");
    if (!activeAction) syncValveBipedBoneMerge();
    model.visible = true;
    if (handsModel) handsModel.visible = boneMergePairs.length > 0;
  }

  function setupValveBipedBoneMerge() {
    boneMergePairs = [];
    if (currentModelConfig().hands === false) {
      if (handsModel) handsModel.visible = false;
      return;
    }

    const hands = ensureHandsModel();
    if (!model || !hands) return;

    const weaponBones = collectValveBipedBones(model);
    const handBones = collectValveBipedBones(hands);

    for (const [name, targetBone] of handBones) {
      const sourceBone = weaponBones.get(name);
      if (!sourceBone) continue;

      boneMergePairs.push({
        sourceBone,
        targetBone,
        depth: getObjectDepth(targetBone, hands)
      });
    }

    boneMergePairs.sort((a, b) => a.depth - b.depth);

    if (!boneMergePairs.length) {
      hands.visible = false;
      console.warn("No matching ValveBiped bones found for hands bone merge", {
        weaponBones: Array.from(weaponBones.keys()),
        handBones: Array.from(handBones.keys())
      });
      return;
    }

    // attachCurrentModel reveals the hands after the initial animated pose.
  }

  function collectValveBipedBones(root) {
    const bones = new Map();

    root.traverse(object => {
      if (!object.isBone) return;

      const canonicalName = getCanonicalValveBipedBoneName(object.name);
      if (!canonicalName) return;

      bones.set(canonicalName, object);
    });

    return bones;
  }

  function getCanonicalValveBipedBoneName(name) {
    if (!name) return null;

    // Source bones use Three.js PropertyBinding names. Apply the same rules
    // to authored names so the weapon and shared hands match after cloning.
    const runtimeName = THREE.PropertyBinding.sanitizeNodeName(String(name));
    if (!runtimeName.startsWith(VALVEBIPED_MERGE_PREFIX)) return null;

    return runtimeName;
  }

  function getObjectDepth(object, root) {
    let depth = 0;
    let current = object;

    while (current && current !== root) {
      depth += 1;
      current = current.parent;
    }

    return depth;
  }

  function syncValveBipedBoneMerge() {
    if (!model) return;
    updateSourceProceduralBones(model);
    if (!handsModel || !boneMergePairs.length) return;

    // GMod-style bone merge: each c_hands ValveBiped bone is driven by the
    // matching animated view-model bone in world space. This deliberately
    // ignores the hands model's own hierarchy and uses no hand offsets.
    model.updateWorldMatrix(true, true);
    handsModel.updateWorldMatrix(true, true);

    for (const { sourceBone, targetBone } of boneMergePairs) {
      const parent = targetBone.parent;

      if (parent) {
        parent.updateWorldMatrix(true, false);
        boneMergeParentInverse.copy(parent.matrixWorld).invert();
        boneMergeLocalMatrix.multiplyMatrices(boneMergeParentInverse, sourceBone.matrixWorld);
      } else {
        boneMergeLocalMatrix.copy(sourceBone.matrixWorld);
      }

      boneMergeLocalMatrix.decompose(
        targetBone.position,
        targetBone.quaternion,
        targetBone.scale
      );

      targetBone.updateMatrix();
      targetBone.updateWorldMatrix(false, false);
    }

    updateSourceProceduralBones(handsModel);
    handsModel.updateWorldMatrix(false, true);
  }

  function clearModel() {
    if (mixer) {
      mixer.stopAllAction();
      if (model) mixer.uncacheRoot(model);
    }

    // Detach the shared effect sprite before disposing the current weapon tree.
    // Otherwise disposeModel() would dispose the reusable muzzle flash material.
    if (muzzleFlashSprite.parent) muzzleFlashSprite.parent.remove(muzzleFlashSprite);

    if (model) {
      rig.remove(model);
      disposeModel(model);
    }

    muzzleFlashSprite.material.opacity = 0;
    muzzleLight.intensity = 0;
    muzzleFlashTime = 0;
    flashlightActive = false;
    flashlight.intensity = 0;
    attachmentBone = null;
    muzzleFlashBone = null;

    model = null;
    boneMergePairs = [];
    if (handsModel) handsModel.visible = false;
    mixer = null;
    activeAction = null;
    actions.clear();
    returnTimer = null;
    shootSequenceEndTime = 0;
    currentState = "idle";
    currentStateTime = 0;
    currentStateDuration = 0;
  }

  function disposeModel(root) {
    const skeletons = new Set();
    const materials = new Set();
    root.traverse(object => {
      if (object.isSkinnedMesh) skeletons.add(object.skeleton);
      if (object.material) [].concat(object.material).forEach(material => materials.add(material));
    });
    // Keep cached geometry/maps and the separate, persistent hands model.
    skeletons.forEach(skeleton => skeleton.dispose());
    materials.forEach(material => material.dispose());
  }

  function setupAnimations(clips) {
    const config = currentModelConfig();
    const assetAnim = config.anim || {};

    mixer = new THREE.AnimationMixer(model);

    Object.entries(assetAnim).forEach(([name, clipSpec]) => {
      if ((name === "reload" || name === "shoot") && Array.isArray(clipSpec)) {
        if (name === "reload" && clipSpec.length !== 3) {
          console.warn("Segmented reload must use exactly 3 clips: [start, loop, end].");
          return;
        }

        if (!clipSpec.length) {
          console.warn("Shoot animation sequence must contain at least one clip name.");
          return;
        }

        clipSpec.forEach((clipName, index) => {
          if (typeof clipName !== "string" || !clipName.trim()) {
            console.warn(`Weapon ${name} animation at index ${index} must be a clip name.`);
            return;
          }

          const clip = findAnimationClip(clips, clipName);
          if (!clip) {
            console.warn(`Missing weapon animation clip: ${clipName}`);
            return;
          }

          if (name === "shoot" && (!Number.isFinite(clip.duration) || clip.duration < 0)) {
            console.warn(`Invalid weapon animation duration: ${clipName}`);
            return;
          }

          const action = mixer.clipAction(clip);
          action.setLoop(THREE.LoopOnce, 1);
          action.clampWhenFinished = true;
          actions.set(`${name}:${index}`, action);
        });
        return;
      }

      if (typeof clipSpec !== "string" || !clipSpec.trim()) {
        console.warn(`Weapon animation action must be a clip name: ${name}`);
        return;
      }

      const clip = findAnimationClip(clips, clipSpec);

      if (!clip) {
        console.warn(`Missing weapon animation clip: ${clipSpec}`);
        return;
      }

      const action = mixer.clipAction(clip);
      const loop = isLoopingAnimation(name);
      action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
      action.clampWhenFinished = !loop;
      actions.set(name, action);
    });
  }

  function findAnimationClip(animations, name) {
    const wanted = String(name).trim().toLowerCase();

    return animations.find(clip => {
      const clipName = String(clip.name || "").trim().toLowerCase();
      return clipName === wanted;
    }) || null;
  }

  function isLoopingAnimation(name) {
    return name === "idle";
  }

  function getAnimationSpeed(name) {
    const config = currentModelConfig();
    const behavior = config.behavior ?? {};

    const speed = name === "reload"
      ? (behavior.reloadSpeed ?? 1)
      : 1;

    const baseSpeed = Math.max(Number(speed) || 1, 0.01);
    return baseSpeed;
  }

  function getShootSequenceActions() {
    return currentModelConfig().anim.shoot
      .map((clipName, index) => actions.get(`shoot:${index}`))
      .filter(Boolean);
  }

  function getEffectiveActionDuration(name) {
    if (name === "shoot" && Array.isArray(currentModelConfig().anim?.shoot)) {
      const rawDuration = getShootSequenceActions().reduce((sum, action) => sum + action.getClip().duration, 0);
      return rawDuration > 0 ? currentSlot().fireCooldownMs : 0;
    }
    return getActionDuration(actions.get(name), name);
  }

  function play(name) {
    shootSequenceEndTime = 0;
    if (name === "shoot" && Array.isArray(currentModelConfig().anim?.shoot)) {
      return playShootSequence();
    }
    return playAction(actions.get(name), name, true);
  }

  function playShootSequence() {
    const sequence = getShootSequenceActions();
    const rawDuration = sequence.reduce((sum, action) => sum + action.getClip().duration, 0);
    if (rawDuration <= 0) return 0;

    // Scale the complete sequence to one firing cooldown, preserving the
    // authored duration ratio.
    const duration = currentSlot().fireCooldownMs;
    const startedAt = weaponTime;
    let elapsedRawTime = 0;
    shootSequenceEndTime = startedAt + duration;

    function playSegment(index) {
      if (index >= sequence.length) {
        play("idle");
        return;
      }

      const action = sequence[index];
      elapsedRawTime += action.getClip().duration;
      const endsAt = index === sequence.length - 1 ? shootSequenceEndTime
        : startedAt + elapsedRawTime / rawDuration * duration;
      const segmentDuration = Math.max(0, endsAt - weaponTime);
      playAction(action, "shoot", false, segmentDuration);
      returnTimer = scheduleWeaponTimer(() => playSegment(index + 1), segmentDuration);
      // Only the configured second clip triggers its mechanical sound.
      // A missing second clip must not transfer that sound to a later clip.
      if (index === 1 && action === actions.get("shoot:1")) notifyShootSecondaryStart();
    }

    playSegment(0);
    return duration;
  }

  function playAction(action, stateName, autoReturnToIdle = true, duration = getActionDuration(action, stateName)) {
    if (stateName !== "shoot") shootSequenceEndTime = 0;
    currentState = stateName;
    currentStateTime = 0;
    returnTimer = null;

    if (!action) return 0;

    const previousAction = activeAction;
    const segmentedReload = stateName === "reload" && Array.isArray(currentModelConfig().anim?.reload);
    // A first activation or a same-action restart has no outgoing pose to
    // fade from. Reload segments are authored to join directly at full weight.
    const canCrossFade = previousAction && previousAction !== action
      && previousAction.enabled && previousAction.isScheduled()
      && previousAction.getEffectiveWeight() >= 1 - 1e-6
      && stateName !== "shoot" && !segmentedReload;

    // Remove stale/clamped actions and interrupted fades. Only a valid
    // outgoing action may keep contributing alongside the incoming action.
    for (const otherAction of actions.values()) {
      if (otherAction !== action && (!canCrossFade || otherAction !== previousAction)) {
        otherAction.stop();
      }
    }

    const loop = isLoopingAnimation(stateName);
    const rawDuration = action.getClip().duration * 1000;

    action.reset();
    action.enabled = true;
    action.setEffectiveWeight(1);
    action.timeScale = stateName === "shoot"
      ? (duration > 0 ? rawDuration / duration : 1)
      : getAnimationSpeed(stateName);
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = !loop;
    action.play();
    if (canCrossFade) {
      // Equal fade durations keep total animation influence at one instead
      // of briefly mixing the model's bind pose into a transition.
      previousAction.setEffectiveWeight(1).fadeOut(0.04);
      action.fadeIn(0.04);
    }
    activeAction = action;
    currentStateDuration = duration;

    // Prepare weapon AND hands together, including transitions between
    // reload segments within the same gameplay update.
    mixer.update(0);
    syncValveBipedBoneMerge();

    if (!loop && autoReturnToIdle) {
      returnTimer = scheduleWeaponTimer(() => play("idle"), duration);
    }

    return duration;
  }

  function scheduleWeaponTimer(callback, duration) {
    return { callback, at: weaponTime + Math.max(0, duration) };
  }

  function advanceWeaponTime(time) {
    const delta = Math.max(0, time - weaponTime) / 1000;
    weaponTime = time;
    currentStateTime += delta;
    if (mixer) mixer.update(delta);
  }

  function updateAnimationTimers(delta) {
    const endTime = weaponTime + delta * 1000;

    // Advance the mixer to each transition before running it, then give the
    // next clip the remaining frame time. Shoot/reload segments stay in sync
    // with their effects/ammo, even when a frame crosses several boundaries.
    while (true) {
      const timer = !returnTimer ? reloadTimer : !reloadTimer ? returnTimer
        : returnTimer.at <= reloadTimer.at ? returnTimer : reloadTimer;
      if (!timer || timer.at > endTime) break;

      advanceWeaponTime(Math.max(weaponTime, timer.at));
      if (timer === returnTimer) returnTimer = null;
      if (timer === reloadTimer) reloadTimer = null;
      timer.callback();
    }

    advanceWeaponTime(endTime);
  }

  function update(delta, isPlaying, inputState) {
    // All weapon motion AND completion timers freeze on gameplay overlays.
    // Keep the current action/pose so resuming continues rather than restarts.
    if (!isPlaying) return;

    updateAnimationTimers(delta);
    updateShells(delta);
    syncValveBipedBoneMerge();
    updateMuzzleFlash(delta);

    const horizontalSpeed = Math.hypot(playerVelocity.x, playerVelocity.z);
    const moveFactor = Math.min(horizontalSpeed / 8.5, 1);
    const moving = Boolean(inputState?.moving && isPlaying);
    const walking = Boolean(inputState?.walking);

    if (moving && inputState?.grounded) bobTime += delta * settings.bobSpeed * (walking ? 0.72 : 1);
    else bobTime = THREE.MathUtils.lerp(bobTime, 0, 1 - Math.exp(-8 * delta));

    const swayTargetX = THREE.MathUtils.clamp(-(inputState?.mouseDeltaX ?? 0) * settings.swayAmount, -settings.swayMax, settings.swayMax);
    const swayTargetY = THREE.MathUtils.clamp(-(inputState?.mouseDeltaY ?? 0) * settings.swayAmount, -settings.swayMax, settings.swayMax);

    swayX = THREE.MathUtils.lerp(swayX, swayTargetX, 1 - Math.exp(-18 * delta));
    swayY = THREE.MathUtils.lerp(swayY, swayTargetY, 1 - Math.exp(-18 * delta));

    applyMotion(delta, moveFactor, inputState);
  }

  function applyMotion(delta, moveFactor, inputState) {
    getBasePosition(targetPosition);
    getBaseRotation(targetRotation);

    const bobX = Math.sin(bobTime) * settings.bobAmount * moveFactor;
    const bobY = Math.abs(Math.cos(bobTime * 2)) * settings.bobAmount * moveFactor;
    const lag = THREE.MathUtils.clamp(Math.hypot(playerVelocity.x, playerVelocity.z) / 8.5, 0, 1) * settings.lagAmount;
    const strafeTilt = THREE.MathUtils.clamp(playerVelocity.x / 8.5, -1, 1) * settings.tiltAmount * moveFactor;

    targetPosition.x += bobX + swayX;
    targetPosition.y += bobY + swayY;
    targetPosition.z += lag;

    targetRotation.y += swayX * 0.55;
    targetRotation.z += strafeTilt + swayX * 0.4;

    if (currentState === "reload") {
      const reloadDuration = Math.max(currentStateDuration / 1000, 0.001);
      const k = Math.sin(Math.min(currentStateTime / reloadDuration, 1) * Math.PI);
      targetPosition.y -= 0.06 * k;
      targetRotation.z += 0.12 * k;
    }

    const blend = 1 - Math.exp(-settings.motionBlend * delta);
    rig.position.lerp(targetPosition, blend);
    rig.rotation.x = THREE.MathUtils.lerp(rig.rotation.x, targetRotation.x, blend);
    rig.rotation.y = THREE.MathUtils.lerp(rig.rotation.y, targetRotation.y, blend);
    rig.rotation.z = THREE.MathUtils.lerp(rig.rotation.z, targetRotation.z, blend);
  }

  function resetRigTransform() {
    getBasePosition(targetPosition);
    getBaseRotation(targetRotation);
    rig.position.copy(targetPosition);
    rig.rotation.copy(targetRotation);
    rig.scale.set(1, 1, 1);
  }

  function getShellEjectConfig() {
    const config = currentModelConfig();

    return {
      boneName: config.shellEject ?? null,
      gravity: 15,
      life: 1.5,
      spin: 5,
      scale: 1
    };
  }

  function findWeaponObjectByName(name) {
    if (!model || !name) return null;

    const exact = model.getObjectByName(name);
    if (exact) return exact;

    const wanted = THREE.PropertyBinding.sanitizeNodeName(String(name)).toLowerCase();
    let match = null;

    model.traverse(object => {
      if (match || !object.name) return;
      const runtimeName = THREE.PropertyBinding.sanitizeNodeName(String(object.name)).toLowerCase();
      if (runtimeName === wanted) match = object;
    });

    return match;
  }

  function getShellEjectLocalPosition(shellConfig, target) {
    const ejectObject = findWeaponObjectByName(shellConfig.boneName);
    if (!ejectObject) return null;

    ejectObject.getWorldPosition(target);
    // The view-model parent now follows the world camera. Shell simulation
    // still uses its original local coordinates, just like weapon animations.
    return weaponScene.worldToLocal(target);
  }

  function getShellEjectVelocity(target) {
    target.set(
      -(8.5 + Math.random() * 2.2),
      3.4 + Math.random() * 1.2,
      0.9 + Math.random() * 1.1
    );

    return target.applyQuaternion(rig.quaternion);
  }

  function ejectShell() {
    const shellConfig = getShellEjectConfig();
    const shellPosition = getShellEjectLocalPosition(shellConfig, tempShellPosition);

    if (!shellPosition) return;

    const shell = new THREE.Mesh(shellGeometry, shellMaterial.clone());
    shell.receiveShadow = true;
    shell.material.transparent = true;
    shell.material.opacity = 1;

    shell.position.copy(shellPosition);
    shell.position.add(
      new THREE.Vector3(
        (Math.random() - 0.5) * 0.08,
        (Math.random() - 0.5) * 0.08,
        (Math.random() - 0.5) * 0.08
      )
    );
    shell.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    shell.scale.setScalar(shellConfig.scale);
    shell.userData.velocity = getShellEjectVelocity(tempShellVelocity).clone();
    shell.userData.life = shellConfig.life;
    shell.userData.maxLife = shellConfig.life;
    shell.userData.gravity = shellConfig.gravity;
    shell.userData.spin = shellConfig.spin;

    weaponScene.add(shell);
    shells.push(shell);
  }

  function updateShells(delta) {
    for (let i = shells.length - 1; i >= 0; i--) {
      const shell = shells[i];
      shell.userData.life -= delta;
      shell.userData.velocity.y -= shell.userData.gravity * delta;
      shell.position.addScaledVector(shell.userData.velocity, delta);
      shell.rotation.x += shell.userData.spin * delta;
      shell.rotation.z += shell.userData.spin * 0.55 * delta;

      const fadeStart = shell.userData.maxLife * 0.35;
      const alpha = shell.userData.life > fadeStart ? 1 : Math.max(0, shell.userData.life / fadeStart);
      shell.material.opacity = alpha;

      if (shell.userData.life <= 0) {
        weaponScene.remove(shell);
        shell.material.dispose();
        shells.splice(i, 1);
      }
    }
  }

  function setupWeaponEffects() {
    const config = currentModelConfig();
    attachmentBone = findWeaponObjectByName(config.attachment);
    muzzleFlashBone = findWeaponObjectByName(config.muzzleFlash);

    if (config.attachment && !attachmentBone) {
      console.warn(`Missing weapon flashlight attachment bone: ${config.attachment}`);
    }

    if (config.muzzleFlash && !muzzleFlashBone) {
      console.warn(`Missing weapon muzzle flash bone: ${config.muzzleFlash}`);
    }

    if (muzzleFlashSprite.parent) muzzleFlashSprite.parent.remove(muzzleFlashSprite);
    if (muzzleFlashBone) {
      muzzleFlashBone.add(muzzleFlashSprite);
      muzzleFlashSprite.position.set(0, 0, 0);
      muzzleFlashSprite.visible = true;
      muzzleFlashSprite.material.opacity = 0;
    }

    setFlashlight(false);
  }

  function triggerMuzzleFlash() {
    if (!muzzleFlashBone) return;

    muzzleFlashTime = 0.055;
    muzzleFlashSprite.material.opacity = 1;
    muzzleFlashSprite.material.rotation = Math.random() * Math.PI;
    const scale = 4.5 + Math.random() * 1.4;
    muzzleFlashSprite.scale.set(scale, scale, 1);
    muzzleLight.intensity = 32;
  }

  function updateMuzzleFlash(delta) {
    if (muzzleFlashTime <= 0 || !muzzleFlashBone) {
      muzzleFlashTime = 0;
      muzzleFlashSprite.material.opacity = 0;
      muzzleLight.intensity = 0;
      return;
    }

    muzzleFlashTime = Math.max(0, muzzleFlashTime - delta);
    const strength = Math.min(1, muzzleFlashTime / 0.055);
    muzzleFlashSprite.material.opacity = strength;
    muzzleLight.intensity = 10 + 22 * strength;
  }

  function setFlashlight(active) {
    flashlightActive = Boolean(active && attachmentBone);
    flashlight.intensity = flashlightActive ? FLASHLIGHT_INTENSITY : 0;

    // Apply the attachment transform immediately on activation instead of
    // waiting for the next animation/update pass. The normal render sync will
    // continue tracking the animated bone every frame after this.
    if (flashlightActive) syncFlashlightTransform();
  }

  function hasScope() {
    const behavior = currentModelConfig().behavior;
    // Existing snipers keep their scope; other weapons opt in independently.
    return Boolean(behavior.hasScope || behavior.isSniper);
  }

  function hasFlashlightAttachment() {
    return Boolean(currentModelConfig().attachment);
  }

  function isFlashlightActive() {
    return flashlightActive;
  }

  function syncFlashlightTransform() {
    if (!model || !attachmentBone) return;

    model.updateWorldMatrix(true, true);
    attachmentBone.getWorldPosition(effectPosition);
    attachmentBone.getWorldQuaternion(effectQuaternion);
    flashlight.position.copy(effectPosition);

    const attachmentRotation = currentModelConfig().attachmentRotation ?? [0, 0, 0];
    attachmentRotationEuler.set(
      attachmentRotation[0] ?? 0,
      attachmentRotation[1] ?? 0,
      attachmentRotation[2] ?? 0,
      "XYZ"
    );
    attachmentRotationQuaternion.setFromEuler(attachmentRotationEuler);
    effectQuaternion.multiply(attachmentRotationQuaternion);

    effectDirection.set(0, 0, 1).applyQuaternion(effectQuaternion).normalize();
    cameraForward.set(0, 0, -1).applyQuaternion(weaponCamera.quaternion).normalize();
    if (effectDirection.dot(cameraForward) < 0) effectDirection.negate();

    flashlightTarget.position.copy(effectPosition).addScaledVector(effectDirection, 24);
    flashlightTarget.updateMatrixWorld(true);
  }

  function syncWorldEffects() {
    if (!model) {
      flashlight.intensity = 0;
      muzzleLight.intensity = 0;
      return;
    }

    model.updateWorldMatrix(true, true);

    if (attachmentBone && flashlightActive) {
      syncFlashlightTransform();
      flashlight.intensity = FLASHLIGHT_INTENSITY;
    } else {
      flashlight.intensity = 0;
    }

    if (muzzleFlashBone) {
      // Keep the zero-intensity point light registered with the renderer so
      // first fire never changes the scene's light-count shader variant.
      muzzleFlashBone.getWorldPosition(muzzleLight.position);
    } else {
      muzzleLight.intensity = 0;
    }
  }

  function getBasePosition(target) {
    return target.set(0, 0, 0);
  }

  function getBaseRotation(target) {
    return target.set(0, -Math.PI, 0);
  }

  function getMuzzlePosition(target) {
    if (!muzzleFlashBone || !model?.visible) return null;
    return muzzleFlashBone.getWorldPosition(target);
  }

  return {
    rig,
    preloadAll,
    setHandsModel,
    update,
    shoot,
    reload,
    switchSlot,
    resetSlots,
    getHudState,
    getWeaponList,
    getCurrentAsset,
    getMuzzlePosition,
    setFlashlight,
    hasScope,
    hasFlashlightAttachment,
    isFlashlightActive,
    syncWorldEffects
  };
}
