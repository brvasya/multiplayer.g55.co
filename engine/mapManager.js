export function resolveMapConfig(config) {
  if (!Array.isArray(config?.items) || !config.items.length) {
    throw new Error("GAME_CONFIG.maps.items must contain at least one map.");
  }
  const ids = new Set();
  const items = config.items.map(item => {
    if (typeof item?.id !== "string" || !item.id.trim() || ids.has(item.id) ||
        typeof item.name !== "string" || !item.name.trim() || typeof item.load !== "function") {
      throw new Error("Each map needs a unique id, a name, and a load function.");
    }
    ids.add(item.id);
    return { id: item.id, name: item.name, load: item.load };
  });
  return {
    items,
    defaultId: ids.has(config.defaultId) ? config.defaultId : items[0].id
  };
}

export function createMapWorld({ THREE, scene, maps, mapId }) {
  const config = resolveMapConfig(maps);
  const definitions = new Map(config.items.map(item => [item.id, item]));
  const initialId = definitions.has(mapId) ? mapId : config.defaultId;
  // Gameplay systems retain these arrays and this navigation object across maps.
  const colliders = [], floorObjects = [];
  let active = null, pending = Promise.resolve();
  const navigation = {
    hasLineOfSight: (...args) => active.world.navigation.hasLineOfSight(...args),
    get grid() { return active.world.navigation.grid; }
  };
  const world = {
    colliders, floorObjects, navigation,
    get mapId() { return active?.id ?? initialId; },
    get spawn() { return active?.world.spawn; },
    get lighting() { return active?.world.lighting; },
    ready: null,
    selectMap,
    resetPlayer: player => active.world.resetPlayer(player),
    update: (delta, camera) => active.world.update?.(delta, camera)
  };

  world.ready = selectMap(initialId).then(() => world);
  return world;

  function selectMap(id) {
    // A player may leave and join another room before its previous map loads.
    // Serialize changes so the later room reliably becomes the active arena.
    const next = pending.catch(() => {}).then(() => loadMap(id));
    pending = next;
    return next;
  }

  async function loadMap(id) {
    if (!definitions.has(id)) throw new Error(`Unknown map: ${id}`);
    if (active?.id === id) return false;
    const module = await definitions.get(id).load();
    if (typeof module?.createWorld !== "function") {
      throw new Error(`Map ${id} must export createWorld({ THREE, scene }).`);
    }
    const previousChildren = new Set(scene.children);
    const previousBackground = scene.background, previousFog = scene.fog;
    let next;
    try {
      next = module.createWorld({ THREE, scene });
      await next?.ready;
      if (!next?.map?.isObject3D || !next.isLoaded || !next.spawn?.isVector3 ||
          !Array.isArray(next.colliders) || !Array.isArray(next.floorObjects) ||
          typeof next.resetPlayer !== "function" || !next.navigation?.grid ||
          typeof next.navigation.hasLineOfSight !== "function") {
        throw new Error(`Map ${id} does not provide the existing world interface.`);
      }
      // Own shadow uniforms with the map so disposed textures stay released.
      let depthMaterial;
      next.map.traverse(object => {
        if (!object.isMesh || !object.castShadow || object.customDepthMaterial) return;
        depthMaterial ||= new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
        object.customDepthMaterial = depthMaterial;
      });
    } catch (error) {
      disposeNodes(scene.children.filter(node => !previousChildren.has(node)));
      scene.background = previousBackground;
      scene.fog = previousFog;
      throw error;
    }

    const nodes = scene.children.filter(node => !previousChildren.has(node));
    if (active) disposeNodes(active.nodes);
    active = { id, world: next, nodes };
    colliders.splice(0, colliders.length, ...next.colliders);
    floorObjects.splice(0, floorObjects.length, ...next.floorObjects);
    return true;
  }

  function disposeNodes(nodes) {
    const geometries = new Set(), materials = new Set(), textures = new Set();
    for (const root of nodes) {
      root.removeFromParent();
      root.traverse(object => {
        if (object.geometry) geometries.add(object.geometry);
        const objectMaterials = [].concat(object.material || []);
        if (object.customDepthMaterial) objectMaterials.push(object.customDepthMaterial);
        if (object.customDistanceMaterial) objectMaterials.push(object.customDistanceMaterial);
        for (const material of objectMaterials) {
          materials.add(material);
          for (const value of Object.values(material)) {
            if (value?.isTexture) textures.add(value);
          }
        }
        if (object.isInstancedMesh || object.isLight) object.dispose?.();
      });
      root.clear();
    }
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    textures.forEach(texture => texture.dispose());
  }
}
