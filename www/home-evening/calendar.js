import {icon} from './icons.js';
import {weatherEscape as escape} from './weather-data.js';
import {CALENDAR_MIN_YEAR,CALENDAR_MAX_YEAR,calendarKey,calendarToday,calendarDate,calendarMonth,calendarMove,calendarLunar,calendarCells} from './calendar-data.js';

/** 创建只读万年历，公历农历即时显示，传统黄历计算按需加载且不请求在线服务。 */
export function createCalendar({getTimeZone}) {
  const host=document.querySelector('#calendar-layer'),trigger=document.querySelector('#calendar-open'),inertStates=new Map();
  const weekdays=['一','二','三','四','五','六','日'];
  let opened=false,selected=null,todayKey='',previousFocus=null,picker=null,almanacModule=null,almanacPending=false,almanacFailed=false;
  let swipe=null,suppressClickUntil=0,wheelAmount=0,lastWheelAt=0,lastWheelMonth=-Infinity;
  let monthAnimations=[],monthMotionId=0;
  /** 返回家庭时区的今天，打开或跨日时刷新今日标记。 */
  function today() {return calendarToday(new Date(),getTimeZone());}
  /** 按需加载已打包的本地黄历计算，首次打开之外不增加页面初始化负担。 */
  async function loadAlmanac() {
    if(almanacModule||almanacPending)return;const retry=almanacFailed;almanacPending=true;almanacFailed=false;
    try {const url=new URL('./calendar-almanac.js',import.meta.url);if(retry)url.searchParams.set('retry',String(Date.now()));almanacModule=await import(url.href);}
    catch(error) {console.error('Calendar almanac loading failed',error);almanacFailed=true;}
    finally {almanacPending=false;if(opened)render();}
  }
  /** 生成年月统一样式的下拉选项，不使用浏览器原生选择器。 */
  function pickerMarkup(field,value,values) {
    const expanded=picker===field,label=field==='year'?'年份':'月份',suffix=field==='year'?'年':'月';
    return `<div class="calendar-picker"><button type="button" class="calendar-picker-trigger" data-calendar-action="toggle-${field}" data-calendar-key="${field}" aria-label="选择${label}" aria-haspopup="listbox" aria-expanded="${expanded}" aria-controls="calendar-${field}-options"><span>${value}${suffix}</span>${icon('arrow')}</button>${expanded?`<div id="calendar-${field}-options" class="calendar-picker-panel" role="listbox" aria-label="${label}">${values.map(item=>`<button type="button" class="calendar-picker-option" role="option" aria-selected="${item===value}" tabindex="-1" data-calendar-action="pick-${field}" data-calendar-value="${item}" data-calendar-key="${field}-${item}">${item}${suffix}</button>`).join('')}</div>`:''}</div>`;
  }
  /** 将宜忌等传统历俗条目渲染为简洁标签，保留来源词语并转义全部文本。 */
  function tags(values) {return values.length?values.map(value=>`<span>${escape(value)}</span>`).join(''):'<span>无</span>';}
  /** 按参考图展示黄历分区，数据缺失时提供明确状态和重试入口。 */
  function almanacMarkup() {
    if(!almanacModule)return `<section class="calendar-almanac" aria-label="传统黄历"><p class="calendar-almanac-status" role="status">${almanacFailed?'黄历信息暂不可用':'正在加载黄历信息…'}</p>${almanacFailed?'<button type="button" data-calendar-action="retry-almanac" data-calendar-key="retry-almanac">重新加载</button>':''}</section>`;
    try {
      const info=almanacModule.calendarAlmanac(selected);
      return `<section class="calendar-almanac" aria-label="传统黄历" data-almanac-date="${info.key}"><div class="calendar-almanac-heading"><h3>${escape(info.lunarLabel)}</h3><span>${escape(info.season)}</span></div><p class="calendar-ganzhi">${escape(info.ganzhi)} · ${escape(info.zodiac)}</p><p class="calendar-phenology">${escape(info.hou)} · ${escape(info.phenology)}${info.festivals.length?' · '+escape(info.festivals.join('、')):''}</p><dl class="calendar-almanac-overview"><div><dt>五行建除</dt><dd>${escape(info.fiveElements)}</dd></div><div><dt>当日冲煞</dt><dd>${escape(info.clash)}</dd></div><div><dt>方位星宿</dt><dd>${escape(info.constellation)}</dd></div></dl><dl class="calendar-directions">${info.directions.map(([label,value])=>`<div><dt>${label}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl><div class="calendar-activities calendar-yi"><strong>宜</strong><div>${tags(info.yi)}</div></div><div class="calendar-activities calendar-ji"><strong>忌</strong><div>${tags(info.ji)}</div></div><dl class="calendar-traditional-details"><div class="calendar-good"><dt>吉神宜趋</dt><dd>${escape(info.auspicious.join('、')||'无')}</dd></div><div class="calendar-bad"><dt>凶煞宜忌</dt><dd>${escape(info.inauspicious.join('、')||'无')}</dd></div><div><dt>彭祖百忌</dt><dd>${escape(info.pengzu)}</dd></div><div><dt>九星</dt><dd>${escape(info.nineStar)}</dd></div><div><dt>胎神占方</dt><dd>${escape(info.fetalPosition)}</dd></div><div><dt>值日天神</dt><dd>${escape(info.dayGod)}</dd></div><div><dt>月相</dt><dd>${escape(info.moonPhase)}</dd></div></dl><p class="calendar-almanac-source">传统黄历 · 按所选公历日期计算 · lunar 1.7.7</p></section>`;
    } catch(error) {console.error('Calendar almanac calculation failed',error);return '<section class="calendar-almanac"><p role="status">当前日期的黄历信息暂不可用</p></section>';}
  }
  /** 生成统一的六周日期网格，供当前月份与滑入预览复用。 */
  function gridMarkup(date) {
    const key=calendarKey(date);
    return `<div class="calendar-grid" role="group" aria-label="${date.year}年${date.month}月月历">${calendarCells(date).map(cell=>{
      const info=calendarLunar(cell),isToday=cell.key===todayKey,isSelected=cell.key===key;
      return `<button type="button" class="calendar-day ${cell.outside?'outside-month':''} ${isToday?'is-today':''}" data-calendar-action="day" data-calendar-date="${cell.key}" data-calendar-key="day-${cell.key}" aria-label="${cell.year}年${cell.month}月${cell.day}日 ${escape(info.label)}${isToday?' 今天':''}" aria-pressed="${isSelected}" ${isToday?'aria-current="date"':''} tabindex="${isSelected?0:-1}" ${cell.disabled?'disabled':''}><strong>${cell.day}</strong><small>${escape(info.short)}</small></button>`;
    }).join('')}</div>`;
  }
  /** 绘制月视图和黄历，保留正文滚动位置及用户当前的键盘焦点。 */
  function render(focusDay=false) {
    if(!opened)return;
    clearMonthMotion();releaseSwipe();
    const focused=host.contains(document.activeElement)?document.activeElement:null,focusKey=focused?.dataset.calendarKey;
    const scroll=host.querySelector('.calendar-body')?.scrollTop||0,pickerScroll=host.querySelector('.calendar-picker-panel')?.scrollTop||0;
    const current=today(),key=calendarKey(selected),lunar=calendarLunar(selected);todayKey=calendarKey(current);
    const weekday=new Intl.DateTimeFormat('zh-CN',{weekday:'long',timeZone:'Asia/Shanghai'}).format(calendarDate(selected));
    const atStart=selected.year===CALENDAR_MIN_YEAR&&selected.month===1,atEnd=selected.year===CALENDAR_MAX_YEAR&&selected.month===12;
    host.innerHTML=`<button type="button" class="calendar-scrim" data-calendar-action="close" aria-label="关闭万年历遮罩" tabindex="-1"></button><section class="calendar-dialog" role="dialog" aria-modal="true" aria-labelledby="calendar-title"><header><div><small>公历 · 农历 · 传统黄历</small><h2 id="calendar-title">万年历</h2></div><button type="button" class="calendar-close" data-calendar-action="close" data-calendar-key="close" aria-label="关闭万年历">${icon('close')}</button></header><div class="calendar-body"><div class="calendar-month-view"><div class="calendar-toolbar"><button type="button" class="calendar-previous" data-calendar-action="previous" data-calendar-key="previous" aria-label="上个月" ${atStart?'disabled':''}>${icon('arrow')}</button>${pickerMarkup('year',selected.year,Array.from({length:CALENDAR_MAX_YEAR-CALENDAR_MIN_YEAR+1},(_,index)=>CALENDAR_MIN_YEAR+index))}${pickerMarkup('month',selected.month,Array.from({length:12},(_,index)=>index+1))}<button type="button" data-calendar-action="next" data-calendar-key="next" aria-label="下个月" ${atEnd?'disabled':''}>${icon('arrow')}</button><button type="button" class="calendar-today" data-calendar-action="today" data-calendar-key="today">回到今天</button></div><div class="calendar-weekdays">${weekdays.map(day=>`<span>周${day}</span>`).join('')}</div><div class="calendar-month-viewport">${gridMarkup(selected)}</div></div><aside class="calendar-date-detail" aria-label="所选日期详情" aria-live="polite"><div class="calendar-selected-summary"><strong class="calendar-selected-day">${selected.day}</strong><div><p class="calendar-date-caption">${selected.year}年${selected.month}月${key===todayKey?' · 今天':''}</p><p class="calendar-selected-weekday">${weekday}</p><p class="calendar-selected-lunar">${escape(lunar.label)} · ${escape(lunar.zodiac)}</p></div></div>${almanacMarkup()}</aside></div></section>`;
    host.querySelector('.calendar-body').scrollTop=scroll;const panel=host.querySelector('.calendar-picker-panel');if(panel)panel.scrollTop=pickerScroll;
    const target=focusDay?host.querySelector(`[data-calendar-date="${key}"]`):focusKey?[...host.querySelectorAll('[data-calendar-key]')].find(el=>el.dataset.calendarKey===focusKey):null;
    (target&&!target.disabled?target:focusKey?host.querySelector(`[data-calendar-date="${key}"]`):null)?.focus({preventScroll:true});
  }
  /** 展开统一年月选择器，将当前项定位在面板中间，不滚动整个弹窗。 */
  function showPicker(field) {
    picker=picker===field?null:field;render();
    const panel=host.querySelector('.calendar-picker-panel'),option=panel?.querySelector('[aria-selected="true"]');
    if(option){panel.scrollTop=Math.max(0,option.offsetTop-panel.clientHeight/2+option.offsetHeight/2);option.focus({preventScroll:true});}
    else host.querySelector(`[data-calendar-key="${field}"]`)?.focus({preventScroll:true});
  }
  /** 打开万年历并选中今天，隔离背景模型与设备操作，按需读取本地黄历模块。 */
  function open(event) {
    event?.preventDefault();event?.stopPropagation();if(opened)return;
    try {
      selected=today();picker=null;previousFocus=document.activeElement;opened=true;
      for(const child of document.querySelector('#screen').children)if(child!==host&&child.id!=='standby'){inertStates.set(child,child.inert);child.inert=true;}
      render();host.hidden=false;trigger.setAttribute('aria-expanded','true');host.querySelector('[data-calendar-key="close"]').focus();loadAlmanac();
    } catch(error) {console.error('Evening calendar opening failed',error);close();}
  }
  /** 关闭万年历并返回日期入口，不改变房间、设备和模型状态。 */
  function close() {
    if(!opened)return;opened=false;picker=null;host.hidden=true;trigger.setAttribute('aria-expanded','false');
    releaseSwipe();clearMonthMotion();wheelAmount=0;lastWheelAt=0;lastWheelMonth=-Infinity;suppressClickUntil=0;
    for(const [child,inert] of inertStates)child.inert=inert;inertStates.clear();
    (previousFocus?.isConnected?previousFocus:trigger)?.focus({preventScroll:true});
  }
  /** 处理自定义年月选择、日期切换和回到今天，仅修改日历查看状态。 */
  function onClick(event) {
    if(!opened)return;
    // 拖动结束产生的兼容点击不能误选日期，键盘激活仍正常处理。
    if(event.detail>0&&performance.now()<suppressClickUntil&&(event.target===host||event.target.closest('.calendar-grid'))){event.preventDefault();event.stopPropagation();suppressClickUntil=0;return;}
    const button=event.target.closest('button[data-calendar-action]');
    if(!button){if(picker&&!event.target.closest('.calendar-picker')){picker=null;render();}return;}
    if(button.disabled)return;event.preventDefault();event.stopPropagation();
    try {
      const action=button.dataset.calendarAction;
      if(action==='close'){close();return;}
      if(action==='toggle-year'||action==='toggle-month'){showPicker(action.slice(7));return;}
      if(action==='retry-almanac'){loadAlmanac();return;}
      if(action==='pick-year'||action==='pick-month'){
        const field=action.slice(5),value=Number(button.dataset.calendarValue);selected=calendarMonth(selected,0,field==='year'?value:selected.year,field==='month'?value:selected.month);picker=null;render();host.querySelector(`[data-calendar-key="${field}"]`).focus({preventScroll:true});return;
      }
      picker=null;
      if(action==='today')selected=today();
      else if(action==='previous'||action==='next'){changeMonth(action==='previous'?-1:1,'x',0,false);return;}
      else if(action==='day'){const [year,month,day]=button.dataset.calendarDate.split('-').map(Number);selected={year,month,day};}
      render(action==='day');
    } catch(error) {console.error('Evening calendar navigation failed',error);}
  }
  /** 返回对话框内可参与 Tab 导航的可见控件，排除下拉列表的程序焦点项。 */
  function focusControls() {return [...host.querySelectorAll('.calendar-dialog button:not(:disabled)')].filter(el=>el.tabIndex>=0&&el.getClientRects().length);}
  /** 支持下拉选项方向键、两级 Escape 和日期方向键，并限制弹窗键盘焦点。 */
  function onKey(event) {
    if(!opened||!document.querySelector('#standby').hidden)return;
    if(event.key==='Escape'){
      event.preventDefault();event.stopImmediatePropagation();
      if(picker){const field=picker;picker=null;render();host.querySelector(`[data-calendar-key="${field}"]`).focus({preventScroll:true});}else close();return;
    }
    if(picker&&event.target.matches('.calendar-picker-option')){
      const options=[...host.querySelectorAll('.calendar-picker-option')],index=options.indexOf(event.target),delta={ArrowLeft:-1,ArrowRight:1,ArrowUp:-3,ArrowDown:3}[event.key];
      if(delta||event.key==='Home'||event.key==='End'){
        event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?options.length-1:Math.max(0,Math.min(options.length-1,index+delta));const panel=host.querySelector('.calendar-picker-panel'),option=options[next];
        if(option.offsetTop<panel.scrollTop)panel.scrollTop=option.offsetTop;else if(option.offsetTop+option.offsetHeight>panel.scrollTop+panel.clientHeight)panel.scrollTop=option.offsetTop+option.offsetHeight-panel.clientHeight;
        option.focus({preventScroll:true});return;
      }
      if(event.key==='Tab'){event.preventDefault();const field=picker;picker=null;render();const controls=focusControls(),at=controls.findIndex(el=>el.dataset.calendarKey===field);controls[(at+(event.shiftKey?-1:1)+controls.length)%controls.length]?.focus({preventScroll:true});return;}
    }
    if(!picker&&['ArrowDown','ArrowUp'].includes(event.key)&&event.target.matches('.calendar-picker-trigger')){event.preventDefault();showPicker(event.target.dataset.calendarKey);return;}
    const delta={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[event.key];
    if(delta&&event.target.matches('[data-calendar-date]')){event.preventDefault();event.stopPropagation();selected=calendarMove(selected,delta);render(true);return;}
    if(event.key!=='Tab')return;
    const controls=focusControls(),first=controls[0],last=controls.at(-1);
    if(!host.querySelector('.calendar-dialog').contains(document.activeElement)){event.preventDefault();first?.focus();}
    else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  }
  /** 家庭午夜跨日时更新今日标记，保留用户查看的日期及已展开的年月面板。 */
  function refresh() {if(opened&&calendarKey(today())!==todayKey)render();}
  /** 清理翻月动画与仅供视觉展示的副本，连续操作直接从当前月份开始。 */
  function clearMonthMotion() {
    monthMotionId++;
    for(const animation of monthAnimations)animation.cancel();monthAnimations=[];
    host.querySelectorAll('.calendar-preview').forEach(grid=>grid.remove());
    const grid=host.querySelector('.calendar-grid');if(grid)grid.style.transform='';
    host.querySelector('.calendar-month-viewport')?.classList.remove('is-sliding');
  }
  /** 将预览网格从可访问树、焦点与日期操作中排除，避免重复控件被激活。 */
  function previewGrid(date,source=null) {
    const template=document.createElement('template');template.innerHTML=gridMarkup(date);
    const grid=source?source.cloneNode(true):template.content.firstElementChild;
    grid.classList.add('calendar-preview');grid.inert=true;grid.setAttribute('aria-hidden','true');grid.removeAttribute('role');grid.removeAttribute('aria-label');
    for(const button of grid.querySelectorAll('button')){
      button.tabIndex=-1;button.removeAttribute('data-calendar-key');button.removeAttribute('data-calendar-date');button.removeAttribute('data-calendar-action');
    }
    return grid;
  }
  /** 按锁定的手势方向移动网格，只使用合成位移而不改变布局尺寸。 */
  function monthTransform(axis,value) {return axis==='x'?`translate3d(${value}px,0,0)`:`translate3d(0,${value}px,0)`;}
  /** 尊重全局动画偏好与系统减少动态效果设置。 */
  function monthMotionAllowed() {return document.querySelector('#screen').dataset.motion!=='false'&&!matchMedia('(prefers-reduced-motion: reduce)').matches&&typeof Element.prototype.animate==='function';}
  /** 同步播放前后月份的滑移动画，完成后移除副本与临时合成层。 */
  function slideGrids(grid,preview,axis,from,to,previewFrom,previewTo) {
    if(!monthMotionAllowed()){clearMonthMotion();return;}
    const viewport=grid.parentElement,id=monthMotionId;
    viewport.classList.add('is-sliding');
    const options={duration:280,easing:'cubic-bezier(.22,.72,.2,1)',fill:'both'};
    monthAnimations=[grid.animate([{transform:monthTransform(axis,from)},{transform:monthTransform(axis,to)}],options)];
    if(preview)monthAnimations.push(preview.animate([{transform:monthTransform(axis,previewFrom)},{transform:monthTransform(axis,previewTo)}],options));
    Promise.all(monthAnimations.map(animation=>animation.finished.catch(()=>{}))).then(()=>{if(id===monthMotionId)clearMonthMotion();});
  }
  /** 取消或短距离拖动时平滑回到原位，不更新所选日期。 */
  function settleSwipe(active) {
    const grid=host.querySelector('.calendar-grid:not(.calendar-preview)');if(!grid)return;
    const preview=host.querySelector('.calendar-preview'),distance=active.axis==='x'?grid.offsetWidth:grid.offsetHeight;
    const side=active.offset<0?1:-1;
    slideGrids(grid,preview,active.axis,active.offset||0,0,side*distance+(active.offset||0),side*distance);
  }
  /** 提交月份后让旧网格沿手势方向移出、新网格同时移入，黄历与选中日期只更新一次。 */
  function changeMonth(delta,axis='x',offset=0,focusDay=true) {
    const next=calendarMonth(selected,delta);
    if(next.year===selected.year&&next.month===selected.month)return false;
    const grid=host.querySelector('.calendar-grid:not(.calendar-preview)'),outgoing=previewGrid(selected,grid);
    selected=next;render(focusDay);
    if(!monthMotionAllowed())return true;
    const incoming=host.querySelector('.calendar-grid'),distance=axis==='x'?incoming.offsetWidth:incoming.offsetHeight;
    incoming.parentElement.append(outgoing);
    slideGrids(incoming,outgoing,axis,offset+delta*distance,0,offset,-delta*distance);
    return true;
  }
  /** 释放当前指针捕获，将手势状态交给提交或回弹流程。 */
  function releaseSwipe() {
    const active=swipe;swipe=null;
    if(active&&host.hasPointerCapture(active.id))host.releasePointerCapture(active.id);
    return active;
  }
  /** 释放未完成的手势，取消时恢复当前月份而不执行翻月。 */
  function cancelSwipe() {
    const active=releaseSwipe();if(active?.dragging)settleSwipe(active);
  }
  /** 只在月历日期网格记录单指或鼠标主键拖动，年月选择和黄历正文保留原操作。 */
  function onPointerDown(event) {
    if(!opened||picker||event.button!==0)return;
    if(!event.isPrimary){cancelSwipe();return;}
    const grid=event.target.closest('.calendar-month-viewport')?.querySelector('.calendar-grid:not(.calendar-preview)');if(!grid)return;
    clearMonthMotion();
    const rect=grid.getBoundingClientRect();
    swipe={id:event.pointerId,x:event.clientX,y:event.clientY,dragging:false,axis:null,offset:0,scale:rect.width/grid.offsetWidth,previewDirection:0,threshold:Math.max(24,Math.min(48,Math.min(rect.width,rect.height)*.15))};
  }
  /** 超过轻微抖动后捕获拖动，防止指针离开网格时丢失手势。 */
  function onPointerMove(event) {
    if(!swipe||event.pointerId!==swipe.id)return;
    const dx=event.clientX-swipe.x,dy=event.clientY-swipe.y;
    if(Math.hypot(dx,dy)>8&&!swipe.dragging){swipe.dragging=true;swipe.axis=Math.abs(dx)>=Math.abs(dy)?'x':'y';host.setPointerCapture(event.pointerId);}
    if(!swipe.dragging)return;
    if(event.cancelable)event.preventDefault();
    const grid=host.querySelector('.calendar-grid:not(.calendar-preview)'),axis=swipe.axis,distance=axis==='x'?grid.offsetWidth:grid.offsetHeight;
    const raw=(axis==='x'?dx:dy)/swipe.scale,direction=raw<0?1:-1,next=calendarMonth(selected,direction),bounded=next.year===selected.year&&next.month===selected.month;
    swipe.offset=Math.max(-distance,Math.min(distance,raw))*(bounded?0.18:1);
    if(swipe.previewDirection!==direction){
      host.querySelector('.calendar-preview')?.remove();swipe.previewDirection=direction;
      if(!bounded)grid.parentElement.append(previewGrid(next));
    }
    grid.parentElement.classList.add('is-sliding');grid.style.transform=monthTransform(axis,swipe.offset);
    const preview=host.querySelector('.calendar-preview');if(preview)preview.style.transform=monthTransform(axis,direction*distance+swipe.offset);
  }
  /** 向左或向上查看下月，向右或向下查看上月，月末日期和年份边界沿用原规则。 */
  function onPointerUp(event) {
    if(!swipe||event.pointerId!==swipe.id)return;
    const active=swipe,dx=event.clientX-active.x,dy=event.clientY-active.y;
    releaseSwipe();if(!active.dragging)return;
    suppressClickUntil=performance.now()+350;
    const delta=active.axis==='x'?dx:dy;
    if(Math.abs(delta)<active.threshold){settleSwipe(active);return;}
    try {if(!changeMonth(delta<0?1:-1,active.axis,active.offset))settleSwipe(active);}
    catch(error){console.error('Calendar swipe navigation failed',error);}
  }
  /** 月历网格支持滚轮或触控板翻月，黄历详情区域继续正常上下滚动。 */
  function onWheel(event) {
    if(!opened||picker||event.ctrlKey||!event.target.closest('.calendar-grid'))return;
    event.preventDefault();event.stopPropagation();
    const axis=Math.abs(event.deltaX)>Math.abs(event.deltaY)?'x':'y',now=performance.now(),delta=(axis==='x'?event.deltaX:event.deltaY)*(event.deltaMode===1?16:event.deltaMode===2?400:1);
    if(now-lastWheelAt>200||Math.sign(delta)!==Math.sign(wheelAmount))wheelAmount=0;
    lastWheelAt=now;
    if(now-lastWheelMonth<400)return;
    wheelAmount+=delta;if(Math.abs(wheelAmount)<60)return;
    try {changeMonth(wheelAmount>0?1:-1,axis);wheelAmount=0;lastWheelMonth=now;}
    catch(error){console.error('Calendar wheel navigation failed',error);}
  }
  trigger.addEventListener('click',open);host.addEventListener('click',onClick);document.addEventListener('keydown',onKey,true);
  host.addEventListener('pointerdown',onPointerDown);host.addEventListener('pointermove',onPointerMove,{passive:false});host.addEventListener('pointerup',onPointerUp);
  host.addEventListener('pointercancel',cancelSwipe);host.addEventListener('lostpointercapture',event=>{if(event.target===host)cancelSwipe();});host.addEventListener('wheel',onWheel,{passive:false});
  return {close,refresh};
}
