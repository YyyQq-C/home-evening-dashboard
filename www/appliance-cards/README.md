# 家电卡片

引入一个 JS 文件，页面上就会有单张家电卡片和设备详情弹窗的样式。这不是整页大屏，也不包含筛选条、顶栏或 2000×1200 画布。普通静态网页直接使用。

## 怎么用

把 `appliance-card.js` 放到你的项目里，用一个 script 引入。样式写在这个文件里，加载时自动插入，不必再链 CSS。

```html
<script src="./appliance-card.js"></script>
```

然后放一张卡片。完整标记可以对照 `card.html`。

```html
<section class="appliance-card" data-appliance="washer">
  <div class="appliance-visual"><img src="./assets/washer.png" alt=""></div>
  <div class="appliance-copy">
    <h2>洗衣机</h2>
    <p class="product-model">型号</p>
    <p class="location">生活阳台</p>
    <p class="appliance-state">洗涤中</p>
    <button class="action-pill" type="button">暂停</button>
    <button type="button" class="appliance-details-link" data-detail="washer">查看详情</button>
  </div>
</section>

<template id="detail-washer">
  <button type="button" class="appliance-detail-scrim" data-close></button>
  <section class="appliance-detail-dialog" role="dialog" aria-modal="true">
    <header>
      <div><small>设备详情</small><h2>洗衣机详情</h2></div>
      <button type="button" class="appliance-detail-close" data-close>关闭</button>
    </header>
    <div class="appliance-dialog-body">
      <!-- 左侧产品图和操作，右侧资料。完整结构见 card.html -->
    </div>
  </section>
</template>
```

- 卡片自己约 560×430 像素，放进普通文档流即可，宽度不够时会缩到容器里。
- `data-detail="washer"` 会打开 `<template id="detail-washer">`。弹窗盖住当前视口，点遮罩、关闭按钮或按 Esc 关掉。
- 产品图用你自己的相对路径，例如 `./assets/washer.png`。示例图在本目录 `assets/`。
- 默认深色。浅色时在 `<html>` 或这张卡片上写 `data-theme="light"`。从卡片打开弹窗时，会沿用卡片或页面上的 `data-theme`。
- 按钮只负责外观。开关、暂停、加减温度要自己写脚本，`card.html` 里有一份很短的例子。
- 不想用 script 时，可以改为 `<link rel="stylesheet" href="./appliance-card.css">`。这两份样式内容相同，都只包含卡片和详情。

## 界面

一张深色卡片，旁边可以再放别的卡片，由你的页面自己排版。

![单张家电卡片](docs/cards.png)

「查看详情」打开设备详情。左侧是产品图和操作，右侧是资料。

![设备详情弹窗](docs/detail.png)

## 本机预览

在仓库的 `www` 目录启动静态服务：

```sh
cd www
python3 -m http.server 8765
```

浏览器打开 <http://127.0.0.1:8765/appliance-cards/card.html>。

这个页面只有卡片和详情。顶上的浅色按钮是预览页自己的，不属于卡片样式。

直接双击 HTML 时，部分浏览器会拦截本地图片。用上面的静态服务打开即可。

`index.html` 是另一份整页画布演示，带筛选和 2/3/4 列。日常复用不要从那里开始。它使用 `appliance-cards.css`。

## 文件

| 文件 | 作用 |
| --- | --- |
| `appliance-card.js` | 首选入口。引入后注入卡片和详情样式，并打开详情弹窗 |
| `appliance-card.css` | 同一份卡片和详情样式，给不想用 script 的页面 |
| `card.html` | 普通网页里的单卡示例 |
| `appliance-cards.css`、`index.html` | 可选的整页画布演示 |
| `assets/` | 示例产品图 |
| `docs/` | 上面两张截图 |

## 可选：放到 Home Assistant

只有想把示例页挂在 Home Assistant 里时才需要这一步。复制 `appliance-cards` 目录后，在页面里写：

```html
<script src="/local/appliance-cards/appliance-card.js"></script>
```

普通网页不用这段地址，按上面的相对路径引用即可。
