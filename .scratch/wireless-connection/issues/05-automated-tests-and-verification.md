# 无线连接全量自动化测试与高阶接缝验证

Status: ready-for-agent
Type: task
Spec: ../spec.md
Blocked by: 03-wireless-connection-ui-and-pairing-flow.md, 04-wireless-reconnect-and-link-supervisor-integration.md

---

## Problem

无线连接涉及配对、建连、异常断开与自动重试，必须具备在无真实手机和宿主 ADB 环境下的高阶单一接缝自动化测试，防止未来迭代产生行为漂移。

## Solution

1. 在连接服务层建立单点高阶依赖注入接缝（Mock ADB Server 客户端）。
2. 编写配对成功、配对失败、密码错误、端口超时的全部分支测试。
3. 编写掉线自动重连与重试用尽降级的状态机测试。
4. 确保全量执行 `npm run test`、`npm run check`、`npm run lint` 三线通过。

## Acceptance

- 新增无线连接行为测试通过。
- `npm run test` 340+ 测试全绿。
- `npm run check` 与 `npm run lint` 零错误。
