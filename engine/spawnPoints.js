// One shared free-for-all pool; player IDs never select a side of the map.
export function createPlayerSpawns({ THREE, navigation, floorObjects, colliders = [], spawn, playerHeight = 1.75 }) {
  const grid = navigation?.grid;
  if (!grid?.walkable || !Number.isInteger(grid.width) || grid.width < 1 || !Number.isFinite(grid.cellSize) || grid.cellSize <= 0
      || !Number.isFinite(grid.origin) || grid.walkable.length % grid.width || typeof navigation.hasLineOfSight !== "function") {
    throw new Error("Multiplayer spawning requires a map with an existing walkable navigation grid.");
  }
  const { width, cellSize, origin, walkable } = grid;
  const count = walkable.length, height = Math.floor(count / width);
  const queue = new Int32Array(count);
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0), 0, 40);
  const floorNormal = new THREE.Vector3(), normalMatrix = new THREE.Matrix3();
  const bounds = colliders.map(object => new THREE.Box3().setFromObject(object));
  const standingHeight = playerHeight * (1 + .19 / 1.75), radius = .45;
  const xAt = i => origin + (i % width + 0.5) * cellSize;
  const zAt = i => origin + (Math.floor(i / width) + 0.5) * cellSize;
  const positions = new Map();

  function cellAt(point) {
    const x = Math.floor((point.x - origin) / cellSize), z = Math.floor((point.z - origin) / cellSize);
    return x < 0 || z < 0 || x >= width || z >= height ? -1 : z * width + x;
  }
  function nearestCell(point) {
    const cell = cellAt(point);
    if (floorPoint(cell)) return cell;
    let best = -1, distance = Infinity;
    for (let i = 0; i < count; i++) {
      if (!floorPoint(i)) continue;
      const d = (point.x - xAt(i)) ** 2 + (point.z - zAt(i)) ** 2;
      if (d < distance) { best = i; distance = d; }
    }
    return best;
  }
  function neighbors(cell, visit) {
    const x = cell % width;
    if (x > 0) visit(cell - 1);
    if (x < width - 1) visit(cell + 1);
    if (cell >= width) visit(cell - width);
    if (cell + width < count) visit(cell + width);
  }
  function flood(cell) {
    const connected = new Uint8Array(count);
    if (cell < 0) return connected;
    let head = 0, tail = 1; queue[0] = cell; connected[cell] = 1;
    while (head < tail) {
      const current = queue[head++];
      neighbors(current, next => {
        if (connected[next] || !floorPoint(next)
            || !navigation.hasLineOfSight(floorPoint(current), floorPoint(next), radius)) return;
        connected[next] = 1; queue[tail++] = next;
      });
    }
    return connected;
  }
  const connected = flood(nearestCell(spawn));
  const connectedCells = Array.from({ length: count }, (_, i) => i).filter(i => connected[i]);
  if (connectedCells.length < 2) throw new Error("No connected spawn positions in this map.");

  function floorPoint(cell) {
    if (cell < 0 || cell >= count || !walkable[cell]) return null;
    if (positions.has(cell)) return positions.get(cell);
    ray.ray.origin.set(xAt(cell), spawn.y + 8, zAt(cell));
    // These maps have one navigation layer. Roofs/scenery cannot become spawns.
    const hit = ray.intersectObjects(floorObjects, false).find(hit => {
      if (!hit.face || Math.abs(hit.point.y - (spawn.y - playerHeight)) >= 1.5) return false;
      normalMatrix.getNormalMatrix(hit.object.matrixWorld);
      return floorNormal.copy(hit.face.normal).applyMatrix3(normalMatrix).normalize().y > 0.45;
    });
    let point = hit ? hit.point.clone() : null;
    // Navigation supplies horizontal clearance. Also reject low ceilings and
    // props omitted from its footprints; a respawn must fit a standing player.
    if (point && bounds.some(box => {
      if (box.max.y <= point.y + .05 || box.min.y >= point.y + standingHeight) return false;
      const dx = Math.max(box.min.x - point.x, 0, point.x - box.max.x);
      const dz = Math.max(box.min.z - point.z, 0, point.z - box.max.z);
      return dx * dx + dz * dz < radius * radius;
    })) point = null;
    positions.set(cell, point);
    return point;
  }
  function getSpawnPoint(players = []) {
    let best = null, bestScore = -Infinity;
    // Partial Fisher–Yates samples the entire shared pool without replacement.
    // If the sample is occupied, keep searching instead of spawning on someone.
    for (let k = 0; k < connectedCells.length && (k < 160 || !best); k++) {
      const pick = k + Math.floor(Math.random() * (connectedCells.length - k));
      [connectedCells[k], connectedCells[pick]] = [connectedCells[pick], connectedCells[k]];
      const point = floorPoint(connectedCells[k]);
      let occupied = false, nearestPlayer = 45, exposed = false;
      for (const position of players) {
        const d = Math.hypot(point.x - position.x, point.z - position.z);
        if (d < 1.5) { occupied = true; break; }
        nearestPlayer = Math.min(nearestPlayer, d);
        if (d < 28 && navigation.hasLineOfSight(point, position, .12)) exposed = true;
      }
      if (occupied) continue;
      const score = Math.min(35, nearestPlayer) * 4 - (exposed ? 65 : 0) + Math.random() * 4;
      if (score > bestScore) { bestScore = score; best = point; }
    }
    return best?.clone() || null;
  }

  function facing(point) {
    const cell = cellAt(point), x = cell % width, z = Math.floor(cell / width);
    let yaw = 0, bestScore = -Infinity;
    // Face a clear way out of the chosen spawn, with random ties at junctions.
    for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      let clearance = 0;
      for (let step = 1; step <= Math.ceil(6 / cellSize); step++) {
        const nx = x + dx * step, nz = z + dz * step;
        if (nx < 0 || nx >= width || nz < 0 || nz >= height) break;
        const next = nz * width + nx;
        if (!connected[next] || !navigation.hasLineOfSight(point, floorPoint(next), radius)) break;
        clearance = step * cellSize;
      }
      if (!clearance) continue;
      const score = clearance + Math.random() * cellSize;
      if (score > bestScore) { bestScore = score; yaw = Math.atan2(-dx, -dz); }
    }
    return yaw;
  }
  return { getSpawnPoint, facing };
}
