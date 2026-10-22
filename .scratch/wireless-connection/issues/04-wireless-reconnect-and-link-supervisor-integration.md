# 无线断线重连与链路监督（LinkSupervisor）深度集成

Status: resolved
Type: task
Spec: ../spec.md
Blocked by: 02-frontend-adb-server-client.md

---

## Problem

无线 WiFi 网络在车载环境中容易遇到弱信号短时抖动，若无健壮的断线判定与自动重连，容易发生画面冻结或会话僵死。

## Solution

1. 接入 `LinkSupervisor` 统一管理无线会话健康。
2. 遇到非主动断开时触发固定退避序列尝试自动重连。
3. 重连成功后保留原虚拟屏的几何尺寸与分屏状态，实现无感续播。
4. 区分“网络暂时中断”与“用户在手机上关闭调试”，提供准确的用户提示。

## Acceptance

- 模拟网络中断触发自动重试退避。
- 自动重连成功后，虚拟屏画面几何尺寸不发生重置或畸变。
- 主动断开不触发重连弹窗。

## Answer

1. 升级了统一断线定点处理（`src/lib/adb-disconnect.ts`）：
   - 支持区分 USB 与 WiFi 连接类型并打印对应标签；
   - 识别真实断开原因，将网络信号抖动（ECONNRESET/超时等）映射为“WiFi 信号较弱或网络暂时中断”，将鉴权失效映射为“手机端无线调试授权已失效或关闭”，准确指导用户；
   - 严格继承 `docs/adr/0007` 的有意断开打标机制，用户主动断开时直接进入 `idle`，绝不误弹重连遮罩。
2. 在 `useWifiConnection.ts` 中实现了完整的无线自动退避重连机制（`tryAutoConnectWifi`，支持 3 次指数退避序列 500ms/1000ms/2000ms、取消控制器 `cancelAutoConnect` 与进度回调），重试用尽后温和降级至 `idle`。
3. 在 `src/App.tsx` 的自动连接与重连回调（`handleReconnect`）中全面集成了无线重连退避，重连成功后无缝进入原桌面，由 `SessionManager` 保全既有虚拟屏几何尺寸与分屏状态。
4. 配套补充了单元测试（`src/hooks/__tests__/useWifiConnection.test.ts`、`src/lib/__tests__/adb-disconnect.test.ts`），三条验证命令 `npm run test`（367 tests 全绿）、`npm run check`、`npm run lint` 全部通过。
