import {SITE} from './site-config.js';
import {createController,currentEntity} from './control-actions.js';

const cards=new Map(),controls=SITE.control,output=document.querySelector('#result');
const text={control_read_only:'当前为只读模式，请先核对配置。',device_not_configured:'设备配置缺失或 key 重复。',entity_not_configured:'请先填写实体 ID。',entity_domain_mismatch:'实体类型与设备配置不匹配。',ha_disconnected:'HA 未连接，请从同源仪表盘打开。',entity_unavailable:'设备实体不可用，未发送操作。',hvac_mode_unsupported:'请核对支持模式；关闭状态开机还需填写 onMode。',temperature_limits_unavailable:'实体未提供完整温度范围与步长，未发送。',invalid_temperature:'温度超出范围或不符合设备步长。',fan_mode_unsupported:'设备不支持该风速。',fan_speed_unsupported:'设备未提供百分比风速。',invalid_percentage:'风速百分比应在 0 到 100 之间。',fan_preset_unsupported:'设备不支持该预设模式。',brightness_unsupported:'这路灯不支持亮度调节。',invalid_brightness:'亮度应为 0 到 100 的整数。',action_unsupported:'该设备不支持此操作。',command_pending:'该设备正在等待响应。',ha_service_unavailable:'HA 服务连接不可用。',service_failed:'服务调用失败，请查看 HA 日志和设备状态。',control_timeout:'等待超时，执行结果未知。请先检查设备状态。',scene_not_configured:'场景或脚本未配置。'};

/** 只读访问同源 HA 宿主会话，不创建或保存访问令牌。 */
function readHass(){
  try{return window.parent!==window?window.parent.document.querySelector('home-assistant')?.hass:null;}
  catch{console.warn('HA host is unavailable');return null;}
}

/** 创建文本节点，避免将实体内容和配置名称当作 HTML 执行。 */
function element(tag,content,className){const node=document.createElement(tag);if(content!==undefined)node.textContent=content;if(className)node.className=className;return node;}

/** 保留选择中和编辑中的值，只在真实内容改变时同步选择项。 */
function updateOptions(select,values,current){
  const signature=JSON.stringify(values||[]);
  if(select.dataset.options!==signature){select.replaceChildren(...(values||[]).map(value=>{const option=element('option',value);option.value=value;return option;}));select.dataset.options=signature;}
  if(document.activeElement!==select&&!select.dataset.dirty&&current!=null)select.value=String(current);
}

/** 给每个输入增加明确的提交动作，编辑草稿时不自动发送。 */
function field(host,label,type,action){
  const row=element('div',undefined,'row'),wrapper=element('label',label),input=element(type==='select'?'select':'input');
  if(type!=='select')input.type='number';input.setAttribute('aria-label',label);wrapper.append(input);row.append(wrapper);
  const button=element('button','提交');button.type='button';button.dataset.command='true';button.addEventListener('click',()=>{
    if(input.value.trim()===''){output.textContent='请先填写或选择有效值。';return;}
    execute(host.device.key,{action,value:type==='select'?input.value:Number(input.value)});
  });
  row.append(button);host.node.append(row);host.inputs.push(input);return input;
}

/** 按固定配置创建控件，数据刷新时不重建焦点和输入草稿。 */
function build(){
  document.querySelector('#mode').textContent=controls.mode==='live'?'真实控制已启用：按钮会调用已绑定设备的 HA 服务。':'只读模式：可以核对实体，所有下发按钮均禁用。';
  for(const device of controls.devices||[]){
    const node=element('article'),reading=element('div',undefined,'reading'),host={device,node,reading,inputs:[]};node.setAttribute('aria-label',device.name||device.key);
    node.append(element('h2',device.name||device.key),element('code',device.entity||'未配置实体'),reading);
    const row=element('div',undefined,'row');
    for(const [label,on] of [['开启',true],['关闭',false]]){const button=element('button',label);button.type='button';button.dataset.command='true';button.addEventListener('click',()=>execute(device.key,{action:'power',on}));row.append(button);}node.append(row);
    if(device.kind==='climate'){host.temperature=field(host,'设定温度','number','temperature');host.mode=field(host,'运行模式','select','mode');host.fan=field(host,'设备风速','select','fan');}
    if(device.kind==='fan'){host.percentage=field(host,'风速百分比','number','percentage');host.percentage.min=0;host.percentage.max=100;host.preset=field(host,'预设模式','select','preset');}
    if(device.kind==='light'&&device.entity?.startsWith('light.')){host.brightness=field(host,'亮度百分比','number','brightness');host.brightness.min=0;host.brightness.max=100;}
    cards.set(device.key,host);document.querySelector('#devices').append(node);
  }
  for(const scene of controls.scenes||[]){const button=element('button',scene.name||scene.key);button.type='button';button.disabled=controls.mode!=='live'||!scene.entity;button.addEventListener('click',()=>executeScene(scene.key));document.querySelector('#scenes').append(button);}
}

/** 持续读取真实状态；不把草稿和服务受理消息写入实体读数。 */
function refresh(){
  const hass=readHass();document.querySelector('#connection').textContent=hass&&hass.connected!==false?'已连接当前 HA 会话':'未连接 HA；请通过同源仪表盘 iframe 打开，普通本地预览只显示配置。';
  for(const [key,host] of cards){
    let entity;try{entity=currentEntity(hass,host.device.entity);}catch{entity=null;}
    const a=entity?.attributes||{},available=!!entity;
    host.reading.textContent=!host.device.entity?'未配置实体':!available?'实体缺失、离线或未连接':`状态：${entity.state}${Number.isFinite(a.current_temperature)?`　当前温度：${a.current_temperature}°C`:''}${Number.isFinite(a.temperature)?`　设定温度：${a.temperature}°C`:''}${Number.isFinite(a.percentage)?`　风速：${a.percentage}%`:''}${a.fan_mode?`　设备风速：${a.fan_mode}`:''}`;
    const locked=controls.mode!=='live'||!available||controller.isPending(key);
    host.node.querySelectorAll('[data-command]').forEach(button=>button.disabled=locked);
    host.inputs.forEach(input=>input.disabled=locked);
    if(host.temperature){
      const valid=[a.min_temp,a.max_temp,a.target_temp_step].every(Number.isFinite)&&a.target_temp_step>0;
      host.temperature.min=a.min_temp??'';host.temperature.max=a.max_temp??'';host.temperature.step=a.target_temp_step??'';
      host.temperature.disabled=locked||!valid;
      host.temperature.closest('.row').querySelector('button').disabled=locked||!valid;
      if(document.activeElement!==host.temperature&&!host.temperature.dataset.dirty)host.temperature.value=Number.isFinite(a.temperature)?a.temperature:'';
      updateOptions(host.mode,a.hvac_modes,entity?.state);updateOptions(host.fan,a.fan_modes,a.fan_mode);
      for(const select of [host.mode,host.fan]){const disabled=locked||!select.options.length;select.disabled=disabled;select.closest('.row').querySelector('button').disabled=disabled;}
    }
    if(host.percentage){if(document.activeElement!==host.percentage&&!host.percentage.dataset.dirty)host.percentage.value=a.percentage??'';const disabled=locked||!Number.isFinite(a.percentage);host.percentage.disabled=disabled;host.percentage.closest('.row').querySelector('button').disabled=disabled;updateOptions(host.preset,a.preset_modes,a.preset_mode);host.preset.disabled=locked||!host.preset.options.length;host.preset.closest('.row').querySelector('button').disabled=host.preset.disabled;}
    if(host.brightness){const supported=Number.isFinite(a.brightness)||(a.supported_color_modes||[]).some(mode=>!['onoff','unknown'].includes(mode));host.brightness.disabled=locked||!supported;host.brightness.closest('.row').querySelector('button').disabled=host.brightness.disabled;if(document.activeElement!==host.brightness&&!host.brightness.dataset.dirty)host.brightness.value=Number.isFinite(a.brightness)?Math.round(a.brightness/255*100):'';}
  }
}

/** 在服务状态改变后仅更新提示，设备最终状态仍以回读为准。 */
function status(key,value){output.textContent=value==='sending'?`${key}：正在提交…`:value==='submitted'?`${key}：HA 已受理，请核对设备回读；这不等于物理效果已验证。`:text[value]||value;refresh();}
const controller=createController({config:controls,readHass,onStatus:status});

/** 执行一个按钮指定的设备动作，错误只显示脱敏错误码对应说明。 */
async function execute(key,intent){
  try{await controller.run(key,intent);for(const input of cards.get(key)?.inputs||[])delete input.dataset.dirty;refresh();}
  catch(error){console.error('Device control request rejected',error.code||'unknown');output.textContent=text[error.code]||'操作被拒绝，请检查配置。';refresh();}
}

/** 执行显式绑定的场景，未配置时不执行展示页的模拟动作。 */
async function executeScene(key){try{await controller.scene(key);}catch(error){console.error('Scene request rejected',error.code||'unknown');output.textContent=text[error.code]||'场景未执行。';}}

document.addEventListener('input',event=>{if(event.target.matches('input,select'))event.target.dataset.dirty='true';});
build();refresh();
setInterval(()=>{if(!document.hidden)refresh();},2000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
