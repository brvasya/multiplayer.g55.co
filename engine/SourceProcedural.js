import * as THREE from "./vendor/three.module.js";

const cache = new WeakMap();

// Source's quaternion-triggered corrective bones (used by GMod c_hands wrists).
// Resolve per instance: SkeletonUtils.clone must never retain the source bones.
export function updateSourceProceduralBones(root) {
  const definitions = root?.userData.source?.proceduralBones;
  if (!definitions?.length) return;
  if (!cache.has(root)) {
    cache.set(root, definitions.map(definition => ({
      bone: root.getObjectByName(definition.bone),
      control: root.getObjectByName(definition.control),
      triggers: definition.triggers.map(trigger => ({
        tolerance: trigger.tolerance,
        rotation: new THREE.Quaternion().fromArray(trigger.rotation),
        position: new THREE.Vector3().fromArray(trigger.position),
        quaternion: new THREE.Quaternion().fromArray(trigger.quaternion)
      }))
    })));
  }
  for (const { bone, control, triggers } of cache.get(root)) {
    if (!bone || !control || !control.parent?.isBone || !triggers.length) continue;
    const weights = triggers.map(trigger => Math.max(0, 1 - 2 * Math.acos(Math.min(1, Math.abs(control.quaternion.dot(trigger.rotation)))) * trigger.tolerance));
    const sum = weights.reduce((a, b) => a + b, 0);
    if (sum <= 0.001) {
      bone.position.copy(triggers[0].position);
      bone.quaternion.copy(triggers[0].quaternion);
    } else {
      bone.position.set(0, 0, 0);
      let x = 0, y = 0, z = 0, w = 0;
      triggers.forEach((trigger, index) => {
        const weight = weights[index] / sum;
        if (!weight) return;
        const q = trigger.quaternion;
        if (x * q.x + y * q.y + z * q.z + w * q.w < 0) { x = -x; y = -y; z = -z; w = -w; }
        x += q.x * weight; y += q.y * weight; z += q.z * weight; w += q.w * weight;
        bone.position.addScaledVector(trigger.position, weight);
      });
      bone.quaternion.set(x, y, z, w).normalize();
    }
    bone.updateMatrix();
    bone.updateWorldMatrix(true, true);
  }
}
