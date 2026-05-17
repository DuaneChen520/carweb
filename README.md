# CarWeb - 车机虚拟屏

基于 WebUSB 和 WebCodecs API 的浏览器端 Android 屏幕镜像工具，专为车机浏览器环境设计。支持有线（USB）和无线（WiFi）两种连接方式，实现手机虚拟屏在车机浏览器中的自适应显示。

## 功能特性

- **有线连接**：通过 USB 数据线直连，使用 WebUSB API 与手机建立 ADB 连接
- **无线连接**：支持同一局域网环境下的 WiFi 连接（需预先通过 USB 开启 ADB over WiFi）
- **自适应虚拟屏**：虚拟屏尺寸根据浏览器窗口大小自动适配，支持动态调整
- **触摸交互**：支持触摸/鼠标事件转发到手机，实现远程操控
- **网络检测**：自动检测网络环境和局域网连接状态

## 使用环境要求

### 浏览器要求
- **Chrome/Edge**（推荐，需支持 WebUSB API 和 WebCodecs API）
- 浏览器必须以 **HTTPS** 或 **localhost** 方式运行（WebUSB 安全要求）

### 手机端要求
- Android 设备
- 开启 **开发者选项** 和 **USB 调试**
- 有线连接时允许 USB 调试授权

### 网络要求（无线连接）
- 手机与车机处于同一局域网
- 可通过车机热点或手机热点建立局域网

## 快速开始

### 安装依赖

```bash
npm install
```

### 开发模式运行

```bash
npm run dev
```

应用将在 `http://localhost:5173` 启动。

> **注意**：开发服务器使用 HTTP 协议，WebUSB 功能需要在 HTTPS 或 localhost 环境下才能正常工作。生产部署时请配置 HTTPS。

### 构建生产版本

```bash
npm run build
```

构建产物位于 `dist/` 目录。

## 使用说明

### 有线连接（USB）

1. 使用 USB 数据线将手机连接到车机
2. 在手机上允许 USB 调试授权
3. 在 CarWeb 界面选择"有线连接"标签
4. 点击"连接设备"按钮
5. 在浏览器弹出的设备选择框中选择你的手机
6. 连接成功后点击"启动虚拟屏"

### 无线连接（WiFi）

1. 确保手机和车机连接到同一网络（或互相开启热点）
2. **首次使用需先通过 USB 连接并开启 ADB over WiFi**：
   ```bash
   adb tcpip 5555
   adb connect <手机IP>:5555
   ```
3. 在 CarWeb 界面选择"无线连接"标签
4. 输入手机的 IP 地址（如 `192.168.1.100`）
5. 点击"连接设备"按钮
6. 连接成功后点击"启动虚拟屏"

### 虚拟屏操作

- **自适应显示**：虚拟屏会根据浏览器窗口大小自动调整，保持手机原始比例
- **全屏模式**：点击顶部工具栏的全屏按钮进入/退出全屏
- **触摸操控**：在虚拟屏上点击、滑动即可操控手机
- **断开连接**：点击顶部工具栏的电源按钮断开连接

## 项目结构

```
carweb/
├── public/
│   └── scrcpy-server.jar    # scrcpy 服务端（v3.3.3）
├── src/
│   ├── components/
│   │   ├── ConnectionPanel.tsx   # 连接面板 UI
│   │   └── VirtualScreen.tsx     # 虚拟屏显示组件
│   ├── hooks/
│   │   ├── useAdbStore.ts        # ADB 状态管理（Zustand）
│   │   ├── useNetworkCheck.ts    # 网络环境检测
│   │   ├── useScrcpy.ts          # 屏幕镜像核心逻辑
│   │   ├── useUsbConnection.ts   # USB 连接逻辑
│   │   └── useWifiConnection.ts  # WiFi 连接逻辑
│   ├── App.tsx                   # 主应用组件
│   └── main.tsx                  # 入口文件
├── package.json
├── vite.config.ts
└── tailwind.config.js
```

## 技术栈

- **React 18** + **TypeScript** + **Vite**
- **Tailwind CSS** - 样式框架
- **Zustand** - 状态管理
- **ya-webadb** - ADB 客户端库（支持 WebUSB 和 TCP 连接）
- **scrcpy** - 屏幕镜像协议
- **WebCodecs API** - 视频硬解码
- **WebGL** - 视频帧渲染

## 注意事项

1. **HTTPS 要求**：WebUSB API 要求页面必须在 HTTPS 或 localhost 环境下运行。生产部署请配置 SSL 证书。

2. **scrcpy-server 版本**：`public/scrcpy-server.jar` 必须与 `@yume-chan/adb-scrcpy` 客户端库版本匹配。当前使用 v3.3.3。

3. **WiFi 连接限制**：无线连接功能目前需要预先通过 USB 开启 ADB over WiFi。纯无线首次连接需要先执行 `adb tcpip 5555`。

4. **浏览器兼容性**：
   - WebUSB API：Chrome 61+, Edge 79+
   - WebCodecs API：Chrome 94+, Edge 94+
   - 不支持 Safari 和 Firefox

5. **性能优化**：
   - 视频码率默认 8Mbps，可根据网络状况调整
   - 帧率默认 60fps
   - 使用 WebGL 硬件加速渲染

## 常见问题

**Q: 提示"浏览器不支持 WebUSB API"**
A: 请使用 Chrome 或 Edge 浏览器，并确保页面在 HTTPS 或 localhost 环境下运行。

**Q: 连接时提示"scrcpy server exited prematurely"**
A: 通常是 scrcpy-server.jar 版本不匹配导致。请确保 `public/scrcpy-server.jar` 版本与 `@yume-chan/adb-scrcpy` 依赖版本一致。

**Q: 无线连接失败**
A: 首次使用无线连接前，必须先通过 USB 执行 `adb tcpip 5555` 开启 ADB over WiFi。

**Q: 虚拟屏画面卡顿**
A: 可尝试降低视频码率或帧率。在 `src/hooks/useScrcpy.ts` 中修改 `videoBitRate` 和 `maxFps` 参数。

## 许可证

MIT License
