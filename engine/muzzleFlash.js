export function createMuzzleFlashTexture(THREE) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  const center = 64;

  const glow = ctx.createRadialGradient(center, center, 2, center, center, 58);
  glow.addColorStop(0, "rgba(255,255,235,1)");
  glow.addColorStop(0.12, "rgba(255,225,135,1)");
  glow.addColorStop(0.42, "rgba(255,145,45,0.82)");
  glow.addColorStop(1, "rgba(255,90,15,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 128, 128);

  ctx.save();
  ctx.translate(center, center);
  ctx.globalCompositeOperation = "lighter";
  for (const rotation of [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4]) {
    ctx.rotate(rotation);
    const streak = ctx.createLinearGradient(-58, 0, 58, 0);
    streak.addColorStop(0, "rgba(255,130,40,0)");
    streak.addColorStop(0.5, "rgba(255,245,200,0.9)");
    streak.addColorStop(1, "rgba(255,130,40,0)");
    ctx.fillStyle = streak;
    ctx.fillRect(-58, -2.2, 116, 4.4);
    ctx.rotate(-rotation);
  }
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

// Third-person effects live in the world scene in world units, independently
// of Source model scale and corpse materials. Lights stay registered at zero
// intensity so firing and respawning do not change the shader's light count.
export function createWorldMuzzleFlashes({ THREE, scene, capacity = 8 }) {
  const root = new THREE.Group(); root.name = "WorldWeaponMuzzleEffects"; scene.add(root);
  const texture = createMuzzleFlashTexture(THREE), duration = .075;
  const entries = Array.from({ length: capacity }, () => {
    const material = new THREE.SpriteMaterial({ map: texture, color: 0xffd27a, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, toneMapped: false, opacity: 0 });
    const sprite = new THREE.Sprite(material); sprite.name = "WorldWeaponMuzzleFlash";
    sprite.scale.set(.28, .28, 1); sprite.frustumCulled = false;
    const light = new THREE.PointLight(0xffc36a, 0, 6, 2); light.name = "WorldWeaponMuzzleLight";
    light.castShadow = false; root.add(sprite, light);
    return { sprite, light, owner: null, anchor: null, remaining: 0, fresh: false };
  });
  function stop(entry) {
    entry.remaining = 0; entry.fresh = false; entry.sprite.material.opacity = 0; entry.light.intensity = 0;
  }
  function remove(owner) {
    const entry = entries.find(entry => entry.owner === owner); if (!entry) return;
    stop(entry); entry.owner = entry.anchor = null;
  }
  function visible(anchor) {
    for (let object = anchor; object; object = object.parent) if (!object.visible) return false;
    return Boolean(anchor?.parent);
  }
  function position(entry) {
    entry.anchor.getWorldPosition(entry.sprite.position); entry.light.position.copy(entry.sprite.position);
  }
  function clear() {
    for (const entry of entries) { stop(entry); entry.owner = entry.anchor = null; }
  }
  return {
    bind(owner, anchor) {
      remove(owner); if (!anchor) return;
      const entry = entries.find(entry => entry.owner === null); if (!entry) return;
      entry.owner = owner; entry.anchor = anchor;
    },
    trigger(owner) {
      const entry = entries.find(entry => entry.owner === owner);
      if (!entry || !visible(entry.anchor)) return;
      entry.remaining = duration; entry.fresh = true;
      entry.sprite.material.opacity = 1; entry.sprite.material.rotation = Math.random() * Math.PI;
      const size = .24 + Math.random() * .08; entry.sprite.scale.set(size, size, 1);
      entry.light.intensity = 32; position(entry);
    },
    update(delta) {
      for (const entry of entries) {
        if (!entry.remaining) continue;
        if (!visible(entry.anchor)) { stop(entry); continue; }
        // A shot can arrive just before a slow frame. Keep its first rendered
        // frame visible instead of subtracting time that elapsed before firing.
        if (entry.fresh) entry.fresh = false;
        else entry.remaining = Math.max(0, entry.remaining - delta);
        const strength = entry.remaining / duration;
        entry.sprite.material.opacity = strength; entry.light.intensity = 32 * strength;
        position(entry);
      }
    },
    remove, clear,
    dispose() {
      clear(); root.removeFromParent();
      entries.forEach(entry => { entry.sprite.material.dispose(); entry.light.dispose?.(); }); texture.dispose();
    }
  };
}
