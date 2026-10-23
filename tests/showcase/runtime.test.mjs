import './setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createVisiblePoll} from '../../www/home-evening/runtime.js';

/** 创建可控的页面生命周期和定时器，验证后台暂停及缓存恢复。 */
function fixture(){
  const document=new EventTarget(),window=new EventTarget(),timers=new Map();
  document.hidden=false;let serial=0,calls=0;
  window.setInterval=callback=>{timers.set(++serial,callback);return serial;};
  window.clearInterval=id=>timers.delete(id);
  const poll=createVisiblePoll(()=>calls++,2000,{document,window});
  return {document,window,timers,poll,get calls(){return calls;}};
}
test('Repeated start creates one timer; visibility resumes fresh data',()=>{
  const f=fixture();f.poll.start();f.poll.start();
  assert.equal(f.calls,1);assert.equal(f.timers.size,1);
  f.document.hidden=true;f.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.timers.size,0);
  f.document.hidden=false;f.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.calls,2);assert.equal(f.timers.size,1);
});
test('Back-forward cache restores polling without duplicate timers',()=>{
  const f=fixture();f.poll.start();
  f.window.dispatchEvent(new Event('pagehide'));
  f.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.timers.size,0);
  f.window.dispatchEvent(new Event('pageshow'));f.window.dispatchEvent(new Event('pageshow'));
  assert.equal(f.calls,2);assert.equal(f.timers.size,1);
  f.poll.stop();f.window.dispatchEvent(new Event('pagehide'));f.window.dispatchEvent(new Event('pageshow'));
  assert.equal(f.timers.size,0);assert.equal(f.calls,2);
});
test('Deferred start avoids construction callbacks and still refreshes on return',()=>{
  const f=fixture();f.poll.start({immediate:false});
  assert.equal(f.calls,0);assert.equal(f.timers.size,1);
  f.window.dispatchEvent(new Event('pagehide'));f.window.dispatchEvent(new Event('pageshow'));
  assert.equal(f.calls,1);
});
