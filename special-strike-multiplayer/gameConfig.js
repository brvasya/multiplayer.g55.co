import { SOLDIER } from "./assets/soldier.js";
import { HANDS } from "./assets/hands.js";
import { PISTOL } from "./assets/pistol.js";
import { SMG } from "./assets/smg.js";
import { RIFLE } from "./assets/rifle.js";
import { SHOTGUN } from "./assets/shotgun.js";
import { SNIPER } from "./assets/sniper.js";
import { LAUNCHER } from "./assets/launcher.js";

export const GAME_ASSETS = {
character: SOLDIER,
hands: HANDS,
weaponSlots: [
{ id: 1, asset: PISTOL },
{ id: 2, asset: SMG },
{ id: 3, asset: RIFLE },
{ id: 4, asset: SHOTGUN },
{ id: 5, asset: SNIPER },
{ id: 6, asset: LAUNCHER }
]
};
const GAME_TITLE = "Special Strike Multiplayer";
const GAME_ID = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(GAME_TITLE))), byte => byte.toString(16).padStart(2, "0")).join("").slice(0, 32);

export const GAME_CONFIG = {
  id: GAME_ID,
  title: GAME_TITLE,
  baseUrl: import.meta.url,
  storagePrefix: `${GAME_ID}:`,
  ui: { heading: ["Special Strike", "Multiplayer"], font: "./assets/font.woff2", moreGamesUrl: `https://g55.co/?utm_source=moreGamesButton&utm_medium=${encodeURIComponent(GAME_TITLE)}` },
  photon: {
    appId: "691099e1-5281-44f0-88c1-5dce00571f34",
    appVersion: GAME_ID,
    defaultRegion: "us"
  },
  rules: { maxPlayers: 8, defaultWeaponSlot: 3, roundMs: 300000, scoreLimit: 20 },
  sounds: { jump: "./assets/sounds/jump.ogg", death: "./assets/sounds/death.ogg", hit: "./assets/sounds/damage.ogg" },
  maps: {
    defaultId: "map_office",
    items: [
      { id: "map_office", name: "Office", load: () => import("./assets/maps/map_office.js") },
      { id: "map_assault", name: "Assault", load: () => import("./assets/maps/map_assault.js") },
      { id: "map_militia", name: "Militia", load: () => import("./assets/maps/map_militia.js") },
      { id: "map_inferno", name: "Inferno", load: () => import("./assets/maps/map_inferno.js") },
      { id: "map_italy", name: "Italy", load: () => import("./assets/maps/map_italy.js") },
      { id: "map_train", name: "Train", load: () => import("./assets/maps/map_train.js") }
    ]
  },
  assets: GAME_ASSETS
};
