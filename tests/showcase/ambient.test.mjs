import './setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {ambientIndex} from '../../www/home-evening/ambient.js';

const HOUR=3600000;

test('Ambient index stays inside the pool and is stable within one hour',()=>{
  const start=Date.UTC(2026,9,20,6,0,0);
  assert.equal(ambientIndex(start,3),ambientIndex(start+HOUR-1,3));
  assert.notEqual(ambientIndex(start,3),ambientIndex(start+HOUR,3));
});

test('Ambient index cycles through three backgrounds at each hour boundary',()=>{
  const start=Date.UTC(2026,0,1,0,0,0);
  const sequence=[0,1,2].map(offset=>ambientIndex(start+offset*HOUR,3));
  assert.deepEqual(sequence,[ambientIndex(start,3),(ambientIndex(start,3)+1)%3,(ambientIndex(start,3)+2)%3]);
  assert.equal(ambientIndex(start+3*HOUR,3),ambientIndex(start,3));
});

test('Ambient index rejects an unusable pool size',()=>{
  assert.equal(ambientIndex(Date.UTC(2026,9,20,6,30,0),0),0);
  assert.equal(ambientIndex(Number.NaN,3),0);
});
