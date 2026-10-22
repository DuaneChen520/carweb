# 01: 建立根标准文件与架构决策记录 (Standards & ADR)

**What to build:** 在代码库确立正式的 UI 与视觉工程标准，使 Matt Pocock 技能组（尤其是 `/code-review`）能够开箱即用自动对齐。创建根目录 `CODING_STANDARDS.md`（定义 UI 视觉、车机 48px 触控下限、暗色 Slate 质感、禁用硬编码颜色等审查标准），并在 `docs/adr/0018-in-cabin-visual-design-system.md` 中记录选型与权衡。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] 根目录创建/完善 `CODING_STANDARDS.md`，明确写入 `## UI & Visual Design Standards`
- [x] 规范明确定义车机触控靶区下限（$\ge 48\times 48\text{px}$）与边距规范（$\ge 8\text{px}$）
- [x] 规范明确定义座舱深色阶梯（杜绝纯黑，使用 Slate 冷灰层级）与冷调投影规范
- [x] 规范明确禁止在业务代码中硬编码裸色值（十六进制/裸 rgb）
- [x] 在 `docs/adr/0018-in-cabin-visual-design-system.md` 归档架构决策记录
