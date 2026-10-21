import {createVisiblePoll} from './runtime.js';
import {ambientIndex} from './ambient.js';
import {PREFERENCE_KEY,loadPreferences,normalizePreferences,resolveTheme} from './preferences.js';

/** 创建即时保存的显示设置侧面板和本地屏保，不调用设备服务。 */
export function createSettings({icon,onChange}) {
  let preferences=loadPreferences(),resolved='dark',opened=false,previousFocus,lastActivity=Date.now(),sleeping=false,sunState,wakeClickPending=false,standbyMinute=-1;
  const screen=document.querySelector('#screen'),host=document.querySelector('#settings-layer'),saver=document.querySelector('#standby');
  /** 只读当前同源 HA 外壳已有的太阳状态；独立预览不伪造日出日落。 */
  function readSun() {
    try{return window.parent!==window?window.parent.document.querySelector('home-assistant')?.hass?.states?.['sun.sun']?.state:undefined;}
    catch(error){console.warn('Evening sun state is unavailable',error);return undefined;}
  }
  /** 应用主题和动效偏好，并同步模型和当前设置说明。 */
  function apply() {
    sunState=readSun();resolved=resolveTheme(preferences.theme,sunState,resolved);
    document.documentElement.dataset.theme=resolved;screen.dataset.theme=resolved;
    // 整点轮换背景；序号未变时不重复写入。
    const ambient=String(ambientIndex(Date.now(),3));
    if(screen.dataset.ambient!==ambient)screen.dataset.ambient=ambient;
    screen.dataset.motion=String(preferences.motion);
    onChange?.({...preferences,resolvedTheme:resolved});
    const help=host.querySelector('#theme-help');
    if(help)help.textContent=preferences.theme==='auto'?(['above_horizon','below_horizon'].includes(sunState)?`跟随家庭太阳状态 · 当前${resolved==='light'?'浅色':'深色'}`:'日出日落状态暂不可用，保留当前外观'):'修改立即生效，保存在当前浏览器';
  }
  /** 生成面板中的分段选择按钮。 */
  function options(key,items) {
    return `<div class="setting-options" role="group" aria-label="${{theme:'界面主题',houseMode:'房屋显示方式',view:'默认视角',markerKind:'默认图标分类',applianceColumns:'家电卡片每行数量'}[key]}">${items.map(([value,label])=>`<button type="button" data-preference="${key}" data-value="${value}" aria-pressed="${preferences[key]===value}">${label}</button>`).join('')}</div>`;
  }
  /** 生成独立、可键盘操作的设置开关。 */
  function switchRow(key,label,detail) {
    return `<div class="setting-row"><div><strong>${label}</strong><small>${detail}</small></div><button type="button" class="toggle" role="switch" aria-label="${label}" aria-checked="${preferences[key]}" data-preference="${key}"></button></div>`;
  }
  /** 渲染侧面板内容，保留当前滚动位置与键盘焦点。 */
  function render() {
    const scroll=host.querySelector('.settings-body')?.scrollTop||0,focused=host.contains(document.activeElement)?document.activeElement:null;
    const focusKey=focused?.dataset.preference,focusValue=focused?.dataset.value,focusIdle=focused?.matches('[data-idle]'),focusRoomIdle=focused?.matches('[data-room-idle]');
    host.innerHTML=`<button class="settings-scrim" type="button" aria-label="关闭显示设置" data-settings-close></button><aside class="settings-drawer" role="dialog" aria-modal="true" aria-labelledby="settings-title"><header><div><span class="settings-eyebrow">让家，更合心意</span><h2 id="settings-title">显示设置</h2></div><button class="circle-button" type="button" aria-label="收起显示设置" data-settings-close>${icon('close')}</button></header><div class="settings-body"><section><h3>${icon('moon')}界面外观</h3>${options('theme',[['dark','深色'],['light','浅色'],['auto','跟随日出日落']])}<p id="theme-help" class="settings-help" role="status"></p></section><section><h3>${icon('appliance')}家电布局</h3>${options('applianceColumns',[[2,'每行 2 个'],[3,'每行 3 个'],[4,'每行 4 个']])}<p class="settings-help">立即调整卡片大小，刷新后保留布局</p></section><section><h3>${icon('cube')}房屋显示</h3>${options('houseMode',[['2d','2D 平面图'],['3d','3D 模型']])}<p class="settings-help">默认使用俯视平面图，切换为 3D 后可旋转查看</p><div data-model-only ${preferences.houseMode==='2d'?'hidden':''}>${switchRow('rotation','允许 3D 模型旋转','关闭后固定所选视角，图标仍可操作')}${switchRow('zoom','允许 3D 模型缩放','允许双指或滚轮调整大小')}<div class="setting-label">默认视角</div>${options('view',[['top','俯视'],['angled','45°斜视']])}</div>${switchRow('markers','显示设备图标','灯光、空调、新风和地暖标注')}<div class="setting-label">默认图标分类</div>${options('markerKind',[['all','全部'],['lights','灯光'],['ac','空调'],['fresh','新风'],['floor','地暖']])}${switchRow('autoOpenRoomInfo','是否自动打开房间信息','关闭后点击房屋图标只操作设备，不展开房间信息')}<label class="setting-row"><div><strong>房间信息自动收起</strong><small>无操作后收起，0 表示不自动收起</small></div><span class="idle-value"><input aria-label="房间信息自动收起时间" type="number" min="0" max="300" step="1" inputmode="numeric" data-room-idle value="${preferences.roomPanelSeconds}"><span>秒</span></span></label></section><section><h3>${icon('moon')}动效与屏保</h3>${switchRow('motion','界面动画','减少动画可让页面更加安静')}<label class="setting-row"><div><strong>进入屏保时间</strong><small>按最后一次操作计时，0 表示关闭</small></div><span class="idle-value"><input aria-label="进入屏保时间" type="number" min="0" max="120" step="1" inputmode="numeric" data-idle value="${preferences.idleMinutes}"><span>分钟</span></span></label><button type="button" class="settings-preview" data-standby-preview>预览屏保${icon('arrow')}</button></section><p class="settings-help settings-footnote">设置仅保存在当前浏览器 · 设备控制仍为模拟</p></div></aside>`;
    host.querySelector('.settings-body').scrollTop=scroll;
    if(focusKey)host.querySelector(`[data-preference="${focusKey}"]${focusValue?`[data-value="${focusValue}"]`:''}`)?.focus({preventScroll:true});
    if(focusIdle)host.querySelector('[data-idle]')?.focus({preventScroll:true});
    if(focusRoomIdle)host.querySelector('[data-room-idle]')?.focus({preventScroll:true});
  }
  /** 原位同步设置控件，保留面板节点、滚动位置和焦点，避免重复播放入场动画。 */
  function syncControls() {
    for(const control of host.querySelectorAll('[data-preference]')) {
      const key=control.dataset.preference;
      if(control.hasAttribute('data-value'))control.setAttribute('aria-pressed',String(preferences[key]=== (key==='applianceColumns'?Number(control.dataset.value):control.dataset.value)));
      else control.setAttribute('aria-checked',String(preferences[key]));
    }
    const modelOnly=host.querySelector('[data-model-only]');if(modelOnly)modelOnly.hidden=preferences.houseMode==='2d';
    const idle=host.querySelector('[data-idle]');
    if(idle){idle.value=String(preferences.idleMinutes);idle.removeAttribute('aria-invalid');}
    const roomIdle=host.querySelector('[data-room-idle]');
    if(roomIdle){roomIdle.value=String(preferences.roomPanelSeconds);roomIdle.removeAttribute('aria-invalid');}
  }
  /** 保存单个显示偏好并立即应用，不提交任何设备指令。 */
  function save(key,value) {
    if(key==='applianceColumns')value=Number(value);
    preferences=normalizePreferences({...preferences,[key]:value});
    try{localStorage.setItem(PREFERENCE_KEY,JSON.stringify(preferences));}
    catch(error){console.error('Evening preferences saving failed',error);}
    lastActivity=Date.now();syncControls();apply();
  }
  /** 打开设置并将键盘焦点移入对话框。 */
  function open() {previousFocus=document.activeElement;opened=true;lastActivity=Date.now();render();host.hidden=false;apply();host.querySelector('.settings-drawer [data-settings-close]')?.focus();}
  /** 收起设置并恢复触发按钮的焦点。 */
  function close() {opened=false;host.hidden=true;lastActivity=Date.now();(previousFocus?.isConnected&&previousFocus.getClientRects().length?previousFocus:document.querySelector('#nav-handle'))?.focus();}
  /** 展示简洁的时钟屏保，唤醒操作不能穿透控制设备。 */
  function showStandby() {if(opened)close();sleeping=true;saver.hidden=false;tick();saver.focus();}
  /** 更新屏保时间并检查空闲时间，太阳状态轮询不重置计时。 */
  function tick() {
    if(sleeping){const minute=Math.floor(Date.now()/60000);if(minute===standbyMinute)return;standbyMinute=minute;const now=new Date();saver.querySelector('time').textContent=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false}).format(now);saver.querySelector('.standby-date').textContent=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'long',day:'numeric',weekday:'long'}).format(now);}
    else if(!opened&&preferences.idleMinutes>0&&Date.now()-lastActivity>=preferences.idleMinutes*60000)showStandby();
  }
  /** 捕获真实交互并拦截屏保唤醒的整次点击。 */
  function onActivity(event) {
    lastActivity=Date.now();
    if(!sleeping&&wakeClickPending&&event.type==='pointerdown')wakeClickPending=false;
    if(!sleeping&&wakeClickPending&&event.type==='click'){event.preventDefault();event.stopImmediatePropagation();wakeClickPending=false;return;}
    if(sleeping){event.preventDefault();event.stopImmediatePropagation();if(['pointerup','touchend','click','keydown'].includes(event.type)){sleeping=false;wakeClickPending=event.type!=='click';setTimeout(()=>{wakeClickPending=false;},600);saver.hidden=true;document.querySelector('#nav-handle')?.focus();}}
  }
  /** 限制设置对话框内的键盘焦点，并支持 Escape 关闭。 */
  function onKey(event) {
    if(!opened)return;
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close();return;}
    if(event.key==='Tab'){const drawer=host.querySelector('.settings-drawer'),list=[...drawer.querySelectorAll('button,input')].filter(item=>!item.disabled);const first=list[0],last=list.at(-1);if(!drawer.contains(document.activeElement)){event.preventDefault();first.focus();}else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
  }
  host.addEventListener('click',event=>{const target=event.target.closest('button');if(!target)return;if(target.hasAttribute('data-settings-close'))close();else if(target.hasAttribute('data-standby-preview'))showStandby();else if(target.dataset.preference){const key=target.dataset.preference;save(key,target.dataset.value??!preferences[key]);}});
  // 两个空闲时间控件独立校验并原位保存，避免重建设置面板。
  host.addEventListener('change',event=>{
    const target=event.target;if(!target.matches('[data-idle],[data-room-idle]'))return;
    const key=target.matches('[data-room-idle]')?'roomPanelSeconds':'idleMinutes',maximum=key==='roomPanelSeconds'?300:120,value=target.valueAsNumber;
    if(!Number.isInteger(value)||value<0||value>maximum){target.value=preferences[key];target.setAttribute('aria-invalid','true');return;}
    save(key,value);
  });
  for(const type of ['pointerdown','pointerup','click','keydown','wheel','touchstart','touchend'])document.addEventListener(type,onActivity,{capture:true,passive:false});
  document.addEventListener('keydown',onKey,true);
  window.addEventListener('message',event=>{if(event.origin===location.origin&&event.source===document.querySelector('#model').contentWindow&&event.data?.channel==='ha-evening-model'&&event.data.type==='activity')lastActivity=Date.now();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){lastActivity=Date.now();apply();}});
  window.addEventListener('storage',event=>{if(event.key===PREFERENCE_KEY){preferences=loadPreferences();if(opened)syncControls();apply();}});
  createVisiblePoll(tick,1000).start({immediate:false});
  createVisiblePoll(()=>{if(readSun()!==sunState||String(ambientIndex(Date.now(),3))!==screen.dataset.ambient)apply();},10000).start({immediate:false});
  return {open,close,apply,get preferences(){return {...preferences};},get theme(){return resolved;}};
}
