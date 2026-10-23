import './setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DEFAULT_PREFERENCES,normalizePreferences,resolveTheme,loadPreferences,deviceOpensRoomInfo} from '../../www/home-evening/preferences.js';

test('Display preferences reject unknown and invalid values',()=>{
  assert.deepEqual(normalizePreferences({theme:'invalid',rotation:'false',zoom:null,view:'side',markerKind:'washer',idleMinutes:-1,token:'unused'}),DEFAULT_PREFERENCES);
  assert.deepEqual(normalizePreferences(null),DEFAULT_PREFERENCES);
  assert.equal(normalizePreferences({idleMinutes:121}).idleMinutes,0);
  assert.equal(normalizePreferences({idleMinutes:1.5}).idleMinutes,0);
});
test('Auto theme follows the sun and keeps its current appearance when sun is missing',()=>{
  assert.equal(resolveTheme('auto','above_horizon','dark'),'light');
  assert.equal(resolveTheme('auto','below_horizon','light'),'dark');
  assert.equal(resolveTheme('auto','unavailable','light'),'light');
  assert.equal(resolveTheme('auto',undefined,'dark'),'dark');
  assert.equal(resolveTheme('dark','above_horizon'),'dark');
  assert.equal(resolveTheme('light','below_horizon'),'light');
});
test('Stored display preferences restore independently of device state',()=>{
  const value={theme:'auto',rotation:false,zoom:false,view:'angled',markers:false,markerKind:'all',motion:false,idleMinutes:5,applianceColumns:4};
  assert.deepEqual(loadPreferences({getItem:()=>JSON.stringify(value)}),{...DEFAULT_PREFERENCES,...value});
  assert.deepEqual(loadPreferences({getItem:()=>null}),DEFAULT_PREFERENCES);
});
test('Appliance density accepts only supported numeric column counts',()=>{
  for(const value of [2,3,4])assert.equal(normalizePreferences({applianceColumns:value}).applianceColumns,value);
  for(const value of [0,1,5,'4',null])assert.equal(normalizePreferences({applianceColumns:value}).applianceColumns,3);
});

test('Room information idle seconds migrate to ten and accept disabled or bounded seconds',()=>{
  assert.equal(normalizePreferences({}).roomPanelSeconds,10);
  for(const value of [0,1,10,300])assert.equal(normalizePreferences({roomPanelSeconds:value}).roomPanelSeconds,value);
  for(const value of [-1,301,1.5,'10',null])assert.equal(normalizePreferences({roomPanelSeconds:value}).roomPanelSeconds,10);
});

test('Auto open room info stays off unless the stored value is boolean true',()=>{
  assert.equal(DEFAULT_PREFERENCES.autoOpenRoomInfo,false);
  assert.equal(normalizePreferences({}).autoOpenRoomInfo,false);
  assert.equal(normalizePreferences({autoOpenRoomInfo:true}).autoOpenRoomInfo,true);
  assert.equal(normalizePreferences({autoOpenRoomInfo:false}).autoOpenRoomInfo,false);
  for(const value of ['true','false',1,0,null])assert.equal(normalizePreferences({autoOpenRoomInfo:value}).autoOpenRoomInfo,false);
  assert.equal(loadPreferences({getItem:()=>null}).autoOpenRoomInfo,false);
  assert.equal(loadPreferences({getItem:()=>JSON.stringify({theme:'light'})}).autoOpenRoomInfo,false);
  assert.equal(loadPreferences({getItem:()=>JSON.stringify({autoOpenRoomInfo:true})}).autoOpenRoomInfo,true);
});
test('House icons open room info only after the preference is enabled',()=>{
  const off=normalizePreferences({});
  assert.deepEqual(deviceOpensRoomInfo(off,{page:'home',roomValid:true,panelOpen:false}),{track:false,open:false,switchRoom:false});
  assert.deepEqual(deviceOpensRoomInfo(off,{page:'home',roomValid:true,panelOpen:true,sameRoom:false}),{track:false,open:false,switchRoom:false});
  const on=normalizePreferences({autoOpenRoomInfo:true});
  assert.deepEqual(deviceOpensRoomInfo(on,{page:'home',roomValid:true,panelOpen:false}),{track:true,open:true,switchRoom:false});
  assert.deepEqual(deviceOpensRoomInfo(on,{page:'home',roomValid:true,panelOpen:true,sameRoom:false}),{track:true,open:false,switchRoom:true});
  assert.deepEqual(deviceOpensRoomInfo(on,{page:'home',roomValid:true,panelOpen:true,sameRoom:true}),{track:true,open:false,switchRoom:false});
  assert.deepEqual(deviceOpensRoomInfo(on,{page:'appliances',roomValid:true,panelOpen:false}),{track:false,open:false,switchRoom:false});
  assert.deepEqual(deviceOpensRoomInfo(on,{page:'home',roomValid:false,panelOpen:false}),{track:false,open:false,switchRoom:false});
});
test('Room info setting uses the existing settings switch',()=>{
  const source=readFileSync(new URL('../../www/home-evening/settings.js',import.meta.url),'utf8');
  assert.match(source,/switchRow\('autoOpenRoomInfo','是否自动打开房间信息'/);
});
test('House mode defaults old and invalid preferences to 2D and persists explicit 3D',()=>{
  assert.equal(normalizePreferences({view:'angled'}).houseMode,'2d');
  for(const houseMode of ['3d','2d'])assert.equal(loadPreferences({getItem:()=>JSON.stringify({houseMode})}).houseMode,houseMode);
  for(const houseMode of ['top','3D',null,0])assert.equal(normalizePreferences({houseMode}).houseMode,'2d');
});
