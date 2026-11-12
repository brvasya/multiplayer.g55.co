export const PISTOL = {
holdType: "pistol",
name: "Pistol",
attachment: "5",
attachmentRotation: [0, Math.PI/2, 0],
muzzleFlash: "1",
shellEject: "2",
behavior: {
magazineSize: 12,
damage: 25,
fireCooldownMs: 200,
reloadSpeed: 1,
pellets: 1,
spread: 0.025,
},
anim: {
deploy: "draw",
idle: "idle",
shoot: "fire",
reload: "reload_empty"
},
model: "./assets/pistol/c_iw5_usp.mdl",
fireSound: "./assets/pistol/c_iw5_usp.ogg"
};
