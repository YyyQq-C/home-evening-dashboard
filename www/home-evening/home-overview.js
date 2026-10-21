import {SITE,entityId} from './site-config.js';
import {createVisiblePoll} from './runtime.js';
import {icon} from './icons.js';
import {createCameraPlayer} from './camera-player.js';

const STATUS=[[entityId('binary_sensor.example_istoreos_wan_connectivity'),'外网连接','connectivity'],[entityId('sensor.example_tp_link_ap_clients'),'无线设备','count'],[entityId('binary_sensor.example_home_network_issue'),'网络提醒','alert'],[entityId('binary_sensor.example_tp_link_device_issue'),'无线设备提醒','alert'],[entityId('binary_sensor.example_truenas_health_issue'),'存储提醒','alert']];
const CARDS=[['replay','sd-replay-card','./optional/sd-replay-card.js',{serial:SITE.camera.serial}],['electricity','smart-utilities-card-ele','./optional/smart-utilities-card-ele.js',{default_show_calendar:true,entities:[{entity_id:entityId('sensor.example_electricity'),name:'家庭用电'}]}]];
// 只注入本页电网卡片的嵌套样式，不改共享组件和原仪表盘。
const ELECTRICITY_STYLE=`
  :host{font-size:20px;line-height:1.4}
  /* 缩放画布内避免毛玻璃合成和模拟粗体让电量文字边缘发虚。 */
  :host,*{text-shadow:none!important}
  .hero-section,.usage-section-small,.action-button{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
  .hero-title,.usage-title,.ladder-header{opacity:1!important;font-weight:500!important;color:var(--secondary-text-color)!important;font-synthesis:none}
  .hero-elec-value,.hero-cost-value,.usage-amount,.usage-amount span,.ladder-header span{font-family:inherit!important;font-weight:500!important;font-synthesis:none}
  /* 压缩概览留白，为完整日历或曲线保留首屏高度，不缩放文字层。 */
  .top-content{box-sizing:border-box!important;padding:4px 12px!important}
  .balance-time{font-size:16px!important;line-height:1.25}
  .balance-info,.days-info{height:84px!important}
  .balance-amount{font-size:44px!important;line-height:1.2;margin:0!important}
  .balance-amount .currency{font-size:22px!important}
  .balance-label,.days-label{font-size:20px!important;line-height:1.4;margin-top:0!important}
  .action-button{font-size:20px!important;height:48px!important;line-height:46px!important}
  .hero-title,.usage-title,.usage-section-small .usage-title{font-size:20px!important;line-height:1.4}
  .hero-elec-value{font-size:30px!important}.hero-cost-value{font-size:24px!important}
  .hero-elec-value span,.hero-cost-value span{font-size:18px!important}
  .hero-comparison,.price-item,.price-item-block,.progress-label{font-size:18px!important;line-height:1.4}
  .usage-amount,.usage-section-small .usage-amount span{font-size:24px!important;line-height:1.4}
  .hero-section{min-height:96px!important;padding:8px 14px!important}
  .hero-title{margin-bottom:4px!important}
  .hero-sparkline{height:44px!important}
  .usage-section-small{min-height:72px!important;max-height:none!important;padding:4px 12px!important}
  .usage-section-small .usage-title{margin-bottom:0!important;line-height:1.2!important}
  .usage-section-small .usage-amount{margin-top:2px!important}
  .right-section{padding-bottom:8px!important}
  .ladder-section{min-height:0!important;padding:4px 8px!important}
  .ladder-header,.ladder-header span{font-size:20px!important;line-height:1.4}
  .price-title,.price-range,.price-block{font-size:20px!important;line-height:1.4}
  .price-value{font-size:30px!important}.number{font-size:32px!important}.unit{font-size:18px!important}
  .calendar-selector{grid-template-rows:44px!important}
  .calendar-body{grid-template-rows:32px repeat(6,48px)!important;gap:3px!important;touch-action:pan-y;user-select:none}
  .celltotal,.celltotal:not(.nav-button):not(.today-button){font-size:20px!important;padding:2px!important}
  .celltotal.nav-button,.celltotal.today-button{font-size:18px!important;height:36px!important;min-height:36px!important}
  .nav-arrow{font-size:16px!important}.weekday{font-size:18px!important}
  .cell{height:48px!important;min-height:48px!important;gap:1px!important}
  .month-day>div:first-child,.month-day .day-number{font-size:20px!important;line-height:1.1!important}
  .electricity-num,.electricity-cost{font-size:15px!important;line-height:1.1!important;min-height:16px!important}
  ha-card,.panel-section,day-chart-view,month-chart-view{display:block!important;width:100%!important;box-sizing:border-box!important}
  :host(day-chart-view),:host(month-chart-view){display:block!important;width:100%!important;box-sizing:border-box!important}
  .card-chart{display:block!important;position:relative!important;top:auto!important;left:auto!important;right:auto!important;width:100%!important;height:auto!important;min-height:300px!important;padding:12px 10px 8px!important;box-sizing:border-box!important;overflow:hidden!important}
  :host(day-chart-view) #chart-container,:host(month-chart-view) #chart-container{width:100%!important;height:280px!important;min-height:280px!important;box-sizing:border-box!important}
  .apexcharts-canvas,.apexcharts-svg{max-width:100%!important}
  .apexcharts-legend-text{font-size:16px!important}
  .apexcharts-xaxis-label,.apexcharts-yaxis-label{font-size:14px!important}
`;
const ELECTRICITY_TAGS=['smart-utilities-card-ele','main-info-panel','day-chart-view','month-chart-view','calendar-view','usage-summary','ladder-pricing','power-progress'];
const REPLAY_STYLE=`
  .list{max-height:168px!important}
  .player{position:relative}
  .player video{max-height:220px!important}
  .evening-replay-close{position:absolute;z-index:2;top:8px;right:24px;padding:6px 14px;border-radius:999px;background:#101a21e6;color:#fff;border:1px solid #ffffff55;font-size:16px;line-height:1.4}
`;

/** 相同曲线数据与配色保留现有图表，避免宿主轮询重复创建 SVG 和播放动画。 */
export function stabilizeElectricityCharts(manager) {
  if(!manager||manager.__eveningStableCharts)return;
  manager.__eveningStableCharts=true;
  for(const method of ['renderDayChart','renderMonthChart']){
    const original=manager[method];
    if(typeof original!=='function')continue;
    let previousContainer,previousSignature;
    manager[method]=function renderChangedChart(container,data){
      const signature=JSON.stringify([data,this._theme,this._colorNum,this._colorCost]);
      const pending=method==='renderDayChart'?this._dayChartRenderTimeout:this._monthChartRenderTimeout;
      if(container===previousContainer&&signature===previousSignature&&(this._chart||pending))return;
      try{
        const result=original.call(this,container,data);
        previousContainer=container;previousSignature=signature;
        return result;
      }catch(error){
        previousSignature=undefined;
        console.error('Evening electricity chart update failed',error);
        throw error;
      }
    };
  }
}

/** 为本页用电日历增加横向滑动翻月，纵向手势仍交由浏览器滚动页面。 */
export function attachElectricityCalendarSwipe(element) {
  const root=element?.shadowRoot;
  if(!root||element.__eveningCalendarSwipe)return;
  element.__eveningCalendarSwipe=true;
  let gesture=null;
  root.addEventListener('pointerdown',event=>{
    if(event.isPrimary===false||event.button!==0||!event.target.closest?.('.calendar-body'))return;
    gesture={id:event.pointerId,x:event.clientX,y:event.clientY,horizontal:false};
  });
  root.addEventListener('pointermove',event=>{
    if(!gesture||event.pointerId!==gesture.id)return;
    const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;
    if(!gesture.horizontal&&Math.max(Math.abs(dx),Math.abs(dy))>12){
      if(Math.abs(dy)>=Math.abs(dx)){gesture=null;return;}
      gesture.horizontal=true;
    }
    if(gesture.horizontal&&event.cancelable)event.preventDefault();
  },{passive:false});
  root.addEventListener('pointerup',event=>{
    if(!gesture||event.pointerId!==gesture.id)return;
    const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;
    gesture=null;
    if(Math.abs(dx)<45||Math.abs(dx)<Math.abs(dy)*1.5)return;
    // 沿用原卡片的月份导航事件，保持跨年处理和电量数据加载一致。
    element.dispatchEvent(new CustomEvent(dx<0?'next-month':'prev-month',{bubbles:true,composed:true}));
  });
  root.addEventListener('pointercancel',()=>{gesture=null;});
}

/** 收起 SD 录像播放窗口并停止当前回放，列表仍可再次点选。 */
export function collapseSdReplay(root) {
  const player=root?.querySelector?.('.player');
  const video=root?.querySelector?.('video');
  try {
    video?.pause?.();
    video?.removeAttribute?.('src');
    video?.load?.();
  }catch(error){
    console.warn('SD replay collapse failed to stop media',error);
  }
  if(player)player.hidden=true;
  root?.querySelectorAll?.('.clip')?.forEach(item=>item.setAttribute('aria-pressed','false'));
}

/** 在录像播放器上补上收起按钮，不改共享回放组件本身。 */
export function attachSdReplayClose(element) {
  const root=element?.shadowRoot;
  const player=root?.querySelector?.('.player');
  if(!player||player.querySelector('[data-evening-replay-close]'))return;
  if(typeof document==='undefined')return;
  const button=document.createElement('button');
  button.type='button';
  button.className='evening-replay-close';
  button.dataset.eveningReplayClose='true';
  button.textContent='收起';
  button.setAttribute('aria-label','收起录像播放');
  button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();collapseSdReplay(root);});
  player.prepend(button);
}

/** 修复电网卡片打包产物的实例字段遮蔽及缩放画布下的图表尺寸测量。 */
export function restoreElectricityElement(element) {
  if(!element||typeof element!=='object'||element.__eveningPatched)return;
  try {
    let proto=Object.getPrototypeOf(element);
    while(proto&&proto!==Object.prototype&&(typeof HTMLElement==='undefined'||proto!==HTMLElement.prototype)){
      for(const [key,descriptor] of Object.entries(Object.getOwnPropertyDescriptors(proto))){
        if(key!=='constructor'&&(descriptor.get||descriptor.set)&&Object.prototype.hasOwnProperty.call(element,key)){
          const value=element[key];
          delete element[key];
          element[key]=value;
        }
      }
      proto=Object.getPrototypeOf(proto);
    }
    const tag=element.tagName?.toLowerCase?.()||'';
    if(!element.__eveningPatched){
      element.__eveningPatched=true;
      if(tag==='smart-utilities-card-ele'&&typeof element.updateDayData==='function'){
        const originalUpdateDayData=element.updateDayData;
        // 余额实体异步加载完成后先同步数据处理器，避免首次切换曲线时缺少实体 ID。
        element.updateDayData=function updateDayDataWithServices(...args){
          if(typeof this._updateServices==='function')this._updateServices();
          return originalUpdateDayData.apply(this,args);
        };
      }
      if(tag==='day-chart-view'||tag==='month-chart-view'){
        stabilizeElectricityCharts(element._chartManager);
        const fallbackHeight=280;
        if(element._chartManager&&typeof element._chartManager==='object'&&!element._chartManager.__eveningChartPatched){
          let currentChart=element._chartManager._chart;
          Object.defineProperty(element._chartManager,'_chart',{
            configurable:true,
            enumerable:true,
            get(){return currentChart;},
            set(chart){
              if(chart?.opts?.chart)chart.opts.chart.height='100%';
              if(chart?.w?.config?.chart)chart.w.config.chart.height='100%';
              currentChart=chart;
            }
          });
          element._chartManager.__eveningChartPatched=true;
        }
        // ApexCharts 从 Shadow Host 的 getBoundingClientRect 读取宽高，需返回未缩放画布像素以免在 Pad 缩放视口下被二次缩小。
        element.getBoundingClientRect=function getUnscaledChartRect(){
          const rect=typeof HTMLElement!=='undefined'?HTMLElement.prototype.getBoundingClientRect.call(this):{top:0,left:0,right:0,bottom:0,x:0,y:0,width:0,height:0};
          const container=this.shadowRoot?.querySelector?.('#chart-container');
          const width=container?.clientWidth||this.clientWidth||this.offsetWidth||rect.width||800;
          const height=container?.clientHeight||this.clientHeight||this.offsetHeight||fallbackHeight;
          return {top:rect.top,left:rect.left,bottom:rect.top+height,right:rect.left+width,x:rect.x,y:rect.y,width,height,toJSON(){return this;}};
        };
      }
    }
    if(typeof element.requestUpdate==='function')element.requestUpdate();
  }catch(error){
    console.warn('Electricity card element restoration failed',error);
  }
}

/** 在电网子组件挂载阶段即恢复 Lit 响应式访问器，避免首次渲染属性丢失。 */
function patchElectricityCustomElements(onConnect) {
  if(typeof customElements==='undefined')return;
  for(const tag of ELECTRICITY_TAGS){
    const ctor=customElements.get(tag);
    if(!ctor?.prototype||ctor.prototype.__eveningConnectedPatched)continue;
    const originalConnected=ctor.prototype.connectedCallback;
    ctor.prototype.connectedCallback=function patchedConnectedCallback(...args){
      restoreElectricityElement(this);
      const result=originalConnected?originalConnected.apply(this,args):undefined;
      if(typeof onConnect==='function')onConnect(this);
      return result;
    };
    ctor.prototype.__eveningConnectedPatched=true;
  }
}

/** 读取既有实体，断线或数据不可用时不展示缓存为正常状态。 */
export function overviewStatus(hass) {
  const items=STATUS.map(([id,name,type])=>{
    const entity=hass?.connected!==false?hass?.states?.[id]:null;
    const valid=entity&&!['unknown','unavailable',''].includes(entity.state);
    const text=!valid?'暂不可用':type==='count'?`${entity.state} 台`:type==='connectivity'?(entity.state==='on'?'已连接':'未连接'):(entity.state==='on'?'需要留意':'正常');
    const alert=!!valid&&(type==='alert'?entity.state==='on':type==='connectivity'&&entity.state==='off');
    return {id,name,text,valid:!!valid,alert};
  });
  return {items,headline:items.some(item=>item.alert)?'家里有事项需要留意':items.every(item=>item.valid)?'家里一切安稳':'部分家中状态暂不可用'};
}

/** 创建家中概览；复用原首页原生卡片、录像回放和电网详情。 */
export function createHomeOverview() {
  const host=document.querySelector('#overview-page');
  let visible=false,epoch=0,mounted=false,lastSignature='',warned=false;
  const cards=new Map(),cardObservers=[],styledCardRoots=new WeakSet();
  let cameraPicture='';
  host.innerHTML=`<div class="overview-columns"><article class="overview-section"><header><h2>摄像头</h2><span>萤石 BC2 · 实时画面与录像</span></header><div data-overview-card="camera" class="overview-camera"><div class="overview-camera-media"><button type="button" class="overview-camera-preview" aria-label="播放摄像头实时画面"><img alt="萤石 BC2 画面" hidden><span>点击播放实时画面</span></button><video class="overview-camera-video" controls playsinline muted preload="none" aria-label="摄像头实时画面" hidden></video><span class="overview-camera-playback" role="status" aria-live="polite" hidden></span><button type="button" class="overview-camera-expand" aria-label="放大播放画面" aria-haspopup="dialog" aria-expanded="false">${icon('expand')}</button></div><div class="overview-camera-meta"><span id="overview-camera-state">状态待确认</span><button type="button" class="action-pill" id="overview-camera-open" aria-pressed="false">播放实时画面</button></div></div><div data-overview-card="replay"></div></article><article class="overview-section"><header><h2>电网信息</h2><span>家庭用电 · 国家电网</span></header><div data-overview-card="electricity"></div></article></div><article class="overview-status"><header><div><h2>家中状态</h2><p id="overview-headline"></p></div>${icon('home')}</header><div class="overview-status-items">${STATUS.map(([id,name])=>`<div data-overview-entity="${id}"><span>${name}</span><strong>暂不可用</strong></div>`).join('')}</div></article>`;
  const cameraPlayer=createCameraPlayer(host,readHass);
  const cameraImage=host.querySelector('.overview-camera-preview img'),cameraHint=host.querySelector('.overview-camera-preview span');
  cameraImage.addEventListener('load',()=>{cameraImage.hidden=false;cameraHint.hidden=true;});
  cameraImage.addEventListener('error',()=>{cameraImage.hidden=true;cameraHint.hidden=false;cameraHint.textContent='缩略图暂不可用，点击播放实时画面';console.warn('Home overview camera preview unavailable');});
  /** 获取宿主当前会话，独立预览不建立额外连接。 */
  function readHass() {
    try{return window.parent!==window?window.parent.document.querySelector('home-assistant')?.hass:null;}
    catch(error){if(!warned){console.warn('Home overview host unavailable',error);warned=true;}return null;}
  }
  /** 加载宿主已注册组件，不复制凭据或重新实现电网计费规则。 */
  async function mountCards(hass) {
    const requestEpoch=epoch;
    mounted=true;
    for(const [key,tag,url,config] of CARDS){
      if((key==='replay'&&!SITE.camera.serial)||(key==='electricity'&&!entityId('sensor.example_electricity'))){host.querySelector(`[data-overview-card="${key}"]`).textContent='未配置，可按使用说明启用';continue;}
      const slot=host.querySelector(`[data-overview-card="${key}"]`);
      try {
        // 原组件在当前文档加载，避免跨 iframe 共享构造样式表导致渲染失败。
        await import(url);
        if(!visible||requestEpoch!==epoch)return;
        if(key==='electricity')patchElectricityCustomElements(el=>styleOverviewCard(el,true));
        const card=document.createElement(tag);
        if(key==='electricity')restoreElectricityElement(card);
        // 电网组件自带主题计算，跟随本页的深浅设置而非宿主全局主题。
        card.setConfig(key==='electricity'?{...config,theme:()=>document.querySelector('#screen').dataset.theme==='light'?'on':'off'}:config);
        card.hass=hass;cards.set(key,card);slot.replaceChildren(card);
        await card.updateComplete;
        requestAnimationFrame(()=>styleOverviewCard(card,key==='electricity'));
      }catch(error){console.error('Home overview card initialization failed',key,error);slot.textContent='内容暂不可用，请稍后重新进入此页';slot.classList.add('overview-unavailable');}
    }
  }
  /** 隐藏嵌套滚动条，并在本页电网卡片内统一放大文字和日历行高。 */
  function styleOverviewCard(element,electricity=false) {
    if(!element.isConnected)return;
    if(electricity)restoreElectricityElement(element);
    const root=element.shadowRoot;
    if(!root)return;
    if(electricity&&element.tagName==='CALENDAR-VIEW')attachElectricityCalendarSwipe(element);
    if(element.tagName==='SD-REPLAY-CARD'){
      if(!root.querySelector('[data-evening-replay-style]')){
        const replayStyle=document.createElement('style');
        replayStyle.dataset.eveningReplayStyle='true';
        replayStyle.textContent=REPLAY_STYLE;
        root.append(replayStyle);
      }
      attachSdReplayClose(element);
    }
    if(!styledCardRoots.has(root)){
      styledCardRoots.add(root);
      const style=document.createElement('style');
      style.textContent=':host,*{scrollbar-width:none!important;scrollbar-gutter:auto!important}:host::-webkit-scrollbar,*::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}.hero-title,.usage-title,.hero-elec-value,.hero-cost-value,.usage-amount{color:var(--primary-text-color)!important;text-shadow:none!important}';
      if(electricity)style.textContent+=ELECTRICITY_STYLE;
      root.append(style);
      // 电网日历和详情可能延迟创建嵌套文档，新增内容也沿用相同规则。
      const observer=new MutationObserver(()=>styleOverviewCard(element,electricity));
      observer.observe(root,{childList:true,subtree:true});cardObservers.push(observer);
    }
    root.querySelectorAll('*').forEach(child=>{if(child.shadowRoot)styleOverviewCard(child,electricity);});
  }
  /** 离开概览或断线时释放组件样式监听，避免保留已移除的录像和图表节点。 */
  function stopCardObservers() {
    cardObservers.splice(0).forEach(observer=>observer.disconnect());
  }
  /** 更新摄像头预览和电量，只使用已有实体图片地址，不持久化访问参数。 */
  function refreshCamera(hass) {
    const entity=hass?.connected!==false?hass?.states?.[entityId('camera.example_camera')]:null;
    const valid=entity&&!['unavailable','unknown'].includes(entity.state);
    host.querySelector('#overview-camera-open').disabled=!valid;
    host.querySelector('.overview-camera-expand').disabled=!valid;
    host.querySelector('.overview-camera-preview').disabled=!valid;
    const battery=hass?.states?.[entityId('sensor.example_camera_battery')];
    host.querySelector('#overview-camera-state').textContent=valid?`萤石 BC2 · ${entity.state==='recording'?'录像中':entity.state==='streaming'?'播放中':'待机'}${battery&&!['unknown','unavailable'].includes(battery.state)?` · 电量 ${battery.state}%`:''}`:'摄像头暂不可用';
    const picture=valid?entity.attributes?.entity_picture:'';
    if(picture&&picture!==cameraPicture){
      const url=new URL(picture,location.origin);
      if(url.origin===location.origin&&url.pathname.startsWith('/api/camera_proxy/')){cameraPicture=picture;cameraImage.src=url.href;}
    }
    if(!valid){if(cameraPlayer.isActive())cameraPlayer.stop();cameraPicture='';cameraImage.removeAttribute('src');cameraImage.hidden=true;cameraHint.hidden=false;cameraHint.textContent='摄像头暂不可用';}
  }

  /** 只更新状态文本和卡片数据，避免刷新导致滚动或播放位置丢失。 */
  function refresh() {
    if(!visible)return;
    const hass=readHass(),status=overviewStatus(hass),signature=JSON.stringify(status);
    refreshCamera(hass);
    if(signature!==lastSignature){
      lastSignature=signature;host.querySelector('#overview-headline').textContent=status.headline;
      for(const item of status.items){const tile=host.querySelector(`[data-overview-entity="${item.id}"]`);tile.querySelector('strong').textContent=item.text;tile.dataset.tone=item.alert?'alert':item.valid?'normal':'unavailable';}
    }
    if(hass?.connected!==false&&hass){
      host.querySelectorAll('.overview-unavailable').forEach(slot=>slot.classList.remove('overview-unavailable'));
      if(!mounted)mountCards(hass);
      for(const card of cards.values())card.hass=hass;
    }else{
      if(mounted){epoch++;mounted=false;stopCardObservers();cards.clear();}
      for(const [key] of CARDS){const slot=host.querySelector(`[data-overview-card="${key}"]`);slot.textContent='暂未连接 Home Assistant，内容不可用';slot.classList.add('overview-unavailable');}
    }
  }
  /** 离开页面移除视频组件，停止后台播放与回放请求。 */
  function setVisible(value) {
    if(visible===value){if(value)refresh();return;}
    visible=value;
    if(value)poll.start();
    else{poll.stop();cameraPlayer.stop();epoch++;mounted=false;stopCardObservers();cards.clear();cameraPicture='';cameraImage.removeAttribute('src');cameraImage.hidden=true;for(const [key] of CARDS)host.querySelector(`[data-overview-card="${key}"]`).replaceChildren();}
  }
  const poll=createVisiblePoll(refresh,5000);
  window.addEventListener('pagehide',()=>cameraPlayer.stop());
  // 主题改变只重绘现有电网组件，不重建录像播放器或丢失展开内容。
  new MutationObserver(()=>cards.get('electricity')?.requestUpdate()).observe(document.querySelector('#screen'),{attributes:true,attributeFilter:['data-theme']});
  return {refresh,setVisible};
}
