import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';

/** 应用暖调胡桃木软装，保留户型、柜体尺寸及全部家具位置。 */
export function applyWarmHome({THREE,model,mat,walnut}){
const X=n=>(n-8017)/1000,Z=n=>(n-7914)/1000;
/** 生成细密织物纹理，用于沙发、靠垫、毯子和床品。 */
function textile(color){
const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
const ctx=canvas.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,256,256);
for(let i=0;i<256;i+=3){ctx.strokeStyle=i%2?'rgba(255,255,255,.10)':'rgba(35,22,15,.10)';ctx.beginPath();ctx.moveTo(i,0);ctx.lineTo(i,256);ctx.moveTo(0,i);ctx.lineTo(256,i);ctx.stroke();}
const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
return new THREE.MeshStandardMaterial({map:texture,roughness:1});
}
const charcoal=textile('#302b27'),caramel=textile('#b77a47'),oatmeal=textile('#e6d7bf'),rust=textile('#ad7557');
const cream=new THREE.MeshStandardMaterial({color:'#ede2d1',roughness:.85});
mat.wall.color.set('#e8dfd2');mat.floor.color.set('#d5cbbd');mat.wood.color.set('#ead9c0');
// 深暖灰三人沙发采用与效果图一致的焦糖靠垫和米白搭毯。
model.traverse(m=>{
if(!m.isMesh)return;
if(/^(Living_Sofa|Sofa_Back|Sofa_Arm|Sofa_Cushion|Sofa_Back_Cushion)$/.test(m.name))m.material=charcoal;
if(/^(Bed_Throw|Secondary_Warm_Duvet|Folded_Bed_Throw)$/.test(m.name))m.material=rust;
if(/^(Bed_Pillow|Secondary_Warm_Pillow|Mattress|Secondary_Warm_Mattress)$/.test(m.name))m.material=oatmeal;
if(/^(Living_Rug|Master_Bed_Rug|Secondary_Bedside_Rug|Child_Round_Rug)$/.test(m.name))m.material=oatmeal;
});
/** 创建有圆角的软包或玩具柜部件，坐标均采用已校准的世界坐标。 */
function rounded(name,x,y,z,w,h,d,material,r=.025,parent=model){
const mesh=new THREE.Mesh(new RoundedBoxGeometry(w,h,d,3,Math.min(r,w/3,h/3,d/3)),material);mesh.name=name;mesh.position.set(x,y,z);parent.add(mesh);return mesh;
}
const sofaX=X(7067),sofaZ=Z(9914);
for(const side of [-1,1]){
const cushion=rounded('Warm_Sofa_Caramel_Pillow',sofaX-.08,.71,sofaZ+side*1.02,.18,.40,.42,caramel,.06);cushion.rotation.z=.14;
}
// 毯子从坐垫搭过前沿，下垂部分使用连续褶皱几何。
const throwGeometry=new THREE.PlaneGeometry(.64,.55,24,20),positions=throwGeometry.attributes.position;
for(let i=0;i<positions.count;i++){
const u=positions.getX(i)+.32,v=positions.getY(i);
positions.setXYZ(i,sofaX-.12+u,.558-Math.max(0,u-.46)*1.8+Math.sin(v*58)*.009,sofaZ+.75+v);
}
throwGeometry.computeVertexNormals();const blanket=new THREE.Mesh(throwGeometry,oatmeal.clone());blanket.material.side=THREE.DoubleSide;blanket.name='Warm_Sofa_Knit_Throw';model.add(blanket);
// 儿童房保持无床，以矮玩具柜、积木、玩具车和布偶形成活动区。
for(const m of [...model.children])if(/^Preview_Bed_/.test(m.name)){m.removeFromParent();m.geometry?.dispose();}
const toys=new THREE.Group();toys.name='Child_Toys';model.add(toys);
const toyColors=['#b8895b','#96a08a','#b97d65','#d9bf80','#859ca7'].map(color=>new THREE.MeshStandardMaterial({color,roughness:.85}));
const cx=X(12967),cz=Z(3794);
rounded('Child_Toy_Cabinet_Back',cx,.34,cz-.16,1.5,.64,.025,walnut,.005,toys);
for(const y of [.035,.32,.64])rounded('Child_Toy_Cabinet_Shelf',cx,y,cz,1.5,.035,.35,walnut,.006,toys);
for(const dx of [-.73,0,.73])rounded('Child_Toy_Cabinet_Side',cx+dx,.34,cz,.035,.64,.35,walnut,.005,toys);
for(const dx of [-.36,.36])rounded('Child_Toy_Storage_Basket',cx+dx,.17,cz+.03,.57,.23,.29,oatmeal,.035,toys);
for(let i=0;i<7;i++)rounded('Child_Toy_Block',X(12467)+(i%4)*.15,.07+Math.floor(i/4)*.13,Z(5214)+(i%3)*.12,.12,.13,.12,toyColors[i%5],.012,toys);
rounded('Child_Toy_Car',X(13467),.12,Z(5414),.32,.14,.18,toyColors[1],.035,toys);
for(const dx of [-.10,.10])for(const dz of [-.10,.10]){
const wheel=new THREE.Mesh(new THREE.CylinderGeometry(.045,.045,.026,16),charcoal);wheel.name='Child_Toy_Car_Wheel';wheel.rotation.x=Math.PI/2;wheel.position.set(X(13467)+dx,.065,Z(5414)+dz);toys.add(wheel);
}
/** 使用柔和球体组合创建布偶熊，避免增加床或大型家具。 */
function teddyPart(name,dx,y,dz,sx,sy,sz){const mesh=new THREE.Mesh(new THREE.SphereGeometry(1,20,12),caramel);mesh.name=name;mesh.position.set(X(13917)+dx,y,Z(4414)+dz);mesh.scale.set(sx,sy,sz);toys.add(mesh);}
teddyPart('Child_Teddy_Body',0,.23,0,.15,.20,.12);teddyPart('Child_Teddy_Head',0,.49,0,.14,.14,.12);
for(const side of [-1,1]){teddyPart('Child_Teddy_Ear',side*.11,.60,0,.052,.055,.04);teddyPart('Child_Teddy_Foot',side*.10,.07,.08,.075,.065,.10);teddyPart('Child_Teddy_Arm',side*.17,.26,0,.055,.13,.06);}
for(const side of [-1,1]){const eye=new THREE.Mesh(new THREE.SphereGeometry(.012,10,8),charcoal);eye.name='Child_Teddy_Eye';eye.position.set(X(13917)+side*.045,.51,Z(4414)+.112);toys.add(eye);}
// 茶几增加日常杯具，餐桌保留简洁桌面，不恢复已删除的横线。
const cup=new THREE.Mesh(new THREE.CylinderGeometry(.04,.035,.075,20),cream);cup.name='Warm_Coffee_Cup';cup.position.set(X(8267)+.15,.47,Z(9914)-.12);model.add(cup);
return {palette:'warm-walnut',sofa:'charcoal-caramel-oatmeal',childBed:false,toyCount:toys.children.length};
}
