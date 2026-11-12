// Inline public-room list. Photon snapshots are normalized by network.js.
export function createRoomBrowser({ config, onJoin, onReconnect }) {
  const $ = key => document.getElementById("mp" + key);
  const ui = Object.fromEntries(["Menu", "Browser", "BrowserRows", "BrowserMessage", "RoomsToggle", "Reconnect", "Quick"].map(key => [key, $(key)]));
  let rooms = [], received = false, phase = "offline", busy = true, expanded = false;
  ui.Reconnect.onclick = () => { if (!busy) onReconnect(); };
  ui.RoomsToggle.onclick = () => { expanded = !expanded; render(); };
  ui.Menu.addEventListener("mplayoutchange", render);
  function render() {
    const active = document.activeElement, focused = active?.dataset.roomCode;
    const hadFocus = ui.Browser.contains(active);
    const portrait = ui.Menu.classList.contains("mp-portrait");
    const rows = (portrait && !expanded ? rooms.slice(0, 3) : rooms).map(room => {
      const row = document.createElement("tr"); row.dataset.code = room.code;
      const mapName = config.maps.items.find(item => item.id === room.map).name;
      const map = document.createElement("td"), code = document.createElement("small");
      map.textContent = mapName; code.textContent = room.code; map.appendChild(code);
      const players = document.createElement("td"); players.textContent = `${room.players}/${room.maxPlayers}`;
      const action = document.createElement("td"), join = document.createElement("button");
      join.type = "button"; join.textContent = !room.open ? "Closed" : !room.joinable ? "Full" : "Join";
      join.disabled = busy || phase !== "lobby" || !room.joinable; join.dataset.roomCode = room.code;
      join.setAttribute("aria-label", `${join.textContent} ${mapName}, room ${room.code}`);
      join.onclick = () => { if (!join.disabled) onJoin(room); }; action.appendChild(join);
      row.append(map, players, action); return row;
    });
    ui.BrowserRows.replaceChildren(...rows);
    ui.RoomsToggle.hidden = !portrait || rooms.length <= 3;
    ui.RoomsToggle.setAttribute("aria-expanded", String(expanded));
    ui.RoomsToggle.textContent = expanded ? "Show fewer rooms" : `Show more rooms (${Math.max(0, rooms.length - 3)})`;
    ui.Reconnect.hidden = phase !== "offline"; ui.Reconnect.disabled = busy;
    if (hadFocus && !ui.Browser.closest("[hidden]")) {
      const target = focused
        ? [...ui.BrowserRows.querySelectorAll("button")].find(button => button.dataset.roomCode === focused && !button.disabled)
        : active.isConnected && !active.disabled && !active.closest("[hidden]") ? active : null;
      if (target) target.focus({ preventScroll: true });
      else (!ui.Reconnect.hidden && !busy ? ui.Reconnect : !ui.Quick.disabled ? ui.Quick : ui.Browser).focus();
    }
    const waiting = phase === "connecting" || (phase === "lobby" && !received);
    ui.Browser.setAttribute("aria-busy", String(waiting));
    ui.BrowserMessage.hidden = rows.length > 0;
    ui.BrowserMessage.textContent = phase === "offline" ? "Disconnected. Reconnect or choose another region."
      : phase === "joining" || phase === "room" ? "Joining room…"
      : waiting ? "Loading public rooms…"
      : "No public rooms yet. Press Play to start a match.";
  }
  return {
    setState(state) {
      phase = state.phase;
      if (phase !== "lobby") { rooms = []; received = false; expanded = false; }
      render();
    },
    setRooms(value) { rooms = value; received = true; render(); },
    setBusy(value) { busy = value; render(); }
  };
}
