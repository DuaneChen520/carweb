# 开屏 UI 重构 — 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**目标：** 将连接设备和启动虚拟屏两步合并为一步，以 VirtualScreen 为背景，毛玻璃遮罩承载引导，并支持设备记忆自动连接。

**架构：** App.tsx 不再用 `isMirroring` 切换组件，ScrcpyProvider 提升到全局；VirtualScreen 始终渲染，由 `active` prop 控制是否启动 scrcpy；新增 ConnectionOverlay 组件以毛玻璃覆盖层形式展示在 VirtualScreen 之上。

**技术栈：** React + TypeScript + TailwindCSS + Zustand (useAdbStore) + localStorage

---

### Task 1: 新建 `useRememberedDevices` hook

**文件：**
- 新建 `src/hooks/useRememberedDevices.ts`

**Step 1: 创建 hook 文件**

```typescript
import { useState, useCallback } from 'react';

export type DisplayMode = 'virtual' | 'mirror';

export interface RememberedDevice {
  id: string;
  name: string;
  type: 'usb' | 'wifi';
  address: string;
  mode: DisplayMode;
  lastConnected: number;
}

const STORAGE_KEY = 'carweb-devices';

function loadDevices(): RememberedDevice[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveDevices(devices: RememberedDevice[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(devices));
}

export function useRememberedDevices() {
  const [devices, setDevices] = useState<RememberedDevice[]>(loadDevices);

  const remember = useCallback((device: RememberedDevice) => {
    setDevices(prev => {
      const filtered = prev.filter(d => d.id !== device.id);
      const updated = [device, ...filtered];
      saveDevices(updated);
      return updated;
    });
  }, []);

  const forget = useCallback((id: string) => {
    setDevices(prev => {
      const updated = prev.filter(d => d.id !== id);
      saveDevices(updated);
      return updated;
    });
  }, []);

  const getLastDevice = useCallback((): RememberedDevice | undefined => {
    if (devices.length === 0) return undefined;
    return devices.reduce((a, b) => a.lastConnected > b.lastConnected ? a : b);
  }, [devices]);

  return { devices, remember, forget, getLastDevice };
}
```

**验证：** 无测试文件，手动检查 lint。

---

### Task 2: 改造 `App.tsx` — 全局状态 + 自动连接

**文件：**
- 修改 `src/App.tsx`（全文重写）

**Step 1: 重写 App.tsx**

新的结构：
- ScrcpyProvider 提升到最外层
- 移除 `isMirroring`，新增 `overlayState` + `displayMode`
- VirtualScreen 始终渲染，新增 `active` prop
- 自动连接逻辑：mount 时检测已记忆设备 → 尝试 auto-connect

```typescript
import { useState, useEffect, useCallback } from 'react';
import { VirtualScreen } from './components/VirtualScreen';
import { ConnectionOverlay } from './components/ConnectionOverlay';
import { ScrcpyProvider } from './contexts/ScrcpyContext';
import { useAdbStore } from './hooks/useAdbStore';
import { useRememberedDevices, type DisplayMode } from './hooks/useRememberedDevices';

type OverlayState = 'auto-connecting' | 'manual' | 'hidden';

function App() {
  const [overlayState, setOverlayState] = useState<OverlayState>('manual');
  const [displayMode, setDisplayMode] = useState<DisplayMode>('virtual');
  const { devices, remember, getLastDevice } = useRememberedDevices();
  const store = useAdbStore();

  // 页面刷新/关闭时清理 ADB 连接
  useEffect(() => {
    const handleBeforeUnload = () => {
      const adb = useAdbStore.getState().adb;
      if (adb) {
        try { adb.close(); } catch { /* ignore */ }
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // 自动连接已记忆设备
  useEffect(() => {
    const lastDevice = getLastDevice();
    if (!lastDevice) {
      setOverlayState('manual');
      return;
    }

    setOverlayState('auto-connecting');
    setDisplayMode(lastDevice.mode);

    const autoConnect = async () => {
      try {
        if (lastDevice.type === 'wifi') {
          // TODO: 实现通过 IP 自动 ADB connect
          // 需要 wifi connection hook，当前 useWifiConnection.connectWifi 是 stub
          // 此处先跳过，降级为 manual
          setOverlayState('manual');
        } else {
          // USB 需要用户授权 WebUSB，无法自动重连
          setOverlayState('manual');
        }
      } catch {
        setOverlayState('manual');
      }
    };
    autoConnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleConnect = useCallback(async (device: { id: string; name: string; type: 'usb' | 'wifi'; address: string }, mode: DisplayMode, shouldRemember: boolean) => {
    setDisplayMode(mode);
    setOverlayState('auto-connecting');

    try {
      // 连接逻辑复用 useUsbConnection / useWifiConnection
      // 连接成功后：
      if (shouldRemember) {
        remember({
          id: device.id,
          name: device.name,
          type: device.type,
          address: device.address,
          mode,
          lastConnected: Date.now(),
        });
      }
      setOverlayState('hidden');
    } catch {
      setOverlayState('manual');
    }
  }, [remember]);

  const handleStop = useCallback(() => {
    store.disconnect();
    setOverlayState('manual');
  }, [store]);

  return (
    <ScrcpyProvider>
      <div className="w-full h-screen bg-slate-900">
        <VirtualScreen
          active={overlayState === 'hidden'}
          displayMode={displayMode}
          onStop={handleStop}
        />
        {overlayState !== 'hidden' && (
          <ConnectionOverlay
            overlayState={overlayState}
            displayMode={displayMode}
            rememberedDevices={devices}
            onSelectMode={setDisplayMode}
            onConnect={handleConnect}
          />
        )}
      </div>
    </ScrcpyProvider>
  );
}

export default App;
```

**Step 2: 确认引入路径正确**

注意：`ConnectionOverlay` 组件将在 Task 3 中创建。

---

### Task 3: 新建 `ConnectionOverlay` 组件

**文件：**
- 新建 `src/components/ConnectionOverlay.tsx`

**Step 1: 创建 ConnectionOverlay**

```typescript
import { useState } from 'react';
import { Usb, Wifi, Monitor, Smartphone, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';
import { useUsbConnection } from '../hooks/useUsbConnection';
import { useWifiConnection } from '../hooks/useWifiConnection';
import { useNetworkCheck } from '../hooks/useNetworkCheck';
import { useAdbStore } from '../hooks/useAdbStore';
import type { RememberedDevice, DisplayMode } from '../hooks/useRememberedDevices';

interface ConnectionOverlayProps {
  overlayState: 'auto-connecting' | 'manual';
  displayMode: DisplayMode;
  rememberedDevices: RememberedDevice[];
  onSelectMode: (mode: DisplayMode) => void;
  onConnect: (device: { id: string; name: string; type: 'usb' | 'wifi'; address: string }, mode: DisplayMode, remember: boolean) => void;
}

export function ConnectionOverlay({
  overlayState,
  displayMode,
  rememberedDevices,
  onSelectMode,
  onConnect,
}: ConnectionOverlayProps) {
  const [activeTab, setActiveTab] = useState<'usb' | 'wifi'>('usb');
  const [wifiAddress, setWifiAddress] = useState('');
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [shouldRemember, setShouldRemember] = useState(true);

  const usb = useUsbConnection();
  const wifi = useWifiConnection();
  const network = useNetworkCheck();
  const store = useAdbStore();

  const isConnecting = overlayState === 'auto-connecting';
  const isConnected = store.connectionStatus === 'connected';

  const handleConnectClick = async () => {
    // 如果选中了已记忆设备
    if (selectedDevice) {
      const dev = rememberedDevices.find(d => d.id === selectedDevice);
      if (dev) {
        await onConnect(
          { id: dev.id, name: dev.name, type: dev.type, address: dev.address },
          displayMode,
          shouldRemember,
        );
        return;
      }
    }

    // 新设备连接
    if (activeTab === 'usb') {
      await usb.connectUsb();
      // 监听连接成功 → onConnect（通过 useEffect 或回调）
    } else if (wifiAddress.trim()) {
      await wifi.connectWifi(wifiAddress.trim());
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xl">
      <div className="w-full max-w-lg mx-4">
        {/* 自动连接中 */}
        {overlayState === 'auto-connecting' && (
          <div className="text-center py-12">
            <RefreshCw className="w-10 h-10 text-blue-400 animate-spin mx-auto mb-4" />
            <div className="text-white text-lg font-medium">正在自动连接上次的设备...</div>
            <button
              onClick={() => onSelectMode(displayMode)}
              className="mt-4 text-sm text-slate-400 hover:text-white transition-colors"
            >
              取消，手动连接
            </button>
          </div>
        )}

        {/* 手动连接 */}
        {overlayState === 'manual' && (
          <div className="bg-slate-900/90 border border-slate-700 rounded-2xl p-8 shadow-2xl">
            {/* Header */}
            <div className="text-center mb-8">
              <h1 className="text-3xl font-bold text-white mb-2">CARWEB</h1>
              <p className="text-slate-400">为手机拓展的浏览器大屏</p>
            </div>

            {/* Mode Selector */}
            <div className="grid grid-cols-2 gap-3 mb-6">
              <button
                onClick={() => onSelectMode('virtual')}
                className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                  displayMode === 'virtual'
                    ? 'border-blue-400 bg-blue-500/10 text-blue-400'
                    : 'border-slate-600 text-slate-400 hover:border-slate-500'
                }`}
              >
                <Monitor className="w-6 h-6" />
                <span className="text-sm font-medium">虚拟显示屏</span>
                <span className="text-xs opacity-60">创建独立副屏</span>
              </button>
              <button
                onClick={() => onSelectMode('mirror')}
                className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                  displayMode === 'mirror'
                    ? 'border-blue-400 bg-blue-500/10 text-blue-400'
                    : 'border-slate-600 text-slate-400 hover:border-slate-500'
                }`}
              >
                <Smartphone className="w-6 h-6" />
                <span className="text-sm font-medium">屏幕镜像</span>
                <span className="text-xs opacity-60">同步手机屏幕</span>
              </button>
            </div>

            {/* Remembered Devices */}
            {rememberedDevices.length > 0 && (
              <div className="mb-6">
                <div className="text-xs text-slate-500 uppercase tracking-wide mb-2">已记忆的设备</div>
                <div className="space-y-2">
                  {rememberedDevices.map(dev => (
                    <button
                      key={dev.id}
                      onClick={() => setSelectedDevice(dev.id)}
                      className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all ${
                        selectedDevice === dev.id
                          ? 'border-blue-400 bg-blue-500/10'
                          : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-sm">
                          {dev.type === 'usb' ? '🔌' : '📡'}
                        </div>
                        <div className="text-left">
                          <div className="text-white text-sm font-medium">{dev.name}</div>
                          <div className="text-slate-500 text-xs">{dev.address}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-slate-400 text-xs">{dev.mode === 'virtual' ? '虚拟屏' : '镜像'}</div>
                        <div className="text-slate-600 text-xs">
                          {formatRelativeTime(dev.lastConnected)}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Divider */}
            <div className="flex items-center gap-3 mb-6">
              <div className="flex-1 h-px bg-slate-700" />
              <span className="text-xs text-slate-500">或连接新设备</span>
              <div className="flex-1 h-px bg-slate-700" />
            </div>

            {/* Connection Tabs */}
            <div className="flex border border-slate-700 rounded-xl overflow-hidden mb-4">
              <button
                onClick={() => setActiveTab('usb')}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors ${
                  activeTab === 'usb'
                    ? 'text-blue-400 bg-slate-700/50'
                    : 'text-slate-400 hover:text-slate-300'
                }`}
              >
                <Usb className="w-4 h-4" />
                USB
              </button>
              <button
                onClick={() => setActiveTab('wifi')}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors ${
                  activeTab === 'wifi'
                    ? 'text-blue-400 bg-slate-700/50'
                    : 'text-slate-400 hover:text-slate-300'
                }`}
              >
                <Wifi className="w-4 h-4" />
                WiFi
              </button>
            </div>

            {activeTab === 'wifi' && (
              <div className="mb-4">
                <input
                  type="text"
                  value={wifiAddress}
                  onChange={(e) => setWifiAddress(e.target.value)}
                  placeholder="设备 IP 地址"
                  className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-blue-400 transition-colors"
                />
                <button
                  onClick={wifi.scanDevices}
                  disabled={wifi.isScanning}
                  className="mt-2 w-full py-2 text-sm text-blue-400 hover:text-blue-300 transition-colors disabled:opacity-50"
                >
                  {wifi.isScanning ? '扫描中...' : '扫描局域网设备'}
                </button>
                {wifi.discoveredDevices.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {wifi.discoveredDevices.map(ip => (
                      <button
                        key={ip}
                        onClick={() => setWifiAddress(ip)}
                        className="w-full px-3 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 text-sm text-left transition-colors"
                      >
                        {ip}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Error */}
            {store.error && (
              <div className="mb-4 flex items-center gap-2 text-red-400 text-sm">
                <AlertCircle className="w-4 h-4" />
                {store.error}
              </div>
            )}

            {/* Connect Button + Remember Checkbox */}
            <div className="space-y-3">
              <button
                onClick={handleConnectClick}
                disabled={isConnecting || (activeTab === 'wifi' && !wifiAddress.trim() && !selectedDevice)}
                className="w-full py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {isConnecting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    连接中...
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    连接并启动
                  </>
                )}
              </button>
              <label className="flex items-center justify-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={shouldRemember}
                  onChange={(e) => setShouldRemember(e.target.checked)}
                  className="rounded border-slate-600 bg-slate-700 text-blue-500 focus:ring-blue-500"
                />
                <span className="text-sm text-slate-400">记住此设备</span>
              </label>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return `${Math.floor(diff / 86400000)} 天前`;
}
```

**Step 2: 验证编译**：`npx tsc --noEmit` 确认无误。

---

### Task 4: 改造 `VirtualScreen` — 新增 `active` prop

**文件：**
- 修改 `src/components/VirtualScreen.tsx`

**Step 1: 修改接口，新增 `active` 和 `displayMode` prop**

找到 `interface VirtualScreenProps`（第 12-14 行），改为：

```typescript
interface VirtualScreenProps {
  active?: boolean;
  displayMode?: 'virtual' | 'mirror';
  onStop: () => void;
}
```

**Step 2: 解构 props 并设置默认值**

在函数声明（第 16 行）处改为：

```typescript
export function VirtualScreen({ active = false, displayMode = 'virtual', onStop }: VirtualScreenProps) {
```

**Step 3: 在 `active=false` 时跳过启动逻辑**

在第一个 useEffect（第 73 行）顶部添加守卫：

```typescript
useEffect(() => {
  if (!active) return;  // 未激活时不启动

  const canvas = canvasRef.current;
  // ... 原有代码
```

并在 cleanup effect（第 181-187 行）也添加 `!active` 守卫，避免卸载时误执行 stopScrcpy。

**Step 4: 当 `active=false` 时显示占位符**

在 canvas 元素前添加条件占位内容（第 377-391 行附近）：

```typescript
{!active && !isStarting && !error && (
  <div className="absolute inset-0 flex items-center justify-center">
    <div className="text-center text-slate-700">
      <Monitor className="w-16 h-16 mx-auto mb-4 opacity-30" />
      <p className="text-lg">车机虚拟屏</p>
      <p className="text-sm mt-1">连接设备后启动</p>
    </div>
  </div>
)}
```

**Step 5: 将 `useMirrorMode` 默认值与 `displayMode` 同步**

将 `useMirrorMode` 的初始值从 `false` 改为从 `displayMode` 派生：

```typescript
const [useMirrorMode, setUseMirrorMode] = useState(displayMode === 'mirror');
```

并添加 effect 在 `displayMode` 变化时同步：

```typescript
useEffect(() => {
  setUseMirrorMode(displayMode === 'mirror');
}, [displayMode]);
```

---

### Task 5: 清理旧组件 & 验证

**文件：**
- `src/App.tsx` — 移除 `ConnectionPanel` import（确认 Task 2 已移除）
- `src/components/ConnectionPanel.tsx` — 保留不动（安全起见），确认无其他引用

**Step 1: 检查无其他文件引用 ConnectionPanel**

```bash
rg "ConnectionPanel" src/ --type ts --type tsx
```

只应在 `App.tsx` 中出现已被移除的引用。

**Step 2: 完整编译验证**

```bash
npx tsc --noEmit
```

**Step 3: 手动 lint**

```bash
npm run lint
```

---

### Task 6: 过渡动画

**文件：**
- `src/components/ConnectionOverlay.tsx` — 添加 fade-out 动画
- `src/App.tsx` — 切换 overlayState 时保留连接状态

**Step 1: 在 ConnectionOverlay 外层容器添加过渡 class**

```typescript
const [fadingOut, setFadingOut] = useState(false);

// 在 App.tsx 中，隐藏前先触发 fade-out
// overlayState === 'hidden' 时延迟移除 DOM
```

实际实现：在 App.tsx 中用 `useState` 控制一个延迟移除的 wrapper：

```typescript
const [overlayVisible, setOverlayVisible] = useState(true);
const [isFading, setIsFading] = useState(false);

useEffect(() => {
  if (overlayState === 'hidden') {
    setIsFading(true);
    const timer = setTimeout(() => setOverlayVisible(false), 300);
    return () => clearTimeout(timer);
  } else {
    setIsFading(false);
    setOverlayVisible(true);
  }
}, [overlayState]);
```

渲染时用 `overlayVisible` 替代 `overlayState !== 'hidden'`，并传递 `isFading` 到 ConnectionOverlay 来添加 `opacity-0 transition-opacity duration-300` 类。

---

### 执行顺序

按依赖关系执行：

```
Task 1: useRememberedDevices hook
  ↓
Task 2: App.tsx 改造（依赖于 Task 1 的类型）
  ↓
Task 3: ConnectionOverlay 组件
  ↓
Task 4: VirtualScreen active prop
  ↓
Task 5: 清理 & 验证
  ↓
Task 6: 过渡动画（可选，可在最后打磨）
```
