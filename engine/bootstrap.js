// Importing this entry does not start a game. The portable launcher selects one
// engine first; failures during startup never trigger a second engine instance.
import { createPreloader } from "./preloader.js";

export async function bootstrapMultiplayer(configUrl) {
  const preloader = createPreloader();
  try {
    const url = new URL(configUrl, document.baseURI);
    const [{ startMultiplayerGame }, module] = await Promise.all([
      import("./main.js"), import(url.href)
    ]);
    await startMultiplayerGame(module.GAME_CONFIG || module.default, preloader);
  } catch (error) { preloader.fail(); throw error; }
}

// Keep explicit <script src="…/bootstrap.js" data-game-config="…"> entries working.
const direct = typeof document !== "undefined" && [...document.querySelectorAll("script[data-game-config][src]")]
  .find(script => script.src === import.meta.url);
if (direct) {
  try { await bootstrapMultiplayer(direct.dataset.gameConfig); }
  catch (error) { console.error(error); }
}
