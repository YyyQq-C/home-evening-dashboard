# 暮色居家 · Home Evening Dashboard

把自己的户型放进 Home Assistant：首页看 2D/3D 房子、天气、日历和房间设备，家中概览看摄像头、电费与网络状态。

本项目按技术分享整理，提供能部署的前端、模型源码、可选集成快照和逐步配置说明。先把默认页面打开，再换图片、接设备，不必先学三维建模。

- GitHub：[YyyQq-C/home-evening-dashboard](https://github.com/YyyQq-C/home-evening-dashboard)
- Gitee：[YongQianc/home-evening-dashboard](https://gitee.com/YongQianc/home-evening-dashboard)

![暮色居家界面示例](docs/images/home-demo.png)

图为整理项目时的界面截图。原户型里的家居灯光、设备和场景仍为模拟；新版 Pad 操作另有显式配置，图标变化不能代替设备回读。

## 先分清两个入口

| 页面 | 用途 | 控制行为 |
| --- | --- | --- |
| `index.html` | 原暮色界面：户型、房间、天气、日历、概览、家电 | 可绑定真实读数；设备、灯光和场景操作仍模拟 |
| `control.html` | 新增独立设备控制页 | 默认只读；配置实体并手动启用 `live` 后，才调用 HA 服务 |

独立家居控制页与原展示页内新增 Pad 操作分别配置，默认均只读。原模型按钮未全部接成实控；共享背景管理另需可选后端。完整区别见 [Pad 与界面更新](docs/07-Pad操作与界面更新.md)。

## 2026-10-23 界面更新

已同步 2D 灯光缓存与 transform 动画、上下切页和侧栏手势、概览卡片复用、电费日历和曲线稳定、摄像头缩放及大回放弹窗、主题统一、家电内容自适应，以及 Pad CPU 和 23 项显式映射操作。共享背景支持上传、删除、显示方式和轮换规则。

升级时保留自己的配置与图库，按 [更新与 Pad 教程](docs/07-Pad操作与界面更新.md) 合并新增文件；背景后端安装见 [背景教程](docs/06-更换背景图片.md)。具体变化和验证范围见 [CHANGELOG](CHANGELOG.md)。

## 按需求找教程

| 想做什么 | 对应说明 |
| --- | --- |
| 从下载开始，第一次显示页面并填一台设备 | [00 · 新手上手与配置示例](docs/00-新手上手与配置示例.md) |
| 查文件位置、仪表盘和配置加载方式 | [01 · 安装和第一次打开](docs/01-安装和第一次打开.md) |
| 灯、空调、地暖、新风和场景怎么实控 | [02 · 真实控制配置](docs/02-真实控制配置.md) |
| 天气、电网、摄像头、平板数据怎么接 | [03 · 数据接入配置](docs/03-数据接入配置.md) |
| 每组源码和工具的作用 | [04 · 文件逐项说明](docs/04-文件逐项说明.md) |
| 换自己的户型、改模型、更新和回退 | [05 · 更换户型和维护](docs/05-更换户型和维护.md) |
| 换背景、固定单图、增加轮换、处理缓存 | [06 · 更换背景图片](docs/06-更换背景图片.md) |
| 配置 Pad 的 23 项操作、理解本轮升级 | [07 · Pad 操作与界面更新](docs/07-Pad操作与界面更新.md) |
| 查原展示页的读数别名 | [实体映射索引](docs/实体映射索引.md) |
| 查已验证和未验证内容 | [验证与脱敏说明](docs/验证与脱敏说明.md) |
| 查组件和图片来源 | [第三方来源与版本](THIRD_PARTY.md) |

配置说明均提供同名 HTML，离线双击可读。总览是 [离线使用说明.html](离线使用说明.html)。根目录只使用 `README.md` 作为仓库首页，避免 Gitee 误显示 HTML 源码。

## 快速开始：先显示页面

### 1. 下载项目

GitHub 点击 `Code → Download ZIP`；Gitee 从“克隆/下载”下载 ZIP，解压即可。使用 Git 的电脑可以运行下面任意一个命令，仅下载公开源码，不访问 HA 或操作设备：

```sh
git clone https://gitee.com/YongQianc/home-evening-dashboard.git
```

```sh
git clone https://github.com/YyyQq-C/home-evening-dashboard.git
```

现成网页已包含打包的 Three.js、视频和历法依赖。仅部署使用页面，不要求安装 npm、Node.js 或 Python。

### 2. 复制前端目录

找到自己 HA 中包含 `configuration.yaml` 的配置目录，把仓库的 `www/home-evening` 整个复制到其 `www/home-evening` 下：

```text
HA 配置目录/
  configuration.yaml
  www/
    home-evening/
      index.html
      control.html
      site-config.js
      screen.css
      assets/
      ...其他运行文件
```

先只复制前端目录。不要把模型开发源码、集成目录、账号配置、数据库和原始图纸全部复制到 `www`。

### 3. 新建 HA 仪表盘

新建一个可编辑仪表盘，进入编辑及原始配置编辑器，粘贴下面内容，也就是 [configs/dashboard.yaml](configs/dashboard.yaml)。只处理新仪表盘，保留已有配置。

```yaml
title: 暮色居家示例
views:
  - title: 户型展示
    path: home
    type: panel
    cards:
      - type: iframe
        url: /local/home-evening/index.html
  - title: 真实控制
    path: control
    type: panel
    cards:
      - type: iframe
        url: /local/home-evening/control.html
```

保存后应有两个页签。还没填实体也能看默认户型、背景和日历；天气、设备提示未配置或不可用是正常现象。

`/local/` 对应 HA 配置目录里的 `www/`。从 HA 仪表盘打开，页面才能读取父级已有的 HA 会话。直接双击 HTML 或独立打开静态地址不能代替这个宿主。复制静态文件本身不要求重启 HA。

### 4. 先配置一台设备

在 HA“开发者工具 → 状态”复制自己的准确实体 ID，编辑 HA 上的 `site-config.js`，填写 `control.devices`，保持 `control.mode: 'read-only'`。

先核对名称、状态和设备能力，再在原生 HA 中确认能操作。确实需要下发时才改为 `live`，观察一台设备的动作。完整的可复制配置与每一步预期结果见 [新手上手](docs/00-新手上手与配置示例.md)。

原展示页的读数另由 `entities`、`weather.sensors` 配置，不会按房间名称自动匹配。前端不填 HA 密码、长期令牌、天气密钥或摄像头验证码。

## 换背景，最简单怎么做

页面背景与中间户型分开。只换背景，先处理 `www/home-evening/assets` 中这六张图：

| 主题 | 0 号 | 1 号 | 2 号 |
| --- | --- | --- | --- |
| 深色 | `background-night.webp` | `background-night-aurora.webp` | `background-night-interior.webp` |
| 浅色 | `background-day.webp` | `background-day-interior.webp` | `background-day-lineart.webp` |

现有图片和设计画布都是 2000×1200。将自己的图片真正转换为 WebP、保留备份，再同名替换文件；只改 JPG 扩展名不能完成转换。

默认内置规则仍是深浅主题各三张、每小时轮换。新版可以在“显示设置 → 背景图片”上传和选择背景、关闭轮换固定单图、选择裁剪/完整显示/拉伸、设置顺序或随机及间隔。需要先安装可选 `home_evening_backgrounds` 组件，所有已登录 HA 用户均能管理共享图库。

不安装后端仍可使用默认图或同名替换静态文件。上传后的图片和规则保存在 HA 独立目录，不随静态页面更新被覆盖。安装步骤、六张原图、上传限制与旧版迁移见 [背景教程](docs/06-更换背景图片.md)。换户型另看 [户型教程](docs/05-更换户型和维护.md)。

## 设备和数据接入路径

| 模块 | 数据链路 | 先确认什么 |
| --- | --- | --- |
| 空调、地暖、新风、灯光 | 品牌集成 → HA 实体 → 页面读数或显式服务调用 | 原生 HA 中先能显示、能操作 |
| 天气 | 和风后端 → 天气与附属传感器、预报订阅 | 地点、单位、实体和预算初始化 |
| 电费 | `state_grid` → 原始实体 → 模板桥接 → 前端卡片 | 先有原始数据，再查桥接属性 |
| 视频 | 摄像头集成 → HA camera 实体 → HLS 播放 | 原生详情先能播放，回放另验证 |
| 日历 | 本地中国历与 lunar-javascript | 不接个人日程和提醒服务 |

已有 HA 实体就不必安装全部后端，也不必更换设备品牌。随附后端为指定版本快照，HA/Python、机型和地区有兼容限制，见 [数据接入](docs/03-数据接入配置.md)。

## 本机预览和检查

有 Python 3 的开发电脑，在仓库根目录运行，提供本机静态预览，用 Ctrl+C 停止；不部署、不连接家电：

```sh
python -m http.server 8793 --bind 127.0.0.1 --directory www
```

打开 `http://127.0.0.1:8793/home-evening/index.html`。适合看背景、布局和日历；没有 HA 宿主，不能据此验证真实数据。

有 Node.js 时可运行离线控制测试，仅在内存中模拟服务，包含原展示页与独立控制入口测试：

```sh
npm test
```

完整源码语法、JSON、默认配置及已知敏感模式检查需要 Python 3.14 和 Node.js。3.14 要求来自视频后端语法，不是网页运行要求：

```sh
python tools/validate_package.py
```

背景后端的图片与输入校验可在已安装 Pillow 的 Python 环境运行 `python -B tests/background_backend_test.py`，不加载 HA、不写图库。

## 更新和排查

- 更新前备份自己的 `site-config.js`、背景和仪表盘配置，不用默认空映射覆盖个人配置。
- 页面空白，先查 `/local/` 路径和文件完整性；直接请求脚本或图片，确认不是 404 或登录页。
- 设备全不可用，先查同源 iframe、准确实体和当前用户权限。
- 模型亮灯但家里没动作，是因为原展示页仍模拟；实控入口是 `control.html`。
- 换图没变化，先确认主题和序号，再处理缓存。项目不注册 Service Worker，额外缓存规则需按自己的环境处理。

项目不含原家庭凭据、原始 DWG、账本和数据库。保留的第三方组件和产品图片不自动获得统一授权，继续分享前请阅读 [THIRD_PARTY.md](THIRD_PARTY.md)。
