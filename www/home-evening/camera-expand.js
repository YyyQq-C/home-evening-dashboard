import {icon} from './icons.js';

/** 以同一视频节点打开大窗口，保持当前取流、播放进度和静音设置。 */
export function createCameraExpansion(host,onOpen){
  const media=host.querySelector('.overview-camera-media'),trigger=host.querySelector('.overview-camera-expand'),video=host.querySelector('video.overview-camera-video'),screen=document.querySelector('#screen');
  const overlay=document.createElement('div'),placeholder=document.createElement('div'),inertStates=new Map();
  let opened=false,scrollTop=0,previousFocus=null;
  const attributes=['role','aria-modal','aria-labelledby'],previousAttributes=new Map();
  overlay.className='camera-overlay';overlay.hidden=true;
  overlay.innerHTML=`<button type="button" class="camera-modal-scrim" tabindex="-1" data-camera-collapse aria-label="关闭放大画面遮罩"></button><header><h2 id="camera-large-title">萤石 BC2 · 实时画面</h2><button type="button" class="circle-button camera-modal-close" data-camera-collapse aria-label="关闭放大画面">${icon('close')}</button></header>`;
  placeholder.className='camera-media-placeholder';placeholder.hidden=true;placeholder.setAttribute('aria-hidden','true');
  media.before(placeholder);host.append(overlay);
  /** 记录原有交互状态，仅隔离当前播放区域以外的界面。 */
  function isolate(element){if(!inertStates.has(element)){inertStates.set(element,element.inert);element.inert=true;}}
  /** 打开窗口，固定原播放器显示层，不移动或重建视频节点。 */
  function open(){
    if(opened)return;
    opened=true;scrollTop=host.scrollTop;previousFocus=document.activeElement;
    placeholder.style.height=`${media.offsetHeight}px`;placeholder.hidden=false;
    for(const name of attributes)previousAttributes.set(name,host.getAttribute(name));
    host.setAttribute('role','dialog');host.setAttribute('aria-modal','true');host.setAttribute('aria-labelledby','camera-large-title');
    host.classList.add('camera-expanded');overlay.hidden=false;trigger.setAttribute('aria-expanded','true');
    // 沿播放器的祖先逐层隔离兄弟节点，保留播放器本身和屏保唤醒能力。
    for(let child=media;child!==screen;child=child.parentElement){
      for(const sibling of child.parentElement.children)if(sibling!==child&&sibling!==overlay&&sibling.id!=='standby')isolate(sibling);
    }
    overlay.querySelector('.camera-modal-close').focus({preventScroll:true});onOpen();
  }
  /** 回到原卡片并恢复滚动和焦点，保持正在播放的视频连接。 */
  function close(restoreFocus=true){
    if(!opened)return;
    opened=false;host.classList.remove('camera-expanded');overlay.hidden=true;placeholder.hidden=true;trigger.setAttribute('aria-expanded','false');
    for(const [element,inert] of inertStates)element.inert=inert;inertStates.clear();
    for(const [name,value] of previousAttributes)if(value===null)host.removeAttribute(name);else host.setAttribute(name,value);
    host.scrollTop=scrollTop;
    if(restoreFocus&&(previousFocus?.isConnected))previousFocus.focus({preventScroll:true});
  }
  /** 支持 Escape 返回，并让焦点停留在播放画面与关闭按钮中。 */
  function onKey(event){
    if(!opened||!document.querySelector('#standby').hidden)return;
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close();}
    else if(event.key==='Tab'){
      const closeButton=overlay.querySelector('.camera-modal-close');
      if(video.hidden){event.preventDefault();closeButton.focus();}
      else if(!event.shiftKey&&document.activeElement===closeButton){event.preventDefault();video.focus();}
      else if(event.shiftKey&&document.activeElement===video){event.preventDefault();closeButton.focus();}
    }
  }
  trigger.addEventListener('click',event=>{event.stopPropagation();open();});
  overlay.addEventListener('click',event=>{if(event.target.closest('[data-camera-collapse]'))close();});
  document.addEventListener('keydown',onKey,true);
  return {close};
}
