import * as THREE from "./vendor/three.module.js";
import { SourceModelLoader, parseSourceBones } from "./SourceModelLoader.js";
import { BinaryReader } from "./BinaryReader.js";
import { describeSequences, createSourceAnimationSampler } from "./SourceAnimations.js";
import { clone } from "./vendor/SkeletonUtils.js";
import { createCharacterAnimator } from "./characterAnimator.js";

export { createCharacterAnimator };

// Visible players and host collision rigs must use identical bodygroup selection,
// native axis conversion, scale and initial animation pose.
export function createCharacterInstance(template, asset, bodygroups, height = 1.9) {
  const model = clone(template.scene);
  applyCharacterBodygroups(model, bodygroups);
  model.scale.setScalar(.0254);
  const animator = createCharacterAnimator(model, template.animationSampler, asset);
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model), nativeHeight = bounds.max.y - bounds.min.y;
  if (nativeHeight > 0) {
    const scale = height / nativeHeight;
    model.scale.multiplyScalar(scale); model.position.y = -bounds.min.y * scale;
  }
  return { model, animator };
}

// Animation-only MDLs need their .ani companion, but no VVD/VTX geometry.
// Raw libraries are shared by every character; failed requests can be retried.
const animationLibraries = new Map();

function characterBodygroupOptions(asset) {
  const bodygroups = {};
  for (const [name, configured] of Object.entries(asset.source?.bodygroups || {})) {
    if (Array.isArray(configured)) {
      if (!configured.length) throw new Error(`Character bodygroup ${name} requires at least one variant.`);
      bodygroups[name] = configured[0];
    } else {
      bodygroups[name] = configured;
    }
  }
  return { ...asset.source, bodygroups, allBodygroups: true };
}

export function applyCharacterBodygroups(model, selections = {}, { prune = true } = {}) {
  const unused = [], retainedSkeletons = new Set();
  const source = model.userData.source;
  function visit(object) {
    const nested = object.userData.source;
    // Attached weapons are independent MDLs and can reuse the same group indexes.
    if (source && nested && (nested.checksum !== source.checksum || nested.name !== source.name)) return;
    const bodygroup = object.userData.sourceBodygroup;
    if (bodygroup && bodygroup.variant !== (selections[bodygroup.index] ?? selections[bodygroup.name] ?? 0)) {
      object.visible = false;
      if (prune) unused.push(object);
    } else {
      if (bodygroup) object.visible = true;
      if (object.isSkinnedMesh) retainedSkeletons.add(object.skeleton);
    }
    for (const child of object.children) visit(child);
  }
  visit(model);
  const disposedSkeletons = new Set();
  for (const object of unused) {
    object.removeFromParent();
    // SkeletonUtils owns the cloned skeletons; geometry, materials and textures
    // still belong to the shared model pool and must not be disposed here.
    if (object.isSkinnedMesh && !retainedSkeletons.has(object.skeleton) && !disposedSkeletons.has(object.skeleton)) {
      object.skeleton.dispose();
      disposedSkeletons.add(object.skeleton);
    }
  }
}

export function attachCharacterWeapon(model, template, asset, clone) {
  const placement = template?.attachment || {}, bone = placement.bone ?? asset.weaponBone;
  const hand = bone && findCharacterBone(model, bone);
  if (!hand || !template?.scene) return null;
  const weapon = clone(template.scene), socket = new THREE.Group();
  socket.name = "EnemyWeaponSocket";
  socket.position.fromArray(placement.position ?? asset.weaponPosition ?? [0, 0, 0]);
  socket.rotation.set(...(placement.rotation ?? asset.weaponRotation ?? [0, 0, 0]));
  socket.scale.setScalar(placement.scale ?? asset.weaponScale ?? 1);
  socket.add(weapon); hand.add(socket);
  return weapon;
}

export async function loadCharacterAnimations(src, options = {}) {
  if (typeof src !== "string" || !/\.mdl(?:[?#]|$)/i.test(src)) {
    throw new Error("Character animation libraries must use a Source .mdl file.");
  }
  const key = JSON.stringify([src, options.ani || ""]);
  if (!animationLibraries.has(key)) {
    const promise = (async () => {
      const read = path => new THREE.FileLoader().setResponseType("arraybuffer").loadAsync(path);
      const mdl = new BinaryReader(await read(src), src);
      new SourceModelLoader().validateHeader(mdl);
      let ani = null;
      if (mdl.i32(352) > 1) {
        mdl.table(mdl.i32(356), mdl.i32(352), 8);
        const filename = mdl.string(mdl.i32(348)).replaceAll("\\", "/").split("/").pop();
        const companion = options.ani || (filename
          ? src.slice(0, src.lastIndexOf("/") + 1) + filename
          : src.replace(/\.mdl(?=([?#]|$))/i, ".ani"));
        ani = new BinaryReader(await read(companion), companion);
      }
      return { mdl, ani, bones: parseSourceBones(mdl), sequences: describeSequences(mdl).map(seq => seq.name) };
    })();
    animationLibraries.set(key, promise);
    promise.catch(() => animationLibraries.delete(key));
  }
  return animationLibraries.get(key);
}

export async function loadCharacterAsset(src, asset = {}) {
  if (typeof src !== "string" || !/\.mdl(?:[?#]|$)/i.test(src)) {
    throw new Error("Character models must use a Source/Garry's Mod .mdl file.");
  }
  const [result, library] = await Promise.all([
    new SourceModelLoader().loadAsync(src, { ...characterBodygroupOptions(asset), animations: [] }),
    loadCharacterAnimations(asset.animations || src, asset.animations ? asset.animationSource : asset.source)
  ]);
  // Character hit detection always uses this model's native set, never the
  // shared animation library's hitboxes. Source defaults to set zero.
  const selectedHitboxSet = asset.source?.hitboxSet ?? 0;
  const hitboxSet = typeof selectedHitboxSet === "string"
    ? result.hitboxSets.find(set => set.name === selectedHitboxSet)
    : (Number.isInteger(selectedHitboxSet) ? result.hitboxSets[selectedHitboxSet] : null);
  if (!hitboxSet?.hitboxes.length) {
    throw new Error(`Character requires a nonempty native MDL hitbox set (${selectedHitboxSet}): ${src}`);
  }
  result.hitboxSet = hitboxSet;
  result.animationSampler = createSourceAnimationSampler(library.mdl, library.bones,
    { targetBones: result.boneData }, library.ani);
  result.metadata.sequences = library.sequences;
  result.metadata.animationLibrary = asset.animations || src;
  // Keep the native Source axis conversion inside an outer placement group.
  // Player scale/rotation edits must never overwrite the Z-up -> Y-up transform.
  const scene = new THREE.Group();
  scene.name = "SourceCharacter";
  scene.userData.source = result.metadata;
  scene.add(result.scene);
  return { ...result, scene };
}

export function findCharacterBone(model, name) {
  const wanted = THREE.PropertyBinding.sanitizeNodeName(String(name)).toLowerCase();
  let result = null;
  model.traverse(bone => {
    if (!result && bone.isBone && bone.name.toLowerCase() === wanted) result = bone;
  });
  return result;
}
