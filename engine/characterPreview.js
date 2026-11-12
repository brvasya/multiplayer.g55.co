import { clone } from "./vendor/SkeletonUtils.js";
import { applyCharacterBodygroups, createCharacterAnimator } from "./characterLoader.js";
import { normalizeAppearance } from "./bodygroups.js";
import { updateSourceProceduralBones } from "./SourceProcedural.js";

// Uses the already loaded character pool. No model URLs, group names, bone names
// or variant counts are baked into the preview. Its pose is independent of combat.
export function createCharacterPreview({ THREE, container, schema, models }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.5));
  renderer.domElement.setAttribute("aria-hidden", "true"); container.appendChild(renderer.domElement);
  const scene = new THREE.Scene(); scene.name = "Character customization preview"; scene.background = new THREE.Color(0x10202d);
  const camera = new THREE.PerspectiveCamera(36, 1, .01, 100);
  const pivot = new THREE.Group(); scene.add(pivot);
  let model, animator, selected, frontYaw = 0;
  const hemi = new THREE.HemisphereLight(0xddefff, 0x607080, 2.2);
  const key = new THREE.DirectionalLight(0xffedda, 2.5); key.position.set(3, 5, 4);
  const rim = new THREE.DirectionalLight(0x7ebeff, 2); rim.position.set(-3, 2, -3);
  scene.add(hemi, key, rim);
  const target = new THREE.Vector3(), bounds = new THREE.Box3(), size = new THREE.Vector3(), point = new THREE.Vector3();
  let active = false, frame = null, previous = 0, width = 0, height = 0, drag = null;

  function disposeModel() {
    animator?.dispose();
    const skeletons = new Set(); model?.traverse(o => { if (o.isSkinnedMesh) skeletons.add(o.skeleton); });
    skeletons.forEach(skeleton => skeleton.dispose()); model?.removeFromParent();
    model = animator = null;
  }
  function selectModel(entry) {
    finishDrag(); disposeModel(); selected = entry;
    const { template, asset } = entry;
    model = clone(template.scene); model.scale.setScalar(.0254); pivot.add(model);
    const idle = [asset.previewAnimation, "idle_all_01", "idle_unarmed", "idle_neutral", "idle", `idle_${asset.playerAnimation?.defaultHoldType || "ar2"}`].flat().filter(Boolean);
    const previewAsset = { ...asset, playerAnimation: {
      ...asset.playerAnimation, defaultHoldType: "normal", sets: { all: { idle } }
    } };
    animator = createCharacterAnimator(model, template.animationSampler, previewAsset);
    // Source's +X forward becomes +Z in the loader, towards the preview camera.
    frontYaw = Number.isFinite(asset.previewYaw) ? asset.previewYaw : 0;
    pivot.rotation.y = frontYaw; updateSourceProceduralBones(model);
  }

  function visibleBounds() {
    // updateWorldMatrix bypasses SkinnedMesh's bind-inverse update. Use the same
    // update as the renderer, then measure the current pose, never cached boxes.
    scene.updateMatrixWorld(true); bounds.makeEmpty();
    model.traverseVisible(object => {
      if (!object.isMesh) return;
      for (let i = 0; i < object.geometry.attributes.position.count; i++) {
        object.getVertexPosition(i, point).applyMatrix4(object.matrixWorld);
        bounds.expandByPoint(point);
      }
    });
    if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-.5, 0, -.5), new THREE.Vector3(.5, 1.9, .5));
    return bounds;
  }
  function fit() {
    visibleBounds().getSize(size); bounds.getCenter(target);
    const halfFov = Math.tan(camera.fov * Math.PI / 360);
    const distance = Math.max(size.y / 2, size.x / (2 * camera.aspect), .001) / halfFov * 1.12 + size.z / 2;
    camera.position.set(target.x, target.y, target.z + distance);
    camera.near = Math.max(.0001, (distance - size.z / 2) * .1);
    camera.far = distance + size.z / 2 + Math.max(1, size.length());
    camera.lookAt(target); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  }
  function resize() {
    const rect = container.getBoundingClientRect();
    const w = Math.max(1, container.clientWidth || rect.width || 320), h = Math.max(1, container.clientHeight || rect.height || 360);
    if (w !== width || h !== height) {
      width = w; height = h; renderer.setSize(width, height); camera.aspect = width / height;
    }
    fit();
  }
  function setAppearance(value) {
    const appearance = normalizeAppearance(schema, value);
    const entry = models.find(entry => entry.schema.model === appearance.model) || models[0];
    if (selected !== entry) selectModel(entry);
    applyCharacterBodygroups(model, appearance.bodygroups, { prune: false });
    fit();
  }
  function render(now) {
    if (!active) return;
    frame = requestAnimationFrame(render);
    if (document.hidden) { previous = now; return; }
    animator.update(Math.min(.05, Math.max(0, (now - previous) / 1000))); previous = now;
    updateSourceProceduralBones(model); fit(); renderer.render(scene, camera);
  }
  function start({ resetView = true } = {}) {
    if (active) return;
    if (resetView) pivot.rotation.y = frontYaw;
    active = true; previous = performance.now(); resize(); frame = requestAnimationFrame(render);
  }
  function stop() {
    active = false; cancelAnimationFrame(frame); frame = null;
    finishDrag();
  }
  function finishDrag() {
    const id = drag?.id; drag = null;
    container.classList.remove("is-rotating");
    if (id != null && container.hasPointerCapture?.(id)) container.releasePointerCapture(id);
  }
  function down(event) {
    if (!active || event.button !== 0 || drag) return;
    event.preventDefault();
    drag = { id: event.pointerId, x: event.clientX };
    container.setPointerCapture?.(event.pointerId); container.classList.add("is-rotating");
  }
  function move(event) {
    if (!drag || drag.id !== event.pointerId) return;
    pivot.rotation.y += (event.clientX - drag.x) * .012; drag.x = event.clientX; fit();
  }
  function up(event) { if (drag && drag.id === event.pointerId) finishDrag(); }
  container.addEventListener("pointerdown", down); container.addEventListener("pointermove", move);
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) container.addEventListener(type, up);
  const onResize = () => { if (active) resize(); };
  window.addEventListener("resize", onResize);
  const observer = globalThis.ResizeObserver ? new globalThis.ResizeObserver(onResize) : null;
  observer?.observe(container);
  setAppearance(null);
  return { setAppearance, start, stop,
    dispose() {
      stop(); observer?.disconnect(); window.removeEventListener("resize", onResize);
      container.removeEventListener("pointerdown", down); container.removeEventListener("pointermove", move);
      for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) container.removeEventListener(type, up);
      disposeModel();
      // Geometry, materials and textures belong to the shared character pool.
      renderer.dispose(); renderer.domElement.remove(); pivot.removeFromParent();
    }
  };
}
