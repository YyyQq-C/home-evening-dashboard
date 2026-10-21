import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';

import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {SSAOPass} from 'three/addons/postprocessing/SSAOPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {SMAAPass} from 'three/addons/postprocessing/SMAAPass.js';
import {calibrateFromCAD} from './cad-layout.js';
import {refineLivingQuality} from './living-quality.js';
import {refineSoftFurnishings} from './soft-furnishings.js';
import {enhanceRenderQuality} from './render-quality.js';
import {enhanceCeilingStrips} from './ceiling-strips.js';
import {createDeviceDisplay} from './device-display.js';

const host=document.querySelector('#viewport');
const scene=new THREE.Scene();scene.background=null;
const camera=new THREE.OrthographicCamera(-10,10,8,-8,.1,100);
// 透明画布只绘制房屋，背景由承载页面决定。
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setClearColor(0x000000,0);// 内部至少按两倍分辨率渲染，缩小显示时平滑细线与斜边。
renderer.setPixelRatio(Math.min(Math.max(devicePixelRatio,2),2.5));renderer.shadowMap.enabled=false;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;host.prepend(renderer.domElement);
// 纵向旋转从俯视最多倾斜 45 度，禁止进入平视角度。
const controls=new OrbitControls(camera,renderer.domElement);controls.maxPolarAngle=Math.PI/4;controls.enableDamping=false;controls.minZoom=.6;controls.maxZoom=4;controls.minDistance=8;controls.maxDistance=60;controls.target.set(0,0,0);
// 后处理使用自己的离屏缓冲区，必须在该缓冲区单独启用 MSAA。
const antialiasTarget=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,samples:Math.min(4,renderer.capabilities.maxSamples)});
const composer=new EffectComposer(renderer,antialiasTarget);composer.addPass(new RenderPass(scene,camera));
const ao=new SSAOPass(scene,camera,host.clientWidth,host.clientHeight);// 正交相机须使用正交深度转换，避免旋转或缩放后阴影覆盖整个模型。
ao.ssaoMaterial.defines.PERSPECTIVE_CAMERA=0;ao.depthRenderMaterial.defines.PERSPECTIVE_CAMERA=0;ao.kernelRadius=.35;ao.minDistance=.002;ao.maxDistance=.15;ao.enabled=false;composer.addPass(ao);
const bloom=new UnrealBloomPass(new THREE.Vector2(host.clientWidth,host.clientHeight),.32,.45,1.15);// SMAA 在色彩输出转换之前处理残余锯齿，与 MSAA 和高分辨率共同工作。
// Bloom 会把透明背景写成不透明色；保留模型中的暖光贴片和灯图标光晕。
bloom.enabled=false;composer.addPass(bloom);const smaa=new SMAAPass();composer.addPass(smaa);composer.addPass(new OutputPass());
// 查找纹理异步加载后重新绘制，保持按需渲染模式。
smaa._areaTexture.image.addEventListener('load',render);smaa._searchTexture.image.addEventListener('load',render);
const model=new THREE.Group();model.name='Home_Draft_Meters';scene.add(model);
const wallMeshes=[],pickables=[],groups={},labels=[];
// 墙顶含压顶共 2.28 米，通高柜统一与墙顶齐平。
const WALL_HEIGHT=2.28,WALL_CAP_HEIGHT=.035;
const mat={wall:new THREE.MeshStandardMaterial({color:'#deddd6',roughness:.9}),floor:new THREE.MeshStandardMaterial({color:'#bcbcb4',roughness:.33}),wood:new THREE.MeshStandardMaterial({color:'#a58e70',roughness:.65}),dark:new THREE.MeshStandardMaterial({color:'#3e4548',roughness:.8}),white:new THREE.MeshStandardMaterial({color:'#d9d6ce',roughness:.9}),glass:new THREE.MeshPhysicalMaterial({color:'#a9c5cc',transparent:true,opacity:.24,roughness:.1,metalness:.1,depthWrite:false})};
scene.add(new THREE.HemisphereLight(0xffffff,0x8a929e,.85));const sun=new THREE.DirectionalLight(0xfff4df,2.5);sun.position.set(-6,14,-7);sun.castShadow=false;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-12,right:12,top:12,bottom:-12});sun.shadow.bias=-.0005;scene.add(sun);

/** 以米为单位创建模型部件，平面坐标与原图方向一致。 */
function box(name,x,z,w,d,h,material,y=0){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);m.name=name;m.position.set(x,y+h/2,z);m.castShadow=true;m.receiveShadow=true;model.add(m);return m;}
/** 创建实际高度墙段，墙身加压顶统一为 2.28 米。 */
function wall(x,z,w,d){const m=box('Wall',x,z,w,d,WALL_HEIGHT-WALL_CAP_HEIGHT,mat.wall);wallMeshes.push(m);return m;}
/** 添加房间地面及中文标识。 */
function room(name,x,z,w,d,wood=false){box(name+'_Floor',x,z,w,d,.09,wood?mat.wood:mat.floor,-.09);label(name,x,z);}
/** 用画布纹理创建清晰的房间名称。 */
function label(text,x,z){const c=document.createElement('canvas');c.width=512;c.height=100;const ctx=c.getContext('2d');ctx.font='500 36px "Microsoft YaHei"';ctx.textAlign='center';ctx.fillStyle='#34444c';ctx.fillText(text,256,61);const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(c),depthTest:false,transparent:true}));sp.position.set(x,.16,z);sp.scale.set(2.7,.53,1);sp.renderOrder=8;model.add(sp);labels.push(sp);}
// 直接从用户最新标注图描摹平面轮廓，避免再次以规则房间网格代替户型。
const PLAN_SCALE=7.24/350;
/** 将标注图横坐标转换为以米为单位的模型坐标。 */
function px(x){return (x-400)*PLAN_SCALE;}
/** 将标注图纵坐标转换为以米为单位的模型坐标。 */
function pz(y){return (y-325)*PLAN_SCALE;}
/** 按图纸控制点生成不规则房间地面。 */
function planFloor(name,points,wood,lx,ly){const shape=new THREE.Shape();points.forEach(([x,y],i)=>{if(i===0)shape.moveTo(px(x),-pz(y));else shape.lineTo(px(x),-pz(y));});shape.closePath();const geometry=new THREE.ShapeGeometry(shape);geometry.rotateX(-Math.PI/2);const mesh=new THREE.Mesh(geometry,wood?mat.wood:mat.floor);mesh.name=name+'_Floor';mesh.position.y=-.005;mesh.receiveShadow=true;mesh.userData.planPoints=points;model.add(mesh);if(lx!==undefined)label(name,px(lx),pz(ly));return mesh;}
/** 墙段沿长度各延伸半个墙厚，使转角和相邻端点重叠连接，不跨越门洞。 */
function planWall(x1,y1,x2,y2,t=7){const m=wall(px((x1+x2)/2),pz((y1+y2)/2),(Math.abs(x2-x1)?Math.abs(x2-x1)+t:t)*PLAN_SCALE,(Math.abs(y2-y1)?Math.abs(y2-y1)+t:t)*PLAN_SCALE);m.userData.planSegment=[x1,y1,x2,y2];m.userData.wallThickness=t;return m;}
/** 按图纸矩形边界创建家具、窗或结构柱。 */
function planBox(name,x1,y1,x2,y2,h,material,y=0){return box(name,px((x1+x2)/2),pz((y1+y2)/2),(x2-x1)*PLAN_SCALE,(y2-y1)*PLAN_SCALE,h,material,y);}

planFloor('厨房',[[232,39],[338,39],[338,279],[232,279]],false,281,186);
planFloor('次卫',[[349,118],[420,118],[420,282],[349,282]],false,385,201);
// 书房外轮廓沿用整屋图，南侧边界以改造图的玻璃门方案替代原实体墙。
planFloor('书房',[[430,118],[556,118],[556,282],[430,282]],true,492,199);
planFloor('儿童房',[[572,119],[710,119],[710,263],[617,263],[617,282],[572,282]],true,644,193);
planFloor('主卫',[[628,280],[744,280],[744,361],[628,361]],false,686,319);
planFloor('主卧',[[573,371],[744,371],[744,577],[733,577],[733,623],[605,623],[605,587],[573,587]],true,666,471);
planFloor('次卧',[[49,370],[196,370],[196,513],[172,513],[172,560],[49,560]],true,113,462);
// 入户位于厨房左下侧，通过玄关连通客餐厅；左上斜线区属于公共区域。
// 红线左侧为储物间，右侧玄关直接连通客餐厅。
planFloor('储物间',[[49,316],[99,316],[99,287],[147,287],[147,365],[49,365]],false,94,342);
planFloor('玄关',[[147,287],[202,287],[202,365],[147,365]],false,175,329);
planFloor('客餐厅',[[202,283],[626,283],[626,369],[565,369],[565,488],[226,488],[226,482],[204,482],[204,366],[202,366]],false,418,405);
// 补齐原客厅与阳台之间的地面缺口，沿用客厅材质及砖缝生成逻辑。
planFloor('阳台',[[226,488],[565,488],[565,584],[226,584]],false,398,553);
// 按用户最新标注移除客厅与阳台交界两侧短墙。

// 厨房与次卫的上沿、隔墙和通向横向过道的门洞。
planWall(226,34,226,281,9);planWall(226,34,344,34,7);planWall(344,34,344,112,10);
planWall(344,111,344,279,10);planWall(232,277,264,277);planWall(306,277,339,277);
planWall(344,112,421,112,9);planWall(424,117,424,282,8);planWall(349,278,383,278);
// 书房、儿童房：保留各自外轮廓及儿童房下侧凹入的门口。
planWall(425,112,561,112,9);planWall(563,113,563,276,12);
planWall(570,112,716,112,10);planWall(716,116,716,267,11);
planWall(617,266,716,266,8);planWall(618,268,618,289,7);planWall(570,279,584,279,7);
// 玄关及次卧形成左下凹凸轮廓，玄关与客厅之间留开口。
planWall(97,281,150,281,9);planWall(216,281,226,281,9);planWall(45,310,97,310,10);planWall(97,281,97,310,8);planWall(45,317,45,562,9);
planWall(49,366,199,366,7);planWall(199,419,199,517,10);
planWall(199,517,177,517,10);planWall(177,520,177,564,10);planWall(49,566,177,566,7);
// 储物间隔墙留推拉门洞，滑动方向及门扇数以示意表达。
planWall(147,285,147,315,6);planWall(147,357,147,366,6);
const storageRoot=new THREE.Group();storageRoot.name='Storage_Sliding_Door_Group';model.add(storageRoot);
const storageDoor=planBox('Storage_Sliding_Door',145,316,149,357,2.05,mat.dark);
planBox('Storage_Door_Track',145,286,149,359,.025,mat.dark,.015);
const storageHandle=planBox('Storage_Handle',149,342,151,345,.22,mat.white,.87);storageRoot.attach(storageDoor);storageRoot.attach(storageHandle);
for(const y of [321,340]){planBox('Storage_Shelf',54,y,80,y+13,.055,mat.wood,.45);planBox('Storage_Shelf',54,y,80,y+13,.055,mat.wood,1.05);}
// 客厅到阳台是连续空间，边缘短墙和窗线按照原图折线定位。
planWall(199,480,225,480,11);planWall(225,480,225,589,6);
planWall(225,589,565,589,7);
// 主卧西墙含门洞，主卫位于主卧上方并向右凸出。
planWall(565,350,565,370,9);planWall(565,365,628,365,7);planWall(565,405,565,589,11);
planWall(627,274,752,274,10);planWall(752,278,752,587,10);
planWall(624,274,624,365,7);planWall(628,365,653,365,7);planWall(695,365,748,365,7);
planWall(569,587,603,587,10);planWall(735,587,752,587,10);
planWall(599,589,599,632,6);planWall(733,589,733,632,6);planWall(602,633,733,633,6);

// 书房门洞约 1450 mm，右侧约 851 mm 收纳区；保持已确认的右向收纳关系。
const doorRoot=new THREE.Group();doorRoot.name='Study_Pocket_Door';model.add(doorRoot);
const studyLeft=px(430),studyFront=pz(280),opening=1.45;
for(let i=0;i<2;i++){const m=box('Study_Glass_Panel',studyLeft+opening*(i+.5)/2,studyFront,opening/2,.035,2.2,mat.glass);doorRoot.attach(m);const frame=box('Door_Frame',studyLeft+opening*i/2,studyFront,.025,.05,2.2,mat.dark);doorRoot.attach(frame);}
const pocket=wall(studyLeft+opening+.851/2,studyFront,.851,.26);pocket.name='Study_Pocket_Wall';
// 保留 1450 mm 门洞和 851 mm 收纳区，补齐收纳墙至书房东侧隔墙。
planWall(430+(opening+.851)/PLAN_SCALE,280,563,280,12);
box('Door_Track',studyLeft+1.15,studyFront,2.3,.06,.035,mat.dark,.02);

// 门洞处只补地面门槛，不生成墙，避免透明背景透出白色断缝。
for(const [name,x1,y1,x2,y2,wood] of [
['Entry_Threshold',150,279,216,289,false],['Kitchen_Threshold',264,275,306,287,false],
['Guest_Bath_Threshold',383,275,424,287,false],['Study_Threshold',430,277,563,286,true],
['Child_Threshold',584,276,618,291,true],['Secondary_Threshold',194,366,207,419,true],
['Master_Threshold',561,370,577,405,true],['Master_Bath_Threshold',653,357,695,374,true]
])planBox(name,x1,y1,x2,y2,.012,wood?mat.wood:mat.floor,-.014);

// 窗户与飘窗只放在原图外墙位置。
planBox('Living_Window',232,583,560,586,1.35,mat.glass,.65);
planBox('Master_Bay',605,588,730,625,.42,mat.white);
planBox('Master_Window',604,629,730,631,1.35,mat.glass,.65);
planBox('Secondary_Window',53,558,168,561,1.3,mat.glass,.65);
planBox('Study_Window',462,110,548,112,1.2,mat.glass,.8);
planBox('Child_Window',602,110,681,112,1.2,mat.glass,.8);

// 客厅朝向与实景一致：电视墙在右、餐厅在左、阳台在下。
// 电视背景墙与结构墙使用同一暖色材质和实际高度。
const tvWall=wall(px(561),pz(440),8*PLAN_SCALE,70*PLAN_SCALE);tvWall.name='TV_Wall';
planBox('TV',552,406,555,457,.42,mat.dark,.24);
planBox('TV_Cabinet',537,405,557,477,.3,mat.dark);
planBox('Living_Sofa',337,391,376,471,.43,mat.white);
planBox('Sofa_Back',335,391,343,471,.72,mat.white);
planBox('Coffee_Table',410,414,440,454,.34,mat.dark);
planBox('Dining_Table',263,391,310,468,.08,mat.white,.73);
for(const y of [398,423,448])planBox('Dining_Chair',244,y,260,y+17,.43,mat.dark);
planBox('Master_Bed',639,441,733,523,.35,mat.dark);
planBox('Mattress',641,443,730,520,.2,mat.white,.35);
planBox('Headboard',730,440,735,524,1.05,mat.dark);
planBox('Master_Wardrobe',578,409,605,560,1.1,mat.dark);





/** 生成柔和光斑，边缘逐渐透明以避免硬圆盘效果。 */
function makeGlow(){const c=document.createElement('canvas');c.width=c.height=128;const ctx=c.getContext('2d');const g=ctx.createRadialGradient(64,64,0,64,64,64);g.addColorStop(0,'rgba(255,255,255,.9)');g.addColorStop(.35,'rgba(255,255,255,.4)');g.addColorStop(1,'rgba(255,255,255,0)');ctx.fillStyle=g;ctx.fillRect(0,0,128,128);return new THREE.CanvasTexture(c);}
const glowTexture=makeGlow();
/** 根据已存在的房间边界生成地砖缝和木地板纹理线。 */
function floorDetails(){for(const floor of model.children.filter(m=>m.name.endsWith('_Floor'))){const ps=floor.userData.planPoints;if(!ps)continue;const wooden=floor.material===mat.wood;const minX=Math.min(...ps.map(p=>px(p[0]))),maxX=Math.max(...ps.map(p=>px(p[0]))),minZ=Math.min(...ps.map(p=>pz(p[1]))),maxZ=Math.max(...ps.map(p=>pz(p[1])));const points=[];const step=wooden?.19:.8;for(let z=wooden?minZ+step:Math.ceil(minZ/step)*step;z<maxZ;z+=step){const crosses=[];for(let i=0;i<ps.length;i++){const p=ps[i],q=ps[(i+1)%ps.length],z1=pz(p[1]),z2=pz(q[1]);if((z1<=z&&z2>z)||(z2<=z&&z1>z))crosses.push(px(p[0])+(z-z1)/(z2-z1)*(px(q[0])-px(p[0])));}crosses.sort((a,b)=>a-b);for(let i=0;i<crosses.length;i+=2)points.push(crosses[i],.002,z,crosses[i+1],.002,z);}
if(!wooden){for(let x=Math.ceil(minX/.8)*.8;x<maxX;x+=.8){const crosses=[];for(let i=0;i<ps.length;i++){const p=ps[i],q=ps[(i+1)%ps.length],x1=px(p[0]),x2=px(q[0]);if((x1<=x&&x2>x)||(x2<=x&&x1>x))crosses.push(pz(p[1])+(x-x1)/(x2-x1)*(pz(q[1])-pz(p[1])));}crosses.sort((a,b)=>a-b);for(let i=0;i<crosses.length;i+=2)points.push(x,.002,crosses[i],x,.002,crosses[i+1]);}}
const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(points,3));const lines=new THREE.LineSegments(geo,new THREE.LineBasicMaterial({color:wooden?0x604c37:0xc4c7c9,transparent:true,opacity:wooden?.2:.28}));lines.name=floor.name+'_Joints';model.add(lines);}}
/** 将已确认家具升级为圆角模型，补充坐垫、枕头和桌腿。 */
function furnish(){for(const m of model.children.filter(m=>m.isMesh&&/Sofa|Mattress|Headboard|Dining_Table|Coffee_Table/.test(m.name))){const p=m.geometry.parameters;if(!p.width)continue;const r=Math.min(.07,p.height*.3);m.geometry.dispose();m.geometry=new RoundedBoxGeometry(p.width,p.height,p.depth,3,r);}
for(let i=0;i<3;i++)box('Sofa_Cushion',px(360),.0+pz(405+i*24),.59,.44,.13,mat.white,.43);
const linen=new THREE.MeshStandardMaterial({color:'#a6acb0',roughness:1});planBox('Bed_Throw',643,477,689,518,.035,linen,.56);for(const y of [450,487])planBox('Bed_Pillow',710,y,728,y+26,.11,mat.white,.55);
for(const x of [266,306])for(const y of [396,463])planBox('Dining_Leg',x,y,x+2,y+2,.7,mat.dark,.03);
// 餐桌随灯位移动，桌面纵向保持与吊灯一致。
const shift=diningX-px(286.5);model.children.filter(m=>/^Dining_/.test(m.name)).forEach(m=>m.position.x+=shift);
}

/** 创建有圆角的家具部件，控制几何复杂度。 */
function softBox(name,x,z,w,d,h,material,y=0){const m=box(name,x,z,w,d,h,material,y);m.geometry.dispose();m.geometry=new RoundedBoxGeometry(w,h,d,2,Math.min(.06,h/3,w/5,d/5));return m;}
/** 构造圆形洗手盆、马桶和台面器皿。 */
function basin(name,x,z,r,y){const outer=new THREE.Mesh(new THREE.CylinderGeometry(r,r*.88,.13,24),mat.white);outer.name=name;outer.position.set(x,y,z);outer.castShadow=true;outer.receiveShadow=true;model.add(outer);const inner=new THREE.Mesh(new THREE.CircleGeometry(r*.73,24),new THREE.MeshStandardMaterial({color:'#a0aaa9',roughness:.3}));inner.rotation.x=-Math.PI/2;inner.position.set(x,y+.067,z);model.add(inner);}
/** 增加卫浴、厨房及卧室体块，形成与参考相近的室内模型密度。 */
function interiorDetails(){
const metal=new THREE.MeshStandardMaterial({color:'#7c898e',metalness:.6,roughness:.3});
const fabric=new THREE.MeshStandardMaterial({color:'#bca995',roughness:1});
const carpet=new THREE.MeshStandardMaterial({color:'#b4aba0',roughness:1});
// 地毯、沙发靠枕与桌面装饰保留实际家具方向。
softBox('Living_Rug',px(415),pz(434),1.9,1.7,.012,carpet,.01);
for(let i=0;i<2;i++)softBox('Sofa_Pillow',px(351),pz(405+i*48),.32,.32,.13,fabric,.62);
basin('Coffee_Tray',px(425),pz(433),.16,.37);
// 厨房沿两侧墙布置橱柜和操作台。
planBox('Kitchen_Left_Base',235,123,260,266,.78,mat.dark);planBox('Kitchen_Left_Top',234,122,262,268,.055,mat.white,.78);
planBox('Kitchen_Right_Base',309,165,337,268,.78,mat.dark);planBox('Kitchen_Right_Top',307,164,337,270,.055,mat.white,.78);
// 厨房吊柜顶部与墙顶齐平，下方保留操作台空间。
planBox('Kitchen_Left_Upper_Cabinet',235,123,250,266,WALL_HEIGHT-1.55,mat.wood,1.55);
planBox('Kitchen_Right_Upper_Cabinet',322,165,337,268,WALL_HEIGHT-1.55,mat.wood,1.55);
planBox('Kitchen_Sink',239,170,257,197,.025,metal,.84);planBox('Kitchen_Hob',311,221,334,244,.035,mat.dark,.84);
for(const y of [226,238])basin('Hob_Ring',px(321),pz(y),.075,.89);
planBox('Kitchen_Fridge',308,120,335,153,1.35,metal);
planBox('Kitchen_Fridge_Upper_Cabinet',308,120,335,153,WALL_HEIGHT-1.35,mat.wood,1.35);
// 储物间开放柜侧板和顶板做到顶，已有层板继续保留。
for(const y of [321,340]){
planBox('Storage_Cabinet_Side',54,y,55.5,y+13,WALL_HEIGHT,mat.wood);
planBox('Storage_Cabinet_Side',78.5,y,80,y+13,WALL_HEIGHT,mat.wood);
planBox('Storage_Cabinet_Top',54,y,80,y+13,.035,mat.wood,WALL_HEIGHT-.035);
}
// 两个卫生间补上盥洗台、马桶及淋浴隔断。
for(const [x,y] of [[355,128],[688,283]]){planBox('Vanity',x,y,x+29,y+21,.75,mat.wood);basin('Washbasin',px(x+14),pz(y+10),.19,.83);}
for(const [x,y] of [[391,209],[651,331]]){softBox('Toilet_Base',px(x),pz(y),.34,.56,.32,mat.white);basin('Toilet_Bowl',px(x),pz(y),.17,.36);softBox('Toilet_Tank',px(x),pz(y-10),.35,.14,.65,mat.white);}
planBox('Shower_Glass',352,245,398,247,1.25,mat.glass);planBox('Master_Shower',710,310,712,359,1.25,mat.glass);
// 次卧和儿童房的家具仅作风格示意，具体摆位仍待用户校正。
for(const [x,y,w,d] of [[645,196,1.2,1.9]]){softBox('Preview_Bed_Base',px(x),pz(y),w,d,.3,mat.wood);softBox('Preview_Bed_Mattress',px(x),pz(y),w-.06,d-.06,.17,mat.white,.3);softBox('Preview_Bed_Head',px(x),pz(y)-d/2,w,.1,.8,fabric);softBox('Preview_Bed_Throw',px(x),pz(y)+.4,w-.08,.75,.035,fabric,.48);for(const dx of [-w*.24,w*.24])softBox('Preview_Bed_Pillow',px(x)+dx,pz(y)-.65,w*.4,.36,.09,mat.white,.48);}
planBox('Child_Desk',675,125,705,164,.06,mat.wood,.75);
// 给柜体添加竖向门缝与拉手。
const cupboards=model.children.filter(m=>m.isMesh&&/Wardrobe|Cabinet|Kitchen_.*Base/.test(m.name));
for(const m of cupboards){const p=m.geometry.parameters;if(!p.width)continue;const count=Math.max(2,Math.round(Math.max(p.width,p.depth)/.5));for(let i=1;i<count;i++){if(p.depth>p.width)box('Cabinet_Seam',m.position.x+p.width/2+.002,m.position.z-p.depth/2+p.depth*i/count,.006,.006,p.height*.85,metal,.05);else box('Cabinet_Seam',m.position.x-p.width/2+p.width*i/count,m.position.z+p.depth/2+.002,.006,.006,p.height*.85,metal,.05);}}
// 墙顶加入深灰剖切压顶，强化户型边缘。
const caps=[];for(const w of wallMeshes){const p=w.geometry.parameters;const cap=box('Wall_Cut_Cap',w.position.x,w.position.z,p.width+.025,p.depth+.025,WALL_CAP_HEIGHT,new THREE.MeshStandardMaterial({color:'#596368',roughness:.8}),WALL_HEIGHT-WALL_CAP_HEIGHT);cap.userData.wall=w;caps.push(cap);
// 墙脚覆盖描图地面与墙面的细小余隙，透明背景下不再透出白线。
box('Wall_Footing',w.position.x,w.position.z,p.width+.12,p.depth+.12,.012,mat.floor,-.014);
}window.wallCaps=caps;
}

/** 按次卧实景重建软包床、白色衣柜、门旁抽屉柜及飘窗。 */
function secondaryDetails(){
const upholstery=new THREE.MeshStandardMaterial({color:'#b7b3a8',roughness:1});
const cabinetWhite=new THREE.MeshStandardMaterial({color:'#edede5',roughness:.55});
const drawerWood=new THREE.MeshStandardMaterial({color:'#7a7468',roughness:.78});
const slatWood=new THREE.MeshStandardMaterial({color:'#d4bd95',roughness:.8});
// 图纸南侧为窗，西侧为床头墙，北侧靠入口位置为衣柜。
const headX=px(55),bedZ=pz(475),bedLength=2.03,bedWidth=1.5;
softBox('Secondary_Bed_Base',headX+bedLength/2,bedZ,bedLength,bedWidth,.29,upholstery);
softBox('Secondary_Headboard',headX,bedZ,.12,bedWidth+.1,.95,upholstery);
for(let i=0;i<5;i++)softBox('Secondary_Head_Panel',headX+.07,bedZ-bedWidth/2+(i+.5)*bedWidth/5,.055,bedWidth/5-.025,.78,upholstery,.13);
// 当前照片尚未铺床垫，按照片表现木排骨架与黑色中梁。
box('Secondary_Bed_Rim',headX+bedLength/2,bedZ,bedLength-.07,bedWidth-.08,.035,mat.dark,.29);
for(let i=0;i<17;i++)for(const side of [-1,1])box('Secondary_Bed_Slat',headX+.1+i*(bedLength-.2)/16,bedZ+side*.36,.07,.66,.025,slatWood,.33);
box('Secondary_Bed_Center',headX+bedLength/2,bedZ,bedLength-.08,.035,.03,mat.dark,.34);
// 衣柜沿北墙布置，抽屉柜位于靠门一端，不占用东侧进出通道。
planBox('Secondary_White_Wardrobe',55,375,147,401,WALL_HEIGHT,cabinetWhite);
for(let i=0;i<4;i++){const x=55+(i+1)*23;planBox('Secondary_Wardrobe_Seam',x,400.5,x+.35,401,WALL_HEIGHT-.1,mat.dark,.05);if(i<3)planBox('Secondary_Wardrobe_Handle',x-2,401,x-1,402,.42,mat.dark,.63);}
planBox('Secondary_Drawer_Cabinet',151,375,180,402,.85,drawerWood);
// 抽屉区上方延续柜体至顶，抽屉本身保持正常使用高度。
planBox('Secondary_Drawer_Upper_Cabinet',151,375,180,402,WALL_HEIGHT-.85,cabinetWhite,.85);
for(let i=0;i<3;i++){planBox('Secondary_Drawer_Line',152,402,179,402.4,.012,mat.dark,.12+i*.24);planBox('Secondary_Drawer_Pull',160,402.4,171,403,.015,mat.dark,.32+i*.24);}
planBox('Secondary_Bay_Window_Seat',53,533,169,557,.42,cabinetWhite);
planBox('Secondary_Bay_Stone',52,532,170,558,.035,mat.white,.42);
}
/** 按书房实景构造长桌、抽屉柜、升降桌腿、洞洞板与上方层板。 */
function studyDetails(){
const walnut=new THREE.MeshStandardMaterial({color:'#493328',roughness:.66});
const black=new THREE.MeshStandardMaterial({color:'#202629',roughness:.62});
const cabinet=new THREE.MeshStandardMaterial({color:'#8c8170',roughness:.55});
const mirror=new THREE.MeshStandardMaterial({color:'#9ba9aa',metalness:.75,roughness:.22});
// 双人桌沿书房东墙布置，靠窗的一端延伸到窗边。
planBox('Study_Long_Desk',525,128,552,261,.055,walnut,.75);
planBox('Study_Center_Drawer',528,183,549,206,.70,walnut);
for(let i=0;i<4;i++){planBox('Study_Drawer_Seam',527.6,184,528,205,.008,black,.12+i*.14);planBox('Study_Drawer_Handle',527,191,528,198,.025,black,.22+i*.14);}
for(const y of [140,249]){planBox('Study_Desk_Foot',523,y-2,552,y+2,.045,black,.025);planBox('Study_Desk_Leg',539,y-1,541,y+1,.69,black,.06);}
planBox('Study_Pegboard',552,136,553,254,.57,black,1.03);
// 洞洞板采用少量几何孔点保留可见节奏，避免高面数。
const holes=new THREE.Group();holes.name='Study_Pegboard_Holes';model.add(holes);
const holeGeo=new THREE.CircleGeometry(.009,6);const holeMat=new THREE.MeshBasicMaterial({color:'#090d10'});
for(let row=0;row<7;row++)for(let col=0;col<34;col++){const hole=new THREE.Mesh(holeGeo,holeMat);hole.rotation.y=-Math.PI/2;hole.position.set(px(552)-.002,1.08+row*.07,pz(141)+col*.067);holes.add(hole);}
planBox('Study_Upper_Shelf',539,132,554,258,.045,walnut,1.82);
// 实景左侧为通高柜，面向书房设置镜面柜门。
planBox('Study_Left_Cabinet',432,132,449,265,WALL_HEIGHT,cabinet);
for(let i=0;i<5;i++){const y=134+i*26;planBox('Study_Cabinet_Front',449,y,449.8,y+25,WALL_HEIGHT-.1,mirror,.08);planBox('Study_Cabinet_Divider',449.8,y,450.2,y+.45,WALL_HEIGHT-.08,black,.06);}
planBox('Study_Window_Sill',462,112,548,118,.045,mat.white,.8);
}
/** 将指定房间居中显示，便于对照实景检查家具朝向。 */
function focusRoom(x,z){controls.target.set(x,0,z);camera.position.set(x-4,7,z+6);camera.zoom=2.65;camera.updateProjectionMatrix();controls.update();render();}

/** 生成细密布纹，给床品和地毯增加柔和触感。 */
function textileTexture(color){const c=document.createElement('canvas');c.width=c.height=128;const ctx=c.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,128,128);ctx.strokeStyle='rgba(255,255,255,.09)';ctx.lineWidth=.5;for(let i=0;i<128;i+=3){ctx.beginPath();ctx.moveTo(i,0);ctx.lineTo(i,128);ctx.moveTo(0,i);ctx.lineTo(128,i);ctx.stroke();}const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(3,3);return t;}
/** 添加小型绿植和花盆，保持低面数便于平板显示。 */
function plant(name,x,z,y,size=.3){const pot=new THREE.Mesh(new THREE.CylinderGeometry(size*.32,size*.24,size*.55,16),new THREE.MeshStandardMaterial({color:'#c6b5a0',roughness:.85}));pot.name=name+'_Pot';pot.position.set(x,y+size*.28,z);pot.castShadow=true;pot.receiveShadow=true;model.add(pot);const leafMat=new THREE.MeshStandardMaterial({color:'#64785c',roughness:1});for(let i=0;i<7;i++){const angle=i*Math.PI*2/7;const leaf=new THREE.Mesh(new THREE.SphereGeometry(1,10,6),leafMat);leaf.name=name+'_Leaf';leaf.scale.set(size*.18,size*.55,size*.11);leaf.rotation.z=Math.cos(angle)*.6;leaf.rotation.x=Math.sin(angle)*.6;leaf.position.set(x+Math.cos(angle)*size*.22,y+size*.8,z+Math.sin(angle)*size*.22);leaf.castShadow=true;model.add(leaf);}}
/** 按温馨住宅方向深化软装，保持房间轮廓与灯光控制关系。 */
function warmInteriors(){
const cream=new THREE.MeshStandardMaterial({color:'#eee3d1',roughness:1,map:textileTexture('#f0e8d9')});
const sage=new THREE.MeshStandardMaterial({color:'#a1ad91',roughness:1,map:textileTexture('#bac2ab')});
const rose=new THREE.MeshStandardMaterial({color:'#bd9d90',roughness:1,map:textileTexture('#d8b9ac')});
const walnut=new THREE.MeshStandardMaterial({color:'#755843',roughness:.8});
const rugMat=new THREE.MeshStandardMaterial({color:'#d2c4ac',roughness:1,map:textileTexture('#e4d9c4')});
mat.wall.color.set('#e6dfd1');mat.floor.color.set('#c6bfae');mat.wood.color.set('#b19979');
sun.intensity=2;sun.shadow.radius=4;
// 次卧从施工状态更新为铺好床品的软包床。
for(const m of [...model.children])if(/Secondary_Bed_(Slat|Rim|Center)/.test(m.name)){model.remove(m);m.geometry?.dispose();}
const bedX=px(55)+2.03/2,bedZ=pz(475);
softBox('Secondary_Warm_Mattress',bedX,bedZ,1.96,1.44,.19,cream,.3);
softBox('Secondary_Warm_Duvet',bedX+.26,bedZ,1.25,1.45,.07,rose,.49);
for(const dz of [-.36,.36])softBox('Secondary_Warm_Pillow',px(55)+.34,bedZ+dz,.4,.58,.12,cream,.49);
softBox('Secondary_Bedside_Rug',bedX+.25,bedZ,2.35,1.95,.014,rugMat,.012);
plant('Secondary_Plant',px(160),pz(547),.46,.38);
// 主卧增加柔软床品、床尾毯与床边小几。
model.children.filter(m=>m.name==='Mattress'||m.name==='Bed_Pillow').forEach(m=>m.material=cream);
model.children.filter(m=>m.name==='Bed_Throw').forEach(m=>m.material=sage);
softBox('Master_Bed_Rug',px(679),pz(480),2.6,2.4,.014,rugMat,.012);
softBox('Master_Bedside',px(716),pz(422),.48,.48,.47,walnut);
plant('Master_Plant',px(713),pz(603),.46,.4);
// 客厅奶油色沙发搭配低饱和靠枕和编织地毯。
model.children.filter(m=>/Living_Sofa|Sofa_Back|Sofa_Cushion/.test(m.name)).forEach(m=>m.material=cream);
model.children.filter(m=>m.name==='Sofa_Pillow').forEach((m,i)=>m.material=i?sage:rose);
model.children.filter(m=>m.name==='Living_Rug').forEach(m=>m.material=rugMat);
plant('Living_Plant',px(532),pz(545),.02,.58);plant('Dining_Flowers',diningX,lightCenterZ+.3,.81,.23);
// 书房补上两把布艺椅、显示器、书籍和桌面植物。
for(const y of [162,229]){const x=px(509),z=pz(y);softBox('Study_Chair_Seat',x,z,.46,.5,.09,sage,.43);softBox('Study_Chair_Back',x-.22,z,.085,.5,.48,sage,.47);for(const dz of [-.18,.18])box('Study_Chair_Leg',x,z+dz,.025,.025,.43,mat.dark);}
for(const y of [162,226]){softBox('Study_Monitor',px(544),pz(y),.055,.58,.35,mat.dark,.87);box('Study_Monitor_Stand',px(542),pz(y),.15,.2,.025,mat.dark,.81);}
for(let i=0;i<5;i++)box('Study_Book',px(544),pz(202)+i*.055,.15,.045,.22,i%2?sage:rose,1.87);
plant('Study_Desk_Plant',px(534),pz(138),.81,.25);
// 儿童房增加床尾圆毯、读物架和柔和床品。
model.children.filter(m=>/Preview_Bed_Throw/.test(m.name)).forEach(m=>m.material=sage);
model.children.filter(m=>/Preview_Bed_Mattress|Preview_Bed_Pillow/.test(m.name)).forEach(m=>m.material=cream);
const roundRug=new THREE.Mesh(new THREE.CircleGeometry(.65,48),rugMat);roundRug.name='Child_Round_Rug';roundRug.rotation.x=-Math.PI/2;roundRug.position.set(px(615),.012,pz(245));roundRug.receiveShadow=true;model.add(roundRug);
plant('Child_Plant',px(695),pz(147),.82,.25);
// 窗边添加简洁帘布，让整体材质更柔和。
for(const [x,z] of [[px(235),pz(580)],[px(558),pz(580)],[px(607),pz(626)],[px(727),pz(626)],[px(464),pz(117)],[px(546),pz(117)]])softBox('Linen_Curtain',x,z,.18,.12,1.65,cream,.55);
}

/** 用确定性纹理绘制木纹、绗缝与编织图案，减少纯色块感。 */
function homeTexture(kind){
const c=document.createElement('canvas');c.width=c.height=512;const ctx=c.getContext('2d');
if(kind==='wood'){
ctx.fillStyle='#bf976c';ctx.fillRect(0,0,512,512);
for(let plank=0;plank<5;plank++){ctx.fillStyle=['#c4b69f','#cfc1aa','#bcae97','#c8bba4','#beb29e'][plank];ctx.fillRect(0,plank*103,512,102);for(let i=0;i<45;i++){ctx.strokeStyle=i%3?'rgba(88,55,30,.055)':'rgba(255,239,205,.11)';ctx.lineWidth=1;ctx.beginPath();for(let x=0;x<=512;x+=8){const y=plank*103+i*2.25+Math.sin(x*.025+i*.7)*1.9;x===0?ctx.moveTo(x,y):ctx.lineTo(x,y);}ctx.stroke();}ctx.fillStyle='#8a705322';ctx.fillRect(0,plank*103,512,1);}
}else if(kind==='quilt'){
ctx.fillStyle='#f4ebdc';ctx.fillRect(0,0,512,512);ctx.strokeStyle='#c7bca688';ctx.lineWidth=1.5;for(let i=-512;i<1024;i+=64){ctx.beginPath();ctx.moveTo(i,0);ctx.lineTo(i+512,512);ctx.moveTo(i,0);ctx.lineTo(i-512,512);ctx.stroke();}
}else{
ctx.fillStyle='#e7d5b5';ctx.fillRect(0,0,512,512);ctx.strokeStyle='#a98d69';ctx.lineWidth=3;ctx.strokeRect(15,15,482,482);ctx.strokeRect(26,26,460,460);for(let y=0;y<512;y+=3){ctx.strokeStyle=y%2?'#fff9e520':'#8d765b18';ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(512,y);ctx.stroke();}ctx.strokeStyle='#bba17d88';ctx.lineWidth=2;for(let y=65;y<460;y+=72)for(let x=65;x<460;x+=72){ctx.beginPath();ctx.moveTo(x,y-19);ctx.lineTo(x+13,y);ctx.lineTo(x,y+19);ctx.lineTo(x-13,y);ctx.closePath();ctx.stroke();}
}
const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;if(kind==='wood')t.repeat.set(.8,.8);t.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());return t;
}
/** 主卧床与衣柜左右对调，床头、床品与床边小几同步镜像。 */
function swapMasterFurniture(){
const center=px(658.5);
const furniture=model.children.filter(m=>['Master_Bed','Mattress','Headboard','Master_Wardrobe','Bed_Throw','Bed_Pillow','Master_Bed_Rug','Master_Bedside'].includes(m.name));
const cupboard=model.getObjectByName('Master_Wardrobe');
// 柜门缝随原衣柜移动，避免旧门缝悬空。
for(const m of model.children.filter(m=>m.name==='Cabinet_Seam'))if(Math.abs(m.position.x-(cupboard.position.x+cupboard.geometry.parameters.width/2))<.04&&Math.abs(m.position.z-cupboard.position.z)<1.7)furniture.push(m);
for(const m of furniture)m.position.x=2*center-m.position.x;
}
/** 深化居家软装：暖木、绗缝床品、编织地毯、软包座椅和壁饰。 */
function cozyDetails(){
const timber=homeTexture('wood'),quilt=homeTexture('quilt'),woven=homeTexture('rug');
const quiltMat=new THREE.MeshStandardMaterial({color:'#ead4b6',map:quilt,roughness:1});
const terracotta=new THREE.MeshStandardMaterial({color:'#bc856c',roughness:1,map:textileTexture('#e2b8a0')});
const olive=new THREE.MeshStandardMaterial({color:'#8c9976',roughness:1,map:textileTexture('#b2bf99')});
const ivory=new THREE.MeshStandardMaterial({color:'#f4e9d7',roughness:1,map:textileTexture('#f6efdf')});
const woodMat=new THREE.MeshStandardMaterial({color:'#e2dbd1',map:timber,roughness:.75});
const rug=new THREE.MeshStandardMaterial({color:'#f1e5d0',map:woven,roughness:1});
mat.wood.map=timber;mat.wood.color.set('#e6ded1');mat.wood.needsUpdate=true;
mat.floor.color.set('#c8bda8');mat.floor.roughness=.85;mat.wall.color.set('#eee2cf');
// 降低日光的硬朗对比，使用暖色环境光，阴影仍关闭。
sun.intensity=1.1;scene.children.filter(m=>m.isHemisphereLight).forEach(l=>{l.intensity=1.5;l.color.set('#ffeed4');l.groundColor.set('#a08e78');});
for(const m of model.children.filter(m=>m.isMesh)){
if(/Mattress|Bed_Pillow|Warm_Pillow|Preview_Bed_Pillow/.test(m.name))m.material=ivory;
if(/Bed_Throw|Warm_Duvet|Preview_Bed_Throw/.test(m.name))m.material=quiltMat;
if(/Living_Rug|Master_Bed_Rug|Secondary_Bedside_Rug|Child_Round_Rug/.test(m.name))m.material=rug;
if(/Dining_Table|Coffee_Table|TV_Cabinet|Master_Bedside/.test(m.name))m.material=woodMat;
if(m.name==='Sofa_Pillow')m.material=terracotta;
if(m.name==='Master_Wardrobe')m.material=new THREE.MeshStandardMaterial({color:'#d4c5ae',roughness:.8});
}
// 沙发两端增加扶手，搭配大小靠枕。
softBox('Sofa_Arm',px(357),pz(393),.77,.14,.56,ivory);softBox('Sofa_Arm',px(357),pz(469),.77,.14,.56,ivory);
softBox('Sofa_Accent_Pillow',px(354),pz(438),.22,.36,.24,olive,.58);
// 替换方块餐椅为带靠背的布艺椅。
for(const m of [...model.children].filter(m=>m.name==='Dining_Chair')){
const {x,z}=m.position;model.remove(m);m.geometry.dispose();
softBox('Dining_Upholstered_Seat',x,z,.37,.36,.09,terracotta,.43);softBox('Dining_Upholstered_Back',x-.17,z,.075,.36,.38,terracotta,.45);
for(const dx of [-.13,.13])for(const dz of [-.12,.12])box('Dining_Chair_Leg',x+dx,z+dz,.025,.025,.43,woodMat);
}
// 添加墙面竖向装饰画，几何层次保持轻量。
const artMat=new THREE.MeshStandardMaterial({color:'#bda288',roughness:1});
for(const [x,z,w,d] of [[px(737),pz(546),.035,.55],[px(52),pz(440),.035,.45]]){
softBox('Warm_Wall_Art_Frame',x,z,w,d,.65,woodMat,1.05);box('Warm_Wall_Art',x-.025,z,w*.35,d*.83,.52,artMat,1.12);
}
// 卧室增加床尾折毯及细分床头软包。
for(const m of model.children.filter(m=>m.name==='Bed_Throw'||m.name==='Secondary_Warm_Duvet')){
const p=m.geometry.parameters;softBox('Folded_Bed_Throw',m.position.x+.2,m.position.z,.28,Math.min(p.depth,1.4),.045,olive,m.position.y+.05);
}
// 客厅增加书本托盘与窗边矮凳，强化有人居住的细节。
for(let i=0;i<3;i++)softBox('Coffee_Book',px(422),pz(446),.3,.2,.025,i%2?terracotta:ivory,.36+i*.025);
// 按用户标注移除阳台长凳及坐垫，保留连续地面。
plant('Cozy_Living_Tree',px(534),pz(525),.02,.72);
// 深化主卧柜体正面，柜门朝向新位置的床。
const wardrobe=model.getObjectByName('Master_Wardrobe');const wp=wardrobe.geometry.parameters;
for(let i=0;i<5;i++){const z=wardrobe.position.z-wp.depth/2+(i+.5)*wp.depth/5;box('Master_New_Cabinet_Front',wardrobe.position.x-wp.width/2-.008,z,.016,wp.depth/5-.02,1.04,woodMat,.03);box('Master_New_Cabinet_Handle',wardrobe.position.x-wp.width/2-.025,z+.08,.025,.025,.23,mat.dark,.45);}
}

/** 根据用户最新照片和尺寸更新儿童房、主卧柜体与三米黑色沙发。 */
function latestFurniture(){
// 儿童房只移除床及床品，保留书桌、地毯、植物和中央灯控制。
for(const m of [...model.children])if(m.name.startsWith('Preview_Bed_')){model.remove(m);m.geometry?.dispose();}
// 将主卧整套床向左平移，使床头外缘与左侧墙内缘贴合。
const head=model.getObjectByName('Headboard');const headBox=new THREE.Box3().setFromObject(head);const innerWall=px(565+11/2);const shift=innerWall-headBox.min.x;
for(const m of model.children.filter(m=>['Master_Bed','Mattress','Headboard','Bed_Throw','Bed_Pillow','Master_Bed_Rug','Master_Bedside'].includes(m.name)))m.position.x+=shift;
// 折毯作为床品随主卧床移动；次卧折毯保持原位置。
for(const m of model.children.filter(m=>m.name==='Folded_Bed_Throw'&&m.position.x>px(565)))m.position.x+=shift;
// 清理原衣柜及旧门板、拉手，重新构造沿右侧整墙的深色通高柜。
const old=model.getObjectByName('Master_Wardrobe');const oldBounds=new THREE.Box3().setFromObject(old);
for(const m of [...model.children])if(m.name==='Master_Wardrobe'||m.name.startsWith('Master_New_Cabinet_')||(m.name==='Cabinet_Seam'&&m.position.x>=oldBounds.min.x-.05&&m.position.x<=oldBounds.max.x+.05&&m.position.z>=oldBounds.min.z&&m.position.z<=oldBounds.max.z)){model.remove(m);m.geometry?.dispose();}
const graphite=new THREE.MeshStandardMaterial({color:'#252a2d',roughness:.75});
const handleMat=new THREE.MeshStandardMaterial({color:'#0f1417',metalness:.3,roughness:.55});
const unit=new THREE.Group();unit.name='Master_Wardrobe';unit.userData.fullWall=true;unit.userData.height=WALL_HEIGHT;model.add(unit);
const start=pz(371),end=pz(577),length=end-start,depth=.6,height=WALL_HEIGHT,right=px(747),x=right-depth/2;
/** 将柜体零件归入整体，保持导出时的空间结构。 */
function cabinetPart(name,x,z,w,d,h,material,y=0){const m=box(name,x,z,w,d,h,material,y);unit.attach(m);return m;}
const shelfLength=.58,closedLength=length-shelfLength;
cabinetPart('Master_Closet_Body',x,start+closedLength/2,depth,closedLength,height,graphite);
for(let i=0;i<6;i++){const z=start+(i+.5)*closedLength/6;cabinetPart('Master_Closet_Door',x-depth/2-.012,z,.025,closedLength/6-.012,height-.04,graphite,.02);cabinetPart('Master_Closet_Handle',x-depth/2-.031,z+.1,.02,.022,.55,handleMat,.6);}
// 靠窗端增加照片中的开放格及小台面。
const shelfZ=end-shelfLength/2;
cabinetPart('Master_Closet_Open_Back',right-.02,shelfZ,.04,shelfLength,height,graphite);
cabinetPart('Master_Closet_Open_Side',x,end,.6,.03,height,graphite);
for(const y of [.04,.65,1.25,1.85,height-.035])cabinetPart('Master_Closet_Open_Shelf',x,shelfZ,depth,shelfLength,.035,graphite,y);
// 沙发统一替换为完整三米黑色软包组合，总长度含两端扶手。
for(const m of [...model.children])if(m.name==='Living_Sofa'||m.name.startsWith('Sofa_')){model.remove(m);m.geometry?.dispose();}
const leather=new THREE.MeshStandardMaterial({color:'#171b1e',roughness:.58});
const sofaX=px(355),sofaZ=pz(445),sofaLength=3,arm=.14;
softBox('Living_Sofa',sofaX,sofaZ,.9,sofaLength,.3,leather,.1);
softBox('Sofa_Back',sofaX-.38,sofaZ,.14,sofaLength,.64,leather,.22);
for(const side of [-1,1])softBox('Sofa_Arm',sofaX,sofaZ+side*(sofaLength/2-arm/2),.9,arm,.53,leather,.1);
const seatLength=(sofaLength-2*arm)/3;
for(let i=0;i<3;i++){const z=sofaZ-(sofaLength-2*arm)/2+(i+.5)*seatLength;softBox('Sofa_Cushion',sofaX+.035,z,.68,seatLength-.018,.13,leather,.4);softBox('Sofa_Back_Cushion',sofaX-.24,z,.19,seatLength-.02,.42,leather,.48);}
for(const side of [-1,1])for(const dx of [-.28,.28])box('Sofa_Foot',sofaX+dx,sofaZ+side*1.25,.06,.06,.1,handleMat);
// 地毯适当延长，与三米沙发对应。
const rug=model.getObjectByName('Living_Rug');if(rug){const size=new THREE.Box3().setFromObject(rug).getSize(new THREE.Vector3());rug.scale.z*=2.8/size.z;rug.position.z=sofaZ;}
}
/** 按实景重建悬浮白色电视背景板、低柜与靠阳台的到顶展示柜。 */
function rebuildTVArea(){
// 保留原结构墙和主卧门洞，仅替换客厅一侧的装饰及家具。
for(const m of [...model.children])if(m.name==='TV'||m.name==='TV_Cabinet'){model.remove(m);m.geometry?.dispose();}
const whitePanel=new THREE.MeshStandardMaterial({color:'#f0eee8',roughness:.7});
const greyOak=new THREE.MeshStandardMaterial({color:'#8d8a80',roughness:.8});
const blackScreen=new THREE.MeshStandardMaterial({color:'#101416',roughness:.4});
const charcoal=new THREE.MeshStandardMaterial({color:'#242b2d',roughness:.7});
const smokedGlass=new THREE.MeshPhysicalMaterial({color:'#344044',transparent:true,opacity:.38,roughness:.12,metalness:.08,depthWrite:false});
const start=pz(407),panelEnd=pz(488),end=pz(537),panelWidth=panelEnd-start,panelCenter=(start+panelEnd)/2;
const back=px(559),front=back-.1,cabinetDepth=.43;
// 白板与墙面略微错层，黑色中央区域保持照片中的横向比例。
box('Living_TV_Backboard',back,panelCenter,.08,panelWidth,1.42,whitePanel,.55);
box('Living_TV_Black_Center',front-.012,panelCenter,.025,panelWidth*.77,1.02,blackScreen,.75);
box('Living_TV_Low_Cabinet',back-cabinetDepth/2,(start+end)/2,cabinetDepth,end-start,.31,greyOak,.07);
box('Living_TV_Cabinet_Top',back-cabinetDepth/2,(start+end)/2,cabinetDepth+.025,end-start,.025,charcoal,.38);
for(let i=1;i<5;i++)box('Living_TV_Drawer_Seam',back-cabinetDepth-.003,start+(end-start)*i/5,.006,.008,.27,charcoal,.09);
// 靠阳台一侧为通高木纹柜，中央黑色玻璃展示格顶部与 2.28 米墙顶齐平。
const sideStart=panelEnd+.018,sideLength=end-sideStart,sideCenter=(sideStart+end)/2;
box('Living_TV_Tall_Cabinet_Back',back+.01,sideCenter,.035,sideLength,WALL_HEIGHT,greyOak);
const glassWidth=sideLength*.34,doorWidth=(sideLength-glassWidth)/2;
for(const side of [-1,1]){
const z=sideCenter+side*(glassWidth/2+doorWidth/2);
box('Living_TV_Tall_Cabinet',back-cabinetDepth/2,z,cabinetDepth,doorWidth-.012,WALL_HEIGHT,greyOak);
box('Living_TV_Tall_Door_Seam',back-cabinetDepth-.005,z+side*doorWidth*.36,.006,.006,WALL_HEIGHT-.06,charcoal,.03);
}
box('Living_TV_Display_Back',back-.015,sideCenter,.035,glassWidth,WALL_HEIGHT,charcoal);
box('Living_TV_Display_Glass',back-cabinetDepth-.008,sideCenter,.018,glassWidth,WALL_HEIGHT-.035,smokedGlass,.015);
for(const y of [.04,.58,1.12,1.67,WALL_HEIGHT-.035])box('Living_TV_Display_Shelf',back-cabinetDepth/2,sideCenter,cabinetDepth,glassWidth,.035,charcoal,y);
// 上下暖光附着于背景板边缘，与已有电视墙灯带控制组同步。
for(const y of [.53,1.99]){
const glow=new THREE.Mesh(new THREE.PlaneGeometry(panelWidth+.08,.18),new THREE.MeshBasicMaterial({map:glowTexture,color:0xffd79a,transparent:true,opacity:.7,depthWrite:false}));
glow.name='Living_TV_Indirect_Glow';glow.rotation.y=-Math.PI/2;glow.position.set(back-.048,y,panelCenter);model.add(glow);groups.tv.pools.push(glow);
}
groups.tv.lights.forEach((light,i)=>{light.position.set(front-.12,i===0?.53:1.99,panelCenter);});
groups.tv.anchor.set(front-.18,.9,panelCenter);
// 腾出侧柜前方空间，绿植移到阳台窗边。
const tree=model.getObjectByName('Cozy_Living_Tree');if(tree){tree.position.x=px(520);tree.position.z=pz(555);}
}
/** 创建深色上下柜和整块石纹背板，开放区不设置棕色层板。 */
function rebuildDiningSideboard(){
const dark=new THREE.MeshStandardMaterial({color:'#202528',roughness:.72});
const seam=new THREE.MeshStandardMaterial({color:'#0b1012',roughness:.75});
const start=pz(420),end=pz(479),length=end-start,center=(start+end)/2;
const rear=px(204),depth=.39,front=rear+depth;
// 柜体位于餐桌后方西墙，北侧原次卧入口继续留空。
box('Dining_Sideboard_Base',rear+depth/2,center,depth,length,.84,dark,.035);
box('Dining_Sideboard_Worktop',rear+depth/2,center,depth+.025,length+.02,.035,seam,.875);
box('Dining_Sideboard_Upper',rear+.16,center,.32,length,WALL_HEIGHT-1.65,dark,1.65);
for(let i=1;i<4;i++){
const z=start+length*i/4;
box('Dining_Sideboard_Base_Seam',front+.003,z,.006,.006,.8,seam,.06);
box('Dining_Sideboard_Upper_Seam',rear+.323,z,.006,.006,WALL_HEIGHT-1.69,seam,1.67);
}
// 用固定种子的画布纹理表现黑底白纹石材，不依赖远程图片。
const canvas=document.createElement('canvas');canvas.width=512;canvas.height=384;
const ctx=canvas.getContext('2d');ctx.fillStyle='#172022';ctx.fillRect(0,0,512,384);
let seed=731;
/** 生成稳定的石材纹路，重新加载时保持一致。 */
function random(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}
for(let i=0;i<23;i++){
let x=random()*512,y=-35;ctx.beginPath();ctx.moveTo(x,y);
for(let j=0;j<12;j++){x+=(random()-.47)*90;y+=40;ctx.lineTo(x,y);}
ctx.strokeStyle=i%3===0?'#bbc1b6':'#646f68';ctx.lineWidth=i%3===0?2.1:.85;ctx.stroke();
}
const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
const stone=new THREE.Mesh(new THREE.PlaneGeometry(length,.74),new THREE.MeshStandardMaterial({map:texture,roughness:.4}));
stone.name='Dining_Sideboard_Stone_Back';stone.rotation.y=Math.PI/2;stone.position.set(rear+.035,1.28,center);model.add(stone);
// 开放区保留连续的整块背景面，不再用层板分割。
// 临门侧黑色收边和门楣延续照片的整体造型，不封堵通道。
box('Dining_Sideboard_End_Panel',rear+depth/2,start+.01,depth,.025,WALL_HEIGHT,dark);
const doorStart=pz(366),doorEnd=pz(419);
box('Dining_Sideboard_Door_Header',rear+.1,(doorStart+doorEnd)/2,.2,doorEnd-doorStart,WALL_HEIGHT-2.04,dark,2.04);
box('Dining_Sideboard_Door_Jamb',rear+.1,doorStart+.015,.2,.03,2.04,dark);
}
/** 按实景重建两米石纹餐桌及两侧各两把黑色餐椅。 */
function rebuildDiningTable(){
const oldTable=model.getObjectByName('Dining_Table');
const width=oldTable.geometry.parameters.width;
// 只删除旧桌椅及桌上示意花盆，保留餐边柜。
for(const m of [...model.children])if(m.name==='Dining_Table'||m.name==='Dining_Leg'||m.name.startsWith('Dining_Upholstered_')||m.name==='Dining_Chair_Leg'||m.name.startsWith('Dining_Flowers_')){model.remove(m);m.geometry?.dispose();}
// 桌面保持完整浅色石材表面，不添加容易看成横线的示意纹路。
const stone=new THREE.MeshStandardMaterial({color:'#e3e1d7',roughness:.3});
const black=new THREE.MeshStandardMaterial({color:'#171c1f',roughness:.65});
const metal=new THREE.MeshStandardMaterial({color:'#121719',roughness:.5,metalness:.35});
// 平面圆角使用挤出轮廓，长边精确两米，桌面总高 0.78 米。
const length=2,r=.14,shape=new THREE.Shape(),x=-width/2,z=-length/2;
shape.moveTo(x+r,z);shape.lineTo(x+width-r,z);shape.quadraticCurveTo(x+width,z,x+width,z+r);
shape.lineTo(x+width,z+length-r);shape.quadraticCurveTo(x+width,z+length,x+width-r,z+length);
shape.lineTo(x+r,z+length);shape.quadraticCurveTo(x,z+length,x,z+length-r);
shape.lineTo(x,z+r);shape.quadraticCurveTo(x,z,x+r,z);
const geometry=new THREE.ExtrudeGeometry(shape,{depth:.045,bevelEnabled:false,curveSegments:12});geometry.rotateX(-Math.PI/2);
const table=new THREE.Mesh(geometry,stone);table.name='Dining_Table';table.position.set(diningX,.735,lightCenterZ);model.add(table);
// 双黑色锥形底座沿长边排列。
for(const dz of [-.52,.52]){
const foot=new THREE.Mesh(new THREE.CylinderGeometry(.19,.3,.735,40),black);foot.name='Dining_Pedestal';foot.scale.x=.88;foot.position.set(diningX,.3675,lightCenterZ+dz);model.add(foot);
}
// 四把椅子收进桌沿，两侧各两把，不再使用旧三椅布局。
for(const side of [-1,1])for(const dz of [-.52,.52]){
const chair=new THREE.Group();chair.name='Dining_Chair';chair.userData.side=side;chair.position.set(diningX+side*.4,0,lightCenterZ+dz);model.add(chair);
/** 将椅子部件归入对应组，便于核验数量与摆位。 */
function part(name,dx,dz,w,d,h,material,y){const m=softBox(name,chair.position.x+dx,chair.position.z+dz,w,d,h,material,y);chair.attach(m);}
part('Dining_Black_Seat',0,0,.4,.44,.07,black,.43);
part('Dining_Black_Back',side*.17,0,.045,.42,.39,black,.49);
// 黑白竖纹软包靠背，朝向餐桌一面。
for(let i=0;i<6;i++)part('Dining_Back_Stripe',side*.144,-.17+i*.068,.008,.018,.31,i%2?black:mat.white,.53);
for(const dx of [-.145,.145])for(const dz of [-.17,.17])part('Dining_Black_Leg',dx,dz,.022,.022,.43,metal,0);
}
}
/** 创建独立控制分组和侧栏按钮。 */
function group(id,name,detail,section){if(!document.querySelector('[data-section="'+section+'"]')){const h=document.createElement('h3');h.dataset.section=section;h.textContent=section;document.querySelector('#lights').append(h);}const button=document.createElement('button');button.className='light';button.dataset.group=id;button.innerHTML='<span>'+name+'<small>'+detail+'</small></span><span class="dot"></span>';button.setAttribute('aria-pressed','false');button.addEventListener('click',()=>toggle(id));document.querySelector('#lights').append(button);groups[id]={name,on:false,meshes:[],pools:[],lights:[],anchors:[],marker:null,button};}
/** 仅创建光效与照明，不创建实体灯具、吊线和投影物体。 */
function lamp(id,x,z,kind='spot'){
const size=kind==='main'?2.8:kind==='pendant'?2.3:1.8;
const pool=new THREE.Mesh(new THREE.PlaneGeometry(size,size),new THREE.MeshBasicMaterial({map:glowTexture,color:0xffcd86,transparent:true,opacity:.5,depthWrite:false}));
pool.name=id+'_Glow';pool.rotation.x=-Math.PI/2;pool.position.set(x,.012,z);pool.visible=false;pool.castShadow=false;pool.receiveShadow=false;model.add(pool);groups[id].pools.push(pool);
const light=new THREE.PointLight(0xffc35c,0,kind==='pendant'?4:3,2);light.name=id+'_Illumination';light.position.set(x,kind==='pendant'?1.55:1.8,z);light.userData.power=kind==='main'?3.5:kind==='pendant'?2.6:1.25;light.castShadow=false;model.add(light);groups[id].lights.push(light);groups[id].anchors.push({x,z});
}
/** 灯带仅保留柔和光效，不在房间上方显示灯带几何。 */
function strip(id,x,z,w,d,y){
const light=new THREE.PointLight(0xffce76,0,3,2);light.name=id+'_Illumination';light.position.set(x,y-.12,z);light.userData.power=2.5;light.castShadow=false;model.add(light);groups[id].lights.push(light);groups[id].anchors.push({x,z});
const pool=new THREE.Mesh(new THREE.PlaneGeometry(Math.max(w,.9),Math.max(d,.9)),new THREE.MeshBasicMaterial({map:glowTexture,color:0xffce76,transparent:true,opacity:.4,depthWrite:false}));pool.name=id+'_Glow';pool.rotation.x=-Math.PI/2;pool.position.set(x,.016,z);pool.visible=false;model.add(pool);groups[id].pools.push(pool);
}
/** 按灯带、射灯和其他灯返回不同轮廓，保持相同图标尺寸与描边。 */
function lightMarkerIcon(kind){
const shapes={
strip:'<rect x="3" y="7" width="18" height="5" rx="1.5"/><path d="M7 15v3M12 15v4M17 15v3"/>',
spot:'<path d="M8 4h8l2 7H6l2-7ZM12 2v2M8 14l-3 5M12 14v6M16 14l3 5"/>',
other:'<path d="M9 17h6M10 20h4M9 14c-1.8-1-3-2.9-3-5a6 6 0 1 1 12 0c0 2.1-1.2 4-3 5v3H9v-3Z"/>',
};
return '<svg viewBox="0 0 24 24" aria-hidden="true">'+shapes[kind]+'</svg>';
}
/** 每个控制组显示对应灯具类型的图标，保留原有整组开关功能。 */
function createMarkers(){
const layer=document.createElement('div');layer.className='marker-layer';host.append(layer);
for(const [id,g] of Object.entries(groups)){
const marker=document.createElement('button');marker.className='light-marker';marker.dataset.light=id;marker.setAttribute('aria-label',g.name);marker.title=g.name;marker.setAttribute('aria-pressed',String(g.on));
// 主卧混合回路按主灯归入其他灯，避免把同一路拆成两个控制按钮。
const kind=['tv','ceiling'].includes(id)?'strip':['living','hall','balcony','masterYellow'].includes(id)?'spot':'other';
marker.dataset.lightKind=kind;marker.innerHTML=lightMarkerIcon(kind);
marker.addEventListener('click',e=>{e.stopPropagation();toggle(id);});layer.append(marker);
g.marker=marker;const a=g.anchors;g.anchor=new THREE.Vector3(a.reduce((v,p)=>v+p.x,0)/a.length,.55,a.reduce((v,p)=>v+p.z,0)/a.length);if(id==='masterRed')g.anchor.set(px(658.5),.55,pz(474));
}
}
/** 用模型中的实际尺寸投影计算图标直径，随缩放及画布尺寸同步变化。 */
function positionMarkers(){
camera.updateMatrixWorld();
const right=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0);
for(const g of Object.values(groups)){
if(!g.marker)continue;
const p=g.anchor.clone().project(camera);
const edge=g.anchor.clone().addScaledVector(right,.58).project(camera);
const size=Math.abs(edge.x-p.x)*host.clientWidth/2;
g.marker.hidden=p.z < -1 || p.z > 1 || Math.abs(p.x)>1.05 || Math.abs(p.y)>1.05;
g.marker.style.left=((p.x+1)*host.clientWidth/2)+'px';g.marker.style.top=((-p.y+1)*host.clientHeight/2)+'px';
g.marker.style.width=size+'px';g.marker.style.height=size+'px';g.marker.style.setProperty('--marker-border',size/34+'px');g.marker.style.setProperty('--marker-glow',size*.4+'px');
}
}
// 新吊顶图：餐厅中心距左参考墙 600+1440 mm；客厅中心距右参考墙 1800 mm。
const diningX=px(205)+.6+1.44,livingX=px(565)-1.8,lightCenterZ=pz(351)+1.4;
group('dining','餐厅灯','长条吊灯 · 1 路','客厅与阳台');lamp('dining',diningX,lightCenterZ,'pendant');
group('living','客厅灯','3 盏射灯 · 1 路','客厅与阳台');for(let i=0;i<3;i++)lamp('living',livingX,lightCenterZ+(i-1)*.18);
group('tv','电视墙灯带','上下两段 · 1 路','客厅与阳台');strip('tv',px(552),pz(427),.04,1.98,.4);strip('tv',px(552),pz(427),.04,1.98,1.7);
group('ceiling','顶部灯带','沿吊顶边缘 · 1 路','客厅与阳台');strip('ceiling',px(385),pz(373),6.7,.035,2.35);strip('ceiling',px(385),pz(481),6.7,.035,2.35);
group('hall','过道射灯','左侧 6 盏 · 1 路','客厅与阳台');for(let i=0;i<6;i++)lamp('hall',px(243+i*56),pz(310));
group('balcony','阳台射灯','右侧 4 盏 · 1 路','客厅与阳台');for(let i=0;i<4;i++)lamp('balcony',px(270+i*80),pz(538));
group('masterRed','主卧主灯与射灯','主灯 1 盏 + 门口射灯 1 盏','主卧');lamp('masterRed',px(656),pz(466),'main');lamp('masterRed',px(604),pz(388));
group('masterYellow','主卧筒灯','2 盏筒灯 · 1 路','主卧');lamp('masterYellow',px(710),pz(382));lamp('masterYellow',px(710),pz(399));

// 次卧、儿童房和书房各增加一路中央吸顶灯，按室内主要区域中心定位。
group('secondary','次卧吸顶灯','中央吸顶灯 · 1 路','房间灯光');lamp('secondary',px(122.5),pz(466),'main');
group('child','儿童房吸顶灯','中央吸顶灯 · 1 路','房间灯光');lamp('child',px(641),pz(191),'main');
group('study','书房吸顶灯','中央吸顶灯 · 1 路','房间灯光');lamp('study',px(493),pz(200),'main');

/** 切换整组灯具，模型与控制按钮保持一致。 */
function toggle(id,forced){const g=groups[id];g.on=forced??!g.on;g.meshes.forEach(m=>{m.material.emissiveIntensity=g.on?2:0;m.material.color.set(g.on?0xffdc9b:0x66686a);});g.pools.forEach(p=>p.visible=g.on);g.lights.forEach(l=>l.intensity=g.on?l.userData.power:0);g.button.setAttribute('aria-pressed',String(g.on));g.marker?.setAttribute('aria-pressed',String(g.on));render();}
/** 按需渲染，静止时不持续消耗平板 GPU。 */
let renderPending=false;
/** 合并同一帧的更新，避免初始化和整组切换时反复渲染。 */
function render(){if(renderPending)return;renderPending=true;requestAnimationFrame(()=>{renderPending=false;ao.ssaoMaterial.uniforms.cameraProjectionMatrix.value.copy(camera.projectionMatrix);ao.ssaoMaterial.uniforms.cameraInverseProjectionMatrix.value.copy(camera.projectionMatrixInverse);composer.render();positionMarkers();window.modelPreview?.deviceDisplay?.update();});}
/** 恢复初始斜俯视角。 */
// 相机高度等于水平距离，使默认和恢复视角精确保持向下俯看 45 度。
function reset(){camera.position.set(-9,Math.hypot(9,18),18);camera.zoom=1;camera.updateProjectionMatrix();controls.target.set(0,0,0);controls.update();render();}
/** 同步画布尺寸和投影，兼容平板缩放。 */
function resize(){const w=host.clientWidth,h=host.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;const half=Math.max(7.1,7.9/camera.aspect);camera.left=-half*camera.aspect;camera.right=half*camera.aspect;camera.top=half;camera.bottom=-half;camera.updateProjectionMatrix();composer.setSize(w,h);render();}
controls.addEventListener('change',render);new ResizeObserver(resize).observe(host);
document.querySelector('#secondary').onclick=()=>focusRoom(px(122),pz(467));document.querySelector('#study').onclick=()=>focusRoom(px(492),pz(200));
document.querySelector('#reset').onclick=reset;document.querySelector('#top').onclick=()=>{camera.position.set(0,24,.001);camera.zoom=1;camera.updateProjectionMatrix();controls.target.set(0,0,0);controls.update();render();};
// 墙体固定实际高度，不再切换成高矮不一的剖切墙。
document.querySelector('#walls').onclick=()=>render();
document.querySelector('#door').onclick=e=>{const open=e.currentTarget.getAttribute('aria-pressed')!=='true';doorRoot.children.forEach((m,i)=>{m.position.x+=(open?1:-1)*(i<2?1.82:1.1);m.visible=!open;});e.currentTarget.setAttribute('aria-pressed',String(open));e.currentTarget.textContent=open?'关闭书房门':'打开书房门';render();};
// 储物间推拉方向仅示意，门扇沿隔墙滑动。
document.querySelector('#storage').onclick=e=>{const open=e.currentTarget.getAttribute('aria-pressed')!=='true';storageRoot.position.z=open?-.78:0;e.currentTarget.setAttribute('aria-pressed',String(open));e.currentTarget.textContent=open?'关闭储物间门':'打开储物间门';render();};
document.querySelector('#all').onclick=()=>Object.keys(groups).forEach(id=>toggle(id,false));
// 位移超过阈值视为旋转手势，不触发灯光切换。
let down=null;renderer.domElement.addEventListener('pointerdown',e=>down={x:e.clientX,y:e.clientY});renderer.domElement.addEventListener('pointerup',e=>{if(!down||Math.hypot(e.clientX-down.x,e.clientY-down.y)>6)return;const r=renderer.domElement.getBoundingClientRect();const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),camera);const hit=ray.intersectObjects(pickables)[0];if(hit)toggle(hit.object.userData.group);down=null;});
/** 导出当前几何，剔除仅供界面展示的文字标签。 */
async function exportModel(){try{labels.forEach(l=>l.visible=false);const result=await new GLTFExporter().parseAsync(model,{binary:true,onlyVisible:true});const url=URL.createObjectURL(new Blob([result],{type:'model/gltf-binary'}));const a=document.createElement('a');a.href=url;a.download='home-layout-v11.glb';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){console.error('Model export failed',error);document.querySelector('#status').textContent='模型导出失败，请重试';}finally{labels.forEach(l=>l.visible=false);render();}}
document.querySelector('#export').onclick=exportModel;
// 供验证读取真实模型状态，不连接或操作 HA。
window.modelPreview={groups,scene,model,camera,controls,doorRoot,storageRoot,wallMeshes,render,renderer,composer};
floorDetails();furnish();interiorDetails();secondaryDetails();studyDetails();warmInteriors();swapMasterFurniture();cozyDetails();latestFurniture();createMarkers();rebuildTVArea();rebuildDiningSideboard();rebuildDiningTable();
// 以 DWG 毫米坐标替换旧截图结构，保留已确认的家具造型。
window.modelPreview.cadLayout=calibrateFromCAD({THREE,model,mat,groups,wallMeshes,doorRoot,storageRoot,wallHeight:WALL_HEIGHT,render});
window.modelPreview.livingQuality=refineLivingQuality({THREE,model,renderer,sun,scene});
window.modelPreview.softFurnishings=refineSoftFurnishings({THREE,model});
// 使用小范围接触阴影补足墙角层次，保留正交相机深度转换。
ao.kernelRadius=.12;ao.minDistance=.0001;ao.maxDistance=.04;ao.enabled=true;
window.modelPreview.renderQuality=enhanceRenderQuality({THREE,model,scene,renderer,sun,ao});
window.modelPreview.ceilingStrips=enhanceCeilingStrips({THREE,model,groups});
window.modelPreview.deviceDisplay=createDeviceDisplay({THREE,host,camera,render});
labels.forEach(l=>l.visible=false);resize();reset();Object.keys(groups).forEach(id=>toggle(id,true));document.querySelector('#status').textContent='模型预览 · 模拟灯光';
