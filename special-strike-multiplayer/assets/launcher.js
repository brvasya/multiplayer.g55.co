export const LAUNCHER = {
holdType: "shotgun",
name: "Grenade Launcher",
attachment: "1",
attachmentRotation: [0, Math.PI/2, 0],
muzzleFlash: "1",
shellEject: "",
behavior: {
magazineSize: 1,
damage: 200,
fireCooldownMs: 1000,
reloadSpeed: 1,
pellets: 1,
spread: 0,
projectile: "grenade"
},
anim: {
deploy: "draw",
idle: "idle",
shoot: "fire",
reload: "reload"
},
model: "./assets/launcher/c_iw4_thumper.mdl",
fireSound: "./assets/launcher/c_iw4_thumper.ogg"
};
