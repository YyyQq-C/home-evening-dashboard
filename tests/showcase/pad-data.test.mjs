import './setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {PAD_FIELDS,padReading,padPageAddress} from '../../www/home-evening/pad-data.js';

/** 生成对应真实实体名称的局部状态，便于验证离线和零值。 */
function fixture(values={}){
  const defaults={battery:75,memory:38,screen:'on',charge:'charging',cpu:'unknown',signal:-54,model:'LENOVO TB128FU'};
  return {connected:true,config:{time_zone:'Asia/Shanghai'},states:Object.fromEntries(PAD_FIELDS.filter(field=>field.key in {...defaults,...values}).map(field=>[field.id,{state:String(({...defaults,...values})[field.key]),attributes:{},last_updated:'2026-10-20T03:00:00Z'}]))};
}
test('Pad reading uses configured MQTT entities and keeps zero and negative readings',()=>{
  const result=padReading(fixture({battery:0,memory:0,brightness:0,temperature:0,screen:'off'}));
  assert.equal(result.online,true);assert.equal(result.values.battery,'0%');assert.equal(result.values.memory,'0%');assert.equal(result.values.temperature,'0°C');assert.equal(result.values.signal,'-54dBm');assert.equal(result.values.screen,'已熄屏');assert.equal(result.values.cpu,'—');
});
test('Pad charging uses battery state or charging binary sensor, without stale offline flags',()=>{
  const data=fixture({charge:'not_charging'});assert.equal(padReading(data).charging,false);
  data.states['binary_sensor.example_pad_chong_dian_zhong']={state:'on'};assert.equal(padReading(data).charging,true);
  data.connected=false;const off=padReading(data);assert.equal(off.charging,false);assert.equal(off.online,false);assert.ok(Object.values(off.values).every(value=>value==='—'));
});
test('Missing and unavailable device data never becomes fake zero or cached values',()=>{
  const data=fixture();for(const entity of Object.values(data.states))entity.state='unavailable';
  const off=padReading(data);assert.equal(off.online,false);assert.equal(off.reported,null);assert.equal(off.numbers.memory,null);
  const partial=padReading(fixture({battery:'unknown',memory:44}));assert.equal(partial.values.battery,'—');assert.equal(partial.values.memory,'44%');
});
test('Invalid percentages are rejected and actual low memory is retained',()=>{
  const result=padReading(fixture({battery:110,memory:90}));assert.equal(result.values.battery,'—');assert.equal(result.lowMemory,true);
});
test('Confirmed temperature unit remains readable when MQTT unit contains encoding artifacts',()=>{
  const data=fixture({temperature:32});data.states['sensor.example_pad_dian_chi_wen_du'].attributes.unit_of_measurement='掳C';
  assert.equal(padReading(data).values.temperature,'32°C');
});
test('Displayed page strips credentials and parameters, and rejects non-web schemes',()=>{
  assert.equal(padPageAddress('https://user:password@example.test/home?k=secret#token'),'https://example.test/home');assert.equal(padPageAddress('javascript:alert(1)'),'—');
});
