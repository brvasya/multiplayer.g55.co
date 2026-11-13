import { resolveMapConfig } from "./mapManager.js";
import { CROUCH_HEIGHT_RATIO } from "./playerStance.js";

export const RULES = Object.freeze({
  scoreLimit: 20, roundMs: 300000, intermissionMs: 12000, respawnMs: 3000, protectionMs: 2000,
  poseIntervalMs: 100, snapshotIntervalMs: 100, playerHeight: 1.75, crouchHeight: 1,
  maxProjectiles: 48, maxExplosions: 16, maxPlayers: 8,
  weaponSlots: Object.freeze([1, 2, 3, 4, 5, 6]), defaultWeaponSlot: 3
});
export const validMode = mode => mode === "ffa";
export const validWeaponSlot = (slot, rules = RULES) => Number.isInteger(slot) && rules.weaponSlots.includes(slot);

const REGIONS = Object.freeze({ eu: "Europe", us: "US East", usw: "US West", asia: "Asia", jp: "Japan", au: "Australia", sa: "South America" });
const PLAYER = Object.freeze({ gravity: 25, jumpPower: 10, playerSpeed: 8.5,
  groundAcceleration: 55, airAcceleration: 12, friction: 14, airFriction: .4, stopSpeed: 1.2,
  walkMultiplier: .55, crouchMultiplier: .34, crouchTransitionSeconds: .16,
  mouseSensitivity: .0022, touchSensitivity: .006 });

// Paths belong to the config module, not the engine or page embedding the game.
function resolveAssets(value, base) {
  if (typeof value === "string" && /^(\.\.?\/|assets\/)/.test(value)) return new URL(value, base).href;
  if (Array.isArray(value)) return value.map(item => resolveAssets(item, base));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveAssets(item, base)]));
  return value;
}

export function resolveGameConfig(input) {
  if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(input?.id || "")) throw new Error("Game config needs a unique lowercase id.");
  if (typeof input.title !== "string" || !input.title.trim()) throw new Error("Game config needs a title.");
  if (typeof input.baseUrl !== "string") throw new Error("Game config needs baseUrl: import.meta.url.");
  const base = new URL("./", input.baseUrl);
  if (!input.assets?.character?.models?.length || !input.assets?.hands?.model || !input.assets?.weaponSlots?.length) {
    throw new Error("Game config needs character, hands and weaponSlots assets.");
  }
  const character = input.assets.character;
  if (!Array.isArray(character.models) || character.models.some(model => typeof model !== "string" || !/\.mdl(?:[?#]|$)/i.test(model))
      || new Set(character.models).size !== character.models.length) {
    throw new Error("Character models must be unique Source MDL paths.");
  }
  const hands = input.assets.hands.model;
  const handsModels = Array.isArray(hands) ? [...hands] : [hands];
  if (handsModels.some(model => typeof model !== "string" || !/\.mdl(?:[?#]|$)/i.test(model))
      || Array.isArray(hands) && hands.length !== character.models.length) {
    throw new Error("Hands model must be a Source MDL path or an array with one MDL path per character model, in the same order.");
  }
  const slots = input.assets.weaponSlots.map(slot => slot.id);
  if (new Set(slots).size !== slots.length || slots.some(id => !Number.isInteger(id) || id < 1 || id > 9)
      || input.assets.weaponSlots.some(slot => !slot.asset?.model || !slot.asset?.behavior)) {
    throw new Error("Weapon slots need unique ids 1–9 and a model with behavior.");
  }
  const rules = { ...RULES, ...input.rules, weaponSlots: slots,
    defaultWeaponSlot: input.rules?.defaultWeaponSlot ?? slots[0] };
  rules.crouchHeight = input.rules?.crouchHeight ?? rules.playerHeight * CROUCH_HEIGHT_RATIO;
  if (!Number.isFinite(rules.crouchHeight) || rules.crouchHeight <= rules.playerHeight * .3 || rules.crouchHeight >= rules.playerHeight) {
    throw new Error("crouchHeight must be between 30% and 100% of playerHeight.");
  }
  const player = { ...PLAYER, ...input.player, playerHeight: rules.playerHeight, crouchHeight: rules.crouchHeight };
  if (!Number.isFinite(player.crouchMultiplier) || player.crouchMultiplier <= 0 || player.crouchMultiplier > 1
      || !Number.isFinite(player.crouchTransitionSeconds) || player.crouchTransitionSeconds <= 0) {
    throw new Error("Invalid crouch movement settings.");
  }
  if (!validWeaponSlot(rules.defaultWeaponSlot, rules)) throw new Error("The default weapon must be in weaponSlots.");
  for (const key of ["roundMs", "intermissionMs", "respawnMs", "protectionMs", "poseIntervalMs", "snapshotIntervalMs", "playerHeight", "maxProjectiles", "maxExplosions", "maxPlayers"]) {
    if (!Number.isFinite(rules[key]) || rules[key] <= 0) throw new Error(`Invalid multiplayer rule: ${key}.`);
  }
  if (!Number.isInteger(rules.maxPlayers) || rules.maxPlayers < 2 || rules.maxPlayers > 16) throw new Error("maxPlayers must be 2–16.");
  if (!Number.isInteger(rules.scoreLimit) || rules.scoreLimit < 1) throw new Error("scoreLimit must be a positive integer.");
  const photon = { ...input.photon, gameId: input.id, roomPrefix: input.id + "-",
    appVersion: input.photon?.appVersion || input.id + "-mp-8", maxPlayers: rules.maxPlayers,
    defaultRegion: input.photon?.defaultRegion || "eu", regions: input.photon?.regions || REGIONS };
  if (!/^[0-9a-f-]{36}$/i.test(photon.appId || "")) throw new Error("Configure a Photon Realtime App ID.");
  if (!Object.hasOwn(photon.regions, photon.defaultRegion)) throw new Error("The default Photon region must be enabled.");
  return { ...input, rules, photon, maps: resolveMapConfig(input.maps),
    storagePrefix: input.storagePrefix || input.id + ":", defaultName: input.defaultName || "Player",
    player,
    assets: resolveAssets(input.assets, base), sounds: resolveAssets(input.sounds || {}, base),
    ui: resolveAssets(input.ui || {}, base) };
}
