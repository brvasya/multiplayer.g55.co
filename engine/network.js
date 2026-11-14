import Photon from "./vendor/photon-4.4.0.js";
import { validMode } from "./config.js";
import { selectRegion } from "./regions.js";
import { cleanName } from "./rules.js";

const LBC = Photon.LoadBalancing.LoadBalancingClient;
const CONNECTION_ERRORS = new Set([
  LBC.PeerErrorCode.NameServerError, LBC.PeerErrorCode.NameServerConnectFailed, LBC.PeerErrorCode.NameServerConnectClosed, LBC.PeerErrorCode.NameServerTimeout,
  LBC.PeerErrorCode.MasterError, LBC.PeerErrorCode.MasterConnectFailed, LBC.PeerErrorCode.MasterConnectClosed, LBC.PeerErrorCode.MasterTimeout,
  LBC.PeerErrorCode.GameError, LBC.PeerErrorCode.GameConnectFailed, LBC.PeerErrorCode.GameConnectClosed, LBC.PeerErrorCode.GameTimeout
]);
export const roomCode = input => String(input || "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 24);
export function newRoomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return [...bytes].map(b => alphabet[b % alphabet.length]).join("");
}

// RoomInfo comes from an untrusted lobby. Only expose supported public rooms
// for this game; use plain values so UI code never depends on Photon objects.
export function publicRooms(rooms, config) {
  const { photon, maps } = config;
  return rooms.flatMap(room => {
    if (room.removed || room.isVisible === false || typeof room.name !== "string"
      || !room.name.startsWith(photon.roomPrefix) || room.getCustomProperty("game") !== photon.gameId) return [];
    const code = room.name.slice(photon.roomPrefix.length), map = room.getCustomProperty("map"), mode = room.getCustomProperty("mode");
    if (!code || code !== roomCode(code) || !maps.items.some(item => item.id === map) || !validMode(mode)
      || !Number.isInteger(room.playerCount) || room.playerCount < 0
      || !Number.isInteger(room.maxPlayers) || room.maxPlayers < 1 || room.maxPlayers > 255) return [];
    return [{ code, map, mode, players: room.playerCount, maxPlayers: room.maxPlayers,
      open: room.isOpen !== false, joinable: room.isOpen !== false && room.playerCount < room.maxPlayers }];
  }).sort((a, b) => Number(b.joinable) - Number(a.joinable) || b.players - a.players || a.code.localeCompare(b.code));
}

export class PhotonNetwork {
  constructor(callbacks, config, { chooseRegion = selectRegion } = {}) {
    this.config = config;
    this.chooseRegion = chooseRegion;
    this.autoRegion = ""; this.regionPreference = ""; this.regionAbort = null;
    this.rooms = []; this.roomListReady = false;
    this.callbacks = callbacks;
    this.client = null;
    this.generation = 0;
    this.timer = null;
    this.phase = "offline";
    this.region = "";
    this.pending = null;
  }
  get id() { return this.client?.myActor().actorNr || 0; }
  get hostId() {
    const room = this.client?.myRoom();
    return room?.masterClientId || Math.min(...this.actors().map(a => a.id));
  }
  get joined() { return !!this.client?.isJoinedToRoom(); }
  actors() {
    return Object.values(this.client?.myRoomActors() || {}).filter(a => !a.isInactive)
      .map(a => ({ id: a.actorNr, name: cleanName(a.name) }));
  }
  now() { return (this.client?.getServerTimeMs() || 0) >>> 0; }
  get ping() { return this.client?.getRtt() || 0; }
  send(code, data, options = {}) {
    if (this.joined) this.client.raiseEvent(code, data, options);
  }
  setPhase(phase) {
    this.phase = phase;
    this.callbacks.onLobbyState?.({ phase, region: this.region });
  }
  disconnect() {
    this.generation++; clearTimeout(this.timer); this.pending = null;
    this.regionAbort?.abort(); this.regionAbort = null;
    this.rooms = []; this.roomListReady = false;
    const old = this.client; this.client = null;
    old?.disconnect();
    this.setPhase("offline");
  }
  armTimeout() {
    clearTimeout(this.timer);
    const generation = this.generation;
    this.timer = setTimeout(() => {
      if (generation === this.generation) this.connectionFailed("Connection timed out. Check your connection or try another region.");
    }, 25000);
  }
  connectionFailed(message) {
    const { photon } = this.config, request = this.pending;
    // Only new matches may move regions. Selected rooms and invite links must
    // stay in their original region, and a failed fallback must stop here.
    if (request && ["quick", "create"].includes(request.action) && !request.fallbackUsed
      && this.region !== "us" && this.regionPreference !== "us" && Object.hasOwn(photon.regions, "us")) {
      const name = this.client?.myActor().name || "", from = photon.regions[this.region] || "The selected region";
      const retry = { ...request, triedRooms: new Set(), listedCode: "", fallbackUsed: true };
      this.autoRegion = "";
      this.callbacks.onRegionFallback?.("us");
      this.open({ name, region: "us" }, retry, `${from} is unavailable. Connecting to ${photon.regions.us}…`);
    } else this.fail(message);
  }
  fail(message) {
    this.autoRegion = "";
    this.disconnect(); this.callbacks.onError?.(message);
  }
  browse({ name, region }) {
    if (this.client && (this.region === region || this.regionPreference === region) && !this.pending && ["connecting", "lobby"].includes(this.phase)) {
      this.client.myActor().setName(cleanName(name)); return;
    }
    this.open({ name, region });
  }
  connect({ name, region, action, code, map }) {
    if (!["quick", "create", "join"].includes(action)) { this.callbacks.onError?.("Choose how to join a room."); return; }
    const request = { action, code: roomCode(code), map, triedRooms: new Set() };
    // Keep the menu's authenticated lobby connection, including when the user
    // presses Play before the initial connection has finished.
    if (this.client && (this.region === region || this.regionPreference === region) && !this.pending && ["connecting", "lobby"].includes(this.phase)) {
      this.client.myActor().setName(cleanName(name));
      this.pending = request; this.armTimeout(); this.requestRoom();
    } else this.open({ name, region }, request);
  }
  requestRoom() {
    if (this.phase !== "lobby" || !this.pending) return;
    const { photon } = this.config, { action, code, map } = this.pending;
    const mode = "ffa";
    if (action === "quick" && !this.roomListReady) { this.callbacks.onStatus?.("Finding a match…"); return; }
    this.setPhase("joining");
    this.callbacks.onStatus?.(action === "quick" ? "Finding a match…" : action === "create" ? "Creating your room…" : "Joining your room…");
    const options = { maxPlayers: photon.maxPlayers, isOpen: true, isVisible: true,
      playerTTL: 0, roomTTL: 0, customGameProperties: { game: photon.gameId, map, mode }, propsListedInLobby: ["game", "map", "mode"] };
    let accepted;
    if (action === "quick") {
      const match = this.pending.triedRooms.size < 3 && this.rooms.find(room => room.joinable && !this.pending.triedRooms.has(room.code));
      this.pending.listedCode = match?.code || "";
      // Prefer populated compatible rooms across all maps. Atomic
      // fallback matching keeps simultaneous first players in one default room.
      accepted = match ? this.client.joinRoom(photon.roomPrefix + match.code)
        : this.client.joinRandomOrCreateRoom({ expectedCustomRoomProperties: { game: photon.gameId, map, mode } }, photon.roomPrefix + newRoomCode(), options);
    } else if (action === "create") accepted = this.client.createRoom(photon.roomPrefix + code, options);
    else accepted = this.client.joinRoom(photon.roomPrefix + code);
    if (accepted === false) this.fail("The room request could not be sent. Please retry.");
  }
  open({ name, region }, request = null, connectingStatus = "Connecting…") {
    this.disconnect();
    const { photon } = this.config;
    if (region !== "auto" && !Object.hasOwn(photon.regions, region)) { this.callbacks.onError?.("Choose a supported region."); return; }
    this.regionPreference = region;
    this.region = region === "auto" ? (Object.hasOwn(photon.regions, this.autoRegion) ? this.autoRegion : "") : region;
    this.pending = request;
    const generation = this.generation;
    const client = this.client = new LBC(Photon.ConnectionProtocol.Wss, photon.appId, photon.appVersion);
    client.setLogLevel(Photon.LogLevel.ERROR);
    client.setUserId(crypto.randomUUID());
    client.myActor().setName(cleanName(name));
    const active = () => generation === this.generation;
    let ready = false;
    this.setPhase("connecting"); this.armTimeout();
    client.onError = (error, message) => {
      if (!active()) return;
      const text = `Photon connection failed (${error}). ${message || "Please retry."}`;
      if (CONNECTION_ERRORS.has(error)) this.connectionFailed(text);
      else this.fail(text);
    };
    client.onOperationResponse = (error, message) => {
      if (!active() || !error) return;
      const friendly = { 32758: "Room not found. It may have closed; choose another room.", 32765: "This room is full.",
        32764: "This room is closed.", 32766: "Could not create the room. Please try again.",
        32767: "Photon rejected the App ID. A Realtime application is required.",
        32757: "Photon's concurrent player limit was reached. Try again later." };
      const text = friendly[error] || `Photon error ${error}: ${message || "Please retry."}`;
      if (this.pending && [32758, 32765, 32764, 32766].includes(error)) {
        if (this.pending.action === "quick" && this.pending.listedCode && client.isInLobby()) {
          this.pending.triedRooms.add(this.pending.listedCode);
          this.setPhase("lobby"); this.requestRoom(); return;
        }
        this.pending = null; clearTimeout(this.timer);
        // A full/deleted room must not strand the browser or recreate a room
        // the user selected. Game-server rejections need a fresh lobby connection.
        if (client.isInLobby()) {
          this.setPhase("lobby"); this.callbacks.onRooms?.(this.rooms);
        } else this.browse({ name: client.myActor().name, region });
        this.callbacks.onError?.(text);
      } else this.fail(text);
    };
    client.onStateChange = state => {
      if (!active()) return;
      // The SDK reports State.Error before onError; keep the client active so
      // onError can inspect the cause and decide whether to retry in US East.
      if (state === LBC.State.Disconnected) {
        if (ready) { this.disconnect(); this.callbacks.onDisconnected?.(); }
        else this.fail("Disconnected from Photon. Please retry.");
      } else if (state === LBC.State.ConnectedToNameServer && !this.region) {
        client.getRegions();
      } else if (state === LBC.State.JoinedLobby) {
        ready = true;
        if (!this.pending) clearTimeout(this.timer);
        this.setPhase("lobby"); this.requestRoom();
      }
    };
    client.onGetRegionsResult = async (error, message, available) => {
      if (!active() || this.region) return;
      if (error) { this.fail("Could not choose a region. Choose a region above and try again."); return; }
      const controller = this.regionAbort;
      try {
        const selected = await this.chooseRegion(available, photon, controller.signal);
        if (!active() || !selected) return;
        this.region = this.autoRegion = selected;
        this.setPhase("connecting"); this.armTimeout();
        if (client.connectToRegionMaster(selected) === false) this.fail("Could not connect. Please try again.");
      } catch (error) { if (active()) this.fail(error.message || "Could not choose a region. Choose a region above."); }
    };
    client.onRoomList = client.onRoomListUpdate = rooms => {
      if (!active()) return;
      this.rooms = publicRooms(rooms, this.config); this.roomListReady = true;
      if (this.phase === "lobby") { this.callbacks.onRooms?.(this.rooms); this.requestRoom(); }
    };
    client.onJoinRoom = () => {
      if (!active()) return;
      clearTimeout(this.timer); ready = true; this.pending = null; this.setPhase("room");
      client.syncServerTime(); client.updateRtt();
      const room = client.myRoom();
      const joinFailed = error => {
        if (active()) this.fail("Could not prepare the room. " + (error?.message || "Please retry."));
      };
      try {
        if (room.getCustomProperty("game") !== photon.gameId || !room.name.startsWith(photon.roomPrefix)) throw new Error("This room belongs to a different game.");
        if (!validMode(room.getCustomProperty("mode"))) throw new Error("This room uses an unsupported game mode.");
        Promise.resolve(this.callbacks.onJoined?.({ code: room.name.slice(photon.roomPrefix.length), map: room.getCustomProperty("map"), mode: room.getCustomProperty("mode"), region: this.region }))
          .catch(joinFailed);
      } catch (error) { joinFailed(error); }
    };
    client.onEvent = (code, data, actor) => { if (active()) this.callbacks.onEvent?.(code, data, actor); };
    client.onActorJoin = client.onActorLeave = client.onMyRoomPropertiesChange = () => {
      if (active() && this.joined) this.callbacks.onMembers?.();
    };
    if (request) this.callbacks.onStatus?.(connectingStatus);
    if (!this.region) this.regionAbort = new AbortController();
    const accepted = this.region ? client.connectToRegionMaster(this.region) : client.connectToNameServer();
    if (accepted === false) this.fail("Could not start the connection. Please try again.");
  }
}
