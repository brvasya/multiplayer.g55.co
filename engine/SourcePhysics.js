import { BinaryReader } from "./BinaryReader.js";

// PC Source PHY: VPHY compact surfaces / IVPS ledge trees. Coordinates in the
// binary hulls are IVP metres; the MDL skeleton uses Source inches and axes.
const INCH = 0.0254;
const sourceVector = (r, p) => [r.f32(p) / INCH, -r.f32(p + 8) / INCH, r.f32(p + 4) / INCH];

// Preserve repeated keys (notably collisionpair) and tolerate quoted/unquoted
// KeyValues, comments and nested blocks without evaluating any file content.
function keyValues(text) {
  const tokens = text.replace(/\0.*$/s, "").match(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|[{}]|[^\s{}"]+/g) || [];
  let at = 0;
  const next = () => {
    while (tokens[at]?.startsWith("//")) at++;
    const token = tokens[at++];
    return token?.startsWith('"') ? token.slice(1, -1).replace(/\\(["\\])/g, "$1") : token;
  };
  function block(nested = false, depth = 0) {
    if (depth > 16) throw new Error("PHY KeyValues nesting is too deep.");
    const entries = [];
    while (at < tokens.length) {
      const key = next();
      if (key === undefined) break;
      if (key === "}") {
        if (!nested) throw new Error("Unexpected PHY KeyValues closing brace.");
        return entries;
      }
      const value = next();
      if (key === "{" || value === undefined || value === "}") throw new Error("Malformed PHY KeyValues.");
      entries.push([key.toLowerCase(), value === "{" ? block(true, depth + 1) : value]);
    }
    if (nested) throw new Error("Unclosed PHY KeyValues block.");
    return entries;
  }
  return block();
}

export function parseSourcePhysics(buffer, expectedChecksum) {
  const r = new BinaryReader(buffer, "Source PHY");
  r.check(0, 16);
  const headerSize = r.i32(0), count = r.i32(8), checksum = r.i32(12);
  if (headerSize < 16 || count < 1 || count > 128) throw new Error("Invalid Source PHY header.");
  if (expectedChecksum !== undefined && checksum !== expectedChecksum) {
    throw new Error("MDL/PHY checksums differ. Use the PHY from the same model export.");
  }
  let offset = headerSize;
  const surfaces = [];
  for (let index = 0; index < count; index++) {
    const size = r.i32(offset), end = offset + 4 + size;
    if (size < 80) throw new Error("Truncated PHY compact surface.");
    r.check(offset + 4, size);
    const checked = (p, n) => {
      if (p < offset + 4 || p + n > end) throw new Error("PHY surface offset is out of bounds.");
      return r.check(p, n);
    };
    if (r.string(offset + 4, 4) !== "VPHY" || r.u16(offset + 8) !== 0x100 || r.u16(offset + 10) !== 0) {
      throw new Error("Unsupported PHY surface: expected a PC VPHY compact hull.");
    }
    const surface = offset + 32;
    if (r.string(surface + 44, 4) !== "IVPS") throw new Error("Missing PHY IVPS header.");
    const hulls = [], pending = [surface + r.i32(surface + 32)], visited = new Set();
    while (pending.length) {
      const node = checked(pending.pop(), 28);
      if (visited.has(node) || visited.size > 16384) throw new Error("Invalid cyclic PHY ledge tree.");
      visited.add(node);
      const right = r.i32(node);
      if (right) {
        pending.push(node + right, node + 28);
        continue;
      }
      const ledge = checked(node + r.i32(node + 4), 16);
      const triangleCount = r.u16(ledge + 12);
      if (triangleCount < 4) throw new Error("PHY convex hull has too few triangles.");
      checked(ledge + 16, triangleCount * 16);
      const points = ledge + r.i32(ledge), used = new Set();
      for (let t = 0; t < triangleCount; t++) {
        for (const e of [4, 8, 12]) used.add(r.u16(ledge + 16 + t * 16 + e));
      }
      const vertices = [];
      for (const vertex of used) vertices.push(...sourceVector(r, checked(points + vertex * 16, 16)));
      if (used.size < 4) throw new Error("PHY hull has fewer than four vertices.");
      hulls.push(vertices);
    }
    surfaces.push({
      index, hulls, center: sourceVector(r, surface),
      // Moments per unit mass, with the same Y/Z permutation as the vertices.
      inertia: [r.f32(surface + 12), r.f32(surface + 20), r.f32(surface + 16)].map(n => n / (INCH * INCH))
    });
    offset = end;
  }
  const blocks = keyValues(r.string(offset, r.length - offset));
  const solids = new Array(count), constraints = [], collisionPairs = [];
  let selfCollisions = true, hasCollisionRules = false;
  for (const [kind, entries] of blocks) {
    if (!Array.isArray(entries)) continue;
    const fields = Object.fromEntries(entries);
    const number = (key, fallback) => {
      const value = fields[key] === undefined ? fallback : Number(fields[key]);
      if (!Number.isFinite(value)) throw new Error(`Invalid PHY ${kind}.${key}.`);
      return value;
    };
    const validIndex = key => {
      const value = number(key, -1);
      if (!Number.isInteger(value) || value < 0 || value >= count) throw new Error(`Invalid PHY ${key} index.`);
      return value;
    };
    if (kind === "solid") {
      const index = validIndex("index");
      if (solids[index] || typeof fields.name !== "string") throw new Error("Invalid PHY solid name/index.");
      solids[index] = { ...surfaces[index], name: fields.name, mass: number("mass", 1),
        damping: number("damping", 0), angularDamping: number("rotdamping", 0),
        inertiaScale: number("inertia", 1), surface: fields.surfaceprop || "flesh" };
      if (solids[index].mass <= 0) throw new Error("PHY body mass must be positive.");
    } else if (kind === "ragdollconstraint") {
      const parent = validIndex("parent"), child = validIndex("child");
      if (parent === child || constraints.some(c => c.child === child)) throw new Error("Invalid PHY joint hierarchy.");
      const lower = [], upper = [], friction = [];
      for (const axis of ["x", "y", "z"]) {
        const min = number(axis + "min", 0), max = number(axis + "max", 0);
        if (min > max || min < -180 || max > 180) throw new Error("Invalid PHY angular limits.");
        lower.push(min * Math.PI / 180); upper.push(max * Math.PI / 180);
        friction.push(Math.max(0, number(axis + "friction", 0)));
      }
      constraints.push({ parent, child, lower, upper, friction });
    } else if (kind === "collisionrules") {
      hasCollisionRules = true;
      selfCollisions = fields.selfcollisions !== "0";
      for (const [key, value] of entries) if (key === "collisionpair") {
        const pair = String(value).split(",").map(Number);
        if (pair.length !== 2 || pair.some(n => !Number.isInteger(n) || n < 0 || n >= count)) {
          throw new Error("Invalid PHY collision pair.");
        }
        collisionPairs.push(pair);
      }
    }
  }
  if (solids.filter(Boolean).length !== count || (count > 1 && constraints.length !== count - 1)) {
    throw new Error("PHY does not contain a complete articulated ragdoll.");
  }
  for (let i = 0; i < count; i++) {
    const path = new Set(); let node = i;
    while (node !== undefined) {
      if (path.has(node)) throw new Error("Cyclic PHY ragdoll joints.");
      path.add(node); node = constraints.find(c => c.child === node)?.parent;
    }
  }
  return { checksum, solids, constraints, selfCollisions, hasCollisionRules, collisionPairs };
}
