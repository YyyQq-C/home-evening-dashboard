import './setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {PAD_OPERATIONS,padCommand} from '../../www/home-evening/pad-controls.js';

/** 构造无网络的 HA 状态，按钮与文本覆盖从未执行时的 unknown 状态。 */
function fixture(){return {connected:true,states:Object.fromEntries(PAD_OPERATIONS.map(item=>[item.id,{state:item.domain==='switch'?'off':item.domain==='number'?String(item.min):'unknown',attributes:{min:item.min,max:item.max}}]))};}

test('Every verified Pad operation maps to the explicit configured HA entity and service',()=>{
  const hass=fixture();assert.equal(PAD_OPERATIONS.length,23);assert.equal(new Set(PAD_OPERATIONS.map(item=>item.id)).size,23);
  for(const item of PAD_OPERATIONS){
    const command=padCommand(hass,item.key,item.domain==='number'?item.min:'测试');
    assert.equal(command.data.entity_id,item.id);assert.equal(command.domain,item.domain);
    assert.equal(command.service,item.domain==='button'?'press':item.domain==='switch'?'turn_on':'set_value');
  }
  const motion=PAD_OPERATIONS.find(item=>item.key==='motion');hass.states[motion.id].state='on';assert.equal(padCommand(hass,'motion').service,'turn_off');
});

test('Pad values reject empty, fractional, out-of-range and arbitrary entity commands while preserving zero',()=>{
  const hass=fixture();
  for(const value of ['',false,null,'abc',-1,101,1.5])assert.throws(()=>padCommand(hass,'volume',value));
  assert.equal(padCommand(hass,'volume','0').data.value,0);
  assert.throws(()=>padCommand(hass,'brightness',0));assert.throws(()=>padCommand(hass,'dailyHour',24));assert.throws(()=>padCommand(hass,'dailyMinute',60));
  assert.throws(()=>padCommand(hass,'notify',' '));assert.throws(()=>padCommand(hass,'notify','字'.repeat(201)));
  assert.equal(padCommand(hass,'notify','  提醒  ').data.value,'提醒');assert.throws(()=>padCommand(hass,'switch.other_device'));
});

test('Pad controls respect missing, disconnected and unavailable entities and tighter entity limits',()=>{
  const hass=fixture(),volume=PAD_OPERATIONS.find(item=>item.key==='volume');
  hass.states[volume.id].attributes.max=40;assert.throws(()=>padCommand(hass,'volume',41));
  hass.states[volume.id].state='unavailable';assert.throws(()=>padCommand(hass,'volume',30));
  delete hass.states[volume.id];assert.throws(()=>padCommand(hass,'volume',30));
  hass.connected=false;assert.throws(()=>padCommand(hass,'reload'));
});


test('Pad read-only configuration cannot build a command and invalid domains stay unavailable',async()=>{
  const {SITE}=await import('../../www/home-evening/site-config.js');
  const {padControlAvailable}=await import('../../www/home-evening/pad-controls.js');
  const hass=fixture();
  SITE.pad.mode='read-only';
  try{assert.throws(()=>padCommand(hass,'reload'),/read-only/);}finally{SITE.pad.mode='live';}
  assert.equal(padControlAvailable({connected:true,states:{'light.example_other':{state:'on'}}},{domain:'button',id:'light.example_other'}),false);
});
