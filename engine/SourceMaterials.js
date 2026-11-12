import * as THREE from "./vendor/three.module.js";

// Inspect the full decoded image once: downsampling can miss small cutouts
// or invent partial alpha along otherwise binary edges.
function detectAlphaMode(image) {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  try {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Cannot inspect texture alpha: 2D canvas is unavailable.");
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let mode = "opaque";
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] === 255) continue;
      if (pixels[i] !== 0) return "blend";
      mode = "cutout";
    }
    return mode;
  } finally {
    canvas.width = canvas.height = 0;
  }
}

// This multiplayer package supplies loose WebP textures beside each MDL.
// Cache material probes and decoded textures shared by bodygroup variants.
export async function loadSourceMaterials(metadata, options = {}, manager = THREE.DefaultLoadingManager, usedMaterials = null) {
  const root = (options.textureRoot || "./").replace(/\/?$/, "/");
  const textures = new Map();
  const texture = url => {
    if (!textures.has(url)) textures.set(url, (async () => {
      const response = await fetch(manager.resolveURL(url));
      if (response.status === 404 || response.status === 410) return null;
      if (!response.ok) throw new Error(`HTTP ${response.status} loading ${url}`);
      const blobURL = URL.createObjectURL(new Blob([await response.arrayBuffer()], { type: "image/webp" }));
      let map;
      try { map = await new THREE.TextureLoader(manager).loadAsync(blobURL); }
      finally { URL.revokeObjectURL(blobURL); }
      try { map.userData.sourceAlphaMode = detectAlphaMode(map.image); }
      catch (error) { map.dispose(); throw error; }
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.flipY = false; map.colorSpace = THREE.SRGBColorSpace; map.name = url;
      return map;
    })());
    return textures.get(url);
  };

  return Promise.all(metadata.materialNames.map(async (name, index) => {
    const material = new THREE.MeshPhysicalMaterial({ name, color: 0x858585, roughness: 0.65, metalness: 0 });
    if (usedMaterials && !usedMaterials.has(index)) return material;
    try {
      const path = String(name).replaceAll("\\", "/").replace(/^\/+/, "").replace(/^materials\//i, "");
      if (!path || path.split("/").some(part => !part || part === ".." || part === ".") || /[:?#]/.test(path)) {
        throw new Error(`Invalid Source material path: ${name}`);
      }
      for (const stem of new Set([path.split("/").pop(), path])) {
        const map = await texture(`${root}${stem}.webp`);
        if (!map) continue;
        material.color.set(0xffffff); material.side = THREE.DoubleSide;
        material.specularIntensity = 0.1; material.map = map;
        const alphaMode = map.userData.sourceAlphaMode;
        material.transparent = alphaMode === "blend";
        material.alphaTest = alphaMode === "cutout" ? 0.5 : 0;
        material.depthWrite = alphaMode !== "blend";
        material.userData.sourceMaterial = { mode: "automatic", baseTexture: map.name, alphaMode };
        return material;
      }
      throw new Error(`No WebP texture for ${name} in ${root}`);
    } catch (error) {
      if (options.strictMaterials) { material.dispose(); throw new Error(`Source material "${name}": ${error.message}`); }
      console.warn(`Source material "${name}" uses a plain fallback: ${error.message}`);
    }
    return material;
  }));
}
