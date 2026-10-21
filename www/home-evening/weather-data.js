import {SITE,entityId} from './site-config.js';
export const WEATHER_ENTITY=entityId('weather.example_weather');
const lunarDays=['初一','初二','初三','初四','初五','初六','初七','初八','初九','初十','十一','十二','十三','十四','十五','十六','十七','十八','十九','二十','廿一','廿二','廿三','廿四','廿五','廿六','廿七','廿八','廿九','三十'];
let lunarWarned=false;
/** 将中国历日期显示为中文月份和日期，保留闰月并按家庭时区跨日。 */
export function lunarDate(date=new Date(),timeZone='Asia/Shanghai') {
  try {
    const formatter=new Intl.DateTimeFormat('zh-CN-u-ca-chinese',{month:'long',day:'numeric',timeZone});
    if(formatter.resolvedOptions().calendar!=='chinese')throw new Error('Chinese calendar is unavailable');
    const parts=formatter.formatToParts(date),month=parts.find(p=>p.type==='month')?.value,day=Number(parts.find(p=>p.type==='day')?.value);
    if(!month||!lunarDays[day-1])throw new Error('Invalid lunar date');
    return `农历${month}${lunarDays[day-1]}`;
  } catch(error) {if(!lunarWarned)console.warn('Evening lunar date failed',error);lunarWarned=true;return '农历暂不可用';}
}
/** 只转换实际存在的有效数值，避免把空值转换为零。 */
export function weatherNumber(value) {return (typeof value==='number'||typeof value==='string'&&value.trim()!=='')&&Number.isFinite(Number(value))?Number(value):null;}
/** 转义数据源提供的文本，防止实体名称或预报描述被当作 HTML。 */
export function weatherEscape(value) {return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
/** 收集当前天气源的附属传感器，保留报告时间，过滤无效状态并按内容分组。 */
export function weatherSensorGroups(states={},connected=true) {
  const groups=[{id:'air',name:'空气质量详情',icon:'leaf',rows:[]},{id:'life',name:'生活指数与出行建议',icon:'sun',rows:[]},{id:'warning',name:'灾害预警',icon:'cloud',rows:[]},{id:'observation',name:'附属气象观测',icon:'gauge',rows:[]}];
  if(!connected)return [];
  const air=new Set(['qlty','category','category_level','primary','pm2_5','pm10','co','so2','no2','o3']);
  for(const [id,entity] of Object.entries(states)) {
    const sensorKey=Object.entries(SITE.weather.sensors).find(([,entity])=>entity===id)?.[0];const match=sensorKey?[id,sensorKey]:null;
    if(!match||!entity||entity.state===null||entity.state===undefined||['','unknown','unavailable','null','none'].includes(String(entity.state).trim().toLowerCase()))continue;
    const key=match[1],attrs=entity.attributes||{},group=key==='disaster_warn'?groups[2]:air.has(key)?groups[0]:key.endsWith('_index')?groups[1]:groups[3];
    const description=attrs.states;
    group.rows.push({id,key,name:String(attrs.friendly_name||key).replace(/^和风天气\s*/,''),state:String(entity.state),unit:String(attrs.unit_of_measurement||'').trim(),detail:description&&String(description).trim()!=='null'?String(description):'',reported:entity.last_reported||entity.last_updated||null});
  }
  return groups.filter(group=>group.rows.length);
}
/** 根据天气状态提供中文名称及统一线性图标，不推断缺失天气。 */
export function weatherCondition(condition,night=false) {
  const names={sunny:['晴','sun'],'clear-night':['晴夜','moon'],partlycloudy:['多云','partly'],cloudy:['阴','cloud'],rainy:['雨','rain'],pouring:['大雨','rain'],lightning:['雷雨','storm'],'lightning-rainy':['雷阵雨','storm'],snowy:['雪','snow'],'snowy-rainy':['雨夹雪','snow'],fog:['雾','fog'],hail:['冰雹','snow'],windy:['大风','wind'],'windy-variant':['多云有风','wind'],exceptional:['特殊天气','cloud']};
  const result=names[condition]||['天气暂无数据','cloud'];
  return night&&condition==='partlycloudy'?[result[0],'nightPartly']:night&&condition==='sunny'?[result[0],'moon']:result;
}
/** 优先采用预报昼夜字段，缺失时依据已有下次日出日落时间判断未来一天。 */
export function forecastNight(row,sun) {
  if(typeof row.is_daytime==='boolean')return !row.is_daytime;
  if(row.condition==='clear-night')return true;
  const stamp=Date.parse(row.datetime),rising=Date.parse(sun?.attributes?.next_rising),setting=Date.parse(sun?.attributes?.next_setting);
  if(![stamp,rising,setting].every(Number.isFinite)||['unknown','unavailable'].includes(sun?.state))return false;
  return setting<rising?stamp>=setting&&stamp<rising:stamp<rising||stamp>=setting;
}
/** 将未来二十四小时内的真实日出日落按精确时间插入小时预报，不推算缺失事件。 */
export function hourlyTimeline(hours,sun,now=new Date()) {
  const items=hours.map(row=>({kind:'weather',datetime:row.datetime,row}));
  if(sun&&['above_horizon','below_horizon'].includes(sun.state)) {
    for(const [kind,field] of [['sunrise','next_rising'],['sunset','next_setting']]) {
      const datetime=sun.attributes?.[field],stamp=Date.parse(datetime);
      if(Number.isFinite(stamp)&&stamp>=now.getTime()&&stamp<=now.getTime()+24*3600000)items.push({kind,datetime});
    }
  }
  return items.sort((a,b)=>Date.parse(a.datetime)-Date.parse(b.datetime));
}
/** 将预报按时间排序去重，只保留未来二十四小时及家庭今天起五个日期。 */
export function forecastWindow(hourly=[],daily=[],now=new Date(),timeZone='Asia/Shanghai') {
  const dateKey=value=>new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
  const rows=value=>Array.isArray(value)?value.filter(row=>row&&Number.isFinite(Date.parse(row.datetime))).slice().sort((a,b)=>Date.parse(a.datetime)-Date.parse(b.datetime)):[];
  const minute=Number(new Intl.DateTimeFormat('en-US',{timeZone,minute:'numeric'}).format(now));
  const start=now.getTime()-minute*60000-now.getSeconds()*1000-now.getMilliseconds(),seenHours=new Set(),seenDays=new Set(),today=dateKey(now);
  const hours=rows(hourly).filter(row=>{const time=Date.parse(row.datetime);if(time<start||time>now.getTime()+24*3600000||seenHours.has(time))return false;seenHours.add(time);return true;}).slice(0,24);
  // 以家庭日期递增计算范围，避免浏览器所在时区改变“今天”的含义。
  const endDate=new Date(today+'T12:00:00Z');endDate.setUTCDate(endDate.getUTCDate()+5);
  const end=endDate.toISOString().slice(0,10);
  const days=rows(daily).filter(row=>{const key=dateKey(row.datetime);if(key<today||key>=end||seenDays.has(key))return false;seenDays.add(key);return true;}).slice(0,5);
  return {hours,days,today,dateKey};
}
