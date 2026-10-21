import {SITE,entityId} from './site-config.js';
import {createCameraExpansion} from './camera-expand.js';

/** 在现有摄像头画面区域播放 HA HLS，停止或离开页面时释放媒体资源。 */
export function createCameraPlayer(host,readHass){
  const preview=host.querySelector('.overview-camera-preview'),video=host.querySelector('.overview-camera-video'),button=host.querySelector('#overview-camera-open'),status=host.querySelector('.overview-camera-playback');
  let request=0,active=false,hls=null,timeout=null;
  const expansion=createCameraExpansion(host,()=>{if(!active)play();});
  /** 更新播放提示，空提示时恢复完整播放器操作区域。 */
  function message(text){status.textContent=text;status.hidden=!text;}
  /** 停止取流、使未完成请求失效并恢复缩略图入口。 */
  function stop(text=''){
    expansion.close(false);
    request++;active=false;clearTimeout(timeout);hls?.destroy();hls=null;
    video.pause();video.removeAttribute('src');video.load();video.hidden=true;preview.hidden=false;
    button.textContent='播放实时画面';button.setAttribute('aria-pressed','false');message(text);
  }
  /** 结束失败的播放，只保留可重试提示，不输出签名地址。 */
  function fail(reason){console.error('Home overview live camera playback failed',reason||'unknown');stop('播放失败，请点击重试');}
  /** 请求当前摄像头的同源播放地址，在卡片内启动原生或 HLS 播放。 */
  async function play(){
    if(active)return;
    const hass=readHass(),entity=hass?.states?.[entityId('camera.example_camera')];
    if(!hass||hass.connected===false||!entity||['unknown','unavailable'].includes(entity.state))return;
    active=true;const current=++request;preview.hidden=true;video.hidden=false;video.muted=true;video.autoplay=true;
    button.textContent='停止播放';button.setAttribute('aria-pressed','true');message('正在连接实时画面…');
    timeout=setTimeout(()=>{if(current===request)fail('connection_timeout');},90000);
    try{
      const stream=await hass.callWS({type:'camera/stream',entity_id:entity.entity_id,format:'hls'});
      if(current!==request)return;
      const url=new URL(stream.url,location.origin);
      if(url.origin!==location.origin||url.username||url.password||!['http:','https:'].includes(url.protocol))throw new Error('Unexpected live camera media origin');
      /** 媒体源就绪后再开始播放，避免 MediaSource 挂载时中断提前发起的播放。 */
      async function startVideo(){
        if(current!==request)return;
        try{await video.play();}
        catch(error){
          if(current!==request||error.name==='AbortError')return;
          if(error.name==='NotAllowedError'){clearTimeout(timeout);message('画面已就绪，请点击播放器播放');}
          else fail(error.name);
        }
      }
      const {default:Hls}=await import('./hls-vendor.js');
      if(current!==request)return;
      // 与 HA 播放器一致，优先使用 HLS 解封装，避免浏览器原生 HLS 的格式误判。
      if(Hls.isSupported()){
        hls=new Hls({enableWorker:true,backBufferLength:15,maxBufferLength:15,fragLoadingTimeOut:30000,manifestLoadingTimeOut:30000,levelLoadingTimeOut:30000});
        hls.on(Hls.Events.ERROR,(_,data)=>{if(current===request&&data.fatal)fail(data.details);});
        hls.on(Hls.Events.MANIFEST_PARSED,startVideo);
        hls.on(Hls.Events.MEDIA_ATTACHED,()=>{if(current===request)hls.loadSource(url.href);});
        hls.attachMedia(video);
      }else if(video.canPlayType('application/vnd.apple.mpegurl')){video.src=url.href;await startVideo();}
      else throw new Error('Live HLS playback is unsupported');
    }catch(error){if(current===request)fail(error.name);}
  }
  /** 切换当前画面的播放状态，连接过程中也允许立即停止。 */
  function toggle(){if(active)stop();else play();}
  preview.addEventListener('click',play);button.addEventListener('click',toggle);
  video.addEventListener('playing',()=>{if(active){clearTimeout(timeout);message('');}});
  video.addEventListener('waiting',()=>{if(active)message('正在缓冲…');});
  video.addEventListener('pause',()=>{if(active)message('已暂停，可点击播放器继续');});
  video.addEventListener('error',()=>{if(active)fail('media_error_'+video.error?.code);});
  video.addEventListener('ended',()=>{if(active)stop('播放已结束，点击可重新播放');});
  window.addEventListener('pagehide',()=>stop());
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&active)stop();});
  return {stop,isActive:()=>active};
}
