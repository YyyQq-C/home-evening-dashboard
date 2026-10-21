export const PREFERENCE_KEY='ha-evening-screen-preferences-v1';
export const DEFAULT_PREFERENCES={theme:'dark',houseMode:'2d',rotation:true,zoom:true,view:'top',markers:true,markerKind:'lights',motion:true,idleMinutes:0,applianceColumns:3,roomPanelSeconds:10,autoOpenRoomInfo:false};
/** 只接受已知显示偏好，避免旧数据或异常值影响页面。 */
export function normalizePreferences(value={}) {
  const result={...DEFAULT_PREFERENCES};
  for(const key of ['rotation','zoom','markers','motion','autoOpenRoomInfo'])if(typeof value?.[key]==='boolean')result[key]=value[key];
  for(const [key,allowed] of Object.entries({theme:['dark','light','auto'],houseMode:['2d','3d'],view:['top','angled'],markerKind:['all','lights','ac','fresh','floor']}))if(allowed.includes(value?.[key]))result[key]=value[key];
  if(Number.isInteger(value?.idleMinutes)&&value.idleMinutes>=0&&value.idleMinutes<=120)result.idleMinutes=value.idleMinutes;
  if(Number.isInteger(value?.roomPanelSeconds)&&value.roomPanelSeconds>=0&&value.roomPanelSeconds<=300)result.roomPanelSeconds=value.roomPanelSeconds;
  if([2,3,4].includes(value?.applianceColumns))result.applianceColumns=value.applianceColumns;
  return result;
}
/** 从独立存储键读取显示设置，失败时使用默认值并记录日志。 */
export function loadPreferences(storage=globalThis.localStorage) {
  try{return normalizePreferences(JSON.parse(storage.getItem(PREFERENCE_KEY)||'{}'));}
  catch(error){console.error('Evening preferences loading failed',error);return {...DEFAULT_PREFERENCES};}
}
/** 点击房屋图标时，只有明确开启才自动打开或切换房间信息。 */
export function deviceOpensRoomInfo(preferences,{page='home',roomValid=false,panelOpen=false,sameRoom=false}={}) {
  const enabled=preferences?.autoOpenRoomInfo===true&&page==='home'&&roomValid;
  return {track:enabled,open:enabled&&!panelOpen,switchRoom:enabled&&panelOpen&&!sameRoom};
}
/** 根据家庭太阳状态解析外观，缺失状态时保持现有主题。 */
export function resolveTheme(mode,sunState,current='dark') {
  if(mode!=='auto')return mode==='light'?'light':'dark';
  if(sunState==='above_horizon')return 'light';
  if(sunState==='below_horizon')return 'dark';
  return current==='light'?'light':'dark';
}
