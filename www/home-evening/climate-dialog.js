import {icon} from './icons.js';
import {limits} from './state.js';

/** 创建房间温控设置弹窗，复用模拟设备状态和温度草稿，不发送真实控制请求。 */
export function createClimateDialog({state,getDrafts,onChange,onTemperatureChange,getReading,onPrepare,isSimulated}) {
  const host=document.querySelector('#climate-layer'),inertStates=new Map();
  const modes=['制冷','制热','除湿','送风'],fans=['自动','低速','中速','高速'];
  const optionIcons={mode:['snow','sun','drop','fan'],fan:['gauge','windLow','windMedium','windHigh']};
  let selected=null,previousFocus=null;
  /** 生成平铺的选项按钮组，选中状态由设备实际模拟值决定。 */
  function options(action,values,current,label,disabled=false) {
    return `<div class="climate-options" role="group" aria-label="${label}">${values.map((value,index)=>`<button type="button" data-climate-action="${action}" data-value="${value}" data-climate-key="${action}-${index}" aria-pressed="${current===value}" ${disabled?'disabled':''}>${icon(optionIcons[action][index])}<span>${value}</span></button>`).join('')}</div>`;
  }
  /** 更新单层设置行，重绘后保留当前操作焦点及弹窗正文滚动位置。 */
  function render() {
    if(!selected)return;
    const {kind,id,label}=selected,item=state[kind][id],key=`${kind}:${id}:temperature`,drafts=getDrafts();
    const live=getReading?.(kind,id),unavailable=live&&!live.available,simulated=!!isSimulated?.(kind,id);
    const [fallbackMin,fallbackMax]=limits(kind),min=live?.min??fallbackMin,max=live?.max??fallbackMax;
    const noTemperature=unavailable||(live&&live.temperature===null);
    const temperature=noTemperature?'—':drafts[key]??item.temperature,dirty=key in drafts;
    const focusKey=host.contains(document.activeElement)?document.activeElement.dataset.climateKey:null;
    const scroll=host.querySelector('.climate-body')?.scrollTop||0;
    const modeValue=unavailable?null:(simulated?item.mode:live?.mode);
    // 当前值不在可选列表（例如自动）时不点亮任何模式，也不改写本地状态。
    const shownMode=modes.includes(modeValue)?modeValue:null;
    host.innerHTML=`<button type="button" class="climate-scrim" data-climate-action="close" aria-label="关闭设备设置遮罩"></button><section class="climate-dialog" role="dialog" aria-modal="true" aria-labelledby="climate-title"><header><div><small>设备设置 · 操作仅本地模拟</small><h2 id="climate-title">${label}</h2></div><button type="button" class="climate-close" data-climate-action="close" data-climate-key="close" aria-label="关闭设备设置">${icon('close')}</button></header><div class="climate-body"><div class="climate-setting-row"><div><label>设备电源</label><small>${unavailable?'设备暂不可用':simulated?(item.on?'本地模拟开启':'本地模拟关闭'):live?.status||'状态待确认'}</small></div><button type="button" class="toggle" role="switch" aria-label="${label}电源" aria-checked="${!unavailable&&item.on}" ${unavailable?'disabled':''} data-climate-action="power" data-climate-key="power"></button></div><div class="climate-setting-row"><div><label>设定温度</label><small>${unavailable?'设备数据不可用':`${min}–${max}°C`}</small></div><div class="climate-temperature"><button type="button" data-climate-action="temperature" data-delta="-1" data-climate-key="minus" aria-label="降低设定温度" ${noTemperature||temperature<=min?'disabled':''}>${icon('minus')}</button><output aria-live="polite">${temperature}<span>°C</span></output><button type="button" data-climate-action="temperature" data-delta="1" data-climate-key="plus" aria-label="提高设定温度" ${noTemperature||temperature>=max?'disabled':''}>${icon('plus')}</button></div></div>${kind==='ac'?`<div class="climate-setting-row"><label>运行模式</label>${options('mode',modes,shownMode,'空调运行模式',unavailable)}</div><div class="climate-setting-row"><label>风速</label>${options('fan',fans,unavailable?null:simulated?item.fan:live?.fan,'空调风速',unavailable)}</div>`:`<div class="climate-setting-row"><label>运行方式</label><span class="climate-heating">${unavailable?'—':'供暖'}</span></div>`}</div><footer><span>${unavailable?'设备暂不可用，未下发任何操作':dirty?'空闲 1 秒后保存本地模拟，未下发设备':simulated?'本地模拟已保存，未下发设备':'真实状态只读同步，操作不会下发设备'}</span></footer></section>`;
    host.querySelector('.climate-body').scrollTop=scroll;
    if(focusKey){
      const target=host.querySelector(`[data-climate-key="${focusKey}"]`);
      (target&&!target.disabled?target:host.querySelector('[data-climate-key="close"]'))?.focus({preventScroll:true});
    }
  }
  /** 打开指定设备的设置并隔离背景，避免设置图标触发整卡电源或操作穿透模型。 */
  function open(device,trigger) {
    if(!['ac','floor'].includes(device.kind)||!state[device.kind]?.[device.id]){console.error('Climate dialog device is unavailable');return;}
    if(selected)close();
    selected=device;previousFocus=trigger||document.activeElement;
    for(const child of document.querySelector('#screen').children)if(child!==host&&child.id!=='standby'){inertStates.set(child,child.inert);child.inert=true;}
    render();host.hidden=false;host.querySelector('[data-climate-key="close"]').focus();
  }
  /** 关闭弹窗并将焦点放回对应设备入口，待调温度继续按空闲一秒自动同步。 */
  function close() {
    if(!selected)return;
    const {kind,id}=selected;selected=null;host.hidden=true;
    for(const [child,inert] of inertStates)child.inert=inert;inertStates.clear();
    const restored=document.querySelector(`.room-slide[aria-hidden="false"] [data-action="climate-open"][data-kind="${kind}"][data-id="${id}"]`);
    (previousFocus?.isConnected?previousFocus:restored||document.querySelector('#nav-handle'))?.focus({preventScroll:true});
  }
  /** 只更新当前设备，温度交给统一延迟调节逻辑，模式、风速和电源即时同步。 */
  function onClick(event) {
    const target=event.target.closest('button[data-climate-action]');
    if(!target||target.disabled||!selected)return;
    event.preventDefault();event.stopPropagation();
    try {
      const {kind,id}=selected,item=state[kind][id],action=target.dataset.climateAction;
      if(action==='close'){close();return;}
      if(action==='temperature'){
        onTemperatureChange(kind,id,Number(target.dataset.delta)*(getReading?.(kind,id)?.step||1));return;
      }
      if(getReading&&!getReading(kind,id).available)return;
      onPrepare?.(kind,id);
      if(action==='power')item.on=!item.on;
      else if(action==='mode'&&kind==='ac'&&modes.includes(target.dataset.value))item.mode=target.dataset.value;
      else if(action==='fan'&&kind==='ac'&&fans.includes(target.dataset.value))item.fan=target.dataset.value;
      else return;
      onChange();
    } catch(error) {console.error('Climate dialog action failed',error);}
  }
  /** 让 Escape 只关闭当前弹窗，并将键盘焦点限制在可用的设置控件内。 */
  function onKey(event) {
    if(!selected||!document.querySelector('#standby').hidden)return;
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close();return;}
    if(event.key!=='Tab')return;
    const controls=[...host.querySelectorAll('.climate-dialog button:not(:disabled)')],first=controls[0],last=controls.at(-1);
    if(!host.querySelector('.climate-dialog').contains(document.activeElement)){event.preventDefault();first?.focus();}
    else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  }
  host.addEventListener('click',onClick);document.addEventListener('keydown',onKey,true);
  return {open,close,refresh:render};
}
