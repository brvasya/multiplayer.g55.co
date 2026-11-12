import * as THREE from "./vendor/three.module.js";
import { BinaryReader } from "./BinaryReader.js";
import { parseAnimations, describeSequences } from "./SourceAnimations.js";
import { loadSourceMaterials } from "./SourceMaterials.js";

function matrix3x4(reader, offset) {
  const v = reader.floats(offset, 12);
  return new THREE.Matrix4().set(...v.slice(0, 4), ...v.slice(4, 8), ...v.slice(8, 12), 0, 0, 0, 1);
}

export function parseSourceBones(mdl) {
  const count = mdl.i32(156), start = mdl.i32(160);
  mdl.table(start, count, 216);
  if (count < 1 || count > 256) throw new Error("Source MDL requires 1–256 bones.");
  const names = new Set();
  return Array.from({ length: count }, (_, index) => {
    const offset = start + index * 216;
    const sourceName = mdl.relativeString(offset);
    const name = THREE.PropertyBinding.sanitizeNodeName(sourceName);
    if (!name || names.has(name)) throw new Error(`Source MDL has duplicate/invalid bone name: ${sourceName}`);
    names.add(name);
    const parent = mdl.i32(offset + 4);
    if (parent < -1 || parent >= index) throw new Error(`Source MDL has an invalid bone hierarchy at ${sourceName}.`);
    return {
      name, sourceName, parent,
      position: new THREE.Vector3().fromArray(mdl.floats(offset + 32, 3)),
      quaternion: new THREE.Quaternion().fromArray(mdl.floats(offset + 44, 4)).normalize(),
      rotation: mdl.floats(offset + 60, 3),
      positionScale: mdl.floats(offset + 72, 3),
      rotationScale: mdl.floats(offset + 84, 3),
      inverse: matrix3x4(mdl, offset + 96),
      procedure: mdl.i32(offset + 164),
      procedureOffset: mdl.i32(offset + 168) ? offset + mdl.i32(offset + 168) : 0
    };
  });
}

// Source/GMod v48/v49: 12-byte hitbox sets, 68-byte bone-local boxes.
// Keep authored bounds and hitgroups exactly; do not fit boxes to the mesh.
export function parseSourceHitboxSets(mdl, boneCount) {
  const count = mdl.i32(172), start = mdl.i32(176);
  mdl.table(start, count, 12);
  return Array.from({ length: count }, (_, setIndex) => {
    const set = start + setIndex * 12;
    const boxCount = mdl.i32(set + 4), boxes = set + mdl.i32(set + 8);
    mdl.table(boxes, boxCount, 68);
    const hitboxes = Array.from({ length: boxCount }, (_, index) => {
      const offset = boxes + index * 68;
      const bone = mdl.i32(offset), hitgroup = mdl.i32(offset + 4);
      if (bone < 0 || bone >= boneCount) throw new Error("Invalid Source MDL hitbox bone.");
      if (hitgroup < 0) throw new Error("Invalid Source MDL hitgroup.");
      const min = mdl.floats(offset + 8, 3), max = mdl.floats(offset + 20, 3);
      if (min.some((value, axis) => value > max[axis])) {
        throw new Error("Invalid Source MDL hitbox bounds.");
      }
      return { index, bone, hitgroup, name: mdl.relativeString(offset, 32), min, max };
    });
    return { index: setIndex, name: mdl.relativeString(set), hitboxes };
  });
}

function parseVertices(vvd, checksum, boneCount) {
  if (vvd.string(0, 4) !== "IDSV" || vvd.i32(4) !== 4) throw new Error("Expected Source VVD version 4 (IDSV).");
  if (vvd.i32(8) !== checksum) throw new Error("MDL/VVD checksums differ. Use companion files from the same model export.");
  const count = vvd.i32(16), start = vvd.i32(56), fixups = vvd.i32(48), fixupStart = vvd.i32(52);
  vvd.table(start, count, 48);
  vvd.table(fixupStart, fixups, 12);
  const order = [];
  for (let index = 0; index < fixups; index++) {
    const record = fixupStart + index * 12;
    const first = vvd.i32(record + 4), length = vvd.i32(record + 8);
    if (first < 0 || length < 0 || first + length > count || order.length + length > count) throw new Error("Invalid VVD vertex fixup.");
    // Load LOD zero: every nonnegative-LOD run contributes, in fixup order.
    if (vvd.i32(record) >= 0) for (let j = 0; j < length; j++) order.push(first + j);
  }
  if (fixups && order.length !== count) throw new Error("VVD fixups do not cover LOD zero.");
  const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2), skinIndex = new Uint16Array(count * 4), skinWeight = new Float32Array(count * 4);
  for (let index = 0; index < count; index++) {
    const record = start + (fixups ? order[index] : index) * 48;
    positions.set(vvd.floats(record + 16, 3), index * 3);
    normals.set(vvd.floats(record + 28, 3), index * 3);
    uv.set(vvd.floats(record + 40, 2), index * 2);
    const influences = vvd.u8(record + 15);
    if (influences > 3) throw new Error("Invalid VVD bone influence count.");
    let sum = 0;
    for (let j = 0; j < influences; j++) {
      const bone = vvd.u8(record + 12 + j), weight = vvd.f32(record + j * 4);
      if (bone >= boneCount || weight < 0) throw new Error("Invalid VVD skin weight.");
      skinIndex[index * 4 + j] = bone;
      skinWeight[index * 4 + j] = weight;
      sum += weight;
    }
    if (sum > 0) for (let j = 0; j < influences; j++) skinWeight[index * 4 + j] /= sum;
    else skinWeight[index * 4] = 1;
  }
  return { positions, normals, uv, skinIndex, skinWeight, count };
}

// VTX v7 exists with both the original headers and headers containing two
// extra topology fields. The version number alone does not identify the layout.
export function parseSourceVtxLayout(vtx) {
  vtx.check(0, 36);
  if (vtx.i32(0) !== 7) throw new Error("Expected Source VTX version 7.");
  const failures = [];
  for (const layout of [{ groupSize: 25, stripSize: 27 }, { groupSize: 33, stripSize: 35 }]) {
    try {
      const bodyCount = vtx.i32(28), bodies = vtx.i32(32);
      vtx.table(bodies, bodyCount, 8);
      for (let bi = 0; bi < bodyCount; bi++) {
        const body = bodies + bi * 8, modelCount = vtx.i32(body), models = body + vtx.i32(body + 4);
        vtx.table(models, modelCount, 8);
        for (let mi = 0; mi < modelCount; mi++) {
          const model = models + mi * 8, lodCount = vtx.i32(model), lods = model + vtx.i32(model + 4);
          vtx.table(lods, lodCount, 12);
          for (let li = 0; li < lodCount; li++) {
            const lod = lods + li * 12, meshCount = vtx.i32(lod), meshes = lod + vtx.i32(lod + 4);
            vtx.table(meshes, meshCount, 9);
            for (let m = 0; m < meshCount; m++) {
              const mesh = meshes + m * 9, groupCount = vtx.i32(mesh), groups = mesh + vtx.i32(mesh + 4);
              vtx.table(groups, groupCount, layout.groupSize);
              for (let gi = 0; gi < groupCount; gi++) {
                const group = groups + gi * layout.groupSize;
                const vertices = vtx.i32(group), indices = vtx.i32(group + 8), indexStart = group + vtx.i32(group + 12);
                const stripCount = vtx.i32(group + 16), strips = group + vtx.i32(group + 20);
                vtx.table(group + vtx.i32(group + 4), vertices, 9);
                vtx.table(indexStart, indices, 2);
                vtx.table(strips, stripCount, layout.stripSize);
                if (layout.groupSize === 33) vtx.table(group + vtx.i32(group + 29), vtx.i32(group + 25), 2);
                for (let si = 0; si < stripCount; si++) {
                  const strip = strips + si * layout.stripSize;
                  const count = vtx.i32(strip), first = vtx.i32(strip + 4);
                  const verts = vtx.i32(strip + 8), vertexFirst = vtx.i32(strip + 12), flags = vtx.u8(strip + 18);
                  if (first < 0 || count < 0 || first + count > indices
                    || vertexFirst < 0 || verts < 0 || vertexFirst + verts > vertices) throw new Error("Invalid VTX strip range.");
                  // Extended flag 2 describes quads, not the original triangle strips.
                  if (flags !== 1 && (flags !== 2 || layout.stripSize === 35)) throw new Error(`Unsupported VTX strip flags: ${flags}`);
                  if ((flags & 1) && count % 3) throw new Error("VTX triangle list is incomplete.");
                  vtx.table(strip + vtx.i32(strip + 23), vtx.i32(strip + 19), 8);
                }
                for (let i = 0; i < indices; i++) {
                  if (vtx.u16(indexStart + i * 2) >= vertices) throw new Error("VTX strip index exceeds its vertex group.");
                }
              }
            }
          }
        }
      }
      return layout;
    } catch (error) { failures.push(`${layout.groupSize}/${layout.stripSize}: ${error.message}`); }
  }
  throw new Error(`VTX has invalid or unsupported mesh data (${failures.join("; ")}).`);
}

function meshIndices(vtx, mesh, vertexCount, layout) {
  const groupCount = vtx.i32(mesh), groupStart = mesh + vtx.i32(mesh + 4), indices = [];
  vtx.table(groupStart, groupCount, layout.groupSize);
  for (let groupIndex = 0; groupIndex < groupCount; groupIndex++) {
    const group = groupStart + groupIndex * layout.groupSize;
    const numVerts = vtx.i32(group), vertices = group + vtx.i32(group + 4);
    const numIndices = vtx.i32(group + 8), indexStart = group + vtx.i32(group + 12);
    const numStrips = vtx.i32(group + 16), stripStart = group + vtx.i32(group + 20);
    vtx.table(vertices, numVerts, 9);
    vtx.table(indexStart, numIndices, 2);
    vtx.table(stripStart, numStrips, layout.stripSize);
    const resolve = index => {
      const vertex = vtx.u16(indexStart + index * 2);
      if (vertex >= numVerts) throw new Error("VTX strip index exceeds its vertex group.");
      const original = vtx.u16(vertices + vertex * 9 + 4);
      if (original >= vertexCount) throw new Error("VTX vertex exceeds its MDL mesh.");
      return original;
    };
    const triangle = (a, b, c) => {
      if (a !== b && b !== c && a !== c) indices.push(a, c, b); // Source uses clockwise winding.
    };
    for (let index = 0; index < numStrips; index++) {
      const strip = stripStart + index * layout.stripSize;
      const count = vtx.i32(strip), first = vtx.i32(strip + 4), flags = vtx.u8(strip + 18);
      if (first < 0 || count < 0 || first + count > numIndices) throw new Error("Invalid VTX strip range.");
      if (flags & 1) {
        if (count % 3) throw new Error("VTX triangle list is incomplete.");
        for (let j = 0; j < count; j += 3) triangle(resolve(first + j), resolve(first + j + 1), resolve(first + j + 2));
      } else if (flags & 2) {
        for (let j = 2; j < count; j++) {
          const a = resolve(first + j - 2), b = resolve(first + j - 1), c = resolve(first + j);
          if (j % 2) triangle(b, a, c); else triangle(a, b, c);
        }
      } else throw new Error(`Unsupported VTX strip flags: ${flags}`);
    }
  }
  return indices;
}

// PC Source v48/v49: bodyparts are 16 bytes; each model record is 148 bytes.
// Read every authored variant, including blanks, independently of mesh loading.
export function parseSourceBodygroups(mdl) {
  const count = mdl.i32(232), start = mdl.i32(236);
  mdl.table(start, count, 16);
  return Array.from({ length: count }, (_, index) => {
    const part = start + index * 16, modelCount = mdl.i32(part + 4), models = part + mdl.i32(part + 12);
    if (modelCount < 1) throw new Error("Source bodygroup must contain at least one model.");
    mdl.table(models, modelCount, 148);
    return { index, name: mdl.relativeString(part), base: mdl.i32(part + 8),
      variants: Array.from({ length: modelCount }, (_, variant) => {
        const model = models + variant * 148, meshCount = mdl.i32(model + 72);
        if (meshCount < 0) throw new Error("Invalid Source bodygroup mesh count.");
        return { index: variant, name: mdl.string(model, 64), blank: meshCount === 0 };
      }) };
  });
}

function buildMeshes(mdl, vtx, vertices, root, skeleton, materials, options) {
  if (vtx.i32(0) !== 7) throw new Error("Expected Source VTX version 7.");
  if (vtx.i32(16) !== mdl.i32(8)) throw new Error("MDL/VTX checksums differ. Use matching .mdl/.vvd/.dx90.vtx files.");
  const layout = parseSourceVtxLayout(vtx);
  const count = mdl.i32(232), start = mdl.i32(236), vtxStart = vtx.i32(32);
  if (vtx.i32(28) !== count) throw new Error("MDL/VTX bodypart counts differ.");
  mdl.table(start, count, 16);
  vtx.table(vtxStart, count, 8);
  const skinRefs = mdl.i32(220), skinFamilies = mdl.i32(224), skinStart = mdl.i32(228);
  const skin = options.skin ?? 0;
  if (!Number.isInteger(skin) || skin < 0 || skin >= Math.max(1, skinFamilies)) throw new Error(`Invalid Source skin ${skin}.`);
  mdl.table(skinStart, skinRefs * skinFamilies, 2);
  for (let bpIndex = 0; bpIndex < count; bpIndex++) {
    const bp = start + bpIndex * 16, vb = vtxStart + bpIndex * 8;
    const name = mdl.relativeString(bp), modelCount = mdl.i32(bp + 4);
    if (modelCount !== vtx.i32(vb)) throw new Error("MDL/VTX bodygroup counts differ.");
    const selected = options.bodygroups?.[name] ?? options.bodygroups?.[bpIndex] ?? 0;
    if (!Number.isInteger(selected) || selected < 0 || selected >= modelCount) throw new Error(`Invalid bodygroup ${name}: ${selected}.`);
    // Characters can preload a pool of alternatives without duplicating their
    // bones, animations or textures for every possible appearance combination.
    const configuredVariants = options.allBodygroups ? Array.from({ length: modelCount }, (_, i) => i)
      : options.bodygroupVariants?.[name] ?? options.bodygroupVariants?.[bpIndex];
    if (configuredVariants !== undefined && (!Array.isArray(configuredVariants) || !configuredVariants.length)) {
      throw new Error(`Bodygroup ${name} variants must be a nonempty array.`);
    }
    const variants = [...new Set(configuredVariants === undefined ? [selected] : [selected, ...configuredVariants])];
    for (const variant of variants) {
      if (!Number.isInteger(variant) || variant < 0 || variant >= modelCount) throw new Error(`Invalid bodygroup ${name}: ${variant}.`);
    }
    mdl.table(bp + mdl.i32(bp + 12), modelCount, 148);
    vtx.table(vb + vtx.i32(vb + 4), modelCount, 8);
    for (const variant of variants) {
      const model = bp + mdl.i32(bp + 12) + variant * 148;
      const vm = vb + vtx.i32(vb + 4) + variant * 8;
      const meshCount = mdl.i32(model + 72), modelVertexByte = mdl.i32(model + 84);
      if (!meshCount) continue; // A legitimate blank bodygroup.
      if (vtx.i32(vm) < 1 || modelVertexByte % 48) throw new Error("Invalid Source model vertex/LOD data.");
      const lod = vm + vtx.i32(vm + 4);
      if (vtx.i32(lod) !== meshCount) throw new Error("MDL/VTX mesh counts differ.");
      const meshStart = model + mdl.i32(model + 76), vtxMeshStart = lod + vtx.i32(lod + 4);
      mdl.table(meshStart, meshCount, 116);
      vtx.table(vtxMeshStart, meshCount, 9);
      for (let meshIndex = 0; meshIndex < meshCount; meshIndex++) {
        const mesh = meshStart + meshIndex * 116;
        const length = mdl.i32(mesh + 8), first = modelVertexByte / 48 + mdl.i32(mesh + 12);
        if (length < 0 || first < 0 || first + length > vertices.count) throw new Error("MDL mesh exceeds VVD vertices.");
        if (!length) continue;
        const geometry = new THREE.BufferGeometry();
        for (const [attribute, field, size] of [["position", "positions", 3], ["normal", "normals", 3], ["uv", "uv", 2], ["skinIndex", "skinIndex", 4], ["skinWeight", "skinWeight", 4]]) {
          geometry.setAttribute(attribute, new THREE.BufferAttribute(vertices[field].slice(first * size, (first + length) * size), size));
        }
        geometry.setIndex(meshIndices(vtx, vtxMeshStart + meshIndex * 9, length, layout));
        geometry.computeBoundingSphere();
        const ref = mdl.i32(mesh);
        if (ref < 0 || (skinRefs && ref >= skinRefs)) throw new Error("Invalid Source mesh material reference.");
        const materialIndex = skinFamilies ? mdl.u16(skinStart + (skin * skinRefs + ref) * 2) : ref;
        if (!materials[materialIndex]) throw new Error(`Source material ${materialIndex} is missing.`);
        const object = new THREE.SkinnedMesh(geometry, materials[materialIndex]);
        object.name = `${name}_${variant}_${meshIndex}`;
        object.userData.sourceBodygroup = { name, index: bpIndex, variant };
        object.visible = variant === selected;
        object.frustumCulled = false;
        root.add(object);
        object.bind(skeleton, new THREE.Matrix4());
      }
    }
  }
}

export class SourceModelLoader {
  constructor(manager = THREE.DefaultLoadingManager) { this.manager = manager; }

  async loadAsync(url, options = {}) {
    const read = path => new THREE.FileLoader(this.manager).setResponseType("arraybuffer").loadAsync(path);
    const stem = url.replace(/\.mdl(?=([?#]|$))/i, "");
    if (stem === url) throw new Error("Source model URL must end in .mdl.");
    const companion = extension => url.replace(/\.mdl(?=([?#]|$))/i, extension);
    // Hold one manager item open while discovering nested dependencies.
    this.manager.itemStart(url + "#source-model");
    try {
      const [mdl, vvd, vtx] = await Promise.all([read(url), read(options.vvd || companion(".vvd")), read(options.vtx || companion(".dx90.vtx"))]);
      const reader = new BinaryReader(mdl, url);
      this.validateHeader(reader);
      let ani = null;
      if (reader.i32(352) > 1) {
        const name = reader.string(reader.i32(348)).replaceAll("\\", "/").split("/").pop();
        ani = await read(options.ani || url.slice(0, url.lastIndexOf("/") + 1) + name);
      }
      const result = this.parse(mdl, vvd, vtx, { ...options, ani });
      const usedMaterials = new Set();
      result.scene.traverse(object => {
        if (object.isMesh) usedMaterials.add(result.materials.indexOf(object.material));
      });
      // Loose WebP textures follow the loaded MDL, including nested model folders.
      const modelPath = url.split(/[?#]/, 1)[0];
      const modelRoot = modelPath.slice(0, modelPath.lastIndexOf("/") + 1) || "./";
      const materials = await loadSourceMaterials(result.metadata, {
        ...options,
        textureRoot: options.textureRoot || modelRoot
      }, this.manager, usedMaterials);
      result.scene.traverse(object => {
        if (!object.isMesh) return;
        const index = result.materials.indexOf(object.material);
        if (index >= 0) object.material = materials[index];
      });
      result.materials.forEach(material => material.dispose());
      result.materials = materials;
      result.warnings.forEach(message => console.warn(message));
      return result;
    } catch (error) {
      this.manager.itemError(url);
      throw error;
    } finally {
      this.manager.itemEnd(url + "#source-model");
    }
  }

  validateHeader(mdl) {
    mdl.check(0, 408);
    if (mdl.string(0, 4) !== "IDST") throw new Error("Expected a PC Source MDL (IDST).");
    if (![48, 49].includes(mdl.i32(4))) throw new Error(`Unsupported MDL version ${mdl.i32(4)}. This loader supports Source/GMod v48 and v49.`);
    if (mdl.i32(76) !== mdl.length) throw new Error("Source MDL length does not match its header.");
  }

  parse(mdlBuffer, vvdBuffer, vtxBuffer, options = {}) {
    const mdl = new BinaryReader(mdlBuffer, "MDL");
    this.validateHeader(mdl);
    const boneData = parseSourceBones(mdl);
    const bodygroups = parseSourceBodygroups(mdl);
    const hitboxSets = parseSourceHitboxSets(mdl, boneData.length);
    const bones = boneData.map((data, index) => {
      const bone = new THREE.Bone();
      bone.name = data.name;
      bone.userData.sourceName = data.sourceName;
      bone.userData.sourceBoneIndex = index;
      bone.position.copy(data.position);
      bone.quaternion.copy(data.quaternion);
      return bone;
    });
    const scene = new THREE.Group();
    scene.name = "SourceMDL";
    bones.forEach((bone, index) => (boneData[index].parent < 0 ? scene : bones[boneData[index].parent]).add(bone));
    const skeleton = new THREE.Skeleton(bones, boneData.map(bone => bone.inverse));
    const materialStart = mdl.i32(208), materialCount = mdl.i32(204);
    mdl.table(materialStart, materialCount, 64);
    const materialNames = Array.from({ length: materialCount }, (_, i) => mdl.relativeString(materialStart + i * 64));
    const materials = materialNames.map(name => new THREE.MeshStandardMaterial({ name, color: 0x858585, roughness: 0.65 }));
    const vertices = parseVertices(new BinaryReader(vvdBuffer, "VVD"), mdl.i32(8), bones.length);
    buildMeshes(mdl, new BinaryReader(vtxBuffer, "VTX"), vertices, scene, skeleton, materials, options);
    const attachmentStart = mdl.i32(244), attachmentCount = mdl.i32(240);
    mdl.table(attachmentStart, attachmentCount, 92);
    const attachments = [];
    for (let index = 0; index < attachmentCount; index++) {
      const offset = attachmentStart + index * 92, bone = mdl.i32(offset + 8);
      if (bone < 0 || bone >= bones.length) throw new Error("Invalid Source attachment bone.");
      const attachment = new THREE.Object3D();
      attachment.name = THREE.PropertyBinding.sanitizeNodeName(mdl.relativeString(offset));
      matrix3x4(mdl, offset + 12).decompose(attachment.position, attachment.quaternion, attachment.scale);
      bones[bone].add(attachment);
      attachments.push(attachment.name);
    }
    // Source viewmodels: X forward / Y left / Z up -> this rig's Z forward,
    // X left / Y up. Keep Source units; the existing rig owns its PI yaw.
    scene.quaternion.set(-0.5, -0.5, -0.5, 0.5);
    scene.updateMatrixWorld(true);
    const ani = options.ani ? new BinaryReader(options.ani, "ANI") : null;
    const { clips: animations, warnings } = parseAnimations(mdl, boneData, options, ani);
    const directories = Array.from({ length: mdl.table(mdl.i32(216), mdl.i32(212), 4) }, (_, i) => mdl.string(mdl.i32(mdl.i32(216) + i * 4)).replaceAll("\\", "/"));
    const includedModels = Array.from({ length: mdl.table(mdl.i32(340), mdl.i32(336), 8) }, (_, i) => mdl.relativeString(mdl.i32(340) + i * 8, 4));
    const proceduralBones = [];
    for (const bone of boneData) {
      if (bone.procedure !== 2 || !bone.procedureOffset) continue;
      const offset = bone.procedureOffset, control = mdl.i32(offset), count = mdl.i32(offset + 4), start = offset + mdl.i32(offset + 8);
      if (control < 0 || control >= bones.length) throw new Error("Invalid Source procedural control bone.");
      mdl.table(start, count, 48);
      proceduralBones.push({ bone: bone.name, control: boneData[control].name, triggers: Array.from({ length: count }, (_, i) => {
        const trigger = start + i * 48;
        return { tolerance: mdl.f32(trigger), rotation: mdl.floats(trigger + 4, 4), position: mdl.floats(trigger + 20, 3), quaternion: mdl.floats(trigger + 32, 4) };
      }) });
    }
    const procedural = boneData.filter(bone => bone.procedure && bone.procedure !== 2);
    if (procedural.length) warnings.push(`Source procedural bones use their bind transforms: ${procedural.map(bone => bone.sourceName).join(", ")}`);
    const metadata = { format: "source-mdl", checksum: mdl.i32(8), version: mdl.i32(4), name: mdl.string(12, 64), bodygroups, materialNames, directories, attachments, includedModels, proceduralBones, sequences: describeSequences(mdl).map(sequence => sequence.name) };
    scene.userData.source = metadata;
    return { scene, animations, metadata, materials, warnings, boneData, hitboxSets };
  }
}
