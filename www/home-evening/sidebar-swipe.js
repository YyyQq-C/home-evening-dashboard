/** 识别 sidebar 内完成的竖向滑动，短距离、横向拖动和长按不切换页签。 */
export function sidebarSwipeStep(dx,dy,duration){
  if(duration>1200||Math.abs(dy)<36||Math.abs(dy)<Math.abs(dx)*1.25)return 0;
  return dy<0?1:-1;
}

/** 只接管从 sidebar 开始的单指手势，不干扰页面内的日历和内容滚动。 */
export function bindSidebarSwipe(sidebar,{onStep,onActivity}){
  let gesture=null,suppressUntil=0;

  /** 丢弃取消、失焦或多指操作，避免恢复后沿用旧手势。 */
  function cancel(){gesture=null;}

  /** 记录初始位置，保留未拖动时的按钮点击与键盘操作。 */
  function begin(event){
    if(!event.isPrimary||event.button!==0){cancel();return;}
    suppressUntil=0;
    gesture={id:event.pointerId,x:event.clientX,y:event.clientY,time:performance.now(),dragged:false};
    onActivity();
  }

  /** 超过轻点容差后捕获指针，防止松手位置触发另一个导航按钮。 */
  function move(event){
    if(!gesture||event.pointerId!==gesture.id)return;
    if(Math.hypot(event.clientX-gesture.x,event.clientY-gesture.y)>10){
      if(!gesture.dragged){
        gesture.dragged=true;
        try{sidebar.setPointerCapture(event.pointerId);}catch(error){console.warn('Sidebar pointer capture unavailable');}
      }
      suppressUntil=performance.now()+700;
      onActivity();
    }
  }

  /** 每次松手最多切换一页，首尾边界交由导航顺序处理。 */
  function end(event){
    if(!gesture||event.pointerId!==gesture.id)return;
    const active=gesture;gesture=null;
    if(active.dragged)suppressUntil=performance.now()+700;
    const step=sidebarSwipeStep(event.clientX-active.x,event.clientY-active.y,performance.now()-active.time);
    if(step){
      suppressUntil=performance.now()+700;
      try{onStep(step);}catch(error){console.error('Sidebar page swipe failed',error);}
    }
  }

  /** 拦截拖动后的兼容点击，普通轻点和键盘激活仍走原有导航逻辑。 */
  function suppressClick(event){
    if(event.detail!==0&&performance.now()<suppressUntil){event.preventDefault();event.stopImmediatePropagation();}
  }

  sidebar.addEventListener('pointerdown',begin);
  window.addEventListener('pointerdown',event=>{if(!event.isPrimary)cancel();},{capture:true});
  window.addEventListener('pointermove',move,{passive:true});
  window.addEventListener('pointerup',end);
  window.addEventListener('pointercancel',cancel);
  window.addEventListener('blur',cancel);
  window.addEventListener('pagehide',cancel);
  sidebar.addEventListener('click',suppressClick,{capture:true});
}
