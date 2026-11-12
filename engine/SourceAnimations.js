import * as THREE from "./vendor/three.module.js";

const RAW_POS = 1, RAW_ROT = 2, ANIM_POS = 4, ANIM_ROT = 8, DELTA = 16, RAW_ROT64 = 32;
const euler = new THREE.Euler(0, 0, 0, "ZYX");

function half(value) { return THREE.DataUtils.fromHalfFloat(value); }

function packedQuaternion(reader, offset, wide) {
  let x, y, z, negative;
  if (wide) {
    // Decode 21/21/21/1 bits without losing precision to a JS 64-bit number.
    const low = reader.u32(offset), high = reader.u32(offset + 4);
    x = ((low & 0x1fffff) - 1048576) / 1048576.5;
    y = (((low >>> 21) | ((high & 1023) << 11)) - 1048576) / 1048576.5;
    z = (((high >>> 10) & 0x1fffff) - 1048576) / 1048576.5;
    negative = high >>> 31;
  } else {
    x = (reader.u16(offset) - 32768) / 32768;
    y = (reader.u16(offset + 2) - 32768) / 32768;
    const last = reader.u16(offset + 4);
    z = ((last & 32767) - 16384) / 16384;
    negative = last >>> 15;
  }
  const w = Math.sqrt(Math.max(0, 1 - x * x - y * y - z * z)) * (negative ? -1 : 1);
  return new THREE.Quaternion(x, y, z, w).normalize();
}

function channelValue(reader, ptr, axis, frame) {
  const relative = reader.i16(ptr + axis * 2);
  if (relative <= 0) return 0;
  let cursor = ptr + relative, remaining = frame;
  for (;;) {
    const valid = reader.u8(cursor), total = reader.u8(cursor + 1);
    if (!total || valid > total || !valid) throw new Error(`${reader.label}: invalid animation RLE span.`);
    if (remaining < total) return reader.i16(cursor + 2 * (Math.min(remaining, valid - 1) + 1));
    remaining -= total;
    cursor += (valid + 1) * 2;
  }
}

function readRecords(reader, offset, boneCount) {
  const records = new Map();
  if (offset === null) return records;
  let cursor = offset;
  for (let count = 0; count <= boneCount; count++) {
    const index = reader.u8(cursor);
    if (index === 255) return records;
    if (index >= boneCount || records.has(index)) throw new Error(`${reader.label}: invalid animation bone chain.`);
    records.set(index, cursor);
    const next = reader.i16(cursor + 2);
    if (!next) return records;
    if (next < 4) throw new Error(`${reader.label}: invalid animation record offset.`);
    cursor += next;
  }
  throw new Error(`${reader.label}: unterminated animation bone chain.`);
}

function sampleBone(reader, record, frame, bone, animationDelta = false) {
  if (record === undefined) return {
    position: animationDelta ? new THREE.Vector3() : bone.position.clone(),
    quaternion: animationDelta ? new THREE.Quaternion() : bone.quaternion.clone()
  };
  const flags = reader.u8(record + 1), data = record + 4;
  if (flags & 0xc0) throw new Error(`${reader.label}: unsupported animation encoding ${flags}.`);
  const delta = Boolean(flags & DELTA);
  let position = delta ? new THREE.Vector3() : bone.position.clone();
  let quaternion = delta ? new THREE.Quaternion() : bone.quaternion.clone();
  if (flags & RAW_ROT64) quaternion = packedQuaternion(reader, data, true);
  else if (flags & RAW_ROT) quaternion = packedQuaternion(reader, data, false);
  else if (flags & ANIM_ROT) {
    const angles = bone.rotation.map((base, axis) => channelValue(reader, data, axis, frame) * bone.rotationScale[axis] + (delta ? 0 : base));
    quaternion.setFromEuler(euler.set(...angles, "ZYX"));
  }
  if (flags & RAW_POS) {
    const ptr = data + ((flags & RAW_ROT) ? 6 : 0) + ((flags & RAW_ROT64) ? 8 : 0);
    position.set(half(reader.u16(ptr)), half(reader.u16(ptr + 2)), half(reader.u16(ptr + 4)));
  } else if (flags & ANIM_POS) {
    const ptr = data + ((flags & ANIM_ROT) ? 6 : 0);
    position.fromArray(bone.positionScale.map((scale, axis) => channelValue(reader, ptr, axis, frame) * scale + (delta ? 0 : bone.position.getComponent(axis))));
  }
  return { position, quaternion };
}

export function describeSequences(reader) {
  const count = reader.i32(188), start = reader.i32(192);
  reader.table(start, count, 212);
  return Array.from({ length: count }, (_, index) => {
    const offset = start + index * 212;
    return { name: reader.relativeString(offset, 4), offset, flags: reader.i32(offset + 12) };
  });
}

// PC Source v48/v49 sequence layout and composition follow Valve's studio.h
// and bone_setup.cpp. Bake the configured pose into ordinary Three.js clips;
// geometry and animation libraries can use different ValveBiped bone orders.
export function createSourceAnimationSampler(mdl, bones, options = {}, ani = null) {
  const count = mdl.i32(180), start = mdl.i32(184);
  mdl.table(start, count, 100);
  const requested = options.animations ? new Set(options.animations.map(name => name.trim().toLowerCase())) : null;
  const sequences = describeSequences(mdl);
  const sequenceByName = new Map(sequences.map((seq, index) => [seq.name.toLowerCase(), index]));
  const targetByName = new Map((options.targetBones || bones).map(bone => [bone.name.toLowerCase(), bone]));
  let poses = { ...options.poseParameters };
  const clamp = value => Math.max(0, Math.min(1, value));
  const descCache = new Map(), seqCache = new Map(), recordCache = new Map(), frameCache = new Map();
  const poseCount = mdl.i32(300), poseStart = mdl.i32(304);
  mdl.table(poseStart, poseCount, 20);
  const poseValue = index => {
    if (index < 0) return 0;
    if (index >= poseCount) throw new Error("invalid pose parameter index");
    const offset = poseStart + index * 20, name = mdl.relativeString(offset);
    const value = Number(poses[name] ?? 0);
    if (!Number.isFinite(value)) throw new Error(`invalid pose parameter ${name}`);
    return value;
  };
  const bindPose = () => bones.map(bone => {
    const target = targetByName.get(bone.name.toLowerCase()) || bone;
    return { position: target.position.clone(), quaternion: target.quaternion.clone() };
  });
  const copyPose = pose => pose.map(bone => ({ position: bone.position.clone(), quaternion: bone.quaternion.clone() }));
  function descriptor(index) {
    if (descCache.has(index)) return descCache.get(index);
    if (index < 0 || index >= count) throw new Error("animation is in an unavailable included model");
    const offset = start + index * 100;
    const frames = mdl.i32(offset + 16), fps = mdl.f32(offset + 8), flags = mdl.i32(offset + 12);
    if (frames < 1 || frames > 100000 || fps <= 0) throw new Error("invalid animation frame count/rate");
    if (flags & 64) throw new Error("frame-encoded animation is not supported");
    if (mdl.i32(offset + 72)) throw new Error("animated local hierarchy is not supported");
    const sectionFrames = mdl.i32(offset + 84), sectionOffset = mdl.i32(offset + 80);
    if (sectionFrames < 0 || (sectionFrames && !sectionOffset)) throw new Error("invalid animation section table");
    if (sectionFrames) mdl.table(offset + sectionOffset, Math.floor(frames / sectionFrames) + 2, 8);
    const moves = mdl.i32(offset + 20), moveStart = offset + mdl.i32(offset + 24);
    mdl.table(moveStart, moves, 44);
    const movement = moves ? new THREE.Vector3().fromArray(mdl.floats(moveStart + (moves - 1) * 44 + 32, 3)) : new THREE.Vector3();
    const result = { index, offset, frames, fps, flags, sectionFrames, sections: offset + sectionOffset, movement, moves };
    descCache.set(index, result);
    return result;
  }
  function sequence(index) {
    if (seqCache.has(index)) return seqCache.get(index);
    const info = sequences[index];
    if (!info) throw new Error("sequence layer is in an unavailable included model");
    const offset = info.offset, grid = [mdl.i32(offset + 68), mdl.i32(offset + 72)];
    const blends = mdl.i32(offset + 56), indices = offset + mdl.i32(offset + 60);
    if (grid.some(size => size < 1) || grid[0] * grid[1] !== blends) throw new Error("invalid sequence blend grid");
    if (info.flags & (128 | 512 | 16384)) throw new Error("cycle-pose/local-context/world-space sequences are not supported");
    mdl.table(indices, blends, 2);
    const poseKey = mdl.i32(offset + 160);
    if (poseKey) mdl.table(offset + poseKey, grid[0] + grid[1], 4);
    const axes = grid.map((size, axis) => {
      if (size === 1) return [{ index: 0, weight: 1 }];
      const value = poseValue(mdl.i32(offset + 76 + axis * 4));
      let cell, fraction;
      if (poseKey) {
        const keyStart = offset + poseKey + (axis ? grid[0] * 4 : 0);
        cell = 0;
        while (cell < size - 2 && value > mdl.f32(keyStart + (cell + 1) * 4)) cell++;
        const low = mdl.f32(keyStart + cell * 4), high = mdl.f32(keyStart + (cell + 1) * 4);
        fraction = high === low ? 0 : clamp((value - low) / (high - low));
      } else {
        const low = mdl.f32(offset + 84 + axis * 4), high = mdl.f32(offset + 92 + axis * 4);
        const coordinate = (high === low ? 0 : clamp((value - low) / (high - low))) * (size - 1);
        cell = Math.min(size - 2, Math.floor(coordinate));
        fraction = coordinate - cell;
      }
      return [{ index: cell, weight: 1 - fraction }, { index: cell + 1, weight: fraction }].filter(entry => entry.weight > 1e-6);
    });
    const samples = [];
    for (const y of axes[1]) for (const x of axes[0]) {
      samples.push({ desc: descriptor(mdl.i16(indices + (x.index + y.index * grid[0]) * 2)), weight: x.weight * y.weight });
    }
    const weights = mdl.i32(offset + 156);
    if (weights) mdl.table(offset + weights, bones.length, 4);
    const boneWeights = bones.map((_, bone) => weights ? clamp(mdl.f32(offset + weights + bone * 4)) : 1);
    const layerCount = mdl.i32(offset + 148), layerStart = offset + mdl.i32(offset + 152);
    mdl.table(layerStart, layerCount, 24);
    const layers = Array.from({ length: layerCount }, (_, layer) => {
      const entry = layerStart + layer * 24;
      return { index: mdl.i16(entry), pose: mdl.i16(entry + 2), flags: mdl.i32(entry + 4), range: mdl.floats(entry + 8, 4) };
    });
    const rate = samples.reduce((sum, { desc, weight }) => sum + weight * desc.fps / Math.max(1, desc.frames - 1), 0);
    const duration = 1 / rate;
    const result = { ...info, index, samples, boneWeights, layers, duration, fps: Math.max(...samples.map(s => s.desc.fps)) };
    seqCache.set(index, result);
    return result;
  }
  function integerFrame(desc, frame) {
    const key = `${desc.index}:${frame}`;
    if (frameCache.has(key)) return frameCache.get(key);
    let localFrame = frame, block = mdl.i32(desc.offset + 52), offset = mdl.i32(desc.offset + 56);
    if (desc.sectionFrames) {
      const last = desc.frames > desc.sectionFrames && frame === desc.frames - 1;
      const section = last ? Math.floor(desc.frames / desc.sectionFrames) + 1 : Math.floor(frame / desc.sectionFrames);
      localFrame = last ? 0 : frame % desc.sectionFrames;
      block = mdl.i32(desc.sections + section * 8);
      offset = mdl.i32(desc.sections + section * 8 + 4);
    }
    let records = new Map(), reader = mdl;
    if (!(desc.flags & 32)) {
      if (block < 0) throw new Error("missing compiled animation block");
      let absolute = desc.offset + offset;
      if (block > 0) {
        if (!ani) throw new Error("external .ani file is required");
        if (block >= mdl.i32(352)) throw new Error("invalid external animation block");
        const entry = mdl.i32(356) + block * 8, first = mdl.i32(entry), end = mdl.i32(entry + 4);
        ani.check(first, end - first);
        // Offset zero is valid in an external animation block.
        if (offset < 0 || first + offset >= end) throw new Error("animation offset exceeds its external block");
        reader = ani;
        absolute = first + offset;
      }
      const recordKey = `${desc.index}:${block}:${absolute}`;
      if (!recordCache.has(recordKey)) recordCache.set(recordKey, readRecords(reader, block || offset ? absolute : null, bones.length));
      records = recordCache.get(recordKey);
    }
    const result = bones.map((bone, index) => sampleBone(reader, records.get(index), localFrame, bone, Boolean(desc.flags & 4)));
    frameCache.set(key, result);
    return result;
  }
  function sampleAnimation(desc, cycle) {
    const frame = clamp(cycle) * (desc.frames - 1), first = Math.floor(frame), fraction = frame - first;
    const pose = copyPose(integerFrame(desc, first));
    if (fraction > 1e-6 && first + 1 < desc.frames) {
      const next = integerFrame(desc, first + 1);
      pose.forEach((bone, index) => {
        bone.position.lerp(next[index].position, fraction);
        bone.quaternion.slerp(next[index].quaternion, fraction);
      });
    }
    return pose;
  }
  function blendPose(seq, cycle) {
    let result = null, total = 0;
    for (const { desc, weight } of seq.samples) {
      const pose = sampleAnimation(desc, cycle);
      total += weight;
      if (!result) result = pose;
      else result.forEach((bone, index) => {
        bone.position.lerp(pose[index].position, weight / total);
        bone.quaternion.slerp(pose[index].quaternion, weight / total);
      });
    }
    return result;
  }
  function accumulate(pose, index, cycle, time, amount = 1, parents = []) {
    if (amount <= 0) return;
    if (parents.includes(index) || parents.length >= 32) throw new Error("cyclic/deep sequence layers");
    const seq = sequence(index), path = [...parents, index];
    if (seq.flags & 256) cycle = (time / seq.duration) % 1;
    const incoming = blendPose(seq, cycle);
    const applyLayers = (destination, local) => {
      for (const layer of seq.layers) {
        if (Boolean(layer.flags & 4096) !== local) continue;
        let layerCycle = cycle, layerWeight = local ? 1 : amount;
        const [start, peak, tail, end] = layer.range;
        if (start !== end) {
          const value = layer.flags & 16384 ? poseValue(layer.pose) : cycle;
          if (value < start || value >= end) continue;
          let weight = value < peak && peak !== start ? (value - start) / (peak - start)
            : value > tail && end !== tail ? (end - value) / (end - tail) : 1;
          if (layer.flags & 64) weight = weight * weight * (3 - 2 * weight);
          if ((layer.flags & 128) && value > tail) layerWeight = weight * layerWeight / (1 - layerWeight + weight * layerWeight || 1);
          else if (layer.flags & 512) layerWeight = weight;
          else layerWeight *= weight;
          if (!(layer.flags & 16384)) layerCycle = (cycle - start) / (end - start);
        }
        accumulate(destination, layer.index, layerCycle, time, layerWeight, path);
      }
    };
    applyLayers(incoming, true);
    pose.forEach((bone, boneIndex) => {
      const weight = clamp(amount * seq.boneWeights[boneIndex]);
      if (!weight) return;
      const sample = incoming[boneIndex];
      if (seq.flags & 4) {
        const rotation = new THREE.Quaternion().slerp(sample.quaternion, weight);
        if (seq.flags & 16) bone.quaternion.multiply(rotation);
        else bone.quaternion.premultiply(rotation);
        bone.quaternion.normalize();
        bone.position.addScaledVector(sample.position, weight);
      } else {
        bone.position.lerp(sample.position, weight);
        bone.quaternion.slerp(sample.quaternion, weight);
      }
    });
    applyLayers(pose, false);
  }
  // Decoded frames are shared; pose-dependent blend choices are refreshed when
  // any parameter changes. Sampling is synchronous and never mutates cached frames.
  const parameterNames = Array.from({ length: poseCount }, (_, i) => mdl.relativeString(poseStart + i * 20));
  function parameters(values = options.poseParameters || {}) {
    if (parameterNames.some(name => (values[name] ?? 0) !== (poses[name] ?? 0))) {
      poses = { ...values }; seqCache.clear();
    }
  }
  function indexOf(name) {
    const index = sequenceByName.get(String(name).trim().toLowerCase());
    if (index === undefined) throw new Error(`Source animation "${name}" is missing.`);
    return index;
  }
  function sample(name, cycle, time, values, baseName, overlays = []) {
    parameters(values);
    const index = indexOf(name), seq = sequence(index), pose = bindPose();
    if (baseName && baseName.toLowerCase() !== seq.name.toLowerCase()
        && ((seq.flags & 4) || seq.boneWeights.some(weight => weight < 1))) {
      accumulate(pose, indexOf(baseName), 0, time);
    }
    accumulate(pose, index, cycle, time);
    for (const layer of overlays) {
      const destination = layer.mask ? copyPose(pose) : pose;
      accumulate(destination, indexOf(layer.name), layer.cycle, time, layer.weight ?? 1);
      if (layer.mask) for (const i of layer.mask) {
        pose[i].position.copy(destination[i].position); pose[i].quaternion.copy(destination[i].quaternion);
      }
    }
    return pose;
  }
  function info(name, values) {
    parameters(values);
    const seq = sequence(indexOf(name)), movement = new THREE.Vector3();
    seq.samples.forEach(({ desc, weight }) => movement.addScaledVector(desc.movement, weight));
    return { name: seq.name, duration: seq.duration, loop: Boolean(seq.flags & 1), movement };
  }
  function bake() {
    parameters();
    const clips = [], warnings = [];
    for (let index = 0; index < sequences.length; index++) {
      const info = sequences[index];
      if (requested && !requested.has(info.name.toLowerCase())) continue;
      try {
        const seq = sequence(index);
        const baseName = typeof options.baseSequence === "string" ? options.baseSequence : options.baseSequence?.[info.name];
        // Masked/layer-only clips also need a posed underlay, even without STUDIO_DELTA.
        const needsBase = Boolean(seq.flags & 4) || seq.boneWeights.some(weight => weight < 1);
        const base = needsBase && baseName ? sequenceByName.get(baseName.toLowerCase()) : undefined;
        if (needsBase && baseName && base === undefined) throw new Error(`base sequence "${baseName}" is missing`);
        const frames = Math.max(2, Math.round(seq.duration * seq.fps) + 1);
        if (frames > 100000) throw new Error("sequence is too long");
        const times = Array.from({ length: frames }, (_, frame) => frame * seq.duration / (frames - 1));
        const samples = bones.map(() => ({ positions: [], quaternions: [] }));
        let firstPose;
        for (let frame = 0; frame < frames; frame++) {
          let pose = bindPose();
          const time = times[frame], cycle = frame / (frames - 1);
          if (base !== undefined) accumulate(pose, base, 0, 0);
          accumulate(pose, index, cycle, time);
          // Real-time breathing layers must also close at a looping clip's seam.
          if ((seq.flags & 1) && frame === frames - 1) pose = firstPose;
          if (!frame) firstPose = copyPose(pose);
          pose.forEach((bone, boneIndex) => {
            samples[boneIndex].positions.push(...bone.position.toArray());
            samples[boneIndex].quaternions.push(...bone.quaternion.toArray());
          });
        }
        const tracks = [];
        bones.forEach((bone, boneIndex) => {
          const target = targetByName.get(bone.name.toLowerCase());
          if (!target) return;
          tracks.push(new THREE.VectorKeyframeTrack(`${target.name}.position`, times, samples[boneIndex].positions));
          tracks.push(new THREE.QuaternionKeyframeTrack(`${target.name}.quaternion`, times, samples[boneIndex].quaternions));
        });
        if (!tracks.length) throw new Error("animation skeleton has no matching character bones");
        const clip = new THREE.AnimationClip(seq.name, seq.duration, tracks).optimize();
        const movement = new THREE.Vector3();
        seq.samples.forEach(({ desc, weight }) => movement.addScaledVector(desc.movement, weight));
        clip.userData = { source: { movement: movement.toArray(), motionExtracted: seq.samples.some(({ desc }) => desc.moves > 0) } };
        clips.push(clip);
      } catch (error) {
        const message = `Source sequence "${info.name}": ${error.message}`;
        if (requested) throw new Error(message);
        warnings.push(message);
      }
    }
    if (requested) for (const name of requested) {
      if (!clips.some(clip => clip.name.toLowerCase() === name)) throw new Error(`Source animation "${name}" is missing. Available: ${sequences.map(s => s.name).join(", ")}`);
    }
    return { clips, warnings };
  }
  return { bones, names: sequences.map(seq => seq.name),
    has: name => sequenceByName.has(String(name).trim().toLowerCase()), info, sample, bake };
}

export function parseAnimations(mdl, bones, options = {}, ani = null) {
  return createSourceAnimationSampler(mdl, bones, options, ani).bake();
}
