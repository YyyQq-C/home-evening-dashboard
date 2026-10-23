import {SITE} from './site-config.js';
// 仅接入当前 HA 已核对的面板控制实体，不按相似名称控制其他设备。
export const PAD_OPERATIONS=[
  {key:'reload',group:'快捷操作',label:'刷新页面',domain:'button',suffix:'li_ji_shua_xin'},
  {key:'home',group:'快捷操作',label:'回到首页',domain:'button',suffix:'hui_dao_shou_ye'},
  {key:'wake',group:'快捷操作',label:'唤醒屏幕',domain:'button',suffix:'huan_xing_ping_mu'},
  {key:'screenOff',group:'快捷操作',label:'熄屏',domain:'button',suffix:'xi_ping'},
  {key:'screenshot',group:'快捷操作',label:'屏幕截图',domain:'button',suffix:'ping_mu_jie_tu'},
  {key:'brightness',group:'屏幕与音量',label:'观看亮度',domain:'number',suffix:'she_zhi_liang_du',min:1,max:100,unit:'%'},
  {key:'volume',group:'屏幕与音量',label:'媒体音量',domain:'number',suffix:'mei_ti_yin_liang',min:0,max:100,unit:'%'},
  {key:'standbyBrightness',group:'屏幕与音量',label:'待机亮度',domain:'number',suffix:'dai_ji_liang_du',min:0,max:100,unit:'%'},
  {key:'dimDelay',group:'屏幕与音量',label:'无人后降低亮度',domain:'number',suffix:'wu_ren_hou_jiang_liang_du',min:0,max:86400,unit:'秒'},
  {key:'motion',group:'屏幕与音量',label:'人体检测',domain:'switch',suffix:'ren_ti_jian_ce'},
  {key:'lock',group:'屏幕与音量',label:'锁定模式',domain:'switch',suffix:'suo_ding_mo_shi'},
  {key:'schedule',group:'自动亮度',label:'按时间切换亮度',domain:'switch',suffix:'an_shi_jian_qie_huan_liang_du'},
  {key:'day',group:'自动亮度',label:'白天亮度',domain:'number',suffix:'bai_tian_liang_du',min:1,max:100,unit:'%'},
  {key:'night',group:'自动亮度',label:'夜间亮度',domain:'number',suffix:'ye_jian_liang_du',min:1,max:100,unit:'%'},
  {key:'daily',group:'定时刷新',label:'每天刷新页面',domain:'switch',suffix:'mei_tian_shua_xin'},
  {key:'dailyHour',group:'定时刷新',label:'刷新时间：小时',domain:'number',suffix:'mei_tian_shua_xin_de_xiao_shi',min:0,max:23,unit:'时'},
  {key:'dailyMinute',group:'定时刷新',label:'刷新时间：分钟',domain:'number',suffix:'mei_tian_shua_xin_de_fen_zhong',min:0,max:59,unit:'分'},
  {key:'watchdog',group:'定时刷新',label:'页面看门狗',domain:'number',suffix:'ye_mian_kan_men_gou',min:0,max:3600,unit:'秒'},
  {key:'sleep',group:'夜间熄屏',label:'夜间熄屏',domain:'switch',suffix:'ye_jian_xi_ping'},
  {key:'sleepStart',group:'夜间熄屏',label:'熄屏开始',domain:'number',suffix:'xi_ping_kai_shi',min:0,max:23,unit:'时'},
  {key:'sleepEnd',group:'夜间熄屏',label:'熄屏结束',domain:'number',suffix:'xi_ping_jie_shu',min:0,max:23,unit:'时'},
  {key:'notify',group:'通知与语音',label:'画面通知',domain:'text',suffix:'hua_mian_tong_zhi'},
  {key:'speak',group:'通知与语音',label:'语音播报',domain:'text',suffix:'yu_yin_bo_bao'}
].map(item=>({...item,id:SITE.pad?.entities?.[item.key]||''}));

/** 按实体类型判断可用性；按钮从未按过、文本从未发送时允许 unknown 状态。 */
export function padControlAvailable(hass,item){
  if(!item.id||!new RegExp('^'+item.domain+'\\.[a-z0-9_]+$').test(item.id))return false;
  const state=hass?.states?.[item.id]?.state;
  return !!hass&&hass.connected!==false&&state!==undefined&&state!=='unavailable'&&(['button','text'].includes(item.domain)||!['unknown',''].includes(state));
}

/** 校验已知操作及实体状态，构造经过白名单限制的 HA 服务调用。 */
export function padCommand(hass,key,value){
  if(SITE.pad?.mode!=='live')throw new Error('Pad control is read-only');
  const item=PAD_OPERATIONS.find(item=>item.key===key);
  if(!item)throw new Error('Unknown Pad operation');
  const entity=hass?.states?.[item.id];
  if(!padControlAvailable(hass,item))throw new Error('Pad control unavailable');
  const data={entity_id:item.id};let service;
  if(item.domain==='button')service='press';
  else if(item.domain==='switch'){
    if(!['on','off'].includes(entity.state))throw new Error('Invalid Pad switch state');
    service=entity.state==='on'?'turn_off':'turn_on';
  }else if(item.domain==='number'){
    const number=typeof value==='string'&&value.trim()!==''?Number(value):typeof value==='number'?value:NaN;
    const min=Math.max(item.min,Number.isFinite(entity.attributes?.min)?entity.attributes.min:item.min);
    const max=Math.min(item.max,Number.isFinite(entity.attributes?.max)?entity.attributes.max:item.max);
    if(!Number.isInteger(number)||number<min||number>max)throw new Error('Invalid Pad number');
    data.value=number;service='set_value';
  }else{
    if(typeof value!=='string'||!value.trim()||value.trim().length>200)throw new Error('Invalid Pad text');
    data.value=value.trim();service='set_value';
  }
  return {domain:item.domain,service,data};
}

/** 构造静态控件，输入内容只在用户点击应用或发送后提交。 */
function rowMarkup(item){
  const state=`<small data-pad-control-state="${item.key}">正在读取…</small>`;
  if(item.domain==='button')return `<div class="pad-control-quick"><button type="button" data-pad-command="${item.key}" disabled>${item.label}</button>${state}</div>`;
  if(item.domain==='switch')return `<div class="pad-control-row"><div><strong>${item.label}</strong>${state}</div><button type="button" class="toggle" role="switch" aria-label="${item.label}" aria-checked="false" data-pad-command="${item.key}" disabled></button></div>`;
  const field=item.domain==='text'?`<textarea rows="2" maxlength="200" aria-label="${item.label}内容" data-pad-input="${item.key}" placeholder="输入内容，最多 200 字" disabled></textarea>`:`<input type="number" inputmode="numeric" min="${item.min}" max="${item.max}" step="1" aria-label="${item.label}" data-pad-input="${item.key}" disabled><span>${item.unit}</span>`;
  return `<div class="pad-control-row pad-control-editor"><div><strong>${item.label}</strong>${state}</div><div class="pad-control-value">${field}<button type="button" data-pad-command="${item.key}" disabled>${item.domain==='text'?'发送':'应用'}</button></div></div>`;
}

/** 在 Pad 详情中绑定全部控制项，复用当前登录会话并保留未提交的输入。 */
export function createPadControls(root,getHass,isOnline){
  let busy=false;
  const dirty=new Set(),awaiting=new Map();
  const groups=[...new Set(PAD_OPERATIONS.map(item=>item.group))];
  root.innerHTML=`<h3>Pad 操作</h3><p class="pad-control-help">${SITE.pad?.mode==='live'?'Pad 实控已启用：按钮与开关会提交服务，数值与文本点击应用或发送后提交。':'Pad 当前只读；配置自己的操作实体并显式启用 live 后才能下发。'}</p><div class="pad-control-groups">${groups.map(group=>`<details><summary>${group}</summary><div class="${group==='快捷操作'?'pad-control-quick-grid':'pad-control-fields'}">${PAD_OPERATIONS.filter(item=>item.group===group).map(rowMarkup).join('')}</div></details>`).join('')}</div><p class="pad-control-result" role="status" aria-live="polite" data-pad-control-result></p>`;
  const result=root.querySelector('[data-pad-control-result]');

  /** 更新实体报告与可用性，不重建节点、不覆盖正在编辑的草稿。 */
  function refresh(){
    const hass=getHass(),online=isOnline()&&hass?.connected!==false&&typeof hass?.callService==='function';
    for(const item of PAD_OPERATIONS){
      const entity=hass?.states?.[item.id],value=entity?.state;
      const available=online&&padControlAvailable(hass,item)&&(item.domain!=='switch'||['on','off'].includes(value));
      const button=root.querySelector(`[data-pad-command="${item.key}"]`),input=root.querySelector(`[data-pad-input="${item.key}"]`),status=root.querySelector(`[data-pad-control-state="${item.key}"]`);
      button.disabled=busy||!available||SITE.pad?.mode!=='live';
      if(input){
        input.disabled=!available;
        if(item.domain==='number'&&!dirty.has(item.key)&&document.activeElement!==input)input.value=available&&Number.isFinite(Number(value))?value:'';
      }
      if(item.domain==='switch')button.setAttribute('aria-checked',String(available&&value==='on'));
      const pending=awaiting.get(item.key);
      if(pending!==undefined&&(item.domain==='number'?Number(value)===pending:String(value)===String(pending))){awaiting.delete(item.key);if(input&&Number(input.value)===Number(pending))dirty.delete(item.key);}
      status.textContent=!available?'设备离线或该操作不可用':item.domain==='button'?'点击执行':item.domain==='text'?'最多 200 字':`当前：${item.domain==='switch'?(value==='on'?'开启':'关闭'):value+(item.unit||'')}${awaiting.has(item.key)?' · 等待设备报告':''}`;
    }
  }

  /** 明确提交一次服务调用；服务成功只表示已发送，不冒充设备执行成功。 */
  async function submit(item){
    if(busy)return;
    const input=root.querySelector(`[data-pad-input="${item.key}"]`);
    let command;
    try{
      if(!isOnline())throw new Error('Pad control unavailable');
      command=padCommand(getHass(),item.key,input?.value);
    }catch(error){
      console.warn('Pad command validation failed',item.key,error.message);
      result.dataset.error='true';result.textContent=error.message==='Pad control unavailable'?'设备离线或该操作暂不可用。':item.domain==='number'?`请输入 ${item.min}–${item.max} 范围内的整数。`:item.domain==='text'?'请输入 1–200 字的内容。':'设备离线或该操作暂不可用。';return;
    }
    busy=true;result.dataset.error='false';result.textContent=`正在提交：${item.label}…`;refresh();
    try{
      await getHass().callService(command.domain,command.service,command.data);
      if(item.domain==='number'||item.domain==='switch')awaiting.set(item.key,command.data.value??(command.service==='turn_on'?'on':'off'));
      // 发送期间若继续编辑文本，保留新草稿，只清空刚刚提交的内容。
      if(item.domain==='text'&&input.value.trim()===command.data.value){input.value='';dirty.delete(item.key);}
      result.textContent=`${item.label}指令已提交${item.domain==='number'||item.domain==='switch'?'，等待 Pad 状态报告。':'。'}`;
    }catch(error){
      console.error('Pad service call failed',item.key);
      result.dataset.error='true';result.textContent='指令提交失败，请检查 HA 权限和连接后重试。';
    }finally{busy=false;refresh();}
  }

  root.addEventListener('input',event=>{if(event.target.dataset.padInput)dirty.add(event.target.dataset.padInput);});
  root.addEventListener('click',event=>{const button=event.target.closest('[data-pad-command]');if(!button||button.disabled)return;event.preventDefault();event.stopPropagation();const item=PAD_OPERATIONS.find(item=>item.key===button.dataset.padCommand);if(item)submit(item);});
  /** 每次打开详情都恢复菜单收起状态，保留尚未提交的草稿。 */
  function collapse(){root.querySelectorAll('details').forEach(group=>group.open=false);}
  return {refresh,collapse};
}
