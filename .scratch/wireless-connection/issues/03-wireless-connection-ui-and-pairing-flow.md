# 重构无线连接交互界面与配对指引流

Status: ready-for-agent
Type: task
Spec: ../spec.md
Blocked by: 02-frontend-adb-server-client.md

---

## Problem

当前 `ConnectionOverlay.tsx` 的 WiFi 选项中混杂着不可用的“车机热点/手机热点网段推测”与简陋的文本框，缺少清晰的配对步骤指引和即时反馈。

## Solution

1. 重构无线连接面板：提供「配对新手机（免线输入配对码）」与「已记住手机（一键直连）」两个主流程。
2. 配对流程提供清晰的图文指引（告知用户在手机开启无线调试并查看配对码）。
3. 支持配对码 + 端口手动敲入，支持二维码字符串解析填充。
4. 配对成功后提供平滑的连通转场动画，直接过渡到桌面启动。

## Acceptance

- UI 符合座舱视觉规范（DESIGN.md）与 48px 触控可达性标准。
- 用户在 UI 上输入 6 位配对码和端口，可触发配对并在成功后自动连接。
