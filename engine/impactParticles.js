export function createImpactParticles({ THREE, scene, colliders = [] }) {
  const particles = [];
  const tempDirection = new THREE.Vector3();
  const MAX_DROPS = 256, MAX_MIST = 36, MAX_STAINS = 96;
  const MAX_SURFACE_PARTICLES = 160;
  const blood = new THREE.Group();
  blood.name = "Blood impacts";
  scene.add(blood);

  // One draw call for all ballistic drops; soft spray and stains reuse pools.
  const dropMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0x970b12, roughness: 0.28, metalness: 0 }),
    MAX_DROPS
  );
  dropMesh.name = "Blood droplets";
  dropMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  dropMesh.frustumCulled = false;
  dropMesh.receiveShadow = true;
  dropMesh.count = 0;
  blood.add(dropMesh);
  const drops = Array.from({ length: MAX_DROPS }, () => ({
    position: new THREE.Vector3(), velocity: new THREE.Vector3(),
    color: new THREE.Color(), life: 0, size: 0, drag: 0, surfaces: []
  }));
  let dropCount = 0, recycleDrop = 0;
  const mist = [], stains = [];
  const plane = new THREE.PlaneGeometry(1, 1);
  const mistTexture = makeTexture("mist", 7);
  const stainTextures = Array.from({ length: 4 }, (_, i) => makeTexture("stain", 31 + i));
  const wallTextures = Array.from({ length: 4 }, (_, i) => makeTexture("wall", 31 + i));
  const raycaster = new THREE.Raycaster();
  const intersections = [];
  const bounds = new THREE.Box3();
  const transform = new THREE.Object3D();
  const up = new THREE.Vector3(0, 1, 0), forward = new THREE.Vector3(0, 0, 1);
  const outward = new THREE.Vector3(), axis = new THREE.Vector3();
  const tangent = new THREE.Vector3(), bitangent = new THREE.Vector3();
  const previous = new THREE.Vector3(), travel = new THREE.Vector3();
  const hitNormal = new THREE.Vector3(), stainUp = new THREE.Vector3(), stainRight = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();
  const basis = new THREE.Matrix4(), viewRotation = new THREE.Quaternion();
  const driedColor = new THREE.Color(0x310508);

  function spawnBlood(point, normal, { direction, damage = 34, headshot = false, pellets = 1 } = {}) {
    if (!point) return;
    const strength = THREE.MathUtils.clamp(Math.sqrt(Math.max(1, damage) / 34), 0.65, 1.5);
    const amount = strength * (headshot ? 1.2 : 1) * (pellets > 1 ? 0.55 : 1);
    outward.copy(normal ?? up);
    if (outward.lengthSq() < 0.0001) outward.copy(up);
    outward.normalize();
    // Entry spray leaves the wound, angled back along the incoming shot.
    if (direction && outward.dot(direction) > 0) outward.negate();
    axis.copy(outward);
    if (direction) axis.multiplyScalar(0.7).addScaledVector(direction, -0.3).normalize();
    tangent.crossVectors(Math.abs(axis.y) < 0.95 ? up : forward, axis).normalize();
    bitangent.crossVectors(axis, tangent).normalize();

    // Restrict swept collision tests to surfaces the burst can actually reach.
    const surfaces = [];
    const maxTravel = ((4.9 * strength) + 0.85) * 1.55 + 4.905 * 1.55 * 1.55;
    for (const object of colliders) {
      object.updateWorldMatrix(true, false);
      bounds.setFromObject(object);
      if (bounds.distanceToPoint(point) < maxTravel) surfaces.push(object);
    }

    const count = Math.round(28 * amount);
    for (let i = 0; i < count; i++) {
      const drop = drops[dropCount < MAX_DROPS ? dropCount++ : recycleDrop++ % MAX_DROPS];
      const angle = Math.random() * Math.PI * 2;
      const spread = Math.sqrt(Math.random()) * (i < count * 0.65 ? 0.45 : 1.1);
      const speed = (1.1 + Math.random() * 3.8) * strength;
      drop.position.copy(point).addScaledVector(outward, 0.045)
        .addScaledVector(tangent, (Math.random() - 0.5) * 0.035)
        .addScaledVector(bitangent, (Math.random() - 0.5) * 0.035);
      drop.velocity.copy(axis)
        .addScaledVector(tangent, Math.cos(angle) * spread)
        .addScaledVector(bitangent, Math.sin(angle) * spread)
        .normalize().multiplyScalar(speed);
      drop.velocity.y += 0.3 + Math.random() * 0.55;
      drop.size = (0.0035 + Math.pow(Math.random(), 2) * 0.011) * Math.sqrt(strength);
      drop.drag = 0.35 + (0.016 - drop.size) * 65;
      drop.life = 0.9 + Math.random() * 0.65;
      drop.surfaces = surfaces;
      drop.color.setScalar(0.62 + Math.random() * 0.38);
    }

    for (let i = 0; i < Math.ceil(5 * amount); i++) {
      const puff = acquirePlane(mist, MAX_MIST, false);
      puff.mesh.position.copy(point).addScaledVector(outward, 0.065)
        .addScaledVector(tangent, (Math.random() - 0.5) * 0.075)
        .addScaledVector(bitangent, (Math.random() - 0.5) * 0.075);
      puff.velocity.copy(axis).multiplyScalar((0.35 + Math.random() * 1.5) * strength)
        .addScaledVector(tangent, (Math.random() - 0.5) * 1.3)
        .addScaledVector(bitangent, (Math.random() - 0.5) * 1.3);
      puff.life = puff.maxLife = 0.2 + Math.random() * 0.26;
      puff.size = (0.12 + Math.random() * 0.14) * Math.sqrt(amount);
      puff.rotation = Math.random() * Math.PI * 2;
      puff.alpha = 0.22 + Math.random() * 0.16;
      puff.mesh.material.opacity = puff.alpha;
      puff.mesh.scale.setScalar(puff.size);
    }
    syncDrops();
  }

  function acquirePlane(pool, limit, isStain) {
    let entry = pool.find(item => item.life <= 0);
    if (!entry && pool.length < limit) {
      const Material = isStain ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
      const material = new Material({
        color: isStain ? 0x78090f : 0x8d0a12,
        map: isStain ? stainTextures[pool.length % 4] : mistTexture,
        roughness: isStain ? 0.32 : 0.95, metalness: 0,
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        polygonOffset: isStain, polygonOffsetFactor: -1, polygonOffsetUnits: -2
      });
      if (isStain) material.specularIntensity = 0.25;
      const mesh = new THREE.Mesh(plane, material);
      mesh.name = isStain ? "Blood stain" : "Blood mist";
      mesh.receiveShadow = true;
      // A billboard only needs one transparent pass.
      material.forceSinglePass = true;
      blood.add(mesh);
      entry = { mesh, velocity: new THREE.Vector3(), life: 0, variant: pool.length % 4 };
      pool.push(entry);
    }
    if (!entry) entry = pool.reduce((oldest, item) => item.life < oldest.life ? item : oldest);
    entry.mesh.visible = true;
    return entry;
  }

  function leaveStain(hit, drop) {
    if (!hit.face || drop.size < 0.006) return;
    hitNormal.copy(hit.face.normal).applyNormalMatrix(normalMatrix.getNormalMatrix(hit.object.matrixWorld));
    const stain = acquirePlane(stains, MAX_STAINS, true);
    const wall = Math.abs(hitNormal.y) < 0.55;
    // Street paint sits slightly above the ground collision plane.
    stain.mesh.position.copy(hit.point).addScaledVector(hitNormal, hitNormal.y > 0.95 ? 0.022 : 0.008);
    stain.mesh.quaternion.setFromUnitVectors(forward, hitNormal);
    if (wall) {
      // Keep the short gravity streaks pointing down the wall.
      stainUp.copy(up).addScaledVector(hitNormal, -hitNormal.y).normalize();
      stainRight.crossVectors(stainUp, hitNormal).normalize();
      basis.makeBasis(stainRight, stainUp, hitNormal);
      stain.mesh.quaternion.setFromRotationMatrix(basis);
      stain.mesh.rotateZ((Math.random() - 0.5) * 0.25);
    } else {
      stain.mesh.rotateZ(Math.random() * Math.PI * 2);
    }
    stain.size = drop.size * (9 + Math.min(drop.velocity.length(), 6) * 1.7);
    stain.stretch = wall ? 1.5 : 0.8 + Math.random() * 0.55;
    stain.life = stain.maxLife = 26 + Math.random() * 12;
    stain.mesh.scale.set(stain.size, stain.size * stain.stretch, 1);
    stain.mesh.material.map = (wall ? wallTextures : stainTextures)[stain.variant];
    stain.mesh.material.color.setHex(0x78090f);
    stain.mesh.material.opacity = 0.88;
    stain.mesh.material.roughness = 0.32;
  }

  function syncDrops() {
    dropMesh.count = dropCount;
    for (let i = 0; i < dropCount; i++) {
      const drop = drops[i];
      const fade = Math.min(1, drop.life / 0.18);
      const speed = drop.velocity.length();
      transform.position.copy(drop.position);
      tempDirection.copy(drop.velocity).normalize();
      transform.quaternion.setFromUnitVectors(up, speed > 0.001 ? tempDirection : up);
      transform.scale.set(drop.size * fade, drop.size * fade * (1 + Math.min(3, speed * 0.45)), drop.size * fade);
      transform.updateMatrix();
      dropMesh.setMatrixAt(i, transform.matrix);
      dropMesh.setColorAt(i, drop.color);
    }
    dropMesh.instanceMatrix.needsUpdate = true;
    if (dropMesh.instanceColor) dropMesh.instanceColor.needsUpdate = true;
  }

  function updateBlood(delta, camera) {
    if (camera) camera.getWorldQuaternion(viewRotation);
    // Substeps keep fast droplets from tunnelling through nearby walls/floors.
    const steps = Math.max(1, Math.ceil(delta / (1 / 60)));
    const dt = delta / steps;
    for (let step = 0; step < steps; step++) {
      for (let i = dropCount - 1; i >= 0; i--) {
        const drop = drops[i];
        drop.life -= dt;
        if (drop.life > 0) {
          previous.copy(drop.position);
          drop.velocity.multiplyScalar(Math.exp(-drop.drag * dt));
          drop.velocity.y -= 9.81 * dt;
          drop.position.addScaledVector(drop.velocity, dt);
          travel.subVectors(drop.position, previous);
          const distance = travel.length();
          if (distance > 0.00001 && drop.surfaces.length) {
            raycaster.set(previous, travel.multiplyScalar(1 / distance));
            raycaster.far = distance + 0.002;
            intersections.length = 0;
            raycaster.intersectObjects(drop.surfaces, true, intersections);
            if (intersections.length) {
              leaveStain(intersections[0], drop);
              drop.life = 0;
            }
          }
        }
        if (drop.life <= 0) {
          drop.surfaces = [];
          drops[i] = drops[--dropCount];
          drops[dropCount] = drop;
        }
      }
    }
    syncDrops();
    for (const puff of mist) {
      if (puff.life <= 0) continue;
      puff.life = Math.max(0, puff.life - delta);
      const age = 1 - puff.life / puff.maxLife;
      puff.velocity.multiplyScalar(Math.exp(-5 * delta));
      puff.mesh.position.addScaledVector(puff.velocity, delta);
      puff.mesh.position.y -= 0.12 * delta;
      puff.mesh.quaternion.copy(viewRotation);
      puff.mesh.rotateZ(puff.rotation + age * 0.25);
      puff.mesh.scale.setScalar(puff.size * (1 + age * 2.4));
      puff.mesh.material.opacity = puff.alpha * Math.pow(1 - age, 1.6);
      puff.mesh.visible = puff.life > 0;
    }
    for (const stain of stains) {
      if (stain.life <= 0) continue;
      stain.life = Math.max(0, stain.life - delta);
      const age = stain.maxLife - stain.life;
      const spread = 1 + Math.min(age, 0.25) * 0.45;
      stain.mesh.scale.set(stain.size * spread, stain.size * stain.stretch * spread, 1);
      stain.mesh.material.color.setHex(0x78090f).lerp(driedColor, Math.min(1, age / 14));
      stain.mesh.material.roughness = 0.32 + Math.min(1, age / 14) * 0.45;
      stain.mesh.material.opacity = 0.88 * Math.min(1, stain.life / 6);
      stain.mesh.visible = stain.life > 0;
    }
  }

  function makeTexture(kind, seed) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext("2d");
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    if (kind === "mist") {
      // Overlapping soft lobes avoid a visible square or uniform smoke disc.
      for (let i = 0; i < 55; i++) {
        const angle = random() * Math.PI * 2, radius = random() * 35;
        const x = 64 + Math.cos(angle) * radius, y = 64 + Math.sin(angle) * radius;
        const size = 4 + random() * 22;
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, size);
        gradient.addColorStop(0, "rgba(255,255,255,0.23)");
        gradient.addColorStop(0.4, "rgba(255,255,255,0.1)");
        gradient.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = gradient;
        ctx.fillRect(x - size, y - size, size * 2, size * 2);
      }
    } else {
      const centerY = kind === "wall" ? 48 : 64;
      const points = Array.from({ length: 24 }, (_, i) => {
        const angle = i / 24 * Math.PI * 2, radius = 17 + random() * 16;
        return [64 + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius];
      });
      ctx.fillStyle = "rgba(255,255,255,0.96)";
      ctx.beginPath();
      const last = points[points.length - 1], first = points[0];
      ctx.moveTo((last[0] + first[0]) / 2, (last[1] + first[1]) / 2);
      for (let i = 0; i < points.length; i++) {
        const p = points[i], next = points[(i + 1) % points.length];
        ctx.quadraticCurveTo(p[0], p[1], (p[0] + next[0]) / 2, (p[1] + next[1]) / 2);
      }
      ctx.fill();
      for (let i = 0; i < 30; i++) {
        const angle = random() * Math.PI * 2, radius = 26 + random() * 29;
        ctx.globalAlpha = 0.45 + random() * 0.5;
        ctx.beginPath();
        ctx.ellipse(64 + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius * 0.8,
          0.6 + random() * 2.2, 0.6 + random() * 3.2, angle, 0, Math.PI * 2);
        ctx.fill();
      }
      if (kind === "wall") {
        ctx.strokeStyle = "white";
        ctx.lineCap = "round";
        ctx.globalAlpha = 0.8;
        for (let i = 0; i < 3; i++) {
          const x = 47 + random() * 34;
          ctx.lineWidth = 1.5 + random() * 3;
          ctx.beginPath(); ctx.moveTo(x, centerY);
          ctx.lineTo(x + random() * 2, 82 + random() * 33); ctx.stroke();
        }
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  function spawnSurface(point, normal) {
    spawnBurst({
      point,
      normal,
      count: 10,
      color: 0xd8c18a,
      size: 0.026,
      speedMin: 0.8,
      speedMax: 2.5,
      gravity: 3.2,
      life: 0.45,
      spread: 0.65
    });
  }

  function spawnBurst({ point, normal, count, color, size, speedMin, speedMax, gravity, life, spread }) {
    if (!point) return;

    const baseNormal = normal?.clone?.() ?? new THREE.Vector3(0, 1, 0);
    if (baseNormal.lengthSq() === 0) baseNormal.set(0, 1, 0);
    baseNormal.normalize();

    for (let i = 0; i < count; i++) {
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 1,
        depthWrite: false
      });

      const particle = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), material);
      particle.name = "Surface impact particle";
      particle.position.copy(point).addScaledVector(baseNormal, 0.025);
      particle.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);

      tempDirection.copy(baseNormal);
      tempDirection.x += (Math.random() - 0.5) * spread;
      tempDirection.y += (Math.random() - 0.25) * spread;
      tempDirection.z += (Math.random() - 0.5) * spread;
      tempDirection.normalize();

      const speed = speedMin + Math.random() * (speedMax - speedMin);
      particle.userData.velocity = tempDirection.clone().multiplyScalar(speed);
      particle.userData.life = life;
      particle.userData.maxLife = life;
      particle.userData.gravity = gravity;
      particle.userData.spin = 5 + Math.random() * 12;

      scene.add(particle);
      particles.push(particle);
      if (particles.length > MAX_SURFACE_PARTICLES) removeParticle(particles.shift());
    }
  }

  function update(delta, camera) {
    if (!Number.isFinite(delta) || delta < 0) return;
    updateBlood(delta, camera);
    for (let i = particles.length - 1; i >= 0; i--) {
      const particle = particles[i];
      particle.userData.life -= delta;
      particle.userData.velocity.y -= particle.userData.gravity * delta;
      particle.position.addScaledVector(particle.userData.velocity, delta);
      particle.rotation.x += particle.userData.spin * delta;
      particle.rotation.y += particle.userData.spin * 0.7 * delta;

      const alpha = Math.max(0, particle.userData.life / particle.userData.maxLife);
      particle.material.opacity = alpha;

      if (particle.userData.life <= 0) {
        removeParticle(particle);
        particles.splice(i, 1);
      }
    }
  }

  function removeParticle(particle) {
    particle.removeFromParent();
    particle.geometry.dispose();
    particle.material.dispose();
  }

  function clear() {
    dropCount = 0;
    recycleDrop = 0;
    dropMesh.count = 0;
    for (const drop of drops) { drop.life = 0; drop.surfaces = []; }
    for (const entry of [...mist, ...stains]) {
      entry.life = 0;
      entry.mesh.visible = false;
    }
    while (particles.length) {
      removeParticle(particles.pop());
    }
  }

  function dispose() {
    clear();
    blood.removeFromParent();
    dropMesh.geometry.dispose(); dropMesh.material.dispose(); dropMesh.dispose();
    for (const entry of [...mist, ...stains]) entry.mesh.material.dispose();
    plane.dispose(); mistTexture.dispose();
    for (const texture of [...stainTextures, ...wallTextures]) texture.dispose();
  }

  return {
    spawnBlood,
    spawnSurface,
    update,
    clear,
    dispose
  };
}
