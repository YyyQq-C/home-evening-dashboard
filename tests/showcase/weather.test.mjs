import './setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {lunarDate,weatherNumber,forecastWindow,weatherEscape,forecastNight,hourlyTimeline,weatherSensorGroups} from '../../www/home-evening/weather-data.js';

test('Weather sensor groups retain source units and report times, and exclude offline or unrelated entities',()=>{
  const states={
    'sensor.example_weather_co':{state:'0.8',attributes:{friendly_name:'和风天气 一氧化碳',unit_of_measurement:'mg/m³',states:'null'},last_reported:'2026-10-19T02:54:00Z',last_updated:'2026-10-18T01:00:00Z'},
    'sensor.example_weather_comfort_index':{state:'舒适',attributes:{states:'保持原始建议'}},
    'sensor.example_weather_disaster_warn':{state:'off',attributes:{states:'近日无3级及以上灾害'}},
    'sensor.example_weather_precip':{state:'0',attributes:{unit_of_measurement:'mm/h'}},
    'sensor.example_weather_outside_temperature':{state:'unavailable'},
    'sensor.example_weather_vis':{state:'unknown'},
    'sensor.example_weather_cloud':{state:'null'},
    'sensor.indoor_co':{state:'1.2'},
    'sensor.he_feng_tian_qi_co':{state:'1.3'}
  };
  const groups=weatherSensorGroups(states);
  assert.deepEqual(groups.map(group=>group.id),['air','life','warning','observation']);
  assert.equal(groups[0].rows[0].name,'一氧化碳');assert.equal(groups[0].rows[0].unit,'mg/m³');
  assert.equal(groups[0].rows[0].reported,'2026-10-19T02:54:00Z');assert.equal(groups[0].rows[0].detail,'');
  assert.equal(groups[1].rows[0].detail,'保持原始建议');assert.equal(groups[2].rows[0].state,'off');
  assert.equal(groups[3].rows[0].state,'0');
  assert.deepEqual(weatherSensorGroups(states,false),[]);assert.deepEqual(weatherSensorGroups(),[]);
});

test('Lunar date follows family midnight and retains leap month',()=>{
  assert.equal(lunarDate(new Date('2026-02-16T16:00:00Z')),'农历正月初一');
  assert.equal(lunarDate(new Date('2026-02-16T15:59:00Z')),'农历腊月廿九');
  assert.equal(lunarDate(new Date('2023-03-22T04:00:00Z')),'农历闰二月初一');
});
test('Forecast window sorts and deduplicates without inventing missing hours or days',()=>{
  const now=new Date('2026-10-16T09:30:00Z');
  const hours=[{datetime:'2026-10-16T17:00+08:00'},{datetime:'2026-10-16T16:00+08:00'},{datetime:'bad'},{datetime:'2026-10-16T18:00+08:00'},{datetime:'2026-10-16T18:00+08:00'},{datetime:'2026-10-17T17:00+08:00'}];
  const days=[15,16,17,17,20,21].map(day=>({datetime:`2026-10-${day}T00:00+08:00`}));
  const result=forecastWindow(hours,days,now);
  assert.equal(result.hours.length,3);assert.equal(result.days.length,3);
  assert.equal(result.today,'2026-10-16');assert.equal(result.days.at(-1).datetime,'2026-10-20T00:00+08:00');
  assert.deepEqual(forecastWindow(null,null,now).hours,[]);
});
test('Missing metrics stay empty and source text is escaped',()=>{
  for(const invalid of [null,undefined,'',true,' ','unknown',Infinity])assert.equal(weatherNumber(invalid),null);
  assert.equal(weatherNumber('0'),0);assert.equal(weatherNumber('-3.5'),-3.5);
  assert.equal(weatherEscape('<img src=x onerror="bad()">'),'&lt;img src=x onerror=&quot;bad()&quot;&gt;');
});
test('Forecast night uses solar boundaries when provider omits daytime',()=>{
  const sun={state:'above_horizon',attributes:{next_setting:'2026-10-16T18:30+08:00',next_rising:'2026-10-17T07:00+08:00'}};
  assert.equal(forecastNight({datetime:'2026-10-16T23:00+08:00'},sun),true);
  assert.equal(forecastNight({datetime:'2026-10-17T09:00+08:00'},sun),false);
  assert.equal(forecastNight({datetime:'2026-10-16T18:30+08:00'},sun),true);
  assert.equal(forecastNight({datetime:'2026-10-16T23:00+08:00',is_daytime:true},sun),false);
});
test('Solar events merge chronologically without replacing weather hours',()=>{
  const now=new Date('2026-10-16T17:00+08:00');
  const hours=[{datetime:'2026-10-16T19:00+08:00'},{datetime:'2026-10-16T18:00+08:00'}];
  const sun={state:'above_horizon',attributes:{next_setting:'2026-10-16T18:31+08:00',next_rising:'2026-10-17T07:07+08:00'}};
  const result=hourlyTimeline(hours,sun,now);
  assert.deepEqual(result.map(row=>row.kind),['weather','sunset','weather','sunrise']);
  assert.equal(hours.length,2);assert.equal(result[1].datetime,sun.attributes.next_setting);
  assert.deepEqual(hourlyTimeline(hours,{...sun,state:'unavailable'},now).map(row=>row.kind),['weather','weather']);
  assert.equal(hourlyTimeline([],{state:'above_horizon',attributes:{next_setting:'invalid',next_rising:'2026-10-18T07:07+08:00'}},now).length,0);
  assert.equal(hourlyTimeline([],sun,new Date('2026-10-16T20:00+08:00')).length,1);
});
