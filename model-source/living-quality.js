import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';

/** 细化客餐厅材质和软包，保留 CAD 校准后的布局、尺寸和控制实体。 */
export function refineLivingQuality({THREE,model,renderer,sun,scene}){
const random=(()=>{let seed=173;return ()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};})();
/** 创建可重复的织物与木纹贴图，避免加载远程资源。 */
function surface(kind){
const canvas=document.createElement('canvas');canvas.width=canvas.height=512;
const ctx=canvas.getContext('2d');ctx.fillStyle=kind==='wood'?'#ad8a66':'#c6c1b7';ctx.fillRect(0,0,512,512);
for(let i=0;i<512;i++){
const shade=Math.floor(100+random()*85);
ctx.strokeStyle=kind==='wood'?`rgba(61,32,15,${.025+random()*.08})`:`rgb(${shade},${shade},${shade})`;
ctx.lineWidth=kind==='wood'?.6:1;ctx.beginPath();
if(kind==='wood'){
ctx.moveTo(i,0);for(let y=0;y<=512;y+=16)ctx.lineTo(i+Math.sin(y*.025+i*.06)*2,y);
}else{ctx.moveTo(i,0);ctx.lineTo(i,512);ctx.moveTo(0,i);ctx.lineTo(512,i);}
ctx.stroke();
}
const texture=new THREE.CanvasTexture(canvas);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
texture.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());
if(kind==='wood')texture.colorSpace=THREE.SRGBColorSpace;
return texture;
}
const weave=surface('fabric'),grain=surface('wood');weave.repeat.set(5,5);
const fabric=new THREE.MeshStandardMaterial({color:'#3e3530',roughness:.98,bumpMap:weave,bumpScale:.009});
const cushion=new THREE.MeshStandardMaterial({color:'#ad754b',roughness:1,bumpMap:weave,bumpScale:.008});
const linen=new THREE.MeshStandardMaterial({color:'#ded0b9',roughness:1,bumpMap:weave,bumpScale:.008});
const rugMaterial=new THREE.MeshStandardMaterial({color:'#d7c6ad',roughness:1,bumpMap:weave,bumpScale:.012});
// 地毯用可辨认的织纹与双道包边，避免浅米色块与地砖混在一起。
const rugCanvas=document.createElement('canvas');rugCanvas.width=rugCanvas.height=512;
const rugContext=rugCanvas.getContext('2d');rugContext.fillStyle='#c4ad8c';rugContext.fillRect(0,0,512,512);
for(let i=0;i<512;i+=2){rugContext.strokeStyle=i%4?'#d6c3a5':'#bda78a';rugContext.lineWidth=.7;rugContext.beginPath();rugContext.moveTo(i,0);rugContext.lineTo(i,512);rugContext.moveTo(0,i);rugContext.lineTo(512,i);rugContext.stroke();}
for(const inset of [18,25]){rugContext.strokeStyle='#a99174';rugContext.lineWidth=2;rugContext.strokeRect(inset,inset,512-inset*2,512-inset*2);}
const rugTexture=new THREE.CanvasTexture(rugCanvas);rugTexture.colorSpace=THREE.SRGBColorSpace;rugTexture.anisotropy=4;
rugMaterial.map=rugTexture;rugMaterial.color.set('#ffffff');
model.updateMatrixWorld(true);
/** 在原有包围盒内重建软包圆角，避免家具挪位或侵占通道。 */
function soften(mesh,radius){
const bounds=new THREE.Box3().setFromObject(mesh),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
const geometry=new RoundedBoxGeometry(size.x,size.y,size.z,4,Math.min(radius,size.x*.3,size.y*.3,size.z*.3));
geometry.translate(center.x,center.y,center.z);geometry.applyMatrix4(mesh.matrixWorld.clone().invert());
mesh.geometry.dispose();mesh.geometry=geometry;
}
model.traverse(mesh=>{
if(!mesh.isMesh)return;
const name=mesh.name,materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
// 仅让实体家具投影；结构墙不投射大片遮挡，保留全屋俯视可读性。
const opaque=materials.every(m=>!m.transparent);
mesh.receiveShadow=opaque;mesh.castShadow=opaque&&!/Wall|Floor|Tile|Cap|Glow|Halo|Strip|Window|Glass/.test(name);
if(/^(Living_Sofa|Sofa_Back|Sofa_Arm|Sofa_Cushion|Sofa_Back_Cushion)$/.test(name)){
mesh.material=fabric;if(name!=='Living_Sofa')soften(mesh,name==='Sofa_Back_Cushion'?.075:.045);
}
if(name==='Warm_Sofa_Caramel_Pillow')mesh.material=cushion;
if(name==='Warm_Sofa_Knit_Throw')mesh.material=linen.clone();
if(name==='Living_Rug'){
mesh.material=rugMaterial;
// 地毯覆盖沙发前方与两张茶几，边缘保持在客厅区域内。
const geometry=new RoundedBoxGeometry(2.75,.015,3.2,2,.006);
geometry.translate(.075,.019,2);geometry.applyMatrix4(mesh.matrixWorld.clone().invert());
mesh.geometry.dispose();mesh.geometry=geometry;
}
if(name==='客餐厅_Floor'||name==='阳台_Floor'){
mesh.material=mesh.material.clone();mesh.material.color.set('#ded8cc');mesh.material.roughness=.72;
}
if(/Living_TV_|Dining_Sideboard_/.test(name)&&materials[0]?.map&&materials[0].isMeshStandardMaterial){
materials[0].roughness=.72;materials[0].bumpMap=grain;materials[0].bumpScale=.003;
}
});
// 只保留一个投影光源，沿用按需绘制，控制平板静止时的 GPU 开销。
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.normalBias=.025;sun.shadow.bias=-.00015;sun.shadow.radius=3;
sun.position.set(-3,12,5);sun.intensity=1.65;sun.color.set('#fff5e7');
scene.children.filter(light=>light.isHemisphereLight).forEach(light=>{light.intensity=1.05;light.color.set('#fff9ef');light.groundColor.set('#b7ac9d');});
renderer.toneMappingExposure=1.02;
// 客厅茶几改为高低错落的圆形石材桌面，保留原茶几中心及周围通道。
const coffee=model.getObjectByName('Coffee_Table');
if(coffee){
const bounds=new THREE.Box3().setFromObject(coffee),center=bounds.getCenter(new THREE.Vector3());
const oldParts=[];model.traverse(mesh=>{if(/^(Coffee_Table|Coffee_Tray|Coffee_Book|Warm_Coffee_Cup)$/.test(mesh.name))oldParts.push(mesh);});oldParts.forEach(mesh=>mesh.removeFromParent());
const stone=new THREE.MeshStandardMaterial({color:'#e9ddc9',roughness:.65}),wood=new THREE.MeshStandardMaterial({color:'#735038',roughness:.8,map:grain});
/** 创建有倒角的圆形茶几部件，减少石材桌面的硬边体块感。 */
function roundPart(name,x,z,radius,height,y,material){
const bevel=Math.min(.009,height*.18);
const points=[[0,-height/2],[radius-bevel,-height/2],[radius,-height/2+bevel],[radius,height/2-bevel],[radius-bevel,height/2],[0,height/2]].map(([r,h])=>new THREE.Vector2(r,h));
const mesh=new THREE.Mesh(new THREE.LatheGeometry(points,64),material);mesh.name=name;mesh.position.set(x,y,z);mesh.castShadow=mesh.receiveShadow=true;model.add(mesh);return mesh;
}
roundPart('Coffee_Table',center.x,center.z+.14,.37,.055,.37,stone);
roundPart('Coffee_Main_Base',center.x,center.z+.14,.20,.34,.17,wood);
roundPart('Coffee_Companion_Top',center.x-.19,center.z-.25,.25,.045,.285,wood);
roundPart('Coffee_Companion_Base',center.x-.19,center.z-.25,.14,.26,.13,wood);
roundPart('Warm_Coffee_Cup',center.x+.17,center.z+.15,.043,.075,.435,stone);
const book=new THREE.Mesh(new RoundedBoxGeometry(.16,.025,.22,2,.005),linen);book.name='Coffee_Book';book.position.set(center.x-.19,.32,center.z-.25);book.rotation.y=.18;book.castShadow=true;model.add(book);
}
return {shadows:'single-directional-2048',fabric:true,layoutPreserved:true};
}
