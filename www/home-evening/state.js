export const STORAGE_KEY = 'ha-evening-screen-demo-v1';
export const ROOMS = {living:'客餐厅',master:'主卧',secondary:'次卧',study:'书房',child:'儿童房'};
export const ROOM_LIGHTS = {living:['living','dining','tv','ceiling','hall','balcony'],master:['masterRed','masterYellow'],secondary:['secondary'],study:['study'],child:['child']};
export const LIGHT_NAMES = {living:'客厅射灯',dining:'餐厅吊灯',tv:'电视墙灯带',ceiling:'客厅顶部灯带',hall:'过道射灯',balcony:'阳台射灯',masterRed:'主卧主灯',masterYellow:'主卧筒灯',secondary:'次卧吸顶灯',study:'书房吸顶灯',child:'儿童房吸顶灯'};
export const KINDS = {lights:{name:'灯光',icon:'bulb'},ac:{name:'空调',icon:'snow'},floor:{name:'地暖',icon:'heat'},fresh:{name:'新风',icon:'wind'}};
export const SCENES = [{id:'home',name:'回家',icon:'home'},{id:'leave',name:'离家',icon:'leave'},{id:'sleep',name:'睡眠',icon:'moon'},{id:'lights-off',name:'关所有灯',icon:'bulb'},{id:'ac-off',name:'关所有空调',icon:'snow'},{id:'floor-off',name:'关所有地暖',icon:'heat'}];
const INITIAL = {
  lights:Object.fromEntries(Object.keys(LIGHT_NAMES).map(id=>[id,{on:true,brightness:65}])),
  ac:Object.fromEntries(['living','dining','master','secondary','study','child'].map(id=>[id,{on:id==='living',temperature:26,mode:'制冷',fan:'自动'}])),
  floor:Object.fromEntries(Object.keys(ROOMS).map(id=>[id,{on:id==='living',temperature:22}])),
  fresh:{on:true,speed:2,mode:'自动'},
  appliances:{washer:{on:true,paused:false,program:'标准洗',remaining:38,progress:62},fridge:{on:true,cool:4,freeze:-18,eco:false},purifier:{on:true,tds:15,filter:82},drinker:{on:true,temperature:45,volume:250}},
};
/** 创建可独立修改的模拟初始状态，禁止共享对象引用。 */
export function initialState() { return structuredClone(INITIAL); }
/** 读取独立页面保存的数据，仅接受与当前模板一致的字段和类型。 */
export function loadState(storage = globalThis.localStorage) {
  const state = initialState();
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (raw) mergeKnown(state, JSON.parse(raw));
  } catch (error) { console.error('Demo state loading failed', error); }
  return state;
}
/** 只合并已知模拟字段，忽略过期结构或被意外写入的属性。 */
function mergeKnown(target, source) {
  if (!source || typeof source !== 'object') return;
  for (const key of Object.keys(target)) {
    const value=source[key];
    if (target[key] && typeof target[key]==='object') mergeKnown(target[key],value);
    else if (typeof value===typeof target[key] && (typeof value!=='number'||Number.isFinite(value))) target[key]=value;
  }
}
/** 保存模拟状态；存储不可用时保留内存状态并记录错误。 */
export function saveState(state, storage = globalThis.localStorage) {
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch (error) { console.error('Demo state saving failed', error); }
}
/** 执行六种本地快捷模式，批量关闭操作仅影响所选设备类别。 */
export function applyScene(state, id) {
  if (id==='lights-off'||id==='leave'||id==='sleep') Object.values(state.lights).forEach(item=>{item.on=false;});
  if (id==='ac-off'||id==='leave') Object.values(state.ac).forEach(item=>{item.on=false;});
  if (id==='floor-off'||id==='leave'||id==='sleep') Object.values(state.floor).forEach(item=>{item.on=false;});
  if (id==='leave') state.fresh.on=false;
  if (id==='home') {
    Object.entries(state.lights).forEach(([key,item])=>{item.on=['living','dining','hall'].includes(key);item.brightness=65;});
    state.ac.living.on=true;state.ac.living.temperature=26;state.fresh.on=true;state.fresh.speed=2;
  }
  if (id==='sleep') {
    state.lights.masterYellow.on=true;state.lights.masterYellow.brightness=20;
    Object.values(state.ac).forEach(item=>{item.on=false;});state.ac.master.on=true;state.ac.master.temperature=24;
    state.fresh.on=true;state.fresh.speed=1;
  }
  return state;
}
/** 获取控制值的合法范围，防止温度和风速越界。 */
export function limits(kind) { return kind==='ac'?[16,30]:kind==='floor'?[16,35]:kind==='fridge'?[2,8]:kind==='freeze'?[-24,-16]:kind==='drinker'?[25,95]:[1,3]; }
/** 将加减结果限制在对应设备的范围内。 */
export function bounded(value, kind) { const [min,max]=limits(kind);return Math.max(min,Math.min(max,value)); }
