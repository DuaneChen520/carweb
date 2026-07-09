# ADR-0006: 移除 Trae IDE 工具链残留

## 状态

已采纳

## 日期

2026-07-09

## 背景

早期使用 Trae Agent 辅助编程时，构建配置里被引入了两个 Trae 专属的开发依赖：

- `babel-plugin-react-dev-locator`：在 `@vitejs/plugin-react` 的 babel 配置中以 `react({ babel: { plugins: ['react-dev-locator'] } })` 启用，会在**每个 JSX 元素**上注入 `trae-inspector-start-line/column`、`trae-inspector-static-props` 等属性。由于该 Babel 插件在同一模块上被运行了多遍，属性被重复注入 3 份，触发 esbuild 在 `npm run dev` 时刷出一整屏 `Duplicate "trae-inspector-*" attribute in JSX element` 警告。
- `vite-plugin-trae-solo-badge`：在 `vite.config.ts` 中以 `traeBadgePlugin({...})` 启用，仅向 HTML 注入一个跳转 `trae.ai/solo` 的推广角标（`.trae-badge`），与警告无关，但是与产品无关的残留。

调查确认：`src/`、`docs/`、`public/` 源码中**均不含任何 `trae` 字面量**，`trae-inspector-*` 是构建时动态注入的；应用业务代码没有任何地方 import 或依赖这两个插件。

## 决策

将 Trae 工具链从构建配置与依赖中彻底移除：

- `vite.config.ts`：删除 `import { traeBadgePlugin }` 与 `traeBadgePlugin({...})` 调用；将 `react({ babel: { plugins: ['react-dev-locator'] } })` 简化为 `react()`。
- `package.json`：移除 `devDependencies` 中的 `babel-plugin-react-dev-locator` 与 `vite-plugin-trae-solo-badge`，并执行 `npm install` 同步 `package-lock.json` 与 `node_modules`。
- 重新 `vite build` 生成干净的 `dist/`（不再含角标与 `trae-inspector` 注入）。

## 被否方案

| 方案 | 原因 |
|------|------|
| 保留 `react-dev-locator` 仅作开发期点击定位 | 该功能仅在 Trae IDE 内有效，换用其他 IDE 后属于死重，且是警告的直接来源 |
| 保留 `vite-plugin-trae-solo-badge` 角标 | 纯 Trae 推广，与产品无关，且 `dist/index.html` 因此被注入无关脚本 |
| 仅关闭警告（忽略 esbuild 警告） | 治标不治本，仍向产物注入无关属性、增大产物体积 |

## 影响

- ✅ `npm run dev` / `npm run build` 不再出现 `trae-inspector-*` 重复属性警告
- ✅ `dist/index.html` 由带角标体积降至 `0.64 kB`，产物更干净
- ✅ 应用运行时行为、scrcpy 连接、虚拟屏等功能零影响（业务代码无依赖）
- ⚠️ 若日后仍希望保留「点击元素跳转源码」的开发体验，可改用与当前 IDE 匹配的同类插件（如 `babel-plugin-react-dev-inspector`）单独引入，而非 Trae 定制版
