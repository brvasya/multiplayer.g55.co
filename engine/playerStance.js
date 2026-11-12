// Position packets carry eye position. Derive feet and combat bounds from the
// same stance used by the local camera; crouching must never move the feet.
export const CROUCH_HEIGHT_RATIO = 1 / 1.75;

export function crouchAmount(motion) {
  return Number.isFinite(motion?.crouch) ? Math.max(0, Math.min(1, motion.crouch)) : 0;
}

export function playerEyeHeight(motion, config) {
  const standing = config.playerHeight;
  const crouching = config.crouchHeight ?? standing * CROUCH_HEIGHT_RATIO;
  return standing + (crouching - standing) * crouchAmount(motion);
}
