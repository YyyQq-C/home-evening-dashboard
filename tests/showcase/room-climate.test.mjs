import './setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {ROOM_CLIMATE_ENTITIES,roomClimateReading} from '../../www/home-evening/room-climate-data.js';
test('Room climate uses independently confirmed air conditioner and heating mappings',()=>{
  assert.deepEqual(Object.values(ROOM_CLIMATE_ENTITIES.ac).sort(),['climate.example_ac_master','climate.example_ac_secondary','climate.example_ac_child','climate.example_ac_dining','climate.example_ac_living','climate.example_ac_study'].sort());
  assert.equal(ROOM_CLIMATE_ENTITIES.ac.living,'climate.example_ac_living');
  assert.equal(ROOM_CLIMATE_ENTITIES.ac.dining,'climate.example_ac_dining');
  assert.equal(ROOM_CLIMATE_ENTITIES.floor.living,'climate.example_floor_living');
  assert.equal(ROOM_CLIMATE_ENTITIES.floor.child,'climate.example_floor_child');
});
test('Room readings retain real target, room temperature, mode, speed and device limits',()=>{
  const id=ROOM_CLIMATE_ENTITIES.ac.master,hass={states:{[id]:{state:'cool',attributes:{temperature:23.5,current_temperature:21,fan_mode:'high',min_temp:16,max_temp:32,target_temp_step:.5,hvac_modes:['off','cool','dry']}}}};
  const reading=roomClimateReading('ac','master',hass);
  assert.equal(reading.on,true);assert.equal(reading.temperature,23.5);assert.equal(reading.currentTemperature,21);assert.equal(reading.mode,'制冷');assert.equal(reading.fan,'高速');assert.equal(reading.max,32);assert.equal(reading.step,.5);
  assert.deepEqual(reading.modes,['制冷','除湿']);
});
test('Off is a valid reading while unavailable and disconnected entities never expose cached temperatures',()=>{
  const id=ROOM_CLIMATE_ENTITIES.floor.master,hass={connected:true,states:{[id]:{state:'off',attributes:{temperature:0}}}};
  assert.equal(roomClimateReading('floor','master',hass).temperature,0);assert.equal(roomClimateReading('floor','master',hass).on,false);
  for(const state of ['unavailable','unknown']){hass.states[id].state=state;const reading=roomClimateReading('floor','master',hass);assert.equal(reading.temperature,null);assert.equal(reading.on,null);assert.equal(reading.available,false);}
  hass.states[id].state='heat';hass.connected=false;assert.equal(roomClimateReading('floor','master',hass).temperature,null);
});
test('Missing target temperatures remain empty and reading source never mutates the host state',()=>{
  const id=ROOM_CLIMATE_ENTITIES.ac.child,hass={states:{[id]:{state:'off',attributes:{temperature:null}}}},before=structuredClone(hass);
  assert.equal(roomClimateReading('ac','child',hass).temperature,null);assert.deepEqual(hass,before);
});
