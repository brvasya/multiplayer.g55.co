export function normalized(vector) {
  const length = Math.hypot(...vector);
  return length > 1e-8 ? vector.map(n => n / length) : [0, 1, 0];
}

// Pure host simulation. All state needed for a master handoff lives in the
// room snapshot; rendering never determines impacts or damage.
export function launchProjectile(id, shooter, slot, direction, gun, settings) {
  return { id, actor: shooter.id, name: shooter.name, slot,
    type: settings.type, p: [...shooter.p], v: direction.map(n => n * settings.speed),
    age: 0, gravity: settings.gravity, lifetime: settings.lifetime,
    radius: settings.radius, damage: gun.damage };
}

export function advanceProjectile(projectile, delta, players, wallDistance, hitboxes) {
  let remaining = Math.min(Math.max(0, delta), projectile.lifetime - projectile.age);
  while (remaining > 1e-8) {
    const step = Math.min(1 / 60, remaining), from = projectile.p;
    const next = from.map((n, i) => n + projectile.v[i] * step - (i === 1 ? .5 * projectile.gravity * step * step : 0));
    const distance = Math.hypot(...next.map((n, i) => n - from[i]));
    const direction = normalized(next.map((n, i) => n - from[i]));
    const wall = wallDistance(from, direction, distance);
    const hit = hitboxes.trace(from, direction, players, projectile.actor, Math.min(distance + 1e-6, wall));
    projectile.v[1] -= projectile.gravity * step;
    projectile.age += step; remaining -= step;
    if (hit || wall <= distance) {
      const travel = hit ? hit.distance : wall;
      // Keep splash visibility rays outside the wall that stopped the grenade.
      const p = from.map((n, i) => n + direction[i] * Math.max(0, travel - (hit ? 0 : .008)));
      projectile.p = p;
      return { p, target: hit?.id ?? null, direction };
    }
    projectile.p = next;
  }
  return projectile.age >= projectile.lifetime - 1e-8
    ? { p: [...projectile.p], target: null, direction: normalized(projectile.v) } : null;
}

export function explosionHits(projectile, impact, players, wallDistance, hitboxes) {
  const hits = [];
  for (const p of Object.values(players)) {
    if (!p.ready || p.hp <= 0) continue;
    let point = null, nearest = projectile.radius;
    if (impact.target === p.id) { point = [...impact.p]; nearest = 0; }
    else for (const sample of hitboxes.samples(p.id, impact.p)) {
      const direction = sample.map((n, i) => n - impact.p[i]);
      const distance = Math.hypot(...direction);
      if (distance >= nearest) continue;
      if (distance > .002 && wallDistance(impact.p, normalized(direction), distance) < distance - .002) continue;
      point = sample; nearest = distance;
    }
    if (!point) continue;
    const damage = impact.target === p.id ? projectile.damage
      : Math.max(1, Math.round(projectile.damage * (1 - nearest / projectile.radius)));
    hits.push({ player: p, damage, point,
      direction: nearest > 1e-8 ? normalized(point.map((n, i) => n - impact.p[i])) : normalized(projectile.v) });
  }
  return hits;
}
