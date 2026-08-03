# PIN Guard Design — 虚拟屏桌面启动保护

## 概述

为虚拟屏增加桌面启动 PIN 保护。用户在侧边栏设置面板中为已连接的设备设置 6 位 PIN，此后该设备重连时需输入正确的 PIN 才能进入桌面。PIN 使用加盐哈希存储在 localStorage，忘记 PIN 需重新 USB 授权。

## 连接流程

```
USB/WiFi 连接建立
    │
    ▼
┌─ store.deviceSerial 有 PIN？ ──┐
│                                │
否                              是
│                                │
▼                                ▼
进入桌面(PIN guard: none)   弹出 PIN 输入(PIN guard: required)
                                     │
                              ┌──────┼──────┐
                              │             │
                          输入正确       3次错误/忘记
                              │             │
                              ▼             ▼
                          进入桌面   清除设备记忆 + 断开
                                    回到连接界面
```

## 架构变更

### 新增文件

| 文件 | 用途 |
|---|---|
| `src/hooks/useDevicePin.ts` | PIN 的 localStorage 读写，PBKDF2 加盐哈希 |
| `src/components/PinDialog.tsx` | 6 位数字 PIN 输入弹窗（复用验证 + 设置两种模式） |

### 修改文件

| 文件 | 改动 |
|---|---|
| `src/App.tsx` | 新增 `pinGuard` 状态，插入 PIN 守卫逻辑 |
| `src/components/ConnectionOverlay.tsx` | 已记忆设备点击即连，去除"连接并启动"按钮 |
| `src/components/ControlSidebar.tsx` | 设置面板新增"启动 PIN"项 |

## 数据层 — useDevicePin

```
localStorage key: 'carweb-device-pins'
存储格式: Record<deviceId, { hash: string; salt: string }>
```

PIN 不存明文，使用 `crypto.subtle` PBKDF2 加盐哈希：

- **设置 PIN**：输入 6 位数字 → 生成 16 字节随机 salt → `PBKDF2(1000 次迭代)` → 存 `{ hash, salt }`
- **验证 PIN**：用户输入 → 取存储 salt → 同参数 PBKDF2 → 对比 hash
- **清除 PIN**：删除设备对应条目
- **忘记 PIN**：清除 PIN + `forget(id)` 移除设备记忆 + 断开 ADB 连接

API：

```typescript
interface DevicePinStore {
  hasPin(deviceId: string): boolean;
  setPin(deviceId: string, pin: string): Promise<void>;
  verifyPin(deviceId: string, pin: string): Promise<boolean>;
  removePin(deviceId: string): void;
}
```

## 状态层 — App.tsx

新增 `pinGuard` 状态：

```typescript
type PinGuardState =
  | { type: 'none' }
  | { type: 'required'; deviceId: string; deviceName: string }
  | { type: 'failed'; deviceId: string };
```

连接成功回调中：

```
connectionStatus === 'connected':
  if (hasPin(store.deviceSerial)) → setPinGuard({ type: 'required', ... })
  else → finishConnect() (现有淡出流程)
```

PIN 守卫结果处理：

- `onSuccess` → `setPinGuard({ type: 'none' })` → `finishConnect()`
- `onForgot` → `removePin() + forget(id)` → `store.disconnect()` → `setPinGuard({ type: 'none' })` → 回到连接界面

## 组件层 — PinDialog

复用 ConnectionOverlay 的毛玻璃遮罩样式，支持两种模式：

### 验证模式 (`mode: 'verify'`)

- 标题："启动 PIN"
- 副标题：`{deviceName} 已设置启动保护`
- 6 个圆孔数字位
- 数字键盘：1-9 + 空位 + 0 + 退格
- "忘记 PIN？" 链接（右下角）
- 正确 → `onSuccess`
- 错误 → 抖动动画 + 清零
- 3 次错误 → `onMaxFailed`

### 设置模式 (`mode: 'setup'`)

两步流程：
1. 输入新 PIN（6 位）
2. 确认 PIN（再次输入）
3. 不一致 → 显示 "两次输入不一致"
4. 已有 PIN → 先验证旧 PIN → 再走上述流程

### 更改 PIN

设置面板点击"更改" → 验证旧 PIN → 输入新 PIN → 确认

## 连接遮罩调整

`ConnectionOverlay` 中已记忆设备列表改动：

- 选中已记忆设备 → 直接触发连接（调用 `connectUsb`/`connectWifi`）
- 连接按钮仅在新设备连接场景显示
- USB/WiFi Tab 依然可用

## 设置面板入口

`ControlSidebar` 设置面板新增项：

**启动 PIN** （始终显示，在"键盘模式"下方）

| 设备状态 | 显示 |
|---|---|
| 已连接 + 无 PIN | "设置启动 PIN" |
| 已连接 + 有 PIN | "已启用 · 更改" |
| 未连接 | "需连接设备后设置" (灰色禁用) |

## 边界情况

| 场景 | 行为 |
|---|---|
| 连接设备无 PIN | 直接进入桌面（无变化） |
| 连接设备有 PIN，输入正确 | 进入桌面 |
| 连接设备有 PIN，输入错误 | 抖动 + 清零，累计 3 次后清除记忆 + 断开 |
| 连接设备有 PIN，点"忘记 PIN" | 清除 PIN + 移除设备记忆 + 断开 |
| 设置 PIN 但两次不一致 | 提示不一致，重新输入 |
| 更改 PIN 但旧 PIN 错误 | 提示旧 PIN 错误 |
| 多设备各自有不同 PIN | 独立存储，按 deviceId 区分 |
| 页面刷新 | PIN 状态重置（`pinGuard` 是 React 状态），设备需重新连接 |
