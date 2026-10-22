# 无线断线重连与链路监督（LinkSupervisor）深度集成

Status: ready-for-agent
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
