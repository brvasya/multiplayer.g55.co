import { RULES, validMode, validWeaponSlot } from "./config.js";
import { importEngine } from "./importEngine.js";

const { validAppearance } = await importEngine("bodygroups.js");

export const EVENTS = Object.freeze({ HELLO: 1, READY: 2, POSE: 3, FIRE: 4, SNAPSHOT: 5, SHOT: 6, FALL: 7, IMPACTS: 8, APPEARANCE: 9, CHAT: 10 });
export const CHAT_MAX_LENGTH = 160;
export const CHAT_COOLDOWN_MS = 1000;
export function cleanChatText(value) {
  if (typeof value !== "string" || value.length > CHAT_MAX_LENGTH) return "";
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, " ").replace(/\s+/g, " ").trim();
}
export const MAX_IMPACTS = 64;
export const elapsed = (now, then) => (now - then) | 0;
export const validVector = value => Array.isArray(value) && value.length === 3 && value.every(n => Number.isFinite(n) && Math.abs(n) < 1000);
export const cleanName = value => String(value || "Soldier").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 20) || "Soldier";

export function validMotion(motion) {
  return motion == null || (validVector(motion.velocity) && motion.velocity.every(value => Math.abs(value) <= 64)
    && typeof motion.grounded === "boolean" && typeof motion.walking === "boolean"
    && (motion.crouch == null || (Number.isFinite(motion.crouch) && motion.crouch >= 0 && motion.crouch <= 1))
    && (motion.reload == null || (Number.isFinite(motion.reload) && motion.reload >= 0 && motion.reload <= 1)));
}

export function validImpact(impact) {
  if (!impact || !validVector(impact.point) || !validVector(impact.normal)
      || Math.abs(Math.hypot(...impact.normal) - 1) > .03) return false;
  if (impact.type === "surface") return true;
  return impact.type === "blood" && validVector(impact.direction)
    && Math.abs(Math.hypot(...impact.direction) - 1) < .03
    && Number.isFinite(impact.damage) && impact.damage > 0 && impact.damage <= 200
    && typeof impact.headshot === "boolean" && Number.isInteger(impact.pellets)
    && impact.pellets >= 1 && impact.pellets <= 32;
}

export function shotDirections(direction, spread, pellets, seed) {
  let s = seed >>> 0;
  const random = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 - .5; };
  return Array.from({ length: pellets }, () => {
    const d = direction.map(n => n + random() * spread);
    const length = Math.hypot(...d);
    return d.map(n => n / length);
  });
}

export function validPose(pose, rules = RULES) {
  return pose && validVector(pose.p) && Number.isFinite(pose.yaw) && Math.abs(pose.yaw) < 1e6
    && Number.isFinite(pose.pitch) && Math.abs(pose.pitch) <= Math.PI / 2
    && Number.isInteger(pose.seq) && pose.seq >= 0 && Number.isInteger(pose.life)
    && validWeaponSlot(pose.slot, rules) && validMotion(pose.motion);
}

function validDeath(death, schema, rules) {
  // Waiting and living players have no death record.
  if (death == null) return true;
  return validVector(death.p) && Number.isFinite(death.yaw) && Number.isFinite(death.damage)
    && death.damage >= 0 && death.damage <= 200
    && (death.slot == null || validWeaponSlot(death.slot, rules)) && validMotion(death.motion)
    && (death.appearance == null ? !schema : validAppearance(death.appearance, schema))
    && ((death.direction == null && death.point == null)
      || (validVector(death.direction) && validVector(death.point) && Math.abs(Math.hypot(...death.direction) - 1) < .03));
}

export function validSnapshot(s, schema = null, { rules = RULES } = {}) {
  if (!s || !validMode(s.mode) || !["waiting", "playing", "ended"].includes(s.phase) || !Number.isInteger(s.round)
      || !Number.isFinite(s.started) || !Number.isFinite(s.ended) || !s.players || typeof s.players !== "object"
      || !Array.isArray(s.feed) || s.feed.length > 5
      || !Number.isSafeInteger(s.projectileSerial) || s.projectileSerial < 0 || !Number.isFinite(s.projectilesAt)
      || !Array.isArray(s.projectiles) || s.projectiles.length > rules.maxProjectiles
      || !Array.isArray(s.explosions) || s.explosions.length > rules.maxExplosions
      || !s.projectiles.every(p => validProjectile(p, s, rules))
      || !s.explosions.every(e => Number.isSafeInteger(e?.id) && e.id > 0 && e.id <= s.projectileSerial
        && validVector(e.p) && Number.isFinite(e.radius) && e.radius >= 0 && e.radius <= 30 && Number.isFinite(e.at))) return false;
  const players = Object.values(s.players);
  return players.length <= rules.maxPlayers && players.every(p => p && Number.isInteger(p.id) && p.id > 0
    && validVector(p.p) && Number.isFinite(p.hp) && p.hp >= 0 && p.hp <= 100
    && Number.isInteger(p.life) && Number.isFinite(p.yaw) && Number.isFinite(p.pitch)
    && Number.isInteger(p.kills) && p.kills >= 0 && Number.isInteger(p.deaths) && p.deaths >= 0
    && Number.isFinite(p.died) && Number.isFinite(p.protectedAt) && Number.isInteger(p.seq)
    && typeof p.ready === "boolean" && typeof p.name === "string" && p.name.length <= 20
    && (p.appearance == null ? !schema : validAppearance(p.appearance, schema))
    && validWeaponSlot(p.slot, rules) && validMotion(p.motion) && validDeath(p.death, schema, rules))
    && s.feed.every(f => f && Number.isInteger(f.id) && typeof f.killer === "string" && typeof f.victim === "string");
}

function validProjectile(p, state, rules) {
  return p && Number.isSafeInteger(p.id) && p.id > 0 && p.id <= state.projectileSerial
    && Number.isInteger(p.actor) && p.actor > 0 && typeof p.name === "string" && p.name.length <= 20
    && validWeaponSlot(p.slot, rules) && p.type === "grenade"
    && validVector(p.p) && validVector(p.v) && Math.hypot(...p.v) <= 1000
    && Number.isFinite(p.age) && p.age >= 0 && p.age <= p.lifetime
    && Number.isFinite(p.lifetime) && p.lifetime > 0 && p.lifetime <= 30
    && Number.isFinite(p.gravity) && p.gravity >= 0 && p.gravity <= 100
    && Number.isFinite(p.radius) && p.radius >= 0 && p.radius <= 30
    && Number.isFinite(p.damage) && p.damage >= 0 && p.damage <= 200;
}
