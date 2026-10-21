/** 将新建独立页面承载为 HA 仪表盘，不绑定任何 HA 实体和服务。 */
class HaEveningScreen extends HTMLElement {
  /** 初始化隔离的样式和全屏 iframe。 */
  constructor() {super();this.attachShadow({mode:'open'});}
  /** 设置新页面的同源入口，不改动已有仪表盘。 */
  setConfig(config) {
    const url=new URL(config.url,location.origin);
    if(url.origin!==location.origin||!url.pathname.startsWith('/local/home-evening/'))throw new Error('Invalid evening screen URL');
    this.shadowRoot.innerHTML='<style>:host{display:block}iframe{position:fixed;left:0;top:0;border:0;z-index:6;background:#181918}</style>';
    const frame=document.createElement('iframe');frame.src=url.href;frame.title='暮色居家大屏 · 模拟';this.shadowRoot.append(frame);
    // 按父页面可见区域设置像素尺寸，避免 100vw 在 WebView 里宽过屏幕。
    const fit=()=>{
      const root=document.documentElement,view=window.visualViewport;
      const width=Math.min(root.clientWidth||innerWidth,view&&view.width?view.width:innerWidth);
      const height=Math.min(root.clientHeight||innerHeight,view&&view.height?view.height:innerHeight);
      frame.style.width=`${width}px`;frame.style.height=`${height}px`;
    };
    fit();
    window.addEventListener('resize',fit);
    if(window.visualViewport) window.visualViewport.addEventListener('resize',fit);
  }
  /** 声明卡片使用完整面板高度。 */
  getCardSize() {return 12;}
}
if(!customElements.get('ha-evening-screen'))customElements.define('ha-evening-screen',HaEveningScreen);
