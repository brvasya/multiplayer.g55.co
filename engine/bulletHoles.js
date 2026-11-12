export function createBulletHoles({ THREE, scene, surfaces = null }) {
  const holes = [];
  const texture = createBulletHoleTexture();
  const raycaster = new THREE.Raycaster();
  const matrix = new THREE.Matrix4(), normalMatrix = new THREE.Matrix3();

  function spawn(point, normal) {
    if (!point || !normal) return;
    const n = normal.clone().normalize();
    if (surfaces) {
      // Map colliders sit below floor paint and behind wall trim. Project the
      // decal onto nearby visible geometry instead of burying it in the proxy.
      raycaster.set(point.clone().addScaledVector(n, .35), n.clone().negate());
      raycaster.far = .7;
      const hit = raycaster.intersectObjects(surfaces, false)[0];
      if (!hit?.face) return;
      matrix.copy(hit.object.matrixWorld);
      if (hit.instanceId !== undefined) {
        const instance = new THREE.Matrix4();
        hit.object.getMatrixAt(hit.instanceId, instance); matrix.multiply(instance);
      }
      point = hit.point;
      n.copy(hit.face.normal).applyNormalMatrix(normalMatrix.getNormalMatrix(matrix));
    }

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4
    });

    const size = 0.16 + Math.random() * 0.08;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), material);
    mesh.name = "Bullet hole";

    mesh.position.copy(point).addScaledVector(n, 0.006);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    mesh.rotateZ(Math.random() * Math.PI * 2);

    mesh.userData.life = 18;
    mesh.userData.maxLife = 18;

    scene.add(mesh);
    holes.push(mesh);

    if (holes.length > 80) removeHole(holes[0]);
  }

  function update(delta) {
    if (!Number.isFinite(delta) || delta < 0) return;
    for (let i = holes.length - 1; i >= 0; i--) {
      const hole = holes[i];
      hole.userData.life -= delta;

      if (hole.userData.life < 3) {
        hole.material.opacity = Math.max(0, hole.userData.life / 3) * 0.92;
      }

      if (hole.userData.life <= 0) {
        removeHole(hole);
      }
    }
  }

  function clear() {
    while (holes.length) removeHole(holes[0]);
  }

  function removeHole(hole) {
    const index = holes.indexOf(hole);
    if (index !== -1) holes.splice(index, 1);

    scene.remove(hole);
    hole.geometry.dispose();
    hole.material.dispose();
  }

  function createBulletHoleTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, 64, 64);

    const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    gradient.addColorStop(0, "rgba(0,0,0,0.95)");
    gradient.addColorStop(0.28, "rgba(20,20,20,0.85)");
    gradient.addColorStop(0.52, "rgba(35,35,35,0.38)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");

    ctx.fillStyle = gradient;
    ctx.beginPath();

    for (let i = 0; i < 18; i++) {
      const angle = (i / 18) * Math.PI * 2;
      const radius = 15 + Math.random() * 12;
      const x = 32 + Math.cos(angle) * radius;
      const y = 32 + Math.sin(angle) * radius;

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.lineWidth = 2;

    for (let i = 0; i < 7; i++) {
      const angle = Math.random() * Math.PI * 2;
      const len = 10 + Math.random() * 12;

      ctx.beginPath();
      ctx.moveTo(32, 32);
      ctx.lineTo(32 + Math.cos(angle) * len, 32 + Math.sin(angle) * len);
      ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  return {
    spawn,
    update,
    clear,
    dispose() { clear(); texture.dispose(); }
  };
}
