import { resolveGameConfig, validMode } from "./config.js";
import { PhotonNetwork, roomCode, newRoomCode } from "./network.js";
import { MultiplayerSession } from "./session.js";
import { EVENTS, cleanName, elapsed } from "./rules.js";
import { createMultiplayerGame } from "./game.js";
import { createPlayerCustomization } from "./customization.js";
import { createRoomBrowser } from "./roomBrowser.js";
import { mountMultiplayerUI } from "./ui.js";
import { createRoomChat } from "./chat.js";
import { createPreloader } from "./preloader.js";

export async function startMultiplayerGame(definition, preloader = createPreloader()) {
  const config = resolveGameConfig(definition);
  preloader.setThumbnail(config.ui.preloaderThumbnail);
  const { rules: RULES, photon: PHOTON_CONFIG } = config;
  mountMultiplayerUI(config);
  const $ = id => document.getElementById(id);
  const ui = Object.fromEntries(["Menu", "Setup", "Room", "Name", "Region", "Map", "Quick", "PlayActions", "Create", "Sound", "Fullscreen", "RegionStatus", "Deploy", "Invite", "Leave", "Status", "Cancel", "RoomCode", "RoomInfo", "Connection", "Notice", "Feed", "Scores", "ScoreRows", "ScoreTitle", "ScoreHint", "RoomPlayers", "RoomScoreTitle"].map(key => [key, $("mp" + key)]));
  let game, session, room, customization, booted = false, roomLoaded = false, loadingToken = 0, poseSequence = 0;
  let lastPoseAt = 0, scoreHeld = false, seenFeed = 0, feedTime = 0, lastPhase = "";
  const chat = createRoomChat({
    send: text => session?.sendChat(text) ?? "You are no longer connected to this room.",
    onOpen: () => { game.setChatting(true); scores(false); },
    onClose: async resume => {
      const currentSession = session;
      if (resume && roomLoaded && ui.Menu.hidden) {
        const captured = await game.capture();
        // Leaving, disconnecting or opening the menu during capture must not
        // resume the old room when the browser finishes its async request.
        if (session !== currentSession || !roomLoaded || !ui.Menu.hidden) game.setPaused(true);
        else if (!captured) { menu(true); status("Click Resume to capture the mouse and continue."); }
      }
      game?.setChatting(false);
    }
  });
  ui.Menu.setAttribute("inert", "");
  const read = key => { try { return localStorage.getItem(config.storagePrefix + key) || ""; } catch { return ""; } };
  const save = (key, value) => { try { localStorage.setItem(config.storagePrefix + key, value); } catch {} };
  const params = new URLSearchParams(location.search);
  ui.Name.value = read("name") || config.defaultName;
  for (const [value, text] of Object.entries(PHOTON_CONFIG.regions)) ui.Region.add(new Option(text, value));
  const savedRegion = read("region-choice");
  ui.Region.value = savedRegion === "auto" || Object.hasOwn(PHOTON_CONFIG.regions, savedRegion) ? savedRegion : PHOTON_CONFIG.defaultRegion;
  const invite = params.get("room"), inviteCode = roomCode(invite);
  const inviteRegion = params.get("region") ?? PHOTON_CONFIG.defaultRegion;
  const validInvite = inviteCode.length >= 3 && inviteCode === invite?.trim().toUpperCase()
    && Object.hasOwn(PHOTON_CONFIG.regions, inviteRegion);
  const browser = createRoomBrowser({ config,
    onJoin: selected => connect("join", { ...selected, region: network.region }), onReconnect: () => browse() });
  ui.Region.onchange = () => { save("region-choice", ui.Region.value); browse(); };
  function browse(region = ui.Region.value) {
    network.browse({ name: cleanName(ui.Name.value), region });
  }
  function status(text, error = false) { ui.Status.textContent = text; ui.Status.classList.toggle("mp-error", error); }
  function busy(value) {
    browser.setBusy(value || !booted);
    customization?.setEnabled(!value && booted);
    for (const node of [ui.Quick, ui.Create, ui.Name, ui.Map]) node.disabled = value || !booted;
    ui.Region.disabled = value || !!room;
    ui.Sound.disabled = !booted;
    ui.Cancel.hidden = !value;
  }
  function menu(visible) {
    ui.Menu.hidden = !visible; document.body.classList.toggle("main-menu-active", visible);
    customization?.setVisible(visible);
    if (visible) { game?.setPaused(true); if (booted) (room ? ui.Deploy : ui.Quick).focus(); }
    chat.setActive(!visible && roomLoaded);
    scores(false);
  }
  function scores(show = true) {
    scoreHeld = !!show;
    const roundOver = session?.state.phase === "ended" && ui.Menu.hidden;
    ui.Scores.hidden = !session || (!scoreHeld && !roundOver);
  }
  function disconnected(message = "You left the room.", error = false) {
    loadingToken++; session = null; room = null; roomLoaded = false; lastPhase = "";
    chat.clear();
    game?.leaveRoom(); ui.Setup.hidden = false; ui.Room.hidden = true; ui.Connection.hidden = true;
    ui.PlayActions.hidden = false; ui.Deploy.hidden = true;
    ui.Notice.hidden = true; ui.Scores.hidden = true; ui.Feed.replaceChildren(); scoreHeld = false;
    ui.RoomInfo.textContent = "";
    busy(false); menu(true); status(message, error);
  }
  const network = new PhotonNetwork({
    onLobbyState: state => {
      browser.setState(state);
      const label = PHOTON_CONFIG.regions[state.region];
      ui.RegionStatus.textContent = state.phase === "offline" ? "Not connected. Choose a region to try again."
        : !label ? "Finding a nearby server…" : `${state.phase === "lobby" || state.phase === "room" ? "Connected to" : "Connecting to"} ${label}`;
    },
    onRooms: rooms => browser.setRooms(rooms),
    onStatus: status,
    onError: message => disconnected(message, true),
    onDisconnected: () => disconnected("Connection lost. Join the room again to continue.", true),
    onEvent: (code, data, sender) => session?.receive(code, data, sender),
    onMembers: () => { session?.membersChanged(); updateRoomInfo(); },
    onJoined: async joined => {
      if (!config.maps.items.some(map => map.id === joined.map)) {
        network.disconnect(); disconnected("This room uses an unsupported map.", true); return;
      }
      if (!validMode(joined.mode)) {
        network.disconnect(); disconnected("This room uses an unsupported game mode. Reload the game and create a new room.", true); return;
      }
      const token = ++loadingToken; room = joined; roomLoaded = false; chat.clear();
      ui.Map.value = room.map;
      updateRoomInfo();
      ui.Cancel.hidden = true; ui.Setup.hidden = true; ui.Room.hidden = false;
      ui.PlayActions.hidden = true; ui.Deploy.hidden = false;
      ui.RoomCode.textContent = room.code; ui.Deploy.disabled = true; ui.Deploy.textContent = "Loading arena…";
      ui.Connection.hidden = false; poseSequence = 0; seenFeed = 0;
      status("Room connected. Loading " + config.maps.items.find(map => map.id === room.map).name + "…");
      try {
        // Session initialization can fail before map loading starts. Keep the
        // entire join sequence inside the recovery path, including its callbacks.
        session = new MultiplayerSession(network, {
          appearanceSchema: game.appearanceSchema,
          hitboxes: game.hitboxes,
          weapons: game.weapons, spawn: (...args) => game.spawn(...args), wallDistance: (...args) => game.wallDistance(...args),
          wallHit: (...args) => game.wallHit(...args),
          onState: state => { if (roomLoaded) game.setState(state); updateState(state); },
          onPose: p => { if (roomLoaded) game.poseActor(p); },
          onShot: shot => { if (roomLoaded) game.showShot(shot); },
          onImpact: impact => { if (roomLoaded) game.showImpact(impact); },
          onChat: message => chat.add(message)
        }, config);
        // Receive snapshots while loading; deploy sends READY after the arena loads.
        session.membersChanged(); session.request(EVENTS.HELLO);
        await game.loadMap(room.map);
        if (token !== loadingToken || !network.joined) return;
        roomLoaded = true; game.enterRoom(); game.setState(session.state);
        session.request(EVENTS.APPEARANCE, customization.value);
        ui.Deploy.disabled = false; ui.Deploy.textContent = "Enter Match";
        customization.setEnabled(true);
        status("Ready. Press Enter Match to play."); updateRoomInfo(); ui.Deploy.focus();
      } catch (error) {
        if (token !== loadingToken) return;
        network.disconnect(); disconnected("Could not prepare the room. " + error.message, true);
      }
    }
  }, config);
  function updateRoomInfo() {
    if (!room) return;
    ui.RoomInfo.textContent = `Free-for-all · ${PHOTON_CONFIG.regions[room.region]} · ${config.maps.items.find(map => map.id === room.map).name} · ${network.actors().length}/${PHOTON_CONFIG.maxPlayers}`;
  }
  function updateState(state) {
    if (!session) return;
    const rows = Object.values(state.players).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.id - b.id);
    const signature = network.id + "|" + rows.map(p => `${p.id}:${p.name}:${p.ready}:${p.kills}:${p.deaths}`).join("|");
    if (ui.ScoreRows.dataset.signature !== signature) {
      ui.ScoreRows.dataset.signature = signature;
      const nodes = [];
      for (const p of rows) {
        const tr = document.createElement("tr"); tr.classList.toggle("is-local", p.id === network.id);
        for (const text of [p.name + (p.id === network.id ? " (you)" : "") + (!p.ready ? " · lobby" : ""), p.kills, p.deaths]) {
          const td = document.createElement("td"); td.textContent = text; tr.appendChild(td);
        }
        nodes.push(tr);
      }
      ui.ScoreRows.replaceChildren(...nodes);
      ui.RoomPlayers.replaceChildren(...nodes.map(node => node.cloneNode(true)));
    }
    if (state.phase === "ended") {
      const tied = rows.length > 1 && rows[0].kills === rows[1].kills;
      const winner = rows[0]?.name || "MATCH";
      ui.ScoreTitle.textContent = tied ? "DRAW" : `${winner} WINS`;
    } else ui.ScoreTitle.textContent = "SCOREBOARD";
    ui.RoomScoreTitle.textContent = state.phase === "ended" ? ui.ScoreTitle.textContent : "PLAYERS";
    if (state.phase !== lastPhase) {
      lastPhase = state.phase;
      scores(scoreHeld);
    }
    const newest = state.feed?.at(-1)?.id || 0;
    if (newest > seenFeed) {
      seenFeed = newest; feedTime = performance.now();
      ui.Feed.replaceChildren(...state.feed.slice(-3).map(item => {
        const node = document.createElement("div"); node.textContent = `${item.killer} → ${item.victim}${item.headshot ? " · HEADSHOT" : ""}`; return node;
      }));
    }
  }
  function timerText() {
    if (!session || session.state.phase === "waiting") return "WAITING";
    if (session.state.phase === "ended") return "ROUND OVER";
    const seconds = Math.ceil(session.timeRemaining / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }
  function frame() {
    if (!session || !roomLoaded) return;
    const me = session.me, now = network.now();
    ui.Connection.textContent = `ROOM ${room.code} · ${room.region.toUpperCase()} · ${network.actors().length}/${RULES.maxPlayers} · ${network.ping} ms${session.isHost ? " · HOST" : ""}`;
    let notice = "";
    if (me?.ready && me.hp <= 0 && session.state.phase !== "ended") notice = `Respawning in ${Math.max(1, Math.ceil((RULES.respawnMs - elapsed(now, me.died)) / 1000))}…`;
    else if (session.state.phase === "waiting") notice = "Waiting for another player to enter · Explore the map";
    else if (me?.protected) notice = "Spawn protection · Firing ends protection";
    ui.Notice.textContent = notice; ui.Notice.hidden = !notice;
    if (session.state.phase === "ended") ui.ScoreHint.textContent = `Next round in ${Math.max(0, Math.ceil((RULES.intermissionMs - elapsed(now, session.state.ended)) / 1000))} seconds`;
    else ui.ScoreHint.textContent = `Round ${session.state.round} · First to ${session.scoreLimit} kills wins`;
    if (feedTime && performance.now() - feedTime > 5500) { ui.Feed.replaceChildren(); feedTime = 0; }
  }
  function sendPose() {
    if (!session?.me?.ready || session.me.hp <= 0 || !roomLoaded || document.hidden) return;
    const pose = game.getPose(++poseSequence); session.pose(pose);
    if (pose.p[1] < -25) session.request(EVENTS.FALL, { life: pose.life });
  }
  function connect(action, selected = null) {
    if (!booted) return;
    const code = selected?.code || (action === "create" ? newRoomCode() : "");
    if (selected?.map) ui.Map.value = selected.map;
    save("name", cleanName(ui.Name.value));
    busy(true); ui.Status.classList.remove("mp-error");
    network.connect({ name: cleanName(ui.Name.value), region: selected?.region || ui.Region.value, action, code,
      map: action === "quick" ? config.maps.defaultId : ui.Map.value });
  }
  ui.Quick.onclick = () => connect("quick");
  ui.Create.onclick = () => connect("create");
  ui.Sound.onclick = () => game?.toggleSound();
  ui.Fullscreen.hidden = typeof document.documentElement.requestFullscreen !== "function";
  function fullscreen() {
    const request = document.fullscreenElement ? document.exitFullscreen?.() : document.documentElement.requestFullscreen?.();
    request?.catch?.(() => status("Fullscreen is unavailable here. Try opening the game in a new tab.", true));
  }
  function updateFullscreen() {
    ui.Fullscreen.textContent = document.fullscreenElement ? "Exit Fullscreen" : "Fullscreen";
    ui.Fullscreen.setAttribute("aria-pressed", String(!!document.fullscreenElement));
  }
  ui.Fullscreen.onclick = fullscreen;
  document.addEventListener("fullscreenchange", updateFullscreen);
  updateFullscreen();
  ui.Cancel.onclick = () => { network.disconnect(); disconnected("Connection cancelled."); browse(); };
  ui.Leave.onclick = () => { network.disconnect(); disconnected(); browse(); };
  ui.Deploy.onclick = async () => {
    if (!session || !roomLoaded) return;
    const currentSession = session;
    const captured = await game.capture();
    if (session !== currentSession || !roomLoaded) { game.setPaused(true); return; }
    if (!captured) { status("Click Enter Match to capture the mouse. If embedded, open the game in a new tab.", true); return; }
    ui.Deploy.textContent = "Resume";
    menu(false); session.request(EVENTS.READY);
  };
  ui.Invite.onclick = async () => {
    if (!room) return;
    const url = new URL(location.href); url.search = ""; url.hash = "";
    url.searchParams.set("room", room.code); url.searchParams.set("region", room.region);
    try { await navigator.clipboard.writeText(url.href); status("Invite link copied. Your friend can join in the same region."); }
    catch { status(`Invite: ${url.href}`); }
  };
  ui.Menu.addEventListener("keydown", e => {
    if (e.key !== "Tab" || ui.Menu.hasAttribute("inert")) return;
    const nodes = [...ui.Menu.querySelectorAll('button:not(:disabled), a, input:not(:disabled), select:not(:disabled), [tabindex="0"]')].filter(n => !n.closest("[hidden]") && !n.matches(":disabled"));
    const first = nodes[0], last = nodes.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  });
  window.addEventListener("pagehide", () => { network.disconnect(); disconnected(); customization?.setVisible(false); });

  window.addEventListener("pageshow", event => { if (event.persisted && booted) { menu(true); browse(); } });
  browse(validInvite ? inviteRegion : ui.Region.value);
  try {
    game = await createMultiplayerGame({
      progress: preloader.progress, localId: () => network.id, isEnded: () => session?.state.phase === "ended",
      timerText, frame, fullscreen,
      soundChanged: muted => { ui.Sound.textContent = muted ? "Sound: Off" : "Sound: On"; ui.Sound.setAttribute("aria-pressed", String(!muted)); },
      pause: () => { menu(true); status("Menu open. The match continues."); }, scores, openChat: () => chat.open(),
      fire: data => { sendPose(); session?.request(EVENTS.FIRE, data); }
    }, config);
    customization = createPlayerCustomization({ game, read, save,
      onChange: appearance => session?.request(EVENTS.APPEARANCE, appearance) });
    customization.setVisible(!ui.Menu.hidden);
    booted = true; busy(false);
    if (game.touch) document.querySelector(".mp-controls").textContent = "Left stick move · Swipe right to aim · Hold Fire · Tap weapon to switch · Use landscape for play";
    if (invite !== null && !validInvite) status("This invite link is invalid. Choose a public room or create one.", true);
    else if (validInvite) connect("join", { code: inviteCode, region: inviteRegion });
    else status("Press Play to find a match. Or join a room below or create your own.");
    // Network work is independent of the render loop and pause/menu state.
    setInterval(() => {
      if (!network.joined || !session) return;
      session.tick();
      if (performance.now() - lastPoseAt >= RULES.poseIntervalMs) { lastPoseAt = performance.now(); sendPose(); }
    }, 40);
    setInterval(() => { if (network.joined) network.client.updateRtt(); }, 5000);
    preloader.finish(); ui.Menu.removeAttribute("inert");
  } catch (error) {
    booted = false; preloader.fail(); busy(false);
    network.disconnect();
    console.error(error);
  }
}
