// Pure metadata/selection helpers shared by the menu, replicas and host rules.
// Numeric group indexes support duplicate, empty and numeric authored names.
export const MAX_BODYGROUPS = 128;

function label(name, fallback) {
  return String(name || "").replaceAll("\\", "/").split("/").pop()
    .replace(/\.(smd|dmx|mdl)$/i, "").replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z0-9])/g, "$1 $2").trim()
    .replace(/\b[a-z]/g, c => c.toUpperCase()) || fallback;
}

export function createBodygroupSchema(metadata, configured = {}) {
  if (!Array.isArray(metadata?.bodygroups) || metadata.bodygroups.length > MAX_BODYGROUPS) {
    throw new Error("Player model has unsupported bodygroup metadata.");
  }
  const model = `${metadata.format}:${metadata.version}:${metadata.checksum >>> 0}:${metadata.name}`;
  const groups = metadata.bodygroups.map((group, index) => {
    if (group.index !== index || !group.variants.length || group.variants.length > 65536) throw new Error("Invalid player bodygroup variants.");
    const value = configured[group.name] ?? configured[index] ?? 0;
    const selected = Array.isArray(value) ? value[0] : value;
    return { index, name: group.name, label: label(group.name, `Bodygroup ${index + 1}`),
      default: Number.isInteger(selected) && selected >= 0 && selected < group.variants.length ? selected : 0,
      options: group.variants.map((variant, i) => ({ index: i, blank: variant.blank,
        label: variant.blank ? "None" : label(variant.name, `Variant ${i + 1}`) })) };
  });
  return { model, label: label(metadata.name, "Player"), groups };
}

export function validAppearance(value, schema = null) {
  const selected = schema && appearanceSchemaFor(schema, value?.model);
  return !!value && typeof value.model === "string" && value.model.length > 0 && value.model.length <= 256
    && Array.isArray(value.bodygroups) && value.bodygroups.length <= MAX_BODYGROUPS
    && value.bodygroups.every(n => Number.isInteger(n) && n >= 0 && n <= 65535)
    && (!schema || (!!selected && value.bodygroups.length === selected.groups.length
      && value.bodygroups.every((n, i) => n < selected.groups[i].options.length)));
}

// A catalog retains the default schema's model/groups for single-model callers.
// Network values can select only an identity in this locally loaded catalog.
export function appearanceSchemaFor(schema, model) {
  return schema.models ? schema.models.find(entry => entry.model === model) || null
    : schema.model === model ? schema : null;
}

export function normalizeAppearance(schema, value) {
  schema = appearanceSchemaFor(schema, value?.model) || appearanceSchemaFor(schema, schema.model);
  const choices = value?.model === schema.model && Array.isArray(value.bodygroups) ? value.bodygroups : [];
  return { model: schema.model, bodygroups: schema.groups.map(group => {
    const choice = choices[group.index];
    return Number.isInteger(choice) && choice >= 0 && choice < group.options.length ? choice : group.default;
  }) };
}

export function sameAppearance(a, b) {
  return a?.model === b?.model && Array.isArray(a?.bodygroups) && Array.isArray(b?.bodygroups)
    && a.bodygroups.length === b.bodygroups.length && a.bodygroups.every((n, i) => n === b.bodygroups[i]);
}
