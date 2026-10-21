import {SITE,entityId} from './site-config.js';
import {createVisiblePoll} from './runtime.js';
// 编号顺序分别依据用户确认及当前 HA 实体名称核对，空调与地暖不能共用顺序。
export const ROOM_CLIMATE_ENTITIES={
  ac:{master:entityId('climate.example_ac_master'),secondary:entityId('climate.example_ac_secondary'),child:entityId('climate.example_ac_child'),dining:entityId('climate.example_ac_dining'),living:entityId('climate.example_ac_living'),study:entityId('climate.example_ac_study')},
  floor:{master:entityId('climate.example_floor_master'),secondary:entityId('climate.example_floor_secondary'),study:entityId('climate.example_floor_study'),living:entityId('climate.example_floor_living'),child:entityId('climate.example_floor_child')}
};
const MODES={cool:'制冷',heat:'制热',dry:'除湿',fan_only:'送风',auto:'自动',heat_cool:'自动'},FANS={auto:'自动',low:'低速',medium:'中速',high:'高速'};
/** 只接受真实有限数字，缺失温度不转换为零。 */
function number(value){return typeof value==='number'&&Number.isFinite(value)?value:null;}
/** 将当前宿主状态转为房间读数，离线或断线时完全丢弃缓存属性。 */
export function roomClimateReading(kind,id,hass){
  const entityId=ROOM_CLIMATE_ENTITIES[kind]?.[id],entity=hass?.connected!==false?hass?.states?.[entityId]:null;
  const available=!!entity&&typeof entity.state==='string'&&!['unknown','unavailable',''].includes(entity.state),a=available?entity.attributes||{}:{};
  return {entityId,available,on:available?entity.state!=='off':null,status:!available?'暂不可用':entity.state==='off'?'已关闭':a.hvac_action==='idle'?'待机':MODES[entity.state]||'已开启',
    temperature:number(a.temperature),currentTemperature:number(a.current_temperature),mode:available?MODES[entity.state]||null:null,fan:available?FANS[a.fan_mode]||a.fan_mode||null:null,
    min:number(a.min_temp),max:number(a.max_temp),step:number(a.target_temp_step)||1,modes:Array.isArray(a.hvac_modes)?a.hvac_modes.map(value=>MODES[value]).filter(Boolean):[],reportedAt:available?entity.last_updated||null:null};
}
/** 复用 HA 宿主已有连接与状态缓存，仅轮询内存，不调用刷新或任何设备服务。 */
export function createRoomClimateSource({onChange}){
  const fingerprints=new Map();let warned=false;
  /** 获取同源宿主的既有状态，独立预览不建立认证连接。 */
  function hass(){try{return window.parent!==window?window.parent.document.querySelector('home-assistant')?.hass:null;}catch(error){if(!warned){console.warn('Room climate host unavailable',error);warned=true;}return null;}}
  /** 读取单个设备当前真实读数。 */
  function read(kind,id){return roomClimateReading(kind,id,hass());}
  /** 仅在真实读数改变时通知界面，模拟编辑不会触发反向同步。 */
  function refresh(){
    const source=hass(),changed=[];
    for(const [kind,devices] of Object.entries(ROOM_CLIMATE_ENTITIES))for(const id of Object.keys(devices)){
      const reading=roomClimateReading(kind,id,source),{reportedAt,...values}=reading,key=`${kind}:${id}`,signature=JSON.stringify(values);
      if(fingerprints.get(key)!==signature){fingerprints.set(key,signature);changed.push({kind,id,reading});}
    }
    if(changed.length)onChange(changed);
  }
  const {start,stop}=createVisiblePoll(refresh,2000);
  return {read,start,stop};
}
