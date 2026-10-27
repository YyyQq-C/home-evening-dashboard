# 家电卡片与设备详情样式

这里是从暮色展示页复制出来的家电卡片和设备详情样式，给单独复用。原页面没有改动。

家电卡片在「家电」页，标记类名是 `appliance-card`。点「查看详情」后出现的设备详情弹窗类名是 `appliance-detail-dialog`。这些规则原来都写在 `screen.css` 里，由 `app.js` 和 `appliance-dialog.js` 使用。家中概览（`home-overview.js`）挂的是摄像头、回放和电费卡片，不使用这套家电卡片。

## 文件

| 文件 | 作用 |
| --- | --- |
| `appliance-cards.css` | 复制出的样式。包含卡片、两到四列排布、详情弹窗，以及卡片用到的开关、胶囊按钮、圆形步进键和深浅色表面变量 |
| `index.html` | 只用本目录样式的静态示例，方便单独看卡片和详情 |

`index.html`、`control.html`、`screen.css`、`home-overview.js` 和 `app.js` 都没有改。展示页和控制页仍然加载原来的样式。

## 复用

样式表不替代 `screen.css`。需要这套卡片时，单独引入本文件，并包在带主题和列数的画布里：

```html
<link rel="stylesheet" href="./appliance-cards/appliance-cards.css">
<div class="screen" data-theme="dark" data-appliance-columns="3">
  <section class="page appliance-page">
    <div class="appliance-grid">
      <section class="appliance-card" data-appliance="washer">…</section>
    </div>
  </section>
</div>
```

`data-theme` 用 `dark` 或 `light`。浅色变量挂在 `html[data-theme=light]` 上。`data-appliance-columns` 用 `2`、`3` 或 `4`，对应展示页「家电布局」的每行个数。卡片结构可以参考本目录的 `index.html`，类名与原来的家电页一致。
