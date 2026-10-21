import {FLOORPLAN_LAYOUT} from './floorplan-layout.js';
import {LIGHT_NAMES} from './state.js';
import {icon,lightIcon} from './icons.js';

// 灯光只落在房间室内范围，避免透过隔墙照亮相邻房间或房屋外部。
const LIGHT_ROOMS={
  living:[[16,42],[79.5,42],[79.5,52],[72.6,52],[72.6,91.9],[26.2,91.9],[26.2,63],[23.1,63],[23.1,54],[16,54]],
  // 横向过道从左侧入户区延伸到右侧卫生间门口，卧室与客厅主体不参与照明。
  hall:[[1.7,47.5],[9.2,47.5],[9.2,42.5],[79.5,42.5],[79.5,52],[72.6,52],[72.6,54],[23.1,54],[23.1,56.1],[1.7,56.1]],
  master:[[74,55.8],[97.4,55.8],[97.4,91.8],[74,91.8]],
  secondary:[[1.7,56.1],[21.7,56.1],[21.7,87.2],[1.7,87.2]],
  study:[[54.1,15.7],[72.2,15.7],[72.2,40.8],[54.1,40.8]],
  child:[[74.3,15.7],[92.9,15.7],[92.9,39.6],[74.3,39.6]]
};
const LIGHT_PROFILES={
  dining:['living',14,23],living:['living',18,24],tv:['living',6,25],ceiling:['living',27,15],hall:['hall',33,10],balcony:['living',25,10],
  // 卧室扩大柔光半径，并仅在二维显示中增强亮度；外层房间裁切继续限制照明边界。
  masterRed:['master',23,36,1.25],masterYellow:['master',16,24,1.25],secondary:['secondary',25,39,1.25],study:['study',17,26],child:['child',24,35,1.25]
};

/** 使用同一张材质底图与柔边遮罩叠加灯光，避免为每盏灯创建完整图片或持续渲染循环。 */
function lightingMarkup() {
  const {width,height}=FLOORPLAN_LAYOUT;
  const clips=Object.entries(LIGHT_ROOMS).map(([room,points])=>`<clipPath id="plan-light-room-${room}"><polygon points="${points.map(([x,y])=>`${x*width/100},${y*height/100}`).join(' ')}"/></clipPath>`).join('');
  const lights=FLOORPLAN_LAYOUT.lights.map(({id,x,y})=>{
    const [room,rx,ry]=LIGHT_PROFILES[id];
    // 灯带保留上下两片柔光，过道通过多片重叠光晕连续照亮全长，四周自然衰减。
    const pools=id==='ceiling'?[[47.4,57.2,24,8],[47.7,76.4,23,9]]
      : id==='hall'?[[8,51.5,15,6],[25,47.8,17,6.4],[43,47.8,17,6.4],[61,47.8,17,6.4],[77,47.8,15,6.4]]
      : [[x,y,rx,ry]];
    const shape=pools.map(([cx,cy,lightRx,lightRy])=>`<ellipse cx="${cx*width/100}" cy="${cy*height/100}" rx="${lightRx*width/100}" ry="${lightRy*height/100}" fill="url(#plan-light-falloff)"/>`).join('');
    return `<g class="floorplan-light-zone" data-plan-light="${id}" opacity="0" clip-path="url(#plan-light-room-${room})">${shape}</g>`;
  }).join('');
  return `<svg class="floorplan-lighting" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true" focusable="false"><defs>${clips}<radialGradient id="plan-light-falloff"><stop offset="0" stop-color="white"/><stop offset=".35" stop-color="white" stop-opacity=".94"/><stop offset=".72" stop-color="white" stop-opacity=".45"/><stop offset="1" stop-color="white" stop-opacity="0"/></radialGradient><mask id="plan-light-mask" x="0" y="0" width="${width}" height="${height}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" style="mask-type:alpha">${lights}</mask></defs><image href="./assets/floorplan-textured.webp" width="${width}" height="${height}" preserveAspectRatio="none" mask="url(#plan-light-mask)"/></svg>`;
}

/** 创建静态俯视图和轻量设备覆盖层，不创建画布、动画循环或 WebGL 上下文。 */
export function createFloorplan({onDevice}) {
  const host=document.querySelector('#floorplan');
  host.innerHTML=`<img class="floorplan-image" src="./assets/floorplan-textured.webp" width="${FLOORPLAN_LAYOUT.width}" height="${FLOORPLAN_LAYOUT.height}" alt="房屋俯视平面图，保留现有房间、家具与地面布局" draggable="false"><div class="floorplan-markers">${[...FLOORPLAN_LAYOUT.lights.map(item=>({...item,kind:'light',name:LIGHT_NAMES[item.id]})),...FLOORPLAN_LAYOUT.devices].map(item=>`<button type="button" class="floorplan-marker" data-plan-kind="${item.kind}" data-plan-id="${item.id}" style="left:calc(${item.x}% + ${item.offset||0}px);top:${item.y}%" aria-label="${item.name}，切换模拟开关" aria-pressed="false">${icon(item.kind==='light'?lightIcon(item.name):{ac:'aircon',floor:'heat',fresh:'wind'}[item.kind])}</button>`).join('')}</div>`;
  host.querySelector('img').insertAdjacentHTML('afterend',lightingMarkup());
  host.addEventListener('click',event=>{
    const device=event.target.closest('[data-plan-kind]');
    if(device){onDevice(device.dataset.planKind,device.dataset.planId);return;}
  });
  host.querySelector('img').addEventListener('error',()=>console.error('Evening floorplan image loading failed'));
  /** 原位更新筛选与开关，保留键盘焦点和底图节点。 */
  function update(state,preferences,kind) {
    // 显示增益只增强卧室二维光效，不改写灯组亮度，零亮度与关闭状态仍完全熄灭。
    for(const zone of host.querySelectorAll('[data-plan-light]')){
      const light=state.lights[zone.dataset.planLight],brightness=Number.isFinite(light?.brightness)?light.brightness:65;
      const gain=LIGHT_PROFILES[zone.dataset.planLight][3]??1;
      const opacity=String(light?.on?Math.max(0,Math.min(1,brightness*gain/100)):0);
      if(zone.style.opacity!==opacity)zone.style.opacity=opacity;
    }
    for(const button of host.querySelectorAll('[data-plan-kind]')){
      const type=button.dataset.planKind,id=button.dataset.planId;
      const hidden=!preferences.markers||(kind!=='all'&&(type==='light'?'lights':type)!==kind);
      if(button.hidden!==hidden)button.hidden=hidden;
      const item=type==='light'?state.lights[id]:type==='fresh'?state.fresh:state[type][id];
      const pressed=String(!!item?.on);
      if(button.getAttribute('aria-pressed')!==pressed)button.setAttribute('aria-pressed',pressed);
    }
  }
  return {update};
}
