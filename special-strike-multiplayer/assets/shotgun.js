export const SHOTGUN = {
holdType: "shotgun",
name: "Shotgun",
attachment: "3",
attachmentRotation: [0, Math.PI/2, 0],
muzzleFlash: "1",
shellEject: "2",
behavior: {
magazineSize: 8,
damage: 25,
fireCooldownMs: 1000,
reloadSpeed: 1,
pellets: 6,
spread: 0.1,
},
anim: {
deploy: "draw",
idle: "idle",
shoot: ["fire", "pump"],
reload: ["reload_start", "reload", "reload_end"]
},
model: "./assets/shotgun/c_iw5_spas12.mdl",
fireSound: "./assets/shotgun/c_iw5_spas12.ogg"
};
