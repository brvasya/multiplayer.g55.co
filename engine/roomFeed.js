const VISIBLE_LIMIT = 3, VISIBLE_MS = 5500;

// Local HUD history combines room membership events with host-reported kills.
export function createRoomFeed(root) {
  const entries = [];
  let members = new Map(), localId = 0, round = null, seenKill = 0;

  function update(now = performance.now()) {
    while (entries.length && entries[0].expires <= now) entries.shift().node.remove();
  }
  function add(text, type) {
    const now = performance.now();
    update(now);
    const node = root.ownerDocument.createElement("div");
    node.textContent = text;
    node.dataset.type = type;
    entries.push({ node, expires: now + VISIBLE_MS });
    root.appendChild(node);
    while (entries.length > VISIBLE_LIMIT) entries.shift().node.remove();
  }

  return {
    reset(actors = [], self = 0) {
      entries.length = 0; root.replaceChildren();
      // Seed the initial roster silently; it is not a burst of new arrivals.
      members = new Map(actors.map(actor => [actor.id, actor.name]));
      localId = self; round = null; seenKill = 0;
    },
    membersChanged(actors) {
      const next = new Map(actors.map(actor => [actor.id, actor.name]));
      for (const [id, name] of members) {
        if (id !== localId && !next.has(id)) add(`${name} left the room`, "leave");
      }
      for (const [id, name] of next) {
        if (id !== localId && !members.has(id)) add(`${name} joined the room`, "join");
      }
      members = next;
    },
    kills(items, currentRound) {
      if (round !== currentRound) { round = currentRound; seenKill = 0; }
      for (const item of items) {
        if (item.id <= seenKill) continue;
        seenKill = item.id;
        add(`${item.killer} → ${item.victim}${item.headshot ? " · HEADSHOT" : ""}`, "kill");
      }
    },
    update
  };
}
