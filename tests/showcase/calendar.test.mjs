import './setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarToday,calendarKey,calendarMonthDays,calendarMonth,calendarMove,calendarLunar,calendarCells} from '../../www/home-evening/calendar-data.js';

test('Calendar today follows the home timezone across midnight',()=>{
  const now=new Date('2026-10-18T16:30:00Z');
  assert.equal(calendarKey(calendarToday(now,'Asia/Shanghai')),'2026-10-19');
  assert.equal(calendarKey(calendarToday(now,'UTC')),'2026-10-18');
});
test('Month navigation clamps month-end dates and supported year boundaries',()=>{
  assert.equal(calendarMonthDays(2024,2),29);assert.equal(calendarMonthDays(2100,2),28);
  assert.deepEqual(calendarMonth({year:2024,month:1,day:31},1),{year:2024,month:2,day:29});
  assert.deepEqual(calendarMonth({year:2026,month:12,day:31},1),{year:2027,month:1,day:31});
  assert.deepEqual(calendarMonth({year:1900,month:1,day:1},-1),{year:1900,month:1,day:1});
  assert.deepEqual(calendarMonth({year:2100,month:12,day:31},1),{year:2100,month:12,day:31});
});
test('Date keyboard movement crosses months without crossing the calendar range',()=>{
  assert.deepEqual(calendarMove({year:2024,month:2,day:28},1),{year:2024,month:2,day:29});
  assert.deepEqual(calendarMove({year:2026,month:12,day:31},1),{year:2027,month:1,day:1});
  assert.deepEqual(calendarMove({year:1900,month:1,day:1},-7),{year:1900,month:1,day:1});
  assert.deepEqual(calendarMove({year:2100,month:12,day:31},7),{year:2100,month:12,day:31});
});
test('Month grids have six Monday-first weeks and retain leap day and adjacent dates',()=>{
  const cells=calendarCells({year:2024,month:2,day:29});
  assert.equal(cells.length,42);assert.equal(cells[0].key,'2024-01-29');
  assert.equal(cells.filter(cell=>!cell.outside).length,29);
  assert.equal(cells.find(cell=>cell.key==='2024-02-29').disabled,false);
  assert.ok(calendarCells({year:1900,month:1,day:1}).filter(cell=>cell.year<1900).every(cell=>cell.disabled));
  assert.ok(calendarCells({year:2100,month:12,day:31}).filter(cell=>cell.year>2100).every(cell=>cell.disabled));
});
test('Lunar details retain leap months and use the lunar year for zodiac',()=>{
  assert.equal(calendarLunar({year:2026,month:2,day:17}).label,'农历正月初一');
  assert.equal(calendarLunar({year:2026,month:2,day:17}).zodiac,'马年');
  assert.equal(calendarLunar({year:2026,month:2,day:16}).zodiac,'蛇年');
  const leap=calendarLunar({year:2023,month:3,day:22});
  assert.equal(leap.month,'闰二月');assert.equal(leap.short,'闰二月');assert.equal(leap.day,'初一');
});

import {calendarAlmanac} from '../../www/home-evening/calendar-almanac.js';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('Almanac matches the reference date, directions, activities, and traditional details',()=>{
 const a=calendarAlmanac({year:2026,month:7,day:8});assert.equal(a.lunarLabel,'农历五月廿四');assert.equal(a.ganzhi,'丙午年 乙未月 癸未日');assert.equal(a.season,'仲夏');assert.equal(a.hou,'小暑 初候');assert.equal(a.phenology,'温风至');
 assert.equal(a.fiveElements,'杨柳木 · 建执位');assert.equal(a.clash,'羊日 冲(丁丑)牛 · 煞西');assert.deepEqual(a.directions,[['喜神','巽 · 东南'],['财神','离 · 正南'],['福神','艮 · 东北']]);
 assert.deepEqual(a.yi,['祭祀','出行','交易','割蜜','造畜稠']);assert.deepEqual(a.ji,['嫁娶','作灶','安葬','动土','词讼','作梁','伐木','掘井','破土','移徙']);assert.deepEqual(a.auspicious,['天恩','守日','不将','圣心']);assert.equal(a.nineStar,'八白土洞明');
});
test('Almanac retains upstream historical test fixtures and changes daily',()=>{
 assert.match(calendarAlmanac({year:2012,month:8,day:5}).ganzhi,/戊戌日$/);
 const fixture=calendarAlmanac({year:2025,month:9,day:16});assert.deepEqual(fixture.auspicious,['时德','阳德','民日','玉宇','司命']);assert.deepEqual(fixture.inauspicious,['河魁','死神','天吏','致死','往亡']);
 assert.notEqual(calendarAlmanac({year:2026,month:7,day:8}).ganzhi,calendarAlmanac({year:2026,month:7,day:9}).ganzhi);
});
test('Almanac supports leap months, new year boundaries and the full configured range',()=>{
 assert.equal(calendarAlmanac({year:2023,month:3,day:22}).lunarLabel,'农历闰二月初一');assert.equal(calendarAlmanac({year:2026,month:2,day:16}).zodiac,'蛇年');assert.equal(calendarAlmanac({year:2026,month:2,day:17}).zodiac,'马年');
 for(const selected of [{year:1900,month:1,day:1},{year:2100,month:12,day:31}]){const a=calendarAlmanac(selected);assert.ok(a.ganzhi&&a.hou&&a.fiveElements&&a.nineStar);}
 for(const selected of [{year:1899,month:12,day:31},{year:2101,month:1,day:1},{year:2026,month:2,day:30}])assert.throws(()=>calendarAlmanac(selected),RangeError);
});
test('Almanac is independent of the execution host timezone',()=>{
 const script="import{calendarAlmanac}from'./calendar-almanac.js';console.log(JSON.stringify(calendarAlmanac({year:2026,month:7,day:8})))";
 const values=['UTC','America/Los_Angeles','Asia/Shanghai'].map(TZ=>execFileSync(process.execPath,['--input-type=module','-e',script],{cwd:fileURLToPath(new URL('../../www/home-evening/',import.meta.url)),env:{...process.env,TZ},encoding:'utf8'}));assert.equal(values[0],values[1]);assert.equal(values[1],values[2]);
});
