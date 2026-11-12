import { isTouchDevice } from "./touchControls.js";

export function createHud() {
  const hud = document.getElementById("hud"), crosshair = document.getElementById("crosshair");
  const refs = Object.fromEntries(["health", "ammo", "reserve", "weaponSlot", "weaponName", "mpTimer"]
    .map(id => [id, document.getElementById(id)]));
  const sniperScope = document.createElement("div");
  sniperScope.id = "sniperScope";
  const reloadStatus = document.createElement("div");
  reloadStatus.id = "reloadStatus"; reloadStatus.setAttribute("role", "status");
  document.body.append(sniperScope, reloadStatus);
  hud.classList.add("cs-hud");
  const touch = isTouchDevice();
  let fireTimer;

  function setCrosshairFire() {
    clearTimeout(fireTimer);
    crosshair.classList.remove("fire");
    void crosshair.offsetWidth;
    crosshair.classList.add("fire");
    fireTimer = setTimeout(() => crosshair.classList.remove("fire"), 120);
  }

  function setScope(active) {
    sniperScope.classList.toggle("active", active);
    hud.classList.toggle("scoped", active);
    document.body.classList.toggle("scoped", active);
  }

  function update(state) {
    refs.health.textContent = state.health;
    refs.ammo.textContent = state.ammo;
    refs.reserve.textContent = state.reserveAmmo;
    refs.mpTimer.textContent = state.timer;
    refs.weaponSlot.textContent = state.weaponSlot;
    refs.weaponName.textContent = state.weaponName;
    reloadStatus.textContent = state.isReloading ? "Reloading…"
      : state.ammo > 0 ? ""
      : state.reserveAmmo <= 0 ? "Out of ammo"
      : touch ? "Tap Reload" : "Press R to reload";
    reloadStatus.classList.toggle("visible", Boolean(reloadStatus.textContent));
    refs.health.closest(".cs-bottom-left").classList.toggle("danger", state.health <= 30);
    refs.ammo.closest(".cs-bottom-right").classList.toggle("danger", state.ammo <= 5);
  }

  return { update, setCrosshairFire, setScope,
    setCrosshairVisible(visible) { crosshair.style.visibility = visible ? "" : "hidden"; } };
}
