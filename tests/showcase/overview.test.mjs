import './setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {overviewStatus,restoreElectricityElement,collapseSdReplay,stabilizeElectricityCharts,currentMonthElectricity} from '../../www/home-evening/home-overview.js';

test('Current month electricity sums daily records independently of the missing monthly bill',()=>{
  const entity={state:'72.3',attributes:{daylist:[
    {day:'2026-10-01',dayEleNum:0.1},{day:'2026-10-02 00:00:00',dayEleNum:'0.2'},
    {day:'2026-09-30',dayEleNum:100},{day:'2026-10-22',dayEleNum:100},
    {day:'2026-10-02',dayEleNum:9},{day:'2026-10-03',dayEleNum:null},
    {day:'2026-10-04',dayEleNum:''},{day:'2026-10-05',dayEleNum:-1},
    {day:'2026-10-06',dayEleNum:'unknown'},{day:'2026-10-07',dayEleNum:true}
  ],monthlist:[{month:'2026-10',monthEleNum:999}]}};
  const original=JSON.stringify(entity);
  assert.deepEqual(currentMonthElectricity(entity,Date.parse('2026-10-21T02:00:00Z')),
    {month:'2026-10',total:0.3,days:2,lastDay:'2026-10-02',cost:null});
  assert.equal(JSON.stringify(entity),original);
});
test('Current month electricity preserves zero readings and distinguishes missing data from zero',()=>{
  const entity={state:'0',attributes:{daylist:[{day:'2026-10-01',dayEleNum:0}],monthlist:[{month:'2026-10',monthEleCost:0}]}};
  const now=Date.parse('2026-10-21T02:00:00Z');
  assert.equal(currentMonthElectricity(entity,now).total,0);
  assert.equal(currentMonthElectricity(entity,now).cost,0);
  entity.attributes.daylist=[];
  assert.equal(currentMonthElectricity(entity,now).total,null);
  entity.state='unavailable';
  assert.equal(currentMonthElectricity(entity,now).total,null);
});
test('Current month electricity follows the household timezone across month and year boundaries',()=>{
  const entity={state:'1',attributes:{daylist:[{day:'2026-12-31',dayEleNum:3},{day:'2027-01-01',dayEleNum:4}]}};
  const now=Date.parse('2026-12-31T16:30:00Z');
  assert.equal(currentMonthElectricity(entity,now,'Asia/Shanghai').total,4);
  assert.equal(currentMonthElectricity(entity,now,'America/Los_Angeles').total,3);
});

/** 创建仅包含家中状态实体的测试缓存。 */
function fixture() {
  return {connected:true,states:Object.fromEntries([
    ['binary_sensor.example_istoreos_wan_connectivity','on'],['sensor.example_tp_link_ap_clients','0'],
    ['binary_sensor.example_home_network_issue','off'],['binary_sensor.example_tp_link_device_issue','off'],
    ['binary_sensor.example_truenas_health_issue','off']
  ].map(([id,state])=>[id,{state}]))};
}
test('Overview retains zero wireless clients and only reports healthy when every source is available',()=>{
  const hass=fixture(),status=overviewStatus(hass);
  assert.equal(status.headline,'家里一切安稳');assert.equal(status.items[1].text,'0 台');
  delete hass.states['binary_sensor.example_truenas_health_issue'];
  assert.equal(overviewStatus(hass).headline,'部分家中状态暂不可用');
});
test('Overview prioritizes real network alerts and disconnected internet',()=>{
  const hass=fixture();hass.states['binary_sensor.example_istoreos_wan_connectivity'].state='off';
  assert.equal(overviewStatus(hass).items[0].alert,true);
  hass.states['binary_sensor.example_tp_link_device_issue'].state='on';
  assert.equal(overviewStatus(hass).headline,'家里有事项需要留意');
});
test('Overview never presents cached statuses as available after host disconnects',()=>{
  const hass=fixture();hass.connected=false;
  assert.ok(overviewStatus(hass).items.every(item=>!item.valid&&item.text==='暂不可用'));
  assert.ok(overviewStatus(null).items.every(item=>!item.valid));
});
test('restoreElectricityElement unshadows Lit prototype accessors and returns unscaled chart dimensions',()=>{
  const updates=[];
  class MockMainInfoPanel {
    constructor(){
      // 模拟 ES2022 实例字段遮蔽原型 getter/setter。
      Object.defineProperty(this,'showPanel',{value:'calendar',writable:true,enumerable:true,configurable:true});
    }
    requestUpdate(){updates.push(this._showPanel);}
  }
  Object.defineProperty(MockMainInfoPanel.prototype,'showPanel',{
    get(){return this._showPanel;},
    set(value){this._showPanel=value;this.requestUpdate();},
    configurable:true
  });
  const panel=new MockMainInfoPanel();
  restoreElectricityElement(panel);
  assert.equal(Object.prototype.hasOwnProperty.call(panel,'showPanel'),false);
  assert.equal(panel.showPanel,'calendar');
  panel.showPanel='dayUsage';
  assert.equal(panel.showPanel,'dayUsage');
  assert.ok(updates.includes('dayUsage'));
  const updateCount=updates.length;
  restoreElectricityElement(panel);
  assert.equal(updates.length,updateCount,'Observing chart DOM must not schedule another Lit update');

  const chartHost={
    tagName:'DAY-CHART-VIEW',
    clientWidth:800,
    clientHeight:440,
    _chartManager:{_chart:null},
    shadowRoot:{querySelector:()=>({clientWidth:776,clientHeight:440})}
  };
  restoreElectricityElement(chartHost);
  chartHost._chartManager._chart={opts:{chart:{height:230}}};
  assert.equal(chartHost._chartManager._chart.opts.chart.height,'100%');
  const rect=chartHost.getBoundingClientRect();
  assert.equal(rect.width,776);
  assert.equal(rect.height,440);
});
test('Electricity charts retain identical data across polling and redraw on data, theme, or remount changes',()=>{
  for(const method of ['renderDayChart','renderMonthChart']){
    let renders=0;
    const manager={_theme:'off',[method](){renders++;this._chart={};}};
    const container={};
    stabilizeElectricityCharts(manager);
    manager[method](container,{values:[1,2]});
    manager[method](container,{values:[1,2]});
    assert.equal(renders,1);
    manager[method](container,{values:[1,3]});
    assert.equal(renders,2);
    manager._theme='on';
    manager[method](container,{values:[1,3]});
    assert.equal(renders,3);
    manager._chart=null;
    manager[method](container,{values:[1,3]});
    assert.equal(renders,4);
    manager[method]({}, {values:[1,3]});
    assert.equal(renders,5);
  }
});
test('SD replay collapse hides the player and stops the current clip',()=>{
  const video={paused:false,src:'https://ha.example/replay',pause(){this.paused=true;},removeAttribute(name){if(name==='src')this.src='';},load(){this.loaded=true;}};
  const player={hidden:false};
  const clip={pressed:'true',setAttribute(name,value){if(name==='aria-pressed')this.pressed=value;}};
  const root={
    querySelector(selector){return selector==='.player'?player:selector==='video'?video:null;},
    querySelectorAll(selector){return selector==='.clip'?[clip]:[];}
  };
  collapseSdReplay(root);
  assert.equal(player.hidden,true);
  assert.equal(video.paused,true);
  assert.equal(video.src,'');
  assert.equal(video.loaded,true);
  assert.equal(clip.pressed,'false');
});
