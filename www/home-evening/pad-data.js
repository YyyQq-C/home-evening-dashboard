import {SITE,entityId} from './site-config.js';
// 实体均来自已核对的 MQTT 设备“HA 智能面板”，不按相似名称自动匹配其他设备。
export const PAD_FIELDS=[
  {key:'battery',group:'电源与资源',label:'电量',id:entityId('sensor.example_pad_dian_liang'),type:'percent'},
  {key:'charge',group:'电源与资源',label:'充电状态',id:entityId('sensor.example_pad_chong_dian_zhuang_tai'),type:'charge'},
  {key:'temperature',group:'电源与资源',label:'电池温度',id:entityId('sensor.example_pad_dian_chi_wen_du'),type:'number',unit:'°C'},
  {key:'cpu',group:'电源与资源',label:'CPU 使用率',id:entityId('sensor.example_pad_cpu'),type:'percent'},
  {key:'memory',group:'电源与资源',label:'内存已用',id:entityId('sensor.example_pad_nei_cun'),type:'percent'},
  {key:'memoryLow',group:'电源与资源',label:'内存状态',id:entityId('binary_sensor.example_pad_nei_cun_bu_zu'),type:'binary',values:['正常','内存不足']},
  {key:'appMemory',group:'电源与资源',label:'应用内存',id:entityId('sensor.example_pad_ying_yong_nei_cun'),type:'number',unit:'MB'},
  {key:'storage',group:'电源与资源',label:'存储已用',id:entityId('sensor.example_pad_cun_chu'),type:'percent'},
  {key:'screen',group:'屏幕与网络',label:'屏幕',id:entityId('binary_sensor.example_pad_liang_ping'),type:'binary',values:['已熄屏','已亮屏']},
  {key:'brightness',group:'屏幕与网络',label:'当前亮度',id:entityId('sensor.example_pad_dang_qian_liang_du'),type:'percent'},
  {key:'standby',group:'屏幕与网络',label:'待机状态',id:entityId('binary_sensor.example_pad_dang_qian_dai_ji'),type:'binary',values:['未待机','待机中']},
  {key:'presence',group:'屏幕与网络',label:'有人靠近',id:entityId('binary_sensor.example_pad_you_ren_kao_jin'),type:'binary',values:['未检测到','已检测到']},
  {key:'wifi',group:'屏幕与网络',label:'Wi-Fi 名称',id:entityId('sensor.example_pad_wi_fi_ming_cheng')},
  {key:'signal',group:'屏幕与网络',label:'Wi-Fi 信号',id:entityId('sensor.example_pad_wi_fi_xin_hao'),type:'number',unit:'dBm'},
  {key:'ip',group:'屏幕与网络',label:'本机地址',id:entityId('sensor.example_pad_ben_ji_di_zhi')},
  {key:'url',group:'屏幕与网络',label:'当前页面',id:entityId('sensor.example_pad_dang_qian_wang_zhi'),type:'url'},
  {key:'model',group:'设备与应用',label:'设备型号',id:entityId('sensor.example_pad_she_bei_xing_hao')},
  {key:'android',group:'设备与应用',label:'Android 版本',id:entityId('sensor.example_pad_xi_tong_ban_ben')},
  {key:'app',group:'设备与应用',label:'应用版本',id:entityId('sensor.example_pad_ying_yong_ban_ben')},
  {key:'locked',group:'设备与应用',label:'锁定模式',id:entityId('switch.example_pad_suo_ding_mo_shi'),type:'binary',values:['关闭','开启']},
  {key:'detection',group:'设备与应用',label:'人体检测',id:entityId('switch.example_pad_ren_ti_jian_ce'),type:'binary',values:['关闭','开启']},
  {key:'volume',group:'设备与应用',label:'媒体音量',id:entityId('number.example_pad_mei_ti_yin_liang'),type:'percent'}
];
const INVALID=new Set(['','unknown','unavailable','none','null']);
let warnedAddress=false;
/** 判断实体是否提供有效状态，保留零值与 off 状态。 */
function available(entity){return entity?.state!==undefined&&entity.state!==null&&!INVALID.has(String(entity.state).toLowerCase());}
/** 只转换有效数字，不把缺失数据当作零。 */
function numeric(value){return (typeof value==='number'||typeof value==='string'&&value.trim()!=='')&&Number.isFinite(Number(value))?Number(value):null;}
/** 移除网址中的认证信息、查询参数和片段，仅展示普通网页地址。 */
export function padPageAddress(value){
  try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)?url.origin+url.pathname:'—';}
  catch{if(!warnedAddress)console.warn('Pad page address is invalid');warnedAddress=true;return '—';}
}
/** 从宿主当前缓存读取平板状态；连接断开或设备离线时不展示缓存数值。 */
export function padReading(hass){
  const states=hass?.states||{},connected=!!hass&&hass.connected!==false;
  const online=connected&&PAD_FIELDS.filter(field=>['battery','memory','screen'].includes(field.key)).some(field=>available(states[field.id]));
  const values={},numbers={};let reported=null;
  for(const field of PAD_FIELDS){
    const entity=online?states[field.id]:null,state=available(entity)?String(entity.state):null;
    let text='—',number=null;
    if(state!==null){
      if(field.type==='percent'||field.type==='number'){
        number=numeric(state);if(field.type==='percent'&&number!==null&&(number<0||number>100))number=null;
        // 已核对的 MQTT 数值采用固定单位，避免实体单位编码异常污染界面。
        if(number!==null)text=`${Math.round(number*10)/10}${field.type==='percent'?'%':field.unit||entity.attributes?.unit_of_measurement||''}`;
      }else if(field.type==='binary')text=state==='on'?field.values[1]:state==='off'?field.values[0]:'—';
      else if(field.type==='charge')text=({charging:'充电中',discharging:'使用电池',not_charging:'未充电',full:'已充满'})[state]||'—';
      else text=field.type==='url'?padPageAddress(state):state;
      const stamp=Date.parse(entity.last_reported||entity.last_updated);if(Number.isFinite(stamp))reported=Math.max(reported??stamp,stamp);
    }
    values[field.key]=text;numbers[field.key]=number;
  }
  const charging=online&&(states[entityId('binary_sensor.example_pad_chong_dian_zhong')]?.state==='on'||states[entityId('sensor.example_pad_chong_dian_zhuang_tai')]?.state==='charging');
  return {online,charging,values,numbers,reported,lowMemory:online&&(states[entityId('binary_sensor.example_pad_nei_cun_bu_zu')]?.state==='on'||numbers.memory>=85),timeZone:hass?.config?.time_zone||'Asia/Shanghai'};
}
