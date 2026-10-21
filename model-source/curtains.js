/** 创建房间窗帘，并通过鼠标或触摸拖动控制开合。 */
export function addWindowCurtains({THREE,model,windows,camera,controls,renderer,render}){
const states={},pickables=[],canvas=renderer.domElement;
const cloth=new THREE.MeshStandardMaterial({color:'#d8ccb7',roughness:1,side:THREE.DoubleSide});
// 客厅仅设置一层半透明白纱，保留透光与窗外轮廓。
const sheer=new THREE.MeshStandardMaterial({color:'#ffffff',transparent:true,opacity:.42,depthWrite:false,roughness:1,side:THREE.DoubleSide});
const blindMaterial=new THREE.MeshStandardMaterial({color:'#c9c0ae',roughness:.85});
const railMaterial=new THREE.MeshStandardMaterial({color:'#b6b2a7',roughness:.6});
/** 创建可拾取的窗帘部件，保留所属房间及拖动方向。 */
function part(state,name,geometry,material,x,y,z,side=0){
const mesh=new THREE.Mesh(geometry,material);mesh.name=name;mesh.position.set(x,y,z);mesh.userData.curtainId=state.id;mesh.userData.curtainSide=side;state.group.add(mesh);pickables.push(mesh);return mesh;
}
/** 创建带褶皱的布帘面，避免仅用平板表现左右窗帘。 */
function foldedPanel(height=1.77){
const geometry=new THREE.PlaneGeometry(1,height,64,1),p=geometry.attributes.position;
for(let i=0;i<p.count;i++)p.setZ(i,Math.sin((p.getX(i)+.5)*Math.PI*16)*.022);
geometry.computeVertexNormals();return geometry;
}
for(const w of windows){
const id=w.name.split('_')[0].toLowerCase(),state={id,type:(w.sheer||['master','secondary'].includes(id))?'drapes':id==='study'?'venetian':'roller',open:.65,x:(w.x-8017)/1000,z:(w.z-7914)/1000+(w.south?-.13:.13),width:w.width,height:w.height,top:w.bottom+w.height};
state.axis=w.axis||'x';state.sheer=!!w.sheer;
state.group=new THREE.Group();state.group.name='Room_Curtain_'+id;model.add(state.group);states[id]=state;
if(state.type==='drapes'){
// 卧室帘停在飘窗上方；客厅白纱接近地面，沿 L 形落地窗两面布置。
const height=w.sheer?2.16:1.77,centerY=w.sheer?1.12:1.335,material=w.sheer?sheer:cloth;
state.left=part(state,id+'_Curtain_Left',foldedPanel(height),material,0,centerY,state.z,-1);
state.right=part(state,id+'_Curtain_Right',foldedPanel(height),material,0,centerY,state.z,1);
const track=part(state,id+'_Curtain_Track',new THREE.BoxGeometry(w.width+.06,.025,.045),railMaterial,state.x,2.24,state.z);
if(state.axis==='z'){state.left.rotation.y=state.right.rotation.y=track.rotation.y=Math.PI/2;}
}else{
part(state,id+'_Curtain_Cassette',new THREE.BoxGeometry(w.width+.04,.06,.06),railMaterial,state.x,state.top+.025,state.z);
if(state.type==='venetian'){
state.slats=[];
for(let i=0;i<22;i++){
const slat=part(state,id+'_Blind_Slat',new THREE.BoxGeometry(w.width-.04,.018,.055),blindMaterial,state.x,state.top,state.z);slat.rotation.x=.22;state.slats.push(slat);
}
}else state.fabric=part(state,id+'_Roller_Fabric',new THREE.PlaneGeometry(1,1),cloth,state.x,state.top,state.z);
state.bottom=part(state,id+'_Curtain_Bottom_Rail',new THREE.BoxGeometry(w.width-.025,.03,.035),railMaterial,state.x,state.top,state.z);
part(state,id+'_Curtain_Pull_Cord',new THREE.BoxGeometry(.006,.85,.006),railMaterial,state.x+w.width/2+.025,state.top-.43,state.z);
}
}
/** 根据开合比例更新布帘宽度、百叶帘堆叠高度或卷帘下垂长度。 */
function setOpen(id,value){
const s=states[id];if(!s)return;s.open=Math.max(0,Math.min(1,value));
if(s.type==='drapes'){
const width=(s.width/2-.025)*(1-s.open)+.14*s.open;
s.left.scale.x=width;s.right.scale.x=width;
if(s.axis==='z'){s.left.position.set(s.x,s.left.position.y,s.z-s.width/2+.02+width/2);s.right.position.set(s.x,s.right.position.y,s.z+s.width/2-.02-width/2);}
else{s.left.position.x=s.x-s.width/2+.02+width/2;s.right.position.x=s.x+s.width/2-.02-width/2;}
}else if(s.type==='venetian'){
const step=(s.height-.08)/22*(1-s.open)+.008*s.open;
s.slats.forEach((slat,i)=>slat.position.y=s.top-.045-i*step);s.bottom.position.y=s.slats.at(-1).position.y-.025;
}else{
const height=Math.max(.035,(s.height-.035)*(1-s.open));s.fabric.scale.set(s.width-.04,height,1);s.fabric.position.y=s.top-height/2;s.bottom.position.y=s.top-height;
}
render();
}
Object.keys(states).forEach(id=>setOpen(id,states[id].sheer?.15:.65));
const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();let drag=null;
/** 把世界空间方向投影为屏幕向量，保证旋转视角后拖动方向仍正确。 */
function screenVector(s,vertical){
const rect=canvas.getBoundingClientRect(),a=new THREE.Vector3(s.x,1.2,s.z),b=a.clone();
if(vertical)b.y+=s.height;else if(s.axis==='z')b.z+=s.width;else b.x+=s.width;
a.project(camera);b.project(camera);return {x:(b.x-a.x)*rect.width/2,y:-(b.y-a.y)*rect.height/2};
}
/** 优先拾取窗帘，拖动期间暂停模型旋转。 */
function onDown(event){
if(event.button!==0)return;const rect=canvas.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2);
model.updateMatrixWorld(true);raycaster.setFromCamera(pointer,camera);const hit=raycaster.intersectObjects(pickables,false)[0];if(!hit)return;
const s=states[hit.object.userData.curtainId];drag={id:s.id,side:hit.object.userData.curtainSide,open:s.open,x:event.clientX,y:event.clientY,pointer:event.pointerId,enabled:controls.enabled,axis:screenVector(s,s.type!=='drapes'),moved:0};
controls.enabled=false;canvas.setPointerCapture(event.pointerId);event.preventDefault();event.stopImmediatePropagation();
}
/** 将沿窗帘运动方向的拖动距离换算为开合比例。 */
function onMove(event){
if(!drag||event.pointerId!==drag.pointer)return;
const dx=event.clientX-drag.x,dy=event.clientY-drag.y,axis=drag.axis,denominator=axis.x*axis.x+axis.y*axis.y;
drag.moved=Math.hypot(dx,dy);const s=states[drag.id],direction=s.type==='drapes'?(drag.side||1)*2:1;
if(denominator>1)setOpen(drag.id,drag.open+(dx*axis.x+dy*axis.y)/denominator*direction);
event.preventDefault();event.stopImmediatePropagation();
}
/** 结束拖动；轻点窗帘或轨道可在全开与全关之间切换。 */
function onUp(event){
if(!drag||event.pointerId!==drag.pointer)return;
const current=drag;drag=null;if(event.type!=='pointercancel'&&current.moved<4)setOpen(current.id,current.open>.5?0:1);
controls.enabled=current.enabled;if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);event.preventDefault();event.stopImmediatePropagation();
}
canvas.addEventListener('pointerdown',onDown,true);canvas.addEventListener('pointermove',onMove,true);canvas.addEventListener('pointerup',onUp,true);canvas.addEventListener('pointercancel',onUp,true);
return {states,setOpen};
}
