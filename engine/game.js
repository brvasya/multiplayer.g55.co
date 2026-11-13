import { importEngine } from "./importEngine.js";
import { shotDirections } from "./rules.js";
import { createMultiplayerActors } from "./actors.js";
import { createPlayerHitboxes } from "./hitboxes.js";

export async function createMultiplayerGame(hooks, config) {
  const { assets, rules } = config;
  const [THREE, { createPlayer }, { createWeaponSystem }, { createMapWorld }, { createHud },
    { createSounds }, { createTouchControls }, { createPlayerSpawns }, { createProjectiles },
    { createImpactParticles }, { createBulletHoles }, { createCharacterPreview }, { createWorldMuzzleFlashes }] = await Promise.all([
    importEngine("vendor/three.module.js"), importEngine("player.js"), importEngine("weapon.js"),
    importEngine("mapManager.js"), importEngine("hud.js"), importEngine("sounds.js"), importEngine("touchControls.js"),
    importEngine("spawnPoints.js"), importEngine("projectiles.js"),
    importEngine("impactParticles.js"), importEngine("bulletHoles.js"), importEngine("characterPreview.js"),
    importEngine("muzzleFlash.js")
  ]);
  hooks.progress?.(5);
  const scene = new THREE.Scene(), weaponScene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, .02, 500);
  const weaponCamera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, .001 * .0254, 100 * .0254);
  const weaponRoot = new THREE.Group(); weaponRoot.scale.setScalar(.0254); weaponScene.add(weaponRoot);
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1, Math.sqrt(1600 * 900 / (innerWidth * innerHeight)))); renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true; renderer.autoClear = false;
  document.body.appendChild(renderer.domElement);
  const world = createMapWorld({ THREE, scene, maps: config.maps });
  const player = createPlayer({ THREE, camera, colliders: world.colliders, lockTarget: renderer.domElement, config: config.player });
  const sounds = createSounds(config.sounds);
  const hud = createHud();
  const weapon = createWeaponSystem({ THREE, weaponScene: weaponRoot, worldScene: scene, weaponCamera,
    playerVelocity: player.velocity, handsAsset: assets.hands,
    weaponSlots: assets.weaponSlots,
    onReloadStart: () => sounds.playReload(), onShootSecondaryStart: () => sounds.playReload() });
  const weapons = Object.fromEntries(assets.weaponSlots.map(s => [s.id, { ...s.asset.behavior }]));
  const projectiles = createProjectiles({ THREE, scene });
  const muzzleEffects = createWorldMuzzleFlashes({ THREE, scene, capacity: rules.maxPlayers - 1 });
  const impacts = createImpactParticles({ THREE, scene, colliders: world.colliders });
  const impactSurfaces = [];
  const bulletHoles = createBulletHoles({ THREE, scene, surfaces: impactSurfaces });
  const seenExplosions = new Set();
  let projectileRound = null;
  const traces = [];
  const tracerStart = new THREE.Vector3();
  const raycaster = new THREE.Raycaster(), origin = new THREE.Vector3(), direction = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();
  let ready = false, paused = true, chatting = false, inRoom = false, local = null, localLife = -1;
  let scoped = false, arena, actors, hitboxes;
  let lastFrame = performance.now(), frame, viewPunch = 0;
  const lightPairs = [];
  const previews = new Set();
  const touch = createTouchControls({
    isActive: () => inRoom && !paused && !chatting && local?.hp > 0 && !hooks.isEnded(),
    setMove: (x, y) => player.setTouchMove(x, y), setFire: active => { player.setFiring(active); if (active) fire(); },
    look: (x, y) => player.addLookDelta(x, y, scoped ? .2 : .72), jump: () => player.queueJump(),
    toggleCrouch: () => { if (active()) player.toggleCrouch(); },
    reload: () => reload(), toggleScope: () => secondary(!scoped), clearScope: () => secondary(false),
    pause: () => hooks.pause(), openChat: () => hooks.openChat(), getWeapons: () => weapon.getWeaponList(),
    switchWeapon: slot => switchWeapon(slot), getStatus: () => ({ ...weapon.getHudState(),
      crouched: player.inputState.crouched,
      canScope: weapon.hasScope() || weapon.hasFlashlightAttachment(), scoped: scoped || weapon.isFlashlightActive(),
      secondaryLabel: weapon.hasScope() ? "Scope" : "Light" })
  });

  const manager = THREE.DefaultLoadingManager, previousProgress = manager.onProgress;
  manager.onProgress = (url, loaded, total) => {
    previousProgress?.call(manager, url, loaded, total);
    if (total > 0) hooks.progress?.(5 + loaded / total * 90);
  };
  try {
    const models = createMultiplayerActors({ scene, world, asset: assets.character, weaponSlots: assets.weaponSlots,
      rules, localId: hooks.localId, makeLabel: label, muzzleEffects })
      .then(value => { actors = value; });
    await Promise.all([world.ready, weapon.preloadAll(), models]);
    hooks.progress?.(95);
    hitboxes = createPlayerHitboxes({ models: actors.characterModels, appearanceSchema: actors.appearanceSchema,
      weaponSlots: assets.weaponSlots, rules });
    await loadMap(world.mapId);
    hooks.progress?.(99);
  } finally {
    manager.onProgress = previousProgress;
  }
  weapon.switchSlot(rules.defaultWeaponSlot); ready = true;
  frame = requestAnimationFrame(animate);

  function lights() {
    for (const { source, copy } of lightPairs) { source.removeFromParent(); copy.removeFromParent(); copy.target?.removeFromParent(); source.dispose?.(); }
    lightPairs.length = 0;
    const l = world.lighting || {};
    const hemi = new THREE.HemisphereLight(l.hemisphereSky ?? 0xffffff, l.hemisphereGround ?? 0x666666, l.hemisphereIntensity ?? 1.5);
    const sun = new THREE.DirectionalLight(l.sunColor ?? 0xffffff, l.sunIntensity ?? 1.5);
    sun.position.set(...(l.sunPosition || [10, 30, 8]));
    sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -65, right: 65, top: 65, bottom: -65, near: .5, far: 180 });
    sun.shadow.bias = -.00025; sun.shadow.normalBias = .06;
    for (const source of [hemi, sun]) {
      scene.add(source);
      const copy = source.clone(); copy.castShadow = false;
      weaponScene.add(copy); if (copy.target) weaponScene.add(copy.target);
      lightPairs.push({ source, copy });
    }
  }
  async function loadMap(id) {
    ready = false;
    if (!config.maps.items.some(m => m.id === id)) throw new Error("This room uses an unknown map.");
    actors.clear(); hitboxes.clear();
    clearImpacts(); impactSurfaces.length = 0;
    projectiles.clear(); seenExplosions.clear(); projectileRound = null;
    if (world.mapId !== id) await world.selectMap(id);
    scene.updateMatrixWorld(true);
    // Only static map meshes are decal surfaces: exclude players, weapons and
    // cosmetic effects. All map collision proxies belong to these map roots.
    const roots = new Set(world.colliders.map(collider => {
      let root = collider;
      while (root.parent && root.parent !== scene) root = root.parent;
      return root;
    }));
    for (const root of roots) root.traverseVisible(object => {
      if (object.isMesh && [].concat(object.material).every(material => material.visible)) impactSurfaces.push(object);
    });
    arena = createPlayerSpawns({ THREE, navigation: world.navigation, floorObjects: world.floorObjects,
      colliders: world.colliders, spawn: world.spawn, playerHeight: rules.playerHeight });
    lights(); world.resetPlayer(player);
    ready = true;
  }
  function spawn(_id, others) {
    const point = arena.getSpawnPoint(others.map(p => new THREE.Vector3(...p.p)));
    // The host retries a blocked respawn; never fall back onto an occupied start.
    if (!point) return null;
    return { p: [point.x, point.y + rules.playerHeight, point.z], yaw: arena.facing(point) };
  }
  function wallDistance(p, d, maxDistance = 160) {
    return wallHit(p, d, maxDistance)?.distance ?? Infinity;
  }
  function wallHit(p, d, maxDistance = 160) {
    origin.fromArray(p); direction.fromArray(d);
    raycaster.set(origin, direction); raycaster.near = 0; raycaster.far = maxDistance;
    const hit = raycaster.intersectObjects(world.colliders, false)[0];
    if (!hit?.face) return null;
    return { distance: hit.distance, point: hit.point.toArray(),
      normal: hit.face.normal.clone().applyNormalMatrix(normalMatrix.getNormalMatrix(hit.object.matrixWorld)).toArray() };
  }
  function label(name) {
    const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 48;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff0bd";
    ctx.font = "600 23px system-ui"; ctx.textAlign = "center";
    ctx.strokeStyle = "#000"; ctx.lineWidth = 4; ctx.lineJoin = "round";
    const text = name.slice(0, 20);
    ctx.strokeText(text, 128, 32, 244);
    ctx.fillText(text, 128, 32, 244);
    const material = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthTest: true, depthWrite: false });
    const sprite = new THREE.Sprite(material); sprite.position.y = 2.2; sprite.scale.set(2, .375, 1);
    return sprite;
  }
  function poseActor(p) {
    actors.pose(p);
  }
  function setAppearance(appearance) {
    const index = actors.appearanceSchema.models.findIndex(entry => entry.model === appearance?.model);
    weapon.setHandsModel(Math.max(0, index));
  }
  function setState(state) {
    if (!ready) return;
    const me = state.players[hooks.localId()];
    actors.sync(state.players);
    if (projectileRound !== state.round) {
      clearImpacts();
      projectiles.clear(); seenExplosions.clear(); projectileRound = state.round;
    }
    projectiles.syncNetwork(state.projectiles);
    for (const blast of state.explosions) {
      if (seenExplosions.has(blast.id)) continue;
      seenExplosions.add(blast.id);
      const position = new THREE.Vector3(...blast.p);
      projectiles.showExplosion(position, blast.radius);
      const distance = camera.position.distanceTo(position);
      sounds.playExplosion(distance);
      viewPunch = Math.max(viewPunch, .04 * Math.max(0, 1 - distance / 18));
    }
    if (me) {
      if (!local || me.appearance?.model !== local.appearance?.model) setAppearance(me.appearance);
      if (me.life !== localLife && me.hp > 0) {
        localLife = me.life; player.reset({ position: new THREE.Vector3(...me.p), yaw: me.yaw });
        weapon.resetSlots(); weapon.switchSlot(me.slot || rules.defaultWeaponSlot); secondary(false);
      }
      if (local && me.hp < local.hp) {
        sounds.playPlayerHit();
        const flash = document.getElementById("damageFlash"); flash.style.opacity = ".6";
        setTimeout(() => { flash.style.opacity = "0"; }, 160);
        if (me.hp === 0) { sounds.playPlayerDie(); player.clearMovement(); secondary(false); }
      }
      local = { ...me };
    }
  }
  function running(allowPicker = false) { return ready && inRoom && !paused && local?.hp > 0 && !hooks.isEnded() && !document.hidden && (allowPicker || !touch.isPickerOpen) && !touch.isPortrait(); }
  function active(allowPicker = false) { return !chatting && running(allowPicker); }
  function setChatting(value) {
    chatting = value; player.clearMovement(); touch.reset(); secondary(false);
    touch.update();
    if (value && document.pointerLockElement) document.exitPointerLock();
  }
  function setPaused(value) {
    paused = value; player.clearMovement(); touch.reset(); secondary(false);
    if (value) chatting = false;
    if (value && document.pointerLockElement) document.exitPointerLock();
  }
  async function capture() {
    sounds.resume();
    if (touch.enabled) { paused = false; return true; }
    try {
      await renderer.domElement.requestPointerLock();
      if (document.pointerLockElement === renderer.domElement) { paused = false; return true; }
      // Older browsers signal completion through pointerlockchange.
      return await new Promise(resolve => {
        const done = () => { cleanup(); paused = document.pointerLockElement !== renderer.domElement; resolve(!paused); };
        const cleanup = () => { clearTimeout(timeout); document.removeEventListener("pointerlockchange", done); };
        const timeout = setTimeout(done, 1200); document.addEventListener("pointerlockchange", done);
      });
    } catch { return false; }
  }
  function secondary(pressed) {
    if (pressed && !active()) return;
    if (weapon.hasScope()) scoped = pressed;
    else if (pressed && weapon.hasFlashlightAttachment()) weapon.setFlashlight(!weapon.isFlashlightActive());
    if (!pressed) scoped = false;
    camera.fov = scoped ? (weapon.getCurrentAsset().behavior.zoomFov ?? 22) : 75; camera.updateProjectionMatrix(); hud.setScope(scoped);
  }
  function switchWeapon(slot) { if (!active(true)) return false; secondary(false); return weapon.switchSlot(slot); }
  function toggleSound() {
    const muted = sounds.toggleMute(); sounds.resume(); hooks.soundChanged?.(muted); return muted;
  }
  function reload() { if (active()) weapon.reload(); }
  function fire() {
    if (!active()) return;
    const shot = weapon.shoot();
    if (!shot.ok) { if (shot.reason === "empty") reload(); return; }
    const direction = camera.getWorldDirection(new THREE.Vector3()).toArray();
    const data = { direction, slot: shot.slot, seed: (Math.random() * 0x7fffffff) | 0, life: localLife };
    sounds.playShoot(weapon.getCurrentAsset()); hud.setCrosshairFire(); viewPunch = .012;
    showShot({ actor: hooks.localId(), origin: camera.position.toArray(), ...data }, true);
    hooks.fire(data);
    if (!shot.ammo) reload();
  }
  function showShot(shot, predicted = false) {
    if (!ready || (!predicted && shot.actor === hooks.localId())) return;
    const gun = weapons[shot.slot]; if (!gun) return;
    actors.showShot(shot);
    if (!predicted) {
      const d = camera.position.distanceTo(new THREE.Vector3(...shot.origin));
      if (d < 65) sounds.playAudio(new Audio(assets.weaponSlots.find(s => s.id === shot.slot).asset.fireSound), Math.max(.02, .22 * (1 - d / 65)));
    }
    if (gun.projectile) return;
    for (const dir of shotDirections(shot.direction, gun.spread, gun.pellets, shot.seed)) {
      const end = new THREE.Vector3(...shot.origin).addScaledVector(new THREE.Vector3(...dir), Math.min(160, wallDistance(shot.origin, dir)));
      const start = new THREE.Vector3(...shot.origin);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([start, end]), new THREE.LineBasicMaterial({ color: 0xffdf93, transparent: true, opacity: .7 }));
      // Resolve the muzzle after this frame's animation and camera transforms.
      line.visible = false;
      scene.add(line); traces.push({ line, life: .07, shot });
    }
  }
  function updateTraces(delta) {
    for (let i = traces.length - 1; i >= 0; i--) {
      const trace = traces[i], shot = trace.shot;
      if (shot) {
        tracerStart.fromArray(shot.origin);
        if (shot.actor === hooks.localId()) {
          if (!scoped && local?.hp > 0 && shot.life === localLife && shot.slot === weapon.getHudState().weaponSlot
              && weapon.getMuzzlePosition(tracerStart)) {
            // Match the viewmodel's screen position in the world camera while
            // preserving depth: their FOVs and near/far planes are different.
            tracerStart.applyMatrix4(weaponCamera.matrixWorldInverse);
            tracerStart.x *= weaponCamera.projectionMatrix.elements[0] / camera.projectionMatrix.elements[0];
            tracerStart.y *= weaponCamera.projectionMatrix.elements[5] / camera.projectionMatrix.elements[5];
            tracerStart.applyMatrix4(camera.matrixWorld);
          }
        } else actors.getMuzzlePosition(shot, tracerStart);
        const positions = trace.line.geometry.attributes.position;
        positions.setXYZ(0, tracerStart.x, tracerStart.y, tracerStart.z); positions.needsUpdate = true;
        trace.line.geometry.computeBoundingSphere();
        trace.line.visible = true; trace.shot = null;
      } else trace.life -= delta;
      if (trace.life <= 0) {
        trace.line.removeFromParent(); trace.line.geometry.dispose(); trace.line.material.dispose(); traces.splice(i, 1);
      }
    }
  }
  function showImpact(impact) {
    if (!ready || !inRoom) return;
    const point = new THREE.Vector3(...impact.point), normal = new THREE.Vector3(...impact.normal);
    if (impact.type === "blood") {
      impacts.spawnBlood(point, normal, { direction: new THREE.Vector3(...impact.direction),
        damage: impact.damage, headshot: impact.headshot, pellets: impact.pellets });
    } else if (impact.type === "surface") {
      impacts.spawnSurface(point, normal); bulletHoles.spawn(point, normal);
    }
  }
  function clearImpacts() {
    impacts.clear(); bulletHoles.clear();
    for (const { line } of traces) { line.removeFromParent(); line.geometry.dispose(); line.material.dispose(); }
    traces.length = 0;
  }
  function animate(now) {
    frame = requestAnimationFrame(animate);
    if (paused && now - lastFrame < 1000 / 30) return;
    const delta = Math.min(.05, (now - lastFrame) / 1000); lastFrame = now;
    if (!ready || document.hidden) return;
    // Chat blocks controls, while gravity, other players and the match continue.
    const playing = running();
    player.update(delta, playing); world.update(delta, camera); touch.update(delta);
    if (playing && player.inputState.footstep) sounds.playFootstep(player.inputState.walking, player.inputState.speed01);
    if (playing && player.inputState.jumped) sounds.playJump();
    if (playing && player.inputState.mouseDown) fire();
    weapon.update(delta, inRoom && local?.hp > 0 && !hooks.isEnded(), player.inputState);
    actors.update(delta);
    muzzleEffects.update(delta);
    projectiles.update(delta);
    impacts.update(delta, camera); bulletHoles.update(delta);
    hud.update({ ...weapon.getHudState(), health: local?.hp ?? 100, timer: hooks.timerText() });
    hud.setCrosshairVisible(local?.hp > 0 && !hooks.isEnded());
    hooks.frame?.();
    const originalPitch = camera.rotation.x;
    camera.rotation.x -= viewPunch; viewPunch *= Math.exp(-20 * delta);
    weaponCamera.position.copy(camera.position); weaponCamera.quaternion.copy(camera.quaternion);
    weaponRoot.position.copy(camera.position); weaponRoot.quaternion.copy(camera.quaternion);
    camera.updateMatrixWorld(true); weaponRoot.updateMatrixWorld(true); weaponCamera.updateMatrixWorld(true); weapon.syncWorldEffects();
    updateTraces(delta);
    renderer.clear(); renderer.render(scene, camera);
    if (inRoom && local?.hp > 0 && !scoped) { renderer.clearDepth(); renderer.render(weaponScene, weaponCamera); }
    camera.rotation.x = originalPitch;
  }
  window.addEventListener("resize", () => {
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1, Math.sqrt(1600 * 900 / (innerWidth * innerHeight))));
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = weaponCamera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix(); weaponCamera.updateProjectionMatrix();
  });
  document.addEventListener("pointerlockchange", () => { if (inRoom && !touch.enabled && !document.pointerLockElement && !paused && !chatting) hooks.pause(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden && inRoom) hooks.pause(); });
  window.addEventListener("blur", () => { player.clearMovement(); });
  document.addEventListener("keydown", e => {
    if (chatting) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) || e.target.isContentEditable) return;
    if (e.code === "Tab" && inRoom && !paused) { e.preventDefault(); hooks.scores(true); return; }
    if (e.code === "Escape" && inRoom && !paused) { hooks.pause(); return; }
    if (!active()) return;
    player.onKeyDown(e);
    if (e.code === "KeyR") reload();
    if (/^(Digit|Numpad)[1-9]$/.test(e.code)) switchWeapon(Number(e.code.slice(-1)));
    if (e.code === "KeyM" && !e.repeat) toggleSound();
    if (e.code === "KeyF" && !e.repeat) hooks.fullscreen?.();
  });
  document.addEventListener("keyup", e => { player.onKeyUp(e); if (e.code === "Tab") hooks.scores(false); });
  document.addEventListener("mousemove", e => { if (active()) player.onMouseMove(e, scoped ? .25 : 1); });
  document.addEventListener("mousedown", e => { if (!active()) return; player.onMouseDown(e); if (e.button === 0) fire(); if (e.button === 2) secondary(true); });
  document.addEventListener("mouseup", e => { player.onMouseUp(e); if (e.button === 2) secondary(false); });
  renderer.domElement.addEventListener("contextmenu", e => e.preventDefault());
  renderer.domElement.addEventListener("wheel", e => {
    if (!active()) return; e.preventDefault();
    const current = weapon.getHudState().weaponSlot;
    const slots = assets.weaponSlots.map(s => s.id), index = slots.indexOf(current);
    switchWeapon(slots[(index + (e.deltaY > 0 ? 1 : slots.length - 1)) % slots.length]);
  }, { passive: false });
  return { weapons, hitboxes, spawn, wallDistance, wallHit, poseActor, setState, setAppearance, showShot, showImpact, loadMap, capture, setPaused, setChatting, toggleSound,
    appearanceSchema: actors.appearanceSchema,
    createCharacterPreview(container) {
      const preview = createCharacterPreview({ THREE, container, models: actors.characterModels,
        schema: actors.appearanceSchema });
      previews.add(preview); return preview;
    },
    get touch() { return touch.enabled; },
    getPose(seq) {
      const status = weapon.getHudState(), motion = player.getMotion();
      if (!running()) { motion.velocity = [0, 0, 0]; motion.grounded = true; }
      motion.reload = status.isReloading ? status.reloadProgress : null;
      return { ...player.getPose(), slot: status.weaponSlot, motion, seq, life: localLife };
    },
    enterRoom() { inRoom = true; localLife = -1; },
    leaveRoom() { inRoom = false; local = null; localLife = -1; setPaused(true); actors.clear(); hitboxes.clear(); projectiles.clear(); clearImpacts(); seenExplosions.clear(); projectileRound = null; world.resetPlayer(player); },
    dispose() { cancelAnimationFrame(frame); previews.forEach(preview => preview.dispose()); clearImpacts(); impacts.dispose(); bulletHoles.dispose(); actors.dispose(); hitboxes.clear(); muzzleEffects.dispose(); projectiles.dispose(); renderer.dispose(); renderer.domElement.remove(); }
  };
}
