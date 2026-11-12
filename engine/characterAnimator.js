import * as THREE from "./vendor/three.module.js";
import { crouchAmount } from "./playerStance.js";

// Native Source sequences drive all multiplayer players and previews. Each
// player owns its cycles, transitions and bones while sharing the raw bank.
export function createCharacterAnimator(model, sampler, asset = {}) {
  if (!sampler) throw new Error("Player animation requires a native Source sequence bank.");
  const config = asset.playerAnimation || {}, mixer = new THREE.AnimationMixer(model);
  const bindings = sampler.bones.map(bone => model.getObjectByName(bone.name));
  const upper = new Set(), upperName = THREE.PropertyBinding.sanitizeNodeName(config.upperBodyBone || "ValveBiped.Bip01_Spine");
  sampler.bones.forEach((bone, i) => { if (bone.name === upperName || upper.has(bone.parent)) upper.add(i); });
  const profiles = new Map();
  const first = names => names.flat().find(name => name && sampler.has(name));
  function profile(type) {
    type = String(type || config.defaultHoldType || "ar2").trim().toLowerCase();
    type = ({ smg: "smg1", dual: "dual", normal: "all" })[type] || type;
    if (!profiles.has(type)) {
      const custom = config.sets?.[type] || {}, fallback = config.defaultHoldType || "ar2";
      const idle = first([custom.idle, `idle_${type}`, `idle_${fallback}`, "idle_all_01"]);
      if (!idle) throw new Error(`No idle animation for hold type "${type}".`);
      const set = { idle };
      for (const state of ["walk", "run", "jump", "reload"]) {
        set[state] = first([custom[state], `${state}_${type}`, `${state}_${fallback}`]);
      }
      set.crouchIdle = first([custom.crouchIdle, `cidle_${type}`, `cidle_${fallback}`]);
      set.crouchWalk = first([custom.crouchWalk, `cwalk_${type}`, `cwalk_${fallback}`]);
      set.fire = first([custom.fire, `range_${type}`, `range_${fallback}`]);
      set.land = first([custom.land, "jump_land"]);
      // Validate only the configured/used profile, including its native layers.
      for (const name of new Set(Object.values(set).filter(Boolean))) sampler.info(name);
      profiles.set(type, set);
    }
    return profiles.get(type);
  }
  let holdType = config.defaultHoldType || "ar2", set = profile(holdType);
  let sequence = null, cycle = 0, lastPose = null, transition = null, blend = 1;
  let grounded = true, fire = null, landing = null, reload = null;
  let forward = 0, sideways = 0, pitch = 0, aimYaw = 0;
  const poseParameters = { ...asset.poseParameters };
  const state = { sequence: set.idle, holdType, speed: 0, playbackRate: 1, cycle: 0, parameters: poseParameters, overlays: [] };
  const copy = pose => pose.map(bone => ({ position: bone.position.clone(), quaternion: bone.quaternion.clone() }));
  function setHoldType(type) {
    type ||= config.defaultHoldType || "ar2";
    if (type === holdType) return;
    set = profile(type); holdType = type; sequence = null; fire = null; reload = null;
  }
  function trigger(action) {
    if (action === "fire" && set.fire) fire = { time: 0, name: set.fire };
  }
  function update(delta, input = {}) {
    delta = Math.max(0, Math.min(.1, delta));
    if (!mixer.timeScale) return;
    mixer.update(delta);
    delta *= mixer.timeScale;
    const motion = input.motion, yaw = input.yaw || 0;
    const velocity = motion?.velocity || [0, 0, 0];
    const bodyYaw = input.bodyYaw ?? yaw;
    const rawForward = -velocity[0] * Math.sin(bodyYaw) - velocity[2] * Math.cos(bodyYaw);
    const rawSide = velocity[0] * Math.cos(bodyYaw) - velocity[2] * Math.sin(bodyYaw);
    const smooth = lastPose ? 1 - Math.exp(-18 * delta) : 1;
    forward += (rawForward - forward) * smooth; sideways += (rawSide - sideways) * smooth;
    pitch += ((input.pitch || 0) - pitch) * smooth;
    const relativeYaw = Math.atan2(Math.sin(yaw - bodyYaw), Math.cos(yaw - bodyYaw));
    aimYaw += (relativeYaw - aimYaw) * smooth;
    const speed = Math.hypot(forward, sideways), onGround = motion?.grounded !== false;
    poseParameters.move_x = speed > .05 ? forward / speed : 0;
    // Source move_y=+1 travels along -Y, which becomes the player's right
    // after the native Source-to-Three conversion and actor facing rotation.
    poseParameters.move_y = speed > .05 ? sideways / speed : 0;
    // Raise the native neutral aiming pose by 12.5 degrees for every hold type.
    poseParameters.aim_pitch = -THREE.MathUtils.radToDeg(pitch) - 12.5;
    poseParameters.aim_yaw = THREE.MathUtils.radToDeg(aimYaw);
    poseParameters.vertical_velocity = THREE.MathUtils.clamp(velocity[1] / (config.jumpSpeed || 10), -1, 1);
    const walking = motion?.walking ?? speed < (config.walkSpeed || 4.675) + .1;
    const crouch = crouchAmount(motion);
    const standingSequence = !onGround && set.jump ? set.jump : speed > .15 ? (walking ? set.walk || set.run : set.run || set.walk) || set.idle : set.idle;
    const crouchSequence = onGround && speed > .15 ? set.crouchWalk || set.crouchIdle || standingSequence
      : set.crouchIdle || standingSequence;
    const next = crouch > .5 ? crouchSequence : standingSequence;
    if (next !== sequence) {
      transition = lastPose && copy(lastPose); blend = transition ? 0 : 1;
      if (next === set.jump || next === set.idle || next === set.crouchIdle) cycle = 0;
      sequence = next;
    }
    const info = sampler.info(sequence, poseParameters);
    const locomotion = onGround && speed > .15 && sequence !== set.idle && sequence !== set.crouchIdle;
    const nativeSpeed = Math.hypot(info.movement.x, info.movement.y) * model.scale.x / info.duration;
    const nominal = nativeSpeed > .05 ? nativeSpeed : walking ? config.walkSpeed || 4.675 : config.runSpeed || 8.5;
    const rate = locomotion ? THREE.MathUtils.clamp(speed / nominal, .15, 3) : 1;
    cycle += delta * rate / info.duration;
    cycle = info.loop ? cycle % 1 : Math.min(1, cycle);
    if (!grounded && onGround && set.land) landing = { time: 0, name: set.land };
    grounded = onGround;
    const overlays = [];
    for (const effect of [landing, fire]) {
      if (!effect) continue;
      effect.time += delta;
      const duration = sampler.info(effect.name, poseParameters).duration, phase = effect.time / duration;
      if (phase < 1) overlays.push({ name: effect.name, cycle: phase, weight: Math.min(1, (1 - phase) * 5),
        mask: effect === fire && upper.size ? upper : null });
      else if (effect === fire) fire = null;
      else landing = null;
    }
    if (motion?.reload != null && set.reload) {
      reload = reload == null || motion.reload < reload - .2 ? motion.reload : reload + (motion.reload - reload) * smooth;
      overlays.push({ name: set.reload, cycle: reload, weight: 1, mask: upper.size ? upper : null });
    } else reload = null;
    const crouchBase = set.crouchIdle || set.idle;
    const pose = sampler.sample(sequence, cycle, mixer.time, poseParameters, crouch > .5 ? crouchBase : set.idle, overlays);
    // Blend the actual stance fraction, including partially raised poses under
    // a low ceiling. Fire/reload overlays stay on the upper body in both poses.
    if (crouch > 0 && crouch < 1 && standingSequence !== crouchSequence) {
      const other = sampler.sample(crouch > .5 ? standingSequence : crouchSequence,
        cycle, mixer.time, poseParameters, crouch > .5 ? set.idle : crouchBase, overlays);
      const weight = crouch > .5 ? 1 - crouch : crouch;
      pose.forEach((bone, i) => { bone.position.lerp(other[i].position, weight); bone.quaternion.slerp(other[i].quaternion, weight); });
    }
    blend = Math.min(1, blend + delta / (config.transitionSeconds || .12));
    pose.forEach((bone, i) => {
      if (transition && blend < 1) {
        bone.position.lerp(transition[i].position, 1 - blend);
        bone.quaternion.slerp(transition[i].quaternion, 1 - blend);
      }
      bindings[i]?.position.copy(bone.position); bindings[i]?.quaternion.copy(bone.quaternion);
    });
    if (blend === 1) transition = null;
    lastPose = pose;
    Object.assign(state, { sequence, holdType, speed, playbackRate: rate, cycle, crouch, overlays: overlays.map(layer => layer.name) });
  }
  update(0);
  return { mixer, state, setHoldType, trigger, update,
    snap(input) { lastPose = transition = sequence = null; blend = 1; update(0, input); },
    dispose() { mixer.stopAllAction(); mixer.uncacheRoot(model); lastPose = transition = null; } };
}

