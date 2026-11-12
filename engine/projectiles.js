
// Multiplayer grenade settings and cosmetic replicas. Collision and damage
// are resolved by the Photon master in projectileSimulation.js.
export function getProjectileSettings(behavior = {}) {
  const type = behavior.projectile;
  if (type !== "grenade") return null;
  const number = (value, fallback, min, max) =>
    Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;

  return {
    type,
    speed: number(behavior.projectileSpeed, 28, 1, 300),
    gravity: number(behavior.projectileGravity, 18, 0, 100),
    lifetime: number(behavior.projectileLifetime, 6, 0.1, 30),
    radius: number(behavior.explosionRadius, 4.5, 0, 30)
  };
}

export function createProjectiles({ THREE, scene }) {
  const MAX_PROJECTILES = 48;
  const MAX_PARTICLES = 240;
  const networkProjectiles = new Map();
  const particles = [];
  const particlePool = [];
  const root = new THREE.Group();
  root.name = "LauncherProjectiles";
  scene.add(root);

  const rayDirection = new THREE.Vector3();
  const nextPosition = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const glowTexture = makeGlowTexture();
  const geometries = [];
  const materials = [];
  const templates = { grenade: makeGrenade() };
  // Registered before the first render: explosions never add/remove scene lights.
  const light = new THREE.PointLight(0xff9a42, 0, 12, 2);
  light.name = "ProjectileExplosionLight";
  light.castShadow = false;
  scene.add(light);
  let lightLife = 0;
  let disposed = false;

  function geometry(value) { geometries.push(value); return value; }
  function material(value) { materials.push(value); return value; }

  function makeGrenade() {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      geometry(new THREE.CylinderGeometry(0.085, 0.095, 0.22, 8)),
      material(new THREE.MeshStandardMaterial({ color: 0x596644, roughness: 0.65 }))
    );
    const band = new THREE.Mesh(
      geometry(new THREE.CylinderGeometry(0.098, 0.098, 0.05, 8)),
      material(new THREE.MeshStandardMaterial({ color: 0xc99b4c, metalness: 0.45, roughness: 0.45 }))
    );
    band.position.y = -0.06;
    group.add(body, band);
    return group;
  }

  function makeGlowTexture() {
    const size = 32;
    const pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const r = Math.hypot((x + 0.5) / size * 2 - 1, (y + 0.5) / size * 2 - 1);
        const i = (y * size + x) * 4;
        pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
        pixels[i + 3] = Math.round(Math.pow(Math.max(0, 1 - r), 1.6) * 255);
      }
    }
    const texture = new THREE.DataTexture(pixels, size, size);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  }

  function syncMesh(projectile) {
    const mesh = projectile.mesh;
    mesh.position.copy(projectile.position);
    rayDirection.copy(projectile.velocity).normalize();
    if (rayDirection.lengthSq() > 0) mesh.quaternion.setFromUnitVectors(up, rayDirection);
    if (projectile.settings.type === "grenade") mesh.rotateX(projectile.age * 9);
  }

  // Multiplayer supplies host-simulated poses. These replicas never trace
  // collisions or call onExplode; only replicated blasts create their effects.
  function syncNetwork(states = []) {
    const ids = new Set(states.map(state => state.id));
    for (const [id, projectile] of networkProjectiles) if (!ids.has(id)) {
      root.remove(projectile.mesh); networkProjectiles.delete(id);
    }
    for (const state of states) {
      if (!templates[state.type]) continue;
      let projectile = networkProjectiles.get(state.id);
      if (!projectile) {
        if (networkProjectiles.size >= MAX_PROJECTILES) break;
        const mesh = templates[state.type].clone(true);
        mesh.name = `NetworkLauncherProjectile ${state.id}`; root.add(mesh);
        projectile = { mesh, settings: { type: state.type }, position: new THREE.Vector3(...state.p),
          target: new THREE.Vector3(), velocity: new THREE.Vector3(), trailDistance: 0 };
        networkProjectiles.set(state.id, projectile);
      }
      projectile.target.fromArray(state.p); projectile.velocity.fromArray(state.v);
      projectile.gravity = state.gravity; projectile.age = state.age; projectile.lag = 0;
      syncMesh(projectile);
    }
  }

  function updateNetwork(delta) {
    for (const projectile of networkProjectiles.values()) {
      projectile.lag = Math.min(.12, projectile.lag + delta); projectile.age += delta;
      nextPosition.copy(projectile.target).addScaledVector(projectile.velocity, projectile.lag);
      nextPosition.y -= .5 * projectile.gravity * projectile.lag ** 2;
      nextPosition.lerp(projectile.position, Math.exp(-25 * delta));
      emitTrail(projectile, nextPosition);
      projectile.position.copy(nextPosition); syncMesh(projectile);
    }
  }

  function update(delta) {
    if (disposed || !Number.isFinite(delta) || delta <= 0) return;
    delta = Math.min(delta, 0.1);
    updateNetwork(delta);
    updateParticles(delta);
    lightLife = Math.max(0, lightLife - delta);
    light.intensity = lightLife > 0 ? 95 * Math.pow(lightLife / 0.18, 2) : 0;
  }

  function emitTrail(projectile, destination) {
    const distance = projectile.position.distanceTo(destination);
    if (distance < 1e-8) return;
    const spacing = 0.75;
    let offset = spacing - projectile.trailDistance;
    // Limit cosmetic work for extreme custom speeds without limiting collision.
    for (let count = 0; offset <= distance && count < 12; offset += spacing, count++) {
      const position = projectile.position.clone().lerp(destination, offset / distance);
      addParticle(position, new THREE.Vector3(0, 0.15, 0), 0.35,
        0.07, 0.3, 0xb8b3a1, 0.2, false);
    }
    projectile.trailDistance = (projectile.trailDistance + distance) % spacing;
  }

  function addParticle(position, velocity, life, startSize, endSize, color, opacity, additive) {
    if (particles.length >= MAX_PARTICLES) recycleParticle(0);
    let particle = particlePool.pop();
    if (!particle) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture, transparent: true, depthWrite: false, depthTest: true, toneMapped: false
      }));
      sprite.name = "LauncherParticle";
      root.add(sprite);
      particle = { sprite, velocity: new THREE.Vector3() };
    }
    Object.assign(particle, { life, maxLife: life, startSize, endSize, opacity, additive });
    particle.velocity.copy(velocity);
    particle.sprite.position.copy(position);
    particle.sprite.scale.setScalar(startSize);
    particle.sprite.material.color.setHex(color);
    particle.sprite.material.opacity = opacity;
    particle.sprite.material.rotation = Math.random() * Math.PI * 2;
    particle.sprite.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    particle.sprite.visible = true;
    particles.push(particle);
  }

  function recycleParticle(index) {
    const particle = particles[index];
    particle.sprite.visible = false;
    particle.sprite.material.opacity = 0;
    particles.splice(index, 1);
    particlePool.push(particle);
  }

  function spawnExplosion(position, radius) {
    const size = Math.max(1.2, Math.min(radius, 6));
    addParticle(position, new THREE.Vector3(), 0.2, size * 0.4, size * 1.8, 0xffd68c, 1, true);
    for (let i = 0; i < 10; i++) {
      const velocity = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).multiplyScalar(size * 2);
      addParticle(position, velocity, 0.3 + Math.random() * 0.25, size * 0.3, size * 0.75, i % 2 ? 0xff6a19 : 0xffbc52, 0.9, true);
    }
    for (let i = 0; i < 8; i++) {
      const velocity = new THREE.Vector3(Math.random() - 0.5, 0.5 + Math.random(), Math.random() - 0.5).multiplyScalar(size * 0.75);
      addParticle(position, velocity, 0.85 + Math.random() * 0.5, size * 0.2, size, 0x656160, 0.65, false);
    }
    for (let i = 0; i < 12; i++) {
      const velocity = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.15, Math.random() - 0.5).normalize().multiplyScalar(size * 3);
      addParticle(position, velocity, 0.25 + Math.random() * 0.2, 0.12, 0.02, 0xffc263, 1, true);
    }
    light.position.copy(position);
    light.distance = size * 3;
    lightLife = 0.18;
    light.intensity = 95;
  }

  function updateParticles(delta) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const particle = particles[i];
      particle.life -= delta;
      if (particle.life <= 0) { recycleParticle(i); continue; }
      const progress = 1 - particle.life / particle.maxLife;
      particle.sprite.position.addScaledVector(particle.velocity, delta);
      particle.velocity.multiplyScalar(Math.exp(-2.5 * delta));
      particle.sprite.scale.setScalar(THREE.MathUtils.lerp(particle.startSize, particle.endSize, progress));
      particle.sprite.material.opacity = particle.opacity * Math.pow(1 - progress, particle.additive ? 1.5 : 0.8);
    }
  }

  function clear({ effects = true } = {}) {
    for (const projectile of networkProjectiles.values()) root.remove(projectile.mesh);
    networkProjectiles.clear();
    if (effects) {
      while (particles.length) recycleParticle(particles.length - 1);
      lightLife = 0;
      light.intensity = 0;
    }
  }

  function dispose() {
    if (disposed) return;
    clear();
    for (const particle of particlePool) particle.sprite.material.dispose();
    for (const item of geometries) item.dispose();
    for (const item of materials) item.dispose();
    glowTexture.dispose();
    scene.remove(root, light);
    particlePool.length = 0;
    disposed = true;
  }

  return { update, clear, dispose, syncNetwork, showExplosion: spawnExplosion,
    get networkCount() { return networkProjectiles.size; } };
}
