export const SOLDIER = {
animations: "./assets/anim/m_anm.mdl",
animationSource: { ani: "./assets/anim/m_anm.ani" },
models: ["./assets/player1/fbi_pm.mdl"],
poseParameters: { move_x: 1, move_y: 0, aim_yaw: 0, aim_pitch: 0 },
weaponBone: "ValveBiped.Bip01_R_Hand",
weaponRotation: [-Math.PI/2, Math.PI/2, 0],
weaponScale: 1,
previewAnimation: "idle_all_01",
playerAnimation: {
defaultHoldType: "ar2",
upperBodyBone: "ValveBiped.Bip01_Spine",
walkSpeed: 4.675,
runSpeed: 8.5,
jumpSpeed: 10,
transitionSeconds: 0.12
},
};
