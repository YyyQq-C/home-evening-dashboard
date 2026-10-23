import {createVisiblePoll} from './runtime.js';
import {bindSidebarSwipe} from './sidebar-swipe.js';
import {createRoomClimateSource} from './room-climate-data.js';
import {createFloorplan} from './floorplan.js';
import {createHomeOverview} from './home-overview.js';
import {icon,lightIcon} from './icons.js';
import {createSettings} from './settings.js';
import {deviceOpensRoomInfo} from './preferences.js';
import {createWeather} from './weather.js';
import {createClimateDialog} from './climate-dialog.js';
import {createCalendar} from './calendar.js';
import {createPad} from './pad.js';
import {createApplianceDialog} from './appliance-dialog.js';
import {APPLIANCE_DEFINITIONS} from './appliance-data.js';
import {lunarDate} from './weather-data.js';
import {ROOMS,ROOM_LIGHTS,LIGHT_NAMES,SCENES,loadState,saveState,applyScene,bounded} from './state.js';

const state=loadState();
const ui={page:'home',kind:'ac',room:'living',device:'living',panel:'living',filter:'all',drafts:{},modal:null,markerKind:'lights',navOpen:false};
const roomClimate={living:[23.8,52],master:[24,50],secondary:[23.5,54],study:[23.6,48],child:[23.1,49]};
const temperatureTimers=new Map();
const roomClimateSimulated=new Set();
let initializing=true;
let modelReady=false,toastTimer,navIdleTimer;
const sceneFeedbackTimers=new WeakMap();
let roomPanelLastActivity=Date.now(),lastRoomPanelDelay=10;
let displayedPage='home',pageAnimations=[],pageTransitionId=0,pageTransitionDone=Promise.resolve();
let roomScrollTarget=null,lastPanelRoom='living',roomSettleTimer;
let roomPanelOpen=null,roomPanelAnimations=[],roomPanelMotionId=0;
let roomPanelMarkup='',shellSignature='',clockZone='',clockMinute='',clockDay='';
let clockTimeFormat,clockDateFormat;
const modelSignatures=new Map();
const roomPanelCards=new Map();
const screen=document.querySelector('#screen');
const frame=document.querySelector('#model');
let activeHouseMode=null;
const floorplan=createFloorplan({onDevice:operateModelDevice});
const settings=createSettings({icon,onChange:applyDisplayPreferences});
const weather=createWeather({});
let overview=null;
const roomClimateSource=createRoomClimateSource({onChange:updateRoomClimateReadings});
const calendar=createCalendar({getTimeZone:()=>weather.timeZone()});
const pad=createPad();
const climateDialog=createClimateDialog({state,getDrafts:()=>ui.drafts,onChange:()=>commit(),getReading:(kind,id)=>roomClimateSource.read(kind,id),onPrepare:(kind,id)=>roomClimateSimulated.add(`${kind}:${id}`),isSimulated:(kind,id)=>roomClimateSimulated.has(`${kind}:${id}`),onTemperatureChange:(kind,id,delta)=>editTemperature(kind,id,delta)});
const applianceDialog=createApplianceDialog({state,valueFor,stepButton,toggle});
let defaultMarkerKind=settings.preferences.markerKind;
ui.markerKind=defaultMarkerKind;

/** 用新收到的真实读数更新展示基线，不保存或下发设备控制。 */
function updateRoomClimateReadings(changed) {
  for(const {kind,id,reading} of changed){
    const item=state[kind][id],draftKey=`${kind}:${id}:temperature`;
    clearTimeout(temperatureTimers.get(draftKey));temperatureTimers.delete(draftKey);delete ui.drafts[draftKey];
    roomClimateSimulated.delete(`${kind}:${id}`);
    if(!reading.available)continue;
    item.on=reading.on;
    if(reading.temperature!==null)item.temperature=reading.temperature;
    if(kind==='ac'){if(reading.mode)item.mode=reading.mode;if(reading.fan)item.fan=reading.fan;}
  }
  if(!initializing){if(ui.page==='home')renderHome();climateDialog.refresh();}
}
/** 应用显示偏好；只在默认分类被修改时重置用户当前的模型筛选。 */
function applyDisplayPreferences(preferences) {
  screen.dataset.applianceColumns=String(preferences.applianceColumns);
  if(lastRoomPanelDelay!==preferences.roomPanelSeconds){lastRoomPanelDelay=preferences.roomPanelSeconds;noteRoomPanelActivity();}
  if(defaultMarkerKind!==preferences.markerKind){ui.markerKind=preferences.markerKind;defaultMarkerKind=preferences.markerKind;}
  renderHome();syncModel(false);
}

/** 读取某个窗口当前露出来的宽高，不采用被内容撑大的布局宽度。 */
function visibleSize(target) {
  const root=target.document.documentElement;
  const view=target.visualViewport;
  let width=root.clientWidth||target.innerWidth;
  let height=root.clientHeight||target.innerHeight;
  if(view&&view.width&&view.height) {
    width=Math.min(width,view.width);
    height=Math.min(height,view.height);
  }
  return {width,height};
}
/** 仪表盘 iframe 若被 100vw 撑宽，改成父页面真正可见的尺寸。 */
function fitFrame() {
  try {
    const frame=window.frameElement;
    if(!frame||window.parent===window) return null;
    const visible=visibleSize(window.parent);
    frame.style.position='fixed';
    frame.style.left='0';
    frame.style.top='0';
    frame.style.width=`${visible.width}px`;
    frame.style.height=`${visible.height}px`;
    frame.style.maxWidth='none';
    frame.style.border='0';
    return visible;
  } catch(error) {
    console.warn('Evening screen parent viewport is unavailable');
    return null;
  }
}
/** 将 2000×1200 基准画布等比缩进当前可见区域。 */
function resizeScreen() {
  const parent=fitFrame();
  const own=visibleSize(window);
  const width=parent?Math.min(own.width,parent.width):own.width;
  const height=parent?Math.min(own.height,parent.height):own.height;
  if(width<64||height<64) return;
  const scale=Math.min(width/2000,height/1200);
  screen.style.transform=`scale(${scale})`;
  screen.style.left=`${Math.max(0,(width-2000*scale)/2)}px`;
  screen.style.top=`${Math.max(0,(height-1200*scale)/2)}px`;
}
/** 以 HA 家庭时区更新时间、公历与农历，独立预览回退上海时区。 */
function updateClock() {
  if(document.hidden)return;
  const now=new Date(),timeZone=weather.timeZone();
  if(clockZone!==timeZone){
    clockZone=timeZone;clockMinute='';clockDay='';
    clockTimeFormat=new Intl.DateTimeFormat('zh-CN',{timeZone,hour:'2-digit',minute:'2-digit',hour12:false});
    clockDateFormat=new Intl.DateTimeFormat('zh-CN',{timeZone,year:'numeric',month:'numeric',day:'numeric',weekday:'short'});
  }
  const minute=clockTimeFormat.format(now);
  if(clockMinute!==minute){clockMinute=minute;document.querySelector('#clock').textContent=minute;}
  const parts=Object.fromEntries(clockDateFormat.formatToParts(now).map(part=>[part.type,part.value]));
  const day=`${parts.year}年${parts.month}月${parts.day}日  ${parts.weekday}`;
  if(clockDay!==day){clockDay=day;document.querySelector('#date').textContent=day;document.querySelector('#lunar-date').textContent=lunarDate(now,timeZone);}
  calendar.refresh();
}
/** 生成带无障碍状态和目标信息的模拟电源开关。 */
function toggle(kind,id,on,label,className='') {
  return `<button type="button" class="toggle ${className}" role="switch" aria-label="${label}" aria-checked="${on}" data-action="toggle" data-kind="${kind}" data-id="${id}"></button>`;
}
/** 创建统一圆形加减按钮，不直接提交温度变化。 */
function stepButton(kind,id,delta,label,field='temperature') {
  return `<button class="circle-button" type="button" aria-label="${label}" data-action="step" data-kind="${kind}" data-id="${id}" data-field="${field}" data-delta="${delta}">${icon(delta>0?'plus':'minus')}</button>`;
}
/** 返回用户正在编辑的数值；未编辑时使用当前模拟值。 */
function valueFor(kind,id,field='temperature') {
  const item=kind==='appliances'?state.appliances[id]:state[kind][id];
  return ui.drafts[`${kind}:${id}:${field}`]??item[field];
}
/** 更新温度草稿，按设备和字段分别等待最后一次操作后空闲一秒再同步。 */
function editTemperature(kind,id,delta,field='temperature') {
  const key=`${kind}:${id}:${field}`,item=state[kind][id];
  const limitKind=kind==='appliances'?(id==='fridge'?(field==='freeze'?'freeze':'fridge'):'drinker'):kind;
  const reading=['ac','floor'].includes(kind)?roomClimateSource.read(kind,id):null;
  const next=valueFor(kind,id,field)+delta;
  const value=reading?.available&&reading.min!==null&&reading.max!==null?Math.max(reading.min,Math.min(reading.max,next)):bounded(next,limitKind);
  if(reading)roomClimateSimulated.add(`${kind}:${id}`);
  clearTimeout(temperatureTimers.get(key));temperatureTimers.delete(key);
  if(value===item[field])delete ui.drafts[key];
  else {
    ui.drafts[key]=value;
    temperatureTimers.set(key,setTimeout(()=>{
      temperatureTimers.delete(key);
      if(!(key in ui.drafts))return;
      try {item[field]=ui.drafts[key];delete ui.drafts[key];commit();}
      catch(error) {console.error('Temperature auto synchronization failed',error);toast('温度同步未完成，请重试');}
    },1000));
  }
  render();
}
/** 场景切换时取消尚未执行的温度修改，防止延迟覆盖场景设置。 */
function cancelTemperatureEdits() {
  for(const timer of temperatureTimers.values())clearTimeout(timer);
  temperatureTimers.clear();ui.drafts={};
}
/** 渲染六个用户指定的快捷模式，不增加其他模式。 */
function sceneStrip() {
  return `<div class="scene-strip">${SCENES.map(item=>`<button class="scene-button" data-action="scene" data-scene="${item.id}">${icon(item.icon)}<span>${item.name}</span></button>`).join('')}</div>`;
}
/** 为每个快捷按钮独立恢复点击反馈，重复点击只延长该按钮的反馈时间。 */
function showSceneFeedback(button) {
  if(!button)return;
  clearTimeout(sceneFeedbackTimers.get(button));
  button.classList.add('executed');
  sceneFeedbackTimers.set(button,setTimeout(()=>{
    button.classList.remove('executed');sceneFeedbackTimers.delete(button);
  },1200));
}
/** 从最近一次点击重新计算侧边栏闲置时间，后台渲染不延长展开时间。 */
function resetNavigationIdle() {
  clearTimeout(navIdleTimer);
  if(ui.navOpen)navIdleTimer=setTimeout(()=>setNavigation(false),30000);
}
/** 更新侧边栏展开状态，仅首次展开启动计时，保留手动收起入口。 */
function setNavigation(open) {
  const changed=ui.navOpen!==open;
  const navigation=document.querySelector('#navigation');
  // 与房间信息共用缓动曲线，CSS 保留收起节点以完成双向滑动。
  if(!screen.style.getPropertyValue('--navigation-easing'))screen.style.setProperty('--navigation-easing',roomPanelEasing());
  if(!open&&navigation.contains(document.activeElement))document.querySelector('#nav-handle').focus({preventScroll:true});
  ui.navOpen=open;navigation.hidden=!open;navigation.inert=!open;navigation.setAttribute('aria-hidden',String(!open));screen.dataset.navOpen=String(open);
  const handle=document.querySelector('#nav-handle');handle.setAttribute('aria-expanded',String(open));handle.setAttribute('aria-label',open?'收起导航':'展开导航');
  if(!open)clearTimeout(navIdleTimer);else if(changed)resetNavigationIdle();
}
/** 清理上一轮分页动画，让快速连续导航始终停在最新目标页面。 */
function finishPageTransition() {
  pageAnimations.forEach(animation=>animation.cancel());pageAnimations=[];
  document.querySelectorAll('.page').forEach(page=>page.classList.remove('page-moving','page-leaving'));
}
/** 按导航顺序只做合成层纵向位移，重组件在动画结束后更新。 */
function transitionPages() {
  const pages={home:document.querySelector('#home-page'),overview:document.querySelector('#overview-page'),appliances:document.querySelector('#appliance-page')};
  const previous=displayedPage,changed=previous!==ui.page;
  if(!changed)return pageTransitionDone;
  // 连续反向时从当前画面位置继续，不先跳回上一轮动画的起点。
  const positions=new Map();
  if(pageAnimations.length)for(const page of Object.values(pages))if(page.classList.contains('page-moving'))positions.set(page,getComputedStyle(page).transform);
  finishPageTransition();
  const id=++pageTransitionId;
  for(const [key,page] of Object.entries(pages)) {
    page.hidden=key!==ui.page;page.inert=key!==ui.page;
    page.setAttribute('aria-hidden',String(key!==ui.page));
  }
  displayedPage=ui.page;
  if(!settings.preferences.motion||matchMedia('(prefers-reduced-motion: reduce)').matches||typeof pages[ui.page].animate!=='function')return pageTransitionDone=Promise.resolve();
  const direction=Object.keys(pages).indexOf(ui.page)>Object.keys(pages).indexOf(previous)?1:-1;
  const outgoing=pages[previous],incoming=pages[ui.page],distance=screen.clientHeight;
  outgoing.classList.add('page-leaving','page-moving');incoming.classList.add('page-moving');
  // 页面不做透明混合，减少整屏图表与房屋图层滑动时的合成开销。
  const timing={duration:420,easing:roomPanelEasing(),fill:'both'};
  const animations=[
    outgoing.animate([{transform:positions.get(outgoing)||'translate3d(0,0,0)'},{transform:`translate3d(0,${-direction*distance}px,0)`}],timing),
    incoming.animate([{transform:positions.get(incoming)||`translate3d(0,${direction*distance}px,0)`},{transform:'translate3d(0,0,0)'}],timing),
    document.querySelector('#header-content').animate([{transform:`translate3d(0,${direction*90}px,0)`,opacity:0},{transform:'translate3d(0,0,0)',opacity:1}],timing)
  ];
  pageAnimations=animations;animations.forEach(animation=>animation.pause());
  // 先给首帧布局和合成层准备时间，再用同一时钟启动，避免第一帧被内容渲染耗尽。
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    if(id!==pageTransitionId)return;
    const start=document.timeline.currentTime;
    animations.forEach(animation=>{animation.play();animation.startTime=start;});
  }));
  pageTransitionDone=Promise.all(animations.map(animation=>animation.finished.catch(()=>{}))).then(()=>{
    if(id===pageTransitionId)finishPageTransition();
  });
  return pageTransitionDone;
}
/** 渲染固定导航及当前页面对应的标题、分类。 */
function renderShell({transition=true}={}) {
  const signature=JSON.stringify([ui.page,ui.page==='appliances'?ui.filter:null]);
  if(signature===shellSignature)return;
  shellSignature=signature;
  setNavigation(ui.navOpen);document.querySelector('#nav-handle').innerHTML=icon('arrow');
  document.querySelector('#navigation').innerHTML=[['home','首页','home'],['overview','家中概览','room'],['appliances','家电','appliance']].map(([id,name,shape])=>`<button class="nav-button" data-action="page" data-page="${id}" ${ui.page===id?'aria-current="page"':''}>${icon(shape)}<span>${name}</span></button>`).join('')+`<button class="nav-button" data-action="settings" aria-label="显示设置">${icon('settings')}<span>设置</span></button>`;
  const header=document.querySelector('#header-content');
  if(ui.page==='home') header.innerHTML=sceneStrip();
  else if(ui.page==='overview') header.innerHTML='<h1 class="page-heading">家中概览</h1>';
  else header.innerHTML=`<h1 class="page-heading">家电设备</h1><div class="section-tabs appliance-tabs" aria-label="家电筛选">${[['all','全部'],['kitchen','厨房'],['laundry','洗护']].map(([id,name])=>`<button class="tab-button" aria-pressed="${ui.filter===id}" aria-selected="${ui.filter===id}" data-action="filter" data-filter="${id}">${name}</button>`).join('')}</div>`;
  if(transition)transitionPages();
}
/** 渲染主页模型分类、视角入口及房间卡片，设备操作集中在房间卡片。 */
function renderHome() {
  syncHouseMode();
  floorplan.update(state,settings.preferences,ui.markerKind);
  const viewControls=document.querySelector('#view-controls');
  if(!viewControls.childElementCount)viewControls.innerHTML=`<button class="view-button" data-action="view" data-view="top">${icon('cube')}俯视</button><button class="view-button" data-action="view" data-view="reset">${icon('reset')}复位</button>`;
  document.querySelector('#view-controls').hidden=settings.preferences.houseMode!=='3d'||!settings.preferences.rotation;
  document.querySelector('#model-categories').hidden=!settings.preferences.markers;
  const categories=document.querySelector('#model-categories');
  if(categories.dataset.kind!==ui.markerKind){
    categories.innerHTML=[['all','全部','cube'],['lights','灯光','bulb'],['ac','空调','snow'],['fresh','新风','wind'],['floor','地暖','heat']].map(([kind,name,shape])=>`<button class="model-category" data-action="marker-kind" data-kind="${kind}" aria-pressed="${ui.markerKind===kind}" aria-label="显示${name}图标">${icon(shape)}<span>${name}</span></button>`).join('');
    categories.dataset.kind=ui.markerKind;
  }
  const panel=document.querySelector('#room-panel');
  layoutRoomPanel(panel);
  const roomOpen=document.querySelector('#room-panel-open');roomOpen.hidden=!!ui.panel;
  if(!roomOpen.childElementCount)roomOpen.innerHTML=`${icon('room')}房间信息`;
}
/** 用临界阻尼弹簧生成平滑起步、无回弹的减速曲线，旧浏览器回退到零初速度缓动。 */
function roomPanelEasing() {
  const end=1-9*Math.exp(-8);
  const curve=`linear(${Array.from({length:61},(_,index)=>{
    const t=index/60;
    return ((1-(1+8*t)*Math.exp(-8*t))/end).toFixed(6);
  }).join(',')})`;
  return CSS.supports('animation-timing-function',curve)?curve:'cubic-bezier(.4,0,.2,1)';
}
/** 在已有变换上叠加水平位移，显式使用三维矩阵供旧版 Android WebView 合成。 */
function translatedFrame(transform,x=0) {
  const matrix=new DOMMatrix(transform==='none'?undefined:transform);matrix.m41+=x;
  return `matrix3d(${[...matrix.toFloat64Array()].join(',')})`;
}
/** 固定房屋布局，仅在同一显示层移动房屋与工具栏，避免切换布局后再补偿导致跳动。 */
function layoutRoomPanel(panel) {
  const open=!!ui.panel,page=document.querySelector('#home-page');
  const motion=settings.preferences.motion&&!matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(roomPanelOpen===open&&motion){if(open)renderRoomPanel();return;}
  const house=document.querySelector(settings.preferences.houseMode==='2d'?'#floorplan':'#model-stage');
  const footer=document.querySelector('#model-footer'),compositor2d=settings.preferences.houseMode==='2d';
  const oldX=house.getBoundingClientRect().left,oldClip=getComputedStyle(house).clipPath;
  const oldFooterX=footer.getBoundingClientRect().left,wasHidden=panel.hidden;
  const panelShift=(compositor2d?new DOMMatrix(getComputedStyle(panel).transform==='none'?undefined:getComputedStyle(panel).transform).m41:parseFloat(getComputedStyle(panel).translate))||0,initial=roomPanelOpen===null;
  const id=++roomPanelMotionId;roomPanelOpen=open;
  for(const animation of roomPanelAnimations)animation.cancel();roomPanelAnimations=[];
  page.classList.add('room-moving');
  page.classList.toggle('room-open',open);panel.inert=!open;
  if(initial||!motion||typeof house.animate!=='function'){
    panel.hidden=!open;if(open)renderRoomPanel(true);
    page.classList.remove('room-moving');return;
  }
  // 关闭时暂留外层完成滑出，隔离点击；结束后再隐藏，不重建房屋实例。
  panel.hidden=false;
  // 展开前先准备卡片与滚动位置，避免首次滑入途中创建整排节点。
  if(open)renderRoomPanel(true);
  const scale=screen.getBoundingClientRect().width/screen.clientWidth;
  const offset=(oldX-house.getBoundingClientRect().left)/scale,offscreen=screen.clientWidth-panel.offsetLeft;
  const footerOffset=(oldFooterX-footer.getBoundingClientRect().left)/scale;
  // CSS 保留最终位移；动画直接从当前画面坐标走到该位移，结束时无需切换布局。
  const property=compositor2d?'transform':'translate';
  const houseTarget=getComputedStyle(house)[property],footerTarget=getComputedStyle(footer)[property];
  const houseFrames=compositor2d
    ?[{transform:translatedFrame(houseTarget,offset)},{transform:translatedFrame(houseTarget)}]
    :[{translate:`${(parseFloat(houseTarget)||0)+offset}px 0`},{translate:houseTarget}];
  const clip=getComputedStyle(house).clipPath;
  if(!compositor2d&&oldClip!==clip){houseFrames[0].clipPath=oldClip;houseFrames[1].clipPath=clip;}
  const panelFrames=compositor2d
    ?[{transform:translatedFrame('none',wasHidden?offscreen:panelShift)},{transform:translatedFrame('none',open?0:offscreen)}]
    :[{translate:`${wasHidden?offscreen:panelShift}px 0`},{translate:`${open?0:offscreen}px 0`}];
  const footerFrames=compositor2d
    ?[{transform:translatedFrame(footerTarget,footerOffset)},{transform:translatedFrame(footerTarget)}]
    :[{translate:`${(parseFloat(footerTarget)||0)+footerOffset}px 0`},{translate:footerTarget}];
  const options={duration:open?460:320,easing:roomPanelEasing(),fill:'both'};
  roomPanelAnimations=[house.animate(houseFrames,options),panel.animate(panelFrames,options),footer.animate(footerFrames,options)];
  // 先固定首帧，给房间内容布局和合成层准备时间，避免渲染卡片消耗入场动画时长。
  roomPanelAnimations.forEach(animation=>animation.pause());
  requestAnimationFrame(()=>{
    if(id!==roomPanelMotionId)return;
    const start=document.timeline.currentTime;
    roomPanelAnimations.forEach(animation=>{animation.play();animation.startTime=start;});
  });
  Promise.all(roomPanelAnimations.map(animation=>animation.finished.catch(()=>{}))).then(()=>{
    if(id!==roomPanelMotionId)return;
    panel.hidden=!roomPanelOpen;
    for(const animation of roomPanelAnimations)animation.cancel();roomPanelAnimations=[];
    page.classList.remove('room-moving');
  });
}
/** 按选择延迟加载或卸载三维页面，二维模式不保留后台 WebGL 渲染。 */
function syncHouseMode() {
  const mode=settings.preferences.houseMode;
  document.querySelector('#floorplan').hidden=mode!=='2d';
  document.querySelector('#model-stage').hidden=mode!=='3d';
  screen.dataset.houseMode=mode;
  if(activeHouseMode===mode)return;
  activeHouseMode=mode;modelReady=false;
  if(mode==='3d')retryModel();
  else {
    // 导航到空文档会销毁模型脚本与图形上下文，避免只隐藏仍占用资源。
    if(frame.hasAttribute('src'))frame.removeAttribute('src');
    document.querySelector('#model-loading').hidden=true;
  }
}
/** 创建整张设备卡片的点击层，保留开关语义但不绘制独立开关。 */
function roomTileToggle(kind,id,label,on,disabled=false) {
  return `<button type="button" class="room-tile-toggle" role="switch" aria-label="${label}" aria-checked="${on}" data-action="toggle" data-kind="${kind}" data-id="${id}" ${disabled?'disabled':''}></button>`;
}
/** 生成温控小卡片，温度按钮与整卡开关互相独立。 */
function roomClimateControl(kind,id,label) {
  const item=state[kind][id],live=roomClimateSource.read(kind,id),simulated=live.available&&roomClimateSimulated.has(`${kind}:${id}`);
  const on=live.available&&item.on,status=!live.available?'暂不可用':simulated?(item.on?(kind==='ac'?item.mode:'制热'):'已关闭'):live.status;
  const temperature=live.available&&live.temperature!==null?(ui.drafts[`${kind}:${id}:temperature`]??item.temperature):null,step=live.step;
  const controls=temperature===null?'<output>—</output>':`${stepButton(kind,id,-step,`降低${label}温度`)}<output>${temperature}°</output>${stepButton(kind,id,step,`提高${label}温度`)}`;
  return `<section class="room-tile room-climate ${kind} ${on?'is-on':''}" data-climate-entity="${live.entityId}">${roomTileToggle(kind,id,label,on,!live.available)}<div class="room-tile-face"><div class="room-tile-icons"><span class="room-tile-glyph">${icon(kind==='ac'?'aircon':'heat')}</span><button type="button" class="room-climate-settings" data-action="climate-open" data-kind="${kind}" data-id="${id}" data-label="${label}" aria-label="设置${label}" aria-haspopup="dialog">${icon('settings')}</button></div><strong title="${label}">${label}</strong><small>${status}${simulated?' · 模拟未下发':''}</small></div><div class="room-tile-temperature">${controls}</div></section>`;
}

/** 灯光和新风使用整卡开关，新风风速按钮独立操作并复用现有三档设置。 */
function roomDeviceControl(kind,id,label,status,on) {
  const speeds=kind==='fresh'?`<div class="room-fresh-speeds" role="group" aria-label="新风风速">${[1,2,3].map(speed=>`<button type="button" data-action="speed" data-speed="${speed}" aria-label="新风风速${speed}档" aria-pressed="${state.fresh.speed===speed}">${speed}档</button>`).join('')}</div>`:'';
  return `<section class="room-tile room-device ${kind} ${on?'is-on':''}">${roomTileToggle(kind,id,label,on)}<div class="room-tile-face"><span class="room-tile-glyph">${icon(kind==='light'?lightIcon(label):'wind')}</span><strong title="${label}">${label}</strong><small>${status}</small></div>${speeds}</section>`;
}
/** 用轻量矢量符号表示房间，替代模型截图，不额外请求图片资源。 */
function roomSymbol(room,className='') {
  const shapes={living:'roomLiving',master:'roomMaster',secondary:'roomSecondary',study:'roomStudy',child:'roomChild'};
  return `<span class="room-symbol room-symbol-${room} ${className}">${icon(shapes[room])}</span>`;
}
/** 完整列出当前房间已有设备，列表纵向滚动，不再提供更多设备跳转。 */
function roomCard(room) {
  const [temp,humidity]=roomClimate[room],lights=ROOM_LIGHTS[room];
  // 每种设备单独起行，组内最后一张落单时占满两列。
  const groups=[
    lights.map(id=>roomDeviceControl('light',id,LIGHT_NAMES[id],state.lights[id].on?'已开启':'已关闭',state.lights[id].on)),
    room==='living'?[roomClimateControl('ac','living','客厅空调'),roomClimateControl('ac','dining','餐厅空调')]:[roomClimateControl('ac',room,`${ROOMS[room]}空调`)],
    [roomClimateControl('floor',room,`${room==='living'?'客厅':ROOMS[room]}地暖`)],
    room==='living'?[roomDeviceControl('fresh','fresh','全屋新风',state.fresh.on?`${state.fresh.mode} · ${state.fresh.speed}档`:'已关闭',state.fresh.on)]:[]
  ];
  const cards=groups.map(group=>group.map((card,index)=>group.length%2===1&&index===group.length-1?card.replace('class="room-tile ','class="room-tile room-tile-wide '):card).join('')).join('');
  return `<article class="room-slide" data-room-slide="${room}" aria-label="${ROOMS[room]}信息"><header class="room-card-heading">${roomSymbol(room)}<div><h2>${ROOMS[room]}</h2><p>${temp}° · 湿度 ${humidity}%</p></div></header><div class="room-grid">${cards}</div></article>`;
}
/** 同步当前房间的无障碍状态，不重绘正在滚动的卡片内容。 */
function updateRoomSelection(refreshRooms=null) {
  const panel=document.querySelector('#room-panel');lastPanelRoom=ui.panel||lastPanelRoom;
  const carousel=panel.querySelector('.room-carousel');
  const activeIndex=roomScrollTarget??Math.round(carousel.scrollLeft/carousel.clientWidth);
  // 顶部标题与当前显示的房间保持一致，客厅和餐厅共用“客餐厅”信息卡片。
  const activeRoom=carousel.children[activeIndex]?.dataset.roomSlide;
  panel.querySelector('.room-panel-top span').textContent=ROOMS[activeRoom]||ROOMS[ui.panel];
  panel.querySelectorAll('[data-room-slide]').forEach((slide,index)=>{
    const active=index===activeIndex;
    if(slide.getAttribute('aria-hidden')===String(!active)&&!refreshRooms?.has(slide.dataset.roomSlide))return;
    // 原生手势开始后不能把起始卡片设为 inert，否则浏览器可能中断手势结束事件。
    if(!active&&slide.contains(document.activeElement))document.activeElement.blur();
    slide.setAttribute('aria-hidden',String(!active));
    slide.querySelectorAll('button,input').forEach(control=>{control.tabIndex=active?0:-1;});
  });
}
/** 将滚出中央组的副本无动画归位；新手势开始时保留尚未吸附完成的偏移量。 */
function normalizeRoomLoop(carousel,force=false) {
  if(!carousel?.isConnected||!ui.panel||!carousel.clientWidth)return;
  const rooms=Object.keys(ROOMS),count=rooms.length,width=carousel.clientWidth;
  const index=Math.round(carousel.scrollLeft/width);
  if(!force&&(Math.abs(carousel.scrollLeft-index*width)>2||roomScrollTarget!==null&&Math.abs(carousel.scrollLeft-roomScrollTarget*width)>2))return;
  const shift=index<count?count:index>=count*2?-count:0;
  if(shift) {
    carousel.children[index+shift].scrollTo({top:carousel.children[index].scrollTop,behavior:'instant'});
    carousel.scrollTo({left:carousel.scrollLeft+shift*width,behavior:'instant'});
  }
  roomScrollTarget=null;ui.panel=rooms[index%count];updateRoomSelection();
}
/** 平滑选择相邻房间，跨过首尾时使用缓冲组，避免反向穿过整排。 */
function selectPanelRoom(room,direction=0) {
  if(!ROOMS[room])return;
  noteRoomPanelActivity();
  if(!ui.panel){ui.panel=room;renderHome();return;}
  const carousel=document.querySelector('.room-carousel'),rooms=Object.keys(ROOMS),previous=ui.panel;
  clearTimeout(roomSettleTimer);normalizeRoomLoop(carousel,true);
  let index=rooms.length+rooms.indexOf(room);
  if(direction>0&&previous===rooms.at(-1)&&room===rooms[0])index=rooms.length*2;
  if(direction<0&&previous===rooms[0]&&room===rooms.at(-1))index=rooms.length-1;
  ui.panel=room;roomScrollTarget=index;updateRoomSelection();
  carousel.scrollTo({left:index*carousel.clientWidth,behavior:settings.preferences.motion&&!matchMedia('(prefers-reduced-motion: reduce)').matches?'smooth':'instant'});
  roomSettleTimer=setTimeout(()=>normalizeRoomLoop(carousel),180);
}
/** 只同步变化的属性和文本，保留设备按钮、焦点和现有卡片节点。 */
function patchViewNode(current,next) {
  if(current.isEqualNode(next))return;
  if(current.nodeType!==next.nodeType||current.nodeName!==next.nodeName){current.replaceWith(next.cloneNode(true));return;}
  if(current.nodeType!==Node.ELEMENT_NODE){if(current.nodeValue!==next.nodeValue)current.nodeValue=next.nodeValue;return;}
  for(const attribute of [...current.attributes])if(attribute.name!=='tabindex'&&!next.hasAttribute(attribute.name))current.removeAttribute(attribute.name);
  for(const attribute of next.attributes)if(current.getAttribute(attribute.name)!==attribute.value)current.setAttribute(attribute.name,attribute.value);
  for(let index=0;index<next.childNodes.length;index++){
    if(current.childNodes[index])patchViewNode(current.childNodes[index],next.childNodes[index]);
    else current.append(next.childNodes[index].cloneNode(true));
  }
  while(current.childNodes.length>next.childNodes.length)current.lastChild.remove();
}
/** 渲染五个可横向滑动的房间，设备变化只更新对应房间，保留整排轮播和滚动位置。 */
function renderRoomPanel(align=false) {
  const panel=document.querySelector('#room-panel'),scrolls=new Map();
  const rooms=Object.keys(ROOMS),cards=rooms.map(roomCard),markup=cards.join('');
  const existing=panel.querySelector('.room-carousel');
  // 灯光开关或 HA 状态更新仅修改对应房间的内容，不在展开首帧重建整排卡片。
  if(existing){
    const changed=new Set();
    if(roomPanelMarkup!==markup)rooms.forEach((room,index)=>{
      if(roomPanelCards.get(room)===cards[index])return;
      const template=document.createElement('template');template.innerHTML=cards[index];
      const next=template.content.firstElementChild;
      for(const slide of existing.querySelectorAll(`[data-room-slide="${room}"]`)){
        patchViewNode(slide.querySelector('.room-card-heading'),next.querySelector('.room-card-heading'));
        patchViewNode(slide.querySelector('.room-grid'),next.querySelector('.room-grid'));
      }
      changed.add(room);roomPanelCards.set(room,cards[index]);
    });
    roomPanelMarkup=markup;
    if(align){
      clearTimeout(roomSettleTimer);roomScrollTarget=null;
      existing.scrollTo({left:(rooms.length+rooms.indexOf(ui.panel))*existing.clientWidth,behavior:'instant'});
    }
    updateRoomSelection(changed);return;
  }
  // 只从真实卡片保存纵向位置，避免首尾副本覆盖房间的滚动记录。
  panel.querySelectorAll('[data-room-slide]:not([data-loop-copy])').forEach(slide=>scrolls.set(slide.dataset.roomSlide,slide.scrollTop));
  const loopRooms=[...rooms,...rooms,...rooms];
  clearTimeout(roomSettleTimer);roomScrollTarget=null;
  panel.innerHTML=`<div class="room-panel-top"><span>${ROOMS[ui.panel]}</span><button class="circle-button close-button" data-action="close-room" aria-label="关闭房间控制">${icon('close')}</button></div><div class="room-carousel" role="region" aria-roledescription="轮播" aria-label="房间信息卡片">${loopRooms.map((room,index)=>cards[index%rooms.length].replace('class="room-slide"',`class="room-slide"${index<rooms.length||index>=rooms.length*2?' data-loop-copy="true"':''}`)).join('')}</div>`;
  roomPanelMarkup=markup;
  rooms.forEach((room,index)=>roomPanelCards.set(room,cards[index]));
  const carousel=panel.querySelector('.room-carousel');
  carousel.scrollTo({left:(rooms.length+rooms.indexOf(ui.panel))*carousel.clientWidth,behavior:'instant'});
  panel.querySelectorAll('[data-room-slide]').forEach(slide=>{slide.scrollTo({top:scrolls.get(slide.dataset.roomSlide)||0,behavior:'instant'});});
  updateRoomSelection();
  // 纵向查看设备时也同步过渡副本，首尾衔接不重置当前阅读位置。
  for(const slide of carousel.children)slide.addEventListener('scroll',()=>{
    if(!carousel.isConnected||slide!==carousel.children[Math.round(carousel.scrollLeft/carousel.clientWidth)])return;
    // 仅当前可见卡片驱动副本，瞬时同步避免两个平滑滚动事件互相拉扯。
    for(const copy of carousel.children)if(copy!==slide&&copy.dataset.roomSlide===slide.dataset.roomSlide&&copy.scrollTop!==slide.scrollTop)copy.scrollTo({top:slide.scrollTop,behavior:'instant'});
  },{passive:true});
  let touching=false;
  /** 在新手势开始前回正缓冲组，不等待上一次惯性动画的定时器。 */
  const begin=()=>{clearTimeout(roomSettleTimer);normalizeRoomLoop(carousel,true);roomScrollTarget=null;};
  carousel.addEventListener('pointerdown',begin,{passive:true});
  // 原生横向滑动会主动触发 pointercancel，实际触摸结束必须以 touchend 为准。
  carousel.addEventListener('touchstart',()=>{touching=true;begin();},{passive:true});
  /** 等待吸附完成后归位，手指未离开时禁止改变轮播物理位置。 */
  const settle=()=>{
    clearTimeout(roomSettleTimer);
    roomSettleTimer=setTimeout(()=>{if(!touching)normalizeRoomLoop(carousel);},180);
  };
  /** 手指离开后继续等待原生惯性完成，鼠标滚轮通过 scrollend 同步。 */
  const release=()=>{touching=false;settle();};
  carousel.addEventListener('touchend',release,{passive:true});
  carousel.addEventListener('touchcancel',release,{passive:true});
  carousel.addEventListener('scrollend',()=>{if(!touching)normalizeRoomLoop(carousel);},{passive:true});
  carousel.addEventListener('scroll',()=>{
    if(!carousel.isConnected||!ui.panel||!carousel.clientWidth)return;
    settle();
    if(roomScrollTarget!==null&&Math.abs(carousel.scrollLeft-roomScrollTarget*carousel.clientWidth)>2)return;
    roomScrollTarget=null;
    const index=Math.round(carousel.scrollLeft/carousel.clientWidth),room=loopRooms[index];
    if(room) {
      ui.panel=room;
      // 让同房间的首尾副本共享纵向位置，边界切换保持同一画面。
      for(const slide of carousel.children)if(slide.dataset.roomSlide===room&&slide!==carousel.children[index])slide.scrollTo({top:carousel.children[index].scrollTop,behavior:'instant'});
      updateRoomSelection();
    }
  },{passive:true});
}
/** 生成家电卡片共用的插图和文字容器。 */
function applianceCard(id,name,location,content) {
  const model=APPLIANCE_DEFINITIONS[id].model;
  return `<section class="appliance-card" data-appliance="${id}"><div class="appliance-visual"><img src="./assets/${id}.png" alt="${model} 官方产品图" draggable="false"></div><div class="appliance-copy"><h2>${name}</h2><p class="product-model">${model}</p><p class="location">${location}</p>${content}<button type="button" class="appliance-details-link" data-action="appliance-detail" data-id="${id}" aria-label="查看${name}详情">查看详情${icon('arrow')}</button></div></section>`;
}
/** 渲染四种用户指定的家电，不展示未要求的其他设备。 */
function renderAppliances() {
  const {washer,fridge,purifier,drinker}=state.appliances;
  const cards=[
    ['washer','laundry',applianceCard('washer','洗衣机','生活阳台',`<p class="appliance-state ${washer.paused?'off':''}">${washer.paused?'已暂停':'洗涤中'}</p><p class="appliance-detail">剩余 ${washer.remaining} 分钟</p><div class="cycle-ring" style="--progress:${washer.progress}"><b>${washer.progress}%</b></div><div class="cycle-steps"><span class="active">洗涤</span><span>漂洗</span><span>脱水</span></div><button class="action-pill" data-action="washer">${icon(washer.paused?'play':'pause')}${washer.paused?'继续':'暂停'}</button>`) ],
    ['fridge','kitchen',applianceCard('fridge','冰箱','厨房',`<p class="appliance-state green">${fridge.eco?'节能运行':'运行中'}</p><div class="fridge-values"><div>冷藏<strong>${fridge.cool}°</strong></div><div>冷冻<strong>${fridge.freeze}°</strong></div></div><button class="action-pill" data-action="appliance-detail" data-id="fridge">温度设置${icon('arrow')}</button>`) ],
    ['purifier','kitchen',applianceCard('purifier','净水器','厨房',`${toggle('appliances','purifier',purifier.on,'净水器','appliance-power')}<p class="appliance-state ${purifier.on?'green':'off'}">${purifier.on?'水质良好':'已关闭'}</p><p class="appliance-detail">纯水 TDS ${purifier.tds}</p><p class="appliance-detail">滤芯剩余 ${purifier.filter}%</p><div class="filter-track"><span></span></div><button class="action-pill" data-action="appliance-detail" data-id="purifier">查看滤芯${icon('arrow')}</button>`) ],
    ['drinker','kitchen',applianceCard('drinker','管线机','厨房',`${toggle('appliances','drinker',drinker.on,'管线机','appliance-power')}<p class="appliance-state ${drinker.on?'gold':'off'}">${drinker.on?'待机':'已关闭'}</p><span class="temperature-label">设定水温</span><div class="appliance-temperature">${stepButton('appliances','drinker',-5,'降低管线机水温')}<output>${valueFor('appliances','drinker')}°</output>${stepButton('appliances','drinker',5,'提高管线机水温')}</div><button class="action-pill" data-action="dispense" ${drinker.on?'':'disabled'}>${icon('drop')}出水 ${drinker.volume} ml</button>`) ],
  ];
  const host=document.querySelector('#appliance-page');
  let grid=host.querySelector('.appliance-grid');
  if(!grid){grid=document.createElement('div');grid.className='appliance-grid';host.append(grid);}
  const visible=cards.filter(([,category])=>ui.filter==='all'||ui.filter===category);
  // 保留未变化的卡片、图片与焦点，仅替换本次真正改变的设备。
  for(const child of [...grid.children])if(!visible.some(([id])=>id===child.dataset.appliance))child.remove();
  for(const [index,[id,,html]] of visible.entries()){
    const previous=grid.querySelector(`[data-appliance="${id}"]`);
    if(previous?._markup===html){if(grid.children[index]!==previous)grid.insertBefore(previous,grid.children[index]||null);continue;}
    const template=document.createElement('template');template.innerHTML=html;
    const card=template.content.firstElementChild;card._markup=html;
    if(previous){patchViewNode(previous,card);previous._markup=html;}
    else grid.insertBefore(card,grid.children[index]||null);
  }
}
/** 将页面状态同步给同源独立模型，不使用 HA 接口。 */
function syncModel(lights=true) {
  if(settings.preferences.houseMode!=='3d'||!modelReady)return;
  const {view,rotation,zoom,markers}=settings.preferences;
  const messages=[{action:'devices',ac:state.ac,floor:state.floor,fresh:state.fresh,kind:ui.markerKind},{action:'settings',view,rotation,zoom,markers,resolvedTheme:settings.theme}];
  if(lights)messages.unshift({action:'lights',lights:state.lights});
  // 独立记录每类状态，避免无变化的设置触发材质遍历和 WebGL 重绘。
  for(const message of messages){
    const signature=JSON.stringify(message);
    if(modelSignatures.get(message.action)===signature)continue;
    frame.contentWindow.postMessage({channel:'ha-evening-screen',...message},location.origin);
    modelSignatures.set(message.action,signature);
  }
}
/** 持久化模拟状态并同步设备标注，按需更新模型灯效。 */
function commit({lights=false,homeOnly=false}={}) {
  saveState(state);
  syncModel(lights);
  if(homeOnly&&ui.page==='home'){renderHome();climateDialog.refresh();applianceDialog.refresh();}
  else render();
}
/** 更新当前页面内容并保持三维 iframe 实例不被重建。 */
function render() {
  // 准备轻量内容后才创建动画，避免动画已经计时却仍在同步创建页面。
  renderShell({transition:false});
  // 准备内容前恢复目标页尺寸；首帧仍由下方暂停的位移动画控制，不会提前闪现。
  document.querySelector({home:'#home-page',overview:'#overview-page',appliances:'#appliance-page'}[ui.page]).hidden=false;
  if(ui.page==='home')renderHome();
  else if(ui.page==='appliances')renderAppliances();
  if(ui.page==='overview')overview??=createHomeOverview();
  else overview?.setVisible(false);
  const settled=transitionPages(),id=pageTransitionId;
  settled.then(()=>{if(id===pageTransitionId&&ui.page==='overview')overview.setVisible(true);});
  climateDialog.refresh();applianceDialog.refresh();
}
/** 显示短暂操作结果，减少常驻说明对三维模型的遮挡。 */
function toast(message) {
  const host=document.querySelector('#toast');host.textContent=message;host.hidden=false;
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>{host.hidden=true;},2200);
}
/** 将单路或整房间开关动作映射为独立的模拟状态修改。 */
function toggleState(kind,id,{homeOnly=false}={}) {
  if(['ac','floor'].includes(kind))roomClimateSimulated.add(`${kind}:${id}`);
  if(kind==='lights') { const ids=ROOM_LIGHTS[id],on=ids.some(key=>state.lights[key].on);ids.forEach(key=>{state.lights[key].on=!on;}); }
  else if(kind==='light') state.lights[id].on=!state.lights[id].on;
  else if(kind==='fresh') state.fresh.on=!state.fresh.on;
  else state[kind][id].on=!state[kind][id].on;
  if(homeOnly&&kind==='light')refreshRoomLight(id);
  commit({lights:kind==='lights'||kind==='light',homeOnly});
}
/** 图上单灯开关只同步该灯的三个轮播副本，不解析或遍历完整房间卡片。 */
function refreshRoomLight(id) {
  const on=state.lights[id].on,label=LIGHT_NAMES[id],status=on?'已开启':'已关闭';
  for(const button of document.querySelectorAll(`#room-panel [data-kind="light"][data-id="${id}"]`)){
    button.setAttribute('aria-checked',String(on));
    const tile=button.closest('.room-tile');tile.classList.toggle('is-on',on);
    tile.querySelector('.room-tile-face small').textContent=status;
  }
  const room=Object.entries(ROOM_LIGHTS).find(([,ids])=>ids.includes(id))?.[0],cached=roomPanelCards.get(room);
  if(cached){
    const oldTile=roomDeviceControl('light',id,label,on?'已关闭':'已开启',!on);
    roomPanelCards.set(room,cached.replace(oldTile,roomDeviceControl('light',id,label,status,on)));
    roomPanelMarkup=Object.keys(ROOMS).map(key=>roomPanelCards.get(key)||'').join('');
  }
}
/** 处理页面导航和用户动作；不发送网络控制请求。 */
function onClick(event) {
  const target=event.target.closest('button[data-action]');if(!target||target.disabled)return;
  const {action,kind,id,room,field='temperature'}=target.dataset;
  try {
    if(action==='nav-toggle')setNavigation(!ui.navOpen);
    else if(action==='page') { ui.page=target.dataset.page;ui.modal=null;render(); }
    else if(action==='settings'){renderShell();settings.open();}
    else if(action==='scene') {
      cancelTemperatureEdits();
      for(const kind of ['ac','floor'])if(['home','leave','sleep',kind==='ac'?'ac-off':'floor-off'].includes(target.dataset.scene))for(const id of Object.keys(state[kind]))roomClimateSimulated.add(`${kind}:${id}`);
      applyScene(state,target.dataset.scene);commit({lights:true});
      const label=SCENES.find(item=>item.id===target.dataset.scene).name;
      showSceneFeedback(document.querySelector(`[data-scene="${target.dataset.scene}"]`));
      toast(`${label} · 已模拟执行`);
    } else if(action==='climate-open') climateDialog.open({kind,id,label:target.dataset.label},target);
    else if(action==='toggle') toggleState(kind,id);
    else if(action==='open-environment') {ui.page='home';selectPanelRoom('living');render();}
    else if(action==='kind') {ui.kind=kind;ui.device=ui.room;render();}
    else if(action==='room') {ui.room=room;ui.device=room;render();}
    else if(action==='select-device') {ui.device=id;ui.room=room;render();}
    else if(action==='close-room') {lastPanelRoom=ui.panel||lastPanelRoom;ui.panel=null;roomScrollTarget=null;renderHome();document.querySelector('#room-panel-open').focus();}
    else if(action==='open-room-panel')selectPanelRoom(lastPanelRoom);
    else if(action==='model-retry')retryModel();
    else if(action==='view') frame.contentWindow.postMessage({channel:'ha-evening-screen',action:target.dataset.view},location.origin);
    else if(action==='marker-kind') {ui.markerKind=kind;renderHome();syncModel(false);}
    else if(action==='toggle-room-lights') toggleState('lights',room);
    else if(action==='step') {
      editTemperature(kind,id,Number(target.dataset.delta),field);
    } else if(action==='mode') { const modes=['制冷','制热','送风'];state.ac[id].mode=modes[(modes.indexOf(state.ac[id].mode)+1)%modes.length];commit(); }
    else if(action==='fan') { const fans=['自动','低速','中速','高速'];state.ac[id].fan=fans[(fans.indexOf(state.ac[id].fan)+1)%fans.length];commit(); }
    else if(action==='fresh-mode') {state.fresh.mode=state.fresh.mode==='自动'?'手动':'自动';commit();}
    else if(action==='speed') {state.fresh.speed=Number(target.dataset.speed);state.fresh.mode='手动';commit();}
    else if(action==='filter') {ui.filter=target.dataset.filter;renderAppliances();renderShell();}
    else if(action==='washer') {state.appliances.washer.paused=!state.appliances.washer.paused;commit();}
    else if(action==='appliance-detail') applianceDialog.open(id,target);
    else if(action==='close-detail') applianceDialog.close();
    else if(action==='fridge-eco') {state.appliances.fridge.eco=!state.appliances.fridge.eco;commit();}
    else if(action==='dispense') toast(`已模拟出水 ${state.appliances.drinker.volume} ml`);
  } catch(error) { console.error('Demo control action failed',error);toast('操作未完成，请重试'); }
}
/** 拖动亮度时只预览文本；结束滑动后统一更新状态和模型。 */
function onRange(event) {
  const target=event.target;if(!target.matches('input[type=range]'))return;
  target.nextElementSibling.textContent=`${target.value}%`;
  if(event.type!=='change')return;
  const ids=target.dataset.action==='brightness-room'?ROOM_LIGHTS[target.dataset.room]:[target.dataset.id];
  ids.forEach(id=>{state.lights[id].brightness=Number(target.value);});commit({lights:true});
}
/** 模型失败时保留页面和设备控制，仅显示手动恢复入口。 */
function showModelFailure(reason) {
  modelReady=false;const host=document.querySelector('#model-loading');host.hidden=false;host.classList.add('failed');
  host.innerHTML=`<div>${reason==='context-lost'?'3D 显示暂时中断':'模型加载失败'}</div><button type="button" class="view-button" data-action="model-retry">重新加载模型</button>`;
}
/** 仅由用户点击重新加载模型，避免整页自动重试形成刷新循环。 */
function retryModel() {
  modelSignatures.clear();
  modelReady=false;const host=document.querySelector('#model-loading');host.hidden=false;host.classList.remove('failed');host.innerHTML='<span></span>正在加载房屋模型';
  const url=new URL('./model-host.html',location.href);url.searchParams.set('retry',String(Date.now()));frame.src=url.href;
}
/** 记录真实操作；鼠标静止悬停、天气更新和后台渲染不延长房间卡片展示。 */
function noteRoomPanelActivity(event) {
  if(event?.type==='pointermove'&&!event.buttons)return;
  roomPanelLastActivity=Date.now();
}
/** 根据设备归属决定是否展开房间，客餐厅共用两路空调和全屋新风。 */
function operateModelDevice(kind,id) {
  const room=kind==='light'?Object.entries(ROOM_LIGHTS).find(([,ids])=>ids.includes(id))?.[0]:kind==='fresh'||id==='dining'?'living':id;
  const action=deviceOpensRoomInfo(settings.preferences,{page:ui.page,roomValid:!!ROOMS[room],panelOpen:!!ui.panel,sameRoom:ui.panel===room});
  // 先确定展开目标，再一次性更新灯态与房间内容，避免先渲染旧房间再展开新房间。
  if(action.track)noteRoomPanelActivity();
  if(action.open){ui.panel=room;roomScrollTarget=null;}
  toggleState(kind,id,{homeOnly:true});
  if(action.switchRoom)selectPanelRoom(room);
}
/** 空闲达到设置时长才收起房间信息，正在设置或查看弹窗时暂停计时。 */
function hideIdleRoomPanel() {
  if(!ui.panel||ui.page!=='home')return;
  const layers=['settings-layer','climate-layer','weather-layer','calendar-layer','appliance-layer','pad-layer','standby'];
  if(document.hidden||layers.some(id=>!document.getElementById(id).hidden)){roomPanelLastActivity=Date.now();return;}
  const seconds=settings.preferences.roomPanelSeconds;
  if(!seconds||Date.now()-roomPanelLastActivity<seconds*1000)return;
  const restoreFocus=document.querySelector('#room-panel').contains(document.activeElement);
  lastPanelRoom=ui.panel;ui.panel=null;roomScrollTarget=null;renderHome();
  if(restoreFocus)document.querySelector('#room-panel-open').focus({preventScroll:true});
}
/** 仅接受当前同源模型 iframe 发送的状态或房间选择事件。 */
function onModelMessage(event) {
  if(event.origin!==location.origin||event.source!==frame.contentWindow||event.data?.channel!=='ha-evening-model')return;
  if(settings.preferences.houseMode!=='3d')return;
  const data=event.data;
  if(data.type==='ready') {modelReady=true;noteRoomPanelActivity();const host=document.querySelector('#model-loading');host.hidden=true;host.classList.remove('failed');syncModel();}
  else if(data.type==='activity'){noteRoomPanelActivity();if(ui.navOpen&&['pointerdown','pointerup','keydown'].includes(data.interaction))resetNavigationIdle();}
  else if(data.type==='room'&&ROOMS[data.room])selectPanelRoom(data.room);
  else if(data.type==='toggle-light'&&state.lights[data.id]) operateModelDevice('light',data.id);
  else if(data.type==='toggle-device'&&['ac','floor','fresh'].includes(data.kind)) {
    const id=data.id;
    if(data.kind==='fresh'?id!=='fresh':!state[data.kind][id])return;
    operateModelDevice(data.kind,id);
  }
  else if(data.type==='light-toggle'&&state.lights[data.id]&&state.lights[data.id].on!==!!data.on) operateModelDevice('light',data.id);
  else if(data.type==='error')showModelFailure(data.reason);
}
// 设备操作仅影响本地模拟状态；天气模块独立只读订阅现有 HA 数据。
document.addEventListener('click',onClick);
// 上滑进入下一页，下滑返回上一页；设置是弹窗入口，不参与页签轮换。
bindSidebarSwipe(document.querySelector('#navigation'),{onActivity:resetNavigationIdle,onStep:step=>{
  const pages=['home','overview','appliances'],next=pages[pages.indexOf(ui.page)+step];
  if(next){ui.page=next;ui.modal=null;render();}
}});
// 页面内点击只重置三十秒计时，不因切页、点击空白或设备操作收回侧栏。
document.addEventListener('click',resetNavigationIdle,{capture:true});
window.addEventListener('pagehide',()=>clearTimeout(navIdleTimer));
window.addEventListener('pageshow',resetNavigationIdle);
document.addEventListener('input',onRange);
document.addEventListener('change',onRange);
document.addEventListener('keydown',event=>{if(event.key==='Escape'){ui.panel=null;ui.modal=null;render();}});
window.addEventListener('message',onModelMessage);
// 房间卡片独立空闲计时，不与屏保或导航栏计时混用。
for(const type of ['pointerdown','pointerup','pointermove','click','keydown','wheel','touchstart','touchmove','input','change'])document.addEventListener(type,noteRoomPanelActivity,{capture:true,passive:true});
const roomPanelOverlayObserver=new MutationObserver(()=>noteRoomPanelActivity());
for(const id of ['settings-layer','climate-layer','weather-layer','calendar-layer','appliance-layer','pad-layer','standby'])roomPanelOverlayObserver.observe(document.getElementById(id),{attributes:true,attributeFilter:['hidden']});
createVisiblePoll(hideIdleRoomPanel,250).start();


/** 主动确认缓存模型就绪状态，避免刷新时错过先到达的 ready 消息。 */
function requestModelReady() {frame.contentWindow.postMessage({channel:'ha-evening-screen',action:'ready-request'},location.origin);}
frame.addEventListener('load',requestModelReady);
requestModelReady();
window.addEventListener('resize',resizeScreen);
if(window.visualViewport) visualViewport.addEventListener('resize',resizeScreen);
try {
  if(window.parent&&window.parent!==window) {
    window.parent.addEventListener('resize',resizeScreen);
    if(window.parent.visualViewport) window.parent.visualViewport.addEventListener('resize',resizeScreen);
  }
} catch(error) {console.warn('Evening screen parent resize is unavailable');}
roomClimateSource.start();

weather.start();
pad.start();
// 先取得状态与最终偏好，再一次性创建首屏，避免初始化反复布局房间轮播。
resizeScreen();updateClock();renderShell();settings.apply();initializing=false;
createVisiblePoll(updateClock,15000).start();
// 留下只读快照以供浏览器核验模拟动作，不提供任何真实控制能力。
window.eveningDemo={snapshot:()=>structuredClone(state),view:()=>({...ui,drafts:{...ui.drafts}})};
