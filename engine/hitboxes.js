import * as THREE from "./vendor/three.module.js";
import { createCharacterInstance } from "./characterLoader.js";
import { createCharacterHitboxes } from "./characterHitboxes.js";
import { updateSourceProceduralBones } from "./SourceProcedural.js";
import { normalizeAppearance, sameAppearance } from "./bodygroups.js";
import { playerEyeHeight } from "./playerStance.js";

// Dedicated, unrendered host rigs. Interpolation, menus, hidden local models and
// ragdoll disposal cannot move or freeze the authoritative collision skeletons.
export function createPlayerHitboxes({ models, appearanceSchema, weaponSlots, rules }) {
  const rigs = new Map(), modelsById = new Map(models.map(entry => [entry.schema.model, entry]));
  const holdTypes = new Map(weaponSlots.map(slot => [slot.id, slot.asset.holdType]));
  const ray = new THREE.Ray();
  function remove(id) {
    const rig = rigs.get(id); if (!rig) return;
    rig.animator.dispose();
    const skeletons = new Set(); rig.model.traverse(object => { if (object.isSkinnedMesh) skeletons.add(object.skeleton); });
    skeletons.forEach(skeleton => skeleton.dispose()); rigs.delete(id);
  }
  function sync(players, now) {
    for (const [id] of rigs) if (!players[id]?.ready || players[id].hp <= 0) remove(id);
    for (const player of Object.values(players)) {
      if (!player.ready || player.hp <= 0) continue;
      const appearance = normalizeAppearance(appearanceSchema, player.appearance);
      let rig = rigs.get(player.id);
      if (rig && (rig.life !== player.life || !sameAppearance(rig.appearance, appearance))) { remove(player.id); rig = null; }
      if (!rig) {
        const entry = modelsById.get(appearance.model);
        const { model, animator } = createCharacterInstance(entry.template, entry.asset, appearance.bodygroups, 1.9 * rules.playerHeight / 1.75);
        const root = new THREE.Group(); root.add(model);
        animator.setHoldType?.(holdTypes.get(player.slot));
        if (animator.snap) animator.snap(player); else animator.update(0, player);
        rig = { root, model, animator, appearance, life: player.life, at: now,
          hitboxes: createCharacterHitboxes(model, entry.template) };
        rigs.set(player.id, rig);
      }
      const delta = Math.max(0, (now - rig.at) | 0) / 1000;
      rig.at = now;
      rig.root.position.set(player.p[0], player.p[1] - playerEyeHeight(player.motion, rules), player.p[2]);
      rig.root.rotation.y = player.yaw + Math.PI;
      rig.animator.setHoldType?.(holdTypes.get(player.slot));
      rig.animator.update(delta, player);
      updateSourceProceduralBones(rig.model); rig.hitboxes.update();
    }
  }
  return {
    sync,
    trace(origin, direction, players, shooter, maxDistance = 160) {
      ray.origin.fromArray(origin); ray.direction.fromArray(direction);
      let hit = null, nearest = Math.min(160, maxDistance);
      for (const [id, rig] of rigs) {
        const player = players[id];
        if (id === shooter || !player?.ready || player.hp <= 0 || player.life !== rig.life) continue;
        const candidate = rig.hitboxes.trace(ray, nearest);
        if (candidate) { nearest = candidate.distance; hit = { ...candidate, id }; }
      }
      return hit;
    },
    samples(id, from) { return rigs.get(id)?.hitboxes.samples(from) || []; },
    shot(shot) {
      const rig = rigs.get(shot.actor);
      if (rig && rig.life === shot.life) rig.animator.trigger?.("fire");
    },
    clear() { for (const id of rigs.keys()) remove(id); }
  };
}
