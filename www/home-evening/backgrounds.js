import {createVisiblePoll} from './runtime.js';
import {BUILTIN_BACKGROUNDS,normalizeBackgroundState,backgroundPool,backgroundAt,backgroundSize} from './ambient.js';

const ENDPOINT='home_evening/backgrounds';
const ERROR_MESSAGES={revision_conflict:'背景已被其他设备修改，已同步最新配置，请重新操作。',image_too_large:'单张图片不能超过 10MB。',invalid_image:'图片无法读取，请选择有效的 JPG、PNG 或 WebP 图片。',unsupported_image:'仅支持静态 JPG、PNG、WebP 图片。',image_dimensions_too_large:'原图不能超过 4000 万像素，请缩小后上传。',gallery_full:'最多保存 30 张上传图片，请先删除不需要的图片。',invalid_interval:'切换间隔需在 5 秒至 24 小时之间。',unknown_image:'图片已不存在，已同步最新图库。',storage_failed:'背景保存失败，请稍后重试。'};

/** 将上传名称等文本安全地放入图库界面。 */
function escapeHtml(value){return String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}

/** 生成背景设置专用分段按钮，避免混入本地显示偏好的事件。 */
function choices(key,label,items){return `<div class="setting-options" role="group" aria-label="${label}">${items.map(([value,text])=>`<button type="button" data-bg-setting="${key}" data-value="${value}" aria-pressed="false">${text}</button>`).join('')}</div>`;}

/** 生成静态背景管理面板，动态同步时不重建输入框和上传控件。 */
function editorMarkup(){return `<section data-background-editor>
<h3>背景图片</h3><p class="settings-help">保存到 Home Assistant，所有设备共用图片与规则。</p>
<div class="background-current"><div class="background-preview"><img data-bg-preview alt="背景显示预览"></div><div><span class="background-kicker">正在显示</span><strong data-bg-current></strong><small data-bg-overview></small></div></div>
<details class="background-group background-library"><summary><span>图片与上传<small>上传、选用和删除图片</small></span><span class="background-group-count" data-bg-count></span></summary><div class="background-group-body background-library-body">
<div class="background-upload-box"><button type="button" class="background-upload" data-bg-action="upload">＋ 上传背景图片</button><label class="background-upload-theme">新图片适用于<select data-bg-field="upload-theme" aria-label="新图片适用主题"><option value="all">深浅色通用</option><option value="light">仅浅色</option><option value="dark">仅深色</option></select></label><input type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" multiple hidden data-bg-files><p class="settings-help">可多选 JPG、PNG、WebP，每张不超过 10MB；上传后立即使用。</p></div>
<h4 class="background-gallery-title">我的图片</h4><p class="settings-help">点击缩略图使用，删除按钮在每张图片右下角。</p><div class="background-gallery" data-bg-images></div>
<h4 class="background-gallery-title">内置背景</h4><div class="background-gallery" data-bg-builtins></div></div></details>
<details class="background-group"><summary><span>图片显示方式<small data-bg-fit-summary></small></span></summary><div class="background-group-body">${choices('fit','背景图片显示方式',[['cover','填满裁剪'],['contain','完整显示'],['stretch','拉伸铺满']])}<p class="settings-help" data-bg-fit-help></p></div></details>
<details class="background-group"><summary><span>自动轮换<small data-bg-cycle-summary></small></span></summary><div class="background-group-body"><div class="setting-row"><div><strong>循环背景</strong><small>关闭后固定当前图片</small></div><button type="button" class="toggle" role="switch" aria-label="循环背景" aria-checked="true" data-bg-action="cycle"></button></div><div data-bg-cycle-options><div class="setting-label">轮换图库</div>${choices('source','背景来源',[['builtin','内置背景'],['custom','我的图片'],['all','全部图片']])}<div class="setting-label">轮换顺序</div>${choices('mode','背景循环规则',[['sequential','按顺序'],['random','随机顺序']])}<label class="setting-row"><strong>每隔多久切换</strong><span class="background-interval"><input type="number" min="1" max="86400" step="1" inputmode="numeric" data-bg-field="interval" aria-label="背景切换间隔"><select data-bg-field="unit" aria-label="背景切换间隔单位"><option value="1">秒</option><option value="60">分钟</option><option value="3600">小时</option></select></span></label><p class="settings-help">支持 5 秒至 24 小时；图片可单独设置是否加入轮换。</p></div></div></details>
<p class="background-status" role="status" aria-live="polite" data-bg-status></p><button type="button" class="background-retry" data-bg-action="retry" hidden>重新连接共享背景</button></section>`;}

/** 从 HA 的请求错误中提取稳定错误码，不展示令牌或原始请求内容。 */
function errorCode(error){
  let body=error?.body;
  if(typeof body==='string'){try{body=JSON.parse(body);}catch{/* 非 JSON 错误只按状态码处理。 */}}
  return body?.error||error?.code||error?.error||(error?.status_code===409?'revision_conflict':'connection_failed');
}

/** 读取文件为上传数据，仅用于已登录 HA 的同源 JSON 接口。 */
function encodeFile(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>{console.error('Background file reading failed');reject(new Error('File reading failed'));};reader.readAsDataURL(file);});}

/** 创建共享背景控制器，图片轮换不会重置屏保或触发设备操作。 */
export function createSharedBackgrounds({screen,getTheme}){
  let state=normalizeBackgroundState(),ready=false,busy=false,editor=null,notice='',failed=false,warned=false,current=null,lastTheme='dark',gallerySignature='',builtinTheme='',imageUrl='',pendingUrl='',requestSerial=0,failedUrl='',failedAt=0;
  const mounted=new WeakSet();
  const imageCache=new Map();

  /** 获取宿主当前登录会话，独立预览不读取或保存认证令牌。 */
  function hass(){try{return window.parent!==window?window.parent.document.querySelector('home-assistant')?.hass:null;}catch(error){if(!warned)console.warn('Shared background host unavailable',error);warned=true;return null;}}

  /** 释放已删除图片和较旧的原图，避免平板长时间轮换后堆积图片 Blob。 */
  function trimImages(){
    const ids=new Set(state.images.map(image=>image.id));
    const originals=[...imageCache].filter(([key,entry])=>key.endsWith(':original')&&entry.url);
    for(const [key,entry] of imageCache){
      const stale=!ids.has(key.split(':')[0]),excess=key.endsWith(':original')&&originals.length>3&&originals.findIndex(([item])=>item===key)<originals.length-3;
      if(entry.url&&entry.url!==imageUrl&&(stale||excess)){URL.revokeObjectURL(entry.url);imageCache.delete(key);}
    }
  }

  /** 使用宿主认证下载图片，认证信息不进入 CSS、图库元数据或持久化存储。 */
  async function resolveImage(image,thumbnail=false){
    if(image.builtin)return new URL(thumbnail?image.thumbnail_url:image.url,document.baseURI).href;
    const key=image.id+':'+(thumbnail?'thumbnail':'original'),cached=imageCache.get(key);
    if(cached?.url){imageCache.delete(key);imageCache.set(key,cached);return cached.url;}
    if(cached?.promise)return cached.promise;
    const host=hass();if(!host?.fetchWithAuth)throw new Error('Authenticated background download is unavailable');
    const entry={url:null,promise:null};imageCache.set(key,entry);
    entry.promise=(async()=>{
      const response=await host.fetchWithAuth(thumbnail?image.thumbnail_url:image.url);
      if(!response.ok)throw new Error('Background image download failed');
      entry.url=URL.createObjectURL(await response.blob());entry.promise=null;trimImages();return entry.url;
    })().catch(error=>{imageCache.delete(key);throw error;});
    return entry.promise;
  }

  /** 先解码图片再切换背景，加载失败时保留可用的内置背景。 */
  async function paint(image){
    if(screen.dataset.backgroundId===image.id&&imageUrl||pendingUrl===image.id||failedUrl===image.id&&Date.now()-failedAt<30000)return;
    pendingUrl=image.id;const serial=++requestSerial;
    try{
      const url=await resolveImage(image);
      await new Promise((resolve,reject)=>{const loader=new Image();loader.onload=resolve;loader.onerror=()=>reject(new Error('Background image decoding failed'));loader.src=url;});
      if(serial!==requestSerial)return;
      pendingUrl='';imageUrl=url;if(failedUrl===image.id){failedUrl='';notice='';failed=false;renderEditor();}
      screen.style.setProperty('--ambient-image',`url("${url}")`);screen.dataset.backgroundId=image.id;trimImages();
    }catch(error){
      if(serial!==requestSerial)return;
      pendingUrl='';failedUrl=image.id;failedAt=Date.now();console.warn('Shared background image loading failed');
      const fallback=BUILTIN_BACKGROUNDS.find(item=>item.theme===lastTheme);
      imageUrl=new URL(fallback.url,document.baseURI).href;
      screen.style.setProperty('--ambient-image',`url("${imageUrl}")`);screen.dataset.backgroundId=fallback.id;
      notice='图片暂不可用，正在使用内置背景。';failed=true;renderEditor();
    }
  }

  /** 根据共享时钟应用图片与显示方式，同一时段的相同主题设备显示一致。 */
  function apply(theme=getTheme()){
    const changed=lastTheme!==theme;lastTheme=theme;
    current=backgroundAt(state,theme);
    const ambient=String(current.index??0);if(screen.dataset.ambient!==ambient)screen.dataset.ambient=ambient;
    screen.style.setProperty('--ambient-size',backgroundSize(state.settings.fit));screen.dataset.backgroundFit=state.settings.fit;
    paint(current);
    if(changed)renderEditor();else syncCurrent();
  }

  /** 合并较新的服务器快照，避免较慢的请求覆盖已保存的新配置。 */
  function adopt(data){const next=normalizeBackgroundState(data);if(next.revision<state.revision)return;state=next;ready=true;apply();renderEditor();trimImages();}

  /** 拉取共享配置，断线时保留已加载的图库，恢复后自动同步。 */
  async function refresh(){
    if(busy)return;
    const host=hass();
    if(!host?.callApi){ready=false;notice='请在已登录的 HA 大屏内管理共享背景。';renderEditor();return;}
    try{const data=await host.callApi('GET',ENDPOINT);const recovering=!ready;ready=true;warned=false;if(recovering){notice='';failed=false;}adopt(data);}
    catch(error){ready=false;notice='共享背景暂不可用，保留当前背景；连接恢复后自动同步。';failed=true;if(!warned)console.warn('Shared background synchronization failed',errorCode(error));warned=true;renderEditor();}
  }

  /** 提交带版本号的修改，冲突时同步最新配置并交由用户重新操作。 */
  async function write(payload){
    const host=hass();if(!host?.callApi||!ready)throw new Error('Shared background host unavailable');
    try{const data=await host.callApi('POST',ENDPOINT,{...payload,revision:state.revision});adopt(data);return state;}
    catch(error){if(errorCode(error)==='revision_conflict'){try{adopt(await host.callApi('GET',ENDPOINT));}catch(refreshError){console.warn('Shared background conflict synchronization failed',errorCode(refreshError));}}throw error;}
  }

  /** 串行执行一次界面操作，在失败时保留当前内容并显示可理解的提示。 */
  async function perform(task){
    if(busy||!ready)return;
    busy=true;failed=false;notice='正在保存共享背景…';renderEditor();
    try{await task();notice='已保存到 Home Assistant，其他设备会自动同步。';}
    catch(error){const code=errorCode(error);console.error('Shared background operation failed',code);notice=(error.savedCount?`已保存 ${error.savedCount} 张，其余图片未完成。`:'')+(ERROR_MESSAGES[code]||'操作未完成，请检查连接后重试。');failed=true;}
    finally{busy=false;renderEditor();}
  }

  /** 修改循环规则时从当前图片重新计时，显示方式修改不重置循环。 */
  function settingsPatch(key,value){
    const patch={[key]:value};
    if(key!=='fit')patch.selected_id=current?.id||'';
    if(key==='source'){const pool=backgroundPool({...state,settings:{...state.settings,source:value}},getTheme());patch.selected_id=pool.find(image=>image.id===current?.id)?.id||pool[0]?.id||'';}
    return patch;
  }

  /** 上传原图并立即使用新图库，部分上传失败时保留已经成功的图片。 */
  async function upload(files){
    const theme=editor.querySelector('[data-bg-field=upload-theme]').value;
    await perform(async()=>{
      if(state.images.length+files.length>30)throw {code:'gallery_full'};
      for(const file of files)if(file.size>10*1024*1024)throw {code:'image_too_large'};
      const added=[];
      try{
        for(let index=0;index<files.length;index++){
          notice=`正在上传 ${index+1}/${files.length}：${files[index].name}`;renderEditor();
          const before=new Set(state.images.map(image=>image.id));
          await write({action:'upload',filename:files[index].name,theme,data:await encodeFile(files[index])});
          added.push(...state.images.filter(image=>!before.has(image.id)));
        }
        const eligible=added.find(image=>image.theme==='all'||image.theme===getTheme())||added[0];
        if(eligible)await write({action:'settings',patch:{source:'custom',selected_id:eligible.id}});
        if(editor?.isConnected)editor.querySelector('.background-library').open=true;
      }catch(error){error.savedCount=added.length;throw error;}
    });
  }

  /** 构造单张图片的预览和图库操作，不允许图片名称插入 HTML。 */
  function card(image,index,total){
    const name=escapeHtml(image.name),eligible=image.theme==='all'||image.theme===getTheme(),id=image.id;
    return `<article class="background-card" data-bg-card="${id}"><button type="button" class="background-pick" data-bg-action="use" data-id="${id}" data-bg-disabled="${!eligible}" aria-label="使用背景：${name}" aria-pressed="false" title="${eligible?'点击立即使用':'请切换到图片适用的主题后使用'}"><img ${image.builtin?`src="${image.thumbnail_url}"`:`data-bg-thumb="${id}"`} alt="${name}" loading="lazy"><span>${name}</span></button><small>${image.width} × ${image.height}</small>${image.builtin?'':`<select data-bg-field="image-theme" data-id="${id}" aria-label="${name}适用主题">${[['all','深浅通用'],['light','仅浅色'],['dark','仅深色']].map(([value,label])=>`<option value="${value}" ${value===image.theme?'selected':''}>${label}</option>`).join('')}</select><div class="background-card-actions"><button type="button" data-bg-action="enabled" data-id="${id}" aria-pressed="${image.enabled}" title="是否参与循环">${image.enabled?'参与轮换':'不参与轮换'}</button><button type="button" data-bg-action="up" data-id="${id}" data-bg-disabled="${index===0}" aria-label="上移${name}">↑</button><button type="button" data-bg-action="down" data-id="${id}" data-bg-disabled="${index===total-1}" aria-label="下移${name}">↓</button><button type="button" data-bg-action="delete" data-id="${id}" aria-label="删除${name}">删除</button></div>`}</article>`;
  }

  /** 原位更新当前图片提示、缩略图选择状态及显示方式预览。 */
  function syncCurrent(){
    if(!editor?.isConnected||!current)return;
    const image=editor.querySelector('[data-bg-preview]');
    if(image.dataset.loading!=='true'&&(image.dataset.imageId!==current.id||!image.getAttribute('src')&&Date.now()-Number(image.dataset.failedAt||0)>30000)){
      const selected=current;image.dataset.imageId=selected.id;image.dataset.loading='true';
      resolveImage(selected).then(url=>{if(image.isConnected&&current.id===selected.id)image.src=url;}).catch(()=>{image.dataset.failedAt=String(Date.now());console.warn('Shared background preview loading failed');}).finally(()=>{image.dataset.loading='false';});
    }
    image.style.objectFit=state.settings.fit==='stretch'?'fill':state.settings.fit;
    editor.querySelector('[data-bg-current]').textContent=current.name;
    editor.querySelector('[data-bg-overview]').textContent=current.fallback?'当前主题没有可用图片，暂用内置背景':`${current.builtin?'内置背景':'我的图片'} · ${current.width} × ${current.height}`;
    for(const button of editor.querySelectorAll('[data-bg-action=use]'))button.setAttribute('aria-pressed',String(button.dataset.id===current.id));
    for(const element of editor.querySelectorAll('[data-bg-card]'))element.dataset.current=String(element.dataset.bgCard===current.id);
  }

  /** 仅在图库展开时下载缩略图，使用认证 Blob 地址替代公开图片链接。 */
  function hydrateThumbnails(){
    if(!editor?.isConnected||!editor.querySelector('.background-library').open)return;
    for(const node of editor.querySelectorAll('[data-bg-thumb]')){
      if(node.getAttribute('src')||node.dataset.loading==='true'||Date.now()-Number(node.dataset.failedAt||0)<30000)continue;
      const image=state.images.find(item=>item.id===node.dataset.bgThumb);if(!image)continue;
      node.dataset.loading='true';
      resolveImage(image,true).then(url=>{if(node.isConnected)node.src=url;}).catch(()=>{node.dataset.failedAt=String(Date.now());console.warn('Shared background thumbnail loading failed');}).finally(()=>{node.dataset.loading='false';});
    }
  }

  /** 同步控件和有变化的图库，保留间隔输入、文件选择器及设置面板的滚动节点。 */
  function renderEditor(){
    if(!editor?.isConnected)return;
    editor.dataset.revision=String(state.revision);
    for(const button of editor.querySelectorAll('[data-bg-setting]'))button.setAttribute('aria-pressed',String(state.settings[button.dataset.bgSetting]===button.dataset.value));
    editor.querySelector('[data-bg-action=cycle]').setAttribute('aria-checked',String(state.settings.cycle));
    const seconds=state.settings.interval_seconds,unit=seconds%3600===0?3600:seconds%60===0?60:1;
    const input=editor.querySelector('[data-bg-field=interval]'),unitSelect=editor.querySelector('[data-bg-field=unit]');
    if(document.activeElement!==input&&document.activeElement!==unitSelect){input.value=String(seconds/unit);unitSelect.value=String(unit);}
    editor.querySelector('[data-bg-fit-help]').textContent={cover:'保持比例填满整个界面，边缘可能被裁剪。',contain:'完整显示整张图片，保持比例，尺寸不一致时会留边。',stretch:'铺满整个界面，不留边，但图片比例可能改变。'}[state.settings.fit];
    if(builtinTheme!==getTheme()){builtinTheme=getTheme();editor.querySelector('[data-bg-builtins]').innerHTML=BUILTIN_BACKGROUNDS.filter(image=>image.theme===builtinTheme).map(image=>card(image)).join('');}
    const signature=JSON.stringify(state.images)+getTheme();
    if(gallerySignature!==signature){gallerySignature=signature;editor.querySelector('[data-bg-images]').innerHTML=state.images.length?state.images.map((image,index)=>card(image,index,state.images.length)).join(''):'<div class="background-empty"><strong>还没有上传图片</strong><p>上传喜欢的照片，打造自己的居家背景。</p></div>';}
    editor.querySelector('[data-bg-count]').textContent=`${state.images.length} / 30`;
    editor.querySelector('[data-bg-fit-summary]').textContent={cover:'填满裁剪 · 保持比例',contain:'完整显示 · 保持比例',stretch:'拉伸铺满 · 不留边'}[state.settings.fit];
    editor.querySelector('[data-bg-cycle-summary]').textContent=state.settings.cycle?`${{builtin:'内置背景',custom:'我的图片',all:'全部图片'}[state.settings.source]} · ${state.settings.mode==='random'?'随机':'按顺序'} · 每 ${seconds/unit} ${{1:'秒',60:'分钟',3600:'小时'}[unit]}`:'已关闭 · 固定当前图片';
    editor.querySelector('[data-bg-cycle-options]').hidden=!state.settings.cycle;
    for(const control of editor.querySelectorAll('button,input,select'))control.disabled=busy||!ready||control.dataset.bgDisabled==='true';
    const retry=editor.querySelector('[data-bg-action=retry]');retry.hidden=ready;retry.disabled=busy;
    editor.querySelector('[data-bg-action=upload]').disabled=busy||!ready||state.images.length>=30;
    const status=editor.querySelector('[data-bg-status]');status.textContent=notice||(ready?'已连接共享背景':'正在连接共享背景…');status.dataset.error=String(failed);
    syncCurrent();
    hydrateThumbnails();
  }

  /** 接管图库按钮，所有写操作均经过现有 HA 登录会话。 */
  function onClick(event){
    const button=event.target.closest('button');if(!button||!editor.contains(button))return;
    event.preventDefault();event.stopPropagation();
    if(button.dataset.bgSetting){perform(()=>write({action:'settings',patch:settingsPatch(button.dataset.bgSetting,button.dataset.value)}));return;}
    const action=button.dataset.bgAction,id=button.dataset.id;
    if(action==='upload')editor.querySelector('[data-bg-files]').click();
    else if(action==='retry')refresh();
    else if(action==='cycle')perform(()=>write({action:'settings',patch:settingsPatch('cycle',!state.settings.cycle)}));
    else if(action==='use'){
      const image=[...BUILTIN_BACKGROUNDS,...state.images].find(item=>item.id===id);if(!image)return;
      perform(async()=>{if(!image.builtin&&!image.enabled&&state.settings.cycle)await write({action:'image',id,patch:{enabled:true}});await write({action:'settings',patch:{selected_id:id,source:state.settings.source==='all'?'all':image.builtin?'builtin':'custom'}});});
    }else if(action==='delete')perform(()=>write({action:'delete',id}));
    else if(action==='up'||action==='down')perform(()=>write({action:'move',id,direction:action==='up'?-1:1}));
    else if(action==='enabled'){const image=state.images.find(item=>item.id===id);if(image)perform(()=>write({action:'image',id,patch:{enabled:!image.enabled}}));}
  }

  /** 保存间隔、图片适用主题及上传文件，非法间隔保留用户输入并提示。 */
  function onChange(event){
    const target=event.target;
    if(target.matches('[data-bg-files]')){const files=Array.from(target.files||[]);target.value='';if(files.length)upload(files);return;}
    const field=target.dataset.bgField;
    if(field==='interval'||field==='unit'){
      const seconds=Number(editor.querySelector('[data-bg-field=interval]').value)*Number(editor.querySelector('[data-bg-field=unit]').value);
      if(!Number.isInteger(seconds)||seconds<5||seconds>86400){notice=ERROR_MESSAGES.invalid_interval;failed=true;editor.querySelector('[data-bg-status]').textContent=notice;editor.querySelector('[data-bg-status]').dataset.error='true';return;}
      perform(()=>write({action:'settings',patch:settingsPatch('interval_seconds',seconds)}));
    }else if(field==='image-theme')perform(()=>write({action:'image',id:target.dataset.id,patch:{theme:target.value}}));
  }

  /** 在设置打开后绑定新面板，重复打开不会叠加监听器。 */
  function mount(root){editor=root;gallerySignature='';builtinTheme='';if(!root)return;if(!mounted.has(root)){mounted.add(root);root.addEventListener('click',onClick);root.addEventListener('change',onChange);root.addEventListener('toggle',hydrateThumbnails,true);}renderEditor();}

  createVisiblePoll(()=>refresh(),5000).start();
  createVisiblePoll(()=>apply(),1000).start({immediate:false});
  return {markup:editorMarkup,mount,apply,refresh,get state(){return state;}};
}
