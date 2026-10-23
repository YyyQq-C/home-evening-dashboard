import './setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {applianceInformation,applianceReading,APPLIANCE_DEFINITIONS} from '../../www/home-evening/appliance-data.js';

test('Appliance detail mappings retain the original 76 fields and no invented fridge binding',()=>{
  assert.equal(Object.values(APPLIANCE_DEFINITIONS).flatMap(d=>d.groups.flatMap(g=>g.items)).length,76);
  const fridge=applianceInformation('fridge',{connected:true,states:{}});assert.equal(fridge.status,'未接入');assert.equal(fridge.available,false);assert.deepEqual(fridge.groups,[]);
});
test('Appliance readings keep zero, original units, and state report timestamps',()=>{
  const id=APPLIANCE_DEFINITIONS.washer.primary,field='sensor.example_gun_tong_xi_yi_ji_xi_di_shui_wen';
  const info=applianceInformation('washer',{connected:true,states:{[id]:{state:'运行中',last_updated:'2026-10-19T08:00:00Z'},[field]:{state:'0',attributes:{unit_of_measurement:'°C'},last_updated:'2026-10-19T08:01:00Z'}}});
  assert.equal(info.available,true);assert.equal(info.groups[0].items.find(i=>i.entity===field).value,'0 °C');assert.equal(info.reportedAt,'2026-10-19T08:01:00Z');
});
test('Offline appliance and disconnected host never show cached readings',()=>{
  const primary=APPLIANCE_DEFINITIONS.purifier.primary,states={[primary]:{state:'off'},'sensor.example_purifier_out_tds':{state:'23'}};
  for(const hass of [{connected:true,states},{connected:false,states:{...states,[primary]:{state:'on'}}}]){
    const info=applianceInformation('purifier',hass);assert.equal(info.available,false);assert.equal(info.reportedAt,null);assert.ok(info.groups.every(g=>g.items.every(i=>i.value==='不可用')));
  }
  assert.equal(applianceInformation('washer',null).status,'未连接 HA');assert.equal(applianceReading({state:'unavailable',attributes:{unit_of_measurement:'L'}}),'暂无数据');
});
test('Only existing state cache is read, without executing device services',()=>{
  let calls=0;const primary=APPLIANCE_DEFINITIONS.drinker.primary;
  const info=applianceInformation('drinker',{connected:true,states:{[primary]:{state:'on'}},callService(){calls++;throw new Error('Unexpected device control');}});
  assert.equal(info.status,'在线');assert.equal(calls,0);assert.equal(applianceReading({state:'locked'}),'已锁定');
});
