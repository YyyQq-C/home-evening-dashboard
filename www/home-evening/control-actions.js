/** 生成不带访问令牌或家庭地址的错误码，供界面和测试识别。 */
function fail(code){const error=new Error(code);error.code=code;throw error;}

/** 从显式配置里定位设备，不接受界面传入任意实体或服务名称。 */
export function configuredDevice(config,key){
  const matches=(config.devices||[]).filter(item=>item.key===key);
  if(matches.length!==1)fail('device_not_configured');
  const device=matches[0];
  if(!/^[a-z_]+\.[a-z0-9_]+$/.test(device.entity||''))fail('entity_not_configured');
  const domain=device.entity.split('.')[0];
  if(!({light:['light','switch'],climate:['climate'],fan:['fan']}[device.kind]||[]).includes(domain))fail('entity_domain_mismatch');
  return {...device,domain};
}

/** 读取当前 HA 状态，断线、未知或不可用时不允许继续下发。 */
export function currentEntity(hass,id){
  if(!hass||hass.connected===false)fail('ha_disconnected');
  const entity=hass.states?.[id];
  if(!entity||['unknown','unavailable',''].includes(entity.state))fail('entity_unavailable');
  return entity;
}

/** 把一个明确的设备动作转换成 HA 标准服务，仅校验而不发送。 */
export function buildDeviceCommand(config,key,intent,hass){
  const device=configuredDevice(config,key),entity=currentEntity(hass,device.entity),a=entity.attributes||{};
  const data={entity_id:device.entity},result={domain:device.domain,data};
  if(intent.action==='power'){
    if(typeof intent.on!=='boolean')fail('invalid_power');
    if(device.kind==='climate'){
      const mode=intent.on?(entity.state!=='off'?entity.state:device.onMode):'off';
      if(!mode||!a.hvac_modes?.includes(mode))fail('hvac_mode_unsupported');
      return {...result,service:'set_hvac_mode',data:{...data,hvac_mode:mode}};
    }
    return {...result,service:intent.on?'turn_on':'turn_off'};
  }
  if(device.kind==='climate'&&intent.action==='temperature'){
    const value=intent.value,min=a.min_temp,max=a.max_temp,step=a.target_temp_step;
    if(!Number.isFinite(value))fail('invalid_temperature');
    if(!Number.isFinite(min)||!Number.isFinite(max)||!Number.isFinite(step)||step<=0)fail('temperature_limits_unavailable');
    if(value<min||value>max||Math.abs((value-min)/step-Math.round((value-min)/step))>1e-6)fail('invalid_temperature');
    // 仅修改设定温度，不夹带 hvac_mode，避免调温时意外开机或改模式。
    return {...result,service:'set_temperature',data:{...data,temperature:value}};
  }
  if(device.kind==='climate'&&intent.action==='mode'){
    if(!a.hvac_modes?.includes(intent.value))fail('hvac_mode_unsupported');
    return {...result,service:'set_hvac_mode',data:{...data,hvac_mode:intent.value}};
  }
  if(device.kind==='climate'&&intent.action==='fan'){
    if(!a.fan_modes?.includes(intent.value))fail('fan_mode_unsupported');
    return {...result,service:'set_fan_mode',data:{...data,fan_mode:intent.value}};
  }
  if(device.kind==='fan'&&intent.action==='percentage'){
    if(!Number.isFinite(a.percentage))fail('fan_speed_unsupported');
    if(!Number.isFinite(intent.value)||intent.value<0||intent.value>100)fail('invalid_percentage');
    return {...result,service:'set_percentage',data:{...data,percentage:intent.value}};
  }
  if(device.kind==='fan'&&intent.action==='preset'){
    if(!a.preset_modes?.includes(intent.value))fail('fan_preset_unsupported');
    return {...result,service:'set_preset_mode',data:{...data,preset_mode:intent.value}};
  }
  if(device.domain==='light'&&intent.action==='brightness'){
    const modes=a.supported_color_modes||[];
    if(!Number.isFinite(a.brightness)&&!modes.some(mode=>!['onoff','unknown'].includes(mode)))fail('brightness_unsupported');
    if(!Number.isInteger(intent.value)||intent.value<0||intent.value>100)fail('invalid_brightness');
    return {...result,service:'turn_on',data:{...data,brightness_pct:intent.value}};
  }
  fail('action_unsupported');
}

/** 将预先配置的场景按钮转换为 HA 场景或脚本调用。 */
export function buildSceneCommand(config,key,hass){
  const matches=(config.scenes||[]).filter(scene=>scene.key===key);
  if(matches.length!==1)fail('scene_not_configured');
  const entity=matches[0].entity||'',domain=entity.split('.')[0];
  if(!/^(scene|script)\.[a-z0-9_]+$/.test(entity))fail('scene_not_configured');
  currentEntity(hass,entity);
  return {domain,service:'turn_on',data:{entity_id:entity}};
}

/** 创建按设备隔离的真实控制入口，默认只读，不乐观修改实体状态。 */
export function createController({config,readHass,onStatus=()=>{},logger=console}){
  const pending=new Set();
  /** 下发经过白名单校验的操作；超时仅表示结果未知，不代表设备没有执行。 */
  async function send(key,builder){
    if(config.mode!=='live')fail('control_read_only');
    if(pending.has(key))fail('command_pending');
    const hass=readHass(),command=builder(hass);
    if(typeof hass.callService!=='function')fail('ha_service_unavailable');
    pending.add(key);onStatus(key,'sending');let timer;
    try{
      const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{const error=new Error('control_timeout');error.code='control_timeout';reject(error);},config.timeoutMs||15000);});
      // HA 前端会话执行权限检查，前端白名单不替代 HA 账户权限。
      await Promise.race([Promise.resolve().then(()=>hass.callService(command.domain,command.service,command.data)),timeout]);
      onStatus(key,'submitted');return {status:'submitted'};
    }catch(error){
      const code=error.code==='control_timeout'?'control_timeout':'service_failed';
      logger.error('HA device command failed',code);onStatus(key,code);
      const result=new Error(code);result.code=code;throw result;
    }finally{clearTimeout(timer);pending.delete(key);}
  }
  return {
    /** 发送单设备操作，不根据页面状态差异自动补发其他字段。 */
    run(key,intent){return send(key,hass=>buildDeviceCommand(config,key,intent,hass));},
    /** 调用用户配置好的 HA 场景或脚本，不在浏览器里批量猜测设备动作。 */
    scene(key){return send('scene:'+key,hass=>buildSceneCommand(config,key,hass));},
    /** 查询指定操作是否仍在等待服务响应。 */
    isPending(key){return pending.has(key);}
  };
}
