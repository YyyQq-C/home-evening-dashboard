import {icon} from './icons.js';
import {weatherEscape as escape} from './weather-data.js';
import {APPLIANCE_DEFINITIONS,applianceInformation} from './appliance-data.js';

/** 创建统一家电详情弹窗，真实信息只读，操作沿用本地模拟状态。 */
export function createApplianceDialog({state,valueFor,stepButton,toggle}) {
  const host=document.querySelector('#appliance-layer'),inertStates=new Map();
  let selected=null,previousFocus=null,controlSignature='';
  /** 只读取同源 HA 宿主的已有缓存，不创建连接或调用设备服务。 */
  function readHass() {
    try {return window.parent!==window?window.parent.document.querySelector('home-assistant')?.hass:null;}
    catch(error) {console.warn('Appliance host state unavailable',error);return null;}
  }
  /** 生成温度步进器，复用最后一次操作后空闲一秒自动保存的调节逻辑。 */
  function temperature(label,field='temperature',delta=1) {
    return `<div class="appliance-control-row"><span>${label}</span><div class="appliance-detail-stepper">${stepButton('appliances',selected,-delta,`降低${label}`,field)}<output>${valueFor('appliances',selected,field)}<small>°C</small></output>${stepButton('appliances',selected,delta,`提高${label}`,field)}</div></div>`;
  }
  /** 生成平铺模拟操作区，不将真实传感器值写入模拟状态。 */
  function controls() {
    const item=state.appliances[selected];
    if(selected==='fridge')return temperature('冷藏温度','cool')+temperature('冷冻温度','freeze')+`<div class="appliance-control-row"><span>节能模式</span><button type="button" class="toggle" role="switch" aria-label="冰箱节能模式" aria-checked="${item.eco}" data-action="fridge-eco"></button></div>`;
    if(selected==='washer')return `<div class="appliance-control-row"><span>运行状态</span><strong>${item.paused?'已暂停':'洗涤中'}</strong></div><div class="appliance-control-row"><span>洗衣程序</span><strong>${escape(item.program)}</strong></div><div class="appliance-control-row"><span>剩余时间</span><strong>${item.remaining} 分钟</strong></div><div class="appliance-control-row"><span>当前进度</span><strong>${item.progress}%</strong></div><button type="button" class="appliance-detail-action" data-action="washer">${icon(item.paused?'play':'pause')}${item.paused?'继续洗涤':'暂停洗涤'}</button>`;
    if(selected==='purifier')return `<div class="appliance-control-row"><span>设备电源</span>${toggle('appliances','purifier',item.on,'净水器电源')}</div><div class="appliance-control-row"><span>纯水 TDS</span><strong>${item.tds}</strong></div><div class="appliance-control-row"><span>滤芯剩余</span><strong>${item.filter}%</strong></div>`;
    return `<div class="appliance-control-row"><span>设备电源</span>${toggle('appliances','drinker',item.on,'管线机电源')}</div>`+temperature('设定水温','temperature',5)+`<div class="appliance-control-row"><span>出水定量</span><strong>${item.volume} mL</strong></div><button type="button" class="appliance-detail-action" data-action="dispense" ${item.on?'':'disabled'}>${icon('drop')}模拟出水 ${item.volume} mL</button>`;
  }
  /** 构建一次单层面板，详情分组直接平铺，后续更新保留展开和滚动状态。 */
  function build() {
    const definition=APPLIANCE_DEFINITIONS[selected];
    host.innerHTML=`<button type="button" class="appliance-detail-scrim" data-appliance-close aria-label="关闭家电详情遮罩" tabindex="-1"></button><section class="appliance-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="appliance-detail-title"><header><div><small>设备详情</small><h2 id="appliance-detail-title">${definition.name}详情</h2></div><button type="button" class="appliance-detail-close" data-appliance-close data-action="close-detail" aria-label="关闭家电详情">${icon('close')}</button></header><div class="appliance-dialog-body"><div class="appliance-detail-sidebar"><div class="appliance-product-overview"><img src="./assets/${selected}.png" alt="${escape(definition.model)} 产品图"><p>${definition.brand} · ${definition.name}</p><p class="appliance-detail-model">${escape(definition.model.replace(definition.brand+' ','').replace(' · 白色',''))}</p><p class="appliance-detail-location">${definition.location}</p></div><section class="appliance-simulated-controls" aria-label="模拟操作"><h3>快捷操作 <small>模拟</small></h3><div class="appliance-control-content"></div><p class="appliance-control-note">温度停止调节 1 秒后自动生效</p></section></div><section class="appliance-information" aria-label="设备详细信息"><div class="appliance-live-heading"><h3>设备详细信息 <small>只读</small></h3><span class="appliance-live-status"></span></div><p class="appliance-live-message"></p><div class="appliance-info-groups">${selected==='fridge'?`<div class="appliance-basic-info"><h4>设备资料</h4><dl><div><dt>品牌</dt><dd>${definition.brand}</dd></div><div><dt>型号</dt><dd>${escape(definition.model.replace(definition.brand+' ','').replace(' · 白色',''))}</dd></div><div><dt>颜色</dt><dd>白色</dd></div><div><dt>安装位置</dt><dd>${definition.location}</dd></div></dl></div>`:''}${definition.groups.map((group,index)=>`<details data-appliance-group="${index}" ${index===0?'open':''}><summary>${escape(group.title)}<small>${group.items.length} 项</small></summary><dl>${group.items.map(item=>`<div><dt>${escape(item.name)}</dt><dd data-appliance-entity="${item.entity}">—</dd></div>`).join('')}</dl></details>`).join('')}</div><p class="appliance-report-time"></p></section></div><footer>设备信息来自 HA 已有状态 · 操作仍为本地模拟，不控制真实家电</footer></section>`;
    host.querySelector('.appliance-control-note').hidden=selected==='washer'||selected==='purifier';
  }
  /** 原位更新只读状态；仅在模拟控制变化时更新控件，保留焦点和正文位置。 */
  function refresh() {
    if(!selected)return;
    const hass=readHass(),information=applianceInformation(selected,hass);
    const signature=JSON.stringify([state.appliances[selected],['temperature','cool','freeze'].map(field=>valueFor('appliances',selected,field))]);
    if(signature!==controlSignature){
      const focused=host.contains(document.activeElement)?document.activeElement:null;
      const key=focused?.dataset.applianceControlKey;
      const content=host.querySelector('.appliance-control-content');content.innerHTML=controls();
      content.querySelectorAll('button').forEach((button,index)=>button.dataset.applianceControlKey=String(index));
      if(key!==undefined)content.querySelector(`[data-appliance-control-key="${key}"]`)?.focus({preventScroll:true});
      controlSignature=signature;
    }
    host.querySelector('.appliance-live-status').textContent=information.status;
    host.querySelector('.appliance-live-status').dataset.available=String(information.available);
    host.querySelector('.appliance-live-message').textContent=information.available?`当前状态：${information.reading}`:selected==='fridge'?'冰箱尚未接入 HA，暂无实时设备信息。':information.status==='未连接 HA'?'独立预览暂无实时数据，连接家居首页后显示已有设备信息。':'当前无法读取有效设备信息，不显示离线缓存数值。';
    for(const group of information.groups)for(const item of group.items)host.querySelector(`[data-appliance-entity="${item.entity}"]`).textContent=item.value;
    const report=host.querySelector('.appliance-report-time');
    report.textContent=information.reportedAt?'状态报告时间：'+new Intl.DateTimeFormat('zh-CN',{timeZone:hass?.config?.time_zone||'Asia/Shanghai',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(information.reportedAt)):'';
  }
  /** 打开指定设备详情并隔离背景，防止详情操作误触设备卡片或模型。 */
  function open(id,trigger) {
    if(!APPLIANCE_DEFINITIONS[id]){console.error('Appliance detail device is unavailable');return;}
    if(selected)close();selected=id;previousFocus=trigger||document.activeElement;controlSignature='';
    try {
      for(const child of document.querySelector('#screen').children)if(child!==host&&child.id!=='standby'){inertStates.set(child,child.inert);child.inert=true;}
      build();refresh();host.hidden=false;host.querySelector('.appliance-detail-close').focus();
    } catch(error) {console.error('Appliance detail opening failed',error);close();}
  }
  /** 关闭详情并恢复原入口焦点，温度调节的延迟保存继续按原计时执行。 */
  function close() {
    if(!selected)return;const id=selected;selected=null;host.hidden=true;
    for(const [child,inert] of inertStates)child.inert=inert;inertStates.clear();
    (previousFocus?.isConnected?previousFocus:document.querySelector(`[data-appliance="${id}"] [data-action="appliance-detail"]`)||document.querySelector('#nav-handle'))?.focus({preventScroll:true});
  }
  /** 保持弹窗内键盘焦点，Escape 只关闭当前家电详情。 */
  function onKey(event) {
    if(!selected||!document.querySelector('#standby').hidden)return;
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close();return;}
    if(event.key!=='Tab')return;
    const dialog=host.querySelector('.appliance-detail-dialog'),list=[...dialog.querySelectorAll('button:not(:disabled),summary')].filter(el=>el.getClientRects().length),first=list[0],last=list.at(-1);
    if(!dialog.contains(document.activeElement)){event.preventDefault();first?.focus();}
    else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  }
  host.addEventListener('click',event=>{if(event.target.closest('[data-appliance-close]')){event.preventDefault();event.stopPropagation();close();}});
  document.addEventListener('keydown',onKey,true);
  const timer=setInterval(()=>{try{refresh();}catch(error){console.error('Appliance detail refresh failed',error);}},5000);
  window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
  return {open,close,refresh};
}
