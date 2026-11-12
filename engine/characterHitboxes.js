import * as THREE from "./vendor/three.module.js";

// Native MDL bounds are in their owning bone's local space. Transform the ray,
// not the boxes: world-axis bounding boxes would enlarge rotated limbs.
export function createCharacterHitboxes(model, template) {
  if (!template.hitboxSet?.hitboxes.length) throw new Error("Player model has no native MDL hitboxes.");
  const boxes = template.hitboxSet.hitboxes.map(definition => {
    const name = template.boneData[definition.bone]?.name;
    const bone = name && model.getObjectByName(name);
    if (!bone?.isBone) throw new Error(`Missing MDL hitbox bone: ${name || definition.bone}`);
    return { definition, bone, bounds: new THREE.Box3(new THREE.Vector3(...definition.min), new THREE.Vector3(...definition.max)),
      inverse: new THREE.Matrix4() };
  });
  const localRay = new THREE.Ray(), point = new THREE.Vector3(), origin = new THREE.Vector3();
  return {
    update() {
      model.updateWorldMatrix(true, true);
      for (const box of boxes) box.inverse.copy(box.bone.matrixWorld).invert();
    },
    trace(ray, maxDistance = Infinity) {
      let hit = null, nearest = maxDistance;
      for (const { definition, bone, bounds, inverse } of boxes) {
        localRay.copy(ray).applyMatrix4(inverse);
        if (bounds.containsPoint(localRay.origin)) point.copy(localRay.origin);
        else if (!localRay.intersectBox(bounds, point)) continue;
        point.applyMatrix4(bone.matrixWorld);
        const distance = point.distanceTo(ray.origin);
        if (distance < nearest) {
          nearest = distance;
          hit = { distance, point: point.toArray(), hitgroup: definition.hitgroup,
            headshot: definition.hitgroup === 1, hitbox: definition.index, bone: definition.bone };
        }
      }
      return hit;
    },
    // Closest native surface plus center samples let a partly exposed limb take
    // splash damage without treating the player's empty bounding volume as flesh.
    samples(from) {
      origin.fromArray(from);
      return boxes.flatMap(({ bone, bounds, inverse }) => {
        point.copy(origin).applyMatrix4(inverse); bounds.clampPoint(point, point);
        const nearest = point.applyMatrix4(bone.matrixWorld).toArray();
        return [nearest, bounds.getCenter(point).applyMatrix4(bone.matrixWorld).toArray()];
      });
    }
  };
}
