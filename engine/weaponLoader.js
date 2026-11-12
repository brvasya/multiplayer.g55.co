import { SourceModelLoader } from "./SourceModelLoader.js";
import * as THREE from "./vendor/three.module.js";
import { updateSourceProceduralBones } from "./SourceProcedural.js";

// World models live beside their viewmodels with the same stem. Do not inherit
// first-person animation/bodygroup/companion overrides: w_ has its own rig.
export function worldWeaponAsset(asset) {
  const override = typeof asset?.worldModel === "string" ? { model: asset.worldModel } : asset?.worldModel || {};
  const source = typeof asset?.model === "string" ? asset.model : "", end = source.search(/[?#]/);
  const path = (end < 0 ? source : source.slice(0, end)).replace(/(^|\/)c_([^/]+\.mdl)$/i, "$1w_$2");
  if (!override.model && !/(^|\/)w_[^/]+\.mdl$/i.test(path)) {
    throw new Error("Third-person weapons need a c_/w_ model filename or an explicit worldModel.model.");
  }
  return { anim: { idle: "idle" }, ...override, model: override.model || path + (end < 0 ? "" : source.slice(end)) };
}

export async function loadWorldWeaponAsset(asset) {
  const definition = worldWeaponAsset(asset);
  const result = await loadWeaponAsset(definition);
  // Display and native PHY alignment must evaluate the same static idle pose.
  if (result.animations.length) {
    const mixer = new THREE.AnimationMixer(result.scene);
    mixer.clipAction(result.animations[0]).play(); mixer.update(0);
  }
  updateSourceProceduralBones(result.scene); result.scene.updateMatrixWorld(true);
  return { ...result, model: definition.model, physics: definition.physics, attachment: definition.attachment,
    muzzleFlash: definition.muzzleFlash, holdType: asset.holdType };
}

// World MDLs have their own named attachments; a viewmodel's numeric attachment
// or bone name does not identify the muzzle on its matching w_ model.
export function findWorldWeaponMuzzle(model, preferred) {
  if (!model || preferred === false) return null;
  const objects = new Map();
  model.traverse(object => { if (object.name) objects.set(object.name.toLowerCase(), object); });
  const find = name => objects.get(THREE.PropertyBinding.sanitizeNodeName(String(name)).toLowerCase()) || null;
  if (preferred != null) return find(preferred);
  const attachments = model.userData.source?.attachments || [];
  const named = attachments.find(name => name.toLowerCase() === "muzzle")
    || attachments.find(name => /^(?:muzzle(?:_?flash)?(?:[_\d].*)?|flash)$/i.test(name));
  if (named) return find(named);
  // Some exports supply a muzzle bone but no attachment table.
  return find("tag_flash") || find("muzzle") || find("muzzle_flash") || null;
}

// Player weapons and hands all use native Source models.
export async function loadWeaponAsset(asset, { hands = false } = {}) {
  if (typeof asset?.model !== "string" || !/\.mdl(?:[?#]|$)/i.test(asset.model)) {
    throw new Error(`${hands ? "Hands models" : "Weapon models"} must use a .mdl file.`);
  }
  const animations = hands ? [] : [...new Set(
    Object.values(asset.anim || {}).flat().filter(name => typeof name === "string")
  )];
  return new SourceModelLoader().loadAsync(asset.model, { ...asset.source, animations });
}
