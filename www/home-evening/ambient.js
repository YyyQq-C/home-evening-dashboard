/** 按整点返回背景序号，同一小时内所有设备结果一致。 */
export function ambientIndex(now,count){
  const size=Number(count);
  if(!Number.isInteger(size)||size<1)return 0;
  const hour=Math.floor(Number(now)/3600000);
  if(!Number.isFinite(hour))return 0;
  return ((hour%size)+size)%size;
}

export const DEFAULT_BACKGROUND_SETTINGS={source:'builtin',cycle:true,mode:'sequential',interval_seconds:3600,fit:'cover',selected_id:''};
const NAMES={dark:['深空星夜','丝带流光','暖光客厅'],light:['日光叶影','日光客厅','建筑线稿']};
const FILES={dark:['background-night.webp','background-night-aurora.webp','background-night-interior.webp'],light:['background-day.webp','background-day-interior.webp','background-day-lineart.webp']};
export const BUILTIN_BACKGROUNDS=['dark','light'].flatMap(theme=>FILES[theme].map((file,index)=>({id:`builtin-${theme}-${index}`,theme,index,name:NAMES[theme][index],url:`./assets/${file}`,thumbnail_url:`./assets/${file}`,width:2000,height:1200,builtin:true,enabled:true})));

/** 校验服务器返回的图库，仅构造本页面受管理的同源图片路径。 */
export function normalizeBackgroundState(value={}){
  const input=value&&typeof value==='object'?value:{},settings={...DEFAULT_BACKGROUND_SETTINGS};
  for(const [key,allowed] of Object.entries({source:['builtin','custom','all'],mode:['sequential','random'],fit:['cover','contain','stretch']}))if(allowed.includes(input.settings?.[key]))settings[key]=input.settings[key];
  if(typeof input.settings?.cycle==='boolean')settings.cycle=input.settings.cycle;
  if(Number.isInteger(input.settings?.interval_seconds)&&input.settings.interval_seconds>=5&&input.settings.interval_seconds<=86400)settings.interval_seconds=input.settings.interval_seconds;
  const seen=new Set(),images=[];
  for(const image of Array.isArray(input.images)?input.images:[]){
    if(!image||!/^[0-9a-f]{32}$/.test(image.id)||seen.has(image.id)||!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<1||image.height<1)continue;
    seen.add(image.id);
    images.push({...image,name:String(image.name||'背景图片').slice(0,120),theme:['all','light','dark'].includes(image.theme)?image.theme:'all',enabled:image.enabled!==false,builtin:false,url:`/api/home_evening/backgrounds/image/${image.id}/original`,thumbnail_url:`/api/home_evening/backgrounds/image/${image.id}/thumbnail`});
  }
  const selected=input.settings?.selected_id;
  if(BUILTIN_BACKGROUNDS.some(image=>image.id===selected)||images.some(image=>image.id===selected))settings.selected_id=selected;
  return {revision:Number.isInteger(input.revision)&&input.revision>=0?input.revision:0,anchor_ms:Number.isFinite(input.anchor_ms)&&input.anchor_ms>=0?input.anchor_ms:0,settings,images};
}

/** 按来源、启用状态和深浅主题生成实际轮换队列。 */
export function backgroundPool(state,theme){
  const source=state.settings.source;
  return [...(source==='custom'?[]:BUILTIN_BACKGROUNDS),...(source==='builtin'?[]:state.images)].filter(image=>(image.enabled||!state.settings.cycle&&image.id===state.settings.selected_id)&&(image.theme==='all'||image.theme===theme));
}

/** 将共享种子转换为跨设备一致的随机状态。 */
function seedNumber(text){
  let value=2166136261;
  for(const char of text)value=Math.imul(value^char.charCodeAt(0),16777619);
  return value>>>0;
}

/** 生成指定轮次的确定性洗牌，首轮可从用户选择的图片开始。 */
function shuffled(pool,round,seed,selected){
  const result=[...pool];let value=seedNumber(seed+':'+round)||1;
  for(let i=result.length-1;i>0;i--){value^=value<<13;value^=value>>>17;value^=value<<5;const j=(value>>>0)%(i+1);[result[i],result[j]]=[result[j],result[i]];}
  const index=round===0?result.findIndex(image=>image.id===selected):-1;
  if(index>0)result.unshift(...result.splice(index,1));
  return result;
}

/** 根据共享规则选择当前图片；空图库回退内置背景，随机轮换避免连续重复。 */
export function backgroundAt(state,theme,now=Date.now()){
  let pool=backgroundPool(state,theme);const fallback=pool.length===0;
  if(fallback)pool=BUILTIN_BACKGROUNDS.filter(image=>image.theme===theme);
  const {settings}=state,size=pool.length,base=Math.max(0,pool.findIndex(image=>image.id===settings.selected_id));
  const step=settings.cycle?Math.max(0,Math.floor((now-state.anchor_ms)/(settings.interval_seconds*1000))):0;
  let image;
  if(settings.mode==='sequential')image=pool[(base+step)%size];
  else{
    const seed=pool.map(item=>item.id).join(':')+':'+state.anchor_ms,round=Math.floor(step/size);
    if(size<=2)image=shuffled(pool,0,seed,settings.selected_id)[step%size];
    else{
      const order=shuffled(pool,round,seed,settings.selected_id);
      // 交换首两项不改变上一轮末项，因此无需递归重建更早的随机轮次。
      if(round>0&&order[0].id===shuffled(pool,round-1,seed,settings.selected_id).at(-1).id)[order[0],order[1]]=[order[1],order[0]];
      image=order[step%size];
    }
  }
  return {...image,fallback};
}

/** 返回保持比例裁切、完整留边和拉伸铺满三种图片显示尺寸。 */
export function backgroundSize(fit){return fit==='contain'?'contain':fit==='stretch'?'100% 100%':'cover';}
