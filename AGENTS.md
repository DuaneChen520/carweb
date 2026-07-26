# CarWeb - Agent 开发说明

## 规则

注意，这是适用于我（开发者）与你（coding agent）的沟通规则

1.任何情况下，你都需要使用中文与我对话

## 验证命令

改动 `src/` 下任何代码后，以下三条命令必须全部通过后方可视为完成：

| 命令 | 作用 | 何时必跑 |
| --- | --- | --- |
| `npm run test` | 运行 Vitest 全量测试（`vitest run`） | 改动 `src/` 后必跑 |
| `npm run check` | TypeScript 类型检查（`tsc -b --noEmit`） | 改动 `src/` 后必跑 |
| `npm run lint` | ESLint 静态检查（`eslint .`） | 改动 `src/` 后必跑 |

仅改动文档（`*.md`）时可跳过；任一命令失败时须先修复再交付，不得带失败结果收尾。

## 核心边界

`src/lib/` 与 `src/hooks/scrcpy/` 是本项目的核心热点区（ADB 连接、scrcpy 会话、链路健康、应用信息缓存等关键逻辑集中于此）。对这两个目录的任何行为性改动，必须附带配套测试（新增或更新相邻的 `*.test.ts`），仅重命名/注释类改动除外。

## Agent skills

### Issue tracker

问题以本地 Markdown 文件形式存放在 `.scratch/<feature>/`（无外部 PR 作为分流入口）。`.scratch/` 由 issue tracker **惰性创建**（首次建 issue 时生成），目录暂不存在属正常，无需提前手动创建。详见 `docs/agents/issue-tracker.md`。

### Triage labels

五个标准分类角色与默认标签字符串一一对应（needs-triage、needs-info、ready-for-agent、ready-for-human、wontfix）。详见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文布局：根目录一个 `CONTEXT.md` + `docs/adr/`。详见 `docs/agents/domain.md`。