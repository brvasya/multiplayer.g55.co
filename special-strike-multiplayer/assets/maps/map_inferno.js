// de_inferno-inspired Mediterranean village. Procedural geometry/textures only.
// Ground-level adaptation: Banana, Mid, Second Mid, Apartments, A/B and CT loop.
export const WORLD_SETTINGS = {
  seed: 19991105, size: 96, spawn: [0, 1.75, 37], spawnYaw: 0,
  sky: { top: 0x659ac5, mid: 0xb4d2e2, horizon: 0xf0e7d2,
    fogColor: 0xd1dbd9, fogNear: 65, fogFar: 185 },
  lighting: {
    hemisphereSky: 0xcde3f2, hemisphereGround: 0x9b8061, hemisphereIntensity: 1.6,
    sunColor: 0xffe4ba, sunIntensity: 2.65, sunPosition: [-32, 55, 25]
  }
};

export function createWorld({ THREE, scene }) {
  const root = new THREE.Group(); root.name = "Inferno"; scene.add(root);
  const colliders = [], floorObjects = [];
  const obstacles = [], batches = new Map(), random = mulberry32(WORLD_SETTINGS.seed);
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const planeGeo = new THREE.PlaneGeometry(1, 1);
  const cylinderGeo = new THREE.CylinderGeometry(1, 1, 1, 12);
  const leafGeo = new THREE.IcosahedronGeometry(1,0), treeGeo = new THREE.IcosahedronGeometry(1,1);
  const gableGeo = new THREE.BufferGeometry();
  gableGeo.setAttribute("position",new THREE.Float32BufferAttribute([-.5,0,.5,.5,0,.5,0,1,.5,.5,0,-.5,-.5,0,-.5,0,1,-.5],3));
  gableGeo.setAttribute("uv",new THREE.Float32BufferAttribute([0,0,1,0,.5,1,0,0,1,0,.5,1],2));gableGeo.computeVertexNormals();
  const temp = new THREE.Object3D();
  const hiddenMaterial = new THREE.MeshBasicMaterial({ visible: false });
  const mat = {
    plaster: standard(0xd6c7a6), ochre: standard(0xc8a16a), peach: standard(0xc69278),
    cream: standard(0xe2d9be), rose: standard(0xbb8071), faded: standard(0xb7b9a6),
    stone: standard(0xbab099), lightStone: standard(0xd6c9ad), darkStone: standard(0x8f8977),
    cobble: standard(0xaca697), paving: standard(0xc6b99e), roof: standard(0x9a5035),
    roofLight: standard(0xb56947), roofDark: standard(0x7e4634), wood: standard(0x8c7150),
    woodLight: standard(0xa18a64), woodDark: standard(0x594d3b), iron: standard(0x3c4540),
    shutter: standard(0x596e5b), shutterLight: standard(0x70816c), glass: standard(0x354952),
    blue: standard(0x567c90), blueDark: standard(0x3c606f), sandbag: standard(0xb5a47c),
    foliage: standard(0x697c47), foliageLight: standard(0x87935a), soil: standard(0x796849),
    water: standard(0x729c97, { roughness: 0.23, metalness: 0.22 }),
    white: standard(0xe4dcc6), red: standard(0xa45138), brass: standard(0x8e7a44),
    skyHill: standard(0x9aa99b), hill: standard(0x7f9582)
  };
  // Authored footprints. Every solid mass is shared by collision and navigation.
  const buildings = [
    [-43,-28,6,36,8.0,"stone","B west wall"],
    [-26,-42,28,8,8.4,"cream","B cloister"],
    [-3,-42,18,8,7.1,"faded","CT houses"],
    [14,-42,16,8,9.1,"peach","CT apartments"],
    [34,-42,24,8,9.8,"cream","Church rear"],
    [34,-33.5,24,9,9.8,"cream","Church nave"],
    [44,-9.5,4,39,5.4,"stone","A garden wall"],
    [43,24,6,28,9.4,"ochre","East apartments"],
    [31,42,30,8,8.2,"peach","Second mid end houses"],
    [-37,-3,18,14,7.7,"ochre","Banana upper houses"],
    [-33.5,18.5,25,29,9.1,"peach","Banana bend houses"],
    [-29,39.5,34,13,7.6,"plaster","T west houses"],
    [-7,12,10,30,8.4,"ochre","Mid west houses"],
    [-10.5,-13,17,20,10.2,"rose","Banana east block"],
    [-7.5,-27,25,8,7.2,"faded","B and CT divider"],
    [16,-34,12,8,7.8,"ochre","Library"],
    [13,-11,10,14,8.8,"cream","Top mid corner"],
    [12,19,8,20,9.1,"peach","Second mid west houses"],
    [31,27,8,16,7.6,"faded","Second mid residence"],
    [24,8.5,6,9,9.2,"rose","Apartments west wing"],
    [36,8.5,8,9,9.2,"plaster","Apartments east wing"]
  ];
  const world = {
    map: root, colliders, floorObjects,
    isLoaded: false, spawn: new THREE.Vector3(...WORLD_SETTINGS.spawn),
    lighting: WORLD_SETTINGS.lighting, ready: null, navigation: null,
    resetPlayer
  };
  createSky(); createGround(); createStructures(); createCover();
  createTextures(); dressArchitecture(); createLandmarks(); createVillageDetails(); createBackdrop();
  flushBatches(); root.updateMatrixWorld(true);
  world.navigation = createNavigation();
  world.isLoaded = true; world.ready = Promise.resolve(world);
  return world;

  function standard(color, extra = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.94, metalness: 0, ...extra });
  }
  function instance(geo, material, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0, shadow = true) {
    // Local batches preserve useful culling when moving between the narrow lanes.
    const key = geo.uuid + material.uuid + ":" + Math.floor((x+48) / 48) + ":" + Math.floor((z+48) / 48) + ":" + shadow;
    if (!batches.has(key)) batches.set(key, { geo, material, shadow, matrices: [] });
    temp.position.set(x,y,z); temp.rotation.set(rx,ry,rz); temp.scale.set(sx,sy,sz); temp.updateMatrix();
    batches.get(key).matrices.push(temp.matrix.clone());
  }
  function box(x,y,z,w,h,d,material,yaw=0,solid=false,name="Village solid",shadow=true) {
    instance(boxGeo,material,x,y,z,w,h,d,0,yaw,0,shadow);
    if (solid) collider(x,y,z,w,h,d,yaw,name);
  }
  function collider(x,y,z,w,h,d,yaw=0,name="Village collision",navigationBlock=true) {
    const mesh = new THREE.Mesh(boxGeo,hiddenMaterial);
    mesh.name=name; mesh.position.set(x,y,z); mesh.rotation.y=yaw; mesh.scale.set(w,h,d);
    root.add(mesh); colliders.push(mesh);
    if(navigationBlock) obstacles.push({x,z,halfW:w/2,halfD:d/2,cos:Math.cos(yaw),sin:Math.sin(yaw)});
    return mesh;
  }
  function groundPlane(w,d,x,z,material,y=0.016,angle=0) {
    instance(planeGeo,material,x,y,z,w,d,1,-Math.PI/2,0,angle,false);
  }
  function cylinder(x,y,z,radius,height,material,rx=0,ry=0,rz=0,shadow=true) {
    instance(cylinderGeo,material,x,y,z,radius,height,radius,rx,ry,rz,shadow);
  }
  function solidCylinder(x,y,z,radius,height,material,name,navigationBlock=false) {
    cylinder(x,y,z,radius,height,material);
    const mesh=new THREE.Mesh(cylinderGeo,hiddenMaterial);
    mesh.name=name;mesh.position.set(x,y,z);mesh.scale.set(radius,height,radius);
    root.add(mesh);colliders.push(mesh);
    // Movement keeps the established conservative footprint; shots use the round surface.
    if(navigationBlock)obstacles.push({x,z,halfW:radius,halfD:radius,cos:1,sin:0});
    return mesh;
  }
  function localPosition(x,z,yaw,lx,lz) {
    return [x+Math.cos(yaw)*lx+Math.sin(yaw)*lz,z-Math.sin(yaw)*lx+Math.cos(yaw)*lz];
  }
  function localBox(x,z,yaw,lx,y,lz,w,h,d,material,shadow=true) {
    const p=localPosition(x,z,yaw,lx,lz); box(p[0],y,p[1],w,h,d,material,yaw,false,"Facade",shadow);
  }
  function flushBatches() {
    for (const {geo,material,shadow,matrices} of batches.values()) {
      const mesh=new THREE.InstancedMesh(geo,material,matrices.length);
      matrices.forEach((m,i)=>mesh.setMatrixAt(i,m)); mesh.instanceMatrix.needsUpdate=true;
      mesh.computeBoundingSphere(); mesh.name="Inferno static details";
      mesh.castShadow=shadow&&!material.isMeshBasicMaterial;
      mesh.receiveShadow=!material.isMeshBasicMaterial; root.add(mesh);
    }
    batches.clear();
  }
  function createGround() {
    const ground=new THREE.Mesh(new THREE.PlaneGeometry(96,96),mat.cobble);
    ground.name="G55FLR_InfernoVillage"; ground.rotation.x=-Math.PI/2; ground.receiveShadow=true;
    root.add(ground);colliders.push(ground);floorObjects.push(ground);
    // Shallow visual paving shares the same y=0 movement and spawn surface.
    groundPlane(26,23,-27,-26.5,mat.paving);
    groundPlane(24,33,30,-12.5,mat.paving);
    groundPlane(27,14,1.5,38,mat.paving);
    groundPlane(5,9,29.5,8.5,mat.paving);
    for(const x of [-46.8,46.8]) box(x,2,0,1.2,4,96,mat.stone,0,true,"Village boundary");
    for(const z of [-46.8,46.8]) box(0,2,z,96,4,1.2,mat.stone,0,true,"Village boundary");
  }
  function createStructures() {
    for(const [x,z,w,d,h,m,name] of buildings) box(x,h/2,z,w,h,d,mat[m],0,true,name);
    // The apartment passage has separate wings and a real open ground arcade.
    box(29.5,6.4,8.5,5,5.6,9,mat.plaster);
    collider(29.5,6.4,8.5,5,5.6,9,0,"Apartments overhead",false);
    // Arch posts and lintel: no oversized collider spanning the opening.
    for(const x of [6,19]) box(x,2.6,-25.8,1.6,5.2,2.2,mat.lightStone,0,true,"Arch pillar");
    box(12.5,5.6,-25.8,14.6,1.2,2.2,mat.lightStone);
    collider(12.5,5.6,-25.8,14.6,1.2,2.2,0,"Arch lintel",false);
    // A level underpass links Mid and Second Mid, with a separate overhead slab.
    box(12.5,4.9,6.5,9,1.8,4.8,mat.peach);
    collider(12.5,4.9,6.5,9,1.8,4.8,0,"Mid passage overhead",false);
  }
  function createCover() {
    // Square rim and water share one exact, solid fountain basin footprint.
    collider(-29,0.48,-25,4.8,0.96,4.8,0,"B fountain basin");
    box(-29,0.2,-25,4.8,0.4,4.8,mat.darkStone);
    for(const side of [-1,1]) {
      box(-29+side*2.14,0.65,-25,.52,.62,4.8,mat.lightStone);
      box(-29,0.65,-25+side*2.14,3.76,.62,.52,mat.lightStone);
      box(-29+side*2.14,.94,-25,.59,.12,4.8,mat.cream);
      box(-29,.94,-25+side*2.14,3.62,.12,.59,mat.cream);
    }
    groundPlane(3.75,3.75,-29,-25,mat.water,.72);
    solidCylinder(-29,.95,-25,.62,.5,mat.stone,"Fountain pedestal base");
    solidCylinder(-29,1.7,-25,.26,1.6,mat.lightStone,"Fountain stem");
    solidCylinder(-29,1.85,-25,1.02,.22,mat.lightStone,"Fountain lower bowl");
    cylinder(-29,1.98,-25,.83,.05,mat.water);
    solidCylinder(-29,2.55,-25,.55,.18,mat.lightStone,"Fountain upper bowl");
    solidCylinder(-29,2.95,-25,.17,.65,mat.brass,"Fountain spout");
    // Repeated blue storage drums are solid individual cylinders with tight boxes.
    for(const x of [-37.35,-36,-34.65]) for(const z of [-34.7,-33.3]) {
      barrel(x,z,.60,1.32,mat.blue,0,"B blue barrel");
      if(x!==-34.65) barrel(x,z,.60,1.32,mat.blue,1.32,"B upper barrel");
    }
    crate(-23,-33.5,3.4,2.6,2.6,0,"B new box");
    crate(-37,-17.5,3,1.8,2.6,0,"B dark crate");
    box(-17.8,.6,-34.5,3.8,1.2,1.7,mat.stone,0,true,"B coffins");
    for(const x of [-18.8,-16.8]) {
      box(x,1.23,-34.5,1.82,.15,1.85,mat.lightStone);
      box(x,1.32,-34.5,.12,.03,.9,mat.darkStone);
      box(x,1.32,-34.7,.65,.03,.12,mat.darkStone);
    }
    collider(-20,.65,19,1.6,1.3,4,0,"Banana logs");
    for(let row=0;row<3;row++)for(let col=0;col<3-row;col++) {
      const x=-20.5+col*.48+row*.24,y=.25+row*.42;
      cylinder(x,y,19,.235,4,mat.woodDark,Math.PI/2);
      cylinder(x,y,21.015,.20,.028,mat.woodLight,Math.PI/2,0,0,false);
      cylinder(x,y,16.985,.20,.028,mat.woodLight,Math.PI/2,0,0,false);
    }
    collider(-26.1,.65,-1.5,2.8,1.3,1.6,0,"Banana sandbags");
    for(let row=0;row<3;row++)for(let col=0;col<3;col++)for(const dz of [-.38,.38])
      box(-27.02+col*.89+(row%2)*.08,.22+row*.4,-1.5+dz,.88,.42,.77,mat.sandbag);
    crate(30,-16,4,2.2,3.5,0,"A default crates");
    crate(30.9,-16,2.2,1.4,2.8,2.2,"A stacked crate");
    crate(37,-23.2,3.2,2.2,2.8,0,"A back-site crate");
    box(24,.75,-5.5,2.8,1.5,2.5,mat.sandbag,0,true,"A hay cover");
    for(const x of [23.1,24.9])box(x,.78,-5.5,.07,1.54,2.54,mat.woodDark,0,false,"Hay straps",false);
    box(38,0.6,2.6,7,1.2,0.6,mat.stone,0,true,"Pit front wall");
    box(41.2,0.6,-0.9,0.6,1.2,7.6,mat.stone,0,true,"Pit east wall");
    box(38,1.25,2.6,7.1,.14,.75,mat.lightStone,0,true,"Pit front coping");
    box(41.2,1.25,-.9,.75,.14,7.7,mat.lightStone,0,true,"Pit east coping");
    crate(33,16,2.3,1.4,2.4,0,"Second mid crates");
    for(const x of [10.45,11.55])barrel(x,40,.51,1.3,mat.wood,0,"T wine barrel");
  }
  function crate(x,z,w,h,d,base,name) {
    box(x,base+h/2,z,w,h,d,mat.wood,0,true,name);
    for(const side of [-1,1]) {
      for(const dx of [-w/2+.13,w/2-.13])box(x+dx,base+h/2,z+side*(d/2+.025),.18,h,.09,mat.woodLight);
      for(const y of [.16,h-.16])box(x,base+y,z+side*(d/2+.05),w,.18,.09,mat.woodLight);
      for(const y of [.16,h-.16])box(x+side*(w/2+.035),base+y,z,.09,.18,d,mat.woodLight);
      for(let k=1;k<Math.ceil(w/.48);k++)box(x-w/2+k*w/Math.ceil(w/.48),base+h/2,z+side*(d/2+.011),.018,h-.24,.025,mat.woodDark,0,false,"Plank joint",false);
      instance(boxGeo,mat.woodLight,x,base+h/2,z+side*(d/2+.09),Math.hypot(w-.4,h-.4),.15,.09,0,0,Math.atan2(h-.4,w-.4));
    }
    for(const dx of [-w*.32,w*.32])box(x+dx,base+h+.035,z,.14,.07,d,mat.woodLight);
  }
  function barrel(x,z,r,h,material,base=0,name="Storage barrel") {
    solidCylinder(x,base+h/2,z,r,h,material,name,base<.5);
    for(const y of [.12,h*.5,h-.12])cylinder(x,base+y,z,r+.025,.065,mat.iron);
    cylinder(x,base+h+.009,z,r*.9,.035,material);
  }
  function canvasTexture(width,height,draw) {
    const canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;
    draw(canvas.getContext("2d"),width,height);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    texture.anisotropy=4;return texture;
  }
  function createTextures() {
    function surface(kind) {
      const t=canvasTexture(512,512,(ctx,w,h)=>{
        ctx.fillStyle=kind==="cobble"?"#7c7b73":"#d3d0c5";ctx.fillRect(0,0,w,h);
        if(kind==="cobble"||kind==="stone"||kind==="paving") {
          const row=kind==="cobble"?32:kind==="paving"?128:64;
          const col=kind==="cobble"?64:kind==="paving"?128:128;
          for(let y=0;y<h;y+=row)for(let x=-col;x<w+col;x+=col) {
            const xx=x+((y/row)%2)*col*.5,v=kind==="cobble"?173+random()*45:196+random()*30;
            ctx.fillStyle=`rgb(${v},${v-2},${v-7})`;ctx.fillRect(xx+2,y+2,col-4,row-4);
            ctx.fillStyle="rgba(255,255,255,.17)";ctx.fillRect(xx+3,y+3,col-6,2);
            ctx.fillStyle="rgba(55,48,36,.12)";ctx.fillRect(xx+3,y+row-4,col-6,2);
          }
        } else if(kind==="roof") {
          ctx.fillStyle="#c3b3a6";ctx.fillRect(0,0,w,h);
          for(let y=0;y<h;y+=64)for(let x=0;x<w;x+=32) {
            const g=ctx.createLinearGradient(x,0,x+32,0);
            g.addColorStop(0,"#8f8175");g.addColorStop(.3,"#eddfcf");g.addColorStop(.75,"#c6b4a1");g.addColorStop(1,"#998577");
            ctx.fillStyle=g;ctx.fillRect(x+1,y+1,30,62);
            ctx.fillStyle="rgba(60,42,27,.25)";ctx.fillRect(x,y+60,32,4);
          }
        } else if(kind==="wood") {
          ctx.fillStyle="#d7cbb5";ctx.fillRect(0,0,w,h);
          for(let i=0;i<170;i++) {
            const x=random()*w;ctx.strokeStyle=`rgba(75,57,32,${.04+random()*.13})`;
            ctx.beginPath();ctx.moveTo(x,0);ctx.bezierCurveTo(x+12,170,x-8,310,x+4,h);ctx.stroke();
          }
        } else {
          ctx.fillStyle="#e4e0d5";ctx.fillRect(0,0,w,h);
          for(let i=0;i<100;i++) {
            const x=random()*w,y=random()*h,r=12+random()*70;
            const g=ctx.createRadialGradient(x,y,0,x,y,r);
            g.addColorStop(0,"rgba(102,88,66,.055)");g.addColorStop(1,"rgba(102,88,66,0)");
            ctx.fillStyle=g;ctx.fillRect(x-r,y-r,r*2,r*2);
          }
        }
        const pixels=ctx.getImageData(0,0,w,h);
        for(let i=0;i<pixels.data.length;i+=4){const noise=(random()-.5)*15;
          pixels.data[i]+=noise;pixels.data[i+1]+=noise;pixels.data[i+2]+=noise;}
        ctx.putImageData(pixels,0,0);
      });
      t.wrapS=t.wrapT=THREE.RepeatWrapping;
      t.repeat.set(kind==="cobble"?30:kind==="paving"?8:kind==="roof"?3:2,kind==="cobble"?30:kind==="paving"?8:kind==="roof"?5:2);
      return t;
    }
    const plaster=surface("plaster"),stone=surface("stone"),wood=surface("wood"),roof=surface("roof");
    for(const key of ["plaster","ochre","peach","cream","rose","faded"])mat[key].map=plaster;
    for(const key of ["stone","lightStone","darkStone"])mat[key].map=stone;
    for(const key of ["wood","woodLight","woodDark"])mat[key].map=wood;
    for(const key of ["roof","roofLight","roofDark"])mat[key].map=roof;
    mat.cobble.map=surface("cobble");mat.paving.map=surface("paving");
    mat.shutter.map=canvasTexture(128,256,(c,w,h)=>{
      c.fillStyle="#dedfd0";c.fillRect(0,0,w,h);
      for(let y=10;y<h;y+=14){c.fillStyle="#7c8573";c.fillRect(7,y,w-14,3);c.fillStyle="#f1eee0";c.fillRect(7,y+3,w-14,2);}
      c.strokeStyle="#929d88";c.lineWidth=7;c.strokeRect(4,4,w-8,h-8);
    });
    mat.shutterLight.map=mat.shutter.map;
    // A mild bump map makes the ground readable without costly paving geometry.
    mat.cobble.bumpMap=mat.cobble.map;mat.cobble.bumpScale=.11;
    mat.paving.bumpMap=mat.paving.map;mat.paving.bumpScale=.055;
  }
  function dressArchitecture() {
    const exposed=[
      [1],[0],[0],[0],[0],[0,3],[3],[3],[2],
      [0,1],[0,1],[1,2],[0,1,2,3],[0,1,2,3],[0,2,3],[0,1,3],
      [0,1,2,3],[0,1,2,3],[0,2,3],[0,1,2,3],[0,2,3]
    ];
    buildings.forEach(([x,z,w,d,h,m,name],index)=>{
      if(name==="A garden wall") {
        box(x,h+.07,z,w+.1,.22,d+.14,mat.lightStone);
        for(let zz=z-d/2+1;zz<z+d/2;zz+=6)box(x-w/2-.07,h/2,zz,.22,h,.52,mat.lightStone);
        return;
      }
      box(x,.25,z,w+.07,.5,d+.07,mat.stone);
      box(x,h-.16,z,w+.18,.26,d+.18,mat.lightStone);
      if(h>7.7)box(x,3.9,z,w+.085,.16,d+.085,mat.lightStone);
      const sections=Math.ceil(w/13);
      for(let i=0;i<sections;i++)roof(x-w/2+(i+.5)*w/sections,z,w/sections,d,h,mat[m],index%3?mat.roof:mat.roofLight);
      for(const side of exposed[index]) {
        const yaw=side*Math.PI/2,width=side%2?d:w,depth=side%2?w:d;
        if(name==="Church nave"&&side===0)continue;
        const count=Math.max(1,Math.floor(width/3.8));
        for(let i=0;i<count;i++) {
          const lx=-width/2+(i+.5)*width/count;
          if(name!=="B cloister"||side!==0) {
            if(i===Math.floor(count/2)&&side===exposed[index][0])closedDoor(x,z,yaw,lx,depth/2+.02,1.45,2.8,index);
            else facadeWindow(x,z,yaw,lx,2.15,depth/2,1.05,1.6,index+i,false);
          }
          for(let y=5.4;y<h-1.2;y+=3.1)facadeWindow(x,z,yaw,lx,y,depth/2,1.12,1.85,index+i,true);
        }
        // Drainpipes sit against the solid facade; no small collision snags.
        localBox(x,z,yaw,-width/2+.32,h/2,depth/2+.11,.085,h,.085,mat.iron,false);
        if(index%3===0) {
          const p=localPosition(x,z,yaw,-width/2+1.1,depth/2+.35);lantern(p[0],3.2,p[1],yaw);
        }
      }
    });
    // The apartment bridge visually belongs to both wings, above a clear passage.
    roof(29.5,8.5,5,9,9.2,mat.plaster,mat.roof);
    box(29.5,9.07,8.5,5.15,.26,9.15,mat.lightStone);
    for(const z of [3.96,13.04]) {
      const yaw=z<8.5?Math.PI:0;
      facadeWindow(29.5,z,yaw,0,7.2,0,1.25,1.9,1,true);
      arch(29.5,z,yaw,5,2.5,1.1,.38,mat.lightStone);
    }
    balcony(29.5,4.2,3.6,5.8,Math.PI);
    balcony(-1.9,4.2,18.3,4.1,Math.PI/2);
    balcony(27,4.2,27.5,3.9,-Math.PI/2);
    arch(12.5,-25.8,0,11.4,3.05,1.95,2.25,mat.lightStone);
    for(const x of [6,19]) {
      box(x,.18,-25.8,1.85,.36,2.4,mat.stone);
      box(x,3.07,-25.8,1.85,.25,2.4,mat.lightStone);
      for(let y=.8;y<3;y+=.5)box(x,y,-24.68,1.62,.035,.025,mat.darkStone,0,false,"Arch joint",false);
    }
    roof(12.5,-25.8,14.6,2.2,6.2,mat.lightStone,mat.roofDark);
    for(const x of [8.05,16.95])arch(x,6.5,Math.PI/2,4.8,2.6,1.4,.3,mat.lightStone);
    for(const x of [8.2,16.8])box(x,1.55,4.25,.42,3.1,.5,mat.lightStone,0,true,"Crossover column");
  }
  function roof(x,z,w,d,y,body,material) {
    const rise=Math.min(2.55,w*.28),angle=Math.atan2(rise,w/2),length=Math.hypot(w/2,rise)+.35;
    for(const side of [-1,1])instance(boxGeo,material,x+side*w/4,y+rise/2,z,length,.16,d+.65,0,0,-side*angle);
    box(x,y-.08,z,w+.55,.24,d+.55,mat.woodDark);
    cylinder(x,y+rise+.1,z,.14,d+.62,material,Math.PI/2);
    instance(gableGeo,body,x,y,z,w,rise,d);
    const mesh=new THREE.Mesh(gableGeo,hiddenMaterial);mesh.position.set(x,y,z);mesh.scale.set(w,rise,d);root.add(mesh);
    // Shot geometry follows the pitched roof rather than an invisible large box.
    colliders.push(mesh);
    for(const side of [-1,1]) {
      const panel=collider(x+side*w/4,y+rise/2,z,length,.16,d+.65,0,"Roof slope",false);
      panel.rotation.z=-side*angle;
    }
    if(w>6&&d>6) {
      const cx=x+w*.22,cz=z+d*.2;
      // Seat the whole chimney footprint in its roof slope, not at ridge height.
      const base=y+rise*(.56-.72/w)-.12;
      box(cx,base+.65,cz,.72,1.3,.85,mat.stone);
      collider(cx,base+.65,cz,.72,1.3,.85,0,"Chimney",false);
      box(cx,base+1.33,cz,.91,.14,1.02,mat.roofDark);
      box(cx,base+1.44,cz,.48,.1,.6,mat.iron);
    }
  }
  function facadeWindow(x,z,yaw,lx,y,depth,w,h,index,shutters) {
    localBox(x,z,yaw,lx,y,depth+.045,w+.25,h+.25,.11,mat.lightStone,false);
    localBox(x,z,yaw,lx,y,depth+.115,w,h,.06,mat.woodDark,false);
    localBox(x,z,yaw,lx,y,depth+.155,w-.16,h-.16,.035,mat.glass,false);
    localBox(x,z,yaw,lx,y,depth+.18,.055,h-.13,.045,mat.woodLight,false);
    localBox(x,z,yaw,lx,y-.08,depth+.18,w-.13,.055,.045,mat.woodLight,false);
    localBox(x,z,yaw,lx,y-h/2-.13,depth+.17,w+.4,.15,.36,mat.lightStone);
    if(shutters)for(const side of [-1,1])localBox(x,z,yaw,lx+side*(w*.75+.08),y,depth+.10,w*.48,h+.05,.09,index%3?mat.shutter:mat.shutterLight,false);
    if(shutters&&index%5===0) {
      localBox(x,z,yaw,lx,y-h/2+.07,depth+.34,w+.12,.29,.36,mat.roofDark);
      for(let i=0;i<4;i++)localBox(x,z,yaw,lx-w*.36+i*w*.24,y-h/2+.3,depth+.35,.25,.22,.3,mat.foliage,false);
    }
  }
  function closedDoor(x,z,yaw,lx,depth,w,h,index) {
    localBox(x,z,yaw,lx,h/2,depth+.025,w+.28,h+.16,.13,mat.lightStone,false);
    localBox(x,z,yaw,lx,h/2,depth+.105,w,h,.08,index%3?mat.woodDark:mat.shutter,false);
    for(const dx of [-w*.25,w*.25])for(const y of [.67,1.82])localBox(x,z,yaw,lx+dx,y,depth+.158,w*.35,.86,.04,mat.wood,false);
    localBox(x,z,yaw,lx+w*.15,1.16,depth+.19,.065,.23,.06,mat.brass,false);
  }
  function balcony(x,y,z,w,yaw) {
    localBox(x,z,yaw,0,y,.25,w,.18,1.0,mat.lightStone);
    for(const height of [.2,1.03])localBox(x,z,yaw,0,y+height,.72,w,.055,.055,mat.iron);
    for(let k=0;k<=Math.floor(w/.31);k++)localBox(x,z,yaw,-w/2+k*w/Math.floor(w/.31),y+.58,.72,.035,.91,.035,mat.iron);
    for(const side of [-1,1]) {
      localBox(x,z,yaw,side*w/2,y+.58,.31,.045,.91,.85,mat.iron);
      localBox(x,z,yaw,side*w*.3,y-.25,.12,.13,.4,.5,mat.iron);
    }
    // This balcony is decoration above the ground-only navigation space.
  }
  function arch(x,z,yaw,width,spring,rise,depth,material) {
    const shape=new THREE.Shape(),r=width/2,thickness=.35,segments=24;
    shape.moveTo(r,spring);
    for(let i=1;i<=segments;i++){const a=i*Math.PI/segments;shape.lineTo(Math.cos(a)*r,spring+Math.sin(a)*rise);}
    shape.lineTo(-r-thickness,spring);
    for(let i=segments-1;i>=0;i--){const a=i*Math.PI/segments;shape.lineTo(Math.cos(a)*(r+thickness),spring+Math.sin(a)*(rise+thickness));}
    shape.closePath();
    const geometry=new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:false,curveSegments:1});geometry.translate(0,0,-depth/2);
    const mesh=new THREE.Mesh(geometry,material);mesh.position.set(x,0,z);mesh.rotation.y=yaw;
    mesh.castShadow=true;mesh.receiveShadow=true;mesh.name="Open masonry arch";root.add(mesh);colliders.push(mesh);
  }
  function lantern(x,y,z,yaw=0) {
    localBox(x,z,yaw,0,y+.25,-.13,.055,.55,.55,mat.iron);
    localBox(x,z,yaw,0,y,0,.3,.45,.28,mat.brass,false);
    for(const dx of [-.15,.15])localBox(x,z,yaw,dx,y,.17,.035,.5,.035,mat.iron,false);
    for(const yy of [-.24,.24])localBox(x,z,yaw,0,y+yy,0,.39,.06,.36,mat.iron,false);
  }
  function decal(texture,x,y,z,w,h,yaw=0,ground=false) {
    const material=new THREE.MeshStandardMaterial({map:texture,transparent:true,alphaTest:.06,roughness:1,depthWrite:false,side:THREE.DoubleSide});
    const mesh=new THREE.Mesh(planeGeo,material);mesh.position.set(x,y,z);
    mesh.rotation.set(ground?-Math.PI/2:0,yaw,0);mesh.scale.set(w,h,1);
    mesh.receiveShadow=true;root.add(mesh);return mesh;
  }
  function inscription(text,x,y,z,w,h,yaw=0,paint=false) {
    const texture=canvasTexture(512,128,(c,cw,ch)=>{
      if(!paint){c.fillStyle="#324c4e";c.fillRect(0,0,cw,ch);c.strokeStyle="#d6cfb5";c.lineWidth=6;c.strokeRect(9,9,cw-18,ch-18);}
      c.fillStyle=paint?"#9e4a31":"#e9dfc3";c.textAlign="center";c.textBaseline="middle";
      c.font=(paint?"bold 88px Arial":"bold 54px Georgia");c.fillText(text,cw/2,ch/2+2,cw-36);
    });
    const mesh=decal(texture,x,y,z,w,h,yaw);mesh.name=(paint?"Wall marking: ":"Village sign: ")+text;
  }
  function siteMark(letter,x,z) {
    const texture=canvasTexture(256,256,c=>{
      c.strokeStyle="rgba(156,71,44,.76)";c.lineWidth=9;c.beginPath();c.arc(128,128,108,0,Math.PI*2);c.stroke();
      c.fillStyle="rgba(156,71,44,.84)";c.textAlign="center";c.textBaseline="middle";c.font="bold 151px Arial";c.fillText(letter,128,140);
    });
    decal(texture,x,.037,z,4.3,4.3,0,true);
  }
  function createLandmarks() {
    // A's campanile is planted inside the closed church footprint.
    const tx=38,tz=-34;
    box(tx,7.7,tz,5.8,15.4,5.8,mat.cream);
    collider(tx,7.7,tz,5.8,15.4,5.8,0,"Bell tower wall",false);
    for(const dx of [-2.72,2.72])for(const dz of [-2.72,2.72])box(tx+dx,8,tz+dz,.32,16,.32,mat.lightStone);
    box(tx,15.45,tz,6.25,.38,6.25,mat.lightStone);
    box(tx,19.4,tz,6.25,.38,6.25,mat.lightStone);
    collider(tx,15.45,tz,6.25,.38,6.25,0,"Bell chamber floor",false);
    collider(tx,19.4,tz,6.25,.38,6.25,0,"Bell chamber cornice",false);
    for(const dx of [-2.5,2.5])for(const dz of [-2.5,2.5]) {
      box(tx+dx,17.4,tz+dz,.8,3.8,.8,mat.cream);
      collider(tx+dx,17.4,tz+dz,.8,3.8,.8,0,"Bell chamber pillar",false);
    }
    for(const side of [0,1,2,3]) {
      const yaw=side*Math.PI/2,p=localPosition(tx,tz,yaw,0,2.52);
      arch(p[0],p[1],yaw,4.2,17.8,1.15,.55,mat.lightStone);
    }
    cylinder(tx,17.7,tz,.66,.85,mat.brass);
    cylinder(tx,17.2,tz,.9,.16,mat.brass);
    box(tx,18.65,tz,.12,1.4,.12,mat.woodDark);
    const towerRoof=new THREE.Mesh(new THREE.ConeGeometry(4.7,3.3,4),mat.roof);
    towerRoof.rotation.y=Math.PI/4;towerRoof.position.set(tx,21.25,tz);towerRoof.castShadow=true;
    towerRoof.name="Bell tower roof";root.add(towerRoof);colliders.push(towerRoof);
    cylinder(tx,23.5,tz,.055,1.8,mat.iron);
    box(tx,23.75,tz,.85,.065,.065,mat.iron);
    const clock=canvasTexture(256,256,c=>{
      c.fillStyle="#d4c7a5";c.beginPath();c.arc(128,128,123,0,Math.PI*2);c.fill();
      c.strokeStyle="#5c5649";c.lineWidth=9;c.stroke();c.lineWidth=3;
      for(let i=0;i<12;i++){const a=i*Math.PI/6;c.beginPath();c.moveTo(128+Math.sin(a)*98,128-Math.cos(a)*98);c.lineTo(128+Math.sin(a)*111,128-Math.cos(a)*111);c.stroke();}
      c.lineWidth=7;c.beginPath();c.moveTo(128,128);c.lineTo(128,53);c.moveTo(128,128);c.lineTo(177,149);c.stroke();
      c.fillStyle="#5c5649";c.beginPath();c.arc(128,128,8,0,Math.PI*2);c.fill();
    });
    decal(clock,tx,13.1,tz+2.924,2.5,2.5);
    decal(clock,tx-2.924,13.1,tz,2.5,2.5,-Math.PI/2);
    // Layered church facade, closed wooden entrance, and a circular stone rose.
    closedDoor(31,-28.98,0,0,.025,2.8,4.1,1);
    arch(31,-28.80,0,3.1,3.2,1.3,.22,mat.lightStone);
    for(const x of [23.2,27.7,34.3,40.8])box(x,4.9,-28.83,.55,9.8,.34,mat.lightStone);
    cylinder(31,7,-28.76,1.04,.13,mat.lightStone,Math.PI/2);
    cylinder(31,7,-28.66,.81,.06,mat.glass,Math.PI/2);
    for(let i=0;i<4;i++)instance(boxGeo,mat.lightStone,31,7,-28.60,.08,1.58,.08,0,0,i*Math.PI/4,false);
    inscription("SANTA MARIA",31,4.85,-28.59,3.8,.45);
    // B cloister recesses, stone buttresses and a quiet cypress silhouette.
    for(const x of [-35,-29,-23]) {
      box(x,2,-37.94,3.7,4,.13,mat.darkStone);
      box(x,1.85,-37.83,3.1,3.55,.12,mat.woodDark);
      arch(x,-37.72,0,3.2,2.65,1.28,.22,mat.lightStone);
      for(const dx of [-1.8,1.8])box(x+dx,1.5,-37.68,.4,3,.38,mat.lightStone);
    }
    inscription("PIAZZA DELLA FONTANA",-29,7.25,-37.78,6.3,.68);
    for(const p of [[-39,-37],[-14,-40],[25,-37]])cypress(p[0],p[1],10.8);
    // Ruined masonry attached to the existing divider, safely outside the CT lane.
    for(let i=0;i<6;i++)box(-18+i*1.5,7.5+(i%3)*.23,-30.8,1.15,.6+(i%3)*.46,.6,mat.stone);
    // Gravestones sit against A's east wall; the pit stays on the supported floor.
    for(const z of [-25,-19,-13]) {
      box(41.57,.12,z,.86,.24,2.0,mat.darkStone,0,true,"Graveyard plinth");
      box(41.72,.9,z,.27,1.6,1.15,mat.lightStone,0,true,"Graveyard headstone");
      box(41.55,1.0,z,.03,.75,.12,mat.darkStone,0,false,"Grave engraving",false);
      box(41.55,1.14,z,.03,.12,.47,mat.darkStone,0,false,"Grave engraving",false);
    }
    siteMark("A",28,-10);siteMark("B",-32.7,-30.3);
    inscription("B ←",-1.925,2.25,23,2.2,1.0,Math.PI/2,true);
    inscription("A →",7.925,2.25,21,2.2,1.0,-Math.PI/2,true);
    inscription("B",-19.08,2.1,-15,1.5,1.5,-Math.PI/2,true);
    inscription("A",18.075,2.4,-13.3,1.4,1.4,Math.PI/2,true);
  }
  function cypress(x,z,h) {
    solidCylinder(x,h*.34,z,.22,h*.68,mat.woodDark,"Cypress trunk",true);
    instance(treeGeo,mat.foliage,x,h*.67,z,1.1,h*.39,1.1,0,.3,0,false);
    instance(treeGeo,mat.foliageLight,x+.15,h*.83,z,0.67,h*.24,.69,0,.5,0,false);
  }
  function createVillageDetails() {
    // Warm ground-floor businesses orient the opening view without menu overlays.
    inscription("VINI · OLIO",-6.7,3.33,27.13,5.8,.72);
    inscription("VIA ROMA",-1.88,3.4,21.8,2.1,.45,Math.PI/2);
    inscription("VIA DEL SOLE",16.12,3.4,26,2.5,.46,Math.PI/2);
    inscription("BIBLIOTECA",16,3.35,-29.86,4.4,.65);
    inscription("APPARTAMENTI",29.5,4.0,13.25,3.1,.45);
    // Coping and low gutters separate ground materials without introducing steps.
    for(const [x,z,w,d]of [[-1.73,12,.22,29],[7.72,19,.22,20],[-20.73,14,.22,20],[26.75,27,.22,16],[40.0,-12,.23,28]])
      box(x,.035,z,w,.07,d,mat.darkStone,0,false,"Flush drain",false);
    for(const [x,z]of [[3,30],[21,17],[-23,-7],[14,-23]]) {
      cylinder(x,.025,z,.4,.035,mat.iron,0,0,0,false);
      for(let d=-.24;d<.3;d+=.12)box(x,.048,z+d,.55,.012,.03,mat.darkStone,0,false,"Drain slot",false);
    }
    // Pots are intentionally against walls; each has a matching small footprint.
    for(const [x,z]of [[-11.45,35],[15.35,36],[26.3,22],[20.4,11.8],[-38.9,-13.2],[0,-37.15]]) {
      cylinder(x,.4,z,.34,.8,mat.roofLight);cylinder(x,.78,z,.39,.12,mat.roof);
      cylinder(x,.81,z,.31,.04,mat.soil);
      collider(x,.42,z,.78,.84,.78,0,"Terracotta pot");
      for(let i=0;i<5;i++) {
        const a=i*Math.PI*.4;
        instance(leafGeo,i%2?mat.foliage:mat.foliageLight,x+Math.cos(a)*.18,1.07+(i%2)*.15,z+Math.sin(a)*.18,.24,.4,.24,0,a,0,false);
      }
    }
    bench(1,44.9,0);bench(-1.6,-1,Math.PI/2);
    // Cables and a small clothesline add depth above head height, never in routes.
    const clothesline=wire([[8,7.2,17],[17,6.6,19],[27,7.8,19]],mat.iron);
    wire([[-12,7.8,27],[-5,7.15,31],[8,8.3,29]],mat.iron);
    wire([[-28,8.0,2],[-23,7.3,1],[-19,8.1,-1]],mat.iron);
    for(let i=0;i<5;i++) {
      const t=.53+i*.068,left=clothesline.getPoint(t-.022),right=clothesline.getPoint(t+.022);
      const chord=right.clone().sub(left),yaw=-Math.atan2(chord.z,chord.x);
      const tilt=Math.atan2(chord.y,Math.hypot(chord.x,chord.z));
      const offset=new THREE.Vector3(0,-.625,0).applyEuler(new THREE.Euler(0,yaw,tilt));
      const center=left.clone().add(right).multiplyScalar(.5).add(offset);
      instance(boxGeo,i%3?mat.white:mat.blue,center.x,center.y,center.z,chord.length(),1.25,.025,0,yaw,tilt,false);
      for(const peg of [left,right])box(peg.x,peg.y-.025,peg.z,.06,.12,.045,mat.woodDark,yaw,false,"Cloth peg",false);
    }
    // Restrained exposed-brick patches at a few weathered facade corners.
    for(const [x,z,yaw]of [[-1.94,10,Math.PI/2],[7.94,15,-Math.PI/2],[-20.94,10,Math.PI/2],[26.94,25,-Math.PI/2]]) {
      for(let row=0;row<4;row++)for(let col=0;col<4-row;col++)
        localBox(x,z,yaw,col*.32+(row%2)*.16,.3+row*.17,.025,.29,.13,.04,mat.roofDark,false);
    }
    // The southern village gate is a closed boundary, not a false playable exit.
    box(0,2.2,46.16,5.5,4.4,.08,mat.woodDark);
    for(const x of [-2.95,2.95])box(x,2.5,45.97,.55,5,.42,mat.lightStone);
    arch(0,45.93,0,5.5,3.3,1.3,.3,mat.lightStone);
  }
  function bench(x,z,yaw) {
    localBox(x,z,yaw,0,.56,0,2.6,.12,.62,mat.wood);
    localBox(x,z,yaw,0,1.1,-.26,2.6,.62,.1,mat.wood);
    for(const dx of [-.95,.95])localBox(x,z,yaw,dx,.29,0,.12,.55,.55,mat.iron);
    collider(x,.65,z,2.6,1.3,.7,yaw,"Village bench");
  }
  function wire(points,material) {
    const curve=new THREE.QuadraticBezierCurve3(...points.map(p=>new THREE.Vector3(...p)));
    const geo=new THREE.TubeGeometry(curve,16,.018,3,false),mesh=new THREE.Mesh(geo,material);
    mesh.name="Overhead utility cable";root.add(mesh);return curve;
  }
  function createBackdrop() {
    // Solid scenery lies outside the unchanged playable limits.
    const far=[[-53,-37,10,16,9],[-54,-14,12,17,11],[-54,10,11,14,8],[-53,33,12,17,10],
      [-36,-54,15,12,11],[-16,-55,13,14,9],[7,-55,18,11,12],[29,-55,16,12,11],[51,-41,14,17,13],
      [54,-15,13,16,9],[55,12,14,19,10],[52,35,12,14,9],[-28,55,14,12,10],[21,56,17,13,9]];
    for(let i=0;i<far.length;i++) {
      const [x,z,w,d,h]=far[i];box(x,h/2-1,z,w,h,d,i%2?mat.plaster:mat.peach,0,false,"Distant village",false);
      // Distant roof silhouettes use very few triangles and do not cast shadows.
      const rise=2,angle=Math.atan2(rise,w/2),length=Math.hypot(w/2,rise);
      for(const side of [-1,1])instance(boxGeo,mat.roofDark,x+side*w/4,h-1+rise/2,z,length,.18,d+.4,0,0,-side*angle,false);
      box(x-w*.25,h,z,.8,2,.8,mat.stone,0,false,"Distant chimney",false);
    }
    for(const [x,z,w,h,d]of [[-95,-55,52,25,47],[-55,-102,47,21,40],[18,-112,58,26,40],[91,-81,48,31,51],[108,30,45,24,55],[-105,42,54,22,48]])
      instance(treeGeo,mat.skyHill,x,-4,z,w,h,d,0,.3,0,false);
    const extension=new THREE.Mesh(new THREE.PlaneGeometry(350,350),mat.hill);
    extension.rotation.x=-Math.PI/2;extension.position.y=-.22;extension.name="Town ground beyond boundary";root.add(extension);
  }
  function createSky() {
    const s=WORLD_SETTINGS.sky;
    scene.background=new THREE.Color(s.fogColor);scene.fog=new THREE.Fog(s.fogColor,s.fogNear,s.fogFar);
    const geo=new THREE.SphereGeometry(450,24,16),p=geo.attributes.position,colors=[];
    const top=new THREE.Color(s.top),mid=new THREE.Color(s.mid),horizon=new THREE.Color(s.horizon),c=new THREE.Color();
    for(let i=0;i<p.count;i++) {
      const t=Math.max(0,p.getY(i)/450);
      c.copy(t<0.24?horizon:mid).lerp(t<0.24?mid:top,t<0.24?t/0.24:(t-0.24)/0.76);
      colors.push(c.r,c.g,c.b);
    }
    geo.setAttribute("color",new THREE.Float32BufferAttribute(colors,3));
    const dome=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.BackSide,depthWrite:false,fog:false}));
    dome.name="Inferno summer sky";dome.renderOrder=-1000;scene.add(dome);
    const sun=new THREE.Mesh(new THREE.SphereGeometry(4,12,8),new THREE.MeshBasicMaterial({color:0xfff0cf,fog:false,depthWrite:false}));
    sun.position.set(...WORLD_SETTINGS.lighting.sunPosition).normalize().multiplyScalar(360);
    sun.name="Sun aligned to directional light";scene.add(sun);
  }
  function blocked(x, z, margin = 0.55) {
    if (Math.abs(x) > 46.2 - margin || Math.abs(z) > 46.2 - margin) return true;
    for (const b of obstacles) {
      const dx = x - b.x, dz = z - b.z, lx = b.cos * dx - b.sin * dz, lz = b.sin * dx + b.cos * dz;
      if (Math.abs(lx) < b.halfW + margin && Math.abs(lz) < b.halfD + margin) return true;
    }
    return false;
  }
  function createNavigation() {
    // Keep the walkable grid and cover queries used for multiplayer spawns.
    const cellSize = 1, width = 94, origin = -47, count = width * width;
    const walkable = new Uint8Array(count);
    const cellX = i => origin + (i % width + 0.5) * cellSize, cellZ = i => origin + (Math.floor(i / width) + 0.5) * cellSize;
    for (let i = 0; i < count; i++) walkable[i] = blocked(cellX(i), cellZ(i), 0.62) ? 0 : 1;

    function hasLineOfSight(a, b, margin = 0.12) {
      if (Math.abs(b.x) > 46.2 - margin || Math.abs(b.z) > 46.2 - margin) return false;
      // Exact segment/expanded-box tests avoid clipping small corners between
      // samples, especially around diagonally parked vehicles.
      for (const block of obstacles) {
        const ax = a.x - block.x, az = a.z - block.z;
        const bx = b.x - block.x, bz = b.z - block.z;
        const ox = block.cos * ax - block.sin * az;
        const oz = block.sin * ax + block.cos * az;
        const dx = block.cos * bx - block.sin * bz - ox;
        const dz = block.sin * bx + block.cos * bz - oz;
        let near = 0, far = 1, misses = false;
        for (const axis of [[ox, dx, block.halfW + margin], [oz, dz, block.halfD + margin]]) {
          const [start, delta, half] = axis;
          if (Math.abs(delta) < 1e-9) {
            if (Math.abs(start) >= half) { misses = true; break; }
            continue;
          }
          const first = (-half - start) / delta, second = (half - start) / delta;
          near = Math.max(near, Math.min(first, second));
          far = Math.min(far, Math.max(first, second));
          if (near >= far) { misses = true; break; }
        }
        if (!misses) return false;
      }
      return true;
    }

    return {
      hasLineOfSight,
      grid: { width, cellSize, origin, walkable }
    };
  }

  function resetPlayer(player) { if (world.isLoaded) player.reset({ position: world.spawn.clone(), yaw: WORLD_SETTINGS.spawnYaw }); }
  function mulberry32(seed) {
    let value = seed >>> 0;
    return () => {
      value += 0x6D2B79F5; let t = value;
      t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
}
