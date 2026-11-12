export const RIFLE = {
holdType: "ar2",
name: "Assault Rifle",
attachment: "3",
attachmentRotation: [0, Math.PI/2, 0],
muzzleFlash: "1",
shellEject: "2",
behavior: {
magazineSize: 30,
damage: 35,
fireCooldownMs: 120,
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
model: "./assets/rifle/c_iw5_m16a4.mdl",
fireSound: "./assets/rifle/c_iw5_m16a4.ogg"
};
