// 摄像头页面内浏览并播放 SD 卡录像，复用 HA 当前用户会话。
class SdReplayCard extends HTMLElement {
  /** 初始化播放器、录像列表及请求状态。 */
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._request = 0;
    this._loaded = false;
    this.shadowRoot.innerHTML = `
      <style>
        :host{display:block}ha-card{overflow:hidden}.header{display:flex;align-items:center;justify-content:space-between;padding:16px 16px 6px;gap:12px}
        h2{font-size:18px;font-weight:500;margin:0}.hint,.status{font-size:13px;color:var(--secondary-text-color);padding:0 16px 12px}
        button{font:inherit;color:var(--primary-text-color);cursor:pointer;background:transparent;border:0}button:focus-visible{outline:2px solid var(--primary-color);outline-offset:-2px}
        .refresh{color:var(--primary-color);padding:8px;border-radius:8px}button:disabled{opacity:.5;cursor:default}
        .list{max-height:320px;overflow:auto}.clip{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;text-align:left;padding:14px 16px;border-top:1px solid var(--divider-color)}
        .clip[aria-pressed=true]{background:var(--secondary-background-color)}.play{color:var(--primary-color);flex-shrink:0}.time{min-width:0;overflow-wrap:anywhere}
        .player{padding:0 16px 16px}video{display:block;width:100%;max-height:55vh;background:#000;border-radius:8px}.selected{font-size:13px;margin:8px 0;color:var(--secondary-text-color)}[hidden]{display:none!important}
      </style>
      <ha-card><div class="header"><h2>SD 卡录像</h2><button class="refresh" type="button">刷新</button></div>
      <div class="hint">最近 24 小时 · 点击录像即可播放</div>
      <div class="player" hidden><video controls playsinline preload="none"></video><div class="selected"></div></div>
      <div class="status" role="status" aria-live="polite">正在读取录像…</div><div class="list"></div></ha-card>`;
    this._video = this.shadowRoot.querySelector('video');
    this.shadowRoot.querySelector('.refresh').addEventListener('click', () => this._load());
    this._video.addEventListener('playing', () => this._status('正在播放'));
    this._video.addEventListener('waiting', () => this._status('正在缓冲…'));
    this._video.addEventListener('error', () => {
      console.error('SD replay media playback failed');
      this._status('录像播放失败，请重新点击该录像或刷新列表。');
    });
  }

  /** 设置本卡片对应的摄像头序列号。 */
  setConfig(config) {
    if (!config.serial || !/^[a-zA-Z0-9]+$/.test(config.serial)) throw new Error('Camera serial is required');
    if (this._config?.serial !== config.serial) this._loaded = false;
    this._config = config;
    this._maybeLoad();
  }

  /** 获取 HA 当前用户连接，不在卡片中保存账号或密码。 */
  set hass(hass) { this._hass = hass; this._maybeLoad(); }

  /** 页面重新进入时刷新录像列表。 */
  connectedCallback() { this._maybeLoad(); }

  /** 离开摄像头页后停止视频，释放回放连接。 */
  disconnectedCallback() {
    this._request++;
    this._loaded = false;
    this._video.pause();
    this._video.removeAttribute('src');
    this._video.load();
  }

  /** 配置和用户连接齐备后仅加载一次，避免 HA 状态更新反复查询。 */
  _maybeLoad() {
    if (this.isConnected && this._hass && this._config && !this._loaded) {
      this._loaded = true;
      this._load();
    }
  }

  /** 更新可访问的加载、播放或错误提示。 */
  _status(text) { this.shadowRoot.querySelector('.status').textContent = text; }

  /** 将接口返回的录像时间范围转成当前浏览器本地时间。 */
  _label(clip) {
    const match = clip.media_content_id?.match(/\/(\d+)-(\d+)$/);
    if (!match) return clip.title || '录像';
    const options = { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false };
    return `${new Date(Number(match[1])).toLocaleString('zh-CN', options)} — ${new Date(Number(match[2])).toLocaleString('zh-CN', options)}`;
  }

  /** 查询 SD 卡录像目录，刷新列表时保留已开始的播放。 */
  async _load() {
    if (!this._hass || !this._config) return;
    const refresh = this.shadowRoot.querySelector('.refresh');
    refresh.disabled = true;
    this._status('正在读取录像…');
    try {
      const result = await this._hass.callWS({ type: 'media_source/browse_media', media_content_id: `media-source://ezviz_stream/${this._config.serial}/sd` });
      if (!this.isConnected) return;
      const clips = (result.children || []).filter(clip => clip.can_play);
      clips.sort((a, b) => Number(b.media_content_id.match(/\/(\d+)-/)?.[1] || 0) - Number(a.media_content_id.match(/\/(\d+)-/)?.[1] || 0));
      const list = this.shadowRoot.querySelector('.list');
      list.replaceChildren();
      for (const clip of clips) {
        // 使用 textContent 渲染接口数据，避免将录像标题解释为 HTML。
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'clip';
        button.setAttribute('aria-pressed', String(clip.media_content_id === this._selected));
        const label = document.createElement('span');
        label.className = 'time';
        label.textContent = this._label(clip);
        const action = document.createElement('span');
        action.className = 'play';
        action.textContent = '播放';
        button.append(label, action);
        button.addEventListener('click', () => this._play(clip, button));
        list.append(button);
      }
      this._status(clips.length ? `共 ${clips.length} 段录像` : '最近 24 小时暂无可用录像。');
    } catch (_) {
      console.error('SD replay recording list request failed');
      this._status('读取录像失败，请确认摄像头在线后重试。');
    } finally { refresh.disabled = false; }
  }

  /** 解析用户选中的录像并在当前卡片内播放，忽略过期请求。 */
  async _play(clip, button) {
    const request = ++this._request;
    this._status('正在连接录像…');
    this._video.pause();
    this._video.removeAttribute('src');
    this._video.load();
    try {
      const result = await this._hass.callWS({ type: 'media_source/resolve_media', media_content_id: clip.media_content_id });
      if (request !== this._request || !this.isConnected) return;
      // 只接收 HA 同源播放地址，不向外部站点传输认证信息。
      const url = new URL(result.url, location.origin);
      if (url.origin !== location.origin || url.username || url.password) throw new Error('Unexpected replay media origin');
      this._selected = clip.media_content_id;
      for (const item of this.shadowRoot.querySelectorAll('.clip')) item.setAttribute('aria-pressed', String(item === button));
      this.shadowRoot.querySelector('.player').hidden = false;
      this.shadowRoot.querySelector('.selected').textContent = this._label(clip);
      this._video.src = url.href;
      try { await this._video.play(); }
      catch (error) {
        if (request !== this._request || error.name === 'AbortError') return;
        if (error.name === 'NotAllowedError') this._status('录像已就绪，请点击播放器中的播放按钮。');
        else throw error;
      }
    } catch (_) {
      if (request !== this._request) return;
      console.error('SD replay media resolution failed');
      this._status('无法播放该录像，请重试或选择其他录像。');
    }
  }

  /** 为 HA 瀑布流布局提供卡片高度估算。 */
  getCardSize() { return 6; }
}

if (!customElements.get('sd-replay-card')) customElements.define('sd-replay-card', SdReplayCard);
