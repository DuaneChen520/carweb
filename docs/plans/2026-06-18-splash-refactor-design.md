# 开屏 UI 重构设计方案

## 概述

将现有的"连接设备 → 启动虚拟屏"两步流程合并为一步，以 VirtualScreen 作为背景层，毛玻璃遮罩承载连接引导，并支持设备记忆实现自动连接。

## 问题

1. 连接设备和启动虚拟屏是两个串行步骤，操作冗余
2. 模式选择（虚拟屏/镜像）滞后，只能在进入 VirtualScreen 后切换
3. 已连接过的设备无法记忆，每次都需要重新输入/插线
4. 首屏视觉单调，缺少沉浸感

## 设计方案

### 组件树

```
App.tsx
├── ScrcpyProvider               ← 移到全局，始终挂载
│   └── VirtualScreen            ← 始终渲染
│       ├── ControlSidebar       ← active=false 时按钮 disabled
│       ├── <canvas>             ← 未激活时显示占位 Logo
│       └── StartingOverlay      ← 仅在启动中显示
│
├── ConnectionOverlay            ← overlayState !== 'hidden' 时渲染
│   ├── 毛玻璃遮罩层             ← backdrop-blur-xl bg-black/40
│   ├── WelcomeHeader            ← "CARWEB — 为手机拓展的浏览器大屏"
│   ├── ModeSelector             ← 虚拟屏 / 镜像 切换
│   ├── DeviceSection            ← 设备列表
│   │   ├── RememberedList       ← 已记忆设备卡片
│   │   └── NewDeviceForm        ← USB/WiFi 连接入口
│   └── ConnectButton            ← 连接并启动
│
└── AutoConnectBanner            ← overlayState='auto-connecting' 时置顶显示
    └── "正在自动连接上次的设备..."
```

### 状态设计

```typescript
type OverlayState = 'auto-connecting' | 'manual' | 'hidden';
type DisplayMode = 'virtual' | 'mirror';

// App.tsx
const [overlayState, setOverlayState] = useState<OverlayState>(
  hasRememberedDevice() ? 'auto-connecting' : 'manual'
);
const [displayMode, setDisplayMode] = useState<DisplayMode>('virtual');
```

不再使用 `isMirroring` 布尔值，改为三态 `overlayState` 控制覆盖层显隐。

### 设备记忆

localStorage 存储，key: `carweb-devices`

```typescript
interface RememberedDevice {
  id: string;           // 设备序列号
  name: string;         // 设备名
  type: 'usb' | 'wifi';
  address: string;      // wifi 时为 IP
  mode: DisplayMode;    // 上次使用的模式
  lastConnected: number;
}
```

新建 `src/hooks/useRememberedDevices.ts`，提供 `devices`、`remember`、`forget`、`getLastDevice` API。

### 流程

```
首次访问：
  → overlayState = 'manual'
  → 展示 ConnectionOverlay（毛玻璃遮罩 + VirtualScreen 背景）
  → 用户选模式 + 选设备 → 点击"连接并启动"
  → overlayState = 'auto-connecting'
  → ADB connect → 成功 → remember(device, mode)
  → overlayState = 'hidden' (遮罩淡出)
  → VirtualScreen 激活 → startScrcpy(...)

再次访问（有已记住设备）：
  → overlayState = 'auto-connecting'
  → VirtualScreen 背景直接可见，顶部 AutoConnectBanner
  → 尝试 ADB connect（wifi 用地址，usb 检测）
  → 成功 → overlayState = 'hidden' → 激活 VirtualScreen
  → 失败 → overlayState = 'manual' + 错误提示
```

### 关键变化文件

| 文件 | 变化 |
|---|---|
| `src/App.tsx` | 移除 `isMirroring`，新增 `overlayState` + `displayMode`，ScrcpyProvider 提升到全局 |
| `src/components/ConnectionPanel.tsx` | 废弃，替换为 ConnectionOverlay |
| `src/components/ConnectionOverlay.tsx` | 新建，毛玻璃遮罩 + 模式选择 + 设备列表 + 连接按钮 |
| `src/components/VirtualScreen.tsx` | 新增 `active` prop，未激活时 canvas 显示占位、sidebar disabled |
| `src/hooks/useRememberedDevices.ts` | 新建，localStorage 设备记忆 |
| `src/contexts/ScrcpyContext.tsx` | 需支持外部触发激活（不再由 VirtualScreen 内部自动启动） |
