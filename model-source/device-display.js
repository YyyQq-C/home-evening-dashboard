/** 添加模拟舒适设备控制与家电状态，不调用 HA 服务或读取真实设备状态。 */
export function createDeviceDisplay({THREE,host,camera,render}){
const colors={ac:'#337fc2',floor:'#d15d49',fresh:'#258961',fridge:'#8059aa',water:'#178b9a',washer:'#555bc4',purifier:'#b9588a'};
const icons={
ac:'<rect x="3" y="5" width="18" height="9" rx="2"/><path d="M6 11h12M7 17v3M12 17v3M17 17v3"/>',
floor:'<path d="M4 20h16M6 16c-5-4 5-5 0-10M12 16c-5-4 5-5 0-10M18 16c-5-4 5-5 0-10"/>',
fresh:'<path d="M3 7h12c6 0 6-6 2-5M3 12h15c5 0 5 7 0 7M3 17h7"/>',
fridge:'<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M6 9h12M9 5v2M9 12v4"/>',
water:'<path d="M12 2C9 7 5 11 5 15a7 7 0 0 0 14 0c0-4-4-8-7-13ZM9 15a3 3 0 0 0 3 3"/>',
washer:'<rect x="3" y="2" width="18" height="20" rx="2"/><path d="M3 7h18M6 4.5h1M10 4.5h1"/><circle cx="12" cy="14" r="5"/><path d="M8 14q2-2 4 0t4 0"/>',
purifier:'<rect x="4" y="8" width="6" height="13" rx="2"/><rect x="14" y="8" width="6" height="13" rx="2"/><path d="M7 8V4h10v4M10 13h4"/>',
};
const styles=document.createElement('style');styles.textContent=`
.device-layer{position:absolute;inset:0;pointer-events:none;z-index:2;overflow:hidden}
.device-marker{position:absolute;transform:translate(-50%,-50%);display:grid;place-items:center;width:29px;height:29px;min-height:0;padding:5px;border-radius:50%;border:1.5px solid var(--device-color);color:var(--device-color);background:#fffffff2;box-shadow:0 2px 6px #0002;pointer-events:auto;touch-action:manipulation}
.device-marker[aria-pressed="true"]{background:var(--device-color);color:#fff;border-color:#ffffffb0}
.device-marker:hover{background:var(--device-color);color:#fff}.device-marker svg{width:100%;height:100%;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.device-marker[hidden]{display:none}.device-marker:focus-visible{outline:3px solid var(--device-color);outline-offset:3px}
.device-status{position:absolute;top:50%;right:calc(100% + 5px);transform:translateY(-50%);white-space:nowrap;font:10px system-ui;color:var(--device-color);background:#fffffff0;border-radius:4px;padding:1px 4px;pointer-events:none}
.device-marker[data-device="fridge"] .device-status{right:auto;left:calc(100% + 5px)}
.device-sim-note{position:absolute;left:12px;bottom:10px;font:11px system-ui;color:#59616a;background:#fffffff0;border:1px solid #ddd;border-radius:8px;padding:6px 9px;pointer-events:auto;cursor:pointer}
.device-dialog{box-sizing:border-box;width:min(330px,calc(100vw - 28px));margin:auto;padding:22px;border:1px solid #d7dadd;border-radius:16px;background:#fff;color:#30343a;box-shadow:0 12px 50px #0003;font:14px system-ui}
.device-dialog::backdrop{background:#0003}.device-dialog h2{margin:0 28px 5px 0;font-size:19px;color:#30343a}.device-dialog p{margin:6px 0 16px;color:#7b8189;font-size:12px}.device-dialog .device-close{position:absolute;right:10px;top:8px;border:0;background:transparent;color:#6b7178;font-size:22px;min-height:36px;padding:4px 9px}
.device-dialog .device-state{font-size:16px;margin:18px 0;color:#30343a}.device-dialog .device-controls{display:flex;gap:9px;align-items:center}.device-dialog button{border-radius:9px;background:#f5f6f7;border:1px solid #ddd;color:#30343a;padding:9px 14px;min-height:42px}.device-dialog .device-power{margin-top:16px;width:100%;background:var(--device-color);color:white;border-color:transparent}
.device-dialog .device-temp{flex:1;text-align:center;font-size:23px}.device-dialog dl{margin:12px 0 0}.device-dialog dl div{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #eee}.device-dialog dt{color:#737a83}.device-dialog dd{margin:0;color:#30343a}.device-dialog .device-legend{display:flex;align-items:center;gap:8px;margin:12px 0}.device-dialog .device-swatch{width:12px;height:12px;border-radius:50%}
@media(max-width:800px){.device-marker{width:23px;height:23px;padding:4px}.device-sim-note{font-size:10px;padding:4px 7px}}
`;host.append(styles);
const layer=document.createElement('div');layer.className='device-layer';host.append(layer);
const dialog=document.createElement('dialog');dialog.className='device-dialog';dialog.setAttribute('aria-label','模拟设备详情');host.append(dialog);
const note=document.createElement('button');note.className='device-sim-note';note.textContent='模拟展示 · 图标说明';layer.append(note);
const devices=[];let selected=null;
const X=n=>(n-8017)/1000,Z=n=>(n-7914)/1000;
/** 按 CAD 平面位置创建独立设备图标，偏移仅用于避免同一房间图标重叠。 */
function device(id,name,kind,x,z,{offset=0,y=.65,details=[]}={}){
const item={id,name,kind,anchor:new THREE.Vector3(X(x),y,Z(z)),offset,on:false,temperature:kind==='floor'?22:26,details};
const button=document.createElement('button');button.type='button';button.className='device-marker';button.dataset.device=id;button.dataset.deviceKind=kind;button.style.setProperty('--device-color',colors[kind]);button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true">'+icons[kind]+'</svg>';
button.setAttribute('aria-label',name+'（模拟）');button.title=name+'（模拟）';
if(['ac','floor','fresh'].includes(kind))button.setAttribute('aria-pressed','false');
else{const status=document.createElement('span');status.className='device-status';status.textContent=details[0]?.[1]||'待机';button.append(status);}
button.addEventListener('click',event=>{event.stopPropagation();if(kind==='fresh'){item.on=!item.on;refreshMarkers();}else{selected=item;showDetails();dialog.showModal();}});
layer.append(button);item.button=button;devices.push(item);return item;
}
// 空调覆盖客厅、餐厅及四个房间；地暖在客餐厅共用一路，其余房间分别控制。
// 客厅、餐厅空调按用户绿色圈注移至客餐厅北侧空白处。
device('ac-living','客厅空调','ac',9617,8364);
device('ac-dining','餐厅空调','ac',5467,8264);
device('floor-living-dining','客餐厅地暖','floor',9067,12114);
for(const [id,name,x,z] of [['master','主卧',13517,9064],['secondary','次卧',2367,9214],['child','儿童房',13017,6014],['study','书房',9767,6114]]){
device('ac-'+id,name+'空调','ac',x,z,{offset:-23});
// 主卧入口附近已有灯光图标，地暖放在床尾侧空白处，避免挤出房间。
device('floor-'+id,name+'地暖','floor',id==='master'?14567:x,id==='master'?12414:z,{offset:id==='master'?0:23});
}
device('fresh','全屋新风','fresh',6267,12214);
// 家电状态使用明确的示例值，详情中统一标注模拟，不冒充真实 HA 状态。
device('fridge','冰箱','fridge',4855,6214,{y:1.35,details:[['运行状态','运行中'],['冷藏温度','4 °C'],['冷冻温度','−18 °C']]});
device('water','直饮机','water',4652,5414,{y:1.35,details:[['运行状态','待机'],['水温','25 °C']]});
device('washer','洗衣机','washer',4892,2364,{y:1.05,details:[['运行状态','待机'],['剩余时间','—']]});
device('purifier','水槽下净水器','purifier',4867,4564,{y:1.35,details:[['运行状态','待机'],['纯水 TDS','15'],['滤芯剩余','100%']]});
/** 同步图标的模拟开关状态，设备类别颜色始终保持不变。 */
function refreshMarkers(){
for(const item of devices){
if(item.button.hasAttribute('aria-pressed'))item.button.setAttribute('aria-pressed',String(item.on));
item.button.title=item.name+'（模拟）'+(item.button.hasAttribute('aria-pressed')?' · '+(item.on?'已开启':'已关闭'):' · 点击查看状态');
}
render();
}
/** 绘制模拟控制或状态详情，所有交互仅更新内存中的演示状态。 */
function showDetails(){
dialog.replaceChildren();
const close=document.createElement('button');close.className='device-close';close.textContent='×';close.setAttribute('aria-label','关闭设备详情');close.addEventListener('click',()=>dialog.close());dialog.append(close);
const title=document.createElement('h2');title.textContent=selected?.name||'图标说明';dialog.append(title);
const subtitle=document.createElement('p');subtitle.textContent='模拟展示，未连接真实设备';dialog.append(subtitle);
if(!selected){
for(const [kind,name] of Object.entries({ac:'空调',floor:'地暖',fresh:'新风',fridge:'冰箱',water:'直饮机',washer:'洗衣机',purifier:'净水器'})){
const row=document.createElement('div');row.className='device-legend';const swatch=document.createElement('span');swatch.className='device-swatch';swatch.style.background=colors[kind];row.append(swatch,document.createTextNode(name));dialog.append(row);
}return;
}
dialog.style.setProperty('--device-color',colors[selected.kind]);
if(['ac','floor'].includes(selected.kind)){
const state=document.createElement('div');state.className='device-state';state.textContent=selected.on?(selected.kind==='ac'?'制冷中（模拟）':'供暖中（模拟）'):'已关闭（模拟）';dialog.append(state);
const controls=document.createElement('div');controls.className='device-controls';
for(const delta of [-1,0,1]){
const element=document.createElement(delta?'button':'span');element.className=delta?'':'device-temp';element.textContent=delta?(delta<0?'−':'+'):selected.temperature+' °C';
if(delta){element.type='button';element.setAttribute('aria-label',delta<0?'降低设定温度':'升高设定温度');element.addEventListener('click',()=>{selected.temperature=Math.max(selected.kind==='ac'?16:15,Math.min(selected.kind==='ac'?30:35,selected.temperature+delta));showDetails();});}controls.append(element);
}dialog.append(controls);
const power=document.createElement('button');power.className='device-power';power.textContent=selected.on?'关闭':'开启';power.addEventListener('click',()=>{selected.on=!selected.on;refreshMarkers();showDetails();});dialog.append(power);
}else{
const list=document.createElement('dl');for(const [name,value] of selected.details){const row=document.createElement('div'),term=document.createElement('dt'),description=document.createElement('dd');term.textContent=name;description.textContent=value;row.append(term,description);list.append(row);}dialog.append(list);
}
}
note.addEventListener('click',()=>{selected=null;showDetails();dialog.showModal();});
dialog.addEventListener('click',event=>{if(event.target===dialog){const bounds=dialog.getBoundingClientRect();if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)dialog.close();}});
/** 旋转、缩放或调整视口后，将图标重新投影到对应房间和设备。 */
function update(){
const width=host.clientWidth,height=host.clientHeight;camera.updateMatrixWorld();
const hostRect=host.getBoundingClientRect(),radius=(devices[0]?.button.offsetWidth||23)/2,gap=9;
// 灯光图标保持真实灯位；新增设备图标只在所属锚点附近避让，保证触控间距。
const occupied=[...host.querySelectorAll('.light-marker:not([hidden])')].map(button=>{const rect=button.getBoundingClientRect();return {x:rect.left-hostRect.left+rect.width/2,y:rect.top-hostRect.top+rect.height/2,r:rect.width/2};});
const offsets=[[0,0],[0,-20],[0,20],[-20,0],[20,0],[-20,-20],[20,-20],[-20,20],[20,20],[0,-40],[0,40],[-40,0],[40,0],[-40,-20],[40,-20],[-40,20],[40,20]];
for(const item of devices){
const point=item.anchor.clone().project(camera);item.button.hidden=point.z< -1||point.z>1||Math.abs(point.x)>1.05||Math.abs(point.y)>1.05;
if(item.button.hidden)continue;
const baseX=(point.x+1)*width/2+item.offset,baseY=(1-point.y)*height/2;
let chosen=null,bestScore=Infinity;
for(const [dx,dy] of offsets){
const x=Math.max(radius+5,Math.min(width-radius-5,baseX+dx)),y=Math.max(radius+5,Math.min(height-radius-5,baseY+dy));
const overlap=occupied.reduce((sum,other)=>sum+Math.max(0,radius+other.r+gap-Math.hypot(x-other.x,y-other.y))**2,0);
const score=overlap*1000+dx*dx+dy*dy;
if(score<bestScore){bestScore=score;chosen={x,y,r:radius};}
if(overlap===0)break;
}
item.button.style.left=chosen.x+'px';item.button.style.top=chosen.y+'px';occupied.push(chosen);
}
}
refreshMarkers();return {devices,update,simulated:true};
}
