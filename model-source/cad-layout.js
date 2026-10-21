import {applyWarmHome} from './warm-home.js';
import {addWindowCurtains} from './curtains.js';
import {RectAreaLightUniformsLib} from 'three/addons/lights/RectAreaLightUniformsLib.js';
// 示例模型结构坐标，单位为毫米；实际户型须使用自己的尺寸校准。
// 所有表内数值单位为毫米，保留后续照片确认的家具造型。
const S=7.24/350;
const rooms=[
['生活阳台',[[4567,1914],[6767,1914],[6767,3514],[4567,3514]],false],
['厨房',[[4567,3514],[6767,3514],[6767,6714],[4567,6714]],false],
['次卫',[[6967,3514],[8437,3514],[8437,6814],[6967,6814]],false],
['书房',[[8567,3714],[11367,3714],[11367,6654],[8567,6654]],true],
['书房窗台区域',[[8567,3514],[11367,3514],[11367,3714],[8567,3714]],true],
['书房门轨区域',[[8567,6654],[11367,6654],[11367,6914],[8567,6914]],true],
['儿童房',[[11567,3514],[14367,3514],[14367,6514],[12567,6514],[12567,6714],[11567,6714]],true],
['主卫',[[12667,6744],[15117,6744],[15117,8464],[14137,8464],[14137,8564],[13337,8564],[13337,8464],[12667,8464]],false],
['主卧',[[11517,8564],[15117,8564],[15117,13014],[14717,13014],[14717,13714],[12117,13714],[12117,13214],[11517,13214]],true],
['主卧门厅',[[11517,8364],[12517,8364],[12517,8564],[11517,8564]],true],
// 次卧按用户最新局部图：净宽 2480+400，主体进深 900+2230，飘窗深 700。
['次卧',[[917,8614],[3797,8614],[3797,11744],[3397,11744],[3397,12444],[917,12444]],true],
['储物间',[[917,7514],[1917,7514],[1917,6914],[2867,6914],[2867,8514],[917,8514]],false],
['玄关',[[2867,6914],[4417,6914],[4417,8514],[2867,8514]],false],
['客餐厅',[[4417,6914],[12517,6914],[12517,8564],[11317,8564],[11317,11114],[4617,11114],[4617,8614],[4417,8614]],false],
['阳台',[[4617,11114],[11317,11114],[11317,13014],[4617,13014]],false],
];
// 用 CAD 两侧墙线中点确定墙轴；转角延伸半墙厚，门洞段不生成墙体。
const walls=[
[4467,1814,4467,6914,200],[6867,3514,6867,6914,200],
// 厨房左排入口端墙覆盖完整台柜及冰箱进深，仅中间留出通道。
[4567,6814,5177,6814,200],[6117,6814,6867,6814,200],
[6867,3414,11467,3414,200],[8467,3514,8467,6914,200],[11467,3514,11467,6914,200],
// 次卫靠书房一侧不再向过道伸出额外短墙，纵墙端面与门口边线齐平。
[6967,6864,7667,6864,100],
// 书房柜靠过道的端头由墙包住，外缘与纵墙齐平，门洞起点保持不变。
[8467,6814,8967.0533,6814,200],
[10416.5947,6874,11267.0947,6874,80],[11267,6814,11467,6814,200],
[11467,3414,14567,3414,200],[14467,3514,14467,6614,200],
[12567,6614,14467,6614,200],[12567,6614,12567,6814,200],[11467,6814,11617,6814,200],
[12567,6614,15217,6614,200],[15217,6614,15217,13214,200],
[12567,6714,12567,8564,100],[12567,8514,13337,8514,100],[14137,8514,15117,8514,100],
// DWG 门套 *U73/*U70 的内边为 X=69617/70517，入口位于横向北墙。
// 西侧电视背景墙后的旧洞口封回，北侧保留 900 mm 净口。
[11417,8264,11617,8264,200],[11417,8164,11417,13114,200],
[11517,13114,12017,13114,200],[14817,13114,15217,13114,200],
[12017,13114,12017,13814,200],[14817,13114,14817,13814,200],[12017,13814,14817,13814,200],
// 客厅外沿长边与末端 600 mm 短边按用户红线改为 L 型落地窗。
[4517,11114,4517,12514,200],
[817,7514,817,12544,200],[917,12544,3497,12544,200],
// 只保留飘窗处一次内收，删除原先与餐边柜之间重复的东侧墙线。
[3497,11844,3497,12544,200],[3397,11844,3897,11844,200],
[3897,9514,3897,11844,200],[3997,11094,4617,11094,200],
// 上部 900 mm 区间含 100 mm 门垛和 800 mm 净门洞；其下进深 2230 mm。
[3897,8564,3897,8614,100],
[917,8564,3897,8564,100],[817,7414,1817,7414,200],[1817,6514,1817,7414,200],
[1817,6814,2867,6814,200],[3967,6814,4467,6814,200],
// 入户照片确认圆弧柜靠客厅，储物间门在其北侧；隔墙随门柜位置对调。
[2867,6864,2867,7014,100],[2867,7814,2867,8514,100],
];
// 已读取的尺寸端点，不把窗台、门轨与有效使用区混成一种尺寸。
const dimensionEvidence={studyWidth:2799.9479,studyClearDepth:2940,studyDoor:1449.5414,studyPocket:850.5,studyTrack:2300.0154};

/** 用 DWG 毫米坐标重建结构，同时迁移已确认的家具与灯位。 */
export function calibrateFromCAD({THREE,model,mat,groups,wallMeshes,doorRoot,storageRoot,wallHeight,render}){
const X=n=>(n-8017)/1000,Z=n=>(n-7914)/1000;
const oldTable=model.getObjectByName('Dining_Table'),oldTableCenter=oldTable.position.clone();
const oldSofa=model.getObjectByName('Living_Sofa').position.clone();
const oldCoffee=model.getObjectByName('Coffee_Table').position.clone();
const oldLivingRug=model.getObjectByName('Living_Rug').position.clone();
// 按用户红框和绿框向西调整餐桌、沙发；茶几和地毯跟随沙发区域重排。
const targetTable=new THREE.Vector3(X(5467),oldTableCenter.y,Z(9914));
const targetSofa=new THREE.Vector3(X(7067),oldSofa.y,Z(9914));
const targetCoffee=new THREE.Vector3(X(8267),oldCoffee.y,Z(9914));
const targetLivingRug=new THREE.Vector3(X(7667),oldLivingRug.y,Z(9914));
const oldWalls=new Set([...wallMeshes,...(window.wallCaps||[])]);
// 清除旧描点结构，避免新旧墙体叠加；照片确认的家具和装饰保留。
for(const m of [...model.children])if(oldWalls.has(m)||m.name.endsWith('_Floor')||m.name.endsWith('_Joints')||m.name==='Wall_Footing'||m.name.endsWith('_Threshold')||['Door_Track','Storage_Door_Track','Living_Window','Master_Bay','Master_Window','Secondary_Window','Secondary_Bay_Window_Seat','Secondary_Bay_Stone','Study_Window','Study_Window_Sill','Child_Window'].includes(m.name)){
model.remove(m);m.geometry?.dispose();
}
wallMeshes.length=0;window.wallCaps=[];
model.updateMatrixWorld(true);
/** 按所属房间迁移旧家具坐标；结构不再通过此函数估算。 */
function migratePoint(point,name=''){
const px=point.x/S+400,py=point.z/S+325;
let a,b;
if(/^Dining_Sideboard_/.test(name)){
a=[204,204+.39/S,420,479];b=[3997,4387,9514,11094];
if(/Door_Header|Door_Jamb/.test(name)){a[2]=366;a[3]=419;b[2]=8714;b[3]=9514;}
}
else if(/^Study_/.test(name)||(px>=424&&px<=563&&py<283)){a=[430,556,118,282];b=[8567,11367,3714,6654];}
else if(/^Kitchen_/.test(name)||(px>=226&&px<344&&py<283)){a=[232,338,39,279];b=[4567,6767,1914,6714];}
else if(px>=344&&px<424&&py<283){a=[349,420,118,282];b=[6967,8437,3514,6814];}
else if(/^Child_/.test(name)||(px>=563&&py<274)){a=[572,710,119,263];b=[11567,14367,3514,6514];}
else if(px>=620&&py<371){a=[628,744,280,361];b=[12667,15117,6744,8464];}
else if(/^Secondary_/.test(name)||(px<204&&py>=366)){a=[49,196,370,513];b=[917,3797,8614,11744];}
else if(px>=565&&py>=371){a=[573,744,371,577];b=[11517,15117,8564,13014];}
else if(/^Storage_/.test(name)||(px<147&&py<366)){a=[49,147,287,365];b=[917,2867,6914,8514];}
else if(px<204&&py<366){a=[147,202,287,365];b=[2867,4417,6914,8514];}
else {a=[226,565,283,584];b=[4617,11317,6914,13014];}
return new THREE.Vector3(X(b[0]+(px-a[0])/(a[1]-a[0])*(b[1]-b[0])),point.y,Z(b[2]+(py-a[2])/(a[3]-a[2])*(b[3]-b[2])));
}
/** 判断需要保留真实尺寸的整组家具，并返回整体位移。 */
function furnitureShift(m){
let node=m;const names=[];while(node&&node!==model){names.push(node.name);node=node.parent;}
if(names.some(n=>n==='Living_Sofa'||n.startsWith('Sofa_')))return targetSofa.clone().sub(oldSofa);
if(names.some(n=>n==='Dining_Table'||n==='Dining_Pedestal'||n==='Dining_Chair'))return targetTable.clone().sub(oldTableCenter);
if(names.some(n=>n==='Coffee_Table'||n==='Coffee_Tray'||n==='Coffee_Book'))return targetCoffee.clone().sub(oldCoffee);
if(names.includes('Living_Rug'))return targetLivingRug.clone().sub(oldLivingRug);
return null;
}
// 只迁移 X/Z，垂直高度保持 2.28 米与已确认的家具高度。
const meshes=[];model.traverse(m=>{if(m.isMesh||m.isLineSegments)meshes.push(m);});
for(const m of meshes){
if(!m.geometry?.attributes.position)continue;
const shift=furnitureShift(m),geometry=m.geometry.clone(),position=geometry.attributes.position;
const inverse=m.matrixWorld.clone().invert(),world=new THREE.Vector3();
for(let i=0;i<position.count;i++){
world.fromBufferAttribute(position,i).applyMatrix4(m.matrixWorld);
const mapped=shift?world.clone().add(shift):migratePoint(world,m.name);
mapped.applyMatrix4(inverse);position.setXYZ(i,mapped.x,mapped.y,mapped.z);
}
position.needsUpdate=true;geometry.computeBoundingBox();geometry.computeBoundingSphere();if(m.isMesh)geometry.computeVertexNormals();m.geometry=geometry;
}
// 家具通过顶点保持整组尺寸，保留世界包围盒作为后续核验依据。
for(const g of Object.values(groups)){
g.anchor.copy(migratePoint(g.anchor));
for(const light of g.lights)light.position.copy(migratePoint(light.position));
}
groups.dining.anchor.set(targetTable.x,.55,targetTable.z);groups.dining.lights.forEach(l=>l.position.set(targetTable.x,l.position.y,targetTable.z));
groups.living.anchor.set(targetCoffee.x,.55,targetCoffee.z);groups.living.lights.forEach((l,i)=>l.position.set(targetCoffee.x,l.position.y,targetCoffee.z+(i-1)*.18));
// 餐厅/客厅光斑随真实桌位重新定位，避免旧灯位与桌面偏离。
for(const id of ['dining','living'])for(const pool of groups[id].pools){
if(pool.name.endsWith('_Glow')){pool.geometry.dispose();pool.geometry=new THREE.PlaneGeometry(id==='dining'?2.3:1.8,id==='dining'?2.3:1.8);pool.rotation.set(-Math.PI/2,0,0);pool.position.set(groups[id].anchor.x,.015,groups[id].anchor.z);}
}
// 客厅控制图标、三盏射灯照明和地面光效一起移到用户标注位置。
groups.living.anchor.set(X(9767),.55,Z(9914));
groups.living.lights.forEach((light,i)=>light.position.set(groups.living.anchor.x,light.position.y,groups.living.anchor.z+(i-1)*.18));
groups.living.pools.forEach(pool=>pool.position.set(groups.living.anchor.x,.015,groups.living.anchor.z));
groups.living.anchors.forEach((anchor,i)=>{anchor.x=groups.living.anchor.x;anchor.z=groups.living.anchor.z+(i-1)*.18;});
// 按用户蓝圈与黄圈移动按钮锚点，保留顶部灯带和阳台射灯的实际照明位置。
groups.ceiling.anchor.set(X(7767),.55,Z(8714));
groups.balcony.anchor.set(X(7867),.55,Z(12614));
/** 创建以真实 CAD 点为边界的地面，供几何尺寸检查。 */
function floor(name,points,wood){
const shape=new THREE.Shape();points.forEach(([x,z],i)=>i?shape.lineTo(X(x),-Z(z)):shape.moveTo(X(x),-Z(z)));shape.closePath();
const geometry=new THREE.ShapeGeometry(shape);geometry.rotateX(-Math.PI/2);
const mesh=new THREE.Mesh(geometry,wood?mat.wood:mat.floor);mesh.name=name+'_Floor';mesh.position.y=-.005;mesh.userData.cadPoints=points;model.add(mesh);
// 地砖和木板按实际米数生成，避免截图缩放导致纹理也失真。
const minX=Math.min(...points.map(p=>X(p[0]))),maxX=Math.max(...points.map(p=>X(p[0]))),minZ=Math.min(...points.map(p=>Z(p[1]))),maxZ=Math.max(...points.map(p=>Z(p[1]))),step=wood?.19:.8,vertices=[];
/** 将网格线裁剪至房间多边形。 */
function clipped(axis,value){const hits=[];for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length],v1=axis==='z'?Z(a[1]):X(a[0]),v2=axis==='z'?Z(b[1]):X(b[0]);if((v1<=value&&v2>value)||(v2<=value&&v1>value)){const q1=axis==='z'?X(a[0]):Z(a[1]),q2=axis==='z'?X(b[0]):Z(b[1]);hits.push(q1+(value-v1)/(v2-v1)*(q2-q1));}}hits.sort((a,b)=>a-b);for(let i=0;i+1<hits.length;i+=2)vertices.push(...(axis==='z'?[hits[i],.002,value,hits[i+1],.002,value]:[value,.002,hits[i],value,.002,hits[i+1]]));}
for(let z=Math.ceil(minZ/step)*step;z<maxZ;z+=step)clipped('z',z);
if(!wood)for(let x=Math.ceil(minX/step)*step;x<maxX;x+=step)clipped('x',x);
const lines=new THREE.BufferGeometry();lines.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));const joints=new THREE.LineSegments(lines,new THREE.LineBasicMaterial({color:wood?0x604c37:0xc4c7c9,transparent:true,opacity:.2}));joints.name=name+'_Joints';model.add(joints);
}
// 连续底板按外轮廓覆盖门槛、墙脚和房间之间的拼接缝，不改变外部透明背景。
const foundationPoints=[[817,7514],[1817,7514],[1817,6814],[4467,6814],[4467,1814],[6867,1814],[6867,3414],[14567,3414],[14567,6614],[15217,6614],[15217,13214],[14817,13214],[14817,13814],[12017,13814],[12017,13214],[4517,13214],[4517,11414],[3997,11414],[3997,11944],[3597,11944],[3597,12644],[817,12644]];
const baseShape=new THREE.Shape();foundationPoints.forEach(([x,z],i)=>i?baseShape.lineTo(X(x),-Z(z)):baseShape.moveTo(X(x),-Z(z)));baseShape.closePath();
const baseGeometry=new THREE.ShapeGeometry(baseShape);baseGeometry.rotateX(-Math.PI/2);
const base=new THREE.Mesh(baseGeometry,mat.floor);base.name='Continuous_Foundation';base.position.y=-.02;model.add(base);
rooms.forEach(([name,points,wood])=>floor(name,points,wood));
const capMaterial=new THREE.MeshStandardMaterial({color:'#596368',roughness:.8});
/** 创建轴线墙段和齐平压顶，门洞净口不生成几何。 */
function wallSegment([x1,z1,x2,z2,t]){
// CAD 表内端点已是洞口边界，不再向门洞内额外延伸半个墙厚。
const width=Math.max(Math.abs(x2-x1),t)/1000,depth=Math.max(Math.abs(z2-z1),t)/1000;
const mesh=new THREE.Mesh(new THREE.BoxGeometry(width,wallHeight-.035,depth),mat.wall);mesh.name='Wall';mesh.position.set(X((x1+x2)/2),(wallHeight-.035)/2,Z((z1+z2)/2));mesh.userData.cadSegment=[x1,z1,x2,z2,t];model.add(mesh);wallMeshes.push(mesh);
const cap=new THREE.Mesh(new THREE.BoxGeometry(width+.002,.035,depth+.002),capMaterial);cap.name='Wall_Cut_Cap';cap.position.set(mesh.position.x,wallHeight-.0175,mesh.position.z);cap.userData.wall=mesh;model.add(cap);window.wallCaps.push(cap);
}
walls.forEach(wallSegment);
/** 创建 CAD 点定位的门体，不随家具迁移比例改变净宽。 */
function doorPart(name,x,z,w,d,h,material,y=0,parent=model){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);m.name=name;m.position.set(X(x),y+h/2,Z(z));model.add(m);if(parent!==model)parent.attach(m);return m;}
for(const child of [...doorRoot.children]){doorRoot.remove(child);child.geometry?.dispose();}
const studyDoorStart=8967.0533,studyDoorEnd=10416.5947,studyDoorWidth=(studyDoorEnd-studyDoorStart)/1000;
for(let i=0;i<2;i++){
doorPart('Study_Glass_Panel',studyDoorStart+(studyDoorEnd-studyDoorStart)*(i+.5)/2,6914,studyDoorWidth/2,.035,2.2,mat.glass,0,doorRoot);
doorPart('Door_Frame',studyDoorStart+(studyDoorEnd-studyDoorStart)*i/2,6914,.025,.05,2.2,mat.dark,0,doorRoot);
}
doorPart('Door_Track',(studyDoorStart+11267.0947)/2,6914,2.3000414,.06,.025,mat.dark,.015);
for(const child of [...storageRoot.children]){storageRoot.remove(child);child.geometry?.dispose();}
doorPart('Storage_Sliding_Door',2867,8014,.04,.8,2.05,mat.dark,0,storageRoot);
doorPart('Storage_Handle',2897,8144,.025,.06,.22,mat.white,.87,storageRoot);
// 门槛补全仅限通道地面，不改变墙体和已确认的开放阳台。
for(const [name,x,z,w,d] of [['厨房',5647,6814,.94,.22],['次卫',8067,6864,.8,.2],['主卧',12067,8264,.9,.22],['主卫',13737,8514,.8,.2],['次卧',3897,9114,.22,.8],['入户',3417,6814,1.1,.2]])doorPart(name+'_Threshold',x,z,w,d,.012,mat.floor,-.014);
// 主卧门框放在正确入口，门扇向室内打开以便识别通道。
doorPart('Master_Entry_Frame_Left',11617,8264,.04,.22,2.04,mat.dark);
doorPart('Master_Entry_Frame_Right',12517,8264,.04,.22,2.04,mat.dark);
doorPart('Master_Entry_Frame_Top',12067,8264,.94,.22,.04,mat.dark,2.04);
doorPart('Master_Entry_Open_Leaf',11642,8714,.04,.86,2.02,mat.dark);
// 窗、飘窗台面直接放到 CAD 边界，避免旧截图迁移后悬到外墙之外。
doorPart('Master_Bay',13417,13364,2.6,.7,.42,mat.white);
doorPart('Master_Window',13417,13700,2.6,.025,1.35,mat.glass,.65);
doorPart('Secondary_Bay_Window_Seat',2157,12094,2.48,.7,.42,mat.white);
doorPart('Secondary_Bay_Stone',2157,12094,2.48,.7,.035,mat.white,.42);
doorPart('Secondary_Window',2157,12430,2.48,.025,1.3,mat.glass,.65);
// 落地窗在原外墙轴线上连续转角，底框至顶框总高 2.28 米。
const livingWindowFrames=[],livingWindowGlass=new THREE.MeshPhysicalMaterial({color:'#c3d8dd',transparent:true,opacity:.16,roughness:.08,metalness:.05,depthWrite:false});
const windowFrameMaterial=new THREE.MeshStandardMaterial({color:'#30383b',roughness:.55,metalness:.2});
/** 创建并记录窗框，供围护连续性核验。 */
function windowFrame(name,x,z,w,d,h,y=0){const m=doorPart(name,x,z,w,d,h,windowFrameMaterial,y);livingWindowFrames.push(m);return m;}
/** 创建一段落地玻璃及上下横框、竖向分格。 */
function windowRun(name,x1,z1,x2,z2,panes){
const horizontal=z1===z2,length=Math.hypot(x2-x1,z2-z1)/1000;
for(const y of [0,wallHeight-.04])windowFrame(name+'_Rail',(x1+x2)/2,(z1+z2)/2,horizontal?length:.045,horizontal?.045:length,.04,y);
for(let i=0;i<=panes;i++)windowFrame(name+'_Mullion',x1+(x2-x1)*i/panes,z1+(z2-z1)*i/panes,.045,.045,wallHeight);
for(let i=0;i<panes;i++)doorPart(name+'_Glass',x1+(x2-x1)*(i+.5)/panes,z1+(z2-z1)*(i+.5)/panes,horizontal?length/panes-.045:.012,horizontal?.012:length/panes-.045,wallHeight-.08,livingWindowGlass,.04);
}
windowRun('Living_L_Window_Long',4517,13114,11417,13114,1);
windowRun('Living_L_Window_Return',4517,12514,4517,13114,1);
doorPart('Living_Window_Floor_Edge',7967,13064,6.9,.1,.012,mat.floor,-.014);
doorPart('Living_Window_Return_Floor_Edge',4567,12814,.1,.6,.012,mat.floor,-.014);
doorPart('Study_Window',10017,3528,1.8,.025,1.2,mat.glass,.8);
doorPart('Study_Window_Sill',10017,3614,1.8,.2,.045,mat.white,.8);
doorPart('Child_Window',12767,3528,1.8,.025,1.2,mat.glass,.8);
// 保证主卧床头贴实际西墙，床品作为整体平移。
model.updateMatrixWorld(true);
const head=model.getObjectByName('Headboard');if(head){
const b=new THREE.Box3().setFromObject(head),shift=X(11517)-b.min.x;
for(const m of model.children)if(['Master_Bed','Mattress','Headboard','Bed_Throw','Bed_Pillow','Master_Bed_Rug','Master_Bedside'].includes(m.name))m.position.x+=shift;
}
// 电视墙侧柜从背景板右端延伸到落地窗，补齐原先空出的末端。
const tvTall=[];model.traverse(m=>{if(/^Living_TV_(Tall_|Display_)/.test(m.name))tvTall.push(m);});
const tvBox=new THREE.Box3();tvTall.forEach(m=>tvBox.union(new THREE.Box3().setFromObject(m)));
const tvStart=tvBox.min.z,tvOldEnd=tvBox.max.z,tvNewEnd=Z(13014);
/** 只延长侧柜区域，保留白色背景板与中央黑色区域比例。 */
function extendTVSide(m){
const g=m.geometry.clone(),p=g.attributes.position,world=new THREE.Vector3(),inverse=m.matrixWorld.clone().invert();
for(let i=0;i<p.count;i++){world.fromBufferAttribute(p,i).applyMatrix4(m.matrixWorld);if(world.z>tvStart)world.z=tvStart+(world.z-tvStart)*(tvNewEnd-tvStart)/(tvOldEnd-tvStart);world.applyMatrix4(inverse);p.setXYZ(i,world.x,world.y,world.z);}
p.needsUpdate=true;g.computeBoundingBox();g.computeBoundingSphere();g.computeVertexNormals();m.geometry=g;
}
model.traverse(m=>{if(m.isMesh&&/^Living_TV_(Tall_|Display_|Low_Cabinet|Cabinet_Top|Drawer_Seam)/.test(m.name))extendTVSide(m);});
// 绿植移到柜前窗边，避免延长后的柜体与旧植物重叠。
for(const [prefix,x,z] of [['Cozy_Living_Tree_',10517,12414],['Living_Plant_',5117,12414]]){
const parts=model.children.filter(m=>m.name.startsWith(prefix)),b=new THREE.Box3();parts.forEach(m=>b.union(new THREE.Box3().setFromObject(m)));
if(parts.length){const center=b.getCenter(new THREE.Vector3());for(const m of parts){m.position.x+=X(x)-center.x;m.position.z+=Z(z)-center.z;}}
}
const doors=[[5647,6814],[8067,6864],[(studyDoorStart+studyDoorEnd)/2,6914],[12067,6814],[12067,8264],[13737,8514],[3897,9114],[3417,6814],[2867,7414]].map(([x,z])=>({x:X(x),z:Z(z)}));
/** 获取实际世界包围盒尺寸，用于浏览器核验和报告。 */
function bounds(name){const m=model.getObjectByName(name);if(!m)return null;model.updateMatrixWorld(true);const b=new THREE.Box3().setFromObject(m);return {min:b.min.toArray(),max:b.max.toArray(),size:b.getSize(new THREE.Vector3()).toArray()};}
const result={source:'DWG深化下单图纸',units:'meters',dimensions:dimensionEvidence,doors,bounds,roomPoints:rooms,tableTarget:targetTable.toArray(),sofaTarget:targetSofa.toArray(),enclosureMeshes:[...wallMeshes,...livingWindowFrames],livingWindow:{longLength:6.9,returnLength:.6,height:wallHeight,corner:[X(4517),Z(13114)]},tvCabinetEnd:tvNewEnd,masterDoor:{center:[X(12067),Z(8264)],oldCenter:[X(11417),Z(9114)],width:.9,sourceBlocks:['*U73','*U70']}};
// 按最新标注清理全部绿植、儿童房植物台及卫浴设施，保留结构与地面。
model.updateMatrixWorld(true);
const structural=new Set([...wallMeshes,...window.wallCaps,...livingWindowFrames]);
for(const m of [...model.children]){
if(!m.isMesh||structural.has(m)||m.name.endsWith('_Floor')||m.name.endsWith('_Threshold'))continue;
const b=new THREE.Box3().setFromObject(m),center=b.getCenter(new THREE.Vector3());
const masterBath=center.x>X(12667)&&center.x<X(15117)&&center.z>Z(6744)&&center.z<Z(8564);
const guestBath=center.x>X(6967)&&center.x<X(8437)&&center.z>Z(3514)&&center.z<Z(6814);
const plant=/_Pot$|_Leaf$/.test(m.name);
const markedFixture=/^(Vanity|Washbasin|Toilet_)/.test(m.name)||(!m.name&&(masterBath||guestBath));
if(plant||m.name==='Child_Desk'||markedFixture||masterBath){model.remove(m);m.geometry?.dispose();}
}
// 入户柜沿现有储物间隔墙布置，保留既有推拉门洞，不侵占门口通道。
const entryDark=new THREE.MeshStandardMaterial({color:'#171a1c',roughness:.72});
const entryBlack=new THREE.MeshStandardMaterial({color:'#10171b',roughness:.65});
// 圆弧柜端头采用真实平面圆角轮廓，柜顶与 2.28 米墙顶齐平。
const depth=.42,length=.38,r=.11,cabShape=new THREE.Shape();
cabShape.moveTo(0,0);cabShape.lineTo(depth-r,0);cabShape.quadraticCurveTo(depth,0,depth,r);
cabShape.lineTo(depth,length);cabShape.lineTo(0,length);cabShape.closePath();
const cabGeometry=new THREE.ExtrudeGeometry(cabShape,{depth:wallHeight,bevelEnabled:false,curveSegments:16});
// 轮廓横轴为进深、纵轴为柜宽；挤出方向转为竖直向上。
cabGeometry.rotateX(Math.PI/2);cabGeometry.translate(X(2867),wallHeight,Z(6914));
const roundCab=new THREE.Mesh(cabGeometry,entryDark);roundCab.name='Entry_Rounded_Tall_Cabinet';model.add(roundCab);
doorPart('Entry_Tall_Cabinet_Back',2887,7404,.04,.22,wallHeight,entryDark);
doorPart('Entry_Tall_Cabinet_End',3077,7564,.42,.10,wallHeight,entryDark);
doorPart('Entry_Tall_Cabinet_Cap',3077,7404,.42,.22,.10,entryDark,wallHeight-.10);
// 开放格下方三层抽屉，底部保留开放收纳格。
doorPart('Entry_Drawer_Cabinet',3087,7404,.4,.22,.65,entryDark,.4);
for(const y of [.615,.83])doorPart('Entry_Drawer_Seam',3289,7404,.006,.21,.008,entryBlack,y);
doorPart('Entry_Niche_Counter',3087,7404,.405,.23,.025,entryBlack,1.05);
// 照片中的植物图案是背板装饰；以印花纹理表现，不新增盆栽或叶片实体。
const artCanvas=document.createElement('canvas');artCanvas.width=256;artCanvas.height=512;
const art=artCanvas.getContext('2d');art.fillStyle='#192522';art.fillRect(0,0,256,512);
for(let i=0;i<28;i++){
const x=(i*73)%256,y=(i*97)%512;art.save();art.translate(x,y);art.rotate(i*.71);
art.fillStyle=['#697453','#9a9b65','#b3955d','#3f5749'][i%4];art.beginPath();art.ellipse(0,0,10+i%8,32+i%15,0,0,Math.PI*2);art.fill();art.strokeStyle='#bab398';art.lineWidth=1;art.beginPath();art.moveTo(0,-30);art.lineTo(0,30);art.stroke();art.restore();
}
const artTexture=new THREE.CanvasTexture(artCanvas);artTexture.colorSpace=THREE.SRGBColorSpace;
const backboard=new THREE.Mesh(new THREE.PlaneGeometry(.22,1.1),new THREE.MeshStandardMaterial({map:artTexture,roughness:.85}));
backboard.name='Entry_Niche_Printed_Backboard';backboard.rotation.y=Math.PI/2;backboard.position.set(X(2925),1.62,Z(7404));model.add(backboard);
doorPart('Entry_Niche_Top_Inset',3097,7404,.28,.18,.02,entryBlack,2.16);
// 推拉门采用同色平板、黑色凹槽拉手与顶部轨道，滑开后收在柜后。
const storagePanel=storageRoot.getObjectByName('Storage_Sliding_Door');storagePanel.material=entryDark;storagePanel.geometry.dispose();storagePanel.geometry=new THREE.BoxGeometry(.04,2.2,.8);storagePanel.position.y=1.1;
const oldHandle=storageRoot.getObjectByName('Storage_Handle');if(oldHandle){storageRoot.remove(oldHandle);oldHandle.geometry.dispose();}
doorPart('Storage_Handle',2890,8234,.008,.035,.27,entryBlack,.86,storageRoot);
doorPart('Entry_Sliding_Track',2867,7664,.045,1.5,.035,entryBlack,wallHeight-.035);
doorPart('Entry_Sliding_Jamb',2867,8414,.055,.045,wallHeight,entryDark);
result.entryCabinet={height:wallHeight,width:.7,depth:.42,doorWidth:.8,doorHeight:2.2};
// 按照片将整套柜体与门沿南北轴镜像：圆弧端朝南侧客厅，开放格靠北侧储物间门。
// 采用整体变换保留圆弧、纹理和开门联动；门滑开时实际向南收进柜后。
const entryAssembly=new THREE.Group();entryAssembly.name='Entry_Cabinet_And_Door';model.add(entryAssembly);
for(const m of [...model.children])if(m!==entryAssembly&&(m.name.startsWith('Entry_')||m===storageRoot))entryAssembly.attach(m);
entryAssembly.scale.z=-1;entryAssembly.position.z=2*Z(7714);
// 用户确认柜体整体转 90°：柜背贴次卧北墙，圆弧端朝东侧次卧门，开放格靠储物间。
// 门扇与轨道留在储物间隔墙上，避免把门洞随柜子旋转。
model.updateMatrixWorld(true);
const entryCabinetTurn=new THREE.Group();entryCabinetTurn.name='Entry_Cabinet_Turned';model.add(entryCabinetTurn);
for(const m of [...entryAssembly.children])if(m!==storageRoot&&!m.name.startsWith('Entry_Sliding_'))entryCabinetTurn.attach(m);
entryCabinetTurn.rotation.y=Math.PI/2;
entryCabinetTurn.position.set(X(2867)-Z(7814),0,Z(8514)+X(2867));
result.entryCabinet.roundedEndFacing='secondaryBedroomDoor';result.entryCabinet.doorSide='north';result.entryCabinet.rotationDegrees=90;
// 柜体绕过次卧门口墙角，与门套连成一体，圆弧位于外露转角处。
// 用 L 形轮廓避开次卧室内区域，南侧收口到门洞北边，不伸入门洞。
const oldRoundedEnd=model.getObjectByName('Entry_Rounded_Tall_Cabinet');oldRoundedEnd.removeFromParent();oldRoundedEnd.geometry.dispose();
const roundedLength=.81,roundedDepth=.62,roundedRadius=.11,extendedShape=new THREE.Shape();
extendedShape.moveTo(0,0);extendedShape.lineTo(roundedLength-roundedRadius,0);extendedShape.quadraticCurveTo(roundedLength,0,roundedLength,roundedRadius);
extendedShape.lineTo(roundedLength,roundedDepth-roundedRadius);extendedShape.quadraticCurveTo(roundedLength,roundedDepth,roundedLength-roundedRadius,roundedDepth);
extendedShape.lineTo(.61,roundedDepth);extendedShape.lineTo(.61,.42);extendedShape.lineTo(0,.42);extendedShape.closePath();
const extendedGeometry=new THREE.ExtrudeGeometry(extendedShape,{depth:wallHeight,bevelEnabled:false,curveSegments:24});
extendedGeometry.rotateX(Math.PI/2);extendedGeometry.translate(X(3187),wallHeight,Z(8094));
const extendedRoundedEnd=new THREE.Mesh(extendedGeometry,entryDark);extendedRoundedEnd.name='Entry_Rounded_Tall_Cabinet';model.add(extendedRoundedEnd);
// 次卧门套采用同色收口，北侧门套与柜体直接衔接，入口中部保持畅通。
// 删除餐边柜早期模型附带的另一套外凸门框，统一只留与圆弧柜齐平的一套门套。
for(const m of [...model.children])if(/^Dining_Sideboard_Door_(Header|Jamb)$/.test(m.name)){model.remove(m);m.geometry?.dispose();}
doorPart('Entry_Secondary_Door_North_Jamb',3897,8724,.2,.02,wallHeight,entryDark);
doorPart('Entry_Secondary_Door_South_Jamb',3897,9504,.2,.02,wallHeight,entryDark);
doorPart('Entry_Secondary_Door_Header',3897,9114,.2,.8,wallHeight-2.04,entryDark,2.04);
// 圆弧柜内部的门垛向内收，完全藏入黑色柜体，避免浅色墙角穿出圆弧表面。
result.entryCabinet.width=1.13;result.entryCabinet.roundedEndX=X(3997);result.entryCabinet.roundedEndZ=Z(8714);result.entryCabinet.integratedSecondaryDoor=true;
// 次卧柜按最新照片重做：三扇通高门、第四扇上柜，右侧抽屉延伸后留出空位。
for(const m of [...model.children])if(/^Secondary_(White_Wardrobe|Wardrobe_|Drawer_)/.test(m.name)){model.remove(m);m.geometry?.dispose();}
const secondaryWhite=new THREE.MeshStandardMaterial({color:'#eeeee9',roughness:.6});
const secondaryBlack=new THREE.MeshStandardMaterial({color:'#191d20',roughness:.7});
// 灰木纹横向细纹用于抽屉立面，避免普通纯色块丢失照片中的木纹层次。
const drawerCanvas=document.createElement('canvas');drawerCanvas.width=512;drawerCanvas.height=256;
const drawerContext=drawerCanvas.getContext('2d');drawerContext.fillStyle='#827d75';drawerContext.fillRect(0,0,512,256);
for(let i=0;i<180;i++){drawerContext.strokeStyle=i%3?'rgba(225,218,205,.12)':'rgba(45,40,35,.16)';drawerContext.beginPath();drawerContext.moveTo(0,i*1.43);drawerContext.bezierCurveTo(150,i*1.43+Math.sin(i)*5,350,i*1.43-3,512,i*1.43+2);drawerContext.stroke();}
const drawerTexture=new THREE.CanvasTexture(drawerCanvas);drawerTexture.colorSpace=THREE.SRGBColorSpace;
const secondaryWood=new THREE.MeshStandardMaterial({map:drawerTexture,roughness:.78});
// 左端贴西墙，柜体总长缩至 2.17 米，为 760 mm 门扇向内打开 90°留出余量。
doorPart('Secondary_White_Wardrobe',1592,8914,1.35,.6,wallHeight,secondaryWhite);
doorPart('Secondary_Drawer_Upper_Cabinet',2492,8914,.45,.6,wallHeight-.9,secondaryWhite,.9);
for(const x of [1367,1817,2267])doorPart('Secondary_Wardrobe_Seam',x,9216,.006,.006,wallHeight-.04,secondaryBlack,.02);
// 两根黑色长拉手分别设在成对柜门的接缝处，第四扇上柜的拉手落在抽屉左缘。
for(const x of [1367,2267])doorPart('Secondary_Wardrobe_Handle',x,9225,.018,.024,.85,secondaryBlack,.07);
doorPart('Secondary_Drawer_Cabinet',2677,8924,.82,.62,.88,secondaryWood);
doorPart('Secondary_Drawer_Counter',2677,8924,.83,.63,.02,secondaryWood,.88);
for(const y of [.293,.586])doorPart('Secondary_Drawer_Line',2677,9237,.804,.006,.008,secondaryBlack,y);
result.secondaryCabinet={height:wallHeight,fullDoors:3,upperDoors:1,drawers:3,upperSideOpening:.37,totalLength:2.17,doorOpeningDegrees:90};
// 厨房按实景改为双排灰色橱柜，北端独立留出生活阳台设备区。
model.updateMatrixWorld(true);
for(const m of [...model.children]){
if(!m.isMesh||structural.has(m)||m.name.endsWith('_Floor')||m.name.endsWith('_Threshold'))continue;
const b=new THREE.Box3().setFromObject(m),center=b.getCenter(new THREE.Vector3());
const oldDetail=center.x>X(4567)&&center.x<X(6767)&&center.z>Z(3514)&&center.z<Z(6714)&&(!m.name||m.name==='Cabinet_Seam');
if(/^Kitchen_|^Hob_Ring$/.test(m.name)||oldDetail){model.remove(m);m.geometry?.dispose();}
}
const kitchenGray=new THREE.MeshStandardMaterial({color:'#787b77',roughness:.32,metalness:.12});
const kitchenStone=new THREE.MeshStandardMaterial({color:'#e3ddcd',roughness:.35});
const kitchenSplash=new THREE.MeshStandardMaterial({color:'#8a8276',roughness:.4});
const kitchenMetal=new THREE.MeshStandardMaterial({color:'#909b9f',metalness:.8,roughness:.25});
const kitchenDark=new THREE.MeshStandardMaterial({color:'#171c1e',roughness:.3});
const ledMaterial=new THREE.MeshStandardMaterial({color:'#ffe1a1',emissive:'#ffc36a',emissiveIntensity:.65});
// 左侧水槽、右侧灶台；左排入口端预留 1 米冰箱位，保留原墙体。
for(const [side,x,face,upperX] of [['Left',4867,5170,4742],['Right',6467,6164,6592]]){
const cabinetLength=side==='Left'?2.2:3.2,centerZ=3514+cabinetLength*500,doorCount=side==='Left'?4:6;
doorPart('Kitchen_'+side+'_Base',x,centerZ,.6,cabinetLength,.8,kitchenGray,.06);
doorPart('Kitchen_'+side+'_Plinth',x,centerZ,.55,cabinetLength-.02,.06,kitchenDark);
doorPart('Kitchen_'+side+'_Top',x,centerZ,.62,cabinetLength,.045,kitchenStone,.86);
doorPart('Kitchen_'+side+'_Backsplash',side==='Left'?4575:6759,centerZ,.016,cabinetLength,.65,kitchenSplash,.905);
doorPart('Kitchen_'+side+'_Upper_Cabinet',upperX,centerZ,.35,cabinetLength,wallHeight-1.55,kitchenGray,1.55);
doorPart('Kitchen_'+side+'_Under_Cabinet_LED',side==='Left'?4912:6422,centerZ,.018,cabinetLength-.04,.012,ledMaterial,1.545);
for(let i=1;i<doorCount;i++){
doorPart('Kitchen_'+side+'_Base_Seam',face,3514+i*cabinetLength*1000/doorCount,.006,.006,.76,kitchenDark,.08);
doorPart('Kitchen_'+side+'_Upper_Seam',side==='Left'?4919:6415,3514+i*cabinetLength*1000/doorCount,.006,.006,wallHeight-1.58,kitchenDark,1.56);
}
doorPart('Kitchen_'+side+'_Recessed_Pull',face,centerZ,.008,cabinetLength-.04,.015,kitchenDark,.83);
}
// 冰箱机身为示意尺寸，放入已确认的 1000 mm 预留区，两端各留 50 mm。
const fridgeSilver=new THREE.MeshStandardMaterial({color:'#afb5b7',metalness:.45,roughness:.35});
// 机身与门板合计深 600 mm，与左排台柜齐平，拉手采用凹槽式。
doorPart('Kitchen_Fridge',4854.5,6214,.575,.9,1.95,fridgeSilver);
doorPart('Kitchen_Fridge_Front',5154.5,6214,.025,.88,1.91,fridgeSilver,.02);
doorPart('Kitchen_Fridge_Freezer_Seam',5168,6214,.006,.88,.009,kitchenDark,.66);
doorPart('Kitchen_Fridge_Door_Seam',5168,6214,.006,.008,1.25,kitchenDark,.68);
for(const z of [6189,6239])doorPart('Kitchen_Fridge_Handle',5168,z,.008,.018,.45,kitchenDark,.92);
doorPart('Kitchen_Fridge_Upper_Cabinet',4867,6214,.6,1,wallHeight-1.98,kitchenGray,1.98);
// 照片中的蓝灰色壁挂直饮机紧邻冰箱，位于台面与吊柜之间。
const dispenserBlue=new THREE.MeshStandardMaterial({color:'#626e83',metalness:.18,roughness:.28});
doorPart('Kitchen_Water_Dispenser',4652,5414,.14,.4,.48,dispenserBlue,1.025);
doorPart('Kitchen_Water_Dispenser_Control',4730,5414,.018,.42,.13,dispenserBlue,1.375);
doorPart('Kitchen_Water_Dispenser_Spout',4750,5414,.055,.05,.075,dispenserBlue,1.21);
doorPart('Kitchen_Water_Dispenser_Nozzle',4774,5414,.018,.025,.018,kitchenMetal,1.19);
doorPart('Kitchen_Sink',4867,4564,.46,.85,.018,kitchenMetal,.906);
for(const z of [4364,4764])doorPart('Kitchen_Sink_Bowl',4867,z,.36,.34,.012,kitchenDark,.925);
// 弧形龙头用管线建模，保持台面上方的金属轮廓。
const faucetCurve=new THREE.CatmullRomCurve3([new THREE.Vector3(X(4667),.92,Z(4564)),new THREE.Vector3(X(4667),1.2,Z(4564)),new THREE.Vector3(X(4787),1.25,Z(4564)),new THREE.Vector3(X(4867),1.14,Z(4564))]);
const faucet=new THREE.Mesh(new THREE.TubeGeometry(faucetCurve,24,.012,8,false),kitchenMetal);faucet.name='Kitchen_Faucet';model.add(faucet);
doorPart('Kitchen_Hob',6467,4664,.48,.76,.022,kitchenDark,.907);
for(const z of [4464,4864]){
const burner=new THREE.Mesh(new THREE.TorusGeometry(.11,.018,8,32),kitchenMetal);burner.name='Kitchen_Burner';burner.rotation.x=-Math.PI/2;burner.position.set(X(6467),.947,Z(z));model.add(burner);
}
doorPart('Kitchen_Hood',6557,4664,.42,.8,.09,kitchenMetal,1.46);
// 生活阳台黑色玻璃推拉门：左扇保留玻璃，右侧净口敞开以便看见设备。
for(const x of [4567,6767])doorPart('Utility_Door_Jamb',x,3514,.04,.06,wallHeight,kitchenDark);
doorPart('Utility_Door_Track',5667,3514,2.2,.07,.04,kitchenDark,wallHeight-.04);
doorPart('Utility_Door_Bottom_Track',5667,3514,2.2,.07,.015,kitchenMetal);
doorPart('Utility_Door_Glass',5042,3514,.91,.012,wallHeight-.1,mat.glass,.05);
doorPart('Utility_Door_Meeting_Stile',5517,3514,.035,.04,wallHeight,kitchenDark);
const utilityWhite=new THREE.MeshStandardMaterial({color:'#d8d9d2',roughness:.5});
// 从厨房向生活阳台看，左为滚筒洗衣机，右为空调外机，设备正面朝厨房。
doorPart('Utility_Washing_Machine',4892,2364,.65,.65,.86,utilityWhite);
doorPart('Utility_Washer_Control',4892,2691,.59,.012,.11,kitchenMetal,.71);
const washerDoor=new THREE.Mesh(new THREE.CircleGeometry(.185,48),kitchenDark);washerDoor.name='Utility_Washer_Door';washerDoor.position.set(X(4892),.415,Z(2700));model.add(washerDoor);
const washerRing=new THREE.Mesh(new THREE.TorusGeometry(.185,.025,12,48),kitchenMetal);washerRing.name='Utility_Washer_Drum_Rim';washerRing.position.set(X(4892),.415,Z(2712));model.add(washerRing);
doorPart('Utility_AC_Outdoor_Unit',6342,2339,.85,.5,.65,utilityWhite,.12);
doorPart('Utility_AC_Fan_Back',6242,2595,.49,.012,.49,kitchenDark,.2);
for(const radius of [.08,.14,.21]){
const ring=new THREE.Mesh(new THREE.TorusGeometry(radius,.006,6,40),kitchenMetal);ring.name='Utility_AC_Fan_Grille';ring.position.set(X(6242),.445,Z(2607));model.add(ring);
}
for(let i=0;i<6;i++)doorPart('Utility_AC_Vent',6622,2601,.18,.012,.012,kitchenMetal,.23+i*.075);
for(const x of [6042,6642])doorPart('Utility_AC_Foot',x,2339,.1,.44,.12,kitchenMetal);
result.kitchen={aisle:1,utilityDepth:1.6,washerSide:'left',outdoorUnitSide:'right',fridgeBayWidth:1,leftCounterLength:2.2,dispenserBesideFridge:true};
// 生活阳台左侧为实墙，外侧和右侧为玻璃栏板，上方保持敞开。
const utilityGlass=new THREE.MeshPhysicalMaterial({color:'#c6dada',transparent:true,opacity:.22,roughness:.12,metalness:.05,depthWrite:false});
/** 创建黑色扶手与透明玻璃栏板，并纳入围护连通性核验。 */
function utilityRailing(x1,z1,x2,z2){
const horizontal=z1===z2,length=Math.hypot(x2-x1,z2-z1)/1000;
for(const y of [.06,1.02])windowFrame('Utility_Balcony_Railing_Rail',(x1+x2)/2,(z1+z2)/2,horizontal?length:.035,horizontal?.035:length,.035,y);
const count=horizontal?2:1;
for(let i=0;i<=count;i++)windowFrame('Utility_Balcony_Railing_Post',x1+(x2-x1)*i/count,z1+(z2-z1)*i/count,.035,.035,1.02,.035);
for(let i=0;i<count;i++)doorPart('Utility_Balcony_Glass',x1+(x2-x1)*(i+.5)/count,z1+(z2-z1)*(i+.5)/count,horizontal?length/count-.035:.012,horizontal?.012:length/count-.035,.925,utilityGlass,.095);
}
utilityRailing(4467,1814,6867,1814);utilityRailing(6867,1814,6867,3514);
result.enclosureMeshes=[...wallMeshes,...livingWindowFrames];
/** 将设备整组围绕机身旋转，正面转向阳台中间，同时让背部贴侧边。 */
function turnUtilityEquipment(prefix,x,z,angle,shiftX=0){
const pivot=new THREE.Vector3(X(x),0,Z(z));
for(const m of model.children.filter(m=>m.name.startsWith(prefix))){m.position.sub(pivot).applyAxisAngle(new THREE.Vector3(0,1,0),angle).add(pivot);m.position.x+=shiftX;m.rotateY(angle);}
}
turnUtilityEquipment('Utility_Wash',4892,2364,Math.PI/2);
turnUtilityEquipment('Utility_AC_',6342,2339,-Math.PI/2,.175);
result.kitchen.utilityOpen=true;result.kitchen.utilityLeftWall=true;result.kitchen.utilityGlazedSides=['front','right'];result.kitchen.washerFacing='right';result.kitchen.outdoorUnitFacing='left';
// 次卫以最新照片恢复干湿分区：入口左侧浴室柜，内侧马桶，北端淋浴区。
const oldShower=model.getObjectByName('Shower_Glass');if(oldShower){model.remove(oldShower);oldShower.geometry?.dispose();}
const bathTile=new THREE.MeshStandardMaterial({color:'#aaa99f',roughness:.45});
const bathWood=new THREE.MeshStandardMaterial({map:drawerTexture,color:'#d6d0c5',roughness:.65});
const bathPorcelain=new THREE.MeshStandardMaterial({color:'#eeeee6',roughness:.25});
const bathMirror=new THREE.MeshStandardMaterial({color:'#b6c6c8',metalness:.8,roughness:.12});
// 黑色石材用细浅纹理表现照片中的台面，台盆位置通过分段台面留口。
const marbleCanvas=document.createElement('canvas');marbleCanvas.width=512;marbleCanvas.height=256;
const marble=marbleCanvas.getContext('2d');marble.fillStyle='#171b1c';marble.fillRect(0,0,512,256);
for(let i=0;i<12;i++){marble.strokeStyle='rgba(220,214,197,.28)';marble.lineWidth=.6;marble.beginPath();marble.moveTo(i*47,0);marble.bezierCurveTo(i*47-80,75,i*47+50,130,i*47-40,256);marble.stroke();}
const marbleTexture=new THREE.CanvasTexture(marbleCanvas);marbleTexture.colorSpace=THREE.SRGBColorSpace;
const bathStone=new THREE.MeshStandardMaterial({map:marbleTexture,roughness:.26});
doorPart('GuestBath_West_Tile',6976,5164,.016,3.3,wallHeight-.04,bathTile);
doorPart('GuestBath_East_Tile',8428,5164,.016,3.3,wallHeight-.04,bathTile);
// 干区柜悬空安装，保留入口右侧通道；镜柜延伸至墙顶以下。
doorPart('GuestBath_Vanity_Cabinet',7217,6114,.5,1.1,.55,bathWood,.25);
doorPart('GuestBath_Drawer_Seam',7469,6114,.006,1.08,.012,kitchenDark,.525);
for(const x of [7007,7427])doorPart('GuestBath_Stone_Side',x,6114,.08,1.14,.06,bathStone,.8);
for(const z of [5704,6524])doorPart('GuestBath_Stone_End',7217,z,.34,.32,.06,bathStone,.8);
doorPart('GuestBath_Basin',7217,6114,.34,.52,.04,bathPorcelain,.795);
doorPart('GuestBath_Basin_Interior',7217,6114,.27,.43,.008,new THREE.MeshStandardMaterial({color:'#c8cfc9',roughness:.3}),.837);
doorPart('GuestBath_Faucet_Base',7027,6114,.055,.06,.17,kitchenMetal,.86);
doorPart('GuestBath_Faucet_Spout',7087,6114,.15,.035,.025,kitchenMetal,1.01);
doorPart('GuestBath_Mirror_Cabinet',7032,6114,.12,1.1,1.14,bathWood,1.1);
doorPart('GuestBath_Mirror_Face',7096,6114,.012,1.08,1.1,bathMirror,1.12);
for(const z of [5934,6294])doorPart('GuestBath_Mirror_Seam',7104,z,.004,.004,1.1,kitchenDark,1.12);
doorPart('GuestBath_Mirror_Underlight',7097,6114,.012,1.08,.014,ledMaterial,1.09);
// 干区与马桶区之间留右侧门洞，门套与墙顶齐平。
doorPart('GuestBath_Dry_Partition',7317,5514,.7,.10,wallHeight,bathTile);
for(const x of [7667,8417])doorPart('GuestBath_Wet_Door_Jamb',x,5514,.035,.12,wallHeight,bathWood);
doorPart('GuestBath_Wet_Door_Header',8042,5514,.75,.12,.12,bathWood,wallHeight-.12);
doorPart('GuestBath_Wet_Threshold',8042,5514,.74,.14,.015,bathStone);
// 马桶背靠西墙、朝右侧通道，造型以圆润瓷体和开口座圈表现。
doorPart('GuestBath_Toilet_Tank',7067,5014,.18,.4,.65,bathPorcelain);
const toiletBody=new THREE.Mesh(new THREE.SphereGeometry(1,32,20),bathPorcelain);toiletBody.name='GuestBath_Toilet_Body';toiletBody.scale.set(.32,.22,.2);toiletBody.position.set(X(7307),.27,Z(5014));model.add(toiletBody);
doorPart('GuestBath_Toilet_Pedestal',7257,5014,.28,.27,.22,bathPorcelain);
const toiletSeat=new THREE.Mesh(new THREE.TorusGeometry(.17,.035,12,48),bathPorcelain);toiletSeat.name='GuestBath_Toilet_Seat';toiletSeat.rotation.x=-Math.PI/2;toiletSeat.scale.set(1.45,1,1);toiletSeat.position.set(X(7307),.51,Z(5014));model.add(toiletSeat);
const toiletOpening=new THREE.Mesh(new THREE.CircleGeometry(.13,48),new THREE.MeshStandardMaterial({color:'#8e9d99',roughness:.3}));toiletOpening.name='GuestBath_Toilet_Opening';toiletOpening.rotation.x=-Math.PI/2;toiletOpening.scale.x=1.45;toiletOpening.position.set(X(7307),.501,Z(5014));model.add(toiletOpening);
// 最里侧淋浴玻璃留出门口，北墙增加磨砂窗面、花洒和排水地漏。
doorPart('GuestBath_Shower_Tray',7702,3989,1.44,.95,.025,bathTile,.015);
doorPart('Shower_Glass',7427,4514,.92,.012,2.1,mat.glass,.03);
doorPart('GuestBath_Shower_Rail',7427,4514,.94,.018,.018,kitchenMetal,2.12);
doorPart('GuestBath_Shower_Stile',7897,4514,.018,.018,2.1,kitchenMetal,.03);
doorPart('GuestBath_Shower_Riser',7012,3914,.025,.025,1.1,kitchenMetal,.65);
doorPart('GuestBath_Shower_Mixer',7032,3914,.06,.18,.06,kitchenMetal,.9);
doorPart('GuestBath_Shower_Head',7082,3914,.15,.15,.025,kitchenMetal,1.85);
doorPart('GuestBath_Shower_Drain',8127,3744,.12,.12,.008,kitchenMetal,.044);
doorPart('GuestBath_Window_Frame',7907,3528,.85,.05,1.05,kitchenDark,.9);
doorPart('GuestBath_Frosted_Window',7907,3560,.77,.012,.97,new THREE.MeshStandardMaterial({color:'#bed1d0',roughness:.6}),.94);
result.guestBath={dryVanitySide:'left',wetDoorWidth:.715,showerDepth:.95};
// 主卫按最新照片恢复左侧洗漱台及马桶，右侧为独立玻璃淋浴间。
doorPart('MasterBath_West_Tile',12676,7604,.016,1.72,wallHeight-.04,bathTile);
doorPart('MasterBath_East_Tile',15108,7604,.016,1.72,wallHeight-.04,bathTile);
doorPart('MasterBath_North_Tile',13892,6752,2.45,.016,wallHeight-.04,bathTile);
// 洗漱台靠入口一端，木纹柜悬空，黑石台面分段为白色台盆留口。
doorPart('MasterBath_Vanity_Cabinet',12917,8004,.5,.84,.55,bathWood,.25);
doorPart('MasterBath_Drawer_Seam',13169,8004,.006,.82,.012,kitchenDark,.525);
for(const x of [12707,13127])doorPart('MasterBath_Stone_Side',x,8004,.08,.88,.06,bathStone,.8);
for(const z of [7664,8344])doorPart('MasterBath_Stone_End',12917,z,.34,.2,.06,bathStone,.8);
doorPart('MasterBath_Basin',12917,8004,.34,.48,.04,bathPorcelain,.795);
doorPart('MasterBath_Basin_Interior',12917,8004,.27,.39,.008,new THREE.MeshStandardMaterial({color:'#c8cfc9',roughness:.3}),.837);
doorPart('MasterBath_Faucet_Base',12727,8004,.055,.06,.17,kitchenMetal,.86);
doorPart('MasterBath_Faucet_Spout',12787,8004,.15,.035,.025,kitchenMetal,1.01);
// 镜柜覆盖洗漱台与马桶上方的整段左墙，底部保留黑色开放格。
doorPart('MasterBath_Mirror_Cabinet',12732,7604,.12,1.58,1.07,bathWood,1.17);
doorPart('MasterBath_Mirror_Face',12796,7604,.012,1.55,.95,bathMirror,1.29);
doorPart('MasterBath_Mirror_Open_Shelf',12797,7604,.012,1.55,.12,kitchenDark,1.17);
for(const z of [7214,7604,7994])doorPart('MasterBath_Mirror_Seam',12804,z,.004,.004,.95,kitchenDark,1.29);
// 沿用圆润瓷体马桶造型，整组移至左侧远端，朝向中间通道。
for(const original of model.children.filter(m=>m.name.startsWith('GuestBath_Toilet_'))){
const copy=original.clone();copy.name=original.name.replace('GuestBath_','MasterBath_');copy.position.x+=5.7;copy.position.z+=2.21;model.add(copy);
}
// 右侧淋浴净区贯通房间进深，银色框玻璃门与固定玻璃组成隔断。
doorPart('MasterBath_Shower_Tray',14667,7604,.88,1.68,.025,bathTile,.015);
for(let i=0;i<9;i++)doorPart('MasterBath_Shower_Floor_Joint',14267+i*100,7604,.004,1.64,.003,kitchenMetal,.042);
doorPart('MasterBath_Shower_Fixed_Glass',14217,7144,.012,.7,2.1,mat.glass,.03);
doorPart('MasterBath_Shower_Door_Glass',14217,7869,.012,.75,2.1,mat.glass,.03);
doorPart('MasterBath_Shower_End_Glass',14217,8344,.012,.2,2.1,mat.glass,.03);
for(const z of [6794,7494,8244,8444])doorPart('MasterBath_Shower_Stile',14217,z,.018,.018,2.1,kitchenMetal,.03);
for(const y of [.025,2.12])doorPart('MasterBath_Shower_Rail',14217,7619,.02,1.65,.02,kitchenMetal,y);
doorPart('MasterBath_Shower_Handle',14191,7869,.025,.35,.025,kitchenMetal,.95);
doorPart('MasterBath_Shower_Riser',15072,7504,.025,.025,1.1,kitchenMetal,.65);
doorPart('MasterBath_Shower_Mixer',15052,7504,.06,.18,.06,kitchenMetal,.9);
doorPart('MasterBath_Shower_Head',15002,7504,.15,.15,.025,kitchenMetal,1.85);
doorPart('MasterBath_Shower_Drain',14987,8244,.12,.12,.008,kitchenMetal,.044);
doorPart('MasterBath_Towel_Rail',14187,7144,.025,.48,.025,kitchenMetal,1.3);
result.masterBath={vanitySide:'left',toiletSide:'left',showerSide:'right',showerWidth:.88};
// 主卧整面柜按最新正视图重建，柜位仍沿东墙，保留床位和门洞。
const oldMasterCabinet=model.getObjectByName('Master_Wardrobe');
if(oldMasterCabinet){oldMasterCabinet.traverse(m=>m.geometry?.dispose());model.remove(oldMasterCabinet);}
const masterCabinet=new THREE.Group();masterCabinet.name='Master_Wardrobe';masterCabinet.userData.fullWall=true;model.add(masterCabinet);
const masterGraphite=new THREE.MeshStandardMaterial({color:'#303438',roughness:.7});
/** 创建主卧柜零件并归入整面柜，方便尺寸核验和模型导出。 */
function masterPart(name,x,z,w,d,h,material=masterGraphite,y=0){return doorPart(name,x,z,w,d,h,material,y,masterCabinet);}
// 正面左端是开放格与三层抽屉，背板为印花装饰，不添加实体绿植。
masterPart('Master_Closet_Left_Back',15097,8839,.04,.55,wallHeight);
for(const z of [8579,9099])masterPart('Master_Closet_Left_Side',14817,z,.6,.03,wallHeight);
masterPart('Master_Closet_Left_Drawers',14817,8839,.6,.49,.6,masterGraphite,.06);
for(const y of [.26,.46])masterPart('Master_Closet_Left_Drawer_Seam',14514,8839,.006,.48,.008,entryBlack,y);
for(const y of [.66,1.75,wallHeight-.035])masterPart('Master_Closet_Left_Shelf',14817,8839,.6,.49,.035,masterGraphite,y);
// 中间四扇衣柜门和四扇上层顶柜，顶柜门缝单独水平分隔。
masterPart('Master_Closet_Center_Body',14817,10514,.6,2.8,wallHeight);
for(let i=0;i<4;i++){
const z=9114+(i+.5)*700;
masterPart('Master_Closet_Door',14505,z,.024,.688,1.82,masterGraphite,.025);
masterPart('Master_Closet_Top_Door',14505,z,.024,.688,wallHeight-1.87,masterGraphite,1.87);
}
for(const z of [9814,11214]){
masterPart('Master_Closet_Handle',14486,z,.02,.018,.55,entryBlack,.12);
masterPart('Master_Closet_Top_Handle',14486,z,.02,.018,.08,entryBlack,1.9);
}
for(const z of [9814,10514,11214])masterPart('Master_Closet_Vertical_Seam',14490,z,.006,.008,wallHeight-.04,entryBlack,.02);
masterPart('Master_Closet_Top_Seam',14490,10514,.006,2.8,.012,entryBlack,1.85);
// 靠窗右端缩进柜面，形成上柜、开放背板和梳妆台，而不是通高封闭柜。
masterPart('Master_Closet_Right_Back',15097,12464,.04,1.1,wallHeight);
masterPart('Master_Closet_Right_Upper',14907,12464,.42,1.1,wallHeight-1.38,masterGraphite,1.38);
masterPart('Master_Closet_Right_Upper_Seam',14694,12464,.006,.008,wallHeight-1.4,entryBlack,1.39);
masterPart('Master_Closet_Right_Open_Shelf',14907,12464,.42,1.1,.03,masterGraphite,1.35);
masterPart('Master_Closet_Vanity_Desk',14897,12464,.44,1.1,.035,masterGraphite,.75);
masterPart('Master_Closet_Vanity_Drawer',14897,12464,.44,1.08,.13,masterGraphite,.62);
masterPart('Master_Closet_Vanity_Back',15097,12464,.035,1.08,.62);
masterPart('Master_Closet_Window_Return',14447,12914,1.3,.2,.035,masterGraphite,.75);
masterPart('Master_Closet_Window_Return_Drawer',14147,12914,.7,.2,.12,masterGraphite,.63);
/** 创建朝卧室的印花背板，复用玄关印花材质以避免生成绿植实体。 */
function masterPrintedBack(name,z,width,y,height){const panel=new THREE.Mesh(new THREE.PlaneGeometry(width,height),new THREE.MeshStandardMaterial({map:artTexture,roughness:.85}));panel.name=name;panel.rotation.y=-Math.PI/2;panel.position.set(X(15073),y,Z(z));masterCabinet.add(panel);return panel;}
masterPrintedBack('Master_Closet_Left_Printed_Back',8839,.48,1.2,1.02);
masterPrintedBack('Master_Closet_Right_Printed_Back',12464,1.06,1.065,.54);
result.masterCabinet={height:wallHeight,length:4.45,mainDoors:4,topDoors:4,leftDrawers:3,rightVanity:true};
// 书房柜背贴长墙，柜端延伸至端头墙内侧，消除原描点迁移留下的窄缝。
model.updateMatrixWorld(true);
const studyCabinet=model.getObjectByName('Study_Left_Cabinet'),studyCabinetBox=new THREE.Box3().setFromObject(studyCabinet);
const studyShiftX=X(8567)-studyCabinetBox.min.x,studyStartZ=studyCabinetBox.min.z,studyEndZ=studyCabinetBox.max.z;
const studyCabinetParts=model.children.filter(m=>/^Study_(Left_Cabinet|Cabinet_)/.test(m.name)||(m.name==='Cabinet_Seam'&&new THREE.Box3().setFromObject(m).intersectsBox(studyCabinetBox.clone().expandByScalar(.03))));
for(const m of studyCabinetParts){
const g=m.geometry.clone(),p=g.attributes.position,inverse=m.matrixWorld.clone().invert(),v=new THREE.Vector3();
for(let i=0;i<p.count;i++){
v.fromBufferAttribute(p,i).applyMatrix4(m.matrixWorld);v.x+=studyShiftX;
v.z=studyStartZ+(v.z-studyStartZ)*(Z(6714)-studyStartZ)/(studyEndZ-studyStartZ);
v.applyMatrix4(inverse);p.setXYZ(i,v.x,v.y,v.z);
}
p.needsUpdate=true;g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();m.geometry=g;
}
result.studyCabinet={backX:X(8567),endZ:Z(6714),endWall:true};
// 书房桌面与上方层板按用户确认改为 3 米，北端利用窗台凹位，不侵占玻璃门轨。
for(const m of [...model.children])if(/^(Study_Long_Desk|Study_Upper_Shelf|Study_Desk_Foot|Study_Desk_Leg)$/.test(m.name)){model.remove(m);m.geometry?.dispose();}
// 胡桃木采用深棕底色与顺长边木纹，两块板使用相同材质。
const walnutCanvas=document.createElement('canvas');walnutCanvas.width=256;walnutCanvas.height=1024;
const walnutContext=walnutCanvas.getContext('2d');walnutContext.fillStyle='#604331';walnutContext.fillRect(0,0,256,1024);
for(let i=0;i<160;i++){const x=i*1.7;walnutContext.strokeStyle=i%3?'rgba(187,132,84,.18)':'rgba(35,21,13,.22)';walnutContext.lineWidth=i%4===0?2:.7;walnutContext.beginPath();walnutContext.moveTo(x,0);walnutContext.bezierCurveTo(x+Math.sin(i)*8,300,x-5,700,x+3,1024);walnutContext.stroke();}
const walnutTexture=new THREE.CanvasTexture(walnutCanvas);walnutTexture.colorSpace=THREE.SRGBColorSpace;
const studyWalnut=new THREE.MeshStandardMaterial({map:walnutTexture,roughness:.65});
doorPart('Study_Long_Desk',11067,5114,.6,3,.055,studyWalnut,.75);
doorPart('Study_Upper_Shelf',11217,5114,.3,3,.045,studyWalnut,1.82);
for(const z of [3794,6434]){
doorPart('Study_Desk_Foot',11067,z,.58,.06,.045,kitchenDark,.025);
doorPart('Study_Desk_Leg',11217,z,.04,.06,.69,kitchenDark,.07);
}
const studyDrawers=model.getObjectByName('Study_Center_Drawer');if(studyDrawers)studyDrawers.material=studyWalnut;
result.studyDesk={length:3,shelfLength:3,finish:'walnut',startZ:Z(3614),endZ:Z(6614)};
// 主卧屏风参照现场照片：整块木饰面遮挡，中部采用错落竖向浮雕，而非镂空格栅。
const masterScreen=new THREE.Group();masterScreen.name='Master_Walnut_Screen';model.add(masterScreen);
const screenStart=11517,screenEnd=12717,screenZ=9114,screenCenter=(screenStart+screenEnd)/2;
// 屏风采用照片中的低饱和灰棕木色，独立生成木纹，避免叠乘书房红棕色贴图。
const partitionWoodCanvas=document.createElement('canvas');partitionWoodCanvas.width=256;partitionWoodCanvas.height=1024;
const partitionWoodContext=partitionWoodCanvas.getContext('2d');partitionWoodContext.fillStyle='#77716b';partitionWoodContext.fillRect(0,0,256,1024);
for(let i=0;i<160;i++){
const x=i*1.7;partitionWoodContext.strokeStyle=i%3?'rgba(182,178,171,.10)':'rgba(50,47,44,.14)';partitionWoodContext.lineWidth=i%4===0?1.3:.6;
partitionWoodContext.beginPath();partitionWoodContext.moveTo(x,0);partitionWoodContext.bezierCurveTo(x+Math.sin(i)*5,300,x-3,700,x+2,1024);partitionWoodContext.stroke();
}
const partitionWoodTexture=new THREE.CanvasTexture(partitionWoodCanvas);partitionWoodTexture.colorSpace=THREE.SRGBColorSpace;
const screenWood=new THREE.MeshStandardMaterial({map:partitionWoodTexture,roughness:.9});
doorPart('Master_Screen_Solid_Panel',screenCenter,screenZ,1.2,.055,wallHeight-.035,screenWood,0,masterScreen);
doorPart('Master_Screen_Top_Rail',screenCenter,screenZ,1.2,.08,.035,screenWood,wallHeight-.035,masterScreen);
// 两面以阶梯状细木条和浅暗槽表现照片的竖向错落纹样，上下保持平整木纹。
const screenGroove=new THREE.MeshStandardMaterial({color:'#4d4945',roughness:1});
for(const side of [-1,1])for(let i=0;i<10;i++){
const x=screenStart+60+i*120,bottom=.70+(i%2)*.12,height=.62+(i%3)*.06;
doorPart('Master_Screen_Relief',x,screenZ+side*32,.052,.012,height,screenWood,bottom,masterScreen);
doorPart('Master_Screen_Recess_Line',x-28,screenZ+side*28,.003,.002,height,screenGroove,bottom,masterScreen);
doorPart('Master_Screen_Recess_Step',x-15,screenZ+side*28,.028,.002,.003,screenGroove,bottom+height,masterScreen);
}
result.masterScreen={width:1.2,height:wallHeight,type:'solid-stepped-wood',finish:'walnut',passage:1.77};
// 卧室及卫生间补齐实体门，使用现有门洞，门扇半开以便看到室内布局。
const oldMasterLeaf=model.getObjectByName('Master_Entry_Open_Leaf');if(oldMasterLeaf){model.remove(oldMasterLeaf);oldMasterLeaf.geometry?.dispose();}
const roomDoorMaterial=new THREE.MeshStandardMaterial({color:'#303538',roughness:.65});
const roomDoorSpecs=[
{id:'Master',x:11637,z:8264,width:.86,angle:-35},
{id:'Secondary',x:3897,z:8734,width:.76,angle:-180},
{id:'Child',x:11637,z:6814,width:.81,angle:35},
{id:'MasterBath',x:13357,z:8514,width:.76,angle:35},
{id:'GuestBath',x:7687,z:5514,width:.71,angle:35},
// 入户门安装在玄关北侧现有 1100 mm 门洞内，关闭状态避免遮挡玄关通道。
{id:'Entrance',x:2887,z:6814,width:1.06,angle:0},
];
/** 在指定门轴上创建带双面金属拉手的门扇，旋转方向按房间内部确定。 */
function addRoomDoor(spec){
const pivot=new THREE.Group();pivot.name=spec.id+'_Room_Door';pivot.position.set(X(spec.x),0,Z(spec.z));pivot.rotation.y=spec.angle*Math.PI/180;model.add(pivot);
const leaf=new THREE.Mesh(new THREE.BoxGeometry(spec.width,2.02,.035),roomDoorMaterial);leaf.name=spec.id+'_Room_Door_Leaf';leaf.position.set(spec.width/2,1.01,0);pivot.add(leaf);
for(const side of [-1,1]){
const handle=new THREE.Mesh(new THREE.BoxGeometry(.11,.022,.025),kitchenMetal);handle.name=spec.id+'_Room_Door_Handle';handle.position.set(spec.width-.10,1,side*.032);pivot.add(handle);
}
return pivot;
}
roomDoorSpecs.forEach(addRoomDoor);
// 主卧及次卧已有门套，儿童房和主卫新增门套，顶部与 2.28 米墙顶齐平。
for(const [id,left,right,z] of [['Child',11617,12467,6814],['MasterBath',13337,14137,8514],['Entrance',2867,3967,6814]]){
for(const x of [left,right])doorPart(id+'_Room_Door_Jamb',x,z,.035,.2,2.04,roomDoorMaterial);
doorPart(id+'_Room_Door_Header',(left+right)/2,z,(right-left)/1000+.035,.2,wallHeight-2.04,roomDoorMaterial,2.04);
}
doorPart('Master_Room_Door_Header',12067,8264,.94,.22,wallHeight-2.08,roomDoorMaterial,2.08);
result.roomDoors=roomDoorSpecs.map(d=>({id:d.id,width:d.width,height:2.02,angle:d.angle}));
// 电视墙按最新确认尺寸重建：左侧背景墙 3000 mm，右侧柜 1780 mm，总长 4780 mm。
for(const m of [...model.children])if(m.name.startsWith('Living_TV_')){model.remove(m);m.geometry?.dispose();}
// 电视柜台面、低柜和侧柜共用灰木纹材质，避免台面被误做成黑色。
const tvWoodCanvas=document.createElement('canvas');tvWoodCanvas.width=256;tvWoodCanvas.height=512;
const tvWoodContext=tvWoodCanvas.getContext('2d');tvWoodContext.fillStyle='#99958a';tvWoodContext.fillRect(0,0,256,512);
for(let i=0;i<160;i++){const x=i*1.7;tvWoodContext.strokeStyle=i%3?'rgba(227,222,209,.15)':'rgba(70,67,59,.15)';tvWoodContext.beginPath();tvWoodContext.moveTo(x,0);tvWoodContext.bezierCurveTo(x+Math.sin(i)*4,180,x-3,350,x+2,512);tvWoodContext.stroke();}
const tvWoodTexture=new THREE.CanvasTexture(tvWoodCanvas);tvWoodTexture.colorSpace=THREE.SRGBColorSpace;
const tvOak=new THREE.MeshStandardMaterial({map:tvWoodTexture,roughness:.75});
const tvWhite=new THREE.MeshStandardMaterial({color:'#eceae2',roughness:.8});
const tvFrame=new THREE.MeshStandardMaterial({color:'#171c20',roughness:.4,metalness:.25});
const tvStartMM=8234,tvSplitMM=11234,tvEndMM=13014,tvCenterMM=9734;
doorPart('Living_TV_Backboard',11277,tvCenterMM,.08,3,1.7,tvWhite,.45);
doorPart('Living_TV_Black_Center',11228,tvCenterMM,.018,2.5,1.2,kitchenDark,.7);
// 黑色背景内安装独立电视，细边框与屏面略微前凸，区别于背景板。
doorPart('Living_TV_Television_Frame',11201,tvCenterMM,.035,2.2,1.08,tvFrame,.76);
const screenCanvas=document.createElement('canvas');screenCanvas.width=512;screenCanvas.height=256;
const screenContext=screenCanvas.getContext('2d'),screenGradient=screenContext.createLinearGradient(0,0,512,256);
screenGradient.addColorStop(0,'#263239');screenGradient.addColorStop(.45,'#10171c');screenGradient.addColorStop(1,'#05090c');screenContext.fillStyle=screenGradient;screenContext.fillRect(0,0,512,256);
const screenTexture=new THREE.CanvasTexture(screenCanvas);screenTexture.colorSpace=THREE.SRGBColorSpace;
doorPart('Living_TV_Television_Screen',11179,tvCenterMM,.008,2.14,1.02,new THREE.MeshStandardMaterial({map:screenTexture,roughness:.28,metalness:.1}),.79);
doorPart('Living_TV_Low_Cabinet',11092,tvCenterMM,.45,3,.31,tvOak,.07);
doorPart('Living_TV_Cabinet_Top',11092,tvCenterMM,.46,3,.025,tvOak,.38);
for(let i=1;i<5;i++)doorPart('Living_TV_Drawer_Seam',10864,tvStartMM+i*600,.006,.008,.27,kitchenDark,.09);
// 通高柜为两侧木纹门、中间窄黑玻璃展示格，整体宽度精确保持 1780 mm。
doorPart('Living_TV_Tall_Cabinet',11300,(tvSplitMM+tvEndMM)/2,.035,1.78,wallHeight,tvOak);
for(const z of [11249,12999])doorPart('Living_TV_Tall_Cabinet_Side',11092,z,.45,.03,wallHeight,tvOak);
for(const z of [11554,12694])doorPart('Living_TV_Tall_Door',10868,z,.03,.64,wallHeight-.05,tvOak,.05);
doorPart('Living_TV_Tall_Cabinet_Top',11092,12124,.45,1.78,.035,tvOak,wallHeight-.035);
doorPart('Living_TV_Tall_Cabinet_Base',11092,12124,.45,1.78,.08,tvOak);
doorPart('Living_TV_Display_Back',11274,12124,.018,.5,wallHeight-.12,kitchenDark,.08);
for(const y of [.45,.88,1.31,1.74])doorPart('Living_TV_Display_Shelf',11092,12124,.42,.49,.02,tvFrame,y);
doorPart('Living_TV_Display_Glass',10847,12124,.012,.5,wallHeight-.12,new THREE.MeshPhysicalMaterial({color:'#263436',transparent:true,opacity:.32,roughness:.14,metalness:.1,depthWrite:false}),.08);
groups.tv.anchor.set(X(11067),.9,Z(tvCenterMM));
// 电视墙采用上下两条连续灯带，移除旧点光源与地面圆形光斑。
for(const light of groups.tv.lights)model.remove(light);
groups.tv.lights=[];
for(const pool of groups.tv.pools){pool.removeFromParent();pool.geometry?.dispose();}
groups.tv.pools=[];
// 面光源沿整条灯带照亮背景板，开关后产生真实明暗变化，不形成点状光斑。
RectAreaLightUniformsLib.init();
for(const y of [.47,2.12]){
const light=new THREE.RectAreaLight(0xffd29a,0,2.94,.065);
light.name='Living_TV_Strip_Wall_Wash';light.position.set(X(11127),y,Z(tvCenterMM));
light.lookAt(X(11277),y,Z(tvCenterMM));light.userData.power=32;
model.add(light);groups.tv.lights.push(light);
}
// 纹理只沿竖向衰减，横向保持连续亮度，避免径向光斑造成中间亮两端暗。
const stripCanvas=document.createElement('canvas');stripCanvas.width=512;stripCanvas.height=128;
const stripContext=stripCanvas.getContext('2d'),stripGradient=stripContext.createLinearGradient(0,0,0,128);
// 加宽暖色晕光和亮芯：远景下也能清楚看出上下两条灯带，仍不使用点状照明。
for(const [stop,color] of [[0,'rgba(255,168,58,0)'],[.2,'rgba(255,178,70,.18)'],[.35,'rgba(255,199,100,.55)'],[.44,'rgba(255,219,144,.9)'],[.46,'rgba(255,255,239,1)'],[.54,'rgba(255,255,239,1)'],[.56,'rgba(255,219,144,.9)'],[.65,'rgba(255,199,100,.55)'],[.8,'rgba(255,178,70,.18)'],[1,'rgba(255,168,58,0)']])stripGradient.addColorStop(stop,color);
stripContext.fillStyle=stripGradient;stripContext.fillRect(0,0,512,128);
stripContext.globalCompositeOperation='destination-in';
const endFade=stripContext.createLinearGradient(0,0,512,0);endFade.addColorStop(0,'rgba(255,255,255,0)');endFade.addColorStop(.015,'white');endFade.addColorStop(.985,'white');endFade.addColorStop(1,'rgba(255,255,255,0)');stripContext.fillStyle=endFade;stripContext.fillRect(0,0,512,128);
const stripTexture=new THREE.CanvasTexture(stripCanvas);stripTexture.colorSpace=THREE.SRGBColorSpace;
for(const y of [.455,2.145]){
const line=new THREE.Mesh(new THREE.PlaneGeometry(2.98,.27),new THREE.MeshBasicMaterial({map:stripTexture,transparent:true,opacity:1,depthWrite:false,toneMapped:false}));
line.name='Living_TV_Horizontal_Strip_Glow';line.rotation.y=-Math.PI/2;line.position.set(X(11232),y,Z(tvCenterMM));line.visible=groups.tv.on;model.add(line);groups.tv.pools.push(line);
}
// 普通透明叠加保留暖色洗墙层次，避免加色光晕在浅色背景上被冲成白色。
for(const [y,peak] of [[.455,.5],[1.88,.16875]]){
const haloCanvas=document.createElement('canvas');haloCanvas.width=256;haloCanvas.height=256;
const haloContext=haloCanvas.getContext('2d'),gradient=haloContext.createLinearGradient(0,0,0,256);
gradient.addColorStop(0,'rgba(255,174,48,0)');gradient.addColorStop(peak*.45,'rgba(255,205,137,.45)');gradient.addColorStop(peak,'rgba(255,224,165,.95)');gradient.addColorStop(peak+(1-peak)*.35,'rgba(255,204,122,.72)');gradient.addColorStop(1,'rgba(255,166,40,0)');
haloContext.fillStyle=gradient;haloContext.fillRect(0,0,256,256);haloContext.globalCompositeOperation='destination-in';
const fade=haloContext.createLinearGradient(0,0,256,0);fade.addColorStop(0,'rgba(255,255,255,0)');fade.addColorStop(.04,'white');fade.addColorStop(.96,'white');fade.addColorStop(1,'rgba(255,255,255,0)');haloContext.fillStyle=fade;haloContext.fillRect(0,0,256,256);
const texture=new THREE.CanvasTexture(haloCanvas);texture.colorSpace=THREE.SRGBColorSpace;
const halo=new THREE.Mesh(new THREE.PlaneGeometry(3,.8),new THREE.MeshBasicMaterial({map:texture,transparent:true,opacity:.88,depthWrite:false,toneMapped:false}));
halo.name='Living_TV_Wide_Halo';halo.rotation.y=-Math.PI/2;halo.position.set(X(11234),y,Z(tvCenterMM));halo.visible=groups.tv.on;model.add(halo);groups.tv.pools.push(halo);
}
result.tvWall={backgroundWidth:3,cabinetWidth:1.78,totalWidth:4.78,start:Z(tvStartMM),split:Z(tvSplitMM),end:Z(tvEndMM),television:true};
// 书房窗边的旧窗帘装饰柱误显为短墙，移除该房间两端装饰柱。
model.updateMatrixWorld(true);
let removedStudyCurtains=0,removedMasterBayCurtains=0,removedLivingEndCurtain=0;
for(const m of [...model.children])if(m.name==='Linen_Curtain'){
const b=new THREE.Box3().setFromObject(m),center=b.getCenter(new THREE.Vector3());
if(center.x>X(8567)&&center.x<X(11367)&&center.z<Z(4000)){model.remove(m);m.geometry?.dispose();removedStudyCurtains++;}
else if(center.x>X(11517)&&center.z>Z(13714)){model.remove(m);m.geometry?.dispose();removedMasterBayCurtains++;}
// 客厅落地窗靠次卧一端的旧窗帘柱悬在玻璃边，按红框删除。
else if(center.x<X(6000)&&center.z>Z(12000)){model.remove(m);m.geometry?.dispose();removedLivingEndCurtain++;}
}
// 卧室窗位于飘窗外沿，书房及儿童房窗沿北外墙布置，窗洞贯穿整段墙厚。
const roomWindows=[
// 所有房间窗户使用整块玻璃，竖框只设在两端，不设置中间分格。
{name:'Master_Window',x:13417,z:13814,width:2.6,bottom:.65,height:1.35,panes:1,south:true},
{name:'Secondary_Window',x:2157,z:12544,width:2.48,bottom:.65,height:1.3,panes:1,south:true},
{name:'Study_Window',x:10017,z:3414,width:1.8,bottom:.8,height:1.2,panes:1,south:false},
{name:'Child_Window',x:12767,z:3414,width:1.8,bottom:.8,height:1.2,panes:1,south:false},
];
const roomWindowGlass=new THREE.MeshPhysicalMaterial({color:'#bdd4d9',transparent:true,opacity:.24,roughness:.1,metalness:.05,depthWrite:false});
for(const w of roomWindows){
const oldWindow=model.getObjectByName(w.name);if(oldWindow){model.remove(oldWindow);oldWindow.geometry?.dispose();}
doorPart(w.name,w.x,w.z,w.width-.07,.012,w.height-.07,roomWindowGlass,w.bottom+.035);
for(const y of [w.bottom,w.bottom+w.height-.035])windowFrame(w.name+'_Frame_Rail',w.x,w.z,w.width,.06,.035,y);
for(let i=0;i<=w.panes;i++)windowFrame(w.name+'_Frame_Post',w.x-w.width*500+i*w.width*1000/w.panes,w.z,.035,.06,w.height,w.bottom);
doorPart(w.name+'_Sill',w.x,w.z,w.width,.23,.035,mat.white,w.bottom-.035);
}
result.enclosureMeshes=[...wallMeshes,...livingWindowFrames];
const windowCuts=roomWindows.map(w=>({rect:[w.x-w.width*500,w.x+w.width*500,w.z-100,w.z+100],bottom:w.bottom,top:w.bottom+w.height}));
// 分段墙交接处会叠加共面侧面，产生细亮线；按墙体实际占地求并集后只生成外表面。
const wallRects=walls.map(([x1,z1,x2,z2,t])=>{const w=Math.max(Math.abs(x2-x1),t),d=Math.max(Math.abs(z2-z1),t);return [(x1+x2-w)/2,(x1+x2+w)/2,(z1+z2-d)/2,(z1+z2+d)/2];});
const cutRects=windowCuts.map(w=>w.rect);
const gridX=[...new Set([...wallRects,...cutRects].flatMap(r=>r.slice(0,2)))].sort((a,b)=>a-b);
const gridZ=[...new Set([...wallRects,...cutRects].flatMap(r=>r.slice(2,4)))].sort((a,b)=>a-b);
const filled=new Set(),columns=gridX.length-1;
for(let j=0;j<gridZ.length-1;j++)for(let i=0;i<columns;i++){
const x=(gridX[i]+gridX[i+1])/2,z=(gridZ[j]+gridZ[j+1])/2;
if(wallRects.some(r=>x>r[0]&&x<r[1]&&z>r[2]&&z<r[3]))filled.add(j*columns+i);
}
/** 按二维墙体并集生成顶面、底面及外侧面，避免重叠面和转角亮缝。 */
function continuousWalls(name,y,height,material){
const vertices=[];
/** 将有序四边形写为两个三角面，保持法线朝外。 */
function quad(a,b,c,d){vertices.push(...a,...b,...c,...a,...c,...d);}
const levels=[...new Set([y,y+height,...windowCuts.flatMap(w=>[w.bottom,w.top]).filter(h=>h>y&&h<y+height)])].sort((a,b)=>a-b);
/** 判断某高度的墙格是否存在，窗洞内不生成墙体。 */
function occupied(key,h){
if(h<y||h>y+height||!filled.has(key))return false;
const i=key%columns,j=Math.floor(key/columns),x=(gridX[i]+gridX[i+1])/2,z=(gridZ[j]+gridZ[j+1])/2;
return !windowCuts.some(w=>h>w.bottom&&h<w.top&&x>w.rect[0]&&x<w.rect[1]&&z>w.rect[2]&&z<w.rect[3]);
}
for(let level=0;level<levels.length-1;level++)for(const key of filled){
const baseY=levels[level],top=levels[level+1],mid=(baseY+top)/2;if(!occupied(key,mid))continue;
const i=key%columns,j=Math.floor(key/columns),x0=X(gridX[i]),x1=X(gridX[i+1]),z0=Z(gridZ[j]),z1=Z(gridZ[j+1]);
if(!occupied(key,top+.00001))quad([x0,top,z0],[x0,top,z1],[x1,top,z1],[x1,top,z0]);
if(!occupied(key,baseY-.00001))quad([x0,baseY,z1],[x0,baseY,z0],[x1,baseY,z0],[x1,baseY,z1]);
if(i===0||!occupied(key-1,mid))quad([x0,baseY,z0],[x0,baseY,z1],[x0,top,z1],[x0,top,z0]);
if(i===columns-1||!occupied(key+1,mid))quad([x1,baseY,z1],[x1,baseY,z0],[x1,top,z0],[x1,top,z1]);
if(j===0||!occupied(key-columns,mid))quad([x1,baseY,z0],[x0,baseY,z0],[x0,top,z0],[x1,top,z0]);
if(!occupied(key+columns,mid))quad([x0,baseY,z1],[x1,baseY,z1],[x1,top,z1],[x0,top,z1]);
}
const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
const mesh=new THREE.Mesh(geometry,material);mesh.name=name;model.add(mesh);return mesh;
}
// 原墙段仅保留为尺寸及门洞核验代理，渲染与导出使用连续墙体。
for(const mesh of [...wallMeshes,...window.wallCaps])mesh.visible=false;
const wallShell=continuousWalls('Continuous_Structural_Walls',0,wallHeight-.035,mat.wall);
continuousWalls('Continuous_Wall_Caps',wallHeight-.035,.035,capMaterial);
result.wallSurface={continuous:true,removedStudyCurtains,removedMasterBayCurtains,removedLivingEndCurtain,cells:filled.size};
result.roomWindows=roomWindows;
/** 从室内朝窗外发射射线，验证窗洞没有被连续墙体遮住。 */
result.checkWindowOpenings=function(){model.updateMatrixWorld(true);return roomWindows.map(w=>{const sign=w.south?1:-1,ray=new THREE.Raycaster(new THREE.Vector3(X(w.x),w.bottom+w.height/2,Z(w.z)-sign*.4),new THREE.Vector3(0,0,sign),0,.8);return {name:w.name,blocked:ray.intersectObject(wallShell,false).length>0};});};
window.modelPreview.curtains=addWindowCurtains({THREE,model,windows:[...roomWindows,{name:'Living_Window',x:7967,z:13114,width:6.9,south:true,bottom:0,height:2.28,sheer:true},{name:'Livingreturn_Window',x:4647,z:12684,width:.6,south:false,bottom:0,height:2.28,sheer:true,axis:'z'}],camera:window.modelPreview.camera,controls:window.modelPreview.controls,renderer:window.modelPreview.renderer,render});
result.warmHome=applyWarmHome({THREE,model,mat,walnut:studyWalnut});
render();return result;
}
