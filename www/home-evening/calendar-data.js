import {lunarDate} from './weather-data.js';

export const CALENDAR_MIN_YEAR=1900,CALENDAR_MAX_YEAR=2100;
const lunarDays=['初一','初二','初三','初四','初五','初六','初七','初八','初九','初十','十一','十二','十三','十四','十五','十六','十七','十八','十九','二十','廿一','廿二','廿三','廿四','廿五','廿六','廿七','廿八','廿九','三十'];
const zodiac=['鼠','牛','虎','兔','龙','蛇','马','羊','猴','鸡','狗','猪'];
const chinese=new Intl.DateTimeFormat('zh-CN-u-ca-chinese',{year:'numeric',month:'long',day:'numeric',timeZone:'Asia/Shanghai'});
let lunarWarned=false;

/** 生成稳定的公历日期标识，不依赖浏览器当前时区。 */
export function calendarKey({year,month,day}) {return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;}
/** 读取家庭时区的今天，保持左上角日期与万年历一致。 */
export function calendarToday(now=new Date(),timeZone='Asia/Shanghai') {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'numeric',day:'numeric'}).formatToParts(now).map(part=>[part.type,part.value]));
  return {year:Number(parts.year),month:Number(parts.month),day:Number(parts.day)};
}
/** 将所选公历日转换为中国当地中午，避免午夜及浏览器时区引起跨日。 */
export function calendarDate({year,month,day}) {return new Date(Date.UTC(year,month-1,day,4));}
/** 返回指定公历年月的天数，正确处理闰年二月。 */
export function calendarMonthDays(year,month) {return new Date(Date.UTC(year,month,0)).getUTCDate();}
/** 将月份调整限制在有效年月范围，月底切换时保留可用的日期。 */
export function calendarMonth(selected,delta=0,year=selected.year,month=selected.month) {
  const index=Math.max(CALENDAR_MIN_YEAR*12,Math.min(CALENDAR_MAX_YEAR*12+11,year*12+month-1+delta));
  const nextYear=Math.floor(index/12),nextMonth=index%12+1;
  return {year:nextYear,month:nextMonth,day:Math.min(selected.day,calendarMonthDays(nextYear,nextMonth))};
}
/** 将所选日期前后移动，越过万年历边界时停留在最早或最晚日期。 */
export function calendarMove(selected,delta) {
  const stamp=Date.UTC(selected.year,selected.month-1,selected.day+delta);
  const date=new Date(Math.max(Date.UTC(CALENDAR_MIN_YEAR,0,1),Math.min(Date.UTC(CALENDAR_MAX_YEAR,11,31),stamp)));
  return {year:date.getUTCFullYear(),month:date.getUTCMonth()+1,day:date.getUTCDate()};
}
/** 读取中国历原始年月日，生肖依据农历年计算，保留真实闰月名称。 */
export function calendarLunar(selected) {
  try {
    if(chinese.resolvedOptions().calendar!=='chinese')throw new Error('Chinese calendar is unavailable');
    const parts=Object.fromEntries(chinese.formatToParts(calendarDate(selected)).map(part=>[part.type,part.value]));
    const day=Number(parts.day),year=Number(parts.relatedYear);
    if(!lunarDays[day-1]||!Number.isFinite(year))throw new Error('Invalid Chinese calendar date');
    return {label:`农历${parts.month}${lunarDays[day-1]}`,short:day===1?parts.month:lunarDays[day-1],month:parts.month,day:lunarDays[day-1],year:parts.yearName?`${parts.yearName}年`:`${year}年`,zodiac:`${zodiac[((year-4)%12+12)%12]}年`};
  } catch(error) {
    if(!lunarWarned)console.warn('Evening calendar lunar data unavailable',error);lunarWarned=true;
    return {label:lunarDate(calendarDate(selected)),short:'—',month:'—',day:'—',year:'—',zodiac:'—'};
  }
}
/** 以周一为首列生成完整六周月视图，邻月日期可选择但禁止越过支持范围。 */
export function calendarCells(selected) {
  const first=Date.UTC(selected.year,selected.month-1,1),offset=(new Date(first).getUTCDay()+6)%7;
  return Array.from({length:42},(_,index)=>{
    const date=new Date(first+(index-offset)*86400000),cell={year:date.getUTCFullYear(),month:date.getUTCMonth()+1,day:date.getUTCDate()};
    return {...cell,key:calendarKey(cell),outside:cell.month!==selected.month,disabled:cell.year<CALENDAR_MIN_YEAR||cell.year>CALENDAR_MAX_YEAR};
  });
}
