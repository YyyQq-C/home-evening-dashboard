import './setup.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initialState,applyScene,loadState,saveState,STORAGE_KEY,bounded} from '../../www/home-evening/state.js';

/** 验证每个批量关闭场景不会误改其他设备和家电。 */
for(const [scene,kind] of [['lights-off','lights'],['ac-off','ac'],['floor-off','floor']]) {
  test(`${scene} only changes its own category`,()=>{
    const state=initialState(),before=structuredClone(state);
    applyScene(state,scene);
    assert.ok(Object.values(state[kind]).every(item=>!item.on));
    delete state[kind];delete before[kind];assert.deepEqual(state,before);
  });
}
/** 验证离家和睡眠有独立效果，并且不会关闭冰箱或修改家电。 */
test('Leave and sleep scenes preserve appliances and synchronize room state',()=>{
  const state=initialState(),appliances=structuredClone(state.appliances);
  applyScene(state,'leave');
  assert.ok(Object.values(state.lights).every(item=>!item.on));
  assert.ok(Object.values(state.ac).every(item=>!item.on));
  assert.ok(Object.values(state.floor).every(item=>!item.on));assert.equal(state.fresh.on,false);
  applyScene(state,'sleep');assert.equal(state.ac.master.on,true);assert.equal(state.ac.master.temperature,24);
  assert.equal(state.lights.masterYellow.brightness,20);assert.equal(state.fresh.speed,1);
  assert.deepEqual(state.appliances,appliances);
});
/** 验证独立存储只保存模拟状态，刷新可恢复且不会引入陌生字段。 */
test('Demo state restores known fields without importing foreign state',()=>{
  const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
  const state=initialState();applyScene(state,'lights-off');saveState(state,storage);
  assert.ok(values.has(STORAGE_KEY));assert.deepEqual(loadState(storage),state);
  storage.setItem(STORAGE_KEY,JSON.stringify({lights:{living:{on:false}},foreign:'ignored',ac:{living:{temperature:'invalid'}}}));
  const loaded=loadState(storage);assert.equal(loaded.lights.living.on,false);assert.equal(loaded.ac.living.temperature,26);assert.equal(loaded.foreign,undefined);
});
/** 验证温度范围覆盖空调、地暖、冰箱和直饮机。 */
test('Temperature edits remain within device-specific limits',()=>{
  assert.equal(bounded(31,'ac'),30);assert.equal(bounded(15,'floor'),16);assert.equal(bounded(-28,'freeze'),-24);assert.equal(bounded(100,'drinker'),95);
});
