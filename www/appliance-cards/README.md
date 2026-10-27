# 家电卡片

`www/appliance-cards` 是一套可以单独打开、单独部署的家电卡片和设备详情样式。它和暮色大屏目录 `www/home-evening` 并列，不要放进大屏包里面。

## 界面

默认是深色、每行 3 张。第一行是洗衣机、冰箱、净水器，管线机在第二行。

![三列家电卡片](docs/cards.png)

点卡片上的「查看详情」打开设备详情。左侧是产品图和模拟操作，右侧是只读资料。

![冰箱设备详情](docs/detail.png)

## 本机预览

在仓库的 `www` 目录启动静态服务：

```sh
cd www
python3 -m http.server 8765
```

浏览器打开 <http://127.0.0.1:8765/appliance-cards/index.html>。

顶栏可以切换每行 2、3、4 张，以及深色和浅色。筛选有「全部」「厨房」「洗护」。这个页面只展示样式，不连接 Home Assistant，也不向设备发指令。

直接双击 `index.html` 时，部分浏览器会拦截本地图片。用上面的静态服务打开即可。

## 部署到 Home Assistant

把整个 `appliance-cards` 目录复制到 HA 配置目录的 `www` 下，和 `home-evening` 同级：

```text
配置目录/
  www/
    appliance-cards/
      index.html
      appliance-cards.css
      assets/
      docs/
    home-evening/
      ...原来的大屏文件
```

保存后在浏览器访问：

```text
http://homeassistant.local:8123/local/appliance-cards/index.html
```

地址里是 `/local/`，不是 `/www/`。只更新这一个目录时，不要覆盖 `www/home-evening`。暮色展示页和实控页仍然加载各自原来的样式，外观和入口都不变。

## 用到自己的页面

引入样式表，并包在一块 2000×1200 的画布里：

```html
<link rel="stylesheet" href="/local/appliance-cards/appliance-cards.css">
```

```html
<html lang="zh-CN" data-theme="dark">
<body>
  <div class="screen" data-theme="dark" data-appliance-columns="3">
    <section class="page appliance-page">
      <div class="appliance-grid">
        <section class="appliance-card" data-appliance="washer">
          <div class="appliance-visual"><img src="/local/appliance-cards/assets/washer.png" alt=""></div>
          <div class="appliance-copy">
            <h2>洗衣机</h2>
            <p class="product-model">型号</p>
            <p class="location">生活阳台</p>
            <!-- 状态、操作按钮、查看详情 -->
          </div>
        </section>
      </div>
    </section>
  </div>
</body>
</html>
```

完整的四张卡片和详情弹窗标记在 `index.html` 里，类名可以直接照着抄。

- `data-theme` 取 `dark` 或 `light`。浅色时，`<html>` 和 `.screen` 都要写成 `light`。浅色变量定义在 `html[data-theme=light]` 上。
- `data-appliance-columns` 取 `2`、`3` 或 `4`。2 列是横排大卡，3 列是紧凑横排，4 列把产品图放在文字上面。
- 产品图在本目录 `assets/`。换成自己的图片时，只改 `<img src>`。
- 示例页会把 2000×1200 画布缩进浏览器窗口。嵌到别的页面时，给 `.screen` 留出这块区域，或按窗口宽高做同样的 `scale()`。

## 文件

| 文件 | 作用 |
| --- | --- |
| `appliance-cards.css` | 卡片、详情弹窗、列数和深浅色 |
| `index.html` | 可切换列数、主题和筛选的示例页 |
| `assets/` | 洗衣机、冰箱、净水器、管线机产品图 |
| `docs/` | 上面两张界面截图 |
