export const SNIPER = {
holdType: "ar2",
name: "Sniper Rifle",
attachment: "3",
attachmentRotation: [0, Math.PI/2, 0],
muzzleFlash: "1",
shellEject: "2",
behavior: {
magazineSize: 5,
damage: 100,
fireCooldownMs: 1000,
reloadSpeed: 1,
pellets: 1,
spread: 0,
isSniper: true,
zoomFov: 10
},
anim: {
deploy: "draw",
idle: "idle",
shoot: ["fire", "bolt"],
reload: "reload_empty"
},
model: "./assets/sniper/c_iw5_l96a1.mdl",
fireSound: "./assets/sniper/c_iw5_l96a1.ogg"
};
