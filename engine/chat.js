import { CHAT_MAX_LENGTH } from "./rules.js";

const HISTORY_LIMIT = 50, RECENT_LIMIT = 5, VISIBLE_MS = 8000;

// One room's local history. Messages are rendered as text, never HTML.
export function createRoomChat({ send, onOpen, onClose }) {
  const root = document.createElement("section");
  root.id = "mpChat";
  root.setAttribute("aria-label", "Room chat");
  root.hidden = true;
  root.innerHTML = `<div id="mpChatMessages" role="log" aria-label="Chat messages" aria-live="polite" aria-relevant="additions" tabindex="-1"></div>
    <form id="mpChatForm" hidden>
      <label for="mpChatInput">All</label>
      <input id="mpChatInput" type="text" maxlength="${CHAT_MAX_LENGTH}" autocomplete="off" enterkeyhint="send" placeholder="Message everyone…" aria-label="Message to everyone in the room" aria-describedby="mpChatStatus">
      <button type="submit">Send</button><button id="mpChatClose" type="button" aria-label="Close chat"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m5 5 14 14M19 5 5 19"/></svg></button>
      <span id="mpChatStatus" role="status"></span>
    </form>
    <button id="mpChatButton" type="button" aria-label="Open room chat" aria-controls="mpChatForm" aria-expanded="false">Chat</button>`;
  document.getElementById("mpNotifications").appendChild(root);
  const find = id => root.querySelector("#mpChat" + id);
  const log = find("Messages"), form = find("Form"), input = find("Input");
  const closeButton = find("Close"), button = find("Button"), status = find("Status");
  const messages = [];
  let active = false, opened = false, restoring = false, composing = false, timer;

  function refresh() {
    clearTimeout(timer);
    const now = performance.now();
    let next = Infinity;
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      const visible = opened || (i >= messages.length - RECENT_LIMIT && message.expires > now);
      message.node.hidden = !visible;
      const fading = !opened && message.expires - now <= 1000;
      message.node.classList.toggle("is-fading", fading);
      if (!opened && visible) next = Math.min(next, message.expires - (fading ? 0 : 1000));
    }
    root.classList.toggle("is-open", opened);
    document.body.classList.toggle("mp-chat-active", opened);
    form.hidden = !opened;
    button.hidden = opened;
    button.setAttribute("aria-expanded", String(opened));
    log.tabIndex = opened ? 0 : -1;
    if (Number.isFinite(next)) timer = setTimeout(refresh, Math.max(1, next - now));
  }
  function open() {
    if (!active || opened || restoring || document.hidden) return;
    opened = true;
    status.textContent = "";
    onOpen();
    refresh();
    log.scrollTop = log.scrollHeight;
    // Synchronous focus preserves the mobile keyboard's user activation.
    input.focus({ preventScroll: true });
  }
  async function close(resume = true) {
    if (!opened) return;
    opened = false; composing = false;
    input.value = ""; input.blur(); status.textContent = "";
    restoring = true;
    refresh();
    try { await onClose(resume); }
    finally { restoring = false; }
  }
  function submit() {
    if (!opened || composing) return;
    if (!input.value.trim()) { void close(); return; }
    const error = send(input.value);
    if (error) { status.textContent = error; input.focus({ preventScroll: true }); return; }
    void close();
  }
  function keydown(event) {
    if (!opened) {
      if (active && event.code === "KeyY" && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey
          && !/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) && !event.target.isContentEditable) {
        event.preventDefault(); event.stopImmediatePropagation(); open();
      }
      return;
    }
    // Let the browser edit the input, but never pass typed keys to the game.
    event.stopImmediatePropagation();
    if (event.isComposing || composing || event.keyCode === 229) return;
    if (event.code === "Escape" || event.key === "Escape") { event.preventDefault(); void close(); }
    else if (event.code === "Enter" || event.code === "NumpadEnter" || event.key === "Enter") {
      event.preventDefault();
      if (!event.repeat) { if (event.target === closeButton) void close(); else submit(); }
    } else if (event.code === "Tab" || event.key === "Tab") {
      event.preventDefault();
      const nodes = [input, form.querySelector('[type="submit"]'), closeButton, log];
      const index = nodes.indexOf(document.activeElement);
      nodes[(index + (event.shiftKey ? nodes.length - 1 : 1)) % nodes.length].focus({ preventScroll: true });
    }
  }
  function keyup(event) { if (opened) event.stopImmediatePropagation(); }
  document.addEventListener("keydown", keydown, true);
  document.addEventListener("keyup", keyup, true);
  // Pointer actions on chat must not fire the weapon on the same event.
  for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "wheel"]) {
    root.addEventListener(type, event => event.stopPropagation());
  }
  button.onclick = open;
  closeButton.onclick = () => { void close(); };
  form.onsubmit = event => { event.preventDefault(); submit(); };
  input.addEventListener("compositionstart", () => { composing = true; });
  input.addEventListener("compositionend", () => { composing = false; });
  input.addEventListener("input", () => { status.textContent = ""; });

  return {
    get isOpen() { return opened; },
    open,
    setActive(value) {
      active = !!value; root.hidden = !active;
      if (!active) void close(false);
    },
    add({ name, text, actor }) {
      const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
      const node = document.createElement("p"), label = document.createElement("b");
      label.textContent = name + ": ";
      node.append(label, document.createTextNode(text));
      node.dataset.actor = actor;
      log.appendChild(node);
      messages.push({ node, expires: performance.now() + VISIBLE_MS });
      if (messages.length > HISTORY_LIMIT) messages.shift().node.remove();
      refresh();
      if (!opened || atBottom) log.scrollTop = log.scrollHeight;
    },
    clear() {
      this.setActive(false);
      clearTimeout(timer); messages.length = 0; log.replaceChildren();
    },
    dispose() {
      this.clear();
      document.removeEventListener("keydown", keydown, true);
      document.removeEventListener("keyup", keyup, true);
      root.remove();
    }
  };
}
