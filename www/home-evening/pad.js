import {SITE} from './site-config.js';
import {createVisiblePoll} from './runtime.js';
import {PAD_FIELDS,padReading} from './pad-data.js';
import {createPadControls} from './pad-controls.js';
import {icon} from './icons.js';

/** 生成平板状态条的电量与内存图标。 */
function padIcon(kind,reading){
  const shape=kind==='battery'?`<rect x="2" y="7" width="18" height="11" rx="2"/><path d="M22 10v5"/>${reading.numbers.battery===null?'':`<rect x="4" y="9" width="${14*reading.numbers.battery/100}" height="7" rx="1" fill="currentColor" opacity=".35" stroke="none"/>`}${reading.charging?'<path d="m12 7-4 6h4l-1 5 6-7h-4l1-4" fill="currentColor" stroke-width=".7"/>':''}`:'<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4M10 10h4v4h-4z"/>';
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shape}</svg>`;
}
/** 创建 Pad 状态入口、详情与真实操作区，复用宿主 HA 登录会话。 */
export function createPad(){
  const trigger=document.querySelector('#pad-open'),host=document.querySelector('#pad-layer'),inertStates=new Map();
  let opened=false,signature='',triggerSignature='',previousFocus=null,warned=false,reading=padReading(null);
  const groups=[...new Set(PAD_FIELDS.map(field=>field.group))];
  host.innerHTML=`<button type="button" class="pad-scrim" data-pad-close aria-label="关闭设备详情遮罩"></button><section class="pad-dialog" role="dialog" aria-modal="true" aria-labelledby="pad-title"><header><div><h2 id="pad-title">Pad 设备详情</h2><p data-pad-status></p></div><button type="button" class="circle-button" data-pad-close aria-label="关闭设备详情">${icon('close')}</button></header><div class="pad-body" tabindex="0" aria-label="设备详情内容，可上下滚动"><div class="pad-summary"><div><span>电量</span><strong data-pad-key="battery"></strong></div><div><span>内存已用</span><strong data-pad-key="memory"></strong></div><div><span>CPU 使用率</span><strong data-pad-key="cpu"></strong></div><div><span>电池温度</span><strong data-pad-key="temperature"></strong></div></div><div class="pad-sections">${groups.map(group=>`<section><h3>${group}</h3><dl>${PAD_FIELDS.filter(field=>field.group===group).map(field=>`<div${field.key==='url'?' class="pad-wide"':''}><dt>${field.label}</dt><dd data-pad-key="${field.key}"></dd></div>`).join('')}</dl></section>`).join('')}</div></div><footer data-pad-report></footer></section>`;
  /** 同源读取当前 HA 缓存，跨域不可用时只记录一次日志。 */
  function currentHass(){try{return window.parent!==window?window.parent.document.querySelector('home-assistant')?.hass:null;}catch(error){if(!warned)console.warn('Pad device host unavailable',error);warned=true;return null;}}
  const controlsHost=document.createElement('section');controlsHost.className='pad-operations';
  host.querySelector('.pad-sections').before(controlsHost);
  const controls=createPadControls(controlsHost,currentHass,()=>padReading(currentHass()).online);
  /** 仅更新改变的文本与图标，详情刷新时保留滚动位置和焦点。 */
  function refresh(){
    if(opened)controls.refresh();
    reading=padReading(currentHass());const next=JSON.stringify(reading);
    if(next===signature)return;signature=next;
    const compact=JSON.stringify([reading.online,reading.charging,reading.lowMemory,reading.values.battery,reading.values.memory]);
    if(compact!==triggerSignature){
      triggerSignature=compact;
      trigger.dataset.online=String(reading.online);trigger.dataset.charging=String(reading.charging);
      trigger.dataset.lowBattery=String(reading.numbers.battery!==null&&reading.numbers.battery<=20);trigger.dataset.lowMemory=String(reading.lowMemory);
      trigger.innerHTML=`<span class="pad-battery-icon">${padIcon('battery',reading)}<span class="pad-value">${reading.values.battery}</span></span><span class="pad-memory-icon">${padIcon('memory',reading)}<span class="pad-value">${reading.values.memory}</span></span>`;
      trigger.setAttribute('aria-label',`查看平板设备详情，${reading.online?`电量 ${reading.values.battery}，内存已用 ${reading.values.memory}${reading.charging?'，充电中':''}`:'设备离线'}`);
    }
    for(const node of host.querySelectorAll('[data-pad-key]')){const value=reading.values[node.dataset.padKey];if(node.textContent!==value)node.textContent=value;}
    const status=reading.online?(reading.charging?'在线 · 充电中':'在线'):'设备离线';host.querySelector('[data-pad-status]').textContent=status;
    host.dataset.online=String(reading.online);
    let stamp='—';
    if(reading.reported!==null){try{stamp=new Intl.DateTimeFormat('zh-CN',{timeZone:reading.timeZone,hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(reading.reported));}catch(error){console.warn('Pad report time formatting failed',error);}}
    host.querySelector('[data-pad-report]').textContent=reading.online?`最近报告 ${stamp} · ${SITE.pad?.mode==='live'?'Pad 操作已启用':'Pad 操作只读'}`:'设备离线 · 当前数值和操作不可用';
  }
  /** 打开设备详情，隔离背景操作并保留屏保唤醒入口。 */
  function open(){
    if(opened)return;refresh();opened=true;controls.collapse();controls.refresh();previousFocus=document.activeElement;host.hidden=false;trigger.setAttribute('aria-expanded','true');
    for(const child of document.querySelector('#screen').children)if(child!==host&&child.id!=='standby'){inertStates.set(child,child.inert);child.inert=true;}
    host.querySelector('[aria-label="关闭设备详情"]').focus({preventScroll:true});
  }
  /** 恢复背景交互、关闭面板并归还入口焦点。 */
  function close(){
    if(!opened)return;opened=false;host.hidden=true;trigger.setAttribute('aria-expanded','false');
    for(const [child,inert] of inertStates)child.inert=inert;inertStates.clear();
    (previousFocus?.isConnected&&previousFocus.getClientRects().length?previousFocus:trigger).focus({preventScroll:true});
  }
  /** 限制详情内的键盘焦点，Escape 仅关闭当前面板。 */
  function onKey(event){
    if(!opened||!document.querySelector('#standby').hidden)return;
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close();return;}
    if(event.key!=='Tab')return;
    const items=[...host.querySelectorAll('.pad-dialog button:not(:disabled),.pad-dialog input:not(:disabled),.pad-dialog textarea:not(:disabled),.pad-dialog summary,.pad-body')].filter(node=>node.getClientRects().length),first=items[0],last=items.at(-1);
    if(!host.contains(document.activeElement)){event.preventDefault();first.focus();}
    else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  }
  const {start}=createVisiblePoll(refresh,2000);
  trigger.addEventListener('click',open);
  host.addEventListener('click',event=>{if(event.target===host||event.target.closest('[data-pad-close]')){event.preventDefault();event.stopPropagation();close();}});
  document.addEventListener('keydown',onKey,true);
  return {start,close};
}
