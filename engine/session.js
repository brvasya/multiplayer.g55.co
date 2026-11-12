import { RULES, validWeaponSlot } from "./config.js";
import { importEngine } from "./importEngine.js";
import { EVENTS, MAX_IMPACTS, CHAT_COOLDOWN_MS, cleanChatText, elapsed, cleanName, validVector, validPose, validSnapshot, validImpact, shotDirections } from "./rules.js";
import { launchProjectile, advanceProjectile, explosionHits } from "./projectileSimulation.js";

const { getProjectileSettings } = await importEngine("projectiles.js");
const { normalizeAppearance, validAppearance, sameAppearance } = await importEngine("bodygroups.js");

// Rendering-independent listen-host simulation. Only the current Photon master
// assigns lives, health, kills, respawns and round state. Every client retains
// the latest snapshot so a departing master does not reset the match.
export class MultiplayerSession {
  constructor(network, hooks, config = {}) {
    if (!hooks.hitboxes || !["sync", "trace", "samples", "shot"].every(name => typeof hooks.hitboxes[name] === "function")) {
      throw new Error("Multiplayer requires native player hitboxes.");
    }
    this.rules = { ...RULES, ...config.rules };
    this.network = network;
    this.hooks = hooks;
    this.state = { mode: "ffa", round: 1, phase: "waiting", started: 0, ended: 0, players: {}, feed: [],
      projectileSerial: 0, projectilesAt: this.now, projectiles: [], explosions: [] };
    this.lastShot = new Map();
    this.lastPose = new Map();
    this.lastSequence = new Map();
    this.lastSnapshot = -Infinity;
    this.feedId = 0;
    this.shotEffects = [];
    this.lastEffects = -Infinity;
    this.impactEffects = [];
    this.lastImpacts = -Infinity;
    this.lastChat = new Map();
    this.chatSequence = 0;
  }
  get isHost() { return this.network.id === this.network.hostId; }
  get me() { return this.state.players[this.network.id]; }
  get scoreLimit() { return this.rules.scoreLimit; }
  get now() { return this.network.now(); }
  get timeRemaining() { return this.state.phase === "waiting" ? this.rules.roundMs : Math.max(0, this.rules.roundMs - elapsed(this.now, this.state.started)); }

  membersChanged() {
    const members = this.network.actors();
    for (const id of this.lastChat.keys()) if (!members.some(actor => actor.id === id)) this.lastChat.delete(id);
    if (!this.isHost) return;
    for (const id of Object.keys(this.state.players)) {
      if (!members.some(a => a.id === Number(id))) {
        delete this.state.players[id];
        this.lastShot.delete(Number(id)); this.lastPose.delete(Number(id)); this.lastSequence.delete(Number(id));
      }
    }
    for (const actor of members) {
      if (!this.state.players[actor.id]) this.state.players[actor.id] = {
        id: actor.id, name: cleanName(actor.name), p: [0, 1.75, 0], yaw: 0, pitch: 0,
        hp: 0, kills: 0, deaths: 0, ready: false, life: 0, died: 0,
        appearance: this.hooks.appearanceSchema ? normalizeAppearance(this.hooks.appearanceSchema) : null,
        protectedAt: 0, protected: false, slot: this.rules.defaultWeaponSlot, seq: -1, death: null
      };
    }
    this.feedId = Math.max(this.feedId, ...this.state.feed.map(f => f.id), 0);
    this.publish();
  }

  receive(code, data, sender) {
    const actor = this.network.actors().find(a => a.id === sender);
    if (!actor) return;
    if (code === EVENTS.CHAT) {
      const text = cleanChatText(data?.text), previous = this.lastChat.get(sender);
      if (!text || !Number.isSafeInteger(data.seq) || data.seq < 1
          || (previous && (data.seq <= previous.seq || elapsed(this.now, previous.at) < CHAT_COOLDOWN_MS))) return;
      this.lastChat.set(sender, { seq: data.seq, at: this.now });
      // Identity comes from Photon, never from fields supplied in the message.
      this.hooks.onChat?.({ actor: sender, name: cleanName(actor.name), text });
      return;
    }
    if (code === EVENTS.SNAPSHOT) {
      if (sender !== this.network.hostId || this.isHost || !validSnapshot(data, this.hooks.appearanceSchema, this)) return;
      const next = structuredClone(data);
      // Movement reaches peers directly. A host snapshot can be older than a
      // pose already observed; preserve that pose, but always take host health.
      for (const p of Object.values(next.players)) {
        const previous = this.state.players[p.id];
        if (previous?.life === p.life && previous.seq > p.seq) {
          for (const field of ["p", "yaw", "pitch", "slot", "motion", "seq"]) p[field] = previous[field];
        }
      }
      this.state = next;
      this.hooks.onState?.(this.state);
      return;
    }
    if (code === EVENTS.SHOT) {
      if (sender !== this.network.hostId || !Array.isArray(data) || data.length > 32) return;
      for (const shot of data) {
        if (validVector(shot?.origin) && validVector(shot?.direction) && Number.isInteger(shot.seed)
            && validWeaponSlot(shot.slot, this.rules)) this.hooks.onShot?.(shot);
      }
      return;
    }
    if (code === EVENTS.IMPACTS) {
      if (sender !== this.network.hostId || this.isHost || data?.round !== this.state.round
          || !Array.isArray(data.impacts) || data.impacts.length > MAX_IMPACTS) return;
      for (const impact of data.impacts) {
        if (validImpact(impact)) this.hooks.onImpact?.(impact);
      }
      return;
    }
    const p = this.state.players[sender];
    if (code === EVENTS.POSE && p?.ready && p.hp > 0 && validPose(data, this.rules) && data.life === p.life) {
      const previous = this.lastSequence.get(sender);
      if (previous && previous.life === p.life && data.seq <= previous.seq) return;
      if (this.isHost) {
        // Generous jitter allowance, bounded horizontal travel. Physics remains
        // client simulated, not an anti-cheat or dedicated authoritative server.
        const before = this.lastPose.get(sender) ?? this.now;
        const dt = Math.max(.08, Math.min(1, elapsed(this.now, before) / 1000));
        if (Math.hypot(data.p[0] - p.p[0], data.p[2] - p.p[2]) > 14 * dt + 3) return;
      }
      this.lastSequence.set(sender, { life: p.life, seq: data.seq });
      this.lastPose.set(sender, this.now);
      Object.assign(p, { p: [...data.p], yaw: data.yaw, pitch: data.pitch, slot: data.slot, seq: data.seq });
      p.motion = data.motion ? { velocity: [...data.motion.velocity], grounded: data.motion.grounded,
        walking: data.motion.walking, reload: data.motion.reload ?? null,
        ...(data.motion.crouch == null ? {} : { crouch: data.motion.crouch }) } : null;
      this.hooks.onPose?.(p);
      return;
    }
    if (!this.isHost) return;
    if (code === EVENTS.HELLO) { this.membersChanged(); return; }
    if (!p) return;
    if (code === EVENTS.APPEARANCE) {
      // Selections index the server's loaded model, never a client-supplied URL.
      // Only this sender's appearance can change; health and life stay intact.
      const schema = this.hooks.appearanceSchema;
      if (!schema || !validAppearance(data, schema) || sameAppearance(p.appearance, data)) return;
      p.appearance = normalizeAppearance(schema, data); this.publish();
    } else if (code === EVENTS.READY && !p.ready) {
      p.ready = true;
      if (this.state.phase !== "ended") this.spawn(p);
      this.tick(); this.publish();
    } else if (code === EVENTS.FIRE) this.fire(p, data);
    else if (code === EVENTS.FALL && p.ready && p.hp > 0 && data?.life === p.life && p.p[1] < -20) {
      this.kill(p, null); this.publish();
    }
  }

  request(code, data = {}) {
    if (this.isHost) this.receive(code, data, this.network.id);
    else this.network.send(code, data, { targetActors: [this.network.hostId] });
  }

  sendChat(value) {
    const text = cleanChatText(value);
    if (!text) return "Enter a message of 1–160 characters.";
    if (!this.network.joined) return "You are no longer connected to this room.";
    const previous = this.lastChat.get(this.network.id);
    if (previous && elapsed(this.now, previous.at) < CHAT_COOLDOWN_MS) return "Please wait a moment before sending again.";
    const data = { text, seq: ++this.chatSequence };
    // Photon sends to the other room members by default, without caching. Keep
    // chat separate from host snapshots so migration and new rounds retain it.
    try { this.network.send(EVENTS.CHAT, data); }
    catch { return "Message could not be sent. Please try again."; }
    this.receive(EVENTS.CHAT, data, this.network.id);
    return "";
  }

  pose(data) {
    // Aggregate poses through the master: one 10 Hz snapshot for the room,
    // instead of every player broadcasting separately to every other player.
    this.receive(EVENTS.POSE, data, this.network.id);
    if (!this.isHost) this.network.send(EVENTS.POSE, data, { targetActors: [this.network.hostId] });
  }

  spawn(p) {
    const pose = this.hooks.spawn(p.id, Object.values(this.state.players).filter(other => other.id !== p.id && other.ready && other.hp > 0));
    if (!pose || !validVector(pose.p)) return false;
    Object.assign(p, { p: pose.p, yaw: pose.yaw || 0, pitch: 0, hp: 100,
      life: p.life + 1, died: 0, protectedAt: this.now, protected: true, motion: null, seq: -1, death: null });
    this.lastShot.delete(p.id); this.lastPose.delete(p.id); this.lastSequence.delete(p.id);
    return true;
  }

  kill(victim, attacker, headshot = false, impact = null) {
    if (victim.hp <= 0 || this.state.phase === "ended") return;
    victim.death = { p: [...victim.p], yaw: victim.yaw, slot: victim.slot, appearance: victim.appearance ? structuredClone(victim.appearance) : null,
      motion: victim.motion ? structuredClone(victim.motion) : null,
      point: impact?.point || null, direction: impact?.direction || null, damage: impact?.damage || 0 };
    victim.hp = 0; victim.deaths++; victim.died = this.now;
    if (attacker && this.state.phase === "playing") attacker.kills++;
    this.state.feed.push({ id: ++this.feedId, killer: attacker?.name || impact?.cause || "Fall", victim: victim.name, headshot });
    this.state.feed = this.state.feed.slice(-5);
  }

  fire(shooter, data) {
    this.tick();
    if (!shooter.ready || shooter.hp <= 0 || this.state.phase === "ended" || data?.life !== shooter.life
        || !validVector(data.direction) || Math.abs(Math.hypot(...data.direction) - 1) > .03
        || !Number.isInteger(data.seed)) return;
    const gun = this.hooks.weapons[data.slot];
    if (!gun || data.slot !== shooter.slot) return;
    const last = this.lastShot.get(shooter.id);
    if (last !== undefined && elapsed(this.now, last) < gun.fireCooldownMs * .85) return;
    this.lastShot.set(shooter.id, this.now);
    shooter.protected = false;
    this.hooks.hitboxes.sync(this.state.players, this.now);
    const direction = [...data.direction];
    const origin = [...shooter.p];
    const projectileSettings = getProjectileSettings(gun);
    if (projectileSettings) {
      if (this.state.projectiles.length >= this.rules.maxProjectiles) this.state.projectiles.shift();
      this.state.projectiles.push(launchProjectile(++this.state.projectileSerial, shooter, data.slot, direction, gun, projectileSettings));
    } else {
      // Resolve the whole volley before applying damage: a lethal early pellet
      // must not make later pellets pass through that body onto the wall.
      const hits = shotDirections(direction, gun.spread, gun.pellets, data.seed).map(ray => {
        const surface = this.hooks.wallHit?.(origin, ray);
        const wall = this.hooks.wallHit ? surface?.distance ?? Infinity : this.hooks.wallDistance(origin, ray);
        return { ray, surface, hit: this.hooks.hitboxes.trace(origin, ray, this.state.players, shooter.id, wall) };
      });
      for (const { ray, surface, hit } of hits) {
        if (!hit) {
          if (surface) this.emitImpact({ type: "surface", point: surface.point, normal: surface.normal });
          continue;
        }
        if (this.state.phase !== "playing") continue;
        const target = this.state.players[hit.id];
        if (target.hp <= 0) continue;
        if (target.protected && elapsed(this.now, target.protectedAt) < this.rules.protectionMs) continue;
        const damage = gun.damage * (hit.headshot ? 2 : 1);
        const point = origin.map((n, i) => n + ray[i] * hit.distance);
        if (damage >= target.hp) this.kill(target, shooter, hit.headshot, {
          point, direction: [...ray], damage
        });
        else target.hp -= damage;
        this.emitImpact({ type: "blood", point, normal: ray.map(n => -n), direction: [...ray],
          damage, headshot: hit.headshot, pellets: gun.pellets });
      }
    }
    const effect = { actor: shooter.id, life: shooter.life, origin, direction, slot: data.slot, seed: data.seed };
    this.hooks.hitboxes.shot(effect);
    this.shotEffects.push(effect);
    this.hooks.onShot?.(effect);
    this.tick(); this.hooks.onState?.(this.state);
  }

  emitImpact(impact) {
    // Cosmetic effects come only from host-confirmed collisions/damage. Never
    // predict them from a client's older player poses or accept client targets.
    if (this.impactEffects.length >= MAX_IMPACTS) this.impactEffects.shift();
    this.impactEffects.push(impact);
    this.hooks.onImpact?.(impact);
  }

  updateProjectiles(now) {
    const delta = Math.max(0, elapsed(now, this.state.projectilesAt) / 1000);
    this.state.projectilesAt = now;
    const remaining = [];
    for (const projectile of this.state.projectiles) {
      const impact = advanceProjectile(projectile, delta, this.state.players, (...args) => this.hooks.wallDistance(...args), this.hooks.hitboxes);
      if (!impact) { remaining.push(projectile); continue; }
      this.state.explosions.push({ id: projectile.id, p: impact.p, radius: projectile.radius, at: now });
      if (this.state.phase !== "playing") continue;
      // A later respawn or weapon switch cannot change an in-flight grenade's
      // damage or ownership, even if its owner has left.
      const attacker = this.state.players[projectile.actor] || {
        id: projectile.actor, name: projectile.name, kills: 0
      };
      for (const hit of explosionHits(projectile, impact, this.state.players, (...args) => this.hooks.wallDistance(...args), this.hooks.hitboxes)) {
        const target = hit.player, self = target.id === projectile.actor;
        if (target.protected && elapsed(now, target.protectedAt) < this.rules.protectionMs) continue;
        if (hit.damage >= target.hp) this.kill(target, self ? null : attacker, false, {
          point: hit.point, direction: hit.direction, damage: hit.damage, cause: "Explosion"
        });
        else target.hp -= hit.damage;
        this.emitImpact({ type: "blood", point: hit.point, normal: hit.direction.map(n => -n),
          direction: hit.direction, damage: hit.damage, headshot: false, pellets: 1 });
      }
    }
    this.state.projectiles = remaining;
    this.state.explosions = this.state.explosions.filter(e => elapsed(now, e.at) < 2000).slice(-this.rules.maxExplosions);
  }

  tick() {
    if (!this.isHost) return;
    const now = this.now, players = Object.values(this.state.players);
    if (this.shotEffects.length && (this.lastEffects === -Infinity || elapsed(now, this.lastEffects) >= this.rules.snapshotIntervalMs)) {
      this.network.send(EVENTS.SHOT, this.shotEffects.splice(0, 32)); this.lastEffects = now;
    }
    const ready = players.filter(p => p.ready);
    if (this.state.phase === "waiting" && ready.length >= 2) {
      this.state.phase = "playing"; this.state.started = now;
      this.state.projectiles = []; this.state.explosions = []; this.state.projectilesAt = now;
      this.impactEffects = [];
      // Begin together with fresh lives, health and protection.
      players.filter(p => p.ready).forEach(p => this.spawn(p));
      this.publish();
    }
    this.hooks.hitboxes.sync(this.state.players, now);
    if (this.state.phase !== "ended" && (this.state.phase === "waiting" || elapsed(now, this.state.started) < this.rules.roundMs)) this.updateProjectiles(now);
    if (this.impactEffects.length && (this.lastImpacts === -Infinity || elapsed(now, this.lastImpacts) >= this.rules.snapshotIntervalMs)) {
      this.network.send(EVENTS.IMPACTS, { round: this.state.round, impacts: this.impactEffects.splice(0, MAX_IMPACTS) });
      this.lastImpacts = now;
    }
    if (this.state.phase === "playing" && (
        elapsed(now, this.state.started) >= this.rules.roundMs || players.some(p => p.kills >= this.scoreLimit))) {
      this.state.phase = "ended"; this.state.ended = now; this.state.projectiles = []; this.publish();
    }
    if (this.state.phase === "ended") {
      if (elapsed(now, this.state.ended) >= this.rules.intermissionMs) {
        this.state.round++; this.state.phase = "waiting"; this.state.started = 0; this.state.ended = 0;
        this.state.projectiles = []; this.state.explosions = []; this.state.projectilesAt = now;
        this.impactEffects = [];
        this.state.feed = [];
        for (const p of players) { p.kills = p.deaths = 0; if (p.ready) this.spawn(p); }
        this.tick(); this.publish();
      }
      return;
    }
    let changed = false;
    for (const p of players) {
      if (p.ready && p.hp <= 0 && elapsed(now, p.died) >= this.rules.respawnMs) changed = this.spawn(p) || changed;
      if (p.protected && elapsed(now, p.protectedAt) >= this.rules.protectionMs) { p.protected = false; changed = true; }
    }
    if (changed || elapsed(now, this.lastSnapshot) >= this.rules.snapshotIntervalMs || this.lastSnapshot === -Infinity) this.publish();
  }

  publish() {
    if (!this.isHost) return;
    this.lastSnapshot = this.now;
    this.network.send(EVENTS.SNAPSHOT, structuredClone(this.state));
    this.hooks.onState?.(this.state);
  }
}
