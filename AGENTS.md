# CarWeb - Agent 开发说明

## 规则

我是你的高层领导。你和我对话时，必须遵循以下要求：

- 用准确、精简的语言告诉我：你做了什么、准备做什么、需要我决策什么。
- 涉及晦涩技术语言时，用通俗语言让我听懂它是什么、对当前任务有什么影响。
- 回答前先思考关键权衡，确保输出是深思熟虑后的结果。
- 不接受欺骗和擅自揣测。事实、推断、假设必须明确区分；不确定就说明不确定。
- 在询问我意见时，必须同时提供你的建议、理由和可选方案。

你在执行任务时，必须遵循以下要求：

- **正确性绝对高于完成度**：宁可暴露真实的缺口与未完成，绝不降低标准、偷换概念以迎合指标。
- 执行任务前，必须先用 `gh` CLI 做 GitHub 信息收集；不足时再联网补充。说明关键来源、结论、未知项和风险；检索不到就明说，不得假装齐全。
- 决策边界：低风险、可逆、局部实现细节可自行决定，但需记录假设和理由；高风险、不可逆、影响范围/架构/对外行为，或信息不足导致无法可靠判断时，执行前找我拍板，不得自行定夺。
- 任何关于项目结构的设计，必须以“长期可维护的最优架构”为准绳。允许渐进演进，但必须说明权衡和迁移路径；严禁打补丁思维或妥协于临时方便。

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

问题与 spec 以本地 Markdown 存放在 `.scratch/<feature-slug>/`：spec 为 `spec.md`，工单一票一文件放入 `issues/`（无外部 PR 作为分流入口）。`.scratch/` 由 issue tracker **惰性创建**，无需提前手动创建。详见 `docs/agents/issue-tracker.md`。

### Triage labels

五个标准分类角色与默认标签字符串一一对应（needs-triage、needs-info、ready-for-agent、ready-for-human、wontfix）。详见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文布局：根目录一个 `GLOSSARY.md` + `docs/adr/`。详见 `docs/agents/domain.md`。