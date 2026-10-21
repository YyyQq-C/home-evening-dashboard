import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';

/** 增强全屋材质、环境反射和边缘高光，保留透明背景及按需渲染。 */
export function enhanceRenderQuality({THREE,model,scene,renderer,sun,ao}){
// 环境贴图仅初始化一次，提供真实反射方向，不额外建立持续渲染循环。
const environment=new RoomEnvironment(),generator=new THREE.PMREMGenerator(renderer);
const environmentTarget=generator.fromScene(environment,.06);
scene.environment=environmentTarget.texture;scene.environmentIntensity=.3;
environment.dispose();generator.dispose();
let seed=419;
/** 生成确定性噪声，避免每次刷新材质发生变化。 */
function random(){seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;}
/** 创建低对比石材颜色及粗糙度纹理，避免用大块纯色表示地面。 */
function stoneMaps(){
const size=1024,canvas=document.createElement('canvas');canvas.width=canvas.height=size;
const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(size,size);
for(let y=0;y<size;y++)for(let x=0;x<size;x++){
const index=(y*size+x)*4;
const cloud=Math.sin(x*.014+Math.sin(y*.008)*2)*1.3+Math.sin(y*.021+x*.005)*.9;
const grain=(random()-.5)*3;
pixels.data[index]=225+cloud+grain;pixels.data[index+1]=219+cloud+grain;pixels.data[index+2]=208+cloud+grain;pixels.data[index+3]=255;
}
ctx.putImageData(pixels,0,0);
// 不规则细石纹只使用极低对比度，保留大面积石材的干净观感。
for(let i=0;i<18;i++){
ctx.strokeStyle=i%2?'rgba(128,115,97,.035)':'rgba(255,255,255,.09)';ctx.lineWidth=.5+random()*1.1;
ctx.beginPath();const start=random()*size;ctx.moveTo(start,0);
for(let y=0;y<=size;y+=16)ctx.lineTo(start+Math.sin(y*.006+i)*70+y*.17,y);ctx.stroke();
}
const color=new THREE.CanvasTexture(canvas);color.colorSpace=THREE.SRGBColorSpace;color.wrapS=color.wrapT=THREE.RepeatWrapping;color.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
const roughCanvas=document.createElement('canvas');roughCanvas.width=roughCanvas.height=256;const roughContext=roughCanvas.getContext('2d');
roughContext.fillStyle='#a4a4a4';roughContext.fillRect(0,0,256,256);
for(let i=0;i<1000;i++){const shade=150+Math.floor(random()*25);roughContext.fillStyle=`rgb(${shade},${shade},${shade})`;roughContext.fillRect(random()*256,random()*256,2,2);}
const roughness=new THREE.CanvasTexture(roughCanvas);roughness.wrapS=roughness.wrapT=THREE.RepeatWrapping;
return {color,roughness};
}
const stone=stoneMaps(),physicalCloth=new Map(),beveled=[];
/** 创建有板间色差与细木纹的浅木地板，避免仅靠网格线表现木材。 */
function woodFloorMap(){
const size=1024,canvas=document.createElement('canvas');canvas.width=canvas.height=size;
const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(size,size),tones=[2,-3,4,-1,1,-4,3,-2];
for(let y=0;y<size;y++)for(let x=0;x<size;x++){
const index=(y*size+x)*4,board=Math.floor(y/128);
const fiber=Math.sin(y*1.1+Math.sin(x*.009)*2+Math.sin(x*.027+y*.013))*.9+Math.sin(y*.23+x*.006)*1.2;
const cloud=Math.sin(y*.043+x*.004)*1.8,noise=(random()-.5)*2;
const shade=fiber+cloud+noise+tones[board];
pixels.data[index]=193+shade;pixels.data[index+1]=167+shade;pixels.data[index+2]=133+shade;pixels.data[index+3]=255;
}
ctx.putImageData(pixels,0,0);
const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());return texture;
}
const woodFloor=new THREE.MeshStandardMaterial({map:woodFloorMap(),roughness:.56,envMapIntensity:.55});
const stoneFloor=new THREE.MeshPhysicalMaterial({map:stone.color,color:'#e5ded3',roughness:.58,roughnessMap:stone.roughness,metalness:0,clearcoat:.08,clearcoatRoughness:.5,envMapIntensity:.65});
/** 按世界坐标设置地面纹理比例，保留原地板轮廓。 */
function floorUV(mesh,repeat){
const geometry=mesh.geometry.clone(),positions=geometry.attributes.position,uv=[],world=new THREE.Vector3();
for(let i=0;i<positions.count;i++){world.fromBufferAttribute(positions,i).applyMatrix4(mesh.matrixWorld);uv.push(world.x/repeat,world.z/repeat);}
geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));mesh.geometry.dispose();mesh.geometry=geometry;
}
/** 将布料升级为带掠射角柔光的物理材质，保留已有纹理与颜色。 */
function fabricMaterial(original){
if(physicalCloth.has(original))return physicalCloth.get(original);
// 黑色沙发减少环境反射与织物柔光，避免被暖光提亮成棕灰色。
const blackSofa=original.color.getHex()===0x111111;
const material=new THREE.MeshPhysicalMaterial({color:original.color,map:original.map,bumpMap:original.bumpMap,bumpScale:original.bumpScale,roughness:.92,metalness:0,sheen:blackSofa?.22:.7,sheenColor:original.color,sheenRoughness:.85,side:original.side,shadowSide:original.shadowSide,transparent:original.transparent,opacity:original.opacity,depthWrite:original.depthWrite});
material.envMapIntensity=blackSofa?.25:.5;physicalCloth.set(original,material);return material;
}
model.updateMatrixWorld(true);
model.traverse(mesh=>{
if(!mesh.isMesh)return;
const name=mesh.name,material=mesh.material;
if(Array.isArray(material)||!material.isMeshStandardMaterial)return;
if(/^(客餐厅|阳台|玄关|厨房|生活阳台)_Floor$/.test(name)){
mesh.material=stoneFloor;
// 按实际米制位置映射石纹，避免不同房间的纹理被拉伸。
floorUV(mesh,1.6);
}
if(/^(书房|儿童房|主卧|主卧门厅|次卧|书房窗台区域|书房门轨区域)_Floor$/.test(name)){
mesh.material=woodFloor;floorUV(mesh,1.52);
}
if(/^(Sofa_|Living_Sofa|Warm_Sofa|Bed_|Master_.*(Pillow|Duvet|Throw)|Secondary_.*(Pillow|Duvet|Throw|Mattress))/.test(name))mesh.material=fabricMaterial(material);
// 明确区分木材、烤漆、金属和石材的反光程度，避免统一的哑光色块。
if(/Study_Long_Desk|Study_Upper_Shelf|Master_Screen|Coffee_.*(Base|Companion)/.test(name)){
material.roughness=/Master_Screen/.test(name)?.65:.48;material.envMapIntensity=.65;
}
if(/Kitchen_.*Counter|Coffee_Table|Dining_Table/.test(name)){material.roughness=.32;material.envMapIntensity=.8;}
if(/Wardrobe|Closet_Door|Cabinet_Door|White_Wardrobe/.test(name)){material.roughness=.48;material.envMapIntensity=.6;}
// 仅处理盒形家具部件；结构墙、窗框和已塑形软包沿用原几何。
if(/Cabinet|Closet|Sideboard|Study_Long_Desk|Study_Upper_Shelf|Headboard|Bedside/.test(name)&&mesh.geometry.type==='BoxGeometry'){
const geometry=mesh.geometry;geometry.computeBoundingBox();const bounds=geometry.boundingBox,size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
if(Math.min(size.x,size.y,size.z)>.012){
const radius=Math.min(.012,size.x*.13,size.y*.13,size.z*.13),rounded=new RoundedBoxGeometry(size.x,size.y,size.z,3,radius);
rounded.translate(center.x,center.y,center.z);mesh.geometry=rounded;geometry.dispose();beveled.push(name);
}
}
if(material.map)material.map.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
});
// 主光与环境光分开形成轮廓；减少原先把所有表面染黄的均匀补光。
sun.intensity=1.75;sun.position.set(-5,11,6);sun.color.set('#fff5e8');
scene.children.filter(light=>light.isHemisphereLight).forEach(light=>{light.intensity=.42;light.color.set('#fff9ef');light.groundColor.set('#a99a88');});
// 去掉自然光造成的窗框、门和家具长投影，保留基础明暗与室内灯光。
sun.castShadow=false;renderer.shadowMap.enabled=false;
// 接触阴影在墙角、柜底和床品之间提供局部深度，保持正交投影适配。
ao.kernelRadius=.48;ao.minDistance=.0005;ao.maxDistance=.12;ao.enabled=true;
renderer.toneMappingExposure=.94;
return {environment:'prefiltered-room',shadowSize:0,naturalShadows:false,stoneFloor:true,fabricSheen:true,beveledParts:beveled.length};
}
