const ICONS = {
  fire: '<circle cx="12" cy="12" r="6"/><path d="M12 2v5m0 10v5M2 12h5m10 0h5"/>',
  reload: '<path d="M20 10a8 8 0 1 0-2 8M20 3v7h-7"/>',
  scope: '<circle cx="12" cy="12" r="8"/><path d="M12 4v5m0 6v5M4 12h5m6 0h5"/>',
  jump: '<path d="m5 10 7-7 7 7M12 3v16M5 21h14"/>',
  crouch: '<circle cx="14" cy="5" r="2"/><path d="m12 8-4 5 6 2-3 5m1-12 5 5h4M4 21h15"/>',
  pause: '<path d="M8 5v14M16 5v14"/>'
};

const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;
const button = (id, name, label) => `<button id="${id}" class="touch-button touch-button-${name}" type="button" aria-label="${label}">${icon(name)}<span class="touch-button-label">${label}</span></button>`;

export function isTouchDevice() {
  return Boolean(window.matchMedia?.("(pointer: coarse)")?.matches || navigator.maxTouchPoints > 0);
}

export function createTouchControls(api) {
  const enabled = isTouchDevice();
  document.body.classList.toggle("touch-device", enabled);
  if (!enabled) return { enabled, update() {}, reset() {}, isPickerOpen: false, isPortrait: () => false };

  const root = document.createElement("div");
  root.id = "touchControls";
  root.innerHTML = `
    <div id="touchLookArea" class="touch-look-area" aria-label="Swipe to aim"><span class="touch-look-hint touch-hint">Swipe to aim</span></div>
    <div id="touchMovePad" class="touch-stick" aria-label="Movement joystick">
      <div class="touch-stick-ring"></div><div id="touchMoveKnob" class="touch-stick-knob"></div>
      <span class="touch-stick-label touch-hint">Move</span>
    </div>
    <div class="touch-button-row">${button("touchPauseButton", "pause", "Menu")}</div>
    <div class="touch-actions">
      ${button("touchJumpButton", "jump", "Jump")}
      ${button("touchCrouchButton", "crouch", "Crouch")}
      ${button("touchReloadButton", "reload", "Reload")}
      ${button("touchScopeButton", "scope", "Scope")}
      ${button("touchFireButton", "fire", "Fire")}
      <span class="touch-fire-hint touch-hint">Hold + drag to aim</span>
    </div>
    <div id="touchWeaponPicker" class="touch-weapon-picker" hidden>
      <button class="touch-picker-backdrop" type="button" aria-label="Close weapon selector"></button>
      <section class="touch-picker-panel" role="dialog" aria-modal="true" aria-labelledby="touchPickerTitle">
        <div class="touch-picker-heading"><span id="touchPickerTitle">Switch weapon</span><button class="touch-picker-close" type="button" aria-label="Close weapon selector">×</button></div>
        <div class="touch-weapon-list"></div>
      </section>
    </div>
    <div class="rotate-device"><span class="rotate-device-icon">↻</span><strong>Rotate device</strong><span>Turn your phone sideways to play</span></div>`;
  document.body.appendChild(root);

  const find = selector => root.querySelector(selector);
  const movePad = find("#touchMovePad");
  const moveKnob = find("#touchMoveKnob");
  const fireButton = find("#touchFireButton");
  const scopeButton = find("#touchScopeButton");
  const crouchButton = find("#touchCrouchButton");
  const reloadButton = find("#touchReloadButton");
  const reloadLabel = reloadButton.querySelector(".touch-button-label");
  const picker = find("#touchWeaponPicker");
  const weaponPanel = document.querySelector(".cs-bottom-right");
  const weaponTrigger = document.createElement("button");
  weaponTrigger.type = "button";
  weaponTrigger.className = "touch-weapon-trigger";
  weaponTrigger.id = "touchWeaponButton";
  weaponTrigger.setAttribute("aria-label", "Switch weapon");
  weaponTrigger.setAttribute("aria-haspopup", "dialog");
  weaponTrigger.setAttribute("aria-controls", "touchWeaponPicker");
  weaponTrigger.setAttribute("aria-expanded", "false");
  weaponPanel.appendChild(weaponTrigger);
  root.insertBefore(weaponPanel, picker);

  const presses = new Map();
  let visible = false;
  let pickerOpen = false;
  let fireHeld = false;
  let hintsTime = 0;
  let hintsLearned = false;
  let usedMove = false;
  let usedLook = false;
  let lastWeaponLabel = "";

  const isPortrait = () => window.innerHeight > window.innerWidth;
  const available = () => visible && !isPortrait() && !document.hidden && api.isActive();
  const playable = () => available() && !pickerOpen;

  // Pointer-event cancellation does not cancel native pinch zoom. Keep Safari's
  // gesture stream and multi-touch defaults out of gameplay, including canvas gaps.
  const zoomGuardActive = () => visible && !document.hidden && api.isActive();
  let blockingTouchZoom = false;
  const preventZoom = event => { if (event.cancelable) event.preventDefault(); };
  const guardTouchZoom = event => {
    blockingTouchZoom ||= event.touches.length > 1 && zoomGuardActive();
    if (blockingTouchZoom) preventZoom(event);
    // Use physical touches, not presses: opening the picker resets the controls
    // while the movement finger can still be on the screen.
    if (event.touches.length === 0) blockingTouchZoom = false;
  };
  for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"]) {
    document.addEventListener(type, guardTouchZoom, { capture: true, passive: false });
  }
  for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
    document.addEventListener(type, event => {
      if (blockingTouchZoom || zoomGuardActive()) preventZoom(event);
    }, { capture: true, passive: false });
  }

  // A pointer-release action can change the UI before its compatibility click.
  // Swallow that click even if it lands on a newly opened menu or chat button.
  let suppressPointerClick = false;
  document.addEventListener("pointerdown", () => { suppressPointerClick = false; }, true);
  document.addEventListener("click", event => {
    if (!suppressPointerClick || event.detail === 0) return;
    suppressPointerClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  // Each surface owns one pointer until release/cancellation, even outside its bounds.
  function bindPress(element, { start, move, end, tap, allowed = playable, tapOnPointerUp = false }) {
    let pendingTap = false;
    element.addEventListener("pointerdown", event => {
      if (event.button !== 0 || presses.has(element) || !allowed()) return;
      event.preventDefault();
      event.stopPropagation();
      pendingTap = false;
      const press = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false, end };
      presses.set(element, press);
      element.classList.add("active");
      element.setPointerCapture(event.pointerId);
      start?.(event, press);
    }, { passive: false });
    element.addEventListener("pointermove", event => {
      const press = presses.get(element);
      if (!press || press.id !== event.pointerId) return;
      event.preventDefault();
      press.moved ||= Math.hypot(event.clientX - press.startX, event.clientY - press.startY) > 12;
      if (allowed()) move?.(event, press);
      press.x = event.clientX;
      press.y = event.clientY;
    }, { passive: false });
    const finish = event => {
      const press = presses.get(element);
      if (!press || press.id !== event.pointerId) return;
      const rect = element.getBoundingClientRect();
      const tapped = event.type === "pointerup" && !press.moved && allowed() &&
        event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
      pendingTap = tapped && !tapOnPointerUp;
      release(element, press, tapped);
      // A second finger may release without producing a click while moving.
      if (tapped && tapOnPointerUp) {
        suppressPointerClick = true;
        tap?.();
      }
    };
    for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) element.addEventListener(event, finish);
    // Preserve keyboard/assistive activation without repeating a pointer tap.
    element.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      const activate = event.detail === 0 || pendingTap;
      pendingTap = false;
      if (activate && allowed()) tap?.();
    });
  }

  function release(element, press, tapped = false) {
    presses.delete(element);
    element.classList.remove("active");
    if (element.hasPointerCapture(press.id)) element.releasePointerCapture(press.id);
    press.end?.(tapped);
  }

  function reset() {
    for (const [element, press] of [...presses]) release(element, press);
    fireHeld = false;
    api.setFire(false);
    api.setMove(0, 0);
    moveKnob.style.transform = "translate(0px, 0px)";
  }

  const bindTap = (element, action, allowed = playable) => bindPress(element, {
    allowed,
    tap: action,
    tapOnPointerUp: true
  });

  function moveStick(event, press) {
    const dx = event.clientX - press.centerX;
    const dy = event.clientY - press.centerY;
    const length = Math.hypot(dx, dy);
    const distance = Math.min(1, length / press.radius);
    const visualScale = length ? Math.min(length, press.radius) / length : 0;
    moveKnob.style.transform = `translate(${dx * visualScale}px, ${dy * visualScale}px)`;
    const strength = Math.max(0, (distance - 0.12) / 0.88);
    api.setMove(length ? dx / length * strength : 0, length ? dy / length * strength : 0);
    usedMove ||= strength > 0.1;
  }

  bindPress(movePad, {
    start: (event, press) => {
      const rect = movePad.getBoundingClientRect();
      press.centerX = rect.left + rect.width / 2;
      press.centerY = rect.top + rect.height / 2;
      press.radius = Math.max(1, (rect.width - moveKnob.offsetWidth) / 2 - 2);
      moveStick(event, press);
    },
    move: moveStick,
    end: () => { api.setMove(0, 0); moveKnob.style.transform = "translate(0px, 0px)"; }
  });

  const dragAim = (event, press) => {
    api.look(event.clientX - press.x, event.clientY - press.y);
    usedLook = true;
  };
  bindPress(find("#touchLookArea"), {
    move: (event, press) => { if (!fireHeld) dragAim(event, press); }
  });
  bindPress(fireButton, {
    start: () => { fireHeld = true; api.setFire(true); },
    move: dragAim,
    end: () => { fireHeld = false; api.setFire(false); }
  });
  bindTap(scopeButton, () => api.toggleScope());
  bindTap(crouchButton, () => api.toggleCrouch?.());
  bindPress(reloadButton, {
    tap: () => api.reload(), tapOnPointerUp: true,
    allowed: () => playable() && !reloadButton.disabled
  });
  bindPress(find("#touchJumpButton"), { start: () => api.jump() });
  bindTap(find("#touchPauseButton"), () => { reset(); api.pause(); });
  bindTap(weaponTrigger, () => setPickerOpen(!pickerOpen), () => available() && !api.getStatus().isReloading);
  bindTap(find(".touch-picker-backdrop"), () => setPickerOpen(false), () => available() && pickerOpen);
  bindTap(find(".touch-picker-close"), () => setPickerOpen(false), () => available() && pickerOpen);

  function setPickerOpen(open) {
    if (open === pickerOpen) return;
    reset();
    pickerOpen = open;
    picker.hidden = !open;
    weaponTrigger.setAttribute("aria-expanded", String(open));
    if (!open) return;
    const list = find(".touch-weapon-list");
    list.replaceChildren();
    for (const weapon of api.getWeapons()) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "touch-weapon-option";
      item.dataset.slot = weapon.id;
      item.setAttribute("aria-pressed", String(weapon.active));
      const name = document.createElement("span");
      name.textContent = weapon.name;
      const ammo = document.createElement("small");
      ammo.textContent = `${weapon.ammo} / ${weapon.reserveAmmo}`;
      item.append(name, ammo);
      list.appendChild(item);
      bindTap(item, () => {
        if (weapon.active || api.switchWeapon(weapon.id)) setPickerOpen(false);
      }, () => available() && pickerOpen);
    }
  }

  function update(delta = 0) {
    const nextVisible = api.isActive() && !document.hidden;
    if (nextVisible !== visible) {
      visible = nextVisible;
      root.classList.toggle("visible", visible);
      document.body.classList.toggle("touch-controls-visible", visible);
      if (!visible) { setPickerOpen(false); reset(); }
    }
    const portrait = isPortrait();
    root.classList.toggle("portrait", portrait);
    document.body.classList.toggle("touch-portrait", portrait);
    if (!visible) return;
    const status = api.getStatus();
    crouchButton.classList.toggle("selected", Boolean(status.crouched));
    crouchButton.setAttribute("aria-pressed", String(Boolean(status.crouched)));
    scopeButton.hidden = !status.canScope;
    const secondaryLabel = status.secondaryLabel || "Scope";
    scopeButton.querySelector(".touch-button-label").textContent = secondaryLabel;
    scopeButton.setAttribute("aria-label", secondaryLabel);
    scopeButton.classList.toggle("selected", status.scoped);
    scopeButton.setAttribute("aria-pressed", String(status.scoped));
    reloadButton.disabled = status.isReloading || status.ammo >= status.magazineSize || status.reserveAmmo <= 0;
    reloadButton.classList.toggle("reloading", status.isReloading);
    reloadLabel.textContent = status.isReloading ? "Loading" : "Reload";
    reloadButton.style.setProperty("--reload-progress", `${Math.round(status.reloadProgress * 100)}%`);
    reloadButton.setAttribute("aria-label", status.isReloading ? "Reloading" : "Reload");
    weaponTrigger.disabled = status.isReloading;
    const weaponLabel = `${status.weaponName}, ${status.ammo} rounds. Tap to switch weapon`;
    if (weaponLabel !== lastWeaponLabel) {
      weaponTrigger.setAttribute("aria-label", weaponLabel);
      lastWeaponLabel = weaponLabel;
    }
    if (!portrait && !pickerOpen && !hintsLearned) {
      hintsTime += delta;
      if (hintsTime > 5 && usedMove && usedLook) {
        hintsLearned = true;
        root.classList.add("hints-learned");
      }
    }
  }

  let lastViewport = `${window.innerWidth}x${window.innerHeight}`;
  const resize = () => {
    const size = `${window.innerWidth}x${window.innerHeight}`;
    if (lastViewport === size) return;
    lastViewport = size;
    setPickerOpen(false);
    reset();
    api.clearScope();
    update();
  };
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", () => { reset(); api.clearScope(); });
  window.visualViewport?.addEventListener("resize", resize);
  document.addEventListener("keydown", event => {
    if (pickerOpen && event.code === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); setPickerOpen(false); }
  });

  return { enabled, update, reset, isPortrait, get isPickerOpen() { return pickerOpen; } };
}
