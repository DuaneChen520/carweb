# CarWeb - 车机虚拟屏

基于 WebUSB / WebSocket 与 WebCodecs API 的浏览器端 Android 屏幕镜像工具，专为车机浏览器环境设计。
支持**有线（USB）**和**无线（WiFi）**两种连接方式，在车机浏览器内创建独立虚拟屏并运行手机应用，支持分屏与全屏切换。

## 功能特性

- **有线连接**：USB 数据线直连，通过 WebUSB API 建立 ADB 连接
- **无线连接**：扫描局域网设备 / 扫「无线调试」二维码完成配对，无需 USB 线
- **虚拟屏 + 分屏**：在手机上创建独立虚拟屏，支持左右分屏与全屏切换
- **应用管理**：设备端解析应用名与图标，置顶、常用应用 dock、全部应用浮窗
- **触摸操控**：触摸/鼠标/键盘事件转发到手机，支持 IME 软键盘
- **音频链路**：整机音频由一条专用采集连接独占承载（ADR-0015）
- **链路健康**：连接中断自动重连，分屏/全屏切换画面不中断

## 使用环境要求

### 浏览器要求
- **Chrome / Edge**（需支持 WebUSB API 与 WebCodecs API）
- 页面必须以 **HTTPS** 或 **localhost** 方式运行（WebUSB 安全要求）

### 手机端要求
- Android 设备，已开启 **开发者选项** 与 **USB 调试**
- 有线连接时需在手机上允许 USB 调试授权

### 无线连接的额外要求
- 车机与手机处于同一局域网（车机热点或手机热点均可）
- **车机上需运行本项目的桥接代理**（见下文「无线连接」章节）

## 快速开始

### 安装依赖

```bash
npm install
```

> 安装后会自动执行 `patch-package` 应用 `patches/` 下的本地补丁（针对 yume-chan 3.0.0-beta 的已知问题）。

### 开发模式运行

```bash
npm run dev
```

应用将在 `http://localhost:5173` 启动。

> 开发服务器使用 HTTP 协议，WebUSB 功能需要在 HTTPS 或 localhost 环境下才能正常工作。

### 校验与构建

```bash
npm run test     # Vitest 全量测试
npm run check    # TypeScript 类型检查
npm run lint     # ESLint 静态检查
npm run build    # 生产构建，产物在 dist/
```

### 部署

构建产物为纯静态站点，Vite `base` 已设为相对路径 `./`，可直接部署到任意静态托管
（当前生产环境使用 EdgeOne，配置见 `edgeone.json` 与 `.edgeone/project.json`）。

## 使用说明

### 有线连接（USB）

1. 使用 USB 数据线将手机连接到车机
2. 在手机上允许 USB 调试授权
3. 在 CarWeb 界面选择「有线连接」
4. 点击「连接设备」，在浏览器弹出的设备选择框中选择手机
5. 连接成功后即可启动虚拟屏

### 无线连接（WiFi）

无线路径依赖跑在**车机本机**的桥接代理：浏览器无法直接连接手机的 5555 端口，
必须由代理做 WebSocket ↔ TCP 转发。代理同时负责无线配对与网段扫描。

**第一步：在车机上构建并运行桥接代理**

```bash
cd bridge
go build -o tiny-bridge main.go
./tiny-bridge          # 默认监听 8080 端口
```

代理提供三个端点：

| 端点 | 用途 |
| --- | --- |
| `/adb/{target}` | WebSocket ↔ TCP 双向桥接，转发到手机 ADB 端口 |
| `/pair` | ADB 无线配对握手（TLS + SPAKE2 + AES-128-GCM） |
| `/scan/{subnet}` | 扫描网段内开放的 5555 端口，发现局域网设备 |

> **已知问题**：`bridge/go.mod` 依赖的 `github.com/backkem/spake2-go v0.1.0` 在上游尚无对应 tag，
> 且仓库缺少 `go.sum`，当前状态下代理**无法编译**。修复前请改用 USB 路径，或先修正该依赖版本。

**第二步：连接**

1. 确保手机开启「开发者选项 → 无线调试」，车机与手机处于同一局域网
2. 在 CarWeb 界面选择「无线连接」
3. 选择「扫描设备」自动发现，或直接输入手机 IP
4. 首次连接需扫描手机「无线调试」页显示的二维码完成配对
5. 连接成功后即可启动虚拟屏

### 虚拟屏操作

- **自适应显示**：虚拟屏随浏览器窗口尺寸自动调整，保持手机原始比例
- **分屏 / 全屏**：左右分屏可各跑一个应用，点击顶栏按钮进入全屏
- **触摸操控**：在虚拟屏上点击、滑动即可操控手机
- **断开连接**：点击侧栏的电源按钮断开连接

## 项目结构

```
carweb/
├── bridge/                     # Go 桥接代理（车机本地运行，端口 8080）
│   └── main.go                 # 配对 / 转发 / 扫描三个端点
├── public/
│   ├── scrcpy-server.jar       # scrcpy 服务端（官方 v4.0，与客户端库版本严格匹配）
│   ├── app-info-fetcher*.dex   # 设备端应用信息解析器
│   └── fonts/puhuiti/          # 自托管字体（阿里巴巴普惠体 3.0）
├── src/
│   ├── components/             # UI 组件（desktop/ 为分屏桌面子组件）
│   ├── contexts/               # ScrcpyContext / AppPickerContext
│   ├── hooks/                  # 连接层与业务 hook（scrcpy/ 为会话层 hook）
│   ├── lib/                    # 核心逻辑（scrcpy4/ 为 scrcpy 4.0 协议扩展）
│   ├── utils/                  # 通用工具
│   ├── App.tsx                 # 主应用组件
│   └── main.tsx                # 入口
├── docs/
│   ├── adr/                    # 架构决策记录
│   └── agents/                 # Agent 使用约定
├── .scratch/                   # 本地 issue tracker（spec + 一票一文件）
├── GLOSSARY.md                 # 领域术语表（事实源）
├── DESIGN.md                   # 设计系统（UI 唯一事实源）
└── package.json
```

## 技术栈

- **React 18** + **TypeScript** + **Vite 6**
- **Tailwind CSS 3** — 样式框架
- **Zustand** — 状态管理
- **@yume-chan/***（3.0.0-beta.1）— 浏览器端 ADB 与 scrcpy 协议实现
- **scrcpy 4.0** — 设备端 server（`public/scrcpy-server.jar`）
- **WebCodecs API** + **WebGL** — 视频解码与渲染
- **Go** — 车机端无线桥接代理

## 注意事项

1. **HTTPS 要求**：WebUSB API 要求页面必须在 HTTPS 或 localhost 环境下运行，生产部署请配置 SSL 证书。

2. **scrcpy-server 版本必须匹配**：`public/scrcpy-server.jar` 与 `@yume-chan/adb-scrcpy` 客户端库版本需严格一致，
   否则连接时直接报 `scrcpy server exited prematurely`。当前为官方 **v4.0**（可用 `scripts/verify-scrcpy-server.sh` 校验字节一致性）。

3. **无线连接需要桥接代理**：纯浏览器无法直连手机 5555 端口，WiFi 投屏必须先在车机运行 `bridge` 代理。

4. **浏览器兼容性**：
   - WebUSB API：Chrome 61+、Edge 79+
   - WebCodecs API：Chrome 94+、Edge 94+
   - 不支持 Safari 和 Firefox

5. **性能参数**：
   - 码率按像素数计算：`clamp(8Mbps × (w×h)/(1920×1080), 1Mbps, 40Mbps)`，见 `VirtualScreen.tsx` / `DesktopScreen.tsx` 的 `displayConfig`
   - 帧率固定 60fps，见 `scrcpy-session.ts` 的 scrcpy options
   - 虚拟屏 DPI 由 smallest-width=600dp 反推，见 `utils/display.ts` 的 `calculateDpi`

## 常见问题

**Q: 提示"浏览器不支持 WebUSB API"**
A: 请使用 Chrome 或 Edge，并确保页面在 HTTPS 或 localhost 环境下运行。

**Q: 连接时提示"scrcpy server exited prematurely"**
A: 通常是 `public/scrcpy-server.jar` 与客户端库版本不匹配。若版本一致仍失败，多为设备端虚拟屏数量超限或反向隧道冲突，
错误诊断见 `scrcpy-session.ts` 的 `diagnoseFailure` 输出。

**Q: 无线连接失败 / 扫不到设备**
A: 确认三件事：车机上代理已运行（8080 端口可访问）、车机与手机在同一网段、手机已开启无线调试。
首次连接还需扫二维码配对。

**Q: 虚拟屏画面卡顿**
A: 优先在侧栏切换分辨率档位（原画 / 超清 / 高清 / 流畅），其次是缩小窗口尺寸；码率随像素数自动缩放。

**Q: 分屏时没有声音**
A: 整机音频由唯一一条专用采集连接承载（ADR-0015），请不要给每个 pane 单独开 `audio:true`。

## 许可证

MIT License
