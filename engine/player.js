import { playerEyeHeight } from "./playerStance.js";

export function createPlayer({ THREE, camera, config, colliders, lockTarget }) {
  const MOVE_TUNING = {
    maxGroundSpeed: config.playerSpeed,
    maxWalkSpeed: config.playerSpeed * config.walkMultiplier,
    groundAcceleration: config.groundAcceleration * 1.12,
    airAcceleration: config.airAcceleration * 0.72,
    friction: config.friction * 1.18,
    stopSpeed: config.stopSpeed,
    counterStrafeBoost: 1.45,
    stepRunInterval: 0.34,
    stepWalkInterval: 0.5,
    runBobAmount: 0.007,
    walkBobAmount: 0.0035,
    runRollAmount: 0.0014,
    walkRollAmount: 0.0008,
    stepDipAmount: 0.006,
    stepHeight: 0.48,
    groundSnapDistance: 0.28,
    groundRayLength: 4,
    playerRadius: 0.38
  };

  const keys = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    walking: false,
    jumpQueued: false
  };

  const touchInput = {
    moveX: 0,
    moveY: 0
  };

  const inputState = {
    mouseDeltaX: 0,
    mouseDeltaY: 0,
    mouseDown: false,
    moving: false,
    walking: false,
    grounded: true,
    crouched: false,
    footstep: false,
    jumped: false,
    speed01: 0
  };

  const velocity = new THREE.Vector3();
  const wishDirection = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const side = new THREE.Vector3();
  const oldPosition = new THREE.Vector3();

  const groundRaycaster = new THREE.Raycaster();
  const groundRayOrigin = new THREE.Vector3();
  const groundRayDirection = new THREE.Vector3(0, -1, 0);

  const ceilingRaycaster = new THREE.Raycaster();
  const ceilingRayOrigin = new THREE.Vector3();
  const ceilingRayDirection = new THREE.Vector3(0, 1, 0);

  const wallRaycaster = new THREE.Raycaster();
  const wallRayOrigin = new THREE.Vector3();
  const wallMove = new THREE.Vector3();

  let yaw = 0;
  let pitch = 0;
  let verticalVelocity = 0;
  let canJump = true;
  let stepTimer = 0;
  let bobTime = 0;
  let cameraBobOffset = 0;
  let cameraRollOffset = 0;
  let cameraRollApplied = 0;
  let cameraYawOffset = 0;
  let cameraYawApplied = 0;
  let stepDip = 0;
  let baseCameraY = config.playerHeight;
  let groundY = null;
  let crouchWanted = false, crouch = 0;
  const headClearance = .19 * config.playerHeight / 1.75;
  const crouchMotion = { crouch: 0 };
  const eyeHeight = () => { crouchMotion.crouch = crouch; return playerEyeHeight(crouchMotion, config); };
  const r = MOVE_TUNING.playerRadius, diagonal = r / Math.sqrt(2);
  const headSamples = [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r],
    [diagonal, diagonal], [-diagonal, diagonal], [diagonal, -diagonal], [-diagonal, -diagonal]];
  const ceilingBounds = new WeakMap();

  applyCameraRotation();

  function isMouseCaptured() {
    return document.pointerLockElement === lockTarget;
  }

  function onKeyDown(event) {
    switch (event.code) {
      case "KeyW": keys.forward = true; break;
      case "KeyS": keys.backward = true; break;
      case "KeyA": keys.left = true; break;
      case "KeyD": keys.right = true; break;
      case "ShiftLeft":
      case "ShiftRight": keys.walking = true; break;
      case "KeyC":
        event.preventDefault();
        if (!event.repeat) toggleCrouch();
        break;
      case "Space":
        event.preventDefault();
        if (!event.repeat) queueJump();
        break;
    }
  }

  function onKeyUp(event) {
    switch (event.code) {
      case "KeyW": keys.forward = false; break;
      case "KeyS": keys.backward = false; break;
      case "KeyA": keys.left = false; break;
      case "KeyD": keys.right = false; break;
      case "ShiftLeft":
      case "ShiftRight": keys.walking = false; break;
    }
  }

  function onMouseDown(event) {
    if (event.button === 0 && isMouseCaptured()) inputState.mouseDown = true;
  }

  function onMouseUp(event) {
    if (event.button === 0) {
      inputState.mouseDown = false;
    }
  }

  function onMouseMove(event, sensitivityMultiplier = 1) {
    if (isMouseCaptured()) {
      rotateView(event.movementX, event.movementY, config.mouseSensitivity * sensitivityMultiplier);
    }
  }

  function rotateView(deltaX, deltaY, sensitivity) {
    inputState.mouseDeltaX += deltaX;
    inputState.mouseDeltaY += deltaY;
    yaw -= deltaX * sensitivity;
    pitch -= deltaY * sensitivity;
    pitch = Math.max(-Math.PI / 2 + 0.02, Math.min(Math.PI / 2 - 0.02, pitch));
    applyCameraRotation();
  }

  function applyCameraRotation() {
    camera.rotation.order = "YXZ";
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;
  }

  function addLookDelta(deltaX, deltaY, sensitivityMultiplier = 1) {
    rotateView(deltaX, deltaY, config.touchSensitivity * sensitivityMultiplier);
  }

  function setFiring(active) {
    inputState.mouseDown = Boolean(active);
  }

  function setTouchMove(x = 0, y = 0) {
    touchInput.moveX = THREE.MathUtils.clamp(x, -1, 1);
    touchInput.moveY = THREE.MathUtils.clamp(y, -1, 1);
  }

  function queueJump() {
    keys.jumpQueued = true;
  }

  function toggleCrouch() { crouchWanted = !crouchWanted; }

  function updateStance(delta) {
    const step = delta / (config.crouchTransitionSeconds ?? .16);
    let next = crouchWanted ? Math.min(1, crouch + step) : Math.max(0, crouch - step);
    if (next < crouch) {
      const feet = baseCameraY - config.playerHeight;
      const nextHeight = playerEyeHeight({ crouch: next }, config);
      const ceiling = ceilingY(feet, feet + nextHeight + headClearance);
      if (ceiling !== null) {
        const range = config.playerHeight - playerEyeHeight({ crouch: 1 }, config);
        const minimum = (config.playerHeight - (ceiling - feet - headClearance - .005)) / range;
        next = Math.min(crouch, Math.max(next, minimum));
      }
    }
    crouch = next;
    inputState.crouched = crouch > .001;
  }

  function clearMovement() {
    keys.forward = false;
    keys.backward = false;
    keys.left = false;
    keys.right = false;
    keys.walking = false;
    keys.jumpQueued = false;
    touchInput.moveX = 0;
    touchInput.moveY = 0;
    inputState.mouseDown = false;
  }

  function reset(options = {}) {
    const position = options.position ?? null;
    const nextYaw = options.yaw ?? 0;

    yaw = nextYaw;
    pitch = 0;
    verticalVelocity = 0;
    canJump = true;
    stepTimer = 0;
    bobTime = 0;
    cameraBobOffset = 0;
    cameraRollOffset = 0;
    cameraRollApplied = 0;
    cameraYawOffset = 0;
    cameraYawApplied = 0;
    stepDip = 0;
    groundY = null;
    crouchWanted = false; crouch = 0;

    if (position) camera.position.copy(position);

    baseCameraY = camera.position.y;
    velocity.set(0, 0, 0);
    applyCameraRotation();
    clearMovement();

    inputState.footstep = false;
    inputState.jumped = false;
    inputState.moving = false;
    inputState.walking = false;
    inputState.grounded = true;
    inputState.crouched = false;
    inputState.speed01 = 0;
  }

  function update(delta, isPlaying) {
    inputState.footstep = false;
    inputState.jumped = false;
    inputState.mouseDeltaX = THREE.MathUtils.lerp(inputState.mouseDeltaX, 0, 1 - Math.exp(-30 * delta));
    inputState.mouseDeltaY = THREE.MathUtils.lerp(inputState.mouseDeltaY, 0, 1 - Math.exp(-30 * delta));

    if (isPlaying) {
      // A crouched jump press only stands up; consume it before the stance
      // transition can finish so that this press never also triggers a jump.
      if (keys.jumpQueued && (crouchWanted || crouch > 0)) {
        crouchWanted = false;
        keys.jumpQueued = false;
      }
      updateStance(delta);
    }
    groundY = getGroundY();

    if (groundY !== null && !isPlaying) {
      baseCameraY = groundY + config.playerHeight;
      camera.position.y = baseCameraY - config.playerHeight + eyeHeight();
    }

    if (!isPlaying) return;

    const hasGround = groundY !== null;
    const targetGroundCameraY = hasGround ? groundY + config.playerHeight : baseCameraY;
    const grounded = hasGround && baseCameraY <= targetGroundCameraY + MOVE_TUNING.groundSnapDistance && verticalVelocity <= 0;

    if (grounded) {
      baseCameraY = targetGroundCameraY;
      verticalVelocity = 0;
      canJump = true;
    } else {
      canJump = false;
    }

    if (keys.jumpQueued) {
      if (grounded && canJump) {
        verticalVelocity = config.jumpPower;
        canJump = false;
        inputState.jumped = true;
      }

      keys.jumpQueued = false;
    }

    // Camera sway is cosmetic; movement follows the player's actual facing.
    forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));

    side.crossVectors(camera.up, forward).normalize();
    wishDirection.set(0, 0, 0);

    const moveForward = (keys.forward ? 1 : 0) - (keys.backward ? 1 : 0) - touchInput.moveY;
    const moveRight = (keys.right ? 1 : 0) - (keys.left ? 1 : 0) + touchInput.moveX;

    if (moveForward !== 0) wishDirection.addScaledVector(forward, moveForward);
    if (moveRight !== 0) wishDirection.addScaledVector(side, -moveRight);

    const inputStrength = Math.min(1, wishDirection.length());
    const hasInput = inputStrength > 0;
    if (hasInput) wishDirection.normalize();

    const stanceSpeed = MOVE_TUNING.maxGroundSpeed * (1 - crouch * (1 - (config.crouchMultiplier ?? .34)));
    const maxSpeed = Math.min(stanceSpeed, keys.walking ? MOVE_TUNING.maxWalkSpeed : MOVE_TUNING.maxGroundSpeed) * inputStrength;
    const horizontalSpeed = Math.hypot(velocity.x, velocity.z);

    if (grounded) {
      const inputOpposesVelocity = hasInput && horizontalSpeed > 0.1 && velocity.dot(wishDirection) < -0.1;
      const frictionBoost = inputOpposesVelocity ? MOVE_TUNING.counterStrafeBoost : 1;
      const drop = Math.max(horizontalSpeed, MOVE_TUNING.stopSpeed) * MOVE_TUNING.friction * frictionBoost * delta;
      const newSpeed = Math.max(0, horizontalSpeed - drop);

      if (horizontalSpeed > 0) {
        velocity.x *= newSpeed / horizontalSpeed;
        velocity.z *= newSpeed / horizontalSpeed;
      }
    } else {
      velocity.x *= Math.max(0, 1 - config.airFriction * delta);
      velocity.z *= Math.max(0, 1 - config.airFriction * delta);
    }

    if (hasInput) {
      const acceleration = grounded ? MOVE_TUNING.groundAcceleration : MOVE_TUNING.airAcceleration;
      const currentSpeed = velocity.dot(wishDirection);
      const addSpeed = maxSpeed - currentSpeed;

      if (addSpeed > 0) {
        const accelSpeed = Math.min(acceleration * maxSpeed * delta, addSpeed);
        velocity.addScaledVector(wishDirection, accelSpeed);
      }
    }

    oldPosition.copy(camera.position);

    camera.position.x += velocity.x * delta;
    if (hitsWall(camera.position)) {
      camera.position.x = oldPosition.x;
      velocity.x = 0;
    }

    oldPosition.copy(camera.position);

    camera.position.z += velocity.z * delta;
    if (hitsWall(camera.position)) {
      camera.position.z = oldPosition.z;
      velocity.z = 0;
    }

    const oldBaseCameraY = baseCameraY;

    verticalVelocity -= config.gravity * delta;
    baseCameraY += verticalVelocity * delta;

    if (verticalVelocity > 0 && hitsCeiling(oldBaseCameraY, baseCameraY)) {
      verticalVelocity = 0;
    }

    groundY = getGroundY();

    if (groundY !== null) {
      const nextGroundCameraY = groundY + config.playerHeight;

      if (baseCameraY <= nextGroundCameraY && verticalVelocity <= 0) {
        baseCameraY = nextGroundCameraY;
        verticalVelocity = 0;
        canJump = true;
      } else {
        canJump = false;
      }
    } else {
      canJump = false;
    }

    const currentMoveSpeed = Math.hypot(velocity.x, velocity.z);
    inputState.moving = hasInput && currentMoveSpeed > 0.35;
    inputState.walking = keys.walking || inputState.crouched;
    inputState.grounded = canJump;
    inputState.speed01 = Math.min(currentMoveSpeed / config.playerSpeed, 1);

    if (inputState.moving && inputState.grounded) {
      const speedFactor = Math.max(0.45, inputState.speed01);
      const stepInterval = (inputState.walking ? MOVE_TUNING.stepWalkInterval : MOVE_TUNING.stepRunInterval) / speedFactor;

      stepTimer -= delta;

      if (stepTimer <= 0) {
        stepTimer = stepInterval;
        inputState.footstep = true;
        stepDip = MOVE_TUNING.stepDipAmount * inputState.speed01;
      }
    } else {
      stepTimer = 0;
    }

    updateCameraBob(delta);

    camera.position.y = baseCameraY - config.playerHeight + eyeHeight() + cameraBobOffset;

    camera.rotation.y -= cameraYawApplied;
    camera.rotation.y += cameraYawOffset;
    cameraYawApplied = cameraYawOffset;

    camera.rotation.z -= cameraRollApplied;
    camera.rotation.z += cameraRollOffset;
    cameraRollApplied = cameraRollOffset;
  }

  function hitsCeiling(fromY, toY) {
    const ceiling = ceilingY(fromY - config.playerHeight, toY - config.playerHeight + eyeHeight() + headClearance);
    if (ceiling === null) return false;
    baseCameraY = ceiling + config.playerHeight - eyeHeight() - headClearance - .005;
    return true;
  }

  function ceilingY(feet, top) {
    let nearest = null;
    const candidates = [];
    const samples = headSamples.map(([x, z]) => [camera.position.x + x, camera.position.z + z, candidates]);
    // Thin beams can fit between the radial rays. Add a ray through the
    // nearest part of each overlapping static collider's footprint; the mesh
    // intersection still decides clearance, not its bounding box alone.
    for (const collider of colliders) {
      let bounds = ceilingBounds.get(collider);
      if (!bounds) { bounds = new THREE.Box3().setFromObject(collider); ceilingBounds.set(collider, bounds); }
      if (bounds.max.y <= feet + .05 || bounds.min.y > top) continue;
      const x = THREE.MathUtils.clamp(camera.position.x, bounds.min.x + .0001, bounds.max.x - .0001);
      const z = THREE.MathUtils.clamp(camera.position.z, bounds.min.z + .0001, bounds.max.z - .0001);
      if (Math.hypot(x - camera.position.x, z - camera.position.z) > r) continue;
      candidates.push(collider);
      if (bounds.min.y > feet + .05) samples.push([x, z, [collider]]);
    }
    // Sample the whole head radius, including an overhang that misses the
    // centre ray. The ray starts below the head, never inside the ceiling.
    for (const [x, z, objects] of samples) {
      ceilingRayOrigin.set(x, feet + .05, z);
      ceilingRaycaster.set(ceilingRayOrigin, ceilingRayDirection);
      ceilingRaycaster.far = Math.max(0, top - feet - .05);
      for (const hit of ceilingRaycaster.intersectObjects(objects, true)) {
        if (!hit.face || hit.face.normal.clone().transformDirection(hit.object.matrixWorld).y > -.45) continue;
        nearest = nearest === null ? hit.point.y : Math.min(nearest, hit.point.y);
        break;
      }
    }
    return nearest;
  }

  function getGroundY() {
    groundRayOrigin.set(
      camera.position.x,
      baseCameraY - config.playerHeight + MOVE_TUNING.stepHeight + .02,
      camera.position.z
    );

    groundRaycaster.set(groundRayOrigin, groundRayDirection);
    groundRaycaster.far = MOVE_TUNING.groundRayLength;

    const hits = groundRaycaster.intersectObjects(colliders, true);

    for (const hit of hits) {
      if (!hit.face) continue;

      const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);

      if (normal.y < 0.45) continue;
      if (hit.point.y > baseCameraY - config.playerHeight + MOVE_TUNING.stepHeight) continue;

      return hit.point.y;
    }

    return null;
  }

  function hitsWall(position) {
    wallMove.copy(position).sub(oldPosition);
    wallMove.y = 0;

    const distance = wallMove.length();
    if (distance <= 0.0001) return false;

    const direction = wallMove.normalize();

    const feet = baseCameraY - config.playerHeight, height = eyeHeight();
    // A thin slab can fall between the horizontal wall rays. Its underside
    // must also clear the player's whole head before moving beneath it.
    if (ceilingY(feet, feet + height + headClearance - .005) !== null) return true;
    const rayHeights = [feet + .35, feet + height * .5, feet + height + headClearance - .02];

    for (const y of rayHeights) {
      wallRayOrigin.set(oldPosition.x, y, oldPosition.z);

      wallRaycaster.set(wallRayOrigin, direction);
      wallRaycaster.far = distance + MOVE_TUNING.playerRadius;

      const hits = wallRaycaster.intersectObjects(colliders, true);

      for (const hit of hits) {
        if (!hit.face) continue;

        const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);

        if (normal.y > 0.45) continue;

        return true;
      }
    }

    return false;
  }

  function updateCameraBob(delta) {
    const moving = inputState.moving && inputState.grounded;

    if (moving) {
      bobTime += delta * (inputState.walking ? 7.8 : 11.2) * Math.max(0.45, inputState.speed01);

      const bobAmount = inputState.walking ? MOVE_TUNING.walkBobAmount : MOVE_TUNING.runBobAmount;
      const rollAmount = inputState.walking ? MOVE_TUNING.walkRollAmount : MOVE_TUNING.runRollAmount;
      const yawAmount = inputState.walking ? 0.0007 : 0.0011;

      const baseBob = Math.abs(Math.sin(bobTime)) * bobAmount * inputState.speed01 - bobAmount * 0.45 * inputState.speed01;
      const subtleVertical = Math.sin(bobTime * 2) * (bobAmount * 0.35) * inputState.speed01;

      cameraBobOffset = baseBob + subtleVertical - stepDip;
      cameraRollOffset = Math.sin(bobTime) * rollAmount * inputState.speed01;
      cameraYawOffset = Math.sin(bobTime) * yawAmount * inputState.speed01;
    } else {
      cameraBobOffset = THREE.MathUtils.lerp(cameraBobOffset, 0, 1 - Math.exp(-16 * delta));
      cameraRollOffset = THREE.MathUtils.lerp(cameraRollOffset, 0, 1 - Math.exp(-16 * delta));
      cameraYawOffset = THREE.MathUtils.lerp(cameraYawOffset, 0, 1 - Math.exp(-16 * delta));
    }

    stepDip = THREE.MathUtils.lerp(stepDip, 0, 1 - Math.exp(-28 * delta));
  }

  return {
    velocity,
    inputState,
    // Network positions are stance-adjusted eye positions without camera bob.
    // Replicas and hitboxes subtract the same eye height to recover the feet.
    getPose() { return { p: [camera.position.x, baseCameraY - config.playerHeight + eyeHeight(), camera.position.z], yaw, pitch }; },
    getMotion() { return { velocity: [velocity.x, verticalVelocity, velocity.z],
      grounded: inputState.grounded, walking: inputState.walking, crouch }; },

    onKeyDown,
    onKeyUp,
    onMouseDown,
    onMouseUp,
    onMouseMove,
    addLookDelta,
    setTouchMove,
    setFiring,
    queueJump,
    toggleCrouch,
    clearMovement,
    reset,
    update
  };
}
