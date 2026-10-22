# CarWeb

基于 WebUSB / WebSocket 与 WebCodecs API 的纯前端车机 Android 投屏工具。无需车机安装额外 App，在车机浏览器中直接创建独立虚拟屏运行手机应用，支持分屏与全屏切换。

## 特性

- **即插即用**：支持 USB 有线直连（WebUSB）与 WiFi 局域网无线连接（WebSocket 网桥）。
- **独立虚拟屏**：在手机上开辟独立副屏，支持左右分屏双应用协同或单应用全屏。
- **车载级交互**：针对车机环境优化的暗色界面、防误触大触摸目标与软键盘（IME）输入转发。
- **高性能低延迟**：硬件级 WebCodecs 视频解码与 Web Audio 专用音频采集链路。

## 环境要求

- **浏览器**：Chrome 94+ 或 Edge 94+（需支持 WebUSB / WebSockets 与 WebCodecs；页面需在 `https://` 或 `localhost` 下运行）。
- **手机端**：Android 设备，开启「开发者选项」与「USB 调试」（无线模式需开启「无线调试」）。

## 快速上手

### 1. 安装与本地开发

```bash
npm install
npm run dev
```

浏览器打开 `http://localhost:5173`。

### 2. 构建与检查

```bash
npm run check    # TypeScript 类型检查
npm run lint     # ESLint 静态检查
npm run test     # Vitest 自动化测试
npm run build    # 生产构建（产物在 dist/，纯静态直接部署）
```

## 连接方式

### 方式 A：有线连接（USB，推荐）
1. 手机开启 USB 调试，通过数据线连接车机。
2. 页面选择「有线连接」并点击「连接设备」。
3. 在浏览器弹窗中选中手机完成授权即可。

### 方式 B：无线连接（WiFi）
由于浏览器无法直接发起原生 TCP 连接，需在车机宿主端运行极简转发网桥（将本地 ADB 守护进程通过 WebSocket 暴露给网页）：

```bash
# 启动网桥（监听 8080 端口，转发本地 ADB 5037 端口）
node bridge/bridge-node.cjs
# 或运行 Go 编译版本：go build -o tiny-bridge bridge/main.go && ./tiny-bridge
```

在页面选择「无线连接」，输入手机 IP/端口或扫描配对连接。

## 常见排错

- **浏览器提示不支持 WebUSB**：确保使用 Chrome/Edge，且访问地址协议为 `https://` 或 `localhost`。
- **提示 `scrcpy server exited prematurely`**：`public/scrcpy-server.jar` 须为官方 v4.0 版本，且手机上避免残留其它 scrcpy 进程占用反向隧道。
- **投屏画面卡顿**：点击顶栏切换分辨率档位（原画/超清/高清/流畅），码率将随像素规模自动适配。

## 开源协议

[Apache License 2.0](LICENSE) © 2026 CHENYISAN and the CarWeb Authors
