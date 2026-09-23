# Task 9 Report

## 2026-09-23 — Important findings fix

- **词界匹配**：英文 token 使用 `(^|[^a-z])…([^a-z]|$)`，去掉去空白后 `includes`，避免 `hotel`→`tel` 等误报；移除弱 token `mail`、裸 `name`。
- **关键词**：中文保留 邮箱/电话/手机/姓名/名字/城市；英文为 `email`、`e-mail`、`phone`、`mobile`、`tel`、`full…name`、`city`。
- **合并去重**：`mergeHeuristicAndLlmPlan` 按 `fieldId` 丢弃 LLM 与启发式重复项，启发式优先。
- **构建**：`npm run build` 通过。
- **提交**：`fix: tighten local heuristic matching and dedupe`
