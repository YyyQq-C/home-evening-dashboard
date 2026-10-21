import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';

/** 重建床品与沙发软包，在原家具范围内增加蓬松体积和自然垂坠。 */
export function refineSoftFurnishings({THREE,model}){
/** 为织物生成微小纤维纹理，纹理只改变细节而不绘制规则方格。 */
function cloth(color,scale=4){
const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
const ctx=canvas.getContext('2d');ctx.fillStyle='#999999';ctx.fillRect(0,0,256,256);
for(let i=0;i<256;i++){
ctx.strokeStyle=i%2?'rgba(230,230,230,.24)':'rgba(35,35,35,.18)';ctx.lineWidth=.55;
ctx.beginPath();ctx.moveTo(i,0);ctx.lineTo(i,256);ctx.moveTo(0,i);ctx.lineTo(256,i);ctx.stroke();
}
const texture=new THREE.CanvasTexture(canvas);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(scale,scale);
return new THREE.MeshStandardMaterial({color,roughness:1,bumpMap:texture,bumpScale:.004,side:THREE.DoubleSide,shadowSide:THREE.BackSide});
}
const ivory=cloth('#eee7dc'),oat=cloth('#c9b99e'),clay=cloth('#aa795c'),charcoal=cloth('#111111'),caramel=cloth('#ac6e40'),darkSeam=new THREE.MeshStandardMaterial({color:'#090909',roughness:1});
/** 读取模型实际世界尺寸，避免沿用 CAD 迁移前的局部坐标。 */
function bounds(name){const mesh=model.getObjectByName(name);return mesh?new THREE.Box3().setFromObject(mesh):null;}
/** 将新部件加入模型，并启用家具投影与接收阴影。 */
function add(name,geometry,material,x,y,z){const mesh=new THREE.Mesh(geometry,material);mesh.name=name;mesh.position.set(x,y,z);mesh.castShadow=mesh.receiveShadow=true;model.add(mesh);return mesh;}
/** 按名称移除旧软装，保留床架、床头和家具控制结构。 */
function remove(pattern){const meshes=[];model.traverse(mesh=>{if(mesh.isMesh&&pattern.test(mesh.name))meshes.push(mesh);});meshes.forEach(mesh=>{mesh.removeFromParent();mesh.geometry.dispose();});}
/** 用超椭球创建有鼓起中心与收窄边缘的枕头或软包。 */
function pillow(name,x,y,z,w,h,d,material){
const geometry=new THREE.SphereGeometry(1,48,24),positions=geometry.attributes.position;
/** 保留符号的幂函数，让圆形截面变为柔软的圆角矩形。 */
const power=(value,exponent)=>Math.sign(value)*Math.pow(Math.abs(value),exponent);
for(let i=0;i<positions.count;i++){
const px=positions.getX(i),py=positions.getY(i),pz=positions.getZ(i);
positions.setXYZ(i,power(px,.32)*w/2,power(py,.70)*h/2,power(pz,.32)*d/2);
}
geometry.computeVertexNormals();return add(name,geometry,material,x,y,z);
}
/** 沿坐垫中腰创建细窄缝线，强调软包边缘而非硬质块面。 */
function piping(name,x,y,z,w,d,material){
const points=[];
for(let i=0;i<=80;i++){const a=i/80*Math.PI*2;points.push(new THREE.Vector3(Math.sign(Math.cos(a))*Math.pow(Math.abs(Math.cos(a)),.32)*w/2,0,Math.sign(Math.sin(a))*Math.pow(Math.abs(Math.sin(a)),.32)*d/2));}
return add(name,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),80,.0025,4,false),material,x,y,z);
}
/** 创建带蓬松顶面、侧垂和脚端下垂的被子，褶皱由连续曲面表现。 */
function duvet(name,bed,material,offset=.36){
const start=bed.min.x+offset,end=bed.max.x+.045,centerZ=(bed.min.z+bed.max.z)/2;
const half=(bed.max.z-bed.min.z)/2,overhang=.13;
const geometry=new THREE.PlaneGeometry(1,1,64,64),positions=geometry.attributes.position;
for(let i=0;i<positions.count;i++){
const u=positions.getX(i)+.5,v=(positions.getY(i)+.5)*2-1;
const x=start+u*(end-start),z=centerZ+v*(half+overhang);
const sideDrop=Math.pow(Math.max(0,(Math.abs(v)*(half+overhang)-half+.055)/.185),1.5)*.23;
const footDrop=Math.pow(Math.max(0,(x-bed.max.x+.07)/.115),1.6)*.19;
const puff=.045*Math.sin(Math.PI*u)*Math.cos(v*Math.PI/2);
const wrinkles=.014*Math.sin(u*31+v*6)*Math.sin(u*Math.PI)+.009*Math.sin(v*36+u*8)+.012*Math.sin(v*15-u*9);
positions.setXYZ(i,x,bed.max.y+.055+puff+wrinkles-sideDrop-footDrop,z);
}
geometry.computeVertexNormals();return add(name,geometry,material,0,0,0);
}
/** 在床脚增加随床沿下垂的搭毯，避免叠放一块平面色板。 */
function bedThrow(name,bed,material){
const geometry=new THREE.PlaneGeometry(1,1,36,48),positions=geometry.attributes.position;
const centerZ=(bed.min.z+bed.max.z)/2,half=(bed.max.z-bed.min.z)/2;
for(let i=0;i<positions.count;i++){
const u=positions.getX(i)+.5,v=positions.getY(i)*2;
const x=bed.max.x-.57+u*.52,z=centerZ+v*(half+.16);
const side=Math.max(0,(Math.abs(v)*(half+.16)-half+.045)/.205);
const wrinkle=.010*Math.sin(v*21+u*4+Math.sin(v*9))+.006*Math.cos(u*31+v*7)+.006*Math.sin(v*43-u*9);
positions.setXYZ(i,x,bed.max.y+.145+wrinkle-Math.pow(side,1.4)*.21,z);
}
geometry.computeVertexNormals();return add(name,geometry,material,0,0,0);
}
const master=bounds('Mattress'),secondary=bounds('Secondary_Warm_Mattress');
remove(/^(Bed_Pillow|Bed_Throw|Secondary_Warm_Pillow|Secondary_Warm_Duvet|Folded_Bed_Throw)$/);
/** 为一张床布置双层枕头、折回被头和床脚搭毯。 */
function dressBed(id,bed){
if(!bed){console.error('Bed mattress not found',id);return;}
const width=bed.max.z-bed.min.z,centerZ=(bed.min.z+bed.max.z)/2;
duvet(id==='Master'?'Bed_Throw':'Secondary_Warm_Duvet',bed,ivory);
// 被头折回为连续柔软曲面，色调比主被略深，突出床铺层次。
const foldGeometry=new THREE.PlaneGeometry(.27,width+.09,24,36),fold=foldGeometry.attributes.position;
for(let i=0;i<fold.count;i++){
const u=fold.getX(i)/.27+.5,v=fold.getY(i)/(width+.09)*2;
fold.setXYZ(i,bed.min.x+.36+u*.27,bed.max.y+.10+.04*Math.sin(u*Math.PI)+.008*Math.sin(v*23)-Math.pow(Math.abs(v),10)*.06,centerZ+v*(width+.09)/2);
}
foldGeometry.computeVertexNormals();add(id+'_Duvet_Fold',foldGeometry,oat,0,0,0);
for(const side of [-1,1]){
const z=centerZ+side*width*.245;
const back=pillow(id+'_Back_Pillow',bed.min.x+.23,bed.max.y+.145,z,.42,.22,width*.44,ivory);back.rotation.z=.10;back.rotation.y=side*.035;
const front=pillow(id==='Master'?'Bed_Pillow':'Secondary_Warm_Pillow',bed.min.x+.44,bed.max.y+.19,z+.015,.35,.20,width*.40,oat);front.rotation.y=-side*.065;
}
bedThrow(id+'_Soft_Foot_Throw',bed,clay);
}
dressBed('Master',master);dressBed('Secondary',secondary);
const sofa=bounds('Living_Sofa');
if(!sofa){console.error('Living sofa not found');return {beds:2,sofa:false};}
const center=sofa.getCenter(new THREE.Vector3()),length=sofa.max.z-sofa.min.z;
remove(/^(Sofa_Back|Sofa_Arm|Sofa_Cushion|Sofa_Back_Cushion|Sofa_Foot|Warm_Sofa_Caramel_Pillow|Warm_Sofa_Knit_Throw)$/);
const base=model.getObjectByName('Living_Sofa');base.material=charcoal;
// 三米沙发采用低矮厚扶手、饱满坐垫与后倾靠背，保持原有家具占地。
add('Sofa_Back',new RoundedBoxGeometry(.16,.51,length-.04,4,.055),charcoal,sofa.min.x+.09,.46,center.z);
for(const side of [-1,1])add('Sofa_Arm',new RoundedBoxGeometry(.87,.43,.20,5,.07),charcoal,center.x,.36,center.z+side*(length/2-.1));
const seatLength=(length-.4)/3;
for(let i=0;i<3;i++){
const z=sofa.min.z+.2+(i+.5)*seatLength;
pillow('Sofa_Cushion',center.x+.055,.48,z,.66,.20,seatLength-.012,charcoal);
piping('Sofa_Seat_Piping',center.x+.055,.475,z,.65,seatLength-.018,darkSeam);
const back=pillow('Sofa_Back_Cushion',sofa.min.x+.21,.72,z,.23,.43,seatLength-.018,charcoal);back.rotation.z=.14;
}
for(const side of [-1,1]){
const accent=pillow('Warm_Sofa_Caramel_Pillow',center.x-.055,.69,center.z+side*1.00,.16,.38,.42,caramel);accent.rotation.z=.20;accent.rotation.x=side*.18;
for(const dx of [-.28,.28])add('Sofa_Foot',new THREE.CylinderGeometry(.025,.018,.10,12),darkSeam,center.x+dx,.05,center.z+side*1.22);
}
// 米白搭毯横搭座面并垂过前沿，褶皱在转折处连续变化。
const blanketGeometry=new THREE.PlaneGeometry(1,1,56,40),blanket=blanketGeometry.attributes.position;
for(let i=0;i<blanket.count;i++){
const u=blanket.getX(i)+.5,v=blanket.getY(i);
const x=sofa.min.x+.29+u*.83,z=center.z+.50+v*.65;
const drop=Math.max(0,(x-sofa.max.x+.055)/.325);
blanket.setXYZ(i,x,.625-Math.pow(drop,1.15)*.40+.010*Math.sin(v*33+u*5+Math.sin(u*7))+.006*Math.sin(v*51-u*9),z+.015*Math.sin(u*9));
}
blanketGeometry.computeVertexNormals();add('Warm_Sofa_Knit_Throw',blanketGeometry,ivory,0,0,0);
return {beds:2,sofa:true,seatCount:3,bedStyle:'layered-linen',sofaStyle:'black-soft-caramel'};
}
