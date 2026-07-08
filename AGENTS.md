# CarWeb - Agent 开发说明

## 规则

注意，这是适用于我（开发者）与你（coding agent）的沟通规则

1.任何情况下，你都需要使用中文与我对话

## Agent skills

### Issue tracker

问题以本地 Markdown 文件形式存放在 `.scratch/<feature>/`（无外部 PR 作为分流入口）。`.scratch/` 由 issue tracker **惰性创建**（首次建 issue 时生成），目录暂不存在属正常，无需提前手动创建。详见 `docs/agents/issue-tracker.md`。

### Triage labels

五个标准分类角色与默认标签字符串一一对应（needs-triage、needs-info、ready-for-agent、ready-for-human、wontfix）。详见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文布局：根目录一个 `CONTEXT.md` + `docs/adr/`。详见 `docs/agents/domain.md`。