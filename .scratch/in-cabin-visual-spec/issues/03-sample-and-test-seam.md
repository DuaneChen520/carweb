# 03: 样板组件落地与车机触控尺寸防护单测 (Sample & Test Seam)

**What to build:** 以核心控件为样板，将设计规范与语义 Token 落地于代码，并在 `src/components/__tests__/` 中建立首个 UI 尺寸与可访问性自动化测试切面，使用单测自动化阻断“点击区域小于 48px”违规。

**Blocked by:** 02 (建立语义化设计变量与详尽规范手册)

**Status:** resolved

- [x] 检查并规范 `NeumorphicButton` 或关键控制组件，使之完整支持语义 Token 与冷调投影
- [x] 在 `src/components/__tests__/` 下建立组件级 Vitest 单测
- [x] 单测断言：核心可交互控件根节点计算尺寸或 Tailwind 关键类保证 $\ge 48\times 48\text{px}$
- [x] 自动化测试全部绿灯：通过 `npm run test`、`npm run check` 与 `npm run lint`
