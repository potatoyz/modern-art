import * as THREE from 'three';
import { A3GameRuntimeHost, createRoundedBox } from '@a3game/playable';

// The scene IS the game table. Cards and score text remain accessible DOM overlays.
export async function createGallery(container) {
  const low=localStorage.getItem('modern-art-quality')==='low';
  const host=new A3GameRuntimeHost({container,cameraType:'orthographic',frustumHeight:11.2,clearColor:0x183a35,
    shadows:false,antialias:!low,pixelRatioCap:low?1:1.5,toneMapping:'NoToneMapping',fixedTimeStep:0});
  await host.init();
  host.camera.position.set(0,12,7.7);host.camera.lookAt(0,0,0);
  host.add(new THREE.HemisphereLight(0xfff6df,0x173e36,1.65),'lights');
  const light=new THREE.DirectionalLight(0xffe2b5,1.35);light.position.set(-5,9,5);host.add(light,'lights');
  const root=new THREE.Group();host.add(root,'environment');
  const materials=new Map();
  const mat=color=>{if(!materials.has(color))materials.set(color,new THREE.MeshToonMaterial({color}));return materials.get(color);};
  const box=(w,h,d,color,x,y,z,r=.1)=>{const o=createRoundedBox({width:w,height:h,depth:d,radius:r,segments:2,material:mat(color),castShadow:false,receiveShadow:false});o.position.set(x,y,z);root.add(o);return o;};
  const cylinder=(r,h,color,x,y,z,segments=24)=>{const o=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,segments),mat(color));o.position.set(x,y,z);root.add(o);return o;};
  // Beveled walnut edge, a brass inset and two nested felt surfaces.
  box(19.3,.6,10.7,'#523f37',0,-.55,0,1.35);
  box(19,.22,10.4,'#84634a',0,-.2,0,1.2);
  box(18.4,.09,9.8,'#c59d61',0,-.06,0,1.05);
  box(18.24,.1,9.64,'#295449',0,.015,0,1);
  box(17.5,.035,8.95,'#396b5c',0,.082,0,.85);
  // Decorative seam is geometry, not an expensive full-screen shader.
  box(16.65,.015,8.17,'#4b7b66',0,.105,0,.72);
  box(16.59,.02,8.11,'#396b5c',0,.115,0,.7);
  // Public bank stacks: instanced chips share geometry and one material per color.
  const chipGeometry=new THREE.CylinderGeometry(.23,.23,.085,24);
  const chipPlacements=[[-6.4,2.9,7,'#e2b65f'],[-6,3.15,5,'#e2b65f'],[-6.85,3.15,3,'#e2b65f'],[6.4,2.9,6,'#bb755b'],[6.85,3.1,4,'#dbc186']];
  const transform=new THREE.Object3D();
  for(const [x,z,count,color]of chipPlacements){const coins=new THREE.InstancedMesh(chipGeometry,mat(color),count);for(let i=0;i<count;i++){transform.position.set(x,.19+i*.09,z);transform.updateMatrix();coins.setMatrixAt(i,transform.matrix);}root.add(coins);}
  // Auction gavel on its own base at the upper right of the felt.
  cylinder(.48,.12,'#715039',6.6,.2,-2.45);
  cylinder(.38,.035,'#a67c50',6.6,.28,-2.45);
  const handle=box(.1,.1,.95,'#b18753',6.5,.42,-2.3,.04);handle.rotation.y=-.6;
  const head=cylinder(.17,.45,'#ba925c',6.25,.48,-2.65);head.rotation.z=Math.PI/2;head.rotation.y=-.6;
  // A physical deck at the bank, with cream card edges and a patterned top.
  box(.95,.2,1.36,'#c9b68c',-6.55,.24,-2.25,.06);
  box(.95,.04,1.36,'#ebe0bd',-6.55,.37,-2.25,.05);
  box(.84,.015,1.24,'#ae7460',-6.55,.398,-2.25,.035);
  const seal=cylinder(.19,.015,'#e3bd75',-6.55,.416,-2.25);seal.rotation.y=Math.PI/4;
  let disposed=false,current='';
  const render=()=>{if(disposed||document.hidden)return;host.tick(0);const s=host.getStats();Object.assign(container.dataset,{frames:s.frameCount,drawCalls:s.drawCalls,triangles:s.triangles,textures:s.textures,pixelRatio:s.pixelRatio});};
  const resize=host.onResize(render),visibility=()=>{if(!document.hidden)render();};document.addEventListener('visibilitychange',visibility);
  const setArt=id=>{if(id===current)return;current=id;render();};
  render();
  return {host,setArt,render,stats:()=>host.getStats(),rotate:()=>{},reset:render,dispose:()=>{disposed=true;resize();document.removeEventListener('visibilitychange',visibility);const geometries=new Set();root.traverse(o=>{if(o.geometry)geometries.add(o.geometry);});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());host.dispose();}};
}
