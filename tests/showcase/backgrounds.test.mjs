import './setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {ambientIndex,normalizeBackgroundState,backgroundPool,backgroundAt,backgroundSize,DEFAULT_BACKGROUND_SETTINGS} from '../../www/home-evening/ambient.js';

/** 构造指定数量、适用于所有主题的共享图库。 */
function fixture(size=4){return normalizeBackgroundState({settings:{...DEFAULT_BACKGROUND_SETTINGS,source:'custom',interval_seconds:5},images:Array.from({length:size},(_,i)=>({id:(i+1).toString(16).padStart(32,'0'),name:`图片 ${i+1}`,width:300,height:600,theme:'all',enabled:true}))});}

test('Default shared backgrounds retain the existing hourly order for each theme',()=>{
  const state=normalizeBackgroundState();
  for(const theme of ['dark','light'])for(let hour=0;hour<48;hour++)assert.equal(backgroundAt(state,theme,hour*3600000).index,ambientIndex(hour*3600000,3));
});
test('Shared background input ignores foreign URLs, invalid settings and duplicate records',()=>{
  const state=fixture();state.images[0].url='https://example.test/image';state.images.push({...state.images[0]});state.settings.interval_seconds=1;
  const next=normalizeBackgroundState(state);
  assert.equal(next.images.length,4);assert.ok(next.images[0].url.startsWith('/api/home_evening/backgrounds/image/'));assert.equal(next.settings.interval_seconds,3600);
});
test('Disabled rotation fixes the selected image and theme filtering falls back to builtins',()=>{
  const state=fixture();state.settings.cycle=false;state.settings.selected_id=state.images[2].id;
  assert.equal(backgroundAt(state,'dark',99999999).id,state.images[2].id);
  state.images.forEach(image=>image.theme='light');assert.equal(backgroundPool(state,'dark').length,0);assert.equal(backgroundAt(state,'dark').builtin,true);
});
test('Sequential rotation uses the shared anchor and queue order',()=>{
  const state=fixture();state.anchor_ms=1000;state.settings.selected_id=state.images[1].id;
  assert.equal(backgroundAt(state,'dark',5999).id,state.images[1].id);assert.equal(backgroundAt(state,'dark',6000).id,state.images[2].id);
  assert.equal(backgroundAt(state,'dark',21000).id,state.images[1].id);
});
test('Random rounds are reproducible, visit every image and avoid repeats at boundaries',()=>{
  for(const size of [1,2,3,4,9]){
    const state=fixture(size);state.settings.mode='random';
    let previous;
    for(let round=0;round<100;round++){
      const visited=new Set();
      for(let i=0;i<size;i++){
        const now=(round*size+i)*5000,image=backgroundAt(state,'dark',now);
        assert.equal(image.id,backgroundAt(structuredClone(state),'light',now).id);
        if(size>1&&previous)assert.notEqual(image.id,previous);
        visited.add(image.id);previous=image.id;
      }
      assert.equal(visited.size,size);
    }
  }
});
test('Every image display mode maps to explicit CSS sizing',()=>{
  assert.equal(backgroundSize('cover'),'cover');assert.equal(backgroundSize('contain'),'contain');assert.equal(backgroundSize('stretch'),'100% 100%');assert.equal(backgroundSize('invalid'),'cover');
});
