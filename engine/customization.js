import { importEngine } from "./importEngine.js";
const { normalizeAppearance, appearanceSchemaFor } = await importEngine("bodygroups.js");

// Appearance controls live in the lobby. Every choice saves immediately and the
// preview runs only while the menu and document are visible.
export function createPlayerCustomization({ game, read, save, onChange }) {
  const $ = id => document.getElementById("mp" + id);
  const fields = $("Bodygroups"), controls = $("AppearanceControls"), message = $("CustomizeMessage"), panel = $("CustomizationBody");
  const catalog = game.appearanceSchema, schemas = catalog.models || [catalog];
  const modelSelect = $("PlayerModel"), selectedKey = "appearance-model";
  const storageKey = schema => "appearance:" + schema.model;
  function savedAppearance(schema) {
    let value;
    try { value = JSON.parse(read(storageKey(schema))); } catch { /* Use model defaults for old or missing preferences. */ }
    return normalizeAppearance(schema, value);
  }
  let current = savedAppearance(appearanceSchemaFor(catalog, read(selectedKey)) || schemas[0]);
  const appearances = new Map([[current.model, current]]);
  let schema, preview, visible = false, resetView = true;
  const selects = new Map();
  modelSelect.replaceChildren(); $("PlayerModelField").hidden = schemas.length < 2;
  for (const [index, entry] of schemas.entries()) {
    const option = document.createElement("option");
    option.value = entry.model; option.textContent = entry.label || `Player ${index + 1}`; modelSelect.appendChild(option);
  }
  function updatePreview() {
    try { preview?.setAppearance(current); }
    catch { message.textContent = "Preview unavailable. Appearance choices still save."; }
  }
  function sync() {
    for (const [index, select] of selects) select.value = current.bodygroups[index];
    game.setAppearance(current);
    updatePreview();
  }
  function buildFields() {
    schema = appearanceSchemaFor(catalog, current.model); modelSelect.value = current.model;
    fields.replaceChildren(); selects.clear();
    for (const group of schema.groups.filter(group => group.options.length > 1)) {
      const label = document.createElement("label"), title = document.createElement("span"), select = document.createElement("select");
      title.textContent = group.label; select.setAttribute("aria-label", group.label); select.dataset.bodygroup = group.index;
      for (const option of group.options) {
        const node = document.createElement("option"); node.value = option.index; node.textContent = option.label; select.appendChild(node);
      }
      select.onchange = () => {
        if (controls.disabled) return;
        current.bodygroups[group.index] = Number(select.value); commit();
      };
      label.append(title, select); fields.appendChild(label); selects.set(group.index, select);
    }
    const unavailable = selects.size === 0;
    $("CustomizeRandom").disabled = $("CustomizeReset").disabled = unavailable;
    message.textContent = unavailable ? "This model has no interchangeable parts." : "Changes save automatically.";
    sync();
  }
  function commit() {
    current = normalizeAppearance(catalog, current);
    appearances.set(current.model, current);
    save(storageKey(schema), JSON.stringify(current)); save(selectedKey, current.model);
    sync(); onChange(normalizeAppearance(catalog, current));
  }
  modelSelect.onchange = () => {
    if (controls.disabled) return;
    const selected = appearanceSchemaFor(catalog, modelSelect.value);
    if (!selected) return;
    current = appearances.get(selected.model) || savedAppearance(selected); buildFields(); commit();
  };
  $("CustomizeReset").onclick = () => { if (!controls.disabled) { current = normalizeAppearance(schema); commit(); } };
  $("CustomizeRandom").onclick = () => {
    if (controls.disabled) return;
    current.bodygroups = schema.groups.map(group => Math.floor(Math.random() * group.options.length)); commit();
  };
  function showPreview() {
    if (!visible || document.hidden || panel.hidden) { preview?.stop(); return; }
    try {
      if (!preview) { preview = game.createCharacterPreview($("CharacterPreview")); preview.setAppearance(current); }
      preview.start({ resetView });
      resetView = false;
    } catch { message.textContent = "Preview unavailable. Appearance choices still save."; }
  }
  document.addEventListener("visibilitychange", showPreview);
  panel.addEventListener("mpvisibilitychange", () => { if (!panel.hidden) resetView = true; showPreview(); });
  buildFields();
  return {
    setEnabled(enabled) { controls.disabled = !enabled; },
    setVisible(value) { if (value && !visible) resetView = true; visible = value; showPreview(); },
    get value() { return normalizeAppearance(catalog, current); }
  };
}
