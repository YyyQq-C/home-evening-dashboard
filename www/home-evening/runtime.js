/** 创建可恢复的可见页轮询：隐藏时停表，返回时立即同步，重复启动不会叠加。 */
export function createVisiblePoll(callback,delay,{document:doc=document,window:win=window}={}){
  let enabled=false,suspended=false,timer=null;
  /** 只释放当前定时器，保留页面返回后恢复的意图。 */
  function clear(){if(timer!==null){win.clearInterval(timer);timer=null;}}
  /** 同步执行失败时记录错误，让后续轮询仍能继续恢复。 */
  function tick(){try{callback();}catch(error){console.error('Visible polling refresh failed',error);}}
  /** 根据真实页面可见性恢复一次即时刷新及单一定时器。 */
  function resume(immediate=true){
    clear();
    if(!enabled||suspended||doc.hidden)return;
    if(immediate)tick();timer=win.setInterval(tick,delay);
  }
  /** 启动轮询，重复调用不重复刷新或分配定时器。 */
  function start({immediate=true}={}){if(enabled)return;enabled=true;resume(immediate);}
  /** 主动停止后保持停用，直到调用方再次启动。 */
  function stop(){enabled=false;clear();}
  doc.addEventListener('visibilitychange',resume);
  win.addEventListener('pagehide',()=>{suspended=true;clear();});
  win.addEventListener('pageshow',()=>{if(suspended){suspended=false;resume();}});
  return {start,stop};
}
