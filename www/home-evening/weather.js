import {SITE} from './site-config.js';
import {createVisiblePoll} from './runtime.js';
import {icon} from './icons.js';
import {WEATHER_ENTITY,weatherCondition,weatherNumber as number,weatherEscape as escape,forecastWindow,forecastNight,hourlyTimeline,weatherSensorGroups} from './weather-data.js';

/** 创建只读天气面板，复用 HA 既有连接和缓存预报，不调用刷新或设备服务。 */
export function createWeather({onOpen}) {
  const host=document.querySelector('#weather-layer'),trigger=document.querySelector('#weather');
  let hass=null,connection=null,epoch=0,hourly=[],daily=[],opened=false,signature='',selectedHour=null,selectedDay=null,metric=null,previousFocus;
  const subscriptions=new Map(),inertStates=new Map();
  const value=(v,unit='')=>number(v)===null?'—':`${Math.round(number(v)*10)/10}${escape(unit)}`;
  /** 仅访问同源宿主已经持有的 HA 会话，不新建令牌或额外连接。 */
  function readHass() {
    try{return window.parent!==window?window.parent.document.querySelector('home-assistant')?.hass:null;}
    catch(error){console.warn('Evening weather host unavailable',error);return null;}
  }
  /** 返回家庭时区，独立预览采用已有上海时区。 */
  function timeZone() {return hass?.config?.time_zone||'Asia/Shanghai';}
  /** 以家庭时区显示气象数据时间，缺失时间不伪造。 */
  function time(date,options={hour:'2-digit',minute:'2-digit',hour12:false}) {
    return date&&Number.isFinite(new Date(date).getTime())?new Intl.DateTimeFormat('zh-CN',{timeZone:timeZone(),...options}).format(new Date(date)):'—';
  }
  /** 读取当前天气源对应的有效附属传感器，断线或实体离线时不显示缓存。 */
  function sensor(key) {
    if(hass?.connected===false)return null;
    const entity=hass?.states?.[SITE.weather.sensors[key]];
    return entity&&!['unknown','unavailable',''].includes(entity.state)?entity:null;
  }
  /** 根据实体可用性组织当前天气，不将模拟设备状态当作气象数据。 */
  function current() {
    const entity=hass?.states?.[WEATHER_ENTITY],valid=hass?.connected!==false&&entity&&!['unknown','unavailable'].includes(entity.state);
    return {entity,valid,attrs:valid?entity.attributes:{}};
  }
  /** 将数字或中文风向转换为可读风向。 */
  function wind(bearing) {
    if(typeof bearing==='string'&&number(bearing)===null)return escape(bearing);
    return number(bearing)===null?'风向暂无数据':['北','东北','东','东南','南','西南','西','西北'][Math.round(number(bearing)/45)%8]+'风';
  }
  /** 取消旧的预报订阅并隔离过期回调，断线重连时重新订阅。 */
  function clearSubscriptions() {
    epoch++;
    for(const entry of subscriptions.values())if(entry.unsubscribe)try{entry.unsubscribe();}catch(error){console.warn('Evening weather unsubscribe failed',error);}
    subscriptions.clear();hourly=[];daily=[];
  }
  /** 订阅 HA 缓存预报，失败按一分钟间隔重试，不触发供应商强制刷新。 */
  function subscribe(type,flag) {
    const {valid,attrs}=current(),previous=subscriptions.get(type);
    if(!valid||typeof connection?.subscribeMessage!=='function'||!(attrs.supported_features&flag)||previous&&(previous.pending||previous.unsubscribe||Date.now()<previous.retryAt))return;
    const generation=epoch,entry={pending:true,retryAt:0};subscriptions.set(type,entry);
    connection.subscribeMessage(event=>{
      if(generation!==epoch||subscriptions.get(type)!==entry)return;
      if(type==='hourly')hourly=Array.isArray(event.forecast)?event.forecast:[];else daily=Array.isArray(event.forecast)?event.forecast:[];
      signature='';render();
    },{type:'weather/subscribe_forecast',entity_id:WEATHER_ENTITY,forecast_type:type}).then(unsubscribe=>{
      if(generation!==epoch){unsubscribe();return;}entry.unsubscribe=unsubscribe;entry.pending=false;signature='';render();
    }).catch(error=>{
      if(generation!==epoch)return;console.warn('Evening forecast subscription failed',type,error);entry.pending=false;entry.retryAt=Date.now()+60000;signature='';render();
    });
  }
  /** 同步已有 HA 状态；只有数据或分钟改变时更新 DOM，保留滚动和焦点。 */
  function refresh() {
    hass=readHass();const next=hass?.connected===false?null:hass?.connection;
    if(next!==connection){clearSubscriptions();connection=next;signature='';}
    subscribe('hourly',2);subscribe('daily',1);render();
  }
  /** 生成包含实际气象指标、数据单位和说明的卡片。 */
  function metrics(attrs) {
    const uv=sensor('uv_index'),air=sensor('qlty'),pm=sensor('pm2_5'),rain=sensor('precip'),solar=hass?.states?.['sun.sun'];
    const sun=hass?.connected===false||!solar||['unknown','unavailable'].includes(solar.state)?null:solar;
    return [
      {id:'feel',name:'体感温度',icon:'temperature',reading:value(attrs.apparent_temperature,attrs.temperature_unit||'°C'),note:'室外体感',detail:'体感温度综合反映温度、湿度及风等因素，由天气源提供。'},
      {id:'humidity',name:'湿度',icon:'drop',reading:value(attrs.humidity,'%'),note:`露点 ${value(attrs.dew_point,attrs.temperature_unit||'°C')}`,detail:'相对湿度与露点均来自当前天气源；不是室内传感器读数。'},
      {id:'wind',name:'风',icon:'wind',reading:value(attrs.wind_speed,attrs.wind_speed_unit||''),note:wind(attrs.wind_bearing),detail:`风向 ${wind(attrs.wind_bearing)} · 阵风 ${value(attrs.wind_gust_speed,attrs.wind_speed_unit||'')}`},
      {id:'rain',name:'小时降水量',icon:'rain',reading:value(rain?.state,rain?.attributes?.unit_of_measurement||'mm/h'),note:'天气源当前小时记录',detail:'这是当前小时降水量，不是过去24小时累计降水。逐小时降水概率可在上方预报中查看。'},
      {id:'uv',name:'紫外线',icon:'sun',reading:uv?escape(uv.state):value(attrs.uv_index),note:'当前紫外线情况',detail:escape(uv?.attributes?.states&&uv.attributes.states!=='null'?uv.attributes.states:'天气源未提供进一步说明。')},
      {id:'air',name:'空气质量',icon:'leaf',reading:air?escape(air.state):'—',note:`PM2.5 ${value(pm?.state,pm?.attributes?.unit_of_measurement||'μg/m³')}`,detail:'空气质量指数及颗粒物浓度来自和风天气；不使用室内空气设备数据。'},
      {id:'visibility',name:'能见度',icon:'eye',reading:value(attrs.visibility,attrs.visibility_unit||''),note:'室外水平能见度',detail:'当前天气源提供的室外水平能见距离。'},
      {id:'pressure',name:'气压',icon:'gauge',reading:value(attrs.pressure,attrs.pressure_unit||''),note:`云量 ${value(attrs.cloud_coverage,'%')}`,detail:'气压和云量由天气源提供；暂无历史趋势数据时不绘制趋势箭头。'},
      {id:'sun',name:'日出与日落',icon:'sunrise',reading:time(sun?.attributes?.next_setting),note:`下次日落 · 日出 ${time(sun?.attributes?.next_rising)}`,detail:`下次日落：${time(sun?.attributes?.next_setting,{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false})}；下次日出：${time(sun?.attributes?.next_rising,{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false})}。时间来自 HA 家庭位置的太阳数据。`}
    ];
  }
  /** 将预报已提供的数值逐项展开，不为缺失字段编造内容。 */
  function forecastDetails(row,attrs) {
    const fields=[['apparent_temperature','体感',attrs.temperature_unit||'°C'],['precipitation_probability','降水概率','%'],['precipitation','降水',row.precipitation_unit||attrs.precipitation_unit||'mm'],['humidity','湿度','%'],['dew_point','露点',attrs.temperature_unit||'°C'],['wind_speed','风速',attrs.wind_speed_unit||''],['wind_gust_speed','阵风',attrs.wind_speed_unit||''],['pressure','气压',attrs.pressure_unit||''],['cloud_coverage','云量','%'],['uv_index','紫外线','']];
    return [row.wind_bearing!==undefined?wind(row.wind_bearing):'',...fields.filter(([key])=>number(row[key])!==null).map(([key,label,unit])=>`${label} ${value(row[key],unit)}`)].filter(Boolean).join(' · ');
  }
  /** 展示天气附属传感器及其原始说明，报告时间与顶部天气更新时间分别标注。 */
  function extraSections(groups) {
    return groups.map(group=>`<section class="wx-extra-section" data-weather-group="${group.id}"><h3>${icon(group.icon)}${group.name}</h3>${group.id==='observation'?'<p class="wx-extra-note">以下为天气源附属观测，可能与上方概览的报告时间不同。</p>':''}<div class="wx-extra-grid">${group.rows.map(row=>`<article class="wx-card wx-extra-card" data-weather-sensor="${row.id}"><h4>${escape(row.name)}</h4><strong>${row.key==='disaster_warn'?({'off':'未触发','on':'已触发'}[row.state]||escape(row.state)):escape(row.state)}${row.unit?`<span>${escape(row.unit)}</span>`:''}</strong>${row.detail?`<p>${escape(row.detail)}</p>`:''}<small>状态报告于 ${time(row.reported,{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false})}</small></article>`).join('')}</div></section>`).join('');
  }
  /** 展示家庭位置太阳实体已有的事件时间和方位，不推算不存在的日期。 */
  function solarSection() {
    const sun=hass?.connected===false?null:hass?.states?.['sun.sun'];
    if(!sun||!['above_horizon','below_horizon'].includes(sun.state))return '';
    const attrs=sun.attributes||{},dateOptions={month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false};
    const rows=[['next_rising','下次日出'],['next_setting','下次日落'],['next_dawn','下次黎明'],['next_dusk','下次黄昏'],['next_noon','下次正午'],['next_midnight','下次午夜']].filter(([key])=>attrs[key]&&Number.isFinite(Date.parse(attrs[key]))).map(([key,name])=>({name,reading:time(attrs[key],dateOptions)}));
    for(const [key,name] of [['elevation','太阳高度角'],['azimuth','太阳方位角']])if(number(attrs[key])!==null)rows.push({name,reading:value(attrs[key],'°')});
    if(!rows.length)return '';
    return `<section class="wx-extra-section" data-weather-group="solar"><h3>${icon('sunrise')}太阳时刻与方位</h3><div class="wx-extra-grid">${rows.map(row=>`<article class="wx-card wx-extra-card"><h4>${row.name}</h4><strong>${row.reading}</strong></article>`).join('')}</div></section>`;
  }
  /** 生成小时天气与日出日落时间轴，保留天气小时选择及横向手势。 */
  function hourCards(rows) {
    const sun=hass?.connected===false?null:hass?.states?.['sun.sun'];
    return hourlyTimeline(rows,sun).map(item=>{
      if(item.kind!=='weather') {
        const label=item.kind==='sunrise'?'日出':'日落';
        return `<div class="wx-solar" data-solar-event="${item.kind}" data-solar-time="${escape(item.datetime)}" role="img" aria-label="${escape(time(item.datetime,{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}))} ${label}"><span>${time(item.datetime)}</span>${icon(item.kind)}<strong>${label}</strong><small>太阳时刻</small></div>`;
      }
      const row=item.row,[label,shape]=weatherCondition(row.condition,forecastNight(row,sun)),key=row.datetime;
      return `<button type="button" class="wx-hour" data-weather-hour="${escape(key)}" aria-pressed="${selectedHour===key}" aria-label="${escape(time(key,{month:'numeric',day:'numeric',hour:'2-digit',hour12:false}))}，${label}，${value(row.temperature,'°')}，降水概率${value(row.precipitation_probability,'%')}"><span>${time(key,{hour:'2-digit',hour12:false})}</span>${icon(shape)}<strong>${value(row.temperature,'°')}</strong><small>${value(row.precipitation_probability,'%')}</small></button>`;
    }).join('');
  }
  /** 绘制五日温度区间，缺失高低温时保留占位而不生成虚假区间。 */
  function dayCards(rows,windowData) {
    const ranges=rows.map(row=>[number(row.templow),number(row.temperature)]).filter(([low,high])=>low!==null&&high!==null&&low<=high);
    const min=ranges.length?Math.min(...ranges.map(row=>row[0])):0,max=ranges.length?Math.max(...ranges.map(row=>row[1])):1,span=Math.max(1,max-min);
    return rows.map(row=>{const [label,shape]=weatherCondition(row.condition),low=number(row.templow),high=number(row.temperature),valid=low!==null&&high!==null&&low<=high;
      return `<button type="button" class="wx-day" data-weather-day="${escape(row.datetime)}" aria-expanded="${selectedDay===row.datetime}"><span>${windowData.dateKey(row.datetime)===windowData.today?'今天':time(row.datetime,{weekday:'short'})}</span><span class="wx-day-art">${icon(shape)}<small>${value(row.precipitation_probability,'%')}</small></span><span class="wx-low">${value(low,'°')}</span><span class="wx-temperature-track">${valid?`<i style="left:${(low-min)/span*100}%;width:${Math.max(2,(high-low)/span*100)}%"></i>`:''}</span><strong>${value(high,'°')}</strong>${icon('arrow')}</button>${selectedDay===row.datetime?`<div class="wx-expanded">${label}<br>${forecastDetails(row,current().attrs)}</div>`:''}`;
    }).join('');
  }
  /** 提取稳定节点标识，小时、日期和指标选择时复用原来的卡片。 */
  function nodeKey(node) {
    if(node.nodeType!==Node.ELEMENT_NODE)return null;
    for(const name of ['data-weather-hour','data-weather-day','data-weather-metric','data-solar-time','data-weather-sensor','data-weather-group'])if(node.hasAttribute(name))return `${name}:${node.getAttribute(name)}`;
    return null;
  }
  /** 仅同步变化的属性与子节点，保留弹层实例、滚动容器和已存在的卡片。 */
  function patchWeatherNode(current,next) {
    if(current.nodeType!==next.nodeType||current.nodeName!==next.nodeName){current.replaceWith(next.cloneNode(true));return;}
    if(current.nodeType!==Node.ELEMENT_NODE){if(current.nodeValue!==next.nodeValue)current.nodeValue=next.nodeValue;return;}
    for(const attribute of [...current.attributes])if(!next.hasAttribute(attribute.name))current.removeAttribute(attribute.name);
    for(const attribute of next.attributes)if(current.getAttribute(attribute.name)!==attribute.value)current.setAttribute(attribute.name,attribute.value);
    const keyed=new Map([...current.childNodes].map(node=>[nodeKey(node),node]).filter(([key])=>key!==null));
    let cursor=current.firstChild;
    for(const child of next.childNodes) {
      const key=nodeKey(child);
      let match=key!==null?keyed.get(key):cursor&&nodeKey(cursor)===null&&cursor.nodeName===child.nodeName?cursor:null;
      if(!match){match=child.cloneNode(true);current.insertBefore(match,cursor);}
      else {if(match!==cursor)current.insertBefore(match,cursor);patchWeatherNode(match,child);}
      cursor=match.nextSibling;
    }
    while(cursor){const following=cursor.nextSibling;cursor.remove();cursor=following;}
  }
  /** 首次创建天气弹层，后续只更新其内容，避免每次点击重新创建整个面板。 */
  function updateWeatherContent(markup) {
    const template=document.createElement('template');template.innerHTML=markup;
    const next=template.content.querySelector('.wx-sheet'),sheet=host.querySelector('.wx-sheet');
    if(!sheet){host.replaceChildren(template.content);return;}
    patchWeatherNode(sheet,next);
  }
  /** 渲染天气概览和详情，更新时保留当前横纵向滚动及键盘焦点。 */
  function render() {
    const {entity,valid,attrs}=current(),now=new Date(),windowData=forecastWindow(valid?hourly:[],valid?daily:[],now,timeZone());
    const [label,shape]=weatherCondition(valid?entity.state:null,hass?.states?.['sun.sun']?.state==='below_horizon'),temperature=value(attrs.temperature,'°');
    const status=hass?.connected===false?'连接已断开':valid?label:'天气暂无数据';
    // 顶部直接复用家庭当天的缓存预报；预报更新时即使详情关闭也同步高低温区间。
    const todayRow=windowData.days.find(row=>windowData.dateKey(row.datetime)===windowData.today);
    const low=value(todayRow?.templow,'°'),high=value(todayRow?.temperature,'°');
    const topSignature=JSON.stringify([temperature,status,shape,low,high]);
    if(trigger.dataset.signature!==topSignature){trigger.innerHTML=`<span class="weather-condition">${icon(shape)}<small>${status}</small></span><span class="weather-readings"><strong>${temperature}</strong><span class="weather-range">${low} - ${high}</span></span>`;trigger.dataset.signature=topSignature;trigger.setAttribute('aria-label',`查看天气详情，${status} ${temperature.replace(/&[^;]+;/g,'')}，${low} - ${high}`);}
    if(!opened)return;
    const sensorGroups=weatherSensorGroups(hass?.states,hass?.connected!==false),solarContent=solarSection();
    const next=JSON.stringify([entity,windowData.hours,windowData.days,selectedHour,selectedDay,metric,Math.floor(Date.now()/60000),hass?.connected,[...subscriptions].map(([key,entry])=>[key,entry.pending]),metrics(attrs),sensorGroups,solarContent]);
    if(next===signature)return;signature=next;
    const scroll=host.querySelector('.wx-body')?.scrollTop||0,horizontal=host.querySelector('.wx-hours')?.scrollLeft||0;
    const focused=host.contains(document.activeElement)?document.activeElement:null,focusKey=focused?.getAttribute('data-weather-hour')||focused?.getAttribute('data-weather-day')||focused?.getAttribute('data-weather-metric'),focusClose=focused?.hasAttribute('data-weather-close');
    const selected=windowData.hours.find(row=>row.datetime===selectedHour),metricRows=metrics(attrs),selectedMetric=metricRows.find(row=>row.id===metric);
    const forecastHint=(type)=>!valid?'天气连接后显示预报':!(attrs.supported_features&(type==='hourly'?2:1))?'天气源未提供此预报':subscriptions.get(type)?.pending?'正在加载预报…':'暂无可用预报';
    const updated=entity?.last_updated,stale=updated&&Date.now()-Date.parse(updated)>90*60000;
    updateWeatherContent(`<button type="button" class="wx-scrim" data-weather-close aria-label="关闭天气详情遮罩"></button><section class="wx-sheet" role="dialog" aria-modal="true" aria-labelledby="wx-title"><header><div><span class="wx-eyebrow">WEATHER</span><h2 id="wx-title">天气详情</h2></div><div class="wx-source">和风天气 · 家庭位置<small>${valid?'更新于 '+time(updated)+(stale?' · 数据较早':''):status}</small></div><button type="button" class="circle-button" data-weather-close aria-label="关闭天气详情">${icon('close')}</button></header><div class="wx-body" tabindex="0" aria-label="天气详情内容，可上下滚动"><div class="wx-overview"><section class="wx-current"><div class="wx-place">我的家</div><div class="wx-hero-icon">${icon(shape)}</div><div class="wx-temperature">${temperature}</div><p>${status}</p><div class="wx-highlow">最高 ${value(todayRow?.temperature,'°')} · 最低 ${value(todayRow?.templow,'°')}</div><small>体感 ${value(attrs.apparent_temperature,attrs.temperature_unit||'°C')}</small></section><section class="wx-card wx-hourly"><h3>${icon('clock')}未来 24 小时</h3><div class="wx-hours" tabindex="0" aria-label="未来24小时逐小时预报">${hourCards(windowData.hours)||`<p class="wx-empty">${forecastHint('hourly')}</p>`}</div><div class="wx-hour-detail">${selected?`${time(selected.datetime,{month:'numeric',day:'numeric',hour:'2-digit',hour12:false})} · ${weatherCondition(selected.condition)[0]} · ${value(selected.temperature,'°')}<br>${forecastDetails(selected,attrs)}`:'选择一个小时，查看温度、降水概率、湿度与风况'}</div></section></div><div class="wx-detail-grid"><section class="wx-card wx-daily"><h3>${icon('calendar')}未来 5 天</h3><div class="wx-days">${dayCards(windowData.days,windowData)||`<p class="wx-empty">${forecastHint('daily')}</p>`}</div>${windowData.days.length&&windowData.days.length<5?`<p class="wx-empty">天气源目前提供 ${windowData.days.length} 天预报</p>`:''}</section><section class="wx-metrics" aria-label="天气指标">${metricRows.map(row=>`<button type="button" class="wx-card wx-metric" data-weather-metric="${row.id}" aria-expanded="${metric===row.id}"><h3>${icon(row.icon)}${row.name}</h3><strong>${row.reading}</strong><small>${row.note}</small></button>`).join('')}</section></div>${selectedMetric?`<section class="wx-card wx-metric-detail"><h3>${icon(selectedMetric.icon)}${selectedMetric.name}</h3><p>${selectedMetric.detail}</p></section>`:''}${extraSections(sensorGroups)}${solarContent}<p class="wx-footer">天气与预报来自和风天气，太阳时刻来自家庭位置。各项目的状态报告时间可能不同。</p></div></section>`);
    host.querySelector('.wx-body').scrollTop=scroll;host.querySelector('.wx-hours').scrollLeft=horizontal;
    if(focusClose)host.querySelector('[aria-label="关闭天气详情"]')?.focus({preventScroll:true});
    else if(focusKey)[...host.querySelectorAll('[data-weather-hour],[data-weather-day],[data-weather-metric]')].find(el=>Object.values(el.dataset).includes(focusKey))?.focus({preventScroll:true});
  }
  /** 打开详情并隔离底层模型和设备，防止天气操作穿透。 */
  function open(event) {
    event?.preventDefault();event?.stopPropagation();
    if(opened)return;onOpen?.();previousFocus=document.activeElement;opened=true;host.hidden=false;
    // 屏保保留唤醒能力，天气面板不能使稍后出现的屏保失去交互。
    for(const child of document.querySelector('#screen').children)if(child!==host&&child.id!=='standby'){inertStates.set(child,child.inert);child.inert=true;}
    refresh();host.querySelector('[aria-label="关闭天气详情"]')?.focus({preventScroll:true});
  }
  /** 关闭详情后恢复底层页面状态和天气入口焦点。 */
  function close() {
    if(!opened)return;opened=false;host.hidden=true;signature='';
    for(const [child,inert] of inertStates)child.inert=inert;inertStates.clear();
    (previousFocus?.isConnected?previousFocus:trigger).focus({preventScroll:true});
  }
  /** 在天气面板内处理小时、日期和指标选择，其他交互保持隔离。 */
  function onClick(event) {
    const button=event.target.closest('button');if(!button)return;
    event.preventDefault();event.stopPropagation();
    if(button.hasAttribute('data-weather-close')){close();return;}
    if(button.dataset.weatherHour)selectedHour=button.dataset.weatherHour;
    else if(button.dataset.weatherDay)selectedDay=selectedDay===button.dataset.weatherDay?null:button.dataset.weatherDay;
    else if(button.dataset.weatherMetric)metric=metric===button.dataset.weatherMetric?null:button.dataset.weatherMetric;
    render();
    if(button.dataset.weatherMetric&&metric)host.querySelector('.wx-metric-detail')?.scrollIntoView({block:'nearest',behavior:document.querySelector('#screen').dataset.motion==='false'||matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  }
  /** 限制天气弹层键盘焦点，并让 Escape 只关闭当前详情。 */
  function onKey(event) {
    if(!opened)return;
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close();}
    else if(event.key==='Tab') {
      const items=[...host.querySelectorAll('.wx-sheet button,.wx-sheet [tabindex="0"]')],first=items[0],last=items.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }
  }
  trigger.addEventListener('click',open);host.addEventListener('click',onClick);document.addEventListener('keydown',onKey,true);
  window.addEventListener('pagehide',clearSubscriptions);
  const {start}=createVisiblePoll(refresh,10000);
  return {timeZone,start,close};
}
