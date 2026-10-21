import {RectAreaLightUniformsLib} from 'three/addons/lights/RectAreaLightUniformsLib.js';

/** 沿客厅原有两侧灯带位置创建连续照明及同步开关的线状光效。 */
export function enhanceCeilingStrips({THREE,model,groups}){
const group=groups.ceiling;
if(!group){console.error('Ceiling strip group not found');return;}
// 复用 CAD 迁移后的真实照明位置，不沿用尚未迁移的旧 anchors。
const positions=group.lights.map(light=>light.position.clone());
for(const light of group.lights)light.removeFromParent();
for(const pool of group.pools){pool.removeFromParent();pool.geometry.dispose();pool.material.dispose();}
group.lights=[];group.pools=[];
RectAreaLightUniformsLib.init();
const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;
const ctx=canvas.getContext('2d'),gradient=ctx.createLinearGradient(0,0,0,128);
for(const [stop,color] of [[0,'rgba(255,191,91,0)'],[.25,'rgba(255,207,129,.2)'],[.5,'rgba(255,221,161,.75)'],[.75,'rgba(255,207,129,.2)'],[1,'rgba(255,191,91,0)']])gradient.addColorStop(stop,color);
ctx.fillStyle=gradient;ctx.fillRect(0,0,512,128);
ctx.globalCompositeOperation='destination-in';
const ends=ctx.createLinearGradient(0,0,512,0);ends.addColorStop(0,'rgba(255,255,255,0)');ends.addColorStop(.035,'white');ends.addColorStop(.965,'white');ends.addColorStop(1,'rgba(255,255,255,0)');ctx.fillStyle=ends;ctx.fillRect(0,0,512,128);
const glowTexture=new THREE.CanvasTexture(canvas);glowTexture.colorSpace=THREE.SRGBColorSpace;
/** 创建朝上的线形光效，开关由原顶部灯带控制组统一管理。 */
function plane(name,position,width,depth,height,material){
const mesh=new THREE.Mesh(new THREE.PlaneGeometry(width,depth),material);mesh.name=name;mesh.rotation.x=-Math.PI/2;mesh.position.set(position.x,height,position.z);mesh.visible=group.on;model.add(mesh);group.pools.push(mesh);
}
for(const position of positions){
const light=new THREE.RectAreaLight(0xffd49b,group.on?90:0,6.4,.07);light.name='Living_Ceiling_Strip_Illumination';light.position.copy(position);light.lookAt(position.x,0,position.z);light.userData.power=90;model.add(light);group.lights.push(light);
// 屋顶剖切视图用细亮芯标示真实灯带路径，柔光与地面洗光避免圆形点状效果。
plane('Living_Ceiling_Strip_Core',position,6.4,.026,2.24,new THREE.MeshBasicMaterial({color:'#fff1ce',transparent:true,opacity:.95,depthWrite:false,toneMapped:false}));
plane('Living_Ceiling_Strip_Halo',position,6.46,.28,2.235,new THREE.MeshBasicMaterial({map:glowTexture,transparent:true,opacity:.58,depthWrite:false,toneMapped:false}));
plane('Living_Ceiling_Strip_Floor_Wash',position,6.4,1.15,.023,new THREE.MeshBasicMaterial({map:glowTexture,transparent:true,opacity:.38,depthWrite:false,toneMapped:false}));
}
return {count:positions.length,length:6.4,continuous:true};
}
