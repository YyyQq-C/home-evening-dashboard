/** 为同一视频节点提供数字缩放，不改变媒体地址、播放进度或摄像头设置。 */
export function createCameraZoom(viewport,{targets,video}){
  let scale=1,x=0,y=0,gesture=null,suppressUntil=0;
  const pointers=new Map(),nativeControls=video.controls;
  viewport.classList.add('camera-zoom-viewport');viewport.tabIndex=0;
  viewport.setAttribute('aria-label','摄像头画面，可双指缩放，放大后拖动查看');
  targets.forEach(target=>target.classList.add('camera-zoom-target'));
  const style=document.createElement('style');
  style.textContent=`
.camera-zoom-viewport{position:relative;overflow:hidden;touch-action:none;background:#000}
.camera-zoom-target{transform:translate3d(var(--camera-pan-x,0px),var(--camera-pan-y,0px),0) scale(var(--camera-scale,1))!important;transform-origin:center;will-change:transform}
.camera-zoom-viewport[data-zoomed=true]{cursor:grab}.camera-zoom-viewport[data-dragging=true]{cursor:grabbing}
.camera-zoom-viewport>.camera-zoom-controls{position:absolute;left:14px;top:14px;z-index:4;display:flex;align-items:center;gap:6px;padding:6px;border:1px solid var(--line);border-radius:14px;background:var(--surface-dialog);color:var(--text);touch-action:manipulation;cursor:default}
.camera-zoom-controls button{box-sizing:border-box;min-width:48px;min-height:48px;border:1px solid var(--line);border-radius:9px;padding:7px 10px;background:var(--surface-button);color:var(--text);font:inherit;font-size:20px;line-height:1.3;cursor:pointer}
.camera-zoom-controls button:disabled{opacity:.4;cursor:default}.camera-zoom-controls [data-zoom=reset]{min-width:122px;font-size:18px}.camera-zoom-controls [hidden]{display:none!important}
.camera-zoom-controls button:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
.overview-camera-media.camera-zoom-viewport .overview-camera-playback{top:90px}
`;
  const toolbar=document.createElement('div');toolbar.className='camera-zoom-controls';toolbar.setAttribute('role','group');toolbar.setAttribute('aria-label','画面缩放');
  toolbar.innerHTML='<button type="button" data-zoom="out" aria-label="缩小画面">−</button><button type="button" data-zoom="reset" aria-label="复位画面" title="恢复原始大小">100% · 复位</button><button type="button" data-zoom="in" aria-label="放大画面">＋</button><button type="button" data-zoom="play" hidden>暂停</button>';
  viewport.append(style,toolbar);
  /** 按当前显示区域限制位移，缩小后不会把整个画面拖出视口。 */
  function paint(){
    x=Math.max(-viewport.clientWidth*(scale-1)/2,Math.min(viewport.clientWidth*(scale-1)/2,x));
    y=Math.max(-viewport.clientHeight*(scale-1)/2,Math.min(viewport.clientHeight*(scale-1)/2,y));
    viewport.style.setProperty('--camera-scale',String(scale));viewport.style.setProperty('--camera-pan-x',x+'px');viewport.style.setProperty('--camera-pan-y',y+'px');
    viewport.dataset.zoomed=String(scale>1);
    toolbar.querySelector('[data-zoom=out]').disabled=scale<=1;toolbar.querySelector('[data-zoom=in]').disabled=scale>=4;
    toolbar.querySelector('[data-zoom=reset]').textContent=Math.round(scale*100)+'% · 复位';
    // 放大时用固定位置的播放按钮，避免原生控制条随画面一起被裁掉。
    video.controls=nativeControls&&scale===1;syncPlayback();
  }
  /** 同步固定播放按钮，不触碰原播放器的连接和缓冲状态。 */
  function syncPlayback(){const button=toolbar.querySelector('[data-zoom=play]');button.hidden=scale===1||video.hidden;button.textContent=video.paused?'播放':'暂停';button.setAttribute('aria-label',video.paused?'继续播放画面':'暂停画面');}
  /** 将屏幕坐标换算为画面内部坐标，兼容大屏整体缩放后的触点距离。 */
  function position(point){const box=viewport.getBoundingClientRect(),ratio=box.width/viewport.clientWidth||1;return {x:(point.x-box.left-box.width/2)/ratio,y:(point.y-box.top-box.height/2)/ratio};}
  /** 以指定触点为中心缩放，并将倍率限制在一至四倍。 */
  function zoom(value,anchor={x:0,y:0}){const next=Math.max(1,Math.min(4,value)),ratio=next/scale;x=anchor.x-(anchor.x-x)*ratio;y=anchor.y-(anchor.y-y)*ratio;scale=next;paint();}
  /** 复位倍率、位移和未完成手势，继续播放同一个视频。 */
  function reset(){pointers.clear();gesture=null;scale=1;x=0;y=0;viewport.dataset.dragging='false';paint();}
  /** 在触点数量改变时重新记录手势基线，避免双指转单指时跳动。 */
  function baseline(){const points=[...pointers.values()].map(position);if(!points.length){gesture=null;return;}const a=points[0],b=points[1]||a;gesture={x:(a.x+b.x)/2,y:(a.y+b.y)/2,distance:Math.hypot(a.x-b.x,a.y-b.y),scale,panX:x,panY:y};}
  /** 记录画面上的触点，保留原生控制条与缩放按钮的正常点击。 */
  function begin(event){
    if(event.button!==0||event.target.closest('.camera-zoom-controls,.overview-camera-expand'))return;
    const box=viewport.getBoundingClientRect();
    if(scale===1&&video.controls&&!video.hidden&&event.clientY>box.bottom-60*box.width/viewport.clientWidth)return;
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});baseline();
    if(scale>1||pointers.size>1){for(const id of pointers.keys()){try{viewport.setPointerCapture(id);}catch(error){console.warn('Camera zoom pointer capture failed');}}}
  }
  /** 双指捏合围绕触点中点缩放，单指在放大状态下拖动画面。 */
  function move(event){
    if(!pointers.has(event.pointerId)||!gesture)return;
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    const points=[...pointers.values()].map(position),a=points[0],b=points[1]||a;
    if(points.length<2&&scale===1)return;
    event.preventDefault();suppressUntil=performance.now()+600;viewport.dataset.dragging='true';
    const next=points.length>1&&gesture.distance>0?Math.max(1,Math.min(4,gesture.scale*Math.hypot(a.x-b.x,a.y-b.y)/gesture.distance)):scale;
    const ratio=next/gesture.scale;
    x=(a.x+b.x)/2-(gesture.x-gesture.panX)*ratio;y=(a.y+b.y)/2-(gesture.y-gesture.panY)*ratio;scale=next;paint();
  }
  /** 松手或取消时保留倍率，并结束对应触点的拖动。 */
  function end(event){if(!pointers.delete(event.pointerId))return;baseline();viewport.dataset.dragging='false';}
  /** 处理独立按钮，缩放不会触发下层预览图的播放点击。 */
  function action(event){const button=event.target.closest('[data-zoom]');if(!button)return;event.stopPropagation();const key=button.dataset.zoom;if(key==='in')zoom(scale+.5);else if(key==='out')zoom(scale-.5);else if(key==='reset')reset();else if(video.paused)video.play().catch(error=>console.warn('Camera zoom playback resume failed',error.name));else video.pause();}
  /** 屏蔽捏合或拖动后的兼容点击，避免误点播放及原生控制条。 */
  function suppressClick(event){if(!event.target.closest('.camera-zoom-controls,.overview-camera-expand')&&performance.now()<suppressUntil){event.preventDefault();event.stopImmediatePropagation();}}
  /** 支持画面聚焦后的加减键和复位快捷键。 */
  function onKey(event){if(event.target!==viewport)return;if(['+','=','-','0'].includes(event.key)){event.preventDefault();if(event.key==='0')reset();else zoom(scale+(event.key==='-'?-.5:.5));}}
  toolbar.addEventListener('click',action);viewport.addEventListener('click',suppressClick,true);
  viewport.addEventListener('pointerdown',begin);viewport.addEventListener('pointermove',move,{passive:false});viewport.addEventListener('pointerup',end);viewport.addEventListener('pointercancel',end);viewport.addEventListener('lostpointercapture',end);viewport.addEventListener('keydown',onKey);
  video.addEventListener('play',syncPlayback);video.addEventListener('pause',syncPlayback);
  // 连接和停止播放会切换 hidden，立即同步放大模式的固定播放入口。
  const visibility=new MutationObserver(syncPlayback);visibility.observe(video,{attributes:true,attributeFilter:['hidden']});
  const resize=new ResizeObserver(()=>{baseline();paint();});resize.observe(viewport);
  reset();return {reset,get scale(){return scale;}};
}
