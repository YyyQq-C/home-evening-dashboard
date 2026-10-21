let ready=false,applying=false,renderResolutionTimer,modelLightObserver;
let simulatedLights={};
let preferredView='top',rotationAllowed=true,lastActivitySent=0;
let fitPoints=[],fitScale=1,lastFitZoom=0,lastFitLimit=0,fitFrame=0,fitAreaWarned=false;
const lightNames={living:'客厅射灯',dining:'餐厅吊灯',tv:'电视墙灯带',ceiling:'客厅顶部灯带',hall:'过道射灯',balcony:'阳台射灯',masterRed:'主卧主灯',masterYellow:'主卧筒灯',secondary:'次卧吸顶灯',study:'书房吸顶灯',child:'儿童房吸顶灯'};

/** 发送与当前独立页面对应的同源模型事件。 */
function send(data) {window.parent.postMessage({channel:'ha-evening-model',...data},location.origin);}
/** 按整个大屏实际显示尺寸计算像素预算，手机不使用桌面大画布的过采样。 */
function renderPixelRatio() {
  try {
    const host=window.top,view=host.visualViewport,root=host.document.documentElement;
    const width=Math.min(root.clientWidth||host.innerWidth,view?.width||host.innerWidth);
    const height=Math.min(root.clientHeight||host.innerHeight,view?.height||host.innerHeight);
    const scale=Math.min(width/2000,height/1200);
    return Math.max(.35,Math.min(1.5,devicePixelRatio*scale*1.166));
  } catch(error) {console.warn('Evening render viewport unavailable',error);return Math.min(1,devicePixelRatio);}
}
/** 仅在像素预算变化时更新缓冲区，横竖屏切换不重新创建模型或 iframe。 */
function updateRenderResolution() {
  const preview=window.modelPreview,ratio=renderPixelRatio();
  if(!preview||Math.abs(preview.renderer.getPixelRatio()-ratio)<.01)return;
  window.eveningRenderRatio=ratio;
  preview.renderer.setPixelRatio(ratio);preview.composer.setPixelRatio(ratio);preview.render();
}
/** 合并地址栏和旋转产生的连续尺寸事件，避免频繁分配显存。 */
function scheduleRenderResolution() {
  clearTimeout(renderResolutionTimer);renderResolutionTimer=setTimeout(()=>{updateRenderResolution();fitModel();},150);
}
/** 取景只读取最终布局坐标，扣除房间卡片开关时的合成平移，避免动画影响缩放。 */
function modelStageRect(stage) {
  const rect=stage.getBoundingClientRect(),parent=window.parent.document,screen=parent.querySelector('#screen');
  const scale=screen.getBoundingClientRect().width/screen.clientWidth;
  const [x=0,y=0]=getComputedStyle(stage).translate.split(/\s+/).map(value=>parseFloat(value)||0);
  return new DOMRect(rect.x-x*scale,rect.y-y*scale,rect.width,rect.height);
}
/** 读取真实可见区域，允许房屋延伸到顶部及工具按钮下方。 */
function visibleModelArea() {
  try {
    const parent=window.parent.document,stage=parent.querySelector('#model-stage');
    if(!stage?.clientWidth||!stage.clientHeight)return null;
    const width=stage.clientWidth,height=stage.clientHeight,rect=modelStageRect(stage),scale=rect.height/height;
    const values=[...getComputedStyle(stage).clipPath.matchAll(/([\d.]+)px/g)].map(match=>Number(match[1]));
    let [top,right,bottom,left]=values.length===4?values:[0,0,0,0];
    const screen=parent.querySelector('#screen').getBoundingClientRect();
    const header=parent.querySelector('.header').getBoundingClientRect(),footer=parent.querySelector('#model-footer').getBoundingClientRect();
    // 用房屋投影边界的中心对齐顶部与底部工具之间的空白区域中心。
    const centerY=1-2*((header.bottom+footer.top)/2-rect.top)/rect.height;
    top=Math.max(top,(screen.top-rect.top)/scale);
    bottom=Math.max(bottom,(rect.bottom-screen.bottom)/scale);
    const padding=18;
    return {left:-1+2*(left+padding)/width,right:1-2*(right+padding)/width,bottom:-1+2*(bottom+8)/height,top:1-2*(top+8)/height,centerY};
  } catch(error) {
    if(!fitAreaWarned)console.warn('Evening visible model area unavailable',error);fitAreaWarned=true;
    return {left:-.9,right:.9,bottom:-.86,top:.86,centerY:0};
  }
}
/** 按放大前一版俯视取景的实际屏幕比例还原尺寸，不使用当前旋转方向。 */
function previousModelSizeLimit(preview) {
  const parent=window.parent.document,screen=parent.querySelector('#screen').getBoundingClientRect(),stage=parent.querySelector('#model-stage'),rect=modelStageRect(stage);
  const pageStyles=getComputedStyle(parent.querySelector('#home-page'));
  const scale=screen.width/2000,stageScale=rect.height/stage.clientHeight,padding=18*stageScale;
  const header=parent.querySelector('.header').getBoundingClientRect(),footer=parent.querySelector('#model-footer').getBoundingClientRect();
  // 原画布为 top:175、bottom:150，纵向中心为 612.5；保留原俯视尺寸作为统一比例。
  const centerX=rect.left+rect.width/2,centerY=screen.top+612.5*scale;
  const left=screen.left+parseFloat(pageStyles.getPropertyValue('--model-left'))*scale+padding;
  const right=screen.left+parseFloat(pageStyles.getPropertyValue('--model-right'))*scale-padding;
  const top=Math.max(screen.top+(612.5-875*1.166/2+20*1.166)*scale,header.bottom)+padding;
  const bottom=Math.min(screen.top+(612.5+875*1.166/2-40*1.166)*scale,footer.top)-padding;
  let limit=Infinity;
  for(const point of fitPoints){
    const x=point.x-preview.controls.target.x,y=-(point.z-preview.controls.target.z);
    if(x<0)limit=Math.min(limit,(centerX-left)/-x);else if(x>0)limit=Math.min(limit,(right-centerX)/x);
    if(y<0)limit=Math.min(limit,(bottom-centerY)/-y);else if(y>0)limit=Math.min(limit,(centerY-top)/y);
  }
  return .98*limit*(preview.camera.top-preview.camera.bottom)/rect.height;
}
/** 使用上一版俯视尺寸作为固定取景比例，旋转时保留大小及手动缩小比例。 */
function fitModel(resetZoom=false) {
  const preview=window.modelPreview,area=visibleModelArea();
  if(!preview||!area||area.left>=area.right||area.bottom>=area.top)return;
  const {model,camera,controls,render}=preview;
  if(!fitPoints.length){
    const foundation=model.getObjectByName('Continuous_Foundation');if(!foundation)return;
    model.updateMatrixWorld(true);
    const positions=foundation.geometry.attributes.position;
    for(let index=0;index<positions.count;index++)for(const height of [-.12,2.35]){
      const point=camera.position.clone().fromBufferAttribute(positions,index);point.y=height;
      fitPoints.push(point.applyMatrix4(foundation.matrixWorld));
    }
  }
  if(resetZoom===true)fitScale=1;
  else if(lastFitLimit&&Math.abs(camera.zoom-lastFitZoom)>.00001)fitScale=Math.max(.5,Math.min(1,camera.zoom/lastFitLimit));
  camera.clearViewOffset();camera.zoom=1;camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
  // 固定使用上一版俯视取景尺寸，不再因旋转包络保守缩小模型。
  lastFitLimit=previousModelSizeLimit(preview);
  controls.maxZoom=lastFitLimit;controls.minZoom=lastFitLimit*.5;
  camera.zoom=lastFitZoom=lastFitLimit*fitScale;camera.updateProjectionMatrix();
  // 大尺寸旋转接近屏幕边缘时只平移画面，不改变比例或旋转中心。
  const point=camera.position.clone();let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  for(const world of fitPoints){point.copy(world).project(camera);minX=Math.min(minX,point.x);maxX=Math.max(maxX,point.x);minY=Math.min(minY,point.y);maxY=Math.max(maxY,point.y);}
  const dx=maxX-minX>area.right-area.left?(area.left+area.right-minX-maxX)/2:minX<area.left?area.left-minX:maxX>area.right?area.right-maxX:0;
  // 只移动投影，不改变现有大小；大角度下仍限制在屏幕内，避免越界裁剪。
  const centeredY=area.centerY-(minY+maxY)/2;
  const dy=maxY-minY>area.top-area.bottom?(area.top+area.bottom-minY-maxY)/2:Math.min(area.top-maxY,Math.max(area.bottom-minY,centeredY));
  if(dx||dy){const stage=window.parent.document.querySelector('#model-stage');camera.setViewOffset(stage.clientWidth,stage.clientHeight,-dx*stage.clientWidth/2,dy*stage.clientHeight/2,stage.clientWidth,stage.clientHeight);}
  render();
}
/** 合并承载页布局变化及过渡结束产生的取景请求，保持模型实例不变。 */
function scheduleModelFit() {
  if(fitFrame)return;
  fitFrame=requestAnimationFrame(()=>{fitFrame=0;fitModel();});
}
/** 默认恢复俯视视角，使首次打开、刷新和复位保持一致。 */
function resetView(top=preferredView==='top') {
  const {camera,controls}=window.modelPreview;
  fitScale=1;lastFitZoom=0;lastFitLimit=0;
  camera.up.set(0,1,0);controls.target.set(0,0,0);
  camera.position.set(...(top?[0,24,.001]:[-9,Math.hypot(9,18),18]));controls.update();fitModel(true);
}
/** 降低均匀补光，让实际灯位的暖光在开关时具有可见对比，仍保留户型细节。 */
function updateLightingEnvironment() {
  const {scene,model}=window.modelPreview,day=document.body.dataset.theme==='light';
  for(const light of scene.children){
    if(light.isDirectionalLight)light.intensity=day?1.25:.85;
    if(light.isHemisphereLight)light.intensity=day?.55:.38;
  }
  scene.environmentIntensity=day?.24:.18;
  const roomLights={'客餐厅':['living','dining','hall','tv','ceiling'],'阳台':['balcony'],'主卧':['masterRed','masterYellow'],'次卧':['secondary'],'书房':['study'],'儿童房':['child']};
  // 为各房间复制地面材质，避免共用木地板材质导致其他房间跟随变色。
  model.traverse(mesh=>{
    const ids=roomLights[mesh.name.replace(/_Floor$/,'')];
    if(!mesh.isMesh||!mesh.name.endsWith('_Floor')||!ids||Array.isArray(mesh.material))return;
    if(!mesh.userData.eveningLightMaterial){
      mesh.material=mesh.material.clone();mesh.userData.eveningLightMaterial=true;
      mesh.userData.eveningFloorColor=mesh.material.color.clone();
    }
    const amount=Math.max(0,...ids.map(id=>simulatedLights[id]?.on?Math.max(1,Math.min(100,Number(simulatedLights[id].brightness)||65))/100:0));
    mesh.material.color.copy(mesh.userData.eveningFloorColor).multiplyScalar((day?.86:.68)+amount*(day?.14:.32));
    mesh.material.emissive.set('#ffc975');mesh.material.emissiveIntensity=amount*(day?.055:.09);
  });
}
/** 移除儿童房门口圆毯及客厅整组茶几，桌面杯书与桌脚一并移除。 */
function removeRequestedFurnishings() {
  const {model}=window.modelPreview,removed=[];
  const names=new Set(['Child_Round_Rug','Coffee_Table','Coffee_Main_Base','Coffee_Companion_Top','Coffee_Companion_Base','Coffee_Tray','Coffee_Book','Warm_Coffee_Cup']);
  // 先收集再移除，避免遍历时改变子节点集合而漏掉桌脚或桌面摆件。
  model.traverse(object=>{if(names.has(object.name))removed.push(object);});
  for(const name of ['Child_Round_Rug','Coffee_Table'])if(!removed.some(object=>object.name===name))console.warn('Requested model furnishing was not found',name);
  removed.forEach(object=>object.removeFromParent());
}
/** 将父页面的模拟灯光同步到当前模型副本，保留现有几何。 */
function applyLights(lights) {
  const {groups,render}=window.modelPreview;simulatedLights=lights;applying=true;
  try {
    for(const [id,item] of Object.entries(lights)) {
      const group=groups[id];if(!group)continue;
      if(group.on!==!!item.on)group.button.click();
      group.marker.dataset.lightLabel=`${lightNames[id]} · ${group.on?'已开启':'已关闭'}`;
      group.marker.removeAttribute('title');
      const brightness=Math.max(1,Math.min(100,Number(item.brightness)||65))/100;
      // 增强常规灯具的局部照明，客厅两类灯带继续保持柔和，亮度读数和底部光晕不变。
      const strip=['ceiling','tv'].includes(id);
      group.lights.forEach(light=>{light.intensity=group.on?light.userData.power*brightness*(strip?.65:2.4):0;});
      group.pools.forEach(pool=>{
        const softness=!strip?1.35:pool.name.endsWith('_Core')?.8:pool.name.endsWith('_Floor_Wash')?.35:pool.name.endsWith('_Halo')?.4:.45;
        pool.material.opacity=(pool.userData.eveningBaseOpacity??=pool.material.opacity)*brightness*softness;
      });
    }
    updateLightingEnvironment();render();
  } finally {
    // 丢弃本次程序同步产生的观察记录，避免旧状态回传、重复重绘卡片。
    modelLightObserver?.takeRecords();applying=false;
  }
}
/** 处理模型视角与模拟灯光指令，不接收网络或 HA 控制消息。 */
function onMessage(event) {
  if(!ready||event.origin!==location.origin||event.source!==window.parent||event.data?.channel!=='ha-evening-screen')return;
  try {
    if(event.data.action==='ready-request')send({type:'ready'});
    else if(event.data.action==='lights')applyLights(event.data.lights||{});
    else if(event.data.action==='devices')applyDevices(event.data);
    else if(event.data.action==='settings')applyModelPreferences(event.data);
    else if(event.data.action==='reset')resetView();
    else if(event.data.action==='top')resetView(true);
  } catch(error) {console.error('Evening model action failed',error);send({type:'error'});}
}
/** 同步模型交互、默认视角和标注主题，锁定旋转时仍保留设备点击。 */
function applyModelPreferences(data) {
  const view=data.view==='angled'?'angled':'top',rotate=data.rotation!==false;
  const reset=preferredView!==view||(rotationAllowed&&!rotate);
  preferredView=view;rotationAllowed=rotate;
  const preview=window.modelPreview;updateRenderResolution();
  preview.controls.enableRotate=rotate;preview.controls.enableZoom=data.zoom!==false;preview.controls.enablePan=false;
  document.body.dataset.markersVisible=String(data.markers!==false);
  document.body.dataset.theme=data.resolvedTheme==='light'?'light':'dark';
  // 内外文档使用相同色彩方案，避免浏览器为透明 iframe 绘制黑色底板。
  document.documentElement.style.colorScheme=document.body.dataset.theme;document.body.style.colorScheme=document.body.dataset.theme;
  updateLightingEnvironment();
  if(reset)resetView();else preview.render();
}
/** 节流上报模型内真实交互，避免屏保在用户操作模型时出现。 */
function reportActivity(event) {
  const now=Date.now();if(event.type==='pointermove'&&now-lastActivitySent<500)return;lastActivitySent=now;send({type:'activity',interaction:event.type});
}
/** 复用原模型设备锚点，按当前类别显示并同步独立页面的模拟状态。 */
function applyDevices(data) {
  const preview=window.modelPreview,kind=['all','lights','ac','fresh','floor'].includes(data.kind)?data.kind:'lights';
  document.body.dataset.markerKind=kind;
  for(const item of preview.deviceDisplay.devices) {
    const id=item.id==='floor-living-dining'?'living':item.id.replace(/^(ac|floor)-/,'');
    item.button.dataset.eveningHidden=String(!['ac','floor','fresh'].includes(item.kind)||(kind!=='all'&&item.kind!==kind));
    const state=item.kind==='fresh'?data.fresh:data[item.kind]?.[id];
    if(!state)continue;
    item.on=!!state.on;item.temperature=state.temperature??item.temperature;
    item.button.setAttribute('aria-pressed',String(item.on));
    item.button.dataset.eveningLabel=`${item.name} · ${item.on?'已开启':'已关闭'}`;
    item.button.removeAttribute('title');
  }
  preview.render();
}
/** 点击任意可控标注直接切换对应模拟设备，保留当前图标筛选。 */
function onMarkerClick(event) {
  const device=event.target.closest('.device-marker');
  if(device) {
    event.preventDefault();event.stopImmediatePropagation();
    const kind=device.dataset.deviceKind,id=device.dataset.device==='floor-living-dining'?'living':device.dataset.device.replace(/^(ac|floor)-/,'');
    if(['ac','floor','fresh'].includes(kind))send({type:'toggle-device',kind,id});
    return;
  }
  const marker=event.target.closest('.light-marker');if(!marker)return;
  event.preventDefault();event.stopImmediatePropagation();send({type:'toggle-light',id:marker.dataset.light});
}
/** 清除原模型反复生成的原生悬浮提示，设备名称继续通过无障碍标签提供。 */
function hideModelMarkerHints() {
  const display=window.modelPreview.deviceDisplay;
  if(!display?.update)return;
  // 仅调整屏幕图标偏移，不移动 CAD 锚点；相邻空调、地暖之间留出可见空隙。
  for(const item of display.devices)if(['ac','floor'].includes(item.kind)&&item.offset)item.offset=Math.sign(item.offset)*42;
  const originalUpdate=display.update.bind(display);
  /** 在设备标注更新后移除 title，避免操作后再次出现浏览器提示。 */
  function updateWithoutHints() {
    // 切换显示方式或页面隐藏后不再投影，避免零尺寸视口产生无效坐标。
    const viewport=document.querySelector('#viewport');
    if(!viewport?.clientWidth||!viewport.clientHeight)return;
    originalUpdate();
    display.devices.forEach(item=>item.button.removeAttribute('title'));
  }
  display.update=updateWithoutHints;updateWithoutHints();
}
/** 隐藏房间名称贴图，保留房间几何、灯具及设备的无障碍名称。 */
function hideRoomNames(){
  window.modelPreview.model.traverse(object=>{if(object.isSprite)object.visible=false;});
}
/** 启动独立三维模型，限制渲染负载并隐藏不需要的旧设备图标。 */
async function start() {
  try {
    window.eveningRenderRatio=renderPixelRatio();
    await import('./model.js');
    const preview=window.modelPreview;if(!preview?.groups)throw new Error('Model preview API is unavailable');
    removeRequestedFurnishings();hideRoomNames();hideModelMarkerHints();
    // 平板仅在相机或灯光变化时重绘；副本降低过采样，原模型不作修改。
    updateRenderResolution();
    // 渲染资源丢失只提示模型恢复，不刷新 HA 或整个大屏。
    preview.renderer.domElement.addEventListener('webglcontextlost',event=>{
      event.preventDefault();console.error('Evening model WebGL context lost');send({type:'error',reason:'context-lost'});
    });
    preview.renderer.domElement.addEventListener('webglcontextrestored',()=>{
      console.info('Evening model WebGL context restored');preview.render();send({type:'ready'});
    });
    const ssao=preview.composer.passes.find(pass=>pass.ssaoMaterial);if(ssao)ssao.enabled=false;
    preview.controls.enablePan=false;
    document.body.dataset.markerKind='lights';
    for(const [id,group] of Object.entries(preview.groups)) {
      // 沿用模型经过 CAD 校准的灯组锚点，不用房间中心替代灯位。
      group.marker.dataset.lightLabel=lightNames[id];
      group.marker.setAttribute('aria-label',`${lightNames[id]}，切换灯光`);
      group.marker.removeAttribute('title');
    }
    document.addEventListener('click',onMarkerClick,true);
    for(const type of ['pointerdown','pointermove','pointerup','wheel','keydown'])document.addEventListener(type,reportActivity,{capture:true,passive:true});
    // 原模型若通过灯具几何触发模拟开关，同步回父页面以维持双向状态。
    modelLightObserver=new MutationObserver(records=>{
      if(applying)return;
      for(const record of records){const id=record.target.dataset.group;if(id&&preview.groups[id])send({type:'light-toggle',id,on:preview.groups[id].on});}
    });
    modelLightObserver.observe(document.querySelector('#lights'),{subtree:true,attributes:true,attributeFilter:['aria-pressed']});
    ready=true;window.addEventListener('message',onMessage);resetView();
    preview.controls.addEventListener('change',fitModel);
    new ResizeObserver(scheduleModelFit).observe(document.querySelector('#viewport'));
    // 导航与房间面板改变可见宽度时重新取景，等待过渡结束再校准最终边界。
    const parent=window.parent.document,stage=parent.querySelector('#model-stage');
    // 布局变化后在绘制前一次完成取景，避免下一帧再校正造成先缩小后放大。
    const layoutObserver=new MutationObserver(()=>fitModel());
    layoutObserver.observe(parent.querySelector('#home-page'),{attributes:true,attributeFilter:['class']});
    layoutObserver.observe(parent.querySelector('#screen'),{attributes:true,attributeFilter:['data-nav-open']});
    stage.addEventListener('transitionend',scheduleModelFit);
    // 浏览器地址栏变化和屏幕旋转只调整分辨率，不触发整个页面重载。
    const host=window.top;
    host.addEventListener('resize',scheduleRenderResolution);
    host.visualViewport?.addEventListener('resize',scheduleRenderResolution);
    window.addEventListener('pagehide',()=>{
      cancelAnimationFrame(fitFrame);layoutObserver.disconnect();stage.removeEventListener('transitionend',scheduleModelFit);
      clearTimeout(renderResolutionTimer);host.removeEventListener('resize',scheduleRenderResolution);
      host.visualViewport?.removeEventListener('resize',scheduleRenderResolution);
    },{once:true});
    send({type:'ready'});
  } catch(error) {console.error('Evening model initialization failed',error);send({type:'error'});}
}
start();
