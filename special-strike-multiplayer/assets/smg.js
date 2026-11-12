export const SMG = {
holdType: "smg",
name: "SMG",
attachment: "5",
attachmentRotation: [0, Math.PI/2, 0],
muzzleFlash: "1",
shellEject: "2",
behavior: {
magazineSize: 50,
damage: 25,
fireCooldownMs: 90,
reloadSpeed: 1,
pellets: 1,
spread: 0.05,
},
anim: {
deploy: "draw",
idle: "idle",
shoot: "fire",
reload: "reload_empty"
},
model: "./assets/smg/c_iw5_p90.mdl",
fireSound: "./assets/smg/c_iw5_p90.ogg"
};
