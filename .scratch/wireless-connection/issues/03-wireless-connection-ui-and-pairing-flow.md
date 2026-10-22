# 重构无线连接交互界面与配对指引流

Status: resolved
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

## Answer

1. 彻底清除了 `ConnectionOverlay.tsx` 中不可用的假拓扑手动扫描逻辑，将无线连接重构为两级模块化界面：
   - 「配对新手机（免线）」：包含清晰的 Android 11+ 无线调试开启 3 步指引，提供 6 位大字号等宽配对码与 IP:端口输入框，支持一键展开二维码文本解析；
   - 「已知手机直连」：展示局域网已识别设备卡片列表与快速直连输入框，支持一键填入并直连。
2. 严格对齐 `DESIGN.md` 座舱视觉规范与人机工效标准：输入框与按钮触摸高度全部 >= 48px，使用 `#14171C`/Slate 冷灰色调与等宽数字排印，全界面零 emoji。
3. 编写了配套组件自动化测试 `src/components/__tests__/ConnectionOverlay.test.tsx`，覆盖模式切换、免线配对以及局域网设备点选直连。
4. 验证命令 `npm run test`（361 tests）、`npm run check`、`npm run lint` 全部通过。
