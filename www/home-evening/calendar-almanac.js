import {Solar} from './lunar-vendor.js';
import {calendarKey,calendarMonthDays,CALENDAR_MIN_YEAR,CALENDAR_MAX_YEAR} from './calendar-data.js';

const cache=new Map(),seasons=['孟春','仲春','季春','孟夏','仲夏','季夏','孟秋','仲秋','季秋','孟冬','仲冬','季冬'];
/** 按所选公历日的中国当地中午计算传统黄历，避免浏览器时区及子时换日造成偏移。 */
export function calendarAlmanac(selected) {
  const {year,month,day}=selected;
  if(!Number.isInteger(year)||year<CALENDAR_MIN_YEAR||year>CALENDAR_MAX_YEAR||!Number.isInteger(month)||month<1||month>12||!Number.isInteger(day)||day<1||day>calendarMonthDays(year,month))throw new RangeError('Calendar almanac date is out of range');
  const key=calendarKey(selected);if(cache.has(key))return cache.get(key);
  const solar=Solar.fromYmdHms(year,month,day,12,0,0),lunar=solar.getLunar(),previousTerm=lunar.getPrevJieQi();
  const result={
    key,lunarLabel:`农历${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`,
    ganzhi:`${lunar.getYearInGanZhi()}年 ${lunar.getMonthInGanZhi()}月 ${lunar.getDayInGanZhi()}日`,
    zodiac:`${lunar.getYearShengXiao()}年`,season:seasons[Math.abs(lunar.getMonth())-1],
    solarTerm:lunar.getJieQi()||previousTerm.getName(),termDate:lunar.getJieQi()?solar.toYmd():previousTerm.getSolar().toYmd(),hou:lunar.getHou(),phenology:lunar.getWuHou(),
    fiveElements:`${lunar.getDayNaYin()} · ${lunar.getZhiXing()}执位`,
    clash:`${lunar.getDayShengXiao()}日 冲${lunar.getDayChongDesc()} · 煞${lunar.getDaySha()}`,
    constellation:`${lunar.getGong()}方${lunar.getShou()} · ${lunar.getXiu()}${lunar.getZheng()}${lunar.getAnimal()} · ${lunar.getXiuLuck()}`,
    directions:[['喜神',`${lunar.getDayPositionXi()} · ${lunar.getDayPositionXiDesc()}`],['财神',`${lunar.getDayPositionCai()} · ${lunar.getDayPositionCaiDesc()}`],['福神',`${lunar.getDayPositionFu()} · ${lunar.getDayPositionFuDesc()}`]],
    yi:lunar.getDayYi(),ji:lunar.getDayJi(),auspicious:lunar.getDayJiShen(),inauspicious:lunar.getDayXiongSha(),
    pengzu:`${lunar.getPengZuGan()}；${lunar.getPengZuZhi()}`,nineStar:lunar.getDayNineStar().toString(),
    fetalPosition:lunar.getDayPositionTai(),dayGod:`${lunar.getDayTianShen()} · ${lunar.getDayTianShenType()} · ${lunar.getDayTianShenLuck()}`,
    moonPhase:lunar.getYueXiang(),festivals:[...new Set([...solar.getFestivals(),...lunar.getFestivals()])]
  };
  // 只缓存近期查看的日期，连续翻年时不积累无界内存。
  if(cache.size>=256)cache.delete(cache.keys().next().value);cache.set(key,result);return result;
}
