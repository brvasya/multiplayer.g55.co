// One lobby screen, plus the gameplay HUD and in-game scoreboard.
export function mountMultiplayerUI(config) {
  if (document.getElementById("mpMenu")) throw new Error("A multiplayer game is already mounted on this page.");
  document.body.classList.add("mp-page", "main-menu-active");
  // Follow the visible viewport when mobile browser chrome or the keyboard moves.
  const menuWindow = document.defaultView;
  let updateLayout;
  const fitViewport = () => {
    const view = menuWindow.visualViewport;
    for (const [key, value] of Object.entries({ width: view?.width ?? menuWindow.innerWidth,
      height: view?.height ?? menuWindow.innerHeight, top: view?.offsetTop ?? 0, left: view?.offsetLeft ?? 0 })) {
      document.documentElement.style.setProperty("--mp-viewport-" + key, value + "px");
    }
    updateLayout?.();
  };
  menuWindow.addEventListener("resize", fitViewport);
  menuWindow.visualViewport?.addEventListener("resize", fitViewport);
  menuWindow.visualViewport?.addEventListener("scroll", fitViewport);
  document.body.insertAdjacentHTML("afterbegin", `<div id="hud">
  <div id="crosshair"></div>
  <div id="mpPersonalHud" class="cs-topbar cs-ffa-topbar">
    <div id="mpTimer" class="cs-match-timer" aria-label="Match time remaining">WAITING</div>
  </div>
  <div class="cs-bottom-left"><div class="cs-label">HEALTH</div><div class="cs-big"><span id="health">100</span></div></div>
  <div class="cs-bottom-right"><div class="cs-label"><span id="weaponSlot"></span> · <span id="weaponName"></span></div><div class="cs-ammo"><span id="ammo">30</span><small>/ <span id="reserve">90</span></small></div></div>
</div>
<div id="damageFlash"></div>
<div id="mpConnection" hidden></div>
<div id="mpNotice" role="status" aria-live="polite" hidden></div>
<div id="mpNotifications"><div id="mpFeed" aria-live="polite"></div></div>
<section id="mpMenu" class="mp-menu" role="dialog" aria-modal="true" aria-labelledby="mpTitle">
  <div class="mp-panel">
    <div id="mpMenuContent" class="mp-menu-content">
    <header class="mp-header">
      <div><h1 id="mpTitle"></h1></div>
      <div class="mp-header-controls">
        <div class="mp-region"><label for="mpRegion">Region</label><select id="mpRegion" aria-describedby="mpRegionStatus" disabled><option value="auto">Automatic</option></select><span id="mpRegionStatus" class="mp-region-status" role="status">Finding a nearby server…</span></div>
        <div class="mp-utilities"><button id="mpSound" type="button" aria-pressed="true" disabled>Sound: On</button><button id="mpFullscreen" type="button" aria-pressed="false">Fullscreen</button></div>
      </div>
    </header>
    <div class="mp-lobby-grid">
      <div class="mp-match-column">
        <div id="mpSetup">
          <label class="mp-name-field" for="mpName">Player Name<input id="mpName" autocomplete="nickname" maxlength="20" placeholder="Soldier" disabled></label>
          <div id="mpPlayActions" class="mp-play-actions"><button id="mpQuick" class="mp-primary mp-play" type="button" disabled>Play</button><a id="mpMoreGames" class="mp-button mp-more-games" target="_blank" rel="noopener noreferrer" aria-label="More games (opens in a new tab)" hidden>More Games</a></div>
          <section id="mpBrowser" class="mp-room-browser" aria-label="Public rooms" aria-busy="true" tabindex="-1">
            <div class="mp-room-list" role="region" aria-label="Available rooms" tabindex="0"><table aria-label="Public rooms"><thead><tr><th scope="col">MAP / ROOM</th><th scope="col">PLAYERS</th><th scope="col"><span class="mp-sr-only">Join room</span></th></tr></thead><tbody id="mpBrowserRows"></tbody></table><p id="mpBrowserMessage" role="status">Loading public rooms…</p></div>
            <button id="mpRoomsToggle" type="button" aria-expanded="false" aria-controls="mpBrowserRows" hidden>Show more rooms</button>
            <button id="mpReconnect" type="button" hidden>Reconnect</button>
          </section>
          <div class="mp-create-row"><label for="mpMap">New room map<select id="mpMap" disabled></select></label><button id="mpCreate" type="button" disabled>Create Room</button></div>
        </div>
        <section id="mpRoom" aria-label="Current room" hidden>
          <div class="mp-room-heading"><span>ROOM <strong id="mpRoomCode"></strong></span><span id="mpRoomInfo"></span></div>
          <button id="mpDeploy" class="mp-primary mp-play" type="button" disabled hidden>Loading arena…</button>
          <div class="mp-actions mp-room-actions"><button id="mpInvite" type="button">Copy Invite</button><button id="mpLeave" type="button">Leave Room</button></div>
          <div class="mp-roster" role="region" aria-label="Players in this room" tabindex="0"><h2 id="mpRoomScoreTitle">PLAYERS</h2><table aria-label="Players in this room"><thead><tr><th scope="col">PLAYER</th><th scope="col">KILLS</th><th scope="col">DEATHS</th></tr></thead><tbody id="mpRoomPlayers"></tbody></table></div>
        </section>
        <p id="mpStatus" role="status" aria-live="polite"></p>
        <button id="mpCancel" type="button" hidden>Cancel Connection</button>
      </div>
      <section id="mpCustomization" class="mp-customization" aria-label="Player customization">
        <button id="mpCustomizeToggle" type="button" aria-expanded="false" aria-controls="mpCustomizationBody" hidden>Customize player</button>
        <div id="mpCustomizationBody" class="mp-customization-body">
          <div id="mpCharacterPreview" class="mp-character-preview" role="img" aria-label="Player appearance preview. Drag to rotate."></div>
          <fieldset id="mpAppearanceControls" class="mp-customization-options" aria-label="Player appearance" disabled>
            <label id="mpPlayerModelField"><span>Player model</span><select id="mpPlayerModel"></select></label>
            <div id="mpBodygroups"></div>
            <div class="mp-customization-actions"><button id="mpCustomizeReset" type="button">Reset</button><button id="mpCustomizeRandom" type="button">Randomize</button></div>
            <p id="mpCustomizeMessage" role="status">Loading player models…</p>
          </fieldset>
        </div>
      </section>
    </div>
    </div>
    <footer id="mpControls" class="mp-controls" aria-label="Game controls" tabindex="0"></footer>
    <div id="mpMobileActions" class="mp-mobile-actions" hidden></div>
  </div>
</section>
<section id="mpScores" hidden aria-label="Scoreboard">
  <div class="mp-score-panel"><header><h2 id="mpScoreTitle">SCOREBOARD</h2></header>
    <div class="mp-score-list" role="region" aria-label="Match standings" tabindex="0"><table><thead><tr><th>PLAYER</th><th>KILLS</th><th>DEATHS</th></tr></thead><tbody id="mpScoreRows"></tbody></table></div>
    <p id="mpScoreHint"></p>
  </div>
</section>
`);
  document.title = config.title;
  const title = document.getElementById("mpTitle"), parts = config.ui.heading || [config.title.toUpperCase()];
  title.textContent = parts[0];
  if (parts.length > 1) { const accent = document.createElement("span"); accent.textContent = parts.slice(1).join(" "); title.append(" ", accent); }
  const moreGames = document.getElementById("mpMoreGames");
  if (config.ui.moreGamesUrl) { moreGames.href = config.ui.moreGamesUrl; moreGames.hidden = false; }
  document.getElementById("mpName").placeholder = config.defaultName;
  for (const map of config.maps.items) document.getElementById("mpMap").add(new Option(map.name, map.id));
  document.getElementById("mpMap").value = config.maps.defaultId;
  const slots = config.rules.weaponSlots;
  const keys = slots.every((id, i) => id === i + 1) ? `1–${slots.length}` : slots.join(", ");
  document.querySelector(".mp-controls").textContent = `WASD move · Mouse aim · Click fire · R reload · ${keys} weapons · Space jump · C toggle crouch · Shift walk · RMB scope / light · Tab scores · Y chat · Esc menu · M sound · F fullscreen`;
  const menu = document.getElementById("mpMenu");
  const actions = document.getElementById("mpMobileActions"), controls = document.getElementById("mpControls");
  const region = menu.querySelector(".mp-region"), play = document.getElementById("mpPlayActions"), deploy = document.getElementById("mpDeploy");
  const toggle = document.getElementById("mpCustomizeToggle"), customization = document.getElementById("mpCustomizationBody");
  // Move the existing controls so handlers, focus and values survive rotation.
  const homes = [region, play, deploy].map(node => {
    const marker = document.createComment("responsive control position"); node.before(marker);
    return { node, marker };
  });
  let portrait, expanded = false;
  function showCustomization() {
    const hidden = portrait && !expanded;
    toggle.setAttribute("aria-expanded", String(!hidden));
    if (customization.hidden !== hidden) {
      customization.hidden = hidden;
      customization.dispatchEvent(new menuWindow.Event("mpvisibilitychange"));
    }
  }
  toggle.onclick = () => { expanded = !expanded; showCustomization(); };
  updateLayout = () => {
    const next = menuWindow.innerWidth < 560 || (menuWindow.innerWidth <= 900 && menuWindow.innerHeight >= menuWindow.innerWidth);
    const active = document.activeElement;
    controls.hidden = next || !!(menuWindow.matchMedia?.("(pointer: coarse)").matches || menuWindow.navigator.maxTouchPoints > 0);
    if (next === portrait) return;
    portrait = next; menu.classList.toggle("mp-portrait", portrait);
    actions.hidden = !portrait; toggle.hidden = !portrait;
    if (portrait) {
      menu.querySelector(".mp-match-column").prepend(region);
      actions.append(play, deploy);
    } else {
      for (const { node, marker } of homes) marker.after(node);
    }
    for (const node of menu.querySelectorAll(".mp-room-list, .mp-roster")) node.tabIndex = portrait ? -1 : 0;
    showCustomization();
    menu.dispatchEvent(new menuWindow.Event("mplayoutchange"));
    if (active && menu.contains(active)) {
      if (!active.closest("[hidden]")) active.focus({ preventScroll: true });
      else if (customization.contains(active)) toggle.focus({ preventScroll: true });
      else if (active === toggle || active === controls) (play.hidden ? deploy : play.querySelector("button")).focus({ preventScroll: true });
    }
  };
  fitViewport();
  const link = document.createElement("link"); link.rel = "stylesheet";
  link.href = new URL("./style.css?v=multiplayer-engine-36", import.meta.url).href; document.head.appendChild(link);
  if (config.ui.font) {
    const preload = document.createElement("link"); preload.rel = "preload"; preload.as = "font"; preload.type = "font/woff2";
    preload.crossOrigin = "anonymous"; preload.href = config.ui.font; document.head.appendChild(preload);
    const style = document.createElement("style");
    style.textContent = `@font-face { font-family: "Game UI"; src: url(${JSON.stringify(config.ui.font)}) format("woff2"); font-style: normal; font-weight: 100 900; font-display: swap; }`;
    document.head.appendChild(style);
  }
}
